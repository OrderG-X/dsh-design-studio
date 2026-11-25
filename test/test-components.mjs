import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { expandComponents, usesComponents, isComponentRel, catalog, catalogLine, LIMITS } from '../lib/components.js'
import { mockExpr, mockScript, parseMock } from '../lib/mock.js'
import { tokenize } from '../lib/gallery/html.js'
import { createBrowser, findBrowser } from '../lib/browser.js'

const reader = defs => rel => Object.hasOwn(defs, rel) ? defs[rel] : null
function expand(html, def, opts = {}) {
  return expandComponents(html, { page: 'home.html', read: reader(Object.fromEntries(
    Object.entries(def).map(([name, src]) => ['components/' + name + '.html', src]))), ...opts })
}
function ok(html, defs, opts) {
  const r = expand(html, defs, opts)
  assert.deepEqual(r.errors, [])
  return r
}
const tags = html => tokenize(html).filter(t => t.type === 'tag').map(t => t.tag)
const attr = (tag, name) => tag.attrs.find(a => a.name === name)?.value
const expr = mockExpr()
const evaluate = (src, data) => expr.evaluate(expr.parse(src), { read: keys => expr.dig(data, keys) })

const card = `<!-- components/activity-card.html -->
<article class="activity-card" data-status="{{status | open}}">
  <img class="ac-cover" src="{{cover | }}" alt="{{title}}" data-if="cover">
  <h3 class="ac-title">{{title}}</h3>
  <span class="ac-tag" data-if="tag">{{tag | }}</span>
  <div class="ac-actions"><slot></slot></div>
</article>
<style>
  .activity-card { … }
  .activity-card[data-status="ended"] { opacity: .6; }
</style>`
const example = `<c-activity-card title="周末徒步" tag="热门"><a href="detail.html">查看</a></c-activity-card>
<c-activity-card title="读书会" status="ended" />
<div data-mock-each="act in activities"><template>
  <c-activity-card :title="act.title" :cover="act.cover" :status="act.status">
    <button data-mock-set="act.joined = true">报名</button>
  </c-activity-card>
</template></div>`

test('方案原样示例，静态无封面，自闭合实例和模板内的动态实例', () => {
  const r = ok(example, { 'activity-card': card }, { mock: { activities: [] } })
  assert.deepEqual(r.warnings, [])
  const ts = tags(r.html)
  assert.equal(ts.filter(t => attr(t, 'data-dsh-c') === 'activity-card').length, 3)
  assert.equal(ts.filter(t => t.name === 'img').length, 1)
  assert.equal(ts.filter(t => t.name === 'style').length, 1)
  assert.match(r.html, /class="ac-title">周末徒步<\/h3>/)
  assert.match(r.html, /data-status="open"/)
  assert.match(r.html, /data-status="ended"/)
  assert.match(r.html, /<a href="detail.html">查看<\/a>/)
  assert.match(r.html, /<button data-mock-set="act.joined = true">报名<\/button>/)
  assert.doesNotMatch(r.html, /<c-|<slot|data-if=|\{\{/)
})

test('只认根目录一层的合法组件文件', () => {
  for (const p of ['components/x.html', 'components/a2-b9.html', 'components\\x.html']) assert.ok(isComponentRel(p))
  for (const p of ['x.html', '/components/x.html', 'components/X.html', 'components/1x.html', 'components/a--b.html',
    'components/x-.html', 'sub/components/x.html', 'components/sub/x.html', '../components/x.html', 'components/x.js']) {
    assert.equal(isComponentRel(p), false, p)
  }
})

test('空页面、普通页面、注释和原始文本中的假标签逐字节保留', () => {
  for (const html of ['', '<!doctype HTML>\r\n  <DIV> &amp; </DIV>\n', '<!-- <c-no/> -->',
    '<script>"<c-no/>"</script><style>/*<c-no>*/</style>', '<textarea><c-no/></textarea>',
    '<title><c-no/></title><p title="<c-no/>"></p>', '</c-only>']) {
    assert.equal(usesComponents(html), false)
    assert.deepEqual(expandComponents(html, { read: () => assert.fail('不应读文件') }),
      { html, used: [], deps: [], errors: [], warnings: [] })
  }
  const raw = '<!-- <c-no> --><script>"<c-no/>"</script><textarea><c-no/></textarea>'
  assert.equal(ok(raw + '<c-x/>', { x: '<br>' }).html, raw + '<br data-dsh-c="x">')
})

test('自注册 c-* 的旧页优先，脚本中的单双引号均识别', () => {
  for (const q of ["'", '"']) {
    const html = `<c-miss/><script>customElements . define ( ${q}c-old${q}, Old)</script>`
    assert.equal(usesComponents(html), false)
    assert.equal(expandComponents(html, { read: () => assert.fail() }).html, html)
  }
  assert.equal(usesComponents(`<c-a/><!-- customElements.define('c-a', A) -->`), true)
})

test('静态参数只解码一次，在文本和属性落点分别转义', () => {
  const r = ok(`<c-x val="&lt;script&gt;&quot;'&amp;amp;" />`, { x: '<p title="a {{val}} b">{{val}}</p>' })
  assert.match(r.html, /title="a &lt;script&gt;&quot;'&amp;amp; b"/)
  assert.match(r.html, />&lt;script&gt;"'&amp;amp;<\/p>/)
  assert.equal(tags(r.html).length, 1)
  assert.equal(attr(tags(r.html)[0], 'title'), `a <script>"'&amp; b`)
})

test('data-if 静态真假表、反向、根条件、空默认值和非空默认值', () => {
  for (const [attribute, truth] of [['', false], [' active=""', false], [' active', true], [' active="false"', true],
    [' active="0"', true], [' active="选中"', true]]) {
    const { html } = ok(`<c-tab${attribute}/>`, { tab: '<div><i data-if="active">是</i><b data-if="!active">否</b>{{active | }}</div>' })
    assert.equal(html.includes('<i>是</i>'), truth, attribute)
    assert.equal(html.includes('<b>否</b>'), !truth, attribute)
    assert.equal(Boolean(ok(`<c-tab${attribute}/>`, { tab: '<div data-if="active"></div>' }).html), truth)
  }
  assert.match(ok('<c-x/>', { x: '<b data-if="x">{{x | 开}}</b>' }).html, />开<\/b>/)
  assert.match(ok('<c-x/>', { x: '<b>{{x | }}</b>' }).html, /><\/b>/)
})

test('动态 data-if 的完整真假表，缺字段和 null 才使用默认值，原有条件同时生效', () => {
  const r = ok('<c-x :v="obj.v"/>', { x: '<div><i data-if="v" data-mock-show="ready">好</i><b data-if="!v"></b></div>' }, { mock: { obj: null } })
  const ts = tags(r.html)
  const yes = attr(ts[1], 'data-mock-show'), no = attr(ts[2], 'data-mock-show')
  for (const [obj, truth] of [[{}, false], [{ v: null }, false], [{ v: 0 }, false], [{ v: false }, false],
    [{ v: '' }, false], [{ v: '在' }, true]]) {
    assert.equal(Boolean(evaluate(yes, { obj, ready: true })), truth)
    assert.equal(Boolean(evaluate(no, { obj })), !truth)
    assert.equal(Boolean(evaluate(yes, { obj, ready: false })), false)
  }
  const v = ok('<c-x :v="obj.v" />', { x: '<p data-if="v">{{v | 好}}</p>' }, { mock: { obj: null } })
  const binding = attr(tags(v.html)[1], 'data-mock-text')
  for (const [obj, expected] of [[{}, '好'], [{ v: null }, '好'], [{ v: 0 }, 0], [{ v: false }, false], [{ v: '' }, ''], [{ v: 8 }, 8]]) {
    assert.equal(evaluate(binding, { obj }), expected)
    assert.equal(Boolean(evaluate(attr(tags(v.html)[0], 'data-mock-show'), { obj })), Boolean(expected))
  }
})

test('动态文字保留旁边的图标，完整和局部属性编译进已有绑定', () => {
  const { html } = ok('<c-x :v="list[0].x"/>', {
    x: `<a data-mock-attr="hidden: hide" href="{{v}}" title="前 '{{v}}'; &amp; 后"><i>★</i>前{{v}}后</a>`,
  }, { mock: { list: [] } })
  const root = tags(html)[0]
  assert.equal(attr(root, 'href'), undefined)
  assert.equal(attr(root, 'title'), undefined)
  assert.match(html, /<i>★<\/i>前<span data-mock-text="list\[0\]\.x"><\/span>后/)
  const pairs = expr.parsePairs(attr(root, 'data-mock-attr'))
  assert.deepEqual(pairs.map(x => x.name), ['hidden', 'href', 'title'])
  const data = { hide: true, list: [{ x: 'img/a.png' }] }
  assert.deepEqual(pairs.map(p => expr.evaluate(p.e, { read: ks => expr.dig(data, ks) })), [true, 'img/a.png', "前 'img/a.png'; & 后"])
})

test('slot 默认内容、空白、自闭合、调用方先展开和同名有限嵌套', () => {
  const defs = { box: '<article><slot><b>默认</b></slot></article>', x: '<i>{{v}}</i>' }
  for (const src of ['<c-box/>', '<c-box> \n </c-box>']) assert.match(ok(src, defs).html, /<b>默认<\/b>/)
  const h = ok('<c-box><c-box><c-x v="内容" /></c-box></c-box>', defs).html
  assert.match(h, /<article[^>]*><article[^>]*><i[^>]*>内容<\/i><\/article><\/article>/)
  assert.doesNotMatch(h, /默认|<slot/)
  assert.match(ok('<c-x/>', { x: '<div><slot/></div>' }).html, /><\/div>/)
})

test('嵌套组件整段转交静态或动态绑定，局部静态转交只解码一次', () => {
  const defs = { a: '<section><c-b v="{{v}}"/><c-b v="前{{w}}后"/></section>', b: '<b title="{{v}}">{{v}}</b>' }
  assert.match(ok('<c-a v="&amp;amp;" w="&quot;" />', defs).html, /前"后/)
  const h = ok('<c-a :v="user.title" w="!" />', defs, { mock: { user: {} } }).html
  assert.match(h, /<span data-mock-text="user.title">/)
  assert.match(h, /data-mock-attr="title: user.title"/)
  assert.match(h, /前!后/)
  const forwarded = ok('<c-a :v="user.x"/>', { a: '<c-b v="{{v | 外}}"/>', b: '<b>{{v | 内}}</b>' }, { mock: { user: null } })
  assert.equal(evaluate(attr(tags(forwarded.html)[1], 'data-mock-text'), {}), '外')
})

test('双层 template 可见两层列表的别名和下标，模板外的同名字段会提醒', () => {
  const h = `<div data-mock-each="row, i in rows"><c-x :v="row.outside"/>
<template><c-x :v="i"/><div data-mock-each="col, j in row.cols"><template>
<c-x :v="row.outer"/><c-x :v="col.inner"/><c-x :v="j"/></template></div></template></div>`
  const r = ok(h, { x: '<b>{{v}}</b>' }, { mock: { rows: [] } })
  assert.equal(tags(r.html).filter(t => t.name === 'span').length, 5)
  assert.equal(r.warnings.length, 1)
  assert.equal(r.warnings[0].code, 'mock-path')
  assert.match(r.warnings[0].message, /row.outside/)
})

test('tbody 内保持 tr 的正确层级；设计相对路径、SVG 大小写原样传递', () => {
  const r = ok('<table><tbody><c-row img="img/local.png"/></tbody></table>', {
    row: '<tr><td><img src="{{img}}"><a href="detail.html"><svg viewBox="0 0 5 5"><use href="icons.svg#ok"/></svg></a></td></tr>',
  })
  assert.match(r.html, /<tbody><tr data-dsh-c="row"><td><img src="img\/local.png">/)
  assert.match(r.html, /href="detail.html".*viewBox="0 0 5 5".*href="icons.svg#ok"/)
})

test('透传属性、根 class/style 合并、声明的 title 优先作为参数', () => {
  const attrs = 'id="the" hidden role="tab" aria-label="卡片" tabindex="0" title="提示" data-back data-href="home.html" data-to="x" data-mock-show="on" data-mock-class="open: on" data-mock-set="on = true" data-mock-attr="disabled: !on" data-mock-reset'
  const { html } = ok(`<c-x class="extra" style="color:red" ${attrs}/>`, { x: '<div class="base" style="margin:0"></div>' })
  const root = tags(html)[0]
  assert.equal(attr(root, 'class'), 'base extra')
  assert.equal(attr(root, 'style'), 'margin:0;color:red')
  for (const a of tags(`<div ${attrs}>`)[0].attrs) assert.equal(attr(root, a.name), a.value)
  const viaParam = ok('<c-x title="文案"/>', { x: '<b title="提示">{{title}}</b>' })
  assert.match(viaParam.html, /title="提示"[^>]*>文案/)
})

test('样式每组件每页一次，插在真正的 head 内；选择器按每一项检查', () => {
  const def = '<div class="x y"></div><style>@media (width > 1px){.x:is(a,b),.y:hover{color:red}.xy,.x + b{display:block}} @keyframes spin{from{}to{}}</style>'
  const cases = [
    ['<head><link rel="stylesheet" href="x.css"><style>page{}</style></head>', /<link[^>]+><style data-dsh-comp-css="x">[\s\S]*?<\/style><style>page/],
    ['<head><template><style>inert{}</style></template></head>', /<\/template><style data-dsh-comp-css="x">[\s\S]*?<\/style><\/head>/],
    ['', /^<style data-dsh-comp-css="x">/],
  ]
  for (const [prefix, pattern] of cases) {
    const r = ok(prefix + '<c-x/><c-x/>', { x: def })
    assert.match(r.html, pattern)
    assert.equal(tags(r.html).filter(t => attr(t, 'data-dsh-comp-css') === 'x').length, 1)
    assert.deepEqual(r.warnings.map(w => w.code), ['css-scope'])
    assert.match(r.warnings[0].message, /\.xy/)
  }
})

const cases = [
  ['缺组件', 'missing', '<c-no/>', {}],
  ['非法名', 'name', '<c-a--b/>', {}],
  ['未闭合的实例', 'syntax', '<c-x>', { x: '<b></b>' }],
  ['未闭合的参数', 'syntax', '<c-x/>', { x: '<b>{{a</b>' }],
  ['绑定表达式', 'syntax', '<c-x :a="user.x || 1"/>', { x: '<b>{{a}}</b>' }],
  ['表达式下标', 'syntax', '<c-x :a="rows[i+1]"/>', { x: '<b>{{a}}</b>' }],
  ['重复传参', 'syntax', '<c-x a="1" :a="user"/>', { x: '<b>{{a}}</b>' }],
  ['未给必填参数', 'required', '<c-x/>', { x: '<b>{{a}}</b>' }],
  ['默认值不一致', 'default', '<c-x/>', { x: '<b>{{a|1}}{{a|2}}</b>' }],
  ['多根', 'root', '<c-x/>', { x: '<i></i><b></b>' }],
  ['根外文字', 'root', '<c-x/>', { x: '<b></b>外面' }],
  ['缺根', 'root', '<c-x/>', { x: '<!-- empty -->' }],
  ['整页', 'whole', '<c-x/>', { x: '<html><body></body></html>' }],
  ['script', 'script', '<c-x/>', { x: '<b><script>1</script></b>' }],
  ['iframe', 'script', '<c-x/>', { x: '<b><iframe></iframe></b>' }],
  ['事件', 'script', '<c-x/>', { x: '<b oNcLiCk="x()">1</b>' }],
  ['事件绑定', 'script', '<c-x/>', { x: '<b data-mock-attr="onload: evil"></b>' }],
  ['定义写 data-state', 'state', '<c-x/>', { x: '<b><i data-state></i></b>' }],
  ['实例写 data-state', 'state', '<c-x data-state/>', { x: '<b></b>' }],
  ['多个 slot', 'slot', '<c-x/>', { x: '<b><slot></slot><slot/></b>' }],
  ['具名 slot', 'slot', '<c-x/>', { x: '<b><slot name=""></slot></b>' }],
  ['样式块参数', 'style-param', '<c-x/>', { x: '<b></b><style>.x{color:{{v}}}</style>' }],
  ['样式属性参数', 'style-param', '<c-x/>', { x: '<b style="color:{{v}}"></b>' }],
  ['样式 mock 绑定', 'style-param', '<c-x/>', { x: '<b data-mock-attr="style: s"></b>' }],
  ['混合转交动态参数', 'forward', '<c-x :v="user.v"/>', { x: '<div><c-y v="前{{v}}"/></div>', y: '<p>{{v}}</p>' }],
  ['透传 id 冲突', 'conflict', '<c-x id="a"/>', { x: '<b id="b"></b>' }],
  ['透传 show 冲突', 'conflict', '<c-x data-mock-show="a"/>', { x: '<b data-mock-show="b"></b>' }],
  ['递归', 'cycle', '<c-x/>', { x: '<div><c-y/></div>', y: '<div><c-x/></div>' }],
]
for (const key of ['text', 'each', 'model']) cases.push(['禁止透传 ' + key, 'pass', `<c-x data-mock-${key}="x"/>`, { x: '<b></b>' }])
for (const alias of ['it', 'i']) cases.push(['内层别名碰撞 ' + alias, 'alias', `<c-x :v="${alias}.x"/>`,
  { x: '<div data-mock-each="it, i in rows"><template><i>{{v}}</i></template></div>' }])

for (const [title, code, source, defs] of cases) test(title + ' 返回诊断和预览占位', () => {
  for (const placeholders of [true, false]) {
    const r = expand('页首\n' + source + '\n页尾', defs, { placeholders })
    assert.deepEqual(r.errors.map(e => e.code), [code])
    const e = r.errors[0]
    assert.ok(e.fix && e.message && e.file && e.line >= 1)
    assert.equal(e.page, 'home.html')
    if (e.file === 'home.html') assert.equal(e.line, 2)
    assert.equal(r.html.includes(`data-dsh-comp-error="${code}"`), placeholders)
    assert.match(r.html, /^页首\n/)
    assert.match(r.html, /\n页尾$/)
    assert.doesNotMatch(r.html, /<script|<iframe|\bonclick=|<c-/i)
  }
})

test('错误逐实例报，含缺文件的传递依赖排序去重，同一文件只读一次', () => {
  const reads = []
  const r = expandComponents('<c-z/>\n<c-z/>\n<c-missing/>', { page: 'p.html', read: rel => {
    reads.push(rel)
    return rel === 'components/z.html' ? Buffer.from('<div>\n<c-missing/>\n</div>') : null
  } })
  assert.deepEqual(reads, ['components/z.html', 'components/missing.html'])
  assert.deepEqual(r.used, ['missing', 'z'])
  assert.deepEqual(r.deps, ['components/missing.html', 'components/z.html'])
  assert.deepEqual(r.errors.map(e => [e.file, e.line]), [['components/z.html', 2], ['components/z.html', 2], ['p.html', 3]])
})

test('unknown-attr 丢弃；mock-path 只检查根，空列表、null、深层缺失均允许', () => {
  const r = ok('<c-x typo="drop" :a="rows[0].title" :b="nil.x" :c="user.missing.deep" :d="oops.x"/>',
    { x: '<p>{{a}}{{b}}{{c}}{{d}}</p>' }, { mock: { rows: [], nil: null, user: {} } })
  assert.deepEqual(r.warnings.map(w => w.code), ['unknown-attr', 'mock-path'])
  assert.match(r.warnings[1].message, /oops.x/)
  assert.doesNotMatch(r.html, /typo|drop/)
})

test('内部 each 不遮住模板外的参数；内层组件可直接接收当前循环别名', () => {
  const r = ok('<c-a :v="it.title"/>', { a: '<div data-mock-each="it in rows"><b>{{v}}</b><template><c-b :w="it.x"/></template></div>',
    b: '<span>{{w}}</span>' }, { mock: { it: {}, rows: [] } })
  assert.deepEqual(r.warnings, [])
  assert.match(r.html, /data-mock-text="it.x"/)
})

test('八层可用，第九层拦下', () => {
  const defs = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['n' + i, i < 7 ? `<div><c-n${i + 1}/></div>` : '<b>到底</b>']))
  assert.match(ok('<c-n0/>', defs).html, /到底/)
  defs.n7 = '<b><c-n8/></b>'
  defs.n8 = '<b>越界</b>'
  const r = expand('<c-n0/>', defs)
  assert.deepEqual(r.errors.map(e => e.code), ['depth'])
  assert.equal(r.errors[0].file, 'components/n7.html')
})

test('单个组件按 UTF-8 字节限量，超限后停止读取其他实例', () => {
  const reads = []
  const r = expandComponents('<c-a/><c-b/>', { page: 'p.html', read: path => {
    reads.push(path)
    return '<p>' + '好'.repeat(Math.ceil(LIMITS.file / 3)) + '</p>'
  } })
  assert.deepEqual(reads, ['components/a.html'])
  assert.deepEqual(r.errors.map(e => e.code), ['big'])
  assert.equal(r.errors[0].file, 'components/a.html')
  assert.match(r.html, /data-dsh-comp-error="big"/)
})

test('5000 个实例可用，第 5001 个停止', () => {
  const defs = { x: '<br>' }
  const page = '<c-x/>'.repeat(LIMITS.instances)
  assert.equal(ok(page, defs).html, '<br data-dsh-c="x">'.repeat(LIMITS.instances))
  assert.deepEqual(expand(page + '<c-x/>', defs, { placeholders: false }).errors.map(e => e.code), ['big'])
})

test('输出计入 CSS、多字节文字和属性中重复引用的参数', () => {
  const text = '中'.repeat(80000)
  const defs = { x: '<b>' + text + '</b>' }
  for (const r of [expand('<c-x/>'.repeat(18), defs),
    expand('<c-x/>' + 'a'.repeat(LIMITS.out - 64), { x: '<b></b><style>.x{' + ' '.repeat(100) + '}</style>' }),
    expand('<c-x v="' + text + '"/>', { x: '<b title="' + '{{v}}'.repeat(5000) + '"></b>' })]) {
    assert.deepEqual(r.errors.map(e => e.code), ['big'])
    assert.ok(Buffer.byteLength(r.html) <= LIMITS.out)
  }
})

test('catalog 契约含两种默认值、条件参数、CSS 状态、mock 路径、错误和一行短目录', () => {
  const src = `<article class="card" data-status="{{status | open}}" data-variant="flat">
<h3>{{title}}</h3><i data-if="icon">{{icon | }}</i><b data-if="active"></b><slot/>
<div data-mock-each="r,i in rows"><template><b data-mock-text="r.title" data-mock-show="user.on"
data-mock-attr="href: user.url; title: r.title" data-mock-class="hot: user.hot"
data-mock-set="count = stats.n + 1"><c-b :v="r.id"/></b></template></div></article>
<style>.card[data-status="ended"],.card[data-variant='big']{}</style>`
  const items = catalog(reader({ 'components/card.html': src, 'components/broken.html': '<b></b><b></b>' }),
    ['components/card.html', 'broken.html', 'card', '../invalid'])
  const item = items.find(x => x.name === 'card')
  assert.ok(items.find(x => x.name === 'broken').error)
  assert.ok(items.find(x => x.name === '../invalid').error)
  assert.deepEqual(item.params, [
    { name: 'status', required: false, def: 'open' }, { name: 'title', required: true, def: null },
    { name: 'icon', required: false, def: '' }, { name: 'active', required: false, def: null },
  ])
  assert.equal(item.slot, true)
  assert.deepEqual(item.statuses, ['ended', 'open'])
  assert.deepEqual(item.variants, ['big', 'flat'])
  assert.deepEqual(item.mockPaths, ['r.id', 'r.title', 'rows', 'stats.n', 'user.hot', 'user.on', 'user.url'])
  assert.equal(catalogLine([item]), '组件：card(status=open, title, icon?, active?)')
  assert.equal(catalogLine([]), '')
})

test('真实 mock 运行时：列表首次填充、克隆、重绘后文字/属性/显隐和插槽按钮一起生效',
  { skip: findBrowser() ? false : '没找到 Chrome / Edge' }, async () => {
    const data = { activities: [] }
    const r = ok(example, { 'activity-card': card }, { mock: data })
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8">' +
      mockScript(parseMock(JSON.stringify(data))) + r.html)
    const b = createBrowser()
    try {
      const got = await b.withPage({ url, w: 500, h: 600 }, p => p.eval(`(async () => {
        const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const cards = () => [...document.querySelectorAll('.activity-card')]
        const read = () => {
          const row = cards()[2], cover = row.querySelector('img')
          return [row.querySelector('h3').textContent, row.getAttribute('data-status'), cover.getAttribute('src'), getComputedStyle(cover).display === 'none']
        }
        const empty = cards().length
        mock.set('activities', [{title:'夜跑'}]); await tick()
        const first = read()
        cards()[2].querySelector('button').click(); await tick()
        const joined = mock.get('activities[0].joined')
        mock.set('activities[0].cover', 'img/night.png'); mock.set('activities[0].title', '晨跑')
        mock.set('activities[0].status', 'ended'); await tick()
        return { empty, first, joined, changed: read() }
      })()`))
      assert.deepEqual(got, { empty: 2, first: ['夜跑', 'open', '', true], joined: true,
        changed: ['晨跑', 'ended', 'img/night.png', false] })
    } finally { b.stop() }
  })

test('记录典型 24 个实例的展开耗时', t => {
  const src = example.repeat(8)
  const run = () => ok(src, { 'activity-card': card }, { mock: { activities: [] } })
  for (let i = 0; i < 8; i++) run()
  const samples = []
  for (let i = 0; i < 31; i++) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  t.diagnostic(`24 个实例中位耗时 ${samples[15].toFixed(2)} ms`)
})

test('超大组件原地占位，停止展开后仍保留页面外壳及之前成功的实例', () => {
  for (const placeholders of [true, false]) {
    const r = expand('<main><c-ok/><c-huge/><c-never/><footer>结尾</footer></main>',
      { ok: '<i>正常</i>', huge: Buffer.alloc(LIMITS.file + 1) }, { placeholders })
    assert.deepEqual(r.used, ['huge', 'ok'])
    assert.deepEqual(r.errors.map(e => e.code), ['big'])
    assert.match(r.html, /^<main><i[^>]*>正常<\/i>/)
    assert.match(r.html, /<footer>结尾<\/footer><\/main>$/)
    assert.equal(r.html.includes('data-dsh-comp-error="big"'), placeholders)
  }
})

test('插槽内容进入组件内部模板时不能被同名别名捕获，插槽自有列表别名可重名', () => {
  const defs = { list: '<div data-mock-each="it in items"><template><slot/></template></div>', x: '<b>{{v}}</b>' }
  const r = expand('<c-list><c-x :v="it.title"/></c-list>', defs, { mock: { it: {} } })
  assert.deepEqual(r.errors.map(e => e.code), ['alias'])
  assert.equal(r.errors[0].file, 'components/list.html')
  ok('<c-list><div data-mock-each="it in other"><template><c-x :v="it.title"/></template></div></c-list>', defs)
})

test('title 和 textarea 在原始文本宿主上绑定，里面的 c- 字样始终是文字', () => {
  const src = '<section><textarea>前 &amp; {{v}} <c-ignore/></textarea><title>{{v}}</title></section>'
  const r = ok('<c-a :v="user.x"/>', { a: src }, { mock: { user: {} } })
  const ts = tags(r.html)
  assert.deepEqual(ts.map(t => t.name), ['section', 'textarea', 'title'])
  assert.equal(evaluate(attr(ts[1], 'data-mock-text'), { user: { x: '后' } }), '前 & 后 <c-ignore/>')
  assert.equal(attr(ts[2], 'data-mock-text'), 'user.x')
  assert.deepEqual(r.used, ['a'])
})

test('整页带 doctype 的诊断和包在括号里的表达式', () => {
  assert.equal(expand('<c-x/>', { x: '<!doctype html>\n<html></html>' }).errors[0].code, 'whole')
  assert.equal(expand('<c-x :a="(user.x)"/>', { x: '<b>{{a}}</b>' }).errors[0].code, 'syntax')
})

test('被静态条件去掉和出错回滚的根不会遗留组件 CSS', () => {
  const x = '<div class="x" data-if="active"></div><style>.x{color:red}</style>'
  assert.equal(ok('<c-x/>', { x }).html, '')
  assert.equal(expand('<c-x active id="bad"/>', { x: x.replace('<div', '<div id="root"') }, { placeholders: false }).html, '')
})

test('整段动态参数可以转交为内层根元素的 title、class 和可见条件', () => {
  const r = ok('<c-outer :p="user.title" />', { outer: '<c-inner title="{{p}}" class="{{p}}" data-mock-show="{{p}}"/>',
    inner: '<div class="base"></div>' }, { mock: { user: {} } })
  const root = tags(r.html)[0]
  assert.equal(attr(root, 'data-dsh-c'), 'outer')
  assert.equal(attr(root, 'data-mock-show'), 'user.title')
  const pairs = expr.parsePairs(attr(root, 'data-mock-attr'))
  assert.deepEqual(pairs.map(p => [p.name, expr.evaluate(p.e, { read: () => 'live' })]), [['title', 'live'], ['class', 'base live']])
})

test('参数替换后仍按 mock 规则校验属性绑定', () => {
  for (const [pair, code] of [['style: x', 'style-param'], ['onload: x', 'script']]) {
    const r = expand(`<c-x attr="${pair}"/>`, { x: '<b data-mock-attr="{{attr}}"></b>' })
    assert.deepEqual(r.errors.map(e => e.code), [code])
  }
})
