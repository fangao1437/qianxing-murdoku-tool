// tools/repo_bridge.mjs —— **无 git 也能用的"仓库交换包"工具**（★ 只读仓库、只写交换目录 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么需要它（★ 2026-10-12 立 ✓）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 用户的要求 ✓：★「**优化组不能直接读写 GitHub 仓库** ⇒ 给它一条完整的读写路线」✓
//   ★ 实测到的三个硬约束 ✗：
//     ① ★ **仓库是【私有】的** ✗ —— ★ 未认证访问 `https://github.com/fangao1437/qianxing-murdoku`
//        ★ 返回 **HTTP 404** ✓（★ GitHub 对私有库一律 404 ✓）⇒ ★ **普通 HTTPS 拉取走不通** ✗
//     ② ★ **本机【没有任何 git 可执行文件】** ✗ ——
//        ★ `where git` 找不到 ✓、★ `C:\Program Files\Git\…` 不存在 ✓、
//        ★ `tools/` 下也没有便携版 ✓、★ `node_modules` 不存在 ✓
//        ⇒ ★★ **连 `git bundle` / `git archive` 都做不了** ✗✓
//     ③ ★ **工作区很大** ✓ —— **8602 个文件 / 1171 MB** ✓
//        ⇒ ★ 不能"整盘打包" ✗ ⇒ ★ **必须只交换【被跟踪】的文件** ✓✓
//   ⇒ ★★★ 所以本工具**绕开 git** ✓：★ **直接解析 `.git/index`** ✓ 拿到"仓库里到底有哪些文件" ✓
//     ★ 只复制这批文件 ⇒ ★ **交换包小、且与仓库内容一致** ✓✓
//
//   ★ 它做四件事 ✓（★ 全部**不依赖 git** ✓）：
//     · `status`  ★ 打印：远程地址 / 分支 / HEAD 提交号 / 跟踪文件数 / 有没有 git 二进制 ✓
//     · `export`  ★ 生成**只读快照包**（跟踪文件 ＋ `manifest.json` 带 sha256 ✓）
//     · `verify`  ★ 校验**回来的包**与 manifest 的差异（改了/新增/删了 ✓）
//     · `apply`   ★ 把回来的包**应用到工作区**（★ 默认 `--dry-run` ✗ 要显式 `--yes` 才写 ✓）
//
//   ★ 最终 push 到 GitHub 那一步**仍然需要 git** ✓ —— ★ 本工具**不做**那一步 ✗，
//     ★ 它只负责"**把代码送出去**"与"**把改动收回来**" ✓✓（★ 见 `docs/优化组-仓库读写路线.md` ✓）
//
// 用法：
//   node tools/repo_bridge.mjs status
//   node tools/repo_bridge.mjs export --out=D:\exchange\snap-<日期>
//   node tools/repo_bridge.mjs verify --from=D:\exchange\snap-<日期>
//   node tools/repo_bridge.mjs apply  --from=D:\exchange\snap-<日期>            # ★ 只演不写 ✓
//   node tools/repo_bridge.mjs apply  --from=D:\exchange\snap-<日期> --yes      # ★ 真的写 ✓
//   node tools/repo_bridge.mjs selfcheck                                        # ★ 自证：解析器可信吗 ✓
//
// 退出码：0 = 成功 ✓；2 = 用法/路径错；3 = `verify` 发现差异/`apply` 未加 `--yes`；5 = 解析器自检失败

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv.find((s) => !s.startsWith('--')) || 'status';
const argVal = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const YES = argv.includes('--yes');

const say = (s) => console.log(s);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** ★ 清单指纹：★ 对"路径 + 内容 sha256"排序后再哈希 ✓ ⇒ ★ **唯一的版本标识** ✓
 *  ★★ 为什么不能只用 commit 号 ✗（★ 2026-10-12 实测 ✓）：
 *    ★ 本机 HEAD = `0cb6a74d` ✓，但 ★ **有 9 个跟踪文件在磁盘上被改过、尚未提交** ✗
 *    ⇒ ★ **"commit 号"标识不了"我现在给你的这份内容"** ✗✓
 *    ⇒ ★ 所以每次导出都算一个**清单指纹** ✓ ⇒ ★ 两边从此说的是**同一个版本** ✓ */
const manifestIdOf = (files) => sha256(Buffer.from(
  Object.keys(files).sort().map((k) => k + ':' + files[k].sha256).join('\n'), 'utf8')).slice(0, 16);

/** ★ 作用域过滤 ✓（★ 967 MB 整包不实用 ✗ —— 实测跟踪 6708 文件 / 967.5 MB ✓）*/
function pickFiles(idxFiles, onlyStr, excludeStr) {
  const only = onlyStr ? onlyStr.split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean) : null;
  const excl = excludeStr ? excludeStr.split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean) : [];
  return idxFiles.filter((f) => {
    if (only && !only.some((p) => f.path === p || f.path.startsWith(p.replace(/\/$/, '') + '/'))) return false;
    if (excl.some((p) => f.path === p || f.path.startsWith(p.replace(/\/$/, '') + '/'))) return false;
    return true;
  });
}

// ── ① 读 `.git` 的**纯文件**信息（★ 不需要 git ✓）──────────────────────────
function repoInfo() {
  const gitDir = path.join(ROOT, '.git');
  const out = { gitDir, exists: fs.existsSync(gitDir), remote: null, branch: null, head: null, log: [] };
  if (!out.exists) return out;
  const cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
  const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/);
  out.remote = m ? m[1] : null;
  const headRef = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  const bm = headRef.match(/^ref:\s*refs\/heads\/(.+)$/);
  out.branch = bm ? bm[1] : ('(detached) ' + headRef);
  if (bm) {
    const rf = path.join(gitDir, 'refs', 'heads', bm[1]);
    out.head = fs.existsSync(rf) ? fs.readFileSync(rf, 'utf8').trim() : null;
  }
  const logs = path.join(gitDir, 'logs', 'HEAD');
  if (fs.existsSync(logs)) {
    out.log = fs.readFileSync(logs, 'utf8').trim().split('\n').slice(-5).map((l) => {
      const p = l.split('\t');
      const meta = (p[1] || '').split(' ');
      return { to: (p[0] || '').split(' ')[1], msg: (meta.slice(4).join(' ') || '').slice(0, 90) };
    });
  }
  return out;
}

// ── ② 解析 `.git/index`（★ 这就是"仓库里有哪些文件"的权威来源 ✓）──────────
//   ★ 格式（v2/v3 ✓）：`DIRC` + u32 version + u32 entryCount
//     ★ 每条目：62 字节固定 ＋ 路径（NUL 结尾 ✓ 补齐到 8 字节对齐 ✓）
//     ★ 固定段：ctime(8) mtime(8) dev(4) ino(4) mode(4) uid(4) gid(4) size(4) sha1(20) flags(2) ✓
//     ⚠️ ★ v4 用了**前缀压缩** ✗ —— ★ 本工具遇到 v4 会**明确报错** ✓（★ 不猜 ✗）
function readIndex() {
  const idxPath = path.join(ROOT, '.git', 'index');
  if (!fs.existsSync(idxPath)) throw new Error('没有 .git/index ⇒ 这个目录不是 git 仓库 ✗：' + idxPath);
  const b = fs.readFileSync(idxPath);
  const sig = b.subarray(0, 4).toString('ascii');
  if (sig !== 'DIRC') throw new Error('`.git/index` 签名不是 DIRC ✗（读到 "' + sig + '"）');
  const ver = b.readUInt32BE(4), n = b.readUInt32BE(8);
  if (ver === 4) throw new Error('`.git/index` 是 **v4** ✗（用了前缀压缩 ⇒ 本工具不解析 ✓ 请装 git 或让我补 v4 支持）');
  if (ver !== 2 && ver !== 3) throw new Error('`.git/index` 版本 ' + ver + ' 未支持 ✗');
  const files = [];
  let p = 12;
  for (let i = 0; i < n; i++) {
    if (p + 62 > b.length) throw new Error('index 意外截断 ✗（第 ' + i + ' 条）');
    const size = b.readUInt32BE(p + 36);
    const flags = b.readUInt16BE(p + 60);
    let nameLen = flags & 0x0fff;
    let s = p + 62;
    if (nameLen === 0x0fff) { nameLen = b.indexOf(0, s) - s; }
    const name = b.subarray(s, s + nameLen).toString('utf8');
    files.push({ path: name.replace(/\\/g, '/'), size });
    const entLen = 62 + nameLen;
    p += entLen + ((8 - (entLen % 8)) % 8 || 8);   // ★ 补齐到 8 字节 ✓（含 NUL ✓）
  }
  return { version: ver, count: n, files };
}

// ── ③ status ──────────────────────────────────────────────────────────────
function cmdStatus() {
  const info = repoInfo();
  say('仓库根：' + ROOT);
  say('  .git 存在：' + (info.exists ? '✅ 是' : '❌ 否'));
  say('  远程 origin：' + (info.remote || '（无）'));
  say('  当前分支：' + (info.branch || '?'));
  say('  HEAD 提交：' + (info.head || '（读不到）'));
  let gitPath = null;
  try { gitPath = execFileSync('where', ['git'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0]; } catch { gitPath = null; }
  say('  git 可执行文件：' + (gitPath ? ('✅ ' + gitPath) : '❌ **本机没有** ⇒ ★ 推送那一步必须换机器/装 git ✓'));
  try {
    const idx = readIndex();
    const total = idx.files.reduce((s, f) => s + f.size, 0);
    say('  `.git/index`：★ v' + idx.version + '，**跟踪 ' + idx.count + ' 个文件** ✓，合计 ' + (total / 1024 / 1024).toFixed(1) + ' MB');
    // ★★ 未提交漂移 ✓ —— ★ 这条很重要 ✗：★ 有它 ⇒ **commit 号标识不了当前内容** ✓
    const dirty = [];
    for (const f of idx.files) {
      const p = path.join(ROOT, f.path);
      if (!fs.existsSync(p)) { dirty.push(['缺', f.path]); continue; }
      if (fs.statSync(p).size !== f.size) dirty.push(['改', f.path]);
    }
    say('  ★ 未提交漂移：**' + dirty.length + ' 个跟踪文件与 index 不一致**'
      + (dirty.length ? ' ✗ ⇒ ★ **不能用 commit 号当版本标识** ✓ ⇒ ★ 用 `export` 产出的**清单指纹** ✓' : ' ✓'));
    for (const [k, p] of dirty.slice(0, 12)) say('     [' + k + '] ' + p);
    if (dirty.length > 12) say('     …还有 ' + (dirty.length - 12) + ' 个');
  } catch (e) { say('  `.git/index`：❌ ' + e.message); }
  if (info.log.length) {
    say('  最近提交：');
    for (const l of info.log) say('     ' + (l.to || '?').slice(0, 8) + '  ' + l.msg);
  }
  say('');
  say('★ 读写路线见：`docs/优化组-仓库读写路线.md` ✓');
}

// ── ④ export：生成只读快照包 ──────────────────────────────────────────────
function cmdExport() {
  const out = argVal('out');
  if (!out) { console.error('用法: export --out=<目录>'); process.exit(2); }
  const dest = path.resolve(out);
  const info = repoInfo();
  const idx = readIndex();
  const picked = pickFiles(idx.files, argVal('only'), argVal('exclude'));
  fs.mkdirSync(dest, { recursive: true });
  const filesDir = path.join(dest, 'files');
  const manifest = {
    kind: 'repo-bridge-snapshot', version: 1,
    exportedAt: new Date().toISOString(),
    repo: info.remote, branch: info.branch, baseCommit: info.head,
    only: argVal('only') || null, exclude: argVal('exclude') || null,
    fileCount: 0, totalBytes: 0, files: {},
  };
  let missing = 0;
  for (const f of picked) {
    const src = path.join(ROOT, f.path);
    if (!fs.existsSync(src)) { missing++; continue; }
    const buf = fs.readFileSync(src);
    const dst = path.join(filesDir, f.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    manifest.files[f.path] = { sha256: sha256(buf), bytes: buf.length };
    manifest.totalBytes += buf.length;
  }
  manifest.fileCount = Object.keys(manifest.files).length;
  manifest.manifestId = manifestIdOf(manifest.files);   // ★ 版本指纹 ✓（★ commit 号不够 ✓）
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  say('✅ 快照已导出：' + dest);
  say('   ★ **清单指纹（版本标识）**：' + manifest.manifestId + '  ← ★ 两边引用的就是它 ✓');
  say('   基准提交（★ 参考值 ✓ 不是唯一标识 ✗）：' + (info.head || '?'));
  say('   文件 ' + manifest.fileCount + ' 个，' + (manifest.totalBytes / 1024 / 1024).toFixed(1) + ' MB'
    + (argVal('only') ? '（★ 只含 `' + argVal('only') + '` ✓）' : '')
    + (argVal('exclude') ? '（★ 已排除 `' + argVal('exclude') + '` ✓）' : '')
    + (missing ? '（★ 有 ' + missing + ' 个跟踪文件在磁盘上缺失 ✗ 已跳过 ✓）' : ' ✓'));
  say('   manifest：' + path.join(dest, 'manifest.json'));
  say('');
  say('★ 打成单文件（可选 ✓ Windows 自带 ✓）：');
  say('   Compress-Archive -Path "' + dest + '\\*" -DestinationPath "' + dest + '.zip" -Force');
  say('★ 对方拿到后：解到任意目录 ⇒ 那就是**与仓库一致的只读副本** ✓（★ 回话时报清单指纹 ✓）');
}

// ── ⑤ 载入一个"回来的包" ──────────────────────────────────────────────────
function loadPkg(dir, label) {
  const base = path.resolve(dir);
  const mf = path.join(base, 'manifest.json');
  if (!fs.existsSync(mf)) { console.error('❌ ' + label + ' 里没有 manifest.json ✗：' + base); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const filesDir = fs.existsSync(path.join(base, 'files')) ? path.join(base, 'files') : base;
  return { base, filesDir, manifest };
}
function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, r, out);
    else if (r !== 'manifest.json') out.push(r);
  }
  return out;
}

// ── ⑥ verify：回来的包 vs manifest ────────────────────────────────────────
function cmdVerify() {
  const from = argVal('from');
  if (!from) { console.error('用法: verify --from=<目录>'); process.exit(2); }
  const P = loadPkg(from, '回来的包');
  const have = new Set(walk(P.filesDir));
  const orig = P.manifest.files || {};
  const changed = [], added = [], removed = [], same = [];
  for (const r of have) {
    const abs = path.join(P.filesDir, r);
    const h = sha256(fs.readFileSync(abs));
    if (!orig[r]) added.push(r);
    else if (orig[r].sha256 !== h) changed.push(r);
    else same.push(r);
  }
  for (const r of Object.keys(orig)) if (!have.has(r)) removed.push(r);
  say('校验：' + P.base);
  say('  ★ 对方包的清单指纹：' + (P.manifest.manifestId || '（无 ✗ 旧格式 ✓）'));
  say('  基准提交（参考 ✓）：' + (P.manifest.baseCommit || '?'));
  say('  未改：' + same.length + ' ✓　★ 改了：' + changed.length + '　新增：' + added.length + '　删除：' + removed.length);
  const show = (t, arr) => { if (!arr.length) return; say('  ' + t + '：'); for (const x of arr.slice(0, 40)) say('     ' + x); if (arr.length > 40) say('     …还有 ' + (arr.length - 40) + ' 个'); };
  show('★ 改', changed); show('★ 新增', added); show('★ 删除', removed);
  const n = changed.length + added.length + removed.length;
  say('');
  say(n === 0 ? '★★ 无差异 ✓' : '★★ 共 **' + n + ' 处差异** ✓ ⇒ ★ 这就是对方要交回来的改动 ✓');
  process.exit(n === 0 ? 0 : 3);
}

// ── ⑦ apply：把回来的包应用到工作区 ───────────────────────────────────────
function cmdApply() {
  const from = argVal('from');
  if (!from) { console.error('用法: apply --from=<目录> [--yes]'); process.exit(2); }
  const P = loadPkg(from, '回来的包');
  const have = new Set(walk(P.filesDir));
  const orig = P.manifest.files || {};
  const plan = { write: [], del: [] };
  for (const r of have) {
    const h = sha256(fs.readFileSync(path.join(P.filesDir, r)));
    if (!orig[r] || orig[r].sha256 !== h) plan.write.push(r);
  }
  for (const r of Object.keys(orig)) if (!have.has(r)) plan.del.push(r);
  say('★ 应用到工作区：' + ROOT);
  say('  基准提交：' + (P.manifest.baseCommit || '?')
    + (repoInfo().head === P.manifest.baseCommit ? '　✅ 与本机 HEAD 一致 ✓' : '　⚠️ ★ 与本机 HEAD **不一致** ✗ ⇒ 先确认基线 ✓'));
  say('  将写入 ' + plan.write.length + ' 个文件，删除 ' + plan.del.length + ' 个');
  for (const r of plan.write.slice(0, 30)) say('     ✎ ' + r);
  if (plan.write.length > 30) say('     …还有 ' + (plan.write.length - 30) + ' 个');
  for (const r of plan.del.slice(0, 20)) say('     ✗ ' + r);
  if (!YES) {
    say('');
    say('★★ **这是演练（dry-run）✓ 什么都没写** ✓ —— ★ 确认无误后加 `--yes` 真的应用 ✓');
    process.exit(3);
  }
  let w = 0, d = 0;
  for (const r of plan.write) {
    const dst = path.join(ROOT, r);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(path.join(P.filesDir, r)));
    w++;
  }
  for (const r of plan.del) { const dst = path.join(ROOT, r); if (fs.existsSync(dst)) { fs.unlinkSync(dst); d++; } }
  say('');
  say('✅ 应用完成：写入 ' + w + ' 个 ✓ 删除 ' + d + ' 个 ✓');
  say('★ 接下来（需要 git ✓）：`git add -A && git commit -m "…" && git push`');
}

// ── ⑧ selfcheck：解析器可信吗（★ 用文件系统交叉验证 ✓）───────────────────
function cmdSelfcheck() {
  const idx = readIndex();
  let ok = 0, miss = 0, bad = [];
  for (const f of idx.files) {
    const p = path.join(ROOT, f.path);
    if (!fs.existsSync(p)) { miss++; continue; }
    const st = fs.statSync(p);
    // ★ 交叉验证：★ index 里存的 size 应当与磁盘一致 ✓（★ 不一致 ⇒ 该文件被本地改过 ✓）
    if (st.size === f.size) ok++; else bad.push(f.path + '（index ' + f.size + ' ≠ 磁盘 ' + st.size + '）');
  }
  say('★ 解析器自检（★ 用磁盘交叉验证 ✓）');
  say('  `.git/index` v' + idx.version + '，' + idx.count + ' 条');
  say('  ✅ size 与磁盘一致：' + ok + ' 个 ✓（★ 这些是干净的跟踪文件 ✓）');
  say('  ⚠️ size 不一致（★ 本地改过 ✓）：' + bad.length + ' 个');
  for (const x of bad.slice(0, 20)) say('     ' + x);
  say('  ⚠️ 磁盘上缺失：' + miss + ' 个');
  const ratio = idx.count ? (ok + bad.length) / idx.count : 0;
  say('');
  say(ratio > 0.95 ? '★★ 自检通过 ✓（≥95% 的条目在磁盘上能对上 ✓）⇒ ★ 解析器可信 ✓'
    : '❌ 自检失败 ✗（只有 ' + (ratio * 100).toFixed(1) + '% 能对上 ✓）⇒ ★ 别信本工具的输出 ✗');
  process.exit(ratio > 0.95 ? 0 : 5);
}

const table = { status: cmdStatus, export: cmdExport, verify: cmdVerify, apply: cmdApply, selfcheck: cmdSelfcheck };
if (!table[cmd]) { console.error('用法: status | export --out=… | verify --from=… | apply --from=… [--yes] | selfcheck'); process.exit(2); }
table[cmd]();
