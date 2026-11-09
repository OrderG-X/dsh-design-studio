/**
 * 设计目录 → 设计包（打 zip 给朋友、以后分享到市场都从这里出）
 *
 *   collectDesign(root)   挑要打进包的文件：只要白名单扩展名；跳过 refs/ exports/ handoff/ drafts/、_ 开头的草稿、隐藏文件（packDesign 再去掉别的 JSON）
 *   buildManifest(...)    没有 design.json 就生成一份（类型、尺寸读每屏的 meta，产品名从 <title> 拆），有就补齐屏列表
 *   packDesign(root, …)   规范化（去注释、站外链接改成 #、去表单地址）→ 图片去掉拍摄信息 → 用和机器人同一份规则查 → 出 zip
 *
 * 规则在 policy.js；这里只做「从用户的设计目录拿东西」这一层
 */

import fs from 'node:fs'
import path from 'node:path'
import { checkPack, normalizeHtml, titleOf, metaKind, message, LIMITS, capsOf, FORMAT, pctBytes, imageInfo } from './policy.js'
import { writeZip } from './zip.js'

const PACK_EXT = /\.(html|css|svg|png|jpe?g|webp|gif|avif|json|md)$/i
const SKIP_DIRS = new Set(['refs', 'exports', 'handoff', 'drafts', 'node_modules', 'dist', 'build'])
const SKIP_FILES = new Set() // ATTRIBUTION.md 要跟着走：CC BY 的署名转手也不能丢
const MAX_SCAN = 2000

/** 目录里要打进包的文件 → { files: [{ path, abs }], skipped: [相对路径], tooBig: bool } */
export function collectDesign(root) {
  const files = []
  const skipped = []
  let scanned = 0
  let tooBig = false
  const walk = (dir, rel, depth) => {
    let list
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of list) {
      if (++scanned > MAX_SCAN) { tooBig = true; return }
      const r = rel ? `${rel}/${d.name}` : d.name
      if (d.name.startsWith('.')) continue
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name.toLowerCase()) || d.name.startsWith('_')) continue
        if (depth >= LIMITS.depth) { skipped.push(r + '/'); continue }
        walk(path.join(dir, d.name), r, depth + 1)
        continue
      }
      if (!d.isFile()) { skipped.push(r); continue } // 软链接之类不跟
      if (d.name.startsWith('_') || SKIP_FILES.has(d.name.toLowerCase())) continue
      if (!PACK_EXT.test(d.name)) { skipped.push(r); continue }
      files.push({ path: r, abs: path.join(dir, d.name) })
    }
  }
  walk(root, '', 0)
  return { files, skipped, tooBig }
}

const CJK = /[㐀-鿿豈-﫿]/
const oneLine = (s, n) => [...String(s || '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, n).join('')
const textOf = (s, n) => { const v = oneLine(s, n); return v ? (CJK.test(v) ? { zh: v } : { en: v }) : null }
/** 填的字和原来那种语言的一样（预填了没改）→ 用原来的（中英都在）；改了 → 用填的 */
const typed = (v, old) => (v && old && typeof old === 'object' && !Array.isArray(old) && Object.entries(v).every(([k, x]) => old[k] === x) ? old : v)

/** 「首页 · 晨光咖啡」→ { screen: '首页', product: '晨光咖啡' } */
export function splitTitle(title) {
  const m = /^(.*?)\s*[·•|｜]\s*(.+)$/.exec(String(title || '').trim())
  return m ? { screen: m[1].trim(), product: m[2].trim() } : { screen: String(title || '').trim(), product: '' }
}

/** dsh-design meta 里的尺寸、系统（poster 1080x1920、desktop windows） */
function metaExtra(html) {
  const tag = /<meta\b[^>]*\bname\s*=\s*["']?dsh-design["']?[^>]*>/i.exec(html.slice(0, 65536))
  const c = tag && /\bcontent\s*=\s*(["'])([^"']*)\1/i.exec(tag[0])
  const words = c ? c[2].toLowerCase().split(/[\s,;]+/) : []
  const sz = words.map((w) => /^(\d{3,4})[x×*](\d{3,4})$/.exec(w)).find(Boolean)
  return { size: sz ? `${sz[1]}x${sz[2]}` : '', os: words.includes('windows') ? 'windows' : words.includes('mac') ? 'mac' : '' }
}

/**
 * 包的清单：有 design.json 就在它的基础上补（屏列表以现在目录里的为准，顺序先照清单），没有就从页面里读出来
 * screens：listScreens 排好的顶层页面文件名；htmls：文件名 → 内容
 */
export function buildManifest({ existing = null, screens, htmls, version = '', license = '', author = '', title = '', description = '', shareHash = '' }) {
  const m = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {}
  const first = htmls.get(screens[0]) || ''
  const kinds = screens.map((f) => metaKind(htmls.get(f) || '')).filter(Boolean)
  const titles = new Map(screens.map((f) => [f, splitTitle(titleOf(htmls.get(f) || ''))]))
  const product = [...titles.values()].map((x) => x.product).find(Boolean) || ''
  const extra = metaExtra(first)
  const out = {
    format: FORMAT,
    type: 'template',
    // 分享时填的名字、介绍优先（改了就只留填的那种语言，免得另一种还是旧名字；没改就原样留着中英两种）
    title: typed(textOf(title, 24), m.title) || (m.title && typeof m.title === 'object' ? m.title : textOf(product || titleOf(first), 24) || { zh: '我的设计' }),
    ...(typed(textOf(description, 120), m.description) ? { description: typed(textOf(description, 120), m.description) } : m.description ? { description: m.description } : {}),
    kind: m.kind || kinds[0] || 'web',
    ...(m.size || extra.size ? { size: m.size || extra.size } : {}),
    ...(m.os || extra.os ? { os: m.os || extra.os } : {}),
    screens: screens.map((f) => {
      const old = Array.isArray(m.screens) ? m.screens.find((s) => s && s.file === f) : null
      const t = old && old.title ? old.title : textOf(titles.get(f).screen, 24)
      return t ? { file: f, title: t } : { file: f }
    }),
  }
  for (const k of ['style', 'categories', 'tags', 'lang', 'dark', 'assets']) if (m[k] !== undefined) out[k] = m[k]
  out.license = license || m.license || 'CC0-1.0'
  // 署名：这次填了名字就用它；没填沿用清单里原来的（从市场装的模板改的，原作者在 derivedFrom 里，不在这）
  const who = oneLine(author, 40)
  if (who && out.license === 'CC-BY-4.0') out.author = { name: who } // CC0 不用署名
  else if (m.author && typeof m.author === 'object' && !m.from) out.author = m.author
  out.ai = { generated: true, tool: `dsh-design-studio${version ? '@' + version : ''}` }
  // 从别人的模板改的：带上原作（作者__名字@版本）
  const from = m.from && typeof m.from === 'object' ? m.from : null
  if (m.derivedFrom) out.derivedFrom = m.derivedFrom
  else if (from && typeof from.id === 'string' && typeof from.rev === 'string') out.derivedFrom = `${from.id}@${from.rev}`.slice(0, 90)
  if (/^[0-9a-f]{32}$/.test(shareHash)) out.shareHash = shareHash
  return out
}

/**
 * 网页 / 样式里内嵌的图片（data:image/…;base64,…）也去掉拍摄信息；改了就记一笔。
 * 只改「一整段连续 base64、后面紧跟引号或右括号」的标准写法；中间夹了换行、实体、百分号的不动（改坏了图就打不开），
 * 那种带信息的由检查拦下（imgMetaInline），让作者换成单独的图片文件
 */
export function stripInline(text, file = '', notes = null) {
  let changed = false
  // 格式按字节认（写成 webp 的 PNG 也按 PNG 去）
  const typeOf = (buf) => { const i = imageInfo(buf); return i ? i.type : '' }
  const out = String(text).replace(/(data:image\/([a-z0-9.+-]+)(?:;[a-z0-9=._-]+)*;base64,)([A-Za-z0-9+/=]+)(?=["')]|&quot;|&#39;|&apos;)/gi, (all, head, t, b64) => {
    const buf = Buffer.from(b64, 'base64')
    const ty = typeOf(buf)
    if (!ty) return all
    const clean = stripMeta(buf, ty)
    if (clean === buf || clean.length === buf.length) return all
    changed = true
    return head + clean.toString('base64')
  })
  // 不带 base64 的百分号写法（data:image/png,%89PNG…）：解出字节、去掉信息，改写成标准的 base64 写法
  const out2 = out.replace(/data:image\/([a-z0-9.+-]+)(?:;(?!base64)[a-z0-9=._-]+)*,((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9!$*+.\/:;=?@_~-])+)(?=["')]|&quot;|&#39;|&apos;)/gi, (all, t, body) => {
    const buf = pctBytes(body)
    const ty = typeOf(buf)
    if (!ty) return all
    const clean = stripMeta(buf, ty)
    if (clean === buf || clean.length === buf.length) return all
    changed = true
    return `data:image/${ty === 'jpg' ? 'jpeg' : ty};base64,${clean.toString('base64')}`
  })
  if (changed && notes) notes.push({ code: 'exif', x: file })
  return changed ? out2 : text
}

/** JPEG / PNG / WebP / GIF 去掉拍摄信息（EXIF、GPS、XMP、文字块、注释）；看不懂的原样返回（AVIF 不改，带着信息的由检查拦下） */
export function stripMeta(buf, ext) {
  try {
    if (ext === 'webp') {
      if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return buf
      const parts = []
      let i = 12
      let dropped = false
      while (i + 8 <= buf.length) {
        const t = buf.toString('latin1', i, i + 4)
        const len = buf.readUInt32LE(i + 4)
        const end = i + 8 + len + (len & 1)
        if (end > buf.length) return buf
        if (t === 'EXIF' || t === 'XMP ') dropped = true
        else if (t === 'VP8X') { const c = Buffer.from(buf.subarray(i, end)); c[8] &= ~0x0c; parts.push(c) } // 去掉「有 EXIF / XMP」两个标记
        else parts.push(buf.subarray(i, end))
        i = end
      }
      if (!dropped) return buf
      const body = Buffer.concat(parts)
      const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1')
      head.writeUInt32LE(body.length + 4, 4)
      return Buffer.concat([head, body])
    }
    if (ext === 'gif') {
      if (buf.length < 13 || buf.toString('latin1', 0, 3) !== 'GIF') return buf
      let i = 13
      if (buf[10] & 0x80) i += 3 * (1 << ((buf[10] & 7) + 1))
      const parts = [buf.subarray(0, i)]
      const sub = (j) => { while (j < buf.length && buf[j] !== 0) j += buf[j] + 1; return j + 1 }
      while (i < buf.length) {
        const t = buf[i]
        if (t === 0x3b) { parts.push(buf.subarray(i, i + 1)); return Buffer.concat(parts) }
        if (t === 0x21) {
          const label = buf[i + 1]
          const end = sub(i + 2)
          if (end > buf.length) return buf
          const xmp = label === 0xff && buf[i + 2] === 11 && buf.toString('latin1', i + 3, i + 11) === 'XMP Data'
          if (label !== 0xfe && !xmp) parts.push(buf.subarray(i, end))
          i = end
        } else if (t === 0x2c) {
          const packed = buf[i + 9]
          let j = i + 10
          if (packed & 0x80) j += 3 * (1 << ((packed & 7) + 1))
          const end = sub(j + 1)
          if (end > buf.length) return buf
          parts.push(buf.subarray(i, end))
          i = end
        } else return buf
      }
      return buf
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf
      const parts = [buf.subarray(0, 2)]
      let i = 2
      while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff) return buf
        const mk = buf[i + 1]
        if (mk === 0xda) { parts.push(buf.subarray(i)); return Buffer.concat(parts) } // 图像数据开始：后面原样
        if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) { parts.push(buf.subarray(i, i + 2)); i += 2; continue }
        const len = buf.readUInt16BE(i + 2)
        if (len < 2 || i + 2 + len > buf.length) return buf
        // APP1（EXIF / XMP）、APP13（Photoshop）、COM（注释）去掉；APP0（JFIF）、APP2（ICC 色彩）、APP14（Adobe）留着
        if (!(mk === 0xe1 || mk === 0xed || mk === 0xfe)) parts.push(buf.subarray(i, i + 2 + len))
        i += 2 + len
      }
      return buf
    }
    if (ext === 'png') {
      if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return buf
      const parts = [buf.subarray(0, 8)]
      let i = 8
      while (i + 12 <= buf.length) {
        const len = buf.readUInt32BE(i)
        const type = buf.toString('latin1', i + 4, i + 8)
        if (i + 12 + len > buf.length) return buf
        if (!['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(type)) parts.push(buf.subarray(i, i + 12 + len))
        i += 12 + len
        if (type === 'IEND') break
      }
      return Buffer.concat(parts)
    }
  } catch { /* 看不懂就原样 */ }
  return buf
}

/**
 * 打包前的全部步骤。screens：要打进包的屏（顺序就是包里的顺序）
 * 返回 { ok, errors: [{ code, x, line, msg, sev }], flags, notes: [自动修了什么], skipped, manifest, files: [{ path, data }] }
 */
export function packDesign(root, { screens, version = '', license = '', author = '', mode = 'zip', lang = 'zh', title = '', description = '', shareHash = '', secrets = [] }) {
  const { files: picked, skipped, tooBig } = collectDesign(root)
  const notes = []
  const errors = []
  if (tooBig) errors.push({ code: 'count', n: '2000+', max: capsOf(mode).files, sev: 'error' })
  const screenSet = new Set(screens.map((s) => s.toLowerCase()))
  let existing = null
  const files = []
  const htmls = new Map()
  for (const f of picked) {
    if (f.path === 'design.json') {
      try { existing = JSON.parse(fs.readFileSync(f.abs, 'utf8')) } catch { existing = null }
      continue
    }
    // 不在画布上的顶层页面（方向稿删掉了、改名前的旧文件）：不打包
    if (/\.html$/i.test(f.path) && !f.path.includes('/') && !screenSet.has(f.path.toLowerCase())) { skipped.push(f.path); continue }
    // 别的 JSON（设置、记录、导出的数据…）：模板用不上（不能跑脚本），可能带着个人信息，不打包；只留调节滑块的 tweaks.json
    if (/\.json$/i.test(f.path) && f.path !== 'tweaks.json') { skipped.push(f.path); continue }
    let data
    try {
      const st = fs.statSync(f.abs)
      if (st.size > 4 * 1024 * 1024) { errors.push({ code: 'big', x: f.path, n: `${Math.ceil(st.size / 1024)}KB`, max: '400KB', sev: 'error' }); continue }
      data = fs.readFileSync(f.abs)
    } catch { continue }
    const ext = f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase()
    if (ext === 'html') {
      const r = normalizeHtml(data.toString('utf8'), { file: f.path })
      if (r.changes.length) notes.push(...r.changes)
      const text = stripInline(r.text, f.path, notes)
      htmls.set(f.path, text)
      files.push({ path: f.path, data: Buffer.from(text, 'utf8') })
    } else if (ext === 'css' || ext === 'svg') {
      const text = data.toString('utf8')
      const clean = stripInline(text, f.path, notes)
      files.push({ path: f.path, data: clean === text ? data : Buffer.from(clean, 'utf8') })
    } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'gif') {
      const clean = stripMeta(data, ext)
      if (clean.length !== data.length) notes.push({ code: 'exif', x: f.path })
      files.push({ path: f.path, data: clean })
    } else {
      files.push({ path: f.path, data })
    }
  }
  const order = screens.filter((s) => htmls.has(s))
  const manifest = buildManifest({ existing, screens: order, htmls, version, license, author, title, description, shareHash })
  files.unshift({ path: 'design.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') })
  const r = checkPack(files, { mode })
  // 只该留在作者电脑上的东西（分享记号）：哪个文件里有都拦
  for (const sec of secrets.filter((x) => typeof x === 'string' && x.length >= 16)) {
    for (const f of files) if (Buffer.from(f.data).includes(sec)) errors.push({ code: 'secret', x: f.path, sev: 'error' })
  }
  const all = [...errors, ...r.errors].map((p) => ({ ...p, msg: message(p, lang) }))
  return {
    ok: !all.length,
    errors: all,
    flags: r.flags.map((p) => ({ ...p, msg: message(p, lang) })),
    notes,
    skipped: skipped.slice(0, 50),
    manifest,
    files,
    bytes: r.bytes,
  }
}

/** 包 → zip（design.json 在最前，屏按顺序，其余按路径） */
export function zipOf(pack, now = new Date()) {
  const rank = new Map(pack.manifest.screens.map((s, i) => [s.file, i]))
  const files = [...pack.files].sort((a, b) => {
    if (a.path === 'design.json') return -1
    if (b.path === 'design.json') return 1
    const ra = rank.has(a.path) ? rank.get(a.path) : 1e6
    const rb = rank.has(b.path) ? rank.get(b.path) : 1e6
    return ra - rb || a.path.localeCompare(b.path)
  })
  return writeZip(files, { now })
}
