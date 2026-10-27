#!/usr/bin/env node
// tools/audit/_p0_delete_batch5.mjs —— 教程（intro）整套移除
//
// 用户 2026-10-18 指令：「老计划里到目前还没实现的都不需要保留了，**教程后续也要重做，而且那部分应该还没接**」
//
// 本批只做**教程**这一族（`intro` / `intro.dots` / `intro.title` / `intro.body` / `intro.skip` / `intro.next`
// 在 `check_names` 里是 6 个「🔴 真缺」，即**从来没建过**；而 `M.INTRO` 的 5 页文案仍每帧参与布局判断）。
//
// 留到下一批的（还没动）：`toolbar` / `left` / `tray` / `legend` / `board` / `select` 容器、
// `room.label.*`、`clues.bar/up/down/track/knob/count/more`、`apply_tray_layout` 110 行。
//
// 用法：node tools/audit/_p0_delete_batch5.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const UI = path.join(ROOT, 'lua', 'ui_controller.lua');
const AD = path.join(ROOT, 'lua', 'engine_adapter_qianxing.lua');

const EOL = {};
function readNorm(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/(?<!\r)\n/g) || []).length;
  EOL[p] = crlf > lf ? '\r\n' : '\n';
  return raw.replace(/\r\n/g, '\n');
}
function writeBack(p, text) {
  fs.writeFileSync(p, EOL[p] === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
}

const files = { [UI]: readNorm(UI), [AD]: readNorm(AD) };

/** range 型：[start, until) 整段换掉；line 型：整行换掉 */
const CUTS = [
  { f: UI, tag: 'M.INTRO 5 页文案表',
    start: '-- 开屏教程（5 页：怎么破案 / 每行每列一人 / beside 的含义 / 单击双击的区别 / 提交判题）',
    until: 'local Controller = {}',
    repl: [
      '-- ★ 2026-10-18（优化组 · C 类清理）：**开屏教程（`M.INTRO` 5 页）整套删除** ✗✓',
      '--   用户原话：「老计划里到目前还没实现的都不需要保留了，**教程后续也要重做，而且那部分应该还没接**」',
      '--   判据：`intro` / `intro.dots` / `intro.title` / `intro.body` / `intro.skip` / `intro.next`',
      '--     在 `check_names` 里是 **6 个 🔴 真缺**（从来没人建成过）⇒ 每帧都在算一段永远显示不出来的布局。',
      '--   ⇒ 教程以后**重做**，届时另立新控件位；**别**复活 `intro.*` 这套名字 ✓',
      '',
      '---------------------------------------------------------------------------',
      '',
    ].join('\n') },
  { f: UI, tag: 'self.intro_page 初始化', line: '  self.intro_page = opts.skip_intro and (#M.INTRO + 1) or 1', repl: '' },
  { f: UI, tag: 'intro_next / intro_skip 两个动作分支',
    start: '  elseif a == "intro_next" then',
    until: '  elseif a == "close_modal" then',
    repl: '' },
  { f: UI, tag: 'Controller:is_intro_active()', line: 'function Controller:is_intro_active() return (self.intro_page or 1) <= #M.INTRO end', repl: '' },
  { f: UI, tag: '3044 行的 intro 判据',
    line: '    if inWin and not self._clue_fx[i] and not self:is_intro_active() and self.modal == nil then',
    repl: '    if inWin and not self._clue_fx[i] and self.modal == nil then' },
  { f: UI, tag: 'intro 的 6 个 push/btn（面板 + 页码 + 标题 + 正文 + 跳过 + 下一页）',
    start: '  -- ===== 开屏教程 =====',
    until: '  -- ===== 弹窗 =====',
    repl: [
      '  -- ★ 2026-10-18（优化组 · C 类清理）：**教程面板的 6 个控件声明整段删除** ✗✓',
      '  --   （`intro` / `intro.dots` / `intro.title` / `intro.body` / `intro.skip` / `intro.next` 全部）',
      '  --   ⇒ 规划里不再出现这 6 个名字 ⇒ `report_missing` 与 `check_names` 都少 6 项噪声 ✓',
      '',
    ].join('\n') },
  { f: UI, tag: 'modal 的 intro 判据', line: '  if modal and not self:is_intro_active() then', repl: '  if modal then' },
  { f: UI, tag: 'states 里那条 intro 状态', line: '    { name = "intro",             intro = 1,  modal = nil, screen = nil },', repl: '' },
  { f: UI, tag: '4696 行的 intro 状态判据',
    line: '      if it.states[k] == "board" or it.states[k] == "intro" or it.states[k] == "result"',
    repl: '      if it.states[k] == "board" or it.states[k] == "result"' },
  { f: AD, tag: 'KNOWN_ABSENT 的 intro.* 分组正则', line: '  if s:match("^intro%.")              then return "intro.*" end', repl: '' },
  { f: AD, tag: '光标容器名单里的 "intro"（两处同形，一并替换）', line: '"right", "actions", "modal", "intro",', repl: '"right", "actions", "modal",', all: true },
  { f: AD, tag: '头像卡体检名单里的 "intro.next"', line: '                   "intro.next", "modal.suspect.A" }', repl: '                   "modal.suspect.A" }' },
];

// ── 预检 ──
let bad = 0;
for (const c of CUTS) {
  const src = files[c.f];
  if (c.line != null) {
    const n = src.split(c.line).length - 1;
    const ok = c.all ? n >= 1 : n === 1;      // ★ all=true ⇒ 允许同形多处，一次全替换
    console.log(`[${ok ? 'OK' : '✗'}] ${path.basename(c.f)} · ${c.tag}　整行命中 ${n} 次`);
    if (!ok) bad++;
    c._span = ok ? [src.indexOf(c.line), src.indexOf(c.line) + c.line.length] : null;
  } else {
    const n = src.split(c.start).length - 1;
    const s = src.indexOf(c.start), t = src.indexOf(c.until, s + 1);
    const ok = n === 1 && s >= 0 && t > s;
    console.log(`[${ok ? 'OK' : '✗'}] ${path.basename(c.f)} · ${c.tag}　命中 ${n} 次　跨度 ${ok ? src.slice(s, t).split('\n').length : 0} 行`);
    if (!ok) bad++;
    c._span = ok ? [s, t] : null;
  }
}
if (bad) { console.error(`\n✗ 有 ${bad} 条锚点不成立 ⇒ 一个字节都不写`); process.exit(1); }

// ── 倒序应用 ──
const before = {};
for (const f of [UI, AD]) {
  before[f] = files[f].split('\n').length;
  const list = CUTS.filter((c) => c.f === f).sort((a, b) => b._span[0] - a._span[0]);
  let src = files[f];
  for (const c of list) {
    if (c.all) { src = src.split(c.line).join(c.repl); continue; }   // ★ 同形多处一次全替换
    src = src.slice(0, c._span[0]) + c.repl + src.slice(c._span[1]);
  }
  files[f] = src;
}
for (const f of [UI, AD]) console.log(`${path.basename(f)}：${before[f]} → ${files[f].split('\n').length} 行`);

if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }

writeBack(UI, files[UI]);
writeBack(AD, files[AD]);

// ── 写后重读核对 ──
const ui = fs.readFileSync(UI, 'utf8').replace(/\r\n/g, '\n');
const ad = fs.readFileSync(AD, 'utf8').replace(/\r\n/g, '\n');
const codeLines = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const checks = [
  ['ui: 无 `M.INTRO`', !codeLines(ui).some((l) => l.includes('M.INTRO'))],
  ['ui: 无 `is_intro_active`', !codeLines(ui).some((l) => l.includes('is_intro_active'))],
  ['ui: 无 `intro_page`', !codeLines(ui).some((l) => l.includes('intro_page'))],
  ['ui: 无 `id = "intro` 的声明', !codeLines(ui).some((l) => l.includes('id = "intro'))],
  ['ui: 无 `intro_skip|intro_next` 动作', !codeLines(ui).some((l) => /intro_(skip|next)/.test(l))],
  ['adapter: 无 intro 相关行', !codeLines(ad).some((l) => l.includes('intro'))],
  ['ui: modal 判据已简化', codeLines(ui).some((l) => l.trim() === 'if modal then')],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
