// tools/sim/probe_paint.mjs —— 问模拟器要「绘制列表」，看弹窗控件到底画在哪
// 用法：node tools/sim/probe_paint.mjs

import path from 'node:path';
import fs from 'node:fs';
import { makeController, loadPlan, buildProject, indexTree, OUT, WORKSPACE } from './kit.mjs';

const c = await makeController();
buildProject(c, loadPlan(), path.join(WORKSPACE, 'dist', 'client_script.lua'));

await c.play('start', {});
await c.play('step', { dt: 0.05 });
await c.play('click', { name: 'intro.skip' });
await c.play('step', { dt: 0.05 });
await c.play('click', { name: 'action.back' });      // 打开选关面板
await c.play('step', { dt: 0.05 });

// 把所有可能的视图开关都打开，看 paint 会不会有内容
for (const args of [{ inspect: true }, { inspect: true, paint: true },
                    { view: true }, { paint: true }, { inspect: true, view: true, paint: true }]) {
  const g = await c.play('get', args);
  const ri = g && g.result ? g.result : g;
  const keys = Object.keys(ri).filter((k) => Array.isArray(ri[k]));
  const paint = ri.paint || [];
  console.log('args=' + JSON.stringify(args).padEnd(44)
    + ' paint=' + String(paint.length).padStart(5)
    + '  数组键: ' + keys.join(','));
  if (paint.length > 0) {
    fs.writeFileSync(path.join(OUT, 'paint.json'), JSON.stringify(paint, null, 2));
    console.log('    paint[0] = ' + JSON.stringify(paint[0]).slice(0, 300));
    const hits = paint.filter((p) => JSON.stringify(p).includes('modal'));
    console.log('    含 modal 的: ' + hits.length);
    for (const h of hits.slice(0, 6)) console.log('      ' + JSON.stringify(h).slice(0, 240));
    // 顺便看看第一格和标题在哪
    const cells = paint.filter((p) => JSON.stringify(p).includes('cell.1.1'));
    for (const x of cells.slice(0, 2)) console.log('    cell.1.1 -> ' + JSON.stringify(x).slice(0, 240));
  }
}

const g = await c.play('get', { inspect: true });
const ri = g && g.result ? g.result : g;
const t = indexTree(ri);
for (const k of ['modal', 'modal.title', 'modal.level.case_001', 'cell.1.1', 'board', 'root']) {
  const n = t.get(k);
  console.log('  ' + k.padEnd(24) + (n ? ('pos=(' + (n.posX ?? n.anchoredPositionX) + ',' + (n.posY ?? n.anchoredPositionY)
    + ') size=' + (n.width ?? n.sizeDeltaX) + 'x' + (n.height ?? n.sizeDeltaY)
    + ' visible=' + n.visible + ' active=' + n.active) : 'MISSING'));
}

await c.play('stop', {});
await c.dispose();
