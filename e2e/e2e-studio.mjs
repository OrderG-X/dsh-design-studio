/**
 * 设计台真机测试：全新的 DSH 网页版 + 本地「假模型」+ 无头 Chrome，在官方界面里走一遍第一期的功能
 *   ① 打包、装进全新的 DSH
 *   ② 假模型调 preview_page 打开一个三屏的 App 设计 → 右侧栏出画布；再调 check_design → 无头浏览器按真实尺寸量完把清单交回给模型；
 *     严重的问题附上局部截图；调 look_design → 工具结果里带一张真实渲染的截图；
 *     模型用提问卡问用户时，右侧栏提示「在等你回答」，答完就没了
 *   ③ 设计体检：首屏埋了四类问题（点击区、对比度、截断、小字），另两屏干净；点一条会定位；「交给模型修」把清单放进输入框，发出去模型收得到
 *   ④ 改好首屏后「再查一次」→ 没问题
 *   ⑤ 导出 PDF / PPT → 设计目录 exports/ 里各一份，三页
 *   ⑥ 首页再出一版 home-b → 紧挨着首页；点它的「就要这个」→ 输入框里是〔选定方向〕
 *   ⑦ 调样式：单看菜单屏，点「加入购物车」→ 面板认出它用的设计变量；拖圆角页面上先变，写回文件 → 源码里那个元素带上 style；
 *     再拖字号「交给模型」→ 输入框里是〔调样式〕；退出 → 没写回的改动撤掉
 *   ⑧ 换风格：设计规范面板里「换个风格…」→ 一排风格卡，点「温暖手作」→ 输入框里是〔风格〕和整套配色
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
let fixAsk = '' // 「交给模型修」发出去后模型收到的那段
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
  console.log(`  （DSH ${JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')).version}）`)
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
  const composerText = `(() => { const el = document.querySelector('${composer}'); return el ? (el.value ?? el.innerText) : '' })()`
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
  const CHECK_BTN = `[...document.querySelectorAll('button.ddp-btn.o2')].find((b) => /设计体检|Design check/.test(b.title))`
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

  // 交给模型修 → 输入框里是体检清单，发出去模型收得到
  await page(`document.querySelector('.ddp-check footer .go').click()`)
  const asked = await until(`(() => { const t = ${composerText}; return /〔设计体检〕|\\[Design check\\]/.test(t) && t })()`, 5000)
  check('「交给模型修」把清单放进输入框', asked, await page(composerText))
  if (asked) console.log(`  （输入框：${asked.replace(/\n/g, ' ⏎ ').slice(0, 260)}…）`)
  check('清单写明哪一屏、什么问题', /首页|home/.test(asked || '') && /对比度|contrast/i.test(asked || ''), asked)
  await page(`(() => { const el = document.querySelector('${composer}'); el.focus(); return true })()`)
  await enter()
  const end = Date.now() + 20000
  while (Date.now() < end && !fixAsk) await sleep(500)
  check('发出去模型收到体检清单', fixAsk, JSON.stringify(llmLog.slice(-3)))

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
    await page(`[...document.querySelectorAll('.ddp-kind > .ddp-btn')].find((b) => /导出|Export/.test(b.title)).click()`)
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

  // ⑥ 首页再出一版 → home-b 紧挨着首页；点它的「就要这个」→ 输入框里是〔选定方向〕
  await say('MAKE-TAKE 首页再出一版')
  const order = await until(`(() => { const l = [...document.querySelectorAll('.ddp-cell .ddp-lab')].map((x) => x.textContent); return l.length >= 4 && l.join(',') })()`, 30000)
  // 标签是页面标题，标题没载出来时先显示文件名：两种都认
  check('再出的一版紧挨着原版', /(首页|home),(首页 B|home-b)(,|$)/.test(order || ''), order)
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
    const b = cell && cell.querySelector('[title^="就要这个"], [title^="Use this one"]')
    if (!b) return 'no button'
    b.click()
    return 'ok'
  })()`)
  await sleep(600)
  const pickText = await page(composerText)
  check('点「就要这个」→ 输入框里是〔选定方向〕，原版挪进 drafts/', picked === 'ok' && /〔选定方向〕就用/.test(pickText) && /home\.html/.test(pickText) && /drafts\//.test(pickText), `${picked}：${pickText.slice(0, 160)}`)
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
  await page(`document.querySelector('button[title^="单页"]').click()`)
  await until(`!!document.querySelector('iframe.ddp-frame.cur[src*="menu.html"]')`, 15000)
  await sleep(1500)
  await page(`document.querySelector('button[title^="调样式"]').click()`)
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
  const who = await until(`document.querySelector('.ddp-style .who code')?.textContent || ''`, 5000)
  const bgVar = await page(`[...document.querySelectorAll('.ddp-style .row')].find((x) => x.querySelector('label span')?.textContent === '背景')?.querySelector('em.v')?.textContent || ''`)
  check('调样式：点页面里的按钮 → 面板认出它、背景用的是设计变量 --brand', who === 'a.go' && bgVar === '--brand', `${who} / ${bgVar}`)
  await slide('圆角', 24)
  await sleep(400)
  const live = await styleAttr('menu.html', 'a.go')
  check('调样式：拖圆角，页面上先变（还没写进文件）', /border-radius:\s*24px/.test(live || '') && !fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').includes('border-radius: 24px'), live)
  await page(`document.querySelector('.ddp-style footer .go').click()`)
  const savedOk = await waitFor(() => fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').includes('<a class="go" href="cart.html" style="border-radius: 24px">'), 8000)
  const savedMsg = await until(`/样式已写回 menu\.html/.test(document.body.innerText)`, 5000)
  check('调样式：写回文件 → 源码里那个元素带上 style，提示写回了', savedOk && savedMsg, fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').slice(-260))
  await sleep(2500) // 文件变了，预览在后台换一帧
  await slide('字号', 18)
  await sleep(400)
  await page(`[...document.querySelectorAll('.ddp-style footer button')].find((x) => x.textContent === '交给模型').click()`)
  await sleep(500)
  const askTxt = await page(composerText)
  check('调样式：再拖字号「交给模型」→ 输入框里是〔调样式〕和改了什么', /〔调样式〕a\.go/.test(askTxt) && /字号 16px → 18px/.test(askTxt) && askTxt.includes(path.join(DESIGN, 'menu.html')), askTxt.slice(0, 200))
  await shot('7-style')
  await page(`document.querySelector('button[title^="调样式"]').click()`)
  await sleep(600)
  const after = await styleAttr('menu.html', 'a.go')
  check('调样式：退出 → 没写回的字号撤掉，写回的圆角还在', after !== null && /border-radius:\s*24px/.test(after) && !/font-size/.test(after) && !(await page(`!!document.querySelector('.ddp-style')`)), after)

  // ⑧ 换风格：设计规范面板 →「换个风格…」→ 点一张卡
  await page(`document.querySelector('button[title="设计规范"]').click()`)
  await sleep(300)
  await page(`[...document.querySelectorAll('.ddp-tokens footer button')].find((x) => /换个风格/.test(x.textContent)).click()`)
  const cards = await until(`document.querySelectorAll('.ddp-styles .ddp-sc').length`, 5000)
  await sleep(400) // 面板淡入完再截图
  await shot('8-styles')
  await page(`[...document.querySelectorAll('.ddp-sc')].find((x) => x.querySelector('.nm')?.textContent === '温暖手作').click()`)
  await sleep(500)
  const styTxt = await page(composerText)
  check('换风格：九张风格卡，点「温暖手作」→ 输入框里是〔风格〕、整套配色和换风格的要求', cards === 9 && /〔风格〕温暖手作/.test(styTxt) && styTxt.includes('#F6EFE6') && /把现在的设计换成这个风格/.test(styTxt) && !(await page(`!!document.querySelector('.ddp-styles')`)),
    `${cards} 张；${styTxt.slice(-300)}`)

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
  await rpage(`document.querySelector('button[title="设计规范"]').click()`).catch(() => {})
  const toks = await runtil(`(document.querySelector('.ddp-tokens')?.innerText || '').includes('brand') && document.querySelector('.ddp-tokens').innerText`, 8000)
  check('远程看：页面和右侧栏说得上话（设计变量报上来了）', !!toks, await rpage(`document.querySelector('.ddp-tokens')?.innerText.slice(0, 200) || '没有设计规范面板'`).catch((e) => e.message))
  await rpage(`document.querySelector('button[title="设计规范"]').click()`).catch(() => {})
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
  await rpage(`[...document.querySelectorAll('.ddp-btn')].find((b) => b.title === '导出').click()`).catch(() => {})
  await sleep(400)
  await rpage(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '这一屏 · 纯画面').click()`).catch(() => {})
  const exMsg = await runtil(`(document.body.innerText.match(/(已导出|导出失败)[^\\n]*/) || [''])[0]`, 30000)
  check('远程看：导出这一屏照样能导（沙盒里也画得出图）', /已导出/.test(exMsg || '') && pngs().length > pngBefore, `${exMsg} / ${pngs().join(',')}`)
  await chrome.cdp('Target.closeTarget', { targetId: rt }).catch(() => {})
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
