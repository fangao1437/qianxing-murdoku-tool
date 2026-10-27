// tools/audit/check_actions.mjs —— 对账：界面发出的 action vs 脚本处理的分支
//
// 为什么需要：`ui_controller` 把交互统一成 `{ action = "xxx", ... }` 事件，
// 由 `ui_controller` 的分发器按 `a == "xxx"` 分派。**发出但没有分支的 action
// 会静默失效**（点了没反应），而且离线看不出来。
//
// 用法：node tools/audit/check_actions.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LUA = path.join(ROOT, 'lua');

const files = fs.readdirSync(LUA).filter((f) => f.endsWith('.lua'));
const emitted = new Map();   // action -> [发出的文件:行]
const handled = new Set();

for (const f of files) {
  const text = fs.readFileSync(path.join(LUA, f), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/action\s*=\s*"([a-z_]+)"/g)) {
      if (!emitted.has(m[1])) emitted.set(m[1], []);
      emitted.get(m[1]).push(f + ':' + (i + 1));
    }
  });
  // 分发器在 ui_controller：`a == "xxx"` / `a == "xxx" or a == "yyy"`
  for (const m of text.matchAll(/\ba\s*==\s*"([a-z_]+)"/g)) handled.add(m[1]);
}

const emitList = [...emitted.keys()].sort();
const miss = emitList.filter((x) => !handled.has(x));
const extra = [...handled].filter((x) => !emitted.has(x)).sort();

console.log('扫描 lua/ 下 ' + files.length + ' 个文件');
console.log('发出的 action ' + emitList.length + ' 个：');
console.log('  ' + emitList.join(', '));
console.log('\n分发器处理的分支 ' + handled.size + ' 个：');
console.log('  ' + [...handled].sort().join(', '));

console.log('\n[!] 发出但【没有处理分支】的 ' + miss.length + ' 个：');
if (!miss.length) console.log('  （无）');
for (const m of miss) console.log('  ' + m.padEnd(26) + ' 发出处 ' + emitted.get(m).join(', '));

console.log('\n[i] 有分支但没人发的 ' + extra.length + ' 个（可能是内部/保留分支）：');
console.log('  ' + (extra.join(', ') || '（无）'));

console.log('\n' + (miss.length === 0
  ? '★ 对账通过：所有 action 都有处理分支'
  : '[X] 有 ' + miss.length + ' 个 action 点了没反应 —— 要么补分支，要么去掉按钮'));
process.exit(miss.length === 0 ? 0 : 2);
