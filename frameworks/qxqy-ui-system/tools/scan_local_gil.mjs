// tools/scan_local_gil.mjs —— 扫本机真实关卡存档，找出"引擎/工程已占用的 GUID 段"
// 目的（2026-10-21 真机报「开关控件GUID重复」）：新增控件的 id 不能落在**目标工程已用段**。
// 依据：本机 `%LOCALAPPDATA%Low\miHoYo\原神\BeyondLocal\<uid>\Beyond_Local_Save_Level\**\*.gil`
//      是游戏自己存出来的存档（引擎分配过 id），拿它当"已占用号段"的地面真值。
// 用法：node tools/scan_local_gil.mjs [--limit=120] [--id=1073742041]
import fs from 'node:fs';
import path from 'node:path';
import { writeVarint } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const LOCAL = 'C:/Users/18182/AppData/LocalLow/miHoYo/原神/BeyondLocal/153793556/Beyond_Local_Save_Level';
const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const LIMIT = Number(argOf('limit') || 200);
const WATCH = argOf('id') ? Number(argOf('id')) : null;

function readVarint(b, p) {
  let r = 0n, s = 0n;
  for (;;) {
    const x = b[p++];
    r |= BigInt(x & 0x7f) << s;
    if ((x & 0x80) === 0) return { v: r, p };
    s += 7n;
    if (s > 63n) throw new Error('long varint');
  }
}
/** 扫整个 body 里所有落在 ID 区间的 varint（含未解析字段），拿最大/最小与命中集合 */
function scanIds(buf) {
  const bodyLen = buf.readUInt32BE(16);
  const end = 20 + bodyLen;
  const ids = new Set();
  let max = 0, min = Number.MAX_SAFE_INTEGER;
  let p = 20;
  // 粗糙但够用：顺序解 key/value；长度前缀跳过 payload 但不是所有 payload 都是消息
  const stack = [[20, end]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let q = from;
    while (q < to) {
      let k, v;
      try {
        k = readVarint(buf, q);
      } catch { break; }
      q = k.p;
      const field = Number(k.v >> 3n), wt = Number(k.v & 7n);
      if (!field) break;
      if (wt === 0) {
        try { v = readVarint(buf, q); } catch { break; }
        q = v.p;
        const n = Number(v.v);
        if (n >= 1073000000 && n <= 1075000000) {
          ids.add(n);
          if (n > max) max = n;
          if (n < min) min = n;
        }
      } else if (wt === 2) {
        try { v = readVarint(buf, q); } catch { break; }
        q = v.p;
        const len = Number(v.v);
        if (len < 0 || q + len > to) break;
        // 继续递归进这个 payload 找 id（payload 也可能是消息/打包列表）
        if (len >= 2) stack.push([q, q + len]);
        q += len;
      } else if (wt === 5) q += 4;
      else if (wt === 1) q += 8;
      else break;
    }
  }
  return { ids, max, min: min === Number.MAX_SAFE_INTEGER ? 0 : min };
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.gil')) files.push(p);
  }
})(LOCAL);
files.sort();
console.log(`本机关卡存档 ${files.length} 个（目录 ${LOCAL}）`);

const rows = [];
const watchHits = [];
for (const f of files.slice(0, LIMIT)) {
  const buf = fs.readFileSync(f);
  let r;
  try { r = scanIds(buf); } catch (e) { rows.push({ f, err: e.message }); continue; }
  const name = path.basename(path.dirname(f));
  rows.push({ f, name, kb: Math.round(buf.length / 1024), n: r.ids.size, min: r.min, max: r.max });
  if (WATCH != null && r.ids.has(WATCH)) watchHits.push(name);
}

const big = rows.filter((r) => r.kb > 100).sort((a, b) => new Date(fs.statSync(b.f).mtime) - new Date(fs.statSync(a.f).mtime));
console.log('\n—— 大存档（>100KB，最可能是有内容工程的）——');
for (const r of big.slice(0, 12)) {
  console.log(`  ${r.name}  ${r.kb}KB  id 数 ${r.n}  最小 ${r.min}  最大 ${r.max}`);
}

const maxAll = Math.max(...rows.filter((r) => r.max).map((r) => r.max));
const minAll = Math.min(...rows.filter((r) => r.min).map((r) => r.min));
console.log(`\n★ 本机所有存档里出现的 GUID 段：${minAll} … ${maxAll}`);
if (WATCH != null) {
  console.log(`★ 含 ${WATCH} 的存档 ${watchHits.length} 个：${watchHits.slice(0, 10).join(', ') || '无'}`);
}
console.log(`\n建议：新增控件用 ${maxAll + 1000} 起（远离本机已用段，也不撞引擎脚手架 <1073742016）`);
