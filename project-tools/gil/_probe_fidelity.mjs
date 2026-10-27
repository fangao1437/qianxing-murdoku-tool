// 探针：编码器保真度全量扫描 —— 修 `#503`/wt1 之后，重编码是否仍与原体逐字节一致
// 用法: node tools/gil/_probe_fidelity.mjs <目录或文件...>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMsg, encodeMsg } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function files(arg) {
  const p = path.isAbsolute(arg) ? arg : path.resolve(ROOT, arg);
  if (!fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter((f) => f.endsWith('.gil')).map((f) => path.join(p, f));
}

const list = process.argv.slice(2).flatMap(files);
let ok = 0, bad = 0, skipped = 0;
const bads = [];
for (const f of list) {
  const src = fs.readFileSync(f);
  const hdr = []; for (let i = 0; i < 5; i++) hdr.push(src.readUInt32BE(i * 4));
  const body = src.subarray(20, 20 + hdr[4]);
  let tree = null;
  try { tree = parseMsg(src, 20, 20 + hdr[4], 0); } catch { tree = null; }
  if (!tree) { skipped++; continue; }
  let re = null;
  try { re = encodeMsg(tree); } catch (e) { bads.push([path.basename(f), '编码抛异常: ' + e.message]); bad++; continue; }
  if (re.equals(body)) ok++;
  else {
    let d = 0; while (d < Math.min(re.length, body.length) && re[d] === body[d]) d++;
    bads.push([path.basename(f), `长度 ${re.length} vs ${body.length}，首个差异 @${d}`]);
    bad++;
  }
}
console.log(`扫描 ${list.length} 个文件：逐字节一致 ${ok} ✓　不一致 ${bad} ✗　无法解析 ${skipped}`);
for (const [n, why] of bads.slice(0, 20)) console.log('  ✗ ' + n + ' —— ' + why);
