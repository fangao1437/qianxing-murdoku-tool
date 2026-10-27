// tools/gil/rebuild_things.mjs —— ★ 把 `things` 重建成**普通容器**（修「每次运行被克隆一遍」）
//
//   ★ 用户实测（原话）：「格子一直正常运行，出问题的是 **things**，
//     **每次运行后 things 都会被克隆一遍出来**，往这个方向查」
//
//   ★ 实测证据（408 存档，逐条比组件清单 `#502/*`）：
//       assets / clues / stage   → 组件类型 **1**          ← 普通容器
//       tpl-container（模板引用）→ 组件类型 1,2,3
//       **things**               → 组件类型 **1,2,4**      ← ★ 多了 2 和 4
//     `things` 是 396 用 `gen_things_obj.mjs` **克隆 `tpl-container`** 建的 ⇒
//     它把母本的**非容器组件**一起带了过来 ⇒ 引擎把它当成"可实例化的东西"，
//     每次场景加载就多一份 ⇒ 与用户的观察完全吻合。
//
//   ★ 做法：**换母本重建** —— 用 `assets`（组件只有 1 的真实容器）克隆一份新的 `things`，
//     保留旧 `things` 的**名字 / 父级 / 位置尺寸 / 6 个 obj.* 子控件 / 子列表次序**，
//     然后把旧记录整条删掉。
//
//   用法：node tools/gil/rebuild_things.mjs --in=408-…v263.gil --out=409-…gil [--dry]
//   验收：新 things 组件 == [1]；子控件 6 个且父指针指向新 id；root 子列表位置不变；
//         旧记录消失；记录数 -1+1；往返逐字节一致；内层多属号仍 82。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, stateBlocks, textsOf,
  findChildListTop, setChildList, asIdList,
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
if (!IN || !OUT) { console.error('用法: --in=<存档> --out=<输出> [--dry]'); process.exit(1); }

const g = readGil(P(IN));
let nextId = BigInt(g.maxId) + 1n;
const compsOf = (rec) => (rec.field.sub || []).filter((f) => f.field === 502 && f.sub)
  .map((f) => { const t = f.sub.find((x) => x.field === 501 && x.wt === 0); return t ? Number(t.num) : -1; });

const things = g.byName.get('things');
const assets = g.byName.get('assets');
const rootRec = g.byName.get('root');
if (!things) { console.error('✗ 找不到 things'); process.exit(2); }
if (!assets) { console.error('✗ 找不到 assets（母本）'); process.exit(2); }
if (!rootRec) { console.error('✗ 找不到 root'); process.exit(2); }

const oldId = Number(things.id);
const newId = nextId++;
const kidsOld = g.recs.filter((r) => Number(r.parentId) === oldId);
console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length);
console.log('  things #' + oldId + '　组件 ' + compsOf(things).join(',') + '　子控件 ' + kidsOld.length
  + '：' + kidsOld.map((k) => k.name).join(','));
console.log('  母本 assets #' + Number(assets.id) + '　组件 ' + compsOf(assets).join(','));
console.log('  ⇒ 新 things #' + Number(newId));

// ── ① 克隆 assets 的整块字段，改自带 GUID、名字、父指针 ────────────────────
const cf = cloneField(assets.field);
const own = cf.sub.find((x) => x.field === 501 && x.wt === 0);
if (!own) { console.error('✗ 母本没有 #501'); process.exit(3); }
own.num = newId;

// 名字：母本里那段 text 就是 "assets" ⇒ 改成 "things"
const t = textsOf(cf.sub, []).find((x) => x.payload && x.payload.toString('utf8') === 'assets');
if (!t) { console.error('✗ 母本里找不到名字文本 "assets"'); process.exit(3); }
t.payload = Buffer.from('things', 'utf8');
t.len = t.payload.length;

// 父指针：#504
const par = cf.sub.find((x) => x.field === 504 && x.wt === 0);
if (par) par.num = BigInt(rootRec.id); else cf.sub.push({ field: 504, wt: 0, num: BigInt(rootRec.id) });

// 位置/尺寸：几何归编辑器 ⇒ 把旧 things 的**第一块状态块**里的位置/尺寸抄到克隆体上
//   ⚠️ 不能整块替换 `#505`：**控件名就存在 `#505` 里的 `#12` 文本**（实测：整块换掉 ⇒ 名字变 null）
const oldBlocks = [];
stateBlocks(things.field.sub, oldBlocks);
if (oldBlocks.length) {
  const newBlocks = [];
  stateBlocks(cf.sub, newBlocks);
  const src = oldBlocks[0];
  const srcP = src.sub.find((x) => x.field === 504 && x.sub);
  const srcS = src.sub.find((x) => x.field === 505 && x.sub);
  if (newBlocks.length) {
    const dst = newBlocks[0];
    for (const [no, s] of [[504, srcP], [505, srcS]]) {
      if (!s) continue;
      const d = dst.sub.find((x) => x.field === no && x.sub);
      if (d) {
        for (let i = 0; i < s.sub.length && i < d.sub.length; i++) {
          if (s.sub[i].wt === 5 && d.sub[i].wt === 5) d.sub[i].f = s.sub[i].f;
          else if (s.sub[i].wt === 0 && d.sub[i].wt === 0) d.sub[i].num = s.sub[i].num;
        }
      }
    }
    console.log('  + 几何沿用旧 things（位置/尺寸写进克隆体的第一块状态块）');
  } else {
    cf.sub.push(cloneField(src));
    console.log('  + 母本没有状态块 ⇒ 整块克隆旧 things 的第一块（位置/尺寸照旧）');
  }
}

// 子列表：按旧 things 里的**原次序**登记 6 个 obj.*
const oldCl = findChildListTop(things.field.sub);
const oldIds = oldCl ? (asIdList(oldCl.payload, true) || []).map(Number) : kidsOld.map((k) => Number(k.id));
const newCl = findChildListTop(cf.sub);
if (!newCl) { console.error('✗ 克隆体没有子列表'); process.exit(3); }
setChildList(newCl, oldIds);
console.log('  + 子列表 ' + oldIds.length + ' 项（沿用旧次序）');

// ── ② 替换进树：root 的子列表里换 id ──────────────────────────────────────
const rootCl = findChildListTop(rootRec.field.sub);
if (!rootCl) { console.error('✗ root 没有子列表'); process.exit(3); }
const rIds = (asIdList(rootCl.payload, true) || []).map(Number);
const at = rIds.indexOf(oldId);
if (at < 0) { console.error('✗ root 子列表里没有 things'); process.exit(3); }
rIds[at] = Number(newId);
setChildList(rootCl, rIds);

// ── ③ 6 个 obj.* 的父指针改成新 id ────────────────────────────────────────
let reparented = 0;
for (const k of kidsOld) {
  const f = k.field.sub.find((x) => x.field === 504 && x.wt === 0);
  if (f) { f.num = newId; reparented++; }
}
console.log('  + 改写子控件父指针 ' + reparented + '/' + kidsOld.length);

// ── ④ 物理替换记录：旧 things 整条换掉 ───────────────────────────────────
function holderOf(id) {
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
const holder = holderOf(oldId);
if (!holder) { console.error('✗ 树里找不到旧 things 记录'); process.exit(3); }
holder.arr[holder.index] = cf;

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

const expectRecs = g.recs.length;   // 一换一，条数不变
writeGil(g, P(OUT), {
  label: 'rebuild_things',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const th = g2.recs.find((r) => r.name === 'things' && Number(r.id) === Number(newId));
    if (!th) bad.push('新 things 不在存档里');
    else {
      const c = compsOf(th);
      if (c.length !== 1 || c[0] !== 1) bad.push('新 things 组件 = ' + c.join(',') + '（应为 1）');
      const kids = g2.recs.filter((r) => Number(r.parentId) === Number(newId));
      if (kids.length !== oldIds.length) bad.push('子控件数 ' + kids.length + '（应 ' + oldIds.length + '）');
      const cl = findChildListTop(th.field.sub);
      const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
      if (ids.length !== oldIds.length) bad.push('子列表 ' + ids.length + ' 项（应 ' + oldIds.length + '）');
    }
    if (g2.recs.some((r) => Number(r.id) === oldId)) bad.push('旧 things #' + oldId + ' 还在');
    const root2 = g2.recs.find((r) => r.name === 'root');
    const rc = findChildListTop(root2.field.sub);
    const rid = rc ? (asIdList(rc.payload, true) || []).map(Number) : [];
    if (!rid.includes(Number(newId))) bad.push('root 子列表没登记新 things');
    if (rid.includes(oldId)) bad.push('root 子列表仍登记旧 things');
    if (bad.length) throw new Error('✗ 断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 断言：新 things 组件 = [1]（纯普通容器）、子控件 ' + oldIds.length
      + ' 个、root 子列表已换、旧记录已删');
  },
});
console.log('\n已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
