// tools/gil/gen_protos.mjs —— 在存档里【真的建出】gen_bulk 需要的三个原型
//
// ★ 为什么需要它（2026-10-07）：
//   `check_names.mjs`（导入前对账）点名要求 `proto.btn` / `proto.text` 存在 ✗
//   而 208.1.gil 里三个原型都没有 ⇒ 对账 ❌ ⇒ **导入被拒** ✓
//   `gen_bulk.mjs` 只是"用兜底绕过"，绕过后对账仍然 ❌ ⇒ 必须真的建出来 ✓
//
// 做法：克隆已有的同类控件（按钮 ← home.select；文本 ← home.title；容器 ← clues），
//       改 ID / 名字 / 父级（挂到 root 下）/ 位置（挪到画布外，避免干扰），
//       再登记进 root 的子控件列表。
//
// 用法：node tools/gil/gen_protos.mjs --in=208.1.gil --out=209-原型.gil [--probe]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, stateBlocks, textsOf,
  findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '208.1.gil');
const OUT = argOf('out') || path.join(ROOT, '209-原型.gil');

const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '（' + g.src.length + ' 字节）控件记录 ' + g.recs.length + ' 条');
const byName = new Map();
for (const r of g.recs) if (r.name) byName.set(r.name, r);
const maxId = Math.max(...g.recs.map((r) => r.id));
const root = byName.get('root');
if (!root) { console.error('✗ 找不到 root'); process.exit(2); }

// 要建的原型：名字 → 克隆源 → 尺寸（挪到画布外，免得盖住界面）
const WANT = [
  { name: 'proto.btn',  from: 'home.select', size: [200, 60] },
  { name: 'proto.text', from: 'home.title',  size: [200, 40] },
  // ★ 2026-10-07 补：cfg 点名的两个容器 + obj.* 的父
  //   · board ⇒ 脚本按名字要它（虽然已有 board.bg，但 board 本身不在存档里）
  //   · tray  ⇒ 头像卡容器占位
  //   · assets ⇒ 素材调色板容器；obj.* 四个物件的父，缺它那四条进不了存档
  { name: 'board',  from: 'clues', size: [584, 584] },
  { name: 'tray',   from: 'clues', size: [400, 544] },
  { name: 'assets', from: 'clues', size: [400, 544] },
];
const missing = WANT.filter((w) => !byName.has(w.name));
console.log('要建 ' + missing.length + ' 个：' + missing.map((w) => w.name).join(', '));
if (!missing.length) { console.log('★ 三个原型已齐，不用建'); process.exit(0); }

function patch(rec, spec) {
  const clone = cloneField(rec.field);
  const oldId = rec.id;
  (function fixId(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === oldId) f.num = BigInt(spec.id);
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const d = readVarintDummy(f.payload);
        if (d && Number(d) === oldId) { f.payload = writeVarint(spec.id); f.len = f.payload.length; }
      }
      if (f.sub) fixId(f.sub);
    }
  })(clone.sub);
  let parentOk = false;
  (function fixParent(fs2) { for (const f of fs2) { if (!parentOk && f.wt === 0 && f.field === 504 && Number(f.num) === rec.parentId) { f.num = BigInt(spec.parentId); parentOk = true; } if (f.sub) fixParent(f.sub); } })(clone.sub);
  let nameOk = false;
  if (rec.nameField) {
    const ts = textsOf(clone.sub, []);
    const nf = ts.find((t) => t.payload.toString('utf8') === rec.name);
    if (nf) { nf.payload = Buffer.from(spec.name, 'utf8'); nf.len = nf.payload.length; nameOk = true; }
  }
  let geo = 0;
  for (const block of stateBlocks(clone.sub, [])) {
    if (setPair(block.sub.find((x) => x.field === 504), spec.pos[0], spec.pos[1])) geo++;
    setPair(block.sub.find((x) => x.field === 505), spec.size[0], spec.size[1]);
  }
  const myChild = ensureChildListTop({ field: clone }, null); setChildList(myChild, []);
  return { clone, parentOk, nameOk, geo, childList: myChild };
}
function readVarintDummy(buf) { let v = 0, sh = 0; for (let i = 0; i < buf.length; i++) { v += (buf[i] & 0x7f) * Math.pow(2, sh); if (!(buf[i] & 0x80)) return i === buf.length - 1 ? v : null; sh += 7; } return null; }

let nextId = maxId + 1;
const inserts = [];
for (const w of missing) {
  const rec = byName.get(w.from);
  if (!rec) { console.error('✗ 克隆源不存在：' + w.from); process.exit(3); }
  // 位置：画布外（-3000,-3000 附近，逐个错开）
  const spec = { id: nextId, name: w.name, parentId: root.id, pos: [-3000 - inserts.length * 240, -3000], size: w.size };
  const p = patch(rec, spec);
  console.log('  ' + w.name + ' ← ' + w.from + '#' + rec.id + ' ⇒ #' + spec.id
    + ' 父#' + spec.parentId + ' 父OK=' + p.parentOk + ' 名OK=' + p.nameOk + ' 几何' + p.geo + '/4');
  inserts.push({ spec, patched: p });
  nextId++;
}

// 登记进 root 的子列表
const rootList = ensureChildListTop(root, null);
let regOk = 0;
for (const it of inserts) {
  if (!rootList) break;
  const cur = asIdList(rootList.payload, true) || [];
  if (!cur.includes(it.spec.id)) cur.push(it.spec.id);
  setChildList(rootList, cur);
  regOk++;
}
console.log('登记进 root 子列表：' + regOk + '/' + inserts.length);

if (DRY) { console.log('--probe：不写文件'); process.exit(0); }

const holder = root.holder;
holder.splice(root.index + 1, 0, ...inserts.map((it) => it.patched.clone));
const body = encodeMsg(g.tree);
const head = Buffer.alloc(20);
head.writeUInt32BE(20 + body.length + g.trailer.length - 4, 0);
head.writeUInt32BE(g.hdr[1], 4); head.writeUInt32BE(g.hdr[2], 8); head.writeUInt32BE(g.hdr[3], 12);
head.writeUInt32BE(body.length, 16);
const out = Buffer.concat([head, body, g.trailer]);
fs.writeFileSync(OUT, out);
console.log('输出：' + OUT + '  ' + out.length + ' 字节（+' + (out.length - g.src.length) + '）');