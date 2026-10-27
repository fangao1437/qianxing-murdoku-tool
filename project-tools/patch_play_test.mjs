// tools/patch_play_test.mjs —— 按 2026-10-02 的界面定稿更新模拟器测试
//
// 改了什么（对应 lua/ui_controller.lua 的改动）：
//   · 「返回菜单 / 提交 / 重置关卡」现在**先弹 ✓/✗**，点 ✓ 才执行
//     ⇒ 测试里点这三个键之后要再点一次 `confirm.ok`
//   · 「揭示 action.reveal」删除 ⇒ 相关断言去掉
//   · 头像卡 tray 并进线索卡 ⇒ `tray.A` 之类不再存在，改用线索卡
//   · `action.back` 的文案从「返回列表」改成「返回菜单」
//
// 用法：node tools/patch_play_test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = path.join(ROOT, 'tools', 'sim', 'play_test.mjs');
let s = fs.readFileSync(F, 'utf8');
const before = s;
const log = [];

function rep(from, to, note) {
  if (s.includes(from)) { s = s.split(from).join(to); log.push('  OK   ' + note); }
  else log.push('  SKIP ' + note + '（没找到原文）');
}

// ① 插入 confirm 辅助：点危险键 ⇒ 再点 ✓
rep(
  "async function click(",
  `// ★ 2026-10-02：三个"危险键"现在要 ✓ 确认（返回菜单 / 提交 / 重置关卡）。
//   这个包装：先点它，再点 confirm.ok —— 就是玩家实际的两步操作。
async function clickConfirm(id) {
  await click(id);
  await tick(0.05);
  await click('confirm.ok');
  await tick(0.08);
}

async function click(`,
  '插入 clickConfirm 辅助'
);

// ② action.back 的点击都改成两步（返回菜单现在要确认）
s = s.replace(/await click\('action\.back'\);/g, "await clickConfirm('action.back');");
log.push('  OK   action.back 的点击改成 clickConfirm');

// ③ action.submit 的点击改成两步
s = s.replace(/await click\('action\.submit'\);/g, "await clickConfirm('action.submit');");
log.push('  OK   action.submit 的点击改成 clickConfirm');

// ④ action.redo 的点击改成两步
s = s.replace(/await click\('action\.redo'\);/g, "await clickConfirm('action.redo');");
log.push('  OK   action.redo 的点击改成 clickConfirm');

// ⑤ 删掉 action.reveal 的整行（按钮已不存在）
s = s.replace(/^\s*await click\('action\.reveal'\);[^\n]*\n/gm, '');
s = s.replace(/^\s*\/\/[^\n]*reveal[^\n]*\n/gm, '');
log.push('  OK   移除 action.reveal 相关行');

// ⑥ 「返回列表」→「返回菜单」
rep("'返回列表'", "'返回菜单'", 'action.back 文案 返回列表 → 返回菜单');
rep('"返回列表"', '"返回菜单"', 'action.back 文案（双引号版）');

// ⑦ 头像卡 tray 已并入线索卡 ⇒ tray.A / tray.B 改点线索卡
s = s.replace(/await click\('tray\.A'\);/g, "await click('clue.1.face');");
s = s.replace(/await click\('tray\.B'\);/g, "await click('clue.2.face');");
log.push('  OK   tray.A/tray.B → clue.1.face/clue.2.face');

// ⑧ 头像卡文案断言：改成"线索卡存在于树里"
rep(
  "check('头像卡 A 文案正确'",
  "check('线索卡 1 存在于树里'",
  '头像卡文案断言改名'
);

fs.writeFileSync(F, s, 'utf8');
console.log(log.join('\n'));
console.log('  ' + (s === before ? '没有变化' : '已写出 ' + path.relative(ROOT, F)));
