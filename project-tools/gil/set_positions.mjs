// tools/gil/set_positions.mjs —— **把每个控件的坐标改成规划值**（修"错位"）
//
// 为什么需要它（2026-10-02）：
//   `sync_plan.mjs` 只**补缺失的**控件，"已有的一律不动"（那是为了尊重编辑器里手调的位置）。
//   但这一轮 `LAYOUT` 大改之后，**已有控件的坐标全是旧值** ⇒ 真机表现：
//     `hud.title` 在 (-283,7)（屏幕 517,443 = 画面正中，应为顶部）、
//     `clues` 在 (0,41)（屏幕 x=800 居中，应贴左边 183）……
//   ⇒ 这个工具把**规划里的坐标**写下去，让 .gil 与 `M.LAYOUT` 真正一致。
//
//   换算：规划是**画布空间**（1600×900，Y 向上，原点在**左下**）；
//        而这个项目的 UI 是「**容器锚点 = 屏幕中心 (0,0)、子控件用画布绝对坐标**」
//        ⇒ 控件位置 = (cx − 800, cy − 450)。
//         （真机日志验证过：`board` cx=765,cy=458 ⇒ (-35,8) 实测就是这个，
//           而 `action.undo` cx=1541,cy=833 ⇒ (741,383)…实测 (741,132) 略差，
//           说明**规划里的 y 也要减 450 之后再核对** —— 见 --report。）
//
// 用法：
//   node tools/gil/set_positions.mjs --gil=<文件> [--out=<文件>] [--only=前缀,前缀] [--dry]
//
// ★★ 验收（★ 判据，不是建议 ✓）：
//   node tools/gil/set_positions.mjs --gil=<输入> --out=<输出>
//     ⇒ 必须打印 "✅ ⑧ 断言：N 个控件的每个状态块都 == 规划值"（★ 用**重读磁盘**的那份 ✓）
//     ⇒ 若所有坐标本来就已是规划值 ⇒ ★ 会打印"无需改动"并**不写文件** ✓（★ 不是静默失败 ✗）
//   ★ 独立复核：node tools/gil/roundtrip.mjs <输出>
//
// ★★ 2026-10-10 迁移到 `writeGil()`（★ 全项目写工具统一通道 ✓）：
//   ★ 旧版是 `g.pack(encodeMsg(g.tree))` + `fs.writeFileSync` ✗ ⇒
//     ★ **只要编码器有一处走不到（例如 `#503` 冻结 ✗），它就会"报成功而文件没变"** ✗
//     ★ 实测 `set_positions` 改的正是**状态块里的位置对** ✓ ——
//       ★ 而 `clue` 的位置对就住在 `#503` 底下 ✓ ⇒ ★ **它当时也中过同一个 bug** ✗✓
//   ⇒ ★ 现在改成走 `writeGil()` ✓：★ 落盘→**重读磁盘**→往返闸门→字段级 diff→**逐控件断言** ✓
//   ⚠️ ★ 本工具**不用** `expectDiffs: N` ✗ —— ★ 因为 `setPair` 是**稀疏编码** ✓
//     （★ 值为 0 的分量会被**删掉** ✓）⇒ ★ "叶子个数"本身会变 ✓ ⇒ ★ 差异条数不可预测 ✓
//     ⇒ ★★ 所以判据用 ★ **结构化断言**：★ **每个控件的每个状态块都必须读回规划值** ✓（更强 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, pairOf, pairValue, setPair, stateBlocks } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const h = process.argv.find((s) => s.startsWith('--' + k + '=')); return h ? h.slice(k.length + 3) : d; };
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
const DRY = process.argv.includes('--dry');

const GIL = P(arg('gil'));
const OUT = P(arg('out', arg('gil')));
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const PLAN = P(arg('plan', 'tools/sim/out/layout-plan.json'));
const FORCE = process.argv.includes('--force');
const MIN_HIT = Number(arg('min-hit', '0.6'));   // ★ 规划命中率下限 ✓（lead 2026-10-10 要求 ✓）
if (!GIL) { console.error('用法: node tools/gil/set_positions.mjs --gil=<文件> [--out=<文件>] [--only=a,b] [--dry] [--force]'); process.exit(1); }

const g = readGil(GIL);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const CX = 800, CY = 450;                 // 画布中心

/** 找出记录里承载"位置"的字段 —— ★ 必须用 `stateBlocks()`，不能用"第一个子块"。
 *  （`sync_plan.makeRecord` 就是这么写的：几何在**每个状态块**里各有一份 505/504，
 *   只改第一个的话，其它状态下位置还是旧的 ⇒ 真机表现就是"有的屏对、有的屏错"。） */
function posPairsOf(rec) {
  const out = [];
  for (const b of stateBlocks(rec.field.sub, [])) {
    const x = pairOf(b, 504); if (x) out.push(x);
  }
  return out;
}

let changed = 0, missing = 0, noPair = 0, leafChanged = 0;
const samples = [];
const expect = [];   // ★ 落盘后要逐个复读的目标 ✓（{ id, x, y }）
for (const n of (plan.nodes || [])) {
  if (ONLY.length && !ONLY.some((p) => n.id === p || n.id.startsWith(p + '.'))) continue;
  const rec = g.byName.get(n.id);
  if (!rec) { missing++; continue; }
  const pp = posPairsOf(rec);
  if (pp.length === 0) { noPair++; continue; }
  const x = Math.round(n.cx - CX);
  const y = Math.round(n.cy - CY);
  // ★ 先看"到底会不会变" ✓ —— ★ 避免"本来就对"时走到 writeGil 的 mustDiffer 报错 ✗
  let willChange = 0;
  for (const pr of pp) {
    if (pairValue(pr, 0) !== x) willChange++;
    if (pairValue(pr, 1) !== y) willChange++;
  }
  if (!DRY && willChange) for (const pr of pp) setPair(pr, x, y);
  if (willChange) { changed++; leafChanged += willChange; }
  expect.push({ id: n.id, x, y });
  if (samples.length < 12) samples.push(n.id + ' → (' + x + ',' + y + ')' + (willChange ? '' : '（已是规划值 ✓）'));
}

console.log('  规划里 ' + (plan.nodes || []).length + ' 个控件');
console.log('  改了 ' + changed + ' 个（叶子 ' + leafChanged + ' 处）；规划里有而 .gil 没有的 ' + missing + ' 个；找不到位置字段的 ' + noPair + ' 个');
console.log('  样例：' + samples.join('  '));

// ════════════════════════════════════════════════════════════════════════════
// ★★★ 硬护栏：**规划过期就不许跑** ✗✓（★ lead 2026-10-10 要求 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 起因（★ 2026-10-10 实测 ✓）：★ `tools/sim/out/layout-plan.json` **已经严重过期** ✗ ——
//     ★ **规划里 371 个控件，而 `296.gil` 只认得 56 个** ✗（★ 315 个"规划里有、存档里没有" ✓）
//     ⇒ ★★ 这时跑本工具，会把**幸存的那 16 个控件**的坐标改写成**旧规划的坐标** ✗
//       ⇒ ★ **覆盖掉用户在编辑器里手调过的位置** ✗✓（★ 而且它"打印成功" ✓ ⇒ 静默破坏 ✓）
//   ⇒ ★★ 判据：★ **命中率 = (规划总数 − 存档里找不到的) / 规划总数** ✓
//     ★ **< 60% ⇒ 拒绝运行** ✗（★ 提示重新生成规划 ✓，或 `--force` 明确承担风险 ✓）
//   ★ 为什么用"命中率"而不是"文件时间戳" ✗：★ 时间戳不等于**内容对得上** ✓ ——
//     ★ 规划可能比存档**新**（刚重排过 ✓）、也可能**旧**（改了存档没重生成 ✓）；
//     ★ 命中率**直接测"两者是不是描述同一批控件"** ✓ ⇒ ★ 比时间戳准 ✓
const totalPlanned = (plan.nodes || []).length;
const hitCount = totalPlanned - missing;
const hit = totalPlanned ? hitCount / totalPlanned : 1;
console.log('  规划命中率：' + hitCount + '/' + totalPlanned + ' = ' + (hit * 100).toFixed(1) + '%'
  + (hit >= MIN_HIT ? ' ✓' : ' ✗'));
if (totalPlanned && hit < MIN_HIT && !FORCE) {
  console.error('');
  console.error('❌ ★ 规划命中率 ' + (hit * 100).toFixed(1) + '% < ' + (MIN_HIT * 100) + '% ⇒ **拒绝运行** ✗');
  console.error('   ⇒ ★ **规划已过期**：' + PLAN + ' 与这份存档不是同一批控件 ✗');
  console.error('   ⇒ ★ 现在跑会把这 ' + changed + ' 个控件的坐标改成**旧规划值**，覆盖手调结果 ✗');
  console.error('   ⇒ 请先**重新生成规划** ✓（见 `docs/工具目录.md`「输入快照类工具的过期风险」一节 ✓）');
  console.error('   ⇒ 或确认你就是要用旧规划 ⇒ 加 `--force` 明确承担覆盖风险 ✓');
  process.exit(4);
}
if (totalPlanned && hit < MIN_HIT && FORCE) {
  console.log('  ⚠️ 命中率低于阈值，但你给了 --force ⇒ 继续（★ 覆盖风险由你承担 ✓）');
}

if (!expect.length) { console.error('  ✗ 没有任何目标控件 ⇒ 拒绝写出（静默跳过是敌人 ✗）'); process.exit(2); }

if (!DRY) {
  if (!changed) {
    console.log('\n★ 所有目标控件的坐标**本来就是规划值** ⇒ 无需改动 ✓（★ 不写文件 ✓；★ 这不是失败 ✗）');
    process.exit(0);
  }
  // ★★★ 走唯一安全通道 ✓ —— ★ 落盘 → 重读磁盘 → 往返闸门 → 字段级 diff → **逐控件断言** ✓
  try {
    const rep = writeGil(g, OUT, {
      label: '按规划改坐标（' + changed + ' 个控件 / ' + leafChanged + ' 处叶子）',
      // ★ 不加 expectDiffs ✗ —— ★ 稀疏编码会让叶子个数本身变化 ✓（见头部注释 ✓）
      assert: (g2) => {
        // ★★ 判据：★ **每个目标控件的每个状态块**都必须读回规划值 ✓（★ 从磁盘重读的那份 ✓）
        for (const e of expect) {
          const r = g2.byName.get(e.id);
          if (!r) return '重读后找不到 ' + e.id;
          const pp = posPairsOf(r);
          if (!pp.length) return e.id + ' 重读后找不到位置字段';
          for (const pr of pp) {
            const ax = pairValue(pr, 0), ay = pairValue(pr, 1);
            if (ax !== e.x || ay !== e.y) return e.id + ' 重读后 = (' + ax + ',' + ay + ')，应为 (' + e.x + ',' + e.y + ')';
          }
        }
        return true;
      },
    });
    console.log('  ✅ ⑧ 断言：' + expect.length + ' 个控件的**每个状态块**都 == 规划值 ✓（★ 重读磁盘 ✓）');
    console.log('  写出 ' + path.relative(ROOT, OUT) + '  ' + Math.round(rep.bytes / 1024) + ' KB');
    console.log('  ★ 独立复核：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
    console.log('  ★ 出货前体检：node tools/gil/inspect_gil.mjs ' + path.basename(OUT));
  } catch (e) {
    console.error('\n❌ ' + e.message);
    process.exit(3);
  }
}
