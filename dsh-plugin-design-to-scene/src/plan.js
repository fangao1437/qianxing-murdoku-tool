// S1 网格平面设计图解析库：PNG 像素网格 → 房间 / 墙 / 门 / 家具 → SceneSpec v1 部件。
//
// 输入契约唯一事实源：examples/DESIGN-FORMAT.md。本模块只做「确定性解析」，不写文件：
//   · normalizePlanLegend(raw, overrides)   图例规范化（颜色映射 / 默认值 / 工具参数覆盖）
//   · resolvePlanGrid(image, cfg)           PNG 尺寸 ↔ 网格参数（校验或推断 rows/cols）
//   · analyzePlanImage(image, cfg, opts)    主入口：格中心分类 → 房间/墙/门/家具 → SceneSpec
//   · renderPlanPreview(spec, opts)         俯视预览 PNG（与解析共用一套 Canvas，不依赖 S2）
//
// 约定摘要（逐条对应 DESIGN-FORMAT.md）：
//   · 图左上角为原点，x 向右、z 向下；格坐标 1 基 (r,c)（r 行、c 列）；
//   · 格中心像素色 → roomColors / objectColors / voidColor；同色 4 邻接 = 房间，
//     家具格参与房间连通（按四周房间格多数票继承填充色）；
//   · 墙/门 = 每条格边的 5px 采样带里 wallColor / doorColor 像素占比 ≥ 阈值（默认 0.6）；
//     2px 网格线占比 2/5 = 0.4 < 0.6，不会被误判成墙（墙线约定 ≥ 3px 粗）；
//   · 像素 → 米：物件中心 x=(c-1+0.5)*m、z=(r-1+0.5)*m；墙用格线交点；
//     bounds = cols*m × rows*m；grid = { cell:m, rows, cols }；
//   · 未分类颜色不静默吞：进 warnings（颜色 + 格数 + 首格位置）与 stats.unassigned。
import { CODES, fail } from './errors.js'
import { KIND_DEFAULTS, normalizeHexColor } from './scene-spec.js'
import { Canvas, hexToRgb } from './lib/png-write.js'

/** 设计图约定里的默认值（DESIGN-FORMAT.md §1/§3/§4）。 */
export const PLAN_DEFAULTS = Object.freeze({
  cellPx: 48, // 每格像素
  margin: 24, // 图边距像素
  metersPerCell: 0.5, // 1 格 = 多少米
  wallColor: '#1F1A14', // 墙色（与网格线同色，靠粗细区分）
  doorColor: '#C06A1E', // 门色
  voidColor: '#FFFFFF', // 空白/不可用
  wallThreshold: 0.6, // 格边采样带里 wallColor/doorColor 占比阈值
  objectRatio: 0.7, // 家具色块默认占格宽比例（sizeCells 可覆盖）
  wallHeight: 2.8, // 墙高（米，SceneSpec wall.height 默认）
  wallThickness: 0.15, // 墙厚（米，SceneSpec wall.thickness 默认）
  doorOpening: Object.freeze({ u: 0.5, width: 0.9, height: 2.1, kind: 'door' }),
  // 采样带：垂直于格边 ±2px（共 5px）；沿边只取中点 ±20%（去掉两端交点处的串色）
  sampleBandHalf: 2,
  sampleSpanStart: 0.2,
  sampleSpanEnd: 0.8,
})

/** 解析器口径版本（供外部排障引用；改动检测规则时递增）。 */
export const PLAN_PARSER_VERSION = 1

function round3(value) {
  const r = Math.round(value * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** "#RRGGBB" / 0xRRGGBB / "#RGB" → 规范大写 "#RRGGBB"；非法抛 E_ARGS。 */
function colorOf(value, label) {
  const color = normalizeHexColor(value)
  if (!color) fail(CODES.ARGS, `${label} 不是合法颜色：${JSON.stringify(value)}（需要 "#RRGGBB"）`, { label, value })
  return color
}

function isRgbaHexChannel(hex) {
  return typeof hex === 'string' && /^#[0-9A-F]{6}$/.test(hex)
}

// ── 图例规范化 ───────────────────────────────────────────────────────────────

/**
 * 取一个数值参数：工具参数覆盖 > legend > 默认值。非法值直接抛 E_ARGS（不静默降级）。
 * rows/cols 允许 null（表示"从图尺寸推断"，由 resolvePlanGrid 完成）。
 */
function pickGridValue(overrides, raw, key, fallback, label, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const sources = [
    [`工具参数 ${key}`, overrides?.[key]],
    [`legend.${key}`, raw?.[key]],
  ]
  for (const [source, value] of sources) {
    if (value === undefined || value === null) continue
    if (integer) {
      if (!Number.isInteger(value) || value < min || value > max) {
        fail(CODES.ARGS, `${source} 必须是 ${min}..${max} 的整数（实际 ${JSON.stringify(value)}）`, { source, value, min, max })
      }
      return value
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      fail(CODES.ARGS, `${source} 必须是 ${min}..${max} 之间的数字（实际 ${JSON.stringify(value)}）`, { source, value, min, max })
    }
    return value
  }
  return fallback
}

/**
 * 规范化 legend（图例）：补默认值、颜色统一大写、校验结构，并应用工具参数覆盖。
 *
 * legend（DESIGN-FORMAT.md §1）：
 *   { cellPx, margin, rows, cols, metersPerCell,
 *     roomColors:   { "#RRGGBB": { name, color? } },
 *     objectColors: { "#RRGGBB": { kind, color?, sizeCells?, heightM? } },
 *     wallColor, doorColor, voidColor,
 *     name? }                                    // name 是插件扩展：场景名，缺省用图文件名
 * 工具参数 rows/cols/cellPx/margin/metersPerCell 优先于 legend 里的同名字段。
 *
 * @returns {object} cfg：{ name, rows, cols, cellPx, margin, metersPerCell,
 *                          roomColors:Map<hex,{name,color}>, objectColors:Map<hex,{kind,color,sizeCells,heightM}>,
 *                          wallColor, doorColor, voidColor, wallThreshold }
 */
export function normalizePlanLegend(raw, overrides = {}) {
  if (!isPlainObject(raw)) {
    fail(
      CODES.ARGS,
      'legend 必须是 JSON 对象（或 JSON 文件路径）：{ cellPx, margin, rows, cols, metersPerCell, roomColors, objectColors, wallColor, doorColor, voidColor }',
      { type: Array.isArray(raw) ? 'array' : typeof raw },
    )
  }

  const cellPx = pickGridValue(overrides, raw, 'cellPx', PLAN_DEFAULTS.cellPx, 'cellPx', { integer: true, min: 8, max: 1024 })
  const margin = pickGridValue(overrides, raw, 'margin', PLAN_DEFAULTS.margin, 'margin', { integer: true, min: 0, max: 1024 })
  const metersPerCell = pickGridValue(overrides, raw, 'metersPerCell', PLAN_DEFAULTS.metersPerCell, 'metersPerCell', {
    min: 1e-6,
    max: 100,
  })
  // rows/cols 可以缺省：缺省时从 PNG 尺寸除以 cellPx 推断（见 resolvePlanGrid）
  const rows = pickGridValue(overrides, raw, 'rows', null, 'rows', { integer: true, min: 1, max: 512 })
  const cols = pickGridValue(overrides, raw, 'cols', null, 'cols', { integer: true, min: 1, max: 512 })

  const wallColor = raw.wallColor === undefined || raw.wallColor === null ? PLAN_DEFAULTS.wallColor : colorOf(raw.wallColor, 'legend.wallColor')
  const doorColor = raw.doorColor === undefined || raw.doorColor === null ? PLAN_DEFAULTS.doorColor : colorOf(raw.doorColor, 'legend.doorColor')
  const voidColor = raw.voidColor === undefined || raw.voidColor === null ? PLAN_DEFAULTS.voidColor : colorOf(raw.voidColor, 'legend.voidColor')
  if (wallColor === doorColor) fail(CODES.ARGS, 'legend.wallColor 与 legend.doorColor 不能相同（无法区分墙和门）', { wallColor, doorColor })

  // 房间颜色表：颜色 → 房间名（同名房间在解析阶段合并）
  if (!isPlainObject(raw.roomColors) || Object.keys(raw.roomColors).length === 0) {
    fail(CODES.ARGS, 'legend.roomColors 必须是非空对象：{ "#RRGGBB": { name, color? } }', { roomColors: raw.roomColors })
  }
  const roomColors = new Map()
  for (const [key, entry] of Object.entries(raw.roomColors)) {
    const color = colorOf(key, 'legend.roomColors 的颜色键')
    if (roomColors.has(color)) fail(CODES.ARGS, `legend.roomColors 颜色重复：${color}`, { color })
    if (!isPlainObject(entry)) fail(CODES.ARGS, `legend.roomColors["${key}"] 必须是对象：{ name, color? }`, { color })
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      fail(CODES.ARGS, `legend.roomColors["${key}"].name 必填（房间名）`, { color })
    }
    const overrideColor = entry.color === undefined || entry.color === null ? null : colorOf(entry.color, `legend.roomColors["${key}"].color`)
    roomColors.set(color, { name: entry.name.trim(), color: overrideColor })
  }

  // 家具颜色表：颜色 → { kind, color?, sizeCells?, heightM? }
  const objectColors = new Map()
  if (raw.objectColors !== undefined && raw.objectColors !== null) {
    if (!isPlainObject(raw.objectColors)) fail(CODES.ARGS, 'legend.objectColors 必须是对象：{ "#RRGGBB": { kind, ... } }', { objectColors: raw.objectColors })
    for (const [key, entry] of Object.entries(raw.objectColors)) {
      const color = colorOf(key, 'legend.objectColors 的颜色键')
      if (roomColors.has(color)) {
        fail(CODES.ARGS, `颜色 ${color} 同时出现在 roomColors 和 objectColors（格中心色会二义）`, { color })
      }
      if (objectColors.has(color)) fail(CODES.ARGS, `legend.objectColors 颜色重复：${color}`, { color })
      if (!isPlainObject(entry)) fail(CODES.ARGS, `legend.objectColors["${key}"] 必须是对象：{ kind, color?, sizeCells?, heightM? }`, { color })
      const kind = typeof entry.kind === 'string' ? entry.kind.trim() : ''
      if (!kind) fail(CODES.ARGS, `legend.objectColors["${key}"].kind 必填（如 table/chair/plant/rug/...）`, { color })
      let sizeCells = null
      if (entry.sizeCells !== undefined && entry.sizeCells !== null) {
        if (typeof entry.sizeCells !== 'number' || !Number.isFinite(entry.sizeCells) || entry.sizeCells <= 0 || entry.sizeCells > 4) {
          fail(CODES.ARGS, `legend.objectColors["${key}"].sizeCells 必须是 (0, 4] 之间的数字（占格宽比例）`, { color, sizeCells: entry.sizeCells })
        }
        sizeCells = entry.sizeCells
      }
      let heightM = null
      if (entry.heightM !== undefined && entry.heightM !== null) {
        if (typeof entry.heightM !== 'number' || !Number.isFinite(entry.heightM) || entry.heightM <= 0 || entry.heightM > 100) {
          fail(CODES.ARGS, `legend.objectColors["${key}"].heightM 必须是 (0, 100] 之间的数字（米）`, { color, heightM: entry.heightM })
        }
        heightM = entry.heightM
      }
      const overrideColor = entry.color === undefined || entry.color === null ? null : colorOf(entry.color, `legend.objectColors["${key}"].color`)
      objectColors.set(color, { kind, color: overrideColor, sizeCells, heightM })
    }
  }

  // 墙/门颜色不能和房间/家具颜色撞（否则采样带会把填充色误判成墙）
  for (const color of roomColors.keys()) {
    if (color === wallColor) fail(CODES.ARGS, `roomColors 里的 ${color} 与 wallColor 相同：墙采样会把房间填充色误判为墙`, { color })
    if (color === doorColor) fail(CODES.ARGS, `roomColors 里的 ${color} 与 doorColor 相同：门采样会把房间填充色误判为门`, { color })
  }
  for (const color of objectColors.keys()) {
    if (color === wallColor) fail(CODES.ARGS, `objectColors 里的 ${color} 与 wallColor 相同：墙采样会把家具色误判为墙`, { color })
    if (color === doorColor) fail(CODES.ARGS, `objectColors 里的 ${color} 与 doorColor 相同：门采样会把家具色误判为门`, { color })
  }

  const wallThreshold =
    raw.wallThreshold === undefined || raw.wallThreshold === null
      ? PLAN_DEFAULTS.wallThreshold
      : pickGridValue(overrides, raw, 'wallThreshold', PLAN_DEFAULTS.wallThreshold, 'wallThreshold', { min: 0.3, max: 1 })

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '',
    rows,
    cols,
    cellPx,
    margin,
    metersPerCell,
    roomColors,
    objectColors,
    wallColor,
    doorColor,
    voidColor,
    wallThreshold,
  }
}

// ── 网格与像素取样 ───────────────────────────────────────────────────────────

/**
 * 用 PNG 尺寸校验/推断网格参数：
 *   width  = cols*cellPx + 2*margin；height = rows*cellPx + 2*margin（DESIGN-FORMAT.md §1）。
 * legend 没给 rows/cols 时按上式反推；给了就严格校验，尺寸不符抛 E_SPEC_INVALID。
 * @returns {{ rows:number, cols:number }}
 */
export function resolvePlanGrid(image, cfg) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    fail(CODES.SPEC, '解码后的图像无效（缺少 width/height）', { width: image?.width, height: image?.height })
  }
  const { cellPx, margin } = cfg
  const usableWidth = image.width - margin * 2
  const usableHeight = image.height - margin * 2
  if (usableWidth <= 0 || usableHeight <= 0) {
    fail(CODES.SPEC, `设计图太小：${image.width}×${image.height}，装不下 margin=${margin} 的边距`, { width: image.width, height: image.height, margin })
  }
  const infer = (usable, label) => {
    const count = usable / cellPx
    if (!Number.isInteger(count) || count <= 0) {
      fail(
        CODES.SPEC,
        `设计图${label}尺寸与网格不匹配：可用像素 ${usable} 不是 cellPx=${cellPx} 的整数倍（图 ${image.width}×${image.height}，margin=${margin}）`,
        { width: image.width, height: image.height, margin, cellPx },
      )
    }
    return count
  }
  const cols = cfg.cols ?? infer(usableWidth, '横向')
  const rows = cfg.rows ?? infer(usableHeight, '纵向')
  const expectWidth = margin * 2 + cols * cellPx
  const expectHeight = margin * 2 + rows * cellPx
  if (image.width !== expectWidth || image.height !== expectHeight) {
    fail(
      CODES.SPEC,
      `设计图尺寸 ${image.width}×${image.height} 与图例不符：期望 ${expectWidth}×${expectHeight}` +
        `（cols=${cols}, rows=${rows}, cellPx=${cellPx}, margin=${margin}）`,
      { width: image.width, height: image.height, expectWidth, expectHeight, cols, rows, cellPx, margin },
    )
  }
  return { rows, cols }
}

/** 取像素的 "#RRGGBB"（忽略 alpha：设计图约定为不透明平涂）。 */
function pixelHex(image, x, y) {
  const i = (y * image.width + x) * 4
  const d = image.data
  return (
    '#' +
    d[i].toString(16).padStart(2, '0').toUpperCase() +
    d[i + 1].toString(16).padStart(2, '0').toUpperCase() +
    d[i + 2].toString(16).padStart(2, '0').toUpperCase()
  )
}

/** 格 (r,c)（0 基）中心像素坐标：中心取格内 floor(cellPx/2)，避开网格线。 */
function cellCenterPixel(margin, cellPx, r, c) {
  return {
    x: margin + c * cellPx + (cellPx >> 1),
    y: margin + r * cellPx + (cellPx >> 1),
  }
}

/**
 * 格分类：遍历 rows×cols，用「格中心像素色」判定 room / object / void / unknown。
 * @returns {{ cells: object[], unassigned: Map<string,{count:number,firstRow:number,firstCol:number}>, unknownCount:number, warnings:string[] }}
 */
export function classifyPlanCells(image, cfg, rows, cols) {
  const { margin, cellPx, roomColors, objectColors, voidColor } = cfg
  const cells = new Array(rows * cols)
  const unassigned = new Map()
  const warnings = []
  let unknownCount = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, y } = cellCenterPixel(margin, cellPx, r, c)
      const color = pixelHex(image, x, y)
      let type = 'unknown'
      let entry = null
      if (roomColors.has(color)) type = 'room'
      else if (objectColors.has(color)) {
        type = 'object'
        entry = objectColors.get(color)
      } else if (color === voidColor) type = 'void'
      else {
        unknownCount++
        const rec = unassigned.get(color)
        if (rec) rec.count++
        else unassigned.set(color, { count: 1, firstRow: r + 1, firstCol: c + 1 })
      }
      cells[r * cols + c] = {
        r,
        c,
        color,
        type,
        entry,
        roomColor: type === 'room' ? color : null, // 家具格由 BFS 继承房间填充色
      }
    }
  }
  for (const [color, rec] of unassigned) {
    warnings.push(
      `未分类颜色 ${color}：${rec.count} 格（首格 r${rec.firstRow},c${rec.firstCol}）—— 这些格不计入任何房间/物件，请在 legend 里补映射`,
    )
  }
  return { cells, unassigned, unknownCount, warnings }
}

// ── 并查集（房间连通 / 家具 4 邻接合并）──────────────────────────────────────

class UnionFind {
  constructor(size) {
    this.parent = new Int32Array(size)
    for (let i = 0; i < size; i++) this.parent[i] = i
  }

  find(x) {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[x] !== root) {
      const next = this.parent[x]
      this.parent[x] = root
      x = next
    }
    return root
  }

  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // 小根挂大根，保持确定性（结果与合并顺序无关）
    if (ra < rb) this.parent[rb] = ra
    else this.parent[ra] = rb
  }
}

/** 格的「房间键」：房间格 = 填充色；家具格 = 继承到的房间填充色；其它 = null（不连通）。 */
function roomKeyOf(cell) {
  if (cell.type === 'room') return cell.color
  if (cell.type === 'object') return cell.roomColor
  return null
}

const NEIGHBOR_OFFSETS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
])

/**
 * 家具格 → 所在房间：先按「同色 4 邻接」聚成家具簇，再按簇四周接触到的房间填充色做
 * 多数投票（接触的格边数最多者）决定归属；家具格参与房间连通（DESIGN-FORMAT.md §2），
 * 这样家具把房间填色切开也不会裂成两个房间。平票时按颜色字符串取最小（确定性），
 * 且只在同色房间内连通，不会把两个不同房间错误合并。
 */
function assignFurnitureRoomColors(cells, rows, cols) {
  const objectIndices = []
  for (let index = 0; index < cells.length; index++) if (cells[index].type === 'object') objectIndices.push(index)
  if (objectIndices.length === 0) return

  // 1) 同色 4 邻接聚簇
  const uf = new UnionFind(cells.length)
  for (const index of objectIndices) {
    const cell = cells[index]
    if (cell.c + 1 < cols) {
      const right = cells[index + 1]
      if (right.type === 'object' && right.color === cell.color) uf.union(index, index + 1)
    }
    if (cell.r + 1 < rows) {
      const down = cells[index + cols]
      if (down.type === 'object' && down.color === cell.color) uf.union(index, index + cols)
    }
  }

  // 2) 每簇统计四周房间格接触数 → 多数票归属
  const clusters = new Map() // root → { cells:number[], tally:Map<roomColor,count> }
  for (const index of objectIndices) {
    const root = uf.find(index)
    let cluster = clusters.get(root)
    if (!cluster) {
      cluster = { cells: [], tally: new Map() }
      clusters.set(root, cluster)
    }
    cluster.cells.push(index)
  }
  for (const cluster of clusters.values()) {
    for (const index of cluster.cells) {
      const cell = cells[index]
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = cell.r + dr
        const nc = cell.c + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        const neighbor = cells[nr * cols + nc]
        if (neighbor.type !== 'room') continue
        cluster.tally.set(neighbor.color, (cluster.tally.get(neighbor.color) ?? 0) + 1)
      }
    }
    let best = null
    for (const [color, count] of cluster.tally) {
      if (best === null || count > best.count || (count === best.count && color < best.color)) best = { color, count }
    }
    for (const index of cluster.cells) cells[index].roomColor = best ? best.color : null
  }
}

/**
 * 房间检测：同色房间格 4 邻接 + 家具格参与连通 → 连通块；再按房间名合并同名房间。
 * @returns {{ rooms: object[], warnings: string[] }}
 */
export function detectPlanRooms(cells, cfg, rows, cols) {
  const warnings = []
  assignFurnitureRoomColors(cells, rows, cols)

  const uf = new UnionFind(cells.length)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      const key = roomKeyOf(cells[index])
      if (key === null) continue
      if (c + 1 < cols && roomKeyOf(cells[index + 1]) === key) uf.union(index, index + 1)
      if (r + 1 < rows && roomKeyOf(cells[index + cols]) === key) uf.union(index, index + cols)
    }
  }

  // 连通块 → 房间草稿（cells 用 1 基(row,col)，按行主序保证确定性）
  const components = new Map() // root → { color, cells: [[r,c],...] }
  const unresolvedFurniture = new Map() // 未继承到房间的家具格（颜色 → 首格）
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    const key = roomKeyOf(cell)
    if (key === null) {
      if (cell.type === 'object') {
        const rec = unresolvedFurniture.get(cell.color)
        if (!rec) unresolvedFurniture.set(cell.color, { r: cell.r + 1, c: cell.c + 1 })
      }
      continue
    }
    const root = uf.find(index)
    let component = components.get(root)
    if (!component) {
      component = { color: key, cells: [] }
      components.set(root, component)
    }
    component.cells.push([cell.r + 1, cell.c + 1])
  }
  for (const [color, pos] of unresolvedFurniture) {
    warnings.push(`家具格不属于任何房间：颜色 ${color} 首格 r${pos.r},c${pos.c}（该家具仍会生成物件，但不计入房间）`)
  }

  // 房间名来自图例；同名房间合并（DESIGN-FORMAT.md §2）
  const byName = new Map() // name → { name, color, cells }
  for (const component of components.values()) {
    const legendEntry = cfg.roomColors.get(component.color)
    if (!legendEntry) {
      // 理论上不会发生（分类时命中 roomColors 才会进这里），防御性报错而非静默丢弃
      fail(CODES.INTERNAL, `房间填充色 ${component.color} 不在 legend.roomColors 里`, { color: component.color })
    }
    const name = legendEntry.name
    const existing = byName.get(name)
    if (!existing) {
      byName.set(name, { name, color: component.color, cells: component.cells })
      continue
    }
    if (existing.color !== component.color) {
      warnings.push(`同名房间「${name}」出现在多种填充色（${existing.color} / ${component.color}），已按房间名合并；建议 legend 里给它们不同的 name`)
    }
    existing.cells.push(...component.cells)
  }

  const rooms = []
  for (const room of byName.values()) {
    room.cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const legendEntry = cfg.roomColors.get(room.color)
    rooms.push({
      id: '', // 排序后统一分配 r1..rN
      name: room.name,
      color: legendEntry.color ?? room.color, // legend 的可选 color 覆盖设计图填充色
      cells: room.cells,
    })
  }
  rooms.sort((a, b) => a.cells[0][0] - b.cells[0][0] || a.cells[0][1] - b.cells[0][1] || a.name.localeCompare(b.name))
  rooms.forEach((room, i) => {
    room.id = `r${i + 1}`
  })
  return { rooms, warnings }
}

/**
 * 家具检测：同色 4 邻接的家具格合并为一个物件；尺寸/颜色按 legend + KIND_DEFAULTS。
 *   size[0] = 横跨格数 * metersPerCell * sizeCells(默认 0.7)
 *   size[2] = 纵跨格数 * metersPerCell * sizeCells
 *   size[1] = legend.heightM ?? KIND_DEFAULTS[kind].size[1]
 *   pos     = 合并后包围盒中心（格中心米坐标），y=0（底面中心）
 * @returns {{ objects: object[], warnings: string[] }}
 */
export function detectPlanObjects(cells, cfg, rows, cols) {
  const warnings = []
  const uf = new UnionFind(cells.length)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      const cell = cells[index]
      if (cell.type !== 'object') continue
      // 合并条件：同色（= 同一 legend 条目）+ 4 邻接（DESIGN-FORMAT.md §4）
      if (c + 1 < cols) {
        const right = cells[index + 1]
        if (right.type === 'object' && right.color === cell.color) uf.union(index, index + 1)
      }
      if (r + 1 < rows) {
        const down = cells[index + cols]
        if (down.type === 'object' && down.color === cell.color) uf.union(index, index + cols)
      }
    }
  }

  const components = new Map() // root → { color, entry, indices: [] }
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    if (cell.type !== 'object') continue
    const root = uf.find(index)
    let component = components.get(root)
    if (!component) {
      component = { color: cell.color, entry: cell.entry, indices: [] }
      components.set(root, component)
    }
    component.indices.push(index)
  }

  const drafts = []
  for (const component of components.values()) {
    const { entry } = component
    const rawKind = entry.kind
    const kindKnown = Object.hasOwn(KIND_DEFAULTS, rawKind)
    if (!kindKnown) warnings.push(`家具 kind 未知：${rawKind}（颜色 ${component.color}）→ 按 custom 处理；合法 kind 见 src/scene-spec.js`)
    const kind = kindKnown ? rawKind : 'custom'

    let minR = Infinity
    let maxR = -Infinity
    let minC = Infinity
    let maxC = -Infinity
    for (const index of component.indices) {
      const cell = cells[index]
      if (cell.r < minR) minR = cell.r
      if (cell.r > maxR) maxR = cell.r
      if (cell.c < minC) minC = cell.c
      if (cell.c > maxC) maxC = cell.c
    }
    const spanR = maxR - minR + 1
    const spanC = maxC - minC + 1
    if (spanR * spanC !== component.indices.length) {
      warnings.push(
        `家具 footprint 不是矩形：kind=${kind}（颜色 ${component.color}）占 ${component.indices.length} 格，` +
          `包围盒 ${spanR}×${spanC}；尺寸按包围盒估算`,
      )
    }
    const ratio = entry.sizeCells ?? PLAN_DEFAULTS.objectRatio
    const meters = cfg.metersPerCell
    const kindDefaults = KIND_DEFAULTS[kind]
    const size = [
      round3(spanC * meters * ratio),
      round3(entry.heightM ?? kindDefaults.size[1]),
      round3(spanR * meters * ratio),
    ]
    const pos = [round3((minC + spanC / 2) * meters), 0, round3((minR + spanR / 2) * meters)]
    const color = entry.color ?? kindDefaults.color
    drafts.push({ minR, minC, kind, size, pos, color, rotYDeg: 0 })
  }

  drafts.sort((a, b) => a.minR - b.minR || a.minC - b.minC)
  const objects = drafts.map((draft, i) => ({
    id: `o${i + 1}`,
    kind: draft.kind,
    pos: draft.pos,
    rotYDeg: draft.rotYDeg,
    size: draft.size,
    color: draft.color,
    asset: null,
    tags: [],
  }))
  return { objects, warnings }
}

/**
 * 墙/门采样：格边中点的 5px 采样带内统计 wallColor / doorColor 像素占比。
 * 水平边（格 (r-1,c) 与 (r,c) 之间）→ orientation='h'，line=水平格线号，index=列号；
 * 垂直边 → orientation='v'，line=垂直格线号，index=行号（均为 0 基格线）。
 */
function sampleEdgeRatio(image, cfg, orientation, line, index) {
  const { cellPx, margin, wallColor, doorColor, wallThreshold } = cfg
  const wallRgb = hexToRgb(wallColor)
  const doorRgb = hexToRgb(doorColor)
  const boundary = margin + line * cellPx
  const edgeStart = margin + index * cellPx
  const alongStart = edgeStart + Math.floor(cellPx * PLAN_DEFAULTS.sampleSpanStart)
  const alongEnd = edgeStart + Math.ceil(cellPx * PLAN_DEFAULTS.sampleSpanEnd) - 1
  const half = PLAN_DEFAULTS.sampleBandHalf
  let total = 0
  let wall = 0
  let door = 0
  for (let along = alongStart; along <= alongEnd; along++) {
    for (let offset = -half; offset <= half; offset++) {
      const x = orientation === 'h' ? along : boundary + offset
      const y = orientation === 'h' ? boundary + offset : along
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      total++
      const i = (y * image.width + x) * 4
      const d = image.data
      if (d[i] === wallRgb[0] && d[i + 1] === wallRgb[1] && d[i + 2] === wallRgb[2]) wall++
      else if (d[i] === doorRgb[0] && d[i + 1] === doorRgb[1] && d[i + 2] === doorRgb[2]) door++
    }
  }
  if (total === 0) return { wallRatio: 0, doorRatio: 0 }
  return { wallRatio: wall / total, doorRatio: door / total, threshold: wallThreshold }
}

/**
 * 墙检测：遍历所有格边（含图外框的边界边），占比 ≥ 阈值即记为一条墙；
 * 同位置 doorColor 占比 ≥ 阈值 → 仍记墙，但追加 openings:[{u:0.5,width:0.9,height:2.1,kind:'door'}]。
 * 输出顺序固定：先水平边（行线号, 列号），再垂直边（列线号, 行号）。
 * @returns {object[]} SceneSpec walls（from/to 为格线交点米坐标）
 */
export function detectPlanWalls(image, cfg, rows, cols) {
  const { metersPerCell: meters, wallThreshold } = cfg
  const walls = []
  const pushWall = (orientation, line, index) => {
    const sample = sampleEdgeRatio(image, cfg, orientation, line, index)
    const isDoor = sample.doorRatio >= wallThreshold
    if (!isDoor && sample.wallRatio < wallThreshold) return
    const from = orientation === 'h' ? [round3(index * meters), round3(line * meters)] : [round3(line * meters), round3(index * meters)]
    const to = orientation === 'h' ? [round3((index + 1) * meters), round3(line * meters)] : [round3(line * meters), round3((index + 1) * meters)]
    walls.push({
      from,
      to,
      height: PLAN_DEFAULTS.wallHeight,
      thickness: PLAN_DEFAULTS.wallThickness,
      openings: isDoor ? [{ ...PLAN_DEFAULTS.doorOpening }] : [],
    })
  }
  for (let line = 0; line <= rows; line++) for (let index = 0; index < cols; index++) pushWall('h', line, index)
  for (let line = 0; line <= cols; line++) for (let index = 0; index < rows; index++) pushWall('v', line, index)
  return walls
}

// ── SceneSpec 组装 ───────────────────────────────────────────────────────────

/**
 * 用解析出的房间/墙/物件 + 默认灯光相机环境组装 SceneSpec v1 草稿。
 * 灯光/相机/环境沿用 examples/hall-demo.spec.json 的风格，按场景尺寸自适应取景。
 */
export function buildSceneSpecDraft({ name, cfg, rows, cols, rooms, walls, objects }) {
  const meters = cfg.metersPerCell
  const width = round3(cols * meters)
  const depth = round3(rows * meters)
  const centerX = round3(width / 2)
  const centerZ = round3(depth / 2)
  return {
    version: 1,
    name,
    unit: 'm',
    bounds: { width, depth },
    grid: { cell: round3(meters), rows, cols },
    rooms,
    walls,
    objects,
    lights: [
      { id: 'sun-1', kind: 'sun', rotDeg: [50, 20, -25], pos: [0, 6, 0], intensity: 3.2, color: '#FFF6E0' },
      { id: 'point-1', kind: 'point', rotDeg: [0, 0, 0], pos: [centerX, 2.4, centerZ], intensity: 120, color: '#FFE2B0' },
    ],
    env: { ambientColor: '#CFE0FF', ambientStrength: 0.35, background: '#101826' },
    camera: { pos: [centerX, 2.4, -3.2], lookAt: [centerX, 0.9, centerZ], fov: 50 },
  }
}

/**
 * 主入口：解码后的 PNG + 规范化 legend → SceneSpec 草稿 + stats + warnings。
 * 解析不出任何房间时抛 E_SPEC_INVALID（空场景没有意义，不能静默产出空 spec）。
 *
 * @param {{width:number,height:number,data:Uint8Array}} image decodePng 结果
 * @param {object} cfg normalizePlanLegend 结果
 * @param {{name?:string}} [options]
 * @returns {{ spec:object, stats:object, warnings:string[] }}
 */
export function analyzePlanImage(image, cfg, options = {}) {
  const { rows, cols } = resolvePlanGrid(image, cfg)
  const classified = classifyPlanCells(image, cfg, rows, cols)
  const roomResult = detectPlanRooms(classified.cells, cfg, rows, cols)
  const objectResult = detectPlanObjects(classified.cells, cfg, rows, cols)
  const walls = detectPlanWalls(image, cfg, rows, cols)

  const stats = {
    rows,
    cols,
    cellPx: cfg.cellPx,
    cellMeters: round3(cfg.metersPerCell),
    rooms: roomResult.rooms.length,
    walls: walls.length,
    doors: walls.filter((wall) => wall.openings.length > 0).length,
    objects: objectResult.objects.length,
    unassigned: classified.unknownCount,
  }
  const warnings = [...classified.warnings, ...roomResult.warnings, ...objectResult.warnings]

  if (stats.rooms === 0) {
    fail(CODES.SPEC, '设计图里没有识别到任何房间（检查 legend.roomColors / voidColor 是否与格中心像素色一致）', {
      stats,
      unassignedColors: [...classified.unassigned.keys()],
    })
  }

  const name = options.name || cfg.name || 'plan'
  const spec = buildSceneSpecDraft({ name, cfg, rows, cols, rooms: roomResult.rooms, walls, objects: objectResult.objects })
  return { spec, stats, warnings, grid: { rows, cols, cellPx: cfg.cellPx, cellMeters: round3(cfg.metersPerCell) } }
}

// ── 俯视预览渲染（不依赖 S2 scene_preview）──────────────────────────────────

/** 颜色辅助：hex → [r,g,b,a]（非法回退中性灰，不抛错：预览是展示层）。 */
function rgbaOf(hex, alpha = 255) {
  const rgb = hexToRgb(isRgbaHexChannel(hex) ? hex : '#CCCCCC')
  return [rgb[0], rgb[1], rgb[2], alpha]
}

/**
 * 俯视预览 PNG：房间色块 + 网格 + 墙（含门洞）+ 家具 footprint。
 * @param {object} spec 规范化后的 SceneSpec
 * @param {{cellPx?:number,padding?:number}} [options]
 * @returns {{ png:Buffer, width:number, height:number }}
 */
export function renderPlanPreview(spec, options = {}) {
  const cellPx = Number.isInteger(options.cellPx) && options.cellPx >= 8 ? options.cellPx : PLAN_DEFAULTS.cellPx
  const padding = Number.isInteger(options.padding) && options.padding >= 0 ? options.padding : 16
  const cell = spec?.grid && Number.isFinite(spec.grid.cell) && spec.grid.cell > 0 ? spec.grid.cell : PLAN_DEFAULTS.metersPerCell
  const pxPerMeter = cellPx / cell
  const width = Math.max(32, Math.round(spec.bounds.width * pxPerMeter) + padding * 2)
  const height = Math.max(32, Math.round(spec.bounds.depth * pxPerMeter) + padding * 2)
  const canvas = new Canvas(width, height, rgbaOf('#101826'))
  const xOf = (x) => padding + x * pxPerMeter
  const zOf = (z) => padding + z * pxPerMeter

  // 1) 房间地板
  for (const room of spec.rooms) {
    const fill = rgbaOf(room.color)
    for (const [r, c] of room.cells) {
      canvas.fillRect(xOf((c - 1) * cell), zOf((r - 1) * cell), xOf(c * cell), zOf(r * cell), fill)
    }
  }

  // 2) 网格线（半透明白，画在地板上）
  const gridLine = [255, 255, 255, 30]
  if (spec.grid?.rows && spec.grid?.cols) {
    for (let k = 0; k <= spec.grid.cols; k++) {
      const x = Math.round(xOf(k * cell))
      canvas.fillRect(x, padding, x + 1, height - padding, gridLine)
    }
    for (let k = 0; k <= spec.grid.rows; k++) {
      const y = Math.round(zOf(k * cell))
      canvas.fillRect(padding, y, width - padding, y + 1, gridLine)
    }
  }

  // 3) 墙 + 门（门用橙色短线覆盖在墙上，长度取门宽与墙段长度较小值，避免画出墙外）
  const wallRgba = rgbaOf('#1F1A14')
  const doorRgba = rgbaOf('#C06A1E')
  for (const wall of spec.walls) {
    const x0 = xOf(wall.from[0])
    const z0 = zOf(wall.from[1])
    const x1 = xOf(wall.to[0])
    const z1 = zOf(wall.to[1])
    canvas.drawLine(x0, z0, x1, z1, 4, wallRgba)
    const length = Math.hypot(x1 - x0, z1 - z0)
    if (length <= 0) continue
    const ux = (x1 - x0) / length
    const uz = (z1 - z0) / length
    for (const opening of wall.openings || []) {
      const u = Number.isFinite(opening.u) ? Math.min(1, Math.max(0, opening.u)) : 0.5
      const halfDoor = Math.min((Number.isFinite(opening.width) ? opening.width : 0.9) * pxPerMeter, length) / 2
      const cx = x0 + (x1 - x0) * u
      const cz = z0 + (z1 - z0) * u
      canvas.drawLine(cx - ux * halfDoor, cz - uz * halfDoor, cx + ux * halfDoor, cz + uz * halfDoor, 4, doorRgba)
    }
  }

  // 4) 家具 footprint（size[0]×size[2]，按 rotYDeg 旋转；先画深色描边再填色）
  for (const object of spec.objects) {
    const w = Math.max(1, object.size[0] * pxPerMeter)
    const d = Math.max(1, object.size[2] * pxPerMeter)
    const cx = xOf(object.pos[0])
    const cz = zOf(object.pos[2])
    canvas.fillRotatedRect(cx, cz, w + 3, d + 3, object.rotYDeg, rgbaOf('#05080C'))
    canvas.fillRotatedRect(cx, cz, w, d, object.rotYDeg, rgbaOf(object.color))
  }

  return { png: canvas.toPng(), width, height }
}
