/**
 * 设计库用的 CSS 读法：照 CSS 规范分词（转义会还原：\75rl( 就是 url(），找出所有会去拿文件的地方。
 * Node 和浏览器里都能跑，不依赖别的包。
 */

const isHex = (c) => /[0-9a-fA-F]/.test(c)
const isNameStart = (c) => /[a-zA-Z_]/.test(c) || (c && c.charCodeAt(0) >= 0x80)
const isName = (c) => isNameStart(c) || /[0-9-]/.test(c)
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
const validEscape = (a, b) => a === '\\' && b !== '\n' && b !== '\r' && b !== '\f' && b !== undefined

/**
 * 分词。返回 [{ t, v, s, e }]
 *   t：ws comment str bad-str url bad-url func ident at hash num delim ( ) [ ] { } , : ; cdo cdc
 *   v：还原过转义的值（func / ident / at / hash 是名字，str / url 是内容）
 */
export function cssTokens(src, { from = 0, stop = null } = {}) {
  const s = String(src)
  const n = s.length
  const out = []
  let i = from

  function escape() {
    // 已经越过反斜杠
    const c = s[i]
    if (c === undefined) return '�'
    if (isHex(c)) {
      let hex = ''
      while (hex.length < 6 && i < n && isHex(s[i])) hex += s[i++]
      if (i < n && isWs(s[i])) { if (s[i] === '\r' && s[i + 1] === '\n') i++; i++ }
      const cp = parseInt(hex, 16)
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp)
    }
    i++
    return c
  }
  function name() {
    let v = ''
    for (;;) {
      const c = s[i]
      if (c !== undefined && isName(c)) { v += c; i++ } else if (validEscape(c, s[i + 1])) { i++; v += escape() } else return v
    }
  }
  const startsIdent = (a, b, c) => a === '-' ? isNameStart(b) || b === '-' || validEscape(b, c) : isNameStart(a) || validEscape(a, b)
  const startsNumber = (a, b, c) => /[0-9]/.test(a) || (a === '.' && /[0-9]/.test(b)) || ((a === '+' || a === '-') && (/[0-9]/.test(b) || (b === '.' && /[0-9]/.test(c))))

  function str(q, from) {
    let v = ''
    for (;;) {
      const c = s[i]
      if (c === undefined) return { t: 'str', v, s: from, e: i }
      if (c === q) { i++; return { t: 'str', v, s: from, e: i } }
      if (c === '\n' || c === '\r' || c === '\f') return { t: 'bad-str', v, s: from, e: i }
      if (c === '\\') {
        const d = s[i + 1]
        if (d === undefined) { i++; continue }
        if (d === '\n' || d === '\f') { i += 2; continue }
        if (d === '\r') { i += s[i + 2] === '\n' ? 3 : 2; continue }
        i++
        v += escape()
        continue
      }
      v += c
      i++
    }
  }

  function url(from) {
    while (i < n && isWs(s[i])) i++
    let v = ''
    for (;;) {
      const c = s[i]
      if (c === undefined) return { t: 'url', v, s: from, e: i }
      if (c === ')') { i++; return { t: 'url', v, s: from, e: i } }
      if (isWs(c)) {
        while (i < n && isWs(s[i])) i++
        if (s[i] === ')' || s[i] === undefined) { if (s[i] === ')') i++; return { t: 'url', v, s: from, e: i } }
        return badUrl(v, from)
      }
      if (c === '"' || c === "'" || c === '(' || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(c)) return badUrl(v, from)
      if (c === '\\') {
        if (validEscape(c, s[i + 1])) { i++; v += escape(); continue }
        return badUrl(v, from)
      }
      v += c
      i++
    }
  }
  function badUrl(v, from) {
    for (;;) {
      const c = s[i]
      if (c === undefined) return { t: 'bad-url', v, s: from, e: i }
      if (c === ')') { i++; return { t: 'bad-url', v, s: from, e: i } }
      if (validEscape(c, s[i + 1])) { i++; escape(); continue }
      i++
    }
  }

  while (i < n) {
    if (stop && stop(i, out)) break
    const from = i
    const c = s[i]
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
      out.push({ t: 'comment', v: '', s: from, e: i })
      continue
    }
    if (isWs(c)) { while (i < n && isWs(s[i])) i++; out.push({ t: 'ws', v: ' ', s: from, e: i }); continue }
    if (c === '"' || c === "'") { i++; out.push(str(c, from)); continue }
    if (c === '#') {
      if (isName(s[i + 1]) || validEscape(s[i + 1], s[i + 2])) { i++; out.push({ t: 'hash', v: name(), s: from, e: i }); continue }
      i++; out.push({ t: 'delim', v: '#', s: from, e: i }); continue
    }
    if ('()[]{},:;'.includes(c)) { i++; out.push({ t: c, v: c, s: from, e: i }); continue }
    if (startsNumber(c, s[i + 1], s[i + 2])) {
      i++
      while (i < n && /[0-9.eE]/.test(s[i])) i++
      if (s[i] === '%') i++
      else if (startsIdent(s[i], s[i + 1], s[i + 2])) name()
      out.push({ t: 'num', v: s.slice(from, i), s: from, e: i })
      continue
    }
    if (c === '-' && s[i + 1] === '-' && s[i + 2] === '>') { i += 3; out.push({ t: 'cdc', v: '-->', s: from, e: i }); continue }
    if (c === '<' && s.startsWith('<!--', i)) { i += 4; out.push({ t: 'cdo', v: '<!--', s: from, e: i }); continue }
    if (c === '@' && startsIdent(s[i + 1], s[i + 2], s[i + 3])) { i++; out.push({ t: 'at', v: name(), s: from, e: i }); continue }
    if (startsIdent(c, s[i + 1], s[i + 2])) {
      const v = name()
      if (s[i] === '(') {
        i++
        if (v.toLowerCase() === 'url') {
          let k = i
          while (k < n && isWs(s[k])) k++
          if (s[k] === '"' || s[k] === "'") { out.push({ t: 'func', v, s: from, e: i }); continue }
          out.push(url(from))
          continue
        }
        out.push({ t: 'func', v, s: from, e: i })
        continue
      }
      out.push({ t: 'ident', v, s: from, e: i })
      continue
    }
    i++
    out.push({ t: 'delim', v: c, s: from, e: i })
  }
  return out
}

// 参数里的字符串会被当成文件地址去拿的函数
export const URL_FUNCS = new Set(['url', 'src', 'image-set', '-webkit-image-set', 'image', 'cross-fade', '-webkit-cross-fade'])
const BAD_FUNCS = new Set(['expression', '-moz-element', 'element'])
const BAD_PROPS = new Set(['behavior', '-ms-behavior', '-moz-binding', 'binding'])

/**
 * 查一段 CSS（整份样式表，或 style="" 里的声明）。
 * 返回 { refs: [{ url, at, kind }], problems: [{ code, at, detail }] }
 *   refs：所有会去拿的地址（kind：'url' 普通、'font' 在 @font-face 里）；at：在这段 CSS 里的位置
 *   problems：import（@import）、func（expression() 这类）、prop（behavior / -moz-binding）、bad（写坏的 url / 字符串，可能藏东西）、font-url
 */
export function scanCss(src) {
  const toks = cssTokens(src)
  const refs = []
  const problems = []
  let depth = 0 // 括号层数（URL_FUNCS 里的字符串）
  const funcStack = []
  let fontFace = -1 // 在 @font-face 块里：块的层数
  let block = 0
  let skipUntilSemi = false // @namespace 的地址不会去拿
  let pendingAt = ''
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    const low = typeof tk.v === 'string' ? tk.v.toLowerCase() : ''
    if (skipUntilSemi) {
      if (tk.t === ';' || tk.t === '{') skipUntilSemi = false
      continue
    }
    switch (tk.t) {
      case 'at':
        if (low === 'import') problems.push({ code: 'import', at: tk.s })
        else if (low === 'namespace') skipUntilSemi = true
        pendingAt = low
        break
      case '{':
        block++
        if (pendingAt === 'font-face' && fontFace < 0) fontFace = block
        pendingAt = ''
        break
      case '}':
        if (fontFace === block) fontFace = -1
        block = Math.max(0, block - 1)
        break
      case ';':
        pendingAt = ''
        break
      case 'url':
        refs.push({ url: tk.v, at: tk.s, kind: fontFace > 0 ? 'font' : 'url' })
        break
      case 'bad-url':
      case 'bad-str':
        problems.push({ code: 'bad', at: tk.s })
        break
      case 'func':
        if (BAD_FUNCS.has(low)) problems.push({ code: 'func', at: tk.s, detail: tk.v })
        funcStack.push(low)
        depth++
        break
      case '(':
        funcStack.push('')
        depth++
        break
      case ')':
        funcStack.pop()
        depth = Math.max(0, depth - 1)
        break
      case 'str':
        if (funcStack.some((f) => URL_FUNCS.has(f))) refs.push({ url: tk.v, at: tk.s, kind: fontFace > 0 ? 'font' : 'url' })
        break
      case 'ident': {
        // 属性名：后面（跳过空白）是冒号
        let j = k + 1
        while (j < toks.length && (toks[j].t === 'ws' || toks[j].t === 'comment')) j++
        if (toks[j] && toks[j].t === ':' && BAD_PROPS.has(low)) problems.push({ code: 'prop', at: tk.s, detail: tk.v })
        break
      }
      default:
    }
  }
  return { refs, problems }
}
