// tools/patch_guards.mjs —— 一次性把「控件对象只当 table」的判据换成 Engine.is_ctrl
// 背景（实测）：运行时控件是 **userdata**（tostring 形如 `Control: 0x1ef`），
//             只有 name / visible / 方法可用；`id` 字段不可读。
//             所以任何 `type(x) ~= "table"` 的守卫都会把真控件判成非法 → 必须换。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'lua', 'src');

const REPLACEMENTS = [
  ['if type(ctrl) ~= "table" then return nil end', 'if not Engine.is_ctrl(ctrl) then return nil end'],
  ['if type(ctrl) ~= "table" then return false end', 'if not Engine.is_ctrl(ctrl) then return false end'],
  ['if type(ctrl) ~= "table" or image_id == nil then return false end', 'if not Engine.is_ctrl(ctrl) or image_id == nil then return false end'],
  ['if type(ctrl) ~= "table" or argb == nil then return false end', 'if not Engine.is_ctrl(ctrl) or argb == nil then return false end'],
  ['if type(ctrl) ~= "table" or type(cb) ~= "function" then return false end', 'if not Engine.is_ctrl(ctrl) or type(cb) ~= "function" then return false end'],
  ['if type(script_obj) ~= "table" or type(cb) ~= "function" then return false end', 'if not Engine.is_script(script_obj) or type(cb) ~= "function" then return false end'],
  ['if type(ctrl) ~= "table" or depth > 32 then return end', 'if not Engine.is_ctrl(ctrl) or depth > 32 then return end'],
  ['if type(list) == "table" and Engine.name_of(list) ~= nil then list = { list } end', 'if Engine.is_ctrl(list) then list = { list } end'],
];

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(SRC).filter((f) => f.endsWith('.lua'));

for (const f of files) {
  const p = path.join(SRC, f);
  let s = fs.readFileSync(p, 'utf8');
  let hits = 0;
  for (const [a, b] of REPLACEMENTS) {
    const parts = s.split(a);
    if (parts.length > 1) {
      hits += parts.length - 1;
      s = parts.join(b);
    }
  }
  if (hits) {
    fs.writeFileSync(p, s);
    console.log(`${f}: ${hits} 处替换`);
  } else {
    console.log(`${f}: 无命中`);
  }
}
