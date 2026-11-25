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

const DATA_IMG = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i
/**
 * 模拟数据（#30）里写的本地图片（「avatar": "img/me.png"，页面用 data-mock-attr 绑到 src）：打成单个文件时要换成 data: 地址，
 * 不然演示里是坏图。数据本身不改（同一个字段拿来显示文件名还是文件名）：回 { f: 真实路径 → data: 地址, r: 数据里写的那串 → 真实路径 }，
 * 运行时设 src / href 这类地址时查表。地址从设计目录根算；读不到的不进表（预览里本来也是坏的）。
 * 同一张图（img/a.jpg、./img/a.jpg 写法不同也算）只放一份、只算一次大小。
 * over：有这个文件、但太大换不下的放进这里（调用方据此报错，不能悄悄留个坏图）；
 * isBig(rel)：read 给了 null 是因为文件太大（不是没有）——这种也算换不下；
 * gone：数据里写了这张图、设计目录里却没有的放进这里：{ rel, paths: 写在数据的哪些路径上（下标记成 [*]） }
 */
export function dataAssets(data, read, max = 8 * 1024 * 1024, over = null, isBig = null, gone = null) {
  let left = max
  let nodes = 0
  const done = new Map() // 相对路径 → data: 地址（换不下 / 没有：''）
  const goneAt = new Map() // 没有的图 → 写在数据的哪些路径上（acts[1].cover 这种，记真下标；调用方据此判断是不是绑到了 src：绑的是列表别名 / 变量下标就对所有下标，写死 [0] 就只对 [0]）
  const f = {}
  const r = {}
  const one = (s, at) => {
    if (Object.prototype.hasOwnProperty.call(r, s)) return
    const ref = localRef(s)
    if (!ref || !DATA_IMG.test(ref)) return
    const rel = join('_', ref)
    if (rel.startsWith('..')) return
    if (!done.has(rel)) {
      let buf = null
      try { buf = read(rel) } catch { buf = null }
      let d = ''
      if (buf && buf.length * 1.4 < left) {
        const ext = path.posix.extname(rel).toLowerCase()
        const t = (MIME[ext] || (ext === '.bmp' ? 'image/bmp' : 'application/octet-stream')).replace(/;.*/, '')
        d = `data:${t};base64,${buf.toString('base64')}`
        left -= d.length
      } else if (over && (buf || (isBig && isBig(rel)))) over.push(rel)
      else if (gone && !buf && !(isBig && isBig(rel))) goneAt.set(rel, new Set()) // 数据里写了、文件却没有（#30 组件 :cover 这类动态图）：调用方报出来
      done.set(rel, d)
    }
    if (at && goneAt.has(rel)) goneAt.get(rel).add(at) // 全记（walk 总共最多 2 万个节点）：只截报错里展示的条数
    const d = done.get(rel)
    if (d) { f[rel] = d; r[s] = rel }
  }
  const walk = (v, depth, at) => {
    if (++nodes > 20000 || depth > 40) return
    if (typeof v === 'string') { if (v.length < 600) one(v, at); return }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, depth + 1, `${at}[${i}]`)); return }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], depth + 1, at ? at + '.' + k : k)
  }
  walk(data, 0, '')
  if (gone) for (const [rel, paths] of goneAt) gone.push({ rel, paths: [...paths] })
  return { f, r }
}
const escScript = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
/** 属性值里的实体解回来（只管引号和 &，style 里用得到的就这些） */
const unAttr = (s) => String(s).replace(/&(quot|#0*34|#x0*22);/gi, '"').replace(/&(apos|#0*39|#x0*27);/gi, "'").replace(/&amp;/gi, '&')

/**
 * srcset 拆成 [地址, 描述] 一项一项（照 HTML 的规矩：地址到空白为止，所以 data: 里的逗号不拆）
 */
export function srcsetParts(v) {
  const out = []
  const s = String(v)
  let i = 0
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++
    if (i >= s.length) break
    let j = i
    while (j < s.length && !/\s/.test(s[j])) j++
    let url = s.slice(i, j)
    let desc = ''
    if (url.endsWith(',')) url = url.replace(/,+$/, '')
    else {
      let k = j
      while (k < s.length && s[k] !== ',') k++
      desc = s.slice(j, k).trim()
      j = k
    }
    out.push([url, desc])
    i = j
  }
  return out
}

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
 * @param opts.onSkip (rel) → 有这个文件、但太大 / 超了上限没内联上（整套演示据此提醒缺了哪些）
 * @param opts.max  这一屏内联的总量上限（默认 MAX_TOTAL：远程看一屏一屏传；整套演示几屏共用一份，给得多些）
 * @param opts.base 这一屏原来的地址：放一个 <base>，没内联上的相对地址照原样指过去（不指到 DSH 网页上）
 * @returns string
 */
export function bundle(html, { key, read, tail = '', base = '', lead = '', max = MAX_TOTAL, onSkip = null }) {
  let budget = max
  let readLeft = max === MAX_TOTAL ? MAX_READ : 2 * max
  const cache = new Map()
  const get = (rel) => {
    if (cache.has(rel)) return cache.get(rel)
    let buf = null
    if (readLeft > 0) { try { buf = read(rel) } catch { buf = null } } else if (onSkip) onSkip(rel)
    if (buf && buf.length > Math.min(max, readLeft)) { buf = null; if (onSkip) onSkip(rel) }
    if (buf) readLeft -= buf.length
    cache.set(rel, buf)
    return buf
  }
  /** 花预算：够就扣掉；不够的告诉调用方（rel：哪个文件没放进去） */
  const spend = (n, rel) => { if (n > budget) { if (onSkip && rel) onSkip(rel); return false } budget -= n; return true }
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
    return spend(d.length, rel) ? d : ''
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
      if (!buf || !spend(buf.length, rel)) return m
      const inner = css(buf.toString('utf8').replace(/^\ufeff/, ''), rel, depth + 1)
      return media.trim() ? `@media ${media.trim()}{${inner}}` : inner
    })
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/gi, (m, u1, u2, u3) => {
      const url = u1 ?? u2 ?? u3
      const d = dataUrl(from, url)
      return d === url ? m : bare ? `url(${d})` : `url("${d}")`
    })

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
    if (!spend(d.length, rel)) { mods.delete(abs); return '' }
    mods.set(abs, d)
    return d
  }

  const sprites = new Map() // <use href="icons.svg#x"> 用到的 SVG 文件 → { pre: id 前缀, text }

  let out = String(html)
    // 样式表：<link rel="stylesheet" href="x.css"> → <style>
    .replace(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
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
      if (!buf || !spend(buf.length, rel)) return tag
      const media = /\bmedia\s*=\s*(["'])([^"']*)\1/i.exec(tag)
      return `<style data-href="${escAttr(href)}"${media ? ` media="${escAttr(media[2])}"` : ''}>${css(buf.toString('utf8').replace(/^\ufeff/, ''), rel).replace(/<\/style/gi, '<\\/style')}</style>`
    })
    // 页面里的 <style>：url() 相对这一屏
    .replace(/(<style\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, body, b) => (/\bdata-href=/.test(a) ? m : a + css(body, key) + b))
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
    // 原来的 src 留在 data-dsh-src（体检比外框指纹时按它：换了张图也认得出）
    // 属性值里的 > 不算标签结束（<source media="(width >= 900px)" srcset=…>）；跳过 HTML 注释，避免注释掉的旧图吃掉预算
    .replace(/<!--[\s\S]*?-->|(<(?:img|source|video|audio|input|image|embed|track)\b(?:[^>"']|"[^"]*"|'[^']*')*>)/gi, (all, tag0) => {
      if (!tag0) return all
      let orig = null
      let origSet = null
      const tag = tag0
        // 属性值先解实体（a.png?x=1&amp;y=2）再找文件；没换成 data: 的原样不动（不二次转义）
        .replace(/(\s(?:src|poster|href|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => {
          const raw = unAttr(u)
          const d = dataUrl(key, raw)
          if (d === raw) return m
          if (orig === null && !/poster/i.test(a)) orig = [q, u]
          return `${a}${q}${escAttr(d)}${q}`
        })
        .replace(/(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => {
          const raw = unAttr(u)
          // 每张只换一次（dataUrl 每调一次都扣总量）
          const conv = srcsetParts(raw).map(([x, dsc]) => [dataUrl(key, x), x, dsc])
          if (conv.every(([dd, x]) => dd === x)) return m
          const d = conv.map(([dd, , dsc]) => [dd, dsc].filter(Boolean).join(' ')).join(', ')
          if (origSet === null) origSet = [q, u]
          return `${a}${q}${escAttr(d)}${q}`
        })
      const extra = (orig ? ` data-dsh-src=${orig[0]}${orig[1]}${orig[0]}` : '') + (origSet ? ` data-dsh-srcset=${origSet[0]}${origSet[1]}${origSet[0]}` : '')
      return extra ? tag.replace(/^<[a-z]+\b/i, (t) => `${t}${extra}`) : tag
    })
    // <use href="icons.svg#x">：浏览器不认 data: 的 <use>，把那个 SVG 文件放进页面，href 改成 #x
    .replace(/<use\b[^>]*>/gi, (tag0) => { let hit = false; const tag = tag0.replace(/(\s(?:href|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, u) => {
      const i = u.indexOf('#')
      const ref = localRef(u)
      if (!ref || i < 0) return m
      const rel = join(key, ref)
      if (!sprites.has(rel)) {
        const buf = get(rel)
        const pre = `dsh${sprites.size + 1}-`
        const text = buf ? spriteOf(buf.toString('utf8').replace(/^\ufeff/, '').replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, '').trim(), pre) : ''
        if (!/^<svg\b/i.test(text) || !spend(text.length, rel)) return m
        sprites.set(rel, { pre, text })
      }
      let id = u.slice(i + 1)
      try { id = decodeURIComponent(id) } catch { /* 原样 */ }
      hit = true
      return `${a}${q}#${escAttr(sprites.get(rel).pre + id)}${q}`
    })
      if (!hit) return tag
      // 原来的写法留在 data-dsh-href（href 优先，和浏览器一样）：体检比外框指纹时按它，换了别的文件里的同名图标也认得出
      const o = /\shref\s*=\s*(["'])([^"']*)\1/i.exec(tag0) || /\sxlink:href\s*=\s*(["'])([^"']*)\1/i.exec(tag0)
      return o ? tag.replace(/^<use\b/i, (t) => `${t} data-dsh-href=${o[1]}${o[2]}${o[1]}`) : tag
    })
    // 行内样式里的 url()：解开实体再处理，按原来的引号转义回去
    .replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, a, dq, sq) => {
      const raw = dq ?? sq
      if (!/url\(/i.test(raw)) return m
      const v = css(unAttr(raw), key, 0, true).replace(/&/g, '&amp;')
      // 原来的写法留在 data-dsh-style（体检比外框指纹时按它）
      return dq != null ? `${a}"${v.replace(/"/g, '&quot;')}" data-dsh-style="${dq}"` : `${a}'${v.replace(/'/g, '&#39;')}' data-dsh-style='${sq}'`
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
export function inlinePicker(src, parent, href = '', nonce = '') {
  const cfg = JSON.stringify({ live: false, remote: true, href, parents: parent ? [parent] : [], strict: !!nonce })
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>window.__DSH_DESIGN__=${escScript(cfg)};\n${escScript(src)}</script>`
}

/**
 * 别人做的设计打包远程看：页面最前面放一条 CSP（只有带 nonce 的我们的脚本能跑，什么都不联网，表单交不出去）。
 * 打包后样式、图片都已经是 data: / 内联的，所以只放行 data: 和 blob:
 */
export function strictMeta(nonce) {
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`
}
