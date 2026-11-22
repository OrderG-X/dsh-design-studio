/**
 * 设计台真机测试：全新的 DSH 网页版 + 本地「假模型」+ 无头 Chrome，在官方界面里走一遍第一期的功能
 *   ① 打包、装进全新的 DSH
 *   ② 假模型调 preview_page 打开一个三屏的 App 设计 → 右侧栏出画布；再调 check_design → 无头浏览器按真实尺寸量完把清单交回给模型；
 *     严重的问题附上局部截图；调 look_design → 工具结果里带一张真实渲染的截图；
 *     模型用提问卡问用户时，右侧栏提示「在等你回答」，答完就没了
 *   ③ 设计体检：首屏埋了四类问题（点击区、对比度、截断、小字），另两屏干净；点一条会定位；「让模型改」把清单放进输入框，发出去模型收得到
 *   ④ 改好首屏后「再查一次」→ 没问题
 *   ⑤ 导出 PDF / PPT / HTML 演示 → 设计目录 exports/ 里各一份，三页
 *   ⑥ 首页再出一版 home-b → 紧挨着首页；点它的「用这版」→ 输入框里是〔选定方向〕
 *   ⑦ 调样式：单看菜单屏，点「加入购物车」→ 面板认出它用的设计变量；拖圆角页面上先变，直接保存 → 源码里那个元素带上 style；
 *     再拖字号「放进对话」→ 输入框里是〔调样式〕；退出 → 没写回的改动撤掉
 *   ⑧ 换风格：外观面板「换风格」→ 一排风格卡，点「温暖手作」→ 输入框里是〔风格〕和整套配色
 *   ⑧b 画笔标注：工具栏「画笔标注」→ 在页面上画圈、箭头、写字，撤销 / 重做 →「放进对话」→ refs/ 里一张标注图（页面截图叠着画的），
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
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DSH_SPEC = argv.includes('--dsh') ? argv[argv.indexOf('--dsh') + 1] : 'latest'
const KEEP = argv.includes('--keep')
const MODE_ONLY = argv.includes('--mode-only') // 只跑「设计模式」那段（改 cordis.patch.yml 时用）
const ONLY_28 = argv.includes('--only-28') // 只跑 #28 调样式通知 + #29 屏多导出那两段（再加设计模式里的通知）
const ANNOT = process.env.E2E_ANNOT === '1' // 业务标注的试验开关打开跑一遍（平时关着跑，看有没有带出别的变化）
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
// 外框库里先放一个外框：首页选「套外框」时下面列出来
{
  const fd = path.join(HOME, '.dsh', 'design-frames', 'demo-popup')
  fs.mkdirSync(fd, { recursive: true })
  fs.writeFileSync(path.join(fd, 'frame.json'), JSON.stringify({ id: 'demo-popup', name: '示例弹窗', size: [460, 640], css: [], frames: [{ id: 'popup', file: 'popup.html', name: '弹窗', slots: { main: '弹窗内容' } }] }))
  fs.writeFileSync(path.join(fd, 'popup.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="dsh-design" content="framed 460x640"></head><body><div data-frame="demo-popup/popup"><div data-slot="main"></div></div></body></html>')
}
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
const DECK = path.join(tmp, 'work', 'deck') // 幻灯片写死 1500×800，meta 没写尺寸（issue #10）
const DIAG = path.join(tmp, 'work', 'diagram') // 图表（思维导图）：用技能里的 diagram.css
const IMPL = path.join(tmp, 'work', 'impl') // 「做出来的」菜单屏（#25 和做出来的比）：少一行菜单，本机的小服务器出
let IMPL_PORT = 0
const cmpResults = [] // 模型调 compare_design 拿回来的文字
const WEBD = path.join(tmp, 'work', 'web') // 网页、meta 没写画幅（单看铺满右侧栏）：开右边面板时整体缩到面板左边（#22）
const TUNE = path.join(tmp, 'work', 'tune') // 调样式「各屏一起改」+ 手改后模型下一步收到通知（#28）
const BIG = path.join(tmp, 'work', 'big') // 70 屏的设计：右侧栏只显示 60 屏，导出要连收起来的 10 屏一起（#29）
const BIG_N = Math.max(70, Math.min(1000, Number(process.env.E2E_BIG_N) || 70)) // E2E_BIG_N=400：照 #29 那位的屏数量一量要多久
let tunePort = '' // 模型那一轮收到的整个请求
let tuneDesign = '' // 设计模式会话里同样那一轮
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
  if (ANNOT) fs.writeFileSync(path.join(DESIGN, 'annotations.json'), JSON.stringify(ANNOTS))
}
const ANNOTS = { annotations: [
  { id: 'menu-01', page: 'menu.html', type: 'rule', title: '价格含税', detail: '**第一行**\n- 列表项', selector: 'h1', anchorLabel: '标题', source: 'PRD 2.6', status: 'open' },
  { id: 'menu-02', page: 'menu.html', type: 'state', title: '售罄置灰', selector: '.go', fallbackText: '加入购物车' },
  { id: 'menu-03', page: 'menu.html', title: '找不到的', selector: '.gone' },
  { id: 'cart-01', page: 'cart.html', title: '合计含配送费', fallbackText: '去结算' },
  { id: 'cart-02', page: 'cart.html', title: '整屏的说明' },
] }

const FIRST_DRAFT = path.join(path.dirname(DESIGN), 'first-draft', 'first.html')
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
// 慢慢写一个文件：先流开头，隔一会儿再流完（文件要等工具跑了才落地）
function slowWrite(res, file, html, holdMs) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  ev('message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_e2e_slow', name: 'write', input: {} } })
  const json = JSON.stringify({ file_path: file, content: html })
  const cut = Math.floor(json.length / 2)
  ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, cut) } })
  setTimeout(() => {
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(cut) } })
    ev('content_block_stop', { index: 0 })
    ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
    ev('message_stop', {})
    res.end()
  }, holdMs)
}
const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || (c.type === 'tool_result' ? '[tool_result]' : '')).join(' '))
let fixAsk = '' // 「放进对话」发出去后模型收到的那段
// 标准模式、设计模式各问一次：模型收到的工具、技能目录里有没有 DSH 自带的 dsh-doc；再让它加载 office 技能，看 Office 工具进来没有
const probes = []
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
    // 探的那次加载技能回来了：MODE-PROBE 之后出现了工具结果（技能加载成功时 DSH 还会在后面再追加一条，所以不只看最后一条）
    const pr = probes[probes.length - 1]
    if (pr && !pr.after) {
      const at = msgs.map((m) => textOf(m)).findLastIndex((t) => t.includes('MODE-PROBE'))
      const back = at >= 0 && msgs.slice(at + 1).find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'))
      if (back) pr.after = { tools: (body.tools || []).map((t) => t.name), result: resultOf(back).slice(0, 200) }
    }
    if (said.includes('[tool_result]')) {
      const ck = (last.content || []).find((c) => c.type === 'tool_result' && String(c.tool_use_id || '').startsWith('toolu_e2e_check'))
      if (ck) {
        selfCheckImgs.push(Array.isArray(ck.content) ? ck.content.filter((c) => c.type === 'image' && c.source && /jpe?g/.test(c.source.media_type || '') && (c.source.data || '').length > 1000).length : 0)
        selfChecks.push(resultOf(last))
      }
      if ((last.content || []).some((c) => c.type === 'tool_result' && c.tool_use_id === 'toolu_e2e_cmp')) cmpResults.push(resultOf(last))
      const look = (last.content || []).find((c) => c.type === 'tool_result' && c.tool_use_id === 'toolu_e2e_look')
      if (look) looks.push(look.content)
      return sse(res, [{ type: 'text', text: '好了。' }], 'end_turn')
    }
    if (said.includes('MODE-NEXT') && probes.length) { probes[probes.length - 1].next = (body.tools || []).map((t) => t.name); return sse(res, [{ type: 'text', text: '好。' }], 'end_turn') }
    if (said.includes('MODE-PROBE')) {
      probes.push({ tools: (body.tools || []).map((t) => t.name), doc: raw.includes('dsh-doc'), after: null })
      if (!(body.tools || []).some((t) => t.name === 'skill')) { probes[probes.length - 1].noSkill = true; return sse(res, [{ type: 'text', text: '没有 skill。' }], 'end_turn') }
      return sse(res, [{ type: 'tool_use', id: `toolu_e2e_skill${probes.length - 1}`, name: 'skill', input: { name: 'office' } }], 'tool_use')
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
    if (said.includes('IMPL-CMP')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_cmp', name: 'compare_design', input: { url: `http://localhost:${IMPL_PORT}/menu.html`, screen: 'menu.html' } }], 'tool_use')
    if (said.includes('DRAFT-FIRST')) return slowWrite(res, FIRST_DRAFT, `${HEAD('第一屏')}<meta name="dsh-design" content="app"></head><body><main><h1>第一屏草稿</h1><p>${'边写边看的内容。'.repeat(80)}</p></main></body></html>`, 8000)
    if (said.includes('OPEN-BIG')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(BIG, `s${BIG_N}.html`) } }], 'tool_use')
    if (said.includes('OPEN-TUNE')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(TUNE, 'a.html') } }], 'tool_use')
    if (raw.includes('TUNE-PORT') && !tunePort) { tunePort = raw; return sse(res, [{ type: 'text', text: '好，我先重读文件。' }], 'end_turn') }
    if (raw.includes('TUNE-DESIGN') && !tuneDesign) { tuneDesign = raw; return sse(res, [{ type: 'text', text: '好，我先重读文件。' }], 'end_turn') }
    if (said.includes('OPEN-WEB')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(WEBD, 'index.html') } }], 'tool_use')
    if (said.includes('OPEN-DIAGRAM')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(DIAG, 'map.html') } }], 'tool_use')
    if (said.includes('OPEN-DECK')) return sse(res, [{ type: 'tool_use', id: 'toolu_e2e_open', name: 'preview_page', input: { target: path.join(DECK, 's1.html') } }], 'tool_use')
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

// 设计模式 = DSH 标准模式的全部插件 + 设计台自己的两样（design-tool / design-skill）。拿装好的 DSH 的标准模式逐项比：
// DSH 加了插件或者改了配置，这里先红（rc.2 加的 Office 工具、自带技能目录就是这样漏掉的）
function presetDiff(cliRoot) {
  const req = createRequire(path.join(cliRoot, 'noop.js'))
  const yaml = req('js-yaml')
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (x) => ({ __jsExpr: x }) })])
  const plugins = (file) => { const doc = yaml.load(fs.readFileSync(file, 'utf8'), { schema }); let r = null; JSON.stringify(doc, (k, v) => { if (!r && v && Array.isArray(v.plugins)) r = v.plugins; return v }); return r || [] }
  const flat = (list, pre = '') => list.flatMap((e) => [[pre + e.id, e], ...(e.group && Array.isArray(e.config) ? flat(e.config, `${pre}${e.id}/`) : [])])
  const std = new Map(flat(plugins(path.join(cliRoot, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml'))))
  const mine = new Map(flat(plugins(path.join(ROOT, 'cordis.patch.yml'))))
  const js = (v) => !!v && typeof v === 'object' && '__jsExpr' in v
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  // 故意不同的地方。ours：设计模式这边必须是 !!js 表达式（多包了一层「旧版 DSH 没有就跳过」）；
  // newer：新版标准模式才有的设置，旧版标准模式没写时设计模式也可以先写上（旧版会忽略这个键）
  const ours = { 'tool-office': ['disabled'], 'skill-filesystem': ['customSkillDirs'] }
  const newer = { 'delegation/tool-subagent-control': ['interrupt'], 'delegation/tool-subagent': ['modelSelectionSettings'] }
  const out = []
  const cmp = (id, where, a = {}, b = {}) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (where === '' && (k === 'config' || k === 'id')) continue
      const ok = (ours[id] || []).includes(k) ? js(b[k])
        : (newer[id] || []).includes(k) && !(k in a) ? true
        : same(a[k], b[k])
      if (!ok) out.push(`${id}${where}.${k} 不同`)
    }
  }
  for (const [id, e] of std) {
    const m = mine.get(id)
    if (!m) { out.push(`少了 ${id}`); continue }
    cmp(id, '', e, m) // 包名、disabled、group、isolate……整行除了 config 都要一样
    if (id === 'persona' || e.group) continue // 人设是设计台自己的；组的 config 是子插件，上面 flat 逐个比了
    cmp(id, ' 的 config', e.config || {}, m.config || {})
  }
  // 设计模式多出来的行：只许设计台自己的两行，和旧版 DSH 还没有的 Office 工具（它那行是「找得到包才开」）
  for (const [id, m] of mine) if (!std.has(id) && !/^design-/.test(id) && !(id === 'tool-office' && js(m.disabled))) out.push(`多了 ${id}`)
  return out
}

const MODE_DONE = Symbol('mode-done') // --mode-only 跑完那段就收尾
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
  let pd
  try { pd = presetDiff(path.join(tmp, 'cli')) } catch (e) { pd = [`比不了：${e.message}`] }
  check('设计模式和这版 DSH 的标准模式一致（故意不同的几处除外）', !pd.length, pd.join('；'))
  const add = run(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'plugin', '--profile', 'web', 'add', path.join(tmp, tgz)], { cwd: tmp })
  if (!check('DSH 装上插件', add.code === 0, add.out.slice(-800))) throw new Error('插件没装上')
  console.log(`  （预览版说明：${seedWelcome(cliDir)}）`)
  if (ANNOT) {
    const patch = path.join(env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
    const old = (fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : '').replace(/^\[\]\s*$/m, '')
    fs.writeFileSync(patch, old + (old && !old.endsWith('\n') ? '\n' : '') + '- id: dsh-design-studio-annotations\n  disabled: false\n')
  }
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
  const CANVAS = `(() => { const b = document.querySelector('.ddp-top .dd-cv'); if (!b || b.disabled) return false; b.click(); return true })()`
  // ── 1.0 的入口 ──
  // 标题栏「分享 / 导出 / 转成代码」开一张面板（data-sheet 写着是哪张），面板顶上切页签；已经开着就不再点（再点会收起）
  const W8 = 'const w = (n) => new Promise((r) => setTimeout(r, n));'
  const SHEET_IS = (name) => `!!document.querySelector('.dd-sheet[data-sheet="${name}"]')`
  const openSheet = (tip, name, tabRe) => `(async () => { ${W8}
    if (!${SHEET_IS(name)}) { const b = [...document.querySelectorAll('.dd-bar .ddp-btn')].find((x) => x.getClientRects().length && x.dataset.tip === '${tip}'); if (!b || b.disabled) return false; b.click() }
    for (let i = 0; i < 40 && !${SHEET_IS(name)}; i++) await w(100)
    if (!${SHEET_IS(name)}) return false
    ${tabRe ? `const tb = [...document.querySelectorAll('.dd-sheet .dd-tabs [role=tab]')].find((x) => ${tabRe}.test(x.textContent)); if (!tb) return false; if (tb.getAttribute('aria-selected') !== 'true') { tb.click(); await w(350) }` : ''}
    return true })()`
  const closeSheet = `(async () => { const b = document.querySelector('.dd-sheet .dd-sh .dd-x'); if (b) b.click(); for (let i = 0; i < 30 && document.querySelector('.dd-sheet'); i++) await new Promise((r) => setTimeout(r, 100)); return !document.querySelector('.dd-sheet') })()`
  // 导出面板里点导出：kind = pdf / pptx / img（optRe 挑图片样式）；整套 HTML 演示在「分享 → HTML 演示」
  const exportJs = (kind, optRe) => kind === 'html'
    ? `(async () => { if (!(await ${openSheet('分享', 'share', '/HTML/')})) return false; const b = document.querySelector('.dd-sheet .dd-demo .dd-sf .dd-bt.pri'); if (!b) return false; b.click(); return true })()`
    : `(async () => { ${W8} if (!(await ${openSheet('导出', 'export', kind === 'img' ? '/图片|Image/' : kind === 'pptx' ? '/PPT/' : '/PDF/')})) return false
      ${optRe ? `const o = [...document.querySelectorAll('.dd-sheet .dd-opt')].find((x) => ${optRe}.test(x.textContent)); if (!o) return false; o.click(); await w(150)` : ''}
      const b = document.querySelector('.dd-sheet .dd-sf .dd-bt.pri'); if (!b || b.disabled) return false; b.click(); return true })()`
  // 命令面板：点灵动条左边那格，打字，回车执行第一条
  const palJs = (text) => `(async () => { ${W8} const c = document.querySelector('.ddp-dock .dd-cmd'); if (!c) return false; c.click()
    for (let i = 0; i < 20 && !document.querySelector('.dd-pal input'); i++) await w(60)
    const inp = document.querySelector('.dd-pal input'); if (!inp) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(text)}); inp.dispatchEvent(new Event('input', { bubbles: true })); await w(120)
    const first = (document.querySelector('.dd-pal .dd-pr.hi > span') || {}).textContent || ''
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); await w(150)
    return first })()`
  // 命令面板里打字后列出来的几行（不执行，Esc 收起）
  const palRows = (text) => `(async () => { ${W8} const c = document.querySelector('.ddp-dock .dd-cmd'); if (!c) return null; c.click()
    for (let i = 0; i < 20 && !document.querySelector('.dd-pal input'); i++) await w(60)
    const inp = document.querySelector('.dd-pal input'); if (!inp) return null
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(text)}); inp.dispatchEvent(new Event('input', { bubbles: true })); await w(120)
    const rows = [...document.querySelectorAll('.dd-pal .dd-pr > span')].map((x) => x.textContent)
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await w(300)
    return rows })()`
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

  // ⑭ 调样式「各屏一起改」（#28）：按钮的样式在共用的 app.css 里 → 面板默认勾「各屏一起改」，保存写进 app.css 的 .pill（两屏一起变）；
  // 然后发一句话 → 模型这一步的请求里带着插件补的通知（改了什么、先重读文件），对话里显示一行
  // design：在设计模式的新会话里再来一次（换个颜色），看通知在设计模式里也到得了模型
  const tuneCheck = async (design = false) => {
    const tag = design ? '设计模式' : '#28'
    const color = design ? '#2a9d8f' : '#e8843c'
    const rgb = design ? 'rgb(42, 157, 143)' : 'rgb(232, 132, 60)'
    const word = design ? 'TUNE-DESIGN' : 'TUNE-PORT'
    const got = () => (design ? tuneDesign : tunePort)
    if (!design) {
      fs.mkdirSync(TUNE, { recursive: true })
      fs.writeFileSync(path.join(TUNE, 'app.css'), 'body{margin:0;font:16px sans-serif}\n.pill {\n  display: inline-block;\n  padding: 8px 14px;\n  border-radius: 999px;\n  background: #3366ff;\n  color: #fff;\n}\n')
      const scr = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title><meta name="dsh-design" content="app"><link rel="stylesheet" href="app.css"></head><body><main><h1>${t}</h1><a class="pill" href="#">按住说话</a></main></body></html>`
      fs.writeFileSync(path.join(TUNE, 'a.html'), scr('遥控'))
      fs.writeFileSync(path.join(TUNE, 'b.html'), scr('说话中'))
    }
    await say('OPEN-TUNE 打开')
    const up = await until(`!!document.querySelector('iframe.ddp-frame[src*="a.html"]') && !!document.querySelector('iframe.ddp-frame[src*="b.html"]')`, 30000)
    if (!check(`调样式（${tag}）：打开两屏的设计`, up, await page(`[...document.querySelectorAll('iframe.ddp-frame')].map((f) => f.getAttribute('src')).join(' ')`))) return
    // 上一步停在首页：回到设计
    // 开过别的会话时页面里还留着那个会话藏起来的设计台：只认看得见的（V）
    const V = (js) => `(() => { const V = (sel) => [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length) || null; return ${js} })()`
    await page(V(`(V('.ddp-homeback') || { click() {} }).click(), 1`))
    await until(V(`!V('.ddp-home')`), 5000)
    await sleep(1500)
    await page(V(`V('.ddp-dock button[data-tip="调样式"]').click()`))
    await until(V(`!!V('.ddp-style')`), 5000)
    await sleep(500)
    await clickIn('a.html', 'a.pill')
    await until(V(`(V('.ddp-style .dd-sh .sub')?.title || '').startsWith('a.pill')`), 5000)
    const setBg = await page(`(() => {
      const row = [...document.querySelectorAll('.ddp-style .dd-f')].find((x) => x.getClientRects().length && x.querySelector('.lbl>span')?.textContent === '背景')
      const inp = row && row.querySelector('input[type=color]')
      if (!inp) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '${color}')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    // 默认勾不勾要等服务端核对完各屏（sharecheck）：等到勾上，等不到就照实拿现在的
    await until(V(`(V('.ddp-style .dd-seg [aria-checked="true"]')?.textContent || '') === '各屏一起改'`), 5000)
    const share = await until(V(`((g, n) => g && { text: g.innerText + ' / ' + (n ? n.title || n.textContent : ''), on: g.querySelector('[aria-checked="true"]')?.textContent === '各屏一起改' })(V('.ddp-style .dd-seg'), V('.ddp-style footer .note'))`), 3000)
    if (!setBg || !share) {
      await shot(`14-tune-fail-${design ? 'design' : 'std'}`)
      console.log('  （调样式面板：' + JSON.stringify(await page(V(`({ style: (V('.ddp-style') || {}).innerText || '没有面板', who: (V('.ddp-style .dd-sh .sub') || {}).title || '', frames: [...document.querySelectorAll('iframe.ddp-frame')].map((f) => f.className + ' ' + f.getAttribute('src')).join(' | '), home: !!V('.ddp-home') })`))) + '）')
    }
    check(`调样式（${tag}）：样式来自共用的 app.css → 面板有「各屏一起改」、默认勾上、写着 app.css 的 .pill`, setBg && share && share.on && /各屏一起改/.test(share.text) && /app\.css/.test(share.text) && /\.pill/.test(share.text), JSON.stringify({ setBg, share }))
    if (!design) await shot('14-tune-share')
    await page(V(`V('.ddp-style footer .go').click()`))
    const cssOk = await waitFor(() => fs.readFileSync(path.join(TUNE, 'app.css'), 'utf8').includes(`background: ${color};`), 8000)
    const toast = await until(`/已写进 app\.css 的 \.pill/.test(document.body.innerText)`, 5000)
    check(`调样式（${tag}）：保存 → 写进 app.css 的 .pill，两屏的 HTML 都没加行内 style，提示「各屏一起变」`, cssOk && toast && !/style=/.test(fs.readFileSync(path.join(TUNE, 'a.html'), 'utf8')) && !/style=/.test(fs.readFileSync(path.join(TUNE, 'b.html'), 'utf8')), fs.readFileSync(path.join(TUNE, 'app.css'), 'utf8'))
    await sleep(2500) // 文件变了，两屏在后台换一帧
    const bBg = await inPage(`document.querySelector('iframe.ddp-frame[src*="b.html"]')`, `getComputedStyle(document.querySelector('a.pill')).backgroundColor`)
    check(`调样式（${tag}）：没点的那一屏也跟着变了`, bBg === rgb, String(bBg))
    await page(V(`V('.ddp-dock button[data-tip="调样式"]').click()`))
    await sleep(300)
    await say(`${word} 把设计做进项目里`)
    const req = await waitFor(() => got(), 20000)
    const r = req || ''
    check(`手改通知（${tag}）：模型这一步的请求里有插件补的通知：改了 app.css 的 .pill、先重读文件`, r.includes('〔设计工作台〕') && r.includes('app.css 的 .pill 规则') && r.includes(color) && r.includes('先重新读'), r ? r.slice(Math.max(0, r.indexOf('〔设计工作台〕') - 20), r.indexOf('〔设计工作台〕') + 600) : '没收到')
    const row = await until(`(() => { const t = [...document.querySelectorAll('body *')].filter((e) => !e.closest('.ddp') && e.children.length === 0 && e.getClientRects().length && /用户在设计工作台里手改了 1 处/.test(e.textContent)); return t.length ? t[0].textContent : '' })()`, 10000)
    // 通知在对话里那一步显示成一行：DSH 0.2.2 起才有（0.2.1 模型照样收到，界面不显示）
    if (/^0\.([01]\.|2\.[01]\b)/.test(dshVersion)) console.log(`  （DSH ${dshVersion} 不显示通知那一行：${row ? '这次显示了' : '没显示'}）`)
    else check(`手改通知（${tag}）：对话里显示一行「用户在设计工作台里手改了 1 处」`, !!row, await page(`document.body.innerText.slice(-600)`))
    await shot(design ? '14-tune-notice-design' : '14-tune-notice')
  }

  // ⑮ 屏多（#29）：70 屏的设计，右侧栏只显示最新的 60 屏；导出 PDF / 整套 HTML 要 70 屏都在，截图时说到第几屏，
  // 收起来的那屏（s01）和显示的那屏（s70）互相跳的链接 PDF 里也能点
  const bigCheck = async () => {
    fs.mkdirSync(BIG, { recursive: true })
    const pad = (i) => String(i).padStart(String(BIG_N).length, '0')
    const last = `s${pad(BIG_N)}.html`
    fs.writeFileSync(path.join(BIG, 'app.css'), 'body{margin:0;font:16px sans-serif}main{height:667px;box-sizing:border-box;padding:24px;overflow:hidden}h1{margin:0 0 12px}.r{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #0001}.r i{width:20px;height:20px;border-radius:6px;background:#e8843c}\n')
    for (let i = 1; i <= BIG_N; i++) {
      const link = i === 1 ? `<a href="${last}">去最后一屏</a>` : i === BIG_N ? `<a href="s${pad(1)}.html">回第一屏</a>` : ''
      const rows = Array.from({ length: 14 }, (_, j) => `<div class="r"><i></i><span>第 ${i} 屏 · 第 ${j + 1} 行 遥控按钮</span></div>`).join('')
      fs.writeFileSync(path.join(BIG, `s${pad(i)}.html`), `<!doctype html><html><head><meta charset="utf-8"><title>第${i}屏</title><meta name="dsh-design" content="app 375x667"><link rel="stylesheet" href="app.css"></head><body><main style="background:hsl(${i * 5 % 360},60%,92%)"><h1>第${i}屏</h1>${link}${rows}</main></body></html>`)
    }
    await say('OPEN-BIG 打开')
    const up = await until(`!!document.querySelector('iframe.ddp-frame[src*="${last}"]')`, 30000)
    if (!check(`屏多（#29）：打开 ${BIG_N} 屏的设计`, up)) return
    await page(`(document.querySelector('.ddp-homeback') || { click() {} }).click(), 1`)
    await until(`!document.querySelector('.ddp-home')`, 5000)
    await sleep(3000)
    const files = (ext) => (fs.existsSync(path.join(BIG, 'exports')) ? fs.readdirSync(path.join(BIG, 'exports')) : []).filter((x) => x.endsWith('.' + ext))
    const run = async (kind, ext, ms) => {
      // PDF 走命令面板（和原来的菜单一样先预检）；整套 HTML 在「分享 → HTML 演示」
      if (kind === 'html') await page(exportJs('html'))
      else await page(palJs('导出 PDF'))
      const end = Date.now() + ms
      const toasts = new Set()
      let xo = ''
      while (Date.now() < end && !files(ext).length) {
        toasts.add(await page(`(document.querySelector('.ddp-toast') || {}).innerText || ''`).catch(() => ''))
        // 预检拦下来了（有内容被裁）：不会导出，别干等
        if ((xo = await page(`(document.querySelector('.dd-sheet[data-sheet="export"] .ddp-xo') || {}).innerText || ''`).catch(() => ''))) break
        await sleep(400)
      }
      return { f: files(ext)[0] ? path.join(BIG, 'exports', files(ext)[0]) : '', toasts: [...toasts].filter(Boolean), xo }
    }
    const t0 = Date.now()
    const pdf = await run('pdf', 'pdf', 300000 + BIG_N * 3000)
    const s = pdf.f ? fs.readFileSync(pdf.f, 'latin1') : ''
    const pages = (s.match(/\/Type \/Page\b/g) || []).length
    check(`屏多（#29）：导出 PDF 是 ${BIG_N} 页（收起来的 ${BIG_N - 60} 屏也在），截图时说到第几屏`, pages === BIG_N && pdf.toasts.some((x) => new RegExp(`正在截图 \\d+/${BIG_N}`).test(x)), JSON.stringify({ pages, secs: Math.round((Date.now() - t0) / 1000), toasts: pdf.toasts.slice(-4), xo: pdf.xo.slice(0, 300) }))
    console.log(`  （${BIG_N} 屏导出 PDF 用了 ${Math.round((Date.now() - t0) / 1000)} 秒，${pdf.f ? Math.round(fs.statSync(pdf.f).size / 1048576) : 0} MB）`)
    check(`屏多（#29）：收起来的第 1 屏和第 ${BIG_N} 屏互相跳的链接，PDF 里都能点`, (s.match(/\/Subtype \/Link /g) || []).length === 2, `${(s.match(/\/Subtype \/Link /g) || []).length} 个链接`)
    await shot('15-big-pdf')
    await sleep(500)
    const t1 = Date.now()
    const html = await run('html', 'html', 60000 + BIG_N * 300)
    const hs = html.f ? fs.readFileSync(html.f, 'utf8') : ''
    check(`屏多（#29）：整套 HTML 演示 ${BIG_N} 屏都在`, hs.includes(`id="ddp-s-${BIG_N - 1}"`) && !hs.includes(`id="ddp-s-${BIG_N}"`) && hs.includes('第1屏'), `${hs.length} 字`)
    console.log(`  （整套 HTML 用了 ${Math.round((Date.now() - t1) / 1000)} 秒，${Math.round(hs.length / 1048576)} MB）`)
  }

  // ⑬ 设计模式：会话顶上的模式切到「设计模式」，模型拿得到设计台的工具（整组起来了）；
  // 有 Office 的 DSH（0.2.2-rc.2 起）还要：加载 office 技能后有 Office 工具、技能目录里有 DSH 自带的 dsh-doc
  const modeCheck = async () => {
    const probe = async (tag) => {
      const n = probes.length
      await say(`MODE-PROBE ${tag}`)
      for (let i = 0; i < 120 && !(probes[n] && (probes[n].after || probes[n].noSkill)); i++) await sleep(250)
      // 加载技能后新增的工具，DSH 从下一轮才放进请求：再说一句
      if (probes[n]) { await sleep(1500); await say('MODE-NEXT 接着'); for (let i = 0; i < 80 && !probes[n].next; i++) await sleep(250) }
      return probes[n] || null
    }
    // 只看加载技能之后「下一轮」的工具：那时该在的都得在（不和加载那一轮的合在一起算）
    const officeOf = (p) => ((p && p.next) || []).filter((t) => /^office_/.test(t)).sort()
    const done = (p) => !!p && !p.noSkill && !!p.after && !!p.next // 探完了：有 skill 工具、加载技能回来了、下一轮也问到了
    const brief = (p) => JSON.stringify(p && { n: p.tools.length, doc: p.doc, office: officeOf(p), done: done(p), noSkill: !!p.noSkill, result: p.after && p.after.result })
    // 先在标准模式（这个会话）问一次，当作「应该是什么样」
    const std = await probe('standard')
    const label = (re) => `[...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter((x) => x.getClientRects().length && ${re}.test((x.textContent || '').trim()))`
    // 发过话的会话不能换模式：开个新会话再切
    await until(`(() => { const b = ${label('/^(新会话|New (session|chat))/i')}[0]; if (!b) return false; b.click(); return true })()`, 10000)
    await until(`!document.querySelector('[data-message-id], .conversation-turn') || ${label('/^(标准模式|Standard)/i')}.length > 0`, 10000)
    const opened = await until(`(() => { const b = ${label('/^(标准模式|Standard)/i')}[0]; if (!b) return false; b.click(); return true })()`, 10000)
    const picked = opened && await until(`(() => { const i = ${label('/^(设计模式|Design)/')}.pop(); if (!i) return false; i.click(); return true })()`, 5000)
    const now = await until(`${label('/^(设计模式|Design mode)$/i')}.length > 0 && ${label('/^(标准模式|Standard)/i')}.length === 0`, 5000)
    if (!check('会话顶上的模式切到「设计模式」', opened && picked && now, JSON.stringify({ opened, picked, now, btns: await page(`[...document.querySelectorAll('button, [role="button"], [role^="menuitem"], [role="option"]')].filter((x) => x.getClientRects().length).map((x) => (x.textContent || '').trim()).filter(Boolean).slice(0, 40)`) }))) return
    await shot('12-design-mode')
    const des = await probe('design')
    console.log(`  （标准 ${brief(std)}）\n  （设计 ${brief(des)}）`)
    const t = (des && des.tools) || []
    check('设计模式：模型拿得到设计台的工具（整组起来了）', ['preview_page', 'check_design', 'look_design', 'skill'].every((x) => t.includes(x)), brief(des))
    // 这版 DSH 带不带 Office（0.2.2-rc.2 起）：带的话两边都必须有三个 Office 工具和 dsh-doc，不能「两边都没有」也算一样
    const hasOffice = fs.existsSync(path.join(cliDir, '..', 'dsh-tool-office'))
    const hasDoc = fs.existsSync(path.join(cliDir, '..', 'dsh-agent-preset', 'skills', 'dsh-doc'))
    const want = JSON.stringify(hasOffice ? ['office_convert', 'office_recalculate', 'office_render'] : [])
    const why = `标准 ${brief(std)}；设计 ${brief(des)}`
    check('设计模式：标准模式和设计模式都探完了（没超时）', done(std) && done(des), why)
    check(`设计模式：Office 工具和标准模式一样（这版 DSH ${hasOffice ? '有' : '没有'} Office）`, JSON.stringify(officeOf(std)) === want && JSON.stringify(officeOf(des)) === want, why)
    check(`设计模式：DSH 自带的技能（dsh-doc）和标准模式一样（这版 DSH ${hasDoc ? '有' : '没有'}）`, !!std && !!des && std.doc === hasDoc && des.doc === hasDoc, why)
    // #28 的通知在设计模式的会话里也要到得了模型（设计台本体挂在最外层，不在设计模式那组里）
    await tuneCheck(true)
  }
  // 公网链接开着时在左边栏归档这个会话：链接马上失效（插件听 DSH 的归档事件）。要真通道，E2E_REAL_TUNNEL=1 才跑
  const archiveCheck = async () => {
    const sid = await page(`(() => { const n = performance.getEntriesByType('resource').map((e) => e.name).filter((x) => /\\/dsh-design-studio\\/api\\/state\\?/.test(x)).pop(); return n ? new URL(n).searchParams.get('session') : '' })()`)
    if (!check('归档：拿到当前会话', !!sid, sid)) return
    const api = (name, body) => page(`fetch('/dsh-design-studio/api/${name}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.json())`)
    const screens = fs.readdirSync(DESIGN).filter((f) => f.endsWith('.html')).sort().slice(0, 3).map((key) => ({ key, label: key }))
    await api('open', { session: sid, target: path.join(DESIGN, screens[0].key) })
    const st = await api('pubshare', { session: sid, on: true, target: `file|${DESIGN}`, title: 'archive', kind: 'app', w: 390, h: 844, screens })
    let link = ''
    for (let i = 0; i < 90 && !link; i++) { const x = await api('pubshare', { session: sid, peek: true }); if (x.on && x.state === 'ready') link = x.url; else await sleep(1000) }
    if (!check('归档：先开一条真公网链接', /trycloudflare\.com\//.test(link), JSON.stringify(st))) return
    let ok = 0
    for (let i = 0; i < 10 && ok !== 200; i++) { ok = await fetch(link).then((r) => r.status).catch(() => 0); if (ok !== 200) await sleep(1500) }
    check('归档：链接先是打得开的', ok === 200, String(ok))
    // 左边栏这个会话那一行的「归档」按钮（悬停才显示，直接点）：从带着会话 id 的元素往上找到有归档按钮的那一行
    const clicked = await page(`(() => {
      const sid = ${JSON.stringify(sid)}
      const marks = [...document.querySelectorAll('*')].filter((e) => !e.closest('.ddp') && [...e.attributes].some((a) => a.value.includes(sid)))
      for (const m of marks) {
        for (let e = m; e && e !== document.body; e = e.parentElement) {
          const b = [...e.querySelectorAll('button[aria-label]')].filter((x) => /归档|Archive/i.test(x.getAttribute('aria-label')) && !/取消|Unarchive/i.test(x.getAttribute('aria-label')))
          if (b.length === 1) { b[0].click(); return b[0].getAttribute('aria-label') }
          if (b.length > 1) break
        }
      }
      return 'marks=' + marks.length + ' btns=' + [...document.querySelectorAll('button[aria-label]')].map((x) => x.getAttribute('aria-label')).filter((l) => /归档|Archive/i.test(l)).join('|')
    })()`)
    // 会话还有活儿在跑时 DSH 会先问一句：点确认
    await sleep(800)
    await page(`(() => { const d = document.querySelector('[role=dialog], [role=alertdialog]'); const b = d && [...d.querySelectorAll('button')].filter((x) => /归档|Archive|停止|Stop/i.test(x.textContent)).pop(); if (b) b.click(); return !!b })()`)
    let after = 200
    for (let i = 0; i < 8 && after === 200; i++) { await sleep(1000); after = await fetch(link).then((r) => r.status).catch(() => 0) }
    const peek = await api('pubshare', { session: sid, peek: true })
    // 点的得是「归档」按钮；关掉的原因不能是「换了设计 / 到点 / 断了」（归档走的是 stop，不留原因）
    check('归档会话：公网链接马上失效、插件里也关了', /^(归档|Archive)/i.test(clicked || '') && after !== 200 && !peek.on && !peek.ended && !peek.error, JSON.stringify({ clicked, after, peek: { on: peek.on, ended: peek.ended, error: peek.error } }))
    console.log(`  （归档点的是：${clicked}）`)
    await shot('13-archived')
  }
  const logCheck = () => {
    const errs = webLog.split('\n').filter((l) => /dsh-design-studio/i.test(l) && /error|fail|失败/i.test(l))
    check('DSH 日志里没有设计台的报错', !errs.length, errs.slice(0, 5).join('\n'))
  }
  if (MODE_ONLY) { await modeCheck(); logCheck(); throw MODE_DONE }
  if (ONLY_28) { await tuneCheck(); await bigCheck(); await modeCheck(); logCheck(); throw MODE_DONE }

  // ②0 第一屏边写边看：右侧栏关着，草稿一开始流就弹出来，不等文件落地
  fs.mkdirSync(path.dirname(FIRST_DRAFT), { recursive: true })
  const drawerShut = await page(`!document.querySelector('.ddp-stage, .ddp-home')`)
  await say('DRAFT-FIRST 写第一屏')
  const earlyDraft = await until(`!!document.querySelector('.ddp-stage, .ddp-home')`, 7000)
  check('第一屏边写边看：右侧栏关着，草稿开始流就弹出来（文件还没落地）', drawerShut === true && !!earlyDraft && !fs.existsSync(FIRST_DRAFT), JSON.stringify({ drawerShut, earlyDraft, landed: fs.existsSync(FIRST_DRAFT) }))
  await shot('draft-first')
  for (let i = 0; i < 60 && !fs.existsSync(FIRST_DRAFT); i++) await sleep(250)
  await sleep(2500)

  // ② 模型调 preview_page → 右侧栏画布三屏
  await say('DESIGN-OPEN 做一个咖啡 App')
  const frames = await until(`document.querySelectorAll('iframe[src*="127.0.0.1"]').length >= 3 && document.querySelectorAll('iframe[src*="127.0.0.1"]').length`, 60000)
  check('右侧栏打开，画布三屏', frames >= 3, `iframe ${frames}；模型请求 ${JSON.stringify(llmLog.slice(-3))}；页面 ${(await page('document.body.innerText.slice(-500)').catch((e) => e.message))}`)
  await sleep(2500) // 等预览页里的 picker 就绪
  await shot('1-canvas')

  // ②b 模型自己体检：调 check_design → 右侧栏量完把清单交回
  async function waitFor(fn, ms) {
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
  const ASKING = `[...document.querySelectorAll('.ddp-busy, .ddp-chip')].some((c) => /在等你回答|waiting for your answer/.test(c.textContent))`
  await say('ASK-ME 先问问我')
  const asking = await until(ASKING, 30000)
  check('模型提问时右侧栏提示「在等你回答」', asking, await page(`[...document.querySelectorAll('.ddp-busy, .ddp-chip')].map((c) => c.textContent).join(' | ') || '没有提示条'`))
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
  check('答完以后提示没了', answered === 'ok' && notAsking, `${answered} / ${await page(`[...document.querySelectorAll('.ddp-busy, .ddp-chip')].map((c) => c.textContent).join(' | ')`)}`)
  await sleep(3000) // 这一轮结束后的自动体检

  // ③ 设计体检
  const CHECK_BTN = `[...document.querySelectorAll('.ddp-dock button')].find((b) => /^(体检|Check)$/.test(b.dataset.tip || ''))`
  const BADGE = `(${CHECK_BTN}?.querySelector('.bdg')?.textContent || '')`
  check('工具栏有体检按钮', await until(`!!${CHECK_BTN}`, 10000))
  const badge = await until(BADGE, 15000)
  check('打开设计自动量了一下，按钮上标着 4', badge === '4', `「${badge}」`)
  await shot('1b-badge')
  await page(`${CHECK_BTN}.click()`)
  const DONE = `(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.dd-sh .sub')?.textContent || '') })()`
  check('体检面板出来、跑完', await until(DONE, 30000), await page(`document.querySelector('.ddp-check')?.innerText || '没有面板'`))
  const items = await page(`[...document.querySelectorAll('.ddp-check .ddp-ck .nm')].map((x) => x.textContent)`)
  console.log(`  （体检结果：${items.join(' ｜ ')}）`)
  const has = (re) => items.some((x) => re.test(x))
  check('查出点击区太小', has(/点击区太小|Tap target/))
  check('查出对比度不够', has(/对比度不够|contrast/i))
  check('查出文字被截断', has(/文字被截断|clipped|cut off/i))
  check('查出字太小', has(/字太小|too small/i))
  const groups = await page(`[...document.querySelectorAll('.ddp-check .ddp-ck .vl')].map((x) => x.textContent).slice(0, 8)`)
  check('问题都在首屏（菜单、购物车干净）', !items.some((x) => /菜单|购物车/.test(x)) && !groups.some((g) => /菜单|购物车|menu|cart/i.test(g)), JSON.stringify(groups))
  await shot('2-check')
  await page(`document.querySelector('.ddp-check .ddp-ck').click()`)
  await sleep(700)
  await shot('3-focus')

  // 让模型改 → 输入框里是体检清单，发出去模型收得到
  await page(`document.querySelector('.ddp-check .dd-sf .dd-bt.pri').click()`)
  const asked = await until(`(() => { const t = ${composerText}; return /〔设计体检〕|\\[Design check\\]/.test(t) && t })()`, 5000)
  check('「让模型改」把清单放进输入框', asked, await page(composerText))
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
  const cartIssues = await until(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.dd-sh .sub')?.textContent || '') && p.querySelectorAll('.ddp-ck').length && /购物车/.test(p.querySelector('.bd').innerText) && p.querySelectorAll('.ddp-ck').length })()`, 30000)
  check('面板开着时模型改完，面板自己重新量（购物车出了问题）', cartIssues >= 2, await page(`document.querySelector('.ddp-check')?.innerText || '没有面板'`))
  await sleep(900) // 画布挪动的动画
  const seen = await page(`(() => {
    const cell = [...document.querySelectorAll('.ddp-cell')].find((c) => /购物车/.test(c.querySelector('.ddp-lab')?.textContent || ''))
    const p = document.querySelector('.dd-sheet')
    if (!cell || !p) return 'no cell / panel'
    const a = cell.getBoundingClientRect(), b = p.getBoundingClientRect()
    // 窄栏：面板是底下的抽屉，屏要在它上面；宽：面板在右边，屏在它左边
    return (p.classList.contains('wide') ? a.right <= b.left + 2 : a.top < b.top - 40) ? 'ok' : 'cell ' + [a.left, a.right, a.top, a.bottom].map(Math.round).join(',') + ' panel ' + [b.left, b.top].map(Math.round).join(',')
  })()`)
  check('有问题的那屏不被面板挡住', seen === 'ok', seen)
  await shot('4b-cart')
  await page(closeSheet)

  // 面板关着时模型再自己量一次：这回问题在购物车
  await say('SELF-CHECK 再量一下')
  const self2 = await waitFor(() => selfChecks[1], 40000)
  check('面板关着也能自己体检：清单只列购物车', JSON.stringify(flagged(self2)) === '["cart.html"]', self2 || JSON.stringify(llmLog.slice(-3)))
  await sleep(3500) // 这一轮结束后的自动体检

  // ⑤ 导出 PDF / PPT
  const EXPORTS = path.join(DESIGN, 'exports')
  const exportAs = async (kind, ext) => {
    const item = await page(exportJs(kind))
    if (!check(kind === 'html' ? '分享面板有「HTML 演示」、点得了导出' : `导出面板有 ${ext.toUpperCase()} 页签、点得了导出`, item)) return null
    const end2 = Date.now() + 60000
    let f = null
    while (Date.now() < end2 && !(f = (fs.existsSync(EXPORTS) ? fs.readdirSync(EXPORTS) : []).find((x) => x.endsWith('.' + ext)))) await sleep(500)
    const toast = await until(`(() => { const t = document.querySelector('.ddp-toast'); return t && t.innerText })()`, 5000)
    check(`导出 ${ext.toUpperCase()} 存进设计目录 exports/`, f, `toast ${toast}`)
    if (toast) console.log(`  （提示：${toast.replace(/\n/g, ' ')}）`)
    return f && path.join(EXPORTS, f)
  }
  const pdf = await exportAs('pdf', 'pdf')
  if (pdf) {
    const s = fs.readFileSync(pdf, 'latin1')
    check('PDF 三页', (s.match(/\/Type \/Page\b/g) || []).length === 3, `${(s.match(/\/Type \/Page\b/g) || []).length} 页`)
    check('PDF 里「去点单」「加入购物车」能点、跳到下一页', (s.match(/\/Subtype \/Link /g) || []).length === 2, `${(s.match(/\/Subtype \/Link /g) || []).length} 个链接`)
    check('PDF 有每屏的书签', /\/Type \/Outlines [^>]*\/Count 3/.test(s))
  }
  await sleep(500)
  const pptx = await exportAs('pptx', 'pptx')
  if (pptx) {
    const py = spawnSync('python3', ['-c', 'import sys; from pptx import Presentation; p = Presentation(sys.argv[1]); print(len(p.slides), p.slide_width, p.slide_height)', pptx], { encoding: 'utf8' })
    if (py.status === 0) {
      const [n, w, hh] = py.stdout.trim().split(/\s+/).map(Number)
      check('PPT 三张、竖版（App 画幅）', n === 3 && hh > w, py.stdout.trim())
    } else console.log(`  （没装 python-pptx，PPT 只看了文件：${(py.stderr || '').trim().split('\n').pop()}）`)
    const jumps = spawnSync('python3', ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(" ".join(str(z.read(f"ppt/slides/slide{i}.xml").decode().count("hlinksldjump")) for i in (1, 2, 3)))', pptx], { encoding: 'utf8' })
    check('PPT 里按钮能点（放映时跳到下一张）', jumps.stdout.trim() === '1 1 0', jumps.stdout.trim() || jumps.stderr)
  }
  await sleep(500)
  // 整套 HTML 演示（#26）：一个文件、三屏都在、没有本机地址；导出时不算设计改了
  const demo = await exportAs('html', 'html')
  if (demo) {
    const s = fs.readFileSync(demo, 'utf8')
    fs.copyFileSync(demo, path.join(SHOTS, '5-demo.html')) // 跟截图一起留着：之后从 file:// 打开看真导出的样子
    check('HTML 演示：三屏都在，没有本机地址', [0, 1, 2].every((i) => s.includes(`id="ddp-s-${i}"`)) && !s.includes('id="ddp-s-3"') && !/127\.0\.0\.1|localhost|__dsh_design__/.test(s), `${s.length} 字`)
  }
  // 公网链接（#27，实验）：导出菜单进去，先说清楚是公网可见（有没有 cloudflared 给「生成链接」或「下载」）。
  // E2E_REAL_TUNNEL=1 时真开一条 Cloudflare 临时通道：链接打得开、是这套演示、关了马上失效（要联网，CI 不跑）
  const pubItem = await page(openSheet('分享', 'share', '/公网链接|Public link/'))
  check('分享面板有「公网链接」页签', pubItem)
  const pubIntro = await until(`(() => { const p = document.querySelector('.ddp-pub'); return p && /不在身边|not nearby/.test(p.innerText) && [...p.querySelectorAll('.dd-bt')].map((b) => b.textContent).join('|') })()`, 8000)
  check('公网链接面板：先说清楚公网可见，给「生成链接」或「下载 cloudflared」', /生成链接|Create link|下载|Download/.test(pubIntro || ''), pubIntro)
  await shot('5-publink')
  // 要测真通道却没有「生成链接」（本机找不到 cloudflared）：明说没测，别悄悄跳过
  if (process.env.E2E_REAL_TUNNEL === '1') check('真通道：本机找得到 cloudflared（有「生成链接」）', /生成链接|Create link/.test(pubIntro || ''), pubIntro)
  if (process.env.E2E_REAL_TUNNEL === '1' && /生成链接|Create link/.test(pubIntro || '')) {
    await page(`[...document.querySelectorAll('.ddp-pub .dd-bt')].find((b) => /生成链接|Create link/.test(b.textContent)).click()`)
    const link = await until(`(() => { const i = document.querySelector('.ddp-pub .ddp-publink'); return i && i.value })()`, 90000)
    check('真通道：连上了，给出 trycloudflare 链接和二维码', /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/[\w-]{20,}$/.test(link || '') && !!(await page(`!!document.querySelector('.ddp-pub .qr path')`)), link)
    await shot('5-publink-on')
    if (link) {
      let got = null
      for (let i = 0; i < 10 && !(got && got.status === 200); i++) { got = await fetch(link).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: e.message })); if (got.status !== 200) await sleep(1500) }
      check('真通道：从公网打开是这套演示（三屏都在）', got && got.status === 200 && [0, 1, 2].every((i) => got.text.includes(`id="ddp-s-${i}"`)), got && got.status)
      const root = await fetch(link.replace(/\/[^/]+$/, '/')).then((r) => r.status).catch(() => 0)
      check('真通道：不带口令的根地址 404', root === 404, String(root))
      await page(`[...document.querySelectorAll('.ddp-pub .dd-bt')].find((b) => /停止分享|Stop sharing/.test(b.textContent)).click()`)
      await sleep(3000)
      const after = await fetch(link).then((r) => r.status).catch(() => 0)
      check('真通道：停止分享后链接马上失效', after !== 200, String(after))
    }
  }
  await page(closeSheet)
  await sleep(1500)
  const stray = await page(`(document.body.innerText.match(/(已更新|Updated) coffee-app[^\\n]*/) || [''])[0]`)
  check('导出的 PDF / PPT / HTML 不算设计改动（不报「已更新」）', !stray, stray)
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
  await page(`document.querySelector('.ddp-dock button[data-tip="调样式"]').click()`)
  const panelTip = await until(`((x) => /在页面上点一个元素/.test(x) && x)(document.querySelector('.ddp-style')?.innerText || '')`, 5000)
  await sleep(800) // 抽屉升起来、画布让出位置
  const aside = await page(`(() => { const d = document.querySelector('.dd-sheet'), f = document.querySelector('iframe.ddp-frame.cur'); if (!d || !f) return 'none'; const a = d.getBoundingClientRect(), b = f.getBoundingClientRect(); return a.left >= b.right - 1 || b.bottom <= a.top + 1 })()`)
  check('调样式：面板打开，提示先点一个元素；单页的手机让开面板（窄栏在抽屉上面，宽栏在左边）', /在页面上点一个元素/.test(panelTip || '') && aside === true, `${panelTip} / clear=${aside}`)
  // 预览页里的元素：从 DOM 树进 iframe 找到它，量出在整个窗口里的位置（同站的 iframe，DOM.getDocument 能穿进去）
  async function nodeIn(key, selector) {
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
  async function clickIn(key, selector) {
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
    const row = [...document.querySelectorAll('.ddp-style .dd-f')].find((x) => x.querySelector('.lbl>span')?.textContent === ${JSON.stringify(label)})
    const r = row && row.querySelector('input[type=range]')
    if (!r) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, ${JSON.stringify(String(v))})
    r.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await clickIn('menu.html', 'a.go')
  // 头部给人看的是「按钮「加入购物车」」，选择器在 title 里；变量显示中文名，原名在 title 里
  const who = await until(`(document.querySelector('.ddp-style .dd-sh .sub')?.title || '').split(' · ')[0]`, 5000)
  const bgVar = await page(`[...document.querySelectorAll('.ddp-style .dd-f')].find((x) => x.querySelector('.lbl>span')?.textContent === '背景')?.querySelector('em.v')?.title || ''`)
  check('调样式：点页面里的按钮 → 面板认出它、背景用的是设计变量 --brand', who === 'a.go' && /--brand\b/.test(bgVar), `${who} / ${bgVar}`)
  // #24 复制色值：背景用的是变量 --brand，复制出去的是它的值 #6B3E26；按钮字先变「已复制」再换回来
  const colGo = await page(`(() => {
    window.__ddpCp = null
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (x) => { window.__ddpCp = x; return Promise.resolve() } } }) } catch { return 'no-stub' }
    const b = [...document.querySelectorAll('.ddp-style .dd-f')].find((x) => x.querySelector('.lbl>span')?.textContent === '背景')?.querySelector('.lbl .cp')
    if (!b) return 'no-button'
    b.click()
    return 'ok'
  })()`)
  const colTxt = await until(`window.__ddpCp || ''`, 3000)
  const colSaid = await until(`[...document.querySelectorAll('.ddp-style .lbl .cp')].some((x) => x.classList.contains('ok') && x.dataset.tip === '已复制')`, 3000)
  const colBack = await until(`![...document.querySelectorAll('.ddp-style .lbl .cp')].some((x) => x.classList.contains('ok'))`, 4000)
  check('调样式：背景旁点「复制」→ 复制出变量的色值 #6B3E26，按钮先说「已复制」再换回「复制」', colGo === 'ok' && colTxt === '#6B3E26' && colSaid && colBack, `${colGo} / ${colTxt} / ${colSaid} / ${colBack}`)
  await page(`delete navigator.clipboard`) // 换回真的剪贴板，后面复制图片还要用
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
  await page(`[...document.querySelectorAll('.ddp-style footer button')].find((x) => x.textContent === '让模型改').click()`)
  await sleep(500)
  const askTxt = await page(composerText)
  check('调样式：再拖字号「让模型改」→ 输入框里是〔调样式〕和改了什么', /〔调样式〕a\.go/.test(askTxt) && /字号 16px → 18px/.test(askTxt) && askTxt.includes(path.join(DESIGN, 'menu.html')), askTxt.slice(0, 200))
  const styChip = await asChip('style', '样式改动', /〔调样式〕/)
  check('调样式在输入框里是一个标签「样式改动」', styChip.ok, styChip.why)
  await shot('7-style')
  await page(`document.querySelector('.ddp-dock button[data-tip="调样式"]').click()`)
  await sleep(600)
  const after = await styleAttr('menu.html', 'a.go')
  check('调样式：退出 → 没写回的字号撤掉，写回的圆角还在', after !== null && /border-radius:\s*24px/.test(after) && !/font-size/.test(after) && !(await page(`!!document.querySelector('.ddp-style')`)), after)

  // ⑦a 改字（1.0）：点开一段字 → 页面里字的上方有「标题 · 字号 / 粗细」小标签、灵动条上方换成「↵ 保存 · Esc 取消」；
  // 回车写回文件，改字开着时不弹「已改好」，胶囊里多「这次改了 1 处 · 撤销」；点撤销 → 文件换回原样
  const menuFile = () => fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8')
  const menu0 = menuFile()
  await page(`document.querySelector('.ddp-dock button[data-tip="改字"]').click()`)
  await until(`!!document.querySelector('.ddp-stage>.dd-edbar')`, 4000)
  await clickIn('menu.html', 'h1')
  const edOn = await until(`((b) => b && b.classList.contains('on') && b.innerText)(document.querySelector('.ddp-stage>.dd-edbar'))`, 4000)
  // 小标签在页面里关着的 shadow root 里：用 DOM 树（pierce 能穿进去）找 class="tag"、style 里 display: flex 的那个
  const edTag = await (async () => {
    const { root } = await chrome.cdp('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
    let hit = ''
    const txt = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children || []).map(txt).join(''))
    const walk = (n, inShadow) => {
      if (hit || !n) return
      const a = n.attributes || []
      const at = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : '' }
      if (inShadow && at('class') === 'tag' && /display:\s*flex/.test(at('style'))) { hit = txt(n).trim(); return }
      for (const c of n.children || []) walk(c, inShadow)
      for (const r of n.shadowRoots || []) walk(r, true)
      if (n.contentDocument) walk(n.contentDocument, false)
    }
    walk(root, false)
    return hit
  })()
  check('改字：点开标题 → 灵动条上方是「↵ 保存 · Esc 取消」，页面里有「标题 · 字号 / 粗细」小标签', /保存/.test(edOn || '') && /取消/.test(edOn || '') && /^标题 · \d+ \/ /.test(edTag || ''), `${edOn} / ${edTag}`)
  await chrome.cdp('Input.insertText', { text: '饮品单' }, sessionId)
  await sleep(200)
  for (const type of ['keyDown', 'keyUp']) await chrome.cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }, sessionId)
  const edSaved = await waitFor(() => menuFile().includes('<h1>饮品单</h1>'), 8000)
  const edBar = await until(`((b) => b && !b.classList.contains('on') && b.querySelector('.n') && b.querySelector('.dd-bt') ? b.innerText : '')(document.querySelector('.ddp-stage>.dd-edbar'))`, 5000)
  const edToast = await page(`/已改好/.test(document.body.innerText)`)
  check('改字：回车写回文件；改字开着不弹「已改好」，胶囊里是「这次改了 1 处 · 撤销」', edSaved && /这次改了 1 处/.test(edBar || '') && /撤销/.test(edBar || '') && !edToast, `${edSaved} / ${edBar} / toast=${edToast}`)
  await page(`document.querySelector('.ddp-stage>.dd-edbar .dd-bt').click()`)
  const edUndone = await waitFor(() => menuFile() === menu0, 8000)
  const edGone = await until(`!document.querySelector('.ddp-stage>.dd-edbar .n')`, 4000)
  check('改字：点「撤销」→ 文件换回原样，「这次改了几处」跟着没了', edUndone && edGone, menuFile().slice(-200))
  await sleep(2000) // 文件变了，预览在后台换一帧
  await page(`document.querySelector('.ddp-dock button[data-tip="改字"]').click()`)
  await until(`!document.querySelector('.ddp-stage>.dd-edbar')`, 4000)

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

  // 在某个 iframe 里算（frameExpr 是在 DSH 页面里找到那个 iframe 的表达式）
  async function inPage(frameExpr, expression) {
    await chrome.cdp('Runtime.enable', {}, sessionId)
    const { result } = await chrome.cdp('Runtime.evaluate', { expression: frameExpr }, sessionId)
    const { node } = await chrome.cdp('DOM.describeNode', { objectId: result.objectId }, sessionId)
    const c = chrome.events.filter((m) => m.sessionId === sessionId && m.method === 'Runtime.executionContextCreated' && m.params.context.auxData && m.params.context.auxData.frameId === node.frameId && m.params.context.auxData.isDefault).pop()
    const r = await chrome.cdp('Runtime.evaluate', { expression, contextId: c.params.context.id, returnByValue: true }, sessionId)
    return r.result && r.result.value
  }
  // ⑦c 业务标注：开关关着没有按钮；开着：按钮带条数、面板和编号、卡片和编号互相定位、点选时编号收起
  // 1.0：业务标注并进「体检」面板的第二个页签；命令面板里有「业务标注」这条
  const anToggle = palJs('业务标注')
  if (!ANNOT) check('业务标注：开关关着时没有入口（命令面板里也没有）', !((await page(palRows('业务标注'))) || ['?']).some((x) => /业务标注/.test(x) && !/^「/.test(x)))  // 「业务标注」那行是「说给模型听」，不算入口
  else {
    await page(CANVAS)
    await sleep(600)
    const anCmd = await until(`(${palRows('业务标注')}).then((r) => (r || []).includes('业务标注'))`, 15000)
    check('业务标注：命令面板里有「业务标注」', anCmd)
    await page(anToggle)
    check('业务标注：开在「体检」面板的「业务标注」页签', await until(`((tb) => !!tb && tb.getAttribute('aria-selected') === 'true')([...document.querySelectorAll('.dd-sheet[data-sheet="check"] [role=tab]')].find((x) => /业务标注/.test(x.textContent)))`, 5000))
    const cards = await until(`document.querySelectorAll('.ddp-anp .ddp-ancard').length`, 5000)
    check('业务标注：点开出卡片', cards === ANNOTS.annotations.length, String(cards))
    const lost = await until(`[...document.querySelectorAll('.ddp-anp .ddp-ancard.lost')].map((x) => x.getAttribute('data-an')).join()`, 15000)
    check('业务标注：定位不到的标出来（编号真画到页面里了）', lost === 'menu-03', lost)
    check('业务标注：定位不到的排在这一屏最后', await page(`[...document.querySelectorAll('.ddp-anp .ddp-ancard')].map((x) => x.getAttribute('data-an')).join()`) === 'menu-01,menu-02,menu-03,cart-01,cart-02', await page(`[...document.querySelectorAll('.ddp-anp .ddp-ancard')].map((x) => x.getAttribute('data-an')).join()`))
    check('业务标注：正文的加粗和列表', await page(`(() => { const c = document.querySelector('[data-an="menu-01"]'); return !!c.querySelector('.md b') && !!c.querySelector('.md li') && !!c.querySelector('.tag') })()`))
    check('业务标注：有定位不到的就有「让模型改」', await page(`[...document.querySelectorAll('.ddp-anp .dd-sf button')].some((b) => b.textContent.includes('让模型改'))`))
    await shot('6b-annot-canvas')
    // 页面里的元素 → 外层坐标（画布缩放过）：编号在元素左上角
    const dotAt = async (key, sel) => {
      const frame = `(() => { const s = document.querySelector('.ddp-shield[data-key="${key}"]'); return s ? s.parentElement.querySelector('iframe:not([style*="hidden"])') || s.parentElement.querySelector('iframe') : document.querySelector('.ddp-body iframe') })()`
      const { result } = await chrome.cdp('Runtime.evaluate', { expression: frame }, sessionId)
      const { node } = await chrome.cdp('DOM.describeNode', { objectId: result.objectId }, sessionId)
      const { executionContextId } = await chrome.cdp('Page.createIsolatedWorld', { frameId: node.frameId, worldName: 'e2e-an' }, sessionId)
      const r = await chrome.cdp('Runtime.evaluate', { expression: `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.left, b.top] })()`, contextId: executionContextId, returnByValue: true }, sessionId)
      const fr = await page(`(() => { const f = ${frame}; const b = f.getBoundingClientRect(); return [b.left, b.top, b.width / f.offsetWidth] })()`)
      return { x: fr[0] + r.result.value[0] * fr[2] + 2, y: fr[1] + r.result.value[1] * fr[2] + 2 }
    }
    const realClick = async ({ x, y }) => {
      await chrome.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
      for (const type of ['mousePressed', 'mouseReleased']) await chrome.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId)
    }
    const selCard = `(document.querySelector('.ddp-anp .ddp-ancard.sel') || { getAttribute() { return '' } }).getAttribute('data-an')`
    await page(`document.querySelector('[data-an="cart-01"]').click(), 1`)
    check('业务标注：点卡片选中它', await until(`${selCard} === 'cart-01'`, 3000))
    await sleep(700)
    await realClick(await dotAt('menu.html', '.go'))
    check('业务标注：画布上点编号，右边对应的卡片选中', await until(`${selCard} === 'menu-02'`, 3000), await page(selCard))
    // 页面里现在画着哪几条（编号在 closed shadow 里，问页面自己；点选模式没有挡板，按屏名找 iframe）
    const cellFrame = (key) => `document.querySelector('.ddp-lab[data-key="${key}"]').closest('.ddp-cell').querySelector('iframe')`
    const marksIn = async (key) => (await inPage(cellFrame(key), 'window.__dshDesign.annotMarks()')) || []
    check('业务标注：页面上画着编号（定位不到的不画）', (await marksIn('menu.html')).join() === 'menu-01,menu-02', JSON.stringify(await marksIn('menu.html')))
    check('业务标注：整屏的说明也有编号', (await marksIn('cart.html')).includes('cart-02'), JSON.stringify(await marksIn('cart.html')))
    await inPage(cellFrame('cart.html'), `(() => { const m = document.createElement('main'); m.id = 'e2e-main'; m.style.cssText = 'height:80px;overflow:auto'; m.innerHTML = '<div style="height:600px"></div>'; document.body.append(m); m.scrollTop = 300; return m.scrollTop })()`)
    await page(`document.querySelector('[data-an="cart-02"]').click(), 1`)
    await sleep(500)
    check('业务标注：点整屏的说明，里面的滚动区也回顶', (await inPage(cellFrame('cart.html'), `document.getElementById('e2e-main').scrollTop`)) === 0)
    await inPage(cellFrame('cart.html'), `(document.getElementById('e2e-main').remove(), 1)`)
    const pickBtn = `[...document.querySelectorAll('.ddp-tool')].find((b) => /^(选择|选择中)/.test(b.textContent.trim()))`
    await page(`${pickBtn}.click(), 1`)
    await sleep(600)
    check('业务标注：点选时编号收起', (await marksIn('menu.html')).length === 0, JSON.stringify(await marksIn('menu.html')))
    await page(`${pickBtn}.click(), 1`)
    await sleep(800)
    check('业务标注：退出点选后编号回来', (await marksIn('menu.html')).length === 2, JSON.stringify(await marksIn('menu.html')))
    await realClick(await dotAt('menu.html', 'h1'))
    check('业务标注：回来后的编号点得到', await until(`${selCard} === 'menu-01'`, 3000), await page(selCard))
    // 页面后来才长出那个元素：补上编号，状态跟着变；藏在里面滚动区的，点卡片滚出来
    await inPage(cellFrame('menu.html'), `(() => { const d = document.createElement('div'); d.id = 'e2e-sc'; d.style.cssText = 'height:40px;overflow:auto'; d.innerHTML = '<div style="height:400px"></div><p class="gone">后来才有</p>'; document.body.append(d); return 1 })()`)
    check('业务标注：页面后来长出元素 → 卡片不再标定位不到', await until(`!document.querySelector('[data-an="menu-03"].lost')`, 5000))
    check('业务标注：藏在里面滚动区没滚到的，编号先不飘出来', !(await marksIn('menu.html')).includes('menu-03'), JSON.stringify(await marksIn('menu.html')))
    await page(`document.querySelector('[data-an="menu-03"]').click(), 1`)
    await sleep(900)
    check('业务标注：点卡片把里面滚动区滚到它，编号出来', (await inPage(cellFrame('menu.html'), `document.getElementById('e2e-sc').scrollTop`)) > 0 && (await marksIn('menu.html')).includes('menu-03'), JSON.stringify(await marksIn('menu.html')))
    const partAt = await inPage(cellFrame('menu.html'), `(() => { const d = document.getElementById('e2e-sc'); const p = d.querySelector('.gone'); d.scrollTop = p.offsetTop - d.offsetTop - d.clientHeight + 8; return d.scrollTop })()`)
    await sleep(300)
    await page(`document.querySelector('[data-an="menu-03"]').click(), 1`)
    await sleep(900)
    const pageY = await inPage(cellFrame('menu.html'), `(() => { const h = document.getElementById('e2e-sc'); h.style.height = '40px'; const sp = document.createElement('div'); sp.id = 'e2e-sp'; sp.style.height = '1600px'; document.body.append(sp); const b = document.querySelector('h1').getBoundingClientRect(); scrollTo(0, scrollY + b.top + b.height / 2); return scrollY })()`)
    await sleep(300)
    await page(`document.querySelector('[data-an="menu-01"]').click(), 1`)
    await sleep(900)
    const pageYAfter = await inPage(cellFrame('menu.html'), `(() => { const y = scrollY; document.getElementById('e2e-sp').remove(); scrollTo(0, 0); return y })()`)
    check('业务标注：被视口边切掉一截的也滚过去', pageYAfter < pageY, JSON.stringify([pageY, pageYAfter]))
    check('业务标注：只露出一点点的也滚过去', (await inPage(cellFrame('menu.html'), `document.getElementById('e2e-sc').scrollTop`)) > partAt)
    await inPage(cellFrame('menu.html'), `(document.getElementById('e2e-sc').remove(), 1)`)
    check('业务标注：元素又没了 → 标回定位不到', await until(`!!document.querySelector('[data-an="menu-03"].lost')`, 5000))
    // 和交付面板互斥（先开「转成代码」再开标注，只留一个）
    await page(openSheet('转成代码', 'code'))
    const hoUp = await until(`!!document.querySelector('.ddp-ho') && !document.querySelector('.ddp-anp')`, 5000)
    await page(anToggle)
    check('业务标注：和「转成代码」面板互斥', hoUp && await until(`!!document.querySelector('.ddp-anp') && !document.querySelector('.ddp-ho')`, 3000), await page(`document.querySelectorAll('.ddp-ho').length + '/' + document.querySelectorAll('.ddp-anp').length`))
    // 改文件：卡片跟着变，页面不重载
    const probe = await (async () => {
      const { result } = await chrome.cdp('Runtime.evaluate', { expression: `document.querySelector('.ddp-shield[data-key="menu.html"]').parentElement.querySelector('iframe')` }, sessionId)
      const { node } = await chrome.cdp('DOM.describeNode', { objectId: result.objectId }, sessionId)
      return node.frameId
    })()
    const world = async () => (await chrome.cdp('Page.createIsolatedWorld', { frameId: probe, worldName: 'e2e-an2' }, sessionId)).executionContextId
    await chrome.cdp('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-e2e-mark', '1')`, contextId: await world() }, sessionId)
    const more = { annotations: [...ANNOTS.annotations.slice(0, 2), ANNOTS.annotations[3], { id: 'menu-09', page: 'menu.html', title: '新加的一条', selector: 'h1' }] }
    fs.writeFileSync(path.join(DESIGN, 'annotations.json'), JSON.stringify(more))
    check('业务标注：改文件后卡片跟着变', await until(`!!document.querySelector('[data-an="menu-09"]') && !document.querySelector('[data-an="menu-03"]')`, 8000))
    await sleep(1200)
    const still = await chrome.cdp('Runtime.evaluate', { expression: `document.documentElement.getAttribute('data-e2e-mark')`, contextId: await world(), returnByValue: true }, sessionId)
    check('业务标注：改文件页面不重载', still.result.value === '1', JSON.stringify(still.result))
    // 转到单页：编号跟过去；点卡片换屏
    await page(`document.querySelector('[data-an="cart-01"]').click(), 1`)
    await sleep(400)
    await page(SINGLE)
    await until(`!!document.querySelector('.ddp-anp')`, 3000)
    await sleep(1200)
    await shot('6b-annot-single')
    await page(`window.__anGone = 0; window.__anT = setInterval(() => { if (![...document.querySelectorAll('.dd-sheet [role=tab]')].some((x) => /业务标注/.test(x.textContent))) window.__anGone++ }, 30), 1`)
    await page(`document.querySelector('[data-an="menu-02"]').click(), 1`)
    check('业务标注：单页时点别的屏的卡片，换到那一屏', await until(`/菜单|menu/i.test((document.querySelector('.ddp-top .ddp-addr') || {}).textContent || '') || !!document.querySelector('iframe[src*="menu.html"]')`, 6000))
    await sleep(1500)
    const singleFrame = `[...document.querySelectorAll('.ddp-body iframe')].filter((f) => f.getClientRects().length && getComputedStyle(f).visibility !== 'hidden').pop()`
    let focused = ''
    for (let i = 0; i < 25 && focused !== 'menu-02'; i++) { focused = await inPage(singleFrame, 'window.__dshDesign.annotLast()').catch(() => ''); if (focused !== 'menu-02') await sleep(200) }
    check('业务标注：换过去以后定位到那一条', focused === 'menu-02', String(focused))
    // 页面里的链接把这一帧带到别的屏：标注跟着实际那屏走，不把菜单的规则标到购物车上
    await inPage(singleFrame, `(document.querySelector('a.go').click(), 1)`)
    let after = []
    for (let i = 0; i < 30 && !after.includes('cart-01'); i++) { await sleep(200); after = (await inPage(singleFrame, 'window.__dshDesign && window.__dshDesign.annotMarks()').catch(() => [])) || [] }
    check('业务标注：点页面里的链接到购物车，编号换成购物车的', after.includes('cart-01') && !after.includes('menu-01'), JSON.stringify(after))
    await page(`document.querySelector('[data-an="menu-01"]').click(), 1`)
    let back = []
    for (let i = 0; i < 40 && !back.includes('menu-01'); i++) { await sleep(200); back = (await inPage(singleFrame, 'window.__dshDesign && window.__dshDesign.annotMarks()').catch(() => [])) || [] }
    await sleep(300)
    const backFocus = await inPage(singleFrame, 'window.__dshDesign.annotLast()')
    check('业务标注：走到别的屏后点这屏的卡片，回到这屏并定位', back.includes('menu-01') && !back.includes('cart-01') && backFocus === 'menu-01', JSON.stringify({ back, backFocus }))
    check('业务标注：换屏过程中按钮一直在（换屏的回包也带标注）', await page(`(clearInterval(window.__anT), window.__anGone)`) === 0, String(await page('window.__anGone')))
    await page(anToggle)
    check('业务标注：再点一下面板收起', await until(`!document.querySelector('.ddp-anp')`, 3000))
    fs.writeFileSync(path.join(DESIGN, 'annotations.json'), JSON.stringify(ANNOTS))
    await sleep(800)
  }

  // ⑧ 换风格：外观面板 →「换风格」→ 点一张卡
  await page(`document.querySelector('.ddp-dock button[data-tip="外观"]').click()`)
  await sleep(300)
  await page(`[...document.querySelectorAll('.dd-sheet[data-sheet="look"] .dd-tabs [role=tab]')].find((x) => /换风格/.test(x.textContent)).click()`)
  const recN = await until(`document.querySelectorAll('.ddp-styles .ddp-sc').length`, 5000)
  await page(`[...document.querySelectorAll('.dd-lkbar .dd-seg button')].find((x) => /^全部/.test(x.textContent)).click()`)
  const cards = await until(`document.querySelectorAll('.ddp-styles .ddp-sc').length > 5 && document.querySelectorAll('.ddp-styles .ddp-sc').length`, 5000)
  await sleep(400) // 面板淡入完再截图
  await shot('8-styles')
  const warmCard = `[...document.querySelectorAll('.ddp-sc')].find((x) => x.querySelector('.nm')?.textContent === '温暖手作')`
  await page(`${warmCard}.click()`)
  const stPicked = await until(`document.querySelector('.ddp-sc.on .nm')?.textContent === '温暖手作' && document.querySelector('.dd-sheet .dd-sf .note b')?.textContent`, 3000)
  await page(`${warmCard}.click()`)
  const sam = await until(`document.querySelector('.ddp-samview .meta b')?.textContent`, 3000)
  await sleep(300)
  await shot('8b-sample')
  check('换风格：推荐 5 张；点卡片先选中（底栏写着它），再点看原大样板，输入框还没动', recN === 5 && stPicked === '温暖手作' && sam === '温暖手作' && !/〔风格〕/.test(await page(composerText)), `${recN} / ${stPicked} / ${sam}`)
  await page(`document.querySelector('.dd-sheet[data-sheet="look"] .dd-sf .dd-bt.pri').click()`)
  await sleep(500)
  const styTxt = await page(composerText)
  check('换风格：全部二十张风格卡，底栏点「换成这个风格」→ 输入框里是〔风格〕、整套配色和换风格的要求', cards === 20 && /〔风格〕温暖手作/.test(styTxt) && styTxt.includes('#F6EFE6') && /把现在的设计换成这个风格/.test(styTxt) && !(await page(`!!document.querySelector('.ddp-styles')`)),
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
  // 不知道怎么用的人：中间有三步说明，岛上面的胶囊写着现在这支笔怎么画；「放进对话」先是淡的
  const how0 = await page(`({ coach: document.querySelector('.ddp-mk-coach')?.innerText || '', bar: document.querySelector('.ddp-mk-how')?.innerText || '', idle: !!document.querySelector('.ddp-mk-bar .go.idle') })`)
  await sleep(250)
  await shot('8c0-markup-how')
  check('画笔标注：打开就教怎么用（中间三步、胶囊写现在这支笔怎么画、放进对话先是淡的）', /直接在页面上画/.test(how0.coach) && /放进对话/.test(how0.coach) && /画笔/.test(how0.bar) && /按住拖动/.test(how0.bar) && how0.idle, JSON.stringify(how0))
  // 画在台面上看得到的那一屏中间
  const fr = await page(`(() => { const s = document.querySelector('.ddp-stage').getBoundingClientRect(); const r = [...document.querySelectorAll('.ddp-stage iframe')].map((x) => x.getBoundingClientRect()).find((r) => r.width > 80 && r.height > 80 && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
  if (fr) {
    await tool('圆圈')
    const ovalHow = await page(`document.querySelector('.ddp-mk-how')?.innerText || ''`)
    check('画笔标注：换成圆圈，胶囊跟着说怎么圈', /圆圈/.test(ovalHow) && /圈出要改的地方/.test(ovalHow), ovalHow)
    await drag(fr.x - 40, fr.y - 30, fr.x + 40, fr.y + 30)
    const how1 = await page(`({ coach: !!document.querySelector('.ddp-mk-coach'), idle: !!document.querySelector('.ddp-mk-bar .go.idle') })`)
    check('画笔标注：画了第一笔，说明收起、「放进对话」亮起来', !how1.coach && !how1.idle, JSON.stringify(how1))
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
  await page(`[...document.querySelectorAll('.ddp-mk-bar button')].find((x) => /放进对话/.test(x.textContent)).click()`)
  const markGone = await until(`!document.querySelector('.ddp-mark') && /〔标注〕/.test(${composerText})`, 30000)
  const markTxt = await page(composerText)
  const markFile = (/〔标注〕(\S+?\.png)/.exec(markTxt) || [])[1] || ''
  let markPng = null
  try { markPng = fs.readFileSync(markFile) } catch { markPng = null }
  const pw = markPng && markPng.length > 24 ? markPng.readUInt32BE(16) : 0
  const ph = markPng && markPng.length > 24 ? markPng.readUInt32BE(20) : 0
  check('画笔标注：「放进对话」→ 标注图存进设计目录的 refs/，输入框里是〔标注〕、图的路径、用 read_image 看的要求和图上写的字', markGone && path.dirname(markFile) === path.join(DESIGN, 'refs') &&
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
    await page(`document.querySelector('.ddp-mk-color button[title="#3b82f6"]').click()`)
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
  await rpage(`document.querySelector('.ddp-dock button[data-tip="外观"]').click()`).catch(() => {})
  const toks = await runtil(`!!document.querySelector('.ddp-look [title^="--brand"]') && document.querySelector('.ddp-look').innerText`, 8000)
  check('远程看：页面和右侧栏说得上话（设计变量报上来了）', !!toks, await rpage(`document.querySelector('.ddp-look')?.innerText.slice(0, 200) || '没有外观面板'`).catch((e) => e.message))
  await rpage(`document.querySelector('.ddp-dock button[data-tip="外观"]').click()`).catch(() => {})
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
  const rck = await runtil(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.dd-sh .sub')?.textContent || '') && p.querySelectorAll('.ddp-ck').length })()`, 30000)
  let rdiag = ''
  if (!(rck >= 2)) {
    const panel = await rpage(`document.querySelector('.ddp-check')?.innerText.slice(0, 300) || '没有面板'`).catch((e) => e.message)
    const frames = await rpage(`JSON.stringify([...document.querySelectorAll('.ddp iframe')].map((f) => [f.className, (f.src || '').slice(-40), Math.round(f.getBoundingClientRect().width)]))`).catch((e) => e.message)
    const inside = await inFrame(`JSON.stringify({ href: location.href.slice(-40), ready: document.readyState, bad: !!document.querySelector('p[style*="d4d4d4"]'), two: document.body.innerText.includes('拿铁 × 2') })`)
    await sleep(2500)
    await rpage(`document.querySelector('.dd-sheet .dd-sh .dd-x')?.click()`).catch(() => {})
    await sleep(400)
    await rpage(`${CHECK_BTN}.click()`).catch(() => {})
    const again = await runtil(`(() => { const p = document.querySelector('.ddp-check'); return p && !/正在体检|Checking/.test(p.querySelector('.dd-sh .sub')?.textContent || '') && p.querySelectorAll('.ddp-ck').length })()`, 30000)
    rdiag = JSON.stringify({ panel, frames, inside, again })
  }
  check('远程看：体检照样量得出（改坏的购物车：浅灰小字）', rck >= 2, rdiag)
  await rpage(`document.querySelector('.dd-sheet .dd-sh .dd-x')?.click()`).catch(() => {})
  await sleep(400)
  const pngs = () => (fs.existsSync(path.join(DESIGN, 'exports')) ? fs.readdirSync(path.join(DESIGN, 'exports')).filter((f) => f.endsWith('.png')) : [])
  const pngBefore = pngs().length
  await rpage(exportJs('img', '/ · 纯画面$/')).catch(() => {})
  const exMsg = await runtil(`(document.body.innerText.match(/(已导出|导出失败)[^\\n]*/) || [''])[0]`, 30000)
  check('远程看：导出这一屏照样能导（沙盒里也画得出图），纯画面文件名带 -plain', /已导出/.test(exMsg || '') && pngs().length > pngBefore && pngs().some((x) => /-plain\.png$/.test(x)), `${exMsg} / ${pngs().join(',')}`)
  await chrome.cdp('Target.closeTarget', { targetId: rt }).catch(() => {})

  // ⑨y 版本面板开着：看旧版本时灵动条换成「第 n 版 ｜ 对比 ｜ 回到这一版 ×」，在面板下面不被盖住，「回到这一版」点得到；对比时手机让到面板上面
  await page(`document.querySelector('.ddp-isl.dd-mini').click()`)
  const oldVer = await until(`document.querySelectorAll('.ddp-hist .dd-vc').length >= 2`, 8000)
  // 1.0 版本卡片：旧版本的缩略图后台截（verthumb），图要真能出来；卡片写着第几版、什么时候
  const verPic = await until(`((c) => c && [...c.querySelectorAll('.pv img')].some((i) => i.complete && i.naturalWidth > 0) && c.innerText)(document.querySelectorAll('.ddp-hist .dd-vc')[1])`, 25000)
  check('版本面板：一排卡片，旧版本卡片上有那一版的缩略图、第几版、什么时候', !!verPic && /第 \d+ 版/.test(verPic) && /(今天|昨天|月)/.test(verPic), String(verPic))
  await page(`document.querySelectorAll('.ddp-hist .dd-vc')[1].click()`)
  const VERDOCK = `document.querySelector('.dd-isl.dd-mode[aria-label="版本"]')`
  await until(`!!(${VERDOCK} && ${VERDOCK}.querySelector('.dd-bt.pri'))`, 8000)
  await sleep(500)
  // 灵动条在面板（抽屉）下面、不叠；「回到这一版」点得到
  const dockClear = `((d, p) => d && p ? d.getBoundingClientRect().top >= p.getBoundingClientRect().bottom - 1 : null)(${VERDOCK}, document.querySelector('.dd-sheet'))`
  const hitOf = (sel) => `((b) => { if (!b) return null; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b })(${sel})`
  const bannerClear = await page(dockClear)
  const restoreHit = await page(hitOf(`${VERDOCK}.querySelector('.dd-bt.pri')`))
  await shot('banner-side')
  await page(`${VERDOCK}.querySelector('.dd-bt.ghost').click()`)
  await until(`!!document.querySelector('.ddp-cmp')`, 8000)
  await sleep(400)
  const phoneClear = await page(`((a, p) => a && p ? a.getBoundingClientRect().bottom <= p.getBoundingClientRect().top + 1 : null)(document.querySelector('.ddp-fit'), document.querySelector('.dd-sheet'))`)
  await shot('compare-side')
  check('版本面板：看旧版本时灵动条换形态、在面板下面不叠，「回到这一版」点得到', !!oldVer && bannerClear === true && restoreHit === true, JSON.stringify({ oldVer, bannerClear, restoreHit }))
  check('版本面板：对比时手机让到面板上面', phoneClear === true, JSON.stringify({ phoneClear }))
  const canvasBtn = `document.querySelector('.ddp-top .dd-cv')`
  await page(`${canvasBtn}.click()`)
  await sleep(500)
  const cmpLeft = await page(`({ cmp: !!document.querySelector('.ddp-cmp'), sel: ${canvasBtn}.classList.contains('on'), banner: !!(${VERDOCK} && ${VERDOCK}.querySelector('.dd-bt.pri')) })`)
  check('版本对比时点「画布」：退出对比回到画布，按钮和实际一致', cmpLeft && !cmpLeft.cmp && cmpLeft.sel && cmpLeft.banner, JSON.stringify(cmpLeft))
  await page(`(() => { const d = document.querySelector('.ddp'); d.style.width = '480px'; d.style.flex = 'none' })()`)
  await sleep(600)
  const narrowVer = await page(`({ clear: ${dockClear}, hit: ${hitOf(`${VERDOCK}.querySelector('.dd-bt.pri')`)} })`)
  await shot('banner-narrow')
  await page(`document.querySelector('.ddp').style.cssText = ''`)
  await sleep(300)
  check('版本面板：侧栏窄时灵动条也在面板下面，「回到这一版」点得到', narrowVer && narrowVer.clear === true && narrowVer.hit === true, JSON.stringify(narrowVer))
  // 1.0 标题栏：标志、⊞ 屏名 ▾ ｜ 导出 ▾ ⋯ 转成代码；底下的灵动条也不能出框
  const EN = { 分享: 'Share', 导出: 'Export', 转成代码: 'Build as code', 选择: 'Select', 改字: 'Text', 调样式: 'Style', 画笔: 'Draw', 试用: 'Play', 外观: 'Look', 体检: 'Check', 说一句或输命令: 'Ask or run a command', 对比: 'Compare', 回到这一版: 'Restore this' }
  const navFit = (w, en) => page(`(async () => {
    const d = document.querySelector('.ddp'), css = d.style.cssText
    const lbs = [...document.querySelectorAll('.ddp-top .lb, .ddp-top .ddp-btn > span, .ddp-dock .ddp-tool > span, .ddp-dock .dd-cmd > span, .ddp-dock .dd-bt')].filter((x) => !x.children.length), old = lbs.map((x) => x.textContent)
    if (${en}) lbs.forEach((x) => { x.textContent = ${JSON.stringify(EN)}[x.textContent] || x.textContent })
    d.style.width = '${w}px'; d.style.flex = 'none'
    await new Promise((r) => setTimeout(r, 400)) // 灵动条按宽度换样子（全字 / 收起「说一句」/ 只剩图标）是重新渲染出来的，等它换好
    const kids = [...document.querySelector('.ddp-top').children], i = kids.findIndex((c) => c.classList.contains('dd-sp'))
    const right = Math.max(...kids.slice(0, i).map((c) => c.getBoundingClientRect().right))
    const left = Math.min(...kids.slice(i + 1).map((c) => c.getBoundingClientRect().left))
    const box = d.getBoundingClientRect(), isl = document.querySelector('.ddp-dock').getBoundingClientRect()
    const r = { w: ${w}, en: ${en}, gap: Math.round(left - right), isl: isl.left >= box.left - 1 && isl.right <= box.right + 1 }
    d.style.cssText = css; lbs.forEach((x, i) => { x.textContent = old[i] })
    return r
  })()`)
  const navs = []
  for (const w of [320, 380, 441, 460, 480, 500, 520, 540, 560, 600, 640]) for (const en of [false, true]) navs.push(await navFit(w, en))
  check('窄侧栏：看旧版本时顶部两组按钮不互相压、「第 n 版」那条不出框（中英文，320 到 640）', navs.every((x) => x.gap >= 0 && x.isl), JSON.stringify(navs.filter((x) => x.gap < 0 || !x.isl)))
  // 看旧版本时导出整套 HTML 演示（#26）：导的是那一版的屏，文件名带 v 几
  const htmlBefore = new Set(fs.existsSync(EXPORTS) ? fs.readdirSync(EXPORTS) : [])
  await page(exportJs('html'))
  const verHtml = await waitFor(() => (fs.existsSync(EXPORTS) ? fs.readdirSync(EXPORTS) : []).find((x) => x.endsWith('.html') && !htmlBefore.has(x)), 20000)
  const verToast = await until(`(() => { const t = document.querySelector('.ddp-toast'); return t && t.innerText })()`, 3000)
  check('看旧版本时导出 HTML 演示：导的是那一版（文件名带 v 几）', !!verHtml && /^v\d+-/.test(verHtml) && fs.readFileSync(path.join(EXPORTS, verHtml), 'utf8').includes('id="ddp-s-0"'), `${verHtml} / ${verToast}`)
  await page(closeSheet)
  await page(`${VERDOCK}.querySelector('.dd-x').click()`)
  await sleep(400)
  const navs2 = []
  for (const w of [320, 380, 441, 460, 480, 500, 520, 540, 560, 600, 640]) for (const en of [false, true]) navs2.push(await navFit(w, en))
  check('窄侧栏：平常时顶部两组按钮不互相压、灵动条不出框（中英文，320 到 640）', navs2.every((x) => x.gap >= 0 && x.isl), JSON.stringify(navs2.filter((x) => x.gap < 0 || !x.isl)))

  // ⑨y2 和做出来的比（#25）：模型调 compare_design 比菜单屏 → 提示「看对比」→ 真页面经预览服务器嵌进来；
  //   拖线 / 叠加（透明度、反色）/ 并排；「重新比」照现在的画幅比一次；分数点开看拼图；地址不对说清楚；导出菜单里也能进；退出回到原来的工具
  fs.mkdirSync(IMPL, { recursive: true })
  fs.copyFileSync(path.join(DESIGN, 'tokens.css'), path.join(IMPL, 'tokens.css'))
  fs.writeFileSync(path.join(IMPL, 'menu.html'), fs.readFileSync(path.join(DESIGN, 'menu.html'), 'utf8').replace('<li>桂花燕麦拿铁 ¥26</li>', ''))
  const implSrv = http.createServer((q, r) => {
    const f = path.join(IMPL, path.basename(new URL(q.url, 'http://x').pathname))
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); r.end(b) })
  })
  await new Promise((r) => implSrv.listen(0, '127.0.0.1', r))
  IMPL_PORT = implSrv.address().port
  await say('IMPL-CMP 比一下菜单')
  const implToast = await until(`[...document.querySelectorAll('.ddp-toast')].map((x) => x.textContent).find((x) => /模型刚和做出来的比过/.test(x)) || ''`, 60000)
  await waitFor(() => cmpResults.length > 0, 10000)
  check('和做出来的比：模型比完（拿到差异）→ 右侧栏提示「看对比」', /差异 \d/.test(cmpResults[0] || '') && /菜单/.test(implToast) && /看对比/.test(implToast), `${implToast} / ${(cmpResults[0] || '').slice(0, 120)}`)
  await page(`[...document.querySelectorAll('.ddp-toast button')].find((x) => x.textContent === '看对比').click()`)
  const implSrc = await until(`(() => { const f = document.querySelector('.ddp-icmp .im iframe'); return f && f.getAttribute('src') })()`, 15000)
  await sleep(1500)
  // 嵌进来的是做出来的那页（少一行菜单），走的是设计台的预览服务器（端口不是开发服务器自己的）
  const implLis = async () => {
    const { root } = await chrome.cdp('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
    let doc = null
    const walk = (n) => {
      if (doc || !n) return
      if (n.nodeName === 'IFRAME' && n.contentDocument && (n.attributes || []).some((x) => String(x) === implSrc)) doc = n.contentDocument
      for (const c of n.children || []) walk(c)
      if (n.contentDocument) walk(n.contentDocument)
    }
    walk(root)
    if (!doc) return -1
    const { nodeIds } = await chrome.cdp('DOM.querySelectorAll', { nodeId: doc.nodeId, selector: 'li' }, sessionId)
    return nodeIds.length
  }
  const implView = await page(`(() => {
    const b = document.querySelector('.ddp-ibar'), dock = b
    return { url: b && b.querySelector('.ddp-iurl') ? b.querySelector('.ddp-iurl').textContent : '', score: b && b.querySelector('.ddp-iscore') ? b.querySelector('.ddp-iscore').textContent : '',
      knob: !!document.querySelector('.ddp-icmp .ddp-knob'), tags: [...document.querySelectorAll('.ddp-ilg .ch')].map((x) => x.textContent).join('|'),
      tools: dock ? [...dock.querySelectorAll('.ddp-imode button, .ddp-ibx')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')).join('|') : '', pick: !!document.querySelector('.ddp-dock button.pick') }
  })()`)
  const lis = await implLis()
  await shot('impl-split')
  check('和做出来的比：灵动条换成「地址 ｜ 拖线 / 叠加 / 并排 ｜ 差异 ｜ 重新比 ×」，拖线把手、两边标签', implView.url === `localhost:${IMPL_PORT}/menu.html` && /^差异 \d+(\.\d)?%$/.test(implView.score) && implView.knob && implView.tags === '设计稿|做出来的' && /^拖线\*\|叠加\|并排/.test(implView.tools) && !implView.pick, JSON.stringify(implView))
  check('和做出来的比：嵌进来的是做出来的那页（少一行菜单），经设计台的预览服务器', /^http:\/\/127\.0\.0\.1:\d+\/menu\.html$/.test(implSrc || '') && !(implSrc || '').includes(':' + IMPL_PORT + '/') && lis === 2, `${implSrc} / li=${lis}`)
  const ibar = (name) => page(`[...document.querySelectorAll('.ddp-ibar .ddp-imode button, .ddp-ibar .ddp-idiff')].find((x) => x.textContent === '${name}').click()`)
  await ibar('叠加')
  await sleep(400)
  const ov1 = await page(`(() => { const im = document.querySelector('.ddp-icmp.ov > .im'); return im ? { op: im.style.opacity, range: document.querySelector('.ddp-iop input').value } : null })()`)
  await page(`(() => { const i = document.querySelector('.ddp-iop input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '80'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)
  const ov2 = await page(`document.querySelector('.ddp-icmp.ov > .im').style.opacity`)
  await ibar('反色')
  await sleep(300)
  const ov3 = await page(`(() => { const im = document.querySelector('.ddp-icmp.ov > .im'); return { blend: im.style.mixBlendMode, op: im.style.opacity, off: document.querySelector('.ddp-iop input').disabled } })()`)
  await shot('impl-overlay')
  check('和做出来的比：叠加 → 真页面半透明（默认 50%，拖到 80%）；反色 → 差值混合、透明度条停用', ov1 && ov1.op === '0.5' && ov1.range === '50' && ov2 === '0.8' && ov3.blend === 'difference' && ov3.off, JSON.stringify({ ov1, ov2, ov3 }))
  await ibar('反色')
  await ibar('并排')
  await sleep(1500)
  const side = await page(`(() => { const s = [...document.querySelectorAll('.ddp-iside')]; return { n: s.length, impl: s[1] ? !!s[1].querySelector('.im iframe') : false, design: s[0] ? !!s[0].querySelector('.ly iframe') : false, gap: s[1] && s[0] ? Math.round(s[1].getBoundingClientRect().left - s[0].getBoundingClientRect().right) : -1 } })()`)
  await shot('impl-side')
  check('和做出来的比：并排 → 左设计稿、右做出来的，中间留空', side.n === 2 && side.impl && side.design && side.gap > 0, JSON.stringify(side))
  await ibar('拖线')
  await page(`[...document.querySelectorAll('.ddp-ibar .dd-bt')].find((x) => /重新比/.test(x.textContent)).click()`)
  const reSaid = await until(`[...document.querySelectorAll('.ddp-toast')].map((x) => x.textContent).find((x) => /比完了：差异/.test(x)) || ''`, 60000)
  const reTip = await until(`(() => { const s = document.querySelector('.ddp-ibar .ddp-iscore'); return s && /你点的/.test(s.getAttribute('data-tip-d') || '') && s.getAttribute('data-tip-d') })()`, 8000)
  check('和做出来的比：「重新比」→ 照现在的画幅比一次，提示差异，分数记成你点的', !!reSaid && !!reTip, `${reSaid} / ${reTip}`)
  await page(`document.querySelector('.ddp-ibar .ddp-iscore').click()`)
  const shotOk = await until(`(() => { const i = document.querySelector('.ddp-ishot img'); return i && i.complete && i.naturalWidth > 300 && i.naturalWidth })()`, 8000)
  await page(`document.querySelector('.ddp-ishot').click()`)
  await sleep(200)
  check('和做出来的比：点分数看拼图（设计稿 | 做出来的 | 差异），点一下关掉', !!shotOk && !(await page(`!!document.querySelector('.ddp-ishot')`)), String(shotOk))
  await page(`document.querySelector('.ddp-ibar .ddp-iurl').click()`)
  await until(`!!document.querySelector('.ddp-iform input')`, 3000)
  await page(`(() => { const i = document.querySelector('.ddp-iform input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'https://example.com/'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit() })()`)
  const badSaid = await until(`[...document.querySelectorAll('.ddp-toast')].map((x) => x.textContent).find((x) => /地址不对/.test(x)) || ''`, 8000)
  await page(`document.querySelector('.ddp-iform input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)
  const badBack = await page(`({ url: !!document.querySelector('.ddp-ibar .ddp-iurl'), cmp: !!document.querySelector('.ddp-icmp') })`)
  check('和做出来的比：填了外网地址 → 说只认本机的；Esc 收起输入框，还在对比', !!badSaid && badBack.url && badBack.cmp, `${badSaid} / ${JSON.stringify(badBack)}`)
  await page(`document.querySelector('.ddp-ibar .dd-x').click()`)
  await sleep(500)
  const implGone = await page(`({ cmp: !!document.querySelector('.ddp-icmp'), banner: !!document.querySelector('.ddp-ibar'), pick: !!document.querySelector('.ddp-dock button.pick') })`)
  // 「转成代码」面板底下有「和做出来的比」：记着的地址直接打开
  await page(openSheet('转成代码', 'code'))
  await page(`[...document.querySelectorAll('.dd-sheet .dd-sf .dd-bt')].find((x) => /和做出来的比/.test(x.textContent)).click()`)
  const menuBack = await until(`(() => { const f = document.querySelector('.ddp-icmp .im iframe'); return f && f.getAttribute('src') })()`, 10000)
  // 对比开着导出这一屏：导出的就是比的那屏（设计稿那边登记给了右侧栏）
  await sleep(800)
  const pngB = pngs().length
  await page(openSheet('导出', 'export', '/图片/'))
  const exLabel = await page(`(() => { const b = [...document.querySelectorAll('.dd-sheet .dd-opt')].find((x) => x.textContent.trim().endsWith(' · 纯画面')); return b ? b.textContent : '' })()`)
  await page(exportJs('img', '/ · 纯画面$/'))
  const exSaid = await until(`(document.body.innerText.match(/(已导出|导出失败)[^\\n]*/) || [''])[0]`, 30000)
  check('和做出来的比：对比开着也能导出这一屏（导出面板写的是比的那屏）', /已导出/.test(exSaid || '') && (pngs().length > pngB || pngs().some((f) => Date.now() - fs.statSync(path.join(DESIGN, 'exports', f)).mtimeMs < 30000)) && /菜单|menu/i.test(exLabel), `${exLabel} / ${exSaid}`)
  await page(closeSheet)
  await page(`document.querySelector('.ddp-ibar .dd-x').click()`)
  await sleep(400)
  check('和做出来的比：× 退出 → 回到原来的工具；「转成代码」面板里「和做出来的比」再进来，记着的地址直接打开', !implGone.cmp && !implGone.banner && implGone.pick && !!menuBack, JSON.stringify({ implGone, menuBack }))
  implSrv.close()

  // ⑨z 幻灯片比默认画幅大、meta 没写尺寸（issue #10）：画幅跟页面走，导出不裁。这时是单看模式，同一个组件换到别的设计目录（导出的消息要发对地址）
  fs.mkdirSync(DECK, { recursive: true })
  fs.writeFileSync(path.join(DECK, 's1.html'), '<!doctype html><html><head><meta charset="utf-8"><title>第一页</title><meta name="dsh-design" content="slides"><style>body{margin:0}.s{width:1500px;height:800px;background:#123;color:#fff}</style></head><body><div class="s"><h1 style="margin:0">标题</h1></div></body></html>')
  await say('OPEN-DECK 打开幻灯片')
  const deckSize = await until(`(() => { const f = document.querySelector('iframe.ddp-frame.cur[src*="s1.html"]'); return f && f.clientWidth + 'x' + f.clientHeight === '1500x800' && '1500x800' })()`, 30000)
  check('画幅探测：幻灯片写死 1500×800、meta 没写尺寸 → 画幅跟着变', deckSize === '1500x800', await page(`(() => { const f = document.querySelector('iframe.ddp-frame.cur'); return f ? f.src + ' ' + f.clientWidth + 'x' + f.clientHeight : '没有 iframe' })()`))
  await sleep(1500)
  await shot('10-deck')

  // ⑨z2 自定义画幅（#23）：屏名菜单「画幅」一行 → 自定义… 填 1200×700 → 画布照这个；再恢复默认
  // 1.0：画幅 / 多尺寸 / 按画幅显示都在左上项目名 ▾（页面设置）里；画幅是点进去的一层
  const PM = `document.querySelector('.ddp-top .dd-proj .dd-pj')`
  const pmMain = `(async () => { const b = ${PM}; if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') { b.click(); await new Promise((r) => setTimeout(r, 200)) } const bk = document.querySelector('.dd-pm .dd-mback'); if (bk) { bk.click(); await new Promise((r) => setTimeout(r, 150)) } return !!document.querySelector('.dd-pm') })()`
  const pmClose = `(() => { const b = ${PM}; if (b && b.getAttribute('aria-expanded') === 'true') b.click() })()`
  const menuOpen = `(async () => { if (document.querySelector('.ddp-szrow')) return true; if (!(await ${pmMain})) return false; const it = [...document.querySelectorAll('.dd-pm [role=menuitem]')].find((x) => /^(画幅|Canvas)/.test(x.textContent)); if (it) it.click(); await new Promise((r) => setTimeout(r, 150)); return !!document.querySelector('.ddp-szrow') })()`
  const szRow0 = (await page(menuOpen)) && (await page(`document.querySelector('.ddp-szrow').innerText`))
  check('自定义画幅：屏名菜单里有「画幅」一行，写着现在的 1500×800（默认）', /1500×800/.test(szRow0 || '') && /默认/.test(szRow0 || ''), szRow0)
  // 菜单已开：点「自定义…」、填宽高、（截图）、点「好」
  const setCustomSize = async (w, hh, shotName) => {
    await page(`[...document.querySelectorAll('.ddp-szrow button')].find((x) => /自定义/.test(x.textContent)).click()`)
    await sleep(200)
    await page(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const [w, hh] = document.querySelectorAll('.ddp-szrow input'); set.call(w, '${w}'); w.dispatchEvent(new Event('input', { bubbles: true })); set.call(hh, '${hh}'); hh.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await sleep(200)
    if (shotName) await shot(shotName)
    await page(`document.querySelector('.ddp-szrow button[type="submit"]').click()`)
  }
  await setCustomSize(1200, 700, '10-deck-size-edit')
  const custom = await until(`((f) => f && f.clientWidth === 1200 && f.clientHeight === 700)(document.querySelector('iframe.ddp-frame.cur'))`, 8000)
  check('自定义画幅：填 1200×700 点「好」→ 画布变成 1200×700', !!custom, await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(document.querySelector('iframe.ddp-frame.cur'))`))
  await sleep(600)
  await shot('10-deck-size-custom')
  const szRow1 = (await page(menuOpen)) && (await page(`document.querySelector('.ddp-szrow').innerText`))
  check('自定义画幅：菜单里写着 1200×700（自定义），有「恢复默认」', /1200×700/.test(szRow1 || '') && /自定义/.test(szRow1 || '') && /恢复默认/.test(szRow1 || ''), szRow1)
  await shot('10-deck-size-menu')
  await page(`[...document.querySelectorAll('.ddp-szrow button')].find((x) => /恢复默认/.test(x.textContent)).click()`)
  const back = await until(`((f) => f && f.clientWidth === 1500 && f.clientHeight === 800)(document.querySelector('iframe.ddp-frame.cur'))`, 8000)
  check('自定义画幅：恢复默认 → 回到 1500×800', !!back, await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(document.querySelector('iframe.ddp-frame.cur'))`))
  await sleep(600)
  const deckCmd = await page(palJs('导出 PDF'))
  check('命令面板：打「导出 PDF」回车 → 第一条就是「导出 PDF」', deckCmd === '导出 PDF', String(deckCmd))
  const deckEnd = Date.now() + 60000
  const deckPdf = () => { const d = path.join(DECK, 'exports'); const f = fs.existsSync(d) && fs.readdirSync(d).find((x) => x.endsWith('.pdf')); return f ? path.join(d, f) : '' }
  const deckToasts = new Set()
  while (Date.now() < deckEnd && !deckPdf()) { deckToasts.add(await page(`(document.querySelector('.ddp-toast') || {}).innerText || ''`).catch(() => '')); await sleep(500) }
  const box = deckPdf() ? /\/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)/.exec(fs.readFileSync(deckPdf(), 'latin1')) : null
  check('画幅探测：导出的 PDF 比例是页面的（没被默认画幅裁掉）', box && Math.abs(box[1] / box[2] - 1500 / 800) < 0.01, box ? box.slice(1).join('x') : `没有 PDF；提示 ${[...deckToasts].join(' / ')}；work ${fs.readdirSync(path.join(tmp, 'work'), { recursive: true }).filter((x) => /deck|pdf$/.test(x)).join(' ')}`)

  // ⑨za 导出选项和预检（issue #10）：单看模式也要导出所有屏；有内容会被裁先给看清单；版面、拼版传到文件里
  fs.writeFileSync(path.join(DECK, 's2.html'), '<!doctype html><html><head><meta charset="utf-8"><title>第二页</title><meta name="dsh-design" content="slides"><style>body{margin:0}.s{width:1500px;height:800px;background:#345;color:#fff}</style></head><body><div class="s"><a href="#">占位</a> <a href="nope.html">没这页</a> <a href="s1.html">回去</a></div></body></html>')
  fs.writeFileSync(path.join(DECK, 's3.html'), '<!doctype html><html><head><meta charset="utf-8"><title>第三页</title><meta name="dsh-design" content="slides"><style>body{margin:0}.s{width:1500px;height:800px}</style></head><body><div class="s" style="background:#567"></div><div class="s" style="background:#789"></div></body></html>')
  const pdfsNow = () => fs.readdirSync(path.join(DECK, 'exports')).filter((x) => x.endsWith('.pdf'))
  // 命令面板里「导出 PDF」：和原来菜单里直接点一样，先预检（有会被裁的先打开导出面板给看清单，同样的结果只拦一次）
  const openExport = async () => { await page(palJs('导出 PDF')) }
  await sleep(3500) // 等新文件进屏列表
  await page(`[...document.querySelectorAll('.ddp-stage button, .ddp-stage [role=button]')].find((x) => x.textContent.trim() === '单看').click()`)
  check('预检：切到单看，只挂着一屏', !!(await until(`document.querySelectorAll('iframe.ddp-frame.cur').length === 1`, 8000)), await page(`document.querySelectorAll('iframe.ddp-frame.cur').length`))
  // issue #14：导航里的「画布」排在「首页」后面，单看时点一下就回画布
  const navOrder = await page(`[...document.querySelectorAll('.ddp-top .dd-logo, .ddp-top .dd-cv')].map((b) => b.dataset.tip).join()`)
  await page(`document.querySelector('.ddp-top .dd-cv').click()`)
  const backCanvas = await until(`document.querySelectorAll('iframe.ddp-frame.cur').length >= 3 && document.querySelector('.ddp-top .dd-cv').classList.contains('on')`, 8000)
  check('导航：「画布」在「首页」后面，单看时点一下回画布', /^首页,画布/.test(navOrder) && !!backCanvas, navOrder)
  await page(`[...document.querySelectorAll('.ddp-stage button, .ddp-stage [role=button]')].find((x) => x.textContent.trim() === '单看').click()`)
  await until(`document.querySelectorAll('iframe.ddp-frame.cur').length === 1`, 8000)
  const pdfBefore = pdfsNow().length
  await openExport()
  const xoOpened = await until(`((el) => el && /比画幅大/.test(el.innerText) && /链接/.test(el.innerText))(document.querySelector('.ddp-xo'))`, 30000)
  check('预检：有内容会被裁，先给看清单，不直接导出', !!xoOpened && pdfsNow().length === pdfBefore, await page(`(document.querySelector('.ddp-xo') || {}).innerText || '没有面板'`))
  await until(`!document.querySelector('.ddp-ghost')`, 15000)
  const xoText = await page(`document.querySelector('.ddp-xo').innerText`)
  check('预检：比画幅大 1 屏、死链接 2 个（href="#" 和指向不存在的文件）', /1 个页面比画幅大/.test(xoText) && /2 个链接/.test(xoText), xoText)
  await shot('10-export-options')
  await page(`(() => { const b = (t) => [...document.querySelectorAll('.ddp-xo .dd-chip, .ddp-xo .dd-seg > button')].find((x) => x.textContent === t).click(); b('16:9') })()`)
  await sleep(100)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-chip, .ddp-xo .dd-seg > button')].find((x) => x.textContent === '每页 2 屏').click()`)
  await sleep(100)
  await page(`document.querySelector('.ddp-xo .dd-sf .dd-bt.pri').click()`)
  const optEnd = Date.now() + 60000
  while (Date.now() < optEnd && pdfsNow().length === pdfBefore) await sleep(400)
  const optFile = pdfsNow().map((x) => path.join(DECK, 'exports', x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  const optText = pdfsNow().length > pdfBefore ? fs.readFileSync(optFile, 'latin1') : ''
  check('导出选项：单看模式三屏都导出，16:9、每页 2 屏 → 两页', (optText.match(/\/MediaBox \[0 0 960 540\]/g) || []).length === 2 && (optText.match(/\/Subtype \/Image/g) || []).length === 3, optText ? (optText.match(/\/MediaBox[^\]]*\]/g) || []).join() : '没有新 PDF')
  await until(`!document.querySelector('.ddp-ghost')`, 15000)
  await page(closeSheet)
  await sleep(200)
  const pdfSecond = pdfsNow().length
  await openExport()
  const secondEnd = Date.now() + 60000
  while (Date.now() < secondEnd && pdfsNow().length === pdfSecond) await sleep(400)
  check('预检：同样的结果只拦一次，再点直接导出', pdfsNow().length === pdfSecond + 1 && !(await page(`!!document.querySelector('.ddp-xo')`)))

  // ⑨zb 「按内容改画幅」：meta 写小了的页面，预检给按钮，点了画幅跟内容走
  fs.writeFileSync(path.join(DECK, 's1.html'), fs.readFileSync(path.join(DECK, 's1.html'), 'utf8').replace('content="slides"', 'content="slides 1280x720"'))
  const shrunk = await until(`((f) => f && f.clientWidth === 1280)(document.querySelector('iframe.ddp-frame.cur'))`, 15000)
  await openExport()
  const fitBtn = await until(`[...document.querySelectorAll('.ddp-xo .dd-xbt')].some((b) => b.textContent.includes('1500 × 800'))`, 30000)
  check('按内容改画幅：meta 写小了，预检给出按钮', !!shrunk && !!fitBtn, await page(`(document.querySelector('.ddp-xo') || {}).innerText || '没有面板'`))
  await page(`[...document.querySelectorAll('.ddp-xo .dd-xbt')].find((b) => b.textContent.includes('1500 × 800')).click()`)
  check('按内容改画幅：点了画幅变成内容的大小', !!(await until(`((f) => f && f.clientWidth === 1500 && f.clientHeight === 800)(document.querySelector('iframe.ddp-frame.cur'))`, 10000)), await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '')(document.querySelector('iframe.ddp-frame.cur'))`))
  await page(closeSheet)

  // ⑨zc 整页截图：根元素写了 height:100%，底下的内容也要截得到
  fs.writeFileSync(path.join(DECK, 's1.html'), '<!doctype html><html><head><meta charset="utf-8"><title>第一页</title><meta name="dsh-design" content="slides 1500x800"><style>html,body{height:100%;margin:0}.a{height:800px;background:#123}.b{height:300px;background:#f00}</style></head><body><div class="a"></div><div class="b"></div></body></html>')
  await sleep(2500) // 等热更新换上新页面
  await page(openSheet('导出', 'export', '/PDF/'))
  await until(`!!document.querySelector('.ddp-xo')`, 8000)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-chip, .ddp-xo .dd-seg > button')].find((x) => x.textContent === '整页').click()`)
  await sleep(100)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-chip, .ddp-xo .dd-seg > button')].find((x) => x.textContent === '跟随画幅').click()`)
  await sleep(100)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-chip, .ddp-xo .dd-seg > button')].find((x) => x.textContent === '每页 1 屏').click()`)
  await sleep(100)
  const fullBefore = pdfsNow().length
  await page(`document.querySelector('.ddp-xo .dd-sf .dd-bt.pri').click()`)
  const fullEnd = Date.now() + 60000
  while (Date.now() < fullEnd && pdfsNow().length === fullBefore) await sleep(400)
  const fullFile = pdfsNow().map((x) => path.join(DECK, 'exports', x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  const fullBuf = pdfsNow().length > fullBefore ? fs.readFileSync(fullFile) : Buffer.alloc(0)
  const fullHead = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/.exec(fullBuf.toString('latin1'))
  const rootPx = fullHead ? await page(`new Promise((done) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(10, img.height - 10, 1, 1).data; done([img.width, img.height, d[0] > 200 && d[1] < 60 && d[2] < 60].join()) }; img.onerror = () => done('图坏了'); img.src = 'data:image/jpeg;base64,${fullBuf.subarray(fullHead.index + fullHead[0].length, fullHead.index + fullHead[0].length + +fullHead[3]).toString('base64')}' })`) : '没有图'
  await page(closeSheet)
  check('整页截图：根元素写了 height:100% 也截得到底下', /^3000,22\d\d,true$/.test(String(rootPx)), String(rootPx))

  // ⑨zd 导出哪些：挑几屏（默认勾上正在看的那屏）再勾一屏 → PDF 只有这两页；底栏写着「PDF · 2 页」
  await page(openSheet('导出', 'export', '/PDF/'))
  await until(`!!document.querySelector('.ddp-xo .dd-rc')`, 8000)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-rc > button')].find((b) => /挑几屏/.test(b.textContent)).click()`)
  await sleep(150)
  const scPk = await page(`[...document.querySelectorAll('.ddp-xo .dd-pk > button')].map((b) => b.getAttribute('aria-checked')).join()`)
  await page(`[...document.querySelectorAll('.ddp-xo .dd-pk > button')].find((b) => b.getAttribute('aria-checked') === 'false').click()`)
  await sleep(150)
  const scSum = await page(`document.querySelector('.ddp-xo .dd-sf .note').textContent`)
  const scopeBefore = pdfsNow().length
  await page(`document.querySelector('.ddp-xo .dd-sf .dd-bt.pri').click()`)
  const scopeEnd = Date.now() + 60000
  while (Date.now() < scopeEnd && pdfsNow().length === scopeBefore) await sleep(400)
  const scopeFile = pdfsNow().map((x) => path.join(DECK, 'exports', x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  const scopeText = pdfsNow().length > scopeBefore ? fs.readFileSync(scopeFile, 'latin1') : ''
  await page(`[...document.querySelectorAll('.ddp-xo .dd-rc > button')].find((b) => /全部/.test(b.textContent)).click()`)
  await page(closeSheet)
  check('导出哪些：挑几屏默认勾上正在看的，再勾一屏 → PDF 两页、底栏写「PDF · 2 页」', (scPk.match(/true/g) || []).length === 1 && /^PDF · 2 页/.test(scSum) && (scopeText.match(/\/Subtype \/Image/g) || []).length === 2, `${scPk} / ${scSum} / ${(scopeText.match(/\/Subtype \/Image/g) || []).length}`)

  // ⑨zd 图表（思维导图）：画幅按 meta；导出没有「整页长图」，纯画面是两倍清晰的 PNG；meta 不写尺寸、图比默认画幅大 → 画幅跟着图长
  fs.mkdirSync(DIAG, { recursive: true })
  for (const f of ['tokens.css', 'diagram.css']) fs.copyFileSync(path.join(ROOT, 'skills', 'ui-design', f), path.join(DIAG, f))
  const MAP = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'diagram', 'mindmap.html'), 'utf8')
  fs.writeFileSync(path.join(DIAG, 'map.html'), MAP)
  await say('OPEN-DIAGRAM 打开思维导图')
  const dgSize = await until(`((f) => f && f.clientWidth + 'x' + f.clientHeight === '1600x1000')(document.querySelector('iframe.ddp-frame.cur[src*="map.html"]'))`, 30000)
  check('图表：画幅按 meta（1600×1000）', !!dgSize, await page(`((f) => f ? f.src + ' ' + f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(document.querySelector('iframe.ddp-frame.cur'))`))
  await sleep(1500)
  await shot('10-diagram')
  await page(openSheet('导出', 'export', '/图片/'))
  const dgMenu = await page(`[...document.querySelectorAll('.dd-sheet .dd-opt')].map((x) => x.textContent).join(' | ')`)
  check('图表：导出图片的样式有「纯画面」、没有「整页长图」', /纯画面/.test(dgMenu) && !/整页长图/.test(dgMenu), dgMenu)
  await page(exportJs('img', '/纯画面/'))
  const dgPng = () => { const d = path.join(DIAG, 'exports'); const f = fs.existsSync(d) && fs.readdirSync(d).find((x) => x.endsWith('.png')); return f ? path.join(d, f) : '' }
  const dgEnd = Date.now() + 60000
  while (Date.now() < dgEnd && !dgPng()) await sleep(400)
  await sleep(500)
  const dgBuf = dgPng() ? fs.readFileSync(dgPng()) : Buffer.alloc(0)
  const dgWH = dgBuf.length > 24 ? [dgBuf.readUInt32BE(16), dgBuf.readUInt32BE(20)] : []
  if (dgBuf.length) fs.copyFileSync(dgPng(), path.join(SHOTS, '10-diagram-export.png')) // 连线（伪元素画的）有没有画进去，看这张
  check('图表：纯画面导出 PNG，两倍清晰、比例对（3200×2000）', dgWH.join('x') === '3200x2000', dgWH.join('x') || '没有 PNG')
  const WIDE = MAP.replace('content="diagram 1600x1000"', 'content="diagram"').replace('</head>', '<style>.mm .mm-side, .mm .mm-side ul { --gx: 150px !important }</style></head>')
  fs.writeFileSync(path.join(DIAG, 'map.html'), WIDE)
  const dgWide = await until(`((f) => f && f.clientWidth > 1700 && f.clientWidth + 'x' + f.clientHeight)(document.querySelector('iframe.ddp-frame.cur[src*="map.html"]'))`, 20000)
  check('图表：meta 不写尺寸、图比 1600 宽 → 画幅跟着图变宽', !!dgWide, await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(document.querySelector('iframe.ddp-frame.cur'))`))
  await shot('10-diagram-wide')

  // ⑨ze 网页铺满单看、右边开着面板（issue #22）：页面按原来的宽度定住、整体缩到面板左边——不重排，贴右边的内容也不被面板挡住
  fs.mkdirSync(WEBD, { recursive: true })
  const webHtml = (h1) => `<!doctype html><html><head><meta charset="utf-8"><title>首页</title><meta name="dsh-design" content="web"><style>body{margin:0;font:16px sans-serif}.r{position:absolute;right:0;top:0;width:200px;height:120px;background:#c33}.tall{height:3000px}</style></head><body><h1>${h1}</h1><div class="r">贴右边</div><div class="tall"></div></body></html>`
  fs.writeFileSync(path.join(WEBD, 'index.html'), webHtml('网页'))
  await say('OPEN-WEB 打开网页')
  const webCur = `document.querySelector('iframe.ddp-frame.cur[src*="index.html"]')`
  await until(`!!${webCur}`, 30000)
  await sleep(1000)
  await inPage(webCur, 'scrollTo(0, 900), scrollY')
  const webW0 = await page(`${webCur}.clientWidth`), webH0 = await page(`${webCur}.clientHeight`)
  await page(`document.querySelector('.ddp-dock button[data-tip="外观"]').click()`)
  await until(`!!document.querySelector('.ddp-look')`, 5000)
  await sleep(800) // 面板淡入、缩放过渡
  // 1.0：宽过 1000 面板是右边一张（页面定住宽高、缩到它左边）；窄栏是底下的抽屉（宽度不变、页面在抽屉上面）
  const webGeo = await page(`(() => { const f = ${webCur}, r = f.getBoundingClientRect(), s = document.querySelector('.dd-sheet'), p = s.getBoundingClientRect(); return { w: f.clientWidth, h: f.clientHeight, right: Math.round(r.right), bottom: Math.round(r.bottom), panel: Math.round(p.left), top: Math.round(p.top), wide: s.classList.contains('wide') } })()`)
  const webY = await inPage(webCur, 'scrollY')
  check('网页铺满单看、右边开着面板（#22）：页面宽高不变（不重排）、滚动位置不丢，整个在面板左边（不被挡）', webGeo.w === webW0 && webY === 900 && (webGeo.wide ? webGeo.h === webH0 && webGeo.right <= webGeo.panel : webGeo.bottom <= webGeo.top + 1), JSON.stringify({ webW0, webH0, webY, ...webGeo }))
  await shot('10-web-panel')
  await page(`document.querySelector('.ddp-dock button[data-tip="外观"]').click()`)
  await sleep(300)
  // 对比（#22）：开版本面板、点上一版、对比；版本面板开 / 关时页面宽高一样，开着时整个在面板左边
  await page(`document.querySelector('.ddp-isl.dd-mini').click()`)
  const webVers = await until(`document.querySelectorAll('.ddp-hist .dd-vc').length >= 2 && document.querySelectorAll('.ddp-hist .dd-vc').length`, 8000)
  // 点上一版对比：版本记在这个会话最早那套设计上，上一版里没有这一屏（左边是「这一版里没有」）；右边是现在的网页，量它
  await page(`document.querySelectorAll('.ddp-hist .dd-vc')[1].click()`)
  await until(`!!(${VERDOCK} && ${VERDOCK}.querySelector('.dd-bt.ghost'))`, 8000)
  await page(`${VERDOCK}.querySelector('.dd-bt.ghost').click()`)
  await until(`document.querySelectorAll('.ddp-cmp iframe').length >= 1`, 8000)
  await sleep(800)
  const cmpGeo = () => page(`(() => { const fr = [...document.querySelectorAll('.ddp-cmp iframe')], c = document.querySelector('.ddp-cmp'), p = document.querySelector('.dd-sheet'); return { n: fr.length, w: fr.map((f) => f.clientWidth), h: fr.map((f) => f.clientHeight), right: c ? Math.round(c.getBoundingClientRect().right) : null, bottom: fr.length ? Math.round(Math.max(...fr.map((f) => f.getBoundingClientRect().bottom))) : null, panel: p ? Math.round(p.getBoundingClientRect().left) : null, top: p ? Math.round(p.getBoundingClientRect().top) : null, wide: !!p && p.classList.contains('wide') } })()`)
  const cmpOn = await cmpGeo()
  await shot('10-web-compare')
  await page(closeSheet)
  await sleep(800)
  const cmpOff = await cmpGeo()
  check('网页对比、开着版本面板（#22）：页面宽高和不开面板时一样（不重排），整个在面板左边', !!webVers && cmpOn.n >= 1 && cmpOff.n === cmpOn.n && cmpOff.panel === null && JSON.stringify(cmpOn.w) === JSON.stringify(cmpOff.w) && (cmpOn.wide ? JSON.stringify(cmpOn.h) === JSON.stringify(cmpOff.h) && cmpOn.right <= cmpOn.panel : cmpOn.bottom <= cmpOn.top + 1), JSON.stringify({ webVers, cmpOn, cmpOff }))
  await page(`${VERDOCK}.querySelector('.dd-x').click()`)
  await sleep(300)

  // ⑨zf 自定义画幅 + 多尺寸（#23）：网页自定义成 1000×700 → 多尺寸并排的手机 / 平板 / 电脑后面多一档「自定义 · 1000」；关掉、恢复默认
  // 先在菜单里把「按画幅显示」关掉（铺满）：填了画幅要自动换回按画幅显示，单看就是 1000×700
  const fitItem = `[...document.querySelectorAll('.ddp-menu [role=menuitemcheckbox]')].find((x) => /按画幅/.test(x.textContent))`
  for (let i = 0; i < 2; i++) { await page(pmMain); await page(`${fitItem}.click()`); await sleep(300) }
  await page(pmMain)
  const fillOff = await page(`${fitItem}.getAttribute('aria-checked')`)
  await page(menuOpen)
  await setCustomSize(1000, 700)
  const webSized = await until(`((f) => f && f.clientWidth === 1000 && f.clientHeight === 700)(${webCur})`, 8000)
  await page(pmMain)
  const fitOn = await page(`${fitItem}.getAttribute('aria-checked')`)
  await page(pmClose)
  const fitStored = await page(`localStorage.getItem('ddp-fit-for') || ''`)
  check('自定义画幅（#23）：网页之前切成铺满，填 1000×700 → 换回按画幅显示，单看就是 1000×700（记在本机，重开也在）', fillOff === 'false' && !!webSized && fitOn === 'true' && /"1000x700"/.test(fitStored), JSON.stringify({ fillOff, fitOn, fitStored, frame: await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(${webCur})`) }))
  await sleep(500)
  await page(pmMain)
  await page(`document.querySelector('.dd-pm [role=menuitemcheckbox]').click()`)
  await page(pmClose)
  const multiLabs = await until(`((ls) => ls.length >= 4 && ls.join('|'))([...document.querySelectorAll('.ddp-cell .ddp-lab')].map((x) => x.textContent.trim()))`, 10000)
  // 标签先出来、iframe 晚一点才挂上：等到那一档的 iframe 量得到
  const frs = `[...document.querySelectorAll('.ddp-cell iframe')].map((f) => f.clientWidth + 'x' + f.clientHeight).join(' ')`
  const multiFr = (await until(`((s) => /\\b1000x700\\b/.test(s) && s)(${frs})`, 10000)) || (await page(frs))
  check('多尺寸（#23）：自定义了 1000×700 → 并排多出一档「自定义 · 1000」，那块就是 1000×700', /自定义 · 1000/.test(multiLabs || '') && /\b1000x700\b/.test(multiFr || ''), `${multiLabs} / ${multiFr}`)
  await sleep(800)
  await shot('10-web-sizes-custom')
  await page(pmMain)
  await page(`document.querySelector('.dd-pm [role=menuitemcheckbox]').click()`)
  await sleep(300)
  await page(menuOpen)
  await page(`[...document.querySelectorAll('.ddp-szrow button')].find((x) => /恢复默认/.test(x.textContent)).click()`)
  await sleep(500)
  check('多尺寸（#23）：恢复默认后菜单写回「默认」', await until(`(async () => { await ${menuOpen}; const r = document.querySelector('.ddp-szrow'); return !!r && /默认/.test(r.innerText) && !/恢复默认/.test(r.innerText) })()`, 5000))
  await page(pmClose)
  await sleep(300)
  // 恢复默认：回到之前选的铺满（不改记住的偏好；后面的拖放也要单页铺满）
  await page(pmMain)
  const fitBack = await page(`${fitItem}.getAttribute('aria-checked')`)
  await page(pmClose)
  const webFill = await page(`((f) => f && f.clientWidth !== 1000 && f.clientWidth !== 1440)(${webCur})`)
  const fitLeft = await page(`localStorage.getItem('ddp-fit-for') || ''`)
  check('自定义画幅（#23）：恢复默认 → 网页回到铺满（不改记住的「按画幅显示」），本机记的也清掉', fitBack === 'false' && !!webFill && !/1000x700/.test(fitLeft), JSON.stringify({ fitBack, fitLeft, frame: await page(`((f) => f ? f.clientWidth + 'x' + f.clientHeight : '没有 iframe')(${webCur})`) }))
  await sleep(300)

  // ⑨zg 分享到设计市场（gallery PR #33）：表单多了分类（必选 1–2 个，从市场词表里选）、标签（可选）、设计里的文字；没选分类点不了「检查」
  await page(openSheet('分享', 'share', '/投稿到市场/'))
  await until(`document.querySelectorAll('.ddp-share .chips[aria-label^="分类"] button').length`, 10000)
  // 分类先只露几个，点「全部 N」展开
  await page(`(() => { const m = document.querySelector('.ddp-share .chips[aria-label^="分类"] .more'); if (m) m.click() })()`)
  await sleep(200)
  const shChips = await page(`document.querySelectorAll('.ddp-share .chips[aria-label^="分类"] button:not(.more)').length`)
  await page(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const ins = document.querySelectorAll('.ddp-share input.who'); for (const [i, v] of [[0, '街角网页'], [1, '一屏的街角小店网页']]) { set.call(ins[i], v); ins[i].dispatchEvent(new Event('input', { bubbles: true })) } ; for (const c of document.querySelectorAll('.ddp-share .agree input')) if (!c.checked) c.click() })()`)
  await sleep(300)
  const shGo = `document.querySelector('.ddp-share footer .go')`
  const shOff = await page(`${shGo}.disabled`)
  await page(`document.querySelector('.ddp-share .chips[aria-label^="分类"] button').click()`)
  await page(`[...document.querySelectorAll('.ddp-share .chips[aria-label^="标签"] button')].slice(0, 2).forEach((b) => b.click())`)
  await sleep(300)
  const shOn = await page(`!${shGo}.disabled`)
  const shPicked = await page(`({ c: document.querySelectorAll('.ddp-share .chips[aria-label^="分类"] button.on').length, t: document.querySelectorAll('.ddp-share .chips[aria-label^="标签"] button.on').length, lang: (document.querySelector('.ddp-share [role=radiogroup] [aria-checked=true]') || {}).textContent })`)
  check('分享到设计市场（gallery PR #33）：表单有分类 / 标签 / 设计里的文字；没选分类点不了「检查」，选了就能点', shChips >= 10 && shOff === true && shOn === true && shPicked.c === 1 && shPicked.t === 2 && shPicked.lang === '中文', JSON.stringify({ shChips, shOff, shOn, shPicked }))
  await page(`document.querySelector('.ddp-share .chips[aria-label^="分类"]').scrollIntoView({ block: 'center' })`)
  await sleep(300)
  await shot('10-share-form')
  await page(closeSheet)
  await sleep(300)

  // ⑩ 打开已有的 HTML（#8）：网页版没有桌面版的桥 → 不显示「浏览…」、拖进来提示输路径；装上假桥（和桌面版一样的接口）→ 选文件、拖进来、选文件夹都能用
  const OTHER = path.join(tmp, 'work', 'other-site')
  fs.mkdirSync(OTHER, { recursive: true })
  fs.writeFileSync(path.join(OTHER, 'landing.html'), `${HEAD('落地页')}</head><body><main><h1>落地页</h1></main></body></html>`)
  fs.utimesSync(path.join(OTHER, 'landing.html'), Date.now() / 1000 - 30, Date.now() / 1000 - 30)
  fs.writeFileSync(path.join(OTHER, 'about.html'), `${HEAD('关于')}</head><body><main><h1>关于我们</h1></main></body></html>`)
  const BROWSE = `document.querySelector('.ddp-top button[title="选一个本地 HTML 文件打开"]')`
  // 工具栏左边是屏名菜单：开的是哪个文件看它的 data-src；要输地址点项目名 ▾ 里的「打开 HTML…」
  const addrText = `((el) => el ? el.dataset.src || '' : '')(document.querySelector('.ddp-addr'))`
  const openAddr = async () => {
    // 1.0：项目名 ▾ →「打开 HTML…」→ 左上换成地址框
    await page(`(async () => { if (!(await ${pmMain})) return false; const it = [...document.querySelectorAll('.dd-pm [role=menuitem]')].find((x) => /打开 HTML|Open HTML/.test(x.textContent)); if (it) it.click(); return !!it })()`).catch(() => {})
    return until(`!!document.querySelector('.ddp-top .ddp-input')`, 3000)
  }
  const NOTES = path.join(tmp, 'work', 'notes.txt')
  fs.writeFileSync(NOTES, 'x')
  const DROPDIR = path.join(tmp, 'work', 'drop-dir')
  fs.mkdirSync(DROPDIR, { recursive: true })
  fs.writeFileSync(path.join(DROPDIR, 'first.html'), `${HEAD('第一屏')}</head><body><main><h1>第一屏</h1></main></body></html>`)
  // 真拖放（浏览器自己发的 dragenter / dragover / drop，带真文件）：落点默认是右侧栏的地址栏；at 给的是别的元素（比如预览页面的 iframe）
  const centerOf = (sel) => page(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => b.width * b.height - a.width * a.height); const r = els[0]; return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null })()`)
  const realDrop = async (files, at = '.ddp-top .dd-where') => {
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
    const PNG = path.join(tmp, 'ref.png') // 别写进正在看的目录：会触发换帧，读到的是新的一帧
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
      const UPF = `JSON.stringify([...document.querySelectorAll('.ddp iframe')].filter((f) => /upload\\.html/.test(f.src)).map((f) => f.className + '|' + Math.round(f.getBoundingClientRect().width)))`
      const pre = await page(`(() => { const e = document.elementFromPoint(${zp[0]}, ${zp[1]}); return (e ? e.tagName + '.' + e.className : '') + ' ' + ${UPF} })()`)
      const t0 = Date.now()
      await at(zp, 'drop')
      await sleep(600)
      const got = await inFrame(`document.body.getAttribute('data-got') || ''`)
      if (!got) {
        const post = await page(UPF)
        await sleep(1500)
        res.push({ id, miss: true, pre, post, later: await inFrame(`document.body.getAttribute('data-got') || ''`), framesLater: await page(UPF), ms: Date.now() - t0 })
      }
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
  // 转成代码是顶上的主按钮；「代码放在」平时只显示文件夹名（完整路径在 title 第一行），点了才是输入框
  const HO_DEST = "((el) => (el ? (el.tagName === 'INPUT' ? el.value : el.title.split('\\n')[0]) : ''))(document.querySelector('.ddp-ho .pathrow input, .ddp-ho .pathv'))"
  await page(openSheet('转成代码', 'code')).catch(() => {})
  const hoDir = await until(`!!document.querySelector('.ddp-ho .ddp-dirbtn')`, 8000)
  if (hoDir) await page(`document.querySelector('.ddp-ho .ddp-dirbtn').click()`)
  const hoVal = await until(`${HO_DEST} === ${JSON.stringify(path.join(tmp, 'work', 'app-code'))}`, 5000)
  check('转成代码：「代码放在」旁的选文件夹按钮 → 选的目录填进去', hoDir && hoVal, await page(`(document.querySelector('.ddp-ho') || {}).innerText || '没有面板'`))
  // 检查文件夹还没回来时「开始」点不了；这时自己点了框架，检查回来也不改掉
  const PROJ = path.join(tmp, 'work', 'vue-proj')
  fs.mkdirSync(PROJ, { recursive: true })
  fs.writeFileSync(path.join(PROJ, 'package.json'), '{"dependencies":{"vue":"3"}}')
  await page(`(() => { const f = window.fetch; window.__e2eFetch = f; window.fetch = (u, o) => (/project\\?.*dest=/.test(String(u)) ? new Promise((r) => setTimeout(r, 1500)).then(() => f(u, o)) : f(u, o)); window.__e2eDir = ${JSON.stringify(PROJ)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`)
  const busyGo = await until(`(document.querySelector('.ddp-ho .dd-sf .dd-bt.pri') || {}).disabled === true && /正在看这个文件夹/.test(document.querySelector('.ddp-ho').innerText)`, 3000)
  await page(`[...document.querySelectorAll('.ddp-ho .opt')].find((b) => /纯 HTML/.test(b.textContent))?.click()`)
  const kept = await until(`(() => { const ho = document.querySelector('.ddp-ho'); const on = ho && ho.querySelector('.opt.on'); return !!ho && !/正在看这个文件夹/.test(ho.innerText) && /Vue/.test(ho.innerText) && !ho.querySelector('.dd-sf .dd-bt.pri').disabled && !!on && on.textContent })()`, 8000)
  await page(`(() => { if (window.__e2eFetch) window.fetch = window.__e2eFetch; return true })()`)
  check('转成代码：检查文件夹时「开始」点不了；这时自己点了框架，检查回来也不改掉', !!busyGo && /纯 HTML/.test(kept || ''), JSON.stringify({ busyGo, kept, ho: await page(`(document.querySelector('.ddp-ho') || {}).innerText || ''`) }))
  // 先自己点了框架，再选个纯 HTML 站点：不按文件夹自动改成「纯 HTML」
  const STATIC = path.join(tmp, 'work', 'static-site')
  fs.mkdirSync(STATIC, { recursive: true })
  fs.writeFileSync(path.join(STATIC, 'index.html'), '<h1>x</h1>')
  await page(`[...document.querySelectorAll('.ddp-ho .opt')].find((b) => /Vue 3/.test(b.textContent))?.click()`)
  await page(`(() => { window.__e2eDir = ${JSON.stringify(STATIC)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`)
  const keptVue = await until(`(() => { const ho = document.querySelector('.ddp-ho'); const on = ho && ho.querySelector('.opt.on'); return ${HO_DEST} === ${JSON.stringify(STATIC)} && !ho.querySelector('.dd-sf .dd-bt.pri').disabled && !!on && on.textContent })()`, 5000)
  check('转成代码：先点了 Vue 再选纯 HTML 站点 → 框架还是 Vue', /Vue 3/.test(keptVue || ''), JSON.stringify({ keptVue }))
  // 选了个有别的东西的文件夹（比如 ~/Projects）→ 在里面新建 <设计名>-app，下面说一声
  const PARENT = path.join(tmp, 'work', 'picked-parent')
  fs.mkdirSync(PARENT, { recursive: true })
  fs.writeFileSync(path.join(PARENT, 'notes.md'), 'x')
  await page(`(() => { window.__e2eDir = ${JSON.stringify(PARENT)}; document.querySelector('.ddp-ho .ddp-dirbtn').click(); return true })()`).catch(() => {})
  const nested = path.join(PARENT, 'other-site-app')
  const hoNest = await until(`${HO_DEST} === ${JSON.stringify(nested)} && (document.querySelector('.ddp-ho .moved') || {}).innerText`, 5000)
  check('转成代码：选了有别的东西的文件夹 → 改放进里面新建的 <设计名>-app，下面说一声', /已经有别的东西/.test(hoNest || '') && /other-site-app/.test(hoNest || ''), await page(`(document.querySelector('.ddp-ho') || {}).innerText || '没有面板'`))
  await page(`document.querySelector('.ddp-ho .dd-sf .dd-bt.pri')?.click()`).catch(() => {})
  const goTxt = await until(`(() => { const t = ${composerText}; return t.includes(${JSON.stringify(nested)}) && t })()`, 5000)
  check('转成代码：点「开始转成代码」→ 交给模型的目录就是新建的那个', !!goTxt, String(await page(composerText)).slice(-300))
  await page(closeSheet).catch(() => {})
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
  // ⑫ 首页风格面板不被下面的「接着做」盖住（issue #9）
  await page(`document.querySelector('.ddp-top .dd-logo').click(), 1`)
  const homeUp = await until(`!!document.querySelector('.ddp-home .ddp-askta')`, 20000)
  if (check('工具栏回到设计台首页', homeUp, await page(`document.querySelector('.ddp') ? document.querySelector('.ddp').className : '没有 .ddp'`))) {
    await page(`document.querySelector('.ddp-ask button.chip[aria-haspopup=dialog]').click(), 1`)
    const popUp = await until(`!!document.querySelector('.ddp-askpop')`, 5000)
    const covered = popUp ? await page(`(() => { const p = document.querySelector('.ddp-askpop'); const r = p.getBoundingClientRect(); let bad = 0; for (const x of [.15, .5, .85]) for (const y of [.15, .5, .85]) { const e = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y); if (!e || !p.contains(e)) bad++ } return bad })()`) : -1
    check('首页风格面板：九个点都点得到面板（没被下面盖住）', covered === 0, `被盖住 ${covered} 个点`)
    await shot('11-home-pop')
    // 套外框（#19 第 2 步）：选了这个类型，下面列出外框库里的外框，能挑一个
    await page(`document.querySelector('.ddp-askpop') && document.querySelector('.ddp-ask button.chip[aria-haspopup=dialog]').click(), 1`)
    await page(`(() => { const m = document.querySelector('.ddp-askkinds .more'); if (m && m.getAttribute('aria-expanded') !== 'true') m.click(); return 1 })()`)
    await sleep(200)
    await page(`[...document.querySelectorAll('.ddp-askkinds button')].find((b) => b.textContent.trim() === '套外框').click(), 1`)
    const frRow = await until(`(() => { const r = document.querySelector('.ddp-askframes'); return r ? [...r.querySelectorAll('button')].map((b) => b.textContent.trim()) : null })()`, 8000)
    await page(`[...document.querySelectorAll('.ddp-askframes button')].find((b) => b.textContent.trim() === '示例弹窗')?.click(), 1`)
    const frOn = await page(`(() => { const b = [...document.querySelectorAll('.ddp-askframes button')].find((x) => x.textContent.trim() === '示例弹窗'); return !!b && b.getAttribute('aria-checked') === 'true' })()`)
    check('首页「套外框」：下面列出外框库里的外框（新外框 + 示例弹窗），点了选上', JSON.stringify(frRow) === JSON.stringify(['新外框', '示例弹窗']) && frOn, JSON.stringify({ frRow, frOn }))
    await shot('11-home-frames')
    await page(`[...document.querySelectorAll('.ddp-askkinds button')].find((b) => b.textContent.trim() === '套外框').click(), 1`)
  }
  await chrome.cdp('Emulation.setFocusEmulationEnabled', { enabled: false }, sessionId).catch(() => {})
  await tuneCheck()
  await bigCheck()
  await modeCheck()
  if (process.env.E2E_REAL_TUNNEL === '1') await archiveCheck()
  logCheck()
} catch (e) {
  if (e !== MODE_DONE) check('没有异常', false, (e && e.stack) || e)
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
