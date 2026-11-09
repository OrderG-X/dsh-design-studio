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
import { autoSize, fitSize, parseMeta, sizeOf, designOf, metaOfFile, pickScreens, scaleFor, formatMeasure, issueSnapshot, formatShots, detailOf, measureAll, shootAll, pickCrops, cropIssues } from '../lib/look.js'
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
check('画幅探测：幻灯片比默认大就按页面', autoSize([[1440, 810]], 'slides') === '1440x810' && autoSize([[1280, 720]], 'slides') === '' && autoSize([null, [1440, 810], [1200, 700]], 'slides') === '1440x810' && autoSize([[1440, 650]], 'slides') === '1440x650' && autoSize([null, [1440, 650]], 'slides') === '1440x720')
check('画幅探测：几页竖着堆的、比例不像一页的不算；只管幻灯片和海报', autoSize([[1440, 2430]], 'slides') === '' && autoSize([[1440, 810]], 'web') === '' && autoSize([[1080, 1920]], 'poster') === '1080x1920' && autoSize([[1080, 2700]], 'poster') === '' && autoSize([[9000, 5000]], 'slides') === '' && autoSize([['a', 1]], 'slides') === '')
check('画幅探测：写了尺寸的不量', !designOf({}, () => 'slides 1440x810').auto && !designOf({ size: '1600x900' }, () => 'slides').auto && designOf({}, () => 'slides').auto === true && !designOf({}, () => 'app').auto)
{
  const fake = (natural) => ({ withPage: async (o, fn) => fn({ eval: async () => ({ natural }) }) })
  check('画幅探测：量到了按量的，量不到还是默认', (await fitSize(fake([1440, 810]), [{ url: 'a' }], 'slides', [1280, 720])).join('x') === '1440x810' && (await fitSize(fake(null), [{ url: 'a' }], 'slides', [1280, 720])).join('x') === '1280x720' && (await fitSize({ withPage: async () => { throw new Error('x') } }, [{ url: 'a' }], 'slides', [1280, 720])).join('x') === '1280x720')
}
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
  // 手机的规矩：灵动岛、底部横条区、标签栏项数、小程序导航栏
  const phHead = (title, css) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:15px/1.4 sans-serif;background:#fff;color:#111}` +
    `.sb{height:44px;display:flex;justify-content:space-between;align-items:center;padding:0 24px;font-size:15px}.nv{height:44px;display:flex;align-items:center;justify-content:center;font-size:17px}` +
    `main{padding:16px 16px 140px}main p{margin:0 0 12px}.tb{position:fixed;left:0;right:0;bottom:0;display:flex;background:#fafafa;border-top:1px solid #eee}.tb a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;color:#333;text-decoration:none;padding-top:6px}.tb svg{width:24px;height:24px}${css}</style></head><body>`
  const icon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#999"/></svg>'
  const tabs = (names) => names.map((n) => `<a href="#">${icon}<span>${n}</span></a>`).join('')
  const body = '<main>' + Array.from({ length: 6 }, (_, i) => `<p>第 ${i + 1} 行内容</p>`).join('') + '</main>'
  fs.writeFileSync(path.join(site, 'ph-ok.html'), phHead('合规', '.tb{height:84px;padding-bottom:34px;box-sizing:border-box}.tb i{position:absolute;left:10px;top:0;width:20px;height:2px;background:#c00}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">首页</div>${body}<nav class="tb"><i></i>${tabs(['首页', '分类', '购物车', '我的'])}</nav></body></html>`)
  fs.writeFileSync(path.join(site, 'ph-bad.html'), phHead('不合规', '.sb{justify-content:center}.tb{height:56px}') +
    `<div class="sb"><b>9:41</b></div><div class="nv">首页</div>${body}<nav class="tb">${tabs(['首页', '分类', '发现', '消息', '购物车', '我的'])}</nav></body></html>`)
  // 审查补的几种：页面壳（body 撑满一屏、底栏在普通流里）、一排 6 个操作按钮、多行截断藏起来的字、伪元素图标、行内元素的 overflow
  fs.writeFileSync(path.join(site, 'ph-shell.html'), phHead('页面壳', 'body{height:100vh;display:flex;flex-direction:column}main{flex:1;overflow:auto}.tabs{display:flex;height:56px;background:#fafafa}.tabs a{flex:1;display:flex;flex-direction:column;align-items:center;font-size:11px;color:#333;text-decoration:none;padding-top:6px}.tabs a.on{color:#c00}.tabs svg{width:24px;height:24px}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">首页</div>${body.replace('<main>', '<main>' + body.slice(6, -7).repeat(4))}<div class="tabs">${tabs(['首页', '分类', '发现', '消息', '购物车', '我的']).replace('<a href="#">', '<a class="on">').replace(/<a href="#">/g, '<a>')}</div></body></html>`)
  fs.writeFileSync(path.join(site, 'ph-tools.html'), phHead('操作按钮', '.tl{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;display:flex;background:#222}.tl button{flex:1;border:0;background:none;color:#fff;font-size:11px;display:flex;flex-direction:column;align-items:center;gap:2px}.tl svg{width:24px;height:24px}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">编辑图片</div>${body}<div class="tl">${['裁剪', '旋转', '滤镜', '调色', '贴纸', '文字'].map((n) => `<button>${icon}<span>${n}</span></button>`).join('')}</div></body></html>`)
  fs.writeFileSync(path.join(site, 'ph-clamp.html'), phHead('多行截断', '.ft{position:fixed;left:0;right:0;bottom:0;height:84px;padding:6px 16px 34px;box-sizing:border-box;background:#fafafa}.ft p{margin:0;font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">协议</div>${body}<div class="ft"><p>${'继续即表示你同意用户协议和隐私政策，'.repeat(8)}</p></div></body></html>`)
  fs.writeFileSync(path.join(site, 'ph-pseudo.html'), phHead('伪元素图标', '.bb{position:fixed;left:0;right:0;bottom:0;height:56px;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 16px 4px;box-sizing:border-box;background:#fafafa}.bb button{width:44px;height:44px;border:0;background:none;padding:10px}.bb button::before{content:"★";font-size:22px;line-height:24px;display:block}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">详情</div>${body}<div class="bb"><button aria-label="收藏"></button></div></body></html>`)
  fs.writeFileSync(path.join(site, 'ph-inline.html'), phHead('行内截断', '.nv{justify-content:flex-start;padding-left:16px}.nv span{overflow:hidden;white-space:nowrap}') +
    `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv"><span>邻里鲜社区团购·今日特价专场一直写到右边</span></div>${body}</body></html>`)
  // 复查补的：选中态的工具栏、只改图标颜色的标签栏、徽标和遮罩、往下伸的伪元素、页面末尾的商品轮播、收到屏幕下面的面板
  const bot = (css) => `.ft{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;display:flex;background:#fafafa}.ft>*{flex:1;display:flex;flex-direction:column;align-items:center;font-size:11px;color:#333;padding-top:6px}.ft svg{width:24px;height:24px}${css}`
  const cells = (names, cls = '', on = 0) => names.map((n, i) => `<div class="${cls}${i === on ? ' active' : ''}">${icon}<span>${n}</span></div>`).join('')
  const phPage = (key, title, css, inner) => fs.writeFileSync(path.join(site, key), phHead(title, css) + `<div class="sb"><b>9:41</b><span>●●● ▮</span></div><div class="nv">${title}</div>${body}${inner}</body></html>`)
  phPage('ph-tools-on.html', '编辑图片', bot('.ft>.active{color:#c00}'), `<nav class="ft">${cells(['裁剪', '旋转', '滤镜', '调色', '贴纸', '文字'])}</nav>`)
  phPage('ph-tab-class.html', '精选', bot('.ft .tab-item.active svg circle{fill:#c00}') + '.tab-bar{flex:1;display:flex;flex-direction:row!important;padding:0!important}.tab-bar>*{flex:1;display:flex;flex-direction:column;align-items:center}',
    `<div class="ft"><div class="tab-bar">${cells(['精选', '好物', '优惠', '新品', '榜单', '店铺'], 'tab-item')}</div></div>`)
  phPage('ph-tab-words.html', '首页', bot('.ft>div:first-child svg circle{fill:#c00}'), `<div class="ft">${cells(['首页', '分类', '发现', '消息', '购物车', '我的'], 'it', -1)}</div>`)
  phPage('ph-badge.html', '详情', bot('.ft>div{position:relative}.ft>div::after{content:"3";position:absolute;right:20px;top:0;min-width:16px;height:16px;font-size:10px;line-height:16px;text-align:center;border-radius:8px;background:#c00;color:#fff}.ft::before{content:" ";position:absolute;left:0;right:0;bottom:0;height:40px;background:linear-gradient(transparent,#fafafa)}'),
    `<div class="ft">${cells(['客服', '店铺', '购物车'], 'it', -1)}</div>`)
  phPage('ph-pseudo-down.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:90px;background:#fafafa}.bb button{position:relative;width:44px;height:44px;margin:4px 16px;border:0;background:none}.bb button::before{content:"★";position:absolute;left:10px;top:44px;font-size:22px;line-height:24px}',
    '<div class="bb"><button aria-label="收藏"></button></div>')
  phPage('ph-carousel.html', '商城', 'body{height:100vh;display:flex;flex-direction:column}main{flex:1;overflow:auto;padding-bottom:0}.like{height:120px;padding:0 0 34px;box-sizing:content-box;display:flex;gap:8px;overflow-x:auto;background:#f5f5f5}.like a{flex:0 0 110px;display:flex;flex-direction:column;align-items:center;font-size:12px;color:#333;text-decoration:none}.like svg{width:80px;height:80px}',
    `<section class="like">${['卫衣', '球鞋', '耳机', '水杯', '台灯', '背包'].map((n) => `<a href="#">${icon}<span>${n}</span></a>`).join('')}</section>`)
  phPage('ph-sheet.html', '文章', bot('.ft>div{position:static}.sheet{position:absolute;left:0;right:0;top:0;height:200px;transform:translateY(130%);background:#fff;display:flex;flex-direction:row!important;gap:16px;padding:16px}'),
    `<div class="ft">${cells(['点赞', '评论', '分享'], 'it', -1)}<div class="sheet"><span>微信好友</span><span>朋友圈</span><span>复制链接</span></div></div>`)
  // 第三轮：写明了的导航 / 工具栏压过词表、字符图标、负边距的一排、伪元素自己的 transform、flex 里挨着字的伪元素
  const links = (names) => names.map((n) => `<a href="#">${icon}<span>${n}</span></a>`).join('')
  phPage('ph-nav-toolwords.html', '首页', bot('.ft>a{text-decoration:none}'), `<div class="ft tabbar">${links(['首页', '模板', '相册', '音乐', '收藏', '我的'])}</div>`)
  phPage('ph-toolbar-role.html', '插入素材', bot('.ft>button{border:0;background:none}'), `<div class="ft" role="toolbar">${['视频', '图片', '音频', '文字', '素材', '收藏'].map((n) => `<button>${icon}<span>${n}</span></button>`).join('')}</div>`)
  phPage('ph-tools-glyph.html', '编辑图片', bot('.ft>.active{color:#c00}'), `<div class="ft">${['✂ 裁剪', '↻ 旋转', '◐ 滤镜', '◑ 调色', '☺ 贴纸', 'T 文字'].map((n, i) => `<div class="${i ? '' : 'active'}"><span>${n}</span></div>`).join('')}</div>`)
  phPage('ph-negmargin.html', '首页', bot('.ft{display:block}.ft>.row{display:flex;flex-direction:row;margin:0 -8px;padding:0!important;overflow-x:clip}.row>div{flex:1;padding:6px 8px 0;display:flex;flex-direction:column;align-items:center}.row>.active{color:#c00}'),
    `<div class="ft"><div class="row">${cells(['首页', '精选', '好物', '店铺', '消息', '我的'])}</div></div>`)
  phPage('ph-pseudo-xf.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;background:#fafafa}.bb button{position:absolute;left:50%;top:0;width:60px;height:50px;margin-left:-30px;border:0;background:none}.bb button::before{content:"★";position:absolute;left:50%;top:50%;width:32px;height:32px;font-size:28px;line-height:32px;transform:translate(-50%,-50%)}',
    '<div class="bb"><button aria-label="收藏"></button></div>')
  phPage('ph-pseudo-flex.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:90px;background:#fafafa}.bb button{width:100%;height:90px;border:0;background:none;display:flex;flex-direction:column;justify-content:center;align-items:center;font-size:15px;line-height:21px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button>展开更多</button></div>')
  phPage('ph-pseudo-end.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:60px;background:#fafafa}.bb button{width:60px;height:60px;border:0;background:none;display:flex;align-items:flex-end;justify-content:center;padding:0}.bb button::before{content:"★";font-size:22px;line-height:24px}',
    '<div class="bb"><button aria-label="收藏"></button></div>')
  // 第四轮：项自己叫 tools、套了一层的 role=toolbar、占位链接做的操作、space-between 和行高撑开的伪元素
  phPage('ph-nav-toolsid.html', '首页', bot('.ft>div.on{color:#c00}'), `<div class="ft" role="tablist">${['首页', '工具', '资源', '社区', '消息', '我的'].map((n, i) => `<div role="tab"${i === 1 ? ' class="tools" id="tab-tools"' : i ? '' : ' class="on"'}>${icon}<span>${n}</span></div>`).join('')}</div>`)
  phPage('ph-toolbar-nested.html', '编辑图片', bot('.ft>section{display:block!important;padding:0!important}.tabs{display:flex}.tabs>button{flex:1;border:0;background:none;display:flex;flex-direction:column;align-items:center;font-size:11px}'),
    `<footer class="ft"><section role="toolbar"><div class="tabs">${['裁剪', '旋转', '滤镜', '调色', '贴纸', '文字'].map((n) => `<button>${icon}<span>${n}</span></button>`).join('')}</div></section></footer>`)
  phPage('ph-tools-links.html', '编辑图片', bot('.ft>a{text-decoration:none}.ft>a.on{color:#c00}'), `<div class="ft">${['裁剪', '旋转', '滤镜', '调色', '贴纸', '文字'].map((n, i) => `<a href="#"${i ? '' : ' class="on"'} onclick="return false">${icon}<span>${n}</span></a>`).join('')}</div>`)
  phPage('ph-pseudo-between.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:90px;background:#fafafa}.bb button{width:100%;height:90px;border:0;background:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:0;font-size:15px;line-height:21px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button>展开更多</button></div>')
  phPage('ph-pseudo-lh.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:100px;background:#fafafa}.bb button{width:100%;height:100px;border:0;background:none;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0;font-size:15px;line-height:40px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button>展开更多</button></div>')
  // 第五轮：#/ 路由的链接、放不下时的 space-between、子项带外边距的 space-around
  phPage('ph-nav-hash.html', '首页', bot('.ft>a{text-decoration:none}.ft>a:first-child{color:#c00}'), `<div class="ft">${['首页', '模板', '相册', '音乐', '收藏', '我的'].map((n, i) => `<a href="#/page/${i}">${icon}<span>${n}</span></a>`).join('')}</div>`)
  phPage('ph-pseudo-tight.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:86px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{width:100%;height:52px;border:0;background:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:8px 0;box-sizing:border-box;font-size:15px;line-height:32px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px;flex:none}.bb span{flex:none}',
    '<div class="bb"><button><span>展开更多</span></button></div>')
  phPage('ph-pseudo-around.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:120px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{width:100%;height:86px;border:0;background:none;display:flex;flex-direction:column;justify-content:space-around;align-items:center;padding:0;font-size:15px;line-height:21px}.bb span{margin-top:8px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button><span>展开更多</span></button></div>')
  // 第六轮：前后两个伪元素一起排、块布局里外边距合并
  phPage('ph-pseudo-both.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:120px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{width:100%;height:86px;border:0;background:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:0;font-size:15px;line-height:21px}.bb button::before{content:"☰";font-size:20px;line-height:24px;height:24px}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button>展开更多</button></div>')
  phPage('ph-pseudo-block.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:120px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.more{height:86px;padding-top:30px;box-sizing:border-box;text-align:center;font-size:15px}.more span{display:block;line-height:21px;margin-bottom:12px}.more::after{content:"⌄";display:block;font-size:20px;line-height:24px;height:24px;margin-top:12px}',
    '<div class="bb"><div class="more" role="button"><span>展开更多</span></div></div>')
  // 第七轮：行内块的外边距不合并、只有边框的伪元素分隔线（高 0）
  phPage('ph-pseudo-ib.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:90px;background:#fafafa}.more{height:90px;padding-top:20px;box-sizing:border-box;text-align:center;font-size:15px}.more span{display:inline-block;line-height:21px;margin-bottom:12px}.more::after{content:"⌄";display:block;font-size:20px;line-height:24px;height:24px;margin-top:12px}',
    '<div class="bb"><div class="more" role="button"><span>展开更多</span></div></div>')
  phPage('ph-pseudo-line.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:110px;padding-bottom:20px;box-sizing:border-box;background:#fafafa}.bb button{width:100%;height:90px;border:0;background:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:0;font-size:15px;line-height:21px}.bb button::before{content:"";width:40px;border-top:1px solid #ccc}.bb button::after{content:"⌄";font-size:20px;line-height:24px;height:24px}',
    '<div class="bb"><button>展开更多</button></div>')
  // 第八轮：普通行内 span 的上下外边距不起作用
  phPage('ph-pseudo-inline.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:94px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.more{height:60px;text-align:center;font-size:15px;line-height:20px}.more span{margin-bottom:16px}.more::after{content:"⌄";display:block;font-size:20px;line-height:24px;height:24px;margin-top:16px}',
    '<div class="bb"><div class="more" role="button"><span>展开更多</span></div></div>')
  phPage('ph-pseudo-strut.html', '列表', '.bb{position:fixed;left:0;right:0;bottom:0;height:94px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.more{height:60px;text-align:center;font-size:15px;line-height:32px}.more span{line-height:20px;margin-bottom:16px}.more::after{content:"⌄";display:block;font-size:20px;line-height:24px;height:24px;margin-top:16px}',
    '<div class="bb"><div class="more" role="button"><span>展开更多</span></div></div>')
  // 第十轮：父子外边距合并的块里的伪元素、行里底对齐的小字后面的块级箭头（按样式推不准，无头体检问浏览器要真实框）
  phPage('ph-pseudo-collapse.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:86px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.btn{height:52px}.btn span{display:block;line-height:20px}.ic::before{content:"★";display:block;height:24px;line-height:24px;margin-top:8px}',
    '<div class="bb"><div class="btn" role="button"><span>收藏</span><div class="ic"></div></div></div>')
  phPage('ph-pseudo-valign.html', '付款', '.bb{position:fixed;left:0;right:0;bottom:0;height:110px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.pay{height:76px;font-size:15px;line-height:40px}.pay .d{vertical-align:bottom;line-height:20px;font-size:12px}.pay::after{content:"⌄";display:block;height:24px;line-height:24px;margin-top:12px}',
    '<div class="bb"><div class="pay"><span>¥99</span> <span class="d">明细</span></div></div>')
  // 第十一轮：按钮自己 overflow:hidden 藏起来的伪元素
  phPage('ph-pseudo-hidden.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;overflow:hidden;width:50px;height:50px;border:0;background:none}.bb button::before{content:"♡";position:absolute;left:9px;top:9px;font-size:28px;line-height:32px}.bb button::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}',
    '<div class="bb"><button aria-label="收藏"></button></div>')
  // 第十二轮：伪元素绝对定位到按钮，中间有一层 overflow:hidden（不包它，不裁它）；overflow:clip 带 clip-margin
  phPage('ph-pseudo-skip.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;width:50px;height:50px;border:0;background:none;padding:0}.bb .clip{display:block;overflow:hidden;width:50px;height:50px}.bb i::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}',
    '<div class="bb"><button aria-label="收藏"><span class="clip"><i></i></span></button></div>')
  phPage('ph-pseudo-clipmargin.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;overflow:clip;overflow-clip-margin:32px;width:50px;height:50px;border:0;background:none}.bb button::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}',
    '<div class="bb"><button aria-label="收藏"></button></div>')
  // 第十三轮：中间层的 clip-path、will-change: contain，overflow-clip-margin 带参考盒
  phPage('ph-pseudo-clippath.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;width:50px;height:50px;border:0;background:none;padding:0}.bb i::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}.bb .clip{display:block;overflow:hidden;clip-path:inset(0);width:50px;height:50px}', '<div class="bb"><button aria-label="收藏"><span class="clip"><i></i></span></button></div>')
  phPage('ph-pseudo-wcontain.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;width:50px;height:50px;border:0;background:none;padding:0}.bb i::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}.bb .clip{display:block;overflow:hidden;will-change:contain;width:50px;height:50px}', '<div class="bb"><button aria-label="收藏"><span class="clip"><i></i></span></button></div>')
  phPage('ph-pseudo-ocmbox.html', '详情', '.bb{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;background:#fafafa}.bb button{position:relative;overflow:clip;overflow-clip-margin:border-box 32px;width:50px;height:50px;border:0;background:none}.bb button::after{content:"♥";position:absolute;left:9px;top:50px;width:32px;height:32px;font-size:28px;line-height:32px;color:#c00}', '<div class="bb"><button aria-label="收藏"></button></div>')
  // 桌面软件：Mac 红绿灯在左上、Windows 三个按钮在右上
  const dkHead = (title, meta, css) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="dsh-design" content="${meta}"><style>body{margin:0;font:13px/1.4 -apple-system,sans-serif;background:#fff;color:#111;height:100vh;display:flex}aside{width:240px;background:#f2f2f4}.tb{height:52px;display:flex;align-items:center;gap:8px;padding:0 12px}${css}</style></head><body>`
  fs.writeFileSync(path.join(site, 'dk-ok.html'), dkHead('Mac 合规', 'desktop', 'aside .tb{padding-left:84px}') + '<aside><div class="tb"><button>新建</button></div><p>收件箱</p></aside><main><div class="tb"><b>收件箱</b></div></main></body></html>')
  fs.writeFileSync(path.join(site, 'dk-bad.html'), dkHead('Mac 挡住', 'desktop', '') + '<aside><div class="tb"><b>邮件</b><button>新建</button></div></aside><main><div class="tb"><b>收件箱</b></div></main></body></html>')
  fs.writeFileSync(path.join(site, 'dk-win.html'), dkHead('Windows 挡住', 'desktop windows', 'main{flex:1;background:#1f1f24;color:#fff}main .tb{justify-content:flex-end;height:32px;padding:0 4px}') + '<aside><div class="tb"><b>邮件</b><button>新建</button></div></aside><main><div class="tb"><button>设置</button></div></main></body></html>')
  fs.writeFileSync(path.join(site, 'ph-nonav.html'), phHead('没导航栏', 'main{padding-top:120px}') + `<div class="sb"><b>9:41</b><span>●●● ▮</span></div>${body}</body></html>`)
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
  // 画幅探测：写死尺寸的一整块、写在 body 上的、居中溢出的、默认 margin；自适应、几页竖着堆、只有装饰往外撑的都不算
  const stage = (name, css, body) => fs.writeFileSync(path.join(site, name), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><meta name="dsh-design" content="slides"><style>${css}</style></head><body>${body}</body></html>`)
  stage('st-fixed.html', 'body{margin:0}.s{width:1440px;height:810px;background:#123}', '<div class="s"></div>')
  stage('st-layer2.html', 'body{margin:0}@layer a{.s{width:1440px!important;height:810px!important;background:#123}}.s{width:100vw!important;height:100vh!important}', '<div class="s"></div>')
  stage('st-layer3.html', 'body{margin:0}@layer a,b;@layer b{.s{width:1440px;height:810px;background:#123}}@layer a{.s{width:100vw;height:100vh}}', '<div class="s"></div>')
  stage('st-cont.html', 'body{margin:0}.s{width:1440px;height:810px;background:#123}@container (min-width:99999px){.s{width:100vw;height:100vh}}', '<div class="s"></div>')
  stage('st-hmin.html', 'body{margin:0}.s{width:1440px;height:100vh;min-height:810px;background:#123}', '<div class="s"></div>')
  stage('st-wmin.html', 'body{margin:0}.s{width:100vw;min-width:1440px;height:810px;background:#123}', '<div class="s"></div>')
  stage('st-var2.html', ':root{--W:110vw;--H:110vh}body{margin:0}.s{width:var(--W);height:var(--H);background:#123}', '<div class="s"></div>')
  stage('st-minfit.html', 'body{margin:0}.s{width:1920px;min-height:1080px;background:#123}', '<div class="s"></div>')
  stage('st-h110.html', 'body{margin:0}.s{width:1440px;height:110vh;min-height:810px;background:#123}', '<div class="s"></div>')
  stage('st-pctmin.html', 'body{margin:0;width:1440px;height:100vh;min-height:810px}.k{width:100%;height:100%;background:#123}', '<div class="k"></div>')
  stage('st-nestlayer.html', 'body{margin:0}@layer a{.s{width:1440px;height:810px;background:#123}@layer b{.s{width:100vw;height:100vh}}}', '<div class="s"></div>')
  stage('st-cnid.html', 'body{margin:0}#画板{width:1440px;height:810px;background:#123}.s{width:100vw;height:100vh}', '<div id="画板" class="s"></div>')
  stage('st-minfit2.html', 'body{margin:0}.s{width:1920px;height:100vh;min-height:1080px;background:#123}', '<div class="s"></div>')
  stage('st-clamp2.html', 'body{margin:0}.s{width:1440px;height:clamp(810px,110vh,3000px);background:#123}', '<div class="s"></div>')
  stage('st-logical.html', 'body{margin:0}.s{width:100vw;height:100vh;inline-size:1440px;block-size:810px;background:#123}', '<div class="s"></div>')
  stage('st-where.html', 'body{margin:0}#board{width:1440px;height:810px;background:#123}:where(:is(:is(#board))){width:100vw;height:100vh}', '<div id="board"></div>')
  stage('st-pctmin2.html', 'body{margin:0;width:1440px;height:100vh;min-height:810px}.k{width:100%;height:100%;min-height:100%;background:#123}', '<div class="k"></div>')
  stage('st-layer4.html', 'body{margin:0}@layer a{@layer b{@layer c{.s{width:1440px;height:810px;background:#123}@layer d{.s{width:100vw;height:100vh}}}}}', '<div class="s"></div>')
  stage('st-spec.html', 'body{margin:0}#slide{width:1440px;height:810px;background:#123}.s{width:100vw;height:100vh}', '<div id="slide" class="s"></div>')
  stage('st-spec2.html', 'body{margin:0}.s{width:1500px;height:800px;background:#123}div{width:100%;height:100vh}', '<div class="s"></div>')
  stage('st-imp.html', 'body{margin:0}.s{width:1500px!important;height:800px!important;background:#123}#x.s{width:100vw;height:100vh}', '<div id="x" class="s"></div>')
  stage('st-layer.html', 'body{margin:0}@layer base{#x{width:100vw;height:100vh}}div{width:1440px;height:810px;background:#123}', '<div id="x"></div>')
  stage('st-sup.html', 'body{margin:0}.s{width:1440px;height:810px;background:#123}@supports not (display:block){.s{width:100vw;height:100vh}}', '<div class="s"></div>')
  stage('st-print.html', 'body{margin:0}.s{width:1440px;height:810px;background:#123}@media print{.s{width:100vw;height:100vh}}', '<div class="s"></div>')
  stage('st-nest.html', 'body{margin:0;.s{width:1440px;height:810px;background:#123}}', '<div class="s"></div>')
  fs.writeFileSync(path.join(site, 'st-imported.css'), 'body{margin:0;width:1920px;height:1080px;background:#123}')
  stage('st-import.html', '@import url(st-imported.css);.k{width:1000px;height:600px}', '<div class="k"></div>')
  stage('st-ar.html', 'body{margin:0}.p{width:1080px;aspect-ratio:9/16;background:#123}.b{height:960px}', '<div class="p"><div class="b"></div><div class="b"></div></div>')
  stage('st-minh.html', 'body{margin:0}.p{width:1080px;min-height:1920px;background:#123}.b{height:960px}', '<div class="p"><div class="b"></div><div class="b"></div></div>')
  stage('st-clamp.html', 'body{margin:0}.s{width:clamp(1440px,100vw,1920px);height:clamp(810px,100vh,1080px);background:#123}', '<div class="s"></div>')
  stage('st-var.html', ':root{--w:110vw;--h:110vh}body{margin:0}.s{width:var(--w);height:var(--h);background:#123}', '<div class="s"></div>')
  stage('st-rem.html', 'html{font-size:1vw}body{margin:0}.s{width:110rem;height:62rem;background:#123}', '<div class="s"></div>')
  stage('st-body.html', 'body{margin:0;width:1920px;height:1080px;background:#123}', '<h1 style="margin:0;color:#fff">标题</h1>')
  stage('st-center.html', 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}.s{flex:none;width:1440px;height:810px;background:#123}', '<div class="s"></div>')
  stage('st-margin.html', '.s{width:1440px;height:810px;background:#123}', '<div class="s"></div>')
  stage('st-short.html', 'body{margin:0}.s{width:1440px;height:650px;background:#123}', '<div class="s"></div>')
  stage('st-small.html', 'body{margin:0}.s{width:1280px;height:720px;background:#123}', '<div class="s"></div>')
  stage('st-2poster.html', 'body{margin:0}.s{width:1080px;height:1350px;background:#123}', '<div class="s"></div><div class="s"></div>')
  stage('st-grid.html', 'body{margin:0}.s{width:1440px;height:810px;display:grid;grid-template-rows:1fr 1fr}.s>div{background:#123}', '<div class="s"><div></div><div></div></div>')
  stage('st-rows.html', 'body{margin:0;width:1440px}.r{height:405px;background:#123}', '<div class="r"></div><div class="r"></div>')
  stage('st-tallbody.html', 'body{margin:0;width:1280px;height:960px}.s{width:1000px;height:960px;background:#123}', '<div class="s"></div>')
  stage('st-vh.html', 'body{margin:0}.s{width:100vw;height:110vh;background:#123}', '<div class="s"></div>')
  stage('st-pct.html', 'body{margin:0;width:1440px;height:810px}.s{width:100%;height:100%;background:#123}', '<div class="s"></div>')
  stage('st-half.html', 'body{margin:0}.s{width:1920px;height:1200px}.s>div{height:600px;background:#123}', '<div class="s"><div></div><div></div></div>')
  stage('st-center2.html', 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}.s{flex:none;width:1280px;height:720px;background:#123}', '<div class="s"></div>')
  stage('st-2sq.html', 'body{margin:0}.s{width:1080px;height:1000px;background:#123}', '<div class="s"></div><div class="s"></div>')
  stage('st-resp.html', 'body{margin:0}.s{width:100vw;height:100vh;background:#123}', '<div class="s"></div>')
  stage('st-stack.html', 'body{margin:0}.s{width:1440px;height:810px;background:#123}', '<div class="s"></div><div class="s"></div><div class="s"></div>')
  stage('st-decor.html', 'body{margin:0}.s{width:1280px;height:720px;background:#123}.d{position:absolute;left:1400px;top:40px;width:200px;height:200px;background:#f00}', '<div class="s"></div><div class="d"></div>')
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
    const phKeys = ['ph-ok.html', 'ph-bad.html', 'ph-nonav.html']
    const ph = await measureAll(b, { screens: phKeys.map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [375, 667]], kind: 'miniprogram' })
    const phApp = await measureAll(b, { screens: ['ph-nonav.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[390, 844]], kind: 'app' })
    const phT = (key, h, list = ph) => { const r = list.find((x) => x.key === key && x.h === h); return r ? r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar'].includes(x.type)) : null }
    const bad812 = phT('ph-bad.html', 812), bad667 = phT('ph-bad.html', 667)
    check('真浏览器手机规矩：合规的一屏（状态栏两边、导航栏标题、4 项标签栏让出横条区、当前项小横线）什么都不报', phT('ph-ok.html', 812).length === 0 && phT('ph-ok.html', 667).length === 0, JSON.stringify([phT('ph-ok.html', 812), phT('ph-ok.html', 667)]))
    check('真浏览器手机规矩：时间居中被灵动岛挡住、标签栏伸进横条区、6 项标签栏都报（小程序的标签栏算严重）', bad812.some((x) => x.type === 'island' && x.text === '9:41' && x.sev === 2) && bad812.some((x) => x.type === 'homebar' && x.px > 20 && x.bar === 'nav.tb') && bad812.some((x) => x.type === 'tabbar' && x.n === 6 && x.sev === 2) && detailOf(bad812.find((x) => x.type === 'tabbar')).includes('6 项'), JSON.stringify(bad812))
    check('真浏览器手机规矩：矮屏（375×667）没有灵动岛和横条，只报标签栏项数', bad667.map((x) => x.type).join() === 'tabbar', JSON.stringify(bad667))
    const rv = await measureAll(b, { screens: ['ph-shell.html', 'ph-tools.html', 'ph-clamp.html', 'ph-pseudo.html', 'ph-inline.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812]], kind: 'miniprogram' })
    const rvT = (key) => { const r = rv.find((x) => x.key === key); return r ? r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)) : null }
    check('真浏览器手机规矩：页面壳里普通流的底栏（body 撑满一屏、内容区自己滚）照样查横条区和 6 项标签栏', rvT('ph-shell.html').some((x) => x.type === 'homebar') && rvT('ph-shell.html').some((x) => x.type === 'tabbar' && x.n === 6), JSON.stringify(rvT('ph-shell.html')))
    check('真浏览器手机规矩：一排 6 个操作按钮（裁剪、旋转…）不当标签栏报', rvT('ph-tools.html').length === 0, JSON.stringify(rvT('ph-tools.html')))
    check('真浏览器手机规矩：多行截断藏起来的字不算伸进横条区', rvT('ph-clamp.html').length === 0, JSON.stringify(rvT('ph-clamp.html')))
    check('真浏览器手机规矩：伪元素画的图标伸进横条区照样报', rvT('ph-pseudo.html').some((x) => x.type === 'homebar'), JSON.stringify(rvT('ph-pseudo.html')))
    const rv2 = await measureAll(b, { screens: ['ph-tools-on.html', 'ph-tab-class.html', 'ph-tab-words.html', 'ph-badge.html', 'ph-pseudo-down.html', 'ph-carousel.html', 'ph-sheet.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv2T = (key) => rv2.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：工具栏有选中态（在 nav 里、当前工具变色）也不当标签栏报', rv2T('ph-tools-on.html').length === 0, JSON.stringify(rv2T('ph-tools-on.html')))
    check('真浏览器手机规矩：项的类名是 tab-item、当前项只改图标颜色的 6 项标签栏照样报', rv2T('ph-tab-class.html').filter((x) => x.type === 'tabbar' && x.n === 6).length === 2, JSON.stringify(rv2T('ph-tab-class.html')))
    check('真浏览器手机规矩：项是首页、分类、我的这些页面名的 6 项标签栏照样报', rv2T('ph-tab-words.html').filter((x) => x.type === 'tabbar' && x.n === 6).length === 2, JSON.stringify(rv2T('ph-tab-words.html')))
    check('真浏览器手机规矩：徽标小红点、空白内容的渐变遮罩不算伸进横条区', rv2T('ph-badge.html').length === 0, JSON.stringify(rv2T('ph-badge.html')))
    check('真浏览器手机规矩：按钮在横条区上面、伪元素图标往下伸进去照样报', rv2T('ph-pseudo-down.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv2T('ph-pseudo-down.html')))
    check('真浏览器手机规矩：页面末尾横着滑的商品（链接、等宽）不当标签栏报', !rv2T('ph-carousel.html').some((x) => x.type === 'tabbar'), JSON.stringify(rv2T('ph-carousel.html')))
    check('真浏览器手机规矩：收到屏幕下面看不见的面板不算伸进横条区', rv2T('ph-sheet.html').length === 0, JSON.stringify(rv2T('ph-sheet.html')))
    const rv3 = await measureAll(b, { screens: ['ph-nav-toolwords.html', 'ph-toolbar-role.html', 'ph-tools-glyph.html', 'ph-negmargin.html', 'ph-pseudo-xf.html', 'ph-pseudo-flex.html', 'ph-pseudo-end.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv3T = (key) => rv3.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    const tabs6 = (key) => rv3T(key).filter((x) => x.type === 'tabbar' && x.n === 6).length === 2
    check('真浏览器手机规矩：写明了是标签栏（class tabbar、链接）的 6 项，项名像操作（模板、相册、音乐）也照样报', tabs6('ph-nav-toolwords.html'), JSON.stringify(rv3T('ph-nav-toolwords.html')))
    check('真浏览器手机规矩：写明了 role=toolbar 的 6 个按钮，项名像页面（视频、收藏）也不报', rv3T('ph-toolbar-role.html').length === 0, JSON.stringify(rv3T('ph-toolbar-role.html')))
    check('真浏览器手机规矩：工具名前带字符图标（✂ 裁剪）的工具栏不报', rv3T('ph-tools-glyph.html').length === 0, JSON.stringify(rv3T('ph-tools-glyph.html')))
    check('真浏览器手机规矩：一排用负边距铺满的 6 项标签栏照样报', tabs6('ph-negmargin.html'), JSON.stringify(rv3T('ph-negmargin.html')))
    check('真浏览器手机规矩：伪元素图标用 translate(-50%,-50%) 居中、在横条区上面，不报', rv3T('ph-pseudo-xf.html').length === 0, JSON.stringify(rv3T('ph-pseudo-xf.html')))
    check('真浏览器手机规矩：flex 竖排「字 + ::after 箭头」，箭头伸进横条区照样报', rv3T('ph-pseudo-flex.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv3T('ph-pseudo-flex.html')))
    check('真浏览器手机规矩：flex 底对齐的伪元素图标伸进横条区照样报', rv3T('ph-pseudo-end.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv3T('ph-pseudo-end.html')))
    const rv4 = await measureAll(b, { screens: ['ph-nav-toolsid.html', 'ph-toolbar-nested.html', 'ph-tools-links.html', 'ph-pseudo-between.html', 'ph-pseudo-lh.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv4T = (key) => rv4.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：role=tablist 的 6 项里有一项叫 tools，照样报标签栏', rv4T('ph-nav-toolsid.html').filter((x) => x.type === 'tabbar' && x.n === 6).length === 2, JSON.stringify(rv4T('ph-nav-toolsid.html')))
    check('真浏览器手机规矩：套了一层的 role=toolbar（里面的一排类名叫 tabs）不报', rv4T('ph-toolbar-nested.html').length === 0, JSON.stringify(rv4T('ph-toolbar-nested.html')))
    check('真浏览器手机规矩：占位链接（href="#"）做的一排操作不报', rv4T('ph-tools-links.html').length === 0, JSON.stringify(rv4T('ph-tools-links.html')))
    check('真浏览器手机规矩：flex 竖排 space-between，::after 箭头被推到底伸进横条区照样报', rv4T('ph-pseudo-between.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv4T('ph-pseudo-between.html')))
    check('真浏览器手机规矩：字的行高撑开（line-height:40px），后面的 ::after 伸进横条区照样报', rv4T('ph-pseudo-lh.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv4T('ph-pseudo-lh.html')))
    const rv5 = await measureAll(b, { screens: ['ph-nav-hash.html', 'ph-pseudo-tight.html', 'ph-pseudo-around.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv5T = (key) => rv5.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：链到 #/page/… 路由的 6 项，项名像操作也照样报标签栏', rv5T('ph-nav-hash.html').filter((x) => x.type === 'tabbar' && x.n === 6).length === 2, JSON.stringify(rv5T('ph-nav-hash.html')))
    check('真浏览器手机规矩：space-between 放不下时箭头接在字后面，伸进横条区照样报', rv5T('ph-pseudo-tight.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv5T('ph-pseudo-tight.html')))
    check('真浏览器手机规矩：space-around 里字带外边距，箭头在横条区上面，不报', rv5T('ph-pseudo-around.html').length === 0, JSON.stringify(rv5T('ph-pseudo-around.html')))
    const rv6 = await measureAll(b, { screens: ['ph-pseudo-both.html', 'ph-pseudo-block.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv6T = (key) => rv6.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：「::before 图标 + 字 + ::after 箭头」space-between 排、都在横条区上面，不报', rv6T('ph-pseudo-both.html').length === 0, JSON.stringify(rv6T('ph-pseudo-both.html')))
    check('真浏览器手机规矩：块布局里字和箭头的上下外边距合并，箭头在横条区上面，不报', rv6T('ph-pseudo-block.html').length === 0, JSON.stringify(rv6T('ph-pseudo-block.html')))
    const rv7 = await measureAll(b, { screens: ['ph-pseudo-ib.html', 'ph-pseudo-line.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv7T = (key) => rv7.filter((x) => x.key === key).flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：行内块的字和块级箭头的外边距不合并，箭头伸进横条区照样报', rv7T('ph-pseudo-ib.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv7T('ph-pseudo-ib.html')))
    check('真浏览器手机规矩：::before 只是一条边框线（高 0），space-between 的箭头伸进横条区照样报', rv7T('ph-pseudo-line.html').filter((x) => x.type === 'homebar').length === 2, JSON.stringify(rv7T('ph-pseudo-line.html')))
    const rv8 = await measureAll(b, { screens: [{ key: 'ph-pseudo-inline.html', url: `${entry.origin}/ph-pseudo-inline.html`, label: 'ph-pseudo-inline.html' }], sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv8T = rv8.flatMap((r) => r.issues.filter((x) => ['island', 'homebar', 'tabbar', 'navbar', 'capsule'].includes(x.type)))
    check('真浏览器手机规矩：普通 span 写的上下外边距（不起作用）不算，箭头在横条区上面，不报', rv8T.length === 0, JSON.stringify(rv8T))
    const rv9 = await measureAll(b, { screens: [{ key: 'ph-pseudo-strut.html', url: `${entry.origin}/ph-pseudo-strut.html`, label: 'ph-pseudo-strut.html' }], sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
    const rv9T = rv9.flatMap((r) => r.issues.filter((x) => x.type === 'homebar'))
    check('真浏览器手机规矩：父元素行高（32px）比 span 的大，那一行按父元素的算，箭头伸进横条区照样报', rv9T.length === 2, JSON.stringify(rv9T))
    // 伪元素：无头体检问浏览器要真实框（page.pseudo），实时预览没有这个、按样式推；两种都过一遍
    const xf = await b.withPage({ url: `${entry.origin}/ph-pseudo-xf.html`, w: 430, h: 932 }, async (p) => {
      const n = await p.pseudo()
      return { n, box: await p.eval("(() => { const e = document.querySelector('.bb button'); const r = e.getBoundingClientRect(); return { got: e.__dshPseudo && e.__dshPseudo['::before'], cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 } })()") }
    })
    const g = xf.box.got
    check('伪元素真实框：浏览器给的框是视口坐标、算上了 translate(-50%,-50%)（32×32 居中在按钮上）', xf.n >= 1 && g && Math.abs((g.l + g.r) / 2 - xf.box.cx) < 1 && Math.abs((g.t + g.b) / 2 - xf.box.cy) < 1 && Math.abs(g.r - g.l - 32) < 1, JSON.stringify(xf))
    const est = { withPage: (o, fn) => b.withPage(o, (p) => fn({ ...p, pseudo: undefined })) }
    const PSEUDO = { 'ph-pseudo.html': true, 'ph-badge.html': false, 'ph-pseudo-down.html': true, 'ph-pseudo-xf.html': false, 'ph-pseudo-flex.html': true, 'ph-pseudo-end.html': true, 'ph-pseudo-between.html': true, 'ph-pseudo-lh.html': true, 'ph-pseudo-tight.html': true, 'ph-pseudo-around.html': false, 'ph-pseudo-both.html': false, 'ph-pseudo-block.html': false, 'ph-pseudo-ib.html': true, 'ph-pseudo-line.html': true, 'ph-pseudo-inline.html': false, 'ph-pseudo-strut.html': true, 'ph-pseudo-hidden.html': false, 'ph-pseudo-skip.html': true, 'ph-pseudo-clipmargin.html': true, 'ph-pseudo-clippath.html': false, 'ph-pseudo-wcontain.html': false, 'ph-pseudo-ocmbox.html': true }
    const EXACT_ONLY = { 'ph-pseudo-collapse.html': false, 'ph-pseudo-valign.html': false }
    for (const [mode, br, cases] of [['真实框', b, { ...PSEUDO, ...EXACT_ONLY }], ['按样式推', est, PSEUDO]]) {
      const rows = await measureAll(br, { screens: Object.keys(cases).map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[375, 812], [430, 932]], kind: 'miniprogram' })
      const wrong = Object.entries(cases).filter(([key, want]) => rows.filter((r) => r.key === key).some((r) => r.issues.some((x) => x.type === 'homebar') !== want))
      check(`伪元素图标伸没伸进横条区（${mode}）：${Object.keys(cases).length} 种写法都对`, wrong.length === 0, JSON.stringify(wrong))
    }
    check('真浏览器手机规矩：行内 span 写了 overflow:hidden（不起作用）一直写到胶囊下面，照样报', rvT('ph-inline.html').some((x) => x.type === 'capsule') && !rvT('ph-inline.html').some((x) => x.type === 'navbar'), JSON.stringify(rvT('ph-inline.html')))
    const natOf = (key) => b.withPage({ url: `${entry.origin}/${key}`, w: 1280, h: 720 }, (p) => p.eval('window.__dshDesign.info().natural'))
    const nats = {}
    for (const k of ['fixed', 'body', 'center', 'margin', 'resp', 'stack', 'decor']) nats[k] = await natOf(`st-${k}.html`)
    check('真浏览器画幅探测：写死的一整块、写在 body 上、居中溢出、默认 margin 都量得出', String(nats.fixed) === '1440,810' && String(nats.body) === '1920,1080' && String(nats.center) === '1440,810' && String(nats.margin) === '1448,818', JSON.stringify(nats))
    check('真浏览器画幅探测：自适应、几页竖着堆、只有装饰往外撑的不报', nats.resp === null && nats.stack === 0 && String(nats.decor) === '1280,720', JSON.stringify(nats))
    const natAt = (key, w, h) => b.withPage({ url: `${entry.origin}/${key}`, w, h }, (p) => p.eval('window.__dshDesign.info().natural'))
    check('真浏览器画幅探测：一页里上下等分的不当成几页；写死的 body 不当成被窗口撑宽', String(await natOf('st-grid.html')) === '1440,810' && String(await natOf('st-rows.html')) === '1440,810' && String(await natOf('st-tallbody.html')) === '1280,960')
    check('真浏览器画幅探测：按窗口算的（110vh）不放大；百分比跟着写死的父级算；写死高度里上下等分仍是一页', (await natOf('st-vh.html')) === null && String(await natOf('st-pct.html')) === '1440,810' && String(await natOf('st-half.html')) === '1920,1200', JSON.stringify([await natOf('st-vh.html'), await natOf('st-pct.html'), await natOf('st-half.html')]))
    check('真浏览器画幅探测：居中的页面改小了报新大小；两张接近方形的海报竖排不算一页', String(await natAt('st-center2.html', 1440, 810)) === '1280,720' && (await natAt('st-2sq.html', 1080, 1350)) === 0)
    {
      const n = async (k, w = 1280, h = 720) => String(await natAt(`st-${k}.html`, w, h))
      const got = {}
      for (const k of ['spec', 'spec2', 'imp', 'layer', 'layer2', 'layer3', 'cont', 'hmin', 'wmin', 'var2', 'sup', 'print', 'nest', 'import', 'clamp', 'var', 'rem']) got[k] = await n(k)
      got.minfit = await n('minfit', 1920, 1080)
      got.ar = await n('ar', 1080, 1350)
      got.minh = await n('minh', 1080, 1350)
      got.clampBig = await n('clamp', 1600, 900)
      check('真浏览器画幅探测：按真正生效的声明算（优先级、!important、@layer、@supports、print、嵌套、@import）', got.spec === '1440,810' && got.spec2 === '1500,800' && got.imp === '1500,800' && got.layer === '1440,810' && got.sup === '1440,810' && got.print === '1440,810' && got.nest === '1440,810' && got.import === '1920,1080', JSON.stringify(got))
      check('真浏览器画幅探测：@layer 的先后和 !important 反序、未生效的容器查询、最小宽高、大写变量名', got.layer2 === '1440,810' && got.layer3 === '1440,810' && got.cont === '1440,810' && got.hmin === '1440,810' && got.wmin === '1440,810' && got.var2 === 'null' && got.minfit === '1920,1080', JSON.stringify(got))
      const more = { h110: await n('h110'), h110grown: await n('h110', 1440, 810), h110big: await n('h110', 1600, 1000), pctmin: await n('pctmin'), nest: await n('nestlayer'), cn: await n('cnid'), fit2: await n('minfit2', 1920, 1080) }
      check('真浏览器画幅探测：跟窗口走又有最小值的只认最小值，不越放越大', more.h110 === '1440,810' && more.h110grown === '1440,810' && more.h110big === '1440,1000' && more.pctmin === '1440,810' && more.fit2 === '1920,1080', JSON.stringify(more))
      const last = { clamp2: await n('clamp2'), clamp2grown: await n('clamp2', 1440, 810), logical: await n('logical'), where: await n('where'), pctmin2: await n('pctmin2'), layer4: await n('layer4') }
      check('真浏览器画幅探测：clamp 不越放越大、逻辑尺寸、深嵌套 :where、百分比最小高度、四层 @layer', last.clamp2 === '1440,810' && last.clamp2grown === 'null' && last.logical === '1440,810' && last.where === '1440,810' && last.pctmin2 === '1440,810' && last.layer4 === '1440,810', JSON.stringify(last))
      check('真浏览器画幅探测：嵌套 @layer、中文 id 的优先级', more.nest === '1440,810' && more.cn === '1440,810', JSON.stringify(more))
      check('真浏览器画幅探测：用比例、最小高度定高的海报不当成几页', got.ar === '1080,1920' && got.minh === '1080,1920', JSON.stringify(got))
      check('真浏览器画幅探测：clamp 有写死的下限量得出，到了上下限之间不再报', got.clamp === '1440,810' && got.clampBig === 'null', JSON.stringify(got))
      check('真浏览器画幅探测：CSS 变量、按窗口定的 rem 不会越放越大', got.var === 'null' && got.rem === 'null', JSON.stringify(got))
    }
    check('真浏览器画幅探测：比默认宽但矮的也量得出', String(await natOf('st-short.html')) === '1440,650')
    check('真浏览器画幅探测：画幅放大过、页面又改小了 → 报新大小（别卡在旧尺寸）', String(await natAt('st-small.html', 1440, 810)) === '1280,720' && autoSize([[1280, 720]], 'slides') === '')
    check('真浏览器画幅探测：写死的 body 放大后原样刷新不来回变', String(await natAt('st-tallbody.html', 1280, 960)) === '1280,960')
    check('真浏览器画幅探测：两张海报竖着堆的不算一页', (await natAt('st-2poster.html', 1080, 1350)) === 0)
    const fit = await fitSize(b, [{ url: `${entry.origin}/st-fixed.html` }, { url: `${entry.origin}/st-resp.html` }], 'slides', [1280, 720])
    check('真浏览器画幅探测：一组屏里有比默认大的就按它', fit.join('x') === '1440x810', fit.join('x'))
    const grown = await b.withPage({ url: `${entry.origin}/st-fixed.html`, w: 1440, h: 810 }, (p) => p.eval('window.__dshDesign.info().natural'))
    check('真浏览器画幅探测：画幅放大后照旧报写死的大小（缩小、改稿时右侧栏拿得到新值）', String(grown) === '1440,810', String(grown))
    const dk = await measureAll(b, { screens: ['dk-ok.html', 'dk-bad.html', 'dk-win.html'].map((key) => ({ key, url: `${entry.origin}/${key}`, label: key })), sizes: [[1280, 800]], kind: 'desktop' })
    const winOf = (key) => { const r = dk.find((x) => x.key === key); return r ? r.issues.filter((x) => x.type === 'winctl') : null }
    check('真浏览器桌面软件：Mac 侧栏顶上空出红绿灯不报；标题从左上角写起报（被红绿灯挡住）；Windows 右上角的按钮报、Mac 的位置不报', winOf('dk-ok.html').length === 0 && winOf('dk-bad.html').map((x) => x.text).sort().join() === ['邮件', '新建'].sort().join() && winOf('dk-bad.html').every((x) => x.os === 'mac' && detailOf(x).includes('红绿灯')) && winOf('dk-win.html').length === 1 && winOf('dk-win.html')[0].text === '设置' && winOf('dk-win.html')[0].os === 'win' && detailOf(winOf('dk-win.html')[0]).includes('关闭'), JSON.stringify(dk.map((r) => [r.key, r.issues])))
    const dkDraw = await b.withPage({ url: `${entry.origin}/dk-win.html`, w: 1280, h: 800 }, async (p) => [await p.eval("window.__dshDesign.winctl('solid')"), await p.eval('window.__dshDesign.info().topDark'), await p.eval("document.querySelectorAll('dsh-design-fx').length"), (await p.eval("window.__dshDesign.check('desktop')")).issues.filter((x) => x.type === 'winctl').length])
    const dkMac = await b.withPage({ url: `${entry.origin}/dk-ok.html`, w: 1280, h: 800 }, async (p) => [await p.eval("window.__dshDesign.winctl('solid')"), await p.eval('window.__dshDesign.info().topDark')])
    check('真浏览器桌面软件：截图用的窗口按钮画上去（Windows 深色标题栏按白的量），不影响体检；Mac 的照 Mac 画', JSON.stringify(dkDraw) === '[{"os":"win"},true,1,1]' && JSON.stringify(dkMac) === '[{"os":"mac"},false]', JSON.stringify([dkDraw, dkMac]))
    check('真浏览器手机规矩：小程序顶上 44–88 什么都没有报「没有导航栏」，App 不报', phT('ph-nonav.html', 812).some((x) => x.type === 'navbar' && x.t === 44 && x.b === 88) && phT('ph-nonav.html', 844, phApp).length === 0 && !phT('ph-ok.html', 812).some((x) => x.type === 'navbar'), JSON.stringify([phT('ph-nonav.html', 812), phT('ph-nonav.html', 844, phApp)]))
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
