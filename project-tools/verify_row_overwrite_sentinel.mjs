#!/usr/bin/env node
/**
 * verify_row_overwrite_sentinel.mjs —— ★ 破坏性验证：
 *   把"先到先得"那段改回去（= 真机出 `AAF` 的那一版 ✗），
 *   确认新加的 §2b **真的会红** ✓；然后**逐字节还原** ✓。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const P = REPO + '/lua/ui_controller.lua';
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
const orig = fs.readFileSync(P, 'utf8');
const origSha = sha(orig);

const GOOD = `                      Controller._row_letter[_pid] = tostring(_lt)`;
if (!(orig.split(GOOD).length - 1)) { console.error('✗ 找不到无条件写那一行'); process.exit(2); }
// ★ 改回"已经有值就不覆盖"（= 修复前的语义 ✗）
const BAD = `                      if Controller._row_letter[_pid] == nil then
                        Controller._row_letter[_pid] = tostring(_lt)
                      end`;
fs.writeFileSync(P, orig.replace(GOOD, BAD), 'utf8');

const b = spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
if (b.status !== 0) { console.error('✗ 打包失败'); fs.writeFileSync(P, orig, 'utf8'); process.exit(3); }
const r = spawnSync(LUA, ['tests/level3_letter_map.lua'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const red = r.status !== 0;
const tail = ((r.stdout || '') + '').split('\n').filter((l) => l.includes('FAIL') || l.includes('passed,')).slice(0, 4).join('\n');

fs.writeFileSync(P, orig, 'utf8');
spawnSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, encoding: 'utf8' });
const restored = sha(fs.readFileSync(P, 'utf8')) === origSha;

console.log('改回「先到先得」⇒ level3_letter_map 变红 = ' + (red ? '✅ 是（哨兵有效）' : '❌ 否（哨兵无效）'));
if (red) console.log(tail.split('\n').map((l) => '    ' + l.trim()).join('\n'));
console.log('还原后逐字节相同 = ' + (restored ? '✅' : '❌'));
process.exit(red && restored ? 0 : 1);
