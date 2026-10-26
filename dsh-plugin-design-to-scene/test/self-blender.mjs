// S3 Blender 搭建自检（temp 目录里跑，不碰 examples / 他人文件）
//
// 覆盖：
//   A. 脚本生成：hall-demo.spec.json → emitBlenderScript
//      · 确定性（两次逐字节一致）
//      · 关键构造齐全（清场/地板合并/墙 openings 切段/材质/灯/相机/GLB/SCENE_REPORT/EEVEE）
//      · python -m py_compile 语法检查（系统 Python）
//   B. 错误路径：非法 spec → E_SPEC_INVALID；spec 输入 = outDir/spec.json → E_PATH；
//      Blender 退出码非 0（用 node 冒充 blender 模拟）→ E_INTERNAL 且 detail 带 stderr 尾巴
//   C. 有 Blender 时 headless 真跑 hall-demo：
//      scene.blend / render-top.png / render-perspective.png（>10KB）/ scene.glb 存在，
//      SCENE_REPORT 计数 objects=16 / walls=6 / floors=2，再跑一次（覆盖/确定性）
//
// 用法：node test/self-blender.mjs
// 输出：全绿打印 "SELF-BLENDER OK"；找不到 Blender 时打印 "SELF-BLENDER SKIP (no blender)"，
//       但 A/B 的脚本生成与错误路径部分仍然必须全绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalizeSceneSpec, validateSceneSpec } from '../src/scene-spec.js'
import { emitBlenderScript } from '../src/lib/blender-script.js'
import { buildSceneBlenderStage, detectBlender } from '../src/stages/build-blender.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..')
// 会话工作区 = 插件目录的上一级（本仓库约定：_vendor/blender 在工作区根下）
const WORKSPACE = path.resolve(PLUGIN_ROOT, '..')
const EXAMPLE_SPEC = path.join(PLUGIN_ROOT, 'examples', 'hall-demo.spec.json')

let passed = 0
const failures = []

function ok(name, detail) {
  passed += 1
  console.log(`ok   ${name}${detail ? '  — ' + detail : ''}`)
}

function bad(name, detail) {
  failures.push(name)
  console.log(`FAIL ${name}${detail ? '  — ' + detail : ''}`)
}

function check(name, condition, detail) {
  if (condition) ok(name, detail)
  else bad(name, detail)
  return !!condition
}

function note(text) {
  console.log(`note ${text}`)
}

/** 期望抛出指定错误码的调用。 */
async function expectError(name, expectedCode, fn) {
  try {
    const value = await fn()
    bad(name, `预期抛 ${expectedCode}，实际返回 ${JSON.stringify(value)?.slice(0, 200)}`)
  } catch (err) {
    if (err && err.code === expectedCode) ok(name, `${expectedCode}: ${err.message}`)
    else bad(name, `预期 ${expectedCode}，实际 ${err?.code || err?.name}: ${err?.message}`)
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findPython() {
  const candidates = [
    { cmd: process.env.PYTHON || '', prefix: [] },
    { cmd: 'python', prefix: [] },
    { cmd: 'py', prefix: ['-3'] },
  ]
  for (const candidate of candidates) {
    if (!candidate.cmd) continue
    const result = spawnSync(candidate.cmd, [...candidate.prefix, '-c', 'import sys; print(sys.version.split()[0])'], {
      encoding: 'utf8',
    })
    if (!result.error && result.status === 0) {
      return { cmd: candidate.cmd, prefix: candidate.prefix, version: (result.stdout || '').trim() }
    }
  }
  return null
}

/** PNG IHDR 宽高（只读前 33 字节）。 */
function pngSize(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.length < 24) return null
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function magicText(file, length = 8) {
  return fs.readFileSync(file).subarray(0, length).toString('latin1')
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

const stageEnv = { root: WORKSPACE, config: {} }

async function main() {
  console.log('=== S3 Blender 搭建自检 ===')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'self-blender-'))
  console.log(`tmp: ${tmp}`)
  try {
    // ---------------------------------------------------------------- A. 样例与脚本生成
    const rawSpec = JSON.parse(fs.readFileSync(EXAMPLE_SPEC, 'utf8'))
    const spec = normalizeSceneSpec(rawSpec)
    const validation = validateSceneSpec(spec)
    check('样例 hall-demo 可载入/规范化/校验', validation.ok, `${spec.rooms.length} 房间 / ${spec.walls.length} 墙 / ${spec.objects.length} 物件 / ${spec.lights.length} 灯`)
    const generated = emitBlenderScript(spec, { views: ['top', 'perspective'], render: true, exportGlb: true })
    const generatedAgain = emitBlenderScript(spec, { views: ['top', 'perspective'], render: true, exportGlb: true })
    check('脚本生成确定性（两次逐字节一致）', generated === generatedAgain && generated.length > 0, `${Buffer.byteLength(generated)} bytes / ${generated.split('\n').length} 行`)
    check('脚本无 JS 模板残留（${ 占位）', !generated.includes('${'))
    check('脚本是 UTF-8 文本且 LF 换行', !generated.includes('\r') && Buffer.isBuffer(Buffer.from(generated, 'utf8')))

    const requiredSnippets = [
      ['清场（删除默认对象）', 'bpy.data.objects.remove'],
      ['地板：房间 cells 合并矩形', 'merge_cells_into_rects'],
      ['地板薄板几何', 'make_box_mesh'],
      ['墙：按 from/to 长度/角度', 'math.atan2'],
      ['墙：openings 切段', 'segments.append'],
      ['墙：门顶过梁', 'opening_height'],
      ['材质：Principled BSDF', 'BSDF_PRINCIPLED'],
      ['灯：sun/point/area', 'bpy.data.lights.new'],
      ['相机：track quat', 'to_track_quat'],
      ['正交俯视相机', 'Camera_Top'],
      ['EEVEE 引擎', 'BLENDER_EEVEE_NEXT'],
      ['渲染 PNG 1280×720', 'render.render'],
      ['GLB 导出', 'export_scene.gltf'],
      ['SCENE_REPORT 行', '"SCENE_REPORT "'],
      ['命令行 --spec/--out', '--spec'],
      ['Blender 坐标映射 (x, z, y)', 'plan_to_blender'],
      ['环境光 = ambientColor × ambientStrength', 'ambientColor'],
      ['背景色合成（Alpha Over）', 'CompositorNodeAlphaOver'],
      ['top 视角翻转成设计图坐标', 'CompositorNodeFlip'],
      ['透视 cutaway（挡视线的墙）', 'cutaway_blocking_walls'],
    ]
    const missing = requiredSnippets.filter(([, snippet]) => !generated.includes(snippet)).map(([label]) => label)
    check('脚本含全部关键构造', missing.length === 0, missing.length ? `缺少：${missing.join('、')}` : `${requiredSnippets.length} 项全在`)

    // 生成脚本写到临时目录做 Python 语法检查
    const scriptPath = path.join(tmp, 'build_scene.py')
    fs.mkdirSync(tmp, { recursive: true })
    fs.writeFileSync(scriptPath, generated, 'utf8')
    const python = findPython()
    if (python) {
      const compile = spawnSync(python.cmd, [...python.prefix, '-m', 'py_compile', scriptPath], { encoding: 'utf8' })
      check('py_compile 语法检查', compile.status === 0, compile.status === 0 ? `python ${python.version}` : (compile.stderr || '').slice(0, 600))
    } else {
      note('跳过 py_compile：本机没有可用的 python（脚本生成部分其它检查已通过）')
    }

    // 选项变化也要进脚本（render=false / 自定义 views）
    const noRender = emitBlenderScript(spec, { views: ['top'], render: false, exportGlb: false })
    check('opts 生效（render=false/exportGlb=false/views=top）',
      noRender.includes('RENDER_ENABLED = False') && noRender.includes('GLB_ENABLED = False') && noRender.includes('DEFAULT_VIEWS = ["top"]'))
    const badViews = emitBlenderScript(spec, { views: ['nope', 'top', 'top'] })
    check('非法 views 被过滤并去重', badViews.includes('DEFAULT_VIEWS = ["top"]'))

    // ---------------------------------------------------------------- B. 错误路径
    const badDir = path.join(tmp, 'bad-spec')
    await expectError('非法 spec → E_SPEC_INVALID', 'E_SPEC_INVALID', () =>
      buildSceneBlenderStage({ spec: { version: 1, name: '', unit: 'm' }, outDir: badDir }, stageEnv))

    // spec 输入文件 = outDir/spec.json → 输出不得覆盖输入 → E_PATH
    const conflictDir = path.join(tmp, 'conflict')
    fs.mkdirSync(conflictDir, { recursive: true })
    const conflictSpec = path.join(conflictDir, 'spec.json')
    fs.writeFileSync(conflictSpec, JSON.stringify(rawSpec, null, 2), 'utf8')
    const conflictBefore = fs.readFileSync(conflictSpec)
    await expectError('spec 输入 = outDir/spec.json → E_PATH', 'E_PATH', () =>
      buildSceneBlenderStage({ spec: conflictSpec, outDir: conflictDir, blenderPath: process.execPath }, stageEnv))
    check('E_PATH 时没有覆盖输入文件', Buffer.compare(fs.readFileSync(conflictSpec), conflictBefore) === 0)

    // Blender 退出码非 0：用 node 冒充 blender（node 不认识 -b/-P，会非 0 退出）
    const fakeDir = path.join(tmp, 'fake-blender')
    await expectError('Blender 非 0 退出 → E_INTERNAL（detail 带 stderr 尾）', 'E_INTERNAL', () =>
      buildSceneBlenderStage({ spec: rawSpec, outDir: fakeDir, blenderPath: process.execPath }, stageEnv))

    // ---------------------------------------------------------------- C. 真跑 Blender（可用时）
    const blender = detectBlender({}, stageEnv)
    if (!blender.found) {
      note(`未找到 Blender（探测过 ${blender.attempts.length} 个候选路径）`)
      console.log('')
      console.log(`SELF-BLENDER SKIP (no blender)  — 通过 ${passed} / 失败 ${failures.length}`)
      if (failures.length > 0) process.exitCode = 1
      return
    }
    console.log(`note 找到 Blender：${blender.path}（来源 ${blender.source}）`)

    // render/exportGlb 都关：不执行 Blender、只产出 spec+脚本（executed=false，报告如实说明）
    const offDir = path.join(tmp, 'all-off')
    const offResult = await buildSceneBlenderStage(
      { spec: rawSpec, outDir: offDir, render: false, exportGlb: false },
      stageEnv,
    )
    check('render/exportGlb 都关：executed=false 且仍产出 spec+脚本',
      offResult.executed === false &&
        fileBytes(path.join(offDir, 'spec.json')) > 0 &&
        fileBytes(path.join(offDir, 'build_scene.py')) > 0,
      (offResult.report?.checks || []).find((c) => c.id === 'blender.executed')?.detail)

    const outDir = path.join(tmp, 'run-1')
    const result = await buildSceneBlenderStage(
      { spec: rawSpec, outDir, render: true, exportGlb: true },
      stageEnv,
    )
    check('Blender 真跑 executed=true', result.executed === true, `stdout 尾部 ${String(result.stdoutTail || '').length} 字符`)
    check('report.ok 且 checks 无失败',
      result.report?.ok === true && Array.isArray(result.report?.checks) && result.report.checks.every((c) => c.ok),
      result.report?.checks?.filter((c) => !c.ok).map((c) => `${c.id}:${c.detail}`).join(' | ') || `${result.report?.checks?.length || 0} 项检查全过`)

    const blendPath = path.join(outDir, 'scene.blend')
    const glbPath = path.join(outDir, 'scene.glb')
    const topPng = path.join(outDir, 'render-top.png')
    const perspectivePng = path.join(outDir, 'render-perspective.png')
    check('scene.blend 存在且非空', fileBytes(blendPath) > 0, `${fileBytes(blendPath)} bytes`)
    check('scene.blend 是 Blender 文件（BLENDER 头）', magicText(blendPath, 7) === 'BLENDER')
    check('scene.glb 存在且非空', fileBytes(glbPath) > 0, `${fileBytes(glbPath)} bytes`)
    check('scene.glb 是 glTF 二进制（glTF 头）', magicText(glbPath, 4) === 'glTF')
    check('render-top.png 存在且 > 10KB', fileBytes(topPng) > 10 * 1024, `${fileBytes(topPng)} bytes`)
    check('render-perspective.png 存在且 > 10KB', fileBytes(perspectivePng) > 10 * 1024, `${fileBytes(perspectivePng)} bytes`)
    const topSize = pngSize(topPng)
    check('渲染图尺寸 1280×720', !!topSize && topSize.width === 1280 && topSize.height === 720, topSize ? `${topSize.width}×${topSize.height}` : 'PNG 头解析失败')

    const sceneReport = result.sceneReport || {}
    check('SCENE_REPORT objects=16', sceneReport.objects === 16, String(sceneReport.objects))
    check('SCENE_REPORT walls=6', sceneReport.walls === 6, String(sceneReport.walls))
    check('SCENE_REPORT floors=2', sceneReport.floors === 2, String(sceneReport.floors))
    check('SCENE_REPORT renders 两个视角', Array.isArray(sceneReport.renders) && sceneReport.renders.length === 2,
      (sceneReport.renders || []).map((item) => item.view).join(','))
    check('SCENE_REPORT 引擎是 EEVEE 系', typeof sceneReport.engine === 'string' && sceneReport.engine.indexOf('EEVEE') >= 0, sceneReport.engine)

    // 同 spec 再跑一次：脚本/spec/GLB 应逐字节一致；EEVEE 渲染含采样抖动，PNG 允许非逐字节一致
    const outDir2 = path.join(tmp, 'run-2')
    const result2 = await buildSceneBlenderStage(
      { spec: rawSpec, outDir: outDir2, render: true, exportGlb: true },
      stageEnv,
    )
    check('同 spec 再跑一次成功（覆盖式重跑）', result2.executed === true)
    check('再跑写出的 build_scene.py / spec.json 逐字节一致',
      sha256(path.join(outDir, 'build_scene.py')) === sha256(path.join(outDir2, 'build_scene.py')) &&
        sha256(path.join(outDir, 'spec.json')) === sha256(path.join(outDir2, 'spec.json')))
    check('再跑导出的 scene.glb 逐字节一致（GLB 确定性）',
      sha256(glbPath) === sha256(path.join(outDir2, 'scene.glb')), `${fileBytes(glbPath)} bytes`)
    const topSame = sha256(topPng) === sha256(path.join(outDir2, 'render-top.png'))
    const perspectiveSame = sha256(perspectivePng) === sha256(path.join(outDir2, 'render-perspective.png'))
    if (topSame && perspectiveSame) ok('再跑的渲染图 SHA 一致')
    else note(`EEVEE 渲染含采样抖动：top ${topSame ? '一致' : '不一致'} / perspective ${perspectiveSame ? '一致' : '不一致'}，两次 PNG 均有效（GLB/脚本已证明确定性）`)

    console.log('')
    console.log(`SELF-BLENDER OK  — 通过 ${passed} / 失败 ${failures.length}（Blender: ${blender.path}）`)
  } finally {
    if (failures.length > 0) {
      console.log('')
      console.log(`SELF-BLENDER FAILED  — 失败 ${failures.length} 项：${failures.join('、')}`)
      process.exitCode = 1
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
}

main().catch((err) => {
  console.error('SELF-BLENDER FAILED — 未捕获异常：', err && err.stack ? err.stack : err)
  process.exitCode = 1
})
