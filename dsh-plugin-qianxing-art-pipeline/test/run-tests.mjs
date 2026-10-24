#!/usr/bin/env node
// 离线验收：不依赖 DSH 运行环境，用 mock ctx 加载本插件并逐个调用 8 个工具。
//
//   node test/run-tests.mjs [--workspace=<根>] [--only=<子串>] [--keep]
//
// 黄金样本（字节级）：
//   S4：547 容器 + 雕像 381 层 → SHA256 == 仓库 551 容器
//   S5：551 容器 + dist/client_script.lua + v332 → SHA256 == 仓库 552 最终档
// 缺失的本机素材用例会 SKIP（不判失败），其余全绿才退出码 0。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d = '') => {
  const hit = argv.find((s) => s.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const WORKSPACE = path.resolve(argOf('workspace', path.resolve(PLUGIN_DIR, '..')))
const ONLY = argOf('only')
const KEEP = argv.includes('--keep')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'art-pipeline-test-'))

// ── 黄金常量（与仓库交付档一致）────────────────────────────────────────────
const WRITE_GOLDEN_SHA = 'CBCDCD9C294E2FD2F4F7FA48C53CA6D169F7585C3B28510E833FF664D76ACBFE'
const EMBED_GOLDEN_SHA = 'AA3986A1A898D5FDAA666E7B87C2747BABFC56651D79F2461E5BFF04A2FDEB29'
const GIL_547 = 'qianxing-murdoku/547-一二关美术-容器-v19.gil'
const GIL_551 = 'qianxing-murdoku/551-一二关美术-容器-v21.gil'
const GIL_552 = 'qianxing-murdoku/552-一二关美术-v332.gil'
const DIST_LUA = 'qianxing-murdoku/dist/client_script.lua'
const STATUE_LAYERS = '_work/art-tools/art_v332g_statue.json'
const FURN_SPEC = 'qianxing-murdoku-tool/art/specs/furniture_templates.json'
const LEVEL_DEMO = 'qianxing-murdoku-tool/art/examples/level-demo.json'
const STATUE_ICON = '_work/art-ref/render/icons-colored/statue__secret-lab.png'
const REF_ART = 'qianxing-murdoku-tool/art/tools'

const abs = (rel) => path.resolve(WORKSPACE, rel)
const has = (rel) => fs.existsSync(abs(rel))
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
const tmp = (name) => path.join(TMP, name)

// ── 极简测试框架 ────────────────────────────────────────────────────────────
const results = []
let current = null
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return
  const started = Date.now()
  current = { name, started }
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  PASS  ${name}  (${Date.now() - started}ms)`)
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, err })
    console.log(`  FAIL  ${name}  (${Date.now() - started}ms)\n        ${String(err && err.message ? err.message : err).split('\n').join('\n        ')}`)
  } finally {
    current = null
  }
}
function skip(name, why) {
  if (ONLY && !name.includes(ONLY)) return
  console.log(`  SKIP  ${name}  (${why})`)
  results.push({ name, ok: true, skipped: true, ms: 0 })
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}
function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实得：${JSON.stringify(actual)}`)
}
function assertCode(err, code) {
  const text = String(err && err.message ? err.message : err)
  assert(text.includes(`[${code}]`), `期望错误码 ${code}，实得：${text.slice(0, 300)}`)
}

// ── mock ctx 加载插件 ───────────────────────────────────────────────────────
async function loadPlugin(config) {
  const tools = new Map()
  const skills = new Map()
  const ctx = {
    tools: { register(def) { assert(!tools.has(def.name), `重复注册工具 ${def.name}`); tools.set(def.name, def); return () => tools.delete(def.name) } },
    skills: { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name) } },
    effect() { return () => {} },
    on() { return () => {} },
  }
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'index.js')).href)
  mod.apply(ctx, config)
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: WORKSPACE } } },
  }
  return { mod, tools, skills, exec }
}

const call = (plugin, name, args) => plugin.tools.get(name).execute(args, plugin.exec)

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`== dsh-plugin-qianxing-art-pipeline 离线验收 ==`)
  console.log(`   插件：${PLUGIN_DIR}`)
  console.log(`   工作区：${WORKSPACE}`)
  console.log(`   临时目录：${TMP}\n`)

  const plugin = await loadPlugin({})
  const { tools, skills } = plugin

  // 1. 注册与 schema ---------------------------------------------------------
  await test('registration: 8 个 art_* 工具 + 1 个技能', async () => {
    const names = [...tools.keys()].sort()
    const want = ['art_build_spec', 'art_decompose', 'art_embed_script', 'art_inspect', 'art_preview', 'art_slice', 'art_validate', 'art_write_gil']
    assertEq(JSON.stringify(names), JSON.stringify(want), '工具集合')
    assertEq([...skills.keys()].join(','), 'murdoku-art-pipeline', '技能')
    assert(String(skills.get('murdoku-art-pipeline').content).includes('art_write_gil'), '技能正文应指向工具')
    for (const name of names) {
      const def = tools.get(name)
      assert(def.description && def.description.length > 30, `${name} 缺 description`)
      assert(def.parameters && def.parameters.type === 'object', `${name} parameters 必须是 object schema`)
      assert(typeof def.output.render === 'function', `${name} 缺 output.render`)
      assert(typeof def.execute === 'function', `${name} 缺 execute`)
    }
  })

  await test('schema: parameters 是供应商合法 JSON Schema（不得出现 type:"json"）', async () => {
    const ALLOWED = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
    const problems = []
    const walk = (node, where) => {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) { problems.push(`${where} 不是 schema 对象`); return }
      if (Object.hasOwn(node, 'type') && !ALLOWED.has(node.type)) problems.push(`${where}.type=${JSON.stringify(node.type)} 不是标准 JSON Schema 类型`)
      if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
        for (const [key, propSchema] of Object.entries(node.properties)) walk(propSchema, `${where}.properties.${key}`)
      }
      if (node.items) walk(node.items, `${where}.items`)
      for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (Array.isArray(node[key])) node[key].forEach((branch, i) => walk(branch, `${where}.${key}[${i}]`))
      }
    }
    for (const [name, def] of tools) walk(def.parameters, name)
    assertEq(problems.join(' | '), '', '非法 schema')
    // 注册表要求 parameters 可无损 JSON 化：投影不得把函数/undefined 带进 schema。
    for (const [name, def] of tools) {
      assertEq(JSON.stringify(JSON.parse(JSON.stringify(def.parameters))), JSON.stringify(def.parameters), `${name} parameters 必须可无损 JSON 化`)
    }
  })

  await test('schema: 「任意 JSON」参数保留说明且不再声明 type', async () => {
    const anyJsonParams = [
      ['art_decompose', 'records'],
      ['art_build_spec', 'templates'],
      ['art_build_spec', 'source'],
      ['art_slice', 'layout'],
      ['art_preview', 'spec'],
      ['art_preview', 'layout'],
      ['art_validate', 'value'],
      ['art_write_gil', 'job'],
      ['art_embed_script', 'job'],
    ]
    for (const [tool, prop] of anyJsonParams) {
      const schema = tools.get(tool).parameters.properties[prop]
      assert(schema, `${tool}.${prop} 应存在`)
      assert(!Object.hasOwn(schema, 'type'), `${tool}.${prop} 不得再声明 type（供应商会以 INVALID_REQUEST 拒绝整轮请求）`)
      assert(typeof schema.description === 'string' && schema.description.length > 4, `${tool}.${prop} 应保留 description 供模型理解`)
    }
  })

  await test('schema: 非标准 type 在注册前抛错，json 投影为纯注解', async () => {
    const { providerParameters } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'define.js')).href)
    let message = ''
    try { providerParameters({ type: 'object', properties: { x: { type: 'date' } } }) } catch (err) { message = String(err && err.message ? err.message : err) }
    assert(message.includes('date'), `非标准 type 应抛错，实得：${message || '无错误'}`)
    const projected = providerParameters({ type: 'object', properties: { x: { type: 'json', description: '任何' } }, required: ['x'] })
    assertEq(JSON.stringify(projected), JSON.stringify({ type: 'object', properties: { x: { description: '任何' } }, required: ['x'] }), 'json 投影结果')
  })

  await test('args: 缺 kind 抛 E_ARGS；非法 enum 抛 E_ARGS', async () => {
    try { await call(plugin, 'art_decompose', {}); throw new Error('应当抛错') } catch (err) { assertCode(err, 'E_ARGS') }
    try { await call(plugin, 'art_decompose', { kind: 'spaceship' }); throw new Error('应当抛错') } catch (err) { assertCode(err, 'E_ARGS') }
  })

  // 2. S2 规格构建 -----------------------------------------------------------
  await test('S2 art_build_spec: 8 模板层表 → ArtSpecSet 规范化 + 校验通过', async () => {
    if (!has(FURN_SPEC)) return skip('S2 art_build_spec', '缺 furniture_templates.json')
    const doc = JSON.parse(fs.readFileSync(abs(FURN_SPEC), 'utf8'))
    const out = tmp('spec-built.json')
    const res = await call(plugin, 'art_build_spec', { templates: doc.templates, name: 'v310-rebuild', source: { mode: 'hand' }, out })
    assertEq(res.spec.version, 1, 'spec.version')
    assertEq(res.spec.cellTemplatePx, 108, 'cellTemplatePx')
    assertEq(Object.keys(res.spec.templates).length, 8, '模板数')
    for (const [name, tpl] of Object.entries(res.spec.templates)) {
      assertEq(tpl.layerCount, tpl.layers.length, `${name} layerCount`)
      tpl.layers.forEach((layer, i) => {
        assertEq(layer.order, i + 1, `${name} L${i + 1} order`)
        assert(/^0x[0-9A-F]{8}$/.test(layer.color), `${name} L${i + 1} 颜色格式 ${layer.color}`)
        assertEq(layer.y_up, -layer.dy_down, `${name} L${i + 1} y_up`)
      })
    }
    assert(fs.existsSync(out), '应写出 ArtSpecSet')
    const report = await call(plugin, 'art_validate', { target: 'spec', value: out })
    assertEq(report.ok, true, '规格校验 ok')
  })

  await test('S2 art_build_spec: 非法 imageId → E_SPEC_INVALID', async () => {
    try {
      await call(plugin, 'art_build_spec', {
        templates: [{ template: 'furn.chair', kind: 'chair', sizePx: [108, 108], layers: [{ order: 1, imageId: 999999, color: '0xFFFFFFFF', w: 10, h: 10, dx: 0, dy_down: 0 }] }],
      })
      throw new Error('应当抛错')
    } catch (err) { assertCode(err, 'E_SPEC_INVALID') }
  })

  // 3. S3 切件 ---------------------------------------------------------------
  await test('S3 art_slice: 契约口径 rug.2/rug.3/h2/v2 + 旧参考实现逐字段一致（single 口径）', async () => {
    // ① 契约口径（交接包 04 §4 / 07 坑19：运行时 v320+ 需要 rug.2/rug.3；旧参考工具未跟进）
    const contractLayout = {
      version: 1,
      name: 'slice-contract',
      rows: 4,
      cols: 3,
      cells: ['000', '000', '000', '000'],
      rooms: [{ id: 0, name: '房', color: '#D9CDB4' }],
      objects: [
        { name: '横毯', kind: 'carpet', cells: [[1, 1], [1, 2]] },
        { name: '竖毯', kind: 'carpet', cells: [[2, 3], [3, 3]] },
        { name: '单毯', kind: 'carpet', cells: [[4, 3]] },
        { name: '横桌', kind: 'table', cells: [[2, 1], [2, 2]] },
        { name: '竖桌', kind: 'table', cells: [[3, 1], [4, 1]] },
      ],
    }
    const contract = await call(plugin, 'art_slice', { layout: contractLayout })
    const keyOf = (name) => contract.pieces.find((p) => p.name === name)?.templateKey
    assertEq(keyOf('横毯'), 'furn.rug.2', '横跨地毯应映射 furn.rug.2')
    assertEq(keyOf('竖毯'), 'furn.rug.3', '竖跨地毯应映射 furn.rug.3')
    assertEq(keyOf('单毯'), 'furn.rug', '单格地毯应映射 furn.rug')
    assertEq(keyOf('横桌'), 'furn.table.h2', '横桌应映射 furn.table.h2')
    assertEq(keyOf('竖桌'), 'furn.table.v2', '竖桌应映射 furn.table.v2')
    // ② 与旧参考实现逐字段一致（single 口径：参考工具一律 furn.rug）
    if (!has(LEVEL_DEMO)) return skip('S3 art_slice 参考比对', '缺 level-demo.json')
    const res = await call(plugin, 'art_slice', { layout: LEVEL_DEMO, carpetTemplate: 'single', out: tmp('slice.json') })
    assert(Array.isArray(res.pieces) && res.pieces.length > 0, 'pieces 非空')
    assertEq(res.version, 1, 'slice.version')
    const refScript = abs(`${REF_ART}/slice-layout.mjs`)
    if (fs.existsSync(refScript)) {
      const refOut = tmp('slice-ref.json')
      const run = spawnSync(process.execPath, [refScript, `--layout=${abs(LEVEL_DEMO)}`, `--out=${refOut}`], { encoding: 'utf8' })
      assertEq(run.status, 0, `参考 slice-layout 退出码 (${run.stderr || ''})`)
      const ref = JSON.parse(fs.readFileSync(refOut, 'utf8'))
      const norm = (p) => ({ name: p.name, kind: p.kind, templateKey: p.templateKey, anchor: p.anchor, span: p.span, offsetCells: p.offsetCells })
      assertEq(JSON.stringify(res.pieces.map(norm)), JSON.stringify(ref.pieces.map(norm)), '切件结果与参考实现')
    } else {
      console.log('        （跳过参考实现比对：缺 slice-layout.mjs）')
    }
  })

  // 4. S3 预览 ---------------------------------------------------------------
  await test('S3 art_preview: 1600×900 SVG + 与参考渲染器逐图元一致 + auto 回退说明', async () => {
    if (!has(FURN_SPEC) || !has(LEVEL_DEMO)) return skip('S3 art_preview', '缺 spec/layout')
    // ① single 口径：与参考 render-preview.mjs 完全同口径，逐图元几何比对
    const out = tmp('preview.svg')
    const res = await call(plugin, 'art_preview', { spec: FURN_SPEC, layout: LEVEL_DEMO, out, carpetTemplate: 'single' })
    assert(fs.existsSync(out), '应写出 SVG')
    const svg = fs.readFileSync(out, 'utf8')
    assert(svg.includes('width="1600"') && svg.includes('height="900"'), '画布应为 1600×900')
    assertEq(res.report.ok, true, '预览 report.ok')
    assertEq(res.report.version, 1, 'report.version')
    assert(Array.isArray(res.report.checks) && res.report.checks.length > 0, 'report.checks 非空')
    const rects = (svg.match(/<rect /g) || []).length
    const ellipses = (svg.match(/<ellipse /g) || []).length
    // 参考实现同 layout/spec 的真实图元数 = 92（背景+外框 2 + 16 房间格 + 74 家具层）
    assert(rects + ellipses >= 90, `图元数量过少（rect=${rects}, ellipse=${ellipses}）`)
    const refScript = abs(`${REF_ART}/render-preview.mjs`)
    if (fs.existsSync(refScript)) {
      const refOut = tmp('preview-ref.svg')
      const run = spawnSync(process.execPath, [refScript, `--layout=${abs(LEVEL_DEMO)}`, `--spec=${abs(FURN_SPEC)}`, `--out=${refOut}`, '--no-labels'], { encoding: 'utf8' })
      assertEq(run.status, 0, `参考 render-preview 退出码 (${run.stderr || ''})`)
      const extract = (text) => [...text.matchAll(/<(rect|ellipse)\s([^>]*)\/?>/g)]
        .map((m) => m[2].replace(/\s+/g, ' ').trim())
        .filter((attrs) => !attrs.includes('width="100%"'))
        .map((attrs) => attrs.replace(/(x|y|cx|cy|width|height|rx|ry)="([^"]+)"/g, (_s, k, v) => `${k}=${Number(Number(v).toFixed(2))}`))
      const mine = extract(svg)
      const ref = extract(fs.readFileSync(refOut, 'utf8'))
      assertEq(mine.length, ref.length, '图元数量与参考渲染器')
      let mismatch = 0
      for (let i = 0; i < mine.length; i++) if (mine[i] !== ref[i]) mismatch++
      assertEq(mismatch, 0, `图元几何与参考渲染器不一致数（共 ${mine.length}）`)
    }
    // ② auto 口径（默认）：基线 spec 只有 furn.rug，跨格地毯应回退渲染并在 warnings 里说明（不许静默）
    const outAuto = tmp('preview-auto.svg')
    const resAuto = await call(plugin, 'art_preview', { spec: FURN_SPEC, layout: LEVEL_DEMO, out: outAuto })
    assertEq(resAuto.report.ok, true, 'auto 模式预览 report.ok')
    assert(fs.existsSync(outAuto), 'auto 模式应写出 SVG')
    const warnings = resAuto.report.warnings || resAuto.warnings || []
    assert(Array.isArray(warnings) && warnings.length > 0, 'auto 模式缺 rug.2/rug.3 时必须在 report.warnings 说明回退')
    assert(warnings.some((w) => /rug|地毯/i.test(String(w))), `warnings 应提到地毯/rug：${JSON.stringify(warnings)}`)
  })

  // 5. S4 写入器（黄金字节级）------------------------------------------------
  const statueJob = () => {
    const doc = JSON.parse(fs.readFileSync(abs(STATUE_LAYERS), 'utf8'))
    const layers = doc.templates['furn.statue'].layers
    assertEq(layers.length, 381, '雕像层数')
    return { version: 1, base: GIL_547, out: '', ops: [{ op: 'replace_template_layers', template: 'furn.statue', sizePx: [108, 108], layers }], expect: { records: 1491, templates: { 'furn.statue': 103 } } }
  }

  await test('S4 art_write_gil: 547 + 雕像 381 层 → SHA256 == 仓库 551（字节级）', async () => {
    if (!has(GIL_547) || !has(STATUE_LAYERS)) return skip('S4 art_write_gil', '缺 547/雕像层数')
    const out = tmp('write-551.gil')
    const job = { ...statueJob(), out }
    const report = await call(plugin, 'art_write_gil', { job })
    assertEq(sha256(out), WRITE_GOLDEN_SHA, '输出 SHA256 必须等于仓库 551 容器')
    assertEq(report.records.before, 1491, 'records.before')
    assertEq(report.records.after, 2047, 'records.after')
    const tpl = report.templates['furn.statue']
    assert(tpl, '报告缺 furn.statue')
    assertEq(tpl.layers, 381, 'statue layers')
    assertEq(tpl.motherLayers, 381, 'statue motherLayers')
    assertEq(report.gates.reread, true, 'gate reread')
    assertEq(report.gates.roundtrip, true, 'gate roundtrip')
    assertEq(report.gates.deterministic, true, 'gate deterministic')
    assertEq(report.gates.idempotent, false, '本次不是幂等路径')
    assertEq(report.gates.collision, 0, '真撞号')
    assertEq(report.gates.thingsRefs.missing.length, 0, 'things 引用缺失')
  })

  await test('S4 幂等：551 已是 381 层 → 原样复制，SHA 不变', async () => {
    if (!has(GIL_551) || !has(STATUE_LAYERS)) return skip('S4 幂等', '缺 551')
    const out = tmp('write-idem.gil')
    const job = { ...statueJob(), base: GIL_551, out, expect: { records: 2047 } }
    const report = await call(plugin, 'art_write_gil', { job })
    assertEq(report.gates.idempotent, true, 'gates.idempotent')
    assertEq(sha256(out), sha256(abs(GIL_551)), '幂等输出应与 base 逐字节相同')
  })

  await test('S4 确定性：同一 job 连跑两次 SHA 相同', async () => {
    if (!has(GIL_547) || !has(STATUE_LAYERS)) return skip('S4 确定性', '缺 547')
    const a = tmp('write-det-a.gil')
    const b = tmp('write-det-b.gil')
    await call(plugin, 'art_write_gil', { job: { ...statueJob(), out: a } })
    await call(plugin, 'art_write_gil', { job: { ...statueJob(), out: b } })
    assertEq(sha256(a), sha256(b), '两次输出 SHA')
  })

  await test('S4 事务：expect 不符 → E_BASE_MISMATCH；out==base → E_PATH 且 base 未动', async () => {
    if (!has(GIL_547)) return skip('S4 事务错误', '缺 547')
    const before = sha256(abs(GIL_547))
    const out = tmp('write-bad.gil')
    try {
      await call(plugin, 'art_write_gil', { job: { ...statueJob(), out, expect: { records: 9999 } } })
      throw new Error('应当抛 E_BASE_MISMATCH')
    } catch (err) { assertCode(err, 'E_BASE_MISMATCH') }
    assert(!fs.existsSync(out), '失败时不应留下输出文件')
    try {
      await call(plugin, 'art_write_gil', { job: { ...statueJob(), out: GIL_547 } })
      throw new Error('应当抛 E_PATH')
    } catch (err) { assertCode(err, 'E_PATH') }
    assertEq(sha256(abs(GIL_547)), before, 'base 不应被改动')
  })

  // 6. S5 嵌入（黄金字节级）-------------------------------------------------
  await test('S5 art_embed_script: 551 + dist v332 → SHA256 == 仓库 552（字节级）', async () => {
    if (!has(GIL_551) || !has(DIST_LUA)) return skip('S5 art_embed_script', '缺 551/dist')
    const out = tmp('embed-552.gil')
    const job = { version: 1, container: GIL_551, script: DIST_LUA, out, expectMarker: 'v332' }
    const report = await call(plugin, 'art_embed_script', { job })
    assertEq(sha256(out), EMBED_GOLDEN_SHA, '输出 SHA256 必须等于仓库 552 最终档')
    assertEq(report.match, true, 'match')
    assertEq(report.marker, 'v332', 'marker')
    assertEq(report.distMarker, 'v332', 'distMarker')
    assertEq(report.embeddedBytes, 1540088, 'embeddedBytes')
  })

  await test('S5 BOM：带 BOM 的脚本副本 → 自动剥离，输出 SHA 不变', async () => {
    if (!has(GIL_551) || !has(DIST_LUA)) return skip('S5 BOM', '缺 551/dist')
    const bomScript = tmp('script-bom.lua')
    fs.writeFileSync(bomScript, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(abs(DIST_LUA))]))
    const out = tmp('embed-bom.gil')
    const report = await call(plugin, 'art_embed_script', { job: { version: 1, container: GIL_551, script: bomScript, out, expectMarker: 'v332' } })
    assertEq(report.removedBom, true, 'removedBom')
    assertEq(sha256(out), EMBED_GOLDEN_SHA, '剥离 BOM 后输出应与黄金一致')
  })

  await test('S5 标记链：expectMarker 不匹配 → E_MARKER 且不产出文件', async () => {
    if (!has(GIL_551) || !has(DIST_LUA)) return skip('S5 标记链', '缺 551/dist')
    const out = tmp('embed-bad.gil')
    try {
      await call(plugin, 'art_embed_script', { job: { version: 1, container: GIL_551, script: DIST_LUA, out, expectMarker: 'v331' } })
      throw new Error('应当抛 E_MARKER')
    } catch (err) { assertCode(err, 'E_MARKER') }
    assert(!fs.existsSync(out), '失败时不应留下输出文件')
  })

  // 7. S6 结构清单 -----------------------------------------------------------
  await test('S6 art_inspect: 551 容器结构读数', async () => {
    if (!has(GIL_551)) return skip('S6 inspect 551', '缺 551')
    const res = await call(plugin, 'art_inspect', { gil: GIL_551 })
    assertEq(res.records, 2047, 'records')
    assertEq(res.collisions, 0, 'collisions')
    assertEq(res.templates.length, 10, '模板数')
    const statue = res.templates.find((t) => t.name === 'furn.statue')
    assert(statue, '缺 furn.statue 模板')
    assertEq(statue.layers, 381, 'statue layers')
    assertEq(statue.motherLayers, 381, 'statue motherLayers')
    assertEq(JSON.stringify(statue.canvas), JSON.stringify([108, 108]), 'statue 画布')
    assertEq(res.things.count, 10, 'things 子控件数')
    assert(res.things.refs.every((r) => r.ok), 'things 引用应全部指向模板源')
    // 551 是「写入器产物」，但它是从 547 继承来的容器：内嵌脚本仍是最旧的 v324（1531678B）。
    // 「不含新脚本」≠「没有脚本」——inspector 必须报事实，不许报 null 掩盖。
    assertEq(res.markers.embedded, 'v324', '551 继承的旧内嵌标记')
    assertEq(res.markers.bytes, 1531678, '551 旧内嵌脚本字节数')
  })

  await test('S6 art_inspect: 552 最终档标记 v332 + 字节数', async () => {
    if (!has(GIL_552)) return skip('S6 inspect 552', '缺 552')
    const res = await call(plugin, 'art_inspect', { gil: GIL_552 })
    assertEq(res.markers.embedded, 'v332', '内嵌标记')
    assertEq(res.markers.bytes, 1540088, '内嵌字节数')
    assertEq(res.records, 2047, 'records')
  })

  // 8. 共用校验 --------------------------------------------------------------
  await test('art_validate: job 合法 ok；缺 out 报错；gil 551/552 都 ok', async () => {
    const good = { version: 1, base: GIL_547, out: tmp('x.gil'), ops: [{ op: 'replace_template_layers', template: 'furn.statue', layers: [] }] }
    const okJob = await call(plugin, 'art_validate', { target: 'job', value: good })
    assertEq(okJob.ok, true, '合法 job')
    const badJob = await call(plugin, 'art_validate', { target: 'job', value: { version: 1, base: GIL_547, out: '', ops: [] } })
    assertEq(badJob.ok, false, '非法 job 应 ok=false')
    assert(badJob.checks.some((c) => !c.ok), '非法 job 应报出失败检查')
    if (has(GIL_551)) assertEq((await call(plugin, 'art_validate', { target: 'gil', value: GIL_551 })).ok, true, '551 校验')
    if (has(GIL_552)) assertEq((await call(plugin, 'art_validate', { target: 'gil', value: GIL_552 })).ok, true, '552 校验')
  })

  // 9. S1 图元拆解 -----------------------------------------------------------
  await test('S1 art_decompose: 雕像图标 → 381 级块（空洞/重叠/越界 0，MAE 达标）', async () => {
    if (!has(STATUE_ICON)) return skip('S1 art_decompose', '缺参考图')
    const out = tmp('statue-spec.json')
    const res = await call(plugin, 'art_decompose', { icon: STATUE_ICON, kind: 'statue', size: [56, 91], mode: 'compress', quantize: 8, std: 2, out })
    assert(fs.existsSync(out), '应写出 ArtSpecSet')
    assertEq(res.spec.version, 1, 'spec.version')
    const tpl = res.spec.templates['furn.statue']
    assert(tpl, '缺 furn.statue 模板')
    assertEq(JSON.stringify(tpl.sizePx), JSON.stringify([108, 108]), 'sizePx')
    assert(tpl.layers.length >= 300 && tpl.layers.length <= 500, `块数应在 300~500（实得 ${tpl.layers.length}）`)
    assertEq(res.stats.holes, 0, '空洞')
    assertEq(res.stats.overlaps, 0, '重叠')
    assertEq(res.stats.outOfBounds, 0, '越界')
    assert(res.stats.mae <= 0.08, `MAE 应 ≤ 0.08（实得 ${res.stats.mae}）`)
    tpl.layers.forEach((l, i) => {
      assertEq(l.order, i + 1, `L${i + 1} order`)
      assertEq(l.imageId, 100001, `L${i + 1} imageId`)
      assert(/^0xFF[0-9A-F]{6}$/.test(l.color), `L${i + 1} color ${l.color}`)
      assert(l.w > 0 && l.h > 0, `L${i + 1} 尺寸`)
      assert(Math.abs(l.y_up + l.dy_down) < 0.011, `L${i + 1} y_up`)
    })
    const report = await call(plugin, 'art_validate', { target: 'spec', value: out })
    assertEq(report.ok, true, '拆解产物校验')
  })

  await test('S1 art_decompose: records 模式（格单位）换算正确', async () => {
    const res = await call(plugin, 'art_decompose', {
      kind: 'chair',
      mode: 'records',
      units: 'cell',
      records: [
        { imageId: 100001, color: '0xFFAD9C67', w: 0.5, h: 0.1, dx: 0, dy_down: 0.2, rotDeg: 0 },
        { imageId: 100002, color: '0xFF1F1A14', w: 0.2, h: 0.2, dx: 0.2, dy_down: -0.1, rotDeg: 0 },
      ],
    })
    const layers = res.spec.templates['furn.chair'].layers
    assertEq(layers.length, 2, '层数')
    assertEq(layers[0].w, 54, 'w=0.5 格 ×108')
    assertEq(layers[0].dy_down, 21.6, 'dy_down=0.2 格 ×108')
    assertEq(layers[0].y_up, -21.6, 'y_up 取反')
  })

  // 10. workspaceRoot 配置 ---------------------------------------------------
  await test('config.workspaceRoot: 相对路径按配置解析（不依赖 exec.cwd）', async () => {
    if (!has(FURN_SPEC)) return skip('config.workspaceRoot', '缺 furniture_templates.json')
    const configured = await loadPlugin({ workspaceRoot: WORKSPACE })
    const res = await configured.tools.get('art_validate').execute({ target: 'spec', value: FURN_SPEC }, { signal: new AbortController().signal })
    assertEq(res.ok, true, '按配置根解析相对路径')
  })

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped)
  console.log(`\n== 结果：${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped ==`)
  if (!KEEP) {
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  } else {
    console.log(`（--keep：临时目录保留在 ${TMP}）`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n测试运行器自身失败：', err)
  process.exit(2)
})
