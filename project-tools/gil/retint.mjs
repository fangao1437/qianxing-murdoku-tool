// tools/gil/retint.mjs —— 把指定控件的**子控件图片**换成另一个素材（source+id 成对）
//
// 为什么单独做个工具：
//   我在 gen_btn_art.mjs 里把"克隆 + 改图"写成了从零生成，
//   但**用户的存档里已经有一个 assets 调色板容器**（portrait.*）——
//   重新生成会把它丢掉。所以后期的颜色调整要能**在现有存档上原地改**。
//
// 用法：
//   node tools/gil/retint.mjs --in=a.gil --out=b.gil --parent-prefix=tray. --child=face --src=4281536672 --id=100108
//   node tools/gil/retint.mjs --in=a.gil --out=b.gil --names=tool.place,action.undo --child=bg --id=100108
//
// ⚠️ 只改 id 的前提是**新 id 与旧 id 属于同一个 source**（同一个图集）。
//    换到别的图集必须连 --src 一起给，否则会出现"属性变了、画面没变"（我踩过三版）。
//
// ★★ 验收（★ 判据，不是建议 ✓）：
//   node tools/gil/retint.mjs --in=<输入> --out=<输出> --names=… --child=… --id=…
//     ⇒ 必须打印 "✅ ⑧ 断言：N/N 个目标都读回 id=… "（★ 用**重读磁盘**的那份 ✓）
//     ⇒ 且打印 "✅ ⑦ 字段级 diff：差异恰好 N 处"（★ 每个改动的 varint 算 1 处 ✓）
//   ★ 独立复核：node tools/gil/roundtrip.mjs <输出>
//
// ★★★★ 2026-10-10 **本工具当年也中过 `#503` 冻结** ✗✓（★ 重要 ✓）
//   ★ 它改的叶子路径是 ★ **`/#505/#503/#84/#503`** ✓ —— ★ **路径上第 2 环就是 `#503`** ✗✓
//   ★ 而那次回归里，`encodeMsg` 一遇到 `#503` 就**改用旧 `payload`、不再往下递归** ✗
//     ⇒ ★★ **本工具对 `#503` 底下叶子的任何修改，当年【全都写不进去】** ✗
//     ⇒ ★★★ 而它**照样打印"✅ 读回验证 N/N"** ✗（★ 因为那个"读回"读的是**刚写出的同一个字节流** ✓
//       —— ★ **写没写进去，它自己看不出来** ✗✓）
//   ★ 这条与 lead 的观察吻合 ✓：★ **"描边变亮"如果当年是想靠 `retint` 修，那它根本没生效** ✓
//   ⚠️ ★ 但注意 ✓：★ `retint` 改的是**素材（source/id）** ✗ —— ★ **不是颜色** ✗。
//     ★ 实测 `296`/`297`：★ **`backrop1` 的 76 个 wt0 叶子里【没有 `imageColor`】** ✓、
//     ★ 用户期望的 `26262E`(=`2500142`) **整个存档出现 0 次** ✗
//     ⇒ ★★ **颜色是【运行时由客户端脚本】写进去的** ✓（`lua/ui_controller.lua` 里
//       `pc.imageColor = …` / `c2.imageColor = 4294956107` ✓ ⇒ `imageColor` 是**读写 API 字段** ✓）
//     ⇒ ★★★ **所以"描边变亮"的成因不在 `.gil` 里** ✓ —— ★ 查 `ui_controller.lua` 的染色分支 ✓
//
// ★★ 2026-10-10 迁移到 `writeGil()` ✓：★ 落盘 → **重读磁盘** → 往返闸门 → 字段级 diff → 逐目标断言 ✓

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');

const BASE = argOf('in');
const OUT = argOf('out') || BASE;
const CHILD = argOf('child') || 'bg';
const NEW_ID = Number(argOf('id') || 100108);
const NEW_SRC = argOf('src') ? Number(argOf('src')) : null;
const NAMES = argOf('names') ? argOf('names').split(',').map((s) => s.trim()).filter(Boolean) : null;
const PREFIX = argOf('parent-prefix');

if (!BASE) { console.error('必须给 --in='); process.exit(1); }
const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '  控件记录 ' + g.recs.length + ' 条');

// ── 目标控件 ──────────────────────────────────────────────────────────────
let parents;
if (NAMES) {
  parents = NAMES.map((n) => g.byName.get(n)).filter(Boolean);
} else if (PREFIX) {
  parents = g.recs.filter((r) => r.name && r.name.startsWith(PREFIX));
} else {
  console.error('要给 --names= 或 --parent-prefix=');
  process.exit(1);
}
console.log('目标父控件：' + parents.length + ' 个（找子控件 `' + CHILD + '`）');

const IMG_ID_PATH = [505, 503, 84, 503];
const IMG_SRC_PATH = [505, 503, 84, 502];

/** 逐层保留全部候选 —— 记录里有多个 #505 块，只取第一个会走断 */
function fieldsAtPath(fields, p) {
  let level = [fields];
  for (let i = 0; i < p.length; i++) {
    const hits = [];
    for (const list of level) for (const f of list) if (f.field === p[i]) hits.push(f);
    if (!hits.length) return [];
    if (i === p.length - 1) return hits;
    level = hits.map((f) => f.sub).filter(Boolean);
    if (!level.length) return [];
  }
  return [];
}

let changed = 0, skipped = 0, nDiff = 0;
const targets = [];   // ★ 落盘后要逐个复读的目标 ✓
for (const p of parents) {
  const kid = g.recs.find((r) => r.parentId === p.id && r.name === CHILD);
  if (!kid) { skipped++; continue; }
  const idF = fieldsAtPath(kid.field.sub, IMG_ID_PATH).filter((f) => f.wt === 0)[0];
  if (!idF) { skipped++; console.log('  ⚠️ ' + p.name + '.' + CHILD + ' 没有图片 id 字段'); continue; }
  const before = Number(idF.num);
  idF.num = BigInt(NEW_ID);
  let srcBefore = null;
  if (NEW_SRC !== null) {
    const srcF = fieldsAtPath(kid.field.sub, IMG_SRC_PATH).filter((f) => f.wt === 0)[0];
    if (srcF) { srcBefore = Number(srcF.num); srcF.num = BigInt(NEW_SRC); }
  }
  if (before !== NEW_ID) changed++;
  // ★ 差异条数：★ 每个"真的变了"的 wt0 varint 算 1 处 ✓
  if (before !== NEW_ID) nDiff++;
  if (srcBefore !== null && srcBefore !== NEW_SRC) nDiff++;
  targets.push({ pName: p.name, kidId: kid.id });
}
console.log('改图：' + changed + ' 个，跳过（无该子控件/无图片字段）：' + skipped + '，预计改动 ' + nDiff + ' 处');

if (changed === 0) { console.log('\n无需改动'); process.exit(0); }
if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

// ★★★ 走唯一安全通道 ✓ —— ★ 落盘 → **重读磁盘** → 往返闸门 → 字段级 diff → 逐目标断言 ✓
try {
  const rep = writeGil(g, OUT, {
    label: 'retint 改素材（' + changed + ' 个 ' + CHILD + ' → id=' + NEW_ID + (NEW_SRC !== null ? ' src=' + NEW_SRC : '') + '）',
    expectDiffs: nDiff,          // ★ 只允许这几个 varint 变 ✓（多一处就抛异常 ✗）
    assert: (g2) => {
      // ★ 判据：★ 每个目标子控件都必须读回新 id（★ 从磁盘重读的那份 ✓）
      let ok = 0;
      for (const t of targets) {
        const kid = g2.recs.find((r) => r.id === t.kidId);
        if (!kid) return '重读后找不到 ' + t.pName + '.' + CHILD + '（#' + t.kidId + '）';
        const idF = fieldsAtPath(kid.field.sub, IMG_ID_PATH).filter((f) => f.wt === 0)[0];
        if (!idF) return t.pName + '.' + CHILD + ' 重读后没有图片 id 字段';
        if (Number(idF.num) !== NEW_ID) return t.pName + '.' + CHILD + ' 读回 id=' + Number(idF.num) + '，应为 ' + NEW_ID;
        if (NEW_SRC !== null) {
          const srcF = fieldsAtPath(kid.field.sub, IMG_SRC_PATH).filter((f) => f.wt === 0)[0];
          if (!srcF || Number(srcF.num) !== NEW_SRC) return t.pName + '.' + CHILD + ' 读回 src=' + (srcF ? Number(srcF.num) : '无') + '，应为 ' + NEW_SRC;
        }
        ok++;
      }
      return ok === targets.length || ('只有 ' + ok + '/' + targets.length + ' 个读回正确');
    },
  });
  console.log('  ✅ ⑧ 断言：' + targets.length + '/' + targets.length + ' 个目标都读回 id=' + NEW_ID
    + (NEW_SRC !== null ? ' src=' + NEW_SRC : '') + ' ✓（★ 重读磁盘 ✓）');
  console.log('  输出 ' + path.basename(OUT) + '  ' + rep.bytes + ' 字节　记录 ' + rep.recs + '（原 ' + g.recs.length + '）');
  console.log('  ★ 独立复核：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
  console.log('  ★ 出货前体检：node tools/gil/inspect_gil.mjs ' + path.basename(OUT));
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(4);
}
