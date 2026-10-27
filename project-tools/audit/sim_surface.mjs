// tools/audit/sim_surface.mjs —— 机械提取「模拟器到底实现了什么」
//
// 为什么要这一步：
//   我们这几轮反复返工，根因是**四种来源没有对齐**：
//     ① 我代码里的假设  ② 模拟器的实现  ③ 官方文档  ④ 真机实测
//   其中②以前是"靠读源码猜"，很容易像 `InstantiateClientUIControl` 那次一样
//   得出相反结论（我一开始说"模拟器没有这个 API"，其实是有的）。
//   所以这里改成**从插件 bundle 里机械提取**，产出可复现的 sim-surface.json。
//
// 模拟器插件是个 ~250KB 的可读 bundle（不是压缩过的），里面有：
//   · game 的函数表：  Object.freeze({ InstantiateClientUIControl:2, ... })   ← 名字: 参数个数
//   · Enum 的各个类型：yi.KeyboardKeyCode=Vs; yi.KeyEventType=Bs();
//   · 控件方法表：    AddCursorEventListener:this.method(...)
//   · 控件可写字段：  Ns=["name","parent",...]
//
// 用法：node tools/audit/sim_surface.mjs
// 输出：tools/audit/out/sim-surface.json  +  控制台摘要

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');
const PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
const OUTDIR = path.join(HERE, 'out');

function readPlugin() {
  if (!fs.existsSync(PLUGIN)) {
    console.error('!! 找不到模拟器插件：' + PLUGIN);
    console.error('   可用环境变量 SIM_PLUGIN 指定路径。');
    process.exit(2);
  }
  return fs.readFileSync(PLUGIN, 'utf8');
}

/** 从 `Object.freeze({ Name:2, Other:0 })` 这种表里抽出 名字→参数个数。
 *  插件里有 9 个 `Object.freeze({...})`，所以不能取第一个 ——
 *  要取**含指定锚点**的那个（第一版就是取第一个，只抽到 4 项的颜色表）。 */
function extractArityTable(src, anchorName) {
  let best = null;
  for (const m of src.matchAll(/Object\.freeze\(\{([^{}]*)\}\)/g)) {
    const body = m[1];
    const out = {};
    for (const hit of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)\s*,?/g)) {
      out[hit[1]] = Number(hit[2]);
    }
    const n = Object.keys(out).length;
    if (anchorName && out[anchorName] !== undefined) return out;   // 命中锚点，直接用它
    if (!best || n > Object.keys(best).length) best = out;
  }
  return best;
}

/** 扫描 `var yi={...}` 里**深度 1** 的键名。
 *  值是字符串数组（`EaseType:["Linear",...]`），所以用括号深度扫描比正则稳。 */
function topLevelKeysAt(src, startIndex) {
  const keys = [];
  let i = startIndex, depth = 0;
  let expectKey = true;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{' || ch === '[') { depth++; i++; if (depth === 2) expectKey = false; continue; }
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth <= 0) break;
      i++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      if (m) {
        const after = src.slice(i + m[0].length).match(/^\s*:/);
        if (after) { keys.push(m[0]); expectKey = false; }
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return keys;
}

function main() {
  const src = readPlugin();
  const result = {
    生成时间: new Date().toISOString(),
    插件路径: PLUGIN,
    插件字符数: src.length,
  };

  // ── 1. game.* 函数表 ────────────────────────────────────────────────────
  const game = extractArityTable(src, 'InstantiateClientUIControl');
  if (!game || Object.keys(game).length === 0) {
    console.error('!! 抽不出 game 函数表 —— 插件 bundle 结构可能变了，别当成"模拟器没有 API"');
    process.exit(3);
  }
  result.game函数 = game;

  // ── 2. Enum 的类型名 ────────────────────────────────────────────────────
  // 插件的写法：var yi={EaseType:[...], Device:[...], ...}，再补几个 yi.X=...
  const enumNames = new Set();
  const yiDecl = /var\s+yi\s*=\s*\{/.exec(src);
  if (yiDecl) {
    const start = yiDecl.index + yiDecl[0].length - 1;   // 指向 '{'
    for (const k of topLevelKeysAt(src, start)) enumNames.add(k);
  }
  for (const hit of src.matchAll(/\byi\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) enumNames.add(hit[1]);
  result.Enum类型 = [...enumNames].sort();
  result.Enum类型数 = result.Enum类型.length;

  // KeyEventType 是程序化生成的：抽一下它生成了哪些"名字模式"
  const keyGen = src.match(/function\s+\w+\(\)\{let e=\[\];for\(let t of\["Down","Up"\]\)\{([\s\S]{0,900}?)\}return e\}/);
  result.KeyEventType生成规则 = keyGen
    ? {
        原文: keyGen[1].replace(/\s+/g, ' ').slice(0, 600),
        说明: '模拟器**按命名规则生成** Enum.KeyEventType，与官方文档同源；'
            + '所以"具体键名存不存在"两边的判断一致，但**物理键→事件的映射**模拟不了',
      }
    : null;

  // ── 3. 控件方法表 ───────────────────────────────────────────────────────
  // 形如：AddCursorEventListener:this.method((n,r,o)=>n.AddCursorEventListener(me(r),o))
  const methods = new Set();
  for (const hit of src.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*this\.method\(/g)) {
    methods.add(hit[1]);
  }
  result.控件方法 = [...methods].sort();

  // ── 4. 控件可写字段 ────────────────────────────────────────────────────
  // 形如：Ns=["name","parent","anchoredPositionX", ...]
  const fields = [];
  for (const hit of src.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\[((?:"[A-Za-z][A-Za-z0-9_]*"\s*,\s*){4,}"[A-Za-z][A-Za-z0-9_]*")\]/g)) {
    const list = [...hit[2].matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)].map((x) => x[1]);
    fields.push({ 变量: hit[1], 字段: list });
  }
  result.控件字段表 = fields;

  // ── 5. 行为标记（"模拟器做了什么"的关键事实，供人工核对）──────────────
  const MARKERS = {
    instantiate_OnInit_返回null: /instantiate\([^)]*\)\{if\([a-z]==="OnInit"\|\|[a-z]==="OnDestroy"\)return null/,
    templates_来自客户端控件模板: /assetType==="client-control-template"/,
    registerTemplate按prefabIndex: /registerTemplate\([^)]*\)\{this\.templates\.set\(Number\(/,
    keyListener不校验第一个参数: /AddKeyEventListener\(t,i\)\{this\._addListener\(this\.keyListeners,t,i\)\}/,
    cursorEventsEnabled要祖先showCursor: /cursorEventsEnabled\([^)]*\)\{for\([^)]*;[^)]*;[^)]*\)if\([^)]*kind==="container"&&[^)]*showCursor===!0\)return!0/,
    OnInit里OnUpdate要updateEnabled: /t==="OnUpdate"&&!n\.updateEnabled/,
    prefabIndex取authoringGuid: /prefabIndex:e\.guid\|\|0/,
  };
  result.行为标记 = {};
  for (const [k, re] of Object.entries(MARKERS)) result.行为标记[k] = re.test(src);

  fs.mkdirSync(OUTDIR, { recursive: true });
  const file = path.join(OUTDIR, 'sim-surface.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');

  console.log('模拟器 API 面（机械提取，不是猜的）');
  console.log('  插件：' + PLUGIN + '  (' + src.length + ' 字符)');
  console.log('  game.* 函数        : ' + Object.keys(game).length + ' 个');
  console.log('  Enum.* 类型        : ' + result.Enum类型.length + ' 个');
  console.log('  控件方法           : ' + result.控件方法.length + ' 个');
  console.log('  控件字段表         : ' + fields.length + ' 组');
  console.log('  行为标记           : '
    + Object.entries(result.行为标记).filter(([, v]) => v).length + ' / '
    + Object.keys(result.行为标记).length + ' 命中');
  console.log('  → ' + path.relative(WORKSPACE, file));
  if (Object.keys(game).length < 20) {
    console.error('!! game 函数只抽到 ' + Object.keys(game).length + ' 个（预期 20+）—— 提取可能坏了');
    process.exit(4);
  }
  const miss = Object.entries(result.行为标记).filter(([, v]) => !v).map(([k]) => k);
  if (miss.length) console.log('  （未命中的标记：' + miss.join(', ') + '）');
}

main();
