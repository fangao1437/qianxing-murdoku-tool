// 纯 JS PNG 解码器（零依赖：只用 node:zlib 的 inflateSync）。
//
// 支持范围（S1 参考图够用 + 常见素材）：
//   · colorType 0（灰度）/ 2（RGB）/ 3（调色板）/ 4（灰度+alpha）/ 6（RGBA）
//   · bitDepth 1/2/4/8/16（1/2/4 只对灰度/调色板合法；16 位取高 8 位）
//   · filter 0–4（None/Sub/Up/Average/Paeth）
//   · palette（PLTE）+ 透明（tRNS）
//   · 非隔行扫描（Adam7 隔行不支持：结构化报错，不静默出错图）
//
// 导出：decodePng(bytes) → { width, height, data: Uint8Array }（RGBA，4 通道，无 alpha 时补 255）
// 损坏/不支持的 PNG 一律抛 E_SPEC_INVALID（契约 §0：失败不静默降级）。
import zlib from 'node:zlib'
import { CODES, fail } from '../errors.js'

/** PNG 文件签名（8 字节）。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 解码上限：防止损坏的 IHDR 把内存吃光（参考图标只有几百像素）。 */
const MAX_DIMENSION = 16384
const MAX_PIXELS = 64 * 1024 * 1024

// ── CRC32：PNG 每个 chunk 尾部 4 字节校验 ───────────────────────────────────
let CRC_TABLE = null

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

/**
 * 计算 CRC32（PNG chunk 的校验口径）。
 * @param {Uint8Array} bytes
 * @param {number} start 起始下标（含）
 * @param {number} end   结束下标（不含）
 */
function crc32(bytes, start, end) {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── 每像素通道数 ────────────────────────────────────────────────────────────
const CHANNELS_OF_COLOR_TYPE = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })

/** 各 colorType 合法的位深集合（PNG 规范）。 */
const BIT_DEPTHS_OF_COLOR_TYPE = Object.freeze({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
})

/** Paeth 预测器（PNG filter 4）。 */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * 解码 PNG 字节流。
 * @param {Uint8Array|Buffer} input PNG 文件字节
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA（4 通道，每通道 1 字节）
 */
export function decodePng(input) {
  if (!input || typeof input.length !== 'number' || input.length < 8 + 12 + 12) {
    fail(CODES.SPEC, 'PNG 数据为空或过短，无法解码', { bytes: input?.length ?? 0 })
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) fail(CODES.SPEC, '不是 PNG 文件（签名不符）', { offset: i })
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let sawIhdr = false
  let sawIend = false
  let palette = null // PLTE 原始字节（RGB 三元组）
  let trns = null // tRNS 原始字节
  const idatChunks = []

  let pos = PNG_SIGNATURE.length
  while (pos + 12 <= bytes.length) {
    const dataLength = bytes.readUInt32BE(pos)
    const typeStart = pos + 4
    const dataStart = pos + 8
    const dataEnd = dataStart + dataLength
    const crcEnd = dataEnd + 4
    if (dataLength > bytes.length || crcEnd > bytes.length) {
      fail(CODES.SPEC, 'PNG chunk 长度越界（文件被截断或损坏）', { offset: pos, dataLength, bytes: bytes.length })
    }
    const type = bytes.toString('latin1', typeStart, typeStart + 4)

    // 每个 chunk 都校验 CRC：损坏文件必须报错，而不是解出花屏
    const storedCrc = bytes.readUInt32BE(dataEnd)
    const actualCrc = crc32(bytes, typeStart, dataEnd)
    if (storedCrc !== actualCrc) {
      fail(CODES.SPEC, `PNG chunk ${JSON.stringify(type)} CRC 校验失败（文件损坏）`, {
        chunk: type,
        expected: storedCrc,
        actual: actualCrc,
        offset: pos,
      })
    }

    if (type === 'IHDR') {
      if (sawIhdr) fail(CODES.SPEC, 'PNG 出现重复 IHDR', { offset: pos })
      if (dataLength !== 13) fail(CODES.SPEC, 'PNG IHDR 长度必须为 13', { length: dataLength })
      width = bytes.readUInt32BE(dataStart)
      height = bytes.readUInt32BE(dataStart + 4)
      bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      const compression = bytes[dataStart + 10]
      const filterMethod = bytes[dataStart + 11]
      const interlace = bytes[dataStart + 12]
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        fail(CODES.SPEC, `PNG 尺寸非法：${width}×${height}`, { width, height })
      }
      if (width * height > MAX_PIXELS) fail(CODES.SPEC, `PNG 像素数过大：${width}×${height}`, { width, height })
      if (compression !== 0) fail(CODES.SPEC, `PNG 压缩方法非法：${compression}`, { compression })
      if (filterMethod !== 0) fail(CODES.SPEC, `PNG 过滤方法非法：${filterMethod}`, { filterMethod })
      if (interlace !== 0) {
        fail(CODES.SPEC, '不支持隔行扫描（Adam7）PNG，请改为非隔行导出', { interlace })
      }
      const allowedDepths = BIT_DEPTHS_OF_COLOR_TYPE[colorType]
      if (!allowedDepths) fail(CODES.SPEC, `不支持的 PNG colorType：${colorType}`, { colorType })
      if (!allowedDepths.includes(bitDepth)) {
        fail(CODES.SPEC, `PNG colorType=${colorType} 不支持 bitDepth=${bitDepth}`, { colorType, bitDepth })
      }
      sawIhdr = true
    } else if (type === 'PLTE') {
      if (dataLength === 0 || dataLength % 3 !== 0 || dataLength > 256 * 3) {
        fail(CODES.SPEC, 'PNG PLTE 长度非法', { length: dataLength })
      }
      palette = bytes.subarray(dataStart, dataEnd)
    } else if (type === 'tRNS') {
      trns = bytes.subarray(dataStart, dataEnd)
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      sawIend = true
      pos = crcEnd
      break
    }
    pos = crcEnd
  }

  if (!sawIhdr) fail(CODES.SPEC, 'PNG 缺少 IHDR')
  if (idatChunks.length === 0) fail(CODES.SPEC, 'PNG 缺少 IDAT 图像数据')
  if (!sawIend) fail(CODES.SPEC, 'PNG 缺少 IEND（文件可能被截断）')
  if (colorType === 3 && !palette) fail(CODES.SPEC, '调色板 PNG 缺少 PLTE')

  // ── 解压 IDAT ────────────────────────────────────────────────────────────
  let inflated
  try {
    inflated = zlib.inflateSync(Buffer.concat(idatChunks))
  } catch (err) {
    fail(CODES.SPEC, `PNG IDAT zlib 解压失败（文件损坏）：${err.message}`, { idatChunks: idatChunks.length })
  }

  const channels = CHANNELS_OF_COLOR_TYPE[colorType]
  const bitsPerPixel = channels * bitDepth
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8)
  // PNG 规范：filter 的 bpp = 一个完整像素占用的字节数，不足 1 字节按 1 字节算
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const expected = height * (rowBytes + 1)
  if (inflated.length !== expected) {
    fail(CODES.SPEC, `PNG 解压后字节数不符：期望 ${expected}，实得 ${inflated.length}`, {
      expected,
      actual: inflated.length,
      width,
      height,
    })
  }

  // ── 逐行反过滤（filter 0–4）─────────────────────────────────────────────
  const raw = new Uint8Array(height * rowBytes)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (rowBytes + 1)]
    const srcOff = y * (rowBytes + 1) + 1
    const dstOff = y * rowBytes
    const prevOff = dstOff - rowBytes
    for (let x = 0; x < rowBytes; x++) {
      const value = inflated[srcOff + x]
      const left = x >= bpp ? raw[dstOff + x - bpp] : 0
      const up = y > 0 ? raw[prevOff + x] : 0
      const upperLeft = y > 0 && x >= bpp ? raw[prevOff + x - bpp] : 0
      let predictor
      switch (filter) {
        case 0:
          predictor = 0
          break
        case 1:
          predictor = left
          break
        case 2:
          predictor = up
          break
        case 3:
          predictor = (left + up) >> 1
          break
        case 4:
          predictor = paeth(left, up, upperLeft)
          break
        default:
          fail(CODES.SPEC, `PNG 行过滤类型非法：${filter}`, { row: y, filter })
      }
      raw[dstOff + x] = (value + predictor) & 0xff
    }
  }

  // ── 取样：把位深不同的样本统一读成整数（16 位保留全值，输出时取高 8 位）──
  const sampleMask = bitDepth >= 8 ? (bitDepth === 16 ? 0xffff : 0xff) : (1 << bitDepth) - 1
  const sampleOf = (rowOffset, index) => {
    if (bitDepth === 8) return raw[rowOffset + index]
    if (bitDepth === 16) return (raw[rowOffset + index * 2] << 8) | raw[rowOffset + index * 2 + 1]
    // 1/2/4 位：大端位序，高位在前
    const bitPos = index * bitDepth
    const byte = raw[rowOffset + (bitPos >> 3)]
    const shift = 8 - bitDepth - (bitPos & 7)
    return (byte >> shift) & sampleMask
  }
  // 低位深灰度 → 0..255（与 PNG 规范的 scale 一致：1/2/4 位分别 ×255、×85、×17）
  const scaleTo8 = bitDepth === 16 ? 16 : bitDepth === 8 ? 1 : 255 / sampleMask

  const trnsGray = colorType === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : -1
  const trnsRgb =
    colorType === 2 && trns && trns.length >= 6
      ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
      : null
  const paletteCount = palette ? palette.length / 3 : 0

  // ── 转 RGBA ──────────────────────────────────────────────────────────────
  const data = new Uint8Array(width * height * 4)
  let out = 0
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 255
      switch (colorType) {
        case 0: {
          // 灰度（+ 可选 tRNS 透明色）
          const v = sampleOf(rowOff, x)
          const gray = scaleTo8 === 1 ? v : bitDepth === 16 ? v >> 8 : Math.round(v * scaleTo8)
          r = g = b = gray
          if (trnsGray >= 0 && v === trnsGray) a = 0
          break
        }
        case 2: {
          // RGB（+ 可选 tRNS 透明色）
          const rv = sampleOf(rowOff, x * 3)
          const gv = sampleOf(rowOff, x * 3 + 1)
          const bv = sampleOf(rowOff, x * 3 + 2)
          if (bitDepth === 16) {
            r = rv >> 8
            g = gv >> 8
            b = bv >> 8
          } else {
            r = rv
            g = gv
            b = bv
          }
          if (trnsRgb && rv === trnsRgb[0] && gv === trnsRgb[1] && bv === trnsRgb[2]) a = 0
          break
        }
        case 3: {
          // 调色板索引
          const index = sampleOf(rowOff, x)
          if (index >= paletteCount) {
            fail(CODES.SPEC, `PNG 调色板索引越界：${index} >= ${paletteCount}`, { index, paletteCount, x, y })
          }
          r = palette[index * 3]
          g = palette[index * 3 + 1]
          b = palette[index * 3 + 2]
          if (trns && index < trns.length) a = trns[index]
          break
        }
        case 4: {
          // 灰度 + alpha
          const gv = sampleOf(rowOff, x * 2)
          const av = sampleOf(rowOff, x * 2 + 1)
          if (bitDepth === 16) {
            r = g = b = gv >> 8
            a = av >> 8
          } else {
            r = g = b = gv
            a = av
          }
          break
        }
        case 6: {
          // RGBA
          if (bitDepth === 16) {
            r = sampleOf(rowOff, x * 4) >> 8
            g = sampleOf(rowOff, x * 4 + 1) >> 8
            b = sampleOf(rowOff, x * 4 + 2) >> 8
            a = sampleOf(rowOff, x * 4 + 3) >> 8
          } else {
            r = sampleOf(rowOff, x * 4)
            g = sampleOf(rowOff, x * 4 + 1)
            b = sampleOf(rowOff, x * 4 + 2)
            a = sampleOf(rowOff, x * 4 + 3)
          }
          break
        }
        default:
          fail(CODES.SPEC, `不支持的 PNG colorType：${colorType}`, { colorType })
      }
      data[out++] = r
      data[out++] = g
      data[out++] = b
      data[out++] = a
    }
  }

  return { width, height, data }
}

export default decodePng
