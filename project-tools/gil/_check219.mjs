import { readGil } from './gilread.mjs';
const g = readGil('219-调色板.gil');
const P = [505,503,84,503];
function all(fs, path, out) {
  let cur = fs;
  for (const fno of path) { const nxt = []; for (const f of cur) if (f.sub) nxt.push(...f.sub); cur = nxt; }
  for (const f of cur) if (f.wt === 0) out.push(Number(f.num));
  return out;
}
for (const n of ['portrait.A','portrait.B','portrait.V','portrait.D']) {
  const r = g.recs.find((x) => x.name === n);
  console.log('  ' + n + ' → imgId 出现处 = [' + all(r.field.sub, P, []).join(', ') + ']');
}