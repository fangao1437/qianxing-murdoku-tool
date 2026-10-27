// tools/sim/_probe_anchor.mjs —— 只读：打印存档里若干控件的锚点/轴心/尺寸/父级
// 用法：node tools/sim/_probe_anchor.mjs <save.json> <名字...>
import fs from 'node:fs';
const f = process.argv[2];
const want = new Set(process.argv.slice(3));
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
const out = [];
(function walk(n, parent) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { for (const x of n) walk(x, parent); return; }
  if (n.name && n.kind && !want.has(n.name) === false) {
    const t = (n.transformByPlatform && n.transformByPlatform.KEYBOARD) || null;
    if (t) out.push({ name: n.name, parent: parent || '?', kind: n.kind,
      off: t.offset, size: t.size, aMin: t.anchorMin, aMax: t.anchorMax, pivot: t.pivot,
      scale: t.scale, visible: n.visible, inst: n.instantiated });
  }
  for (const k of Object.keys(n)) walk(n[k], (n && n.name) ? n.name : parent);
})(j, null);
for (const r of out) console.log(JSON.stringify(r));
