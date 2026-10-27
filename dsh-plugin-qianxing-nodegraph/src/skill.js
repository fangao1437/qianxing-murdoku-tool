// 技能注册：把 skill.md 作为运行时技能挂到 ctx.skills。
import fs from 'node:fs'

export const SKILL_NAME = 'qianxing-nodegraph'

const SKILL_DESCRIPTION =
  '千星沙箱（原神 UGC）节点图双向工具链：.gia 节点图解码 → 行为规格（反向翻译）→ genshin-ts TypeScript → .gia（可选注入 .gil 副本）。' +
  '当用户发来 .gia/.gil 要读节点图、要翻译成规格/TS、要把规格编译成 .gia、或要把节点图写进 .gil 时使用；' +
  '对应工具 qianxing_gia_read / qianxing_gia_translate / qianxing_spec_emit / qianxing_gia_build / qianxing_selftest。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerNodegraphSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# qianxing-nodegraph\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content,
  })
}
