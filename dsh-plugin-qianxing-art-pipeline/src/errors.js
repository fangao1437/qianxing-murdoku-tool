// 结构化错误：契约要求 { code, message, detail }，不允许静默降级。
// 工具执行时抛出的错误由 define.js 统一转成模型可见的文本（含错误码）。

export const CODES = Object.freeze({
  SPEC: 'E_SPEC_INVALID',
  BASE: 'E_BASE_MISMATCH',
  WRITE: 'E_GIL_WRITE',
  COLLISION: 'E_COLLISION',
  MARKER: 'E_MARKER',
  EDITOR: 'E_EDITOR_LOSS',
  PATH: 'E_PATH',
  IO: 'E_IO',
  ARGS: 'E_ARGS',
  NOT_IMPLEMENTED: 'E_NOT_IMPLEMENTED',
  INTERNAL: 'E_INTERNAL',
})

export class ArtError extends Error {
  /**
   * @param {string} code 错误码（CODES 中的一个）
   * @param {string} message 面向人的说明
   * @param {object} [detail] 结构化细节（不会静默丢弃）
   */
  constructor(code, message, detail) {
    super(message)
    this.name = 'ArtError'
    this.code = code
    this.detail = detail === undefined ? null : detail
  }
}

/** 抛一个结构化错误。 */
export function fail(code, message, detail) {
  throw new ArtError(code, message, detail)
}

/** 把任意异常包装成 ArtError（保留原始 message）。 */
export function asArtError(err, code = CODES.INTERNAL) {
  if (err instanceof ArtError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new ArtError(code, message, { cause: err instanceof Error ? err.stack : undefined })
}

/** 契约 §0：失败必须抛结构化错误，错误文本里带错误码。 */
export function errorText(err) {
  const e = asArtError(err)
  const parts = [`[${e.code}] ${e.message}`]
  if (e.detail !== null && e.detail !== undefined) {
    try {
      parts.push(`detail=${JSON.stringify(e.detail)}`)
    } catch {
      parts.push('detail=(unserializable)')
    }
  }
  return parts.join(' | ')
}
