// tools/probe_detect.mjs —— 诊断：某条记录为什么**没被** recordsOf 认成控件记录
// 判据（gilread.recordsOf）：geomPairs>=2 && bigIds>=1 && 没有"更深一层也像记录"的子字段
// 用法：node tools/probe_detect.mjs <file.gil> <id> [<id> ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, geomPairs, bigIds } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [file, ...ids] = process.argv.slice(2);
const g = readGil(path.resolve(REPO, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));

// 找"body 里顶层 #501 == id"的字段
function findBody(fields, want, pathStr = '') {
  for (const f of fields) {
    if (!f.sub) continue;
    const top = f.sub.find((x) => x.field === 501 && x.wt === 0);
    if (top && Number(top.num) === want) return { field: f, path: pathStr + '/#' + f.field };
    const r = findBody(f.sub, want, pathStr + '/#' + f.field);
    if (r) return r;
  }
  return null;
}

for (const idStr of ids) {
  const id = Number(idStr);
  const rec = byId.get(id);
  const hit = findBody(g.tree, id);
  console.log(`\n#${id}  recordsOf 认定=${rec ? '✓ name=' + JSON.stringify(rec.name) + ' parent=' + rec.parentId : '✗ 未认定'}`);
  if (!hit) { console.log('   ✗ 树里找不到这条 body'); continue; }
  const body = hit.field.sub;
  const gp = geomPairs(body, []);
  const bi = bigIds(body, []);
  console.log(`   路径 ${hit.path}  子字段 ${body.length} 个  总长 ${hit.field.len}B`);
  console.log(`   geomPairs=${gp.length} ` + gp.map((f) => `#${f.field}/#${f.sub.map((x) => x.field).join(',')}`).join(' | '));
  console.log(`   bigIds=${bi.length} [${bi.map((x) => Number(x.num)).join(',')}]`);
  let deeper = 0;
  for (const c of body) {
    if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) {
      deeper++;
      console.log(`   ⚠ 更深一层像记录：顶层 #${c.field}  gp=${geomPairs(c.sub, []).length} ids=${bigIds(c.sub, []).length}`);
    }
  }
  console.log(`   deeper=${deeper}`);
  console.log('   顶层字段：' + body.map((c) => `#${c.field}(${c.wt === 2 ? c.len + 'B' : 'wt' + c.wt})`).join(' '));
}
