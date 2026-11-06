/**
 * 设计库用的 HTML 读法（不依赖浏览器，Node 和浏览器里都能跑）。
 *
 * 只为「查有没有危险的东西」服务，所以宁可多认：
 *   tokenize(src)   照 HTML 规范的分词走一遍（<style> / <textarea> 这类里面只当文字），拿样式、文字、注释和它们的位置
 *   scanTags(src)   每个 「<字母」 都当一个标签读一遍，不管它在注释、样式还是属性值里——
 *                   浏览器在 <svg> 里、或者遇到拼错的标签时读法会变，逐个都查就不怕读法对不上
 *   decodeEntities  &#106; &colon; 这类转义还原成字，好查 javascript: 这种藏起来的写法
 */

const WS = new Set(['\t', '\n', '\f', '\r', ' '])
const ALPHA = /[a-zA-Z]/

// 这些元素里面是纯文字（不再认标签），直到对应的结束标签
const RAWTEXT = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'textarea', 'title'])

// 常用的命名转义（够查危险写法：字母本身没有命名转义，能拼出 javascript: 的只有数字转义和下面这些标点）
const NAMED = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", nbsp: ' ',
  colon: ':', Tab: '\t', NewLine: '\n', sol: '/', bsol: '\\', lpar: '(', rpar: ')', period: '.', comma: ',',
  semi: ';', excl: '!', num: '#', commat: '@', equals: '=', quest: '?', lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']',
  lcub: '{', rcub: '}', lbrace: '{', rbrace: '}', verbar: '|', vert: '|', VerticalLine: '|', ast: '*', midast: '*',
  plus: '+', dollar: '$', percnt: '%', Hat: '^', grave: '`', lowbar: '_', UnderBar: '_', hyphen: '‐', dash: '‐',
  copy: '©', COPY: '©', reg: '®', REG: '®', trade: '™', middot: '·', centerdot: '·',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', times: '×', divide: '÷', deg: '°', yen: '¥', euro: '€',
  pound: '£', cent: '¢', bull: '•', rarr: '→', larr: '←', uarr: '↑', darr: '↓',
  harr: '↔', check: '✓', star: '☆', starf: '★', hearts: '♥', ensp: ' ', emsp: ' ',
  thinsp: ' ', zwj: '‍', zwnj: '‌', shy: '­', sect: '§', para: '¶', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ', infin: '∞',
  le: '≤', ge: '≥', ne: '≠', minus: '−', prime: '′', Prime: '″', loz: '◊', iexcl: '¡',
  iquest: '¿', acute: '´', uml: '¨', cedil: '¸', macr: '¯', ordf: 'ª', ordm: 'º',
}
// 不带分号也算数的老写法（只列上面有的）
const LEGACY = new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT', 'nbsp', 'copy', 'COPY', 'reg', 'REG', 'middot', 'laquo', 'raquo', 'times', 'divide', 'deg', 'yen', 'pound', 'cent', 'sect', 'para', 'plusmn', 'frac12', 'frac14', 'frac34', 'sup2', 'sup3', 'micro', 'iexcl', 'iquest', 'acute', 'uml', 'cedil', 'macr', 'ordf', 'ordm', 'shy'])

/**
 * 还原转义。inAttr：属性值里老写法后面跟着字母、数字或 = 时不还原（和浏览器一样）。
 * 返回 { text, unknown }：unknown = 认不出的命名转义（查网址时当可疑）
 */
export function decodeEntities(s, inAttr = false) {
  const str = String(s)
  if (!str.includes('&')) return { text: str, unknown: [] }
  const unknown = []
  const text = str.replace(/&(#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[a-zA-Z][a-zA-Z0-9]*;?)/g, (m, body, off) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const n = parseInt(body.slice(hex ? 2 : 1).replace(';', ''), hex ? 16 : 10)
      if (!Number.isFinite(n) || n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�'
      return String.fromCodePoint(n)
    }
    const semi = body.endsWith(';')
    const name = semi ? body.slice(0, -1) : body
    if (semi && Object.prototype.hasOwnProperty.call(NAMED, name)) return NAMED[name]
    // 不带分号：最长的老写法前缀
    for (let k = name.length; k > 1; k--) {
      const pre = name.slice(0, k)
      if (!LEGACY.has(pre)) continue
      const next = k < name.length ? name[k] : str[off + m.length] || ''
      if (inAttr && (k < name.length || /[=a-zA-Z0-9]/.test(next))) break
      return NAMED[pre] + name.slice(k) + (semi ? ';' : '')
    }
    unknown.push(m)
    return m
  })
  return { text, unknown }
}

/**
 * 从 src[i] === '<' 开始读一个标签（开始或结束标签）。读不成标签返回 null。
 * 返回 { end?, name, attrs: [{ name, value, raw, start, end, vStart, vEnd, quote, dup }], selfClosing, start, close, eof }
 *   value 已还原转义；raw 是原文；start / end 是整个属性在原文里的位置；vStart / vEnd 是值（不含引号）
 */
export function parseTagAt(src, i) {
  let p = i + 1
  let isEnd = false
  if (src[p] === '/') { isEnd = true; p++ }
  if (!ALPHA.test(src[p] || '')) return null
  const n = src.length
  let name = ''
  while (p < n && !WS.has(src[p]) && src[p] !== '/' && src[p] !== '>') { name += src[p] === '\0' ? '�' : src[p]; p++ }
  const tag = { end: isEnd, name: name.toLowerCase(), attrs: [], selfClosing: false, start: i, close: n, eof: false }
  const seen = new Set()
  const push = (a) => {
    a.name = a.name.toLowerCase()
    a.dup = seen.has(a.name)
    seen.add(a.name)
    const d = decodeEntities(a.raw, true)
    a.value = d.text
    a.unknown = d.unknown
    tag.attrs.push(a)
  }
  for (;;) {
    while (p < n && (WS.has(src[p]) || src[p] === '/')) {
      if (src[p] === '/' && src[p + 1] === '>') { tag.selfClosing = true; p++; break }
      p++
    }
    if (p >= n) { tag.eof = true; tag.close = n; return tag }
    if (src[p] === '>') { tag.close = p + 1; return tag }
    // 属性名（第一个字可以是 =）
    const aStart = p
    let aname = src[p]
    p++
    while (p < n && !WS.has(src[p]) && src[p] !== '/' && src[p] !== '>' && src[p] !== '=') { aname += src[p]; p++ }
    let q = p
    while (q < n && WS.has(src[q])) q++
    if (src[q] !== '=') {
      push({ name: aname, raw: '', start: aStart, end: p, vStart: p, vEnd: p, quote: '' })
      continue
    }
    q++
    while (q < n && WS.has(src[q])) q++
    if (q >= n) { push({ name: aname, raw: '', start: aStart, end: n, vStart: n, vEnd: n, quote: '' }); tag.eof = true; tag.close = n; return tag }
    if (src[q] === '>') { push({ name: aname, raw: '', start: aStart, end: q, vStart: q, vEnd: q, quote: '' }); p = q; continue }
    if (src[q] === '"' || src[q] === "'") {
      const quote = src[q]
      const close = src.indexOf(quote, q + 1)
      if (close < 0) { push({ name: aname, raw: src.slice(q + 1), start: aStart, end: n, vStart: q + 1, vEnd: n, quote }); tag.eof = true; tag.close = n; return tag }
      push({ name: aname, raw: src.slice(q + 1, close), start: aStart, end: close + 1, vStart: q + 1, vEnd: close, quote })
      p = close + 1
      continue
    }
    let e = q
    while (e < n && !WS.has(src[e]) && src[e] !== '>') e++
    push({ name: aname, raw: src.slice(q, e), start: aStart, end: e, vStart: q, vEnd: e, quote: '' })
    p = e
  }
}

/** 第几行（1 起） */
// 最近一份文字的换行位置（同一份文字反复问行号时不用每次从头数）
let lineCache = { src: null, nl: null }
export function lineAt(src, i) {
  if (lineCache.src !== src) {
    const nl = []
    for (let k = src.indexOf('\n'); k >= 0; k = src.indexOf('\n', k + 1)) nl.push(k)
    lineCache = { src, nl }
  }
  // 位置 i 之前有几个换行（二分）
  const nl = lineCache.nl
  let lo = 0
  let hi = nl.length
  const end = Math.min(i, src.length)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < end) lo = mid + 1; else hi = mid }
  return lo + 1
}

/**
 * 照规范分词（简化版：只认数据、标签、注释、doctype、纯文字元素）。
 * 返回 [{ type: 'text' | 'tag' | 'endtag' | 'comment' | 'doctype' | 'bogus' | 'cdata', start, end, ... }]
 *   tag / endtag 带 parseTagAt 的结果；text 带 raw（在哪个纯文字元素里，没有是 ''）
 */
/**
 * 纯文字元素从 from 起到哪结束：下一个 </名字（后面是空白、/ 或 >）。
 * cdata：中间的 <![CDATA[ … ]]> 里的 </名字 不算（矢量图里 <style> 的 CDATA 是文字）；没收尾的 CDATA 一直到最后
 */
export function rawEnd(src, name, from, cdata = false) {
  const re = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])|<!\\[CDATA\\[`, 'ig')
  re.lastIndex = from
  for (;;) {
    const m = re.exec(src)
    if (!m) return src.length
    if (m[0][1] === '/') return m.index
    if (!cdata) continue
    const c = src.indexOf(']]>', m.index + 9)
    if (c < 0) return src.length
    re.lastIndex = c + 3
  }
}

/**
 * opts.foreign：认不认 <svg> / <math>（外来内容）。默认认：里面 <![CDATA[ 是文字，只有 <style> 还按纯文字读（CDATA 里的 </style> 不算），
 *   title / textarea 这些不按纯文字读（和独立的 SVG 文件一样）。false：完全按网页读（<svg> 里的 title / textarea 也按纯文字）。
 *   网页里浏览器两种都有（<svg><p> 会跳回网页、<svg><title> 里按网页读）：查隐私 / 写法的地方两种都走一遍取并集（见 visibleText）
 */
export function tokenize(src, { foreign: useForeign = true } = {}) {
  const out = []
  const n = src.length
  let i = 0
  let raw = ''
  let foreign = 0 // 在 <svg> / <math> 里几层（里面的 <![CDATA[ 是文字）
  const text = (s, e, inRaw = '') => { if (e > s) out.push({ type: 'text', start: s, end: e, raw: inRaw, text: src.slice(s, e) }) }
  while (i < n) {
    if (raw) {
      const e = raw === 'plaintext' ? n : rawEnd(src, raw, i, foreign > 0)
      text(i, e, raw)
      i = e
      raw = ''
      continue
    }
    const lt = src.indexOf('<', i)
    if (lt < 0) { text(i, n); break }
    text(i, lt)
    const c = src[lt + 1] || ''
    if (src.startsWith('<!--', lt)) {
      let e
      if (src.startsWith('<!-->', lt)) e = lt + 5
      else if (src.startsWith('<!--->', lt)) e = lt + 6
      else {
        const a = src.indexOf('-->', lt + 4)
        const b = src.indexOf('--!>', lt + 4)
        const cands = [a >= 0 ? a + 3 : Infinity, b >= 0 ? b + 4 : Infinity]
        e = Math.min(...cands)
        if (!Number.isFinite(e)) e = n
      }
      out.push({ type: 'comment', start: lt, end: e, text: src.slice(lt, e) })
      i = e
      continue
    }
    if (c === '!') {
      if (foreign && src.startsWith('<![CDATA[', lt)) {
        const a = src.indexOf(']]>', lt + 9)
        const e = a < 0 ? n : a + 3
        out.push({ type: 'cdata', start: lt, end: e, text: src.slice(lt + 9, a < 0 ? n : a) })
        i = e
        continue
      }
      const a = src.indexOf('>', lt + 2)
      const e = a < 0 ? n : a + 1
      out.push({ type: /^<!doctype/i.test(src.slice(lt, lt + 9)) ? 'doctype' : 'bogus', start: lt, end: e, text: src.slice(lt, e) })
      i = e
      continue
    }
    if (c === '?') {
      const a = src.indexOf('>', lt + 2)
      const e = a < 0 ? n : a + 1
      out.push({ type: 'bogus', start: lt, end: e, text: src.slice(lt, e) })
      i = e
      continue
    }
    if (c === '/') {
      if (src[lt + 2] === '>') { i = lt + 3; continue }
      if (!ALPHA.test(src[lt + 2] || '')) {
        const a = src.indexOf('>', lt + 2)
        const e = a < 0 ? n : a + 1
        out.push({ type: 'bogus', start: lt, end: e, text: src.slice(lt, e) })
        i = e
        continue
      }
      const t = parseTagAt(src, lt)
      out.push({ type: 'endtag', start: lt, end: t.close, tag: t })
      if ((t.name === 'svg' || t.name === 'math') && foreign && useForeign) foreign--
      i = t.close
      continue
    }
    if (ALPHA.test(c)) {
      const t = parseTagAt(src, lt)
      out.push({ type: 'tag', start: lt, end: t.close, tag: t })
      i = t.close
      if (t.eof) break
      if ((t.name === 'svg' || t.name === 'math') && !t.selfClosing && useForeign) foreign++
      // <svg> / <math> 里（外来内容）：浏览器不按纯文字读 title / textarea / plaintext 这些（<svg><title> 里还会当网页读，
      // 里面的 <style> 照样生效），只有 <style> 我们还按纯文字读（CSS 照样查，实体另外还原一遍）
      if (t.name === 'plaintext' && !foreign) raw = 'plaintext'
      else if (RAWTEXT.has(t.name) && !(foreign && (t.selfClosing || t.name !== 'style'))) raw = t.name
      continue
    }
    text(lt, lt + 1)
    i = lt + 1
  }
  return out
}

/** 每个「<字母」都当标签读一遍（包括藏在注释、样式、属性值里的）；返回 parseTagAt 的结果列表 */
export function scanTags(src) {
  const out = []
  const re = /<[a-zA-Z]/g
  let m
  while ((m = re.exec(src))) {
    const t = parseTagAt(src, m.index)
    if (t) out.push(t)
  }
  return out
}

// 行内标签：前后的字在页面上连成一串（不隔开）；sup / sub 不算（脚注、上标和正文是两回事）
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark', 'nobr', 'q', 's', 'samp', 'small', 'span', 'strong', 'time', 'tspan', 'tt', 'u', 'var', 'wbr'])

/**
 * 看得见的文字（和 alt / title / placeholder 这些也会显示出来的属性）：查个人信息、可疑字用。
 * 按网页读和认外来内容读各走一遍取并集（浏览器在 <svg> / <math> 里会跳回网页读，两种都可能），宁多勿漏；
 * textarea / title / noscript / xmp / plaintext 里的字也算（会显示出来）。
 * 页面上连着的一串字（中间只隔着行内标签、注释，那里留一个 \u200b）拼成一段；表格格子、段落、换行这些隔开的各是一段，段和段之间用 \u0001 隔开
 *（不会被当成号码里的分隔，三个格子里的 139 / 1234 / 7788 不拼成手机号）
 */
export function visibleText(src) {
  const parts = []
  const seen = new Set()
  const add = (x) => { if (x && x.trim() && !seen.has(x)) { seen.add(x); parts.push(x) } }
  const SHOWN = new Set(['alt', 'title', 'placeholder', 'aria-label', 'value', 'content', 'label', 'summary', 'data-title'])
  const SHOWN_RAW = new Set(['', 'textarea', 'title', 'noscript', 'xmp', 'plaintext'])
  for (const foreign of [true, false]) {
    let run = ''
    // 一段里连续的空白按浏览器的做法并成一个；行内标签、注释那里留一个看不见的分界（\u200b）：
    // 号码可以跨过它（<b>139</b> 1234 7788），也可以从它后面开始（<span>Tel</span><span>139…</span> 排成两块时）
    const flush = () => { add(run.replace(/[ \t\n\r\f\u200b]+/g, (m) => (m.includes('\u200b') ? (/[^\u200b]/.test(m) ? ' \u200b' : '\u200b') : ' '))); run = '' }
    const mark = () => { if (run) run += '\u200b' }
    for (const t of tokenize(src, { foreign })) {
      if (t.type === 'text' && SHOWN_RAW.has(t.raw || '')) {
        if (t.raw) { flush(); add(decodeEntities(t.text).text) } else run += decodeEntities(t.text).text
        continue
      }
      if (t.type === 'cdata') { run += t.text; continue }
      if (t.type === 'comment') { mark(); continue }
      const tag = t.type === 'tag' || t.type === 'endtag' ? t.tag : null
      if (tag && INLINE.has(tag.name)) mark()
      else flush()
      if (t.type === 'tag') for (const a of tag.attrs) if (SHOWN.has(a.name)) add(a.value)
    }
    flush()
  }
  return parts.join('\n\u0001\n')
}
