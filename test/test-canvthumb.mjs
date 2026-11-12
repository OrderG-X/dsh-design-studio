/**
 * 画布上睡着的屏的缩略图（issue #17）的服务端（不用开 DSH、不用真浏览器）：
 *   node test/test-canvthumb.mjs
 *
 * 只给本地设计、只给这个会话现在开着的目录和屏；第一次截、之后给缓存；HTML 或样式改了重截、旧图删掉；
 * 目录报了改动立刻重扫（不等 1.5 秒，各会话共用）；删掉 / 改名样式也重截；嵌了别的 HTML 的屏，别的 HTML 改了也重截；
 * 太深扫不到的样式改了、目录报了改动 / 重新监听 / 不在监听 / 换了一份记号表都重截；emoji 标题不出错；浏览器不缓存；
 * 同一屏同时只截一次；一次最多截两张；排着队没人等了就不截；截的时候文件又改了也照样限总数；别人做的设计断网截；没浏览器 503。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createCanvasThumbs, createDirRevs, assetStamp, assetScan } from '../lib/canvthumb.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-canvthumb-'))
const root = path.join(tmp, 'deck')
const cache = path.join(tmp, 'cache')
fs.mkdirSync(root)
for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(root, `s${i}.html`), `<h1>${i}</h1>`)
fs.writeFileSync(path.join(root, 'style.css'), 'h1{}')

const origin = 'http://127.0.0.1:1'
const keys = ['s1.html', 's2.html', 's3.html', 's4.html', 's5.html', 's6.html']
const snaps = {
  local: { target: { kind: 'file', root }, changedAt: 1, screens: keys.map((key) => ({ key, url: `${origin}/${key}` })) },
  proxy: { target: { kind: 'proxy', port: 3000, path: '/' }, screens: [{ key: '/', url: 'http://127.0.0.1:2/' }] },
}
const tracker = { snapshot: (id) => snaps[id] || { target: null } }

// 假浏览器：记下开了哪些页、同时开着几个；hold 时截图卡住，放开才完
const pages = []
let open = 0
let peak = 0
let hold = null
let hasBrowser = true
let titleFor = (url) => `  标题 ${url.split('/').pop()}\n`
let during = null // 截的时候顺手干点什么（比如改文件）
const browser = {
  available: () => hasBrowser,
  withPage: async (opts, fn) => {
    pages.push(opts)
    open++
    peak = Math.max(peak, open)
    try {
      if (hold) await hold.p
      if (during) during(opts)
      return await fn({ eval: async (x) => (/info\(\)/.test(x) ? { title: titleFor(opts.url) } : /settle|dark\(/.test(x) ? {} : true), shot: async () => Buffer.from(`jpg:${opts.url}:${pages.length}`) })
    } finally { open-- }
  },
}
const gate = () => { let r; const p = new Promise((x) => { r = x }); return { p, go: r } }
let strict = false
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
const mainDirs = createDirRevs()
const thumbs = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', strictRoot: () => strict, admit: () => true, json, dirs: mainDirs, dir: cache, assetMs: 0 })
const server = http.createServer((req, res) => thumbs.route(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/scrthumb`
const get = (q) => new Promise((resolve, reject) => {
  const req = http.get(`${base}?${q}`, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], cache: res.headers['cache-control'], name: res.headers['x-dsh-thumb'] || '', recheck: res.headers['x-dsh-recheck'] || '', title: decodeURIComponent(res.headers['x-dsh-title'] || ''), body: Buffer.concat(chunks).toString() }))
  })
  req.on('error', reject)
})
const R = `&root=${encodeURIComponent(root)}`
const q = (key, more = '', w = 1920) => `session=local${R}&key=${encodeURIComponent(key)}&w=${w}&h=1080${more}`
const files = () => fs.readdirSync(cache).filter((n) => n.endsWith('.jpg'))
const sides = () => fs.readdirSync(cache).filter((n) => n.endsWith('.json'))

try {
  // ── 不该给的 ──
  check('参数不全 400', (await get(`session=local${R}&key=s1.html`)).status === 400 && (await get('session=local&key=s1.html&w=800&h=600')).status === 400)
  check('开发服务器的设计不截（404）', (await get(`session=proxy${R}&key=%2F&w=800&h=600`)).status === 404 && pages.length === 0)
  check('不是这个会话现在开着的目录 404（换了设计，晚到的请求不给新设计的图）', (await get(q('s1.html').replace(R, `&root=${encodeURIComponent(root + '2')}`))).status === 404 && pages.length === 0)
  check('不是这个会话的屏 404', (await get(q('../etc/passwd.html'))).status === 404 && (await get(q('other.html'))).status === 404 && pages.length === 0)
  check('没有这个会话 404', (await get(`session=nope${R}&key=s1.html&w=800&h=600`)).status === 404)
  hasBrowser = false
  check('没浏览器 503', (await get(q('s1.html'))).status === 503 && pages.length === 0)
  hasBrowser = true

  // ── 截一次、之后给缓存 ──
  const a = await get(q('s1.html'))
  check('第一次：截一张 JPEG，浏览器不缓存', a.status === 200 && a.type === 'image/jpeg' && a.cache === 'no-store' && a.body.startsWith('jpg:') && pages.length === 1, JSON.stringify(a).slice(0, 200))
  check('截的是那屏的地址、宽 480、按画幅开', pages[0].url === `${origin}/s1.html` && pages[0].w === 1920 && pages[0].h === 1080 && Math.abs(pages[0].scale - 0.25) < 1e-9 && pages[0].offline === false, JSON.stringify(pages[0]))
  const b = await get(q('s1.html', '&r=123'))
  check('第二次：给缓存，不再截', b.status === 200 && b.body === a.body && pages.length === 1)
  check('响应头带这张图的名字（同一张一样）；目录没在监听时叫页面过会儿再来要', a.name && a.name === b.name && a.recheck === '10', JSON.stringify([a.name, b.name, a.recheck]))
  mainDirs.watched(root)
  const b2 = await get(q('s1.html'))
  check('目录在监听：不用再来要', b2.status === 200 && b2.recheck === '' && pages.length === 1, JSON.stringify([b2.status, b2.recheck]))
  check('页面标题放在响应头（去掉多余空白），缓存的也带', a.title === '标题 s1.html' && b.title === '标题 s1.html', JSON.stringify([a.title, b.title]))
  check('深色另截一张', (await get(q('s1.html', '&dark=1'))).status === 200 && pages.length === 2 && pages[1].dark === true)

  // ── 改了重截、旧图删掉 ──
  const before = files().length
  await wait(20)
  fs.writeFileSync(path.join(root, 's1.html'), '<h1>1 改过</h1>')
  const c = await get(q('s1.html'))
  check('HTML 改了：重截', c.status === 200 && c.body !== a.body && pages.length === 3)
  check('HTML 改了：这屏的旧图删掉（连同标题）', files().length === before && sides().length === before, `${before} → ${files().length}/${sides().length}`)
  await wait(20)
  fs.writeFileSync(path.join(root, 'style.css'), 'h1{color:red}')
  check('样式文件改了：也重截', (await get(q('s1.html'))).status === 200 && pages.length === 4)
  const st0 = assetStamp(root)
  fs.writeFileSync(path.join(root, 's2.html'), '<h1>2 改过</h1>')
  const st1 = assetStamp(root)
  fs.writeFileSync(path.join(root, 'more.css'), '')
  const st2 = assetStamp(root)
  fs.renameSync(path.join(root, 'more.css'), path.join(root, 'more2.css'))
  const st3 = assetStamp(root)
  fs.rmSync(path.join(root, 'more2.css'))
  check('assetStamp 不看 HTML；别的文件加、改名、删都变', st0 === st1 && st2 !== st1 && st3 !== st2 && assetStamp(root) === st0, JSON.stringify([st0, st1, st2, st3]))

  // 删掉一个旧的样式文件（目录里最新的修改时间没变）：也重截
  const oldCss = path.join(root, 'old.css')
  fs.writeFileSync(oldCss, 'p{}')
  fs.utimesSync(oldCss, new Date(Date.now() - 86400e3), new Date(Date.now() - 86400e3))
  await get(q('s1.html'))
  const n2 = pages.length
  fs.rmSync(oldCss)
  check('删了一个旧样式文件：重截', (await get(q('s1.html'))).status === 200 && pages.length === n2 + 1)

  // ── 同一屏同时只截一次 ──
  hold = gate()
  const n0 = pages.length
  const two = [get(q('s2.html')), get(q('s2.html')), get(q('s2.html'))]
  await wait(50)
  hold.go(); hold = null
  const rs = await Promise.all(two)
  check('同一屏三个请求只截一次', rs.every((r) => r.status === 200 && r.body === rs[0].body) && pages.length === n0 + 1, `${pages.length - n0}`)

  // ── 一次最多截两张 ──
  peak = 0
  hold = gate()
  const many = ['s3.html', 's4.html', 's5.html', 's6.html'].map((k) => get(q(k, '&dark=1')))
  await wait(50)
  check('一次最多截两张（排着队的等着）', open === 2 && thumbs.pending() === 4, `open=${open} pending=${thumbs.pending()}`)
  hold.go(); hold = null
  await Promise.all(many)
  check('排着的都截完了', peak === 2 && thumbs.pending() === 0)

  // ── 排着队没人等了就不截 ──
  hold = gate()
  const n1 = pages.length
  const run1 = [get(q('s3.html', '', 800)), get(q('s4.html', '', 800))].map((p) => p.catch(() => null))
  await wait(30)
  // 第三张排着队，请求断了
  await new Promise((resolve) => {
    const req = http.get(`${base}?${q('s5.html').replace('w=1920', 'w=800')}`)
    req.on('error', () => resolve())
    setTimeout(() => { req.destroy(); resolve() }, 30)
  })
  await wait(30)
  hold.go(); hold = null
  await Promise.all(run1)
  await wait(50)
  check('排队时请求断了：那张不截', pages.length === n1 + 2 && !pages.slice(n1).some((p) => p.url.endsWith('s5.html') && p.w === 800), JSON.stringify(pages.slice(n1).map((p) => p.url)))

  // ── emoji 标题：截到 80 个字不能把 emoji 劈开 ──
  titleFor = () => 'a'.repeat(79) + '😀尾巴'
  const e = await get(q('s3.html', '', 900))
  titleFor = (url) => `  标题 ${url.split('/').pop()}\n`
  check('标题第 80 个字是 emoji：照样 200，标题截在整字上', e.status === 200 && e.title === 'a'.repeat(79) + '😀', `${e.status} ${e.title.length}`)

  // ── 别人做的设计断网截 ──
  strict = true
  await get(q('s6.html', '', 640))
  check('别人做的设计：断网截', pages.at(-1).offline === true)
  strict = false

  // ── 文件删了 ──
  fs.rmSync(path.join(root, 's6.html'))
  check('屏的文件没了 404', (await get(q('s6.html', '', 700))).status === 404)

  // ── 目录报了改动：资源立刻重扫（不等 assetMs） ──
  const cache2 = path.join(tmp, 'cache2')
  const dirs = createDirRevs()
  dirs.watched(root)
  const slow = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs, dir: cache2, assetMs: 60_000 })
  const o2 = (w, key = 's2.html') => ({ root, key, url: `${origin}/${key}`, w, h: 600, dark: false })
  const n3 = pages.length
  await slow.thumb(o2(800), () => {})
  await wait(20)
  fs.writeFileSync(path.join(root, 'style.css'), 'h1{color:blue}')
  await slow.thumb(o2(800), () => {})
  const same = pages.length === n3 + 1 // 没报改动、还在 assetMs 内：先给缓存
  dirs.touched(root)
  await slow.thumb(o2(800), () => {})
  check('样式刚改、目录报了改动：立刻重截', same && pages.length === n3 + 2, `${same} ${pages.length - n3}`)

  // ── 嵌了别的 HTML 的屏：别的 HTML 改了也重截；没嵌的不重截 ──
  fs.writeFileSync(path.join(root, 'child.html'), '<p>红</p>')
  fs.writeFileSync(path.join(root, 's5.html'), '<h1>5</h1><iframe src="child.html"></iframe>')
  const plain = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs, dir: cache2, assetMs: 0 })
  await plain.thumb(o2(800, 's5.html'), () => {})
  await plain.thumb(o2(800, 's3.html'), () => {})
  const n5 = pages.length
  await wait(20)
  fs.writeFileSync(path.join(root, 'child.html'), '<p>蓝蓝</p>')
  await plain.thumb(o2(800, 's5.html'), () => {})
  await plain.thumb(o2(800, 's3.html'), () => {})
  check('嵌了 child.html 的屏：child 改了重截；没嵌的屏不重截', pages.length === n5 + 1 && pages.at(-1).url.endsWith('s5.html'), `${pages.length - n5}`)
  // 本地脚本里载 child.html：也算；只引 CDN 脚本的不算
  fs.writeFileSync(path.join(root, 's5.html'), '<h1>5</h1><div id=x></div><script src="app.js"></script>')
  fs.writeFileSync(path.join(root, 's3.html'), '<h1>3</h1><script src="https://cdn.tailwindcss.com"></script>')
  await plain.thumb(o2(800, 's5.html'), () => {})
  await plain.thumb(o2(800, 's3.html'), () => {})
  const n6 = pages.length
  await wait(20)
  fs.writeFileSync(path.join(root, 'child.html'), '<p>绿绿绿</p>')
  await plain.thumb(o2(800, 's5.html'), () => {})
  await plain.thumb(o2(800, 's3.html'), () => {})
  check('引了本地脚本的屏：别的 HTML 改了重截；只引 CDN 脚本的不重截', pages.length === n6 + 1 && pages.at(-1).url.endsWith('s5.html'), `${pages.length - n6}`)

  // ── 太深的样式（扫不到）：目录报了改动 / 重新监听 / 不在监听 / 换了一份（重启、重新启用）就重截 ──
  const deep = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g')
  fs.mkdirSync(deep, { recursive: true })
  fs.writeFileSync(path.join(deep, 'x.css'), 'p{}')
  check('assetScan：太深的目录算没扫全', assetScan(root).partial === true && assetScan(path.join(root, 'a')).partial === false)
  const fast = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs, dir: cache2, assetMs: 0 })
  await fast.thumb(o2(700), () => {})
  const n4 = pages.length
  fs.writeFileSync(path.join(deep, 'x.css'), 'p{color:red}')
  await fast.thumb(o2(700), () => {})
  const same2 = pages.length === n4 // 扫不到、没报：还是旧的（监听着的话一定会报）
  dirs.touched(root)
  await fast.thumb(o2(700), () => {})
  const after1 = pages.length === n4 + 1
  dirs.unwatched(root); dirs.watched(root)
  await fast.thumb(o2(700), () => {})
  check('扫不到的深处改了：目录报了改动就重截；重新监听也重截', same2 && after1 && pages.length === n4 + 2, `${same2} ${after1} ${pages.length - n4}`)
  // 给页面看的 tag：开始 / 停止监听就变，改动不变
  const tg0 = dirs.tag(root)
  dirs.touched(root)
  const tg1 = dirs.tag(root)
  dirs.unwatched(root)
  const tg2 = dirs.tag(root)
  dirs.watched(root)
  check('tag：改动不变、停止 / 开始监听都变', tg0 === tg1 && tg2 !== tg1 && dirs.tag(root) !== tg2 && dirs.tag(root) !== tg1 && tg0.startsWith('on.') && tg2.startsWith('off.'), JSON.stringify([tg0, tg2, dirs.tag(root)]))
  await fast.thumb(o2(700), () => {}) // 刚才这一下重新监听了：重截一张，下面从这里数
  // 另一个地方（同一个目录）来要：共用记号，不重截
  await createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs, dir: cache2, assetMs: 0 }).thumb(o2(700), () => {})
  check('同一目录别的地方来要：共用记号，直接给缓存', pages.length === n4 + 3)
  // 不在监听（关了、监听出错）：改了什么不知道，旧图不认；blindMs 内的重复请求给这段时间截的
  dirs.unwatched(root)
  const blind = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs, dir: cache2, assetMs: 0, blindMs: 60_000 })
  await blind.thumb(o2(700), () => {})
  await blind.thumb(o2(700), () => {})
  check('没在监听：旧图不认，重截一次', pages.length === n4 + 4, `${pages.length - n4}`)
  dirs.watched(root)
  // 换了一份（重启、插件重新启用：新的 createDirRevs，号从头数）：之前截的不认
  const dirs2 = createDirRevs()
  dirs2.watched(root)
  for (let i = 0; i < 3; i++) dirs2.touched(root) // 号故意数到和原来可能撞上
  await createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dirs: dirs2, dir: cache2, assetMs: 0 }).thumb(o2(700), () => {})
  check('换了一份记号表：没扫全的目录重截', pages.length === n4 + 5, `${pages.length - n4}`)
  fs.rmSync(path.join(root, 'a'), { recursive: true })

  // ── 截的时候文件又改了：这屏旧图先不删，但总数照样限 ──
  const cache3 = path.join(tmp, 'cache3')
  const tiny = createCanvasThumbs({ tracker, browser: () => browser, trust: () => 'tr1', admit: () => true, json, dir: cache3, keep: 2, assetMs: 0 })
  let k = 0
  during = () => fs.writeFileSync(path.join(root, 's4.html'), `<h1>4 第 ${++k} 次</h1>`)
  for (let i = 0; i < 41; i++) await tiny.thumb({ root, key: 's4.html', url: `${origin}/s4.html`, w: 800, h: 600, dark: false }, () => {})
  during = null
  const left = fs.readdirSync(cache3).filter((n) => n.endsWith('.jpg')).length
  check('截的时候文件一直在改：缓存总数照样限住', left <= 3, `${left} 张`)

  // ── 预览服务器：开始监听 / 不再监听都报（目录还没建时报不在听，建好再开补上；关了报不在听） ──
  const { createHub } = await import('../lib/serve.js')
  const ev = []
  const hub = createHub({ log: () => {}, onWatch: (k) => ev.push('w ' + k), onUnwatch: (k) => ev.push('u ' + k) })
  const later = path.join(tmp, 'later')
  const k1 = `file:${path.resolve(later)}`
  try {
    await hub.open({ kind: 'file', root: later })
    const notYet = ev.join(',') === `u ${k1}`
    fs.mkdirSync(later)
    await hub.open({ kind: 'file', root: later })
    const nowOn = ev.at(-1) === `w ${k1}`
    hub.close(k1)
    check('预览服务器：目录没建报不在听、建好补上监听、关了报不在听', notYet && nowOn && ev.at(-1) === `u ${k1}`, ev.join(' | '))
  } finally { hub.closeAll() }
} finally {
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
