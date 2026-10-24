// S4 · 写入器：WriterJob → 容器 .gil + WriterReport（交接包 03、06 §5、07 坑 1/2/21/22）
//
// 输入：WriterJob（契约 §5）
//   {
//     version: 1,
//     base: string,            // 基准 .gil（相对工作区根；不得被覆盖）
//     out: string,             // 输出 .gil（必须 != base）
//     ops: [                    // 首版必须实现全部四种
//       { op:'replace_template_layers', template:string, sizePx?:[w,h], layers:Layer[] },
//       { op:'set_canvas', template:string, sizePx:[w,h] },
//       { op:'set_things_ref', name:string, prefab:number },   // prefab = 模板【源】GUID
//       { op:'set_family', template:string, family:number },
//     ],
//     expect?: { records?: number, templates?: { [name]: number } }  // 基准档实际值；不符抛 E_BASE_MISMATCH
//   }
//
// 输出：WriterReport（契约 §5）
//   {
//     version: 1, out, records:{before,after},
//     templates: { [name]: { source, mother, layers, motherLayers, canvas:[w,h] } },
//     gates: { reread:true, roundtrip:true, deterministic:true, idempotent:true,
//              collision:0, thingsRefs:{ count, missing:[] } },
//     handwritten: string[], samples: [...]
//   }
//
// 事务流程（等价于 gilwrite.writeGil 的 7 步闸门 + 本插件额外的四闸）：
//   ① 校验 job / base / out（out 不得覆盖 base ⇒ E_PATH；expect 不符 ⇒ E_BASE_MISMATCH）；
//   ② 幂等判定：ops 目标状态已全部满足 ⇒ 原样复制 base→out，SHA 不变（07 坑 22）；
//   ③ 否则：按 ops 原地改树 → 写临时文件（writeGil：重读/往返/字段 diff）→
//      进程内再跑「重读记录数 / 往返 / 确定性 / 撞号=0 / things 引用齐全 / 写后状态满足」；
//   ④ 全过才把临时文件原子改名到 out；任何一步失败 ⇒ 删临时文件、不留半成品、抛结构化错误。
//
// 硬约束：输出不得覆盖输入；不得手写编辑器不认的记录（层一律克隆）；新 GUID 从 maxId+1 连续分配。
import fs from 'node:fs'
import path from 'node:path'
import { readGil, encodeMsg } from '../gil/gilread.js'
import { writeGil } from '../gil/gilwrite.js'
import {
  applyOps,
  normalizeOps,
  isOpsSatisfied,
  verifyOps,
  findTemplatePair,
  contentOf,
  childIdsOf,
  buildTemplatesReport,
  buildSamples,
} from '../gil/ops.js'
import {
  probeCollisions,
  probeRoundtrip,
  probeReread,
  probeDeterminism,
  inventoryThingsRefs,
  sha256Buf,
  sha256File,
} from '../gil/gates.js'
import { ArtError, CODES, fail } from '../errors.js'
import { loadJsonArg, resolvePath, displayPath, exists, assertNotOverwrite } from '../paths.js'

const CONTRACT_VERSION = 1

/**
 * S4 工具入口（tools.js 里注册为 art_write_gil）。
 * @param {{ job: object|string }} args  WriterJob 对象或其 JSON 文件路径
 * @param {{ root?: string, config?: object, signal?: AbortSignal }} env
 */
export async function writeGilJob(args, env) {
  const root = (env && env.root) || process.cwd()
  // job 允许内联 JSON 对象或 JSON 文件路径（相对工作区根）
  const { value: rawJob } = loadJsonArg(args && args.job, root, 'WriterJob')
  const job = normalizeJob(rawJob)

  const baseAbs = resolvePath(job.base, root)
  const outAbs = resolvePath(job.out, root)
  // 契约 §0：输出文件不得覆盖输入文件（先检查，在任何写入之前）
  assertNotOverwrite([baseAbs], outAbs)
  if (!exists(baseAbs)) fail(CODES.IO, `基准档不存在：${baseAbs}`, { path: baseAbs })

  let base
  try {
    base = readGil(baseAbs)
  } catch (err) {
    fail(CODES.IO, `基准档解析失败：${baseAbs}（${err.message}）`, { path: baseAbs })
  }
  const recordsBefore = base.recs.length

  // expect 先核对：expect 与基准档不符 ⇒ E_BASE_MISMATCH（不产生任何输出）
  checkExpect(base, job.expect)

  // 幂等：ops 已全部满足 ⇒ 原样复制（SHA 不变、不重新分配 id）
  if (isOpsSatisfied(base, job.ops)) {
    return runIdempotentCopy({ job, baseAbs, outAbs, root, recordsBefore })
  }
  return runBuildAndWrite({ job, base, baseAbs, outAbs, root, recordsBefore })
}

// ════════════════════════════════════════════════════════════════════════════
// job 规范化 / expect 校验
// ════════════════════════════════════════════════════════════════════════════
function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(CODES.ARGS, 'WriterJob 必须是 JSON 对象')
  if (raw.version !== CONTRACT_VERSION) {
    fail(CODES.SPEC, `WriterJob.version 必须为 ${CONTRACT_VERSION}（实得 ${JSON.stringify(raw.version)}）：结构版本变化是破坏性变更，请先迁移`, {
      version: raw.version,
    })
  }
  if (typeof raw.base !== 'string' || !raw.base.trim()) fail(CODES.ARGS, 'WriterJob.base 必须是相对工作区根的非空路径')
  if (typeof raw.out !== 'string' || !raw.out.trim()) fail(CODES.PATH, 'WriterJob.out 必须是非空路径（输出新文件，不得覆盖 base）')
  if (raw.expect !== undefined && raw.expect !== null && (typeof raw.expect !== 'object' || Array.isArray(raw.expect))) {
    fail(CODES.ARGS, 'WriterJob.expect 必须是 { records?, templates? } 对象')
  }
  return {
    version: CONTRACT_VERSION,
    base: raw.base.trim(),
    out: raw.out.trim(),
    ops: normalizeOps(raw.ops),
    expect: raw.expect || null,
  }
}

/** expect 与基准档实际值核对（记录数 / 每模板层数），不符抛 E_BASE_MISMATCH。 */
function checkExpect(g, expect) {
  if (!expect) return
  if (expect.records !== undefined && expect.records !== null) {
    const want = Number(expect.records)
    if (!Number.isInteger(want)) fail(CODES.ARGS, 'expect.records 必须是整数', { expect: expect.records })
    if (g.recs.length !== want) {
      fail(CODES.BASE, `expect.records 与基准档不符：基准档 ${g.recs.length} 条，expect ${want}`, {
        actual: g.recs.length,
        expect: want,
      })
    }
  }
  if (expect.templates !== undefined && expect.templates !== null) {
    if (typeof expect.templates !== 'object' || Array.isArray(expect.templates)) {
      fail(CODES.ARGS, 'expect.templates 必须是 { 模板名: 层数 } 映射')
    }
    for (const [name, rawWant] of Object.entries(expect.templates)) {
      const want = Number(rawWant)
      if (!Number.isInteger(want) || want < 0) fail(CODES.ARGS, `expect.templates.${name} 必须是非负整数`, { template: name })
      const pair = findTemplatePair(g, name) // 基准档缺该模板对 ⇒ E_BASE_MISMATCH
      const gotS = childIdsOf(contentOf(g, pair.source)).length
      const gotM = childIdsOf(contentOf(g, pair.mother)).length
      if (gotS !== want || gotM !== want) {
        fail(CODES.BASE, `expect.templates.${name} 与基准档层数不符：源 ${gotS} / 母本 ${gotM}，expect ${want}`, {
          template: name,
          actual: [gotS, gotM],
          expect: want,
        })
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 幂等路径：原样复制（不写任何记录，SHA 与 base 一致）
// ════════════════════════════════════════════════════════════════════════════
async function runIdempotentCopy({ job, baseAbs, outAbs, root, recordsBefore }) {
  ensureParentDir(outAbs)
  const tmp = tempPathFor(outAbs)
  try {
    fs.copyFileSync(baseAbs, tmp)
    const baseSha = sha256File(baseAbs)
    const outSha = sha256File(tmp)
    const reread = probeReread(tmp, recordsBefore)
    const roundtrip = probeRoundtrip(tmp)
    const collision = reread.g ? probeCollisions(reread.g) : { ok: false, count: -1, duplicates: [] }
    const things = reread.g
      ? inventoryThingsRefs(reread.g)
      : { ok: false, count: 0, missing: ['<重读失败>'], refs: [] }
    // 幂等 + 确定性：同一 job 再跑一次仍走同一分支（重读后 ops 仍"已满足"），输出 SHA 与 base 相同
    const stillSatisfied = !!reread.g && isOpsSatisfied(reread.g, job.ops)
    const determinism = { ok: baseSha === outSha && stillSatisfied, outSha, rebuiltSha: baseSha }
    const problems = collectGateProblems({ reread, roundtrip, collision, things, determinism, postSatisfied: stillSatisfied })
    if (problems.length) throw gateError('幂等复制', problems)
    // 报告先算好再落位：任何报告期异常都不会留下"在 out 上但报告失败"的中间态
    const report = buildReport({
      root,
      baseAbs,
      outAbs,
      bytes: fs.statSync(tmp).size,
      recordsBefore,
      recordsAfter: reread.records,
      g: reread.g,
      ops: job.ops,
      sha256: outSha,
      idempotent: true,
      handwritten: ['幂等：ops 目标状态已全部满足，原样复制基准档（未新增/删除任何记录、未重新分配 GUID）'],
      samples: [],
      gates: {
        reread: reread.ok,
        roundtrip: roundtrip.ok,
        deterministic: determinism.ok,
        collision: collision.count,
        things,
      },
    })
    commitTmp(tmp, outAbs)
    return report
  } catch (err) {
    cleanupTmp(tmp)
    throw wrapWriteError(err)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 写入路径：applyOps → writeGil（临时文件）→ 进程内四闸 → 原子落位
// ════════════════════════════════════════════════════════════════════════════
async function runBuildAndWrite({ job, base, baseAbs, outAbs, root, recordsBefore }) {
  ensureParentDir(outAbs)
  const tmp = tempPathFor(outAbs)
  try {
    // ① 原地改树（新 GUID 从 maxId+1 连续分配；旧层删除在收尾统一做）
    const plan = applyOps(base, job.ops)
    const expectRecs = plan.expectRecs
    // 第一遍内存编码的 SHA：与最终落盘 SHA 对比，能发现"内存改了但写路径分叉"
    const firstSha = sha256Buf(base.pack(encodeMsg(base.tree)))

    // ② 唯一安全写通道：writeGil 内部完成「输出≠输入 / 落盘 / 重读 / 往返 / 记录数 / 字段 diff / assert」
    writeGil(base, tmp, {
      label: `art_write_gil ${job.ops.map((o) => o.op).join('+')}`,
      expectRecs,
      assert: (g2) => verifyOps(g2, job.ops),
      quiet: true,
    })

    // ③ 进程内四闸（全部从磁盘重读，不复用内存对象）
    const reread = probeReread(tmp, expectRecs)
    const roundtrip = probeRoundtrip(tmp)
    const collision = reread.g ? probeCollisions(reread.g) : { ok: false, count: -1, duplicates: [] }
    const things = reread.g
      ? inventoryThingsRefs(reread.g)
      : { ok: false, count: 0, missing: ['<重读失败>'], refs: [] }
    // 确定性：从基准档重新读一遍、重新执行同一份 ops、重新编码 ⇒ SHA 必须与落盘一致
    const determinism = probeDeterminism(() => {
      const fresh = readGil(baseAbs)
      applyOps(fresh, job.ops)
      return sha256Buf(fresh.pack(encodeMsg(fresh.tree)))
    }, tmp)
    // 写后状态必须满足 ops（否则说明编辑没真正落地 —— gilread 头部 #503 冻结事故的复检点）
    const postSatisfied = !!reread.g && isOpsSatisfied(reread.g, job.ops)
    const writtenSha = sha256File(tmp)

    const problems = collectGateProblems({
      reread,
      roundtrip,
      collision,
      things,
      determinism,
      postSatisfied,
      firstSha,
      writtenSha,
    })
    if (problems.length) throw gateError('写入', problems)

    // ④ 报告先算好，再把临时文件原子改名到 out（out 从不出现半成品）
    const report = buildReport({
      root,
      baseAbs,
      outAbs,
      bytes: fs.statSync(tmp).size,
      recordsBefore,
      recordsAfter: reread.records,
      g: reread.g,
      ops: job.ops,
      sha256: writtenSha,
      idempotent: false,
      handwritten: describePlan(plan, false),
      samples: buildSamples(reread.g, job.ops),
      gates: {
        reread: reread.ok,
        roundtrip: roundtrip.ok,
        deterministic: determinism.ok,
        collision: collision.count,
        things,
      },
    })
    commitTmp(tmp, outAbs)
    return report
  } catch (err) {
    cleanupTmp(tmp)
    throw wrapWriteError(err)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 闸门汇总 / 报告 / 文件事务小工具
// ════════════════════════════════════════════════════════════════════════════
function collectGateProblems({ reread, roundtrip, collision, things, determinism, postSatisfied, firstSha, writtenSha }) {
  const problems = []
  if (!reread.ok) {
    problems.push({ code: CODES.WRITE, message: `重读闸门失败：记录数 ${reread.records} ≠ 预期 ${reread.expectedRecords}` })
  }
  if (!roundtrip.ok) {
    problems.push({
      code: CODES.WRITE,
      message: `往返闸门失败：${roundtrip.reason || `重编码与落盘体不一致（首差 @${roundtrip.firstDiff}）`}`,
    })
  }
  if (!collision || collision.count !== 0) {
    const detail = collision && collision.duplicates
      ? collision.duplicates.slice(0, 5).map((d) => `#${d.guid}×${d.records.length}`).join('、')
      : '探针不可用'
    problems.push({ code: CODES.COLLISION, message: `真撞号 ${collision ? collision.count : '?'} 处：${detail}` })
  }
  if (!things || !things.ok || (things.missing && things.missing.length)) {
    problems.push({ code: CODES.WRITE, message: `things 引用不齐全：缺 ${(things && things.missing ? things.missing : ['?']).join('、')}` })
  }
  if (determinism && !determinism.ok) {
    problems.push({
      code: CODES.WRITE,
      message: `确定性闸门失败：落盘 SHA ${determinism.outSha} ≠ 同输入重建 SHA ${determinism.rebuiltSha}`,
    })
  }
  if (postSatisfied === false) {
    problems.push({ code: CODES.WRITE, message: '写后状态不满足 ops（编辑没有真正落地，参见 gilread 头部「#503 冻结」事故）' })
  }
  if (firstSha && writtenSha && firstSha !== writtenSha) {
    problems.push({ code: CODES.WRITE, message: `写路径分叉：内存首遍 SHA ${firstSha} ≠ 落盘 SHA ${writtenSha}` })
  }
  return problems
}

function gateError(stage, problems) {
  const code = problems.some((p) => p.code === CODES.COLLISION) ? CODES.COLLISION : CODES.WRITE
  return new ArtError(code, `${stage}闸门未通过（${problems.length} 项）：${problems.map((p) => p.message).join('；')}`, {
    problems,
  })
}

function describePlan(plan, idempotent) {
  if (idempotent) return []
  const lines = []
  if (plan.added.length) lines.push(`${plan.added.length} 条新记录全部克隆自基准档编辑器控件（无手写结构，07 坑 1）`)
  if (plan.deleted.length) lines.push(`删除旧层记录 ${plan.deleted.length} 条（源/母本各 ${plan.deleted.length / 2}）`)
  for (const o of plan.ops) {
    switch (o.op) {
      case 'replace_template_layers': {
        lines.push(
          `${o.template}：源 #${o.source} / 母本 #${o.mother} 的 content #${o.contentSource}/#${o.contentMother} 层列表重写为 ${o.layers} 层×2（层原型 #${o.proto}）`,
        )
        if (o.sizePx) lines.push(`${o.template} content 画布 = ${o.sizePx[0]}×${o.sizePx[1]}（源/母本）`)
        break
      }
      case 'set_canvas':
        lines.push(`${o.template} content 画布 = ${o.sizePx[0]}×${o.sizePx[1]}（源 #${o.contentSource} / 母本 #${o.contentMother}）`)
        break
      case 'set_things_ref':
        lines.push(`things 引用控件 ${o.name} → 模板源 #${o.prefab}（控件 #${o.control}，${o.created ? '克隆新增' : '改引用值'}）`)
        break
      case 'set_family':
        lines.push(`族号 ${o.template} → ${o.family}（源 #${o.source} / 母本 #${o.mother} 的 #502[2]/#12）`)
        break
      default:
        break
    }
  }
  if (!lines.length) lines.push('（无结构变更）')
  return lines
}

function buildReport({ root, baseAbs, outAbs, bytes, recordsBefore, recordsAfter, g, ops, sha256, idempotent, handwritten, samples, gates }) {
  return {
    version: CONTRACT_VERSION,
    out: displayPath(outAbs, root),
    base: displayPath(baseAbs, root),
    sha256,
    bytes,
    records: { before: recordsBefore, after: recordsAfter },
    templates: buildTemplatesReport(g, ops),
    gates: {
      reread: !!gates.reread,
      roundtrip: !!gates.roundtrip,
      deterministic: !!gates.deterministic,
      idempotent: !!idempotent,
      collision: gates.collision,
      thingsRefs: { count: gates.things.count, missing: gates.things.missing.slice() },
    },
    handwritten,
    samples,
  }
}

function ensureParentDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function tempPathFor(outAbs) {
  return `${outAbs}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function commitTmp(tmp, outAbs) {
  try {
    fs.renameSync(tmp, outAbs) // Windows 下 libuv 用 MOVEFILE_REPLACE_EXISTING，可覆盖旧输出
    return
  } catch (err) {
    const code = err && err.code
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY') throw err
    // 个别文件系统/权限下不允许 rename 覆盖：先删旧输出再重试（只影响输出文件，不碰 base）
    try {
      fs.unlinkSync(outAbs)
    } catch {
      /* 旧输出不存在或删不掉时让下面的 rename 报错 */
    }
    fs.renameSync(tmp, outAbs)
  }
}

function cleanupTmp(tmp) {
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  } catch {
    /* 清理失败不掩盖主错误 */
  }
}

function wrapWriteError(err) {
  if (err instanceof ArtError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new ArtError(CODES.WRITE, `写入失败：${message}`, {
    cause: err instanceof Error ? err.stack : undefined,
  })
}
