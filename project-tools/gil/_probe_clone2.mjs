// tools/gil/_probe_clone2.mjs —— 只读：把 `settle.btn` 的子控件与【原型】的子控件做**全字段对比**，
// 并对每一条「新增/缺失/数值不同」的路径定位到具体层级，输出可复核的行号式清单。
//
// 用法：node tools/gil/_probe_clone2.mjs "371-结算按钮-v240.gil" home.select settle.btn
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '371-结算按钮-v240.gil';
const protoName = process.argv[3] || 'home.select';
const newName = process.argv[4] || 'settle.btn';
const g = readGil(path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kidsOf = (rec) => {
  const cl = findChildListTop(rec.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
};

// 把一棵字段树摊平成 path -> 值 的映射（path 里带层级序号，避免同号字段混淆）
function flatten(fields, prefix, out) {
  fields.forEach((f, i) => {
    const p = prefix + '/' + f.field + '[' + i + ']';
    let v;
    if (f.wt === 5) v = 'f=' + f.f;
    else if (f.wt === 0) v = 'v=' + f.num;
    else if (f.wt === 1) v = 'raw=' + f.raw.toString('hex');
    else if (f.isText) v = 'txt="' + f.payload.toString('utf8') + '"';
    else if (f.sub) { v = 'msg'; flatten(f.sub, p, out); }
    else v = 'pay=' + f.payload.toString('hex').slice(0, 24);
    out.set(p, v);
  });
  return out;
}
// 归一化：把 id 全部替换成占位符，避免"新号 vs 旧号"造成假差异
function norm(s) { return String(s).replace(/1073\d{6}/g, '<ID>'); }

function cmp(labelA, a, labelB, b) {
  const A = flatten(a.field.sub, '', new Map());
  const B = flatten(b.field.sub, '', new Map());
  console.log('\n===== ' + labelA + '#' + a.id + '  vs  ' + labelB + '#' + b.id + ' =====');
  const diffs = [];
  for (const [k, v] of A) {
    if (!B.has(k)) diffs.push('  只在 ' + labelA + '： ' + k + ' = ' + v);
    else if (norm(v) !== norm(B.get(k))) diffs.push('  不同  ' + k + '： ' + labelA + '=' + v + '   ' + labelB + '=' + B.get(k));
  }
  for (const [k, v] of B) if (!A.has(k)) diffs.push('  只在 ' + labelB + '： ' + k + ' = ' + v);
  console.log(diffs.length ? diffs.join('\n') : '  （完全一致）');
  return diffs.length;
}

const proto = g.byName.get(protoName), fresh = g.byName.get(newName);
const pk = kidsOf(proto), fk = kidsOf(fresh);
console.log('原型子控件： ' + pk.map((i) => (byId.get(i) || {}).name + '#' + i).join('  '));
console.log('新按钮子控件：' + fk.map((i) => (byId.get(i) || {}).name + '#' + i).join('  '));

let total = cmp('原型根 ' + protoName, proto, '新根 ' + newName, fresh);
for (let i = 0; i < Math.max(pk.length, fk.length); i++) {
  const a = byId.get(pk[i]), b = byId.get(fk[i]);
  if (!a || !b) { console.log('\n❗ 第 ' + i + ' 个子控件对不齐：' + (a ? a.name : '缺') + ' / ' + (b ? b.name : '缺')); continue; }
  total += cmp('原型子 ' + a.name, a, '新子 ' + b.name, b);
}
console.log('\n合计差异行： ' + total);

// 另外：全存档里"非有限浮点"普查（NaN/Inf 一律列出，含路径）
console.log('\n===== 存档里所有 NaN / Inf 浮点（含记录与路径）=====');
let bad = 0;
for (const r of g.recs) {
  (function walk(fs, p) {
    for (const f of fs) {
      if (f.wt === 5 && !Number.isFinite(f.f)) {
        bad++;
        console.log('  ' + (r.name || '(无名)').padEnd(22) + '#' + r.id + '  ' + p + '/#' + f.field + ' = ' + f.f);
      }
      if (f.sub) walk(f.sub, p + '/#' + f.field);
    }
  })(r.field.sub, '');
}
console.log('  合计 ' + bad + ' 处');
