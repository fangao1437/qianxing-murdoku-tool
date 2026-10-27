import { readFileSync } from 'node:fs';
const buf = readFileSync('214.1.gil');
const pats = [
  ['f32be 100.0', Buffer.from([0x42, 0xC8, 0x00, 0x00])],
  ['f32be 30.0',  Buffer.from([0x41, 0xF0, 0x00, 0x00])],
  ['f32le 100.0', Buffer.from([0x00, 0x00, 0xC8, 0x42])],
  ['f32le 30.0',  Buffer.from([0x00, 0x00, 0xF0, 0x41])],
  ['f32be 124.0', Buffer.from([0x42, 0xF8, 0x00, 0x00])],
  ['f32be 37.0',  Buffer.from([0x42, 0x14, 0x00, 0x00])],
  ['f64be 100.0', Buffer.from([0x40, 0x59, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])],
];
for (const [name, p] of pats) {
  const offs = [];
  let i = buf.indexOf(p);
  while (i >= 0 && offs.length < 6) { offs.push(i); i = buf.indexOf(p, i + 1); }
  console.log('  ' + name.padEnd(14) + ' 出现 ' + (offs.length ? offs.length + ' 次  前几个偏移：' + offs.join(', ') : '0 次'));
}
// 再看"整数 100 / 30 的 varint/定长"是否成对出现在同一条记录附近（粗略）
const g = (await import('./gilread.mjs')).readGil('214.1.gil');
let pair = 0;
for (const r of g.recs) {
  const s = JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? String(v) : v));
  const has = (n) => new RegExp(':' + n + '[,"}]').test(s);
  if (has(100) && has(30)) pair++;
}
console.log('  记录里"同时出现整数 100 和 30"的 = ' + pair + ' 个');