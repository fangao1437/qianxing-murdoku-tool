// S3b · 预览：ArtSpecSet + Layout → 1600×900 SVG + ValidationReport
//      （交接包 02 §5、06 §7；参考实现 qianxing-murdoku-tool/art/tools/render-preview.mjs）
//
// 输入：
//   spec            json  ArtSpecSet 对象或 JSON 路径
//   layout          json  Layout 对象或 JSON 路径
//   out?            string SVG 输出路径（默认 <工作区>/_work/art-preview.svg）
//   labels?         boolean 是否画件名/房间名调试标签（默认 true）
//   scale?          number 额外缩放（默认 1；1 = 按格子真实像素渲染；只作用于家具层）
//   carpetTemplate? string 'auto'（默认）| 'single'，与 art_slice 同口径（见 slice.js）：
//                         auto   = 运行时 v320+ 契约口径（横跨 rug.2 / 竖跨 rug.3）；
//                         single = 旧离线参考工具口径（一律 furn.rug，用于与参考实现逐字节对拍）。
//
// 输出：
//   { out: string, bytes: number, report: ValidationReport, pieces: number }
//   report 额外带 warnings: string[]（契约 §7 的可选扩展）：
//     auto 口径下 spec 缺 furn.rug.2/furn.rug.3 但存在 furn.rug 时，允许回退用单格模板
//     按 span 拉伸渲染（观感参考），但每一处降级都写进 warnings（report.ok 仍为 true，
//     只是暴露「这是回退观感、需要补模板」；不许静默降级）。
//
// 渲染口径（必须与参考实现一致，交接包 07 坑 23）：
//   · 先画棋盘外框 #0b0a0d，再画每格房间底色，再按 slice 规则画每件家具的每一层；
//   · 缩放 = geometry.cell / spec.cellTemplatePx（5×5=108px、6×6≈89px）；
//   · 图元：矩形 → rect；椭圆 100002 → ellipse；近白圆角板 107102 → 圆角 rect；
//     柔光圆 106056 → ellipse 且 opacity 再乘 0.5；颜色用 0xAARRGGBB 的 alpha；
//   · 只读 ArtSpecSet（不读运行时状态）；缺模板时在 SVG 里留注释并让 report.ok=false。
//
// 与 render-preview.mjs 对拍：carpetTemplate='single' 且基数 spec 下，本函数生成的 SVG 与
// 参考实现逐字节一致（自检 test/self-spec.mjs 覆盖）；auto 口径按契约多跨两个地毯模板键，
// 因此与旧参考实现不再逐字节一致（预期行为）。
import { CANVAS, CELL_TEMPLATE_PX, FRAME } from '../contract.js'
import { CODES, fail } from '../errors.js'
import { boardGeometry, normalizeLayout } from '../geometry.js'
import { assertNotOverwrite, displayPath, fileSize, loadJsonArg, resolvePath, writeTextFile } from '../paths.js'
import { validateSpecDocument } from './validate-spec.js'
import { normalizeCarpetTemplate, slicePieces } from './slice.js'

/** 默认输出：<工作区>/_work/art-preview.svg（交接包约定，_work 是中间产物目录）。 */
const DEFAULT_OUT = '_work/art-preview.svg'

/** 可回退到单格 furn.rug 的地毯专用模板（运行时 v320+ 才有的多格模板）。 */
const CARPET_VARIANT_TEMPLATES = new Set(['furn.rug.2', 'furn.rug.3'])

/** SVG 文本转义（与参考实现 esc 同口径）。 */
function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * 0xAARRGGBB → { fill, alpha }（与 render-preview.mjs 的 colorOf 同口径）。
 * 接受 number / "0xAARRGGBB" / "0X…"；非法值按 0 处理（规格校验会单独报告）。
 */
function colorOf(argb) {
  const v = typeof argb === 'string' ? parseInt(argb.replace(/^0x/i, ''), 16) : argb
  const a = ((v >>> 24) & 0xff) / 255
  const r = (v >>> 16) & 0xff
  const g = (v >>> 8) & 0xff
  const b = v & 0xff
  return { fill: `rgb(${r},${g},${b})`, alpha: a }
}

/**
 * 把 templates 归一成可查找的映射（契约是 {名字:TemplateSpec}；也容忍数组元素带 template）。
 * @returns {Record<string, object>}
 */
function templateMap(templates) {
  const map = Object.create(null)
  if (templates === null || typeof templates !== 'object') return map
  if (Array.isArray(templates)) {
    for (const tpl of templates) {
      if (tpl && typeof tpl === 'object' && typeof tpl.template === 'string') map[tpl.template] = tpl
    }
    return map
  }
  for (const key of Object.keys(templates)) map[key] = templates[key]
  return map
}

/** 取模板画布分量（缺省 = cellTemplatePx），只接受正有限数。 */
function canvasPart(sizePx, index, fallback) {
  const value = Array.isArray(sizePx) ? Number(sizePx[index]) : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 生成 SVG 文本（纯函数，便于与参考实现对拍）。
 * @param {object} spec ArtSpecSet
 * @param {ReturnType<typeof normalizeLayout>} layout
 * @param {{ n:number,pitch:number,cell:number,gx:number,gy:number }} g 棋盘几何
 * @param {Array} pieces 切件结果
 * @param {{ labels:boolean, extraScale:number }} options
 * @returns {{ svg:string, missingTemplates:string[], fallbacks:Array<object>, renderedPieces:number, renderedLayers:number, skippedLayers:number }}
 */
export function renderPreviewSvg(spec, layout, g, pieces, options) {
  const templates = templateMap(spec && spec.templates)
  const cellTemplatePx = Number(spec?.cellTemplatePx) > 0 ? Number(spec.cellTemplatePx) : CELL_TEMPLATE_PX
  // 运行时口径缩放：格子像素 / 模板画布基准（参考实现同一条式子；extraScale 默认 1）
  const baseScale = (g.cell / cellTemplatePx) * options.extraScale
  const roomById = new Map(layout.rooms.map((room) => [String(room.id), room]))

  const parts = []
  const missingTemplates = []
  const fallbacks = []
  let renderedPieces = 0
  let renderedLayers = 0
  let skippedLayers = 0

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">`)
  parts.push(`<rect width="100%" height="100%" fill="#141018"/>`)
  // 棋盘外框（与游戏一致：584×584 @(608,138)，ruler 12，gap 4）
  parts.push(`<rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.size}" height="${FRAME.size}" fill="#0b0a0d" rx="4"/>`)
  // 房间底色（= 运行时 face 层要画的颜色；cells 的行必须从 1 开始对齐）
  for (let r = 1; r <= layout.rows; r++) {
    const row = layout.cells[r - 1] || ''
    for (let c = 1; c <= layout.cols; c++) {
      const room = roomById.get(row[c - 1])
      const color = room ? room.color : '#CCCCCC'
      const x = g.gx + (c - 1) * g.pitch
      const y = g.gy + (r - 1) * g.pitch
      parts.push(`<rect x="${x}" y="${y}" width="${g.cell}" height="${g.cell}" fill="${esc(color)}"/>`)
    }
  }

  // 家具：逐件逐层（锚点格中心 + 整件偏移；图层从下到上）
  for (const piece of pieces) {
    const requestedKey = piece.templateKey
    let tpl = templates[requestedKey]
    let usedKey = requestedKey
    let fallback = false
    // auto 口径降级：缺 rug.2/rug.3 但 spec 有 furn.rug → 回退单格模板、按 span 拉伸（观感参考）
    if (!tpl && piece.kind === 'carpet' && CARPET_VARIANT_TEMPLATES.has(requestedKey) && templates['furn.rug']) {
      tpl = templates['furn.rug']
      usedKey = 'furn.rug'
      fallback = true
    }
    if (!tpl) {
      parts.push(`<!-- 缺模板 ${esc(requestedKey)} -->`)
      missingTemplates.push(requestedKey)
      continue
    }
    if (fallback) {
      fallbacks.push({ name: piece.name, kind: piece.kind, requested: requestedKey, used: usedKey, span: piece.span })
    }

    const cx = g.gx + (piece.anchor.c - 1) * g.pitch + g.cell / 2 + piece.offsetCells.dx * g.pitch
    const cy = g.gy + (piece.anchor.r - 1) * g.pitch + g.cell / 2 + piece.offsetCells.dy * g.pitch
    // 正常路径：等比缩放（与参考实现逐字节一致）。
    // 回退路径：单格模板按实例尺寸（cell×span）非等比拉伸——即运行时「实例尺寸/模板画布」的口径。
    let scaleX = baseScale
    let scaleY = baseScale
    const canvasW = canvasPart(tpl.sizePx, 0, cellTemplatePx)
    const canvasH = canvasPart(tpl.sizePx, 1, cellTemplatePx)
    if (fallback) {
      scaleX = (g.cell * (piece.span?.c || 1) / canvasW) * options.extraScale
      scaleY = (g.cell * (piece.span?.r || 1) / canvasH) * options.extraScale
    }
    const layers = Array.isArray(tpl.layers) ? tpl.layers : []
    renderedPieces += 1
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object') {
        skippedLayers += 1
        continue
      }
      const w = Number(layer.w) * scaleX
      const h = Number(layer.h) * scaleY
      const lx = Number(layer.dx ?? 0) * scaleX
      const ly = Number(layer.dy_down ?? 0) * scaleY
      if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && Number.isFinite(lx) && Number.isFinite(ly))) {
        skippedLayers += 1
        continue
      }
      const x = cx + lx - w / 2
      const y = cy + ly - h / 2
      const col = colorOf(layer.color)
      const opacity = col.alpha < 0.999 ? ` opacity="${col.alpha.toFixed(3)}"` : ''
      const imageId = Number(layer.imageId)
      if (imageId === 100002) {
        // 椭圆
        parts.push(`<ellipse cx="${(x + w / 2).toFixed(2)}" cy="${(y + h / 2).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${(h / 2).toFixed(2)}" fill="${col.fill}"${opacity}/>`)
      } else if (imageId === 107102) {
        // 近白圆角板：圆角半径 = min(w,h)*0.06
        const r = Math.min(w, h) * 0.06
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${r.toFixed(2)}" fill="${col.fill}"${opacity}/>`)
      } else if (imageId === 106056) {
        // 柔光圆：alpha 再乘 0.5
        parts.push(`<ellipse cx="${(x + w / 2).toFixed(2)}" cy="${(y + h / 2).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${(h / 2).toFixed(2)}" fill="${col.fill}" opacity="${(col.alpha * 0.5).toFixed(3)}"/>`)
      } else {
        // 矩形（100001；100003 三角在离线预览里按包围盒矩形画，与参考实现一致）
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${col.fill}"${opacity}/>`)
      }
      renderedLayers += 1
    }
    // 调试标签：件名（导出给美术核对用；labels=false 时干净图）
    if (options.labels) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - canvasH * scaleY / 2 - 4).toFixed(1)}" font-size="10" fill="#ffe9a8" text-anchor="middle">${esc(piece.name)}</text>`)
    }
  }

  // 房间名（白字黑边，和运行时 label 一致；只在房间最后一行画）
  for (let r = 1; r <= layout.rows; r++) {
    const row = layout.cells[r - 1] || ''
    for (let c = 1; c <= layout.cols; c++) {
      const room = roomById.get(row[c - 1])
      if (!room || !room.name) continue
      if (r < layout.rows && (layout.cells[r] || '')[c - 1] === row[c - 1]) continue
      const x = g.gx + (c - 1) * g.pitch + g.cell / 2
      const y = g.gy + (r - 1) * g.pitch + g.cell - 8
      parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="16" fill="#ffffff" stroke="#1F1A14" stroke-width="2" paint-order="stroke" text-anchor="middle">${esc(room.name)}</text>`)
    }
  }
  parts.push('</svg>')

  return { svg: parts.join('\n'), missingTemplates, fallbacks, renderedPieces, renderedLayers, skippedLayers }
}

/**
 * S3b：ArtSpecSet + Layout → SVG 观感基准图 + ValidationReport（契约 §7）。
 * @param {{ spec?: object|string, layout?: object|string, out?: string, labels?: boolean, scale?: number, carpetTemplate?: 'auto'|'single' }} args
 * @param {{ root?: string }} [env]
 * @returns {Promise<{ out:string, bytes:number, report:object, pieces:number }>}
 */
export async function renderArtPreview(args = {}, env = {}) {
  const root = env.root || process.cwd()
  const carpetTemplate = normalizeCarpetTemplate(args.carpetTemplate)
  const specLoaded = loadJsonArg(args.spec, root, 'spec')
  const layoutLoaded = loadJsonArg(args.layout, root, 'layout')
  const spec = specLoaded.value
  const layout = normalizeLayout(layoutLoaded.value)

  // 额外缩放：默认 1（= 格子真实像素）；非法值直接报错，不静默降级。
  let extraScale = 1
  if (args.scale !== undefined && args.scale !== null) {
    extraScale = Number(args.scale)
    if (!(Number.isFinite(extraScale) && extraScale > 0)) {
      fail(CODES.ARGS, `scale 必须是正数（实际 ${JSON.stringify(args.scale)}）`, { field: 'scale', got: args.scale })
    }
  }
  const labels = args.labels === undefined || args.labels === null ? true : !!args.labels

  // 规格校验（报告里带稳定 check id；缺模板/规格字段非法都不抛错，落到 report.ok=false）
  const specReport = validateSpecDocument(spec)

  // 切件与棋盘几何：与 art_slice / render-preview.mjs 同一份规则（carpetTemplate 口径一致）
  const pieces = slicePieces(layout, { carpetTemplate })
  const g = boardGeometry(Math.max(layout.rows, layout.cols))
  const rendered = renderPreviewSvg(spec, layout, g, pieces, { labels, extraScale })
  const { svg } = rendered
  if (!svg.startsWith('<svg') || svg.length === 0) fail(CODES.INTERNAL, 'SVG 生成失败（空输出）', {})

  // 输出（默认 <工作区>/_work/art-preview.svg；不得覆盖输入）
  const outAbs = args.out === undefined || args.out === null || args.out === '' ? resolvePath(DEFAULT_OUT, root) : resolvePath(args.out, root)
  assertNotOverwrite([specLoaded.source, layoutLoaded.source], outAbs)
  writeTextFile(outAbs, svg)
  const bytes = fileSize(outAbs)

  // ── ValidationReport（契约 §7 + warnings 扩展）─────────────────────────
  const warnings = rendered.fallbacks.map(
    (item) =>
      `缺模板 ${item.requested}（地毯「${item.name}」跨 ${item.span.r}×${item.span.c} 格），已回退用 ${item.used} 按 span 拉伸渲染（观感参考）；请补 ${item.requested} 模板并登记 things 引用/画布`,
  )
  const checks = [...specReport.checks]
  const canvasOk = svg.includes(`width="${CANVAS.width}"`) && svg.includes(`height="${CANVAS.height}"`) && svg.includes(`viewBox="0 0 ${CANVAS.width} ${CANVAS.height}"`)
  checks.push(
    canvasOk
      ? { id: 'preview.canvas', ok: true, detail: `${CANVAS.width}×${CANVAS.height}（棋盘 ${g.n}×${g.n}，cell=${g.cell}px，pitch=${g.pitch}）` }
      : { id: 'preview.canvas', ok: false, detail: `SVG 画布必须 ${CANVAS.width}×${CANVAS.height}` },
  )
  const fallbackDetail = rendered.fallbacks.length > 0 ? `；其中 ${rendered.fallbacks.length} 件地毯回退 furn.rug（见 warnings）` : ''
  checks.push(
    rendered.missingTemplates.length === 0
      ? { id: 'preview.templates', ok: true, detail: `模板齐全（${pieces.length} 件${carpetTemplate === 'auto' ? '，carpetTemplate=auto' : ''}）${fallbackDetail}` }
      : { id: 'preview.templates', ok: false, detail: `缺模板：${rendered.missingTemplates.join('/')}（SVG 里以注释占位）` },
  )
  checks.push(
    pieces.length > 0
      ? { id: 'preview.pieces', ok: true, detail: `${pieces.length} 件（渲染 ${rendered.renderedPieces} 件）` }
      : { id: 'preview.pieces', ok: false, detail: '布局里没有家具（pieces 为空）' },
  )
  checks.push(
    rendered.renderedLayers > 0 && rendered.skippedLayers === 0
      ? { id: 'preview.layers', ok: true, detail: `渲染层数 ${rendered.renderedLayers}` }
      : {
          id: 'preview.layers',
          ok: false,
          detail: rendered.renderedLayers === 0 ? '没有渲染任何层（检查 spec.templates/spec.cellTemplatePx）' : `有 ${rendered.skippedLayers} 层因字段非法被跳过`,
        },
  )
  checks.push(bytes !== null && bytes > 0 ? { id: 'preview.generated', ok: true, detail: `SVG ${bytes} 字节` } : { id: 'preview.generated', ok: false, detail: 'SVG 没有写出或为空文件' })

  const report = { version: 1, ok: checks.every((check) => check.ok), checks, warnings }
  return { out: displayPath(outAbs, root), bytes: bytes ?? 0, report, pieces: pieces.length }
}
