// tools/gil/fix_clue_tpl_origin.mjs —— 把列表项模板 `clue` 归零到 (0,0)
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么做这个（用户 2026-10-10 的关键观察 ✓）
// ════════════════════════════════════════════════════════════════════════════
//
//   用户原话 ✓：
//     「网格视窗的**五项预览是都在范围内的**，没有问题 ✓
//      但**模板确实从 -2 位置开始填的** ✗ —— 这一点似乎与不裁剪的解释**不相干** ✓
//      ★ 我只设了**五项**且视窗**装得下**，**为什么会从负数区域开始填模板**？」
//
//   ⇒ ★★ 这一问**指向布局原点** ✓：
//     · ★ 视窗装得下 ✓、预览 5 项都在范围内 ✓ ⇒ ★ **不该有负数** ✗
//     · ★ 而实际**从 −2 开始填** ✗ ⇒ ★ **列表项的起点不在视窗顶部** ✓
//     · ⇒ ★ **带了一个偏移** ✓ —— ★ 那偏移只能是**模板自己的位置** ✓✓
//
//   ★ 存档实测（`246`/`248`/`249` 三份一致 ✓）：
//       模板 `clue`   #1073742421   ★ **pos = (-6, 212)**  ✗ **不在 (0,0)**
//       容器 `clues`  #1073742359   pos = (-570, -61.1)  size = 400×544
//       网格 `clues.grid` #1073742420  pos = (0, 0)  size = 400×544
//     ⇒ ★★ **`212` ≈ `clues` 容器的【上边缘】(= -61.1 + 272 = +210.9)** ✓
//       ⇒ ★ 模板坐在**容器上边缘** ✗ ⇒ ★ 若引擎以它为原点，
//         **前几项就会被推到负数区** ✓✓ —— ★ **与用户观察完全吻合** ✓
//
//   ★ 资料员早先提过「★ 引擎以**模板位置**为原点」这条（**假说 A** ✓）
//     ★ 我当时**用官方文本把它否掉了** ✗（官方《网格视窗控件》只写"列表项大小 ＋ 边距"✓
//        没提模板位置 ✓）⇒ ★ **但你这条实测把它救回来了** ✓✓
//     ⚠️ 而我早先的否证理由是"几何上也解释不了'上面还有内容'"✗ ——
//        ★ 那是因为我**假设**了原点在顶部 ✓ ⇒ ★ **假设错了，结论就错了** ✓
//
//   ⇒ ★ 修法 ✓：★ **把模板归零到 (0,0)** ✓
//     ★ 这是**只改一个值**的编辑 ✓（最安全那一档 ✓ 不加不删任何字段 ✓）
//     ★ 而且**可逆** ✓（原值记在下面 ✓）
//
//   ★ 原值备查 ✓：pos = **(-6, 212)**（x=-6 ✓ y=212 ✓）
//     ⇒ ★ 要回退就把这两个数写回去 ✓
//
// 用法：
//   node tools/gil/fix_clue_tpl_origin.mjs --in=<存档> --dump
//   node tools/gil/fix_clue_tpl_origin.mjs --in=<存档> --out=<输出> [--x=0 --y=0] [--tpl=clue]
//
// ★★ 验收（★ 这是判据，不是建议 ✓）：
//   node tools/gil/fix_clue_tpl_origin.mjs --in="290.gil" --out="295-模板clue归零-v149.gil"
//     → 必须打印 "✅ 模板 clue 位置 = (0, 0)"（★ 从磁盘重读 ✓）
//     → 且打印 "✅ ② 输出 ≠ 输入" / "✅ ⑤ 往返闸门" / "✅ ⑦ 字段级 diff：差异 2 处"
//   ★ 独立复核（两道外部闸门 ✓）：
//     node tools/gil/roundtrip.mjs "295-模板clue归零-v149.gil"      # 逐字节往返一致
//     node tools/gil/diff_fields.mjs "290.gil" "295-模板clue归零-v149.gil"   # 差异恰好 2 处
//
// ★★ 2026-10-10 事故与修复（★ 改这个文件前必读 ✓）：
//   ★ 本工具曾**连续两次**打印"✅ 成功"，而**输出与输入逐字节相同** ✗（等于什么都没写）
//   ★ 真因不在本文件，而在 `gilread.mjs` 的 `encodeMsg`：`#503` 被无条件当成
//     "裸 ID 子列表"⇒ 用旧 `payload` 快照、**不递归 `sub`** ✗ ⇒ 冻结 96% 的树 ✗
//     （`clue` 的位置对正好住在一个 `#503` 下面 ⇒ 修改被丢弃 ✓）
//   ★ 修法：① `encodeMsg` 按**类型定义**判定 `#503`；② wt1 保留原始 8 字节；
//           ③ ★ 本文件改成走 `writeGil()`（落盘→**重读磁盘**→往返→字段 diff 断言 ✓）
//   ⇒ ★★ 教训：★ **"内存改了"永远不能当验收** ✗ —— ★ 必须**从磁盘重读** ✓

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const P = (p) => (p == null ? null : (path.isAbsolute(p) ? p : path.resolve(ROOT, p)));

const IN = P(arg('in'));
const OUT = P(arg('out', arg('in')));
const DUMP = argv.includes('--dump');
const TPL = arg('tpl', 'clue');
const WANT_X = Number(arg('x', '0'));
const WANT_Y = Number(arg('y', '0'));
// ★★★ 2026-10-10 新增两个开关（★ lead 要求"4 块版的开关先备好" ✓）
//   `--states=first|all`  ：★ 只改第 1 个状态块（默认 ✓，与历史成功产物 `251` 同形 ✓）
//                           ★ 还是 4 个状态块全改 ✓
//   `--records=first|all` ：★ 只改第 1 个同名记录（默认 ✓）
//                           ★ 还是所有同名记录都改 ✓
//   ⇒ ★★ 为什么需要 `--records`（★ 2026-10-10 `inspect_gil.mjs` 实测发现 ✓）：
//     ★ `296` 里有 **两个** `clue` 记录 ✗：
//       · `#1073742421`（父 `1` = root ✓，★ 素材库模板 ✓）—— blk[0] 已归零 ✓、blk[1..3] **还是 (-6,212)** ✗
//       · `#1073742428`（父 `#1073741844` ✓）—— ★ **4 个块全都还是 (-6,212)** ✗
//     ⇒ ★ 若引擎用的是**后者**，那么只改前者的 blk[0] **当然看不出变化** ✗✓
//     ⇒ ★★ 所以"用户还是看到 −2"时，第一条命令就是：
//       `--states=all --records=all` ✓（★ 一条命令出全归零版 ✓）
const STATES = arg('states', 'first');
const RECORDS = arg('records', 'first');

if (!IN) { console.error('用法: node tools/gil/fix_clue_tpl_origin.mjs --in=<存档> [--out=<输出>] [--dump] [--states=first|all] [--records=first|all]'); process.exit(1); }
if (!['first', 'all'].includes(STATES)) { console.error('✗ --states 只能是 first 或 all'); process.exit(1); }
if (!['first', 'all'].includes(RECORDS)) { console.error('✗ --records 只能是 first 或 all'); process.exit(1); }

const g = readGil(IN);
console.log('存档：' + path.basename(IN) + '（记录 ' + g.recs.length + ' 条）');
console.log('开关：--states=' + STATES + '　--records=' + RECORDS);

const named = g.recs.filter((r) => r.name === TPL);
if (!named.length) { console.error('✗ 找不到模板 ' + TPL); process.exit(2); }
const tpls = RECORDS === 'all' ? named : [named[0]];
if (named.length > 1) {
  console.log('⚠️ 有 ' + named.length + ' 个同名记录 ' + TPL + '：'
    + named.map((r) => '#' + r.id + '(父' + r.parentId + ')').join('、')
    + (RECORDS === 'all' ? '　⇒ ★ 全部都要改 ✓' : '　⇒ ★ 只改第一个 ✗（要全改请加 --records=all ✓）'));
}

// 定位列表项模板的"位置"叶子：状态块里的 `#504`（x,y 一对）
const posPair = (rec) => {
  const o = []; stateBlocks(rec.field.sub, o);
  if (!o[0]) return null;
  return pairOf(o[0], 504);
};
const blocksOf = (rec) => { const o = []; stateBlocks(rec.field.sub, o); return o; };

// ── 收集"要改的目标"：每个记录 × 选中的状态块 ──────────────────────────────
const targets = [];
for (const rec of tpls) {
  const blks = blocksOf(rec);
  const want = STATES === 'all' ? blks.map((b, i) => [b, i]) : (blks[0] ? [[blks[0], 0]] : []);
  for (const [blk, i] of want) {
    const pair = pairOf(blk, 504);
    if (!pair) { console.error('✗ #' + rec.id + ' 的 blk[' + i + '] 里没有位置对 #504 ⇒ 拒绝写出（静默跳过是敌人 ✗）'); process.exit(2); }
    targets.push({ rec, blkIdx: i, pair, x0: pairValue(pair, 0), y0: pairValue(pair, 1) });
  }
}
if (!targets.length) { console.error('✗ 没有任何状态块可改'); process.exit(2); }

console.log('');
console.log('目标 ' + targets.length + ' 处（记录 × 状态块）：');
for (const t of targets) {
  console.log('  ' + TPL + ' #' + t.rec.id + '  blk[' + t.blkIdx + ']  现 (' + t.x0 + ', ' + t.y0 + ')'
    + ((t.x0 === WANT_X && t.y0 === WANT_Y) ? '  ← 已是目标值 ✓' : ''));
}

// 顺带把容器与网格的位置打出来，便于对照
for (const nm of ['clues', 'clues.grid']) {
  const r = g.recs.find((x) => x.name === nm);
  if (r === undefined) continue;
  const p = posPair(r);
  console.log('  ' + nm.padEnd(12) + ' 位置 = (' + (p ? pairValue(p, 0) : '?') + ', ' + (p ? pairValue(p, 1) : '?') + ')');
}

if (DUMP) { console.log('\n（--dump 模式，未写文件）'); process.exit(0); }

// ★ 只改值 ✓ —— 不加叶子、不删叶子 ✓（★ 与历史成功产物 `251` 的字节形态一致 ✓：显式写 0 ✓）
const setPair = (pair, x, y) => {
  if (pair === null) return false;
  let n = 0;
  for (const f of pair.sub || []) {
    if (f.field === 501 && f.wt === 5) { f.f = x; n++; }
    else if (f.field === 502 && f.wt === 5) { f.f = y; n++; }
  }
  return n >= 2;
};
let failed = 0;
for (const t of targets) {
  if (!setPair(t.pair, WANT_X, WANT_Y)) {
    console.error('✗ #' + t.rec.id + ' blk[' + t.blkIdx + '] 的位置对里没有 501/502 两个浮点 ⇒ 拒绝写出 ✗');
    failed++;
  }
}
console.log('\n写入 (' + WANT_X + ', ' + WANT_Y + ') ⇒ ' + (failed ? '失败 ✗' : '成功 ✓（' + targets.length + ' 处）'));
if (failed) { console.error('✗ 有目标结构不符，拒绝写出（静默跳过是敌人 ✗）'); process.exit(2); }

// ★★ 会变几个叶子：x/y 各自"真的变了"才算 1 个 ✓ —— ★ 用来断言"只改了这些" ✓
const nDiff = targets.reduce((s, t) => s + (t.x0 !== WANT_X ? 1 : 0) + (t.y0 !== WANT_Y ? 1 : 0), 0);
if (nDiff === 0) {
  console.log('\n★ 目标值已经是 (' + WANT_X + ', ' + WANT_Y + ')，无需改动 ✓（不写文件 ✓）');
  process.exit(0);
}
console.log('预计改动叶子 ' + nDiff + ' 个（每个状态块的 x/y 各算一个 ✓）');

// ★★★ 走唯一安全通道 ✓ —— ★ 落盘 → **从磁盘重读** → 往返闸门 → 字段级 diff 断言 ✓
//   ★ 为什么必须这样（2026-10-10 事故）：★ 旧版这里只 `fs.writeFileSync` + 打印"成功"✓，
//     而 `encodeMsg` 的 `#503` 冻结让它**逐字节没写进去** ✗ ⇒ ★ 报了两个月假成功 ✗
let rep;
try {
  rep = writeGil(g, OUT, {
    label: TPL + ' ×' + tpls.length + ' 记录 × ' + (STATES === 'all' ? '4' : '1') + ' 状态块 → (' + WANT_X + ', ' + WANT_Y + ')',
    expectDiffs: nDiff,          // ★ 只允许改动这几个叶子 —— 多一处就抛异常 ✓
    assert: (g2) => {            // ★ g2 是【从磁盘重读】的那份 ✓
      // ★ 逐个目标复读：★ 这也是"4 块版"的验收 —— 每一块都必须真的变成 (0,0) ✓
      const named2 = g2.recs.filter((r) => r.name === TPL);
      for (const t of targets) {
        const rec = named2.find((r) => r.id === t.rec.id);
        if (!rec) return '重读后找不到 #' + t.rec.id;
        const o = []; stateBlocks(rec.field.sub, o);
        const p = o[t.blkIdx] ? pairOf(o[t.blkIdx], 504) : null;
        const ax = pairValue(p, 0), ay = pairValue(p, 1);
        if (String(ax) !== String(WANT_X) || String(ay) !== String(WANT_Y)) {
          return '#' + t.rec.id + ' blk[' + t.blkIdx + '] 重读后 = (' + ax + ', ' + ay + ')，应为 (' + WANT_X + ', ' + WANT_Y + ')';
        }
      }
      return true;
    },
  });
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(3);
}

// ── 复读核对（★ 用 writeGil 重读磁盘的那一份，不是内存 ✗）──────────────────
const g2 = rep.g2;
console.log('\n── 复读核对（从磁盘重读 ✓，逐个目标）──');
for (const t of targets) {
  const rec = g2.recs.filter((r) => r.name === TPL).find((r) => r.id === t.rec.id);
  const o = []; stateBlocks(rec.field.sub, o);
  const p = o[t.blkIdx] ? pairOf(o[t.blkIdx], 504) : null;
  const ax = pairValue(p, 0), ay = pairValue(p, 1);
  const okOne = String(ax) === String(WANT_X) && String(ay) === String(WANT_Y);
  console.log('  ' + (okOne ? '✅' : '❌') + ' #' + t.rec.id + ' blk[' + t.blkIdx + '] = (' + ax + ', ' + ay + ')'
    + '　（原值 (' + t.x0 + ', ' + t.y0 + ')，要回退就写回它 ✓）');
}
console.log('  ✅ 其他字段**一个都没动** ✓ —— 字段级 diff 已断言差异恰好 ' + rep.diffs + ' 处 ✓');
console.log('\n★ 模板已归零 ✓ —— 请真机看"还从负数区开始填吗"');
console.log('★ 出货前建议再跑一次体检（只读 ✓，一眼看全 clue 的 4 个块 ✓）：');
console.log('    node tools/gil/inspect_gil.mjs ' + path.basename(OUT));
console.log('★ 要独立复核编码正确性：');
console.log('    node tools/gil/roundtrip.mjs ' + path.basename(OUT));
console.log('    node tools/gil/diff_fields.mjs ' + path.basename(IN) + ' ' + path.basename(OUT));
process.exit(0);
