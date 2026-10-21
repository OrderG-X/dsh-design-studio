/**
 * 注入到预览页面里的脚本（浏览器里跑，不是 Node）。
 *
 *   - 和右侧栏通信：只认外层 DSH 页面发来的消息（event.source === parent 且 origin 对得上）
 *   - 点选：鼠标移到哪高亮到哪，点一下选中元素；拖一下框出一块区域
 *   - 选中后把「位置、HTML、关键样式、组件源码位置（拿得到的话）」发回右侧栏，选中的地方留个虚线框
 *   - 改动高亮：刷新 / 热更新前后各记一份「指纹」，改了哪里就在哪里闪一下
 *   - 生成动画：模型刚做出来的一屏，元素从上到下依次浮现，一道扫描光带过去
 *   - 画布里缩小显示时，右侧栏告诉缩放比例，选取框、标签按比例放大，看得清
 *   - 设计变量：页面 :root 上的 CSS 变量（配色、字号、间距、圆角 …）连同出处报给右侧栏，显示成规范面板
 *   - 导出图片：把页面画成 PNG（样式逐个元素内联进 SVG foreignObject，图片、字体转成 data URL）交给右侧栏
 *   - 深色模式：页面带了深色样式就能一键切过去看
 *   - 本地文件预览：目录里有改动就通知右侧栏，右侧栏在后台载好新的一帧再换上来（不白屏）；
 *     单独在浏览器里打开时自己整页刷新。前后保住滚动位置
 *
 * 所有界面都画在一个 shadow root 里，不受页面样式影响，也不污染页面。
 */
(() => {
  if (window.__dshDesignPicker) return
  window.__dshDesignPicker = true

  const cfg = window.__DSH_DESIGN__ || {}
  // 只和 DSH 说话：外层的源得是服务端给的那几个（桌面版 dsh-app://app、DSH 网页端）。
  // 别的网站把预览嵌进去：当没有外层（不发消息、也不听它的），页面照常显示
  const allowed = Array.isArray(cfg.parents) ? cfg.parents.filter((o) => typeof o === 'string' && o && o !== '*' && o !== 'null') : []
  const anc = location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[0] : ''
  // 「源:*」= 这个地址的任意端口（DSH 声明的对外域名没写端口时）
  const fitsParent = (o) => o === anc || (o.endsWith(':*') && anc.startsWith(o.slice(0, -1)) && /^\d+$/.test(anc.slice(o.length - 1)))
  const parentOrigins = window.parent === window ? [] : anc ? (allowed.some(fitsParent) ? [anc] : []) : allowed.filter((o) => !o.endsWith(':*'))
  const parentWin = parentOrigins.length ? window.parent : null
  const SEED_KEY = '__dsh_design_seed__'

  function post(msg) {
    if (!parentWin) return
    // 指定收件的源：外层不是这个源就收不到（拿不到 ancestorOrigins 时每个认的源各发一次，只有对得上的那个收得到）
    for (const o of parentOrigins) {
      try { parentWin.postMessage({ dshDesign: 1, ...msg }, o) } catch { /* 外层不在了 */ }
    }
  }

  // ── 描述一个元素 ──────────────────────────────────────────────────────────

  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'))
  const GOOD_CLASS = /^[A-Za-z_][\w-]*$/
  // 状态类、哈希类（css-modules / styled-components 的随机后缀）不进选择器
  const NOISY_CLASS = /^(is-|has-)|(active|hover|focus|selected|open)$|^(css|sc|jsx|svelte|emotion)-[\w-]{4,}$|_[a-z0-9]{5,}$/i

  function nameOf(el) {
    let s = el.tagName.toLowerCase()
    if (el.id && GOOD_CLASS.test(el.id)) return s + '#' + el.id
    const cls = [...el.classList].filter((c) => GOOD_CLASS.test(c) && !NOISY_CLASS.test(c)).slice(0, 2)
    if (cls.length) s += '.' + cls.join('.')
    return s
  }

  /** 尽量短、又能唯一定位的 CSS 路径；最多往上 6 层 */
  function cssPath(el) {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && GOOD_CLASS.test(e.id) && document.querySelectorAll('#' + esc(e.id)).length === 1) {
        parts.unshift('#' + esc(e.id))
        break
      }
      let s = e.tagName.toLowerCase()
      const cls = [...e.classList].filter((c) => GOOD_CLASS.test(c) && !NOISY_CLASS.test(c)).slice(0, 2)
      if (cls.length) s += '.' + cls.map(esc).join('.')
      const parent = e.parentElement
      if (parent) {
        const same = [...parent.children].filter((x) => x.tagName === e.tagName)
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`
      }
      parts.unshift(s)
      if (e.tagName === 'BODY' || parts.length >= 5) break
    }
    if (parts.length > 1 && parts[0] === 'body') parts.shift()
    return parts.join(' > ')
  }

  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
  const textOf = (el) => clip((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(), 80)

  /** 元素的 HTML：太长就只留开头标签 + 子元素个数，长属性值（data URI、svg path）截断 */
  function htmlOf(el, max = 240) {
    const shallow = el.cloneNode(false)
    for (const a of [...shallow.attributes]) {
      if (a.value.length > 80) shallow.setAttribute(a.name, a.value.slice(0, 80) + '…')
    }
    const full = el.outerHTML.replace(/\s+/g, ' ')
    if (full.length <= max) return full
    const open = shallow.outerHTML.replace(/<\/[^>]+>$/, '')
    const kids = el.children.length
    const txt = textOf(el)
    const inner = kids ? ` …${kids} 个子元素… ` : clip(txt, 60)
    return open + inner + `</${el.tagName.toLowerCase()}>`
  }

  const NONE = new Set(['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'transparent', 'static'])

  /** 改样式时最常用到的几项，默认值不写 */
  function stylesOf(el) {
    const cs = getComputedStyle(el)
    const out = {}
    const pick = (k, label = k) => {
      const v = cs.getPropertyValue(k)
      if (v && !NONE.has(v)) out[label] = clip(v, 120)
    }
    pick('display')
    pick('color')
    pick('background-color')
    if (cs.backgroundImage !== 'none') out['background-image'] = clip(cs.backgroundImage, 120)
    pick('font-size')
    pick('font-weight')
    out['font-family'] = clip(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), 40)
    pick('line-height')
    pick('padding')
    pick('margin')
    pick('border-radius')
    if (parseFloat(cs.borderTopWidth) > 0) out.border = `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`
    if (/flex|grid/.test(cs.display)) pick('gap')
    pick('box-shadow')
    pick('position')
    return out
  }

  /** 组件和源码位置：React（开发版）、Vue、Svelte 能拿到就给 */
  function sourceOf(el) {
    try {
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
      if (fiberKey) {
        let f = el[fiberKey]
        let file = ''
        let comp = ''
        for (let i = 0; f && i < 40; i++, f = f.return) {
          if (!file && f._debugSource) file = `${f._debugSource.fileName}:${f._debugSource.lineNumber}`
          if (!comp && typeof f.type === 'function') comp = f.type.displayName || f.type.name || ''
          if (file && comp) break
        }
        if (comp || file) return { framework: 'React', component: comp, file }
      }
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const v = e.__vueParentComponent
        if (v && v.type) return { framework: 'Vue', component: v.type.name || v.type.__name || '', file: v.type.__file || '' }
        const s = e.__svelte_meta
        if (s && s.loc) return { framework: 'Svelte', component: '', file: `${s.loc.file}:${s.loc.line}` }
      }
    } catch { /* 拿不到就算了 */ }
    return null
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
  }

  function describe(el) {
    return {
      name: nameOf(el),
      selector: cssPath(el),
      text: textOf(el),
      html: htmlOf(el),
      rect: rectOf(el),
      styles: stylesOf(el),
      source: sourceOf(el),
    }
  }

  /** 框选：挑出大部分落在框里的元素，只要最外层的，最多 10 个 */
  function elementsIn(box) {
    const picked = []
    const all = document.body ? document.body.getElementsByTagName('*') : []
    const limit = Math.min(all.length, 6000)
    for (let i = 0; i < limit; i++) {
      const el = all[i]
      if (el === host || picked.some((p) => p.contains(el))) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const ix = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
      const iy = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
      if (ix * iy >= r.width * r.height * 0.8) {
        picked.push(el)
        if (picked.length >= 10) break
      }
    }
    if (!picked.length) {
      const c = under((box.left + box.right) / 2, (box.top + box.bottom) / 2)
      if (c) picked.push(c)
    }
    return picked
  }

  // ── 选取界面（shadow root 里） ─────────────────────────────────────────────

  let host = null
  let ui = null
  let picking = false

  const STYLE = `
:host{all:initial}
.layer{position:fixed;inset:0;z-index:2147483646;cursor:crosshair}
.box,.tag,.hint{z-index:2147483647}
.box{position:fixed;pointer-events:none;border:calc(1.5px * var(--k, 1)) solid #4d6bfe;background:rgba(77,107,254,.08);border-radius:3px;
  transition:left .08s ease,top .08s ease,width .08s ease,height .08s ease;display:none}
.box.region{border-style:dashed;transition:none}
.box.done{animation:pulse .9s ease-out 1}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(77,107,254,.45)}100%{box-shadow:0 0 0 10px rgba(77,107,254,0)}}
.tag{position:fixed;pointer-events:none;display:none;padding:2px 7px;border-radius:5px;background:#4d6bfe;color:#fff;
  font:500 11px/16px -apple-system,system-ui,sans-serif;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;
  transform:scale(var(--k, 1));transform-origin:0 100%}
.tag.below{transform-origin:0 0}
.tag i{font-style:normal;opacity:.75;margin-left:6px}
.hint{position:fixed;left:50%;top:10px;transform:translateX(-50%);pointer-events:none;padding:6px 12px;border-radius:999px;
  background:rgba(20,20,22,.86);color:#e8e8ea;font:12px/18px -apple-system,system-ui,sans-serif;white-space:nowrap;
  box-shadow:0 4px 16px rgba(0,0,0,.25);backdrop-filter:blur(8px)}
`

  // 画布里缩小显示时的放大倍数（1 / 缩放比例），选取框、标签、高亮都按它放大
  let K = 1
  function setK(k) {
    K = Math.max(1, Math.min(6, Number(k) || 1))
    if (host) host.style.setProperty('--k', K)
    if (fx) fx.host.style.setProperty('--k', K)
    if (editUi) editUi.host.style.setProperty('--k', K)
    placePin()
  }

  function mount(hint) {
    if (host) return
    host = document.createElement('dsh-design-picker')
    host.style.setProperty('--k', K)
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>${STYLE}</style><div class="layer"></div><div class="box"></div><div class="tag"></div><div class="hint">点选一个元素，或拖出一块区域 · Esc 取消</div>`
    ui = {
      layer: root.querySelector('.layer'),
      box: root.querySelector('.box'),
      tag: root.querySelector('.tag'),
      hint: root.querySelector('.hint'),
    }
    if (!hint) ui.hint.style.display = 'none'
    document.documentElement.appendChild(host)
    ui.layer.addEventListener('mousedown', onDown, true)
    ui.layer.addEventListener('mousemove', onMove, true)
    ui.layer.addEventListener('mouseup', onUp, true)
    ui.layer.addEventListener('mouseleave', () => hide(), true)
  }

  function unmount() {
    if (host) host.remove()
    host = null
    ui = null
  }

  /** 指针下面的页面元素（跳过我们自己的层） */
  function under(x, y) {
    const list = document.elementsFromPoint(x, y)
    for (const el of list) {
      if (el === host || el === document.documentElement) continue
      return el
    }
    return null
  }

  function place(r, cls) {
    ui.box.className = 'box' + (cls ? ' ' + cls : '')
    Object.assign(ui.box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
  }

  function label(r, text, sub) {
    ui.tag.innerHTML = ''
    ui.tag.append(text)
    if (sub) {
      const i = document.createElement('i')
      i.textContent = sub
      ui.tag.append(i)
    }
    ui.tag.style.display = 'block'
    // 标签按左下角放大：盒子顶 = 框顶 - 22，看上去底边贴着框；上面放不下就放到框下面
    const fits = r.top - 2 - 20 * K > 4
    ui.tag.classList.toggle('below', !fits)
    ui.tag.style.left = Math.max(4, Math.min(r.left, innerWidth - 200 * K)) + 'px'
    ui.tag.style.top = (fits ? r.top - 22 : Math.min(innerHeight - 22 * K, r.bottom + 4)) + 'px'
  }

  function hide() {
    if (!ui) return
    ui.box.style.display = 'none'
    ui.tag.style.display = 'none'
  }

  let down = null
  let dragging = false

  function onDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    down = { x: e.clientX, y: e.clientY }
    dragging = false
  }

  function regionBox(e) {
    const left = Math.min(down.x, e.clientX)
    const top = Math.min(down.y, e.clientY)
    return { left, top, right: Math.max(down.x, e.clientX), bottom: Math.max(down.y, e.clientY), width: Math.abs(e.clientX - down.x), height: Math.abs(e.clientY - down.y) }
  }

  function onMove(e) {
    e.stopPropagation()
    if (down && (dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)) {
      dragging = true
      const b = regionBox(e)
      place(b, 'region')
      label(b, '区域', `${Math.round(b.width)}×${Math.round(b.height)}`)
      return
    }
    const el = under(e.clientX, e.clientY)
    if (!el) return hide()
    const r = el.getBoundingClientRect()
    place(r)
    label(r, nameOf(el), `${Math.round(r.width)}×${Math.round(r.height)}`)
  }

  function onUp(e) {
    if (!down) return
    e.preventDefault()
    e.stopPropagation()
    const wasDrag = dragging
    const b = wasDrag ? regionBox(e) : null
    down = null
    dragging = false
    let payload
    if (wasDrag && b.width > 6 && b.height > 6) {
      const els = elementsIn(b)
      payload = {
        kind: 'region',
        rect: { x: Math.round(b.left + scrollX), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) },
        elements: els.map((el) => ({ name: nameOf(el), selector: cssPath(el), text: textOf(el), source: sourceOf(el) })),
      }
      place(b, 'region done')
      pin({ left: b.left + scrollX, top: b.top + scrollY, width: b.width, height: b.height }, null, '区域')
    } else {
      const el = under(e.clientX, e.clientY)
      if (!el) return
      payload = { kind: 'element', ...describe(el) }
      place(el.getBoundingClientRect(), 'done')
      pin(null, el, nameOf(el))
    }
    stop(false)
    post({ type: 'picked', payload: { ...payload, href: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight } } })
  }

  function onKey(e) {
    if (e.key === 'Escape' && picking) {
      e.preventDefault()
      stop(true)
    }
  }

  function start(hint = true) {
    if (picking) return
    picking = true
    unpin()
    mount(hint)
    addEventListener('keydown', onKey, true)
  }

  /** cancelled: 用户按了 Esc / 外面点了取消；false 时留一下选中框再收 */
  function stop(cancelled) {
    if (!picking) return
    picking = false
    removeEventListener('keydown', onKey, true)
    if (cancelled) {
      unmount()
      post({ type: 'cancelled' })
      return
    }
    if (ui) {
      ui.layer.style.pointerEvents = 'none'
      ui.layer.style.cursor = 'auto'
      ui.hint.style.display = 'none'
      ui.tag.style.display = 'none'
    }
    const h = host
    setTimeout(() => { if (host === h) unmount() }, 900)
  }

  // ── 改动高亮 ──────────────────────────────────────────────────────────────
  //
  // 「指纹」= 每个元素的路径 → 它自己的哈希（标签、类名、自己的文字、几项算出来的样式）。
  // 新旧两份一比：哈希在旧的里面一个都找不到的元素就是改过的 / 新加的；只留最外层，最多 12 个。
  // 宽高不进指纹（一处改动会牵动一串祖先的尺寸）；状态类、inline style 也不进（轮播、动画会一直变）。

  const SIG_SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'BR', 'TITLE', 'HEAD', 'DSH-DESIGN-PICKER', 'DSH-DESIGN-FX', 'DSH-DESIGN-EDIT'])
  const SIG_PROPS = ['color', 'background-color', 'background-image', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-align',
    'text-decoration-line', 'letter-spacing', 'border-radius', 'border-top-width', 'border-top-color', 'padding-top', 'padding-left',
    'margin-top', 'display', 'gap', 'box-shadow']
  const MAX_SIG = 2500

  function hashStr(s) {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
  }

  function ownText(el) {
    let s = ''
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue
    return s.replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  function sigOf(el) {
    const cs = getComputedStyle(el)
    let s = el.tagName + '|' + [...el.classList].filter((c) => !NOISY_CLASS.test(c)).join('.') + '|' + ownText(el)
    const src = el.getAttribute('src')
    if (src) s += '|' + src.slice(0, 200)
    for (const k of SIG_PROPS) s += '|' + cs.getPropertyValue(k)
    return hashStr(s)
  }

  /** { map: 路径 → 哈希, els: 路径 → 元素 } */
  function snapshot() {
    const map = {}
    const els = {}
    let n = 0
    const walk = (el, path) => {
      const counts = {}
      for (const c of el.children) {
        if (n >= MAX_SIG) return
        if (SIG_SKIP.has(c.tagName)) continue
        const i = (counts[c.tagName] = (counts[c.tagName] || 0) + 1)
        const p = path + '/' + c.tagName + i
        map[p] = sigOf(c)
        els[p] = c
        n++
        if (c.tagName.toLowerCase() !== 'svg') walk(c, p)
      }
    }
    if (document.body) walk(document.body, '')
    return { map, els }
  }

  /** 和旧指纹比：{ count, whole, els }（whole = 整页都换了，不逐个闪） */
  function compare(oldMap, cur) {
    const seen = new Set(Object.values(oldMap))
    const changed = new Set()
    for (const [p, h] of Object.entries(cur.map)) if (oldMap[p] !== h && !seen.has(h)) changed.add(p)
    const total = Object.keys(cur.map).length
    const outer = []
    for (const p of changed) {
      let a = p
      let nested = false
      for (let i = a.lastIndexOf('/'); i > 0; i = a.lastIndexOf('/')) {
        a = a.slice(0, i)
        if (changed.has(a)) { nested = true; break }
      }
      if (!nested) outer.push(p)
    }
    const whole = changed.size > Math.max(30, total * 0.5)
    const els = whole ? [] : outer.map((p) => cur.els[p]).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width >= 2 && r.height >= 2
    }).slice(0, 12)
    return { count: outer.length, whole, els }
  }

  // 高亮和选中框画在另一个 shadow root 里，按页面坐标放（跟着页面滚）
  const FX_STYLE = `
:host{all:initial}
.hl{position:absolute;pointer-events:none;border-radius:6px;opacity:0;
  box-shadow:0 0 0 calc(2px * var(--k, 1)) #4d6bfe,0 0 calc(22px * var(--k, 1)) calc(4px * var(--k, 1)) rgba(77,107,254,.38);background:rgba(77,107,254,.07);
  animation:hl 2.6s cubic-bezier(.2,.7,.2,1) forwards}
.hl i{position:absolute;inset:0;border-radius:inherit;overflow:hidden}
.hl i::after{content:"";position:absolute;inset:0;transform:translateX(-110%);
  background:linear-gradient(100deg,transparent 25%,rgba(255,255,255,.65) 50%,transparent 75%);animation:sweep 1.1s .18s ease-out forwards}
.hl span,.pin span{position:absolute;left:-2px;top:-23px;padding:1px 8px;border-radius:5px;background:#4d6bfe;color:#fff;
  font:500 11px/19px -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif;white-space:nowrap;
  box-shadow:0 4px 12px rgba(77,107,254,.35);transform:scale(var(--k, 1));transform-origin:0 100%}
.hl.below span,.pin.below span{top:auto;bottom:-23px;transform-origin:0 0}
@keyframes hl{0%{opacity:0;transform:scale(1.035)}9%{opacity:1;transform:scale(1)}78%{opacity:1}100%{opacity:0}}
@keyframes sweep{to{transform:translateX(110%)}}
.pin{position:absolute;pointer-events:none;border:calc(1.5px * var(--k, 1)) dashed #4d6bfe;border-radius:5px;background:rgba(77,107,254,.05);
  animation:pin-in .25s ease-out}
.pin span{opacity:.92}
@keyframes pin-in{from{opacity:0}}
.scan{position:fixed;left:0;right:0;top:0;height:38vh;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,rgba(77,107,254,0),rgba(77,107,254,.06) 55%,rgba(124,140,255,.22) 92%,rgba(77,107,254,0));
  animation:scan var(--dur, 1.2s) cubic-bezier(.45,0,.25,1) forwards}
.scan::after{content:"";position:absolute;left:0;right:0;bottom:8%;height:2px;
  background:linear-gradient(90deg,transparent,#8ea2ff 20%,#c4b5fd 50%,#5eead4 80%,transparent);box-shadow:0 0 14px 3px rgba(124,140,255,.55)}
@keyframes scan{0%{opacity:0;transform:translateY(-38vh)}12%{opacity:1}82%{opacity:1}100%{opacity:0;transform:translateY(100vh)}}
`
  let fx = null

  function fxRoot() {
    if (fx && fx.host.isConnected) return fx
    const h = document.createElement('dsh-design-fx')
    h.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none'
    h.style.setProperty('--k', K)
    const root = h.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>${FX_STYLE}</style>`
    document.documentElement.appendChild(h)
    fx = { host: h, root }
    return fx
  }

  const PX = /^\d+(\.\d+)?px$/
  function frame(node, r, pad, radius) {
    Object.assign(node.style, {
      left: r.left - pad + 'px',
      top: r.top - pad + 'px',
      width: r.width + pad * 2 + 'px',
      height: r.height + pad * 2 + 'px',
    })
    if (radius && PX.test(radius) && radius !== '0px') node.style.borderRadius = `${parseFloat(radius) + pad}px`
    if (r.top < 28 * K) node.classList.add('below')
  }

  const docRect = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }
  }

  function flash(els) {
    const { root } = fxRoot()
    els.forEach((el, i) => {
      const b = document.createElement('div')
      b.className = 'hl'
      b.append(document.createElement('i'))
      frame(b, docRect(el), 3, getComputedStyle(el).borderTopLeftRadius)
      b.style.animationDelay = i * 80 + 'ms'
      if (i === 0) {
        const t = document.createElement('span')
        t.textContent = els.length > 1 ? `已更新 · ${els.length} 处` : '已更新'
        b.append(t)
      }
      root.append(b)
      setTimeout(() => b.remove(), 2800 + i * 80)
    })
  }

  const inView = (el) => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  }

  /** 闪一下；改的地方都不在屏幕里就先滚过去 */
  function play(els) {
    if (!els.length) return
    if (els.some(inView)) return flash(els)
    try { els[0].scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { els[0].scrollIntoView() }
    setTimeout(() => flash(els), 420)
  }

  // ── 生成动画：元素按从上到下的顺序浮现，扫描光带一起往下走 ─────────────────
  //
  // 只动屏幕里（和下面一点）的元素；「原子」（没有子元素 / 有自己的文字 / 图片按钮这类）上浮 + 去模糊，
  // 有底色边框的容器（卡片）先淡入。用 Web Animations 的 fill: backwards，播完不留任何痕迹。

  const ATOMS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'HR', 'PICTURE', 'IFRAME'])
  const MAX_BUILD = 160

  function buildIn() {
    if (!document.body || typeof document.body.animate !== 'function') return
    const vh = innerHeight
    const vw = innerWidth
    const items = []
    const walk = (el) => {
      for (const c of el.children) {
        if (items.length >= MAX_BUILD) return
        if (SIG_SKIP.has(c.tagName)) continue
        const r = c.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) { walk(c); continue }
        if (r.bottom < 0 || r.top > vh * 1.4) continue
        const cs = getComputedStyle(c)
        if (cs.visibility === 'hidden' || cs.opacity === '0') continue
        const atom = ATOMS.has(c.tagName.toUpperCase()) || !c.children.length || ownText(c)
        if (atom) { items.push({ el: c, r, atom: true }); continue }
        const surface = r.width < vw * 0.96 && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' ||
          parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none')
        if (surface) items.push({ el: c, r, atom: false })
        walk(c)
      }
    }
    walk(document.body)
    if (!items.length) return
    const span = Math.max(vh, 1)
    const DUR = 1300
    const ease = 'cubic-bezier(.2,.8,.2,1)'
    for (const it of items) {
      const y = Math.min(1.4, Math.max(0, it.r.top / span))
      const delay = Math.round((y / 1.4) * DUR * 0.78 + (Math.max(0, it.r.left) / vw) * 90)
      try {
        if (it.atom) {
          it.el.animate([{ opacity: 0, translate: '0 12px', filter: 'blur(6px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }],
            { duration: 620, delay: delay + 70, easing: ease, fill: 'backwards' })
        } else {
          it.el.animate([{ opacity: 0, scale: '0.97' }, { opacity: 1, scale: '1' }], { duration: 560, delay, easing: ease, fill: 'backwards' })
        }
      } catch { /* 个别元素动不了就跳过 */ }
    }
    const { root } = fxRoot()
    const scan = document.createElement('div')
    scan.className = 'scan'
    scan.style.setProperty('--dur', DUR + 260 + 'ms')
    root.append(scan)
    setTimeout(() => scan.remove(), DUR + 400)
    setTimeout(() => { if (linkSig) resendLinks() }, DUR + 800) // 动画时按钮挪了一点，播完按最终位置补报
  }

  // 选中后留一个虚线框，直到下次选择 / 页面刷新
  let pinned = null

  function pin(rect, el, text) {
    unpin()
    const { root } = fxRoot()
    const b = document.createElement('div')
    b.className = 'pin'
    const t = document.createElement('span')
    t.textContent = '已选 · ' + text
    b.append(t)
    root.append(b)
    pinned = { node: b, el, rect }
    placePin()
  }

  function placePin() {
    if (!pinned) return
    const r = pinned.el ? (pinned.el.isConnected ? docRect(pinned.el) : null) : pinned.rect
    if (!r) return unpin()
    frame(pinned.node, r, 2, pinned.el ? getComputedStyle(pinned.el).borderTopLeftRadius : '')
  }

  function unpin() {
    if (pinned) pinned.node.remove()
    pinned = null
  }

  addEventListener('resize', placePin)

  // ── 刷新、就绪（和右侧栏的握手） ──────────────────────────────────────────
  //
  // 右侧栏里：页面载完 → hello → 右侧栏回 init（上一帧的滚动位置和指纹）→ 恢复滚动、算出改了哪
  //   → ready → 右侧栏把这一帧淡入换上来 → reveal → 闪改动。
  // 还没换上来的那一帧（shown=false）不理会改动通知，右侧栏会再载一帧。

  let shown = !parentWin
  let booted = false
  let pending = null
  let busy = false

  const seedNow = () => ({ href: location.href, scroll: { x: scrollX, y: scrollY }, sig: snapshot().map })

  function boot(seed) {
    if (booted) return
    booted = true
    const same = seed && seed.href === location.href
    if (same && seed.scroll) scrollTo(seed.scroll.x, seed.scroll.y)
    pending = same && seed.sig ? compare(seed.sig, snapshot()) : null
    const meta = document.querySelector('meta[name="dsh-design"]')
    post({
      type: 'ready',
      title: document.title,
      href: location.href,
      meta: meta ? String(meta.getAttribute('content') || '').slice(0, 80) : '',
      tokens: tokensOf(),
      links: firstLinks(),
      dark: hasDark(),
      changes: pending ? { count: pending.count, whole: pending.whole } : null,
    })
    if (shown) reveal()
  }

  // ── 设计变量：:root / html 上的 CSS 自定义属性（取算出来的值），带出处样式表 ─────
  const MAX_TOKENS = 80

  function tokensOf() {
    const out = []
    const seen = new Set()
    const cs = getComputedStyle(document.documentElement)
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue } // 别的源的样式表读不了
      const href = sheet.href || location.href
      for (const r of rules) {
        if (out.length >= MAX_TOKENS) return out
        if (!r.style || !/(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText || '')) continue
        for (let i = 0; i < r.style.length && out.length < MAX_TOKENS; i++) {
          const name = r.style[i]
          if (!name.startsWith('--') || seen.has(name)) continue
          seen.add(name)
          const value = (cs.getPropertyValue(name) || r.style.getPropertyValue(name)).trim()
          if (value) out.push({ name, value: clip(value, 160), href })
        }
      }
    }
    return out
  }

  // ── 直接改字：点一下文字就地改，回车写回文件 ─────────────────────────────────
  //
  // 改的是指针下面那一个文字节点（临时包一层可编辑的 span）。写回源码靠「这段文字 + 它是第几次出现」：
  // 按文档顺序数前面的文字节点里这段文字出现过几次，服务端在 HTML 的文字部分里数到同一处替换。

  const normWs = (x) => String(x || '').replace(/[\s\u00a0]+/g, ' ').trim()
  const NO_TEXT = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|TEMPLATE|TITLE)$/
  let textEdit = false
  let editUi = null
  let editing = null // { span, node, before, nth }

  function countIn(hay, needle) {
    if (!needle) return 0
    let n = 0
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++
    return n
  }

  /** 这个文字节点前面（文档顺序），同样的文字一共出现过几次 */
  function nthOf(node, want) {
    let n = 0
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t === node) return n
      const p = t.parentElement
      if (!p || NO_TEXT.test(p.tagName)) continue
      n += countIn(normWs(t.data), want)
    }
    return n
  }

  /** 指针下面的文字节点（有字的） */
  function textAt(x, y) {
    let node = null
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y)
      node = r && r.startContainer
    } else if (document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(x, y)
      node = c && c.offsetNode
    }
    if (!node || node.nodeType !== 3 || !normWs(node.data)) return null
    const p = node.parentElement
    if (!p || NO_TEXT.test(p.tagName) || (editUi && editUi.host.contains(p))) return null
    // 指针确实落在这段字上（不是行尾的空白处）
    const range = document.createRange()
    range.selectNodeContents(node)
    const hit = [...range.getClientRects()].some((rc) => x >= rc.left - 2 && x <= rc.right + 2 && y >= rc.top - 2 && y <= rc.bottom + 2)
    return hit ? node : null
  }

  function editMount(hint) {
    if (editUi) return
    const hostEl = document.createElement('dsh-design-edit')
    hostEl.style.setProperty('--k', K)
    const root = hostEl.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>:host{all:initial}
.box{position:fixed;z-index:2147483646;pointer-events:none;display:none;border-radius:3px;border:calc(1.5px * var(--k, 1)) dashed #4d6bfe;background:rgba(77,107,254,.06)}
.hint{position:fixed;left:50%;top:10px;transform:translateX(-50%) scale(var(--k, 1));transform-origin:50% 0;z-index:2147483647;pointer-events:none;padding:6px 12px;border-radius:999px;
background:rgba(20,20,22,.86);color:#e8e8ea;font:12px/18px -apple-system,system-ui,sans-serif;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.25)}</style>
<div class="box"></div><div class="hint">点文字直接改 · 回车保存 · Esc 退出</div>`
    editUi = { host: hostEl, box: root.querySelector('.box'), hint: root.querySelector('.hint') }
    if (!hint) editUi.hint.style.display = 'none'
    document.documentElement.appendChild(hostEl)
  }

  function editUnmount() {
    if (editUi) editUi.host.remove()
    editUi = null
  }

  function editBox(node) {
    if (!editUi) return
    if (!node) { editUi.box.style.display = 'none'; return }
    const range = document.createRange()
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    Object.assign(editUi.box.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 2 + 'px', width: r.width + 6 + 'px', height: r.height + 4 + 'px' })
  }

  function onEditMove(e) {
    if (!textEdit || editing) return
    editBox(textAt(e.clientX, e.clientY))
  }

  function onEditClick(e) {
    if (!textEdit) return
    if (editing && editing.span.contains(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    if (editing) { finishEdit(true); return }
    const node = textAt(e.clientX, e.clientY)
    if (node) beginEdit(node)
  }

  function beginEdit(node) {
    const before = normWs(node.data)
    const nth = nthOf(node, before)
    const span = document.createElement('span')
    span.setAttribute('data-dsh-edit', '')
    span.style.cssText = 'outline:calc(2px * var(--dsh-k, 1)) solid #4d6bfe;outline-offset:2px;border-radius:2px;cursor:text;caret-color:#4d6bfe'
    span.style.setProperty('--dsh-k', K)
    try { span.contentEditable = 'plaintext-only' } catch { span.contentEditable = 'true' }
    if (span.contentEditable !== 'plaintext-only') span.contentEditable = 'true'
    node.parentNode.insertBefore(span, node)
    span.appendChild(node)
    editing = { span, node, before, nth, raw: node.data }
    editBox(null)
    span.focus()
    const sel = getSelection()
    const range = document.createRange()
    range.selectNodeContents(span)
    sel.removeAllRanges()
    sel.addRange(range)
    span.addEventListener('blur', () => finishEdit(true), { once: true })
  }

  /** 收尾：save=true 且改了就报给右侧栏；页面上先换成新字（文件改完会自己刷新） */
  function finishEdit(save) {
    const ed = editing
    if (!ed) return
    editing = null
    const after = normWs(ed.span.innerText)
    const text = document.createTextNode(save && after ? ed.raw.replace(ed.raw.trim(), after) : ed.raw)
    if (ed.span.parentNode) ed.span.parentNode.replaceChild(text, ed.span)
    if (save && after && after !== ed.before) post({ type: 'edited', before: ed.before, after, nth: ed.nth })
  }

  function onEditKey(e) {
    if (!textEdit) return
    if (editing) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(true) }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); post({ type: 'editDone' }) }
  }

  function setTextEdit(on, hint = true) {
    if (on === textEdit) return
    textEdit = on
    if (on) {
      editMount(hint)
      document.documentElement.style.setProperty('cursor', 'text')
      addEventListener('mousemove', onEditMove, true)
      addEventListener('click', onEditClick, true)
      addEventListener('keydown', onEditKey, true)
    } else {
      finishEdit(true)
      document.documentElement.style.removeProperty('cursor')
      removeEventListener('mousemove', onEditMove, true)
      removeEventListener('click', onEditClick, true)
      removeEventListener('keydown', onEditKey, true)
      editUnmount()
    }
  }

  // ── 屏与屏之间的跳转（画布上画连线、演示时点得动）────────────────────────────
  // 认这几种写法：<a href="detail.html">、data-href / data-to、onclick="location.href='detail.html'"
  const LINK_JS = /(?:location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*)['"]([^'"]+)['"]/
  const MAX_LINKS = 60

  /** 这个元素点了会跳到同一个站点的哪一页（路径）；不是跳页的给 '' */
  function linkPath(el) {
    let raw = el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-to') || ''
    if (!raw && el.hasAttribute('onclick')) {
      const m = LINK_JS.exec(el.getAttribute('onclick') || '')
      if (m) raw = m[1]
    }
    raw = raw.trim()
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|sms|data):/i.test(raw)) return ''
    let u
    try { u = new URL(raw, location.href) } catch { return '' }
    if (u.origin !== location.origin || u.pathname === location.pathname) return ''
    try { return decodeURIComponent(u.pathname) } catch { return u.pathname }
  }

  const LINK_SEL = 'a[href], [data-href], [data-to], [onclick]'

  /** 页面里跳到别的屏的地方：路径 + 在视口里的位置（画布上从这里画一条线到那一屏） */
  function linksOf() {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll(LINK_SEL)) {
      if (out.length >= MAX_LINKS) break
      if (host && host.contains(el)) continue
      const p = linkPath(el)
      if (!p) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const cs = getComputedStyle(el)
      // 正在播动画（生成动画、页面自己的淡入）的按钮这会儿透明度是 0，但它是看得见的按钮
      const moving = typeof el.getAnimations === 'function' && el.getAnimations().length > 0
      if (cs.visibility === 'hidden' || cs.display === 'none' || (!moving && Number(cs.opacity) === 0)) continue
      const k = p + '|' + Math.round(r.left / 8) + '|' + Math.round(r.top / 8)
      if (seen.has(k)) continue
      seen.add(k)
      const text = clip(String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim(), 24)
      out.push({ path: p, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text })
    }
    return out
  }

  // DSH（Electron）里跨源 iframe 刚载完时视口可能还是 0×0，尺寸稍后才到：
  // 先报一次，尺寸变了 / 过一会儿再算，位置不一样了就补报（画布连线跟着更新）
  let linkSig = ''
  let linkTimer = 0
  function firstLinks() {
    const links = linksOf()
    linkSig = JSON.stringify(links)
    addEventListener('resize', () => { clearTimeout(linkTimer); linkTimer = setTimeout(resendLinks, 120) })
    setTimeout(resendLinks, 600)
    return links
  }
  function resendLinks() {
    const links = linksOf()
    const sig = JSON.stringify(links)
    if (sig === linkSig) return
    linkSig = sig
    post({ type: 'links', links })
  }

  // 演示：点了跳页的地方，不在 iframe 里直接跳，告诉右侧栏换一屏（带过场动画）
  let demo = false
  addEventListener('click', (e) => {
    if (!demo || picking) return
    const el = e.target && e.target.closest ? e.target.closest(LINK_SEL) : null
    if (!el) return
    const p = linkPath(el)
    if (!p) return
    e.preventDefault()
    e.stopPropagation()
    post({ type: 'nav', path: p })
  }, true)

  /** 换上来了：刚生成的一屏播生成动画，否则闪改动 */
  function reveal(opts) {
    shown = true
    const c = pending
    pending = null
    if (opts && opts.build) buildIn()
    else if (c && c.els.length) setTimeout(() => play(c.els), 60)
    watchHmr()
  }

  // 开发服务器（热更新，不整页刷新）：模型干活时盯着 DOM，变了就比一次指纹
  let mo = null
  let moTimer = null
  let baseline = null
  const ours = (n) => n === host || (fx && n === fx.host)

  function watchHmr() {
    if (cfg.live || !shown || !window.MutationObserver) return
    if (busy && !mo) {
      baseline = snapshot().map
      mo = new MutationObserver((recs) => {
        const real = recs.some((r) => !(ours(r.target) || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(ours))))
        if (!real) return
        clearTimeout(moTimer)
        moTimer = setTimeout(checkHmr, 350)
      })
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    } else if (!busy && mo) {
      // 回合结束后热更新还可能晚到一点，再等 3 秒
      setTimeout(() => {
        if (busy || !mo) return
        mo.disconnect()
        mo = null
        baseline = null
      }, 3000)
    }
  }

  function checkHmr() {
    if (!baseline) return
    const cur = snapshot()
    const c = compare(baseline, cur)
    baseline = cur.map
    if (!c.count) return
    play(c.els)
    post({ type: 'updated', changes: { count: c.count, whole: c.whole } })
  }

  // ── 导出图片：把页面画成 PNG（SVG foreignObject，样式逐个元素内联，图片 / 字体转成 data URL） ──
  // 右侧栏发 { type: 'capture', id, full, scale } → 回 { type: 'captured', id, png: Blob, w, h } 或 { error }

  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'BASE', 'DSH-DESIGN-PICKER', 'DSH-DESIGN-FX'])
  const SKIP_PROP = /^(--|animation|transition|will-change|cursor|pointer-events|user-select|-webkit-user|caret-color|view-transition|content-visibility)/
  const MAX_INLINE = 12 * 1024 * 1024 // 图片 + 字体最多内联这么多字节，再多就跳过（不让导出卡死）
  const XHTML = 'http://www.w3.org/1999/xhtml'
  const SVGNS = 'http://www.w3.org/2000/svg'

  function makeSandbox() {
    const f = document.createElement('iframe')
    f.setAttribute('aria-hidden', 'true')
    f.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;height:600px;border:0;visibility:hidden'
    document.documentElement.appendChild(f)
    const doc = f.contentDocument
    doc.open()
    doc.write('<!doctype html><html><head></head><body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>')
    doc.close()
    const cache = new Map()
    return {
      defaults(el, pseudo) {
        const key = (el.namespaceURI || '') + '|' + el.localName + (pseudo || '')
        let map = cache.get(key)
        if (map) return map
        const d = doc.createElementNS(el.namespaceURI || XHTML, el.localName)
        const parent = el.namespaceURI === SVGNS && el.localName !== 'svg' ? doc.body.firstChild : doc.body
        parent.appendChild(d)
        const cs = f.contentWindow.getComputedStyle(d, pseudo || null)
        map = {}
        for (let i = 0; i < cs.length; i++) map[cs[i]] = cs.getPropertyValue(cs[i])
        d.remove()
        cache.set(key, map)
        return map
      },
      remove() { f.remove() },
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  }

  /** 资源 → data URL；拿不到（跨源、太大、超时）就给 null */
  function makeInliner() {
    const cache = new Map()
    let total = 0
    return (url) => {
      if (!url || url.startsWith('data:')) return Promise.resolve(url || null)
      if (cache.has(url)) return cache.get(url)
      const p = (async () => {
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 8000)
          const res = await fetch(url, { signal: ctrl.signal, credentials: 'same-origin' })
          clearTimeout(timer)
          if (!res.ok) return null
          const blob = await res.blob()
          if (total + blob.size > MAX_INLINE) return null
          total += blob.size
          return await blobToDataUrl(blob)
        } catch { return null }
      })()
      cache.set(url, p)
      return p
    }
  }

  const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

  /** 把一段 CSS 值里的 url(...) 都换成 data URL */
  async function inlineUrls(value, base, inline) {
    if (!value || value.indexOf('url(') < 0) return value
    const jobs = []
    value.replace(URL_RE, (m, q, u) => { jobs.push(u); return m })
    const map = new Map()
    await Promise.all(jobs.map(async (u) => {
      let abs = u
      try { abs = new URL(u, base).href } catch { /* 原样 */ }
      map.set(u, await inline(abs))
    }))
    return value.replace(URL_RE, (m, q, u) => (map.get(u) ? `url("${map.get(u)}")` : 'none'))
  }

  function styleText(cs, def, out) {
    let s = ''
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i]
      if (SKIP_PROP.test(p)) continue
      const v = cs.getPropertyValue(p)
      if (v === def[p]) continue
      if (out && v.indexOf('url(') >= 0) out.push(p)
      s += `${p}:${v};`
    }
    return s
  }

  /** 元素里直接有字，而且整个元素的内容都在一行里（子元素的字也算） */
  function oneLine(el) {
    let text = false
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) { text = true; break }
    if (!text) return false
    const r = document.createRange()
    r.selectNodeContents(el)
    const rects = [...r.getClientRects()].filter((x) => x.width && x.height)
    if (!rects.length || rects.length > 40) return false
    const a = rects[0]
    return rects.every((x) => x.top < a.bottom - 1 && x.bottom > a.top + 1)
  }

  function canvasColor() {
    const bg = (e) => {
      if (!e) return ''
      const c = getComputedStyle(e).backgroundColor
      return !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) ? '' : c
    }
    const de = document.documentElement
    return bg(de) || bg(document.body) || (/dark/.test(getComputedStyle(de).colorScheme) ? '#121212' : '#fff')
  }

  async function capture(opts) {
    const full = !!opts.full
    const scale = Math.min(3, Math.max(1, Number(opts.scale) || 2))
    const de = document.documentElement
    const W = Math.ceil(de.clientWidth || innerWidth)
    const H = Math.ceil(full ? Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight) : innerHeight)
    const box = makeSandbox()
    const inline = makeInliner()
    const pseudoRules = []
    const families = new Set()
    const jobs = []
    let seq = 0

    function walk(node) {
      if (node.nodeType === 3) return document.createTextNode(node.nodeValue)
      if (node.nodeType !== 1) return null
      const el = node
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) return null
      if (el.tagName === 'STYLE' && el.namespaceURI !== SVGNS) return null
      const cs = getComputedStyle(el)
      if (cs.display === 'none' && el.namespaceURI !== SVGNS) return null

      let c
      const tag = el.tagName
      if (tag === 'CANVAS') {
        c = document.createElementNS(XHTML, 'img')
        try { c.setAttribute('src', el.toDataURL()) } catch { /* 被污染的画布 */ }
      } else if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'OBJECT' || tag === 'EMBED') {
        c = document.createElementNS(XHTML, 'div')
      } else {
        c = el.namespaceURI === SVGNS ? document.createElementNS(SVGNS, el.localName) : document.createElementNS(XHTML, el.localName)
        for (const a of el.attributes) {
          if (a.name === 'style' || a.name.startsWith('on') || a.name === 'class' && el.namespaceURI !== SVGNS) continue
          if (a.name === 'srcset' || a.name === 'sizes' || a.name === 'loading') continue
          try { c.setAttributeNS(a.namespaceURI, a.name, a.value) } catch { /* 怪属性名 */ }
        }
      }
      if (el.namespaceURI === SVGNS && el.getAttribute('class')) c.setAttribute('class', el.getAttribute('class'))

      const withUrls = []
      const def = box.defaults(el)
      let st = styleText(cs, def, withUrls)
      if (el === de) st += 'overflow:hidden;'
      // 原来一行放得下的字，画成图时也别折行（宽度是定死的，字体渲染差一丁点就会挤到第二行）
      if (el.namespaceURI !== SVGNS && cs.whiteSpace !== 'nowrap' && oneLine(el)) st += 'white-space:nowrap;'
      c.setAttribute('style', st)
      families.add(cs.fontFamily)
      if (withUrls.length) {
        jobs.push((async () => {
          let s = c.getAttribute('style')
          for (const p of withUrls) {
            const v = cs.getPropertyValue(p)
            s = s.replace(`${p}:${v};`, `${p}:${await inlineUrls(v, location.href, inline)};`)
          }
          c.setAttribute('style', s)
        })())
      }

      if (tag === 'IMG' && (el.currentSrc || el.src)) {
        const src = el.currentSrc || el.src
        jobs.push(inline(src).then((d) => { if (d) c.setAttribute('src', d); else c.removeAttribute('src') }))
      }
      if (el.namespaceURI === SVGNS && el.localName === 'image') {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        if (href) jobs.push(inline(new URL(href, location.href).href).then((d) => { if (d) c.setAttribute('href', d) }))
      }
      if (tag === 'INPUT') {
        if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', '') } else c.setAttribute('value', el.value)
      }
      if (tag === 'TEXTAREA') c.textContent = el.value
      if (tag === 'SELECT') c.setAttribute('data-v', el.value)

      // ::before / ::after
      if (el.namespaceURI !== SVGNS) {
        const pes = (tag === 'INPUT' || tag === 'TEXTAREA') && el.getAttribute('placeholder') ? ['::before', '::after', '::placeholder'] : ['::before', '::after']
        for (const pe of pes) {
          const ps = getComputedStyle(el, pe)
          const content = ps.getPropertyValue('content')
          if (pe !== '::placeholder' && (!content || content === 'none' || content === 'normal')) continue
          const cls = 'ddpx' + (++seq)
          c.setAttribute('class', ((c.getAttribute('class') || '') + ' ' + cls).trim())
          const urls = []
          const body = styleText(ps, box.defaults(el, pe), urls)
          const i = pseudoRules.length
          pseudoRules.push(`.${cls}${pe}{${body}}`)
          if (urls.length) jobs.push(inlineUrls(pseudoRules[i], location.href, inline).then((t) => { pseudoRules[i] = t }))
        }
      }

      if (tag === 'IFRAME' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'TEXTAREA') return c
      for (const child of el.childNodes) {
        const k = walk(child)
        if (k) c.appendChild(k)
      }
      if (tag === 'SELECT') {
        const o = el.selectedOptions && el.selectedOptions[0]
        c.textContent = ''
        const opt = document.createElementNS(XHTML, 'option')
        opt.textContent = o ? o.textContent : ''
        c.appendChild(opt)
      }
      return c
    }

    try {
      const root = walk(de)
      // 字体：页面样式表里的 @font-face，只带用到的字族
      const faces = []
      const used = [...families].join(',').toLowerCase()
      for (const sheet of document.styleSheets) {
        let rules
        try { rules = sheet.cssRules } catch { continue }
        const base = sheet.href || location.href
        const scan = (list) => {
          for (const r of list) {
            if (r.cssRules && !(r instanceof CSSFontFaceRule)) { try { scan(r.cssRules) } catch { /* 读不了 */ } continue }
            if (!(r instanceof CSSFontFaceRule)) continue
            const fam = (r.style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim().toLowerCase()
            if (fam && used.includes(fam)) faces.push(inlineUrls(r.cssText, base, inline))
          }
        }
        scan(rules)
      }
      await Promise.all(jobs)
      const fontCss = (await Promise.all(faces)).join('\n')
      const style = document.createElementNS(XHTML, 'style')
      style.textContent = fontCss + '\n' + pseudoRules.join('\n') + '\n*::-webkit-scrollbar{display:none}'
      const body = [...root.childNodes].find((n) => n.localName === 'body')
      ;(body || root).insertBefore(style, (body || root).firstChild)
      if (!full && (scrollX || scrollY) && body) {
        body.setAttribute('style', body.getAttribute('style') + `transform:translate(${-scrollX}px,${-scrollY}px);`)
      }
      const xml = new XMLSerializer().serializeToString(root)
      const svg = `<svg xmlns="${SVGNS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`
      const img = new Image()
      img.decoding = 'sync'
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(W * scale)
      canvas.height = Math.round(H * scale)
      const ctx = canvas.getContext('2d')
      // 页面底色：浏览器会把 html / body 的背景铺满整个窗口，画成图时 body 下面那截要自己补上（深色页面不然底下一截是白的）
      ctx.fillStyle = canvasColor()
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const png = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png'))
      return { png, w: W, h: H, scale }
    } finally {
      box.remove()
    }
  }

  async function onCapture(d) {
    try {
      const r = await capture(d)
      post({ type: 'captured', id: d.id, png: r.png, w: r.w, h: r.h, scale: r.scale, title: document.title })
    } catch (e) {
      post({ type: 'captured', id: d.id, error: String((e && e.message) || e) })
    }
  }

  // ── 深色模式：页面带了深色样式（[data-theme="dark"] / .dark / prefers-color-scheme: dark）就能切 ──

  let darkOn = false
  let darkPrev = null

  function darkRules() {
    const media = []
    let attr = false
    const scan = (list) => {
      for (const r of list) {
        if (r.media && /prefers-color-scheme\s*:\s*dark/i.test(r.media.mediaText || '')) {
          for (const x of r.cssRules) media.push(x.cssText)
          continue
        }
        if (r.selectorText && /\[data-theme=["']?dark|\.dark\b|\[data-mode=["']?dark/i.test(r.selectorText)) attr = true
        if (r.cssRules && !r.media) { try { scan(r.cssRules) } catch { /* 读不了 */ } }
      }
    }
    for (const sheet of document.styleSheets) {
      try { scan(sheet.cssRules) } catch { /* 别的源 */ }
    }
    return { media, attr }
  }

  function hasDark() {
    const r = darkRules()
    return r.attr || r.media.length > 0
  }

  function setDark(on) {
    on = !!on
    if (on === darkOn) return
    darkOn = on
    const de = document.documentElement
    let tag = document.getElementById('__dsh_design_dark__')
    if (on) {
      darkPrev = { theme: de.getAttribute('data-theme'), mode: de.getAttribute('data-mode'), cls: de.classList.contains('dark') }
      de.setAttribute('data-theme', 'dark')
      de.setAttribute('data-mode', 'dark')
      de.classList.add('dark')
      if (!tag) {
        tag = document.createElement('style')
        tag.id = '__dsh_design_dark__'
        ;(document.head || de).appendChild(tag)
      }
      tag.textContent = ':root{color-scheme:dark}\n' + darkRules().media.join('\n')
    } else {
      if (darkPrev) {
        if (darkPrev.theme == null) de.removeAttribute('data-theme'); else de.setAttribute('data-theme', darkPrev.theme)
        if (darkPrev.mode == null) de.removeAttribute('data-mode'); else de.setAttribute('data-mode', darkPrev.mode)
        if (!darkPrev.cls) de.classList.remove('dark')
      }
      if (tag) tag.remove()
    }
  }

  addEventListener('message', (e) => {
    if (!parentWin || e.source !== parentWin || !parentOrigins.includes(e.origin)) return
    const d = e.data
    if (!d || d.dshDesign !== 1) return
    if (d.type === 'pick') start(d.hint !== false)
    else if (d.type === 'cancel') stop(true)
    else if (d.type === 'init') boot(d.seed || null)
    else if (d.type === 'reveal') reveal(d)
    else if (d.type === 'zoom') setK(1 / (Number(d.z) || 1))
    else if (d.type === 'snapshot') post({ type: 'snap', seed: seedNow() })
    else if (d.type === 'busy') { busy = !!d.on; watchHmr() }
    else if (d.type === 'unpin') unpin()
    else if (d.type === 'reload') selfReload()
    else if (d.type === 'capture') onCapture(d)
    else if (d.type === 'theme') setDark(d.dark)
    else if (d.type === 'demo') demo = !!d.on
    else if (d.type === 'edit') setTextEdit(!!d.on, d.hint !== false)
  })

  function selfReload() {
    try { sessionStorage.setItem(SEED_KEY, JSON.stringify({ ...seedNow(), at: Date.now() })) } catch { /* 隐私模式 / 太大 */ }
    location.reload()
  }

  function onLoad() {
    if (parentWin) {
      post({ type: 'hello', href: location.href })
      setTimeout(() => boot(null), 1500) // 右侧栏没回话（老版本 / 不在 DSH 里）也照常就绪
      return
    }
    let seed = null
    try {
      seed = JSON.parse(sessionStorage.getItem(SEED_KEY) || 'null')
      sessionStorage.removeItem(SEED_KEY)
      if (seed && Date.now() - seed.at > 15000) seed = null
    } catch { seed = null }
    boot(seed)
  }

  if (document.readyState === 'complete') onLoad()
  else addEventListener('load', onLoad, { once: true })

  // 页面自己整页刷新（开发服务器的 full reload、点了页面里的链接）：把当前的指纹交给右侧栏，下一帧拿来比
  addEventListener('pagehide', () => {
    if (parentWin && shown && busy) post({ type: 'bye', seed: seedNow() })
  })

  /** 这一页在目录里的相对路径（/ 结尾的当 index.html） */
  function selfRel() {
    let p = ''
    try { p = decodeURIComponent(location.pathname) } catch { p = location.pathname }
    p = p.replace(/^\/+/, '')
    if (!p || p.endsWith('/')) p += 'index.html'
    return p
  }

  /** 改的全是别的 HTML 页面（画布里另一屏）→ 跟这一页没关系，不用刷新 */
  function othersOnly(files) {
    if (!Array.isArray(files) || !files.length) return false
    const me = selfRel()
    return files.every((f) => /\.html?$/i.test(f) && String(f).replace(/\\/g, '/') !== me)
  }

  // 旧版本（/__dsh_design__/v/…）只读，不跟着目录改动刷新
  if (cfg.live && window.EventSource && !location.pathname.startsWith('/__dsh_design__/v/')) {
    const es = new EventSource('/__dsh_design__/events')
    es.addEventListener('change', (e) => {
      if (!shown) return
      let file = ''
      let files = null
      try {
        const d = JSON.parse(e.data)
        file = d.file || ''
        files = d.files || null
      } catch { /* 没带文件名 */ }
      if (othersOnly(files)) return
      if (parentWin) post({ type: 'changed', file, seed: seedNow() })
      else selfReload()
    })
  }
})()
