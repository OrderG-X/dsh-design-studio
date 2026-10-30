/**
 * 转成代码（handoff.js）：
 *   node test/test-handoff.mjs
 *
 * 认出现有项目（框架、Tailwind、TypeScript、包管理）；文件名 → 路由；几屏共用的部分；做出来的页面地址只认本机；
 * 交接说明的内容（屏和路由、跳转、设计变量、共用组件、交互、滑块、素材、做法）；
 * 本机装着 Chrome / Edge 时再真开一回：交接包的截图；compare_design 一样的页面差异很小、改过的页面标出差在哪
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { detectProject, routeOf, sharedParts, implUrl, handoffMd, buildHandoff, compareScreens, blockAt, FRAMEWORKS, defaultDest, within, localOnly } from '../lib/handoff.js'
import { createHub } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-handoff-')))

// ── 项目 ──
{
  const p = path.join(tmp, 'app')
  fs.mkdirSync(p)
  check('项目：没有 package.json 就不是项目', detectProject(p).pkg === false)
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: 'shop-web', dependencies: { react: '18', 'react-dom': '18' }, devDependencies: { vite: '5', typescript: '5', tailwindcss: '3' } }))
  fs.writeFileSync(path.join(p, 'pnpm-lock.yaml'), '')
  const d = detectProject(p)
  check('项目：React + Vite、Tailwind、TypeScript、pnpm', d.pkg && d.framework === 'react' && d.label === 'React + Vite' && d.tailwind && d.ts && d.pm === 'pnpm' && d.name === 'shop-web', JSON.stringify(d))
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ dependencies: { next: '15', react: '19' } }))
  check('项目：Next.js 排在 React 前面', detectProject(p).framework === 'next')
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ dependencies: { nuxt: '3', vue: '3' } }))
  check('项目：Nuxt 算 vue', detectProject(p).framework === 'vue' && detectProject(p).label === 'Nuxt')
}
check('框架：四种都有名字，新建命令带项目名占位', Object.keys(FRAMEWORKS).join() === 'react,vue,next,html' && FRAMEWORKS.react.create.includes('{name}') && !FRAMEWORKS.html.create)
check('路由：index / home → /，别的 /名字', routeOf('index.html') === '/' && routeOf('Home.html') === '/' && routeOf('Order Detail.html') === '/order-detail' && routeOf('cart.htm') === '/cart')
{
  const parts = sharedParts(new Map([
    ['home.html', '<header class="topbar"><a class="topbar-logo">x</a></header><main class="hero"></main><nav class="tabbar active"></nav>'],
    ['cart.html', '<header class="topbar"></header><div class="list"></div><nav class="tabbar"></nav>'],
    ['me.html', '<nav class="tabbar"></nav><span class="topbar">x</span>'],
  ]))
  check('共用：几屏都有的外层 class 列出来（里面的 topbar-logo、状态 class 不算）', parts.map((p) => `${p.cls}:${p.n}`).join() === 'tabbar:3,topbar:2', JSON.stringify(parts))
}
check('地址：端口 → localhost；本机地址原样；本地文件 → file://', implUrl('5173') === 'http://localhost:5173/' && implUrl('http://127.0.0.1:3000/login') === 'http://127.0.0.1:3000/login' && implUrl('localhost:8080/a') === 'http://localhost:8080/a')
{
  let msg = ''
  try { implUrl('https://example.com') } catch (e) { msg = e.message }
  check('地址：别的网站不比', /只比本机/.test(msg), msg)
  msg = ''
  try { implUrl('nope.html', tmp) } catch (e) { msg = e.message }
  check('地址：本地文件不存在说清楚', /找不到/.test(msg))
}
check('本机：localhost / 127.0.0.1 / ::1、本地文件算；外网、别的协议不算', localOnly('http://localhost:5173/a') && localOnly('https://127.0.0.1/') && localOnly('http://[::1]:3000/') && localOnly('file:///tmp/a.html') && localOnly('about:blank') && !localOnly('http://example.com/') && !localOnly('http://localhost.evil.com/') && !localOnly('ftp://localhost/') && !localOnly('不是地址'))

// ── 代码放哪 ──
{
  const ws = path.join(tmp, 'ws')
  const des = path.join(ws, 'Shop Design')
  fs.mkdirSync(des, { recursive: true })
  check('放哪：会话目录没项目、设计目录在它下面 → 会话目录里新建 <名字>-app', defaultDest(des, ws, detectProject(ws)) === path.join(ws, 'shop-design-app'))
  fs.writeFileSync(path.join(ws, 'package.json'), '{"dependencies":{"react":"18"}}')
  check('放哪：会话目录是个项目（设计目录在它里面也行）→ 就放会话目录', defaultDest(des, ws, detectProject(ws)) === ws)
  fs.writeFileSync(path.join(des, 'package.json'), '{"dependencies":{"react":"18"}}')
  check('放哪：会话目录就是设计目录（有 package.json 也一样）→ 放旁边，不放进设计目录', defaultDest(des, des, detectProject(des)) === path.join(ws, 'shop-design-app'))
  check('放哪：设计目录在别处 → 放设计目录旁边', defaultDest(des, path.join(tmp, 'other'), detectProject(path.join(tmp, 'other'))) === path.join(ws, 'shop-design-app'))
  check('放哪：已经叫 xx-app 的设计 → xx-app-code', defaultDest(path.join(tmp, 'my-app'), tmp, null) === path.join(tmp, 'my-app-code'))
  check('在里面：本身、子目录、还没建的子目录都算；旁边的不算', within(des, des) && within(path.join(des, 'src'), des) && within(path.join(des, 'a', 'b'), des) && !within(path.join(ws, 'Shop Design-app'), des) && !within(ws, des))
  if (process.platform !== 'win32') {
    fs.symlinkSync(des, path.join(tmp, 'alias'))
    check('在里面：软链接的别名也认得出是设计目录', within(path.join(tmp, 'alias'), des) && within(path.join(tmp, 'alias', 'src'), des))
  }
  if (process.platform === 'darwin' || process.platform === 'win32') check('在里面：大小写不同也算（mac / Windows）', within(path.join(ws, 'shop design', 'src'), des))
}

// ── 交接包不跟软链接写到别处 ──
if (process.platform !== 'win32') {
  const outside = path.join(tmp, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'keep.jpg'), 'keep')
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
  const d1 = path.join(tmp, 'linked1')
  fs.mkdirSync(d1)
  fs.symlinkSync(outside, path.join(d1, 'handoff'))
  let err = ''
  try { await buildHandoff(null, { root: d1, screens: [], dest: path.join(tmp, 'x') }) } catch (e) { err = e.message }
  check('交接包：handoff 是软链接 → 不写，外面的图也没删', /不是普通文件夹/.test(err) && fs.existsSync(path.join(outside, 'keep.jpg')), err)
  const d2 = path.join(tmp, 'linked2')
  fs.mkdirSync(path.join(d2, 'handoff'), { recursive: true })
  fs.symlinkSync(outside, path.join(d2, 'handoff', 'shots'))
  err = ''
  try { await buildHandoff(null, { root: d2, screens: [], dest: path.join(tmp, 'x') }) } catch (e) { err = e.message }
  check('交接包：shots 是软链接 → 不写', /不是普通文件夹/.test(err) && fs.existsSync(path.join(outside, 'keep.jpg')), err)
  const d3 = path.join(tmp, 'linked3')
  fs.mkdirSync(path.join(d3, 'handoff'), { recursive: true })
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(d3, 'handoff', 'HANDOFF.md'))
  await buildHandoff(null, { root: d3, screens: [], dest: path.join(tmp, 'x') })
  check('交接包：HANDOFF.md 是软链接 → 换成普通文件，链接指的文件不动', fs.readFileSync(path.join(outside, 'secret.md'), 'utf8') === 'secret' && fs.lstatSync(path.join(d3, 'handoff', 'HANDOFF.md')).isFile())
}

check('差异框：找重叠最多的元素', blockAt([{ x: 0, y: 0, w: 100, h: 100, d: 'a' }, { x: 40, y: 40, w: 20, h: 20, d: 'b' }], { x: 38, y: 38, w: 24, h: 24 }).d === 'b' && blockAt([], { x: 0, y: 0, w: 1, h: 1 }) === null)

// ── 设计目录 ──
const design = path.join(tmp, 'shop')
fs.mkdirSync(path.join(design, 'img'), { recursive: true })
fs.writeFileSync(path.join(design, 'tokens.css'), '/* 设计系统「Lumen」的设计变量 */\n:root {\n  --color-bg: #f6f1e7;\n  --color-text: #1d1d1b;\n  --color-primary: #1f3d2b;\n  --radius-md: 12px;\n}\n')
fs.writeFileSync(path.join(design, 'app.css'), '.btn:hover { opacity: .9 }\n.card { border-radius: var(--radius-md) }\n')
fs.writeFileSync(path.join(design, 'img', 'hero.jpg'), 'x')
fs.writeFileSync(path.join(design, 'tweaks.json'), JSON.stringify([{ id: 'r', label: '圆角', var: '--radius-md', min: 0, max: 24, unit: 'px', value: 12 }]))
const PAGE = (title, body, extra = '') => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="app.css">
<style>body{margin:0;background:var(--color-bg);color:var(--color-text);font:16px/1.6 -apple-system,"PingFang SC",sans-serif}
.topbar{height:56px;display:flex;align-items:center;padding:0 24px;background:#fff}.hero{padding:48px 24px}h1{font-size:40px;margin:0 0 12px}
.btn{display:inline-block;padding:12px 22px;border-radius:999px;background:var(--color-primary);color:#fff;text-decoration:none}
.card{background:#fff;margin:0 24px 16px;padding:20px}${extra}</style></head><body>${body}</body></html>`
fs.writeFileSync(path.join(design, 'home.html'), PAGE('首页', '<header class="topbar">Lumen</header><section class="hero"><h1>每天一杯好咖啡</h1><a class="btn" href="menu.html">看菜单</a></section><div class="card">本周推荐：埃塞俄比亚</div><div class="card">新店开业</div>'))
fs.writeFileSync(path.join(design, 'menu.html'), PAGE('菜单', '<header class="topbar">Lumen</header><section class="hero"><h1>菜单</h1><form><input placeholder="搜索"></form><a href="cart.html">购物车</a></section><div class="card">手冲 ¥38</div><script>document.querySelector("input").addEventListener("input",()=>{})</script>'))
{
  const rows = [
    { key: 'home.html', label: 'home', title: '首页', links: [{ path: '/menu.html' }], shots: ['home-1.jpg'], mobile: 'home-mobile.jpg' },
    { key: 'menu.html', label: 'menu', title: '菜单', links: [{ path: '/cart.html' }], shots: ['menu-1.jpg', 'menu-2.jpg'] },
  ]
  const htmlByKey = new Map(['home.html', 'menu.html'].map((k) => [k, fs.readFileSync(path.join(design, k), 'utf8')]))
  const dest = path.join(tmp, 'shop-app')
  const md = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'react', dest, project: detectProject(dest), system: 'Lumen', htmlByKey, now: new Date('2026-10-30T10:00:00Z') })
  check('交接说明：标题、设计目录、新建项目的命令', md.startsWith('# 交接：shop → React + Vite') && md.includes(`\`${design}\``) && md.includes('npm create vite@latest shop-app -- --template react-ts'))
  check('交接说明：屏和路由表，跳到的屏，没有的那屏标出来', /\| 首页 \| home\.html \| `\/` \| home-1\.jpg、home-mobile\.jpg \| menu \|/.test(md) && /\| 菜单 \| menu\.html \| `\/menu` \|.*cart\.html（没有这一屏）/.test(md), md)
  check('交接说明：设计系统、设计变量（颜色列出来）', md.includes('设计系统：Lumen') && md.includes('`--color-primary: #1f3d2b`') && md.includes('`app.css`'))
  check('交接说明：共用的 topbar / card 做成组件', md.includes('`.topbar`：2 屏都有') && md.includes('→ `Topbar` 组件') && md.includes('`.card`'))
  check('交接说明：脚本、输入控件、悬停样式、滑块都提到', /menu\.html：1 段脚本.*1 个输入控件/.test(md) && /悬停.*1 处/.test(md) && /圆角（--radius-md，现在是 12px）/.test(md), md)
  check('交接说明：素材、做法（每屏 compare_design，3% 以内）', md.includes('`img/hero.jpg`') && md.includes('compare_design') && md.includes('3%'))
  const same = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'same', dest: '/x/proj', project: { dir: '/x/proj', pkg: true, name: 'proj', framework: 'vue', label: 'Vue + Vite', tailwind: true, ts: true, pm: 'pnpm' }, system: '', htmlByKey })
  const t2 = path.join(tmp, 'empty-tokens')
  fs.mkdirSync(t2)
  fs.writeFileSync(path.join(t2, 'tokens.css'), '.x { color: red }')
  const md2 = handoffMd({ root: t2, rows: [], kind: 'web', size: [1280, 800], framework: 'html', dest: '/x', project: null, system: '', htmlByKey: new Map() })
  check('交接说明：有 tokens.css 但没读到变量 ≠ 没有 tokens.css', /没读到变量/.test(md2) && !/没有 tokens\.css/.test(md2))
  check('交接说明：跟现有项目一样（Tailwind 要映射变量，不新建）', same.startsWith('# 交接：shop → Vue + Vite（跟项目一样）') && /现有项目 proj：Vue \+ Vite \+ Tailwind，TypeScript，包管理 pnpm/.test(same) && /theme\.extend/.test(same) && !/npm create/.test(same))
}

// ── 真浏览器 ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  // 比对用的几屏先写好（预览开着时再往设计目录写文件，页面会自己刷新，打断截图）
  const plain = (bg, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{background:${bg};font:16px sans-serif}${extra}</style></head><body><p>Hi</p></body></html>`
  const inner = (end) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}main{height:100vh;overflow:auto}.tall{height:2000px;background:#fff}.end{height:300px;background:${end}}</style></head><body><main><div class="tall">Hi</div><div class="end"></div></main></body></html>`
  const themed = plain('#fff', '[data-theme="dark"] body{background:#111;color:#eee}')
  fs.writeFileSync(path.join(design, 'white.html'), plain('#fff'))
  fs.writeFileSync(path.join(design, 'inner.html'), inner('#e00'))
  fs.writeFileSync(path.join(design, 'theme.html'), themed)
  // 深色的三种写法：属性 + 原生输入框、只有媒体查询、媒体查询写在前面被后面的规则盖住
  const forms = '<label>用户名<input value="name"></label><label>密码<input value="pw" type="password"></label>'
  const darkCases = {
    'dk-attr.html': plain('#fff', '[data-theme=dark] body{background:#000;color:#fff} input{display:block;width:400px;height:60px;margin:16px}').replace('<p>Hi</p>', forms),
    'dk-media.html': plain('#fff', '@media (prefers-color-scheme: dark){body{background:#000;color:#fff}} input{display:block;width:400px;height:60px;margin:16px}').replace('<p>Hi</p>', forms),
    'dk-order.html': '<!doctype html><html><head><meta charset="utf-8"><style>@media (prefers-color-scheme: dark){body{background:#000;color:#fff}} body{background:#fff;color:#000;margin:0}</style></head><body><p>Hi</p></body></html>',
  }
  for (const [f, html] of Object.entries(darkCases)) fs.writeFileSync(path.join(design, f), html)
  const hub = createHub({ parents: () => [] })
  const entry = await hub.open({ kind: 'file', root: design })
  const b = createBrowser({ bin })
  try {
    const screens = ['home.html', 'menu.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key.replace('.html', '') }))
    const r = await buildHandoff(b, { root: design, screens, kind: 'web', size: [1024, 700], framework: 'react', dest: path.join(tmp, 'shop-app'), system: 'Lumen' })
    const shots = fs.readdirSync(path.join(design, 'handoff', 'shots')).sort()
    check('交接包：HANDOFF.md 写了', fs.existsSync(r.file) && r.file === path.join(design, 'handoff', 'HANDOFF.md') && fs.readFileSync(r.file, 'utf8') === r.md)
    check('交接包：每屏截图 + 网页手机宽的一张', shots.includes('home-1.jpg') && shots.includes('home-mobile.jpg') && shots.includes('menu-1.jpg') && r.shots === shots.length, shots.join())
    check('交接包：标题、跳转从页面上拿到了', r.rows[0].title === '首页' && r.rows[0].links.some((l) => /menu\.html/.test(l.path)) && /\| 首页 \| home\.html .*\| menu \|/.test(r.md), JSON.stringify(r.rows[0].links))
    const again = await buildHandoff(b, { root: design, screens: screens.slice(0, 1), kind: 'app', size: [390, 844], framework: 'html', dest: path.join(tmp, 'site') })
    check('交接包：再做一次，旧截图清掉；App 不截手机宽那张', fs.readdirSync(path.join(design, 'handoff', 'shots')).join() === again.rows[0].shots.join() && !again.rows[0].mobile)

    // 做出来的：一份一样的（本地文件，没有设计台的脚本），一份改过的（按钮颜色、标题字号、少一张卡片）
    const impl = path.join(tmp, 'impl')
    fs.mkdirSync(impl)
    for (const f of ['tokens.css', 'app.css']) fs.copyFileSync(path.join(design, f), path.join(impl, f))
    fs.copyFileSync(path.join(design, 'home.html'), path.join(impl, 'same.html'))
    fs.writeFileSync(path.join(impl, 'diff.html'), fs.readFileSync(path.join(design, 'home.html'), 'utf8')
      .replace('h1{font-size:40px', 'h1{font-size:30px').replace('background:var(--color-primary);color:#fff', 'background:#c0392b;color:#fff').replace('<div class="card">新店开业</div>', ''))
    const design0 = screens[0]
    const same = await compareScreens(b, { design: design0, impl: pathToFileURL(path.join(impl, 'same.html')).href, size: [1024, 700] })
    check('比对：一样的页面差异 < 1%，说基本一致', same.pct < 1 && /基本一致/.test(same.text), same.text)
    const diff = await compareScreens(b, { design: design0, impl: pathToFileURL(path.join(impl, 'diff.html')).href, size: [1024, 700] })
    check('比对：改过的页面差异明显，列出差在哪几块', diff.pct > 1 && diff.boxes.length >= 1 && /差得最多的几块/.test(diff.text), diff.text)
    check('比对：差异块认得出是哪个元素（标题 / 按钮 / 卡片）', diff.boxes.some((x) => x.design && /h1|btn|card|每天一杯好咖啡|看菜单|新店开业/.test(`${x.design.d}${x.design.t || ''}`)), JSON.stringify(diff.boxes.map((x) => x.design)))
    check('比对：拼图是 JPEG，比单张宽（三栏）', diff.jpg[0] === 0xff && diff.jpg[1] === 0xd8 && diff.jpg.length > 5000)
    const bottom = await compareScreens(b, { design: design0, impl: pathToFileURL(path.join(impl, 'same.html')).href, size: [1024, 700], at: 'bottom' })
    check('比对：滚到底也能比', /滚到底/.test(bottom.text) && bottom.pct < 1, bottom.text)

    // 整屏淡灰 vs 白：无损截图，不当噪点
    fs.writeFileSync(path.join(impl, 'grey.html'), plain('#e8e8e8'))
    const grey = await compareScreens(b, { design: { key: 'white.html', url: `${entry.origin}/white.html`, label: 'white' }, impl: pathToFileURL(path.join(impl, 'grey.html')).href, size: [800, 600] })
    check('比对：整屏 #fff 对 #e8e8e8 算差异，不算基本一致', grey.pct > 50 && !/基本一致/.test(grey.text), grey.text)

    // 内容在能滚的 main 里：滚到底要滚 main
    fs.writeFileSync(path.join(impl, 'inner.html'), inner('#00e'))
    const innerB = await compareScreens(b, { design: { key: 'inner.html', url: `${entry.origin}/inner.html`, label: 'inner' }, impl: pathToFileURL(path.join(impl, 'inner.html')).href, size: [800, 600], at: 'bottom' })
    check('比对：滚到底连里面能滚的 main 一起滚（底下红 vs 蓝看得出来）', innerB.pct > 20, innerB.text)

    // 深色写在 [data-theme="dark"] 上：两边都切过去
    fs.writeFileSync(path.join(impl, 'theme.html'), themed)
    const dk = await compareScreens(b, { design: { key: 'theme.html', url: `${entry.origin}/theme.html`, label: 'theme' }, impl: pathToFileURL(path.join(impl, 'theme.html')).href, size: [800, 600], dark: true })
    check('比对：data-theme 的深色两边都切了，同一份文件差异 < 1%', dk.pct < 1, dk.text)
    for (const [f, html] of Object.entries(darkCases)) {
      fs.writeFileSync(path.join(impl, f), html)
      const r = await compareScreens(b, { design: { key: f, url: `${entry.origin}/${f}`, label: f }, impl: pathToFileURL(path.join(impl, f)).href, size: [600, 400], dark: true })
      check(`比对：深色两边准备得一样（${f}：输入框、媒体查询、规则先后），同一份文件差异 < 1%`, r.pct < 1, r.text)
    }

    // 本机地址 302 跳到外网：拦下，不开
    const srv = http.createServer((req, res) => {
      if (req.url === '/js') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><p>Hi</p><script>location.href = "http://example.com/"</script>'); return }
      res.writeHead(302, { Location: 'http://example.com/' })
      res.end()
    })
    await new Promise((r) => srv.listen(0, '127.0.0.1', r))
    let err = ''
    try { await compareScreens(b, { design: design0, impl: `http://127.0.0.1:${srv.address().port}/go`, size: [800, 600] }) } catch (e) { err = e.message }
    check('比对：本机地址 302 跳到外网的被拦下', /不是允许的地址/.test(err) && /example\.com/.test(err), err)
    let js = null
    err = ''
    try { js = await compareScreens(b, { design: design0, impl: `http://127.0.0.1:${srv.address().port}/js`, size: [800, 600] }) } catch (e) { err = e.message }
    srv.close()
    check('比对：页面用脚本跳到外网也拦下，不拿出错页比', !js && /跳到了本机以外的地址，拦下了：https?:\/\/example\.com/.test(err), err || (js && js.text))
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
