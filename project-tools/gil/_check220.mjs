import { readGil } from './gilread.mjs';
const g = readGil('220-调色板.gil');
function nodesAt(fs, path) { let cur = fs; for (const fno of path) { const nxt = []; for (const f of cur) if (f.sub) nxt.push(...f.sub); cur = nxt; } return cur; }
for (const n of ['portrait.A','portrait.B','portrait.V','portrait.D']) {
  const r = g.recs.find((x) => x.name === n);
  const ids = [], srcs = [];
  for (const nd of nodesAt(r.field.sub, [505,503,84])) for (const f of (nd.sub||[])) { if (f.field === 503 && f.wt === 0) ids.push(Number(f.num)); if (f.field === 502 && f.wt === 0) srcs.push(Number(f.num)); }
  console.log('  ' + n + '  imageId = [' + ids.join(', ') + ']   imageSource = [' + srcs.join(', ') + ']');
}