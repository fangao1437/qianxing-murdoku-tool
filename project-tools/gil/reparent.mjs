// tools/gil/reparent.mjs —— **把一组控件在 .gil 里搬到另一个父级下**
//
// 为什么要这个工具（2026-10-02）：
//   `home` / `select` 这两个"容器"在 .gil 里其实是**按钮原型** —— 它们铺满 1600x900
//   之后就变成了一个**全屏按钮**：吃掉所有射线（用户实测"选关页点哪里都有点击音效、
//   但卡片和返回键都点不到"）。
//
//   而**不能简单把它们缩小**：子控件在 .gil 里挂在它们下面，引擎会**按父级矩形裁剪**
//   —— 用户实测过："消失的是选关界面上该有的按钮"。
//
//   ⇒ 唯一同时满足"不裁"和"不吃点击"的做法：
//       **把子控件在 .gil 里真的搬到 `root` 下**，然后把容器缩成 1x1。
//     坐标不用改：子控件的几何是**相对父级中心**存的，而 `root` 的中心
//     和 `home`/`select` 的中心是同一个点（都在 (0,0)、都铺满）。
//
// 用法：
//   node tools/gil/reparent.mjs --in=完整界面40-计划同步.gil --out=... --to=root --ids=home.,select.
//   （--ids 支持前缀匹配：`home.` 会匹配 home.select / home.title …，但**不含 home 自己**）
//
// 做法（照《工作约定》第 3 条：**父级要同时改记录里的 `#504` 和父控件的子列表**）：
//   ① 新父级的子列表里**补上**这些 id
//   ② 旧父级的子列表里**删掉**这些 id
//   ③ 每条记录的 `#504` 指向新父级

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, findChildListTop, setChildList, asIdList, pairOf, setPair,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

const IN = argOf('in') ? path.join(ROOT, argOf('in')) : path.join(ROOT, '完整界面40-计划同步.gil');
const OUT = argOf('out') ? path.join(ROOT, argOf('out')) : IN;
const TO = argOf('to') || 'root';
const IDS = (argOf('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (IDS.length === 0) {
  console.log('  没有 --ids，什么都不做');
  process.exit(0);
}

const g = readGil(IN);
const byName = g.byName;
const toRec = byName.get(TO);
if (!toRec) { console.error('❌ 找不到目标父级 ' + TO); process.exit(2); }

// 收集要搬的记录（前缀匹配；`home.` 不含 `home` 自己）
const moving = [];
for (const r of g.recs) {
  const nm = String(r.name || '');
  if (nm === '') continue;
  for (const pre of IDS) {
    if (pre.endsWith('.')) {
      if (nm.startsWith(pre)) { moving.push(r); break; }
    } else if (nm === pre) { moving.push(r); break; }
  }
}
console.log('  目标父级：' + TO + '（记录 id ' + toRec.id + '）');
console.log('  要搬的记录：' + moving.length + ' 条');

// 找新父级的子列表（没有就用原型建一个）
const toList = findChildListTop(toRec.field.sub) || null;
if (!toList) {
  console.error('❌ 目标父级没有子列表（findChildListTop 返回空）—— 先确认它是个容器节点');
  process.exit(3);
}
const curIds = asIdList(toList).map((x) => String(x));

const movedIds = moving.map((r) => String(r.id));
const addIds = movedIds.filter((id) => !curIds.includes(id));
setChildList(toList, curIds.concat(addIds));
console.log('  ✅ 新父级子列表：' + curIds.length + ' → ' + (curIds.length + addIds.length) + ' 个');

// 从旧父级子列表里删掉
const movingSet = new Set(movedIds);
let removedTotal = 0;
for (const r of g.recs) {
  if (movingSet.has(String(r.id))) continue;
  const lst = findChildListTop(r.field.sub);
  if (!lst) continue;
  const ids = asIdList(lst).map((x) => String(x));
  const kept = ids.filter((id) => !movingSet.has(id));
  if (kept.length !== ids.length) {
    setChildList(lst, kept);
    removedTotal += ids.length - kept.length;
    console.log('  ✅ 从 ' + String(r.name) + ' 的子列表里删掉 ' + (ids.length - kept.length) + ' 个');
  }
}
if (removedTotal === 0) console.log('  （旧父级子列表里没找到这些 id —— 可能本来就是不完整的关系，继续）');

// 改每条记录的 #504
let n504 = 0;
// ★★★★★★★★ 2026-10-15 **越界改写事故：这里原来会毁掉整棵控件树** ✗✗
//
//   ★ 事故经过 ✓：用它改父 12 条记录（`--ids="select.card."`）✓
//     日志打印「**改写 #504 的记录字段：36 处**」✗ —— **12 条记录却改了 36 处** = 每条 3 处 ✗✓
//     ⇒ ★ 真机实测（用户 04:43 日志）：
//       「客户端控件树（脚本能看到的，**共 1 个节点**）」「`board/stage/home/select` **全部找不到**」✗
//       「已由脚本打开 **1** 个容器的常驻光标」（正常是 6 ✓）✗
//     ⇒ ★★ **`root` 在、但它的子控件在运行时全部解析不到** ✓ —— **整屏界面消失** ✗✗
//
//   ★ 根因 ✓：原来的 `fixParent` **递归进嵌套消息** ✗：
//       `if (f.wt === 0 && f.field === 504) { f.num = … }        ← 任何深度都改 ✗
//        `else if (f.wt === 2 && f.sub) fixParent(f.sub);`        ← 递归进去 ✗
//     ★ 而 `delete_controls.mjs` 的文件头**早就警告过** ✓：
//       「这个文件里**嵌套**的 `#504` 到处都是，而且**取值是真的控件 ID**」✗
//     ⇒ 那些嵌套 `#504` **属于别的语义** ✗ 一并改掉 ⇒ 父级关系在运行时崩掉 ✓
//
//   ★ 现在的修法 ✓：**只改记录自己的顶层 `#504`** ✓ 不递归 ✓
//     （§「#504 是记录顶层字段」这条与 `delete_controls.mjs` 的判据一致 ✓）
//
//   ★ 教训 ✓：**批量改二进制字段前，先问"这个字段号在别的层级是不是另一个意思"** ✗
//     —— 光看"改了几处"的计数（36 而不是 12）就该起疑 ✓ 我当时没看 ✗
for (const r of moving) {
  for (const f of r.field.sub) {
    if (f.wt === 0 && f.field === 504) { f.num = BigInt(toRec.id); n504++; }
  }
}
console.log('  ✅ 改写 #504 的记录字段：' + n504 + ' 处');

// ★★★★★★ 2026-10-15 **修一个静默崩掉的 bug** ✗✓
//
//   ★ 症状 ✓：跑起来打印到「✅ 改写 #504 的记录字段：8 处」之后
//     抛 `TypeError: Cannot read properties of undefined (reading 'length')` ✗
//     ⇒ ★ **没有写出任何文件** ✗（所以那一步等于白做 ✓）
//
//   ★ 根因 ✓：这里原来是 `const buf = g.pack();` ✗ —— **少了参数** ✗
//     `gilread` 的 `pack` 现在要**先 `encodeMsg(g.tree)` 再喂进去** ✓
//     （对照 `set_key_art.mjs` 的正确写法 ✓：
//        `const body = encodeMsg(g.tree); const buf = g.pack(body);` ✓）
//     ⇒ `pack(undefined)` ⇒ 内部读 `undefined.length` ⇒ **正是那个 TypeError** ✓
//
//   ⇒ ★ 这个工具应该写在 `gilread` 换签名**之前** ✗ ⇒ 之后**再没人跑过它** ✓
//     ★ 教训 ✓：**改公共库的签名，要 grep 全仓的调用点** ✗
const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);
console.log('  写出：' + path.basename(OUT) + '  ' + Math.round(buf.length / 1024) + ' KB');

// 回读确认
const g2 = readGil(OUT);
let okCount = 0, badCount = 0;
for (const r of g2.recs) {
  const nm = String(r.name || '');
  if (!movedIds.length) break;
  if (!moving.some((m) => String(m.id) === String(r.id))) continue;
  const p = pairOf(r.field.sub, 504);
  const pv = p ? String(BigInt(pairValueLocal(p, 0))) : '(无)';
  if (pv === String(toRec.id)) okCount++; else { badCount++; console.log('    ⚠️ ' + nm + ' 的 #504 = ' + pv + '（期望 ' + toRec.id + '）'); }
}
function pairValueLocal(p, i) {
  // #504 是"单值对"，第 0 个分量就是父级 id
  const vals = p.num !== undefined && p.num.length !== undefined ? p.num : null;
  return vals ? vals[i] : p.num;
}
console.log('  回读：#504 已指向新父级的 ' + okCount + ' 条，异常 ' + badCount + ' 条');
