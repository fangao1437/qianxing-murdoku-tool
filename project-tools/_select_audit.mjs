// tools/_select_audit.mjs —— 审计「鼠标/触摸能选到哪些角色」vs「关卡要求放哪些角色」
//
// 为什么需要它（2026-10-09）：
//   选角色的入口在 `ui_controller.lua` 里**只有三处**发 `suspect`：
//     ① `:884`  键盘 `pick<N>` → `vm.tray[N].id`  ← ★ **只有这一条能选到"全部棋子"** ✓
//     ② `:2483` 老卡片 `clue.<i>.face`（按钮）    ← 按线索生成 ✓
//     ③ `:4789` 网格视窗列表项点击（`:4767` 方案 A）← 取 `cl.who` ✓
//   而 ②③ 都**只覆盖"线索里点到名的人"** ✓ 且 `cl.who` 以 `@` 开头（角色别名，如 `@thief`）
//   会被 `:4783` **主动跳过** ✓（设计如此：「身份靠推理而不是靠报名字」✓）
//   ⇒ ★ 于是【没被任何线索点名】的棋子，**键盘能选、鼠标/触摸选不到** ✓
//
// 本工具直接读**关卡文件**（`who` / `pieces` 都是地面真值 ✓），逐个关卡算差集 ✓
//
// 用法：node tools/_select_audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = ['demo_selftest', 'case_001', 'case_002', 'case_003'];

let anyMissing = false;
for (const f of LEVELS) {
  const p = path.join(ROOT, 'lua', 'levels', f + '.lua');
  if (!fs.existsSync(p)) { console.log(f + '  —— 文件不存在'); continue; }
  const t = fs.readFileSync(p, 'utf8');

  const block = (name) => {
    const m = t.match(new RegExp(name + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}'));
    return m ? m[1] : '';
  };

  const who = [...block('clues').matchAll(/who\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const named = [...new Set(who.filter((w) => !w.startsWith('@')))].sort();
  const alias = [...new Set(who.filter((w) => w.startsWith('@')))].sort();
  // ⚠️ 关卡里那份"要摆的棋子"叫 **`suspects`**（不是 `pieces` —— 我第一版写错、算出 0 个 ✗）
  //    它同时含受害者（`is_victim = true`）⇒ 受害者**也要摆** ✓ 证据：`solution` 里有它 ✓
  const pieces = [...new Set([...block('suspects').matchAll(/id\s*=\s*"([A-Z])"/g)].map((m) => m[1]))].sort();
  const thief = (t.match(/thief\s*=\s*"([A-Z])"/) || [])[1] || '?';

  const missing = pieces.filter((x) => !named.includes(x));
  if (missing.length) anyMissing = true;

  console.log(f.padEnd(16) + ' 棋子 suspects[' + pieces.join(',') + ']  (共 ' + pieces.length + ')   盗窃者=' + thief);
  console.log(''.padEnd(16) + ' 线索点名[' + named.join(',') + ']  别名[' + (alias.join(',') || '无') + ']');
  console.log(''.padEnd(16) + ' ⇒ 鼠标/触摸【选不到】: ' + (missing.length ? missing.join(',') + '   ❌' : '（无）   ✅')
    + (missing.includes(thief) ? '   ← ★ 其中包含【盗窃者】!!' : ''));
}
console.log('\n★ 键盘 pick1..pickN（`ui_controller.lua:884`）能选到 `vm.tray` 全部棋子 ⇒ PC 不受影响 ✓');
console.log(anyMissing ? '★ 但【触摸端】存在选不到的角色 ⇒ 对应的关卡在移动端可能打不通 ✗'
                       : '★ 四个关卡在触摸端都能选全 ✓');
process.exit(anyMissing ? 1 : 0);
