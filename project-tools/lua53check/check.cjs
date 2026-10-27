// tools/lua53check/check.cjs
// 用 fengari（JS 实现的 Lua 5.3，与千星沙箱同版本语义）加载一个 .lua 文件，
// 看它能不能被 5.3 编译/执行。用来复现"沙箱里脚本不跑"的问题。
//
// 用法： node tools/lua53check/check.cjs <file.lua> [--run]

const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const file = process.argv[2];
const doRun = process.argv.includes('--run');
if (!file) {
  console.error('usage: node check.cjs <file.lua> [--run]');
  process.exit(2);
}

const abs = path.resolve(file);
const src = fs.readFileSync(abs, 'utf8');

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// 沙箱里 io.* / coroutine.* / 大部分 os.* / debug.* 都不可用；这里同样撤掉，
// 让"本地能过、沙箱不能过"的差异暴露出来。
const KILL = ['io', 'os', 'debug', 'dofile', 'loadfile', 'require', 'collectgarbage'];
for (const name of KILL) {
  lua.lua_pushnil(L);
  lua.lua_setglobal(L, to_luastring(name));
}
// 官方补充的两个数值检查函数
lua.lua_getglobal(L, to_luastring('math'));
lua.lua_pushcfunction(L, (L) => {
  const v = lua.lua_tonumber(L, 1);
  lua.lua_pushboolean(L, Number.isNaN(v) ? 1 : 0);
  return 1;
});
lua.lua_setfield(L, -2, to_luastring('isnan'));
lua.lua_pushcfunction(L, (L) => {
  const v = lua.lua_tonumber(L, 1);
  lua.lua_pushboolean(L, !Number.isFinite(v) ? 1 : 0);
  return 1;
});
lua.lua_setfield(L, -2, to_luastring('isinf'));
lua.lua_pop(L, 1);

const st = lauxlib.luaL_loadbuffer(
  L,
  to_luastring(src),
  src.length,
  to_luastring('@' + path.basename(abs))
);

if (st !== lua.LUA_OK) {
  const msg = lua.lua_tojsstring(L, -1);
  console.log('LOAD FAIL (Lua 5.3 编译失败):');
  console.log('  ' + msg);
  process.exit(1);
}
console.log('LOAD OK  (Lua 5.3 编译通过)  ' + src.length + ' 字符 / ' + src.split('\n').length + ' 行');

if (doRun) {
  const st2 = lua.lua_pcall(L, 0, 0, 0);
  if (st2 !== lua.LUA_OK) {
    console.log('RUN FAIL (顶层 chunk 执行失败):');
    console.log('  ' + lua.lua_tojsstring(L, -1));
    process.exit(1);
  }
  console.log('RUN OK   (顶层 chunk 执行到底)');
  // 报告生命周期函数是否定义
  for (const n of ['OnInit', 'OnStart', 'OnUpdate', 'OnDestroy']) {
    lua.lua_getglobal(L, to_luastring(n));
    const t = lua.lua_type(L, -1);
    console.log('  ' + n + ' = ' + lua.lua_typename(L, t));
    lua.lua_pop(L, 1);
  }
}
