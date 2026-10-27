// tools/sim/inspect_state.mjs —— 从一份 inspect 快照里查指定控件的可见性与文本
// 用法：node tools/sim/inspect_state.mjs <snapshot.json> [名字...]
import fs from 'node:fs';
import path from 'node:path';
import { indexTree } from './kit.mjs';

const file = process.argv[2];
const ri = JSON.parse(fs.readFileSync(file, 'utf8'));
const t = indexTree(ri);
const names = process.argv.slice(3);
const list = names.length ? names : [...t.keys()].filter((k) => /^(clue|cell|ruler|tray|modal)/.test(k)).sort();
for (const k of list) {
  const n = t.get(k);
  console.log(k.padEnd(16) + (n ? ('visible=' + n.visible + '  text=' + JSON.stringify(n.text || '')) : 'MISSING'));
}
