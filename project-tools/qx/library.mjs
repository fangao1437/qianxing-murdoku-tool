// tools/qx/library.mjs —— 千星图片素材库：拉目录 + 找素材 + 拼"接触表"供人/我看图挑
//
// ★★★ 2026-10-01：**这是"美术素材从哪来"的答案**。
//
//   用户给了外部编辑器 https://qx.070077.xyz（Miliastra Image Editor）并问：
//   "千星可以导入外部资产只是有很多限制，你试试看能不能自主依靠工具完成美术配置"。
//
//   实地调查（拉包 + 调 API）得到：
//     · 该站的 API 是**同源相对路径**，可以直接程序化调用：
//         /api/library/catalog        图片素材目录（129.9 KB）
//         /api/library/sprite/<id>.png 单张 sprite
//         /api/export/gia  /api/export/lua  …  导出（GIA = "游戏素材格式"）
//     · `/api/library/catalog` 返回 **1543 个游戏图片素材**，分 14 类：
//         底板-彩色 392 / 装饰图案-彩色 317 / 玩法图标-彩色 148 / 道具 139
//         功能图标-单色 113 / 功能图标-彩色 80 / 特殊字符 75 / 技能天赋 53
//         玩法图标-单色 52 / 造物 42 / 分隔线 20 / 装饰图案-单色 10 / 基础形状 6
//     · **id 体系与 `.gil` 完全一致** —— 我们存档里在用的 `100101`（红✗）、
//       `100108`、`106053`（白）都在这个目录里。
//
//   ⇒ 所以**不用外部导入**也能配美术：直接引用这些 id 即可，它们在游戏里必然存在。
//     （那个网站的价值是"把想要的图形拟合成图元再导出 GIA"，用于**目录里没有**的自定义图形。）
//
// 用法：
//   node tools/qx/library.mjs fetch                 # 拉目录到 tools/qx/library-catalog.json
//   node tools/qx/library.mjs list [分类名]          # 列出某类的 id
//   node tools/qx/library.mjs sheet --cat=装饰图案-彩色 --out=sheet.png [--cols=16] [--max=256]
//                                                   # 下载该类 sprite 拼成一张接触表（供看图挑）
//   node tools/qx/library.mjs get --id=105001 [--out=a.png]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'tools', 'qx');
const CATALOG = path.join(DIR, 'library-catalog.json');
const BASE = process.env.QX_BASE || 'https://qx.070077.xyz';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'fetch';
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

function loadCatalog() {
  if (!fs.existsSync(CATALOG)) {
    console.error('❌ 没有目录文件，先跑：node tools/qx/library.mjs fetch');
    process.exit(3);
  }
  return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
}

/** 分类：{ id, 名字, 图片 id 列表 } —— 名字取 zh-CN */
function categories(cat) {
  const zh = (cat.names && (cat.names['zh-CN'] || cat.names['en-US'])) || {};
  const out = [];
  for (const [id, c] of Object.entries(cat.categories || {})) {
    out.push({ id: Number(id), name: zh[id] || ('分类' + id), images: c.images || [] });
  }
  out.sort((a, b) => b.images.length - a.images.length);
  return out;
}

async function fetchCatalog() {
  const r = await fetch(BASE + '/api/library/catalog', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CATALOG, text);
  const cat = JSON.parse(text);
  const cs = categories(cat);
  console.log('  ✅ 已保存 ' + path.relative(ROOT, CATALOG) + '（' + Math.round(text.length / 1024) + ' KB）');
  console.log('  素材总数 ' + Object.keys(cat.images || {}).length + ' 个，分 ' + cs.length + ' 类：');
  for (const c of cs) console.log('    ' + String(c.name).padEnd(14) + c.images.length + ' 个   （id ' + c.images[0] + ' … ' + c.images[c.images.length - 1] + '）');
}

async function downloadSprite(id, out) {
  const r = await fetch(BASE + '/api/library/sprite/' + id + '.png');
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + id);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(out, buf);
  return buf.length;
}

// 「接触表」= 把一类素材的缩略图拼成一张大图，**我直接看图挑**。
//
//   为什么需要：目录里**只有 id 和分类名，没有单张素材的名字** ——
//   想知道哪张是椅子、哪张是盆栽，只能看图。
//   1543 张一张张看太慢，拼成一张就好挑了。
//
//   依赖：用 `sharp` 不方便（要装包），这里**直接拼 PNG 像素**太麻烦，
//   所以走**system.Drawing**（Windows 自带）—— 让 PowerShell 干这活。
async function sheet(catName, out, cols, max) {
  const cat = loadCatalog();
  const cs = categories(cat);
  let pick = cs.find((c) => c.name === catName || String(c.id) === catName);
  if (!pick) {
    console.error('❌ 找不到分类「' + catName + '」。可选：' + cs.map((c) => c.name).join(' / '));
    process.exit(4);
  }
  const ids = pick.images.slice(0, max);
  const sprites = path.join(DIR, 'sprites', String(pick.id));
  fs.mkdirSync(sprites, { recursive: true });
  console.log('  分类「' + pick.name + '」共 ' + pick.images.length + ' 个，取前 ' + ids.length + ' 个下载…');
  let ok = 0;
  for (const id of ids) {
    const f = path.join(sprites, id + '.png');
    if (fs.existsSync(f) && fs.statSync(f).size > 0) { ok++; continue; }
    try { await downloadSprite(id, f); ok++; } catch { }
  }
  console.log('  下载成功 ' + ok + ' / ' + ids.length + '  → ' + path.relative(ROOT, sprites));
  console.log('  ' + JSON.stringify({ dir: sprites, ids, cols, out: path.resolve(ROOT, out) }));
}

switch (cmd) {
  case 'fetch': await fetchCatalog(); break;
  case 'list': {
    const cat = loadCatalog();
    const cs = categories(cat);
    const want = argv[1];
    const pick = want ? cs.find((c) => c.name === want || String(c.id) === want) : null;
    if (!pick) { for (const c of cs) console.log('  ' + String(c.name).padEnd(14) + c.images.length + ' 个'); }
    else console.log('  ' + pick.name + '（' + pick.images.length + '）：' + pick.images.join(' '));
    break;
  }
  case 'get': {
    const id = argOf('id');
    if (!id) { console.error('缺 --id='); process.exit(3); }
    const out = argOf('out') || path.join(DIR, 'samples', id + '.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const n = await downloadSprite(id, out);
    console.log('  ✅ ' + out + '（' + Math.round(n / 1024) + ' KB）');
    break;
  }
  case 'sheet':
    await sheet(argOf('cat') || '装饰图案-彩色', argOf('out') || 'tools/qx/out/sheet.png',
      Number(argOf('cols') || 16), Number(argOf('max') || 256));
    break;
  default:
    console.log('用法：fetch | list [分类] | get --id= | sheet --cat= --out=');
}
