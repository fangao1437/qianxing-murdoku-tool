// tools/verify_save_colors.mjs —— 从**转出的模拟器存档**里读回 imageColor / imageId / text（只读）
// 用途：lead 要"转出存档里的实际 imageColor"，不能只看 .gil
// 用法：node tools/verify_save_colors.mjs <save.json> [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--')) || path.join(WS, 'export/473-教程UI系统骨架-v1.save.json');
const ALL = argv.includes('--all');

const save = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const hex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

const rows = [];
(function walk(node, parentName) {
  if (!node || typeof node !== 'object') return;
  const name = node.name ?? '(无名)';
  const kids = node.children || [];
  rows.push({
    name, kind: node.kind, parent: parentName, kids: kids.length,
    imageId: node.imageId, imageColor: node.imageColor,
    text: node.text, fontSize: node.fontSize,
  });
  for (const c of kids) walk(c, name);
})(save.root, null);

const imgs = rows.filter((r) => r.imageColor != null || r.imageId != null);
const txts = rows.filter((r) => r.text != null && r.text !== '');

console.log(`存档 ${path.basename(FILE)}  树节点 ${rows.length}（画布内 ${rows.length - 1}）`);
console.log(`  图片节点 ${imgs.length}  有文字的文本框 ${txts.length}`);
console.log('\n── 图片：imageId / imageColor（十进制 ← hex）──');
for (const r of imgs) {
  if (!ALL && r.kind !== 'image') continue;
  console.log(`  ${String(r.name).padEnd(11)} parent=${String(r.parent).padEnd(11)} imageId=${r.imageId}  imageColor=${r.imageColor} (${r.imageColor == null ? '?' : hex(r.imageColor)})`);
}
console.log('\n── 文本框：text / fontSize ──');
for (const r of txts) {
  console.log(`  ${String(r.name).padEnd(11)} parent=${String(r.parent).padEnd(11)} fs=${r.fontSize}  "${r.text}"`);
}
if (ALL) {
  console.log('\n── 全树 ──');
  for (const r of rows) console.log(`  ${String(r.name).padEnd(11)} kind=${String(r.kind).padEnd(10)} 父=${String(r.parent).padEnd(11)} 子=${r.kids}`);
}
