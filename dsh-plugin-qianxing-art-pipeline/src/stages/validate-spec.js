// 规格校验（S2/S3 共用；art_validate target=spec 的内核）。
// 参考实现 qianxing-murdoku-tool/art/tools/check-spec.mjs。
//
// 输入：ArtSpecSet（契约 §3）
// 输出（ValidationReport 契约 §7）：
//   { version:1, ok:boolean, checks:[{ id, ok, detail? }] }
//
// 检查 id 稳定性（本文件是唯一来源，改动 id 视为破坏性变更）：
//   spec.document           ArtSpecSet 必须是对象
//   spec.version            version 缺省视为 1，出现则必须 = 1
//   spec.cellTemplatePx     必须 = 108（1 格 = 108 content 画布像素）
//   spec.templates          templates 必须是非空映射（支持 {名字:TemplateSpec}）
//   spec.imageIds           可选；出现时 rect/ellipse 必须是 100001/100002
//   template.<名字>.name    模板名非空；TemplateSpec.template 出现时必须与键一致
//   template.<名字>.kind    kind ∈ chair/plant/statue/table/carpet/shelf
//   template.<名字>.sizePx  content 画布与模板名匹配（h2/rug.2=216×108，v2/rug.3=108×216）
//   template.<名字>.layerCount  layerCount = layers.length
//   template.<名字>.layers  层数组非空且 ≤ 2000
//   template.<名字>.order   order 从 1 连续递增（数组顺序 = 从下到上）
//   template.<名字>.imageId imageId ∈ {100001,100002,100003,107102,106056}
//   template.<名字>.color   color 匹配 0xAARRGGBB（hex 大小写均可，前缀 0x/0X 均可）
//   template.<名字>.size    w/h ∈ (0,240]
//   template.<名字>.position dx/dy_down 有限，y_up = -dy_down（容差 0.011px）
//   template.<名字>.rotation rotDeg 出现时必须是有限数
//   template.furn.rug.three-layer-rule  地毯三层 108 > 82.1 > 64.8 且居中
//
// 基线兼容（真实 furniture_templates.json 必须 ok=true）：
//   · 基线档顶层没有 version 字段 ⇒ 缺省按 1（不因此判失败）；
//   · 每个 TemplateSpec 用映射键当名字，没有 template 字段（出现时才校验一致性）；
//   · 基线颜色前缀是大写 0X（check-spec.mjs 的 /^0[xX]/ 口径），hex 大小写不强制；
//   · layers 里的附加字段（如 shape/desc）忽略；rotDeg 可选。
import { ALLOWED_IMAGE_IDS, CELL_TEMPLATE_PX, KINDS, canvasOfTemplate } from '../contract.js'

/** 尺寸/位置容差（契约 §0：0.011px）。 */
const TOL = 0.011
/** 单模板层数上限（防呆：模板层不占控件组预算，但也不能无限大）。 */
const MAX_LAYERS = 2000
/** 单层宽高上限（check-spec.mjs 口径：w/h ∈ (0,240]）。 */
const MAX_DIM = 240
/** 颜色文本：0xAARRGGBB（允许 0X 大写前缀，hex 大小写均可）。 */
const COLOR_RE = /^0[xX][0-9A-Fa-f]{8}$/

/**
 * 校验 ArtSpecSet，返回 ValidationReport（契约 §7）。不抛错，失败体现在 ok/checks。
 * @param {object} spec ArtSpecSet（或至少含 cellTemplatePx/templates 的同构对象）
 * @param {{ strict?: boolean }} [opts] strict 默认 true；对真实基线档的缺省字段（version/template）
 *        两种模式都容忍（真实 furniture_templates.json 必须 ok=true）
 * @returns {{ version:number, ok:boolean, checks:Array<{id:string, ok:boolean, detail?:string}> }}
 */
export function validateSpecDocument(spec, opts = {}) {
  const strict = opts && opts.strict !== false
  const checks = []
  /** 追加一条 check；detail 只在需要时出现（ok 的检查也能带说明）。 */
  const push = (id, ok, detail) => {
    const entry = { id, ok: !!ok }
    if (detail !== undefined && detail !== null && String(detail).length > 0) entry.detail = String(detail)
    checks.push(entry)
    return entry
  }

  // ── 顶层 ────────────────────────────────────────────────────────────────
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    push('spec.document', false, 'ArtSpecSet 必须是对象（允许内联 JSON 或 JSON 文件路径）')
    return report(checks)
  }
  push('spec.document', true)

  if (spec.version === undefined || spec.version === null) {
    push('spec.version', true, 'version 缺省按 1 处理（基线档兼容）')
  } else {
    push('spec.version', Number(spec.version) === 1, `version 必须是 1（实际 ${JSON.stringify(spec.version)}）`)
  }

  push(
    'spec.cellTemplatePx',
    Number(spec.cellTemplatePx) === CELL_TEMPLATE_PX,
    `cellTemplatePx 必须是 ${CELL_TEMPLATE_PX}（1 格 = ${CELL_TEMPLATE_PX} content 画布像素；实际 ${JSON.stringify(spec.cellTemplatePx)}）`,
  )

  const entries = templateEntries(spec.templates)
  push(
    'spec.templates',
    entries.length > 0,
    entries.length > 0 ? undefined : 'templates 必须是非空映射 { 模板名: TemplateSpec }',
  )
  pushImageIds(checks, spec.imageIds)

  // ── 逐模板 ──────────────────────────────────────────────────────────────
  for (const { name, tpl } of entries) validateTemplate(checks, name, tpl, strict)

  // ── 地毯三层规则（只对 furn.rug；交接包 02 §2：108 → 82.1 → 64.8，居中）─
  const rug = entries.find((entry) => entry.name === 'furn.rug')
  if (rug) validateRugThreeLayers(checks, rug.tpl)

  return report(checks)
}

/** 组装 ValidationReport。 */
function report(checks) {
  return { version: 1, ok: checks.every((check) => check.ok), checks }
}

/**
 * 把 templates 归一成 [{ name, tpl }]。
 * 契约是 { 名字: TemplateSpec }；也容忍数组（元素带 template 字段时用字段当名字）。
 */
function templateEntries(templates) {
  if (templates === null || typeof templates !== 'object') return []
  if (Array.isArray(templates)) {
    return templates.map((tpl, index) => ({
      name: String(tpl && typeof tpl === 'object' ? (tpl.template ?? '') : ''),
      tpl,
      index,
    }))
  }
  return Object.keys(templates).map((name) => ({ name, tpl: templates[name] }))
}

/** imageIds 映射检查（可选字段；check-spec 口径 rect=100001 / ellipse=100002）。 */
function pushImageIds(checks, imageIds) {
  const id = 'spec.imageIds'
  if (imageIds === undefined || imageIds === null) {
    // 可选字段：缺省不阻断（写入器按官方基础形状默认值写）；不算「跳过检查」。
    checks.push({ id, ok: true, detail: 'imageIds 可选；缺省时写入器使用官方基础形状默认 100001/100002' })
    return
  }
  if (typeof imageIds !== 'object' || Array.isArray(imageIds)) {
    checks.push({ id, ok: false, detail: 'imageIds 必须是对象 { rect, ellipse?, round?, shadowSoft? }' })
    return
  }
  const problems = []
  if (Number(imageIds.rect) !== 100001) problems.push(`rect 必须是 100001（实际 ${JSON.stringify(imageIds.rect)}）`)
  if (Number(imageIds.ellipse) !== 100002) problems.push(`ellipse 必须是 100002（实际 ${JSON.stringify(imageIds.ellipse)}）`)
  for (const key of ['round', 'shadowSoft', 'tri']) {
    if (imageIds[key] !== undefined && !ALLOWED_IMAGE_IDS.includes(Number(imageIds[key]))) {
      problems.push(`${key} 必须是官方基础形状之一（实际 ${JSON.stringify(imageIds[key])}）`)
    }
  }
  checks.push(problems.length === 0 ? { id, ok: true } : { id, ok: false, detail: problems.join('；') })
}

/** 单个模板的全部检查（每个 aspect 一条稳定 id；聚合成一条，detail 带第一处失败）。 */
function validateTemplate(checks, name, tpl, strict) {
  const tag = `template.${name || '(无名)'}`
  const safeTpl = tpl && typeof tpl === 'object' && !Array.isArray(tpl) ? tpl : null
  const layers = safeTpl && Array.isArray(safeTpl.layers) ? safeTpl.layers : null
  const layersUsable = layers !== null
  const notArray = 'layers 必须是数组'
  const check = (aspect, problem) => checks.push(describe(`${tag}.${aspect}`, problem))

  // name：映射键非空；TemplateSpec.template 出现时必须等于键。
  let nameProblem = null
  if (!name) nameProblem = '模板名不能为空（映射键/TemplateSpec.template）'
  else if (safeTpl && safeTpl.template !== undefined && safeTpl.template !== null && String(safeTpl.template) !== name) {
    nameProblem = `template 字段 ${JSON.stringify(safeTpl.template)} 与映射键 ${JSON.stringify(name)} 不一致`
  }
  check('name', nameProblem)

  // kind
  check('kind', KINDS.includes(String(safeTpl?.kind ?? '')) ? null : `kind 必须是 ${KINDS.join('/')} 之一（实际 ${JSON.stringify(safeTpl?.kind)}）`)

  // sizePx：与模板名对应的 content 画布一致（h2/rug.2=216×108，v2/rug.3=108×216，其余 108×108）
  const want = canvasOfTemplate(name)
  let sizeProblem = null
  const sizePx = safeTpl?.sizePx
  if (!Array.isArray(sizePx) || sizePx.length !== 2) sizeProblem = `sizePx 必须是 [w,h]（实际 ${JSON.stringify(sizePx)}）`
  else if (!(Number.isFinite(Number(sizePx[0])) && Number.isFinite(Number(sizePx[1])))) sizeProblem = `sizePx 含非法数字（实际 ${JSON.stringify(sizePx)}）`
  else if (Math.abs(Number(sizePx[0]) - want[0]) > TOL || Math.abs(Number(sizePx[1]) - want[1]) > TOL) {
    sizeProblem = `sizePx 应为 ${want[0]}×${want[1]}（模板名 ${name}；实际 ${sizePx[0]}×${sizePx[1]}）`
  }
  check('sizePx', sizeProblem)

  // layerCount = layers.length
  let layerCountProblem = null
  if (!layersUsable) layerCountProblem = notArray
  else if (Number(safeTpl.layerCount) !== layers.length) layerCountProblem = `layerCount 应等于 layers.length=${layers.length}（实际 ${JSON.stringify(safeTpl.layerCount)}）`
  check('layerCount', layerCountProblem)

  // layers 本身：非空、≤ 上限
  let layersProblem = null
  if (!layersUsable) layersProblem = notArray
  else if (layers.length === 0) layersProblem = 'layers 不能为空'
  else if (layers.length > MAX_LAYERS) layersProblem = `层数 ${layers.length} 超过上限 ${MAX_LAYERS}`
  check('layers', layersProblem)

  // order 1..N 连续
  check(
    'order',
    layersUsable
      ? firstProblem(layers, (layer, index) =>
          Number.isInteger(layer?.order) && layer.order === index + 1 ? null : `L${index + 1} 的 order 应为 ${index + 1}（实际 ${JSON.stringify(layer?.order)}）`,
        )
      : notArray,
  )

  // imageId ∈ 官方基础形状
  check(
    'imageId',
    layersUsable
      ? firstProblem(layers, (layer, index) =>
          ALLOWED_IMAGE_IDS.includes(Number(layer?.imageId)) ? null : `L${index + 1} imageId ${JSON.stringify(layer?.imageId)} 不在允许集合 ${ALLOWED_IMAGE_IDS.join('/')}`,
        )
      : notArray,
  )

  // color 0xAARRGGBB
  check(
    'color',
    layersUsable
      ? firstProblem(layers, (layer, index) => (COLOR_RE.test(String(layer?.color)) ? null : `L${index + 1} color ${JSON.stringify(layer?.color)} 不是 0xAARRGGBB`))
      : notArray,
  )

  // size：w/h ∈ (0,240]
  check(
    'size',
    layersUsable
      ? firstProblem(layers, (layer, index) => {
          const w = Number(layer?.w)
          const h = Number(layer?.h)
          if (Number.isFinite(w) && w > 0 && w <= MAX_DIM && Number.isFinite(h) && h > 0 && h <= MAX_DIM) return null
          return `L${index + 1} w/h 必须在 (0,${MAX_DIM}]（实际 ${JSON.stringify(layer?.w)}×${JSON.stringify(layer?.h)}）`
        })
      : notArray,
  )

  // position：dx/dy_down 有限，y_up = -dy_down
  check(
    'position',
    layersUsable
      ? firstProblem(layers, (layer, index) => {
          const dx = strict ? Number(layer?.dx) : Number(layer?.dx ?? 0)
          const dy = Number(layer?.dy_down)
          const yUp = Number(layer?.y_up)
          if (!Number.isFinite(dx)) return `L${index + 1} dx 必须是有限数（实际 ${JSON.stringify(layer?.dx)}）`
          if (!Number.isFinite(dy)) return `L${index + 1} dy_down 必须是有限数（实际 ${JSON.stringify(layer?.dy_down)}）`
          if (!Number.isFinite(yUp)) return `L${index + 1} y_up 必须是有限数（实际 ${JSON.stringify(layer?.y_up)}）`
          if (Math.abs(yUp + dy) > TOL) return `L${index + 1} y_up 必须等于 -dy_down（y_up=${yUp}, dy_down=${dy}）`
          return null
        })
      : notArray,
  )

  // rotation：rotDeg 可选，出现时必须是有限数
  check(
    'rotation',
    layersUsable
      ? firstProblem(layers, (layer, index) => {
          if (layer?.rotDeg === undefined || layer?.rotDeg === null) return null
          return Number.isFinite(Number(layer.rotDeg)) ? null : `L${index + 1} rotDeg 必须是有限数（实际 ${JSON.stringify(layer.rotDeg)}）`
        })
      : notArray,
  )
}

/** 地毯三层规则（交接包 02 §2：外框 108² → 内面 82.1² → 内线 64.8²，三层居中）。 */
function validateRugThreeLayers(checks, tpl) {
  const id = 'template.furn.rug.three-layer-rule'
  const layers = tpl && Array.isArray(tpl.layers) ? tpl.layers : null
  if (!layers) {
    checks.push({ id, ok: false, detail: 'furn.rug.layers 必须是数组' })
    return
  }
  const problems = []
  if (layers.length !== 3) problems.push(`furn.rug 必须恰好 3 层（实际 ${layers.length}）`)
  const expect = [
    [108, 108, '外框'],
    [82.1, 82.1, '内面'],
    [64.8, 64.8, '内线'],
  ]
  for (let i = 0; i < Math.min(layers.length, 3); i++) {
    const layer = layers[i]
    const [w, h, label] = expect[i]
    if (Math.abs(Number(layer?.w) - w) > TOL || Math.abs(Number(layer?.h) - h) > TOL) {
      problems.push(`L${i + 1} ${label}应为 ${w}×${h}（实际 ${JSON.stringify(layer?.w)}×${JSON.stringify(layer?.h)}）`)
    }
  }
  // 三层必须居中（dx = dy_down = 0）；整块外侧的边框不能被拉伸错位。
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (Math.abs(Number(layer?.dx ?? 0)) > TOL || Math.abs(Number(layer?.dy_down ?? 0)) > TOL) {
      problems.push(`L${i + 1} 必须居中（dx=dy_down=0；实际 ${JSON.stringify(layer?.dx)}/${JSON.stringify(layer?.dy_down)}）`)
    }
  }
  checks.push(problems.length === 0 ? { id, ok: true } : { id, ok: false, detail: problems.join('；') })
}

/** 把「第一处失败说明」包成 check（null/undefined = 通过）。 */
function describe(id, problem) {
  return problem === null || problem === undefined ? { id, ok: true } : { id, ok: false, detail: String(problem) }
}

/** 遍历层，返回第一处失败说明（null = 全部通过）。 */
function firstProblem(layers, test) {
  for (let i = 0; i < layers.length; i++) {
    const problem = test(layers[i], i)
    if (problem) return problem
  }
  return null
}
