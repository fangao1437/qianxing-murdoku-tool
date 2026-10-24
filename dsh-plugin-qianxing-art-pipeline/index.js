// dsh-plugin-qianxing-art-pipeline —— 千星沙箱家具美术管线（Host-only bundle）
//
// 零运行时依赖：只用 node: 内建模块 + 本包内文件。工具注册走 ctx.tools.register()，
// 技能注册走 ctx.skills.register()，两者都由 Cordis 作用域自动回收。
//
// 六个阶段（契约见 README.md / 交接包 06-数据格式与接口契约.md）：
//   S1 art_decompose   参考 PNG → ArtSpecSet（图标压缩 / 拟合记录）
//   S2 art_build_spec  模板层表 → ArtSpecSet（规范化 + 校验）
//   S3 art_slice       关卡布局 → 每件家具的模板键/锚点/span/偏移
//   S3 art_preview     ArtSpecSet + Layout → 1600×900 SVG + ValidationReport
//   S4 art_write_gil   WriterJob → 容器 .gil + WriterReport（四闸全过才产出）
//   S5 art_embed_script 容器 .gil + dist 脚本 → 最终 .gil + EmbedReport（三方标记链）
//   S6 art_inspect     最终 .gil → 结构/模板/引用/内嵌脚本清单（真机验收用）
//   -- art_validate    共用：校验 spec / WriterJob / .gil
import { registerArtTools } from './src/tools.js'
import { registerArtSkill } from './src/skill.js'

export const name = 'qianxing-art-pipeline'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ workspaceRoot?: string, pythonPath?: string } | undefined} config
 */
export function apply(ctx, config) {
  const normalized = {
    workspaceRoot: typeof config?.workspaceRoot === 'string' ? config.workspaceRoot : '',
    pythonPath: typeof config?.pythonPath === 'string' ? config.pythonPath : '',
  }
  registerArtTools(ctx, normalized)
  registerArtSkill(ctx)
}
