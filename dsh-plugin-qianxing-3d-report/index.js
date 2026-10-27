// dsh-plugin-qianxing-3d-report —— 3D 场景确认报告（PDF）
import { registerReportTools } from './src/tools.js'
import { registerReportSkill } from './src/skill.js'

export const name = 'qianxing-3d-report'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ outdir?: string } | undefined} config
 */
export function apply(ctx, config) {
  registerReportTools(ctx)
  registerReportSkill(ctx)
  console.log('[qianxing-3d-report] plugin loaded: 1 tool + skill registered')
}
