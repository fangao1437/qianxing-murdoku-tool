// 探针：全量分类 #503 —— 到底是"裸 ID 子列表"还是"真消息"
// 用法: node tools/gil/_probe_503.mjs <gil...>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMsg, encodeMsg, asIdList, writeVarint } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function scan(file) {
  const src = fs.readFileSync(file);
  const hdr = []; for (let i = 0; i < 5; i++) hdr.push(src.readUInt32BE(i * 4));
  const tree = parseMsg(src, 20, 20 + hdr[4], 0);
  if (!tree) return { file, err: '解析失败' };
  const all = [];
  (function walk(fs2, d) { for (const f of fs2) { all.push({ f, d }); if (f.sub) walk(f.sub, d + 1); } })(tree, 0);

  const f503 = all.filter((x) => x.f.field === 503 && x.f.wt === 2 && x.f.payload);
  const wt1 = all.filter((x) => x.f.wt === 1);
  let idList = 0, realMsg = 0, noSub = 0, idListWithFakeSub = 0, realMsgSubNull = 0;
  let reencodeMismatch = 0;
  const realSamples = [];
  for (const { f, d } of f503) {
    const ids = asIdList(f.payload, true);
    if (ids !== null) {
      idList++;
      if (f.sub !== null) idListWithFakeSub++;
    } else {
      realMsg++;
      if (f.sub === null) realMsgSubNull++;
      else {
        const re = encodeMsg(f.sub);
        if (!re.equals(f.payload)) {
          reencodeMismatch++;
          if (realSamples.length < 5) realSamples.push({ d, len: f.payload.length, re: re.length });
        }
      }
      if (realSamples.length < 5 && d < 12) realSamples.push({ d, len: f.payload.length, ids: 'null' });
    }
  }
  // 全树重编码保真度（逐字段比对 payload 长度/内容，排除 #503 后仍看整体）
  const allRe = encodeMsg(tree);
  return {
    file: path.basename(file), recs: all.length,
    f503: f503.length, idList, realMsg, idListWithFakeSub, realMsgSubNull,
    realMsgReencodeMismatch: reencodeMismatch, samples: realSamples.slice(0, 5),
    wt1Count: wt1.length,
    // 顶层 wt2 字段里 503 的深度分布
    depths: [...new Set(f503.map((x) => x.d))].sort((a, b) => a - b).join(','),
  };
}

for (const a of process.argv.slice(2)) {
  const p = path.isAbsolute(a) ? a : path.resolve(ROOT, a);
  if (!fs.existsSync(p)) { console.log('缺文件', a); continue; }
  console.log(JSON.stringify(scan(p), null, 1));
}
