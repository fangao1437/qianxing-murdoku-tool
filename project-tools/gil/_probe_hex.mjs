// tools/gil/_probe_hex.mjs —— 搬 `hex.*` / `hit.*` 进存档之前，先把"要造成什么样"查清楚
//   用户 2026-10-09：「搬 1，2/3 保持脚本」✓
//   ⇒ 目标：把脚本 `auto_create_only` 白名单里那 14 个控件**写进存档** ✓
//     然后把 `auto_create_only` + 自动创建那段**整段删掉** ✓
//
//   本探针回答三件事：
//     ① 规划里这 14 个的**父控件 / 位置 / 尺寸**（照它建才摆得对 ✓）
//     ② 脚本给它们配的**图片 ID**（`ICON_ASSETS`，真机日志也印证过 ✓）
//     ③ 存档里**有没有**同名记录（应该没有 ✓）
//   用法：node tools/gil/_probe_hex.mjs <存档.gil>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

// ⚠️ 路径含中文 ⇒ **必须**用 `fileURLToPath`（用 `new URL().pathname` 会留下 %XX 转义 ⇒ ENOENT ✓ 我刚踩过）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gil = process.argv[2] || '229-四键图片分量补上.gil';

// ① 规划
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json'), 'utf8'));
const NAMES = ['hex.back', 'hex.submit', 'hex.redo', 'hex.undo', 'hex.hint', 'hex.ok', 'hex.no',
  'hit.back', 'hit.submit', 'hit.redo', 'hit.undo', 'hit.hint', 'hit.ok', 'hit.no'];
console.log('=== ① 规划里这 14 个 ===');
for (const n of NAMES) {
  const node = plan.nodes.find((x) => x.id === n);
  if (!node) { console.log('  ' + n.padEnd(14) + ' **规划里没有** ✗'); continue; }
  console.log('  ' + n.padEnd(14) + ' parent=' + String(node.parent).padEnd(12)
    + ' kind=' + String(node.kind).padEnd(10)
    + ' cx=' + node.cx + ' cy=' + node.cy + ' w=' + node.w + ' h=' + node.h
    + ' visible=' + node.visible);
}

// ② 脚本里的图片 ID
console.log('\n=== ② 脚本给它们配的图（ICON_ASSETS）===');
const ui = fs.readFileSync(path.join(ROOT, 'lua', 'ui_controller.lua'), 'utf8');
const m = ui.match(/ICON_ASSETS\s*=\s*\{([\s\S]*?)\n\s*\}/);
if (m) {
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('--')) console.log('  ' + t);
  }
} else console.log('  找不到 ICON_ASSETS ✗');

// ③ 存档里有没有
console.log('\n=== ③ 存档里现在有没有 ===');
const g = readGil(path.resolve(ROOT, gil));
for (const n of NAMES) {
  const hit = g.recs.filter((r) => r.name === n);
  console.log('  ' + n.padEnd(14) + (hit.length ? ' 有 #' + hit.map((r) => r.id).join(',') : ' —— 没有（要新建）'));
}
console.log('\n存档记录总数 = ' + g.recs.length + '，maxId = ' + g.maxId);
