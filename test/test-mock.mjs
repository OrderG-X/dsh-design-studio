/**
 * #30 第 3 步 模拟数据（mock.js）：表达式、注入、真浏览器里显示 / 点了改 / 换页还在 / 状态跟着数据 / 重置
 *   node test/test-mock.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mockExpr, parseMock, mockScript, mockOf, saveMock, mockOfBuf, MOCK_FILE, MOCK_MAX } from '../lib/mock.js'
import { buildPack } from '../lib/htmlpack.js'
import { dataAssets } from '../lib/bundle.js'
import { mockMd } from '../lib/handoff.js'
import { injectPicker, stateScript, createHub } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 表达式 ──
const X = mockExpr()
const DATA = { user: { name: '小林', stage: 'onsite', n: 3 }, apps: [{ title: 'A', status: 'offer' }, { title: 'B' }], 键: '中文' }
const env = (scope = null) => ({ scope, read: (k) => X.dig(DATA, k) })
const ev = (s, scope) => X.evaluate(X.parse(s), env(scope))
check('表达式：路径、比较、&& ||、!、三元', ev("user.stage == 'onsite'") === true && ev("!user.stage || user.n > 2") === true && ev("user.n >= 3 ? '多' : '少'") === '多' && ev('!(user.n > 5)') === true)
check('表达式：+ 拼字、算数、括号、负号', ev("'¥' + user.n") === '¥3' && ev('(user.n + 1) * 2') === 8 && ev('-user.n') === -3 && ev('user.n % 2') === 1)
check('表达式：数组下标、length、中文键、没有的路径给 undefined', ev('apps[0].title') === 'A' && ev('apps.1.title') === 'B' && ev('apps.length') === 2 && ev('键') === '中文' && ev('user.nope.deep') === undefined && ev("user.name.length") === 2)
check('表达式：== 按值比（\'3\' 和 3、null 和没写一样）', ev("user.n == '3'") === true && ev('user.nope == null') === true && ev("user.n === '3'") === false)
check('表达式：没写的拼字当空（不出 undefined）', ev("'名字：' + user.nope") === '名字：')
check('表达式：别名（列表里的 app → apps.0）、序号别名', ev("app.status == 'offer'", { app: { abs: ['apps', '0'] } }) === true && ev('i + 1', { i: { val: 1 } }) === 2)
let bad = 0
for (const s of ["user.stage = 'x'", "user.stage == 'x", 'a b', 'alert(1)', '__proto__.x', 'user.constructor', "user['__proto__']", 'a ?', '']) { try { ev(s); } catch { bad++ } }
check('表达式：写错的、调函数、碰原型的都不认（报错，不执行）', bad === 9, String(bad))
const st = X.parseStmts("user.stage = 'onsite'; count = count + 1")
check('改数据：几句用 ; 隔开', st.length === 2 && st[0].lhs.t === 'path' && st[1].rhs.t === 'bin')
let sbad = 0
for (const s of ['', "'x' = 1", 'a == 1', 'a = ', 'a = 1 b']) { try { X.parseStmts(s) } catch { sbad++ } }
check('改数据：写错的不认', sbad === 5, String(sbad))
check('class / 属性：「名字: 条件」几条', same(X.parsePairs("on active: tab == 'a'; done: x ? 1 : 0").map((p) => p.name), ['on active', 'done']))
check('列表：item in list / item, i in list', X.parseEach('app in apps').item === 'app' && X.parseEach('app, i in user.apps').index === 'i')
let ebad = 0
for (const s of ['apps', 'app in', 'app in 1 + 2']) { try { X.parseEach(s) } catch { ebad++ } }
check('列表：写错的不认', ebad === 3, String(ebad))
check('脚本里的路径：字符串 / 数组都认，碰原型的不认', same(X.keysOf('items[0].title'), ['items', '0', 'title']) && same(X.keysOf(['a', 1]), ['a', '1']) && (() => { try { X.keysOf('a.__proto__.b'); return false } catch { return true } })())

// ── mock.json ──
const ok = parseMock('﻿{"a":1}')
check('mock.json：合法的对象（带 BOM 也行）', ok.data.a === 1 && !ok.err && /^[0-9a-f]{12}$/.test(ok.fp))
check('mock.json：不是对象 / 不是 JSON → 报问题，数据给空对象', /对象/.test(parseMock('[1]').err) && /JSON/.test(parseMock('{a:1}').err) && same(parseMock('nope').data, {}))
check('mock.json：内容一样指纹一样，改了就变', parseMock('{"a":1}').fp === parseMock('{"a":1}').fp && parseMock('{"a":2}').fp !== ok.fp)
const evil = parseMock(JSON.stringify({ s: '</script><script>alert(1)</script>', ls: '\u2028' }))
const tag = mockScript(evil)
check('塞进页面：数据里的 </script>、<、行分隔符都转义了', tag.indexOf('</script>') === tag.length - 9 && !/<script>alert/.test(tag) && !tag.includes('\u2028'))
check('塞进页面：没有 mock.json 不塞', mockScript(null) === '')
const PAGE = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>'
const strictOut = injectPicker(PAGE, { nonce: 'N', mock: parseMock(JSON.stringify({ s: '<script>x' })) })
check('别人做的（nonce）：运行时那段带 nonce，数据里的 <script> 不会被插上 nonce', /<script nonce="N">\(function mockRuntime/.test(strictOut) && !strictOut.includes('<script nonce="N">x'))
check('放在 <head> 最前（报错记录后面）', injectPicker(PAGE, { mock: ok }).indexOf('mockRuntime') < injectPicker(PAGE, { mock: ok }).indexOf('<title>'))
const ORDER = '<!doctype html><html><head><meta name="dsh-states" content="a:甲, b:乙"></head><body></body></html>'
check('预览地址带状态：同时告诉模拟数据（window.__dshState）', stateScript(ORDER, '/o.html?state=b').includes('window.__dshState="b"'))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-mock-'))
fs.writeFileSync(path.join(tmp, MOCK_FILE), '{"a":1}')
const m1 = mockOf(tmp)
check('读目录里的 mock.json（没改不重读）', m1 && m1.data.a === 1 && mockOf(tmp) === m1 && mockOf(path.join(tmp, 'nope')) === null)
fs.writeFileSync(path.join(tmp, MOCK_FILE), '{"a":22}')
check('mock.json 改了重读', mockOf(tmp).data.a === 22)

// ── 存成初始数据 ──
const sv = path.join(tmp, 'save')
fs.mkdirSync(sv)
check('存成初始数据：没有 mock.json 的设计不写', saveMock(sv, { a: 1 }).reason === 'no-mock' && !fs.existsSync(path.join(sv, MOCK_FILE)))
fs.writeFileSync(path.join(sv, MOCK_FILE), '{"a":1}')
const s1 = saveMock(sv, { a: 2, b: ['中'] })
check('存成初始数据：写回 mock.json（排好版）、报改了哪个文件', s1.ok && same(s1.files, [MOCK_FILE]) && fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8') === JSON.stringify({ a: 2, b: ['中'] }, null, 2) + '\n')
check('存成初始数据：一样的不写', same(saveMock(sv, { a: 2, b: ['中'] }), { ok: true, files: [] }))
check('存成初始数据：不是对象 / 太大的不写', saveMock(sv, [1]).reason === 'bad' && saveMock(sv, null).reason === 'bad' && saveMock(sv, { big: 'x'.repeat(1100000) }).reason === 'big' && JSON.parse(fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8')).a === 2)
{
  const fpNow = parseMock(fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8')).fp
  const stale = saveMock(sv, { a: 3 }, 'oldoldoldold')
  check('存成初始数据：面板那份是照旧文件来的（文件刚被模型 / 别的窗口改过）→ 不盖', stale.reason === 'changed' && JSON.parse(fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8')).a === 2, JSON.stringify(stale))
  const fresh = saveMock(sv, { a: 3 }, fpNow)
  check('存成初始数据：指纹对得上就写，旁边不留临时文件', fresh.ok && JSON.parse(fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8')).a === 3 && fs.readdirSync(sv).every((f) => f === MOCK_FILE), fs.readdirSync(sv).join(','))
  check('存成初始数据：刚存过、面板还拿着旧指纹再点一次 → 内容一样算存好了（不提示「被改过」）', saveMock(sv, { a: 3 }, fpNow).ok === true)
  fs.writeFileSync(path.join(sv, MOCK_FILE), '{ "a": 1, "keep": "原来的内容", }')
  check('存成初始数据：原文件有语法错（面板那份是从空的开始）→ 不盖', saveMock(sv, { user: { stage: 'x' } }).reason === 'bad-file' && fs.readFileSync(path.join(sv, MOCK_FILE), 'utf8').includes('原来的内容'))
}
{
  const ir = path.join(tmp, 'inl')
  fs.mkdirSync(path.join(ir, 'img'), { recursive: true })
  fs.writeFileSync(path.join(ir, 'img', 'me.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const rd = (rel) => { const f = path.join(ir, rel); try { return fs.statSync(f).isFile() ? fs.readFileSync(f) : null } catch { return null } }
  const src = { user: { avatar: 'img/me.png', site: 'https://x.test/a.png', gone: 'img/nope.png', up: '../me.png', name: 'me.png 不是路径' }, list: [{ pic: './img/me.png' }] }
  const out = dataAssets(src, rd)
  const over = []
  const small = dataAssets(src, rd, 2, over)
  check('打包：图太大换不下的记下来（调用方报错，不悄悄留坏图）', !small.r['img/me.png'] && !Object.keys(small.f).length && over.includes('img/me.png'), JSON.stringify(over))
  const many = dataAssets({ list: Array.from({ length: 30 }, (_, i) => ({ p: i % 2 ? 'img/me.png' : './img/me.png' })) }, rd)
  check('打包：30 条用同一张图（写法 img/、./img/ 混着）：图只放一份', Object.keys(many.f).length === 1 && Object.keys(many.r).length === 2 && JSON.stringify(many).split('data:').length === 2, JSON.stringify(Object.keys(many.r)))
  const over2 = []
  dataAssets({ a: 'img/huge.png', b: 'img/none.png' }, () => null, 1e9, over2, (rel) => rel === 'img/huge.png')
  check('打包：文件太大读的时候就没读（不是没有）也记下来；真没有的不记', over2.length === 1 && over2[0] === 'img/huge.png', JSON.stringify(over2))
  let thrown = ''
  try { buildPack({ screens: [{ key: 'a.html', label: 'A' }], read: (rel) => (rel === MOCK_FILE ? Buffer.from('{"p":"img/huge.png"}') : rel === 'a.html' ? Buffer.from('<p>a</p>') : null), bigOf: (rel) => rel === 'img/huge.png', kind: 'web', w: 800, h: 600 }) } catch (e) { thrown = e.code }
  check('HTML 演示：数据里绑的图太大放不进 → 报错不导出（不是导出个坏图还说成功）', thrown === 'imgTooBig', thrown)
  // mock.json 超过 1 MB（模型把图片转成 base64 写进去）：演示里数据带不上 → 报错不导出；读的时候就因为太大没读的也一样
  for (const [tag, rdM, bigM] of [['超过上限', () => Buffer.alloc(MOCK_MAX + 10, 32), null], ['读的时候太大没读', () => null, (rel) => rel === MOCK_FILE]]) {
    let th = ''
    try { buildPack({ screens: [{ key: 'a.html', label: 'A' }], read: (rel) => (rel === MOCK_FILE ? rdM() : rel === 'a.html' ? Buffer.from('<p>a</p>') : null), bigOf: bigM, kind: 'web', w: 800, h: 600 }) } catch (e) { th = e.code || e.message }
    check(`HTML 演示：mock.json 太大（${tag}）→ 报错不导出（不导出一个点了不会变的演示）`, th === 'mockTooBig', th)
  }
  const mb = mockOfBuf(Buffer.alloc(MOCK_MAX + 10, 32))
  check('远程看 / 打包：mock.json 太大 → 和预览一样带一份空数据 + 「太大」错误（页面错误里看得到）；没有 → null', /太大/.test(mb.err) && mockOfBuf(null) === null && /太大/.test(mockOfBuf(null, true).err) && mockOfBuf(Buffer.from('{"a":1}')).data.a === 1, JSON.stringify(mb))
  check('打包：数据里写的本地图片列成「原文 → data: 地址」的表（数据不改；网址、读不到的、目录外的不进表）', out.f[out.r['img/me.png']].startsWith('data:image/png;base64,') && out.r['./img/me.png'] === out.r['img/me.png'] && Object.keys(out.r).length === 2 && Object.keys(out.f).length === 1 && src.user.avatar === 'img/me.png', JSON.stringify(out.r))
}

// 软链接的 mock.json（可能指到目录外）：当没有，也不写
const ln = path.join(tmp, 'ln')
fs.mkdirSync(ln)
fs.writeFileSync(path.join(tmp, 'outside.json'), '{"secret":1}')
let linked = true
try { fs.symlinkSync(path.join(tmp, 'outside.json'), path.join(ln, MOCK_FILE)) } catch { linked = false }
if (linked) {
  check('软链接的 mock.json：页面不用它（目录外的内容不进页面）', mockOf(ln) === null)
  check('软链接的 mock.json：存成初始数据不写', saveMock(ln, { a: 1 }).reason === 'link' && fs.readFileSync(path.join(tmp, 'outside.json'), 'utf8') === '{"secret":1}')
} else console.log('（建不了软链接，跳过两条）')
check('旧版本的屏用单独一份数据（scope v），不会清掉现在点出来的', /"scope":"v"/.test(mockScript({ ...parseMock('{}'), scope: 'v' })) && /"scope":""/.test(mockScript(parseMock('{}'))))

// ── 转成代码：交接说明里写上模拟数据 ──
const hd = path.join(tmp, 'ho')
fs.mkdirSync(hd)
const hoPages = new Map([['a.html', `<meta name="dsh-states" content="x:甲, y:乙" data-mock="user.stage"><p data-mock-text="'名：' + user.name"></p><ul data-mock-each="it in list"><template><li data-mock-text="it.t"></li></template></ul><button data-mock-set="user.stage = 'y'; n = n + 1">x</button>`], ['b.html', '<p>纯展示</p>']])
check('交接说明：没有 mock.json 就不写', mockMd(hoPages, hd).length === 0)
fs.writeFileSync(path.join(hd, MOCK_FILE), JSON.stringify({ user: { name: 'a', stage: 'x' }, list: [], n: 0 }))
const hoMd = mockMd(hoPages, hd).join('\n')
check('交接说明：写清数据在 mock.json、做成全局状态、各屏用到哪些字段、哪些屏的状态跟着数据', /mock\.json/.test(hoMd) && /全局状态/.test(hoMd) && ['`user.stage`', '`user.name`', '`list`', '`n`', '点了改数据 1 处'].every((x) => (/a\.html：.*/.exec(hoMd) || [''])[0].includes(x)) && !/b\.html/.test(hoMd) && /a\.html（user\.stage）/.test(hoMd), hoMd)
fs.writeFileSync(path.join(hd, MOCK_FILE), '{oops')
check('交接说明：mock.json 坏了提醒先修', /读不出来/.test(mockMd(hoPages, hd).join('\n')))

// ── 真浏览器 ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  const site = path.join(tmp, 'site')
  fs.mkdirSync(site)
  const MOCK = { user: { name: '小林', stage: 'interviewing', agree: false, phone: '', tier: 'normal', cv: 'resume.pdf' }, cart: 0, fee: 99, fee2: 10, todos: [], apps: [{ title: 'ADAS 测试', status: 'interview' }, { title: 'HIL 台架', status: 'offer' }], count: 2, evil: '</script><script>window.__pwn=1</script>', qa: 1, qb: 2, total: 0, sel: null, items: [{ name: 'a' }, { name: 'b' }], jsurl: 'java\nscript:window.__pwn2=1' }
  fs.writeFileSync(path.join(site, MOCK_FILE), JSON.stringify(MOCK))
  fs.writeFileSync(path.join(site, 'home.html'), `<!doctype html><html data-state="interviewing"><head><meta name="dsh-states" content="interviewing:面试中, onsite:在项" data-mock="user.stage"><title>首页</title>
<style>[data-state="onsite"] .tab-iv{display:none}</style></head><body>
<h1 id="name" data-mock-text="user.name">占位</h1>
<p id="evil" data-mock-text="evil"></p>
<div id="iv" data-mock-show="user.stage == 'interviewing'">面试中卡片</div>
<div id="on" data-mock-show="user.stage == 'onsite'" style="display:flex">在项卡片</div>
<span id="cnt" data-mock-text="'共 ' + count + ' 个'"></span>
<button id="accept" data-mock-set="user.stage = 'onsite'; count = count + 1">接受</button>
<ul id="list" data-mock-each="app, i in apps"><template><li class="app" data-mock-class="hot: app.status == 'offer'"><span class="t" data-mock-text="(i + 1) + '. ' + app.title"></span><button class="ok" data-mock-set="app.status = 'done'">完成</button></li></template><li id="foot">查看全部</li></ul>
<input id="phone" data-mock-model="user.phone">
<input id="agree" type="checkbox" data-mock-model="user.agree">
<button id="go" data-mock-attr="disabled: !user.agree; title: user.agree ? '可以' : '先勾选'">下一步</button>
<button id="reset" data-mock-reset>重置</button>
<a id="link" href="profile.html" data-mock-set="user.name = '去过我的'">我的</a>
</body></html>`)
  fs.writeFileSync(path.join(site, 'profile.html'), `<!doctype html><html><head><title>我的</title></head><body>
<p id="stage" data-mock-text="user.stage"></p><p id="phone" data-mock-text="user.phone"></p><p id="cnt" data-mock-text="count"></p><p id="name" data-mock-text="user.name"></p>
<script>window.seen = []; mock.on((d) => window.seen.push(d.user.stage))</script>
</body></html>`)
  fs.writeFileSync(path.join(site, 'bad.html'), `<!doctype html><html><head><title>坏</title></head><body>
<div id="b1" data-mock-show="user.stage = 'x'">a</div><button id="pp" data-mock-set="__proto__.polluted = 1">p</button><p id="miss" data-mock-text="user.nope"></p>
<ul data-mock-each="x in apps"><li>没 template</li></ul>
<a id="js" data-mock-attr="href: 'javascript:alert(1)'; onclick: 'x'">j</a>
<p data-mock-show="user.nope2 == null">判空</p><p data-mock-show="!user.nope3">取反</p><p data-mock-text="user.nick || user.name"></p><p data-mock-text="user.vip ? '会员' : '普通'"></p>
<ul data-mock-each="app in apps"><template><li data-mock-text="app.status"></li></template></ul>
</body></html>`)
  fs.writeFileSync(path.join(site, 'more.html'), `<!doctype html><html><head><title>更多</title></head><body>
<p id="tot" data-mock-text="total"></p><button id="inc" data-mock-set="qa = qa + 1">+</button>
<div id="det" data-mock-show="sel"><p data-mock-text="sel.title"></p><p data-mock-text="sel.price"></p></div>
<ul id="its" data-mock-each="it in items"><template><li><input class="nm" data-mock-model="it.name"><span class="ec" data-mock-text="it.name"></span></li></template></ul>
<a id="jl" data-mock-attr="href: jsurl">x</a>
<div data-mock-show="user.loggedIn"><ul data-mock-each="o in orders"><template><li data-mock-text="o.id"></li></template></ul><p data-mock-text="user.level"></p></div>
<style>.gone{display:none}</style><p class="gone" data-mock-text="ghost.name"></p><p id="vis" data-mock-text="ghost2.name"></p>
<div style="visibility:hidden"><p data-mock-text="vh.name"></p></div><div style="opacity:0"><div><p data-mock-text="op.name"></p></div></div>
<script>mock.on(function (d) { mock.set('total', d.qa + d.qb) }); window.runaway = function () { mock.on(function (d) { mock.set('n2', (d.n2 || 0) + 1) }) }</script>
</body></html>`)
  fs.writeFileSync(path.join(site, 'fee.html'), `<!doctype html><html><head><meta name="dsh-states" content="normal:普通, vip:会员" data-mock="user.tier"><title>运费</title></head><body>
<p id="fee" data-mock-text="fee"></p><button id="add" data-mock-set="cart = cart + 1">加商品</button><p id="fee2" data-mock-text="fee2"></p><button id="rst" data-mock-reset>重置</button>
<script>mock.on(function (d) { if (d.cart >= 1 && d.user.tier === 'vip') mock.set('fee2', 0) }); window.n = 0; addEventListener('storage', () => window.n++); mock.on(function (d) { mock.set('fee', d.user.tier === 'vip' ? 0 : 10 + d.cart) })</script></body></html>`)
  fs.writeFileSync(path.join(site, 'slide.html'), `<!doctype html><html><head><title>滑块</title></head><body>
<input id="rg" type="range" min="0" max="200" data-mock-model="vol"><p id="v2" data-mock-text="vol2"></p>
<script>mock.on(function (d) { mock.set('vol2', d.vol * 2) })</script></body></html>`)
  fs.writeFileSync(path.join(site, 'both3.html'), '<!doctype html><html><head><title>拖滑块</title></head><body><iframe id="a" src="slide.html"></iframe><iframe id="b" src="profile.html"></iframe></body></html>')
  for (const [n, k] of [['pp1', 1], ['pp2', 2]]) fs.writeFileSync(path.join(site, n + '.html'), `<!doctype html><html><head><title>${n}</title></head><body><button id="go" data-mock-set="cart = cart + 1">+</button>
<script>window.runs = 0; mock.on(function (d) { window.runs++; mock.set('px', d.cart + ${k}) })</script></body></html>`)
  fs.writeFileSync(path.join(site, 'both4.html'), '<!doctype html><html><head><title>两屏各算各的</title></head><body><iframe id="a" src="pp1.html"></iframe><iframe id="b" src="pp2.html"></iframe></body></html>')
  fs.writeFileSync(path.join(site, 'both2.html'), '<!doctype html><html><head><title>并排两个状态</title></head><body><iframe id="a" src="fee.html?state=normal"></iframe><iframe id="b" src="fee.html?state=vip"></iframe></body></html>')
  fs.writeFileSync(path.join(site, 'form.html'), `<!doctype html><html><head><title>表单</title></head><body>
<form onsubmit="return false"><input id="tel" required data-mock-model="user.phone"><input id="cv" type="file" data-mock-model="user.cv"><button id="sub" type="submit" data-mock-set="sent = true">提交</button><button id="next" data-mock-set="step = 2">下一步</button><div style="display:none"><input required id="later"><button id="sub2" type="submit" data-mock-set="sent2 = true">提交 2</button></div></form>
<form onsubmit="return false"><div style="display:none"><input required></div><button id="sub3" type="submit" data-mock-set="sent3 = true">提交</button></form>
<p id="after" data-mock-text="user.name"></p>
<ul data-mock-each="t in todos"><template><li><button data-mock-set="t.clicks += 1">+</button></li></template></ul>
<ul data-mock-each="o in todos"><template><li><ul data-mock-each="it in o.items"><template><li><button data-mock-set="it.qty += 2">+</button></li></template></ul></li></template></ul>
</body></html>`)
  fs.writeFileSync(path.join(site, 'both.html'), '<!doctype html><html><head><title>两屏</title></head><body><iframe id="a" src="home.html"></iframe><iframe id="b" src="profile.html"></iframe></body></html>')
  const hub = createHub()
  const e = await hub.open({ kind: 'file', root: site })
  const O = e.origin
  const b = createBrowser({ bin })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const tick = 'await new Promise((r) => setTimeout(r, 40));'
  const at = (url, fn, o = {}) => b.withPage({ url: O + '/' + url, w: 400, h: 800, store: true, ...o }, fn)
  try {
    const first = await at('home.html', (p) => p.eval(`(async () => { ${tick}
      const vis = (id) => getComputedStyle(document.getElementById(id)).display
      return { name: document.getElementById('name').textContent, evil: document.getElementById('evil').textContent, pwn: !!window.__pwn, iv: vis('iv'), on: vis('on'), st: document.documentElement.dataset.state,
        list: [...document.querySelectorAll('#list li')].map((li) => li.id || (li.querySelector('.t').textContent + (li.classList.contains('hot') ? '*' : ''))), go: document.getElementById('go').disabled, title: document.getElementById('go').title, cnt: cnt.textContent }
    })()`))
    check('显示：文字、条件显示、状态跟着数据（面试中）', first.name === '小林' && first.iv === 'block' && first.on === 'none' && first.st === 'interviewing' && first.cnt === '共 2 个', JSON.stringify(first))
    check('显示：数据里写了 </script> 也只是字，不会跑', first.evil === MOCK.evil && !first.pwn, JSON.stringify(first))
    check('列表：按数组重复、序号别名、按条件加 class，模板后面原有的留着', same(first.list, ['1. ADAS 测试', '2. HIL 台架*', 'foot']), JSON.stringify(first.list))
    check('属性：没勾同意时按钮不能点、title 跟着变', first.go === true && first.title === '先勾选', JSON.stringify(first))

    const after = await at('home.html', (p) => p.eval(`(async () => {
      document.getElementById('accept').click(); ${tick}
      document.querySelectorAll('#list .ok')[1].click(); ${tick}
      const ph = document.getElementById('phone'); ph.value = '138'; ph.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('agree').click(); ${tick}
      const vis = (id) => getComputedStyle(document.getElementById(id)).display
      return { st: document.documentElement.dataset.state, iv: vis('iv'), on: vis('on'), cnt: cnt.textContent, hot: document.querySelectorAll('#list .hot').length, go: document.getElementById('go').disabled, phone: mock.get('user.phone'), agree: mock.get('user.agree'), items: document.querySelectorAll('#list li.app').length }
    })()`))
    check('点了改数据：状态换成在项、卡片换了、几句都执行（计数 +1）', after.st === 'onsite' && after.iv === 'none' && after.on === 'flex' && after.cnt === '共 3 个', JSON.stringify(after))
    check('列表里点的改的是那一项（别名 app → apps.1）、重画后不多出来', after.hot === 0 && after.items === 2, JSON.stringify(after))
    check('输入框、勾选框双向；勾了按钮能点', after.phone === '138' && after.agree === true && after.go === false, JSON.stringify(after))

    const prof = await at('profile.html', (p) => p.eval(`({ stage: document.getElementById('stage').textContent, phone: document.getElementById('phone').textContent, cnt: document.getElementById('cnt').textContent })`))
    check('换到别的页：刚才改的都还在', prof.stage === 'onsite' && prof.phone === '138' && prof.cnt === '3', JSON.stringify(prof))

    const forced = await at('home.html?state=interviewing', (p) => p.eval(`(async () => { ${tick} return { st: document.documentElement.dataset.state, iv: getComputedStyle(document.getElementById('iv')).display, view: mock.get('user.stage') } })()`))
    const still = await at('profile.html', (p) => p.eval(`document.getElementById('stage').textContent`))
    check('地址指定状态（画布状态标签 / 体检逐状态）：这一屏临时当成那个状态', forced.st === 'interviewing' && forced.iv === 'block' && forced.view === 'interviewing', JSON.stringify(forced))
    check('地址指定状态：不写回（别的页还是用户点出来的在项）', still === 'onsite', still)

    // 点了又改数据又跳屏：先存好再跳
    const jumped = await at('home.html', async (p) => { await p.eval(`document.getElementById('link').click()`); await wait(600); return p.eval(`location.pathname + '|' + document.getElementById('name').textContent`) })
    check('又改数据又跳屏的链接：跳过去时数据已经改好', jumped === '/profile.html|去过我的', jumped)

    // 两屏一起开着（画布）：一屏里点了，另一屏跟着变
    const live = await at('both.html', async (p) => {
      await wait(500)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        A.document.getElementById('reset').click(); await new Promise((r) => setTimeout(r, 200))
        const r1 = B.document.getElementById('stage').textContent
        A.document.getElementById('accept').click(); await new Promise((r) => setTimeout(r, 200))
        return { r1, r2: B.document.getElementById('stage').textContent, seen: B.seen }
      })()`)
    })
    check('重置：回到 mock.json；同时开着的另一屏跟着变', live.r1 === 'interviewing', JSON.stringify(live))
    check('一屏里点了，同时开着的另一屏跟着变，mock.on 收得到', live.r2 === 'onsite' && live.seen.includes('onsite'), JSON.stringify(live))

    // 选取、改字、调样式开着时点页面不改数据
    const busy = await at('home.html', (p) => p.eval(`(async () => { mock.reset(); ${tick} Object.defineProperty(window, '__ddpBusy', { value: () => true, configurable: true }); document.getElementById('accept').click(); ${tick} return mock.get('user.stage') })()`))
    check('选取 / 改字 / 调样式开着时点了不改数据', busy === 'interviewing', String(busy))

    // 坏写法：报出来，不执行
    const badr = await at('bad.html', (p) => p.eval(`(async () => { document.getElementById('pp').click(); ${tick} return { errs: (window.__dshErrs || []).map((x) => x.msg), polluted: ({}).polluted, href: document.getElementById('js').getAttribute('href'), on: document.getElementById('js').getAttribute('onclick'), b1: getComputedStyle(document.getElementById('b1')).display, miss: window.__dshMockMissing } })()`))
    check('写错的条件、碰原型的改法、没 template 的列表：报进页面错误（体检看得到），原型没被改', badr.errs.length >= 3 && badr.errs.every((m) => m.startsWith('模拟数据：')) && badr.polluted === undefined, JSON.stringify(badr))
    check('data-mock-attr 不能设 on 开头的属性、不能设 javascript: 地址', badr.href === null && badr.on === null, JSON.stringify(badr))
    check('数据里找不到的路径记下来（体检提醒用）', Array.isArray(badr.miss) && badr.miss.includes('user.nope'), JSON.stringify(badr.miss))
    check('故意没写的不算漏写：判空、取反、|| 左边、? 前面、列表里只有部分条目有的字段', !badr.miss.some((k) => /nope2|nope3|nick|vip|apps\.1\.status/.test(k)), JSON.stringify(badr.miss))

    // 无头浏览器（体检、截图）默认不存：几屏互不串
    await at('home.html', (p) => p.eval(`mock.reset()`))
    await at('home.html', (p) => p.eval(`(async () => { document.getElementById('accept').click(); ${tick} })()`), { store: false })
    const nostore = await at('profile.html', (p) => p.eval(`document.getElementById('stage').textContent`), { store: false })
    check('无头浏览器（体检、截图）：点了也不存，下一屏还是初始数据', nostore === 'interviewing', nostore)

    // mock.json 改了：从新文件重新开始，旧的那份清掉
    await at('home.html', (p) => p.eval(`(async () => { document.getElementById('accept').click(); ${tick} })()`))
    fs.writeFileSync(path.join(site, MOCK_FILE), JSON.stringify({ ...MOCK, user: { ...MOCK.user, name: '小王' } }))
    await wait(30)
    const fresh = await at('profile.html', (p) => p.eval(`({ name: document.getElementById('name').textContent, stage: document.getElementById('stage').textContent, keys: Object.keys(localStorage).filter((k) => k.startsWith('dsh-mock:')).length })`))
    check('mock.json 改了：用新数据重新开始，旧的存档清掉', fresh.name === '小王' && fresh.stage === 'interviewing' && fresh.keys <= 1, JSON.stringify(fresh))
    // 改了 mock.json，预览服务器过一会儿会让开着的页整页刷新（文件监听有延迟）：等它过去，后面的页取值时不被刷新打断
    await wait(1500)

    // mock.on 里算合计再写回（最常见的写法）：不死循环；回调里每次都改成新值的：停下、报出来
    const more = await at('more.html', (p) => p.eval(`(async () => {
      const r = {}
      document.getElementById('inc').click(); ${tick}
      r.tot = document.getElementById('tot').textContent
      r.miss = window.__dshMockMissing
      mock.set('user.loggedIn', true); ${tick}
      r.miss2 = window.__dshMockMissing
      mock.set('user.loggedIn', false); ${tick}
      r.href = document.getElementById('jl').getAttribute('href')
      // 列表里的输入框连着打字：还是同一个框、焦点还在
      const inp = document.querySelector('#its .nm')
      inp.focus()
      inp.value = 'ax'; inp.dispatchEvent(new Event('input', { bubbles: true })); ${tick}
      inp.value = 'axy'; inp.dispatchEvent(new Event('input', { bubbles: true })); ${tick}
      r.same = document.querySelector('#its .nm') === inp && document.activeElement === inp && document.querySelector('#its .ec').textContent === 'axy' && document.querySelectorAll('#its li').length === 2
      window.runaway()
      document.getElementById('inc').click()
      await new Promise((res) => setTimeout(res, 300))
      r.alive = true
      r.errs = (window.__dshErrs || []).map((x) => x.msg)
      r.n2 = mock.get('n2')
      return r
    })()`))
    check('mock.on 里算合计再写回：不卡死，合计对', more.tot === '4', JSON.stringify(more))
    check('mock.on 里每次都改成新值：停下来、报进页面错误，页面不卡', more.alive === true && more.errs.some((m) => /一直在改数据/.test(m)) && more.n2 > 0 && more.n2 < 80, JSON.stringify({ errs: more.errs, n2: more.n2 }))
    check('「选了才显示」那块藏着时，里面读不到的字段不算漏写（sel 是 null）', Array.isArray(more.miss) && !more.miss.some((k) => /^sel\./.test(k)), JSON.stringify(more.miss))
    check('没登录时藏着的那块（里面有列表）、用 CSS 藏起来的（display / visibility / 外层透明）：读不到不算漏写；看得见的照样报', !more.miss.some((k) => /^(orders|user\.level|ghost\.name|vh\.name|op\.name)$/.test(k)) && more.miss.includes('ghost2.name'), JSON.stringify(more.miss))
    check('藏着的那块打开了（登录了）：里面真漏写的列表、字段照样报', more.miss2.includes('orders') && more.miss2.includes('user.level'), JSON.stringify(more.miss2))
    check('链接地址夹了换行的 javascript:（java⏎script:）也拦', more.href === null && more.errs.some((m) => /脚本地址/.test(m)), JSON.stringify(more))
    check('列表里的输入框连着打字：还是同一个框、焦点不丢', more.same === true, JSON.stringify(more))

    // 同一屏两个状态并排（?state=normal / vip），回调各算各的运费：不来回改、各显示各的
    const pair = await at('both2.html', async (p) => {
      await wait(600)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        A.document.getElementById('add').click()
        await new Promise((r) => setTimeout(r, 800))
        return { a: A.document.getElementById('fee').textContent, b: B.document.getElementById('fee').textContent, na: A.n, nb: B.n }
      })()`)
    })
    // 拖滑块（2 秒里改 80 次）、旁边开着别的屏：谁都不该报「一直在改数据」，别的屏的回调收到最后那个值
    const drag = await at('both3.html', async (p) => {
      await wait(600)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        const rg = A.document.getElementById('rg')
        for (let i = 1; i <= 80; i++) { rg.value = String(i); rg.dispatchEvent(new A.Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)) }
        await new Promise((r) => setTimeout(r, 400))
        const errs = (w) => (w.__dshErrs || []).map((x) => x.msg).filter((m) => /一直在改数据/.test(m))
        return { ea: errs(A), eb: errs(B), v2: A.document.getElementById('v2').textContent, bVol: B.mock.get('vol'), bSeen: B.seen.length }
      })()`)
    })
    check('拖滑块（快速改 80 次）、旁边开着别的屏：不误报「一直在改数据」，回调和别的屏都跟到最后的值', !drag.ea.length && !drag.eb.length && drag.v2 === '160' && drag.bVol === 80, JSON.stringify(drag))
    check('同一屏两个状态并排、回调各算各的：不来回改（几屏不互相刷个不停）、各显示各的', pair.a === '11' && pair.b === '0' && pair.na + pair.nb < 10, JSON.stringify(pair))
    // 在「会员」那屏连点两次：会员算出来的运费 0 只在那屏，不存进共享数据（普通那屏、存着的都不是 0）
    const pair2 = await at('both2.html', async (p) => {
      await wait(600)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        B.document.getElementById('add').click(); await new Promise((r) => setTimeout(r, 200))
        B.document.getElementById('add').click(); await new Promise((r) => setTimeout(r, 400))
        const k = Object.keys(localStorage).find((x) => x.startsWith('dsh-mock:'))
        return { a: A.document.getElementById('fee').textContent, b: B.document.getElementById('fee').textContent, stored: JSON.parse(localStorage.getItem(k)).fee, cart: JSON.parse(localStorage.getItem(k)).cart }
      })()`)
    })
    const pp = await at('both4.html', async (p) => {
      await wait(600)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        A.document.getElementById('go').click()
        await new Promise((r) => setTimeout(r, 2500))
        const r0 = A.runs + B.runs
        await new Promise((r) => setTimeout(r, 500))
        const errs = [...(A.__dshErrs || []), ...(B.__dshErrs || [])].map((x) => x.msg).filter((m) => /一直在改数据/.test(m))
        return { r0, r1: A.runs + B.runs, errs: errs.length }
      })()`)
    })
    check('两屏的回调把同一个字段改成不一样的值：停下来、报出来，不一直来回改', pp.errs > 0 && pp.r1 === pp.r0 && pp.r0 < 3000, JSON.stringify(pp))
    const rsv = await at('fee.html?state=vip', (p) => p.eval(`(async () => { ${tick}
      document.getElementById('add').click(); ${tick}
      const before = document.getElementById('fee2').textContent
      document.getElementById('rst').click(); ${tick}
      return { before, after: document.getElementById('fee2').textContent, cart: mock.get('cart') }
    })()`))
    check('临时状态那屏点「重置」：回调算出来的（免运费）也回到初始', rsv.before === '0' && rsv.after === '10' && rsv.cart === 0, JSON.stringify(rsv))
    // 在会员那屏加购（免运费算成 0），再在旁边普通那屏点重置（「数据」面板的重置也是这样传过来的）：会员那屏也回到 10
    const rso = await at('both2.html', async (p) => {
      await wait(600)
      return p.eval(`(async () => {
        const A = document.getElementById('a').contentWindow, B = document.getElementById('b').contentWindow
        B.document.getElementById('add').click(); await new Promise((r) => setTimeout(r, 300))
        const before = B.document.getElementById('fee2').textContent
        A.document.getElementById('rst').click()
        const end = Date.now() + 3000
        while (B.document.getElementById('fee2').textContent !== '10' && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
        return { before, after: B.document.getElementById('fee2').textContent, cart: B.mock.get('cart'), tier: B.document.documentElement.dataset.state }
      })()`)
    })
    check('别的屏点重置：临时状态（会员）那屏回调算出来的也回到初始，状态还是会员', rso.before === '0' && rso.after === '10' && rso.cart === 0 && rso.tier === 'vip', JSON.stringify(rso))
    check('并排状态：会员屏回调算的运费不进共享数据（存着的、普通屏都不是 0）', pair2.b === '0' && pair2.a === String(10 + pair2.cart) && pair2.stored !== 0, JSON.stringify(pair2))
    const form = await at('form.html', (p) => p.eval(`(async () => { ${tick}
      document.getElementById('sub').click(); ${tick}
      document.getElementById('next').click(); ${tick}
      document.getElementById('sub3').click(); ${tick}
      return { step: mock.get('step'), sent3: mock.get('sent3'), sent: mock.get('sent'), after: document.getElementById('after').textContent, errs: (window.__dshErrs || []).map((x) => x.msg) }
    })()`))
    check('表单必填没填就点提交：浏览器拦下，数据也不改成已提交', form.sent === undefined, JSON.stringify(form))
    check('表单里没写 type 的按钮（分步「下一步」）照常改；藏着的那几步里的必填不拦提交', form.step === 2 && form.sent3 === true, JSON.stringify(form))
    check('选文件的框绑了数据：不报错、后面的绑定照常画', form.after === '小王' && !form.errs.some((m) => /InvalidState|data-mock-model/.test(m)), JSON.stringify(form))
    check('列表现在是空的：模板里写错的按钮也马上报（不用等加了第一条），模板里套的模板也看', form.errs.some((m) => /t\.clicks \+= 1/.test(m)) && form.errs.some((m) => /it\.qty \+= 2/.test(m)), JSON.stringify(form.errs))

    // 别人做的（加了 CSP + nonce）：照样能跑
    const hs = createHub({ strict: { html: () => true, root: () => true } })
    const es = await hs.open({ kind: 'file', root: site })
    try {
      const sx = await b.withPage({ url: es.origin + '/home.html', w: 400, h: 800 }, (p) => p.eval(`(async () => { ${tick} return document.getElementById('name').textContent + '|' + typeof mock })()`))
      check('别人做的设计（CSP 只放带 nonce 的脚本）：模拟数据照样能用', sx === '小王|object', sx)
    } finally { hs.closeAll() }

    // 「数据」面板背后的桥（/__dsh_design__/mock.html）：只认 DSH 网页那几个来源；读、改、重置，开着的屏跟着变
    let P = ''
    const hb = createHub({ parents: () => (P ? [P] : []) })
    const hp = createHub()
    const hx = createHub()
    try {
      const eb = await hb.open({ kind: 'file', root: site })
      const par = path.join(tmp, 'par')
      fs.mkdirSync(par)
      const ep = await hp.open({ kind: 'file', root: par })
      P = ep.origin
      const ex = await hx.open({ kind: 'file', root: par })
      fs.writeFileSync(path.join(par, 'p.html'), `<!doctype html><html><head><title>p</title></head><body>
<iframe id="br" src="${eb.origin}/__dsh_design__/mock.html"></iframe><iframe id="pg" src="${eb.origin}/home.html"></iframe>
<script>window.got = []; addEventListener('message', (e) => { if (e.data && e.data.ddpMock === 1) window.got.push({ o: e.origin, d: e.data }) })
window.send = (m) => document.getElementById('br').contentWindow.postMessage({ ddpMock: 1, ...m }, ${JSON.stringify(eb.origin)})
window.last = () => { const g = window.got.filter((x) => x.d.type === 'data'); return g.length ? g[g.length - 1].d : null }</script></body></html>`)
      const br = await b.withPage({ url: P + '/p.html', w: 600, h: 900, store: true }, async (p) => {
        const until = async (expr, ms = 4000) => { const end = Date.now() + ms; for (;;) { let v; try { v = await p.eval(expr) } catch { v = undefined } if (v || Date.now() > end) return v; await wait(100) } }
        const r = {}
        r.first = await until(`(() => { const d = last(); return d && JSON.stringify({ name: d.data.user.name, init: d.initial.user.name, o: got[0].o, err: d.err }) })()`)
        // 机器忙（几套测试一起跑）时消息慢：等到变了再看，最多 4 秒
        const untilF = async (expr, want, ms = 4000) => { const end = Date.now() + ms; for (;;) { let v; try { v = await p.frameEval(expr) } catch { v = undefined } if (v === want || Date.now() > end) return v; await wait(100) } }
        await p.eval(`send({ type: 'set', keys: ['user', 'stage'], value: 'onsite' })`)
        r.set = (await until(`(() => { const s = last().data.user.stage + '|' + last().initial.user.stage; return s === 'onsite|interviewing' && s })()`)) || (await p.eval(`last().data.user.stage + '|' + last().initial.user.stage`))
        r.pgSet = await untilF(`document.documentElement.dataset.state + '|' + getComputedStyle(document.getElementById('on')).display`, 'onsite|flex')
        await p.frameEval(`document.getElementById('reset').click()`)
        r.fromPage = (await until(`last().data.user.stage === 'interviewing' && 'interviewing'`)) || (await p.eval(`last().data.user.stage`))
        await p.eval(`send({ type: 'set', keys: ['count'], value: 9 })`)
        await wait(300)
        await p.eval(`send({ type: 'set', keys: ['__proto__', 'x'], value: 1 })`)
        await wait(300)
        r.fail = await p.eval(`got.some((x) => x.d.type === 'fail')`)
        await p.eval(`send({ type: 'reset' })`)
        r.reset = (await until(`last().data.count === 2 && 2`)) || (await p.eval(`last().data.count`))
        r.pgReset = await untilF(`document.getElementById('cnt').textContent`, '共 2 个')
        return r
      })
      check('桥：打开就把数据和初始数据报上来（只发给 DSH 网页）', br.first && JSON.parse(br.first).name === '小王' && JSON.parse(br.first).init === '小王' && JSON.parse(br.first).o === eb.origin && !JSON.parse(br.first).err, JSON.stringify(br))
      check('桥：面板里改了 → 数据变了、开着的屏马上跟着变（状态也换）', br.set === 'onsite|interviewing' && br.pgSet === 'onsite|flex', JSON.stringify(br))
      check('桥：屏里点出来的变化，面板马上收到', br.fromPage === 'interviewing', JSON.stringify(br))
      check('桥：碰原型的改法报错不执行；重置回到 mock.json、屏跟着回去', br.fail === true && br.reset === 2 && br.pgReset === '共 2 个', JSON.stringify(br))
      // 不认识的网页嵌进来：一个字都不发
      fs.writeFileSync(path.join(par, 'x.html'), `<!doctype html><html><head><title>x</title></head><body><iframe id="br" src="${eb.origin}/__dsh_design__/mock.html"></iframe>
<script>window.got = 0; addEventListener('message', (e) => { if (e.data && e.data.ddpMock === 1) window.got++ }); setTimeout(() => document.getElementById('br').contentWindow.postMessage({ ddpMock: 1, type: 'get' }, '*'), 500)</script></body></html>`)
      const stranger = await b.withPage({ url: ex.origin + '/x.html', w: 400, h: 400, store: true }, async (p) => { await wait(1200); return p.eval('window.got') })
      check('桥：别的网页嵌进来、问它要数据，什么都不给', stranger === 0, String(stranger))
      const noMock = await hb.open({ kind: 'file', root: par })
      const code = await b.withPage({ url: noMock.origin + '/__dsh_design__/mock.html', w: 400, h: 400 }, (p) => p.eval('document.body.textContent'))
      check('桥：没有 mock.json 的设计没有这一页', /no mock data/.test(code), code)
    } finally { hb.closeAll(); hp.closeAll(); hx.closeAll() }

    // 导出成 HTML 演示（整套一个文件）：数据只放一份；换屏数据还在、状态跟着数据；播放器有「重置数据」
    const ps = path.join(tmp, 'pack')
    fs.mkdirSync(ps)
    fs.writeFileSync(path.join(ps, MOCK_FILE), JSON.stringify({ user: { stage: 'interviewing', name: '独一无二的名字', avatar: 'img/me.svg' }, count: 1 }))
    fs.mkdirSync(path.join(ps, 'img'))
    fs.writeFileSync(path.join(ps, 'img', 'me.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>')
    fs.writeFileSync(path.join(ps, 'a.html'), `<!doctype html><html data-state="interviewing"><head><meta name="dsh-states" content="interviewing:面试中, onsite:在项" data-mock="user.stage"><title>A</title></head><body>
<p id="st" data-mock-text="user.stage"></p><img id="av" data-mock-attr="src: user.avatar" alt=""><span id="avn" data-mock-text="user.avatar"></span><button id="acc" data-mock-set="user.stage = 'onsite'; count = count + 1">接受</button><a id="go" href="b.html" data-mock-set="user.name = '跳过来了'">去 B</a></body></html>`)
    fs.writeFileSync(path.join(ps, 'b.html'), `<!doctype html><html data-state="interviewing"><head><meta name="dsh-states" content="interviewing:面试中, onsite:在项" data-mock="user.stage"><title>B</title></head><body>
<p id="st" data-mock-text="user.stage"></p><p id="nm" data-mock-text="user.name"></p><p id="cnt" data-mock-text="count"></p></body></html>`)
    const readPs = (rel) => { const f = path.join(ps, rel); try { return fs.statSync(f).isFile() ? fs.readFileSync(f) : null } catch { return null } }
    // mixed：一屏自己做的、一屏别人做的（设计库导进来只改了一屏）：存的地方要是同一份
    for (const strict of [false, true, 'mixed']) {
      const pk = buildPack({ screens: [{ key: 'a.html', label: 'A' }, { key: 'b.html', label: 'B' }], read: readPs, strictOf: (pg) => (strict === 'mixed' ? String(pg).includes('<title>B</title>') : strict), kind: 'web', w: 1000, h: 700, lang: 'zh' })
      const pf = path.join(tmp, `demo-${strict === 'mixed' ? 'm' : strict ? 's' : 'n'}.html`)
      fs.writeFileSync(pf, pk.html)
      if (!strict) check('HTML 演示：数据整套只放一份', pk.html.split('独一无二的名字').length === 2, String(pk.html.split('独一无二的名字').length - 1))
      const rp = await b.withPage({ url: 'file://' + (process.platform === 'win32' ? '/' : '') + pf.replace(/\\/g, '/'), w: 1280, h: 900, store: true }, async (p) => {
        const until = async (expr, ms = 5000, inFrame = false) => { const end = Date.now() + ms; for (;;) { let v; try { v = inFrame ? await p.frameEval(expr) : await p.eval(expr) } catch { v = undefined } if (v || Date.now() > end) return v; await wait(100) } }
        const r = {}
        r.btn = await until(`(() => { const x = document.getElementById('mreset'); return x && !x.hidden && getComputedStyle(x).display !== 'none' })()`)
        r.a0 = await until(`(() => { const e = document.getElementById('st'); return e && e.textContent })()`, 5000, true)
        r.img = await until(`(() => { const i = document.getElementById('av'); return !!i && i.complete && i.naturalWidth === 20 })()`, 5000, true)
        r.avn = await p.frameEval(`document.getElementById('avn').textContent`)
        await p.frameEval(`document.getElementById('acc').click()`)
        await wait(200)
        await p.frameEval(`document.getElementById('go').click()`)
        r.moved = await until(`document.getElementById('count').textContent === '2 / 2' && !document.querySelector('iframe.nx')`)
        r.b = await until(`(() => { const e = document.getElementById('nm'); return e && e.textContent && JSON.stringify({ st: document.getElementById('st').textContent, nm: e.textContent, cnt: document.getElementById('cnt').textContent, ds: document.documentElement.dataset.state }) })()`, 5000, true)
        await p.eval(`document.getElementById('mreset').click()`)
        await wait(600)
        r.afterReset = await until(`(() => { const e = document.getElementById('nm'); return e && e.textContent === '独一无二的名字' && JSON.stringify({ st: document.getElementById('st').textContent, cnt: document.getElementById('cnt').textContent }) })()`, 5000, true)
        return r
      })
      const tagS = strict === 'mixed' ? '（一屏自己做、一屏别人做）' : strict ? '（别人做的，加了 CSP）' : ''
      check(`HTML 演示${tagS}：播放器有「重置数据」，第一屏显示初始数据`, rp.btn === true && rp.a0 === 'interviewing', JSON.stringify(rp))
      check(`HTML 演示${tagS}：数据里写的本地图片（绑到 src）照样显示，同一个字段当文字显示还是文件名`, rp.img === true && rp.avn === 'img/me.svg', JSON.stringify(rp))
      check(`HTML 演示${tagS}：点了再跳屏，下一屏数据都在、状态跟着换`, !!rp.moved && rp.b && JSON.parse(rp.b).nm === '跳过来了' && JSON.parse(rp.b).st === 'onsite' && JSON.parse(rp.b).cnt === '2' && JSON.parse(rp.b).ds === 'onsite', JSON.stringify(rp))
      check(`HTML 演示${tagS}：点「重置数据」回到初始数据`, !!rp.afterReset && JSON.parse(rp.afterReset).st === 'interviewing' && JSON.parse(rp.afterReset).cnt === '1', JSON.stringify(rp))
    }
    // 状态跟着数据走的屏：数据是「在项」，点名第一个状态（面试中）要真的显示面试中
    {
      const pf2 = path.join(tmp, 'pf2')
      fs.mkdirSync(pf2)
      fs.writeFileSync(path.join(pf2, MOCK_FILE), JSON.stringify({ user: { stage: 'onsite' } }))
      fs.writeFileSync(path.join(pf2, 'c.html'), `<!doctype html><html><head><meta name="dsh-states" content="interviewing:面试中, onsite:在项" data-mock="user.stage"><title>C</title></head><body><p id="st" data-mock-text="user.stage"></p><a id="self" href="c.html">本页</a></body></html>`)
      const rd2 = (rel) => { const f = path.join(pf2, rel); try { return fs.statSync(f).isFile() ? fs.readFileSync(f) : null } catch { return null } }
      const pk2 = buildPack({ screens: [{ key: 'c.html', label: 'C' }], read: rd2, kind: 'web', w: 1000, h: 700, lang: 'zh' })
      const f2 = path.join(tmp, 'demo-follow.html')
      fs.writeFileSync(f2, pk2.html)
      const ds = await b.withPage({ url: 'file://' + (process.platform === 'win32' ? '/' : '') + f2.replace(/\\/g, '/') + '#' + encodeURIComponent('c.html?state=interviewing'), w: 1280, h: 900 }, async (p) => {
        const end = Date.now() + 5000
        let v0 = ''
        for (;;) { try { v0 = await p.frameEval(`document.documentElement.dataset.state`) } catch { v0 = '' } if (v0 === 'interviewing' || Date.now() > end) break; await wait(100) }
        try { await p.frameEval(`document.getElementById('self').click()`) } catch { /* 没有 */ }
        const end2 = Date.now() + 5000
        let v1 = ''
        for (;;) { try { v1 = await p.frameEval(`document.documentElement.dataset.state`) } catch { v1 = '' } if (v1 === 'onsite' || Date.now() > end2) break; await wait(100) }
        return { v0, v1 }
      })
      check('HTML 演示：状态跟着数据走的屏，点名第一个状态就显示第一个（不被数据里的盖掉）', ds.v0 === 'interviewing', JSON.stringify(ds))
      check('HTML 演示：点名了第一个状态再点不带状态的「本页」→ 回到跟着数据（在项）', ds.v1 === 'onsite', JSON.stringify(ds))
    }
  } finally {
    b.stop()
    hub.closeAll()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
