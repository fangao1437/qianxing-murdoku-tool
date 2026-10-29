// tools/scan-installed-plugins.mjs —— 扫描本机 DSH 已装插件，生成安装清单
//
//   用法：
//     node tools/scan-installed-plugins.mjs            打印概览
//     node tools/scan-installed-plugins.mjs --json     输出 JSON（stdout）
//     node tools/scan-installed-plugins.mjs --write    写入 docs/plugins-manifest.json
//
//   ★ 注意 ✓：pnpm 把插件目录做成了**符号链接** ✓ —— 所以这里用 statSync 跟随链接 ✓
//             （Node 的 readdirSync withFileTypes 对符号链接会报 isDirectory()=false ✗）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
const PROFILES = path.join(DSH, 'profiles');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const write = args.includes('--write');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const entries = (p) => { try { return fs.readdirSync(p); } catch { return []; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const sizeOf = (dir) => {
  let n = 0, b = 0;
  const walk = (d) => {
    for (const name of entries(d)) {
      const p = path.join(d, name);
      if (isDir(p)) walk(p); else { try { n++; b += fs.statSync(p).size; } catch {} }
    }
  };
  try { walk(dir); } catch {}
  return { files: n, kb: Math.round(b / 1024) };
};
const toolsOf = (dir) => {
  const tools = new Set();
  const walk = (d) => {
    for (const name of entries(d)) {
      const p = path.join(d, name);
      if (isDir(p)) { if (name !== 'node_modules') walk(p); continue; }
      if (!/\.(m?js|cjs)$/.test(name)) continue;
      let s = ''; try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (s.length > 4_000_000) continue;
      for (const m of s.matchAll(/\bname:\s*['"]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"]/g)) tools.add(m[1]);
    }
  };
  try { walk(dir); } catch {}
  return [...tools].sort();
};

// ── 收集 ────────────────────────────────────────────────────────────────
const found = [];
const collect = (nm, profile) => {
  if (!isDir(nm)) return;
  for (const name of entries(nm)) {
    if (name === '.bin') continue;
    const p = path.join(nm, name);
    if (name.startsWith('dsh-plugin-') && isDir(p)) { found.push({ profile, dir: p, name }); continue; }
    if (name.startsWith('@')) {
      for (const sub of entries(p)) {
        const q = path.join(p, sub);
        if (sub.startsWith('dsh-plugin-') && isDir(q)) found.push({ profile, dir: q, name: name + '/' + sub });
      }
    }
  }
};
for (const prof of entries(PROFILES)) if (isDir(path.join(PROFILES, prof))) collect(path.join(PROFILES, prof, 'node_modules'), prof);
collect(path.join(PROFILES, 'node_modules'), '(共享)');

const rows = [];
for (const f of found) {
  const pkg = readJson(path.join(f.dir, 'package.json')) || {};
  const sz = sizeOf(f.dir);
  const vendored = path.join(ROOT, f.name);
  const vpkg = fs.existsSync(path.join(vendored, 'package.json')) ? readJson(path.join(vendored, 'package.json')) : null;
  rows.push({
    name: pkg.name || f.name,
    version: pkg.version || '?',
    profile: f.profile,
    license: pkg.license || '',
    description: pkg.description || '',
    installedPath: f.dir.replace(process.env.USERPROFILE || '', '%USERPROFILE%'),
    vendored: !!vpkg,
    vendoredVersion: vpkg ? vpkg.version : null,
    sameAsVendored: !!(vpkg && vpkg.version === pkg.version),
    files: sz.files,
    kb: sz.kb,
    dependencies: Object.keys(pkg.dependencies || {}),
    tools: toolsOf(f.dir),
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.profile.localeCompare(b.profile));

// ── 输出 ────────────────────────────────────────────────────────────────
if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const project = rows.filter((r) => r.vendored);
const others = rows.filter((r) => !r.vendored);
const drift = project.filter((r) => !r.sameAsVendored);
console.log('DSH 安装目录: ' + DSH);
for (const r of rows) {
  const tag = r.vendored ? (r.sameAsVendored ? '✅' : '⚠️ 版本漂移') : '○ 系统/官方';
  console.log(`  ${r.name}  v${r.version}  [${r.profile}]  ${r.files} files ${r.kb}KB  ${tag}`);
  if (r.tools.length) console.log('      tools(' + r.tools.length + '): ' + r.tools.join(', '));
}
console.log(`\n合计 ${rows.length} 条安装　项目插件 ${project.length} 个（版本漂移 ${drift.length} 个）　系统/官方 ${others.length} 个`);

if (write) {
  const out = path.join(ROOT, 'docs/plugins-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    dshRoot: DSH.replace(process.env.USERPROFILE || '', '%USERPROFILE%'),
    totalInstallations: rows.length,
    projectPlugins: project.length,
    versionDrift: drift.map((r) => r.name + ' ' + r.version + ' vs ' + r.vendoredVersion),
    plugins: rows,
  }, null, 2) + '\n', 'utf8');
  console.log('已写出 ' + path.relative(ROOT, out));
}
