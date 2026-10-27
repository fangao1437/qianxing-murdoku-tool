// tools/gil/_probe_text_and_image.mjs —— 只读：打印某控件（含子控件）的**文本字段**、**对齐/字号/颜色**、**图像块**
// 用法：node tools/gil/_probe_text_and_image.mjs <gil> <控件名...>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
const names = process.argv.slice(3);
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => {
  const cl = findChildListTop(r.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};

function dump(rec, label) {
  console.log('== ' + label + ' #' + rec.id + ' 状态块 ' + rec.states.length + ' 个');
  const blk = rec.states[0];
  const texts = [], ints = [], imgs = [];
  (function w(fs, p) {
    for (const x of fs) {
      if (x.wt === 2 && x.isText) texts.push(p + '/#' + x.field + ' = "' + x.payload.toString('utf8') + '"');
      if (x.wt === 0 && x.num <= 200000n) ints.push(p + '/#' + x.field + ' = ' + x.num);
      if (x.sub) {
        const s = x.sub.map((y) => y.field + ':' + (y.num !== undefined ? y.num : (y.f !== undefined ? y.f : 'msg'))).join(',');
        imgs.push(p + '/#' + x.field + ' { ' + s + ' }');
        w(x.sub, p + '/#' + x.field);
      }
    }
  })(blk.sub, '');
  for (const t of texts) console.log('   文本 ' + t);
  for (const i of ints) console.log('   整数 ' + i);
  for (const m of imgs) console.log('   消息 ' + m);
  // ★ 子控件列表（父级作用域里的名字 ✓ —— 用户要在编辑器里按名字找 ✓）
  const k = kids(rec);
  if (k.length) console.log('   子控件: ' + k.map((c) => c.name + '#' + c.id).join('  '));
}

for (const nm of names) {
  const r = g.byName.get(nm);
  if (!r) { console.log('== ' + nm + ' 不在'); continue; }
  dump(r, nm);
  for (const k of kids(r)) dump(k, nm + '.' + k.name);
}
