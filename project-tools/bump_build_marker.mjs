// tools/bump_build_marker.mjs —— **构建标记的递增，交给工具，不靠人记得**（接手待办 P1）
//
// 为什么要有它（`PLAN.md` D2 的老毛病 ✓，`entry_client_script.lua:174` 记着那次事故）：
//   ★ 症状 ✓：**十几次安装之后，无法从日志分辨跑的是哪一版** ✗
//     标记停在 **v076**（10-05），而 `versions/` 已经到 `134-弹窗四键成型-v092`
//     ⇒ 中间每一轮的日志首行**都是 v076** ✓ 于是"贴回来的日志对应哪一版"根本看不出来 ✓
//   ★ 根因 ✓：递增**靠人记得** ✗ —— 而每一轮都在忙着改逻辑，标记这种"纯记账"最容易被漏 ✓
//   ⇒ ★ 所以做成工具 ✓：一条命令把 `vNNN` 加一、日期改成今天、说明换成这一轮的 ✓
//
// ⚠️⚠️ 本文件对 BOM **极敏感**（`entry_client_script.lua:181` 记着历史事故：
//   用 `Set-Content` 写它会加 BOM ⇒ 打包后 Lua 5.3 报 `unexpected symbol near '<\239>'`
//   ⇒ `check_all` 永久变红 ✓）
//   ⇒ 本工具**只替换标记那一小段**、其余字节原样保留 ✓
//     而且写完**自己复读一次**：① 没有 BOM ② 标记确实变了 ✓
//
// 用法：
//   node tools/bump_build_marker.mjs --note="这一轮做了什么"            # 递增一位并把说明换成它
//   node tools/bump_build_marker.mjs --note="…" --set=096               # 直接指定编号
//   node tools/bump_build_marker.mjs --check                            # 只检查"相对 HEAD 有没有递增"
//   node tools/bump_build_marker.mjs --show                             # 只看当前标记

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'lua', 'entry_client_script.lua');
const arg = (k, d) => {
  const h = process.argv.find((s) => s.startsWith('--' + k + '='));
  return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const SHOW = process.argv.includes('--show');
const CHECK = process.argv.includes('--check');
const SET = arg('set');
const NOTE = arg('note');

// ★ 标记的形状：`print("[murdoku] ===== 构建标记 vNNN / YYYY-MM-DD / 说明")`
//   （`entry_client_script.lua:194` 就是这么写的一行 ✓ `tools/gil/gilwrite.mjs:137` 也记着它 ✓）
//
// ⚠️⚠️ 2026-10-20 修 v281 那一轮的工具债：**旧 RE 只认"带尾部 `=====`"的形状** ✗
//   · 旧写法是 `([^"\\]*?)(?=\s*=====)` ⇒ 说明后面**还必须跟一串 `=====`** ✓
//   · 但 v240~v270 之间**尾部那串丢了** ⇒ 现在是 `… 说明")` ✓
//   ⇒ 后果（本轮实测 ✓）：**两种模式一起废掉** ✗
//     · `--check` 在标记明明是新的时候报「找不到构建标记」**exit 1** ✗
//       ⇒ `check_all` 的闸门 2c2 **永远红** ⇒ 闸门退化成噪音 ✓（正是它要防的那种退化 ✓）
//     · `bump` 模式同样 exit 1 ⇒ **递增彻底停摆** ⇒ 又回到 D2 那个"标记落后十几版"的病根 ✗
//   ⇒ 新判据：说明 = **除 `"` / `\` / 换行以外的一串** ✓ —— 由**引号**收尾，不靠 `=====` ✓
//     尾巴（空白＋可能还在的那串 `=====`）单独切出来、写回时**原样保留** ✓
//     ⇒ 两种形状（带尾巴 / 不带尾巴）都认 ✓ 哪天加回去也不会坏 ✓
//   ⚠️ 但「**标记必须存在**」这条**一个字都没放松** ✓：
//     整行对不上（标记行被删了 / 日期写坏了 / 版本号不是 vNNN）⇒ 照样 exit 1 ✓
const RE = /构建标记 (v\d{2,4}) \/ (\d{4}-\d{2}-\d{2}) \/ ([^"\\\r\n]*)/;
// 说明尾部那些**空白与 `=====`** 不算说明 ✓（人看的时候只留说明本身 ✓）
const bodyOf = (s) => s.replace(/[\s=]+$/, '');
const tailOf = (s) => s.slice(bodyOf(s).length);

const src = fs.readFileSync(ENTRY, 'utf8');
const m = src.match(RE);
if (!m) {
  console.error('✗ 在 ' + path.relative(ROOT, ENTRY) + ' 里找不到构建标记（形状应为 `构建标记 vNNN / YYYY-MM-DD / 说明`）');
  process.exit(1);
}
const [full, curV, curDate] = m;
const curNote = bodyOf(m[3]);
const curTail = tailOf(m[3]);              // ★ 说明后面原样留着的那截（空白 + 可能还有的 `=====`）
const fmt = (n) => 'v' + String(n).padStart(3, '0');

console.log('当前标记：' + curV + ' / ' + curDate);
console.log('  说明：' + curNote.slice(0, 100) + (curNote.length > 100 ? '…' : ''));

if (SHOW) process.exit(0);

// ── 找 git（⚠️ 这台机器上 git **不在 PATH 里** ⇒ 光写 'git' 会拿不到 HEAD ✓ 实测踩过）
const GIT = (() => {
  const cands = [
    'git',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'ds-harness-desktop', 'runtime', 'git', 'cmd', 'git.exe'),
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ].filter(Boolean);
  for (const c of cands) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) { /* 换下一个 */ }
  }
  return null;
})();

// ── `--check`：**改了 lua 却没递增标记** ⇒ 失败 ✓
//   ★ 判据（第一版写错过 ✗，实测被 `check_all` 抓出来 ✓）：
//     我原来只比"标记和 HEAD 一不一样" ⇒ ★ **两次交付之间它必然报红** ✗
//       （因为那段时间本来就没打算发布 ✓）⇒ 那样它就不是闸门，是噪音 ✓
//   ⇒ 正确的语义 ✓：**只有"这一轮动了 lua"时才要求标记递增** ✓
//     · 标记变了              ⇒ 通过 ✓（递增过了）
//     · 标记没变 + lua 也没变 ⇒ 通过 ✓（没东西要交付，不要求递增）
//     · 标记没变 + **lua 变了** ⇒ **失败** ✓ ← ★ 这才是要拦的情况 ✓
if (CHECK) {
  if (!GIT) { console.log('（找不到 git，跳过检查）'); process.exit(0); }
  const gitOut = (a) => execFileSync(GIT, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let headSrc = null;
  try { headSrc = gitOut(['show', 'HEAD:lua/entry_client_script.lua']); }
  catch (e) { console.log('（拿不到 HEAD 版本，跳过检查）'); process.exit(0); }
  const hm = headSrc.match(RE);
  if (!hm) { console.log('（HEAD 里没有标记，跳过）'); process.exit(0); }
  if (hm[1] !== curV) {
    console.log('\n★ 标记已递增：' + hm[1] + ' → ' + curV + ' ✓');
    process.exit(0);
  }
  // 标记没变 ⇒ 看 lua/ 有没有改动（**工作树 vs HEAD** ✓）
  let dirty = '';
  try { dirty = gitOut(['status', '--porcelain', '--', 'lua/']); }
  catch (e) { console.log('（拿不到工作树状态，跳过检查）'); process.exit(0); }
  if (dirty.trim() === '') {
    console.log('\n★ 标记没变（' + curV + '），但 lua/ 相对 HEAD **也没有改动** ⇒ 没有要交付的东西 ✓ 通过');
    process.exit(0);
  }
  console.error('\n❌ **改了 lua 却没递增构建标记** ✗（标记仍是 ' + curV + '，与 HEAD 相同）');
  console.error('   改动的文件：');
  for (const l of dirty.trim().split('\n')) console.error('     ' + l.trim());
  console.error('   跑：node tools/bump_build_marker.mjs --note="这一轮做了什么"');
  process.exit(2);
}

// ── 递增 ────────────────────────────────────────────────────────────────────
let nextV;
if (SET) {
  nextV = SET.startsWith('v') ? SET : fmt(Number(SET));
} else {
  nextV = fmt(Number(curV.slice(1)) + 1);
}
const today = new Date().toLocaleDateString('sv-SE');      // sv-SE = YYYY-MM-DD ✓ 本地时区 ✓
if (!NOTE) {
  console.error('\n✗ 递增时必须给 --note="这一轮做了什么"（不然标记没有信息量 ✓）');
  process.exit(1);
}
// ★★★ 2026-10-11 **说明不许太长** ✗✓✓（★ 这条是踩出来的 ✓）
//   ★ 事故 ✓：★ 我写了一条 ~290 字的说明 ✓ ⇒
//     ★ 构建标记那一行**被撑得极长** ✓ ⇒
//     ★★ `tests/entry_smoke.lua` 里 `has("画布")` 取"**第一行含『画布』的日志**" ✗
//       ★ 而那条长说明里**恰好含『画布』两个字** ✓
//       ⇒ ★ **取到的是构建标记那行** ✗ ⇒ ★ "浮点 1600.0 被安全格式化" 断言**假红** ✓✓
//   ⇒ ★ 规矩 ✓：★ **说明写"做了什么"，一行说完 ✓ 细节留在提交信息里** ✓
//     ★ 阈值按"能在一行里看清"给 ✓ —— ★ 超了也照写 ✓ **但打印警告** ✓（★ 不阻断 ✓ 免得挡住交付 ✓）
const NOTE_MAX = 60;
if (NOTE.length > NOTE_MAX) {
  console.error('\n⚠️  说明有 ' + NOTE.length + ' 字，超过建议的 ' + NOTE_MAX + ' 字 ✗');
  console.error('   ★ 它会**原样拼进构建标记那一行** ⇒ 日志里那一行会很长 ✓');
  console.error('   ★★ 而 `tests/entry_smoke.lua` 用"第一行含『画布』"取日志 ✗');
  console.error('      ⇒ 说明里出现「画布」等词会把那条断言**带成假红** ✓');
  console.error('   ⇒ 建议：一行说完"做了什么" ✓ 细节写进 git 提交信息 ✓\n');
}

// ★ 尾巴**原样带回去** ✓（今天没有那串 `=====` ⇒ 也不替人补；哪天补回来了也不会被吃掉 ✓）
const next = '构建标记 ' + nextV + ' / ' + today + ' / ' + NOTE + curTail;
// ⚠️ 必须用**函数式**替换：`NOTE` 里若出现 `$&` / `$1` / `$'` 之类，
//   字符串形式的 replacement 会被当场当成"替换模式" ✗（今天没人这么写，但它不该是个雷 ✓）
const out = src.replace(RE, () => next);
if (out === src) { console.error('✗ 替换没生效（形状可能变了）'); process.exit(1); }

fs.writeFileSync(ENTRY, out, 'utf8');       // ★ 不加 BOM ✓

// ── 自检：复读一次 ✓（① 无 BOM ② 标记真的变了 ✓）──────────────────────────
const raw = fs.readFileSync(ENTRY);
const hasBom = raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
const back = raw.toString('utf8').match(RE);
console.log('\n已写入 ' + path.relative(ROOT, ENTRY));
console.log('  新标记：' + (back ? back[1] + ' / ' + back[2] : '**读不回来** ✗'));
console.log('  BOM 检查：' + (hasBom ? '❌ **有 BOM**（会炸）' : '✅ 无 BOM ✓'));
if (hasBom || !back || back[1] !== nextV) { console.error('✗ 自检没过'); process.exit(3); }
console.log('  文件大小：' + raw.length + ' 字节（原 ' + Buffer.byteLength(src, 'utf8') + '）');
console.log('\n下一步：node tools/bundle_client_script.lua');
