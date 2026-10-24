// S5 · 脚本嵌入：容器 .gil + dist 脚本 → 最终 .gil + EmbedReport（交接包 03 §6、06 §6、07 坑 9/10）
//
// 输入：EmbedJob（契约 §6）
//   {
//     version: 1,
//     container: string,   // 容器 .gil（相对工作区根；不得被覆盖）
//     script: string,      // dist/client_script.lua
//     out: string,         // 最终 .gil（必须 != container）
//     expectMarker: string // 形如 'v332'（source=dist=embedded 三方一致）
//   }
//
// 输出：EmbedReport
//   { version:1, out, container, script, embeddedBytes, marker, distMarker, match:true,
//     sha256, removedBom:boolean, gates:{ markerChain:true, bytesMatch:true, roundtrip:true } }
//
// 规则：
//   · 沿容器里「内嵌脚本叶子」写入脚本字节（最大值 + Lua 特征判据，判据同 find_script.mjs）；
//   · source（脚本自身标记行）/ dist / embedded 三处标记必须一致，否则抛 E_MARKER 且不产出文件；
//     —— 本阶段只拿到 dist 脚本，「source」= 脚本自身那条 `构建标记 vNNN`（与 dist 同源）；
//        链核对落在三处：job.expectMarker == 脚本标记 == 重读磁盘后的 embedded 标记；
//   · 脚本 UTF-8 BOM 必须先剥离（07 坑 9），剥离后报告 removedBom；
//   · 写盘走 writeGil（重读磁盘 / 往返闸门 / 字段 diff）；输出不得覆盖 container 或 script；
//   · 失败一律抛结构化错误，且**删除任何已写出的输出文件**（不留下半成品）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CODES, fail } from '../errors.js'
import { readGil } from '../gil/gilread.js'
import { findScriptLeaf, markerOf, writeGil } from '../gil/gilwrite.js'
import { assertNotOverwrite, displayPath, readBinaryFile, readJsonFile, resolvePath } from '../paths.js'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * S5 入口：把 dist 脚本嵌进容器 .gil 的脚本叶子，产出最终档。
 * @param {{ job: object|string }} args job = EmbedJob 对象或 JSON 路径
 * @param {{ root?: string }} [env]
 */
export async function embedScriptIntoGil({ job }, env) {
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  const spec = loadEmbedJob(job, root)

  const containerAbs = resolvePath(spec.container, root)
  const scriptAbs = resolvePath(spec.script, root)
  const outAbs = resolvePath(spec.out, root)
  // 契约 §0：输出不得覆盖输入（容器/脚本都算输入）
  assertNotOverwrite([containerAbs, scriptAbs], outAbs)

  // ── 容器与脚本 ────────────────────────────────────────────────────────────
  const g = readGilOrFail(containerAbs)
  const rawScript = readBinaryFile(scriptAbs, 'dist 脚本')
  const { bytes: scriptBytes, removedBom } = stripBom(rawScript)
  const distMarker = markerOf(scriptBytes)
  if (distMarker === null) {
    fail(CODES.MARKER, 'dist 脚本里找不到版本标记（应为含「构建标记 vNNN」的那一行）', {
      script: displayPath(scriptAbs, root),
      hint: '先重建 dist（bundle 客户端脚本）再嵌入；标记是"内嵌的是哪一版"的独立事实',
    })
  }
  const expectMarker = normalizeMarker(spec.expectMarker)
  if (expectMarker !== distMarker) {
    fail(CODES.MARKER, `标记链不一致：expectMarker=${expectMarker}，dist 脚本=${distMarker}`, {
      expectMarker,
      distMarker,
      script: displayPath(scriptAbs, root),
    })
  }

  const leaf = findScriptLeaf(g)
  if (!leaf) {
    fail(CODES.MARKER, '容器里找不到内嵌脚本叶子（>2000 字节且像 Lua 的文本字段）⇒ 这份 .gil 不是可嵌入的容器档', {
      container: displayPath(containerAbs, root),
    })
  }

  // ── 替换脚本叶子（只改这一处，长度前缀由编码器重算）──────────────────────
  const mustDiffer = !leaf.buf.equals(scriptBytes)
  leaf.field.payload = scriptBytes
  leaf.field.len = scriptBytes.length
  leaf.field.isText = true

  let outBytes
  let reread
  try {
    mkdirFor(outAbs)
    // ★ 唯一安全写通道：落盘 → 从磁盘重读 → 往返闸门 → 字段 diff（只允许脚本叶子那 1 处变化）
    const rep = writeGil(g, outAbs, {
      label: `内嵌脚本 → ${expectMarker}`,
      expectRecs: g.recs.length,
      expectDiffs: mustDiffer ? 1 : 0,
      expectMarker,
      mustDiffer,
      quiet: true,
    })
    reread = rep.g2
    outBytes = rep.g2.src
  } catch (err) {
    removeQuietly(outAbs)
    fail(CODES.WRITE, `写盘/闸门失败：${err.message}`, { out: displayPath(outAbs, root) })
  }

  // ── 嵌入后从磁盘重读叶子复核（不拿内存值当验收）──────────────────────────
  const leaf2 = findScriptLeaf(reread)
  const bytesMatch = leaf2 !== null && leaf2.buf.equals(scriptBytes)
  const marker = leaf2 ? markerOf(leaf2.buf) : null
  const markerChain = marker === expectMarker && distMarker === expectMarker
  if (!bytesMatch || !markerChain) {
    removeQuietly(outAbs)
    fail(CODES.MARKER, '嵌入后重读校验失败：落盘档里的脚本字节/标记与 dist 不一致', {
      out: displayPath(outAbs, root),
      bytesMatch,
      marker,
      expectMarker,
      distMarker,
    })
  }

  const sha256 = crypto.createHash('sha256').update(outBytes).digest('hex').toUpperCase()
  return {
    version: 1,
    out: displayPath(outAbs, root),
    container: displayPath(containerAbs, root),
    script: displayPath(scriptAbs, root),
    embeddedBytes: scriptBytes.length,
    marker,
    distMarker,
    match: true,
    sha256,
    removedBom,
    gates: { markerChain, bytesMatch, roundtrip: true },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EmbedJob 读取与结构校验
// ════════════════════════════════════════════════════════════════════════════
/** 读 EmbedJob（对象或 JSON 路径），并校验必填字段（失败 E_ARGS，错误里指出第一处不符字段）。 */
function loadEmbedJob(job, root) {
  if (job === undefined || job === null) fail(CODES.ARGS, '缺少 job（EmbedJob 对象或 JSON 路径）', { field: 'job' })
  let doc = job
  if (typeof job === 'string') {
    if (!job.trim()) fail(CODES.ARGS, 'job 路径不能为空', { field: 'job' })
    doc = readJsonFile(resolvePath(job, root), 'EmbedJob')
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(CODES.ARGS, 'job 必须是 EmbedJob 对象', { field: 'job', type: typeof doc })
  }
  if (doc.version !== 1) {
    fail(CODES.ARGS, `EmbedJob.version 必须是 1（实得 ${JSON.stringify(doc.version)}）`, { field: 'version' })
  }
  for (const key of ['container', 'script', 'out']) {
    if (typeof doc[key] !== 'string' || !doc[key].trim()) {
      fail(CODES.ARGS, `EmbedJob.${key} 必须是非空字符串路径`, { field: key, value: doc[key] })
    }
  }
  const markerText = typeof doc.expectMarker === 'string' ? doc.expectMarker.trim() : ''
  if (!/^v\d{2,4}$/i.test(markerText)) {
    fail(CODES.ARGS, `EmbedJob.expectMarker 必须形如 vNNN（实得 ${JSON.stringify(doc.expectMarker)}）`, {
      field: 'expectMarker',
      value: doc.expectMarker,
    })
  }
  return doc
}

/** 标记归一化：'v332' / 'V332' / ' v332 ' → 'v332'；非法返回原值（由后续链核对报错）。 */
function normalizeMarker(value) {
  if (typeof value !== 'string') return value
  const s = value.trim()
  return /^v\d{2,4}$/i.test(s) ? 'v' + s.slice(1) : s
}

// ════════════════════════════════════════════════════════════════════════════
// 文件小工具
// ════════════════════════════════════════════════════════════════════════════
function readGilOrFail(abs) {
  if (!fs.existsSync(abs)) fail(CODES.IO, `找不到容器 .gil：${abs}`, { path: abs })
  try {
    return readGil(abs)
  } catch (err) {
    fail(CODES.IO, `解析容器 .gil 失败：${abs}（${err.message}）`, { path: abs })
  }
}

/** 去 UTF-8 BOM（07 坑 9：带 BOM 的脚本会让 Lua 加载炸 `unexpected symbol near '<\239>'`）。 */
function stripBom(buf) {
  if (buf.length >= UTF8_BOM.length && buf.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    return { bytes: buf.subarray(UTF8_BOM.length), removedBom: true }
  }
  return { bytes: buf, removedBom: false }
}

function mkdirFor(abs) {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
  } catch (err) {
    fail(CODES.IO, `建不了输出目录：${path.dirname(abs)}（${err.message}）`, { path: path.dirname(abs) })
  }
}

/** 失败清理：不留下半成品输出（契约：失败不产出文件）。 */
function removeQuietly(abs) {
  try {
    fs.rmSync(abs, { force: true })
  } catch {
    /* 清理失败不影响原始错误 */
  }
}
