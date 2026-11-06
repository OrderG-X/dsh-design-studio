/**
 * 截图里像不像有二维码：找二维码的三个「回」字定位块（黑白 1:1:3:1:1），三个摆成直角、间距合理就算像。
 * 不解码（插件不带解码库）：分享前体检只提示「像是有二维码」；内容仓库的机器人再用 jsQR 真扫，能扫出来的才退回。
 * 只依赖 Node 自带的 zlib。
 *
 *   decodePng(buf)       → { width, height, rgba } | null   （8 位、不隔行，Chrome 截图就是这种）
 *   findQrLike(img)      → { at: [[x, y] ×3], module } | null
 */

import zlib from 'node:zlib'

const MAX_PX = 40e6

/** PNG → RGBA（透明的按白底合成）；看不懂、太大返回 null */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 45 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  let i = 8
  let w = 0
  let h = 0
  let depth = 0
  let ctype = 0
  let inter = 0
  const idat = []
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const t = buf.toString('latin1', i + 4, i + 8)
    if (i + 12 + len > buf.length) return null
    const d = buf.subarray(i + 8, i + 8 + len)
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12] } else if (t === 'IDAT') idat.push(d)
    else if (t === 'IEND') break
    i += 12 + len
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]
  if (!w || !h || depth !== 8 || !ch || inter || w * h > MAX_PX) return null
  let raw
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (w * ch + 1) * h + 16 }) } catch { return null }
  const stride = w * ch
  if (raw.length < (stride + 1) * h) return null
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0
      const b = y ? px[row - stride + x] : 0
      const c = x >= ch && y ? px[row - stride + x - ch] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[row + x] = v & 255
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let k = 0, j = 0; k < w * h; k++, j += ch) {
    const o = k * 4
    const al = ch === 4 ? px[j + 3] : ch === 2 ? px[j + 1] : 255
    const mix = (v) => Math.round((v * al + 255 * (255 - al)) / 255)
    if (ch >= 3) { rgba[o] = mix(px[j]); rgba[o + 1] = mix(px[j + 1]); rgba[o + 2] = mix(px[j + 2]) } else rgba[o] = rgba[o + 1] = rgba[o + 2] = mix(px[j])
    rgba[o + 3] = 255
  }
  return { width: w, height: h, rgba }
}

/** 五段黑白的长度合不合 1:1:3:1:1；合就返回一个模块多宽，不合返回 0 */
function ratio(c) {
  const tot = c[0] + c[1] + c[2] + c[3] + c[4]
  if (tot < 7) return 0
  const m = tot / 7
  const v = m / 2
  return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v ? m : 0
}

/** 黑白图（局部阈值：比周围平均暗一截、或本来就很黑的算黑） */
function binarize({ width: w, height: h, rgba }) {
  const n = w * h
  const L = new Uint8Array(n)
  for (let k = 0; k < n; k++) L[k] = (rgba[k * 4] * 299 + rgba[k * 4 + 1] * 587 + rgba[k * 4 + 2] * 114) / 1000
  const W = w + 1
  const S = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) { row += L[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row }
  }
  const r = Math.max(7, Math.round(Math.min(w, h) / 16))
  const dark = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const mean = (S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]) / ((y1 - y0) * (x1 - x0))
      const v = L[y * w + x]
      dark[y * w + x] = v < 60 || v < mean * 0.82 ? 1 : 0
    }
  }
  return dark
}

const CAP_RUN = 400

/** 从 (x, y) 沿一个方向量五段（中间那段经过这一点）→ { m, mid } | null */
function cross(dark, w, h, x, y, dx, dy) {
  const at = (k) => { const xx = x + dx * k; const yy = y + dy * k; return xx >= 0 && yy >= 0 && xx < w && yy < h ? dark[yy * w + xx] : -1 }
  if (at(0) !== 1) return null
  const c = [0, 0, 0, 0, 0]
  let k = 0
  while (at(k) === 1 && c[2] < CAP_RUN) { c[2]++; k-- }
  while (at(k) === 0 && c[1] < CAP_RUN) { c[1]++; k-- }
  while (at(k) === 1 && c[0] < CAP_RUN) { c[0]++; k-- }
  k = 1
  while (at(k) === 1 && c[2] < CAP_RUN) { c[2]++; k++ }
  while (at(k) === 0 && c[3] < CAP_RUN) { c[3]++; k++ }
  while (at(k) === 1 && c[4] < CAP_RUN) { c[4]++; k++ }
  const m = ratio(c)
  if (!m) return null
  // 中间段的中点（相对 (x, y) 的步数）
  const end = k - c[4] - c[3]
  return { m, mid: end - c[2] / 2, tot: c.reduce((a, b) => a + b, 0) }
}

/**
 * 找「像二维码」的地方。img：{ width, height, rgba }
 * 返回第一个找到的 { at: [[x, y], [x, y], [x, y]], module } 或 null
 */
export function findQrLike(img) {
  if (!img || !img.width || !img.height || img.width * img.height > MAX_PX) return null
  const { width: w, height: h } = img
  const dark = binarize(img)
  const found = []
  for (let y = 0; y < h; y++) {
    // 这一行的黑白段
    const runs = []
    let x = 0
    while (x < w) {
      const v = dark[y * w + x]
      const s = x
      while (x < w && dark[y * w + x] === v) x++
      runs.push([v, x - s, s])
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (runs[i][0] !== 1) continue
      const c = [runs[i][1], runs[i + 1][1], runs[i + 2][1], runs[i + 3][1], runs[i + 4][1]]
      const mh = ratio(c)
      if (!mh) continue
      const cx = Math.round(runs[i + 2][2] + runs[i + 2][1] / 2)
      const v = cross(dark, w, h, cx, y, 0, 1)
      if (!v || Math.abs(v.tot - 7 * mh) > 7 * mh * 0.4) continue
      const cy = Math.round(y + v.mid)
      const hh = cross(dark, w, h, cx, cy, 1, 0)
      if (!hh || Math.abs(hh.tot - v.tot) > v.tot * 0.4) continue
      const fx = cx + hh.mid
      const m = (mh + v.m + hh.m) / 3
      const hit = found.find((f) => Math.abs(f.x - fx) <= m * 2 && Math.abs(f.y - cy) <= m * 2 && f.m / m < 1.4 && m / f.m < 1.4)
      if (hit) { hit.x = (hit.x * hit.n + fx) / (hit.n + 1); hit.y = (hit.y * hit.n + cy) / (hit.n + 1); hit.m = (hit.m * hit.n + m) / (hit.n + 1); hit.n++ } else if (found.length < 400) found.push({ x: fx, y: cy, m, n: 1 })
    }
  }
  const pts = found.filter((f) => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, 60)
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      for (let c = b + 1; c < pts.length; c++) {
        const P = [pts[a], pts[b], pts[c]]
        const ms = P.map((p) => p.m)
        const mm = (ms[0] + ms[1] + ms[2]) / 3
        if (Math.max(...ms) / Math.min(...ms) > 1.4) continue
        const d2 = (p, q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2
        const s = [d2(P[0], P[1]), d2(P[0], P[2]), d2(P[1], P[2])].sort((x, y) => x - y)
        if (s[0] / s[1] < 0.75) continue // 两条直角边差不多长
        const hyp = s[2] / (s[0] + s[1])
        if (hyp < 0.85 || hyp > 1.15) continue // 勾股：是直角
        const side = Math.sqrt((s[0] + s[1]) / 2) / mm
        if (side < 13 || side > 172) continue // 版本 1–40：定位块中心间距 14–170 个模块
        return { at: P.map((p) => [Math.round(p.x), Math.round(p.y)]), module: Math.round(mm * 10) / 10 }
      }
    }
  }
  return null
}
