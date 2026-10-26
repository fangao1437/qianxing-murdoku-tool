// S3 Blender 搭建：SceneSpec v1 → bpy 构建脚本（可选 headless 执行）→ .blend + 渲染 PNG + GLB
//
// 输入：{ spec, outDir, blenderPath?, render?(默认true), views?(默认['top','perspective']), exportGlb?(默认true) }
// 输出：
//   {
//     outDir, specPath, scriptPath,
//     blenderPath: string|null,          // 找到的 Blender（null = 没找到，按"未执行"如实报告）
//     executed: boolean,
//     blendPath?: string, glbPath?: string,
//     renders?: [{view, path, bytes}],
//     report: { ok, checks:[{id,ok,detail?}] },
//     stdoutTail?: string,
//     sceneReport?: object              // 脚本自己打印的 SCENE_REPORT（原始计数/路径，排障用）
//   }
//
// 生成脚本（build_scene.py）要求：
//   · 只依赖 bpy + mathutils（+ math/json/sys），Blender 4.x 语法；--spec/--out 从 `--` 后读，便于 headless 复用；
//   · 清空默认场景 → 建房间地板（按 rooms 合并、颜色）→ 建墙（openings 切段 + 门顶过梁，门洞不封）
//     → 按 objects 建 box/cylinder/plane，赋材质（Principled BSDF，base_color=color）→ 灯光 → 相机
//     → world 背景/环境光 → 保存 .blend → 渲染 views（EEVEE，1280×720）→ 导出 GLB；
//   · 确定性地生成（不用随机/时间戳）；脚本里所有尺寸来自 spec，不写死。
// 执行：`<blender> -b -P build_scene.py -- --spec spec.json --out outDir`；解析 stdout 里的
//   `SCENE_REPORT {json}` 行，校验产物，失败抛 E_SPEC_INVALID / E_IO / E_PATH / E_INTERNAL。
// 未找到 Blender：不报错，executed=false，report.checks 里 `blender.found=false`，仍产出脚本+spec+说明。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { normalizeSceneSpec, validateSceneSpec } from '../scene-spec.js'
import { emitBlenderScript, sanitizeViews, SCENE_VIEWS } from '../lib/blender-script.js'
import { CODES, fail } from '../errors.js'
import {
  assertNotOverwrite,
  displayPath,
  exists,
  fileSize,
  loadJsonArg,
  resolvePath,
  writeJsonFile,
  writeTextFile,
} from '../paths.js'

export { SCENE_VIEWS }

/** headless Blender 执行超时（毫秒）。 */
const RUN_TIMEOUT_MS = 240000
/** stdout/stderr 缓冲上限（Blender 渲染日志可能不短）。 */
const MAX_BUFFER = 64 * 1024 * 1024
/** 环境约定的 Blender 安装位置（相对工作区根；下载目录 _vendor/blender/<版本>/blender.exe）。 */
const VENDOR_DIR = path.join('_vendor', 'blender')
/** 兜底：上面那份 Blender 的绝对路径（工作区根不在启动器目录时也能直接找到）。 */
const VENDOR_ABS = 'D:\\新建文件夹\\miHoYo Launcher\\_vendor\\blender\\blender-4.5.15-windows-x64\\blender.exe'

/** Windows 路径转带正斜杠的写法（传给 Blender/Python，避免反斜杠转义问题）。 */
function toPosixPath(filePath) {
  return String(filePath).replace(/\\/g, '/')
}

/** 文件是否是普通文件（Blender 探测用）。 */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/** 在 `_vendor/blender` 下按名字排序找 blender 可执行文件（兼容版本目录变化）。 */
function scanVendorDir(vendorDir, attempts) {
  if (!exists(vendorDir)) return null
  let entries = []
  try {
    entries = fs.readdirSync(vendorDir, { withFileTypes: true })
  } catch {
    return null
  }
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const execNames = process.platform === 'win32' ? ['blender.exe', 'blender'] : ['blender', 'blender.exe']
  const candidates = []
  for (const name of names) candidates.push(path.join(vendorDir, name, 'blender.exe'))
  for (const name of names) candidates.push(path.join(vendorDir, name, 'blender'))
  for (const name of execNames) candidates.push(path.join(vendorDir, name))
  for (const candidate of candidates) {
    attempts.push(candidate)
    if (isFile(candidate)) return candidate
  }
  return null
}

/** 在 PATH 里找 blender（不 spawn，纯文件系统探测，确定性）。 */
function findBlenderOnPath(attempts) {
  const pathText = process.env.PATH || ''
  const dirs = pathText.split(path.delimiter).filter(Boolean)
  const names = process.platform === 'win32' ? ['blender.exe', 'blender'] : ['blender', 'blender.exe']
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      attempts.push(candidate)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * 自动探测本机 Blender（顺序：参数 → env.config.blenderPath → env.BLENDER_PATH
 * → 工作区 _vendor/blender → 环境约定绝对路径 → PATH）。
 * 找不到不报错，返回 { found:false, path:null, ... }。
 * @param {{ blenderPath?: string }} [options]
 * @param {{ root?: string, config?: object, BLENDER_PATH?: string }} [env]
 * @returns {{ found: boolean, path: string|null, source: string|null, attempts: string[] }}
 */
export function detectBlender(options = {}, env = {}) {
  const attempts = []
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  const configured = typeof options?.blenderPath === 'string' ? options.blenderPath.trim() : ''

  if (configured) {
    const candidate = path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(root, configured)
    attempts.push(candidate)
    if (isFile(candidate)) return { found: true, path: candidate, source: 'args', attempts }
  }

  const configPath = typeof env?.config?.blenderPath === 'string' ? env.config.blenderPath.trim() : ''
  if (configPath) {
    const candidate = path.isAbsolute(configPath) ? path.normalize(configPath) : path.resolve(root, configPath)
    attempts.push(candidate)
    if (isFile(candidate)) return { found: true, path: candidate, source: 'config', attempts }
  }

  const envPath = typeof env?.BLENDER_PATH === 'string' ? env.BLENDER_PATH.trim() : (process.env.BLENDER_PATH || '').trim()
  if (envPath) {
    const candidate = path.isAbsolute(envPath) ? path.normalize(envPath) : path.resolve(root, envPath)
    attempts.push(candidate)
    if (isFile(candidate)) return { found: true, path: candidate, source: 'env', attempts }
  }

  // 工作区根下的 _vendor/blender（下载目录结构：_vendor/blender/<版本>/blender.exe）
  const rootScan = scanVendorDir(path.join(root, VENDOR_DIR), attempts)
  if (rootScan) return { found: true, path: rootScan, source: 'vendor', attempts }

  // 环境约定的绝对路径（会话工作区不是启动器目录时兜底）
  attempts.push(VENDOR_ABS)
  if (isFile(VENDOR_ABS)) return { found: true, path: VENDOR_ABS, source: 'vendor-abs', attempts }

  // process.cwd() 下的 _vendor/blender（用工具时的常见工作目录）
  const cwdScan = scanVendorDir(path.join(process.cwd(), VENDOR_DIR), attempts)
  if (cwdScan) return { found: true, path: cwdScan, source: 'vendor-cwd', attempts }

  const onPath = findBlenderOnPath(attempts)
  if (onPath) return { found: true, path: onPath, source: 'path', attempts }

  return { found: false, path: null, source: null, attempts }
}

/** 从 Blender stdout 里取最后一行 `SCENE_REPORT {json}`。 */
function parseSceneReport(stdout) {
  const lines = String(stdout || '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line || !line.startsWith('SCENE_REPORT ')) continue
    try {
      return JSON.parse(line.slice('SCENE_REPORT '.length))
    } catch {
      return null
    }
  }
  return null
}

/** 归一化产物路径（脚本输出用正斜杠，统一成平台原生绝对路径）。 */
function normalizeArtifactPath(value, root) {
  if (typeof value !== 'string' || !value) return null
  const native = value.replace(/\//g, path.sep)
  return path.isAbsolute(native) ? path.normalize(native) : path.resolve(root, native)
}

function tail(text, maxLength) {
  const value = String(text || '')
  return value.length > maxLength ? value.slice(value.length - maxLength) : value
}

/**
 * S3 阶段入口：生成 bpy 脚本（+规范化 spec），有 Blender 时 headless 执行并校验产物。
 * 没找到 Blender 不报错，executed=false 并如实报告。
 * @param {{ spec?: any, outDir?: string, blenderPath?: string, render?: boolean, views?: string[], exportGlb?: boolean }} args
 * @param {{ root?: string, config?: object, signal?: AbortSignal }} env
 */
export async function buildSceneBlenderStage(args, env) {
  const options = args && typeof args === 'object' ? args : {}
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()

  // 1) 载入 + 规范化 + 结构校验（不合法带第一处 check 抛 E_SPEC_INVALID）
  if (options.spec === undefined || options.spec === null) fail(CODES.ARGS, '缺少 spec（SceneSpec 对象或 JSON 文件路径）')
  if (typeof options.outDir !== 'string' || !options.outDir.trim()) fail(CODES.ARGS, '缺少 outDir（输出目录）')
  const loaded = loadJsonArg(options.spec, root, 'spec')
  const spec = normalizeSceneSpec(loaded.value)
  const validation = validateSceneSpec(spec)
  if (!validation.ok) {
    const firstBad = validation.checks.find((check) => !check.ok) || { id: 'scene', detail: '未知错误' }
    fail(
      CODES.SPEC,
      `SceneSpec 不合法：${firstBad.id}${firstBad.detail ? `（${firstBad.detail}）` : ''}`,
      { first: firstBad, failed: validation.checks.filter((check) => !check.ok) },
    )
  }

  // 2) 输出目录与路径安全（输出不得覆盖输入 spec 文件）
  const outDir = resolvePath(options.outDir, root)
  try {
    fs.mkdirSync(outDir, { recursive: true })
    if (!fs.statSync(outDir).isDirectory()) fail(CODES.IO, `输出路径不是目录：${outDir}`, { path: outDir })
  } catch (err) {
    if (err && err.code === CODES.IO) throw err
    fail(CODES.IO, `无法创建输出目录：${outDir}（${err.message}）`, { path: outDir })
  }
  const specPath = path.join(outDir, 'spec.json')
  const scriptPath = path.join(outDir, 'build_scene.py')
  assertNotOverwrite([loaded.source], specPath)

  // 3) 先写脚本与规范化 spec（无论有没有 Blender 都要产出）
  const renderOn = options.render !== false
  const globalOn = options.exportGlb !== false
  const views = sanitizeViews(options.views)
  const scriptSource = emitBlenderScript(spec, { views, render: renderOn, exportGlb: globalOn })
  writeJsonFile(specPath, spec)
  writeTextFile(scriptPath, scriptSource)

  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, ...(detail === undefined ? {} : { detail }) })
  add('spec.valid', true, `${spec.rooms.length} 房间 / ${spec.walls.length} 墙 / ${spec.objects.length} 物件 / ${spec.lights.length} 灯`)
  add('script.written', exists(scriptPath) && fileSize(scriptPath) > 0, `${displayPath(scriptPath, root)}（${fileSize(scriptPath)} bytes）`)
  add('spec.written', exists(specPath) && fileSize(specPath) > 0, displayPath(specPath, root))

  // 4) 探测 Blender
  const blender = detectBlender({ blenderPath: options.blenderPath }, env)
  add(
    'blender.found',
    blender.found,
    blender.found
      ? `${blender.path}（来源 ${blender.source}）`
      : '未找到 Blender（已探测 args/config/BLENDER_PATH/_vendor/PATH）：仍生成 spec.json + build_scene.py，未执行搭建',
  )

  const base = {
    outDir,
    specPath,
    scriptPath,
    blenderPath: blender.found ? blender.path : null,
    executed: false,
  }

  // 5) 没找到 Blender，或用户明确关掉渲染与 GLB（只出脚本清单）→ 如实报告未执行
  if (!blender.found) {
    add('blender.executed', false, '未执行：没找到 Blender')
    return { ...base, report: { ok: checks.every((check) => check.ok), checks } }
  }
  if (!renderOn && !globalOn) {
    add('blender.executed', false, '未执行：render 与 exportGlb 都为 false（只生成脚本与 spec 清单）')
    return { ...base, report: { ok: checks.every((check) => check.ok), checks } }
  }

  // 6) headless 执行：blender -b -P build_scene.py -- --spec spec.json --out outDir
  const runArgs = [
    '-b',
    '-P',
    toPosixPath(scriptPath),
    '--',
    '--spec',
    toPosixPath(specPath),
    '--out',
    toPosixPath(outDir),
  ]
  const result = spawnSync(blender.path, runArgs, {
    cwd: outDir,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  const stdoutTail = tail(stdout, 4000)
  const failureDetail = {
    blender: blender.path,
    args: runArgs,
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message || result.error) : null,
    stdoutTail,
    stderrTail: tail(stderr, 2000),
  }

  if (result.error && result.error.code === 'ETIMEDOUT') {
    fail(CODES.INTERNAL, `Blender 执行超时（${RUN_TIMEOUT_MS / 1000}s）：${blender.path}`, failureDetail)
  }
  if (result.error) {
    fail(CODES.INTERNAL, `Blender 执行失败：${result.error.message}`, failureDetail)
  }
  if (result.status !== 0) {
    fail(CODES.INTERNAL, `Blender 退出码 ${result.status}（stderr 尾部已收集）`, failureDetail)
  }

  const sceneReport = parseSceneReport(stdout)
  if (!sceneReport || typeof sceneReport !== 'object') {
    fail(CODES.INTERNAL, 'Blender 没有输出可解析的 SCENE_REPORT 行', failureDetail)
  }
  add('blender.executed', true, `exit=0 engine=${sceneReport.engine || '?'}`)

  // 7) 校验产物（.blend / GLB / 每张渲染图存在且非空）
  const blendPath = normalizeArtifactPath(sceneReport.blend, root) || path.join(outDir, 'scene.blend')
  const blendBytes = exists(blendPath) ? fileSize(blendPath) : null
  add('scene.blend', !!blendBytes && blendBytes > 0, blendBytes ? `${displayPath(blendPath, root)}（${blendBytes} bytes）` : '缺少 scene.blend')

  let glbPath
  if (globalOn) {
    glbPath = normalizeArtifactPath(sceneReport.glb, root) || path.join(outDir, 'scene.glb')
    const glbBytes = exists(glbPath) ? fileSize(glbPath) : null
    add('scene.glb', !!glbBytes && glbBytes > 0, glbBytes ? `${displayPath(glbPath, root)}（${glbBytes} bytes）` : '缺少 scene.glb')
  }

  const renders = []
  if (renderOn) {
    for (const view of views) {
      const renderPath = path.join(outDir, `render-${view}.png`)
      const bytes = exists(renderPath) ? fileSize(renderPath) : null
      add(`scene.render.${view}`, !!bytes && bytes > 0, bytes ? `${displayPath(renderPath, root)}（${bytes} bytes）` : `缺少 render-${view}.png`)
      if (bytes && bytes > 0) renders.push({ view, path: renderPath, bytes })
    }
  }

  // 8) 场景计数核对（SCENE_REPORT 自报 vs spec 期望）
  add('scene.objects', sceneReport.objects === spec.objects.length, `${sceneReport.objects} / ${spec.objects.length}`)
  add('scene.walls', sceneReport.walls === spec.walls.length, `${sceneReport.walls} / ${spec.walls.length}`)
  // 每个房间至少合并出 1 块地板（cells 非空时），所以地板数 ≥ 房间数
  add(
    'scene.floors',
    Number(sceneReport.floors) >= spec.rooms.length,
    `${sceneReport.floors} 块地板（${spec.rooms.length} 房间 / ${sceneReport.wallSegments} 段墙 / ${sceneReport.openings} 门洞）`,
  )

  const ok = checks.every((check) => check.ok)
  if (!ok) {
    const bad = checks.filter((check) => !check.ok)
    fail(CODES.INTERNAL, `Blender 产物校验失败：${bad.map((check) => check.id).join(', ')}`, {
      checked: bad,
      sceneReport,
      stdoutTail,
      stderrTail: tail(stderr, 2000),
    })
  }

  return {
    ...base,
    executed: true,
    ...(blendBytes ? { blendPath } : {}),
    ...(glbPath ? { glbPath } : {}),
    ...(renderOn ? { renders } : {}),
    report: { ok: true, checks },
    stdoutTail,
    sceneReport,
  }
}
