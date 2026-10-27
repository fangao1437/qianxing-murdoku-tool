// dsh-plugin-qianxing-nodegraph —— 千星沙箱节点图双向工具链（Host-only bundle）
//
// 零运行时依赖：只用 node: 内建模块 + 本包 vendor/ 内的 qianxing-murdoku-tool（MIT）。
// 工具注册走 ctx.tools.register()，技能注册走 ctx.skills.register()。
//
// 能力（对应 qianxing-murdoku-tool 的只读/翻译/生成链路）：
//   qianxing_gia_read      .gia → graph.json（节点/连线/常量/端口名）+ behavior-spec.md
//   qianxing_gia_translate .gia → spec.json（能译的才写；译不动的写 BLOCKERS 报告）
//   qianxing_spec_emit     behavior-spec.json → genshin-ts TypeScript 源码
//   qianxing_gia_build     TS → .gia（compile），可选注入 .gil 副本（需要 genshin-ts 工作台）
//   qianxing_selftest      vendor 离线回归（186 项，不联网）
import { registerNodegraphTools } from './src/tools.js'
import { registerNodegraphSkill } from './src/skill.js'

export const name = 'qianxing-nodegraph'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ outdir?: string } | undefined} config
 */
export function apply(ctx, config) {
  const normalized = {
    outdir: typeof config?.outdir === 'string' ? config.outdir : '',
  }
  registerNodegraphTools(ctx, normalized)
  registerNodegraphSkill(ctx)
  console.log('[qianxing-nodegraph] plugin loaded: 6 tools + skill registered')
}
