// tools/gil/_probe_select_geom.mjs —— 只读：选关屏相关控件的**父级 / 位置 / 尺寸**一览
//
// 为什么需要（2026-10-18 第二十三轮）：
//   真机回报「选关界面只渲染出一张卡片」。已知存档里四张卡**位置各不相同**，
//   所以问题只可能在"画"这一层。第一嫌疑是**父级裁剪**：
//     真机实测过"容器缩到 1×1 ⇒ 子控件被裁掉"（docs/真机问题-选关点不动-定位与修法.md）
//   ⇒ 卡片挂在 `select` 下、坐标是**相对父级中心**的 ⇒ 若 `select` 比四张卡的跨度窄，
//     超出的三张会被裁掉 ⇒ 画面看起来"只有一张"。
//
// 用法：node tools/gil/_probe_select_geom.mjs <存档.gil>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '406-无运行时创建-v261.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [Number(r.id), r]));
const nm = (id) => { const r = byId.get(Number(id)); return r ? r.name : String(id); };

function geom(rec) {
  const bs = [];
  stateBlocks(rec.field.sub, bs);
  if (!bs.length) return null;
  const b = bs[0];
  const p = pairOf(b, 504), s = pairOf(b, 505);
  return {
    x: Number(pairValue(p, 0)), y: Number(pairValue(p, 1)),
    w: Number(pairValue(s, 0)), h: Number(pairValue(s, 1)),
    blocks: bs.length,
  };
}

const want = (n) => /^(root|home|select|select\..+|hit\.select\..+|stage|board(\.bg)?)$/.test(n || '');
const rows = g.recs.filter((r) => want(r.name));
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
console.log('（位置 = #504 两分量，**该控件中心相对父级中心**的偏移；画布 1600×900）\n');
console.log('  名字                      父级            位置            尺寸           状态块');
for (const r of rows) {
  const ge = geom(r);
  if (!ge) { console.log('  ' + String(r.name).padEnd(24) + ' ' + String(nm(r.parentId)).padEnd(14) + '  (无几何)'); continue; }
  console.log('  ' + String(r.name).padEnd(24)
    + ' ' + String(nm(r.parentId)).padEnd(14)
    + ' ' + (ge.x.toFixed(1) + ',' + ge.y.toFixed(1)).padStart(14) + '  '
    + (ge.w.toFixed(1) + '×' + ge.h.toFixed(1)).padStart(14) + '   ' + ge.blocks);
}

// ★ 关键判据：卡片跨度 vs 父级宽度
const roots = rows.filter((r) => /^select$/.test(r.name));
for (const sel of roots) {
  const ge = geom(sel);
  const kids = g.recs.filter((r) => Number(r.parentId) === Number(sel.id) && /^select\.card\.\d+$/.test(r.name || ''));
  let minX = Infinity, maxX = -Infinity;
  for (const k of kids) { const kg = geom(k); if (kg) { minX = Math.min(minX, kg.x - kg.w / 2); maxX = Math.max(maxX, kg.x + kg.w / 2); } }
  console.log('\n★ select #' + sel.id + ' 尺寸 ' + (ge ? ge.w.toFixed(1) + '×' + ge.h.toFixed(1) : '?')
    + '　直属卡片 ' + kids.length + ' 张');
  if (kids.length && ge) {
    console.log('  卡片横向占位 ' + minX.toFixed(1) + ' … ' + maxX.toFixed(1)
      + '（跨度 ' + (maxX - minX).toFixed(1) + '）　父级半宽 ' + (ge.w / 2).toFixed(1));
    const clipped = kids.filter((k) => { const kg = geom(k); return kg && (kg.x - kg.w / 2 < -ge.w / 2 || kg.x + kg.w / 2 > ge.w / 2); });
    console.log('  ⇒ 超出父级左右边界（会被裁）的卡片：' + (clipped.length ? clipped.map((k) => k.name).join(' ') : '无'));
  }
}
