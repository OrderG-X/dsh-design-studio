/**
 * 专属调节滑块（tweaks.js + 预览页面里的 picker）：
 *   node test/test-tweaks.mjs
 *
 * 读 tweaks.json（滑块 / 取色 / 几选一、写错了怎么说）；值规整；写回文件（tokens.css 的默认值、每屏 <html> 上的属性、tweaks.json 的 value）；
 * 体检（滑块有没有真接上）；写回走版本（core.js 的 editDir：改前改后各存一版、模型干活时不改）；
 * 本机装着 Chrome / Edge 时再真开一回：页面收到 tweak 后 CSS 变量和属性真变了，撤掉还原
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseTweaks, normValue, cssValue, shownValue, readTweaks, setVarDecl, setHtmlAttr, applyTweaks, lintTweaks, MAX_TWEAKS } from '../lib/tweaks.js'
import { createTracker, parseTarget } from '../lib/core.js'
import { createHistory } from '../lib/history.js'
import { createHub } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'
import { prepare } from '../lib/look.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tweaks-')))

const SAMPLE = {
  tweaks: [
    { id: 'density', label: '留白', var: '--density', min: 0.8, max: 1.4, step: 0.05, value: 1 },
    { id: 'radius', label: '圆角', var: '--radius-md', min: 0, max: 28, unit: 'px', value: 12, note: '卡片和按钮' },
    { id: 'brand', label: '主色', var: '--color-primary', type: 'color', value: 'rgb(194, 106, 50)' },
    { id: 'layout', label: '商品排法', attr: 'data-layout', options: [{ label: '两列', value: 'grid' }, { label: '大图', value: 'list' }], value: 'grid' },
  ],
}

// ── 读 ──
{
  const r = parseTweaks(JSON.stringify(SAMPLE))
  const [d, rad, br, lay] = r.list
  check('读：四个都认出来，没有错', r.list.length === 4 && !r.errors.length, JSON.stringify(r.errors))
  check('读：滑块带范围、步长、单位', d.kind === 'range' && d.min === 0.8 && d.step === 0.05 && rad.unit === 'px' && rad.note === '卡片和按钮')
  check('读：取色的值规整成 #rrggbb', br.kind === 'color' && br.value === '#c26a32', br.value)
  check('读：几选一（属性）', lay.kind === 'choice' && lay.attr === 'data-layout' && lay.options.length === 2 && lay.value === 'grid')
  check('读：也可以直接是数组；选项可以写成对象', parseTweaks(JSON.stringify([{ label: '排法', var: '--cols', options: { 两列: '2', 三列: '3' }, value: '3' }])).list[0].value === '3')
}
{
  const r = parseTweaks(JSON.stringify({ tweaks: [{ label: '坏的' }, { label: '没范围', var: '--x' }, { label: '属性没选项', attr: 'data-x' }, { label: '坏属性', attr: 'onclick', options: ['a', 'b'] }] }))
  check('读：写错的每个都说清楚', r.list.length === 0 && r.errors.length === 4 && /var/.test(r.errors[0]) && /min、max/.test(r.errors[1]) && /options/.test(r.errors[2]), JSON.stringify(r.errors))
  check('读：不是 JSON / 没有 tweaks 数组', /不是合法的 JSON/.test(parseTweaks('{').errors[0]) && /"tweaks"/.test(parseTweaks('{}').errors[0]))
  const many = parseTweaks(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ var: `--v${i}`, min: 0, max: 1 }))))
  check(`读：最多 ${MAX_TWEAKS} 个，多的只说一次`, many.list.length === MAX_TWEAKS && many.errors.length === 1, JSON.stringify(many.errors))
  check('读：选项值里不许有 < > " ; { }', parseTweaks(JSON.stringify([{ var: '--x', options: ['a', 'b;}'] }])).list.length === 0)
  check('读：id 重复的自动改名', parseTweaks(JSON.stringify([{ id: 'a', var: '--a', min: 0, max: 1 }, { id: 'a', var: '--b', min: 0, max: 1 }])).list.map((k) => k.id).join() === 'a,a-2')
}
{
  const [d, rad, br, lay] = parseTweaks(JSON.stringify(SAMPLE)).list
  check('值：越界的夹住、按步长取整', normValue(d, 9) === 1.4 && normValue(d, 1.12) === 1.1 && normValue(rad, '13.4') === 13)
  {
    const [odd, inf, opt] = parseTweaks(JSON.stringify([{ id: 'a', var: '--a', min: 1, max: 6, step: 4, value: 6 }, { id: 'b', var: '--b', min: 0, max: 1, step: 'Infinity' }, { id: 'c', var: '--c', options: ['a/*', 'b', '$&x', 'c!important', 'd e'] }])).list
    check('值：从 min 起按步长取整，不跑出范围', normValue(odd, 0) === 1 && normValue(odd, 100) === 5 && odd.value === 5, JSON.stringify(odd))
    check('值：步长不是有限正数就按 100 格', inf.step === 0.01)
    check('选项：注释、$、! 这些会写坏样式的不收', JSON.stringify(opt.options.map((o) => o.value)) === '["b","d e"]', JSON.stringify(opt.options))
    const [paren] = parseTweaks(JSON.stringify([{ var: '--p', options: ['1', '(', '[', 'calc(', 'a)', 'calc(1px + 2px)', 'url(a.png)'] }])).list
    check('选项：括号不成对的不收（会把后面的样式吞掉）', JSON.stringify(paren.options.map((o) => o.value)) === '["1","calc(1px + 2px)","url(a.png)"]', JSON.stringify(paren.options))
    const bad = (o) => parseTweaks(JSON.stringify([{ var: '--z', ...o }]))
    check('滑块：太小、太大、小数太多的范围不收（写回分不出来）', [{ min: 1e-7, max: 6e-7 }, { min: -1e308, max: 1e308 }, { min: 0, max: 1e-323 }, { min: 1.0000004, max: 1.0000005, step: 1e-7 }].every((o) => bad(o).list.length === 0 && bad(o).errors.length === 1))
    check('滑块：步长小数太多就按 100 格', bad({ min: 0, max: 1, step: 1e-7 }).list[0].step === 0.01)
  }
  check('值：颜色规整，认不出给 null', normValue(br, 'red') === '#ff0000' && normValue(br, 'nope') === null)
  check('值：不在选项里给 null', normValue(lay, 'list') === 'list' && normValue(lay, 'x') === null)
  check('值：写进 CSS 带单位；给人看的选项显示名字', cssValue(rad, 16) === '16px' && shownValue(lay, 'list') === '大图')
}

// ── 写回的几个小函数 ──
{
  const css = '/* --density: 9 */\n:root {\n  --density: 1;\n  --radius-md: 12px;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --density: 1; }\n}\n.card { --density: 2; }\n'
  const out = setVarDecl(css, '--density', '1.2')
  check('写变量：改顶层 :root 那条，注释、@media 里的、别的选择器上的不动', out.includes(':root {\n  --density: 1.2;') && out.includes('/* --density: 9 */') && out.includes(':root { --density: 1; }') && out.includes('.card { --density: 2; }'), out)
  check('写变量：没有 :root 上的声明给 null', setVarDecl('.a { --x: 1 }', '--x', '2') === null)
  check('写变量：html 选择器也算', setVarDecl('html { --x: 1 }', '--x', '2') === 'html { --x: 2 }')
  // 实测：模型在 tokens.css 末尾又补了一段 :root 重写同一个变量，只改第一处等于没改
  const twice = ':root { --r: 16px; }\n/* 补充 */\n:root { --r: 16px; --d: 1; }\n'
  check('写变量：同一个变量顶层写了两遍，两处都改', setVarDecl(twice, '--r', '4px') === ':root { --r: 4px; }\n/* 补充 */\n:root { --r: 4px; --d: 1; }\n', setVarDecl(twice, '--r', '4px'))
  // 审查（Astra 0.6）报的几种写法
  check('写变量：字符串里的 /* */ 不当注释', setVarDecl(':root{--label:"/*";--r:1px;--label2:"*/";}', '--r', '9px') === ':root{--label:"/*";--r:9px;--label2:"*/";}')
  check('写变量：别的变量值里的「--r:」不算', setVarDecl(':root{--label: --r:1px; --r:2px;}', '--r', '9px') === ':root{--label: --r:1px; --r:9px;}')
  check('写变量：前面隔着注释的也认', setVarDecl(':root{ /* c */ --r: 1px }', '--r', '9px') === ':root{ /* c */ --r: 9px }')
  check('写属性：别的属性引号里的同名字不算', setHtmlAttr('<html data-note="example data-layout=grid" data-layout="grid"><body>', 'data-layout', 'list') === '<html data-note="example data-layout=grid" data-layout="list"><body>')
  check('写属性：大写、没引号、自闭合', setHtmlAttr('<HTML LANG=zh DATA-X=1>', 'data-x', '2') === '<HTML LANG=zh data-x="2">' && setHtmlAttr('<html/>', 'data-x', '1') === '<html data-x="1"/>')
  check('写变量：--r 不碰 --other--r', setVarDecl(':root { --other--r: 1px; --r: 2px; }', '--r', '9px') === ':root { --other--r: 1px; --r: 9px; }')
  check('写变量：字符串里的假声明不碰、引号不丢', setVarDecl(':root { --q: "--r: 1;"; --r: 2px; }', '--r', '9px') === ':root { --q: "--r: 1;"; --r: 9px; }')
  check('写变量：!IMPORTANT（大写）留着', setVarDecl(':root { --r: 2px !IMPORTANT; }', '--r', '9px') === ':root { --r: 9px !IMPORTANT; }')
  check('写变量：值里 url(data:…;…) 整段换掉', setVarDecl(':root { --bg: url(data:image/png;base64,AAA); }', '--bg', 'none') === ':root { --bg: none; }')
  check('写属性：注释、脚本里的 <html> 不算', setHtmlAttr('<!-- <html> --><!doctype html><html lang="zh">', 'data-x', 'a') === '<!-- <html> --><!doctype html><html lang="zh" data-x="a">')
  check('写属性：值里的 $& 不当替换写法', setHtmlAttr('<html data-x="1">', 'data-x', 'a$&b') === '<html data-x="a$&amp;b">')
  const onlyDark = '@media (prefers-color-scheme: dark) { :root { --x: 1; } }\n@media print { :root { --x: 3; } }'
  check('写变量：只有 @media 里有时默认不改，nested 才改第一处', setVarDecl(onlyDark, '--x', '2') === null && setVarDecl(onlyDark, '--x', '2', true) === '@media (prefers-color-scheme: dark) { :root { --x: 2; } }\n@media print { :root { --x: 3; } }')
}
check('写属性：没有就加在 <html> 上', setHtmlAttr('<!doctype html><html lang="zh"><body>', 'data-layout', 'list') === '<!doctype html><html lang="zh" data-layout="list"><body>')
check('写属性：有就改', setHtmlAttr('<html data-layout="grid" lang="zh">', 'data-layout', 'list') === '<html data-layout="list" lang="zh">')
check('写属性：前缀一样的别的属性不碰', setHtmlAttr('<html data-layout-x="1">', 'data-layout', 'list') === '<html data-layout-x="1" data-layout="list">', setHtmlAttr('<html data-layout-x="1">', 'data-layout', 'list'))
check('写属性：没有 <html> 给 null', setHtmlAttr('<div>', 'data-x', 'a') === null)

// ── 设计目录：写回、体检 ──
const dir = path.join(tmp, 'shop')
fs.mkdirSync(dir)
const TOKENS = ':root {\n  --density: 1;\n  --radius-md: 12px;\n  --color-primary: #c26a32;\n}\n'
const PAGE = (title) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="app.css"></head><body><div class="cards"><div class="card">${title}</div><div class="card">B</div></div></body></html>`
const APP = '.card { padding: calc(16px * var(--density)); border-radius: var(--radius-md); background: var(--color-primary) }\n.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px }\n[data-layout="list"] .cards { grid-template-columns: 1fr }\n'
fs.writeFileSync(path.join(dir, 'tokens.css'), TOKENS)
fs.writeFileSync(path.join(dir, 'app.css'), APP)
fs.writeFileSync(path.join(dir, 'home.html'), PAGE('首页'))
fs.writeFileSync(path.join(dir, 'list.html'), PAGE('列表'))
check('读文件：没有 tweaks.json 给 null', readTweaks(dir) === null)
fs.writeFileSync(path.join(dir, 'tweaks.json'), JSON.stringify(SAMPLE, null, 2))
check('读文件：有就读出来，同一个文件再读用缓存', readTweaks(dir).list.length === 4 && readTweaks(dir) === readTweaks(dir))
check('体检：都接上了就没话说', lintTweaks(dir).length === 0, JSON.stringify(lintTweaks(dir)))
{
  const r = applyTweaks(dir, { density: 1.2, radius: 20, brand: '#336699', layout: 'list', nope: 1 })
  const tok = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8')
  const tw = JSON.parse(fs.readFileSync(path.join(dir, 'tweaks.json'), 'utf8'))
  check('写回：四项都改了，说出从什么到什么', r.ok && r.changed.length === 4 && r.changed.find((c) => c.id === 'layout').to === '大图' && r.changed.find((c) => c.id === 'radius').from === '12px', JSON.stringify(r.changed))
  check('写回：变量的默认值写进 tokens.css', tok.includes('--density: 1.2;') && tok.includes('--radius-md: 20px;') && tok.includes('--color-primary: #336699;'), tok)
  check('写回：属性写到每屏的 <html> 上', ['home.html', 'list.html'].every((f) => /<html lang="zh" data-layout="list">/.test(fs.readFileSync(path.join(dir, f), 'utf8'))))
  check('写回：tweaks.json 的 value 跟着改', tw.tweaks[0].value === 1.2 && tw.tweaks[1].value === 20 && tw.tweaks[2].value === '#336699' && tw.tweaks[3].value === 'list')
  check('写回：改了哪些文件', ['tokens.css', 'home.html', 'list.html', 'tweaks.json'].every((f) => r.files.includes(f)) && !r.files.includes('app.css'), r.files.join())
  check('写回：和现在一样的值不算改动', applyTweaks(dir, { density: 1.2 }).changed.length === 0)
}
{
  fs.writeFileSync(path.join(dir, 'tweaks.json'), JSON.stringify({ tweaks: [...SAMPLE.tweaks, { id: 'gap', label: '间距', var: '--gap', min: 0, max: 40, unit: 'px', value: 8 }] }))
  const r = applyTweaks(dir, { gap: 16 })
  check('写回：样式里找不到默认值的记下来，不写', r.missed.length === 1 && r.missed[0].label === '间距' && !r.changed.length)
  const lint = lintTweaks(dir)
  check('体检：没被用到的变量说出来', lint.some((x) => /间距/.test(x) && /var\(--gap\)/.test(x)), JSON.stringify(lint))
  fs.writeFileSync(path.join(dir, 'tweaks.json'), JSON.stringify({ tweaks: [{ id: 'cols', label: '列数', attr: 'data-cols', options: ['2', '3'], value: '2' }, { id: 'tone', label: '色调', attr: 'data-layout', options: ['list', 'masonry'], value: 'list' }] }))
  const lint2 = lintTweaks(dir)
  check('体检：没有样式按属性区分 / 别的选项没有规则', lint2.some((x) => /列数/.test(x) && /data-cols/.test(x)) && lint2.some((x) => /色调/.test(x) && /masonry/.test(x)), JSON.stringify(lint2))
  fs.writeFileSync(path.join(dir, 'tweaks.json'), '{ broken')
  check('体检：tweaks.json 写坏了也说', /不是合法的 JSON/.test(lintTweaks(dir)[0]))
  fs.writeFileSync(path.join(dir, 'tweaks.json'), JSON.stringify(SAMPLE, null, 2))
}
{
  // 同一个变量在 tokens.css 和 app.css 顶层都写了：两处都改；只在深色 @media 里有的退到那一处
  const d2 = path.join(tmp, 'twice')
  fs.mkdirSync(d2)
  fs.writeFileSync(path.join(d2, 'tokens.css'), ':root { --radius-md: 16px; --density: 1; }\n')
  fs.writeFileSync(path.join(d2, 'app.css'), ':root { --radius-md: 16px; }\n@media (prefers-color-scheme: dark) { :root { --color-primary: #c26a32; } }\n.card { border-radius: var(--radius-md); padding: calc(8px * var(--density)); background: var(--color-primary) }\n')
  fs.writeFileSync(path.join(d2, 'home.html'), PAGE('首页'))
  fs.writeFileSync(path.join(d2, 'tweaks.json'), JSON.stringify({ tweaks: SAMPLE.tweaks.slice(0, 3) }))
  const r = applyTweaks(d2, { radius: 4, brand: '#336699' })
  const tok = fs.readFileSync(path.join(d2, 'tokens.css'), 'utf8')
  const app = fs.readFileSync(path.join(d2, 'app.css'), 'utf8')
  check('写回：两份样式顶层都有的变量，两处都改', r.ok && tok.includes('--radius-md: 4px;') && app.includes(':root { --radius-md: 4px; }'), tok + app)
  check('写回：只在 @media 里有的变量退到那一处', app.includes(':root { --color-primary: #336699; }') && !r.missed.length, JSON.stringify(r))
}
if (process.platform !== 'win32') {
  // 软链接：指到设计目录外的样式、tweaks.json 不写
  const d3 = path.join(tmp, 'links')
  const outside = path.join(tmp, 'outside.css')
  fs.mkdirSync(d3)
  fs.writeFileSync(outside, ':root { --radius-md: 16px; }\n')
  fs.symlinkSync(outside, path.join(d3, 'tokens.css'))
  fs.writeFileSync(path.join(d3, 'home.html'), PAGE('首页'))
  fs.writeFileSync(path.join(d3, 'tweaks.json'), JSON.stringify({ tweaks: SAMPLE.tweaks.slice(1, 2) }))
  const r = applyTweaks(d3, { radius: 4 })
  check('写回：软链接到目录外的样式不写', fs.readFileSync(outside, 'utf8').includes('16px') && r.missed.length === 1, JSON.stringify(r))
  const tw2 = path.join(tmp, 'outside.json')
  fs.writeFileSync(tw2, JSON.stringify({ tweaks: SAMPLE.tweaks.slice(1, 2) }))
  fs.rmSync(path.join(d3, 'tweaks.json'))
  fs.symlinkSync(tw2, path.join(d3, 'tweaks.json'))
  check('写回：tweaks.json 是软链接就整个不写', applyTweaks(d3, { radius: 8 }).ok === false && !fs.readFileSync(tw2, 'utf8').includes('"value": 8'))
  fs.writeFileSync(tw2, 'SECRET_OUTSIDE')
  check('读：tweaks.json 是软链接当没有（目录外的内容不会出现在报错里）', readTweaks(d3) === null)
}

// ── 写回走版本：editDir ──
{
  const history = createHistory({ base: path.join(tmp, 'history'), log: () => {} })
  const tracker = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:1', url: 'http://127.0.0.1:1/home.html' }), log: () => {}, history, store: { load: () => ({}), save: () => {} }, alive: () => true })
  await tracker.setTarget('s1', parseTarget(path.join(dir, 'home.html')), { source: 'user', popup: false })
  const before = tracker.versions('s1').length
  const r = tracker.editDir('s1', (root) => applyTweaks(root, { density: 1.3 }), (x) => `调节：${x.changed.map((c) => c.label).join()}`)
  const vs = tracker.versions('s1')
  check('editDir：写回了，改后存了一版带说明', r.ok && r.changed.length === 1 && vs.length > before && vs.some((v) => /调节：留白/.test(v.label)), JSON.stringify(vs.map((v) => v.label)))
  tracker.observe('s1', { type: 'turn_started' })
  tracker.stateOf('s1').turn = true
  check('editDir：模型在干活时不改', tracker.editDir('s1', (root) => applyTweaks(root, { density: 1 })).reason === 'busy' && /--density: 1\.3/.test(fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8')))
  tracker.stateOf('s1').turn = false
  check('editDir：开发服务器的预览不改', tracker.editDir('nobody', () => ({ ok: true })).reason === 'not-file')
}

// ── 真浏览器：页面收到 tweak ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  const hub = createHub({ parents: () => [] })
  const entry = await hub.open({ kind: 'file', root: dir })
  const b = createBrowser({ bin })
  try {
    const r = await b.withPage({ url: `${entry.origin}/home.html`, w: 600, h: 400 }, async (page) => {
      await prepare(page, false)
      const read = () => page.eval(`(() => { const c = document.querySelector('.card'); const s = getComputedStyle(c); return { pad: s.paddingTop, radius: s.borderTopLeftRadius, bg: s.backgroundColor, cols: getComputedStyle(document.querySelector('.cards')).gridTemplateColumns.split(' ').length, attr: document.documentElement.getAttribute('data-layout') } })()`)
      const a = await read()
      await page.eval(`window.__dshDesign.tweak({ '--density': '1.5', '--radius-md': '2px', '--color-primary': '#336699' }, { 'data-layout': 'grid' })`)
      const b2 = await read()
      await page.eval('window.__dshDesign.tweak({}, {})')
      const c = await read()
      return { a, b: b2, c }
    })
    check('真浏览器：拖滑块（CSS 变量）页面跟着变', r.b.pad === '24px' && r.b.radius === '2px' && r.b.bg === 'rgb(51, 102, 153)', JSON.stringify(r))
    check('真浏览器：几选一（<html> 属性）页面跟着变', r.a.cols === 1 && r.a.attr === 'list' && r.b.cols === 2 && r.b.attr === 'grid', JSON.stringify(r))
    check('真浏览器：撤掉后回到文件里的样子（原来的属性还原）', r.c.pad === r.a.pad && r.c.radius === r.a.radius && r.c.attr === 'list' && r.c.cols === 1, JSON.stringify(r))
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
