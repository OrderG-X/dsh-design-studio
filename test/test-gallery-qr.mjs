/**
 * 二维码检测：PNG 解码、找三个定位块（插件只提示，机器人另用 jsQR 真扫）
 */
import zlib from 'node:zlib'
import { qrMatrix } from '../lib/qr.js'
import { decodePng, findQrLike } from '../lib/gallery/qrfind.js'

let pass = 0
let fail = 0
const check = (name, ok, more = '') => { if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${more}`) } }

const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
/** RGB 像素 → PNG（每行用不同的过滤方式，顺便测解码） */
function png(w, h, rgb, ctype = 2) {
  const ch = ctype === 6 ? 4 : 3
  const stride = w * ch
  const raw = Buffer.alloc((stride + 1) * h)
  const px = Buffer.alloc(stride * h)
  for (let i = 0; i < w * h; i++) { px[i * ch] = rgb[i * 3]; px[i * ch + 1] = rgb[i * 3 + 1]; px[i * ch + 2] = rgb[i * 3 + 2]; if (ch === 4) px[i * ch + 3] = 255 }
  for (let y = 0; y < h; y++) {
    const f = y % 5
    raw[y * (stride + 1)] = f
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x]
      const a = x >= ch ? px[y * stride + x - ch] : 0
      const b = y ? px[(y - 1) * stride + x] : 0
      const c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0
      let pr = 0
      if (f === 1) pr = a
      else if (f === 2) pr = b
      else if (f === 3) pr = (a + b) >> 1
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      raw[y * (stride + 1) + 1 + x] = (v - pr) & 255
    }
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = ctype
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const canvas = (w, h, bg = [255, 255, 255]) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) { b[i * 3] = bg[0]; b[i * 3 + 1] = bg[1]; b[i * 3 + 2] = bg[2] } return b }
function box(b, w, x0, y0, bw, bh, col) { for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) { const i = (y * w + x) * 3; b[i] = col[0]; b[i + 1] = col[1]; b[i + 2] = col[2] } }
function drawQr(b, w, ox, oy, mod, col = [0, 0, 0]) {
  const M = qrMatrix('https://example.com/pay?id=42')
  for (let y = 0; y < M.length; y++) for (let x = 0; x < M.length; x++) if (M[y][x]) box(b, w, ox + x * mod, oy + y * mod, mod, mod, col)
}

const W = 390
const H = 844
{
  const b = canvas(W, H, [10, 120, 200])
  const d = decodePng(png(W, H, b, 6))
  check('PNG 解码：五种过滤、RGBA', d && d.width === W && d.height === H && d.rgba[0] === 10 && d.rgba[(W * H - 1) * 4 + 2] === 200 && d.rgba[3] === 255)
  check('PNG 解码：不是 PNG / 截断的给 null', decodePng(Buffer.from('not a png')) === null && decodePng(png(W, H, b).subarray(0, 60)) === null)
}
for (const mod of [2, 3, 5]) {
  const b = canvas(W, H, [246, 243, 234])
  drawQr(b, W, 90, 400, mod)
  check(`找到二维码（每格 ${mod} 像素，米色底）`, !!findQrLike(decodePng(png(W, H, b))))
}
{
  const b = canvas(W, H)
  drawQr(b, W, 40, 40, 3, [30, 80, 50])
  check('深绿色的二维码也找得到', !!findQrLike(decodePng(png(W, H, b))))
}
{
  // 一列单选按钮（同心）：排成一条线，不是直角 → 不算
  const b = canvas(W, H)
  for (let k = 0; k < 4; k++) { const y = 100 + k * 60; box(b, W, 40, y, 21, 21, [0, 0, 0]); box(b, W, 43, y + 3, 15, 15, [255, 255, 255]); box(b, W, 46, y + 6, 9, 9, [0, 0, 0]) }
  // 文字一样的竖条
  for (let y = 400; y < 800; y += 24) for (let x = 20; x < 370; x += 9) if ((x * 7 + y) % 5 < 3) box(b, W, x, y, 5, 14, [20, 20, 20])
  check('一列单选按钮、大段文字：不算二维码', findQrLike(decodePng(png(W, H, b))) === null)
}
check('没有图 / 空图：null', findQrLike(null) === null && findQrLike({ width: 0, height: 0, rgba: new Uint8ClampedArray(0) }) === null)

console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
