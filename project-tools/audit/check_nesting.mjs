#!/usr/bin/env node
// tools/audit/check_nesting.mjs —— 机械扫描「块嵌套与缩进不一致」的 Lua 源文件
//
// 为什么需要它（本轮实测抓到的两个真凶都是这个形状）：
//   Lua 里 `end` 配对错位**不会报错**（只要总数平衡，文件照样编译通过），
//   但会把后面的**顶层语句吞进上面某个块里**。代价是"整个功能静默失效"：
//     · `lua/engine_adapter_qianxing.lua` 的 `if self.cfg.btn_art == true and print then`
//       没被关闭 ⇒ `Adapter:apply_ruler_layout` / `Adapter:diagnose_overlap`
//       两个**方法定义**被吞进 `apply_tray_layout` 的函数体 ⇒ 加载时根本不存在
//       ⇒ 调用点的 `if adapter.xxx ~= nil then` 守卫静默跳过 ⇒ 功能从未运行、零报错。
//     · `lua/main.lua` 的 `if (current.frames or 0) % 300 == 0 then` 没被关闭
//       ⇒ 把"每帧压住 selbar / 每 30 帧点亮 face"整段套进去 ⇒ 节流变成每 300 帧。
//   判据（**只看缩进与块深度的矛盾**，不猜语义）：
//     **缩进为 0（作者认为它是顶层）的 `function` / `if` / `for` / `while` / `do`，
//       如果它所在的块深度 > 0 ⇒ 必然是 `end` 配对错位。**
//   这条判据在本仓的历史 bug 上是**零误报**的（见文件末尾的判读说明）。
//
// 跑法：node tools/audit/check_nesting.mjs [文件或目录 ...]
//       不给参数 = 扫 lua/**.lua
// 退出码：0 = 干净；1 = 有命中；2 = 读文件失败
//
// ⚠️ 本工具**只读**，不修改任何文件。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..', '..');

// ── 1. 去掉注释与字符串（保留换行，行号才不会漂）────────────────────────────
export function blankCommentsAndStrings(src) {
  const out = Buffer.from(src, 'utf8');           // 按字节处理 ASCII 结构符即可
  const n = out.length;
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (out[k] !== 10 && out[k] !== 13) out[k] = 32; };
  while (i < n) {
    const c = out[i];
    // 长括号 [[ / [=[ …
    if (c === 91 /* [ */) {
      let j = i + 1, eq = 0;
      while (j < n && out[j] === 61 /* = */) { eq++; j++; }
      if (j < n && out[j] === 91) {
        const close = Buffer.from(']' + '='.repeat(eq) + ']', 'utf8');
        const end = out.indexOf(close, j + 1);
        const stop = end === -1 ? n : end + close.length;
        blank(i, stop);
        i = stop;
        continue;
      }
      i++; continue;
    }
    // 行注释 / 长注释
    if (c === 45 /* - */ && out[i + 1] === 45) {
      let j = i + 2;
      if (out[j] === 91) {                       // --[[ 长注释
        let k = j + 1, eq = 0;
        while (k < n && out[k] === 61) { eq++; k++; }
        if (k < n && out[k] === 91) {
          const close = Buffer.from(']' + '='.repeat(eq) + ']', 'utf8');
          const end = out.indexOf(close, k + 1);
          const stop = end === -1 ? n : end + close.length;
          blank(i, stop);
          i = stop;
          continue;
        }
      }
      let k = j;
      while (k < n && out[k] !== 10) k++;        // 普通行注释
      blank(i, k);
      i = k;
      continue;
    }
    // 短字符串
    if (c === 34 || c === 39) {
      let k = i + 1;
      while (k < n) {
        if (out[k] === 92 /* \ */) { k += 2; continue; }
        if (out[k] === c) { k++; break; }
        if (out[k] === 10) break;                // 未闭合（源文件本来就坏了）
        k++;
      }
      blank(i + 1, Math.min(k, n) - 1);
      i = k;
      continue;
    }
    i++;
  }
  return out.toString('utf8');
}

// ── 2. 词法：按行给出"这一行出现的关键字 + 该行之前的块深度"──────────────────
const NEED_END = new Set(['function', 'if', 'do', 'for', 'while', 'repeat']);
const THROTTLE = /%\s*(\d+)\s*\)*\s*==\s*0/;   // 本仓的每帧节流写法：`(frames % 30) == 0` / `frames % 30 == 0`

export function scanBlocks(src) {
  const clean = blankCommentsAndStrings(src);
  const lines = clean.split(/\r?\n/);
  let depth = 0, pendingDo = 0;
  const rows = [];
  const stack = [];                            // 每个块的种类与"它守卫里的节流数"
  for (let li = 0; li < lines.length; li++) {
    const before = depth;
    const text = lines[li];
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    let m;
    const kws = [];
    while ((m = re.exec(text)) !== null) kws.push(m[0]);
    // 这一行的守卫里的节流数（用于下一层的"被套住"判定）
    const tm = text.match(THROTTLE);
    const throttle = tm ? parseInt(tm[1], 10) : null;
    for (const w of kws) {
      switch (w) {
        case 'function': depth++; stack.push('function'); break;
        case 'if': depth++; stack.push(throttle != null ? `if:${throttle}` : 'if'); break;
        case 'for': case 'while': depth++; pendingDo++; stack.push(w); break;
        case 'do':
          if (pendingDo > 0) { pendingDo--; }        // for/while 的 do：不新开块
          else { depth++; stack.push('do'); }
          break;
        case 'end': depth--; stack.pop(); break;
        case 'repeat': depth++; stack.push('repeat'); break;
        case 'until': depth--; stack.pop(); break;
        default: break;
      }
    }
    rows.push({ line: li + 1, text, depthBefore: before, depthAfter: depth,
                throttle, stack: stack.slice() });
  }
  return { rows, finalDepth: depth };
}

// ── 3a. 判据：缩进 0 的块开头，块深度却 > 0 ────────────────────────────────
const TOP_DECL = /^(local\s+)?function\s/;
const TOP_BLOCK = /^(if|for|while|do|repeat)\b/;

// ── 3b. 判据：**嵌套的每帧节流** —— 内层永远不会以它自己的频率生效 ──────────
//   本仓的节流习惯是 `if (frames % N) == 0 then`。若外层有一个更大的 M（M > N），
//   内层那一段实际只在 frames % M == 0 时才被求值 ⇒ "每 30 帧"退化成"每 300 帧"。
//   这不是风格问题：`main.lua` 正是这么把"每帧压住 selbar / 每 30 帧点亮 face"
//   退化成了每 300 帧（用户报的"关卡里选关条压着棋盘"就是这么来的）。
function throttlesFor(row) {
  if (row.throttle == null) return null;
  const outer = row.stack.filter((s) => typeof s === 'string' && s.startsWith('if:'));
  if (outer.length === 0) return null;
  let maxOuter = 0;
  for (const s of outer) {
    const v = parseInt(s.slice(3), 10);
    if (v > maxOuter) maxOuter = v;
  }
  if (maxOuter > row.throttle) return { inner: row.throttle, outer: maxOuter };
  return null;
}

export function checkFile(file) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return { file, error: String(e) }; }
  const { rows, finalDepth } = scanBlocks(src);
  const hits = [], throttled = [];
  for (const r of rows) {
    if (r.text.length !== 0 && !/^\s/.test(r.text)) {   // 只看**顶格**的行
      const isDecl = TOP_DECL.test(r.text);
      const isBlock = TOP_BLOCK.test(r.text);
      if ((isDecl || isBlock) && r.depthBefore > 0) {
        hits.push({ line: r.line, depth: r.depthBefore, kind: isDecl ? 'function' : 'block', text: r.text.trim() });
      }
    }
    const th = throttlesFor(r);
    if (th) throttled.push({ line: r.line, text: r.text.trim(), ...th });
  }
  return { file, hits, throttled, finalDepth };
}

// ── 4. CLI ─────────────────────────────────────────────────────────────────
function walk(p, acc) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) walk(path.join(p, e), acc);
  } else if (p.endsWith('.lua')) acc.push(p);
  return acc;
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  // 查询模式：--depths=<文件>[:起始行[-结束行]]  打印每一行的块深度
  //   用途：回答"这一行到底在不在那个 if 里面" —— 缩进只说明作者的想法，深度才是事实。
  const dq = args.find((a) => a.startsWith('--depths='));
  if (dq) {
    const spec = dq.slice('--depths='.length);
    const mm = spec.match(/^(.*?):(\d+)(?:-(\d+))?$/);
    const file = path.resolve(mm ? mm[1] : spec);
    const from = mm ? parseInt(mm[2], 10) : 1;
    const to = mm && mm[3] ? parseInt(mm[3], 10) : from + 40;
    const src = fs.readFileSync(file, 'utf8');
    const { rows, finalDepth } = scanBlocks(src);
    console.log(`# ${path.relative(ROOT, file).replace(/\\/g, '/')}  行 ${from}..${to}  全文末深度=${finalDepth}`);
    for (const r of rows) {
      if (r.line < from || r.line > to) continue;
      const mark = r.depthBefore === 0 ? ' ' : '│'.repeat(r.depthBefore);
      console.log(`${String(r.line).padStart(5)} d${r.depthBefore} ${mark} ${r.text.trim().slice(0, 90)}`);
    }
    process.exit(0);
  }
  const targets = args.length ? args : [path.join(ROOT, 'lua')];
  const files = [];
  for (const t of targets) {
    try { walk(path.resolve(t), files); }
    catch (e) { console.error('读不了 ' + t + '：' + e.message); process.exit(2); }
  }
  files.sort();
  let bad = 0, unbalanced = 0, thr = 0;
  for (const f of files) {
    const r = checkFile(f);
    if (r.error) { console.error('读不了 ' + f + '：' + r.error); bad++; continue; }
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (r.finalDepth !== 0) {
      unbalanced++;
      console.log(`[不平衡] ${rel}  —— 全文扫完块深度 = ${r.finalDepth}（应为 0）`);
    }
    for (const h of r.hits) {
      bad++;
      console.log(`[嵌套] ${rel}:${h.line}  深度=${h.depth}  ${h.kind}  ::  ${h.text}`);
    }
    for (const t of r.throttled) {
      thr++;
      console.log(`[节流嵌套] ${rel}:${t.line}  外层每 ${t.outer} 帧 / 内层每 ${t.inner} 帧`
        + ` ⇒ 内层实际只在 frames%%${t.outer}==0 时求值  ::  ${t.text.slice(0, 80)}`);
    }
  }
  console.log('');
  console.log(`扫描 ${files.length} 个 .lua；[嵌套] ${bad} 处；[节流嵌套] ${thr} 处；块深度不平衡 ${unbalanced} 个文件。`);
  console.log('判读 [嵌套]      ：顶格写的块开头实际落在别的块里 ⇒ `end` 配对错位；');
  console.log('                   Lua 不报错，代价是**后面的顶层语句被吞进上面的块**（功能静默失效）。');
  console.log('判读 [节流嵌套]  ：`if (frames % N) == 0` 套在更大的 `% M == 0` 里 ⇒ 节流退化。');
  process.exit(bad === 0 && unbalanced === 0 && thr === 0 ? 0 : 1);
}
