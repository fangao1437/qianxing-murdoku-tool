// 工具定义：不依赖 @deepseek-ai/dsh-tools（零依赖 bundle），
// 直接产出注册表接受的 ToolDefinition：
//   { name, description, parameters(JSON Schema), output:{ schema, render }, timeoutMs, isConcurrencySafe, execute }
// 参数校验由本模块做（注册表只校验 output schema，不校验入参）。
//
// ⚠ parameters 会被注册表原样放进模型请求，供应商按 JSON Schema 严格元校验；
// 本方言里的 type:'json' 不是标准 JSON Schema 类型，会让整轮请求 400：
//   Invalid schema for function 'art_build_spec': "json" is not valid under any of
//   the schemas listed in the 'anyOf' keyword
// 因此注册前必须先做「供应商投影」：type:'json' → 去掉 type、只留注解（JSON Schema 里
// 没有 type 约束即「任意值」，与 DSH 官方 defineTool 对 `json` 的编译结果一致）。
import { ArtError, CODES, errorText } from './errors.js'

const JSON_ANY = Object.freeze({})

// JSON Schema 允许的 type 取值；供应商元校验按这个枚举校验（不接受数组形式）。
const PROVIDER_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

// 允许出现在模型请求里的 schema 关键字。白名单之外的键在加载期直接抛错：
// 事故教训（2026-10-24）—— 只要有一个工具 schema 不合法，整轮请求会被供应商 400，
// 表现为「DSH 坏了」；宁可插件加载失败（离线用例立刻发现），也不能把坏 schema 送出去。
const PROVIDER_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'title',
  'additionalProperties',
  'oneOf',
  'anyOf',
  'allOf',
])

/**
 * 把本插件方言的 parameters 投影成供应商能接受的 JSON Schema。
 * - type:'json'（任意 JSON）→ 去掉 type，只保留注解；JSON Schema 里没有 type 约束就是
 *   「任意值」，等价于原来的 json 语义。
 * - properties / items / oneOf / anyOf / allOf 递归处理。
 * - 其他非标准 type 直接抛错：宁可插件加载失败（离线测试能立刻发现），也不要把一个
 *   非法 schema 送进模型请求，让整轮对话 400。
 * @param {object} schema 作者方言的值 schema
 * @param {string} [path] 报错定位用
 * @returns {object} 供应商合法 JSON Schema（新对象，不修改入参）
 */
export function providerParameters(schema, path = 'parameters') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`art tool schema ${path} 必须是对象`)
  }
  const isAnyJson = schema.type === 'json'
  if (!isAnyJson && Object.hasOwn(schema, 'type') && !PROVIDER_TYPES.has(schema.type)) {
    throw new Error(
      `art tool schema ${path}.type 不合法：${JSON.stringify(schema.type)}` +
        `（只允许 ${[...PROVIDER_TYPES].join('/')}/json）`,
    )
  }
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!PROVIDER_KEYWORDS.has(key)) {
      throw new Error(
        `art tool schema ${path}.${key} 不是允许的 JSON Schema 关键字（白名单：${[...PROVIDER_KEYWORDS].join('/')}）；` +
          `未知关键字的 schema 不合法会让整轮模型请求 400`,
      )
    }
    if (key === 'type') {
      if (!isAnyJson) out.type = value
      continue
    }
    if (key === 'properties') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`art tool schema ${path}.properties 必须是对象`)
      }
      out.properties = {}
      for (const [prop, propSchema] of Object.entries(value)) {
        out.properties[prop] = providerParameters(propSchema, `${path}.properties.${prop}`)
      }
      continue
    }
    if (key === 'items') {
      out.items = providerParameters(value, `${path}.items`)
      continue
    }
    if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`art tool schema ${path}.${key} 必须是非空数组`)
      out[key] = value.map((branch, i) => providerParameters(branch, `${path}.${key}[${i}]`))
      continue
    }
    if (key === 'required' || key === 'enum') {
      out[key] = Array.isArray(value) ? [...value] : value
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * @param {{
 *   name: string,
 *   description: string,
 *   parameters: object,
 *   timeoutMs?: number,
 *   concurrencySafe?: boolean,
 *   run: (args: any, exec: any) => Promise<any>|any,
 * }} spec
 */
export function defineArtTool({ name, description, parameters, timeoutMs, concurrencySafe = true, run }) {
  // 注册用 schema 和运行时自校验用 schema 是同一份投影，避免两者漂移。
  const schema = providerParameters(parameters)
  return {
    name,
    description,
    parameters: schema,
    output: {
      schema: JSON_ANY,
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    isConcurrencySafe: () => concurrencySafe,
    async execute(args, exec) {
      const value = args === undefined || args === null ? {} : args
      const violations = validateValue(schema, value, 'arguments')
      if (violations.length > 0) throw new Error(errorText(new ArtError(CODES.ARGS, '工具参数不合法', { violations })))
      try {
        // 宿主对工具结果做「无损 JSON」校验（-0/undefined/NaN/非普通对象都会被拒），
        // 在返回前消毒：-0 → 0、丢弃 undefined 字段、其它不可序列化值直接报错（不静默降级）。
        return toLosslessJson(await run(value, exec), 'output')
      } catch (err) {
        // 结构化错误 → 模型可见文本；未预期异常也带错误码，不吞。
        throw new Error(errorText(err))
      }
    },
  }
}

/**
 * 把工具返回值消毒成宿主接受的「无损 JSON」：
 * - `-0` → `0`（JSON 往返会变成 0，宿主判定为不无损 ⇒ 整条工具结果被拒）；
 * - 值为 `undefined` 的字段直接丢弃（JSON.stringify 同语义）；
 * - `NaN`/`Infinity`/bigint/symbol/function/循环引用/非普通对象 → 抛 E_INTERNAL（不静默降级）。
 * 事故背景（2026-10-24）：art_decompose / art_build_spec 的层 `y_up` 出现 -0，宿主直接
 * 报 `value is not lossless JSON`；mock ctx 的离线用例发现不了，因此加在出口统一兜住。
 * @param {unknown} value
 * @param {string} [pathStr]
 */
export function toLosslessJson(value, pathStr = 'output') {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new ArtError(CODES.INTERNAL, `工具输出含非有限数字：${pathStr} = ${value}`)
    return Object.is(value, -0) ? 0 : value
  }
  if (t === 'undefined') {
    throw new ArtError(CODES.INTERNAL, `工具没有返回可序列化的结果（${pathStr} = undefined）`)
  }
  if (t !== 'object') throw new ArtError(CODES.INTERNAL, `工具输出含不可序列化值（${pathStr} = ${t}）`)
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (item === undefined) throw new ArtError(CODES.INTERNAL, `工具输出数组含 undefined 项：${pathStr}[${i}]`)
      return toLosslessJson(item, `${pathStr}[${i}]`)
    })
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new ArtError(CODES.INTERNAL, `工具输出含非普通对象（${pathStr}，${value.constructor?.name || 'unknown'}）`)
  }
  const out = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    if (item === undefined) continue // JSON 语义：undefined 字段被丢弃
    out[key] = toLosslessJson(item, `${pathStr}.${key}`)
  }
  return out
}

/**
 * 校验入参（只支持本插件 schema 用到的 JSON Schema 子集：
 * object/array/string/number/integer/boolean/json + required + enum）。
 * @returns {string[]} 违规说明（空 = 通过）
 */
export function validateValue(schema, value, pathStr) {
  const violations = []
  walk(schema, value, pathStr, violations)
  return violations
}

function walk(schema, value, pathStr, violations) {
  if (!schema || typeof schema !== 'object') return
  if (schema.type === 'json' || schema.type === undefined) {
    if (schema.oneOf) {
      const matched = schema.oneOf.some((branch) => validateValue(branch, value, pathStr).length === 0)
      if (!matched) violations.push(`${pathStr} 不匹配任何 allowed 分支`)
    }
    return
  }
  const t = schema.type
  if (t === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      violations.push(`${pathStr} 必须是对象`)
      return
    }
    const props = schema.properties || {}
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) violations.push(`${pathStr}.${key} 必填`)
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (value[key] === undefined) continue
      walk(propSchema, value[key], `${pathStr}.${key}`, violations)
    }
    return
  }
  if (t === 'array') {
    if (!Array.isArray(value)) {
      violations.push(`${pathStr} 必须是数组`)
      return
    }
    if (schema.items) for (let i = 0; i < value.length; i++) walk(schema.items, value[i], `${pathStr}[${i}]`, violations)
    return
  }
  if (t === 'string') {
    if (typeof value !== 'string') violations.push(`${pathStr} 必须是字符串`)
    else if (schema.enum && !schema.enum.includes(value)) violations.push(`${pathStr} 必须是 ${schema.enum.join('|')} 之一`)
    return
  }
  if (t === 'integer') {
    if (!Number.isInteger(value)) violations.push(`${pathStr} 必须是整数`)
    else if (schema.enum && !schema.enum.includes(value)) violations.push(`${pathStr} 必须是 ${schema.enum.join('|')} 之一`)
    return
  }
  if (t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) violations.push(`${pathStr} 必须是数字`)
    return
  }
  if (t === 'boolean') {
    if (typeof value !== 'boolean') violations.push(`${pathStr} 必须是布尔值`)
    return
  }
}

/** 便捷：构造 object 参数 schema。 */
export function objectSchema(properties, required = []) {
  return { type: 'object', properties, required }
}
