/**
 * 整套 HTML 演示（#26）的测试（不用开 DSH）：
 *   node test/test-htmlpack.mjs
 *
 * htmlpack.js：外壳尺寸、认跳转的写法和 client.js / picker.js 是同一份；每屏打包、大图只存一份、
 * 别人做的页面加硬规矩、文件里没有本机地址；接口 /api/htmlpack；
 * 真浏览器从 file:// 打开：图标画出来了、点链接 / onclick / 脚本跳转换屏、页内锚点、存储跨屏、深色、调节值、外壳开关、手机上铺满。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// frameEval 在 iframe 的隔离环境里跑：DOM 是同一份，页面的 JS 变量看不到——页面里的结果写在 DOM 上
const here = path.dirname(fileURLToPath(import.meta.url))
const realHome = os.homedir()

// HOME 换成临时目录：接口会记会话状态（~/.dsh/cache），别碰真的
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-htmlpack-'))
process.env.HOME = tmp
process.env.USERPROFILE = tmp
const { buildPack, FRAME, CAP, LIGHTS, WINBTN, FRAMED, FIXED, LINK_SEL, LINK_JS, PACK_ORIGIN, frameOf } = await import('../lib/htmlpack.js')
const { findBrowser, createBrowser } = await import('../lib/browser.js')

// ── 和 client.js / picker.js 同一份数 ──
const client = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const picker = fs.readFileSync(path.join(here, '..', 'lib', 'picker.js'), 'utf8')
const lit = (src, name) => {
  const i = src.indexOf(`const ${name} = {`)
  if (i < 0) return null
  let depth = 0
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return Function(`return (${src.slice(src.indexOf('{', i), j + 1)})`)()
  }
  return null
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
check('外壳尺寸和 client.js 一样：FRAME', same(lit(client, 'FRAME'), FRAME))
check('外壳尺寸和 client.js 一样：CAP / LIGHTS / WINBTN', same(lit(client, 'CAP'), CAP) && same(lit(client, 'LIGHTS'), LIGHTS) && same(lit(client, 'WINBTN'), WINBTN))
check('类型分组和 client.js 一样：FRAMED / FIXED', same(lit(client, 'FRAMED'), FRAMED) && same(lit(client, 'FIXED'), FIXED))
check('认跳转的写法和 picker.js 一样：LINK_SEL', picker.includes(`const LINK_SEL = '${LINK_SEL}'`))
check('认跳转的写法和 picker.js 一样：LINK_JS', picker.includes(`const LINK_JS = ${LINK_JS.toString()}`))
check('矮手机没有灵动岛（和 client.js 的 frameOf 一样）', frameOf('app', 375, 667).island === 0 && frameOf('app', 390, 844).island === 11)

// ── 打包 ──
const site = path.join(tmp, 'site')
fs.mkdirSync(path.join(site, 'img'), { recursive: true })
// 一张真的 PNG（48×48 杂色，压不小，几 KB）：两屏都用，包里只该存一份
function makePng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let x = 12345
  for (let i = 0; i < raw.length; i++) { x = (x * 1103515245 + 12345) >>> 0; raw[i] = i % (w * 3 + 1) === 0 ? 0 : x >>> 24 }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const BIG = makePng(48, 48)
fs.writeFileSync(path.join(site, 'img', 'hero.png'), BIG)
fs.writeFileSync(path.join(site, 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="cart" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20"/></symbol><symbol id="home" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></symbol></svg>')
fs.writeFileSync(path.join(site, 'app.css'), ':root{--brand:#c2410c}body{margin:0;font:16px sans-serif;background:var(--bg,#fff)}@media (prefers-color-scheme: dark){body{background:#123456}}@media (prefers-color-scheme: dark) and (max-width: 600px){#far{color:rgb(1, 2, 3)}}@media (prefers-color-scheme: light){#ls{color:rgb(4, 5, 6)}}.ic{width:24px;height:24px;display:inline-block}#far{margin-top:2000px;height:50px}')
const page = (title, body, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="app.css">${extra}</head><body>${body}</body></html>`
fs.writeFileSync(path.join(site, 'home.html'), page('首页', [
  '<svg class="ic" id="ic1"><use href="icons.svg#cart"></use></svg>',
  '<img src="img/hero.png" alt="">',
  '<a id="to-detail" href="detail.html">详情</a>',
  '<button id="onclick-nav" onclick="location.href=\'detail.html#far\'">去详情的 far</button>',
  '<button id="script-nav">脚本跳</button>',
  '<a id="anchor" href="#far">往下</a>',
  '<a id="add" href="#" onclick="document.body.dataset.added=(+document.body.dataset.added||0)+1">加入购物车</a>',
  '<a id="tab2" href="#tab2">第二个标签</a>',
  '<script>document.getElementById("tab2").addEventListener("click",(e)=>{e.preventDefault();document.body.dataset.tab=2})</script>',
  '<a id="ext" href="https://example.com/x">外网</a>',
  '<script>window.open=function(){document.body.dataset.opened=(+document.body.dataset.opened||0)+1;return null}</script>',
  '<a id="leave" href="https://example.com/y">访问官网</a><script>addEventListener("click",(e)=>{if(e.target.id==="leave"){e.preventDefault();document.body.dataset.leave=1}})</script>',
  '<a id="all" href="#">全部</a><a id="t3" href="#tab3">待配送</a><script>addEventListener("hashchange",()=>{document.body.dataset.view=location.hash||"all"})</script>',
  '<a id="self" href="home.html">首页</a>',
  '<a id="priv" href="#" target="_blank">隐私政策</a>',
  '<a id="missing" href="nope.html">没有这屏</a>',
  '<a id="checkout" href="detail.html" onclick="localStorage.setItem(\'cart\',\'2\')">去结算</a>',
  '<a id="guard" href="detail.html">要先登录</a><script>document.getElementById("guard").addEventListener("click",(e)=>{e.preventDefault();document.body.dataset.guard=1})</script>',
  '<input type="checkbox" id="agree"><button id="agree-go" onclick="if(!document.getElementById(\'agree\').checked){document.body.dataset.warn=1;return} location.href=\'detail.html\'">同意后继续</button>',
  '<a id="acct" href="nope.html" onclick="this.setAttribute(\'href\',\'detail.html\')">我的账户</a>',
  '<div data-href="nope.html"><button id="deliv" data-href="detail.html" onclick="event.stopPropagation()">查看配送</button></div>',
  '<a id="acct2" href="nope.html">我的订单</a><script>addEventListener("click",(e)=>{if(e.target.id==="acct2")e.target.setAttribute("href","detail.html")})</script>',
  '<a id="acct3" href="#">我的收藏</a><script>addEventListener("click",(e)=>{if(e.target.id==="acct3")e.target.setAttribute("href","detail.html")})</script>',
  '<button id="ph" data-href="#" onclick="this.dataset.href=\'detail.html\'">查看详情</button>',
  '<a id="blank" href="detail.html" target="_blank">新窗口打开详情</a>',
  '<div data-href="detail.html" id="card"><b>卡片</b><button id="fav">收藏</button></div><script>document.getElementById("fav").addEventListener("click",(e)=>{e.stopPropagation();document.body.dataset.fav=1})</script>',
  '<form id="search"><input name="q" value="面"><button id="search-go">搜</button></form>',
  '<p id="ls"></p><p id="far">far</p>',
  '<script>document.getElementById("script-nav").addEventListener("click",()=>{location.href="detail.html"});localStorage.setItem("who","阿青");document.getElementById("ls").textContent="ok"</script>',
  '<script>window.__danger = "</script>"; var ls2 = "\u2028"</script>',
].join('')))
fs.writeFileSync(path.join(site, 'night2.html'), page('只有深色 meta', '<input id="in">', '<meta name="color-scheme" content="dark">'))
fs.writeFileSync(path.join(site, 'night.html'), page('只有深色', '<input id="in">', '<style>:root{color-scheme:dark}</style>'))
fs.writeFileSync(path.join(site, 'detail.html'), page('详情', '<svg class="ic"><use href="icons.svg#home"></use></svg><img src="img/hero.png" alt=""><p id="who"></p><p id="cart"></p><p id="far">far</p><script>document.getElementById("who").textContent=localStorage.getItem("who")||"(空)";document.getElementById("cart").textContent=localStorage.getItem("cart")||"(空)"</script>'))

const readOf = (root) => (rel) => { const f = path.join(root, rel); try { return fs.statSync(f).isFile() ? fs.readFileSync(f) : null } catch { return null } }
const screens = [{ key: 'home.html', label: '首页', top: false }, { key: 'detail.html', label: '详情', top: true }, { key: 'gone.html', label: '没了' }]
const t0 = Date.now()
const pack = buildPack({ screens, read: readOf(site), kind: 'app', w: 390, h: 844, title: '咖啡外带', lang: 'zh', tweak: { vars: { '--brand': '#0f766e' }, attrs: { 'data-density': 'compact' } } })
const ms = Date.now() - t0
check('打包：读得到的两屏进去了，没读到的报出来', pack.count === 2 && same(pack.missing, ['gone.html']), JSON.stringify(pack.missing))
check('打包：快（不截图）', ms < 2000, ms + 'ms')
const b64 = BIG.toString('base64')
check('打包：两屏共用的大图只存一份', pack.html.split(b64).length - 1 === 1, String(pack.html.split(b64).length - 1))
const screen0 = JSON.parse(pack.html.match(/<script type="application\/json" id="ddp-s-0">([\s\S]*?)<\/script>/)[1])
check('打包：图标雪碧图内联了（file:// 下外部 <use> 被浏览器拦）', /<symbol id="dsh\d+-cart"/.test(screen0) && / href="#dsh\d+-cart"/.test(screen0), screen0.slice(0, 200))
check('打包：文件里没有本机地址、设计台内部路径', !/127\.0\.0\.1|localhost|__dsh_design__/.test(pack.html) && !pack.html.includes(realHome) && !pack.html.includes(tmp))
check('打包：页面里的 </script> 断不了包', (pack.html.match(/<\/script>/gi) || []).length === (pack.html.match(/<script\b/gi) || []).length)
check('打包：<base> 指着假地址', pack.html.includes(PACK_ORIGIN.replace(/\//g, '\\/')) || pack.html.includes(PACK_ORIGIN))
let err = ''
try { buildPack({ screens: [{ key: 'gone.html', label: 'x' }], read: readOf(site), kind: 'app', w: 390, h: 844 }) } catch (e) { err = e.code }
check('打包：一屏都读不到报 noScreens', err === 'noScreens')

// 别人做的页面（设计库来的）：加 CSP，页面自己的脚本跑不了，我们的带 nonce
const strictPack = buildPack({ screens: [{ key: 'home.html', label: '首页' }], read: readOf(site), strictOf: () => true, kind: 'web', w: 1280, h: 800 })
const strictHtml = JSON.parse(strictPack.html.match(/<script type="application\/json" id="ddp-s-0">([\s\S]*?)<\/script>/)[1])
check('别人做的：带 CSP，我们的脚本带 nonce', /Content-Security-Policy/.test(strictHtml) && /<script nonce="[^"]+">\(function storeShim/.test(strictHtml))
check('别人做的：沙盒只给 allow-scripts（配置里标了 strict）', /"strict":true/.test(strictPack.html))

// ── 接口 /api/htmlpack ──
const { apply } = await import('../lib/index.js')
const handlers = {}
const ctx = {
  logger: { warn: () => {}, info: () => {} },
  effect: (fn) => { try { return fn() } catch { return () => {} } },
  webServer: { register: (r) => { handlers[r.path] = r.handler; return () => {} }, getOrigin: () => 'http://127.0.0.1:1' },
  tools: { register: () => {} },
  on: (name, fn) => { ons[name] = fn; return () => {} },
  get: () => null,
  inject: () => {},
}
const ons = {}
apply(ctx)
let archiveOk = typeof ons['workspace/session-archived'] === 'function'
try { ons['workspace/session-archived']({ sessionId: 'nobody' }); ons['workspace/session-archived'](undefined) } catch { archiveOk = false }
check('会话归档时关掉它的公网链接（听 DSH 的归档事件，收到怪参数不出错）', archiveOk)
const srv = http.createServer((req, res) => {
  const h = handlers[new URL(req.url, 'http://x').pathname]
  if (h) h(req, res); else { res.writeHead(404); res.end() }
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const call = (name, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/dsh-design-studio/api/' + name, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let acc = ''
    res.on('data', (d) => { acc += d })
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(acc || '{}') }))
  })
  r.on('error', reject)
  r.end(data)
})
const opened = await call('open', { session: 's1', target: path.join(site, 'home.html') })
check('接口：先打开一个设计目录', opened.status === 200, JSON.stringify(opened.body))
const target = `file|${site}`
let r = await call('htmlpack', { session: 's1', target, name: '咖啡/外带', kind: 'app', w: 390, h: 844, screens: [{ key: 'home.html', label: '首页' }, { key: 'detail.html', label: '详情' }, { key: 'home.html', label: '重复' }, { key: '../x.html', label: '越界' }] })
check('接口：存进设计目录的 exports/，重复和越界的屏去掉', r.status === 200 && r.body.path === path.join(site, 'exports', '咖啡-外带.html') && r.body.count === 2 && fs.existsSync(r.body.path), JSON.stringify(r.body))
r = await call('htmlpack', { session: 's1', target, name: '咖啡/外带', kind: 'app', w: 390, h: 844, screens: [{ key: 'home.html', label: '首页' }] })
check('接口：同名不覆盖', r.status === 200 && r.body.path.endsWith('咖啡-外带-2.html'), JSON.stringify(r.body))
const fitOf = (f) => JSON.parse(fs.readFileSync(f, 'utf8').match(/<script type="application\/json" id="ddp-cfg">([\s\S]*?)<\/script>/)[1]).shellDefault
r = await call('htmlpack', { session: 's1', target, name: 'web-fit', kind: 'web', w: 390, h: 844, fit: true, screens: [{ key: 'home.html', label: '首页' }] })
const r2 = await call('htmlpack', { session: 's1', target, name: 'web-fill', kind: 'web', w: 1280, h: 800, screens: [{ key: 'home.html', label: '首页' }] })
check('接口：网页开着「按画幅显示」→ 演示默认套浏览器框按画幅；没开 → 铺满', fitOf(r.body.path) === true && fitOf(r2.body.path) === false)
r = await call('htmlpack', { session: 's1', target: 'file|/没有这个目录', name: 'x', screens: [{ key: 'home.html', label: '首页' }] })
check('接口：导出途中换了设计，不存', r.status === 409 && r.body.error === 'designChanged', JSON.stringify(r.body))
r = await call('htmlpack', { session: 's1', target, name: 'x', screens: [] })
check('接口：没有屏拒', r.status === 400)
r = await call('htmlpack', { session: 'nobody', name: 'x', screens: [{ key: 'home.html' }] })
check('接口：不是本地文件的设计拒', r.status === 400 && r.body.error === 'not-file', JSON.stringify(r.body))
srv.close()

// ── 真浏览器：从 file:// 打开 ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  // 放到设计目录外面（发给别人就是这样：只有这一个文件）
  const outDir = path.join(tmp, 'sent')
  fs.mkdirSync(outDir)
  const file = path.join(outDir, 'demo.html')
  fs.writeFileSync(file, pack.html)
  const url = 'file://' + (process.platform === 'win32' ? '/' : '') + file.replace(/\\/g, '/')
  const b = createBrowser({ bin })
  try {
    await b.withPage({ url, w: 1280, h: 900 }, async (p) => {
      const until = async (expr, ms = 4000, inFrame = false) => {
        const end = Date.now() + ms
        for (;;) {
          let v
          try { v = inFrame ? await p.frameEval(expr) : await p.eval(expr) } catch { v = undefined }
          if (v || Date.now() > end) return v
          await sleep(100)
        }
      }
      const state = () => p.eval(`JSON.stringify({ hash: location.hash, count: document.getElementById('count').textContent, frames: document.querySelectorAll('iframe').length, dev: document.querySelector('.dev') && document.querySelector('.dev').className })`).then(JSON.parse)
      await until(`document.querySelector('iframe:not(.nx)')`)
      check('真浏览器：播放器起来了，第一屏、带手机外壳', (await state()).count === '1 / 2' && /k-app/.test((await state()).dev) && !/bare|fill/.test((await state()).dev))
      const icon = await until(`(() => { const u = document.querySelector('#ic1 use'); return u && u.getBBox().width > 0 ? u.getBBox().width : 0 })()`, 4000, true)
      check('真浏览器：图标画出来了（直接开 HTML 时缺的）', icon > 0, String(icon))
      check('真浏览器：图片是内联的、解得开', await p.frameEval(`(() => { const i = document.querySelector('img'); return i.complete && i.naturalWidth === 48 && i.src.startsWith('data:') })()`))
      check('真浏览器：页面用 localStorage 不报错', (await p.frameEval(`document.getElementById('ls').textContent`)) === 'ok')
      check('真浏览器：调节滑块没存的值带上了', (await p.frameEval(`getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() + '|' + document.documentElement.getAttribute('data-density')`)) === '#0f766e|compact')

      await p.frameEval(`document.getElementById('anchor').click()`)
      await sleep(300)
      const anchored = await p.frameEval(`JSON.stringify({ y: Math.round(scrollY), hash: location.hash })`).then(JSON.parse)
      check('真浏览器：页内锚点滚过去、不离开这一屏', anchored.y > 1000 && anchored.hash === '#far' && (await state()).count === '1 / 2', JSON.stringify(anchored))

      await p.frameEval(`scrollTo(0, 0); document.getElementById('add').click()`)
      await sleep(300)
      const added = await p.frameEval(`JSON.stringify({ added: +document.body.dataset.added || 0, home: !!document.getElementById('ls'), hash: location.hash })`).then(JSON.parse)
      check('真浏览器：href="#" 带 onclick 的按钮，页面自己的处理照跑、不离开这一屏', added.added === 1 && added.home && (await state()).count === '1 / 2', JSON.stringify(added))
      await p.frameEval(`document.getElementById('tab2').click()`)
      await sleep(300)
      const tab = await p.frameEval(`JSON.stringify({ tab: +document.body.dataset.tab || 0, hash: location.hash, home: !!document.getElementById('ls') })`).then(JSON.parse)
      check('真浏览器：页面自己拦了默认行为的锚点，# 不变、照页面的来', tab.tab === 2 && tab.hash !== '#tab2' && tab.home, JSON.stringify(tab))
      await p.frameEval(`document.getElementById('guard').click()`)
      await sleep(300)
      check('真浏览器：链到别的屏、但页面自己拦了默认行为（先登录之类）→ 不换屏、照页面的来', (await state()).count === '1 / 2' && (await p.frameEval(`document.body.dataset.guard || ''`)) === '1')
      await p.frameEval(`document.getElementById('agree-go').click()`)
      await sleep(300)
      check('真浏览器：onclick 里带条件的跳转，条件不满足（没勾同意）→ 不换屏', (await state()).count === '1 / 2' && (await p.frameEval(`document.body.dataset.warn || ''`)) === '1')
      const backHome = async () => {
        await p.eval(`history.back()`)
        await until(`document.getElementById('count').textContent === '1 / 2' && !document.querySelector('iframe.nx')`)
        await until(`document.getElementById('deliv')`, 4000, true)
      }
      await p.frameEval(`document.getElementById('acct').click()`)
      const acct = await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
      check('真浏览器：点击时页面才改 href 的链接（我的账户）→ 按改后的地址换屏', !!acct, (await state()).count)
      if (acct) await backHome()
      await p.frameEval(`document.getElementById('deliv').click()`)
      const deliv = await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
      check('真浏览器：data-href 按钮自己 stopPropagation（卡片里的「查看配送」）→ 照样换屏', !!deliv, (await state()).count)
      if (deliv) await backHome()
      await p.frameEval(`document.getElementById('fav').click()`)
      await sleep(300)
      check('真浏览器：data-href 卡片里的「收藏」按钮自己 stopPropagation → 不连带打开卡片', (await state()).count === '1 / 2' && (await p.frameEval(`document.body.dataset.fav || ''`)) === '1')
      for (const [id, what] of [['card', 'data-href 卡片本身'], ['acct2', 'window 上的点击监听才改 href'], ['acct3', 'href="#" 占位、window 上的点击监听才改成别的屏'], ['ph', 'data-href="#" 占位、点击时才填地址'], ['blank', 'target="_blank" 指着包里的屏']]) {
        await p.frameEval(`document.getElementById('${id}').click()`)
        const ok = await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
        check(`真浏览器：${what} → 在这儿换到那一屏`, !!ok, (await state()).count)
        if (ok) await backHome()
      }

      await p.frameEval(`document.getElementById('ext').click()`)
      await sleep(300)
      check('真浏览器：外网链接开新标签页、不把这一屏换掉', (await state()).count === '1 / 2' && (await p.frameEval(`document.getElementById('ls') ? 'home' + (document.body.dataset.opened || '') : ''`)) === 'home1')
      await p.frameEval(`document.getElementById('leave').click()`)
      await sleep(300)
      check('真浏览器：页面在 window 上自己拦了外网链接（确定要离开吗）→ 不开新标签页', (await p.frameEval(`(document.body.dataset.leave || '') + '|' + (document.body.dataset.opened || '')`)) === '1|1' && (await state()).count === '1 / 2')

      await p.frameEval(`document.getElementById('t3').click()`)
      await sleep(300)
      const v1 = await p.frameEval(`document.body.dataset.view || ''`)
      await p.frameEval(`document.getElementById('all').click()`)
      await sleep(300)
      const v2 = await p.frameEval(`JSON.stringify({ view: document.body.dataset.view || '', hash: location.hash })`).then(JSON.parse)
      check('真浏览器：按 # 换内容的页面，点「待配送」#tab3 换过去，再点「全部」href="#" 回到默认', v1 === '#tab3' && v2.view === 'all' && v2.hash === '' && (await state()).count === '1 / 2', v1 + ' ' + JSON.stringify(v2))
      await p.frameEval(`scrollTo(0, 600); document.body.dataset.mark2 = 'kept'; document.getElementById('self').click()`)
      await sleep(400)
      const self = await p.frameEval(`JSON.stringify({ y: Math.round(scrollY), mark: document.body.dataset.mark2 || '' })`).then(JSON.parse).catch(() => ({}))
      check('真浏览器：导航栏里指着本页的链接（首页）→ 不换屏、不白屏、回到顶上', self.mark === 'kept' && self.y === 0 && (await state()).count === '1 / 2', JSON.stringify(self))
      await p.frameEval(`location.hash = '#far'`)
      await sleep(200)
      await p.frameEval(`document.getElementById('priv').click()`)
      await sleep(300)
      const priv = await p.frameEval(`location.hash`)
      check('真浏览器：本页锚点写了 target="_blank"（页脚占位的隐私政策）→ 不开假地址的新标签页、留在这儿', priv === '' && (await state()).count === '1 / 2', priv)

      await p.frameEval(`document.body.dataset.mark = 'kept'; document.getElementById('search-go').click()`)
      await sleep(400)
      check('真浏览器：没写 action 的表单提交（搜索框按回车），留在这一屏、页面不重载', (await state()).count === '1 / 2' && (await p.frameEval(`document.body.dataset.mark || ''`).catch(() => '')) === 'kept')
      await p.frameEval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))`)
      await sleep(300)
      check('真浏览器：能滚的页面里按 PageDown 是往下看、不翻屏（手机的设计）', (await state()).count === '1 / 2')

      await p.frameEval(`document.getElementById('missing').click()`)
      const toast = await until(`(() => { const t = document.getElementById('toast'); return !t.hidden && t.textContent })()`)
      check('真浏览器：链到不在包里的屏，提示一下', /nope\.html/.test(String(toast)), String(toast))

      await p.frameEval(`document.getElementById('to-detail').click()`)
      await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
      const who = await until(`document.getElementById('who') && document.getElementById('who').textContent`, 4000, true)
      check('真浏览器：点链接换到详情，地址栏 # 跟着变', (await state()).hash === '#detail.html', JSON.stringify(await state()))
      check('真浏览器：上一屏存的 localStorage 这一屏读得到', who === '阿青', String(who))
      await p.eval(`history.back()`)
      await until(`document.getElementById('count').textContent === '1 / 2' && !document.querySelector('iframe.nx')`)
      await until(`document.getElementById('checkout')`, 4000, true)
      await p.frameEval(`document.getElementById('checkout').click()`)
      await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
      const cart = await until(`document.getElementById('cart') && document.getElementById('cart').textContent !== '(空)' && document.getElementById('cart').textContent`, 3000, true)
      check('真浏览器：链接带 onclick（去结算先存购物车）→ 页面自己的处理先跑完再换屏', cart === '2', String(cart))
      check('真浏览器：顶栏深色的屏，胶囊…（app 没有胶囊，不报错）', (await state()).frames >= 1)

      await p.eval(`history.back()`)
      await until(`document.getElementById('count').textContent === '1 / 2' && !document.querySelector('iframe.nx')`)
      check('真浏览器：浏览器后退回到上一屏', (await state()).count === '1 / 2')

      await until(`document.getElementById('onclick-nav')`, 4000, true)
      await p.frameEval(`document.getElementById('onclick-nav').click()`)
      await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
      await sleep(400)
      const deep = await until(`scrollY > 1000 ? Math.round(scrollY) : 0`, 3000, true)
      check('真浏览器：onclick="location.href=…#far" 换屏并滚到锚点', (await state()).count === '2 / 2' && deep > 1000, String(deep))

      await p.eval(`document.getElementById('prev').click()`)
      await until(`document.getElementById('count').textContent === '1 / 2' && !document.querySelector('iframe.nx')`)
      await until(`document.getElementById('script-nav')`, 4000, true)
      await p.frameEval(`document.getElementById('script-nav').click()`)
      const viaScript = await until(`document.getElementById('count').textContent === '2 / 2'`)
      check('真浏览器：脚本里 location.href 跳页也换屏（Navigation API）', !!viaScript)

      await p.eval(`document.getElementById('shell').click()`)
      await sleep(200)
      check('真浏览器：关外壳变纯画面', /bare/.test((await state()).dev), (await state()).dev)
      await p.eval(`document.getElementById('shell').click()`)

      await p.eval(`document.getElementById('prev').click()`)
      await until(`document.getElementById('count').textContent === '1 / 2'`)
      await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
      check('真浏览器：→ 键下一屏', !!(await until(`document.getElementById('count').textContent === '2 / 2'`)))
      check('真浏览器：没有往外联网的请求（外网链接没被点开在这一页）', !(await p.eval(`performance.getEntriesByType('resource').some((e) => /^https?:/.test(e.name))`)))
    })

    // 深色 + 网页：网页默认铺满窗口，深色时 @media dark 的规则生效
    const darkPack = buildPack({ screens: [{ key: 'home.html', label: '首页' }], read: readOf(site), kind: 'web', w: 1280, h: 800, dark: true })
    const darkFile = path.join(outDir, 'dark.html')
    fs.writeFileSync(darkFile, darkPack.html)
    await b.withPage({ url: 'file://' + (process.platform === 'win32' ? '/' : '') + darkFile.replace(/\\/g, '/'), w: 1280, h: 900 }, async (p) => {
      await sleep(900)
      const dev = await p.eval(`document.querySelector('.dev').className`)
      check('真浏览器：网页默认不套浏览器框、铺满', /fill/.test(dev), dev)
      const bg = await p.frameEval(`getComputedStyle(document.body).backgroundColor + '|' + document.documentElement.getAttribute('data-theme')`)
      check('真浏览器：深色导出的，深色样式生效', bg === 'rgb(18, 52, 86)|dark', bg)
    })
    // 别人做的屏（加硬规矩、不同源）：点链接照样换屏；只做了深色的页面，浅色导出时控件照它的深色
    const sp2 = buildPack({ screens: [{ key: 'home.html', label: '首页' }, { key: 'detail.html', label: '详情' }, { key: 'night.html', label: '夜' }, { key: 'night2.html', label: '夜 2' }], read: readOf(site), strictOf: () => true, kind: 'web', w: 1280, h: 800 })
    const strictFile = path.join(outDir, 'strict.html')
    fs.writeFileSync(strictFile, sp2.html)
    await b.withPage({ url: 'file://' + (process.platform === 'win32' ? '/' : '') + strictFile.replace(/\\/g, '/'), w: 1280, h: 900 }, async (p) => {
      await sleep(900)
      await p.frameEval(`document.getElementById('to-detail').click()`)
      let n = ''
      for (let i = 0; i < 40 && n !== '2 / 4'; i++) { await sleep(100); n = await p.eval(`document.getElementById('count').textContent`) }
      check('真浏览器：别人做的屏（不同源、带 CSP）点链接也换屏', n === '2 / 4', n)
      await p.eval(`location.hash = '#night.html'`)
      for (let i = 0; i < 40 && n !== '3 / 4'; i++) { await sleep(100); n = await p.eval(`document.getElementById('count').textContent`) }
      await sleep(400)
      const cs = await p.frameEval(`getComputedStyle(document.documentElement).colorScheme`).catch((e) => 'ERR ' + e.message)
      check('真浏览器：只做了深色的页面，浅色导出不把控件改成浅色', n === '3 / 4' && cs === 'dark', `${n} ${cs}`)
      await p.eval(`location.hash = '#night2.html'`)
      for (let i = 0; i < 40 && n !== '4 / 4'; i++) { await sleep(100); n = await p.eval(`document.getElementById('count').textContent`) }
      await sleep(400)
      const cs2 = await p.frameEval(`getComputedStyle(document.documentElement).colorScheme`).catch((e) => 'ERR ' + e.message)
      check('真浏览器：用 <meta name="color-scheme" content="dark"> 声明只做深色的，浅色导出也不改', n === '4 / 4' && cs2 !== 'light', `${n} ${cs2}`)
    })
    // 浅色导出的，对方电脑是深色也照浅色；导出时右侧栏是深色环境（没开「深色」）→ 只有 @media dark 生效，不打 data-theme
    // 顺带看：「深色且窄屏」的规则宽屏时不生效（别的条件照旧）；只写了浅色规则的，浅色导出在深色电脑上照样生效
    for (const [scheme, osDark, want] of [['light', true, 'rgb(255, 255, 255)||rgb(4, 5, 6)|rgb(0, 0, 0)'], ['dark', false, 'rgb(18, 52, 86)||rgb(0, 0, 0)|rgb(0, 0, 0)']]) {
      const sp = buildPack({ screens: [{ key: 'home.html', label: '首页' }], read: readOf(site), kind: 'web', w: 1280, h: 800, scheme })
      const f = path.join(outDir, `scheme-${scheme}.html`)
      fs.writeFileSync(f, sp.html)
      await b.withPage({ url: 'file://' + (process.platform === 'win32' ? '/' : '') + f.replace(/\\/g, '/'), w: 1000, h: 700, dark: osDark }, async (p) => {
        await sleep(900)
        const got = await p.frameEval(`[getComputedStyle(document.body).backgroundColor, document.documentElement.getAttribute('data-theme'), getComputedStyle(document.getElementById('ls')).color, getComputedStyle(document.getElementById('far')).color].join('|')`)
        check(`真浏览器：导出时是${scheme === 'light' ? '浅色' : '深色环境'}，对方电脑${osDark ? '深色' : '浅色'}，照导出时的显示`, got === want, got)
      })
    }
    // 手机上打开手机的设计：不套外壳、铺满，工具条收起来
    await b.withPage({ url, w: 390, h: 760 }, async (p) => {
      await sleep(900)
      const st = await p.eval(`JSON.stringify({ dev: document.querySelector('.dev').className, compact: document.body.classList.contains('compact'), bar: getComputedStyle(document.getElementById('bar')).display, menu: getComputedStyle(document.getElementById('menu')).display, menuBottom: Math.round(document.getElementById('menu').getBoundingClientRect().bottom) })`).then(JSON.parse)
      check('真浏览器：手机上看手机的设计，铺满、工具条收进顶上的小按钮（不挡底栏）', /fill/.test(st.dev) && st.compact && st.bar === 'none' && st.menu === 'block' && st.menuBottom <= 40, JSON.stringify(st))
      await p.eval(`document.getElementById('menu').click()`)
      check('真浏览器：点小按钮出工具条', (await p.eval(`getComputedStyle(document.getElementById('bar')).display`)) === 'flex')
    })
  } finally {
    b.destroy()
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
