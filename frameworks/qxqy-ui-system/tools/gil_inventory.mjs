// tools/gil_inventory.mjs —— .gil 控件清单（读：不写文件）
// 复用仓库成熟解析链：qianxing-murdoku/tools/gil/gilread.mjs（readGil/recordsOf/pairOf/pairValue）
// 用法：node tools/gil_inventory.mjs <file.gil> [--names=<逗号分隔前缀>] [--max=80]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, pairOf, pairValue, asIdList, KNOWN_TYPES } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
if (!FILE) {
  console.error('用法: node tools/gil_inventory.mjs <file.gil> [--names=board,proto.] [--max=80]');
  process.exit(2);
}
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const MAX = Number(argOf('max') || 200);
const FILTER = (argOf('names') || '').split(',').map((s) => s.trim()).filter(Boolean);

const g = readGil(path.resolve(REPO, FILE));
const RAW = argOf('raw');
if (RAW) {
  // 深度转储某条记录（按 id），用于搞清楚 #502/#503/#504/#505 的真实形状
  const id = Number(RAW);
  const rec = g.recs.find((r) => r.id === id);
  if (!rec) {
    console.error('没找到记录 id=' + id);
    process.exit(3);
  }
  const show = (fields, ind = '') => {
    for (const f of fields) {
      if (f.wt === 0) console.log(`${ind}#${f.field} = ${f.num}`);
      else if (f.wt === 5) console.log(`${ind}#${f.field} = f32(${f.f})`);
      else if (f.wt === 2) {
        if (f.isText) console.log(`${ind}#${f.field} = "${f.payload.toString('utf8')}"`);
        else if (f.sub) {
          console.log(`${ind}#${f.field} { len=${f.len} }`);
          show(f.sub, ind + '  ');
        } else console.log(`${ind}#${f.field} = <bin ${f.len}> ${f.payload.toString('hex').slice(0, 40)}`);
      } else console.log(`${ind}#${f.field} wt=${f.wt} len=${f.len}`);
    }
  };
  console.log(`记录 ${id} name=${rec.name} parent=${rec.parentId} 状态=${structStates(rec).length} childList=${
    rec.childList ? JSON.stringify(asIdList(rec.childList.payload, true) || []) : 'null'}`);
  show(rec.field.sub, '  ');
  process.exit(0);
}

console.log(`文件：${path.basename(g.file)}（${g.src.length} 字节，体 ${g.hdr[4]}，尾部 ${g.trailer.toString('hex')}）`);
console.log(`顶层字段：${g.tree.map((f) => f.field).join(',')}`);
console.log(`记录 ${g.recs.length} 条 | maxId=${g.maxId} | recHolder 字段号=${g.recHolder === g.tree ? '(tree)' : '(子消息)'}`);

// ★ 结构版状态读取：`stateBlocks()` 要求尺寸对里有**两个浮点**，而 (0,0) 尺寸是空消息（稀疏编码）
//   ⇒ 整屏拉伸容器（offset/size 都是 0）会被它漏成"状态=0"。这里按**结构**取：
//   槽 (1,12) → #503 → #13 → #12 → #501(状态包装) → #502(几何容器)
function slotField(fields, a, b) {
  for (const f of fields) {
    if (f.field !== 505 || !f.sub) continue;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (pA && pB && Number(pA.num) === a && Number(pB.num) === b) return f;
  }
  return null;
}
function structStates(rec) {
  try {
    const slot = slotField(rec.field.sub, 1, 12);
    const det = slot && slot.sub.find((x) => x.field === 503 && x.sub);
    const d13 = det && det.sub.find((x) => x.field === 13);
    const d12 = d13 && d13.sub && d13.sub.find((x) => x.field === 12);
    if (!d12 || !d12.sub) return rec.states;
    const out = d12.sub.filter((f) => f.field === 501 && f.sub)
      .map((w) => w.sub.find((x) => x.field === 502 && x.sub)).filter(Boolean);
    return out.length ? out : rec.states;
  } catch { return rec.states; }
}
function kidCount(rec) {
  if (!rec.childList) return 0;
  const ids = asIdList(rec.childList.payload, true);
  return ids ? ids.length : 0;
}

const holderIsRec = (rec) => rec.holder === g.recHolder;
let shown = 0;
for (const rec of g.recs) {
  const nm = rec.name || '';
  if (FILTER.length && !FILTER.some((p) => nm.startsWith(p))) continue;
  if (shown++ >= MAX) break;
  const sts = structStates(rec);
  const first = sts[0];
  let pos = '?';
  let size = '?';
  if (first) {
    const p = pairOf(first, 504);
    const s = pairOf(first, 505);
    pos = p ? `(${pairValue(p, 0)},${pairValue(p, 1)})` : '(0,0)';
    size = s ? `${pairValue(s, 0)}x${pairValue(s, 1)}` : '?';
  }
  const types = rec.names.filter((n) => KNOWN_TYPES.has(n)).join('/');
  console.log(
    [
      String(rec.id).padEnd(11),
      (nm || '(无名)').padEnd(18),
      `父=${rec.parentId ?? 'null'}`.padEnd(18),
      `状态=${sts.length}`,
      `pos=${pos}`.padEnd(20),
      `size=${size}`.padEnd(14),
      `子=${kidCount(rec)}`,
      `类型=${types}`,
      holderIsRec(rec) ? 'holder=主' : 'holder=其它',
    ].join(' ')
  );
}
if (shown >= MAX) console.log(`…（还有更多，用 --max/--names 缩小范围）`);
