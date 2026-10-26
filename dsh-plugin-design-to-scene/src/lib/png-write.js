// 纯 JS PNG 编码器（零依赖，node:zlib 压缩）+ 一个最小 RGBA 画布
// 用途：设计图解析的 fixture 生成、SceneSpec 俯视预览渲染、测试回读校验。
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/**
 * 把 RGBA8 像素编码成 PNG。
 * @param {{ width:number, height:number, data:Uint8Array|Buffer, colorType?:number }} image
 *   colorType: 6=RGBA（默认）| 2=RGB（自动按 alpha==255 处理）
 * @returns {Buffer}
 */
export function encodePng({ width, height, data, colorType = 6 }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`encodePng: 尺寸非法 ${width}x${height}`)
  }
  const expected = width * height * 4
  if (data.length !== expected) throw new Error(`encodePng: 像素数据长度 ${data.length} ≠ ${expected}`)
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * (stride + 1) + 1 + x * channels
      raw[dst] = data[src]
      raw[dst + 1] = data[src + 1]
      raw[dst + 2] = data[src + 2]
      if (channels === 4) raw[dst + 3] = data[src + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 解析 "#RRGGBB" → [r,g,b]（非法返回 null）。 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim())
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255]
}

/** 最小 RGBA 画布（基础图元足够画俯视平面图）。 */
export class Canvas {
  constructor(width, height, fill = [0, 0, 0, 255]) {
    this.width = width
    this.height = height
    this.data = new Uint8Array(width * height * 4)
    this.fillAll(fill)
  }

  fillAll([r, g, b, a = 255]) {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r
      this.data[i + 1] = g
      this.data[i + 2] = b
      this.data[i + 3] = a
    }
  }

  setPixel(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    if (a >= 255) {
      this.data[i] = r
      this.data[i + 1] = g
      this.data[i + 2] = b
      this.data[i + 3] = 255
      return
    }
    const t = a / 255
    this.data[i] = Math.round(this.data[i] * (1 - t) + r * t)
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - t) + g * t)
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - t) + b * t)
    this.data[i + 3] = 255
  }

  /** 实心矩形（x0,y0 含；x1,y1 不含）。 */
  fillRect(x0, y0, x1, y1, color) {
    const xa = Math.max(0, Math.min(this.width, Math.floor(x0)))
    const xb = Math.max(0, Math.min(this.width, Math.ceil(x1)))
    const ya = Math.max(0, Math.min(this.height, Math.floor(y0)))
    const yb = Math.max(0, Math.min(this.height, Math.ceil(y1)))
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) this.setPixel(x, y, color)
  }

  /** 加粗线段（近似：按步长采样画方块）。 */
  drawLine(x0, y0, x1, y1, thickness, color) {
    const dx = x1 - x0
    const dy = y1 - y0
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)))
    const half = thickness / 2
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cx = x0 + dx * t
      const cy = y0 + dy * t
      this.fillRect(cx - half, cy - half, cx + half, cy + half, color)
    }
  }

  /** 实心（可旋转）矩形：中心 (cx,cy)，宽 w、高 h，绕中心旋转 rotDeg（度，屏幕坐标顺时针为正）。 */
  fillRotatedRect(cx, cy, w, h, rotDeg, color) {
    const rad = (rotDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const hw = w / 2
    const hh = h / 2
    const xs = []
    const ys = []
    for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      xs.push(cx + lx * cos - ly * sin)
      ys.push(cy + lx * sin + ly * cos)
    }
    const x0 = Math.floor(Math.min(...xs))
    const x1 = Math.ceil(Math.max(...xs))
    const y0 = Math.floor(Math.min(...ys))
    const y1 = Math.ceil(Math.max(...ys))
    const inside = (px, py) => {
      const dx = px - cx
      const dy = py - cy
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      return Math.abs(lx) <= hw && Math.abs(ly) <= hh
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (inside(x + 0.5, y + 0.5)) this.setPixel(x, y, color)
    }
  }

  /** 5×7 点阵字体（仅 ASCII 大写/数字/少量符号；够画坐标与编号）。 */
  drawText(text, x, y, scale, color) {
    const glyphs = FONT5x7
    let cursor = x
    for (const ch of String(text).toUpperCase()) {
      const glyph = glyphs[ch] || glyphs['?']
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (!glyph[row * 5 + col]) continue
          this.fillRect(cursor + col * scale, y + row * scale, cursor + (col + 1) * scale, y + (row + 1) * scale, color)
        }
      }
      cursor += 6 * scale
    }
    return cursor - x
  }

  toPng() {
    return encodePng({ width: this.width, height: this.height, data: this.data })
  }
}

// 5 列 × 7 行点阵（1 = 亮）。只覆盖数字/大写字母/常用符号，够用于预览标注。
const FONT5x7 = (() => {
  const font = {}
  const def = (ch, rows) => {
    font[ch] = rows.join('').split('').map((c) => c === '1')
  }
  def('0', ['01110', '10001', '10011', '10101', '11001', '10001', '01110'])
  def('1', ['00100', '01100', '00100', '00100', '00100', '00100', '01110'])
  def('2', ['01110', '10001', '00001', '00010', '00100', '01000', '11111'])
  def('3', ['11111', '00010', '00100', '00010', '00001', '10001', '01110'])
  def('4', ['00010', '00110', '01010', '10010', '11111', '00010', '00010'])
  def('5', ['11111', '10000', '11110', '00001', '00001', '10001', '01110'])
  def('6', ['00110', '01000', '10000', '11110', '10001', '10001', '01110'])
  def('7', ['11111', '00001', '00010', '00100', '01000', '01000', '01000'])
  def('8', ['01110', '10001', '10001', '01110', '10001', '10001', '01110'])
  def('9', ['01110', '10001', '10001', '01111', '00001', '00010', '01100'])
  def('A', ['01110', '10001', '10001', '11111', '10001', '10001', '10001'])
  def('B', ['11110', '10001', '10001', '11110', '10001', '10001', '11110'])
  def('C', ['01110', '10001', '10000', '10000', '10000', '10001', '01110'])
  def('D', ['11110', '10001', '10001', '10001', '10001', '10001', '11110'])
  def('E', ['11111', '10000', '10000', '11110', '10000', '10000', '11111'])
  def('F', ['11111', '10000', '10000', '11110', '10000', '10000', '10000'])
  def('G', ['01110', '10001', '10000', '10111', '10001', '10001', '01111'])
  def('H', ['10001', '10001', '10001', '11111', '10001', '10001', '10001'])
  def('I', ['01110', '00100', '00100', '00100', '00100', '00100', '01110'])
  def('J', ['00111', '00010', '00010', '00010', '00010', '10010', '01100'])
  def('K', ['10001', '10010', '10100', '11000', '10100', '10010', '10001'])
  def('L', ['10000', '10000', '10000', '10000', '10000', '10000', '11111'])
  def('M', ['10001', '11011', '10101', '10101', '10001', '10001', '10001'])
  def('N', ['10001', '11001', '10101', '10011', '10001', '10001', '10001'])
  def('O', ['01110', '10001', '10001', '10001', '10001', '10001', '01110'])
  def('P', ['11110', '10001', '10001', '11110', '10000', '10000', '10000'])
  def('Q', ['01110', '10001', '10001', '10001', '10101', '10010', '01101'])
  def('R', ['11110', '10001', '10001', '11110', '10100', '10010', '10001'])
  def('S', ['01111', '10000', '10000', '01110', '00001', '00001', '11110'])
  def('T', ['11111', '00100', '00100', '00100', '00100', '00100', '00100'])
  def('U', ['10001', '10001', '10001', '10001', '10001', '10001', '01110'])
  def('V', ['10001', '10001', '10001', '10001', '10001', '01010', '00100'])
  def('W', ['10001', '10001', '10001', '10101', '10101', '11011', '10001'])
  def('X', ['10001', '10001', '01010', '00100', '01010', '10001', '10001'])
  def('Y', ['10001', '10001', '01010', '00100', '00100', '00100', '00100'])
  def('Z', ['11111', '00001', '00010', '00100', '01000', '10000', '11111'])
  def(' ', ['00000', '00000', '00000', '00000', '00000', '00000', '00000'])
  def('.', ['00000', '00000', '00000', '00000', '00000', '01100', '01100'])
  def('-', ['00000', '00000', '00000', '11111', '00000', '00000', '00000'])
  def('+', ['00000', '00100', '00100', '11111', '00100', '00100', '00000'])
  def('#', ['01010', '01010', '11111', '01010', '11111', '01010', '01010'])
  def('%', ['11001', '11010', '00100', '00100', '01000', '01011', '10011'])
  def(':', ['00000', '01100', '01100', '00000', '01100', '01100', '00000'])
  def('/', ['00001', '00010', '00010', '00100', '01000', '01000', '10000'])
  def('?', ['01110', '10001', '00001', '00010', '00100', '00000', '00100'])
  return font
})()
