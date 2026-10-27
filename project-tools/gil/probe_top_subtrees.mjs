// tools/gil/probe_top_subtrees.mjs —— 只读：把 .gil 的**顶层子树**摊开（谁装了什么、谁装控件）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么要有它（2026-10-21）
// ════════════════════════════════════════════════════════════════════════════
//   排查「教程 UI 并入主档后编辑器报 界面控件设置错误 / 控件GUID重复」时，
//   第一个问题永远是：**控件记录到底住在哪个顶层字段里？并入时有没有动到别的地方？**
//   以前的探针（probe_guid_collision / _probe_dupids）只看"记录内部"，不看"文件骨架"，
//   于是"并入只加了 41 条记录 + 1 条子列表"这个结论**没法被命令复现**。
//
//   本工具只回答四件事，全部可复现：
//     ① 外层头 / 存档名（`/#2`）/ 存档 id（`/#1`）/ `/#52`
//     ② 每个顶层字段：线型、字节数、**其下有多少条控件记录**、big-id 个数、文本样例
//     ③ 记录真正住在哪（holder 字段号 + 记录条数），以及记录按父级的分布
//     ④ 模型层（母本 / 父 = 引擎容器）与场景层的条数
//
//   ★ 只读：不写任何文件，不改任何 .gil。
//
// 用法：
//   node tools/gil/probe_top_subtrees.mjs <存档.gil> [更多存档...] [--json] [--limit=6]
//   node tools/gil/probe_top_subtrees.mjs 472.gil 478-教程UI并入-v284.gil
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, recordsOf, bigIds, textsOf, asIdList, ID_LO, ID_HI } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const argv = process.argv.slice(2);
const FILES = argv.filter((s) => !s.startsWith('--'));
const JSONOUT = argv.includes('--json');
const LIMIT = (() => {
  const h = argv.find((s) => s.startsWith('--limit='));
  return h ? Number(h.slice(8)) : 6;
})();
if (!FILES.length) {
  console.error('用法: node tools/gil/probe_top_subtrees.mjs <存档.gil> [更多...] [--json] [--limit=N]');
  process.exit(2);
}

const WT = { 0: 'varint', 1: 'f64', 2: 'msg/str', 5: 'f32' };
const isBigId = (v) => v > ID_LO && v < ID_HI;

/** 一个顶层字段下面有几个 big-id、几段子控件 ID 列表、几条记录 */
function scanUnder(f, holderSet) {
  let bigId = 0, texts = 0, childLists = 0, childIds = 0;
  const sample = [];
  (function walk(fs2) {
    for (const g of fs2 || []) {
      if (g.wt === 0 && g.field === 501 && isBigId(Number(g.num))) bigId++;
      if (g.wt === 2 && g.isText) {
        texts++;
        if (sample.length < 4) {
          const s = g.payload.toString('utf8');
          if (s.length > 0 && s.length <= 40) sample.push(s);
        }
      }
      if (g.wt === 2 && g.field === 503 && !g.isText && g.payload) {
        const ids = asIdList(g.payload, true);
        if (ids !== null) { childLists++; childIds += ids.length; }
      }
      if (g.sub) walk(g.sub);
    }
  })(f.sub);
  return { bigId, texts, childLists, childIds, sample };
}

function report(file) {
  const had = fs.existsSync(P(file));
  if (!had) return { file, error: '文件不存在' };
  const g = readGil(P(file));

  // 记录按 holder 分组
  const byHold = new Map();
  for (const r of g.recs) {
    if (!byHold.has(r.holder)) byHold.set(r.holder, []);
    byHold.get(r.holder).push(r);
  }
  const holderOf = new Map();  // holder 数组 → 顶层下标
  for (let i = 0; i < g.tree.length; i++) if (g.tree[i].sub) holderOf.set(g.tree[i].sub, i);

  const top = [];
  for (let i = 0; i < g.tree.length; i++) {
    const f = g.tree[i];
    const recs = f.sub && byHold.get(f.sub) ? byHold.get(f.sub).length : 0;
    const u = scanUnder(f, byHold);
    top.push({
      idx: i, field: f.field, wt: WT[f.wt] || String(f.wt),
      len: f.wt === 2 ? f.len : (f.wt === 0 ? 0 : 4),
      value: f.wt === 0 ? f.num.toString() : undefined,
      text: f.wt === 2 && f.isText ? f.payload.toString('utf8').slice(0, 60) : undefined,
      recs, bigId: u.bigId, childLists: u.childLists, childIds: u.childIds, texts: u.texts, sample: u.sample,
      isRecordHolder: recs > 0,
    });
  }

  // 记录按父级分组（父级不在记录表里的 → 引擎/模板容器）
  const ids = new Set(g.recs.map((r) => Number(r.id)));
  const byParent = new Map();
  for (const r of g.recs) {
    const p = r.parentId == null ? '(无父/根)' : String(Number(r.parentId));
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r);
  }
  const parents = [...byParent.entries()]
    .map(([p, list]) => ({ parent: p, isRecord: /^\d+$/.test(p) && ids.has(Number(p)), n: list.length, names: list.slice(0, 3).map((r) => r.name || '(无名)') }))
    .sort((a, b) => b.n - a.n);

  const scalar = (no) => {
    const f = g.tree.find((x) => x.field === no && x.wt === 0);
    return f ? f.num.toString() : null;
  };
  const textOf = (no) => {
    const f = g.tree.find((x) => x.field === no && x.wt === 2 && x.isText);
    return f ? f.payload.toString('utf8') : null;
  };

  return {
    file, size: fs.statSync(P(file)).size, hdr: g.hdr, trailer: g.trailer.length,
    archiveId: scalar(1), archiveName: textOf(2), f52: scalar(52),
    recs: g.recs.length,
    topFieldCount: g.tree.length,
    top, parents,
  };
}

const out = [];
for (const f of FILES) out.push(report(f));

if (JSONOUT) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

for (const r of out) {
  console.log('════════════════════════════════════════════════════════════════════');
  if (r.error) { console.log(path.basename(r.file) + '：' + r.error); continue; }
  console.log('文件 ' + path.basename(r.file) + '　' + r.size + ' 字节　记录 ' + r.recs
    + '　顶层字段 ' + r.topFieldCount + '　尾 ' + r.trailer + 'B');
  console.log('  存档 id /#1 = ' + r.archiveId + '　名 /#2 = ' + JSON.stringify(r.archiveName) + '　/#52 = ' + r.f52);
  console.log('  顶层字段（只列有内容的）：');
  console.log('   idx 字段   线型      字节      记录  #501大号  子列表(项)  文本  样例');
  for (const t of r.top) {
    if (!t.recs && !t.bigId && !t.texts && !t.value && !t.text && !t.len) continue;
    const bytes = String(t.len).padStart(8);
    const line = '   ' + String(t.idx).padStart(3) + ' /#' + String(t.field).padEnd(4)
      + String(t.wt).padEnd(9) + bytes + '  ' + String(t.recs).padStart(5)
      + '  ' + String(t.bigId).padStart(7) + '  ' + String(t.childLists + '(' + t.childIds + ')').padStart(9)
      + '  ' + String(t.texts).padStart(4) + '  '
      + (t.value !== undefined ? '= ' + t.value : '')
      + (t.text !== undefined ? JSON.stringify(t.text) : '')
      + (t.sample.length ? ' e.g. ' + t.sample.map((s) => JSON.stringify(s)).join(' ') : '');
    console.log(line);
  }
  const holder = r.top.find((t) => t.isRecordHolder);
  console.log('  ⇒ 控件记录住在 ' + (holder ? '/#' + holder.field + '（' + holder.recs + ' 条）' : '(未找到)'));
  console.log('  记录按父级（前 ' + Math.min(LIMIT, r.parents.length) + ' 组）：');
  for (const p of r.parents.slice(0, LIMIT)) {
    console.log('    父 ' + p.parent + (p.isRecord ? '' : '（不是记录 ⇒ 引擎/模板容器）')
      + '　' + String(p.n).padStart(4) + ' 条　例：' + p.names.map((s) => JSON.stringify(s)).join(' '));
  }
  if (r.parents.length > LIMIT) console.log('    …还有 ' + (r.parents.length - LIMIT) + ' 组');
  console.log('');
}
