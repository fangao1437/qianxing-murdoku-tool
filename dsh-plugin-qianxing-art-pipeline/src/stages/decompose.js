// S1 · 图元拆解：参考图 PNG → ArtSpecSet（交接包 01-图元拆解.md、06 §3）
//
// 输入（tools.js 已校验必填项）：
//   icon?      string   参考图 PNG 路径（mode=compress 必填）；相对路径按工作区根解析
//   kind       string   chair|plant|statue|table|carpet|shelf
//   variant?   string   默认 '1'（table 支持 h2/v2，carpet 支持 2/3，决定模板名与画布）
//   size?      [w,h]    目标像素尺寸（默认：雕像 56×比例；其它家具长边 SPAN×108，按图标比例）
//   mode?      'compress'|'records'  默认 'compress'
//   quantize?  integer  调色板色数（默认 8）
//   std?       number   压缩档位（默认 2；语义见 _work/art-tools/miliastra-image-algorithm/compress.py）
//   records?   json     拟合记录数组（mode=records）：[{imageId,w,h,dx,dy_down,rotDeg,color}]
//                       单位 = 格（×108 转画布 px），参考 01 §3；也可直接给像素口径（units='px'）
//   units?     'cell'|'px'   records 的单位，默认 'cell'
//   canvas?    [w,h]    可选画布覆盖（默认按模板名：单格 108×108，h2/rug.2=216×108，v2/rug.3=108×216）
//   name?      string   ArtSpecSet.name（默认 kind）
//   out?       string   ArtSpecSet JSON 输出路径（可选；输出不得覆盖输入）
//
// 输出：
//   {
//     spec: ArtSpecSet,            // 契约 §3，可直接交给 art_build_spec / art_preview / art_write_gil
//     out?: string,                // 已写出的路径（相对工作区）
//     stats: { mode, blocks, rawBlocks, holes, overlaps, outOfBounds, mae, maeAll, colors,
//              canvas, box, size, palette }
//   }
//
// 硬约束（交接包 07）：
//   · 只允许官方基础形状 imageId ∈ {100001,100002,100003,107102,106056}；
//   · 压缩块互不重叠（空洞/重叠/越界必须为 0 才继续；不满足抛 E_SPEC_INVALID）；
//   · 颜色 0xAARRGGBB；透明背景（alpha<128）在压缩前键控成洋红 (255,0,255)，压缩后整块过滤；
//   · 坐标 dx 右正、dy_down 下正、y_up=-dy_down；dx=x+w/2-W/2、dy_down=y+h/2-H/2（W/H=图标尺寸）；
//   · 不读官方贴图之外的外部素材，不写 .gil —— 本阶段只产出规格 JSON。
import path from 'node:path'
import { CODES, fail } from '../errors.js'
import {
  ALLOWED_IMAGE_IDS,
  CELL_TEMPLATE_PX,
  KIND_TEMPLATE,
  KINDS,
  canvasOfTemplate,
  normalizeColor,
  normalizeLayer,
  normalizeTemplateSpec,
  round2,
} from '../contract.js'
import { assertNotOverwrite, displayPath, readBinaryFile, readJsonFile, resolvePath, writeJsonFile } from '../paths.js'
import { decodePng } from '../png.js'
import {
  DEFAULT_QUANTIZE,
  DEFAULT_STD,
  MAGENTA,
  compressImage,
  cropAlphaContent,
  defaultTargetSize,
  rgbToHex6,
} from '../compress.js'

/** 单边目标尺寸上限（压缩是 O(像素×块) 的，防离谱参数拖死工具）。 */
const MAX_TARGET_DIM = 1024

/** imageId → 层（压缩路线固定用矩形；其它路线按 records 给定）。 */
const RECT_IMAGE_ID = 100001

/**
 * 家具种类 + 变体 → 模板键（与 contract.KIND_TEMPLATE / TEMPLATE_CANVAS 对齐）。
 * table：h2=216×108 / v2=108×216；carpet：2=216×108 / 3=108×216。
 */
function templateKeyOf(kind, variant) {
  if (kind === 'table' && (variant === 'h2' || variant === 'v2')) return `furn.table.${variant}`
  if (kind === 'carpet' && (variant === '2' || variant === '3')) return `furn.rug.${variant}`
  return KIND_TEMPLATE[kind]
}

/** 解析画布：[w,h]；默认按模板名（单格 108×108，多格 216/108）。 */
function resolveCanvas(args, env, templateKey) {
  let override = null
  if (Array.isArray(args.canvas)) override = args.canvas
  else if (Array.isArray(env?.config?.canvasSizePx)) override = env.config.canvasSizePx
  if (override) {
    if (override.length !== 2) fail(CODES.ARGS, 'canvas 必须是 [w,h]', { canvas: override })
    const w = Math.round(Number(override[0]))
    const h = Math.round(Number(override[1]))
    if (!(w > 0 && h > 0)) fail(CODES.ARGS, 'canvas 必须是 [w,h] 正整数', { canvas: override })
    return [w, h]
  }
  return canvasOfTemplate(templateKey)
}

/** 解析压缩目标尺寸：[w,h]；缺省按 kind + 裁切后图标比例推导（雕像 56×91 基线）。 */
function resolveTargetSize(raw, kind, cropBox) {
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw) || raw.length !== 2) fail(CODES.ARGS, 'size 必须是 [w,h]', { size: raw })
    const w = Math.round(Number(raw[0]))
    const h = Math.round(Number(raw[1]))
    if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) {
      fail(CODES.ARGS, 'size 必须是 [w,h] 正整数', { size: raw })
    }
    if (w > MAX_TARGET_DIM || h > MAX_TARGET_DIM) {
      fail(CODES.ARGS, `size 单边不能超过 ${MAX_TARGET_DIM}（压缩太慢）`, { size: raw })
    }
    return [w, h]
  }
  return defaultTargetSize(kind, cropBox.w, cropBox.h)
}

/** 校验一条层记录满足契约（imageId / 颜色 / 尺寸 / y_up / order）。 */
function assertLayersContract(layers) {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (layer.order !== i + 1) {
      fail(CODES.SPEC, `第 ${i + 1} 层 order 必须是 ${i + 1}`, { order: layer.order })
    }
    if (!ALLOWED_IMAGE_IDS.includes(layer.imageId)) {
      fail(CODES.SPEC, `第 ${i + 1} 层 imageId 非法（只允许 ${ALLOWED_IMAGE_IDS.join('/')}）`, { imageId: layer.imageId })
    }
    if (typeof layer.color !== 'string' || !/^0x[0-9A-F]{8}$/.test(layer.color)) {
      fail(CODES.SPEC, `第 ${i + 1} 层颜色必须是 0xAARRGGBB`, { color: layer.color })
    }
    if (!(Number.isFinite(layer.w) && layer.w > 0 && Number.isFinite(layer.h) && layer.h > 0)) {
      fail(CODES.SPEC, `第 ${i + 1} 层 w/h 必须 > 0`, { w: layer.w, h: layer.h })
    }
    if (Math.abs(layer.y_up + layer.dy_down) > 0.011) {
      fail(CODES.SPEC, `第 ${i + 1} 层必须满足 y_up = -dy_down`, { y_up: layer.y_up, dy_down: layer.dy_down })
    }
    if (!Number.isFinite(layer.rotDeg)) {
      fail(CODES.SPEC, `第 ${i + 1} 层 rotDeg 必须是有限数`, { rotDeg: layer.rotDeg })
    }
  }
}

/** 组装 ArtSpecSet（契约 §3）。 */
function buildSpecSet({ name, source, templateKey, kind, variant, canvas, layers }) {
  const template = normalizeTemplateSpec(
    { template: templateKey, kind, variant, sizePx: canvas, layerCount: layers.length, layers },
    templateKey,
  )
  return {
    version: 1,
    name,
    source,
    cellTemplatePx: CELL_TEMPLATE_PX,
    templates: { [templateKey]: template },
  }
}

/** 写出 ArtSpecSet（不得覆盖输入文件），返回相对工作区路径。 */
function maybeWriteOut(args, root, inputs, spec) {
  if (args.out === undefined || args.out === null || args.out === '') return undefined
  if (typeof args.out !== 'string') fail(CODES.ARGS, 'out 必须是字符串路径', { out: typeof args.out })
  const outAbs = resolvePath(args.out, root)
  assertNotOverwrite(inputs, outAbs)
  writeJsonFile(outAbs, spec)
  return displayPath(outAbs, root)
}

/** mode=compress：参考 PNG → 压缩块 → 层。 */
async function decomposeByCompress(args, root, common) {
  if (args.icon === undefined || args.icon === null || args.icon === '') {
    fail(CODES.ARGS, 'mode=compress 时 icon（参考图 PNG）必填', { mode: args.mode ?? 'compress' })
  }
  if (typeof args.icon !== 'string') fail(CODES.ARGS, 'icon 必须是字符串路径', { icon: typeof args.icon })
  const iconAbs = resolvePath(args.icon, root)
  const png = readBinaryFile(iconAbs, '参考图 PNG')
  const image = decodePng(png)

  const quantize = args.quantize === undefined || args.quantize === null ? DEFAULT_QUANTIZE : args.quantize
  if (!Number.isInteger(quantize) || quantize < 1 || quantize > 256) {
    fail(CODES.ARGS, 'quantize 必须是 1..256 的整数', { quantize: args.quantize })
  }
  const std = args.std === undefined || args.std === null ? DEFAULT_STD : Number(args.std)
  if (!Number.isFinite(std) || std < 0 || std > 1024) {
    fail(CODES.ARGS, 'std 必须是 0..1024 的数值', { std: args.std })
  }

  // 裁掉四周空白 → 按图标比例推导默认目标尺寸（size 参数优先）→ 压缩
  const cropped = cropAlphaContent(image)
  const size = resolveTargetSize(args.size, common.kind, cropped.box)
  const result = compressImage(cropped.image, { size, quantize, std, crop: false })
  const { width: iconW, height: iconH, blocks, stats } = result

  // 自检：块几何必须完整覆盖、互不重叠、不越界（compress.py 的口径）
  if (stats.holes !== 0 || stats.overlaps !== 0 || stats.outOfBounds !== 0) {
    fail(CODES.SPEC, '压缩自检失败：空洞/重叠/越界必须为 0', {
      holes: stats.holes,
      overlaps: stats.overlaps,
      outOfBounds: stats.outOfBounds,
      size: [iconW, iconH],
    })
  }

  // 过滤洋红背景块 → 模板层（坐标换到 content 中心：dx=x+w/2-W/2、dy_down=y+h/2-H/2）
  const layers = []
  for (const block of blocks) {
    if (block.r === MAGENTA[0] && block.g === MAGENTA[1] && block.b === MAGENTA[2]) continue
    const dx = block.x + block.w / 2 - iconW / 2
    const dyDown = block.y + block.h / 2 - iconH / 2
    layers.push(
      normalizeLayer(
        {
          order: layers.length + 1,
          imageId: RECT_IMAGE_ID,
          color: `0xFF${rgbToHex6(block.r, block.g, block.b)}`,
          w: block.w,
          h: block.h,
          dx: round2(dx),
          dy_down: round2(dyDown),
          y_up: round2(-dyDown),
          rotDeg: 0,
        },
        layers.length,
      ),
    )
  }
  if (layers.length === 0) {
    fail(CODES.SPEC, '压缩后没有任何前景块（参考图可能全透明或颜色都落在背景键控色上）', {
      size: [iconW, iconH],
      rawBlocks: blocks.length,
    })
  }
  assertLayersContract(layers)

  const source = {
    mode: 'compress',
    icon: path.basename(iconAbs),
    quantize,
    std,
    size: [iconW, iconH],
    blocks: blocks.length, // 含背景块的总块数（= compress.py 的 NBLK）
    layers: layers.length, // 过滤背景后实际层数
    mae: round2(stats.mae),
  }
  const spec = buildSpecSet({
    name: common.name,
    source,
    templateKey: common.templateKey,
    kind: common.kind,
    variant: common.variant,
    canvas: common.canvas,
    layers,
  })
  const out = maybeWriteOut(args, root, [iconAbs], spec)
  return {
    spec,
    out,
    stats: {
      mode: 'compress',
      template: common.templateKey,
      blocks: layers.length,
      rawBlocks: blocks.length,
      holes: stats.holes,
      overlaps: stats.overlaps,
      outOfBounds: stats.outOfBounds,
      mae: stats.mae,
      maeAll: stats.maeAll,
      colors: stats.colors,
      palette: stats.paletteColors,
      canvas: [...common.canvas],
      box: { ...cropped.box }, // 裁切盒（原图像素坐标）
      size: [iconW, iconH],
    },
  }
}

/** records 单位换算：格 ×108，像素 ×1。 */
function recordScale(units) {
  if (units === 'cell') return CELL_TEMPLATE_PX
  if (units === 'px') return 1
  fail(CODES.ARGS, "units 必须是 'cell' 或 'px'", { units })
}

/** mode=records：外部拟合工具的图元记录 → 层。 */
function decomposeByRecords(args, root, common) {
  if (args.records === undefined || args.records === null) {
    fail(CODES.ARGS, 'mode=records 时 records（图元记录数组）必填', { mode: 'records' })
  }
  let records = args.records
  let recordsSource = null
  if (typeof records === 'string') {
    recordsSource = resolvePath(records, root)
    records = readJsonFile(recordsSource, 'records')
  }
  if (records && !Array.isArray(records) && Array.isArray(records.records)) records = records.records
  if (!Array.isArray(records)) fail(CODES.ARGS, 'records 必须是数组或 JSON 文件路径', { type: typeof records })
  if (records.length === 0) fail(CODES.ARGS, 'records 不能为空数组')
  const units = args.units === undefined || args.units === null ? 'cell' : String(args.units)
  const scale = recordScale(units)

  const layers = records.map((record, index) => {
    const where = `records[${index}]`
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail(CODES.SPEC, `${where} 必须是对象`)
    const imageId = Number(record.imageId)
    if (!ALLOWED_IMAGE_IDS.includes(imageId)) {
      fail(CODES.SPEC, `${where}.imageId 非法（只允许 ${ALLOWED_IMAGE_IDS.join('/')}）`, { imageId: record.imageId })
    }
    const color = normalizeColor(record.color)
    if (color === null) fail(CODES.SPEC, `${where}.color 必须是 0xAARRGGBB`, { color: record.color })
    const rawW = Number(record.w)
    const rawH = Number(record.h)
    const w = rawW * scale
    const h = rawH * scale
    if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
      fail(CODES.SPEC, `${where}.w/h 必须 > 0`, { w: record.w, h: record.h })
    }
    const rawDx = record.dx === undefined || record.dx === null ? 0 : Number(record.dx)
    // dy_down 为准；兼容外部工具常见的 dy（仍是向下为正）写法
    const rawDy =
      record.dy_down !== undefined && record.dy_down !== null
        ? Number(record.dy_down)
        : record.dy !== undefined && record.dy !== null
          ? Number(record.dy)
          : 0
    if (!Number.isFinite(rawDx) || !Number.isFinite(rawDy)) {
      fail(CODES.SPEC, `${where}.dx/dy_down 必须是数字`, { dx: record.dx, dy_down: record.dy_down })
    }
    const rotDeg = record.rotDeg === undefined || record.rotDeg === null ? 0 : Number(record.rotDeg)
    if (!Number.isFinite(rotDeg)) fail(CODES.SPEC, `${where}.rotDeg 必须是有限数`, { rotDeg: record.rotDeg })
    const dx = rawDx * scale
    const dyDown = rawDy * scale
    return normalizeLayer(
      {
        order: index + 1,
        imageId,
        color,
        w,
        h,
        dx,
        dy_down: dyDown,
        y_up: -dyDown,
        rotDeg,
      },
      index,
    )
  })
  assertLayersContract(layers)

  const spec = buildSpecSet({
    name: common.name,
    source: { mode: 'fit', records: layers.length, units },
    templateKey: common.templateKey,
    kind: common.kind,
    variant: common.variant,
    canvas: common.canvas,
    layers,
  })
  const out = maybeWriteOut(args, root, [recordsSource], spec)
  return {
    spec,
    out,
    stats: {
      mode: 'records',
      sourceMode: 'fit',
      template: common.templateKey,
      blocks: layers.length,
      rawBlocks: records.length,
      holes: 0,
      overlaps: 0,
      outOfBounds: 0,
      mae: null,
      maeAll: null,
      colors: new Set(layers.map((l) => l.color)).size,
      palette: null,
      canvas: [...common.canvas],
      box: null,
      size: null,
      units,
    },
  }
}

/**
 * S1 图元拆解入口。
 * @param {object} args art_decompose 工具入参
 * @param {{root?:string, config?:object, signal?:AbortSignal}} [env] 工具环境（工作区根/配置）
 */
export async function decomposeArtSpec(args, env) {
  const input = args && typeof args === 'object' ? args : {}
  const root = env && typeof env.root === 'string' && env.root ? env.root : process.cwd()

  const mode = input.mode === undefined || input.mode === null ? 'compress' : String(input.mode)
  if (mode !== 'compress' && mode !== 'records') {
    fail(CODES.ARGS, "mode 必须是 'compress' 或 'records'", { mode: input.mode })
  }
  const kind = input.kind === undefined || input.kind === null ? '' : String(input.kind)
  if (!KINDS.includes(kind)) fail(CODES.ARGS, `kind 必须是 ${KINDS.join('|')} 之一`, { kind: input.kind })
  const variant = input.variant === undefined || input.variant === null ? '1' : String(input.variant)
  const templateKey = templateKeyOf(kind, variant)
  const name = input.name === undefined || input.name === null ? kind : String(input.name)
  const canvas = resolveCanvas(input, env, templateKey)
  const common = { kind, variant, templateKey, name, canvas }

  if (mode === 'records') return decomposeByRecords(input, root, common)
  return decomposeByCompress(input, root, common)
}

export default decomposeArtSpec
