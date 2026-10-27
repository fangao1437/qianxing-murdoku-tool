// tools/gil/gen_tool_catalog.mjs —— 生成 `docs/工具目录.md`（★ 目录必须**可复现**，不能手抄 ✗）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么用"生成"而不是"手写"（2026-10-10 立 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 手写目录**一定会过期** ✗ —— ★ 而"过期的目录"比"没有目录"更坏 ✗
//     （★ 你会照着它去调一个已经被改坏的开关 ✓）
//   ⇒ ★ 所以目录由本脚本从**文件头注释 + 静态检查**自动提取 ✓：
//     · 一句话用途 / 用法 —— 读头部注释 ✓
//     · 是否**写 `.gil`** / 是否**写后重读磁盘** / 是否**走 `writeGil`** —— 静态扫 ✓
//     ★ 这三列就是"检验"的抓手 ✓：★ **凡是写 `.gil` 却不重读的，一律标红** ✓
//   ⇒ ★ 重跑：`node tools/gil/gen_tool_catalog.mjs` ✓（★ 改完工具请重跑 ✓）
//
//   ⚠️ 诚实性约束：★ 本脚本**只报告静态事实** ✓（头部写了什么 / 代码里有没有那类调用 ✓）。
//     ★ 它**不会**、也**不能**声称"某个工具已实测通过" ✗ ——
//     ★ 那必须由人**真的跑一遍** ✓ ⇒ ★ "已实测"那一列来自下面的 `VERIFIED` 白名单 ✓
//       （★ 只有**真的跑过并贴得出输出**的工具才准进白名单 ✓）
//
// 用法：
//   node tools/gil/gen_tool_catalog.mjs            # 写 docs/工具目录.md
//   node tools/gen_tool_catalog.mjs --stdout       # 只打印，不写文件

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', '工具目录.md');
const TYPES = ['.mjs', '.cjs', '.lua', '.ps1', '.cmd', '.bat', '.py', '.js'];

// ★★★ 只有**真的跑过**的才准写在这里 ✓（格式：相对路径 → { 日期, 验收命令 }）
const VERIFIED = {
  'tools/gil/gilread.mjs': { date: '2026-10-10', cmd: 'node tools/gil/_probe_fidelity.mjs . "存档归档"  → 192/192 逐字节一致' },
  'tools/gil/gilwrite.mjs': { date: '2026-10-10', cmd: 'node tools/gil/selftest_write.mjs  → 5 通过 / 0 失败' },
  'tools/gil/selftest_write.mjs': { date: '2026-10-10', cmd: 'node tools/gil/selftest_write.mjs  → 5 通过 / 0 失败' },
  'tools/gil/fix_clue_tpl_origin.mjs': { date: '2026-10-10', cmd: 'node tools/gil/fix_clue_tpl_origin.mjs --in="290.gil" --out="295-模板clue归零-v149.gil"  → 回读 (0,0) ✓' },
  'tools/gil/diff_fields.mjs': { date: '2026-10-10', cmd: 'node tools/gil/diff_fields.mjs "290.gil" "295-模板clue归零-v149.gil"  → 61610 节点 / 差异 2 处' },
  'tools/gil/roundtrip.mjs': { date: '2026-10-10', cmd: 'node tools/gil/roundtrip.mjs "295-模板clue归零-v149.gil"  → 逐字节一致' },
  'tools/gil/_probe_fidelity.mjs': { date: '2026-10-10', cmd: 'node tools/gil/_probe_fidelity.mjs . "存档归档"' },
  'tools/gil/_probe_503.mjs': { date: '2026-10-10', cmd: 'node tools/gil/_probe_503.mjs "290.gil"' },
  'tools/gil/_probe_writepath.mjs': { date: '2026-10-10', cmd: 'node tools/gil/_probe_writepath.mjs "249-占位项改前两项-v111.gil"' },
  'tools/gil/inspect_gil.mjs': { date: '2026-10-10', cmd: 'node tools/gil/inspect_gil.mjs "296-模板归零+脚本v148.gil"  → clue 4 块逐个 / assets 20 项 / row.* 20 个 / 标记 v148' },
  'tools/gil/embed_script.mjs': { date: '2026-10-10', cmd: 'node tools/gil/embed_script.mjs --in="295-模板clue归零-v149.gil" --out=… --expect-marker=v148  → 产出与 296 SHA256 相同 ✓；假源码 v999 ⇒ 拒绝运行 ✓' },
  'tools/gil/gen_palette.mjs': { date: '2026-10-10', cmd: 'node tools/gil/gen_palette.mjs --in="290.gil" --out=…  → 记录 300 ✓、4 个壳都在 assets 下 ✓、roundtrip 逐字节一致 ✓' },
  'tools/repo_bridge.mjs': { date: '2026-10-12', cmd: 'node tools/repo_bridge.mjs selfcheck  → 6695/6708 size 一致 ✓（解析 .git/index ✓）；export --only=lua,tests → 54 文件/1.8MB ✓；apply 演练后工作区哈希未变 ✓' },
  'tools/lua_audit.mjs': { date: '2026-10-12', cmd: 'node tools/lua_audit.mjs  → 语法过 ✓ / 残留 83 处（代码 23＋注释 60）/ 无定义调用 115 / 4 槽位接上 ✓' },
  'tools/lua_blocks.mjs': { date: '2026-10-12', cmd: 'node tools/lua_blocks.mjs lua/ui_controller.lua --verify-delete=5293-5558  → luac 通过 ✓（同区间删到 5513 则失败 ✗，复现 lead 的报错 ✓）' },
};

// ── 已知坏 / 存疑（★ 有实证才写 ✓）────────────────────────────────────────
const KNOWN_BAD = {
  'tools/gil/fix_btn_bg_type.mjs': '头部自述与 gilread 的 encodeMsg 同源风险：它自己写盘、无写后重读 ⇒ 需迁到 writeGil（未逐个实测）',
};

const HEAD_STYLE = { '.mjs': '//', '.cjs': '//', '.js': '//', '.lua': '--', '.ps1': '#', '.cmd': 'REM', '.bat': 'REM', '.py': '#' };

function readHeader(text, ext) {
  const mark = HEAD_STYLE[ext] || '//';
  const lines = text.split(/\r?\n/);
  const hdr = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (t === '') { if (hdr.length) hdr.push(''); continue; }
    if (t.startsWith(mark) || t.startsWith('#!') || /^[╔╗╚╝═─★·\s]+$/.test(t)) { hdr.push(ln); continue; }
    if (/^\s*(\/\*|\*|\*\/)/.test(ln)) { hdr.push(ln); continue; }
    break;
  }
  return hdr;
}

/** 一句话用途：优先取头部里带 `——` 的那一行（本工程的惯例） */
function purposeOf(hdr, fallback) {
  const clean = (s) => s.replace(/^[/#\-\s*]+/, '').replace(/^tools\/[^\s]+\s*[—\-]+\s*/, '').trim();
  for (const ln of hdr) {
    const t = clean(ln);
    if (t.includes('——') && t.length > 6 && t.length < 110 && !/^(用法|为什么|注意|跑法)/.test(t)) return t.replace(/^——\s*/, '');
  }
  for (const ln of hdr) {
    const t = clean(ln);
    if (t && t.length > 8 && t.length < 110 && !/^[═─★·\s]*$/.test(t)) return t.replace(/^——\s*/, '');
  }
  return fallback;
}

/** 用法：头部里 `用法` 之后、看起来像命令的那一行 */
function usageOf(hdr) {
  let seen = false;
  const cmds = [];
  for (const ln of hdr) {
    const t = ln.replace(/^[/#\-\s*]+/, '').trim();
    if (/^用法/.test(t)) { seen = true; continue; }
    if (seen) {
      if (/^(node|lua|powershell|pwsh|&|\.\/|npm|pnpm)\b/.test(t)) cmds.push(t.replace(/^& /, ''));
      else if (cmds.length) break;
    }
  }
  if (cmds.length) return cmds[0];
  const any = hdr.map((l) => l.replace(/^[/#\-\s*]+/, '').trim()).find((t) => /^(node|lua|powershell|pwsh)\s/.test(t));
  return any || null;
}

const WRITE_API = [
  /fs\.writeFileSync\s*\(/g, /fs\.appendFileSync\s*\(/g, /fs\.copyFileSync\s*\(/g,
  /writeFileSync\s*\(/g, /io\.open\s*\([^)]*["']w/g, /Out-File\b/g, /Set-Content\b/g, /Copy-Item\b/g,
];
const READ_AFTER = [/readGil\s*\(/g, /loadTree\s*\(/g, /parseMsg\s*\(/g, /readFileSync\s*\(/g];

/** 去掉字符串字面量与注释 —— ★ 免得"注释/文案里提到 writeGil"被当成"调用了 writeGil" ✗ */
function stripLiterals(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function scanFile(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const text = stripLiterals(raw);
  const ext = path.extname(p).toLowerCase();
  const hdr = readHeader(raw, ext);

  let firstWrite = -1, writeCount = 0;
  for (const re of WRITE_API) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) { writeCount++; if (firstWrite < 0 || m.index < firstWrite) firstWrite = m.index; }
  }
  const mentionsGil = /\.gil\b/.test(raw);
  const firstWriteLine = firstWrite < 0 ? -1 : text.slice(0, firstWrite).split('\n').length;

  // 写后是否重读磁盘（静态近似：第一个写调用**之后**是否出现读调用 ✓）
  let readAfterWrite = false;
  if (firstWrite >= 0) {
    const tail = text.slice(firstWrite);
    readAfterWrite = READ_AFTER.some((re) => { re.lastIndex = 0; return re.test(tail); });
  }
  const usesWriteGil = /\bwriteGil\s*\(/.test(text);
  const usesRoundtrip = /roundtrip\.mjs/.test(raw);
  const editsExisting = /\breadGil\s*\(/.test(text);   // ★ 有输入存档 ⇒ "编辑型" ✓（无 ⇒ "生成型" ✓）
  const dup = [...new Set([
    ...(/function\s+parseMsg\b|const\s+parseMsg\b/.test(text) ? ['parseMsg'] : []),
    ...(/function\s+encodeMsg\b|const\s+encodeMsg\b/.test(text) ? ['encodeMsg'] : []),
    ...(/function\s+writeVarint\b/.test(text) ? ['writeVarint'] : []),
    ...(/function\s+readVarint\b/.test(text) ? ['readVarint'] : []),
    ...(/function\s+ensureChildListTop\b/.test(text) ? ['ensureChildListTop'] : []),
    ...(/function\s+findChildListTop\b/.test(text) ? ['findChildListTop'] : []),
    ...(/function\s+findChildList\b/.test(text) ? ['findChildList'] : []),
    ...(/function\s+setPair\b/.test(text) ? ['setPair'] : []),
    ...(/function\s+cloneField\b/.test(text) ? ['cloneField'] : []),
    ...(/function\s+stateBlocks\b/.test(text) ? ['stateBlocks'] : []),
    ...(/function\s+geomPairs\b/.test(text) ? ['geomPairs'] : []),
    ...(/function\s+bigIds\b/.test(text) ? ['bigIds'] : []),
    ...(/function\s+asIdList\b/.test(text) ? ['asIdList'] : []),
  ])];
  const importsGilread = /from\s+['"]\.\/gilread\.mjs['"]/.test(text);
  const SHARED = ['parseMsg', 'encodeMsg', 'writeVarint', 'readVarint', 'stateBlocks', 'geomPairs', 'bigIds', 'asIdList', 'cloneField', 'findChildListTop', 'findChildList', 'ensureChildListTop', 'setPair'];
  return {
    rel: path.relative(ROOT, p).replace(/\\/g, '/'),
    name: path.basename(p), ext, bytes: fs.statSync(p).size,
    purpose: purposeOf(hdr, '(头部无用途说明)'),
    usage: usageOf(hdr),
    writeCount, firstWriteLine, mentionsGil, readAfterWrite, usesWriteGil, usesRoundtrip, editsExisting,
    // ★ 只有"自己**定义**了同名函数"才算重复实现 ✓（import 进来的不算 ✓）
    dup: importsGilread ? dup.filter((d) => SHARED.includes(d) && new RegExp('function\\s+' + d + '\\b').test(text)) : dup,
    importsGilread,
  };
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // ★ `bin` 是**第三方工具链**（1176 个文件 ✓），不是本工程的工具 ✗ ⇒ 不盘 ✓
      if (['node_modules', 'out', 'dist', '.git', 'archive', '_dl', 'bin', 'lua-tooling', 'examples'].includes(e.name)) continue;
      walkFiles(p, out);
    } else if (TYPES.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** 判定一个工具的"写"风险等级 */
function writeRisk(t) {
  // ★ 通道本身 / 公共实现 ⇒ 单列 ✓（它们是"地基"，不是"待迁工具" ✓）
  if (['tools/gil/gilwrite.mjs', 'tools/gil/gilread.mjs'].includes(t.rel)) return 'core';
  // ★ 写的是**文档**而不是 `.gil` ⇒ 不算"写存档" ✓
  //   （★ 本生成器自己就在写 `docs/工具目录.md` ✗ —— 它的正文里到处是 `.gil` 字样，
  //     ★ 静态扫会把它误判成"写存档工具" ✗ ⇒ ★ 显式排除 ✓）
  if (t.rel === 'tools/gil/gen_tool_catalog.mjs') return null;
  // ★ "走了安全通道" = **既调用了 writeGil** ✓ **又是编辑既有存档的工具** ✓
  //   （★ 只提到名字、或本身就是通道模块 ⇒ 不算 ✗ —— 否则文档里的示例会被误判成"已安全" ✗）
  //   ⚠️ 注意：★ 走了 `writeGil` 的工具**自己不再调 `fs.writeFileSync`** ✗
  //     ⇒ ★ 所以**不能**用"有没有写 API"当门槛 ✗（2026-10-10 实测：那样会把已迁移的判成"不写" ✗）
  if (t.usesWriteGil && t.editsExisting) return 'safe';
  if (!t.writeCount) return null;
  if (t.mentionsGil) return 'risky';
  return 'maybe';
}

const all = [];
for (const p of walkFiles(path.join(ROOT, 'tools'))) all.push(scanFile(p));
// 根目录下的零散脚本也纳入（本工程根目录有一批 *.mjs / *.lua）
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.isFile() && TYPES.includes(path.extname(e.name).toLowerCase())) all.push(scanFile(path.join(ROOT, e.name)));
}

const gil = all.filter((t) => t.rel.startsWith('tools/gil/'));
const other = all.filter((t) => !t.rel.startsWith('tools/gil/'));

// 旧项目 / 资料里的工具线索
const oldTools = [];
(function scanDocs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scanDocs(p); continue; }
    if (TYPES.includes(path.extname(e.name).toLowerCase())) oldTools.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
})(path.join(ROOT, 'docs'));

const rel = (p) => p.replace(/\\/g, '/');
const esc = (s) => String(s).replace(/\|/g, '\\|');
const row = (cells) => '| ' + cells.map(esc).join(' | ') + ' |';

/** ★ 危险等级（★ lead 按此决定"敢不敢直接用" ✓） */
function dangerOf(t) {
  const r = writeRisk(t);
  if (r === 'core') return '— 地基';
  if (r === 'safe') return '★ 低';
  if (r === null) return '— 不写盘';
  if (r === 'risky') return t.usesRoundtrip ? '★★ 中' : '★★★ 高';
  return t.usesRoundtrip ? '★ 中' : '★★ 高';
}

function statusCell(t) {
  if (VERIFIED[t.rel]) return '✅ 已实测';
  if (KNOWN_BAD[t.rel]) return '❌ 已知坏/存疑';
  return '⚠️ 未验证';
}

function tableFor(list, opts = {}) {
  const rows = [
    row(['工具', '危险等级', '一句话用途', '用法', '状态', '验收命令', '最后验证']),
    row(['---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const t of list.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const v = VERIFIED[t.rel];
    rows.push(row([
      '`' + t.rel + '`',
      dangerOf(t),
      t.purpose,
      t.usage ? '`' + t.usage + '`' : '（头部无用法）',
      statusCell(t),
      v ? '`' + v.cmd + '`' : (KNOWN_BAD[t.rel] || '—'),
      v ? v.date : '—',
    ]));
  }
  return rows.join('\n');
}

const risky = gil.filter((t) => writeRisk(t) === 'risky');
const safe = gil.filter((t) => writeRisk(t) === 'safe');
// ★ 公共实现自己不算"副本" ✓（它是**源头** ✓）
const dupFiles = gil.filter((t) => t.dup.length && !t.usesWriteGil
  && !['tools/gil/gilread.mjs', 'tools/gil/gilwrite.mjs'].includes(t.rel));

const md = [];
md.push('# 工具目录（★ 自动生成 ✓ 别手改 ✗）');
md.push('');
md.push('> ★ 本文件由 `node tools/gil/gen_tool_catalog.mjs` **生成** ✓ —— **手改会在下次重跑时丢失** ✗。');
md.push('> 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '　扫描脚本：' + all.length + ' 个');
md.push('');
md.push('## ★ 写 `.gil` 的纪律（★ 2026-10-10 事故后立的规矩）');
md.push('');
md.push('**背景**：`fix_clue_tpl_origin.mjs` 曾**连续两次**打印「✅ 成功」，而**输出文件与输入逐字节相同** ✗');
md.push('（等于什么都没写）。真因在 `gilread.mjs` 的 `encodeMsg`：`#503` 被无条件当成「裸 ID 子列表」，');
md.push('用旧 `payload` 快照、**不递归 `sub`** ⇒ 冻结了 **96%** 的树（实测 `290.gil`：2785 个 `#503` 里');
md.push('**2720 个是真消息**，只有 65 个是真子列表）。`clue` 的位置对正好住在一个 `#503` 底下 ⇒ 修改被丢弃。');
md.push('');
md.push('**规矩**（★ 缺一不可）：');
md.push('');
md.push('1. ★ **写 `.gil` 必须走 `writeGil()`**（`tools/gil/gilwrite.mjs`）✗ 不许自己 `fs.writeFileSync`');
md.push('2. ★ **验收必须从磁盘重读** ✗ 不许拿内存里的值当证据');
md.push('3. ★ **写完立刻过往返闸门**：`node tools/gil/roundtrip.mjs <输出>`');
md.push('4. ★ **"只改一个值"要断言 diff 条数**：`node tools/gil/diff_fields.mjs <输入> <输出>`');
md.push('5. ★ **静默跳过是敌人** —— 拿不到就报错，不许 `if (x) {…}` 悄悄放过');
md.push('');
md.push('⚠️ ★★ **`diff_fields` 的已知局限（★ 别误用 ✓）**：★ 它**按位置**比对 ✗ ⇒');
md.push('★ **"插入 / 删除记录"会让后续兄弟节点下标整体位移** ⇒ ★ 报出**大量连带差异** ✗');
md.push('（★ 实测：`gen_palette` 加 4 条记录 ⇒ **3780 处差异**，★ 而其实只加了 4 条 ✓）。');
md.push('⇒ ★ 判据分类型：★ **"只改几个值"** 用 `expectDiffs: N` ✓；');
md.push('★ **"新增/删除"** 用 ★ **记录数断言 ＋ 结构性断言** ✓（★ 见 `inspect_gil.mjs` 的 `assertAssets` ✓）。');
md.push('★ 本工具已**自动提示** ✓：记录数一变就会打印这句警告 ✓。');
md.push('');
md.push('一键自证（★ 守卫真的会响 ✓）：`node tools/gil/selftest_write.mjs`');
md.push('');
md.push('## ★★ 常用任务 → 用哪个工具（★ 先查这里 ✓ 别重复造 ✗）');
md.push('');
md.push('| 我要做的事 | 用这个 | 验收命令 |');
md.push('| --- | --- | --- |');
const TASKS = [
  ['★★ 出一版之前先体检（只读 ✓ 最快 ✓）', '`inspect_gil.mjs`', '`node tools/gil/inspect_gil.mjs <存档>` ⇒ 看 clue 4 块 / assets 名单 / row.* 条数 / 脚本标记'],
  ['★★★ **模板「本体/实例」该改哪一份**（★ 同名记录有 2 份 ✓）', '`inspect_gil.mjs` 的 ⑤b 节', '`node tools/gil/inspect_gil.mjs <存档>` ⇒ ★ 看 `itemPrefabIndex` 指向谁 ⇒ **那份就是运行时用的** ✓'],
  ['改一个控件的位置/尺寸', '`set_positions.mjs`', '`node tools/gil/diff_fields.mjs <输入> <输出>` （差异应=你改的那几个分量）'],
  ['改一个"两浮点对"的值（位置/尺寸/锚点）', '`set_positions.mjs` 或按 `fix_clue_tpl_origin.mjs` 抄一个', '同上'],
  ['把客户端脚本叠进存档（出货前必做）', '`embed_script.mjs`', '`node tools/gil/embed_script.mjs --in=… --out=… --expect-marker=vNNN` ⇒ 必须打印 `✅ ⑨ 版本标记 = vNNN`'],
  ['看两份存档到底差在哪', '`diff_fields.mjs`', '`node tools/gil/diff_fields.mjs A.gil B.gil`（0=无差异，3=有差异）'],
  ['证明我的改写没弄坏编码', '`roundtrip.mjs`', '`node tools/gil/roundtrip.mjs <文件>` ⇒ 必须"逐字节完全一致"'],
  ['列出存档里所有控件（名字/ID/父/位置）', '`check_names.mjs` / `list_names.mjs` / `_probe_visible.mjs`', '直接跑，看输出'],
  ['找内嵌脚本字段在哪', '`find_script.mjs`', '`node tools/gil/find_script.mjs <存档>`'],
  ['查某个控件记录的全部字段', '`dumpone.mjs` / `tree.mjs`', '直接跑'],
  ['递增构建标记（日志第一行的版本号）', '`bump_build_marker.mjs`（在 `tools/` 根 ✓）', '`node tools/bump_build_marker.mjs --show`'],
  ['重新打包客户端脚本（叠脚本前先跑）', '`bundle_client_script.lua`（`tools/` 根 ✓）', '`lua tools/bundle_client_script.lua`'],
  ['把 101 个界面控件批量建出来', '`gen_bulk.mjs` ⚠️ 见其头部 wt1 警告', '`node tools/gil/gen_bulk.mjs --probe` 先看'],
  ['跑全部回归（Lua + 模拟器）', '`tools/check_all.ps1`', '`powershell -ExecutionPolicy Bypass -File tools\\check_all.ps1`'],
  ['★ 写一个新的"改 .gil"工具', '★ **必须 import `gilwrite.mjs` 的 `writeGil()`**', '`node tools/gil/selftest_write.mjs` 证明守卫会响'],
];
for (const [a, b, c] of TASKS) md.push(row([a, b, c]));   // ★ 证据列自己带反引号 ✓ 不要再包一层 ✗
md.push('');
md.push('★ 上表**没有**你要的任务 ⇒ ★ **找我（工具向）研发** ✓ —— ★ 别自己写第 26 个写工具 ✗。');
md.push('');
md.push('## ★ 危险等级（★ lead 按此决定"敢不敢直接用" ✓）');
md.push('');
md.push('| 档 | 判据 | 怎么用 |');
md.push('| --- | --- | --- |');
md.push('| ★★★ **高** | **写存档 + 自己写盘 + 连 `roundtrip` 都没提** | ★ **别直接用来出货** ✗ —— ★ 先让我迁到 `writeGil()` ✓ |');
md.push('| ★★ **中** | 写存档 + 自己写盘，但**提到了 `roundtrip`** | ★ 可以试 ✓ —— ★ 但**必须自己补跑** `roundtrip` ＋ `diff_fields` ✓ |');
md.push('| ★ **低** | **已走 `writeGil()`** ✓ | ★ **直接用** ✓ —— ★ 五道闸在工具内部已经跑完 ✓ |');
md.push('| — | 不写盘（只读 / 校验 / 探针） | 随便用 ✓ |');
md.push('');
const hi = gil.filter((t) => dangerOf(t) === '★★★ 高');
const mid = gil.filter((t) => dangerOf(t) === '★★ 中');
const low = gil.filter((t) => dangerOf(t) === '★ 低');
md.push('当前分布（`tools/gil/`，共 ' + gil.length + ' 个）：');
md.push('');
md.push('- ★★★ **高：' + hi.length + ' 个** —— ' + hi.map((t) => '`' + t.name + '`').join('、'));
md.push('- ★★ **中：' + mid.length + ' 个** —— ' + mid.map((t) => '`' + t.name + '`').join('、'));
md.push('- ★ **低：' + low.length + ' 个** —— ' + low.map((t) => '`' + t.name + '`').join('、'));
md.push('');
md.push('★ 迁移一个就从"高/中"掉到"低" ✓ —— ★ 每迁一个**重跑本生成器** ✓（`node tools/gil/gen_tool_catalog.mjs` ✓），数字自己会动 ✓。');
md.push('');
md.push('## ★★ 输入快照类工具的过期风险（★ 2026-10-10 立 ✓）');
md.push('');
md.push('★ **有一类工具不是"自己坏"，而是【它的输入坏了】** ✗ —— ★ 它们读一份**快照文件** ✓，');
md.push('★ 而快照**可能比存档旧** ✗ ⇒ ★ 工具会**照旧值覆盖新数据** ✓，★ 而且**打印成功** ✗。');
md.push('');
md.push('| 快照 | 谁生成 | 谁在用 | 过期后果 | 现有护栏 |');
md.push('| --- | --- | --- | --- | --- |');
md.push('| `tools/sim/out/layout-plan.json` | ★ **`lua tools/dump_layout.lua`** ✓ | `set_positions` `sync_plan` `gen_bulk` `check_names` `check_labels` `plan_tree` `overlay` 等 | ★ **把控件坐标改回旧规划值，覆盖编辑器里手调的结果** ✗ | ★★ **`set_positions` 已加硬护栏**：★ **命中率 < 60% ⇒ 拒绝运行** ✗（exit 4 ✓）★ 实测 `296`：**56/371 = 15.1%** ✗；★ 强跑须 `--force` ✓ |');
md.push('| `M.LAYOUT`（`lua/ui_controller.lua` 里的常量） | ★ 人改 lua ✓ | ★ `dump_layout.lua` ⇒ 上面那份 json ✓ | ★ 两份不一致 ⇒ 规划与真机不符 ✗ | ⚠️ ★ **暂无护栏** ✗ —— ★ 先跑 `lua tools/dump_layout.lua` 重新生成 ✓ |');
md.push('');
md.push('★★ **为什么用"命中率"而不是文件时间戳** ✗：');
md.push('★ 时间戳只说明"谁新" ✓，★ **不说明"内容是不是在描述同一批控件"** ✓ ——');
md.push('★ 规划可能比存档**新**（刚重排过 ✓），也可能**旧**（改了存档没重新生成 ✓）。');
md.push('★ **命中率直接测"两者是不是在说同一批东西"** ✓ ⇒ ★ **比时间戳准** ✓');
md.push('```');
md.push('node tools/gil/set_positions.mjs --gil=… --out=…          # 命中率 < 60% ⇒ exit 4 拒绝 ✓');
md.push('node tools/gil/set_positions.mjs --gil=… --out=… --force  # 明确承担覆盖风险 ✓');
md.push('lua tools/dump_layout.lua                                 # 先重新生成规划 ✓');
md.push('```');
md.push('');
md.push('★ 通用判据 ✓：★ **凡"读快照 + 写存档"的工具，都该有一条"快照与现状对不对得上"的检查** ✓；');
md.push('★ 拿不出这个检查 ⇒ ★ **至少在目录里标出来** ✓（★ 别让人以为它能随便跑 ✗）。');
md.push('');
md.push('## 概览（`tools/gil/` 写存档工具）');
md.push('');
const editType = risky.filter((t) => t.editsExisting);
const genType = risky.filter((t) => !t.editsExisting);
md.push('- ✅ 已走安全通道 `writeGil()`：**' + safe.length + '** 个 —— ' + (safe.map((t) => '`' + t.name + '`').join('、') || '（无）'));
md.push('  - ★ 通道本身：`tools/gil/gilwrite.mjs`（`writeGil` / `diffTrees` / `loadTree`）＋ 公共实现 `tools/gil/gilread.mjs`');md.push('- ★ **编辑型（有输入存档）+ 自己写盘 + 未见写后重读**：**' + editType.length + '** 个 ⇒ ★★ **最高优先级，必须迁移到 `writeGil()`** ✗');
for (const t of editType) md.push('  - `' + t.rel + '` —— 写调用在第 **' + t.firstWriteLine + '** 行' + (t.usesRoundtrip ? '（★ 提到了 roundtrip ✓）' : ' ✗ 连 roundtrip 都没提'));
md.push('- ★ **生成型（从零造新存档）**：**' + genType.length + '** 个 —— ★ 无输入可比对 ⇒ `writeGil` 的 `mustDiffer` 不适用 ✓；' +
  '★ 但**至少**要过 `roundtrip.mjs` 闸门 ✓');
md.push('  - ' + genType.map((t) => '`' + t.name + '`').join('、'));
md.push('');
md.push('★ 迁移办法：`writeGil(g, OUT, { mustDiffer: false, expectRecs: null, assert: g2 => … })`（★ 生成型传这两个 ✓）。');
md.push('');
md.push('## A. `tools/gil/` 全部工具');
md.push('');
md.push(tableFor(gil));
md.push('');
md.push('## B. `tools/`（非 gil）与根目录脚本');
md.push('');
md.push(tableFor(other));
md.push('');
md.push('## C. 共享实现与重复实现警告');
md.push('');
md.push('★ 工程铁律：`gilread.mjs` 是**公共实现** ✓ —— 有任何副本就会**不同步** ✗（本项目已因此栽过多次）。');
md.push('');
md.push('| 文件 | 自己实现（未 import gilread） | 风险 |');
md.push('| --- | --- | --- |');
for (const t of dupFiles) md.push(row(['`' + t.rel + '`', t.dup.join('、'), '★ 副本可能落后于 `gilread.mjs`']));
if (!dupFiles.length) md.push('| （无） | — | — |');
md.push('');
md.push('★ 检查脚本：`node tools/gil/check_childlist_top.mjs`（自动比对 `gen_bulk.mjs` 的副本 + 扫旧写法）');
md.push('');
md.push('## D. 回归入口');
md.push('');
md.push('- ★ **一键全量**：`powershell -ExecutionPolicy Bypass -File tools\\check_all.ps1`（`-SkipSim` 跳过模拟器）');
md.push('- ★ **11 套 Lua 单测**：`tests/*.lua` —— 逐个 `lua tests\\<名>.lua`；需要 `lua.exe`（默认找 `%LOCALAPPDATA%\\Programs\\Lua\\bin\\lua.exe` ✓ 本机存在 ✓）');
md.push('');
const tests = fs.existsSync(path.join(ROOT, 'tests')) ? fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.lua')) : [];
md.push('| 套件 | 命令 |');
md.push('| --- | --- |');
for (const t of tests) md.push(row(['`tests/' + t + '`', '`lua tests\\' + t + '`']));
md.push('');
md.push('★ 2026-10-10 实测：11 套里 **10 套全绿** ✓；`tests/grid_cost.lua` **26 通过 / 2 失败** ✗');
md.push('（失败项＝列表项内容 who/what/letter ✗，属 **lua 侧**既有红 ✓，与 `.gil` 工具链无关 ✓）。');
md.push('');
md.push('## E. 已实测（★ 白名单，只有真跑过才在列 ✓）');
md.push('');
md.push('| 工具 | 验收命令（实测） | 日期 |');
md.push('| --- | --- | --- |');
for (const [k, v] of Object.entries(VERIFIED)) md.push(row(['`' + k + '`', '`' + v.cmd + '`', v.date]));
md.push('');
md.push('## F. 旧项目 / 资料包里的工具线索（★ 待盘 ✓）');
md.push('');
if (oldTools.length) { for (const f of oldTools) md.push('- `' + f + '`'); }
else md.push('（`docs/` 下未发现可执行脚本）');
md.push('');
md.push('★ 说明：本段是**自动发现的文件清单** ✓，**尚未逐个评估** ✗ —— 评估后会把"可用 / 可搬 / 已过时"补上 ✓。');
md.push('');

const text = md.join('\n');
if (process.argv.includes('--stdout')) { console.log(text); }
else { fs.writeFileSync(OUT, text, 'utf8'); console.log('已写出 ' + rel(path.relative(ROOT, OUT)) + '（' + text.split('\n').length + ' 行）'); }
