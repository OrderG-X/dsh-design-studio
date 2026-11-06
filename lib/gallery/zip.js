/**
 * 极简 zip：打包（只存储不压缩，CRC32 自己算）和解包（存储 / deflate），不加依赖。
 *
 * 解包是给「朋友传来的 zip」用的，按不可信数据处理：
 *   - 只收普通文件（目录项跳过）；软链接、加密、分卷、zip64 一律拒
 *   - 路径：不能是绝对路径、不能有 ..、反斜杠、NUL、控制字符；Mac 打包带的 __MACOSX/、.DS_Store 直接跳过
 *   - 个数、单个大小、总大小都有上限，解压时按上限截断（防 zip 炸弹：声明的大小不可信，以实际解出来的为准）
 * 规则（扩展名白名单、内容检查）在 policy.js 的 checkPack 里，这里只管拆包本身安全
 */

import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间（zip 里的修改时间） */
function dosTime(d) {
  const y = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** [{ path, data: Buffer }] → zip 的 Buffer（文件名 UTF-8，只存储） */
export function writeZip(files, { now = new Date() } = {}) {
  const { time, date } = dosTime(now)
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(String(f.path), 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8')
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // 解压要的版本
    lh.writeUInt16LE(0x0800, 6) // 第 11 位：文件名是 UTF-8
    lh.writeUInt16LE(0, 8) // 只存储
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, name, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(0x031e, 4) // 做出来的版本：Unix
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(time, 12)
    ch.writeUInt16LE(date, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30)
    ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34)
    ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38) // 普通文件 rw-r--r--
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

export const ZIP_LIMITS = { files: 200, file: 4 * 1024 * 1024, total: 12 * 1024 * 1024, zip: 8 * 1024 * 1024 }

class ZipError extends Error {
  constructor(code, x = '') {
    super(`${code}${x ? ': ' + x : ''}`)
    this.code = code
    this.x = x
  }
}

/** Mac / Windows 打包时顺手塞进去的东西：不算设计文件，直接跳过 */
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i

/** zip 里的路径 → 干净的相对路径；不安全给 null */
function safeName(raw) {
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.')
  if (!parts.length || parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/**
 * zip 的 Buffer → { files: [{ path, data }], skipped: [路径] }；不安全 / 坏的抛 ZipError（code：bad / big / count / link / crypt / method / zip64 / path / dup）
 * 包外面套了一层同名文件夹（「晨光咖啡/home.html」）的，自动去掉这一层
 */
export function readZip(buf, limits = ZIP_LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError('bad')
  if (buf.length > limits.zip) throw new ZipError('big')
  // 找中央目录结尾（最后 64KB + 22 字节内）
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new ZipError('bad')
  const disk = buf.readUInt16LE(eocd + 4)
  const cdDisk = buf.readUInt16LE(eocd + 6)
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (disk !== 0 || cdDisk !== 0) throw new ZipError('bad', 'multi-disk')
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('zip64')
  if (cdOff + cdSize > eocd) throw new ZipError('bad')
  if (count > limits.files * 2) throw new ZipError('count')

  const entries = []
  let p = cdOff
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('bad')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const made = buf.readUInt16LE(p + 4) >> 8
    const ext = buf.readUInt32LE(p + 38)
    const loff = buf.readUInt32LE(p + 42)
    if (p + 46 + nlen > eocd) throw new ZipError('bad')
    const nameBuf = buf.subarray(p + 46, p + 46 + nlen)
    // 文件名：标了 UTF-8 的按 UTF-8；没标的也先按 UTF-8 认（Mac 自带的压缩就是这样），认不出来按 latin1 当乱码路径，后面会被拒
    const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBuf)
    p += 46 + nlen + xlen + clen
    const isDir = name.endsWith('/')
    if (JUNK.test(name)) continue
    if (isDir) continue
    if (flags & 1) throw new ZipError('crypt', name)
    if (made === 3) {
      const mode = (ext >>> 16) & 0o170000
      if (mode === 0o120000) throw new ZipError('link', name) // 软链接
      if (mode && mode !== 0o100000) throw new ZipError('link', name) // 设备文件、管道之类
    }
    if (csize === 0xffffffff || usize === 0xffffffff || loff === 0xffffffff) throw new ZipError('zip64')
    if (method !== 0 && method !== 8) throw new ZipError('method', name)
    const clean = safeName(name)
    if (!clean) throw new ZipError('path', name)
    if (usize > limits.file) throw new ZipError('big', clean)
    entries.push({ name: clean, method, crc, csize, usize, loff, flags })
  }
  if (entries.length > limits.files) throw new ZipError('count')

  const files = []
  const seen = new Set()
  let total = 0
  for (const e of entries) {
    if (e.loff + 30 > buf.length || buf.readUInt32LE(e.loff) !== 0x04034b50) throw new ZipError('bad', e.name)
    const start = e.loff + 30 + buf.readUInt16LE(e.loff + 26) + buf.readUInt16LE(e.loff + 28)
    if (start + e.csize > buf.length) throw new ZipError('bad', e.name)
    const raw = buf.subarray(start, start + e.csize)
    let data
    if (e.method === 0) {
      data = Buffer.from(raw)
    } else {
      try {
        // 以实际解出来的为准：超过单个上限就停（maxOutputLength 超了会抛）
        data = zlib.inflateRawSync(raw, { maxOutputLength: limits.file })
      } catch {
        throw new ZipError('big', e.name)
      }
    }
    if (data.length !== e.usize || crc32(data) !== e.crc) throw new ZipError('bad', e.name)
    total += data.length
    if (total > limits.total) throw new ZipError('big')
    const key = e.name.toLowerCase()
    if (seen.has(key)) throw new ZipError('dup', e.name)
    seen.add(key)
    files.push({ path: e.name, data })
  }
  // 外面套了一层文件夹：所有文件都在同一个顶层目录里 → 去掉这一层
  const tops = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')))
  let wrapper = ''
  if (files.length && tops.size === 1 && !tops.has('')) {
    wrapper = [...tops][0]
    for (const f of files) f.path = f.path.slice(wrapper.length + 1)
  }
  return { files, wrapper }
}

export { ZipError }
