#!/usr/bin/env node
/**
 * verify_press_feedback.mjs —— ★★ 破坏性验证：把"越过门槛的即时反馈"去掉
 *   （= 用户"偶尔放不上去"的那一版 ✗），确认 §9 **真的会红** ✓；然后逐字节还原 ✓。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const P = REPO + '/lua/ui_controller.lua';
const LUA = process.env.LOCALAPPDATA + '/Programs/Lua/bin/lua.exe';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const orig = fs.readFileSync(P, 'utf8');

// ★★★★★★★★ 2026-10-11 **起手先验"源码还在"** ✗✓✓（★ 两次真实事故换来的护栏 ✓）
//
//   ★★★ 事故 ✓：★ `lua/ui_controller.lua` **被写空成 0 字节** ✗ —— ★ 而且发生了两次 ✓
//     ★★ 而 **`luac -p` 对空文件【返回 0】** ✗✓（★ 空 chunk 语法合法 ✓）
//       ⇒ ★ 语法闸门**放行** ✓ ⇒ ★ 打包器把空模块打进去 ⇒ ★ 产物从 1.16MB 掉到 0.66MB ✓
//       ⇒ ★★ **19 套回归全红** ✓✓
//     ★ 更糟 ✓：★ 这些"破坏性验证"脚本**自己会写这个文件** ✓
//       ⇒ ★ 它们跑在一个**已经空了**的文件上 ⇒ ★ 锚点自然找不到 ⇒
//         ★★ 于是**每个脚本都报一句误导的错**（"锚点找不到" ✗）✓
//         ★ 而**真正的问题**（文件是空的 ✓）**没有一个人说出来** ✓✓
//   ⇒ ★ 所以每个脚本**起手先断言源码是满的** ✓：
//     ★ 不满 ⇒ ★ **立刻退出，什么都不写** ✓ ⇒ ★ 不会把事故放大 ✓✓
const MIN_BYTES = 200000;
if (orig.length < MIN_BYTES) {
  console.error('✗ 拒绝运行：' + P + ' 只有 ' + orig.length + ' 字节（应 ≥ ' + MIN_BYTES + '）');
  console.error('   ★ 源码可能是【空的 / 被写坏了】✗ —— 先恢复：');
  console.error('     git checkout -- lua/ui_controller.lua');
  console.error('   ★ 本脚本【不写任何东西】就退出 ✓（免得把事故放大 ✓）');
  process.exit(3);
}
const origSha = sha(orig);

// ★ 语法合法地把那一段变成永假 ✓
const NEEDLE = 'if p ~= nil and p.fired ~= true and p.dt >= LONG_PRESS_SECONDS then';
if (!orig.includes(NEEDLE)) { console.error('✗ 找不到反馈锚点'); process.exit(2); }
const patched = orig.replace(NEEDLE,
  'if p ~= nil and p.fired ~= true and p.dt >= LONG_PRESS_SECONDS and false then');
fs.writeFileSync(P, patched, 'utf8');

const b = spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
let red = false, tail = '';
if (b.status !== 0) {
  console.error('✗ 打包失败 ⇒ 破坏语法不合法 ⇒ 结果无效');
  console.error(((b.stderr || '') + '').split('\n').slice(0, 3).join('\n'));
  red = true;
} else {
  const bundle = fs.readFileSync(REPO + '/dist/client_script.lua', 'utf8');
  const reached = bundle.includes('p.dt >= LONG_PRESS_SECONDS and false');  console.log('破坏进产物 = ' + reached);
  if (!reached) console.error('✗ 破坏没进产物 ⇒ 结果无效');
  const r = spawnSync(LUA, ['tests/input_logic.lua'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  red = r.status !== 0;
  tail = ((r.stdout || '') + '').split('\n').filter((l) => l.includes('FAIL') || l.includes('passed,')).slice(0, 3).join('\n');
}

fs.writeFileSync(P, orig, 'utf8');
spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
const restored = sha(fs.readFileSync(P, 'utf8')) === origSha;

console.log('去掉「越过门槛的即时反馈」⇒ input_logic 变红 = ' + (red ? '✅ 是（哨兵有效）' : '❌ 否（哨兵无效）'));
if (tail) console.log(tail.split('\n').map((l) => '    ' + l.trim()).join('\n'));
console.log('还原后逐字节相同 = ' + (restored ? '✅' : '❌'));
process.exit(red && restored ? 0 : 1);
