// tools/gil/gen_palette.mjs —— 在 assets 下建 4 个"调色板壳"（★ 无图 ✓ 只占名字 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 本文件是**【示范级】写法** —— lead 点名："项目笔记里写着照抄它 ⇒ 必须最干净" ✓
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 要写新的"改 .gil"工具 ⇒ ★ **照抄下面这段** ✓（★ 别自己 `fs.writeFileSync` ✗）：
//
//     import { readGil, cloneField, findChildListTop, setChildList, asIdList, bigIds, textsOf } from './gilread.mjs';
//     import { writeGil } from './gilwrite.mjs';
//     const g = readGil(IN);
//     …在 g.tree 上改 / 加 / 删…
//     writeGil(g, OUT, {
//       label:        '这次编辑叫什么',
//       expectRecs:   g.recs.length + 加了几条,   // ★ 加/删记录的工具要显式给 ✓；只改值的用默认 ✓
//       expectDiffs:  N,                          // ★ "只改一个值"就写它 ✓（多一处就抛异常 ✗）
//       expectMarker: 'v148',                     // ★ 只有"叠脚本"类才需要 ✓
//       assert: (g2) => true | '失败原因',         // ★ g2 **已从磁盘重读** ✓ 不是内存 ✗
//     });
//
//   ★★ 它一次就把这四件事做完了（★ 所以不需要你再手写任何"自检" ✓）：
//     ① 输出必须与输入不同（★ 否则＝编辑没生效，直接报错 ✗）
//     ② 落盘 → ★ **从磁盘重新读**（决不复用内存 ✓）
//     ③ 往返闸门：重编码 == 落盘字节 ✓
//     ④ ★ **字段级 diff**：逐节点报出"到底改了什么" ✓ 并按 `expectDiffs` 断言 ✓
//
// 用法： node tools/gil/gen_palette.mjs --in=214.3.gil --out=217-调色板.gil
//
// ★★ 验收（★ 判据，不是建议 ✓）：
//   node tools/gil/gen_palette.mjs --in=<输入> --out=<输出>
//     ⇒ 必须打印 "✅ ④ 已从磁盘重读 …（记录 N+4 条）" ＋ "✅ ⑦ 字段级 diff"
//     ⇒ 且必须打印 "✅ 4 个壳都在 assets 下、子列表已登记、图片 id 已写对"（★ 见下面的 assert ✓）
//   ★ 独立复核：node tools/gil/roundtrip.mjs <输出>
//
// 依据：照 gen_panel_bg.mjs 的**能跑通写法**（★ 现已统一为 `writeGil` ✓）
import fs from 'node:fs';
import { readGil, cloneField, findChildListTop, setChildList, asIdList, bigIds, textsOf } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';
// ★ `assets` 的检查**只有一份** ✓ —— ★ 在 `inspect_gil.mjs` 里 ✓（★ 别再抄第二份 ✗）
import { assertAssets } from './inspect_gil.mjs';
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out');
const NAMES = ['portrait.A', 'portrait.B', 'portrait.V', 'portrait.D'];
// ★ 图片 id 表与"按字段号下钻"helper 提到模块级 ✓ —— ★ 因为**落盘后的断言**也要用它们 ✓
const IDS = { 'portrait.A': 112042, 'portrait.B': 105104, 'portrait.V': 112031, 'portrait.D': 105105 };
function nodesAt(fs, path) {
  let cur = fs;
  for (const fno of path) {
    const nxt = [];
    for (const f of cur) { if (!f.sub) continue; for (const g of f.sub) if (g.field === fno && g.sub) nxt.push(g); }
    cur = nxt;
  }
  return cur;
}
/** 取某记录 `/505/503/84` 节点上的 `#503`（= 素材 id ✓）
 *  ★★★ 2026-10-10 修 off-by-one ✗✓：★ 起点必须是【记录自身】✓（`[rec.field]` ✓），
 *    ★ **不是** `rec.field.sub` ✗ —— ★ 传 `sub` 会让 `#505` 变成"从孙子那层开始找" ✗
 *    ⇒ ★ 实测：`290.gil` 的 `clue.face` 里 **`/#505/#503/#84/#503` 确实存在 = `100001`** ✓，
 *      ★ 而按旧写法**搜不到** ✗（★ 于是工具报"找不到 /505/503/84#503" ✗ 拒绝运行 ✓）
 *    ⇒ ★★ 这也解释了为什么它在 2026-10-08 能跑、现在跑不了 ✓（★ 路径假设与真实结构差一层 ✓）
 *    ⚠️ ★ 同类坑在本文件的历史注释里出现过一次（"多下钻了一层" ✗）—— ★ 那次修的是**尾部**，
 *      ★ 这次修的是**头部** ✓ ⇒ ★ 教训：★ **路径匹配要断言"找到了几个"，别只看"没报错"** ✓
 */
function imgIdsOf(rec) {
  const out = [];
  for (const nd of nodesAt([rec.field], [505, 503, 84])) {
    for (const f of (nd.sub || [])) if (f.field === 503 && f.wt === 0) out.push(Number(f.num));
  }
  return out;
}
if (!IN || !OUT) { console.error('要 --in= 和 --out='); process.exit(1); }
const g = readGil(IN);
console.log('  存档 ' + IN + '  记录 ' + g.recs.length);
// ① 父级：assets
const assets = g.recs.find((r) => r.name === 'assets');
if (!assets) { console.error('  ✗ 找不到 assets'); process.exit(2); }
console.log('  assets id=' + assets.id);
// ② 原型：clue 下"没有配图"的 face（已 dump 证明它 146 个叶子只有名字 ✓）
const cell = g.recs.find((r) => r.name === 'cell.1.1');
const cont = g.recs.find((r) => r.parentId === cell.id && r.name === 'content');
const proto = g.recs.find((r) => r.parentId === cont.id && r.name === 'face');
if (!proto) { console.error('  ✗ 找不到 clue.face'); process.exit(2); }
console.log('  原型 clue.face id=' + proto.id);
// ③ 找"父级记录"所在的字段数组（克隆体要插进同一个数组 ✓）
function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if (((bigIds(f.sub, [])[0] || {}).num) === BigInt(id)) return { arr, index: i };
        stack.push(f.sub);
      }
    }
  }
  return null;
}
const ph = holderOf(proto.id);
if (!ph) { console.error('  ✗ 找不到原型所在字段数组'); process.exit(2); }
const ah = holderOf(assets.id);
if (!ah) { console.error('  ✗ 找不到 assets 所在字段数组'); process.exit(2); }
// ④ 新 id
let maxId = 0n;
for (const r of g.recs) if (BigInt(r.id) > maxId) maxId = BigInt(r.id);
console.log('  当前最大 id=' + maxId);
// ⑤ 逐个克隆 + 改名 + 改 id
const cl = findChildListTop(assets.field.sub);
if (!cl) { console.error('  ✗ assets 没有子列表字段'); process.exit(2); }
const ids = asIdList(cl.payload, true) || [];
const made = [];
for (let i = 0; i < NAMES.length; i++) {
  const cf = cloneField(ph.arr[ph.index]);
  const bid = bigIds(cf.sub, [])[0];
  if (!bid) { console.error('  ✗ 克隆体里找不到 #501'); process.exit(2); }
  bid.num = maxId + BigInt(i + 1);
  // 改名：找 payload 等于 "face" 的文本字段
  const txt = textsOf(cf.sub, []).find((t) => t.payload && t.payload.toString('utf8') === 'face');
  if (!txt) { console.error('  ✗ 克隆体里找不到名字字段'); process.exit(2); }
  txt.payload = Buffer.from(NAMES[i], 'utf8');
  // ★★★ 关键：改写克隆体的 #504（父引用）⇒ 否则记录在、却没挂到 assets 下 ✗
  //    （reparent.mjs 的日志里那句"改写 #504 的记录字段"就是这一步 ✓ 我上一版漏了 ✓）
  // ★★★ 写图片 id（★ 路径取自能跑通的 gen_panel_bg ✓ ★ src 继承克隆体自身 ✓ 只换 id ✓）
  function atPath(fs, path) {
    let cur = fs;
    for (const fno of path) { const nxt = []; for (const f of cur) if (f.sub) nxt.push(...f.sub); cur = nxt; }
    return cur.filter((f) => f.wt === 0);
  }
  // ★★★ 2026-10-08 修（用户实测：编辑器里仍显示 100001 ✗）：★ 图片 id 要写【全部状态块】✗✓
  //   上一版只写了 `[0]`（第一个匹配）⇒ 编辑器读的那个块没被改 ⇒ 仍显示继承来的 100001 ✓
  // ★★★★★ 2026-10-08 **真因（用户实测 + 我 dump 出来 ✓）**：★ 图片 id 的位置是 **`/505/503/84#503`** ✗✓
  //   ★ 我上一版写成 `[505,503,84,503]` ⇒ **多下钻了一层** ✗ ⇒ 写到了别的地方（`/505/503/13/12#502` ✓）
  //     ⇒ ★ 编辑器读的仍是继承来的 **`100001`** ✓✓（用户看到的正是它 ✓）
  //   ★ 结构（dump 实证 ✓）：★ 节点 `/505/503/84` 上 **直接挂着两个叶子** ✓：
  //     ★ `#502` = **imageSource**（本工程素材库 = `4294967295` ✓ 即 0xFFFFFFFF 哨兵 ✓）
  //     ★ `#503` = **imageId**（★ 就是素材 id ✓ 原型里是 `100001` ✓）
  //   ⇒ ★ 改法：★ **下钻到 `/505/503/84` 这个节点，再取它自己的 `#503` 叶子** ✓（★ 不再多钻 ✓）
  // ★★★ 2026-10-08 修：★ 下钻必须【按字段号】走 ✗✓（上一版只按"深度"走 ⇒ 走到别处 ⇒ 报"找不到" ✓）
  const imgNodes = nodesAt([cf], [505, 503, 84]);   // ★ 起点＝记录自身 ✓（见 imgIdsOf 的 off-by-one 注释 ✓）
  let wrote = 0;
  for (const nd of imgNodes) {
    for (const f of (nd.sub || [])) {
      if (f.field === 503 && f.wt === 0) { f.num = BigInt(IDS[NAMES[i]]); wrote++; }
    }
  }
  if (wrote === 0) { console.error('  ✗ 找不到 /505/503/84#503'); process.exit(2); }
  const srcLeaves = [];
  for (const nd of imgNodes) for (const f of (nd.sub || [])) if (f.field === 502 && f.wt === 0) srcLeaves.push(Number(f.num));
  console.log('      imgId → ' + IDS[NAMES[i]] + '（写了 ' + wrote + ' 处 ✓）  src = ' + srcLeaves.join(','));
  const pf = cf.sub.find((x) => x.field === 504 && x.wt === 0);
  if (pf) { pf.num = BigInt(assets.id); console.log('      #504 → ' + assets.id); }
  else { console.error('  ✗ 克隆体里找不到 #504'); process.exit(2); }
  made.push({ name: NAMES[i], id: Number(bid.num), field: cf });
  ids.push(Number(bid.num));
  console.log('    + ' + NAMES[i] + '  id=' + bid.num);
}
// ⑥ 登记进 assets 子列表 + 把克隆体插进树
setChildList(cl, ids);
for (let i = made.length - 1; i >= 0; i--) ah.arr.splice(ah.index + 1, 0, made[i].field);

// ⑦ ★★ 保存 —— 走唯一安全通道 ✓（★ 别再自己 writeFileSync ✗ —— 见头部第 8 行的反面教材 ✓）
let rep;
try {
  rep = writeGil(g, OUT, {
    label: '在 assets 下建 4 个调色板壳',
    expectRecs: g.recs.length + NAMES.length,   // ★ 加了 4 条 ✓ 多一条少一条都抛异常 ✗
    assert: (g2) => {
      // ★★ lead 点名要验的：★ 产出的 `assets` 下控件**是不是真的存在** ✓
      //   （★ "assets 取不到"是这轮排查里绕不开的坑 ⇒ ★ 照抄它的工具不能把坑抄出去 ✓）
      //   ★ 检查逻辑**只有一份** ✓ —— 在 `inspect_gil.mjs` 的 `assertAssets` ✓（★ 不抄第二份 ✗）
      const a = assertAssets(g2, NAMES);
      if (a !== true) return a;
      // 再加一层：★ 每个壳的**图片 id** 必须写对 ✓（★ `assets` 家族之外的事 ✓）
      for (const n of NAMES) {
        const got = imgIdsOf(g2.byName.get(n));
        if (!got.includes(IDS[n])) return n + ' 的图片 id = [' + got.join(',') + ']，未写入 ' + IDS[n] + ' ✗';
      }
      return true;
    },
  });
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(5);
}

const g2 = rep.g2;
console.log('  输出 ' + OUT + '  ' + rep.bytes + ' 字节  记录 ' + rep.recs + '（+' + (rep.recs - g.recs.length) + '）');
console.log('  ⑤ ④ 复读（从磁盘）：' + NAMES.map((n) => n + '=' + (g2.byName.get(n) || {}).id).join('  '));
console.log('  ✅ 4 个壳都在 assets 下、子列表已登记、图片 id 已写对（★ 已用**重读磁盘**的那份断言 ✓）');
console.log('  ★ 4 个壳已建好（★ 无图 ✓ 去编辑器里配图即可 ✓）');
console.log('  ★ 独立复核：node tools/gil/roundtrip.mjs ' + OUT);
process.exit(0);