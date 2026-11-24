/**
 * 模拟数据（#30 第 3 步）：整套原型共用一份数据，点了会变、换页还在、能重置——像真的 App 连着数据源。
 *
 *   设计目录根下 mock.json          整套原型的初始数据（一个 JSON 对象）
 *   <span data-mock-text="user.name">          显示数据
 *   <div data-mock-show="user.stage == 'onsite'">  条件显示（不成立就藏起来）
 *   <button data-mock-set="user.stage = 'onsite'">   点了改数据（几句用 ; 隔开）
 *   <li data-mock-class="on: tab == 'home'">          按条件加 class
 *   <button data-mock-attr="disabled: !form.agree">   按条件设属性
 *   <input data-mock-model="form.phone">              输入框和数据双向（填了换页还在）
 *   <ul data-mock-each="app in applications"><template>…app.title…</template></ul>   按数组重复
 *   <button data-mock-reset>                          回到初始数据
 *   <meta name="dsh-states" content="interviewing:面试中, onsite:在项" data-mock="user.stage">   这页的状态跟着数据走
 *   脚本里：mock.get('user.stage') / mock.set(…) / mock.push(…) / mock.remove(…) / mock.on(fn) / mock.reset()
 *
 * 预览服务器（serve.js）、远程看（index.js 的打包）、整套 HTML 演示（htmlpack.js）都在每屏 <head> 最前面放一段运行时 + 这份数据。
 * 当前数据存在浏览器的 localStorage（键里带 mock.json 内容的指纹：文件一改就从新文件重新开始）；
 * 无头浏览器（体检、截图、导出图片）只放内存，不存——各屏互不串，量出来的都是初始数据。
 * 地址带 ?state=x（画布状态标签、体检逐状态、导出逐状态）且这页状态跟着某个字段走：这一屏临时把那个字段当成 x，只在内存，
 * 不写回；用户在这屏改了那个字段才算数。
 *
 * 表达式不用 eval（别人做的设计加了 CSP 也照样能跑；也就没有执行任意代码这回事）：
 * 只认 路径（a.b[0].c、别名）、字面量、! - 、+ - * / %、比较、&& ||、a ? b : c、括号。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const MOCK_FILE = 'mock.json'
export const MOCK_MAX = 1024 * 1024 // mock.json 再大就不读（每屏都要带一份）

/** 表达式：拆词、解析、求值（浏览器里跑，node 里测；整段原样塞进页面，不能用外面的变量） */
export function mockExpr() {
  const BAD = new Set(['__proto__', 'prototype', 'constructor'])
  const ID = /[\p{L}_$][\p{L}\p{N}_$]*/uy
  const NUM = /\d+(?:\.\d+)?/y
  const OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '(', ')', '[', ']', '.', ',', ';', '=']
  function lex(s) {
    s = String(s)
    const out = []
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (/\s/.test(c)) { i++; continue }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1
        let v = ''
        while (j < s.length && s[j] !== c) {
          if (s[j] === '\\' && j + 1 < s.length) { j++; v += s[j] === 'n' ? '\n' : s[j] === 't' ? '\t' : s[j] } else v += s[j]
          j++
        }
        if (j >= s.length) throw new Error('引号没配对')
        out.push({ k: 'lit', v })
        i = j + 1
        continue
      }
      NUM.lastIndex = i
      let m = NUM.exec(s)
      if (m) { out.push({ k: 'lit', v: Number(m[0]) }); i += m[0].length; continue }
      ID.lastIndex = i
      m = ID.exec(s)
      if (m) {
        const w = m[0]
        if (w === 'true' || w === 'false') out.push({ k: 'lit', v: w === 'true' })
        else if (w === 'null' || w === 'undefined') out.push({ k: 'lit', v: null })
        else out.push({ k: 'id', v: w })
        i += w.length
        continue
      }
      const op = OPS.find((o) => s.startsWith(o, i))
      if (!op) throw new Error('看不懂「' + c + '」')
      out.push({ k: 'op', v: op })
      i += op.length
    }
    return out
  }
  const BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }
  function parser(toks) {
    let p = 0
    const isOp = (v) => !!toks[p] && toks[p].k === 'op' && toks[p].v === v
    const eat = (v) => { if (!isOp(v)) throw new Error('这里该有「' + v + '」'); p++ }
    function path() {
      const segs = [{ t: 'lit', v: toks[p++].v }]
      for (;;) {
        if (isOp('.')) {
          p++
          const t = toks[p]
          if (!t || !(t.k === 'id' || (t.k === 'lit' && typeof t.v === 'number'))) throw new Error('「.」后面要写名字')
          segs.push({ t: 'lit', v: String(t.v) })
          p++
        } else if (isOp('[')) {
          p++
          segs.push(expr())
          eat(']')
        } else break
      }
      return { t: 'path', segs }
    }
    function primary() {
      const t = toks[p]
      if (!t) throw new Error('没写完')
      if (t.k === 'lit') { p++; return { t: 'lit', v: t.v } }
      if (t.k === 'id') return path()
      if (isOp('(')) { p++; const e = expr(); eat(')'); return e }
      throw new Error('看不懂「' + t.v + '」')
    }
    function unary() {
      if (isOp('!') || isOp('-') || isOp('+')) { const op = toks[p++].v; return { t: 'un', op, a: unary() } }
      return primary()
    }
    function bin(min) {
      let a = unary()
      for (;;) {
        const t = toks[p]
        const pr = t && t.k === 'op' ? BIN[t.v] || 0 : 0
        if (!pr || pr < min) return a
        p++
        a = { t: 'bin', op: t.v, a, b: bin(pr + 1) }
      }
    }
    function expr() {
      const c = bin(1)
      if (isOp('?')) { p++; const a = expr(); eat(':'); const b = expr(); return { t: 'cond', c, a, b } }
      return c
    }
    return { expr, path, isOp, eat, end: () => p >= toks.length, at: () => toks[p] }
  }
  /** 一个表达式 */
  function parse(src) {
    const ps = parser(lex(src))
    const e = ps.expr()
    if (!ps.end()) throw new Error('多了「' + ps.at().v + '」')
    return e
  }
  /** data-mock-set：「路径 = 表达式」，几句用 ; 隔开 */
  function parseStmts(src) {
    const ps = parser(lex(src))
    const out = []
    while (!ps.end()) {
      if (ps.isOp(';') || ps.isOp(',')) { ps.eat(ps.at().v); continue }
      const t = ps.at()
      if (t.k !== 'id') throw new Error('要先写改哪个，比如 user.stage = \'onsite\'')
      const lhs = ps.path()
      ps.eat('=')
      out.push({ lhs, rhs: ps.expr() })
      if (!ps.end() && !ps.isOp(';') && !ps.isOp(',')) throw new Error('多了「' + ps.at().v + '」')
    }
    if (!out.length) throw new Error('是空的')
    return out
  }
  /** 按最外层的 ;（引号里的不算）切开 */
  function splitTop(src) {
    const out = []
    let cur = ''
    let q = ''
    for (const c of String(src)) {
      if (q) { if (c === q) q = ''; cur += c; continue }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue }
      if (c === ';') { out.push(cur); cur = ''; continue }
      cur += c
    }
    out.push(cur)
    return out.map((x) => x.trim()).filter(Boolean)
  }
  /** data-mock-class / data-mock-attr：「名字: 表达式」，几条用 ; 隔开 */
  function parsePairs(src) {
    const out = []
    for (const part of splitTop(src)) {
      const i = part.indexOf(':')
      if (i <= 0) throw new Error('要写成「名字: 条件」')
      const name = part.slice(0, i).trim()
      if (!/^[^\s"'<>=/]+(\s+[^\s"'<>=/]+)*$/.test(name)) throw new Error('名字「' + name + '」不对')
      out.push({ name, e: parse(part.slice(i + 1)) })
    }
    if (!out.length) throw new Error('是空的')
    return out
  }
  /** data-mock-each：「item in list」或「item, i in list」 */
  function parseEach(src) {
    const m = /^\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:,\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*)?\s+in\s+([\s\S]+)$/u.exec(String(src))
    if (!m) throw new Error('要写成「app in applications」')
    const list = parse(m[3])
    if (list.t !== 'path') throw new Error('in 后面要写数据里的一个数组')
    return { item: m[1], index: m[2] || '', list }
  }
  /** 路径换成从数据根开始的那串键；别名指着数据里某处的接着往下走，指着一个值的（序号）返回 { val } */
  function absPath(n, env) {
    if (n.t !== 'path') return null
    const keys = n.segs.map((s, i) => (i === 0 ? s.v : evaluate(s, env)))
    for (const k of keys) {
      if (typeof k !== 'string' && typeof k !== 'number') throw new Error('路径里有不是名字也不是序号的')
      if (BAD.has(String(k))) throw new Error('路径里不能有 ' + k)
    }
    const sc = env.scope && Object.hasOwn(env.scope, keys[0]) ? env.scope[keys[0]] : null
    if (sc && sc.abs) return { abs: sc.abs.concat(keys.slice(1).map(String)) }
    if (sc) return { val: sc.val, rest: keys.slice(1).map(String) }
    return { abs: keys.map(String) }
  }
  function dig(v, keys) {
    for (const k of keys) {
      if (v == null || (typeof v !== 'object' && typeof v !== 'string')) return undefined
      const o = Object(v)
      if (!Object.hasOwn(o, k)) return undefined
      v = o[k]
    }
    return v
  }
  // soft：这个值只拿来判断（! 后面、? 前面、&& / || 左边、比较的两边）——没写这个字段多半是故意的（「没有就当否」），不算漏写
  const CMP = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>='])
  function evaluate(n, env, soft) {
    switch (n.t) {
      case 'lit': return n.v
      case 'un': { const v = evaluate(n.a, env, soft || n.op === '!'); return n.op === '!' ? !v : n.op === '-' ? -v : +v }
      case 'cond': return evaluate(n.c, env, true) ? evaluate(n.a, env, soft) : evaluate(n.b, env, soft)
      case 'path': { const r = absPath(n, env); return r.abs ? env.read(r.abs, !!soft) : dig(r.val, r.rest) }
      case 'bin': {
        if (n.op === '&&') { const a = evaluate(n.a, env, true); return a ? evaluate(n.b, env, soft) : a }
        if (n.op === '||') { const a = evaluate(n.a, env, true); return a || evaluate(n.b, env, soft) }
        const a = evaluate(n.a, env, soft || CMP.has(n.op))
        const b = evaluate(n.b, env, soft || CMP.has(n.op))
        switch (n.op) {
          // == 按值比：'1' 和 1 一样、null 和没写一样（模型写数据、写条件时类型常常对不齐）
          case '==': return a == b // eslint-disable-line eqeqeq
          case '!=': return a != b // eslint-disable-line eqeqeq
          case '===': return a === b
          case '!==': return a !== b
          case '<': return a < b
          case '>': return a > b
          case '<=': return a <= b
          case '>=': return a >= b
          case '+': return (a == null ? (typeof b === 'number' ? 0 : '') : a) + (b == null ? (typeof a === 'number' ? 0 : '') : b)
          case '-': return a - b
          case '*': return a * b
          case '/': return a / b
          case '%': return a % b
        }
      }
    }
    return undefined
  }
  /** 脚本里写的路径（'user.stage'、'items[0].title'、['items', 0]）→ 那串键 */
  function keysOf(p) {
    const keys = Array.isArray(p) ? p.map(String) : (() => {
      const n = parse(p)
      if (n.t !== 'path') throw new Error('「' + p + '」不是数据里的路径')
      return absPath(n, { scope: null, read: () => undefined }).abs
    })()
    if (!keys.length) throw new Error('路径是空的')
    for (const k of keys) if (BAD.has(k)) throw new Error('路径里不能有 ' + k)
    return keys
  }
  return { lex, parse, parseStmts, parsePairs, parseEach, absPath, evaluate, keysOf, dig, BAD }
}

/**
 * 运行时（浏览器里，每屏 <head> 最前面跑一次）。mkExpr 是上面那个函数；C = { v 指纹, scope 存的键前缀, err mock.json 的问题 }；D0 初始数据；
 * A：打成单个文件时数据里写的本地图片 → data: 地址（只在设成 src / href 这类地址时换，数据本身不动：同一个字段拿来显示文件名照样是文件名）
 */
export function mockRuntime(mkExpr, C, D0, A) {
  const W = window
  if (W.__dshMock) return
  const X = mkExpr()
  const D = document
  const de = D.documentElement
  const warned = new Set()
  const warn = (msg) => {
    if (warned.has(msg) || warned.size > 40) return
    warned.add(msg)
    try { console.warn('[mock] ' + msg) } catch { /* 没有控制台 */ }
    try { const L = W.__dshErrs; if (L && L.length < 30) L.push({ msg: '模拟数据：' + String(msg).slice(0, 260), src: 'mock.json', line: 0 }) } catch { /* 没有报错记录 */ }
  }
  if (C.err) warn(C.err)
  const isObj = (x) => !!x && typeof x === 'object'
  const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  const fresh = () => copy(isObj(D0) ? D0 : {})
  const PFX = 'dsh-mock:' + (C.scope || '') + ':'
  const KEY = PFX + C.v
  let ls = null
  // 演示包里存播放器手上那一份（__ddpMockStore：自己做的屏和别人做的屏换着放也读得到）；预览里存这个地址的 localStorage
  if (!W.__dshHeadless) { try { ls = W.__ddpMockStore || W.localStorage; void ls.length } catch { ls = null } }
  const load = () => {
    try { const t = ls && ls.getItem(KEY); const v = t ? JSON.parse(t) : null; if (isObj(v)) return v } catch { /* 坏了就重来 */ }
    return fresh()
  }
  let data = load()
  // 旧版 mock.json 的那份（文件改过）：清掉，免得越攒越多把存储占满
  try { if (ls) for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && k.startsWith(PFX) && k !== KEY) ls.removeItem(k) } } catch { /* 存不了 */ }

  const read = (obj, keys) => X.dig(obj, keys)
  const put = (obj, keys, v) => {
    let cur = obj
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      if (!isObj(cur[k])) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}
      cur = cur[k]
    }
    cur[keys[keys.length - 1]] = v
  }
  // 地址指定的状态（?state=x）临时盖在数据上：只在内存，不写回
  const overlay = new Map()
  let view = data
  const rebuild = () => {
    if (!overlay.size) { view = data; return }
    view = copy(data)
    for (const o of overlay.values()) put(view, o.keys, o.v)
  }
  const save = () => {
    if (!ls) return
    try { ls.setItem(KEY, JSON.stringify(data)) } catch (e) { warn('存不下：' + (e && e.message)) }
  }
  const subs = new Set()
  let ready = false
  let queued = false
  let inSubs = false // 正在跑 mock.on 的回调
  let fromSubs = false // 这一轮刷新是回调里改数据引起的
  let fromOther = false // 这一轮刷新是别的屏改了数据引起的（storage 事件）
  // 回调里真改了数据（值变了）→ 又刷新 → 又改……连着几圈了。本屏直接改的（点、填、拖滑块、页面脚本）清零；
  // 别的屏改的不清零也不加：两屏的回调来回改时，每圈都是「回调里真改了」，照样数得到
  let chain = 0
  // 两屏的回调把同一个字段改成不一样的值（各算各的）：每圈都隔着一个 storage 事件，上面的计数数不到；
  // 按快慢看：一秒里回调真改了几百次（人拖滑块一秒最多几十次）就是停不下来了
  let rate = 0
  let rateAt = 0
  const schedule = () => {
    if (inSubs) fromSubs = true
    if (!ready || queued) return
    queued = true
    Promise.resolve().then(() => {
      queued = false
      if (!fromSubs && !fromOther) chain = 0
      fromSubs = false
      fromOther = false
      render()
      // 回调里每次都改成不一样的值（比如 count + 1）、两屏的回调来回改：页面的回调停下、报出来，不把页面卡死
      // （「数据」面板的桥照样收：面板上看到的、存的都是真的）
      const now = Date.now()
      if (now - rateAt > 1000) { rateAt = now; rate = 0 } // 停下以后过一秒，下回有人改了再试
      const stop = chain > 50 || rate > 300
      if (stop) warn('mock.on 的回调里一直在改数据（改了又触发回调），停下了：回调里改之前先看看值是不是已经对了')
      inSubs = true
      try { for (const fn of [...subs]) { if (stop && !fn.__dshKeep) continue; try { fn(copy(view)) } catch (e) { warn('mock.on 里出错：' + (e && e.message)) } } } finally { inSubs = false }
      if (fromSubs) { chain++; rate++ } else chain = 0
    })
  }
  const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false } }
  const write = (keys, v) => {
    const k = keys.join('.')
    // 这屏临时当成某个状态（?state=）时，回调里算出来的（运费、合计）只是这屏的：叠在临时那层上，不进数据、不存——
    // 不然下回点别的、整份数据一存，并排的别的状态也被改了
    if (inSubs && overlay.size) {
      if (same(read(view, keys), v === undefined ? null : v)) return
      for (const o of [...overlay.keys()]) if (o.startsWith(k + '.')) overlay.delete(o)
      overlay.set(k, { keys, v: v === undefined ? null : copy(v), derived: true })
      rebuild()
      schedule()
      return
    }
    const hit = [...overlay.keys()].filter((o) => o === k || o.startsWith(k + '.') || k.startsWith(o + '.'))
    // 值没变、也没盖着临时状态：不存、不刷新（mock.on 里「算合计再写回」第二圈就停）
    if (!hit.length && same(read(data, keys), v === undefined ? null : v)) return
    put(data, keys, v === undefined ? null : copy(v))
    for (const o of hit) overlay.delete(o)
    rebuild()
    save()
    schedule()
  }
  const reset = () => {
    data = fresh()
    // 临时状态那屏回调算出来的（运费）也清掉：重置后按初始数据重新算
    for (const [k, o] of [...overlay]) if (o.derived) overlay.delete(k)
    if (ls) { try { ls.removeItem(KEY) } catch { /* 存不了 */ } }
    rebuild()
    schedule()
  }
  // 同一个设计开着的别的屏（画布上几屏一起开着、另一个标签页）改了：跟着变
  if (ls) {
    W.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== null) return
      try { const v = e.newValue ? JSON.parse(e.newValue) : null; data = isObj(v) ? v : fresh() } catch { data = fresh() }
      // 别的屏 / 「数据」面板点了重置（存的那份被删了）：这屏临时状态里回调算出来的也清掉，按初始数据重算
      if (!e.newValue) for (const [k, o] of [...overlay]) if (o.derived) overlay.delete(k)
      rebuild()
      fromOther = true
      schedule()
    })
  }

  // ── 把数据画到页面上 ──
  const scopes = new WeakMap() // 列表里重复出来的每一份 → 它的别名（app → applications.1）
  const scopeOf = (el) => { for (let a = el; a; a = a.parentElement) { const s = scopes.get(a); if (s) return s } return null }
  const missing = new Map() // 读不到的字段 → 用到它的元素（最后按看不看得见筛）
  // 列表里的一条没有这个字段、别的条有：是可选的（「有标签的才显示标签」），不算漏写
  const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
  // 中间一层写明了是 null（「selected": null」= 还没选）：后面的字段读不到是正常的，不算漏写
  const anyHas = (o, keys, i) => (i === keys.length ? o !== undefined : o === null ? true : !isObj(o) ? false : Array.isArray(o) && /^\d+$/.test(keys[i]) ? o.some((x) => anyHas(x, keys, i + 1)) : anyHas(own(o, keys[i]), keys, i + 1))
  const env = (el) => ({ scope: scopeOf(el), read: (keys, soft) => {
    const v = read(view, keys)
    if (v === undefined && !soft && !anyHas(view, keys, 0)) {
      const k = keys.join('.')
      if (!missing.has(k) && missing.size < 30) missing.set(k, new Set())
      const s = missing.get(k)
      if (s && s.size < 8) s.add(el)
    }
    return v
  } })
  const cache = new Map()
  const compiled = (kind, attr, src) => {
    const k = kind + '\u0000' + src
    if (cache.has(k)) return cache.get(k)
    let v = null
    try { v = kind === 'e' ? X.parse(src) : kind === 's' ? X.parseStmts(src) : kind === 'p' ? X.parsePairs(src) : X.parseEach(src) } catch (e) { warn(attr + '="' + src + '"：' + (e && e.message)) }
    cache.set(k, v)
    return v
  }
  // soft：只拿来判断显不显示、加不加 class——没写这个字段多半是故意的（「没有昵称就不显示」），不算漏写
  const evalOn = (el, attr, ast, soft) => { try { return X.evaluate(ast, env(el), soft) } catch (e) { warn(attr + '：' + (e && e.message)); return undefined } }
  const absOn = (el, attr) => {
    const ast = compiled('e', attr, el.getAttribute(attr) || '')
    if (!ast) return null
    try {
      const r = X.absPath(ast, env(el))
      if (r && r.abs) return r.abs
      warn(attr + '="' + el.getAttribute(attr) + '"：要写数据里的一个字段')
    } catch (e) { warn(attr + '：' + (e && e.message)) }
    return null
  }
  const hidden = new WeakMap()
  const showIt = (el, on) => {
    if (on) {
      if (!hidden.has(el)) return
      const o = hidden.get(el)
      hidden.delete(el)
      if (o.v) el.style.setProperty('display', o.v, o.p)
      else el.style.removeProperty('display')
    } else if (!hidden.has(el)) {
      hidden.set(el, { v: el.style.getPropertyValue('display'), p: el.style.getPropertyPriority('display') })
      el.style.setProperty('display', 'none', 'important')
    }
  }
  const URL_ATTR = /^(href|src|action|formaction|xlink:href|data|poster)$/i
  // 按浏览器的规矩解析地址再看协议（「java⏎script:」这种中间夹换行的也认得出）；data: 只放图片
  const badUrl = (s) => {
    let p = ''
    try { p = new URL(s, location.href).protocol.toLowerCase() } catch { p = String(s).replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase().split(':')[0] + ':' }
    if (p === 'javascript:' || p === 'vbscript:') return true
    return p === 'data:' && !/^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i.test(String(s).replace(/[\u0000-\u0020\u007f]/g, ''))
  }
  // 这些元素上的属性不让数据改（自动跳转、换脚本 / 样式 / 嵌的页面、SVG 动画改链接）；http-equiv 哪都不让设
  const NO_ATTR_TAG = /^(META|BASE|SCRIPT|LINK|STYLE|IFRAME|FRAME|OBJECT|EMBED|TEMPLATE|ANIMATE|SET|ANIMATEMOTION|ANIMATETRANSFORM|HANDLER|FOREIGNOBJECT)$/i
  // 列表 → 上次画出来的每一条（按序号）：同一个列表数据变了只重新绑、不重建（正在打字的输入框不丢焦点）
  const kept = new WeakMap()
  const clearItems = (el) => { for (const c of [...el.children]) if (c.hasAttribute('data-mock-item')) c.remove(); kept.delete(el) }
  function renderLists() {
    const done = new Set()
    for (let guard = 0; guard < 400; guard++) {
      const el = [...D.querySelectorAll('[data-mock-each]')].find((x) => !done.has(x))
      if (!el) break
      done.add(el)
      const spec = compiled('each', 'data-mock-each', el.getAttribute('data-mock-each') || '')
      const tpl = [...el.children].find((c) => c.tagName === 'TEMPLATE')
      if (!spec) { clearItems(el); continue }
      if (!tpl) { clearItems(el); warn('data-mock-each="' + el.getAttribute('data-mock-each') + '"：里面要放一个 <template>'); continue }
      const outer = scopeOf(el)
      let r
      try { r = X.absPath(spec.list, env(el)) } catch (e) { clearItems(el); warn('data-mock-each：' + (e && e.message)); continue }
      const arr = r.abs ? env(el).read(r.abs) : X.dig(r.val, r.rest)
      if (!Array.isArray(arr)) { clearItems(el); continue }
      // 同一个数据列表、上次的节点都还在：按序号接着用；不然整个重画
      const src = r.abs ? r.abs.join('\u0001') + '\u0002' + spec.item + '\u0002' + (spec.index || '') : null
      const prev = kept.get(el)
      const reuse = !!(src && prev && prev.src === src && prev.rows.every((row) => row.every((n) => n.isConnected && n.parentNode === el)))
      if (!reuse) clearItems(el)
      const rows = reuse ? prev.rows : []
      const n = Math.min(arr.length, 500)
      for (let i = n; i < rows.length; i++) for (const x of rows[i]) x.remove()
      rows.length = Math.min(rows.length, n)
      const scopeAt = (i) => {
        const sc = Object.assign(Object.create(null), outer || {})
        sc[spec.item] = r.abs ? { abs: r.abs.concat(String(i)) } : { val: arr[i] }
        if (spec.index) sc[spec.index] = { val: i }
        return sc
      }
      let after = tpl
      for (const row of rows) if (row.length) after = row[row.length - 1]
      for (let i = 0; i < rows.length; i++) { const sc = scopeAt(i); for (const x of rows[i]) scopes.set(x, sc) }
      for (let i = rows.length; i < n; i++) {
        const frag = tpl.content.cloneNode(true)
        const sc = scopeAt(i)
        const nodes = [...frag.childNodes].filter((x) => x.nodeType === 1)
        for (const x of nodes) { x.setAttribute('data-mock-item', ''); scopes.set(x, sc) }
        rows.push(nodes)
        if (!nodes.length) continue
        after.after(...nodes)
        after = nodes[nodes.length - 1]
      }
      if (src) kept.set(el, { src, rows })
    }
  }
  const KINDS = [['data-mock-set', 's'], ['data-mock-text', 'e'], ['data-mock-show', 'e'], ['data-mock-model', 'e'], ['data-mock-class', 'p'], ['data-mock-attr', 'p'], ['data-mock-each', 'each']]
  // 模板里套模板（订单 → 商品）也一层层看：<template> 的内容不在页面里，querySelectorAll 找不到里面那层
  const precheck = (root, depth = 0) => {
    for (const [a, k] of KINDS) for (const el of root.querySelectorAll('[' + a + ']')) compiled(k, a, el.getAttribute(a) || '')
    if (depth < 6) for (const tp of root.querySelectorAll('template')) { try { precheck(tp.content, depth + 1) } catch { /* 读不了 */ } }
  }
  function render() {
    if (!D.body) return
    missing.clear()
    renderLists()
    // 点了才执行的那几句、还没画出来的列表模板里的绑定，先看一遍写得对不对（写错了现在就报，体检看得到，不用等人点、等列表有东西）
    precheck(D)
    // 先定显示哪些（藏起来的那块里读不到字段不报），再填字
    for (const el of D.querySelectorAll('[data-mock-show]')) {
      const ast = compiled('e', 'data-mock-show', el.getAttribute('data-mock-show') || '')
      if (ast) showIt(el, !!evalOn(el, 'data-mock-show', ast, true))
    }
    for (const el of D.querySelectorAll('[data-mock-text]')) {
      const ast = compiled('e', 'data-mock-text', el.getAttribute('data-mock-text') || '')
      if (!ast) continue
      const v = evalOn(el, 'data-mock-text', ast)
      const s = v == null || typeof v === 'object' ? '' : String(v)
      if (el.textContent !== s) el.textContent = s
    }
    for (const el of D.querySelectorAll('[data-mock-class]')) {
      const pairs = compiled('p', 'data-mock-class', el.getAttribute('data-mock-class') || '')
      for (const x of pairs || []) { const on = !!evalOn(el, 'data-mock-class', x.e, true); for (const c of x.name.split(/\s+/)) el.classList.toggle(c, on) }
    }
    for (const el of D.querySelectorAll('[data-mock-attr]')) {
      const pairs = compiled('p', 'data-mock-attr', el.getAttribute('data-mock-attr') || '')
      for (const x of pairs || []) {
        const name = x.name.toLowerCase()
        if (/^on/.test(name) || name === 'srcdoc' || name === 'style' || name === 'http-equiv' || name.startsWith('data-mock') || NO_ATTR_TAG.test(el.tagName)) { warn('data-mock-attr 不能设 ' + (NO_ATTR_TAG.test(el.tagName) ? '<' + el.tagName.toLowerCase() + '> 的属性' : name)); continue }
        const v = evalOn(el, 'data-mock-attr', x.e)
        if (v == null || v === false) { el.removeAttribute(name); continue }
        let s = v === true ? '' : String(v)
        if (A && A.r && A.f && URL_ATTR.test(name) && typeof v === 'string' && Object.prototype.hasOwnProperty.call(A.r, v) && Object.prototype.hasOwnProperty.call(A.f, A.r[v])) s = String(A.f[A.r[v]])
        if (URL_ATTR.test(name) && badUrl(s)) { warn('data-mock-attr：' + name + ' 不能是脚本地址'); continue }
        try { if (el.getAttribute(name) !== s) el.setAttribute(name, s) } catch { warn('data-mock-attr：属性名「' + name + '」不对') }
      }
    }
    for (const el of D.querySelectorAll('[data-mock-model]')) {
      const keys = absOn(el, 'data-mock-model')
      if (!keys) continue
      const v = env(el).read(keys, true) // 输入框绑的字段还没写进数据：空着就对，不算漏写
      try {
        if (el.type === 'checkbox') el.checked = !!v
        else if (el.type === 'radio') el.checked = v != null && String(v) === el.value
        else if (el.type === 'file') { /* 选文件的框不能由页面填（浏览器不让）；选了什么文件名记在数据里，要显示另用 data-mock-text */ }
        else if (D.activeElement !== el) { const s = v == null ? '' : String(v); if (el.value !== s) el.value = s }
      } catch (e) { warn('data-mock-model：' + (e && e.message)) }
    }
    followState()
  }
  // 体检来取的时候再按「看不看得见」筛：藏在没显示的那块里（data-mock-show 外层、按状态用 CSS 藏起来的）不算漏写。
  // 取的时候样式、状态都已生效，比画的那一刻准
  const seenNow = (el) => {
    try {
      if (!el.isConnected || !el.getClientRects().length) return false
      // 弹窗、抽屉常用 visibility:hidden / opacity:0 藏着（没打开）：也算看不见
      if (typeof el.checkVisibility === 'function') return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })
      if (getComputedStyle(el).visibility === 'hidden') return false
      for (let a = el; a && a.nodeType === 1; a = a.parentElement) if (getComputedStyle(a).opacity === '0') return false
      return true
    } catch { return true }
  }
  try { Object.defineProperty(W, '__dshMockMissing', { configurable: true, get: () => [...missing].filter(([, els]) => [...els].some(seenNow)).map(([k]) => k) }) } catch { /* 占了 */ }

  // ── 这页的状态跟着数据走：<meta name="dsh-states" content="a:…, b:…" data-mock="user.stage"> ──
  let follow = null // { keys, names }
  const declared = (m) => {
    const out = []
    for (const part of String((m && m.getAttribute('content')) || '').split(/[,，;；\n]+/)) {
      const x = /^\s*([A-Za-z0-9_-]{1,32})/.exec(part)
      if (x && !out.includes(x[1])) out.push(x[1])
      if (out.length >= 8) break
    }
    return out.length >= 2 ? out : []
  }
  function setupFollow() {
    const m = D.querySelector('meta[name="dsh-states"][data-mock]')
    if (!m) return
    const names = declared(m)
    let keys = null
    try { keys = X.keysOf(m.getAttribute('data-mock') || '') } catch (e) { warn('dsh-states 的 data-mock：' + (e && e.message)) }
    if (!keys || !names.length) return
    follow = { keys, names }
    // 外面指定了状态（预览地址 ?state=x、演示包 / 远程看放这屏时给的）：这一屏临时当成 x
    let want = typeof W.__dshState === 'string' ? W.__dshState : ''
    if (!want) { try { want = new URLSearchParams(location.search).get('state') || '' } catch { want = '' } }
    if (!want || !names.includes(want)) return
    const cur = read(data, keys)
    const v = typeof cur === 'boolean' && (want === 'true' || want === 'false') ? want === 'true'
      : typeof cur === 'number' && want !== '' && !isNaN(Number(want)) ? Number(want) : want
    overlay.set(keys.join('.'), { keys, v })
    rebuild()
  }
  function followState() {
    if (!follow) return
    const v = read(view, follow.keys)
    // 数据里的值不是这页写了的状态（没写、拼错了）：回默认那个，不留着上一个
    const s = follow.names.includes(v == null ? '' : String(v)) ? String(v) : follow.names[0]
    if (de.getAttribute('data-state') !== s) de.setAttribute('data-state', s)
  }

  // ── 点、填 ──
  // 选取、改字、调样式、画笔这些工具开着时（picker 说了算），点页面是在选东西，不改数据
  const busy = () => { try { return !!(W.__ddpBusy && W.__ddpBusy()) } catch { return false } }
  const onInput = (e) => {
    const el = e.target
    if (!el || !el.hasAttribute || !el.hasAttribute('data-mock-model') || busy()) return
    const keys = absOn(el, 'data-mock-model')
    if (!keys) return
    let v
    if (el.type === 'checkbox') v = el.checked
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value }
    else if (el.type === 'number' || el.type === 'range') v = el.value === '' ? null : Number(el.value)
    else if (el.type === 'file') v = el.files && el.files.length ? [...el.files].map((f) => f.name).join(', ') : null
    else v = el.value
    write(keys, v)
  }
  D.addEventListener('input', onInput, true)
  D.addEventListener('change', onInput, true)
  // 放在 window 上、比跳屏的监听先装：点了又改数据又跳屏的（「接受邀约」→ 首页），先存好再跳
  W.addEventListener('click', (e) => {
    if (e.button !== 0 || busy()) return
    const t = e.target && e.target.closest ? e.target.closest('[data-mock-set], [data-mock-reset]') : null
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return
    // 明写了的提交按钮（type="submit"）：看得见的必填没填、格式不对（浏览器会拦下提交）就不改数据，不然「已提交」先亮了。
    // 没写 type 的 <button>（分步表单的「下一步」、切换、「获取验证码」）、藏着的那几步里的必填都不管
    try {
      const f = t.form
      const typ = String(t.getAttribute('type') || '').toLowerCase()
      if (f && (typ === 'submit' || typ === 'image') && !f.noValidate && !t.formNoValidate) {
        const seen = (x) => (typeof x.checkVisibility === 'function' ? x.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }) : x.getClientRects().length > 0)
        if ([...f.elements].some((x) => x.willValidate && x.validity && !x.validity.valid && seen(x))) return
      }
    } catch { /* 不是表单 */ }
    if (t.hasAttribute('data-mock-reset')) { reset(); return }
    const st = compiled('s', 'data-mock-set', t.getAttribute('data-mock-set') || '')
    if (!st) return
    for (const s of st) {
      try {
        const en = env(t)
        const v = X.evaluate(s.rhs, en)
        const r = X.absPath(s.lhs, en)
        if (r && r.abs) write(r.abs, v)
        else warn('data-mock-set：「' + t.getAttribute('data-mock-set') + '」要改数据里的一个字段')
      } catch (err) { warn('data-mock-set：' + (err && err.message)) }
    }
  }, true)

  const api = {
    get: (p) => { try { return copy(read(view, X.keysOf(p))) } catch (e) { warn('mock.get：' + (e && e.message)); return undefined } },
    set: (p, v) => { write(X.keysOf(p), v) },
    push: (p, item) => { const k = X.keysOf(p); const a = read(data, k); write(k, (Array.isArray(a) ? a : []).concat([item === undefined ? null : item])) },
    remove: (p, i) => {
      const k = X.keysOf(p)
      const a = read(data, k)
      if (!Array.isArray(a)) return
      const idx = typeof i === 'function' ? a.findIndex(i) : Number(i)
      if (idx >= 0 && idx < a.length) write(k, a.filter((_, j) => j !== idx))
    },
    reset,
    on: (fn) => { if (typeof fn === 'function') subs.add(fn); return () => subs.delete(fn) },
    render: () => { if (ready) render() },
    get data() { return copy(view) },
    get initial() { return fresh() },
    get error() { return C.err || '' },
    get fp() { return C.v || '' },
  }
  W.__dshMock = api
  try { W.mock = api } catch { /* 页面占了这个名字 */ }

  const start = () => {
    if (ready) return
    ready = true
    setupFollow()
    render()
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

/**
 * 「数据」面板背后的小页（/__dsh_design__/mock.html，在预览地址上、看不见）：和各屏读写同一份数据，
 * 有变化告诉右侧栏；右侧栏让它改一项、重置。只和服务端给的那几个外层源说话（和 picker 一个规矩）
 */
export function mockBridge(parents) {
  const allowed = (Array.isArray(parents) ? parents : []).filter((o) => typeof o === 'string' && o && o !== '*' && o !== 'null')
  const anc = location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[0] : ''
  const fits = (o) => o === anc || (o.endsWith(':*') && anc.startsWith(o.slice(0, -1)) && /^\d+$/.test(anc.slice(o.length - 1)))
  const origins = window.parent === window ? [] : anc ? (allowed.some(fits) ? [anc] : []) : allowed.filter((o) => !o.endsWith(':*'))
  const M = window.__dshMock
  if (!origins.length || !M) return
  const post = (m) => { for (const o of origins) { try { window.parent.postMessage({ ddpMock: 1, ...m }, o) } catch { /* 外层不在了 */ } } }
  const snap = () => post({ type: 'data', data: M.data, initial: M.initial, err: M.error, fp: M.fp })
  snap.__dshKeep = true // 页面回调一直改数据被停下时，面板照样收到
  M.on(snap)
  addEventListener('message', (e) => {
    const d = e.data
    if (e.source !== window.parent || !d || d.ddpMock !== 1 || !(origins.includes(e.origin) || (!anc && allowed.includes(e.origin)))) return
    try {
      if (d.type === 'get') snap()
      else if (d.type === 'set' && Array.isArray(d.keys) && d.keys.length && d.keys.length <= 30) M.set(d.keys.map(String), d.value)
      else if (d.type === 'reset') M.reset()
    } catch (err) { post({ type: 'fail', msg: String((err && err.message) || err).slice(0, 200) }) }
  })
  snap()
}

/**
 * 「存成初始数据」：把右侧栏里现在的数据写回 mock.json（只改已经有 mock.json 的设计；给 tracker.editDir 用）。
 * fp：面板那份数据是照哪版 mock.json 来的——文件在这之后又被改过（模型刚写、别的窗口刚存）就不盖，免得把新的冲掉
 */
export function saveMock(root, data, fp) {
  const file = path.join(root, MOCK_FILE)
  let st = null
  try { st = fs.lstatSync(file) } catch { /* 没有 */ }
  if (!st) return { ok: false, reason: 'no-mock' }
  if (!st.isFile()) return { ok: false, reason: 'link' } // 软链接（可能指到目录外）不写
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'bad' }
  const text = JSON.stringify(data, null, 2) + '\n'
  if (Buffer.byteLength(text) > MOCK_MAX) return { ok: false, reason: 'big' }
  if (st.size > MOCK_MAX) return { ok: false, reason: 'bad-file' }
  const old = fs.readFileSync(file, 'utf8')
  const cur = parseMock(old)
  // 原文件读不出来（多了个逗号之类）：面板里那份是从 {} 开始的，盖上去会把原来的内容冲掉
  if (cur.err) return { ok: false, reason: 'bad-file' }
  if (old === text) return { ok: true, files: [] } // 已经是这份（刚存过、面板还没换成新指纹）
  if (fp && String(fp) !== cur.fp) return { ok: false, reason: 'changed' }
  // 先写到旁边再换过去：写一半断了不会留下半个文件
  const tmp = path.join(root, `.${MOCK_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`)
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* 没留下 */ }
    throw e
  }
  return { ok: true, files: [MOCK_FILE] }
}

const jsonTag = (v) => JSON.stringify(v === undefined ? null : v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** mock.json 的文字 → { data, fp, err }（坏了也给一份：页面照样有 mock，体检报问题） */
export function parseMock(text) {
  const raw = String(text == null ? '' : text).replace(/^﻿/, '')
  const fp = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)
  let data = {}
  let err = ''
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) data = v
    else err = 'mock.json 要是一个对象（{ … }），现在不是'
  } catch (e) {
    err = 'mock.json 不是合法的 JSON：' + String(e && e.message).slice(0, 160)
  }
  return { data, fp, err }
}

const bigMock = (n) => ({ data: {}, fp: 'big' + n, err: `mock.json 太大（超过 ${MOCK_MAX / 1024 / 1024} MB），没读` })
/** 打包时读到的 mock.json（没有给 null；太大：big 为 true 或超过上限，和预览一样给一份带「太大」错误的） */
export function mockOfBuf(buf, big = false) {
  if (buf && buf.length <= MOCK_MAX) return parseMock(buf.toString('utf8'))
  if (buf || big) return bigMock(buf ? buf.length : '')
  return null
}

const seen = new Map() // 文件 → { stamp, m }
/** 设计目录里的 mock.json（没有给 null；太大当坏了） */
export function mockOf(dir) {
  if (!dir) return null
  const file = path.join(dir, MOCK_FILE)
  let st
  // 软链接当没有（和 tweaks.json 一样：目录外的内容不进页面、不进报错）
  try { st = fs.lstatSync(file) } catch { seen.delete(file); return null }
  if (!st.isFile()) return null
  const stamp = st.mtimeMs + ':' + st.size
  const had = seen.get(file)
  if (had && had.stamp === stamp) return had.m
  let m
  if (st.size > MOCK_MAX) m = bigMock(st.size)
  else { try { m = parseMock(fs.readFileSync(file, 'utf8')) } catch { return null } }
  if (seen.size > 50) seen.clear()
  seen.set(file, { stamp, m })
  return m
}

/** 页面里放的那段（<script>…</script>）；scope：存数据的键前缀（同一个源上放着几套设计时分开） */
export function mockScript(m, { scope = '' } = {}) {
  if (!m) return ''
  const cfg = { v: m.fp, scope: String(scope || m.scope || '').slice(0, 80), err: m.err || '' }
  return `<script>(${mockRuntime})(${mockExpr},${jsonTag(cfg)},${jsonTag(m.data)},${jsonTag(m.assets || null)})</script>`
}
