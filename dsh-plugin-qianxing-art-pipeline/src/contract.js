// 数据契约 version 1（交接包 06-数据格式与接口契约.md）的共享常量与规范化。
// 插件之间只认这些 JSON 结构；所有几何常数集中在这里。

/** 结构版本：结构变化 = 破坏性变更，插件必须拒绝旧版本。 */
export const CONTRACT_VERSION = 1

/** 唯一合法图元集合（官方基础形状）。 */
export const ALLOWED_IMAGE_IDS = Object.freeze([100001, 100002, 100003, 107102, 106056])

/** imageId → 官方基础形状名（只用于报告，不引用任何官方贴图）。 */
export const IMAGE_NAMES = Object.freeze({
  100001: '矩形',
  100002: '椭圆',
  100003: '三角',
  107102: '近白圆角板',
  106056: '柔光圆',
})

/** 家具种类（Layout.objects[].kind）。 */
export const KINDS = Object.freeze(['chair', 'plant', 'statue', 'table', 'carpet', 'shelf'])

/** 家具种类 → 默认模板名。 */
export const KIND_TEMPLATE = Object.freeze({
  chair: 'furn.chair',
  plant: 'furn.plant',
  statue: 'furn.statue',
  table: 'furn.table.1',
  carpet: 'furn.rug',
  shelf: 'furn.shelf',
})

/** 1 格 = 108 content 画布像素（模板根是 150×150，不是画布，见交接包 07 坑 3）。 */
export const CELL_TEMPLATE_PX = 108

/** 预览画布与棋盘几何（与游戏一致：1600×900；棋盘 584@(608,138)；ruler 12；gap 4）。 */
export const CANVAS = Object.freeze({ width: 1600, height: 900 })
export const FRAME = Object.freeze({ x: 608, y: 138, size: 584, ruler: 12, gap: 4 })

/** 多格模板的 content 画布：h2=216×108 / v2=108×216（含地毯）。 */
export const TEMPLATE_CANVAS = Object.freeze({
  'furn.table.h2': [216, 108],
  'furn.table.v2': [108, 216],
  'furn.rug.2': [216, 108],
  'furn.rug.3': [108, 216],
})

/** 模板 content 画布默认值。 */
export function canvasOfTemplate(templateKey) {
  return TEMPLATE_CANVAS[templateKey] || [CELL_TEMPLATE_PX, CELL_TEMPLATE_PX]
}

/** 模板名 → 期望画布（未知名字回退单格 108×108）。 */
export function isMultiCellTemplate(templateKey) {
  return Object.hasOwn(TEMPLATE_CANVAS, templateKey)
}

/** 浮点保留 2 位小数（契约 §0：尺寸/位置误差容差 0.011px）。 */
export function round2(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return n
  const r = Math.round(n * 100) / 100
  // -0 必须归零：宿主用「无损 JSON」校验工具输出，-0 会让 JSON 往返变成 0 而整条结果被拒
  // （实测事故：art_decompose / art_build_spec 的 y_up = -0 ⇒ INVALID_TOOL_OUTPUT）。
  return Object.is(r, -0) ? 0 : r
}

/** 颜色统一为字符串 `0xAARRGGBB`（大写）。接受 number / "0x…" / "#…"。 */
export function normalizeColor(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    return '0x' + (input >>> 0).toString(16).toUpperCase().padStart(8, '0')
  }
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) s = '0xFF' + s.slice(1)
  else if (/^#[0-9A-Fa-f]{8}$/.test(s)) s = '0x' + s.slice(1)
  else if (/^0X[0-9A-Fa-f]{8}$/.test(s)) s = '0x' + s.slice(2)
  if (!/^0x[0-9A-Fa-f]{8}$/.test(s)) return null
  return '0x' + s.slice(2).toUpperCase()
}

/** `0xAARRGGBB` → { a, r, g, b }（0–255）。 */
export function splitColor(argb) {
  const v = typeof argb === 'number' ? argb >>> 0 : Number(BigInt(String(argb).replace(/^0[Xx]/, '0x')) & 0xffffffffn)
  return { a: (v >>> 24) & 0xff, r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff }
}

/** `0xAARRGGBB` → CSS `rgba()`。 */
export function colorToCss(argb) {
  const { a, r, g, b } = splitColor(argb)
  if (a === 255) return `rgb(${r},${g},${b})`
  return `rgba(${r},${g},${b},${(a / 255).toFixed(4)})`
}

/** 契约 §0：颜色匹配 `^0x[0-9A-Fa-f]{8}$`。 */
export function isValidColorText(value) {
  return typeof value === 'string' && /^0x[0-9A-Fa-f]{8}$/.test(value)
}

/**
 * 规范化单层：补齐 y_up = -dy_down、rotDeg 默认 0、颜色/尺寸两位小数，
 * 并保持 order 字段由调用方负责（层表顺序由 layers 数组顺序决定）。
 * @param {object} layer
 * @param {number} index 0-based 位置（用于默认 order）
 */
export function normalizeLayer(layer, index) {
  const src = layer && typeof layer === 'object' ? layer : {}
  const dyDown = Number(src.dy_down)
  const yUpRaw = src.y_up === undefined || src.y_up === null ? Number.NaN : Number(src.y_up)
  const dy = Number.isFinite(dyDown) ? dyDown : (Number.isFinite(yUpRaw) ? -yUpRaw : 0)
  const yUp = Number.isFinite(yUpRaw) ? yUpRaw : -dy
  const color = normalizeColor(src.color)
  return {
    order: Number.isInteger(src.order) ? src.order : index + 1,
    imageId: Number(src.imageId),
    color: color === null ? String(src.color ?? '') : color,
    w: round2(src.w),
    h: round2(src.h),
    dx: round2(src.dx === undefined ? 0 : src.dx),
    dy_down: round2(dy),
    y_up: round2(yUp),
    rotDeg: round2(src.rotDeg === undefined || src.rotDeg === null ? 0 : src.rotDeg),
  }
}

/** 规范化一个 TemplateSpec（不校验，只补默认）。 */
export function normalizeTemplateSpec(template, name) {
  const src = template && typeof template === 'object' ? template : {}
  const layers = Array.isArray(src.layers) ? src.layers : []
  const key = String(src.template || name || '')
  const canvas = Array.isArray(src.sizePx) && src.sizePx.length === 2 ? src.sizePx.map(Number) : canvasOfTemplate(key)
  const normalizedLayers = layers.map((l, i) => normalizeLayer(l, i))
  return {
    template: key,
    kind: String(src.kind || ''),
    variant: String(src.variant === undefined || src.variant === null ? '1' : src.variant),
    sizePx: [canvas[0], canvas[1]],
    layerCount: normalizedLayers.length,
    layers: normalizedLayers,
  }
}
