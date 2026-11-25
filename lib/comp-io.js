/**
 * 组件（#30）接到各条路径上的那层：从哪读文件（设计目录 / 某一版的快照）、预览时怎么带上依赖、正式导出遇错怎么停、体检怎么报。
 * 展开本身在 components.js（纯函数，不碰文件）；这里只管文件和拼装。
 */
import fs from 'node:fs'
import path from 'node:path'
import { COMP_DIR, usesComponents, expandComponents, catalog, catalogLine } from './components.js'

const MAX_READ = 8 * 1024 * 1024 // 和预览注入脚本的上限一样（serve.js MAX_HTML）：预览能展开的页，预检也读得到；组件文件自己另有 256 KB 上限

/** 设计目录里的相对路径 → 内容；不出目录（含顺着软链接出去）、不是文件、太大、读不了都给 null */
export function dirReader(root) {
  let real
  try { real = fs.realpathSync(root) } catch { real = path.resolve(root) }
  const read = (rel) => {
    const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!r || r.split('/').some((x) => x === '..' || x === '')) return null
    try {
      const f = fs.realpathSync(path.join(real, r))
      if (!f.startsWith(real + path.sep)) return null
      const st = fs.statSync(f)
      if (!st.isFile() || st.size > MAX_READ) return null
      return fs.readFileSync(f)
    } catch { return null }
  }
  read.hasCompDir = () => hasCompDir(real)
  return read
}

/**
 * 设计目录的 components/ 里有没有组件文件（.html）：有才算用上了组件（见 adopts）。
 * 只有个空文件夹、或者放的是老项目自己的 JS 组件（components/rating.js），都不算
 */
export function hasCompDir(root) {
  return componentFiles(root).length > 0
}

/** 页面里写到的组件名（去重） */
const compNames = (html) => new Set([...String(html).matchAll(/<c-([a-z][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase()))

const DEFINE_C = /customElements\s*\.\s*define\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"`]c-/
/** 页面引的外部脚本：{ local: [设计目录里的相对路径], remote: 有没有外链脚本 } */
function scriptsOf(html) {
  const local = []
  let remote = false
  for (const m of String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b[^>]*?\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/gi)) {
    const src = m[2].split(/[?#]/)[0]
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) { remote = true; continue }
    local.push(src.replace(/^\.?\/+/, ''))
  }
  return { local, remote }
}

/**
 * 这页归不归我们展开（写了 <c-…>、不是页面自己内联注册的之外）：
 * - 本地外部脚本里自己 customElements.define('c-…')：老页面自己的自定义元素，不接管
 * - 设计的 components/ 里有组件文件（.html）、或至少一个用到的组件文件在：接管（缺的照样报缺组件）
 * - 都没有：页面引了外部脚本就当它自己注册的（原样不动）；一个外部脚本都没有，只能是我们的组件（缺组件照样报，正式导出照样拦）
 */
export function adopts(html, read) {
  if (!usesComponents(html)) return false
  if (!read) return true
  const sc = scriptsOf(html)
  for (const rel of sc.local.slice(0, 20)) {
    try { const b = read(rel); if (b && DEFINE_C.test(b.toString('utf8'))) return false } catch { /* 读不了：当没注册 */ }
  }
  try { if (read.hasCompDir && read.hasCompDir()) return true } catch { /* 当没有 */ }
  for (const n of compNames(html)) if (read(`${COMP_DIR}/${n}.html`)) return true
  return !sc.local.length && !sc.remote
}

/** 某一版快照里的文件（旧版本的页面、组件、组件带的样式全从同一份快照读，缺了就是缺了，不拿现在的顶） */
export function versionReader(history, root, n) {
  return (rel) => {
    try {
      const f = history && history.fileOf(root, n, String(rel || '').replace(/\\/g, '/').replace(/^\/+/, ''))
      return f ? fs.readFileSync(f) : null
    } catch { return null }
  }
}

/** 设计目录 components/ 下的组件文件名（只一层） */
export function componentFiles(root) {
  try {
    return fs.readdirSync(path.join(root, COMP_DIR), { withFileTypes: true })
      .filter((d) => d.isFile() && /\.html$/i.test(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
  } catch { return [] }
}

/** 放进 <head> 最前面（没 <head> 放 <html> / doctype 后面）；注释里提到的 <head> 不算 */
function headPut(html, tag) {
  const bare = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => ' '.repeat(c.length))
  const m = /<head\b[^>]*>/i.exec(bare) || /<html\b[^>]*>/i.exec(bare) || /^\s*<!doctype\b[^>]*>/i.exec(bare)
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html
}

const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** 这页用到的组件文件：picker 收到「这些文件改了」时靠它知道要不要刷新自己 */
export const depsMeta = (deps) => `<meta name="dsh-comp-deps" content="${attrEsc(deps.join(','))}">`

const EMPTY = Object.freeze({ deps: [], used: [], errors: [], warnings: [] })

/**
 * 预览（画布、远程看、旧版本）：展开，出错的实例原地红框；带上依赖。没用组件的页面原样返回（逐字节不变）
 * @returns { html, deps, used, errors, warnings, comp: 用没用组件 }
 */
export function expandPreview(html, read, page = '') {
  if (!adopts(html, read)) return { html, ...EMPTY, comp: false }
  const r = expandComponents(html, { read, page, placeholders: true })
  return { ...r, html: headPut(r.html, depsMeta(r.deps)), comp: true }
}

/** 正式导出 / 公网链接：出错就抛 compErr（message 列出哪几屏、什么错），不出半截的东西 */
export function expandFormal(html, read, page = '') {
  if (!adopts(html, read)) return { html, ...EMPTY, comp: false }
  const r = expandComponents(html, { read, page, placeholders: false })
  if (r.errors.length) throw compError([{ page, errors: r.errors }])
  return { ...r, comp: true }
}

/** 几屏的错攒成一个 compErr：e.code = 'compErr'，e.pages = [{ page, errors }]，message 是一句人话 */
export function compError(list) {
  const bad = list.filter((x) => x.errors && x.errors.length)
  const first = bad[0] && bad[0].errors[0]
  const e = new Error(`${bad.length} 屏的组件有错：${bad.slice(0, 3).map((x) => x.page).join('、')}${bad.length > 3 ? ' 等' : ''}${first ? `（${first.message}）` : ''}`)
  e.code = 'compErr'
  e.pages = bad.map((x) => ({ page: x.page, errors: x.errors.slice(0, 5).map((d) => ({ code: d.code, message: d.message, file: d.file, line: d.line, fix: d.fix })) }))
  return e
}

/** 导出前统一预检：这些屏（某一版就从那一版的快照读）里组件有没有错。→ [{ page, errors }]（只列有错的） */
export function precheckScreens(keys, read) {
  const out = []
  for (const key of keys) {
    const buf = read(key)
    if (!buf) continue // 屏没了：导出那边自己会报
    const html = buf.toString('utf8')
    if (!adopts(html, read)) continue
    const r = expandComponents(html, { read, page: key, placeholders: false })
    if (r.errors.length) out.push({ page: key, errors: r.errors })
  }
  return out
}

/** 这页用没用组件（改字、调样式写回前问：用了就交给模型）；给了 read 就按 adopts 认（老页面自己注册的 c-* 不算） */
export function pageUsesComponents(html, read = null) {
  try { return read ? adopts(String(html || ''), read) : usesComponents(String(html || '')) } catch { return false }
}

/**
 * 体检 / preview_page 用：整套设计的组件情况。
 * @returns { items: catalog, line: 一行短目录, pages: [{ page, errors, warnings }]（只列有问题的）, unused: [组件名], usedBy: Map 名 → [屏] }
 */
export function designComponents(root, keys, read = dirReader(root), mock = null) {
  const names = componentFiles(root)
  const pages = []
  const usedBy = new Map()
  const rootCls = new Map() // 组件名 → 根元素的第一个 class
  for (const key of keys) {
    const buf = read(key)
    if (!buf) continue
    const html = buf.toString('utf8')
    if (!usesComponents(html)) continue
    if (!adopts(html, read)) {
      // 写了 <c-…> 但设计里没有 components/：当页面自己的自定义元素，没展开（要用组件就建文件）
      pages.push({ page: key, errors: [], warnings: [{ code: 'unadopted', page: key, file: key, line: 0,
        message: `这屏写了 ${[...compNames(html)].slice(0, 3).map((n) => `<c-${n}>`).join('、')}，但设计里没有 components/ 文件夹：当成页面自己的自定义元素，没展开`,
        fix: '要用组件就建 components/<名>.html；是页面自己注册的自定义元素就不用管' }] })
      continue
    }
    const r = expandComponents(html, { read, page: key, mock, placeholders: false })
    for (const n of r.used) { if (!usedBy.has(n)) usedBy.set(n, []); usedBy.get(n).push(key) }
    const warnings = [...r.warnings, ...pageCssWarnings(html, r.used, read, rootCls, key)]
    if (r.errors.length || warnings.length) pages.push({ page: key, errors: r.errors, warnings })
  }
  const items = names.length ? catalog(read, names) : []
  const unused = items.map((x) => x.name).filter((n) => !usedBy.has(n))
  return { items, line: catalogLine(items), pages, unused, usedBy }
}

/** 组件文件根元素的第一个 class（去掉注释和 <style> 再找第一个标签） */
function rootClassOf(buf) {
  const src = String(buf || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
  const m = /<[a-z][\w-]*\b([^>]*)>/i.exec(src)
  const c = m && /\bclass\s*=\s*(["'])([^"']*)\1/i.exec(m[1])
  const first = c ? c[2].trim().split(/\s+/)[0] : ''
  return /^[A-Za-z_-][\w-]*$/.test(first) ? first : ''
}

/** 这屏自己的 <style> 里又写了组件根元素的 class（各屏写一份就会走样）：提醒删掉、写进组件 */
function pageCssWarnings(html, used, read, cache, page) {
  const css = [...String(html).matchAll(/<style\b(?![^>]*data-dsh-comp-css)[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  if (!css) return []
  const out = []
  for (const name of used) {
    if (!cache.has(name)) cache.set(name, rootClassOf(read(`components/${name}.html`)))
    const cls = cache.get(name)
    if (!cls) continue
    const re = new RegExp(`(?:^|[}\\s,>+~(])\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])[^{}]*\\{`)
    if (re.test(css)) {
      out.push({ code: 'page-css', page, file: page, line: 0,
        message: `这屏的 <style> 里又写了组件 ${name} 的 .${cls}`,
        fix: `删掉这屏里的这段，样式写进 components/${name}.html 的 <style>；只改这一屏就给 <c-${name}> 加 class 或 data-variant` })
    }
  }
  return out
}

/** 体检报告里的几行（没组件、没问题给 []） */
export function formatComponents(dc, max = 12) {
  const at = (d, page) => (d.file && d.file !== page ? `（${d.file}${d.line ? ` 第 ${d.line} 行` : ''}）` : d.line ? `（第 ${d.line} 行）` : '')
  const who = (r) => r.pages.size > 1 ? `${r.page} 等 ${r.pages.size} 屏` : r.page
  // 组件文件里的同一条（几屏都用到这个组件）只列一次；选择器没从根 class 开始的，每个组件文件并成一行
  const rows = []
  const seen = new Map()
  for (const kind of ['errors', 'warnings']) {
    for (const p of dc.pages) {
      for (const d of p[kind]) {
        const comp = d.file && d.file !== p.page
        const key = !comp ? null : d.code === 'css-scope' ? `scope|${d.file}` : `${kind}|${d.file}|${d.line}|${d.message}`
        const old = key && seen.get(key)
        if (old) { old.pages.add(p.page); if (d.code === 'css-scope' && !old.ds.some((x) => x.line === d.line && x.message === d.message)) old.ds.push(d); continue }
        const r = { kind, page: p.page, d, ds: [d], pages: new Set([p.page]) }
        rows.push(r)
        if (key) seen.set(key, r)
      }
    }
  }
  const lines = []
  for (const r of rows.slice(0, max)) {
    const { d } = r
    const tag = r.kind === 'errors' ? '✗' : '提醒'
    if (d.code === 'css-scope' && r.ds.length > 1) {
      const sel = (x) => (/「([^」]*)」/.exec(x.message) || [])[1] || ''
      const ln = r.ds.map((x) => x.line).filter(Boolean)
      lines.push(`- ${tag} ${who(r)}：${d.file} 里 ${r.ds.length} 个选择器没有从根元素的 class 开始（如「${r.ds.slice(0, 3).map(sel).join('」「')}」${ln.length ? `，第 ${ln.slice(0, 4).join('、')}${ln.length > 4 ? ' 等' : ''} 行` : ''}）${d.fix ? ` → ${d.fix}` : ''}`)
      continue
    }
    lines.push(`- ${tag} ${who(r)}：${d.message}${at(d, r.page)}${d.fix ? ` → ${d.fix}` : ''}`)
  }
  if (rows.length > max) lines.push(`- 还有 ${rows.length - max} 条没列`)
  for (const it of dc.items) if (it.error) lines.push(`- ✗ ${it.file || `components/${it.name}.html`}：${it.error}`)
  if (dc.unused.length) lines.push(`- 提醒 没有哪屏用到的组件：${dc.unused.slice(0, 6).join('、')}${dc.unused.length > 6 ? ' 等' : ''}`)
  return lines
}
