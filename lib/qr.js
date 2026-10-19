/**
 * 二维码（给「手机上看」用）：字节模式、纠错等级 M、版本 1–10（最长 213 个字节，链接绰绰有余），
 * 8 种掩码按标准的扣分规则挑最好的。只依赖 Node / 浏览器都有的东西，不引第三方库。
 *
 *   qrMatrix('http://192.168.1.8:51234/?k=…') → [[true, false, …], …]（true = 黑块，不含四周留白）
 */

// 纠错等级 M：每版 [每块纠错码字数, 第一组块数, 第一组每块数据码字, 第二组块数, 第二组每块数据码字]
const BLOCKS_M = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
]
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const MAX_VERSION = 10

/** GF(256) 乘法，本原多项式 0x11D */
function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < degree) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 2)
  }
  return out
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()
    out.push(0)
    divisor.forEach((c, i) => { out[i] ^= gfMul(c, factor) })
  }
  return out
}

function dataCapacity(v) {
  const [, n1, d1, n2, d2] = BLOCKS_M[v]
  return n1 * d1 + n2 * d2
}

/** 数据码字：模式 + 长度 + 内容 + 结束符 + 补齐 */
function encodeData(bytes, v) {
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCapacity(v) * 8
  put(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  const out = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad)
  return out
}

/** 分块、加纠错码、交错 */
function interleave(data, v) {
  const [ec, n1, d1, n2, d2] = BLOCKS_M[v]
  const div = rsDivisor(ec)
  const blocks = []
  let k = 0
  for (let i = 0; i < n1 + n2; i++) {
    const len = i < n1 ? d1 : d2
    const d = data.slice(k, k + len)
    k += len
    blocks.push({ d, e: rsRemainder(d, div) })
  }
  const out = []
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i])
  return out
}

/** 格式信息：纠错等级 M（00）+ 掩码，BCH(15,5) */
export function formatBits(mask) {
  const data = (0 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

function versionBits(v) {
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (v << 12) | rem
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** 一版的底子：定位、对齐、时序图案，格式 / 版本信息的位置先占上；m[y][x] */
function base(v) {
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const pos = ALIGN[v]
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const last = pos.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  drawFormat(m, fn, 0)
  if (v >= 7) {
    const bits = versionBits(v)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, dark)
      set(b, a, dark)
    }
  }
  return { size, m, fn }
}

function drawFormat(m, fn, mask) {
  const size = m.length
  const bits = formatBits(mask)
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true }
  const bit = (i) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true) // 固定的黑块
}

/** 码字按之字形从右下角往上填 */
function placeData(m, fn, codewords) {
  const size = m.length
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (fn[y][x] || i >= codewords.length * 8) continue
        m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
        i++
      }
    }
  }
}

function applyMask(m, fn, mask) {
  const f = MASKS[mask]
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x]
}

/** 标准扣分：连续同色、2×2 色块、像定位图案的序列、黑白比例 */
function penalty(m) {
  const size = m.length
  let score = 0
  const lines = []
  for (let y = 0; y < size; y++) lines.push(m[y])
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]))
  const LIKE = [true, false, true, true, true, false, true]
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else { if (run >= 5) score += 3 + (run - 5); run = 1 }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!LIKE.every((v, k) => line[i + k] === v)) continue
      const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k])
      const lightAfter = i + 11 <= size && [7, 8, 9, 10].every((k) => !line[i + k])
      if (lightBefore || lightAfter) score += 40
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y][x]
      if (m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3
    }
  }
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
  return score
}

/**
 * 文字 → 二维码矩阵（m[行][列]，true 是黑块）。太长（超过版本 10 的容量）抛错。
 * @param mask 指定掩码（测试用）；不给就挑扣分最少的
 */
export function qrMatrix(text, mask) {
  const bytes = [...new TextEncoder().encode(String(text))]
  let v = 1
  while (v <= MAX_VERSION && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(v) * 8) v++
  if (v > MAX_VERSION) throw new Error('内容太长，放不进二维码')
  const codewords = interleave(encodeData(bytes, v), v)
  let best = null
  for (let k = 0; k < 8; k++) {
    if (mask !== undefined && k !== mask) continue
    const { m, fn } = base(v)
    placeData(m, fn, codewords)
    applyMask(m, fn, k)
    drawFormat(m, fn, k)
    const s = mask !== undefined ? 0 : penalty(m)
    if (!best || s < best.s) best = { m, s }
  }
  return best.m
}

/** 矩阵 → SVG 路径（每个黑块一个 1×1 的方块，viewBox 留 4 格白边） */
export function qrPath(m) {
  let d = ''
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`
  return d
}
