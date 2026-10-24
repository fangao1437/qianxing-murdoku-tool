// 技能注册：把 skill.md 作为运行时技能挂到 ctx.skills（与 miliastra-toolbox 同一形态）。
import fs from 'node:fs'

export const SKILL_NAME = 'murdoku-art-pipeline'

const SKILL_DESCRIPTION =
  '千星沙箱（原神千星奇域）家具美术管线：参考图 → 图元规格 JSON → 离线预览校验 → 写入 .gil 模板/引用 → 嵌入客户端脚本 → 真机验收。' +
  '当任务涉及家具美术规格、模板层、.gil 容器写入、脚本嵌入、things 引用控件、美术验收时使用；' +
  '对应工具 art_decompose / art_build_spec / art_slice / art_preview / art_validate / art_write_gil / art_embed_script / art_inspect。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerArtSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# murdoku-art-pipeline\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content,
  })
}
