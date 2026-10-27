// tools/gil/_cmp_bg.mjs —— 把"不渲染的 bg"和"渲染正常的 bg"**逐字段路径**比一遍
//
// 为什么用这个办法 ✓：四键"没图"的三个嫌疑已被逐个排除 ——
//   · imageId 设上了（真机回读 `=107179` ✓）
//   · `#12` 图片分量已补（`fix_btn_bg_component.mjs` ✓）
//   · **可见性正常**（资料员实测：`bg` 无 flag ⇒ 可见 ✓ 我复测了 `probe_gil_flags` ✓）
//   · `107179` 是**真素材**（素材库 catalog 里 5 处命中 ✓，与已知能用的 100109 同量级 ✓）
// ⇒ 剩下的可能就在**结构差异**上 ✓ 而 `#12` 那条当初就是这么比出来的 ✓
//
// ★ 教训（资料员给的 ✓）：**必须递归**，且**按字段号**下钻 ✗ 不能只比一层 ✓
//   我那个 `_probe_visible.mjs` 就是只遍历一层 ⇒ 什么都没看到 ✓
//
// 用法：node tools/gil/_cmp_bg.mjs <存档.gil>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = readGil(path.resolve(ROOT, process.argv[2] || '233-选中反馈修回.gil'));

// 把一条记录的字段树摊成 "路径 → 值" 的映射（★ 递归 ✓）
function flatten(fields, prefix = '', out = new Map()) {
  for (const f of fields || []) {
    const p = prefix + '/' + f.field;
    if (f.sub) {
      flatten(f.sub, p, out);
    } else if (f.wt === 0) {
      out.set(p, String(f.num));
    } else if (f.isText) {
      out.set(p, 'T:' + f.payload.toString('utf8').slice(0, 20));
    } else {
      out.set(p, 'wt2(' + (f.payload ? f.payload.length : 0) + 'B)');
    }
  }
  return out;
}

const childOf = (name, cname) => {
  const rec = g.byName.get(name);
  if (!rec) return null;
  return g.recs.find((r) => r.parentId === rec.id && r.name === cname) || null;
};

const GOOD = 'home.select';        // ★ 真机上看得见的按钮（用户一直在用 ✓）
const BADS = ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel'];

const goodBg = childOf(GOOD, 'bg');
if (!goodBg) { console.error('✗ 找不到 ' + GOOD + '.bg'); process.exit(1); }
const good = flatten(goodBg.field.sub);

console.log('基准（渲染正常）：' + GOOD + '.bg  #' + goodBg.id + '   叶子数=' + good.size);
console.log('');

for (const b of BADS) {
  const bg = childOf(b, 'bg');
  if (!bg) { console.log('✗ ' + b + '.bg 不存在'); continue; }
  const mine = flatten(bg.field.sub);
  const onlyGood = [...good.keys()].filter((k) => !mine.has(k));
  const onlyMine = [...mine.keys()].filter((k) => !good.has(k));
  const diffVal = [...good.keys()].filter((k) => mine.has(k) && mine.get(k) !== good.get(k));
  console.log('=== ' + b + '.bg  #' + bg.id + '   叶子数=' + mine.size
    + '   ★ 差异：只它有 ' + onlyGood.length + ' · 只我有 ' + onlyMine.length + ' · 值不同 ' + diffVal.length);
  for (const k of onlyGood) console.log('    【它有我没有】' + k + ' = ' + good.get(k));
  for (const k of onlyMine) console.log('    【我有它没有】' + k + ' = ' + mine.get(k));
  for (const k of diffVal) console.log('    【值不同】' + k + '  它=' + good.get(k) + '  我=' + mine.get(k));
}

console.log('\n=== 两个 bg 的顶层字段号顺序（顺序也可能有关系 ✓）===');
const shape = (rec) => ((rec.field.sub || []).map((f) => '#' + f.field + (f.sub ? '[' + f.sub.length + ']' : '')).join(' '));
console.log('  ' + GOOD + '.bg : ' + shape(goodBg));
for (const b of BADS) { const bg = childOf(b, 'bg'); if (bg) console.log('  ' + b + '.bg : ' + shape(bg)); }
