// tools/gil/gen_portrait_layer.mjs —— 给**格子模板**补一层 `portrait`（放置头像专用）
//
// 为什么需要（2026-10-20 用户原话）：「**现在家具图层会盖在放置的头像上，把这个问题解决**」
//   格子 content 现有 13 层：face / hint / obj / x / wall.* / note / door.*
//   脚本按 `cfg.cells.layer_order` 从下到上重排：face → hint → **obj（家具）** → wall → door → x → note
//   而"放置的头像"走的是 `image` 键 ⇒ 落在 **face**（最底层，注释里原本就这么设计的）
//   ⇒ 家具（obj）在 face 之上 ⇒ **头像被家具盖住** ✗
//   调换顺序（obj 挪到 face 之下）不行：`face` 是不透明的房间色板，会把家具整个盖掉 ✗
//   ⇒ 只能在 obj 之上、wall 之下**加一层** `portrait`，头像改画到那一层 ✓
//
// 做法：克隆模板里的 `face`（同一组：135×135、imageId=100001、imageColor=白、imageType=拉伸）
//   ⇒ 新记录名 `portrait`，挂到同一个 `content` 下，并登记进 content 的子控件列表。
//   两份 `cell.1.1`（顶层无父 / 原型层级根下）**都补** —— 仓里历来的规矩：改模板两份都要核对。
//
// 用法：
//   node tools/gil/gen_portrait_layer.mjs --probe
//   node tools/gil/gen_portrait_layer.mjs --in=<存档> --out=<输出>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, stateBlocks, pairOf, pairValue,
  textsOf, findChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--probe');
const IN = argOf('in'), OUT = argOf('out');
if (!DRY && (!IN || !OUT)) {
  console.error('用法: node tools/gil/gen_portrait_layer.mjs --in=<存档> --out=<输出>   （或 --probe）');
  process.exit(2);
}
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const g = readGil(P(IN || path.join(ROOT, '470-遗留清理-v282.gil')));
console.log('基准：' + path.basename(P(IN || '470')) + '（' + g.src.length + ' 字节）控件记录 ' + g.recs.length + ' 条');

// ── 找到所有"格子模板"的 content（其父记录名 cell.1.1）────────────────────
const cellRoots = g.recs.filter((r) => r.name === 'cell.1.1');
console.log('cell.1.1 记录 ' + cellRoots.length + ' 个：' + cellRoots.map((r) => '#' + r.id).join(', '));
const targets = [];
for (const root of cellRoots) {
  const content = g.recs.find((r) => r.parentId === root.id && r.name === 'content');
  if (!content) { console.log('  #' + root.id + ' 下没有 content → 跳过'); continue; }
  const kids = g.recs.filter((r) => r.parentId === content.id);
  const face = kids.find((k) => k.name === 'face');
  const obj = kids.find((k) => k.name === 'obj');
  const has = kids.some((k) => k.name === 'portrait');
  console.log('  模板 #' + root.id + ' → content #' + content.id + '  子控件 ' + kids.length
    + ' 个：' + kids.map((k) => k.name).sort().join(', '));
  targets.push({ root, content, face, obj, has, kids });
}

// ── 逐个补 `portrait`（幂等）────────────────────────────────────────────
// ★ 新记录的 id 从 **1073743800 起**（不是 maxId+1）：
//   仓里 2026-10-18 那次「界面控件里的开关控件GUID重复:1073742787」就是用了 1073742787 这一带，
//   而用户自己的工程里也有同号控件 ⇒ 之后新加的控件一律放在 1073743800 以上，避开那一段。
let nextId = Math.max(g.maxId + 1, 1073743800);
const built = [];
for (const t of targets) {
  if (t.has) { console.log('  content #' + t.content.id + ' 已有 portrait → 跳过'); continue; }
  if (!t.face) { console.error('  ✗ content #' + t.content.id + ' 没有 face 可克隆'); process.exit(3); }
  const proto = t.face;
  if (proto.states.length !== 4) { console.error('  ✗ 原型 face 状态块 ' + proto.states.length + ' ≠ 4'); process.exit(3); }

  const clone = cloneField(proto.field);
  const oldId = proto.id, newId = nextId++;

  // ① 换 ID：varint 形式 + 紧凑 varint 字节（与 gen_template_subs 同一套写法）
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

  // ② 换名字（原型名 face → portrait）
  const nf = textsOf(clone.sub, []).find((x) => x.payload.toString('utf8') === proto.name);
  let nOk = false;
  if (nf) { nf.payload = Buffer.from('portrait', 'utf8'); nf.len = nf.payload.length; nOk = true; }

  // ③ 清子控件列表（face 本来没有子控件，保险起见）
  const myChild = findChildListTop(clone.sub);
  if (myChild) setChildList(myChild, []);

  // ④ 几何：跟 face 一致（0,0 / 135×135）；只做核对，不改
  const geo = stateBlocks(clone.sub, []).map((b) => {
    const p = pairOf(b, 504), s = pairOf(b, 505);
    return pairValue(p, 0) + ',' + pairValue(p, 1) + ' / ' + pairValue(s, 0) + '×' + pairValue(s, 1);
  });

  console.log('  ' + ('portrait').padEnd(9) + '← ' + proto.name.padEnd(5) + '#' + newId
    + '  父#' + t.content.id + '  ID×' + nId + ' 名' + (nOk ? '✅' : '❌')
    + '  几何 ' + (geo[0] || '?'));
  if (!nOk || nId === 0) { console.error('  ✗ 补丁不完整，停止'); process.exit(4); }
  built.push({ contentId: t.content.id, content: t.content, clone, newId, name: 'portrait' });
}

if (!built.length) { console.log('\n无需改动（所有模板都已有 portrait）'); process.exit(0); }

// ── 登记进各自 content 的子控件列表 ──────────────────────────────────────
for (const b of built) {
  const cl = findChildListTop(b.content.field.sub);
  if (!cl) { console.error('✗ content #' + b.contentId + ' 顶层没有子控件列表'); process.exit(5); }
  const cur = asIdList(cl.payload, true) || [];
  if (!cur.includes(b.newId)) cur.push(b.newId);
  setChildList(cl, cur);
  console.log('  content #' + b.contentId + ' 子列表 → ' + cur.length + ' 个');
}

if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

// ── 插到 content 的子控件记录后面（顺序不权威：脚本按 layer_order 重排）──
for (const b of built) b.content.holder.splice(b.content.index + 1, 0, b.clone);
const body = encodeMsg(g.tree);
const outBuf = g.pack(body);
fs.writeFileSync(P(OUT), outBuf);
console.log('\n输出：' + P(OUT));
console.log('  体 ' + body.length + '（原 ' + g.hdr[4] + '，+' + (body.length - g.hdr[4]) + '）  文件 ' + outBuf.length);

// ── 从磁盘复读核对 ───────────────────────────────────────────────────────
const g2 = readGil(P(OUT));
console.log('  重新解析 ✅ 控件记录 ' + g2.recs.length + '（原 ' + g.recs.length + '，应 +' + built.length + '）');
let bad = 0;
for (const b of built) {
  const hit = g2.recs.find((r) => r.name === 'portrait' && r.parentId === b.contentId);
  const list = asIdList(findChildListTop(g2.recs.find((r) => r.id === b.contentId)?.field.sub || [])?.payload || Buffer.alloc(0), true) || [];
  const okName = !!hit, okList = hit && list.includes(hit.id);
  if (!okName || !okList) bad++;
  console.log('    ' + (okName && okList ? '✅' : '❌') + ' content#' + b.contentId
    + '  portrait ' + (hit ? '#' + hit.id : '缺失') + '  登记进子列表 ' + (okList ? '✅' : '❌'));
}
console.log('\n' + (bad === 0 ? '★ portrait 层已补好' : '❌ 自检不通过，先别导入'));
process.exit(bad === 0 ? 0 : 6);
