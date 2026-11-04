/**
 * check_design / look_design 的无头浏览器那条路（不用开 DSH）：
 *   node test/test-look.mjs
 *
 * 尺寸、类型、挑屏、给模型的字（look.js）；找浏览器、CDP 管道收发（browser.js，用假的浏览器进程）；
 * 两个工具走无头浏览器、没有浏览器时的说法、截图存进附件库；
 * 体检附严重问题的局部截图（挑哪几条、图号写进清单）；
 * 本机装着 Chrome / Edge 时再真开一回：底栏压住最后一行、脚本报错、缺样式表、固定栏离内容多远、真截图、元素裁剪、深色、问题附图
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { parseMeta, sizeOf, designOf, metaOfFile, pickScreens, scaleFor, formatMeasure, issueSnapshot, formatShots, detailOf, measureAll, shootAll, pickCrops, cropIssues } from '../lib/look.js'
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
check('小程序：meta 和只给宽度的尺寸（按手机的高）', parseMeta('miniprogram').kind === 'miniprogram' && parseMeta('weapp 375x667').size === '375x667' && sizeOf('375', 'miniprogram').join('x') === '375x667' && sizeOf('414', 'miniprogram').join('x') === '414x896' && JSON.stringify(designOf({ kind: 'miniprogram' }, () => '')) === '{"kind":"miniprogram","size":[375,812]}')
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
check('问题细节：底栏压住，给出底部至少再留多少（压住的 + 16）', /滚到底还被底栏 nav 压住 52px（给内容留出栏的高度：底部至少再留 68px，用 padding-bottom/.test(detailOf({ type: 'covered', edge: 'bottom', bar: 'nav', px: 52 })))
check('问题细节：脚本报错带文件和行号', detailOf({ type: 'jserr', msg: 'x is not defined', src: 'app.js', line: 3 }) === 'x is not defined（app.js:3）')
check('问题细节：叠字带可能的原因（负 margin / 绝对定位）', detailOf({ type: 'overlap', other: 'p.a', otherText: '作者', cause: { sel: '.row', prop: 'margin-top', value: '-26px' } }).endsWith('（可能是 .row 的 margin-top: -26px）') && /\.price 用了绝对定位 position: absolute/.test(detailOf({ type: 'overlap', other: 'x', cause: { sel: '.price', prop: 'position', value: 'absolute' } })))
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
  // 体检附图：挑严重的、有元素的；先每屏每类一条、同类里最重的；同一个问题几种尺寸只截第一种；同一个元素只截一次
  const cov = (sel, px) => ({ type: 'covered', sev: 2, sel, text: sel, edge: 'bottom', bar: 'nav', px })
  const rows = [
    { key: 'a.html', w: 390, h: 844, issues: [cov('li.x', 10), cov('li.y', 60), { type: 'tap', sev: 1, sel: 'a' }, { type: 'jserr', sev: 2, sel: '', msg: 'x' }] },
    { key: 'a.html', w: 375, h: 667, issues: [cov('li.y', 60), { type: 'overlap', sev: 2, sel: 'li.y', other: 'b', otherSel: 'b' }, { type: 'contrast', sev: 1, sel: 'p' }] },
    { key: 'b.html', w: 390, h: 844, issues: [{ type: 'clipped', sev: 2, sel: '.t', px: 9 }, { type: 'contrast', sev: 2, sel: '.f', ratio: 1.4, need: 4.5 }, { type: 'img', sev: 2, sel: 'img' }] },
    { key: 'b.html', w: 375, h: 667, error: 'timeout', issues: [{ type: 'covered', sev: 2, sel: 'x', px: 99 }] },
  ]
  const picks = pickCrops(rows, 4).map((c) => `${c.row.key}@${c.row.w} ${c.it.type} ${c.it.sel}`)
  check('附图挑选：压住类先截最重的；同一个元素不截两次；轻的、没元素的、没量成的不截；先每屏每类一条再按顺序补', JSON.stringify(picks) === JSON.stringify(['a.html@390 covered li.y', 'b.html@390 clipped .t', 'b.html@390 img img', 'b.html@390 contrast .f']), JSON.stringify(picks))
  check('附图挑选：只要一张就截最要紧的那条', pickCrops(rows, 1).length === 1 && pickCrops(rows, 1)[0].it.sel === 'li.y')
  const at = (y, x = 16) => ({ x, y, w: 120, h: 20 })
  const near = pickCrops([{ key: 'a.html', w: 390, h: 844, issues: [{ ...cov('li.x', 10), rect: at(800) }, { ...cov('li.y', 60), rect: at(820) }, { ...cov('li.z', 30), rect: at(300) }, { ...cov('li.w', 20), rect: at(810, 250) }] }], 4)
  check('附图挑选：挨着的（上下差不到 48px）不另截，记在那张图上；远的另截', JSON.stringify(near.map((c) => [c.it.sel, c.also.map((x) => x.it.sel)])) === '[["li.y",["li.w","li.x"]],["li.z",[]]]', JSON.stringify(near.map((c) => [c.it.sel, c.also.map((x) => x.it.sel)])))
  const fill = pickCrops([{ key: 'a.html', w: 390, h: 844, issues: [cov('li.x', 10), cov('li.y', 60), cov('li.z', 30)] }], 4).map((c) => c.it.sel)
  check('附图挑选：只有一类、没有位置时按轻重补满', JSON.stringify(fill) === '["li.y","li.z","li.x"]', JSON.stringify(fill))
  const crops = [{ n: 1, k: 'a.html|covered|li.y|li.y||', ks: ['a.html|covered|li.y|li.y||', 'a.html|covered|li.x|li.x||'], key: 'a.html', w: 390, h: 844, type: 'covered' }]
  const t = formatMeasure(rows.slice(0, 2).map((r) => ({ ...r, metrics: null })), { sizes: [[390, 844], [375, 667]], crops })
  // 同一个原因的两处叠字并成一条；附图写明谁画在上面
  const ovA = { type: 'overlap', sev: 2, sel: '.price', text: '¥68', other: 'p.author', otherText: '石黑一雄', otherSel: 'p.author', cause: { sel: '.row', prop: 'margin-top', value: '-26px' } }
  const ovB = { type: 'overlap', sev: 2, sel: 'p.author', text: '石黑一雄', other: 'span.fmt', otherText: '精装', otherSel: 'span.fmt', cause: { sel: '.row', prop: 'margin-top', value: '-26px' } }
  const ovRows = [{ key: 'd.html', w: 390, h: 844, issues: [ovA, ovB], metrics: null }]
  const ovText = formatMeasure(ovRows, { sizes: [[390, 844]], crops: [{ n: 1, k: 'd.html|overlap|.price|¥68||', ks: ['d.html|overlap|.price|¥68||'], key: 'd.html', w: 390, h: 844, type: 'overlap', upper: 'self' }] })
  check('叠字：同一个原因的两处并成一条，问题数也按一个算；附图说谁画在上面、另一个是橙框', ovText.includes('发现 1 个问题') && (ovText.match(/^ {2}\d+\. /gm) || []).length === 1 && ovText.includes('p.author「石黑一雄」和 span.fmt「精装」也叠着，同一个原因（可能是 .row 的 margin-top: -26px）') && ovText.includes('（看图 1；「¥68」画在上面）') && ovText.includes('橙色虚线框'), ovText)
  check('附图写进清单：开头说附了几张、红框是什么；那条后面写看图几（两种尺寸都有时写截的是哪种）；同在图里的那条也写', t.includes('严重的问题附了 1 张局部截图（图 1，真实渲染') && t.includes('红框是出问题的元素') && t.includes('把栏调成了半透明，透出下面被压住的字') && /li\.y「li\.y」 — 滚到底还被底栏 nav 压住 60px.*（看图 1，390×844）/.test(t) && /li\.x「li\.x」 — .*压住 10px.*（看图 1）/.test(t) && (t.match(/看图/g) || []).length === 2, t)
}
{
  const t = formatShots([
    { key: 'home.html', title: '首页', w: 390, h: 844, at: 'top', page: 1600, jpg: Buffer.from('x') },
    { key: 'cart.html', w: 390, h: 844, at: 'top', error: '超时' },
    { key: 'cart.html', w: 390, h: 844, at: 'full', part: 2, of: 3, page: 2000, jpg: Buffer.from('x') },
  ], { where: '/d', more: 2 })
  check('截图说明：不是小程序不提胶囊', !t.includes('胶囊'), t)
  const tm = formatShots([{ key: 'home.html', w: 375, h: 812, at: 'top', page: 812, jpg: Buffer.from('x') }], { kind: 'miniprogram' })
  check('截图说明：小程序说右上角画上了胶囊（页面里别再画）', tm.includes('右上角画上了微信的胶囊') && tm.includes('页面里别再画'), tm)
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
  if (expr.includes('.crop(')) return opts.crop === undefined ? null : opts.crop
  if (expr.includes('.rect(')) return opts.rect === undefined ? { x: 10, y: 700, w: 300, h: 80, vx: 0, vy: 0, vw: 390, vh: 844 } : opts.rect
  return null
}
// 小程序截图：每张图前（滚动之后）重画胶囊，胶囊黑白按那时的顶栏
{
  const log = []
  const b = createBrowser({ bin: '/fake/chrome', platform: 'fake', launch: fakeLaunch(log, pageEval({ crop: { x: 0, y: 0, w: 50, h: 50, inside: [] } })), idleMs: 30 })
  const seq = () => log.map((x) => (x.method === 'Page.captureScreenshot' ? 'P' : x.method !== 'Runtime.evaluate' ? '' : /capsule\('solid'\)/.test(x.params.expression) ? 'C' : /capsule\('ghost'\)/.test(x.params.expression) ? 'G' : /\.scroll\((\d+)\)/.test(x.params.expression) ? 'S' + /\.scroll\((\d+)\)/.exec(x.params.expression)[1] : /\.crop\(/.test(x.params.expression) ? 'K' : '')).filter(Boolean).join(' ')
  await shootAll(b, { screens: [{ key: 'a.html', url: 'http://127.0.0.1:9/a.html' }], size: [375, 812], at: 'full', kind: 'miniprogram' })
  const full = seq()
  log.length = 0
  await cropIssues(b, [{ key: 'a.html', w: 375, h: 812, issues: [{ type: 'capsule', sev: 2, sel: 'button', text: '搜索', px: 40, x: 281, rect: { x: 300, y: 50, w: 44, h: 44 } }] }], { screens: [{ key: 'a.html', url: 'http://127.0.0.1:9/a.html' }], kind: 'miniprogram' })
  const crop = seq()
  await new Promise((r) => setTimeout(r, 80)) // 闲置 30ms 后自己关
  check('小程序截图：每张前都重画胶囊（滚到第二段后重量深浅再画），局部图滚到问题那儿以后才画半透明胶囊', full === 'S0 C P S1 C P' && crop === 'K G P', `${full} / ${crop}`)
}
{
  const log = []
  const b = createBrowser({ bin: '/fake/chrome', platform: 'fake', launch: fakeLaunch(log, pageEval()), idleMs: 30 })
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
  const b = createBrowser({ bin: '/fake/chrome', platform: 'fake', launch: (...a) => { launches++; return inner(...a) }, idleMs: 30 })
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
  studio.browser = createBrowser({ bin: '/fake/chrome', platform: 'fake', launch: fakeLaunch(log, pageEval({ issues: [issue] })), idleMs: 30 })
  const r = await checkTool.execute({ sizes: ['375', '430x932', 'abc'], screens: ['home', 'cart'] }, exec)
  check('check_design：按指定尺寸量指定的几屏（App 类型是从页面 meta 认出来的）', r.text.includes('2 屏 × 2 种尺寸（375×667、430×932）') && r.text.includes('home.html「首页」') && r.text.includes('cart.html「首页」'), r.text)
  check('check_design：问题清单带数字，测量数字也在', r.text.includes('被固定栏压住：main li:last-child「最后一本」 — 滚到底还被底栏 nav.tab 压住 40px') && r.text.includes('底栏 nav.tab 高 83，滚到底时离内容 12px'), r.text)
  check('check_design：认不出的尺寸说出来', r.text.includes('认不出的尺寸（没量）：abc'), r.text)
  const sizes = log.filter((x) => x.method === 'Emulation.setDeviceMetricsOverride' && x.params.deviceScaleFactor === 1).map((x) => `${x.params.width}x${x.params.height}`).sort()
  check('check_design：每屏 × 每种尺寸各开一个页面', JSON.stringify(sizes) === '["375x667","375x667","430x932","430x932"]', JSON.stringify(sizes))
  const r0 = await checkTool.execute({}, exec)
  check('check_design：不给尺寸按设计的尺寸量全部屏', r0.text.includes('3 屏 × 1 种尺寸（390×844）'), r0.text)
  const none = await checkTool.execute({ screens: ['nope'] }, exec)
  check('check_design：要量的屏都没有 → 说现在有哪几屏', /没找到要量的屏：nope。现在有：home\.html、detail\.html、cart\.html/.test(none.text), none.text)

  // look_design：图存进附件库，render 时一张张带上
  const saved = []
  const ctx = { get: (k) => (k === 'attachments' ? { saveImages: async (imgs) => imgs.map((x, i) => { saved.push(x); return { id: `att-${saved.length}-${i}` } }) } : null) }

  // check_design 附图：严重的那条按发现时的尺寸重开、截那一块，图存进附件库，清单里写看图几
  studio.browser.stop()
  log.length = 0
  studio.browser = createBrowser({ bin: '/fake/chrome', platform: 'fake', launch: fakeLaunch(log, pageEval({ issues: [issue], crop: { x: 0, y: 520, w: 375, h: 147 } })), idleMs: 30 })
  const ck = await checkTool.execute({ sizes: ['375'], screens: ['home'] }, exec, ctx)
  const ckBlocks = checkTool.output.render({}, ck)
  const cropShot = log.filter((x) => x.method === 'Page.captureScreenshot').pop()
  const cropMetrics = log.filter((x) => x.method === 'Emulation.setDeviceMetricsOverride').pop().params
  check('check_design 附图：按截图缩放重开一页，截问题那一块', cropMetrics.width === 375 && cropMetrics.deviceScaleFactor === 2 && cropShot && JSON.stringify(cropShot.params.clip) === '{"x":0,"y":520,"width":375,"height":147,"scale":1}', JSON.stringify([cropMetrics, cropShot && cropShot.params]))
  check('check_design 附图：图存进附件库、引用在结果里，render 出文字 + 图', Array.isArray(ck.images) && ck.images.length === 1 && ckBlocks.length === 2 && ckBlocks[1].type === 'image' && saved.length === 1 && saved[0].mediaType === 'image/jpeg', JSON.stringify(ck))
  check('check_design 附图：清单里那条写「看图 1」', ck.text.includes('严重的问题附了 1 张局部截图') && /压住 40px.*（看图 1）/.test(ck.text), ck.text)
  const evals = log.filter((x) => x.method === 'Runtime.evaluate' && x.params.expression.includes('.crop(')).map((x) => x.params.expression)
  check('check_design 附图：告诉页面是滚到底被底栏压住的那个元素，红框上标「压住 40px」', evals.length === 1 && evals[0].includes('"sel":"main li:last-child"') && evals[0].includes('"edge":"bottom"') && evals[0].includes('"label":"压住 40px"'), JSON.stringify(evals))
  log.length = 0
  const noImg = await checkTool.execute({ sizes: ['375'], screens: ['home'], images: false }, exec, ctx)
  check('check_design 附图：images=false 不截、不附', !noImg.images && !noImg.text.includes('看图') && !log.some((x) => x.method === 'Page.captureScreenshot'), noImg.text)
  const noCtx = await checkTool.execute({ sizes: ['375'], screens: ['home'] }, exec)
  check('check_design 附图：附件库用不了就不提图（清单照给）', !noCtx.images && !noCtx.text.includes('看图') && noCtx.text.includes('压住 40px'), noCtx.text)
  saved.length = 0
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
  const files = (nofile.text.match(/(?:[A-Za-z]:\\|\/)[^\n]+\.jpg/g) || [])
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
  fs.writeFileSync(path.join(site, 'neg.css'), '/* 价格行 */\n.row { display: flex; gap: 8px }\n.row {\n  margin-top: -24px;\n}\n')
  fs.writeFileSync(path.join(site, 'neg.html'), `<!doctype html><html><head><meta charset="utf-8"><title>负边距</title><link rel="stylesheet" href="neg.css">
<style>body{margin:0;padding:24px;font:16px/1.4 sans-serif}.author{margin:0}</style></head><body><p class="author">石黑一雄 著 · 宋佥 译</p><div class="row"><span class="price">¥68</span><span>精装 392 页</span></div></body></html>`)
  // 附图：名字和价格叠在一起、框里的字被截断
  fs.writeFileSync(path.join(site, 'over.html'), `<!doctype html><html><head><meta charset="utf-8"><title>叠字</title>
<style>body{margin:0;font:16px/1.4 sans-serif;padding:24px}.card{position:relative;height:120px;border:1px solid #ddd;padding:16px;margin-top:900px}
.price{position:absolute;right:16px;top:20px;font-size:28px;font-weight:700}.name{font-size:22px}
@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head>
<body><h1>订单</h1><div class="card"><div class="name">超长的商品名称会和价格叠在一起</div><div class="price">¥1299</div></div></body></html>`)
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
  // 小程序：顶栏右边的按钮伸进胶囊（375 宽时胶囊在 x 281–368、y 48–80）；按钮放左边的不算
  const miniPage = (side) => `<!doctype html><html><head><meta charset="utf-8"><title>小程序</title>
<style>body{margin:0;font:15px/1.4 sans-serif}.nav{position:fixed;top:0;left:0;right:0;height:88px;background:#07C160;color:#fff}
.nav h1{position:absolute;left:0;right:0;top:44px;margin:0;font-size:17px;line-height:44px;text-align:center}
.nav button{position:absolute;${side}:12px;top:44px;width:44px;height:44px;font-size:13px;padding:0}main{padding:100px 16px 16px}</style></head>
<body><div class="nav"><h1>小店</h1><button>搜索</button></div><main><p>商品</p></main></body></html>`
  fs.writeFileSync(path.join(site, 'mini.html'), miniPage('right'))
  fs.writeFileSync(path.join(site, 'mini-ok.html'), miniPage('left'))
  // 深色顶栏上盖着装饰 SVG 和半透明渐变：胶囊还是要画白的
  fs.writeFileSync(path.join(site, 'mini-dark.html'), `<!doctype html><html><head><meta charset="utf-8"><title>我的</title>
<style>body{margin:0}header{position:relative;height:240px;background:#1F1C17}header::before{content:"";position:absolute;inset:0;background:radial-gradient(70% 60% at 88% 6%,rgba(178,58,47,.55),transparent 62%)}
header svg{position:absolute;right:0;top:20px;width:200px;height:120px}</style></head>
<body><header><svg viewBox="0 0 200 120"><path d="M0 60 Q50 0 100 60 T200 60" stroke="#C8952E" fill="none"/><rect x="100" y="20" width="100" height="60" fill="rgba(255,255,255,.08)"/></svg></header></body></html>`)
  // 胶囊的边角：内部滚动区滚过 200（正常滚过胶囊下面的不算；没滚时就在胶囊里的照样报）、被外层裁掉看不见的不算
  const miniHead = (title, css) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:15px/1.4 sans-serif}${css}</style></head><body>`
  fs.writeFileSync(path.join(site, 'mini-scroll.html'), miniHead('滚动', '.sc{height:100vh;overflow:auto;position:relative}.sc button{position:absolute;right:12px;width:44px;height:44px;padding:0}.bad{top:50px}.ok{top:244px}.sc i{display:block;height:2000px}') +
    '<div class="sc"><button class="bad">分享</button><button class="ok">收藏</button><i></i></div><script>document.querySelector(".sc").scrollTop = 200</script></body></html>')
  fs.writeFileSync(path.join(site, 'mini-clip.html'), miniHead('裁掉', '.wrap{position:absolute;top:0;right:0;width:120px;height:30px;overflow:hidden}.wrap button{position:absolute;top:44px;right:12px;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><button>搜索</button></div><p style="margin-top:100px">正文</p></body></html>')
  // 绝对定位的按钮，包含块在裁剪的那层外面（那层没定位）：裁不掉，照样报
  fs.writeFileSync(path.join(site, 'mini-cq.html'), miniHead('查询容器', '.wrap{height:30px;overflow:hidden}.cq{container-type:inline-size}.cq button{position:absolute;top:44px;right:12px;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><div class="cq"><button>分享</button></div></div></body></html>')
  fs.writeFileSync(path.join(site, 'mini-out.html'), miniHead('跳出', '.wrap{height:30px;overflow:hidden}.wrap button{position:absolute;top:44px;right:12px;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><button>搜索</button></div><p style="margin-top:100px">正文</p></body></html>')
  // 放大两倍（transform / zoom）里的滚动区滚过 200：滚动量按放大后的算（真实在 y 264 的不报、在 y 50 的照报）
  const zoomPage = (how) => miniHead('放大', `.z{${how};width:187.5px}.sc{height:400px;overflow:auto;position:relative}.sc button{position:absolute;right:3px;width:22px;height:22px;padding:0;font-size:8px}.bad{top:25px}.ok{top:132px}.sc i{display:block;height:2000px}`) +
    '<div class="z"><div class="sc"><button class="bad">分享</button><button class="ok">收藏</button><i></i></div></div><script>document.querySelector(".sc").scrollTop = 200</script></body></html>'
  fs.writeFileSync(path.join(site, 'mini-scale.html'), zoomPage('transform:scale(2);transform-origin:0 0'))
  fs.writeFileSync(path.join(site, 'mini-zoom.html'), zoomPage('zoom:2'))
  // 吸顶的那层也被外层裁掉；will-change 也当包含块（裁得掉）；只裁横向的不裁竖向
  fs.writeFileSync(path.join(site, 'mini-sticky.html'), miniHead('吸顶', '.wrap{height:30px;overflow:hidden}.st{position:sticky;top:0;height:100px}.st button{position:absolute;top:44px;right:12px;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><div class="st"><button>搜索</button></div></div><p style="margin-top:100px">正文</p></body></html>')
  fs.writeFileSync(path.join(site, 'mini-cb.html'), miniHead('包含块', '.wrap{height:30px;overflow:hidden;will-change:transform}.wrap button{position:absolute;top:44px;right:12px;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><button>搜索</button></div><p style="margin-top:100px">正文</p></body></html>')
  fs.writeFileSync(path.join(site, 'mini-axis.html'), miniHead('单向', '.wrap{height:30px;overflow-x:clip;overflow-y:visible}.wrap button{display:block;margin:44px 12px 0 auto;width:44px;height:44px;padding:0}') +
    '<div class="wrap"><button>搜索</button></div><p style="margin-top:100px">正文</p></body></html>')
  // 胶囊深浅的边角：渐变、半透明的黑、图片、页面自己指定
  fs.writeFileSync(path.join(site, 'mini-grad.html'), miniHead('渐变', 'header{height:120px;background:linear-gradient(#111,#222)}') + '<header></header></body></html>')
  fs.writeFileSync(path.join(site, 'mini-fade.html'), miniHead('淡', 'body{background:#fff}header{height:120px;background:#000;opacity:.1}') + '<header></header></body></html>')
  const darkSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#151515"/></svg>')
  fs.writeFileSync(path.join(site, 'mini-img.html'), miniHead('图片', 'body{background:#fff}header{position:relative;height:200px}header img{width:100%;height:100%;object-fit:cover;display:block}') + `<header><img src="${darkSvg}" alt=""></header></body></html>`)
  // 透明组：40% 的黑父容器里套黑子容器，浏览器画出来是 #999（浅）；图片顶对齐时胶囊那块是白的；透明图片自己的黑底要算上
  fs.writeFileSync(path.join(site, 'mini-group.html'), miniHead('透明组', 'body{background:#fff}.p{height:120px;background:#000;opacity:.4}.p div{height:120px;background:#000}') + '<div class="p"><div></div></div></body></html>')
  const topWhite = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="80"><rect width="20" height="80" fill="#111"/><rect width="20" height="20" fill="#fff"/></svg>')
  fs.writeFileSync(path.join(site, 'mini-pos.html'), miniHead('顶对齐', 'body{background:#fff}img{display:block;width:100%;height:200px;object-fit:cover;object-position:center top}') + `<img src="${topWhite}" alt=""></body></html>`)
  const clear = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>')
  fs.writeFileSync(path.join(site, 'mini-imgbg.html'), miniHead('图片底色', 'body{background:#fff}img{display:block;width:100%;height:200px;background:#000}') + `<img src="${clear}" alt=""></body></html>`)
  // 命中测试跳过的层：pointer-events:none 的黑底照算；绝对定位的黑子层伸出 40% 透明的父框，父框的透明度照算（#999，浅）；object-position 带 calc
  fs.writeFileSync(path.join(site, 'mini-pe.html'), miniHead('不可点', 'body{background:#fff}.bg{position:fixed;top:0;left:0;right:0;height:120px;background:#000;pointer-events:none}') + '<div class="bg"></div></body></html>')
  fs.writeFileSync(path.join(site, 'mini-pei.html'), miniHead('不可点 important', 'body{background:#fff}.bg{position:fixed;top:0;left:0;right:0;height:120px;background:#000;pointer-events:none!important}') + '<div class="bg"></div></body></html>')
  fs.writeFileSync(path.join(site, 'mini-pes.html'), miniHead('不可点 行内', 'body{background:#fff}.bg{position:fixed;top:0;left:0;right:0;height:120px;background:#000}') + '<div class="bg" style="pointer-events: none !important; color: red;"></div><button style="position:fixed;top:200px;left:0;width:375px;height:60px">按钮</button><div class="cover" style="position:fixed;top:200px;left:0;width:375px;height:60px;pointer-events:none"></div><script>window.__muts = 0; new MutationObserver((r) => { window.__muts += r.length }).observe(document.documentElement, { subtree: true, attributes: true, childList: true })</script></body></html>')
  // body 自己写了 !important 的不可点黑底；行内 !important 的黑层上面还盖着 z-index 更高的白顶栏（白的在上）
  fs.writeFileSync(path.join(site, 'mini-pebody.html'), miniHead('body 不可点', 'body{background:#000;pointer-events:none!important;min-height:100vh}') + '<p style="color:#fff">正文</p></body></html>')
  fs.writeFileSync(path.join(site, 'mini-pez.html'), miniHead('盖着', 'body{background:#fff}.bg{position:fixed;top:0;left:0;right:0;height:120px;background:#000;z-index:1}header{position:fixed;top:0;left:0;right:0;height:88px;background:#fff;z-index:2}') + '<div class="bg" style="pointer-events:none!important"></div><header></header></body></html>')
  // 命中测试漏掉的那几个：被外层裁掉的不算；子层 z-index 再高也出不了父层的层叠上下文；html 有渐变时 body 的白底照算
  fs.writeFileSync(path.join(site, 'mini-pecl.html'), miniHead('裁掉的黑底', 'body{background:#fff}.wrap{height:30px;overflow:hidden}.bg{height:120px;background:#000}') + '<div class="wrap"><div class="bg" style="pointer-events:none!important"></div></div></body></html>')
  fs.writeFileSync(path.join(site, 'mini-pesc.html'), miniHead('层叠', 'body{background:#fff}.p{position:relative;z-index:0;height:0}.bg{position:absolute;top:0;left:0;width:375px;height:120px;background:#000;z-index:10}header{position:fixed;top:0;left:0;right:0;height:120px;background:#fff;z-index:2}') + '<div class="p"><div class="bg" style="pointer-events:none!important"></div></div><header></header></body></html>')
  fs.writeFileSync(path.join(site, 'mini-htmlgrad.html'), miniHead('html 渐变', 'html{background:linear-gradient(#111,#222)}body{background:#fff;min-height:100vh}') + '<p>正文</p></body></html>')
  // oklch（Tailwind 4 默认的写法）：深色顶栏（直接写、用变量、渐变）都认得；浅灰 oklch 字的对比度照样查
  fs.writeFileSync(path.join(site, 'mini-oklch.html'), miniHead('oklch', ':root{--nav:oklch(20.8% 0.042 265.755)}body{background:#fff}header{height:120px;background:var(--nav)}.pale{color:oklch(85% 0 0);font-size:15px}') + '<header></header><p class="pale">浅灰色的说明文字</p></body></html>')
  // 会员卡：深色底是不可点的装饰层，上面的浅色字（oklch / rgb）对比度够，不该报
  fs.writeFileSync(path.join(site, 'card-pe.html'), miniHead('会员卡', 'body{background:#fff}.card{position:relative;height:160px;margin:16px;border-radius:16px;overflow:hidden}.card .bg{position:absolute;inset:0;background:#0F172B;pointer-events:none}.card p{position:relative;margin:0;padding:16px;font-size:15px}.a{color:oklch(98.4% 0.003 247.858)}.b{color:#F8FAFC}') +
    '<div class="card"><div class="bg"></div><p class="a">金卡会员 · 积分 2,480</p><p class="b">有效期至 2027-12-31</p></div></body></html>')
  // 背景层的透明度按组算：12% 的黑装饰底上的深字够清楚（别当纯黑报），深色卡片上 8% 的白蒙层下的深灰字看不清（别当纯白漏掉）
  fs.writeFileSync(path.join(site, 'card-op.html'), miniHead('透明层', 'body{background:#fff}.card{position:relative;height:120px;margin:16px;border-radius:16px;overflow:hidden}.card i{position:absolute;inset:0;pointer-events:none}.c1 i{background:#000;opacity:.12}.c2{background:#111}.c2 i{background:#fff;opacity:.08}.card p{position:relative;margin:0;padding:16px;font-size:15px}.ok{color:#111}.bad{color:#333}' +
    '.c3 i{background:linear-gradient(#000,#333);opacity:0}.c4 i{background:#000 url(data:image/gif;base64,R0lGODlhAQABAAAAACw=);opacity:0}.pale{color:#ccc}.sp{height:900px}') +
    '<div class="card c1"><i></i><p class="ok">浅灰底上的深色字</p></div><div class="card c2"><i></i><p class="bad">深底上的深灰字</p></div>' +
    '<div class="card c3"><i></i><p class="pale">隐藏渐变层上的浅灰字</p></div><div class="sp"></div><div class="card c4"><i></i><p class="pale">隐藏图片层上的浅灰字</p></div></body></html>')
  // 不在屏幕里的会员卡（第二屏、能滚的 main 里滚不到的、main 里被裁掉但坐标还在屏幕里的）：照样按装饰底算不报；第二屏真看不清的浅灰字照报、位置是页面里的；
  // 量的时候不滚页面（滚动位置原样）。整页铺着固定定位的深色底时，屏幕外的字说不准背景，不查
  const farCss = 'body{background:#fff}main{height:400px;overflow:auto}.sp{height:900px}.sp2{height:450px}.card{position:relative;height:160px;margin:16px;border-radius:16px;overflow:hidden}.card .bg{position:absolute;inset:0;background:#0F172B;pointer-events:none}.card p{position:relative;margin:0;padding:16px;font-size:15px;color:#F8FAFC}.pale{color:#ccc}'
  const farCard = (t) => `<div class="card"><div class="bg"></div><p>${t}</p></div>`
  fs.writeFileSync(path.join(site, 'card-far.html'), miniHead('第二屏', farCss) +
    `<main><div class="sp2"></div>${farCard('main 里被裁掉的金卡会员')}<div class="sp"></div>${farCard('main 里的金卡会员')}</main><div class="sp"></div>${farCard('第二屏的金卡会员')}<p class="pale">第二屏的浅灰字</p><div class="sp"></div><script>scrollTo(0, 30); document.querySelector('main').scrollTop = 20</script></body></html>`)
  // 同一组卡片放首屏、第二屏各一份，结果要一样：85% 透明的黑底（兄弟层）上的浅字不报；吸顶白栏不挡卡片自己的白底（浅灰字照报）；
  // 隐藏的黑装饰层（自己或父层 visibility:hidden）不算；z-index:-1 的黑层画在白卡片底下，上面的浅字照报
  const moreCss = 'body{background:#fff}header{position:sticky;top:0;height:56px;background:#fff}.sp{height:900px}.card{position:relative;height:90px;margin:8px;background:#fff}.card i{position:absolute;inset:0;background:#000}' +
    'p{position:relative;margin:0;padding:8px}.own{position:relative;display:block;margin:8px;background:#fff;color:#ccc;border:0;font-size:15px}' +
    '.sc{position:relative;height:90px;margin:8px}.sc .g{position:absolute;inset:0;scale:.98}.sc .g i{position:absolute;inset:0;background:#000;z-index:10}.sc p{z-index:1;color:#F8FAFC}.tr .g{scale:none;translate:0 2px}' +
    '.cq{container-type:inline-size}.cq i{z-index:-1}.cq p{color:#ccc}.op i{opacity:.85}.op p,.neg p{color:#F8FAFC}.st p{color:#ccc}.hid i,.hid2 b{visibility:hidden}.hid p,.hid2 p{color:#111}.hid2 b{position:absolute;inset:0}.neg i{z-index:-1}'
  const moreSet = '<div class="card op"><i></i><p>透明黑底上的浅色字</p></div><div class="card st"><p>吸顶下的浅灰字</p></div><div class="card hid"><i></i><p>隐藏黑层上的深字</p></div>' +
    '<div class="card hid2"><b><i></i></b><p>父层隐藏的黑层上的深字</p></div><div class="card neg"><i></i><p>负层上的浅色字</p></div><div class="card cq"><i></i><p>查询容器卡片上的浅灰字</p></div>' +
    '<button class="own">自带白底的浅灰按钮</button><div class="sc"><div class="g"><i></i></div><p>缩放组里黑底上的浅色字</p></div><div class="sc tr"><div class="g"><i></i></div><p>平移组里黑底上的浅色字</p></div>'
  fs.writeFileSync(path.join(site, 'card-more.html'), miniHead('层', moreCss) + `<header></header>${moreSet}<div class="sp"></div>${moreSet}</body></html>`)
  // 能滚的深色区域（竖着滚的 main、横着滚的轮播、底色在区域外面的兄弟层上、fixed 的 main）里没滚进来的字：按滚进来以后的底算——浅字不报，深灰字报
  const scCss = 'body{background:#fff}p{margin:0;padding:8px;font-size:15px}.l{color:#F8FAFC}.d{color:#333}.sp{height:500px}' +
    '.m{height:300px;overflow:auto;background:#0F172B}.t{display:flex;overflow-x:auto;background:#0F172B}.t div{flex:0 0 375px;height:120px}' +
    '.shell{position:relative;height:300px;margin-top:20px}.shell i{position:absolute;inset:0;background:#0F172B}.shell .m{position:relative;background:none}' +
    '.sc95{transform:scale(.95);transform-origin:0 0}.zm95{zoom:.95}'
  const two = (k) => `<p class="l">${k}的浅色字</p><p class="d">${k}的深灰字</p>`
  fs.writeFileSync(path.join(site, 'card-scroll.html'), miniHead('滚动区底色', scCss) +
    `<div class="m"><div class="sp"></div>${two('竖滚区')}</div><div class="t"><div></div><div></div><div>${two('轮播')}</div></div><div class="shell"><i></i><div class="m"><div class="sp"></div>${two('外层底')}</div></div>` +
    `<div class="m sc95"><div class="sp"></div>${two('缩放区')}</div><div class="m zm95"><div class="sp"></div>${two('zoom 区')}</div></body></html>`)
  fs.writeFileSync(path.join(site, 'card-scroll-fixed.html'), miniHead('fixed 滚动区', scCss + '.m{position:fixed;inset:0;height:auto}') + `<div class="m"><div class="sp" style="height:1200px"></div>${two('fixed 区')}</div></body></html>`)
  // 看不见的固定深色底（透明度 0、被裁光）不算：浅灰字首屏、第二屏都报
  fs.writeFileSync(path.join(site, 'card-fixed0.html'), miniHead('看不见的固定底', 'body{background:#fff}.bg0{position:fixed;inset:0;background:#0F172B;opacity:0;z-index:-1}.cw{transform:translateZ(0);overflow:hidden;height:0}.cw i{position:fixed;inset:0;background:#0F172B;z-index:-1}p{margin:0;padding:16px;color:#ccc}.sp{height:1200px}') +
    '<div class="bg0"></div><div class="cw"><i></i></div><p>首屏的浅灰字</p><div class="sp"></div><p>第二屏的浅灰字</p></body></html>')
  // 滚动区里没滚进来的卡片，深色底是和字并排的吸顶层（跟着字一起滚进来）：浅字不误报；transform 卡片里的 fixed 底跟着卡片走：浅字不报、深灰字报（首屏、第二屏）
  const pinCss = 'body{background:#fff}p{position:relative;margin:0;padding:8px;font-size:15px}.l{color:#F8FAFC}.d{color:#333}.sp{height:500px}.m{height:300px;overflow:auto}' +
    '.card{position:relative;height:90px}.sbg{display:block;position:sticky;top:0;height:90px;margin-bottom:-90px;background:#0F172B}.tc{position:relative;height:120px;transform:scale(1)}.tc i{position:fixed;inset:0;background:#0F172B}'
  const tcard = '<div class="tc"><i></i><p class="l">变换卡片固定底上的浅色字</p><p class="d">变换卡片固定底上的深灰字</p></div>'
  fs.writeFileSync(path.join(site, 'card-pin.html'), miniHead('吸顶底', pinCss) +
    `<div class="m"><div class="sp"></div><div class="card"><b class="sbg"></b><p class="l">吸顶底上的浅色字</p></div></div>${tcard}<div class="sp" style="height:900px"></div>${tcard}</body></html>`)
  // 通讯录：26 个吸顶分组、每组 20 行，放在能滚的 main 里；同一页去掉吸顶做对照
  let book = ''
  for (let g = 0; g < 26; g++) { book += `<h3>${String.fromCharCode(65 + g)}</h3>`; for (let i = 0; i < 20; i++) book += `<div class="row"><p>联系人 ${g}-${i}</p></div>` }
  const bookCss = 'body{margin:0;background:#fff}main{height:100vh;overflow:auto}h3{position:sticky;top:0;margin:0;padding:4px 12px;background:#f2f2f2;font-size:13px;color:#333}.row{padding:12px;border-bottom:1px solid #eee}p{margin:0;color:#111}'
  fs.writeFileSync(path.join(site, 'book.html'), miniHead('通讯录', bookCss) + `<main>${book}</main></body></html>`)
  fs.writeFileSync(path.join(site, 'book-flat.html'), miniHead('通讯录对照', bookCss + 'h3{position:static}') + `<main>${book}</main></body></html>`)
  // color-scheme 写了 light dark、没写底色：浅色模式下画布是白的（深字不报、胶囊黑的），深色模式下是深的（胶囊白的）
  fs.writeFileSync(path.join(site, 'scheme.html'), miniHead('自动配色', ':root{color-scheme:light dark}p{color:#111}') + '<p>白底上的深色字</p></body></html>')
  fs.writeFileSync(path.join(site, 'card-fixed.html'), miniHead('固定深底', 'body{background:#fff}.bg{position:fixed;inset:0;background:#0F172B;z-index:-1}p{margin:0;padding:16px;color:#F8FAFC}.sp{height:1200px}') +
    '<div class="bg"></div><p>首屏的浅色字</p><div class="sp"></div><p>第二屏的浅色字</p></body></html>')
  fs.writeFileSync(path.join(site, 'mini-oklch-grad.html'), miniHead('oklch 渐变', 'body{background:#fff}header{height:120px;background:linear-gradient(oklch(20% 0.04 265),oklch(26% 0.05 265))}') + '<header></header></body></html>')
  fs.writeFileSync(path.join(site, 'mini-stick.html'), miniHead('伸出', 'body{background:#fff}.p{position:relative;height:10px;opacity:.4}.p div{position:absolute;top:0;left:0;right:0;height:120px;background:#000}') + '<div class="p"><div></div></div></body></html>')
  fs.writeFileSync(path.join(site, 'mini-calc.html'), miniHead('calc', 'body{background:#fff}img{display:block;width:100%;height:200px;object-fit:cover;object-position:right 0px bottom 20px}') + `<img src="${darkSvg}" alt=""></body></html>`)
  fs.writeFileSync(path.join(site, 'mini-meta.html'), miniHead('指定', 'header{height:120px;background:#1F1C17}').replace('</head>', '<meta name="dsh-capsule" content="black"></head>') + '<header></header></body></html>')
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

    // 体检附图：按发现时的尺寸重开，滚到出问题的样子截那一块
    const t1 = Date.now()
    const crops = await cropIssues(b, rows, { screens, dark: false })
    const cropOf = (key) => crops.find((c) => c.key === key)
    const jpgOk = (c) => c && c.jpg && c.jpg[0] === 0xff && c.jpg[1] === 0xd8
    check('真浏览器附图：底栏压住的、App 壳里压住的各截一张（375×667，截被压得最多的那行）', jpgOk(cropOf('home.html')) && cropOf('home.html').type === 'covered' && cropOf('home.html').w === 375 && cropOf('home.html').k.includes('最后一本') && jpgOk(cropOf('shell.html')) && cropOf('shell.html').type === 'covered', JSON.stringify(crops.map((c) => [c.n, c.key, c.type, c.w, c.k])))
    check('真浏览器附图：同一处被压住的上一行（挨着）不另截，算在同一张图里', crops.filter((c) => c.key === 'home.html').length === 1 && cropOf('home.html').ks.length === 2 && cropOf('home.html').ks.some((k) => k.includes('第 12 本')), JSON.stringify(crops.map((c) => c.ks)))
    console.log(`  （附图用了 ${Date.now() - t1}ms）`)

    const shots = await shootAll(b, { screens: screens.slice(0, 2), size: [375, 667], at: 'bottom' })
    const dim = (buf) => { for (let i = 2; i < buf.length - 9;) { const len = buf.readUInt16BE(i + 2); if (buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + len } return null }
    check('真浏览器：截图是 JPEG，按缩放放大（375×667 → 长边约 1568）', shots.length === 2 && shots.every((s) => s.jpg && s.jpg[0] === 0xff && s.jpg[1] === 0xd8) && JSON.stringify(dim(shots[0].jpg)) === '[750,1334]', JSON.stringify(shots.map((s) => [s.error, s.jpg && dim(s.jpg)])))
    const el = await shootAll(b, { screens: screens.slice(0, 1), size: [390, 844], at: 'top', selector: 'nav' })
    check('真浏览器：元素裁剪只截那一块（底栏 390×83，上面留 8px，不伸出视口）', el[0].jpg && JSON.stringify(dim(el[0].jpg)) === JSON.stringify([Math.round(390 * scaleFor(390, 844)), Math.round(91 * scaleFor(390, 844))]), JSON.stringify(el[0].jpg && dim(el[0].jpg)))
    const more = await measureAll(b, { screens: ['clip.html', 'front.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[390, 844]], kind: 'app' })
    const clipRow = more.find((r) => r.key === 'clip.html'), frontRow = more.find((r) => r.key === 'front.html')
    check('真浏览器：被外层裁掉、本来就看不见的字伸到底栏位置，不算压住', clipRow && !clipRow.issues.some((x) => x.type === 'covered'), JSON.stringify(clipRow && clipRow.issues))
    check('真浏览器：画在底栏上面的字不算压住，也不报「压住内容」', frontRow && !frontRow.issues.some((x) => x.type === 'covered') && frontRow.metrics.bars.every((x) => x.gap === null || x.gap >= 0), JSON.stringify(frontRow && [frontRow.issues, frontRow.metrics]))
    const miniScreens = ['mini.html', 'mini-ok.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key }))
    const mp = await measureAll(b, { screens: miniScreens, sizes: [[375, 812]], kind: 'miniprogram' })
    const capOf = (r) => (r ? r.issues.filter((x) => x.type === 'capsule') : [])
    const cap = capOf(mp.find((r) => r.key === 'mini.html'))
    check('真浏览器：小程序顶栏右边的按钮伸进胶囊，报一条（按钮和它的字算一处），说清伸进多少、从哪起空着', cap.length === 1 && cap[0].sev === 2 && cap[0].text === '搜索' && cap[0].px > 30 && cap[0].x === 281 && detailOf(cap[0]).includes('x 281 以右'), JSON.stringify(cap))
    check('真浏览器：按钮放左边、标题居中的不报胶囊', !capOf(mp.find((r) => r.key === 'mini-ok.html')).length, JSON.stringify(mp.find((r) => r.key === 'mini-ok.html')))
    const topOf = (key) => b.withPage({ url: `${entry.origin}/${key}`, w: 375, h: 812 }, (p) => p.eval('window.__dshDesign.info().topDark'))
    const tops = [await topOf('mini-ok.html'), await topOf('mini-dark.html'), await topOf('clean.html')]
    check('真浏览器：胶囊跟着顶栏深浅——绿色顶栏、盖着装饰 SVG 的深色顶栏画白的，白底画黑的', JSON.stringify(tops) === '[true,true,false]', JSON.stringify(tops))
    const drawn = await b.withPage({ url: `${entry.origin}/mini-ok.html`, w: 375, h: 812 }, async (p) => [await p.eval("window.__dshDesign.capsule('solid')"), await p.eval('window.__dshDesign.info().topDark'), (await p.eval("window.__dshDesign.check('miniprogram')")).issues.filter((x) => x.type === 'capsule').length, await p.eval("document.querySelectorAll('dsh-design-fx').length")])
    check('真浏览器：截图用的胶囊画上去（绿顶栏画白的），不影响深浅判断和体检', JSON.stringify(drawn) === '[{"white":true},true,0,1]', JSON.stringify(drawn))
    const edge = await measureAll(b, { screens: ['mini-scroll.html', 'mini-clip.html', 'mini-out.html', 'mini-scale.html', 'mini-zoom.html', 'mini-sticky.html', 'mini-cb.html', 'mini-axis.html', 'mini-cq.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812]], kind: 'miniprogram' })
    const capScroll = capOf(edge.find((r) => r.key === 'mini-scroll.html'))
    check('真浏览器：内部滚动区滚过 200，滚到胶囊下面的按钮不报；没滚时就伸进胶囊的照样报', capScroll.length === 1 && capScroll[0].text === '分享', JSON.stringify(capScroll))
    check('真浏览器：被外层 overflow 裁掉、看不见的按钮不报胶囊', !capOf(edge.find((r) => r.key === 'mini-clip.html')).length, JSON.stringify(edge.find((r) => r.key === 'mini-clip.html')))
    check('真浏览器：绝对定位跳出裁剪那层（那层没定位、只是查询容器）的按钮照样报', capOf(edge.find((r) => r.key === 'mini-out.html')).length === 1 && capOf(edge.find((r) => r.key === 'mini-cq.html')).length === 1, JSON.stringify(edge.filter((r) => /mini-(out|cq)/.test(r.key))))
    const capTexts = (k) => capOf(edge.find((r) => r.key === k)).map((x) => x.text).join(',')
    check('真浏览器：放大两倍（transform、zoom）里滚过的，滚动量按放大后的算：只报真在胶囊里的', capTexts('mini-scale.html') === '分享' && capTexts('mini-zoom.html') === '分享', `${capTexts('mini-scale.html')} / ${capTexts('mini-zoom.html')}`)
    check('真浏览器：吸顶那层被外层裁掉、will-change 当包含块裁掉的不报；只裁横向时竖着露出来的照报', capTexts('mini-sticky.html') === '' && capTexts('mini-cb.html') === '' && capTexts('mini-axis.html') === '搜索', `${capTexts('mini-sticky.html')} / ${capTexts('mini-cb.html')} / ${capTexts('mini-axis.html')}`)
    const tones = []
    for (const k of ['mini-grad.html', 'mini-fade.html', 'mini-img.html', 'mini-meta.html', 'mini-group.html', 'mini-pos.html', 'mini-imgbg.html', 'mini-pe.html', 'mini-stick.html', 'mini-calc.html', 'mini-pei.html', 'mini-pes.html', 'mini-pebody.html', 'mini-pez.html', 'mini-pecl.html', 'mini-pesc.html', 'mini-htmlgrad.html', 'mini-oklch.html', 'mini-oklch-grad.html']) tones.push(await b.withPage({ url: `${entry.origin}/${k}`, w: 375, h: 812 }, async (p) => { await p.eval('window.__dshDesign.settle()'); return p.eval('window.__dshDesign.info().topDark') }))
    check('真浏览器：胶囊深浅——深色渐变白的、白底上 10% 的黑黑的、深色图片白的、页面写了 black 照它；40% 透明组整体算（浅）、图片顶对齐露白的、透明图片的黑底算上；不可点的黑底、伸出透明父框的黑子层（浅）、calc 位置的黑图；样式表里、行内写了 !important 的不可点黑底，body 上的也算；它上面盖着更高的白顶栏时按白的；被裁掉的、层叠上下文里出不来的黑底不算，html 渐变上 body 的白底照算；oklch 写的深色顶栏、oklch 渐变白的', JSON.stringify(tones) === '[true,false,true,false,false,false,true,true,false,true,true,true,true,false,false,false,false,true,true]', JSON.stringify(tones))
    const ok = await measureAll(b, { screens: [{ key: 'mini-oklch.html', url: `${entry.origin}/mini-oklch.html`, label: 'oklch' }], sizes: [[375, 812]], kind: 'miniprogram' })
    const pale = ok[0] && ok[0].issues.find((x) => x.type === 'contrast')
    const card = await measureAll(b, { screens: [{ key: 'card-pe.html', url: `${entry.origin}/card-pe.html`, label: '卡' }], sizes: [[375, 812]], kind: 'app' })
    const cardAfter = await b.withPage({ url: `${entry.origin}/card-pe.html`, w: 375, h: 812 }, (p) => p.eval("(async () => { await window.__dshDesign.check('app'); return [document.adoptedStyleSheets.length, getComputedStyle(document.querySelector('.bg')).pointerEvents] })()"))
    check('真浏览器：不可点的深色卡片底上的浅色字（oklch、rgb）不报对比度；量完临时样式撤掉', card[0] && !card[0].issues.some((x) => x.type === 'contrast') && JSON.stringify(cardAfter) === '[0,"none"]', JSON.stringify([card[0] && card[0].issues, cardAfter]))
    const op = await measureAll(b, { screens: [{ key: 'card-op.html', url: `${entry.origin}/card-op.html`, label: '透明' }], sizes: [[375, 812]], kind: 'app' })
    const opLow = op[0] ? op[0].issues.filter((x) => x.type === 'contrast').map((x) => x.text) : null
    check('真浏览器：背景层的透明度按组算——12% 黑装饰底上的深字不报，深卡片 8% 白蒙层下的深灰字报；整个透明的渐变 / 图片装饰层不算（白底浅灰字照报，首屏、第二屏）', JSON.stringify(opLow && [...opLow].sort()) === JSON.stringify(['深底上的深灰字', '隐藏渐变层上的浅灰字', '隐藏图片层上的浅灰字'].sort()), JSON.stringify(op[0] && op[0].issues))
    const far = await b.withPage({ url: `${entry.origin}/card-far.html`, w: 375, h: 812 }, (p) => p.eval("(async () => { await window.__dshDesign.settle(); const r = (await window.__dshDesign.check('app')).issues; return [r.filter((x) => x.type === 'contrast').map((x) => [x.text, x.rect && x.rect.y]), scrollY, document.querySelector('main').scrollTop] })()"))
    const farOk = far && far[0].length === 1 && far[0][0][0] === '第二屏的浅灰字' && far[0][0][1] > 1300 && far[1] === 30 && far[2] === 20
    check('真浏览器：屏幕外（第二屏、能滚的 main 里、main 里被裁掉的）深色卡片浅色字不报，第二屏的浅灰字照报、记的是页面位置；量的时候不滚页面', farOk, JSON.stringify(far))
    const layers = await measureAll(b, { screens: [{ key: 'card-more.html', url: `${entry.origin}/card-more.html`, label: '层' }], sizes: [[375, 812]], kind: 'miniprogram' })
    const moreLow = layers[0] ? layers[0].issues.filter((x) => x.type === 'contrast').map((x) => `${x.text}@${x.rect.y > 812 ? 2 : 1}`).sort() : null
    check('真浏览器：首屏、第二屏结果一样——半透明兄弟黑底上的浅字不报、吸顶栏下卡片的浅灰字报、隐藏的黑层不算、负 z-index 黑层在白卡片底下（浅字报）；自带白底的浅灰按钮在吸顶栏下也报；单独写 scale / translate 的组建层叠上下文（组里 z-index:10 的黑底出不来，浅字不报）；container-type 不建上下文（z-index:-1 黑层照样在白卡片底下）', JSON.stringify(moreLow) === '["吸顶下的浅灰字@1","吸顶下的浅灰字@2","查询容器卡片上的浅灰字@1","查询容器卡片上的浅灰字@2","自带白底的浅灰按钮@1","自带白底的浅灰按钮@2","负层上的浅色字@1","负层上的浅色字@2"]', JSON.stringify(layers[0] && layers[0].issues))
    const scr = await measureAll(b, { screens: ['card-scroll.html', 'card-scroll-fixed.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812]], kind: 'app' })
    const scrLow = scr.map((r) => r.issues.filter((x) => x.type === 'contrast').map((x) => x.text).sort().join(','))
    check('真浏览器：能滚的深色区域里没滚进来的字按区域的底算（竖滚 main、横滑轮播、底在区域外面的兄弟层、fixed 的 main、整体缩放 / zoom 的）：浅字不报、深灰字报', JSON.stringify(scrLow) === JSON.stringify([['外层底的深灰字', '竖滚区的深灰字', '缩放区的深灰字', '轮播的深灰字', 'zoom 区的深灰字'].sort().join(','), 'fixed 区的深灰字']), JSON.stringify(scr.map((r) => r.issues)))
    const fixedBg = await measureAll(b, { screens: [{ key: 'card-fixed.html', url: `${entry.origin}/card-fixed.html`, label: '固定' }], sizes: [[375, 812]], kind: 'app' })
    const pinPg = await measureAll(b, { screens: [{ key: 'card-pin.html', url: `${entry.origin}/card-pin.html`, label: '吸顶底' }], sizes: [[375, 812]], kind: 'app' })
    const pinLow = pinPg[0] ? pinPg[0].issues.filter((x) => x.type === 'contrast').map((x) => `${x.text}@${x.rect.y > 812 ? 2 : 1}`).sort().join(',') : ''
    check('真浏览器：滚动区里和字并排的吸顶深色底（跟着字滚进来）不误报；transform 卡片里的 fixed 底跟着卡片算——浅字不报、深灰字报', pinLow === '变换卡片固定底上的深灰字@1,变换卡片固定底上的深灰字@2', JSON.stringify(pinPg[0] && pinPg[0].issues))
    const timeOf = (k) => b.withPage({ url: `${entry.origin}/${k}`, w: 375, h: 812 }, (p) => p.eval("(async () => { await window.__dshDesign.settle(); const ts = []; let r; for (let i = 0; i < 5; i++) { const t = performance.now(); r = await window.__dshDesign.check('app'); ts.push(performance.now() - t) } ts.sort((a, b) => a - b); return [ts[2], r.issues.filter((x) => x.type === 'contrast').length] })()"))
    const [bookT, flatT] = [await timeOf('book.html'), await timeOf('book-flat.html')]
    check('真浏览器：一屏外全是吸顶分组的通讯录，体检不比没吸顶的慢太多（叠放顺序量过记着），也不误报', bookT[0] < flatT[0] * 3 + 20 && bookT[1] === 0, JSON.stringify({ sticky: bookT, flat: flatT }))
    const sch = await measureAll(b, { screens: [{ key: 'scheme.html', url: `${entry.origin}/scheme.html`, label: '自动' }], sizes: [[375, 812]], kind: 'miniprogram' })
    const schTop = async (dark) => b.withPage({ url: `${entry.origin}/scheme.html`, w: 375, h: 812, dark }, async (p) => { await p.eval('window.__dshDesign.settle()'); return p.eval('window.__dshDesign.info().topDark') })
    const schTops = [await schTop(false), await schTop(true)]
    check('真浏览器：color-scheme 写了 light dark——浅色模式按白画布（深字不报、胶囊黑），深色模式按深画布（胶囊白）', sch[0] && !sch[0].issues.some((x) => x.type === 'contrast') && JSON.stringify(schTops) === '[false,true]', JSON.stringify([sch[0] && sch[0].issues, schTops]))
    const fixed0 = await measureAll(b, { screens: [{ key: 'card-fixed0.html', url: `${entry.origin}/card-fixed0.html`, label: '固定0' }], sizes: [[375, 812]], kind: 'miniprogram' })
    const f0 = fixed0[0] ? fixed0[0].issues.filter((x) => x.type === 'contrast').map((x) => x.text).sort().join(',') : ''
    check('真浏览器：透明度 0、被裁光的固定深色底不算——白底浅灰字首屏、第二屏都报', f0 === '第二屏的浅灰字,首屏的浅灰字', JSON.stringify(fixed0[0] && fixed0[0].issues))
    check('真浏览器：整页固定定位深色底上的浅色字（首屏、第二屏）都不报', fixedBg[0] && !fixedBg[0].issues.some((x) => x.type === 'contrast'), JSON.stringify(fixedBg[0] && fixedBg[0].issues))
    check('真浏览器：oklch 写的浅灰字也查对比度（换成 sRGB 算）', pale && pale.text === '浅灰色的说明文字' && pale.ratio < 2 && /^#[0-9A-F]{6}$/.test(pale.fg), JSON.stringify(ok[0] && ok[0].issues))
    // 量完原样还回去：样式表不累积，装饰层还是点不着（点击落在下面的按钮上），行内 style 一字不差
    const after = await b.withPage({ url: `${entry.origin}/mini-pes.html`, w: 375, h: 812 }, (p) => p.eval(`(() => { const st = document.querySelector('.bg').getAttribute('style'); return new Promise((r) => setTimeout(() => { window.__muts = 0; for (let i = 0; i < 5; i++) window.__dshDesign.info(); setTimeout(() => r([document.adoptedStyleSheets.length, document.elementFromPoint(100, 230).tagName, document.querySelector('.bg').getAttribute('style') === st, window.__muts]), 50) }, 100)) })()`))
    const noAttr = await b.withPage({ url: `${entry.origin}/mini-pei.html`, w: 375, h: 812 }, (p) => p.eval("(() => { window.__dshDesign.info(); return document.querySelector('.bg').hasAttribute('style') })()"))
    check('真浏览器：量胶囊深浅不碰页面——样式表不累积、盖在按钮上的装饰层还是点不着、行内 style 原样、页面的 MutationObserver 一条都没收到、没有的 style 属性不会多出来', JSON.stringify(after) === '[0,"BUTTON",true,0]' && noAttr === false, JSON.stringify([after, noAttr]))
    const asApp = await measureAll(b, { screens: miniScreens.slice(0, 1), sizes: [[375, 812]], kind: 'app' })
    check('真浏览器：同一页按 App 量不报胶囊', !capOf(asApp[0]).length, JSON.stringify(asApp[0].issues))
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
    const negLocate = (items) => items.map((it) => { const f = decodeURIComponent(new URL(it.href).pathname.slice(1)); return { file: f, line: findRule(fs.readFileSync(path.join(site, f), 'utf8'), it.sel, it.n) } })
    const neg = await measureAll(b, { screens: [{ key: 'neg.html', url: `${entry.origin}/neg.html`, label: 'neg' }, { key: 'over.html', url: `${entry.origin}/over.html`, label: 'over' }], sizes: [[390, 844]], kind: 'app', locate: negLocate })
    const negOv = neg[0].issues.find((x) => x.type === 'overlap'), absOv = neg[1].issues.find((x) => x.type === 'overlap')
    check('真浏览器：叠字找到原因——价格行的负 margin，规则在 neg.css 第 3 行', negOv && negOv.cause && negOv.cause.prop === 'margin-top' && negOv.cause.value === '-24px' && /div\.row/.test(negOv.cause.sel) && negOv.rule && negOv.rule.sel === '.row' && negOv.rule.file === 'neg.css' && negOv.rule.line === 3, JSON.stringify(negOv))
    check('真浏览器：叠字找到原因——价格是绝对定位；量出叠了多少 px', absOv && absOv.px > 0 && absOv.cause && absOv.cause.prop === 'position' && absOv.cause.value === 'absolute' && /price/.test(absOv.cause.sel), JSON.stringify(absOv))
    const overScreens = [{ key: 'over.html', url: `${entry.origin}/over.html`, label: 'over' }]
    for (const dk of [false, true]) {
      const ov = await measureAll(b, { screens: overScreens, sizes: [[390, 844]], kind: 'app', dark: dk })
      const oc = await cropIssues(b, ov, { screens: overScreens, dark: dk })
      const ojpg = oc[0] && oc[0].jpg
      // 裁剪范围按整页坐标（卡片在 900px 往下，要先滚过去）；至少 320 宽：390 宽的屏 × 1.86 倍
      check(`真浏览器附图：叠在一起的两个元素截一张，说得出谁在上面（滚到卡片那儿${dk ? '，深色' : ''}）`, ov[0].issues.some((x) => x.type === 'overlap') && oc.length >= 1 && oc[0].type === 'overlap' && ['self', 'other'].includes(oc[0].upper) && ojpg && ojpg[0] === 0xff && ojpg.length > 3000 && ojpg.readUInt16BE(0) === 0xffd8, JSON.stringify([ov[0].issues.map((x) => x.type), oc.map((c) => [c.type, c.jpg && c.jpg.length])]))
    }
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
