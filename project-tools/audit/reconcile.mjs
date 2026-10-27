// tools/audit/reconcile.mjs —— 四方对照：我的代码 / 模拟器 / 官方文档 / 真机实测
//
// 目的（用户提的）：把四种来源摊在一起对照，机械能查的全部机械查，
// 查不了的**一律标成"未验证"并写成可实验的步骤**，不再让"我推出来的机制"混进结论。
//
// 机械能查的三件事：
//   ① 模拟器实现了什么   → 读 tools/audit/out/sim-surface.json（由 sim_surface.mjs 提取）
//   ② 官方文档写了什么   → 读 docs/api-cache/*.txt（44 篇官方正文，随工程一起保存）
//   ③ 我的代码用了什么   → 扫 lua/*.lua 里的 E("枚举.成员") / game.Xxx( / :Xxx(
// 查不了的：真机实测 → 读 tools/audit/notes.mjs（人工台账）
//
// 用法：node tools/audit/reconcile.mjs
// 输出：docs/API-四方对照.md、docs/未验证清单.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 行为差异, 未验证 } from './notes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// ── 输入 ──────────────────────────────────────────────────────────────────
const surfaceFile = path.join(OUT, 'sim-surface.json');
if (!exists(surfaceFile)) {
  console.error('!! 缺 ' + path.relative(WORKSPACE, surfaceFile)
    + ' —— 先跑 node tools/audit/sim_surface.mjs');
  process.exit(2);
}
const surface = JSON.parse(read(surfaceFile));

const cacheDir = path.join(WORKSPACE, 'docs', 'api-cache');
const docFiles = exists(cacheDir)
  ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.txt')).sort()
  : [];
if (docFiles.length === 0) {
  console.error('!! docs/api-cache/ 里没有官方文档正文 —— 对照会退化成"文档列全空"，没有意义');
  process.exit(2);
}
const docText = docFiles.map((f) => read(path.join(cacheDir, f))).join('\n');

// 我的源码
const luaDir = path.join(WORKSPACE, 'lua');
const luaFiles = fs.readdirSync(luaDir).filter((f) => f.endsWith('.lua'))
  .map((f) => ({ name: f, text: read(path.join(luaDir, f)) }));
const luaAll = luaFiles.map((f) => f.text).join('\n');

// ── ③ 我的代码用了什么 ────────────────────────────────────────────────────
const usedEnumMembers = new Map();   // 枚举类型 → Set(成员)
const DYNAMIC = '<动态>';            // 成员名是运行时拼出来的，源码里看不到
for (const m of luaAll.matchAll(/\bE\(\s*"([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)"\s*\)/g)) {
  const [, type, member] = m;
  if (!usedEnumMembers.has(type)) usedEnumMembers.set(type, new Set());
  usedEnumMembers.get(type).add(member);
}
// 动态拼接：E("CursorEventType." .. ev) / E("EaseType." .. tostring(name))
// 这种源码里看不到成员名，但**枚举类型是我们依赖的**，必须列出来 ——
// 第一版漏了这一步，结果"我方用到 2 个枚举类型"是个严重低估。
for (const m of luaAll.matchAll(/\bE\(\s*"([A-Za-z][A-Za-z0-9_]*)\."\s*\.\./g)) {
  const type = m[1];
  if (!usedEnumMembers.has(type)) usedEnumMembers.set(type, new Set());
  usedEnumMembers.get(type).add(DYNAMIC);
}
const usedEnumTypes = new Set(usedEnumMembers.keys());

const usedGameFns = new Set();
for (const m of luaAll.matchAll(/\bgame\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) usedGameFns.add(m[1]);
// game.Xxx 也常被直接读字段（不走调用），补一轮
for (const m of luaAll.matchAll(/\bgame\.([A-Za-z_][A-Za-z0-9_]*)/g)) usedGameFns.add(m[1]);
// pcall(game.Xxx, ...) 这种写法
for (const m of luaAll.matchAll(/pcall\(\s*game\.([A-Za-z_][A-Za-z0-9_]*)/g)) usedGameFns.add(m[1]);

const calledMethods = new Set();
for (const m of luaAll.matchAll(/[:.]([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) calledMethods.add(m[1]);

// ── 判定辅助 ──────────────────────────────────────────────────────────────
const inDoc = (name) => docText.includes(name);
const simGame = new Set(Object.keys(surface.game函数 || {}));
const simEnums = new Set(surface.Enum类型 || []);
const simMethods = new Set(surface.控件方法 || []);

const YES = '✅';
const NO = '❌';
const GEN = '生成式';

const 状态 = { 一致: 0, 我方用了但文档没有: 0, 我方用了但模拟器没有: 0, 模拟器有但文档没有: 0 };

function mark(ok, bad) { return ok ? YES : bad; }

// ── 表 1：game.* ──────────────────────────────────────────────────────────
const gameRows = [];
for (const fn of [...new Set([...simGame, ...usedGameFns])].sort()) {
  const used = usedGameFns.has(fn);
  const sim = simGame.has(fn);
  const doc = inDoc(fn);
  let st;
  if (used && !doc) { st = '⚠️ 我方在用但**官方文档没写**'; 状态.我方用了但文档没有++; }
  else if (used && !sim) { st = '⚠️ 我方在用但**模拟器没实现**（模拟器测不到）'; 状态.我方用了但模拟器没有++; }
  else if (!used && doc && !sim) { st = 'ℹ️ 文档有、模拟器无（我方未用）'; 状态.模拟器有但文档没有++; }
  else { st = '一致'; 状态.一致++; }
  gameRows.push({ fn, used, sim, doc, st });
}

// ── 表 2：Enum.* 类型 ─────────────────────────────────────────────────────
const enumRows = [];
for (const t of [...new Set([...simEnums, ...usedEnumTypes])].sort()) {
  const used = usedEnumTypes.has(t);
  const sim = simEnums.has(t);
  const doc = inDoc('Enum.' + t);
  const members = used ? [...usedEnumMembers.get(t)] : [];
  // KeyEventType 是程序化生成的，成员无法枚举 → 不逐个判
  const gen = t === 'KeyEventType' && surface.KeyEventType生成规则;
  let missDoc = [];
  let missSim = [];
  if (used && !gen) {
    // 动态成员名（源码里拼出来的）没法逐个查文档，排除掉
    missDoc = members.filter((x) => x !== DYNAMIC && !inDoc(x));
  }
  let st;
  if (used && !doc) st = '⚠️ 我方在用但文档没写这个枚举类型';
  else if (used && !sim) st = '⚠️ 我方在用但模拟器没有这个枚举类型';
  else if (missDoc.length) st = '⚠️ 有成员在文档里找不到：' + missDoc.join(', ');
  else st = '一致';
  enumRows.push({ t, used, sim, doc: doc || gen, members, st, gen: !!gen });
}

// ── 表 3：控件方法（只看我方调用、且**环境真的暴露了**的）────────────────
//
// ⚠️ 第一版只查 simMethods（控件方法表），于是把 `GetClientUIRoots` / `Tween`
//    这些**game 函数**判成"模拟器没实现" —— 它们当然不在控件方法表里。
//    正确做法：控件方法 ∪ game 函数 都算"模拟器有这个接口"。
const methodRows = [];
for (const m of [...calledMethods].sort()) {
  const inSimMethods = simMethods.has(m);
  const inSimGame = simGame.has(m);
  if (!inSimMethods && !inSimGame) continue;   // 环境没暴露 → 是我们自己的函数，跳过
  const sim = true;
  const doc = inDoc(m + '(') || inDoc(m);
  const where = inSimMethods ? '控件方法' : 'game 函数';
  let st;
  if (!doc) st = 'ℹ️ 模拟器有、**官方文档没写**（"仅模拟器有"要当心）';
  else st = '一致';
  methodRows.push({ m, sim, doc, st, where });
}

// ── 汇总数字 ──────────────────────────────────────────────────────────────
const nUnverified = 未验证.length;
const nDiff = 行为差异.length;

// ── 输出：docs/API-四方对照.md ────────────────────────────────────────────
const L = [];
const w = (s = '') => L.push(s);
const T = (b) => (b ? '✅' : '—');

w('# API 四方对照（我的代码 / 模拟器 / 官方文档 / 真机实测）');
w();
w('> **本文件是自动生成的**，不要手改。重新生成：');
w('> ```powershell');
w('> node tools/audit/sim_surface.mjs    # ① 从模拟器插件机械提取它的 API 面');
w('> node tools/audit/reconcile.mjs      # ② 四方对照 + 生成未验证清单');
w('> ```');
w('>');
w('> 手工核对的那部分（真机实测栏）在 `tools/audit/notes.mjs` —— 那是**唯一需要人写**的输入。');
w();
w('## 为什么要有这份文件');
w();
w('我们连续几轮返工，根因不是"写错代码"，而是**四种来源互相矛盾却没被摆在一起看**：');
w();
w('| 来源 | 性质 | 典型坑 |');
w('|---|---|---|');
w('| ① 我的代码假设 | 最不可靠 | 我曾从**自己上一版代码的报错文案**里继承流程指引，而那句从没核对过文档 |');
w('| ② 模拟器实现 | 可机械提取，但**不等于真机** | 它**不校验** `AddKeyEventListener` 的第一个参数 → 键盘测试在模拟器里"通过"、真机 30 个全炸 |');
w('| ③ 官方文档 | 权威，但**容易读漏读混** | 我把「图片类型」和「图片属性」读成一个东西，还据此改了素材尺寸 |');
w('| ④ 真机实测 | **唯一能定案的** | 一条日志就把 ① 和 ③ 的两个错误同时钉死了 |');
w();
w('**规矩**：①②③ 冲突时以 ④ 为准；**没有 ④ 的一律标"未验证"，不许写成结论。**');
w();

w('## 一、总览');
w();
w('| 项 | 数量 |');
w('|---|---|');
w('| 模拟器 `game.*` 函数 | ' + simGame.size + ' |');
w('| 模拟器 `Enum.*` 类型 | ' + simEnums.size + ' |');
w('| 模拟器 控件方法 | ' + simMethods.size + ' |');
w('| 官方文档正文（随工程保存） | ' + docFiles.length + ' 篇 |');
w('| **我方代码用到的** `game.*` | ' + usedGameFns.size + ' |');
w('| **我方代码用到的** `Enum.*` 类型 | ' + usedEnumTypes.size + ' |');
w('| 行为性差异（人工核对） | ' + nDiff + ' 条 |');
w('| **未验证（待你真机实验）** | **' + nUnverified + ' 条** → `docs/未验证清单.md` |');
w();
w('各方言的**模拟器侧**数据来自插件 bundle 的机械提取（不是读源码猜的）：');
w('```');
w('插件：' + surface.插件路径);
w('字符数：' + surface.插件字符数);
w('```');
w();

w('## 二、`game.*` 函数对照');
w();
w('| 函数 | 我方在用 | 模拟器有 | 文档有 | 状态 |');
w('|---|---|---|---|---|');
for (const r of gameRows) {
  w('| `' + r.fn + '` | ' + T(r.used) + ' | ' + T(r.sim) + ' | ' + T(r.doc) + ' | ' + r.st + ' |');
}
w();

w('## 三、`Enum.*` 类型对照');
w();
w('| 枚举类型 | 我方在用 | 模拟器有 | 文档有 | 我方用到的成员 | 状态 |');
w('|---|---|---|---|---|---|');
for (const r of enumRows) {
  const mem = r.members.length === 0 ? '—'
    : (r.gen ? `（${GEN}：${r.members.length} 个，无法逐个枚举）`
             : r.members.length + ' 个');
  w('| `' + r.t + '` | ' + T(r.used) + ' | ' + T(r.sim) + ' | ' + T(r.doc) + ' | ' + mem + ' | ' + r.st + ' |');
}
w();
w('### 我方用到的枚举成员明细');
w();
for (const t of [...usedEnumTypes].sort()) {
  const ms = [...usedEnumMembers.get(t)].sort();
  const hasDyn = ms.includes(DYNAMIC);
  const named = ms.filter((x) => x !== DYNAMIC);
  const parts = [];
  if (named.length) parts.push(named.map((x) => '`' + x + '`').join('、'));
  if (hasDyn) parts.push('**（还有运行时拼出来的成员名，源码里看不到）**');
  w('- **`Enum.' + t + '`**：' + (parts.join('　') || '—'));
}
w();

w('## 四、控件方法 / game 函数对照（只看我方调用、且环境真的暴露了的）');
w();
w('| 名字 | 在哪暴露 | 文档有 | 状态 |');
w('|---|---|---|---|');
for (const r of methodRows) {
  w('| `' + r.m + '` | ' + r.where + ' | ' + T(r.doc) + ' | ' + r.st + ' |');
}
w();
w('> 这张表的价值在**最后一列**：凡是「模拟器有、官方文档没写」的，');
w('> 都可能是插件作者的臆造，真机上要特别小心。反过来，');
w('> 「文档有、模拟器没有」的接口（见 §二 的 ⚠️ 行）**在模拟器里根本测不到**，只能真机验。');
w();

w('## 五、行为性差异（人工核对，这些才是真正咬人的）');
w();
for (let i = 0; i < 行为差异.length; i++) {
  const r = 行为差异[i];
  w('### ' + (i + 1) + '. ' + r.项);
  w();
  w('| 来源 | 内容 |');
  w('|---|---|');
  w('| **我的代码** | ' + r.我的代码 + ' |');
  w('| **模拟器** | ' + r.模拟器 + ' |');
  w('| **官方文档** | ' + r.官方文档 + ' |');
  w('| **真机实测** | ' + r.真机实测 + ' |');
  w('| **状态** | `' + r.状态 + '` |');
  w();
  if (r.教训) { w('> ' + r.教训); w(); }
}

w('## 六、未验证清单（摘要）');
w();
w('**完整实验步骤见 [`docs/未验证清单.md`](未验证清单.md)。**');
w();
w('| 优先级 | 项 |');
w('|---|---|');
for (const u of 未验证) w('| ' + u.优先级 + ' | ' + u.项 + ' |');
w();

// ── 七、社区知识库覆盖情况 ────────────────────────────────────────────────
w('## 七、社区知识库的覆盖能力（第四来源）');
w();
w('社区源：`1475505/dsh-plugin-miliastra-toolbox` → 底层 HTTP 知识库。');
w('抓取脚本：`node tools/audit/fetch_kb.mjs`（详见 `docs/社区知识来源.md`）。');
w();
const kbIndex = path.join(WORKSPACE, 'docs', 'community-cache', 'kb-index.tsv');
let kbReport = null;
if (exists(kbIndex)) {
  const kbIds = new Map();
  for (const line of read(kbIndex).split('\n').slice(1)) {
    const [title, file, id] = line.split('\t');
    if (id) kbIds.set(id.trim(), title);
  }
  const mf = path.join(cacheDir, 'manifest.tsv');
  const ours = [];
  if (exists(mf)) {
    for (const raw of read(mf).split('\n')) {
      // ⚠️ manifest 是 PowerShell `Out-File -Encoding UTF8` 写的，**带 BOM**；
      //    不去掉的话第一行的 id 会变成 "\ufeffmh0mrr0c4xps"，
      //    于是凭空多出一条"社区库缺失"的假记录（第一版就是这样）。
      const line = raw.replace(/^\ufeff/, '');
      const [id, title] = line.split('\t');
      if (id && id !== '_正文接口') ours.push({ id, title });
    }
  }
  const missing = ours.filter((o) => !kbIds.has(o.id));
  kbReport = { kb: kbIds.size, ours: ours.length, missing };
  w('| 项 | 数量 |');
  w('|---|---|');
  w('| 本工程官方缓存 | ' + ours.length + ' 篇 |');
  w('| 社区知识库（带 path_id） | ' + kbIds.size + ' 篇 |');
  w('| **官方有、社区库没有** | **' + missing.length + ' 篇** |');
  w();
  if (missing.length) {
    w('社区库**缺的这几篇，恰好是 7.1「客户端控件」全家桶**；');
    w('也就是说 **它对我们的核心命题没有交叉验证能力**：');
    w();
    w('| path_id | 标题 |');
    w('|---|---|');
    for (const m of missing) w('| `' + m.id + '` | ' + (m.title || '(?)') + ' |');
    w();
    w('> 另有实测证据：知识库的专用索引 `list_client_documents` **返回 `total=0`**，');
    w('> 而它自己的 `skill-lua.md` 却声称覆盖「客户端控件与脚本文档，共 10 篇」——');
    w('> **说明与实际服务不一致**。这是"社区来源必须回官方核对"的活例子。');
    w();
  }
} else {
  w('（还没抓过：`node tools/audit/fetch_kb.mjs`。抓完这一节会自动填上覆盖对比。）');
  w();
}

const outDoc = path.join(WORKSPACE, 'docs', 'API-四方对照.md');
fs.writeFileSync(outDoc, L.join('\n') + '\n', 'utf8');

// ── 输出：docs/未验证清单.md ──────────────────────────────────────────────
const U = [];
const uw = (s = '') => U.push(s);
uw('# 未验证清单（请你逐步实验）');
uw();
uw('> **自动生成**，来源 `tools/audit/notes.mjs` 的 `未验证` 段。');
uw('> 每一条都写了：为什么不确定 / 怎么做 / 结果怎么读。');
uw();
uw('这份清单存在的理由：**凡是我"推出来的机制"，一律不许当结论** ——');
uw('我们已经被这种做法坑过两次（「基础=按原始像素画」「右键另存为模板可实例化」），');
uw('两次都是你在编辑器里一实验就推翻了。所以现在把它们全部摊开、标注、交给你验。');
uw();
uw('验完一条，就把 `tools/audit/notes.mjs` 里对应条目从 `未验证` 挪到 `行为差异`');
uw('（并把「真机实测」栏填上结论、状态改成 `已确认`），然后重跑 '); 
uw('`node tools/audit/reconcile.mjs`。');
uw();
uw('---');
uw();
const 顺序 = ['高（当前唯一阻塞项）', '高', '中', '低'];
const sorted = [...未验证].sort((a, b) => 顺序.indexOf(a.优先级) - 顺序.indexOf(b.优先级));
for (let i = 0; i < sorted.length; i++) {
  const u = sorted[i];
  uw('## ' + (i + 1) + '. ' + u.项);
  uw();
  uw('**优先级**：' + u.优先级);
  uw();
  uw('**为什么不确定**：' + u.为什么不确定);
  uw();
  uw('**实验步骤**：');
  uw();
  for (const s of u.实验步骤) uw('- ' + s);
  uw();
  uw('**结果怎么读**：');
  uw();
  uw('| 你看到 | 含义 |');
  uw('|---|---|');
  for (const [k, v] of Object.entries(u.结果怎么读)) uw('| ' + k + ' | ' + v + ' |');
  uw();
  uw('---');
  uw();
}

const outUn = path.join(WORKSPACE, 'docs', '未验证清单.md');
fs.writeFileSync(outUn, U.join('\n') + '\n', 'utf8');

// ── 控制台摘要 ────────────────────────────────────────────────────────────
console.log('四方对照已生成：');
console.log('  ' + path.relative(WORKSPACE, outDoc));
console.log('  ' + path.relative(WORKSPACE, outUn));
console.log('');
console.log('  game.*  : 模拟器 ' + simGame.size + ' / 我方用到 ' + usedGameFns.size);
console.log('  Enum.*  : 模拟器 ' + simEnums.size + ' / 我方用到 ' + usedEnumTypes.size);
console.log('  控件方法: 模拟器 ' + simMethods.size + ' / 对照表列出 ' + methodRows.length);
console.log('  行为差异: ' + nDiff + ' 条；未验证: ' + nUnverified + ' 条');
const warn = gameRows.filter((r) => r.st.startsWith('⚠'));
if (warn.length) {
  console.log('');
  console.log('  ⚠️ 我方在用、但存在缺口的 game 函数：');
  for (const r of warn) console.log('     ' + r.fn + '  → ' + r.st);
}
