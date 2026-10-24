// 路径与 JSON 读写：相对路径一律相对「工作区根」解析。
// 工作区根 = 插件配置 workspaceRoot（非空时） > 会话当前工作目录 > process.cwd()。
import fs from 'node:fs'
import path from 'node:path'
import { ArtError, CODES, fail } from './errors.js'

/** 从工具执行的 exec 上下文取会话工作目录（无则回退 process.cwd()）。 */
export function sessionCwd(exec) {
  try {
    const cwd = exec?.agent?.session?.header?.cwd
    if (typeof cwd === 'string' && cwd.trim()) return cwd
  } catch {
    /* 不因宿主内部结构变化而失败 */
  }
  return process.cwd()
}

/** 解析本次调用的工作区根。 */
export function workspaceRoot(exec, config) {
  const configured = typeof config?.workspaceRoot === 'string' ? config.workspaceRoot.trim() : ''
  return configured ? path.resolve(configured) : path.resolve(sessionCwd(exec))
}

/** 把（可能是相对的）路径解析成绝对路径。 */
export function resolvePath(input, root) {
  if (typeof input !== 'string' || !input.trim()) fail(CODES.PATH, '路径不能为空', { input })
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input)
}

/** 相对工作区的展示路径（用于报告）。 */
export function displayPath(abs, root) {
  const rel = path.relative(root, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return abs
  return rel.split(path.sep).join('/')
}

/** 读 UTF-8 JSON（去掉 BOM；失败给结构化错误）。 */
export function readJsonFile(abs, label = 'JSON') {
  let text
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch (err) {
    fail(CODES.IO, `读不到${label}：${abs}（${err.message}）`, { path: abs })
  }
  const clean = text.replace(/^\uFEFF/, '')
  try {
    return JSON.parse(clean)
  } catch (err) {
    fail(CODES.IO, `${label}不是合法 JSON：${abs}（${err.message}）`, { path: abs })
  }
}

/** 写 UTF-8 JSON（无 BOM；自动建父目录；先写临时文件再改名，避免写半截）。 */
export function writeJsonFile(abs, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  writeTextFile(abs, text)
}

/** 写 UTF-8 文本（无 BOM；自动建父目录；原子改名）。 */
export function writeTextFile(abs, text) {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, Buffer.from(text, 'utf8'))
    fs.renameSync(tmp, abs)
  } catch (err) {
    fail(CODES.IO, `写不了文件：${abs}（${err.message}）`, { path: abs })
  }
}

/** 读二进制（.gil / .png）。 */
export function readBinaryFile(abs, label = '文件') {
  try {
    return fs.readFileSync(abs)
  } catch (err) {
    fail(CODES.IO, `读不到${label}：${abs}（${err.message}）`, { path: abs })
  }
}

/** 写二进制（.gil / .png）。 */
export function writeBinaryFile(abs, buf) {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, buf)
  } catch (err) {
    fail(CODES.IO, `写不了文件：${abs}（${err.message}）`, { path: abs })
  }
}

/**
 * 契约 §0：输出文件不得覆盖输入文件。
 * @param {Array<string|null|undefined>} inputs 绝对路径
 * @param {string} output 绝对路径
 */
export function assertNotOverwrite(inputs, output) {
  const out = path.resolve(output)
  for (const input of inputs) {
    if (!input) continue
    if (path.resolve(input) === out) {
      fail(CODES.PATH, '输出文件不得覆盖输入文件', { input: path.resolve(input), output: out })
    }
  }
}

/** 文件是否存在。 */
export function exists(abs) {
  try {
    return fs.existsSync(abs)
  } catch {
    return false
  }
}

/** 文件字节数。 */
export function fileSize(abs) {
  try {
    return fs.statSync(abs).size
  } catch {
    return null
  }
}

/**
 * 契约的「值可以是内联 JSON 也可以是文件路径」读取器。
 * @param {unknown} value 字符串 = 路径（相对工作区根）；对象 = 内联 JSON
 * @param {string} root 工作区根
 * @param {string} label 报错时用的名字
 * @returns {{ value: any, source: string|null }} source=null 表示内联
 */
export function loadJsonArg(value, root, label) {
  if (value === undefined || value === null) fail(CODES.ARGS, `缺少 ${label}`, { label })
  if (typeof value === 'string') {
    const abs = resolvePath(value, root)
    return { value: readJsonFile(abs, label), source: abs }
  }
  if (typeof value !== 'object') fail(CODES.ARGS, `${label} 必须是 JSON 对象或文件路径`, { label, type: typeof value })
  return { value, source: null }
}

export { ArtError }
