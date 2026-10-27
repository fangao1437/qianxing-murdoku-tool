// tools/gil/fix_cell_layers.mjs —— 让格子里的图层"贴住格子"，并让门墙变成设计图的样子
//
//   用户真机回报：
//     · 「家具和提示不要溢出格子」
//     · 「门墙的渲染也没有与设计图一致」
//
//   根因（两条都在存档/素材层）：
//     ① `face` / `hint` / `obj` 的 **imageType 没写 = Basic** ⇒ 图片**按自己原尺寸画**，盒子多大都没用 ✓
//     ② 门墙颜色是占位色（紫 `0xFF3310A0` / 黄绿 `0xFFD6DE1A`），设计图是**近黑墙 + 橙门** ✓
//   尺寸"跟着格子走"由脚本 `_fit_child_to_cell` 在运行时钉住（见适配层）✓
//
//   ★★★ **模板在存档里有两份** ✗✓（顶层无父的那份 = 运行时实例化源；原型层级根下的那份 = 编辑器看到的）
//     ⇒ 本工具**两份一起改**；哪份缺 `obj` 就在哪份补一个（克隆同份的 `face`）✓
//     否则：用户在编辑器里再导出一次，改动会被那份没改的覆盖回去 ✓
//
//   用法：
//     node tools/gil/fix_cell_layers.mjs --in=397-…v255.gil --out=398-…gil [--dry]
//   验收：`writeGil()` 自带「重读磁盘 + 往返一致 + 记录数」；断言逐项读回
//         imageType / imageColor / imageId（磁盘上读出来就是它，不是我"以为写了"）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, cloneField, findChildListTop, setChildList, asIdList,
  textsOf, stateBlocks, pairOf, setPair,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const IN = argOf('in'), OUT = argOf('out');
const DRY = argv.includes('--dry');
if (!IN || !OUT) {
  console.error('用法: node tools/gil/fix_cell_layers.mjs --in=<存档.gil> --out=<输出.gil> [--dry]');
  process.exit(1);
}

const WALL_COLOR = 0xFF2B2B33;   // 近黑（设计图里的墙）
const DOOR_COLOR = 0xFFE2622F;   // 橙（设计图里的门）
const CELL = 135;
// ★ 2026-10-18：墙/门统一换成**可拉伸**的底板素材（106053）—— 100108/100001 这类基础形状不吃 Stretch
// ★★ 2026-10-18 三修（v262，用户指令）：「**门墙素材换成 107092**」
//   107092 在素材库里是 **512×256 的浅米色板**（`plate_survey.json`：coverage 0.988、
//   r244/g237/b218、近乎纯色）⇒ 正是"能吃 Stretch 的底板"，而且自带米色纹理。
//   `imageColor` 仍按下面的近黑/橙乘算 ⇒ 墙仍近黑、门仍橙，只是底纹换了。
const WALL_MAT = Number((process.argv.slice(2).find((s) => s.startsWith('--wall-mat=')) || '').slice(11)) || 106053;
const STRETCH_BOX = ['face', 'hint', 'obj'];
const SIDES = ['up', 'down', 'left', 'right'];

const g = readGil(P(IN));
let nextId = BigInt(g.maxId) + 1n;
const hex = (v) => (v == null ? '—' : '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'));

const contents = g.recs.filter((r) => r.name === 'content');
if (contents.length === 0) { console.error('✗ 找不到 content'); process.exit(2); }
console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length
  + '　content 子树 ' + contents.length + ' 份：' + contents.map((c) => '#' + c.id).join(' / '));

function holderOfRecord(id) {
  const want = BigInt(id);
  const stack = [{ arr: g.tree }];
  while (stack.length) {
    const { arr } = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (!f.sub) continue;
      const own501 = f.sub.find((x) => x.field === 501 && x.wt === 0);
      const has505 = f.sub.some((x) => x.field === 505 && x.sub);
      if (own501 && has505 && own501.num === want) return { arr, index: i };
      stack.push({ arr: f.sub });
    }
  }
  return null;
}
function renameIn(fields, oldName, newName) {
  const t = textsOf(fields, []).find((x) => x.payload && x.payload.toString('utf8') === oldName);
  if (!t) return false;
  t.payload = Buffer.from(newName, 'utf8');
  t.len = t.payload.length;
  return true;
}
function imageBlock(rec) {
  let hit = null;
  (function walk(fs_) {
    for (const f of fs_ || []) {
      if (f.field === 84 && f.sub) { hit = f; return; }
      if (f.sub && !hit) walk(f.sub);
    }
  })(rec.field.sub);
  return hit;
}
const numOf = (blk, no) => {
  const f = blk && blk.sub.find((x) => x.field === no && x.wt === 0);
  return f ? Number(f.num) : null;
};
function setNum(blk, no, v) {
  let f = blk.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) { f = { field: no, wt: 0, num: 0n }; blk.sub.push(f); }
  f.num = BigInt(v >>> 0);
}

// ── ① 每份 content 都补齐 `obj`（有的那份跳过）──────────────────────────────
const added = [];
for (const content of contents) {
  const kids = g.recs.filter((r) => Number(r.parentId) === Number(content.id));
  if (kids.some((k) => k.name === 'obj')) continue;
  const face = kids.find((k) => k.name === 'face');
  const hint = kids.find((k) => k.name === 'hint');
  if (!face || !hint) { console.error('✗ content #' + content.id + ' 缺 face/hint，无法补 obj'); process.exit(3); }
  const cf = cloneField(face.field);
  const id = nextId++;
  const own501 = cf.sub.find((x) => x.field === 501 && x.wt === 0);
  own501.num = id;
  if (!renameIn(cf.sub, 'face', 'obj')) { console.error('✗ 改名失败'); process.exit(3); }
  const bl = [];
  stateBlocks(cf.sub, bl);
  for (const b of bl) { const sz = pairOf(b, 505); if (sz) setPair(sz, CELL, CELL); }
  const h = holderOfRecord(face.id);
  h.arr.splice(h.index + 1, 0, cf);
  // 登记进 content 的子列表：紧跟在 hint 后面
  const cl = findChildListTop(content.field.sub);
  if (!cl) { console.error('✗ content #' + content.id + ' 没有子列表'); process.exit(3); }
  const ids = (asIdList(cl.payload, true) || []).map(Number);
  const at = ids.indexOf(Number(hint.id)) + 1;
  ids.splice(at, 0, Number(id));
  setChildList(cl, ids);
  added.push({ content: content.id, name: 'obj', id, at, field: cf });
  console.log('  + content #' + content.id + ' 补了 obj #' + id + '（第 ' + at + ' 位，紧跟 hint）');
}

// ── ② 三份 content 统一：imageType / 门墙配色 ───────────────────────────────
const plan = [];
const done = [];
for (const content of contents) {
  const kids = g.recs.filter((r) => Number(r.parentId) === Number(content.id));
  const byName = new Map(kids.map((k) => [k.name, k]));
  // ★ 刚补的 `obj` 还不在 `g.recs` 里（那是读档时的快照）⇒ 这里手工并入 ✓
  for (const a of added) {
    if (Number(a.content) === Number(content.id)) {
      byName.set(a.name, { id: a.id, name: a.name, field: a.field });
    }
  }
  for (const nm of STRETCH_BOX) {
    const rec = byName.get(nm);
    if (!rec) { console.error('✗ content #' + content.id + ' 仍缺 ' + nm); process.exit(3); }
    const blk = imageBlock(rec);
    if (!blk) { console.error('✗ ' + nm + ' 没有图片块'); process.exit(3); }
    const before = numOf(blk, 504);
    setNum(blk, 504, 1);
    done.push({ content: content.id, nm, kind: 'imageType', before, after: 1, imageId: numOf(blk, 503) });
  }
  for (const s of SIDES) {
    for (const [prefix, color] of [['wall', WALL_COLOR], ['door', DOOR_COLOR]]) {
      const nm = prefix + '.' + s;
      const rec = byName.get(nm);
      if (!rec) { console.error('✗ content #' + content.id + ' 缺 ' + nm); process.exit(3); }
      const blk = imageBlock(rec);
      if (!blk) { console.error('✗ ' + nm + ' 没有图片块'); process.exit(3); }
      const before = numOf(blk, 502);
      setNum(blk, 502, color);
      // ★ 2026-10-18：墙/门也必须是 **Stretch** ✗✓
      //   真机回报「横向的墙渲染出来不完整」= 图片按**原始像素**画 ⇒ 长度跟盒子对不上 ✓
      //   脚本缩的是**盒子**（localScale）⇒ 图必须填满盒子才看得到"整条" ✓
      setNum(blk, 504, 1);
      // ★★★ 2026-10-18 二修：**换成能拉伸的底板素材**（106053）✗✓✓
      //   真机反馈「改成 Stretch 后横墙还是缺一截」⇒ 判断 `100108`（横板）这类**基础形状不吃拉伸** ✓
      //   而 `106053`（白底板）已在选关卡片 310×432 上验证过"任意尺寸都铺满" ✓
      //   ★ 颜色仍由 `imageColor` 乘上去 ⇒ 近黑墙 / 橙门不变 ✓
      const idBefore = numOf(blk, 503);
      setNum(blk, 503, WALL_MAT);
      done.push({ content: content.id, nm, kind: '材质+配色+拉伸', before, after: color, imageId: idBefore + '→' + WALL_MAT });
    }
  }
  plan.push({ content: content.id });
}

console.log('\n改动（每份 content 都做）：');
for (const d of done) {
  if (d.nm !== 'face' && d.nm !== 'hint' && d.nm !== 'obj' && d.nm !== 'wall.up' && d.nm !== 'door.up') continue;
  console.log('  #' + d.content + ' ' + d.nm.padEnd(10) + d.kind.padEnd(11) + hex(d.before) + ' → ' + hex(d.after));
}
console.log('  …（wall/door 四个方向都改了，共 ' + done.length + ' 项）');

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

const expectRecs = g.recs.length + added.length;
writeGil(g, P(OUT), {
  label: 'fix_cell_layers',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const cs = g2.recs.filter((r) => r.name === 'content');
    if (cs.length !== contents.length) bad.push('content 份数变了：' + cs.length);
    for (const c of cs) {
      const kids = g2.recs.filter((r) => Number(r.parentId) === Number(c.id));
      const m = new Map(kids.map((k) => [k.name, k]));
      for (const nm of STRETCH_BOX) {
        const rec = m.get(nm);
        if (!rec) { bad.push('content #' + c.id + ' 缺 ' + nm); continue; }
        const blk = imageBlock(rec);
        const it = numOf(blk, 504);
        if (it !== 1) bad.push('content #' + c.id + ' ' + nm + ' imageType=' + it);
      }
      for (const s of SIDES) {
        for (const [prefix, color] of [['wall', WALL_COLOR], ['door', DOOR_COLOR]]) {
          const rec = m.get(prefix + '.' + s);
          if (!rec) { bad.push('content #' + c.id + ' 缺 ' + prefix + '.' + s); continue; }
          const blk = imageBlock(rec);
          const col = numOf(blk, 502);
          if ((col >>> 0) !== (color >>> 0)) {
            bad.push('content #' + c.id + ' ' + prefix + '.' + s + ' imageColor=' + hex(col));
          }
          if (numOf(blk, 503) !== WALL_MAT) bad.push('content #' + c.id + ' ' + prefix + '.' + s + ' imageId=' + numOf(blk, 503) + '（应为 ' + WALL_MAT + '）');
          const it2 = numOf(blk, 504);
          if (it2 !== 1) bad.push('content #' + c.id + ' ' + prefix + '.' + s + ' imageType=' + it2 + '（应为 1）');
        }
      }
      // 子列表自洽（新补的 obj 必须登记在父列表里）
      const cl = findChildListTop(c.field.sub);
      const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
      for (const nm of STRETCH_BOX) {
        const rec = m.get(nm);
        if (rec && !ids.includes(Number(rec.id))) bad.push('content #' + c.id + ' 的子列表没登记 ' + nm);
      }
    }
    if (bad.length) throw new Error('✗ 结构断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 重读断言：' + cs.length + ' 份 content 的 face/hint/obj + wall/door 全部符合预期 ✓');
  },
});
console.log('\n已写出：' + OUT + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
