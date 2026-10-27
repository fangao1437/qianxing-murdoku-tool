// tools/lua_blocks.mjs —— Lua 的**块配对分析**（★ 只读 ✓ 删大段之前的必备信息 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么需要它（2026-10-10 立 ✓ 血泪 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 事故 ✅：★ 连删两次一大段，**两次 `luac -p` 都报"少一个 `end`"** ✗✓
//     ★ 第 2 次甚至**逐条边界校验都过了** ✓ —— ★ 因为"下一行是 `local X = …`"这种
//       **视觉判据分不清"这里是块尾"还是"这里只是缩进变了"** ✗
//   ⇒ ★★ 真问题：★ **"看着像一段" ≠ "它是一个自洽的块"** ✗ ——
//     ★ 一段代码能不能整体删掉，判据是 ★ **它的净深度变化是否为 0** ✓✓
//   ⇒ ★★★ 本工具就干这一件事 ✓：★ **数深度** ✓ ⇒ ★ **删之前先知道该删到哪一行** ✓
//
//   ⚠️⚠️ ★ 关键难点（★ 必须做对 ✓）：★ **注释和字符串里的 `do`/`end`/`if` 全是噪音** ✗
//     ★ 本工程的注释里**大量**出现这些字样 ✓（★ 实测：`-- ★ 想恢复 ✗：把 _pal_disabled 改成 false`
//       里就有 `false`… 而 `--   ★ 不动 _pal_cache ✓` 里有 `do`? 不 ✓ —— 但 `-- do` 这种一定有 ✓）
//     ⇒ ★★ 所以**必须先剥注释与字符串** ✓，★ 否则深度就是错的 ✓（★ 那比"不知道"更坏 ✗）
//
//   ★★ 自检（★ 这是本工具可信的唯一理由 ✓）：★ **全文扫完，深度必须回到 0** ✓
//     ★ 回不到 0 ⇒ ★ **分析器本身错了** ✗ ⇒ ★ 它**不会**给你任何结论 ✓（★ 直接报错退出 ✓）
//
// 用法：
//   node tools/lua_blocks.mjs lua/ui_controller.lua --around=5300      # 看 L5300 那个块配到哪
//   node tools/lua_blocks.mjs lua/ui_controller.lua --range=5288-5530  # 逐行块清单（带深度）
//   node tools/lua_blocks.mjs lua/ui_controller.lua --selfcontained=5293-5513  # 该区间的净变化
//   node tools/lua_blocks.mjs lua/ui_controller.lua --range=5288-5530 --json

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const argVal = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const file = argv.find((s) => !s.startsWith('--')) || 'lua/ui_controller.lua';
const around = argVal('around') ? Number(argVal('around')) : null;
const rangeArg = argVal('range');
const scArg = argVal('selfcontained');

const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(abs)) { console.error('读不到：' + abs); process.exit(2); }
const src = fs.readFileSync(abs, 'utf8');
const srcLines = src.split(/\r?\n/);

// ── 剥注释与字符串（★ 跨行状态机 ✓ 这是全工具正确性的根 ✓）────────────────
//   ★ 返回逐行的"纯代码"文本 ✓ —— ★ 长注释/长字符串会跨行 ✓ ⇒ 必须带状态 ✓
function stripAll(lines) {
  const out = [];
  let state = 'code';           // code | sline_comment | long_comment | str | long_str
  let strCh = null, longEq = 0;
  for (const ln of lines) {
    let res = '', i = 0;
    while (i < ln.length) {
      if (state === 'code') {
        // 长注释 --[[ / --[==[
        if (ln[i] === '-' && ln[i + 1] === '-') {
          let j = i + 2, eq = 0;
          if (ln[j] === '[') { let k = j + 1; while (ln[k] === '=') { eq++; k++; } if (ln[k] === '[') { state = 'long_comment'; longEq = eq; i = k + 1; continue; } }
          state = 'sline_comment'; i = ln.length; continue;
        }
        // 长字符串 [[ / [==[
        if (ln[i] === '[') {
          let k = i + 1, eq = 0; while (ln[k] === '=') { eq++; k++; }
          if (ln[k] === '[') { state = 'long_str'; longEq = eq; i = k + 1; res += ' '; continue; }
        }
        if (ln[i] === '"' || ln[i] === "'") { state = 'str'; strCh = ln[i]; i++; res += ' '; continue; }
        res += ln[i]; i++; continue;
      }
      if (state === 'sline_comment') { i = ln.length; continue; }
      if (state === 'str') {
        if (ln[i] === '\\') { i += 2; continue; }
        if (ln[i] === strCh) { state = 'code'; i++; res += ' '; continue; }
        i++; continue;
      }
      if (state === 'long_comment' || state === 'long_str') {
        // 找 ]==]
        if (ln[i] === ']') {
          let k = i + 1, eq = 0; while (ln[k] === '=') { eq++; k++; }
          if (eq === longEq && ln[k] === ']') {
            const wasStr = state === 'long_str';
            state = 'code'; i = k + 1; if (wasStr) res += ' '; continue;
          }
        }
        i++; continue;
      }
    }
    if (state === 'sline_comment') state = 'code';   // 行注释到行尾就结束 ✓
    out.push(res);
  }
  return out;
}

const codeLines = stripAll(srcLines);

// ── 数深度（★ 逐 token ✓）────────────────────────────────────────────────
//   ★ 开：function / if / for / while / do / repeat ✓
//   ★ 关：end（关 function/if/for/while/do ✓）／ until（关 repeat ✓）
//   ★ 不变：then / else / elseif ✓
//   ⚠️ ★ `for … do` 与 `while … do` 是【一个】块 ✓ ⇒ ★ 那个 `do` 不能再 +1 ✗
//     ⇒ ★ 用一个"待配对的循环 do"计数器 ✓
const KW_OPEN = /\b(function|if|for|while|repeat)\b/g;
const DO = /\bdo\b/g;
const END = /\bend\b/g;
const UNTIL = /\buntil\b/g;

let depth = 0;
const stack = [];          // {kind, line}
const perLine = [];        // {line, text, openers:[{kind}], closers:[{kind, openedAt}], depthAfter}
let pendingLoopDo = 0;
let analyzerBroken = null;

function scanLine(text, lineNo) {
  const openers = [], closers = [];
  // 用位置排序统一处理，避免顺序错乱 ✓
  const ev = [];
  let m;
  KW_OPEN.lastIndex = 0;
  while ((m = KW_OPEN.exec(text))) {
    const kw = m[1];
    if (kw === 'if' && /\belseif\b/.test(text.slice(Math.max(0, m.index - 6), m.index + 2))) continue;
    ev.push({ at: m.index, kind: 'open', kw });
  }
  DO.lastIndex = 0;
  while ((m = DO.exec(text))) ev.push({ at: m.index, kind: 'do' });
  END.lastIndex = 0;
  while ((m = END.exec(text))) ev.push({ at: m.index, kind: 'close', kw: 'end' });
  UNTIL.lastIndex = 0;
  while ((m = UNTIL.exec(text))) ev.push({ at: m.index, kind: 'close', kw: 'until' });
  ev.sort((a, b) => a.at - b.at);
  for (const e of ev) {
    if (e.kind === 'open') {
      depth++;
      if (e.kw === 'for' || e.kw === 'while') pendingLoopDo++;
      stack.push({ kind: e.kw, line: lineNo });     // ★ 必须记【行号】✓ —— 否则配对查不到 ✗
      openers.push(e.kw);
    } else if (e.kind === 'do') {
      if (pendingLoopDo > 0) { pendingLoopDo--; }        // ★ 属于 for/while 的 do ✓ 不再 +1 ✓
      else { depth++; stack.push({ kind: 'do', line: lineNo }); openers.push('do'); }
    } else {
      depth--;
      const top = stack.pop();
      closers.push({ kw: e.kw, openedAt: top ? top.line : null, openedKind: top ? top.kind : null });
      if (depth < 0 && !analyzerBroken) analyzerBroken = '深度变负（关多于开）';
    }
  }
  return { openers, closers };
}

srcLines.forEach((raw, i) => {
  const text = codeLines[i];
  const r = scanLine(text, i + 1);
  perLine.push({ line: i + 1, raw: raw.trim(), openers: r.openers, closers: r.closers, depthAfter: depth });
});

const out = [];
const say = (s) => out.push(s);
say('文件：' + path.relative(ROOT, abs).replace(/\\/g, '/') + '（' + srcLines.length + ' 行）');
say('');
say('── ★ 自检（★ 本工具可信的唯一理由 ✓）──');
if (depth === 0 && !analyzerBroken) {
  say('  ✅ 全文扫完深度回到 **0** ✓ ⇒ ★ 剥注释/字符串正确 ✓，块配对可信 ✓');
} else {
  say('  ❌ ★ **全文扫完深度 = ' + depth + '（应为 0）** ✗' + (analyzerBroken ? '／' + analyzerBroken : ''));
  say('     ⇒ ★★ **分析器本身不可信** ✗ ⇒ ★ **本工具不输出任何结论** ✓（★ 免得给你错的行号 ✗）');
  console.log(out.join('\n'));
  process.exit(5);
}

// ★ 每个开块的配对行：从 closers 里回填 ✓
const closerOf = new Map();     // openerLine -> closerLine
for (const p of perLine) for (const c of p.closers) if (c.openedAt) closerOf.set(c.openedAt, p.line);

// ── ① --around ────────────────────────────────────────────────────────────
if (around != null) {
  const p = perLine.find((x) => x.line === around);
  say('');
  say('── ① L' + around + ' 的块配对 ──');
  if (!p) say('  （越界）');
  else {
    say('  L' + around + '：' + (p.raw.slice(0, 78) || '（空行/注释）'));
    say('  开：' + (p.openers.join(', ') || '（无）') + '　关：' + (p.closers.map((c) => c.kw + '(' + (c.openedAt ? 'L' + c.openedAt : '?') + ')').join(', ') || '（无）')
      + '　★ 本行之后深度 = ' + p.depthAfter);
    if (p.openers.length) say('  ⇒ ★ **配对 `end` = L' + (closerOf.get(around) || '（找不到 ✗）') + '**');
    if (p.closers.length) for (const c of p.closers) say('     ★ 本行 `' + c.kw + '` 闭合的是 **L' + c.openedAt + '** 的 `' + c.openedKind + '`');
  }
}

// ── ② --range：逐块清单 ───────────────────────────────────────────────────
if (rangeArg) {
  const [a, b] = rangeArg.split('-').map(Number);
  say('');
  say('── ② L' + a + '..L' + b + ' 的块清单（★ 只列有开/关的行 ✓）──');
  say('  ' + '行'.padStart(6) + '  ' + '开'.padEnd(10) + ' ' + '关（闭合谁）'.padEnd(24) + ' 行后深度  代码');
  for (const p of perLine) {
    if (p.line < a || p.line > b) continue;
    if (!p.openers.length && !p.closers.length) continue;
    const cl = p.closers.map((c) => c.kw + '←L' + (c.openedAt || '?') + '(' + (c.openedKind || '?') + ')').join(' ');
    say('  ' + String(p.line).padStart(6) + '  ' + (p.openers.join(' ') || '').padEnd(10) + ' ' + cl.padEnd(24) + ' ' + String(p.depthAfter).padStart(6) + '    ' + p.raw.slice(0, 52));
  }
  const first = perLine.find((x) => x.line === a);
  const last = perLine.find((x) => x.line === b);
  say('');
  say('  ★ 区间净变化：L' + a + ' 之前深度 ' + (first ? first.depthAfter - netOf(first) : '?')
    + ' ⇒ L' + b + ' 之后深度 ' + (last ? last.depthAfter : '?')
    + (first && last && (last.depthAfter - (first.depthAfter - netOf(first))) === 0 ? '　✅ **自洽（净 0 ✓ 可整体删 ✓）**' : '　✗ **不自洽（净 ≠ 0 ⇒ 整体删会少/多 `end` ✗）**'));
}
function netOf(p) { return p.openers.length - p.closers.length; }

// ── ③ --selfcontained：给"想删的起点"，算该删到哪 ─────────────────────────
if (scArg) {
  const [a, b0] = scArg.split('-').map(Number);
  say('');
  say('── ③ L' + a + ' 起、至少覆盖到 L' + b0 + ' ⇒ ★ 该删到哪一行 ──');
  const before = perLine.find((x) => x.line === a - 1);
  const d0 = before ? before.depthAfter : 0;
  let found = null;
  for (const p of perLine) {
    if (p.line < b0) continue;
    if (p.depthAfter === d0) { found = p.line; break; }
  }
  say('  L' + (a - 1) + ' 之后的深度 = ' + d0 + '　（★ 删完必须回到这个深度 ✓）');
  if (found) {
    say('  ⇒ ★★ **精确区间：L' + a + ' .. L' + found + '** ✓（★ 净深度变化 = 0 ✓ 可整体删 ✓）');
    say('     ★ 该区间行数 = ' + (found - a + 1));
  } else {
    say('  ✗ ★ 从 L' + a + ' 往后**再也没有回到深度 ' + d0 + ' 的行** ✗ ⇒ ★ **这一段不能单独删** ✓');
  }
}

// ── ④ --verify-delete=A-B：★ 干跑验证 ✓（★ 在**临时副本**上删 ✓ **绝不碰 `lua/`** ✓）──
const vdArg = argVal('verify-delete');
if (vdArg) {
  const [a, b] = vdArg.split('-').map(Number);
  say('');
  say('── ④ 干跑验证：删 L' + a + '..L' + b + ' 之后还能编译吗（★ 在临时副本上做 ✓ `lua/` 不动 ✓）──');
  const tmpDir = path.join(ROOT, 'tools', 'out');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, '_lua_blocks_dryrun.lua');
  const kept = srcLines.filter((_, i) => i + 1 < a || i + 1 > b);
  fs.writeFileSync(tmp, kept.join('\n'), 'utf8');     // ★ 不加 BOM ✓（本项目对 BOM 极敏感 ✗）
  let ok = false, msg = '';
  try {
    execFileSync('luac', ['-p', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    ok = true;
  } catch (e) {
    ok = false;
    msg = String((e.stderr || e.stdout || e.message)).trim().split('\n').slice(0, 4).join('\n     ');
  }
  say('  删掉 ' + (b - a + 1) + ' 行 ⇒ 剩 ' + kept.length + ' 行');
  say(ok ? '  ✅ **`luac -p` 通过** ✓ ⇒ ★ **这个区间可以整体删** ✓✓'
    : '  ❌ **`luac -p` 失败** ✗ —— ★ **这个区间不能整体删** ✓\n     ' + msg);
  try { fs.unlinkSync(tmp); } catch { }
  say('  （★ 临时文件已删 ✓；★ `lua/` 一个字节都没动 ✓）');
}

if (JSON_OUT) console.log(JSON.stringify({ file, depthEnd: depth, around, range: rangeArg, selfcontained: scArg, verifyDelete: vdArg, perLine: perLine.filter((p) => p.openers.length || p.closers.length) }, null, 1));
else console.log(out.join('\n'));
