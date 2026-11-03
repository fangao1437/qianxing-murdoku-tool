// 用法：
//   node .feibo-plugins/qx.mjs list [--full]
//   node .feibo-plugins/qx.mjs skill <技能名>
//   node .feibo-plugins/qx.mjs call <工具名> '<JSON参数>'
//   node .feibo-plugins/qx.mjs call <工具名> --file=args.json
import fs from 'node:fs'
import { loadAll, callTool } from './host.mjs'

const [cmd, a1, a2] = process.argv.slice(2)
const reg = await loadAll()

if (cmd === 'list') {
  const full = process.argv.includes('--full')
  for (const [name, { plugin, def }] of reg.tools) {
    console.log(`${plugin.replace('dsh-plugin-', '')}\t${name}` + (full ? `\n  ${def.description}\n  参数: ${JSON.stringify(def.parameters)}` : ''))
  }
  console.log(`\n工具 ${reg.tools.size} 个，技能 ${reg.skills.size} 个`)
  for (const e of reg.errors) console.log(`加载失败 ${e.plugin}: ${e.error}`)
} else if (cmd === 'skill') {
  const s = reg.skills.get(a1)
  if (!s) { console.log('技能列表：' + [...reg.skills.keys()].join(', ')); process.exit(1) }
  console.log(s.content)
} else if (cmd === 'call') {
  let args = {}
  const raw = a2 || '{}'
  if (raw.startsWith('--file=')) args = JSON.parse(fs.readFileSync(raw.slice(7), 'utf8'))
  else args = JSON.parse(raw)
  try {
    console.log(await callTool(reg, a1, args))
  } catch (e) {
    console.error('工具出错：' + (e?.message || e))
    process.exit(2)
  }
} else {
  console.log('用法：list | skill <名> | call <工具> <JSON>')
}
process.exit(0)
