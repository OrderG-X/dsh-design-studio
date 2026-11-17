/**
 * 外框库（#19 第 2 步）：
 *   node test/test-frames.mjs
 *
 * frame.json 检查、写进页面的类型标记和指纹；本机有 Chrome / Edge 时真开：存一个外框进库（浅色、深色），
 * 从库里复制出来做设计不报，改了外框的字 / 样式漏到外框上报「外框被改动」，没登记的外框报「没登记」，
 * 自带的 DSH 外框算出来的指纹和体检表里的一样（老设计照样查）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readManifest, ensureMeta, injectFrameData, listFrames, saveFrame, frameSection } from '../lib/frames.js'
import { findBrowser, createBrowser } from '../lib/browser.js'
import { spawn } from 'node:child_process'
import { bundle } from '../lib/bundle.js'
import { measureAll, detailOf } from '../lib/look.js'
import { createHub } from '../lib/serve.js'
import { checkMarkup } from '../lib/gallery/policy.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-frames-')))
const LIB = path.join(tmp, 'lib')
const dshDir = fileURLToPath(new URL('../skills/ui-design/frames/dsh', import.meta.url))

const CSS = `.cp{--cp-bg:#fff;--cp-bar:#f1f3f4;--cp-fg:#1f1f1f;--cp-line:#dadce0;width:460px;height:640px;display:flex;flex-direction:column;background:var(--cp-bar);font:13px/1.4 system-ui,sans-serif;color:var(--cp-fg)}
[data-theme="dark"] .cp{--cp-bg:#202124;--cp-bar:#35363a;--cp-fg:#e8eaed;--cp-line:#5f6368}
.cp,.cp-bar,.cp-url{transition:background-color .3s,color .3s}
.cp-bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--cp-line)}
.cp-more{margin-left:auto}
.cp-th::before{content:"☀"}
[data-theme="dark"] .cp-th::before{content:none}
[data-theme="dark"] .cp-th::after{content:"☾"}
.cp-bar:focus-within{border-bottom-color:#1a73e8;color:#1a73e8}
.cp-find{width:60px;height:24px;border:0;border-radius:6px;padding:0 6px;font:inherit}
.fp{width:460px;height:640px;display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;padding:8px;box-sizing:border-box;background:var(--cp-bar);font:13px/1.4 system-ui,sans-serif;color:var(--cp-fg)}
[data-theme="dark"] .fp{--cp-bar:#35363a;--cp-fg:#e8eaed;--cp-bg:#202124}
.fp-side{flex:none;width:120px;height:200px;box-sizing:border-box;background:var(--cp-bg);border-radius:8px;border-left:2px solid #888}
.fp-pop{display:inline-block;min-width:200px;max-width:300px;background:var(--cp-bg);border-radius:8px;padding:8px}
.fp-tb{display:flex;align-items:center;gap:4px;white-space:nowrap;padding:4px;background:var(--cp-bg);border-radius:6px}
.ic-d{display:none}
[data-theme="dark"] .ic-l{display:none}
[data-theme="dark"] .ic-d{display:inline}
.cp-url{flex:none;width:180px;height:28px;border-radius:14px;background:var(--cp-bg);padding:0 12px;display:flex;align-items:center;color:#5f6368}
.cp-btn{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;border:0;background:transparent;color:inherit;padding:0}
.cp-pop{margin:8px 12px 0 auto;width:400px;height:560px;box-sizing:border-box;border-right:1px solid var(--cp-line);background:var(--cp-bg);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);overflow:hidden}
.cp-pop>[data-slot="main"]{height:100%;overflow:auto}`
const popup = (id = 'chrome-popup/popup') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>弹窗</title><link rel="stylesheet" href="frame.css"></head>
<body style="margin:0"><div class="cp" data-frame="${id}">
<div class="cp-bar"><span class="cp-url">示例网站</span><span class="cp-th"></span><input class="cp-find" placeholder="搜索"><span data-slot="title"></span><button class="cp-btn cp-more"><span data-slot="icon"></span></button><button class="cp-btn" style="background-image:url(assets/dot.svg)">⋮</button></div>
<div class="cp-pop"><div data-slot="main"></div></div>
</div></body></html>`
const FIT = `<!doctype html><html><head><meta charset="utf-8"><title>小弹窗</title><link rel="stylesheet" href="frame.css"></head>
<body style="margin:0"><div class="fp" data-frame="chrome-popup/fit"><div class="fp-tb"><span data-slot="tool"></span><b>工具</b></div><span class="ic-l">☀</span><span class="ic-d">☾</span><div class="fp-pop"><div data-slot="main"></div></div><div class="fp-side"></div></div></body></html>`
const manifest = (over = {}) => ({ id: 'chrome-popup', name: 'Chrome 插件弹窗', size: [460, 640], css: ['frame.css'], frames: [{ id: 'popup', file: 'popup.html', name: '弹窗', slots: { icon: '插件图标', title: '工具栏上的提示字', main: '弹窗内容' } }, { id: 'fit', file: 'fit.html', name: '随内容的小弹窗', slots: { tool: '工具栏图标', main: '弹窗内容' } }], ...over })
function stageSrc(name, { man = manifest(), html = popup() } = {}) {
  const d = path.join(tmp, name)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'frame.json'), JSON.stringify(man))
  fs.writeFileSync(path.join(d, 'frame.css'), CSS)
  fs.writeFileSync(path.join(d, 'popup.html'), html)
  fs.writeFileSync(path.join(d, 'fit.html'), FIT)
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(d, 'assets', 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>')
  return d
}

// ── frame.json 检查 ──
{
  const ok = readManifest(stageSrc('m-ok'))
  check('frame.json：写对了没问题', ok.problems.length === 0 && ok.m.id === 'chrome-popup' && ok.m.frames[0].slots.main === '弹窗内容', JSON.stringify(ok.problems))
  const bad = readManifest(stageSrc('m-bad', { man: manifest({ id: 'Chrome Popup', size: [50, 50], frames: [{ id: 'popup', file: '../x.html', name: '', slots: { icon: '' } }] }) }))
  const txt = bad.problems.join('\n')
  check('frame.json：id 大写空格、画幅太小、文件带目录、没有 main、位置没名字都报', /id「Chrome Popup」/.test(txt) && /size/.test(txt) && /file 要是/.test(txt) && /main/.test(txt) && /name/.test(txt), txt)
  check('frame.json：画幅小于 200 不收（体检、截图量不了）', /size/.test(readManifest(stageSrc('m-small', { man: manifest({ size: [460, 180] }) })).problems.join()))
check('frame.json：id「dsh」留给自带的', /留给自带/.test(readManifest(stageSrc('m-dsh', { man: manifest({ id: 'dsh' }) })).problems.join()))
  check('frame.json：没有 / 写坏', /没有 frame\.json/.test(readManifest(path.join(tmp, 'nope')).problems[0]) && (() => { const d = stageSrc('m-broken'); fs.writeFileSync(path.join(d, 'frame.json'), '{x'); return /不是合法的 JSON/.test(readManifest(d).problems[0]) })())
}

// ── 类型标记、指纹那段 ──
{
  const h = '<!doctype html><html><head><meta charset="utf-8"><meta name="dsh-design" content="web"><title>x</title></head><body></body></html>'
  const m1 = ensureMeta(h, 460, 640)
  check('类型标记：有就换成 framed WxH', m1.includes('<meta name="dsh-design" content="framed 460x640">') && !m1.includes('content="web"'))
  check('类型标记：没有就补在 charset 后面', ensureMeta('<html><head><meta charset="utf-8"></head></html>', 400, 300).includes('<meta charset="utf-8">\n<meta name="dsh-design" content="framed 400x300">'))
  const d1 = injectFrameData(h, { id: 'a/b', sig: '12345678', note: '</script><b>' })
  const d2 = injectFrameData(d1, { id: 'a/b', sig: '87654321' })
  check('指纹那段：写进去、再写换掉旧的，里面的 < > & 都转掉（不会把标签提前关上），用 <template> 不用 <script>', (d2.match(/id="dsh-frame"/g) || []).length === 1 && d2.includes('87654321') && !d2.includes('12345678') && d1.includes('\\u003c/script\\u003e') && d1.includes('<template id="dsh-frame">') && !/<script/i.test(d1))
}

// ── 真浏览器 ──
const bin = findBrowser()
if (!bin) {
  console.log('（本机没有 Chrome / Edge：跳过真浏览器那部分）')
} else {
  const b = createBrowser({ bin })
  const hub = createHub({ parents: () => [] })
  try {
    // 存进库
    const src = stageSrc('src')
    const r = await saveFrame({ browser: b, src, dir: LIB })
    const out = path.join(LIB, 'chrome-popup')
    const saved = r.ok ? fs.readFileSync(path.join(out, 'popup.html'), 'utf8') : ''
    const data = r.ok ? JSON.parse(/<template id="dsh-frame">([\s\S]*?)<\/template>/.exec(saved)[1]) : null
    // 和体检一样解开：整串，或 {第几个: 值}（浅色比上一个元素、深色比自己的浅色）
    const rows = []
    if (data) {
      const n = data.probes.p.length, val = (i) => (i >= 0 ? data.probes.v[i] : null)
      const de = (a, base) => (Array.isArray(a) ? Array.from({ length: n }, (_, k) => (k >= a.length ? '-' : val(a[k]))) : a && base ? base.map((x, k) => (k in a ? val(a[k]) : x)) : null)
      let prev = null
      for (const [p, l, ...ds] of data.probes.e) { const lv = de(l, prev); prev = lv; rows.push([p, lv, ...ds.map((d) => de(d, lv))]) }
    }
    check('存外框：存成了，库里有 frame.json、样式、页面', r.ok && ['frame.json', 'frame.css', 'popup.html'].every((f) => fs.existsSync(path.join(out, f))), r.text)
    check('存外框：类型标记在开头、指纹那段放在 </head> 前（指纹再长也不把类型标记挤出读取范围）', saved.indexOf('content="framed 460x640"') < 300 && saved.indexOf('id="dsh-frame"') > saved.indexOf('<link'), saved.slice(0, 300))
    check('存外框：页面里那段不大（没画伪元素的元素后面不记；只记和上一个元素 / 浅色不同的值）', saved.length < 24000 && data && data.probes.e.some((x) => !Array.isArray(x[1])) && data.probes.e.some((x) => x[2] && !Array.isArray(x[2])), String(saved.length))
    check('存外框：页面写进了 framed 460x640 和指纹（8 位）、几处样式', saved.includes('content="framed 460x640"') && data && data.id === 'chrome-popup/popup' && /^[0-9a-f]{8}$/.test(data.sig) && data.probes.e.length >= 5, saved.slice(0, 400))
    check('存外框：外框带颜色过渡，量的是过渡完的深色（不是半截）', rows.some((x) => Array.isArray(x[2]) && x[2].includes('rgb(53, 54, 58)')), JSON.stringify(data && data.probes.e.slice(0, 3)))
    check('存外框：跟着槽位内容变的（margin:auto 的按钮的外边距）不记', rows.some((x) => x[1][data.probes.p.indexOf('margin')] === null) && data.sv === 2, JSON.stringify(rows.map((x) => x[1][data.probes.p.indexOf('margin')])))
    check('存外框：外框有深色，存了深色值、截了浅色深色两张', rows.some((x) => Array.isArray(x[2])) && r.images.length === 4 && r.images.every((x) => x.jpg && x.jpg.length > 1000), JSON.stringify(r.images.map((x) => x.label)))
    const mk = checkMarkup(saved, { file: 'popup.html' })
    check('存外框：库里的页面能分享到设计市场（没有 <script> 这种不收的）', !mk.some((x) => x.code === 'tag'), JSON.stringify(mk))
    check('外框库：列得出来，技能那段写着它', listFrames(LIB).map((x) => x.id).join() === 'chrome-popup' && frameSection(LIB).includes('「Chrome 插件弹窗」（chrome-popup，460×640）'))

    // 存不成：槽位对不上、根元素 id 写错
    const bad1 = await saveFrame({ browser: b, src: stageSrc('src-bad', { html: popup('chrome-popup/pop') }), dir: path.join(tmp, 'lib-bad') })
    check('存外框：根元素 data-frame 写错、不存', !bad1.ok && /data-frame="chrome-popup\/popup"/.test(bad1.text) && !fs.existsSync(path.join(tmp, 'lib-bad', 'chrome-popup')), JSON.stringify(bad1.text))
    const lostSrc = stageSrc('src-lost')
    fs.appendFileSync(path.join(lostSrc, 'frame.css'), '\n@import "tokens.css";\n@import "/root.css";\n.x{background:url(img/bg.png)}\n.y{background-image:image-set("set.svg" 1x)}\n')
    fs.writeFileSync(path.join(lostSrc, 'set.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    fs.appendFileSync(path.join(lostSrc, 'frame.css'), '@import "design tokens.css";\n')
    fs.writeFileSync(path.join(lostSrc, 'design tokens.css'), ':root{--c:red}')
    fs.appendFileSync(path.join(lostSrc, 'frame.css'), '.z{background:url("logo (1).svg")}\n.w{background:url(assets/nope.png)}\n')
    fs.writeFileSync(path.join(lostSrc, 'logo (1).svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    fs.mkdirSync(path.join(lostSrc, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(lostSrc, 'assets', 'sprite.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="../leaf.svg" width="8" height="8"/></svg>')
    fs.writeFileSync(path.join(lostSrc, 'leaf.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    fs.writeFileSync(path.join(lostSrc, 'root.css'), ':root{--b:red}')
    fs.writeFileSync(path.join(lostSrc, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    fs.writeFileSync(path.join(lostSrc, 'popup.html'), fs.readFileSync(path.join(lostSrc, 'popup.html'), 'utf8').replace(/<body([^>]*)>/i, `<body$1><i style="background-image:url('logo.svg')"></i>`))
    fs.writeFileSync(path.join(lostSrc, 'tokens.css'), ':root{--a:red}')
    fs.mkdirSync(path.join(lostSrc, 'img'), { recursive: true })
    fs.writeFileSync(path.join(lostSrc, 'img', 'bg.png'), 'x')
    const lost = await saveFrame({ browser: b, src: lostSrc, dir: path.join(tmp, 'lib-lost') })
    check('存外框：frame.css 里 @import 了没写进 css 的 tokens.css、/root.css，url() 了不在 assets/ 的图（行内 style 里用另一种引号的、image-set("x.svg" 1x)、url("logo (1).svg")、assets/ 里 SVG 引用的 ../leaf.svg 也算；引用的文件根本没有也不存）→ 不存、说清哪几个', !lost.ok && /tokens\.css/.test(lost.text) && /\/root\.css/.test(lost.text) && /img\/bg\.png/.test(lost.text) && /logo\.svg/.test(lost.text) && /set\.svg/.test(lost.text) && /design tokens\.css/.test(lost.text) && /logo \(1\)\.svg/.test(lost.text) && /nope\.png（找不到/.test(lost.text) && /leaf\.svg/.test(lost.text) && !fs.existsSync(path.join(tmp, 'lib-lost', 'chrome-popup')), lost.text)
    const bodyRoot = await saveFrame({ browser: b, src: stageSrc('src-bodyroot', { html: popup().replace('<body style="margin:0"><div class="cp" data-frame="chrome-popup/popup">', '<body style="margin:0" class="cp" data-frame="chrome-popup/popup"><div>') }), dir: path.join(tmp, 'lib-bad') })
    const scr = await Promise.all([popup().replace('</body>', '<script>document.title = 1</script></body>'), popup().replace('<button class="cp-btn cp-more">', '<button class="cp-btn cp-more" onclick="x()">')].map((html, i) => saveFrame({ browser: b, src: stageSrc(`src-script${i}`, { html }), dir: path.join(tmp, 'lib-bad') })))
    const dlgRoot = await saveFrame({ browser: b, src: stageSrc('src-dlgroot', { html: popup().replace('<div class="cp" data-frame="chrome-popup/popup">', '<dialog open class="cp" data-frame="chrome-popup/popup" style="position:static;margin:0;padding:0;border:0">').replace('\n</div></body>', '\n</dialog></body>') }), dir: path.join(tmp, 'lib-bad') })
    const noHead = await saveFrame({ browser: b, src: stageSrc('src-nohead', { html: popup().replace('<head><meta charset="utf-8">', '').replace('</head>', '') }), dir: path.join(tmp, 'lib-nohead') })
    const nhText = noHead.ok ? fs.readFileSync(path.join(tmp, 'lib-nohead', 'chrome-popup', 'popup.html'), 'utf8') : ''
    check('存外框：页面没写 <head>、<meta charset> → 存成了，外框那段放在 doctype 后面（不进怪异模式）', noHead.ok && nhText.startsWith('<!doctype html>') && /<html lang="zh-CN">\s*<template id="dsh-frame">/.test(nhText), noHead.text + nhText.slice(0, 80))
    check('存外框：data-frame 写在 <body>、<dialog> 上、外框里有 <script> / onclick → 不存、说清楚', !bodyRoot.ok && /写在了 <body> 上/.test(bodyRoot.text) && !dlgRoot.ok && /写在了 <dialog> 上/.test(dlgRoot.text) && scr.every((x) => !x.ok && /脚本/.test(x.text)) && !fs.existsSync(path.join(tmp, 'lib-bad', 'chrome-popup')), JSON.stringify([bodyRoot.text, scr.map((x) => x.text)]))
    const bad2 = await saveFrame({ browser: b, src: stageSrc('src-bad2', { man: manifest({ frames: [{ id: 'popup', file: 'popup.html', name: '弹窗', slots: { main: 'x', tip: 'y' } }] }) }), dir: path.join(tmp, 'lib-bad') })
    check('存外框：frame.json 和页面的槽位对不上（少 tip、多 title、icon）都报', !bad2.ok && /页面上没有：tip/.test(bad2.text) && /frame\.json 没写：title、icon/.test(bad2.text), JSON.stringify(bad2.text))

    const many = stageSrc('src-many')
    fs.mkdirSync(path.join(many, 'assets'), { recursive: true })
    for (let i = 0; i < 201; i++) fs.writeFileSync(path.join(many, 'assets', `i${i}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const bad3 = await saveFrame({ browser: b, src: many, dir: path.join(tmp, 'lib-bad') })
    const odd = stageSrc('src-odd')
    fs.mkdirSync(path.join(odd, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(odd, 'assets', 'x.js'), '1')
    const bad4 = await saveFrame({ browser: b, src: odd, dir: path.join(tmp, 'lib-bad') })
    check('存外框：assets 文件太多、有收不了的文件 → 不存（不悄悄少复制）', !bad3.ok && /202 个/.test(bad3.text) && !bad4.ok && /x\.js/.test(bad4.text) && !fs.existsSync(path.join(tmp, 'lib-bad', 'chrome-popup')), JSON.stringify([bad3.text, bad4.text]))

    // 用外框做设计：从库里复制，只写槽位
    const design = path.join(tmp, 'design')
    fs.mkdirSync(design)
    fs.copyFileSync(path.join(out, 'frame.css'), path.join(design, 'frame.css'))
    const fill = (html, head, slot) => html.replace('</head>', `${head}</head>`).replace('<div data-slot="main"></div>', `<div data-slot="main">${slot}</div>`).replace('<span data-slot="icon"></span>', '<span data-slot="icon"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"/></svg></span>')
    const style = '<style>[data-slot="main"] .rl{padding:16px;display:grid;gap:10px}[data-slot="main"] .rl h1{margin:0;font-size:18px}[data-slot="main"] .rl button{height:32px;border-radius:8px;border:1px solid #ccc;background:#fff;font-size:14px}[data-theme="dark"] [data-slot="main"] .rl button{background:#333;color:#eee}</style>'
    const body = '<section class="rl"><h1>稍后读</h1><p>已存 12 篇</p><button>存下这一页</button></section>'
    fs.writeFileSync(path.join(design, 'popup.html'), fill(saved, style, body))
    fs.writeFileSync(path.join(design, 'edit.html'), fill(saved, style, body).replace('示例网站', '我的网站'))
    fs.writeFileSync(path.join(design, 'leak.html'), fill(saved, style + '<style>span{font-weight:700}button{border-radius:0}</style>', body))
    fs.writeFileSync(path.join(design, 'leak2.html'), fill(saved, style + '<style>.cp div{margin:0}</style>', body))
    fs.writeFileSync(path.join(design, 'longtitle.html'), fill(saved, style, body).replace('<span data-slot="title"></span>', '<span data-slot="title">已经存了很多很多篇文章，记得抽空读完</span>'))
    fs.writeFileSync(path.join(design, 'hide.html'), fill(saved, style + '<style>.cp .cp-bar{display:none}</style>', body))
    fs.writeFileSync(path.join(design, 'tall.html'), fill(saved, style + '<style>.cp .cp-bar{height:100px}</style>', body))
    fs.writeFileSync(path.join(design, 'fade.html'), fill(saved, style + '<style>.cp .cp-pop{opacity:0}</style>', body))
    fs.writeFileSync(path.join(design, 'noslots.html'), saved.replace(/<span data-slot="(icon|title)"><\/span>/g, '').replace('<div data-slot="main"></div>', ''))
    const savedFit = fs.readFileSync(path.join(out, 'fit.html'), 'utf8')
    fs.writeFileSync(path.join(design, 'fit-wide.html'), savedFit.replace('<div data-slot="main"></div>', '<div data-slot="main"><div style="width:280px;height:120px;background:#eee"></div></div>'))
    fs.writeFileSync(path.join(design, 'fit-icon.html'), savedFit.replace('<span data-slot="tool"></span>', '<span data-slot="tool"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"/></svg></span>'))
    fs.writeFileSync(path.join(design, 'fit-darkleak.html'), savedFit.replace('</head>', '<style>.fp .ic-d{font-size:40px}</style></head>'))
    fs.writeFileSync(path.join(design, 'darkvar.html'), fill(saved, style + '<style>[data-theme="dark"] [data-frame]{--cp-bg:#fff;--cp-bar:#f1f3f4;--cp-fg:#1f1f1f}</style>', body))
    fs.writeFileSync(path.join(design, 'remote.html'), fill(saved, style, body).replace(/style="([^"]*)url\(assets\/dot\.svg\)([^"]*)"/, (m, a, b) => `style="${a}url('data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E')${b}" data-dsh-style="${a}url(assets/dot.svg)${b}"`))
    fs.writeFileSync(path.join(design, 'th-op.html'), fill(saved, style + '<style>.cp .cp-th::before{opacity:0}</style>', body))
    fs.writeFileSync(path.join(design, 'bgimg.html'), fill(saved, style + '<style>.cp-bar button{background:none!important}</style>', body))
    fs.writeFileSync(path.join(design, 'ce.html'), fill(saved, style, '<div class="ce" contenteditable>正在改的字</div>'))
    fs.writeFileSync(path.join(design, 'red.html'), fill(saved, style + '<style>*{color:red!important}</style>', body))
    fs.writeFileSync(path.join(design, 'lastbtn.html'), fill(saved, style + '<style>.cp-bar button:last-child{display:none}</style>', body))
    fs.writeFileSync(path.join(design, 'shift.html'), fill(saved, style + '<style>.cp .cp-bar{transform:translateY(-100%)}</style>', body))
    fs.writeFileSync(path.join(design, 'ph.html'), fill(saved, style, body).replace('placeholder="搜索"', 'placeholder="找文章"'))
    fs.writeFileSync(path.join(design, 'dsh-noslot.html'), fs.readFileSync(path.join(dshDir, 'view.html'), 'utf8').replace(/dsh-shell\.css/g, 'dsh-dsh-shell.css').replace(/ data-slot="[^"]*"/g, ''))
    fs.writeFileSync(path.join(design, 'nosig.html'), fill(popup('my-thing/popup').replace('<link', '<meta name="dsh-design" content="framed 460x640"><link'), style, body))
    // DSH 自带外框：原样打开
    for (const f of fs.readdirSync(dshDir)) fs.copyFileSync(path.join(dshDir, f), path.join(design, 'dsh-' + f))
    for (const f of ['sidebar', 'settings', 'view', 'panel']) {
      const p = path.join(design, `dsh-${f}.html`)
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/dsh-shell\.css/g, 'dsh-dsh-shell.css'))
    }
    const entry = await hub.open({ kind: 'file', root: design })
    const run = async (key, dark = false, kind = 'framed', size = [460, 640]) => (await measureAll(b, { screens: [{ key, url: `${entry.origin}/${key}`, label: key }], sizes: [size], kind, dark }))[0]
    const frameIssues = (row) => (row.issues || []).filter((x) => x.type === 'frame')
    const ok = [await run('popup.html'), await run('popup.html', true)]
    check('用外框：从库里复制、只写槽位，浅色深色都不报外框', ok.every((x) => Array.isArray(x.issues) && frameIssues(x).length === 0), JSON.stringify(ok.map((x) => x.error || frameIssues(x))))
    const ed = frameIssues(await run('edit.html'))
    check('用外框：改了外框里的字 → 报「外框被改动」（结构）', ed.length === 1 && ed[0].what === 'dom' && ed[0].frame === 'chrome-popup/popup', JSON.stringify(ed))
    check('用外框：给模型的字说从外框库重新复制', ed[0] && /外框库/.test(detailOf(ed[0])) && !/dsh-shell/.test(detailOf(ed[0])), ed[0] && detailOf(ed[0]))
    const lk = frameIssues(await run('leak.html'))
    check('用外框：不带前缀的 span 样式漏到外框的字上 → 报（样式）；button 盖不过外框自己的 class、不算', lk.length === 1 && lk[0].what === 'style' && lk[0].prop === 'font-weight', JSON.stringify(lk))
    const lkd = frameIssues(await run('leak.html', true))
    check('用外框：深色下漏样式一样报', lkd.length === 1 && lkd[0].what === 'style', JSON.stringify(lkd))
    const lk2 = frameIssues(await run('leak2.html'))
    check('用外框：.cp div { margin: 0 } 盖过外框的外边距 → 报', lk2.length === 1 && lk2[0].what === 'style' && lk2[0].prop === 'margin', JSON.stringify(lk2))
    const lt = frameIssues(await run('longtitle.html'))
    check('用外框：槽位里的字写长了，外框按钮的 margin:auto 跟着挤 → 不算改动', lt.length === 0, JSON.stringify(lt))
    for (const [f, prop, name] of [['hide.html', 'display', '工具栏 display:none'], ['tall.html', 'height', '工具栏高 40 → 100'], ['fade.html', 'opacity', '弹窗 opacity:0']]) {
      const x = frameIssues(await run(f))
      check(`用外框：插件样式把外框改了（${name}）→ 报（样式）`, x.length === 1 && x[0].what === 'style' && x[0].prop === prop, JSON.stringify(x))
    }
    const nsl = frameIssues(await run('noslots.html'))
    check('用外框：槽位全删了（外框和指纹还在）→ 报结构被改', nsl.length === 1 && nsl[0].what === 'dom', JSON.stringify(nsl))
    const fw = [frameIssues(await run('fit-wide.html')), frameIssues(await run('fit-wide.html', true))]
    check('随内容撑开的外框：槽位里放宽内容、外框跟着变宽变窄 → 不算改动；深浅色换图标（浅色那张深色下 display:none）→ 不算改动', fw.every((x) => x.length === 0), JSON.stringify(fw))
    const rm = frameIssues(await run('remote.html'))
    check('远程看：外框行内样式里的图换成 data: 地址 → 不算改动', rm.length === 0, JSON.stringify(rm))
    const dv = frameIssues(await run('darkvar.html', true))
    check('深色下插件样式把外框的颜色变量改回浅色（外框变白）→ 报，不拿浅色那套兜底', dv.length === 1 && dv[0].what === 'style', JSON.stringify(dv))
    const fi = [frameIssues(await run('fit-icon.html')), frameIssues(await run('fit-icon.html', true))]
    check('自动高度、不换行的工具栏：槽位里放 24px 图标、工具栏跟着变高 → 不算改动', fi.every((x) => x.length === 0), JSON.stringify(fi))
    const dl = frameIssues(await run('fit-darkleak.html', true))
    check('只在深色显示的外框元素也查：插件样式改到它 → 深色下报', dl.length === 1 && dl[0].what === 'style' && /ic-d/.test(dl[0].sel), JSON.stringify(dl))
    for (const [f, prop, name] of [['red.html', 'color', '* { color: red !important } 把外框的字染红'], ['lastbtn.html', 'display', '同类的第二个按钮被藏起来'], ['shift.html', 'transform', '工具栏被移出画面']]) {
      const x = frameIssues(await run(f))
      check(`用外框：${name} → 报（样式）`, x.length === 1 && x[0].what === 'style' && x[0].prop === prop, JSON.stringify(x))
    }
    const tho = frameIssues(await run('th-op.html'))
    check('浅色用 ::before、深色用 ::after 画图标的外框：浅色那个 opacity:0 → 报（不被深色的「没画」抵消）', tho.length === 1 && tho[0].prop === '::before opacity', JSON.stringify(tho))
    const bgi = frameIssues(await run('bgimg.html'))
    check('插件写 button { background: none !important }，外框按钮的背景图标没了 → 报', bgi.length === 1 && /^background-(image|color)$/.test(bgi[0].prop), JSON.stringify(bgi))
    const ce = await b.withPage({ url: `${entry.origin}/ce.html`, w: 460, h: 640 }, async (p) => { await p.eval('const c = document.querySelector(".ce"); c.focus(); getSelection().collapse(c.firstChild, 3); window.__blurs = 0; c.addEventListener("blur", () => { window.__blurs++ })'); const r = await p.eval('window.__dshDesign.check("framed")'); return { n: frameIssues(r).length, still: await p.eval('document.activeElement.className + "," + getSelection().anchorOffset + "," + window.__blurs') } })
    check('槽位里正在可编辑的地方打字时体检：不移走焦点（不打断改字）', ce.still === 'ce,3,0' && ce.n === 0, JSON.stringify(ce))
    const ph = frameIssues(await run('ph.html'))
    check('用外框：改了外框输入框的占位字 → 报结构被改', ph.length === 1 && ph[0].what === 'dom', JSON.stringify(ph))
    const dn = frameIssues(await run('dsh-noslot.html', false, 'dshplugin', [1280, 800]))
    check('DSH 外框（老设计、没有指纹那段）槽位全删了 → 照样报结构被改', dn.length === 1 && dn[0].what === 'dom' && dn[0].frame === 'dsh/view', JSON.stringify(dn))
    const ns = frameIssues(await run('nosig.html'))
    check('没登记的外框（没有指纹那段、也不是 DSH 的）→ 报「没登记」，不默默放过', ns.length === 1 && ns[0].what === 'nosig' && /save_frame/.test(detailOf(ns[0])), JSON.stringify(ns))
    // 外框自己没写深色：插件槽位写了深色，切深色（加了 color-scheme:dark）外框没写颜色的字、按钮跟着变 → 不算改动
    const plainSrc = path.join(tmp, 'src-plain')
    fs.mkdirSync(plainSrc)
    fs.writeFileSync(path.join(plainSrc, 'frame.json'), JSON.stringify({ id: 'plain-bar', name: '朴素工具栏', size: [460, 640], css: ['plain.css'], frames: [{ id: 'main', file: 'main.html', name: '主页', slots: { main: '内容' } }] }))
    fs.writeFileSync(path.join(plainSrc, 'plain.css'), '\ufeff.pb{width:460px;height:640px;display:flex;flex-direction:column;font:13px/1.4 FrameFont,system-ui,sans-serif}.pb-bar{position:relative;height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid #ccc;background:#3a3a3a}@media (prefers-color-scheme: light){.pb-bar{background:#f5f5f5}}.pb-mid{position:relative;top:50%;display:inline-block;transform:translateY(-50%);border:1px solid #999}.pb-bar:focus-within{border-bottom-color:#36f;color:#36f}.pb-x{display:inline-block;width:16px;height:16px;overflow:hidden}.pb-x::before{content:"×";display:inline-block;width:12px;color:#888}.pb-an{animation:pbIn .05s forwards}@keyframes pbIn{from{opacity:0}to{opacity:.9}}.pb-spin{display:inline-block;animation:pbSpin 1s linear infinite}@keyframes pbSpin{to{transform:rotate(360deg)}}.pb-title{position:absolute;left:50%;top:0;transform:translateX(-50%)}.pb-bar button{margin-left:auto}.pb-bar b{white-space:nowrap}.pb-rt{position:absolute;right:16px;top:20px;font-size:9px}.pb-ic5 circle{fill:url(#pb-g2)}.pb-bar:focus-within~.pb-body .pb-ic5 rect{fill:url(#pb-g2)}.pb-c2{fill:url(#pb-paint)}.pb-ic6{filter:url(#pb-blur2);clip-path:url(#pb-clip2)}.pb-rt{filter:url(#pb-blur3)}.pb-rt::after{content:"•";display:inline-block;clip-path:url(#pb-cut)}.pb:focus{background:#eef}.pb-ck:checked+.pb-lb{background:#36f}.pb-menu{display:none;position:absolute;top:36px;right:0;background:#fff}.pb-body{flex:1}.pb-lg{display:inline-block;width:8px;height:8px;background:url("assets/logo (1).svg")}/* 旧图：url(old-logo.svg) */.pb-mk{display:inline-block;width:8px;height:8px;background:#000;mask-image:url(#pb-wide)}.pb-xf{fill:url("assets/paint.svg#pg")}.pb-p1{display:none}.pb-p1:target{display:block}.pb:target{color:#c00}.pb-dlg{position:static;margin:0;padding:0;border:0}.pb-is{background-image:image-set(url("assets/a.svg") type("image/svg+xml") 1x)}.pb-xl{display:inline-block;width:6px;height:6px;background:#888;filter:url("assets/fx.svg#pf")}')
    fs.writeFileSync(path.join(plainSrc, 'main.html'), '<!doctype html><html><head><meta charset="utf-8"><title>朴素</title><link rel="stylesheet" href="plain.css"></head><body style="margin:0"><div class="pb" data-frame="plain-bar/main" tabindex="0" id="pb-root"><div class="pb-bar"><b>朴素工具栏</b><span class="pb-title">朴素标题 Plain title</span><span class="pb-rt">右边 Right</span><svg class="pb-ic" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><defs><path id="pb-sq" d="M3 3h10v10H3z" fill="currentColor"/><path id="pb-tri" d="M8 2l6 12H2z"/></defs><path d="M2 8h12"/><use href="#pb-sq"/></svg><svg class="pb-ic2" width="16" height="16"><use href="assets/icons.svg#star"/></svg><svg class="pb-ic3" width="16" height="16"><use href="#pb-out"/></svg><i class="pb-mid">居中</i><span class="pb-x"></span><em class="pb-an">新</em><i class="pb-spin">◌</i><button>⋮</button><input placeholder="搜" autofocus></div><div class="pb-body"><div class="pb-menu">菜单</div><input type="checkbox" id="pb-ck" class="pb-ck"><label for="pb-ck" class="pb-lb">选</label><select class="pb-sel"><option>甲</option><option>乙</option></select><input type="radio" name="pb-mode" value="a" class="pb-r1" checked><details class="pb-det"><summary>更多</summary><div style="height:20px">内容</div></details><details class="pb-acc" name="pb-acc" open><summary>分组</summary><div style="height:20px">组</div></details><svg class="pb-ic4" width="16" height="16"><defs><linearGradient id="pb-g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="16" height="16" fill="url(#pb-g)"/></svg><svg class="pb-ic5" width="16" height="16"><rect width="16" height="16" fill="#0a0" clip-path="url(#pb-clip)" filter="url(#pb-blur)"/><circle cx="8" cy="8" r="6"/></svg><svg class="pb-ic6" width="16" height="16"><use href="#pb-sym2"/></svg><img class="pb-img" src="assets/a.svg" srcset="assets/a.svg 1x" width="12" height="12" alt=""><i class="pb-bgi" style="display:inline-block;width:8px;height:8px;background:url(assets/a.svg)"></i><i class="pb-lg"></i><i class="pb-mk"></i><span class="pb-two">上<br>下</span><img class="pb-rm" srcset="http://127.0.0.1:9/x.png 1x,http://127.0.0.1:9/y.png 2x" width="1" height="1" alt=""><img class="pb-q" src="http://127.0.0.1:9/q.png?a=1&amp;b=2" width="1" height="1" alt=""><i class="pb-ent" style="display:inline-block;width:2px;height:2px;background:url(&#34;assets/a.svg&#34;)"></i><img class="pb-ent2" src="assets/R&#38;D.svg" width="1" height="1" alt=""><img class="pb-di" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x, assets/a.svg 2x" width="1" height="1" alt=""><dialog class="pb-dlg" open><form method="dialog"><button class="pb-dx">关</button></form></dialog><a class="pb-ta" href="#pb-p1">面板</a><svg class="pb-ld" width="8" height="8"><circle cx="4" cy="4" r="3"><animate attributeName="opacity" values="1;.2;1" dur="1s" repeatCount="indefinite"/></circle><g><animateTransform attributeName="transform" type="rotate" from="0 4 4" to="360 4 4" dur="1s" repeatCount="indefinite"/><rect width="2" height="2"/></g></svg><div id="pb-p1" class="pb-p1">面板内容</div><button class="pb-pt" popovertarget="pb-pop">?</button><div id="pb-pop" popover>气泡</div><svg class="pb-ic7" width="8" height="8"><rect class="pb-xf" width="8" height="8"/></svg><i class="pb-xl"></i><div data-slot="main"></div></div></div><svg style="display:none"><symbol id="pb-out" viewBox="0 0 16 16"><use href="#pb-deep"/></symbol><defs><clipPath id="pb-clip"><rect width="16" height="8"/></clipPath><radialGradient id="pb-g2"><stop offset="0" stop-color="#ff0"/><stop offset="1" stop-color="#f60"/></radialGradient><radialGradient id="pb-g3"><stop offset="0" stop-color="#333"/><stop offset="1" stop-color="#000"/></radialGradient><linearGradient id="pb-paint"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#00f"/></linearGradient><filter id="pb-blur"><feGaussianBlur stdDeviation="0"/></filter><filter id="pb-blur2"><feGaussianBlur stdDeviation="0" result="b2"/></filter><clipPath id="pb-clip2"><path d="M0 0h16v16H0z"/></clipPath><filter id="pb-blur3"><feGaussianBlur stdDeviation="0" result="b3"/></filter><clipPath id="pb-cut"><rect width="32" height="32"/></clipPath></defs><symbol id="pb-sym2" viewBox="0 0 16 16"><circle class="pb-c2" cx="8" cy="8" r="7"/></symbol><symbol id="pb-deep" viewBox="0 0 16 16"><g transform="translate(4,0)"><path d="M2 2h12v12H2z" fill="currentColor"/></g></symbol></svg></body></html>')
    fs.mkdirSync(path.join(plainSrc, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(plainSrc, 'assets', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><rect width="12" height="12" fill="#36f"/></svg>')
    fs.writeFileSync(path.join(plainSrc, 'assets', 'R&D.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    fs.writeFileSync(path.join(plainSrc, 'assets', 'paint.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="pg"><stop offset="0" stop-color="#0c0"/><stop offset="1" stop-color="#06c"/></linearGradient></svg>')
    fs.writeFileSync(path.join(plainSrc, 'assets', 'fx.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><filter id="pf"><feGaussianBlur stdDeviation="0"/></filter></svg>')
    fs.writeFileSync(path.join(plainSrc, 'old-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>') // 只在注释里提到：不算依赖、照样能存
    fs.writeFileSync(path.join(plainSrc, 'assets', 'logo (1).svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#0a0"/></svg>')
    fs.writeFileSync(path.join(plainSrc, 'assets', 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="6" cy="6" r="6" fill="#f63"/></svg>')
    fs.writeFileSync(path.join(plainSrc, 'assets', 'icons.svg'), '\ufeff<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star" viewBox="0 0 16 16"><path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z"/></symbol></svg>')
    const pr = await saveFrame({ browser: b, src: plainSrc, dir: LIB })
    const plain = pr.ok ? fs.readFileSync(path.join(LIB, 'plain-bar', 'main.html'), 'utf8') : ''
    check('外框没写深色：存成了，只截浅色一张（样式注释里提到的 old-logo.svg、image-set 里的 type("image/svg+xml")、srcset 里带逗号的 data: 图、写成 &#38; &#34; 的地址都不算缺文件）', pr.ok && pr.images.length === 1 && /只有浅色/.test(pr.text), pr.text)
    fs.copyFileSync(path.join(LIB, 'plain-bar', 'plain.css'), path.join(design, 'plain.css'))
    fs.mkdirSync(path.join(design, 'assets'), { recursive: true })
    if (pr.ok) for (const f of ['icons.svg', 'a.svg', 'b.svg', 'logo (1).svg', 'paint.svg', 'fx.svg', 'R&D.svg']) fs.copyFileSync(path.join(LIB, 'plain-bar', 'assets', f), path.join(design, 'assets', f))
    const plainFill = (head) => plain.replace('</head>', `${head}</head>`).replace('<div data-slot="main"></div>', '<div data-slot="main"><section class="rl"><h1>稍后读</h1></section></div>')
    fs.writeFileSync(path.join(design, 'plain.html'), plainFill('<style>[data-slot="main"] .rl{padding:16px;background:#fff;color:#111}@media (prefers-color-scheme: dark){[data-slot="main"] .rl{background:#111;color:#eee}}</style>'))
    fs.writeFileSync(path.join(design, 'plain-attr.html'), plainFill('<style>[data-slot="main"] .rl{padding:16px}</style>').replace('<html>', '<html data-theme="dark">'))
    fs.writeFileSync(path.join(design, 'plain-leak.html'), plainFill('<style>b{font-weight:400}</style>'))
    fs.writeFileSync(path.join(design, 'plain-move.html'), plainFill('').replace('<input placeholder="搜" autofocus></div><div class="pb-body">', '<input placeholder="搜" autofocus><div class="pb-body">').replace('</div></div></div></body>', '</div></div></div></div></body>').replace('</section></div></div></div></body>', '</section></div></div></div></div></body>'))
    fs.writeFileSync(path.join(design, 'plain-gap.html'), plainFill('<style>.pb .pb-bar{gap:100px}</style>'))
    fs.writeFileSync(path.join(design, 'plain-svg.html'), plainFill('<style>svg{stroke:transparent}</style>'))
    fs.writeFileSync(path.join(design, 'plain-pseudo.html'), plainFill('<style>.pb .pb-x::before{content:none}</style>'))
    for (const [n, css] of [['op', 'opacity:0'], ['vis', 'visibility:hidden'], ['sc', 'transform:scale(0)'], ['fs', 'font-size:0']]) fs.writeFileSync(path.join(design, `plain-pseudo-${n}.html`), plainFill(`<style>.pb .pb-x::before{${css}}</style>`))
    fs.writeFileSync(path.join(design, 'side-border.html'), fill(saved, style + '<style>.cp .cp-pop{border-right:0}</style>', body))
    fs.writeFileSync(path.join(design, 'fit-side.html'), savedFit.replace('</head>', '<style>.fp .fp-side{border-left:0}</style></head>'))
    // 换台电脑：外框写的字体（FrameFont）这台有了、字宽变了（用 @font-face 指到等宽字体模拟），字体名没变 → 不算改动
    fs.writeFileSync(path.join(design, 'plain-font.html'), plainFill('<style>@font-face{font-family:FrameFont;src:local("Courier New"),local("Courier"),local("Menlo"),local("DejaVu Sans Mono")}</style>'))
    fs.writeFileSync(path.join(design, 'plain-clipd.html'), plainFill('').replace('<clipPath id="pb-clip"><rect width="16" height="8"/>', '<clipPath id="pb-clip"><rect width="0" height="0"/>'))
    fs.writeFileSync(path.join(design, 'plain-g2del.html'), plainFill('').replace(/<radialGradient id="pb-g2">[\s\S]*?<\/radialGradient>/, ''))
    fs.writeFileSync(path.join(design, 'plain-paintdel.html'), plainFill('').replace(/<linearGradient id="pb-paint">[\s\S]*?<\/linearGradient>/, ''))
    fs.writeFileSync(path.join(design, 'plain-blur.html'), plainFill('').replace('<feGaussianBlur stdDeviation="0"/>', '<feGaussianBlur stdDeviation="18"/>'))
    fs.writeFileSync(path.join(design, 'plain-blur2.html'), plainFill('').replace('<feGaussianBlur stdDeviation="0" result="b2"/>', '<feGaussianBlur stdDeviation="18" result="b2"/>'))
    fs.writeFileSync(path.join(design, 'plain-clip2.html'), plainFill('').replace('<clipPath id="pb-clip2"><path d="M0 0h16v16H0z"/>', '<clipPath id="pb-clip2"><path d="M0 0h1v1H0z"/>'))
    fs.writeFileSync(path.join(design, 'plain-blur3.html'), plainFill('').replace('<feGaussianBlur stdDeviation="0" result="b3"/>', '<feGaussianBlur stdDeviation="18" result="b3"/>'))
    fs.writeFileSync(path.join(design, 'plain-cut.html'), plainFill('').replace('<clipPath id="pb-cut"><rect width="32" height="32"/>', '<clipPath id="pb-cut"><rect width="0" height="32"/>'))
    fs.writeFileSync(path.join(design, 'plain-bmask.html'), plainFill('<style>body{mask-image:linear-gradient(transparent,transparent)}</style>'))
    fs.writeFileSync(path.join(design, 'plain-app.html'), plainFill('<style>input{appearance:none}</style>'))
    fs.writeFileSync(path.join(design, 'plain-menu.html'), plainFill('<style>.pb .pb-menu{display:block}</style>'))
    fs.writeFileSync(path.join(design, 'plain-stop.html'), plainFill('<style>stop{stop-color:transparent!important}</style>'))
    fs.writeFileSync(path.join(design, 'plain-bfade.html'), plainFill('<style>body{animation:bfade 60s}@keyframes bfade{from{opacity:0}to{opacity:1}}</style>'))
    fs.writeFileSync(path.join(design, 'plain-slide.html'), plainFill('<style>.pb{animation:pslide 60s}@keyframes pslide{from{translate:-100px 0}to{translate:none}}</style>'))
    fs.writeFileSync(path.join(design, 'plain-right.html'), plainFill('<style>.pb .pb-rt{right:200px}</style>'))
    fs.writeFileSync(path.join(design, 'plain-tnone.html'), plainFill('<style>.pb .pb-title{transform:none}</style>'))
    fs.writeFileSync(path.join(design, 'plain-tscale.html'), plainFill('<style>.pb .pb-title{transform:translateX(-50%) scale(0)}</style>'))
    fs.writeFileSync(path.join(design, 'plain-path.html'), plainFill('<style>path{stroke:none}</style>'))
    fs.writeFileSync(path.join(design, 'plain-border.html'), plainFill('<style>.pb .pb-bar{border-color:red}</style>'))
    fs.writeFileSync(path.join(design, 'shadow.html'), fill(saved, style + '<style>.cp .cp-pop{box-shadow:none}</style>', body))
    fs.writeFileSync(path.join(design, 'plain-focus.html'), plainFill('<style>.pb{background:red}</style>').replace('<section class="rl">', '<section class="rl"><input autofocus>'))
    fs.writeFileSync(path.join(design, 'plain-svgd.html'), plainFill('').replace('d="M2 8h12"', 'd="M2 2h12"'))
    fs.writeFileSync(path.join(design, 'plain-use.html'), plainFill('').replace('<use href="#pb-sq"/>', '<use href="#pb-tri"/>'))
    fs.writeFileSync(path.join(design, 'plain-defid.html'), plainFill('').replace('id="pb-sq"', 'id="pb-sq2"'))
    fs.writeFileSync(path.join(design, 'plain-deffill.html'), plainFill('<style>path{fill:none!important}</style>'))
    fs.writeFileSync(path.join(design, 'plain-img.html'), plainFill('').replace('src="assets/a.svg"', 'src="assets/b.svg"'))
    fs.writeFileSync(path.join(design, 'plain-srcset.html'), plainFill('').replace('srcset="assets/a.svg 1x"', 'srcset="assets/b.svg 1x"'))
    fs.writeFileSync(path.join(design, 'plain-br.html'), plainFill('').replace('上<br>下', '上下'))
    fs.writeFileSync(path.join(design, 'plain-unck.html'), plainFill('').replace('class="pb-r1" checked>', 'class="pb-r1">'))
    fs.writeFileSync(path.join(design, 'plain-lg2.html'), plainFill('<style>.pb-lg{background-image:url("assets/a/logo (1).svg")}</style>'))
    fs.writeFileSync(path.join(design, 'plain-mk.html'), plainFill('<style>.pb-mk{mask-image:url(#pb-narrow)}</style>'))
    fs.writeFileSync(path.join(design, 'plain-lg.html'), plainFill('<style>.pb-lg{background-image:url(assets/b.svg)}</style>'))
    fs.writeFileSync(path.join(design, 'plain-ext.html'), plainFill('').replace('assets/icons.svg#star', 'assets/icons.svg#moon'))
    fs.writeFileSync(path.join(design, 'plain-extfile.html'), plainFill('').replace('assets/icons.svg#star', 'assets/other.svg#star'))
    fs.writeFileSync(path.join(design, 'plain-outfill.html'), plainFill('<style>symbol path{fill:none!important}</style>'))
    fs.writeFileSync(path.join(design, 'plain-deepd.html'), plainFill('').replace('<path d="M2 2h12v12H2z"', '<path d="M8 1L15 15H1z"'))
    fs.writeFileSync(path.join(design, 'plain-deepg.html'), plainFill('').replace('<g transform="translate(4,0)"><path d="M2 2h12v12H2z" fill="currentColor"/></g>', '<g transform="translate(4,0)"></g><path d="M2 2h12v12H2z" fill="currentColor"/>'))
    fs.writeFileSync(path.join(design, 'plain-scale.html'), plainFill('<style>.pb-bar{scale:0}</style>'))
    fs.writeFileSync(path.join(design, 'plain-rot.html'), plainFill('<style>.pb-bar{rotate:90deg}</style>'))
    fs.writeFileSync(path.join(design, 'plain-fo.html'), plainFill('<style>svg{fill-opacity:0}</style>'))
    fs.writeFileSync(path.join(design, 'plain-bscale.html'), plainFill('<style>body{transform:scale(.5)}</style>'))
    fs.writeFileSync(path.join(design, 'plain-bpad.html'), plainFill('<style>body{padding:24px}</style>'))
    fs.writeFileSync(path.join(design, 'plain-before.html'), plainFill('').replace('<body style="margin:0">', '<body style="margin:0"><div style="height:30px">插件塞的</div>'))
    fs.writeFileSync(path.join(design, 'plain-bop.html'), plainFill('<style>html{opacity:0}</style>'))
    fs.writeFileSync(path.join(design, 'plain-ls.html'), plainFill('<style>body{letter-spacing:8px}</style>'))
    fs.writeFileSync(path.join(design, 'plain-tt.html'), plainFill('<style>body{text-transform:uppercase}</style>'))
    // 远程看：bundle.js 把 icons.svg 放进页面、id 加 dsh1- 前缀、href 改成 #dsh1-star
    fs.writeFileSync(path.join(design, 'plain-remote.html'), plainFill('').replace('href="assets/icons.svg#star"', 'data-dsh-href="assets/icons.svg#star" href="#dsh1-star"').replace('</body>', '<div aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg"><symbol id="dsh1-star" viewBox="0 0 16 16"><path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z"/></symbol></svg></div></body>'))
    const pl = [frameIssues(await run('plain.html')), frameIssues(await run('plain.html', true)), frameIssues(await run('plain-attr.html')), frameIssues(await run('plain-attr.html', true))]
    check('外框没写深色：插件写了深色、切深色，或页面自己写了 data-theme="dark" → 外框不报', pl.every((x) => x.length === 0), JSON.stringify(pl))
    const plk = [frameIssues(await run('plain-leak.html')), frameIssues(await run('plain-leak.html', true))]
    check('外框没写深色：插件样式漏到外框的字上 → 浅色深色都报', plk.every((x) => x.length === 1 && x[0].prop === 'font-weight'), JSON.stringify(plk))
    const pft = await b.withPage({ url: `${entry.origin}/plain-font.html`, w: 460, h: 640 }, async (p) => { await p.eval('document.fonts.ready'); return { w: await p.eval('document.querySelector(".pb-title").getBoundingClientRect().width'), r: frameIssues(await p.eval('window.__dshDesign.check("framed")')) } })
    check('换台电脑字体不一样（字宽变了、居中标题的平移和 margin:auto 跟着变）→ 不报', pft.r.length === 0, JSON.stringify(pft))
    const pmv = frameIssues(await run('plain-move.html'))
    check('外框里的一块挪进工具栏里面（先后顺序没变，只是换了父元素）→ 报结构被改', pmv.length === 1 && pmv[0].what === 'dom', JSON.stringify(pmv))
    const pgp = frameIssues(await run('plain-gap.html'))
    check('插件样式改了外框工具栏的 gap → 报', pgp.length === 1 && pgp[0].what === 'style' && /gap/.test(pgp[0].prop), JSON.stringify(pgp))
    const psv = frameIssues(await run('plain-svg.html'))
    check('插件写了 svg { stroke: transparent }，外框的描边图标没了 → 报', psv.length === 1 && psv[0].what === 'style' && psv[0].prop === 'stroke', JSON.stringify(psv))
    const extra = [['plain-path.html', /^stroke$/, 'path { stroke: none } 把图标里的线去掉'], ['plain-border.html', /^border-(top|bottom)-color$/, '工具栏边框变红'], ['shadow.html', /^box-shadow$/, '弹窗阴影没了'], ['plain-tnone.html', /^transform$/, '居中标题 transform 被改成 none（偏到一边）'], ['plain-right.html', /^right$/, '靠右定位的标题 right 16px 改成 200px'], ['plain-menu.html', /^display$/, '藏着的菜单 display:none 被改成 block 露出来'], ['plain-app.html', /^appearance$/, '原生勾选框 appearance:none 没了'], ['plain-stop.html', /^stop-color$/, '渐变图标的 stop 被改透明'], ['plain-tscale.html', /^transform$/, '居中标题被缩放到 0'], ['side-border.html', /^border-right-(width|style)$/, '弹窗右边框去掉'], ['fit-side.html', /^border-left-(width|style)$/, '固定宽度 border-box 的侧栏去掉左边框'], ['plain-pseudo.html', /^::before /, '.pb-x::before { content: none } 用伪元素画的关闭图标没了'], ['plain-pseudo-op.html', /^::before opacity$/, '伪元素 opacity:0'], ['plain-pseudo-vis.html', /^::before visibility$/, '伪元素 visibility:hidden'], ['plain-pseudo-sc.html', /^::before transform$/, '伪元素 scale(0)'], ['plain-pseudo-fs.html', /^::before /, '伪元素 font-size:0']]
    for (const [f, re, name] of extra) {
      const x = frameIssues(await run(f, false, 'framed', [460, 640]))
      check(`插件样式改了外框（${name}）→ 报`, x.length === 1 && x[0].what === 'style' && re.test(x[0].prop), JSON.stringify(x))
    }
    const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 800)) } } } // 页面被「文件变了」刷新打断：再开一次
    const focusIn = async (key, sel) => retry(async () => frameIssues(await b.withPage({ url: `${entry.origin}/${key}`, w: 460, h: 640 }, async (p) => { await p.eval(`document.querySelector(${JSON.stringify(sel)}).focus()`); await p.eval('window.__dshDesign.settle()'); return p.eval('window.__dshDesign.check("framed")') })))
    fs.writeFileSync(path.join(design, 'plain-slotin.html'), plainFill('').replace('<section class="rl">', '<section class="rl"><input class="q">'))
    fs.writeFileSync(path.join(design, 'popup-slotin.html'), fill(saved, style, body).replace('<span data-slot="title"></span>', '<span data-slot="title"><input class="q"></span>'))
    const hoverOn = async (key) => retry(async () => frameIssues(await b.withPage({ url: `${entry.origin}/${key}`, w: 460, h: 640 }, async (p) => { await p.eval('window.__dshDesign.settle()'); await p.mouse(60, 18); await p.eval('new Promise((r) => setTimeout(r, 50))'); const on = await p.eval('!!document.querySelector(".pb-bar:hover")'); return on ? p.eval('window.__dshDesign.check("framed")') : { notHover: true } })))
    // 用户动过外框自己的勾选框、下拉、搜索框（:checked + label 变色、输入了字）→ 不报，查完原样还回去
    const used = await retry(async () => b.withPage({ url: `${entry.origin}/plain.html`, w: 460, h: 640 }, async (p) => {
      await p.eval('window.__dshDesign.settle()')
      await p.eval('(() => { document.querySelector(".pb-ck").checked = true; document.querySelector(".pb-sel").selectedIndex = 1; const q = document.querySelector(".pb-bar input"); q.value = "abcdef"; q.blur(); q.setSelectionRange(1, 3); document.querySelector(".pb-det").open = true; const r = document.createElement("input"); r.type = "radio"; r.name = "pb-mode"; r.value = "b"; r.className = "q-r"; document.querySelector("[data-slot=main] .rl").appendChild(r); r.checked = true; const d = document.createElement("details"); d.name = "pb-acc"; d.className = "q-acc"; d.innerHTML = "<summary>槽</summary><p>槽里</p>"; document.querySelector("[data-slot=main] .rl").appendChild(d); d.open = true })()')
      await p.eval('new Promise((r) => setTimeout(r, 50))')
      const r = await p.eval('window.__dshDesign.check("framed")')
      const after = await p.eval('[document.querySelector(".pb-ck").checked, document.querySelector(".pb-sel").selectedIndex, document.querySelector(".pb-bar input").value + ":" + document.querySelector(".pb-bar input").selectionStart + "-" + document.querySelector(".pb-bar input").selectionEnd, document.querySelector(".pb-det").open, document.querySelector(".q-r").checked, document.querySelector(".pb-r1").checked, document.querySelector(".q-acc").open, document.querySelector(".pb-acc").open]')
      return { issues: frameIssues(r), after }
    }))
    check('用户勾了外框的勾选框、换了下拉、在搜索框打了字（字原样留着，不重写）、点开外框的 <details>、选了槽位里和外框同组的单选、点开槽位里和外框同名的 <details>（手风琴）→ 不报，查完都原样还在', used.issues.length === 0 && JSON.stringify(used.after) === JSON.stringify([true, 1, 'abcdef:1-3', true, true, false, true, false]), JSON.stringify(used))
    // 输入法组词中（拼音没选字）：不 blur、不查样式；组完再查
    const ime = await retry(async () => b.withPage({ url: `${entry.origin}/plain-ls.html`, w: 460, h: 640 }, async (p) => {
      await p.eval('window.__dshDesign.settle()')
      await p.eval('(() => { const q = document.querySelector(".pb-bar input"); q.focus(); q.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })) })()')
      const during = frameIssues(await p.eval('window.__dshDesign.check("framed")'))
      const still = await p.eval('document.activeElement === document.querySelector(".pb-bar input")')
      await p.eval('document.querySelector(".pb-bar input").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }))')
      const after = frameIssues(await p.eval('window.__dshDesign.check("framed")'))
      return { during, still, after }
    }))
    const pop = await retry(async () => b.withPage({ url: `${entry.origin}/plain.html`, w: 460, h: 640 }, async (p) => {
      await p.eval('window.__dshDesign.settle()')
      await p.eval('document.getElementById("pb-pop").showPopover()')
      const open = frameIssues(await p.eval('window.__dshDesign.check("framed")'))
      await p.eval('document.getElementById("pb-pop").hidePopover()')
      return { open, shut: frameIssues(await p.eval('window.__dshDesign.check("framed")')) }
    }))
    check('用户点开外框自己的 popover 气泡后体检 → 不误报；关上照常不报', pop.open.length === 0 && pop.shut.length === 0, JSON.stringify(pop))
    const tgt = await retry(async () => b.withPage({ url: `${entry.origin}/plain.html`, w: 460, h: 640 }, async (p) => {
      await p.eval('window.__dshDesign.settle()')
      await p.eval('location.hash = "pb-p1"')
      const a = frameIssues(await p.eval('window.__dshDesign.check("framed")'))
      await p.eval('location.hash = "pb-root"')
      return [a, frameIssues(await p.eval('window.__dshDesign.check("framed")'))]
    }))
    check('用户点了外框里的 #锚点（纯 CSS :target 切出面板、根元素自己 :target 变色）后体检 → 不误报', tgt.every((x) => x.length === 0), JSON.stringify(tgt))
    const dlg = await retry(async () => b.withPage({ url: `${entry.origin}/plain.html`, w: 460, h: 640 }, async (p) => {
      await p.eval('window.__dshDesign.settle()')
      await p.eval('document.querySelector(".pb-dlg").close()')
      const shut = frameIssues(await p.eval('window.__dshDesign.check("framed")'))
      const still = await p.eval('document.querySelector(".pb-dlg").open')
      await p.eval('document.querySelector(".pb-dlg").show()')
      return { shut, still, back: frameIssues(await p.eval('window.__dshDesign.check("framed")')) }
    }))
    check('外框默认开着的 <dialog>，用户关掉后体检 → 不误报、不替用户打开；再打开照常不报', dlg.shut.length === 0 && dlg.still === false && dlg.back.length === 0, JSON.stringify(dlg))
    // 普通设计（没登记的外框）里碰巧有 data-frame + data-slot 的包裹层：里面照常查对比度
    fs.writeFileSync(path.join(design, 'loose.html'), '<!doctype html><html><head><meta charset="utf-8"><title>普通</title></head><body style="margin:0;background:#fff"><div data-frame="x/y"><span data-slot="a"></span><p style="color:#eee;font-size:14px">看不清的字看不清的字</p></div></body></html>')
    await new Promise((r) => setTimeout(r, 1500))
    const loose = await run('loose.html', false, 'web', [800, 600])
    check('普通设计里碰巧带 data-frame（没登记的外框）→ 里面的字照常查对比度', (loose.issues || []).some((x) => x.type === 'contrast'), JSON.stringify(loose.issues))
    check('输入法组词中体检：不移走焦点、样式这次不查；组完照常报', ime.during.length === 0 && ime.still && ime.after.length === 1, JSON.stringify(ime))
    // 外框的雪碧图被改了（图标形状变了）→ 报外框文件被改
    const iconsPath = path.join(design, 'assets', 'icons.svg')
    const iconsWas = fs.readFileSync(iconsPath)
    fs.writeFileSync(iconsPath, iconsWas.toString().replace(/d="[^"]*"/, 'd="M0 0"'))
    await new Promise((r) => setTimeout(r, 1500))
    const astR = frameIssues(await run('plain.html'))
    fs.writeFileSync(iconsPath, iconsWas)
    await new Promise((r) => setTimeout(r, 1500))
    const astOk = frameIssues(await run('plain.html'))
    check('外框 assets/icons.svg（开头带 BOM）里的图标形状被改了 → 报「外框的文件被改了」；改回去不报', iconsWas[0] === 0xef && astR.length === 1 && astR[0].what === 'asset' && /icons\.svg/.test(astR[0].got) && astOk.length === 0, JSON.stringify([astR, astOk]))
    const hv = await hoverOn('plain-blur2.html')
    check('鼠标停在外框上：样式这次不查，CSS 引用的根外滤镜参数改了（结构）照样报', Array.isArray(hv) && hv.length === 1 && hv[0].what === 'dom', JSON.stringify(hv))
    const focused = [await focusIn('plain.html', '.pb'), await focusIn('plain.html', '.pb-bar input'), await focusIn('popup.html', '.cp-find'), await focusIn('plain-slotin.html', '.q'), await focusIn('popup-slotin.html', '.q')]
    check('外框自己的搜索框有焦点（外框 :focus-within 改了边框、字色、旁边继承颜色的字和描边图标；工具栏里还有槽位）、外框带 autofocus 焦点又挪进槽位、槽位里的输入框有焦点（外框工具栏 :focus-within 变色）→ 都不报', focused.every((x) => x.length === 0), JSON.stringify(focused))
    const back = await b.withPage({ url: `${entry.origin}/popup.html`, w: 460, h: 640 }, async (p) => { await p.eval('const i = document.querySelector(".cp-find"); i.value = "abcdef"; i.focus(); i.setSelectionRange(2, 4)'); await p.eval('window.__dshDesign.check("framed")'); return p.eval('[document.activeElement.className, document.activeElement.selectionStart, document.activeElement.selectionEnd].join()') })
    check('体检完焦点、光标原样还回外框的输入框', back === 'cp-find,2,4', back)
    // 外框带入场动画（forwards，停在 opacity .9）、一直转的图标：播完后原样不报，插件样式改到播完的元素照报
    fs.writeFileSync(path.join(design, 'plain-anleak.html'), plainFill('<style>.pb .pb-an{color:red}</style>'))
    const after = async (key) => retry(async () => frameIssues(await b.withPage({ url: `${entry.origin}/${key}`, w: 460, h: 640 }, async (p) => { await p.eval('new Promise((r) => setTimeout(r, 400))'); return p.eval('window.__dshDesign.check("framed")') })))
    const an = [await after('plain.html'), await after('plain-anleak.html')]
    check('外框入场动画播完（停在最后一帧）：原样不报；插件把它染红 → 报（不因为有过动画整块免检）', an[0].length === 0 && an[1].length === 1 && an[1][0].prop === 'color', JSON.stringify(an))
    const pfo = await focusIn('plain-focus.html', '[data-slot] input')
    check('槽位里的输入框有焦点时外框照查：根元素底色被改 → 报', pfo.length === 1 && pfo[0].prop === 'background-color', JSON.stringify(pfo))
    // 真的远程打包一遍（bundle.js：样式内联、icons.svg 放进页面、href 改成 #dsh1-star）
    fs.mkdirSync(path.join(design, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(design, 'assets', 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star" viewBox="0 0 16 16"><path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z"/></symbol></svg>')
    const bundled = bundle(fs.readFileSync(path.join(design, 'plain.html'), 'utf8'), { key: 'plain.html', read: (rel) => { try { return fs.readFileSync(path.join(design, rel)) } catch { return null } } })
    fs.writeFileSync(path.join(design, 'plain-bundled.html'), bundled)
    const uses = { 'plain-bundled': null }
    await new Promise((r) => setTimeout(r, 1500)) // 刚写的文件：等预览服务器的「文件变了」过去
    for (const f of ['plain-use', 'plain-defid', 'plain-deffill', 'plain-ext', 'plain-extfile', 'plain-outfill', 'plain-deepd', 'plain-deepg', 'plain-clipd', 'plain-g2del', 'plain-paintdel', 'plain-blur', 'plain-blur2', 'plain-blur3', 'plain-cut', 'plain-clip2', 'plain-scale', 'plain-rot', 'plain-fo', 'plain-bscale', 'plain-bop', 'plain-bmask', 'plain-bpad', 'plain-before', 'plain-ls', 'plain-tt', 'plain-img', 'plain-srcset', 'plain-lg', 'plain-lg2', 'plain-mk', 'plain-br', 'plain-unck', 'plain-remote', 'plain-bundled']) uses[f] = frameIssues(await run(`${f}.html`))
    check('SVG 引用图标：<use> 换了引用、defs 里的 id 改了、换了别的文件里的图标、换成另一个文件里同名的 → 报结构被改', ['plain-use', 'plain-defid', 'plain-ext', 'plain-extfile'].every((f) => uses[f].length === 1 && uses[f][0].what === 'dom'), JSON.stringify(uses))
    check('SVG 引用图标：图标定义在外框外面、里面又 <use> 别的图标，插件样式把最里面的 fill 去掉 → 报', uses['plain-outfill'].length === 1 && uses['plain-outfill'][0].prop === 'fill', JSON.stringify(uses['plain-outfill']))
    check('SVG 引用图标：被引用图标里再引用的图标形状改了、path 挪出带位移的 <g>、外框外面的裁剪路径改了、CSS 引用的渐变删了（外框里的、被引用图标里的）、引用的滤镜 stdDeviation 0 → 18（属性引用、SVG / HTML 元素 CSS 引用的）、::after 引用的裁剪宽度改成 0、CSS 引用的裁剪路径改了 → 报结构被改', ['plain-deepd', 'plain-deepg', 'plain-clipd', 'plain-g2del', 'plain-paintdel', 'plain-blur', 'plain-blur2', 'plain-blur3', 'plain-cut', 'plain-clip2'].every((f) => uses[f].length === 1 && uses[f][0].what === 'dom'), JSON.stringify(['plain-deepd', 'plain-deepg', 'plain-clipd', 'plain-g2del', 'plain-paintdel', 'plain-blur', 'plain-blur2', 'plain-blur3', 'plain-cut', 'plain-clip2'].map((f) => uses[f])))
    check('插件写 svg { fill-opacity: 0 } → 报', uses['plain-fo'].length >= 1 && uses['plain-fo'].some((x) => x.prop === 'fill-opacity'), JSON.stringify(uses['plain-fo']))
    check('插件写 body { mask-image: linear-gradient(transparent, transparent) }（整个外框遮没了）→ 报', uses['plain-bmask'].some((x) => x.prop === 'mask-image'), JSON.stringify(uses['plain-bmask']))
    check('插件写 body { transform: scale(.5) } / html { opacity: 0 }（外框上层）→ 报', uses['plain-bscale'].some((x) => x.prop === 'transform' && /body/.test(x.sel || '')) && uses['plain-bop'].some((x) => x.prop === 'opacity' && x.name === 'html'), JSON.stringify([uses['plain-bscale'], uses['plain-bop']]))
    const anims = {}
    for (const f of ['plain-bfade', 'plain-slide']) anims[f] = frameIssues(await run(`${f}.html`))
    check('body 淡入、外框根元素滑入的动画还在播 → 不误报（透明度、位置这次不查）', anims['plain-bfade'].length === 0 && anims['plain-slide'].length === 0, JSON.stringify(anims))
    check('插件写 body { padding: 24px }、在外框前面塞了一块 → 整个外框挪了，报', ['plain-bpad', 'plain-before'].every((f) => uses[f].length >= 1 && uses[f].some((x) => /位置/.test(x.prop || ''))), JSON.stringify([uses['plain-bpad'], uses['plain-before']]))
    check('插件写 .pb-bar { scale: 0 } / { rotate: 90deg }（不走 transform）→ 报', ['plain-scale', 'plain-rot'].every((f) => uses[f].length >= 1 && uses[f].some((x) => /scale|rotate/.test(x.prop || ''))), JSON.stringify([uses['plain-scale'], uses['plain-rot']]))
    check('插件写 body { letter-spacing: 8px } / { text-transform: uppercase } 漏到外框文字 → 报', ['plain-ls', 'plain-tt'].every((f) => uses[f].length === 1 && /letter-spacing|text-transform/.test(uses[f][0].prop || '')), JSON.stringify([uses['plain-ls'], uses['plain-tt']]))
    check('SVG 引用图标：插件写 path { fill: none !important }，<use> 画的图标没了 → 报', uses['plain-deffill'].length === 1 && uses['plain-deffill'][0].prop === 'fill', JSON.stringify(uses['plain-deffill']))
    check('SVG 引用图标：远程看把 icons.svg 打包进页面（#dsh1-star）→ 不报（手写的、真用 bundle.js 打包的都试）', uses['plain-remote'].length === 0 && bundled.includes('data-dsh-href="assets/icons.svg#star"') && uses['plain-bundled'].length === 0, JSON.stringify([uses['plain-remote'], uses['plain-bundled'], bundled.includes('#dsh1-star')]))
    check('外框的 <img src="assets/a.svg"> 换成同目录另一张 b.svg → 报结构被改；真用 bundle.js 打包（图、行内样式里的图变 data:）→ 不报', uses['plain-img'].length === 1 && uses['plain-img'][0].what === 'dom' && bundled.includes('data-dsh-src="assets/a.svg"') && bundled.includes('data-dsh-style="') && uses['plain-bundled'].length === 0, JSON.stringify([uses['plain-img'], uses['plain-bundled']]))
    check('外框的 <img srcset="assets/a.svg 1x"> 换成 b.svg → 报结构被改', uses['plain-srcset'].length === 1 && uses['plain-srcset'][0].what === 'dom', JSON.stringify(uses['plain-srcset']))
    check('插件样式把外框 url("assets/logo (1).svg") 的背景图换成 b.svg → 报背景图被改；真打包（换成 data:）→ 不报', uses['plain-lg'].length === 1 && uses['plain-lg'][0].prop === 'background-image' && uses['plain-bundled'].length === 0 && !bundled.includes('logo (1).svg")'), JSON.stringify(uses['plain-lg']))
    check('插件样式把背景图换成别的目录里同名的图（assets/a/logo (1).svg）、遮罩 url(#pb-wide) 换成 url(#pb-narrow) → 报', uses['plain-lg2'].length === 1 && uses['plain-lg2'][0].prop === 'background-image' && uses['plain-mk'].length === 1 && uses['plain-mk'][0].prop === 'mask-image', JSON.stringify([uses['plain-lg2'], uses['plain-mk']]))
    check('删了外框里的 <br>、删了单选框默认选中的 checked → 报结构被改（指纹记全部属性和 <br>）', ['plain-br', 'plain-unck'].every((f) => uses[f].length === 1 && uses[f][0].what === 'dom'), JSON.stringify([uses['plain-br'], uses['plain-unck']]))
    check('外框 srcset 用外网地址、逗号后没空格，图片地址带 &amp;：远程打包后不误报、外网地址原样不动', bundled.includes('srcset="http://127.0.0.1:9/x.png 1x,http://127.0.0.1:9/y.png 2x"') && bundled.includes('src="http://127.0.0.1:9/q.png?a=1&amp;b=2"') && uses['plain-bundled'].length === 0, JSON.stringify(uses['plain-bundled']))
    check('外框写 fill: url("assets/paint.svg#pg")、filter: url("assets/fx.svg#pf")（引用外部 SVG）：原样用、远程打包都不误报（外框库和设计目录端口不一样）', uses['plain-remote'].length === 0 && uses['plain-bundled'].length === 0 && uses['plain-br'].length === 1, '')
    check('外框的样式文件开头带 BOM（记事本存的）→ 原样打开不误报「外框的文件被改了」', fs.readFileSync(path.join(LIB, 'plain-bar', 'plain.css'))[0] === 0xef && uses['plain-remote'].length === 0, '')
    const psd = frameIssues(await run('plain-svgd.html'))
    check('改了外框 SVG 图标的形状（path d）→ 报结构被改', psd.length === 1 && psd[0].what === 'dom', JSON.stringify(psd))
    // 只用 @media 写深浅色的外框：默认深底，浅色媒体改白底，深色媒体只改字色。浅色系统在画布上切深色、深色系统、浅色都不报
    const mediaSrc = path.join(tmp, 'src-media')
    fs.mkdirSync(mediaSrc)
    fs.writeFileSync(path.join(mediaSrc, 'frame.json'), JSON.stringify({ id: 'media-bar', name: '媒体工具栏', size: [460, 640], css: ['m.css'], frames: [{ id: 'main', file: 'main.html', name: '主页', slots: { main: '内容' } }] }))
    fs.writeFileSync(path.join(mediaSrc, 'm.css'), '.mb{width:460px;height:640px;margin:0 auto;background:#222;color:#ddd;font:13px/1.4 system-ui,sans-serif}.mb-bar{height:36px;padding:0 10px}@media (prefers-color-scheme: light){.mb{background:#eee}}@media (prefers-color-scheme: dark){.mb{color:#fff;width:450px}.mb-ic circle{fill:url(#mb-d)}}.mb-ic circle{fill:url(#mb-l)}')
    fs.writeFileSync(path.join(mediaSrc, 'main.html'), '<!doctype html><html><head><meta charset="utf-8"><title>媒体</title><link rel="stylesheet" href="m.css"></head><body style="margin:0"><div class="mb" data-frame="media-bar/main"><div class="mb-bar"><b>工具栏</b><svg class="mb-ic" width="16" height="16"><defs><radialGradient id="mb-l"><stop offset="0" stop-color="#fc0"/><stop offset="1" stop-color="#f60"/></radialGradient><radialGradient id="mb-d"><stop offset="0" stop-color="#36f"/><stop offset="1" stop-color="#003"/></radialGradient></defs><circle cx="8" cy="8" r="7"/></svg></div><div data-slot="main"></div></div></body></html>')
    const mr = await saveFrame({ browser: b, src: mediaSrc, dir: LIB })
    fs.copyFileSync(path.join(LIB, 'media-bar', 'm.css'), path.join(design, 'm.css'))
    fs.writeFileSync(path.join(design, 'media.html'), mr.ok ? fs.readFileSync(path.join(LIB, 'media-bar', 'main.html'), 'utf8') : '')
    if (!mr.ok) check('只用 @media 写深浅色的外框：存成了', false, mr.text)
    // 刚写进设计目录的文件：预览服务器可能晚一点发「文件变了」让页面刷新 → 等一下，失败再开一次
    await new Promise((r) => setTimeout(r, 1500))
    const toggled = async (key) => {
      for (let i = 0; ; i++) {
        try { return frameIssues(await b.withPage({ url: `${entry.origin}/${key}`, w: 460, h: 640 }, async (p) => { await p.eval('window.__dshDesign.dark(true)'); await p.eval('window.__dshDesign.settle()'); return p.eval('window.__dshDesign.check("framed")') })) } catch (e) { if (i >= 2) throw e }
      }
    }
    const md = !mr.ok ? [] : [frameIssues(await run('media.html')), frameIssues(await run('media.html', true)), await toggled('media.html'), await toggled('popup.html'), await toggled('plain.html')]
    check('只用 @media 写深浅色的外框：浅色、深色系统、浅色系统上在画布切深色都不报（别的外框画布切深色也不报）', mr.ok && md.every((x) => x.length === 0), JSON.stringify([mr.ok || mr.text, md]))
    // 屏幕缩放：存外框在 1 倍屏量，画布在 Windows 125% / 150%、Retina 2 倍下查（边框、字高会差零点几像素）
    // 用 --force-device-scale-factor 开浏览器（像真屏幕那样）：只改页面的 deviceScaleFactor 时 Chrome 不按设备像素取整边框，测不出来
    const scaledBrowser = (scale) => createBrowser({ bin, launch: (cmd, args, opts) => spawn(cmd, [...args, `--force-device-scale-factor=${scale}`], opts) })
    const sc = []
    let sct = null
    for (const scale of [1.25, 2]) {
      const bs = scaledBrowser(scale)
      try {
        for (const f of ['popup.html', 'fit-wide.html', 'fit-icon.html', 'plain.html']) sc.push(frameIssues((await measureAll(bs, { screens: [{ key: f, url: `${entry.origin}/${f}`, label: f }], sizes: [[460, 640]], kind: 'framed', dark: false }))[0]))
        if (scale === 1.25) sct = frameIssues((await measureAll(bs, { screens: [{ key: 'tall', url: `${entry.origin}/tall.html`, label: 'tall' }], sizes: [[460, 640]], kind: 'framed', dark: false }))[0])
      } finally { bs.stop() }
    }
    check('屏幕缩放（125% / 200%）：原样的外框不报（含 translate(-50%) 居中的字）', sc.length === 8 && sc.every((x) => x.length === 0), JSON.stringify(sc))
    check('屏幕缩放 125%：插件样式把工具栏改高 → 照样报', sct && sct.length === 1 && sct[0].prop === 'height', JSON.stringify(sct))

    // 别的类型的页面碰巧有 data-frame / data-slot：不报「没登记」
    const nsw = frameIssues(await run('nosig.html', false, 'web'))
    check('普通网页碰巧有 data-frame、data-slot → 不报「外框没登记」', nsw.length === 0, JSON.stringify(nsw))
    // 同 id 再存一次：旧的换成新的，库里不留临时目录、备份目录
    const again = await saveFrame({ browser: b, src: plainSrc, dir: LIB })
    check('同 id 再存：换成新的，不留 . 开头的临时 / 备份目录', again.ok && fs.existsSync(path.join(LIB, 'plain-bar', 'main.html')) && !fs.readdirSync(LIB).some((x) => x.startsWith('.')), JSON.stringify(fs.readdirSync(LIB)))
    // 直接拿库里的目录当源再存（模型在库里改完就存）：不丢文件
    const self = await saveFrame({ browser: b, src: path.join(LIB, 'plain-bar'), dir: LIB })
    check('拿库里的目录当源再存：存成了，文件都在', self.ok && ['frame.json', 'plain.css', 'main.html'].every((f) => fs.existsSync(path.join(LIB, 'plain-bar', f))), self.text)
    // DSH 自带外框：没有指纹那段，照旧按表查；同一段代码算出来的指纹和表里一样
    const sigs = Object.fromEntries([...fs.readFileSync(new URL('../lib/picker.js', import.meta.url), 'utf8').matchAll(/'(dsh\/\w+)': '([0-9a-f]{8})'/g)].map((m) => [m[1], m[2]]))
    const got = {}
    for (const f of ['sidebar', 'settings', 'view', 'panel']) {
      got[`dsh/${f}`] = await b.withPage({ url: `${entry.origin}/dsh-${f}.html`, w: 1280, h: 800 }, async (p) => { await p.eval('window.__dshDesign.settle()'); return (await p.eval('window.__dshDesign.frameInfo()')).sig1 })
    }
    check('DSH 外框：存外框那段代码算出来的指纹和体检表里的四个一样', Object.keys(sigs).length === 4 && Object.entries(sigs).every(([k, v]) => got[k] === v), JSON.stringify({ sigs, got }))
    const dshRows = []
    for (const f of ['sidebar', 'view']) for (const dark of [false, true]) dshRows.push(frameIssues(await run(`dsh-${f}.html`, dark, 'dshplugin', [1280, 800])))
    check('DSH 外框：原样的照旧不报（浅色、深色）', dshRows.every((x) => x.length === 0), JSON.stringify(dshRows))
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
