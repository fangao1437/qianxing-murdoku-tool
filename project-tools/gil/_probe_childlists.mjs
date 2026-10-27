// tools/gil/_probe_childlists.mjs —— 只读：谁把某个 id 放进了**子控件列表**（含重复登记）
//   用法：node tools/gil/_probe_childlists.mjs <存档.gil> [<id>…]
//   场景：编辑器报「开关控件GUID重复:1073742787」而记录本身只有一个 ⇒ 查**子列表里重复登记** ✓
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [file, ...ids] = process.argv.slice(2);
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const want = ids.length ? new Set(ids.map((x) => String(Number(x)))) : null;

console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length
  + (want ? '　查：' + [...want].join(', ') : '　（查所有重复登记的 id）'));

const registrations = new Map();   // id -> [父名字...]
const dupInside = [];              // 同一个父把一个 id 登记了两次
for (const r of g.recs) {
  const lists = [];
  (function walk(fields) {
    for (const f of fields || []) {
      if (f.sub) walk(f.sub);
      else if (f.field === 503 && f.payload) {
        const arr = asIdList(f.payload, true);
        if (arr && arr.length) lists.push(arr);
      }
    }
  })(r.field.sub);
  for (const arr of lists) {
    const local = new Map();
    for (const v of arr) {
      const k = String(Number(v));
      local.set(k, (local.get(k) || 0) + 1);
      if (!registrations.has(k)) registrations.set(k, []);
      registrations.get(k).push(r.name || ('#' + r.id));
    }
    for (const [k, n] of local) if (n > 1) dupInside.push(k + ' ×' + n + ' 在 ' + (r.name || ('#' + r.id)));
  }
}

const targets = want ? [...want] : [...registrations.keys()];
let bad = 0;
for (const id of targets) {
  const owners = registrations.get(id) || [];
  const flag = owners.length > 1 || dupInside.some((s) => s.startsWith(id + ' '));
  if (!flag) continue;
  bad++;
  console.log('  #' + id + ' 被登记 ' + owners.length + ' 次：' + owners.join(' | '));
}
if (!bad) console.log('  （没有重复登记）');
if (dupInside.length) console.log('  同一父内重复：' + dupInside.join('; '));
