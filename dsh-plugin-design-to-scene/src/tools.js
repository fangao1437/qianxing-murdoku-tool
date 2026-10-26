// 工具注册层：5 个场景工具 + 统一 env（工作区根 / 配置 / 取消信号）。
import { defineArtTool, objectSchema } from './define.js'
import { workspaceRoot } from './paths.js'
import { parsePlanDesign } from './stages/parse-plan.js'
import { validateSceneSpecStage } from './stages/validate-spec.js'
import { renderScenePreviewStage } from './stages/preview.js'
import { buildSceneBlenderStage } from './stages/build-blender.js'
import { emitQianxingPlanStage } from './stages/qx-plan.js'

const PATH = (description) => ({ type: 'string', description })

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ workspaceRoot?: string, blenderPath?: string }} config
 */
export function registerSceneTools(ctx, config) {
  const envOf = (exec) => ({ root: workspaceRoot(exec, config), config, signal: exec?.signal })
  const register = (spec) => ctx.tools.register(defineArtTool(spec))

  register({
    name: 'scene_parse_plan',
    description:
      'S1 设计图解析：把「网格平面设计图 PNG」解析成 SceneSpec v1（房间/墙/门/家具格 → 场景数据）。' +
      '只支持 examples/DESIGN-FORMAT.md 里定义的「数字设计图」约定（图例由 legend 提供）；' +
      '手绘/概念图请让代理看图后直接写 SceneSpec 再走 scene_spec_validate。' +
      '输出 spec JSON + 可选俯视预览 PNG，并报告未分类格子（不静默吞）。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        design: PATH('设计图 PNG 路径（相对工作区或绝对路径）'),
        legend: { type: 'json', description: '图例 JSON（对象或 JSON 路径）：cellPx/margin/rows/cols/metersPerCell/roomColors/objectColors/wallColor/doorColor/voidColor' },
        rows: { type: 'integer', description: '覆盖：网格行数' },
        cols: { type: 'integer', description: '覆盖：网格列数' },
        cellPx: { type: 'integer', description: '覆盖：每格像素' },
        margin: { type: 'integer', description: '覆盖：图边距像素' },
        metersPerCell: { type: 'number', description: '覆盖：1 格 = 多少米（默认 0.5）' },
        out: PATH('可选：SceneSpec JSON 输出路径'),
        previewOut: PATH('可选：俯视预览 PNG 输出路径'),
      },
      ['design'],
    ),
    run: (args, exec) => parsePlanDesign(args, envOf(exec)),
  })

  register({
    name: 'scene_spec_validate',
    description:
      '校验/规范化 SceneSpec v1（版本、名称、包围盒、房间、墙/门、物件、灯光、相机、环境）。' +
      '返回 ValidationReport + 规范化后的 spec（坐标/颜色/尺寸统一）；结构错误不会静默修正，' +
      '而是出现在 checks 里。可作为 scene_preview / scene_build_blender 前的守门。',
    timeoutMs: 30000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        spec: { type: 'json', description: 'SceneSpec 对象，或 SceneSpec JSON 文件路径' },
        out: PATH('可选：把规范化后的 SceneSpec 写到该路径'),
      },
      ['spec'],
    ),
    run: (args, exec) => validateSceneSpecStage(args, envOf(exec)),
  })

  register({
    name: 'scene_preview',
    description:
      'S2 场景预览：SceneSpec v1 → 俯视预览 PNG（房间颜色/墙/门/家具 footprint/网格），' +
      '用于和设计图并排对照（改坐标前先看它）。纯 JS 光栅化，零依赖、不需要 Blender。',
    timeoutMs: 30000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        spec: { type: 'json', description: 'SceneSpec 对象，或 JSON 文件路径' },
        out: PATH('PNG 输出路径，默认 <工作区>/_work/scene-preview.png'),
        scale: { type: 'number', description: '每米像素数（默认 100）' },
        gridLines: { type: 'boolean', description: '是否画 0.5m 网格（默认 true）' },
        labels: { type: 'boolean', description: '是否画房间/物件标签（默认 true）' },
      },
      ['spec'],
    ),
    run: (args, exec) => renderScenePreviewStage(args, envOf(exec)),
  })

  register({
    name: 'scene_build_blender',
    description:
      'S3 Blender 搭建：SceneSpec v1 → 生成 bpy 构建脚本并可调用本机 Blender（headless）' +
      '产出 .blend + 俯视/透视渲染 PNG + GLB。' +
      '「千星奇域 UGC 工具」是 Blender 里的手工插件（要人建模/配灯/导 GIA）；本工具补自动化：' +
      '按 SceneSpec 直接搭出完整场景，之后可用渊星插件导 GIA。未找到 Blender 时仍会生成脚本与导出清单，' +
      '并在 report 里明确说明（不静默跳过）。',
    timeoutMs: 300000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        spec: { type: 'json', description: 'SceneSpec 对象，或 JSON 文件路径' },
        outDir: PATH('输出目录（脚本/spec/.blend/渲染/GLB 都写这里）'),
        blenderPath: PATH('可选：Blender 可执行文件路径（默认自动探测）'),
        render: { type: 'boolean', description: '是否渲染预览图（默认 true）' },
        views: { type: 'array', items: { type: 'string' }, description: '渲染视角：top / perspective（默认两个都渲染）' },
        exportGlb: { type: 'boolean', description: '是否导出 GLB（默认 true）' },
      },
      ['spec', 'outDir'],
    ),
    run: (args, exec) => buildSceneBlenderStage(args, envOf(exec)),
  })

  register({
    name: 'scene_qx_plan',
    description:
      'S4 千星落地：SceneSpec v1 → 千星/渊星落地清单（物件摆放表 + 坐标/朝向 + GIA 导出导入步骤 + 校验要点）。' +
      '说明 3D 场景与「千星奇域 UGC 工具」的分工：本工具负责设计图→场景数据→Blender 自动搭建，' +
      '渊星插件负责在 Blender 里导入导出 GIA 到千星。',
    timeoutMs: 30000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        spec: { type: 'json', description: 'SceneSpec 对象，或 JSON 文件路径' },
        outDir: PATH('输出目录（markdown + placement.json）'),
        format: { type: 'string', enum: ['md', 'json', 'both'], description: '输出格式，默认 both' },
      },
      ['spec', 'outDir'],
    ),
    run: (args, exec) => emitQianxingPlanStage(args, envOf(exec)),
  })
}
