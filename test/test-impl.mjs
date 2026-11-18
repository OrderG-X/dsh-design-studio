/**
 * 和做出来的比（#25）：
 *   node test/test-impl.mjs
 *
 * 记录（impl.js）：每屏记地址和上次比对，换了地址分数作废，存进文件、重开还在，乱写的字段不认；
 * 本机装着 Chrome / Edge 时再真开：页面里的设计台脚本报 main 槽位在哪（和 compare_design 同一份量法）、报滚动、替另一边滚且不回传
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createImpl, cleanRec } from '../lib/impl.js'
import { SLOT_BOX } from '../lib/slot.js'
import { createHub } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-impl-')))

// ── 记录 ──
{
  const file = path.join(tmp, 'cache', 'impl.json')
  let now = 1000
  const s = createImpl({ file, now: () => now })
  check('记录：没记过的设计是空的', JSON.stringify(s.list('/d')) === '{}' && s.get('/d', 'home.html') === null)
  s.set('/d', 'home.html', { url: 'http://localhost:5173/', by: 'model', pct: 12.345, boxes: [{ x: 1.4, y: 2, w: 30, h: 40, design: { d: '按钮' } }], cmp: [390, 844], slot: false, at: 'top', dark: false, whole: false, size: [390, 844] })
  const r = s.get('/d', 'home.html')
  check('记录：地址、分数（一位小数）、红框只留位置、比的大小', r.url === 'http://localhost:5173/' && r.pct === 12.3 && r.boxes.length === 1 && JSON.stringify(r.boxes[0]) === '{"x":1,"y":2,"w":30,"h":40}' && r.cmp.join() === '390,844' && r.size.join() === '390,844' && r.by === 'model' && r.when === 1000, JSON.stringify(r))
  s.shot('/d', 'home.html', Buffer.from('jpg'))
  now = 2000
  s.set('/d', 'home.html', { url: 'http://localhost:5173/', by: 'model', size: undefined })
  check('记录：没给尺寸（size: undefined）就去掉旧的尺寸，分数留着', !s.get('/d', 'home.html').size && s.get('/d', 'home.html').pct === 12.3 && s.get('/d', 'home.html').when === 2000)
  s.set('/d', 'home.html', { url: 'http://localhost:3000/home', by: 'user' })
  const moved = s.get('/d', 'home.html')
  check('记录：换了地址 → 旧的分数、红框、拼图都作废', moved.url === 'http://localhost:3000/home' && moved.pct === undefined && !moved.boxes && s.shot('/d', 'home.html') === null && moved.by === 'user', JSON.stringify(moved))
  s.set('/d', 'w.html', { url: 'http://localhost:5173/a', by: 'model', whole: true, at: 'bottom', pct: 5 })
  s.set('/d', 'w.html', { url: 'http://localhost:5173/b', by: 'user' })
  check('记录：换了地址 → 整屏比、比到底回到默认（那是给原来那页定的）', s.get('/d', 'w.html').whole === false && s.get('/d', 'w.html').at === 'top')
  check('记录：乱写的不认（没地址、地址太长、尺寸不对）', cleanRec({}) === null && cleanRec({ url: 'x'.repeat(3000) }) === null && !cleanRec({ url: 'http://localhost:1/', size: [0, 5] }).size && cleanRec({ url: 'http://localhost:1/', at: 'middle' }).at === 'top')
  for (let i = 0; i < 70; i++) s.set('/d', `p${i}.html`, { url: `http://localhost:5173/p${i}`, by: 'model' })
  check('记录：一个设计最多 60 屏，最久没碰的先丢', Object.keys(s.list('/d')).length === 60)
  s.flush()
  const again = createImpl({ file })
  check('记录：存进文件，重开还在', again.get('/d', 'p69.html') && again.get('/d', 'p69.html').url === 'http://localhost:5173/p69')
  fs.writeFileSync(file, '{坏了')
  check('记录：文件写坏了当空的', JSON.stringify(createImpl({ file }).list('/d')) === '{}')
}

// ── 真浏览器：设计台脚本里的同步 ──
const bin = findBrowser()
if (!bin) console.log('（这台电脑上没有 Chrome / Edge，跳过真浏览器那几项）')
else {
  const design = path.join(tmp, 'design')
  fs.mkdirSync(design)
  const card = '<div style="margin:20px;height:120px;background:#4d6bfe"></div>'
  // 外框 800×600：左边 200 宽侧栏、顶上 60 高标题栏；槽位左右各留 24、底下 24 → 内容那块 552×516
  const frame = (slotCss, body) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}.app{display:grid;grid-template-columns:200px 1fr;grid-template-rows:60px 1fr;width:800px;height:600px}.side{grid-row:1/3;background:#2b2f36}.bar{background:#e4e7ec}[data-slot=main]{background:#fff;${slotCss}}</style><template id="dsh-frame">{}</template></head><body><div class="app" data-frame="t/main"><aside class="side"></aside><div class="bar"></div><div data-slot="main">${body}</div></div></body></html>`
  fs.writeFileSync(path.join(design, 'framed-pad.html'), frame('overflow:auto;padding:0 24px 24px', card))
  fs.writeFileSync(path.join(design, 'framed-tall.html'), frame('overflow:auto;padding:0 24px 24px', card.repeat(20)))
  fs.writeFileSync(path.join(design, 'page-tall.html'), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>${card.repeat(30)}</body></html>`)
  fs.writeFileSync(path.join(design, 'inner.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}main{height:100%;overflow:auto}</style></head><body><main>${card.repeat(30)}</main></body></html>`)
  fs.writeFileSync(path.join(design, 'late.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}</style></head><body><p>加载中…</p></body></html>`)
  // 外框左边菜单很长、自己能滚；没外框的应用：窄侧栏和正文各自能滚
  fs.writeFileSync(path.join(design, 'framed-menu.html'), frame('overflow:auto;padding:0 24px 24px', card.repeat(20)).replace('.side{', '.side{overflow:auto;').replace('<aside class="side"></aside>', `<aside class="side">${'<p style="height:80px;color:#fff">菜单</p>'.repeat(30)}</aside>`))
  fs.writeFileSync(path.join(design, 'shell.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}.w{display:flex;height:100%}nav{width:160px;overflow:auto}main{flex:1;overflow:auto}</style></head><body><div class="w"><nav>${'<p style="height:80px">菜单</p>'.repeat(30)}</nav><main>${card.repeat(30)}</main></div></body></html>`)
  fs.writeFileSync(path.join(design, 'shell-long.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}.w{display:flex;height:100%}nav{width:160px;overflow:auto}main{flex:1;overflow:auto}</style></head><body><div class="w"><nav>${'<p style="height:80px">菜单</p>'.repeat(60)}</nav><main>${card.repeat(10)}</main></div></body></html>`)
  fs.writeFileSync(path.join(design, 'framed-short.html'), frame('overflow:auto;padding:0 24px 24px', card).replace('.side{', '.side{overflow:auto;').replace('<aside class="side"></aside>', `<aside class="side">${'<p style="height:80px;color:#fff">菜单</p>'.repeat(30)}</aside>`))
  fs.writeFileSync(path.join(design, 'links.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><a class="in" href="/page-tall.html">站内</a> <a class="out" href="https://example.com/">站外</a></body></html>`)
  fs.writeFileSync(path.join(design, 'mock.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><div data-frame="phone" style="width:300px;height:500px"><div data-slot="main"><p>Hi</p></div></div></body></html>`)
  // 外层：和设计稿同源（测试里能直接滚 iframe 里面），收设计台脚本发来的消息
  fs.writeFileSync(path.join(design, 'parent.html'), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:800px;height:600px}</style></head><body><iframe id="f"></iframe><script>
    window.msgs = []
    addEventListener('message', (e) => { if (e.source === document.getElementById('f').contentWindow && e.data && e.data.dshDesign === 1) msgs.push(e.data) })
    window.load = (u) => new Promise((r) => { msgs = []; const f = document.getElementById('f'); f.onload = () => r(true); f.src = u })
    window.send = (m) => document.getElementById('f').contentWindow.postMessage({ dshDesign: 1, ...m }, location.origin)
    window.doc = () => document.getElementById('f').contentDocument
    window.got = (type) => msgs.filter((m) => m.type === type)
  </script></body></html>`)
  let origin = ''
  const hub = createHub({ parents: () => (origin ? [origin] : []) })
  const entry = await hub.open({ kind: 'file', root: design })
  origin = entry.origin
  const b = createBrowser({ bin })
  try {
    const direct = await b.withPage({ url: `${origin}/framed-pad.html`, w: 800, h: 600 }, (page) => page.eval(SLOT_BOX))
    const res = await b.withPage({ url: `${origin}/parent.html`, w: 820, h: 620 }, async (page) => {
      const out = {}
      const wait = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.eval(expr); if (v) return v; await sleep(50) } return page.eval(expr) }
      // 套了外框：报槽位（内容那块）
      await page.eval(`load('framed-pad.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      out.slot = await wait(`(got('slot')[0] || {}).box`)
      out.first = await wait(`got('scrolled')[0]`)
      // 外框里能滚的是槽位：用户滚它 → 报位置；替它滚 → 滚过去、不回传
      await page.eval(`load('framed-tall.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`doc().querySelector('[data-slot=main]').scrollTop = 200`)
      out.userScroll = await wait(`got('scrolled').find((m) => !m.first)`)
      await page.eval(`msgs = []; send({ type: 'scrollTo', x: 0, y: 333 })`)
      await sleep(400)
      out.toSlot = await page.eval(`({ top: doc().querySelector('[data-slot=main]').scrollTop, page: doc().scrollingElement.scrollTop, echo: got('scrolled').filter((m) => !m.set).length, set: got('scrolled').filter((m) => m.set) })`)
      // 替它滚过了头：停在底，报实际停在哪（标着 set，对面不转）
      await page.eval(`msgs = []; send({ type: 'scrollTo', x: 0, y: 99999 })`)
      await sleep(300)
      out.clamp = await page.eval(`({ max: (() => { const m = doc().querySelector('[data-slot=main]'); return m.scrollHeight - m.clientHeight })(), set: got('scrolled').filter((m) => m.set) })`)
      await page.eval(`send({ type: 'sync', on: false })`)
      await page.eval(`msgs = []; doc().querySelector('[data-slot=main]').scrollTop = 50`)
      await sleep(300)
      out.offQuiet = await page.eval(`got('scrolled').length`)
      // 没套外框：槽位报 null，跟着滚的是页面本身
      await page.eval(`load('page-tall.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      out.plainSlot = await wait(`got('slot').length > 0 && { box: got('slot')[0].box }`)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 500 })`)
      await sleep(300)
      out.pageY = await page.eval(`doc().defaultView.scrollY`)
      // 页面本身不滚、里面一块大的滚动区（App 常见）：跟它
      await page.eval(`load('inner.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 400 })`)
      await sleep(300)
      out.innerY = await page.eval(`doc().querySelector('main').scrollTop`)
      // 换了路由（单页应用 pushState、改 #）：报给右侧栏
      await page.eval(`load('page-tall.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('route').length > 0`)
      await page.eval(`doc().defaultView.history.pushState(null, '', '/other.html?x=1')`)
      await wait(`got('route').length > 1`, 2000)
      await page.eval(`doc().defaultView.location.hash = '#/b'`)
      await wait(`got('route').length > 2`, 2000)
      out.routes = await page.eval(`got('route').map((m) => m.path)`)
      // 页面一开始滚不动（加载提示），主内容后长出来：替它滚时重新找能滚的那块
      await page.eval(`load('late.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`(() => { const d = doc(); d.body.innerHTML = '<main style="height:100%;overflow:auto">' + '<div style="height:120px;margin:20px;background:#4d6bfe"></div>'.repeat(30) + '</main>' })()`)
      await sleep(700)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 300 })`)
      await sleep(300)
      out.lateY = await page.eval(`doc().querySelector('main').scrollTop`)
      // 套了外框：滚左边长菜单不算（不报、不换跟的那块），滚槽位才报
      await page.eval(`load('framed-menu.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`msgs = []; doc().querySelector('.side').scrollTop = 300`)
      await sleep(300)
      out.menu = await page.eval(`got('scrolled').length`)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 120 })`)
      await sleep(300)
      out.menuMain = await page.eval(`({ main: doc().querySelector('[data-slot=main]').scrollTop, side: doc().querySelector('.side').scrollTop })`)
      // 没外框：窄侧栏滚了不抢走同步，替它滚的还是正文
      await page.eval(`load('shell.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`doc().querySelector('nav').scrollTop = 200`)
      await sleep(300)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 250 })`)
      await sleep(300)
      out.shell = await page.eval(`({ main: doc().querySelector('main').scrollTop, nav: doc().querySelector('nav').scrollTop })`)
      // 侧栏比正文长：一开始就跟正文，不跟侧栏
      await page.eval(`load('shell-long.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 250 })`)
      await sleep(300)
      out.shellLong = await page.eval(`({ main: doc().querySelector('main').scrollTop, nav: doc().querySelector('nav').scrollTop })`)
      // 套了外框、正文短（槽位滚不动）、菜单长：替它滚也不动菜单
      await page.eval(`load('framed-short.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      await wait(`got('scrolled').length > 0`)
      await page.eval(`send({ type: 'scrollTo', x: 0, y: 200 })`)
      await sleep(300)
      out.framedShort = await page.eval(`doc().querySelector('.side').scrollTop`)
      // 路由是不是用户点过去的：页面自己 pushState 不算；点过之后的算；整页跳过去的新页面也知道
      await page.eval(`load('links.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      await wait(`got('route').length > 0`)
      out.selfRoute = await page.eval(`got('route')[0].user`)
      await page.eval(`msgs = []; doc().querySelector('a.out').click()`)
      await sleep(300)
      out.out = await page.eval(`({ blocked: got('blocked').map((m) => m.href + '|' + m.why), path: doc().location.pathname })`)
      await page.eval(`doc().defaultView.history.pushState(null, '', '/links.html?tab=2')`)
      out.clickRoute = await wait(`got('route').find((m) => /tab=2/.test(m.path))`, 2000)
      await page.eval(`msgs = []; doc().querySelector('a.in').click()`)
      await wait(`got('hello').length > 0`, 5000)
      await page.eval(`send({ type: 'sync', on: true, slot: false })`)
      out.mpaRoute = await wait(`got('route')[0]`)
      // 普通设计里碰巧写了 data-frame 的手机示意框：不算外框
      await page.eval(`load('mock.html')`)
      await wait(`got('hello').length > 0`)
      await page.eval(`send({ type: 'sync', on: true, slot: true })`)
      out.mock = await wait(`got('slot').length > 0 && { box: got('slot')[0].box }`)
      return out
    })
    const s = res.slot || {}
    check('同步：套了外框报 main 槽位的内容那块（224,60 起 552×516）', s.vx === 224 && s.vy === 60 && s.w === 552 && s.h === 516 && !s.part && !s.hidden, JSON.stringify(s))
    check('同步：槽位和 compare_design 量的一样（同一份量法）', direct && ['vx', 'vy', 'w', 'h', 'fw', 'fh'].every((k) => direct[k] === s[k]), JSON.stringify({ direct, s }))
    check('同步：一开始报一下现在的位置（标着 first）', res.first && res.first.first === true && res.first.y === 0, JSON.stringify(res.first))
    check('同步：用户滚槽位 → 报位置', res.userScroll && res.userScroll.y === 200, JSON.stringify(res.userScroll))
    check('同步：替它滚 → 槽位滚过去（页面本身不动），不回传（只报一次实际位置，标着 set）', res.toSlot && res.toSlot.top === 333 && res.toSlot.page === 0 && res.toSlot.echo === 0 && res.toSlot.set.length === 1 && res.toSlot.set[0].y === 333, JSON.stringify(res.toSlot))
    check('同步：替它滚过了头 → 报的是停住的位置', res.clamp && res.clamp.set.length === 1 && res.clamp.max > 0 && res.clamp.set[0].y === res.clamp.max, JSON.stringify(res.clamp))
    check('同步：关了就不再报', res.offQuiet === 0, String(res.offQuiet))
    check('同步：没套外框槽位报 null，滚的是页面本身', res.plainSlot && res.plainSlot.box === null && res.pageY === 500, JSON.stringify({ p: res.plainSlot, y: res.pageY }))
    check('同步：页面不滚、里面有大滚动区 → 跟着滚它', res.innerY === 400, String(res.innerY))
    check('同步：换了路由（pushState、改 #）→ 报新路由', res.routes && res.routes[0] === '/page-tall.html' && res.routes.includes('/other.html?x=1') && res.routes.includes('/other.html?x=1#/b'), JSON.stringify(res.routes))
    check('同步：一开始滚不动、主内容后长出来 → 替它滚时找到能滚的那块', res.lateY === 300, String(res.lateY))
    check('同步：套了外框，滚左边长菜单不报；替它滚的是槽位、菜单不动', res.menu === 0 && res.menuMain && res.menuMain.main === 120 && res.menuMain.side === 300, JSON.stringify({ n: res.menu, m: res.menuMain }))
    check('同步：没外框，窄侧栏滚了不抢走同步，替它滚的还是正文', res.shell && res.shell.main === 250 && res.shell.nav === 200, JSON.stringify(res.shell))
    check('同步：后台页侧栏比正文长 → 一开始就跟正文', res.shellLong && res.shellLong.main === 250 && res.shellLong.nav === 0, JSON.stringify(res.shellLong))
    check('同步：套了外框、正文滚不动、菜单很长 → 替它滚不动菜单', res.framedShort === 0, String(res.framedShort))
    check('同步：一开始报的路由不算用户点的；点了站外链接 → 拦下、报一声、页面不动', res.selfRoute === false && res.out && res.out.blocked.join() === 'https://example.com/|sync' && res.out.path === '/links.html', JSON.stringify({ s: res.selfRoute, o: res.out }))
    check('同步：点过之后换的路由标着用户点的；整页跳过去的新页面也标着', res.clickRoute && res.clickRoute.user === true && res.mpaRoute && res.mpaRoute.path === '/page-tall.html' && res.mpaRoute.user === true, JSON.stringify({ c: res.clickRoute, m: res.mpaRoute }))
    check('同步：手机示意框（没登记的 data-frame）不当外框', res.mock && res.mock.box === null, JSON.stringify(res.mock))
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
