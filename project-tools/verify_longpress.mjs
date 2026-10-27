#!/usr/bin/env node
/**
 * verify_longpress.mjs —— ★★ 长按的**破坏性验证**（★ 两个破坏点各一次 ✓）
 *
 *   ★ 为什么要有两个 ✗：★ 长按时长经过**两版**才修对 ✓（★ 用户报了两次 ✓）
 *     ★ 破坏 A ✓：★ 把主判据（按帧累加 `dt`）关掉 ⇒ ★ 退回"时钟差值" ✓
 *       ★★ 并且**造出一根比真实时间慢 4 倍的钟** ✗ —— ★ 那就是真机上
 *         `os.clock`（CPU 时间）的情形 ✓
 *     ★ 破坏 B ✓：★ 把"按住期间累加"整段删掉 ⇒ ★ 一样退回时钟差值 ✓
 *
 *   ⚠️ ★★ 两条铁律（★ 我第一版都踩了 ✓）：
 *     ★ ① ★ **破坏必须语法合法** ✗ —— ★ 我删过一行 `if` 留下 `end` ⇒ **打包失败**
 *       ⇒ ★ 跑的还是旧产物 ⇒ ★ 报"哨兵无效" ✗ ★ 其实是"根本没测到" ✓✓
 *     ★ ② ★ **必须确认破坏真的到位** ✗ —— ★ 否则"没变红"什么都证明不了 ✓
 *   ⇒ ★ 所以这个脚本**先断言破坏进去了** ✓ ★ 再跑测试 ✓ ★ 最后逐字节还原 ✓
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const P = REPO + '/lua/ui_controller.lua';
const T = REPO + '/tests/input_logic.lua';
const LUA = process.env.LOCALAPPDATA + '/Programs/Lua/bin/lua.exe';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ★★★ 起手先验「源码还在」✗✓（★ 两次真实事故换来的护栏 ✓）
//   ★ 空的 ui_controller.lua **能通过 `luac -p`** ✗ ⇒ 打包器照样打 ⇒ 产物少一半 ✓
//   ★★ 而这些破坏性验证脚本**自己会写那个文件** ⇒ 跑在空文件上只会报「锚点找不到」✗
//     ★ 那句话**掩盖了真正的问题**（文件是空的 ✓）⇒ 所以先在这里拦住 ✓
if (fs.readFileSync(P, 'utf8').length < 200000) {
  console.error('✗ 拒绝运行：' + P + ' 太小（★ 源码可能是空的 ✗）');
  console.error('   ★ 先跑： git checkout -- lua/ui_controller.lua');
  console.error('   ★ 本脚本不写任何东西就退出 ✓');
  process.exit(3);
}
const uOrig = fs.readFileSync(P, 'utf8');
const tOrig = fs.readFileSync(T, 'utf8');
const uSha = sha(uOrig), tSha = sha(tOrig);

function restore() {
  fs.writeFileSync(P, uOrig, 'utf8');
  fs.writeFileSync(T, tOrig, 'utf8');
  spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
}
function restoredOk() {
  return sha(fs.readFileSync(P, 'utf8')) === uSha && sha(fs.readFileSync(T, 'utf8')) === tSha;
}

// ★ 测试侧：把假时钟改成"比真实时间慢 4 倍"
const T_NEEDLE = '    CLK = CLK + d';
const tSlow = tOrig.replace(T_NEEDLE,
  '    CLK = CLK + d * 0.25          -- ★★ 破坏：造出「钟比真实慢 4 倍」✗');

const CASES = [
  {
    name: 'A 关掉主判据（按帧累加）＋ 钟慢 4 倍',
    patchU: (s) => s.replace(
      '  if p ~= nil and type(p.dt) == "number" then return p.dt end',
      '  if p ~= nil and type(p.dt) == "number" and false then return p.dt end'),
    marker: 'and false then return p.dt end',
    patchT: () => tSlow,
    testMarker: '* 0.25',
  },
  {
    name: 'B 删掉「按住期间累加 dt」整段（改成永假）',
    patchU: (s) => s.replace(
      '    if p ~= nil then p.dt = (p.dt or 0) + (dt or 0) end',
      '    if p ~= nil and false then p.dt = (p.dt or 0) + (dt or 0) end'),
    marker: 'if p ~= nil and false then p.dt',
    patchT: () => tSlow,
    testMarker: '* 0.25',
  },
];

let allGood = true;
for (const cse of CASES) {
  const pu = cse.patchU(uOrig);
  if (pu === uOrig) { console.error('✗ ' + cse.name + '：破坏没打上（锚点找不到）'); allGood = false; continue; }
  fs.writeFileSync(P, pu, 'utf8');
  fs.writeFileSync(T, cse.patchT(), 'utf8');

  const b = spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
  if (b.status !== 0) {
    console.error('✗ ' + cse.name + '：**打包失败** ⇒ 破坏语法不合法 ⇒ 这次结果无效 ✗');
    restore(); allGood = false; continue;
  }
  const bundle = fs.readFileSync(REPO + '/dist/client_script.lua', 'utf8');
  const reached = bundle.includes(cse.marker) && fs.readFileSync(T, 'utf8').includes(cse.testMarker);
  if (!reached) {
    console.error('✗ ' + cse.name + '：破坏**没进产物/测试** ⇒ 结果无效 ✗');
    restore(); allGood = false; continue;
  }
  const r = spawnSync(LUA, ['tests/input_logic.lua'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const red = r.status !== 0;
  console.log((red ? '✅ ' : '❌ ') + cse.name + ' ⇒ input_logic ' + (red ? '变红（哨兵有效）' : '**没红**（哨兵无效）'));
  if (red) {
    const tail = ((r.stdout || '') + '').split('\n').filter((l) => l.includes('FAIL')).slice(0, 2);
    tail.forEach((l) => console.log('      ' + l.trim()));
  }
  restore();
  if (!restoredOk()) { console.error('✗ 还原失败！'); allGood = false; }
  if (!red) allGood = false;
}

console.log('还原后逐字节相同 = ' + (restoredOk() ? '✅ 两个文件都一致' : '❌'));
process.exit(allGood ? 0 : 1);
