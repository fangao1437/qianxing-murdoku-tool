// tools/patch_engine_selfref.mjs —— 修正 Engine 模块自引用
// 背景：打包后 Engine 是 bundle 级 local。Engine 模块**内部**不能用 `Engine.is_ctrl`，
//       否则在它的 local 声明完成前解析成全局 nil（实测报错
//       `main.lua:175: attempt to index a nil value (global 'Engine')`）。
//       模块内部一律用局部 `ctrl_like`。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const p = path.resolve(HERE, '..', 'lua', 'src', '10_engine.lua');
let s = fs.readFileSync(p, 'utf8');
const before = s;
s = s.split('not Engine.is_ctrl(').join('not ctrl_like(');
s = s.split('not Engine.is_script(').join('not ctrl_like(');
if (s === before) {
  console.log('10_engine.lua: 无自引用需要修正');
} else {
  fs.writeFileSync(p, s);
  console.log('10_engine.lua: 已把模块内 Engine.is_ctrl/is_script 改为局部 ctrl_like');
}
