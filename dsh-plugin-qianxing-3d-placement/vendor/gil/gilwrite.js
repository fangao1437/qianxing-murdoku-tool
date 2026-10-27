// tools/gil/gilwrite.mjs —— **写 `.gil` 的唯一安全通道**（+ 字段级 diff 核心）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么必须有这个模块（2026-10-10 立 ✓ 血的教训）
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 事故：`fix_clue_tpl_origin.mjs` **连续两次**报告"写入成功 ✓"，
//     而**输出文件与输入逐字节完全相同**（SHA256 一致 ✗）—— ★ **等于什么都没写** ✗。
//     ★ 更坏的是：★ 它**打印了 `✅ 成功` 和 `✅ 位置 = (0,0)`** ✗
//       （★ 那个 `(0,0)` 是**内存里**的值 ✓，**不是从磁盘重读出来的** ✗）
//     ⇒ ★★ **"内存改了就当成功"** 是这类 bug 的**唯一温床** ✓✓
//
//   ★ 为什么会发生：真因在 `encodeMsg` 的 `#503` 特例（见 `gilread.mjs` 该函数注释）
//     ⇒ ★ 但**没有任何机制**能在"编辑没落地"时把它喊出来 ✗
//     ⇒ ★ 每个写工具各自手写"写文件 + 打印成功" ✓ ⇒ **静默失败无从发现** ✗
//
//   ⇒ ★★★ 本模块的作用：★ **把"写"变成一条【不可绕过的检查链】** ✓
//     ★ 任何写 `.gil` 的工具都应该调 `writeGil()` ✓，而它**逐个断言**：
//       ① 编码 → 字节；② **输出必须与输入不同**（否则＝编辑没生效 ✗）
//       ③ **落盘**；④ ★★ **从磁盘重新读**（不是复用内存 ✗）；
//       ⑤ **往返闸门**：重新编码必须与落盘字节逐字节一致；
//       ⑥ **字段级 diff**：逐节点报出"到底改了什么"，并可按预期条数断言 ✓
//     ★ 任何一步不过 ⇒ **抛异常** ✓（★ 静默跳过是敌人 ✗）
//
//   ★ 纪律（写工具的人必须遵守）：
//     · ★ **不许自己 `fs.writeFileSync` 一个 `.gil`** ✗ —— 走 `writeGil()` ✓
//     · ★ **不许用内存里的值当验收** ✗ —— 用 `writeGil` 返回的 `report.g2`（**已重读磁盘** ✓）
//     · ★ **只改一个值就断言 diff 条数** ✓ —— `expectDiffs: 2`（例：两个 float 分量）
//
// 用法（工具里）：
//   import { writeGil } from './gilwrite.mjs';
//   const rep = writeGil(g, OUT, {
//     label: 'clue 模板归零',
//     expectDiffs: 2,                       // ★ 只允许 2 处字段差异
//     assert: (g2) => {                     // ★ 自定义断言，用【重读磁盘】的那份
//       const t = g2.recs.find((r) => r.name === 'clue');
//       return pairValue(pairOf(t.states[0], 504), 0) === 0 || 'clue.x 应为 0';
//     },
//   });
//
// 命令行（对已有工具/存档做通用验收）：
//   node tools/gil/gilwrite.mjs diff <A.gil> <B.gil>     # 字段级差异（等价 diff_fields.mjs）

import fs from 'node:fs';
import path from 'node:path';
import { parseMsg, encodeMsg, recordsOf } from './gilread.js';

// ── 载入（不复用 readGil 的对象，保证"两份独立解析"可比对）──────────────────
//   ★ 返回的 `recs` 与 `readGil().recs` 同构 ✓ —— 这样 `assert(g2)` 里可以直接
//     `g2.recs.find(r => r.name === …)` ✓（★ 2026-10-10 自测踩到过它没有 `recs` ✗）
export function loadTree(file) {
  const src = fs.readFileSync(file);
  const hdr = []; for (let i = 0; i < 5; i++) hdr.push(src.readUInt32BE(i * 4));
  const bodyEnd = 20 + hdr[4];
  const tree = parseMsg(src, 20, bodyEnd, 0);
  if (!tree) throw new Error('体解析失败：' + file);
  const recs = recordsOf(tree);
  const owner = new Map();
  for (const r of recs) owner.set(r.field, (r.name || '?') + ' #' + r.id);
  return {
    file, src, hdr, bodyEnd, trailer: src.subarray(bodyEnd), tree, owner, recs,
    byName: new Map(recs.filter((r) => r.name).map((r) => [r.name, r])),
  };
}

const hex = (b, n = 16) => b.subarray(0, Math.min(n, b.length)).toString('hex') + (b.length > n ? '…' : '');
const fmtF = (b) => String(b.readFloatLE(0));

/**
 * 字段级 diff 核心：并行下走两棵字段树，逐节点比 `(字段号, wire type, 值)`。
 * ★ 比"字节"更严的是：它能说明**变的是哪个字段** ✓；比"逐字节相同"更严的是：
 *   它能把"结构坏了"（长度前缀错位 / 字段顺序变）也报出来 ✓。
 */
export function diffTrees(A, B, max = 50) {
  const diffs = [];
  let compared = 0;
  const ownerLabel = (chain) => {
    for (let i = chain.length - 1; i >= 0; i--) {
      const l = A.owner.get(chain[i]) || B.owner.get(chain[i]);
      if (l) return l;
    }
    return '(非控件记录)';
  };
  const push = (kind, where, detail, ctx) => diffs.push({ kind, where, detail, ctx });

  (function walk(fa, fb, pathStr, chain, depth) {
    if (fa.length !== fb.length) {
      push('子字段个数不同', pathStr, `A=${fa.length} 个  B=${fb.length} 个`, ownerLabel(chain));
    }
    const n = Math.min(fa.length, fb.length);
    for (let i = 0; i < n; i++) {
      const x = fa[i], y = fb[i];
      const p = pathStr + '#' + x.field + '[' + i + ']';
      const ctx = ownerLabel([...chain, x]);
      compared++;
      if (x.field !== y.field || x.wt !== y.wt) {
        push('字段号/类型不同', p, `A=#${x.field}/wt${x.wt}  B=#${y.field}/wt${y.wt}`, ctx);
        continue;
      }
      if (x.wt === 0) {
        if (x.num !== y.num) push('varint 值变化', p, `${x.num} → ${y.num}`, ctx);
      } else if (x.wt === 5) {
        const ra = A.src.subarray(x.s1 - 4, x.s1), rb = B.src.subarray(y.s1 - 4, y.s1);
        if (!ra.equals(rb)) push('float 值变化', p, `${fmtF(ra)} (${ra.toString('hex')}) → ${fmtF(rb)} (${rb.toString('hex')})`, ctx);
      } else if (x.wt === 1) {
        const ra = A.src.subarray(x.s1 - 8, x.s1), rb = B.src.subarray(y.s1 - 8, y.s1);
        if (!ra.equals(rb)) push('fixed64 值变化', p, `${hex(ra, 8)} → ${hex(rb, 8)}`, ctx);
      } else if (x.sub !== null && y.sub !== null) {
        walk(x.sub, y.sub, p + '/', [...chain, x], depth + 1);
      } else if (x.sub !== null || y.sub !== null) {
        push('结构不同（一边是消息、一边是裸字节）', p,
          `A.sub=${x.sub ? x.sub.length + '子' : 'null'}  B.sub=${y.sub ? y.sub.length + '子' : 'null'}`, ctx);
      } else {
        const pa = x.payload || Buffer.alloc(0), pb = y.payload || Buffer.alloc(0);
        if (!pa.equals(pb)) push('裸 payload 变化', p, `${pa.length}B ${hex(pa)} → ${pb.length}B ${hex(pb)}`, ctx);
      }
    }
    // 深度保护：与 parseMsg 的深度上限一致，正常存档远达不到
    if (depth > 40) push('递归过深', pathStr, '> 40 层', ownerLabel(chain));
  })(A.tree, B.tree, '/', [], 0);

  return { compared, diffs: diffs.slice(0, max), total: diffs.length };
}

export function diffGilFiles(fa, fb, max = 50) {
  return diffTrees(loadTree(fa), loadTree(fb), max);
}

// ── 内嵌脚本的"版本标记" ──────────────────────────────────────────────────
//   ★★★ 为什么需要它（2026-10-10 lead 点名 ✓）：
//     ★ 叠脚本的工具**只断言"字节变了"是不够的** ✗ ——
//       ★ **字节变了、但叠进去的是【旧脚本】，一样是静默失败** ✗✓
//       （★ 实测事故：`295` 里内嵌的脚本是旧的 1099635B，而 `dist` 已经 1107369B ✓）
//     ★ 而"内嵌 == `dist/client_script.lua`"这种自检是**循环论证** ✗：
//       ★ 它只证明"复制成功" ✓，**证明不了 `dist` 本身是新的** ✗
//     ⇒ ★ 所以必须断言一个**独立可读的版本事实** ✓：
//       ★ `lua/entry_client_script.lua` 里的 `print("[murdoku] ===== 构建标记 vNNN / 日期 / 说明 =====")`
//       ★ 取 `vNNN` 那一段 ✓ —— ★ 它在**日志第一行**打出来 ✓，是**人和机器都能看的事实** ✓
export const MARKER_RE = /构建标记\s*(v\d{2,4})/;

export function markerOf(buf) {
  const m = Buffer.isBuffer(buf) ? buf.toString('utf8').match(MARKER_RE) : String(buf).match(MARKER_RE);
  return m ? m[1] : null;
}

/** 树里"内嵌脚本"那个叶子：最大的、像 Lua 的文本字段（判据与 `find_script.mjs` 一致 ✓） */
export function findScriptLeaf(g, minBytes = 2000) {
  let best = null;
  (function walk(fields, p) {
    for (const f of fields) {
      const here = p + '/#' + f.field;
      if (f.wt === 2 && f.sub === null && f.payload && f.payload.length > minBytes) {
        const s = f.payload.toString('utf8');
        if ((s.match(/\uFFFD/g) || []).length < f.payload.length * 0.01 && /function\s|local\s/.test(s)) {
          if (!best || f.payload.length > best.len) best = { len: f.payload.length, path: here, buf: f.payload, field: f };
        }
      }
      if (f.sub) walk(f.sub, here);
    }
  })(g.tree, '');
  return best;
}

// ── 落盘 + 全套断言 ───────────────────────────────────────────────────────
export class GilWriteError extends Error {}

/**
 * ★★★ **写 `.gil` 的唯一通道** —— 7 步全过才返回，任何一步不过就抛异常 ✓
 *
 * @param g    `readGil(输入)` 的返回值（★ 已在其 `tree` 上改好值 ✓）
 * @param out  输出路径
 * @param opts {
 *   label        本次编辑的名字（只用于打印）
 *   mustDiffer   默认 true —— ★ 输出与【输入文件】逐字节相同 ⇒ 抛异常 ✓（"编辑没生效" ✗）
 *   expectRecs   期望输出记录数（默认 = 输入记录数 ✓；加/删记录的工具显式传，或传 null 跳过 ✓）
 *   expectDiffs  期望字段差异条数（数字 ✓）；★ 只改一个值就写它 ✓
 *   assert       `(g2, report) => true | string` —— ★ g2 是**从磁盘重读**的 ✓；返回字符串＝失败原因 ✓
 *   quiet        不打印报告
 * }
 * @returns {{bytes:number, diffs:number, compared:number, list:Array, g2:object, sha256Like:string}}
 */
export function writeGil(g, out, opts = {}) {
  const {
    label = 'writeGil', mustDiffer = true, expectRecs = g.recs ? g.recs.length : undefined,
    expectDiffs, assert, expectMarker, quiet = false,
  } = opts;
  const say = (s) => { if (!quiet) console.log(s); };

  // ① 编码
  const body = encodeMsg(g.tree);
  const buf = typeof g.pack === 'function' ? g.pack(body) : (() => {
    const head = Buffer.alloc(20);
    head.writeUInt32BE(20 + body.length + g.trailer.length - 4, 0);
    head.writeUInt32BE(g.hdr[1], 4); head.writeUInt32BE(g.hdr[2], 8); head.writeUInt32BE(g.hdr[3], 12);
    head.writeUInt32BE(body.length, 16);
    return Buffer.concat([head, body, g.trailer]);
  })();

  // ② ★ 输出必须与输入不同 —— 否则就是"改了却写不进去" ✗
  if (mustDiffer && buf.equals(g.src)) {
    throw new GilWriteError(
      `[${label}] ★★ 输出与输入**逐字节相同** ⇒ 编辑【没有生效】✗\n`
      + `   这不是"没必要写"，而是**写路径断了** ✗ —— 检查：\n`
      + `     · encodeMsg 是否真的递归到了你改的那个节点（★ 历史真因：某个父字段被"冻结"用了旧 payload ✗）\n`
      + `     · 你改的对象是否在 g.tree 的对象图里（不是 clone ✗）`);
  }

  // ③ 落盘
  fs.writeFileSync(out, buf);

  // ④ ★★ 从磁盘重新读（★ 决不复用内存 ✓）
  const g2 = (() => {
    // 用 readGil 才能拿到 recs/pack；动态 import 避免循环依赖
    return loadTree(out);
  })();

  // ⑤ 往返闸门：重编码必须与落盘字节逐字节一致
  const body2 = encodeMsg(g2.tree);
  const rereadBody = g2.src.subarray(20, 20 + g2.hdr[4]);
  if (!body2.equals(rereadBody)) {
    throw new GilWriteError(`[${label}] ★ 往返闸门失败：输出文件重编码与自身字节不一致 ✗（写出的东西不是稳定形态 ✗）`);
  }

  // ⑥ 记录数断言
  const recs2 = g2.recs;
  if (expectRecs != null && recs2.length !== expectRecs) {
    throw new GilWriteError(`[${label}] ★ 记录数变了：期望 ${expectRecs}，实得 ${recs2.length} ✗`);
  }

  // ⑦ 字段级 diff：★ 逐节点说明"到底改了什么" ✓
  const A = loadTree(g.file), B = loadTree(out);
  const d = diffTrees(A, B, 50);
  if (expectDiffs != null && d.total !== expectDiffs) {
    throw new GilWriteError(`[${label}] ★ 字段差异条数不符：期望 ${expectDiffs}，实得 ${d.total} ✗\n`
      + d.diffs.slice(0, 10).map((x) => `     [${x.kind}] ${x.where}  ${x.detail}`).join('\n'));
  }

  // ⑧ 自定义断言（★ 用重读磁盘的 g2 ✓）
  if (typeof assert === 'function') {
    const r = assert(g2, { diffs: d, bytes: buf.length });
    if (r !== true && r !== undefined) throw new GilWriteError(`[${label}] ★ 断言失败：${r} ✗`);
  }

  // ⑨ ★ 内嵌脚本的版本标记断言（★ 可选 ✓；叠脚本的工具**必须**传 ✓）
  let marker = null;
  if (expectMarker !== undefined) {
    const leaf = findScriptLeaf(g2);
    if (!leaf) throw new GilWriteError(`[${label}] ★ 重读后找不到内嵌脚本叶子 ⇒ 标记无法断言 ✗（★ 不许静默放过 ✗）`);
    marker = markerOf(leaf.buf);
    if (marker !== expectMarker) {
      throw new GilWriteError(
        `[${label}] ★★ 内嵌脚本的版本标记不符：期望 ${expectMarker}，实得 ${marker} ✗\n`
        + `   ⇒ ★ 这通常意味着【叠进去的是旧脚本】✗ —— 先跑 \`lua tools/bundle_client_script.lua\` 重建 dist ✓\n`
        + `   （★ "字节变了"并不等于"叠对了版本" ✗ —— 这正是 2026-10-10 那次静默失败 ✓）`);
    }
  }

  const rep = { bytes: buf.length, diffs: d.total, compared: d.compared, list: d.diffs, g2, recs: recs2.length, marker };
  say(`\n── writeGil 验收（${label}）──`);
  say(`  ✅ ② 输出 ≠ 输入（${g.src.length} → ${buf.length} 字节）`);
  say(`  ✅ ④ 已从磁盘重读 ${path.basename(out)}（记录 ${recs2.length} 条）`);
  say(`  ✅ ⑤ 往返闸门：重编码与落盘字节逐字节一致`);
  say(`  ✅ ⑦ 字段级 diff：比过 ${d.compared} 个节点，差异 ${d.total} 处` + (d.total ? `（${[...new Set(d.diffs.map((x) => x.kind))].join('、')}）` : ''));
  for (const x of d.diffs.slice(0, 6)) say(`       · [${x.kind}] ${x.ctx}  ${x.detail}`);
  if (d.total > 6) say(`       …还有 ${d.total - 6} 处`);
  if (marker) say(`  ✅ ⑨ 内嵌脚本版本标记 = ${marker}（★ 独立事实，不是"复制成功"的循环论证 ✓）`);
  return rep;
}
