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
import { detectProject, projectFor, defaultFramework, routeOf, pagePathOf, sharedParts, implUrl, handoffMd, buildHandoff, compareScreens, blockAt, FRAMEWORKS, defaultDest, pickedDest, within, localOnly } from '../lib/handoff.js'
import { createHub } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
// 用 native：Windows 的临时目录是 RUNNER~1 这种短名，projectFor 往上找时按真实路径（长名）走
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-handoff-')))

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
check('框架：六种都有名字，新建命令带项目名占位（原生小程序、纯 HTML 没有脚手架）', Object.keys(FRAMEWORKS).join() === 'react,vue,next,html,uniapp,weapp' && FRAMEWORKS.react.create.includes('{name}') && FRAMEWORKS.uniapp.create.includes('{name}') && !FRAMEWORKS.html.create && !FRAMEWORKS.weapp.create)

// ── 小程序项目（issue #4）：uni-app（命令行 / HBuilderX）、微信原生、Taro ──
{
  const mp = path.join(tmp, 'mini')
  const mk = (name, files) => {
    const d = path.join(mp, name)
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), typeof c === 'string' ? c : JSON.stringify(c)) }
    return d
  }
  const cli = mk('cli', { 'package.json': { name: 'wallet', dependencies: { '@dcloudio/uni-app': '3.0.0-4060620250520001', vue: '^3.4.21' }, devDependencies: { '@dcloudio/vite-plugin-uni': '3.0.0', typescript: '5' } }, 'src/pages.json': { pages: [{ path: 'pages/index/index' }] }, 'src/manifest.json': {}, 'index.html': '<div id="app"></div>' })
  const d1 = detectProject(cli)
  check('小程序：命令行建的 uni-app → uni-app（Vue 3），页面在 src/', d1.pkg && d1.framework === 'uniapp' && d1.label === 'uni-app（Vue 3）' && d1.pagesAt === 'src/' && d1.ts, JSON.stringify(d1))
  const cli2 = mk('cli2', { 'package.json': { dependencies: { '@dcloudio/uni-app': '^2.0.2', vue: '^2.6.11' } }, 'src/pages.json': '{ "pages": [] }' })
  check('小程序：Vue 2 的 uni-app 也认得出', detectProject(cli2).label === 'uni-app（Vue 2）')
  const hbx = mk('hbx', { 'manifest.json': '/* 应用配置 */\n{ "name": "钱包", "vueVersion": "3" }', 'pages.json': '{\n  // 页面\n  "pages": [{ "path": "pages/index/index" }]\n}', 'App.vue': '<script>export default {}</script>', 'pages/index/index.vue': '<template><view /></template>' })
  const d2 = detectProject(hbx)
  check('小程序：HBuilderX 建的 uni-app（没有 package.json，配置里有注释）→ 认得出，Vue 3', !d2.pkg && d2.framework === 'uniapp' && d2.hbx && d2.label === 'uni-app（HBuilderX，Vue 3）' && d2.pagesAt === '', JSON.stringify(d2))
  check('小程序：HBuilderX 没写 vueVersion → Vue 2', detectProject(mk('hbx2', { 'manifest.json': '{}', 'pages.json': '{"pages":[]}' })).label === 'uni-app（HBuilderX，Vue 2）')
  const hbx3 = mk('hbx3', { 'manifest.json': '{"vueVersion":"3"}', 'pages.json': '{"pages":[]}', 'package.json': { dependencies: { 'uview-plus': '3', dayjs: '1' } } })
  check('小程序：HBuilderX 项目装了 npm 包（有 package.json、没写 uni-app 依赖）→ 还是 HBuilderX 的 uni-app', detectProject(hbx3).framework === 'uniapp' && detectProject(hbx3).hbx && detectProject(hbx3).pkg)
  check('小程序：只有 manifest.json（网页的 PWA 清单）、或者 pages.json 没写 pages → 不算 uni-app', !detectProject(mk('pwa', { 'manifest.json': '{"name":"x"}', 'index.html': '<p>' })).framework && !detectProject(mk('half', { 'manifest.json': '{}', 'pages.json': '{}' })).framework)
  const wx = mk('wx', { 'project.config.json': { miniprogramRoot: 'miniprogram/', appid: 'wx123', compileType: 'miniprogram' }, 'miniprogram/app.json': { pages: ['pages/index/index'] } })
  const d3 = detectProject(wx)
  check('小程序：微信原生（project.config.json + miniprogram/app.json）→ 原生，页面在 miniprogram/', !d3.pkg && d3.framework === 'weapp' && d3.pagesAt === 'miniprogram/' && !d3.hbx, JSON.stringify(d3))
  check('小程序：原生小程序 app.json 在根目录、装了 Vant Weapp → 还是原生', detectProject(mk('wx2', { 'project.config.json': { appid: 'touristappid' }, 'app.json': { pages: [] }, 'package.json': { dependencies: { '@vant/weapp': '1' } } })).framework === 'weapp')
  check('小程序：miniprogramRoot 指到项目外面（../）不跟着走，按根目录找', detectProject(mk('wx3', { 'project.config.json': { miniprogramRoot: '../wx/miniprogram' }, 'app.json': {} })).pagesAt === '' && !detectProject(mk('wx4', { 'project.config.json': { miniprogramRoot: '../wx/miniprogram' } })).framework)
  check('小程序：只有 project.config.json、没有 app.json → 不算', !detectProject(mk('wx5', { 'project.config.json': {} })).framework)
  const taro = mk('taro', { 'package.json': { dependencies: { '@tarojs/taro': '4', react: '18' } }, 'project.config.json': { miniprogramRoot: 'dist/' }, 'dist/app.json': {} })
  check('小程序：Taro（编译过、dist 里有 app.json）→ Taro，不当原生', detectProject(taro).framework === 'taro' && detectProject(taro).label === 'Taro')
  const taroSr = mk('taro-sr', { 'package.json': { dependencies: { '@tarojs/taro': '4', react: '18' } }, 'config/index.ts': "const config = {\n  projectName: 'x',\n  designWidth: 750,\n  sourceRoot: 'client',\n  outputRoot: 'dist',\n}" })
  const taroBad = mk('taro-bad', { 'package.json': { dependencies: { '@tarojs/taro': '4' } }, 'config/index.js': "module.exports = { sourceRoot: '../outside' }" })
  check('小程序：Taro 的源码目录照 config/index 的 sourceRoot（没写是 src/，出了项目的不认）', detectProject(taro).pagesAt === 'src/' && detectProject(taroSr).pagesAt === 'client/' && detectProject(taroBad).pagesAt === 'src/', JSON.stringify([detectProject(taro).pagesAt, detectProject(taroSr).pagesAt, detectProject(taroBad).pagesAt]))
  check('默认框架：HBuilderX / 原生小程序 → 跟项目一样；小程序设计放空文件夹 → uni-app；别的设计照旧 React', defaultFramework(d2, 'miniprogram') === 'same' && defaultFramework(d3, 'web') === 'same' && defaultFramework(detectProject(path.join(mp, 'nope')), 'miniprogram') === 'uniapp' && defaultFramework(null, 'miniprogram') === 'uniapp' && defaultFramework(null, 'app') === 'react' && defaultFramework(null) === 'react')
  const des = path.join(mp, 'wallet-design')
  check('选的文件夹：HBuilderX 项目 / 它里面的 pages → 就放这里，算那个项目', pickedDest(hbx, des).dest === hbx && !pickedDest(hbx, des).why && pickedDest(path.join(hbx, 'pages'), des).dest === path.join(hbx, 'pages') && projectFor(path.join(hbx, 'pages', 'index')).dir === hbx && projectFor(path.join(wx, 'miniprogram')).dir === wx)
  check('放哪：会话目录是 HBuilderX 项目 → 放会话目录', defaultDest(des, hbx, detectProject(hbx)) === hbx)
  check('页面路径：index / home → pages/index/index，别的 pages/名字/名字；Taro 是 index', pagePathOf('home.html') === 'pages/index/index' && pagePathOf('My Cart.html') === 'pages/my-cart/my-cart' && pagePathOf('menu.html', 'taro') === 'pages/menu/index')
}
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
  // 会话目录有 package.json 就算项目（后端也一样）：放哪个子目录让写代码的模型看清结构定
  const be = path.join(tmp, 'be')
  fs.mkdirSync(path.join(be, 'designs', 'shop'), { recursive: true })
  fs.writeFileSync(path.join(be, 'package.json'), '{"dependencies":{"express":"4"}}')
  check('放哪：会话目录是后端项目 → 照样放会话目录（和选这个文件夹一样）', defaultDest(path.join(be, 'designs', 'shop'), be, detectProject(be)) === be && pickedDest(be, path.join(be, 'designs', 'shop')).dest === be)
  // 右侧栏「选文件夹」选了哪个
  const pk = path.join(tmp, 'picked')
  fs.mkdirSync(path.join(pk, 'empty'), { recursive: true })
  fs.writeFileSync(path.join(pk, 'empty', '.DS_Store'), '')
  fs.mkdirSync(path.join(pk, 'proj'))
  fs.writeFileSync(path.join(pk, 'proj', 'package.json'), '{"dependencies":{"vue":"3"}}')
  fs.writeFileSync(path.join(pk, 'notes.md'), 'x')
  const pd = (dir) => { const r = pickedDest(dir, des); return `${r.dest}|${r.why}` }
  check('选的文件夹：是个项目 → 就放进去', pd(path.join(pk, 'proj')) === `${path.join(pk, 'proj')}|`)
  check('选的文件夹：空的（只有 .DS_Store）→ 就放进去', pd(path.join(pk, 'empty')) === `${path.join(pk, 'empty')}|`)
  check('选的文件夹：还不存在 → 就用它', pd(path.join(pk, 'new')) === `${path.join(pk, 'new')}|`)
  check('选的文件夹：有别的东西（比如 ~/Projects）→ 在里面新建 <名字>-app', pd(pk) === `${path.join(pk, 'shop-design-app')}|nested`)
  // 有 package.json 或 index.html 的都算项目，就放进去：后端、monorepo 根目录也一样（不猜是不是前端，交接说明让模型看清结构）
  fs.mkdirSync(path.join(pk, 'api'))
  fs.writeFileSync(path.join(pk, 'api', 'package.json'), '{"dependencies":{"express":"4"}}')
  fs.mkdirSync(path.join(pk, 'mono'))
  fs.writeFileSync(path.join(pk, 'mono', 'package.json'), '{"private":true,"workspaces":["packages/*"]}')
  fs.mkdirSync(path.join(pk, 'static'))
  fs.writeFileSync(path.join(pk, 'static', 'index.html'), '<h1>x</h1>')
  fs.mkdirSync(path.join(pk, 'readme'))
  fs.writeFileSync(path.join(pk, 'readme', 'README.md'), '# x')
  check('选的文件夹：后端、monorepo 根目录（有 package.json）→ 就放进去', pd(path.join(pk, 'api')) === `${path.join(pk, 'api')}|` && pd(path.join(pk, 'mono')) === `${path.join(pk, 'mono')}|`)
  check('选的文件夹：没有 package.json 的纯 HTML 站点（有 index.html）→ 就放进去', pd(path.join(pk, 'static')) === `${path.join(pk, 'static')}|` && detectProject(path.join(pk, 'static')).site && !detectProject(path.join(pk, 'static')).pkg)
  check('选的文件夹：只有 README 的文件夹（不是项目）→ 在里面新建', pd(path.join(pk, 'readme')) === `${path.join(pk, 'readme', 'shop-design-app')}|nested`)
  fs.mkdirSync(path.join(pk, 'repo', '.git'), { recursive: true })
  fs.writeFileSync(path.join(pk, 'repo', 'README.md'), '# x')
  check('选的文件夹：刚建的仓库（有 .git，只有 README）→ 就放进去', pd(path.join(pk, 'repo')) === `${path.join(pk, 'repo')}|`)
  // 选了项目里面的子目录（src/pages）→ 就放这里，算那个项目的（不在里面另起一个新项目）
  fs.mkdirSync(path.join(pk, 'proj', 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(pk, 'proj', 'src', 'main.js'), '')
  fs.writeFileSync(path.join(pk, 'proj', 'src', 'pages', 'Home.vue'), '')
  const sub = path.join(pk, 'proj', 'src')
  check('选的文件夹：现有项目里的子目录（src）→ 就放这里，框架跟那个项目', pd(sub) === `${sub}|` && projectFor(sub).dir === path.join(pk, 'proj') && defaultFramework(projectFor(sub)) === 'same' && defaultFramework(projectFor(path.join(sub, 'pages'))) === 'same')
  if (process.platform !== 'win32') {
    fs.symlinkSync(sub, path.join(tmp, 'src-link'))
    check('选的文件夹：软链接到项目里的子目录 → 按真实位置认出那个项目', pd(path.join(tmp, 'src-link')) === `${path.join(tmp, 'src-link')}|` && projectFor(path.join(tmp, 'src-link')).dir === path.join(pk, 'proj'))
  }
  check('项目：自己就是项目的不往上找；哪个项目都不在里面的、还不存在的（要新建）→ 就是它自己', projectFor(path.join(pk, 'proj')).dir === path.join(pk, 'proj') && !projectFor(path.join(pk, 'readme')).pkg && !projectFor(path.join(pk, 'proj', 'src', 'new-app')).pkg)
  fs.mkdirSync(path.join(pk, 'shop-design-app'))
  fs.writeFileSync(path.join(pk, 'shop-design-app', 'home.html'), 'x')
  check('选的文件夹：本来就叫 <名字>-app（上回转成纯 HTML 放过，没有 index.html）→ 就放这里，不再套一层', pd(path.join(pk, 'shop-design-app')) === `${path.join(pk, 'shop-design-app')}|`)
  check('选的文件夹：选了设计目录本身 → 改放设计目录旁边（说是 beside）', pd(des) === `${path.join(ws, 'shop-design-app')}|beside`)
  fs.mkdirSync(path.join(des, 'sub'))
  check('选的文件夹：选了设计目录里的空文件夹 → 也改放旁边', pd(path.join(des, 'sub')) === `${path.join(ws, 'shop-design-app')}|beside`)
  // 像不像 monorepo 根目录（只用来在交接说明里提醒放进子包）：workspaces / lerna / pnpm-workspace 列了别的包；只列 '.' 的、pnpm-workspace 只写设置的不算
  const mk = (name, files) => { const d = path.join(pk, name); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c) } return d }
  let mi = 0
  const isMono = (files) => detectProject(mk(`mono-${++mi}`, files)).mono
  check('monorepo 根目录：workspaces 数组 / {packages} / lerna.json / pnpm-workspace 两种写法都认得', isMono({ 'package.json': '{"workspaces":["apps/*"]}' }) && isMono({ 'package.json': '{"workspaces":{"packages":["apps/*"]}}' }) && isMono({ 'package.json': '{}', 'lerna.json': '{}' }) && isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n' }) && isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': "packages: ['apps/*', \"packages/*\"]\n" }))
  check('monorepo 根目录：只列了自己（\'.\'）、pnpm-workspace 只写设置、没有 workspaces → 不算', !isMono({ 'package.json': '{"workspaces":["."]}' }) && !isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': "packages:\n  - '.'\nonlyBuiltDependencies:\n  - esbuild\n" }) && !isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - esbuild\n' }) && !isMono({ 'package.json': '{"dependencies":{"react":"19"}}' }))
  const preact = mk('preact', { 'package.json': '{"dependencies":{"preact":"10"}}', 'src/index.js': '' })
  check('框架：Preact / Ember / React Native 也认得出', detectProject(preact).label === 'Preact' && detectProject(mk('ember', { 'package.json': '{"devDependencies":{"ember-source":"5"}}' })).label === 'Ember' && detectProject(mk('rn', { 'package.json': '{"dependencies":{"react":"19","react-native":"0.80"}}' })).label === 'React Native')
  check('monorepo 根目录：Windows 换行（CRLF）、带 BOM 的 pnpm-workspace.yaml 也认得', isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': 'packages:\r\n  - "apps/*"\r\n' }) && isMono({ 'package.json': '{}', 'pnpm-workspace.yaml': '\uFEFFpackages:\n  - apps/*\n' }))
  check('monorepo 根目录：Nx 集成式（nx.json，根上没有 project.json）算；Nx 单项目（有 project.json）不算', isMono({ 'package.json': '{"devDependencies":{"nx":"20"}}', 'nx.json': '{}' }) && !isMono({ 'package.json': '{"devDependencies":{"nx":"20"}}', 'nx.json': '{}', 'project.json': '{}' }))
  const odd = (c) => { const d = mk(`odd-${++mi}`, { 'package.json': c }); try { return detectProject(d).pkg } catch (e) { return 'throw ' + e.message } }
  check('package.json 是 null / 数组 / 写坏了 / 带 BOM：不抛错，能读的照读', odd('null') === false && odd('[1]') === false && odd('{oops') === false && odd('\uFEFF{"dependencies":{"vue":"3"}}') === true)
  check('默认框架：认得出的项目跟它一样、纯 HTML 站点纯 HTML、别的 React', defaultFramework(detectProject(preact)) === 'same' && defaultFramework(detectProject(path.join(pk, 'static'))) === 'html' && defaultFramework(detectProject(path.join(pk, 'api'))) === 'react' && defaultFramework(detectProject(path.join(pk, 'nope'))) === 'react' && defaultFramework(null) === 'react')
  const ng = mk('ng', { 'package.json': '{"dependencies":{"@angular/core":"20"}}', 'src/index.html': '<app-root></app-root>', 'src/main.ts': '' })
  const lib = mk('lib', { 'package.json': '{"name":"lib"}', 'docs/index.html': '<h1>docs</h1>' })
  check('选的文件夹：Angular / webpack 项目里带 index.html 的 src → 算那个项目（框架跟它）；认不出框架的库仓库里的 docs/ 站点 → 还是纯 HTML', pd(path.join(ng, 'src')) === `${path.join(ng, 'src')}|` && projectFor(path.join(ng, 'src')).dir === ng && defaultFramework(projectFor(path.join(ng, 'src'))) === 'same' && projectFor(path.join(lib, 'docs')).site && !projectFor(path.join(lib, 'docs')).pkg && defaultFramework(projectFor(path.join(lib, 'docs'))) === 'html', JSON.stringify([pd(path.join(ng, 'src')), defaultFramework(projectFor(path.join(ng, 'src'))), defaultFramework(projectFor(path.join(lib, 'docs')))]))
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
  check('交接说明：网页设计没有小程序要点', !md.includes('小程序要点'))
  const bareMd = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'react', dest: '/x/api', project: { dir: '/x/api', pkg: true, name: 'api', framework: '', label: '', tailwind: false, ts: false, pm: 'npm' }, system: '', htmlByKey })
  check('交接说明：现有项目没认出前端框架（后端 / monorepo 根目录）→ 让模型先看清结构再定放哪，不在原地新建项目', /没认出前端框架/.test(bareMd) && /先看清它的结构/.test(bareMd) && !/新建项目/.test(bareMd) && !/create vite@latest api/.test(bareMd) && /npm create vite@latest web/.test(bareMd), bareMd.split('\n').find((l) => l.startsWith('1. 搭骨架')))
  // 后端仓库里用选文件夹窗口新建了个空文件夹再选它 → 就在这里新建前端项目（不说「已经有东西」，不再套一层 web）
  const be = path.join(tmp, 'be')
  fs.mkdirSync(path.join(be, 'frontend'), { recursive: true })
  fs.writeFileSync(path.join(be, 'package.json'), '{"dependencies":{"express":"5"}}')
  const freshMd = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'react', dest: path.join(be, 'frontend'), project: projectFor(path.join(be, 'frontend')), system: '', htmlByKey })
  const freshStep = freshMd.split('\n').find((l) => l.startsWith('1. 搭骨架')) || ''
  check('交接说明：认不出前端框架的项目里选了个空的新文件夹 → 就在这里新建前端项目（在上一层跑脚手架）', /新建项目 `npm create vite@latest frontend/.test(freshStep) && freshStep.includes(`在 \`${be}\` 里跑`) && !/先看清它的结构/.test(freshMd), freshStep)
  // monorepo 里新建的空子包：根上装了 React（依赖提到根上）也照样在这里新建；pnpm 的仓库用 pnpm 装
  const monoNew = (name, files, framework) => {
    const r = path.join(tmp, name)
    fs.mkdirSync(path.join(r, 'apps', 'admin'), { recursive: true })
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(r, f), c)
    const d = path.join(r, 'apps', 'admin')
    const md = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework, dest: d, project: projectFor(d), system: '', htmlByKey })
    return { r, step: md.split('\n').find((l) => l.startsWith('1. 搭骨架')) || '' }
  }
  const mr = monoNew('mono-react', { 'package.json': '{"workspaces":["apps/*"],"devDependencies":{"react":"19"}}' }, 'same')
  check('交接说明：monorepo 根上装了 React，选空的 apps/admin、跟项目一样 → 在 apps 里新建 React 子包，不再让模型去找别的应用', /新建项目 `npm create vite@latest admin -- --template react-ts`/.test(mr.step) && mr.step.includes(`在 \`${path.join(mr.r, 'apps')}\` 里跑`) && !/先看根目录/.test(mr.step), mr.step)
  const mpn = monoNew('mono-pnpm', { 'package.json': '{"devDependencies":{"turbo":"2"}}', 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n', 'pnpm-lock.yaml': '' }, 'next')
  check('交接说明：pnpm 的 monorepo 里新建子包 → 脚手架和装依赖都用 pnpm', /--use-pnpm/.test(mpn.step) && !/--use-npm/.test(mpn.step) && /用 pnpm 装好依赖/.test(mpn.step), mpn.step)
  const ms = monoNew('mono-svelte', { 'package.json': '{"workspaces":["apps/*"],"devDependencies":{"svelte":"5"}}' }, 'same')
  const mx = monoNew('mono-nuxt', { 'package.json': '{"workspaces":["apps/*"],"devDependencies":{"nuxt":"4","vue":"3"}}' }, 'same')
  check('交接说明：monorepo 根上是没有现成脚手架命令的框架（Svelte、Nuxt）→ 让模型在这个空文件夹里照别的子包新建，不套 Vue + Vite 的命令', /在这个空文件夹里新建一个 Svelte 子项目/.test(ms.step) && /在这个空文件夹里新建一个 Nuxt 子项目/.test(mx.step) && !/create vite|vue-router/.test(mx.step), mx.step)
  // 已经有东西、又没有 package.json 的目录（Python 后端、别的语言的仓库）：也别在原地 / 旁边跑脚手架
  const pyMd = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'react', dest: '/x/svc', project: { dir: '/x/svc', pkg: false, site: false, empty: false, name: 'svc', framework: '' }, system: '', htmlByKey })
  check('交接说明：有东西但不是 Node 项目（Python 仓库）→ 不在原地新建，前端放进里面新的子目录', /不是 Node 项目/.test(pyMd) && /先看清它的结构/.test(pyMd) && !/新建项目：/.test(pyMd) && !/create vite@latest svc/.test(pyMd), pyMd.split('\n').filter((l) => /做到|搭骨架/.test(l)).join('\n'))
  const siteMd = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'html', dest: '/x/site', project: { dir: '/x/site', pkg: false, site: true, empty: false, name: 'site', framework: '' }, system: '', htmlByKey })
  check('交接说明：转成纯 HTML 放进已有的站点 → 提醒别覆盖现有页面，就加在这个站点里（不另建子目录）', /别覆盖现有的页面/.test(siteMd) && !/新的子目录/.test(siteMd), siteMd.split('\n').filter((l) => /做到|搭骨架/.test(l)).join('\n'))
  const siteReact = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'react', dest: '/x/site', project: { dir: '/x/site', pkg: false, site: true, empty: false, name: 'site', framework: '' }, system: '', htmlByKey })
  check('交接说明：已有纯 HTML 站点改用 React → 前端放进里面新的子目录，不在原地跑脚手架', /新的子目录/.test(siteReact) && !/新建项目 `/.test(siteReact))
  const monoMd = handoffMd({ root: design, rows, kind: 'web', size: [1280, 800], framework: 'same', dest: '/x/mono', project: { dir: '/x/mono', pkg: true, mono: true, name: 'mono', framework: 'react', label: 'React', tailwind: false, ts: false, pm: 'pnpm' }, system: '', htmlByKey })
  check('交接说明：像 monorepo 根目录 → 先找现成的前端应用（根目录或 apps/），没有再新建子包', /monorepo 根目录：先看根目录和 apps\//.test(monoMd) && !/没认出前端框架/.test(monoMd))
  check('交接说明：普通前端项目不多这两句', !/monorepo|没认出前端框架/.test(same))
  const mp = handoffMd({ root: design, rows, kind: 'miniprogram', size: [375, 812], framework: 'react', dest, project: null, system: '', htmlByKey })
  const mpWx = handoffMd({ root: design, rows, kind: 'miniprogram', size: [375, 812], framework: 'weapp', dest, project: null, system: '', htmlByKey })
  check('交接说明：小程序设计做成小程序 → 讲清 rpx 换算、状态栏和胶囊不用做、tabBar 写进 app.json', mpWx.includes('## 小程序要点') && mpWx.includes('1px = 2rpx') && mpWx.includes('wx.getMenuButtonBoundingClientRect()') && mpWx.includes('写进 `app.json` 的 `tabBar`'), mpWx)
  const dk = handoffMd({ root: design, rows, kind: 'desktop', size: [1280, 800], framework: 'react', dest, project: null, system: '', htmlByKey })
  check('交接说明：桌面软件讲清 Electron / Tauri、窗口按钮系统画、拖动区；网页和小程序没有这段', dk.includes('## 桌面软件要点') && dk.includes('hiddenInset') && dk.includes('-webkit-app-region: drag') && dk.includes('138×32') && !md.includes('桌面软件要点') && !mp.includes('桌面软件要点'))
  // 小程序的写法（issue #4）
  const mini = (framework, project, d = dest) => handoffMd({ root: design, rows, kind: 'miniprogram', size: [375, 812], framework, dest: d, project, system: '', htmlByKey })
  check('交接说明：小程序设计选了 React（网页）→ 做成手机网页（px、不用 wx.*、不写小程序配置），要真小程序就换 uniapp / weapp 重出', mp.includes('## 小程序设计做成网页（H5）') && mp.includes('framework: uniapp') && !mp.includes('## 做成 uni-app') && !mp.includes('## 小程序要点') && !/换成 rpx|getMenuButton|app\.config|app\.json/.test(mp), mp)
  const hb = { dir: '/x/wallet', pkg: false, name: 'wallet', framework: 'uniapp', label: 'uni-app（HBuilderX，Vue 3）', hbx: true, pagesAt: '', empty: false }
  const uHb = mini('same', hb, '/x/wallet')
  check('交接说明：跟 HBuilderX 项目一样 → 加页面登记进 pages.json、uni.* 的 API（胶囊位置分平台写）、page 上的变量、HBuilderX 里运行；不跑脚手架、不写包管理、不问 dev:h5', uHb.includes('## 做成 uni-app') && uHb.includes('#ifdef MP-WEIXIN') && !uHb.includes('没配网页版') && uHb.includes('| 首页 | home.html | `pages/index/index` |') && uHb.includes('| 菜单 | menu.html | `pages/menu/menu` |') && uHb.includes('登记进 `pages.json`') && uHb.includes('uni.getMenuButtonBoundingClientRect()') && uHb.includes('`page { --color-primary') && uHb.includes('运行 → 运行到浏览器') && uHb.includes('没有 package.json') && !uHb.includes('degit') && !uHb.includes('包管理') && !uHb.includes('不是 Node 项目') && !/没认出前端框架/.test(uHb) && uHb.includes('## 屏幕和页面'), uHb)
  const uNew = mini('uniapp', detectProject(path.join(tmp, 'nope-uni')), path.join(tmp, 'wallet-app'))
  check('交接说明：新建 uni-app → degit 模板（附 gitee 地址）、页面在 src/pages、网页版 npm run dev:h5 拿来比、mp-weixin 出小程序', uNew.includes('npx degit dcloudio/uni-preset-vue#vite-ts wallet-app') && uNew.includes('gitee.com/dcloud/uni-preset-vue') && uNew.includes('`src/pages.json`') && uNew.includes('`src/pages/<名字>/<名字>.vue`') && uNew.includes('npm run dev:h5') && uNew.includes('#/pages/index/index') && uNew.includes('dist/dev/mp-weixin') && uNew.includes('rpx') && uNew.includes('2MB'), uNew)
  const cliP = { dir: '/x/w', pkg: true, name: 'w', framework: 'uniapp', label: 'uni-app（Vue 3）', pagesAt: 'src/', ts: true, pm: 'pnpm', empty: false }
  const uCli = mini('same', cliP, '/x/w')
  check('交接说明：跟命令行 uni-app 项目一样 → 页面放 src/pages、登记 src/pages.json，包管理照项目，不新建；没配网页版先问', uCli.includes('放进 `src/pages/`，登记进 `src/pages.json`') && uCli.includes('包管理 pnpm') && !uCli.includes('degit') && uCli.includes('`src/static/`') && uCli.includes('没配网页版'), uCli)
  const uReact = mini('uniapp', { dir: '/x/web', pkg: true, name: 'web', framework: 'react', label: 'React + Vite', pm: 'npm', empty: false }, '/x/web')
  check('交接说明：手选 uni-app、目标却是 React 网页项目 → 在里面另建 uni-app 子项目，不往 React 项目里登记 pages.json', uReact.includes('是 React + Vite 项目，不是') && uReact.includes('npx degit dcloudio/uni-preset-vue#vite-ts uni-app') && !uReact.includes('在现有项目里加页面') && uReact.includes('相对那个子项目'), uReact)
  const wNew = mini('weapp', null, path.join(tmp, 'wallet-wx'))
  check('交接说明：新建原生小程序 → 手搭骨架（touristappid）、WXML / wx:for / setData、WXSS 别用 * 和 :hover、compare_design 比不了让用户在开发者工具看', wNew.includes('## 做成原生小程序') && wNew.includes('touristappid') && wNew.includes('wx:for') && wNew.includes('hover-class') && wNew.includes('`compare_design` 比不了') && wNew.includes('微信开发者工具') && !wNew.includes('npx') && !wNew.includes('npm run'), wNew)
  const wHas = mini('same', { dir: '/x/wx', pkg: false, name: 'wx', framework: 'weapp', label: '微信原生小程序', pagesAt: 'miniprogram/', empty: false }, '/x/wx')
  check('交接说明：跟原生小程序项目一样 → 页面放 miniprogram/pages、登记 miniprogram/app.json，不搭骨架', wHas.includes('`miniprogram/pages/<名字>/`') && wHas.includes('登记进 `miniprogram/app.json`') && !wHas.includes('touristappid'), wHas)
  const wBe = mini('uniapp', { dir: '/x/api', pkg: true, name: 'api', framework: '', label: '', pm: 'npm', empty: false }, '/x/api')
  check('交接说明：后端项目里做小程序前端（issue #4 的情况）→ 先看清结构，另建子目录用 uni-app 搭', /没认出前端框架/.test(wBe) && wBe.includes('npx degit dcloudio/uni-preset-vue#vite-ts web') && wBe.includes('## 做成 uni-app'), wBe)
  const tr = mini('same', { dir: '/x/t', pkg: true, name: 't', framework: 'taro', label: 'Taro', pm: 'npm', empty: false }, '/x/t')
  check('交接说明：跟 Taro 项目一样 → View / Text、别改 designWidth、Taro.* 的 API（分平台）、page 和 .taro_page 上的变量、页面在 src/pages、页面路径 pages/名字/index', tr.includes('## 做成 Taro') && tr.includes('别改项目的 designWidth') && !tr.includes('改成 375') && tr.includes('Taro.getMenuButtonBoundingClientRect()') && tr.includes("TARO_ENV === 'weapp'") && tr.includes('page, .taro_page') && tr.includes('放进 `src/pages/`，登记进 `src/app.config`') && tr.includes('`pages/menu/index`') && tr.includes('npm run dev:h5') && tr.includes('没配网页版'), tr)
  const trSr = mini('same', { dir: '/x/t', pkg: true, name: 't', framework: 'taro', label: 'Taro', pm: 'npm', empty: false, pagesAt: 'client/' }, '/x/t')
  check('交接说明：Taro 改过 sourceRoot → 页面、app.config、全局样式、资源都照它的目录，不写 src/', trSr.includes('放进 `client/pages/`，登记进 `client/app.config`') && trSr.includes('源码目录是 `client/`') && trSr.includes('`client/app` 的全局样式') && trSr.includes('`client/app.config` 的 `tabBar`') && !/`src\/(pages|app)/.test(trSr), trSr)
  const mpHtml = new Map([['menu.html', '<header class="mp-top"><div class="mp-status">9:41</div><div class="mp-nav"><h1>点单</h1></div></header><main class="mp-page"><div class="card">面</div></main><nav class="mp-tabbar"><a>点单</a></nav>'], ['cart.html', '<header class="mp-top"><div class="mp-status">9:41</div><div class="mp-nav"><h1>购物车</h1></div></header><main class="mp-page"><div class="card">面</div></main><nav class="mp-tabbar"><a>点单</a></nav>']])
  const sk = (framework) => handoffMd({ root: design, rows, kind: 'miniprogram', size: [375, 812], framework, dest: path.join(tmp, 'sk'), project: null, system: '', htmlByKey: mpHtml })
  const skU = sk('uniapp')
  const skR = sk('react')
  check('交接说明：小程序骨架（状态栏 / 导航栏 / 标签栏）照微信的做法，不做成组件；别的共用部分照旧', skU.includes('`.mp-status`：预览手机的状态栏，不做') && skU.includes('`.mp-tabbar`：底部标签栏：写进 `src/pages.json` 的 `tabBar`') && skU.includes('`.mp-nav`：导航栏：纯色底就用默认导航栏') && !skU.includes('MpStatus') && skU.includes('→ `Card` 组件') && skR.includes('`.mp-status`：预览手机的状态栏，网页里不做') && skR.includes('`.mp-tabbar`：→ 固定在底部的导航组件'), skU)
  check('交接说明：网页设计不多小程序那几节', !md.includes('小程序') && !same.includes('## 做成'))
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
