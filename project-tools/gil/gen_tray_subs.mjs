// tools/gil/gen_tray_subs.mjs —— 给 **7 张头像卡**补 `face` / `text` 子控件（美术接线）
//
// 为什么能这么做（都有真机证据）：
//   ① **克隆控件会把图一起带过去** —— 我给格子模板克隆 `face` 生成的 `obj`，
//      真机日志是 `obj visible=true imageType=Stretch imageId=106053` ✅
//      （图片引用落在 `#505/#503/#84/#503`，克隆是整棵子树复制，自然不会丢。）
//   ② **没被状态节点引用的子控件照常渲染** —— 用户往 `tray.D` 加了个图片子控件、
//      **没动任何状态节点**，实测**图片正常显示** ✅
//      （官方说的"外显样式"指的是按钮自己的底图，不是子控件能不能画。）
//   ⇒ 所以头像卡的头像我**不需要你在编辑器里点任何东西**。
//
// 做什么：给 tray.A..F / tray.V 各加
//   · `face`：克隆格子模板里的 `face`（自带底图 106053），尺寸 = 卡片尺寸
//   · `text`：克隆 `proto.text`，贴在卡片底部（显示角色名）
//   卡片尺寸 68×87（与 layout-plan 一致）。运行时 `apply_tray_layout` 会把
//   face/text 跟着卡片一起重排（它本来就有 `local kids = { "face", "text" }`）。
//
// 用法：
//   node tools/gil/gen_tray_subs.mjs --in=完整界面4.gil --out=完整界面5.gil
//   node tools/gil/gen_tray_subs.mjs --in=... --out=... --probe

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks, textsOf,
  findChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '完整界面4.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面5.gil');
const CARDS = ['tray.A', 'tray.B', 'tray.C', 'tray.D', 'tray.E', 'tray.F', 'tray.V'];

const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '（' + g.src.length + ' 字节）控件记录 ' + g.recs.length + ' 条');

// ── 原型：格子模板里的 face（自带图）+ proto.text ─────────────────────────
// 用 `content` 下的那个 face（模板画布里配好图的那个）
const content = g.recs.find((r) => r.name === 'content' && g.recs.some((k) => k.parentId === r.id && k.name === 'face'));
const protoFace = content ? g.recs.find((r) => r.parentId === content.id && r.name === 'face') : null;
const protoText = g.byName.get('proto.text');
if (!protoFace) { console.error('找不到模板里的 face（配了图的图片控件）'); process.exit(1); }
if (!protoText) { console.error('找不到 proto.text'); process.exit(1); }
console.log('原型：face #' + protoFace.id + '（' + protoFace.states.length + ' 状态块）'
  + '   proto.text #' + protoText.id + '（' + protoText.states.length + ' 状态块）');

let nextId = g.maxId + 1;
const built = [];
let skipped = 0;

// ── 子控件列表的**路径**定位 ──────────────────────────────────────────────
// ⚠️ 头像卡的子列表是**空**的（0 字节）。而"空 payload"会被 `asIdList(_, true)` 解成空列表，
//    于是任何空字段都会被误认成子列表 —— 所以不能靠"扫一个空字段"来定位。
//    正确做法：从**已知非空的**子列表拿到字段路径，再按同一路径去取空的那个。
function pathOfChildList(fields, prefix, depth) {
  for (const f of fields) {
    const here = prefix + '/#' + f.field;
    if (f.wt === 2 && f.sub === null && !f.isText && f.payload && asIdList(f.payload, false) !== null) return here;
    if (f.sub) { const r = pathOfChildList(f.sub, here, depth + 1); if (r) return r; }
  }
  return null;
}
function fieldAtPath(fields, path) {
  if (!path) return null;
  const parts = path.split('/').filter(Boolean).map((s) => Number(s.replace('#', '')));
  let cur = fields, f = null;
  for (const want of parts) {
    f = cur.find((x) => x.field === want) || null;
    if (!f) return null;
    cur = f.sub;
    if (cur === null || cur === undefined) return (want === parts[parts.length - 1]) ? f : null;
  }
  return f;
}
// ⚠️ 路径必须**相对某条控件记录**取，不能从整棵树取 ——
//    第一次我从 tree 根扫，拿到 `/#9/#501`（那是根结构的另一层），
//    拿它去 `rec.field.sub` 里找当然找不到，7 张卡全被跳过。
//    改成：从 `tray`（它有 7 个子控件，列表非空）这条**记录**里取路径。
const trayRec = g.byName.get('tray');
const CL_PATH = trayRec ? pathOfChildList(trayRec.field.sub, '', 0) : null;
console.log('子控件列表字段路径（相对记录）：' + (CL_PATH || '**没找到非空列表**'));
if (!CL_PATH) { console.error('无法定位子列表路径'); process.exit(5); }

// 列表字段的**字段号**与它在记录里的**位置**（新建时照这个位置插，尽量贴近原结构）
const CL_FIELD_NO = Number(CL_PATH.split('/').filter(Boolean).pop().replace('#', ''));
const CL_INDEX = trayRec.field.sub.findIndex((f) => f.field === CL_FIELD_NO);

// ⚠️ 关键理解：**子列表为空 = 这个字段根本不存在**（不是"长度为 0"）。
//    所以我不能"按路径去取空的那个"，而要**新建**这个字段。
//    protobuf 不要求字段顺序，但为了尽量贴近原结构，按 `tray` 里它的位置插入。
function ensureChildList(rec) {
  let f = rec.field.sub.find((x) => x.field === CL_FIELD_NO) || null;
  if (f === null) {
    f = { field: CL_FIELD_NO, wt: 2, len: 0, payload: Buffer.alloc(0), isText: false, sub: null, s0: 0, s1: 0 };
    const at = Math.min(Math.max(CL_INDEX, 0), rec.field.sub.length);
    rec.field.sub.splice(at, 0, f);
    rec._childListCreated = true;
  }
  return f;
}

for (const card of CARDS) {
  const rec = g.byName.get(card);
  if (!rec) { console.log('  ⚠️ 找不到 ' + card + ' → 跳过'); continue; }
  if (rec.states.length !== 4) { console.log('  ⚠️ ' + card + ' 状态块 ' + rec.states.length + ' ≠ 4 → 跳过'); continue; }
  // 空列表也要拿得到 —— 不存在就新建（见 ensureChildList 的说明）
  if (!rec.childList) rec.childList = ensureChildList(rec);
  if (!rec.childList) { console.log('  ⚠️ ' + card + ' 子列表拿不到 → 跳过'); continue; }

  // 卡片尺寸从它自己的第一个状态块读（我生成时写的就是 68×87）
  const b0 = rec.states[0];
  const cw = (pairOf(b0, 505) && pairOf(b0, 505).sub) ? (pairOf(b0, 505).sub.find((x) => x.field === 501) || {}).f : null;
  const ch = (pairOf(b0, 505) && pairOf(b0, 505).sub) ? (pairOf(b0, 505).sub.find((x) => x.field === 502) || {}).f : null;
  const w = (typeof cw === 'number' && cw > 0) ? cw : 68;
  const h = (typeof ch === 'number' && ch > 0) ? ch : 87;

  const SPECS = [
    { name: 'face', proto: protoFace, pos: [0, 0], size: [w, h] },
    { name: 'text', proto: protoText, pos: [0, -Math.round(h / 2) + 12], size: [w, 20] },
  ];

  for (const spec of SPECS) {
    // 幂等：已经有同名子控件就跳过
    if (g.recs.some((r) => r.parentId === rec.id && r.name === spec.name)) { skipped++; continue; }

    const clone = cloneField(spec.proto.field);
    const oldId = spec.proto.id, newId = nextId++;

    // ① 换 ID（varint + 紧凑形式）
    let nId = 0;
    (function fix(fs2) {
      for (const f of fs2) {
        if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); nId++; }
        else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
          const ids = asIdList(f.payload, false);
          if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; nId++; }
        }
        if (f.sub) fix(f.sub);
      }
    })(clone.sub);

    // ② 换父
    let pOk = false;
    (function fixParent(fs2) {
      for (const f of fs2) {
        if (!pOk && f.wt === 0 && f.field === 504 && Number(f.num) === spec.proto.parentId) { f.num = BigInt(rec.id); pOk = true; }
        if (f.sub) fixParent(f.sub);
      }
    })(clone.sub);

    // ③ 换名字
    const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === spec.proto.name);
    let nOk = false;
    if (nf) { nf.payload = Buffer.from(spec.name, 'utf8'); nf.len = nf.payload.length; nOk = true; }

    // ④ 几何
    let geo = 0;
    for (const block of stateBlocks(clone.sub, [])) {
      if (setPair(pairOf(block, 504), spec.pos[0], spec.pos[1])) geo++;
      setPair(pairOf(block, 505), spec.size[0], spec.size[1]);
    }

    // ⑤ 清空原型自己的子列表
    //   ★ 2026-10-07 修：递归版 ⇒ 只认顶层（否则会去清空 #505 里的无关字段）
    const myChild = findChildListTop(clone.sub);
    if (myChild) setChildList(myChild, []);

    // ⑥ 登记进卡片的子列表
    if (!rec.childList) { console.error('  ❌ ' + card + ' 没有子控件列表'); process.exit(2); }
    {
      const cur = asIdList(rec.childList.payload, true) || [];
      if (!cur.includes(newId)) cur.push(newId);
      setChildList(rec.childList, cur);
    }

    if (!pOk || !nOk || geo !== 4) { console.error('  ❌ ' + card + '/' + spec.name + ' 补丁不完整'); process.exit(3); }
    built.push({ card, name: spec.name, id: newId, clone, holder: rec.holder, index: rec.index });
    console.log('  ' + card.padEnd(8) + '+ ' + spec.name.padEnd(5) + ' #' + newId
      + '  尺寸 ' + spec.size.join('×') + '  位置(' + spec.pos.join(',') + ')'
      + '  ID×' + nId + ' 父' + (pOk ? '✅' : '❌') + ' 名' + (nOk ? '✅' : '❌') + ' 几何' + geo + '/4');
  }
}
console.log('新建 ' + built.length + ' 个（跳过已存在的 ' + skipped + ' 个）');
if (!built.length) { console.log('\n无需改动'); process.exit(0); }
if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

// ── 插入（按 holder 分组、从后往前插，索引不失效）──────────────────────────
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
const outBuf = g.pack(body);
fs.writeFileSync(OUT, outBuf);

// ── 自检 ──────────────────────────────────────────────────────────────────
const g2 = readGil(OUT);
console.log('\n输出：' + path.basename(OUT));
console.log('  体 ' + body.length + '（原 ' + g.hdr[4] + '，+' + (body.length - g.hdr[4]) + '）  文件 ' + outBuf.length);
console.log('  头 ' + [0, 4, 8, 12, 16].map((o) => outBuf.readUInt32BE(o)).join(', '));
const tr = outBuf.subarray(outBuf.length - g.trailer.length);
console.log('  尾 ' + tr.toString('hex') + (tr.equals(g.trailer) ? '  ✅' : '  ❌'));
console.log('  重新解析 ✅ 控件记录 ' + g2.recs.length + '（原 ' + g.recs.length + '，应 +' + built.length + '）');

let bad = 0;
for (const card of CARDS) {
  const r = g2.recs.find((x) => x.name === card);
  if (!r) { bad++; continue; }
  const kids = g2.recs.filter((x) => x.parentId === r.id).map((x) => x.name);
  const ok = kids.includes('face') && kids.includes('text');
  if (!ok) bad++;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + card.padEnd(8) + ' 子控件 [' + kids.join(', ') + ']');
}
console.log('\n' + (bad === 0 ? '★ 7 张头像卡的 face/text 都挂上了' : '❌ 有 ' + bad + ' 张不完整'));
process.exit(bad === 0 ? 0 : 4);
