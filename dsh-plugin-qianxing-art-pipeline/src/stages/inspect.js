// S6 · 结构清单：最终 .gil → 模板/引用/内嵌脚本清单（真机验收与排障用）
//
// 输入：
//   gil      string .gil 路径（相对工作区根）
//   limit?   integer 每类清单最多条数（默认 200）
//
// 输出：
//   {
//     version:1, file, bytes, records, maxId,
//     markers: { embedded: string|null, bytes: number|null },
//     templates: [ { name, source, mother, contentSource, contentMother,
//                    canvas:[w,h], layers, motherLayers } ],   // 按名字排序
//     things: { control: number|null, count, refs: [{ name, prefab, ok }] },
//     collisions: number,          // 自身 GUID 重复数（必须 0）
//     topLevel: [{ name, id, children }],  // root 下直接子控件概览
//     warnings: string[]
//   }
//
// 判定口径见交接包 03 §2/§3：模板对（源 #504=null、母本 #504=1073741844、互相 #14/#13 指）、
// content 画布（state pair 尺寸）、层 = content 子列表记录数、things 引用值 = 模板源 GUID。
//
// ★ 只读：本阶段不改任何文件（真机验收/排障第一步：先确认导入的是哪一版、模板与引用是否齐全）。
// ★ 重要事实（2026-10-24 实测）：551「结构容器」并不是"没有内嵌脚本"——它从基准档 547 继承了
//    旧脚本（1531678 字节 / 标记 v324）。所以 markers 按【事实】读：有叶子就报字节数与标记，
//    绝不把旧脚本报成 null；容器档的"旧脚本"只写进 warnings（交付前须用 S5 覆盖），不判为异常。
import fs from 'node:fs'
import path from 'node:path'
import { CODES, fail } from '../errors.js'
import { round2 } from '../contract.js'
import { asIdList, pairOf, pairValue, readGil, readVarint } from '../gil/gilread.js'
import { findScriptLeaf, markerOf } from '../gil/gilwrite.js'
import { displayPath, resolvePath } from '../paths.js'

/** 编辑器模板容器（母本的父 id，03 §2.2）。 */
const MOTHER_PARENT_ID = 1073741844
/** things 引用控件的组件槽（66/89 都是"模板引用控件"形态，03 §3）。 */
const THINGS_REF_TAGS = Object.freeze([66, 89])
/** 家具模板名前缀（S4 只维护这批模板；cell.1.1/clue/face 等是界面模板，不列入）。 */
const FURN_PREFIX = 'furn.'
const DEFAULT_LIMIT = 200

/**
 * S6 入口：读 .gil 并产出结构清单。
 * @param {{ gil: string, limit?: number }} args
 * @param {{ root?: string }} [env]
 */
export async function inspectGilFile({ gil, limit }, env) {
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  const abs = resolvePath(gil, root)
  const g = readGilOrFail(abs)
  const limitN = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT
  const byId = new Map(g.recs.map((r) => [r.id, r]))
  const warnings = []

  // ── 内嵌脚本 ──────────────────────────────────────────────────────────────
  const markers = readMarkers(g, abs, root, warnings)

  // ── 家具模板对（furn.*）──────────────────────────────────────────────────
  const { templates, sourceByName } = readTemplates(g, byId, limitN, warnings)

  // ── things 引用控件 ───────────────────────────────────────────────────────
  const things = readThings(g, byId, sourceByName, limitN, warnings)

  // ── 自身 GUID 撞号（顶层 #501 重复；判据同 probe_guid_collision.mjs ①）────
  const collisions = countOwnGuidCollisions(g.recs)

  // ── root 顶层控件概览 ─────────────────────────────────────────────────────
  const topLevel = readTopLevel(g, byId, limitN, warnings)

  return {
    version: 1,
    file: displayPath(abs, root),
    bytes: g.src.length,
    records: g.recs.length,
    maxId: Number(g.maxId),
    markers,
    templates,
    things,
    collisions,
    topLevel,
    warnings,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 读 .gil（失败给结构化错误，不把异常原样抛给模型）
// ════════════════════════════════════════════════════════════════════════════
function readGilOrFail(abs) {
  if (!fs.existsSync(abs)) fail(CODES.IO, `找不到 .gil：${abs}`, { path: abs })
  try {
    return readGil(abs)
  } catch (err) {
    fail(CODES.IO, `解析 .gil 失败：${abs}（${err.message}）`, { path: abs })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 内嵌脚本标记
// ════════════════════════════════════════════════════════════════════════════
/**
 * 读内嵌脚本叶子（最大 + Lua 特征，判据同 gilwrite.findScriptLeaf）。
 * @returns {{embedded: string|null, bytes: number|null}}
 */
function readMarkers(g, abs, root, warnings) {
  const leaf = findScriptLeaf(g)
  if (!leaf) {
    warnings.push('本档没有内嵌脚本叶子（容器档）：交付前须用 art_embed_script 嵌入 dist 脚本')
    return { embedded: null, bytes: null }
  }
  const embedded = markerOf(leaf.buf)
  const bytes = leaf.buf.length
  if (embedded === null) {
    // 叶子在、标记读不到 —— 这不是"容器档"，必须报出来
    warnings.push(`内嵌脚本叶子存在（${bytes} 字节）但读不到「构建标记 vNNN」⇒ 无法核对版本`)
    return { embedded, bytes }
  }
  // 有标记：尝试与工作区里的 dist 脚本对照。不一致 = 容器档继承的旧脚本（交付前须覆盖）。
  const distPath = findDistScript(abs, root)
  if (distPath) {
    const distMarker = readDistMarker(distPath)
    if (distMarker && distMarker !== embedded) {
      warnings.push(
        `内嵌脚本是继承的旧版 ${embedded}（${bytes} 字节），与 ${displayPath(distPath, root)} 的 ${distMarker} 不一致` +
          ' ⇒ 交付前须用 art_embed_script 覆盖',
      )
    }
  }
  return { embedded, bytes }
}

/** 找 dist 脚本：优先工作区约定的 qianxing-murdoku/dist/，其次 .gil 同目录旁的 dist/。 */
function findDistScript(absGil, root) {
  const dir = path.dirname(absGil)
  const candidates = [
    path.join(root, 'qianxing-murdoku', 'dist', 'client_script.lua'),
    path.join(dir, 'dist', 'client_script.lua'),
    path.join(path.dirname(dir), 'dist', 'client_script.lua'),
  ]
  for (const cand of candidates) {
    try {
      if (fs.statSync(cand).isFile()) return cand
    } catch {
      /* 逐个尝试，存在即用 */
    }
  }
  return null
}

function readDistMarker(distPath) {
  try {
    return markerOf(fs.readFileSync(distPath))
  } catch {
    return null
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 模板对（03 §2）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 遍历记录找 furn.* 模板对：源（#504=null）→ 母本（#504=1073741844）→ content。
 * @returns {{templates: object[], sourceByName: Map<string, number>}} sourceByName=模板名→源 GUID
 */
function readTemplates(g, byId, limitN, warnings) {
  const rows = []
  const sourceByName = new Map()
  for (const rec of g.recs) {
    if (!rec.name || !rec.name.startsWith(FURN_PREFIX)) continue
    const motherId = refValue(rec, 4, 14) // 源：组件块 #502[4] 的 #14 = 母本 id
    if (motherId === null) continue
    const mother = byId.get(motherId) || null
    const contentSource = contentChildOf(rec, g.recs)
    const contentMother = mother ? contentChildOf(mother, g.recs) : null
    const row = {
      name: rec.name,
      source: rec.id,
      mother: motherId,
      contentSource: contentSource ? contentSource.id : null,
      contentMother: contentMother ? contentMother.id : null,
      canvas: contentSource ? canvasOf(contentSource) : null,
      layers: contentSource ? childIdsOf(contentSource).length : null,
      motherLayers: contentMother ? childIdsOf(contentMother).length : null,
    }
    rows.push(row)
    sourceByName.set(rec.name, rec.id)

    // 结构告警：模板对不闭合时必须说清是哪一侧坏了（不许静默）
    if (!mother) warnings.push(`模板 ${rec.name} 的母本 #${motherId} 不存在`)
    else {
      if (mother.parentId !== MOTHER_PARENT_ID) {
        warnings.push(`模板 ${rec.name} 的母本 #${motherId} 父=${mother.parentId}，应为 ${MOTHER_PARENT_ID}`)
      }
      if (mother.name !== rec.name) warnings.push(`模板 ${rec.name} 的母本 #${motherId} 名字=${mother.name}，与源不一致`)
      const back = refValue(mother, 3, 13) // 母本：组件块 #502[3] 的 #13 = 源 id
      if (back !== rec.id) warnings.push(`母本 #${motherId} 的 #13=${back}，未指回源 #${rec.id}（模板对不闭合）`)
    }
    if (!contentSource) warnings.push(`模板 ${rec.name} 的源 content 缺失（找不到名字为 content 的子容器）`)
    if (mother && !contentMother) warnings.push(`模板 ${rec.name} 的母本 content 缺失（#${motherId} 下无子容器）`)
    // 源/母本层数不一致 = 写入器只改了一份 content 的典型症状（03 §7）
    if (row.layers !== null && row.motherLayers !== null && row.layers !== row.motherLayers) {
      warnings.push(`模板 ${rec.name} 源/母本层数不一致：${row.layers} vs ${row.motherLayers}`)
    }
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.source - b.source))
  return { templates: rows.slice(0, limitN), sourceByName }
}

/**
 * 模板的子控件里那个 content 容器。
 * 8 个家具模板的 content 名字就是 'content'；rug.2 / rug.3 的 content **没有名字**
 * （2026-10-24 实测：只有组件类型「容器节点」），所以退化为"模板下唯一的容器节点"。
 */
function contentChildOf(templateRec, allRecs) {
  const kids = allRecs.filter((r) => r.parentId === templateRec.id)
  const named = kids.find((r) => r.name === 'content')
  if (named) return named
  const containers = kids.filter((r) => Array.isArray(r.names) && r.names.includes('容器节点'))
  if (containers.length === 1) return containers[0]
  return containers[0] || kids[0] || null
}

/** content 状态块里的尺寸对（03 §2.3：canvas=content 状态块尺寸）。 */
function canvasOf(contentRec) {
  const block = contentRec.states[0]
  if (!block || !Array.isArray(block.sub)) return null
  const pair = pairOf(block, 505)
  if (!pair) return null
  return [round2(pairValue(pair, 0)), round2(pairValue(pair, 1))]
}

// ════════════════════════════════════════════════════════════════════════════
// things 引用控件（03 §3 / 07 坑 2）
// ════════════════════════════════════════════════════════════════════════════
/**
 * things 子控件 = 模板引用控件；引用叶子 /505(66/89)/#503/#77/#501 = 模板【源】GUID。
 * ok=false ⇒ 引用值不是模板源（坑 2：写成母本会导致实例化失败/样式错）。
 */
function readThings(g, byId, sourceByName, limitN, warnings) {
  const things = g.recs.find((r) => r.name === 'things') || null
  if (!things) {
    warnings.push('找不到 root/things 容器（things 引用控件缺失）')
    return { control: null, count: 0, refs: [] }
  }
  const ids = childIdsOf(things)
  const refs = []
  for (const cid of ids) {
    const child = byId.get(cid)
    if (!child) {
      warnings.push(`things 子列表登记的 #${cid} 找不到对应记录`)
      refs.push({ name: null, prefab: null, ok: false })
      continue
    }
    const prefab = readThingsPrefab(child)
    const expected = child.name === null ? undefined : sourceByName.get(child.name)
    const ok = prefab !== null && expected !== undefined && prefab === expected
    if (!ok) {
      if (expected === undefined) warnings.push(`things 引用 ${child.name || `#${cid}`} 找不到同名家具模板（无法核对引用值）`)
      else warnings.push(`things 引用 ${child.name} = ${prefab}，不等于模板源 ${expected}（坑 2：引用值必须是源 GUID）`)
    }
    refs.push({ name: child.name, prefab, ok })
  }
  // 反向：每个家具模板都应在 things 里有引用（运行时按名字/引用值实例化）
  const refNames = new Set(refs.map((r) => r.name).filter((n) => n !== null))
  for (const name of sourceByName.keys()) {
    if (!refNames.has(name)) warnings.push(`模板 ${name} 在 things 里没有对应的引用控件`)
  }
  return { control: things.id, count: ids.length, refs: refs.slice(0, limitN) }
}

/** 读一个模板引用控件的引用值（取 66/89 组件槽下的 /#503/#77/#501）。 */
function readThingsPrefab(rec) {
  for (const f505 of rec.field.sub) {
    if (f505.field !== 505 || !Array.isArray(f505.sub)) continue
    const tagField = f505.sub.find((x) => x.field === 501 && x.wt === 0)
    if (!tagField || !THINGS_REF_TAGS.includes(Number(tagField.num))) continue
    const list = f505.sub.find((x) => x.field === 503 && Array.isArray(x.sub))
    if (!list) continue
    const inner = list.sub.find((x) => x.field === 77 && Array.isArray(x.sub))
    if (!inner) continue
    const leaf = inner.sub.find((x) => x.field === 501)
    const value = idOfField(leaf)
    if (value !== null) return value
  }
  return null
}

// ════════════════════════════════════════════════════════════════════════════
// 撞号 / root 顶层
// ════════════════════════════════════════════════════════════════════════════
/** 真撞号 = 两条记录的【自身 GUID】（顶层 #501）相同（判据同 probe_guid_collision ①）。 */
function countOwnGuidCollisions(recs) {
  const groups = new Map()
  for (const rec of recs) {
    const own = idOfField(topIdField(rec))
    if (own === null) continue
    if (!groups.has(own)) groups.set(own, new Set())
    groups.get(own).add(rec.id)
  }
  let count = 0
  for (const ids of groups.values()) if (ids.size > 1) count += 1
  return count
}

/** root 下直接子控件概览（名字/自身 GUID/子列表条数）。 */
function readTopLevel(g, byId, limitN, warnings) {
  const root = g.recs.find((r) => r.name === 'root') || null
  if (!root) {
    warnings.push('找不到名为 root 的根控件记录（无法给出 root 顶层概览）')
    return []
  }
  const rows = []
  for (const cid of childIdsOf(root)) {
    const rec = byId.get(cid)
    if (!rec) {
      warnings.push(`root 子列表登记的 #${cid} 找不到对应记录`)
      rows.push({ name: null, id: cid, children: null })
      continue
    }
    rows.push({ name: rec.name, id: rec.id, children: childIdsOf(rec).length })
  }
  return rows.slice(0, limitN)
}

// ════════════════════════════════════════════════════════════════════════════
// 记录字段读取小工具（字段号陷阱见 gilread.js 头部：只取记录【顶层】）
// ════════════════════════════════════════════════════════════════════════════
/** 记录自身 GUID：顶层 #501（**不能递归取**，一条记录里 #501 会出现 7 次）。 */
function topIdField(rec) {
  return rec.field.sub.find((f) => f.field === 501 && f.wt === 0) || null
}

/** 组件块：#502 消息里 #501(枚举) = tag 的那一块（如 tag4=母本引用、tag3=源回指）。 */
function tagBlock(rec, tag) {
  for (const f of rec.field.sub) {
    if (f.field !== 502 || !Array.isArray(f.sub)) continue
    const tagField = f.sub.find((x) => x.field === 501 && x.wt === 0)
    if (tagField && Number(tagField.num) === tag) return f
  }
  return null
}

/** 从组件块的 innerField（如 #14/#13）里取 id 叶子值。 */
function refValue(rec, blockTag, innerField) {
  const block = tagBlock(rec, blockTag)
  if (!block) return null
  const inner = block.sub.find((x) => x.field === innerField)
  if (!inner || !Array.isArray(inner.sub)) return null
  return idOfField(inner.sub.find((x) => x.field === 501))
}

/**
 * 取一个"id 叶子字段"的数值：本工程有两种编码——
 *  · varint 字段（wt=0，最常见）；
 *  · 长度为 5 的 bytes 字段（内部就是一个 varint，如模板对的 #14/#13 引用；2026-10-24 实测）。
 */
function idOfField(field) {
  if (!field) return null
  if (field.wt === 0) return Number(field.num)
  if (field.payload && field.payload.length > 0 && field.payload.length <= 10) {
    const v = readVarint(field.payload, 0, field.payload.length)
    if (v && v.p === field.payload.length) return Number(v.v)
  }
  return null
}

/** 记录顶层子列表（#503）→ 子记录 id 数组。 */
function childIdsOf(rec) {
  if (!rec.childList || !rec.childList.payload) return []
  return asIdList(rec.childList.payload, true) || []
}
