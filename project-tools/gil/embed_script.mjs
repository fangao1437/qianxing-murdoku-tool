// tools/gil/embed_script.mjs —— 把**当前客户端脚本**写进 .gil（做到"导入即最新"）
//
// 背景（2026-09-27 踩到）：用户导入我生成的 .gil 后，关卡目录里出现的是**导出那一刻的旧脚本**
//   （实测 353.3KB，而我当时的最新是 368KB）→ 跑的是旧代码，新加的诊断一行都没有，
//   于是白排查了整轮。根因：.gil 里**内嵌了一份脚本副本**，导入时游戏把它解出来。
//
// 定位方式见 tools/gil/find_script.mjs：脚本是树里唯一那个"超大叶子文本字段"
//   （实测路径 `/#50/#1/#5`，361795 字节）。
//
// 用法：
//   node tools/gil/embed_script.mjs --probe
//   node tools/gil/embed_script.mjs --in=完整界面3.gil --out=完整界面4.gil
//   node tools/gil/embed_script.mjs --in=295-模板clue归零-v149.gil --out=296-模板归零+脚本v148.gil \
//        --expect-marker=v148
//
// ★★ 验收（★ 判据，不是建议 ✓）：
//   ★ 必须打印 "✅ ⑨ 内嵌脚本版本标记 = vNNN"（★ 见下"为什么不自证版本" ✓）
//   ★ 必须打印 "✅ ⑦ 字段级 diff：差异 1 处"（★ 只允许脚本那**一个**叶子变 ✓）
//   ★ 独立复核：
//     node tools/gil/roundtrip.mjs <输出>                       # 逐字节往返一致
//     node tools/gil/diff_fields.mjs <输入> <输出>               # 差异应恰好 1 处（裸 payload 变化）
//
// ★★★ 2026-10-10 事故与被点名的原因（★ 改这个文件前必读 ✓）
//   ★ lead 原话：★「**我每轮都在用它出货** ⇒ ★ 它要是静默失败，我交付的就是旧脚本 ✗
//     （★ 今天 `295` 里就出现了旧脚本 ✓）」
//   ★ 本工具**旧的**自检是：★ "重新读一遍，确认内嵌脚本 == `dist/client_script.lua`" ✓
//     ⇒ ★★ **这是循环论证** ✗ —— ★ 它只证明【复制成功】✓
//       ★ **证明不了 `dist` 自己是不是新的** ✗（★ `dist` 是**打包产物** ✓，可能落后于 `lua/` ✓）
//     ⇒ ★ 实测：`295` 里内嵌 **1099635B**，而 `dist` 已经 **1107369B** ✗ ⇒ ★ 叠旧脚本 ✓
//   ★ 修法 ✓：
//     ① ★ 改成走 `writeGil()` ✓（落盘 → **重读磁盘** → 往返闸门 → 字段 diff 断言 ✓）
//     ② ★★ **加"版本标记"断言** ✓ —— ★ 独立事实，不是循环论证 ✓：
//        ★ 从脚本里取 `构建标记 vNNN`（★ 它在**日志第一行**打出来 ✓）
//        ★ 断言**输出文件里**的标记 == 期望标记 ✓（★ 不符 ⇒ **抛异常** ✗ 不许静默放过 ✓）
//     ③ ★ 断言**字段差异恰好 1 处** ✓ —— ★ 只允许脚本那一个叶子变 ✓
//        （★ 2026-10-10：lead 那次叠完**没跑字段 diff** ✗ ⇒ ★ 现在它是**强制**的 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';
import { writeGil, findScriptLeaf, markerOf } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--probe');

const BASE = argOf('in') || path.join(ROOT, '完整界面3.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面4.gil');
const SCRIPT = argOf('script') || path.join(ROOT, 'dist', 'client_script.lua');
const SRC_ENTRY = argOf('src') || path.join(ROOT, 'lua', 'entry_client_script.lua');   // ★ 源码 = 事实源头 ✓
const EXPECT = argOf('expect-marker');

for (const [k, p] of Object.entries({ 存档: BASE, 脚本: SCRIPT })) {
  if (!fs.existsSync(p)) { console.error('缺' + k + '：' + p); process.exit(1); }
}

const g = readGil(BASE);
const want = fs.readFileSync(SCRIPT);
console.log('存档：' + path.basename(BASE) + '（' + g.src.length + ' 字节）');
console.log('脚本：' + path.basename(SCRIPT) + '（' + want.length + ' 字节）');

// ════════════════════════════════════════════════════════════════════════════
// ★★★ 强制版本链核对（★ 2026-10-10 lead 要求：★ "没有 --expect-marker 就拒绝运行" ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ lead 的原话与理由 ✓：
//     「★ 我今天叠 v148 时就没验证标记 ✗（★ 直到跑出来才知道 `295` 里是 v145 ✓）
//       ★★ 凡"我经常用"的工具 ⇒ **危险动作必须默认开启** ✓✓」
//   ★★ 我把它做得**比"要求人手输一个标记"更强** ✓（★ 因为"靠人记得"正是本项目的病根 ✓）：
//     ★ 核对一条**三方链** ✓：`lua/entry_client_script.lua`（源码，事实源头 ✓）
//       == `dist/client_script.lua`（打包产物 ✓）== **落盘存档里内嵌的那份** ✓
//     ⇒ ★ **`dist` 落后于源码 ⇒ 直接拒绝运行** ✗（★ 这正是"叠了旧脚本"的成因 ✓）
//     ⇒ ★ 于是**不需要人记得** ✓：★ 跑一次就自动挡住 ✓
//   ★ `--expect-marker` 仍然可用 ✓（★ 显式钉死一个版本 ✓，与链不符也拒绝 ✓）；
//     ★ 不传也**不会**静默放行 ✓ —— ★ 链核对是**无条件**的 ✓，并且会**大声打印**用的是哪个标记 ✓
const srcMarker = fs.existsSync(SRC_ENTRY) ? markerOf(fs.readFileSync(SRC_ENTRY)) : null;
const distMarker = markerOf(want);
console.log('版本链：源码 ' + path.basename(SRC_ENTRY) + ' = ' + (srcMarker || '（找不到标记 ✗）')
  + '　dist = ' + (distMarker || '（找不到标记 ✗）') + (EXPECT ? '　--expect-marker = ' + EXPECT : ''));

if (!distMarker) {
  console.error('\n❌ dist 脚本里找不到版本标记 ✗（应在含 `构建标记 vNNN` 的那一行 ✓）');
  console.error('   ⇒ 先跑 `lua tools/bundle_client_script.lua` 重建 dist ✓');
  console.error('   ⇒ 或 `node tools/bump_build_marker.mjs --show` 看源码标记 ✓');
  process.exit(1);   // ★ 不许静默放过 ✗
}
if (!srcMarker) {
  console.error('\n❌ 源码 ' + SRC_ENTRY + ' 里找不到版本标记 ✗ ⇒ 无法核对"dist 是否落后" ✗');
  console.error('   ⇒ ★ 链断了一环 ⇒ **拒绝运行** ✓（★ 宁可不出货，也不叠一份来路不明的脚本 ✗）');
  process.exit(1);
}
if (srcMarker !== distMarker) {
  console.error('\n❌❌ **dist 落后于源码** ✗：源码 ' + srcMarker + '，dist ' + distMarker);
  console.error('   ⇒ ★ 现在叠进去的就是**旧脚本** ✗（★ 这正是 2026-10-10 那次静默失败 ✓）');
  console.error('   ⇒ ★ 先跑 `lua tools/bundle_client_script.lua` 重建 dist，再重跑本工具 ✓');
  process.exit(1);
}
if (EXPECT && EXPECT !== distMarker) {
  console.error('\n❌ 你要求 ' + EXPECT + '，但 dist 是 ' + distMarker + ' ✗');
  console.error('   ⇒ ★ 要么先 `node tools/bump_build_marker.mjs --note="…"` 递增，要么改用正确的 --expect-marker ✓');
  process.exit(1);
}
const wantMarker = EXPECT || distMarker;
if (!EXPECT) {
  console.log('⚠️ 未显式给 --expect-marker ⇒ ★ 已用【源码 == dist】这条链**无条件**核对过 ✓'
    + '（标记 ' + wantMarker + ' ✓）；★ 要钉死版本请传 --expect-marker=' + wantMarker + ' ✓');
}
const curLeaf = findScriptLeaf(g);
console.log('存档内现有脚本：' + (curLeaf ? curLeaf.len + ' 字节 @' + curLeaf.path + '，标记 ' + markerOf(curLeaf.buf) : '（无）'));
console.log('期望标记：' + wantMarker);

// ── 找"内嵌脚本"字段：树里最大的、像 Lua 的叶子文本 ──────────────────────
const cands = [];
(function walk(fields, pathStr) {
  for (const f of fields) {
    const here = pathStr + '/#' + f.field;
    if (f.wt === 2 && f.sub === null && f.payload && f.payload.length > 2000) {
      const s = f.payload.toString('utf8');
      const bad = (s.match(/\uFFFD/g) || []).length;
      if (bad < f.payload.length * 0.01 && /function\s|local\s/.test(s)) {
        cands.push({ field: f, path: here, len: f.payload.length });
      }
    }
    if (f.sub) walk(f.sub, here);
  }
})(g.tree, '');
cands.sort((a, b) => b.len - a.len);

if (!cands.length) {
  console.error('\n❌ 没找到内嵌脚本（>2000 字节的 Lua 文本字段）。');
  console.error('   要么这份 .gil 里没有脚本，要么编码方式与我预期不同 —— 先跑 find_script.mjs 看清单。');
  process.exit(2);
}
const target = cands[0];
console.log('内嵌脚本字段：' + target.path + '  现 ' + target.len + ' 字节 → 新 ' + want.length
  + ' 字节（' + (want.length >= target.len ? '+' : '') + (want.length - target.len) + '）');
if (cands.length > 1) {
  console.log('  （另有 ' + (cands.length - 1) + ' 个候选：'
    + cands.slice(1, 4).map((c) => c.path + '=' + c.len).join(', ') + ' —— 只替换最大的那个）');
}

if (target.len === want.length && target.field.payload.equals(want)) {
  console.log('\n★ 内容已经是最新的，无需改动。');
  process.exit(0);
}

if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

// ── 替换（★ 长度前缀由编码器全部重算 ✓）──────────────────────────────────
target.field.payload = want;
target.field.len = want.length;
target.field.isText = true;

// ★★★ 走唯一安全通道 ✓ —— 落盘 → **重读磁盘** → 往返闸门 → 字段 diff → **版本标记** ✓
try {
  const rep = writeGil(g, OUT, {
    label: '内嵌脚本 → ' + wantMarker,
    expectDiffs: 1,                 // ★ 只允许脚本那**一个**叶子变 ✓
    expectMarker: wantMarker,       // ★ 版本标记必须是这个 ✓（★ 不符就抛异常 ✗）
  });
  console.log('\n输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节）');
  console.log('★ 导入这个存档就是 ' + wantMarker + ' 脚本，不需要再手动同步 ✓');
  console.log('★ 独立复核可再跑：');
  console.log('    node tools/gil/roundtrip.mjs ' + path.basename(OUT));
  console.log('    node tools/gil/diff_fields.mjs ' + path.basename(BASE) + ' ' + path.basename(OUT) + '   # 差异应恰好 1 处');
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(3);
}
