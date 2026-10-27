// tools/gil/_probe_502.mjs —— 临时探针：`bg` 上那两个 `#502` 各是什么
//   实测差异（真机文字正常的按钮 vs 四键）：
//     正常按钮 .bg : #501 #502[3] **#502[3]** #504 #505[3] …   ← 两个
//     四键     .bg : #501 #502[3]            #504 #505[3] …   ← 一个 ✗
//   ⇒ 把两个 `#502` 的内容打出来，看缺的是哪一个 ✓
//   用法：node tools/gil/_probe_502.mjs <存档.gil>
import { readGil } from './gilread.mjs';

const g = readGil(process.argv[2] || '228-四键配图修好.gil');

const deep = (f, depth = 0, max = 3) => {
  if (depth > max) return '…';
  const subs = f.sub || [];
  if (!subs.length) {
    if (f.wt === 0) return String(f.num);
    if (f.isText) return JSON.stringify(f.payload.toString('utf8').slice(0, 24));
    if (f.wt === 2 && f.payload && f.payload.length <= 8) return 'b:' + f.payload.toString('hex');
    return 'wt2(' + (f.payload ? f.payload.length : 0) + 'B)';
  }
  return '{' + subs.map((s) => '#' + s.field + ':' + deep(s, depth + 1, max)).join(' ') + '}';
};

const show502 = (name, child) => {
  const rec = g.byName.get(name);
  if (!rec) { console.log(name + ' 缺'); return; }
  const c = child ? g.recs.find((r) => r.parentId === rec.id && r.name === child) : rec;
  if (!c) { console.log(name + '.' + child + ' 没有'); return; }
  const f502 = ((c.field && c.field.sub) || []).filter((f) => f.field === 502);
  const which = f502.map((f) => {
    const subs = f.sub || [];
    const k = subs.find((s) => s.wt === 2 && s.field >= 11 && s.field <= 20);
    return k ? '#' + k.field : '?';
  }).join(',');
  console.log('  ' + (name + (child ? '.' + child : '')).padEnd(22) + ' #' + c.id
    + '   #502 个数=' + f502.length + '   分量=' + (which || '（无）'));
};

console.log('=== bg（底图）===');
for (const n of ['action.back', 'home.select', 'home.bag']) show502(n, 'bg');
for (const n of ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel']) show502(n, 'bg');

console.log('\n=== label（文字）===');
for (const n of ['action.back', 'home.select', 'home.bag']) show502(n, 'label');
for (const n of ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel']) show502(n, 'label');

