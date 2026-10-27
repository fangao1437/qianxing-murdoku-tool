// tools/gil/_probe_state.mjs —— 只读：把一条记录的每个状态块里的「对」(x,y) 字段按字段号打出来
//   用法: node tools/gil/_probe_state.mjs <存档.gil> <名字> [<名字> ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
const names = process.argv.slice(3);
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

function pairsIn(block) {
  const out = [];
  for (const f of block.sub) {
    if (f.sub && f.sub.length === 2 && f.sub[0].wt === 5 && f.sub[1].wt === 5) {
      out.push([f.field, f.sub[0].f, f.sub[1].f]);
    }
  }
  return out;
}

for (const n of names) {
  const recs = g.recs.filter((r) => r.name === n);
  console.log('\n=== ' + n + '：' + recs.length + ' 条 ===');
  for (const r of recs) {
    const bl = [];
    stateBlocks(r.field.sub, bl);
    console.log('  #' + r.id + ' 父=' + (r.parentId || 'null') + ' 状态块=' + bl.length);
    bl.forEach((b, i) => {
      const ps = pairsIn(b);
      const p504 = pairOf(b, 504), p505 = pairOf(b, 505);
      console.log('    块' + i + '  504(位置)=' + (p504 ? pairValue(p504, 0) + ',' + pairValue(p504, 1) : '—')
        + '  505(尺寸)=' + (p505 ? pairValue(p505, 0) + '×' + pairValue(p505, 1) : '—')
        + '  其它对: ' + ps.filter(([f]) => f !== 504 && f !== 505)
          .map(([f, x, y]) => '#' + f + '=(' + x + ',' + y + ')').join(' '));
    });
  }
}
