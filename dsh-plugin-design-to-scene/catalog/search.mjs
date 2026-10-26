#!/usr/bin/env node
// 官方元件库检索 CLI（找素材用）
//
//   node catalog/search.mjs --name 桌
//   node catalog/search.mjs --category 人造装饰 --min 0.5 --max 2
//   node catalog/search.mjs --kind table
//   node catalog/search.mjs --name 灯 --limit 10 --json
//
// 数据：catalog/official-prefabs.json（由官方 manifest 生成）；kind-map.json 提供 SceneSpec kind 预筛。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'official-prefabs.json'), 'utf8'))
const KIND_MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'kind-map.json'), 'utf8'))

const args = process.argv.slice(2)
const get = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const has = (k) => args.includes(`--${k}`)

const name = get('name', '')
const category = get('category', '')
const kind = get('kind', '')
const min = get('min') != null ? Number(get('min')) : null          // 最小边长（米）——按最长边算
const max = get('max') != null ? Number(get('max')) : null          // 最大最长边（米）
const limit = Number(get('limit', '30'))
const asJson = has('json')

let list = DATA.prefabs
if (kind) {
  const ids = new Set((KIND_MAP.kinds[kind] || []).map((p) => p.prefabId))
  list = list.filter((p) => ids.has(p.prefabId))
}
if (name) list = list.filter((p) => p.name.includes(name) || (p.rootName || '').includes(name) || (p.tags || []).some((t) => t.includes(name)))
if (category) list = list.filter((p) => p.category === category || p.category.includes(category))
if (min != null || max != null) {
  list = list.filter((p) => {
    const longest = Math.max(p.size.x, p.size.y, p.size.z)
    if (min != null && longest < min) return false
    if (max != null && longest > max) return false
    return true
  })
}
const total = list.length
list = list.slice(0, limit)

if (asJson) {
  console.log(JSON.stringify({ total, count: list.length, items: list }, null, 2))
} else {
  console.log(`官方元件库：共 ${DATA.count} 条，匹配 ${total} 条（显示前 ${list.length}）`)
  console.log('prefab_id\tname\tcategory\t最长边(m)\t尺寸(米)\t库文件')
  for (const p of list) {
    const longest = Math.max(p.size.x, p.size.y, p.size.z).toFixed(2)
    console.log(`${p.prefabId}\t${p.name}\t${p.category}\t${longest}\t${p.size.x.toFixed(2)}×${p.size.y.toFixed(2)}×${p.size.z.toFixed(2)}\t${p.library || '-'}`)
  }
}
