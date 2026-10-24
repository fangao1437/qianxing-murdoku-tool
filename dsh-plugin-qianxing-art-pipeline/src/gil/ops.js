// S4 · WriterJob 四类 op 的通用实现（只改内存里的字段树，不做任何 IO）
//
// 算法参照（逐函数对齐，保证黄金字节级一致）：
//   qianxing-murdoku/tools/gil/gen_551.mjs        —— replace_template_layers 的完整算法
//   qianxing-murdoku/tools/gil/gen_539.mjs        —— things 引用控件新增 / 子列表重排
//   qianxing-murdoku/tools/gil/gen_art_runtime.mjs —— 族号组件 #502[2]/#12（compRef/setCompRef）
//
// 为什么必须"照抄算法"而不是"讲道理重写"：
//   黄金验收要求输出与仓库 551 容器逐字节一致。551 是 gen_551.mjs 从 547 跑出来的，
//   只要记录分配顺序、克隆方式、字段写法、删除顺序有任何差别，字节就会不同。
//
// 硬约束（交接包 07）：
//   · 层记录必须从基准档现成的「编辑器认的图片控件」克隆（坑 1），不得凭空造结构；
//   · 新 GUID 从基准档 maxId+1 连续分配，不得撞号；
//   · 模板对两份 content（源/母本）都要改，层数必须对称；
//   · 编辑器可能不认的只有"手写结构"——本实现全部克隆，故不产生手写结构。
import {
  cloneField,
  findChildListTop,
  setChildList,
  asIdList,
  stateBlocks,
  pairOf,
  pairValue,
  setPair,
  writeVarint,
  textsOf,
  encodeMsg,
  ID_LO,
  ID_HI,
} from './gilread.js'
import { ALLOWED_IMAGE_IDS, normalizeColor, isValidColorText } from '../contract.js'
import { CODES, fail } from '../errors.js'

/** 编辑器模板容器（母本的父）。 */
export const TEMPLATE_MASTER_PARENT = 1073741844
/** 图片类型：1 = Stretch（拉伸铺满）。 */
export const IMG_TYPE_STRETCH = 1
/** 浮点比较容差（float32 写入/读出的误差远小于它，见契约 §0：0.011px）。 */
const EPS = 0.02
const ID_LO_NUM = Number(ID_LO)
const ID_HI_NUM = Number(ID_HI)

// ════════════════════════════════════════════════════════════════════════════
// 一、读辅助（全部只读，闸门/幂等判断可安全调用）
// ════════════════════════════════════════════════════════════════════════════

/** 按记录 id 找记录（记录 id 是顶层 #501，来自 readGil().recs）。 */
export function recById(g, id) {
  return g.recs.find((r) => Number(r.id) === Number(id)) || null
}

/** 记录顶层的子控件列表 → id 数组（顺序 = 兄弟顺序 = 层 order）。 */
export function childIdsOf(rec) {
  if (!rec) return []
  const cl = findChildListTop(rec.field.sub)
  return cl ? (asIdList(cl.payload, true) || []).map(Number) : []
}

/** 记录顶层 #504 父指针（没有 = 根/模板源）。 */
export function parentIdOf(rec) {
  const f = (rec.field.sub || []).find((x) => x.field === 504 && x.wt === 0)
  return f ? Number(f.num) : null
}

/**
 * 全档模板对：源（父=null）与母本（父=TEMPLATE_MASTER_PARENT）同名成对。
 * 注意：本档里 `hex`/`clue`/`cell.1.1` 等编辑器模板也满足这个形态，调用方按名字过滤。
 */
export function templatePairs(g) {
  const out = []
  for (const r of g.recs) {
    if (r.parentId != null || !r.name) continue
    const mother = g.recs.find((x) => x.name === r.name && Number(x.parentId) === TEMPLATE_MASTER_PARENT)
    if (!mother) continue
    out.push({ name: r.name, source: r, mother })
  }
  return out
}

/** 按名字找模板对；找不到抛 E_BASE_MISMATCH（基准档形态不符）。 */
export function findTemplatePair(g, name) {
  if (typeof name !== 'string' || !name.trim()) fail(CODES.SPEC, '模板名必须是非空字符串', { name })
  const sources = g.recs.filter((r) => r.name === name && r.parentId == null)
  if (sources.length !== 1) {
    fail(CODES.BASE, `基准档里模板源 ${name} 的条数为 ${sources.length}（预期 1）`, { template: name })
  }
  const mothers = g.recs.filter((r) => r.name === name && Number(r.parentId) === TEMPLATE_MASTER_PARENT)
  if (mothers.length !== 1) {
    fail(CODES.BASE, `基准档里模板母本 ${name} 的条数为 ${mothers.length}（预期 1）`, { template: name })
  }
  return { name, source: sources[0], mother: mothers[0] }
}

/** 模板记录下的 content 容器（名字是 content；个别旧模板名字缺失时取唯一子控件）。 */
export function contentOf(g, tplRec) {
  const kids = childIdsOf(tplRec).map((id) => recById(g, id)).filter(Boolean)
  const named = kids.find((r) => r.name === 'content')
  if (named) return named
  if (kids.length === 1) return kids[0]
  fail(CODES.BASE, `模板记录 #${tplRec.id}（${tplRec.name}）下找不到唯一的 content 容器（子控件 ${kids.length} 个）`, {
    template: tplRec.name,
    record: Number(tplRec.id),
  })
}

/** 与 contentOf 相同，但找不到时返回 null（幂等判断用，不能抛错）。 */
function contentOfSoft(g, tplRec) {
  try {
    return contentOf(g, tplRec)
  } catch {
    return null
  }
}

/** things 容器记录（模板引用控件的父容器）。 */
export function findThingsRecord(g) {
  return g.recs.find((r) => r.name === 'things') || null
}

/** 四个状态块摘要（与 gen_551.stateSummary 完全一致）。 */
export function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504)
    const size = pairOf(b, 505)
    return {
      block: b,
      pos,
      size,
      x: pairValue(pos, 0),
      y: pairValue(pos, 1),
      w: pairValue(size, 0),
      h: pairValue(size, 1),
    }
  })
}

/** content 画布尺寸（取第一个状态块的 #505 两浮点对）。 */
export function contentCanvasOf(rec) {
  const blocks = stateBlocks(rec.field.sub, [])
  if (!blocks.length) return null
  const p = pairOf(blocks[0], 505)
  return p ? [pairValue(p, 0), pairValue(p, 1)] : null
}

/** content 画布是否已是目标尺寸（所有状态块都要一致）。 */
export function canvasMatches(rec, sizePx) {
  const blocks = stateBlocks(rec.field.sub, [])
  if (!blocks.length) return false
  return blocks.every((b) => {
    const p = pairOf(b, 505)
    return !!p && Math.abs(pairValue(p, 0) - sizePx[0]) <= EPS && Math.abs(pairValue(p, 1) - sizePx[1]) <= EPS
  })
}

/** 写两份 content 的画布尺寸（同一 content 的 4 份状态块一起写，与 gen_539 一致）。 */
export function setContentCanvas(rec, sizePx) {
  const blocks = stateBlocks(rec.field.sub, [])
  if (!blocks.length) fail(CODES.BASE, `content #${rec.id} 没有状态块，无法写画布尺寸`, { record: Number(rec.id) })
  for (const b of blocks) {
    const p = pairOf(b, 505)
    if (!p) fail(CODES.BASE, `content #${rec.id} 的状态块缺 #505 尺寸对`, { record: Number(rec.id) })
    setPair(p, sizePx[0], sizePx[1])
  }
}

// ── 图片槽（层记录的 /505/503/84 子树）─────────────────────────────────────
function imageNodes(recField) {
  let cur = [recField]
  for (const no of [505, 503, 84]) {
    const nx = []
    for (const x of cur) if (x && x.sub) for (const c of x.sub) if (c.field === no && c.sub) nx.push(c)
    cur = nx
  }
  return cur
}

/** 图片槽三元组：imageId(#503) / color(#502) / type(#504)。 */
export function imageTriple(recField) {
  const n = imageNodes(recField)[0]
  if (!n) return null
  const leaf = (x) => {
    const q = n.sub.find((z) => z.field === x && z.wt === 0)
    return q ? Number(q.num) : null
  }
  return { node: n, id: leaf(503), color: leaf(502), type: leaf(504) }
}

function setImg(node, no, val) {
  let x = node.sub.find((z) => z.field === no && z.wt === 0)
  if (!x) {
    x = { field: no, wt: 0, num: 0n }
    node.sub.push(x)
  }
  x.num = BigInt(val >>> 0)
}

// ── 可见性（/505(4/86)/#503/#14/#17/#503 = 隐藏标记）──────────────────────
/** 记录是否被隐藏（与 gen_551.isHidden 一致）。 */
export function isHiddenRecord(recField) {
  let h = false
  for (const x of recField.sub || []) {
    if (x.field !== 505 || !x.sub) continue
    ;(function walk(fs, p) {
      for (const y of fs) {
        const q = p + '/' + y.field
        if (y.wt === 0 && q === '/503/14/17/503') h = true
        else if (y.sub) walk(y.sub, q)
      }
    })(x.sub, '')
  }
  return h
}

/** 写可见性：hidden=false 时清空 #17 的隐藏标记（与 gen_551.setHidden 一致）。 */
export function setHiddenRecord(recField, hidden) {
  let found = false
  for (const x of recField.sub || []) {
    if (x.field !== 505 || !x.sub) continue
    const a = x.sub.find((y) => y.field === 501 && y.wt === 0)
    const b = x.sub.find((y) => y.field === 502 && y.wt === 0)
    if (!a || !b || Number(a.num) !== 4 || Number(b.num) !== 86) continue
    const p503 = x.sub.find((y) => y.field === 503 && y.sub)
    const p14 = p503 && p503.sub.find((y) => y.field === 14 && y.sub)
    if (!p14) fail(CODES.BASE, '可见性块缺 #503/#14（基准档形态不符）', { record: Number(recField.sub.find((z) => z.field === 501 && z.wt === 0)?.num || 0) })
    let p17 = p14.sub.find((y) => y.field === 17 && y.wt === 2)
    if (!p17) {
      p17 = { field: 17, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }
      p14.sub.push(p17)
    }
    p17.sub = hidden ? [{ field: 503, wt: 0, num: 1n }] : []
    p17.payload = encodeMsg(p17.sub)
    p17.len = p17.payload.length
    p17.isText = false
    found = true
  }
  if (!found) fail(CODES.BASE, '找不到 #505(4/86) 可见性块（基准档形态不符）')
}

// ── 旋转（状态块的 #508/#3 浮点）───────────────────────────────────────────
/** 所有状态块的旋转角（度）。 */
export function readRotations(recField) {
  const out = []
  for (const b of stateBlocks(recField.sub, [])) {
    const x = b.sub.find((y) => y.field === 508)
    if (!x || !x.sub) {
      out.push(0)
      continue
    }
    const z = x.sub.find((y) => y.field === 3 && y.wt === 5)
    out.push(z ? Math.round(z.f * 1000) / 1000 : 0)
  }
  return out
}

/** 写旋转：degZ=0 时写成空 #508 消息（与引擎的稀疏写法一致）。 */
function applyRotation(recField, degZ) {
  const blocks = stateBlocks(recField.sub, [])
  if (!blocks.length) fail(CODES.BASE, '层记录没有状态块，无法写旋转')
  for (const b of blocks) {
    let x = b.sub.find((y) => y.field === 508)
    if (!x) {
      x = { field: 508, wt: 2, sub: [], len: 0, payload: null, isText: false }
      b.sub.push(x)
    }
    x.sub = degZ ? [{ field: 3, wt: 5, f: degZ }] : []
    x.len = degZ ? 5 : 0
    x.payload = null
  }
  return blocks.length
}

// ── 组件块引用（族号 #502[2]/#12 等）──────────────────────────────────────
/** 记录顶层的组件块：`#502` 里 direct #501 == compNo 的那一块。 */
function compBlock(recField, compNo) {
  for (const f of recField.sub || []) {
    if (f.field !== 502 || !f.sub) continue
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0)
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0)
    if (a && b && Number(a.num) === compNo) return f
  }
  return null
}

/**
 * 组件块里的引用值：`#502[compNo]` 下 `#11/#12/#13/#14` 子消息里的 `#501`。
 * 两种写法都认：wt0 数字 / 紧凑 varint payload（与 gen_art_runtime.compRef 一致）。
 */
export function compRef(recField, compNo) {
  const blk = compBlock(recField, compNo)
  if (!blk) return null
  for (const g of blk.sub) {
    if (g.field !== 11 && g.field !== 12 && g.field !== 13 && g.field !== 14) continue
    if (!g.sub) continue
    const v = g.sub.find((x) => x.field === 501)
    if (!v) return null
    if (v.wt === 0) return { leaf: v, value: Number(v.num), kind: 'num' }
    const pay = v.payload || Buffer.alloc(0)
    let r = 0n
    let s = 0n
    let p = 0
    while (p < pay.length) {
      const x = pay[p++]
      r |= BigInt(x & 0x7f) << s
      if ((x & 0x80) === 0) break
      s += 7n
    }
    return { leaf: v, value: p === pay.length ? Number(r) : null, kind: 'payload' }
  }
  return null
}

/** 写组件块引用值（族号 / 母本链）。 */
export function setCompRef(recField, compNo, newId) {
  const blk = compBlock(recField, compNo)
  if (!blk) fail(CODES.BASE, `记录里找不到组件 #${compNo}（#502 块缺失）`)
  for (const g of blk.sub) {
    if (g.field !== 11 && g.field !== 12 && g.field !== 13 && g.field !== 14) continue
    if (!g.sub) continue
    const v = g.sub.find((x) => x.field === 501)
    if (!v) fail(CODES.BASE, `组件 #${compNo} 的 #${g.field} 里找不到 #501`)
    if (v.wt === 0) {
      v.num = BigInt(newId)
      return 'num'
    }
    v.payload = writeVarint(newId)
    v.len = v.payload.length
    v.isText = false
    v.sub = null
    return 'payload'
  }
  fail(CODES.BASE, `组件 #${compNo} 里找不到 #11/#12/#13/#14 引用子消息`)
}

// ── things 引用槽（/505(66/89)/#503/#77/#501）──────────────────────────────
function refSlot(recField, create) {
  let blk = null
  for (const x of recField.sub || []) {
    if (x.field !== 505 || !x.sub) continue
    const a = x.sub.find((y) => y.field === 501 && y.wt === 0)
    const b = x.sub.find((y) => y.field === 502 && y.wt === 0)
    if (a && b && Number(a.num) === 66 && Number(b.num) === 89) blk = x
  }
  if (!blk) return null
  const p503 = blk.sub.find((y) => y.field === 503 && y.sub)
  if (!p503) return null
  let p77 = p503.sub.find((y) => y.field === 77 && y.sub)
  if (!p77) {
    if (!create) return { block: blk, p503, p77: null }
    p77 = { field: 77, wt: 2, sub: [], payload: null, len: 0, isText: false }
    p503.sub.push(p77)
  }
  return { block: blk, p503, p77 }
}

/** 读 things 引用控件的引用值（模板源 GUID）；没有引用槽返回 null。 */
export function readRefOf(recField) {
  const s = refSlot(recField, false)
  if (!s || !s.p77) return null
  const l = (s.p77.sub || []).find((x) => x.field === 501 && x.wt === 0)
  return l ? Number(l.num) : null
}

/** 写 things 引用控件的引用值（必须是模板【源】GUID，见 07 坑 2）。 */
export function setRefOf(recField, prefabId) {
  const s = refSlot(recField, true)
  if (!s || !s.p77) fail(CODES.BASE, '引用控件缺 /505(66/89)/#503 引用槽（基准档形态不符）')
  s.p77.sub = [{ field: 501, wt: 0, num: BigInt(prefabId) }]
  s.p77.payload = null
  s.p77.len = 0
}

// ── 改子列表 / 改名 / 统计 / 重映射（与 gen_551 逐字一致）─────────────────
function setOrAppendChildList(recField, ids) {
  const cl = findChildListTop(recField.sub)
  if (cl) {
    setChildList(cl, ids)
    return cl
  }
  const nf = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false }
  recField.sub.push(nf)
  setChildList(nf, ids)
  return nf
}

/** 记录里唯一一处文本改名（命中数不为 1 则失败）。 */
function renameRecord(fields, oldName, newName) {
  const hits = textsOf(fields, []).filter((t) => t.payload && t.payload.toString('utf8') === oldName)
  if (hits.length !== 1) return { ok: false, hits: hits.length }
  hits[0].payload = Buffer.from(newName, 'utf8')
  hits[0].len = hits[0].payload.length
  return { ok: true, hits: 1 }
}

/** 统计某记录里某个 varint 值出现次数（克隆后核对"自身 GUID 都替换到了"）。 */
function countVarints(fields, val) {
  let n = 0
  ;(function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === val) n++
      if (f.sub) walk(f.sub)
    }
  })(fields)
  return n
}

/** 克隆记录后把"自身 GUID"（含紧凑 varint payload 写法）替换成新 id，返回替换处数。 */
function remapSelfIds(fields, oldId, newId) {
  let n = 0
  ;(function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === oldId) {
        f.num = BigInt(newId)
        n++
      } else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false)
        if (ids && ids.length === 1 && ids[0] === oldId) {
          f.payload = writeVarint(newId)
          f.len = f.payload.length
          n++
        }
      }
      if (f.sub) walk(f.sub)
    }
  })(fields)
  return n
}

/** 扫全档已用 GUID 与最大 GUID（新 id 从 max+1 连续分配）。 */
export function scanUsage(tree) {
  const used = new Set()
  let max = 0
  ;(function walk(fs) {
    for (const f of fs) {
      if (f.wt === 0) {
        const v = Number(f.num)
        if (v >= ID_LO_NUM && v < ID_HI_NUM) {
          used.add(v)
          if (v > max) max = v
        }
      }
      if (f.sub) walk(f.sub)
    }
  })(tree)
  return { used, max }
}

/**
 * 新 id 分配器：从基准档 maxId+1 起连续分配，跳过已占用的号。
 * 越界（撞到 ID_HI）直接失败，不静默回绕。
 */
export function createAllocator({ used, max }) {
  let nextId = max + 1
  return {
    take() {
      while (used.has(nextId)) nextId++
      if (nextId >= ID_HI_NUM) fail(CODES.COLLISION, `GUID 号段耗尽（下一次分配 #${nextId} 超出 ${ID_HI_NUM}）`)
      const v = nextId++
      used.add(v)
      return v
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 二、参数规范化（契约 01 Layer / 06 §5）
// ════════════════════════════════════════════════════════════════════════════

/** 颜色文本 → 0xAARRGGBB 的 uint32 数值（写盘口径）。 */
function colorToUint(value) {
  const text = normalizeColor(value)
  if (text === null || !isValidColorText(text)) return null
  return Number(BigInt(text.replace(/^0x/i, '0x')) & 0xffffffffn)
}

function normSizePx(raw, label) {
  if (!Array.isArray(raw) || raw.length !== 2) fail(CODES.SPEC, `${label} 必须是 [w,h] 两元素数组`, { value: raw })
  const w = Number(raw[0])
  const h = Number(raw[1])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    fail(CODES.SPEC, `${label} 必须是两个正数`, { value: raw })
  }
  return [w, h]
}

/**
 * 规范化层表：验证 imageId/颜色/尺寸/位置/旋转，y_up 缺省按 -dy_down 补。
 * 不做四舍五入（写盘值与输入 JSON 一致，才能和参考实现字节一致）。
 */
export function normalizeLayers(rawLayers, templateName) {
  if (!Array.isArray(rawLayers)) fail(CODES.SPEC, `${templateName} 的 layers 必须是数组`, { template: templateName })
  if (rawLayers.length === 0) fail(CODES.SPEC, `${templateName} 的 layers 不能为空`, { template: templateName })
  return rawLayers.map((l, i) => {
    const L = l && typeof l === 'object' ? l : {}
    const where = `${templateName} 第 ${i + 1} 层`
    const order = L.order === undefined || L.order === null ? i + 1 : Number(L.order)
    if (!Number.isInteger(order) || order !== i + 1) {
      fail(CODES.SPEC, `${where} 的 order 必须是 1..N 连续（实得 ${JSON.stringify(L.order)}）`, { template: templateName, index: i + 1 })
    }
    const imageId = Number(L.imageId)
    if (!ALLOWED_IMAGE_IDS.includes(imageId)) {
      fail(CODES.SPEC, `${where} 的 imageId=${JSON.stringify(L.imageId)} 不在允许集合 ${ALLOWED_IMAGE_IDS.join('/')}`, { template: templateName, index: i + 1 })
    }
    const color = colorToUint(L.color)
    if (color === null) fail(CODES.SPEC, `${where} 的 color 不是合法 0xAARRGGBB`, { template: templateName, index: i + 1, color: L.color })
    const w = Number(L.w)
    const h = Number(L.h)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) {
      fail(CODES.SPEC, `${where} 的 w/h 必须是 >=0 的数字`, { template: templateName, index: i + 1, w: L.w, h: L.h })
    }
    const dxRaw = L.dx === undefined || L.dx === null ? 0 : Number(L.dx)
    const dyRaw = Number(L.dy_down)
    if (!Number.isFinite(dxRaw)) fail(CODES.SPEC, `${where} 的 dx 不是数字`, { template: templateName, index: i + 1 })
    if (!Number.isFinite(dyRaw)) fail(CODES.SPEC, `${where} 缺 dy_down（数字）`, { template: templateName, index: i + 1 })
    const yUpRaw = L.y_up === undefined || L.y_up === null ? Number.NaN : Number(L.y_up)
    const yUp = Number.isFinite(yUpRaw) ? yUpRaw : -dyRaw
    if (Math.abs(yUp + dyRaw) > 0.011) {
      fail(CODES.SPEC, `${where} 的 y_up（${yUp}）≠ -dy_down（${-dyRaw}）`, { template: templateName, index: i + 1 })
    }
    const rotRaw = L.rotDeg === undefined || L.rotDeg === null ? 0 : Number(L.rotDeg)
    if (!Number.isFinite(rotRaw)) fail(CODES.SPEC, `${where} 的 rotDeg 不是数字`, { template: templateName, index: i + 1 })
    return { order, imageId, color, w, h, dx: dxRaw, dy: dyRaw, yUp, rot: rotRaw }
  })
}

/** 规范化四类 op（只校验结构，不碰基准档）。 */
export function normalizeOps(rawOps) {
  if (!Array.isArray(rawOps) || rawOps.length === 0) fail(CODES.SPEC, 'WriterJob.ops 必须是非空数组', { ops: rawOps })
  const seenReplace = new Set()
  return rawOps.map((raw, i) => {
    const op = raw && typeof raw === 'object' ? raw : {}
    const where = `ops[${i}]`
    if (typeof op.op !== 'string' || !op.op) fail(CODES.SPEC, `${where} 缺 op 名称`, { op: raw })
    switch (op.op) {
      case 'replace_template_layers': {
        const template = String(op.template || '')
        if (!template) fail(CODES.SPEC, `${where}.template 必须是非空字符串`)
        if (seenReplace.has(template)) {
          fail(CODES.SPEC, `${where} 重复替换同一模板 ${template}（首版只支持每模板一次，避免层原型被前一次替换污染）`)
        }
        seenReplace.add(template)
        const sizePx = op.sizePx === undefined || op.sizePx === null ? null : normSizePx(op.sizePx, `${where}.sizePx`)
        return { op: op.op, template, sizePx, layers: normalizeLayers(op.layers, template) }
      }
      case 'set_canvas': {
        const template = String(op.template || '')
        if (!template) fail(CODES.SPEC, `${where}.template 必须是非空字符串`)
        return { op: op.op, template, sizePx: normSizePx(op.sizePx, `${where}.sizePx`) }
      }
      case 'set_things_ref': {
        const name = String(op.name || '').trim()
        if (!name) fail(CODES.SPEC, `${where}.name 必须是非空字符串`)
        const prefab = Number(op.prefab)
        if (!Number.isInteger(prefab) || prefab < ID_LO_NUM || prefab >= ID_HI_NUM) {
          fail(CODES.SPEC, `${where}.prefab 必须是模板源 GUID（${ID_LO_NUM}..${ID_HI_NUM - 1} 的整数），实得 ${JSON.stringify(op.prefab)}`)
        }
        return { op: op.op, name, prefab }
      }
      case 'set_family': {
        const template = String(op.template || '')
        if (!template) fail(CODES.SPEC, `${where}.template 必须是非空字符串`)
        const family = Number(op.family)
        if (!Number.isInteger(family) || family < 0 || family > 1e6) {
          fail(CODES.SPEC, `${where}.family 必须是非负整数，实得 ${JSON.stringify(op.family)}`)
        }
        return { op: op.op, template, family }
      }
      default:
        fail(CODES.SPEC, `${where}.op=${JSON.stringify(op.op)} 不是支持的类型（replace_template_layers/set_canvas/set_things_ref/set_family）`)
    }
  })
}

// ════════════════════════════════════════════════════════════════════════════
// 三、幂等判断：ops 描述的目标状态是否已经全部满足
// ════════════════════════════════════════════════════════════════════════════

/** 单层字段回读比对，返回问题描述数组（空 = 匹配）。 */
function checkLayerRecord(rec, parentId, L, where) {
  const bad = []
  if (!rec) return [`${where} 记录不存在`]
  if (parentIdOf(rec) !== Number(parentId)) bad.push(`${where} 父指针=${parentIdOf(rec)}（预期 ${parentId}）`)
  const im = imageTriple(rec.field)
  if (!im) bad.push(`${where} 缺图片槽`)
  else {
    if (im.id !== L.imageId) bad.push(`${where} imageId=${im.id}（预期 ${L.imageId}）`)
    const color = im.color === null ? null : im.color >>> 0
    if (color !== L.color) bad.push(`${where} color=${color === null ? 'null' : '0x' + color.toString(16)}（预期 0x${L.color.toString(16)}）`)
    if (im.type !== IMG_TYPE_STRETCH) bad.push(`${where} imageType=${im.type}（预期 ${IMG_TYPE_STRETCH}）`)
  }
  const blocks = stateSummary(rec.field)
  if (!blocks.length) bad.push(`${where} 没有状态块`)
  for (const s of blocks) {
    if (Math.abs(s.x - L.dx) > EPS || Math.abs(s.y - L.yUp) > EPS) bad.push(`${where} 位置=(${s.x},${s.y})（预期 (${L.dx},${L.yUp})）`)
    if (Math.abs(s.w - L.w) > EPS || Math.abs(s.h - L.h) > EPS) bad.push(`${where} 尺寸=${s.w}×${s.h}（预期 ${L.w}×${L.h}）`)
  }
  for (const rot of readRotations(rec.field)) {
    if (Math.abs(rot - L.rot) > EPS) bad.push(`${where} 旋转=${rot}（预期 ${L.rot}）`)
  }
  if (isHiddenRecord(rec.field)) bad.push(`${where} 仍带隐藏标记`)
  return bad
}

/** 两份 content 的层列表是否与 layers 一致；返回问题描述数组。 */
function checkLayers(g, content, layers, label) {
  const ids = childIdsOf(content)
  const bad = []
  if (ids.length !== layers.length) return [`${label} 层数=${ids.length}（预期 ${layers.length}）`]
  for (let i = 0; i < ids.length; i++) {
    const rec = recById(g, ids[i])
    bad.push(...checkLayerRecord(rec, content.id, layers[i], `${label} L${i + 1}`))
    if (bad.length >= 8) break
  }
  return bad
}

/** 幂等：ops 全部已满足 ⇒ 返回 true（走原样复制路径）。 */
export function isOpsSatisfied(g, ops) {
  for (const op of ops) {
    switch (op.op) {
      case 'replace_template_layers': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) return false
        const cs = contentOfSoft(g, pair.source)
        const cm = contentOfSoft(g, pair.mother)
        if (!cs || !cm) return false
        if (op.sizePx && (!canvasMatches(cs, op.sizePx) || !canvasMatches(cm, op.sizePx))) return false
        if (checkLayers(g, cs, op.layers, 'src').length) return false
        if (checkLayers(g, cm, op.layers, 'mst').length) return false
        break
      }
      case 'set_canvas': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) return false
        const cs = contentOfSoft(g, pair.source)
        const cm = contentOfSoft(g, pair.mother)
        if (!cs || !cm) return false
        if (!canvasMatches(cs, op.sizePx) || !canvasMatches(cm, op.sizePx)) return false
        break
      }
      case 'set_things_ref': {
        const things = findThingsRecord(g)
        if (!things) return false
        const hit = childIdsOf(things).map((id) => recById(g, id)).find((r) => r && r.name === op.name)
        if (!hit) return false
        if (readRefOf(hit.field) !== op.prefab) return false
        break
      }
      case 'set_family': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) return false
        const s = compRef(pair.source.field, 2)
        const m = compRef(pair.mother.field, 2)
        if (!s || !m || s.value !== op.family || m.value !== op.family) return false
        break
      }
      default:
        return false
    }
  }
  return true
}

// ════════════════════════════════════════════════════════════════════════════
// 四、执行 ops（原地改 g.tree；返回计划/统计，写盘与报告都由调用方负责）
// ════════════════════════════════════════════════════════════════════════════

function deleteRecords(g, deleted) {
  const del = new Set(deleted.map((d) => Number(d.id)))
  const byHolder = new Map()
  for (const r of g.recs) {
    if (!del.has(Number(r.id))) continue
    if (!byHolder.has(r.holder)) byHolder.set(r.holder, [])
    byHolder.get(r.holder).push(r)
  }
  // 同一 holder 内倒序删，避免 splice 之后 index 错位（与 gen_551 一致）
  for (const [holder, rs] of byHolder) {
    for (const r of rs.sort((a, b) => b.index - a.index)) holder.splice(r.index, 1)
  }
}

/** 单层克隆：给定原型记录，造一条新层记录并推进 g.recHolder。 */
function cloneLayer(g, alloc, proto, contentId, L) {
  const lf = cloneField(proto.field)
  const lid = alloc.take()
  const selfCount = countVarints(proto.field.sub, proto.id)
  const n = remapSelfIds(lf.sub, proto.id, lid)
  if (n !== selfCount) {
    fail(CODES.WRITE, `层记录克隆：自身 GUID 替换 ${n}/${selfCount} 处（基准原型形态异常）`, { proto: Number(proto.id) })
  }
  const p504 = lf.sub.find((x) => x.field === 504 && x.wt === 0)
  if (!p504) fail(CODES.BASE, `层原型 #${proto.id} 缺顶层 #504 父指针`)
  p504.num = BigInt(contentId)
  for (const s of stateSummary(lf)) {
    setPair(s.pos, L.dx, L.yUp)
    setPair(s.size, L.w, L.h)
  }
  const im = imageTriple(lf)
  if (!im) fail(CODES.BASE, `层原型 #${proto.id} 缺图片槽`)
  setImg(im.node, 502, L.color)
  setImg(im.node, 503, L.imageId)
  setImg(im.node, 504, IMG_TYPE_STRETCH)
  applyRotation(lf, L.rot)
  setHiddenRecord(lf, false)
  g.recHolder.push(lf)
  return lid
}

/**
 * 执行整份 ops。
 *
 * @param {object} g readGil() 的返回值（会被原地修改：tree/recHolder）
 * @param {Array} ops normalizeOps() 的产物
 * @returns {{added:Array, deleted:Array, ops:Array, written:Array}}
 */
export function applyOps(g, ops) {
  const plan = { added: [], deleted: [], ops: [], canvasWrites: [], familyWrites: [], refWrites: [] }
  const { used, max } = scanUsage(g.tree)
  const alloc = createAllocator({ used, max })
  for (const op of ops) {
    switch (op.op) {
      case 'replace_template_layers': {
        const pair = findTemplatePair(g, op.template)
        const cs = contentOf(g, pair.source)
        const cm = contentOf(g, pair.mother)
        const oldS = childIdsOf(cs)
        const oldM = childIdsOf(cm)
        const proto = recById(g, oldS[0]) || recById(g, oldM[0])
        if (!proto) {
          fail(CODES.BASE, `模板 ${op.template} 的两份 content 都没有旧层记录，取不到层原型（07 坑 1：不得凭空造层）`, { template: op.template })
        }
        const idsS = op.layers.map((L) => cloneLayer(g, alloc, proto, cs.id, L))
        const idsM = op.layers.map((L) => cloneLayer(g, alloc, proto, cm.id, L))
        setOrAppendChildList(cs.field, idsS)
        setOrAppendChildList(cm.field, idsM)
        // content 画布：只有与目标不同才写（同值时不动，避免无意义的字节差异）
        for (const [rec, tag] of [[cs, 'src'], [cm, 'mst']]) {
          if (!op.sizePx || canvasMatches(rec, op.sizePx)) continue
          setContentCanvas(rec, op.sizePx)
          plan.canvasWrites.push({ template: op.template, side: tag, content: Number(rec.id), sizePx: op.sizePx.slice() })
        }
        for (const id of oldS) plan.deleted.push({ kind: 'layer', side: 'src', id: Number(id), parent: Number(cs.id) })
        for (const id of oldM) plan.deleted.push({ kind: 'layer', side: 'mst', id: Number(id), parent: Number(cm.id) })
        for (let i = 0; i < idsS.length; i++) plan.added.push({ kind: 'layer', side: 'src', id: idsS[i], parent: Number(cs.id), template: op.template })
        for (let i = 0; i < idsM.length; i++) plan.added.push({ kind: 'layer', side: 'mst', id: idsM[i], parent: Number(cm.id), template: op.template })
        plan.ops.push({
          op: op.op,
          template: op.template,
          source: Number(pair.source.id),
          mother: Number(pair.mother.id),
          contentSource: Number(cs.id),
          contentMother: Number(cm.id),
          layers: op.layers.length,
          proto: Number(proto.id),
          sizePx: op.sizePx ? op.sizePx.slice() : null,
        })
        break
      }
      case 'set_canvas': {
        const pair = findTemplatePair(g, op.template)
        const cs = contentOf(g, pair.source)
        const cm = contentOf(g, pair.mother)
        for (const [rec, tag] of [[cs, 'src'], [cm, 'mst']]) {
          if (canvasMatches(rec, op.sizePx)) continue
          setContentCanvas(rec, op.sizePx)
          plan.canvasWrites.push({ template: op.template, side: tag, content: Number(rec.id), sizePx: op.sizePx.slice() })
        }
        plan.ops.push({
          op: op.op,
          template: op.template,
          source: Number(pair.source.id),
          mother: Number(pair.mother.id),
          contentSource: Number(cs.id),
          contentMother: Number(cm.id),
          sizePx: op.sizePx.slice(),
        })
        break
      }
      case 'set_things_ref': {
        const things = findThingsRecord(g)
        if (!things) fail(CODES.BASE, '基准档里找不到 things 容器（模板引用控件的父容器）')
        const kids = childIdsOf(things)
        const byName = kids.map((id) => recById(g, id)).filter(Boolean)
        const existing = byName.find((r) => r.name === op.name)
        if (existing) {
          if (readRefOf(existing.field) !== op.prefab) {
            setRefOf(existing.field, op.prefab)
            plan.refWrites.push({ mode: 'update', name: op.name, control: Number(existing.id), prefab: op.prefab })
          }
          plan.ops.push({ op: op.op, name: op.name, prefab: op.prefab, control: Number(existing.id), created: false })
          break
        }
        // 不存在：从 things 下现成的引用控件克隆（07 坑 1：不要凭空造）
        const proto = byName.find((r) => r.name && readRefOf(r.field) !== null)
        if (!proto) fail(CODES.BASE, 'things 下没有可克隆的模板引用控件原型（需要 66/89 引用槽）')
        const rf = cloneField(proto.field)
        const rid = alloc.take()
        const selfCount = countVarints(proto.field.sub, proto.id)
        const n = remapSelfIds(rf.sub, proto.id, rid)
        if (n !== selfCount) fail(CODES.WRITE, `引用控件克隆：自身 GUID 替换 ${n}/${selfCount} 处`, { proto: Number(proto.id) })
        const rn = renameRecord(rf.sub, proto.name, op.name)
        if (!rn.ok) fail(CODES.WRITE, `引用控件改名失败（旧名 ${proto.name} 命中 ${rn.hits} 处）`, { proto: Number(proto.id) })
        const p504 = rf.sub.find((x) => x.field === 504 && x.wt === 0)
        if (!p504) fail(CODES.BASE, `引用控件原型 #${proto.id} 缺顶层 #504 父指针`)
        p504.num = BigInt(things.id)
        setRefOf(rf, op.prefab)
        setHiddenRecord(rf, false)
        g.recHolder.push(rf)
        plan.added.push({ kind: 'thingsRef', id: rid, parent: Number(things.id), name: op.name, ref: op.prefab })
        setOrAppendChildList(things.field, [...kids, rid])
        plan.refWrites.push({ mode: 'create', name: op.name, control: rid, prefab: op.prefab })
        plan.ops.push({ op: op.op, name: op.name, prefab: op.prefab, control: rid, created: true })
        break
      }
      case 'set_family': {
        const pair = findTemplatePair(g, op.template)
        for (const [rec, tag] of [[pair.source, 'src'], [pair.mother, 'mst']]) {
          const cur = compRef(rec.field, 2)
          if (!cur) fail(CODES.BASE, `模板 ${op.template}/${tag} 缺族号组件 #502[2]`, { template: op.template })
          if (cur.value === op.family) continue
          setCompRef(rec.field, 2, op.family)
          plan.familyWrites.push({ template: op.template, side: tag, record: Number(rec.id), family: op.family })
        }
        plan.ops.push({ op: op.op, template: op.template, source: Number(pair.source.id), mother: Number(pair.mother.id), family: op.family })
        break
      }
      default:
        fail(CODES.SPEC, `未实现的 op：${op.op}`)
    }
  }
  // 记录删除放在所有 op 之后统一做（与 gen_551 的收尾顺序一致）
  deleteRecords(g, plan.deleted)
  plan.expectRecs = g.recs.length - plan.deleted.length + plan.added.length
  return plan
}

/**
 * 写后校验：ops 目标状态是否已在（writeGil 的 assert 用，返回 true 或错误文本）。
 * 复用幂等判断，因此"写完能回读成目标状态"= "再跑同一 job 会走幂等路径"。
 */
export function verifyOps(g, ops) {
  const bad = []
  for (const op of ops) {
    switch (op.op) {
      case 'replace_template_layers': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) {
          bad.push(`模板 ${op.template} 缺失`)
          break
        }
        const cs = contentOfSoft(g, pair.source)
        const cm = contentOfSoft(g, pair.mother)
        if (!cs || !cm) {
          bad.push(`${op.template} content 缺失`)
          break
        }
        if (op.sizePx) {
          if (!canvasMatches(cs, op.sizePx)) bad.push(`${op.template}/src 画布不符`)
          if (!canvasMatches(cm, op.sizePx)) bad.push(`${op.template}/mst 画布不符`)
        }
        bad.push(...checkLayers(g, cs, op.layers, `${op.template}/src`))
        bad.push(...checkLayers(g, cm, op.layers, `${op.template}/mst`))
        break
      }
      case 'set_canvas': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) {
          bad.push(`模板 ${op.template} 缺失`)
          break
        }
        const cs = contentOfSoft(g, pair.source)
        const cm = contentOfSoft(g, pair.mother)
        if (!cs || !cm) bad.push(`${op.template} content 缺失`)
        else {
          if (!canvasMatches(cs, op.sizePx)) bad.push(`${op.template}/src 画布不符`)
          if (!canvasMatches(cm, op.sizePx)) bad.push(`${op.template}/mst 画布不符`)
        }
        break
      }
      case 'set_things_ref': {
        const things = findThingsRecord(g)
        if (!things) {
          bad.push('things 容器缺失')
          break
        }
        const hit = childIdsOf(things).map((id) => recById(g, id)).find((r) => r && r.name === op.name)
        if (!hit) bad.push(`things 缺引用 ${op.name}`)
        else if (readRefOf(hit.field) !== op.prefab) bad.push(`things/${op.name} ref=${readRefOf(hit.field)}（预期 ${op.prefab}）`)
        break
      }
      case 'set_family': {
        const pair = templatePairs(g).find((p) => p.name === op.template)
        if (!pair) {
          bad.push(`模板 ${op.template} 缺失`)
          break
        }
        const s = compRef(pair.source.field, 2)
        const m = compRef(pair.mother.field, 2)
        if (!s || s.value !== op.family) bad.push(`${op.template}/src 族号不符`)
        if (!m || m.value !== op.family) bad.push(`${op.template}/mst 族号不符`)
        break
      }
      default:
        bad.push(`未知 op ${op.op}`)
    }
    if (bad.length >= 10) break
  }
  return bad.length ? bad.join('; ') : true
}

// ════════════════════════════════════════════════════════════════════════════
// 五、报告辅助（全部在"重读输出档"的 g 上调用）
// ════════════════════════════════════════════════════════════════════════════

/** 家具模板名集合（things 引用只覆盖这一类，见 03 §3）。 */
export function furnitureTemplateNames(g) {
  return templatePairs(g)
    .map((p) => p.name)
    .filter((name) => /^furn\./.test(name))
}

/**
 * WriterReport.templates：每模板 { source, mother, layers, motherLayers, canvas }。
 * 只报家具模板 ∪ 本 job 涉及到的模板名，避免把 hex/clue 等编辑器模板混进美术报告。
 */
export function buildTemplatesReport(g, ops) {
  const wanted = new Set(furnitureTemplateNames(g))
  for (const op of ops) if (op.template) wanted.add(op.template)
  const out = {}
  for (const pair of templatePairs(g)) {
    if (!wanted.has(pair.name)) continue
    const cs = contentOfSoft(g, pair.source)
    const cm = contentOfSoft(g, pair.mother)
    out[pair.name] = {
      source: Number(pair.source.id),
      mother: Number(pair.mother.id),
      layers: cs ? childIdsOf(cs).length : 0,
      motherLayers: cm ? childIdsOf(cm).length : 0,
      canvas: cs ? contentCanvasOf(cs) : null,
    }
  }
  return out
}

/** 写后抽样：替换类 op 的第 1 层回读值（契约 §5 samples）。 */
export function buildSamples(g, ops, limit = 6) {
  const samples = []
  for (const op of ops) {
    if (op.op !== 'replace_template_layers') continue
    const pair = templatePairs(g).find((p) => p.name === op.template)
    if (!pair) continue
    const cs = contentOfSoft(g, pair.source)
    if (!cs) continue
    const ids = childIdsOf(cs)
    for (let i = 0; i < Math.min(ids.length, 2); i++) {
      const rec = recById(g, ids[i])
      if (!rec) continue
      const im = imageTriple(rec.field)
      const st = stateSummary(rec.field)[0] || {}
      samples.push({
        template: op.template,
        layer: i + 1,
        readBack: {
          imageId: im ? im.id : null,
          color: im && im.color !== null ? '0x' + (im.color >>> 0).toString(16).toUpperCase().padStart(8, '0') : null,
          w: st.w,
          h: st.h,
          pos: [st.x, -(st.y || 0)],
          rotDeg: readRotations(rec.field)[0] || 0,
        },
      })
    }
    if (samples.length >= limit) break
  }
  return samples.slice(0, limit)
}

/** content 画布读回（报告/自测用）。 */
export function canvasOfTemplate(g, name) {
  const pair = templatePairs(g).find((p) => p.name === name)
  if (!pair) return null
  const cs = contentOfSoft(g, pair.source)
  return cs ? contentCanvasOf(cs) : null
}
