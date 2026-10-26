// S1 设计图解析：网格平面设计图 PNG → SceneSpec v1（约定见 examples/DESIGN-FORMAT.md）
//
// 输入（工具参数）：
//   design        string  PNG 路径（必填）
//   legend        json    图例（对象或 JSON 路径）：
//                 { cellPx, margin, rows, cols, metersPerCell,
//                   roomColors: { "#RRGGBB": {name, color?} },
//                   objectColors: { "#RRGGBB": {kind, color?, sizeCells?, heightM?} },
//                   wallColor, doorColor, voidColor }
//                 legend 缺省时自动找设计图旁的旁挂图例：<同名>.legend.json / <同名>.meta.json
//   rows/cols/cellPx/margin/metersPerCell  可选覆盖图例
//   out          可选：SceneSpec JSON 输出路径（不得覆盖输入）
//   previewOut   可选：俯视预览 PNG 输出路径（不得覆盖输入）
//
// 输出：
//   {
//     spec: SceneSpec v1（已规范化 + validateSceneSpec 通过）,
//     out?: string, previewOut?: string,
//     report: ValidationReport,
//     stats: { rows, cols, cellPx, cellMeters, rooms, walls, doors, objects, unassigned },
//     warnings: string[]      // 无法分类的颜色/格子必须列出，不静默吞
//   }
//
// 实现要求（与约定逐条对齐，检测逻辑在 src/plan.js）：
//   · 用 src/lib/png.js 的 decodePng 解码；按 legend 的 cellPx/margin 建立格坐标；
//   · 格中心像素色 → roomColors / objectColors / voidColor；4 邻接合并房间与家具；
//   · 每条格边采样带判墙（wallColor）与门（doorColor → openings）；
//   · 像素坐标 → 米：物件中心 x=(c-1+0.5)*m、z=(r-1+0.5)*m；墙用格线交点；
//     bounds = cols*m × rows*m；grid 写回 cell/rows/cols；
//   · 家具 size 默认按 sizeCells（缺省 0.7 格）与 heightM/kind 默认；
//   · 输出前用 validateSceneSpec 校验，结构错抛 E_SPEC_INVALID。
import path from 'node:path'
import { CODES, fail } from '../errors.js'
import {
  assertNotOverwrite,
  displayPath,
  exists,
  loadJsonArg,
  readBinaryFile,
  resolvePath,
  writeBinaryFile,
  writeJsonFile,
} from '../paths.js'
import { decodePng } from '../lib/png.js'
import { normalizeSceneSpec, validateSceneSpec } from '../scene-spec.js'
import { analyzePlanImage, normalizePlanLegend, renderPlanPreview } from '../plan.js'

/**
 * 图例缺省时的旁挂文件查找：<同名>.legend.json > <同名>.meta.json（DESIGN-FORMAT.md §1 的 meta.json）。
 * @returns {string|null} 绝对路径；找不到返回 null
 */
function findSidecarLegend(designAbs) {
  const dir = path.dirname(designAbs)
  const stem = path.basename(designAbs, path.extname(designAbs))
  for (const name of [`${stem}.legend.json`, `${stem}.meta.json`]) {
    const candidate = path.join(dir, name)
    if (exists(candidate)) return candidate
  }
  return null
}

/** 把「相对工作区」的展示路径还原成绝对路径（out/previewOut 回读用；绝对路径原样返回）。 */
function resolveOutput(args, key, root) {
  const value = args?.[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') fail(CODES.ARGS, `${key} 必须是字符串路径`, { [key]: value })
  return resolvePath(value, root)
}

/**
 * S1 stage 入口。
 * @param {object} args 工具参数（见文件头注释）
 * @param {{root?: string, config?: object, signal?: AbortSignal}} env 工具执行环境
 */
export async function parsePlanDesign(args, env) {
  const input = args === undefined || args === null ? {} : args
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()

  // ① design：必填；空串/非字符串都按缺参处理
  const design = input.design
  if (typeof design !== 'string' || !design.trim()) {
    fail(CODES.ARGS, '缺少 design：design 必须是网格平面设计图 PNG 的路径（相对工作区或绝对路径）', { design })
  }
  const designAbs = resolvePath(design.trim(), root)

  // ② legend：对象或 JSON 路径；缺省时找旁挂图例（<同名>.legend.json / <同名>.meta.json）
  let legendArg = input.legend
  if (legendArg === undefined || legendArg === null) {
    const sidecar = findSidecarLegend(designAbs)
    if (!sidecar) {
      fail(
        CODES.ARGS,
        '缺少 legend：请传图例（对象或 JSON 路径），或在设计图旁放 <同名>.legend.json / <同名>.meta.json',
        { design: designAbs },
      )
    }
    legendArg = sidecar
  }
  const legendLoaded = loadJsonArg(legendArg, root, 'legend')
  const legendSource = legendLoaded.source // 内联图例时为 null
  const cfg = normalizePlanLegend(legendLoaded.value, {
    rows: input.rows,
    cols: input.cols,
    cellPx: input.cellPx,
    margin: input.margin,
    metersPerCell: input.metersPerCell,
  })

  // ③ 输出路径检查（契约 §0：输出不得覆盖输入；读图前就拒绝，避免白干活）
  const outAbs = resolveOutput(input, 'out', root)
  const previewAbs = resolveOutput(input, 'previewOut', root)
  const inputPaths = [designAbs, legendSource]
  if (outAbs) assertNotOverwrite(inputPaths, outAbs)
  if (previewAbs) assertNotOverwrite(inputPaths, previewAbs)
  if (outAbs && previewAbs && path.resolve(outAbs) === path.resolve(previewAbs)) {
    fail(CODES.PATH, 'out 与 previewOut 不能是同一个文件', { out: outAbs, previewOut: previewAbs })
  }

  // ④ 解码 PNG（损坏/非法 → E_SPEC_INVALID，由 decodePng 抛结构化错误）
  const image = decodePng(readBinaryFile(designAbs, '设计图 PNG'))

  // ⑤ 解析：格分类 → 房间/家具/墙门 → SceneSpec 草稿
  const name = cfg.name || path.basename(designAbs, path.extname(designAbs))
  const analysis = analyzePlanImage(image, cfg, { name })

  // ⑥ 规范化 + 结构校验（不合法不静默降级，直接抛 E_SPEC_INVALID）
  const spec = normalizeSceneSpec(analysis.spec, { cell: cfg.metersPerCell })
  const report = validateSceneSpec(spec)
  if (!report.ok) {
    const failures = report.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.detail ?? '未通过'}`)
    fail(CODES.SPEC, '设计图解析结果未通过 SceneSpec 校验', { failures })
  }

  // ⑦ 写出（先写 spec 再写预览；路径/覆盖检查已在第 ③ 步完成）
  if (outAbs) writeJsonFile(outAbs, spec)
  if (previewAbs) {
    const preview = renderPlanPreview(spec)
    writeBinaryFile(previewAbs, preview.png)
  }

  return {
    spec,
    ...(outAbs ? { out: displayPath(outAbs, root) } : {}),
    ...(previewAbs ? { previewOut: displayPath(previewAbs, root) } : {}),
    report,
    stats: analysis.stats,
    warnings: analysis.warnings,
  }
}
