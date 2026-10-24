// S2 · 层表/规格：模板层表 → ArtSpecSet（交接包 02-手搭流程.md、06 §2/§3）
//
// 输入（tools.js 已校验）：
//   templates   json   TemplateSpec 数组，或 { [templateName]: TemplateSpec } 映射；每个至少含
//                      { template?, kind, variant?, sizePx:[w,h], layers:[Layer] }（Layer 见契约 §1）
//   name?       string ArtSpecSet.name（默认 'spec'）
//   cellTemplatePx? integer 默认 108
//   imageIds?   json  可选覆盖（默认官方基础形状表）；tools.js 未暴露，直接调用时可用
//   source?     json  可选 source 字段（mode/icon/quantize…）
//   out?        string 输出 ArtSpecSet JSON 路径（可选；不得覆盖输入）
//
// 输出：
//   { spec: ArtSpecSet, out?: string, stats: { templates, layers, fixes: string[] } }
//
// 规则（对应交接包 02 §3 / 06 §1–§3）：
//   · 层顺序 = 数组顺序（从下到上）；order 强制 1..N 连续；
//   · y_up 必须等于 -dy_down（不一致时以 dy_down 为准并修正，report 里体现）；
//   · 画布：单格 108×108；table.h2 / rug.2 = 216×108；table.v2 / rug.3 = 108×216；
//   · 颜色统一为字符串 `0xAARRGGBB`（大写 hex）；尺寸/位置保留 2 位小数；
//   · 规范化后调用 validateSpecDocument 复检；非法规格抛 E_SPEC_INVALID，
//     错误 detail.field = 第一处不符的检查 id（可定位到模板/层/字段）。
//   · 幂等：把上一次的 spec.templates 再喂进来，输出的 spec 逐字节等价（fixes 为空）。
import { CELL_TEMPLATE_PX, KIND_TEMPLATE, canvasOfTemplate, normalizeTemplateSpec, round2 } from '../contract.js'
import { CODES, fail } from '../errors.js'
import { assertNotOverwrite, displayPath, fileSize, loadJsonArg, resolvePath, writeJsonFile } from '../paths.js'
import { validateSpecDocument } from './validate-spec.js'

/** 官方基础形状默认映射（imageIds 缺省值，检查口径同 check-spec.mjs）。 */
const DEFAULT_IMAGE_IDS = Object.freeze({ rect: 100001, ellipse: 100002, round: 107102, shadowSoft: 106056 })

/**
 * S2：把手写层表规范化成 ArtSpecSet 并做结构校验。
 * @param {{ templates?: object|Array, name?: string, cellTemplatePx?: number, imageIds?: object, source?: object, out?: string }} args
 * @param {{ root?: string }} [env] root = 工作区根（相对路径解析 / 默认输出根）
 * @returns {Promise<{ spec: object, out?: string, stats: { templates:number, layers:number, fixes:string[] } }>}
 */
export async function buildArtSpec(args = {}, env = {}) {
  const root = env.root || process.cwd()
  const fixes = []

  // ── 入参 ────────────────────────────────────────────────────────────────
  if (args.templates === undefined || args.templates === null) {
    fail(CODES.ARGS, '缺少 templates（TemplateSpec 数组或 { 模板名: TemplateSpec } 映射）', { field: 'templates' })
  }
  let input = args.templates
  let inputSource = null
  if (typeof input === 'string') {
    // 方便直接传 JSON 文件路径（契约：值可以是内联 JSON 也可以是路径）。
    const loaded = loadJsonArg(input, root, 'templates')
    input = loaded.value
    inputSource = loaded.source
  }

  const cellTemplatePx = args.cellTemplatePx === undefined || args.cellTemplatePx === null ? CELL_TEMPLATE_PX : Number(args.cellTemplatePx)
  if (cellTemplatePx !== CELL_TEMPLATE_PX) {
    fail(CODES.SPEC, `cellTemplatePx 必须是 ${CELL_TEMPLATE_PX}（1 格 = ${CELL_TEMPLATE_PX} content 画布像素）`, {
      field: 'cellTemplatePx',
      expected: CELL_TEMPLATE_PX,
      got: args.cellTemplatePx,
    })
  }

  // ── 规范化 ──────────────────────────────────────────────────────────────
  const entries = normalizeInputTemplates(input, fixes)
  const templates = {}
  for (const entry of entries) templates[entry.name] = normalizeOneTemplate(entry, fixes)

  /** @type {object} ArtSpecSet（契约 §3） */
  const spec = {
    version: 1,
    name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'spec',
  }
  if (args.source !== undefined && args.source !== null) spec.source = args.source
  if (args.imageIds !== undefined && args.imageIds !== null) {
    if (typeof args.imageIds !== 'object' || Array.isArray(args.imageIds)) {
      fail(CODES.ARGS, 'imageIds 必须是对象 { rect, ellipse, round?, shadowSoft? }', { field: 'imageIds' })
    }
    spec.imageIds = { ...DEFAULT_IMAGE_IDS, ...args.imageIds }
  }
  spec.cellTemplatePx = CELL_TEMPLATE_PX
  spec.templates = templates

  // ── 规范化后复检：非法抛 E_SPEC_INVALID，错误里带第一处不符字段 ─────────
  const report = validateSpecDocument(spec)
  if (!report.ok) {
    const first = report.checks.find((check) => !check.ok)
    fail(CODES.SPEC, `规格非法：${first.id}${first.detail ? `（${first.detail}）` : ''}`, {
      field: first.id,
      detail: first.detail ?? null,
    })
  }

  // ── 落盘（输出不得覆盖输入）─────────────────────────────────────────────
  const stats = {
    templates: entries.length,
    layers: entries.reduce((sum, entry) => sum + templates[entry.name].layers.length, 0),
    fixes,
  }
  const result = { spec, stats }
  if (args.out !== undefined && args.out !== null && args.out !== '') {
    if (typeof args.out !== 'string') fail(CODES.ARGS, 'out 必须是路径字符串', { field: 'out' })
    const outAbs = resolvePath(args.out, root)
    assertNotOverwrite([inputSource], outAbs)
    writeJsonFile(outAbs, spec)
    result.out = displayPath(outAbs, root)
    result.bytes = fileSize(outAbs)
  }
  return result
}

/**
 * 把数组/映射两种输入形态归一成 [{ name, template }]。
 * 数组元素缺 template 时按 kind/variant 推导规范名（furn.<kind> / table.h2 / rug.3）。
 */
function normalizeInputTemplates(input, fixes) {
  /** @type {Array<{ name: string, template: object, origin: string }>} */
  const entries = []
  if (Array.isArray(input)) {
    input.forEach((template, index) => {
      if (!template || typeof template !== 'object' || Array.isArray(template)) {
        fail(CODES.SPEC, `templates[${index}] 必须是 TemplateSpec 对象`, { field: `templates[${index}]` })
      }
      const kind = typeof template.kind === 'string' ? template.kind.trim() : ''
      let name = typeof template.template === 'string' ? template.template.trim() : ''
      if (!name) {
        if (!kind) fail(CODES.SPEC, `templates[${index}] 缺少 template（也没有 kind 可推导模板名）`, { field: `templates[${index}].template` })
        name = templateNameOf(kind, template.variant)
        fixes.push(`${name}: 模板名由 kind=${kind}${template.variant ? `/variant=${template.variant}` : ''} 推导`)
      }
      entries.push({ name, template, origin: `templates[${index}]` })
    })
  } else if (input && typeof input === 'object') {
    for (const [key, template] of Object.entries(input)) {
      const name = String(key).trim()
      if (!name) fail(CODES.SPEC, 'templates 的模板名不能为空', { field: 'templates.<name>' })
      if (!template || typeof template !== 'object' || Array.isArray(template)) {
        fail(CODES.SPEC, `模板 ${name} 必须是 TemplateSpec 对象`, { field: `templates.${name}` })
      }
      entries.push({ name, template, origin: `templates.${name}` })
    }
  } else {
    fail(CODES.ARGS, 'templates 必须是 TemplateSpec 数组或 { 模板名: TemplateSpec } 映射', { field: 'templates' })
  }

  if (entries.length === 0) fail(CODES.SPEC, 'templates 不能为空', { field: 'templates' })

  // 重名 = 非法（映射形式本身不会重名，数组形式可能）
  const seen = new Set()
  for (const entry of entries) {
    if (seen.has(entry.name)) fail(CODES.SPEC, `模板名重复：${entry.name}`, { field: `${entry.origin}.template`, name: entry.name })
    seen.add(entry.name)
  }
  return entries
}

/**
 * kind/variant → 规范模板名（与运行时 ui_controller 的 TPL_KEY 语义一致）：
 *   table  → furn.table.1 / furn.table.h2 / furn.table.v2
 *   carpet → furn.rug / furn.rug.2 / furn.rug.3
 *   其它   → furn.<kind>
 */
function templateNameOf(kind, variant) {
  const v = variant === undefined || variant === null || variant === '' ? '1' : String(variant)
  if (kind === 'table') return v === 'h2' ? 'furn.table.h2' : v === 'v2' ? 'furn.table.v2' : 'furn.table.1'
  if (kind === 'carpet') return v === 'h2' ? 'furn.rug.2' : v === 'v2' ? 'furn.rug.3' : 'furn.rug'
  const known = KIND_TEMPLATE[kind]
  if (!known) fail(CODES.SPEC, `kind=${JSON.stringify(kind)} 不是合法家具种类`, { field: 'kind', kind })
  return known
}

/**
 * 规范化单个 TemplateSpec：补默认、修 y_up/order/颜色/画布，并记录 fix。
 * @param {{ name: string, template: object, origin: string }} entry
 * @param {string[]} fixes
 */
function normalizeOneTemplate(entry, fixes) {
  const src = entry.template
  const srcLayers = Array.isArray(src.layers) ? src.layers : []
  const normalized = normalizeTemplateSpec(src, entry.name)

  // 模板名以映射键/推导名为准（数组形态的 template 字段可能带空白）。
  if (normalized.template !== entry.name) {
    fixes.push(`${entry.name}: template 字段 ${JSON.stringify(normalized.template)} → ${entry.name}`)
    normalized.template = entry.name
  }

  // 画布默认值按模板名补（h2/rug.2=216×108、v2/rug.3=108×216、其余 108×108）。
  // 注意：normalizeTemplateSpec 内部按 src.template 取默认画布；这里的模板名以映射键为准，
  // 所以缺省时用 entry.name 重算，避免 template 字段写错导致画布也错。
  if (!(Array.isArray(src.sizePx) && src.sizePx.length === 2)) {
    const canvas = canvasOfTemplate(entry.name)
    normalized.sizePx = [canvas[0], canvas[1]]
    fixes.push(`${entry.name}: 缺省 content 画布按模板名补为 ${canvas[0]}×${canvas[1]}`)
  }

  // layerCount 由 layers.length 决定。
  if (Number(src.layerCount) !== normalized.layers.length) {
    fixes.push(`${entry.name}: layerCount ${JSON.stringify(src.layerCount)} → ${normalized.layers.length}`)
  }

  normalized.layers.forEach((layer, index) => {
    // order 强制 1..N 连续（层顺序 = 数组顺序，从下到上）。
    if (layer.order !== index + 1) {
      fixes.push(`${entry.name} L${index + 1}: order ${JSON.stringify(layer.order)} → ${index + 1}`)
      layer.order = index + 1
    }
    // 颜色统一为 0xAARRGGBB（记录原值 → 规范化值，便于美术核对）。
    const srcLayer = srcLayers[index] && typeof srcLayers[index] === 'object' ? srcLayers[index] : {}
    if (srcLayer.color !== undefined && srcLayer.color !== null && String(srcLayer.color) !== layer.color) {
      fixes.push(`${entry.name} L${index + 1}: color ${JSON.stringify(srcLayer.color)} → ${layer.color}`)
    }
    // y_up = -dy_down（不一致以 dy_down 为准修正）。
    const wantYUp = round2(-layer.dy_down)
    if (!(Math.abs(Number(layer.y_up) - wantYUp) <= 1e-9)) {
      fixes.push(`${entry.name} L${index + 1}: y_up ${JSON.stringify(layer.y_up)} → ${wantYUp}（以 dy_down 为准）`)
      layer.y_up = wantYUp
    }
  })

  return normalized
}
