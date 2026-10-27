// tools/gil/find_script.mjs —— 在 .gil 里定位**内嵌的客户端脚本**
//
// 背景（2026-09-27）：用户导入我生成的 .gil 后，关卡目录里出现的是**导出那一刻的旧脚本**
//   （353.3KB 而非我的最新版）→ 跑的是旧代码，新加的诊断全都没有。
//   ⇒ 必须把"当前脚本"写进 .gil，做到**导入即最新**。
//
// 做法：脚本是纯文本。扫描整棵树的**叶子文本字段**，找"看起来像 Lua 源码"的那个
//   （长度大、含 `function ` / `end` / `[murdoku]` 等特征）。
//
// 用法：node tools/gil/find_script.mjs <存档.gil>

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || path.join(ROOT, '存档.gil');
const g = readGil(file);

console.log('文件：' + path.basename(file) + '（' + g.src.length + ' 字节）');

// 遍历整棵树，收集所有"较大的叶子字节字段"
const cands = [];
(function walk(fields, pathStr) {
  for (const f of fields) {
    const here = pathStr + '/#' + f.field;
    if (f.wt === 2 && f.sub === null && f.payload && f.payload.length > 2000) {
      // 看是不是文本
      const s = f.payload.toString('utf8');
      const bad = (s.match(/\uFFFD/g) || []).length;
      const lua = /function\s|local\s|\bend\b/.test(s);
      cands.push({ path: here, len: f.payload.length, bad, lua, at: f.s0, head: s.slice(0, 90).replace(/\n/g, '\\n') });
    }
    if (f.sub) walk(f.sub, here);
  }
})(g.tree, '');

cands.sort((a, b) => b.len - a.len);
console.log('\n大叶子字段（> 2000 字节）：' + cands.length + ' 个\n');
for (const c of cands.slice(0, 12)) {
  console.log('  @' + String(c.at).padStart(7) + '  ' + String(c.len).padStart(8) + ' 字节'
    + '  U+FFFD×' + c.bad + (c.lua ? '  像Lua' : '      ')
    + '  ' + c.path);
  console.log('        ' + c.head + '…');
}

const best = cands.filter((c) => c.lua && c.bad < c.len * 0.01).sort((a, b) => b.len - a.len)[0];
if (best) {
  console.log('\n★ 最像"内嵌的 Lua 脚本"的是：' + best.path + '（' + best.len + ' 字节，@' + best.at + '）');
  console.log('   dist/client_script.lua 是 ' + (await import('node:fs')).readFileSync(path.join(ROOT, 'dist', 'client_script.lua')).length + ' 字节');
} else {
  console.log('\n**没找到像 Lua 的大字段** —— 说明脚本不在 .gil 里，或编码方式不同。');
}
