// tools/gil/gen_tutorial_native.mjs —— 基于【主档自己的母本】克隆出教程浮层，并入主存档
//
//   ★ 为什么另起一个工具（2026-10-21，第二轮）
//     上一轮（gen_tutorial_into.mjs）走的是"把**别的存档**里的教程记录搬进主档"：
//     记录来自教程资产（.gia → 独立存档），带着**源工程**的组件/引用形态。
//     结果 473 → 481 每一版实机都被编辑器挡下（最近一次：界面控件里的开关控件GUID重复:1074000025），
//     而 472（全部记录都是本工程自己长出来的）实机一直正常。
//     ⇒ 本次改成：**所有新控件都从主档已有的记录克隆**（容器 / 按钮 / 文本 / 图片四类母本），
//       只有"号、名字、父级、几何"是新写的 ⇒ 不引入任何外来组件形态。
//
//   ★ 母本（都取自 472.gil，实机验证过的存档）：
//       容器 stage(584x584)   按钮 result.next(312x60，自带 bg+label 两个子控件)
//       文本 hud.subtitle     长文 gen.body        图片 clues.bg
//
//   ★ 号段：默认 1073742811 起（472 全档用到的 id 最大是 1073742810，下一段直到 1073743799 是空档）。
//     可用 --id-base= 改；工具断言"新号与基线全档零交集"。
//
//   ★ 用法：
//     node tools/gil/gen_tutorial_native.mjs --base=472.gil --out=482-教程UI并入-v286.gil [--id-base=1073742811] [--dry]
//
//   断言（任一条不过就不写文件）：
//     ① 记录数 = 基线 + 新增；② 全档自身 GUID 唯一；③ 每个新控件的父存在、父的子列表登记了它；
//     ④ 新记录内部出现的 id 窗口数值只允许【自己的 id / 父的 id / 自己的子控件 id】（禁止外来引用）；
//     ⑤ 新号段与基线全档零交集；⑥ 往返逐字节一致（writeGil 内置）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, cloneField, findChildListTop, ensureChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, setPair,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const BASE = argOf('base', '472.gil');
const OUT = argOf('out', '482-教程UI并入-v286.gil');
const ID_BASE = Number(argOf('id-base', '1073742811'));
const DRY = argv.includes('--dry');

const g = readGil(P(BASE));
const byName = new Map();
for (const r of g.recs) if (r.name && !byName.has(r.name)) byName.set(r.name, r);

// ── 母本 ────────────────────────────────────────────────────────────────────
const PROTO = {
  container: 'stage',
  button: 'result.next',
  text: 'hud.subtitle',   // 标题 / 页码 / 按钮字
  body: 'gen.body',       // 多行正文
  image: 'clues.bg',      // 面板底 / 按钮底 / 标记
};
const protoRec = {};
for (const [k, n] of Object.entries(PROTO)) {
  const r = byName.get(n);
  if (!r) { console.error('✗ 基线里找不到母本 ' + n); process.exit(2); }
  protoRec[k] = r;
}
// 按钮母本 result.next 的两个子控件（bg / label）拿来给按钮当底图与文字
const protoBtnKids = {};
for (const r of g.recs) {
  if (Number(r.parentId) === Number(protoRec.button.id) && r.name) protoBtnKids[r.name] = r;
}
if (!protoBtnKids.bg || !protoBtnKids.label) {
  console.error('✗ 按钮母本 result.next 缺少 bg/label 子控件（找到：' + Object.keys(protoBtnKids).join(',') + '）');
  process.exit(2);
}

// ── 期望的教程结构（名字必须与 lua/tutorial_ui.lua 一致；坐标原点 = 父级中心，设计稿 1600x900）──
const SPEC = [
  { name: 'tut.app.root',    kind: 'container', parent: '@root',           x: 0,    y: 0,    w: 1600, h: 900, kids: [] },
  { name: 'tut.screen.demo', kind: 'container', parent: 'tut.app.root',    x: 0,    y: 0,    w: 1240, h: 780, kids: [] },
  { name: 'tut.hud.title',   kind: 'text',      parent: 'tut.screen.demo', x: 0,    y: 320,  w: 820,  h: 56,  kids: [] },
  { name: 'tut.hud.pager',   kind: 'text',      parent: 'tut.screen.demo', x: 0,    y: -310, w: 260,  h: 44,  kids: [] },
  { name: 'tut.btn.prev',    kind: 'button',    parent: 'tut.screen.demo', x: -470, y: -250, w: 110,  h: 64,  kids: ['bbg', 'blabel'] },
  { name: 'tut.btn.next',    kind: 'button',    parent: 'tut.screen.demo', x: 470,  y: -250, w: 110,  h: 64,  kids: ['bbg', 'blabel'] },
  { name: 'tut.btn.reset',   kind: 'button',    parent: 'tut.screen.demo', x: 0,    y: -250, w: 150,  h: 60,  kids: ['bbg', 'blabel'] },
  { name: 'tut.btn.close',   kind: 'button',    parent: 'tut.screen.demo', x: 560,  y: 320,  w: 90,   h: 56,  kids: ['bbg', 'blabel'] },
  { name: 'tut.tab.p1',      kind: 'button',    parent: 'tut.screen.demo', x: -170, y: 250,  w: 120,  h: 56,  kids: ['bbg', 'blabel', 'mark'] },
  { name: 'tut.tab.p2',      kind: 'button',    parent: 'tut.screen.demo', x: 0,    y: 250,  w: 120,  h: 56,  kids: ['bbg', 'blabel', 'mark'] },
  { name: 'tut.tab.p3',      kind: 'button',    parent: 'tut.screen.demo', x: 170,  y: 250,  w: 120,  h: 56,  kids: ['bbg', 'blabel', 'mark'] },
  { name: 'tut.page.p1',     kind: 'container', parent: 'tut.screen.demo', x: 0,    y: 20,   w: 1120, h: 340, kids: ['pbg', 'plabel'] },
  { name: 'tut.page.p2',     kind: 'container', parent: 'tut.screen.demo', x: 0,    y: 20,   w: 1120, h: 340, kids: ['pbg', 'plabel'] },
  { name: 'tut.page.p3',     kind: 'container', parent: 'tut.screen.demo', x: 0,    y: 20,   w: 1120, h: 340, kids: ['pbg', 'plabel'] },
];

// 子控件配方：名字固定（lua 侧用 sub(父名, 子名) 取），几何按父级算
const KID = {
  bbg:    { proto: 'image', name: 'bg',      fit: 'fill' },
  blabel: { proto: 'text',  name: 'label',   fit: 'inset' },
  mark:   { proto: 'image', name: 'state.sel', x: 0, y: -22, w: 22, h: 22 },
  pbg:    { proto: 'image', name: 'bg',      fit: 'fill' },
  plabel: { proto: 'body',  name: 'label',   fit: 'inset' },
};

// ── 号：先给父、再给子，顺序固定 ─────────────────────────────────────────────
let nextId = ID_BASE;
const alloc = () => nextId++;
for (const s of SPEC) s.id = alloc();
for (const s of SPEC) {
  s.kidIds = {};
  for (const k of s.kids) s.kidIds[k] = alloc();
}
const newIds = [...SPEC.map((s) => s.id), ...SPEC.flatMap((s) => Object.values(s.kidIds))];
if (new Set(newIds).size !== newIds.length) { console.error('✗ 号段自撞'); process.exit(2); }

// ── 基线全档已用 id（断言新号零交集）────────────────────────────────────────
const baseUsed = new Set();
(function walk(fs_) {
  for (const f of fs_) {
    if (f.wt === 0) {
      const v = Number(f.num);
      if (v >= 1073000000 && v < 1074200000) baseUsed.add(v);
    }
    if (f.sub) walk(f.sub);
  }
})(g.tree);
const clash = newIds.filter((i) => baseUsed.has(i));
if (clash.length) { console.error('✗ 新号与基线撞：' + clash.join(',') + '；请改 --id-base'); process.exit(2); }

// ── 改名：控件名存在 组件 #501=2 → #12 → #501 的文本里 ────────────────────────
function setNameText(fieldSub, newName) {
  for (const blk of fieldSub) {
    if (blk.field !== 505 || !blk.sub) continue;
    const t = blk.sub.find((x) => x.field === 501 && x.wt === 0);
    if (!t || Number(t.num) !== 2) continue;
    const b12 = blk.sub.find((x) => x.field === 12 && x.sub);
    if (!b12) continue;
    const txt = b12.sub.find((x) => x.field === 501 && x.wt === 2 && x.isText);
    if (!txt) continue;
    txt.payload = Buffer.from(newName, 'utf8');
    txt.len = txt.payload.length;
    return true;
  }
  return false;
}

// ── 克隆一条记录：换号（自身/父）、改名、改几何、清子列表 ──────────────────────
function cloneRec(proto, newId, parentId, newName, geom) {
  const protoId = Number(proto.id);
  const protoParent = Number(proto.parentId);
  const f = cloneField(proto.field);
  (function rew(fs_) {
    for (const x of fs_) {
      if (x.wt === 0) {
        const v = Number(x.num);
        if (v === protoId) x.num = BigInt(newId);
        else if (protoParent && v === protoParent) x.num = BigInt(parentId);
      }
      if (x.sub) rew(x.sub);
    }
  })(f.sub);
  if (!setNameText(f.sub, newName)) throw new Error('改名失败：' + newName);
  const bl = [];
  stateBlocks(f.sub, bl);
  if (!bl.length) throw new Error('母本没有状态块：' + proto.name);
  for (const b of bl) {
    const p = pairOf(b, 504); if (p) setPair(p, geom.x, geom.y);
    const s = pairOf(b, 505); if (s) setPair(s, geom.w, geom.h);
  }
  const cl = findChildListTop(f.sub);
  if (cl) setChildList(cl, []);
  return f;
}

// ── 造记录 ─────────────────────────────────────────────────────────────────
const recArr = g.recHolder;
const added = [];               // { name, id, field, parentId, kidIds[] }
const allowedById = new Map();  // id -> Set(允许在记录内部出现的 id 数值)
const idOfSpec = new Map(SPEC.map((s) => [s.name, s.id]));
const rootId = Number(byName.get('root').id);

function parentIdOf(specName) {
  if (specName === '@root') return rootId;
  return idOfSpec.get(specName);
}

// ① 先造父
for (const s of SPEC) {
  const pid = parentIdOf(s.parent);
  const f = cloneRec(protoRec[s.kind], s.id, pid, s.name, s);
  recArr.push(f);
  added.push({ name: s.name, id: s.id, field: f, parentId: pid, kidIds: [] });
}

// ② 再造子，并把子登记进父的子列表
for (const s of SPEC) {
  const parentEntry = added.find((a) => a.id === s.id);
  const kids = [];
  for (const k of s.kids) {
    const recipe = KID[k];
    const kidProto = k === 'bbg' ? protoBtnKids.bg : k === 'blabel' ? protoBtnKids.label : protoRec[recipe.proto];
    const kidId = s.kidIds[k];
    let gx = recipe.x || 0, gy = recipe.y || 0, gw = recipe.w || 0, gh = recipe.h || 0;
    if (recipe.fit === 'fill') { gx = 0; gy = 0; gw = s.w; gh = s.h; }
    else if (recipe.fit === 'inset') { gx = 0; gy = 0; gw = Math.max(40, s.w - 24); gh = Math.max(28, s.h - 16); }
    const kf = cloneRec(kidProto, kidId, s.id, recipe.name, { x: gx, y: gy, w: gw, h: gh });
    recArr.push(kf);
    added.push({ name: recipe.name, id: kidId, field: kf, parentId: s.id, kidIds: [] });
    kids.push({ id: kidId, name: recipe.name });
    allowedById.set(kidId, new Set([kidId, s.id]));
  }
  parentEntry.kidIds = kids.map((x) => x.id);
  if (kids.length) {
    let cl = findChildListTop(parentEntry.field.sub);
    if (!cl) cl = ensureChildListTop({ field: parentEntry.field }, null);
    setChildList(cl, kids.map((x) => x.id));
  }
}

// ②之二 把每个教程控件登记进【它父控件】的子列表（tut.app.root 除外，它挂主档 root 下）
for (const s of SPEC) {
  if (s.parent === '@root') continue;
  const parentEntry = added.find((a) => a.id === idOfSpec.get(s.parent));
  const cl = findChildListTop(parentEntry.field.sub) || ensureChildListTop({ field: parentEntry.field }, null);
  const list = (asIdList(cl.payload, true) || []).map(Number);
  if (!list.includes(s.id)) list.push(s.id);
  setChildList(cl, list);
}
// ③ 允许集合（父记录里可以出现：自己的 id、父的 id、自己子控件的 id）
for (const a of added) {
  allowedById.set(a.id, new Set([a.id, a.parentId, ...a.kidIds]));
}

// ── 把 tut.app.root 登记进主档 root 的子列表（追加到末尾 = 层级最靠前 = 浮层在上）──
const baseRoot = byName.get('root');
const rootCl = findChildListTop(baseRoot.field.sub);
if (!rootCl) { console.error('✗ 主档 root 没有子列表'); process.exit(3); }
const rootKids = (asIdList(rootCl.payload, true) || []).map(Number);
rootKids.push(SPEC[0].id);
setChildList(rootCl, rootKids);

console.log('基线 ' + path.basename(BASE) + '：记录 ' + g.recs.length + '，新增 ' + added.length + ' 条');
console.log('号段 ' + ID_BASE + ' … ' + (nextId - 1) + '（与基线全档零交集 ✓）');
console.log('母本：' + Object.entries(PROTO).map(([k, v]) => k + '=' + v).join('  ') + '；按钮子控件 bg,label 取自 result.next');
for (const s of SPEC) {
  console.log('  ' + s.name.padEnd(18) + '#' + s.id + (s.kids.length
    ? '  子：' + s.kids.map((k) => KID[k].name + '#' + s.kidIds[k]).join(' ') : ''));
}

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

const expectRecs = g.recs.length + added.length;
writeGil(g, P(OUT), {
  label: 'gen_tutorial_native',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const seen = new Set();
    for (const r of g2.recs) {
      const id = Number(r.id);
      if (seen.has(id)) bad.push('自身 GUID 重复：' + id);
      seen.add(id);
    }
    const recById = new Map(g2.recs.map((r) => [Number(r.id), r]));
    for (const a of added) {
      const r = recById.get(a.id);
      if (!r) { bad.push('重读后找不到 ' + a.name + '#' + a.id); continue; }
      if (a.parentId != null) {
        const parent = recById.get(a.parentId);
        if (!parent) bad.push(a.name + ' 的父 #' + a.parentId + ' 不存在');
        else {
          const pcl = findChildListTop(parent.field.sub);
          const list = pcl ? (asIdList(pcl.payload, true) || []).map(Number) : [];
          if (!list.includes(a.id)) bad.push(a.name + ' 没被登记进父 ' + (parent.name || '#') + '#' + parent.id + ' 的子列表');
        }
        if (Number(r.parentId) !== a.parentId) bad.push(a.name + ' 的父指针不是 #' + a.parentId);
      }
      const allowed = allowedById.get(a.id) || new Set([a.id]);
      (function walk(fs_) {
        for (const f of fs_) {
          if (f.wt === 0) {
            const v = Number(f.num);
            if (v >= 1073000000 && v < 1074200000 && !allowed.has(v)) {
              bad.push(a.name + '#' + a.id + ' 内部出现外来 id ' + v);
            }
          }
          if (f.sub) walk(f.sub);
        }
      })(r.field.sub);
      for (const k of a.kidIds) if (!recById.has(k)) bad.push(a.name + ' 的子控件 #' + k + ' 不存在');
    }
    // 名字唯一（教程控件的顶层名）
    for (const s of SPEC) {
      const n = g2.recs.filter((r) => r.name === s.name).length;
      if (n !== 1) bad.push('名字 ' + s.name + ' 出现 ' + n + ' 次（应为 1）');
    }
    if (bad.length) throw new Error('✗ 断言失败（' + bad.length + ' 条）：\n  ' + bad.slice(0, 20).join('\n  '));
    console.log('  ✅ 断言：记录 ' + expectRecs + ' 条、自身 GUID 唯一、父子表一致、新记录零外来 id、教程顶层名各 1 次');
  },
});
console.log('\n已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
