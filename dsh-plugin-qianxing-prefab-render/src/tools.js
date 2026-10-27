// 官方素材渲染（借渊星官方 prefab 几何库/贴图）：SceneSpec → prefab 场景 → Blender 渲染
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineArtTool } from './define.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'lib', 'build_prefab_scene.py')

const BLENDER_CANDIDATES = [
  process.env.DSH_PREFAB_BLENDER || '',
  '/opt/blender52/blender-5.2.3-linux-x64/blender',
  '/opt/blender52/blender',
  '/usr/local/bin/blender52',
].filter(Boolean)

const ASSETS_CANDIDATES = [
  process.env.DSH_PREFAB_ASSETS || '',
  '/root/yx-assets',
  '/opt/yx-assets',
].filter(Boolean)

export function resolveBlender(config = {}) {
  const list = [config?.blenderPath, ...BLENDER_CANDIDATES].filter(Boolean)
  for (const p of list) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch { /* next */ }
  }
  return ''
}

export function resolveAssets(config = {}) {
  const list = [config?.assetsDir, ...ASSETS_CANDIDATES].filter(Boolean)
  for (const p of list) {
    const abs = path.resolve(p)
    const hasCatalog = fs.existsSync(path.join(abs, 'catalog.json'))
    const hasGeo = fs.existsSync(path.join(abs, 'geometry'))
    const hasTex = fs.existsSync(path.join(abs, 'textures'))
    if (hasCatalog && hasGeo && hasTex) return abs
  }
  return ''
}

function parseResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (line.startsWith('PREFAB_RESULT ')) {
      try {
        return JSON.parse(line.slice('PREFAB_RESULT '.length))
      } catch { /* ignore */ }
    }
  }
  return null
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerPrefabTools(ctx, config) {
  const register = (spec) => ctx.tools.register(defineArtTool(spec))

  register({
    name: 'scene_prefab_status',
    description: '检查「官方素材渲染」环境是否就绪：Blender 5.2 可执行文件 + 渊星官方资产（catalog.json / geometry/*.blend / textures）。返回路径与可用性，不渲染。',
    timeoutMs: 30000,
    concurrencySafe: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const blender = resolveBlender(config)
      const assets = resolveAssets(config)
      const geometry = assets ? fs.readdirSync(path.join(assets, 'geometry')).filter((f) => f.endsWith('.blend')) : []
      let texCount = 0
      if (assets) {
        const walk = (d) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else texCount += 1
          }
        }
        try { walk(path.join(assets, 'textures')) } catch { /* ignore */ }
      }
      return {
        ok: Boolean(blender && assets),
        blender: blender || null,
        assets: assets || null,
        geometryBlends: geometry.length,
        textures: texCount,
        catalog: assets ? fs.existsSync(path.join(assets, 'catalog.json')) : false,
        note: blender && assets ? '就绪：可以调用 scene_build_prefab' : '未就绪：缺少 Blender 5.2 或官方资产目录',
      }
    },
  })

  register({
    name: 'scene_build_prefab',
    description:
      '用渊星官方 prefab（几何库+贴图）把 SceneSpec 自动搭成 3D 场景并渲染：输出 .blend + 透视/俯视 PNG + 统计。' +
      '只做渲染/预览——云端无法导出 GIA（需要 Windows host bridge + 渊星权益）。' +
      '第一次用先调 scene_prefab_status 确认环境就绪。',
    timeoutMs: 900000,
    concurrencySafe: false,
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'json', description: 'SceneSpec 对象或 JSON 文件路径' },
        outDir: { type: 'string', description: '输出目录（默认 <工作区>/_work/prefab-render）' },
        width: { type: 'integer', description: '渲染宽度，默认 1600' },
        height: { type: 'integer', description: '渲染高度，默认 900' },
        samples: { type: 'integer', description: 'Cycles 采样数，默认 24（越高越慢）' },
        exposure: { type: 'number', description: '曝光补偿，默认 -0.3' },
        assetsDir: { type: 'string', description: '可选：官方资产目录（默认 /root/yx-assets）' },
        blenderPath: { type: 'string', description: '可选：Blender 5.2 可执行文件' },
      },
      required: ['spec'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const blender = resolveBlender({ blenderPath: args.blenderPath, ...config })
      const assets = resolveAssets({ assetsDir: args.assetsDir, ...config })
      if (!blender) return { ok: false, error: 'E_NO_BLENDER52', hint: '需要 Blender 5.2（/opt/blender52）或配置 blenderPath' }
      if (!assets) return { ok: false, error: 'E_NO_ASSETS', hint: '需要 official prefab 资产目录（catalog.json + geometry + textures）或配置 assetsDir' }

      const workRoot = path.resolve(exec?.root || process.cwd())
      const outDir = path.resolve(args.outDir || path.join(workRoot, '_work', 'prefab-render'))
      fs.mkdirSync(outDir, { recursive: true })

      let specPath
      if (typeof args.spec === 'string') {
        specPath = path.resolve(args.spec)
        if (!fs.existsSync(specPath)) return { ok: false, error: 'E_SPEC_NOT_FOUND', spec: specPath }
      } else {
        specPath = path.join(outDir, 'spec.input.json')
        fs.writeFileSync(specPath, JSON.stringify(args.spec, null, 2), 'utf8')
      }

      const argv = [
        '-b',
        '--python', SCRIPT,
        '--',
        '--spec', specPath,
        '--catalog', path.join(assets, 'catalog.json'),
        '--assets', assets,
        '--out', outDir,
        '--res-x', String(args.width ?? 1600),
        '--res-y', String(args.height ?? 900),
        '--samples', String(args.samples ?? 24),
        '--exposure', String(args.exposure ?? -0.3),
      ]
      const started = Date.now()
      const child = spawn(blender, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd: outDir })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stderr += String(d) })
      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* ignore */ }
          resolve(-1)
        }, 14 * 60 * 1000)
        child.on('close', (code) => { clearTimeout(timer); resolve(code) })
      })
      const parsed = parseResult(stdout)
      const elapsedMs = Date.now() - started
      if (exitCode !== 0 || !parsed) {
        return {
          ok: false,
          error: 'E_BLENDER_FAILED',
          exitCode,
          elapsedMs,
          outDir,
          stdoutTail: stdout.slice(-1200),
          stderrTail: stderr.slice(-1200),
        }
      }
      return { ok: true, outDir, elapsedMs, blender, assets, ...parsed }
    },
  })
}
