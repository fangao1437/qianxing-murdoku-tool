// 共用校验入口（art_validate）：target = 'spec' | 'job' | 'gil'
//
// 输入：
//   target   'spec'|'job'|'gil'
//   value    json|string   spec/job 对象或 JSON 路径；gil 时必须是路径字符串
//   strict?  boolean       spec 校验是否要求模板集合非空且所有检查项都必须存在（默认 true）
//
// 输出：ValidationReport（契约 §7）
//   { version:1, ok:boolean, checks:[{id, ok, detail?}], screenshots?: string[] }
//
// 分支：
//   spec → 调用 src/stages/validate-spec.js 的 validateSpecDocument（S2/S3 共用内核）
//   job  → 校验 WriterJob 结构（version/base/out/ops；每种 op 必填字段；base != out）
//   gil  → 用 src/stages/inspect.js 的 inspectGilFile 结果做断言：
//          记录数 > 0、真撞号 0、模板对闭合、content 层数回读 > 0、things 引用全 ok、内嵌脚本标记可读
//          （没有内嵌脚本叶子 = 容器档，属正常 → 该条 ok=true 且 detail 注明「容器档，尚未嵌入脚本」）
// 任何分支都不允许静默跳过：校验器抛错 / 返回格式不对，都变成失败检查项（detail 写清原因）。
import { CODES, errorText, fail } from '../errors.js'
import { loadJsonArg, resolvePath } from '../paths.js'
import { validateSpecDocument } from './validate-spec.js'
import { inspectGilFile } from './inspect.js'

/** WriterJob 首版支持的 4 种 op（契约 §5）。 */
const WRITER_OPS = Object.freeze(['replace_template_layers', 'set_canvas', 'set_things_ref', 'set_family'])

/**
 * art_validate 入口。
 * @param {{ target: 'spec'|'job'|'gil', value: any, strict?: boolean }} args
 * @param {{ root?: string }} [env]
 */
export async function validateTarget({ target, value, strict }, env) {
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  if (target === 'spec') return validateSpecBranch(value, root, strict)
  if (target === 'job') return validateJobBranch(value, root)
  if (target === 'gil') return validateGilBranch(value, root, env)
  fail(CODES.ARGS, `target 必须是 spec|job|gil 之一（实得 ${JSON.stringify(target)}）`, { field: 'target' })
}

// ════════════════════════════════════════════════════════════════════════════
// spec 分支：交给 validate-spec.js（S2/S3 共用内核）
// ════════════════════════════════════════════════════════════════════════════
function validateSpecBranch(value, root, strict) {
  const { value: spec } = loadJsonArg(value, root, 'spec')
  let raw
  try {
    raw = validateSpecDocument(spec, { strict: strict !== false })
  } catch (err) {
    // 校验器自己抛错（含尚未实现）→ 变成失败检查项，不吞、不假装通过
    return {
      version: 1,
      ok: false,
      checks: [{ id: 'spec.validator', ok: false, detail: `规格校验器抛错：${errorText(err)}` }],
    }
  }
  return normalizeReport(raw, 'spec')
}

// ════════════════════════════════════════════════════════════════════════════
// job 分支：WriterJob 结构校验（不写盘；只判"这份 job 能不能交给写入器"）
// ════════════════════════════════════════════════════════════════════════════
function validateJobBranch(value, root) {
  const { value: job } = loadJsonArg(value, root, 'job')
  const checks = []
  const add = (id, ok, detail) => checks.push(detail === undefined ? { id, ok } : { id, ok, detail })

  const isObj = job !== null && typeof job === 'object' && !Array.isArray(job)
  add('job.shape', isObj, isObj ? undefined : `WriterJob 必须是对象（实得 ${Array.isArray(job) ? '数组' : typeof job}）`)
  const obj = isObj ? job : {}

  add('job.version', obj.version === 1, obj.version === 1 ? undefined : `version 必须是 1（实得 ${JSON.stringify(obj.version)}）`)

  const baseOk = typeof obj.base === 'string' && obj.base.trim().length > 0
  add('job.base', baseOk, baseOk ? undefined : 'base 必须是非空字符串路径（基准 .gil，不得被覆盖）')
  const outOk = typeof obj.out === 'string' && obj.out.trim().length > 0
  add('job.out', outOk, outOk ? undefined : 'out 必须是非空字符串路径（输出 .gil）')

  // 契约 §0：输出文件不得覆盖输入文件（base 是输入）
  if (baseOk && outOk) {
    let same = false
    try {
      same = resolvePath(obj.base, root) === resolvePath(obj.out, root)
    } catch {
      same = obj.base.trim() === obj.out.trim()
    }
    add('job.baseOutDistinct', !same, same ? 'out 不得与 base 相同（输出会覆盖基准档）' : undefined)
  } else {
    add('job.baseOutDistinct', false, 'base/out 缺失，无法确认输出是否会覆盖基准档')
  }

  const opsOk = Array.isArray(obj.ops)
  add('job.ops', opsOk, opsOk ? undefined : 'ops 必须是数组（首版支持 4 种 op）')
  if (opsOk) {
    if (obj.ops.length === 0) {
      add('job.ops.empty', false, 'ops 是空数组：没有要执行的写入操作')
    } else {
      obj.ops.forEach((op, i) => {
        const problems = opProblems(op)
        add(`job.ops[${i}]`, problems.length === 0, problems.length === 0 ? undefined : problems.join('；'))
      })
    }
  }

  // expect 可选；出现时结构必须对（写入器会拿它和基准档比对，不符抛 E_BASE_MISMATCH）
  if (obj.expect !== undefined) {
    const problems = []
    const exp = obj.expect
    if (exp === null || typeof exp !== 'object' || Array.isArray(exp)) {
      problems.push('expect 必须是对象')
    } else {
      if (exp.records !== undefined && !Number.isInteger(exp.records)) problems.push('expect.records 必须是整数')
      if (exp.templates !== undefined) {
        if (exp.templates === null || typeof exp.templates !== 'object' || Array.isArray(exp.templates)) {
          problems.push('expect.templates 必须是 {模板名: 层数} 对象')
        } else {
          for (const [name, count] of Object.entries(exp.templates)) {
            if (!Number.isInteger(count) || count < 0) problems.push(`expect.templates.${name} 必须是非负整数`)
          }
        }
      }
    }
    add('job.expect', problems.length === 0, problems.length === 0 ? undefined : problems.join('；'))
  }

  return { version: 1, ok: checks.every((c) => c.ok), checks }
}

/** 单个 op 的必填字段校验（返回问题列表；空 = 合法）。 */
function opProblems(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return ['op 必须是对象']
  const kind = op.op
  if (typeof kind !== 'string' || !kind.trim()) return ['缺 op 字段（字符串）']
  if (!WRITER_OPS.includes(kind)) return [`未知 op：${kind}（只支持 ${WRITER_OPS.join(' / ')}）`]

  const problems = []
  if (kind === 'replace_template_layers' || kind === 'set_canvas' || kind === 'set_family') {
    if (typeof op.template !== 'string' || !op.template.trim()) problems.push('缺 template（模板名，如 furn.statue）')
  }
  if (kind === 'replace_template_layers') {
    if (!Array.isArray(op.layers)) problems.push('layers 必须是 Layer[] 数组')
    if (op.sizePx !== undefined) problems.push(...sizePxProblems(op.sizePx))
  }
  if (kind === 'set_canvas') problems.push(...sizePxProblems(op.sizePx))
  if (kind === 'set_things_ref') {
    if (typeof op.name !== 'string' || !op.name.trim()) problems.push('缺 name（引用控件名，如 furn.rug.3）')
    const prefab = Number(op.prefab)
    if (!Number.isFinite(prefab) || prefab <= 0) problems.push('prefab 必须是模板【源】GUID（正整数，07 坑 2）')
  }
  if (kind === 'set_family' && !Number.isInteger(op.family)) problems.push('family 必须是整数（族号）')
  return problems
}

/** sizePx = [w,h]：两元素正数数组。 */
function sizePxProblems(sizePx) {
  if (!Array.isArray(sizePx) || sizePx.length !== 2) return ['sizePx 必须是 [w,h] 两元素数组']
  if (!sizePx.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return ['sizePx 两个分量必须是正数']
  return []
}

// ════════════════════════════════════════════════════════════════════════════
// gil 分支：基于 inspect 结果做断言（真机验收口径）
// ════════════════════════════════════════════════════════════════════════════
async function validateGilBranch(value, root, env) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(CODES.ARGS, 'target=gil 时 value 必须是 .gil 路径字符串', { field: 'value', type: typeof value })
  }
  const insp = await inspectGilFile({ gil: value }, { ...(env || {}), root })
  const checks = []
  const add = (id, ok, detail) => checks.push(detail === undefined ? { id, ok } : { id, ok, detail })

  // ① 记录数 > 0
  add('gil.records', insp.records > 0, insp.records > 0 ? `记录 ${insp.records} 条` : '记录数为 0（空档/解析失败）')

  // ② 真撞号 = 0（判据：两条记录自身 GUID 相同）
  add(
    'gil.collisions',
    insp.collisions === 0,
    insp.collisions === 0 ? '自身 GUID 真撞号 0' : `自身 GUID 真撞号 ${insp.collisions} 处（编辑器会报控件 GUID 重复）`,
  )

  // ③ 模板对闭合：源/母本/content 两侧都在（03 §2）
  const templates = insp.templates
  const brokenPairs = templates.filter(
    (t) => t.source === null || t.mother === null || t.contentSource === null || t.contentMother === null,
  )
  add(
    'gil.templates',
    templates.length > 0 && brokenPairs.length === 0,
    brokenPairs.length > 0
      ? `模板对不闭合：${brokenPairs.map((t) => t.name).join('、')}`
      : `家具模板 ${templates.length} 个，模板对全部闭合（源/母本/content 各就位）`,
  )

  // ④ content 层数回读 > 0（源与母本都要有；只改一份 content 的典型症状是母本 0）
  const badLayers = templates.filter(
    (t) => !(Number.isInteger(t.layers) && t.layers > 0) || !(Number.isInteger(t.motherLayers) && t.motherLayers > 0),
  )
  add(
    'gil.contentLayers',
    templates.length > 0 && badLayers.length === 0,
    badLayers.length > 0
      ? `content 层数回读异常：${badLayers.map((t) => `${t.name}=${t.layers}/${t.motherLayers}`).join('、')}`
      : templates.map((t) => `${t.name}=${t.layers}/${t.motherLayers}`).join('，'),
  )

  // ⑤ things 引用全部指向模板源（坑 2）
  const refs = insp.things.refs
  const badRefs = refs.filter((r) => !r.ok)
  const thingsOk = insp.things.control !== null && insp.things.count > 0 && refs.length > 0 && badRefs.length === 0
  add(
    'gil.thingsRefs',
    thingsOk,
    thingsOk
      ? `things 引用 ${insp.things.count} 条全部指向模板源（control=#${insp.things.control}）`
      : insp.things.control === null
        ? '找不到 root/things 容器'
        : `things 引用异常：${badRefs.map((r) => r.name || '(无名)').join('、') || 'refs 为空'}`,
  )

  // ⑥ 内嵌脚本标记可读
  //    · 没有脚本叶子 = 容器档，属正常（ok=true，detail 注明），交给 S5 嵌入；
  //    · 有叶子但读不到标记 = 异常（ok=false）；
  //    · 有标记 = 报出实际标记与字节数（旧脚本也是事实，本项目 551 就是继承的 v324）。
  const { embedded, bytes } = insp.markers
  if (bytes === null) {
    add('gil.embeddedMarker', true, '容器档，尚未嵌入脚本（无内嵌脚本叶子）')
  } else if (embedded === null) {
    add('gil.embeddedMarker', false, `内嵌脚本叶子存在（${bytes} 字节）但读不到「构建标记 vNNN」`)
  } else {
    add('gil.embeddedMarker', true, `内嵌脚本标记 ${embedded}（${bytes} 字节）`)
  }

  return { version: 1, ok: checks.every((c) => c.ok), checks }
}

// ════════════════════════════════════════════════════════════════════════════
// ValidationReport 规范化（校验器返回结构不对 = 失败检查项，不静默当通过）
// ════════════════════════════════════════════════════════════════════════════
/**
 * @param {any} raw validate-spec.js 的返回值
 * @param {string} prefix 检查 id 前缀（缺 id 时兜底）
 */
function normalizeReport(raw, prefix) {
  if (raw !== null && typeof raw === 'object' && Array.isArray(raw.checks)) {
    const checks = raw.checks.map((c, i) => {
      const item = {
        id: typeof c?.id === 'string' && c.id ? c.id : `${prefix}.check${i + 1}`,
        ok: c?.ok === true,
      }
      if (c?.detail !== undefined && c?.detail !== null) item.detail = String(c.detail)
      return item
    })
    const allOk = checks.every((c) => c.ok)
    const ok = typeof raw.ok === 'boolean' ? raw.ok && allOk : allOk
    const report = { version: 1, ok, checks }
    if (Array.isArray(raw.screenshots)) report.screenshots = raw.screenshots.map(String)
    return report
  }
  let shown = ''
  try {
    shown = JSON.stringify(raw)?.slice(0, 300) ?? String(raw)
  } catch {
    shown = String(raw)
  }
  return {
    version: 1,
    ok: false,
    checks: [
      {
        id: `${prefix}.report`,
        ok: false,
        detail: `校验器返回的不是 ValidationReport（契约 §7：{version, ok, checks}）：${shown}`,
      },
    ],
  }
}
