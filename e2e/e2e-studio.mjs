/**
 * 设计台真机测试：全新的 DSH 网页版 + 本地「假模型」+ 无头 Chrome，在官方界面里走一遍第一期的功能
 *   ① 打包、装进全新的 DSH
 *   ② 假模型调 preview_page 打开一个三屏的 App 设计 → 右侧栏出画布；再调 check_design → 无头浏览器按真实尺寸量完把清单交回给模型；
 *     严重的问题附上局部截图；调 look_design → 工具结果里带一张真实渲染的截图；
 *     模型用提问卡问用户时，右侧栏提示「在等你回答」，答完就没了
 *   ③ 设计体检：首屏埋了四类问题（点击区、对比度、截断、小字），另两屏干净；点一条会定位；「发到对话」把清单放进输入框，发出去模型收得到
 *   ④ 改好首屏后「再查一次」→ 没问题
 *   ⑤ 导出 PDF / PPT → 设计目录 exports/ 里各一份，三页
 *   ⑥ 首页再出一版 home-b → 紧挨着首页；点它的「用这版」→ 输入框里是〔选定方向〕
 *   ⑦ 调样式：单看菜单屏，点「加入购物车」→ 面板认出它用的设计变量；拖圆角页面上先变，直接保存 → 源码里那个元素带上 style；
 *     再拖字号「发到对话」→ 输入框里是〔调样式〕；退出 → 没写回的改动撤掉
 *   ⑧ 换风格：外观面板「换风格」→ 一排风格卡，点「温暖手作」→ 输入框里是〔风格〕和整套配色
 *   ⑧b 画笔标注：工具栏「画笔标注」→ 在页面上画圈、箭头、写字，撤销 / 重做 →「发到对话」→ refs/ 里一张标注图（页面截图叠着画的），
 *     输入框里是〔标注〕和图的路径，叫模型先用 read_image 看；画布上画到两屏点「复制」→ 同一张图进剪贴板、不存文件（测试里换掉剪贴板，不碰真的）
 *   ⑨ 远程看：换个地址（remote.test，像手机走外网）打开同一个会话 → 连不上本机预览，右侧栏把这一屏打包放进沙盒 iframe：
 *     样式、写回的 style 都在，<base> 指着原地址（不漏 DSH 的地址），设计变量照样报上来；点页面里的链接换到那一屏；文件改了跟着变；体检照样量、导出照样能导
 *
 *   node e2e/e2e-studio.mjs [--dsh latest|next|<版本>] [--keep]
 * 截图存到临时目录（结束时打印位置）；--keep 留着临时目录。要本机装着 Chrome（CHROME_BIN 可指定）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DSH_SPEC = argv.includes('--dsh') ? argv[argv.indexOf('--dsh') + 1] : 'latest'
const KEEP = argv.includes('--keep')
const REGISTRY = 'https://registry.npmjs.org/'
const WIN = process.platform === 'win32'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra: cond ? '' : String(extra) })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`)
  return !!cond
}
const failed = () => results.filter((r) => !r.ok)

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-')))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME, { recursive: true })
const env = { ...process.env, HOME, USERPROFILE: HOME, DSH_HOME: path.join(tmp, 'dsh-home'), npm_config_registry: REGISTRY, DEEPSEEK_API_KEY: 'sk-e2e-fake' }
env.PATH = `${path.join(tmp, 'cli', 'node_modules', '.bin')}${path.delimiter}${env.PATH}`
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 64 << 20, shell: WIN && cmd === 'npm', ...opts })
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}
const SHOTS = path.join(tmp, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

// 第一次打开有「预览版说明」挡着输入框：起 DSH 前在 web profile 的补丁层里记上已读（同 dsh-mobile 的 e2e）
function seedWelcome(cliDir) {
  const rel = path.join('@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')
  const src = [path.join(tmp, 'cli', 'node_modules', rel), path.join(cliDir, 'node_modules', rel)].find((f) => fs.existsSync(f))
  const m = src && /WELCOME_NOTICE_SETTINGS_NAMESPACE = "([\w-]+)"[\s\S]{0,600}?WELCOME_NOTICE_VERSION = "([^"]+)"/.exec(fs.readFileSync(src, 'utf8'))
  if (!m) return '没找到版本号，照旧点「继续」'
  const [, id, version] = m
  if (!fs.existsSync(path.join(path.dirname(src), '..', '..', `dsh-client-${id}`))) return `存已读的 ${id} 不是插件，照旧点「继续」`
  const file = path.join(env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
  // 新建的补丁层是注释加一行 `[]`，先去掉它再接条目
  const old = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').replace(/^\[\]\s*$/m, '')
  if (new RegExp(`^- id: ${id}$`, 'm').test(old)) return `补丁层里已有 ${id}，没动`
  const entry = `- id: ${id}\n  name: "@deepseek-ai/dsh-client-${id}"\n  config:\n    welcomeNoticeVersion: ${JSON.stringify(version)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, old && !old.endsWith('\n') ? `${old}\n${entry}` : old + entry)
  return `预先记上已读 ${version}`
}

// ── 设计稿：三屏 App，首屏埋问题 ──
const DESIGN = path.join(tmp, 'work', 'coffee-app')
const HEAD = (title) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="tokens.css">`
const BASE = 'body{margin:0;font:16px/1.5 -apple-system,"PingFang SC",sans-serif;background:var(--bg);color:var(--fg)}header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px}h1{font-size:24px;margin:0}main{padding:0 20px}.go{display:flex;align-items:center;justify-content:center;width:100%;height:48px;border:0;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;text-decoration:none}'
const HOME_BAD = `${HEAD('首页')}<style>${BASE}
.icon{width:26px;height:26px;border:0;border-radius:6px;background:#eee;font-size:13px;padding:0}
.hint{color:#c9c9c9}
.tag{display:block;width:150px;white-space:nowrap;overflow:hidden}
.fine{font-size:8px;color:#555}
</style></head><body><header><h1>晨光咖啡</h1><button class="icon" aria-label="搜索">搜</button></header>
<main><p class="hint">今天想喝点什么</p><span class="tag">本周新品：桂花燕麦拿铁限时供应中</span><p class="fine">价格以门店为准</p><a class="go" href="menu.html">去点单</a></main></body></html>`
const HOME_GOOD = `${HEAD('首页')}<style>${BASE}
.icon{width:44px;height:44px;border:0;border-radius:10px;background:#eee;font-size:15px;padding:0}
.hint{color:#555}
.tag{display:block;width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fine{font-size:12px;color:#555}
</style></head><body><header><h1>晨光咖啡</h1><button class="icon" aria-label="搜索">搜</button></header>
<main><p class="hint">今天想喝点什么</p><span class="tag">本周新品：桂花燕麦拿铁限时供应中</span><p class="fine">价格以门店为准</p><a class="go" href="menu.html">去点单</a></main></body></html>`
const MENU = `${HEAD('菜单')}<style>${BASE}li{padding:12px 0;border-bottom:1px solid #eee;list-style:none}ul{padding:0}</style></head><body>
<header><h1>菜单</h1></header><main><ul><li>美式 ¥18</li><li>拿铁 ¥22</li><li>桂花燕麦拿铁 ¥26</li></ul><a class="go" href="cart.html">加入购物车</a></main></body></html>`
const CART = `${HEAD('购物车')}<style>${BASE}p{margin:12px 0}</style></head><body>
<header><h1>购物车</h1></header><main><p>拿铁 × 1　¥22</p><p>合计 ¥22</p><button class="go">去结算</button></main></body></html>`
// 模型「改坏」购物车：浅灰小字
const CART_BAD = CART.replace('<p>合计 ¥22</p>', '<p style="color:#d4d4d4;font-size:8px">合计 ¥22（不含配送费）</p>')
function writeDesign() {
  fs.mkdirSync(DESIGN, { recursive: true })
  fs.writeFileSync(path.join(DESIGN, 'tokens.css'), ':root{--bg:#fffaf3;--fg:#2b1d14;--brand:#6b3e26}\n')
  // 画布按生成顺序排：一屏一屏写，隔一下
  const t0 = Date.now() / 1000 - 60
  ;[['home.html', HOME_BAD], ['menu.html', MENU], ['cart.html', CART]].forEach(([f, s], i) => {
    const p = path.join(DESIGN, f)
    fs.writeFileSync(p, s)
    fs.utimesSync(p, t0 + i * 5, t0 + i * 5)
  })
}

// ── 假模型：Anthropic Messages，SSE ──
const llmLog = []
function sse(res, blocks, stop) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  ev('message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } })
      ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: b.text } })
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    ev('content_block_stop', { index: i })
  })
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } })
  ev('message_stop', {})
  res.end()
}
const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || (c.type === 'tool_result' ? '[tool_result]' : '')).join(' '))
let fixAsk = '' // 「发到对话」发出去后模型收到的那段
const selfChecks = [] // 模型调 check_design 拿回来的结果
const selfCheckImgs = [] // 每次 check_design 结果里带了几张图（严重问题的局部截图）
const looks = [] // 模型调 look_design 拿回来的（原样的 tool_result 内容：一段字 + 几张图）
const resultOf = (m) => (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === 'tool_result').map((c) => (typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join(''))).join('\n')
const llm = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw) } catch {}
    const msgs = body.messages || []
    const last = msgs[msgs.length - 1] || {}
    const agent = Array.isArray(body.tools) && body.tools.length > 0
    llmLog.push({ path: req.url, agent, tools: (body.tools || []).map((t) => t.name), last: textOf(last).slice(0, 80) })
    if (!req.url.includes('/messages')) { res.writeHead(404); return res.end() }
    if (!agent) return sse(res, [{ type: 'text', text: '咖啡 App' }], 'end_turn')
    const said = textOf(last)
    if (said.includes('[tool_result]')) {
      const ck = (last.content || []).find((c) => c.type === 'tool_result' && String(c.tool_use_id || '').startsWith('toolu_e2e_check'))
      if (ck) {
        selfCheckImgs.push(Array.isArray(ck.content) ? ck.content.filter((c) => c.type === 'image' && c.source && /jpe?g/.test(c.source.media_type || '') && (c.source.data || '').length > 1000).length : 0)
        selfChecks.push(resultOf(last))
      }
      const look = (last.content || []).find((c) => c.type === 'tool_result' && c.tool_use_id === 'toolu_e2e_look')
      if (look) looks.push(look.content)
      return sse(res, [{ type: 'text', text: '好了。' }], 'end_turn')
    }
    if (said.includes('ASK-ME')) {
      if (!(body.tools || []).some((t) => t.name === 'ask_user_question')) return sse(res, [{ type: 'text', text: '没有 ask_user_question。' }], 'end_turn')
      return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_ask', name: 'ask_user_question', input: { questions: [{ id: 'feel', header: '风格', question: '想要什么感觉？', options: [{ label: '温暖手作' }, { label: '极简高级' }] }] } }], 'tool_use')
    }
    if (said.includes('MAKE-TAKE')) { fs.writeFileSync(path.join(DESIGN, 'home-b.html'), HOME_GOOD.replace('<title>首页</title>', '<title>首页 B</title>')); return sse(res, [{ type: 'text', text: '出了一版。' }], 'end_turn') }
    if (said.includes('SELF-CHECK')) {
      if (!(body.tools || []).some((t) => t.name === 'check_design')) return sse(res, [{ type: 'text', text: '没有 check_design。' }], 'end_turn')
      return sse(res, [{ type: 'tool_use', id: `toolu_e2e_check${selfChecks.length}`, name: 'check_design', input: {} }], 'tool_use')
    }
    if (said.includes('LOOK-AT')) {
      if (!(body.tools || []).some((t) => t.name === 'look_design')) return sse(res, [{ type: 'text', text: '没有 look_design。' }], 'end_turn')
      return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_look', name: 'look_design', input: { screens: ['home.html'], size: '375x667' } }], 'tool_use')
    }
    if (said.includes('DESIGN-OPEN')) {
      if (!(body.tools || []).some((t) => t.name === 'preview_page')) return sse(res, [{ type: 'text', text: '没有 preview_page。' }], 'end_turn')
      return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(DESIGN, 'home.html'), kind: 'app' } }], 'tool_use')
    }
    // 假装模型照清单改好了首屏 / 把购物车改坏了（直接写文件，和模型用工具写一样触发刷新）
    if (/〔设计体检〕|\[Design check\]/.test(said)) { fixAsk = said; fs.writeFileSync(path.join(DESIGN, 'home.html'), HOME_GOOD); return sse(res, [{ type: 'text', text: '改好了。' }], 'end_turn') }
    if (said.includes('BREAK-CART')) { fs.writeFileSync(path.join(DESIGN, 'cart.html'), CART_BAD); return sse(res, [{ type: 'text', text: '购物车改好了。' }], 'end_turn') }
    return sse(res, [{ type: 'text', text: '你好。' }], 'end_turn')
  })
})

// ── 无头 Chrome（CDP 走 --remote-debugging-pipe）──
function chromeBin() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const c = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: roots.map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  }
  return [process.env.CHROME_BIN, ...(c[process.platform] || [])].filter(Boolean).find((p) => fs.existsSync(p)) || null
}
function launchChrome(bin) {
  const udd = path.join(tmp, 'chrome')
  const proc = spawn(bin, ['--remote-debugging-pipe', `--user-data-dir=${udd}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', `--lang=${process.env.E2E_LANG || 'zh-CN'}`, '--host-resolver-rules=MAP remote.test 127.0.0.1', '--no-proxy-server', ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map()
  const events = [] // 没有 id 的消息（Target.attachedToTarget 这些）
  let seq = 0
  let buf = Buffer.alloc(0)
  proc.stdio[4].on('data', (d) => {
    buf = Buffer.concat([buf, d])
    let i
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'))
      buf = buf.subarray(i + 1)
      const p = msg.id && pending.get(msg.id)
      if (!p) { if (!msg.id) events.push(msg); continue }
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result)
    }
  })
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    proc.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} 超时`)) }, 30000)
  })
  const close = () => new Promise((r) => {
    if (proc.exitCode !== null) return r()
    if (WIN) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => r())
    else { proc.kill('SIGKILL'); setTimeout(r, 500) }
  })
  return { cdp, close, events }
}

let web = null
let webLog = ''
let chrome = null

try {
  await new Promise((r) => llm.listen(0, '127.0.0.1', r))
  env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${llm.address().port}`
  writeDesign()

  // ① 打包、装进全新的 DSH
  fs.mkdirSync(path.join(tmp, 'cli'), { recursive: true })
  const pack = run('npm', ['pack', '--pack-destination', tmp], { cwd: ROOT })
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
  if (!check('打包', pack.code === 0 && tgz, pack.out.slice(-800))) throw new Error('打包失败')
  fs.writeFileSync(path.join(tmp, 'cli', 'package.json'), '{"private":true}')
  const inst = run('npm', ['i', `@deepseek-ai/dsh@${DSH_SPEC}`, 'pnpm@11', `--registry=${REGISTRY}`, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: path.join(tmp, 'cli') })
  if (!check(`装 DSH ${DSH_SPEC}`, inst.code === 0, inst.out.slice(-800))) throw new Error('DSH 没装上')
  const cliDir = path.join(tmp, 'cli', 'node_modules', '@deepseek-ai', 'dsh')
  const dshVersion = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')).version
  console.log(`  （DSH ${dshVersion}）`)
  const add = run(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'plugin', '--profile', 'web', 'add', path.join(tmp, tgz)], { cwd: tmp })
  if (!check('DSH 装上插件', add.code === 0, add.out.slice(-800))) throw new Error('插件没装上')
  console.log(`  （预览版说明：${seedWelcome(cliDir)}）`)
  const work = path.join(tmp, 'work')
  const url = await new Promise((resolve) => {
    web = spawn(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'web', '--no-open', '--port', '0', '--host', '127.0.0.1', '--trusted-host', 'remote.test'], { env, cwd: work, stdio: ['ignore', 'pipe', 'pipe'] })
    const on = (d) => { webLog = (webLog + d).slice(-50000); const m = /dsh web: (http:\/\/\S+)/.exec(webLog); if (m) resolve(m[1]) }
    web.stdout.on('data', on)
    web.stderr.on('data', on)
    web.on('exit', () => resolve(null))
    setTimeout(() => resolve(null), 180_000)
  })
  if (!check('DSH 网页版起来了', url, webLog.slice(-1500))) throw new Error('网页版没起来')

  const bin = chromeBin()
  if (!check('找到 Chrome', bin)) throw new Error('没有 Chrome')
  chrome = launchChrome(bin)
  const { targetId } = await chrome.cdp('Target.createTarget', { url })
  const { sessionId } = await chrome.cdp('Target.attachToTarget', { targetId, flatten: true })
  // 画布 / 单页：左上屏名 ▾ 菜单里——「画布 · 全部 n 屏」或者某一屏（单页取第一屏）
  const VIEW = (pick) => `(async () => { const b = document.querySelector('.ddp-top .ddp-addr'); if (!b) return false; b.click(); await new Promise((r) => setTimeout(r, 150)); const it = ${pick}; if (it) it.click(); return !!it })()`
  const SINGLE = VIEW(`(() => { const k = (document.querySelector('.ddp-cell.sel .ddp-lab') || { dataset: {} }).dataset.key; const ls = [...document.querySelectorAll('.ddp-menu .ls button')]; return ls.find((x) => x.title === k) || ls.find((x) => x.classList.contains('sel')) || ls[0] })()`)
  const CANVAS = VIEW(`[...document.querySelectorAll('.ddp-menu > button')].find((x) => /画布|Canvas/.test(x.textContent))`)
  const page = async (expression) => {
    const r = await chrome.cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const until = async (expression, ms = 60000) => {
    const end = Date.now() + ms
    let v = null
    while (Date.now() < end) {
      try { v = await page(expression) } catch { v = null }
      if (v) return v
      await sleep(500)
    }
    return v
  }
  const shot = async (name) => {
    const { data } = await chrome.cdp('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
  }
  const composer = '[contenteditable="true"], textarea'
  // 输入框里看得到的字（标签只显示短名字）
  const composerVisible = `(() => { const el = document.querySelector('${composer}'); return el ? (el.value ?? el.innerText) : '' })()`
  // 输入框里的整段：标签换回它存的那段（和发给模型的一样）
  const composerText = `(() => { const el = document.querySelector('${composer}'); if (!el) return ''; if (el.value != null) return el.value
    const ed = el.__lexicalEditor; const map = ed && ed.getEditorState()._nodeMap
    const walk = (n) => { if (n.nodeType === 3) return n.textContent
      if (n.dataset && n.dataset.composerChip != null) { const k = Object.keys(n).find((x) => x.startsWith('__lexicalKey_')); const nd = map && k ? map.get(n[k]) : null; return nd && typeof nd.__ref === 'string' ? '\\n' + nd.__ref + '\\n' : n.innerText }
      let s = ''; for (const c of n.childNodes) s += walk(c); if (n.tagName === 'P') s += '\\n'; return s }
    return walk(el) })()`
  // DSH 0.2.1 起我们的整段在输入框里是标签：最后一个这种标签上的字（不算图标）
  const chipDsh = !/^0\.([01]\.|2\.0)/.test(dshVersion)
  const chipLabel = (i) => page(`(() => { const c = [...document.querySelectorAll('[data-composer-chip="dsh-design-studio${i ? '-' + i : ''}"]')].pop(); if (!c) return ''; const ic = c.querySelector('[aria-hidden]'); return (ic ? c.innerText.replace(ic.textContent, '') : c.innerText).trim() })()`)
  // 新版：输入框里是这个标签、看不到整段；旧版：看得到整段
  const asChip = async (i, label, head) => {
    if (!chipDsh) return { ok: head.test(await page(composerText)), why: 'old dsh' }
    const got = await chipLabel(i)
    const vis = await page(composerVisible)
    return { ok: got === label && !head.test(vis), why: JSON.stringify({ got, vis: vis.slice(-120) }) }
  }
  if (!check('界面加载出输入框', await until(`!!document.querySelector('${composer}')`, 120000))) throw new Error('没有输入框')

  const CONTINUE = `[...document.querySelectorAll('button, [role="button"]')].find((x) => /^\\s*(继续|continue)\\s*$/i.test(x.textContent || ''))`
  const dismiss = async (ms) => {
    if (!(await until(`!!${CONTINUE}`, ms))) return
    for (let i = 0; i < 5 && await page(`!!${CONTINUE}`).catch(() => false); i++) {
      await page(`${CONTINUE}.click()`).catch(() => {})
      await sleep(800 + i * 700)
    }
  }
  await dismiss(8000)
  const enter = async () => {
    for (const type of ['keyDown', 'keyUp']) await chrome.cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }, sessionId)
  }
  const say = async (text) => {
    await dismiss(1000)
    await page(`(() => { const el = document.querySelector('${composer}'); el.focus(); return true })()`)
    await chrome.cdp('Input.insertText', { text }, sessionId)
    await sleep(300)
    await enter()
  }

  // ② 模型调 preview_page → 右侧栏画布三屏
  await say('DESIGN-OPEN 做一个咖啡 App')
  const frames = await until(`document.querySelectorAll('iframe[src*="127.0.0.1"]').length >= 3 && document.querySelectorAll('iframe[src*="127.0.0.1"]').length`, 60000)
  check('右侧栏打开，画布三屏', frames >= 3, `iframe ${frames}；模型请求 ${JSON.stringify(llmLog.slice(-3))}；页面 ${(await page('document.body.innerText.slice(-500)').catch((e) => e.message))}`)
  await sleep(2500) // 等预览页里的 picker 就绪
  await shot('1-canvas')

  // ②b 模型自己体检：调 check_design → 右侧栏量完把清单交回
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(300) }
    return null
  }
  // 有问题的屏：无头浏览器量的按「屏名 + 编号的问题」分段，设计目录写在开头；右侧栏量的每条带完整路径
  const flagged = (txt) => {
    if (!txt) return []
    if (txt.startsWith('用无头浏览器')) return txt.includes(DESIGN) ? txt.split('\n\n').slice(1).filter((x) => /\n {2}\d+\. /.test(x)).map((x) => x.split(/[「\n]/)[0]) : ['（没写设计目录）']
    return ['home.html', 'menu.html', 'cart.html'].filter((k) => txt.includes(path.join(DESIGN, k)))
  }
  await say('SELF-CHECK 自己量一下')
  const self1 = await waitFor(() => selfChecks[0], 40000)
  check('模型调 check_design，量完把清单交回', self1 && /量了 3 屏.*发现 4 个问题/.test(self1), self1 || JSON.stringify(llmLog.slice(-3)))
  check('清单里有首屏和四类问题，另两屏没有', !!self1 && JSON.stringify(flagged(self1)) === '["home.html"]' && ['点击区太小', '对比度不够', '文字被截断', '字太小'].every((x) => self1.includes(x)), self1)
  check('严重问题附了局部截图，清单里写看图几', selfCheckImgs[0] >= 1 && /附了 \d+ 张局部截图/.test(self1 || '') && /看图 1/.test(self1 || ''), `${selfCheckImgs[0]} 张；${self1}`)
  if (self1) console.log(`  （check_design：${self1.split('\n')[0]}）`)

  // ②b' 模型要看真实像素：调 look_design → 工具结果里带一张 JPEG 图交给模型
  await say('LOOK-AT 看一眼首屏')
  const look = await waitFor(() => looks[0], 40000)
  const imgs = Array.isArray(look) ? look.filter((c) => c.type === 'image') : []
  const lookText = Array.isArray(look) ? look.filter((c) => c.type === 'text').map((c) => c.text).join('') : String(look || '')
  check('模型调 look_design，拿回一张真实渲染的图', imgs.length === 1 && imgs[0].source && /jpe?g/.test(imgs[0].source.media_type || '') && (imgs[0].source.data || '').length > 2000 && /375×667/.test(lookText), JSON.stringify(look || llmLog.slice(-3)).slice(0, 400))

  // ②c 模型用提问卡问用户 → 右侧栏不转圈，提示在等回答；答完就没了
  const ASKING = `[...document.querySelectorAll('.ddp-chip')].some((c) => /在等你回答|waiting for your answer/.test(c.textContent))`
  await say('ASK-ME 先问问我')
  const asking = await until(ASKING, 30000)
  check('模型提问时右侧栏提示「在等你回答」', asking, await page(`[...document.querySelectorAll('.ddp-chip')].map((c) => c.textContent).join(' | ') || '没有提示条'`))
  await shot('1a-asking')
  const answered = await page(`(() => {
    const opt = [...document.querySelectorAll('button, [role="radio"]')].find((b) => /温暖手作/.test(b.textContent || ''))
    if (!opt) return 'no option'
    opt.click()
    return 'ok'
  })()`)
  await sleep(500)
  await page(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*(提交|Submit)\s*$/.test(x.textContent || '')); if (b) b.click(); return !!b })()`)
  const notAsking = await until(`!(${ASKING})`, 20000)
  check('答完以后提示没了', answered === 'ok' && notAsking, `${answered} / ${await page(`[...document.querySelectorAll('.ddp-chip')].map((c) => c.textContent).join(' | ')`)}`)
  await sleep(3000) // 这一轮结束后的自动体检

  // ③ 设计体检
  const CHECK_BTN = `[...document.querySelectorAll('.ddp-top button.ddp-btn')].find((b) => /^(体检|Check)$/.test(b.dataset.tip || ''))`
  const BADGE = `(${CHECK_BTN}?.querySelector('.bdg')?.textContent || '')`
  check('工具栏有体检按钮', await until(`!!${CHECK_BTN}`, 10000))
  const badge = await until(BADGE, 15000)
  check('打开设计自动量了一下，按钮上标着 4', badge === '4', `「${badge}」`)
  await shot('1b-badge')
  await page(`${CHECK_BTN}.click()`)
  const DONE = `(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.tip')?.textContent || '') })()`
  check('体检面板出来、跑完', await until(DONE, 30000), await page(`document.querySelector('.ddp-check')?.innerText || '没有面板'`))
  const items = await page(`[...document.querySelectorAll('.ddp-check .ddp-ck .nm')].map((x) => x.textContent)`)
  console.log(`  （体检结果：${items.join(' ｜ ')}）`)
  const has = (re) => items.some((x) => re.test(x))
  check('查出点击区太小', has(/点击区太小|Tap target/))
  check('查出对比度不够', has(/对比度不够|contrast/i))
  check('查出文字被截断', has(/文字被截断|clipped|cut off/i))
  check('查出字太小', has(/字太小|too small/i))
  const groups = await page(`[...document.querySelectorAll('.ddp-check .bd > *')].map((x) => x.innerText.split('\\n')[0]).slice(0, 8)`)
  check('问题都在首屏（菜单、购物车干净）', !items.some((x) => /菜单|购物车/.test(x)) && !groups.some((g) => /菜单|购物车|menu|cart/i.test(g)), JSON.stringify(groups))
  await shot('2-check')
  await page(`document.querySelector('.ddp-check .ddp-ck').click()`)
  await sleep(700)
  await shot('3-focus')

  // 发到对话 → 输入框里是体检清单，发出去模型收得到
  await page(`document.querySelector('.ddp-check footer .go').click()`)
  const asked = await until(`(() => { const t = ${composerText}; return /〔设计体检〕|\\[Design check\\]/.test(t) && t })()`, 5000)
  check('「发到对话」把清单放进输入框', asked, await page(composerText))
  if (asked) console.log(`  （输入框：${asked.replace(/\n/g, ' ⏎ ').slice(0, 260)}…）`)
  check('清单写明哪一屏、什么问题', /首页|home/.test(asked || '') && /对比度|contrast/i.test(asked || ''), asked)
  const ckChip = await asChip('check', `体检 · ${((asked || '').match(/发现 (\d+) 个问题/) || [])[1]} 个问题`, /〔设计体检〕/)
  check('体检清单在输入框里是一个标签「体检 · N 个问题」' + (chipDsh ? '' : '（旧版 DSH 插成字）'), ckChip.ok, ckChip.why)
  await page(`(() => { const el = document.querySelector('${composer}'); el.focus(); return true })()`)
  await enter()
  const end = Date.now() + 20000
  while (Date.now() < end && !fixAsk) await sleep(500)
  check('发出去模型收到体检清单', fixAsk, JSON.stringify(llmLog.slice(-3)))
  if (chipDsh) {
    const bubble = await until(`(() => { const p = [...document.querySelectorAll('.ddp-pickpill[data-i="check"]')].pop(); return p && p.innerText })()`, 5000)
    check('发出去的消息里也是「体检 · N 个问题」标签，不是一大段字', /^体检 · \d+ 个问题$/.test(bubble || '') && !/〔设计体检〕/.test(await page('document.body.innerText')), bubble)
  }

  // ④ 模型改好首屏 → 这一轮完了自动再量，按钮上的数字没了；打开面板也是干净的
  const gone = await until(`!${BADGE}`, 20000)
  check('模型改完自动再量：按钮上的数字没了', gone, `还是「${await page(BADGE)}」`)
  await page(`${CHECK_BTN}.click()`)
  const clean = await until(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.innerText) && !!p.querySelector('.ok') })()`, 30000)
  check('打开面板：没问题', clean, await page(`document.querySelector('.ddp-check')?.innerText || '没有面板'`))
  await shot('4-clean')

  // 面板开着，模型又改了购物车（改坏）→ 这一轮完了面板自己刷新；购物车那屏被面板挡着就挪出来
  await say('BREAK-CART 改一下购物车')
  const cartIssues = await until(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.tip')?.textContent || '') && p.querySelectorAll('.ddp-ck').length && /购物车/.test(p.querySelector('.bd').innerText) && p.querySelectorAll('.ddp-ck').length })()`, 30000)
  check('面板开着时模型改完，面板自己重新量（购物车出了问题）', cartIssues >= 2, await page(`document.querySelector('.ddp-check')?.innerText || '没有面板'`))
  await sleep(900) // 画布挪动的动画
  const seen = await page(`(() => {
    const cell = [...document.querySelectorAll('.ddp-cell')].find((c) => /购物车/.test(c.querySelector('.ddp-lab')?.textContent || ''))
    const p = document.querySelector('.ddp-check')
    if (!cell || !p) return 'no cell / panel'
    const a = cell.getBoundingClientRect(), b = p.getBoundingClientRect()
    return a.right <= b.left + 2 ? 'ok' : 'cell ' + Math.round(a.left) + '-' + Math.round(a.right) + ' panel ' + Math.round(b.left)
  })()`)
  check('有问题的那屏不被面板挡住', seen === 'ok', seen)
  await shot('4b-cart')
  await page(`document.querySelector('.ddp-check header .ddp-btn')?.click()`)

  // 面板关着时模型再自己量一次：这回问题在购物车
  await say('SELF-CHECK 再量一下')
  const self2 = await waitFor(() => selfChecks[1], 40000)
  check('面板关着也能自己体检：清单只列购物车', JSON.stringify(flagged(self2)) === '["cart.html"]', self2 || JSON.stringify(llmLog.slice(-3)))
  await sleep(3500) // 这一轮结束后的自动体检

  // ⑤ 导出 PDF / PPT
  const EXPORTS = path.join(DESIGN, 'exports')
  const exportAs = async (re, ext) => {
    await page(`[...document.querySelectorAll('.ddp-kind > .ddp-btn')].find((b) => /^(导出|Export)$/.test(b.dataset.tip || '')).click()`)
    await sleep(300)
    const item = await page(`(() => { const b = [...document.querySelectorAll('.ddp-menu [role=menuitem]')].find((x) => ${re}.test(x.textContent)); if (b) b.click(); return !!b })()`)
    if (!check(`导出菜单有 ${ext.toUpperCase()}`, item)) return null
    const end2 = Date.now() + 60000
    let f = null
    while (Date.now() < end2 && !(f = (fs.existsSync(EXPORTS) ? fs.readdirSync(EXPORTS) : []).find((x) => x.endsWith('.' + ext)))) await sleep(500)
    const toast = await until(`(() => { const t = document.querySelector('.ddp-toast'); return t && t.innerText })()`, 5000)
    check(`导出 ${ext.toUpperCase()} 存进设计目录 exports/`, f, `toast ${toast}`)
    if (toast) console.log(`  （提示：${toast.replace(/\n/g, ' ')}）`)
    return f && path.join(EXPORTS, f)
  }
  const pdf = await exportAs('/PDF/', 'pdf')
  if (pdf) {
    const s = fs.readFileSync(pdf, 'latin1')
    check('PDF 三页', (s.match(/\/Type \/Page\b/g) || []).length === 3, `${(s.match(/\/Type \/Page\b/g) || []).length} 页`)
    check('PDF 里「去点单」「加入购物车」能点、跳到下一页', (s.match(/\/Subtype \/Link /g) || []).length === 2, `${(s.match(/\/Subtype \/Link /g) || []).length} 个链接`)
    check('PDF 有每屏的书签', /\/Type \/Outlines [^>]*\/Count 3/.test(s))
  }
  await sleep(500)
  const pptx = await exportAs('/PPT|PowerPoint/', 'pptx')
  if (pptx) {
    const py = spawnSync('python3', ['-c', 'import sys; from pptx import Presentation; p = Presentation(sys.argv[1]); print(len(p.slides), p.slide_width, p.slide_height)', pptx], { encoding: 'utf8' })
    if (py.status === 0) {
      const [n, w, hh] = py.stdout.trim().split(/\s+/).map(Number)
      check('PPT 三张、竖版（App 画幅）', n === 3 && hh > w, py.stdout.trim())
    } else console.log(`  （没装 python-pptx，PPT 只看了文件：${(py.stderr || '').trim().split('\n').pop()}）`)
    const jumps = spawnSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(" ".join(str(z.read(f"ppt/slides/slide{i}.xml").decode().count("hlinksldjump")) for i in (1, 2, 3)))', pptx], { encoding: 'utf8' })
    check('PPT 里按钮能点（放映时跳到下一张）', jumps.stdout.trim() === '1 1 0', jumps.stdout.trim() || jumps.stderr)
  }
  await sleep(1500)
  const stray = await page(`(document.body.innerText.match(/(已更新|Updated) coffee-app[^\\n]*/) || [''])[0]`)
  check('导出的 PDF / PPT 不算设计改动（不报「已更新」）', !stray, stray)
  await shot('5-exported')

  // ⑥ 首页再出一版 → home-b 紧挨着首页；点它的「用这版」→ 输入框里是〔选定方向〕
  await say('MAKE-TAKE 首页再出一版')
  const order = await until(`(() => { const l = [...document.querySelectorAll('.ddp-cell .ddp-lab > span:first-of-type')].map((x) => x.textContent); return l.length >= 4 && l.join(',') })()`, 30000)
  // 标签是页面标题，标题没载出来时先显示文件名：两种都认
  check('再出的一版紧挨着原版', /(首页|home),(首页 B|home-b)(,|$)/.test(order || ''), order)
  check('几个版本并排：每屏标题旁都有「用这版」，不用先选中', /A(首页|home)(用这版|Use this),B(首页 B|home-b)(用这版|Use this)/.test(await page(`[...document.querySelectorAll('.ddp-cell .ddp-lab')].map((x) => { const c = x.cloneNode(true); c.querySelectorAll('.lb').forEach((e) => e.remove()); return c.textContent }).join(',')`) || ''))
  // 先点一下那一屏选中它（按钮在选中的那屏标签旁）
  // （那一屏可能在画面外，鼠标点不到，直接发 pointer 事件：按在那屏上、在窗口上松开）
  await page(`(() => {
    const s = document.querySelector('.ddp-shield[data-key="home-b.html"]')
    if (!s) return
    const r = s.getBoundingClientRect()
    const o = { bubbles: true, button: 0, clientX: r.left + 10, clientY: r.top + 10 }
    s.dispatchEvent(new PointerEvent('pointerdown', o))
    window.dispatchEvent(new PointerEvent('pointerup', o))
  })()`)
  await sleep(400)
  const picked = await page(`(() => {
    const cell = [...document.querySelectorAll('.ddp-cell')].find((c) => /首页 B|home-b/.test(c.querySelector('.ddp-lab')?.textContent || ''))
    const b = cell && cell.querySelector('[title^="用这版"], [title^="Use this take"]')
    if (!b) return 'no button'
    b.click()
    return 'ok'
  })()`)
  await sleep(600)
  const pickText = await page(composerText)
  check('点「用这版」→ 输入框里是〔选定方向〕，原版挪进 drafts/', picked === 'ok' && /〔选定方向〕就用/.test(pickText) && /home\.html/.test(pickText) && /drafts\//.test(pickText), `${picked}：${pickText.slice(0, 160)}`)
  const dirChip = await asChip('layers', '选定方向', /〔选定方向〕/)
  check('选定方向在输入框里是一个标签', dirChip.ok, dirChip.why)
  await shot('6-pick')

  // ⑦ 调样式：先单看菜单屏（画布可能挪过，元素在画面外点不到）
  await page(`(() => {
    const s = document.querySelector('.ddp-shield[data-key="menu.html"]')
    if (!s) return
    const r = s.getBoundingClientRect()
    const o = { bubbles: true, button: 0, clientX: r.left + 10, clientY: r.top + 10 }
    s.dispatchEvent(new PointerEvent('pointerdown', o))
    window.dispatchEvent(new PointerEvent('pointerup', o))
  })()`)
  await sleep(300)
  await page(SINGLE)
  await until(`!!document.querySelector('iframe.ddp-frame.cur[src*="menu.html"]')`, 15000)
  await sleep(1500)
  await page(`document.querySelector('.ddp-dock button[data-tip="样式"]').click()`)
  const panelTip = await until(`document.querySelector('.ddp-style')?.innerText || ''`, 5000)
  const aside = await page(`document.querySelector('.ddp-single')?.style.right || ''`)
  check('调样式：面板打开，提示先点一个元素；单页的手机让到面板左边', /在页面上点一个元素/.test(panelTip || '') && aside === '296px', `${panelTip} / right=${aside}`)
  // 预览页里的元素：从 DOM 树进 iframe 找到它，量出在整个窗口里的位置（同站的 iframe，DOM.getDocument 能穿进去）
  const nodeIn = async (key, selector) => {
    const { root } = await chrome.cdp('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
    let doc = null
    const walk = (n) => {
      if (doc || !n) return
      if (n.nodeName === 'IFRAME' && n.contentDocument && /ddp-frame cur/.test((n.attributes || []).join(' ')) && (n.attributes || []).some((x) => String(x).includes(key))) doc = n.contentDocument
      for (const c of n.children || []) walk(c)
      if (n.contentDocument) walk(n.contentDocument)
    }
    walk(root)
    if (!doc) return 0
    const { nodeId } = await chrome.cdp('DOM.querySelector', { nodeId: doc.nodeId, selector }, sessionId)
    return nodeId
  }
  const styleAttr = async (key, selector) => {
    const id = await nodeIn(key, selector)
    if (!id) return null
    const { attributes } = await chrome.cdp('DOM.getAttributes', { nodeId: id }, sessionId)
    const i = attributes.indexOf('style')
    return i >= 0 ? attributes[i + 1] : ''
  }
  const clickIn = async (key, selector) => {
    const id = await nodeIn(key, selector)
    if (!id) return false
    const { quads } = await chrome.cdp('DOM.getContentQuads', { nodeId: id }, sessionId)
    const q = quads && quads[0]
    if (!q) return false
    const x = (q[0] + q[2] + q[4] + q[6]) / 4
    const y = (q[1] + q[3] + q[5] + q[7]) / 4
    await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
    for (const type of ['mousePressed', 'mouseReleased']) await chrome.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId)
    return true
  }
  const slide = (label, v) => page(`(() => {
    const row = [...document.querySelectorAll('.ddp-style .row')].find((x) => x.querySelector('label span')?.textContent === ${JSON.stringify(label)})
    const r = row && row.querySelector('input[type=range]')
    if (!r) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, ${JSON.stringify(String(v))})
    r.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await clickIn('menu.html', 'a.go')
  // 头部给人看的是「按钮「加入购物车」」，选择器在 title 里；变量显示中文名，原名在 title 里
  const who = await until(`(document.querySelector('.ddp-style .who')?.title || '').split(' · ')[0]`, 5000)
  const bgVar = await page(`[...document.querySelectorAll('.ddp-style .row')].find((x) => x.querySelector('label span')?.textContent === '背景')?.querySelector('em.v')?.title || ''`)
  check('调样式：点页面里的按钮 → 面板认出它、背景用的是设计变量 --brand', who === 'a.go' && /--brand\b/.test(bgVar), `${who} / ${bgVar}`)
  await slide('圆角', 24)
  await sleep(400)
  const live = await styleAttr('menu.html', 'a.go')
  check('调样式：拖圆角，页面上先变（还没写进文件）', /border-radius:\s*24px/.test(live || '') && !fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').includes('border-radius: 24px'), live)
  await page(`document.querySelector('.ddp-style footer .go').click()`)
  const savedOk = await waitFor(() => fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').includes('<a class="go" href="cart.html" style="border-radius: 24px">'), 8000)
  const savedMsg = await until(`/样式已保存到 menu\.html/.test(document.body.innerText)`, 5000)
  check('调样式：直接保存 → 源码里那个元素带上 style，提示写回了', savedOk && savedMsg, fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').slice(-260))
  await sleep(2500) // 文件变了，预览在后台换一帧
  await slide('字号', 18)
  await sleep(400)
  await page(`[...document.querySelectorAll('.ddp-style footer button')].find((x) => x.textContent === '发到对话').click()`)
  await sleep(500)
  const askTxt = await page(composerText)
  check('调样式：再拖字号「发到对话」→ 输入框里是〔调样式〕和改了什么', /〔调样式〕a\.go/.test(askTxt) && /字号 16px → 18px/.test(askTxt) && askTxt.includes(path.join(DESIGN, 'menu.html')), askTxt.slice(0, 200))
  const styChip = await asChip('style', '样式改动', /〔调样式〕/)
  check('调样式在输入框里是一个标签「样式改动」', styChip.ok, styChip.why)
  await shot('7-style')
  await page(`document.querySelector('.ddp-dock button[data-tip="样式"]').click()`)
  await sleep(600)
  const after = await styleAttr('menu.html', 'a.go')
  check('调样式：退出 → 没写回的字号撤掉，写回的圆角还在', after !== null && /border-radius:\s*24px/.test(after) && !/font-size/.test(after) && !(await page(`!!document.querySelector('.ddp-style')`)), after)

  // ⑦b 点选元素 → 输入框：DSH 0.2.1 起是一个短标签（悬停看详情，发出去是整段），更早的版本插成一段字
  await page(`document.querySelector('.ddp-dock button.pick').click()`)
  await sleep(300)
  await clickIn('menu.html', 'a.go')
  await sleep(800)
  const pq = await page(`(() => { const c = [...document.querySelectorAll('[data-composer-chip="dsh-design-studio"]')]; const last = c[c.length - 1]; const r = last && last.getBoundingClientRect(); return { n: c.length, h: r ? Math.round(r.height) : 0, x: r ? r.x + r.width / 2 : 0, y: r ? r.y + r.height / 2 : 0, text: last ? (last.querySelector('[aria-hidden]') ? last.innerText.replace(last.querySelector('[aria-hidden]').textContent, '') : last.innerText).trim() : '', mark: last && last.querySelector('[aria-hidden]') ? getComputedStyle(last.querySelector('[aria-hidden]')).fontSize : '', quotes: document.querySelectorAll('[data-composer-quote]').length, all: ${composerText}, vis: ${composerVisible} } })()`)
  check('点选元素 → 输入框里' + (chipDsh ? '是一个短标签「1 个元素」' : '是〔选中元素〕a.go（旧版 DSH 插成字）'),
    chipDsh ? pq.n === 1 && pq.text === '1 个元素' && pq.mark !== '' && pq.mark === '0px' && pq.h > 0 && pq.h < 32 && pq.quotes === 0 && /〔选中元素〕a\.go/.test(pq.all) && !/〔选中元素〕/.test(pq.vis) : pq.n === 0 && /〔选中元素〕a\.go/.test(pq.all) && /HTML：/.test(pq.all), JSON.stringify({ ...pq, all: pq.all.slice(-200), dshVersion }))
  if (chipDsh) {
    await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pq.x, y: pq.y }, sessionId)
    const card = await until(`(() => { const c = document.querySelector('.ddp-pickcard'); return c && c.style.display !== 'none' && c.innerText })()`, 3000)
    const cardBg = await page(`getComputedStyle(document.querySelector('.ddp-pickcard')).backgroundColor`)
    check('点选标签：悬停出详情卡（元素、位置、文件，有底色）', !!card && /a\.go/.test(card) && /menu\.html/.test(card) && !/rgba\(0, 0, 0, 0\)|transparent/.test(cardBg), card + ' ' + cardBg)
    await sleep(300) // 卡片淡入完再截图
    await shot('7b-pick-chip')
    await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, sessionId)
    await sleep(200)
    const gone = await page(`(() => { const c = document.querySelector('.ddp-pickcard'); return !c || c.style.display === 'none' })()`)
    check('点选标签：鼠标移开详情卡收起', gone)
    // 点完直接打字：字要接在标签后面（光标别跑到输入框最前面）
    await chrome.cdp('Input.insertText', { text: '改成红色' }, sessionId)
    await sleep(300)
    const typed = await page(composerVisible)
    check('点选标签：接着打的字在标签后面', typed.indexOf('1 个元素') >= 0 && typed.indexOf('改成红色') > typed.indexOf('1 个元素'), JSON.stringify({ chip: typed.indexOf('1 个元素'), typed: typed.indexOf('改成红色'), len: typed.length, head: typed.slice(0, 30), active: await page(`(() => { const a = document.activeElement; return a ? a.tagName + (a.getAttribute('data-lexical-editor') ? '[lexical]' : '') + (a.tagName === 'IFRAME' ? a.src : '') : null })()`) }))
  }

  // ⑧ 换风格：外观面板 →「换风格」→ 点一张卡
  await page(`document.querySelector('.ddp-top button[data-tip="外观"]').click()`)
  await sleep(300)
  await page(`[...document.querySelectorAll('.ddp-look .ddp-lktabs button')].find((x) => /换风格/.test(x.textContent)).click()`)
  const cards = await until(`document.querySelectorAll('.ddp-styles .ddp-sc').length`, 5000)
  await sleep(400) // 面板淡入完再截图
  await shot('8-styles')
  await page(`[...document.querySelectorAll('.ddp-sc')].find((x) => x.querySelector('.nm')?.textContent === '温暖手作').click()`)
  const sam = await until(`document.querySelector('.ddp-samview .meta b')?.textContent`, 3000)
  await sleep(300)
  await shot('8b-sample')
  check('换风格：点卡片先看原大样板，输入框还没动', sam === '温暖手作' && !/〔风格〕/.test(await page(composerText)), sam)
  await page(`document.querySelector('.ddp-samview .ddp-go').click()`)
  await sleep(500)
  const styTxt = await page(composerText)
  check('换风格：二十张风格卡，样板上点「用这个风格」→ 输入框里是〔风格〕、整套配色和换风格的要求', cards === 20 && /〔风格〕温暖手作/.test(styTxt) && styTxt.includes('#F6EFE6') && /把现在的设计换成这个风格/.test(styTxt) && !(await page(`!!document.querySelector('.ddp-styles')`)),
    `${cards} 张；${styTxt.slice(-300)}`)
  const lookChip = await asChip('look', '风格 · 温暖手作', /〔风格〕/)
  check('风格在输入框里是一个标签「风格 · 温暖手作」', lookChip.ok, lookChip.why)

  // ⑧b 画笔标注：真鼠标在台面上画（CDP 的鼠标事件，和人点的一样走 pointer 事件）
  const mouse = (type, x, y) => chrome.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, sessionId)
  const drag = async (x0, y0, x1, y1) => {
    await mouse('mousePressed', x0, y0)
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8)
    await mouse('mouseReleased', x1, y1)
  }
  const tool = (name) => page(`document.querySelector('.ddp-mk-tools button[title^="${name}"]').click()`)
  await page(`document.querySelector('.ddp-dock button[data-tip="画笔"]').click()`)
  const markOn = await until(`!!document.querySelector('.ddp-mark .cv')`, 5000)
  check('画笔标注：盖上画布，工具栏有七种笔 + 撤销 / 重做 / 清掉，颜色和粗细', markOn && await page(`document.querySelectorAll('.ddp-mk-tools > .ddp-btn').length`) === 10 &&
    await page(`document.querySelectorAll('.ddp-mk-sz .ddp-btn').length`) === 3 && await page(`!!document.querySelector('.ddp-mk-color')`), await page(`document.querySelector('.ddp-mark')?.innerText || '没有标注层'`))
  // 不知道怎么用的人：中间有三步说明，底栏写着现在这支笔怎么画；「发到对话」先是淡的
  const how0 = await page(`({ coach: document.querySelector('.ddp-mk-coach')?.innerText || '', bar: document.querySelector('.ddp-mk-bar span')?.innerText || '', idle: !!document.querySelector('.ddp-mk-bar .go.idle') })`)
  await sleep(250)
  await shot('8c0-markup-how')
  check('画笔标注：打开就教怎么用（中间三步、底栏写现在这支笔怎么画、发到对话先是淡的）', /直接在页面上画/.test(how0.coach) && /发到对话/.test(how0.coach) && /画笔/.test(how0.bar) && /按住拖动/.test(how0.bar) && how0.idle, JSON.stringify(how0))
  // 画在台面上看得到的那一屏中间
  const fr = await page(`(() => { const s = document.querySelector('.ddp-stage').getBoundingClientRect(); const r = [...document.querySelectorAll('.ddp-stage iframe')].map((x) => x.getBoundingClientRect()).find((r) => r.width > 80 && r.height > 80 && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
  if (fr) {
    await tool('圆圈')
    const ovalHow = await page(`document.querySelector('.ddp-mk-bar span')?.innerText || ''`)
    check('画笔标注：换成圆圈，底栏跟着说怎么圈', /圆圈/.test(ovalHow) && /圈出要改的地方/.test(ovalHow), ovalHow)
    await drag(fr.x - 40, fr.y - 30, fr.x + 40, fr.y + 30)
    const how1 = await page(`({ coach: !!document.querySelector('.ddp-mk-coach'), idle: !!document.querySelector('.ddp-mk-bar .go.idle') })`)
    check('画笔标注：画了第一笔，说明收起、「发到对话」亮起来', !how1.coach && !how1.idle, JSON.stringify(how1))
    await tool('箭头')
    await drag(fr.x - 90, fr.y + 90, fr.x - 45, fr.y + 35)
    await tool('文字')
    await mouse('mousePressed', fr.x - 60, fr.y + 110)
    await mouse('mouseReleased', fr.x - 60, fr.y + 110)
    await until(`document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement.closest('.ddp-mark')`, 3000)
    await chrome.cdp('Input.insertText', { text: '这里改大' }, sessionId)
    await enter()
    await sleep(200)
  }
  const red = await page(`(() => { const c = document.querySelector('.ddp-mark .cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) n++; return n })()`)
  const undoOff = `document.querySelector('.ddp-mk-tools button[title^="撤销"]').disabled`
  const redoOff = `document.querySelector('.ddp-mk-tools button[title^="重做"]').disabled`
  await page(`document.querySelector('.ddp-mk-tools button[title^="撤销"]').click()`)
  await sleep(150)
  const redOne = await page(`(() => { const c = document.querySelector('.ddp-mark .cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) n++; return n })()`)
  const canRedo = !(await page(redoOff))
  await page(`document.querySelector('.ddp-mk-tools button[title^="重做"]').click()`)
  await sleep(150)
  await shot('8c-markup')
  check('画笔标注：画了红圈、箭头和字；撤销少一笔，能重做', !!fr && red > 300 && redOne > 50 && redOne < red && canRedo && !(await page(undoOff)) && (await page(redoOff)), `frame ${JSON.stringify(fr)}，红点 ${red} → 撤销后 ${redOne}，可重做 ${canRedo}`)
  // 窗口变窄（侧栏被拉窄也一样）：页面挪了、缩了，画的跟着那一屏走
  const markAt = `(() => { const c = document.querySelector('.ddp-mark .cv'); const cr = c.getBoundingClientRect(); const k = c.width / cr.width; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, sx = 0, sy = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) { const p = i / 4; n++; sx += (p % c.width) / k; sy += Math.floor(p / c.width) / k }
    const f = [...document.querySelectorAll('.ddp-stage iframe')].map((x) => x.getBoundingClientRect()).find((r) => r.width > 80 && r.height > 80 && r.right > cr.left && r.left < cr.right)
    return n && f ? { x: sx / n, y: sy / n, fl: f.left - cr.left, ft: f.top - cr.top, fw: f.width } : null })()`
  const mk0 = await page(markAt)
  const vw = await page('innerWidth')
  const vh = await page('innerHeight')
  await chrome.cdp('Emulation.setDeviceMetricsOverride', { width: vw - 260, height: vh, deviceScaleFactor: 0, mobile: false }, sessionId)
  await sleep(900)
  const mk1 = await page(markAt)
  await chrome.cdp('Emulation.clearDeviceMetricsOverride', {}, sessionId)
  await sleep(900)
  const mk2 = await page(markAt)
  const follows = (a, b) => !!a && !!b && Math.abs(b.x - (b.fl + (a.x - a.fl) * (b.fw / a.fw))) < 3 && Math.abs(b.y - (b.ft + (a.y - a.ft) * (b.fw / a.fw))) < 3
  check('画笔标注：窗口变窄页面挪了，画的跟着那一屏走；变回来也对得上', follows(mk0, mk1) && follows(mk0, mk2) && Math.abs(mk1.fl - mk0.fl) + Math.abs(mk1.fw - mk0.fw) > 20, JSON.stringify({ mk0, mk1, mk2 }))
  // 字写到一半直接点聊天输入框：字留下，焦点留在输入框，不被标注层抢回去
  let typing = false
  if (fr) {
    await tool('文字')
    await mouse('mousePressed', fr.x + 30, fr.y - 90)
    await mouse('mouseReleased', fr.x + 30, fr.y - 90)
    typing = await until(`document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement.closest('.ddp-mark')`, 3000)
    if (typing) await chrome.cdp('Input.insertText', { text: '间距' }, sessionId)
  }
  const cp = await page(`(() => { const r = [...document.querySelectorAll('${composer}')].find((x) => !x.closest('.ddp')).getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 } })()`)
  await mouse('mousePressed', cp.x, cp.y)
  await mouse('mouseReleased', cp.x, cp.y)
  await sleep(400)
  check('画笔标注：字写一半点聊天输入框，字留下、焦点留在输入框', typing && await page(`!!document.activeElement && !document.activeElement.closest('.ddp-mark') && !!document.activeElement.closest('${composer}, [contenteditable], textarea')`) &&
    !(await page(`!!document.querySelector('.ddp-mark textarea')`)), await page(`document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : 'none'`))
  const refsBefore = fs.existsSync(path.join(DESIGN, 'refs')) ? fs.readdirSync(path.join(DESIGN, 'refs')).length : 0
  await page(`[...document.querySelectorAll('.ddp-mk-bar button')].find((x) => /发到对话/.test(x.textContent)).click()`)
  const markGone = await until(`!document.querySelector('.ddp-mark') && /〔标注〕/.test(${composerText})`, 30000)
  const markTxt = await page(composerText)
  const markFile = (/〔标注〕(\S+?\.png)/.exec(markTxt) || [])[1] || ''
  let markPng = null
  try { markPng = fs.readFileSync(markFile) } catch { markPng = null }
  const pw = markPng && markPng.length > 24 ? markPng.readUInt32BE(16) : 0
  const ph = markPng && markPng.length > 24 ? markPng.readUInt32BE(20) : 0
  check('画笔标注：「发到对话」→ 标注图存进设计目录的 refs/，输入框里是〔标注〕、图的路径、用 read_image 看的要求和图上写的字', markGone && path.dirname(markFile) === path.join(DESIGN, 'refs') &&
    /^markup-/.test(path.basename(markFile)) && /read_image/.test(markTxt) && /图上写的字：「这里改大」、「间距」/.test(markTxt) && markPng && markPng.readUInt32BE(0) === 0x89504e47 && pw >= 160 && ph >= 160 && markPng.length > 8000 &&
    fs.readdirSync(path.join(DESIGN, 'refs')).length === refsBefore + 1, `${markTxt.slice(-260)} / ${markFile} ${pw}×${ph} ${markPng ? markPng.length : 0}B`)
  const mkChip = await asChip('mark', '标注图', /〔标注〕/)
  check('标注在输入框里是一个标签「标注图」', mkChip.ok, mkChip.why)
  if (chipDsh) {
    const mc = await page(`(() => { const c = [...document.querySelectorAll('[data-composer-chip="dsh-design-studio-mark"]')].pop(); const r = c && c.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
    if (mc) await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mc.x, y: mc.y }, sessionId)
    const mcard = await until(`(() => { const c = document.querySelector('.ddp-pickcard'); const im = c && c.querySelector('img'); return c && c.style.display !== 'none' && im && im.complete && im.naturalWidth > 50 && c.innerText })()`, 3000)
    await sleep(300)
    await shot('8d-mark-chip')
    check('标注标签：悬停看得到标注图的小图和图上写的字', !!mcard && /标注图/.test(mcard) && /这里改大/.test(mcard), mcard)
    await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, sessionId)
  }
  await sleep(1200)
  check('画笔标注：存图不算设计改动（不报「已更新」）', !(await page(`(document.body.innerText.match(/(已更新|Updated) coffee-app[^\\n]*/) || [''])[0]`)))
  // 画布上一笔自由线从一屏画到另一屏：窗口变窄画布换了行，两头各跟各的屏；取消后回单页
  await page(CANVAS)
  await sleep(900)
  await page(`document.querySelector('.ddp-dock button[data-tip="画笔"]').click()`)
  await until(`!!document.querySelector('.ddp-mark .cv')`, 5000)
  const twoAt = `(() => { const s = document.querySelector('.ddp-stage').getBoundingClientRect(); const c = document.querySelector('.ddp-mark .cv').getBoundingClientRect()
    return [...document.querySelectorAll('.ddp-stage iframe')].map((x, i) => [i, x.getBoundingClientRect()]).filter(([, r]) => r.width > 40 && r.height > 40 && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1)
      .map(([i, r]) => ({ i, x: r.left + r.width / 2, y: r.top + r.height / 2, cx: r.left + r.width / 2 - c.left, cy: r.top + r.height / 2 - c.top, w: r.width })) })()`
  const blueNear = (q) => page(`(() => { const c = document.querySelector('.ddp-mark .cv'); const k = c.width / c.getBoundingClientRect().width; const d = c.getContext('2d').getImageData(Math.round((${q.cx} - 6) * k), Math.round((${q.cy} - 6) * k), Math.round(12 * k), Math.round(12 * k)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] > 90 && d[i + 1] < 180 && d[i + 2] > 200 && d[i + 3] > 200) n++; return n })()`)
  // 最后两屏：换行时最后一屏挪到下一行，前一屏不动
  const two0 = (await page(twoAt)).slice(-2)
  let pen = null
  if (two0.length === 2) {
    await page(`document.querySelector('.ddp-mk-color > .ddp-btn').click()`)
    await sleep(100)
    await page(`document.querySelector('.ddp-mk-pal button[title="#3b82f6"]').click()`)
    await tool('画笔')
    const [A, B] = two0
    await mouse('mousePressed', A.x, A.y)
    for (let i = 1; i <= 16; i++) await mouse('mouseMoved', A.x + ((B.x - A.x) * i) / 16, A.y + ((B.y - A.y) * i) / 16)
    await mouse('mouseReleased', B.x, B.y)
    await sleep(200)
    pen = { A, B, at0: [await blueNear(A), await blueNear(B)], tries: [] }
    // 变窄变高，直到画布换行（B 相对 A 的位置不是整体缩放能对上的）
    for (const [cut, tall] of [[200, 0], [260, 700], [320, 1400], [380, 2400], [440, 3400]]) {
      await chrome.cdp('Emulation.setDeviceMetricsOverride', { width: vw - cut, height: vh + tall, deviceScaleFactor: 0, mobile: false }, sessionId)
      await sleep(900)
      const now = await page(twoAt)
      const [A1, B1] = [now.find((q) => q.i === A.i), now.find((q) => q.i === B.i)]
      if (!A1 || !B1) { pen.tries.push({ cut, gone: true }); continue }
      const kk = A1.w / A.w
      const wrapped = Math.hypot(B1.cx - A1.cx - (B.cx - A.cx) * kk, B1.cy - A1.cy - (B.cy - A.cy) * kk) > 20
      pen.tries.push({ cut, wrapped, at: [await blueNear(A1), await blueNear(B1)] })
      if (wrapped) break
    }
    await chrome.cdp('Emulation.clearDeviceMetricsOverride', {}, sessionId)
    await sleep(900)
    const back = await page(twoAt)
    pen.at2 = [await blueNear(back.find((q) => q.i === A.i) || A), await blueNear(back.find((q) => q.i === B.i) || B)]
  }
  const hit = pen && pen.tries.find((x) => x.wrapped)
  check('画笔标注：画布上自由线从一屏画到另一屏，换行后两头各跟各的屏', !!hit && [...pen.at0, ...hit.at, ...pen.at2].every((n) => n > 4) && pen.tries.every((x) => x.gone || x.at.every((n) => n > 4)), JSON.stringify(pen || two0))
  // 「复制」（issue #6）：拼成同一张图放进剪贴板，标注层关上，不往 refs/ 存文件。剪贴板换成假的：收下图量一下尺寸，不碰机器上真的剪贴板
  // 记下调 write 那一刻还算不算用户点的（拼完图再写，Safari 这类就不让写了）；收下的图数一数蓝色笔迹
  await page(`(() => { window.__ddpClip = null
    navigator.clipboard.write = async (items) => {
      const act = navigator.userActivation ? navigator.userActivation.isActive : null
      const it = items[0]; const b = await it.getType('image/png'); const bm = await createImageBitmap(b)
      const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data; let blue = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] > 90 && d[i + 1] < 180 && d[i + 2] > 200) blue++
      window.__ddpClip = { act, n: items.length, types: [...it.types], type: b.type, size: b.size, w: bm.width, h: bm.height, blue } }
    return true })()`)
  const refsCp = fs.readdirSync(path.join(DESIGN, 'refs')).length
  // 画标注时画布的缩放按钮被标注层盖着点不到：收起来，不和底栏叠在一起；关了标注再出来
  const zoomShown = `(() => { const z = document.querySelector('.ddp-zoom'); return !!z && getComputedStyle(z).display !== 'none' })()`
  const zoomHid = !(await page(zoomShown))
  const cpBtn = await page(`(() => { const b = [...document.querySelectorAll('.ddp-mk-bar button')].find((x) => x.textContent === '复制'); if (!b) return null; const r = b.getBoundingClientRect(); return { title: b.title, x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`) || { title: '', x: 0, y: 0 }
  await mouse('mousePressed', cpBtn.x, cpBtn.y)
  await mouse('mouseReleased', cpBtn.x, cpBtn.y)
  const copied = await until(`!document.querySelector('.ddp-mark') && window.__ddpClip`, 30000)
  const cpSaid = await until(`[...document.querySelectorAll('.ddp-toast')].map((x) => x.textContent).find((x) => /标注图复制好了/.test(x)) || ''`, 3000)
  const zoomBack = await page(zoomShown)
  // 两屏并排拼一张：宽高比比一屏手机（约 0.46）宽得多；蓝色那一笔在图上
  check('画笔标注：「复制」→ 点的这一下就交给剪贴板，标注图（两屏 + 画的蓝线）进剪贴板、标注层关上、提示复制好了，不往 refs/ 存文件', /剪贴板/.test(cpBtn.title) && /C\)$/.test(cpBtn.title) && !!copied && copied.act !== false && copied.n === 1 && copied.type === 'image/png' &&
    copied.types.join() === 'image/png' && copied.w / copied.h > 0.75 && copied.blue > 150 && copied.size > 8000 && !!cpSaid && fs.readdirSync(path.join(DESIGN, 'refs')).length === refsCp, JSON.stringify({ cpBtn, copied, cpSaid }))
  check('画笔标注：画的时候画布的缩放按钮收起来（点不到，免得压在底栏下），关了标注再出来', zoomHid && zoomBack, JSON.stringify({ zoomHid, zoomBack }))
  await until(`!document.querySelector('.ddp-mark')`, 3000)
  await page(SINGLE)
  await sleep(900)

  // ⑨ 远程看：同一个会话换个地址打开（remote.test 指向本机，DSH 信任这个域名；页面里 127.0.0.1 指的是「那台设备自己」，预览连不上）
  const here = await page('location.href')
  const remoteOf = (u) => u.replace(/\/\/(127\.0\.0\.1|localhost):/, '//remote.test:')
  const rurl = remoteOf(here)
  // 先用 dsh web 打印的带口令的地址登录（Cookie 按域名记），再到同一个会话
  const { targetId: rt } = await chrome.cdp('Target.createTarget', { url: remoteOf(url) })
  const { sessionId: rs } = await chrome.cdp('Target.attachToTarget', { targetId: rt, flatten: true })
  await chrome.cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, rs) // 沙盒 iframe 在单独的进程里
  const rpage = async (expression) => {
    const r = await chrome.cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, rs)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  const runtil = async (expression, ms = 30000) => {
    const end = Date.now() + ms
    let v = null
    while (Date.now() < end) {
      try { v = await rpage(expression) } catch { v = null }
      if (v) return v
      await sleep(500)
    }
    return v
  }
  // 远程页里的沙盒 iframe：挨个问（新的在前），拆掉了的跳过
  const inFrame = async (expression, ok = (v) => !!v) => {
    const live = new Map()
    for (const m of chrome.events) {
      if (m.sessionId !== rs) continue
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') live.set(m.params.sessionId, 1)
      if (m.method === 'Target.detachedFromTarget') live.delete(m.params.sessionId)
    }
    for (const s of [...live.keys()].reverse()) {
      try {
        const r = await chrome.cdp('Runtime.evaluate', { expression, returnByValue: true }, s)
        if (!r.exceptionDetails && ok(r.result.value)) return r.result.value
      } catch { /* 这一帧拆掉了 */ }
    }
    return null
  }
  const frameUntil = async (expression, ok, ms = 20000) => {
    const end = Date.now() + ms
    let v = null
    while (Date.now() < end) {
      v = await inFrame(expression, ok)
      if (v) return v
      await sleep(500)
    }
    return v
  }
  await runtil(`!!document.querySelector('${composer}')`, 60000)
  if (rurl !== remoteOf(url)) {
    await chrome.cdp('Page.navigate', { url: rurl }, rs)
    await sleep(1500)
  }
  // 地址里不带会话：在左边会话列表里点同名的那个
  const title = String(await page('document.title')).replace(/\s+[—-]\s+DeepSeek Harness\s*$/, '').trim()
  await runtil(`(() => {
    const t = ${JSON.stringify(title)}
    const el = [...document.querySelectorAll('body *')].find((x) => !x.children.length && x.textContent.trim() === t && !x.closest('header'))
    if (!el) return false
    ;(el.closest('button, a, [role="button"], [role="treeitem"], [role="row"], li') || el).click()
    return true
  })()`, 20000)
  await runtil(`!!document.querySelector('.ddp-head')`, 60000)
  if (!(await rpage(`!!document.querySelector('.ddp-scr, .ddp-away')`).catch(() => false))) await rpage(`document.querySelector('.ddp-head').click()`).catch(() => {})
  const rframe = await runtil(`(() => { const f = document.querySelector('iframe.ddp-frame.cur'); return f && !document.querySelector('.ddp-away') ? JSON.stringify({ doc: f.hasAttribute('srcdoc'), src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox') }) : '' })()`, 30000)
  const rf = rframe ? JSON.parse(rframe) : {}
  check('远程看：换个地址打开 → 预览打包放进沙盒 iframe（不再只给一句说明）', rf.doc && !rf.src && rf.sandbox === 'allow-scripts allow-forms',
    `${here} → ${rurl}；${rframe || (await rpage(`(document.querySelector('.ddp-away') || document.querySelector('.ddp-scr') || document.body).innerText.slice(0, 200)`).catch((e) => e.message))}`)
  const PROBE = `JSON.stringify({ base: document.baseURI, title: document.title, text: document.body.innerText.slice(0, 200), bg: document.querySelector('a.go, button.go') ? getComputedStyle(document.querySelector('a.go, button.go')).backgroundColor : '', style: document.querySelector('a.go')?.getAttribute('style') || '', picker: !!window.__dshDesignPicker })`
  const m1 = JSON.parse((await frameUntil(PROBE, (v) => /menu\.html"/.test(v || ''))) || '{}')
  check('远程看：页面样式（设计变量的品牌色）、写回的圆角都在，picker 也在', m1.bg === 'rgb(107, 62, 38)' && /border-radius:\s*24px/.test(m1.style) && m1.picker, JSON.stringify(m1))
  check('远程看：<base> 指着这一屏原来的地址，页面里拿不到 DSH 的地址', /^http:\/\/127\.0\.0\.1:\d+\/menu\.html$/.test(m1.base || ''), m1.base)
  await rpage(`document.querySelector('.ddp-top button[data-tip="外观"]').click()`).catch(() => {})
  const toks = await runtil(`!!document.querySelector('.ddp-look [title^="--brand"]') && document.querySelector('.ddp-look').innerText`, 8000)
  check('远程看：页面和右侧栏说得上话（设计变量报上来了）', !!toks, await rpage(`document.querySelector('.ddp-look')?.innerText.slice(0, 200) || '没有外观面板'`).catch((e) => e.message))
  await rpage(`document.querySelector('.ddp-top button[data-tip="外观"]').click()`).catch(() => {})
  await sleep(400)
  {
    const { data } = await chrome.cdp('Page.captureScreenshot', { format: 'png' }, rs)
    fs.writeFileSync(path.join(SHOTS, '9-remote.png'), Buffer.from(data, 'base64'))
  }
  await inFrame(`(document.querySelector('a.go').click(), true)`, (v) => v === true)
  const c1 = JSON.parse((await frameUntil(PROBE, (v) => /cart\.html"/.test(v || ''))) || '{}')
  check('远程看：点页面里的「加入购物车」→ 这一框换成购物车', c1.title === '购物车' && /拿铁 × 1/.test(c1.text || ''), JSON.stringify(c1))
  fs.writeFileSync(path.join(DESIGN, 'cart.html'), fs.readFileSync(path.join(DESIGN, 'cart.html'), 'utf8').replace('拿铁 × 1', '拿铁 × 2'))
  const c2 = JSON.parse((await frameUntil(PROBE, (v) => /拿铁 × 2/.test(v || ''), 20000)) || '{}')
  check('远程看：文件改了 → 跟着重新打包换上来', /cart\.html$/.test(c2.base || '') && /拿铁 × 2/.test(c2.text || ''), JSON.stringify(c2))
  await rpage(`${CHECK_BTN}.click()`).catch(() => {})
  const rck = await runtil(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.tip')?.textContent || '') && p.querySelectorAll('.ddp-ck').length })()`, 30000)
  check('远程看：体检照样量得出（改坏的购物车：浅灰小字）', rck >= 2, await rpage(`document.querySelector('.ddp-check')?.innerText.slice(0, 300) || '没有面板'`).catch((e) => e.message))
  await rpage(`document.querySelector('.ddp-check header .ddp-btn')?.click()`).catch(() => {})
  const pngs = () => (fs.existsSync(path.join(DESIGN, 'exports')) ? fs.readdirSync(path.join(DESIGN, 'exports')).filter((f) => f.endsWith('.png')) : [])
  const pngBefore = pngs().length
  await rpage(`[...document.querySelectorAll('.ddp-btn')].find((b) => b.dataset.tip === '导出').click()`).catch(() => {})
  await sleep(400)
  await rpage(`[...document.querySelectorAll('.ddp-menu button')].find((b) => b.textContent.trim().endsWith(' · 纯画面')).click()`).catch(() => {})
  const exMsg = await runtil(`(document.body.innerText.match(/(已导出|导出失败)[^\\n]*/) || [''])[0]`, 30000)
  check('远程看：导出这一屏照样能导（沙盒里也画得出图）', /已导出/.test(exMsg || '') && pngs().length > pngBefore, `${exMsg} / ${pngs().join(',')}`)
  await chrome.cdp('Target.closeTarget', { targetId: rt }).catch(() => {})

  // ⑩ 打开已有的 HTML（#8）：网页版没有桌面版的桥 → 不显示「浏览…」、拖进来提示输路径；装上假桥（和桌面版一样的接口）→ 选文件、拖进来、选文件夹都能用
  const OTHER = path.join(tmp, 'work', 'other-site')
  fs.mkdirSync(OTHER, { recursive: true })
  fs.writeFileSync(path.join(OTHER, 'landing.html'), `${HEAD('落地页')}</head><body><main><h1>落地页</h1></main></body></html>`)
  fs.utimesSync(path.join(OTHER, 'landing.html'), Date.now() / 1000 - 30, Date.now() / 1000 - 30)
  fs.writeFileSync(path.join(OTHER, 'about.html'), `${HEAD('关于')}</head><body><main><h1>关于我们</h1></main></body></html>`)
  const BROWSE = `document.querySelector('.ddp-top button[title="选一个本地 HTML 文件打开"]')`
  // 工具栏左边是屏名菜单（11-07 起）：开的是哪个文件看它的 title；要输地址点菜单里的「打开别的页面…」
  const addrText = `((el) => el ? el.dataset.src || '' : '')(document.querySelector('.ddp-addr'))`
  const openAddr = async () => {
    await page(`(async () => { const b = document.querySelector('.ddp-addr'); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); await new Promise((r) => setTimeout(r, 150)); const it = document.querySelector('.ddp-where .ddp-menu [role=menuitem]'); if (it) it.click(); return !!it })()`).catch(() => {})
    return until(`!!document.querySelector('.ddp-top .ddp-input')`, 3000)
  }
  const NOTES = path.join(tmp, 'work', 'notes.txt')
  fs.writeFileSync(NOTES, 'x')
  const DROPDIR = path.join(tmp, 'work', 'drop-dir')
  fs.mkdirSync(DROPDIR, { recursive: true })
  fs.writeFileSync(path.join(DROPDIR, 'first.html'), `${HEAD('第一屏')}</head><body><main><h1>第一屏</h1></main></body></html>`)
  // 真拖放（浏览器自己发的 dragenter / dragover / drop，带真文件）：落点默认是右侧栏的地址栏；at 给的是别的元素（比如预览页面的 iframe）
  const centerOf = (sel) => page(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => b.width * b.height - a.width * a.height); const r = els[0]; return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null })()`)
  const realDrop = async (files, at = '.ddp-top .tl') => {
    const pt = await centerOf(at)
    if (!pt) return `找不到 ${at}`
    const [x, y] = pt
    const data = { items: [], files, dragOperationsMask: 1 }
    await chrome.cdp('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data }, sessionId)
    await chrome.cdp('Input.dispatchDragEvent', { type: 'dragOver', x, y, data }, sessionId)
    const shown = await until(`!!document.querySelector('.ddp-drop') && document.querySelector('.ddp-drop').innerText`, 3000)
    await chrome.cdp('Input.dispatchDragEvent', { type: 'dragOver', x, y, data }, sessionId)
    if (await page(DSH_MASK)) dshMask.push(`拖着 ${path.basename(files[0])} 时`)
    await chrome.cdp('Input.dispatchDragEvent', { type: 'drop', x, y, data }, sessionId)
    await sleep(300)
    if (await page(DSH_MASK)) dshMask.push(`${path.basename(files[0])} 松手后`)
    return shown || '没出蒙层'
  }
  // DSH 自己的「文件或图片拖动到此处即可添加」（整页蒙层，挂在 body 上）：拖进右侧栏时不该出来，松手后更不能卡着
  const DSH_MASK = `[...document.querySelectorAll('[role=status]')].some((e) => !e.closest('.ddp') && /拖动到此处|添加文件或图片/.test(e.textContent || ''))`
  const dshMask = []
  await openAddr()
  const webBrowse = await page(`!!${BROWSE}`)
  await page(`document.querySelector('.ddp-top .ddp-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => {})
  await sleep(300)
  const webDrop = await realDrop([path.join(OTHER, 'about.html')])
  const webToast = await until(`(document.querySelector('.ddp-toast') || {}).innerText || ''`, 3000)
  check('打开已有的 HTML：网页版没有「浏览…」，拖 HTML 进来说清楚要输路径、不乱开', !webBrowse && /网页版拿不到/.test(webDrop) && /网页版拿不到/.test(webToast || '') && !/about\.html/.test(await page(addrText)), JSON.stringify({ webBrowse, webDrop, webToast }))
  // 装上假桥：pathFor 按文件名查表（真桌面版是 Electron 的 webUtils.getPathForFile），选文件夹给一个固定的目录
  await page(`(() => { window.__e2ePaths = ${JSON.stringify({ 'landing.html': path.join(OTHER, 'landing.html'), 'about.html': path.join(OTHER, 'about.html'), 'drop-dir': DROPDIR })}
    window.__DSH_HOST_PATHS__ = { pathFor: (f) => window.__e2ePaths[f.name] || '' }
    window.__e2eDir = ${JSON.stringify(path.join(tmp, 'work', 'app-code'))}
    window.__DSH_DIRECTORY_PICKER__ = { pick: async () => window.__e2eDir }; return true })()`)
  await chrome.cdp('Page.enable', {}, sessionId)
  await chrome.cdp('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId)
  await openAddr()
  const hasBrowse = await until(`!!${BROWSE}`, 3000)
  await shot('10-browse')
  const evFrom = chrome.events.length
  // 选文件窗口要「用户点的」才弹：按真点击算（userGesture）
  await chrome.cdp('Runtime.evaluate', { expression: `${BROWSE}.click()`, userGesture: true }, sessionId)
  let chooser = null
  for (let i = 0; i < 20 && !chooser; i++) { chooser = chrome.events.slice(evFrom).find((m) => m.method === 'Page.fileChooserOpened' && m.sessionId === sessionId); if (!chooser) await sleep(150) }
  if (chooser) await chrome.cdp('DOM.setFileInputFiles', { files: [path.join(OTHER, 'landing.html')], backendNodeId: chooser.params.backendNodeId }, sessionId)
  const browsed = await until(`/landing\\.html/.test(${addrText}) && ${addrText}`, 15000)
  check('打开已有的 HTML：地址栏旁「浏览…」→ 系统选文件 → 直接打开这个文件', hasBrowse && !!chooser && !!browsed && chooser.params.mode === 'selectSingle', JSON.stringify({ hasBrowse, chooser: chooser && chooser.params, browsed, addr: await page(addrText) }))
  await chrome.cdp('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId).catch(() => {})
  const pageDrop = await realDrop([path.join(OTHER, 'about.html')])
  const dropped = await until(`/about\\.html/.test(${addrText}) && ${addrText}`, 15000)
  check('打开已有的 HTML：把 HTML 文件拖进右侧栏 → 蒙层写「打开这个页面」，松手就打开', /打开这个页面/.test(pageDrop) && !!dropped, JSON.stringify({ pageDrop, dropped, addr: await page(addrText) }))
  const otherDrop = await realDrop([NOTES])
  await sleep(500)
  check('打开已有的 HTML：拖别的文件 → 说只接 HTML、文件夹或图片，不动预览', /只接 HTML/.test(otherDrop) && /about\.html/.test(await page(addrText)) && !(await page(`!!document.querySelector('.ddp-drop')`)), otherDrop)
  check('打开已有的 HTML：拖进右侧栏的文件不会掉进对话框当附件', !(await page(`document.body.innerText.includes('notes.txt')`)))
  // 文件夹（没有 index.html）→ 开最先做的那屏
  await openAddr()
  await page(`(() => { const el = document.querySelector('.ddp-top .ddp-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(OTHER)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await page(`document.querySelector('.ddp-top form').requestSubmit()`)
  const dirOpen = await until(`/landing\\.html/.test(${addrText}) && ${addrText}`, 15000)
  check('打开已有的 HTML：输一个没有 index.html 的文件夹 → 开最先做的那屏', !!dirOpen, await page(addrText))
  // 拖文件夹进来 → 开里面的页面
  const dirDrop = await realDrop([DROPDIR])
  const dirDropped = await until(`/first\.html/.test(${addrText}) && ${addrText}`, 15000)
  check('打开已有的 HTML：把文件夹拖进来 → 蒙层写「打开这个文件夹或 HTML」，开里面的页面', /松开，打开这个文件夹或 HTML/.test(dirDrop) && !!dirDropped, JSON.stringify({ dirDrop, addr: await page(addrText) }))
  // 单页铺满时拖到预览页面上（iframe 会把拖动吃掉）：页面转告右侧栏，照样盖上蒙层、松手打开
  await page(SINGLE).catch(() => {})
  await until(`!!document.querySelector('.ddp iframe')`, 8000)
  await sleep(800)
  const frameDrop = await realDrop([path.join(OTHER, 'about.html')], '.ddp iframe')
  const frameDropped = await until(`/about\.html/.test(${addrText}) && ${addrText}`, 15000)
  check('打开已有的 HTML：拖到铺满的预览页面上 → 也出蒙层、松手打开', /打开这个页面/.test(frameDrop) && !!frameDropped, JSON.stringify({ frameDrop, addr: await page(addrText) }))
  // 同一次拖动：拖进预览页面 → 拖到对话区 → 再拖回同一处，蒙层得再出来、DSH 自己的蒙层不能卡着
  // （同站的预览页面里，浏览器回到同一元素时不再给 dragenter，所以 picker 也报 dragover；这里的环境不一定复现得出那个情况）
  await sleep(1500)
  {
    const fp = await centerOf('.ddp iframe')
    const cp = await centerOf(composer)
    const data = { items: [], files: [path.join(OTHER, 'landing.html')], dragOperationsMask: 1 }
    const at = ([x, y], type) => chrome.cdp('Input.dispatchDragEvent', { type, x, y, data }, sessionId)
    let back = ''
    if (fp && cp) {
      await at(fp, 'dragEnter'); await at(fp, 'dragOver')
      const first = await until(`!!document.querySelector('.ddp-drop')`, 3000)
      await at(cp, 'dragOver'); await sleep(250); await at(cp, 'dragOver')
      const gone = await until(`!document.querySelector('.ddp-drop')`, 3000)
      await at(fp, 'dragOver'); await sleep(250); await at(fp, 'dragOver')
      back = await until(`!!document.querySelector('.ddp-drop') && document.querySelector('.ddp-drop').innerText`, 3000)
      // 蒙层没出来就别松手（会掉进页面或对话框），取消这次拖动
      await at(fp, back ? 'drop' : 'dragCancel')
      back = first && gone ? back : `first=${first} gone=${gone}`
    }
    const againOk = await until(`/landing\\.html/.test(${addrText}) && ${addrText}`, 15000)
    const stuck = await page(DSH_MASK)
    check('打开已有的 HTML：拖进预览页面、拖到对话区、再拖回同一处 → 蒙层照样出来、松手打开，DSH 自己的蒙层不卡着', /打开这个页面/.test(back || '') && !!againOk && !stuck, JSON.stringify({ back, stuck, addr: await page(addrText) }))
  }
  // 页面自己有上传区：先经过页面空白处（出提示）再拖进上传区 → 提示收起，文件归页面，不打开、不当参考图
  // z1 只 preventDefault；z2 还拦住不让冒泡
  {
    const UP = path.join(OTHER, 'upload.html')
    const zone = (id, top, stop) => `<div id="${id}" style="position:fixed;left:50%;top:${top}%;width:200px;height:90px;margin-left:-100px;background:#eef">拖到这里上传</div>
<script>${id}.addEventListener('dragover', (e) => { e.preventDefault()${stop ? '; e.stopPropagation()' : ''} })
${id}.addEventListener('drop', (e) => { e.preventDefault()${stop ? '; e.stopPropagation()' : ''}; document.body.setAttribute('data-got', (document.body.getAttribute('data-got') || '') + '${id}:' + [...e.dataTransfer.files].map((f) => f.name).join(',') + ';') })</script>`
    fs.writeFileSync(UP, `${HEAD('上传')}</head><body><main><h1>上传</h1>${zone('z1', 30, false)}${zone('z2', 65, true)}</main></body></html>`)
    await openAddr()
    await page(`(() => { const el = document.querySelector('.ddp-top .ddp-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(UP)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await page(`document.querySelector('.ddp-top form').requestSubmit()`)
    await until(`/upload\\.html/.test(${addrText})`, 15000)
    // 同目录有几屏时会回到画布（卡片上盖着点选层）：切回单页铺满，拖动才落在页面里
    await page(SINGLE).catch(() => {})
    await sleep(1200)
    const FRAME = `[...document.querySelectorAll('.ddp iframe')].filter((f) => /upload\\.html/.test(f.src) && f.getBoundingClientRect().width > 0).pop()`
    // 在预览页面里求值（同站 iframe：拿到它的 frameId，开一个隔离环境，DOM 是同一份）
    const inFrame = async (expr) => {
      const { result } = await chrome.cdp('Runtime.evaluate', { expression: FRAME }, sessionId)
      if (!result || !result.objectId) return null
      const { node } = await chrome.cdp('DOM.describeNode', { objectId: result.objectId }, sessionId)
      const { executionContextId } = await chrome.cdp('Page.createIsolatedWorld', { frameId: node.frameId, worldName: 'e2e-up' }, sessionId)
      const r = await chrome.cdp('Runtime.evaluate', { expression: expr, contextId: executionContextId, returnByValue: true }, sessionId)
      return r.result && r.result.value
    }
    // 页面里的元素 → 外层坐标（预览可能缩放）
    const ptOf = async (id) => {
      const fr = await page(`(() => { const r = ${FRAME}.getBoundingClientRect(); return [r.left, r.top, r.width] })()`)
      const inner = await inFrame(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, innerWidth] })()`)
      if (!fr || !inner) return null
      const k = fr[2] / inner[2]
      return [Math.round(fr[0] + inner[0] * k), Math.round(fr[1] + inner[1] * k)]
    }
    const blank = await page(`(() => { const r = ${FRAME}.getBoundingClientRect(); return [Math.round(r.left + 30), Math.round(r.top + r.height * 0.5)] })()`)
    const PNG = path.join(OTHER, 'ref.png')
    fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
    const said0 = await page(composerText)
    const res = []
    for (const id of ['z1', 'z2']) {
      const zp = await ptOf(id)
      const data = { items: [], files: [NOTES, PNG], dragOperationsMask: 1 }
      const at = ([x, y], type) => chrome.cdp('Input.dispatchDragEvent', { type, x, y, data }, sessionId)
      if (!zp || !blank) { res.push(`${id}: 找不到位置`); continue }
      await at(blank, 'dragEnter'); await at(blank, 'dragOver'); await sleep(250); await at(blank, 'dragOver')
      const hint = await until(`!!document.querySelector('.ddp-drop.soft')`, 3000)
      await at(zp, 'dragOver'); await sleep(250); await at(zp, 'dragOver')
      const off = await until(`!document.querySelector('.ddp-drop')`, 3000)
      await at(zp, 'drop')
      await sleep(600)
      const got = await inFrame(`document.body.getAttribute('data-got') || ''`)
      const under = await page(`(() => { const e = document.elementFromPoint(${blank[0]}, ${blank[1]}); return e ? e.tagName + '.' + e.className : '' })()`)
      res.push({ id, hint, off, got, under })
    }
    // 整页上传：页面用 type=module 的脚本在 window 上挂（比注入的 picker 晚注册）→ 不出提示，文件只归页面
    const ALL = path.join(OTHER, 'upload-all.html')
    fs.writeFileSync(ALL, `${HEAD('整页上传')}</head><body><main><h1>整页上传</h1></main><script type="module">addEventListener('dragover', (e) => e.preventDefault())
addEventListener('drop', (e) => { e.preventDefault(); document.body.setAttribute('data-got', (document.body.getAttribute('data-got') || '') + 'all:' + [...e.dataTransfer.files].map((f) => f.name).join(',') + ';') })</script></body></html>`)
    await openAddr()
    await page(`(() => { const el = document.querySelector('.ddp-top .ddp-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(ALL)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await page(`document.querySelector('.ddp-top form').requestSubmit()`)
    await until(`/upload-all\\.html/.test(${addrText})`, 15000)
    await page(SINGLE).catch(() => {})
    await sleep(1200)
    {
      const FR = `[...document.querySelectorAll('.ddp iframe')].filter((f) => /upload-all\\.html/.test(f.src) && f.getBoundingClientRect().width > 0).pop()`
      const pt = await page(`(() => { const f = ${FR}; if (!f) return null; const r = f.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
      const data = { items: [], files: [path.join(OTHER, 'about.html'), PNG], dragOperationsMask: 1 }
      const at = ([x, y], type) => chrome.cdp('Input.dispatchDragEvent', { type, x, y, data }, sessionId)
      let all = { pt }
      if (pt) {
        await at(pt, 'dragEnter'); await at(pt, 'dragOver'); await sleep(250); await at(pt, 'dragOver'); await sleep(400)
        const hint = await page(`!!document.querySelector('.ddp-drop')`)
        await at(pt, 'drop'); await sleep(800)
        const { result } = await chrome.cdp('Runtime.evaluate', { expression: FR }, sessionId)
        let got = ''
        if (result && result.objectId) {
          const { node } = await chrome.cdp('DOM.describeNode', { objectId: result.objectId }, sessionId)
          const { executionContextId } = await chrome.cdp('Page.createIsolatedWorld', { frameId: node.frameId, worldName: 'e2e-all' }, sessionId)
          got = ((await chrome.cdp('Runtime.evaluate', { expression: `document.body.getAttribute('data-got') || ''`, contextId: executionContextId, returnByValue: true }, sessionId)).result || {}).value
        }
        all = { hint, got, addr: await page(addrText) }
      }
      res.push({ id: 'all', hint: !all.hint, off: true, got: all.got, all })
    }
    const addrNow = await page(addrText)
    const said1 = await page(composerText)
    check('打开已有的 HTML：页面自己有上传区（只拦 dragover / 还拦冒泡 / module 脚本挂在 window 上的整页上传）→ 文件只归页面（不打开、不当参考图）',
      res.every((r) => r && r.hint && r.off && new RegExp(`${r.id}:${r.id === 'all' ? 'about\\.html' : 'notes\\.txt'},ref\\.png;`).test(r.got || '')) && /upload-all\.html/.test(addrNow) && said1 === said0,
      JSON.stringify({ res, addrNow, said: said1 === said0 ? '没变' : String(said1).slice(-200) }))
  }
  check('打开已有的 HTML：拖进右侧栏时 DSH 自己的「拖到这里添加」不出来、松手后也不卡着', !dshMask.length, dshMask.join('；'))
  // 转成代码的「代码放在」：旁边的选文件夹按钮 → 填进去
  // 转成代码在「导出」下拉里；「代码放在」平时只显示文件夹名（完整路径在 title 第一行），点了才是输入框
  const HO_DEST = "((el) => (el ? (el.tagName === 'INPUT' ? el.value : el.title.split('\\n')[0]) : ''))(document.querySelector('.ddp-ho .pathrow input, .ddp-ho .pathv'))"
  await page(`(async () => { const b = [...document.querySelectorAll('.ddp-kind > .ddp-btn')].find((x) => /^(导出|Export)$/.test(x.dataset.tip || '')); if (!b) return false; b.click(); await new Promise((r) => setTimeout(r, 150)); const it = [...document.querySelectorAll('.ddp-menu [role=menuitem]')].find((x) => /转成代码/.test(x.textContent)); if (it) it.click(); return !!it })()`).catch(() => {})
  const hoDir = await until(`!!document.querySelector('.ddp-ho .ddp-dirbtn')`, 8000)
  if (hoDir) await page(`document.querySelector('.ddp-ho .ddp-dirbtn').click()`)
  const hoVal = await until(`${HO_DEST} === ${JSON.stringify(path.join(tmp, 'work', 'app-code'))}`, 5000)
  check('转成代码：「代码放在」旁的选文件夹按钮 → 选的目录填进去', hoDir && hoVal, await page(`(document.querySelector('.ddp-ho') || {}).innerText || '没有面板'`))
  // 检查文件夹还没回来时「开始」点不了；这时自己点了框架，检查回来也不改掉
  const PROJ = path.join(tmp, 'work', 'vue-proj')
  fs.mkdirSync(PROJ, { recursive: true })
  fs.writeFileSync(path.join(PROJ, 'package.json'), '{"dependencies":{"vue":"3"}}')
  await page(`(() => { const f = window.fetch; window.__e2eFetch = f; window.fetch = (u, o) => (/project\\?.*dest=/.test(String(u)) ? new Promise((r) => setTimeout(r, 1500)).then(() => f(u, o)) : f(u, o)); window.__e2eDir = ${JSON.stringify(PROJ)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`)
  const busyGo = await until(`(document.querySelector('.ddp-ho .go') || {}).disabled === true && /正在看这个文件夹/.test(document.querySelector('.ddp-ho').innerText)`, 3000)
  await page(`[...document.querySelectorAll('.ddp-ho .opt')].find((b) => /纯 HTML/.test(b.textContent))?.click()`)
  const kept = await until(`(() => { const ho = document.querySelector('.ddp-ho'); const on = ho && ho.querySelector('.opt.on'); return !!ho && !/正在看这个文件夹/.test(ho.innerText) && /Vue/.test(ho.innerText) && !ho.querySelector('.go').disabled && !!on && on.textContent })()`, 8000)
  await page(`(() => { if (window.__e2eFetch) window.fetch = window.__e2eFetch; return true })()`)
  check('转成代码：检查文件夹时「开始」点不了；这时自己点了框架，检查回来也不改掉', !!busyGo && /纯 HTML/.test(kept || ''), JSON.stringify({ busyGo, kept, ho: await page(`(document.querySelector('.ddp-ho') || {}).innerText || ''`) }))
  // 先自己点了框架，再选个纯 HTML 站点：不按文件夹自动改成「纯 HTML」
  const STATIC = path.join(tmp, 'work', 'static-site')
  fs.mkdirSync(STATIC, { recursive: true })
  fs.writeFileSync(path.join(STATIC, 'index.html'), '<h1>x</h1>')
  await page(`[...document.querySelectorAll('.ddp-ho .opt')].find((b) => /Vue 3/.test(b.textContent))?.click()`)
  await page(`(() => { window.__e2eDir = ${JSON.stringify(STATIC)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`)
  const keptVue = await until(`(() => { const ho = document.querySelector('.ddp-ho'); const on = ho && ho.querySelector('.opt.on'); return ${HO_DEST} === ${JSON.stringify(STATIC)} && !ho.querySelector('.go').disabled && !!on && on.textContent })()`, 5000)
  check('转成代码：先点了 Vue 再选纯 HTML 站点 → 框架还是 Vue', /Vue 3/.test(keptVue || ''), JSON.stringify({ keptVue }))
  // 选了个有别的东西的文件夹（比如 ~/Projects）→ 在里面新建 <设计名>-app，下面说一声
  const PARENT = path.join(tmp, 'work', 'picked-parent')
  fs.mkdirSync(PARENT, { recursive: true })
  fs.writeFileSync(path.join(PARENT, 'notes.md'), 'x')
  await page(`(() => { window.__e2eDir = ${JSON.stringify(PARENT)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`).catch(() => {})
  const nested = path.join(PARENT, 'other-site-app')
  const hoNest = await until(`${HO_DEST} === ${JSON.stringify(nested)} && (document.querySelector('.ddp-ho .moved') || {}).innerText`, 5000)
  check('转成代码：选了有别的东西的文件夹 → 改放进里面新建的 <设计名>-app，下面说一声', /已经有别的东西/.test(hoNest || '') && /other-site-app/.test(hoNest || ''), await page(`(document.querySelector('.ddp-ho') || {}).innerText || '没有面板'`))
  await page(`document.querySelector('.ddp-ho .go')?.click()`).catch(() => {})
  const goTxt = await until(`(() => { const t = ${composerText}; return t.includes(${JSON.stringify(nested)}) && t })()`, 5000)
  check('转成代码：点「开始转成代码」→ 交给模型的目录就是新建的那个', !!goTxt, String(await page(composerText)).slice(-300))
  await page(`document.querySelector('.ddp-ho header .ddp-btn')?.click()`).catch(() => {})
  // 地址栏输错打不开 → 报错；点到别处还是会收起来（不能把工具栏一直藏着）
  await chrome.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {})
  await openAddr()
  await page(`(() => { const el = document.querySelector('.ddp-top .ddp-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '/没有这个/x.html'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await page(`document.querySelector('.ddp-top form').requestSubmit()`)
  const addrErr = await until(`(document.querySelector('.ddp-top .ddp-err') || {}).innerText`, 5000)
  await page(`(() => { const c = [...document.querySelectorAll('textarea, [contenteditable=true]')].find((e) => !e.closest('.ddp')); (c || document.body).focus(); if (!c) document.querySelector('.ddp-top .ddp-input').blur(); return !!c })()`)
  const barBack = await until(`!document.querySelector('.ddp-top .wide') && !!document.querySelector('.ddp-addr')`, 3000)
  check('地址栏：输错路径报错后点到别处 → 照样收起、工具栏回来', !!addrErr && !!barBack, JSON.stringify({ addrErr, editing: await page(`!!document.querySelector('.ddp-top .wide')`) }))
  await chrome.cdp('Emulation.setFocusEmulationEnabled', { enabled: false }, sessionId).catch(() => {})
  const errs = webLog.split('\n').filter((l) => /dsh-design-studio/i.test(l) && /error|fail|失败/i.test(l))
  check('DSH 日志里没有设计台的报错', !errs.length, errs.slice(0, 5).join('\n'))
} catch (e) {
  check('没有异常', false, (e && e.stack) || e)
} finally {
  if (failed().length) console.log(`\n—— DSH 日志（最后 3000 字）——\n${webLog.slice(-3000)}`)
  if (chrome) await chrome.close()
  if (web) {
    if (WIN) execFile('taskkill', ['/pid', String(web.pid), '/T', '/F'], () => {})
    else web.kill('SIGTERM')
  }
  llm.close()
  console.log(`\n${results.length - failed().length}/${results.length} 通过；截图在 ${SHOTS}${KEEP ? `；临时目录 ${tmp}` : ''}`)
  if (!KEEP) {
    await sleep(1500)
    // 截图留着看：挪到系统临时目录下单独一个文件夹，其余删掉
    const keepShots = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-shots-'))
    for (const f of fs.readdirSync(SHOTS)) fs.renameSync(path.join(SHOTS, f), path.join(keepShots, f))
    console.log(`截图挪到 ${keepShots}`)
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(failed().length ? 1 : 0)
}
