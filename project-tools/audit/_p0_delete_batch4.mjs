#!/usr/bin/env node
// tools/audit/_p0_delete_batch4.mjs —— B 类探针清理：main.lua 的两块**未闸探针**
//
// 删的是：
//   ① 四键探针（`Murdoku.on_update` 里，每次会话最多打 12 次）
//   ② 射线落点探针（给容器绑光标监听，探"射线落在谁身上"）
//
// 判据（本轮真机日志直接给的，不需要再猜）：
//   · 射线探针：`root / home / stage / clues / topbar / toolbar / right / board.bg` 八个容器
//     **全部**打「找不到或不支持光标事件」——即它一个监听都没绑上，唯一产出就是 8 行噪声；
//   · 四键探针：它要查的「弹窗四键没图/没字」已经由 v262 结案（几何归编辑器 + 盒模型修正），
//     而且它自带 12 次上限；留着只会在弹窗打开时刷两行。
//
// 两个都**不在** `Murdoku.DIAG` 门内（审计 02 的 B-02 / B-03）⇒ 默认就在跑。
//
// ⚠️ 明确**不删** `diagnose_overlap`：`tests/overlap_diag_once.lua` 头注写着「用户当年为什么要它（★ 不能删 ✗）」，
//    而且它自己有专门回归 ⇒ 属"误报回收"，不是 B 类。
//
// 用法：node tools/audit/_p0_delete_batch4.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = path.join(ROOT, 'lua', 'main.lua');
const APPLY = process.argv.includes('--apply');

const raw = fs.readFileSync(MAIN, 'utf8');
const CRLF = (raw.match(/\r\n/g) || []).length > (raw.match(/(?<!\r)\n/g) || []).length;
const eol = CRLF ? '\r\n' : '\n';
let src = raw.replace(/\r\n/g, '\n');

const cuts = [
  {
    tag: '① 四键探针（on_update 内，未闸）',
    start: '  -- ★★★★★ 2026-10-08 **四键探针（真·每帧入口 ＋ adapter 在手 ✓）** ✗✓',
    until: '  current.adapter:on_tick(dt)',
    repl: [
      '  -- ★ 2026-10-18（优化组 · B 类清理）：**四键探针整段删除** ✗✓',
      '  --   它要查的「弹窗四键没图 / 没字」已由 v262 结案（几何归编辑器 + 盒模型修正 + `label` 防裁），',
      '  --   而它**不在 `Murdoku.DIAG` 门内** ⇒ 默认就在跑（每次会话最多 12 次刷两行）。',
      '  --   判据：真机日志里它只在"弹窗打开后"产出；那两行信息（bg/label 的 GetSiblingIndex）',
      '  --     现在也能用 `tools/gil/_probe_state.mjs` 从存档侧直接读，不必挂在每帧路径上。',
      '',
    ].join('\n'),
  },
  {
    tag: '② 射线落点探针（on_start 内，未闸）',
    start: '  -- ★★★★ 2026-10-01 **射线落点探针**：给几个"容器/弹窗"也绑上点击。',
    until: '  -- ★★★★ 2026-10-02 **按用户建议做的对比：主页 ⇄ 选关，"切换后到底改了什么"**。',
    repl: [
      '  -- ★ 2026-10-18（优化组 · B 类清理）：**射线落点探针整段删除** ✗✓',
      '  --   判据（真机日志 2026-10-18 v271，一次会话）：`root / home / stage / clues / topbar /',
      '  --     toolbar / right / board.bg` **八个容器全部**打「找不到或不支持光标事件」⇒',
      '  --     它一个监听都没绑上，唯一产出就是 8 行噪声 + 一句"装好了"。',
      '  --   它的历史使命（"没日志不能区分射线被吃 / 落在没事件的控件上"）已由后来的',
      '  --   `raycastTarget` 普查 + 盒模型修正覆盖 ✓',
      '',
    ].join('\n'),
  },
];

// 预检：两个锚点各恰好 1 次，且 until 出现在 start 之后
let bad = 0;
for (const c of cuts) {
  const nStart = src.split(c.start).length - 1;
  const s = src.indexOf(c.start);
  const t = src.indexOf(c.until, s + 1);
  const ok = nStart === 1 && s >= 0 && t > s;
  const spanLines = ok ? src.slice(s, t).split('\n').length : 0;
  console.log(`[${ok ? 'OK' : '✗'}] ${c.tag}　命中 ${nStart} 次　跨度 ${spanLines} 行`);
  if (!ok) bad++;
  c._s = s; c._t = t;
}
if (bad) { console.error('\n✗ 锚点不成立 ⇒ 一个字节都不写'); process.exit(1); }

// 倒序切（同一文件内互不影响）
for (const c of cuts.slice().sort((a, b) => b._s - a._s)) {
  src = src.slice(0, c._s) + c.repl + src.slice(c._t);
}
const before = raw.split('\n').length, after = src.split('\n').length;
console.log(`\nmain.lua：${before} → ${after} 行（${after - before}）`);

if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }

fs.writeFileSync(MAIN, eol === '\r\n' ? src.replace(/\n/g, '\r\n') : src, 'utf8');

// 写后重读核对
const back = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');
const codeLines = back.split('\n').filter((l) => !l.trim().startsWith('--'));
const checks = [
  ['无「射线探针：」打印', !codeLines.some((l) => l.includes('射线探针：'))],
  ['无「四键探针2/3」打印', !codeLines.some((l) => l.includes('四键探针'))],
  ['无 `_ray_probe_done` 的读写', !codeLines.some((l) => l.includes('_ray_probe_done'))],
  ['`on_tick(dt)` 仍在（on_update 主干没被切坏）', codeLines.some((l) => l.includes('current.adapter:on_tick(dt)'))],
  ['`diagnose_overlap` 调用点仍在（本批明确保留）', codeLines.some((l) => l.includes('diagnose_overlap'))],
  ['行数对得上', back.split('\n').length === after],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
