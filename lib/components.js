import { tokenize, decodeEntities, lineAt } from './gallery/html.js'
import { cssTokens } from './gallery/css.js'
import { mockExpr } from './mock.js'

export const COMP_DIR = 'components'
export const COMP_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const LIMITS = Object.freeze({ depth: 8, file: 256 * 1024, out: 4 * 1024 * 1024, instances: 5000 })

const X = mockExpr()
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const PASS = new Set(('id hidden role tabindex title data-back data-href data-to data-mock-show data-mock-class ' +
  'data-mock-set data-mock-attr data-mock-reset class style').split(' '))
const NO_PASS = new Set(['data-mock-text', 'data-mock-each', 'data-mock-model'])
const PARAM = /^[\p{L}_$][\p{L}\p{N}_$-]*$/u
const fileOf = name => `${COMP_DIR}/${name}.html`
const attr = (t, name) => t.tag.attrs.find(a => a.name === name)
function escaped(s, attribute) {
  const out = new Output()
  for (let i = 0; i < s.length; i += 8192) {
    const chunk = s.slice(i, i + 8192).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    out.write(attribute ? chunk.replaceAll('"', '&quot;') : chunk)
  }
  return out.string()
}
const escapeText = s => escaped(s, false)
const escapeAttr = s => escaped(s, true)

export function isComponentRel(rel) {
  if (typeof rel !== 'string') return false
  const parts = rel.replaceAll('\\', '/').split('/')
  return parts.length === 2 && parts[0] === COMP_DIR && parts[1].endsWith('.html') && COMP_NAME.test(parts[1].slice(0, -5))
}

function pageTokens(html) {
  if (!/<c-/i.test(html)) return null
  const tokens = tokenize(html)
  let used = false
  for (const t of tokens) {
    if (t.type === 'tag' && t.tag.name.startsWith('c-')) used = true
    if (t.raw === 'script' && /\bcustomElements\s*\.\s*define\s*\(\s*['"]c-/i.test(t.text)) return null
  }
  return used ? tokens : null
}

export function usesComponents(html) {
  return pageTokens(html) !== null
}

const fixes = {
  name: '组件名用小写字母开头，只用小写字母、数字和分隔用的短横线。',
  syntax: '检查标签、参数和 mock 表达式的写法。',
  missing: '在设计根目录的 components 文件夹补上同名 HTML 文件。',
  required: '在调用标签上传入这个参数，或在组件里给它写默认值。',
  default: '同一参数只保留一个统一的默认值。',
  alias: '改组件内部列表的别名或下标名，避开传入路径的首段。',
  pass: '把这个绑定写到组件内部对应的普通元素上。',
  state: '用 data-status 或 data-variant 描述组件状态。',
  script: '删除组件里的脚本、iframe 或事件属性，用 data-mock-* 写交互。',
  whole: '只保留组件的根元素和可选的样式块。',
  root: '把组件内容包在一个根元素里，把样式块放在根元素旁边。',
  slot: '组件内只留一个不带 name 属性的 slot。',
  conflict: '删除调用标签或组件根元素上的重复属性。',
  'style-param': '用 class、data-status 或 data-variant 切换样式。',
  forward: '动态参数单独写成 {{参数}}，把前后文字移到接收它的组件里。',
  cycle: '去掉这条循环引用，把共用内容拆成独立组件。',
  depth: '减少嵌套层数，每条调用链最多八层。',
  big: '拆小组件或页面，减少重复的内容和组件实例。',
  'mock-path': '核对路径的首段、列表别名或 mock.json 的顶层字段。',
  'unknown-attr': '核对参数名，或在组件中声明这个参数。',
  'css-scope': '让每个选择器都以组件根元素的某个 class 开头。',
}

class Problem extends Error {
  constructor(code, message, doc, pos) {
    super(message)
    this.code = code
    this.doc = doc
    this.pos = pos
  }
}
function fail(code, message, doc, pos) { throw new Problem(code, message, doc, pos) }
function diag(problem, page, doc, pos) {
  const at = problem.doc || doc
  return { code: problem.code, message: problem.message, fix: fixes[problem.code], page,
    file: at.file, line: lineAt(at.src, problem.pos ?? pos) }
}

function pathBinding(src, doc, pos) {
  try {
    const ast = X.parse(src)
    if (X.lex(src).some(t => t.k === 'op' && ['(', ')'].includes(t.v))) throw new Error()
    if (ast.t !== 'path' || ast.segs.some(s => s.t !== 'lit' ||
      !['number', 'string'].includes(typeof s.v) || X.BAD.has(String(s.v)))) throw new Error()
    return { path: src.trim(), root: ast.segs[0].v }
  } catch { fail('syntax', `「${src}」要写成数据路径，例如 user.stage 或 list[0].x`, doc, pos) }
}

// Each 的别名只在直接子 template 的内容里可见。先给 token 配对，之后可跳过整个实例或假分支。
function indexDoc(src, file, tokens = tokenize(src)) {
  const doc = { src, file, tokens }
  const open = [], last = new Map()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    t.index = i
    const parent = open.at(-1)
    t.parent = parent
    t.scope = parent?.childScope
    if (t.type === 'tag') {
      t.after = i + 1
      t.close = i + 1
      t.childScope = t.scope
      const name = t.tag.name
      if (name === 'template' && parent?.each) t.childScope = { ...parent.each, outer: t.scope }
      const each = attr(t, 'data-mock-each')
      if (each) {
        try { t.each = X.parseEach(each.value) } catch { /* 组件里的坏绑定在分析定义时报错；页面交给已有体检 */ }
      }
      if (name.startsWith('c-')) t.component = src.slice(t.start + 3, t.start + 1 + name.length)
      if (!t.tag.selfClosing && !VOID.has(name)) {
        t.previous = last.get(name)
        last.set(name, open.length)
        t.after = t.close = tokens.length
        open.push(t)
      }
    } else if (t.type === 'endtag' && last.has(t.tag.name)) {
      const depth = last.get(t.tag.name)
      while (open.length > depth) {
        const start = open.pop()
        const matched = start.tag.name === t.tag.name
        start.close = i
        start.after = matched ? i + 1 : i
        start.matched = matched
        if (matched) t.openTag = start
        if (start.previous === undefined) last.delete(start.tag.name)
        else last.set(start.tag.name, start.previous)
      }
    }
  }
  return doc
}

function inScope(scope, name) {
  for (; scope; scope = scope.outer) if (scope.item === name || scope.index === name) return true
  return false
}

function declare(def, name, fallback, required, pos) {
  const key = name.toLowerCase()
  if (!PARAM.test(name)) fail('syntax', `参数名「${name}」写法不对`, def, pos)
  let p = def.params.get(key)
  if (!p) { p = { name: key, required: false, def: null }; def.params.set(key, p) }
  if (fallback !== null) {
    if (p.def !== null && p.def !== fallback) fail('default', `参数 ${name} 写了不同的默认值`, def, pos)
    p.def = fallback
  }
  p.required = p.def === null && (required || p.required)
  return key
}

// 字面片段保留原文，参数值只在调用点解码一次，写入时再按文字 / 属性转义。
function pieces(raw, def, pos, inAttr) {
  if (!raw.includes('{{')) return null
  const out = []
  let from = 0
  for (let i = raw.indexOf('{{'); i >= 0; i = raw.indexOf('{{', from)) {
    if (from < i) out.push(raw.slice(from, i))
    const end = raw.indexOf('}}', i + 2)
    if (end < 0) fail('syntax', '参数少了结束的 }}', def, pos + i)
    const spec = raw.slice(i + 2, end)
    const bar = spec.indexOf('|')
    const name = (bar < 0 ? spec : spec.slice(0, bar)).trim()
    const fallback = bar < 0 ? null : decodeEntities(spec.slice(bar + 1).trim(), inAttr).text
    out.push({ key: declare(def, name, fallback, true, pos + i) })
    from = end + 2
  }
  if (from < raw.length) out.push(raw.slice(from))
  return out
}

function collectPaths(ast, paths) {
  if (!ast) return
  if (ast.t === 'path') {
    let path = String(ast.segs[0].v)
    for (const seg of ast.segs.slice(1)) {
      if (seg.t !== 'lit') { collectPaths(seg, paths); break }
      path += typeof seg.v === 'number' ? `[${seg.v}]` : '.' + seg.v
    }
    paths.add(path)
  } else for (const key of ['a', 'b', 'c']) collectPaths(ast[key], paths)
}

function inspectMock(a, doc, paths) {
  try {
    switch (a.name) {
      case 'data-mock-class':
      case 'data-mock-attr':
        for (const pair of X.parsePairs(a.value)) {
          if (a.name === 'data-mock-attr' && /^on/i.test(pair.name)) fail('script', `不能绑定事件属性 ${pair.name}`, doc, a.start)
          if (a.name === 'data-mock-attr' && /^style$/i.test(pair.name)) fail('style-param', '不能用 data-mock-attr 绑定 style', doc, a.start)
          if (paths) collectPaths(pair.e, paths)
        }
        break
      case 'data-mock-each': collectPaths(X.parseEach(a.value).list, paths); break
      case 'data-mock-set': for (const s of X.parseStmts(a.value)) collectPaths(s.rhs, paths); break
      case 'data-mock':
      case 'data-mock-text':
      case 'data-mock-model':
      case 'data-mock-show': collectPaths(X.parse(a.value), paths); break
    }
  } catch (e) {
    if (e instanceof Problem) throw e
    fail('syntax', `${a.name}="${a.value}"：${e.message}`, doc, a.start)
  }
}

// 用 CSS 分词区分分组规则、选择器列表、属性选择器和声明中的字符串。
function inspectCss(def, raw, offset) {
  const classes = new Set((attr(def.root, 'class')?.value || '').split(/\s+/))
  const ts = cssTokens(raw).filter(t => !['ws', 'comment'].includes(t.t))
  const groups = [true]
  let start = 0, parens = 0
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    if (t.t === '[' && ts[i+2]?.v === '=' && ts[i+4]?.t === ']') {
      const key = ts[i+1].v.toLowerCase()
      if (key === 'data-status' || key === 'data-variant') def.values[key].add(ts[i+3].v)
    }
    if (['func', '(', '['].includes(t.t)) parens++
    if ([')', ']'].includes(t.t)) parens--
    if (parens) continue
    if (t.t === '{') {
      const first = ts[start]
      const group = first?.t === 'at' && /^(media|supports|layer|container|scope|starting-style)$/i.test(first.v)
      if (groups.at(-1) && first?.t !== 'at') {
        let depth = 0, selector = start
        for (let j = start; j <= i; j++) {
          const k = ts[j].t
          if ((j === i || k === ',') && !depth) {
            if (ts[selector]?.v !== '.' || !classes.has(ts[selector+1]?.v)) {
              def.warnings.push(new Problem('css-scope', `选择器「${raw.slice(ts[selector].s, ts[j].s).trim()}」没有从根元素的 class 开始`, def, offset + ts[selector].s))
            }
            selector = j + 1
          }
          if (['func', '(', '['].includes(k)) depth++
          if ([')', ']'].includes(k)) depth--
        }
      }
      groups.push(group)
      start = i + 1
    } else if (t.t === '}' || t.t === ';') {
      if (t.t === '}') groups.pop()
      start = i + 1
    }
  }
}

function readDef(read, name) {
  const file = fileOf(name)
  const input = read(file)
  if (input == null) fail('missing', `找不到 ${file}`)
  if (Buffer.byteLength(input) > LIMITS.file) fail('big', `${file} 超过 256 KB`, { file, src: '' }, 0)
  const def = indexDoc(String(input), file)
  Object.assign(def, { name, params: new Map(), warnings: [], styles: [], slot: false,
    values: { 'data-status': new Set(), 'data-variant': new Set() }, paths: new Set() })
  const whole = def.tokens.find(t => t.type === 'tag' && ['html', 'head', 'body'].includes(t.tag.name))
  if (whole) fail('whole', `组件不能包含 <${whole.tag.name}>`, def, whole.start)
  for (const t of def.tokens) {
    if (t.type === 'text') {
      if (t.raw === 'style') {
        if (t.text.includes('{{')) fail('style-param', 'style 里不能使用组件参数', def, t.start)
        def.styles.push(t)
      } else if (!t.parent && t.text.trim()) fail('root', '根元素外还有文字', def, t.start)
      else if (!t.raw || ['title', 'textarea'].includes(t.raw)) {
        t.parts = pieces(t.text, def, t.start, false)
        if (t.raw && t.parts) t.parent.rawParts = t.parts
      }
      continue
    }
    if (t.type !== 'tag') {
      if (t.type === 'endtag' && !t.openTag) fail('syntax', `多了结束标签 </${t.tag.name}>`, def, t.start)
      if (!t.parent && !['comment', 'endtag'].includes(t.type)) fail('root', '根元素外只能写空白、注释和 style', def, t.start)
      continue
    }
    const { name: tag } = t.tag
    if (tag === 'script' || tag === 'iframe') fail('script', `组件不能包含 <${tag}>`, def, t.start)
    if (tag === 'style' && t.parent) fail('root', 'style 要放在根元素旁边', def, t.start)
    if (tag === 'slot') {
      if (def.slot || attr(t, 'name')) fail('slot', '只支持一个不具名的 slot', def, t.start)
      def.slot = true
    }
    if (!t.parent && tag !== 'style') {
      if (def.root || tag === 'slot') fail('root', '组件需要一个可以标记的根元素', def, t.start)
      def.root = t
    }
    if (t.tag.eof || (!t.matched && !t.tag.selfClosing && !VOID.has(tag) && (t.component !== undefined || !t.parent))) {
      fail('syntax', `<${tag}> 标签没有闭合`, def, t.start)
    }
    if (t.component !== undefined && !COMP_NAME.test(t.component)) fail('name', `组件名「${t.component}」不合法`, def, t.start)
    for (const a of t.tag.attrs) {
      if (a.dup) fail('syntax', `属性 ${a.name} 重复了`, def, a.start)
      if (a.name === 'data-state') fail('state', '组件不能写 data-state', def, a.start)
      if (/^on/.test(a.name)) fail('script', `组件不能写事件属性 ${a.name}`, def, a.start)
      if (a.name === 'style' && a.raw.includes('{{')) fail('style-param', 'style 属性里不能使用组件参数', def, a.start)
      if (t.component !== undefined && NO_PASS.has(a.name)) fail('pass', `组件实例不能写 ${a.name}`, def, a.start)
      if (a.name === 'data-if') {
        const test = a.value.trim()
        t.negated = test.startsWith('!')
        t.condition = declare(def, t.negated ? test.slice(1) : test, null, false, a.start)
        continue
      }
      a.parts = pieces(a.raw, def, a.vStart, true)
      if (a.name.startsWith(':')) {
        if (t.component === undefined || a.parts || !PARAM.test(a.name.slice(1))) fail('syntax', `${a.name} 只用于给组件传入路径`, def, a.start)
        a.binding = pathBinding(a.value, def, a.start)
        def.paths.add(a.binding.path)
      } else if (a.name.startsWith('data-mock') && !a.parts) inspectMock(a, def, def.paths)
      if (def.values[a.name] instanceof Set && !a.parts && a.value) def.values[a.name].add(a.value)
    }
  }
  if (!def.root) fail('root', '组件缺少根元素', def, 0)
  for (const t of def.styles) inspectCss(def, t.text, t.start)
  for (const t of def.tokens) {
    if (t.type !== 'tag') continue
    for (const a of t.tag.attrs) {
      if (def.values[a.name] instanceof Set && a.parts?.length === 1) {
        const fallback = def.params.get(a.parts[0].key)?.def
        if (fallback) def.values[a.name].add(fallback)
      }
    }
  }
  return def
}

export function catalog(read, names) {
  const items = new Map()
  for (const input of names) {
    const name = String(input).replace(/^components\//, '').replace(/\.html$/, '')
    if (items.has(name)) continue
    const item = { name, file: fileOf(name), params: [], slot: false, statuses: [], variants: [], mockPaths: [] }
    try {
      if (!COMP_NAME.test(name)) fail('name', `组件名「${name}」不合法`)
      const def = readDef(read, name)
      Object.assign(item, { params: [...def.params.values()], slot: def.slot, statuses: [...def.values['data-status']].sort(),
        variants: [...def.values['data-variant']].sort(), mockPaths: [...def.paths].sort() })
    } catch (e) { if (!(e instanceof Problem)) throw e; item.error = e.message }
    items.set(name, item)
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

export function catalogLine(items) {
  if (!items.length) return ''
  return '组件：' + items.map(item => {
    if (item.error) return `${item.name}(有错，见体检)`
    const args = item.params.map(p => p.name + (p.required ? '' : p.def ? '=' + p.def : '?'))
    return `${item.name}(${args.join(', ')})`
  }).join(' · ')
}

// 拼接大字符串前在片段级计数。实例出错时可以回滚到它的起点，保留同屏其他实例。
class Output {
  parts = []
  bytes = 0
  limit = LIMITS.out
  write(s) {
    if (!s) return
    const bytes = Buffer.byteLength(s)
    if (this.bytes + bytes > this.limit) fail('big', '展开后的页面超过 4 MB')
    this.parts.push(s)
    this.bytes += bytes
  }
  mark() { return { length: this.parts.length, bytes: this.bytes } }
  rollback(mark) { this.parts.length = mark.length; this.bytes = mark.bytes }
  string() { return this.parts.join('') }
}

// mock 的引号内可以有分号；把单引号独立写成 "'"，其分句器也能正确识别边界。
function quote(s) {
  const out = new Output()
  const mixed = s.includes("'")
  if (mixed) out.write('(')
  out.write("'")
  for (let i = 0; i < s.length; i += 8192) {
    const literal = s.slice(i, i + 8192).replaceAll('\\', '\\\\').replaceAll('\n', '\\n')
    out.write(literal.replaceAll("'", `' + "'" + '`))
  }
  out.write("'")
  if (mixed) out.write(')')
  return out.string()
}
function expression(b) {
  return b.def == null ? b.path : `(${b.path} == null ? ${quote(b.def)} : ${b.path})`
}
function bound(ctx, key, token) {
  const b = ctx.bindings.get(key)
  if (b.path && inScope(token.scope, b.root)) {
    fail('alias', `参数 ${key} 的路径 ${b.path} 被内部列表别名 ${b.root} 遮住了`, ctx.doc, token.start)
  }
  return b
}

function attributeValue(a, ctx, t, forwarding = false, inAttr = true) {
  if (a.binding) return a.binding
  if (!a.parts) return { value: a.value, bare: a.end === a.start + a.name.length }
  if (a.parts.length === 1 && a.parts[0].key) return bound(ctx, a.parts[0].key, t)
  const values = a.parts.map(p => typeof p === 'string' ? { value: decodeEntities(p, inAttr).text } : bound(ctx, p.key, t))
  const dynamic = values.some(v => v.path)
  if (dynamic && forwarding) fail('forward', `转交给 ${a.name} 的动态参数混入了其他文字`, ctx.doc, a.start)
  const out = new Output()
  if (dynamic && values[0].path) out.write("'' + ")
  for (const [i, v] of values.entries()) {
    if (dynamic && i) out.write(' + ')
    out.write(dynamic ? (v.path ? expression(v) : quote(v.value)) : v.value)
  }
  return dynamic ? { expr: out.string() } : { value: out.string() }
}

function joined(a, b, sep) {
  const out = new Output()
  out.write(a)
  if (a && b) out.write(sep)
  out.write(b)
  return out.string()
}

function descriptor(a, doc, binding) {
  return { name: a.name, spelling: doc.src.slice(a.start, a.start + a.name.length),
    raw: !a.parts && !a.name.startsWith(':') ? doc.src.slice(a.start, a.end) : null, ...binding }
}

function showCondition(t, ctx) {
  if (!t.condition) return true
  const b = bound(ctx, t.condition, t)
  if (b.path) return t.negated ? `!(${expression(b)})` : expression(b)
  return Boolean(b.bare || b.value) !== t.negated
}

function renderedAttrs(t, ctx, passes, show) {
  const attrs = new Map(), dynamic = new Map()
  for (const a of t.tag.attrs) {
    if (a.name === 'data-if') continue
    const v = attributeValue(a, ctx, t)
    attrs.set(a.name, descriptor(a, ctx.doc, v))
    if (a.parts && a.name === 'data-mock-attr' && !v.path && !v.expr) inspectMock({ ...a, value: v.value }, ctx.doc, null)
    if (v.expr || v.path) {
      if (a.name.includes(':') || /^(style|srcdoc|http-equiv|data-mock.*)$/.test(a.name)) fail('syntax', `mock 不能动态设置 ${a.name}`, ctx.doc, a.start)
      dynamic.set(a.name, v.expr || expression(v))
    }
  }
  for (const p of passes) {
    const old = attrs.get(p.name)
    if (!old) {
      attrs.set(p.name, p)
      if (p.path) dynamic.set(p.name, expression(p))
      continue
    }
    if (p.name !== 'class' && p.name !== 'style') {
      fail('conflict', `调用标签和组件根元素都写了 ${p.name}`, p.doc, p.pos)
    }
    const sep = p.name === 'class' ? ' ' : ';'
    if (dynamic.has(p.name) || p.path) {
      const first = dynamic.get(p.name) || quote(old.value)
      const second = p.path ? expression(p) : quote(p.value)
      dynamic.set(p.name, joined(first, second, ' + ' + quote(sep) + ' + '))
    } else attrs.set(p.name, { value: joined(old.value, p.value, sep) })
  }
  if (typeof show === 'string') {
    const old = attrs.get('data-mock-show')
    attrs.set('data-mock-show', { value: old ? `(${old.value}) && (${show})` : show })
  }
  if (dynamic.size) {
    const out = new Output()
    out.write(attrs.get('data-mock-attr')?.value || '')
    for (const [name, expr] of dynamic) {
      attrs.delete(name)
      if (out.bytes) out.write('; ')
      out.write(name + ': ')
      out.write(expr)
    }
    attrs.set('data-mock-attr', { value: out.string() })
  }
  return attrs
}

function writeTag(out, t, attrs, doc) {
  out.write(doc.src.slice(t.start, t.start + 1 + t.tag.name.length))
  for (const [name, a] of attrs) {
    out.write(' ')
    if (a.raw != null) out.write(a.raw)
    else {
      out.write(a.spelling || name)
      if (!a.bare) {
        out.write('="')
        out.write(escapeAttr(a.value))
        out.write('"')
      }
    }
  }
  out.write(t.tag.selfClosing ? '/>' : '>')
}

// 放入收件方的列表模板前，只检查投影内容实际读取的自由变量。它自己的列表别名仍就近生效。
function checkSlotScope(html, slot, def) {
  if (!html.includes('data-mock')) return
  const projected = indexDoc(html, def.file)
  for (const t of projected.tokens) {
    if (t.type !== 'tag') continue
    for (const a of t.tag.attrs) {
      if (!a.name.startsWith('data-mock')) continue
      const paths = new Set()
      try {
        inspectMock(a, projected, paths)
        if (a.name === 'data-mock-set') for (const stmt of X.parseStmts(a.value)) collectPaths(stmt.lhs, paths)
      } catch (e) {
        if (!(e instanceof Problem)) throw e
        continue
      }
      for (const path of paths) {
        const root = path.split(/[.\[]/, 1)[0]
        if (!inScope(t.scope, root) && inScope(slot.scope, root)) {
          fail('alias', `插槽内容使用的 ${root} 被组件内部列表别名遮住了`, def, slot.start)
        }
      }
    }
  }
}

function placeholder(name, e) {
  return `<div data-dsh-comp-error="${e.code}" style="background:#fff1f2;color:#881337;border:2px solid #be123c;padding:8px">组件 ${escapeText(name.slice(0, 80))}：${escapeText(e.message.slice(0, 250))}</div>`
}

export function expandComponents(html, { read, page = '', mock = null, placeholders = true }) {
  const result = { html, used: [], deps: [], errors: [], warnings: [] }
  const tokens = pageTokens(html)
  if (!tokens) return result
  const doc = indexDoc(html, page, tokens)
  const used = new Set(), defs = new Map(), styles = new Map(), seenWarnings = new Set()
  const output = new Output(), styleOrder = []
  let instances = 0, styleBytes = 0, insertAt = 0, stopped = false
  const head = tokens.find(t => t.type === 'tag' && t.tag.name === 'head' && (!t.parent || t.parent.tag.name === 'html'))
  const firstStyle = head && tokens.findIndex(t => t.type === 'tag' && t.tag.name === 'style' && t.parent === head)
  // 没写 <head>：放到 <html> 或 doctype 后面（放最前面会落在 doctype 前，整页进怪异模式）
  const htmlOpen = head ? -1 : tokens.findIndex(t => t.type === 'tag' && t.tag.name === 'html')
  const doctype = head ? -1 : tokens.findIndex(t => t.type === 'doctype')
  const insertToken = head ? (firstStyle >= 0 ? firstStyle : head.close) : htmlOpen >= 0 ? htmlOpen + 1 : doctype >= 0 ? doctype + 1 : 0

  function warn(code, message, doc, pos) {
    const key = doc.file + '\0' + pos + '\0' + code + '\0' + message
    if (seenWarnings.has(key)) return
    seenWarnings.add(key)
    result.warnings.push(diag(new Problem(code, message, doc, pos), page))
  }
  function definition(name) {
    if (!defs.has(name)) {
      try { defs.set(name, readDef(read, name)) }
      catch (e) { if (!(e instanceof Problem)) throw e; defs.set(name, e) }
    }
    const d = defs.get(name)
    if (d instanceof Problem) throw d
    for (const w of d.warnings) warn(w.code, w.message, d, w.pos)
    return d
  }

  function instanceArgs(t, ctx, def, inherited, condition) {
    const bindings = new Map(), passes = [], caller = ctx.doc
    for (const a of t.tag.attrs) {
      if (a.name === 'data-if' && ctx.bindings) continue
      const dynamic = a.name.startsWith(':'), key = dynamic ? a.name.slice(1) : a.name
      if (key === 'style' && a.raw.includes('{{')) fail('style-param', 'style 属性里不能使用组件参数', caller, a.start)
      if (a.dup || bindings.has(key)) fail('syntax', `参数或属性 ${key} 重复了`, caller, a.start)
      if (key === 'data-state') fail('state', '组件实例不能写 data-state', caller, a.start)
      if (NO_PASS.has(key)) fail('pass', `组件实例不能写 ${key}`, caller, a.start)
      if (/^on/.test(key)) fail('script', `组件实例不能写事件属性 ${key}`, caller, a.start)
      const v = dynamic ? (a.binding || pathBinding(a.value, caller, a.start)) : attributeValue(a, ctx, t, true)
      if (dynamic && !PARAM.test(key)) fail('syntax', `参数名「${key}」写法不对`, caller, a.start)
      if (dynamic && !inScope(t.scope, v.root) && !ctx.outerScopes.some(s => inScope(s, v.root)) &&
        !Object.hasOwn(mock || {}, v.root)) {
        warn('mock-path', `路径 ${v.path} 的首段不在当前列表或初始 mock 数据里`, caller, a.start)
      }
      if (def.params.has(key)) bindings.set(key, v)
      else if (!dynamic && (PASS.has(key) || key.startsWith('aria-'))) {
        let pass = v
        if (v.path && key === 'data-mock-show') pass = { value: expression(v) }
        else if (v.path && key.startsWith('data-mock-')) fail('syntax', `${key} 需要写具体的 mock 绑定`, caller, a.start)
        if (key === 'data-mock-attr') inspectMock({ ...a, value: pass.value }, caller, null)
        passes.push({ ...descriptor(a, caller, pass), doc: caller, pos: a.start })
      } else warn('unknown-attr', `组件 ${def.name} 没有参数 ${key}`, caller, a.start)
    }
    for (const p of def.params.values()) {
      const v = bindings.get(p.name)
      if (!v && p.required) fail('required', `组件 ${def.name} 缺少参数 ${p.name}`, caller, t.start)
      if (!v) bindings.set(p.name, { value: p.def ?? '' })
      else if (v.path && p.def !== null && v.def == null) bindings.set(p.name, { ...v, def: p.def })
    }
    if (typeof condition === 'string') {
      const prior = passes.find(p => p.name === 'data-mock-show')
      if (prior) { prior.raw = null; prior.value = `(${prior.value}) && (${condition})` }
      else passes.push({ name: 'data-mock-show', value: condition, doc: caller, pos: t.start })
    }
    return { bindings, passes: passes.concat(inherited) }
  }

  function instance(out, t, ctx, root, show) {
    const name = t.component, mark = out.mark(), styleMark = styleOrder.length
    try {
      if (!COMP_NAME.test(name)) fail('name', `组件名「${name}」不合法`, ctx.doc, t.start)
      used.add(name)
      if (++instances > LIMITS.instances) fail('big', '单页组件实例超过 5000 个')
      if (!t.tag.selfClosing && !t.matched) fail('syntax', `<c-${name}> 缺少结束标签`)
      if (ctx.chain.includes(name)) fail('cycle', `组件循环引用：${[...ctx.chain, name].join(' → ')}`)
      if (ctx.depth >= LIMITS.depth) fail('depth', '组件嵌套超过八层')
      const def = definition(name)
      const args = instanceArgs(t, ctx, def, root ? ctx.passes : [], show)
      const inside = { ...args, doc: def, marker: root ? ctx.marker : name, slot: null, depth: ctx.depth + 1,
        chain: [...ctx.chain, name], outerScopes: t.scope ? [...ctx.outerScopes, t.scope] : ctx.outerScopes }
      if (showCondition(def.root, inside) === false) return
      if (def.slot && !t.tag.selfClosing && ctx.doc.src.slice(t.end, ctx.doc.tokens[t.close].start).trim()) {
        const content = new Output()
        render(content, { ...ctx, depth: ctx.depth + 1 }, t.index + 1, t.close)
        inside.slot = content.string()
      }
      if (def.styles.length && !styles.has(name)) {
        const block = new Output()
        block.write(`<style data-dsh-comp-css="${name}">`)
        for (const css of def.styles) { block.write(css.text); block.write('\n') }
        block.write('</style>')
        if (styleBytes + block.bytes + output.bytes > LIMITS.out) fail('big', '展开后的页面超过 4 MB')
        styles.set(name, block.string())
        styleOrder.push(name)
        styleBytes += block.bytes
        output.limit = LIMITS.out - styleBytes
      }
      render(out, inside, def.root.index, def.root.after)
    } catch (e) {
      if (!(e instanceof Problem)) throw e
      out.rollback(mark)
      while (styleOrder.length > styleMark) {
        const key = styleOrder.pop()
        styleBytes -= Buffer.byteLength(styles.get(key))
        styles.delete(key)
      }
      output.limit = LIMITS.out - styleBytes
      if (e.code === 'big' && stopped) throw e
      if (e.code === 'big') {
        if (!e.doc) { e.doc = ctx.doc; e.pos = t.start }
        stopped = true
      }
      result.errors.push(diag(e, page, ctx.doc, t.start))
      if (placeholders) out.write(placeholder(name, e))
    }
  }

  function render(out, ctx, from, end) {
    const { doc: d } = ctx
    for (let i = from; i < end; i++) {
      const t = d.tokens[i]
      if (d === doc && i === insertToken) insertAt = out.parts.length
      if (t.type === 'tag') {
        const root = t === d.root, show = showCondition(t, ctx)
        if (show === false) { i = t.after - 1; continue }
        if (t.component !== undefined) {
          if (!stopped) instance(out, t, ctx, root, show)
          if (t.matched || t.tag.selfClosing) i = t.after - 1
          continue
        }
        if (ctx.bindings && t.tag.name === 'slot') {
          if (ctx.slot !== null) {
            if (t.scope) checkSlotScope(ctx.slot, t, d)
            out.write(ctx.slot)
            i = t.after - 1
          }
          continue
        }
        if (ctx.bindings && (root || t.condition || t.rawParts || t.tag.attrs.some(a => a.parts))) {
          const attrs = renderedAttrs(t, ctx, root ? ctx.passes : [], show)
          if (t.rawParts) {
            const raw = attributeValue({ parts: t.rawParts }, ctx, t, false, false)
            if (raw.path || raw.expr) {
              if (attrs.has('data-mock-text')) fail('conflict', '原始文本参数和 data-mock-text 同时设置了内容', d, t.start)
              attrs.set('data-mock-text', { value: raw.expr || expression(raw) })
              i++ // title、textarea 按纯文字解析，绑定到宿主，不能在里面插 span。
            }
          }
          if (root) attrs.set('data-dsh-c', { value: ctx.marker })
          writeTag(out, t, attrs, d)
          continue
        }
      }
      if (ctx.bindings && t.type === 'endtag' && t.tag.name === 'slot') continue
      if (ctx.bindings && t.parts) {
        for (const p of t.parts) {
          if (typeof p === 'string') out.write(p)
          else {
            const b = bound(ctx, p.key, t)
            out.write(b.path ? `<span data-mock-text="${escapeAttr(expression(b))}"></span>` : escapeText(b.value))
          }
        }
      } else out.write(d.src.slice(t.start, t.end))
    }
  }

  try {
    render(output, { doc, chain: [], depth: 0, outerScopes: [] }, 0, tokens.length)
    if (output.bytes + styleBytes > LIMITS.out) fail('big', '展开后的页面超过 4 MB')
    if (insertToken === tokens.length) insertAt = output.parts.length
    output.parts.splice(insertAt, 0, ...styles.values())
    result.html = output.string()
  } catch (e) {
    if (!(e instanceof Problem) || e.code !== 'big') throw e
    if (!stopped) result.errors.push(diag(e, page, doc, 0))
    result.html = placeholders ? placeholder('页面', e) : ''
  }
  result.used = [...used].sort()
  result.deps = result.used.map(fileOf).sort()
  return result
}
