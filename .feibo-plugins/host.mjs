// 轻量宿主：模拟 Cordis ctx，把 DSH 插件的 tools / skills 收集出来，供命令行调用。
// 不依赖 DeepSeek Harness；只在本项目内工作，不读写 %USERPROFILE%\.dsh。
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..')

export const PLUGINS = [
  'dsh-plugin-qianxing-art-pipeline',
  'dsh-plugin-qianxing-nodegraph',
  'dsh-plugin-qianxing-3d-placement',
  'dsh-plugin-qianxing-3d-report',
  'dsh-plugin-design-to-scene',
  'dsh-plugin-qianxing-prefab-render',
  'dsh-plugin-miliastra-toolbox',
  'dsh-plugin-beyond-simulator',
]

function entryOf(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const exp = pkg.exports
  const rel = (typeof exp === 'string' ? exp : exp?.['.']) || pkg.main || 'index.js'
  return path.join(dir, rel)
}

function makeCtx(registry, plugin, workspaceRoot) {
  const noop = () => {}
  const loggerFn = () => new Proxy(noop, { get: () => loggerFn() , apply: () => undefined })
  const base = {
    tools: {
      register(def) {
        registry.tools.set(def.name, { plugin, def })
        return noop
      },
    },
    skills: {
      register(s) {
        registry.skills.set(s.name, { plugin, ...s })
        return noop
      },
    },
    logger: loggerFn(),
    root: workspaceRoot,
  }
  // 其余 ctx 能力（on/effect/inject 等）一律空实现，加载不报错即可
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'then') return undefined
      return new Proxy(noop, { get: (_, kk) => (kk === 'then' ? undefined : noop), apply: () => noop })
    },
  })
}

export async function loadAll({ only, workspaceRoot = REPO, config = {} } = {}) {
  const registry = { tools: new Map(), skills: new Map(), errors: [] }
  for (const p of PLUGINS) {
    if (only && !only.includes(p)) continue
    const dir = path.join(REPO, p)
    try {
      const mod = await import(pathToFileURL(entryOf(dir)).href)
      if (typeof mod.apply !== 'function') throw new Error('入口没有导出 apply()')
      const cfg = { workspaceRoot, ...(config[p] || {}) }
      if (mod.Config && typeof mod.Config === 'function') {
        try { Object.assign(cfg, mod.Config(cfg)) } catch {}
      }
      await mod.apply(makeCtx(registry, p, workspaceRoot), cfg)
    } catch (e) {
      registry.errors.push({ plugin: p, error: String(e?.message || e).split('\n')[0] })
    }
  }
  return registry
}

export async function callTool(registry, name, args = {}) {
  const t = registry.tools.get(name)
  if (!t) throw new Error(`没有这个工具：${name}`)
  const ac = new AbortController()
  const exec = { signal: ac.signal, workspaceRoot: REPO, cwd: process.cwd() }
  const timer = setTimeout(() => ac.abort(), t.def.timeoutMs || 120000)
  try {
    const value = await t.def.execute(args, exec)
    try {
      const parts = t.def.output?.render?.(args, value)
      if (Array.isArray(parts)) return parts.map((x) => x.text ?? '').join('\n')
    } catch {}
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } finally {
    clearTimeout(timer)
  }
}
