// tools/sim/calib2.mjs —— 第二轮标定：区分「pos=中心/左下角」×「父级=画布/父级左下/父级中心」
//
// 设计成三个假设下渲染位置两两不同，看一眼白块包围盒就能定论。
//
//   根级 R1   pos=(1400,800) 100x100
//   根级 R2   pos=( 300,700) 100x100  （pivot 显式设 1,1，测 pivot 是否被尊重）
//   容器 BOX  pos=( 400,300) 600x400  → 期望中心 (400,300)、左下 (100,100)
//   子   P    pos=( 100,100) 100x100
//   子   Q    pos=(  50, 50) 100x100
//
// 子控件中心位置的三个假设：
//   (a) 父左下 + pos → P(200,200) Q(150,150)
//   (b) 父中心 + pos → P(500,400) Q(450,350)
//   (c) 画布原点 + pos（忽略父级）→ P(100,100) Q(50,50)
//
// 用法：node tools/sim/calib2.mjs

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
const { SimulatorController } = await import('file://' + PLUGIN);
const WORKSPACE = process.env.SIM_WORKSPACE || 'D:\\新建文件夹\\miHoYo Launcher\\qianxing-murdoku';
const OUT = path.join(WORKSPACE, 'tools', 'sim', 'out');

const c = new SimulatorController(WORKSPACE);
const errs = [];
const P = (l, op) => { try { return c.patch(op); } catch (e) { errs.push(l + ' :: ' + e.message); return null; } };

let p = P('newAsset', { op: 'newAsset', assetType: 'server-control-template' });
const root = (p.root.children || [])[0];
for (const ch of (root.children || []).slice()) P('rm', { op: 'remove', id: ch.id });

const SPEC = [
  ['R1',  'image',     null, 1400, 800, 100, 100, {}],
  ['R2',  'image',     null,  300, 700, 100, 100, { pivotX: 1, pivotY: 1, anchorMinX: 1, anchorMinY: 1, anchorMaxX: 1, anchorMaxY: 1 }],
  ['BOX', 'container', null,  400, 300, 600, 400, {}],
  ['P',   'image',     'BOX', 100, 100, 100, 100, {}],
  ['Q',   'image',     'BOX',  50,  50, 100, 100, {}],
];

const ids = { null: root.id };
for (const [name, kind, parent, x, y, w, h, extra] of SPEC) {
  const r = P('add ' + name, { op: 'add', kind, name, parentId: ids[parent] });
  if (!r) continue;
  ids[name] = r.selectedId;
  const props = { width: w, height: h, posX: x, posY: y, imageId: 100001 };
  for (const [k, v] of Object.entries(extra)) props[k] = v;
  for (const [k, v] of Object.entries(props)) P(name + '.' + k, { op: 'set', id: ids[name], key: k, value: v });
}
console.log('建 ' + SPEC.length + ' 个，错误 ' + errs.length + (errs.length ? '\n  ' + errs.join('\n  ') : ''));

fs.writeFileSync(path.join(OUT, 'calib2-project.json'), JSON.stringify(c.get(), null, 2));

await c.play('start', {});
await c.play('step', { dt: 1 });
const gi = await c.play('get', { inspect: true });
const ri = gi && gi.result ? gi.result : gi;
fs.writeFileSync(path.join(OUT, 'calib2-inspect.json'), JSON.stringify(gi, null, 2));

console.log('\n回读树:');
const walk = (x, d) => {
  console.log('  ' + '  '.repeat(d) + x.name + ' [' + x.kind + '] pos=(' + (x.posX ?? x.anchoredPositionX) + ',' + (x.posY ?? x.anchoredPositionY)
    + ') size=' + (x.width ?? x.sizeDeltaX) + 'x' + (x.height ?? x.sizeDeltaY)
    + ' pivot=(' + x.pivotX + ',' + x.pivotY + ') anchor=(' + x.anchorMinX + ',' + x.anchorMinY + ')-(' + x.anchorMaxX + ',' + x.anchorMaxY + ')');
  for (const k of (x.children || [])) walk(k, d + 1);
};
for (const x of (ri.tree || [])) walk(x, 0);

try {
  const s = await c.requestScreenshot();
  const data = s && (s.png || s.data || s.base64 || s.image);
  if (data) { fs.writeFileSync(path.join(OUT, 'calib2.png'), Buffer.from(data, 'base64')); console.log('\n截图 -> tools/sim/out/calib2.png'); }
} catch (e) { console.log('截图失败: ' + e.message); }

await c.play('stop', {});
await c.dispose();
