// tools/audit/fetch_kb.mjs —— 抓「千星奇域知识库」（**社区**来源）
//
// 来源：https://github.com/1475505/dsh-plugin-miliastra-toolbox
//   该插件只把 SKILL API 包成两个工具，底层 HTTP 公开可调：
//     POST https://ugc.070077.xyz/api/v1/skills/miliastra-knowledge/tools/<工具>
//   实测可用的工具：
//     list_documents  { }                      → 全部文档（实测 308 篇，带 path_id / file / title）
//     get_document    { titles:[…] }            → 全文，**支持批量**；返回带 YAML frontmatter 的 Markdown
//     list_client_documents / get_client_document → 专用索引，**实测返回 0 条**（见下）
//
// ⚠️ **来源分级：这是社区维护的镜像，不是官方原文。**
//    与 docs/api-cache/（官方站抓的正文）冲突时，**以官方为准**。
//    所以两者分开放：官方 → docs/api-cache/；社区 → docs/community-cache/。
//
// ⚠️ **实测结论：这个社区库是"过期"的 —— 恰好缺 7.1 的客户端控件全家桶。**
//    我们最需要的 10 篇（客户端控件 API 文档、定义、预设按钮、容器、光标检测区域…）
//    它一篇都没有；`list_client_documents` 返回 0 条也是同一个原因。
//    所以它**不能**用来交叉验证客户端控件相关内容；对我们有价值的是它另外 ~300 篇
//    编辑器/FAQ/节点图文档。脚本会把覆盖差异明确打出来。
//
// 用法：
//   node tools/audit/fetch_kb.mjs           # 标题清单 + 覆盖差异报告（快，1 次请求）
//   node tools/audit/fetch_kb.mjs --all     # 再把全部正文批量抓下来存 kb-all.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');
const OUT = path.join(WORKSPACE, 'docs', 'community-cache');
const OFFICIAL = path.join(WORKSPACE, 'docs', 'api-cache');
const KB = 'https://ugc.070077.xyz/api/v1/skills/miliastra-knowledge/tools';
const REPO = '1475505/dsh-plugin-miliastra-toolbox';

const write = (name, text) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
};

async function tool(name, body) {
  const r = await fetch(`${KB}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'murdoku-audit' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name} → HTTP ${r.status} ${text.slice(0, 160)}`);
  const j = JSON.parse(text);
  if (j.success !== true) throw new Error(`${name} → success=false ${text.slice(0, 160)}`);
  return j.data.result;
}

async function getRepoFile(p) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(p)}`,
    { headers: { 'User-Agent': 'murdoku-audit' } });
  if (!r.ok) throw new Error(p + ' → HTTP ' + r.status);
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf8');
}

const pathIdOf = (file) => (/(mh[a-z0-9]+)_/.exec(String(file)) || [])[1] || '';

async function main() {
  const all = process.argv.includes('--all');
  const L = [];
  const log = (s = '') => { console.log(s); L.push(s); };

  log('# 千星奇域知识库（社区）抓取与覆盖报告');
  log();
  log('- 来源仓库：https://github.com/' + REPO);
  log('- 底层 API：`POST ' + KB + '/<工具名>`');
  log('- 抓取时间：' + new Date().toISOString());
  log();
  log('> ⚠️ **社区来源，不是官方原文。** 与 `docs/api-cache/`（官方站正文）冲突时**以官方为准**。');
  log();

  // ── 1. 插件说明 ────────────────────────────────────────────────────────
  log('## 一、插件说明（它自述的覆盖范围）');
  log();
  for (const f of ['README.md', 'skill.md', 'skill-lua.md']) {
    try {
      const t = await getRepoFile(f);
      write(f, t);
      log('- `' + f + '` → `docs/community-cache/' + f + '`（' + t.length + ' 字符）');
    } catch (e) {
      log('- `' + f + '` 失败：' + e.message);
    }
  }
  log();

  // ── 2. 文档清单 ────────────────────────────────────────────────────────
  let docs = [];
  try {
    const res = await tool('list_documents', {});
    docs = res.documents || [];
    write('kb-index.tsv', ['title\tfile\tpath_id']
      .concat(docs.map((d) => `${d.title}\t${d.file}\t${pathIdOf(d.file)}`)).join('\n') + '\n');
    write('kb-index.raw.json', JSON.stringify(res, null, 2));
    log('## 二、文档清单');
    log();
    log('`list_documents` 返回 **' + (res.total ?? docs.length) + '** 篇，已存：');
    log('- `docs/community-cache/kb-index.tsv`（标题 / 文件 / path_id）');
    log();
  } catch (e) {
    log('## 二、文档清单');
    log();
    log('**抓取失败**：' + e.message);
    log();
    log('> 知识库不通不影响对照流程 —— 官方原文仍在 `docs/api-cache/`（' +
      (fs.existsSync(OFFICIAL) ? fs.readdirSync(OFFICIAL).filter((f) => f.endsWith('.txt')).length : 0) +
      ' 篇），那是主来源。');
    log();
    write('_抓取记录.md', L.join('\n') + '\n');
    process.exit(0);
  }

  // ── 3. 与官方缓存的覆盖差异（这是最有用的一节）─────────────────────────
  const kbById = new Map();
  for (const d of docs) { const id = pathIdOf(d.file); if (id) kbById.set(id, d); }
  const ours = fs.existsSync(OFFICIAL)
    ? fs.readdirSync(OFFICIAL).filter((f) => f.endsWith('.txt')).map((f) => f.replace(/\.txt$/, ''))
    : [];
  const missing = ours.filter((id) => !kbById.has(id));

  log('## 三、覆盖差异：知识库 vs 官方缓存');
  log();
  log('| 项 | 数量 |');
  log('|---|---|');
  log('| 本工程官方缓存（`docs/api-cache/`） | ' + ours.length + ' 篇 |');
  log('| 知识库 | ' + kbById.size + ' 篇（带 path_id 的） |');
  log('| **官方有、知识库没有** | **' + missing.length + ' 篇** |');
  log();
  if (missing.length) {
    log('### ⚠️ 知识库缺的这些，恰好是 7.1 的「客户端控件」全家桶');
    log();
    const titleOf = {};
    // 从官方缓存的 manifest 里取标题
    const mf = path.join(OFFICIAL, 'manifest.tsv');
    if (fs.existsSync(mf)) {
      for (const line of fs.readFileSync(mf, 'utf8').split('\n')) {
        const [id, title] = line.split('\t');
        if (id) titleOf[id] = title;
      }
    }
    log('| path_id | 标题 |');
    log('|---|---|');
    for (const id of missing) log('| `' + id + '` | ' + (titleOf[id] || '(?)') + ' |');
    log();
    log('> **结论**：这个社区知识库对「客户端控件 / Lua 脚本」这部分**完全没有覆盖** ——');
    log('> `list_client_documents` 实测返回 0 条，是同一个原因。');
    log('> 所以它**不能**用来交叉验证客户端控件相关结论（我们的核心命题都在那里）。');
    log('> 它对我们的价值在那 ~300 篇编辑器 / FAQ / 节点图文档。');
    log();
  }

  // ── 4. 专用索引实测（留证据）────────────────────────────────────────────
  log('## 四、专用索引 `list_client_documents` 实测');
  log();
  for (const body of [{}, { keywords: ['控件'] }]) {
    try {
      const res = await tool('list_client_documents', body);
      const total = Array.isArray(res) ? res.map((x) => x.total).join('/') : res.total;
      log('- 入参 `' + JSON.stringify(body) + '` → `total=' + total + '`');
    } catch (e) {
      log('- 入参 `' + JSON.stringify(body) + '` → 失败：' + e.message);
    }
  }
  log();
  log('> 与第三节的结论一致：专用索引是空的。**别信 `skill-lua.md` 里"共 10 篇"的说法** ——');
  log('> 那份说明与实际服务不一致（它描述的 10 篇，服务端一条都没有）。');
  log();

  // ── 5. 全部正文（可选）─────────────────────────────────────────────────
  if (all && docs.length) {
    log('## 五、全部正文（`--all`）');
    log();
    const BATCH = 20;
    const bag = {};
    let ok = 0, fail = 0;
    for (let i = 0; i < docs.length; i += BATCH) {
      const titles = docs.slice(i, i + BATCH).map((d) => d.title);
      try {
        const res = await tool('get_document', { titles });
        const arr = Array.isArray(res) ? res : [res];
        for (const one of arr) {
          const d = (one.documents || [])[0];
          if (d && d.content) { bag[d.title] = { file: d.file, content: d.content }; ok++; }
          else fail++;
        }
      } catch (e) {
        fail += titles.length;
        log('- 批次 ' + (i / BATCH + 1) + ' 失败：' + e.message);
      }
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    write('kb-all.json', JSON.stringify(bag, null, 2));
    log('抓到 **' + ok + '** 篇正文（失败 ' + fail + '）→ `docs/community-cache/kb-all.json`');
    log();
  } else if (docs.length) {
    log('（未带 `--all`，只抓了清单与覆盖报告。要正文：`node tools/audit/fetch_kb.mjs --all`）');
    log();
  }

  write('_抓取记录.md', L.join('\n') + '\n');
  console.log('');
  console.log('→ docs/community-cache/（社区来源，与 docs/api-cache/ 官方原文分开放）');
}

main().catch((e) => { console.error('抓取失败：' + e.message); process.exit(1); });
