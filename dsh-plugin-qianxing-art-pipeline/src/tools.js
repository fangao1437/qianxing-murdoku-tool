// 工具注册层：8 个阶段工具 + 统一 env（工作区根 / 配置 / 取消信号）。
// 工具定义直接使用注册表接受的 ToolDefinition 形态（见 src/define.js），零依赖。
import { defineArtTool, objectSchema } from './define.js'
import { workspaceRoot } from './paths.js'
import { decomposeArtSpec } from './stages/decompose.js'
import { buildArtSpec } from './stages/build-spec.js'
import { sliceLayout } from './stages/slice.js'
import { renderArtPreview } from './stages/preview.js'
import { validateTarget } from './stages/validate.js'
import { writeGilJob } from './stages/write.js'
import { embedScriptIntoGil } from './stages/embed.js'
import { inspectGilFile } from './stages/inspect.js'

const PATH = (description) => ({ type: 'string', description })

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ workspaceRoot?: string, pythonPath?: string }} config
 */
export function registerArtTools(ctx, config) {
  const envOf = (exec) => ({ root: workspaceRoot(exec, config), config, signal: exec?.signal })
  const register = (spec) => ctx.tools.register(defineArtTool(spec))

  // ── S1 ────────────────────────────────────────────────────────────────────
  register({
    name: 'art_decompose',
    description:
      'S1 图元拆解：把一张家具参考图 PNG 拆成「只含官方基础形状」的层列表（ArtSpecSet，契约 version=1）。' +
      'mode=compress 用调色板量化 + 矩形合并（平涂图标最忠实，雕像基线 56×91 约 381 块）；mode=records 把外部拟合工具的图元记录换算成层。' +
      '只产出规格 JSON，不写 .gil。压缩自检（空洞/重叠/越界必须为 0）不过会抛 E_SPEC_INVALID。',
    timeoutMs: 120000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        icon: PATH('参考图 PNG 路径（mode=compress 必填；相对路径按会话工作区解析，可用绝对路径）'),
        kind: { type: 'string', enum: ['chair', 'plant', 'statue', 'table', 'carpet', 'shelf'], description: '家具种类' },
        variant: { type: 'string', description: "模板变体：'1'（默认）| 'h2' | 'v2'" },
        size: { type: 'array', items: { type: 'number' }, description: '目标像素尺寸 [w,h]；默认按长边占格 SPAN×108 推导（雕像基线 56×91）' },
        mode: { type: 'string', enum: ['compress', 'records'], description: '拆解路线，默认 compress' },
        quantize: { type: 'integer', description: '压缩路线调色板色数，默认 8' },
        std: { type: 'number', description: '压缩档位，默认 2（数值越大块越少、误差越大）' },
        records: { type: 'json', description: 'mode=records 时的图元记录数组 [{imageId,w,h,dx,dy_down,rotDeg,color}]' },
        units: { type: 'string', enum: ['cell', 'px'], description: 'records 的单位，默认 cell（单位=格，按 SPAN 归一）' },
        name: { type: 'string', description: 'ArtSpecSet.name，默认取 kind' },
        out: PATH('可选：ArtSpecSet JSON 输出路径（不得与输入文件相同）'),
      },
      ['kind'],
    ),
    run: (args, exec) => decomposeArtSpec(args, envOf(exec)),
  })

  // ── S2 ────────────────────────────────────────────────────────────────────
  register({
    name: 'art_build_spec',
    description:
      'S2 层表/规格：把手写的 TemplateSpec 层表规范化成 ArtSpecSet（补 y_up=-dy_down、order 1..N、画布默认值、颜色统一 0xAARRGGBB），' +
      '并做结构校验。产物是 S3 预览与 S4 写入的共同输入。非法规格抛 E_SPEC_INVALID，错误里带第一处不符字段。',
    timeoutMs: 30000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        templates: { type: 'json', description: 'TemplateSpec 数组，或 { 模板名: TemplateSpec } 映射；层从下到上' },
        name: { type: 'string', description: 'ArtSpecSet.name，默认 spec' },
        cellTemplatePx: { type: 'integer', description: '1 格 = 108 content 画布像素（默认 108）' },
        source: { type: 'json', description: '可选 source 字段（mode/icon/quantize…）' },
        out: PATH('可选：ArtSpecSet JSON 输出路径'),
      },
      ['templates'],
    ),
    run: (args, exec) => buildArtSpec(args, envOf(exec)),
  })

  // ── S3a ───────────────────────────────────────────────────────────────────
  register({
    name: 'art_slice',
    description:
      'S3 切件：关卡布局 Layout → 每件家具的 { templateKey, anchor, span, offsetCells }（运行时脚本下发的就是这些）。' +
      'table/carpet 按 4 邻接合并；锚点=包围盒右下格；offsetCells 单位=格、dy 向下为正；横跨地毯自动映射 furn.rug.2 / furn.rug.3。',
    timeoutMs: 30000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        layout: { type: 'json', description: 'Layout 对象，或 Layout JSON 文件路径' },
        carpetTemplate: {
          type: 'string',
          enum: ['auto', 'single'],
          description: '地毯模板键口径：auto=运行时 v320+ 口径（横跨 furn.rug.2 / 竖跨 furn.rug.3，默认）；single=兼容旧参考工具（一律 furn.rug）',
        },
        out: PATH('可选：切片 JSON 输出路径'),
      },
      ['layout'],
    ),
    run: (args, exec) => sliceLayout(args, envOf(exec)),
  })

  // ── S3b ───────────────────────────────────────────────────────────────────
  register({
    name: 'art_preview',
    description:
      'S3 预览/校验：ArtSpecSet + Layout → 1600×900 SVG 观感基准图 + ValidationReport。' +
      '几何与游戏一致（棋盘 584@(608,138)、ruler 12、gap 4、格宽 5×5=108 / 6×6≈89），只读 ArtSpecSet，不读运行时状态。' +
      '用于「参考图 vs 预览」并排对照迭代，差异大先查缩放/层序，不要先改美术。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        spec: { type: 'json', description: 'ArtSpecSet 对象，或 ArtSpecSet JSON 文件路径' },
        layout: { type: 'json', description: 'Layout 对象，或 Layout JSON 文件路径' },
        out: PATH('SVG 输出路径，默认 <工作区>/_work/art-preview.svg'),
        labels: { type: 'boolean', description: '是否画件名/房间名调试标签（默认 true）' },
        scale: { type: 'number', description: '额外缩放，默认 1' },
        carpetTemplate: {
          type: 'string',
          enum: ['auto', 'single'],
          description: '地毯模板键口径（同 art_slice，默认 auto）。基线 spec 若只有 furn.rug，auto 模式下跨格地毯会回退 furn.rug 渲染并在 report.warnings 说明',
        },
      },
      ['spec', 'layout'],
    ),
    run: (args, exec) => renderArtPreview(args, envOf(exec)),
  })

  // ── 共用校验 ──────────────────────────────────────────────────────────────
  register({
    name: 'art_validate',
    description:
      '共用校验：target=spec 校验 ArtSpecSet（图元 id/颜色/层序/画布/地毯规则）；target=job 校验 WriterJob 结构；' +
      'target=gil 校验 .gil（记录数/撞号/模板对闭合/things 引用/内嵌脚本标记）。返回 ValidationReport（ok + checks），不抛错。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        target: { type: 'string', enum: ['spec', 'job', 'gil'], description: '校验对象类型' },
        value: { type: 'json', description: 'spec/job：对象或 JSON 路径；gil：.gil 路径字符串' },
        strict: { type: 'boolean', description: 'spec 校验是否严格（默认 true）' },
      },
      ['target', 'value'],
    ),
    run: (args, exec) => validateTarget(args, envOf(exec)),
  })

  // ── S4 ────────────────────────────────────────────────────────────────────
  register({
    name: 'art_write_gil',
    description:
      'S4 写入器（事务化）：按 WriterJob 把 TemplateSpec.layers 写进 .gil 模板对的源/母本两份 content，并维护 things 引用控件。' +
      '支持 op：replace_template_layers / set_canvas / set_things_ref / set_family。' +
      '四闸全过才产出（重读记录数、roundtrip 逐字节、确定性、幂等），另检真撞号=0 与 things 引用齐全；expect 与基准档不符抛 E_BASE_MISMATCH。' +
      '已满足的 job 再跑=原样复制（SHA 不变）。输出新文件，绝不覆盖 base。',
    timeoutMs: 180000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        job: { type: 'json', description: 'WriterJob 对象（含 base/out/ops/expect），或 WriterJob JSON 文件路径' },
      },
      ['job'],
    ),
    run: (args, exec) => writeGilJob(args, envOf(exec)),
  })

  // ── S5 ────────────────────────────────────────────────────────────────────
  register({
    name: 'art_embed_script',
    description:
      'S5 脚本嵌入：把 dist 客户端脚本写进容器 .gil 的内嵌脚本叶子，得到可导入游戏的最终档。' +
      'source（脚本标记行）= dist = embedded 三处标记必须一致（expectMarker，如 v332）；脚本 BOM 自动剥离；' +
      '标记链不一致抛 E_MARKER 且不产出文件。写盘走重读/往返闸门。',
    timeoutMs: 120000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        job: { type: 'json', description: 'EmbedJob 对象（container/script/out/expectMarker），或 JSON 文件路径' },
      },
      ['job'],
    ),
    run: (args, exec) => embedScriptIntoGil(args, envOf(exec)),
  })

  // ── S6 ────────────────────────────────────────────────────────────────────
  register({
    name: 'art_inspect',
    description:
      'S6 结构清单：读 .gil 输出模板表（源/母本/content id、画布、层数）、things 引用（名字→prefab，是否指向模板源）、' +
      '内嵌脚本标记与字节数、真撞号数、root 顶层控件概览。真机验收/排障第一步：先确认导入的是哪一版、模板与引用是否齐全。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        gil: PATH('.gil 路径（相对会话工作区或绝对路径）'),
        limit: { type: 'integer', description: '每类清单最多条数（默认 200）' },
      },
      ['gil'],
    ),
    run: (args, exec) => inspectGilFile(args, envOf(exec)),
  })
}
