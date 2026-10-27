// tools/archive_version.mjs —— 把"这一轮的 .gil + 这一轮的脚本"归档到 versions\ 下
//
// 为什么要有它（2026-10-02 用户要求）：
//   这一轮回退时才发现问题 —— 我每轮都用 `Remove-Item` 删掉旧 .gil、只留一份"最新"，
//   脚本又只存在工作区（被下一轮直接改掉）⇒ **想回退只能去 git 里挖**，
//   而 git 里的 .gil 有时和我实际交付的不是同一份
//   （这次就挖错了：git 的 `完整界面124-补回主体组.gil` 只有 69 条记录，
//     而用户手上那份有 91 条 + 6 个转存素材）。
//
//   ⇒ 从今往后：
//     · **每一轮的 .gil 都留在磁盘上，不删、不覆盖**（新名字）
//     · **每一轮的脚本也整份留一份快照**：`versions\<编号>-<说明>\`
//     · git 照常提交，但**不再是唯一的回退手段**
//
// 为什么用 Node 而不是 PowerShell：
//   `.ps1` 里带中文时，Windows PowerShell 5.1 会按 ANSI 读 ⇒ 全角引号/括号直接让解析器崩
//   （本轮已经踩了两次）。Node 读 UTF-8 无歧义。
//
// 用法：
//   node tools/archive_version.mjs --name=001-124含资产-可信 --gil=完整界面130-回到124含资产.gil --note="回退到用户测过的 124"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const h = process.argv.find((s) => s.startsWith('--' + k + '='));
  return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

const NAME = arg('name');
const GIL = arg('gil', '');
const NOTE = arg('note', '');
if (!NAME) {
  console.error('用法: node tools/archive_version.mjs --name=001-xxx [--gil=xxx.gil] [--note="说明"]');
  process.exit(1);
}

const dir = path.join(ROOT, 'versions', NAME);
if (fs.existsSync(dir)) {
  console.log('  versions\\' + NAME + ' 已存在 —— 不覆盖（每轮一个新编号）');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const copied = [];
// ① 源文件快照
const luaDir = path.join(ROOT, 'lua');
for (const f of fs.readdirSync(luaDir).filter((x) => x.endsWith('.lua'))) {
  fs.copyFileSync(path.join(luaDir, f), path.join(dir, f));
  copied.push('  ' + f.padEnd(32) + fs.statSync(path.join(dir, f)).size + ' 字节');
}
// ② 真机实际跑的那份打包产物
const bundle = path.join(ROOT, 'dist', 'client_script.lua');
if (fs.existsSync(bundle)) {
  fs.copyFileSync(bundle, path.join(dir, 'client_script.lua'));
  copied.push('  client_script.lua'.padEnd(34) + fs.statSync(path.join(dir, 'client_script.lua')).size + ' 字节（真机跑的就是这份）');
}
// ③ 配套 .gil 也复制进来（脚本 + 存档成对，回退不用找）
if (GIL) {
  const gpath = path.isAbsolute(GIL) ? GIL : path.join(ROOT, GIL);
  if (fs.existsSync(gpath)) {
    const base = path.basename(gpath);
    fs.copyFileSync(gpath, path.join(dir, base));
    copied.push('  ' + base.padEnd(32) + fs.statSync(path.join(dir, base)).size + ' 字节（配套存档）');
  } else {
    copied.push('  [警告] 找不到 .gil：' + GIL);
  }
}

const lines = [
  '版本：' + NAME,
  '时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
  '配套 .gil：' + (GIL || '（未指定）'),
  '说明：' + (NOTE || '（无）'),
  '',
  '文件清单：',
  ...copied,
  '',
  '用途：**这一版是"当时能跑的那一份"**。要回退：',
  '  1) 把本目录的 *.lua 拷回 qianxing-murdoku\\lua\\',
  '  2) 跑 node tools/bundle_client_script.lua，再 powershell -File tools/install_script_to_sandbox.ps1',
  '     （或直接用本目录的 client_script.lua 覆盖沙箱里的那份，省掉打包）',
  '  3) 导入本目录里的 .gil',
  '',
  '规则（重要）：**每轮一个新编号，不删旧的、不覆盖**。',
];
fs.writeFileSync(path.join(dir, 'MANIFEST.txt'), lines.join('\n'), 'utf8');

console.log('  ✅ 已归档 versions\\' + NAME);
for (const c of copied) console.log(c);
