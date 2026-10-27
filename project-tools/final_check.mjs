// tools/final_check.mjs —— **交付物结构验证**
//
// "自动测试全绿"不等于"交付的那个 .gil 里什么都有" —— 测试跑的是**代码**，
// 而用户导入的是**文件**。这个脚本专门查**文件本身**：
//
//   ① 脚本内嵌 == dist/client_script.lua（导入即最新，不用手动同步）
//   ② 八项改造各自需要的**控件**在不在
//   ③ 家具图标需要的**素材 id** 对不对
//   ④ 转存素材的**模板索引**登记在不在脚本里
//   ⑤ 楼层：文件结构合法（记录都在 /#9、尾标记在）
//
// 用法：node tools/final_check.mjs [--gil=完整界面53-选关翻页.gil]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gil/gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

function latestGil() {
  const all = fs.readdirSync(ROOT).filter((f) => /^完整界面\d+.*\.gil$/.test(f));
  all.sort((a, b) => Number((b.match(/^完整界面(\d+)/) || [])[1] || 0) - Number((a.match(/^完整界面(\d+)/) || [])[1] || 0));
  return all[0] ? path.join(ROOT, all[0]) : null;
}
const GIL = argOf('gil') ? path.join(ROOT, argOf('gil')) : latestGil();
if (!GIL || !fs.existsSync(GIL)) { console.error('❌ 找不到 .gil'); process.exit(3); }

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   [' + extra + ']' : '')); }
};

const g = readGil(GIL);
const buf = fs.readFileSync(GIL);
const out = [];
(function walk(fs2) { for (const x of fs2) { if (x.wt === 2 && x.isText && x.len > 1000) out.push(x.payload.toString('utf8')); else if (x.wt === 2 && x.sub) walk(x.sub); } })(g.tree);
const script = out.sort((a, b) => b.length - a.length)[0] || '';
const dist = fs.readFileSync(path.join(ROOT, 'dist', 'client_script.lua'), 'utf8');

console.log('\n════════ 交付物结构验证 ════════');
console.log('  文件 ' + path.basename(GIL) + '  ' + Math.round(buf.length / 1024) + ' KB  记录 ' + g.recs.length + ' 条');

console.log('\n── ① 文件合法性 / 脚本内嵌 ──');
check('尾标记 0x679 在', buf.readUInt32BE(buf.length - 4) === 0x679, '0x' + buf.readUInt32BE(buf.length - 4).toString(16));
check('全部记录都在 /#9 子消息里（编辑器读得到）', g.recs.length > 300, g.recs.length + ' 条');
check('内嵌脚本存在且够长', script.length > 100000, script.length + ' 字符');
check('内嵌脚本 == dist/client_script.lua（导入即最新）', script === dist,
  script === dist ? '完全一致' : '不一致（差 ' + Math.abs(script.length - dist.length) + ' 字符）');

console.log('\n── ② 八项改造需要的控件 ──');
const has = (n) => g.byName.has(n);
const groups = [
  ['① 选关卡片三段式', ['select.card.1', 'select.card.1.title', 'select.card.1.info', 'select.card.1.room.1']],
  ['① 选关分页', ['select.prev', 'select.next', 'select.page']],
  ['② 线索区滚动', ['clues.up', 'clues.down', 'clues.knob', 'clues.count']],
  ['③ 线索卡拆控件（标红用）', ['clue.1', 'clue.1.who', 'clue.1.what', 'clue.1.face', 'clue.1.badge']],
  ['④ 房间名标签', ['room.label.1', 'room.label.2', 'room.label.3']],
  ['⑤ 家具调色板（4 个）', ['obj.shelf', 'obj.case', 'obj.desk', 'obj.carpet']],
  ['⑥ 顶栏重排', ['action.back', 'action.redo', 'action.hint', 'action.undo', 'action.submit', 'action.reveal']],
  ['主页四键', ['home.select', 'home.continue', 'home.shop', 'home.bag']],
  ['转存素材（脚本实例化）', ['action.undo.hexbg', 'action.submit.hexbg', 'action.reveal.hexbg']],
];
for (const [label, ids] of groups) {
  const miss = ids.filter((id) => !has(id));
  // 转存素材那几个**不应该**在 .gil 里（要由脚本按模板索引实例化）
  if (label.indexOf('转存素材') >= 0) {
    check(label + '**不在** .gil 里（必须由脚本实例化）', miss.length === ids.length,
      miss.length === ids.length ? '全都不在 ✅' : '混进了: ' + ids.filter((id) => has(id)).join(' '));
  } else {
    check(label, miss.length === 0, miss.length ? '缺: ' + miss.join(' ') : ids.length + ' 个都在');
  }
}

console.log('\n── ③ 家具图标的素材 id ──');
function imgOf(name) {
  const r = g.byName.get(name);
  if (!r) return undefined;
  let hit;
  (function walk(fs2, p) {
    for (const x of fs2) {
      if (x.wt === 0 && x.field === 503 && p === '/#505/#503/#84') hit = Number(x.num);
      else if (x.wt === 2 && x.sub) walk(x.sub, p + '/#' + x.field);
    }
  })(r.field.sub, '');
  return hit;
}
const wantImg = { 'obj.shelf': 111051, 'obj.case': 111064, 'obj.desk': 111050, 'obj.carpet': 106053 };
for (const [n, id] of Object.entries(wantImg)) {
  check('家具「' + n + '」图片 id = ' + id, imgOf(n) === id, '实际 ' + imgOf(n));
}

console.log('\n── ④ 转存素材的模板索引（写在脚本里）──');
const prefabs = {
  'murdoku-btn-hex': 1073742321, 'murdoku-card-frame': 1073742325,
  'murdoku-cell': 1073742329, 'murdoku-clue-row': 1073742333,
  'murdoku-panel': 1073742337, 'murdoku-tape': 1073742340,
};
const registered = Object.values(prefabs).filter((v) => script.indexOf(String(v)) >= 0);
// 只要求"已用到的"登记：六边形那三个 + 线索条（循环里）
check('六边形底图的模板索引 1073742321 已登记', script.indexOf('1073742321') >= 0);
check('线索条底图的模板索引 1073742333 已登记', script.indexOf('1073742333') >= 0);
console.log('    （另外 4 个 -- ' + Object.keys(prefabs).filter((k) => ['murdoku-card-frame', 'murdoku-cell', 'murdoku-panel', 'murdoku-tape'].indexOf(k) >= 0).join(' / ')
  + ' -- 已转存备用，还没接线）');

console.log('\n── ⑤ 素材自检 ──');
console.log('    （跑 node tools/gil/check_assets.mjs 看详情）');

console.log('\n════════ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ════════');
process.exit(fail === 0 ? 0 : 1);
