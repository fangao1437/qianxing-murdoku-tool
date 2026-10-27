// tools/gil/gen_tutorial_into.mjs —— 把**教程 UI 骨架**并入主存档（472 系），产出干净合档
//
//   ★ 为什么要有它（2026-10-21 用户指令）：
//     「重新基于 472 把教程逻辑和所需控件按正确骨架建一遍，确保存档干净」
//     骨架来源 = `477-教程UI骨架-独立号段.gil`（已换到 1074000000+ 独立号段、探针全绿）
//
//   ★ 只搬**场景层**（app.root 及其子树 + 场景里的全屏动效），**不搬模板层**：
//       · 模板原型（父 = 引擎内置模板容器 1073742015）在本工程里用不到
//         —— 我们的教程控件是**静态写进存档**的，不在运行时实例化；
//       · 少一层记录 = 少一层撞号与不一致的机会（"确保存档干净"的直接做法）。
//
//   ★ 号段：骨架已是 1074000000..1074000062，与主档（最大 1073743xxx）**零交集**
//     ⇒ 搬进来**不需要再改号**；只改两处连接关系：
//       ① `app.root` 的父指针 → 主档 `root`
//       ② 主档 `root` 的子列表末尾登记 `app.root`
//       ③ 场景全屏动效（父为空）→ 挂到 `app.root` 下并登记
//
//   用法：node tools/gil/gen_tutorial_into.mjs --base=472-头像层-v283.gil \
//           --tut=477-教程UI骨架-独立号段.gil --out=478-教程UI并入.gil [--dry]
//   断言：① 记录数 = base + 场景层条数 ② 自身 GUID 全档唯一 ③ app.root 的父 / root 子列表正确
//         ④ 不含模板层（父 = 1073742015 的记录 0 条）⑤ 往返逐字节一致（writeGil 内置）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList, textsOf, stateBlocks, pairOf, setPair,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const BASE = argOf('base'), TUT = argOf('tut'), OUT = argOf('out');
const PREFIX = argOf('prefix', 'tut.');   // ★ 全部加前缀，避免与主档同名控件（hud.title / bg / label）撞名
const DRY = argv.includes('--dry');
if (!BASE || !TUT || !OUT) { console.error('用法: --base=<主档> --tut=<骨架> --out=<输出> [--dry]'); process.exit(1); }

const TPL_CONTAINER = 1073742015;   // 引擎侧"模板容器"（骨架里模板原型的父）
const g = readGil(P(BASE));
const t = readGil(P(TUT));
const baseIds = new Set(g.recs.map((r) => Number(r.id)));

// ── ① 收集骨架的场景层：从 app.root 出发的整棵子树 + 场景里的全屏动效 ──────────
const appRoot = t.recs.find((r) => r.name === 'app.root');
if (!appRoot) { console.error('✗ 骨架里找不到 app.root'); process.exit(2); }
const byParent = new Map();
for (const r of t.recs) {
  const p = Number(r.parentId);
  if (!byParent.has(p)) byParent.set(p, []);
  byParent.get(p).push(r);
}
const sceneIds = new Set();
(function walk(id) {
  sceneIds.add(id);
  for (const k of (byParent.get(id) || [])) walk(Number(k.id));
})(Number(appRoot.id));
// 场景里的全屏动效：父为空 + 组件 1,2,4（模板原型是 1,2,3，父=模板容器）
for (const r of t.recs) {
  const comps = (r.field.sub || []).filter((f) => f.field === 502 && f.sub)
    .map((f) => { const x = f.sub.find((y) => y.field === 501 && y.wt === 0); return x ? Number(x.num) : -1; });
  const hasTemplateParent = Number(r.parentId) === TPL_CONTAINER;
  const isSceneAnim = r.parentId == null && comps.length === 3 && comps[0] === 1 && comps[1] === 2 && comps[2] === 4
    && String(r.name || '').length > 0;
  if (isSceneAnim) sceneIds.add(Number(r.id));
  if (hasTemplateParent) sceneIds.delete(Number(r.id));
}
const scene = t.recs.filter((r) => sceneIds.has(Number(r.id)));
const clash = scene.filter((r) => baseIds.has(Number(r.id)));
if (clash.length) { console.error('✗ 与主档撞号：' + clash.map((r) => r.name + '#' + r.id).join(',')); process.exit(2); }
console.log('主档 ' + path.basename(BASE) + '　记录 ' + g.recs.length);
console.log('骨架 ' + path.basename(TUT) + '　记录 ' + t.recs.length + '　场景层 ' + scene.length + ' 条：');
console.log('  ' + scene.map((r) => (r.name || '(无名)') + '#' + r.id).join(', '));

// ── ② 找到"记录数组"（所有记录都是同一个数组的元素）────────────────────────
function holderOf(doc, id) {
  const want = BigInt(id);
  const stack = [{ arr: doc.tree }];
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
const rootRec = g.recs.find((r) => r.name === 'root');
const rootHolder = holderOf(g, Number(rootRec.id));
if (!rootHolder) { console.error('✗ 主档里找不到 root 记录'); process.exit(3); }
const recArr = rootHolder.arr;

// ── ③ 登记进主档 root 的子列表 ──────────────────────────────────────────────
const rootCl = findChildListTop(rootRec.field.sub);
if (!rootCl) { console.error('✗ 主档 root 没有子列表'); process.exit(3); }
const rootKids = (asIdList(rootCl.payload, true) || []).map(Number);
const appRootId = Number(appRoot.id);
if (!rootKids.includes(appRootId)) rootKids.push(appRootId);
setChildList(rootCl, rootKids);
console.log('  + 主档 root 子列表登记 app.root（第 ' + rootKids.length + ' 项）');

// ── ④ 克隆场景层记录：append 到记录数组；改两处连接关系 ────────────────────
const clones = [];
for (const r of scene) {
  const cf = cloneField(r.field);
  // app.root 的父 → 主档 root
  if (Number(r.id) === appRootId) {
    const par = cf.sub.find((x) => x.field === 504 && x.wt === 0);
    if (par) par.num = BigInt(rootRec.id); else cf.sub.push({ field: 504, wt: 0, num: BigInt(rootRec.id) });
  }
  // 场景全屏动效（父为空）→ 挂到 app.root，并登记进 app.root 的子列表
  if (r.parentId == null && Number(r.id) !== appRootId) {
    const par = cf.sub.find((x) => x.field === 504 && x.wt === 0);
    if (par) par.num = BigInt(appRootId); else cf.sub.push({ field: 504, wt: 0, num: BigInt(appRootId) });
  }
  clones.push({ src: r, field: cf });
}

// ── ④之二 全部加前缀（★ 避免与主档同名控件撞名：实测骨架里有 `hud.title` / `bg` / `label`）──
//   改名 = 改**控件名文本**（存在 `#505` 块里的 `#12` 文本；`textsOf` 能取到）。
function renameRecord(fieldBlock, oldName) {
  if (!oldName) return null;
  const hit = textsOf(fieldBlock.sub, []).find((x) => x.payload && x.payload.toString('utf8') === oldName);
  if (!hit) return null;
  const next = PREFIX + oldName;
  hit.payload = Buffer.from(next, 'utf8');
  hit.len = hit.payload.length;
  return next;
}
let renamed = 0;
const nameMap = new Map();
for (const c of clones) {
  const nn = renameRecord(c.field, c.src.name);
  if (nn) { renamed++; nameMap.set(c.src.name, nn); }
}
console.log('  + 加前缀 "' + PREFIX + '"：改名 ' + renamed + ' 条（例：'
  + [...nameMap.entries()].slice(0, 3).map(([a, b]) => a + '→' + b).join('，') + '）');

// ── ④之三 `app.root` 必须**满画布**：骨架里 0×0 ⇒ 引擎按父级矩形裁剪 ⇒ 教程整片不显示 ──
const appRootClone0 = clones.find((c) => Number(c.src.id) === appRootId);
{
  const bl = [];
  stateBlocks(appRootClone0.field.sub, bl);
  const rootBl = [];
  stateBlocks(rootRec.field.sub, rootBl);
  if (bl.length) {
    for (const b of bl) {
      const p = pairOf(b, 504); if (p) setPair(p, 0, 0);
      const s = pairOf(b, 505); if (s) setPair(s, 1600, 900);
    }
    console.log('  + app.root 撑成 1600×900 / (0,0)（原 0×0 会把子控件裁掉）');
  } else if (rootBl.length) {
    const blk = cloneField(rootBl[0]);
    const p = pairOf(blk, 504); if (p) setPair(p, 0, 0);
    const s = pairOf(blk, 505); if (s) setPair(s, 1600, 900);
    appRootClone0.field.sub.push(blk);
    console.log('  + app.root 原本无几何 ⇒ 从主档 root 克隆一块（1600×900 / (0,0)）');
  }
}
for (const c of clones) recArr.push(c.field);

// app.root 的子列表：补上刚挂进来的动效
const appRootClone = clones.find((c) => Number(c.src.id) === appRootId);
const appRootCl = findChildListTop(appRootClone.field.sub);
const animIds = clones.filter((c) => c.src.parentId == null && Number(c.src.id) !== appRootId).map((c) => Number(c.src.id));
if (animIds.length) {
  if (!appRootCl) { console.error('✗ app.root 没有子列表，无法登记动效'); process.exit(3); }
  const ids = (asIdList(appRootCl.payload, true) || []).map(Number);
  for (const a of animIds) if (!ids.includes(a)) ids.push(a);
  setChildList(appRootCl, ids);
  console.log('  + app.root 子列表登记场景动效 ' + animIds.length + ' 条');
}

if (DRY) { console.log('\n[--dry] 不写文件（将新增 ' + clones.length + ' 条）'); process.exit(0); }

const expectRecs = g.recs.length + clones.length;
writeGil(g, P(OUT), {
  label: 'gen_tutorial_into',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const own = new Map();
    for (const r of g2.recs) {
      if (r.name) own.set(r.name, (own.get(r.name) || 0) + 1);
    }
    const ids = g2.recs.map((r) => Number(r.id));
    if (new Set(ids).size !== ids.length) bad.push('合档后记录 id 有重复');
    const app = g2.recs.find((r) => r.name === PREFIX + 'app.root');
    if (!app) bad.push('合档后找不到 ' + PREFIX + 'app.root');
    else {
      const par = app.field.sub.find((x) => x.field === 504 && x.wt === 0);
      if (!par || Number(par.num) !== Number(rootRec.id)) bad.push('app.root 的父不是主档 root');
    }
    const root2 = g2.recs.find((r) => r.name === 'root');
    const rc = findChildListTop(root2.field.sub);
    const rids = rc ? (asIdList(rc.payload, true) || []).map(Number) : [];
    if (!rids.includes(appRootId)) bad.push('主档 root 子列表没登记教程根');
    const tplLeft = g2.recs.filter((r) => Number(r.parentId) === TPL_CONTAINER);
    if (tplLeft.length) bad.push('混进了模板层记录 ' + tplLeft.length + ' 条');
    if (bad.length) throw new Error('✗ 断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 断言：记录 ' + expectRecs + ' 条、id 唯一、app.root 挂 root 下、无模板层记录');
  },
});
console.log('\n已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
