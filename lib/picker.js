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
  // 远程看（右侧栏把这一屏打包放进沙盒 iframe 的 srcdoc，location 是 about:srcdoc）：这一屏原本的地址由右侧栏给
  const HERE = cfg.remote && typeof cfg.href === 'string' ? cfg.href : ''
  const here = () => HERE || location.href
  const hereUrl = () => { try { return new URL(here()) } catch { return location } }
  /** 样式表从哪来：打包时内联成 <style data-href> 的，按原来的文件算 */
  const sheetHref = (sheet) => {
    if (sheet.href) return sheet.href
    const o = sheet.ownerNode
    const d = o && o.getAttribute ? o.getAttribute('data-href') : ''
    if (d && HERE) { try { return new URL(d, HERE).href } catch { /* 用这一页 */ } }
    return here()
  }

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
    if (down && !styleOn && (dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)) {
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
    if (styleOn) {
      // 调样式：选中它（留虚线框），接着还能点别的
      const el = under(e.clientX, e.clientY)
      if (!el || el === document.body) return
      styleSelect(el)
      post({ type: 'stylePick', payload: { ...styleInfo(el), href: here() } })
      return
    }
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
    post({ type: 'picked', payload: { ...payload, href: here(), title: document.title, viewport: { w: innerWidth, h: innerHeight } } })
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
    if (!styleOn) unpin()
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
      post({ type: 'cancelled', style: styleOn }) // style：调样式里按了 Esc（右侧栏退出调样式）
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
.ck{position:absolute;pointer-events:none;border:calc(2px * var(--k, 1)) solid #f59e0b;border-radius:4px;background:rgba(245,158,11,.08)}
.ck.hi{border-color:#e5484d;background:rgba(229,72,77,.08)}
.ck b{position:absolute;left:calc(-9px * var(--k, 1));top:calc(-9px * var(--k, 1));min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;
  background:#f59e0b;color:#fff;font:700 11px/18px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;text-align:center;
  transform:scale(var(--k, 1));transform-origin:0 0;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.ck.hi b{background:#e5484d}
.ck.on{animation:ck-on 1.2s ease-out}
@keyframes ck-on{0%,40%{box-shadow:0 0 0 calc(6px * var(--k, 1)) rgba(229,72,77,.35)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}
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

  const seedNow = () => ({ href: here(), scroll: { x: scrollX, y: scrollY }, sig: snapshot().map })

  function boot(seed) {
    if (booted) return
    booted = true
    const same = seed && seed.href === here()
    if (same && seed.scroll) scrollTo(seed.scroll.x, seed.scroll.y)
    pending = same && seed.sig ? compare(seed.sig, snapshot()) : null
    const meta = document.querySelector('meta[name="dsh-design"]')
    post({
      type: 'ready',
      title: document.title,
      href: here(),
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
      const href = sheetHref(sheet)
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

  // ── 调样式：点一个元素选中，右侧栏拖滑块时先改在它的 inline style 上看效果 ───────────────
  //
  // 写回文件由右侧栏交给服务端：按「第几个这种标签 + id + 类」在源码里找到开头标签，并进 style 属性。
  // 没写回就换一个元素 / 退出：改过的样式还原。

  let styleOn = false
  let styleEl = null
  let styleOrig = null // 选中时 style 属性的原样（null = 原来没有）

  const STYLE_KEYS = ['font-size', 'font-weight', 'color', 'background', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap']

  /** 这些属性在样式表里是不是用设计变量写的（按出现顺序取最后一条，不算优先级，只用来在面板上标出来） */
  function varsOf(el) {
    const out = {}
    const scan = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) {
          if (!r.media || matchMedia(r.media.mediaText).matches) scan(r.cssRules)
          continue
        }
        if (!r.style || !r.selectorText) continue
        let hit = false
        try { hit = el.matches(r.selectorText) } catch { hit = false }
        if (!hit) continue
        take(r.style)
      }
    }
    const take = (style) => {
      for (const k of STYLE_KEYS) {
        const raw = style.getPropertyValue(k) || (k === 'background' ? style.getPropertyValue('background-color') : '') ||
          (k.startsWith('padding-') ? style.getPropertyValue('padding') : '')
        if (!raw) continue
        const m = /var\(\s*(--[\w-]+)/.exec(raw)
        if (m) out[k] = m[1]
        else delete out[k]
      }
    }
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      scan(rules)
    }
    if (el.getAttribute('style')) take(el.style)
    return out
  }

  // ── 每项样式现在是哪条规则给的（〔调样式〕交给模型时带上规则和文件行号，模型不用再 grep） ──

  /** 选择器列表按顶层的逗号拆开（括号、方括号里的逗号不算） */
  function splitList(s) {
    const out = []
    let depth = 0
    let cur = ''
    for (const ch of String(s)) {
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      if (ch === ',' && !depth) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  /** 优先级（近似）：id × 1e6 + 类 / 属性 / 伪类 × 1e3 + 标签 / 伪元素；:where() 不算，:is / :not / :has 取括号里最高的那个分支 */
  function specOf(sel) {
    let extra = 0
    let s = String(sel).replace(/"[^"]*"|'[^']*'/g, '""').replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
    s = s.replace(/:(?:is|not|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => { extra += Math.max(0, ...splitList(inner).map(specOf)); return '' })
    const a = (s.match(/#[\w-]+/g) || []).length
    const b = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length
    const c = (s.replace(/\[[^\]]*\]|\([^()]*\)/g, '').match(/(?:^|[\s>+~,])[a-z][\w-]*|::[\w-]+/gi) || []).length
    return a * 1e6 + b * 1e3 + c + extra
  }
  // 面板上的几项各看哪些写法（简写也算）
  const LONGHANDS = {
    'font-size': ['font-size', 'font'], 'font-weight': ['font-weight', 'font'], color: ['color'], background: ['background', 'background-color'],
    'border-radius': ['border-radius', 'border-top-left-radius'], gap: ['gap', 'row-gap', 'column-gap'],
    'padding-top': ['padding', 'padding-top'], 'padding-right': ['padding', 'padding-right'], 'padding-bottom': ['padding', 'padding-bottom'], 'padding-left': ['padding', 'padding-left'],
  }
  /**
   * 每项样式（STYLE_KEYS）现在由哪条规则决定：按 !important、优先级、先后挑出胜出的那条，
   * 给 { sel, href, n }（n：同一份样式表里同样选择器的第几条，服务端按它在源码里找行号）；
   * 元素上的行内 style 盖过它就是 { inline: true, ...被盖过的那条 }。只看生效的 @media；层（@layer）不细算
   */
  function rulesOf(el) {
    const best = {}
    let order = 0
    // maybe：在 @layer / @container 这类没细算的块里，结论只是「大概」
    const scan = (rules, href, counts, active, maybe) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) {
          let on = active
          let unsure = maybe
          if (r.media) on = on && matchMedia(r.media.mediaText).matches
          else if (typeof CSSSupportsRule !== 'undefined' && r instanceof CSSSupportsRule) on = on && CSS.supports(r.conditionText)
          else unsure = true
          scan(r.cssRules, href, counts, on, unsure)
          continue
        }
        if (!r.style || !r.selectorText) continue
        const n = counts.get(r.selectorText) || 0
        counts.set(r.selectorText, n + 1)
        order++
        if (!active) continue
        let spec = -1
        for (const part of splitList(r.selectorText)) {
          try { if (el.matches(part)) spec = Math.max(spec, specOf(part)) } catch { /* 浏览器不认的选择器 */ }
        }
        if (spec < 0) continue
        for (const k of STYLE_KEYS) {
          for (const L of LONGHANDS[k] || [k]) {
            if (!r.style.getPropertyValue(L)) continue
            const imp = r.style.getPropertyPriority(L) === 'important'
            const b = best[k]
            if (!b || imp > b.imp || (imp === b.imp && (spec > b.spec || (spec === b.spec && order >= b.order)))) best[k] = { sel: r.selectorText, href, n, imp, spec, order, maybe }
            break
          }
        }
      }
    }
    // 页面里的几段 <style> 合起来数（服务端在整个 HTML 里按第几条找）；外链的样式表各数各的（同一个文件引了两次也不累加）
    const countsOf = new Map()
    for (const sheet of document.styleSheets) {
      if (sheet.disabled) continue
      const mq = sheet.media && sheet.media.mediaText
      if (mq && !matchMedia(mq).matches) continue // media="print" 这种
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const href = sheetHref(sheet)
      const own = sheet.ownerNode
      const external = !!sheet.href || !!(own && own.getAttribute && own.getAttribute('data-href'))
      if (!external && !countsOf.has(href)) countsOf.set(href, new Map())
      scan(rules, href, external ? new Map() : countsOf.get(href), true, false)
    }
    const out = {}
    for (const k of STYLE_KEYS) {
      const b = best[k]
      const inl = (LONGHANDS[k] || [k]).find((L) => el.style.getPropertyValue(L))
      if (inl && (!b || !b.imp || el.style.getPropertyPriority(inl) === 'important')) out[k] = { inline: true, ...(b ? { sel: clip(b.sel, 200), href: b.href, n: b.n } : {}) }
      else if (b) out[k] = { sel: clip(b.sel, 200), href: b.href, n: b.n, ...(b.maybe ? { maybe: true } : {}) }
    }
    return out
  }

  /** 右侧栏要的：名字、选择器、源码里怎么找到它（loc）、现在的几项样式、它们各来自哪条规则 */
  function styleInfo(el) {
    const cs = getComputedStyle(el)
    const tag = el.tagName.toLowerCase()
    const same = [...document.getElementsByTagName(tag)]
    const css = {}
    for (const k of STYLE_KEYS) css[k] = k === 'background' ? cs.backgroundColor : k === 'border-radius' ? cs.borderTopLeftRadius : cs.getPropertyValue(k)
    return {
      name: nameOf(el),
      selector: cssPath(el),
      text: textOf(el),
      loc: { tag, n: same.indexOf(el), total: same.length, id: el.getAttribute('id') || '', cls: [...el.classList] },
      css,
      vars: varsOf(el),
      rules: rulesOf(el),
      gradient: cs.backgroundImage !== 'none',
      layout: /flex|grid/.test(cs.display),
    }
  }

  function styleRevert() {
    if (!styleEl) return
    if (styleOrig === null) styleEl.removeAttribute('style')
    else styleEl.setAttribute('style', styleOrig)
  }

  function styleSelect(el) {
    if (el === styleEl) return
    styleRevert()
    styleEl = el
    styleOrig = el ? el.getAttribute('style') : null
    if (el) pin(null, el, nameOf(el))
    else unpin()
  }

  /** css：属性 → 值（这次一共改了哪些）；每次从原样重来，去掉的那项就回去了 */
  function styleApply(css) {
    if (!styleEl) return
    styleRevert()
    for (const [k, v] of Object.entries(css || {})) {
      if (!STYLE_KEYS.includes(k) || typeof v !== 'string' || !v) continue
      styleEl.style.setProperty(k, v)
    }
    placePin()
  }

  /** 收起选取层，不通知右侧栏（模式是右侧栏自己切的） */
  function quietStop() {
    if (!picking) return
    picking = false
    removeEventListener('keydown', onKey, true)
    unmount()
  }

  /** 右侧栏说选哪个（新载的一帧、换了一屏）：已经选着一个对得上的就不动 */
  function onStyleSel(selector) {
    if (!styleOn) return
    let el = null
    try {
      if (selector && styleEl && styleEl.isConnected && styleEl.matches(selector)) return
      el = selector ? document.querySelector(selector) : null
    } catch { el = null }
    styleSelect(el)
  }

  function setStyleMode(on) {
    if (on === styleOn) return
    if (on) {
      if (textEdit) setTextEdit(false)
      quietStop()
      styleOn = true
      start(false)
    } else {
      styleOn = false
      styleSelect(null)
      quietStop()
    }
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
    if (save && after && after !== ed.before) post({ type: 'edited', before: ed.before, after, nth: ed.nth, href: here() })
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
    if (on && styleOn) setStyleMode(false)
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
    try { u = new URL(raw, here()) } catch { return '' }
    const me = hereUrl()
    if (u.origin !== me.origin || u.pathname === me.pathname) return ''
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
  // 远程看也是：沙盒里的页面跳不过去（地址指着电脑本机），由右侧栏打包那一页换上来
  let demo = false
  addEventListener('click', (e) => {
    if ((!demo && !HERE) || picking) return
    const el = e.target && e.target.closest ? e.target.closest(LINK_SEL) : null
    if (!el) return
    const p = linkPath(el)
    if (!p) {
      const raw = String(el.getAttribute('href') || '').trim()
      if (HERE && raw.startsWith('#')) { e.preventDefault(); jumpTo(raw) }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    post({ type: 'nav', path: p })
  }, true)

  /** 页内锚点（远程看时 <base> 指着原地址，#xx 会被当成跳到别的页面） */
  function jumpTo(hash) {
    let id = String(hash || '').replace(/^#/, '')
    try { id = decodeURIComponent(id) } catch { /* 原样 */ }
    const t = id ? document.getElementById(id) || document.getElementsByName(id)[0] : null
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (!id || id === 'top') scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 远程看：脚本里跳页（location.href = 'x.html'、表单提交）也拦下来
  if (HERE && window.navigation && typeof navigation.addEventListener === 'function') {
    navigation.addEventListener('navigate', (e) => {
      if (!e.cancelable || e.navigationType === 'traverse' || e.downloadRequest) return
      let u
      try { u = new URL(e.destination.url) } catch { return }
      const me = hereUrl()
      if (u.origin !== me.origin) return // 外网地址：随它
      e.preventDefault()
      if (u.pathname === me.pathname) { if (u.hash) jumpTo(u.hash); return }
      let p = u.pathname
      try { p = decodeURIComponent(p) } catch { /* 原样 */ }
      post({ type: 'nav', path: p })
    })
  }

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
    if (cfg.live || HERE || !shown || !window.MutationObserver) return // 远程看：文件改了右侧栏重新打包
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
  // 右侧栏发 { type: 'capture', id, full, scale } → 回 { type: 'captured', id, png: Blob, w, h, links } 或 { error }
  // links：页面里跳到别的屏的地方，坐标换算到这张图上（导出 PDF / PPT 时做成能点的跳转）

  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'BASE', 'DSH-DESIGN-PICKER', 'DSH-DESIGN-FX', 'DSH-DESIGN-PROBE'])
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
    if (!doc) { f.remove(); return shadowSandbox() } // 远程看（页面在沙盒 iframe 里）：再建的 iframe 是另一个不透明的源，进不去
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

  /** 量默认样式的另一种办法：关闭的 shadow root 里放一个元素（页面样式进不来；宿主 all: initial，继承的属性也是初始值） */
  function shadowSandbox() {
    const host = document.createElement('dsh-design-probe')
    host.style.cssText = 'all:initial;position:fixed;left:-99999px;top:0;width:800px;height:600px;visibility:hidden'
    document.documentElement.appendChild(host)
    const root = host.attachShadow({ mode: 'closed' })
    const body = document.createElement('div')
    root.appendChild(body)
    const svg = document.createElementNS(SVGNS, 'svg')
    body.appendChild(svg)
    const cache = new Map()
    return {
      defaults(el, pseudo) {
        const key = (el.namespaceURI || '') + '|' + el.localName + (pseudo || '')
        let map = cache.get(key)
        if (map) return map
        const d = document.createElementNS(el.namespaceURI || XHTML, el.localName)
        ;(el.namespaceURI === SVGNS && el.localName !== 'svg' ? svg : body).appendChild(d)
        const cs = getComputedStyle(d, pseudo || null)
        map = {}
        for (let i = 0; i < cs.length; i++) map[cs[i]] = cs.getPropertyValue(cs[i])
        d.remove()
        cache.set(key, map)
        return map
      },
      remove() { host.remove() },
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
            s = s.replace(`${p}:${v};`, `${p}:${await inlineUrls(v, here(), inline)};`)
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
        if (href) jobs.push(inline(new URL(href, here()).href).then((d) => { if (d) c.setAttribute('href', d) }))
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
          if (urls.length) jobs.push(inlineUrls(pseudoRules[i], here(), inline).then((t) => { pseudoRules[i] = t }))
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
        const base = sheetHref(sheet)
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
      // 整页图从文档顶上画起，链接加上滚动距离；只截视口时就是视口里的位置
      const links = linksOf().map((l) => (d.full ? { ...l, x: l.x + scrollX, y: l.y + scrollY } : l))
        .filter((l) => l.x < r.w && l.y < r.h && l.x + l.w > 0 && l.y + l.h > 0)
      post({ type: 'captured', id: d.id, png: r.png, w: r.w, h: r.h, scale: r.scale, title: document.title, links })
    } catch (e) {
      post({ type: 'captured', id: d.id, error: String((e && e.message) || e) })
    }
  }

  // ── 设计体检：在画好的页面上实测常见毛病，标在页面上，报给右侧栏（给人看的文字由右侧栏按界面语言拼） ──
  //
  //   hscroll 超出屏幕（会横向滚动 / 被切掉） · clipped 文字被截断 · overflow 文字超出框 · overlap 文字叠在一起
  //   contrast 对比度不够 · tap 点击区太小 · tiny 字太小 · img 图片没加载出来 · fonts 字号太杂
  //   covered 被固定栏压住（滚到底也看不全） · tight 离固定栏太近 · jserr 页面脚本报错 · missing 样式表 / 脚本 / 字体没载出来
  // 有意为之的不报：省略号（text-overflow: ellipsis）、行数截断（line-clamp）、可以滚动的区域（轮播）、很淡的装饰大字。

  const CHECK_PER = 8 // 每类最多报几条
  const CHECK_MAX = 40
  const CHECK_ATOMS = 600 // 最多看多少个带字的元素
  const CLICKABLE = 'a[href],button,[role="button"],[role="tab"],[role="link"],input:not([type="hidden"]),select,textarea,summary,[onclick],[data-href]'
  let checkMarks = []

  const isOurs = (el) => SIG_SKIP.has(el.tagName)
  function hiddenChain(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || +cs.opacity === 0) return true
    }
    return false
  }
  function animating(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      try { if (e.getAnimations().some((a) => a.playState === 'running')) return true } catch { return false }
    }
    return false
  }
  function opacityChain(el, stop) {
    let o = 1
    for (let e = el; e && e.nodeType === 1 && e !== stop; e = e.parentElement) o *= +getComputedStyle(e).opacity
    return o
  }

  /** 'rgb(1, 2, 3)' / 'rgba(1, 2, 3, .5)' / 'color(srgb …)' → [r, g, b, a]；别的写法（oklch 之类浏览器已经换算过）认不出就 null */
  function rgba(s) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]]
    const c = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (c) return [c[1] * 255, c[2] * 255, c[3] * 255, c[4] == null ? 1 : c[4].endsWith('%') ? parseFloat(c[4]) / 100 : +c[4]]
    return null
  }
  const over = (top, under) => {
    const a = top[3]
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]
  }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

  const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED'])
  /**
   * 字背后的底色：从字往下一层层叠背景色，遇到不透明的为止；中间有背景图、渐变、图片视频就说不准，返回 null。
   * 字在屏幕里时按实际叠放顺序找（字下面压着的可能不是祖先，比如首屏背景视频）；不在屏幕里就顺着祖先找
   */
  function backdrop(el, pt) {
    let chain = null
    if (pt && pt.x >= 0 && pt.y >= 0 && pt.x < innerWidth && pt.y < innerHeight) {
      const stack = document.elementsFromPoint(pt.x, pt.y)
      const i = stack.indexOf(el)
      if (i >= 0) chain = stack.slice(i)
    }
    if (!chain) { chain = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) chain.push(e) }
    const layers = []
    let base = null
    for (const e of chain) {
      if (isOurs(e)) continue
      if (MEDIA.has(e.tagName) || (e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg')) return null
      const cs = getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = rgba(cs.backgroundColor)
      if (!c) return null
      if (c[3] > 0) {
        if (c[3] >= 0.999) { base = c; break }
        layers.push(c)
      }
    }
    if (!base) {
      if (darkOn) return null // 深色模式下画布底色不一定是白的
      base = [255, 255, 255, 1]
    }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
    return { color: base }
  }

  /** 自己那几段文字在屏幕上的矩形（每行一块） */
  function textRects(el) {
    const out = []
    const rg = document.createRange()
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue
      rg.selectNodeContents(n)
      for (const r of rg.getClientRects()) {
        if (r.width >= 1 && r.height >= 1) out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom })
        if (out.length >= 24) return out
      }
    }
    return out
  }

  /** 最近的一个会裁掉内容的祖先（overflow: hidden / clip），和它是不是能滚 */
  function clipperOf(el) {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const ox = cs.overflowX, oy = cs.overflowY
      if (/auto|scroll/.test(ox) || /auto|scroll/.test(oy)) return { el: e, scroll: true }
      if (/hidden|clip/.test(ox) || /hidden|clip/.test(oy)) return { el: e, scroll: false, x: /hidden|clip/.test(ox), y: /hidden|clip/.test(oy) }
    }
    return null
  }

  // ── 固定栏：贴着视口上 / 下边、横着铺开的固定 / 吸顶吸底 / 绝对定位的块（顶栏、Tab 栏、底部按钮条） ──

  const BAR_MAX = 0.4 // 栏最高占视口的这么多
  const se = () => document.scrollingElement || document.documentElement

  /** 能上下滚的地方：页面本身，和里面 overflow 是 auto / scroll 的区域（App 常把内容放在一个能滚的 main 里） */
  function scrollAreas() {
    const out = []
    if (se().scrollHeight > innerHeight + 1) out.push(se())
    const all = document.body.getElementsByTagName('*')
    for (let i = 0; i < all.length && out.length < 20; i++) {
      const el = all[i]
      if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < 40 || isOurs(el)) continue
      if (/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) out.push(el)
    }
    return out
  }
  /** 都滚到顶 / 底（instant：页面写了 scroll-behavior: smooth 也一下到位） */
  function scrollAll(areas, end) {
    for (const el of areas) {
      const top = end ? el.scrollHeight : 0
      if (el === se()) scrollTo({ left: scrollX, top, behavior: 'instant' })
      else el.scrollTo({ left: el.scrollLeft, top, behavior: 'instant' })
    }
  }

  function barsAt(edge) {
    const out = []
    const vw = innerWidth, vh = innerHeight
    const all = document.body.getElementsByTagName('*')
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      if (isOurs(el)) continue
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue
      if (out.some((b) => b.el.contains(el))) continue // 栏里面的东西
      const r = el.getBoundingClientRect()
      if (r.width < vw * 0.5 || r.height < 16 || r.height > vh * BAR_MAX) continue
      if (edge === 'bottom' ? Math.abs(r.bottom - vh) > 2 : Math.abs(r.top) > 2) continue
      if (hiddenChain(el)) continue
      out.push({ el, r, pos, edge })
    }
    return out
  }

  /** 这一点上最上面那个元素（我们自己画的框不算） */
  const topAt = (x, y) => {
    const cx = Math.max(0, Math.min(innerWidth - 1, x)), cy = Math.max(0, Math.min(innerHeight - 1, y))
    for (const e of document.elementsFromPoint(cx, cy)) if (!isOurs(e)) return e
    return null
  }
  /** 栏在这一点是不是不透明的（有底色 / 背景图 / 毛玻璃，或者压着的是栏里的字、图标） */
  function barSolid(top, bar) {
    if (top !== bar && (MEDIA.has(top.tagName) || top instanceof SVGElement || ownText(top))) return true
    for (let e = top; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const c = rgba(cs.backgroundColor)
      if ((c && c[3] > 0.5) || (cs.backgroundImage && cs.backgroundImage !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')) return true
      if (e === bar) break
    }
    return false
  }

  /**
   * 固定栏压没压住内容：没滚时看顶栏，滚到底（页面和里面能滚的区域）时看底栏。
   * 压住了报 covered；最近的字离栏不到 8px 报 tight。量完马上滚回去（同一帧里，看不到跳动）。
   * 返回每条栏的高度和离内容的距离（负数 = 压住了这么多）
   */
  /** 这一点在元素的某个外层（overflow 不是 visible 的）外面：被裁掉了，看不见 */
  function clippedAt(el, x, y) {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = e.getBoundingClientRect()
        if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) return true
      }
      if (cs.position === 'fixed') break // 固定定位的外层不再受更外面的裁剪
    }
    return false
  }

  function edgeCheck(add, atoms) {
    const areas = scrollAreas()
    const was = areas.map((el) => [el, el.scrollLeft, el.scrollTop])
    const out = []
    const covered = new Set()
    const look = (edge) => {
      for (const bar of barsAt(edge)) {
        const b = bar.r
        let near = null // 离栏最近的那行字：{ d, el }
        for (const a of atoms) {
          if (bar.el.contains(a.el) || covered.has(a.el)) continue
          for (const r of textRects(a.el)) {
            if (r.r <= b.left + 1 || r.l >= b.right - 1 || r.b <= 0 || r.t >= innerHeight) continue // 和栏不在一竖条上、不在视口里
            // 离栏多远（负数 = 伸进栏里了）；没滚时的顶栏、滚到底时的底栏后面的字已经没法再滚出来了，也算
            const d = edge === 'bottom' ? b.top - r.b : r.t - b.bottom
            if (d > 120) continue
            const x = (Math.max(r.l, b.left) + Math.min(r.r, b.right)) / 2
            const y = d < 0 ? (Math.max(r.t, b.top) + Math.min(r.b, b.bottom)) / 2 : (r.t + r.b) / 2
            if (clippedAt(a.el, x, y)) continue // 被外层裁掉了，本来就看不见
            const top = topAt(x, y)
            if (!top) continue
            const mine = a.el === top || a.el.contains(top)
            const under = !mine && bar.el.contains(top) && barSolid(top, bar.el)
            if (!mine && !under) continue // 被别的东西挡着、或者裁掉了：不算
            if (mine && d < 0) continue // 字画在栏上面（层级更高）：没被压住，也不算进离内容多远
            if (!near || d < near.d) near = { d, el: a.el }
            if (under && d < -2) {
              covered.add(a.el)
              add('covered', a.el, { px: Math.round(-d), edge, bar: nameOf(bar.el) }, 2)
              break
            }
          }
        }
        if (near && near.d >= 0 && near.d < 8 && !covered.has(near.el)) add('tight', near.el, { px: Math.round(near.d), edge, bar: nameOf(bar.el) }, 1)
        out.push({ edge, name: nameOf(bar.el), pos: bar.pos, h: Math.round(b.height), gap: near ? Math.round(near.d) : null })
      }
    }
    try {
      scrollAll(areas, false)
      look('top')
      if (areas.length) scrollAll(areas, true)
      look('bottom')
    } finally {
      for (const [el, x, y] of was) {
        if (el === se()) scrollTo({ left: x, top: y, behavior: 'instant' })
        else el.scrollTo({ left: x, top: y, behavior: 'instant' })
      }
    }
    return { bars: out, areas: areas.filter((el) => el !== se()).length }
  }

  /** 页面里引用的地址 → 设计目录里的相对路径（同一个预览服务器上的）；外网的给 '' */
  function relOf(src) {
    try {
      const u = new URL(src, here())
      if (u.origin !== hereUrl().origin) return ''
      return decodeURIComponent(u.pathname).replace(/^\/+/, '')
    } catch { return '' }
  }

  /**
   * 量一遍。返回 { issues, metrics }：metrics 是量的时候视口多大、页面多高、有哪些固定栏，
   * 让模型知道量的是什么（不只是一句「没问题」）
   */
  function runCheck(kind) {
    const issues = []
    const per = {}
    const add = (type, el, extra, sev = 1) => {
      if ((per[type] = (per[type] || 0) + 1) > CHECK_PER) return
      const r = el ? docRect(el) : null
      issues.push({ type, sev, el, sel: el ? cssPath(el) : '', name: el ? nameOf(el) : '', text: el ? ownText(el).slice(0, 40) : '', rect: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null, ...extra })
    }
    const body = document.body
    if (!body) return []
    const vw = document.documentElement.clientWidth || innerWidth

    // 带字的元素
    const atoms = []
    const all = body.getElementsByTagName('*')
    for (let i = 0; i < all.length && atoms.length < CHECK_ATOMS; i++) {
      const el = all[i]
      if (isOurs(el) || el.closest('dsh-design-picker,dsh-design-fx,dsh-design-edit,script,style,noscript,template,svg')) continue
      if (!ownText(el)) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility !== 'visible') continue
      const rects = textRects(el)
      if (!rects.length || hiddenChain(el)) continue
      atoms.push({ el, cs, rects })
    }

    // 1. 超出屏幕：最外面那个伸出去的元素（在能横向滚动的区域里的不算，那是轮播）
    const sw = document.documentElement.scrollWidth
    const culprits = []
    for (let i = 0; i < all.length && culprits.length < 3; i++) {
      const el = all[i]
      if (isOurs(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      // 按 innerWidth 算：100vw 的块在有滚动条的系统上会多出一条滚动条宽，不算它
      const out = Math.max(r.right - innerWidth, -r.left)
      if (out <= 2) continue
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed') continue
      const p = el.parentElement
      if (p && p !== body) {
        const pr = p.getBoundingClientRect()
        if (Math.max(pr.right - innerWidth, -pr.left) > 2) continue // 爸爸已经伸出去了，报爸爸
      }
      const cl = clipperOf(el)
      if (cl) continue // 在会滚 / 会裁的容器里：轮播、跑马灯，或者归「被截断」管
      if (hiddenChain(el)) continue
      culprits.push({ el, out: Math.round(out) })
    }
    for (const c of culprits) add('hscroll', c.el, { px: c.out, scroll: sw > vw + 1 }, 2)

    // 2. 文字被截断 / 超出框：自己的字伸出了所在的块（行内元素看外面那个块）。
    //    Range 量到的是排版后的位置，被裁掉的部分也量得到
    const clampOf = (cs) => (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || (cs.lineClamp && cs.lineClamp !== 'none')
    for (const a of atoms) {
      const { el } = a
      let box = el
      while (box.parentElement && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement
      const bcs = box === el ? a.cs : getComputedStyle(box)
      if (box !== body && box !== document.documentElement && box.clientWidth > 0) {
        const br = box.getBoundingClientRect()
        const dx = Math.max(0, ...a.rects.map((r) => Math.max(r.r - br.right, br.left - r.l)))
        const dy = Math.max(0, ...a.rects.map((r) => Math.max(r.b - br.bottom, br.top - r.t)))
        const ox = bcs.overflowX, oy = bcs.overflowY
        // 大字的字形本来就会比行框宽、高一点（字距收紧、行高小于 1），差一点不算
        const slack = Math.max(3, (parseFloat(a.cs.fontSize) || 16) * 0.2)
        if (dx > slack && !/auto|scroll/.test(ox) && bcs.textOverflow !== 'ellipsis') { add(/hidden|clip/.test(ox) ? 'clipped' : 'overflow', el, { px: Math.round(dx) }, 2); continue }
        if (dy > slack && !/auto|scroll/.test(oy) && !clampOf(bcs)) { add(/hidden|clip/.test(oy) ? 'clipped' : 'overflow', el, { px: Math.round(dy) }, 2); continue }
      }
      // 被更外面的容器裁掉
      const cl = clipperOf(box)
      if (cl && !cl.scroll) {
        const box = cl.el.getBoundingClientRect()
        const cut = Math.max(...a.rects.map((r) => Math.max(cl.x ? r.r - box.right : 0, cl.x ? box.left - r.l : 0, cl.y ? r.b - box.bottom : 0, cl.y ? box.top - r.t : 0)))
        const ccs = getComputedStyle(cl.el)
        if (cut > 2 && ccs.textOverflow !== 'ellipsis' && !clampOf(ccs)) add('clipped', el, { px: Math.round(cut) }, 2)
      }
    }

    // 3. 文字叠在一起：不同元素的文字矩形（逐行）重叠超过小的那块的 30%；很淡的装饰字不算。
    //    一个在固定的顶栏 / 底栏里、一个在页面内容里的不算：内容滚动时本来就从栏下面过，滚到头还被压住由第 11 项（covered）查
    const pinBars = [...barsAt('top'), ...barsAt('bottom')].map((b) => b.el)
    const pins = new Map()
    const pinOf = (i) => {
      if (pins.has(i)) return pins.get(i)
      let hit = null
      for (let e = atoms[i].el; e && e !== document.body; e = e.parentElement) {
        const pos = getComputedStyle(e).position
        if (pinBars.includes(e) || pos === 'fixed' || pos === 'sticky') { hit = e; break }
      }
      pins.set(i, hit)
      return hit
    }
    const boxes = []
    atoms.forEach((a, i) => {
      const fg = rgba(a.cs.color)
      if (fg && fg[3] * opacityChain(a.el) < 0.35) return
      for (const r of a.rects) if (r.b - r.t >= 4) boxes.push({ ...r, i })
    })
    boxes.sort((x, y) => x.t - y.t)
    const pairs = new Set()
    for (let i = 0; i < boxes.length; i++) {
      const p = boxes[i]
      for (let j = i + 1; j < boxes.length && boxes[j].t < p.b; j++) {
        const q = boxes[j]
        if (q.i === p.i) continue
        const ow = Math.min(p.r, q.r) - Math.max(p.l, q.l)
        const oh = Math.min(p.b, q.b) - Math.max(p.t, q.t)
        if (ow <= 3 || oh <= 3) continue
        const small = Math.min((p.r - p.l) * (p.b - p.t), (q.r - q.l) * (q.b - q.t))
        if (ow * oh < small * 0.3) continue
        const A = atoms[p.i].el, B = atoms[q.i].el
        if (A.contains(B) || B.contains(A)) continue
        if (!pinOf(p.i) !== !pinOf(q.i)) continue
        const key = Math.min(p.i, q.i) + ':' + Math.max(p.i, q.i)
        if (pairs.has(key)) continue
        pairs.add(key)
        add('overlap', A, { other: nameOf(B), otherText: ownText(B).slice(0, 40), otherSel: cssPath(B) }, 2)
      }
    }

    // 4. 对比度（WCAG：正文 4.5，大字 3）
    const sizes = new Map()
    const tinyMin = kind === 'app' ? 10 : kind === 'tablet' ? 11 : kind === 'poster' || kind === 'slides' ? Math.max(12, Math.round(vw / 96)) : 12
    for (const a of atoms) {
      const { el, cs } = a
      const px = parseFloat(cs.fontSize) || 0
      sizes.set(Math.round(px * 2) / 2, (sizes.get(Math.round(px * 2) / 2) || 0) + 1)
      if (px && px < tinyMin && !el.closest('sup,sub')) add('tiny', el, { size: Math.round(px * 10) / 10, min: tinyMin }, 1)
      if (el.closest(':disabled,[aria-disabled="true"]')) continue
      const fill = cs.webkitTextFillColor
      let fg = rgba(fill && fill !== cs.color ? fill : cs.color)
      if (!fg || fg[3] === 0) continue // 渐变字之类
      const r0 = a.rects[0]
      const op = opacityChain(el)
      // 半透明还在变的（淡入动画、跟着滚动渐显的）量的是中间状态，不算
      if (op < 0.999 && (!inView(el) || animating(el))) continue
      const bd = backdrop(el, { x: (r0.l + r0.r) / 2, y: (r0.t + r0.b) / 2 })
      if (!bd) continue
      fg = over([fg[0], fg[1], fg[2], fg[3] * op], bd.color)
      const cr = ratio(fg, bd.color)
      const bold = +cs.fontWeight >= 700
      const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5
      if (cr < need - 0.05) add('contrast', el, { ratio: Math.round(cr * 100) / 100, need, fg: hex(fg), bg: hex(bd.color) }, cr < need * 0.75 ? 2 : 1)
    }

    // 5. 点击区太小（App / 平板 44，网页 24；文字中间的链接不算）
    const minTap = kind === 'app' || kind === 'tablet' ? 44 : kind === 'web' || kind === 'email' ? 24 : 0
    if (minTap) {
      const small = []
      for (const el of body.querySelectorAll(CLICKABLE)) {
        if (isOurs(el) || el.closest('dsh-design-picker,dsh-design-fx,dsh-design-edit')) continue
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1 || (r.width >= minTap && r.height >= minTap)) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'inline' && el.parentElement && ownText(el.parentElement)) continue // 一段话里的链接
        if (el.closest(CLICKABLE) !== el && el.parentElement && el.parentElement.closest(CLICKABLE)) continue // 外面一层已经是可点的
        if (hiddenChain(el)) continue
        small.push({ el, w: Math.round(r.width), h: Math.round(r.height) })
      }
      small.sort((x, y) => Math.min(x.w, x.h) - Math.min(y.w, y.h))
      for (const s of small) add('tap', s.el, { w: s.w, h: s.h, min: minTap }, Math.min(s.w, s.h) < minTap * 0.6 ? 2 : 1)
    }

    // 6. 图片没加载出来
    for (const img of body.querySelectorAll('img')) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src') && !hiddenChain(img)) add('img', img, { src: img.getAttribute('src').slice(0, 80) }, 2)
    }

    // 7. 图片被拉变形：object-fit 是默认的 fill，显示的宽高比和原图差 4% 以上（SVG 自己保持比例，不算）
    for (const img of body.querySelectorAll('img')) {
      if (!img.complete || !img.naturalWidth || !img.naturalHeight || hiddenChain(img)) continue
      if (/\.svg(\?|#|$)|^data:image\/svg/i.test(img.currentSrc || img.src || '')) continue
      const r = img.getBoundingClientRect()
      if (r.width < 24 || r.height < 24) continue
      if ((getComputedStyle(img).objectFit || 'fill') !== 'fill') continue
      const skew = (r.width / r.height) / (img.naturalWidth / img.naturalHeight)
      if (Math.abs(Math.log(skew)) > Math.log(1.04)) add('distort', img, { nw: img.naturalWidth, nh: img.naturalHeight, w: Math.round(r.width), h: Math.round(r.height) }, 1)
    }

    // 8. 一行太长（网页 / 邮件 / 平板）：成段的字一行超过约 45 个汉字或 90 个字母，读着累。
    //    最宽那行有几个字宽（汉字一个字 1em，字母平均约 0.5em）；要折了行才算（一行写完的标题不管）；同一屏报几处就够
    if (kind === 'web' || kind === 'email' || kind === 'tablet') {
      let long = 0
      for (const a of atoms) {
        if (long >= 3) break
        const text = ownText(a.el)
        if (text.length < 60 || new Set(a.rects.map((r) => Math.round(r.t))).size < 2) continue
        const px = parseFloat(a.cs.fontSize) || 16
        const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length > text.length * 0.3
        const max = cjk ? 45 : 90
        const per = Math.round(Math.max(...a.rects.map((r) => r.r - r.l)) / px * (cjk ? 1 : 2))
        if (per > max) { add('long', a.el, { chars: per, max }, 1); long++ }
      }
    }

    // 9. 短字被挤断了行：按钮、价格、标签这种几个字的折成了两行（「再来一 / 单」），或者一句短话最后一行只剩一两个字。
    //    一段话里跟着文字折行的行内元素不算（外面那个块的字多）；写了 <br> 的、竖排的不算
    let wraps = 0
    for (const a of atoms) {
      if (wraps >= 5) break
      const text = ownText(a.el).replace(/\s+/g, ' ').trim()
      if (text.length < 2 || text.length > 16 || a.el.querySelector('br') || /vertical/.test(a.cs.writingMode)) continue
      const tops = []
      for (const r of a.rects) if (!tops.some((t) => Math.abs(t - r.t) < 3)) tops.push(r.t)
      if (tops.length < 2) continue
      if (/^inline/.test(a.cs.display) && a.cs.display !== 'inline-block' && a.cs.display !== 'inline-flex') {
        let box = a.el.parentElement
        while (box && box !== body && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement
        if (box && box !== body && (box.textContent || '').replace(/\s+/g, '').length > 20) continue
      }
      const px = parseFloat(a.cs.fontSize) || 16
      const lastTop = Math.max(...tops)
      const tail = a.rects.filter((r) => Math.abs(r.t - lastTop) < 3).reduce((m, r) => m + (r.r - r.l), 0) / px
      const short = text.replace(/\s/g, '').length <= 6 || !!a.el.closest('button,[role="button"]')
      if (short || tail <= 2.2) { add('wrap', a.el, { lines: tops.length }, 1); wraps++ }
    }

    // 10. 字号太杂（整屏一条）
    const used = [...sizes.keys()].sort((x, y) => x - y)
    if (used.length > 7) add('fonts', null, { sizes: used }, 1)

    // 11. 固定栏压住内容 / 贴得太近
    const edges = edgeCheck(add, atoms)

    // 12. 页面脚本报错、样式表 / 脚本 / 字体没载出来（<head> 最前面那段小脚本记下的；图片归第 6 条）
    for (const e of Array.isArray(window.__dshErrs) ? window.__dshErrs.slice(0, 20) : []) {
      if (e.res) {
        if (e.tag === 'img' || !e.src) continue
        const rel = relOf(e.src)
        if (rel && !rel.startsWith('__dsh_design__/')) add('missing', null, { what: e.tag === 'link' ? 'css' : e.tag, src: rel }, 2)
      } else if (!/__dsh_design__/.test(e.src || '')) {
        add('jserr', null, { msg: String(e.msg || '').slice(0, 160), src: relOf(e.src || '') || '', line: e.line || 0 }, 2)
      }
    }
    try {
      for (const f of document.fonts || []) if (f.status === 'error') add('missing', null, { what: 'font', src: String(f.family || '').replace(/['"]/g, '') }, 1)
    } catch { /* 老浏览器 */ }

    issues.sort((x, y) => y.sev - x.sev)
    const se0 = se()
    return {
      issues: issues.slice(0, CHECK_MAX),
      metrics: { w: vw, h: innerHeight, page: Math.max(se0.scrollHeight, innerHeight), bars: edges.bars, areas: edges.areas },
    }
  }

  /** 量之前等字体、图片载完（最多等 2 秒）：刚载入的页面字体没到时字宽不对，断行、截断都会量错 */
  async function settle() {
    const wait = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])
    try { if (document.fonts && document.fonts.ready) await wait(document.fonts.ready, 2000) } catch { /* 没有 fonts */ }
    // 懒加载的图：滚到视口里了也等（滚动截图时）
    const seen = (i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
    const imgs = [...document.images].filter((i) => !i.complete && (i.loading !== 'lazy' || seen(i)))
    if (imgs.length) await wait(Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }) }))), 2000)
  }

  function clearMarks() {
    for (const m of checkMarks) m.node.remove()
    checkMarks = []
  }

  function placeMarks() {
    for (const m of checkMarks) {
      if (!m.el || !m.el.isConnected) continue
      const r = docRect(m.el)
      Object.assign(m.node.style, { left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' })
    }
  }
  addEventListener('resize', placeMarks)

  function markIssues(issues) {
    clearMarks()
    const { root } = fxRoot()
    issues.forEach((it, i) => {
      if (!it.el) return
      const b = document.createElement('div')
      b.className = 'ck' + (it.sev > 1 ? ' hi' : '')
      const t = document.createElement('b')
      t.textContent = String(i + 1)
      b.append(t)
      root.append(b)
      checkMarks.push({ node: b, el: it.el })
    })
    placeMarks()
  }

  let lastIssues = []

  /** 右侧栏点了第 i 条：滚过去，那个框闪一下 */
  function focusIssue(i) {
    const it = lastIssues[i]
    if (!it || !it.el || !it.el.isConnected) return
    const go = () => {
      const mk = checkMarks.find((x) => x.el === it.el)
      if (mk) { mk.node.classList.remove('on'); void mk.node.offsetWidth; mk.node.classList.add('on') }
    }
    if (inView(it.el)) go()
    else {
      try { it.el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { it.el.scrollIntoView() }
      setTimeout(() => { placeMarks(); go() }, 450)
    }
  }
  async function onCheck(d) {
    let r
    try {
      await settle()
      r = runCheck(String(d.kind || 'web'))
    } catch (e) {
      // 量的时候出错了：照实说没量成，别当成「没问题」
      console.warn('[dsh-design-studio] 体检出错', e)
      post({ type: 'checked', id: d.id, error: String((e && e.message) || e).slice(0, 200) })
      return
    }
    // 悄悄查（模型干完活顺手量一下，只要个数）：不动页面上的标记
    if (!d.quiet) {
      lastIssues = r.issues
      markIssues(r.issues)
    }
    post({ type: 'checked', id: d.id, issues: r.issues.map(({ el, ...rest }) => rest), metrics: r.metrics, width: r.metrics.w })
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
    else if (d.type === 'cancel') { if (!styleOn) stop(true) }
    else if (d.type === 'init') boot(d.seed || null)
    else if (d.type === 'reveal') reveal(d)
    else if (d.type === 'zoom') setK(1 / (Number(d.z) || 1))
    else if (d.type === 'snapshot') post({ type: 'snap', seed: seedNow() })
    else if (d.type === 'busy') { busy = !!d.on; watchHmr() }
    else if (d.type === 'unpin') unpin()
    else if (d.type === 'reload') selfReload()
    else if (d.type === 'capture') onCapture(d)
    else if (d.type === 'check') onCheck(d)
    else if (d.type === 'checkClear') { clearMarks(); lastIssues = [] }
    else if (d.type === 'checkFocus') focusIssue(Number(d.i))
    else if (d.type === 'theme') setDark(d.dark)
    else if (d.type === 'demo') demo = !!d.on
    else if (d.type === 'edit') setTextEdit(!!d.on, d.hint !== false)
    else if (d.type === 'styleMode') setStyleMode(!!d.on)
    else if (d.type === 'styleSel') onStyleSel(d.selector)
    else if (d.type === 'style') styleApply(d.css)
  })

  // 无头浏览器（check_design / look_design 在电脑上另开的，见 browser.js）直接调这几个：
  // 量一遍、切深色、滚到底 / 滚到第几屏、取页面信息。都只读或只动这个页面自己
  function mainArea() {
    const areas = scrollAreas()
    if (areas.includes(se())) return se()
    return areas.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || se()
  }
  try {
    Object.defineProperty(window, '__dshDesign', {
      value: Object.freeze({
        check: async (kind) => {
          await settle()
          const r = runCheck(String(kind || 'web'))
          return { issues: r.issues.map(({ el, ...rest }) => rest), metrics: r.metrics }
        },
        dark: (on) => { const has = hasDark(); if (has) setDark(!!on); return has },
        settle: () => settle().then(() => true),
        /** 跳到别的屏的地方（路径和按钮上的字），量完查一下目标在不在 */
        links: () => linksOf().map(({ path, text }) => ({ path, text })),
        info: () => {
          const meta = document.querySelector('meta[name="dsh-design"]')
          return { title: document.title, meta: meta ? String(meta.getAttribute('content') || '').slice(0, 80) : '', page: Math.max(se().scrollHeight, innerHeight), w: innerWidth, h: innerHeight }
        },
        /** 'end'：所有能滚的地方都滚到底；数字 i：主要的那块滚到第 i 屏（相邻两屏留出顶栏、底栏的高度，栏后面的内容下一屏能看到） */
        // 滚完等两帧、再等新露出来的图和字体（页面的滚动监听、懒加载的图有机会跟上），再截图
        scroll: (where) => {
          const after = (v) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(v)))).then((v2) => settle().then(() => v2, () => v2))
          if (where === 'end') { scrollAll(scrollAreas(), true); return after({ i: 0, of: 1 }) }
          const el = mainArea()
          const view = el === se() ? innerHeight : el.clientHeight
          const bars = [...barsAt('top'), ...barsAt('bottom')].reduce((m, b) => m + b.r.height, 0)
          const step = Math.max(Math.round(view * 0.5), Math.round(view - bars - 16))
          const max = Math.max(0, el.scrollHeight - view)
          const of = 1 + Math.ceil(max / step)
          const y = Math.min(max, Math.max(0, Number(where) || 0) * step)
          if (el === se()) scrollTo({ left: 0, top: y, behavior: 'instant' })
          else el.scrollTo({ left: 0, top: y, behavior: 'instant' })
          return after({ i: Number(where) || 0, of, y })
        },
        /** 一个元素的样式信息（和调样式选中它时报给右侧栏的一样：现在的值、用了哪些设计变量、各由哪条规则决定） */
        style: (sel) => {
          let el = null
          try { el = document.querySelector(sel) } catch { el = null }
          return el ? styleInfo(el) : null
        },
        /** 一个元素的位置（先滚到能看见；按整页坐标给，截图裁剪就是按整页坐标裁的） */
        rect: (sel) => {
          let el = null
          try { el = document.querySelector(sel) } catch { el = null }
          if (!el) return null
          try { el.scrollIntoView({ block: 'center', behavior: 'instant' }) } catch { el.scrollIntoView() }
          const r = el.getBoundingClientRect()
          // 视口的范围也给：裁剪别伸出视口（外面截出来是空白）
          return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, vx: scrollX, vy: scrollY, vw: innerWidth, vh: innerHeight }
        },
      }),
    })
  } catch { /* 页面自己占了这个名字 */ }

  function selfReload() {
    try { sessionStorage.setItem(SEED_KEY, JSON.stringify({ ...seedNow(), at: Date.now() })) } catch { /* 隐私模式 / 太大 */ }
    location.reload()
  }

  function onLoad() {
    if (parentWin) {
      post({ type: 'hello', href: here() })
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
    const pn = hereUrl().pathname
    try { p = decodeURIComponent(pn) } catch { p = pn }
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
