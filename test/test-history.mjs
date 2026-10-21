/**
 * 设计版本的测试（不用开 DSH）：
 *   node test/test-history.mjs
 *
 * 存一版 / 没变不存 / 只存设计文件 / 列表带改了什么 / 旧版本的文件读得到 / 回到某一版（现在的先存）/
 * 超过上限删旧的；会话事件：每轮前后各存一版、版本名取用户这句话；预览服务器给出旧版本的文件；导出的图片不算改动。
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHistory, collect, diffFiles } from '../lib/history.js'
import { createTracker, parseTarget, askOf } from '../lib/core.js'
import { createHub } from '../lib/serve.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-hist-'))
const site = path.join(tmp, 'site')
fs.mkdirSync(path.join(site, 'node_modules', 'x'), { recursive: true })
fs.mkdirSync(path.join(site, 'exports'))
fs.mkdirSync(path.join(site, 'refs'))
fs.mkdirSync(path.join(site, 'img'))
fs.writeFileSync(path.join(site, 'login.html'), '<h1>login v1</h1>')
fs.writeFileSync(path.join(site, 'tokens.css'), ':root{--brand:#c26a32}')
fs.writeFileSync(path.join(site, 'img', 'logo.svg'), '<svg/>')
fs.writeFileSync(path.join(site, 'node_modules', 'x', 'a.js'), 'x')
fs.writeFileSync(path.join(site, 'exports', 'login.png'), 'png')
fs.writeFileSync(path.join(site, 'refs', 'mood.png'), 'png')
fs.writeFileSync(path.join(site, 'notes.docx'), 'doc')

const found = collect(site)
check('只收设计文件：跳过 node_modules、exports、refs、别的类型', JSON.stringify(Object.keys(found).sort()) === JSON.stringify(['img/logo.svg', 'login.html', 'tokens.css']), JSON.stringify(Object.keys(found)))
check('diffFiles：新增、改了、删了都算', JSON.stringify(diffFiles({ a: '1', b: '2' }, { b: '3', c: '4' })) === JSON.stringify(['a', 'b', 'c']))

let t = 1000
const hist = createHistory({ base: path.join(tmp, 'store'), now: () => t })
const v1 = hist.snapshot(site, '做一个咖啡 App')
check('第一版存上了，带名字', v1 && v1.n === 1 && v1.label === '做一个咖啡 App' && Object.keys(v1.files).length === 3)
check('没改 → 不再存', hist.snapshot(site, '再来') === null)

await sleep(5)
t = 2000
fs.writeFileSync(path.join(site, 'tokens.css'), ':root{--brand:#1f4d3a}')
fs.writeFileSync(path.join(site, 'home.html'), '<h1>home</h1>')
const v2 = hist.snapshot(site, '主色换成墨绿')
check('改了 → 存第二版', v2 && v2.n === 2)
const list = hist.list(site)
check('列表新的在前，带改了哪些文件和几屏', list.length === 2 && list[0].n === 2 && JSON.stringify(list[0].changed) === JSON.stringify(['home.html', 'tokens.css']) && JSON.stringify(list[0].screens.sort()) === JSON.stringify(['home.html', 'login.html']), JSON.stringify(list[0]))
check('最早的一版不算「改了」，带一共几个文件', list[1].first === true && list[1].changed.length === 0 && list[1].count === 3 && list[0].first === false, JSON.stringify(list[1]))
check('旧版本的文件读得到（内容是当时的）', fs.readFileSync(hist.fileOf(site, 1, 'tokens.css'), 'utf8').includes('#c26a32'))
check('旧版本里没有的文件 → null', hist.fileOf(site, 1, 'home.html') === null && hist.fileOf(site, 9, 'login.html') === null)

await sleep(5)
fs.writeFileSync(path.join(site, 'login.html'), '<h1>login v3 手改</h1>')
const r = hist.restore(site, 1)
check('回到第 1 版：文件写回去', fs.readFileSync(path.join(site, 'tokens.css'), 'utf8').includes('#c26a32') && fs.readFileSync(path.join(site, 'login.html'), 'utf8') === '<h1>login v1</h1>')
check('回之前先把现在的存一版（能再切回来）', r.saved && r.saved.label === '回退前' && fs.readFileSync(hist.fileOf(site, r.saved.n, 'login.html'), 'utf8').includes('v3'))
check('那一版之后新加的文件不删', fs.existsSync(path.join(site, 'home.html')))
let threw = ''
try { hist.restore(site, 99) } catch (e) { threw = e.message }
check('没有这一版 → 报错', /没有第 99 版/.test(threw))

// 上限：最多留 40 版，旧的连内容一起清掉
const many = path.join(tmp, 'many')
fs.mkdirSync(many)
const h2 = createHistory({ base: path.join(tmp, 'store2') })
for (let i = 0; i < 45; i++) {
  fs.writeFileSync(path.join(many, 'a.html'), `<p>${i}</p>`)
  fs.utimesSync(path.join(many, 'a.html'), new Date(), new Date(Date.now() + i * 1000))
  h2.snapshot(many, 'v' + i)
}
const l2 = h2.list(many)
const objs = fs.readdirSync(path.join(h2.dirOf(many), 'objects')).length
check('最多留 40 版，删掉的版本内容也清掉', l2.length === 40 && l2[l2.length - 1].label === 'v5' && objs === 40, `${l2.length} ${objs}`)

// 满 40 版时回到最旧的一版：回退前存的那一版会把它裁掉，内容得先读出来，照样完整回过去
fs.writeFileSync(path.join(many, 'a.html'), '<p>手改</p>')
fs.writeFileSync(path.join(many, 'b.css'), 'p{}')
const oldest = l2[l2.length - 1]
const rOld = h2.restore(many, oldest.n)
check('满 40 版回到最旧的一版：内容完整写回', fs.readFileSync(path.join(many, 'a.html'), 'utf8') === '<p>5</p>' && rOld.restored === 1, JSON.stringify(rOld))
check('回退前的样子也存上了', rOld.saved && fs.readFileSync(h2.fileOf(many, rOld.saved.n, 'a.html'), 'utf8') === '<p>手改</p>')

// 回退前存不下（目录太大）：拒绝回退，一个文件都不动
{
  const hb = path.join(tmp, 'grow')
  fs.mkdirSync(hb)
  fs.writeFileSync(path.join(hb, 'a.html'), '<p>v1</p>')
  const h4 = createHistory({ base: path.join(tmp, 'store5') })
  h4.snapshot(hb, 'v1')
  fs.writeFileSync(path.join(hb, 'a.html'), '<p>没存过的改动</p>')
  for (let i = 0; i < 320; i++) fs.writeFileSync(path.join(hb, `p${i}.html`), 'x')
  let msg = ''
  try { h4.restore(hb, 1) } catch (e) { msg = e.message }
  check('回退前存不下 → 报错、不回退', /没有回退/.test(msg) && fs.readFileSync(path.join(hb, 'a.html'), 'utf8') === '<p>没存过的改动</p>', msg)
}

// 要被盖掉的文件现在超过 2MB（存档时被跳过）：整次不回，说明原因，文件原样留着
{
  const hg = path.join(tmp, 'huge')
  fs.mkdirSync(hg)
  fs.writeFileSync(path.join(hg, 'index.html'), '<p>v1 small</p>')
  fs.writeFileSync(path.join(hg, 'a.css'), 'p{}')
  const h7 = createHistory({ base: path.join(tmp, 'store8') })
  const first = h7.snapshot(hg, 'v1')
  const big = '<p>current work</p><img src="data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) + '">'
  fs.writeFileSync(path.join(hg, 'index.html'), big)
  fs.writeFileSync(path.join(hg, 'a.css'), 'p{color:red}')
  let msg = ''
  try { h7.restore(hg, first.n) } catch (e) { msg = e.message }
  check('要盖掉的文件超过 2MB 没进存档 → 报错、说清是哪个、一个都不写', /index\.html/.test(msg) && /2MB/.test(msg) && fs.readFileSync(path.join(hg, 'index.html'), 'utf8') === big && fs.readFileSync(path.join(hg, 'a.css'), 'utf8') === 'p{color:red}', msg)
  fs.writeFileSync(path.join(hg, 'index.html'), '<p>small again</p>')
  const ok = h7.restore(hg, first.n)
  check('文件变小、存得下了 → 照常回退', ok.restored === 2 && fs.readFileSync(path.join(hg, 'index.html'), 'utf8') === '<p>v1 small</p>', JSON.stringify(ok))
}

// 父目录是指到项目外的软链接：不顺着写出去
{
  const proj = path.join(tmp, 'proj')
  const outside = path.join(tmp, 'outside')
  fs.mkdirSync(path.join(proj, 'theme'), { recursive: true })
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(proj, 'index.html'), '<p>old</p>')
  fs.writeFileSync(path.join(proj, 'theme', 'config.json'), 'SNAPSHOT_INSIDE')
  const h5 = createHistory({ base: path.join(tmp, 'store6') })
  h5.snapshot(proj, 'v1') // 那时 theme 还是真目录
  fs.rmSync(path.join(proj, 'theme'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'config.json'), 'OUTSIDE_KEEP')
  fs.symlinkSync(outside, path.join(proj, 'theme')) // 现在 theme 指到项目外
  fs.writeFileSync(path.join(proj, 'index.html'), '<p>now</p>')
  const r5 = h5.restore(proj, 1)
  check('父目录软链接到项目外：那个文件不写', fs.readFileSync(path.join(outside, 'config.json'), 'utf8') === 'OUTSIDE_KEEP', fs.readFileSync(path.join(outside, 'config.json'), 'utf8'))
  check('别的文件照常回退', fs.readFileSync(path.join(proj, 'index.html'), 'utf8') === '<p>old</p>' && r5.restored === 1, JSON.stringify(r5))
}

// 版本里的文件名正好是 toString / constructor / __proto__：不摸到原型上去
check('fileOf：原型上的名字 → null，不抛错', ['toString', 'constructor', '__proto__', 'hasOwnProperty'].every((k) => hist.fileOf(site, 1, k) === null))
{
  const bad = path.join(tmp, 'bad')
  fs.mkdirSync(bad)
  const h6 = createHistory({ base: path.join(tmp, 'store7') })
  fs.mkdirSync(h6.dirOf(bad), { recursive: true })
  fs.writeFileSync(path.join(h6.dirOf(bad), 'index.json'), JSON.stringify([{ n: 1, at: 1, label: '', files: { 'a.html': '../../../../etc/hosts', 'b.html': 'zz' } }]))
  check('fileOf：哈希不是 40 位十六进制 → null', h6.fileOf(bad, 1, 'a.html') === null && h6.fileOf(bad, 1, 'b.html') === null)
  let msg = ''
  try { h6.restore(bad, 1) } catch (e) { msg = e.message }
  check('restore：版本记录坏了 → 报错、不写', /不全/.test(msg) && !fs.existsSync(path.join(bad, 'a.html')), msg)
}

// 太大的目录（多半是整个项目）不存
const big = path.join(tmp, 'big')
fs.mkdirSync(big)
for (let i = 0; i < 320; i++) fs.writeFileSync(path.join(big, `p${i}.html`), 'x')
check('文件太多 → 不像设计目录，不存', collect(big) === null && createHistory({ base: path.join(tmp, 'store3') }).snapshot(big) === null)

// ── 用户这句话 ──
check('askOf：只认用户打的字，取第一行', askOf({ source: { kind: 'user' }, content: [{ type: 'text', text: '\n把主色换成墨绿\n再调大字号' }] }) === '把主色换成墨绿')
check('askOf：系统注入的不算、太长截断', askOf({ source: { kind: 'agent-instructions' }, content: 'x' }) === '' && askOf({ source: { kind: 'user' }, content: '一'.repeat(50) }).length === 41)
const u = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const PICK = '〔选中元素〕em「3.2 km」\n文件：/a/home.html\n位置：main > em\nHTML：<em>3.2 km</em>\n样式：12×20 · color: red\n'
check('askOf：点选块换成短名字，后面跟用户的话', askOf(u(PICK + '\n改成绿色')) === '「3.2 km」 · 改成绿色')
check('askOf：块紧贴在用户那句话后面也认得', askOf(u('把这个距离文字改成绿色（只改这一处）' + PICK)) === '「3.2 km」 · 把这个距离文字改成绿色（只改这一处）')
check('askOf：只点选没说话 → 改「…」', askOf(u(PICK)) === '改「3.2 km」')
check('askOf：没字的元素用元素名', askOf(u('〔选中元素〕img\n文件：/a/b.html\n位置：img\n')) === '改img')
check('askOf：区域 / 两个元素', askOf(u('〔选中区域〕页面上 (1, 2) 起 3×4 的一块\n页面：http://x/\n包含：\n- div「a」\n\n挪到右边')) === '选中区域 · 挪到右边'
  && askOf(u(PICK + '\n〔选中元素〕button「领养」\n位置：b\n对齐一下')) === '「3.2 km」、「领养」 · 对齐一下')
check('askOf：设计变量、参考图、改字请求', askOf(u('〔设计变量〕--brand: #f60\n文件：/a/tokens.css\n')) === '改--brand'
  && askOf(u('〔参考图〕/a/refs/1.png（800×600，浅色）\n主要颜色：#fff #000\n照这张参考图的风格改现在的设计：先把配色…\n')) === '照参考图改'
  && askOf(u('把页面上的「来杯什么？」改成「喝点什么」（只改这一处文字，别的不动）。\n页面：http://localhost:5199/\n')) === '改字「来杯什么？」→「喝点什么」')

// ── 会话事件：每轮前后各存一版 ──
const app = path.join(tmp, 'app')
fs.mkdirSync(app)
fs.writeFileSync(path.join(app, 'login.html'), '<p>1</p>')
const h3 = createHistory({ base: path.join(tmp, 'store4') })
const tr = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:7' }), history: h3 })
await tr.setTarget('s1', parseTarget(path.join(app, 'login.html')), { source: 'tool' })
const ev = (type, data = {}) => tr.observe('s1', { type, time: Date.now(), data })
ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '加一个首页' }] })
ev('turn/start', { turn: 1 })
check('一轮开始：先存一版（这轮改之前的样子）', tr.versions('s1').length === 1 && tr.snapshot('s1').vrev === 1)
await sleep(5)
fs.writeFileSync(path.join(app, 'home.html'), '<p>home</p>')
ev('turn/end', { turn: 1, reason: { kind: 'completed' } })
const vs = tr.versions('s1')
check('一轮结束：再存一版，名字是用户那句话', vs.length === 2 && vs[0].label === '加一个首页' && vs[0].changed.includes('home.html'), JSON.stringify(vs[0]))
ev('turn/start', { turn: 2 })
ev('turn/end', { turn: 2, reason: { kind: 'completed' } })
check('这轮没改文件 → 不多存', tr.versions('s1').length === 2)
await sleep(5)
ev('turn/start', { turn: 3 })
fs.writeFileSync(path.join(app, 'home.html'), '<p>home 2</p>')
ev('turn/end', { turn: 3, reason: { kind: 'completed' } })
check('下一轮没有新的一句话 → 不借上一句当名字', tr.versions('s1')[0].label === '', JSON.stringify(tr.versions('s1')[0]))
tr.observe('s1', { type: 'turn/end', time: Date.now() - 600000, data: {} })
check('重放的旧事件不存版本', tr.versions('s1').length === 3)
const rr = tr.restoreVersion('s1', 1)
check('会话里回到第 1 版', rr.saved === null && tr.snapshot('s1').vrev >= 3)

// ── 预览服务器给旧版本的文件 ──
function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject)
  })
}
const changes = []
const hub = createHub({ history: hist, onChange: (key, file) => changes.push(file) })
const { origin } = await hub.open({ kind: 'file', root: site })
let res = await get(`${origin}/__dsh_design__/v/2/tokens.css`)
check('旧版本：/__dsh_design__/v/2/tokens.css 给当时的内容', res.status === 200 && res.body.includes('#1f4d3a'), res.body)
res = await get(`${origin}/__dsh_design__/v/1/login.html`)
check('旧版本的 HTML 也注入 picker', res.status === 200 && res.body.includes('login v1') && res.body.includes('/__dsh_design__/picker.js'))
res = await get(`${origin}/__dsh_design__/v/1/../../secret`)
check('旧版本：跳不出去、没有的给 404', res.status === 404 && (await get(`${origin}/__dsh_design__/v/7/login.html`)).status === 404)
const protoCodes = []
for (const k of ['toString', 'constructor', '__proto__']) protoCodes.push((await get(`${origin}/__dsh_design__/v/1/${k}`)).status)
check('旧版本：toString / constructor / __proto__ → 404，服务器不崩', protoCodes.every((c) => c === 404) && (await get(`${origin}/__dsh_design__/v/1/login.html`)).status === 200, protoCodes.join(','))

fs.rmSync(path.join(site, 'exports'), { recursive: true, force: true })
await sleep(150)
changes.length = 0
fs.mkdirSync(path.join(site, 'exports')) // 第一次导出：先建目录
fs.writeFileSync(path.join(site, 'exports', 'home.png'), 'png2')
await sleep(400)
check('建 exports/、往里写导出的图片 → 都不算设计改了', changes.length === 0, JSON.stringify(changes))
fs.writeFileSync(path.join(site, 'tokens.css'), ':root{--brand:red}')
await sleep(400)
check('改设计文件照常通知', changes.length === 1)

hub.closeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
