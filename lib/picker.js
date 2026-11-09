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
  // 在右侧栏里不画滚动条（和手机上一样）：电脑设成「总是显示滚动条」时它占掉 15px，App 按 375 排版而不是 390，
  // 右侧栏的体检就和 check_design（无头浏览器不画滚动条）对不上
  if (parentWin) {
    const s = document.createElement('style')
    s.setAttribute('data-dsh-design', '')
    s.textContent = '*{scrollbar-width:none}*::-webkit-scrollbar{display:none}'
    ;(document.head || document.documentElement).appendChild(s)
  }
  // 别人做的设计（设计库来的、没改过）：服务端在脚本标签上标了 data-strict（远程看时在 cfg 里）。
  // 点站外链接不跳（页面本来就跑不了脚本、交不出表单，这里再挡住「点一下跳到别的网站」），告诉右侧栏拦下了
  const STRICT = !!cfg.strict || !!(document.currentScript && document.currentScript.getAttribute('data-strict') === '1')
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

  // 拖着文件进了这一页（页面铺满右侧栏时，外面的右侧栏收不到拖动）：告诉右侧栏亮出「松开打开 / 当参考图」的提示，
  // 松手也在这里接住、把文件转给右侧栏。提示只是一层画、不挡事件：页面自己的上传区照样收得到后面的拖动
  // 页面自己里面拖的（拖一下页面上的图、页面自己的拖放）不算：那不是要打开什么
  // 用 drag 不用 dragstart：页面取消了 dragstart（轮播图常这么做）就不会有 drag，也就不会有 dragend 来清掉标记
  let ownDrag = false
  let dropOwn = false
  addEventListener('drag', () => { ownDrag = true }, true)
  addEventListener('dragend', () => { ownDrag = false }, true)
  addEventListener('pointerup', () => { ownDrag = false }, true)
  const hasFiles = (dt) => !!dt && [...(dt.types || [])].includes('Files')
  // 页面自己接这次拖动：上传区在 dragover 上 preventDefault（或者拦住不让冒泡，见下面捕获阶段那个），或者落在 <input type=file> 上
  const pageTakes = (e) => e.defaultPrevented || (typeof e.composedPath === 'function' ? e.composedPath() : [e.target]).some((n) => n && n.tagName === 'INPUT' && String(n.type).toLowerCase() === 'file')
  let lastIn = 0
  let took = false // 刚才那下是页面自己接的：收起提示，松手也归页面
  const seen = new WeakSet() // 冒泡阶段见到过的 dragover（按事件记：页面忙时几个 dragover 会连着处理）
  const pageTook = () => {
    if (took) return
    took = true
    lastIn = 0
    post({ type: 'dragOut' })
  }
  // 只看 dragover：同一个元素上拖第二次时浏览器不一定再给 dragenter；dragenter 时也还不知道页面接不接
  // 挂在 window 冒泡阶段的最后，页面的处理先跑完；页面全局拦了 dragover 防误拖的就当页面接了（那种页面用「浏览…」或地址栏打开）
  const onOver = (e) => {
    seen.add(e)
    const dt = e.dataTransfer
    if (ownDrag || !hasFiles(dt)) return
    if (pageTakes(e)) return pageTook()
    took = false
    e.preventDefault() // 这里能松手：不然浏览器把文件当网页打开（或者根本不给 drop）
    dt.dropEffect = 'copy'
    const now = Date.now()
    if (now - lastIn < 200) return // 拖着时 dragover 一直来，隔一会儿报一次就够
    lastIn = now
    post({ type: 'dragIn', items: [...(dt.items || [])].slice(0, 20).map((x) => ({ kind: String(x.kind), type: String(x.type) })) })
  }
  const onDrop = (e) => {
    const dt = e.dataTransfer
    const own = dropOwn
    dropOwn = false
    if (own || !hasFiles(dt)) return
    if (took || pageTakes(e)) { took = false; return }
    e.preventDefault()
    const files = []
    for (const x of [...(dt.items || [])].slice(0, 20)) {
      if (x.kind !== 'file') continue
      // 文件夹只有 entry 分得出来，得在 drop 里同步取
      let dir = false
      try { const en = typeof x.webkitGetAsEntry === 'function' ? x.webkitGetAsEntry() : null; dir = !!(en && en.isDirectory) } catch { dir = false }
      let f = null
      try { f = x.getAsFile() } catch { f = null }
      if (f) files.push({ f, dir })
    }
    // File 能直接跟着消息过去（桌面版照样拿得到它的真实路径）
    post({ type: 'dropIn', files })
  }
  // 页面在 window 上挂的整页上传常常比这里晚注册（type=module 的脚本、框架挂载后）：每次事件在捕获阶段把上面两个摘下来重挂，
  // 排到 window 冒泡监听的最后，页面的处理（不管什么时候挂的）都先跑完，才看它接没接。
  // 重挂放在 document 的捕获阶段：window 捕获阶段的监听（页面的也算）都跑过了才轮到它
  const last = (type, fn) => { removeEventListener(type, fn); addEventListener(type, fn) }
  last('dragover', onOver)
  last('drop', onDrop)
  document.addEventListener('dragover', () => last('dragover', onOver), true)
  document.addEventListener('drop', () => last('drop', onDrop), true)
  addEventListener('dragover', (e) => {
    if (ownDrag || !hasFiles(e.dataTransfer)) return
    // 上传区拦住 dragover 不让冒泡（stopPropagation）时上面那个收不到：这一轮事件发完还没见到它，就是页面接了
    setTimeout(() => { if (!seen.has(e)) pageTook() }, 0)
  }, true)
  addEventListener('drop', () => {
    dropOwn = ownDrag
    ownDrag = false
  }, true)

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
    const open = shallow.outerHTML.replace(/<\/[^>]+>$/, '').replace(/\s+/g, ' ')
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
.cut{position:absolute;pointer-events:none;border:calc(2px * var(--k, 1)) solid #e5484d;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.85)}
.cut.alt{border-color:#f59e0b;border-style:dashed}
.cut b{position:absolute;left:calc(-2px * var(--k, 1));bottom:100%;margin-bottom:calc(3px * var(--k, 1));padding:0 6px;border-radius:4px;background:#e5484d;color:#fff;
  font:600 12px/18px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;white-space:nowrap;transform:scale(var(--k, 1));transform-origin:0 100%}
.cut.low b{bottom:auto;top:100%;margin:calc(3px * var(--k, 1)) 0 0;transform-origin:0 0}
@keyframes ck-on{0%,40%{box-shadow:0 0 0 calc(6px * var(--k, 1)) rgba(229,72,77,.35)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}
.scan{position:fixed;left:0;right:0;top:0;height:38vh;pointer-events:none;opacity:0;
  background:linear-gradient(180deg,rgba(77,107,254,0),rgba(77,107,254,.06) 55%,rgba(124,140,255,.22) 92%,rgba(77,107,254,0));
  animation:scan var(--dur, 1.2s) cubic-bezier(.45,0,.25,1) forwards}
.scan::after{content:"";position:absolute;left:0;right:0;bottom:8%;height:2px;
  background:linear-gradient(90deg,transparent,#8ea2ff 20%,#c4b5fd 50%,#5eead4 80%,transparent);box-shadow:0 0 14px 3px rgba(124,140,255,.55)}
@keyframes scan{0%{opacity:0;transform:translateY(-38vh)}12%{opacity:1}82%{opacity:1}100%{opacity:0;transform:translateY(100vh)}}
/* 生成动画：带名字的鼠标把版面框出来，再由上往下显出整屏 */
.bmask{position:fixed;inset:0;background:var(--bg,#fff);clip-path:inset(0 0 0 0)}
.bmask.go{transition:clip-path var(--dur,900ms) cubic-bezier(.55,.05,.25,1);clip-path:inset(100% 0 0 0)}
.bbox{position:fixed;box-sizing:border-box;width:0;height:0;border:calc(1.5px * var(--k, 1)) dashed var(--c);border-radius:calc(8px * var(--k, 1));
  background:color-mix(in srgb,var(--c) 6%,transparent);overflow:hidden;
  transition:width var(--d,340ms) cubic-bezier(.3,.7,.2,1),height var(--d,340ms) cubic-bezier(.3,.7,.2,1),opacity .3s ease,background .3s ease,border-color .3s ease}
.bbox::after{content:"";position:absolute;inset:0;transform:translateX(-100%);opacity:0;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--c) 22%,transparent),transparent)}
.bbox.fill{border-style:solid;border-color:color-mix(in srgb,var(--c) 42%,transparent);background:color-mix(in srgb,var(--c) 9%,transparent)}
.bbox.fill::after{opacity:1;animation:bshine 1.2s ease-in-out infinite}
.bbox b{position:absolute;left:calc(7px * var(--k, 1));top:calc(5px * var(--k, 1));opacity:0;transition:opacity .25s ease;
  font:600 calc(10.5px * var(--k, 1))/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:.02em;color:var(--c);white-space:nowrap}
.bbox.fill b{opacity:1}
.bcur.flip span{left:auto;right:calc(100% - 4px * var(--k, 1));border-radius:calc(8px * var(--k, 1)) calc(4px * var(--k, 1)) calc(8px * var(--k, 1)) calc(8px * var(--k, 1))}
.bcur.up span{top:auto;bottom:calc(100% - 2px * var(--k, 1))}
@keyframes bshine{to{transform:translateX(100%)}}
.bcur{position:fixed;left:0;top:0;z-index:2;opacity:0;will-change:transform;transition:opacity .25s ease}
.bcur.on{opacity:1}
.bcur svg{display:block;width:calc(17px * var(--k, 1));height:calc(21px * var(--k, 1));overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}
.bcur span{position:absolute;left:calc(13px * var(--k, 1));top:calc(17px * var(--k, 1));padding:calc(2px * var(--k, 1)) calc(7px * var(--k, 1));
  border-radius:calc(4px * var(--k, 1)) calc(8px * var(--k, 1)) calc(8px * var(--k, 1)) calc(8px * var(--k, 1));background:var(--c);color:#fff;
  font:600 calc(11px * var(--k, 1))/1.35 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.18)}
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

  // ── 生成动画 2：几只带名字的鼠标（排版 / 配色 / 文案）轮流把版面框出来，框里闪骨架，再由上往下显出整屏 ──
  //
  // 框的是页面里几大块的真实位置（这屏已经写好了，先量），所以动画和最后的画面对得上。
  // 系统开了「减少动态效果」就直接显示；点一下、滚一下、按个键就跳过。播完不留任何东西。

  const BUILD_TX = {
    zh: { cur: ['排版', '配色', '文案'], top: '顶栏', bottom: '底栏', side: '侧栏', img: '图片', title: '标题', list: '列表', form: '表单', card: '卡片', block: '内容' },
    en: { cur: ['Layout', 'Color', 'Copy'], top: 'Header', bottom: 'Footer', side: 'Sidebar', img: 'Image', title: 'Title', list: 'List', form: 'Form', card: 'Card', block: 'Section' },
  }
  const BUILD_C = ['#4d6bfe', '#e8590c', '#0ca678']
  const ARROW = '<svg viewBox="0 0 17 21"><path d="M1.2 1.2v15.6l4.3-4 3 6.6 2.9-1.3-3-6.5h6z" fill="var(--c)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  let building = null

  /** 页面里几大块（视口里看得见的部分）：外壳 div 一层层钻进去，太高的一块再拆一层，最多 7 块 */
  function buildBlocks() {
    const vw = innerWidth
    const vh = innerHeight
    const rectOf = (c) => {
      if (SIG_SKIP.has(c.tagName)) return null
      const r = c.getBoundingClientRect()
      if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return null
      const cs = getComputedStyle(c)
      if (cs.visibility === 'hidden' || cs.display === 'contents' || Number(cs.opacity) === 0) return null
      return r
    }
    const kidsOf = (el) => [...el.children].map((c) => ({ el: c, r: rectOf(c) })).filter((x) => x.r)
    const seen = (r) => Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    let kids = document.body ? kidsOf(document.body) : []
    for (let d = 0; kids.length === 1 && d < 8; d++) kids = kidsOf(kids[0].el)
    const min = vw * vh * 0.012
    const split = (k) => {
      let sub = kidsOf(k.el)
      for (let d = 0; sub.length === 1 && d < 6; d++) sub = kidsOf(sub[0].el)
      return sub.filter((x) => seen(x.r) >= min)
    }
    // 太高的一块（整个内容区）往里拆，最多两层
    const expand = (k, depth) => {
      if (depth < 2 && k.r.height > vh * 0.55) {
        const sub = split(k)
        if (sub.length >= 2 && sub.length <= 6) return sub.flatMap((x) => expand(x, depth + 1))
      }
      return [k]
    }
    let out = kids.filter((k) => seen(k.r) >= min).flatMap((k) => expand(k, 0))
    const box = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    for (const k of out) {
      k.b = box(k.r)
      const pos = getComputedStyle(k.el).position
      k.fixed = pos === 'fixed' || pos === 'sticky'
    }
    // 浮在上面的条（购物车条、底部导航）：底下那块的框截到它上面，免得两个框叠在一起
    const wide = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > (a.right - a.left) * 0.6
    for (const k of out) {
      if (k.fixed) continue
      for (const f of out) {
        if (!f.fixed || f === k || !wide(k.b, f.b)) continue
        if (f.b.top > k.b.top + vh * 0.1 && f.b.top < k.b.bottom) k.b.bottom = f.b.top - 6
        else if (f.b.bottom < k.b.bottom - vh * 0.1 && f.b.bottom > k.b.top) k.b.top = f.b.bottom + 6
      }
    }
    // 还叠着的（一层套一层）只留看得见更多的那个
    const inter = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    out = out.filter((k) => k.b.bottom - k.b.top >= 12 && seen(k.b) >= min * 0.6)
    out.sort((a, b) => seen(b.b) - seen(a.b))
    out = out.filter((k, i) => !out.slice(0, i).some((o) => inter(k.b, o.b) > seen(k.b) * 0.5))
    if (out.length > 7) out = out.slice(0, 7)
    out.sort((a, b) => a.b.top - b.b.top || a.b.left - b.b.left)
    const pad = 2
    return out.map((k) => {
      const x = Math.max(pad, k.b.left)
      const y = Math.max(pad, k.b.top)
      return { el: k.el, r: k.r, x, y, w: Math.max(12, Math.min(vw - pad, k.b.right) - x), h: Math.max(12, Math.min(vh - pad, k.b.bottom) - y) }
    })
  }

  /** 这块大概是什么：顶栏 / 底栏 / 图片 / 表单 / 列表 / 标题 / 卡片 */
  function blockName(el, r, N) {
    const vh = innerHeight
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role') || ''
    const low = r.top > vh * 0.6
    if (tag === 'footer' || ((tag === 'nav' || role === 'tablist' || role === 'navigation') && low) || (r.bottom >= vh * 0.94 && r.height < vh * 0.16)) return N.bottom
    if (tag === 'header' || tag === 'nav' || role === 'banner' || (r.top <= vh * 0.06 && r.height < vh * 0.16)) return N.top
    if (el.querySelector('input:not([type=hidden]),textarea,select')) return N.form
    let media = 0
    for (const m of el.querySelectorAll('img,picture,video,canvas,svg')) {
      const q = m.getBoundingClientRect()
      if (q.width * q.height > 400) media += q.width * q.height
    }
    if (media > r.width * r.height * 0.45) return N.img
    if (r.width < innerWidth * 0.36 && r.height > vh * 0.3) return N.side
    const kids = [...el.children].filter((c) => c.getBoundingClientRect().height > 8)
    const tags = new Map()
    for (const c of kids) tags.set(c.tagName, (tags.get(c.tagName) || 0) + 1)
    const most = Math.max(0, ...tags.values())
    if (/^(ul|ol|table)$/.test(tag) || (kids.length >= 3 && kids.every((c) => Math.abs(c.getBoundingClientRect().height - kids[0].getBoundingClientRect().height) < 12)) ||
      (most >= 3 && most >= kids.length * 0.6)) return N.list
    if (el.matches('h1,h2,h3') || (el.querySelector('h1,h2') && r.height < vh * 0.3)) return N.title
    return r.height > vh * 0.4 ? N.block : N.card
  }

  function pageBg() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue
      const c = getComputedStyle(el).backgroundColor
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
    }
    return '#fff'
  }

  function build(lang) {
    stopBuild()
    if (!document.body || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    const blocks = buildBlocks()
    if (!blocks.length) return buildIn()
    const N = BUILD_TX[lang] || BUILD_TX.zh
    const { root } = fxRoot()
    const vw = innerWidth
    const vh = innerHeight
    const nodes = []
    const timers = []
    const at = (ms, f) => timers.push(setTimeout(f, ms))
    const add = (el) => { root.append(el); nodes.push(el); return el }
    const mask = add(document.createElement('div'))
    mask.className = 'bmask'
    mask.style.setProperty('--bg', pageBg())
    // 三只鼠标从下面进来
    const curs = BUILD_C.map((c, i) => {
      const d = add(document.createElement('div'))
      d.className = 'bcur'
      d.style.setProperty('--c', c)
      d.innerHTML = ARROW
      const tag = document.createElement('span')
      tag.textContent = N.cur[i]
      d.append(tag)
      d.style.transform = `translate(${vw * (0.3 + i * 0.2)}px, ${vh + 10}px)`
      return { d, free: 0 }
    })
    const move = (cur, x, y, ms) => {
      x = Math.min(x, vw - 4)
      cur.d.classList.toggle('flip', x > vw - 84 * K)
      cur.d.classList.toggle('up', y > vh - 40 * K && y <= vh)
      cur.d.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.2,1), opacity .25s ease`
      cur.d.style.transform = `translate(${x}px, ${y}px)`
    }
    at(16, () => curs.forEach((c) => c.d.classList.add('on')))
    const MOVE = 260
    const DRAG = 330
    let end = 0
    const boxes = blocks.map((b, i) => {
      const cur = curs[i % curs.length]
      const t0 = Math.max(80 + i * 170, cur.free)
      cur.free = t0 + MOVE + DRAG + 60
      end = Math.max(end, cur.free)
      const box = add(document.createElement('div'))
      box.className = 'bbox'
      box.style.setProperty('--c', BUILD_C[i % BUILD_C.length])
      box.style.setProperty('--d', DRAG + 'ms')
      box.style.left = b.x + 'px'
      box.style.top = b.y + 'px'
      box.style.opacity = '0'
      const label = document.createElement('b')
      label.textContent = blockName(b.el, b.r, N)
      box.append(label)
      at(t0, () => move(cur, b.x, b.y, MOVE))
      at(t0 + MOVE, () => {
        box.style.opacity = '1'
        box.style.width = b.w + 'px'
        box.style.height = b.h + 'px'
        move(cur, b.x + b.w, b.y + b.h, DRAG)
      })
      at(t0 + MOVE + DRAG, () => box.classList.add('fill'))
      return { box, b }
    })
    // 框完了：停一下，再由上往下显出整屏（元素按从上到下浮现、扫描光带一起走），框跟着光带淡掉，鼠标散开
    const SHOW = end + 220
    const DUR = 950
    at(SHOW, () => {
      mask.style.setProperty('--dur', DUR + 'ms')
      mask.classList.add('go')
      for (const { box, b } of boxes) setTimeout(() => { box.style.opacity = '0' }, Math.round((Math.max(0, b.y) / vh) * DUR * 0.7))
      curs.forEach((c, i) => { move(c, vw * (0.25 + i * 0.25), vh + 30, 520); setTimeout(() => c.d.classList.remove('on'), 260) })
      buildIn()
    })
    const done = () => stopBuild()
    at(SHOW + DUR + 380, done)
    // 用户动了（点、滚、按键）：直接跳过，别挡着
    const skip = () => { if (building && !building.shown) done() }
    addEventListener('pointerdown', skip, true)
    addEventListener('wheel', skip, { capture: true, passive: true })
    addEventListener('keydown', skip, true)
    building = { nodes, timers, skip, shown: false }
    at(SHOW, () => { if (building) building.shown = true })
  }

  function stopBuild() {
    if (!building) return
    for (const t of building.timers) clearTimeout(t)
    for (const n of building.nodes) n.remove()
    removeEventListener('pointerdown', building.skip, true)
    removeEventListener('wheel', building.skip, { capture: true })
    removeEventListener('keydown', building.skip, true)
    building = null
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

  /**
   * 最外层那块的实际大小 [宽, 高]（幻灯片 / 海报常写死 1440×810，比框大的话画幅要跟它走）。
   * 正好和框一样大（自适应的，或画幅已经跟过来了）、几页竖着堆的、还有别的东西往外撑的：null
   */
  function naturalSize() {
    const b = document.body
    if (!b) return null
    const skip = (el) => el.hasAttribute('data-dsh-design') || /^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(el.tagName)
    let best = null
    let box = null
    let area = 0
    for (const el of [b, ...b.children]) {
      if (skip(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width * r.height > area) { area = r.width * r.height; best = r; box = el }
    }
    if (!best) return null
    // 一样大的几页竖着堆（一个文件里放了几张幻灯片 / 海报）：不是一页
    const kids = [...box.children].filter((k) => !skip(k)).map((k) => k.getBoundingClientRect()).filter((r) => r.width && r.height)
    if (kids.length >= 2 && kids[0].height >= innerHeight * 0.8 && kids.every((r) => Math.abs(r.width - kids[0].width) < 2 && Math.abs(r.height - kids[0].height) < 2) && kids[1].top >= kids[0].bottom - 1) return null
    const right = best.right + scrollX
    const bottom = best.bottom + scrollY
    const w = Math.ceil(Math.max(best.width, right))
    const h = Math.ceil(Math.max(best.height, bottom))
    if (Math.abs(w - innerWidth) <= 1 && Math.abs(h - innerHeight) <= 1) return null
    const de = document.scrollingElement || document.documentElement
    return de.scrollWidth > Math.max(innerWidth, right) + 40 || de.scrollHeight > Math.max(innerHeight, bottom) + 40 ? null : [w, h]
  }

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
      natural: naturalSize(),
      changes: pending ? { count: pending.count, whole: pending.whole } : null,
    })
    postTop()
    if (document.readyState !== 'complete') addEventListener('load', postTop, { once: true }) // 顶栏的底色可能等样式表 / 字体载完才定
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
   * 元素上的行内 style 盖过它就是 { inline: true, ...被盖过的那条 }。只看生效的 @media；层（@layer）不细算。
   * keys 默认是调样式面板那几项；体检找原因时只问一项（如 margin-top）
   */
  function rulesOf(el, keys = STYLE_KEYS) {
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
        for (const k of keys) {
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
    for (const k of keys) {
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

  /** 页面里跳到别的屏的地方：路径 + 在视口里的位置（画布上从这里画一条线到那一屏）
   *  shown：只要这会儿露在外面的（画布连线用；导出、交接要全部） */
  function linksOf(shown) {
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
      // 被固定的底栏 / 顶栏盖住的按钮（滚到它下面了）看不见，画布上别从它出线
      const top = shown ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
      if (top && top !== el && !el.contains(top) && !(host && host.contains(top))) continue
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
    const links = linksOf(true)
    linkSig = JSON.stringify(links)
    addEventListener('resize', () => { clearTimeout(linkTimer); linkTimer = setTimeout(resendLinks, 120) })
    setTimeout(resendLinks, 600)
    return links
  }
  function resendLinks() {
    const links = linksOf(true)
    const sig = JSON.stringify(links)
    if (sig === linkSig) return
    linkSig = sig
    post({ type: 'links', links })
  }

  if (STRICT) {
    const offsite = (raw) => {
      const v = String(raw || '').trim()
      if (!v || v.startsWith('#')) return ''
      let u
      try { u = new URL(v, here()) } catch { return v.slice(0, 200) }
      return u.origin === hereUrl().origin ? '' : u.href.slice(0, 200)
    }
    addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null
      if (!a) return
      const dl = a.hasAttribute('download')
      const out = offsite(a.getAttribute('href'))
      // 下载、开新窗口沙盒本来就不让；站外的地址这里直接挡（带 download 的按「下载」报）
      if (!out && !dl) return
      e.preventDefault()
      e.stopImmediatePropagation()
      post({ type: 'blocked', href: dl ? 'download' : out })
    }, true)
    if (window.navigation && typeof navigation.addEventListener === 'function') {
      navigation.addEventListener('navigate', (e) => {
        if (!e.cancelable || e.navigationType === 'traverse') return
        const out = offsite(e.destination && e.destination.url)
        if (!out && !e.downloadRequest) return
        e.preventDefault()
        post({ type: 'blocked', href: out || 'download' })
      })
    }
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
    if (opts && opts.build) build(opts.lang === 'en' ? 'en' : 'zh')
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
  async function inlineUrls(value, base, inline, idp = '') {
    if (!value || value.indexOf('url(') < 0) return value
    // 指着这一页里的东西（SVG 的渐变、裁剪、滤镜：url(#area)）：留成页内引用，别当文件去下载
    const page = String(base || '').split('#')[0]
    const local = new Map()
    const jobs = []
    value.replace(URL_RE, (m, q, u) => {
      if (u.startsWith('#')) local.set(u, '#' + idp + u.slice(1))
      else {
        try { const a = new URL(u, base); if (a.hash && a.href.split('#')[0] === page) local.set(u, '#' + idp + a.hash.slice(1)) } catch { /* 怪地址 */ }
      }
      if (!local.has(u)) jobs.push(u)
      return m
    })
    const map = new Map()
    await Promise.all(jobs.map(async (u) => {
      let abs = u
      try { abs = new URL(u, base).href } catch { /* 原样 */ }
      map.set(u, await inline(abs))
    }))
    return value.replace(URL_RE, (m, q, u) => (local.has(u) ? `url("${local.get(u)}")` : map.get(u) ? `url("${map.get(u)}")` : 'none'))
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
    const r = el.ownerDocument.createRange()
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
    return bg(de) || bg(document.body) || (schemeDark() ? '#121212' : '#fff')
  }

  /**
   * 页面实际用的是深色配色吗（决定没写底色时画布是白的还是深的）：color-scheme（没写看 <meta name="color-scheme">）只有 dark，
   * 或 light、dark 都写了而系统偏好深色
   */
  function schemeDark() {
    let s = String(getComputedStyle(document.documentElement).colorScheme || 'normal')
    if (s === 'normal') { const m = document.querySelector('meta[name="color-scheme"]'); s = m ? String(m.getAttribute('content') || '') : '' }
    if (!/dark/.test(s)) return false
    return !/light/.test(s) || matchMedia('(prefers-color-scheme: dark)').matches
  }

  async function capture(opts) {
    const full = !!opts.full
    const scale = Math.min(3, Math.max(1, Number(opts.scale) || 2))
    const de = document.documentElement
    const W = Math.ceil(de.clientWidth || innerWidth)
    const H = Math.ceil(full ? Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight) : innerHeight)
    const box = makeSandbox()
    const inline = makeInliner()
    // 只截看得到的这一屏（不是整页）：页面滚过、里面的滚动区滚过、有贴住的（sticky）元素，画成图时都得照现在的样子摆
    const view = !full
    const stuck = view ? stickyShift(document) : new Map()
    // 页面滚过时 body 整体往上挪（transform），body 就成了里面固定元素的定位基准：跟着窗口走的固定元素按 body 的位置换算回去，还贴在窗口原来的地方
    const lift = view && !!(scrollX || scrollY) && !!document.body
    let bodyAt = null
    if (lift) {
      const br = document.body.getBoundingClientRect()
      const bcs = getComputedStyle(document.body)
      bodyAt = { l: br.left + (parseFloat(bcs.borderLeftWidth) || 0), t: br.top + (parseFloat(bcs.borderTopWidth) || 0) }
    }
    // 怪异模式下 body.scrollTop 就是页面滚动；内嵌页面的根元素滚过（它自己的页面滚动）也照样往回挪
    // 内嵌页面画的总是它现在看得到的那块：里面的滚动（整页导出时也算）都补
    const ownScroll = (el) => el.ownerDocument !== document || (view && el !== de && (el !== document.body || document.compatMode === 'CSS1Compat'))
    // 资源地址按元素所在的那页算（内嵌页面有自己的地址）
    const baseOf = (el) => { const b = el.ownerDocument.baseURI || ''; return /^https?:/.test(b) ? b : here() }
    // 子树里还在找定位基准的绝对 / 固定定位（a / f）：滚动区的孩子要是改成相对定位，会把这些绝对定位抢过来（换了基准、还被滚动区裁掉）
    const openOf = new Map()
    const pseudoRules = []
    const families = new Set()
    const jobs = []
    let seq = 0
    // <use href="icons.svg#x">：画成图时（SVG 当图片）不会去载别的文件，图标全没了。
    // 把用到的那个图标复制进画出来的页面，href 改成指它（和 bundle.js 远程看时一样的道理）
    const sprites = document.createElementNS(SVGNS, 'svg')
    sprites.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    const spriteDocs = new Map()
    const spriteIds = new Map()
    const spriteOf = (abs) => {
      if (spriteIds.has(abs)) return spriteIds.get(abs)
      const u = new URL(abs)
      const frag = decodeURIComponent(u.hash.slice(1))
      u.hash = ''
      if (!spriteDocs.has(u.href)) {
        spriteDocs.set(u.href, fetch(u.href, { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.text() : ''))
          .then((t) => (t ? new DOMParser().parseFromString(t, 'image/svg+xml') : null))
          .catch(() => null))
      }
      const p = spriteDocs.get(u.href).then((doc) => {
        const src = doc && frag ? doc.getElementById(frag) : null
        if (!src || src.namespaceURI !== SVGNS) return ''
        const id = 'ddpu' + (++seq)
        const copy = document.importNode(src, true)
        copy.setAttribute('id', id)
        sprites.appendChild(copy)
        return id
      })
      spriteIds.set(abs, p)
      return p
    }

    // ctx：往下传「以哪个滚过的滚动区为定位基准」——a：绝对定位的后代该往回挪多少，f：固定定位的（滚动区有变换时）
    const NO_SHIFT = { a: [0, 0], f: [0, 0] }
    const idPre = new Map([[document, '']])
    function walk(node, ctx = NO_SHIFT) {
      if (node.nodeType === 3) return document.createTextNode(node.nodeValue)
      if (node.nodeType !== 1) return null
      const el = node
      const idp = idPre.get(el.ownerDocument) || ''
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
          let v = a.value
          // 内嵌页面的 id 和页内引用加上这一页的前缀：几页里同名的渐变、裁剪不会串
          if (idp) {
            if (a.name === 'id') v = idp + v
            else if (/(^|:)href$/.test(a.name) && v.startsWith('#')) v = '#' + idp + v.slice(1)
            else if (v.indexOf('url(') >= 0) v = v.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/g, (m, q, id) => `url(#${idp}${id})`)
          }
          try { c.setAttributeNS(a.namespaceURI, a.name, v) } catch { /* 怪属性名 */ }
        }
      }
      if (el.namespaceURI === SVGNS && el.getAttribute('class')) c.setAttribute('class', el.getAttribute('class'))

      const withUrls = []
      const def = box.defaults(el)
      let st = styleText(cs, def, withUrls)
      if (el === de) st += 'overflow:hidden;'
      // iframe / 视频换成了 div：默认的 300×150、行内排列也得写明（和 iframe 默认一样的样式上面省掉了）
      if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'OBJECT' || tag === 'EMBED') {
        st += `display:${cs.display === 'inline' ? 'inline-block' : cs.display};width:${cs.width};height:${cs.height};box-sizing:${cs.boxSizing};vertical-align:${cs.verticalAlign};overflow:hidden;`
      }
      // 贴住了：画成图时没有滚动，按量出来的偏移摆回现在的位置
      if (stuck.has(el)) { const [dx, dy] = stuck.get(el); st += `position:relative;inset:auto;left:${dx}px;top:${dy}px;` }
      // 以滚过的滚动区为基准的绝对 / 固定定位：跟着内容滚，往回挪（不管隔了几层）
      const owe = el.namespaceURI === SVGNS ? null : cs.position === 'absolute' ? ctx.a : cs.position === 'fixed' ? ctx.f : null
      if (owe && (owe[0] || owe[1])) st += shiftCss(cs, owe[0], owe[1])
      if (lift && cs.position === 'fixed' && el.namespaceURI !== SVGNS && el.ownerDocument === document && document.body.contains(el) && !fixedHeld(el)) {
        const x = parseFloat(cs.left)
        const y = parseFloat(cs.top)
        if (Number.isFinite(x) && Number.isFinite(y)) st += `left:${x - bodyAt.l}px;top:${y - bodyAt.t}px;right:auto;bottom:auto;`
      }
      // 原来一行放得下的字，画成图时也别折行（宽度是定死的，字体渲染差一丁点就会挤到第二行）
      if (el.namespaceURI !== SVGNS && cs.whiteSpace !== 'nowrap' && oneLine(el)) st += 'white-space:nowrap;'
      c.setAttribute('style', st)
      families.add(cs.fontFamily)
      if (withUrls.length) {
        // 等图片转好再换进去；换的时候读那一刻的 style（滚动区补的偏移是后来加上的，别盖掉）
        const vals = withUrls.map((p) => cs.getPropertyValue(p))
        jobs.push((async () => {
          const done = await Promise.all(vals.map((v) => inlineUrls(v, baseOf(el), inline, idp)))
          let s = c.getAttribute('style')
          withUrls.forEach((p, i) => { s = s.replace(`${p}:${vals[i]};`, `${p}:${done[i]};`) })
          c.setAttribute('style', s)
        })())
      }

      if (tag === 'IMG' && (el.currentSrc || el.src)) {
        const src = el.currentSrc || el.src
        jobs.push(inline(src).then((d) => { if (d) c.setAttribute('src', d); else c.removeAttribute('src') }))
      }
      if (el.namespaceURI === SVGNS && el.localName === 'image') {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        if (href) jobs.push(inline(new URL(href, baseOf(el)).href).then((d) => { if (d) c.setAttribute('href', d) }))
      }
      if (el.namespaceURI === SVGNS && el.localName === 'use') {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''
        let abs = ''
        try { abs = href && !href.startsWith('#') ? new URL(href, baseOf(el)).href : '' } catch { /* 怪地址 */ }
        if (abs && abs.includes('#')) {
          jobs.push(spriteOf(abs).then((id) => {
            if (!id) return
            c.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
            c.setAttribute('href', '#' + id)
          }))
        }
      }
      if (tag === 'INPUT') {
        if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', '') } else c.setAttribute('value', el.value)
      }
      if (tag === 'TEXTAREA') c.textContent = el.value
      if (tag === 'SELECT') c.setAttribute('data-v', el.value)

      // ::before / ::after（绝对 / 固定定位的：跟着它的定位基准滚，也算还在往外找基准的）
      let pa = false
      let pf = false
      if (el.namespaceURI !== SVGNS) {
        const pes = (tag === 'INPUT' || tag === 'TEXTAREA') && el.getAttribute('placeholder') ? ['::before', '::after', '::placeholder'] : ['::before', '::after']
        for (const pe of pes) {
          const ps = getComputedStyle(el, pe)
          const content = ps.getPropertyValue('content')
          if (pe !== '::placeholder' && (!content || content === 'none' || content === 'normal')) continue
          const cls = 'ddpx' + (++seq)
          c.setAttribute('class', ((c.getAttribute('class') || '') + ' ' + cls).trim())
          const urls = []
          let body = styleText(ps, box.defaults(el, pe), urls)
          const pp = ps.position
          if (pp === 'absolute' || pp === 'fixed') {
            const mine = pp === 'absolute' ? holds(cs) : holds(cs, true)
            const owe = mine ? (ownScroll(el) ? [el.scrollLeft, el.scrollTop] : [0, 0]) : pp === 'absolute' ? ctx.a : ctx.f
            if (owe[0] || owe[1]) body += shiftCss(ps, owe[0], owe[1])
            if (!mine) { if (pp === 'absolute') pa = true; else pf = true }
            // 贴着窗口的（比如 body::before 铺的固定背景）：页面滚过、body 整体挪了，按 body 的位置换算回去
            if (pp === 'fixed' && !mine && lift && el.ownerDocument === document && document.body.contains(el) && !fixedHeld(el)) {
              const x = parseFloat(ps.left)
              const y = parseFloat(ps.top)
              if (Number.isFinite(x) && Number.isFinite(y)) body += `left:${x - bodyAt.l}px;top:${y - bodyAt.t}px;right:auto;bottom:auto;`
            }
          }
          const i = pseudoRules.length
          pseudoRules.push(`.${cls}${pe}{${body}}`)
          if (urls.length) jobs.push(inlineUrls(pseudoRules[i], baseOf(el), inline, idp).then((t) => { pseudoRules[i] = t }))
        }
      }

      // 下面这几种不往里走：自己是绝对 / 固定定位的也得记上（外层滚动区挪的时候要知道）
      if ((tag === 'IFRAME' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'TEXTAREA') && (cs.position === 'absolute' || cs.position === 'fixed')) {
        openOf.set(el, { a: cs.position === 'absolute', f: cs.position === 'fixed' })
      }
      if (tag === 'IFRAME') {
        // 同源的内嵌页面：把它的页面也复制进来（框住、按它自己的滚动摆）；拿不到的（跨域）铺一层浅灰，看得出这里有东西没截到
        let doc = null
        try { doc = el.contentDocument } catch { doc = null }
        let inner = null
        if (doc && doc.documentElement && depth < 3) {
          depth++
          try { inner = walkIn(doc) } finally { depth-- }
        }
        // 里面固定定位的元素以这一框为准：框自己没变换的，补一个不动的变换
        if (inner) {
          c.setAttribute('style', c.getAttribute('style') + 'overflow:hidden;' + (cs.transform !== 'none' ? '' : 'transform:translate(0,0);'))
          c.appendChild(inner)
        } else c.setAttribute('style', c.getAttribute('style') + 'background-color:rgba(127,127,127,.15);')
        return c
      }
      if (tag === 'CANVAS' || tag === 'VIDEO' || tag === 'TEXTAREA') return c
      // 自己滚过的滚动区：里面的东西按滚动距离往回挪（图里没有滚动）
      const ox = el.namespaceURI !== SVGNS && ownScroll(el) ? el.scrollLeft : 0
      const oy = el.namespaceURI !== SVGNS && ownScroll(el) ? el.scrollTop : 0
      // 跟着内容滚的背景（background-attachment: local）也往回挪
      if ((ox || oy) && /local/.test(cs.backgroundAttachment)) {
        const att = cs.backgroundAttachment.split(',').map((x) => x.trim())
        const pos = cs.backgroundPosition.split(',').map((p, i) => {
          if (att[i % att.length] !== 'local') return p.trim()
          const [x = '0%', y = '0%'] = splitTop(p.trim())
          return `calc(${x} - ${ox}px) calc(${y} - ${oy}px)`
        })
        c.setAttribute('style', c.getAttribute('style') + `background-position:${pos.join(', ')};`)
      }
      let oa = false
      let of = false
      const kids = []
      // 自己是定位基准的：它的后代按它的滚动挪；不是的，接着用外面传进来的
      const hF = holds(cs, true)
      const hA = hF || cs.position !== 'static' // 和 holds(cs) 一样，少算一遍
      const sub = hA || hF ? { a: hA ? [ox, oy] : ctx.a, f: hF ? [ox, oy] : ctx.f } : ctx
      for (const child of el.childNodes) {
        const k = walk(child, sub)
        if (k) kids.push([child, k])
        const o = child.nodeType === 1 && openOf.get(child)
        if (o) { oa = oa || o.a; of = of || o.f }
      }
      if (ox || oy) scrollBack(kids, cs, ox, oy, stuck, openOf)
      for (const [, k] of kids) c.appendChild(k)
      if (hA) oa = false
      if (hF) of = false
      if (pa) oa = true
      if (pf) of = true
      if (cs.position === 'absolute') oa = true
      if (cs.position === 'fixed') of = true
      if (oa || of) openOf.set(el, { a: oa, f: of })
      if (tag === 'SELECT') {
        const o = el.selectedOptions && el.selectedOptions[0]
        c.textContent = ''
        const opt = document.createElementNS(XHTML, 'option')
        opt.textContent = o ? o.textContent : ''
        c.appendChild(opt)
      }
      return c
    }
    // 内嵌页面的那一份：它自己的根元素也当滚动区（滚过就往回挪），不算外层页面的根
    let depth = 0
    const docs = new Set([document])
    function walkIn(doc) {
      // 内嵌页面里贴住的元素也按它现在的样子摆
      for (const [el, v] of stickyShift(doc)) stuck.set(el, v)
      docs.add(doc)
      if (!idPre.has(doc)) idPre.set(doc, `ddpf${++seq}-`)
      const r = doc.documentElement
      // 以整页为准的绝对定位跟着这一页滚
      const k = walk(r, { a: [r.scrollLeft, r.scrollTop], f: [0, 0] })
      if (k) k.setAttribute('style', (k.getAttribute('style') || '') + 'overflow:hidden;')
      return k
    }

    try {
      const top = topDark() // 和复制页面同一刻量（后面等图片、字体时页面可能又变了）
      const root = walk(de)
      // 字体：页面样式表里的 @font-face，只带用到的字族
      const faces = []
      const used = [...families].join(',').toLowerCase()
      // 内嵌页面的规则是它那个窗口的类，instanceof 认不出来，按 type 认（5 = @font-face）
      const isFace = (r) => r.type === 5 || r instanceof CSSFontFaceRule
      for (const d of docs) {
        for (const sheet of d.styleSheets) {
          let rules
          try { rules = sheet.cssRules } catch { continue }
          const base = d === document ? sheetHref(sheet) : sheet.href || d.baseURI
          const scan = (list) => {
            for (const r of list) {
              if (r.cssRules && !isFace(r)) { try { scan(r.cssRules) } catch { /* 读不了 */ } continue }
              if (!isFace(r)) continue
              const fam = (r.style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim().toLowerCase()
              if (fam && used.includes(fam)) faces.push(inlineUrls(r.cssText, base, inline))
            }
          }
          scan(rules)
        }
      }
      await Promise.all(jobs)
      const fontCss = (await Promise.all(faces)).join('\n')
      const style = document.createElementNS(XHTML, 'style')
      style.textContent = fontCss + '\n' + pseudoRules.join('\n') + '\n*::-webkit-scrollbar{display:none}'
      const body = [...root.childNodes].find((n) => n.localName === 'body')
      ;(body || root).insertBefore(style, (body || root).firstChild)
      if (sprites.childNodes.length) (body || root).appendChild(sprites)
      if (!full && (scrollX || scrollY) && body) {
        // 用 translate 属性挪：它在 transform / scale / rotate 外面一层，body 自己缩放旋转过也照样整体挪滚动距离
        const t0 = String(getComputedStyle(document.body).translate || 'none')
        const [tx = '0px', ty = '0px', tz = ''] = t0 === 'none' ? [] : splitTop(t0)
        body.setAttribute('style', body.getAttribute('style') + `translate:calc(${tx} - ${scrollX}px) calc(${ty} - ${scrollY}px)${tz ? ' ' + tz : ''};`)
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
      return { png, w: W, h: H, scale, top }
    } finally {
      box.remove()
    }
  }

  /** 贴住的（sticky）元素现在被贴偏了多少：量现在的位置，临时取消贴住再量一次，差就是偏移（同一刻改回去，不重画） */
  function stickyShift(doc) {
    const out = new Map()
    const list = []
    for (const el of doc.querySelectorAll('body *')) {
      if (getComputedStyle(el).position === 'sticky') list.push(el)
      if (list.length >= 400) break
    }
    if (!list.length) return out
    const live = list.map((el) => [el.offsetLeft, el.offsetTop])
    const st = doc.createElement('style')
    st.textContent = '[data-dsh-unstick]{position:relative!important;inset:auto!important}'
    doc.documentElement.appendChild(st)
    try {
      for (const el of list) el.setAttribute('data-dsh-unstick', '')
      // 按排版坐标量（offsetLeft / offsetTop 不受缩放、旋转影响；相对最近的定位祖先，外层也贴住了的那份不会重复算）
      list.forEach((el, i) => {
        const dx = live[i][0] - el.offsetLeft
        const dy = live[i][1] - el.offsetTop
        if (dx || dy) out.set(el, [dx, dy])
      })
    } finally {
      for (const el of list) el.removeAttribute('data-dsh-unstick')
      st.remove()
    }
    return out
  }

  /** 固定元素是不是被某个祖先（transform、filter 之类）接管了位置：接管了就跟着那个祖先走，不用挪 */
  function fixedHeld(el) {
    for (let a = el.parentElement; a; a = a.parentElement) if (holds(getComputedStyle(a), true)) return true
    return false
  }

  /**
   * 滚过的滚动区：里面的东西按滚动距离往回挪（图里没有滚动）。kids：[原节点, 复制出来的] 按顺序，挪的时候可能换掉复制出来的那个。
   * 能不动定位就不动（改成相对定位会打乱上下层、把往外找基准的绝对定位框进来）：
   * 竖着滚的块容器 / 竖排 flex，给第一个在文档流里的块加负的上边距，后面的跟着往上走；横着滚的横排 flex 同理加左边距，块容器给每个块加左边距。
   * 别的排法（grid 之类）退回一个个用相对定位挪；绝对 / 固定定位的（以滚动区为准的）改它自己的 left / top
   */
  function scrollBack(kids, pcs, ox, oy, stuck, openOf) {
    const flex = /flex/.test(pcs.display)
    const grid = /grid/.test(pcs.display)
    const dir = String(pcs.flexDirection || 'row')
    const row = flex && dir === 'row'
    const col = flex && dir === 'column'
    const rtl = pcs.direction === 'rtl'
    const add = (k, css) => k.setAttribute('style', (k.getAttribute('style') || '') + css)
    const info = kids.map(([child, k]) => {
      if (child.nodeType !== 1) return { child, k, flow: true, text: !!(child.nodeValue || '').trim(), blank: !(child.nodeValue || '').trim() }
      const ccs = getComputedStyle(child)
      const out = ccs.position === 'absolute' || ccs.position === 'fixed'
      return { child, k, ccs, flow: !out, inline: !flex && !grid && /^inline/.test(ccs.display) }
    })
    const flow = info.filter((x) => x.flow && !x.blank)
    const first = flow[0]
    // 负边距能整列带着走的：普通的块（不浮动、不是 display:contents）
    const block = (x) => x && !x.text && !x.inline && x.ccs.float === 'none' && x.ccs.display !== 'contents'
    const floats = flow.some((x) => x.ccs && x.ccs.float !== 'none')
    // flex 主轴不是从头排的（居中、两端对齐……）：加了负边距会重新排，退回一个个挪
    const startish = (v) => /^(normal|flex-start|start|left|stretch)$/.test(String(v || 'normal'))
    let fy = oy
    let fx = ox
    let spacer = null
    if (oy && block(first) && !floats && !flex && !grid) {
      // 块容器：前面垫一个高 0、上边距为负的块（自己是 BFC，边距不和后面的叠），后面的照原来的边距（包括往里叠的）往下排
      spacer = document.createElementNS(XHTML, 'div')
      spacer.setAttribute('style', `display:flow-root;height:0;margin:-${oy}px 0 0;padding:0;border:0`)
      fy = 0
    } else if (oy && block(first) && col && startish(pcs.justifyContent)) {
      // flex 里边距不叠：直接给第一个加
      add(first.k, `margin-top:${(parseFloat(first.ccs.marginTop) || 0) - oy}px;`)
      fy = 0
    }
    if (ox && !rtl && block(first) && row && startish(pcs.justifyContent)) {
      add(first.k, `margin-left:${(parseFloat(first.ccs.marginLeft) || 0) - ox}px;`)
      fx = 0
    } else if (ox && !rtl && !flex && !grid && !floats && flow.length && flow.every(block)) {
      // 块是一个个摆的，横着各挪各的（宽度已经按原来的定死，不会被负边距撑宽）
      for (const x of flow) add(x.k, `margin-left:${(parseFloat(x.ccs.marginLeft) || 0) - ox}px;`)
      fx = 0
    }
    // 绝对 / 固定定位的在 walk 里按定位基准挪过了；剩下没挪成的一个个挪
    for (const x of info) {
      if (x.blank || !x.flow) continue
      if (fx || fy) x.k = scrolledKid(x.k, x.child, pcs, fx, fy, stuck, openOf.get(x.child))
    }
    info.forEach((x, i) => { kids[i][1] = x.k })
    if (spacer) kids.splice(kids.findIndex(([c]) => c === first.child), 0, [null, spacer])
  }

  /** 按空格拆一个 CSS 值（括号里的空格不拆：calc()、clamp() 整个算一段） */
  function splitTop(v) {
    const out = []
    let cur = ''
    let depth = 0
    for (const ch of String(v)) {
      if (ch === '(') depth++
      else if (ch === ')') depth = Math.max(0, depth - 1)
      if (/\s/.test(ch) && !depth) { if (cur) out.push(cur); cur = '' } else cur += ch
    }
    if (cur) out.push(cur)
    return out
  }

  /** 定位元素往回挪 (dx, dy)：只动挪了的那个方向；从右往左排的横向按 right 挪 */
  function shiftCss(cs, dx, dy) {
    let css = ''
    if (dy) { const y = parseFloat(cs.top); if (Number.isFinite(y)) css += `top:${y - dy}px;bottom:auto;` }
    if (dx) {
      if (cs.direction === 'rtl') { const r = parseFloat(cs.right); if (Number.isFinite(r)) css += `right:${r + dx}px;left:auto;` } else { const x = parseFloat(cs.left); if (Number.isFinite(x)) css += `left:${x - dx}px;right:auto;` }
    }
    return css
  }

  /**
   * 滚过的滚动区里的一个孩子，用相对定位往回挪。
   * 不跟着滚的不挪：固定定位（滚动区没接管它）、包含块在滚动区外面的绝对定位。
   * 本来没定位、里面又有还在往外找基准的绝对定位的（比如以外层为准的弹层）：改成相对定位会把它们框进来，这一块宁可不挪
   */
  function scrolledKid(k, child, pcs, ox, oy, stuck, open) {
    if (child.nodeType === 3) {
      if (!child.nodeValue.trim()) return k
      const s = document.createElementNS(XHTML, 'span')
      s.setAttribute('style', `position:relative;left:${-ox}px;top:${-oy}px;`)
      s.appendChild(k)
      return s
    }
    if (child.nodeType !== 1) return k
    const ccs = getComputedStyle(child)
    const pos = ccs.position
    if ((pos === 'fixed' && !holds(pcs, true)) || (pos === 'absolute' && !holds(pcs))) return k
    if (pos === 'static' && open && open.a) return k
    let x = 0
    let y = 0
    if (stuck.has(child)) [x, y] = stuck.get(child)
    else if (pos !== 'static' && pos !== 'sticky') { x = parseFloat(ccs.left) || 0; y = parseFloat(ccs.top) || 0 }
    const keep = pos === 'absolute' || pos === 'fixed'
    // 从右往左排的：右边的偏移才算数
    const hx = ccs.direction === 'rtl' && !stuck.has(child) && pos !== 'static' && pos !== 'sticky'
      ? `right:${(parseFloat(ccs.right) || 0) + ox}px;left:auto;`
      : `left:${x - ox}px;right:auto;`
    k.setAttribute('style', (k.getAttribute('style') || '') + `position:${keep ? pos : 'relative'};${ox ? hx : ''}${oy ? `top:${y - oy}px;bottom:auto;` : ''}`)
    return k
  }

  async function onCapture(d) {
    try {
      const r = await capture(d)
      // 整页图从文档顶上画起，链接加上滚动距离；只截视口时就是视口里的位置
      const links = linksOf().map((l) => (d.full ? { ...l, x: l.x + scrollX, y: l.y + scrollY } : l))
        .filter((l) => l.x < r.w && l.y < r.h && l.x + l.w > 0 && l.y + l.h > 0)
      post({ type: 'captured', id: d.id, png: r.png, w: r.w, h: r.h, scale: r.scale, title: document.title, links, top: r.top, href: here() })
    } catch (e) {
      post({ type: 'captured', id: d.id, error: String((e && e.message) || e) })
    }
  }

  // ── 设计体检：在画好的页面上实测常见毛病，标在页面上，报给右侧栏（给人看的文字由右侧栏按界面语言拼） ──
  //
  //   hscroll 超出屏幕（会横向滚动 / 被切掉） · clipped 文字被截断 · overflow 文字超出框 · overlap 文字叠在一起
  //   contrast 对比度不够 · tap 点击区太小 · tiny 字太小 · img 图片没加载出来 · fonts 字号太杂
  //   covered 被固定栏压住（滚到底也看不全） · tight 离固定栏太近 · jserr 页面脚本报错 · missing 样式表 / 脚本 / 字体没载出来
  //   capsule 小程序右上角的胶囊（微信画的，页面盖不住）挡住了字或按钮
  //   island 灵动岛挡住了字或按钮 · homebar 底栏里的字、图标伸进底部横条区 · tabbar 标签栏超过 5 项 · navbar 小程序这屏没有导航栏
  //   winctl 桌面软件的窗口按钮（Mac 红绿灯 / Windows 右上角三个）挡住了字或按钮
  // 有意为之的不报：省略号（text-overflow: ellipsis）、行数截断（line-clamp）、可以滚动的区域（轮播）、很淡的装饰大字。

  const CHECK_PER = 8 // 每类最多报几条
  const CHECK_MAX = 40
  const CHECK_ATOMS = 600 // 最多看多少个带字的元素
  const CLICKABLE = 'a[href],button,[role="button"],[role="tab"],[role="link"],input:not([type="hidden"]),select,textarea,summary,[onclick],[data-href]'
  // 小程序右上角的胶囊：离屏幕顶 48（状态栏 44 + 4）、离右边 7、87×32（和右侧栏外框画的一样）
  const CAP = { top: 48, right: 7, w: 87, h: 32 }
  // 预览手机的灵动岛：离顶 11、118×34、居中（和外框 .ddp-island 一样）；矮的手机（高不到宽的 1.9 倍）没有，也没有底部横条
  const ISLAND = { top: 11, w: 118, h: 34 }
  const HOMEBAR = 34 // 底部横条区（home indicator）的高
  const NAVBAR = { top: 44, h: 44 } // 小程序导航栏：状态栏 44 下面那 44
  // 桌面软件的窗口按钮（和右侧栏外框画的一样）：Mac 红绿灯在左上 x 20、y 20 起，三个 12px 圆点隔 8；Windows 最小化 / 最大化 / 关闭在右上角，各 46×32
  const LIGHTS = { x: 20, y: 20, d: 12, gap: 8 }
  const WINBTN = { w: 46, h: 32 }
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

  /**
   * 'rgb(1, 2, 3)' / 'rgba(1, 2, 3, .5)' / 'color(srgb …)' → [r, g, b, a]。
   * oklch()、oklab()、lab()、lch()、hwb()、color(display-p3 …) 这些（算好的值保留原写法，Tailwind 4 默认就是 oklch）：交给 canvas 换成 sRGB。认不出就 null
   */
  const colorMemo = new Map()
  let colorCtx = null
  function rgba(s) {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]]
    const c = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (c) return [c[1] * 255, c[2] * 255, c[3] * 255, c[4] == null ? 1 : c[4].endsWith('%') ? parseFloat(c[4]) / 100 : +c[4]]
    if (typeof s !== 'string' || !/^(?:oklch|oklab|lab|lch|hwb|hsla?|color)\(/.test(s)) return null
    if (colorMemo.has(s)) return colorMemo.get(s)
    let out = null
    try {
      if (!colorCtx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; colorCtx = cv.getContext('2d', { willReadFrequently: true }) }
      const g = colorCtx
      g.fillStyle = '#010203'
      g.fillStyle = s
      if (g.fillStyle !== '#010203') {
        g.clearRect(0, 0, 1, 1)
        g.fillRect(0, 0, 1, 1)
        const d = g.getImageData(0, 0, 1, 1).data
        out = [d[0], d[1], d[2], d[3] / 255]
      }
    } catch { out = null }
    if (colorMemo.size > 500) colorMemo.clear()
    colorMemo.set(s, out)
    return out
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
   * 字背后的底色，和字叠上去以后的颜色：从字往下一层层叠背景色，遇到不透明（且不在半透明的组里）的为止；
   * 透明度按组算（见 compose），字的透明度也一样。中间有背景图、渐变、图片视频就说不准，返回 null。
   * 字在屏幕里时按实际叠放顺序找（字下面压着的可能不是祖先，比如首屏背景视频、不可点的装饰底）；
   * 不在屏幕里、或被滚动区裁掉的按位置找（paintedBelow）。pool：页面上画了底的元素（见 paintPool）
   */
  function backdrop(el, pt, fg, pool) {
    let chain = null
    if (pt.x >= 0 && pt.y >= 0 && pt.x < innerWidth && pt.y < innerHeight) {
      const stack = paintedAt(pt.x, pt.y) // 不可点的背景层（装饰底图、卡片底色）也算
      const i = stack.indexOf(el)
      if (i >= 0) chain = stack.slice(i)
    }
    if (!chain) chain = paintedBelow(el, pt.x, pt.y, pool())
    if (!chain) return null
    const { base, explicit, onCanvas } = canvasBase()
    const layers = []
    let floor = false
    for (const e of chain) {
      if (isOurs(e)) continue
      if (e !== el && !e.contains(el) && opacityChain(e) <= 0.01) continue // 整个透明的装饰层（淡入前、藏起来的）什么都没画
      if (MEDIA.has(e.tagName) || (e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg')) return null
      const cs = getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = rgba(cs.backgroundColor)
      if (!c) return null
      if (onCanvas(e) || c[3] <= 0) continue
      layers.push([e, c])
      if (c[3] >= 0.999 && opacityChain(e) >= 0.999) { floor = true; break }
    }
    if (!floor && darkOn && !explicit) return null // 深色模式下画布底色不一定是白的
    layers.reverse()
    return { color: compose(layers, base), fg: fg ? compose([...layers, [el, fg]], base) : null }
  }

  /**
   * 页面上画了东西、看得见的元素（底色、背景图、图片视频、SVG 图形）和它们现在的框，按位置找背景用。
   * 按最近的固定 / 吸顶那层（自己或祖先，没有是 null）分组，组里按竖直位置分段放（rows，每段 POOL_ROW px）
   */
  const POOL_ROW = 256
  function paintPool() {
    const groups = new Map()
    const pins = new Map()
    const held = new Map() // 祖先里有给固定定位当包含块的（transform 之类）：里面的 fixed 其实跟着它走
    const heldIn = (e) => {
      if (!e || e.nodeType !== 1) return false
      if (!held.has(e)) held.set(e, holds(getComputedStyle(e), true) || heldIn(e.parentElement))
      return held.get(e)
    }
    const pinOf = (e) => {
      if (!e || e.nodeType !== 1) return null
      if (pins.has(e)) return pins.get(e)
      const pos = getComputedStyle(e).position
      const v = pos === 'sticky' || (pos === 'fixed' && !heldIn(e.parentElement)) ? e : pinOf(e.parentElement)
      pins.set(e, v)
      return v
    }
    const all = [document.documentElement, ...(document.body ? [document.body, ...document.body.getElementsByTagName('*')] : [])]
    for (const e of all) {
      if (isOurs(e)) continue
      const svg = e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg'
      const cs = getComputedStyle(e)
      if (cs.visibility !== 'visible') continue
      const c = rgba(cs.backgroundColor)
      if (!svg && !MEDIA.has(e.tagName) && c && c[3] <= 0 && cs.backgroundImage === 'none') continue
      const r = e.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const pin = pinOf(e)
      if (!groups.has(pin)) groups.set(pin, { rows: new Map(), all: [] })
      const g = groups.get(pin)
      g.all.push([e, r])
      for (let k = Math.floor(r.top / POOL_ROW), n = Math.floor(r.bottom / POOL_ROW); k <= n; k++) {
        if (!g.rows.has(k)) g.rows.set(k, [])
        g.rows.get(k).push([e, r])
      }
    }
    // 固定 / 吸顶的那些对这个字来说看得见吗：整体透明的不算（量过记着）；被它自己那一支（不包着字的那几层）裁光的不算，
    // 和字共用的滚动区暂时裁掉的照算（字滚进来时它也跟着进来）
    const gone = new Map()
    const clear = (e) => {
      if (!gone.has(e)) gone.set(e, opacityChain(e) <= 0.01)
      return gone.get(e)
    }
    const shown = (e, r, el) => !clear(e) && !!restBox(e, true, el)({ l: r.left, r: r.right, t: r.top, b: r.bottom })
    return { groups, pinOf, shown, clear }
  }

  /** 底色不透明、没有背景图、不在半透明组里：叠到它就到底了 */
  function solidFloor(e) {
    if (MEDIA.has(e.tagName) || e instanceof SVGElement) return false
    const cs = getComputedStyle(e)
    const c = rgba(cs.backgroundColor)
    return !!c && c[3] >= 0.999 && cs.backgroundImage === 'none' && opacityChain(e) >= 0.999
  }

  /**
   * 字所在这一点（视口坐标，可以在屏幕外、被滚动区裁掉）下面画着的，从字往下排：框盖住这一点、画在字下面的（祖先，或按层叠顺序在它下面的）；
   * 只算它自己那一支的裁剪。字在能滚的区域（main、横向轮播）里没滚进来时，对那个区域外面的东西（和区域自己的底）来说，
   * 字滚进来以后在区域露出来的那块里——按就近滚进来算位置（由里往外一层层挪进去）。
   * 和字不在同一个固定 / 吸顶层里的跟着窗口走，字滚进来以后它在哪说不准：横向盖得住、画在字下面、又不在到底那层（字自己的底也算）下面的，
   * 返回 null（不查）。不滚页面（滚了会打断页面自己的滚动、带着外层画布一起滚）
   */
  function paintedBelow(el, x, y, pool) {
    const mine = new Set([null]) // 和字一起动的：不固定的，和字所在的各层固定 / 吸顶
    for (let p = pool.pinOf(el); p; p = pool.pinOf(p.parentElement)) mine.add(p)
    // 字外面会裁的各层（由里往外）和字一层层挪进去以后的位置：pts[j] = 挪进了前 j 层
    const boxes = []
    const pts = [{ x, y }]
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const cx = cs.overflowX !== 'visible', cy = cs.overflowY !== 'visible'
      if (!cx && !cy) continue
      const r = e.getBoundingClientRect()
      const kx = e.offsetWidth ? r.width / e.offsetWidth : 1 // 这层实际的缩放（transform、zoom），和 restBox 一样换成视口像素
      const ky = e.offsetHeight ? r.height / e.offsetHeight : 1
      const l = r.left + e.clientLeft * kx, t = r.top + e.clientTop * ky
      const q = pts[pts.length - 1]
      boxes.push(e)
      pts.push({ x: cx ? Math.min(Math.max(q.x, l + 1), l + e.clientWidth * kx - 1) : q.x, y: cy ? Math.min(Math.max(q.y, t + 1), t + e.clientHeight * ky - 1) : q.y })
    }
    // c 看到的字在哪：c 外面那几层（c 自己能滚的话也算，它的底不跟着内容走）挪进去以后
    const ptFor = (c) => { let j = 0; while (j < boxes.length && (boxes[j] === c || !boxes[j].contains(c))) j++; return pts[j] }
    const near = new Set()
    for (const pin of mine) {
      const g = pool.groups.get(pin)
      if (!g) continue
      for (const k of new Set(pts.map((p) => Math.floor(p.y / POOL_ROW)))) for (const it of g.rows.get(k) || []) near.add(it)
    }
    const below = []
    for (const [c, r] of near) {
      if (c === el || el.contains(c)) continue
      const p = ptFor(c)
      if (p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) continue
      if (!paintsOver(el, c)) continue // 盖在字上面的不算
      if (!c.contains(el)) {
        const vis = restBox(c, true, el)({ l: r.left, r: r.right, t: r.top, b: r.bottom })
        if (!vis || p.x < vis.l || p.x > vis.r || p.y < vis.t || p.y > vis.b) continue
      }
      below.push(c)
    }
    below.sort((a, b) => (paintsOver(a, b) ? -1 : paintsOver(b, a) ? 1 : 0))
    const { onCanvas } = canvasBase()
    const floor = [el, ...below].find((c) => !onCanvas(c) && solidFloor(c))
    const out = pts[pts.length - 1].x // 各层都挪进去以后的横向位置
    for (const [pin, g] of pool.groups) {
      if (mine.has(pin)) continue
      for (const [c, r] of g.all) {
        if (out < r.left || out > r.right || pool.clear(c) || el.contains(c)) continue
        if (floor && paintsOver(floor, c)) continue // 在到底那层下面（同一层的字都一样，记着）
        if (paintsOver(el, c) && pool.shown(c, r, el)) return null
      }
    }
    return [el, ...below]
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

  /** 滚完等两帧、再等新露出来的图和字体（页面的滚动监听、懒加载的图有机会跟上），再截图 */
  const afterScroll = (v) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(v)))).then((v2) => settle().then(() => v2, () => v2))

  function barsAt(edge, inflow = false) {
    const out = []
    const vw = innerWidth, vh = innerHeight
    // inflow：页面本身不滚（flex / grid 撑满一屏、中间内容区自己滚）时，贴着屏幕边的普通元素也算栏
    const shell = inflow && (document.scrollingElement || document.documentElement).scrollHeight <= vh + 2
    const all = document.body.getElementsByTagName('*')
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      if (isOurs(el)) continue
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute' && !shell) continue
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

  /**
   * 体检附图：把出问题的元素摆回量的时候的样子（被栏压住的滚到顶 / 底，别的滚到屏幕中间），
   * 红框圈出它（叠字时两个都圈；被栏压住的把栏调成半透明，透出下面的字），
   * 给出裁剪范围（整页坐标；连上叠着的元素、压住它的栏，四周留 24px，至少约 40% 宽、30% 高，不伸出视口，看得到周围的排版）。
   * also：挨着的几条问题的元素，在图里的也圈上，inside 里说哪几个在图里。
   * 叠着的另一个用橙色虚线框；upper 说哪个画在上面（self / other）；label 是标在红框上的数字（如「压住 44px」）。
   * 元素没了、没有大小、不在屏幕里给 null
   */
  let cutMarks = []
  let cutUndo = []
  async function cropAt({ sel, other, edge, hscroll, also = [], label = '' }) {
    for (const m of cutMarks) m.remove()
    for (const f of cutUndo) f()
    cutMarks = []
    cutUndo = []
    const q = (s) => { try { return s ? document.querySelector(s) : null } catch { return null } }
    const el = q(sel)
    if (!el) return null
    if (edge === 'top' || edge === 'bottom') scrollAll(scrollAreas(), edge === 'bottom')
    else {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }) } catch { el.scrollIntoView() }
      if (hscroll) scrollTo({ left: 0, top: scrollY, behavior: 'instant' }) // 伸出屏幕的：照用户看到的截，别横着滚过去
    }
    await afterScroll()
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight
    const box = (e) => { const r = e && e.getBoundingClientRect(); return r && (r.width >= 1 || r.height >= 1) ? r : null }
    const own = box(el)
    if (!own || own.bottom <= 0 || own.top >= vh || own.right <= 0 || own.left >= vw) return null
    const parts = [own]
    const o = q(other)
    const oth = box(o)
    if (oth) parts.push(oth)
    if (edge) {
      const bar = barsAt(edge).find((b) => b.r.left < own.right && b.r.right > own.left)
      if (bar) {
        parts.push(bar.r)
        const was = bar.el.style.getPropertyValue('opacity'), pri = bar.el.style.getPropertyPriority('opacity')
        bar.el.style.setProperty('opacity', '0.3', 'important')
        cutUndo.push(() => { if (was) bar.el.style.setProperty('opacity', was, pri); else bar.el.style.removeProperty('opacity') })
      }
    }
    const { root } = fxRoot()
    const mark = (e, cls = '', text = '') => {
      const r = docRect(e)
      const d = document.createElement('div')
      d.className = 'cut' + cls
      Object.assign(d.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' })
      if (text) {
        const t = document.createElement('b')
        t.textContent = String(text).slice(0, 40)
        d.append(t)
        if (e.getBoundingClientRect().top < 30) d.classList.add('low') // 上面放不下：标在框下面
      }
      root.append(d)
      cutMarks.push(d)
    }
    mark(el, '', label)
    if (oth) mark(o, ' alt')
    // 叠着的两个：重叠那块中间最上面的是谁
    let upper = ''
    if (oth) {
      const x = (Math.max(own.left, oth.left) + Math.min(own.right, oth.right)) / 2, y = (Math.max(own.top, oth.top) + Math.min(own.bottom, oth.bottom)) / 2
      const top = topAt(x, y)
      upper = top && el.contains(top) ? 'self' : top && o.contains(top) ? 'other' : ''
    }
    // 至少 min 那么大（太小看不出周围），先居中撑开，再挪回视口里
    const fit = (a, z, min, max) => {
      if (z - a < min) { const c = (a + z) / 2; a = c - min / 2; z = c + min / 2 }
      if (a < 0) { z -= a; a = 0 }
      if (z > max) { a -= z - max; z = max }
      return [Math.max(0, a), Math.min(max, z)]
    }
    const [l, r] = fit(Math.min(...parts.map((x) => x.left)) - 24, Math.max(...parts.map((x) => x.right)) + 24, Math.min(vw, Math.max(320, vw * 0.4)), vw)
    const [t, b] = fit(Math.min(...parts.map((x) => x.top)) - 24, Math.max(...parts.map((x) => x.bottom)) + 24, Math.min(vh, Math.max(200, vh * 0.3)), vh)
    if (r - l < 1 || b - t < 1) return null
    // 挨着的：至少一半在图里才算、才圈
    const inside = (Array.isArray(also) ? also : []).slice(0, 12).map((s) => {
      const e = q(s)
      const x = box(e)
      if (!x) return false
      const iw = Math.min(x.right, r) - Math.max(x.left, l), ih = Math.min(x.bottom, b) - Math.max(x.top, t)
      const ok = iw > 0 && ih > 0 && iw * ih >= 0.5 * x.width * Math.max(1, x.height)
      if (ok && e !== el && e !== o) mark(e)
      return ok
    })
    return { x: Math.round(l + scrollX), y: Math.round(t + scrollY), w: Math.round(r - l), h: Math.round(b - t), inside, upper }
  }

  /**
   * 两段字叠在一起，多半是哪儿挪了位置：从两个元素往上到共同的外层，找负 margin、绝对定位、transform。
   * 给 { sel, prop, value }（体检再按它找是哪条规则、哪个文件第几行），找不到给 null
   */
  function causeOf(A, B) {
    const chain = (e) => {
      const out = []
      for (let x = e; x && x !== document.body && !x.contains(e === A ? B : A) && out.length < 6; x = x.parentElement) out.push(x)
      return out
    }
    const both = [...chain(A), ...chain(B)]
    for (const e of both) {
      const cs = getComputedStyle(e)
      for (const side of ['top', 'left', 'bottom', 'right']) {
        const v = cs.getPropertyValue('margin-' + side)
        if (parseFloat(v) < -1) return { sel: cssPath(e), prop: 'margin-' + side, value: v }
      }
    }
    for (const e of both) {
      const pos = getComputedStyle(e).position
      if (pos === 'absolute' || pos === 'fixed') return { sel: cssPath(e), prop: 'position', value: pos }
    }
    for (const e of both) {
      if (getComputedStyle(e).transform !== 'none') return { sel: cssPath(e), prop: 'transform', value: '' }
    }
    return null
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
        add('overlap', A, { other: nameOf(B), otherText: ownText(B).slice(0, 40), otherSel: cssPath(B), px: Math.round(oh), cause: causeOf(A, B) }, 2)
      }
    }

    // 4. 对比度（WCAG：正文 4.5，大字 3）。取底色那段装一次「量画着什么」的临时样式（见 withProbe），量完撤掉
    const sizes = new Map()
    const tinyMin = kind === 'app' || kind === 'miniprogram' ? 10 : kind === 'tablet' || kind === 'desktop' ? 11 : kind === 'poster' || kind === 'slides' ? Math.max(12, Math.round(vw / 96)) : 12
    let pool = null
    const poolOf = () => pool || (pool = paintPool()) // 有字不在屏幕里才建
    withProbe(() => { for (const a of atoms) {
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
      const bd = backdrop(el, { x: (r0.l + r0.r) / 2, y: (r0.t + r0.b) / 2 }, fg, poolOf)
      if (!bd || !bd.fg) continue
      fg = bd.fg
      const cr = ratio(fg, bd.color)
      const bold = +cs.fontWeight >= 700
      const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5
      if (cr < need - 0.05) add('contrast', el, { ratio: Math.round(cr * 100) / 100, need, fg: hex(fg), bg: hex(bd.color) }, cr < need * 0.75 ? 2 : 1)
    } })

    // 5. 点击区太小（App / 小程序 / 平板 44，网页 24；文字中间的链接不算）
    const minTap = kind === 'app' || kind === 'miniprogram' || kind === 'tablet' ? 44 : kind === 'web' || kind === 'email' || kind === 'desktop' ? 24 : 0
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

    // 13. 小程序：右上角胶囊挡住的字和按钮。不固定的按没滚时的位置算（滚下去本来就会从胶囊下面过）
    if (kind === 'miniprogram') capsuleCheck(add, atoms, vw)
    // 14. 手机：灵动岛挡住的、伸进底部横条区的，标签栏项数；小程序每屏要有导航栏
    if (kind === 'app' || kind === 'miniprogram') phoneCheck(add, atoms, vw, kind)
    // 15. 桌面软件：窗口按钮挡住的字和按钮
    if (kind === 'desktop') winCheck(add, atoms, vw)

    issues.sort((x, y) => y.sev - x.sev)
    const se0 = se()
    return {
      issues: issues.slice(0, CHECK_MAX),
      metrics: { w: vw, h: innerHeight, page: Math.max(se0.scrollHeight, innerHeight), bars: edges.bars, areas: edges.areas },
    }
  }

  /**
   * 元素在「各层都没滚」时露出来的那块（视口坐标）：窗口、内部滚动区滚过的量加回去，被外层裁掉的去掉。
   * 滚动量、边框都按那层实际的缩放（transform、zoom）换成视口像素；裁剪按 padding box、只裁 overflow 不是 visible 的那个方向。
   * 绝对 / 固定定位的只受包含块和更外面的管；固定 / 吸顶的那层按现在看到的位置算，它外面的滚动不管、裁剪照算。全被裁掉返回 null。
   * now：按现在的滚动位置算（只去掉裁掉的部分）。upto：只算到包着它的那层为止（更外面的裁剪不管）。
   * pos：量的是 el 的伪元素，它自己的定位方式（绝对定位的从 el 起只受包含块和更外面的裁，跳过中间不包它的层）
   */
  function restBox(el, now = false, upto = null, self = false, pos = '') {
    const chain = []
    let mode = pos === 'absolute' || pos === 'fixed' ? pos : ''
    let pinned = pos === 'fixed'
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (upto && e !== el && e.contains(upto)) break
      const cs = getComputedStyle(e)
      if (e !== el || self) { // self：量的是 el 里面的字，el 自己的 overflow 也裁它
        // clip-path 不管包含块，里面的都裁（形状在边框框以内，按边框框算个外沿）
        const cp = cs.clipPath && cs.clipPath !== 'none' ? e.getBoundingClientRect() : null
        const cpClip = cp && { l: cp.left, r: cp.right, t: cp.top, b: cp.bottom }
        if ((mode === 'absolute' && !holds(cs, false)) || (mode === 'fixed' && !holds(cs, true))) {
          if (cpClip) chain.push({ sx: 0, sy: 0, clip: cpClip })
          continue
        }
        const r = e.getBoundingClientRect()
        const kx = e.offsetWidth ? r.width / e.offsetWidth : 1
        const ky = e.offsetHeight ? r.height / e.offsetHeight : 1
        const box = cs.display !== 'inline' && cs.display !== 'contents' // overflow 对行内元素不起作用（clientWidth 是 0）
        const cx = box && e !== document.body && cs.overflowX !== 'visible'
        const cy = box && e !== document.body && cs.overflowY !== 'visible'
        // overflow: clip 可以往外放出 overflow-clip-margin 那么多（写了 border-box 从边框外沿算、content-box 从内容区算）
        const ocm = String(cs.overflowClipMargin || '')
        const len = (/(-?[\d.]+)px/.exec(ocm) || [])[1]
        const grow = (pad, bd) => (parseFloat(len) || 0) + (/border-box/.test(ocm) ? bd : /content-box/.test(ocm) ? -pad : 0)
        const mx = cs.overflowX === 'clip' ? grow(parseFloat(cs.paddingLeft) || 0, e.clientLeft) * kx : 0
        const my = cs.overflowY === 'clip' ? grow(parseFloat(cs.paddingTop) || 0, e.clientTop) * ky : 0
        let clip = cx || cy ? {
          l: cx ? r.left + e.clientLeft * kx - mx : -Infinity, r: cx ? r.left + (e.clientLeft + e.clientWidth) * kx + mx : Infinity,
          t: cy ? r.top + e.clientTop * ky - my : -Infinity, b: cy ? r.top + (e.clientTop + e.clientHeight) * ky + my : Infinity,
        } : null
        if (cpClip) clip = clip ? { l: Math.max(clip.l, cpClip.l), r: Math.min(clip.r, cpClip.r), t: Math.max(clip.t, cpClip.t), b: Math.min(clip.b, cpClip.b) } : cpClip
        chain.push({
          sx: pinned || now ? 0 : e.scrollLeft * kx,
          sy: pinned || now ? 0 : e.scrollTop * ky,
          clip,
        })
      }
      if (cs.position === 'fixed' || cs.position === 'sticky') pinned = true
      mode = cs.position
    }
    let dx = pinned || now ? 0 : scrollX
    let dy = pinned || now ? 0 : scrollY
    let box = { l: -Infinity, r: Infinity, t: -Infinity, b: Infinity }
    // 从外往里：每层的位置跟着它外面各层滚过的量走，它自己滚过的量只挪它里面的
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i]
      if (c.clip) box = { l: Math.max(box.l, c.clip.l + dx), r: Math.min(box.r, c.clip.r + dx), t: Math.max(box.t, c.clip.t + dy), b: Math.min(box.b, c.clip.b + dy) }
      dx += c.sx
      dy += c.sy
    }
    return (r) => {
      const o = { l: Math.max(box.l, r.l + dx), r: Math.min(box.r, r.r + dx), t: Math.max(box.t, r.t + dy), b: Math.min(box.b, r.b + dy) }
      return o.r - o.l > 0 && o.b - o.t > 0 ? o : null
    }
  }

  /**
   * 盖在页面上面、页面盖不住的一块（胶囊、灵动岛）：可点的东西和字横竖都伸进去 2px 以上就报。
   * 按「各层都没滚」时露出来的那块量（不固定的滚下去本来就会从下面过）；px(o, ow, oh) 算报多少
   */
  function zoneCheck(add, atoms, zone, type, px, extra) {
    const hit = new Set()
    const into = (o) => {
      if (!o) return 0
      const ow = Math.min(o.r, zone.r) - Math.max(o.l, zone.l)
      const oh = Math.min(o.b, zone.b) - Math.max(o.t, zone.t)
      return ow > 2 && oh > 2 ? Math.round(px(o, ow, oh)) : 0
    }
    const check = (el, rects, self) => {
      if (hiddenChain(el) || [...hit].some((h) => h.contains(el) || el.contains(h))) return
      const rest = restBox(el, false, null, self)
      const n = Math.max(0, ...rects.map((r) => into(rest(r))))
      if (!n) return
      hit.add(el)
      add(type, el, { px: n, ...extra }, 2)
    }
    for (const el of document.body.querySelectorAll(CLICKABLE)) {
      if (isOurs(el) || el.closest('dsh-design-picker,dsh-design-fx,dsh-design-edit')) continue
      const r = el.getBoundingClientRect()
      if (r.width >= 1 && r.height >= 1) check(el, [{ l: r.left, r: r.right, t: r.top, b: r.bottom }])
    }
    for (const a of atoms) check(a.el, a.rects, true) // 字被它自己 overflow 裁掉的那截看不见，不算
  }

  function capsuleCheck(add, atoms, vw) {
    const cap = { l: vw - CAP.right - CAP.w, r: vw - CAP.right, t: CAP.top, b: CAP.top + CAP.h }
    // 报伸进去多宽（从胶囊左边算）
    zoneCheck(add, atoms, cap, 'capsule', (o, ow) => Math.min(ow, o.r - cap.l), { x: Math.round(cap.l) })
  }

  /** 页面 meta 说的是不是 Windows 软件（<meta name="dsh-design" content="desktop windows">）；不写是 Mac */
  function deskOs() {
    const m = document.querySelector('meta[name="dsh-design"]')
    const words = String(m ? m.getAttribute('content') || '' : '').toLowerCase().split(/[\s,;]+/)
    return words.some((w) => /^(windows|win|win10|win11)$/.test(w)) ? 'win' : 'mac'
  }

  /** 桌面软件：Mac 左上角红绿灯（连同四周 4px），Windows 右上角三个按钮，盖在页面上面，伸进去的字和按钮报 winctl */
  function winCheck(add, atoms, vw) {
    const os = deskOs()
    if (os === 'win') {
      const z = { l: vw - WINBTN.w * 3, r: vw, t: 0, b: WINBTN.h }
      zoneCheck(add, atoms, z, 'winctl', (o, ow) => Math.min(ow, o.r - z.l), { os })
    } else {
      const z = { l: LIGHTS.x - 4, r: LIGHTS.x + LIGHTS.d * 3 + LIGHTS.gap * 2 + 4, t: LIGHTS.y - 4, b: LIGHTS.y + LIGHTS.d + 4 }
      zoneCheck(add, atoms, z, 'winctl', (o, ow) => Math.min(ow, z.r - o.l), { os })
    }
  }

  /**
   * 伪元素在屏幕上的框（量不到它自己，按算出来的样式推）：
   * - 绝对 / 固定定位：算出来的 left / top / 宽高摆进包含块；
   * - 普通流：挨着前后的子元素（字、元素）摆，flex 按排列方向和对齐，行内的跟所在那行居中；
   * 最后套上它自己的 translate / rotate / scale / transform（绕 transform-origin）
   */
  const pxv = (v) => (/px$/.test(v) ? parseFloat(v) : NaN)
  /** 伪元素的边框框宽高（算出来的宽高按 box-sizing 加上内边距和边框）；算不出来的是 NaN */
  function pseudoSize(ps) {
    const extra = (a, b) => (ps.boxSizing === 'border-box' ? 0 : (parseFloat(ps['padding' + a]) || 0) + (parseFloat(ps['padding' + b]) || 0) + (parseFloat(ps['border' + a + 'Width']) || 0) + (parseFloat(ps['border' + b + 'Width']) || 0))
    return { w: pxv(ps.width) + extra('Left', 'Right'), h: pxv(ps.height) + extra('Top', 'Bottom') }
  }
  /** 行内的伪元素没有宽高：按行高（normal 按字号 1.2 倍） */
  const lineOf = (ps) => { const v = pxv(ps.lineHeight); return isNaN(v) ? (parseFloat(ps.fontSize) || 16) * 1.2 : v }
  /** 块级的显示方式：上下外边距在块布局里会合并 */
  const BLOCKISH = /^(block|flex|grid|table|list-item|flow-root)$/
  /** 替换元素：行内的也有上下外边距 */
  const REPLACED = /^(IMG|SVG|svg|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|INPUT|SELECT|TEXTAREA|PICTURE)$/

  function pseudoBox(e, which, ps) {
    const { w } = pseudoSize(ps)
    let { h } = pseudoSize(ps)
    let kx = 1, ky = 1, l, t, W
    if (ps.position === 'absolute' || ps.position === 'fixed') {
      let cb = null
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) if (holds(getComputedStyle(a), ps.position === 'fixed')) { cb = a; break }
      const r = cb ? cb.getBoundingClientRect() : { left: 0, top: 0 }
      if (cb && cb.offsetWidth) kx = r.width / cb.offsetWidth
      if (cb && cb.offsetHeight) ky = r.height / cb.offsetHeight
      const x = pxv(ps.left), y = pxv(ps.top)
      if ([x, y, w, h].some(isNaN)) return null
      l = r.left + ((cb ? cb.clientLeft : 0) + x + (parseFloat(ps.marginLeft) || 0)) * kx
      t = r.top + ((cb ? cb.clientTop : 0) + y + (parseFloat(ps.marginTop) || 0)) * ky
      W = w
    } else {
      const r = e.getBoundingClientRect()
      if (e.offsetWidth) kx = r.width / e.offsetWidth
      if (e.offsetHeight) ky = r.height / e.offsetHeight
      const cs = getComputedStyle(e)
      const side = (k) => (parseFloat(cs['padding' + k]) || 0) + (parseFloat(cs['border' + k + 'Width']) || 0)
      const c = { l: r.left + side('Left') * kx, t: r.top + side('Top') * ky, r: r.right - side('Right') * kx, b: r.bottom - side('Bottom') * ky }
      if (isNaN(h)) h = lineOf(ps)
      const H = h * ky
      // 普通流里挨着的子元素和字（第一行 / 最后一行的框）
      // 字量出来的是字形的框，按行高撑成整行（line-height: 40px 这种，行比字高）
      const lh = pxv(cs.lineHeight) * ky
      const line = (q) => (isNaN(lh) || lh <= q.bottom - q.top ? q : { top: (q.top + q.bottom - lh) / 2, bottom: (q.top + q.bottom + lh) / 2 })
      const near = []
      for (const n of e.childNodes) {
        if (n.nodeType === 3 && n.nodeValue.trim()) {
          const rg = document.createRange()
          rg.selectNodeContents(n)
          const rs = rg.getClientRects()
          if (rs.length) { const f = line(rs[0]), z = line(rs[rs.length - 1]); near.push({ first: f, last: z, mT: 0, mB: 0, block: false, top: f.top, bottom: z.bottom }) }
        } else if (n.nodeType === 1 && !isOurs(n)) {
          const s2 = getComputedStyle(n)
          const rs = s2.display !== 'none' && s2.position !== 'absolute' && s2.position !== 'fixed' ? n.getClientRects() : []
          // top / bottom 是带外边距的边；普通行内元素（span 这种）上下外边距不起作用，框按它的行高撑成整行
          const inl = s2.display === 'inline' && !REPLACED.test(n.tagName)
          const mT = inl ? 0 : (parseFloat(s2.marginTop) || 0) * ky, mB = inl ? 0 : (parseFloat(s2.marginBottom) || 0) * ky
          const ln = (q) => {
            const v = Math.max(pxv(s2.lineHeight) || 0, pxv(cs.lineHeight) || 0) * ky // 那一行至少有父元素的行高
            return !inl || !v || v <= q.bottom - q.top ? q : { top: (q.top + q.bottom - v) / 2, bottom: (q.top + q.bottom + v) / 2 }
          }
          if (rs.length) { const f = ln(rs[0]), z = ln(rs[rs.length - 1]); near.push({ first: f, last: z, mT, mB, block: BLOCKISH.test(s2.display), top: f.top - mT, bottom: z.bottom + mB }) }
        }
      }
      const flex = /flex/.test(cs.display), grid = /grid/.test(cs.display)
      const rev = flex && /reverse/.test(cs.flexDirection)
      if (rev && /column/.test(cs.flexDirection)) near.reverse() // 按屏幕上从上到下
      const before = (which === '::before') !== rev
      const mt = (parseFloat(ps.marginTop) || 0) * ky, mb = (parseFloat(ps.marginBottom) || 0) * ky
      if (!flex && !grid && /inline/.test(ps.display)) {
        const ln = near.length ? (before ? near[0].first : near[near.length - 1].last) : null
        t = ln ? (ln.top + ln.bottom - H) / 2 : c.t
      } else if (!flex || /column/.test(cs.flexDirection)) {
        const gap = flex || grid ? (parseFloat(cs.rowGap) || 0) * ky : 0
        const j = flex ? cs.justifyContent : ''
        // 另一个伪元素也在普通流里排着（::before 图标 + 字 + ::after 箭头）：一起算剩余空间
        const os = getComputedStyle(e, which === '::before' ? '::after' : '::before')
        const other = os.content !== 'none' && os.content !== 'normal' && os.display !== 'none' && os.position !== 'absolute' && os.position !== 'fixed'
        const osz = pseudoSize(os).h
        const oh = other ? ((isNaN(osz) ? lineOf(os) : osz) + (parseFloat(os.marginTop) || 0) + (parseFloat(os.marginBottom) || 0)) * ky : 0
        // 剩下的空按项数分（space-*），放不下（没剩）就不分
        const n = near.length + 1 + (other ? 1 : 0)
        const free = c.b - c.t - near.reduce((m, q) => m + q.bottom - q.top, 0) - H - mt - mb - oh - gap * (n - 1)
        const between = free <= 0 || !flex ? 0 : /space-between/.test(j) ? free / (n - 1) : /space-around/.test(j) ? free / n : /space-evenly/.test(j) ? free / (n + 1) : 0
        // 块布局里两个块级盒相邻，上下外边距合并成一个（正的取大、负的取小再相加）；flex / grid、行内块不合并
        const fold = (a, b, q) => (flex || grid || !q.block || !BLOCKISH.test(ps.display) ? a + b : Math.max(a, b, 0) + Math.min(a, b, 0))
        // 排到内容区的尾巴上：flex-start / normal（只有一项或放不下时的 space-between 也按它）在 column-reverse 里也是尾巴，start / end 不跟着反
        const atEnd = /flex-end/.test(j) ? !rev : /(^|\s)end$/.test(j) ? true : /flex-start|normal|stretch|space-between/.test(j) ? rev : false
        if (near.length) {
          // 挨着第一项前面 / 最后一项后面
          const q = before ? near[0] : near[near.length - 1]
          t = before ? q.first.top - fold(q.mT, mb, q) - gap - between - H : q.last.bottom + fold(q.mB, mt, q) + gap + between
        } else if (other && flex) {
          // 只有前后两个伪元素：从内容区起点按 justify-content 排
          const lead = /center/.test(j) ? free / 2 : free <= 0 ? (/space-around|space-evenly/.test(j) ? free / 2 : atEnd ? free : 0)
            : /space-around/.test(j) ? free / 4 : /space-evenly/.test(j) ? free / 3 : /space-between/.test(j) ? 0 : atEnd ? free : 0
          t = c.t + lead + mt + (before ? 0 : oh + gap + between)
        } else t = /center|space-around|space-evenly/.test(j) ? (c.t + mt + c.b - mb - H) / 2 : atEnd ? c.b - mb - H : c.t + mt
      } else {
        const a = ps.alignSelf && ps.alignSelf !== 'auto' ? ps.alignSelf : cs.alignItems
        t = /center/.test(a) ? (c.t + c.b - H) / 2 : /end/.test(a) ? c.b - H : c.t + mt
      }
      l = c.l
      W = isNaN(w) ? Math.max(1, (c.r - c.l) / kx) : w
      if (ps.position === 'relative') { l += (pxv(ps.left) || 0) * kx; t += (pxv(ps.top) || 0) * ky }
    }
    // 自己的变换：先 translate、rotate、scale，再 transform，都绕 transform-origin
    let m = new DOMMatrix()
    const set = (v) => v && v !== 'none'
    const len = (v, full) => (/%$/.test(v) ? parseFloat(v) / 100 * full : parseFloat(v) || 0)
    try {
      if (set(ps.translate)) { const [x, y = '0px'] = ps.translate.split(' '); m = m.translate(len(x, W), len(y, h)) }
      if (set(ps.rotate) && /^-?[\d.]+deg$/.test(ps.rotate)) m = m.rotate(parseFloat(ps.rotate))
      if (set(ps.scale)) { const [sx, sy = sx] = ps.scale.split(' ').map(parseFloat); m = m.scale(sx, sy) }
      if (set(ps.transform)) m = m.multiply(new DOMMatrix(ps.transform))
    } catch { /* 解析不了的变换就当没有 */ }
    const [ox, oy] = String(ps.transformOrigin).split(' ').map((v) => parseFloat(v) || 0)
    m = new DOMMatrix().translate(ox, oy).multiply(m).translate(-ox, -oy)
    const pts = [[0, 0], [W, 0], [0, h], [W, h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)))
    const xs = pts.map((p) => l + p.x * kx), ys = pts.map((p) => t + p.y * ky)
    return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) }
  }

  /** 一个元素里的图标（img、最外层的 svg）：不看框，只看画出来的东西 */
  function iconRects(root, pseudo = false) {
    const out = []
    for (const e of root.querySelectorAll('img,svg')) {
      if ((e.parentElement && e.parentElement.closest('svg')) || isOurs(e) || e.closest('dsh-design-picker,dsh-design-fx,dsh-design-edit')) continue
      const r = e.getBoundingClientRect()
      if (r.width >= 1 && r.height >= 1 && !hiddenChain(e)) out.push({ el: e, r: { l: r.left, t: r.top, r: r.right, b: r.bottom } })
    }
    if (!pseudo) return out
    // 图标字体、背景图标：::before / ::after 里放了字或 url() 图（空白、渐变遮罩这种装饰不算）。量不到伪元素的框，按它算出来的位置和大小推
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (isOurs(e) || e.closest('svg,dsh-design-picker,dsh-design-fx,dsh-design-edit')) continue
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(e, which)
        if (ps.display === 'none' || ps.content === 'none' || ps.content === 'normal' || ps.visibility === 'hidden' || parseFloat(ps.opacity) === 0) continue
        const glyph = /^["'][\s\S]*\S[\s\S]*["']$/.test(ps.content.replace(/\\[0-9a-f]{1,6}\s?|\\./gi, 'x')) || /url\(/.test(ps.content + ps.backgroundImage + ps.webkitMaskImage + ps.maskImage)
        if (!glyph || hiddenChain(e)) continue
        // 无头体检时浏览器给了真实框（同一滚动位置）就用它；全问到了还没框的是没排出来；没给的（实时预览、宿主太多没问到）按样式推
        const at = scrollX + ',' + scrollY
        const fresh = window.__dshPseudoAt === at
        const got = fresh && e.__dshPseudo && e.__dshPseudo.at === at ? e.__dshPseudo : null
        const o = got ? got[which] || null : fresh && window.__dshPseudoAll ? null : pseudoBox(e, which, ps)
        // 伪元素是宿主的子盒：宿主自己的 overflow 也裁它；绝对 / 固定定位的按它自己的包含块裁（pos 交给 restBox）
        if (o && o.r - o.l >= 1 && o.b - o.t >= 1) out.push({ el: e, r: o, pos: ps.position })
      }
    }
    return out
  }

  /**
   * 底栏里横排、等宽、铺满大半条的一排（标签栏的几项）：找最多的那排，返回这几项。
   * 绝对 / 固定定位的子元素（当前项下面的小横线这种）不算项；能横着滑、或者伸出栏外一大截的一排（轮播、商品列表）不算
   */
  const slides = (el, top) => {
    for (let e = el; e; e = e === top ? null : e.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1) return true
    }
    return false
  }
  function tabCount(bar) {
    let best = []
    const walk = (el, depth) => {
      const ks = []
      for (const k of el.children) {
        if (isOurs(k)) continue
        const cs = getComputedStyle(k)
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue
        const r = k.getBoundingClientRect()
        if (r.width >= 1 && r.height >= 1) ks.push({ k, r })
      }
      if (ks.length > best.length) {
        const ws = ks.map((x) => x.r.width)
        const avg = ws.reduce((m, w) => m + w, 0) / ws.length
        const same = Math.max(...ws) - Math.min(...ws) <= Math.max(4, avg * 0.12)
        const row = Math.max(...ks.map((x) => x.r.top)) - Math.min(...ks.map((x) => x.r.top)) <= 4
        const fits = !slides(el, bar.el) && ks.every((x) => x.r.left >= bar.r.left - x.r.width / 4 && x.r.right <= bar.r.right + x.r.width / 4)
        if (ks.length >= 2 && same && row && fits && avg * ks.length >= bar.r.width * 0.7) best = ks.map((x) => x.k)
      }
      if (depth < 4) for (const k of el.children) if (!isOurs(k)) walk(k, depth + 1)
    }
    walk(bar.el, 0)
    return best
  }

  /**
   * 这排是切换页面的标签栏（不是一排操作按钮），按这个次序定：
   * - 这一排到栏之间（以及栏外面）写明了是工具栏（role=toolbar、class 带 toolbar / tools）：不是；
   * - 写明了是导航（role=tab / tablist、项链到别的页面（#/home 这种路由也算，光一个 # 不算）、标了 aria-current、栏 / 这一排 / 项的 class 或 id 带 tab、nav）：是；
   * - 一半以上是操作（裁剪、旋转、分享……）：不是；一半以上是页面名（首页、分类、我的……）：是；
   * - 全是 <button>：不是；
   * - 在 <nav> 里、项是占位链接（href="#"）、项标了选中（active、on……）、只有一项颜色不同（字或图标）：是
   * 认字时只看文字（字符图标 ✂、↻ 这种去掉）
   */
  const ON = /(^|[-_\s])(on|active|current|cur|selected)($|[-_\s])/i
  const PAGE_WORDS = new Set('首页 主页 分类 发现 消息 购物车 我的 我 个人 个人中心 通讯录 联系人 动态 社区 推荐 关注 订单 会员 商城 广场 朋友 视频 直播 学习 课程 工作台 应用 服务 钱包 资讯 附近 活动 收藏 设置 home discover explore messages message inbox chat chats cart profile me mine account settings feed library favorites orders shop store community friends contacts notifications activity wallet categories category deals news videos live learn courses'.split(' '))
  const TOOL_WORDS = new Set('裁剪 剪裁 旋转 翻转 滤镜 调色 调节 贴纸 文字 文本 画笔 涂鸦 马赛克 边框 美颜 特效 配乐 音乐 变速 分割 删除 复制 粘贴 撤销 重做 分享 点赞 评论 转发 下载 保存 编辑 加粗 斜体 下划线 对齐 插入 表格 链接 拍照 相册 亮度 对比度 饱和度 美化 模板 背景 橡皮 播放 暂停 静音 全屏 crop rotate flip filter filters adjust sticker stickers text draw brush erase eraser undo redo share like comment save edit delete copy paste bold italic underline align insert download trim split speed effects music play pause mute fullscreen'.split(' '))
  const classOf = (el) => (el.getAttribute('class') || '') + ' ' + el.id
  const labelOf = (k) => String(k.innerText || k.textContent || '').toLowerCase().replace(/[^\p{L}]+/gu, '')
  function navLike(bar, items) {
    const row = items[0].parentElement
    const boxes = [] // 这一排一直到栏（再往外由 closest 看）
    for (let e = row; e; e = e === bar.el ? null : e.parentElement) boxes.push(e)
    if (boxes.some((e) => e.matches('[role=toolbar]') || /(^|[-_\s])tool(bar|s)?($|[-_\s])/i.test(classOf(e))) || bar.el.closest('[role=toolbar]')) return false
    const page = (k) => k.matches('a[href]') && !/^(#?|javascript:.*)$/i.test(k.getAttribute('href').trim())
    if (items.some((k) => page(k) || k.matches('[role=tab],[aria-current]:not([aria-current=false])')) || boxes.some((e) => e.matches('[role=tablist]'))) return true
    if ([...boxes, ...items].some((e) => /tab(?!le)|(^|[-_\s])nav/i.test(classOf(e)))) return true
    const labels = items.map(labelOf)
    if (labels.filter((x) => TOOL_WORDS.has(x)).length * 2 >= items.length) return false
    if (labels.filter((x) => PAGE_WORDS.has(x)).length * 2 >= items.length) return true
    if (items.every((k) => k.matches('button,[role=button]'))) return false
    if (bar.el.closest('nav,[role=navigation]') || bar.el.querySelector('nav,[role=navigation]') || items.some((k) => k.matches('a[href]'))) return true
    if (items.some((k) => k.matches('[aria-selected=true]') || ON.test(classOf(k)) || [...k.querySelectorAll('*')].some((e) => ON.test(classOf(e))))) return true
    // 只有一项颜色不同：字的颜色，或者图标（svg 的 color / fill、图标字体的颜色）
    const tint = (k) => {
      const t = [k, ...k.querySelectorAll('*')].find((e) => ownText(e)) || k
      const ic = k.querySelector('svg,i,[class*=icon]')
      const ics = ic ? getComputedStyle(ic) : null
      return getComputedStyle(t).color + '|' + (ics ? ics.color + ics.fill : '')
    }
    const tints = items.map(tint)
    const odd = tints.filter((c) => tints.filter((x) => x === c).length === 1)
    return odd.length === 1 && new Set(tints).size === 2
  }

  /**
   * 手机（App、小程序）：
   * - 灵动岛挡住的字和按钮（外框画在页面上面，挡住的看不见）；
   * - 底栏里的字、图标伸进底部横条区（让出 34px，栏的底色可以铺下去）；
   * - 标签栏超过 5 项（小程序最多 5 项，微信直接报错）；
   * - 小程序：导航栏那条（44–88）什么都没有。
   * 矮的手机（高不到宽的 1.9 倍）没有灵动岛、横条，只看后两条
   */
  function phoneCheck(add, atoms, vw, kind) {
    const vh = innerHeight
    const tall = vh / vw >= 1.9
    if (tall) {
      const isl = { l: vw / 2 - ISLAND.w / 2, r: vw / 2 + ISLAND.w / 2, t: ISLAND.top, b: ISLAND.top + ISLAND.h }
      zoneCheck(add, atoms, isl, 'island', (o, ow, oh) => oh, {})
    }
    const line = vh - HOMEBAR
    for (const bar of barsAt('bottom', true)) {
      if (tall) {
        let worst = null
        // 只量看得见的那截：被自己（省略号、多行截断）或外层（轮播）裁掉的、在屏幕外的不算
        const look = (el, r, self, pos) => {
          const o = restBox(el, true, null, self, pos)(r)
          if (!o || o.r <= 0 || o.l >= vw || o.t >= vh || o.b <= 0) return
          const d = Math.min(o.b, vh) - line
          if (d > 6 && (!worst || d > worst.d)) worst = { el, d }
        }
        for (const a of atoms) if (bar.el.contains(a.el) && !hiddenChain(a.el)) for (const r of a.rects) look(a.el, r, true)
        for (const ic of iconRects(bar.el, true)) look(ic.el, ic.r, !!ic.pos, ic.pos)
        // 伸进几像素看不出来，不报；伸进 12px 以上算严重
        if (worst) add('homebar', worst.el, { px: Math.round(worst.d), bar: nameOf(bar.el) }, worst.d >= 12 ? 2 : 1)
      }
      const items = tabCount(bar)
      if (items.length > 5 && navLike(bar, items)) add('tabbar', bar.el, { n: items.length }, kind === 'miniprogram' ? 2 : 1)
    }
    if (kind !== 'miniprogram') return
    // 导航栏那条：没滚时有字、图标或按钮的竖直中线落在里面就算有
    const band = { t: NAVBAR.top, b: NAVBAR.top + NAVBAR.h }
    const inBand = (o) => o && (o.t + o.b) / 2 >= band.t && (o.t + o.b) / 2 <= band.b
    const seen = (el, rects, self) => {
      if (hiddenChain(el)) return false
      const rest = restBox(el, false, null, self)
      return rects.some((r) => inBand(rest(r)))
    }
    for (const a of atoms) if (seen(a.el, a.rects, true)) return
    for (const el of document.body.querySelectorAll(CLICKABLE)) {
      if (isOurs(el) || el.closest('dsh-design-picker,dsh-design-fx,dsh-design-edit')) continue
      const r = el.getBoundingClientRect()
      if (r.width >= 1 && r.height >= 1 && seen(el, [{ l: r.left, r: r.right, t: r.top, b: r.bottom }])) return
    }
    for (const ic of iconRects(document.body)) if (seen(ic.el, [ic.r])) return
    add('navbar', null, { t: band.t, b: band.b }, 1)
  }

  /**
   * 最底下的画布：html（没有就 body）的底色铺满整个窗口。html 有底色或背景图时画布用 html 的、body 的背景照常算；
   * 都没有时 body 的底色传到画布上。onCanvas(e)：它自己的底色就是画布，叠的时候别再算一遍。explicit：页面自己写了底色
   */
  function canvasBase() {
    if (probe && probe.canvas) return probe.canvas
    const de = document.documentElement
    const dcs = getComputedStyle(de)
    const htmlBg = rgba(dcs.backgroundColor)
    const htmlHas = (!!htmlBg && htmlBg[3] > 0) || dcs.backgroundImage !== 'none'
    const bodyBg = document.body ? rgba(getComputedStyle(document.body).backgroundColor) : null
    const blank = schemeDark() ? [18, 18, 18, 1] : [255, 255, 255, 1]
    const can = htmlHas ? htmlBg : bodyBg
    const explicit = !!can && can[3] > 0
    const out = { base: explicit ? (can[3] < 1 ? over(can, blank) : can) : blank, explicit, onCanvas: (e) => e === de || (e === document.body && !htmlHas) }
    if (probe) probe.canvas = out
    return out
  }

  /**
   * 从下往上叠 [元素, 颜色] 这些层，透明度和浏览器一样按组算：opacity < 1 的元素连同它里面的先合成（从全透明起），再整体变淡叠下去。
   * 元素的祖先不在层里（子元素伸出了它的框）也照算。base 是最底下的颜色（不透明），返回叠完的 [r, g, b, 1]
   */
  function compose(layers, base) {
    const pre = (c) => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]
    const ov = (t, u) => [t[0] + u[0] * (1 - t[3]), t[1] + u[1] * (1 - t[3]), t[2] + u[2] * (1 - t[3]), t[3] + u[3] * (1 - t[3])]
    const stack = [{ owner: null, o: 1, c: [0, 0, 0, 0] }]
    const close = () => { const g = stack.pop(); const up = stack[stack.length - 1]; up.c = ov(g.c.map((v) => v * g.o), up.c) }
    const memo = new Map()
    const groupsOf = (e) => {
      if (memo.has(e)) return memo.get(e)
      const a = []
      for (let p = e; p && p.nodeType === 1; p = p.parentElement) { const o = +getComputedStyle(p).opacity; if (o < 1) a.unshift([p, o]) }
      memo.set(e, a)
      return a
    }
    for (const [e, col] of layers) {
      const want = groupsOf(e)
      let k = 0
      while (k < want.length && k + 1 < stack.length && stack[k + 1].owner === want[k][0]) k++
      while (stack.length > k + 1) close()
      for (let i = k; i < want.length; i++) stack.push({ owner: want[i][0], o: want[i][1], c: [0, 0, 0, 0] })
      if (col && col[3] > 0) { const g = stack[stack.length - 1]; g.c = ov(pre(col), g.c) }
    }
    while (stack.length > 1) close()
    const c = ov(stack[0].c, base)
    return [c[0], c[1], c[2], 1]
  }

  /**
   * 顶栏右边（胶囊那块）是不是深色：是的话外框画白色胶囊（和微信 navigationBarTextStyle: white 一样）。
   * 页面写了 <meta name="dsh-capsule" content="white|black"> 就照它；不然从下往上叠胶囊中心那点的各层：
   * 底色、渐变（取各色标的平均）、图片 / 视频 / canvas（按 object-fit / object-position 画到小画布上取那块的平均，跨域取不到就跳过）。
   * 透明度和浏览器一样按组算：opacity < 1 的元素连同里面的先合成，再整体变淡。装饰 SVG 跳过。
   * 导出带外框的图也用这个结果（截图复制页面那一刻量的），两边一致
   */
  function topDark() {
    try {
      const m = document.querySelector('meta[name="dsh-capsule"]')
      const say = m ? String(m.getAttribute('content') || '').trim().toLowerCase() : ''
      if (say === 'white' || say === 'black') return say === 'white'
      // Windows 桌面软件看右上角三个按钮那块，别的看胶囊那块
      const win = deskOs() === 'win'
      const x = win ? innerWidth - WINBTN.w * 1.5 : innerWidth - CAP.right - CAP.w / 2
      const y = win ? WINBTN.h / 2 : CAP.top + CAP.h / 2
      const hits = paintedAt(x, y).filter((e) => !isOurs(e) && !(e instanceof SVGElement)).reverse() // 从下往上
      const { base, onCanvas } = canvasBase()
      const layers = []
      for (const e of hits) {
        const cs = getComputedStyle(e)
        for (const l of [onCanvas(e) ? null : rgba(cs.backgroundColor), gradTone(cs.backgroundImage), MEDIA.has(e.tagName) ? mediaTone(e, cs) : null]) if (l) layers.push([e, l])
      }
      const c = compose(layers, base)
      return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 140
    } catch { return false }
  }
  /**
   * 量「这一点上画着什么」的那段时间：临时加一张样式表（放在层里，盖得过页面没分层的 !important）把 pointer-events 全设成 auto，
   * 命中测试就不会跳过不可点的背景层；量完撤掉——不改页面的 DOM，页面的 MutationObserver 不会知道。
   * 还盖不过的（行内 !important、页面更早的层里写的）先列出来，paintedAt 按位置补。fn 得是同步的；嵌套调用共用一次
   */
  let probe = null
  function withProbe(fn) {
    if (probe) return fn()
    const was = [...document.adoptedStyleSheets]
    let sheet = null
    try {
      sheet = new CSSStyleSheet()
      sheet.replaceSync('@layer dsh-design-probe{*{pointer-events:auto!important}}')
      document.adoptedStyleSheets = [...was, sheet]
    } catch { sheet = null }
    try {
      const extra = []
      for (const e of [document.documentElement, document.body, ...(document.body ? document.body.querySelectorAll('*') : [])]) {
        if (!e || isOurs(e) || e instanceof SVGElement) continue
        const cs = getComputedStyle(e)
        if (cs.pointerEvents === 'none' && cs.visibility === 'visible') extra.push(e)
      }
      probe = { extra, layers: new Map(), paths: new Map(), pairs: new Map(), canvas: null } // 后几个是量的这段时间里的缓存（页面不会变）
      return fn()
    } finally {
      probe = null
      if (sheet) document.adoptedStyleSheets = was
    }
  }
  /** 这一点上画着的元素（从上往下）：不可点的背景层也算；命中测试漏掉的按位置找出来、估个上下顺序插进去（被外层裁掉的不算） */
  function paintedAt(x, y) {
    return withProbe(() => {
      const list = document.elementsFromPoint(x, y)
      for (const e of probe.extra) {
        if (list.includes(e)) continue
        const r = e.getBoundingClientRect()
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
        const vis = restBox(e, true)({ l: r.left, r: r.right, t: r.top, b: r.bottom })
        if (!vis || x < vis.l || x > vis.r || y < vis.t || y > vis.b) continue
        const i = list.findIndex((h) => paintsOver(e, h))
        list.splice(i < 0 ? list.length : i, 0, e)
      }
      return list
    })
  }
  /** 会建层叠上下文的元素：z-index 只在它里面比，里面的东西整块跟着它排 */
  function stackRoot(e, cs) {
    if (e === document.documentElement) return true
    const zi = cs.zIndex !== 'auto'
    const p = e.parentElement
    return (zi && (cs.position !== 'static' || (!!p && /flex|grid/.test(getComputedStyle(p).display)))) || cs.position === 'fixed' || cs.position === 'sticky' ||
      +cs.opacity < 1 || moved(cs) || cs.filter !== 'none' || cs.perspective !== 'none' || cs.isolation === 'isolate' || cs.mixBlendMode !== 'normal' ||
      (!!cs.clipPath && cs.clipPath !== 'none') || (!!cs.maskImage && cs.maskImage !== 'none') || (!!cs.backdropFilter && cs.backdropFilter !== 'none') ||
      /paint|layout|strict|content/.test(cs.contain) || /transform|scale|translate|rotate|opacity|filter|perspective|z-index/.test(cs.willChange)
  }
  /** 能给绝对定位（fixed：给固定定位）当包含块的：定位了的，或 transform / perspective / filter / contain / will-change 这些 */
  function holds(cs, fixed) {
    return (!fixed && cs.position !== 'static') || moved(cs) || cs.perspective !== 'none' || cs.filter !== 'none' ||
      (!!cs.backdropFilter && cs.backdropFilter !== 'none') || /paint|layout|strict|content/.test(cs.contain) ||
      /transform|scale|translate|rotate|perspective|filter|contain/.test(cs.willChange)
  }
  /** 变换过的：transform，或单独写的 scale / translate / rotate */
  function moved(cs) {
    return cs.transform !== 'none' || (!!cs.scale && cs.scale !== 'none') || (!!cs.translate && cs.translate !== 'none') || (!!cs.rotate && cs.rotate !== 'none')
  }
  /**
   * a 画在 b 上面吗（命中测试漏掉的那几个用来估位置）：祖先在下、后代在上（负 z-index 跑到不建上下文的祖先底下的除外）；不相干的找两者共同的层叠上下文，
   * 各取在它里面代表自己的那个（往下第一个自己建上下文的，没有就是路上离自己最近的定位了的），比层级（负 z < 普通流 < 定位 / z 0 < 正 z），一样按文档顺序
   */
  function paintsOver(a, b) {
    const memo = probe && probe.pairs
    let row = memo && memo.get(a)
    if (row && row.has(b)) return row.get(b)
    const v = paintsOverNow(a, b)
    if (memo) { if (!row) memo.set(a, (row = new Map())); row.set(b, v) }
    return v
  }
  /** 叠放用到的几样（建不建层叠上下文、z-index、定位），量的这段时间里记着 */
  function layerOf(e) {
    const m = probe && probe.layers
    let v = m && m.get(e)
    if (v) return v
    const cs = getComputedStyle(e)
    v = { root: stackRoot(e, cs), z: parseInt(cs.zIndex, 10), pos: cs.position }
    if (m) m.set(e, v)
    return v
  }
  /** 从 html 到它的那串祖先（含自己），量的这段时间里记着 */
  function pathOf(e) {
    const m = probe && probe.paths
    let v = m && m.get(e)
    if (v) return v
    v = e.parentElement ? [...pathOf(e.parentElement), e] : [e]
    if (m) m.set(e, v)
    return v
  }
  function paintsOverNow(a, b) {
    // 后代 d 画在祖先 anc 底下：anc 自己不建层叠上下文，而 d 所在的、紧挨着 anc 的那个上下文是负 z-index 的（整块画到外面那层的最底下）
    const under = (anc, d) => {
      if (layerOf(anc).root) return false
      let top = null
      for (let x = d; x && x !== anc; x = x.parentElement) if (layerOf(x).root) top = x
      return !!top && layerOf(top).z < 0
    }
    if (a.contains(b)) return under(a, b)
    if (b.contains(a)) return !under(b, a)
    const pa = pathOf(a), pb = pathOf(b)
    let common = 0
    for (let i = 0; i < pa.length && pa[i] === pb[i]; i++) if (layerOf(pa[i]).root) common = i
    const rep = (path) => {
      let pos = null
      for (let k = common + 1; k < path.length; k++) {
        const v = layerOf(path[k])
        if (v.root) return { el: path[k], lv: Number.isFinite(v.z) && v.z !== 0 ? (v.z < 0 ? v.z - 1 : v.z + 1) : 1 }
        if (v.pos !== 'static') pos = path[k] // 定位了没建上下文的：各自按文档顺序排，取离自己最近的那个
      }
      return pos ? { el: pos, lv: 1 } : { el: path[path.length - 1], lv: 0 }
    }
    const ra = rep(pa), rb = rep(pb)
    if (ra.lv !== rb.lv) return ra.lv > rb.lv
    const [x, y] = ra.el === rb.el ? [a, b] : [ra.el, rb.el]
    return !!(y.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)
  }
  /** 渐变 → 各色标的平均（rgb() 以外的写法也认，见 rgba）；没有渐变 / 只有图片地址 → null */
  function gradTone(bi) {
    if (!bi || bi === 'none' || !/gradient\(/.test(bi)) return null
    const cs = (bi.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g) || []).map(rgba).filter(Boolean)
    if (!cs.length) return null
    const a = cs.reduce((s, c) => s + c[3], 0) / cs.length
    if (a <= 0) return [0, 0, 0, 0]
    const ch = (k) => cs.reduce((s, c) => s + c[k] * c[3], 0) / (a * cs.length)
    return [ch(0), ch(1), ch(2), a]
  }
  /** 图片 / 视频 / canvas 在胶囊那块的平均色：按内容框、object-fit、object-position 摆，裁在内容框里；没载完、跨域取不到 → null */
  function mediaTone(e, cs) {
    try {
      if (!/^(IMG|VIDEO|CANVAS)$/.test(e.tagName)) return null
      const nw = e.naturalWidth || e.videoWidth || e.width
      const nh = e.naturalHeight || e.videoHeight || e.height
      if (!nw || !nh) return null
      const r = e.getBoundingClientRect()
      const k = e.offsetWidth ? r.width / e.offsetWidth : 1
      const n = (v) => parseFloat(v) || 0
      const cl = r.left + (n(cs.borderLeftWidth) + n(cs.paddingLeft)) * k
      const ct = r.top + (n(cs.borderTopWidth) + n(cs.paddingTop)) * k
      const cw = r.right - (n(cs.borderRightWidth) + n(cs.paddingRight)) * k - cl
      const ch = r.bottom - (n(cs.borderBottomWidth) + n(cs.paddingBottom)) * k - ct
      if (cw <= 0 || ch <= 0) return null
      const fit = cs.objectFit || 'fill'
      let w = cw, h = ch
      if (fit !== 'fill') {
        let z = fit === 'cover' ? Math.max(cw / nw, ch / nh) : fit === 'none' ? k : Math.min(cw / nw, ch / nh)
        if (fit === 'scale-down') z = Math.min(k, z)
        w = nw * z
        h = nh * z
      }
      // object-position 算好的值是「横 竖」两项，每项是百分比、像素或 calc(百分比 ± 像素)（right 0 bottom 20px → 100% calc(100% - 20px)）；认不出的按居中
      const toks = []
      let depth = 0, cur = ''
      for (const ch of String(cs.objectPosition || '')) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
        if (/\s/.test(ch) && !depth) { if (cur) toks.push(cur); cur = '' } else cur += ch
      }
      if (cur) toks.push(cur)
      const [px, py] = toks.length === 2 ? toks : []
      const WORD = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }
      const at = (v, free) => {
        if (!v) return free / 2
        if (v in WORD) return (free * WORD[v]) / 100
        let pct = 0, pix = 0, ok = false
        for (const m of v.matchAll(/([+-])?\s*(\d*\.?\d+)(%|px)/g)) { const n = (m[1] === '-' ? -1 : 1) * parseFloat(m[2]); if (m[3] === '%') pct += n; else pix += n; ok = true }
        const r = (free * pct) / 100 + pix * k
        return ok && Number.isFinite(r) ? r : free / 2
      }
      const ox = cl + at(px, cw - w)
      const oy = ct + at(py, ch - h)
      const c = document.createElement('canvas')
      c.width = 22
      c.height = 8
      const g = c.getContext('2d')
      const capL = innerWidth - CAP.right - CAP.w
      const sx = c.width / CAP.w
      const sy = c.height / CAP.h
      g.beginPath()
      g.rect((cl - capL) * sx, (ct - CAP.top) * sy, cw * sx, ch * sy)
      g.clip()
      g.drawImage(e, (ox - capL) * sx, (oy - CAP.top) * sy, w * sx, h * sy)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let R = 0, G = 0, B = 0, A = 0
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; A += a }
      return A > 0 ? [R / A, G / A, B / A, A / (d.length / 4)] : [0, 0, 0, 0]
    } catch { return null }
  }
  let lastTop = null
  const postTop = () => { const dk = topDark(); if (dk !== lastTop) { lastTop = dk; post({ type: 'top', dark: dk }) } }
  // 顶栏的颜色会变：切主题 / 调色的过渡放完、滚动后顶栏变实色、点了换状态、窗口换尺寸（媒体查询）、图片换了——过一下再量。
  // 节流：一直滚也每 120ms 量一次；这段时间里又有动静就再补量一次（页面在 rAF 里换样式的也赶得上）
  let topTimer = 0
  let topAgain = false
  const queueTop = () => {
    if (topTimer) { topAgain = true; return }
    const run = () => { postTop(); if (topAgain) { topAgain = false; topTimer = setTimeout(run, 120) } else topTimer = 0 }
    topTimer = setTimeout(run, 120)
  }
  // 图片的 load 传不到 window（load 事件的路径到 document 为止），所以挂在 document 上；resize 只在 window 上
  for (const ev of ['transitionend', 'animationend', 'scroll', 'click', 'load', 'error', 'loadeddata']) document.addEventListener(ev, queueTop, { capture: true, passive: true })
  addEventListener('resize', queueTop, { passive: true })
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueTop) } catch { /* 老浏览器 */ } // 系统换了深浅色

  /** 无头浏览器截图用：右上角画上微信的胶囊（真机上它盖在页面上面）。ghost 半透明，透出下面被挡住的东西；别的值撤掉 */
  let capEl = null
  function showCapsule(how) {
    if (capEl) { capEl.remove(); capEl = null }
    if (how !== 'solid' && how !== 'ghost') return null
    const white = topDark()
    const fg = white ? '#fff' : '#000'
    const soft = white ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.15)'
    const h = document.createElement('dsh-design-fx')
    h.style.cssText = `position:fixed;top:${CAP.top}px;right:${CAP.right}px;width:${CAP.w}px;height:${CAP.h}px;z-index:2147483646;pointer-events:none;opacity:${how === 'ghost' ? 0.5 : 1}`
    h.attachShadow({ mode: 'closed' }).innerHTML = `<svg width="${CAP.w}" height="${CAP.h}" viewBox="0 0 ${CAP.w} ${CAP.h}" style="display:block;overflow:visible">` +
      `<rect x=".25" y=".25" width="${CAP.w - 0.5}" height="${CAP.h - 0.5}" rx="${CAP.h / 2 - 0.25}" fill="${white ? 'rgba(0,0,0,.15)' : 'rgba(255,255,255,.6)'}" stroke="${white ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.08)'}" stroke-width=".5"/>` +
      `<g fill="${fg}"><circle cx="20.5" cy="16" r="2.2"/><circle cx="28" cy="16" r="3.1"/><circle cx="35.5" cy="16" r="2.2"/><circle cx="65" cy="16" r="2.6"/></g>` +
      `<path d="M43.5 9v14" stroke="${soft}" stroke-width=".5"/><circle cx="65" cy="16" r="7.5" fill="none" stroke="${fg}" stroke-width="2"/></svg>`
    document.documentElement.appendChild(h)
    capEl = h
    return { white }
  }

  /** 截图时把桌面软件的窗口按钮画上去（和右侧栏外框一样）：solid 实的、ghost 半透明，别的值撤掉 */
  let winEl = null
  function showWinCtl(how) {
    if (winEl) { winEl.remove(); winEl = null }
    if (how !== 'solid' && how !== 'ghost') return null
    const os = deskOs()
    const h = document.createElement('dsh-design-fx')
    let svg
    if (os === 'win') {
      const W = WINBTN.w, H = WINBTN.h
      const c = topDark() ? '#fff' : '#1f1f1f'
      h.style.cssText = `position:fixed;top:0;right:0;width:${W * 3}px;height:${H}px`
      svg = `<svg width="${W * 3}" height="${H}" viewBox="0 0 ${W * 3} ${H}" style="display:block" fill="none" stroke="${c}" stroke-width="1">` +
        `<path d="M${W / 2 - 5} ${H / 2 + 0.5}h10"/><rect x="${W * 1.5 - 4.5}" y="${H / 2 - 4.5}" width="9" height="9" rx="1"/>` +
        `<path d="M${W * 2.5 - 5} ${H / 2 - 5}l10 10M${W * 2.5 + 5} ${H / 2 - 5}l-10 10"/></svg>`
    } else {
      const { x, y, d, gap } = LIGHTS
      const w = d * 3 + gap * 2
      h.style.cssText = `position:fixed;top:${y}px;left:${x}px;width:${w}px;height:${d}px`
      svg = `<svg width="${w}" height="${d}" viewBox="0 0 ${w} ${d}" style="display:block">` +
        ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => `<circle cx="${d / 2 + i * (d + gap)}" cy="${d / 2}" r="${d / 2 - 0.25}" fill="${c}" stroke="rgba(0,0,0,.12)" stroke-width=".5"/>`).join('') + '</svg>'
    }
    h.style.cssText += `;z-index:2147483646;pointer-events:none;opacity:${how === 'ghost' ? 0.5 : 1}`
    h.attachShadow({ mode: 'closed' }).innerHTML = svg
    document.documentElement.appendChild(h)
    winEl = h
    return { os }
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

  // 调节滑块（右侧栏拖的时候）：CSS 变量写在 <html> 的行内样式上（带 !important，样式表里 !important 的默认值也压得住），
  // 属性直接改 <html> 上的；原来的行内值（连同优先级）、属性值都记着，撤掉时原样还原。不动文件
  const tweakVars = new Map() // 变量 → 原来的行内值 { v, p }（v 为空 = 原来没有）
  const tweakAttrs = new Map() // 属性 → 原来的值（null = 原来没有）
  function applyTweak(vars, attrs) {
    const de = document.documentElement
    const nv = vars && typeof vars === 'object' ? vars : {}
    const na = attrs && typeof attrs === 'object' ? attrs : {}
    for (const [k, old] of [...tweakVars]) {
      if (Object.hasOwn(nv, k)) continue
      if (old.v) de.style.setProperty(k, old.v, old.p)
      else de.style.removeProperty(k)
      tweakVars.delete(k)
    }
    for (const [k, v] of Object.entries(nv)) {
      if (!/^--[\w-]{1,60}$/.test(k) || v == null || String(v).length > 80) continue
      if (!tweakVars.has(k)) tweakVars.set(k, { v: de.style.getPropertyValue(k), p: de.style.getPropertyPriority(k) })
      de.style.setProperty(k, String(v), 'important')
    }
    for (const [a, old] of [...tweakAttrs]) {
      if (Object.hasOwn(na, a)) continue
      if (old == null) de.removeAttribute(a)
      else de.setAttribute(a, old)
      tweakAttrs.delete(a)
    }
    for (const [a, v] of Object.entries(na)) {
      if (!/^data-[a-z0-9-]{1,40}$/.test(a) || v == null || String(v).length > 60) continue
      if (!tweakAttrs.has(a)) tweakAttrs.set(a, de.getAttribute(a))
      de.setAttribute(a, String(v))
    }
  }

  addEventListener('message', (e) => {
    if (!parentWin || e.source !== parentWin || !parentOrigins.includes(e.origin)) return
    const d = e.data
    if (!d || d.dshDesign !== 1) return
    if (d.type === 'pick') start(d.hint !== false)
    else if (d.type === 'cancel') { if (!styleOn) stop(true) }
    else if (d.type === 'init') { if (d.relay) relay(); boot(d.seed || null) }
    else if (d.type === 'files') { relay(); onFiles(String(d.file || ''), Array.isArray(d.files) ? d.files : null) }
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
    else if (d.type === 'theme') { setDark(d.dark); postTop(); setTimeout(postTop, 400) }
    else if (d.type === 'demo') demo = !!d.on
    else if (d.type === 'edit') setTextEdit(!!d.on, d.hint !== false)
    else if (d.type === 'styleMode') setStyleMode(!!d.on)
    else if (d.type === 'styleSel') onStyleSel(d.selector)
    else if (d.type === 'style') { styleApply(d.css); queueTop() }
    else if (d.type === 'tweak') { applyTweak(d.vars, d.attrs); queueTop() }
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
        capsule: (how) => showCapsule(how),
        winctl: (how) => showWinCtl(how),
        /** 调节滑块的值套到页面上（和右侧栏拖的时候一样） */
        tweak: (vars, attrs) => { applyTweak(vars, attrs); return true },
        settle: () => settle().then(() => true),
        /** 跳到别的屏的地方（路径和按钮上的字），量完查一下目标在不在 */
        links: () => linksOf().map(({ path, text }) => ({ path, text })),
        info: () => {
          const meta = document.querySelector('meta[name="dsh-design"]')
          return { title: document.title, meta: meta ? String(meta.getAttribute('content') || '').slice(0, 80) : '', page: Math.max(se().scrollHeight, innerHeight), w: innerWidth, h: innerHeight, topDark: topDark(), natural: naturalSize() }
        },
        /** 'end'：所有能滚的地方都滚到底；数字 i：主要的那块滚到第 i 屏（相邻两屏留出顶栏、底栏的高度，栏后面的内容下一屏能看到） */
        // 滚完等页面跟上再截图
        scroll: (where) => {
          const after = afterScroll
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
        /** 一个元素的某一项样式由哪条规则决定（体检找文件和行号用）：{ sel, href, n, maybe? } / { inline: true } / null */
        ruleOf: (sel, prop) => {
          let el = null
          try { el = document.querySelector(sel) } catch { el = null }
          return el ? rulesOf(el, [String(prop)])[String(prop)] || null : null
        },
        /** 体检的问题附图：{ sel, other?, edge?, hscroll?, also? } → 摆好、画红框，给裁剪范围 { x, y, w, h, inside }（整页坐标） */
        crop: (o) => cropAt(o || {}),
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

  /** 目录里有文件改了（file 是最后一个，files 是这一批全部；空的 = 不知道改了啥） */
  function onFiles(file, files) {
    if (!shown) return
    if (othersOnly(files)) return
    if (parentWin) post({ type: 'changed', file, seed: seedNow() })
    else selfReload()
  }

  // 改动通知：在右侧栏里由右侧栏转告（init 里说 relay，之后发 files）。每屏各开一条 SSE 的话，
  // 画布上到 6 屏就占满浏览器对同一地址的 6 条连接，之后刷新要载的页面、样式表全排着队，预览从此不再变。
  // 不在右侧栏里（手机上看、单独打开），或右侧栏是老版本不转告（等 3 秒没说），才自己开 SSE。
  // 旧版本（/__dsh_design__/v/…）只读，不跟着目录改动刷新
  const LIVE = !!cfg.live && !!window.EventSource && !location.pathname.startsWith('/__dsh_design__/v/')
  let es = null
  let relayed = false
  const openEvents = () => {
    if (es || relayed || !LIVE) return
    es = new EventSource('/__dsh_design__/events')
    es.addEventListener('change', (e) => {
      let d = {}
      try { d = JSON.parse(e.data) || {} } catch { /* 没带文件名 */ }
      onFiles(d.file || '', d.files || null)
    })
  }
  function relay() {
    relayed = true
    if (es) { es.close(); es = null }
  }
  if (!parentWin) openEvents()
  else setTimeout(openEvents, 3000)
})()
