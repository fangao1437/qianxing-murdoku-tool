// tools/gil/gen_result_keys.mjs —— 把**胜利界面四键** `result.*` 建进存档
//
// 为什么要有它（而不是复用 sync_plan ✓）：
//   `sync_plan.mjs` 补的是**整个计划并集** ✗ —— 实测 `345` 记录 281 → 新增 **123** ✓
//   那会把当前设计**刻意删掉**的 UI（`select.card.*` / `tray` / `clues.*`）全补回来 ⇒
//   就是项目反复踩过的「**一堆白块盖住界面**」✗
//   而且 sync_plan 克隆按钮时**会清空原型的子列表** ✓ ⇒ 新按钮没有 `bg`/`label`
//   ⇒ **建出来是看不见的** ✗
//
// 本工具只做一件事 ✓：从**当前存档里已存在的**按钮克隆（含它的 `bg`/`label` 子控件 ✓），
//   造出 `result.next / result.exit / result.home / result.settle` 四个键 ✓
//
// 原型：`modal.cancel`（`modal` 下的预设按钮，自带 `text` / `bg` / `label` 三子控件 ✓）
// 父级：`modal`（不是 root ✓ —— 这四键是**弹窗里的**按钮 ✓）
//
// 几何（★ 全部来自 `tools/sim/out/layout-plan.json`，**画布空间** 1600×900、原点左下 ✓）：
//   `.gil` 存的是**相对屏幕中心 (800,450) 的偏移** ✓（与 `gen_icons.mjs` 同一套 ✓）
//   因为 `modal` 自己的中心正好是 (800,450) ⇒ 对它的子控件同式成立 ✓
//
// 用法：
//   node tools/gil/gen_result_keys.mjs --in=<存档> --out=<输出> [--probe]
//   （`--probe` = 只看，不写文件）
//
// ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>` ＋ 本工具已自带"从磁盘重读"断言 ✓

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
const DRY = argv.includes('--probe');
const IN = argOf('in'), OUT = argOf('out');
const PLAN = argOf('plan') || path.join(ROOT, 'tools/sim/out/layout-plan.json');
if (!IN) { console.error('用法: node tools/gil/gen_result_keys.mjs --in=<存档> --out=<输出> [--probe]'); process.exit(1); }

const KEYS = ['result.next', 'result.exit', 'result.home', 'result.settle'];

const g = readGil(IN);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const planOf = new Map(plan.nodes.map((n) => [n.id, n]));
console.log('存档：' + path.basename(IN) + '（记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');

const modal = g.recs.find((r) => r.name === 'modal');
const proto = g.recs.find((r) => r.name === 'modal.cancel');
if (!modal) { console.error('✗ 找不到 modal 容器'); process.exit(2); }
if (!proto) { console.error('✗ 找不到原型 modal.cancel'); process.exit(2); }
console.log('父级 modal #' + modal.id + '　原型 modal.cancel #' + proto.id);

// ── 原型的子控件（要**一起克隆** —— 这就是 sync_plan 做不到的地方 ✓）──
const protoCl = findChildListTop(proto.field.sub);
const protoChildIds = protoCl ? (asIdList(protoCl.payload, true) || []) : [];
const protoKids = protoChildIds.map((id) => g.recs.find((r) => r.id === id)).filter(Boolean);
console.log('原型子控件：' + (protoKids.map((k) => k.name).join(' / ') || '（无）')
  + '　⇒ 会连带一起克隆 ' + protoKids.length + ' 个');

// ── 找"某条记录所在的那个字段数组"（克隆体要插进同一个数组 ✓）──
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
const setParent = (fields, pid) => {
  const pf = fields.find((x) => x.field === 504 && x.wt === 0);
  if (!pf) return false;
  pf.num = BigInt(pid);
  return true;
};

const modalHolder = holderOf(modal.id);
if (!modalHolder) { console.error('✗ 找不到 modal 所在的字段数组'); process.exit(2); }

let nextId = BigInt(g.maxId) + 1n;
const made = [];

for (const name of KEYS) {
  const already = g.recs.find((r) => r.name === name);
  if (already) { console.log('  · ' + name + ' 已存在（#' + already.id + '）⇒ 跳过'); continue; }
  const pn = planOf.get(name);
  if (!pn) { console.error('  ✗ 计划里没有 ' + name); process.exit(2); }

  // ① 按钮本体
  const cf = cloneField(proto.field);
  const idLeaf = bigIds(cf.sub, [])[0];
  if (!idLeaf) { console.error('  ✗ 克隆体里没有 #501'); process.exit(2); }
  const btnId = nextId++;
  idLeaf.num = btnId;
  if (!renameIn(cf.sub, proto.name, name)) { console.error('  ✗ 改不了名字'); process.exit(2); }
  if (!setParent(cf.sub, modal.id)) { console.error('  ✗ 写不了 #504 父引用'); process.exit(2); }

  // ② 几何：每个状态块都要写（只写第一块 ⇒ 其它状态还是旧值 ✗）
  const ox = pn.cx - 800, oy = pn.cy - 450;
  const blocks = []; stateBlocks(cf.sub, blocks);
  if (!blocks.length) { console.error('  ✗ 克隆体里没有状态块'); process.exit(2); }
  for (const b of blocks) {
    if (pairOf(b, 504)) setPair(pairOf(b, 504), ox, oy);
    if (pairOf(b, 505)) setPair(pairOf(b, 505), pn.w, pn.h);
  }

  // ③ 子控件：**逐个克隆 + 重新编号 + 把父指到新按钮** ✓
  const newKidIds = [];
  const kidFields = [];
  for (const k of protoKids) {
    const kh = holderOf(k.id);
    if (!kh) { console.error('  ✗ 找不到子控件 ' + k.name + ' 所在的字段数组'); process.exit(2); }
    const kcf = cloneField(k.field);
    const kidLeaf = bigIds(kcf.sub, [])[0];
    if (!kidLeaf) { console.error('  ✗ 子控件 ' + k.name + ' 没有 #501'); process.exit(2); }
    const kidId = nextId++;
    kidLeaf.num = kidId;
    if (!setParent(kcf.sub, Number(btnId))) { console.error('  ✗ 子控件 ' + k.name + ' 写不了父引用'); process.exit(2); }
    newKidIds.push(Number(kidId));
    kidFields.push({ field: kcf, at: kh });
  }
  // ④ 把新按钮的 `#503` 子列表换成**新的**子控件 id（否则副本会认领原型的子控件 ✗）
  const cl = findChildListTop(cf.sub);
  if (cl && newKidIds.length) setChildList(cl, newKidIds);

  // ⑤ 插树（子控件插在原型子控件旁边；按钮插在 modal 子控件末尾）
  for (const kf of kidFields) kf.at.arr.splice(kf.at.index + 1, 0, kf.field);
  made.push({ name, id: Number(btnId), field: cf, kids: newKidIds.length, ox, oy, w: pn.w, h: pn.h });
  console.log('  + ' + name.padEnd(14) + ' id=' + btnId + '  偏移=(' + ox + ',' + oy + ')'
    + '  尺寸=' + pn.w + '×' + pn.h + '  子控件=' + newKidIds.length);
}

// ── 登记进 modal 的 `#503` 子列表 ＋ 插进树 ──
const mcl = findChildListTop(modal.field.sub);
if (mcl) {
  const ids = asIdList(mcl.payload, true) || [];
  for (const m of made) ids.push(m.id);
  setChildList(mcl, ids);
  console.log('\n已登记进 modal 的 `#503` 子列表：+' + made.length + ' ⇒ 共 ' + ids.length + ' 个');
} else {
  console.log('\n⚠️ modal 没有 `#503` 子列表 —— 只插树、不登记');
}
for (const m of made) modalHolder.arr.splice(modalHolder.index + 1, 0, m.field);

if (DRY) { console.log('\n（--probe 模式，未写文件）'); process.exit(0); }

const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('\n已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 复读核对（**必须从磁盘重读** ✓ —— 读内存或刚写出的 buffer 都证明不了它落盘了 ✓）──
const g2 = readGil(OUT);
console.log('\n── 复读核对（从磁盘重读）──');
let bad = 0;
for (const m of made) {
  const rec = g2.recs.find((r) => r.name === m.name);
  if (!rec) { console.log('  ❌ ' + m.name + ' 没写进去'); bad++; continue; }
  const okParent = rec.parentId === modal.id;
  const bl = []; stateBlocks(rec.field.sub, bl);
  const gotW = bl[0] ? pairValue(pairOf(bl[0], 505), 0) : '?';
  const gotX = bl[0] ? pairValue(pairOf(bl[0], 504), 0) : '?';
  const gotY = bl[0] ? pairValue(pairOf(bl[0], 504), 1) : '?';
  const kids = g2.recs.filter((r) => r.parentId === rec.id);
  const okKin = kids.length === m.kids;
  if (!okParent || !okKin) bad++;
  console.log('  ' + (okParent && okKin ? '✅' : '❌') + ' ' + m.name.padEnd(14) + ' #' + rec.id
    + '  父=' + rec.parentId + (okParent ? '(modal ✓)' : '(✗)')
    + '  偏移=(' + gotX + ',' + gotY + ')  w=' + gotW
    + '  子控件=' + kids.length + (okKin ? ' ✓' : ' ✗ 期望 ' + m.kids));
}
console.log('\n记录数：' + g.recs.length + ' → ' + g2.recs.length + '（+ ' + (g2.recs.length - g.recs.length) + '）');
console.log('\n' + (bad === 0 ? '★ ' + made.length + ' 个键全部建好、父级 modal ✓、子控件齐 ✓'
                              : '❌ 有 ' + bad + ' 个不对'));
console.log('⚠️ 交付前**必须**跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
process.exit(bad === 0 ? 0 : 3);
