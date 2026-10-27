// tools/gil/clone_control.mjs —— 在**同一个父**下克隆一个控件、换个名字、给个新尺寸
//
// 为什么要有它（用户 2026-10-13 指令 ✓）：
//   ★ `modal` 是**五个状态共用**的容器 ✓（`result` / `exit_menu` / `howto` / `levelselect` / `share`）
//   ⇒ 直接把它那个 `bg` 拉大 ✗ ⇒ **别的弹窗的底板也跟着变大** ✓
//   ⇒ 用户原话：「**换一个名字，脚本里的引用也一起换成新名字**」✓
//     即：**给通关弹窗单独做一个底板** ✓ 不动共用的那个 ✓
//
// ★ 关键：克隆体要插进父的**子列表最前面**（= 画在最底层 ✓）
//   —— 底板必须垫在按钮/文字下面 ✗（`gen_result_keys.mjs` 是追加到末尾，那是按钮 ✓ 两者相反 ✓）
//
// ★ 图 id / 颜色 / 名字之外的一切字段都随克隆体一起复制 ✓（所以"素材引用和调色"自动一致 ✓）
//
// 用法：
//   node tools/gil/clone_control.mjs --in=<存档> --out=<输出> --src="父/源名" --name=<新名> [--size=宽x高] [--front]
//   --front  插到子列表**最前**（底板用 ✓）；不加则追加到末尾（按钮用 ✓）
//
// ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>`（自带从磁盘重读断言 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  bigIds, textsOf, stateBlocks, pairOf, pairValue, setPair,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out'), SRC = argOf('src'), NAME = argOf('name'), SIZE = argOf('size');
const FRONT = argv.includes('--front');
// ★ 2026-10-16 新增 ✓：`--parent=<名字>` ⇒ ★ 把克隆体挂到**另一个父控件**下 ✓
//   ★ 为什么需要 ✗：★ 本工具原来只会"插到原型所在的那个父级" ✗ ——
//     ★ 而 `win`（容器）与 `win.1..4`（文本）**必须挂在不同父级下** ✓
//     （★ `win` 在 `modal` 下 ✓；★ `win.N` 在 `win` 下 ✓）
const TPARENT = argOf('parent');
if (!IN || !OUT || !SRC || !NAME) {
  console.error('用法: node tools/gil/clone_control.mjs --in=<存档> --out=<输出> --src="父/源名" --name=<新名> [--parent=<目标父名>] [--size=宽x高] [--front]');
  process.exit(1);
}

const g = readGil(IN);
console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length + '　maxId=' + g.maxId);

if (g.recs.some((r) => r.name === NAME)) { console.error('✗ 已存在同名控件 ' + NAME + '（本工具不做覆盖 ✓）'); process.exit(2); }

const [pn, cn] = SRC.split('/');
const parent = g.recs.find((r) => r.name === pn);
if (!parent) { console.error('✗ 找不到父控件 ' + pn); process.exit(2); }
const pcl = findChildListTop(parent.field.sub);
const pids = pcl ? (asIdList(pcl.payload, true) || []) : [];
const proto = pids.map((id) => g.recs.find((r) => r.id === id)).find((c) => c && c.name === cn);
if (!proto) { console.error('✗ ' + pn + ' 的子控件里没有 ' + cn); process.exit(2); }
console.log('父 ' + pn + ' #' + parent.id + '　原型 ' + cn + ' #' + proto.id
  + '　子控件 ' + pids.length + ' 个　插入位置 = ' + (FRONT ? '最前（画在最底层 ✓）' : '末尾'));

// 找"某条记录所在的字段数组"（克隆体要插进同一个数组 ✓）
function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if ((bigIds(f.sub, [])[0] || {}).num === BigInt(id)) return { arr, index: i };
        stack.push(f.sub);
      }
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

const h = holderOf(proto.id);
if (!h) { console.error('✗ 找不到原型所在的字段数组'); process.exit(2); }

const cf = cloneField(proto.field);
const idLeaf = bigIds(cf.sub, [])[0];
if (!idLeaf) { console.error('✗ 克隆体里没有 #501'); process.exit(2); }
const newId = BigInt(g.maxId) + 1n;
idLeaf.num = newId;
if (!renameIn(cf.sub, proto.name, NAME)) { console.error('✗ 改不了名字（原型名=' + proto.name + '）'); process.exit(2); }

// 尺寸（每个状态块都要写 ✓）
if (SIZE) {
  const m = /^(\d+)x(\d+)$/.exec(SIZE);
  if (!m) { console.error('✗ --size 要写成 宽x高'); process.exit(1); }
  const bl = []; stateBlocks(cf.sub, bl);
  let n = 0;
  for (const b of bl) { const s = pairOf(b, 505); if (s) { setPair(s, Number(m[1]), Number(m[2])); n++; } }
  console.log('  写尺寸 ' + SIZE + ' 到 ' + n + ' 个状态块');
}

// 插树：紧跟原型（同一字段数组 ✓）
h.arr.splice(h.index + 1, 0, cf);

// 登记进父的子列表
// ★ 2026-10-16：★ `--parent=` 指定时，登记到**那个**父控件 ✓（否则照旧用原型所在的父级 ✓）
const destParent = TPARENT ? g.recs.find((r) => r.name === TPARENT) : parent;
if (TPARENT && !destParent) { console.error('✗ 找不到目标父控件 ' + TPARENT); process.exit(2); }
const destCl = destParent === parent ? pcl : findChildListTop(destParent.field.sub);
const destIds = destParent === parent ? pids : (destCl ? (asIdList(destCl.payload, true) || []) : []);
const destName = destParent === parent ? pn : TPARENT;
// ★★★★★★★★ 2026-10-16 **目标父级没有 `#503` 子列表时，【新建一个】** ✗✓✓
//   ★ 踩到的坑 ✓：★ `win`（克隆来的容器）**没有子列表** ✗ ⇒ 上一版只打印一句
//     「只插树、不登记」✓ ⇒ ★ 结果 `win` 的 `_probe_kids` 是 **0 个子控件** ✗
//     （★ 记录自己的父指针是对的 ✓ 但**父的子列表里没有它们** ✗ ⇒ 编辑器/引擎看不到它们 ✓）
//   ⇒ ★ 现在：★ 没有就**新建**一个 `#503` ✓（★ payload = 那串 id 的 varint 拼 ✓ 见 `setChildList` ✓）
let destClEff = destCl;
if (!destClEff) {
  destClEff = { field: 503, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, s1: 0 };
  destParent.field.sub.push(destClEff);
  console.log('  ★ ' + destName + ' 原来**没有** #503 子列表 ⇒ 已新建 ✓');
}
// ★★★★★★★★ 2026-10-16 **`--parent=` 还必须改记录自己的【顶层 `#504`（父指针）】** ✗✓✓
//   ★ 踩到的坑 ✓：★ 只改"父的子列表"不够 ✗ —— ★ 记录里**另有一个顶层 `#504` 就是父 id** ✓
//     （★ `gilread.mjs` 的 `parentId` 读的正是它 ✓ 见那里 2026-10-10「同号字段陷阱第 3 例」✓）
//   ⇒ ★ 不改它 ⇒ ★ **子列表说新父、记录自己说旧父** ✗ —— ★ 复读核对当场 ❌（本轮实测 ✓）
if (TPARENT) {
  const p504 = cf.sub.find((f) => f.field === 504 && f.wt === 0);
  if (p504) { p504.num = BigInt(destParent.id); console.log('  改顶层父指针 #504 → ' + destParent.id + '（' + TPARENT + ' ✓）'); }
  else console.log('  ⚠️ 克隆体顶层没有 #504 父指针 —— 只登记子列表');
}
const newPids = destIds.slice();
if (FRONT) newPids.unshift(Number(newId)); else newPids.push(Number(newId));
setChildList(destClEff, newPids);
console.log('  已登记进 ' + destName + ' 的子列表：' + destIds.length + ' → ' + newPids.length
  + (FRONT ? '（新控件是第 1 个 ✓）' : '（新控件是最后 1 个）'));

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log('\n已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 从磁盘重读断言 ──
const g2 = readGil(OUT);
const rec2 = g2.recs.find((r) => r.id === Number(newId));
const p2 = g2.recs.find((r) => r.id === destParent.id);
const p2cl = p2 ? findChildListTop(p2.field.sub) : null;
const p2ids = p2cl ? (asIdList(p2cl.payload, true) || []) : [];
const bl2 = rec2 ? (() => { const b = []; stateBlocks(rec2.field.sub, b); return b; })() : [];
const sz2 = bl2[0] ? pairOf(bl2[0], 505) : null;
console.log('\n── 复读核对（从磁盘重读）──');
const okRec = !!rec2 && rec2.parentId === destParent.id;
const okPos = p2ids.indexOf(Number(newId)) === (FRONT ? 0 : p2ids.length - 1);
console.log('  ' + (okRec ? '✅' : '❌') + ' ' + NAME + ' #' + newId + '  父=' + (rec2 ? rec2.parentId : '?')
  + (okRec ? '（' + destName + ' ✓）' : ' ✗'));
console.log('  ' + (okPos ? '✅' : '❌') + ' 在 ' + pn + ' 子列表里的位置 = 第 ' + (p2ids.indexOf(Number(newId)) + 1) + ' 个'
  + '（共 ' + p2ids.length + '）');
if (SIZE) console.log('  ' + (sz2 ? '✅' : '❌') + ' 尺寸 = ' + (sz2 ? (pairValue(sz2, 0) + '×' + pairValue(sz2, 1)) : '?'));
console.log('\n' + (okRec && okPos ? '★ 克隆成功 ✓' : '❌ 有问题'));
process.exit(okRec && okPos ? 0 : 3);
