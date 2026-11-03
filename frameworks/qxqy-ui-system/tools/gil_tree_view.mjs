// tools/gil_tree_view.mjs —— 打印控件森林（根 = 无父或父不存在），含几何/文字/图片信息
// 用法：node tools/gil_tree_view.mjs <file.gil> [--root=<name|id>] [--depth=6] [--all]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, pairOf, pairValue, asIdList, findChildListTop } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const MAXDEPTH = Number(argOf('depth') || 6);
const ROOT = argOf('root');

const g = readGil(path.resolve(REPO, FILE));
const byId = new Map(g.recs.map((r) => [r.id, r]));

function kidsOf(rec) {
  const cl = findChildListTop(rec.field.sub);
  const ids = cl ? (asIdList(cl.payload, true) || []) : [];
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
function slotDetails(rec, a, b) {
  for (const f of rec.field.sub) {
    if (f.field !== 505 || !f.sub) continue;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (pA && pB && Number(pA.num) === a && Number(pB.num) === b) return f.sub.find((x) => x.field === 503 && x.sub) || null;
  }
  return null;
}
function textOf(rec) {
  // 文本框 (64,84) / 文本视窗 (71,94) → #75 → #510 → #501 = 字符串
  const det = slotDetails(rec, 64, 84) || slotDetails(rec, 71, 94);
  if (!det) return null;
  const d75 = det.sub.find((x) => x.field === 75);
  if (!d75 || !d75.sub) return null;
  const d510 = d75.sub.find((x) => x.field === 510);
  const fs = d75.sub.find((x) => x.field === 512 && x.wt === 0);
  let txt = '';
  if (d510) {
    if (d510.sub) {
      const s = d510.sub.find((x) => x.field === 501 && x.wt === 2);
      if (s) txt = s.payload.toString('utf8');
    } else if (d510.payload && d510.payload.length) {
      txt = '<raw ' + d510.payload.toString('hex') + '>';
    }
  }
  return { txt, fontSize: fs ? Number(fs.num) : null };
}
function imageOf(rec) {
  const det = slotDetails(rec, 73, 96);
  if (!det) return null;
  const d84 = det.sub.find((x) => x.field === 84);
  if (!d84 || !d84.sub) return null;
  const color = d84.sub.find((x) => x.field === 502 && x.wt === 0);
  const asset = d84.sub.find((x) => x.field === 503 && x.wt === 0);
  return { color: color ? Number(color.num) : null, assetId: asset ? Number(asset.num) : null };
}
function geomOf(rec) {
  // ★ 结构版：`rec.states` 会漏掉"整屏拉伸"容器（offset/size 都是 0 ⇒ 空消息 ⇒ 稀疏编码）
  //   槽 (1,12) → #503 → #13 → #12 → #501(状态包装) → #502(几何容器)
  let st = rec.states[0];
  try {
    const slot = rec.field.sub.find((f) => f.field === 505 && f.sub
      && Number((f.sub.find((x) => x.field === 501 && x.wt === 0) || {}).num) === 1
      && Number((f.sub.find((x) => x.field === 502 && x.wt === 0) || {}).num) === 12);
    const det = slot && slot.sub.find((x) => x.field === 503 && x.sub);
    const d13 = det && det.sub.find((x) => x.field === 13);
    const d12 = d13 && d13.sub && d13.sub.find((x) => x.field === 12);
    const w = d12 && d12.sub && d12.sub.find((f) => f.field === 501 && f.sub);
    const g = w && w.sub.find((x) => x.field === 502 && x.sub);
    if (g) st = g;
  } catch { /* 退回 rec.states */ }
  if (!st) return 'geom=(无状态)';
  const am = pairOf(st, 502), ax = pairOf(st, 503), off = pairOf(st, 504), sz = pairOf(st, 505);
  const p = (f) => (f ? `(${pairValue(f, 0)},${pairValue(f, 1)})` : '(缺)');
  return `aMin=${p(am)} aMax=${p(ax)} off=${p(off)} size=${p(sz)}`;
}

const rootList = ROOT
  ? g.recs.filter((r) => String(r.id) === ROOT || r.name === ROOT)
  : g.recs.filter((r) => r.parentId == null || !byId.has(r.parentId));

function show(rec, depth) {
  const pad = '  '.repeat(depth);
  const parts = [`${pad}${rec.name || '(无名)'} #${rec.id}`];
  if (rec.parentId != null && !byId.has(rec.parentId)) parts.push(`父=${rec.parentId}(不存在)`);
  const t = textOf(rec);
  if (t) parts.push(`文字="${t.txt}" fs=${t.fontSize}`);
  const im = imageOf(rec);
  if (im) parts.push(`图 assetId=${im.assetId} color=${im.color}`);
  parts.push(geomOf(rec));
  const kids = kidsOf(rec);
  parts.push(`子=${kids.length}`);
  console.log(parts.join('  '));
  if (depth < MAXDEPTH) {
    for (const k of kids) show(k, depth + 1);
  } else if (kids.length) console.log(`${pad}  …（更深，共 ${kids.length} 个）`);
}

console.log(`${path.basename(g.file)}  ${g.src.length}B  recs=${g.recs.length}  maxId=${g.maxId}`);
console.log(`根记录 ${rootList.length} 个（无父 / 父不存在者）\n`);
for (const r of rootList) show(r, 0);
