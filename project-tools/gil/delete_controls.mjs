#!/usr/bin/env node
// tools/gil/delete_controls.mjs —— 从 `.gil` 存档里**删除控件**，并在写盘前做双向一致性自检
//
// 用法：
//   node tools/gil/delete_controls.mjs --gil=166.gil --out=out.gil --names=hud.score,action.redo
//   node tools/gil/delete_controls.mjs --gil=166.gil --out=out.gil --ids=1073741940,1073741929
//   加 --dry 只算不写；加 --no-cascade 时若目标有子控件则直接中止（不产出不一致的文件）。
//
// ── 判据：**只用记录「顶层」的 #503 / #504**（2026-10-04 实测确认）────────────────
//   · 控件记录住在 `/9`（tree 里 `#9` 字段）的子消息里；**#9 的子数组就是记录容器**。
//   · 记录**顶层** `#501`(varint)                = 控件 ID（范围 ID_LO..ID_HI）。
//   · 记录**顶层** `#504`(varint)                = 父控件 ID；**没有它 = 根对象**。
//   · 记录**顶层** `#503`(bytes，纯 ID 列表)      = 子控件 ID 列表。
//   · `/9` **顶层** `#501`(bytes，纯 ID 列表)     = **根对象列表**（与"无 #504 者"完全一致）。
//
//   ⚠️ 为什么必须"只看顶层"：这个文件里**嵌套**的 `#504` 到处都是，而且**取值是真的控件 ID**
//   （状态块 `#505/…/#504` 里会出现 1073741888、1073741886 这种合法 ID，`#502` 子消息里
//     还有 `#504 = 1` 这种哨兵值）。`gilread.mjs` 的 `readGil().recs[].parentId` 与
//     `who.mjs` 都是**递归**取"第一个 #504"——对根对象会读出 `parentId = 1`（假的）。
//     本工具**不使用**那个字段，父/子关系一律从记录顶层的 `#503`/`#504` 取。
//   已经全局验证过：本文件**没有任何**嵌套的 `#503` 是合法 ID 列表（嵌套 #503 合法列表数 = 0）；
//   24 个顶层 `#503` 里只有 1 个（`home.bag` #1073742127，载荷 `b082808004b182808004`）
//   **碰巧**也能当消息解析 —— 但那读出来是 `#134217766` 这种本文件根本不存在的字段号
//   （本文件字段号 ≤ 505），纯属巧合；ID 列表读法由"#503↔#504 全图双向自洽"证明。
//   ⇒ 本工具把该字段按"子 ID 列表"处理，并在改写它时把 `sub` 置空以强制写出新载荷。
//   真正的判据是**自洽性**（见闸 1.5）：若顶层 #503/#504 的解释不自洽，本工具**中止不猜**。
//
// ── 删除一个控件要动三处 ───────────────────────────────────────────────────
//   ① 从**父**记录顶层 `#503` 里去掉它的 ID；
//   ② 从 `/9` 的子数组里删掉它这条记录；
//   ③ 若它是根对象（无顶层 `#504`），从 `/9/#501` 根对象列表里去掉它的 ID。
//   ⚠️ 目标若有子控件，会**连带删除整棵子树**：只删父、把子留在原地会产生
//      "子 ID 指向不存在的父"的**悬空子**，自检必然失败（默认行为 = 级联，见 --no-cascade）。
//
// ── 写盘前的四道闸（任何一道不过就**中止、不写文件**）──────────────────────
//   闸 0：自检 `encode(tree)` 与 `pack(encode(tree))` 必须与原文件**逐字节一致**
//         —— 先证明"模型是完整的、编码器无损"，否则后面的验证都不算数。
//   闸 1.5：**模型自证** —— 改动前的 `#503`↔`#504` 必须**全图自洽**（mismatch/dangling/
//         parentMissing 全 0），且"根对象列表 == 无顶层 #504 的记录集合"。这是"我认对了
//         父子字段"的证据；不自洽就说明字段认错了 ⇒ 中止不猜。
//   闸 1：把改完的字节**重新解析一遍**，要求被删 ID 在**整个文件里 0 次出现**
//         （varint 字段取值 / 任何 ID 列表载荷都算）。
//   闸 2：重新解析后的 `#503`↔`#504` 必须**双向一致**：mismatch=0、dangling=0、parentMissing=0，
//         且实体数正好减少"删除条数"。
//
// 输出刻意保持简短、数字化。

import fs from 'node:fs';
import { readGil, parseMsg, writeVarint, asIdList, textsOf, setChildList, ID_LO, ID_HI, KNOWN_TYPES } from './gilread.mjs';

const USAGE = [
  'usage: node tools/gil/delete_controls.mjs --gil=<in.gil> [--out=<out.gil>]',
  '        [--names=a,b,...] [--ids=1,2,...] [--dry] [--no-cascade]',
].join('\n');

const die = (msg) => { console.error('ABORT: ' + msg); process.exit(2); };

// ── 参数 ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { dry: false, cascade: true, names: [], ids: [] };
  for (const a of argv) {
    if (a === '--dry') o.dry = true;
    else if (a === '--no-cascade') o.cascade = false;
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a.startsWith('--gil=')) o.gil = a.slice(6);
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a.startsWith('--names=')) o.names.push(...a.slice(8).split(',').map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith('--ids=')) o.ids.push(...a.slice(6).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      if (!/^\d+$/.test(s)) die('--ids 里有非数字：' + s);
      return Number(s);
    }));
    else die('未知参数：' + a);
  }
  if (!o.gil) die('缺少 --gil=<in>（不猜默认存档，避免误碰活动存档）\n' + USAGE);
  if (!o.dry && !o.out) die('缺少 --out=<out>（或加 --dry 只算不写）\n' + USAGE);
  if (!o.names.length && !o.ids.length) die('必须给 --names= 或 --ids=');
  return o;
}

// ── 模型：只认记录顶层的 #501 / #503 / #504 ────────────────────────────────
/**
 * 从一棵已解析的树里取控件模型。
 * 返回 { holder, holderPath, rootList, ents(按 ID), order(容器顺序), nonEntity }
 * 任何"说不清"的情况一律抛错 —— 宁可停，也不猜。
 */
function buildModel(tree) {
  const nines = tree.filter((f) => f.field === 9 && f.sub);
  if (nines.length !== 1) die('期望恰好 1 个带子消息的 `#9`（记录容器），实际 ' + nines.length + ' 个');
  const holder = nines[0].sub;

  // 根对象列表：/9 顶层里"载荷是纯 ID 列表"的 #501
  const rls = holder.filter((f) => f.field === 501 && f.wt === 2 && !f.isText && asIdList(f.payload, true) !== null);
  if (rls.length > 1) die('`/9` 顶层出现 ' + rls.length + ' 个像根对象列表的 #501，无法确定用哪个');
  const rootList = rls[0] || null;
  if (rootList && rootList.sub !== null) die('`/9/#501` 根对象列表同时能当消息解析 —— 无法确定语义，停止');

  const ents = new Map();
  const order = [];
  const nonEntity = [];
  holder.forEach((rec, index) => {
    if (!rec.sub) { nonEntity.push({ index, why: 'wt' + rec.wt + ' 无子消息' }); return; }
    const idF = rec.sub.filter((f) => f.wt === 0 && f.field === 501 && f.num > ID_LO && f.num < ID_HI);
    if (idF.length === 0) { nonEntity.push({ index, why: '顶层无 #501 控件 ID' }); return; }
    if (idF.length > 1) die('记录（容器序 ' + index + '）顶层有 ' + idF.length + " 个 #501 ID，无法确定");
    const id = Number(idF[0].num);
    if (ents.has(id)) die('控件 ID 重复：' + id);

    const pidF = rec.sub.filter((f) => f.wt === 0 && f.field === 504);
    if (pidF.length > 1) die('记录 #' + id + ' 顶层有 ' + pidF.length + ' 个 #504，无法确定父');
    const pid = pidF.length ? Number(pidF[0].num) : null;

    const clF = rec.sub.filter((f) => f.field === 503);
    if (clF.length > 1) die('记录 #' + id + ' 顶层有 ' + clF.length + ' 个 #503，无法确定子列表');
    let childList = null, childIds = null, alsoMsg = false;
    if (clF.length === 1) {
      const c = clF[0];
      const ids = (c.wt === 2 && !c.isText) ? asIdList(c.payload, true) : null;
      if (ids === null) die('记录 #' + id + ' 的顶层 #503 不是纯 ID 列表（wt' + c.wt + '/len' + (c.len ?? '-') + '），不敢动');
      childList = c; childIds = ids; alsoMsg = c.sub !== null;
    }

    let name = null;
    for (const t of textsOf(rec.sub, [])) {
      const s = t.payload.toString('utf8');
      if (!KNOWN_TYPES.has(s)) { name = s; break; }
    }
    const e = { id, pid, name, node: rec, index, childList, childIds, alsoMsg };
    ents.set(id, e);
    order.push(e);
  });
  return { holder, holderPath: '/#9', rootList, ents, order, nonEntity };
}

/** 统计"**记录顶层以外**"的合法 #503 ID 列表有多少个（本文件应为 0；不为 0 说明顶层规则不够用） */
function nestedIdLists(tree, holder) {
  let n = 0;
  const count = (fields) => {
    for (const f of fields) {
      if (f.field === 503 && f.wt === 2 && !f.isText && asIdList(f.payload, true) !== null) n++;
      if (f.sub) count(f.sub);
    }
  };
  for (const f of tree) if (f.sub && f.sub !== holder) count(f.sub);          // 容器以外的其它树部分
  for (const rec of holder) if (rec.sub) for (const f of rec.sub) if (f.sub) count(f.sub);  // 记录内部（跳过记录顶层）
  return n;
}

/** 被删 ID 在整个文件里的残留次数（varint 取值 + 任何 ID 列表载荷） */
function occurrencesOf(tree, ids) {
  const S = ids instanceof Set ? ids : new Set(ids);
  const where = [];
  let n = 0;
  (function scan(fields, path) {
    fields.forEach((f, k) => {
      const here = path + '/#' + f.field + '[' + k + ']';
      if (f.wt === 0) {
        if (S.has(Number(f.num))) { n++; if (where.length < 6) where.push('varint ' + f.num + ' @' + here); }
      } else if (f.wt === 2 && !f.isText && f.len > 0) {
        const list = asIdList(f.payload, true);
        if (list && list.some((x) => S.has(x))) { n++; if (where.length < 6) where.push('idlist @' + here); }
      }
      if (f.sub) scan(f.sub, here);
    });
  })(tree, '');
  return { n, where };
}

/** #503 ↔ #504 双向一致性 */
function linkCheck(ents) {
  let mismatch = 0, dangling = 0, parentMissing = 0;
  const detail = [];
  for (const e of ents.values()) {
    if (e.pid === null) continue;
    const p = ents.get(e.pid);
    if (!p) { parentMissing++; if (detail.length < 6) detail.push('parentMissing #' + e.id + ' -> ' + e.pid); continue; }
    if (!p.childIds || !p.childIds.includes(e.id)) { mismatch++; if (detail.length < 6) detail.push('mismatch #' + e.id + ' claims ' + e.pid + ' but parent lists ' + JSON.stringify(p.childIds)); }
  }
  for (const e of ents.values()) {
    if (!e.childIds) continue;
    for (const cid of e.childIds) {
      const c = ents.get(cid);
      if (!c) { dangling++; if (detail.length < 6) detail.push('dangling #' + e.id + ' lists #' + cid + ' (不存在)'); continue; }
      if (c.pid !== e.id) { dangling++; if (detail.length < 6) detail.push('dangling #' + e.id + ' lists #' + cid + ' whose pid=' + c.pid); }
    }
  }
  return { mismatch, dangling, parentMissing, detail };
}

/** 无损重编码：wt5/wt1 直接从原缓冲取原始字节（gilread.encodeMsg 会把 wt1 写成 8 个 0） */
function encodeTree(fields, src) {
  const parts = [];
  for (const f of fields) {
    parts.push(writeVarint(BigInt(f.field) * 8n + BigInt(f.wt)));
    if (f.wt === 0) parts.push(writeVarint(f.num));
    else if (f.wt === 5) parts.push(src.subarray(f.s1 - 4, f.s1));
    else if (f.wt === 1) parts.push(src.subarray(f.s1 - 8, f.s1));
    else {
      const b = Array.isArray(f.sub) ? encodeTree(f.sub, src) : f.payload;
      parts.push(writeVarint(BigInt(b.length)));
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const o = parseArgs(process.argv.slice(2));
const g = readGil(o.gil);
const body0 = g.src.subarray(20, g.bodyEnd);

console.log('gil      ' + o.gil + '  ' + g.src.length + ' B  body ' + body0.length + '  trailer ' + g.trailer.length);

// 闸 0：模型完整性
const enc0 = encodeTree(g.tree, g.src);
const packed0 = g.pack(enc0);
const gate0 = enc0.equals(body0) && packed0.equals(g.src);
console.log('gate0    encode==body ' + (enc0.equals(body0) ? 'yes' : 'NO') + '  pack==file ' + (packed0.equals(g.src) ? 'yes' : 'NO'));
if (!gate0) die('编码器无法逐字节还原原文件 —— 模型不完整，拒绝改写');

const M0 = buildModel(g.tree);
const n0 = nestedIdLists(g.tree, M0.holder);
const top503 = M0.order.filter((e) => e.childList).length;
const alsoMsg = M0.order.filter((e) => e.alsoMsg).length;
const lc0 = linkCheck(M0.ents);
const roots0 = M0.order.filter((e) => e.pid === null).length;
const rootIds0 = M0.rootList ? asIdList(M0.rootList.payload, true) : [];
const parentless0 = M0.order.filter((e) => e.pid === null).map((e) => e.id).sort((a, b) => a - b);
const rootListMatches = JSON.stringify([...rootIds0].sort((a, b) => a - b)) === JSON.stringify(parentless0);
console.log('before   entities ' + M0.ents.size + '  roots ' + roots0 + '  toplevel#503 ' + top503
  + '  (alsoMsg ' + alsoMsg + ')  nested#503-idlist ' + n0 + '  nonEntityChildren ' + M0.nonEntity.length);
console.log('before   link mismatch ' + lc0.mismatch + '  dangling ' + lc0.dangling + '  parentMissing ' + lc0.parentMissing
  + '  rootList==parentless ' + (rootListMatches ? 'yes' : 'NO'));
// 闸 1.5：模型自证 —— 顶层 #503/#504 的解释必须**全图自洽**，否则说明我认错了字段，停止。
if (n0 !== 0) die('文件里存在 ' + n0 + ' 个**嵌套**的合法 #503 ID 列表 —— 顶层规则不够用，停止');
if (lc0.mismatch || lc0.dangling || lc0.parentMissing) {
  for (const d of lc0.detail) console.log('  ' + d);
  die('顶层 #503/#504 的解释**不自洽**（mismatch ' + lc0.mismatch + ' / dangling ' + lc0.dangling
    + ' / parentMissing ' + lc0.parentMissing + '）—— 无法确定哪个才是真正的父子字段，停止');
}
if (!rootListMatches) die('`/9/#501` 根对象列表与"无顶层 #504 的记录集合"不一致 —— 根对象列表语义存疑，停止');

// 目标解析：按名字（重名跳过）/ 按 ID
const targets = [];
for (const want of o.names) {
  const hits = M0.order.filter((e) => e.name === want);
  if (hits.length === 0) { console.log('target   ' + want.padEnd(16) + ' NOT-FOUND'); continue; }
  if (hits.length > 1) { console.log('target   ' + want.padEnd(16) + ' DUPLICATE x' + hits.length + ' ids=' + hits.map((h) => h.id).join(',') + '  -> SKIPPED（不猜）'); continue; }
  targets.push({ want, e: hits[0], by: 'name' });
}
for (const id of o.ids) {
  const e = M0.ents.get(id);
  if (!e) { console.log('target   #' + id + '  NOT-FOUND'); continue; }
  targets.push({ want: '#' + id, e, by: 'id' });
}

// 去重
const seen = new Set();
const uniq = [];
for (const t of targets) { if (seen.has(t.e.id)) continue; seen.add(t.e.id); uniq.push(t); }

// 级联闭包
const deleted = new Map();          // id -> {via}
const queue = [];
for (const t of uniq) { deleted.set(t.e.id, { via: null, e: t.e }); queue.push(t.e.id); }
while (queue.length) {
  const id = queue.shift();
  const e = M0.ents.get(id);
  for (const cid of (e.childIds || [])) {
    if (deleted.has(cid)) continue;
    deleted.set(cid, { via: id, e: M0.ents.get(cid) });
    queue.push(cid);
  }
}

for (const t of uniq) {
  const e = t.e;
  const parent = e.pid === null ? null : M0.ents.get(e.pid);
  console.log('target   ' + t.want.padEnd(16) + ' found=1 id=' + e.id
    + ' parent=' + (e.pid === null ? 'ROOT-OBJECT' : e.pid + (parent && parent.name ? ' "' + parent.name + '"' : ''))
    + ' root=' + (e.pid === null ? 'yes' : 'no')
    + ' children=' + (e.childIds ? e.childIds.length : 0)
    + ' inParentList=' + (parent && parent.childIds ? parent.childIds.includes(e.id) : '-')
    + ' bytes=' + (e.node.s1 - e.node.s0)
    + ' -> REMOVE');
}
const dupSkipped = o.names.filter((w) => M0.order.filter((e) => e.name === w).length > 1);
if (dupSkipped.length) console.log('copy     duplicate-names-skipped ' + dupSkipped.length + ' [' + dupSkipped.join(',') + ']');

const extra = [...deleted.keys()].filter((id) => !seen.has(id));
console.log('cascade  targets ' + uniq.length + '  +descendants ' + extra.length + '  = delete ' + deleted.size + ' records');
for (const id of extra) {
  const d = deleted.get(id);
  console.log('  child  #' + id + ' "' + (d.e.name || '') + '" parent=' + d.e.pid + ' (via #' + d.via + ')'
    + ' root=' + (d.e.pid === null ? 'yes' : 'no') + ' children=' + (d.e.childIds ? d.e.childIds.length : 0) + ' -> REMOVE');
}
if (!o.cascade && extra.length) die('--no-cascade：目标带 ' + extra.length + " 个子控件，只删目标会留下悬空子 ID；拒绝写盘");

if (uniq.length === 0) die('没有任何可删目标（全部未找到或被重名跳过）');

// ── 应用改动 ──────────────────────────────────────────────────────────────
const delIds = new Set(deleted.keys());
let listEdits = 0;
for (const id of delIds) {
  const e = M0.ents.get(id);
  if (e.pid === null) continue;
  if (delIds.has(e.pid)) continue;               // 父自己也删 ⇒ 整条记录都会消失，不必改列表
  const p = M0.ents.get(e.pid);
  // ★ 2026-10-07 复核（**无需修改，勿"顺手统一"**）：
  //   `p.childList` 来自本文件 buildModel() 的 `rec.sub.filter((f) => f.field === 503)`
  //   —— 它本来就**只认记录顶层**、且**锚定字段号 503**，比 gilread.findChildListTop 更严：
  //     顶层出现 ≥2 个 #503 → 直接 die；#503 不是纯 ID 列表 → 直接 die。
  //   本文件**从不使用** gilread 的递归 `findChildList`，也不读 `readGil().recs[].childList`。
  //   另有闸 1.5（nestedIdLists）在动刀前就拒绝"存在嵌套 #503 ID 列表"的文件。
  if (!p.childList) die('父 #' + p.id + ' 没有顶层 #503，无法摘除子 #' + id);
  const at = p.childIds.indexOf(id);
  if (at < 0) die('父 #' + p.id + ' 的 #503 里没有子 #' + id + '（关系不自洽，停止）');
  p.childIds.splice(at, 1);
  setChildList(p.childList, p.childIds);
  p.childList.sub = null;                        // 保证按 payload 原样写出
  listEdits++;
}
// ③ 根对象列表
let rootEdits = 0;
for (const id of delIds) {
  const e = M0.ents.get(id);
  if (e.pid !== null) continue;
  if (!M0.rootList) die('有根对象 #' + id + ' 要删，但没找到 /9/#501 根对象列表');
  const at = rootIds0.indexOf(id);
  if (at < 0) die('根对象列表里没有 #' + id + '（关系不自洽，停止）');
  rootIds0.splice(at, 1);
  rootEdits++;
}
if (rootEdits) { setChildList(M0.rootList, rootIds0); M0.rootList.sub = null; }

// ② 从容器里删记录（原地 splice，保持 holder 引用有效）
const delNodes = new Set([...delIds].map((id) => M0.ents.get(id).node));
const keep = M0.holder.filter((f) => !delNodes.has(f));
if (M0.holder.length - keep.length !== delIds.size) die('容器里应删 ' + delIds.size + ' 条，实际匹配到 ' + (M0.holder.length - keep.length) + ' 条');
M0.holder.splice(0, M0.holder.length, ...keep);

// ── 闸 1 / 闸 2：把改完的字节重新解析一遍再验 ─────────────────────────────
const newBody = encodeTree(g.tree, g.src);
const newSrc = g.pack(newBody);
const tree2 = parseMsg(newSrc, 20, 20 + newSrc.readUInt32BE(16), 0);
if (!tree2) die('改完的体无法重新解析 —— 拒绝写盘');
const M1 = buildModel(tree2);
const lc1 = linkCheck(M1.ents);
const occ = occurrencesOf(tree2, delIds);
const rootIds1 = M1.rootList ? asIdList(M1.rootList.payload, true) : [];
const rootLeftover = [...delIds].filter((id) => rootIds1.includes(id));

console.log('after    entities ' + M1.ents.size + '  roots ' + M1.order.filter((e) => e.pid === null).length
  + '  toplevel#503 ' + M1.order.filter((e) => e.childList).length + '  nested#503-idlist ' + nestedIdLists(tree2, M1.holder)
  + '  nonEntityChildren ' + M1.nonEntity.length);
console.log('after    link mismatch ' + lc1.mismatch + '  dangling ' + lc1.dangling + '  parentMissing ' + lc1.parentMissing);
console.log('edits    parentLists ' + listEdits + '  rootListEntries ' + rootEdits + '  recordsRemoved ' + delIds.size);
console.log('counts   entities ' + M0.ents.size + ' -> ' + M1.ents.size + '  delta ' + (M1.ents.size - M0.ents.size));
console.log('verify   deletedIdOccurrences ' + occ.n + '  rootListLeftover ' + rootLeftover.length
  + '  bodyDelta ' + (newBody.length - body0.length) + ' B');

const ok = occ.n === 0 && rootLeftover.length === 0 && lc1.mismatch === 0 && lc1.dangling === 0 && lc1.parentMissing === 0
  && (M0.ents.size - M1.ents.size) === delIds.size;
if (!ok) {
  for (const w of occ.where) console.log('  leftover ' + w);
  for (const d of lc1.detail) console.log('  ' + d);
  die('自检未通过（残留 ' + occ.n + ' / mismatch ' + lc1.mismatch + ' / dangling ' + lc1.dangling + ' / parentMissing ' + lc1.parentMissing + '）—— 未写任何文件');
}
console.log('verify   OK');

if (o.dry) { console.log('dry      no write'); process.exit(0); }
fs.writeFileSync(o.out, newSrc);
console.log('wrote    ' + o.out + '  ' + newSrc.length + ' B');
