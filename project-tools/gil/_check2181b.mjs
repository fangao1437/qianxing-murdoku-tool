import { readGil } from './gilread.mjs';
const g = readGil('218.1.gil');
// ★ 权威位置：/505/503/84 节点上的 #503（imageId）与 #502（imageSource）
//   ★ 证据：模板 clue.face 在这里就是 100001 ⇒ 编辑器读的就是这一处 ✓
function leaves(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; }
    if (f.wt !== 0) continue;
    out.push([path + '/' + f.field, Number(f.num)]);
  }
}
const want = ['portrait.A', 'portrait.B', 'portrait.V', 'portrait.D'];
console.log('  ★ 权威位置 /505/503/84#503（imageId）与 #502（imageSource）：');
for (const n of want) {
  const r = g.recs.find((x) => x.name === n);
  const o = []; leaves(r.field.sub, '', o);
  const id = o.find(([p]) => p === '/505/503/84#503');
  const src = o.find(([p]) => p === '/505/503/84#502');
  const other = o.find(([p]) => p === '/505/503/13/12#502');
  console.log('    ' + n.padEnd(12) + ' imageId=' + (id ? id[1] : '(无)')
    + '   source=' + (src ? src[1] : '(无)')
    + '   （★ 旧写坏那份：/13/12#502=' + (other ? other[1] : '(无)') + '）');
}
console.log('  ★ 对照（★ 期望映射 ✓）：A=112042  B=105104  C/V=112031  D=105105');