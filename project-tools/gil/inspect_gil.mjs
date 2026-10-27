// tools/gil/inspect_gil.mjs —— **只读体检**：一个 `.gil` 跑一遍，把"出货前必须看的事实"全打出来
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么要有它（2026-10-10 lead 要求 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ lead 原话 ✓：「★ **用户正在测 `296`** ⇒ ★ 若回报"还是 −2" ✗，
//     我**要立刻能判断**是 `blk[0]` 不够、还是别的原因 ✓」
//   ⇒ ★★ 所以本工具把每次出货后**最常被问的几件事**一次打全 ✓：
//     ① 记录数 / 体长 / 尾部 ✓（文件是否是完整的那一份 ✓）
//     ② ★ **内嵌脚本的构建标记** ✓（★ 是不是 v148 ✓ —— 2026-10-10 就栽在这 ✓）
//     ③ ★★ **`clue` 的 4 个状态块【逐个】的位置与尺寸** ✓
//        （★ 用户说"还是从 −2 开始填"时，一眼看出是哪个块没归零 ✓）
//     ④ ★★ **`assets` 的子控件名单** ✓：名字 / id / 父引用 / 是否登记进子列表 ✓
//        （★ "`assets` 取不到"是这轮最耗时的坑 ✓ ⇒ ★ 这里把它固化成可复读的事实 ✓）
//     ⑤ ★ **`row.*` 各自的子列表条数** ✓（★ 齐全不齐全 ✓）
//   ★ **本工具只读** ✓ —— ★ 绝不写任何文件 ✓（★ 也不要给它加"顺手修一下"的功能 ✗）
//
// 用法：
//   node tools/gil/inspect_gil.mjs "296-模板归零+脚本v148.gil"
//   node tools/gil/inspect_gil.mjs <存档> --json          # 机器可读
//   node tools/gil/inspect_gil.mjs <存档> --quiet         # 只打结论
//
// 退出码：★ **0 = 体检完成**（★ 只读工具，不因"发现异常"而失败 ✓ —— 异常用 ⚠️/❌ 标出 ✓）
//          2 = 用法错 / 文件读不了
//
// ★ 复用：`assetsReport(g)` / `assertAssets(g)` 可被别的工具 import ✓
//   （★ `gen_palette.mjs` 就是这么用的 ✓ —— ★ 避免"assets 检查"被抄成第二份 ✗）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue, findChildListTop, asIdList, KNOWN_TYPES } from './gilread.mjs';
import { findScriptLeaf, markerOf } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 可复用：`assets` 子控件体检（★ 这就是 lead 要的"固化成工具" ✓）──────────
/**
 * @returns {{ok:boolean, id:number|null, list:number[], entries:Array, problems:string[]}}
 */
export function assetsReport(g) {
  const problems = [];
  const a = g.recs.find((r) => r.name === 'assets');
  if (!a) return { ok: false, id: null, list: [], entries: [], problems: ['存档里没有名为 assets 的记录 ✗'] };
  const cl = findChildListTop(a.field.sub);
  if (!cl) problems.push('assets 顶层没有子列表字段（#503）✗ ⇒ 编辑器眼里它是空容器 ✗');
  const list = cl ? (asIdList(cl.payload, true) || []) : [];
  const entries = [];
  for (const id of list) {
    const r = g.recs.find((x) => x.id === id);
    if (!r) { problems.push('子列表里的 id ' + id + ' 找不到对应记录 ✗'); entries.push({ id, name: null }); continue; }
    const hasDeeper = g.recs.some((x) => x.parentId === id);
    entries.push({ id, name: r.name, parentId: r.parentId, isChild: hasDeeper });
    if (r.parentId !== a.id) problems.push('子控件 ' + (r.name || '#' + id) + ' 的父引用 #504 = ' + r.parentId + '，应为 assets ' + a.id + ' ✗');
  }
  // 反向：挂了 assets 当父、却没登记进子列表的
  for (const r of g.recs) {
    if (r.parentId === a.id && !list.includes(r.id)) problems.push('记录 ' + (r.name || '#' + r.id) + ' 声明父为 assets，但没登记进 assets 子列表 ✗');
  }
  return { ok: problems.length === 0, id: a.id, list, entries, problems };
}

/** 给写工具用的断言：`writeGil({ assert: (g2) => assertAssets(g2, ['portrait.A', …]) })` */
export function assertAssets(g, expectNames = []) {
  const rep = assetsReport(g);
  if (!rep.ok) return rep.problems[0];
  for (const n of expectNames) {
    const hit = rep.entries.find((e) => e.name === n);
    if (!hit) return 'assets 子列表里找不到 ' + n + ' ✗';
  }
  return true;
}

// ── 可复用：模板"本体 / 实例"判定（★ 2026-10-10 lead 要求固化 ✓）────────────
/**
 * ★★★ 背景（★ 用户领域知识 ＋ 实测 ✓）：
 *   ★ 用户原话：「★ **模板存在一个实例和一个本体** ✓ —— ★ 旧项目里就遇到过 ✓
 *     ★ 只修改由模板产生的引用只会影响【实例侧】✓，★ 保存模板修改后才会影响【模板本身】✓
 *     ★ **它们两个以【不同的 id】存在于存档中** ✓」（★ "未必是事实，可查证" ✓）
 *   ★ 实测 `298` ✓：★ 有**两个** `clue` 记录，各自带**一整套独立子控件** ✓，且**都不在任何父的子列表里** ✓
 *     ⇒ ★ 与"它们是模板"吻合 ✓
 *
 * ★ 判定依据（★ 可执行的那一条 ✓）：★ **`clues.grid` 的 `itemPrefabIndex`**
 *   ★ 它在 `/#505/#503/#80/#506`（wt0 ✓）★ 实测 = **`1073742421`** ✓
 *   ⇒ ★★ **列表项运行时取的是 `#1073742421`** ✓
 *   ⚠️ ★ 这与用户"实例侧才生效"的观察**方向相反** ✗ ⇒ ★ **见下面的"命名之争" ✓**
 *
 * ⚠️⚠️ ★★★ **命名之争（★ 2026-10-10 记 ✓ 它是"命名之争"，不是"事实之争" ✓）**：
 *   ★ 同一天两个人给出的命名**相反** ✗ —— ★ 但**事实完全一致** ✓，只是**判据不同** ✓：
 *     | | 判据 | 对 `#1073742421` 的叫法 |
 *     | --- | --- | --- |
 *     | ★ 工具向（我） | ★ **`itemPrefabIndex` 指向谁** ✓ | 「引用 / 实例侧」 |
 *     | ★ 资料员 | ★ **顶层有没有 `#504`** ✓ | 「本体」（★ 顶层无父 ✓） |
 *   ★ **事实（两人都同意 ✓）**：
 *     · `#1073742421` ★ **顶层没有 `#504`** ✓ ＋ ★ **`itemPrefabIndex` 指向它** ✓
 *     · `#1073742428` ★ **顶层 `#504` = `ClientUIPrototypeHierarchyRoot`** ✓
 *   ⇒ ★★★ **所以本工具【不用"本体 / 实例"命名】** ✓ —— ★ 改用**两个不会引起分歧的名字** ✓：
 *     · `#1073742421` = ★ **「运行时列表项来源」**（★ 依据：`itemPrefabIndex` ✓ **可执行、可复核** ✓）
 *     · `#1073742428` = ★ **「模板层级根下的那份」**（★ 依据：父 id ✓ 同样是**可复核的事实** ✓）
 *   ★★ **为什么这样更好** ✓：★ **它不依赖"哪个该叫本体"这个约定** ✗ ⇒
 *     ★ **资料员查证若改变结论，本工具的输出不用改** ✓ —— ★ 只有"运行时来源"那条会变 ✓，
 *       而它**由 `itemPrefabIndex` 直接决定** ✓ ⇒ ★ **永远可复核** ✓✓
 *
 * ⚠️ ⚠️ ★★ 附带发现（★ 与 `#503` 同一类陷阱 ✓）：★ **`#506` 有【两种含义】** ✗
 *   · `/#505/#503/#80/#506` = **itemPrefabIndex**（值形如 `1073742421` ✓，★ 指向模板 ✓）
 *   · `/#505/#503/#81/#506` = **`50888`**（★ 大量按钮都有 ✓ —— ★ 明显是**别的语义** ✗）
 *   ⇒ ★★ **凡按字段号取值的代码，都要先确认【所在路径】** ✓ ——
 *     ★ 这正是 `#503` 那次事故的同一个教训 ✓（★ 见 `gilread.mjs` 事故档案 ✓）
 */
export function prefabReport(g) {
  const out = { roots: [], prefabIndex: [], sameName: [] };
  const textsOfAny = (fs2, o) => {
    for (const x of fs2) { if (x.wt === 2 && x.isText && x.len <= 64) o.push(x.payload.toString('utf8')); if (x.sub) textsOfAny(x.sub, o); }
    return o;
  };
  // ① 模板层级根：名字含 Prototype/Prefab 的带 id 节点（★ 它不是"控件记录"✗ —— 没有几何对 ✓）
  (function w(fs2, p) {
    for (const f of fs2) {
      const here = p + '/#' + f.field;
      if (f.sub) {
        const b = f.sub.find((x) => x.field === 501 && x.wt === 0);
        if (b && Number(b.num) > 1000000000) {   // ★ 只要【控件 id 量级】的 ✓（★ 排除 `#501=2` 那种枚举值 ✗）
          const nm = textsOfAny(f.sub, []).find((s) => !KNOWN_TYPES.has(s));
          if (nm && /Prototype|Prefab/i.test(nm)) out.roots.push({ id: Number(b.num), name: nm, path: here });
        }
        w(f.sub, here);
      }
    }
  })(g.tree, '');
  // ② itemPrefabIndex：值形如"指向某个记录 id"的 #506（★ 与 #81/#506=50888 那种区分开 ✓）
  (function w(fs2, p) {
    for (const f of fs2) {
      const here = p + '/#' + f.field;
      if (f.field === 506 && f.wt === 0 && g.recs.some((r) => r.id === Number(f.num))) {
        out.prefabIndex.push({ path: here, value: Number(f.num) });
      }
      if (f.sub) w(f.sub, here);
    }
  })(g.tree, '');
  // ③ 同名记录（≥2 个同名 = 本体/实例候选 ✓）＋ 是否被登记进父的子列表
  const byName = new Map();
  for (const r of g.recs) if (r.name) byName.set(r.name, [...(byName.get(r.name) || []), r]);
  const isRegistered = (r) => g.recs.some((p) => {
    if (!p.childList || !(p.childList.payload || Buffer.alloc(0)).length) return false;
    let q = 0; const pay = p.childList.payload;
    while (q < pay.length) {
      let v = 0n, s = 0n, ok = false;
      while (q < pay.length) { const b = pay[q++]; v |= BigInt(b & 0x7f) << s; if ((b & 0x80) === 0) { ok = true; break; } s += 7n; }
      if (!ok) break; if (Number(v) === r.id) return true;
    }
    return false;
  });
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    // ★★ 只报【模板样】的同名组 ✓ —— ★ **全体都没被登记进任何父的子列表** ✗
    //   （★ 否则 `bg`/`label` 这种"重名但正常挂着的子控件"会刷屏 ✗ —— 实测 44 组 ✗）
    if (!list.every((r) => !isRegistered(r))) continue;
    out.sameName.push({
      name,
      items: list.map((r) => ({ id: r.id, parentId: r.parentId, blocks: r.states.length, registered: false })),
    });
    if (out.sameName.length >= 8) break;   // ★ 上限 ✓（★ 免得刷屏 ✗）
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((s) => !s.startsWith('--'));
  const JSON_OUT = argv.includes('--json');
  const QUIET = argv.includes('--quiet');
  if (!file) { console.error('用法: node tools/gil/inspect_gil.mjs <存档.gil> [--json] [--quiet]'); process.exit(2); }
  const fp = path.isAbsolute(file) ? file : path.resolve(ROOT, file);
  if (!fs.existsSync(fp)) { console.error('找不到文件：' + fp); process.exit(2); }

  const g = readGil(fp);
  const out = { file: path.basename(fp), bytes: g.src.length, recs: g.recs.length, body: g.hdr[4] };
  const L = [];
  const p = (s) => { if (!QUIET) L.push(s); };

  p('文件：' + out.file + '（' + out.bytes + ' 字节，体 ' + out.body + '，尾部 ' + g.trailer.length + 'B）');
  p('记录：' + out.recs + ' 条');

  // ② 内嵌脚本 + 构建标记
  const leaf = findScriptLeaf(g);
  const marker = leaf ? markerOf(leaf.buf) : null;
  out.script = leaf ? { bytes: leaf.len, path: leaf.path, marker } : null;
  p('');
  p('── ② 内嵌脚本 ──');
  p('  ' + (leaf ? leaf.len + ' 字节 @' + leaf.path + '　★ 构建标记 = ' + (marker || '（找不到 ✗）') : '（没有内嵌脚本 ✗）'));
  try {
    const dist = path.join(ROOT, 'dist', 'client_script.lua');
    const src = path.join(ROOT, 'lua', 'entry_client_script.lua');
    const dm = fs.existsSync(dist) ? markerOf(fs.readFileSync(dist)) : null;
    const sm = fs.existsSync(src) ? markerOf(fs.readFileSync(src)) : null;
    out.markers = { embedded: marker, dist: dm, source: sm };
    p('  对照：源码 ' + (sm || '?') + '　dist ' + (dm || '?'));
    if (marker && dm && marker !== dm) p('  ❌ 内嵌脚本(' + marker + ') ≠ dist(' + dm + ') ⇒ 这份存档里的脚本不是当前版本 ✗');
    else if (marker && dm) p('  ✅ 与 dist 一致 ✓');
  } catch (e) { p('  （对照失败：' + e.message + '）'); }

  // ③ clue 的 4 个状态块（★ 用户报"还是 −2"时看这里 ✓）
  p('');
  p('── ③ clue 各状态块（★ 用户报"还是从负数开始填"就看这里 ✓）──');
  const clues = g.recs.filter((r) => r.name === 'clue');
  out.clues = [];
  if (!clues.length) p('  （没有名为 clue 的记录 ✗）');
  for (const r of clues) {
    const o = []; stateBlocks(r.field.sub, o);
    const blocks = o.map((blk, i) => {
      const pp = pairOf(blk, 504), ss = pairOf(blk, 505);
      return { i, pos: [pairValue(pp, 0), pairValue(pp, 1)], size: [pairValue(ss, 0), pairValue(ss, 1)] };
    });
    out.clues.push({ id: r.id, parentId: r.parentId, blocks });
    p('  clue #' + r.id + '（父 ' + r.parentId + '）状态块 ' + blocks.length + ' 个：');
    blocks.forEach((b) => p('     blk[' + b.i + '] pos=(' + b.pos[0] + ', ' + b.pos[1] + ')  size=(' + b.size[0] + ', ' + b.size[1] + ')' + (b.pos[0] === 0 && b.pos[1] === 0 ? '  ← 已归零 ✓' : '')));
  }

  // ④ assets
  p('');
  p('── ④ assets 子控件（★ "取不到"那个坑，固化在这里 ✓）──');
  const ar = assetsReport(g);
  out.assets = { id: ar.id, count: ar.list.length, entries: ar.entries, ok: ar.ok };
  p('  assets #' + ar.id + ' 子列表 ' + ar.list.length + ' 项');
  for (const e of ar.entries) {
    p('     ' + String(e.name || '#' + e.id).padEnd(14) + ' #' + String(e.id).padEnd(12)
      + ' 父=' + String(e.parentId).padEnd(12) + (e.parentId === ar.id ? '✓' : '✗'));
  }
  for (const pr of ar.problems) p('  ❌ ' + pr);
  if (ar.ok) p('  ✅ assets 子列表自洽（每项都有记录、父引用正确、无"声明了却没登记"的 ✓）');

  // ⑤ row.* 子列表
  p('');
  p('── ⑤ row.* 子列表条数 ──');
  const rows = g.recs.filter((r) => r.name && r.name.startsWith('row.')).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  out.rows = rows.map((r) => {
    const cl = findChildListTop(r.field.sub);
    const ids = cl ? (asIdList(cl.payload, true) || []) : null;
    return { name: r.name, id: r.id, parentId: r.parentId, childCount: ids ? ids.length : null };
  });
  if (!rows.length) p('  （没有 row.* 记录）');
  else {
    const counts = {};
    for (const x of out.rows) counts[String(x.childCount)] = (counts[String(x.childCount)] || 0) + 1;
    p('  共 ' + rows.length + ' 个；子列表条数分布：' + Object.entries(counts).map(([k, v]) => k + ' 项×' + v).join('、'));
    const empty = out.rows.filter((x) => !x.childCount);
    if (empty.length) p('  ⚠️ 子列表为空的 row（' + empty.length + ' 个）：' + empty.map((x) => x.name).join('、'));
    else p('  ✅ 每个 row 都有非空子列表 ✓');
  }

  // ⑤b 模板"本体 / 实例"（★ lead 2026-10-10 要求固化 ✓）
  p('');
  p('── ⑤b 模板的两份同名记录（★ "该改哪一个"看这里 ✓ 命名见 `prefabReport` 注释 ✓）──');
  const pf = prefabReport(g);
  out.prefab = pf;
  for (const r of pf.roots) p('  ★ 模板层级根：' + r.name + ' #' + r.id + '（' + r.path + '）—— ★ 真实节点 ✓');
  if (pf.prefabIndex.length) {
    for (const x of pf.prefabIndex) p('  ★ itemPrefabIndex ' + x.path + ' = ' + x.value + '　⇒ ★ 运行时列表项取 #' + x.value);
  } else p('  ⚠️ 没找到 itemPrefabIndex（★ 无法判定"运行时用哪一份" ✗）');
  for (const s of pf.sameName) {
    const rootId = (pf.roots[0] || {}).id;
    p('  ★ 同名记录「' + s.name + '」' + s.items.length + ' 份：');
    for (const it of s.items) {
      const isPrefab = pf.prefabIndex.some((x) => x.value === it.id);
      p('     #' + String(it.id).padEnd(12) + ' 父=' + String(it.parentId).padEnd(12)
        + ' 状态块 ' + it.blocks
        + (it.parentId === rootId ? '　★ 【模板层级根下的那份】✓（父=模板层级根 ✓）'
          : (it.parentId == null ? '　★ 【顶层无父】✓（根级 ✓）' : '　★ 顶层父=#' + it.parentId))
        + (isPrefab ? '　★★ itemPrefabIndex 指向它 ⇒ 【★ 运行时列表项来源】✓' : ''));
    }
    // ★★ 判定：★ 有 itemPrefabIndex 指向 ⇒ 那就是运行时来源 ✓；没有 ⇒ 说清两种意图各改哪份 ✓
    const pref = s.items.filter((it) => pf.prefabIndex.some((x) => x.value === it.id));
    const noParent = s.items.filter((it) => it.parentId == null);
    const underRoot2 = s.items.filter((it) => it.parentId === rootId);
    if (pref.length) {
      p('     ★ 判定：★ **要改"运行时看到的" ⇒ 改 #' + pref.map((x) => x.id).join(' / #')
        + ' 的全部状态块** ✓；★ 要改"模板层级根下的那份" ⇒ 改 #' + (underRoot2.map((x) => x.id).join(' / #') || '（无 ✗）') + ' ✓');
    } else {
      p('     ★ 判定：★ 本组**没有** itemPrefabIndex 指向 ✗ ⇒ ★ 改"顶层无父的那份"＝ #'
        + (noParent.map((x) => x.id).join(' / #') || '（无 ✗）') + ' ✓、★ 改"模板层级根下的那份"＝ #'
        + (underRoot2.map((x) => x.id).join(' / #') || '（无 ✗）') + ' ✓');
    }
  }
  if (pf.sameName.length) {
    p('  ★★ **通用模型**（★ 实测 ✓）：★ 每个模板控件在存档里有 **2 份** ——'
      + '★ 一份【顶层无父】（根级 ✓）、★ 一份挂在 `' + ((pf.roots[0] || {}).name || '?') + '` 下 ✓');
    p('  ⚠️ 命名说明：★ 本工具**不用"本体/实例"** ✓ —— ★ 改用可复核的事实命名：'
      + '★「运行时列表项来源」（依据 `itemPrefabIndex` ✓）／★「模板层级根下的那份」（依据父 id ✓）');
    p('  ⚠️ 依据＝ itemPrefabIndex（`/#505/#503/#80/#506` ✓）；★ 资料员若查证出不同结论 ⇒ 只改 `prefabReport` 一处 ✓');
  }
  p('  ⚠️ 同字段号不同义：★ `#506` 在 `#80/#506` 是 itemPrefabIndex ✓、在 `#81/#506` 是 `50888`（★ 别的语义 ✗）'
    + '　⇒ ★ **按字段号取值前先确认路径** ✓（与 `#503` 同类陷阱 ✓）');

  // ⑥ 结论
  p('');
  p('── ⑥ 结论 ──');
  const zero = out.clues.filter((c) => c.blocks[0] && c.blocks[0].pos[0] === 0 && c.blocks[0].pos[1] === 0);
  p('  clue 记录 ' + out.clues.length + ' 个，其中 blk[0] 已归零的 ' + zero.length + ' 个'
    + (zero.length === out.clues.length ? ' ✓' : ' ⚠️（其余仍未归零）'));
  p('  脚本标记 ' + (marker || '?') + '　assets 子控件 ' + ar.list.length + ' 项' + (ar.ok ? ' ✓' : ' ❌')
    + '　row.* ' + out.rows.length + ' 个');

  if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
  else console.log(L.join('\n'));
}

// ★ 只有"直接跑本文件"才执行主流程 ✓（被 import 时不要跑 ✗）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
