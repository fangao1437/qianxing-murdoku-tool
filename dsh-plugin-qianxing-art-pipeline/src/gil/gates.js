// S4 · 进程内闸门（写完 .gil 后必须逐个跑过；任一不过 ⇒ 删半成品 + 抛错）
//
// 参考实现：qianxing-murdoku/tools/gil/probe_guid_collision.mjs（撞号口径）
//           qianxing-murdoku/tools/gil/roundtrip.mjs（往返口径）
//
// 设计原则（见 gilread/gilwrite 头部事故档案）：
//   · 闸门必须**从磁盘重新读**，不许拿内存里的对象/刚写出的 buffer 自证；
//   · 闸门的判定口径要独立于"写入器自己怎么想"——例如撞号只看记录顶层 #501；
//   · 失败不许静默：每个 probe 都返回结构化结果，由调用方汇总抛错。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { parseMsg, encodeMsg, readGil } from './gilread.js'
import { childIdsOf, recById, findThingsRecord, readRefOf, parentIdOf, templatePairs } from './ops.js'

/** 文件字节的 SHA256（大写十六进制，与仓库验收口径一致）。 */
export function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase()
}

/** 读文件算 SHA256。 */
export function sha256File(file) {
  return sha256Buf(fs.readFileSync(file))
}

/** 第一个不同字节的下标（相同返回 -1）。 */
function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

// ════════════════════════════════════════════════════════════════════════════
// ① 真撞号探针（口径 = probe_guid_collision.mjs ①：两条记录的「自身 GUID」相同）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 每条记录的「自身 GUID」= 记录顶层 `#501`（**不是**递归取第一个 #501：
 * 递归会被 /#505/#503/#504/#4 之类同号嵌套字段骗，见 gilread 同号字段陷阱③）。
 */
export function probeCollisions(g) {
  const byOwn = new Map()
  let noOwn = 0
  for (const r of g.recs) {
    const top = (r.field.sub || []).find((f) => f.field === 501 && f.wt === 0)
    if (!top) {
      noOwn++
      continue
    }
    const v = Number(top.num)
    if (!byOwn.has(v)) byOwn.set(v, [])
    byOwn.get(v).push(r)
  }
  const duplicates = []
  for (const [guid, list] of byOwn) {
    if (list.length <= 1) continue
    duplicates.push({
      guid,
      records: list.map((r) => ({ name: r.name, id: Number(r.id), parent: parentIdOf(r) })),
    })
  }
  return {
    ok: duplicates.length === 0,
    count: duplicates.length,
    duplicates,
    uniqueSelfGuids: byOwn.size,
    records: g.recs.length,
    noOwnGuid: noOwn,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ② 往返闸门（口径 = roundtrip.mjs：解析 → 重新编码，与落盘体逐字节一致）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 独立于 gilwrite.writeGil 内部往返的**第二遍**验证：
 * 直接读文件 → 解析 → 用 encodeMsg 重编码 → 与文件体逐字节比较。
 * 这一遍不看写入器的任何内存状态，能抓住"写出的东西不是稳定形态"。
 */
export function probeRoundtrip(file) {
  const buf = fs.readFileSync(file)
  const hdr = []
  for (let i = 0; i < 5; i++) hdr.push(buf.readUInt32BE(i * 4))
  const bodyEnd = 20 + hdr[4]
  if (bodyEnd > buf.length || hdr[4] <= 0) {
    return { ok: false, bytes: buf.length, reason: `外层头第 5 个 u32（体长 ${hdr[4]}）与文件大小 ${buf.length} 不符` }
  }
  const body = buf.subarray(20, bodyEnd)
  const tree = parseMsg(buf, 20, bodyEnd, 0)
  if (!tree) return { ok: false, bytes: buf.length, reason: '体解析失败（不是稳定的 protobuf 消息流）' }
  const re = encodeMsg(tree)
  const ok = re.equals(body)
  return {
    ok,
    bytes: buf.length,
    bodyBytes: body.length,
    trailerBytes: buf.length - bodyEnd,
    firstDiff: ok ? -1 : firstDiffIndex(re, body),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ③ 重读闸门（记录数 / maxId / 重读后仍能解析）
// ════════════════════════════════════════════════════════════════════════════
export function probeReread(file, expectedRecords) {
  let g
  try {
    g = readGil(file)
  } catch (err) {
    return { ok: false, reason: `重读失败：${err.message}`, expectedRecords: expectedRecords ?? null }
  }
  const ok = expectedRecords == null || g.recs.length === expectedRecords
  return {
    ok,
    records: g.recs.length,
    expectedRecords: expectedRecords ?? null,
    maxId: g.maxId,
    g,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 确定性闸门（同输入重建 → 与落盘 SHA 相同）
// ════════════════════════════════════════════════════════════════════════════
/**
 * @param {() => string} rebuildSha 从基准档**重新读一遍**并重建，返回 SHA256 字符串
 * @param {string} outFile 已落盘的输出文件
 */
export function probeDeterminism(rebuildSha, outFile) {
  const outSha = sha256File(outFile)
  const rebuiltSha = rebuildSha()
  return { ok: outSha === rebuiltSha, outSha, rebuiltSha }
}

// ════════════════════════════════════════════════════════════════════════════
// ⑤ things 引用清单（03 §3 / 07 坑 2：引用值必须是模板【源】GUID）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 扫描 things 容器下的模板引用控件，并核对家具模板是否齐全：
 *   · count  = things 子控件数；
 *   · missing = 缺引用、引用值不等于模板源 GUID 的**家具模板名**；
 *   · refs   = 每个引用控件的 { name, control, prefab, ok }（ok=引用值指向本档模板源记录）。
 */
export function inventoryThingsRefs(g) {
  const things = findThingsRecord(g)
  const furniture = templatePairs(g)
    .filter((p) => /^furn\./.test(p.name))
    .map((p) => ({ name: p.name, source: Number(p.source.id) }))
  if (!things) {
    return {
      ok: false,
      count: 0,
      refs: [],
      missing: furniture.map((f) => f.name),
      reason: '基准档里找不到 things 容器',
    }
  }
  const sourceIds = new Set(
    g.recs.filter((r) => r.parentId == null && r.name).map((r) => Number(r.id)),
  )
  const refs = childIdsOf(things)
    .map((id) => recById(g, id))
    .filter(Boolean)
    .map((r) => {
      const prefab = readRefOf(r.field)
      return {
        name: r.name,
        control: Number(r.id),
        prefab,
        ok: prefab !== null && sourceIds.has(prefab),
      }
    })
  const missing = []
  for (const f of furniture) {
    const hit = refs.find((x) => x.name === f.name)
    if (!hit) missing.push(f.name)
    else if (hit.prefab !== f.source) missing.push(f.name)
  }
  return {
    ok: missing.length === 0,
    count: refs.length,
    refs,
    missing,
    target: Number(things.id),
  }
}
