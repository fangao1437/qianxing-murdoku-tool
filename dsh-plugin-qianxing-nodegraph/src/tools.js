// 工具注册层：6 个工具包住 vendor/qianxing-murdoku-tool 的 CLI + genshin-ts 注入器。
// 零依赖：只用 node: 内建模块；schema 走 define.js 的供应商投影。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineArtTool } from './define.js'

const VENDOR = fileURLToPath(new URL('../vendor/', import.meta.url))
const PATH = (description) => ({ type: 'string', description })

function resolveOutdir(config, given) {
  const raw = (typeof given === 'string' && given.trim()) || config?.outdir || path.join(os.homedir(), '.dsh', 'qianxing-out')
  const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

function runNode(scriptRel, args, { timeoutMs = 180000, cwd = VENDOR } = {}) {
  const script = path.join(VENDOR, scriptRel)
  if (!fs.existsSync(script)) return { code: 2, stdout: '', stderr: `脚本缺失: ${script}` }
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, QX_PROJECT_ROOT: VENDOR },
  })
  return {
    code: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || (res.error ? String(res.error.message || res.error) : ''),
  }
}

function resolveWorkbench(given) {
  return (typeof given === 'string' && given.trim()) || process.env.QX_GTS_WORKBENCH || ''
}

function checkWorkbench(wb) {
  if (!wb) {
    return {
      ok: false,
      error: 'E_NO_WORKBENCH',
      hint:
        '需要 genshin-ts 工作台：mkdir -p /root/gts-workbench && cd /root/gts-workbench && npm init -y && npm i genshin-ts，' +
        '然后把 workbench=/root/gts-workbench 传进来。',
    }
  }
  const gsts = path.join(wb, 'node_modules', 'genshin-ts', 'bin', 'gsts.mjs')
  if (!fs.existsSync(gsts)) {
    return {
      ok: false,
      error: 'E_NO_WORKBENCH',
      hint: `workbench 里缺 node_modules/genshin-ts/bin/gsts.mjs：${wb}，先 npm i genshin-ts`,
    }
  }
  return { ok: true, wb, gsts }
}

function runNodeEval(code, { cwd, timeoutMs = 60000 }) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    code: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || (res.error ? String(res.error.message || res.error) : ''),
  }
}

function listFiles(dir, sinceMs = 0) {  try {
    return fs
      .readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((p) => {
        try {
          return fs.statSync(p).isFile() && fs.statSync(p).mtimeMs >= sinceMs
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

function tail(text, n = 4000) {
  const s = String(text || '')
  return s.length > n ? s.slice(-n) : s
}

function makeTool(ctx, spec) {
  ctx.tools.register(defineArtTool(spec))
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerNodegraphTools(ctx, config) {
  // ── 1. 读 .gia ──────────────────────────────────────────────────────────
  makeTool(ctx, {
    name: 'qianxing_gia_read',
    description:
      '读千星沙箱的 .gia 节点图文件：原生解码节点/连线/常量/端口名，产出 graph.json + 人类可读的 behavior-spec.md（控件层记录也会读）。' +
      '只读、不改文件。要顺带产出翻译规格时传 spec=true。.gil 的节点图段本工具读不了（会返回 layout=other）。',
    timeoutMs: 120000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        path: PATH('.gia（或 .gil）文件绝对路径。QQ 里发来的文件通常落在 ~/.dsh-qqbot/media/ 下'),
        spec: { type: 'boolean', description: '是否顺带翻译成行为规格（默认 false）' },
        outdir: PATH('可选：产物目录（默认 ~/.dsh/qianxing-out）'),
      },
      ['path'],
    ),
    run: (args) => {
      const file = path.resolve(args.path)
      if (!fs.existsSync(file)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: file }
      const outdir = resolveOutdir(config, args.outdir)
      const started = Date.now()
      const argv = [`--gil=${file}`, `--outdir=${outdir}`]
      if (args.spec === true) argv.push('--spec')
      const r = runNode('src/read.mjs', argv)
      const artifacts = listFiles(outdir, started)
      return {
        ok: r.code === 0,
        exit: r.code,
        stdout: tail(r.stdout),
        stderr: tail(r.stderr),
        outdir,
        artifacts,
      }
    },
  })

  // ── 2. .gia → 行为规格（反向翻译） ──────────────────────────────────────
  makeTool(ctx, {
    name: 'qianxing_gia_translate',
    description:
      '把 .gia 节点图反向翻译成 emit.mjs 能消费的行为规格 JSON（spec）。能译的图才写 spec；分支/循环/枚举/列表/字典常量/复合节点等会按 BLOCKERS 分类拒绝并在 translate.json 里写明原因（退出码 2），不要当成功。',
    timeoutMs: 120000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        path: PATH('.gia 文件绝对路径'),
        outdir: PATH('可选：产物目录（默认 ~/.dsh/qianxing-out）'),
      },
      ['path'],
    ),
    run: (args) => {
      const file = path.resolve(args.path)
      if (!fs.existsSync(file)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: file }
      const outdir = resolveOutdir(config, args.outdir)
      const started = Date.now()
      const r = runNode('src/read2spec.mjs', [`--gia=${file}`, `--outdir=${outdir}`])
      return {
        ok: r.code === 0,
        exit: r.code,
        refused: r.code === 2,
        stdout: tail(r.stdout, 6000),
        stderr: tail(r.stderr),
        outdir,
        artifacts: listFiles(outdir, started),
      }
    },
  })

  // ── 3. 行为规格 → genshin-ts 源码 ───────────────────────────────────────
  makeTool(ctx, {
    name: 'qianxing_spec_emit',
    description:
      '把行为规格 JSON（qianxing_gia_translate 的产物，或手写 spec）编译成 genshin-ts 的 TypeScript 源码（人可读、可手改、可进版本库）。纯离线，不联网。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        spec: PATH('行为规格 JSON 文件绝对路径'),
        outdir: PATH('可选：产物目录（默认 ~/.dsh/qianxing-out）'),
      },
      ['spec'],
    ),
    run: (args) => {
      const spec = path.resolve(args.spec)
      if (!fs.existsSync(spec)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: spec }
      const outdir = resolveOutdir(config, args.outdir)
      const started = Date.now()
      const r = runNode('src/emit.mjs', [`--spec=${spec}`, `--outdir=${outdir}`])
      const tsFiles = listFiles(outdir, started).filter((p) => p.endsWith('.ts'))
      return {
        ok: r.code === 0,
        exit: r.code,
        stdout: tail(r.stdout, 6000),
        stderr: tail(r.stderr),
        outdir,
        tsFiles,
      }
    },
  })

  // ── 4. TS → .gia（compile）→ 可选注入 .gil 副本 ────────────────────────
  makeTool(ctx, {
    name: 'qianxing_gia_build',
    description:
      '调上游 genshin-ts（MIT）把 TypeScript 编译成 .gia；可选 --copy-gil 把节点图注入到 .gil 的副本（不原地改存档）。' +
      '需要服务器上有一个装了 genshin-ts 的 workbench 目录（含 node_modules/genshin-ts/bin/gsts.mjs）；没有时返回 E_NO_WORKBENCH，不会假装成功。',
    timeoutMs: 600000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        ts: PATH('TypeScript 源码绝对路径（qianxing_spec_emit 的产物）'),
        workbench: PATH('可选：装了 genshin-ts 的工作台目录；不传则用环境变量 QX_GTS_WORKBENCH'),
        copyGil: PATH('可选：要注入的 .gil 文件（脚本会复制一份再写，不改原文件）'),
        targetId: { type: 'integer', description: '可选：注入目标节点图 id（.gil 里必须已存在这个图；不传则用 .gia 自带的图 id）' },
        outdir: PATH('可选：产物目录（默认 ~/.dsh/qianxing-out）'),
      },
      ['ts'],
    ),
    run: (args) => {
      const ts = path.resolve(args.ts)
      if (!fs.existsSync(ts)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: ts }
      const workbench = (typeof args.workbench === 'string' && args.workbench.trim()) || process.env.QX_GTS_WORKBENCH || ''
      const outdir = resolveOutdir(config, args.outdir)
      if (!workbench) {
        return {
          ok: false,
          error: 'E_NO_WORKBENCH',
          hint:
            '需要 genshin-ts 工作台：mkdir -p /root/gts-workbench && cd /root/gts-workbench && npm init -y && npm i genshin-ts，' +
            '然后把 workbench=/root/gts-workbench 传进来。',
        }
      }
      const gstsBin = path.join(workbench, 'node_modules', 'genshin-ts', 'bin', 'gsts.mjs')
      if (!fs.existsSync(gstsBin)) {
        return {
          ok: false,
          error: 'E_NO_WORKBENCH',
          hint: `workbench 里缺 node_modules/genshin-ts/bin/gsts.mjs：${workbench}，先 npm i genshin-ts`,
        }
      }
      const started = Date.now()
      const argv = [`--src=${ts}`, `--workbench=${workbench}`, `--outdir=${outdir}`]
      if (typeof args.copyGil === 'string' && args.copyGil.trim()) argv.push(`--copy-gil=${path.resolve(args.copyGil)}`)
      if (Number.isFinite(Number(args.targetId))) argv.push(`--target-id=${Number(args.targetId)}`)
      const r = runNode('src/gts-build.mjs', argv, { timeoutMs: 540000, cwd: workbench })
      return {
        ok: r.code === 0,
        exit: r.code,
        stdout: tail(r.stdout, 8000),
        stderr: tail(r.stderr, 8000),
        outdir,
        artifacts: listFiles(outdir, started),
      }
    },
  })

  // ── 5. 列出 .gil 里的节点图 id（注入用） ───────────────────────────────
  makeTool(ctx, {
    name: 'qianxing_gil_graph_ids',
    description:
      '列出 .gil 存档里所有节点图 id（注入节点图时的 targetId 必须是其中之一）。只读；需要 genshin-ts 工作台来解析 .gil 内部结构。',
    timeoutMs: 90000,
    concurrencySafe: true,
    parameters: objectSchema(
      {
        gil: PATH('.gil 存档绝对路径'),
        workbench: PATH('可选：装了 genshin-ts 的工作台目录；不传则用环境变量 QX_GTS_WORKBENCH'),
      },
      ['gil'],
    ),
    run: (args) => {
      const gil = path.resolve(args.gil)
      if (!fs.existsSync(gil)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: gil }
      const wbCheck = checkWorkbench(resolveWorkbench(args.workbench))
      if (!wbCheck.ok) return wbCheck
      const code = `
import fs from 'node:fs';
import { parseMessage } from 'genshin-ts/injector/binary';
import { buildNodeGraphFieldIndex } from 'genshin-ts/injector/node_graph';
const b = fs.readFileSync(${JSON.stringify(gil)});
if (b.length < 24) { console.log('QX_IDS=[]'); process.exit(0); }
const payload = b.subarray(20, b.length - 4);
const fields = [], blobs = [];
parseMessage(payload, 0, payload.length, 0, 0, 0, 0, 0, 0, 0, fields, { nodeGraphBlobFields: blobs });
const idx = buildNodeGraphFieldIndex(payload, blobs.length ? blobs : fields);
console.log('QX_IDS=' + JSON.stringify([...idx.keys()]));
`
      const r = runNodeEval(code, { cwd: wbCheck.wb })
      const m = /QX_IDS=(\[[^\]]*\])/.exec(r.stdout)
      const ids = m ? JSON.parse(m[1]) : undefined
      const ok = r.code === 0 && Array.isArray(ids)
      return {
        ok,
        ids,
        count: Array.isArray(ids) ? ids.length : 0,
        hint: ok && ids.length === 0 ? '这个 .gil 里没有识别到节点图（可能是 UI 控件存档）。' : undefined,
        stderr: tail(r.stderr, 1500),
      }
    },
  })

  // ── 6. 离线自测 ─────────────────────────────────────────────────────────
  makeTool(ctx, {
    name: 'qianxing_selftest',
    description: '跑 vendor 工具链的离线回归（186 项，不联网、不需要 Python、不需要样本 .gia），确认插件自带的工具链完好。',
    timeoutMs: 180000,
    concurrencySafe: true,
    parameters: objectSchema({}, []),
    run: () => {
      const r = runNode('test/run-tests.mjs', [])
      const m = /通过\s*(\d+)\s*，失败\s*(\d+)/.exec(r.stdout + r.stderr)
      const pass = m ? Number(m[1]) : undefined
      const fail = m ? Number(m[2]) : undefined
      return {
        ok: r.code === 0 && fail === 0,
        exit: r.code,
        pass,
        fail,
        stdout: tail(r.stdout, 3000),
        stderr: tail(r.stderr, 2000),
      }
    },
  })
}

/** 极简 JSON Schema 构造（只用于本插件入参；defineArtTool 会做供应商投影） */
function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
