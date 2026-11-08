/*
 * 边写边看的草稿页里的小脚本（预览服务器给 /某屏.html?__ddp_draft=… 时注入在页面最前面）。
 *
 *   - 跟着写到的地方往下滚（自己往上翻了就不跟，翻回底部再接着跟）
 *   - 三只带名字的鼠标（排版 / 配色 / 文案）只去碰真正新长出来的东西，而且真的在「干活」：
 *     排版把新的一大块拖出一个框（标上是什么、多大），配色点一下给新上色的块刷上颜色，
 *     文案把新出来的一段字一个个打出来（这段字先藏着，打到哪露到哪）；
 *     模型停着不写，它们也停着——不循环、不演
 *   - 页面还没有正文（模型在写样式）时，把样式里已经定下来的颜色、字体一个个摆出来
 *   - 写完（文档 load）鼠标退场；右侧栏随后换上真文件
 */
(() => {
  if (window.__ddpDraft) return
  window.__ddpDraft = 1
  const zh = new URLSearchParams(location.search).get('lang') !== 'en'
  const NAMES = zh ? ['排版', '配色', '文案'] : ['Layout', 'Color', 'Copy']
  const PAL = zh ? '配色和字体' : 'Colors & type'
  const KIND = zh
    ? { top: '顶栏', bottom: '底栏', list: '列表', form: '表单', img: '图片', title: '标题', block: '内容' }
    : { top: 'Header', bottom: 'Footer', list: 'List', form: 'Form', img: 'Image', title: 'Title', block: 'Block' }
  const C = ['#4d6bfe', '#e8590c', '#0ca678']
  let still = false
  try { still = matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* 老浏览器 */ }
  const de = document.documentElement
  let zk = 1 // 画布缩小时鼠标、字放大的倍数（和 --k 一样）

  // 草稿里不要滚动条（跟着往下滚时一闪一闪的）
  const css = document.createElement('style')
  // 样式常写在正文后面：写到一半时没定尺寸的图标会撑满一屏，草稿里先给个上限（写完换真文件就没有了）
  css.textContent = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}svg:not([width]){max-width:40vw;max-height:40vh}' +
    // 新长出来的东西淡进来（只动透明度：不碰页面自己的 transform；:where 零权重，页面自己写了动画就听页面的）
    (still ? '' : '@keyframes ddp-in{from{opacity:0}}:where(body *){animation:ddp-in .3s ease-out backwards}')
  ;(document.head || de).appendChild(css)

  const host = document.createElement('ddp-draft-fx')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block'
  const sr = host.attachShadow({ mode: 'closed' })
  const EASE = 'cubic-bezier(.3,.7,.2,1)'
  sr.innerHTML = `<style>
:host{--k:1}
*{box-sizing:border-box}
.cur{position:absolute;left:0;top:0;opacity:0;transition:transform .6s ${EASE},opacity .35s;will-change:transform}
.cur.on{opacity:1}
.cur.live{transition:opacity .35s}
.cur svg{transition:transform .14s}
.cur.tap svg{transform:scale(.8)}
.cur svg{display:block;width:calc(16px * var(--k));height:calc(20px * var(--k));overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.cur path{fill:var(--c);stroke:#fff;stroke-width:1.5;stroke-linejoin:round}
.cur em{position:absolute;left:calc(12px * var(--k));top:calc(16px * var(--k));display:flex;align-items:center;gap:calc(4px * var(--k));padding:calc(2px * var(--k)) calc(7px * var(--k));border-radius:calc(6px * var(--k));
  background:var(--c);color:#fff;font:600 calc(11px * var(--k))/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-style:normal;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.18)}
.cur.flip em{left:auto;right:calc(-4px * var(--k))}
.cur em i{display:none;width:calc(9px * var(--k));height:calc(9px * var(--k));border-radius:50%;box-shadow:0 0 0 calc(1.5px * var(--k)) rgba(255,255,255,.95)}
.cur em i.on{display:block}
.cur em s{text-decoration:none;opacity:.85;font-weight:500}
.box{position:absolute;left:0;top:0;border:calc(1.5px * var(--k)) solid var(--c);background:color-mix(in srgb,var(--c) 7%,transparent);transition:opacity .6s}
.box.out{opacity:0}
.box s{position:absolute;width:calc(7px * var(--k));height:calc(7px * var(--k));background:#fff;border:calc(1.5px * var(--k)) solid var(--c);border-radius:calc(1.5px * var(--k))}
.box s:nth-of-type(1){left:calc(-4.25px * var(--k));top:calc(-4.25px * var(--k))}
.box s:nth-of-type(2){right:calc(-4.25px * var(--k));top:calc(-4.25px * var(--k))}
.box s:nth-of-type(3){left:calc(-4.25px * var(--k));bottom:calc(-4.25px * var(--k))}
.box s:nth-of-type(4){right:calc(-4.25px * var(--k));bottom:calc(-4.25px * var(--k))}
.box.in b{top:calc(4px * var(--k));left:calc(4px * var(--k))}
.box span{position:absolute;left:50%;top:100%;margin-top:calc(7px * var(--k));transform:translateX(-50%);padding:calc(1px * var(--k)) calc(6px * var(--k));border-radius:calc(4px * var(--k));
  background:var(--c);color:#fff;white-space:nowrap;font:600 calc(10px * var(--k))/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.box.up span{top:auto;bottom:calc(7px * var(--k));margin-top:0}
.paint{position:absolute;left:0;top:0;overflow:hidden}
.paint i{position:absolute;width:2px;height:2px;margin:-1px 0 0 -1px;border-radius:50%;transform:scale(0);
  background:radial-gradient(circle closest-side,transparent 58%,color-mix(in srgb,var(--c) 50%,#fff) 84%,transparent 100%)}
.caret{position:absolute;left:0;top:0;width:calc(2px * var(--k));border-radius:1px;background:${C[2]};opacity:0;transition:opacity .2s}
.caret.on{opacity:1;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:.25}}
.box b{position:absolute;left:calc(-1.5px * var(--k));top:calc(-19px * var(--k));padding:calc(1px * var(--k)) calc(6px * var(--k));border-radius:calc(4px * var(--k));background:var(--c);color:#fff;
  font:600 calc(10px * var(--k))/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.pal{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);transition:opacity .4s,transform .3s;width:min(86%, calc(340px * var(--k)));padding:calc(16px * var(--k)) calc(18px * var(--k));border-radius:calc(14px * var(--k));
  background:rgba(255,255,255,.94);box-shadow:0 calc(10px * var(--k)) calc(30px * var(--k)) rgba(20,20,40,.14),0 0 0 calc(.5px * var(--k)) rgba(0,0,0,.08);color:#1d1d24;
  font:500 calc(11px * var(--k))/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;opacity:0}
.pal.on{opacity:1}
.pal.out{opacity:0;transform:translate(-50%,-50%) scale(.96);transition-duration:.22s}
.pal h6{margin:0 0 calc(10px * var(--k));font-size:calc(11px * var(--k));font-weight:600;color:#8a8a96;letter-spacing:.04em}
.sw{display:flex;flex-wrap:wrap;gap:calc(10px * var(--k))}
.sw span{display:flex;flex-direction:column;align-items:center;gap:calc(4px * var(--k));width:calc(48px * var(--k));animation:pop .42s ${EASE} both}
.sw i{width:calc(30px * var(--k));height:calc(30px * var(--k));border-radius:50%;box-shadow:inset 0 0 0 calc(1px * var(--k)) rgba(0,0,0,.1)}
.sw em{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:normal;font-size:calc(9.5px * var(--k));color:#6b6b78}
.ft{display:flex;flex-direction:column;gap:calc(6px * var(--k));margin-top:calc(12px * var(--k))}
.ft span{display:flex;align-items:baseline;gap:calc(8px * var(--k));animation:pop .42s ${EASE} both}
.ft b{font-size:calc(20px * var(--k));font-weight:600;line-height:1}
.ft em{font-style:normal;color:#6b6b78;font-size:calc(10.5px * var(--k))}
@keyframes pop{from{opacity:0;transform:translateY(calc(6px * var(--k))) scale(.8)}}
@media (prefers-reduced-motion:reduce){.cur,.box,.pal{transition:none}.sw span,.ft span,.caret.on{animation:none}}
</style><div class="pal"><h6>${PAL}</h6><div class="sw"></div><div class="ft"></div></div><div class="caret"></div>`
  const ARROW = '<svg viewBox="0 0 17 21"><path d="M1.2 1.2v15.6l4.3-4 3 6.6 2.9-1.3-3-6.5h6z"/></svg>'
  const curs = NAMES.map((n, i) => {
    const el = document.createElement('div')
    el.className = 'cur'
    el.style.setProperty('--c', C[i])
    el.innerHTML = `${ARROW}<em><i></i><span></span><s></s></em>`
    el.querySelector('span').textContent = n
    sr.appendChild(el)
    // x/y：视口坐标；at：贴着的元素（滚动时跟着它走）和它身上的点（相对元素左上）
    // anim：正在演一个动作（拖框、打字），这时位置由动作自己一帧帧给，滚动跟随先别管它
    return { el, tip: el.querySelector('s'), dot: el.querySelector('i'), x: 0, y: 0, at: null, dx: 0, dy: 0, busyTill: 0, anim: false }
  })
  const caret = sr.querySelector('.caret')
  const pal = sr.querySelector('.pal')
  const swBox = sr.querySelector('.sw')
  const ftBox = sr.querySelector('.ft')
  de.appendChild(host)

  const vw = () => innerWidth || de.clientWidth || 390
  const vh = () => innerHeight || de.clientHeight || 844
  const place = (c, x, y, loose) => {
    c.x = Math.max(4, Math.min(vw() - 6 - 16 * zk, x))
    c.y = loose ? y : Math.max(4, Math.min(vh() - 10, y))
    c.el.style.transform = `translate(${c.x}px, ${c.y}px)`
    c.el.classList.toggle('flip', c.x > vw() * 0.68)
  }
  // 一开始三只停在顶上，等第一笔
  curs.forEach((c, i) => place(c, vw() * (0.3 + i * 0.18), 56 + i * 10))

  // ── 跟着写到的地方往下滚 ──
  let follow = true
  let done = false
  const bottomGap = () => Math.max(0, de.scrollHeight - vh() - scrollY)
  const stop = () => { follow = false }
  addEventListener('wheel', (e) => { if (e.deltaY < 0) stop() }, { passive: true })
  addEventListener('touchstart', stop, { passive: true })
  addEventListener('keydown', stop)
  addEventListener('scroll', () => {
    if (!follow && !done && bottomGap() < 24) follow = true // 翻回底部：接着跟
    track()
  }, { passive: true })
  const chase = () => {
    if (!follow || done) return
    if (bottomGap() > 2) scrollTo({ top: de.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  }

  // ── 新长出来的东西 ──
  const fresh = []
  const SKIP = /^(SCRIPT|STYLE|LINK|META|TITLE|TEMPLATE|NOSCRIPT|BR|HEAD|HTML|BODY|BASE|DDP-DRAFT-FX|SOURCE|TRACK|PARAM|WBR)$/
  // 文案会去打的：成段的字（标题、段落、按钮、标签）；列表项、链接常常是整张卡片，不算
  const TYPE = /^(H1|H2|H3|H4|H5|H6|P|BUTTON|LABEL|FIGCAPTION|BLOCKQUOTE|DT|DD)$/
  let typing = null // { el, since }：藏着等打的那段
  const hold = (el) => {
    el.__ddpClip = [el.style.getPropertyValue('clip-path'), el.style.getPropertyPriority('clip-path')]
    el.style.setProperty('clip-path', 'inset(0 100% 100% 0)', 'important')
  }
  const release = (el) => {
    const was = el && el.__ddpClip
    if (!was) return
    el.style.removeProperty('clip-path')
    if (was[0]) el.style.setProperty('clip-path', was[0], was[1])
    delete el.__ddpClip
  }
  const mo = new MutationObserver((recs) => {
    if (!palGone && palOn && hasBody()) dropPal()
    for (const r of recs) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || SKIP.test(n.tagName)) continue
        fresh.push({ el: n, age: 0 })
        // 配色空着手：新上色的块先收着底色，等它来刷
        if (!painting && !still && !done && PAINT.test(n.tagName) && !n.closest('head')) {
          const col = solidBg(n)
          if (col && apart(col, pageBg())) {
            painting = { el: n, color: col, since: Date.now(), on: false }
            painted.add(n)
            holdBg(n, col)
            continue
          }
        }
        // 文案空着手：新出来的一段字先藏起来（这时还没画到屏上），等它来一个个打出来
        if (!typing && !still && !done && TYPE.test(n.tagName) && !n.closest('head')) {
          typing = { el: n, since: Date.now() }
          hold(n)
          requestAnimationFrame(tryType)
        }
      }
    }
  })
  mo.observe(de, { childList: true, subtree: true })

  const visible = (r) => r.width > 6 && r.height > 6 && r.bottom > 0 && r.top < vh() && r.right > 0 && r.left < vw()
  const bgOf = (el) => {
    try {
      const v = getComputedStyle(el).backgroundColor
      const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(v)
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.15)) return ''
      return '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')
    } catch { return '' }
  }
  const pageBg = () => (document.body && bgOf(document.body)) || bgOf(de) || '#ffffff'
  const rgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16))
  const dist = (a, b) => {
    const x = rgb(a)
    const y = rgb(b)
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
  }
  // 暗色页面的卡片常常只比底色亮一点点，也算
  const apart = (a, b) => !!a && (!b || dist(a, b) >= 24)
  const kindOf = (el, r) => {
    const tag = el.tagName
    let pos = ''
    try { pos = getComputedStyle(el).position } catch { /* 拿不到就算普通的 */ }
    // 钉在屏幕上的宽条：看在上面还是下面
    if ((pos === 'fixed' || pos === 'sticky') && r.width > vw() * 0.8) return r.top < vh() * 0.5 ? 'top' : 'bottom'
    // 不钉住的 header / nav：在页面最上面的是顶栏；中间的 header 是一节的标题，nav 是底下的导航
    if (tag === 'HEADER' || tag === 'NAV') return r.top + scrollY < vh() * 0.25 ? 'top' : tag === 'NAV' ? 'bottom' : 'title'
    if (tag === 'FOOTER') return 'bottom'
    if (tag === 'UL' || tag === 'OL' || tag === 'TABLE') return 'list'
    if (tag === 'FORM') return 'form'
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'CANVAS') return 'img'
    if (/^H[1-3]$/.test(tag)) return 'title'
    return 'block'
  }
  const BLOCK = /^(HEADER|NAV|SECTION|MAIN|FOOTER|ASIDE|ARTICLE|FORM|UL|OL|DIV|TABLE|FIGURE|IMG|PICTURE)$/

  // ── 鼠标去碰一个元素 ──
  const boxes = [] // 排版拖出来的框
  const paints = [] // 配色刷的那一下
  const firstCur = () => sr.querySelector('.cur')
  const sizeBox = (item, r) => {
    const s = item.b.style
    const p = item.p == null ? 1 : item.p
    s.width = r.width * p + 'px'
    s.height = r.height * p + 'px'
    s.transform = `translate(${r.left}px, ${r.top}px)`
  }
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  // 一个动作的每一帧；写完了（done）就直接跳到最后
  const anim = (ms, step, end) => {
    const t0 = performance.now()
    const f = (now) => {
      const t = done ? 1 : Math.min(1, (now - t0) / ms)
      step(t)
      if (t < 1) requestAnimationFrame(f)
      else if (end) end()
    }
    requestAnimationFrame(f)
  }
  const go = (c, el, dx, dy, tip, dot) => {
    c.at = el
    c.dx = dx
    c.dy = dy
    c.el.classList.add('on')
    c.tip.textContent = tip ? ' ' + tip : ''
    c.dot.classList.toggle('on', !!dot)
    if (dot) c.dot.style.background = dot
    const r = el.getBoundingClientRect()
    place(c, r.left + dx, r.top + dy)
  }
  const tap = (c) => {
    c.el.classList.add('tap')
    setTimeout(() => c.el.classList.remove('tap'), 150)
  }

  // 排版：走到这块的左上角，按住往右下拖出一个选框（四角把手，下面实时标着多大），松手标上是什么
  const drag = (c, el, label) => {
    go(c, el, 0, 0, '')
    const b = document.createElement('div')
    b.className = 'box'
    b.style.setProperty('--c', C[0])
    b.innerHTML = '<s></s><s></s><s></s><s></s><b></b><span></span>'
    b.querySelector('b').textContent = label
    const sz = b.querySelector('span')
    b.style.opacity = '0'
    sr.insertBefore(b, firstCur())
    const item = { b, el, p: 0 }
    boxes.push(item)
    sizeBox(item, el.getBoundingClientRect())
    setTimeout(() => {
      if (done || !el.isConnected) {
        b.remove()
        boxes.splice(boxes.indexOf(item), 1)
        return
      }
      b.style.opacity = ''
      c.anim = true
      c.el.classList.add('live')
      tap(c)
      anim(still ? 0 : 620, (t) => {
        item.p = ease(t)
        const r = el.getBoundingClientRect()
        sizeBox(item, r)
        // 名字贴不下（块顶着屏幕上沿）就放进框里；尺寸贴不下（块顶着下沿）就放框里底下
        b.classList.toggle('in', r.top < 22 * zk)
        b.classList.toggle('up', r.top + r.height * item.p > vh() - 26 * zk)
        sz.textContent = `${Math.round(r.width * item.p)} × ${Math.round(r.height * item.p)}`
        place(c, r.left + r.width * item.p, r.top + r.height * item.p)
      }, () => {
        const r = el.getBoundingClientRect()
        c.anim = false
        c.el.classList.remove('live')
        // 松手，往里收一点（别停在屏幕边上）
        c.dx = Math.max(0, r.width - 26 * zk)
        c.dy = Math.max(0, r.height - 8 * zk)
        place(c, r.left + c.dx, r.top + c.dy)
        setTimeout(() => b.classList.add('out'), 1200)
        setTimeout(() => { b.remove(); boxes.splice(boxes.indexOf(item), 1) }, 1900)
      })
    }, still ? 0 : 560)
  }

  // 配色：新上色的块先只留一圈虚线（底色先收着），配色走过去点一下，颜色从点的地方一圈刷满——刷的是块自己的底色，字一直在上面
  let painting = null // { el, color, since, on }：收着底色等刷的那块
  const BG = ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'outline', 'outline-offset', 'transition']
  const PAINT = /^(DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|NAV|BUTTON|A|LI|FIGURE|FORM|LABEL)$/
  const solidBg = (el) => {
    try {
      const cs = getComputedStyle(el)
      if (cs.backgroundImage !== 'none') return ''
      const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(cs.backgroundColor)
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.6)) return ''
      return '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')
    } catch { return '' }
  }
  const holdBg = (el, color) => {
    const st = el.style
    let line = color
    try {
      const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(getComputedStyle(el).color)
      const fg = m ? '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('') : ''
      const bg = pageBg()
      if (fg && dist(fg, bg) > dist(color, bg)) line = fg
    } catch { /* 拿不到字色就用块色 */ }
    el.__ddpBg = BG.map((k) => [k, st.getPropertyValue(k), st.getPropertyPriority(k)])
    st.setProperty('transition', 'none', 'important')
    st.setProperty('background-color', 'transparent', 'important')
    st.setProperty('background-image', 'none', 'important')
    st.setProperty('background-size', 'auto', 'important')
    st.setProperty('background-position', '0 0', 'important')
    st.setProperty('background-repeat', 'no-repeat', 'important')
    st.setProperty('outline', `${1.5 * zk}px dashed color-mix(in srgb, ${line} 55%, transparent)`, 'important')
    st.setProperty('outline-offset', `${-1.5 * zk}px`, 'important')
  }
  const releaseBg = (el) => {
    const was = el && el.__ddpBg
    if (!was) return
    delete el.__ddpBg
    const put = (k) => {
      const w = was.find((x) => x[0] === k)
      el.style.removeProperty(k)
      if (w && w[1]) el.style.setProperty(k, w[1], w[2])
    }
    for (const k of BG) if (k !== 'transition') put(k)
    // 过渡最后再还（同一帧还的话，页面自己的 transition 会把底色从透明慢慢变过来，闪一下）
    requestAnimationFrame(() => requestAnimationFrame(() => put('transition')))
  }
  const painted = new WeakSet()
  const fill = (c, el, color) => {
    const r0 = el.getBoundingClientRect()
    const dx = Math.max(4, Math.min(r0.width * 0.7, r0.width - 6))
    const dy = Math.max(4, Math.min(r0.height * 0.6, r0.height - 4, vh() - r0.top - 24))
    go(c, el, dx, dy, color, color)
    setTimeout(() => {
      if (!el.__ddpBg) return
      tap(c)
      el.style.setProperty('outline-color', 'transparent', 'important')
      const rim = `color-mix(in srgb, ${color} 55%, #fff)`
      anim(still ? 0 : 950, (t) => {
        if (!el.__ddpBg) return
        const r = el.getBoundingClientRect()
        const R = (Math.hypot(Math.max(dx, r.width - dx), Math.max(dy, r.height - dy)) + 16) * (1 - (1 - t) * (1 - t))
        const e = Math.min(R, 10 * zk)
        el.style.setProperty('background-image', `radial-gradient(circle at ${dx}px ${dy}px, ${color} ${R - e}px, ${rim} ${R - e * 0.3}px, transparent ${R}px)`, 'important')
      }, () => {
        releaseBg(el)
        if (painting && painting.el === el) painting = null
      })
    }, still ? 0 : 620)
  }
  // 没收住底色的（样式后到 / 渐变底）：点一下，泛起一圈光
  const paint = (c, el, color) => {
    const r0 = el.getBoundingClientRect()
    const dx = Math.min(r0.width * 0.7, r0.width - 6)
    const dy = Math.min(r0.height * 0.6, r0.height - 4)
    go(c, el, dx, dy, color, color)
    if (still) return
    setTimeout(() => {
      if (done || !el.isConnected || c.at !== el) return
      tap(c)
      const r = el.getBoundingClientRect()
      const w = document.createElement('div')
      w.className = 'paint'
      let rad = ''
      try { rad = getComputedStyle(el).borderRadius } catch { /* 拿不到就方的 */ }
      w.style.width = r.width + 'px'
      w.style.height = r.height + 'px'
      w.style.borderRadius = rad
      w.style.transform = `translate(${r.left}px, ${r.top}px)`
      const dot = document.createElement('i')
      dot.style.setProperty('--c', color)
      dot.style.left = dx + 'px'
      dot.style.top = dy + 'px'
      w.appendChild(dot)
      sr.insertBefore(w, firstCur())
      const item = { w, el }
      paints.push(item)
      const R = Math.hypot(Math.max(dx, r.width - dx), Math.max(dy, r.height - dy)) + 2
      try {
        dot.animate([{ transform: 'scale(0)', opacity: 0.9 }, { transform: `scale(${R * 1.15})`, opacity: 0 }], { duration: 800, easing: EASE, fill: 'forwards' })
      } catch { /* 没有 WAAPI 就不泛 */ }
      setTimeout(() => { w.remove(); paints.splice(paints.indexOf(item), 1) }, 850)
    }, 600)
  }

  // 文案：藏着的那段字，有字了、量得出大小了，就从头一个个打出来
  const linesOf = (el, er) => {
    const out = []
    try {
      const rg = document.createRange()
      rg.selectNodeContents(el)
      for (const q of rg.getClientRects()) {
        if (q.width < 1 || q.height < 1) continue
        const y0 = q.top - er.top
        const y1 = q.bottom - er.top
        const l = out.find((o) => y0 < o.y1 - 2 && y1 > o.y0 + 2)
        if (l) {
          l.x0 = Math.min(l.x0, q.left - er.left)
          l.x1 = Math.max(l.x1, q.right - er.left)
          l.y0 = Math.min(l.y0, y0)
          l.y1 = Math.max(l.y1, y1)
        } else out.push({ x0: q.left - er.left, x1: q.right - er.left, y0, y1 })
      }
    } catch { /* 量不了就整块一行 */ }
    if (!out.length) out.push({ x0: 0, x1: er.width, y0: 0, y1: er.height })
    out.sort((a, b) => a.y0 - b.y0)
    return out
  }
  function tryType() {
    const t = typing
    if (!t) return
    const el = t.el
    const c = curs[2]
    if (done || !el.isConnected) {
      release(el)
      typing = null
      return
    }
    const r = el.getBoundingClientRect()
    const n = (el.textContent || '').trim().length
    const ready = n >= 2 && r.width > 6 && r.height > 6 && r.top < vh() && r.bottom > 0 && Date.now() >= c.busyTill
    if (ready && el.children.length <= 4) return type(c, el, n)
    // 等了一阵还没字 / 一直在屏外 / 其实是一大块（里面一堆子元素）：不打了，直接露出来
    if (Date.now() - t.since > 1600 || el.children.length > 4) {
      release(el)
      typing = null
      return
    }
    requestAnimationFrame(tryType)
  }
  const type = (c, el, n) => {
    const ms = Math.max(280, Math.min(1100, n * 38))
    c.busyTill = Date.now() + ms + 400
    c.at = el
    c.anim = true
    c.el.classList.add('on', 'live')
    c.tip.textContent = ''
    c.dot.classList.remove('on')
    caret.classList.add('on')
    anim(ms, (t) => {
      const er = el.getBoundingClientRect()
      const lines = linesOf(el, er)
      const total = lines.reduce((s, l) => s + (l.x1 - l.x0), 0) || 1
      let left = total * t
      let i = 0
      while (i < lines.length - 1 && left > lines[i].x1 - lines[i].x0) {
        left -= lines[i].x1 - lines[i].x0
        i++
      }
      const L = lines[i]
      const x = Math.min(L.x1, L.x0 + left)
      const W = er.width + 8
      if (t < 1) el.style.setProperty('clip-path', `polygon(-8px -8px, ${W}px -8px, ${W}px ${L.y0}px, ${x}px ${L.y0}px, ${x}px ${L.y1}px, -8px ${L.y1}px)`, 'important')
      caret.style.height = L.y1 - L.y0 + 'px'
      caret.style.transform = `translate(${er.left + x}px, ${er.top + L.y0}px)`
      place(c, er.left + x + 4, er.top + L.y0 + (L.y1 - L.y0) * 0.7)
    }, () => {
      release(el)
      typing = null
      caret.classList.remove('on')
      c.anim = false
      c.el.classList.remove('live')
      const er = el.getBoundingClientRect()
      const ls = linesOf(el, er)
      const L = ls[ls.length - 1]
      c.dx = Math.min(er.width, L.x1 + 6 * zk)
      c.dy = L.y1 + 2 * zk
      place(c, er.left + c.dx, er.top + c.dy)
    })
  }
  // 滚动 / 版面变了：贴着元素的鼠标、框跟着走
  let raf = 0
  function track() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      for (const c of curs) {
        if (c.anim || !c.at || !c.at.isConnected) continue
        const r = c.at.getBoundingClientRect()
        place(c, r.left + Math.min(c.dx, r.width), r.top + Math.min(c.dy, r.height), r.bottom < 0 || r.top > vh())
      }
      for (const it of boxes) if (it.el.isConnected) sizeBox(it, it.el.getBoundingClientRect())
      for (const it of paints) {
        if (!it.el.isConnected) continue
        const r = it.el.getBoundingClientRect()
        it.w.style.transform = `translate(${r.left}px, ${r.top}px)`
      }
    })
  }

  // ── 还没正文：样式里定下来的颜色、字体 ──
  let palOn = false
  let palGone = false
  const swatches = new Map()
  const fonts = new Set()
  const GENERIC = /^(inherit|initial|unset|system-ui|-apple-system|BlinkMacSystemFont|sans-serif|serif|monospace|cursive|ui-\w+)$/i
  const firstFamily = (v) => {
    const f = String(v).split(',')[0].trim().replace(/^["']|["']$/g, '')
    return f && !/^var\(/i.test(f) && !GENERIC.test(f) ? f : ''
  }
  // 写到一半的 <style> 浏览器还没收进去（要等结束标签）：自己再拿一份原文流，边到边从里面挑颜色、字体
  let raw = ''
  ;(async () => {
    try {
      const r = await fetch(location.href, { cache: 'no-store' })
      if (!r.body) return
      const rd = r.body.getReader()
      const td = new TextDecoder()
      for (;;) {
        if (palGone || raw.length > 600000) break
        const { value, done: end } = await rd.read()
        if (end) break
        raw += td.decode(value, { stream: true })
        if (/<body[\s>]/i.test(raw)) break
      }
      rd.cancel().catch(() => {})
    } catch { /* 拿不到就只看已经生效的样式 */ }
  })()
  const scanCss = () => {
    const b = raw.search(/<body[\s>]/i)
    let txt = b >= 0 ? raw.slice(0, b) : raw
    for (const s of document.querySelectorAll('style')) if (s !== css && !raw) txt += s.textContent + '\n'
    for (const sh of document.styleSheets) {
      if (!sh.ownerNode || sh.ownerNode.tagName === 'STYLE') continue
      try { for (const r of sh.cssRules) txt += r.cssText + '\n' } catch { /* 跨源的样式读不了 */ }
    }
    const re = /--([\w-]+)\s*:\s*([^;{}]+)/g
    let m
    const added = { color: null, font: null }
    while ((m = re.exec(txt))) {
      const name = m[1]
      const v = m[2].trim()
      if (/font|family|serif|sans/i.test(name)) {
        const f = firstFamily(v)
        if (f && !fonts.has(f) && fonts.size < 3) { fonts.add(f); added.font = addFont(f, v) }
        continue
      }
      if (swatches.size >= 12 || swatches.has(v)) continue
      if (!/^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(v)) continue
      let ok = false
      try { ok = CSS.supports('color', v) } catch { ok = false }
      if (ok) { swatches.set(v, name); added.color = addSwatch(v, name) }
    }
    if (fonts.size < 3) {
      const fr = /font-family\s*:\s*([^;{}]+)/gi
      while ((m = fr.exec(txt)) && fonts.size < 3) {
        const f = firstFamily(m[1])
        if (f && !fonts.has(f)) { fonts.add(f); added.font = addFont(f, m[1]) }
      }
    }
    return added
  }
  const addSwatch = (v, name) => {
    const s = document.createElement('span')
    s.innerHTML = '<i></i><em></em>'
    s.firstChild.style.background = v
    s.lastChild.textContent = name
    swBox.appendChild(s)
    return s
  }
  const addFont = (f, stack) => {
    const s = document.createElement('span')
    s.innerHTML = '<b></b><em></em>'
    s.firstChild.textContent = zh ? 'Aa 字' : 'Aa'
    s.firstChild.style.fontFamily = stack
    s.lastChild.textContent = f
    ftBox.appendChild(s)
    return s
  }
  // 正文一冒头，配色卡片马上让开（别和页面叠着）
  const dropPal = () => {
    if (palGone) return
    palGone = true
    if (palOn) {
      pal.classList.add('out')
      setTimeout(() => pal.remove(), 300)
    } else pal.remove()
  }
  // 正文有东西了没有（body 里有看得见的元素）
  const hasBody = () => {
    const b = document.body
    if (!b) return false
    for (const k of b.children) {
      if (SKIP.test(k.tagName)) continue
      const r = k.getBoundingClientRect()
      if (r.width > 0 && r.height > 8) return true
    }
    return false
  }

  // ── 主循环：每一拍看看长出了什么，有新的才动 ──
  let turn = 0
  // 有正文了：页面没给底色就垫白（不然底下的占位透上来，和字叠在一起）
  let ownBg = null
  const backdrop = () => {
    if (ownBg === null) ownBg = !!bgOf(de)
    if (!ownBg) de.style.backgroundColor = (document.body && bgOf(document.body)) || '#ffffff'
  }
  const tick = () => {
    if (done) return
    const now = Date.now()
    if (!palGone) {
      if (hasBody()) dropPal()
      else {
        const add = scanCss()
        if (swatches.size || fonts.size) {
          if (!palOn) { palOn = true; pal.classList.add('on') }
          const pr = () => pal.getBoundingClientRect()
          // 配色那只去点刚摆上的颜色，排版那只去指刚出的字体
          if (add.color) setTimeout(() => { const r = add.color.getBoundingClientRect(); if (r.width) { curs[1].at = null; curs[1].el.classList.add('on'); curs[1].tip.textContent = ''; curs[1].dot.classList.remove('on'); place(curs[1], r.left + r.width * 0.6, r.top + r.height * 0.45); setTimeout(() => tap(curs[1]), 520) } }, 120)
          if (add.font) setTimeout(() => { const r = add.font.getBoundingClientRect(); if (r.width) { curs[0].at = null; curs[0].el.classList.add('on'); curs[0].tip.textContent = ''; curs[0].dot.classList.remove('on'); place(curs[0], r.left + 30, r.top + r.height * 0.7) } }, 260)
          if (!curs[2].el.classList.contains('on')) { const r = pr(); curs[2].el.classList.add('on'); place(curs[2], r.right - 24, r.top + 8) }
        }
        return
      }
    }
    backdrop()
    // 刚长出来的：过一两拍再看（字、样式可能还没到，量出来是 0）
    const ready = []
    for (let i = fresh.length - 1; i >= 0; i--) {
      const f = fresh[i]
      if (!f.el.isConnected || f.el.closest('head')) { fresh.splice(i, 1); continue }
      f.age++
      if (f.age >= 1) { ready.push(f.el); fresh.splice(i, 1) }
    }
    if (fresh.length > 400) fresh.splice(0, fresh.length - 400)
    chase()
    if (painting && !painting.on) {
      const p = painting
      const r = p.el.getBoundingClientRect()
      const c = curs[1]
      if (!p.el.isConnected || now - p.since > 2600) {
        releaseBg(p.el)
        painting = null
      } else if (r.width >= 36 && r.height >= 22 && visible(r) && (now >= c.busyTill || c.soft) && !c.anim) {
        p.on = true
        c.busyTill = now + 2000
        c.soft = false
        fill(c, p.el, p.color)
      }
    }
    if (!ready.length) return
    const bg = pageBg()
    const picks = [null, null, null]
    // ready 里新的在前：倒着挑，先挑早出来的（外层的块先出来，量起来也更完整）
    for (let i = ready.length - 1; i >= 0; i--) {
      const el = ready[i]
      const r = el.getBoundingClientRect()
      if (!visible(r)) continue
      if (!picks[0] && BLOCK.test(el.tagName) && r.width >= vw() * 0.42 && r.height >= 30 && r.height < vh() * 1.2) picks[0] = { el, r }
      if (!picks[1] && !painted.has(el)) {
        const c = bgOf(el)
        if (c && apart(c, bg) && r.width >= 14 && r.height >= 12 && r.width * r.height < vw() * vh() * 0.7) picks[1] = { el, r, c }
      }
      if (picks[0] && picks[1]) break
    }
    // 轮流来：这一拍谁先动换着排，两只不同时起步（文案那只看见新的字就自己去打，见 tryType）
    const order = [0, 1].map((k) => (k + turn) % 2)
    turn++
    order.forEach((k, j) => {
      const p = picks[k]
      const c = curs[k]
      if (!p || p.el === c.at || now < c.busyTill || c.anim) return
      if (k === 1 && painting) return // 有块收着底色等刷：先刷它
      c.busyTill = now + (k === 0 ? 1700 : 1500)
      if (k === 1) c.soft = true
      setTimeout(() => {
        if (done || !p.el.isConnected) return
        const r = p.el.getBoundingClientRect()
        if (k === 0) drag(c, p.el, KIND[kindOf(p.el, r)])
        else paint(c, p.el, p.c)
      }, j * 260)
    })
    // 闲着的：挪到正在写的地方（最新冒出来的东西下面）候着——只在真有新东西时挪，不自己晃
    let front = null
    for (const el of ready) {
      const r = el.getBoundingClientRect()
      if (visible(r)) { front = r; break }
    }
    if (!front) return
    curs.forEach((c, k) => {
      if (c.anim || now < c.busyTill + 500 || now < (c.restTill || 0)) return
      if ((k === 2 && typing) || (k === 1 && painting)) return
      c.restTill = now + 1500 + k * 250
      c.at = null
      c.tip.textContent = ''
      c.dot.classList.remove('on')
      c.el.classList.add('on')
      place(c, vw() * (0.2 + k * 0.27) + (turn % 3) * 6 * zk, Math.min(vh() - 34 * zk, front.bottom + (10 + k * 6) * zk))
    })
  }
  const timer = setInterval(tick, still ? 900 : 650)
  addEventListener('resize', track)

  // ── 写完：停下、鼠标退场、回到顶上（右侧栏马上换上真文件） ──
  addEventListener('load', () => {
    tick()
    done = true
    if (typing) {
      release(typing.el)
      typing = null
    }
    if (painting) {
      releaseBg(painting.el)
      painting = null
    }
    caret.classList.remove('on')
    clearInterval(timer)
    mo.disconnect()
    if (!palGone) pal.remove()
    setTimeout(() => {
      curs.forEach((c, i) => setTimeout(() => { c.el.classList.remove('on'); place(c, c.x, vh() + 40) }, i * 140))
      if (scrollY > 0) scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })
    }, 700)
  })

  // ── 和右侧栏：报到，收缩放（画布缩小时鼠标、字跟着放大，看起来一样大） ──
  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.dshDraft !== 'zoom') return
    const z = Number(e.data.z) || 1
    zk = Math.max(1, Math.min(6, 1 / z))
    host.style.setProperty('--k', String(zk))
    track()
  })
  try { parent.postMessage({ dshDraft: 'hello' }, '*') } catch { /* 没有父页面 */ }
})()
