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
check('页面 meta：类型 + 尺寸', JSON.stringify(parseMeta('poster 1080x1920')) === JSON.stringify({ kind: 'poster', size: '1080x1920' }))
check('页面 meta：别名、乱写', parseMeta('mobile').kind === 'app' && parseMeta('hello').kind === '' && parseMeta('').size === '')
check('尺寸：没给就按类型默认', sizeOf('', 'app').join('x') === '390x844' && sizeOf('1080x1920', 'poster').join('x') === '1080x1920' && sizeOf('9x9', 'web').join('x') === '1280x800')
let L = layoutGrid(4, 412, 866, 880, 570)
check('四屏手机在宽舞台上排成一行', L.cols === 4 && L.rows === 1, JSON.stringify({ cols: L.cols, z: L.z }))
L = layoutGrid(4, 1280, 834, 450, 570)
check('四屏网页在窄舞台上排成两行两列', L.cols === 2 && L.rows === 2, JSON.stringify({ cols: L.cols, z: L.z }))
const rowGap = (L.pos[2].y - 834) * L.z
check('两行之间留够标题的位置（不压到上一行）', rowGap >= 34, String(rowGap))
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
const { keyOfPath, flowsOf, flowLines } = mod._test
check('跳转路径 → 屏：本地文件', keyOfPath('/detail.html', true) === 'detail.html' && keyOfPath('/', true) === 'index.html' && keyOfPath('/shop/', true) === 'shop/index.html')
check('跳转路径 → 屏：旧版本的前缀去掉', keyOfPath('/__dsh_design__/v/3/login.html', true) === 'login.html')
check('跳转路径 → 屏：开发服务器是路由', keyOfPath('/cart', false) === '/cart')
const scr = [{ key: 'home.html' }, { key: 'detail.html' }, { key: 'cart.html' }]
const lk = {
  'home.html': [{ path: '/detail.html', x: 20, y: 300, w: 160, h: 200 }, { path: '/detail.html', x: 200, y: 300, w: 160, h: 200 }, { path: '/nope.html', x: 0, y: 0, w: 10, h: 10 }, { path: '/home.html', x: 0, y: 0, w: 9, h: 9 }],
  'detail.html': [{ path: '/home.html', x: 10, y: 50, w: 40, h: 40 }, { path: '/cart.html', x: 200, y: 780, w: 170, h: 48 }],
}
const fl = flowsOf(scr, (sc) => lk[sc.key], true)
check('连线：同一对只留一条、跳到不存在的屏 / 自己的不画', fl.length === 3 && fl.map((x) => x.from + '>' + x.to).join(',') === 'home.html>detail.html,detail.html>home.html,detail.html>cart.html', JSON.stringify(fl))
const pos = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 1200, y: 0 }]
const ln = flowLines(fl, scr.map((x) => x.key), pos, 'app', [390, 844])
const fwd = ln.find((x) => x.from === 'home.html')
check('连线：往右的从按钮右边出发、落到目标屏左边', fwd.sx === 11 + 180 && fwd.ex === 600 && fwd.tip === 1 && fwd.sy === 11 + 400, JSON.stringify(fwd))
const bk = ln.find((x) => x.to === 'home.html')
check('连线：往回的从按钮左边出发、落到目标屏右边', bk.sx === 600 + 11 + 10 && bk.ex === 412 && bk.tip === -1, JSON.stringify(bk))
const low = flowLines([{ from: 'home.html', to: 'detail.html', x: 0, y: 5000, w: 10, h: 10 }], ['home.html', 'detail.html'], pos, 'app', [390, 844])[0]
check('连线：按钮在屏幕外面（往下滚才看得到）→ 起点贴着屏幕底边', low.sy === 11 + 844)
check('连线：位置缺了的屏不画', flowLines(fl, scr.map((x) => x.key), [pos[0]], 'app', [390, 844]).length === 0)
// 把连线的 path 拆成一串点，看有没有穿过别的屏（含标题那一条）
function pathPts(d) {
  const pts = []
  let x = 0
  let y = 0
  for (const c of d.match(/[MHVQC][^MHVQC]*/g)) {
    const n = c.slice(1).trim().split(/[\s,]+/).map(Number)
    const seg = (fn) => { for (let k = 1; k <= 20; k++) pts.push(fn(k / 20)) }
    if (c[0] === 'M') { x = n[0]; y = n[1] } else if (c[0] === 'H') { const x0 = x; seg((t) => [x0 + (n[0] - x0) * t, y]); x = n[0] } else if (c[0] === 'V') { const y0 = y; seg((t) => [x, y0 + (n[0] - y0) * t]); y = n[0] } else if (c[0] === 'Q') { const [x0, y0] = [x, y]; seg((t) => [0, 1].map((j) => (1 - t) ** 2 * [x0, y0][j] + 2 * (1 - t) * t * n[j] + t * t * n[2 + j])); x = n[2]; y = n[3] } else { const [x0, y0] = [x, y]; seg((t) => [0, 1].map((j) => (1 - t) ** 3 * [x0, y0][j] + 3 * (1 - t) ** 2 * t * n[j] + 3 * (1 - t) * t * t * n[2 + j] + t ** 3 * n[4 + j])); x = n[4]; y = n[5] }
  }
  return pts
}
const through = (d, ps, skip, lift = 34) => ps.some((p, i) => !skip.includes(i) && pathPts(d).some(([x, y]) => x > p.x && x < p.x + 412 && y > p.y - lift && y < p.y + 866))
const far = flowLines([{ from: 'cart.html', to: 'home.html', x: 10, y: 50, w: 40, h: 40 }, { from: 'home.html', to: 'cart.html', x: 300, y: 300, w: 60, h: 40 }, { from: 'home.html', to: 'detail.html', x: 0, y: 300, w: 10, h: 10 }], scr.map((x) => x.key), pos, 'app', [390, 844], { lift: 34 })
check('连线：隔着一屏的绕到标题上面走，不穿过中间那屏', far.length === 3 && !through(far[0].d, pos, [0, 2]) && !through(far[1].d, pos, [0, 2])
  && far[0].ex === 412 && far[0].tip === -1 && far[1].ex === 1200 && far[1].tip === 1 && /Q/.test(far[0].d), far.map((x) => x.d).join(' | '))
check('连线：挨着的照旧是一条曲线', /C/.test(far[2].d) && !/Q/.test(far[2].d))
const g2 = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 0, y: 1000 }, { x: 600, y: 1000 }]
const dn = flowLines([{ from: 'b', to: 'c', x: 10, y: 400, w: 40, h: 40 }, { from: 'a', to: 'c', x: 10, y: 400, w: 40, h: 40 }, { from: 'c', to: 'b', x: 10, y: 400, w: 40, h: 40 }, { from: 'd', to: 'a', x: 10, y: 400, w: 40, h: 40 }], ['a', 'b', 'c', 'd'], g2, 'app', [390, 844], { lift: 34 })
const skipOf = (ln) => ['a', 'b', 'c', 'd'].map((k, i) => (k === ln.from || k === ln.to ? i : -1)).filter((i) => i >= 0)
const g3 = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 3) * 520, y: Math.floor(i / 3) * 1000 }))
const k6 = ['a', 'b', 'c', 'd', 'e', 'f']
dn.push(...flowLines([{ from: 'f', to: 'a', x: 10, y: 400, w: 40, h: 40 }, { from: 'a', to: 'f', x: 300, y: 600, w: 40, h: 40 }, { from: 'e', to: 'b', x: 10, y: 400, w: 40, h: 40 }, { from: 'c', to: 'a', x: 10, y: 400, w: 40, h: 40 }], k6, g3, 'app', [390, 844], { lift: 34 }).map((ln) => ({ ...ln, g: g3 })))
const skip6 = (ln) => k6.map((k, i) => (k === ln.from || k === ln.to ? i : -1)).filter((i) => i >= 0)
check('连线：换排 / 上下同一列 / 隔屏的都不穿过别的屏', dn.length === 8 && dn.every((ln) => !through(ln.d, ln.g || g2, ln.g ? skip6(ln) : skipOf(ln))), dn.map((x) => x.d).join(' | '))

// ── 多尺寸并排 ──
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

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
