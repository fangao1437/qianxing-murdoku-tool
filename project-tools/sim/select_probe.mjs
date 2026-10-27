// tools/sim/select_probe.mjs —— 选关界面：**四张卡片是否都渲染出来**（2026-10-18 真机回报"只渲染了一张"）
//
//   跑法：node tools/sim/select_probe.mjs [tag]
//   ★ 读的是**运行树真值**：每张卡的 visible / active / 位置 / 尺寸 / 有没有被别的控件盖住
//   ★ 截图落在 tools/sim/out/<tag>-1-select.png
import fs from 'node:fs';
import path from 'node:path';
import { makeController, OUT } from './kit.mjs';

const SAVE = process.env.SIM_SAVE || 'sim-save/hint-v256.save.json';
const TAG = process.argv[2] || 'sel';
const keep = [];
const note = (s) => { keep.push(s); console.log('  ' + s); };

const c = await makeController();
await c.loadArchive(SAVE);
note('已载档 ' + SAVE);

const settle = async (dt = 0.5) => { await c.play('pause', {}); await c.play('step', { dt }); };
const shot = async (name) => {
  const img = await c.playScreenshot();
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
  note('截图 → ' + path.basename(f));
};

let s = await c.play('start', { canvasId: 'mobile-16-9' });
note('start: running=' + s.running + ' mountError=' + JSON.stringify(s.mountError));
await settle(1.0);
await c.play('click', { name: 'home.select' });
await settle(0.8);

// 把运行树摊平，按名字分组
const flat = [];
(function walk(nodes, depth) {
  for (const n of nodes || []) {
    flat.push({ n, depth });
    walk(n.children, depth + 1);
  }
})((await c.play('get', { inspect: true })).tree || [], 0);

const of = (re) => flat.filter((x) => re.test(x.n.name || ''));
const cards = of(/^select\.card\.\d+$/).sort((a, b) => a.n.name.localeCompare(b.n.name));
note('运行树里 select.card.N = ' + cards.length + ' 个');
for (const { n } of cards) {
  note('  ' + n.name.padEnd(15)
    + ' visible=' + n.visible + ' active=' + n.active
    + ' pos=(' + Number(n.anchoredPositionX).toFixed(0) + ',' + Number(n.anchoredPositionY).toFixed(0) + ')'
    + ' size=' + Number(n.sizeDeltaX).toFixed(0) + '×' + Number(n.sizeDeltaY).toFixed(0)
    + ' 子=' + (n.children || []).length);
}
const hits = of(/^hit\.select\.card\.\d+$/);
note('hit.select.card.N = ' + hits.length);
const panels = of(/^(select|home)$/);
for (const { n } of panels) note('面板 ' + n.name + ' visible=' + n.visible + ' 子=' + (n.children || []).length);

// ★ 诊断日志：`editor_card_box` 读到的原始值（一次性探针）
{
  const s2 = await c.play('get', {});
  for (const l of s2.logs || []) {
    if (/editor_card_box|贴格|尺寸/.test(l.text) && !keep.includes('LOG ' + l.text)) {
      keep.push('LOG ' + l.text);
      console.log('  LOG ' + l.text);
    }
  }
}

// 选关标题（排查"看起来只有一个卡"是不是被别的东西盖住）
const overlays = flat.filter((x) => x.n.visible === true && /^(settle|help|pause|intro)/.test(x.n.name || ''));
note('其它可见面板：' + (overlays.map((x) => x.n.name).join(', ') || '(无)'));

await shot(TAG + '-1-select');

// 第二屏：点第 3 张卡（case_002）确认进入的是哪一关
await c.play('click', { name: 'hit.select.card.3' });
await settle(0.8);
const after = await c.play('get', { inspect: true });
const logs = (after.logs || []).map((x) => x.text).filter((t) => /进入关卡|关卡|case_/.test(t));
note('进关日志：' + (logs.slice(-3).join(' | ') || '(无)'));
await shot(TAG + '-2-level3');

const logFile = path.join(OUT, TAG + '.log.txt');
fs.writeFileSync(logFile, keep.join('\n'));
console.log('过程日志 → ' + logFile);
await c.play('stop', {});
await c.dispose();
