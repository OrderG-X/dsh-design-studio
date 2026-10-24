/**
 * 地址解析 + 自动发现的测试（不用开 DSH）：
 *   node test/test-core.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTracker, parseTarget, fromBashPath, serverUrlIn, devServerIn, replaceText, urlFor, labelOf, parseKind, parseSize, listScreens } from '../lib/core.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const throws = (fn) => { try { fn(); return '' } catch (e) { return e.message } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-core-'))
const site = path.join(tmp, '我的 网站')
fs.mkdirSync(site)
const index = path.join(site, 'index.html')
fs.writeFileSync(index, '<h1>x</h1>')
fs.writeFileSync(path.join(site, 'notes.txt'), 'x')

// ── parseTarget ──
check('Git Bash 路径 /c/Users/… → C:\\Users\\…（Windows）', fromBashPath('/c/Users/张三/a b/x.html', 'win32') === 'C:\\Users\\张三\\a b\\x.html', fromBashPath('/c/Users/张三/a b/x.html', 'win32'))
check('Git Bash 路径：只有盘符 /d → D:\\', fromBashPath('/d', 'win32') === 'D:\\')
check('Git Bash 路径：不是盘符开头的不动', fromBashPath('/Users/x/a.mp4', 'win32') === '/Users/x/a.mp4')
check('Git Bash 路径：别的系统不动', fromBashPath('/c/x.html', 'darwin') === '/c/x.html')
let t = parseTarget('5173')
check('端口 → 开发服务器', t.kind === 'proxy' && t.port === 5173 && t.path === '/')
t = parseTarget('http://localhost:3000/about?x=1')
check('localhost 地址带路径', t.kind === 'proxy' && t.port === 3000 && t.path === '/about?x=1')
t = parseTarget('127.0.0.1:8080')
check('不带 http 的 127.0.0.1:端口', t.kind === 'proxy' && t.port === 8080)
check('外网地址 → 拒', /只能预览本机/.test(throws(() => parseTarget('https://example.com'))))
t = parseTarget(index)
check('HTML 绝对路径（带中文和空格）', t.kind === 'file' && t.file === index && t.root === site)
t = parseTarget(site)
check('目录 → 里面的 index.html', t.kind === 'file' && t.file === index)
t = parseTarget('file://' + encodeURI(index))
check('file:// 地址也认', t.kind === 'file' && t.file === index)
t = parseTarget(pathToFileURL(index).href)
check('标准 file:// 地址（Windows 上是 file:///C:/…）→ 文件', t.kind === 'file' && t.file === index, JSON.stringify(t))
t = parseTarget('index.html', site)
check('相对路径按工作目录找', t.kind === 'file' && t.file === index)
check('不是 HTML → 拒', /只能预览 \.html/.test(throws(() => parseTarget(path.join(site, 'notes.txt')))))
check('不存在 → 拒', /找不到/.test(throws(() => parseTarget(path.join(site, 'nope.html')))))
check('端口越界 → 拒', /端口不对/.test(throws(() => parseTarget('99999'))))
check('urlFor：文件名编码', urlFor({ kind: 'file', file: index, root: site }, 'http://127.0.0.1:9') === 'http://127.0.0.1:9/index.html')
check('labelOf：开发服务器', labelOf({ kind: 'proxy', port: 5173, path: '/a' }) === 'localhost:5173/a')

// ── serverUrlIn ──
check('命令输出里找开发服务器地址', serverUrlIn('  VITE v5  ready\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.2:5173/').port === 5173)
check('跳过 DSH 自己 / 预览服务器的端口', serverUrlIn('http://127.0.0.1:4000 and http://localhost:3000', new Set([4000])).port === 3000)
check('没有地址 → null', serverUrlIn('done') === null)

// ── tracker ──
const opened = []
const tracker = createTracker({ open: async (target) => { opened.push(target); return { origin: `http://127.0.0.1:${40000 + opened.length}` } } })
const SID = 's1'
let seq = 0
const ev = (type, data, time = Date.now()) => tracker.observe(SID, { type, seq: seq++, time, data: { turn: 1, ...data } })
const wait = () => new Promise((r) => setTimeout(r, 20))
const write = (file, name = 'write') => ev('tool/call', { callId: 'c' + seq, name, arguments: JSON.stringify({ file_path: file, content: '<p>' }) })
const result = (text = 'ok', cwd, callId) => ev('tool/result', { message: { content: [{ type: 'text', text }], isError: false, ...(callId ? { toolCallId: callId } : {}) }, ...(cwd ? { meta: { cwd } } : {}) })
const bash = (command, out) => { const id = 'b' + seq; ev('tool/call', { callId: id, name: 'bash', arguments: JSON.stringify({ command }) }); result(out, undefined, id) }
const skill = (t = tracker, sid = SID) => { t.observe(sid, { type: 'tool/call', time: Date.now(), data: { callId: 'sk', name: 'skill', arguments: JSON.stringify({ name: 'ui-design' }) } }); t.observe(sid, { type: 'tool/result', time: Date.now(), data: { message: { content: [], toolCallId: 'sk' } } }) }

skill() // 这个会话在做设计（加载了设计技能）

ev('turn/start', {})
check('回合开始 → turn=true', tracker.snapshot(SID).turn === true)
write(index)
check('写 HTML 还没写完 → 先不开（文件可能还不存在）', tracker.snapshot(SID).target === null)
result()
await wait()
let s = tracker.snapshot(SID)
check('写完 HTML → 自动预览这个文件', s.target && s.target.kind === 'file' && s.target.file === index && s.source === 'auto', JSON.stringify(s))
check('自动预览要让右侧栏弹出来（openRev 变了）', s.openRev === 1)
check('地址就是预览服务器上的文件', s.url === 'http://127.0.0.1:40001/index.html')

write(path.join(site, 'style.css'), 'edit')
check('正在改预览目录里的文件 → writing 有文件名', tracker.snapshot(SID).writing === 'style.css')
result()
check('改完 → writing 清掉', tracker.snapshot(SID).writing === '')

tracker.changed(site)
check('目录有改动 → rev 变大', tracker.snapshot(SID).rev >= 2)

bash('npm run dev', '  VITE v5 ready\n  ➜  Local:   http://localhost:5173/')
await wait()
s = tracker.snapshot(SID)
check('自动预览的文件 → 开发服务器起来后换成开发服务器', s.target.kind === 'proxy' && s.target.port === 5173 && s.openRev === 2, JSON.stringify(s))

// 模型明确调了工具：自动发现不再改它
await tracker.setTarget(SID, parseTarget(index), { source: 'tool' })
bash('npm run dev', '  ➜  Local:   http://localhost:3000/')
await wait()
s = tracker.snapshot(SID)
check('模型指定的目标不被自动发现顶掉', s.target.kind === 'file' && s.source === 'tool')
const before = s.openRev
const other = path.join(site, 'other.html')
fs.writeFileSync(other, 'x')
write(other)
result()
await wait()
check('模型指定了目标后，再写别的 HTML 也不跳', tracker.snapshot(SID).target.file === index && tracker.snapshot(SID).openRev === before)

// 用户在地址栏输入的：不弹（已经在看了）
await tracker.setTarget(SID, parseTarget('8080'), { source: 'user', popup: false })
check('用户自己输入地址 → 不触发弹出', tracker.snapshot(SID).openRev === before)

ev('turn/end', { reason: { kind: 'completed' } })
check('回合结束 → turn=false', tracker.snapshot(SID).turn === false)

// 重放历史：老事件不动手
const t2 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:1' }) })
const old = Date.now() - 600e3
t2.observe('s2', { type: 'turn/start', time: old, data: { turn: 1 } })
t2.observe('s2', { type: 'tool/call', time: old, data: { turn: 1, name: 'write', arguments: JSON.stringify({ file_path: index }) } })
t2.observe('s2', { type: 'tool/result', time: old, data: { turn: 1, message: { content: [{ type: 'text', text: 'http://localhost:5173' }] } } })
await wait()
check('重放历史 → 不自动预览、不显示在干活', t2.snapshot('s2').target === null && t2.snapshot('s2').turn === false)

// 相对路径：按工具的工作目录
const t3 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:2' }) })
skill(t3, 's3')
t3.observe('s3', { type: 'tool/result', time: Date.now(), data: { message: { content: [] }, meta: { cwd: site } } })
t3.observe('s3', { type: 'tool/call', time: Date.now(), data: { name: 'write', arguments: JSON.stringify({ file_path: 'index.html' }) } })
t3.observe('s3', { type: 'tool/result', time: Date.now(), data: { message: { content: [] } } })
await wait()
check('相对路径的 HTML 按工具 cwd 找', t3.snapshot('s3').target && t3.snapshot('s3').target.file === index)

// 出错的命令输出不当开发服务器
const t4 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:3' }) })
skill(t4, 's4')
t4.observe('s4', { type: 'tool/call', time: Date.now(), data: { callId: 'e1', name: 'bash', arguments: JSON.stringify({ command: 'npm run dev' }) } })
t4.observe('s4', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: 'e1', content: [{ type: 'text', text: 'Error: port http://localhost:5173 in use' }], isError: true } } })
await wait()
check('出错的输出不当开发服务器', t4.snapshot('s4').target === null)

// 后台跑的开发服务器：bash 只回 job id，地址在 job_output 读出来的输出里
const tJ = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:6' }) })
skill(tJ, 'sJ')
const jcall = (id, name, args, text) => {
  tJ.observe('sJ', { type: 'tool/call', time: Date.now(), data: { callId: id, name, arguments: JSON.stringify(args) } })
  tJ.observe('sJ', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
}
jcall('j1', 'bash', { command: 'curl -s http://localhost:8789/ &', run_in_background: true }, 'started background job job_curl1')
jcall('j2', 'job_output', { job_id: 'job_curl1' }, 'Server ready: http://localhost:8789/\n[status: running]')
await wait()
check('后台 curl 的输出不当开发服务器', tJ.snapshot('sJ').target === null)
jcall('j3', 'bash', { command: 'node vite.js --port 5199', run_in_background: true }, 'started background job job_7f3a')
await wait()
check('后台启动：还没读到输出时不动', tJ.snapshot('sJ').target === null)
jcall('j4', 'job_output', { job_id: 'job_7f3a' }, '  VITE v8 ready in 60 ms\n  ➜  Local:   http://localhost:5199/\n[status: running]')
await wait()
check('后台启动的开发服务器 → job_output 读到地址就预览', tJ.snapshot('sJ').target && tJ.snapshot('sJ').target.port === 5199, JSON.stringify(tJ.snapshot('sJ').target))
const tJ2 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:7' }) })
skill(tJ2, 'sJ2')
tJ2.observe('sJ2', { type: 'tool/call', time: Date.now(), data: { callId: 'k1', name: 'job_output', arguments: JSON.stringify({ job_id: 'unknown' }) } })
tJ2.observe('sJ2', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: 'k1', content: [{ type: 'text', text: 'GET http://localhost:4000/api 200\n[status: running]' }] } } })
await wait()
check('不认识的 job：不像启动信息的地址不算', tJ2.snapshot('sJ2').target === null)

// 存盘：DSH 重启后接着预览，但不弹右侧栏
const mem = { data: {}, load() { return JSON.parse(JSON.stringify(this.data)) }, save(d) { this.data = JSON.parse(JSON.stringify(d)) } }
const t5 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:5' }), store: mem })
await t5.setTarget('s5', parseTarget(index), { source: 'tool' })
check('存盘：记下了会话的预览目标', mem.data.s5 && mem.data.s5.target.file === index)
const t6 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:6' }), store: mem })
check('重启后第一次取状态：正在接着开上次的预览（loading，右侧栏先别显示空状态）', t6.snapshot('s5').loading === true)
await wait()
s = t6.snapshot('s5')
check('重启后：自动恢复同一个页面', s.target && s.target.file === index && s.url === 'http://127.0.0.1:6/index.html' && s.source === 'tool', JSON.stringify(s))
check('重启后：恢复不弹右侧栏', s.openRev === 0)
t6.clear('s5')
check('清掉预览 → 盘上也删了', !mem.data.s5)

// 不是在做设计：别的任务写网页、起服务、查别的端口，都不弹
{
  const t7 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:7' }) })
  const at = () => Date.now()
  const call = (id, name, args) => t7.observe('s7', { type: 'tool/call', time: at(), data: { callId: id, name, arguments: JSON.stringify(args) } })
  const res = (id, text) => t7.observe('s7', { type: 'tool/result', time: at(), data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
  const plain = path.join(site, 'report.html')
  fs.writeFileSync(plain, '<html><head><title>周报</title></head><body>x</body></html>')
  call('w1', 'write', { file_path: plain })
  res('w1', 'ok')
  await wait()
  let x = t7.snapshot('s7')
  check('没在做设计：写了普通网页 → 不打开、不弹', x.target === null && x.openRev === 0)
  check('没在做设计：写的网页记下来（标题栏按钮亮个点，点开能预览）', x.hint === plain)
  call('b1', 'bash', { command: 'python3 -m http.server 8789' })
  res('b1', 'Serving HTTP on :: port 8789 (http://[::]:8789/) ... http://localhost:8789/')
  call('f1', 'browser_eval', { expression: "fetch('http://127.0.0.1:8789/state.json')" })
  res('f1', 'fetched http://127.0.0.1:8789/state.json')
  await wait()
  check('没在做设计：起了服务 / 查了别的端口 → 都不打开', t7.snapshot('s7').target === null && t7.snapshot('s7').openRev === 0)

  const designed = path.join(site, 'poster.html')
  fs.writeFileSync(designed, '<html><head><meta name="dsh-design" content="poster"></head><body>x</body></html>')
  call('w2', 'write', { file_path: designed })
  res('w2', 'ok')
  await wait()
  x = t7.snapshot('s7')
  check('页面写了设计类型标记 → 当设计稿自动打开', x.target && x.target.file === designed && x.openRev === 1, JSON.stringify(x))
  check('打开了就不再提示', x.hint === undefined || x.hint === '')
}
{
  // 在做设计，但只是去看别的端口：curl、浏览器工具里的地址不算
  const t8 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:8' }) })
  skill(t8, 's8')
  const call = (id, name, args) => t8.observe('s8', { type: 'tool/call', time: Date.now(), data: { callId: id, name, arguments: JSON.stringify(args) } })
  const res = (id, text) => t8.observe('s8', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
  call('c1', 'bash', { command: 'curl -s http://127.0.0.1:8789/state.json' })
  res('c1', '{"ok":true} from http://127.0.0.1:8789')
  call('c2', 'browser_eval', { expression: '1' })
  res('c2', 'Local: http://localhost:8799/')
  call('c3', 'bash', { command: 'echo done' })
  res('c3', 'see http://localhost:8790/x')
  await wait()
  check('在做设计：curl / 浏览器工具 / 随便打印的地址 → 不打开', t8.snapshot('s8').target === null)
  call('c4', 'bash', { command: 'python3 -m http.server 8123' })
  res('c4', 'Serving HTTP on 0.0.0.0 port 8123 (http://0.0.0.0:8123/) ...')
  await wait()
  check('在做设计：起了本地服务 → 打开', t8.snapshot('s8').target && t8.snapshot('s8').target.port === 8123)
}
{
  // 用户在输入框调了 /ui-design：也算在做设计
  const t9 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:9' }) })
  t9.observe('s9', { type: 'user/message', time: Date.now(), data: { source: { kind: 'user' }, content: [{ type: 'text', text: '/ui-design 做个登录页' }] } })
  t9.observe('s9', { type: 'tool/call', time: Date.now(), data: { callId: 'w', name: 'write', arguments: JSON.stringify({ file_path: other }) } })
  t9.observe('s9', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: 'w', content: [] } } })
  await wait()
  check('用户调了 /ui-design → 写的网页自动打开', t9.snapshot('s9').target && t9.snapshot('s9').target.file === other)
  const t10 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:10' }) })
  t10.observe('s10', { type: 'user/message', time: Date.now(), data: { source: { kind: 'user' }, content: [{ type: 'text', text: '<system-reminder>\n- `ui-design`: 做网页…\n</system-reminder>\n写个周报' }] } })
  check('技能列表里提到 ui-design 不算', t10.snapshot('s10') && !t10.stateOf('s10').design)
}
{
  // 以前存下来的：别的项目端口这种自动打开的，重启后不再接着显示；设计稿照常恢复
  const mem2 = { data: { a: { target: { kind: 'proxy', port: 8789, path: '/' }, source: 'auto', at: 1 }, b: { target: { kind: 'file', file: index, root: site }, source: 'auto', design: true, at: 2 } }, load() { return JSON.parse(JSON.stringify(this.data)) }, save(d) { this.data = JSON.parse(JSON.stringify(d)) } }
  const t11 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:11' }), store: mem2 })
  t11.snapshot('a')
  t11.snapshot('b')
  await wait()
  check('重启后：不是设计的自动预览不恢复', t11.snapshot('a').target === null)
  check('重启后：设计稿的自动预览照常恢复', t11.snapshot('b').target && t11.snapshot('b').target.file === index)
}
check('devServerIn：curl 不算', devServerIn('curl http://localhost:3000', 'http://localhost:3000') === null)
check('devServerIn：npm run dev 打印的地址算', devServerIn('npm run dev', 'Local: http://localhost:5173/').port === 5173)
check('devServerIn：别的命令只认像启动信息的那一行', devServerIn('node app.js', 'Server listening at http://localhost:4000').port === 4000 && devServerIn('node app.js', 'fetched http://localhost:4000/api') === null)

// 坏事件不抛
let threw = false
try {
  tracker.observe(SID, { type: 'tool/call', data: { name: 'write', arguments: '{bad' } })
  tracker.observe(SID, null)
  tracker.observe('', { type: 'turn/start' })
} catch { threw = true }
check('坏事件不往外抛', !threw)

// ── 类型、尺寸、几屏 ──
check('类型：认得标准名', parseKind('app') === 'app' && parseKind('Slides') === 'slides')
check('类型：常见别名', parseKind('mobile') === 'app' && parseKind('ppt') === 'slides' && parseKind('social') === 'poster' && parseKind('website') === 'web')
check('类型：认不出 → 空', parseKind('banana') === '' && parseKind('') === '')
check('尺寸：x / × 都认', parseSize('1080x1920') === '1080x1920' && parseSize(' 1080 × 1350 ') === '1080x1350')
check('尺寸：太小 / 乱写 → 空', parseSize('10x10') === '' && parseSize('big') === '')

const appDir = path.join(tmp, 'app')
fs.mkdirSync(appDir)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const f of ['login.html', 'home.html', 'detail.html']) { fs.writeFileSync(path.join(appDir, f), '<p>' + f); await sleep(15) }
fs.writeFileSync(path.join(appDir, 'app.css'), 'p{}')
fs.writeFileSync(path.join(appDir, '.draft.html'), 'x')
check('几屏：只要 HTML、跳过隐藏文件、按创建顺序', JSON.stringify(listScreens(appDir)) === JSON.stringify(['login.html', 'home.html', 'detail.html']), JSON.stringify(listScreens(appDir)))

const t7 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:7' }) })
await t7.setTarget('s7', parseTarget(path.join(appDir, 'login.html')), { source: 'tool', kind: 'phone' })
s = t7.snapshot('s7')
check('模型给的类型记下来（别名换成标准名）', s.kind === 'app' && s.view === '' && s.focus === 'login.html')
check('快照里列出几屏和各自地址', s.screens.length === 3 && s.screens[1].key === 'home.html' && s.screens[1].url === 'http://127.0.0.1:7/home.html' && s.screens[1].label === 'home', JSON.stringify(s.screens))
fs.writeFileSync(path.join(appDir, 'order.html'), '<p>order')
t7.changed(appDir)
check('目录里多了一屏 → 快照跟着多', t7.snapshot('s7').screens.map((x) => x.key).join(',') === 'login.html,home.html,detail.html,order.html')
const renameWrite = (f, body) => { const tf = path.join(appDir, '.tmp-' + f); fs.writeFileSync(tf, body); fs.renameSync(tf, path.join(appDir, f)) }
await sleep(15)
renameWrite('login.html', '<p>login v2')
t7.changed(appDir)
check('改一屏（写临时文件再换名，创建时间变了）→ 画布顺序不跳', listScreens(appDir)[3] === 'login.html' && t7.snapshot('s7').screens.map((x) => x.key).join(',') === 'login.html,home.html,detail.html,order.html', listScreens(appDir).join(','))
fs.writeFileSync(path.join(appDir, 'home-b.html'), '<p>home b')
t7.changed(appDir)
await sleep(15)
fs.writeFileSync(path.join(appDir, 'home-c.html'), '<p>home c')
t7.changed(appDir)
check('「再出两版」的 home-b / home-c 紧跟在 home 后面', t7.snapshot('s7').screens.map((x) => x.key).join(',') === 'login.html,home.html,home-b.html,home-c.html,detail.html,order.html', t7.snapshot('s7').screens.map((x) => x.key).join(','))
fs.writeFileSync(path.join(appDir, 'plan-b.html'), '<p>没有 plan.html')
t7.changed(appDir)
check('没有原版的 -b 文件照常排最后', t7.snapshot('s7').screens.at(-1).key === 'plan-b.html')
for (const f of ['home-b.html', 'home-c.html', 'plan-b.html']) fs.rmSync(path.join(appDir, f))
t7.changed(appDir)
await t7.setView('s7', { view: 'canvas', kind: 'poster', size: '1080x1920' })
s = t7.snapshot('s7')
check('右侧栏改类型 / 尺寸 / 视图', s.kind === 'poster' && s.size === '1080x1920' && s.view === 'canvas')
await t7.setView('s7', { focus: 'detail.html', view: 'single' })
s = t7.snapshot('s7')
check('换到另一屏：地址跟着换，类型留着', s.focus === 'detail.html' && s.url === 'http://127.0.0.1:7/detail.html' && s.kind === 'poster' && s.view === 'single')
check('换到不存在的屏 → 拒', /没有这一屏/.test(await t7.setView('s7', { focus: 'nope.html' }).then(() => '', (e) => e.message)))
await t7.setTarget('s7', parseTarget(index), { source: 'tool' })
s = t7.snapshot('s7')
check('换了别的目录 → 类型、视图清掉', s.kind === '' && s.view === '' && s.size === '')

await t7.setTarget('s8', parseTarget('5173'), { source: 'tool', routes: ['/', 'login', 'http://localhost:5173/settings', '/login'] })
check('开发服务器：几个路由并排（补 /、去重）', t7.snapshot('s8').screens.map((x) => x.key).join(',') === '/,/login,/settings')

const mem2 = { data: {}, load() { return this.data }, save(d) { this.data = JSON.parse(JSON.stringify(d)) } }
const t9 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:9' }), store: mem2 })
await t9.setTarget('s9', parseTarget(path.join(appDir, 'home.html')), { source: 'tool', kind: 'app' })
await t9.setView('s9', { view: 'canvas' })
const order9 = t9.snapshot('s9').screens.map((x) => x.key).join(',')
await sleep(15)
renameWrite('home.html', '<p>home v2')
const t10 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:10' }), store: mem2 })
t10.snapshot('s9')
await sleep(10)
s = t10.snapshot('s9')
check('重启后：类型和视图也恢复', s.kind === 'app' && s.view === 'canvas' && s.focus === 'home.html', JSON.stringify(s))
check('重启后：几屏的顺序照旧（中间改过文件也不乱）', s.screens.map((x) => x.key).join(',') === order9, s.screens.map((x) => x.key).join(',') + ' vs ' + order9)

// ── 预览里直接改字 ──
let rt = replaceText('<p>立即  登录</p><p>立即 登录</p>', '立即 登录', '马上登录', 1)
check('改字：第二处（空白不同也认）', rt.ok && rt.html === '<p>立即  登录</p><p>马上登录</p>', JSON.stringify(rt))
rt = replaceText('<style>.a:after{content:"Hi"}</style><script>var s="Hi"</script><!-- Hi --><b title="Hi">Hi</b>', 'Hi', 'Yo', 0)
check('改字：样式 / 脚本 / 注释 / 属性里的不算', rt.ok && rt.html.endsWith('<b title="Hi">Yo</b>'), JSON.stringify(rt))
rt = replaceText('<p>A &amp; B&nbsp;C</p>', 'A & B C', 'X<Y & Z', 0)
check('改字：源码里是实体也认，新字转义', rt.ok && rt.html === '<p>X&lt;Y &amp; Z</p>', JSON.stringify(rt))
rt = replaceText('<h1>\n  欢迎回来\n</h1>', '欢迎回来', '你好', 0)
check('改字：前后的换行缩进留着', rt.ok && rt.html === '<h1>\n  你好\n</h1>', JSON.stringify(rt))
check('改字：找不到 / 空的', replaceText('<p>x</p>', 'y', 'z').reason === 'not-found' && replaceText('<p>x</p>', 'x', '  ').reason === 'empty')
check('改字：数不到第 n 处', replaceText('<p>x</p><p>x</p>', 'x', 'z', 2).reason === 'not-found')
check('改字：正则字符原样', replaceText('<p>¥9.9 (限时)</p>', '¥9.9 (限时)', '¥19', 0).html === '<p>¥19</p>')

const editDir = path.join(tmp, 'edit')
fs.mkdirSync(editDir)
fs.writeFileSync(path.join(editDir, 'a.html'), '<h1>旧标题</h1><p>旧标题</p>')
fs.writeFileSync(path.join(editDir, 'b.html'), '<h1>B</h1>')
const snaps = []
const tE = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:11' }), history: { snapshot: (root, label) => { snaps.push(label); return { n: snaps.length } }, list: () => [] } })
check('改字：没在预览的会话不改', tE.editText('sE', { key: 'a.html', before: '旧标题', after: '新' }).reason === 'not-file')
await tE.setTarget('sE', parseTarget(path.join(editDir, 'a.html')), { source: 'tool' })
let er = tE.editText('sE', { key: 'a.html', before: '旧标题', after: '新标题', nth: 1 })
check('改字：写回文件', er.ok && fs.readFileSync(path.join(editDir, 'a.html'), 'utf8') === '<h1>旧标题</h1><p>新标题</p>', JSON.stringify(er))
check('改字：改前改后各存一版', snaps.length === 2 && snaps[0] === '' && snaps[1] === '改字「新标题」', JSON.stringify(snaps))
er = tE.editText('sE', { key: 'b.html', before: 'B', after: 'BB' })
check('改字：画布上的另一屏', er.ok && fs.readFileSync(path.join(editDir, 'b.html'), 'utf8') === '<h1>BB</h1>')
check('改字：目录外的文件不改', tE.editText('sE', { key: '../index.html', before: 'x', after: 'y' }).reason === 'no-screen' && tE.editText('sE', { key: 'notes.txt', before: 'x', after: 'y' }).reason === 'no-screen')
fs.writeFileSync(path.join(tmp, 'outside.html'), '<p>外面</p>')
fs.symlinkSync(path.join(tmp, 'outside.html'), path.join(editDir, 'link.html'))
er = tE.editText('sE', { key: 'link.html', before: '外面', after: '被改' })
check('改字：软链接指到目录外的不改', er.reason === 'no-screen' && fs.readFileSync(path.join(tmp, 'outside.html'), 'utf8') === '<p>外面</p>', JSON.stringify(er))
tE.observe('sE', { type: 'turn/start', time: Date.now(), data: {} })
er = tE.editText('sE', { key: 'b.html', before: 'BB', after: 'CC' })
check('改字：模型正在干活时不改（免得被它整份重写盖掉）', er.ok === false && er.reason === 'busy' && fs.readFileSync(path.join(editDir, 'b.html'), 'utf8') === '<h1>BB</h1>', JSON.stringify(er))
tE.observe('sE', { type: 'turn/end', time: Date.now(), data: {} })
check('改字：这轮干完又能改', tE.editText('sE', { key: 'b.html', before: 'BB', after: 'CC' }).ok === true)
await tE.setTarget('sE', parseTarget('5173'), { source: 'tool' })
check('改字：开发服务器不在这里改', tE.editText('sE', { key: '/', before: 'x', after: 'y' }).reason === 'not-file')

// 预览服务器被关了（开的太多，旧的先关）：轮询状态时发现没了就重开，地址换成新的
{
  const live = new Set()
  let port = 50000
  let taken = false // 原来的端口被别人占了
  const asked = []
  const tR = createTracker({
    open: async (_t, opts = {}) => {
      asked.push(opts.port || 0)
      const o = `http://127.0.0.1:${opts.port && !taken ? opts.port : ++port}`
      live.add(o)
      return { origin: o }
    },
    alive: (o) => live.has(o),
  })
  await tR.setTarget('sR', parseTarget(path.join(editDir, 'a.html')), { source: 'tool' })
  const first = tR.snapshot('sR').origin
  check('重开：服务器还在时地址不变', tR.snapshot('sR').origin === first)
  live.delete(first)
  tR.snapshot('sR')
  await wait()
  check('重开：先要原来的端口，地址不变', asked.at(-1) === Number(new URL(first).port) && tR.snapshot('sR').origin === first, JSON.stringify(asked))
  live.delete(first)
  taken = true
  tR.snapshot('sR')
  await wait()
  const s2 = tR.snapshot('sR')
  check('重开：原来的端口要不到 → 换成新地址', s2.origin !== first && live.has(s2.origin) && s2.url.startsWith(s2.origin + '/') && s2.screens.every((x) => x.url.startsWith(s2.origin)), JSON.stringify(s2))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
