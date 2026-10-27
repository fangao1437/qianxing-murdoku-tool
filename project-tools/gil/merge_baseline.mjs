// tools/gil/merge_baseline.mjs —— **把 97 里的少数几条记录搬进 93**（重建回滚工具）
//
// 背景（2026-10-02）：
//   · `93.gil` = **重建前**的存档：编辑器里有全部界面控件（顶栏 / 线索条 / 维度尺 /
//     头像卡 / 选关卡片 / 家具 / 素材容器 `assets` …，共 283 个是 97 没有的）。
//   · `97.gil` = **重建后**的存档：只留 `home` + `stage` + 三个模板引用。
//   · 用户实测：97 的结构下"点不动"修好了，但**界面布局全没了**（脚本只有两个模板，
//     造出来是一堆白块）⇒ 用户要求**恢复到开始处理 bug 时的布局**。
//
//   ⇒ 正确解法：**以 93 为基底**（它有控件和素材）+ **把 97 独有的 3 条搬进来**
//     （`stage` / `tpl.stage` / `tpl-container`）—— 那 3 条是重建带来的新东西，
//     保留它们，以后"脚本创建"这条路仍然可用。
//
//   ⇒ 这样得到的存档：**布局是 93 的**（用户要的），**脚本是修好的**（能点）。
//
// 用法：
//   node tools/gil/merge_baseline.mjs --base=baseline/93-重建前-掩盖态.gil \
//        --add=97.gil --ids=stage,tpl.stage,tpl-container --out=完整界面105-恢复布局.gil

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, setChildList, asIdList, encodeMsg } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

const BASE = path.join(ROOT, argOf('base') || 'baseline/93-重建前-掩盖态.gil');
const ADD = path.join(ROOT, argOf('add') || '97.gil');
const OUT = path.join(ROOT, argOf('out') || '完整界面105-恢复布局.gil');
const IDS = (argOf('ids') || 'stage,tpl.stage,tpl-container').split(',').map((s) => s.trim()).filter(Boolean);

const g = readGil(BASE);
const a = readGil(ADD);

// 找基底里的 root
const rootRec = g.byName.get('root');
if (!rootRec) { console.error('❌ 基底里没有 root'); process.exit(2); }

// 基底已有的名字（避免重复）
const have = new Set();
for (const r of g.recs) { const n = String(r.name || ''); if (n) have.add(n); }

// 从 add 里挑要搬的记录
const moving = [];
for (const id of IDS) {
  const r = a.byName ? a.byName.get(id) : null;
  if (!r) { console.log('  ⚠️ 源存档里没有 `' + id + '`，跳过'); continue; }
  if (have.has(id)) { console.log('  ⚠️ 基底里已经有 `' + id + '`，跳过'); continue; }
  moving.push({ id, rec: r });
}
console.log('  要搬的记录：' + moving.map((m) => m.id).join(' '));

// ① 把每条记录的 #504 改成基底 root 的 id，并加进基底的 recs
const rootId = Number(rootRec.id);
// 把每条记录的 #504 改成基底 root 的 id（**只改第一个**，不管它在第几层 —— 记录自己的父级
// 就是第一个 #504；原来我写了 `depth === 0` 的限制，导致 `tpl-container` 的父级没改到、留在 id=1）
function fixParent(fields, state) {
  let n = 0;
  for (const f of fields) {
    if (f.wt === 0 && f.field === 504 && !state.done) { f.num = BigInt(rootId); state.done = true; n++; }
    else if (f.sub) n += fixParent(f.sub, state);
  }
  return n;
}
let n504 = 0;
for (const m of moving) {
  n504 += fixParent(m.rec.field.sub, { done: false });
  // 记录要 push 到 recHolder（项目注释写明：控件记录真正的家），不是 recs / tree
  g.recHolder.push(m.rec.field);
  console.log('  ✅ 搬入 `' + m.id + '`（id ' + m.rec.id + '）');
}
console.log('  ✅ 改写 #504 指向 root（' + n504 + ' 处）');

// ② 把它们的 id 加进 root 的子列表
//
// ★★★★★ 2026-10-02 **这里踩了一个大坑，务必看懂再改**：
//
//   我原来写的是：
//       const cur = asIdList(lst).map(String);        // ← 在 93.gil 上**读出 0 个**
//       setChildList(lst, cur.concat(addIds));        // ← 于是**用 3 个覆盖了整张子列表**
//   后果（用户真机日志）：`root 子控件=3`、`对照组：树里共收集 4 个具名控件` ——
//   **93 的 308 个控件全部从 root 上掉下来**（记录还在文件里，但 root 不再引用它们）
//   ⇒ 首页消失、隔离失效、选关卡片不见。**"合并"把好存档改坏了。**
//
//   ⇒ 教训：**不要相信"读出来的旧子列表"**（读法可能不对，读到 0 就全毁了）。
//     改用**可靠信息源**：`.gil` 里每条记录自己带父级 `#504` ⇒
//     **root 的子级 = 所有 parentId == root.id 的记录**。这个信息是逐条存的，不会读错。
//
//   ⇒ 并且**写之前先核对**：如果算出来的数量比"读到的旧列表"少很多，就报错停下，别写出坏文件。
const rootChildren = g.recs
  .filter((r) => String(r.parentId) === String(rootId))
  .map((r) => String(r.id));
const lst = findChildListTop(rootRec.field.sub);
if (!lst) { console.error('❌ 基底的 root 没有子列表字段'); process.exit(3); }
const cur = asIdList(lst).map((x) => String(x));
const childSet = new Set(rootChildren);
for (const id of cur) childSet.add(id);               // 读到的旧列表也并进来（宁可多，不可少）
const addIds = moving.map((m) => String(m.rec.id)).filter((id) => !childSet.has(id));
const finalIds = [...childSet, ...addIds];
setChildList(lst, finalIds);
console.log('  ✅ root 子列表：读到旧值 ' + cur.length + ' 个，按 parentId 算出 ' + rootChildren.length
  + ' 个，最终写 ' + finalIds.length + ' 个');
if (finalIds.length < 5) {
  console.error('❌ 算出来的 root 子级只有 ' + finalIds.length + ' 个 —— 明显不对，**不写出**（避免又毁一份存档）');
  process.exit(4);
}

// ③ 写出（pack 需要 body）
const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('  写出：' + path.basename(OUT) + '  ' + Math.round(buf.length / 1024) + ' KB');

// ④ 回读验证
//
// ★ 上一次我只验证了"搬进去的 3 条在不在、父级对不对"，**没验证 root 一共有多少子级**
//   —— 于是"root 子控件=3"这个致命问题直到用户真机跑了一遍才暴露。
//   ⇒ 现在**必须**验证 root 的子级数量和几个关键控件的可达性。
const g2 = readGil(OUT);
console.log('  回读：记录 ' + g2.recs.length + ' 条');
const root2 = g2.byName.get('root');
const kids2 = g2.recs.filter((r) => String(r.parentId) === String(root2.id));
console.log('  ★ root 子级 ' + kids2.length + ' 个：' + kids2.slice(0, 12).map((r) => r.name || r.id).join(' '));
if (kids2.length < 5) {
  console.error('❌ 回读后 root 只有 ' + kids2.length + ' 个子级 —— 这份文件是坏的，请勿交付！');
  process.exit(5);
}
const must = ['home', 'home.select', 'select', 'select.card.1', 'select.back', 'board', 'cell.1.1', 'topbar', 'clues', 'tray'];
let bad = 0;
for (const n of must) {
  const r = g2.byName.get(n);
  if (!r) { console.log('    ❌ 关键控件 `' + n + '` **不在**'); bad++; }
}
console.log(bad === 0
  ? '  ★ 关键控件全在（home / home.select / select / select.card.1 / select.back / board / cell.1.1 / topbar / clues / tray）✅'
  : ('  ❌ 有 ' + bad + ' 个关键控件缺失 —— 不要交付这份文件'));
for (const id of IDS) {
  const r = g2.byName ? g2.byName.get(id) : null;
  console.log('    ' + id + ' → ' + (r ? ('在，父级 id=' + r.parentId + (String(r.parentId) === String(rootId) ? ' ✅（= root）' : ' ⚠️')) : '**不在** ❌'));
}
if (bad > 0) process.exit(6);
