// tools/lua_map.mjs —— Lua 侧「**代码地图**」的机械底座（★ 只读 ✓ 不改任何 `lua/` 文件 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么需要它（2026-10-10 代码地图员立 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 画地图最怕**漏** ✗ —— ★ 而"漏"多半不是没看，是**看了但没看见** ✓：
//     · ★ 同一个名字在 3 个文件里出现 ✓ 只看了 1 个 ✗
//     · ★ 一个函数"没有调用点" ⇒ 判死 ✗ —— 其实挂在回调表上 ✓
//     · ★ `end` 配对目测 ✗（本工程注释里全是 `do`/`end`/`if` ✓）
//   ⇒ ★★ 所以把这三件事**机械化** ✓，★ 人只负责"这段话在干什么" ✓
//
//   ★ 本工具只干四件事 ✓：
//     ① `--funcs`   ★ 列出**每个函数定义**的 起止行 ✓（★ 带 `end` 配对 ✓）
//     ② `--refs=N`  ★ **跨文件**列出对某个名字的**引用点**（★ 剥掉注释与字符串 ✓）
//     ③ `--orphan`  ★ 列出**定义了、但别处没有任何引用**的函数 ✓（★ 死代码候选 ✓）
//     ④ `--code`    ★ 只搜**代码部分**的正则（★ 注释里的不算 ✓）
//
//   ★ 与 `lua_blocks.mjs` 的分工 ✓：★ 那个管**块配对/能不能整段删** ✓；
//     ★ 本工具管**谁是谁、谁在哪** ✓。★ 两者都跑一遍才算查证过 ✓。
//
// ⚠️ ★ 诚实声明 ✓：★ 这是**正则启发式** ✓，**不是完整 Lua 解析** ✗。
//   ★ 它**不覆盖**：动态调用（`_G[n]()` ✗）、字符串拼出来的名字 ✗、
//     元表 `__index` 转发 ✗、以及**局部变量遮蔽**（同名不同物 ✗）。
//   ⇒ ★ 所以 `--orphan` 的结论**必须再 grep 一次确认** ✓（★ 工具自己会给 grep 命令 ✓）
//
// 用法：
//   node tools/lua_map.mjs --funcs --file=lua/ui_controller.lua
//   node tools/lua_map.mjs --funcs --file=lua/ui_controller.lua --grep=grid
//   node tools/lua_map.mjs --refs=_grid_text_payload
//   node tools/lua_map.mjs --orphan --file=lua/ui_controller.lua
//   node tools/lua_map.mjs --code='_pal_disabled' --file=lua/ui_controller.lua --range=5000-6712

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argVal = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const FILE = argVal('file');
const GREP = argVal('grep');
const REFS = argVal('refs');
const CODE = argVal('code');
const RANGE = argVal('range');
const DO_FUNCS = argv.includes('--funcs');
const DO_ORPHAN = argv.includes('--orphan');
const JSON_OUT = argv.includes('--json');

// ★ 默认扫描的全部 lua 源（★ 不含 _backup/old-repo ✗ —— 那里面是历史副本 ✓）
function luaFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['_backup', 'old-repo', 'versions', 'node_modules', '作废', '存档归档', 'dist', 'sim-save', 'baseline', 'pending', 'assets', '.git'].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith('.lua')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'lua'));
  return out;
}

// ── 剥注释与字符串（★ 与 lua_blocks.mjs 同一套状态机 ✓ 跨行状态必须带 ✓）──────
function stripAll(lines) {
  const out = [];
  let state = 'code', strCh = null, longEq = 0;
  for (const ln of lines) {
    let res = '', i = 0;
    while (i < ln.length) {
      if (state === 'code') {
        if (ln[i] === '-' && ln[i + 1] === '-') {
          let j = i + 2, eq = 0;
          if (ln[j] === '[') { let k = j + 1; while (ln[k] === '=') { eq++; k++; } if (ln[k] === '[') { state = 'long_comment'; longEq = eq; i = k + 1; continue; } }
          state = 'sline_comment'; i = ln.length; continue;
        }
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
        if (ln[i] === ']') {
          let k = i + 1, eq = 0; while (ln[k] === '=') { eq++; k++; }
          if (eq === longEq && ln[k] === ']') { const wasStr = state === 'long_str'; state = 'code'; i = k + 1; if (wasStr) res += ' '; continue; }
        }
        i++; continue;
      }
    }
    if (state === 'sline_comment') state = 'code';
    out.push(res);
  }
  return out;
}

const KW_OPEN = /\b(function|if|for|while|repeat)\b/g;
const DO = /\bdo\b/g, END = /\bend\b/g, UNTIL = /\buntil\b/g;

// ★ 块栈：返回逐行 {openers:[{kw,at}], closers:[{kw,openedAt,openedKind}]} + 配对表 ✓
function analyze(codeLines) {
  let depth = 0, pendingLoopDo = 0, broken = null;
  const stack = [], perLine = [], closerOf = new Map();
  codeLines.forEach((text, i) => {
    const lineNo = i + 1;
    const stackBefore = stack.map((x) => ({ ...x }));   // ★ 本行【之前】的块栈 ✓ 找"外层守卫"要用 ✓
    const ev = []; let m;
    KW_OPEN.lastIndex = 0;
    while ((m = KW_OPEN.exec(text))) {
      const kw = m[1];
      if (kw === 'if' && /elseif$/.test(text.slice(Math.max(0, m.index - 8), m.index))) continue;
      ev.push({ at: m.index, kind: 'open', kw });
    }
    DO.lastIndex = 0; while ((m = DO.exec(text))) ev.push({ at: m.index, kind: 'do' });
    END.lastIndex = 0; while ((m = END.exec(text))) ev.push({ at: m.index, kind: 'close', kw: 'end' });
    UNTIL.lastIndex = 0; while ((m = UNTIL.exec(text))) ev.push({ at: m.index, kind: 'close', kw: 'until' });
    ev.sort((a, b) => a.at - b.at);
    const openers = [], closers = [];
    for (const e of ev) {
      if (e.kind === 'open') {
        depth++;
        if (e.kw === 'for' || e.kw === 'while') pendingLoopDo++;
        stack.push({ kind: e.kw, line: lineNo, at: e.at });
        openers.push({ kw: e.kw, at: e.at });
      } else if (e.kind === 'do') {
        if (pendingLoopDo > 0) pendingLoopDo--;
        else { depth++; stack.push({ kind: 'do', line: lineNo, at: e.at }); openers.push({ kw: 'do', at: e.at }); }
      } else {
        depth--;
        const top = stack.pop();
        if (top) closerOf.set(top.line + ':' + top.at, lineNo);
        closers.push({ kw: e.kw, openedAt: top ? top.line : null, openedKind: top ? top.kind : null });
        if (depth < 0 && !broken) broken = '深度变负 @L' + lineNo;
      }
    }
    perLine.push({ line: lineNo, openers, closers, depthAfter: depth, stackBefore });
  });
  return { depth, broken, perLine, closerOf };
}

// ★ 找函数定义：返回 {name, kind, line, openerLine, endLine} ✓
//   ★ 支持 5 种写法 ✓：
//     `local function NAME(` / `function NAME(` / `function A.B(` / `function A:B(`
//     `local NAME = function(` / `A.B = function(` / `A:B = function(`
function findFuncs(codeLines, an) {
  const out = [];
  const pats = [
    // ★ 必须用 `(?![\w.])` 之外的宽松式：`function` 后面跟名字 ✓
    [/\blocal\s+function\s+([A-Za-z_][\w]*)\s*\(/g, 'local function'],
    [/\bfunction\s+([A-Za-z_][\w]*(?:[.:][A-Za-z_][\w]*)*)\s*\(/g, 'function'],
    [/\blocal\s+([A-Za-z_][\w]*)\s*=\s*function\s*\(/g, 'local = function'],
    [/\b([A-Za-z_][\w]*(?:[.:][A-Za-z_][\w]*)+)\s*=\s*function\s*\(/g, 'A.B = function'],
  ];
  codeLines.forEach((text, i) => {
    const lineNo = i + 1;
    // ★ 本行所有 `function` 关键字的位置 ✓ —— 取**最内层**的那个开块来配对 ✓
    const fns = [];
    for (const [re, kind] of pats) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) {
        const at = m.index;
        const after = m[0];
        if (kind === 'function' && /\blocal\s+$/.test(text.slice(0, m.index))) continue;  // 已由第 1 条捕获
        fns.push({ name: m[1], kind, at, len: after.length });
      }
    }
    if (!fns.length) return;
    // ★ `function` 关键字在 m[0] 里的偏移 ✓
    fns.sort((a, b) => a.at - b.at);
    const pl = an.perLine[i];
    for (const f of fns) {
      // 本行里属于这个定义的 function 开块 = at + 名字前面的 `function` 词位置
      const kwAt = f.at + f.len - 'function'.length - (f.kind === 'A.B = function' ? 0 : 0);
      const kwPos = text.indexOf('function', f.at);
      const key = lineNo + ':' + kwPos;
      out.push({ name: f.name, kind: f.kind, line: lineNo, endLine: an.closerOf.get(key) ?? null, depth: pl ? pl.depthAfter : null });
    }
  });
  // 去重（同一 name+line 多条写法命中）
  const seen = new Set();
  return out.filter((f) => { const k = f.name + '@' + f.line + '@' + f.kind; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── 用法分发 ──────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
const files = FILE ? [path.isAbsolute(FILE) ? FILE : path.join(ROOT, FILE)] : luaFiles();
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const cache = new Map();
function load(p) {
  if (cache.has(p)) return cache.get(p);
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split(/\r?\n/);
  const code = stripAll(lines);
  const an = analyze(code);
  const v = { src, lines, code, an };
  cache.set(p, v);
  return v;
}

if (DO_FUNCS) {
  for (const p of files) {
    const { lines, code, an } = load(p);
    const funcs = findFuncs(code, an);
    let list = funcs;
    if (GREP) list = funcs.filter((f) => f.name.toLowerCase().includes(GREP.toLowerCase()));
    say('══ ' + rel(p) + '（' + (lines.length - 1) + ' 行）自检深度=' + an.depth + (an.broken ? ' ✗' + an.broken : ' ✓') + ' 函数 ' + funcs.length + ' 个' + (GREP ? '（筛 "' + GREP + '" ⇒ ' + list.length + ' 个）' : '') + ' ══');
    say('  ' + '行区间'.padEnd(20) + ' 名字'.padEnd(46) + ' 写法');
    for (const f of list) {
      const rng = 'L' + f.line + '..' + (f.endLine ? 'L' + f.endLine : '??');
      say('  ' + rng.padEnd(20) + ' ' + f.name.padEnd(46) + ' ' + f.kind + (f.endLine ? '' : '   ⚠️配不到 end'));
    }
    say('');
  }
}

if (REFS) {
  const re = new RegExp('\\b' + REFS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  say('══ 引用 `' + REFS + '`（★ 只算代码部分 ✓ 注释/字符串不算 ✓）══');
  let total = 0;
  for (const p of files) {
    const { code, lines, an } = load(p);
    const funcs = findFuncs(code, an);
    let n = 0;
    for (let i = 0; i < code.length; i++) {
      if (!re.test(code[i])) continue;
      n++; total++;
      const owner = funcs.filter((f) => i + 1 >= f.line && f.endLine && i + 1 <= f.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
      say('  ' + (rel(p) + ':' + (i + 1)).padEnd(46) + ' ' + (owner ? '在 ' + owner.name + '(L' + owner.line + ')' : '（顶层）').padEnd(34) + ' | ' + code[i].trim().slice(0, 76));
    }
    if (n) say('  —— ' + rel(p) + ' 共 ' + n + ' 处（★ 全文 ' + (lines.length - 1) + ' 行）');
  }
  say('  ★ 合计 ' + total + ' 处。★ 复核用：node tools/lua_map.mjs --code=\'' + REFS + '\'');
}

if (DO_ORPHAN) {
  // ★★ 必须**跨文件**统计 ✗ —— ★ 否则会把 `Core:tap_cell`（被 ui_controller 调 ✓）
  //   这种**活函数**报成死代码 ✗✓（★ 我第一版就是这么错的 ✓ 幸好复核时抓到 ✓）
  const corpus = [];      // {file, line, text}
  for (const p of luaFiles()) {
    const { code } = load(p);
    code.forEach((t, i) => corpus.push({ file: rel(p), line: i + 1, text: t }));
  }
  const globalText = corpus.map((c) => c.text).join('\n');
  for (const p of files) {
    const { code, an, lines } = load(p);
    const funcs = findFuncs(code, an);
    say('══ ' + rel(p) + ' —— 定义了但**全 `lua/` 无引用**的函数（★ 已跨文件查 ✓ 仍需再 grep 确认 ✓）══');
    let n = 0;
    for (const f of funcs) {
      // ★ 用**最后一段名字**搜 ✓（`M.build_walls_OLD` ⇒ `build_walls_OLD` ✓）
      //   ⚠️ 太短/太通用的段（`new` / `fx` / `push`）会满屏假阳性 ✗ ⇒ 跳过 ✓
      const refName = f.name.split(/[.:]/).pop();
      if (refName.length < 5) continue;
      const re = new RegExp('\\b' + refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      const inAll = (globalText.match(re) || []).length;
      let inBody = 0;
      const lo = f.line, hi = f.endLine || f.line;
      for (let i = lo - 1; i < hi && i < code.length; i++) inBody += (code[i].match(re) || []).length;
      if (inAll - inBody <= 0) {
        n++;
        // ★ 顺带把"只出现在注释里"的旁证给出来 ✓（★ 决定权不在本工具 ✓）
        const rawHits = [];
        for (let i = 0; i < lines.length; i++) if (lines[i].includes(refName)) rawHits.push(i + 1);
        say('  L' + f.line + '..L' + (f.endLine || '?') + '  ' + f.name.padEnd(40)
          + ' ★ 全 `lua/` 只出现 ' + inAll + ' 次（全在自己体内）⇒ 无外部引用 ✗'
          + (rawHits.length - inAll > 0 ? '　（★ 另有 ' + (rawHits.length - inAll) + ' 处只在注释/字符串里 ✓）' : ''));
      }
    }
    if (!n) say('  （无 ✓ —— 每个函数都至少有一处外部引用 ✓）');
    say('');
  }
}

if (CODE) {
  const re = new RegExp(CODE);
  const [a, b] = RANGE ? RANGE.split('-').map(Number) : [1, Infinity];
  for (const p of files) {
    const { code, lines } = load(p);
    let n = 0;
    for (let i = 0; i < code.length; i++) {
      if (i + 1 < a || i + 1 > b) continue;
      if (!re.test(code[i])) continue;
      n++;
      say('  ' + (rel(p) + ':' + (i + 1)).padEnd(46) + ' | code: ' + code[i].trim().slice(0, 84));
    }
    if (n) say('  —— ' + rel(p) + ' 共 ' + n + ' 处（★ 代码部分命中）\n');
  }
}

// ── ⑤ --delrange=a-b：★ **能不能整段删**（★ 栈安全判据 ✓ 不是"深度相等" ✗）──────
//   ★★★ 为什么不能用"深度相等"当判据 ✗（2026-10-10 地图员实证 ✓）：
//     ★ 区间 `[a,b]` 的净深度 = 0 **并不等于** 它是一个自洽的块 ✗ —— 因为它可能
//       ★ **关掉了一个【区间之外】开的块** ✗ 同时又**开了一个【区间之内】的新块** ✗，
//       ★ 一关一开，净变化照样是 0 ✓✓ —— ★ 但删下去照样少一个 `end` ✗
//     ★ 实证（`ui_controller.lua` @6478 行 ✓）：
//       · L5444 的 `end`，**注释写着"if ALGO_TEXT then 收尾"** ✗
//       · 机械配对说它关的是 **L5410 `if tv ~= nil then`** ✓（★ 区间之外 ✗）
//       · 而 L5447 又开了一个新 `if` ✓
//       ⇒ ★ `--selfcontained=5425-5444` 报 `L5425..L5447 净 0` ✗ —— **假阳性** ✗✓
//       ⇒ ★ 真删下去 = 少一个 `end` ＋ 多一个没关的 `if` ✗
//   ⇒ ★★ 正确判据（★ 本函数 ✓）：★ **模拟栈，且栈深【永不低于】入口深度** ✓
//     ★ 并额外要求：结束时**栈上的条目与入口时逐一同源** ✓（★ 双保险 ✓）
const DELRANGE = argVal('delrange');
if (DELRANGE) {
  const [a, b0] = DELRANGE.split('-').map(Number);
  for (const p of files) {
    const { code, lines, an } = load(p);
    // ★ 逐行"净变化"与"关闭了谁" ✓（★ 直接复用 analyze 的 closers ✓）
    const entryDepth = a - 1 >= 1 ? an.perLine[a - 2].depthAfter : 0;
    // ★ 入口栈快照 = 前 a-1 行处理完之后的栈 ✓ —— 用 closerOf 反推不靠稳 ⇒ 重跑一遍 ✓
    const stackAt = (upto) => { const s = []; for (let i = 0; i < upto && i < an.perLine.length; i++) { const pl = an.perLine[i]; for (const o of pl.openers) s.push({ line: i + 1, at: o.at, kw: o.kw }); for (const c of pl.closers) s.pop(); } return s; };
    const entryStack = stackAt(a - 1);
    // ★ 模拟 a..b0 ✓
    let minDepth = null, badLine = null, endLine = null;
    let sim = entryStack.map((x) => ({ ...x }));
    for (let i = a - 1; i < an.perLine.length; i++) {
      const pl = an.perLine[i];
      for (const o of pl.openers) sim.push({ line: i + 1, at: o.at, kw: o.kw });
      for (const c of pl.closers) {
        const popped = sim.pop();
        if (popped && popped.line < a) { if (badLine == null) badLine = { line: i + 1, poppedLine: popped.line, kw: popped.kw }; }
      }
      if (sim.length < entryStack.length && minDepth == null) minDepth = { line: i + 1, depth: sim.length };
      if (i + 1 >= b0 && sim.length === entryStack.length) {
        // ★ 还要逐一同源 ✓
        let same = true;
        for (let k = 0; k < entryStack.length; k++) if (sim[k].line !== entryStack[k].line || sim[k].at !== entryStack[k].at) { same = false; break; }
        if (same) { endLine = i + 1; break; }
      }
    }
    say('══ ' + rel(p) + '（' + (lines.length - 1) + ' 行）`--delrange=' + a + '-' + b0 + '` ══');
    say('  ★ 入口深度（L' + (a - 1) + ' 之后）= ' + entryDepth + '　★ 入口栈 ' + entryStack.length + ' 层');
    if (badLine) {
      say('  ❌ ★★ **区间内有 `end` 关掉了【区间之外】开的块** —— L' + badLine.line + ' 的 `' + badLine.kw + '` 关的是 **L' + badLine.poppedLine + '** ✗');
      say('     ⇒ ★ **这一段不能整体删** ✗（★ 就算"净深度 = 0"也不行 ✗ —— 一关一开抵掉了 ✓）');
    } else if (endLine == null) {
      say('  ✗ ★ 从 L' + a + ' 往后**再也没有回到入口栈状态的行** ⇒ ★ 这一段不能单独删 ✗');
    } else {
      say('  ✅ ★★ **可整体删：精确区间 = L' + a + ' .. L' + endLine + '** ✓（★ 栈深从不低于入口 ✓、结束时逐层同源 ✓）');
      say('     ★ 行数 = ' + (endLine - a + 1) + '　★ 删完请跑：luac -p 文件　＋　node tools/lua_blocks.mjs 文件 --range=' + a + '-' + endLine);
    }
    say('');
  }
}

// ── ⑥ --outline=a-b：★ 只列【直接子块】及其配对 end ✓（大函数的地图骨架 ✓）────
//   ★ 用途：`_fill_grid_item` 有 1000+ 行 ✓ —— ★ 逐行读会淹死 ✗
//     ⇒ ★ 只列"入口深度 +1"的那一层 ✓ ⇒ ★ 一眼看清它有哪几段、各段 L?..L? ✓
const OUTLINE = argVal('outline');
if (OUTLINE) {
  const [a, b] = OUTLINE.split('-').map(Number);
  const lvl = argVal('level') ? Number(argVal('level')) : 1;
  for (const p of files) {
    const { code, lines, an } = load(p);
    const entryDepth = a - 1 >= 1 ? an.perLine[a - 2].depthAfter : 0;
    const wantDepth = entryDepth + lvl;      // ★ 该层开块"之后"的深度 ✓
    say('══ ' + rel(p) + '（' + (lines.length - 1) + ' 行）outline L' + a + '..L' + b + '　★ 入口深度=' + entryDepth + ' ⇒ 列开块后深度=' + wantDepth + ' 的层 ══');
    // ★ 配对表：openerLine:at -> closerLine ✓
    const closerOf = an.closerOf;
    let n = 0;
    for (let i = a - 1; i < b && i < an.perLine.length; i++) {
      const pl = an.perLine[i];
      if (!pl.openers.length) continue;
      if (pl.depthAfter !== wantDepth) continue;      // ★ 这一层 ✓
      // ★ 本行可能有多个开块 ✓ —— 取最后一个（≙ 最内层）✓
      const last = pl.openers[pl.openers.length - 1];
      const endLine = closerOf.get((i + 1) + ':' + last.at) ?? null;
      n++;
      say('  L' + (i + 1) + '..' + (endLine ? 'L' + endLine : '??') + '  ' + (last.kw + '').padEnd(9)
        + ' 行数=' + String(endLine ? endLine - i : '?').padStart(5) + '  | ' + (code[i].trim().slice(0, 62) || '(仅注释/空)'));
    }
    say('  ★ 该层共 ' + n + ' 段');
    say('');
  }
}

// ── ⑦ --prints：★ 每条 `print(` ＋ 它的【外层守卫区间】✓（清诊断日志用 ✓）──────
//   ★ 用途：真机日志里那些"诊断X / 探针X / 实况X" ⇒ ★ 要删就得连**守卫**一起删 ✗
//     ⇒ ★ 只删 `print` 那一行 ⇒ 留下空的 `if (self._x_log or 0) < N then end` ✗
//   ★ 输出：`L守卫起..L守卫止（守卫关键字）` ＋ `print` 所在行 ＋ 原始文本片段 ✓
const PRINTS = argv.includes('--prints');
if (PRINTS) {
  const MARK = argVal('marker');      // ★ 只列原始文本里含这些字的 ✓（逗号分隔 ✓）
  const marks = MARK ? MARK.split(',') : null;
  for (const p of files) {
    const { code, lines, an } = load(p);
    say('══ ' + rel(p) + '（' + (lines.length - 1) + ' 行）所有 `print(` ＋ 外层守卫 ══');
    let n = 0;
    for (let i = 0; i < code.length; i++) {
      if (!/\bprint\s*\(/.test(code[i])) continue;
      const raw = lines[i];
      if (marks && !marks.some((m) => raw.includes(m))) continue;
      // ★ 最内层的 `if` 守卫 ✓
      const sb = an.perLine[i].stackBefore;
      let guard = null;
      for (let k = sb.length - 1; k >= 0; k--) if (sb[k].kind === 'if') { guard = sb[k]; break; }
      const gEnd = guard ? (an.closerOf.get(guard.line + ':' + guard.at) ?? null) : null;
      n++;
      say('  print@L' + String(i + 1).padStart(5) + '　守卫：'
        + (guard ? ('L' + guard.line + '..L' + gEnd) : '（无 ✓ 顶层裸 print ✗）'));
      say('        ' + raw.trim().slice(0, 96));
    }
    say('  ★ 共 ' + n + ' 条' + (marks ? '（筛 "' + MARK + '" ✓）' : ''));
    say('');
  }
}

if (!DO_FUNCS && !REFS && !DO_ORPHAN && !CODE && !DELRANGE && !OUTLINE && !PRINTS) {
  say('用法：node tools/lua_map.mjs --funcs [--file=<f>] [--grep=<s>]');
  say('      node tools/lua_map.mjs --refs=<名字>');
  say('      node tools/lua_map.mjs --orphan [--file=<f>]');
  say('      node tools/lua_map.mjs --code=<正则> [--file=<f>] [--range=a-b]');
  say('      node tools/lua_map.mjs --delrange=<起>-<至少到> [--file=<f>]   # ★ 栈安全判据 ✓ 比 --selfcontained 严 ✓');
  say('      node tools/lua_map.mjs --outline=<起>-<止> [--level=1] [--file=<f>]  # ★ 只列该层的直接子块 ✓');
  say('      node tools/lua_map.mjs --prints [--marker=诊断,探针,实况] [--file=<f>]  # ★ print ＋ 外层守卫区间 ✓');
}
