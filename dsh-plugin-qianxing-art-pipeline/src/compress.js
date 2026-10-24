// S1 压缩核心：调色板量化（PIL MEDIANCUT 等价）→ NEAREST 缩放 → 洋红键控背景 →
// 贪心最大对齐矩形合并（compress.py 动态 STD 档位）→ 几何/色差自检。
//
// 移植来源（只看逻辑，不引入任何依赖）：
//   · _work/art-tools/miliastra-image-algorithm/compress.py
//       pack_auto / auto_dyn_params / build_tolmap / pack_rects_dyn / Integrals / validate_blocks
//   · _work/art-tools/miliastra-image-algorithm/blockcodec.py
//       pack_hex / replay_positions / check_scan_order（扫描顺序可推演 x,y；本插件保留 x,y 但自检用）
//   · _work/art-tools/compress_statue.py + finalize_statue_v332g.py
//       prepare（crop → 量化 → NEAREST → alpha>=128 保留，否则洋红键控）+ 层转换口径
//   · pill 的 median cut（Python Imaging Library 的 Quant.c，按算法重写为 JS）：
//       唯一色直方图 → 三通道链表 → 按加权像素数的最大堆逐次切分 → 叶均值调色板 →
//       "先落在中位箱里、再在邻域内找更近调色板" 的像素映射
//     （该实现能逐像素复现 compress_statue.py 产出的 statue-prep.png，见 test/self-decompose.mjs 对照。）
//
// 坐标口径：块 (x,y) 是图标局部像素，原点左上、y 向下、右为 x 正；
// 转模板层时由调用方换成 dx（相对 content 中心，右正）/ dy_down（下正）。
import { CODES, fail } from './errors.js'
import { CELL_TEMPLATE_PX } from './contract.js'

/** 背景键控色：量化色板里不会出现洋红，压缩后按它过滤背景块（交接包 01 §4 步骤 4）。 */
export const MAGENTA = Object.freeze([255, 0, 255])

/** alpha < 128 的像素视为背景（与 compress_statue.py 的 `if ap[x,y] >= 128` 一致）。 */
export const ALPHA_KEY_THRESHOLD = 128

/** 单块 w/h 上限：块编码用 1 字节存 w/h，超过 255 会静默回绕画错图（blockcodec.py 硬失败）。 */
export const MAX_BLOCK_DIM = 255

export const DEFAULT_QUANTIZE = 8
export const DEFAULT_STD = 2

/** 各家具「长边占格」SPAN（交接包 01 §3 实测值；压缩路线也用它推导默认目标尺寸）。 */
export const SPAN = Object.freeze({ chair: 0.836, plant: 0.76, statue: 0.912, table: 0.836 })

/** 雕像压缩基线：宽 56、高按图标比例（01 §4 的 56×91 基线）。 */
export const STATUE_BASELINE_WIDTH = 56

// ── 通用小工具 ──────────────────────────────────────────────────────────────

/** RGB 三元组 → 0xRRGGBB。 */
export function rgbKey(r, g, b) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

/** 0xRRGGBB → [r, g, b]。 */
export function keyToRgb(key) {
  return [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]
}

/** 通道值转两位大写 hex。 */
export function hex2(v) {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

/** 0xRRGGBB → "FFRRGGBB"（不含 0x，供拼 `0xFFRRGGBB`）。 */
export function rgbToHex6(r, g, b) {
  return hex2(r) + hex2(g) + hex2(b)
}

/**
 * Python `round()`：四舍六入五成双（banker's rounding）。
 * compress.py 的 `Integrals.mean()` 用 `int(round(...))`，块色必须按这个口径才能和参考产物一致。
 */
export function pyRound(x) {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

// ── 1. 裁切：以「非零像素包围盒」裁掉四周空白（PIL Image.getbbox 口径）────────
/**
 * 计算非零像素包围盒（任一通道非零即算有内容，等价 PIL RGBA.getbbox()）。
 * 参考图标通常 alpha=0 且 RGB=0，所以这也等于「alpha 包围盒」。
 * @param {{width:number,height:number,data:Uint8Array}} image RGBA
 * @returns {{x:number,y:number,w:number,h:number}|null} 全透明图返回 null
 */
export function alphaBBox(image) {
  const { width, height, data } = image
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 按包围盒裁出 RGBA 子图（返回新 Uint8Array）。 */
export function cropImage(image, box) {
  const { width, data } = image
  const out = new Uint8Array(box.w * box.h * 4)
  for (let y = 0; y < box.h; y++) {
    const srcRow = ((box.y + y) * width + box.x) * 4
    out.set(data.subarray(srcRow, srcRow + box.w * 4), y * box.w * 4)
  }
  return { width: box.w, height: box.h, data: out }
}

/** 裁掉透明/空白边；返回 { image, box }。全透明图抛 E_SPEC_INVALID。 */
export function cropAlphaContent(image) {
  const box = alphaBBox(image)
  if (!box) fail(CODES.SPEC, '参考图没有可见像素（全透明/全零）', { width: image?.width, height: image?.height })
  if (box.x === 0 && box.y === 0 && box.w === image.width && box.h === image.height) return { image, box }
  return { image: cropImage(image, box), box }
}

// ── 2. 调色板量化：PIL MEDIANCUT 等价实现 ───────────────────────────────────
/**
 * 颜色直方图 → 最多 65536 个「箱」（PIL 在唯一色超过 65536 时按位移合并；
 * 这里保持同样的位移合并机制，代表色取箱内精确均值，行为等价且误差更小）。
 * 参考图标一般只有几千个唯一色，走 shift=0 精确分支。
 * @returns {{ bins: Array<{r:number,g:number,b:number,count:number}>, binOf: Map<number,number>, shift:number }}
 */
function buildColorBins(rgb, pixelCount) {
  const exact = new Map()
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 3
    const key = rgbKey(rgb[i], rgb[i + 1], rgb[i + 2])
    exact.set(key, (exact.get(key) || 0) + 1)
  }
  const MAX_BINS = 65536
  for (let shift = 0; shift <= 8; shift++) {
    const sums = new Map() // binKey → 精确通道和 + 像素数
    for (const [key, count] of exact) {
      const [r, g, b] = keyToRgb(key)
      const binKey = shift === 0 ? key : ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift)
      const item = sums.get(binKey)
      if (item) {
        item.r += r * count
        item.g += g * count
        item.b += b * count
        item.count += count
      } else {
        sums.set(binKey, { r: r * count, g: g * count, b: b * count, count })
      }
    }
    if (sums.size <= MAX_BINS || shift === 8) {
      const bins = []
      const indexByBinKey = new Map()
      for (const [binKey, item] of sums) {
        indexByBinKey.set(binKey, bins.length)
        bins.push({
          r: Math.floor(0.5 + item.r / item.count),
          g: Math.floor(0.5 + item.g / item.count),
          b: Math.floor(0.5 + item.b / item.count),
          count: item.count,
        })
      }
      const binOf = new Map()
      for (const key of exact.keys()) {
        const [r, g, b] = keyToRgb(key)
        const binKey = shift === 0 ? key : ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift)
        binOf.set(key, indexByBinKey.get(binKey))
      }
      return { bins, binOf, shift }
    }
  }
  fail(CODES.INTERNAL, '颜色直方图归并失败')
}

/** 最大堆（median cut 选「像素数最多」的箱）；与 QuantHeap.c 的入堆/出堆规则一致。 */
class MaxHeap {
  constructor(compare) {
    this.compare = compare
    this.heap = [null]
    this.count = 0
  }

  add(value) {
    let k = ++this.count
    while (k !== 1) {
      const parent = this.heap[k >> 1]
      if (this.compare(value, parent) <= 0) break
      this.heap[k] = parent
      k >>= 1
    }
    this.heap[k] = value
  }

  remove() {
    if (this.count === 0) return null
    const root = this.heap[1]
    const last = this.heap[this.count]
    this.count--
    let k = 1
    let child
    for (; k * 2 <= this.count; k = child) {
      child = k * 2
      if (child < this.count && this.compare(this.heap[child], this.heap[child + 1]) < 0) child++
      if (this.compare(last, this.heap[child]) > 0) break
      this.heap[k] = this.heap[child]
    }
    this.heap[k] = last
    return root
  }
}

/** 箱的「体积」：三通道极差各 +1 的乘积（Quant.c compute_box_volume）。 */
function boxVolume(box, bins) {
  if (box.volume >= 0) return box.volume
  if (box.members.length === 0) {
    box.volume = 0
    return 0
  }
  let rmin = 255
  let rmax = 0
  let gmin = 255
  let gmax = 0
  let bmin = 255
  let bmax = 0
  for (const i of box.members) {
    const bin = bins[i]
    if (bin.r < rmin) rmin = bin.r
    if (bin.r > rmax) rmax = bin.r
    if (bin.g < gmin) gmin = bin.g
    if (bin.g > gmax) gmax = bin.g
    if (bin.b < bmin) bmin = bin.b
    if (bin.b > bmax) bmax = bin.b
  }
  box.volume = (rmax - rmin + 1) * (gmax - gmin + 1) * (bmax - bmin + 1)
  return box.volume
}

/**
 * 切一个箱（Quant.c split/splitlists）：
 *   1) 轴 = 加权极差最大的通道（权重 77/150/29，人眼亮度的近似）
 *   2) 沿轴降序累计像素数，超过一半处切；同值的整组归左
 *   3) 若右侧为空（值全落在同一组），fallback：把「最小值组」拆到右侧（保证非空）
 * @returns {boolean} 是否切成功
 */
function splitBox(box, bins) {
  const members = box.members
  let rmin = 255
  let rmax = 0
  let gmin = 255
  let gmax = 0
  let bmin = 255
  let bmax = 0
  for (const i of members) {
    const bin = bins[i]
    if (bin.r < rmin) rmin = bin.r
    if (bin.r > rmax) rmax = bin.r
    if (bin.g < gmin) gmin = bin.g
    if (bin.g > gmax) gmax = bin.g
    if (bin.b < bmin) bmin = bin.b
    if (bin.b > bmax) bmax = bin.b
  }
  const f = [(rmax - rmin) * 77, (gmax - gmin) * 150, (bmax - bmin) * 29]
  let axis = 0
  let best = f[0]
  for (let i = 1; i < 3; i++) {
    if (best < f[i]) {
      best = f[i]
      axis = i
    }
  }
  box.axis = axis
  const valueOf = (bin) => (axis === 0 ? bin.r : axis === 1 ? bin.g : bin.b)
  const sorted = members.slice().sort((a, b) => valueOf(bins[b]) - valueOf(bins[a]))
  const total = box.pixelCount
  let leftCount = 0
  let ci = 0
  while (ci < sorted.length) {
    leftCount += bins[sorted[ci]].count
    ci++
    if (leftCount * 2 > total) break
  }
  let splitValue = -1
  if (ci < sorted.length) {
    splitValue = valueOf(bins[sorted[ci - 1]])
    while (ci < sorted.length && valueOf(bins[sorted[ci]]) === splitValue) ci++
  }
  let leftMembers
  let rightMembers
  if (ci >= sorted.length) {
    // fallback：右侧取最小值组，左侧其余（C 实现里 nRight==0 的分支）
    const minValue = valueOf(bins[sorted[sorted.length - 1]])
    const rightSet = new Set()
    for (let k = sorted.length - 1; k >= 0 && valueOf(bins[sorted[k]]) === minValue; k--) rightSet.add(sorted[k])
    leftMembers = []
    rightMembers = []
    for (const i of sorted) (rightSet.has(i) ? rightMembers : leftMembers).push(i)
  } else {
    leftMembers = []
    rightMembers = []
    for (const i of sorted) (valueOf(bins[i]) >= splitValue ? leftMembers : rightMembers).push(i)
  }
  if (rightMembers.length === 0 || leftMembers.length === 0) return false
  let leftPixels = 0
  let rightPixels = 0
  for (const i of leftMembers) leftPixels += bins[i].count
  for (const i of rightMembers) rightPixels += bins[i].count
  box.l = { members: leftMembers, pixelCount: leftPixels, l: null, r: null, axis: -1, volume: -1 }
  box.r = { members: rightMembers, pixelCount: rightPixels, l: null, r: null, axis: -1, volume: -1 }
  box.members = null
  return true
}

/**
 * 递归中位切分：最多切出 colors 个叶子。
 * @returns {{ tree: object, boxes: number[][] }} boxes[k] = 第 k 个调色板颜色对应的箱下标数组
 */
function medianCut(bins, totalPixels, colors) {
  const root = { members: bins.map((_, i) => i), pixelCount: totalPixels, l: null, r: null, axis: -1, volume: -1 }
  const heap = new MaxHeap((a, b) => a.pixelCount - b.pixelCount)
  heap.add(root)
  let remaining = colors
  while (--remaining) {
    let node = null
    do {
      node = heap.remove()
      if (!node) return collectLeaves(root)
    } while (boxVolume(node, bins) === 1)
    if (!splitBox(node, bins)) break
    heap.add(node.l)
    heap.add(node.r)
  }
  return collectLeaves(root)
}

/** 叶子遍历：左子树在前，决定调色板下标顺序（Quant.c annotate_hash_table 同序）。 */
function collectLeaves(root) {
  const boxes = []
  const visit = (node) => {
    if (node.l && node.r) {
      visit(node.l)
      visit(node.r)
      return
    }
    boxes.push(node.members)
  }
  visit(root)
  return { boxes }
}

/**
 * 调色板量化（PIL `Image.quantize(colors=N, method=MEDIANCUT)` 等价）。
 * @param {{width:number,height:number,data:Uint8Array}} image RGBA（任意尺寸）
 * @param {number} colors 目标色数 1..256
 * @returns {{ rgb: Uint8Array, palette: Array<number[]>, bins: number }} rgb 为量化后的全分辨率 RGB
 */
export function quantizeMedianCut(image, colors) {
  const pixelCount = image.width * image.height
  const rgb = new Uint8Array(pixelCount * 3)
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4
    rgb[p * 3] = image.data[i]
    rgb[p * 3 + 1] = image.data[i + 1]
    rgb[p * 3 + 2] = image.data[i + 2]
  }
  const { bins, binOf } = buildColorBins(rgb, pixelCount)
  if (bins.length <= colors) {
    // 唯一色不超过目标色数：原样保留（PIL 同样不会改变这些像素）
    return { rgb, palette: bins.map((b) => [b.r, b.g, b.b]), bins: bins.length }
  }
  const totalPixels = bins.reduce((sum, b) => sum + b.count, 0)
  const { boxes } = medianCut(bins, totalPixels, colors)
  // 每个叶子的加权平均色（C: (int)(0.5 + sum/count)，即四舍五入）
  const palette = boxes.map((members) => {
    let sr = 0
    let sg = 0
    let sb = 0
    let count = 0
    for (const i of members) {
      sr += bins[i].r * bins[i].count
      sg += bins[i].g * bins[i].count
      sb += bins[i].b * bins[i].count
      count += bins[i].count
    }
    return [
      Math.floor(0.5 + sr / count),
      Math.floor(0.5 + sg / count),
      Math.floor(0.5 + sb / count),
    ]
  })
  // 箱 → 中位箱子（调色板下标）
  const boxIndexByBin = new Int32Array(bins.length)
  boxes.forEach((members, paletteIndex) => {
    for (const i of members) boxIndexByBin[i] = paletteIndex
  })
  // 调色板两两距离 + 每行的候选顺序（按到该调色板色的距离升序；同距按下标升序）
  const n = palette.length
  const distMatrix = new Float64Array(n * n)
  const candidateRows = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dr = palette[i][0] - palette[j][0]
      const dg = palette[i][1] - palette[j][1]
      const db = palette[i][2] - palette[j][2]
      distMatrix[i * n + j] = dr * dr + dg * dg + db * db
    }
    const row = Array.from({ length: n }, (_, j) => j)
    row.sort((a, b) => (distMatrix[i * n + a] === distMatrix[i * n + b] ? a - b : distMatrix[i * n + a] - distMatrix[i * n + b]))
    candidateRows.push(row)
  }
  // 像素映射（Quant.c map_image_pixels_from_median_box）：
  //   先落在自己中位箱的颜色上，再在「到中位箱色的距离 ≤ 4×初始距离」的候选里找更近的；
  //   严格小于才替换 ⇒ 平局保留中位箱色。缓存每个箱的最终调色板下标。
  const finalIndexByBin = new Int32Array(bins.length).fill(-1)
  const distSq = (bin, c) => {
    const dr = bin.r - c[0]
    const dg = bin.g - c[1]
    const db = bin.b - c[2]
    return dr * dr + dg * dg + db * db
  }
  for (let bi = 0; bi < bins.length; bi++) {
    const box = boxIndexByBin[bi]
    const bin = bins[bi]
    // initialdist = 像素到自己中位箱的平均色距离；候选门槛 = 4×它
    const initial = distSq(bin, palette[box])
    let bestDist = initial
    let bestIndex = box
    const bound = initial * 4
    for (const candidate of candidateRows[box]) {
      // 候选顺序按「调色板色到中位箱色」的距离升序；超过 4×初始距离即停止
      if (distMatrix[box * n + candidate] > bound) break
      const dist = distSq(bin, palette[candidate])
      if (dist < bestDist) {
        bestDist = dist
        bestIndex = candidate
      }
    }
    finalIndexByBin[bi] = bestIndex
  }
  // 逐像素换色调色板色（等价 P 模式 → RGB）
  const paletteKeys = palette.map((c) => rgbKey(c[0], c[1], c[2]))
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 3
    const key = rgbKey(rgb[i], rgb[i + 1], rgb[i + 2])
    const binIndex = binOf.get(key)
    const c = keyToRgb(paletteKeys[finalIndexByBin[binIndex]])
    rgb[i] = c[0]
    rgb[i + 1] = c[1]
    rgb[i + 2] = c[2]
  }
  return { rgb, palette, bins: bins.length }
}

// ── 3. NEAREST 缩放（PIL NEAREST 口径：中心对齐取整，可逐像素复现参考图）────────
/**
 * 目标坐标 → 源坐标（PIL NEAREST：floor((dstCoord + 0.5) * srcSize / dstSize)）。
 * @param {number} dstCoord 目标下标
 * @param {number} dstSize 目标边长
 * @param {number} srcSize 源边长
 */
export function nearestIndex(dstCoord, dstSize, srcSize) {
  return Math.min(srcSize - 1, Math.floor(((dstCoord + 0.5) * srcSize) / dstSize))
}

/** 最近邻缩放的 RGB 平面。 */
export function resizeNearestRgb(rgb, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 3)
  const xs = new Int32Array(dstW)
  const ys = new Int32Array(dstH)
  for (let x = 0; x < dstW; x++) xs[x] = nearestIndex(x, dstW, srcW)
  for (let y = 0; y < dstH; y++) ys[y] = nearestIndex(y, dstH, srcH)
  for (let y = 0; y < dstH; y++) {
    const srcRow = ys[y] * srcW
    for (let x = 0; x < dstW; x++) {
      const si = (srcRow + xs[x]) * 3
      const di = (y * dstW + x) * 3
      out[di] = rgb[si]
      out[di + 1] = rgb[si + 1]
      out[di + 2] = rgb[si + 2]
    }
  }
  return out
}

/** 最近邻缩放的 alpha 平面（0..255）。 */
export function resizeNearestAlpha(image, dstW, dstH) {
  const { width, height, data } = image
  const out = new Uint8Array(dstW * dstH)
  const xs = new Int32Array(dstW)
  const ys = new Int32Array(dstH)
  for (let x = 0; x < dstW; x++) xs[x] = nearestIndex(x, dstW, width)
  for (let y = 0; y < dstH; y++) ys[y] = nearestIndex(y, dstH, height)
  for (let y = 0; y < dstH; y++) {
    const srcRow = ys[y] * width
    for (let x = 0; x < dstW; x++) out[y * dstW + x] = data[(srcRow + xs[x]) * 4 + 3]
  }
  return out
}

/**
 * 压缩路线默认目标尺寸（size 参数缺省时用）：
 *   · 雕像：宽 56（01 §4 基线），高按裁切后图标比例（296×480 → 56×91）；
 *   · 其它家具：长边 = round(SPAN[kind] × 108)，短边按图标比例。
 */
export function defaultTargetSize(kind, cropW, cropH) {
  const w = Math.max(1, cropW)
  const h = Math.max(1, cropH)
  if (kind === 'statue') {
    return [STATUE_BASELINE_WIDTH, Math.max(1, Math.round((STATUE_BASELINE_WIDTH * h) / w))]
  }
  const span = Object.hasOwn(SPAN, kind) ? SPAN[kind] : 0.836
  const longEdge = Math.max(1, Math.round(span * CELL_TEMPLATE_PX))
  if (w >= h) return [longEdge, Math.max(1, Math.round((longEdge * h) / w))]
  return [Math.max(1, Math.round((longEdge * w) / h)), longEdge]
}

// ── 4. 预处理：量化 → NEAREST → 洋红键控 ────────────────────────────────────
/**
 * 生成压缩工具的输入图（compress_statue.py 的 prep_image 等价）：
 *   RGBA 图标（已裁切）→ 调色板量化（全分辨率）→ NEAREST 缩放到目标尺寸
 *   → alpha>=128 保留量化色、否则洋红键控 (255,0,255)
 * @param {{width:number,height:number,data:Uint8Array}} image 已裁切的 RGBA
 * @param {{size:[number,number], quantize:number}} options
 * @returns {{ width:number, height:number, rgb:Uint8Array, foreground:Uint8Array, palette:number[][], size:[number,number] }}
 */
export function prepareCompressInput(image, options = {}) {
  const size = options.size
  if (!Array.isArray(size) || size.length !== 2) fail(CODES.SPEC, 'prepareCompressInput 需要 size: [w,h]', { size })
  const dstW = Math.max(1, Math.round(Number(size[0])))
  const dstH = Math.max(1, Math.round(Number(size[1])))
  const colors = options.quantize === undefined ? DEFAULT_QUANTIZE : options.quantize
  const quantized = quantizeMedianCut(image, colors)
  const scaled = resizeNearestRgb(quantized.rgb, image.width, image.height, dstW, dstH)
  const alpha = resizeNearestAlpha(image, dstW, dstH)
  const rgb = new Uint8Array(dstW * dstH * 3)
  const foreground = new Uint8Array(dstW * dstH)
  for (let p = 0; p < dstW * dstH; p++) {
    const i = p * 3
    if (alpha[p] >= ALPHA_KEY_THRESHOLD) {
      foreground[p] = 1
      rgb[i] = scaled[i]
      rgb[i + 1] = scaled[i + 1]
      rgb[i + 2] = scaled[i + 2]
    } else {
      rgb[i] = MAGENTA[0]
      rgb[i + 1] = MAGENTA[1]
      rgb[i + 2] = MAGENTA[2]
    }
  }
  return { width: dstW, height: dstH, rgb, foreground, palette: quantized.palette, size: [dstW, dstH] }
}

// ── 5. 动态 STD 容差图（compress.py build_tolmap）───────────────────────────
/** 由用户档位 std 推导动态 STD 六个参数（auto_dyn_params）。 */
export function autoDynParams(std, overrides = {}) {
  const s = Number(std)
  const pick = (key, fallback) => (overrides[key] === undefined || overrides[key] === null ? fallback : Number(overrides[key]))
  const t1 = pick('t1', 30)
  const t2 = pick('t2', 12)
  return {
    t1,
    t2,
    flat: pick('flat', t2),
    t1_std: pick('t1_std', s),
    t2_std: pick('t2_std', s * pick('m2', 2)),
    flat_std: pick('flat_std', s * pick('m3', 3)),
    r: Math.max(0, Math.floor(pick('r', 2))),
  }
}

/**
 * 逐像素容差图：局部梯度（水平/垂直亮度差取大）分三档，再做半径 r 的方框平滑。
 *   g > t1 → t1_std（细节区最严）；t2 < g ≤ t1 → t2_std；g ≤ flat → flat_std（平坦区最松）
 */
export function buildToleranceMap(rgb, width, height, params) {
  const n = width * height
  const lum = new Float64Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 3
    lum[p] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]
  }
  const gradient = new Float64Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      let g = 0
      if (x >= 1) {
        const d = Math.abs(lum[p] - lum[p - 1])
        if (d > g) g = d
      }
      if (y >= 1) {
        const d = Math.abs(lum[p] - lum[p - width])
        if (d > g) g = d
      }
      gradient[p] = g
    }
  }
  const r = Math.max(0, Math.floor(params.r))
  let smoothed = gradient
  if (r > 0) {
    // 方框平滑（积分图 O(1)/像素；边界按真实窗口大小归一）
    const stride = width + 1
    const prefix = new Float64Array((height + 1) * stride)
    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) {
        prefix[y * stride + x] = prefix[(y - 1) * stride + x] + gradient[(y - 1) * width + (x - 1)]
      }
    }
    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) prefix[y * stride + x] += prefix[y * stride + x - 1]
    }
    smoothed = new Float64Array(n)
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(height, y + r + 1)
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r)
        const x1 = Math.min(width, x + r + 1)
        const sum = prefix[y1 * stride + x1] - prefix[y0 * stride + x1] - prefix[y1 * stride + x0] + prefix[y0 * stride + x0]
        const count = (y1 - y0) * (x1 - x0)
        smoothed[y * width + x] = sum / Math.max(1, count)
      }
    }
  }
  const tolerance = new Float64Array(n)
  for (let p = 0; p < n; p++) {
    const g = smoothed[p]
    tolerance[p] = g > params.t1 ? params.t1_std : g > params.t2 ? params.t2_std : params.flat_std
  }
  return tolerance
}

// ── 6. 积分图：任意矩形均值/标准差 O(1)（compress.py Integrals）─────────────
function buildIntegrals(rgb, width, height) {
  const stride = width + 1
  const sum = [0, 1, 2].map(() => new Float64Array((height + 1) * stride))
  const sumSq = [0, 1, 2].map(() => new Float64Array((height + 1) * stride))
  const column = new Float64Array((height + 1) * stride)
  const columnSq = new Float64Array((height + 1) * stride)
  for (let ch = 0; ch < 3; ch++) {
    // 与 numpy `v.cumsum(0).cumsum(1)` 相同的累加顺序（float64），保证与参考实现逐位一致
    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) {
        const v = rgb[((y - 1) * width + (x - 1)) * 3 + ch]
        const row = y * stride + x
        column[row] = column[(y - 1) * stride + x] + v
        columnSq[row] = columnSq[(y - 1) * stride + x] + v * v
      }
    }
    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) {
        const row = y * stride + x
        sum[ch][row] = sum[ch][row - 1] + column[row]
        sumSq[ch][row] = sumSq[ch][row - 1] + columnSq[row]
      }
    }
  }
  const rect = (table, x, y, w, h) =>
    table[(y + h) * stride + (x + w)] - table[y * stride + (x + w)] - table[(y + h) * stride + x] + table[y * stride + x]
  return {
    width,
    height,
    /** 三通道标准差的最大值（compress.py Integrals.std）。 */
    std(x, y, w, h) {
      const count = w * h
      let maxStd = 0
      for (let ch = 0; ch < 3; ch++) {
        const s1 = rect(sum[ch], x, y, w, h)
        const s2 = rect(sumSq[ch], x, y, w, h)
        const mean = s1 / count
        const variance = s2 / count - mean * mean
        if (variance > 0) {
          const sd = Math.sqrt(variance)
          if (sd > maxStd) maxStd = sd
        }
      }
      return maxStd
    },
    /** 区域三通道均值（round 用 Python 口径）。 */
    mean(x, y, w, h) {
      const count = w * h
      return [0, 1, 2].map((ch) => pyRound(rect(sum[ch], x, y, w, h) / count))
    },
  }
}

// ── 7. 贪心最大对齐矩形合并（compress.py pack_rects_dyn，含局部优化）────────
/**
 * 把 RGB 图划分成互不重叠的轴对齐纯色矩形（块）。
 * @param {Uint8Array} rgb 目标尺寸 RGB
 * @param {number} width
 * @param {number} height
 * @param {{std:number, maxDim?:number}} options std=合并容差（0 = 只合并同色 → 无损）
 * @returns {Array<{x:number,y:number,w:number,h:number,r:number,g:number,b:number}>}
 */
export function packRectangles(rgb, width, height, options = {}) {
  const std = Number(options.std === undefined ? DEFAULT_STD : options.std)
  const maxDim = Math.min(MAX_BLOCK_DIM, Math.max(1, Math.floor(options.maxDim === undefined ? MAX_BLOCK_DIM : options.maxDim)))
  const dynamic = std > 0
  const params = autoDynParams(std, options.params || {})
  const tolerance = dynamic ? buildToleranceMap(rgb, width, height, params) : null
  const image = buildIntegrals(rgb, width, height)
  const used = new Uint8Array(width * height)
  const blocks = []
  const rowMinTolerance = (y, x, w) => {
    let min = Infinity
    for (let k = 0; k < w; k++) {
      const value = tolerance[y * width + x + k]
      if (value < min) min = value
    }
    return min
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (used[j * width + i]) continue
      const base = dynamic ? tolerance[j * width + i] : std
      // ① 向右扩宽：本行内标准差在容差内且未占用
      let w = 1
      let minTolerance = base
      while (i + w < width && !used[j * width + i + w] && w < maxDim) {
        const next = dynamic ? Math.min(minTolerance, tolerance[j * width + i + w]) : base
        if (image.std(i, j, w + 1, 1) > next) break
        minTolerance = next
        w += 1
      }
      // ② 向下扩高：颜色允许高度与占用允许高度取小
      let heightByColor = 1
      let minToleranceColor = minTolerance
      while (j + heightByColor < height && heightByColor < maxDim) {
        const next = dynamic ? Math.min(minToleranceColor, rowMinTolerance(j + heightByColor, i, w)) : base
        if (image.std(i, j, w, heightByColor + 1) > next) break
        minToleranceColor = next
        heightByColor += 1
      }
      let heightFree = 1
      while (j + heightFree < height && heightFree < maxDim) {
        let occupied = false
        for (let k = 0; k < w; k++) {
          if (used[(j + heightFree) * width + i + k]) {
            occupied = true
            break
          }
        }
        if (occupied) break
        heightFree += 1
      }
      let blockHeight = Math.min(heightByColor, heightFree)
      // ③ 局部优化：收窄宽度换更大高度（取面积最大者）
      let bestW = w
      let bestH = blockHeight
      let bestArea = w * blockHeight
      for (let w2 = w - 1; w2 >= 1; w2--) {
        const rowTolerance = dynamic ? rowMinTolerance(j, i, w2) : base
        let colorHeight = 1
        let tolerance2 = rowTolerance
        while (j + colorHeight < height && colorHeight < maxDim) {
          const next = dynamic ? Math.min(tolerance2, rowMinTolerance(j + colorHeight, i, w2)) : base
          if (image.std(i, j, w2, colorHeight + 1) > next) break
          tolerance2 = next
          colorHeight += 1
        }
        let freeHeight = 1
        while (j + freeHeight < height && freeHeight < maxDim) {
          let occupied = false
          for (let k = 0; k < w2; k++) {
            if (used[(j + freeHeight) * width + i + k]) {
              occupied = true
              break
            }
          }
          if (occupied) break
          freeHeight += 1
        }
        const candidateHeight = Math.min(colorHeight, freeHeight)
        if (w2 * candidateHeight > bestArea) {
          bestW = w2
          bestH = candidateHeight
          bestArea = w2 * candidateHeight
        }
      }
      for (let yy = j; yy < j + bestH; yy++) {
        for (let xx = i; xx < i + bestW; xx++) used[yy * width + xx] = 1
      }
      const [r, g, b] = image.mean(i, j, bestW, bestH)
      blocks.push({ x: i, y: j, w: bestW, h: bestH, r, g, b })
    }
  }
  return blocks
}

// ── 8. 几何自检 + MAE ───────────────────────────────────────────────────────
/**
 * 几何自检：空洞/重叠/越界必须都为 0（compress.py validate_blocks）。
 * @returns {{holes:number, overlaps:number, outOfBounds:number}}
 */
export function validateBlocks(blocks, width, height) {
  const cover = new Int32Array(width * height)
  let outOfBounds = 0
  for (const block of blocks) {
    if (
      block.x < 0 ||
      block.y < 0 ||
      block.x + block.w > width ||
      block.y + block.h > height ||
      block.w <= 0 ||
      block.h <= 0
    ) {
      outOfBounds++
      continue
    }
    for (let y = block.y; y < block.y + block.h; y++) {
      for (let x = block.x; x < block.x + block.w; x++) cover[y * width + x] += 1
    }
  }
  let holes = 0
  let overlaps = 0
  for (let i = 0; i < cover.length; i++) {
    if (cover[i] === 0) holes++
    else if (cover[i] > 1) overlaps++
  }
  return { holes, overlaps, outOfBounds }
}

/**
 * 重建误差（MAE，每通道 0..255，与 compress.py 口径一致）：
 *   maeAll = 全图；mae = 只统计前景（foreground=1，即 alpha>=128）像素。
 * @param {Array} blocks
 * @param {{width:number,height:number,rgb:Uint8Array,foreground:Uint8Array}} prepared
 */
export function computeMae(blocks, prepared) {
  const { width, height, rgb, foreground } = prepared
  const reconstructed = new Uint8Array(width * height * 3)
  for (const block of blocks) {
    for (let y = block.y; y < block.y + block.h; y++) {
      for (let x = block.x; x < block.x + block.w; x++) {
        const i = (y * width + x) * 3
        reconstructed[i] = block.r
        reconstructed[i + 1] = block.g
        reconstructed[i + 2] = block.b
      }
    }
  }
  let sumAll = 0
  let sumForeground = 0
  let foregroundPixels = 0
  for (let p = 0; p < width * height; p++) {
    const i = p * 3
    const diff =
      (Math.abs(rgb[i] - reconstructed[i]) +
        Math.abs(rgb[i + 1] - reconstructed[i + 1]) +
        Math.abs(rgb[i + 2] - reconstructed[i + 2])) /
      3
    sumAll += diff
    if (foreground[p]) {
      sumForeground += diff
      foregroundPixels++
    }
  }
  return {
    mae: foregroundPixels > 0 ? sumForeground / foregroundPixels : 0,
    maeAll: sumAll / (width * height),
    foregroundPixels,
  }
}

// ── 9. blockcodec.py 的块编码/扫描顺序（自检、调试用；写入器用不到 x,y 编码）───
/**
 * 块列表 → hex 字符串（每块 10 字符 = w,h,r,g,b 各 1 字节，blockcodec.pack_hex）。
 * @param {Array} blocks
 */
export function packHex(blocks) {
  const chunks = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.w > 255 || block.h > 255) {
      fail(CODES.SPEC, `块尺寸超过 255，单字节编码装不下：第 ${i} 块 w=${block.w} h=${block.h}`, { index: i })
    }
    chunks.push(hex2(block.w) + hex2(block.h) + hex2(block.r) + hex2(block.g) + hex2(block.b))
  }
  return chunks.join('')
}

/** hex 块数据 → [{w,h,color}]（blockcodec.pack_hex 的逆；不含 x,y）。 */
export function unpackHex(hex) {
  if (typeof hex !== 'string' || hex.length % 10 !== 0) {
    fail(CODES.SPEC, '块 hex 数据长度必须是 10 的倍数', { length: typeof hex === 'string' ? hex.length : null })
  }
  const blocks = []
  for (let i = 0; i < hex.length; i += 10) {
    const chunk = hex.slice(i, i + 10)
    const w = parseInt(chunk.slice(0, 2), 16)
    const h = parseInt(chunk.slice(2, 4), 16)
    const color = (parseInt(chunk.slice(4, 6), 16) << 16) | (parseInt(chunk.slice(6, 8), 16) << 8) | parseInt(chunk.slice(8, 10), 16)
    blocks.push({ w, h, color })
  }
  return blocks
}

/**
 * 按「扫描顺序」推演每块 (x,y)（blockcodec.replay_positions）。
 * 渲染端没有存 x,y，靠这个约定还原；本插件保留 x,y，但自检时用来验证块顺序可推演。
 * @param {Array<{w:number,h:number}>} blocks
 * @param {number} width 图宽（列数）
 */
export function replayPositions(blocks, width) {
  const occupied = new Array(width).fill(-1)
  let ci = 0
  let cj = 0
  const positions = []
  for (const block of blocks) {
    for (;;) {
      while (ci < width && occupied[ci] >= cj) ci++
      if (ci < width) break
      cj += 1
      ci = 0
    }
    positions.push([ci, cj])
    const last = cj + block.h - 1
    for (let xx = ci; xx < Math.min(width, ci + block.w); xx++) {
      if (occupied[xx] < last) occupied[xx] = last
    }
    ci += block.w
  }
  return positions
}

/** 校验「扫描顺序可推演 x,y」：返回与存储坐标不一致的块数（应为 0）。 */
export function checkScanOrder(blocks, width) {
  const positions = replayPositions(blocks, width)
  let bad = 0
  for (let i = 0; i < blocks.length; i++) {
    if (positions[i][0] !== blocks[i].x || positions[i][1] !== blocks[i].y) bad++
  }
  return bad
}

// ── 10. 一步到位：compressImage(image, { size, quantize, std }) ───────────────
/**
 * 参考图 RGBA → 压缩块（含自检数据）。
 * @param {{width:number,height:number,data:Uint8Array}} image PNG 解码后的 RGBA
 * @param {{size?:[number,number], quantize?:number, std?:number, kind?:string, crop?:boolean}} options
 * @returns {{ width:number, height:number, blocks:Array, stats:object }}
 */
export function compressImage(image, options = {}) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data) {
    fail(CODES.SPEC, 'compressImage 需要 { width, height, data } 的 RGBA 图', { image: typeof image })
  }
  const quantize = options.quantize === undefined ? DEFAULT_QUANTIZE : options.quantize
  if (!Number.isInteger(quantize) || quantize < 1 || quantize > 256) {
    fail(CODES.ARGS, 'quantize 必须是 1..256 的整数', { quantize: options.quantize })
  }
  const std = options.std === undefined ? DEFAULT_STD : Number(options.std)
  if (!Number.isFinite(std) || std < 0 || std > 1024) fail(CODES.ARGS, 'std 必须是 0..1024 的数值', { std: options.std })

  // 裁掉四周空白：压缩坐标以裁切后图为准（compress_statue.py 的 getbbox）
  const cropped = options.crop === false ? { image, box: { x: 0, y: 0, w: image.width, h: image.height } } : cropAlphaContent(image)
  const box = cropped.box
  let size = options.size
  if (size === undefined || size === null) size = defaultTargetSize(options.kind || '', box.w, box.h)
  if (!Array.isArray(size) || size.length !== 2) fail(CODES.ARGS, 'size 必须是 [w,h]', { size })
  const targetW = Math.max(1, Math.round(Number(size[0])))
  const targetH = Math.max(1, Math.round(Number(size[1])))

  const prepared = prepareCompressInput(cropped.image, { size: [targetW, targetH], quantize })
  const blocks = packRectangles(prepared.rgb, targetW, targetH, { std })
  const geometry = validateBlocks(blocks, targetW, targetH)
  const error = computeMae(blocks, prepared)
  const colors = new Set(blocks.map((b) => rgbKey(b.r, b.g, b.b))).size
  return {
    width: targetW,
    height: targetH,
    blocks,
    stats: {
      ...geometry,
      mae: error.mae, // 前景（alpha>=128）MAE，0..255 每通道
      maeAll: error.maeAll,
      foregroundPixels: error.foregroundPixels,
      colors,
      paletteColors: prepared.palette.length,
      maxBlockW: blocks.reduce((m, b) => Math.max(m, b.w), 0),
      maxBlockH: blocks.reduce((m, b) => Math.max(m, b.h), 0),
      size: [targetW, targetH],
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
    },
  }
}
