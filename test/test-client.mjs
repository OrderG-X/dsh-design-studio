/**
 * 客户端冒烟测试（不用开 DSH）：
 *   node test/test-client.mjs
 *
 * 用假的 __ModuleLoader__ / react / ctx 把 lib/client.js 跑一遍：标签页类型、标签页内容、标题栏按钮都注册上；
 * 自动弹出只在这个会话正显示时生效；选中内容整理成的文字格式对。
 */
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (v = null) => ({ current: v }),
  useCallback: (fn) => fn,
}
let mod
globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { mod = factory((name) => (name === 'react' ? react : null)) } } }
new Function(src)()

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

check('inject 写的是客户端短服务名', JSON.stringify(mod.inject) === JSON.stringify(['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']))

// ── 注册 ──
const tabs = []
const slots = []
const opened = []
let onScreen = 'sA'
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => {}, t: () => '' },
  sidebarRightTabs: { register: (o) => { tabs.push(o); return () => {} } },
  sidebarRight: { mounted: { getSnapshot: () => onScreen }, openTab: (kind) => opened.push(kind) },
  slots: {
    inject: (name, fn) => fn(),
    register: (opts, comp) => { slots.push({ opts, comp }); return () => {} },
  },
  // DSH 0.2.1 起的服务：点选标签用（来源、会话、消息里的规则）
  inject: (deps, fn) => fn({ ...svc, effect: (f) => f() }),
}
const sources = []
const rules = []
const bails = []
const svc = {
  inputTriggers: { registerSource: (src) => { sources.push(src); return () => {} } },
  sessions: { binding: (sid) => (sid === 'sA' ? { ctx: { bail: (self, name, req) => { bails.push({ name, req }); return true } } } : undefined) },
  uiConversation: { userText: { register: (r) => { rules.push(r); return () => {} } } },
}
mod.apply(ctx)

check('注册了一种右侧栏标签页', tabs.length === 1 && tabs[0].kind === 'design-studio' && tabs[0].keepMounted === true)
check('「+」菜单里有入口', Array.isArray(tabs[0].guide) && tabs[0].guide.length === 1 && typeof tabs[0].guide[0].icon === 'function')
const names = slots.map((s) => s.opts.name)
check('标签页内容 + 标题栏按钮两个槽', names.includes('sidebar.right.pane.tab') && names.includes('conversation.session.header.utilities'), names.join(','))
const body = slots.find((s) => s.opts.name === 'sidebar.right.pane.tab')
check('标签页内容按 key 对上标签页 id', body.opts.key === tabs[0].id)
const head = slots.find((s) => s.opts.name === 'conversation.session.header.utilities')
check('标题栏按钮有 id 和顺序', head.opts.id === 'dsh-design-studio' && typeof head.opts.order === 'number')

const { open } = head.opts.inject('sA')
open('sB')
check('别的会话开了新页面 → 不弹（不抢当前会话的右侧栏）', opened.length === 0)
open('sA')
check('当前会话开了新页面 → 弹出预览', opened.length === 1 && opened[0] === 'design-studio')
open('sB', true)
check('点按钮 → 总是打开', opened.length === 2)

// ── 空状态 ──
function text(el) {
  if (el == null || el === false) return ''
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (Array.isArray(el)) return el.map(text).join('')
  if (typeof el.type === 'function') return text(el.type(el.props))
  return text(el.props && el.props.children) + (el.children || []).map(text).join('')
}
const loading = text(body.comp({ ...body.opts.inject('sEmpty') }))
check('还没拿到状态（DSH 刚启动）：先空着，不闪空状态', !loading.includes('还没有要预览的页面'), loading)
mod._test.poller('sEmpty').state = { url: '' }
const emptyView = body.comp({ ...body.opts.inject('sEmpty') })
const emptyText = text(emptyView)
check('空状态：三步说明 + 地址框', emptyText.includes('还没有要预览的页面') && emptyText.includes('点「选择」') && emptyText.includes('打开'), emptyText)

// ── 选中内容 → 文字 ──
const { formatPick, whereOf } = mod._test
const fileSt = { target: { kind: 'file', file: '/Users/me/我的 站/index.html', root: '/Users/me/我的 站' } }
const proxySt = { target: { kind: 'proxy', port: 5173, path: '/' } }

check('whereOf：本地文件给磁盘路径', whereOf('http://127.0.0.1:9/index.html', fileSt) === '文件：/Users/me/我的 站/index.html')
check('whereOf：子页面按目录拼（中文编码解开）', whereOf('http://127.0.0.1:9/%E5%85%B3%E4%BA%8E.html', fileSt) === '文件：/Users/me/我的 站/关于.html')
const winSt = { target: { kind: 'file', file: 'C:\\Users\\me\\我的 站\\index.html', root: 'C:\\Users\\me\\我的 站' } }
check('whereOf：Windows 路径用反斜杠拼', whereOf('http://127.0.0.1:9/%E5%85%B3%E4%BA%8E.html', winSt) === '文件：C:\\Users\\me\\我的 站\\关于.html'
  && whereOf('http://127.0.0.1:9/sub/a.html', winSt) === '文件：C:\\Users\\me\\我的 站\\sub\\a.html' && whereOf('http://127.0.0.1:9/', winSt) === '文件：C:\\Users\\me\\我的 站\\index.html', whereOf('http://127.0.0.1:9/sub/a.html', winSt))
check('whereOf：开发服务器给 localhost 地址', whereOf('http://127.0.0.1:9/about?x=1', proxySt) === '页面：http://localhost:5173/about?x=1')

const el = {
  kind: 'element',
  name: 'a.btn-order',
  selector: 'section.hero > div.actions > a.btn-order',
  text: '立即点单 →',
  html: '<a class="btn-order" href="#menu">立即点单 →</a>',
  rect: { x: 48, y: 537, w: 165, h: 56 },
  styles: { display: 'flex', color: 'rgb(255, 255, 255)', 'background-image': 'linear-gradient(red, blue)', 'font-size': '17px', 'font-weight': '700', padding: '16px 36px', 'border-radius': '999px', gap: '10px' },
  source: null,
  href: 'http://127.0.0.1:9/index.html',
}
let out = formatPick(el, fileSt)
const lines = out.trim().split('\n')
check('元素：第一行是标记 + 名字 + 文字', lines[0] === '〔选中元素〕a.btn-order「立即点单 →」', lines[0])
check('元素：带文件、位置、HTML', lines[1].startsWith('文件：') && lines[2] === '位置：section.hero > div.actions > a.btn-order' && lines[3].startsWith('HTML：<a'))
const styleLine = lines.find((l) => l.startsWith('样式：'))
check('元素：样式带尺寸、最多 6 项、按常用顺序', styleLine.startsWith('样式：165×56 · color:') && styleLine.split(' · ').length === 7 && !styleLine.includes('gap'), styleLine)
check('元素：没有组件信息就不写那行', !out.includes('组件：'))

out = formatPick({ ...el, text: '一'.repeat(40), source: { component: 'OrderButton', file: 'src/Hero.tsx:42', framework: 'React' } }, proxySt)
check('元素：长文字截到 24 个字', out.split('\n')[0].includes('「' + '一'.repeat(24) + '…」'))
check('元素：有组件就带上组件和源码位置', out.includes('组件：OrderButton（src/Hero.tsx:42） · React'))
check('元素：开发服务器写页面地址', out.includes('页面：http://localhost:5173/index.html'))

out = formatPick({
  kind: 'region',
  rect: { x: 0, y: 600, w: 1024, h: 420 },
  href: 'http://127.0.0.1:9/index.html',
  elements: [
    { selector: 'section.cards > div.card:nth-of-type(1)', text: '手冲单品' },
    { selector: 'section.cards > div.card:nth-of-type(2)', text: '', source: { component: 'Card', file: 'src/Card.vue' } },
  ],
}, fileSt)
check('区域：标记 + 位置大小', out.startsWith('〔选中区域〕页面上 (0, 600) 起 1024×420 的一块\n文件：'))
check('区域：列出包含的元素', out.includes('包含：\n- section.cards > div.card:nth-of-type(1)「手冲单品」\n- section.cards > div.card:nth-of-type(2)　[Card src/Card.vue]'), out)
check('结尾留一个换行（光标落在下一行，接着打字）', out.endsWith('\n') && !out.endsWith('\n\n'))

// ── 类型、画布排版 ──
const { parseMeta, sizeOf, layoutGrid, fitCam } = mod._test
check('页面 meta：类型 + 尺寸', JSON.stringify(parseMeta('poster 1080x1920')) === JSON.stringify({ kind: 'poster', size: '1080x1920', os: '' }))
check('页面 meta：别名、乱写', parseMeta('mobile').kind === 'app' && parseMeta('hello').kind === '' && parseMeta('').size === '')
check('尺寸：没给就按类型默认', sizeOf('', 'app').join('x') === '390x844' && sizeOf('1080x1920', 'poster').join('x') === '1080x1920' && sizeOf('9x9', 'web').join('x') === '1280x800')
let L = layoutGrid(4, 412, 866, 880, 570)
check('四屏手机在宽舞台上排成一行', L.cols === 4 && L.rows === 1, JSON.stringify({ cols: L.cols, z: L.z }))
L = layoutGrid(4, 1280, 834, 450, 570)
check('四屏网页在窄舞台上排成两行两列', L.cols === 2 && L.rows === 2, JSON.stringify({ cols: L.cols, z: L.z }))
const rowGap = (L.pos[2].y - 834) * L.z
check('两行之间留够标题的位置（不压到上一行）', rowGap >= 34, String(rowGap))
{
  const a = layoutGrid(6, 390, 844, 575, 740)
  const b = layoutGrid(6, 390, 844, 800, 740)
  const c = layoutGrid(6, 390, 844, 1100, 740)
  check('六屏手机：右侧栏拉宽，一行多排（3 → 4 → 6），屏不变小', a.cols === 3 && b.cols === 4 && c.cols === 6 && b.z >= a.z - 1e-9 && c.z >= b.z - 1e-9, [a, b, c].map((x) => `${x.cols}@${x.z.toFixed(3)}`).join(' '))
  check('多排时不让最后一行只剩一屏（四屏是 2+2，不是 3+1）', layoutGrid(4, 390, 844, 650, 740).cols === 2 && layoutGrid(5, 390, 844, 900, 740).cols === 3)
}
const cam = fitCam(L, 450, 570)
check('摆好后整块在舞台里', cam.x >= 0 && cam.y >= 0 && cam.x + L.bw * cam.z <= 450 + 0.5 && cam.y + L.bh * cam.z <= 570 + 0.5, JSON.stringify(cam))

// ── 设计变量 ──
const { tokenKind, formatToken } = mod._test
const kindOf = (name, value) => tokenKind({ name, value })
check('变量分组：颜色', kindOf('--primary', 'oklch(0.62 0.17 45)') === 'color' && kindOf('--bg', '#fff') === 'color' && kindOf('--line', 'rgb(0 0 0 / .1)') === 'color')
check('变量分组：字体', kindOf('--font-sans', '"PingFang SC", system-ui') === 'font' && kindOf('--font-weight', '600') !== 'font')
check('变量分组：字号 vs 间距', kindOf('--text-lg', '20px') === 'size' && kindOf('--space-4', '16px') === 'space' && kindOf('--gap', '1rem') === 'space')
check('变量分组：圆角、阴影、其他', kindOf('--radius-md', '12px') === 'radius' && kindOf('--shadow-1', '0 1px 2px rgba(0,0,0,.1)') === 'shadow' && kindOf('--ease', 'cubic-bezier(.2,.8,.2,1)') === 'other')
out = formatToken({ name: '--primary', value: '#c2410c', href: 'http://127.0.0.1:9/tokens.css' }, fileSt)
check('点变量 → 输入框文字带名字、值、文件', out === '〔设计变量〕--primary: #c2410c\n文件：/Users/me/我的 站/tokens.css\n', out)

// ── 导出、版本 ──
const { splitTitles, pickColors, hhmm } = mod._test
let sp = splitTitles(['登录 · 八克咖啡', '首页 · 八克咖啡', '商品详情 · 八克咖啡'])
check('合成大图：几屏标题的共同品牌拿出来当大标题', sp.brand === '八克咖啡' && sp.labels.join(',') === '登录,首页,商品详情', JSON.stringify(sp))
sp = splitTitles(['八克 | 登录', '八克 | 首页'])
check('合成大图：品牌在前面也认', sp.brand === '八克' && sp.labels.join(',') === '登录,首页')
sp = splitTitles(['登录', '首页'])
check('合成大图：没有共同部分 → 原样', sp.brand === '' && sp.labels.join(',') === '登录,首页')
const pc = pickColors([
  { name: '--color-primary-ink', value: '#fff' },
  { name: '--color-primary', value: '#1f4d3a' },
  { name: '--color-text', value: '#222' },
  { name: '--color-bg', value: '#f7f2ea' },
  { name: '--space-4', value: '16px' },
])
check('合成大图：从设计变量取背景和主色（不拿 primary-ink 这类）', pc.bg === '#f7f2ea' && pc.accent === '#1f4d3a', JSON.stringify(pc))
check('合成大图：没有变量 → 空（用默认）', pickColors([]).bg === '' && pickColors(null).accent === '')
const today = new Date()
today.setHours(9, 5, 0, 0)
check('版本时间：今天只写时分', hhmm(today.getTime()) === '09:05')
check('版本时间：以前的带月日', /^\d+\/\d+ \d\d:\d\d$/.test(hhmm(Date.now() - 3 * 86400000)))

// ── 原型：跳转连线 ──
const { keyOfPath, flowsOf, flowLines, flowMarks } = mod._test
check('跳转路径 → 屏：本地文件', keyOfPath('/detail.html', true) === 'detail.html' && keyOfPath('/', true) === 'index.html' && keyOfPath('/shop/', true) === 'shop/index.html')
check('跳转路径 → 屏：旧版本的前缀去掉', keyOfPath('/__dsh_design__/v/3/login.html', true) === 'login.html')
check('跳转路径 → 屏：开发服务器是路由', keyOfPath('/cart', false) === '/cart')
const scr = [{ key: 'home.html' }, { key: 'detail.html' }, { key: 'cart.html' }]
const lk = {
  'home.html': [{ path: '/detail.html', x: 20, y: 300, w: 160, h: 200 }, { path: '/detail.html', x: 200, y: 300, w: 160, h: 200 }, { path: '/nope.html', x: 0, y: 0, w: 10, h: 10 }, { path: '/home.html', x: 0, y: 0, w: 9, h: 9 }],
  'detail.html': [{ path: '/home.html', x: 10, y: 50, w: 40, h: 40 }, { path: '/cart.html', x: 200, y: 780, w: 170, h: 48 }],
}
const fl = flowsOf(scr, (sc) => lk[sc.key], true)
check('连线：同一对只留一条（按钮都记着）、跳到不存在的屏 / 自己的不画', fl.length === 3 && fl.map((x) => x.from + '>' + x.to).join(',') === 'home.html>detail.html,detail.html>home.html,detail.html>cart.html' && fl[0].hots.length === 2, JSON.stringify(fl))
const pos = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 1200, y: 0 }]
const K3 = scr.map((x) => x.key)
const ln = flowLines(fl, K3, pos, 'app', [390, 844])
const fwd = ln.find((x) => x.from === 'home.html')
check('连线：挨着的一条直线，从离得近的那个按钮右边出发、落到目标屏左边', fwd.pts.length === 2 && fwd.sx === 11 + 360 && fwd.ex === 600 && fwd.ux === 1 && fwd.sy === 11 + 400 && fwd.ey === fwd.sy && fwd.hot.x === 11 + 200 && !/Q/.test(fwd.d), JSON.stringify(fwd))
const bk = ln.find((x) => x.to === 'home.html')
check('连线：往回的落到目标屏右边、箭头朝左', bk.ex === 412 && bk.ux === -1, JSON.stringify(bk))
const low = flowLines([{ from: 'home.html', to: 'detail.html', hots: [{ x: 0, y: 5000, w: 10, h: 10 }] }], ['home.html', 'detail.html'], pos, 'app', [390, 844])[0]
check('连线：按钮在屏幕外面（往下滚才看得到）→ 从屏幕底边出发、画虚线', low.off && !low.hot && low.sy === 11 + 844, JSON.stringify(low))
check('连线：位置缺了的屏不画', flowLines(fl, K3, [pos[0]], 'app', [390, 844]).length === 0)

// 拐点连成的线有没有穿过别的屏（含标题那一条）；出发那屏和目标屏不算
const sample = (pts) => pts.slice(1).flatMap((p, i) => Array.from({ length: 20 }, (_, k) => [pts[i][0] + (p[0] - pts[i][0]) * (k + 1) / 20, pts[i][1] + (p[1] - pts[i][1]) * (k + 1) / 20]))
const through = (pts, ps, skip, lift = 34) => ps.some((p, i) => !skip.includes(i) && sample(pts).some(([x, y]) => x > p.x && x < p.x + 412 && y > p.y - lift && y < p.y + 866))
const hv = (pts) => pts.slice(1).every((p, i) => Math.abs(p[0] - pts[i][0]) < 0.01 || Math.abs(p[1] - pts[i][1]) < 0.01)
const far = flowLines([{ from: 'cart.html', to: 'home.html', x: 10, y: 50, w: 40, h: 40 }, { from: 'home.html', to: 'cart.html', x: 300, y: 300, w: 60, h: 40 }], K3, pos, 'app', [390, 844], { lift: 34 })
check('连线：隔着一屏的走缝、横平竖直带圆角，不穿过中间那屏', far.length === 2 && far.every((x) => hv(x.pts) && !through(x.pts, pos, [0, 2]) && /Q/.test(x.d)), far.map((x) => JSON.stringify(x.pts)).join(' | '))
const g3 = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 3) * 520, y: Math.floor(i / 3) * 1000 }))
const k6 = ['a', 'b', 'c', 'd', 'e', 'f']
const skip6 = (x) => k6.map((k, i) => (k === x.from || k === x.to ? i : -1)).filter((i) => i >= 0)
const dn = [['b', 'c'], ['a', 'c'], ['c', 'b'], ['d', 'a'], ['f', 'a'], ['a', 'f'], ['e', 'b'], ['c', 'a'], ['c', 'd'], ['a', 'e']]
  .flatMap(([from, to], i) => flowLines([{ from, to, x: 10 + (i % 3) * 120, y: 200 + i * 50, w: 40, h: 40 }], k6, g3, 'app', [390, 844], { lift: 34, z: 0.4 }))
check('连线：换排 / 上下同一列 / 隔屏的都不穿过别的屏', dn.length === 10 && dn.every((x) => hv(x.pts) && !through(x.pts, g3, skip6(x))), dn.filter((x) => through(x.pts, g3, skip6(x))).map((x) => x.from + '>' + x.to + JSON.stringify(x.pts)).join(' | '))

// 选中一屏、它通往好几屏：各走各的道（不叠在一起）、互不交叉
const segsOf = (pts) => pts.slice(1).map((p, i) => [pts[i], p])
const crossN = (A, B) => {
  let n = 0
  for (const [a, b] of segsOf(A)) for (const [c, d] of segsOf(B)) {
    const av = Math.abs(a[0] - b[0]) < 0.01
    if (av === (Math.abs(c[0] - d[0]) < 0.01)) continue
    const [v0, v1, h0, h1] = av ? [a, b, c, d] : [c, d, a, b]
    if (h0[1] > Math.min(v0[1], v1[1]) + 0.01 && h0[1] < Math.max(v0[1], v1[1]) - 0.01 && v0[0] > Math.min(h0[0], h1[0]) + 0.01 && v0[0] < Math.max(h0[0], h1[0]) - 0.01) n++
  }
  return n
}
const lapN = (A, B) => {
  let n = 0
  for (const [a, b] of segsOf(A)) for (const [c, d] of segsOf(B)) {
    const v = Math.abs(a[0] - b[0]) < 0.01
    if (v !== (Math.abs(c[0] - d[0]) < 0.01)) continue
    const j = v ? 1 : 0
    if (Math.abs(a[1 - j] - c[1 - j]) > 0.01) continue
    n += Math.max(0, Math.min(Math.max(a[j], b[j]), Math.max(c[j], d[j])) - Math.max(Math.min(a[j], b[j]), Math.min(c[j], d[j])))
  }
  return n
}
const many = flowLines(['a', 'b', 'd', 'e', 'f'].map((to, i) => ({ from: 'c', to, x: 20, y: 120 + i * 110, w: 350, h: 60 })), k6, g3, 'app', [390, 844], { lift: 34, z: 0.35 })
let tangle = 0
for (let i = 0; i < many.length; i++) for (let j = i + 1; j < many.length; j++) tangle += crossN(many[i].pts, many[j].pts) + (lapN(many[i].pts, many[j].pts) > 1 ? 1 : 0)
const mix = flowLines([{ from: 'c', to: 'a', hots: [{ x: 284, y: 312, w: 47, h: 40 }] }, { from: 'c', to: 'b', hots: [{ x: 266, y: 70, w: 48, h: 40 }] }, { from: 'c', to: 'e', hots: [{ x: 21, y: 278, w: 53, h: 40 }] }], k6, g3, 'app', [390, 844], { lift: 34, z: 0.35 })
let mixN = 0
for (let i = 0; i < mix.length; i++) for (let j = i + 1; j < mix.length; j++) mixN += crossN(mix[i].pts, mix[j].pts)
check('连线：同走一道缝的几条排好里外，不交叉', mix.length === 3 && mixN === 0, mix.map((x) => x.to + JSON.stringify(x.pts)).join(' | '))
check('连线：一屏通往五屏，各走各的道、互不交叉、不穿过别的屏', many.length === 5 && tangle === 0 && many.every((x) => !through(x.pts, g3, skip6(x))), many.map((x) => x.to + JSON.stringify(x.pts)).join(' | '))

// 底栏 / 返回：好几屏同一个位置都跳同一屏 → 只描框不画线
const nav = (k) => [{ path: '/a.html', x: 10, y: 790, w: 74, h: 45 }, { path: '/c.html', x: 84, y: 790, w: 74, h: 45 }, { path: '/d.html', x: 158, y: 790, w: 74, h: 45 }, ...(k === 'a.html' ? [{ path: '/b.html', x: 120, y: 700, w: 150, h: 60 }] : [])]
const sc4 = ['a.html', 'b.html', 'c.html', 'd.html'].map((key) => ({ key }))
const nf = flowsOf(sc4, (sc) => nav(sc.key), true)
const fa = nf.filter((x) => x.from === 'a.html')
check('连线：每屏同一处都有的（底栏）认成导航', fa.find((x) => x.to === 'c.html').hots[0].nav === true && fa.find((x) => x.to === 'b.html').hots[0].nav === false && nf.filter((x) => x.from === 'b.html' && x.to === 'a.html')[0].hots[0].nav, JSON.stringify(nf))
const p4 = [0, 1, 2, 3].map((i) => ({ x: Math.floor(i / 2) * 520, y: (i % 2) * 1000 }))
const nl = flowLines(fa, sc4.map((x) => x.key), p4, 'app', [390, 844], { lift: 34, z: 0.4 })
const drawn = nl.filter((x) => !x.nav)
check('连线：导航只描框、真跳转才画线', nl.some((x) => x.nav && x.to === 'c.html' && x.hot && !x.d) && drawn.length === 1 && drawn[0].to === 'b.html', JSON.stringify(nl.map((x) => [x.to, !!x.nav])))
const navR = nl.filter((x) => x.nav).map((x) => x.hot)
const inS = drawn[0].pts.slice(0, 2)
check('连线：从按钮出来那一小段不压到底栏', !navR.some((r) => Math.min(inS[0][0], inS[1][0]) < r.x + r.w && Math.max(inS[0][0], inS[1][0]) > r.x && Math.min(inS[0][1], inS[1][1]) < r.y + r.h && Math.max(inS[0][1], inS[1][1]) > r.y), JSON.stringify(drawn[0].pts))
check('连线：导航按钮滚出去看不见 → 什么都不画', flowLines(nf.filter((x) => x.from === 'b.html'), sc4.map((x) => x.key), p4, 'app', [390, 300], { lift: 34 }).length === 0)

// 画出来：粗细跟着缩放走（屏幕上看着一样粗）
const mk = flowMarks(drawn.concat(nl.filter((x) => x.nav)), 0.5)
const tags = mk.map(([t, a]) => t + '.' + a.className)
check('连线：画出按钮框、衬底、线、箭头、起点圆点；导航是虚线框', ['rect.hot', 'path.halo', 'path.ln', 'path.hd', 'circle.dot', 'rect.hot nav'].every((t) => tags.includes(t)) && mk.find(([t]) => t === 'path')[1].strokeWidth === 11 && mk.find(([, a]) => a.className === 'ln')[1].strokeWidth === 3.5 && mk.find(([, a]) => a.className === 'hot nav')[1].strokeDasharray, tags.join(','))
check('连线：看不见的按钮那条是虚线', flowMarks([low], 1).find(([, a]) => a.className === 'ln off')[1].strokeDasharray)

// ── 多尺寸并排 ──
check('小程序：meta 认 miniprogram / 小程序，默认 375×812；外框是手机 + 胶囊，矮屏没灵动岛但胶囊还在', mod._test.parseMeta('miniprogram').kind === 'miniprogram' && mod._test.parseMeta('小程序').kind === 'miniprogram' && mod._test.sizeOf('', 'miniprogram').join('x') === '375x812' && mod._test.frameOf('miniprogram', 375, 812).island > 0 && mod._test.frameOf('miniprogram', 375, 812).capsule && mod._test.frameOf('miniprogram', 375, 667).island === 0 && mod._test.frameOf('miniprogram', 375, 667).capsule)
check('桌面软件：meta 认 desktop / 桌面软件 / windows，windows 记成 win、默认 Mac；1280×800，外框是带窗口按钮的窗口', mod._test.parseMeta('desktop').kind === 'desktop' && mod._test.parseMeta('desktop').os === '' && mod._test.parseMeta('desktop windows 1440x900').os === 'win' && mod._test.parseMeta('desktop windows 1440x900').size === '1440x900' && mod._test.parseMeta('windows').kind === 'desktop' && mod._test.parseMeta('桌面软件').kind === 'desktop' && mod._test.parseMeta('app').os === '' && mod._test.sizeOf('', 'desktop').join('x') === '1280x800' && mod._test.frameOf('desktop', 1280, 800).win && !mod._test.frameOf('desktop', 1280, 800).island && mod._test.frameOf('desktop', 1280, 800).pad === 0)
check('外框：标准手机有灵动岛，SE 那种矮屏没有', mod._test.frameOf('app', 393, 852).island > 0 && mod._test.frameOf('app', 375, 667).island === 0 && mod._test.frameOf('tablet', 744, 1133).pad === 14)
const { layoutRow } = mod._test
const row = layoutRow([[390, 844], [848, 1208], [1440, 934]], 700, 600)
check('多尺寸：一行排开、顶端对齐、互不重叠', row.pos.length === 3 && row.pos.every((p) => p.y === 0) && row.pos[1].x > 390 && row.pos[2].x > row.pos[1].x + 848, JSON.stringify(row.pos))
check('多尺寸：整块宽 = 最右一块的右边、高 = 最高的一块', row.bw === row.pos[2].x + 1440 && row.bh === 1208)
check('多尺寸：缩放放得进舞台', row.z > 0 && row.bw * row.z <= 700 && row.bh * row.z <= 600)

// ── 参考图取色 ──
const { paletteOf, formatRef } = mod._test
const px = (list) => {
  const out = []
  for (const [hex, n] of list) {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    for (let i = 0; i < n; i++) out.push(v[0], v[1], v[2], 255)
  }
  return new Uint8ClampedArray(out)
}
let pal = paletteOf(px([['#F4EDE4', 700], ['#F1E9DF', 60], ['#2B1D16', 160], ['#C9B8A6', 70], ['#E8572A', 10]]))
check('取色：占比最大的是底色，相近的并在一起', /^#F[34]E[89A-D]E[34]$/.test(pal.colors[0].hex) && Math.abs(pal.colors[0].share - 0.76) < 0.03 && pal.colors.length === 4, JSON.stringify(pal))
check('取色：少见但鲜艳的点缀色补上', pal.colors.some((c) => c.accent && c.hex === '#E8572A'), JSON.stringify(pal))
check('取色：整体偏浅', pal.light === true)
check('取色：深色图', paletteOf(px([['#101014', 900], ['#F5F5F5', 100]])).light === false)
check('取色：透明的不算、空图不炸', paletteOf(new Uint8ClampedArray([255, 0, 0, 0])).colors.length === 0)
const tz = (k, v = {}) => ({ refText: '〔参考图〕{path}（{w}×{h}，{tone}）\n主要颜色：{colors}\n{ask}\n', refLight: '整体偏浅', refDark: '整体偏深', refAccent: '（点缀）', refJoin: '、', refAsk: '改现在的', refAskNew: '新做' }[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x])
const txt = formatRef(tz, { path: '/d/refs/a.png', w: 1280, h: 800, palette: { light: true, colors: [{ hex: '#F4EDE4', share: 0.7 }, { hex: '#E8572A', share: 0.004, accent: true }] }, hasDesign: true })
check('参考图文字：路径、尺寸、颜色、怎么用', txt === '〔参考图〕/d/refs/a.png（1280×800，整体偏浅）\n主要颜色：#F4EDE4 70%、#E8572A 1%（点缀）\n改现在的\n', JSON.stringify(txt))

// ── check_design：体检结果交回给模型的那段字 ──
const { formatCheckTool } = mod._test
const tk = (k, v = {}) => ({ ckToolHead: '量了 {s} 屏，发现 {n} 个问题：', ckToolOk: '量了 {s} 屏（{labels}），没发现问题。', ckToolErr: '{label}：没量成（{msg}）', ckScreen: '{label}（{where}）', ckItem: '{i}. {type}：{where}{text} — {detail}', ckQuote: '「{text}」', ck_tap: '点击区太小', cd_tap: '{w}×{h}' }[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '')
const ckSt = { target: { kind: 'file', file: '/d/home.html', root: '/d' } }
const ok = formatCheckTool(tk, [{ label: 'home', url: 'http://127.0.0.1:9/home.html', issues: [] }, { label: 'menu', url: 'http://127.0.0.1:9/menu.html', issues: [] }], ckSt)
check('check_design：没问题就一句话，带量了哪几屏', ok === '量了 2 屏（home / menu），没发现问题。', ok)
const bad = formatCheckTool(tk, [
  { label: 'home', url: 'http://127.0.0.1:9/home.html', issues: [{ type: 'tap', sel: 'button.go', text: '搜', w: 26, h: 26 }] },
  { label: 'cart', url: 'http://127.0.0.1:9/cart.html', issues: [], error: '页面没加载出来' },
], ckSt)
check('check_design：有问题按屏列出文件、选择器、数字', bad.startsWith('量了 2 屏，发现 1 个问题：') && bad.includes('home（文件：/d/home.html）') && bad.includes('1. 点击区太小：button.go「搜」 — 26×26'), bad)
check('check_design：没量成的屏也说一声', bad.includes('cart：没量成（页面没加载出来）'), bad)

// ── 同一屏的几个版本：画布上「就要这个」 ──
const { takesOf } = mod._test
const dirs = ['home-a.html', 'home-b.html', 'home-c.html', 'menu.html']
check('三个方向：选 B，其他两个是同组', JSON.stringify(takesOf(dirs, 'home-b.html')) === JSON.stringify({ stem: 'home', letter: 'b', others: ['home-a.html', 'home-c.html'] }), JSON.stringify(takesOf(dirs, 'home-b.html')))
check('不是版本的屏没有这个按钮', takesOf(dirs, 'menu.html') === null && takesOf(['menu-a.html', 'home.html'], 'menu-a.html') === null)
const takes = ['login.html', 'login-b.html', 'login-c.html']
check('「再出两版」：选新版，原版也挪走', JSON.stringify(takesOf(takes, 'login-c.html').others) === JSON.stringify(['login.html', 'login-b.html']) && takesOf(takes, 'login-c.html').stem === 'login')
check('「再出两版」：留原版', takesOf(takes, 'login.html').letter === '' && takesOf(takes, 'login.html').others.length === 2)
check('开发服务器的路由不算', takesOf(['/a', '/a-b'], '/a-b') === null)

// ── 调样式：面板上的数、交给模型的那段字 ──
const { pxOf, styleChanges, formatStyleAsk } = mod._test
const toks = [{ name: '--r-md', value: '12px' }, { name: '--fs-lg', value: '1.25rem' }]
check('调样式：px / rem / 设计变量都换成像素', pxOf('17px') === 17 && pxOf('var(--fs-lg)', toks) === 20 && pxOf(' var( --r-md ) ', toks) === 12 && pxOf('auto') === null && pxOf('var(--nope)', toks) === null)
const ts = (k, v = {}) => ({ styleArrow: '{prop} {from} → {to}', styleFont: '字号', stylePadY: '上下内边距', styleRadius: '圆角', styleJoin: '；',
  styleAskText: '〔调样式〕{name}（{sel}）：{list}。改进样式表。\n{where}\n' }[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '')
const sty = { name: 'button.go', selector: 'main > button.go', url: 'http://127.0.0.1:9/home.html', base: { 'font-size': '15px', 'padding-top': '10px', 'padding-bottom': '10px', 'border-radius': '8px' },
  live: { 'font-size': '17px', 'padding-top': '14px', 'padding-bottom': '14px', 'border-radius': 'var(--r-md)' } }
check('调样式：改了的几项，上下内边距只说一次', JSON.stringify(styleChanges(ts, sty)) === JSON.stringify(['字号 15px → 17px', '上下内边距 10px → 14px', '圆角 8px → var(--r-md)']), JSON.stringify(styleChanges(ts, sty)))
const tsBg = (k, v) => ts(k === 'styleBg' ? '背景' : k === 'styleClear' ? '透明' : k, v)
check('调样式：没设背景（透明）说透明，不说成 #000000', JSON.stringify(styleChanges(tsBg, { base: { background: 'rgba(0, 0, 0, 0)' }, live: { background: 'var(--brand)' } })) === JSON.stringify(['背景 透明 → var(--brand)']),
  JSON.stringify(styleChanges(tsBg, { base: { background: 'rgba(0, 0, 0, 0)' }, live: { background: 'var(--brand)' } })))
{
  const { pageOf } = mod._test
  const sc = { key: 'a.html', url: 'http://127.0.0.1:9/a.html' }
  check('调样式 / 改字：预览里跳到 b.html 再改 → 写 b.html（不写原来那屏）', JSON.stringify(pageOf(sc, 'http://127.0.0.1:9/b.html#top')) === JSON.stringify({ key: 'b.html', url: 'http://127.0.0.1:9/b.html' }))
  check('调样式 / 改字：别的源、旧版本、不是 .html、没带地址 → 还是这一屏', ['http://evil.test/b.html', 'http://127.0.0.1:9/__dsh_design__/v/3/b.html', 'http://127.0.0.1:9/data.json', undefined].every((h) => pageOf(sc, h).key === 'a.html'))
  check('调样式 / 改字：中文文件名解码', pageOf(sc, 'http://127.0.0.1:9/%E8%AF%A6%E6%83%85.html').key === '详情.html')
}
const ask = formatStyleAsk(ts, sty, { target: { kind: 'file', file: '/d/home.html', root: '/d' } })
check('调样式：交给模型的字带元素、选择器、改动和文件', ask.startsWith('〔调样式〕button.go（main > button.go）：字号 15px → 17px；上下内边距 10px → 14px；圆角 8px → var(--r-md)。') && ask.includes('/d/home.html'), ask)
{
  const own = { ruleFrom: '- {props}：现在由 {sel} 决定（{at}）', ruleInline: '- {props}：现在写在元素的行内 style 上{over}', ruleOver: '，盖过了 {sel}（{at}）', ruleAt: '{file} 第 {line} 行',
    styleAskText: '〔调样式〕{name}（{sel}）：{list}。{rules}改进样式表。\n{where}\n' }
  const tr = (k, v = {}) => (k in own ? own[k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '') : ts(k, v))
  const H = 'http://127.0.0.1:9/'
  const withRules = { ...sty, rules: {
    'font-size': { sel: '.btn', href: H + 'app.css', n: 0 }, 'padding-top': { sel: '.btn', href: H + 'app.css', n: 0 }, 'padding-bottom': { sel: '.btn', href: H + 'app.css', n: 0 },
    'border-radius': { inline: true, sel: 'main .go', href: H + 'home.html', n: 1 }, color: { sel: '.x', href: H + 'x.css', n: 0 },
  } }
  const located = new Map([[`${H}app.css|.btn|0`, { file: 'css/app.css', line: 42 }], [`${H}home.html|main .go|1`, null]])
  const a2 = formatStyleAsk(tr, withRules, { target: { kind: 'file', file: '/d/home.html', root: '/d' } }, located)
  check('调样式：同一条规则决定的几项合成一行，带文件和行号', a2.includes('\n- 字号、上下内边距：现在由 .btn 决定（css/app.css 第 42 行）'), a2)
  check('调样式：行内 style 盖过规则的说清楚；没找到行号只写文件名', a2.includes('- 圆角：现在写在元素的行内 style 上，盖过了 main .go（home.html）'), a2)
  check('调样式：没改的项（颜色）不列', !a2.includes('.x'), a2)
  check('调样式：没有规则信息时和以前一样', formatStyleAsk(tr, sty, {}).includes('var(--r-md)。改进样式表'), formatStyleAsk(tr, sty, {}))
}

// ── 风格卡：配色都过对比度，交给模型的字带全套 ──
const { STYLES, formatStyle, accentUse } = mod._test
const lum = (hex) => { const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const lowC = STYLES.flatMap((x) => [['text', x.c.text, x.c.bg], ['muted', x.c.muted, x.c.bg], ['muted', x.c.muted, x.c.surface], ['on', x.c.on, x.c.primary], ['link', x.c.link, x.c.bg], ['link', x.c.link, x.c.surface]]
  .filter(([, a, b]) => ratio(a, b) < 4.5).map(([k, a, b]) => `${x.id}.${k} ${ratio(a, b).toFixed(2)}`))
check('风格卡：二十种、不重名，正文 / 次要文字 / 主色按钮上的字 / 链接色都 ≥ 4.5:1', STYLES.length === 20 && new Set(STYLES.map((x) => x.id)).size === 20 && !lowC.length, lowC.join(', '))
// 点缀色怎么用由对比度定：说能写大字的 ≥ 3:1；只做色块的，色块上的正文色 ≥ 4.5:1
const accBad = STYLES.flatMap((x) => {
  const u = accentUse(x.c)
  if (u === 'accBig') return Math.min(ratio(x.c.accent, x.c.bg), ratio(x.c.accent, x.c.surface)) >= 3 ? [] : [`${x.id} 大字`]
  if (u === 'accBlock') return ratio(x.c.text, x.c.accent) >= 4.5 ? [] : [`${x.id} 色块上的字`]
  return u === 'accShape' ? [] : [`${x.id} ${u}`]
})
const uses = Object.fromEntries(['guochao', 'cute', 'retro', 'sale', 'fresh', 'soft', 'dark'].map((id) => [id, accentUse(STYLES.find((x) => x.id === id).c)]))
check('风格卡：点缀色按对比度说用法——国潮、可爱、复古、促销、清新只做色块，柔和立体只做图形，深色能写大字', !accBad.length && JSON.stringify(uses) === JSON.stringify({ guochao: 'accBlock', cute: 'accBlock', retro: 'accBlock', sale: 'accBlock', fresh: 'accBlock', soft: 'accShape', dark: 'accBig' }), accBad.join(', ') + ' ' + JSON.stringify(uses))
const tz3 = (k, v = {}) => ({ lang: 'zh', styleText: '{colors}', styleColors: '点缀 {accent}（{accUse}）', accBig: '图形、大字', accBlock: '只做色块；色块上的字用 {text}', accShape: '只做图形' }[k] ?? '').replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '')
check('风格卡：交给模型的字里，可爱的点缀色写明只做色块、上面的字用正文色', formatStyle(tz3, STYLES.find((x) => x.id === 'cute'), false) === '点缀 #FFC93C（只做色块；色块上的字用 #3A2540）' && formatStyle(tz3, STYLES.find((x) => x.id === 'dark'), false).endsWith('（图形、大字）'), formatStyle(tz3, STYLES.find((x) => x.id === 'cute'), false))
const tz2 = (k, v = {}) => ({ lang: 'zh', styleText: '〔风格〕{name}——{desc}\n配色：{colors}\n字体：{fonts}\n形状：{shape}\n要点：{notes}\n{ask}', styleColors: '底色 {bg}，主色 {primary}{bgImage}', styleBgImage: '；叠 {v}',
  styleFonts: '标题 {head}；正文 {body}', styleShape: '圆角 {r}px；阴影 {s}', styleStart: '照这个风格来做：', styleRestyle: '把现在的设计换成这个风格。\n' }[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '')
const warm = formatStyle(tz2, STYLES.find((x) => x.id === 'warm'), false)
check('风格卡：开局的字带名字、配色、字体、圆角、要点，最后让模型照着做', warm.startsWith('〔风格〕温暖手作——纸感底色') && warm.includes('底色 #F6EFE6，主色 #A9542A') && warm.includes('Songti SC') && warm.includes('圆角 16px') && warm.endsWith('照这个风格来做：'), warm)
check('风格卡：换风格的字 + 玻璃的底色光斑', formatStyle(tz2, STYLES.find((x) => x.id === 'glass'), true).includes('；叠 radial-gradient') && formatStyle(tz2, STYLES[0], true).endsWith('把现在的设计换成这个风格。\n'))
// 样板上的小标签照点缀色的用法上色：能写字就写点缀色，色块就配正文色，只做图形的换主色
const { styleLook } = mod._test
const chipBad = STYLES.flatMap((x) => {
  const k = styleLook(x).chip
  const fg = k.color
  const bg = k.background || x.c.surface
  // 描边的小标签写在卡片上（杂志风格的卡片是透明的，写在底色上），两种都量
  const r = k.background ? ratio(fg, bg) : Math.min(ratio(fg, x.c.surface), ratio(fg, x.c.bg))
  return r >= 4.5 ? [] : [`${x.id} ${r.toFixed(2)}`]
})
check('风格卡样板：小标签是小字，都 ≥ 4.5:1', !chipBad.length, chipBad.join(', '))
check('风格卡样板：招牌细节——粗野主义 3px 黑框、运动标题斜体、没写的用风格自己的阴影', styleLook(STYLES.find((x) => x.id === 'brutal')).card.border === '3px solid #000000' && styleLook(STYLES.find((x) => x.id === 'sport')).head.fontStyle === 'italic' && styleLook(STYLES.find((x) => x.id === 'warm')).card.boxShadow === STYLES.find((x) => x.id === 'warm').shadow)

// ── 插进输入框：前后怎么接，光标落在哪 ──
const { padInsert } = mod._test
const pk = '〔选中元素〕h1\n样式：…\n'
const pi = (...a) => JSON.stringify(padInsert(...a))
check('插入：空输入框，点选的字末尾留空行、光标退回空行上', pi(pk, '', '', 0, true) === JSON.stringify({ text: pk + '\n', back: 1 }), pi(pk, '', '', 0, true))
check('插入：前面有字不在行首 → 先换行', padInsert(pk, '这里改一下', '', 5, true).text === '\n' + pk + '\n')
check('插入：上一次插的停在空行上 → 不再换行、也不再多留空行', pi(pk, 'a\n', '\n', 2, true) === JSON.stringify({ text: pk, back: 0 }), pi(pk, 'a\n', '\n', 2, true))
check('插入：读不到输入框 → 照旧先换行', padInsert(pk, null, null, 3, true).text === '\n' + pk + '\n')
check('插入：「照这个风格来做：」不加空行，光标跟在后面', pi('照这个风格来做：', '', '', 0, true) === JSON.stringify({ text: '照这个风格来做：', back: 0 }))
check('插入：直接发的字不加空行', pi('〔选定方向〕…\n', '', '', 0, false) === JSON.stringify({ text: '〔选定方向〕…\n', back: 0 }))

// ── 点选标签（DSH 0.2.1 起：输入框里一个短标签，悬停看详情，发出去是整段） ──
const { pickInfo, pickLabel, pickRule } = mod._test
const src0 = sources[0]
check('点选标签：注册成 @ 的来源，不出候选、不占菜单标题', sources.length === 1 && src0.name === 'dsh-design-studio' && src0.trigger === '@' && src0.showGroupTitle === false && (await src0.candidates()).length === 0)
check('点选标签：复制出来、发给模型都是整段，前后空一行', src0.codec.clipboardText('〔选中元素〕a') === '\n\n〔选中元素〕a\n\n' && (await src0.codec.serialize('〔选中元素〕a')) === '\n\n〔选中元素〕a\n\n')
check('点选标签：消息里的规则和标签都注册了', rules.length === 1 && rules[0].id === 'ddp-pick' && slots.some((s) => s.opts.name === 'conversation.user.text.node' && s.opts.key === 'ddp-pick'))
const PK = formatPick(el, fileSt).trim()
const inf = pickInfo(PK)
check('点选标签：读出元素名、字、大小、文件', inf.kind === 'el' && inf.name === el.name && inf.text && pickLabel(inf, (k) => k) === inf.text && /^\d+×\d+$/.test(inf.size) && inf.file === 'index.html', JSON.stringify(inf))
const AREA = '〔选中区域〕页面上 (0, 0) 起 300×200 的一块\n文件：/a/b.html\n包含：\n- a.go「去点单」\n- h1'
const ai = pickInfo(AREA)
check('点选标签：区域写几个元素', ai.kind === 'area' && ai.n === 2 && ai.size === '300×200' && pickLabel(ai, (k, v) => k + (v ? v.n : '')) === 'pickAreaN2', JSON.stringify(ai))
const MSG = '改成绿色\n\n' + PK + '\n\n再大一点'
const nodes = []
for (let at = 0, n; (n = pickRule.match(MSG, at)); at = n.end) nodes.push(n)
const pkN = nodes.find((n) => n.id === 'ddp-pick')
check('点选标签：发出去的消息里整块认成一个标签，前后空行显示成空格', nodes.length === 3 && pkN && MSG.slice(pkN.start, pkN.end) === PK && nodes[0].data.display === ' ' && nodes[2].data.display === ' ' && nodes[0].end === pkN.start && nodes[2].start === pkN.end, JSON.stringify(nodes.map((n) => [n.id, n.start, n.end])))
check('点选标签：用户自己打的字不认', !pickRule.match('〔选中元素〕是什么意思？\n- 请解释格式', 0) && !pickRule.match('〔选中元素〕是什么意思？', 0) && !pickRule.match('〔选中元素〕是什么意思？\n位置：在工具栏里\n- 请解释格式', 0) && !pickRule.match('〔选中区域〕是啥\n文件：a.html', 0) && !pickRule.match('〔选中元素〕请解释这个格式\n位置：顶上\nHTML：一段代码\n样式：随便\n- 列表', 0) && !pickRule.match('随便说说', 0))
check('点选标签：页面地址带 ?参数 也读出文件名', pickInfo('〔选中元素〕a\n页面：http://localhost:3000/index.html?theme=dark#top\n位置：a').file === 'index.html')
const pill = slots.find((s) => s.opts.name === 'conversation.user.text.node').comp({ node: { data: { text: PK } } })
check('点选标签：消息里显示成标签（只有元素的字）', pill.props.className === 'ddp-pickpill' && text(pill) === inf.text, text(pill))

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
