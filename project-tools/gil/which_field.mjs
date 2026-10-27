// tools/gil/which_field.mjs —— 看某控件记录里的几何字段落在**哪条路径**上；并可两个存档对比
//
// 起因（2026-09-27）：`compare_controls.mjs` 发现引擎把我写进 `#504` 的显式位置
// **丢掉了**（重存回来是空消息 = 0,0），但界面显示却是对的（−60 / +60）。
// 所以要把"字段路径"逐条列出来对比，弄清引擎到底认哪条路径。
//
// 用法：
//   node tools/gil/which_field.mjs <存档.gil> <控件名>              # 列出该控件记录的全部字段
//   node tools/gil/which_field.mjs <A.gil> <B.gil> <控件名>          # 对比两条记录的字段路径集合

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);

/** 收集记录里所有字段的"路径 + 类型 + 值"，叶子和容器都收 */
function collect(rec) {
  const out = [];
  (function walk(fields, prefix) {
    for (const f of fields) {
      const here = prefix + '/#' + f.field;
      if (f.wt === 0) out.push({ p: here, t: 'varint', v: Number(f.num), at: f.s0 });
      else if (f.wt === 5) out.push({ p: here, t: 'float', v: f.f, at: f.s0 });
      else if (f.wt === 2 && f.isText) out.push({ p: here, t: 'str', v: JSON.stringify(f.payload.toString('utf8')), at: f.s0 });
      else if (f.wt === 2 && f.sub) { out.push({ p: here, t: 'msg', v: '(' + f.sub.length + ' 子字段)', at: f.s0 }); walk(f.sub, here); }
      else out.push({ p: here, t: 'bytes', v: f.len + 'B', at: f.s0 });
    }
  })(rec.field.sub, '');
  return out;
}

if (args.length >= 3) {
  // ── 对比模式 ────────────────────────────────────────────────────────────
  const [fa, fb, name] = args;
  const A = readGil(fa), B = readGil(fb);
  const ra = A.recs.find((r) => r.name === name), rb = B.recs.find((r) => r.name === name);
  if (!ra || !rb) { console.error('两边都要有控件 ' + name); process.exit(2); }
  const ia = collect(ra), ib = collect(rb);
  const sa = new Set(ia.map((x) => x.p + '|' + x.t)), sb = new Set(ib.map((x) => x.p + '|' + x.t));
  const oa = [...sa].filter((x) => !sb.has(x)).sort();
  const ob = [...sb].filter((x) => !sa.has(x)).sort();
  console.log('A：' + path.basename(fa) + '  ' + name + ' #' + ra.id + '（' + (ra.field.s1 - ra.field.s0) + ' 字节）');
  console.log('B：' + path.basename(fb) + '  ' + name + ' #' + rb.id + '（' + (rb.field.s1 - rb.field.s0) + ' 字节）');
  console.log('\nA 有、B 没有的字段路径（' + oa.length + '）：');
  for (const x of oa) {
    const it = ia.find((y) => y.p + '|' + y.t === x);
    console.log('   - ' + x.padEnd(52) + ' = ' + (it.t === 'float' ? it.v.toFixed(2) : it.v));
  }
  console.log('\nB 有、A 没有的字段路径（' + ob.length + '）：');
  for (const x of ob) {
    const it = ib.find((y) => y.p + '|' + y.t === x);
    console.log('   + ' + x.padEnd(52) + ' = ' + (it.t === 'float' ? it.v.toFixed(2) : it.v));
  }
  // 同路径但值不同
  const common = [...sa].filter((x) => sb.has(x));
  const valDiff = [];
  for (const k of common) {
    const va = ia.find((y) => y.p + '|' + y.t === k), vb = ib.find((y) => y.p + '|' + y.t === k);
    if (va.t === 'msg' || va.t === 'bytes') continue;
    const same = va.t === 'float' ? Math.abs(va.v - vb.v) < 0.01 : va.v === vb.v;
    if (!same) valDiff.push([k, va, vb]);
  }
  console.log('\n同路径但值不同（' + valDiff.length + '）：');
  for (const [k, va, vb] of valDiff) {
    const f = (x) => x.t === 'float' ? x.v.toFixed(2) : String(x.v);
    console.log('   ~ ' + k.padEnd(52) + ' A=' + f(va) + '  B=' + f(vb));
  }
  process.exit(0);
}

// ── 单文件模式 ────────────────────────────────────────────────────────────
const file = args[0] || path.join(ROOT, '完整界面2.gil');
const name = args[1];
if (!name) { console.error('用法：which_field.mjs <存档.gil> <控件名>  |  which_field.mjs <A> <B> <控件名>'); process.exit(1); }
const g = readGil(file);
const rec = g.recs.find((r) => r.name === name);
if (!rec) { console.error('找不到控件 ' + name + '（存档：' + path.basename(file) + '）'); process.exit(2); }
console.log('文件：' + path.basename(file) + '  控件：' + name + '  #' + rec.id + '  父#' + rec.parentId);
console.log('记录 ' + rec.field.s0 + '..' + rec.field.s1 + '（' + (rec.field.s1 - rec.field.s0) + ' 字节）  状态块 ' + rec.states.length + '\n');
const items = collect(rec);
for (const it of items) {
  const v = it.t === 'float' ? it.v.toFixed(2) : String(it.v);
  console.log('  @' + String(it.at).padStart(7) + '  ' + it.p.padEnd(48) + ' ' + it.t.padEnd(7) + ' ' + v);
}
