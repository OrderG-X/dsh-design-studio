/**
 * 设计库 › 灵感：只存在用户电脑上，不上传、不统计
 *
 *   <库>/inspiration.json          { format: 1, items: [{ id, type, at, … }] }，新的在前
 *     image  { name, file, w, h }   拖进来的参考图（图在 <库>/inspiration/<file>）→「照这个做」走参考图流程
 *     url    { url, name }          存下的网址 →「提取设计系统」
 *     style  { name, style, mid? }  我的风格（从当前设计存下来的一组配色、字体、圆角；mid＝从市场收藏的那张）→ 和内置风格卡放一起用
 *     market { mid, mtype, name }   收藏的市场设计（模板 / 设计系统）：只记 id；离线看靠市场缓存，下架了界面标「已下架」
 *
 * 风格的字段和风格卡一样（policy.checkStyle 的白名单）；本机存的不卡对比度（分享时才卡）
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LIBRARY_DIR } from './works.js'
import { checkStyle, imageInfo } from './gallery/policy.js'
import { ID_RE } from './gallery/market.js'

const MAX_ITEMS = 300
const MAX_IMAGE = 6 * 1024 * 1024
const IMG_EXT = { png: 'png', jpg: 'jpg', webp: 'webp', gif: 'gif', avif: 'avif' }
const oneLine = (s, n) => [...String(s == null ? '' : s).replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, n).join('')

export function createInspiration({ dir = LIBRARY_DIR, log = () => {}, now = Date.now } = {}) {
  const file = path.join(dir, 'inspiration.json')
  const imgDir = path.join(dir, 'inspiration')

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw && Array.isArray(raw.items)) return { format: 1, items: raw.items.filter((x) => x && typeof x.id === 'string' && /^[a-z0-9]{8,32}$/.test(x.id)) }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        log(e)
        try { fs.copyFileSync(file, `${file}.bad-${now()}`) } catch { /* 算了 */ }
      }
    }
    return { format: 1, items: [] }
  }

  function save(data) {
    // 太多了：最旧的图片 / 网址先删（我的风格、收藏留着）
    while (data.items.length > MAX_ITEMS) {
      let i = data.items.length - 1
      while (i >= 0 && (data.items[i].type === 'style' || data.items[i].type === 'market')) i--
      if (i < 0) break
      const [gone] = data.items.splice(i, 1)
      if (gone.type === 'image' && gone.file) try { fs.rmSync(path.join(imgDir, gone.file), { force: true }) } catch { /* 算了 */ }
    }
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  const newId = () => crypto.randomBytes(8).toString('hex')

  function add(item) {
    const data = load()
    const it = { id: newId(), at: now(), ...item }
    data.items.unshift(it)
    save(data)
    return it
  }

  /** 参考图：data 是图片的 Buffer */
  function addImage({ name, data }) {
    if (!Buffer.isBuffer(data) || !data.length) throw new Error('不是图片')
    if (data.length > MAX_IMAGE) throw new Error('图片太大（最多 6MB）')
    const info = imageInfo(data)
    const ext = info && IMG_EXT[info.type]
    if (!ext) throw new Error('不是图片')
    const id = newId()
    fs.mkdirSync(imgDir, { recursive: true })
    fs.writeFileSync(path.join(imgDir, `${id}.${ext}`), data, { mode: 0o600 })
    const data2 = load()
    const it = { id, at: now(), type: 'image', name: oneLine(name, 60) || 'image', file: `${id}.${ext}`, w: info.w, h: info.h }
    data2.items.unshift(it)
    save(data2)
    return it
  }

  /** 网址：只收 http(s)，带不带协议都行 */
  function addUrl({ url, name }) {
    let s = String(url || '').trim()
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s
    let u
    try { u = new URL(s) } catch { throw new Error('不是网址') }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || s.length > 500) throw new Error('不是网址')
    const data = load()
    const href = u.href
    const old = data.items.find((x) => x.type === 'url' && x.url === href)
    if (old) return old
    return add({ type: 'url', url: href, name: oneLine(name, 60) || u.hostname })
  }

  /** 我的风格：字段按风格卡的白名单查；对比度本机不卡 */
  function addStyle({ name, style, mid }) {
    const problems = checkStyle(style).filter((p) => p.code !== 'contrast')
    if (problems.length) throw new Error(`风格不对：${problems.map((p) => p.x).join('、')}`)
    const s = {}
    for (const k of ['c', 'head', 'w', 'radius', 'shadow', 'nzh', 'nen', 'dzh', 'den', 'bgImage']) if (style[k] !== undefined) s[k] = style[k]
    // 从市场收藏的：同一张只存一份
    const from = typeof mid === 'string' && ID_RE.test(mid) ? mid : ''
    if (from) {
      const old = load().items.find((x) => x.type === 'style' && x.mid === from)
      if (old) return old
    }
    return add({ type: 'style', name: oneLine(name, 24) || '我的风格', style: s, ...(from ? { mid: from } : {}) })
  }

  /** 收藏市场上的一套：同一套只记一次 */
  function addMarket({ mid, mtype, name }) {
    const id = String(mid || '')
    if (!ID_RE.test(id) || (mtype !== 'template' && mtype !== 'system')) throw new Error('不是市场上的设计')
    const data = load()
    const old = data.items.find((x) => x.type === 'market' && x.mid === id)
    if (old) return old
    return add({ type: 'market', mid: id, mtype, name: oneLine(name, 40) || id.split('__')[1] })
  }

  function remove(id) {
    const data = load()
    const i = data.items.findIndex((x) => x.id === id)
    if (i < 0) return false
    const [gone] = data.items.splice(i, 1)
    if (gone.type === 'image' && gone.file) try { fs.rmSync(path.join(imgDir, path.basename(gone.file)), { force: true }) } catch { /* 算了 */ }
    save(data)
    return true
  }

  /** 图片文件的绝对路径（只认登记过的） */
  function imageFile(id) {
    const it = load().items.find((x) => x.id === id && x.type === 'image')
    if (!it || !it.file || path.basename(it.file) !== it.file) return null
    const p = path.join(imgDir, it.file)
    return fs.existsSync(p) ? p : null
  }

  return { list: () => load().items, addImage, addUrl, addStyle, addMarket, remove, imageFile, file }
}
