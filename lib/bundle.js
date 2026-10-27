/**
 * 远程看（手机走外网、别的电脑打开 DSH 网页）：预览服务器只听电脑本机，那边连不上。
 *
 * 这时把一屏打成一整份 HTML：本地的样式表、脚本内联成 <style> / <script>，图片、字体换成 data: 地址，
 * picker 也内联进去。右侧栏把它放进沙盒 iframe 的 srcdoc 里显示——页面是个不透明的源，
 * 碰不到 DSH 的 Cookie 和接口（和本机预览时「不同源」是一个意思）。
 *
 * 只内联设计目录里的文件（resolve 管越界）；外网地址、data:、找不到的原样留着。总大小有上限，超了的也原样留着。
 */

import path from 'node:path'
import { MIME, headInsert } from './serve.js'

export const MAX_TOTAL = 12 * 1024 * 1024 // 内联进去的总量：每内联一次都算（同一张图引用 24 次算 24 次）
const MAX_READ = 2 * MAX_TOTAL // 读文件的总量
const MAX_DEPTH = 4 // 样式表 @import 最多套几层
const MAX_MODULES = 60 // ES 模块最多带几个

/** 能内联的本地地址：相对路径或以 / 开头的路径（不是 http:、//、data:、#…） */
function localRef(url) {
  const u = String(url || '').trim()
  if (!u || /^(#|[a-z][\w+.-]*:|\/\/)/i.test(u)) return ''
  return u.split(/[?#]/)[0]
}

/** 相对 base（文件在设计目录里的相对路径）解析出另一个文件的相对路径；以 / 开头的从设计目录根算 */
function join(base, ref) {
  let r = ref
  try { r = decodeURIComponent(ref) } catch { /* 原样 */ }
  const p = r.startsWith('/') ? r.slice(1) : path.posix.join(path.posix.dirname(base), r)
  return path.posix.normalize(p)
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const escScript = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
/** 属性值里的实体解回来（只管引号和 &，style 里用得到的就这些） */
const unAttr = (s) => String(s).replace(/&(quot|#0*34|#x0*22);/gi, '"').replace(/&(apos|#0*39|#x0*27);/gi, "'").replace(/&amp;/gi, '&')

/** 模块里的 import … from '…' / import '…' / export … from '…' / import('…') */
const IMPORT_RE = /(\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(["'])([^"'\n]+)\2/g
const relSpec = (spec) => (/^\.{0,2}\//.test(spec) ? localRef(spec) : '')

/**
 * 放进页面的 SVG 雪碧图：去掉脚本、事件属性和 <style>（放进页面会管到整页），
 * id 都加上这份文件的前缀（两份文件都有 #check 时不串图），文件里对它们的引用跟着改
 */
function spriteOf(text, pre) {
  return text
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\sid\s*=\s*)(["'])([^"']+)\2/gi, (m, a, q, id) => `${a}${q}${pre}${id}${q}`)
    .replace(/(\s(?:href|xlink:href)\s*=\s*)(["'])#([^"']+)\2/gi, (m, a, q, id) => `${a}${q}#${pre}${id}${q}`)
    .replace(/url\(\s*(["']?)#([^"')]+)\1\s*\)/gi, (m, q, id) => `url(${q}#${pre}${id}${q})`)
}

/**
 * @param html     这一屏的 HTML
 * @param opts.key 这一屏在设计目录里的相对路径（home.html）
 * @param opts.read (rel) → Buffer | null：读设计目录里的文件（越界、不存在、太大返回 null）
 * @param opts.tail 插在 </body> 前的东西（picker 和它的配置）
 * @param opts.lead 插在 <head> 最前面（<base> 后面）的东西：报错记录
 * @param opts.base 这一屏原来的地址：放一个 <base>，没内联上的相对地址照原样指过去（不指到 DSH 网页上）
 * @returns string
 */
export function bundle(html, { key, read, tail = '', base = '', lead = '' }) {
  let budget = MAX_TOTAL
  let readLeft = MAX_READ
  const cache = new Map()
  const get = (rel) => {
    if (cache.has(rel)) return cache.get(rel)
    let buf = null
    if (readLeft > 0) { try { buf = read(rel) } catch { buf = null } }
    if (buf && buf.length > Math.min(MAX_TOTAL, readLeft)) buf = null
    if (buf) readLeft -= buf.length
    cache.set(rel, buf)
    return buf
  }
  /** 花预算：够就扣掉 */
  const spend = (n) => { if (n > budget) return false; budget -= n; return true }
  const typeOf = (rel) => {
    const t = (MIME[path.posix.extname(rel).toLowerCase()] || 'application/octet-stream').replace(/;.*/, '')
    return /^text\//.test(t) ? `${t};charset=utf-8` : t
  }
  const encoded = new Map()
  /** 文件 → data: 地址（每用一次扣一次预算）；读不到、超了返回 '' */
  const dataOf = (rel) => {
    const buf = get(rel)
    if (!buf) return ''
    let d = encoded.get(rel)
    if (!d) { d = `data:${typeOf(rel)};base64,${buf.toString('base64')}`; encoded.set(rel, d) }
    return spend(d.length) ? d : ''
  }
  const dataUrl = (from, url) => {
    const ref = localRef(url)
    return ref ? dataOf(join(from, ref)) || url : url
  }
  // 样式表里的 url(…) 和 @import（bare：url() 不加引号，行内 style 用——base64 里没有引号、括号、空白）
  const css = (text, from, depth = 0, bare = false) => String(text)
    .replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?([^;]*);/gi, (m, q, url, media) => {
      const ref = localRef(url)
      if (!ref || depth >= MAX_DEPTH) return m
      const rel = join(from, ref)
      const buf = get(rel)
      if (!buf || !spend(buf.length)) return m
      const inner = css(buf.toString('utf8'), rel, depth + 1)
      return media.trim() ? `@media ${media.trim()}{${inner}}` : inner
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, url) => {
      const d = dataUrl(from, url)
      return d === url ? m : bare ? `url(${d})` : `url("${d}")`
    })
  const srcset = (v) => String(v).split(',').map((part) => {
    const [u, ...rest] = part.trim().split(/\s+/)
    return [dataUrl(key, u), ...rest].join(' ')
  }).join(', ')

  // ES 模块：入口和依赖都换成 data:，模块里相对的 import 改写成原预览地址的绝对 URL，再用 importmap 把这些地址映射到 data:
  // （data: 模块里没法按相对路径解析；行内模块靠 <base> 解析成同样的绝对地址）。页面自己有 importmap 就不动模块。
  const root = base ? new URL('../'.repeat(String(key).split('/').length - 1) || './', base) : null
  const modules = !!root && !/<script\b[^>]*\btype\s*=\s*["']?importmap/i.test(html)
  const absOf = (rel) => new URL(rel.split('/').map(encodeURIComponent).join('/'), root).href
  const mods = new Map() // 绝对地址 → data:（'' = 正在处理 / 没打成）
  const mod = (rel) => {
    const abs = absOf(rel)
    if (mods.has(abs)) return mods.get(abs)
    if (mods.size >= MAX_MODULES) return ''
    const buf = get(rel)
    if (!buf) return ''
    mods.set(abs, '')
    const text = buf.toString('utf8').replace(IMPORT_RE, (m, pre, q, spec) => {
      const ref = relSpec(spec)
      if (!ref) return m
      const dep = join(rel, ref)
      mod(dep)
      return `${pre}${q}${absOf(dep)}${q}`
    }) + `\n//# sourceURL=${abs}\n` // 每个文件一个 data:（内容一样的两个文件也是两个模块），报错时也看得出是哪个文件
    const d = `data:text/javascript;charset=utf-8;base64,${Buffer.from(text).toString('base64')}`
    if (!spend(d.length)) { mods.delete(abs); return '' }
    mods.set(abs, d)
    return d
  }

  const sprites = new Map() // <use href="icons.svg#x"> 用到的 SVG 文件 → { pre: id 前缀, text }

  let out = String(html)
    // 样式表：<link rel="stylesheet" href="x.css"> → <style>
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) {
        // 图标之类的 <link href> 换成 data:
        return tag.replace(/(\bhref\s*=\s*)(["'])([^"']*)\2/i, (m, a, q, u) => `${a}${q}${escAttr(dataUrl(key, u))}${q}`)
      }
      const m = /\bhref\s*=\s*(["'])([^"']*)\1/i.exec(tag) || /\bhref\s*=\s*([^\s>]+)/i.exec(tag)
      const href = m ? m[2] ?? m[1] : ''
      const ref = localRef(href)
      if (!ref) return tag
      const rel = join(key, ref)
      const buf = get(rel)
      if (!buf || !spend(buf.length)) return tag
      const media = /\bmedia\s*=\s*(["'])([^"']*)\1/i.exec(tag)
      return `<style data-href="${escAttr(href)}"${media ? ` media="${escAttr(media[2])}"` : ''}>${css(buf.toString('utf8'), rel).replace(/<\/style/gi, '<\\/style')}</style>`
    })
    // 页面里的 <style>：url() 相对这一屏
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, body, b) => (/\bdata-href=/.test(a) ? m : a + css(body, key) + b))
    // 脚本：本地的经典脚本换成 src="data:…"（defer、async、执行顺序都和原来一样）；模块见上
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => {
      const s = /\bsrc\s*=\s*(["'])([^"']*)\1/i.exec(attrs) || /\bsrc\s*=\s*([^\s>"']+)/i.exec(attrs)
      const isModule = /\btype\s*=\s*["']?module\b/i.test(attrs)
      if (isModule && !modules) return m
      if (!s) {
        // 行内模块：正文不动（相对 import 按 <base> 解析），把它用到的模块放进 importmap
        if (isModule) body.replace(IMPORT_RE, (x, pre, q, spec) => { const ref = relSpec(spec); if (ref) mod(join(key, ref)); return x })
        return m
      }
      const ref = localRef(s[2] ?? s[1])
      if (!ref) return m
      const rel = join(key, ref)
      const d = isModule ? mod(rel) : dataOf(rel)
      return d ? `<script${attrs.replace(s[0], `src="${d}"`)}>${body}</script>` : m
    })
    // 图片、视频、音频、SVG 里的 image
    .replace(/(<(?:img|source|video|audio|input|image|embed|track)\b[^>]*>)/gi, (tag) => tag
      .replace(/(\s(?:src|poster|href|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => `${a}${q}${escAttr(dataUrl(key, u))}${q}`)
      .replace(/(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => `${a}${q}${escAttr(srcset(u))}${q}`))
    // <use href="icons.svg#x">：浏览器不认 data: 的 <use>，把那个 SVG 文件放进页面，href 改成 #x
    .replace(/<use\b[^>]*>/gi, (tag) => tag.replace(/(\s(?:href|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => {
      const i = u.indexOf('#')
      const ref = localRef(u)
      if (!ref || i < 0) return m
      const rel = join(key, ref)
      if (!sprites.has(rel)) {
        const buf = get(rel)
        const pre = `dsh${sprites.size + 1}-`
        const text = buf ? spriteOf(buf.toString('utf8').replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, '').trim(), pre) : ''
        if (!/^<svg\b/i.test(text) || !spend(text.length)) return m
        sprites.set(rel, { pre, text })
      }
      let id = u.slice(i + 1)
      try { id = decodeURIComponent(id) } catch { /* 原样 */ }
      return `${a}${q}#${escAttr(sprites.get(rel).pre + id)}${q}`
    }))
    // 行内样式里的 url()：解开实体再处理，按原来的引号转义回去
    .replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, a, dq, sq) => {
      const raw = dq ?? sq
      if (!/url\(/i.test(raw)) return m
      const v = css(unAttr(raw), key, 0, true).replace(/&/g, '&amp;')
      return dq != null ? `${a}"${v.replace(/"/g, '&quot;')}"` : `${a}'${v.replace(/'/g, '&#39;')}'`
    })
  const head = []
  if (base) head.push(`<base href="${escAttr(base)}">`)
  if (lead) head.push(lead)
  const map = [...mods].filter(([, d]) => d)
  if (map.length) head.push(`<script type="importmap">${escScript(JSON.stringify({ imports: Object.fromEntries(map) }))}</script>`)
  if (head.length) out = headInsert(out, head.join(''))
  const sprite = sprites.size ? `<div aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${[...sprites.values()].map((x) => x.text).join('')}</div>` : ''
  // picker 和本机预览一样放在 </body> 前（没有就放最后）
  if (sprite || tail) {
    const i = out.toLowerCase().lastIndexOf('</body>')
    out = i >= 0 ? out.slice(0, i) + sprite + tail + out.slice(i) : out + sprite + tail
  }
  return out
}

/** picker 和它的配置，内联成一个 <script>（parents：右侧栏所在的那个源；href：这一屏原来的地址） */
export function inlinePicker(src, parent, href = '') {
  const cfg = JSON.stringify({ live: false, remote: true, href, parents: parent ? [parent] : [] })
  return `<script>window.__DSH_DESIGN__=${escScript(cfg)};\n${escScript(src)}</script>`
}
