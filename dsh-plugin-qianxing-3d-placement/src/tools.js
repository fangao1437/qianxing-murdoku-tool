// 工具注册层：3D 场景摆位（读/写 .gil 场景实体变换）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { readGil } from '../vendor/gil/gilread.js'
import { writeGil, diffGilFiles } from '../vendor/gil/gilwrite.js'
import { defineArtTool } from './define.js'

const PATH = (description) => ({ type: 'string', description })
const EXCLUDE_NAMES = new Set(['MPActionGroup', 'GI_RootNode', '中心原点', 'RootNode', '受击特效', '被击倒特效'])
const TEXT_RE = /^[\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{1,}$/

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const txt = (f) => {
  try {
    return f.payload.toString('utf8')
  } catch {
    return ''
  }
}
const isName = (f) => f.isText && TEXT_RE.test(txt(f))

function vecOf(node) {
  return node && node.sub ? node.sub.filter((x) => x.wt === 5 && x.field >= 1 && x.field <= 3).map((x) => x.f) : null
}
function eulerOf(node) {
  if (!node) return null
  const v = [0, 0, 0]
  for (const x of node.sub || []) if (x.wt === 5 && x.field >= 1 && x.field <= 3) v[x.field - 1] = x.f
  return v
}

/** 提取 #5 场景实体（名字 + #6/#11 变换节点） */
function sceneEntities(g) {
  const scene = g.tree.find((f) => f.field === 5)
  const out = []
  for (const [i, item] of (scene?.sub || []).entries()) {
    const names = []
    ;(function walk(fields) {
      for (const f of fields) {
        if (isName(f)) names.push(txt(f))
        if (f.sub) walk(f.sub)
      }
    })(item.sub || [])
    const label = names.find((n) => !EXCLUDE_NAMES.has(n)) || '(无名)'
    const f6 = (item.sub || []).find((f) => f.field === 6 && f.sub)
    const f11 = f6?.sub?.find((f) => f.field === 11 && f.sub)
    if (!f11) {
      out.push({ index: i, name: label, transform: null })
      continue
    }
    const nodeOf = (no) => f11.sub.find((f) => f.field === no && f.sub) || null
    const posNode = nodeOf(1)
    const rotNode = nodeOf(2)
    const scaleNode = nodeOf(3)
    out.push({
      index: i,
      name: label,
      transform: { posNode, rotNode, scaleNode, pos: vecOf(posNode), rot: eulerOf(rotNode), scale: vecOf(scaleNode) },
    })
  }
  return out
}

function resolveOutdir(config, given) {
  const raw = (typeof given === 'string' && given.trim()) || config?.outdir || path.join(os.homedir(), '.dsh', 'qianxing-out')
  const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

/** 先校验再写：返回 {apply, warnings}，避免半改后报错 */
function planVec(node, desired, fieldName) {
  if (!node || !node.sub) throw new Error(`没有 ${fieldName} 节点`)
  const fields = node.sub.filter((x) => x.wt === 5 && x.field >= 1 && x.field <= 3)
  if (fields.length === 0) throw new Error(`${fieldName} 节点没有浮点分量`)
  const updates = []
  const defaulted = []
  const unsupported = []
  for (let axis = 1; axis <= 3; axis += 1) {
    const value = desired[axis - 1]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const f = fields.find((x) => x.field === axis)
    if (f) updates.push({ field: f, value })
    else if (Math.abs(value) > 1e-9) unsupported.push(axis)
    else defaulted.push(axis)
  }
  if (unsupported.length > 0) {
    throw new Error(`${fieldName} 轴 ${unsupported.join(',')} 在存档里没有字段（稀疏编码），无法写入非零值`)
  }
  return {
    apply: () => updates.forEach((u) => (u.field.f = u.value)),
    warnings: defaulted.length > 0 ? [`${fieldName} 轴 ${defaulted.join(',')} 未写出（默认 0）`] : [],
    updates: updates.length,
  }
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerPlacementTools(ctx, config) {
  const register = (spec) => ctx.tools.register(defineArtTool(spec))

  // ── 1. 列出 3D 场景实体 ─────────────────────────────────────────────────
  register({
    name: 'scene3d_list_entities',
    description:
      '列出 .gil 3D 场景存档里的场景实体（#5 列表）：名称、index、位置/旋转/缩放（米/度）。' +
      '用于「插件只做摆位」主线：先看清存档里已有哪些元件、当前坐标，再决定每个元件要移到哪。只读。',
    timeoutMs: 60000,
    concurrencySafe: true,
    parameters: objectSchema({ gil: PATH('.gil 3D 场景存档绝对路径') }, ['gil']),
    run: (args) => {
      const file = path.resolve(args.gil)
      if (!fs.existsSync(file)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: file }
      const g = readGil(file)
      const ents = sceneEntities(g)
      const withTransform = ents.filter((e) => e.transform)
      return {
        ok: true,
        gil: file,
        sha256: sha256(file),
        entities: ents.map((e) => ({
          index: e.index,
          name: e.name,
          pos: e.transform?.pos ?? null,
          rot: e.transform?.rot ?? null,
          scale: e.transform?.scale ?? null,
        })),
        count: ents.length,
        withTransform: withTransform.length,
      }
    },
  })

  // ── 2. 按坐标表离线改写（摆位主线） ────────────────────────────────────
  register({
    name: 'scene3d_apply_placement',
    description:
      '3D 场景摆位主线：读 .gil 场景实体，按坐标表离线改写位置/旋转/缩放，写新档并重读校验（原档只读）。' +
      'placement 每项 {name 或 index, position?:[x,y,z] 绝对坐标(米), delta?:[dx,dy,dz] 相对位移, rotation?:[x,y,z] 欧拉角(度), scale?:[x,y,z]}。' +
      '绕开 Blender/GIA/渊星；只改现有元件变换，不能新增/删除元件。输出默认 <原档名>.placement.gil。',
    timeoutMs: 120000,
    concurrencySafe: false,
    parameters: objectSchema(
      {
        gil: PATH('.gil 3D 场景存档绝对路径（只读）'),
        placement: {
          type: 'array',
          description: '坐标表：[{name 或 index, position?/delta?/rotation?/scale?}]',
          items: { type: 'object' },
        },
        out: PATH('可选：输出路径（默认同目录 <名字>.placement.gil；不得与输入相同）'),
      },
      ['gil', 'placement'],
    ),
    run: (args) => {
      const src = path.resolve(args.gil)
      if (!fs.existsSync(src)) return { ok: false, error: 'E_INPUT_NOT_FOUND', path: src }
      const placements = Array.isArray(args.placement) ? args.placement : []
      if (placements.length === 0) return { ok: false, error: 'E_ARGS', hint: 'placement 不能为空' }
      const out = args.out ? path.resolve(args.out) : path.join(path.dirname(src), `${path.basename(src, '.gil')}.placement.gil`)
      if (out === src) return { ok: false, error: 'E_ARGS', hint: '输出路径不能与输入相同（原档只读）' }
      fs.mkdirSync(path.dirname(out), { recursive: true })

      const shaBefore = sha256(src)
      const g = readGil(src)
      const ents = sceneEntities(g)
      const changed = []
      const errors = []
      const warnings = []

      for (const item of placements) {
        const target = findEntity(ents, item)
        if (!target) {
          errors.push({ item: describeItem(item), error: 'E_ENTITY_NOT_FOUND', hint: '用 scene3d_list_entities 看可用 name/index' })
          continue
        }
        if (!target.transform) {
          errors.push({ item: describeItem(item), error: 'E_NO_TRANSFORM', entity: target.name, index: target.index })
          continue
        }
        const before = { pos: target.transform.pos?.slice() ?? null, rot: target.transform.rot?.slice() ?? null, scale: target.transform.scale?.slice() ?? null }
        try {
          const plans = []
          if (Array.isArray(item.position) || Array.isArray(item.delta)) {
            const base = target.transform.pos
            if (!Array.isArray(base)) throw new Error('没有位置节点')
            const wanted = Array.isArray(item.position)
              ? item.position
              : [base[0] + item.delta[0], base[1] + item.delta[1], base[2] + item.delta[2]]
            plans.push(planVec(target.transform.posNode, wanted, '位置'))
          }
          if (Array.isArray(item.rotation)) plans.push(planVec(target.transform.rotNode, item.rotation, '旋转'))
          if (Array.isArray(item.scale)) plans.push(planVec(target.transform.scaleNode, item.scale, '缩放'))
          if (plans.length === 0) throw new Error('没有给出 position/delta/rotation/scale 任何一项')
          for (const p of plans) p.apply()
          for (const p of plans) warnings.push(...p.warnings.map((w) => `${target.name}: ${w}`))
        } catch (err) {
          errors.push({ item: describeItem(item), error: 'E_WRITE', message: String(err?.message ?? err) })
          continue
        }
        changed.push({ index: target.index, name: target.name, before })
      }

      if (errors.length > 0 && changed.length === 0) {
        return { ok: false, error: 'E_PLACEMENT_FAILED', errors, warnings, changed }
      }
      if (changed.length === 0) return { ok: false, error: 'E_NO_CHANGES', hint: '坐标表没有产生任何改动' }

      const writeReport = writeGil(g, out, { label: '3d-placement', expectRecs: g.recs.length, mustDiffer: true })
      const shaAfter = sha256(out)

      // 独立重读校验
      const g2 = readGil(out)
      const ents2 = sceneEntities(g2)
      const verified = []
      for (const c of changed) {
        const a = ents2.find((e) => e.index === c.index)
        if (!a?.transform) {
          verified.push({ index: c.index, name: c.name, ok: false, error: 'E_REREAD_NO_TRANSFORM' })
          continue
        }
        verified.push({ index: c.index, name: c.name, ok: true, after: { pos: a.transform.pos, rot: a.transform.rot, scale: a.transform.scale } })
      }
      const bad = verified.filter((v) => !v.ok)
      const diff = diffGilFiles(src, out, 50)
      return {
        ok: bad.length === 0,
        source: src,
        out,
        sha256Before: shaBefore,
        sha256After: shaAfter,
        sourceUnchanged: sha256(src) === shaBefore,
        diffs: writeReport.diffs,
        changed,
        verified,
        errors,
        warnings,
        diffTotal: diff.total,
        diffCompared: diff.compared,
        diffSample: diff.diffs.slice(0, 20),
      }
    },
  })
}

function findEntity(ents, item) {
  if (Number.isInteger(item.index)) {
    const byIndex = ents.find((e) => e.index === item.index)
    if (byIndex) return byIndex
  }
  if (typeof item.name === 'string' && item.name.trim()) {
    const sought = item.name.trim()
    return ents.find((e) => e.name === sought) || ents.find((e) => e.name.includes(sought))
  }
  return undefined
}

function describeItem(item) {
  return { index: item?.index, name: item?.name }
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
