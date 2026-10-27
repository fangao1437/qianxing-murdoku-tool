// tools/gil/_probe_clone.mjs —— 只读探针：把 `settle.btn` 的两个子控件与克隆源 `home.select` 的
// 同名字控件逐字段对比，找出克隆丢了什么 / 多了什么。
//
// 用法：node tools/gil/_probe_clone.mjs "371-结算按钮-v240.gil"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = readGil(path.join(ROOT, process.argv[2] || '371-结算按钮-v240.gil'));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kidsOf = (rec) => {
  const cl = findChildListTop(rec.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
};

// 字段表 → 紧凑字符串（wt0 = varint、wt5 = float、wt2 文本/message）
function shape(fields, depth, maxDepth) {
  const out = [];
  for (const f of fields) {
    if (f.wt === 5) out.push('#' + f.field + '(f=' + f.f.toFixed(2) + ')');
    else if (f.wt === 0) out.push('#' + f.field + '(v=' + f.num + ')');
    else if (f.wt === 1) out.push('#' + f.field + '(raw8=' + f.raw.toString('hex') + ')');
    else if (f.isText) out.push('#' + f.field + '("' + f.payload.toString('utf8') + '")');
    else out.push('#' + f.field + '{' + (depth < maxDepth ? shape(f.sub || [], depth + 1, maxDepth) : '…' + (f.sub ? f.sub.length + 'f' : 'noSub')) + '}');
  }
  return out.join(' ');
}

function dumpRec(rec, label, maxDepth) {
  console.log('\n===== ' + label + '  #' + rec.id + ' 父=' + rec.parentId + ' =====');
  console.log('顶层字段: ' + shape(rec.field.sub, 0, maxDepth));
  const kids = kidsOf(rec);
  console.log('子列表 [' + kids.length + ']: ' + kids.map((k) => (byId.get(k) ? byId.get(k).name : '?') + '#' + k).join(' '));
  for (const k of kids) {
    const r = byId.get(k);
    if (!r) { console.log('  缺记录 #' + k); continue; }
    console.log('  · ' + (r.name || '?') + '#' + r.id + ' 顶层字段: ' + shape(r.field.sub, 0, maxDepth));
  }
}

const t = g.byName.get('settle.btn');
const src = g.byName.get('home.select');
dumpRec(src, '克隆源 home.select', 4);
dumpRec(t, '新按钮 settle.btn', 4);

// 兄弟按钮 home.continue：看"正常按钮"该有哪些字段
const sib = g.byName.get('home.continue');
if (sib) dumpRec(sib, '对照 home.continue', 4);

// 状态节点引用（四状态子控件 id）
console.log('\n===== 按钮的状态节点引用（#506 家族）=====');
for (const nm of ['home.select', 'settle.btn', 'home.continue', 'select.back']) {
  const r = g.byName.get(nm);
  if (!r) continue;
  const hits = [];
  (function walk(fs, p) {
    for (const f of fs) {
      if (f.wt === 0 && (f.field === 506 || f.field === 507 || f.field === 508 || f.field === 509) && Number(f.num) > 1000) {
        hits.push(p + '/#' + f.field + '=' + f.num);
      }
      if (f.sub) walk(f.sub, p + '/#' + f.field);
    }
  })(r.field.sub, '');
  console.log('  ' + nm.padEnd(16) + (hits.join('  ') || '(无)'));
}
