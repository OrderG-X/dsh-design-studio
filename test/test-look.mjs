/**
 * check_design / look_design 的无头浏览器那条路（不用开 DSH）：
 *   node test/test-look.mjs
 *
 * 尺寸、类型、挑屏、给模型的字（look.js）；找浏览器、CDP 管道收发（browser.js，用假的浏览器进程）；
 * 两个工具走无头浏览器、没有浏览器时的说法、截图存进附件库；
 * 本机装着 Chrome / Edge 时再真开一回：底栏压住最后一行、脚本报错、缺样式表、固定栏离内容多远、真截图、元素裁剪、深色
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { parseMeta, sizeOf, designOf, metaOfFile, pickScreens, scaleFor, formatMeasure, issueSnapshot, formatShots, detailOf, measureAll, shootAll } from '../lib/look.js'
import { findBrowser, frameReader, createBrowser } from '../lib/browser.js'
import { checkTool, lookTool, studio } from '../lib/index.js'
import { createHub } from '../lib/serve.js'
import { findRule } from '../lib/core.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-look-')))

// ── look.js ──
check('meta：app 375x812', JSON.stringify(parseMeta('app 375x812')) === '{"kind":"app","size":"375x812"}')
check('meta：phone 是 app 的别名', parseMeta('phone').kind === 'app')
check('尺寸：只写宽度，App 按真机高', JSON.stringify(sizeOf('375', 'app')) === '[375,667]' && JSON.stringify(sizeOf(430, 'app')) === '[430,932]')
check('尺寸：WxH 原样', JSON.stringify(sizeOf('430x932', 'app')) === '[430,932]' && JSON.stringify(sizeOf('1080×1920', 'poster')) === '[1080,1920]')
check('尺寸：不常见的宽度按这一类的宽高比；网页高用默认', JSON.stringify(sizeOf('500', 'app')) === '[500,1082]' && JSON.stringify(sizeOf('1440px', 'web')) === '[1440,800]')
check('尺寸：认不出 / 太小太大给 null', sizeOf('abc', 'app') === null && sizeOf('50', 'app') === null && sizeOf('9000x100', 'web') === null && sizeOf('', 'web') === null)
check('类型尺寸：preview_page 给了 app → 390×844', JSON.stringify(designOf({ kind: 'app' }, () => '')) === '{"kind":"app","size":[390,844]}')
check('类型尺寸：没给就看页面里的 meta', JSON.stringify(designOf({}, () => 'poster 1080x1920')) === '{"kind":"poster","size":[1080,1920]}')
check('类型尺寸：都没有就是网页', JSON.stringify(designOf({}, () => '')) === '{"kind":"web","size":[1280,800]}')
fs.writeFileSync(path.join(tmp, 'm.html'), '<!doctype html><head><meta charset="utf-8"><meta content="app 375x812" name="dsh-design"></head>')
check('读文件开头的 dsh-design meta', metaOfFile(path.join(tmp, 'm.html')) === 'app 375x812' && metaOfFile(path.join(tmp, 'nope.html')) === '')
const snap = { url: 'http://127.0.0.1:9/home.html', focus: 'home.html', target: { kind: 'file', file: path.join(tmp, 'home.html') }, screens: ['home.html', 'detail.html', 'cart.html'].map((key) => ({ key, url: `http://127.0.0.1:9/${key}`, label: key.replace('.html', '') })) }
check('挑屏：不给就全部', pickScreens(snap, [], 12).list.length === 3)
{
  const p = pickScreens(snap, ['cart', 'home.html', './cart.html', 'nope'], 12)
  check('挑屏：文件名、去掉 .html、./ 都认，重复的只算一次，没有的记下来', p.list.map((x) => x.key).join() === 'cart.html,home.html' && p.missing.join() === 'nope', JSON.stringify(p))
}
check('挑屏：超过上限的数出来', pickScreens(snap, [], 2).more === 1)
check('挑屏：单页预览（没有 screens）就是那一页', pickScreens({ url: 'http://x/a', focus: '/a', screens: [] }, [], 12).list[0].url === 'http://x/a')
check('截图缩放：手机放大到长边约 1568，网页 1.23 倍，大图不缩', scaleFor(390, 844) === 1.86 && scaleFor(1280, 800) === 1.23 && scaleFor(3000, 3000) === 1)
check('问题细节：底栏压住', /滚到底还被底栏 nav 压住 52px/.test(detailOf({ type: 'covered', edge: 'bottom', bar: 'nav', px: 52 })))
check('问题细节：脚本报错带文件和行号', detailOf({ type: 'jserr', msg: 'x is not defined', src: 'app.js', line: 3 }) === 'x is not defined（app.js:3）')
check('问题细节：缺样式表', /样式表 a\.css 载不出来/.test(detailOf({ type: 'missing', what: 'css', src: 'a.css' })))
{
  const m = (page, bars = []) => ({ w: 390, h: 844, page, bars, areas: 0 })
  const tap = { type: 'tap', sel: 'nav > a', text: '首页', w: 30, h: 20, min: 44 }
  const rows = [
    { key: 'home.html', label: 'home', title: '首页', w: 390, h: 844, issues: [tap], metrics: m(844, [{ edge: 'bottom', name: 'nav', h: 84, gap: 48 }]) },
    { key: 'home.html', label: 'home', w: 375, h: 667, issues: [tap, { type: 'covered', sel: 'li:last-child', text: '最后一本', edge: 'bottom', bar: 'nav', px: 52 }], metrics: { ...m(744, [{ edge: 'bottom', name: 'nav', h: 84, gap: -52 }]), w: 375, h: 667 } },
    { key: 'cart.html', label: 'cart', w: 390, h: 844, issues: [], metrics: m(1200) },
    { key: 'cart.html', label: 'cart', w: 375, h: 667, issues: [], error: 'timeout', metrics: null },
  ]
  const text = formatMeasure(rows, { sizes: [[390, 844], [375, 667]], where: '/d', missing: ['nope'], more: 1 })
  check('体检文字：几屏 × 几种尺寸、设计目录、问题数（同一个问题两种尺寸都有只算一个）', text.startsWith('用无头浏览器按真实尺寸量了 2 屏 × 2 种尺寸（390×844、375×667），设计目录 /d。发现 2 个问题'), text)
  check('体检文字：每屏标题、每种尺寸页面多高、底栏离内容多远 / 压住多少', text.includes('home.html「首页」') && text.includes('390×844：页面高 844（一屏放得下）；底栏 nav 高 84，滚到底时离内容 48px') && text.includes('375×667：页面高 744（比屏幕高，要滚动，正常）；底栏 nav 高 84，压住内容 52px'), text)
  check('体检文字：两种尺寸都有的不标尺寸，只有一种有的标上', /1\. 点击区太小：nav > a「首页」 — 30×20/.test(text) && /2\. \[375×667\] 被固定栏压住：li:last-child「最后一本」/.test(text), text)
  check('体检文字：没量成的照实说', text.includes('375×667：没量成（timeout）'), text)
  check('体检文字：没找到的屏、没量的屏都说', text.includes('没找到这几屏：nope') && text.includes('还有 1 屏这次没量'), text)
  const ok = formatMeasure([{ key: 'a.html', w: 390, h: 844, issues: [], metrics: m(844) }], { sizes: [[390, 844]] })
  check('体检文字：没问题也列出量了什么', ok.includes('没发现问题') && ok.includes('390×844：页面高 844'), ok)
  check('体检文字：有问题又有没量成的，说检查不完整', text.includes('另有 1 次没量成，见下，检查不完整'), text)
  const half = formatMeasure([{ key: 'a.html', w: 390, h: 844, issues: [], metrics: m(844) }, { key: 'b.html', w: 390, h: 844, issues: [], error: 'timeout' }], { sizes: [[390, 844]] })
  check('体检文字：量成的没问题、但有没量成的，不说「没发现问题」', !half.includes('没发现问题') && half.includes('有 1 次没量成（见下），这次检查不完整'), half)
  const none = formatMeasure([{ key: 'a.html', w: 390, h: 844, issues: [], error: 'timeout' }], { sizes: [[390, 844]] })
  check('体检文字：一次都没量成，说检查没完成', none.includes('一次都没量成，这次检查没完成'), none)
  // 复查：和上次比修好了几个、新出了几个，新的标出来
  const prev = issueSnapshot(rows)
  const again = formatMeasure([
    { key: 'home.html', w: 390, h: 844, issues: [], metrics: m(844) },
    { key: 'home.html', w: 375, h: 667, issues: [{ type: 'tight', sel: 'li:last-child', text: '最后一本', edge: 'bottom', bar: 'nav', px: 4 }], metrics: m(744) },
  ], { sizes: [[390, 844], [375, 667]], prev })
  check('复查：比上次修好 3 个（两种尺寸的点击区 + 压住），新出 1 个，新的标「新」', again.includes('比上次（同样的屏和尺寸）：修好 3 个，新出 1 个') && /\[新\] \[375×667\] 离固定栏太近/.test(again), again)
  check('复查：第一次量没有「比上次」', !text.includes('比上次'), text)
}
{
  const t = formatShots([
    { key: 'home.html', title: '首页', w: 390, h: 844, at: 'top', page: 1600, jpg: Buffer.from('x') },
    { key: 'cart.html', w: 390, h: 844, at: 'top', error: '超时' },
    { key: 'cart.html', w: 390, h: 844, at: 'full', part: 2, of: 3, page: 2000, jpg: Buffer.from('x') },
  ], { where: '/d', more: 2 })
  check('截图说明：长页面只截了几段时说清中间跳过了几段', t.includes('cart.html 一共 3 段，中间 2 段没截'), t)
  check('截图说明：图号只数截成的，写清哪屏、多大、哪一段', t.includes('- 图 1：home.html「首页」 390×844 顶上一屏，页面高 1600') && t.includes('- cart.html 390×844 顶上一屏：没截成（超时）') && t.includes('- 图 2：cart.html 390×844 第 2/3 屏') && t.includes('还有 2 屏没截'), t)
}

// ── browser.js ──
{
  const has = (set) => (p) => set.includes(p)
  check('找浏览器：DSH_DESIGN_BROWSER 优先', findBrowser({ env: { DSH_DESIGN_BROWSER: '/x/chrome' }, platform: 'darwin', exists: has(['/x/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) }) === '/x/chrome')
  check('找浏览器：Mac 上的 Chrome', findBrowser({ env: {}, platform: 'darwin', exists: has(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) }) === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  check('找浏览器：Mac 没 Chrome 用 Edge', findBrowser({ env: {}, platform: 'darwin', exists: has(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']) }) === '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  check('找浏览器：Windows 自带的 Edge', findBrowser({ env: { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86' }, platform: 'win32', exists: has(['C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe']) }) === 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe')
  check('找浏览器：都没有给 null', findBrowser({ env: {}, platform: 'linux', exists: () => false }) === null)
}
{
  const got = []
  const feed = frameReader((m) => got.push(m))
  feed(Buffer.from('{"id":1,"res'))
  feed(Buffer.from('ult":{}}\0{"method":"X"}\0bad json\0{"id":2'))
  feed(Buffer.from('}\0'))
  check('CDP 管道：半条接着收、一块里好几条、坏的跳过', got.length === 3 && got[0].id === 1 && got[1].method === 'X' && got[2].id === 2, JSON.stringify(got))
}
{
  const b = createBrowser({ bin: null })
  let err = ''
  try { await b.withPage({ url: 'http://x', w: 100, h: 100 }, async () => {}) } catch (e) { err = e.message }
  check('没有浏览器：available() 是 false，开页面报 no-browser', b.available() === false && err === 'no-browser', err)
}

/** 假的浏览器进程：按 CDP 回话（navigate 后发 loadEventFired），记下收到的指令 */
function fakeLaunch(log, evalOf) {
  return (bin, args) => {
    const proc = new EventEmitter()
    const out = new PassThrough()
    let buf = ''
    const reply = (msg) => {
      const r = (x) => out.write(`${JSON.stringify({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), result: x })}\0`)
      switch (msg.method) {
        case 'Target.createTarget': return r({ targetId: 'T1' })
        case 'Target.attachToTarget': return r({ sessionId: 'S1' })
        case 'Page.navigate': r({ frameId: 'F' }); return setTimeout(() => out.write(`${JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'S1', params: {} })}\0`), 5)
        case 'Runtime.evaluate': return r({ result: { value: evalOf(msg.params.expression) } })
        case 'Page.captureScreenshot': return r({ data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') })
        default: return r({})
      }
    }
    proc.stdio = [null, null, null, new Writable({
      write(chunk, _enc, cb) {
        buf += chunk.toString()
        let i
        while ((i = buf.indexOf('\0')) >= 0) {
          const msg = JSON.parse(buf.slice(0, i))
          buf = buf.slice(i + 1)
          log.push(msg)
          reply(msg)
        }
        cb()
      },
    }), out]
    proc.args = args
    proc.pid = 1
    proc.kill = () => setTimeout(() => proc.emit('exit', 0), 1)
    log.args = args
    return proc
  }
}
const pageEval = (opts = {}) => (expr) => {
  if (expr.includes('window.__dshDesign ||')) return true
  if (expr.includes('.settle()')) return true
  if (expr.includes('.dark(')) return !!opts.dark
  if (expr.includes('.info()')) return { title: '首页', meta: '', page: 1200, w: 390, h: 844 }
  if (expr.includes('.check(')) return { issues: opts.issues || [], metrics: { w: 390, h: 844, page: 1200, bars: [{ edge: 'bottom', name: 'nav.tab', h: 83, gap: 12 }], areas: 0 } }
  if (expr.includes(".scroll('end')")) return { i: 0, of: 1 }
  if (expr.includes('.scroll(')) return { i: 0, of: pageEval.parts || 2, y: 0 }
  if (expr.includes('.rect(')) return opts.rect === undefined ? { x: 10, y: 700, w: 300, h: 80, vx: 0, vy: 0, vw: 390, vh: 844 } : opts.rect
  return null
}
{
  const log = []
  const b = createBrowser({ bin: '/fake/chrome', launch: fakeLaunch(log, pageEval()), idleMs: 30 })
  const shot = await b.withPage({ url: 'http://127.0.0.1:9/home.html', w: 375, h: 667, scale: 2, dark: true }, async (page) => {
    const v = await page.eval('window.__dshDesign.info()')
    return { v, jpg: await page.shot({ clip: { x: 0, y: 0, width: 10, height: 10 } }) }
  })
  const m = (name) => log.find((x) => x.method === name)
  check('CDP：无头、走管道、临时用户目录', log.args.includes('--headless=new') && log.args.includes('--remote-debugging-pipe') && log.args.some((a) => a.startsWith('--user-data-dir=')))
  check('CDP：按尺寸开页面（桌面方式排版，缩放给截图用）', JSON.stringify(m('Emulation.setDeviceMetricsOverride').params) === '{"width":375,"height":667,"deviceScaleFactor":2,"mobile":false}' && m('Emulation.setDeviceMetricsOverride').sessionId === 'S1')
  check('CDP：深色、少动画', JSON.stringify(m('Emulation.setEmulatedMedia').params.features) === '[{"name":"prefers-color-scheme","value":"dark"},{"name":"prefers-reduced-motion","value":"reduce"}]')
  check('CDP：载入地址，等 load 事件，再在页面里算', m('Page.navigate').params.url === 'http://127.0.0.1:9/home.html' && shot.v.title === '首页')
  check('CDP：截图是 JPEG，裁剪按 CSS 像素', shot.jpg[0] === 0xff && shot.jpg[1] === 0xd8 && m('Page.captureScreenshot').params.format === 'jpeg' && m('Page.captureScreenshot').params.clip.scale === 1)
  await new Promise((r) => setTimeout(r, 20))
  check('CDP：用完关掉页面', !!m('Target.closeTarget'))
  await new Promise((r) => setTimeout(r, 80))
  check('闲置一会儿浏览器自己关', b.running() === false)
}
{
  // 插件停用：三个页面开着、第四个在排队 → 关掉以后排队的失败，不会再开一个浏览器
  let launches = 0
  const log = []
  const inner = fakeLaunch(log, pageEval())
  const b = createBrowser({ bin: '/fake/chrome', launch: (...a) => { launches++; return inner(...a) }, idleMs: 30 })
  let release
  const hold = new Promise((r) => { release = r })
  const busy = [1, 2, 3].map(() => b.withPage({ url: 'http://127.0.0.1:9/a.html', w: 100, h: 100 }, () => hold).catch((e) => e.message))
  await new Promise((r) => setTimeout(r, 30))
  const queued = b.withPage({ url: 'http://127.0.0.1:9/b.html', w: 100, h: 100 }, async () => 'ran').catch((e) => e.message)
  b.destroy()
  release()
  const q = await queued
  await Promise.all(busy)
  let late = ''
  try { await b.withPage({ url: 'http://127.0.0.1:9/c.html', w: 100, h: 100 }, async () => 'ran') } catch (e) { late = e.message }
  await new Promise((r) => setTimeout(r, 20))
  check('停用后排队的、新来的都失败，不再开浏览器', q === 'browser closed' && late === 'browser closed' && launches === 1 && b.running() === false, `${q} / ${late} / ${launches}`)
}

// ── 两个工具走无头浏览器 ──
{
  const realTracker = studio.tracker
  const realBrowser = studio.browser
  const exec = { agent: { session: { id: 'sLook' } } }
  fs.writeFileSync(path.join(tmp, 'home.html'), '<meta name="dsh-design" content="app">')
  studio.tracker = { snapshot: () => snap }
  const log = []
  const issue = { type: 'covered', sev: 2, sel: 'main li:last-child', text: '最后一本', edge: 'bottom', bar: 'nav.tab', px: 40 }
  studio.browser = createBrowser({ bin: '/fake/chrome', launch: fakeLaunch(log, pageEval({ issues: [issue] })), idleMs: 30 })
  const r = await checkTool.execute({ sizes: ['375', '430x932', 'abc'], screens: ['home', 'cart'] }, exec)
  check('check_design：按指定尺寸量指定的几屏（App 类型是从页面 meta 认出来的）', r.text.includes('2 屏 × 2 种尺寸（375×667、430×932）') && r.text.includes('home.html「首页」') && r.text.includes('cart.html「首页」'), r.text)
  check('check_design：问题清单带数字，测量数字也在', r.text.includes('被固定栏压住：main li:last-child「最后一本」 — 滚到底还被底栏 nav.tab 压住 40px') && r.text.includes('底栏 nav.tab 高 83，滚到底时离内容 12px'), r.text)
  check('check_design：认不出的尺寸说出来', r.text.includes('认不出的尺寸（没量）：abc'), r.text)
  const sizes = log.filter((x) => x.method === 'Emulation.setDeviceMetricsOverride').map((x) => `${x.params.width}x${x.params.height}`).sort()
  check('check_design：每屏 × 每种尺寸各开一个页面', JSON.stringify(sizes) === '["375x667","375x667","430x932","430x932"]', JSON.stringify(sizes))
  const r0 = await checkTool.execute({}, exec)
  check('check_design：不给尺寸按设计的尺寸量全部屏', r0.text.includes('3 屏 × 1 种尺寸（390×844）'), r0.text)
  const none = await checkTool.execute({ screens: ['nope'] }, exec)
  check('check_design：要量的屏都没有 → 说现在有哪几屏', /没找到要量的屏：nope。现在有：home\.html、detail\.html、cart\.html/.test(none.text), none.text)

  // look_design：图存进附件库，render 时一张张带上
  const saved = []
  const ctx = { get: (k) => (k === 'attachments' ? { saveImages: async (imgs) => imgs.map((x, i) => { saved.push(x); return { id: `att-${saved.length}-${i}` } }) } : null) }
  const lk = await lookTool.execute({ screens: ['home', 'cart'], at: 'bottom', size: '375' }, exec, ctx)
  const blocks = lookTool.output.render({}, lk)
  check('look_design：图存进附件库（JPEG），render 出文字 + 两张图', saved.length === 2 && saved[0].mediaType === 'image/jpeg' && blocks.length === 3 && blocks[1].type === 'image' && blocks[1].attachment.id === 'att-1-0', JSON.stringify(blocks))
  check('look_design：说明写清哪屏、多大、滚到底', /图 1：home\.html「首页」 375×667 滚到底/.test(lk.text) && /图 2：cart\.html/.test(lk.text), lk.text)
  check('look_design：附件引用存在结果里（插件重载、再 render 一次图都还在）', Array.isArray(lk.images) && lk.images.length === 2 && JSON.parse(JSON.stringify(lk)).images[1].id === 'att-2-1' && lookTool.output.render({}, JSON.parse(JSON.stringify(lk))).length === 3, JSON.stringify(lk))
  const full = await lookTool.execute({ screens: ['home'], at: 'full' }, exec, ctx)
  check('look_design：full 从上到下每屏一张', /第 1\/2 屏/.test(full.text) && /第 2\/2 屏/.test(full.text), full.text)
  pageEval.parts = 10
  const long = await lookTool.execute({ screens: ['home'], at: 'full' }, exec, ctx)
  pageEval.parts = 0
  check('look_design：10 段的长页面截前 3 段 + 最后一段，说明跳过了 6 段', ['1/10', '2/10', '3/10', '10/10'].every((x) => long.text.includes(`第 ${x} 屏`)) && !long.text.includes('第 4/10 屏') && long.text.includes('中间 6 段没截'), long.text)
  const el = await lookTool.execute({ screens: ['home'], selector: 'nav.tab' }, exec, ctx)
  const clip = log.filter((x) => x.method === 'Page.captureScreenshot').pop().params.clip
  check('look_design：selector 只截那个元素（四周留 8px）', /元素/.test(el.text) && clip.x === 2 && clip.y === 692 && clip.width === 316 && clip.height === 96, JSON.stringify(clip))
  const bad = await lookTool.execute({ size: 'huge' }, exec, ctx)
  check('look_design：认不出的尺寸说清楚', /认不出尺寸「huge」/.test(bad.text), bad.text)
  const nofile = await lookTool.execute({ screens: ['home'] }, exec, { get: () => null })
  const files = (nofile.text.match(/\/[^\n]+\.jpg/g) || [])
  check('look_design：附件库用不了 → 存成文件告诉模型在哪', files.length === 1 && fs.existsSync(files[0]), nofile.text)
  for (const f of files) fs.rmSync(f, { force: true })
  studio.browser.stop()

  studio.browser = createBrowser({ bin: null })
  const nob = await lookTool.execute({}, exec, ctx)
  check('look_design：没有浏览器 → 说清楚，指向 check_design', /没找到 Chrome/.test(nob.text) && /check_design/.test(nob.text), nob.text)
  studio.check = null
  const nock = await checkTool.execute({ sizes: ['375'] }, exec)
  check('check_design：没有浏览器、右侧栏也没开 → 照自查清单', /没找到能用的 Chrome/.test(nock.text) && /自查/.test(nock.text), nock.text)
  studio.tracker = realTracker
  studio.browser = realBrowser
}

// ── 真浏览器（本机装着 Chrome / Edge 才跑） ──
const bin = findBrowser()
if (!bin) {
  console.log('（这台电脑上没有 Chrome / Edge，跳过真浏览器那几项）')
} else {
  const site = path.join(tmp, 'site')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'home.html'), `<!doctype html><html><head><meta charset="utf-8"><title>首页</title>
<link rel="stylesheet" href="missing.css"><script>nope()</script>
<style>body{margin:0;font:15px/1.4 sans-serif}header{position:fixed;top:0;left:0;right:0;height:56px;background:#fff}
main{padding:64px 16px 0}li{padding:14px 0;list-style:none}nav{position:fixed;bottom:0;left:0;right:0;height:83px;background:#fafafa}
nav a{display:inline-block;width:60px;height:48px}
@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head>
<body><header>书店</header><main><ul>${Array.from({ length: 12 }, (_, i) => `<li>第 ${i + 1} 本</li>`).join('')}<li id="last">最后一本被压住</li></ul></main>
<nav><a href="home.html">首页</a><a href="cart.html">购物车</a></nav></body></html>`)
  fs.writeFileSync(path.join(site, 'shell.html'), `<!doctype html><html><head><meta charset="utf-8"><title>壳</title>
<style>body{margin:0;font:15px/1.4 sans-serif}.app{height:100vh;position:relative}main{position:absolute;top:0;left:0;right:0;bottom:0;overflow:auto;padding:16px}
li{padding:14px 0;list-style:none}.tab{position:absolute;left:0;right:0;bottom:0;height:83px;background:#fafafa}</style></head>
<body><div class="app"><main><ul>${Array.from({ length: 14 }, (_, i) => `<li>行 ${i + 1}</li>`).join('')}<li>壳里最后一行</li></ul></main><div class="tab"><a href="home.html">首页</a></div></div></body></html>`)
  fs.writeFileSync(path.join(site, 'clean.html'), `<!doctype html><html><head><meta charset="utf-8"><title>干净</title>
<style>body{margin:0;font:15px/1.4 sans-serif}main{padding:16px 16px 120px}nav{position:fixed;bottom:0;left:0;right:0;height:83px;background:#fafafa}nav a{display:inline-block;width:60px;height:48px}</style></head>
<body><main>${Array.from({ length: 20 }, (_, i) => `<p>段落 ${i + 1}</p>`).join('')}<p>最后一段离底栏够远</p></main><nav><a href="home.html">首页</a></nav></body></html>`)
  fs.writeFileSync(path.join(site, 'app.css'), ['/* 按钮 */', '.btn {', '  font-size: 15px;', '  padding: 10px 16px;', '}', '.btn { color: #333 }', '@media (min-width: 1px) {', '  .btn { padding-top: 12px }', '}', '.btn { border-radius: 4px !important }'].join('\n'))
  fs.writeFileSync(path.join(site, 'rules.html'), `<!doctype html><html><head><meta charset="utf-8"><title>规则</title>
<link rel="stylesheet" href="app.css">
<style>.btn{background:#eee}</style>
<style>
main .btn { font-size: 17px }
</style></head>
<body><main><button class="btn" style="color:red;border-radius:9px">买</button></main></body></html>`)
  // 被外层 overflow:hidden 裁掉的字（看不见）伸到底栏位置；字画在底栏上面（层级更高）：都不算压住
  fs.writeFileSync(path.join(site, 'clip.html'), `<!doctype html><html><head><meta charset="utf-8"><title>裁掉</title>
<style>body{margin:0;font:15px/1.4 sans-serif}.box{height:300px;overflow:hidden}.box p{margin:0 0 20px}footer{position:fixed;left:0;right:0;bottom:0;height:80px;background:#eee}</style></head>
<body><div class="box">${Array.from({ length: 40 }, (_, i) => `<p>裁掉的第 ${i + 1} 行</p>`).join('')}</div><footer>底栏</footer></body></html>`)
  fs.writeFileSync(path.join(site, 'front.html'), `<!doctype html><html><head><meta charset="utf-8"><title>在上面</title>
<style>body{margin:0;font:15px/1.4 sans-serif}footer{position:fixed;left:0;right:0;bottom:0;height:80px;background:#eee;z-index:1}.badge{position:fixed;left:16px;right:16px;bottom:40px;z-index:5;margin:0;background:#fff}</style></head>
<body><p>正文</p><p class="badge">浮在底栏上面的提示</p><footer>底栏</footer></body></html>`)
  // 规则判断的边角：:is() 取最高分支、没生效的 @supports / media=print、同一个样式表引两次、@layer 里的只算「大概」
  fs.writeFileSync(path.join(site, 'one.css'), '.k { font-size: 11px }\n')
  fs.writeFileSync(path.join(site, 'print.css'), '.k { color: #f00 }\n')
  fs.writeFileSync(path.join(site, 'rules2.html'), `<!doctype html><html><head><meta charset="utf-8"><title>规则2</title>
<link rel="stylesheet" href="one.css"><link rel="stylesheet" href="one.css"><link rel="stylesheet" href="print.css" media="print">
<style>
:is(.k, #nope) { padding-top: 3px }
.k.k { padding-top: 5px }
@supports (display: nope-nope) { .k { background: #000 } }
.k { background: #fff }
@layer base { .k { border-radius: 2px } }
</style></head><body><p class="k">字</p></body></html>`)
  // 体检问题带上规则和行号：浅色字由 lowc.css 第 2 行决定；小字写在行内 style 上
  fs.writeFileSync(path.join(site, 'lowc.css'), '/* 浅色字 */\n.faint { color: #ccc; font-size: 15px }\n')
  fs.writeFileSync(path.join(site, 'lowc.html'), `<!doctype html><html><head><meta charset="utf-8"><title>浅色</title><link rel="stylesheet" href="lowc.css"></head>
<body style="background:#fff;margin:0;padding:16px"><p class="faint">很淡的一行说明文字</p><p style="font-size:9px;color:#333">很小的字</p></body></html>`)
  const hub = createHub({ parents: () => [] })
  const entry = await hub.open({ kind: 'file', root: site })
  const screens = ['home.html', 'shell.html', 'clean.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key }))
  const b = createBrowser({ bin })
  try {
    const t0 = Date.now()
    const rows = await measureAll(b, { screens, sizes: [[390, 844], [375, 667]], kind: 'app' })
    const at = (key, w) => rows.find((r) => r.key === key && r.w === w)
    const types = (r) => (r ? r.issues.map((x) => x.type) : [])
    check('真浏览器：六个页面都量成了', rows.every((r) => !r.error && r.metrics), JSON.stringify(rows.map((r) => r.error)))
    check('真浏览器：375×667 上最后一行被底栏压住，390×844 上没有', at('home.html', 375).issues.some((x) => x.type === 'covered' && x.edge === 'bottom' && x.text.includes('最后一本')) && !types(at('home.html', 390)).includes('covered'), JSON.stringify(at('home.html', 375).issues))
    check('真浏览器：页面脚本报错、缺样式表都报了', types(at('home.html', 390)).includes('jserr') && at('home.html', 390).issues.some((x) => x.type === 'missing' && x.src === 'missing.css' && x.what === 'css'), JSON.stringify(at('home.html', 390).issues))
    const m = at('home.html', 375).metrics
    check('真浏览器：测量数字（视口、页面高、顶栏 / 底栏和离内容的距离）', m.w === 375 && m.h === 667 && m.page > 667 && m.bars.some((x) => x.edge === 'top' && x.name === 'header') && m.bars.some((x) => x.edge === 'bottom' && x.name === 'nav' && x.gap < 0), JSON.stringify(m))
    check('真浏览器：App 壳（内容在能滚的 main 里、底栏绝对定位）滚到底也被压住', at('shell.html', 375).issues.some((x) => x.type === 'covered' && x.text.includes('壳里最后一行')) && at('shell.html', 375).metrics.areas === 1, JSON.stringify(at('shell.html', 375)))
    check('真浏览器：内容滚动时从底栏下面过不算文字叠在一起（只在滚到底还被压住时报 covered）', [375, 390].every((w) => !types(at('home.html', w)).includes('overlap')) && !types(at('clean.html', 375)).includes('overlap'), JSON.stringify([at('home.html', 375).issues, at('clean.html', 375).issues]))
    check('真浏览器：跳到不存在的页面（cart.html）报一次，存在的（home.html）不报；几种尺寸都算、不标尺寸', ['home.html'].every((k) => [390, 375].every((w) => at(k, w).issues.filter((x) => x.type === 'deadlink').map((x) => x.src).join() === 'cart.html')) && !types(at('clean.html', 375)).includes('deadlink'), JSON.stringify(at('home.html', 390).issues.filter((x) => x.type === 'deadlink')))
    check('真浏览器：留够了底边距的页面不报压住', !types(at('clean.html', 375)).includes('covered') && !types(at('clean.html', 375)).includes('tight'), JSON.stringify(at('clean.html', 375).issues))
    console.log(`  （量 6 个页面用了 ${Date.now() - t0}ms）`)

    const shots = await shootAll(b, { screens: screens.slice(0, 2), size: [375, 667], at: 'bottom' })
    const dim = (buf) => { for (let i = 2; i < buf.length - 9;) { const len = buf.readUInt16BE(i + 2); if (buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + len } return null }
    check('真浏览器：截图是 JPEG，按缩放放大（375×667 → 长边约 1568）', shots.length === 2 && shots.every((s) => s.jpg && s.jpg[0] === 0xff && s.jpg[1] === 0xd8) && JSON.stringify(dim(shots[0].jpg)) === '[750,1334]', JSON.stringify(shots.map((s) => [s.error, s.jpg && dim(s.jpg)])))
    const el = await shootAll(b, { screens: screens.slice(0, 1), size: [390, 844], at: 'top', selector: 'nav' })
    check('真浏览器：元素裁剪只截那一块（底栏 390×83，上面留 8px，不伸出视口）', el[0].jpg && JSON.stringify(dim(el[0].jpg)) === JSON.stringify([Math.round(390 * scaleFor(390, 844)), Math.round(91 * scaleFor(390, 844))]), JSON.stringify(el[0].jpg && dim(el[0].jpg)))
    const more = await measureAll(b, { screens: ['clip.html', 'front.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[390, 844]], kind: 'app' })
    const clipRow = more.find((r) => r.key === 'clip.html'), frontRow = more.find((r) => r.key === 'front.html')
    check('真浏览器：被外层裁掉、本来就看不见的字伸到底栏位置，不算压住', clipRow && !clipRow.issues.some((x) => x.type === 'covered'), JSON.stringify(clipRow && clipRow.issues))
    check('真浏览器：画在底栏上面的字不算压住，也不报「压住内容」', frontRow && !frontRow.issues.some((x) => x.type === 'covered') && frontRow.metrics.bars.every((x) => x.gap === null || x.gap >= 0), JSON.stringify(frontRow && [frontRow.issues, frontRow.metrics]))
    const light = await b.withPage({ url: screens[0].url, w: 390, h: 844 }, (p) => p.eval('getComputedStyle(document.body).backgroundColor'))
    const dark = await b.withPage({ url: screens[0].url, w: 390, h: 844, dark: true }, (p) => p.eval('getComputedStyle(document.body).backgroundColor'))
    check('真浏览器：深色按 prefers-color-scheme 切过去', light === 'rgba(0, 0, 0, 0)' && dark === 'rgb(17, 17, 17)', `${light} / ${dark}`)
    const sty = await b.withPage({ url: `${entry.origin}/rules.html`, w: 390, h: 844 }, (p) => p.eval('window.__dshDesign.style(".btn")'))
    const R = (sty && sty.rules) || {}
    const lineOf = (r) => findRule(fs.readFileSync(path.join(site, new URL(r.href).pathname.slice(1)), 'utf8'), r.sel, r.n)
    check('调样式规则：字号由优先级更高的 main .btn 决定（第二段 <style>，合起来数还是第 0 条，在第 5 行）', R['font-size'] && R['font-size'].sel === 'main .btn' && R['font-size'].href.endsWith('/rules.html') && lineOf(R['font-size']) === 5, JSON.stringify(R['font-size']))
    check('调样式规则：上内边距由生效的媒体查询里那条决定（app.css 第 8 行），下内边距还是第 2 行那条', R['padding-top'] && lineOf(R['padding-top']) === 8 && R['padding-bottom'] && lineOf(R['padding-bottom']) === 2, JSON.stringify([R['padding-top'], R['padding-bottom']]))
    check('调样式规则：行内 color 盖过 .btn；圆角的 !important 盖过行内（不算行内）', R.color && R.color.inline && R.color.sel === '.btn' && R.color.n === 1 && R['border-radius'] && !R['border-radius'].inline && lineOf(R['border-radius']) === 10, JSON.stringify([R.color, R['border-radius']]))
    const locate = (items) => items.map((it) => { const f = decodeURIComponent(new URL(it.href).pathname.slice(1)); return { file: f, line: findRule(fs.readFileSync(path.join(site, f), 'utf8'), it.sel, it.n) } })
    const lc = await measureAll(b, { screens: [{ key: 'lowc.html', url: `${entry.origin}/lowc.html`, label: 'lowc' }, screens[0]], sizes: [[390, 844]], kind: 'app', locate })
    const ctr = lc[0].issues.find((x) => x.type === 'contrast'), tiny = lc[0].issues.find((x) => x.type === 'tiny')
    check('体检带规则：对比度不够 → 由 .faint 决定，lowc.css 第 2 行', ctr && ctr.rule && ctr.rule.sel === '.faint' && ctr.rule.file === 'lowc.css' && ctr.rule.line === 2, JSON.stringify(lc[0].issues))
    check('体检带规则：字太小写在行内 style 上', tiny && tiny.rule && tiny.rule.inline === true, JSON.stringify(tiny))
    const lcText = formatMeasure(lc, { sizes: [[390, 844]] })
    check('体检带规则：写进给模型的字；每屏说查了几个跳转', lcText.includes('文字颜色由 .faint 决定，lowc.css 第 2 行') && lcText.includes('字号写在元素的行内 style 上') && lcText.includes('跳转：查了 1 个，1 个打不开'), lcText)
    const R2 = ((await b.withPage({ url: `${entry.origin}/rules2.html`, w: 390, h: 844 }, (p) => p.eval('window.__dshDesign.style(".k")'))) || {}).rules || {}
    check('调样式规则：:is(.k, #nope) 按最高分支（id）算，盖过后写的 .k.k', R2['padding-top'] && R2['padding-top'].sel.startsWith(':is('), JSON.stringify(R2['padding-top']))
    check('调样式规则：同一个样式表引两次，第几条还是 0（行号找得到）', R2['font-size'] && R2['font-size'].n === 0 && R2['font-size'].href.endsWith('/one.css'), JSON.stringify(R2['font-size']))
    check('调样式规则：media="print" 的样式表、没生效的 @supports 不算', !R2.color && R2.background && R2.background.n === 1 && !R2.background.maybe, JSON.stringify([R2.color, R2.background]))
    check('调样式规则：@layer 里的标成「大概」', R2['border-radius'] && R2['border-radius'].maybe === true, JSON.stringify(R2['border-radius']))
    check('调样式规则：背景来自第一段 <style>', R.background && R.background.sel === '.btn' && R.background.href.endsWith('/rules.html') && R.background.n === 0, JSON.stringify(R.background))
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
