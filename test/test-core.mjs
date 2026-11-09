/**
 * 地址解析 + 自动发现的测试（不用开 DSH）：
 *   node test/test-core.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTracker, parseTarget, fromBashPath, serverUrlIn, devServerIn, replaceText, setStyle, mergeStyle, cleanCss, urlFor, labelOf, parseKind, parseSize, listScreens, allScreens, findRule } from '../lib/core.js'

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
// 设计目录一屏一个文件、没有 index.html：开最先做的那屏（_ 开头的草稿 / 探针不算）
const flow = path.join(tmp, 'flow')
fs.mkdirSync(flow)
fs.writeFileSync(path.join(flow, '_probe.html'), 'x')
fs.writeFileSync(path.join(flow, 'home.html'), 'x')
await new Promise((r) => setTimeout(r, 20))
fs.writeFileSync(path.join(flow, 'about.html'), 'x')
t = parseTarget(flow)
check('目录没有 index.html → 开最先做的那屏', t.kind === 'file' && t.file === path.join(flow, 'home.html') && t.root === flow, JSON.stringify(t))
const empty = path.join(tmp, 'empty')
fs.mkdirSync(empty)
fs.writeFileSync(path.join(empty, 'a.txt'), 'x')
check('目录里一个 HTML 都没有 → 说清楚', /没有 HTML 文件/.test(throws(() => parseTarget(empty))))
if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
  const locked = path.join(tmp, 'locked')
  fs.mkdirSync(locked)
  fs.writeFileSync(path.join(locked, 'x.html'), 'x')
  fs.chmodSync(locked, 0o000)
  const msg = throws(() => parseTarget(locked))
  fs.chmodSync(locked, 0o755)
  check('目录读不了 → 说没有权限，不说「没有 HTML」', /读不了这个文件夹（没有权限）/.test(msg), msg)
}
// 文件名里本来就带 %（「浏览…」选的、拖进来的都是原样路径）：原样存在就别按网址解
const pct = path.join(tmp, 'a%20b.html')
fs.writeFileSync(pct, 'x')
t = parseTarget(pct)
check('文件名带 %20 而且原样存在 → 开它，不解成空格', t.kind === 'file' && t.file === pct, JSON.stringify(t))
fs.writeFileSync(path.join(tmp, 'c d.html'), 'x')
t = parseTarget(`"${pct}"`)
check('整串带一对引号（Windows「复制为路径」）→ 去掉引号照样打开', t.kind === 'file' && t.file === pct, JSON.stringify(t))
t = parseTarget(path.join(tmp, 'c%20d.html'))
check('原样不存在 → 照旧按网址解（%20 → 空格）', t.kind === 'file' && t.file === path.join(tmp, 'c d.html'), JSON.stringify(t))
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
{
  const s0 = tracker.snapshot(SID)
  check('回合开始 → 带上这一轮干了多久（turnFor）、还没调工具', typeof s0.turnFor === 'number' && s0.turnFor >= 0 && s0.turnFor < 5000 && s0.tool === '', JSON.stringify({ f: s0.turnFor, t: s0.tool }))
}
write(index)
check('调着工具 → tool 是工具名（状态条说正在干什么）', tracker.snapshot(SID).tool === 'write')
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
check('没说改了哪些 → changedFiles 是空的', Array.isArray(tracker.snapshot(SID).changedFiles) && tracker.snapshot(SID).changedFiles.length === 0)
tracker.changed(site, ['style.css', 'img/a.png', 3])
check('改了哪些文件跟着状态带给右侧栏（远程看按它重新打包）', JSON.stringify(tracker.snapshot(SID).changedFiles) === '["style.css","img/a.png"]')
tracker.changed(site, ['a.html'])
tracker.changed(site, ['b.html'])
{
  const ch = tracker.snapshot(SID).changes
  const last = ch.slice(-2)
  check('两次轮询之间来了两批改动：两批都记着（带递增序号）', last.length === 2 && last[0].files[0] === 'a.html' && last[1].files[0] === 'b.html' && last[1].n === last[0].n + 1, JSON.stringify(ch))
  for (let i = 0; i < 30; i++) tracker.changed(site, ['x.css'])
  check('改动记录只留最近 20 批', tracker.snapshot(SID).changes.length === 20)
  tracker.changed(site, Array.from({ length: 51 }, (_, i) => `f${i}.css`))
  check('一批改了 51 个文件：不列（空的 = 整屏刷新，别只列一半漏掉）', tracker.snapshot(SID).changedFiles.length === 0 && tracker.snapshot(SID).changes.slice(-1)[0].files.length === 0)
}

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

// 模型用提问卡问用户：等回答时右侧栏不转圈；答完接着干活
ev('tool/call', { callId: 'ask1', name: 'ask_user_question', arguments: JSON.stringify({ questions: [] }) })
check('模型问了用户 → asking', tracker.snapshot(SID).asking === true)
result('答：温暖手作', undefined, 'ask1')
check('用户答完 → 不再 asking', tracker.snapshot(SID).asking === false)
ev('tool/call', { callId: 'ask2', name: 'ask_user_question', arguments: '{}' })
ev('turn/end', { reason: { kind: 'completed' } })
check('回合结束（比如用户点了停止）→ 不再 asking', tracker.snapshot(SID).asking === false)
check('回合结束 → 不再计时、没有正在调的工具', tracker.snapshot(SID).turnFor === 0 && tracker.snapshot(SID).tool === '')
check('干完一轮 → turns 加一（右侧栏靠它自动体检）', tracker.snapshot(SID).turns === 1, tracker.snapshot(SID).turns)
check('回合结束 → turn=false', tracker.snapshot(SID).turn === false)

// ── 模型边说边推的流（agent/assistant-stream）：写大文件的参数还在路上，状态条就知道在写哪个文件 ──
{
  const tk = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:41999' }) })
  const S2 = 'stream1'
  const o = (type, data) => tk.observe(S2, { type, time: Date.now(), data: { turn: 1, ...data } })
  const fr = (frame) => tk.stream(S2, frame)
  const delta = (index, argumentsDelta, name) => fr({ type: 'chunk', chunk: { type: 'tool-call-delta', index, id: 'c' + index, ...(name ? { name } : {}), argumentsDelta } })
  const snap = () => tk.snapshot(S2)
  const jp = (p) => JSON.stringify(p).slice(1, -1) // 参数里的路径是 JSON 转义过的（Windows 的 \ 变 \\）
  tk.stream(S2, { type: 'start' })
  delta(0, '{"file_path":"/x/a.html"', 'write')
  check('流：回合没开始 → 不理', snap().tool === '' && snap().writing === '')
  o('turn/start', {})
  fr({ type: 'start' })
  fr({ type: 'chunk', chunk: { type: 'reasoning-delta', index: 0, text: '想想配色' } })
  check('流：模型在想 → 没有工具、没在写', snap().tool === '' && snap().writing === '' && snap().lines === 0)
  const first = path.join(tmp, 'gen', 'menu.html')
  delta(1, '{"file_path":"' + jp(first).slice(0, 5), 'write')
  check('流：工具名先到 → tool 是 write，文件名还没到', snap().tool === 'write' && snap().writing === '', JSON.stringify(snap()))
  delta(1, jp(first).slice(5) + '","content":"<html>\\n<bo')
  check('流：文件名到了（还没有设计）→ writing 是它', snap().writing === 'menu.html', JSON.stringify(snap()))
  delta(1, '<p>\\n<p>\\')
  delta(1, 'n<p>\\n')
  delta(1, '<li>\\n'.repeat(10))
  check('流：数写了几行（JSON 里的 \\n，跨块切开的也算）', snap().lines === 14, snap().lines)
  fr({ type: 'end' })
  o('tool/call', { callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: first, content: 'x' }) })
  check('流结束、工具真开始跑 → 还说在写它', snap().writing === 'menu.html' && snap().tool === 'write')
  o('tool/result', { message: { content: [], toolCallId: 'w1' } })
  check('写完 → writing、行数都清掉', snap().writing === '' && snap().lines === 0 && snap().tool === '')
  await tk.setTarget(S2, parseTarget(index), { source: 'tool' })
  fr({ type: 'start' })
  delta(0, '{"path":"' + jp(path.join(tmp, 'elsewhere', 'b.html')) + '","content":"\\n\\n', 'edit')
  check('流：写的是别处的文件（不在这套设计里）→ 不说在写它', snap().tool === 'edit' && snap().writing === '', JSON.stringify(snap()))
  delta(1, '{"file_path":"' + jp(path.join(site, 'about.html')) + '","content":"', 'write')
  check('流：同一步里第二个工具写设计里的文件 → writing 跟它', snap().writing === 'about.html' && snap().target && snap().target.kind === 'file', JSON.stringify(snap()))
  fr({ type: 'start' })
  check('流：模型重来一次（新 attempt）→ 清回「在想」', snap().writing === '' && snap().tool === '')
  delta(0, '{"command":"ls"}', 'bash')
  check('流：别的工具 → 只给工具名', snap().tool === 'bash' && snap().writing === '')
  delta(2, '{"file_path":"' + jp(path.join(site, 'x.html')) + '"', 'write')
  o('turn/end', { reason: { kind: 'completed' } })
  check('流：回合结束 → 全清', snap().writing === '' && snap().tool === '' && snap().lines === 0)
  tk.stream('', { type: 'start' })
  tk.stream(S2, null)
  tk.stream(S2, { type: 'chunk' })
  check('流：缺东西的帧 → 不抛', true)
}

// ── 边写边看：write 的内容一边流，一边攒成草稿给预览服务器 ──
{
  const { createDrafts } = await import('../lib/draft.js')
  const drafts = createDrafts()
  const opens = []
  const tk = createTracker({ open: async (t) => { opens.push(t); return { origin: 'http://127.0.0.1:42000' } }, drafts })
  const S3 = 'draft1'
  const o = (type, data) => tk.observe(S3, { type, time: Date.now(), data: { turn: 1, ...data } })
  const fr = (frame) => tk.stream(S3, frame)
  const delta = (index, argumentsDelta, name) => fr({ type: 'chunk', chunk: { type: 'tool-call-delta', index, id: 'd' + index, ...(name ? { name } : {}), argumentsDelta } })
  const snap = () => tk.snapshot(S3)
  const jp = (p) => JSON.stringify(p).slice(1, -1)
  const gen = path.join(tmp, 'gen2')
  const menu = path.join(gen, 'menu.html')
  skill(tk, S3)
  o('turn/start', {})
  fr({ type: 'start' })
  delta(0, '{"file_path":"' + jp(menu) + '","con', 'write')
  check('草稿：路径到了、正文还没开头 → 还没有草稿', snap().draft === null && !drafts.get(menu))
  delta(0, 'tent":"<!doctype html>\n<h1>巷口')
  await wait()
  const d1 = snap().draft
  check('草稿：正文开头一到 → 给这个文件夹开预览服务器，快照里带草稿地址（名字和屏的 key 一样）', !!d1 && d1.key === 'menu.html' && d1.url === 'http://127.0.0.1:42000/menu.html?__ddp_draft=1' && opens.length === 1 && opens[0].root === gen, JSON.stringify({ d1, opens }))
  check('草稿：内容是还原过的（JSON 转义变回换行）', drafts.get(menu).text === '<!doctype html>\n<h1>巷口', JSON.stringify(drafts.get(menu).text))
  delta(0, '\\u9762\\u9986</h1>\\n')
  delta(0, '<p>\\"好吃\\"</p>"}')
  check('草稿：后面的一截截接上（\\u 转义、引号），收尾引号一到就算写完', drafts.get(menu).text === '<!doctype html>\n<h1>巷口面馆</h1>\n<p>"好吃"</p>' && drafts.get(menu).done === true, JSON.stringify(drafts.get(menu)))
  fr({ type: 'end' })
  o('tool/call', { callId: 'wd', name: 'write', arguments: JSON.stringify({ file_path: menu, content: 'x' }) })
  o('tool/result', { message: { content: [], toolCallId: 'wd' } })
  check('草稿：写完、工具跑完 → 快照里还留着（真文件出来前右侧栏接着显示它）', !!snap().draft && snap().draft.key === 'menu.html')
  fr({ type: 'start' })
  check('草稿：下一次开口 → 清掉', snap().draft === null)
  delta(0, '{"file_path":"' + jp(path.join(gen, '_probe.html')) + '","content":"<p>', 'write')
  delta(2, '{"file_path":"' + jp(menu) + '","old_string":"a","new_string":"<p>', 'edit')
  check('草稿：_ 开头的探针、局部修改（edit）→ 都不开', snap().draft === null && !drafts.get(path.join(gen, '_probe.html')))
  fr({ type: 'start' })
  const cart = path.join(gen, 'cart.html')
  delta(0, '{"file_path":"' + jp(cart) + '","content":"<p>半截', 'write')
  await wait()
  check('草稿：第二屏也开（同一个预览服务器）', snap().draft && snap().draft.key === 'cart.html' && /\/cart\.html\?__ddp_draft=2$/.test(snap().draft.url))
  o('turn/end', { reason: { kind: 'interrupted' } })
  check('草稿：回合结束（比如点了停止）→ 快照不带了，在看的那头收尾', snap().draft === null && drafts.get(cart).done === true)

  // 不是在做设计的会话：写网页也不开
  const S4 = 'plain1'
  const opened0 = opens.length
  tk.observe(S4, { type: 'turn/start', time: Date.now(), data: { turn: 1 } })
  tk.stream(S4, { type: 'start' })
  tk.stream(S4, { type: 'chunk', chunk: { type: 'tool-call-delta', index: 0, id: 'p', name: 'write', argumentsDelta: '{"file_path":"' + jp(path.join(tmp, 'plain', 'index.html')) + '","content":"<p>' } })
  check('草稿：不是在做设计的会话 → 不开（不乱开预览服务器）', tk.snapshot(S4).draft === null && opens.length === opened0)
  tk.stream(S4, { type: 'chunk', chunk: { type: 'tool-call-delta', index: 0, argumentsDelta: '\\n<head><meta name=\\"dsh-design\\" content=\\"app\\">' } })
  await wait()
  check('草稿：页面开头自己带了设计类型标记 → 也开', !!tk.snapshot(S4).draft && opens.length === opened0 + 1, JSON.stringify(tk.snapshot(S4).draft))

  // 已经在看一套设计：在它文件夹里写新的一屏 → 用它的预览服务器
  const S5 = 'draft2'
  await tk.setTarget(S5, parseTarget(index), { source: 'tool' })
  const opened1 = opens.length
  tk.observe(S5, { type: 'turn/start', time: Date.now(), data: { turn: 1 } })
  tk.stream(S5, { type: 'start' })
  tk.stream(S5, { type: 'chunk', chunk: { type: 'tool-call-delta', index: 0, id: 'q', name: 'write', argumentsDelta: '{"file_path":"' + jp(path.join(site, '关于 我们.html')) + '","content":"<p>' } })
  const d5 = tk.snapshot(S5).draft
  check('草稿：已有设计 → 用它的预览地址，文件名照样编码', !!d5 && d5.key === '关于 我们.html' && d5.url.startsWith(`${tk.snapshot(S5).origin}/${encodeURIComponent('关于 我们.html')}?__ddp_draft=`) && opens.length === opened1, JSON.stringify(d5))
  tk.stream(S5, { type: 'start' })
  tk.stream(S5, { type: 'chunk', chunk: { type: 'tool-call-delta', index: 0, id: 'r', name: 'write', argumentsDelta: '{"file_path":"' + jp(path.join(site, 'parts', 'card.html')) + '","content":"<p>' } })
  check('草稿：已有设计、写的是它子文件夹里的（不算一屏）→ 不开', tk.snapshot(S5).draft === null && !drafts.get(path.join(site, 'parts', 'card.html')))

  // 一条流里交错出现很多别的工具：在写的页面不被挤掉
  const S7 = 'evict1'
  skill(tk, S7)
  tk.observe(S7, { type: 'turn/start', time: Date.now(), data: { turn: 1 } })
  tk.stream(S7, { type: 'start' })
  const ev = path.join(gen, 'evict.html')
  const d7 = (index, argumentsDelta, name) => tk.stream(S7, { type: 'chunk', chunk: { type: 'tool-call-delta', index, id: 'e' + index, ...(name ? { name } : {}), argumentsDelta } })
  d7(0, '{"file_path":"' + jp(ev) + '","content":"<p>a', 'write')
  await wait()
  for (let i = 1; i <= 17; i++) d7(i, '{"path":"x"}', 'read')
  d7(0, 'b</p>"}')
  check('草稿：中间插了 17 个别的工具 → 在写的页面不被挤掉，后面的照样接上、收尾', !!drafts.get(ev) && drafts.get(ev).text === '<p>ab</p>' && drafts.get(ev).done === true, JSON.stringify(drafts.get(ev)))
  // 同一个文件写了两遍：挤掉写完的第一遍时，不能把正在写的第二遍也收了
  tk.stream(S7, { type: 'start' })
  const tw2 = path.join(gen, 'twice.html')
  d7(0, '{"file_path":"' + jp(tw2) + '","content":"<p>old</p>"}', 'write')
  d7(1, '{"file_path":"' + jp(tw2) + '","content":"<p>new', 'write')
  await wait()
  for (let i = 2; i <= 17; i++) d7(i, '{"path":"x"}', 'read')
  d7(1, ' complete</p>"}')
  check('草稿：同一个文件重写、旧的那份被挤掉 → 新的这份不被提前收尾，正文写全', !!drafts.get(tw2) && drafts.get(tw2).text === '<p>new complete</p>' && drafts.get(tw2).done === true, JSON.stringify(drafts.get(tw2)))
}

// ── 边写边看：有的模型（DeepSeek V4.1）把正文排在文件名前面，文件名最后才到 ──
{
  const { createDrafts } = await import('../lib/draft.js')
  const drafts = createDrafts()
  const opens = []
  const tk = createTracker({ open: async (t) => { opens.push(t); return { origin: 'http://127.0.0.1:42100' } }, drafts })
  const S6 = 'late1'
  const o = (type, data) => tk.observe(S6, { type, time: Date.now(), data: { turn: 1, ...data } })
  const fr = (frame) => tk.stream(S6, frame)
  const delta = (index, argumentsDelta, name) => fr({ type: 'chunk', chunk: { type: 'tool-call-delta', index, id: 'l' + index, ...(name ? { name } : {}), argumentsDelta } })
  const snap = () => tk.snapshot(S6)
  const jp = (p) => JSON.stringify(p).slice(1, -1)
  const gen = path.join(tmp, 'gen3')
  fs.mkdirSync(gen, { recursive: true })
  const menu = path.join(gen, 'menu.html')
  skill(tk, S6)
  o('turn/start', {})
  fr({ type: 'start' })
  delta(0, '{"content":"<!DOCTYPE html>\\n<html lang=\\"zh\\">\\n<head>\\n<meta name=\\"dsh-design\\" content=\\"app\\">', 'write')
  check('正文先到：还不知道写在哪个文件夹（这一轮还没写过东西、也没有设计）→ 先不开草稿', snap().draft === null && opens.length === 0, JSON.stringify(snap().draft))
  delta(0, '\\n<title>菜单</title>","file_path":"' + jp(path.join(gen, 'first.html')) + '"}')
  check('正文先到：没开草稿也跟着认出了最后的文件名', snap().writing === 'first.html', snap().writing)
  fr({ type: 'start' })
  delta(0, '{"file_path":"' + jp(path.join(gen, 'tokens.css')) + '","content":":root{}"}', 'write')
  fr({ type: 'start' })
  delta(0, '{"content":"<!DOCTYPE html>\\n<html lang=\\"zh\\">\\n<head>\\n<meta name=\\"dsh-design\\" content=\\"app\\">\\n<title>菜单', 'write')
  await wait()
  const d = snap().draft
  const prov = path.join(gen, '__ddp_draft_1__.html')
  check('正文先到：上一个文件写在哪就挂在哪（临时名字，key 空着）', !!d && d.key === '' && d.url === 'http://127.0.0.1:42100/__ddp_draft_1__.html?__ddp_draft=1' && opens.length === 1 && opens[0].root === gen, JSON.stringify({ d, opens }))
  check('正文先到：草稿内容照样还原', drafts.get(prov) && drafts.get(prov).text === '<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta name="dsh-design" content="app">\n<title>菜单', JSON.stringify(drafts.get(prov)))
  check('正文先到：行数照数、不知道文件名', snap().lines === 4 && snap().writing === '', JSON.stringify(snap()))
  delta(0, '</title>\\n</head>\\n<body>菜单</body>\\n</html>","file_')
  check('正文先到：正文写完 → 草稿收尾；文件名还没到全', drafts.get(prov).done === true && snap().draft.key === '' && snap().writing === '')
  delta(0, 'path":"' + jp(menu) + '"}')
  const d2 = snap().draft
  check('正文先到：文件名到了 → key 对上真名字，地址不变（在看的不用重载）', d2 && d2.key === 'menu.html' && d2.url === d.url && snap().writing === 'menu.html', JSON.stringify(d2))
  fr({ type: 'end' })
  o('tool/call', { callId: 'lw', name: 'write', arguments: JSON.stringify({ content: 'x', file_path: menu }) })
  fs.writeFileSync(menu, '<!DOCTYPE html><p>菜单</p>')
  o('tool/result', { message: { content: [], toolCallId: 'lw' } })
  fr({ type: 'start' })
  check('写完落了地的草稿：下一次开口还留着（右侧栏靠它认出新屏），没落地的照样清', !!snap().draft && snap().draft.key === 'menu.html')
  delta(0, '{"content":"<!DOCTYPE html>\\n<html>\\n<head>\\n<meta name=\\"dsh-design\\" content=\\"app\\">\\n<title>零件</title>', 'write')
  await wait()
  check('正文先到的第二份：新开一份（临时名字不撞）', snap().draft && snap().draft.key === '' && /__ddp_draft_2__\.html/.test(snap().draft.url), JSON.stringify(snap().draft))
  delta(0, '</head></html>","file_path":"' + jp(path.join(gen, 'parts', 'card.html')) + '"}')
  check('正文先到、最后发现写的是子文件夹里的（不是一屏）→ 草稿作废，临时地址也读不到了', snap().draft === null && drafts.get(path.join(gen, '__ddp_draft_2__.html')) === null, JSON.stringify(snap().draft))
  fr({ type: 'start' })
  delta(1, '{"content":"body{margin:0}\\n.a{}\\n.b{}\\n', 'write')
  check('正文先到的不是网页（样式表）→ 不开草稿，行数照数', snap().draft === null && snap().lines === 3 && snap().writing === '', JSON.stringify(snap()))
  delta(1, '.c{}","file_path":"' + jp(path.join(gen, 'app.css')) + '"}')
  check('正文先到的样式表写完 → 认出文件名', snap().writing === 'app.css', snap().writing)
  fr({ type: 'start' })
  delta(0, '{"content":"<!doctype html><meta name=\\"dsh-design\\" content=\\"app\\"><p>一口气</p>","file_path":"' + jp(path.join(gen, 'one.html')) + '"}', 'write')
  await wait()
  const one = snap().draft
  const oneAbs = path.join(gen, 'one.html')
  check('正文先到、一块就全到了 → 名字也在这块里：直接挂真名字，写完了', one && one.key === 'one.html' && /\/one\.html\?__ddp_draft=/.test(one.url) && drafts.get(oneAbs) && drafts.get(oneAbs).done === true && drafts.get(oneAbs).text === '<!doctype html><meta name="dsh-design" content="app"><p>一口气</p>', JSON.stringify({ one, t: drafts.get(oneAbs) }))
  check('一块就全到了 → 快照说草稿还 live（刚写完，右侧栏这时看到要放一遍）', one && one.live === true, JSON.stringify(one))
  check('快照带上页面开头写的设计类型（真文件还没摆出来时套对外框）', one && one.meta === 'app', JSON.stringify(one))
  check('一块就全到了、但很短 → 不算整段到的（lump 假，不用放完再换）', one && one.lump === false, JSON.stringify(one))
  drafts.get(oneAbs).lump = true
  check('整段一下子到的（draft.js 记着 lump）→ 快照 lump 真', snap().draft && snap().draft.lump === true, JSON.stringify(snap().draft))
  drafts.get(oneAbs).endAt = Date.now() - 9000
  check('写完好一阵了 → 不 live（右侧栏中途才打开不补放）', snap().draft && snap().draft.live === false, JSON.stringify(snap().draft))
  fr({ type: 'start' })
  delta(0, '{"content":"<!doctype html>\\n<p>一个普通网页，开头很长' + 'x'.repeat(3100), 'write')
  check('正文先到、开头三千字都没有设计标记（不在做设计的会话也会这样写）→ 有 skill 加载过时照样算设计', !!snap().draft)
  delta(0, 'y'.repeat(20000) + '</p>","file_')
  delta(0, 'path":"' + jp(path.join(gen, 'big.html')) + '"}')
  check('正文先到、最后一大块两万字连着收尾 → 文件名在下一块才到也认得出', snap().writing === 'big.html' && !!snap().draft && snap().draft.key === 'big.html', JSON.stringify({ w: snap().writing, d: snap().draft }))
  await tk.setTarget(S6, parseTarget(index), { source: 'tool' })
  check('换到别的目录的设计 → 原来那套的草稿不再报', snap().draft === null, JSON.stringify(snap().draft))
  o('turn/end', { reason: { kind: 'completed' } })
  check('回合结束 → 草稿清掉', snap().draft === null)

  // 交错写两份「正文先到」的：右侧栏已经在看第二份，第一份最后发现写的是子文件夹里的 → 第一份照样作废，第二份不受影响
  const S10 = 'prov2'
  skill(tk, S10)
  tk.observe(S10, { type: 'turn/start', time: Date.now(), data: { turn: 1 } })
  const f10 = (index, argumentsDelta, name) => tk.stream(S10, { type: 'chunk', chunk: { type: 'tool-call-delta', index, id: 'v' + index, ...(name ? { name } : {}), argumentsDelta } })
  tk.stream(S10, { type: 'start' })
  f10(0, '{"file_path":"' + jp(path.join(gen, 't.css')) + '","content":"a{}"}', 'write')
  tk.stream(S10, { type: 'start' })
  const HEAD = '{"content":"<!DOCTYPE html>\\n<html lang=\\"zh\\">\\n<head>\\n<meta name=\\"dsh-design\\" content=\\"app\\">\\n<title>'
  f10(0, HEAD + '甲', 'write')
  f10(1, HEAD + '乙', 'write')
  await wait()
  const v10 = tk.snapshot(S10).draft
  const nB = Number((/__ddp_draft_(\d+)__/.exec((v10 && v10.url) || '') || [])[1])
  const provA = path.join(gen, `__ddp_draft_${nB - 1}__.html`)
  check('交错两份：右侧栏看的是后开的那份', nB > 1 && !!drafts.get(provA), JSON.stringify(v10))
  f10(0, '</title></head></html>","file_path":"' + jp(path.join(gen, 'parts', 'x.html')) + '"}')
  check('交错两份：前一份是子文件夹里的 → 作废（临时地址读不到），在看的后一份不动', drafts.get(provA) === null && tk.snapshot(S10).draft && tk.snapshot(S10).draft.url === v10.url, JSON.stringify(tk.snapshot(S10).draft))
}

// 屏数上限（#12）：最多显示 60 屏，留最新的，正打开的那屏始终在，收起了几屏要报
{
  const dir = fs.mkdtempSync(path.join(tmp, 'many-'))
  const stamp = 1700000000
  for (let i = 1; i <= 65; i++) {
    const f = path.join(dir, `s${String(i).padStart(2, '0')}.html`)
    fs.writeFileSync(f, '<p>x')
    // 创建时间在有的系统改不了，文件名兜底时顺序也一样
    fs.utimesSync(f, stamp + i, stamp + i)
  }
  const shown = listScreens(dir)
  check('超过上限：只留 60 屏', shown.length === 60, String(shown.length))
  check('超过上限：最新的在，最早的收起', shown.includes('s65.html') && !shown.includes('s05.html'), shown.slice(0, 2).join())
  check('按文件名找、改全套：收起的也算', allScreens(dir).length === 65 && allScreens(dir).includes('s01.html'))
  const listedDir = fs.mkdtempSync(path.join(tmp, 'listed-'))
  const stems = Array.from({ length: 65 }, (_, i) => `s${String(i + 1).padStart(2, '0')}.html`)
  for (const f of stems) fs.writeFileSync(path.join(listedDir, f), '<p>x')
  fs.writeFileSync(path.join(listedDir, 'design.json'), JSON.stringify({ screens: stems.slice(5).reverse() }))
  const listed = listScreens(listedDir)
  check('有清单也是留最新的，顺序按清单', listed.length === 60 && listed[0] === 's65.html' && !listed.includes('s01.html'), listed.slice(0, 2).join())
  const keptOld = listScreens(listedDir, 's01.html')
  check('留着正打开的旧屏：挤掉最早的，不挤掉最新的', keptOld.length === 60 && keptOld.includes('s01.html') && keptOld.includes('s65.html') && !keptOld.includes('s06.html'), keptOld.slice(0, 2).join())
  const tk = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:42200' }) })
  await tk.setTarget('many', { kind: 'file', file: path.join(dir, 's65.html'), root: dir }, { source: 'tool' })
  let snap = tk.snapshot('many')
  check('超过上限：快照报收起了 5 屏', snap.hidden === 5 && snap.maxScreens === 60 && snap.screens.length === 60, `${snap.hidden}/${snap.screens.length}`)
  await tk.setTarget('many', { kind: 'file', file: path.join(dir, 's01.html'), root: dir }, { source: 'tool' })
  snap = tk.snapshot('many')
  check('打开被收起的那屏：它显示出来，总数还是 60', snap.screens.some((x) => x.key === 's01.html') && snap.screens.length === 60 && snap.hidden === 5, `${snap.hidden}/${snap.screens.length}`)
  const few = fs.mkdtempSync(path.join(tmp, 'few-'))
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(few, `f${i}.html`), '<p>x')
  await tk.setTarget('few', { kind: 'file', file: path.join(few, 'f24.html'), root: few }, { source: 'tool' })
  snap = tk.snapshot('few')
  check('25 屏全部显示，不提示', snap.screens.length === 25 && snap.hidden === 0, `${snap.hidden}/${snap.screens.length}`)
  const routes = Array.from({ length: 70 }, (_, i) => `/r${i}`)
  await tk.setTarget('dev', { kind: 'proxy', port: 5173, path: '/r65' }, { source: 'tool', routes })
  snap = tk.snapshot('dev')
  check('路由超过上限：60 个，正看的在，报收起 10 个', snap.screens.length === 60 && snap.screens.some((x) => x.key === '/r65') && snap.hidden === 10, `${snap.hidden}/${snap.screens.length}`)
}

// 重放历史：老事件不动手
const t2 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:1' }) })
const old = Date.now() - 600e3
t2.observe('s2', { type: 'turn/start', time: old, data: { turn: 1 } })
t2.observe('s2', { type: 'tool/call', time: old, data: { turn: 1, name: 'write', arguments: JSON.stringify({ file_path: index }) } })
t2.observe('s2', { type: 'tool/result', time: old, data: { turn: 1, message: { content: [{ type: 'text', text: 'http://localhost:5173' }] } } })
await wait()
t2.observe('s2', { type: 'turn/end', time: old, data: { turn: 1 } })
check('重放历史 → 不自动预览、不显示在干活', t2.snapshot('s2').target === null && t2.snapshot('s2').turn === false)
check('重放历史的回合不算「又干完一轮」', t2.snapshot('s2').turns === 0)

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
t5.observe('s5', { type: 'tool/result', time: Date.now(), data: { meta: { cwd: '/proj/shop' }, message: { toolCallId: 'x', content: [] } } })
check('存盘：会话目录也记下（跑过工具后补上）', mem.data.s5.cwd === '/proj/shop', JSON.stringify(mem.data.s5))
const t6 = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:6' }), store: mem })
check('重启后还没跑工具：会话目录用存盘里的', t6.cwdOf('s5') === '/proj/shop' && t6.cwdOf('nobody') === os.homedir())
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
  // 用户关了「自动打开预览」：在做设计也不自动打开，写的网页给个按钮；开发服务器也不自动打开
  let on = false
  const tA = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:12' }), autoOpen: () => on })
  skill(tA, 'sA')
  const call = (id, name, args) => tA.observe('sA', { type: 'tool/call', time: Date.now(), data: { callId: id, name, arguments: JSON.stringify(args) } })
  const res = (id, text) => tA.observe('sA', { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
  call('w', 'write', { file_path: other })
  res('w', 'ok')
  call('d', 'bash', { command: 'npx vite' })
  res('d', 'Local: http://localhost:5199/')
  await wait()
  const a = tA.snapshot('sA')
  check('关了自动打开 → 不打开，写的网页给按钮', a.target === null && a.openRev === 0 && a.hint === other, JSON.stringify(a))
  on = true
  call('w2', 'write', { file_path: other })
  res('w2', 'ok')
  await wait()
  check('再打开 → 照常自动打开', tA.snapshot('sA').target && tA.snapshot('sA').target.file === other)
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
check('类型：小程序和它的别名（miniapp 以前算 App）', ['miniprogram', 'MiniProgram', '小程序', 'weapp', 'miniapp', 'wechat'].every((k) => parseKind(k) === 'miniprogram'))
check('类型：桌面软件和它的别名；dashboard 还是网页', ['desktop', 'Desktop', '桌面软件', 'electron', 'tauri', 'windows', 'mac'].every((k) => parseKind(k) === 'desktop') && parseKind('dashboard') === 'web')
check('尺寸：x / × 都认', parseSize('1080x1920') === '1080x1920' && parseSize(' 1080 × 1350 ') === '1080x1350')
check('尺寸：太小 / 乱写 → 空', parseSize('10x10') === '' && parseSize('big') === '')

const appDir = path.join(tmp, 'app')
fs.mkdirSync(appDir)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const f of ['login.html', 'home.html', 'detail.html']) { fs.writeFileSync(path.join(appDir, f), '<p>' + f); await sleep(15) }
fs.writeFileSync(path.join(appDir, 'app.css'), 'p{}')
fs.writeFileSync(path.join(appDir, '.draft.html'), 'x')
fs.writeFileSync(path.join(appDir, '_probe.html'), 'x')
check('几屏：只要 HTML、跳过隐藏文件和 _ 开头的临时文件、按创建顺序', JSON.stringify(listScreens(appDir)) === JSON.stringify(['login.html', 'home.html', 'detail.html']), JSON.stringify(listScreens(appDir)))

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
// 开局的三个方向：c 比 b 先写完，画布上照样排成 a、b、c
for (const f of ['dir-a.html', 'dir-c.html', 'dir-b.html']) {
  await sleep(15)
  fs.writeFileSync(path.join(appDir, f), `<p>${f}`)
  t7.changed(appDir)
}
check('三个方向不管谁先写完，都按 a、b、c 挨着排', t7.snapshot('s7').screens.map((x) => x.key).slice(-3).join(',') === 'dir-a.html,dir-b.html,dir-c.html', t7.snapshot('s7').screens.map((x) => x.key).join(','))
for (const f of ['dir-a.html', 'dir-b.html', 'dir-c.html']) fs.rmSync(path.join(appDir, f))
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
{
  let ran = 0
  const n0 = snaps.length
  const moved = tE.editDir('sE', () => { ran++; return { ok: true, files: ['x'] } }, '调节', path.join(tmp, 'another-design'))
  check('调节写回：右侧栏看的是另一套设计（中途换了）→ 不写', moved.ok === false && moved.reason === 'moved' && ran === 0 && snaps.length === n0, JSON.stringify(moved))
  const same = tE.editDir('sE', (root) => { ran++; return { ok: root === editDir, files: ['x'] } }, '调节', editDir)
  check('调节写回：还是同一套 → 写，存版本', same.ok === true && ran === 1 && snaps.length === n0 + 2)
  check('快照里带设计目录（右侧栏写回时带上）', tE.snapshot('sE').target.root === editDir)
}
await tE.setTarget('sE', parseTarget('5173'), { source: 'tool' })
check('改字：开发服务器不在这里改', tE.editText('sE', { key: '/', before: 'x', after: 'y' }).reason === 'not-file')

// ── 调样式：找到元素的开头标签，并进 style 属性 ──
const page = '<!doctype html><head><style>.btn{}</style><script>if (a<b) document.write("<button class=btn>")</script></head><body>' +
  '<!-- <button class="btn primary"> --><button class="btn primary">A</button>\n<button\n  class="btn" style="color: red; background-image: url(data:x;base64,AA)">B</button>' +
  '<template><button class="btn">t</button></template><img src=a.png/><img src="b.png" /></body>'
let ss = setStyle(page, { tag: 'button', n: 0, total: 2, cls: ['btn', 'primary', 'active'] }, { 'border-radius': '16px', 'font-size': '17px' })
check('调样式：按第几个找到，注释 / 脚本 / 模板里的不算；页面脚本加的类不碍事', ss.ok && ss.html.includes('<button class="btn primary" style="border-radius: 16px; font-size: 17px">A'), JSON.stringify(ss))
ss = setStyle(page, { tag: 'button', n: 1, total: 2, cls: ['btn'] }, { background: 'var(--brand)', color: '' })
check('调样式：并进原来的 style，写 background 去掉 background-image，空值 = 去掉那条', ss.ok && ss.html.includes('<button\n  class="btn" style="background: var(--brand)">B'), JSON.stringify(ss))
check('调样式：页面上多了脚本加的元素 → 只认类和 id 完全一样、只有一个的', setStyle(page, { tag: 'button', n: 3, total: 5, cls: ['btn', 'primary'] }, { color: '#fff' }).ok === true &&
  setStyle(page, { tag: 'button', n: 0, total: 5, cls: ['card'] }, { color: '#fff' }).reason === 'not-found')
check('调样式：第几个对上了但类对不上 → 不改', setStyle(page, { tag: 'button', n: 0, total: 2, cls: ['other'] }, { color: '#fff' }).reason === 'not-found')
ss = setStyle(page, { tag: 'img', n: 0, total: 2, cls: [] }, { 'border-radius': '8px' })
check('调样式：src=a.png/ 的 / 是属性值，不当自闭合', ss.ok && ss.html.includes('<img src=a.png/ style="border-radius: 8px">'), JSON.stringify(ss))
ss = setStyle(page, { tag: 'img', n: 1, total: 2, cls: [] }, { 'border-radius': '8px' })
check('调样式：自闭合标签写在 / 前面', ss.ok && ss.html.includes('<img src="b.png" style="border-radius: 8px" />'), JSON.stringify(ss))
check('调样式：只收那几项、值里不许有引号分号尖括号', cleanCss({ color: 'red"><script>', position: 'fixed', 'font-size': '17px', background: 'url(x.png)' }) !== null &&
  JSON.stringify(cleanCss({ color: 'red"><script>', position: 'fixed', 'font-size': '17px', background: 'url(x.png)' })) === '{"font-size":"17px"}' && cleanCss({ position: 'fixed' }) === null)
check('调样式：url(data:…;…) 里的分号不拆', mergeStyle('background: url(data:a;b) ; color: red', { color: 'blue' }) === 'background: url(data:a;b); color: blue')
// Astra 审查的几种：大写 <SCRIPT> 里的字符串、实体、自定义属性大小写、同名的几条
ss = setStyle('<SCRIPT>document.body.innerHTML = "<button class=\'cta\'>买</button>";</SCRIPT><button class="cta">买</button>', { tag: 'button', n: 0, total: 1, cls: ['cta'] }, { color: 'red' })
check('调样式：大写 <SCRIPT> 里的标签也不算', ss.ok && ss.html.startsWith('<SCRIPT>document.body.innerHTML = "<button class=\'cta\'>买</button>";</SCRIPT>') && ss.html.endsWith('<button class="cta" style="color: red">买</button>'), JSON.stringify(ss))
ss = setStyle('<p style="font-family: &quot;Arial Black&quot;; --Brand: #f00; color: var(--Brand)">x</p>', { tag: 'p', n: 0, total: 1 }, { 'font-size': '18px' })
check('调样式：原来 style 里的 &quot; 解开再转义一次，字体名不丢；--Brand 大小写不变', ss.ok && ss.html === '<p style="font-family: &quot;Arial Black&quot;; --Brand: #f00; color: var(--Brand); font-size: 18px">x</p>', JSON.stringify(ss))
check('调样式：同名的几条只留一条（不然后面那条还会盖掉）', mergeStyle('color: red; padding: 4px; color: blue', { color: 'green' }) === 'color: green; padding: 4px')

fs.writeFileSync(path.join(editDir, 'c.html'), '<div class="card"><button class="go">去点单</button></div>')
await tE.setTarget('sE', parseTarget(path.join(editDir, 'c.html')), { source: 'tool' })
snaps.length = 0
er = tE.editStyle('sE', { key: 'c.html', loc: { tag: 'button', n: 0, total: 1, cls: ['go'] }, css: { 'border-radius': '20px' }, name: 'button.go' })
check('调样式：写回文件，改前改后各存一版', er.ok && fs.readFileSync(path.join(editDir, 'c.html'), 'utf8').includes('<button class="go" style="border-radius: 20px">') &&
  JSON.stringify(snaps) === JSON.stringify(['', '调样式「button.go」']), JSON.stringify([er, snaps]))
check('调样式：找不到元素就说找不到（右侧栏改成交给模型）', tE.editStyle('sE', { key: 'c.html', loc: { tag: 'a', n: 0, total: 1 }, css: { color: 'red' } }).reason === 'not-found')
check('调样式：目录外的文件不改', tE.editStyle('sE', { key: '../index.html', loc: { tag: 'p', n: 0, total: 1 }, css: { color: 'red' } }).reason === 'no-screen')
// 别的会话预览同一个目录、它的模型正在干活：这边也不写（会被它整份重写盖掉）
await tE.setTarget('sF', parseTarget(path.join(editDir, 'c.html')), { source: 'tool' })
tE.observe('sF', { type: 'turn/start', time: Date.now(), data: {} })
er = tE.editStyle('sE', { key: 'c.html', loc: { tag: 'button', n: 0, total: 1, cls: ['go'] }, css: { 'border-radius': '4px' } })
check('调样式：同目录别的会话在干活 → busy', er.ok === false && er.reason === 'busy', JSON.stringify(er))
tE.observe('sF', { type: 'turn/end', time: Date.now(), data: {} })
// 经软链接打开同一个目录：也算同一个目录
{
  const link = path.join(path.dirname(editDir), 'edit-link')
  try { fs.symlinkSync(editDir, link, 'dir') } catch { /* Windows 没权限建软链接就跳过 */ }
  if (fs.existsSync(link)) {
    await tE.setTarget('sG', parseTarget(path.join(link, 'c.html')), { source: 'tool' })
    tE.observe('sG', { type: 'turn/start', time: Date.now(), data: {} })
    er = tE.editStyle('sE', { key: 'c.html', loc: { tag: 'button', n: 0, total: 1, cls: ['go'] }, css: { 'border-radius': '4px' } })
    check('调样式：别的会话经软链接开着同一个目录在干活 → busy', er.ok === false && er.reason === 'busy', JSON.stringify(er))
    tE.observe('sG', { type: 'turn/end', time: Date.now(), data: {} })
  }
}
check('调样式：它干完又能写', tE.editStyle('sE', { key: 'c.html', loc: { tag: 'button', n: 0, total: 1, cls: ['go'] }, css: { 'border-radius': '4px' } }).ok === true)

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

// ── 调样式：从浏览器给的选择器找回源文件里的行号 ──
{
  const css = ['/* .title { } 注释里的不算 */', '.card{color:red}', '.card > .title {', '  font-size: 16px', '}', '@media (max-width: 600px) {', '  .card>.title { font-size: 14px }', '}',
    'h1, h2 .sub { margin: 0 }', 'li:nth-of-type(2n+1)::before { content: "" }', '.title { color: blue }', 'a[href="x"] { }'].join('\n')
  check('找行号：子选择器，第 1 条', findRule(css, '.card > .title', 0) === 3, String(findRule(css, '.card > .title', 0)))
  check('找行号：同一个选择器第 2 条（媒体查询里的，空格写法不同）', findRule(css, '.card > .title', 1) === 7)
  check('找行号：选择器列表', findRule(css, 'h1, h2 .sub', 0) === 9)
  check('找行号：伪类 / 伪元素（单冒号双冒号都认）', findRule(css, 'li:nth-of-type(2n+1)::before', 0) === 10 && findRule(css.replace('::before', ':before'), 'li:nth-of-type(2n+1)::before', 0) === 10)
  check('找行号：.title 不会认成 .card > .title 的尾巴，也不认注释里的', findRule(css, '.title', 0) === 11)
  check('找行号：属性选择器引号写法不同也认', findRule(css, 'a[href=x]', 0) === 12 || findRule(css, 'a[href="x"]', 0) === 12)
  check('找行号：找不到给 0', findRule(css, '.nope', 0) === 0 && findRule(css, '.card > .title', 5) === 0)
  const html = '<!doctype html>\n<html><head>\n<style>.go{padding:10px}\nmain .go { font-size: 15px }</style>\n</head><body><main><button class="go">x</button></main></body></html>'
  const t0 = Date.now()
  const evil = findRule('a{}'.repeat(10) + '"'.repeat(20), '[x=' + '""'.repeat(14) + ']', 0)
  check('找行号：一串引号的怪选择器也马上返回（不会卡死）', evil === 0 && Date.now() - t0 < 200, `${Date.now() - t0}ms`)
  check('找行号：大小写照原样比（.btn 不认 .Btn）', findRule('.Btn { }\n.btn { }', '.btn', 0) === 2)
  check('找行号：HTML 里脚本、正文中像 CSS 的字不算', findRule('<script>const s = ".go { x }"</script>\n<p>.go { }</p>\n<style>\n.go { }\n</style>', '.go', 0) === 4)
  check('找行号：字符串里的大括号不打断', findRule('.a::after { content: "{" }\n.b { }', '.b', 0) === 2 && findRule('.a::after { content: "{" }', '.a::after', 0) === 1)
  check('找行号：HTML 里 <style> 里的规则', findRule(html, '.go', 0) === 3 && findRule(html, 'main .go', 0) === 4, `${findRule(html, '.go', 0)} ${findRule(html, 'main .go', 0)}`)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
