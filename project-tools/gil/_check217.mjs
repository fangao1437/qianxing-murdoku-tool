import { readGil } from './gilread.mjs';
const g = readGil('217-调色板.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const a = g.recs.find((r) => r.name === 'assets');
const kids = g.recs.filter((r) => r.parentId === a.id).map((r) => r.name);
console.log('  记录 ' + g.recs.length + '  assets 的子控件：' + kids.join(' , '));
console.log('  ★ 4 个 portrait.* = ' + ['portrait.A','portrait.B','portrait.V','portrait.D'].filter((n) => g.recs.some((r) => r.name === n)).length + ' / 4');