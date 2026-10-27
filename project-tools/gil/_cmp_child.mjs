// tools/gil/_cmp_child.mjs —— 把"某个子控件"和"工作正常的同名子控件"**逐字段路径**比一遍
//
// 由来 ✓：`_cmp_bg.mjs` 是专门比 `bg` 的 ✓（当时靠它发现了 `#504` 缺失 ✓）
//   现在要查 **`label` 为什么没居中** ＋ **颜色** ⇒ 泛化成"任意子控件" ✓
//
// ★ 纪律（两次踩出来的 ✓）：
//   · **必须递归** ✓（只比一层什么都看不见 —— `_probe_visible.mjs` 的死因 ✓）
//   · **按字段号**下钻 ✓（按深度会走错 ✓）
//
// 用法：
//   node tools/gil/_cmp_child.mjs <存档.gil> [子控件名=label] [基准父控件=action.back] [对比对象=modal.exit,modal.save]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const g = readGil(path.resolve(ROOT, argv[0] || '238-四键真因修复-v101.gil'));
const CHILD = argv[1] || 'label';
const REF = argv[2] || 'action.back';
const BADS = (argv[3] || 'modal.exit,modal.save,modal.settle,modal.cancel').split(',');

function flatten(fields, prefix = '', out = new Map()) {
  for (const f of fields || []) {
    const p = prefix + '/' + f.field;
    if (f.sub) flatten(f.sub, p, out);
    else if (f.wt === 0) out.set(p, String(f.num));
    else if (f.isText) out.set(p, 'T:' + f.payload.toString('utf8').slice(0, 24));
    else out.set(p, 'wt2(' + (f.payload ? f.payload.length : 0) + 'B)');
  }
  return out;
}
const childOf = (name, cname) => {
  const rec = g.byName.get(name);
  if (!rec) return null;
  return g.recs.find((r) => r.parentId === rec.id && r.name === cname) || null;
};

const ref = childOf(REF, CHILD);
if (!ref) { console.error('✗ 找不到基准 ' + REF + '.' + CHILD); process.exit(1); }
const good = flatten(ref.field.sub);
console.log('基准（工作正常）：' + REF + '.' + CHILD + '  #' + ref.id + '   叶子数=' + good.size);
console.log('');

for (const b of BADS) {
  const c = childOf(b, CHILD);
  if (!c) { console.log('✗ ' + b + '.' + CHILD + ' 不存在'); continue; }
  const mine = flatten(c.field.sub);
  const onlyGood = [...good.keys()].filter((k) => !mine.has(k));
  const onlyMine = [...mine.keys()].filter((k) => !good.has(k));
  const diffVal = [...good.keys()].filter((k) => mine.has(k) && mine.get(k) !== good.get(k));
  console.log('=== ' + b + '.' + CHILD + '  #' + c.id + '   叶子数=' + mine.size
    + '   ★ 差异：只它有 ' + onlyGood.length + ' · 只我有 ' + onlyMine.length + ' · 值不同 ' + diffVal.length);
  for (const k of onlyGood) console.log('    【它有我没有】' + k + ' = ' + good.get(k));
  for (const k of onlyMine) console.log('    【我有它没有】' + k + ' = ' + mine.get(k));
  for (const k of diffVal) console.log('    【值不同】' + k + '  它=' + good.get(k) + '  我=' + mine.get(k));
}

// 把所有"值不同"的字段号汇总一遍 —— 便于一眼看出可疑字段（颜色/对齐往往就在其中 ✓）
console.log('\n=== 汇总：所有对比对象里"值不同"的字段路径（重复出现的最可疑 ✓）===');
const tally = new Map();
for (const b of BADS) {
  const c = childOf(b, CHILD);
  if (!c) continue;
  const mine = flatten(c.field.sub);
  for (const k of good.keys()) if (mine.has(k) && mine.get(k) !== good.get(k)) tally.set(k, (tally.get(k) || 0) + 1);
}
for (const [k, n] of [...tally.entries()].sort((a, b2) => b2[1] - a[1])) {
  console.log('  ' + k + '   × ' + n + '（基准值 ' + good.get(k) + '）');
}
