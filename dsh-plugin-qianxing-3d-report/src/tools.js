// 工具层：3D 场景确认报告（PDF）
import { defineArtTool } from './define.js'
import { buildSceneReportPdf } from './report.js'

const PATH = (description) => ({ type: 'string', description })

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerReportTools(ctx) {
  ctx.tools.register(defineArtTool({
    name: 'scene_report_pdf',
    description:
      '把 3D 场景的「设计图 + 俯视预览 + Blender 渲染图 + 元件坐标表」合成一份 PDF 确认报告（不是内部参考，是给用户确认和调整用的）。' +
      '同时输出 placement.json（坐标为调整输入）。需要服务器有 Chrome（已有）。' +
      '典型用法：scene_parse_plan → scene_preview → scene_build_blender → 本工具 → qqbot_send_file 发 PDF。',
    timeoutMs: 240000,
    concurrencySafe: false,
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'json', description: 'SceneSpec 对象或 JSON 文件路径' },
        design: PATH('可选：设计图 PNG 路径（嵌入报告第 1 节）'),
        preview: PATH('可选：俯视预览 PNG 路径（scene_preview 的产物）'),
        renders: {
          type: 'array',
          description: '可选：Blender 渲染图路径数组；可传字符串路径或 {path,label}',
          items: { type: 'json' },
        },
        outDir: PATH('可选：报告输出目录（默认 spec 同目录/report）'),
        title: PATH('可选：报告标题（默认「<场景名> · 场景确认报告」）'),
      },
      required: ['spec'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const normalized = { ...args }
      if (!Array.isArray(normalized.renders)) normalized.renders = []
      const root = typeof exec?.root === 'string' ? exec.root : undefined
      return buildSceneReportPdf(normalized, { root })
    },
  }))
}
