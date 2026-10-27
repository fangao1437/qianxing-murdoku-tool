// tools/sim/_probe_node.mjs —— 只读：把存档里某个控件的**完整 JSON 节点**打出来
// 用法：node tools/sim/_probe_node.mjs <save.json> <名字>
import fs from 'node:fs';
const f = process.argv[2];
const want = process.argv[3];
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
let hit = null;
(function walk(n, parent) {
  if (hit || !n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walk(x, parent); return; }
  if (n.name === want && n.kind && n.transformByPlatform) { hit = { n, parent }; return; }
  for (const k of Object.keys(n)) walk(n[k], (n && n.name) ? n.name : parent);
})(j, null);
if (!hit) { console.log('没找到 ' + want); process.exit(1); }
console.log('父 = ' + hit.parent);
console.log(JSON.stringify(hit.n, null, 2).slice(0, 3000));
