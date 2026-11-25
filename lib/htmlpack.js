/**
 * 导出「整套 HTML 演示」（#26）：所有屏打成一个 .html，发给别人双击就能在浏览器里看、点得动、带外壳。
 * 不联网、不用 AI，几秒出来。
 *
 * 每屏用 bundle.js 打成一整份（样式、脚本、图片、图标雪碧图都内联，和远程看同一套），塞进播放器页面；
 * 播放器只把正在看的那屏放进沙盒 iframe 的 srcdoc。几屏共用的大图（AI 示意图、字体）只存一份。
 * 屏里的跳转（<a href="detail.html">、data-href、onclick="location.href=…"、脚本跳转）由每屏带的小脚本
 * 告诉播放器换屏，和设计台里「试用」一样；站外链接开新标签页。
 *
 * 外壳的尺寸（FRAME / CAP / LIGHTS / WINBTN）和认跳转的写法（LINK_SEL / LINK_JS）和 client.js、picker.js 是同一份数，
 * 测试里逐项比着，改一边另一边会报。
 */

import crypto from 'node:crypto'
import { bundle, dataAssets, strictMeta } from './bundle.js'
import { defang } from './serve.js'
import { followsMock, statesOfHtml } from './states.js'
import { MOCK_FILE, mockExpr, mockOfBuf, mockRuntime } from './mock.js'

/** 每屏的 <base>：一个不存在的地址（.invalid 不会被解析），屏里的相对链接都落在它下面，小脚本据此认出「站内跳转」 */
import { expandFormal, compError } from './comp-io.js'

export const PACK_ORIGIN = 'https://ddp-pack.invalid'
export const PACK_MAX = 150 * 1024 * 1024 // 整个文件的上限（字符数）：再大浏览器打开就很慢了
export const PACK_SCREENS = 1000 // 画布只显示 60 屏，导出要全部（#29：有人的设计 400 多屏）；真正拦的是 PACK_MAX
// 一屏内联的上限：字体库两款中文就有 6 MB 多（#31），再加一张大图远程看的 12 MB 不够；整个文件还有 PACK_MAX 兜着
const SCREEN_MAX = 48 * 1024 * 1024
const ASSET_MIN = 2048 // 这么长以上的 data: 地址单独存一份（几屏共用的只存一次）

// ── 和 client.js 同一份数（测试比着）────────────────────────────────────────
export const FRAME = {
  web: { pad: 0, top: 34, r: 10, ir: 0 },
  app: { pad: 11, top: 0, r: 55, ir: 44, island: 11 },
  miniprogram: { pad: 11, top: 0, r: 55, ir: 44, island: 11, capsule: 1 },
  tablet: { pad: 14, top: 0, r: 34, ir: 21 },
  desktop: { pad: 0, top: 0, r: 12, ir: 12, win: 1 },
  poster: { pad: 0, top: 0, r: 6, ir: 6 },
  slides: { pad: 0, top: 0, r: 8, ir: 8 },
  email: { pad: 0, top: 0, r: 10, ir: 10 },
  diagram: { pad: 0, top: 0, r: 8, ir: 8 },
  dshplugin: { pad: 0, top: 0, r: 10, ir: 10 },
  framed: { pad: 0, top: 0, r: 10, ir: 10 },
}
export const CAP = { top: 48, right: 7, w: 87, h: 32 }
export const LIGHTS = { x: 20, y: 20, d: 12, gap: 8 }
export const WINBTN = { w: 46, h: 32 }
/** 有外壳可开关的类型（手机、平板、桌面软件、网页浏览器框） */
export const FRAMED = { app: 1, miniprogram: 1, tablet: 1, desktop: 1, web: 1 }
/** 画幅定死的类型：放映时可以放大铺满（幻灯片、海报） */
export const FIXED = { poster: 1, slides: 1, diagram: 1, dshplugin: 1, framed: 1 }

// ── 和 picker.js 同一份（测试比着）：哪些元素点了会跳页 ─────────────────────────
export const LINK_SEL = 'a[href], [data-href], [data-to], [onclick]'
export const LINK_JS = /(?:location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*)['"]([^'"]+)['"]/

/** 某个大小的外框：矮的手机没有灵动岛（和 client.js 的 frameOf 一样） */
export function frameOf(kind, w, h) {
  const f = FRAME[kind] || FRAME.web
  return f.island && w && h / w < 1.9 ? { ...f, island: 0 } : f
}

/** JSON 放进 <script type="application/json">：< 和两个行分隔符转义，</script> 断不了它 */
const jsonTag = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 每屏最前面：沙盒里的页面（不透明的源）一碰 localStorage / sessionStorage 就报错，
 * 换成存在内存里的一份；存的东西告诉播放器，换到别的屏时带过去（登录页存的名字，下一屏读得到）。
 * 初始内容由播放器在放进 iframe 前替换 STORE 那个记号
 */
function storeShim(D) {
  const send = (area, op, k, v) => { try { parent.postMessage({ ddpPack: 1, type: 'store', area, op, k, v }, '*') } catch { /* 没有外层 */ } }
  const make = (area) => {
    const m = new Map(Object.entries((D && D[area]) || {}))
    const api = {
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); send(area, 'set', String(k), String(v)) },
      removeItem: (k) => { m.delete(String(k)); send(area, 'del', String(k)) },
      clear: () => { m.clear(); send(area, 'clear') },
      key: (i) => [...m.keys()][i] ?? null,
    }
    // localStorage.theme = 'dark'、localStorage.theme 这种写法也认
    return new Proxy(api, {
      get: (o, p) => (p === 'length' ? m.size : typeof p === 'symbol' || Object.hasOwn(o, p) ? o[p] : m.has(p) ? m.get(p) : undefined),
      set: (o, p, v) => { if (typeof p === 'string') api.setItem(p, v); return true },
      deleteProperty: (o, p) => { if (typeof p === 'string') api.removeItem(p); return true },
      has: (o, p) => Object.hasOwn(o, p) || m.has(p),
      ownKeys: () => [...m.keys()],
      getOwnPropertyDescriptor: (o, p) => (m.has(p) ? { value: m.get(p), enumerable: true, configurable: true, writable: true } : undefined),
    })
  }
  for (const [name, area] of [['localStorage', 'l'], ['sessionStorage', 's']]) {
    let broken = false
    try { void window[name].length } catch { broken = true }
    if (broken) { try { Object.defineProperty(window, name, { value: make(area), configurable: true }) } catch { /* 改不了就算了 */ } }
  }
  // 模拟数据（#30）：自己做的屏（和播放器同源、有真的 localStorage）和别人做的屏（沙盒、只有替身）存的地方不一样，
  // 换屏会读不到上一屏改的。演示里的模拟数据一律存播放器手上这一份
  try { Object.defineProperty(window, '__ddpMockStore', { value: make('m'), configurable: true }) } catch { /* 改不了就算了 */ }
}

/**
 * 每屏最前面（页面脚本跑之前就装好）：点了跳到别的屏 → 告诉播放器换屏；页内锚点自己滚；站外链接开新标签页。
 * 和 picker.js 里「试用 / 远程看」的拦法一样（LINK_SEL、LINK_JS 同一份）；再加上调节滑块的值、不画滚动条
 */
function navScript(C, ST) {
  const SEL = C.sel
  const JS = new RegExp(C.js)
  const post = (m) => { try { parent.postMessage({ ddpPack: 1, ...m }, '*') } catch { /* 没有外层 */ } }
  const here = () => new URL(document.baseURI)
  const style = (css) => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s) }
  style('*{scrollbar-width:none}*::-webkit-scrollbar{display:none}')

  // 调节滑块调过、还没存进文件的值（和 picker 的 applyTweak 一样写在 <html> 上）
  const de = document.documentElement
  for (const [k, v] of Object.entries((C.tweak && C.tweak.vars) || {})) { try { de.style.setProperty(k, String(v), 'important') } catch { /* 不认的值 */ } }
  for (const [k, v] of Object.entries((C.tweak && C.tweak.attrs) || {})) { try { if (v == null || v === false) de.removeAttribute(k); else de.setAttribute(k, String(v)) } catch { /* 不认的名字 */ } }
  const fonts = (C.tweak && C.tweak.fonts) || []
  if (fonts.length) style(fonts.map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}") format("woff2");font-weight:${f.w};font-display:swap}`).join(''))
  // 一页多状态（#30）：播放器放这一屏时给的状态（order.html?state=paid）写在 <html data-state> 上
  const STATE_RE = /^[A-Za-z0-9_-]{1,32}$/
  /** 这页 <meta name="dsh-states"> 里写了哪几个状态（不到两个当没写） */
  const declared = () => {
    const m = document.querySelector('meta[name=dsh-states]')
    const out = []
    for (const part of String((m && m.getAttribute('content')) || '').split(/[,，;；\n]+/)) {
      const x = /^\s*([A-Za-z0-9_-]{1,32})/.exec(part)
      if (x && !out.includes(x[1])) out.push(x[1])
    }
    return out.length >= 2 ? out : []
  }
  // 播放器只在这屏写了这个状态时才给（老页面自己拿 ?state= 当参数的给 ''，完全不碰 data-state）
  if (typeof ST === 'string' && STATE_RE.test(ST)) { de.setAttribute('data-state', ST); window.__dshState = ST } // 模拟数据认它：状态跟着数据走的页，这一屏临时当成这个状态
  const stateOf = (u) => { const v = u.searchParams.get('state') || ''; return STATE_RE.test(v) ? v : '' }

  /** 这个地址是不是跳到演示包里的别的屏：{ path, hash }；同一页（只有锚点）给 { same, hash }；站外给 { out } */
  const where = (raw) => {
    raw = String(raw || '').trim()
    if (!raw || /^(javascript|mailto|tel|sms|data|blob):/i.test(raw)) return null
    let u
    try { u = new URL(raw, document.baseURI) } catch { return null }
    if (u.origin !== C.origin) return /^https?:$/.test(u.protocol) ? { out: u.href } : null
    let state = stateOf(u)
    let p = u.pathname
    try { p = decodeURIComponent(p) } catch { /* 原样 */ }
    // href="#"（「全部」）的 u.hash 是空串：记成 '#'，和「同一页、没锚点」（导航栏里指着本页）分开。同一页换个状态（?state=paid）算跳
    // 在别的状态里（地址带了状态进来的）点指着本页、不带状态也不带锚点的链接（href="order.html"）= 回默认状态，也算跳
    // 同一页换个这页没写的状态（老页面自己拿 ?state= 当参数）：和以前一样当本页链接
    const cur = de.getAttribute('data-state') || ''
    const raw0 = state
    if (u.pathname === here().pathname && state && !declared().includes(state)) state = ''
    // 回默认状态只认什么参数都不带的（?page=2 是页面自己的参数）；已经在默认状态（播放器给的 ST 是空的）就不用回
    // 状态跟着模拟数据走的屏：播放器点名过状态（哪怕是第一个），不带状态的本页链接 = 去掉点名、回到跟着数据
    const follow = !!document.querySelector('meta[name="dsh-states"][data-mock]')
    const named = typeof ST === 'string' && ST && declared().includes(ST) && (follow || (ST === cur && ST !== declared()[0]))
    if (u.pathname === here().pathname && (state ? state === cur : raw0 || u.search || u.hash || /#$/.test(u.href) || !named)) return { same: true, hash: u.hash || (/#$/.test(u.href) ? '#' : '') }
    return { path: p, hash: u.hash, state }
  }
  const rawOf = (el) => {
    let raw = el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-to') || ''
    if (!raw && el.hasAttribute('onclick')) { const m = JS.exec(el.getAttribute('onclick') || ''); if (m) raw = m[1] }
    return raw
  }
  // 页内锚点：照常改这一页的 #（页面里按 # 换内容的写法照样能用）；<base> 指着别处，不能让链接自己跳。
  // 换掉当前这条浏览器历史、不多记（#30）：演示包的历史只记换屏、换状态，「返回」一下就回上一屏（不然第一下只是清掉锚点）
  const setHash = (hash) => {
    try { location.replace(location.href.replace(/#.*$/, '') + (hash || '#')); return } catch { /* 换不了：照常改 # */ }
    location.hash = hash
  }
  const jumpTo = (hash) => {
    hash = String(hash || '')
    if (hash && hash !== '#' && location.hash !== hash) { setHash(hash); return }
    // 点过「待配送」#tab2 再点「全部」href="#"：清掉旧的 #（按 hashchange 换内容的页面回到默认），浏览器自己滚回顶上
    if (hash === '#' && location.hash) { setHash(''); return }
    let id = hash.replace(/^#/, '')
    try { id = decodeURIComponent(id) } catch { /* 原样 */ }
    const t = id ? document.getElementById(id) || document.getElementsByName(id)[0] : null
    if (t) t.scrollIntoView({ block: 'start' })
    else if (!id || id === 'top') scrollTo({ top: 0 })
  }
  const go = (w, e) => {
    if (!w) return false
    if (w.out) {
      const a = e && e.target && e.target.closest ? e.target.closest('a[href]') : null
      if (a && a.target && a.target !== '_self') return false // 本来就开新窗口：随它（沙盒放行了弹窗）
      window.open(w.out, '_blank', 'noopener')
      return true
    }
    if (w.same) { jumpTo(w.hash); return true }
    post({ type: 'nav', path: w.path, hash: w.hash, state: w.state || '' })
    return true
  }

  // 返回（data-back）：按看的人走过的路退一步，没得退（直接打开的这屏）才去它写的地方。点的那一下就拦（不等页面自己跳）
  addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const el = e.target && e.target.closest ? e.target.closest('[data-back]') : null
    if (!el) return
    const w = where(rawOf(el))
    e.preventDefault()
    e.stopImmediatePropagation() // 同在 window 上的跳屏监听（别人做的屏、旧浏览器那条路）别再换一次
    post({ type: 'nav', back: true, path: w && w.path ? w.path : '', hash: (w && w.hash) || '', state: (w && w.state) || '' })
  }, true)

  // 跳到别的屏、站外。自己做的屏（收得到 navigate）：<a href> 让浏览器照常跳，下面的 navigate 按最终地址接住——
  // 页面自己的点击处理先跑完（「去结算」先存购物车、点的时候才改 href），拦了默认行为就不跳，和真浏览器一样；
  // 地址只写在 onclick 里的（onclick="if (!同意) {…; return} location.href='x'"），页面真跳了 navigate 也接住；
  // data-href / data-to 没有原生跳转：事件派发完（页面 stopPropagation 了也算）按那时的地址补一次。
  // 收不到 navigate 的（别人做的屏不同源、很旧的浏览器）：照设计台「试用」，点的那一下就拦（页面自己的点击处理就不跑了）
  // 有 navigation 对象不等于发 navigate（文档源不透明时按规范不发，currentEntry 是 null）：那种照老办法
  const hasNav = !!(window.navigation && navigation.currentEntry && typeof navigation.addEventListener === 'function')
  const early = !!C.strict || !hasNav
  let pending = null
  addEventListener('click', (e) => {
    pending = null
    // 冒泡那个排到页面在 window 上的点击监听后面（这一次点击里）：页面「确定要离开吗」拦了，我们就不开外网
    removeEventListener('click', after); addEventListener('click', after)
    if (e.button !== 0) return
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null
    if (!el) return
    const a = el.closest('a[href], area[href]')
    // 新窗口打开（target="_blank"、按着 ⌘ / Ctrl / Shift 点）指着包里别的屏：新窗口里开不了，还是在这儿换屏
    const newWin = a && ((a.target && a.target !== '_self') || e.metaKey || e.ctrlKey || e.shiftKey)
    if (!early && !newWin) {
      if (a || (!el.getAttribute('data-href') && !el.getAttribute('data-to'))) return
      // 只补「事件传到了 el」的：卡片（data-href）里的「收藏」按钮自己 stopPropagation，就是不想连带打开卡片
      const mine = { el, e, reached: false }
      const mark = () => { mine.reached = true }
      el.addEventListener('click', mark, { once: true })
      pending = mine
      setTimeout(() => {
        el.removeEventListener('click', mark)
        if (pending === mine) { pending = null; if (mine.reached) finish(mine) }
      }, 0)
      return
    }
    const w = where(rawOf(el))
    if (!w || w.same) return // 本页锚点（href="#"、"#tab2"）：页面自己的点击处理照跑，见下面
    if (w.out && (!a || newWin)) return // 外网：新窗口的随它开（沙盒放行了弹窗）；data-href / onclick 指着外网的交给 navigate
    if (go(w, e)) { e.preventDefault(); e.stopPropagation() }
  }, true)
  const finish = ({ el, e }) => {
    if (e.defaultPrevented) return
    const w = where(el.getAttribute('data-href') || el.getAttribute('data-to') || '')
    if (!w || w.out) return // 外网：页面自己跳了由 navigate 接住
    if (w.same) { if (w.hash && w.hash !== '#') jumpTo(w.hash); return } // data-href="#" 占位：不动
    go(w, e)
  }
  // 页面自己处理完、没拦默认行为（每次点击都排到 window 上最后一个）：
  //   本页锚点（收不到 navigate 时）替它滚过去（<base> 指着别处，链接自己跳就离开这一屏了）；收得到 navigate 的让浏览器照常跳，
  //   由 navigate 按最终地址接住（href="#" 占位、点的时候页面才改成别的屏）；
  //   本页锚点要开新窗口的（页脚 <a href="#" target="_blank">、按着 ⌘ 点 #tab2）：新窗口里是假地址，留在这儿滚
  //   外网链接（没写 target）在点击里就开新标签页：放到 navigate 回调里开，Safari 可能当成弹窗拦掉
  const after = (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    const a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null
    const w = a ? where(a.getAttribute('href')) : null
    if (!w) return
    const newWin = (a.target && a.target !== '_self') || e.metaKey || e.ctrlKey || e.shiftKey
    if (w.same && (early || newWin)) { e.preventDefault(); jumpTo(w.hash) }
    else if (w.out && !early && !newWin) { e.preventDefault(); window.open(w.out, '_blank', 'noopener') }
  }

  // 脚本里跳页（location.href = 'x.html'、表单提交）：有 Navigation API 的浏览器（Chrome、Edge、新的 Safari / Firefox）也拦下来
  if (hasNav) {
    navigation.addEventListener('navigate', (e) => {
      if (!e.cancelable || e.navigationType === 'traverse' || e.downloadRequest) return
      const dest = (e.destination && e.destination.url) || ''
      // 没写 action 的表单（搜索框按回车）交给这一页自己（about:srcdoc?…）：留在这一屏，不然这屏就没了
      if (!e.hashChange && /^about:srcdoc/i.test(dest) && (e.formData || /^about:srcdoc\?/i.test(dest))) { e.preventDefault(); return }
      const w = where(dest)
      if (!w) return
      e.preventDefault()
      pending = null // 点击里页面自己跳了：冒泡那边不再换一次
      if (w.out && e.formData) return // 往外网交表单：不交
      go(w)
    })
  }

  // 播放器让滚到某个锚点（从别的屏跳过来带着 #xx）
  addEventListener('message', (e) => {
    if (e.source !== parent) return
    const d = e.data
    if (d && d.ddpPack === 1 && d.type === 'jump') jumpTo(d.hash)
  })

  // ← → 换屏（点进页面以后键盘在页面里）：页面自己没用、也不是在输入框里才交给播放器。
  // PageUp / PageDown 在能滚的页面里是往下看：只有画幅定死的（幻灯片、海报…）才拿来换屏
  const KEYS = C.pages ? /^(ArrowLeft|ArrowRight|PageUp|PageDown)$/ : /^(ArrowLeft|ArrowRight)$/
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !KEYS.test(e.key)) return
    const t = e.target
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    post({ type: 'key', key: e.key })
  })
}

/**
 * 每屏最后（样式表都读进来了）：深浅色按导出那一刻右侧栏的样子定死，不跟看的人电脑的深浅色走。
 *   dark：右侧栏开着「深色」——和 picker 的 setDark 一样，<html> 上三种写法都打上，深色的媒体条件当成立
 *   media：没开「深色」，但右侧栏当时就是深色环境（页面跟着系统变深）——深色的媒体条件当成立
 *   light：浅色环境——浅色的当成立、深色的当不成立，对方电脑是深色也照浅色显示
 * 只改媒体条件里 prefers-color-scheme 那一项（「深色且窄屏」这种别的条件照旧），样式的先后不动
 */
function schemeScript(mode) {
  const de = document.documentElement
  if (mode === 'dark') {
    de.setAttribute('data-theme', 'dark')
    de.setAttribute('data-mode', 'dark')
    de.classList.add('dark')
  }
  const dark = mode !== 'light'
  const YES = '(min-width: 0px)'
  const NO = '(min-width: 99999px)'
  const fix = (ml) => {
    try {
      const t = ml && ml.mediaText
      if (t && /prefers-color-scheme/i.test(t)) ml.mediaText = t.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (m, v) => ((v.toLowerCase() === 'dark') === dark ? YES : NO))
    } catch { /* 改不了 */ }
  }
  const walk = (list) => {
    for (const r of list) {
      if (r.media) fix(r.media)
      if (r.cssRules) { try { walk(r.cssRules) } catch { /* 读不了 */ } }
    }
  }
  for (const sh of document.styleSheets) {
    fix(sh.media) // <style media="(prefers-color-scheme: dark)">
    try { walk(sh.cssRules) } catch { /* 读不了 */ }
  }
  // 表单控件、滚动区的底色：开着「深色」、浅色环境都定死；深色环境只在页面自己声明了支持深色时定
  let cs = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : ''
  // 页面自己声明的：CSS 的 color-scheme，没写（normal）再看 <meta name="color-scheme">
  let own = getComputedStyle(de).colorScheme || ''
  if (!own || own === 'normal') { const m = document.querySelector('meta[name="color-scheme" i]'); own = (m && m.getAttribute('content')) || '' }
  if (mode === 'media' && /dark/.test(own)) cs = 'dark'
  if (mode === 'light' && /dark/.test(own) && !/light/.test(own)) cs = '' // 页面只做了深色（color-scheme: dark）：控件照它的深色
  if (cs) {
    const s = document.createElement('style')
    s.textContent = `:root{color-scheme:${cs}}`
    ;(document.head || de).appendChild(s)
  }
}

/** 播放器（外面那层）：换屏、外壳、缩放、全屏；数据都在页面里的 JSON 里 */
function player() {
  const $ = (id) => document.getElementById(id)
  const C = JSON.parse($('ddp-cfg').textContent)
  const T = C.strings
  const N = C.screens.length
  const cache = new Map()
  const assetRe = new RegExp(C.token + '(\\d+)_', 'g')
  const assets = new Map()
  const asset = (i) => {
    if (!assets.has(i)) { const el = $('ddp-a-' + i); assets.set(i, el ? JSON.parse(el.textContent) : '') }
    return assets.get(i)
  }
  const store = { l: {}, s: {}, m: {} }
  const htmlOf = (i, state = '') => {
    if (!cache.has(i)) {
      cache.set(i, JSON.parse($('ddp-s-' + i).textContent).replace(assetRe, (m, n) => asset(Number(n))))
      if (cache.size > 8) cache.delete(cache.keys().next().value) // 屏多、图大：只留最近放过的几屏
    }
    // 存储的初始内容：每次放进去都是当时的（上一屏刚存的这一屏读得到）；状态（#30）也是放的时候才定
    let out = cache.get(i).replace(C.storeMark, () => JSON.stringify(store).replace(/</g, '\\u003c'))
    // 模拟数据（#30）：整套只存一份，放进 iframe 时才填进这屏
    const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    if (C.mockMark) out = out.split(C.mockMark).join(js(C.mock || {}))
    if (C.mockAMark) out = out.split(C.mockAMark).join(js(C.mockAssets || null))
    const ok = /^[A-Za-z0-9_-]{1,32}$/.test(state) && (C.screens[i].states || []).includes(state) // 这屏写了的状态才设
    return C.stateMark ? out.split(C.stateMark).join(JSON.stringify(ok ? state : '')) : out
  }
  let shell = !!C.shellDefault
  // 看的人开关过外壳就记着（每份演示自己记：别的演示点过不影响这份导出时定的默认）
  const SHELL_KEY = 'ddp-pack-shell-' + C.token // 每份演示自己记（直接双击打开的本地文件共用一份 localStorage）
  try { const v = localStorage.getItem(SHELL_KEY); if (C.framed && (v === '1' || v === '0')) shell = v === '1' } catch { /* 存不了 */ }
  let cur = -1
  let curState = ''
  let seq = 0
  let pendingHash = ''
  const trail = [] // 看的人在演示里走过的路（地址的 # 部分）：返回（data-back）按它退一步
  const stage = $('stage')
  const bar = $('bar')
  const sel = $('sel')
  const count = $('count')
  const toast = $('toast')

  C.screens.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}. ${s.label}`; sel.appendChild(o) })
  if (!C.framed) $('shell').hidden = true
  if (N < 2) { $('prev').hidden = true; $('next').hidden = true; sel.disabled = true }
  if (!document.fullscreenEnabled) $('full').hidden = true

  // 小屏幕看手机的设计（在手机上打开）：不套外壳、铺满，工具条收成顶上正中一个小按钮
  // （放在页面假状态栏那条上：那里没有能点的东西；底栏、右下角都是 App 自己的导航）
  const compact = () => (C.kind === 'app' || C.kind === 'miniprogram') && innerWidth <= 600
  // 网页不开外壳：铺满窗口（和设计台单看一样，宽度跟着窗口）
  const fills = () => compact() || (C.kind === 'web' && !shell)

  let toastTimer = 0
  const say = (msg) => { toast.textContent = msg; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true }, 2600) }

  const svg = (tag, attrs, kids = []) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
    for (const c of kids) el.appendChild(c)
    return el
  }
  const capsule = (f, white) => {
    const { w, h } = C.cap
    const el = svg('svg', { class: 'cap' + (white ? ' w' : ''), viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' }, [
      svg('rect', { class: 'pl', x: 0.25, y: 0.25, width: w - 0.5, height: h - 0.5, rx: h / 2 - 0.25 }),
      svg('circle', { cx: 20.5, cy: 16, r: 2.2 }), svg('circle', { cx: 28, cy: 16, r: 3.1 }), svg('circle', { cx: 35.5, cy: 16, r: 2.2 }),
      svg('path', { class: 'sp', d: 'M43.5 9v14' }),
      svg('circle', { class: 'rg', cx: 65, cy: 16, r: 7.5 }), svg('circle', { cx: 65, cy: 16, r: 2.6 }),
    ])
    el.style.top = (f.pad || 0) + C.cap.top + 'px'
    el.style.right = (f.pad || 0) + C.cap.right + 'px'
    return el
  }
  const winCtl = (white) => {
    if (C.os === 'win') {
      const { w: W, h: H } = C.winbtn
      const el = svg('svg', { class: 'win' + (white ? ' w' : ''), viewBox: `0 0 ${W * 3} ${H}`, 'aria-hidden': 'true' }, [
        svg('path', { class: 'x', d: `M${W / 2 - 5} ${H / 2 + 0.5}h10` }),
        svg('rect', { class: 'x', x: W * 1.5 - 4.5, y: H / 2 - 4.5, width: 9, height: 9, rx: 1 }),
        svg('path', { class: 'x', d: `M${W * 2.5 - 5} ${H / 2 - 5}l10 10M${W * 2.5 + 5} ${H / 2 - 5}l-10 10` }),
      ])
      Object.assign(el.style, { top: '0px', right: '0px', width: W * 3 + 'px', height: H + 'px' })
      return el
    }
    const { x, y, d, gap } = C.lights
    const el = svg('svg', { class: 'win', viewBox: `0 0 ${d * 3 + gap * 2} ${d}`, 'aria-hidden': 'true' },
      ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => svg('circle', { cx: d / 2 + i * (d + gap), cy: d / 2, r: d / 2 - 0.25, fill: c, stroke: 'rgba(0,0,0,.12)', 'stroke-width': 0.5 })))
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: d * 3 + gap * 2 + 'px', height: d + 'px' })
    return el
  }

  let dev = null
  let vp = null
  let box = null
  let deco = [] // 跟着这一屏变的外壳零件（胶囊、窗口按钮的深浅）
  /** 搭外框：开关外壳、手机上横竖转换时重搭（里面的 iframe 也重放）；换屏只换 iframe */
  function build() {
    const fill = fills()
    document.body.classList.toggle('compact', compact())
    const f = fill || (C.framed && !shell) ? { pad: 0, top: 0, r: 0, ir: 0 } : C.frame
    stage.textContent = ''
    box = document.createElement('div')
    box.className = 'fit' + (fill ? ' all' : '')
    dev = document.createElement('div')
    dev.className = `dev k-${C.kind}` + (fill ? ' fill' : '') + (C.framed && !shell && !fill ? ' bare' : '')
    if (!fill) Object.assign(dev.style, { width: C.w + f.pad * 2 + 'px', height: C.h + f.pad * 2 + f.top + 'px', borderRadius: f.r + 'px' })
    dev.dataset.pad = String(f.pad || 0)
    if (f.top) {
      const ch = document.createElement('div')
      ch.className = 'chrome'
      ch.style.height = f.top + 'px'
      ch.innerHTML = '<i></i><i></i><i></i><span></span>'
      dev.appendChild(ch)
    }
    vp = document.createElement('div')
    vp.className = 'vp' + (C.dark ? ' dk' : '')
    if (!fill) Object.assign(vp.style, { left: f.pad + 'px', top: f.pad + f.top + 'px', width: C.w + 'px', height: C.h + 'px', borderRadius: f.ir + 'px' })
    dev.appendChild(vp)
    if (f.island) { const is = document.createElement('div'); is.className = 'island'; is.style.top = (f.pad || 0) + f.island + 'px'; dev.appendChild(is) }
    dev._f = f
    deco = []
    box.appendChild(dev)
    stage.appendChild(box)
    fit()
    $('shell').setAttribute('aria-pressed', shell ? 'true' : 'false')
  }
  /** 外壳上跟着这一屏的：浏览器栏里的标题、胶囊 / 窗口按钮（顶栏深色时画白的） */
  function decorate() {
    const s = C.screens[cur]
    const f = dev._f
    const sp = dev.querySelector('.chrome span')
    if (sp) sp.textContent = s.label
    for (const d of deco) d.remove()
    deco = []
    if (f.capsule) deco.push(capsule(f, !!s.top))
    if (f.win) deco.push(winCtl(!!s.top))
    for (const d of deco) dev.appendChild(d)
  }
  /** 按窗口大小缩放：手机、网页、平板最大到原大；画幅定死的（幻灯片、海报）可以放大铺满 */
  function fit() {
    if (!dev || dev.classList.contains('fill')) return
    const W = dev.offsetWidth, H = dev.offsetHeight
    const r = stage.getBoundingClientRect()
    const pad = r.width < 600 ? 12 : 32
    let z = Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H)
    if (!C.fixed) z = Math.min(z, 1)
    z = Math.max(0.05, z)
    Object.assign(box.style, { width: W * z + 'px', height: H * z + 'px' })
    dev.style.transform = `scale(${z})`
  }

  /** 放一屏：新 iframe 在后面载好了再换上来（不白一下） */
  function show(i, hash = '', state = '') {
    const me = ++seq
    const s = C.screens[i]
    const fr = document.createElement('iframe')
    fr.className = 'nx'
    fr.title = s.label
    // 自己做的屏和播放器同源（allow-same-origin）：不同源（不透明）的文档里浏览器不发 navigate 事件，
    // 脚本里 location.href = 'x.html' 就拦不住、整屏跳到假地址的报错页。别人做的屏页面脚本本来就跑不了（CSP），只给 allow-scripts
    fr.setAttribute('sandbox', s.strict ? 'allow-scripts' : 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox')
    fr.setAttribute('referrerpolicy', 'no-referrer')
    fr.style.colorScheme = C.dark ? 'dark' : 'light'
    let done = false
    const swap = () => {
      if (done || me !== seq || !fr.isConnected) return
      done = true
      fr.classList.remove('nx')
      for (const old of [...vp.querySelectorAll('iframe')]) if (old !== fr) setTimeout(() => old.remove(), 160)
      if (hash) setTimeout(() => { try { fr.contentWindow.postMessage({ ddpPack: 1, type: 'jump', hash }, '*') } catch { /* 已经换掉了 */ } }, 60)
    }
    fr.addEventListener('load', swap)
    setTimeout(swap, 2500) // 页面里有载不完的东西：别一直等
    fr.srcdoc = htmlOf(i, state)
    vp.appendChild(fr)
  }

  /** 地址的 # 部分 → 第几屏、哪个状态（#order.html?state=paid） */
  const posOfHash = () => {
    let h = ''
    try { h = decodeURIComponent(location.hash.replace(/^#/, '')) } catch { h = '' }
    const m = /^(.*)\?state=([A-Za-z0-9_-]{1,32})$/.exec(h)
    const k = h ? C.screens.findIndex((s) => s.key === (m ? m[1] : h)) : -1
    return k >= 0 ? { i: k, state: m ? normState(k, m[2]) : '' } : { i: 0, state: '' }
  }
  // 默认状态写不写都是同一屏（order.html 和 order.html?state=default）：统一成不写，返回的路才对得上。
  // 状态跟着模拟数据走的屏除外：不写是数据里那个，点名第一个要留着
  const normState = (i, state) => (state && !(C.screens[i].states && C.screens[i].states[0] === state && !C.screens[i].follow) ? state : '')
  const hashOf = (i, state) => '#' + encodeURIComponent(C.screens[i].key) + (normState(i, state) ? '?state=' + state : '')
  // 走到第几步，记在这一条浏览器历史记录上：页面里的「返回」（data-back）有得退就是浏览器后退一步，
  // 和浏览器自己的后退、前进是同一份路（后退再前进也对得上）。记不了的（沙盒不给改历史）照老办法按 trail 退
  const depthOf = () => { try { const s = history.state; return s && typeof s.ddpPos === 'number' ? s.ddpPos : -1 } catch { return -1 } }
  const tag = (n) => { try { history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), ddpPos: n }, ''); return depthOf() === n } catch { return false } }
  let depth = Math.max(0, depthOf())
  const tagged = tag(depth)
  function render() {
    const { i, state } = posOfHash()
    if (tagged) {
      const n = depthOf()
      if (n >= 0) depth = n // 浏览器后退 / 前进回到记过的那一步
      else { depth += 1; tag(depth) } // 新走的一步
    } else if (trail.length && trail[trail.length - 1] === hashOf(i, state)) trail.pop() // 浏览器后退回到了上一步
    if (i === cur && state === curState && dev) return
    cur = i
    curState = state
    sel.value = String(i)
    count.textContent = T.of.replace('{i}', String(i + 1)).replace('{n}', String(N))
    $('prev').disabled = i === 0
    $('next').disabled = i === N - 1
    const s = C.screens[i]
    document.title = C.title && C.title !== s.label ? `${s.label} · ${C.title}` : s.label
    if (!dev) build()
    decorate()
    const hash = pendingHash
    pendingHash = ''
    show(i, hash, state)
  }
  /** 外框重搭（开关外壳、横竖屏换了）：当前这屏重放 */
  const rebuild = () => { build(); decorate(); show(cur, '', curState) }
  const go = (i, hash = '', state = '') => {
    if (i < 0 || i >= N) return
    state = normState(i, state)
    if (i === cur && state === curState) { if (hash) { const fr = vp && [...vp.querySelectorAll('iframe:not(.nx)')].pop(); if (fr) fr.contentWindow.postMessage({ ddpPack: 1, type: 'jump', hash }, '*') } return }
    if (cur >= 0) { trail.push(hashOf(cur, curState)); if (trail.length > 30) trail.shift() }
    pendingHash = hash
    location.hash = hashOf(i, state)
  }
  const keyOf = (p) => { let k = String(p || '').replace(/^\/+/, ''); if (!k || k.endsWith('/')) k += 'index.html'; return k }

  addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.ddpPack !== 1 || !vp || ![...vp.querySelectorAll('iframe')].some((f) => f.contentWindow === e.source)) return
    if (d.type === 'nav' && d.back === true && (tagged ? depth > 0 : trail.length)) {
      if (tagged) history.back()
      else location.hash = trail.pop()
    } else if (d.type === 'nav' && d.back === true && !d.path) {
      // 没得退、也没写去哪：不动
    } else if (d.type === 'nav') {
      const k = keyOf(d.path)
      let i = C.screens.findIndex((s) => s.key === k)
      if (i < 0) i = C.screens.findIndex((s) => s.key === k + '.html')
      if (i < 0) say(T.notIn.replace('{p}', k))
      else go(i, typeof d.hash === 'string' ? d.hash : '', typeof d.state === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(d.state) ? d.state : '')
    } else if (d.type === 'store' && (d.area === 'l' || d.area === 's' || d.area === 'm')) {
      const m = store[d.area]
      if (d.op === 'set') m[String(d.k)] = String(d.v)
      else if (d.op === 'del') delete m[String(d.k)]
      else if (d.op === 'clear') store[d.area] = {}
    } else if (d.type === 'key') key(d.key)
  })
  const key = (k) => {
    if (k === 'ArrowLeft' || k === 'PageUp') go(cur - 1)
    else if (k === 'ArrowRight' || k === 'PageDown') go(cur + 1)
  }
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target === sel) return
    if (/^(ArrowLeft|ArrowRight|PageUp|PageDown)$/.test(e.key)) { e.preventDefault(); key(e.key) }
  })
  $('prev').addEventListener('click', () => go(cur - 1))
  $('next').addEventListener('click', () => go(cur + 1))
  sel.addEventListener('change', () => { document.body.classList.remove('open'); go(Number(sel.value)) })
  $('shell').addEventListener('click', () => {
    shell = !shell
    try { localStorage.setItem(SHELL_KEY, shell ? '1' : '0') } catch { /* 存不了 */ }
    rebuild()
  })
  $('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  })
  $('menu').addEventListener('click', () => document.body.classList.toggle('open'))
  // 重置演示数据（有模拟数据才有这个按钮）：演示里点过、填过的都回到开始，当前这屏重放一遍
  if (C.mockMark) {
    const rs = $('mreset')
    rs.hidden = false
    rs.addEventListener('click', () => {
      const pfx = 'dsh-mock:' + C.mockScope + ':'
      try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(pfx)) localStorage.removeItem(k) } } catch { /* 存不了 */ }
      for (const k of Object.keys(store.l)) if (k.startsWith(pfx)) delete store.l[k]
      store.m = {}
      document.body.classList.remove('open')
      if (cur >= 0) show(cur, '', curState)
      say(T.resetDone)
    })
  }
  document.addEventListener('fullscreenchange', () => { $('full').textContent = document.fullscreenElement ? T.exitFull : T.full })
  let wasCompact = compact()
  addEventListener('resize', () => {
    if (compact() !== wasCompact) { wasCompact = compact(); rebuild() } else fit()
  })
  addEventListener('hashchange', render)
  bar.hidden = false // 先把工具条放出来再量舞台（不然第一次缩放按没有工具条的高度算）
  render()
}

const STRINGS = {
  zh: { prev: '上一屏', next: '下一屏', shell: '设备框', shellTip: '套上手机 / 浏览器的设备框', full: '全屏', exitFull: '退出全屏', of: '{i} / {n}', notIn: '这一屏不在演示里：{p}', menu: '换屏', screens: '选屏', reset: '重置数据', resetTip: '演示里点过、填过的都回到开始', resetDone: '数据回到开始了' },
  en: { prev: 'Previous', next: 'Next', shell: 'Device frame', shellTip: 'Show the phone / browser frame', full: 'Full screen', exitFull: 'Exit full screen', of: '{i} / {n}', notIn: 'This screen isn\'t in the demo: {p}', menu: 'Screens', screens: 'Pick a screen', reset: 'Reset data', resetTip: 'Undo everything tapped and typed in this demo', resetDone: 'Data is back to the start' },
}

const CSS = `
:root{--stage:#e8e9ed;--bar:#fbfbfc;--fg:#1d1d22;--mute:#6b6b74;--line:rgba(0,0,0,.09);--btn:#f0f0f3;--btn-h:#e4e4e9;--acc:#4d6bfe;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--stage:#141417;--bar:#1d1d21;--fg:#ececf1;--mute:#9a9aa6;--line:rgba(255,255,255,.08);--btn:#29292f;--btn-h:#33333a;color-scheme:dark}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;height:100%;overflow:hidden}
body{background:var(--stage);color:var(--fg);font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;display:flex;flex-direction:column}
#bar{flex:none;display:flex;align-items:center;gap:8px;height:48px;padding:0 max(14px,env(safe-area-inset-right)) 0 max(14px,env(safe-area-inset-left));background:var(--bar);border-bottom:1px solid var(--line)}
#bar .ttl{flex:1 1 0;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bar .mid{flex:none;display:flex;align-items:center;gap:6px}
#bar .end{flex:1 1 0;display:flex;justify-content:flex-end;gap:6px;min-width:0}
#bar button,#bar select{height:30px;border:0;border-radius:8px;background:var(--btn);color:var(--fg);font:inherit;font-size:13px;padding:0 11px;cursor:pointer}
#bar button:hover:not(:disabled),#bar select:hover{background:var(--btn-h)}
#bar button:disabled{opacity:.4;cursor:default}
#bar button:focus-visible,#bar select:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
#bar .arw{width:30px;padding:0;font-size:16px;line-height:30px}
#bar select{max-width:min(42vw,280px);padding-right:8px}
#count{color:var(--mute);font-size:12px;font-variant-numeric:tabular-nums;min-width:44px;text-align:center}
#shell[aria-pressed=true]{background:var(--acc);color:#fff}
#stage{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fit{position:relative;flex:none}
.dev{position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.14),0 18px 48px rgba(0,0,0,.2)}
.dev.fill{position:absolute;inset:0;box-shadow:none;border-radius:0}
.dev.k-app,.dev.k-miniprogram,.dev.k-tablet{background:#0e0e12;box-shadow:inset 0 0 0 1.5px #2b2b33,0 0 0 1px rgba(0,0,0,.45),0 24px 60px rgba(0,0,0,.3)}
.dev.bare,.dev.fill.k-app,.dev.fill.k-miniprogram,.dev.fill.k-tablet{background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.14),0 18px 48px rgba(0,0,0,.2)}
.dev.fill.k-app,.dev.fill.k-miniprogram,.dev.fill.k-tablet{box-shadow:none}
.dev.k-desktop{box-shadow:0 0 0 .5px rgba(0,0,0,.3),0 22px 60px rgba(0,0,0,.28)}
.dev.fill.k-desktop{box-shadow:none}
.fit.all{position:absolute;inset:0}
.vp{position:absolute;overflow:hidden;background:#fff;isolation:isolate}
.dev.fill .vp{inset:0}
.vp.dk{background:#111}
.vp iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent;transition:opacity .15s}
.vp iframe.nx{opacity:0;pointer-events:none}
.chrome{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:7px;padding:0 13px;background:#ebebef;border-bottom:1px solid rgba(0,0,0,.07);border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0;overflow:hidden}
.chrome i{width:11px;height:11px;border-radius:50%;background:#ff5f57;flex:none}
.chrome i:nth-child(2){background:#febc2e}
.chrome i:nth-child(3){background:#28c840}
.chrome span{flex:1;min-width:0;margin:0 60px 0 18px;height:20px;border-radius:6px;background:rgba(0,0,0,.05);color:#6b6b74;font:12px/20px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.island{position:absolute;left:50%;width:118px;height:34px;margin-left:-59px;border-radius:20px;background:#000;z-index:4;pointer-events:none}
.cap{position:absolute;width:87px;height:32px;z-index:4;pointer-events:none;overflow:visible;fill:#000}
.cap .pl{fill:rgba(255,255,255,.6);stroke:rgba(0,0,0,.08);stroke-width:.5}
.cap .sp{stroke:rgba(0,0,0,.15);stroke-width:.5}
.cap .rg{fill:none;stroke:#000;stroke-width:2}
.cap.w{fill:#fff}
.cap.w .pl{fill:rgba(0,0,0,.15);stroke:rgba(255,255,255,.25)}
.cap.w .sp{stroke:rgba(255,255,255,.25)}
.cap.w .rg{stroke:#fff}
.win{position:absolute;z-index:4;pointer-events:none;overflow:visible}
.win .x{fill:none;stroke:#1f1f1f;stroke-width:1}
.win.w .x{stroke:#fff}
#toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100% - 32px);padding:9px 14px;border-radius:10px;background:rgba(20,20,24,.92);color:#fff;font-size:13px;z-index:20;box-shadow:0 6px 24px rgba(0,0,0,.25)}
#menu{display:none}
body.compact #bar{position:fixed;left:8px;right:8px;top:calc(34px + env(safe-area-inset-top));bottom:auto;height:auto;flex-wrap:wrap;padding:10px;border-radius:14px;border:1px solid var(--line);box-shadow:0 10px 40px rgba(0,0,0,.25);z-index:15;display:none}
body.compact.open #bar{display:flex}
body.compact #bar .ttl{flex-basis:100%}
body.compact #bar .mid{flex:1 1 100%;min-width:0}
body.compact #shell{display:none}
body.compact #bar select{flex:1;min-width:0;max-width:none;text-overflow:ellipsis}
body.compact #bar .arw,body.compact #count{flex:none}
body.compact #bar .end{flex:none;margin-left:auto}
body.compact #menu{display:block;position:fixed;left:50%;top:calc(4px + env(safe-area-inset-top));transform:translateX(-50%);width:64px;height:24px;padding:0;border-radius:12px;border:0;background:rgba(20,20,24,.5);color:#fff;font-size:13px;line-height:24px;z-index:16;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
@media (max-width:560px){#bar .ttl{display:none}#bar .end{flex:none}}
`

/**
 * 外观面板里选了、还没存的字体库字体（#31）：[{ family, w, url: data: 地址 }]（libFont(id) → { family, weights, data } | null）。
 * 写进每屏的配置里，打包时和别的 data: 地址一样整套只放一份
 */
function tweakFonts(ids, libFont) {
  const out = []
  for (const id of Array.isArray(ids) ? ids.slice(0, 8) : []) {
    let f = null
    try { f = typeof id === 'string' ? libFont(id) : null } catch { f = null }
    if (!f || !/^[A-Za-z0-9 ]{1,40}$/.test(f.family) || !Buffer.isBuffer(f.data)) continue
    const w = Array.isArray(f.weights) && f.weights.length === 2 ? `${f.weights[0] | 0} ${f.weights[1] | 0}` : '100 900'
    out.push({ family: f.family, w, url: `data:font/woff2;base64,${f.data.toString('base64')}` })
  }
  return out
}

/**
 * 展开后的页面里 data-mock-attr 绑到 src / srcset / poster 的数据路径（照 dataAssets 的写法：acts[*].cover、photos[*]、profile.cover）。
 * 列表别名还原成列表路径（data-mock-each="a in acts" → a.cover 是 acts[*].cover），["x"] 当 .x，数字和下标变量当 [*]
 */
function srcPaths(html) {
  const dec = (v) => v.replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  // 注释掉的不算；脚本、样式里的 < 别当成标签
  const text = String(html).replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, '')
  const ID = '[\\p{L}_$][\\p{L}\\p{N}_$]*' // 字段名、别名可以是中文
  const EACH = new RegExp(`^\\s*(${ID})\\s*(?:,\\s*(${ID})\\s*)?\\s+in\\s+([\\s\\S]+?)\\s*$`, 'u')
  const PATH = new RegExp(`${ID}(?:\\s*(?:\\.\\s*${ID}|\\[\\s*(?:\\d+|"[^"]*"|'[^']*'|${ID})\\s*\\]))*`, 'gu')
  const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i
  const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
  const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  // 按位置找：每个 data-mock-each 的别名管它直属 <template> 的内容；别名在最里层那个列表里找
  const eaches = [] // { start（each 元素在哪，列表表达式按它外面那层算）, inner, end（模板内容的范围）, alias, idx, list }
  const binds = [] // { at, value }
  const stack = []
  for (const m of text.matchAll(TAG)) {
    const name = m[2].toLowerCase()
    if (m[1]) {
      const i = stack.findLastIndex((s) => s.name === name)
      if (i >= 0) for (const s of stack.splice(i)) if (s.scope) s.scope.end = m.index
      continue
    }
    // 列表别名只在它直属的 <template> 里管用（预览只把模板内容按每一项克隆；<template> 外面的兄弟元素用外层数据）
    const top = stack[stack.length - 1]
    let scope = null
    let inert = false
    if (name === 'template' && top && top.each && !top.each.used) {
      top.each.used = true
      scope = { ...top.each, inner: m.index + m[0].length, end: text.length }
      eaches.push(scope)
    } else if (name === 'template') inert = true // 别的 <template>（列表里的备用模板等）不显示，里面绑的图不算
    let each = null
    for (const a of m[3].matchAll(ATTR)) {
      const k = a[1].toLowerCase()
      const v = dec(a[2] ?? a[3] ?? a[4] ?? '')
      if (k === 'data-mock-each') { const e = EACH.exec(v); if (e) each = { start: m.index, alias: e[1], idx: e[2] || null, list: e[3] } }
      else if (k === 'data-mock-attr' && !stack.some((x) => x.inert)) binds.push({ at: m.index, value: v })
    }
    if (!VOID.test(name) && !/\/\s*$/.test(m[3])) stack.push({ name, each, scope, inert })
  }
  const scopeOf = (head, at) => {
    let best = null
    for (const e of eaches) if (e.inner <= at && at < e.end && (e.alias === head || e.idx === head) && (!best || e.start > best.start)) best = e
    return best
  }
  // 一个路径表达式 → 数据里的完整路径：别名还原成「列表[*]」，["键"] → .键（键里的空格留着），[0] 留着，变量下标 → [*]
  const norm = (expr, at, depth) => {
    if (depth > 8) return ''
    const head = new RegExp(`^${ID}`, 'u').exec(expr)[0]
    if (/^(?:null|undefined|true|false|NaN|Infinity)$/.test(head)) return ''
    const SEG = new RegExp(`\\s*(?:\\.\\s*(${ID})|\\[\\s*(?:"([^"]*)"|'([^']*)'|(\\d+)|${ID})\\s*\\])`, 'uy')
    SEG.lastIndex = head.length
    let rest = ''
    for (let m; (m = SEG.exec(expr));) rest += m[1] != null ? '.' + m[1] : (m[2] ?? m[3]) != null ? '.' + (m[2] ?? m[3]) : m[4] != null ? `[${+m[4]}]` : '[*]'
    const e = scopeOf(head, at)
    if (!e) return head + rest
    if (e.idx === head && e.alias !== head) return '' // 下标别名：是个数字
    const lm = String(e.list).match(PATH)
    const b = lm ? norm(lm[0], e.start, depth + 1) : '' // 列表表达式按 each 元素外面那层算
    return b ? b + '[*]' + rest : ''
  }
  const out = new Set()
  for (const { at, value } of binds) {
    for (const part of value.split(';')) {
      const b = /^\s*(?:src|srcset|poster)\s*:\s*([\s\S]*)$/i.exec(part)
      if (!b) continue
      // 单独的字符串（'' 之类）不是路径；["键"] 整段留着（连着几个也不拆）
      const expr = b[1].replace(/\[\s*(?:"[^"]*"|'[^']*')\s*\]|(['"])(?:\\.|(?!\1)[^\\])*\1/g, (s, q) => (q ? '' : s))
      for (const p of expr.match(PATH) || []) { const n = norm(p, at, 0); if (n) out.add(n) }
    }
  }
  return out
}

/**
 * 打一份演示包。
 * screens：[{ key, label, top }]（top：顶栏是深色，外壳上的胶囊 / 窗口按钮画白的）
 * dark：右侧栏开着「深色」；scheme：右侧栏当时的系统深浅色（'dark' / 'light'），没开「深色」时页面按它显示
 * read(rel)：设计目录里的文件（Buffer，读不到 null）；strictOf(page)：这屏是不是别人做的（加硬规矩：只跑我们的脚本）
 * libFont(id)：外观面板里选了还没存的字体库字体 → { family, weights, data }
 * 回 { html, missing: [没读到的屏], count, skipped: [有、但太大没放进去的文件], gone: [mock.json 里写了、文件却没有的图] }
 */
export function buildPack({ screens, read, bigOf = null, strictOf = () => false, kind, w, h, os = '', dark = false, scheme = 'light', tweak = null, title = '', lang = 'zh', fit = false, libFont = () => null }) {
  kind = FRAME[kind] ? kind : 'web'
  const S = STRINGS[lang === 'en' ? 'en' : 'zh']
  const token = 'ddpA' + crypto.randomBytes(5).toString('hex') + '_'
  const storeMark = `/*ddpS${token}*/null`
  const nonce = crypto.randomBytes(16).toString('base64')
  const navCfg = { origin: PACK_ORIGIN, sel: LINK_SEL, js: LINK_JS.source, pages: !!FIXED[kind], tweak: tweak && typeof tweak === 'object' ? { vars: tweak.vars || {}, attrs: tweak.attrs || {}, fonts: tweakFonts(tweak.fonts, libFont) } : null }
  const script = (src, strict) => `<script${strict ? ` nonce="${nonce}"` : ''}>${src.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')}</script>`
  const shimSrc = `(${storeShim})(${storeMark});`
  const stateMark = `/*ddpT${token}*/''` // 放一屏时换成这屏的状态（#30）
  const navSrc = (strict) => `(${navScript})(${JSON.stringify({ ...navCfg, strict })}, ${stateMark});`
  // 模拟数据（#30）：设计目录里有 mock.json 就每屏放运行时（在存储替身后面、跳屏监听前面：点了又改数据又跳屏的先存好），
  // 数据本身整套只放一份在播放器的配置里，放一屏时填进记号那里
  const mk = mockOfBuf(read(MOCK_FILE), !!(bigOf && bigOf(MOCK_FILE)))
  // mock.json 太大没读：导出来的演示点了不会变——报错不导出（不悄悄给一个丢了数据的演示）
  if (mk && /^big/.test(mk.fp)) { const e = new Error('mockTooBig'); e.code = 'mockTooBig'; throw e }
  const mockMark = mk ? `/*ddpM${token}*/null` : ''
  const mockScope = token.slice(0, -1)
  const mockAMark = mk ? `/*ddpMA${token}*/null` : ''
  const mockSrc = mk ? `(${mockRuntime})(${mockExpr},${JSON.stringify({ v: mk.fp, scope: mockScope, err: mk.err })},${mockMark},${mockAMark});` : ''
  // 数据里写的本地图片（头像、商品图）：演示是单个文件，没有设计目录可读——换成 data: 地址的表，整套只放一份
  const mockOver = []
  const mockGone = [] // 数据里写了、文件没有的图 { rel, keys }：组件绑到 src 的整份不出（下面），其余照样导出、结果里列出来
  const bound = new Map() // 用了组件的屏里绑到 src 的数据路径 → [屏]
  const mockAssets = mk ? dataAssets(mk.data, read, 60 * 1024 * 1024, mockOver, bigOf, mockGone) : null
  if (mockOver.length) { const e = new Error('imgTooBig'); e.code = 'imgTooBig'; throw e } // 数据里绑的图换不下：不悄悄留成坏图
  const mode = dark ? 'dark' : scheme === 'dark' ? 'media' : 'light'
  const schemeSrc = `(${schemeScript})(${JSON.stringify(mode)});`

  const assets = []
  const index = new Map()
  const parts = []
  const list = []
  const missing = []
  const skipped = new Set() // 有、但太大放不进去的文件（单个超过 12 MB、一屏加起来超过 SCREEN_MAX）：导出照样出，但要告诉用户缺了哪些
  const readPage = (rel) => { const b = read(rel); if (!b && bigOf && bigOf(rel)) skipped.add(rel); return b }
  if (read.hasCompDir) readPage.hasCompDir = read.hasCompDir
  let total = mk ? JSON.stringify(mk.data).length + JSON.stringify(mockAssets).length : 0
  const compBad = [] // 组件有错的屏（#30）
  for (const s of screens.slice(0, PACK_SCREENS)) {
    const page = read(s.key)
    if (!page) { missing.push(s.key); continue }
    const strict = !!strictOf(page)
    // 组件（#30）：先展开；有错就整份不出（攒齐哪几屏有错，最后抛 compErr），不出带红框或缺块的演示
    let text
    try {
      const ex = expandFormal(page.toString('utf8').replace(/^﻿/, ''), readPage, s.key)
      text = ex.html
      if (ex.comp && mockGone.length) for (const k of srcPaths(text)) { if (!bound.has(k)) bound.set(k, []); bound.get(k).push(s.key) }
    } catch (e) {
      if (e.code !== 'compErr') throw e
      compBad.push(...e.pages)
      continue
    }
    const base = PACK_ORIGIN + '/' + s.key.split('/').map(encodeURIComponent).join('/')
    let out = bundle(strict ? defang(text) : text, {
      key: s.key,
      read: readPage,
      max: SCREEN_MAX,
      onSkip: (rel) => skipped.add(rel),
      base,
      lead: (strict ? strictMeta(nonce) : '') + script(shimSrc + mockSrc + navSrc(strict), strict),
      tail: script(schemeSrc, strict),
    })
    // 大的 data: 地址（图片、字体、脚本）挪出来单独存，几屏共用的只存一份
    out = out.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+=-]+)*;base64,[A-Za-z0-9+/]+={0,2}/gi, (m) => {
      if (m.length < ASSET_MIN) return m
      let i = index.get(m)
      if (i === undefined) { i = assets.length; assets.push(m); index.set(m, i); total += m.length }
      return token + i + '_'
    })
    total += out.length
    if (total > PACK_MAX) { const e = new Error('tooBig'); e.code = 'tooBig'; throw e }
    parts.push(`<script type="application/json" id="ddp-s-${list.length}">${jsonTag(out)}</script>`)
    const states = statesOfHtml(text).map((x) => x.name) // 这屏写了哪几个状态（#30）：放这屏时只设写了的
    list.push({ key: s.key, label: String(s.label || s.key).slice(0, 80), top: !!s.top, ...(strict ? { strict: true } : null), ...(states.length ? { states } : null), ...(states.length && mk && followsMock(text) ? { follow: true } : null) })
  }
  if (compBad.length) throw compError(compBad)
  // 组件绑到 src 的图（:cover 这类）在设计目录里没有：整份不出，说哪张图、哪个字段、哪几屏（方案：正式导出不出坏图）
  // 绑定路径里的 [*]（列表别名、变量下标）对上任何下标；写死的 [0] 只对 [0]
  const keys = [...bound.keys()].map((k) => ({ k, re: new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]') + '$') }))
  const keyOf = (p) => (keys.find((x) => x.re.test(p)) || {}).k
  const imgBad = mockGone.map((g) => ({ ...g, hits: g.paths.map((p) => [p, keyOf(p)]).filter((h) => h[1]) })).filter((g) => g.hits.length)
  if (imgBad.length) {
    const at = (g) => `${g.rel}（mock 里的 ${g.hits[0][0]}，用在 ${[...new Set(bound.get(g.hits[0][1]))].slice(0, 3).join('、')}）`
    const e = new Error(`组件绑的图在设计目录里找不到：${imgBad.slice(0, 3).map(at).join('；')}${imgBad.length > 3 ? ` 等 ${imgBad.length} 张` : ''}`)
    e.code = 'imgMissing'
    e.files = imgBad.map((g) => g.rel)
    throw e
  }
  if (!list.length) { const e = new Error('noScreens'); e.code = 'noScreens'; throw e }

  const f = frameOf(kind, w, h)
  const cfg = {
    kind, w, h, os: os === 'win' ? 'win' : '', dark: !!dark || scheme === 'dark', title: String(title || '').slice(0, 120),
    frame: f, cap: CAP, lights: LIGHTS, winbtn: WINBTN,
    framed: !!FRAMED[kind], fixed: !!FIXED[kind],
    // 网页默认不套浏览器框（铺满窗口），右侧栏开着「按画幅显示」的照它套着；手机、平板、桌面软件默认套着
    shellDefault: !!FRAMED[kind] && (kind !== 'web' || !!fit),
    screens: list, token, storeMark, stateMark, strings: S,
    ...(mk ? { mockMark, mockAMark, mockScope, mock: mk.data, mockAssets } : null),
  }
  const docTitle = cfg.title || list[0].label
  const html = '<!doctype html>\n'
    + `<html lang="${lang === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + `<meta name="generator" content="DSH Design Studio"><title>${escHtml(docTitle)}</title><style>${CSS}</style></head><body>`
    + `<header id="bar" hidden><div class="ttl">${escHtml(cfg.title)}</div>`
    + `<div class="mid"><button id="prev" class="arw" type="button" title="${escHtml(S.prev)} (←)" aria-label="${escHtml(S.prev)}">‹</button>`
    + `<select id="sel" aria-label="${escHtml(S.screens)}"></select>`
    + `<button id="next" class="arw" type="button" title="${escHtml(S.next)} (→)" aria-label="${escHtml(S.next)}">›</button><span id="count"></span></div>`
    + `<div class="end"><button id="shell" type="button" aria-pressed="false" title="${escHtml(S.shellTip)}">${escHtml(S.shell)}</button>`
    + `<button id="mreset" type="button" hidden title="${escHtml(S.resetTip)}">${escHtml(S.reset)}</button>`
    + `<button id="full" type="button">${escHtml(S.full)}</button></div></header>`
    + `<main id="stage"></main><button id="menu" type="button" aria-label="${escHtml(S.menu)}">•••</button><div id="toast" role="status" hidden></div>`
    + `<script type="application/json" id="ddp-cfg">${jsonTag(cfg)}</script>`
    + parts.join('')
    + assets.map((a, i) => `<script type="application/json" id="ddp-a-${i}">${jsonTag(a)}</script>`).join('')
    + `<script>(${player})()</script>`
    + '</body></html>\n'
  return { html, missing, count: list.length, skipped: [...skipped], gone: mockGone.map((g) => g.rel) }
}
