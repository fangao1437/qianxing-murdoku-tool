// 生成 PLUGINS.md：工具清单 + 各技能全文（本会话的使用手册）
import fs from 'node:fs'
import path from 'node:path'
import { loadAll, REPO } from './host.mjs'
const reg = await loadAll()
let md = '# 本项目已装插件（FeiBo 适配层）\n\n调用方式：`node .feibo-plugins/qx.mjs call <工具名> \'<JSON参数>\'`；列表：`list --full`；技能全文：`skill <技能名>`。\n\n## 工具\n\n'
const by = {}
for (const [n, { plugin, def }] of reg.tools) (by[plugin] ||= []).push([n, def])
for (const [p, list] of Object.entries(by)) {
  md += `### ${p}\n\n`
  for (const [n, d] of list) md += `- **${n}** — ${String(d.description).split('\n')[0].slice(0, 200)}\n  参数：\`${JSON.stringify(d.parameters.properties ? Object.keys(d.parameters.properties) : [])}\` 必填：\`${JSON.stringify(d.parameters.required || [])}\`\n`
  md += '\n'
}
md += '## 技能\n\n'
for (const [n, s] of reg.skills) md += `### ${n}（${s.plugin}）\n\n${s.description}\n\n<details><summary>全文</summary>\n\n${s.content}\n\n</details>\n\n`
fs.writeFileSync(path.join(REPO, '.feibo-plugins', 'PLUGINS.md'), md)
console.log('ok', md.length)
process.exit(0)
