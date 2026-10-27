// tools/sim/calibrate.mjs —— 标定模拟器的 posX/posY 语义
//
// 放 5 个宽度不同的色块在已知的「画布绝对·左下角原点」坐标上，
// 再放 1 个容器 + 1 个嵌套子控件，用来判断：
//   · 画布原点在哪一角
//   · posX/posY 是「相对父级左下角」还是「相对父级中心」
//   · 是否发生缩放
// 跑完把 inspect 结果整份落盘，并截图。
//
// 用法：node tools/sim/calibrate.mjs

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
const { SimulatorController } = await import('file://' + PLUGIN);

const WORKSPACE = process.env.SIM_WORKSPACE || 'D:\\新建文件夹\\miHoYo Launcher\\qianxing-murdoku';
const OUT = path.join(WORKSPACE, 'tools', 'sim', 'out');
fs.mkdirSync(OUT, { recursive: true });

const c = new SimulatorController(WORKSPACE);
const errors = [];
const P = (label, op) => { try { return c.patch(op); } catch (e) { errors.push(label + ' :: ' + e.message); return null; } };

// 画布假定 1600×900，原点左下
const CANVAS_W = 1600, CANVAS_H = 900;

// [name, kind, parent, absLeft, absBottom, w, h]
const MARKERS = [
  ['mkA', 'image',   null,    0,   0, 100, 60],   // 左下角
  ['mkB', 'image',   null, 1400,   0, 200, 60],   // 右下角
  ['mkC', 'image',   null,    0, 840, 300, 60],   // 左上角
  ['mkD', 'image',   null, 1200, 840, 400, 60],   // 右上角
  ['mkE', 'image',   null,  550, 420, 500, 60],   // 居中
  ['box', 'container', null,  0, 100, 600, 300],  // 嵌套测试父级
  ['mkF', 'image',   'box',  50,  50, 100, 60],   // = 绝对 (50, 150)
];

let p = P('newAsset server', { op: 'newAsset', assetType: 'server-control-template' });
const container = (p.root.children || [])[0];
for (const ch of (container.children || []).slice()) P('rm ' + ch.name, { op: 'remove', id: ch.id });

const idOf = { null: container.id };
const box = { null: { l: 0, b: 0, w: CANVAS_W, h: CANVAS_H } };

for (const [name, kind, parent, l, b, w, h] of MARKERS) {
  const pb = box[parent];
  const r = P('add ' + name, { op: 'add', kind, name, parentId: idOf[parent] });
  if (!r) continue;
  const id = r.selectedId;
  idOf[name] = id;
  box[name] = { l, b, w, h };
  const props = {
    width: w, height: h,
    posX: l - pb.l, posY: b - pb.b,
    anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0,
    pivotX: 0, pivotY: 0,
  };
  if (kind === 'image') props.imageId = 100001;
  for (const [k, v] of Object.entries(props)) P(name + '.' + k, { op: 'set', id, key: k, value: v });
}

console.log('建了 ' + MARKERS.length + ' 个标定控件，错误 ' + errors.length);
for (const e of errors) console.log('  [ERR] ' + e);

// 记录「编辑器侧」的工程 JSON（不含运行时）
fs.writeFileSync(path.join(OUT, 'calib-project.json'), JSON.stringify(c.get(), null, 2));

await c.play('start', {});
await c.play('step', { dt: 1 });
const gi = await c.play('get', { inspect: true });
fs.writeFileSync(path.join(OUT, 'calib-inspect.json'), JSON.stringify(gi, null, 2));

const ri = gi && gi.result ? gi.result : gi;
console.log('\ninspect 顶层键: ' + Object.keys(ri).join(', '));
console.log('canvas: ' + JSON.stringify(ri.canvas || ri.size || ri.screen || null));

const flat = [];
const walk = (x, d) => {
  flat.push({ d, name: x.name, kind: x.kind, x: x.posX ?? x.anchoredPositionX, y: x.posY ?? x.anchoredPositionY,
    w: x.width ?? x.sizeDeltaX, h: x.height ?? x.sizeDeltaY, vis: x.visible, act: x.active });
  for (const k of (x.children || [])) walk(k, d + 1);
};
for (const x of (ri.tree || [])) walk(x, 0);
console.log('\n运行时全树（' + flat.length + ' 节点）:');
for (const f of flat) console.log('  ' + '  '.repeat(f.d) + f.name + ' [' + f.kind + '] pos=(' + f.x + ',' + f.y + ') size=' + f.w + 'x' + f.h + ' vis=' + f.vis + ' act=' + f.act);

try {
  const shot = await c.requestScreenshot();
  const data = shot && (shot.png || shot.data || shot.base64 || shot.image);
  if (data) {
    const out = path.join(OUT, 'calib.png');
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log('\n截图 -> ' + out + ' (' + fs.statSync(out).size + ' 字节)');
  } else {
    console.log('\n截图返回里没有图像数据，键: ' + Object.keys(shot || {}).join(','));
  }
} catch (e) { console.log('截图失败: ' + e.message); }

await c.play('stop', {});
await c.dispose();
