/**
 * 外框库：用户自己的外框（浏览器插件弹窗、某个软件的侧栏 …），做设计时原样套上，模型只写 data-slot 里面。
 *
 *   <库>/<id>/frame.json     { id, name, nameEn?, desc?, size: [w, h], css: [..], frames: [{ id, file, name, desc?, slots: { main: '说明', .. } }] }
 *   <库>/<id>/<位置>.html     一个位置一个页面：根元素 data-frame="<id>/<位置 id>"，槽位 data-slot；
 *                            存的时候写进 <meta name="dsh-design" content="framed WxH"> 和 <template id="dsh-frame">（指纹、几处样式）
 *   <库>/<id>/*.css、assets/  外框的样式、图
 *
 * 存：save_frame 工具给一个写好外框的文件夹 → 检查 frame.json → 无头浏览器打开每个位置（浅色、深色）算指纹、量样式、截图 → 写进库。
 * 指纹和样式是页面里的设计台脚本算的（和体检「外框被改动」同一段代码），复制到设计目录的页面自己带着，换台电脑打开也能查。
 * 技能目录里的 DSH 外框（frames/dsh）是自带的，不在库里；id「dsh」留给它。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHub } from './serve.js'
import { prepare } from './look.js'
import { srcsetParts } from './bundle.js'

export const FRAMES_DIR = process.env.DSH_DESIGN_FRAMES_DIR || path.join(os.homedir(), '.dsh', 'design-frames') // 测试时用环境变量换到临时目录
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const SLOT_RE = /^[a-z][a-z0-9-]{0,30}$/
const FILE_RE = /^[\w.-]{1,80}$/
const RESERVED = new Set(['dsh'])
const MAX_POS = 8
const MAX_ASSETS = 5 * 1024 * 1024
const MAX_ASSET_FILES = 200
const ASSET_EXT = /\.(svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|css)$/i

const plainFile = (f) => typeof f === 'string' && FILE_RE.test(f) && !/^\.+$/.test(f)

/** 写好外框的文件夹 → { m: 整理过的 frame.json, problems: [...] } */
export function readManifest(src) {
  const problems = []
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(path.join(src, 'frame.json'), 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    return { m: null, problems: [fs.existsSync(path.join(src, 'frame.json')) ? `frame.json 不是合法的 JSON：${String(e.message).slice(0, 120)}` : `${src} 里没有 frame.json`] }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { m: null, problems: ['frame.json 要是一个对象'] }
  const id = String(raw.id || '')
  if (!ID_RE.test(id)) problems.push(`id「${id}」不行：只用小写字母、数字和连字符，40 个字以内（比如 chrome-popup）`)
  else if (RESERVED.has(id)) problems.push(`id「${id}」留给自带的 DSH 外框了，换一个`)
  const name = String(raw.name || '').trim()
  if (!name || name.length > 30) problems.push('name 要写（外框叫什么，30 个字以内，如「Chrome 插件弹窗」）')
  const size = Array.isArray(raw.size) ? raw.size.map(Number) : []
  if (size.length !== 2 || !size.every((n) => Number.isInteger(n) && n >= 200 && n <= 4000)) problems.push('size 写成 [宽, 高]，整数，200–4000（外框整个画面多大，如 [400, 600]）')
  const css = (Array.isArray(raw.css) ? raw.css : raw.css ? [raw.css] : []).map(String)
  for (const f of css) {
    if (!plainFile(f) || !/\.css$/i.test(f)) problems.push(`css「${f}」要是这个文件夹里的 .css 文件名（不带目录）`)
    else if (!fs.existsSync(path.join(src, f))) problems.push(`css「${f}」找不到`)
  }
  const list = Array.isArray(raw.frames) ? raw.frames : []
  if (!list.length || list.length > MAX_POS) problems.push(`frames 写 1–${MAX_POS} 个位置：[{ id, file, name, slots: { main: '说明' } }]`)
  const seen = new Set()
  const frames = list.slice(0, MAX_POS).map((f, i) => {
    const x = f && typeof f === 'object' ? f : {}
    const fid = String(x.id || '')
    const tag = `frames[${i}]${fid ? `（${fid}）` : ''}`
    if (!ID_RE.test(fid)) problems.push(`${tag} 的 id 只用小写字母、数字和连字符`)
    else if (seen.has(fid)) problems.push(`${tag} 的 id 重复了`)
    seen.add(fid)
    const file = String(x.file || '')
    if (!plainFile(file) || !/\.html?$/i.test(file)) problems.push(`${tag} 的 file 要是这个文件夹里的 .html 文件名`)
    else if (!fs.existsSync(path.join(src, file))) problems.push(`${tag} 的 file「${file}」找不到`)
    const slots = x.slots && typeof x.slots === 'object' && !Array.isArray(x.slots) ? x.slots : {}
    const names = Object.keys(slots)
    if (!names.includes('main')) problems.push(`${tag} 的 slots 里要有 main（插件 / 页面主体放的地方）`)
    for (const s of names) if (!SLOT_RE.test(s)) problems.push(`${tag} 的槽位名「${s}」只用小写字母、数字和连字符`)
    const fname = String(x.name || '').trim()
    if (!fname) problems.push(`${tag} 要写 name（这个位置叫什么，如「弹窗」）`)
    return { id: fid, file, name: fname.slice(0, 30), desc: String(x.desc || '').slice(0, 200), slots: Object.fromEntries(names.map((s) => [s, String(slots[s] || '').slice(0, 200)])) }
  })
  const m = { id, name: name.slice(0, 30), nameEn: String(raw.nameEn || '').slice(0, 40), desc: String(raw.desc || '').slice(0, 300), size, css, frames }
  return { m, problems }
}

/** 页面开头的类型标记换成（或补上）framed WxH */
export function ensureMeta(html, w, h) {
  const tag = `<meta name="dsh-design" content="framed ${w}x${h}">`
  const re = /<meta\b[^>]*\bname\s*=\s*["']?dsh-design\b[^>]*>/i
  if (re.test(html)) return html.replace(re, tag)
  return headInsertAfterCharset(html, tag)
}

/**
 * 外框库写进页面的那段（指纹、几处样式）：<template id="dsh-frame">JSON</template>（不用 <script>：分享到设计市场不收脚本）。
 * 有就换掉；新写的放在 </head> 前面（别把开头的类型标记挤到读取范围外）。< > & 都转成 \\u 写法，模板里的字就是原样的 JSON
 */
export function injectFrameData(html, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const tag = `<template id="dsh-frame">${json}</template>`
  const re = /<(script|template)\b[^>]*\bid\s*=\s*["']?dsh-frame["']?[^>]*>[\s\S]*?<\/\1\s*>/gi
  const clean = html.replace(re, '')
  const end = /<\/head\s*>/i.exec(clean)
  if (end) return clean.slice(0, end.index) + tag + '\n' + clean.slice(end.index)
  return headInsertAfterCharset(clean, tag)
}

function headInsertAfterCharset(html, tag) {
  const cs = /<meta\b[^>]*\bcharset\b[^>]*>/i.exec(html)
  if (cs) return html.slice(0, cs.index + cs[0].length) + '\n' + tag + html.slice(cs.index + cs[0].length)
  const hd = /<head\b[^>]*>/i.exec(html)
  if (hd) return html.slice(0, hd.index + hd[0].length) + '\n' + tag + html.slice(hd.index + hd[0].length)
  // 没写 <head>：放在 doctype、<html> 后面（放到 doctype 前面页面会进怪异模式）
  const dt = /^\ufeff?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(html)
  let at = dt ? dt[0].length : 0
  const ht = /<html\b[^>]*>/i.exec(html.slice(at))
  if (ht && !/\S/.test(html.slice(at, at + ht.index).replace(/<!--[\s\S]*?-->/g, ''))) at += ht.index + ht[0].length
  return html.slice(0, at) + '\n' + tag + html.slice(at)
}

/** 库里的外框：[{ id, name, nameEn, desc, size, dir, frames }]，按名字排；坏的跳过 */
export function listFrames(dir = FRAMES_DIR) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!ID_RE.test(n) || RESERVED.has(n)) continue
    const d = path.join(dir, n)
    const { m, problems } = readManifest(d)
    if (!m || problems.length || m.id !== n) continue
    out.push({ ...m, dir: d })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 库里这个外框的目录（id 不对、是自带的、没有 frame.json → ''） */
export function frameDir(id, dir = FRAMES_DIR) {
  const n = String(id || '')
  if (!ID_RE.test(n) || RESERVED.has(n)) return ''
  const d = path.join(dir, n)
  return fs.existsSync(path.join(d, 'frame.json')) ? d : ''
}

/** 我的作品 › 外框 ⋯ 改名：只改 frame.json 里的 name（英文界面改 nameEn），先写临时文件再换上去 */
export function renameFrame(id, name, { en = false, dir = FRAMES_DIR } = {}) {
  const d = frameDir(id, dir)
  if (!d) return { ok: false, error: 'noFrame' }
  const v = String(name || '').replace(/\s+/g, ' ').trim()
  if (!v || v.length > (en ? 40 : 30)) return { ok: false, error: 'badName' }
  const f = path.join(d, 'frame.json')
  let raw
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')) } catch { return { ok: false, error: 'noFrame' } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'noFrame' }
  raw[en ? 'nameEn' : 'name'] = v
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n')
    fs.renameSync(tmp, f)
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* 没写出来 */ }
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) }
  }
  return { ok: true }
}

/** 我的作品 › 外框 ⋯ 删除：挪进库里的 .trash/（名字带点，列外框时不认），30 天前挪进去的顺手清掉。
 *  已经用它做的设计不受影响：外框的页面、样式当时就复制进设计目录了 */
export function removeFrame(id, dir = FRAMES_DIR) {
  const d = frameDir(id, dir)
  if (!d) return { ok: false, error: 'noFrame' }
  const trash = path.join(dir, '.trash')
  try {
    fs.mkdirSync(trash, { recursive: true })
    fs.renameSync(d, path.join(trash, `${path.basename(d)}-${Date.now()}`))
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) }
  }
  const old = Date.now() - 30 * 24 * 3600 * 1000
  try {
    for (const n of fs.readdirSync(trash)) {
      const at = Number((n.match(/-(\d{13})$/) || [])[1])
      if (at && at < old) fs.rmSync(path.join(trash, n), { recursive: true, force: true })
    }
  } catch { /* 清不掉下次再清 */ }
  return { ok: true }
}

/** 资源文件（assets/ 下面的图、字体、样式）：[相对路径]，太大、太多就报 */
function assetsOf(src) {
  const base = path.join(src, 'assets')
  const out = []
  const odd = []
  let total = 0
  const walk = (d, depth) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory() && depth < 3) walk(p, depth + 1)
      else if (e.isFile() && ASSET_EXT.test(e.name)) {
        total += fs.statSync(p).size
        out.push(path.relative(src, p))
      } else odd.push(path.relative(src, p))
    }
  }
  walk(base, 0)
  return { files: out, total, odd }
}

/**
 * 存库只复制 frame.json 的 css、位置 HTML、assets/：这几样里引用的本地文件（@import、url()、<link href>、src、<use href>）
 * 不在里面、但源文件夹里（或外面）确实有的列出来（「frame.css 引用的 tokens.css」），存进库会缺
 */
export function missingRefs(src, m, assetFiles = []) {
  const keep = new Set([...m.css, ...m.frames.map((f) => f.file), ...assetFiles].map((x) => x.split(path.sep).join('/')))
  const out = []
  const look = (file, refs) => {
    for (const r0 of refs) {
      const r = String(r0 || '').trim().replace(/^["']|["']$/g, '')
      if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r)) continue // data: http: blob: … / 本页 #id
      let rel = r.split(/[?#]/)[0]
      try { rel = decodeURIComponent(rel) } catch { /* 原样 */ }
      if (!rel) continue
      // / 开头的按预览的根（源文件夹）算：存外框时预览开的就是源文件夹
      const abs = rel.startsWith('/') ? path.resolve(src, `.${rel}`) : path.resolve(src, path.dirname(file), rel)
      if (!fs.existsSync(abs)) { out.push(`${file} 引用的 ${r}（找不到这个文件）`); continue } // 漏写了图、路径写错：存进库打开也是缺的
      const inSrc = path.relative(src, abs)
      const key = inSrc.split(path.sep).join('/')
      if (inSrc.startsWith('..') || path.isAbsolute(inSrc) || !keep.has(key)) out.push(`${file} 引用的 ${r}`)
    }
  }
  const cssRefs = (text0) => { const text = text0.replace(/\/\*[\s\S]*?\*\//g, ''); return [ // 注释里写的不算
    ...[...text.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^"')\s;]+))/gi)].map((x) => x[1] ?? x[2] ?? x[3]),
    ...[...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/gi)].map((x) => x[1] ?? x[2] ?? x[3]),
    // image-set("logo.svg" 1x, …)：不带 url() 的字符串也是图
    // （type("image/avif") 里是类型、不是文件，先去掉）
    ...[...text.matchAll(/image-set\(((?:[^()]|\([^()]*\))*)\)/gi)].flatMap((x) => [...x[1].replace(/\b(?:type|url)\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, '').matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2])),
  ] }
  const read = (f) => { try { return fs.readFileSync(path.join(src, f), 'utf8') } catch { return '' } }
  for (const f of [...m.css, ...assetFiles.filter((x) => /\.css$/i.test(x))]) look(f.split(path.sep).join('/'), cssRefs(read(f)))
  // 位置 HTML、assets/ 里的 SVG（雪碧图里 <image href="../leaf.svg">）一样查
  for (const file of [...m.frames.map((fr) => fr.file), ...assetFiles.filter((x) => /\.svg$/i.test(x))]) {
    const html = read(file).replace(/<!--[\s\S]*?-->/g, '')
    const refs = []
    // 属性值三种写法：双引号、单引号、不带引号（里面可以是另一种引号：style="background:url('logo.svg')"）
    // 属性值里的实体解回来：&quot; &apos; &lt; &gt; &amp;、数字的（&#38; &#x26;）
    const NAMED = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: '\u00a0' }
    const unEnt = (v) => v.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, x, n) => {
      if (d || x) { try { return String.fromCodePoint(d ? Number(d) : parseInt(x, 16)) } catch { return m } }
      return Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : m
    })
    const attrs = (tag, names) => [...tag.matchAll(new RegExp(`\\s(?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'gi'))].map((a) => unEnt(a[1] ?? a[2] ?? a[3] ?? ''))
    for (const t of html.matchAll(/<([a-z][a-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
      const tag = t[0]
      const name = t[1].toLowerCase()
      if (/^(link|use|image|feimage)$/.test(name)) refs.push(...attrs(tag, 'href|xlink:href'))
      if (/^(script|img|source|video|audio|iframe|input|embed)$/.test(name)) refs.push(...attrs(tag, 'src'))
      for (const v of attrs(tag, 'srcset')) refs.push(...srcsetParts(v).map(([u]) => u))
      for (const v of attrs(tag, 'style')) refs.push(...cssRefs(v))
    }
    for (const st of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) refs.push(...cssRefs(st[1]))
    look(file.split(path.sep).join('/'), refs)
  }
  return [...new Set(out)]
}

/**
 * 外框的样式文件、assets/ 每个文件的指纹 { 'assets/icons.svg': 'ab12cd34' }（体检时页面按同样的算法再算一遍：
 * 雪碧图里的图标形状、图、字体被改了也认得出）。按字节算 FNV，去掉 \r（Windows 上换行可能被改成 \r\n）；
 * 最多 30 个、每个 1 MB 以内、合起来 4 MB 以内（大的不记）
 */
const strCodes = (t) => { const a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i) & 0xff; return a }
export function assetHashes(src, files) {
  const out = {}
  let total = 0
  for (const f0 of files) {
    if (Object.keys(out).length >= 30) break
    const f = f0.split(path.sep).join('/')
    let buf
    try { buf = fs.readFileSync(path.join(src, f0)) } catch { continue }
    if (buf.length > 1024 * 1024 || total + buf.length > 4 * 1024 * 1024) continue
    total += buf.length
    // 开头带 BOM 的（记事本存的 UTF-8、UTF-16）：浏览器（picker.js fileHash）读到的是按 BOM 解码后的字，这边也先解码，再按同样的办法（每个字取低 8 位）算
    let codes = buf
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) codes = strCodes(buf.subarray(3).toString('utf8'))
    else if (buf[0] === 0xff && buf[1] === 0xfe) codes = strCodes(buf.subarray(2).toString('utf16le'))
    else if (buf[0] === 0xfe && buf[1] === 0xff) codes = strCodes(Buffer.from(buf.subarray(2)).swap16().toString('utf16le'))
    let h = 0x811c9dc5
    for (const b of codes) { if (b === 13) continue; h ^= b; h = Math.imul(h, 0x01000193) }
    out[f] = (h >>> 0).toString(16).padStart(8, '0')
  }
  return out
}

/** 开一个位置量一遍（浅色、深色）：问题、截图、要写进页面的那段放进 out */
async function measureFrame(browser, { url, w, h, m, f, want }, out) {
  const { bad, images } = out
  await browser.withPage({ url, w, h }, async (page) => {
    await prepare(page, false)
    // 量哪些：浅色、深色下看得见的外框元素合起来（只在深色显示的按钮、图标也查）
    let paths = await page.eval('window.__dshDesign.framePaths()')
    let hasDark = false
    // 深色量两种（外框没写深色也切，force）：真的深色媒体 + 切深色（系统深色、check_design dark），
    // 浅色媒体 + 画布切深色（系统浅色时在画布上切）；只写了 @media 的外框两种可能不一样。体检时深色哪种对上都行
    const any = Array.isArray(paths) && paths.length > 0
    const media = async (dk) => { if (page.media) await page.media(dk) }
    const DARKS = page.media ? [true, false] : [false]
    if (any) {
      const seen = new Set(paths.map((x) => JSON.stringify(x)))
      for (const dm of DARKS) {
        await media(dm)
        if (await page.eval('window.__dshDesign.dark(true, true)')) hasDark = true
        await page.eval('window.__dshDesign.settle()')
        for (const x of (await page.eval('window.__dshDesign.framePaths()')) || []) if (!seen.has(JSON.stringify(x))) { seen.add(JSON.stringify(x)); paths.push(x) }
        await page.eval('window.__dshDesign.dark(false)')
      }
      paths = paths.slice(0, 200)
      await media(false)
      await page.eval('window.__dshDesign.settle()')
    }
    const light = await page.eval(`window.__dshDesign.frameInfo(${Array.isArray(paths) && paths.length ? JSON.stringify(paths) : ''})`)
    if (!light || !light.found) { bad.push(`${f.file}：没找到外框的根元素。最外层包住整个外框的元素写 data-frame="${want}"，槽位写 data-slot`); return }
    if (!light.id) { bad.push(`${f.file}：带 data-frame 的元素里没有 data-slot 槽位`); return }
    if (light.id !== want) bad.push(`${f.file}：根元素写的是 data-frame="${light.id}"，要写 data-frame="${want}"`)
    // 写在 <html> / <body> 上：切深色会往 <html> 加属性、远程看会往 <body> 末尾塞图标，都算进外框指纹；
    // 写在 <dialog> / <details> 上：用户一开合整个外框就变了 → 都会误报
    if (['html', 'body', 'dialog', 'details'].includes(light.tag)) bad.push(`${f.file}：data-frame 写在了 <${light.tag}> 上。外面包一层 <div data-frame="${want}">，外框都放进去（铺满画面）`)
    const decl = Object.keys(f.slots)
    const miss = decl.filter((s) => !light.slots.includes(s))
    const extra = [...new Set(light.slots.filter((s) => !decl.includes(s)))]
    const dup = [...new Set(light.slots.filter((s, i) => light.slots.indexOf(s) !== i))]
    if (miss.length) bad.push(`${f.file}：frame.json 里的槽位页面上没有：${miss.join('、')}`)
    if (extra.length) bad.push(`${f.file}：页面上的槽位 frame.json 没写：${extra.join('、')}（写进 slots 并说明放什么）`)
    if (dup.length) bad.push(`${f.file}：槽位重名：${dup.join('、')}`)
    if (light.nested && light.nested.length) bad.push(`${f.file}：槽位套在槽位里面（${light.nested.join('、')}）：槽位要并排，不能嵌套`)
    if (light.rect.w < w * 0.9 || light.rect.h < h * 0.9) bad.push(`${f.file}：外框根元素只有 ${light.rect.w}×${light.rect.h}，要铺满整个画面 ${w}×${h}`)
    images.push({ key: `${m.id}-${f.id}`, label: `${m.name} · ${f.name}（浅色）`, jpg: await page.shot() })
    const darks = [] // 每种深色量出来的 e（量不成的是 null）
    let atDark = true
    if (any) {
      for (const dm of DARKS) {
        await media(dm)
        await page.eval('window.__dshDesign.dark(true, true)')
        await page.eval('window.__dshDesign.settle()')
        const dk = await page.eval(`window.__dshDesign.frameInfo(${JSON.stringify(light.probes.e.map((x) => x[0]))})`)
        const okd = dk && dk.sig === light.sig && dk.probes
        darks.push(okd ? dk.probes.e : null)
        if (okd && JSON.stringify(dk.at) !== JSON.stringify(light.at)) atDark = false // 深色样式让外框挪了位置（居中的根变宽变窄）：位置不记
        if (okd && hasDark && !images.some((x) => x.key === `${m.id}-${f.id}-dark`)) images.push({ key: `${m.id}-${f.id}-dark`, label: `${m.name} · ${f.name}（深色）`, jpg: await page.shot() })
        await page.eval('window.__dshDesign.dark(false)')
      }
      await media(false)
    }
    const e = light.probes.e.map(([p, v], i) => {
      const ds = darks.map((dk) => (dk && dk[i] && JSON.stringify(dk[i][0]) === JSON.stringify(p) ? dk[i][1] : null)).filter(Boolean)
      if (!ds.length) return [p, v]
      // 哪一套量出来跟着内容变（null）就几套都不查
      const nul = v.map((x, k) => x === null || ds.some((d) => d[k] === null))
      const fix = (arr) => arr.map((x, k) => (nul[k] ? null : x))
      const lv = fix(v)
      const [dv, dv2] = ds.map(fix)
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
      if (dv2 && !same(dv2, dv)) return [p, lv, dv, dv2] // 两种深色不一样：都记
      return same(dv, lv) ? [p, lv] : [p, lv, dv]
    })
    // 值去重放进表：元素那里只记第几个（-1 = 不查），页面里那段小一些
    const table = []
    const at = new Map()
    const idx = (arr) => arr.map((x) => {
      if (x === null) return -1
      if (!at.has(x)) { at.set(x, table.length); table.push(x) }
      return at.get(x)
    })
    // 写成整串（末尾「没画伪元素」的那一大段截掉，体检时超出长度的当「没画」；-1 不查不能截），
    // 或者只写和 base 不一样的 {第几个: 值}（浅色比上一个元素、深色比自己的浅色）——哪个短用哪个
    const pick = (ix, arr, base) => {
      const full = ix.slice()
      while (full.length && arr[full.length - 1] === '-') full.pop()
      if (!base) return full
      const d = {}
      ix.forEach((v, k) => { if (v !== base[k]) d[k] = v })
      return JSON.stringify(d).length < JSON.stringify(full).length ? d : full
    }
    let prev = null
    const rows = e.map(([p, lv, ...ds]) => {
      const lix = idx(lv)
      const row = [p, pick(lix, lv, prev), ...ds.map((d) => pick(idx(d), d, lix))]
      prev = lix
      return row
    })
    out.data = { id: want, sv: light.sv || 1, sig: light.sig, ...(hasDark ? {} : { fd: 1 }), ...(Array.isArray(light.at) && atDark ? { at: light.at } : {}), ...(light.refs && Object.keys(light.refs).length ? { rs: light.refs } : {}), ...(Array.isArray(light.od) ? { od: light.od } : {}), ...(Array.isArray(light.dl) ? { dl: light.dl } : {}), probes: { p: light.probes.p, v: table, e: rows } }
  })
}

/**
 * 存一个外框进库。
 * @returns { ok, id, dir, text, images: [{ key, label, jpg }] }；没存成 ok 是 false，text 里写为什么
 */
export async function saveFrame({ browser, src, dir = FRAMES_DIR, hubFactory = createHub }) {
  const { m, problems } = readManifest(src)
  if (!m || problems.length) return { ok: false, text: `外框没存：frame.json 有问题\n${problems.map((x) => `- ${x}`).join('\n')}`, images: [] }
  const assets = assetsOf(src)
  if (assets.total > MAX_ASSETS) return { ok: false, text: `外框没存：assets/ 太大（${Math.round(assets.total / 1024)} KB，最多 ${MAX_ASSETS / 1024 / 1024} MB）`, images: [] }
  if (assets.odd.length) return { ok: false, text: `外框没存：assets/ 里有收不了的：${assets.odd.slice(0, 5).join('、')}（只收图、字体、样式，最多套 3 层文件夹）`, images: [] }
  if (assets.files.length > MAX_ASSET_FILES) return { ok: false, text: `外框没存：assets/ 里文件太多（${assets.files.length} 个，最多 ${MAX_ASSET_FILES} 个）：图标合成一个 svg 雪碧图，或者删掉用不到的`, images: [] }
  // 外框是固定的样子：不收脚本（<script>、onclick 这种、javascript: 地址）——脚本一改外框的属性、class，体检就报外框被改
  const scripted = m.frames.filter((fr) => { let t = ''; try { t = fs.readFileSync(path.join(src, fr.file), 'utf8').replace(/<!--[\s\S]*?-->/g, '') } catch { return false } return /<script\b/i.test(t) || /<[a-z][^>]*\son[a-z]+\s*=/i.test(t) || /=\s*["']?\s*javascript:/i.test(t) }).map((fr) => fr.file)
  if (scripted.length) return { ok: false, text: `外框没存：${scripted.join('、')} 里有脚本（<script>、onclick 这种、javascript: 地址）。外框只放固定的样子，去掉脚本再存；要点了有反应的写在设计的槽位里。`, images: [] }
  const lost = missingRefs(src, m, assets.files)
  if (lost.length) return { ok: false, text: `外框没存：这些文件引用了找不到、或不会复制进库的文件（存进库后会缺）：\n${lost.slice(0, 12).map((x) => `- ${x}`).join('\n')}${lost.length > 12 ? `\n- …还有 ${lost.length - 12} 处` : ''}\n样式文件写进 frame.json 的 css，图、字体、别的样式放进 assets/，再存一次。`, images: [] }
  if (!browser || !browser.available()) return { ok: false, text: '外框没存：这台电脑上没找到能用的 Chrome / Edge，算不了外框的指纹。', images: [] }
  const [w, h] = m.size
  const hub = hubFactory({ parents: () => [] })
  const datas = new Map()
  const images = []
  const bad = []
  try {
    const entry = await hub.open({ kind: 'file', root: src })
    for (const f of m.frames) {
      const want = `${m.id}/${f.id}`
      const url = `${entry.origin}/${encodeURIComponent(f.file)}`
      // 刚写完的文件：预览服务器可能晚一点发「文件变了」，页面量到一半自己刷新 → 再开一次
      let last = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const mine = { bad: [], images: [], data: null }
        try {
          await measureFrame(browser, { url, w, h, m, f, want }, mine)
          bad.push(...mine.bad)
          images.push(...mine.images)
          if (mine.data) datas.set(f.id, mine.data)
          last = null
          break
        } catch (e) {
          last = e
        }
      }
      if (last) bad.push(`${f.file}：打不开（${String((last && last.message) || last).slice(0, 160)}）`)
    }
  } finally {
    hub.closeAll()
  }
  if (bad.length) return { ok: false, text: `外框没存：\n${bad.map((x) => `- ${x}`).join('\n')}`, images }

  // 写进库：先写到旁边的临时目录，写完换上去（同名的旧外框整个换掉；已经用旧外框做的设计页面里带着旧指纹，照样能查）
  const out = path.join(dir, m.id)
  const tmp = path.join(dir, `.${m.id}.${process.pid}.${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    const ah = assetHashes(src, [...m.css, ...assets.files])
    for (const f of m.frames) {
      let html = fs.readFileSync(path.join(src, f.file), 'utf8')
      html = injectFrameData(ensureMeta(html, w, h), { ...datas.get(f.id), ...(Object.keys(ah).length ? { ah } : {}) })
      fs.writeFileSync(path.join(tmp, f.file), html)
    }
    for (const c of m.css) fs.copyFileSync(path.join(src, c), path.join(tmp, c))
    for (const a of assets.files) {
      fs.mkdirSync(path.dirname(path.join(tmp, a)), { recursive: true })
      fs.copyFileSync(path.join(src, a), path.join(tmp, a))
    }
    fs.writeFileSync(path.join(tmp, 'frame.json'), JSON.stringify({ ...m, savedAt: new Date().toISOString() }, null, 2) + '\n')
    // 旧的先改名留着，新的换上去成功了再删旧的；换不上（Windows 上目录被占用）就把旧的改回来，库里不会两头都没了
    const old = fs.existsSync(out) ? path.join(dir, `.${m.id}.old.${process.pid}.${Date.now()}`) : ''
    if (old) fs.renameSync(out, old)
    try {
      fs.renameSync(tmp, out)
    } catch (e) {
      if (old) { try { fs.renameSync(old, out) } catch { /* 留着 .old 目录，至少没删 */ } }
      throw e
    }
    if (old) { try { fs.rmSync(old, { recursive: true, force: true }) } catch { /* 删不掉的旧目录名字带点、列外框时不认 */ } }
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true })
    return { ok: false, text: `外框没存：写进外框库出错（${String((e && e.message) || e).slice(0, 160)}）`, images }
  }
  const lines = m.frames.map((f) => `- ${f.name}：${f.file}（槽位 ${Object.keys(f.slots).join('、')}）`)
  const text = [
    `外框「${m.name}」（${m.id}，${w}×${h}）存进外框库了：${out}`,
    ...lines,
    `附上每个位置的截图（${images.some((x) => x.key.endsWith('-dark')) ? '浅色、深色' : '只有浅色：外框没写深色样式'}），对照用户给的截图 / 说明看一遍，不像就改源文件再存一次。`,
    `用它做设计：把 ${out} 里的 ${[...m.css, ...(assets.files.length ? ['assets/'] : [])].join('、') || '样式文件'} 和要用的位置 HTML 用复制命令原样复制进设计目录（别重新手写），只改 data-slot 里面；样式都从 [data-slot="main"] 开头。`,
  ].join('\n')
  return { ok: true, id: m.id, dir: out, text, images }
}

/** 技能里加一段：库里有哪些外框（每次加载技能现读） */
export function frameSection(dir = FRAMES_DIR) {
  const list = listFrames(dir)
  const head = '\n\n## 外框库（用户自己的外框；界面上叫「外壳库」「自定义外壳」，跟用户说话用这个叫法）\n\n'
  const how = '用户要给某个软件 / 浏览器插件 / 平台做界面、说「套上 XX 的外壳 / 外框」「照这张截图做个外壳 / 外框」：读 `references/frames.md`，照截图或说明写外框，调 `save_frame` 存进库，再用它出设计。'
  if (!list.length) return head + how + '\n'
  const line = (x) => `- 「${x.name}」（${x.id}，${x.size[0]}×${x.size[1]}）：${x.dir}；位置：${x.frames.map((f) => `${f.name}（${f.file}，槽位 ${Object.keys(f.slots).join('、')}）`).join('；')}`
  return `${head}${list.slice(0, 12).map(line).join('\n')}\n\n用户点名用某个外框（首页选了「自定义外壳」再选一个，消息里会写「外壳：名字（id）」，旧消息是「外框：名字（id）」）：照 \`references/frames.md\` 的「用外框」做，类型标记写 framed。\n\n${how}\n`
}
