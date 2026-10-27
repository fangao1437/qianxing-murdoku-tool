// tools/sim/rebuild_save_script.mjs —— 把一个**已建好树的存档**里的 Lua 内联源码换成最新的 dist
//
//   为什么需要它：
//     · `layout-plan` 建树很慢（每个 patch 都回吐整份快照，O(n²)）⇒ 不适合每轮重跑
//     · 而"换脚本"这件事**与树无关** ✓ ⇒ 直接改存档里的 `assets.scripts[].source`
//     · 存档格式见 `Te()`：`{format:"qxqy-simulator-save", version:4, assets:{server,client,scripts:[{id,guid,path,source,controlId,controlAsset}]}}`
//
//   用法：
//     node tools/sim/rebuild_save_script.mjs <源存档> <新的 lua> <输出存档>
//   例：
//     node tools/sim/rebuild_save_script.mjs sim-save/murdoku.save.json dist/client_script.lua sim-save/hint-v254.save.json
import fs from 'node:fs';
import path from 'node:path';

const [, , srcSave, newLua, outSave] = process.argv;
if (!srcSave || !newLua || !outSave) {
  console.error('用法: node tools/sim/rebuild_save_script.mjs <源存档> <新的 lua> <输出存档>');
  process.exit(2);
}

const j = JSON.parse(fs.readFileSync(srcSave, 'utf8'));
const src = fs.readFileSync(newLua, 'utf8');
const scripts = (j.assets && j.assets.scripts) || j.scripts || [];
if (!scripts.length) {
  console.error('源存档里没有 scripts，无法换脚本');
  process.exit(3);
}
for (const s of scripts) {
  s.source = src;
  if (!s.path) s.path = 'qianxing-murdoku/dist/client_script.lua';
}
fs.writeFileSync(outSave, JSON.stringify(j));
const mounted = scripts.filter((s) => s.controlId).length;
console.log('源存档 ' + srcSave + ' → ' + outSave);
console.log('  脚本 ' + scripts.length + ' 条（已挂载 ' + mounted + ' 条），新源码 ' + src.length + ' 字符');
console.log('  输出 ' + fs.statSync(outSave).size + ' 字节');
console.log('  关键代码在不在：' +
  (src.includes('Core:clue_hint') ? 'clue_hint ✓ ' : 'clue_hint ✗ ') +
  (src.includes('809ED8FF') || src.includes('0x809ED8FF') ? 'HINT_TINT ✓' : 'HINT_TINT ✗'));
console.log('  路径 ' + path.resolve(outSave));
