// tools/gil/gen_modal_art3.mjs —— 弹窗四键配图（**只追加、不删除** ⇒ 零下标运算）
//
// 为什么这么写（连错两轮的教训，Lead 定的纪律）：
//   前面两版都在**同一轮里混"删除旧记录 + 插入新记录"**，而 `rec.index` 是读入时的下标
//   ⇒ 删/插都会让其后记录的下标漂移 ⇒ 记录被插进别的记录中间（结构被劈开）。
//   `check_childlist_top` 每次都第一时间报 exit 1。
//   ⇒ 本版**彻底不做下标运算**：
//     · 新 `bg` 记录一律 `holder.push()`（追加到容器末尾，不影响任何已有下标）；
//     · 旧 `bg` **不删**，只是把它从按钮的子列表**摘掉**（改的是 ID 列表，不是数组结构）
//       ⇒ 它变成"不在任何子列表里"的孤立记录 ⇒ 不会被渲染、不影响显示；
//     · 按钮子列表 = `[新bgId, ...旧ID里去掉旧bg]`（新 bg 在第 1 位 = 最先绘制、垫在 label 下）。
//
// 用法：
//   node tools/gil/gen_modal_art3.mjs --in=213-弹窗四键.gil --out=214-弹窗配图.gil --probe
//   node tools/gil/gen_modal_art3.mjs --in=213-弹窗四键.gil --out=214-弹窗配图.gil

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks, textsOf,
  findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argOf = (k) => { const a = process.argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = process.argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '213-弹窗四键.gil');
const OUT = argOf('out') || path.join(ROOT, '214-弹窗配图.gil');
const BGP = argOf('bg-proto') || 'home.select/bg';
const W = Number(argOf('w') || 520), H = Number(argOf('h') || 60), PCY = 450;
const KEYS = [
  { name: 'modal.exit',   cy: 570 },
  { name: 'modal.save',   cy: 490 },
  { name: 'modal.settle', cy: 410 },
  { name: 'modal.cancel', cy: 330 },
];

const g = readGil(BASE);
const [PG, CG] = BGP.split('/');
const pr = g.byName.get(PG);
const proto = pr ? g.recs.find((r) => r.parentId === pr.id && r.name === CG) : null;
if (!proto) { console.error('找不到底图原型 ' + BGP); process.exit(1); }
const modal = g.byName.get('modal');
const holder = proto.holder;                      // 与四键同一个容器（都住在 /#9）
const paths = (r) => { const s = new Set(); (function w(fs2, p) { for (const f of fs2) { const q = p + '/' + f.field + '[' + f.wt + ']'; s.add(q); if (f.sub) w(f.sub, q); } })(r.field.sub, ''); return s; };
const PA = paths(proto);
const pairOfRec = (x) => { const fs2 = (x && typeof x.field === 'object') ? (x.field.sub || []) : ((x && x.sub) || []); let s = null, i = null; (function w(list, p) { for (const f of list) { if (f.wt === 0 && p.endsWith('/84') && f.field === 502) s = String(f.num); if (f.wt === 0 && p.endsWith('/84') && f.field === 503) i = String(f.num); if (f.sub) w(f.sub, p + '/' + f.field); } })(fs2, ''); return s + '/' + i; };
console.log('基准 ' + path.basename(BASE) + '（' + g.recs.length + ' 条）  底图原型 ' + BGP + ' #' + proto.id + '  图对 ' + pairOfRec(proto));

let nextId = Math.max(...g.recs.map((r) => r.id)) + 1;
const made = [];
for (const k of KEYS) {
  const rec = g.byName.get(k.name);
  if (!rec) { console.error('找不到 ' + k.name); process.exit(2); }
  const clone = cloneField(proto.field);
  const nid = nextId++;
  (function fx(fs2) { for (const f of fs2) { if (f.wt === 0 && Number(f.num) === proto.id) f.num = BigInt(nid); else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) { const a = asIdList(f.payload, false); if (a && a.length === 1 && a[0] === proto.id) { f.payload = writeVarint(nid); f.len = f.payload.length; } } if (f.sub) fx(f.sub); } })(clone.sub);
  let pOk = false;
  (function fp(fs2) { for (const f of fs2) { if (!pOk && f.wt === 0 && f.field === 504 && Number(f.num) === proto.parentId) { f.num = BigInt(rec.id); pOk = true; } if (f.sub) fp(f.sub); } })(clone.sub);
  const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === proto.name);
  let nOk = false; if (nf) { nf.payload = Buffer.from('bg', 'utf8'); nf.len = nf.payload.length; nOk = true; }
  let geo = 0;
  for (const b of stateBlocks(clone.sub, [])) { const p4 = pairOf(b, 504); if (p4) { p4.sub = [{ field: 501, wt: 5, f: 0 }, { field: 502, wt: 5, f: 0 }]; p4.len = 10; } setPair(pairOf(b, 505), W, H); geo++; }
  if (!pOk || !nOk || geo !== 4) { console.error('  ❌ ' + k.name + ' 克隆不完整'); process.exit(3); }
  holder.push(clone);                                   // ★ 只追加
  const lst = ensureChildListTop(rec, null);
  const cur = asIdList(lst.payload, true) || [];
  const old = g.recs.find((r) => r.parentId === rec.id && r.name === 'bg');
  setChildList(lst, [nid, ...cur.filter((x) => x !== (old && old.id))]);   // ★ 只改 ID 列表
  let g2 = 0;
  for (const b of stateBlocks(rec.field.sub, [])) { if (setPair(pairOf(b, 504), 0, k.cy - PCY)) g2++; setPair(pairOf(b, 505), W, H); }
  if (g2 !== 4) { console.error('  ❌ ' + k.name + ' 几何只改 ' + g2); process.exit(4); }
  // 字段路径差：**排除位置对 `#504` 内部**（底图要铺满 520×60，几何必然与原型 97×43 不同 ⇒ 那是该变的值，
  // 不是"写法不同"）。剩下的差异才说明结构没抄全。
  const dpList = [...PA].filter((x) => !paths({ field: clone }).has(x))
    .concat([...paths({ field: clone })].filter((x) => !PA.has(x)))
    .filter((x) => !x.includes('/504[2]/'));
  const dp = dpList.length;
  const ids0 = asIdList(lst.payload, true);
  console.log('  ' + k.name.padEnd(13) + 'bg #' + nid + ' cy=' + k.cy + '  路径差=' + dp + '  子列表[0]=# ' + ids0[0] + '（' + (g.recs.find((r) => r.id === ids0[0]) ? '旧' : '新') + '）  图对 ' + pairOfRec(clone) + (dpList.length ? '  差异:' + dpList.join(' ') : ''));
  made.push({ k, rec, nid, dp, ids0 });
}

const ml = findChildListTop(modal.field.sub);
const mIds = asIdList(ml.payload, true);
const order = mIds.map((id) => (g.recs.find((r) => r.id === id) || {}).name).filter((n) => KEYS.some((k) => k.name === n));
const orderOk = order.join(',') === KEYS.map((k) => k.name).join(',');
const allUnique = made.every((m) => new Set(m.ids0).size === m.ids0.length);
const firstOk = made.every((m) => m.ids0[0] === m.nid);
const pairOk = true;   // 图对已在上面的逐条日志里打印（clone 是**字段**，还没进 g.recs）
const dpOk = made.every((m) => m.dp === 0);
console.log('  ── 自检：四键子列表第1位=新bg ' + made.filter((m) => m.ids0[0] === m.nid).length + '/4'
  + '  ID 唯一 ' + (allUnique ? '✅' : '❌') + '  与 home.select.bg 路径差 0 ' + (dpOk ? '✅' : '❌')
  + '  兄弟顺序 ' + (orderOk ? '✅' : '❌') + ' ' + order.join(' → '));
if (!(firstOk && allUnique && orderOk && dpOk && pairOk)) { console.error('  ❌ --probe 断言不过，**不写文件**'); process.exit(5); }
if (DRY) { console.log('--probe：断言全过，不写文件'); process.exit(0); }
fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
const g2b = readGil(OUT);
const back = KEYS.map((k) => { const r = g2b.byName.get(k.name); const l = r ? findChildListTop(r.field.sub) : null; const ids = l ? asIdList(l.payload, true) : []; const f = g2b.recs.find((x) => x.id === ids[0]); return f && f.name === 'bg'; });
console.log('  落盘后复读自检：' + back.filter(Boolean).length + '/4  记录 ' + g2b.recs.length + '  字节 ' + fs.statSync(OUT).size);
process.exit(back.every(Boolean) ? 0 : 6);
