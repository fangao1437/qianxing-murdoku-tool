#!/usr/bin/env node
// 组装云端副本：_dist/design-to-scene-cloud/
//   1) dsh-plugin-design-to-scene/          —— 插件本体（可直接 dsh plugin add / 目录挂载）
//   2) dsh-plugin-design-to-scene-vX.Y.Z.zip —— 插件副本压缩包
//   3) dsh-design-to-scene-cloud-vX.Y.Z.zip  —— 云端部署包（插件 + cloud/ + 文档）
//   4) MANIFEST.json                          —— 文件数/SHA256/生成时间
//
// 用法（插件根目录）：node cloud/build-bundle.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_ROOT = path.resolve(PLUGIN_ROOT, '..', '_dist', 'design-to-scene-cloud')
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const PLUGIN_NAME = pkg.name

/** 递归列出文件（返回相对路径，统一正斜杠）。 */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(base, abs).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (['_work', '_dist', 'node_modules', '.git'].includes(entry.name)) continue
      walk(abs, base, out)
    } else {
      if (entry.name.endsWith('.zip')) continue
      out.push(rel)
    }
  }
  return out
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function copyFile(rel, targetRoot) {
  const src = path.join(PLUGIN_ROOT, rel)
  const dst = path.join(targetRoot, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

/** Windows 上 bsdtar 支持 `-a` 按扩展名生成 zip；Linux 上 zip/tar 均可。 */
function makeZip(sourceDir, zipPath) {
  rmrf(zipPath)
  try {
    execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', sourceDir, '.'], { stdio: 'pipe' })
  } catch (error) {
    try {
      execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: sourceDir, stdio: 'pipe' })
    } catch {
      throw new Error(`打包失败（需要 tar -a 或 zip）：${error.message}`)
    }
  }
  return fs.statSync(zipPath).size
}

// 1) 组装插件副本
const stageRoot = path.join(DIST_ROOT, PLUGIN_NAME)
rmrf(DIST_ROOT)
fs.mkdirSync(stageRoot, { recursive: true })
const files = walk(PLUGIN_ROOT)
for (const rel of files) copyFile(rel, stageRoot)

// 2) 云端部署包 = 插件副本 + 顶层文档
const cloudRoot = path.join(DIST_ROOT, 'cloud-package')
fs.mkdirSync(cloudRoot, { recursive: true })
for (const rel of files) copyFile(rel, path.join(cloudRoot, PLUGIN_NAME))
fs.copyFileSync(path.join(PLUGIN_ROOT, 'cloud', 'README-腾讯云部署.md'), path.join(cloudRoot, 'README-腾讯云部署.md'))

// 3) 压缩
const pluginZip = path.join(DIST_ROOT, `${PLUGIN_NAME}-v${VERSION}.zip`)
const cloudZip = path.join(DIST_ROOT, `dsh-design-to-scene-cloud-v${VERSION}.zip`)
const pluginZipBytes = makeZip(stageRoot, pluginZip)
const cloudZipBytes = makeZip(cloudRoot, cloudZip)

// 4) MANIFEST
const manifest = {
  name: `${PLUGIN_NAME} cloud bundle`,
  version: VERSION,
  generatedAt: new Date().toISOString(),
  pluginRoot: PLUGIN_NAME,
  fileCount: files.length,
  files: files.map((rel) => ({ path: rel, bytes: fs.statSync(path.join(PLUGIN_ROOT, rel)).size, sha256: sha256(path.join(PLUGIN_ROOT, rel)) })),
  zips: [
    { path: path.basename(pluginZip), bytes: pluginZipBytes, sha256: sha256(pluginZip) },
    { path: path.basename(cloudZip), bytes: cloudZipBytes, sha256: sha256(cloudZip) },
  ],
}
fs.writeFileSync(path.join(DIST_ROOT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
// cloud-package 只是中间目录，压缩后删掉
rmrf(cloudRoot)

console.log(`云端副本已生成：${DIST_ROOT}`)
console.log(`  插件目录   : ${path.relative(DIST_ROOT, stageRoot) || '.'}（${files.length} 个文件）`)
console.log(`  插件压缩包 : ${path.relative(process.cwd(), pluginZip)}（${(pluginZipBytes / 1024).toFixed(1)} KB）`)
console.log(`  云端部署包 : ${path.relative(process.cwd(), cloudZip)}（${(cloudZipBytes / 1024).toFixed(1)} KB）`)
console.log(`  MANIFEST   : ${path.relative(process.cwd(), path.join(DIST_ROOT, 'MANIFEST.json'))}`)
