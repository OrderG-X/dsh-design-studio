/**
 * 共用部件各屏写得不一样（#30 第 1 步）：同一个 class 的样式，在好几屏自己的 <style> 里各写了一份、写得还不一样。
 *
 * 屏一多、上下文一压缩，模型照抄部件时最容易走样（字号、边距、颜色差一点），单看哪屏都说得过去，放一起就乱。
 * 这里不开浏览器，只读文件：把每屏 <style> 里「.类名」开头的规则按选择器归到一起，比声明，写法不止一种的报出来。
 * 只是提醒（不算体检的问题数）：改法是挪进共用的 app.css，各屏删掉自己那份。
 *
 * 只比各屏自己的 <style>：共用的 app.css / tokens.css 本来就只有一份。<link> 进来的样式不看。
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_FILES = 600 // 屏再多也只读这么多（几百屏的原型也够）
const MAX_BYTES = 512 * 1024 // 一屏超过这么大不读
const MAX_ITEMS = 8
const PLACE = /^(top|left|right|bottom|inset(-[a-z-]+)?|z-index|position|order|grid-(area|column|row)(-[a-z]+)?|transform|translate|rotate|scale|align-self|justify-self|place-self)$/

/** 同一个值的不同记法写成一样（#FFF / #ffffff、0px / 0、.5 / 0.5、单双引号），不然报成「写得不一样」 */
export function sameValue(v) {
  return String(v)
    .replace(/#([0-9a-f]{3,8})\b/gi, (m, h) => '#' + (h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h).toLowerCase())
    .replace(/(^|[\s,(/])0(?:px|em|rem|vh|vw|pt)(?=$|[\s,)/])/g, '$10')
    .replace(/(^|[\s,(/+*-])\.(\d)/g, '$10.$2')
    .replace(/'/g, '"')
}

/** 选择器列表按最外层的逗号分开（:is(.a, .b)、[title="a,b"] 里的逗号不算） */
export function splitTop(head) {
  const out = []
  let depth = 0
  let quote = ''
  let at = 0
  for (let i = 0; i < head.length; i++) {
    const c = head[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if ((c === ')' || c === ']') && depth > 0) depth--
    else if (c === ',' && !depth) { out.push(head.slice(at, i)); at = i + 1 }
  }
  out.push(head.slice(at))
  return out
}

/** 一段 CSS → [{ sel, decls }]（@media 里的规则带上条件当选择器的一部分；@keyframes、@font-face 跳过） */
export function cssRules(css) {
  const out = []
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '')
  const walk = (text, prefix, depth) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      // 找配对的 }
      let d = 1
      let j = open + 1
      while (j < text.length && d) { const c = text[j]; if (c === '{') d++; else if (c === '}') d--; j++ }
      const body = text.slice(open + 1, j - 1)
      i = j
      if (!head) continue
      if (head.startsWith('@')) {
        if (depth < 2 && /^@(media|supports|container|layer)\b/i.test(head)) walk(body, prefix + head.replace(/\s+/g, ' ') + ' ', depth + 1)
        continue
      }
      if (body.includes('{')) continue // 嵌套写法（CSS nesting）：不认，跳过
      const decls = body.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
        const k = x.indexOf(':')
        return k > 0 ? [x.slice(0, k).trim().toLowerCase(), sameValue(x.slice(k + 1).trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/\s*!\s*important$/i, ' !important'))] : null
      }).filter(Boolean)
      if (!decls.length) continue
      for (const sel of splitTop(head).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) out.push({ sel: prefix + sel, decls })
    }
  }
  walk(src, '', 0)
  return out
}

/** 这个选择器像不像「部件」：以 .类名 开头（可以带后代 / 伪类），不碰状态、不是整页的 */
export function partSel(sel) {
  const s = sel.replace(/^@[^ ]+ [^.]*?(?=\.)/, '') // @media (…) .card → .card
  if (!/^\.[A-Za-z_][\w-]*/.test(s)) return false
  if (/\[data-state|\[data-theme|\[data-mode/.test(sel)) return false // 状态、深浅色各屏本来就不一样
  return true
}

/** 一屏 HTML 里每个 class 用在哪几种标签上（整页只扫一遍；class 按整词认，.card 不算 card-title） */
function tagTable(html) {
  const out = new Map()
  const re = /<([a-zA-Z][\w-]*)\b[^>]*?\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase()
    for (const c of (m[2] ?? m[3] ?? m[4] ?? '').split(/\s+/)) {
      if (!c) continue
      if (!out.has(c)) out.set(c, new Set())
      out.get(c).add(tag)
    }
  }
  return out
}

/** 一屏 HTML 里自己写的样式（<style media="(max-width: 600px)"> 的包成 @media，和别的断点分开比） */
export function inlineCss(html) {
  // 注释掉的旧 <style> 不算（浏览器里它不生效）
  // <template> 里的（没放进页面就不生效）也不算
  return [...String(html || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<template\b[\s\S]*?<\/template\s*>/gi, '').matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)].map((m) => {
    const media = /\bmedia\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1])
    const q = media ? String(media[1] ?? media[2] ?? media[3] ?? '').trim() : ''
    return q && !/^(all|screen)$/i.test(q) ? `@media ${q.replace(/[{}]/g, '')} {${m[2]}}` : m[2]
  }).join('\n')
}

/**
 * 比各屏：pages = [{ key, html }] → [{ sel, screens 写了它的屏数, variants 几种写法, props: [{ prop, values: [{ v, keys }] }] }]
 * 同一屏里同一个选择器写了几次：按出现顺序合起来（后面的盖前面的），和浏览器一样
 */
/** 几个方向并排（home-a / home-b，或 login / login-b）：本来就故意不一样，这几屏不比（和画布认方向一个规则） */
export function takeKeys(keys) {
  const VAR = /^(.+)-([a-z])\.html?$/i
  const stem = (k) => { const v = VAR.exec(k); return (v ? v[1] : k.replace(/\.html?$/i, '')).toLowerCase() }
  const by = new Map()
  for (const k of keys) { const s = stem(k); if (!by.has(s)) by.set(s, []); by.get(s).push(k) }
  const out = new Set()
  for (const list of by.values()) if (list.length > 1 && list.some((k) => VAR.test(k))) for (const k of list) out.add(k)
  return out
}

export function compareParts(pages, { max = MAX_ITEMS } = {}) {
  const takes = takeKeys(pages.map((p) => p.key))
  pages = pages.filter((p) => !takes.has(p.key))
  const bySel = new Map() // sel → Map(key → Map(prop → value))
  const htmlOf = new Map(pages.map((p) => [p.key, String(p.html || '')]))
  for (const { key, html } of pages) {
    const mine = new Map()
    for (const r of cssRules(inlineCss(html))) {
      if (!partSel(r.sel)) continue
      if (!mine.has(r.sel)) mine.set(r.sel, new Map())
      const m = mine.get(r.sel)
      // 后写的盖前面的；前面那条带 !important、后面的没带：前面的赢（和浏览器一样）
      for (const [k, v] of r.decls) if (!(/ !important$/.test(m.get(k) || '') && !/ !important$/.test(v))) m.set(k, v)
    }
    for (const [sel, m] of mine) {
      if (!bySel.has(sel)) bySel.set(sel, new Map())
      bySel.get(sel).set(key, m)
    }
  }
  const out = []
  // 标签表用到才建（屏多、样式多的设计，只有真写得不一样的部件才要看标签）
  const tables = new Map()
  const tagsOf = (key, cls) => {
    if (!tables.has(key)) tables.set(key, tagTable(htmlOf.get(key)))
    return tables.get(key).get(cls) || new Set()
  }
  for (const [sel, per] of bySel) {
    if (per.size < 2) continue
    // 哪几项不一样：只比两屏以上都写了、值又不一样的（一屏多写一项 = 这页自己加的，不算走样）；
    // 位置类的（top / left / z-index / grid-area…）各页本来就摆得不一样，不比
    const props = new Set([...per.values()].flatMap((m) => [...m.keys()]))
    const diff = []
    let shared = 0
    for (const p of props) {
      if (PLACE.test(p)) continue
      const vals = new Map()
      let n = 0
      for (const [key, m] of per) { if (!m.has(p)) continue; n++; const v = m.get(p); if (!vals.has(v)) vals.set(v, []); vals.get(v).push(key) }
      if (n < 2) continue
      shared++
      if (vals.size > 1) diff.push({ prop: p, values: [...vals].map(([v, keys]) => ({ v, keys })).sort((x, y) => y.keys.length - x.keys.length) })
    }
    if (!diff.length) continue
    // 只写了一两项的（.issue{padding-bottom:10px} 对 12px）差一项就是走样；共同写了好几项、一大半都不一样的才当撞名字
    if (shared >= 3 && diff.length * 2 > shared) continue
    // 不是同一个部件、只是撞了名字（首页的 .title 是大标题、详情页的 .title 是小节标题）：
    // 标签对不上（一屏是 h1、一屏是 h2）不算；声明一大半都不一样也不算——走了样的部件只差几项
    const cls = /^(?:@[^ ]+ [^.]*?)?\.([A-Za-z_][\w-]*)/.exec(sel)
    if (cls) {
      const tags = [...per.keys()].map((k) => tagsOf(k, cls[1]))
      const known = tags.filter((x) => x.size)
      const seen = new Map() // 标签 → 几屏用它
      for (const x of known) for (const tg of x) seen.set(tg, (seen.get(tg) || 0) + 1)
      if (known.length >= 2 && ![...seen.values()].some((n) => n >= 2)) continue
    }
    const variants = new Set([...per.values()].filter((m) => diff.some((d) => m.has(d.prop))).map((m) => JSON.stringify(diff.map((d) => (m.has(d.prop) ? m.get(d.prop) : null))))).size
    if (variants < 2) continue
    out.push({ sel, screens: per.size, variants, props: diff.slice(0, 4), more: Math.max(0, diff.length - 4), keys: [...per.keys()] })
  }
  // 写的屏越多、写法越多的越要紧
  out.sort((a, b) => b.screens - a.screens || b.variants - a.variants || (a.sel < b.sel ? -1 : 1))
  return { items: out.slice(0, max), more: Math.max(0, out.length - max) }
}

/** 读一套设计的各屏（keys 是相对 root 的文件名）再比 */
export function partDrift(root, keys) {
  const pages = []
  for (const key of (keys || []).slice(0, MAX_FILES)) {
    const f = path.join(root, key)
    try {
      const st = fs.statSync(f)
      if (!st.isFile() || st.size > MAX_BYTES) continue
      pages.push({ key, html: fs.readFileSync(f, 'utf8') })
    } catch { /* 读不了的跳过 */ }
  }
  return compareParts(pages)
}

const short = (keys, n = 3) => keys.slice(0, n).map((k) => k.replace(/\.html?$/i, '')).join('、') + (keys.length > n ? ` 等 ${keys.length} 屏` : '')

/** 给模型的字（体检结果后面接着） */
export function formatDrift(r, total) {
  if (!r || !r.items.length) return ''
  const lines = [`\n共用部件各屏写得不一样（不算进问题数，是提醒）：同一个 class 在几屏自己的 <style> 里各写了一份、还不一样，放一起看会乱。`]
  for (const it of r.items) {
    const ps = it.props.map((p) => `${p.prop}：${p.values.map((x) => `${x.v || '没写'}（${short(x.keys)}）`).join(' / ')}`)
    lines.push(`- ${it.sel}：${it.screens} 屏里有 ${it.variants} 种写法。${ps.join('；')}${it.more ? `；还有 ${it.more} 项不同` : ''}`)
  }
  if (r.more) lines.push(`- 还有 ${r.more} 个部件也这样`)
  lines.push(total > 6
    ? '改法：定一种写法挪进共用的 app.css，各屏删掉自己那份。屏多，先告诉用户哪几个部件不一致、问要不要统一，他说改再改，别一口气把所有屏都改了。'
    : '改法：定一种写法（多数屏用的那种）挪进共用的 app.css，各屏删掉自己那份。')
  return lines.join('\n')
}
