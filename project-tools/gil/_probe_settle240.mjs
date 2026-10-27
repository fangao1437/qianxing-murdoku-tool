// tools/gil/_probe_settle240.mjs —— 只读探针：看 `settle.btn` 这条记录到底长什么样
//
// 目的（2026-10-15 夜）：用户报「首页没有带图文的结算按钮，但全屏都被一个能触发结算的
// 东西占满」⇒ 先看**存档里那条记录的几何与子控件**，不猜。
//
// 用法：node tools/gil/_probe_settle240.mjs "371-结算按钮-v240.gil"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, pairOf, pairValue, findChildListTop, asIdList, KNOWN_TYPES,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '371-结算按钮-v240.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const byId = new Map(g.recs.map((r) => [r.id, r]));
const nameOf = (id) => {
  const r = byId.get(id);
  return r ? (r.name || '(无名)') + '#' + id : '(缺记录)#' + id;
};

console.log('文件 ' + path.basename(g.file) + '　记录 ' + g.recs.length + '　maxId ' + g.maxId);

function geomOf(rec) {
  if (!rec.states || !rec.states.length) return [];
  return rec.states.map((blk, i) => {
    const pos = pairOf(blk, 504);
    const size = pairOf(blk, 505);
    const p = pos ? [pairValue(pos, 0).toFixed(1), pairValue(pos, 1).toFixed(1)] : null;
    const s = size ? [pairValue(size, 0).toFixed(1), pairValue(size, 1).toFixed(1)] : null;
    return { i, pos: p, size: s, fields: blk.sub.map((x) => x.field).join(',') };
  });
}

function dump(rec, depth, maxDepth) {
  const kids = rec.childList ? (asIdList(rec.childList.payload, true) || []).map(Number) : [];
  const pad = '  '.repeat(depth);
  const g0 = geomOf(rec)[0];
  const texts = (rec.names || []).filter((s) => !KNOWN_TYPES.has(s));
  console.log(pad + '· ' + (rec.name || '(无名)') + '  #' + rec.id
    + '  父=' + (rec.parentId === null ? 'null' : nameOf(rec.parentId))
    + '  几何=' + (g0 ? ('pos[' + g0.pos + '] size[' + g0.size + ']') : '无状态块')
    + '  子=' + kids.length);
  if (texts.length) console.log(pad + '   名/文本: ' + texts.map((t) => JSON.stringify(t)).join(' '));
  for (const st of geomOf(rec)) {
    if (st.i === 0) continue;
    console.log(pad + '   状态块[' + st.i + '] pos[' + st.pos + '] size[' + st.size + ']');
  }
  if (depth >= maxDepth) { if (kids.length) console.log(pad + '   （不再往下）'); return; }
  for (const k of kids) {
    const r = byId.get(k);
    if (!r) { console.log(pad + '  · (缺记录) #' + k); continue; }
    dump(r, depth + 1, maxDepth);
  }
}

// ① 目标记录
const t = g.byName.get('settle.btn');
if (!t) { console.log('❌ 没有 settle.btn'); process.exit(2); }
console.log('\n===== settle.btn 子树 =====');
dump(t, 0, 3);

// ② 兄弟：看它在 root 子列表里的位置与前后邻居
const parent = t.parentId !== null ? byId.get(t.parentId) : null;
if (parent) {
  const sib = (asIdList(findChildListTop(parent.field.sub).payload, true) || []).map(Number);
  const i = sib.indexOf(t.id);
  console.log('\n===== 父 ' + (parent.name || '?') + ' 的子列表（' + sib.length + ' 条），settle.btn 在第 ' + i + ' 位 =====');
  console.log('前 3: ' + sib.slice(Math.max(0, i - 3), i).map(nameOf).join(' | '));
  console.log('后 3: ' + sib.slice(i + 1, i + 4).map(nameOf).join(' | '));
}

// ③ 对照：home.select 与 select.back 的几何（clone 源 + 同族按钮）
console.log('\n===== 对照几何 =====');
for (const nm of ['home.select', 'home.continue', 'home.shop', 'home.bag',
                  'select.back', 'select.prev', 'select.next', 'select.card.1',
                  'hit.select.card.1', 'home.title', 'select.title']) {
  const r = g.byName.get(nm);
  if (!r) { console.log('  ' + nm.padEnd(20) + ' (不在存档)'); continue; }
  const gm = geomOf(r)[0];
  const kids = r.childList ? (asIdList(r.childList.payload, true) || []).length : 0;
  console.log('  ' + nm.padEnd(20) + ' #' + r.id + '  父=' + (r.parentId === null ? 'null' : nameOf(r.parentId))
    + '  ' + (gm ? ('pos[' + gm.pos + '] size[' + gm.size + ']') : '无状态块') + '  子=' + kids);
}

// ④ 有没有"全屏"记录（几何大到盖住整屏的）
console.log('\n===== 可能是"全屏那一坨"的记录（尺寸 ≥ 1200 或 ≥ 700）=====');
for (const r of g.recs) {
  const gm = geomOf(r)[0];
  if (!gm || !gm.size) continue;
  const w = Number(gm.size[0]), h = Number(gm.size[1]);
  if (w >= 1200 || h >= 700) {
    console.log('  ' + (r.name || '(无名)').padEnd(24) + '#' + r.id + '  pos[' + gm.pos + '] size[' + gm.size + ']  父='
      + (r.parentId === null ? 'null' : nameOf(r.parentId)));
  }
}
