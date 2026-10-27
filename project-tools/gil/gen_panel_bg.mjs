// tools/gil/gen_panel_bg.mjs —— 给**面板容器**（intro / modal / topbar / left / right）加一张底图
//
// 为什么需要（2026-09-28 用户报"棋盘上还有控件"）：
//   查下来那两条浮在棋盘上的东西是**教程浮层的「跳过」「下一页」按钮**。
//   它们**位置是对的**（就在教程面板范围内），但**面板本身没有底图** ——
//   于是两条按钮凭空漂在棋盘上，看着就像"多余的控件"。
//   ⇒ 给面板加底图 = 让浮层有实体，按钮就不再"漂"着。
//
// 手法与 `gen_btn_art.mjs` 完全一致（那套已经真机验证过）：
//   ① 克隆**已知可见**的 `content.face`（`visible=true`）——不克隆墙/门（它们存的是隐藏态）
//   ② 把克隆体的 **(imageSource, imageId) 成对改写** —— 只改 id 会出现"属性变了、画面没变"
//   ③ 尺寸 = 面板自身尺寸，位置 (0,0)（铺满）
//   ④ 登记进面板的子控件列表（空列表 = 字段不存在，要新建）
//
// 用法：
//   node tools/gil/gen_panel_bg.mjs --in=a.gil --out=b.gil                       # 默认 intro+modal
//   node tools/gil/gen_panel_bg.mjs --in=a.gil --out=b.gil --names=intro,modal,topbar
//   node tools/gil/gen_panel_bg.mjs --in=a.gil --out=b.gil --src=4281536672 --id=100001

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks, textsOf,
  findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');

const BASE = argOf('in');
const OUT = argOf('out') || BASE;
const NAMES = (argOf('names') || 'intro,modal').split(',').map((s) => s.trim()).filter(Boolean);
const NEW_SRC = Number(argOf('src') || 4281536672);   // 与 wall.left/up 同一个图集
const NEW_ID = Number(argOf('id') || 100001);         // 深靛蓝 —— 当浮层背板比浅色更合适
const CHILD = argOf('child') || 'bg';

if (!BASE) { console.error('必须给 --in='); process.exit(1); }
const g = readGil(BASE);
console.log('存档：' + path.basename(BASE) + '  控件记录 ' + g.recs.length + ' 条');
console.log('目标面板：' + NAMES.join(', '));
console.log('底图素材：source=' + NEW_SRC + '  id=' + NEW_ID);

// ── 原型：已知可见的 face ────────────────────────────────────────────────
const content = g.recs.find((r) => r.name === 'content' && g.recs.some((k) => k.parentId === r.id && k.name === 'face'));
const proto = content ? g.recs.find((r) => r.parentId === content.id && r.name === 'face') : null;
if (!proto) { console.error('找不到 content 下的 face（已知可见的图片控件）'); process.exit(1); }
console.log('原型：face #' + proto.id + '（visible=true，随后成对改写 source+id）');

const IMG_ID_PATH = [505, 503, 84, 503];
const IMG_SRC_PATH = [505, 503, 84, 502];

function fieldsAtPath(fields, p) {
  let level = [fields];
  for (let i = 0; i < p.length; i++) {
    const hits = [];
    for (const list of level) for (const f of list) if (f.field === p[i]) hits.push(f);
    if (!hits.length) return [];
    if (i === p.length - 1) return hits;
    level = hits.map((f) => f.sub).filter(Boolean);
    if (!level.length) return [];
  }
  return [];
}

// 子控件列表：一律用 gilread 的**顶层**版
//   ★★★ 2026-10-07 修：原来用递归 `childListPath(tray.field.sub,'')`（allowEmpty=false）
//   去"学习"字段号与插入位置 —— 而 208 这一版存档里**根本没有 `tray`** ⇒ CLP=null ⇒ 直接 exit 2；
//   就算有 `tray`，它的顶层列表若是空的，递归也会钻进 `#505` 拿到**嵌套字段号**、CL_INDEX=-1
//   ⇒ 新字段插到**位置 0**、字段号还可能是 `#501`。
//   ⇒ 换成 `ensureChildListTop`：新建的 `#503` 固定插在 `#502` 之后（位置 2，与 board 同构）。
function ensureChildList(rec) { return ensureChildListTop(rec, null); }

let nextId = g.maxId + 1;
const built = [];

for (const nm of NAMES) {
  const rec = g.byName.get(nm);
  if (!rec) { console.log('  ⚠️ 找不到 ' + nm + ' → 跳过'); continue; }
  if (g.recs.some((k) => k.parentId === rec.id && k.name === CHILD)) { console.log('  ' + nm + ' 已有 ' + CHILD + ' → 跳过'); continue; }

  // 面板尺寸从它自己的状态块读
  let w = null, h = null;
  for (const block of stateBlocks(rec.field.sub, [])) {
    const p = pairOf(block, 505);
    if (p && p.sub) {
      const a = (p.sub.find((x) => x.field === 501) || {}).f;
      const b = (p.sub.find((x) => x.field === 502) || {}).f;
      if (typeof a === 'number' && a > 0) { w = a; h = b; break; }
    }
  }
  if (w === null) { console.log('  ⚠️ ' + nm + ' 读不到尺寸 → 跳过'); continue; }

  const clone = cloneField(proto.field);
  const oldId = proto.id, newId = nextId++;

  // ① 换 ID
  (function fix(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === oldId) f.num = BigInt(newId);
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; }
      }
      if (f.sub) fix(f.sub);
    }
  })(clone.sub);

  // ② 换父
  let okP = false;
  (function fixParent(fs2) {
    for (const f of fs2) {
      if (!okP && f.wt === 0 && f.field === 504 && Number(f.num) === proto.parentId) { f.num = BigInt(rec.id); okP = true; }
      if (f.sub) fixParent(f.sub);
    }
  })(clone.sub);

  // ③ 换名
  const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === proto.name);
  let okN = false;
  if (nf) { nf.payload = Buffer.from(CHILD, 'utf8'); nf.len = nf.payload.length; okN = true; }

  // ④ 几何：铺满面板
  let geo = 0;
  for (const block of stateBlocks(clone.sub, [])) {
    if (setPair(pairOf(block, 504), 0, 0)) geo++;
    setPair(pairOf(block, 505), w, h);
  }

  // ⑤ **成对**改写 source + id
  const srcF = fieldsAtPath(clone.sub, IMG_SRC_PATH).filter((f) => f.wt === 0)[0];
  const idF = fieldsAtPath(clone.sub, IMG_ID_PATH).filter((f) => f.wt === 0)
    .find((f) => Number(f.num) >= 100000 && Number(f.num) <= 200000);
  if (!srcF || !idF) { console.error('  ❌ ' + nm + ' 的克隆体找不到图片字段'); process.exit(3); }
  srcF.num = BigInt(NEW_SRC);
  idF.num = BigInt(NEW_ID);

  // ⑥ 清空原型自己的子列表 + 登记进面板
  //   ★ 2026-10-07 修：递归版 findChildList(clone.sub, true) ⇒ 只认顶层（见 gilread 注释）
  const mine = findChildListTop(clone.sub);
  if (mine) setChildList(mine, []);
  // ⚠️ **插到子列表最前面**，不能 append！
  //    层级 = 同级子控件的**先后顺序**（`SetSiblingIndex`「数值越大越靠上」），
  //    append 等于把底图放到**最上层** —— 面板底图会**盖住自己的按钮**。
  //    浮层背板必须在最底层，按钮和文字才看得见。
  const list = ensureChildList(rec);
  const cur = asIdList(list.payload, true) || [];
  if (!cur.includes(newId)) cur.unshift(newId);
  setChildList(list, cur);

  if (!okP || !okN || geo !== 4) { console.error('  ❌ ' + nm + ' 补丁不完整'); process.exit(4); }
  built.push({ name: nm, id: newId, clone, holder: rec.holder, index: rec.index, w, h });
  console.log('  ' + nm.padEnd(10) + '+ ' + CHILD + ' #' + newId + '  ' + w + 'x' + h);
}

if (!built.length) { console.log('\n无需改动'); process.exit(0); }
if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

const byHolder = new Map();
for (const it of built) {
  if (!byHolder.has(it.holder)) byHolder.set(it.holder, []);
  byHolder.get(it.holder).push(it);
}
for (const [holder, items] of byHolder) {
  items.sort((a, b) => b.index - a.index);
  for (const it of items) holder.splice(it.index + 1, 0, it.clone);
}

const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);

const g2 = readGil(OUT);
console.log('\n输出：' + path.basename(OUT) + '  ' + buf.length + ' 字节');
const tr = buf.subarray(buf.length - g.trailer.length);
console.log('  尾 ' + tr.toString('hex') + (tr.equals(g.trailer) ? '  ✅' : '  ❌')
  + '   记录 ' + g2.recs.length + '（+' + (g2.recs.length - g.recs.length) + '）');

let bad = 0;
for (const it of built) {
  const r = g2.byName.get(it.name);
  const kid = r && g2.recs.find((x) => x.parentId === r.id && x.name === CHILD);
  if (!kid) { bad++; console.log('  ❌ ' + it.name); continue; }
  const s = fieldsAtPath(kid.field.sub, IMG_SRC_PATH).filter((f) => f.wt === 0)[0];
  const d = fieldsAtPath(kid.field.sub, IMG_ID_PATH).filter((f) => f.wt === 0)[0];
  const ok = s && d && Number(s.num) === NEW_SRC && Number(d.num) === NEW_ID;
  if (!ok) bad++;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + it.name.padEnd(10) + ' source=' + (s && s.num) + ' id=' + (d && d.num));
}
console.log('\n' + (bad === 0 ? '★ 面板底图已加好' : '❌ 有 ' + bad + ' 个不完整'));
process.exit(bad === 0 ? 0 : 5);
