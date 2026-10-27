// tools/gil/check_labels.mjs —— **按钮带 `label` 子控件的覆盖率**闸门
//
// 为什么需要它（2026-10-07）：
//   预设按钮的外观来自**状态节点引用的子控件**；而"按钮文案"这条路在适配器里是
//     `engine_adapter_qianxing.lua:3987  pcall(function() lc = self:sub(id, "label") end)`
//   —— 没有 `label` 子控件 ⇒ `set_property(id, "text", ...)` **永远送不到**
//   ⇒ 真机日志「属性补发 3 次仍未送达：`xxx.text`」+ 按钮在画面里完全透明（空壳）。
//   ⚠️ `.text` 是**属性名**（`ui_controller.lua:4402` 打的是 `id .. "." .. key`），
//      **不是**子控件名 —— 子控件名必须是字面量 `label`。
//
// 判据：规划里 kind=button、且**存档里确实存在**的控件，每一个都要有一个**直接子控件** `label`。
//
// 用法：
//   node tools/gil/check_labels.mjs <存档.gil>
//   node tools/gil/check_labels.mjs 209-弹窗.gil --only=modal        # 只看某批（前缀）
//   node tools/gil/check_labels.mjs 209-弹窗.gil --plan=<plan.json>  # 换规划（默认共享 plan）
//
// 退出码：0=全覆盖 / 1=有按钮缺 label / 2=没有可检查的按钮（多半是 --only 写错）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argOf = (k) => { const a = process.argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const GIL = process.argv[2] || path.join(ROOT, '完整界面.gil');
const PLAN = argOf('plan') || path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json');
const ONLY = (argOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const onlyBy = (id) => ONLY.length === 0 || ONLY.some((pat) => pat.endsWith('*') ? id.startsWith(pat.slice(0, -1)) : id === pat);

if (!fs.existsSync(GIL)) { console.error('缺存档：' + GIL); process.exit(2); }
if (!fs.existsSync(PLAN)) { console.error('缺规划：' + PLAN); process.exit(2); }

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const planButtons = new Set(plan.nodes.filter((n) => n.kind === 'button' && !/^cell\./.test(n.id) && onlyBy(n.id)).map((n) => n.id));
const g = readGil(GIL);

const kidsOf = new Map();                 // 父 id → 子名字集合
for (const r of g.recs) {
  if (r.parentId === null) continue;
  if (!kidsOf.has(r.parentId)) kidsOf.set(r.parentId, new Set());
  kidsOf.get(r.parentId).add(r.name);
}
const byName = new Map();
for (const r of g.recs) if (r.name && !byName.has(r.name)) byName.set(r.name, r);

const found = [], ok = [], missing = [];
for (const name of planButtons) {
  const r = byName.get(name);
  if (!r) continue;                                  // 规划里有、存档里没有 ⇒ 不在本闸门范围
  found.push(name);
  (kidsOf.get(r.id) || new Set()).has('label') ? ok.push(name) : missing.push(name);
}
const absent = [...planButtons].filter((n) => !byName.has(n));

console.log('存档：' + path.basename(GIL) + '（记录 ' + g.recs.length + ' 条）');
console.log('规划里的 button：' + planButtons.size + ' 个' + (ONLY.length ? '（--only=' + ONLY.join(',') + '）' : ''));
console.log('  存档里存在的：' + found.length + ' 个   ⇒ 带 `label` 的 ' + ok.length + '/' + found.length
  + (missing.length ? '  ❌' : '  ✅'));
if (missing.length) for (const n of missing) console.log('     ✗ 缺 label：' + n);
if (absent.length) console.log('  ⓘ 规划有、本存档没有（不属本批）：' + absent.length + ' 个'
  + (absent.length <= 12 ? '：' + absent.join(', ') : ''));

process.exit(found.length === 0 ? 2 : (missing.length === 0 ? 0 : 1));
