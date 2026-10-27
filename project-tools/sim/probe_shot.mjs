// tools/sim/probe_shot.mjs —— 对照实验：截图到底反映不反映"运行时才打开的弹窗"
//
// 步骤：截一张（弹窗关） → 打开选关面板 → 再截一张（弹窗开）
// 若两张**逐字节相同**，说明 requestScreenshot 用的渲染路径不含运行时显隐变化，
// 即"截图里看不到弹窗"是**模拟器预览的限制**，不是我们 UI 的问题
// —— 因为同一时刻的 paint 列表里确实有这些控件（见 probe_paint.mjs）。
//
// 用法：node tools/sim/probe_shot.mjs

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeController, loadPlan, buildProject, OUT, WORKSPACE } from './kit.mjs';

const c = await makeController();
buildProject(c, loadPlan(), path.join(WORKSPACE, 'dist', 'client_script.lua'));
await c.play('start', {});
await c.play('step', { dt: 0.05 });
await c.play('click', { name: 'intro.skip' });
await c.play('step', { dt: 0.05 });

const grab = async (tag) => {
  const s = await c.requestScreenshot();
  const data = s && (s.png || s.data || s.base64 || s.image);
  const buf = Buffer.from(data, 'base64');
  const f = path.join(OUT, 'shot-' + tag + '.png');
  fs.writeFileSync(f, buf);
  const paint = (await c.play('get', { paint: true })).paint || [];
  const modalPaint = paint.filter((p) => String(p.name || '').startsWith('modal')).length;
  console.log(`  ${tag}: ${buf.length} 字节  sha1=${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}`
    + `  paint 总数=${paint.length}  含 modal=${modalPaint}`);
  return { buf, paint: paint.length, modalPaint };
};

console.log('=== 1. 弹窗关闭时');
const a = await grab('closed');
console.log('=== 2. 打开选关面板后');
await c.play('click', { name: 'action.back' });
await c.play('step', { dt: 0.05 });
const b = await grab('open');

console.log('\n=== 结论');
const same = a.buf.equals(b.buf);
console.log('  两次截图逐字节相同: ' + same);
console.log('  paint 含 modal 数量: ' + a.modalPaint + ' → ' + b.modalPaint);
if (same && b.modalPaint > a.modalPaint) {
  console.log('  → 截图**不反映**运行时打开的弹窗（paint 里有、截图里没有）= 模拟器预览的限制。');
  console.log('    真机上控件是由游戏 UI 系统渲染的，position/visible 正确即可见 ——');
  console.log('    而 position/visible 已由 paint 列表与 tree 双重确认。');
} else if (!same) {
  console.log('  → 截图会变，说明能看到状态变化；之前"看不到弹窗"需要再查。');
} else {
  console.log('  → 两者一致，请人工比对 shot-closed.png / shot-open.png。');
}

await c.play('stop', {});
await c.dispose();
