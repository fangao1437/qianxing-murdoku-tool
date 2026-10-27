// 技能注册：3D 场景确认报告（PDF）
import fs from 'node:fs'

export const SKILL_NAME = 'qianxing-3d-report'

const SKILL_DESCRIPTION =
  '3D 场景确认报告：把设计图、俯视预览、Blender 渲染图和元件坐标表合成 PDF，交给用户确认与调整（不是内部参考）；同时输出 placement.json。' +
  '当 3D 场景需要「出图给别人看」「确认摆位」「导出坐标表 PDF」时使用；对应工具 scene_report_pdf。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerReportSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# qianxing-3d-report\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content,
  })
}
