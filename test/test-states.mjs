/**
 * #30 交互式原型：一页多状态（states.js）、共用部件各屏写得不一样（drift.js）、预览页按 ?state= 设好状态、转代码说明里的状态
 *   node test/test-states.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseStates, statesOfHtml, statesOfFile, withState, expandStates, splitStateNames, stateName, MAX_STATES } from '../lib/states.js'
import { cssRules, partSel, compareParts, partDrift, formatDrift } from '../lib/drift.js'
import { ERR_CATCHER, stateScript, injectPicker } from '../lib/serve.js'
import { statesMd } from '../lib/handoff.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 状态怎么写 ──
check('状态：名字 + 中文名，第一个是默认', same(parseStates('default:有数据, empty:空列表，paid：已付款'), [{ name: 'default', label: '有数据' }, { name: 'empty', label: '空列表' }, { name: 'paid', label: '已付款' }]))
check('状态：不到两个当没写', parseStates('default').length === 0 && parseStates('').length === 0)
check('状态：怪名字（中文、空格、引号）不要，重名只留一个', same(parseStates('a, 已付款, b c, "x", a, b').map((x) => x.name), ['a', 'b']))
check(`状态：最多 ${MAX_STATES} 个`, parseStates(Array.from({ length: 12 }, (_, i) => 's' + i).join(',')).length === MAX_STATES)
check('状态：从 <head> 的 meta 里读（单引号、属性顺序随意也认）', same(statesOfHtml(`<html><head><meta content='a:甲,b:乙' name="dsh-states"></head>`).map((x) => x.label), ['甲', '乙']))
check('状态：别的 meta 不认', statesOfHtml('<meta name="dsh-design" content="app">').length === 0)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-states-'))
fs.writeFileSync(path.join(tmp, 'order.html'), '<!doctype html><html data-state="default"><head><meta name="dsh-states" content="default:待付款, paid:已付款"></head><body></body></html>')
check('状态：读文件', statesOfFile(path.join(tmp, 'order.html')).length === 2 && statesOfFile(path.join(tmp, 'nope.html')).length === 0)
check('状态：地址加上 / 去掉 ?state=，怪名字不加', withState('http://h/order.html?x=1', 'paid') === 'http://h/order.html?x=1&state=paid' && withState('http://h/order.html?state=paid', '') === 'http://h/order.html' && withState('http://h/a.html', 'a b') === 'http://h/a.html')
check('状态：体检里怎么称呼', stateName('order.html', 'paid', '已付款') === 'order.html（状态 paid「已付款」）' && stateName('order.html', 'a', 'a') === 'order.html（状态 a）' && stateName('home.html', '') === 'home.html')

// ── 体检按状态展开 ──
const list = [{ key: 'home.html', url: 'http://h/home.html' }, { key: 'order.html', url: 'http://h/order.html' }]
const sts = { 'order.html': parseStates('default:待付款, paid:已付款, empty:空') }
const ex = expandStates(list, (sc) => sts[sc.key])
check('体检展开：没写状态的屏原样；写了的默认那行 key 不变、后面紧跟其余状态各一行', same(ex.list.map((x) => x.key), ['home.html', 'order.html', 'order.html?state=paid', 'order.html?state=empty']) && ex.skipped === 0)
check('体检展开：状态那行带地址、原屏、状态名', ex.list[2].url === 'http://h/order.html?state=paid' && ex.list[2].base === 'order.html' && ex.list[2].stateLabel === '已付款' && ex.list[1].state === 'default')
const many = expandStates(list, () => parseStates('a,b,c,d,e,f,g,h'), { perScreen: 3, extra: 3 })
check('体检展开：每屏最多量几个、总共最多多几行，没量的数得出来', many.list.length === 2 + 3 && many.skipped === (8 - 3) * 2 - 0 + (2 * 2 - 3), `${many.list.length} ${many.skipped}`)
const pick = (n) => list.find((x) => x.key.replace(/\.html$/, '') === String(n).replace(/\.html$/, ''))
const sn = splitStateNames(['order.html?state=empty', 'home', 'nope?state=x'], pick)
const one = expandStates(list, (sc) => sts[sc.key], { only: sn.only })
check('点名状态：order.html?state=empty 拆成屏名、只量那个状态（地址带 ?state=）；没点名的屏照常', same(sn.names, ['order.html', 'home', 'nope']) && same(one.list.map((x) => x.key), ['home.html', 'order.html?state=empty']) && one.list[1].url === 'http://h/order.html?state=empty', JSON.stringify(one.list))
const dflt = expandStates(list, (sc) => sts[sc.key], { only: splitStateNames(['order?state=default'], pick).only })
check('点名状态：点的是默认状态 → key 不变、地址不带 ?state=（文件里写着默认）', same(dflt.list.map((x) => x.key), ['home.html', 'order.html']) && dflt.list[1].state === 'default' && dflt.list[1].url === 'http://h/order.html')
check('点名状态：同一屏也写了不带状态的 → 全部状态', expandStates(list, (sc) => sts[sc.key], { only: splitStateNames(['order?state=paid', 'order'], pick).only }).list.length === 4)
{
  // 开发服务器的路由本来就带 ?state=（/stores?state=CA 是单独一屏，没写 dsh-states）：整个对得上就当屏名
  const routes = [{ key: '/stores', url: 'http://h/stores' }, { key: '/stores?state=CA', url: 'http://h/stores?state=CA' }]
  const rp = (n) => routes.find((x) => x.key === String(n).trim()) || routes.find((x) => x.key === String(n).replace(/\?.*$/, ''))
  const rp2 = (n) => { const k = '/' + String(n).trim().replace(/^\/+/, ''); return routes.find((x) => x.key === k) || routes.find((x) => x.key === k.replace(/\?.*$/, '')) }
  const r = splitStateNames(['/stores?state=CA'], rp)
  const r2 = splitStateNames(['stores?state=CA'], rp2)
  check('点名状态：路由本来就带 ?state= 的整个当屏名，不拆（省了开头的 / 也认）', same(r.names, ['/stores?state=CA']) && (!r.only || r.only(routes[1]) === null) && same(r2.names, ['stores?state=CA']), JSON.stringify([r.names, r2.names]))
}
check('点名状态：点了文件里没有的状态 → 照全部状态量；不写 screens 不拆', expandStates(list, (sc) => sts[sc.key], { only: splitStateNames(['order?state=zzz'], pick).only }).list.length === 4 && splitStateNames(undefined, pick).only === null)
const eight = expandStates([list[1]], () => parseStates('a,b,c,d,e,f,g,h'), { perScreen: 3, extra: 1, only: splitStateNames(['order?state=h'], pick).only })
check('点名状态：排在后面的状态点了名也量（不受每屏 / 总共的上限）', same(eight.list.map((x) => x.state), ['h']) && eight.skipped === 0)

// ── 预览页按 ?state= 设好状态（serve 的 stateScript，开画前跑） ──
const ORDER = '<!doctype html><html data-state="default"><head><meta name="dsh-states" content="default:待付款, paid：已付款"></head><body></body></html>'
const SETS = (x) => `setAttribute("data-state","${x}")`
check('预览页：?state=paid、页面写了这个状态 → 开画前设好（放在报错记录后面，<head> 最前）', stateScript(ORDER, '/order.html?state=paid').includes(SETS('paid')) && injectPicker(ORDER, { url: '/order.html?x=1&state=paid' }).indexOf(SETS('paid')) < injectPicker(ORDER, { url: '/order.html?state=paid' }).indexOf('<meta'))
check('预览页：没带 / 怪名字 / 页面没写这个状态 → 不设', stateScript(ORDER, '/order.html') === '' && stateScript(ORDER, '/order.html?state=%3Cx%3E') === '' && stateScript(ORDER, '/order.html?state=zzz') === '')
check('预览页：老页面自己拿 ?state= 当参数（没写 dsh-states）→ 完全不碰 data-state', !injectPicker('<html data-state="loading"><head></head><body></body></html>', { url: '/a.html?state=CA' }).includes('setAttribute("data-state"'))
check('预览页：别人做的（加了 nonce）设状态那段也带 nonce', /<script nonce="N">document\.documentElement\.setAttribute\("data-state","paid"\)/.test(injectPicker(ORDER, { nonce: 'N', url: '/order.html?state=paid' })))
check('预览页：报错记录那段不再管状态', !ERR_CATCHER.includes('data-state'))

// ── 共用部件各屏写得不一样 ──
check('拆 CSS：@media 里的规则带上条件，@keyframes 跳过，注释去掉', same(cssRules('/* x */ .a{color:red} @media (max-width:600px){.a{color:blue}} @keyframes k{from{opacity:0}}').map((r) => r.sel), ['.a', '@media (max-width:600px) .a']))
check('部件选择器：.类名开头算；写状态 / 深浅色的、标签开头的不算', partSel('.card .t') && partSel('@media (x) .card') && !partSel('[data-state="paid"] .card') && !partSel('.card[data-theme=dark]') && !partSel('h1') && !partSel('body .card'))
const card = (pad, r, tag = 'div') => `<style>.card{padding:${pad};border-radius:${r};background:#fff;color:#111}</style><${tag} class="card">x</${tag}>`
const pages = [
  { key: 'a.html', html: card('16px', '12px') + '<style>.title{font-size:28px;font-weight:700;margin:0}</style><h1 class="title">A</h1>' },
  { key: 'b.html', html: card('14px', '12px', 'section') + '<style>.title{font-size:15px;color:#666;letter-spacing:.02em}</style><h3 class="title">B</h3>' },
  { key: 'c.html', html: card('16px', '10px', 'section') + '<style>.ok{gap:8px}[data-state="paid"] .card{padding:0}</style>' },
  { key: 'd.html', html: '<style>.ok{gap:8px}</style>' },
]
const r = compareParts(pages)
check('部件不一致：.card 三屏三种写法报出来，差的那两项列出、多数的写法排前面', r.items.length === 1 && r.items[0].sel === '.card' && r.items[0].screens === 3 && r.items[0].variants === 3 &&
  same(r.items[0].props.map((p) => p.prop).sort(), ['border-radius', 'padding']) && r.items[0].props.find((p) => p.prop === 'padding').values[0].v === '16px', JSON.stringify(r.items))
check('部件不一致：撞名字的（h1 大标题 vs h3 小标题、写法大半不一样）不报；各屏一样的不报；写状态的规则不算', !r.items.some((x) => x.sel === '.title' || x.sel === '.ok'))
const sty = (k, css) => ({ key: k, html: `<style>${css}</style><div class="x">x</div>` })
check('部件不一致：一屏多写一项（这页自己加的）、位置不一样（top / z-index）不算', compareParts([sty('a.html', '.x{color:red;flex:1}'), sty('b.html', '.x{color:red;margin-left:auto}'), sty('c.html', '.x{color:red;top:4px;z-index:2}'), sty('d.html', '.x{color:red;top:9px;z-index:3}')]).items.length === 0)
check('部件不一致：同一屏后面又写了一遍、但前面那条带 !important → 按生效的比（两屏都是红的不报）', compareParts([sty('a.html', '.x{color:red!important}'), sty('b.html', '.x{color:red !important}.x{color:blue}')]).items.length === 0)
check('部件不一致：同一个值的不同记法（#FFF / #ffffff、0px / 0、.5 / 0.5、单双引号）不算不一样', compareParts([sty('a.html', ".x{color:#FFF;margin:0px;opacity:.5;font-family:'A B'}"), sty('b.html', '.x{color:#ffffff;margin:0;opacity:0.5;font-family:"A B"}')]).items.length === 0)
check('部件不一致：只写了一项、值不一样（10px 对 12px）照样报', compareParts([sty('a.html', '.x{padding-bottom:10px}'), sty('b.html', '.x{padding-bottom:12px}')]).items.length === 1)
check('部件不一致：几个方向（home-a / home-c、login / login-b）故意不一样，不比', compareParts([sty('home-a.html', '.x{padding:10px}'), sty('home-c.html', '.x{padding:12px}'), sty('login.html', '.x{padding:14px}'), sty('login-b.html', '.x{padding:16px}')]).items.length === 0 &&
  compareParts([sty('home-a.html', '.x{padding:10px}'), sty('home-c.html', '.x{padding:12px}'), sty('plan.html', '.x{padding:10px}'), sty('pass.html', '.x{padding:12px}')]).items[0].screens === 2)
const txt = formatDrift(r, 3)
check('部件不一致：给模型的字说清哪个部件、几屏几种、每种在哪几屏、怎么改', /\.card：3 屏里有 3 种写法/.test(txt) && /padding：16px（a、c） \/ 14px（b）/.test(txt) && /app\.css/.test(txt) && !/先告诉用户/.test(txt), txt)
check('部件不一致：屏多（超过 6 屏）先问用户再统一', /先告诉用户/.test(formatDrift(r, 40)))
check('部件不一致：没有就不说', formatDrift({ items: [], more: 0 }, 3) === '' && formatDrift(null, 3) === '')
for (const p of pages) fs.writeFileSync(path.join(tmp, p.key), p.html)
fs.writeFileSync(path.join(tmp, 'big.html'), card('1px', '1px') + ' '.repeat(600 * 1024))
const fr = partDrift(tmp, ['a.html', 'b.html', 'c.html', 'd.html', 'big.html', 'gone.html'])
check('部件不一致：读设计目录，太大的屏、没有的屏跳过', fr.items.length === 1 && fr.items[0].screens === 3, JSON.stringify(fr.items.map((x) => [x.sel, x.screens])))

// 审查第 2 轮：<head> 里一大段内联 CSS 后面的 meta 也读得到；body 里很后面的不读（只认 <head>）
const META = '<meta name="dsh-states" content="default:待付款, paid:已付款">'
fs.writeFileSync(path.join(tmp, 'longhead.html'), `<!doctype html><html><head><style>${'.x{color:red}\n'.repeat(4000)}</style>${META}</head><body>hi</body></html>`)
fs.writeFileSync(path.join(tmp, 'cut.html'), `<html><head>${' '.repeat(65536 - 8)}</he` + `ad><body>${' '.repeat(600 * 1024)}${META}</body></html>`)
check('状态：<head> 里塞了 45KB+ 样式，后面的 meta 照样读到；读到 </head> 就停', statesOfFile(path.join(tmp, 'longhead.html')).length === 2 && statesOfFile(path.join(tmp, 'cut.html')).length === 0)
// 第 3 轮：注释里的示例 meta 不算（老页面不会被设状态）；<head> 脚本里的 "<body>" 字样不让读停下
check('状态：注释里的 dsh-states 不算', statesOfHtml('<!-- 示例：<meta name="dsh-states" content="default, paid"> --><html data-state="light">').length === 0 && stateScript('<!-- <meta name="dsh-states" content="light, paid"> -->', '/x.html?state=paid') === '' && statesOfHtml('<!-- x --><meta name="dsh-states" content="a, b">').length === 2)
fs.writeFileSync(path.join(tmp, 'bodystr.html'), `<html><head><script>const tpl = "<body>"</script><style>${'.y{color:blue}\n'.repeat(6000)}</style>${META}</head><body>x</body></html>`)
check('状态：<head> 脚本里写着 "<body>" 也读到后面的 meta', statesOfFile(path.join(tmp, 'bodystr.html')).length === 2)
// <style media="…"> 各管一个断点：包成 @media 分开比，不报不一致
const mediaPages = [
  { key: 'm1.html', html: '<style media="(max-width: 600px)">.card{padding:12px}</style><div class="card"></div>' },
  { key: 'm2.html', html: '<style media="(min-width: 601px)">.card{padding:24px}</style><div class="card"></div>' },
  { key: 'm3.html', html: '<style media="all">.card{padding:16px}</style><div class="card"></div>' },
  { key: 'm4.html', html: '<style>.card{padding:14px}</style><div class="card"></div>' },
]
const mr = compareParts(mediaPages).items
check('部件不一致：<style media> 不同断点分开比（media="all" 和没写的照常比）', mr.length === 1 && mr[0].sel === '.card' && mr[0].screens === 2, JSON.stringify(mr.map((x) => [x.sel, x.screens])))
check('部件不一致：<template> 里的 <style> 不算', compareParts([
  { key: 't1.html', html: '<style>.card{padding:16px}</style><div class="card"></div>' },
  { key: 't2.html', html: '<style>.card{padding:16px}</style><template><style>.card{padding:24px}</style><div class="card"></div></template><div class="card"></div>' },
]).items.length === 0)
check('部件不一致：注释掉的旧 <style> 不算', compareParts([
  { key: 'n1.html', html: '<style>.card{padding:16px}</style><div class="card"></div>' },
  { key: 'n2.html', html: '<style>.card{padding:16px}</style><!-- 旧的：<style>.card{padding:24px}</style> --><div class="card"></div>' },
]).items.length === 0)
// :is(.a, .b) 里的逗号不拆：状态专用的规则整条跳过，不报成「.hint) 写得不一样」
const isPages = [
  { key: 'p.html', html: '<style>[data-state="empty"] :is(.message, .hint){color:#111}</style><p class="hint">x</p>' },
  { key: 'q.html', html: '<style>[data-state="paid"] :is(.message, .hint){color:#222}</style><p class="hint">x</p>' },
]
check('部件不一致：:is(.a, .b) 里的逗号不拆，状态专用的不比', compareParts(isPages).items.length === 0 && cssRules('.a[title="x,y"], .b{color:red}').map((r) => r.sel).join('|') === '.a[title="x,y"]|.b', JSON.stringify(compareParts(isPages).items))
// 标签按整个 class 认：.card 不算 card-title 的标签（不然 h1 / h2 两个撞名字的 .card 因为都有 p.card-title 被当成同一个部件）
const tagPages = [
  { key: 'u.html', html: '<style>.card{padding:16px}</style><h1 class="card">t</h1><p class="card-title">x</p>' },
  { key: 'v.html', html: "<style>.card{padding:12px}</style><h2 class='big card'>t</h2><p class=card-title>x</p>" },
]
const tagSame = [
  { key: 'u.html', html: '<style>.card{padding:16px}</style><div class="card">t</div>' },
  { key: 'v.html', html: '<style>.card{padding:12px}</style><div data-x="1" class="box card">t</div>' },
]
check('部件不一致：标签按整个 class 认（card-title 不算 .card）', compareParts(tagPages).items.length === 0 && compareParts(tagSame).items.length === 1, JSON.stringify(compareParts(tagPages).items))

// ── 转代码说明里的状态 ──
const md = statesMd(new Map([['order.html', '<meta name="dsh-states" content="default:待付款, paid:已付款"><style>[data-state="paid"] .pay{display:none}</style><a href="?state=paid">付</a>'], ['home.html', '<a href="order.html?state=paid">x</a>']]))
check('转代码：写了状态的屏说清几个状态、默认哪个、样式几处、会切状态的链接，叫做成组件 + 状态别拆页面', md.length === 1 && /order\.html 有 2 个状态/.test(md[0]) && /`default`（待付款）·默认/.test(md[0]) && /样式 1 处/.test(md[0]) && /order\.html → paid/.test(md[0]) && /别拆成几个页面/.test(md[0]), md.join('\n'))

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
