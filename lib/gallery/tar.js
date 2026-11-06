/**
 * 极简 tar 读取（npm 包的 .tgz：gzip + ustar），不加依赖。按不可信数据处理：
 *   - 只收 package/ 下的普通文件（目录项跳过）；软链接、硬链接、设备文件、pax 全局头之外的怪类型一律拒
 *   - 路径：不能是绝对路径、不能有 ..、反斜杠、NUL、控制字符
 *   - 个数、单个大小、总大小有上限；解压按上限截断（声明的大小不可信）
 *   - 扩展名白名单在调用方（policy.js）再过一遍；.js 永远不写盘
 */

import zlib from 'node:zlib'

export const TAR_LIMITS = { files: 2000, file: 8 * 1024 * 1024, total: 100 * 1024 * 1024 }

class TarError extends Error {
  constructor(code, x = '') {
    super(`${code}${x ? ': ' + x : ''}`)
    this.code = code
    this.x = x
  }
}

function str(buf, start, len) {
  const b = buf.subarray(start, start + len)
  const nul = b.indexOf(0)
  return (nul < 0 ? b : b.subarray(0, nul)).toString('utf8')
}

function octal(buf, start, len) {
  const s = str(buf, start, len).trim()
  if (!s) return 0
  if (!/^[0-7]+$/.test(s)) throw new TarError('bad', 'size')
  return parseInt(s, 8)
}

function safeName(raw) {
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.')
  if (!parts.length || parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/**
 * pax 扩展头里的 path（长文件名）；别的键不认
 * 记录是「<字节数> key=value\n」，长度按字节算（中文一个字 3 字节），所以按 Buffer 偏移切，不能按字符串下标
 * 记录边界不对（长度越界、不以换行结尾、没有空格）就整个头作废：抛 bad
 */
function paxPath(data) {
  let i = 0
  let out = ''
  while (i < data.length) {
    if (data[i] === 0) break // 尾部补零
    const sp = data.indexOf(0x20, i)
    if (sp < 0 || sp - i > 20) throw new TarError('bad', 'pax')
    const lenStr = data.toString('latin1', i, sp)
    if (!/^[1-9][0-9]*$/.test(lenStr)) throw new TarError('bad', 'pax')
    const n = Number(lenStr)
    const end = i + n
    if (end > data.length || end <= sp + 1 || data[end - 1] !== 0x0a) throw new TarError('bad', 'pax')
    const rec = data.subarray(sp + 1, end - 1)
    const eq = rec.indexOf(0x3d)
    if (eq > 0 && rec.toString('utf8', 0, eq) === 'path') out = rec.toString('utf8', eq + 1)
    i = end
  }
  return out
}

/**
 * .tgz（或已解压的 .tar）→ [{ path, data }]，path 已去掉 package/ 前缀
 * 拒：TarError code = bad / big / count / link / path
 */
export function readTar(input, limits = TAR_LIMITS) {
  let buf = input
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { buf = zlib.gunzipSync(buf, { maxOutputLength: limits.total + limits.files * 1024 + 1024 * 1024 }) } catch { throw new TarError('big') }
  }
  const files = []
  const seen = new Set()
  let total = 0
  let pending = '' // pax 头给下一项的名字
  let off = 0
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512)
    if (h.every((b) => b === 0)) break
    // 校验和：头里 148–155 当空格算
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]
    if (sum !== octal(h, 148, 8)) throw new TarError('bad', 'checksum')
    const type = String.fromCharCode(h[156] || 48)
    const size = octal(h, 124, 12)
    const prefix = str(h, 345, 155)
    const name = pending || (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100))
    pending = ''
    const start = off + 512
    const end = start + size
    if (end > buf.length) throw new TarError('bad', 'truncated')
    off = start + Math.ceil(size / 512) * 512
    if (type === 'x') { pending = paxPath(buf.subarray(start, end)); continue }
    if (type === 'g') continue
    if (type === '5') continue // 目录
    if (type === '1' || type === '2') throw new TarError('link', name)
    if (type !== '0' && type !== '\0' && type !== '7') throw new TarError('link', name) // 设备、管道、GNU 长名之类
    const clean = safeName(name)
    if (!clean || !clean.startsWith('package/')) throw new TarError('path', name)
    const rel = clean.slice('package/'.length)
    if (!rel) continue
    if (size > limits.file) throw new TarError('big', rel)
    total += size
    if (total > limits.total) throw new TarError('big')
    const key = rel.toLowerCase()
    if (seen.has(key)) throw new TarError('path', rel)
    seen.add(key)
    files.push({ path: rel, data: Buffer.from(buf.subarray(start, end)) })
    if (files.length > limits.files) throw new TarError('count')
  }
  return files
}

export { TarError }
