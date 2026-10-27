// tools/gil/gen_template_subs.mjs —— 给**格子模板**补上缺失的子控件（`text` / `obj`）
//
// 起因（2026-09-27，对账 check_names.mjs 抓出来的）：
//   重建模板（用 `content` 把子控件包起来那版）时**漏掉了 `text` 和 `obj`**。
//   脚本证据：
//     · ui_controller 的格子 push 里带 `text = text` —— 格子是要显示文字的；
//     · engine_adapter `set_property(id,"text")` 是
//         `if ctrl.text ~= nil then ... else c = sub(id,"text"); c.text = v end`
//       而**预设按钮没有 `text` 属性**（只有 interactable/clickAudioId/raycastTarget）
//       → **必须靠 `text` 子控件**，缺了就静默不显示；
//     · `obj`（物件图标层）在 `enforce_layers` 里是 `if sub ~= nil` 容错的，可选但建议补。
//
// 做法：`obj` ← 克隆同组的 `face`；`text` ← 克隆 `proto.text`；
//       都挂到模板的 `content` 下，并登记进 content 的子控件列表。
//
// 用法：
//   node tools/gil/gen_template_subs.mjs --probe
//   node tools/gil/gen_template_subs.mjs --in=完整界面.gil --out=完整界面2.gil

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, pairValue, stateBlocks, textsOf,
  findChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '完整界面.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面2.gil');

const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '（' + g.src.length + ' 字节）控件记录 ' + g.recs.length + ' 条');

// ── 定位**正确那套**模板的 content ────────────────────────────────────────
// ⚠️ 存档里有**两套**模板（各是一份 `cell.1.1 → content → 子控件`），
//    必须挑 `tpl.cell` 实际引用的那套 —— 也就是 `cfg.cells.prefab` 指的那个索引。
//    第一版按名字取（Map 只留最后一个），正好取到了另一套 → 白改。
//    默认 1073741876 = entry_client_script.lua 里 cfg.cells.prefab 的值。
const TPL_ID = Number(argOf('template') || 1073741876);
let tplRoot = g.recs.find((r) => r.id === TPL_ID);
if (!tplRoot) {
  // 退路：取"子控件最多的那个 cell.1.1"
  const cands = g.recs.filter((r) => r.name === 'cell.1.1')
    .map((r) => ({ r, n: g.recs.filter((x) => x.parentId === r.id).length }))
    .sort((a, b) => b.n - a.n);
  if (!cands.length) { console.error('找不到任何 cell.1.1'); process.exit(1); }
  tplRoot = cands[0].r;
  console.log('⚠️ 索引 ' + TPL_ID + ' 不存在，退化为"子控件最多的 cell.1.1" #' + tplRoot.id);
}
const content = g.recs.find((r) => r.parentId === tplRoot.id) || null;
if (!content) { console.error('#' + tplRoot.id + ' 下没有 content'); process.exit(1); }
const contentId = content.id;
const kids = g.recs.filter((r) => r.parentId === contentId).map((r) => r.name).sort();
console.log('模板根 cell.1.1 = #' + tplRoot.id + ' → content = #' + content.id
  + '  现有子控件 ' + kids.length + ' 个：' + kids.join(', '));
const allRoots = g.recs.filter((r) => r.name === 'cell.1.1').map((r) => r.id);
if (allRoots.length > 1) console.log('  （存档里共 ' + allRoots.length + ' 个 cell.1.1：' + allRoots.join(', ')
  + '；只改 #' + tplRoot.id + ' 这套）');

// ── 要补的两个（幂等：已存在就跳过）──────────────────────────────────────
// 尺寸照格子设计：格子 135×135；obj 是物件图标层（居中），text 是底部标签。
const SPECS = [
  { name: 'obj', proto: 'face', pos: [0, 0], size: [81, 81], why: '物件图标层（克隆同组 face）' },
  { name: 'text', proto: 'proto.text', pos: [0, -52], size: [135, 24], why: '格子文字（克隆 proto.text）' },
];

let nextId = g.maxId + 1;
const built = [];
for (const spec of SPECS) {
  if (kids.includes(spec.name)) { console.log('  ' + spec.name + ' 已存在 → 跳过'); continue; }
  const proto = g.byName.get(spec.proto);
  if (!proto) { console.error('缺原型 ' + spec.proto); process.exit(2); }
  if (proto.states.length !== 4) { console.error('原型 ' + spec.proto + ' 状态块 ' + proto.states.length + ' ≠ 4'); process.exit(3); }
  if (!proto.nameField) { console.error('原型 ' + spec.proto + ' 找不到名字字段'); process.exit(3); }

  const clone = cloneField(proto.field);
  const oldId = proto.id, newId = nextId++;

  // ① 换 ID：varint 形式 + **紧凑 varint 字节**（payload 恰好解出 [oldId] 的那些）
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

  // ② 换父（记录里第一个 varint 形式的 #504）
  let pOk = false;
  (function fixParent(fs2) {
    for (const f of fs2) {
      if (!pOk && f.wt === 0 && f.field === 504 && Number(f.num) === proto.parentId) { f.num = BigInt(contentId); pOk = true; }
      if (f.sub) fixParent(f.sub);
    }
  })(clone.sub);

  // ③ 换名字
  const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === proto.name);
  let nOk = false;
  if (nf) { nf.payload = Buffer.from(spec.name, 'utf8'); nf.len = nf.payload.length; nOk = true; }

  // ④ 几何：四个状态块都改
  let geo = 0;
  for (const block of stateBlocks(clone.sub, [])) {
    if (setPair(pairOf(block, 504), spec.pos[0], spec.pos[1])) geo++;
    setPair(pairOf(block, 505), spec.size[0], spec.size[1]);
  }

  // ⑤ 清空原型自己的子控件列表（否则副本会认领原型的子控件）
  //   ★ 2026-10-07 修：原来用**递归** findChildList(clone.sub, true)。allowEmpty=true 时
  //     连"任何空的 wt2 字段"都算命中（例如空的 #502）⇒ 它清空的是**无关字段**，
  //     原型真正的子列表反而留着 ⇒ 副本认领原型子控件。必须只认顶层。
  const myChild = findChildListTop(clone.sub);
  if (myChild) setChildList(myChild, []);

  console.log('  ' + spec.name.padEnd(6) + '← ' + spec.proto.padEnd(12) + '#' + newId
    + '  父#' + contentId + ' 位置(' + spec.pos + ') 尺寸(' + spec.size + ')'
    + '  ID×' + nId + ' 父' + (pOk ? '✅' : '❌') + ' 名' + (nOk ? '✅' : '❌') + ' 几何' + geo + '/4'
    + '   ' + spec.why);
  if (!pOk || !nOk || geo !== 4) { console.error('  ❌ 补丁不完整，停止'); process.exit(4); }
  built.push({ name: spec.name, id: newId, clone });
}

if (!built.length) { console.log('\n无需改动（两个子控件都已存在）'); process.exit(0); }

// ── 登记进 content 的子控件列表 ──────────────────────────────────────────
//   ★ 2026-10-07：显式用**顶层版**，不再依赖 readGil().recs[].childList
const contentList = findChildListTop(content.field.sub);
if (!contentList) { console.error('content 记录顶层没有子控件列表字段'); process.exit(5); }
{
  const cur = asIdList(contentList.payload, true) || [];
  for (const b of built) if (!cur.includes(b.id)) cur.push(b.id);
  setChildList(contentList, cur);
  console.log('\ncontent 子列表登记后 ' + cur.length + ' 个：' + cur.join(', '));
}

if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

// ── 插入 + 编码 + 写文件 ─────────────────────────────────────────────────
content.holder.splice(content.index + 1, 0, ...built.map((b) => b.clone));
const body = encodeMsg(g.tree);
const outBuf = g.pack(body);
fs.writeFileSync(OUT, outBuf);

// ── 离线自检：把写出的文件重新读一遍 ─────────────────────────────────────
const g2 = readGil(OUT);
console.log('\n输出：' + OUT);
console.log('  体 ' + body.length + '（原 ' + g.hdr[4] + '，+' + (body.length - g.hdr[4]) + '）  文件 ' + outBuf.length + '（+' + (outBuf.length - g.src.length) + '）');
console.log('  头 ' + [0, 4, 8, 12, 16].map((o) => outBuf.readUInt32BE(o)).join(', '));
console.log('  尾 ' + outBuf.subarray(outBuf.length - g.trailer.length).toString('hex')
  + (outBuf.subarray(outBuf.length - g.trailer.length).equals(g.trailer) ? '  ✅' : '  ❌'));
console.log('  重新解析 ✅ 控件记录 ' + g2.recs.length + '（原 ' + g.recs.length + '，应 +' + built.length + '）');

let bad = 0;
for (const b of built) {
  const hit = g2.recs.find((r) => r.name === b.name && r.parentId === contentId);
  if (!hit) { console.log('    ❌ ' + b.name + ' 没找到'); bad++; continue; }
  // ★ 2026-10-07 修（假警报）：原来要求"恰好 2 个浮点分量"，但引擎和本工具都是**稀疏编码** ——
  //   值为 0 的分量根本不写（位置 (0,0) 写出来是一个**空消息**，见 gilread.pairValue 的注释）。
  //   于是位置含 0 的子控件（obj (0,0)、text (0,-52)）永远被判 ❌ ⇒ 退出码 6"先别导入"，
  //   而写出的文件其实完全正确（与用户成功导入的那份**逐字节相同**）。
  //   ⇒ 改用 pairValue：分量缺失 = 0。
  const posOk = hit.states.length === 4 && hit.states.every((s) => {
    const sp = SPECS.find((x) => x.name === b.name);
    const p = pairOf(s, 504);
    return Math.abs(pairValue(p, 0) - sp.pos[0]) < 0.6 && Math.abs(pairValue(p, 1) - sp.pos[1]) < 0.6;
  });
  const szOk = hit.states.length === 4 && hit.states.every((s) => {
    const sp = SPECS.find((x) => x.name === b.name);
    const q = pairOf(s, 505);
    return Math.abs(pairValue(q, 0) - sp.size[0]) < 0.6 && Math.abs(pairValue(q, 1) - sp.size[1]) < 0.6;
  });
  if (!posOk || !szOk) bad++;
  console.log('    ' + (posOk && szOk ? '✅' : '❌') + ' ' + b.name + '  #' + hit.id + '  状态块 ' + hit.states.length
    + '  位置' + (posOk ? '✅' : '❌') + ' 尺寸' + (szOk ? '✅' : '❌'));
}
const contentAfter = g2.recs.find((r) => r.id === contentId);
// ★ 2026-10-07：同样显式走顶层版
const listAfter = asIdList(findChildListTop(contentAfter?.field.sub || [])?.payload || Buffer.alloc(0), true) || [];
const listOk = built.every((b) => listAfter.includes(b.id));
console.log('    ' + (listOk ? '✅' : '❌') + ' content 子控件列表含新 ID（共 ' + listAfter.length + ' 个）');
console.log('\n' + (bad === 0 && listOk ? '★ 模板子控件补齐成功' : '❌ 自检不通过，先别导入'));
process.exit(bad === 0 && listOk ? 0 : 6);
