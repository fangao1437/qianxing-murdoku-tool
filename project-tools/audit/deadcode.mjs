#!/usr/bin/env node
/**
 * deadcode.mjs — 脚本「必要性」机械扫描（只报告，不改任何文件）
 *
 * 用途：为「核对当前脚本代码是否都是必要的」提供机械证据。
 * 输出：docs/审计-脚本必要性/raw-deadcode.json + 控制台摘要
 *
 * 判据口径（写死在代码里，报告里要照抄，避免别人误读）：
 *   1. 先把注释 / 字符串剥掉（保留行号），再找定义 —— 否则注释里出现过的名字会被当成"被引用"。
 *   2. 定义形态：`function A.b(` / `function A:b(` / `local function b(` / `A.b = function` / `A:b = function`
 *   3. 「引用数」= 剥完后该短名作为标识符出现的次数 − 定义处那 1 次。
 *   4. 三份语料分开数：prod = lua/**、test = tests/**、tool = tools/**\/*.lua
 *      —— 只在 test/tool 里出现的，prod 侧就是死代码（但测试可能靠它，删之前要连测试一起改）。
 *   5. 短名冲突会让两个不同文件里的同名函数互相"顶包" ⇒ 这种情况会**漏报**（宁可漏，不可误报）。
 *   6. 动态派发（`M.EFFECTS[name]` / `MAP[k]` / `T[action]`）无法静态判定 ⇒
 *      单独扫出「被非字面量下标取过的表名」，凡是定义在那些表里的名字一律降级为 `dynamic-unknown`。
 *
 * 用法：
 *   node tools/audit/deadcode.mjs            # 只打印摘要
 *   node tools/audit/deadcode.mjs --write    # 同时写 docs/审计-脚本必要性/raw-deadcode.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url'; // ★ 中文路径必须用 fileURLToPath，不能用 new URL().pathname

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITE = process.argv.includes('--write');

/** 递归收集 .lua */
function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      collect(p, out);
    } else if (e.name.endsWith('.lua')) out.push(p);
  }
  return out;
}

/**
 * 剥注释与字符串。返回 { clean, strings }：
 *   clean   —— 注释/字符串内容全部换成空格（换行保留，行号不变）
 *   strings —— 所有字符串字面量的内容（用于扫字符串派发）
 */
function strip(src) {
  const clean = [];
  const strings = [];
  let i = 0;
  const n = src.length;
  const longOpen = (at) => {
    // 尝试匹配 [=*[ ；返回 {level, len} 或 null
    if (src[at] !== '[') return null;
    let j = at + 1;
    while (src[j] === '=') j++;
    if (src[j] !== '[') return null;
    return { level: j - at - 1, len: j - at + 1 };
  };
  while (i < n) {
    const c = src[i];
    // 注释
    if (c === '-' && src[i + 1] === '-') {
      const lo = longOpen(i + 2);
      if (lo) {
        // 长注释
        const close = ']' + '='.repeat(lo.level) + ']';
        let j = i + 2 + lo.len;
        const end = src.indexOf(close, j);
        const stop = end < 0 ? n : end + close.length;
        for (let k = i; k < stop; k++) clean.push(src[k] === '\n' ? '\n' : ' ');
        i = stop;
        continue;
      }
      // 行注释
      while (i < n && src[i] !== '\n') { clean.push(' '); i++; }
      continue;
    }
    // 长字符串
    const lo = longOpen(i);
    if (lo) {
      const close = ']' + '='.repeat(lo.level) + ']';
      let j = i + lo.len;
      const end = src.indexOf(close, j);
      const stop = end < 0 ? n : end + close.length;
      strings.push(src.slice(j, end < 0 ? n : end));
      for (let k = i; k < stop; k++) clean.push(src[k] === '\n' ? '\n' : ' ');
      i = stop;
      continue;
    }
    // 短字符串
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let buf = '';
      while (j < n) {
        const d = src[j];
        if (d === '\\') { buf += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (d === quote) break;
        if (d === '\n') break; // 未闭合，容错
        buf += d;
        j++;
      }
      strings.push(buf);
      const stop = Math.min(j + 1, n);
      for (let k = i; k < stop; k++) clean.push(src[k] === '\n' ? '\n' : ' ');
      i = stop;
      continue;
    }
    clean.push(c);
    i++;
  }
  return { clean: clean.join(''), strings };
}

const FILES = collect(path.join(ROOT, 'lua'));
const TEST_FILES = collect(path.join(ROOT, 'tests'));
const TOOL_FILES = collect(path.join(ROOT, 'tools'));

const MOD = {};
for (const f of [...FILES, ...TEST_FILES, ...TOOL_FILES]) {
  const raw = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
  const { clean, strings } = strip(raw);
  MOD[f] = {
    rel: path.relative(ROOT, f).replace(/\\/g, '/'),
    clean,
    strings,
    raw,
    size: raw.length,
    lines: raw.split('\n').length,
  };
}

const prodClean = FILES.map((f) => MOD[f].clean).join('\n');
const testClean = TEST_FILES.map((f) => MOD[f].clean).join('\n');
const toolClean = TOOL_FILES.map((f) => MOD[f].clean).join('\n');
const allStrings = [...FILES, ...TEST_FILES, ...TOOL_FILES].flatMap((f) => MOD[f].strings).join('\u0000');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function countWord(text, name) {
  const re = new RegExp(`(?<![A-Za-z0-9_])${esc(name)}(?![A-Za-z0-9_])`, 'g');
  return (text.match(re) || []).length;
}
function countMethod(text, name) {
  const re = new RegExp(`[.:]\\s*${esc(name)}(?![A-Za-z0-9_])`, 'g');
  return (text.match(re) || []).length;
}

/** 行号查找：把 clean 的字符偏移换算成行号 */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** 抽定义 */
function defs(file) {
  const { clean } = MOD[file];
  const out = [];
  const push = (m, name, kind, owner) => {
    out.push({ file: MOD[file].rel, line: lineAt(clean, m.index), name, kind, owner: owner ?? null });
  };
  // function A.b( / function A:b( / function b(
  {
    const re = /(?<![A-Za-z0-9_.:])function\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*[.:]\s*([A-Za-z_][A-Za-z0-9_]*))?\s*\(/g;
    let m;
    while ((m = re.exec(clean))) {
      if (m[2]) {
        const isLocal = /local\s+function\s*$/.test(clean.slice(Math.max(0, m.index - 20), m.index + 8));
        push(m, m[2], isLocal ? 'local' : 'method', m[1]);
      } else {
        const before = clean.slice(Math.max(0, m.index - 20), m.index);
        const isLocal = /local\s+$/.test(before);
        push(m, m[1], isLocal ? 'local' : 'global', null);
      }
    }
  }
  // A.b = function / A:b = function
  {
    const re = /([A-Za-z_][A-Za-z0-9_]*)\s*([.:])\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\s*\(/g;
    let m;
    while ((m = re.exec(clean))) {
      const isLocal = /local\s+$/.test(clean.slice(Math.max(0, m.index - 20), m.index));
      push(m, m[3], isLocal ? 'local' : 'method', m[1]);
    }
  }
  // ["key"] = function  /  key = function （表构造器里的条目，可能是"实现表"）
  {
    const re = /(?:\[\s*["']([^"']+)["']\s*\]|(?<![.\[,:])([A-Za-z_][A-Za-z0-9_]*))\s*=\s*function\s*\(/g;
    let m;
    while ((m = re.exec(clean))) {
      const name = m[1] || m[2];
      if (!name) continue;
      push(m, name, 'table-entry', null);
    }
  }
  return out;
}

const ALL_DEFS = FILES.flatMap(defs);

/** 动态派发表：被非字面量下标 / 变量下标取过的表名 */
const dynamicTables = new Set();
for (const f of [...FILES, ...TEST_FILES]) {
  const { clean } = MOD[f];
  const re = /([A-Za-z_][A-Za-z0-9_.]*)\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/g;
  let m;
  while ((m = re.exec(clean))) dynamicTables.add(m[1]);
}

/** 每个定义的引用计数 */
const results = [];
for (const d of ALL_DEFS) {
  const own = MOD[path.join(ROOT, d.file)] || MOD[d.file];
  const corpusProd = d.kind === 'local' ? MOD[path.join(ROOT, d.file)]?.clean ?? '' : prodClean;
  const selfRefs =
    (d.kind === 'local' || d.kind === 'global' ? countWord(corpusProd, d.name) : countMethod(corpusProd, d.name)) - 1;
  const prodRefs = d.kind === 'local' ? selfRefs : countMethod(prodClean, d.name) - 1;
  const testRefs = countMethod(testClean, d.name) + countWord(testClean, d.name);
  const toolRefs = countMethod(toolClean, d.name) + countWord(toolClean, d.name);
  const strRefs = allStrings.includes(d.name) ? 1 : 0;
  const inDynamicTable = d.kind === 'table-entry' || [...dynamicTables].some((t) => t.endsWith('.' + d.owner) || t === d.owner);
  results.push({ ...d, prodRefs: Math.max(prodRefs, 0), testRefs, toolRefs, strRefs, inDynamicTable });
}

const dead = results.filter((r) => r.prodRefs <= 0);
const deadStrict = dead.filter((r) => r.testRefs === 0 && r.toolRefs === 0 && !r.inDynamicTable);
const testOnly = dead.filter((r) => r.testRefs > 0 || r.toolRefs > 0);
const dynamicUnknown = dead.filter((r) => r.inDynamicTable);

// 汇总
const byFile = {};
for (const d of ALL_DEFS) byFile[d.file] = (byFile[d.file] || 0) + 1;

console.log('══════ 脚本必要性机械扫描 ══════');
console.log(`Lua 文件：prod ${FILES.length} · test ${TEST_FILES.length} · tool ${TOOL_FILES.length}`);
console.log(`定义总数：${ALL_DEFS.length}`);
for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${f}`);
console.log(`\nprod 侧零引用：${dead.length}  （其中 test/tool 也没有 = ${deadStrict.length}；动态派发不确定 = ${dynamicUnknown.length}；测试/工具在用 = ${testOnly.length}）`);

const fmt = (r) => `${r.file}:${r.line}  ${r.owner ? r.owner + (r.kind === 'method' ? ':' : '.') : ''}${r.name}`;
console.log('\n── prod 零引用且 test/tool 也不用（最可能是死代码）──');
for (const r of deadStrict) console.log('  ' + fmt(r));
console.log('\n── prod 零引用但测试/工具在用 ──');
for (const r of testOnly) console.log(`  ${fmt(r)}   test=${r.testRefs} tool=${r.toolRefs}`);
console.log('\n── prod 零引用但在动态派发表里（不能只凭静态断言）──');
for (const r of dynamicUnknown) console.log('  ' + fmt(r));
console.log('\n── 被变量下标取过的表（动态派发风险）──');
console.log('  ' + [...dynamicTables].sort().join(' '));

if (WRITE) {
  const outDir = path.join(ROOT, 'docs', '审计-脚本必要性');
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    basis: 'strip comments/strings → count identifier refs; prod=lua/**, test=tests/**, tool=tools/**/*.lua',
    files: { prod: FILES.map((f) => MOD[f].rel), test: TEST_FILES.map((f) => MOD[f].rel), tool: TOOL_FILES.map((f) => MOD[f].rel) },
    dynamicTables: [...dynamicTables].sort(),
    defs: results,
  };
  fs.writeFileSync(path.join(outDir, 'raw-deadcode.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n已写：docs/审计-脚本必要性/raw-deadcode.json`);
}
