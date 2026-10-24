#!/usr/bin/env node
// 宿主输出闸门预检（开发期用，也可以作为发布前自查）：
// DSH 的工具结果必须通过 `snapshotJsonValue`（无损 JSON）——一旦含 -0 / undefined /
// NaN / 非普通对象，宿主会报 `tool "x" returned invalid output: value is not lossless JSON`。
// 离线验收用 mock ctx 不会走到这一步，所以这里单独复刻宿主校验。
//
//   node test/check-host-output.mjs [--workspace=<根>] [--app=<DSH app 目录>]
//
// 找不到 @deepseek-ai/dsh-util-values 时自动 SKIP（不判失败）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d = '') => {
  const hit = argv.find((s) => s.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const WORKSPACE = path.resolve(argOf('workspace', path.resolve(PLUGIN_DIR, '..')))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'art-host-output-'))
const abs = (rel) => path.resolve(WORKSPACE, rel)

const CANDIDATES = [
  argOf('app'),
  process.env.DSH_APP_ROOT,
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DSH Desktop', 'resources', 'app'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app'),
  '/Applications/DeepSeek Harness.app/Contents/Resources/app',
].filter(Boolean)

function findUtilValues() {
  for (const app of CANDIDATES) {
    const p = path.join(app, 'node_modules', '@deepseek-ai', 'dsh-util-values', 'lib', 'index.js')
    if (fs.existsSync(p)) return p
  }
  return null
}

// 找出第一个违反「无损 JSON」规则的位置（规则与宿主 walkJsonValue 对齐）
function findViolation(value, pathStr = 'value', ancestors = new Set()) {
  if (value === null) return null
  const t = typeof value
  if (t === 'boolean' || t === 'string') return null
  if (t === 'number') {
    if (!Number.isFinite(value)) return `${pathStr} = ${value}（非有限数）`
    if (Object.is(value, -0)) return `${pathStr} = -0（负零，JSON 往返会变成 0）`
    return null
  }
  if (t !== 'object') return `${pathStr} = ${t}（不可序列化）`
  if (ancestors.has(value)) return `${pathStr} 循环引用`
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) return `${pathStr}[${i}] 空洞数组项`
        const hit = findViolation(value[i], `${pathStr}[${i}]`, ancestors)
        if (hit) return hit
      }
      return null
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return `${pathStr} 不是普通对象（${value.constructor?.name || proto}）`
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) return `${pathStr}.${key} = undefined（JSON 会丢字段）`
      const hit = findViolation(value[key], `${pathStr}.${key}`, ancestors)
      if (hit) return hit
    }
    return null
  } finally {
    ancestors.delete(value)
  }
}

async function main() {
  const utilPath = findUtilValues()
  if (!utilPath) {
    console.log('SKIP  check-host-output：找不到 @deepseek-ai/dsh-util-values（不在 DSH 装机目录旁运行）')
    return
  }
  const { snapshotJsonValue } = await import(pathToFileURL(utilPath).href)
  console.log(`== 宿主输出闸门预检 ==\n   插件：${PLUGIN_DIR}\n   校验器：${utilPath}\n`)

  const tools = new Map()
  const ctx = {
    tools: { register(d) { tools.set(d.name, d); return () => {} } },
    skills: { register() { return () => {} } },
  }
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'index.js')).href)
  mod.apply(ctx, {})
  const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: WORKSPACE } } } }
  const call = (name, args) => tools.get(name).execute(args, exec)

  const statueJob = {
    version: 1,
    base: 'qianxing-murdoku/547-一二关美术-容器-v19.gil',
    out: path.join(TMP, 'out-551.gil'),
    ops: [{ op: 'replace_template_layers', template: 'furn.statue', sizePx: [108, 108], layers: JSON.parse(fs.readFileSync(abs('_work/art-tools/art_v332g_statue.json'), 'utf8')).templates['furn.statue'].layers }],
    expect: { records: 1491, templates: { 'furn.statue': 103 } },
  }
  const cases = [
    ['art_inspect', { gil: 'qianxing-murdoku/551-一二关美术-容器-v21.gil', limit: 5 }],
    ['art_validate', { target: 'spec', value: 'qianxing-murdoku-tool/art/specs/furniture_templates.json' }],
    ['art_slice', { layout: 'qianxing-murdoku-tool/art/examples/level-demo.json' }],
    ['art_preview', { spec: 'qianxing-murdoku-tool/art/specs/furniture_templates.json', layout: 'qianxing-murdoku-tool/art/examples/level-demo.json', out: path.join(TMP, 'preview.svg') }],
    ['art_decompose', { icon: '_work/art-ref/render/icons-colored/statue__secret-lab.png', kind: 'statue', size: [56, 91], mode: 'compress', quantize: 8, std: 2 }],
    ['art_build_spec', { templates: JSON.parse(fs.readFileSync(abs('qianxing-murdoku-tool/art/specs/furniture_templates.json'), 'utf8')).templates }],
    ['art_write_gil', { job: statueJob }],
    ['art_embed_script', { job: { version: 1, container: path.join(TMP, 'out-551.gil'), script: 'qianxing-murdoku/dist/client_script.lua', out: path.join(TMP, 'out-552.gil'), expectMarker: 'v332' } }],
  ]

  let bad = 0
  for (const [name, args] of cases) {
    try {
      const value = await call(name, args)
      const detached = snapshotJsonValue(value)
      if (detached === undefined) {
        bad++
        console.log(`  FAIL  ${name}: 宿主会报 INVALID_TOOL_OUTPUT\n        ${findViolation(value) || '（未定位，可能规则更严）'}`)
      } else {
        console.log(`  PASS  ${name}`)
      }
    } catch (err) {
      bad++
      console.log(`  FAIL  ${name}: 调用抛错 ${String(err && err.message ? err.message : err).slice(0, 300)}`)
    }
  }
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(`\n== ${cases.length - bad} passed, ${bad} failed ==`)
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('check-host-output 运行失败：', err)
  process.exit(2)
})
