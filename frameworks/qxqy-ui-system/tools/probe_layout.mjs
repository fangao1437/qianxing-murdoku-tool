// tools/probe_layout.mjs —— 探针：把整棵树按路径打印出"记录形状"的节点 + 指定 id 的所有出现位置
// 用法：node tools/probe_layout.mjs <file.gil> [--ids=1073742015,1073742016] [--max=80]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, bigIdTop, textsOf, KNOWN_TYPES, asIdList } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const WANT = new Set((argOf('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number));
const MAX = Number(argOf('max') || 80);

const g = readGil(path.resolve(REPO, FILE));
console.log(`${path.basename(g.file)} ${g.src.length}B recs=${g.recs.length} maxId=${g.maxId}`);
console.log(`recHolder=${g.recHolder === g.tree ? '(tree)' : '(sub)'} 顶层字段=${g.tree.map((f) => f.field).join(',')}`);

const shapeOf = (fields) => {
  const id = bigIdTop(fields);
  if (id == null) return null;
  const kind = textsOf(fields, []).map((t) => t.payload.toString('utf8')).find((s) => KNOWN_TYPES.has(s)) || null;
  const strs = textsOf(fields, []).map((t) => t.payload.toString('utf8')).filter((s) => !KNOWN_TYPES.has(s) && s.length <= 40);
  const p504 = fields.find((f) => f.field === 504 && f.wt === 0);
  const child = fields.find((f) => f.field === 503 && f.wt === 2 && !f.isText && asIdList(f.payload, true) !== null);
  return { id, kind, strs, parent: p504 ? Number(p504.num) : null, child: child ? asIdList(child.payload, true) : null };
};

// ── 扫描模式：某个 id 在整棵树里的**全部**出现位置（含记录内部） ──────────────
const SCAN = (argOf('scan') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
if (SCAN.length) {
  const want = new Set(SCAN);
  let hits = 0;
  (function scan(fields, p) {
    for (const f of fields) {
      const here = `${p}/#${f.field}[${f.wt === 2 ? f.len + 'B' : 'wt' + f.wt}]`;
      if (f.wt === 0 && want.has(Number(f.num))) { console.log(`  ★ wt0 命中 ${f.num} @ ${here}`); hits++; }
      if (f.wt === 2 && f.payload && f.payload.length) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.some((x) => want.has(x))) { console.log(`  ★ ID列表命中 @ ${here} = [${ids.join(',')}]`); hits++; }
      }
      if (f.sub) scan(f.sub, here);
    }
  })(g.tree, '');
  console.log(`\n扫描完成：命中 ${hits} 处`);
  process.exit(0);
}

let n = 0;
(function walk(fields, p, depth) {
  for (const f of fields) {
    if (depth > 12) return;
    const here = `${p}/#${f.field}[${f.wt === 2 ? f.len + 'B' : f.wt}]`;
    if (f.sub) {
      const s = shapeOf(f.sub);
      if (s && (s.kind || s.child)) {
        // 是"记录形状"：不要继续往里走（内部还有同名 501，别混淆）
        if (n++ < MAX) {
          console.log(
            `${here}\n    id=${s.id} parent=${s.parent} kind=${s.kind || '(无)'} strs=[${s.strs.join('|')}] child=${s.child ? JSON.stringify(s.child) : 'null'}`
          );
        }
        continue;
      }
      walk(f.sub, here, depth + 1);
    }
    // 顺带打印目标 id 的出现位置
    if (f.wt === 0 && WANT.has(Number(f.num))) console.log(`  ★ 目标 ${f.num} 出现于 ${here} (wt0)`);
    if (f.wt === 2 && f.payload && WANT.size) {
      const ids = asIdList(f.payload, false);
      if (ids && ids.some((x) => WANT.has(x))) console.log(`  ★ 目标出现在 ${here} 的 ID 列表 ${JSON.stringify(ids)}`);
    }
  }
})(g.tree, '', 0);
console.log(`\n（共打印 ${Math.min(n, MAX)} / ${n} 个记录形状节点）`);
