// tools/build_bundle.mjs —— 把 lua/src/*.lua 拼成单文件
//
// 两种形态（同一份源码，行为一致）：
//   --mode standalone   → lua/main.lua    注册 7 个全局生命周期，整份挂到一个控件上（当前交付形态）
//   --mode module       → lua/module.lua  只暴露全局 `Tutorial`，不抢任何全局回调，供并入关卡主脚本
//
// 为什么拼成单文件：千星脚本 require 走导入根（"default_import_file/…"），依赖映射是否建立；
//   单文件挂载没有这条路径风险，"内联 source vs 磁盘文件"也只有一份真相。
//   源码仍按模块分文件（好读好改），评审都在 src 里做。
//
// 用法：node tools/build_bundle.mjs [--mode standalone|module] [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'lua', 'src');

const argv = process.argv.slice(2);
const modeArg = (() => {
  const i = argv.indexOf('--mode');
  return i >= 0 ? argv[i + 1] : 'standalone';
})();
const MODE = modeArg === 'module' ? 'module' : 'standalone';
const OUT = path.join(ROOT, 'lua', MODE === 'module' ? 'module.lua' : 'main.lua');

// 顺序 = 依赖顺序（模块之间只引用**前面**出现过的名字）
const MODULES = [
  ['Util', '00_util.lua'],
  ['Engine', '10_engine.lua'],
  ['Bind', '20_bind.lua'],
  ['State', '30_state.lua'],
  ['Screen', '40_screen.lua'],
  ['Pager', '50_pager.lua'],
  ['Input', '60_input.lua'],
  ['App', '70_app.lua'],
  ['Entry', '90_entry.lua'],
  ['Tutorial', '91_api.lua'],
];

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.lua')).sort();
const declared = MODULES.map(([, f]) => f);
const extra = files.filter((f) => !declared.includes(f));
if (extra.length) {
  console.error('src 里存在未纳入打包顺序的文件：', extra.join(', '));
  process.exit(2);
}

const parts = [];
if (MODE === 'module') parts.push('--!strict-lite');
parts.push('--[[==========================================================================');
parts.push(`  lua/${MODE === 'module' ? 'module' : 'main'}.lua —— 千星 2D「翻页单击活动」UI 框架（**由 tools/build_bundle.mjs 生成，请勿手改**）`);
parts.push('');
parts.push('  源码：workspace/qxqy-ui-system/lua/src/*.lua（模块顺序见 tools/build_bundle.mjs）');
parts.push(
  MODE === 'module'
    ? '  形态：module —— 不注册全局生命周期，只暴露全局 `Tutorial`；用 Tutorial.install{...} 后由主脚本转发 tick'
    : '  形态：standalone —— 注册 7 个全局生命周期；整份挂到 app.root'
);
parts.push('==========================================================================]]');
parts.push('');

for (const [name, file] of MODULES) {
  const body = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
  if (!/\breturn M\b/.test(body)) {
    console.error(`${file} 末尾缺少 return M`);
    process.exit(3);
  }
  parts.push(`-- ==========================================================================`);
  parts.push(`-- module: ${name}   (lua/src/${file})`);
  parts.push(`-- ==========================================================================`);
  parts.push(`local ${name} = (function()`);
  parts.push(body.replace(/\n+$/, ''));
  parts.push(`end)()`);
  parts.push('');
}

if (MODE === 'module') {
  parts.push('-- ==========================================================================');
  parts.push('-- 对外只暴露一个全局：Tutorial（不注册 OnInit/OnStart/OnUpdate，避免抢主脚本的回调）');
  parts.push('--');
  parts.push('-- 用法（并入关卡主脚本时）：');
  parts.push('--   local T = Tutorial.install({ root_name = "tutorial.root", keys_enabled = false })');
  parts.push('--   function OnStart() T.OnStart() end              -- 或 Tutorial.api().OnStart()');
  parts.push('--   function OnUpdate(dt) T.OnUpdate(dt) ... end     -- 主脚本自己分派 dt');
  parts.push('--   T.act("close") / T.show("p2") / T.hide() / T.state() / T.diag()');
  parts.push('-- ==========================================================================');
  parts.push('-- ==========================================================================');
  // 注意：不能写 `Tutorial = Tutorial` —— 同名的 local 在作用域内，赋值会落到 **local** 上，
  // 全局永远是 nil（本仓库踩过：离线冒烟测试第一个断言就红）。显式写 _G。
  parts.push('_G.Tutorial = Tutorial');
} else {
  parts.push('-- ==========================================================================');
  parts.push('-- 生命周期回调注册为**全局函数**（官方《客户端控件API文档》§1：按固定名称查找）');
  parts.push('-- ==========================================================================');
  for (const fn of ['OnInit', 'OnStart', 'OnEnable', 'OnUpdate', 'OnLevelUpdate', 'OnDisable', 'OnDestroy']) {
    parts.push(`${fn} = Entry.${fn}`);
  }
  parts.push('');
  parts.push('-- 调试入口：试玩控制台/其它脚本可调 `QxUI_PrintTree()` 打整棵控件树');
  parts.push('function QxUI_PrintTree() Engine.print_tree() end');
  parts.push('function QxUI_Diag() return App.diag() end');
  parts.push('function QxUI_Act(action) return App.act(action, "api") end');
}
parts.push('');

const out = parts.join('\n');
if (argv.includes('--check')) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old !== out) {
    console.error(`${path.relative(ROOT, OUT)} 与 src 不一致，请运行 build（--mode ${MODE}）`);
    process.exit(4);
  }
  console.log(`${path.relative(ROOT, OUT)} 一致 ✓ ${out.length} bytes`);
} else {
  fs.writeFileSync(OUT, out);
  console.log(
    `已生成 ${path.relative(ROOT, OUT)}（mode=${MODE}）：${out.split('\n').length} 行 / ${out.length} 字节 / ${MODULES.length} 个模块`
  );
}
