// tools/lua_audit.mjs —— Lua 侧「**删干净**」的可执行判据（★ 只读 ✓ 不改任何 `lua/` 文件 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么需要它（2026-10-10 lead 要求 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 用户下的令是「★ **旧的那套东西不要只是关掉，直接把它们从脚本里删干净，一行都不要留** ✓」
//   ★ 而"删 200 行"最怕两件事 ✗：
//     ① ★ **删剩半段** ⇒ ★ **语法坏了** ✗（`luac -p` 能抓 ✓）
//     ② ★ **该删的没删干净** ⇒ ★ **旧路还在跑** ✗（★ 这个 `luac` 抓不到 ✗✓）
//   ⇒ ★★ 所以本工具把"干净"变成**跑得出数字的判据** ✓ ——
//     ★ **而不是靠人说"我删了"** ✓（★ 这正是今天那条教训：★ "报成功"必须有**独立判据** ✓）
//
//   ★ 四节 ✓：
//     ① **语法**：`luac -p` ✓（★ 顺带报编译器版本 ✓ —— ★ 本机是 5.4，而真机是 **5.3** ✗，
//        所以另给一条 `lua53check` 的命令 ✓）
//     ② **残留扫描**：★ 对一张"必须为 0 处"的名字表逐个计数 ✓
//     ③ **引用扫描**：★ **被删的函数还有没有被别处调用** ✗（★ 死引用会**运行时炸** ✓）
//        ＋ ★ **定义了却没人调** ✗（★ 死代码候选 ✓）
//     ④ **单射槽位**：★ `row.*` 的 4 个槽位（who/what/letter/face）是否都在源码里接上 ✓
//
// 用法：
//   node tools/lua_audit.mjs                                  # 默认审 lua/ui_controller.lua
//   node tools/lua_audit.mjs lua/ui_controller.lua
//   node tools/lua_audit.mjs lua/ui_controller.lua --strict   # ★ 残留非 0 就 exit 3 ✓
//   node tools/lua_audit.mjs lua/ui_controller.lua --zero=portrait\\.  --zero=旧函数名   # 追加"必须为 0"
//   node tools/lua_audit.mjs lua/ui_controller.lua --json
//
// 退出码：0 = 审计完成（★ 非 `--strict` 时**不因"有残留"而失败** ✓）；2 = 用法/读不到；
//         3 = `--strict` 且**有残留** ✗；4 = **语法不过** ✗
//
// ⚠️ ★ 诚实声明 ✓：★ 第 ③④ 节是**正则启发式** ✓，**不是完整 Lua 解析** ✗ ——
//   ★ 它足以回答"**被删的函数还有没有调用点**" ✓，★ 但**不覆盖**动态调用（`_G[name]` ✗）、
//   ★ 字符串拼出来的调用 ✗、★ 以及**通过方法语法**（`obj:name()` ✗）的调用 ✓。
//   ⇒ ★ 所以**它报"没有调用点"时，请再 grep 一次确认** ✓（★ 工具会顺带给 grep 命令 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const JSON_OUT = argv.includes('--json');
const file = argv.find((s) => !s.startsWith('--')) || 'lua/ui_controller.lua';
const extras = argv.filter((s) => s.startsWith('--zero=')).map((s) => s.slice(7));

// ★ "必须为 0 处"的默认表 ✓ —— ★ 每一项都是**正则** ✓（★ 不再自动转义 ✗）
//   ⚠️ ★ 2026-10-10 自捉一个 bug ✓：★ 原来对"不以 `re:` 开头"的模式**自动转义** ✗，
//     ★ 于是 `portrait\.` 被转成 `portrait\\\.` ⇒ **永远匹配不到** ✗
//     ★ 结果：★ 残留表报 **0** ✓、★ 而底下"寻址前缀"报 **30** ✗ ⇒ ★ **两个数字互相矛盾** ✓✓
//     ⇒ ★★ 教训：★ **同一份文件里的两个计数必须能交叉验证** ✓ ——
//       ★ 我就是靠那条"寻址前缀"行才发现转义写坏的 ✓（★ 否则就把 0 当成"已删干净" ✗）
const ZERO_TABLE = [
  ['portrait\\.', '旧调色板 `portrait.*` 全套 ✗'],
  ['_pal_disabled', '旧调色板的"关掉开关" ✗（★ 开关自己也算残留 ✓）'],
  ['诊断CLUE', '旧诊断（×5 ✓）✗'],
  ['诊断NOTE2', '旧诊断（×3 ✓）✗'],
  ['抢点击诊断', '旧诊断（×1 ✓）✗'],
  ['灰白诊断', '旧诊断（×5 ✓）✗'],
  ['_grid_text_payload', '旧格内文字算法（×5 ✓）✗'],
  ['clue\\.\\d+\\.', '旧 `clue.N.*` 路径 ✗'],
  ['ALGO_TEXT', '旧算法开关 ✗'],
  ...[...new Set(extras)].map((s) => [s, '（★ 命令行追加 ✓）']),
];

// ★ 把一行拆成「代码部分」与「注释部分」✓ —— ★ 因为"残留"分两种 ✗：
//   · ★ **代码里残留** ⇒ ★ **旧路还在跑** ✗（★ 最危险 ✓）
//   · ★ **注释里残留** ⇒ ★ 不影响运行 ✓，★ 但用户要的是"**一行都不要留**" ✗ ⇒ ★ 也要数 ✓
//   ★ 判据：★ 找**字符串外**的第一个 `--` ✓（★ 简化处理：逐字符走一遍引号状态 ✓）
function splitCodeComment(ln) {
  let inS = null;
  for (let i = 0; i < ln.length; i++) {
    const c = ln[i];
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '-' && ln[i + 1] === '-') return [ln.slice(0, i), ln.slice(i)];
  }
  return [ln, ''];
}

const lines = [];
const J = { file, sections: {} };
const say = (s) => lines.push(s);

const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(abs)) { console.error('读不到：' + abs); process.exit(2); }
const src = fs.readFileSync(abs, 'utf8');
const srcLines = src.split(/\r?\n/);
say('文件：' + path.relative(ROOT, abs).replace(/\\/g, '/') + '（' + srcLines.length + ' 行，' + src.length + ' 字节）');

// ── ① 语法 ────────────────────────────────────────────────────────────────
say('');
say('── ① 语法（★ "删剩半段"就靠这一节抓 ✗）──');
let luacVer = null, syntaxOk = null, syntaxErr = '';
try {
  luacVer = execFileSync('luac', ['-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
} catch (e) { luacVer = (e.stdout || '') + (e.stderr || '') || '（找不到 luac ✗）'; }
say('  luac 版本：' + luacVer);
try {
  execFileSync('luac', ['-p', abs], { stdio: ['ignore', 'pipe', 'pipe'] });
  syntaxOk = true;
  say('  ✅ `luac -p` 通过 ✓');
} catch (e) {
  syntaxOk = false;
  syntaxErr = String((e.stderr || e.stdout || e.message)).trim().split('\n').slice(0, 6).join('\n     ');
  say('  ❌ `luac -p` **失败** ✗ —— ★ 语法坏了 ✓');
  say('     ' + syntaxErr);
}
say('  ⚠️ ★ 本机 luac 是 **5.4** ✓，而真机是 **5.3** ✗ ⇒ ★ 还要跑权威闸门：');
say('     `lua tools/bundle_client_script.lua && node tools/lua53check/check.cjs dist/client_script.lua --run`');
J.sections.syntax = { luacVer, ok: syntaxOk, err: syntaxErr };

// ── ② 残留扫描 ────────────────────────────────────────────────────────────
say('');
say('── ② 残留扫描（★ "该删的没删干净"就靠这一节抓 ✗）──');
say('  ' + '模式'.padEnd(24) + '代码  注释  合计  判定  说明');
const residues = [];
for (const [pat, why] of ZERO_TABLE) {
  // ★ 每一项都当**正则**用 ✓（★ 见上面那个"自捉 bug"的注释 ✗）
  const re = new RegExp(pat, 'g');
  let inCode = 0, inComment = 0; const atCode = [], atCmt = [];
  srcLines.forEach((ln, i) => {
    const [code, cmt] = splitCodeComment(ln);
    const mc = code.match(re); const mm = cmt.match(re);
    if (mc) { inCode += mc.length; if (atCode.length < 3) atCode.push((i + 1) + ':' + ln.trim().slice(0, 58)); }
    if (mm) { inComment += mm.length; if (atCmt.length < 2) atCmt.push((i + 1) + ':' + ln.trim().slice(0, 58)); }
  });
  const n = inCode + inComment;
  residues.push({ pat, why, n, inCode, inComment, atCode, atComment: atCmt });
  say('  ' + pat.padEnd(24) + String(inCode).padStart(4) + '  ' + String(inComment).padStart(4) + '  ' + String(n).padStart(4)
    + '  ' + (n === 0 ? '✅ 0  ' : (inCode ? '✗ **代码残留**' : '⚠️ 仅注释')) + '  ' + why);
  for (const a of atCode) say('        ★代码 ' + a);
  for (const a of atCmt) say('        注释   ' + a);
}
const totalResidue = residues.reduce((s, r) => s + r.n, 0);
const totalCode = residues.reduce((s, r) => s + r.inCode, 0);
const totalCmt = residues.reduce((s, r) => s + r.inComment, 0);
say('');
say('  ★ 残留总计：**' + totalResidue + ' 处**' + (totalResidue === 0 ? ' ✓ **干净** ✓' : ' ✗')
  + '　＝ ★ **代码里 ' + totalCode + ' 处**' + (totalCode ? ' ✗（★ **旧路还在跑** ✗✓ 最危险 ✓）' : ' ✓')
  + ' ＋ ★ 注释里 ' + totalCmt + ' 处' + (totalCmt ? ' ✗（★ 不影响运行 ✓，但用户要"一行不留" ✗）' : ' ✓'));
J.sections.residue = { total: totalResidue, inCode: totalCode, inComment: totalCmt, items: residues };

// ── ③ 引用扫描（★ 死引用会运行时炸 ✓）────────────────────────────────────
say('');
say('── ③ 引用扫描（★ 被删的函数还有没有被调用 ✗）──');
const luaFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { walk(path.join(d, e.name)); continue; }
    if (e.name.endsWith('.lua')) luaFiles.push(path.join(d, e.name));
  }
})(path.join(ROOT, 'lua'));
const allSrc = luaFiles.map((f) => ({ f: path.relative(ROOT, f).replace(/\\/g, '/'), s: fs.readFileSync(f, 'utf8') }));
const LUA_BUILTIN = new Set(['print', 'pcall', 'xpcall', 'error', 'assert', 'type', 'tostring', 'tonumber', 'ipairs', 'pairs',
  'next', 'select', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal', 'rawlen', 'unpack', 'require', 'dofile',
  'load', 'loadstring', 'collectgarbage', 'coroutine', 'string', 'table', 'math', 'os', 'io', 'tostring', 'function', 'if',
  'while', 'for', 'return', 'not', 'and', 'or', 'then', 'do', 'end', 'else', 'elseif', 'local', 'until', 'repeat', 'break',
  'nil', 'true', 'false', 'goto', 'in', 'sizeof', 'typeof', 'tick', 'wait', 'spawn', 'delay', 'warn', 'Color', 'Vector2', 'Vector3']);
const defined = new Map();   // name -> [{file,line}]
const called = new Map();    // name -> [{file,line}]
for (const { f, s } of allSrc) {
  const ls = s.split(/\r?\n/);
  ls.forEach((ln, i) => {
    // 定义：function NAME(  ／ local function NAME(  ／ NAME = function(
    let m;
    const reDef = /\b(?:local\s+)?function\s+([A-Za-z_][\w.]*)\s*\(/g;
    while ((m = reDef.exec(ln))) {
      const nm = m[1];
      if (!defined.has(nm)) defined.set(nm, []);
      defined.get(nm).push({ file: f, line: i + 1 });
    }
    const reAssign = /^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=\s*function\s*\(/g;
    while ((m = reAssign.exec(ln))) {
      const nm = m[1];
      if (!defined.has(nm)) defined.set(nm, []);
      defined.get(nm).push({ file: f, line: i + 1 });
    }
    // 调用：**裸** NAME(（★ 排除 `x.NAME(` 与 `x:NAME(` 与方法定义 ✗ —— 那些是字段/方法 ✓）
    const reCall = /(^|[^\w.:])([A-Za-z_]\w*)\s*\(/g;
    while ((m = reCall.exec(ln))) {
      const nm = m[2];
      if (LUA_BUILTIN.has(nm)) continue;
      if (/\bfunction\s+$/.test(ln.slice(0, m.index + m[1].length))) continue;   // 定义行不算调用
      if (!called.has(nm)) called.set(nm, []);
      called.get(nm).push({ file: f, line: i + 1 });
    }
  });
}
const undef = [...called.entries()].filter(([nm]) => !defined.has(nm))
  .map(([nm, at]) => ({ nm, n: at.length, at: at.slice(0, 3) }))
  .sort((a, b) => b.n - a.n);
const unused = [...defined.entries()].filter(([nm]) => !called.has(nm))
  .map(([nm, at]) => ({ nm, at: at.slice(0, 2) }))
  .filter((x) => !/[:.]/.test(x.nm));
say('  ★ **被调用、但【整个 `lua/` 里都没有定义】** ✗（★ 这种运行时必炸 ✓）—— ' + undef.length + ' 个：');
if (!undef.length) say('     ✅ 无 ✓');
for (const u of undef.slice(0, 25)) say('     ' + u.nm.padEnd(28) + '×' + String(u.n).padStart(3) + '　' + u.at.map((a) => a.file + ':' + a.line).join(' , '));
if (undef.length > 25) say('     …还有 ' + (undef.length - 25) + ' 个（★ 多为引擎 API / 拼写错误，需人看 ✓）');
say('  ★ **定义了、但【没有裸调用点】**（★ 死代码候选 ✓）—— ' + unused.length + ' 个：');
if (!unused.length) say('     ✅ 无 ✓');
for (const u of unused.slice(0, 20)) say('     ' + u.nm.padEnd(28) + u.at.map((a) => a.file + ':' + a.line).join(' , '));
if (unused.length > 20) say('     …还有 ' + (unused.length - 20) + ' 个');
say('  ⚠️ ★ 启发式 ✓：★ 不覆盖 `_G[name]` 动态调用 ✗ ／ ★ 字符串拼的调用 ✗ ／ ★ 只按名字、不按作用域 ✗');
say('     ★ 要确认某个名字真的没了调用点 ⇒ `grep -n "\\b<名字>\\s*(" lua/**/*.lua` ✓');
J.sections.refs = { undefined: undef.length, unused: unused.length, files: luaFiles.length };

// ── ④ 单射槽位（★ 4 个槽位是否都接上 ✓）──────────────────────────────────
say('');
say('── ④ 单射槽位（★ `row.*` 的 4 个槽位是否都在源码里接上 ✓）──');
const SLOTS = ['who', 'what', 'letter', 'face'];
const slots = {};
for (const s of SLOTS) {
  // ★ 当作"槽位名"用：出现在字符串字面量里 ✓（`"who"` / `'face'` ✓）
  const re = new RegExp('[\'"`]' + s + '[\'"`]', 'g');
  let n = 0; const at = [];
  srcLines.forEach((ln, i) => { const m = ln.match(re); if (m) { n += m.length; if (at.length < 2) at.push(i + 1); } });
  slots[s] = { n, at };
  say('  槽位 ' + s.padEnd(8) + '★ 作为字符串出现 ' + String(n).padStart(4) + ' 处' + (n ? ' ✓' : ' ✗ **没接上** ✗')
    + (at.length ? '　行 ' + at.join(', ') : ''));
}
const rowRefs = (src.match(/row\./g) || []).length;
const clueRefs = (src.match(/clue\./g) || []).length;
const portraitRefs = (src.match(/portrait\./g) || []).length;
say('  寻址前缀：`row.` ' + rowRefs + ' 处' + (rowRefs ? ' ✓' : ' ✗') + '　`clue.` ' + clueRefs + ' 处　`portrait.` ' + portraitRefs + ' 处'
  + (portraitRefs ? ' ✗（★ 旧调色板还活着 ✓）' : ' ✓（★ 已无 ✓）'));
J.sections.slots = { slots, rowRefs, clueRefs, portraitRefs };

// ── 结论 ──────────────────────────────────────────────────────────────────
say('');
say('── 结论 ──');
const verdict = [];
verdict.push((syntaxOk ? '✅' : '❌') + ' 语法 ' + (syntaxOk ? '通过' : '**不过** ✗'));
verdict.push((totalResidue === 0 ? '✅' : '✗') + ' 残留 ' + totalResidue + ' 处' + (totalResidue === 0 ? '（干净 ✓）' : '（**还没删干净** ✗）'));
verdict.push((undef.length === 0 ? '✅' : '⚠️') + ' 无定义的调用 ' + undef.length + ' 个');
verdict.push(SLOTS.every((s) => slots[s].n > 0) ? '✅ 4 个槽位都接上 ✓' : ('❌ 有槽位没接上 ✗：' + SLOTS.filter((s) => !slots[s].n))) ;
for (const v of verdict) say('  ' + v);

if (JSON_OUT) console.log(JSON.stringify(J, null, 1));
else console.log(lines.join('\n'));
process.exit(!syntaxOk ? 4 : (STRICT && totalResidue > 0 ? 3 : 0));
