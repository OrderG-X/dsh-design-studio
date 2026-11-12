/**
 * 不碰 DSH 的核心逻辑（方便单测）：
 *   parseTarget  用户 / 模型给的地址 → 预览目标
 *   parseKind / parseSize  设计类型（网页 / App / 海报 …）和画幅尺寸
 *   listScreens  一个目录里的几屏（HTML 文件，按生成顺序）
 *   createTracker 每个会话的预览状态，以及从会话事件里自动发现「该预览什么」
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJsonStringDecoder } from './draft.js'

const HTML_EXT = /\.html?$/i
const LOCAL_URL = /^(?:https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(\/[^\s]*)?$/i
// 命令输出里的本机地址（开发服务器启动时会打印）
const URL_IN_TEXT = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(\/[^\s"'`<>)\]]*)?/gi
const LIVE_MS = 120000 // 事件时间离现在超过这么久就当是重放历史
const DRAFT_LIVE_MS = 8000 // 草稿写完这么久以内右侧栏才看到：还放一遍（轮询 0.7 秒一次，放一遍三四秒，留足余量）
const CHANGE_LOG = 20 // 记最近几批文件改动（远程看按它补齐两次轮询之间的改动）
const DESIGN_SKILL = 'ui-design'
const ASK_TOOL = 'ask_user_question' // DSH 的提问卡：模型问了、在等用户回答
const DESIGN_META = /<meta[^>]+name=["']?dsh-design\b/i
// 只查看、不启动服务的命令（curl 一下别的项目的端口，不该把那个端口当成在做的设计）
const PROBE_CMD = /\b(curl|wget|httpie|xh|lsof|netstat|ss|nc|telnet|kill|pkill|open|ps)\b/i
// 启动开发服务器的命令，或者服务器启动时打印的那一行
const DEV_CMD = /\b(dev|serve|server|start|preview|watch|vite|next|nuxt|astro|webpack|parcel|storybook|hugo|jekyll|eleventy)\b|http\.server|http-server|live-server|browser-sync/i
const BANNER = /\b(local|listening|running|serving|started|ready|available|preview)\b/i
const SHELL_TOOL = /^(bash|shell|sh|zsh|powershell|pwsh|exec|run_command|terminal)$/i
// 放到后台跑的命令（DSH：bash 带 run_in_background，或前台超时转后台）回一个 job id，输出要用 job_output 去读
const JOB_READ_TOOL = /^(job_output|bash_output|read_job|job_read)$/i
const BG_JOB = /\bbackground job\s+`?([\w.:-]{3,})/i
const MAX_SCREENS = 60 // 右侧最多显示几屏，再多的收起来并提示（画布同时只挂 24 屏，见 client.js 的 LIVE_MAX）
const MAX_ROUTES = 300 // 开发服务器的路由先都记着（只为算出收起了几屏）；再多就是写飞了

// 设计类型：决定右侧用什么画幅显示（网页框、手机、小程序、平板、桌面软件窗口、海报、幻灯片、邮件）
export const KINDS = ['web', 'app', 'miniprogram', 'tablet', 'desktop', 'poster', 'slides', 'email']
const KIND_ALIAS = {
  website: 'web', site: 'web', page: 'web', landing: 'web', dashboard: 'web',
  phone: 'app', mobile: 'app', ios: 'app', android: 'app',
  mini: 'miniprogram', miniapp: 'miniprogram', weapp: 'miniprogram', wechat: 'miniprogram', 小程序: 'miniprogram',
  pad: 'tablet', ipad: 'tablet',
  pc: 'desktop', electron: 'desktop', tauri: 'desktop', mac: 'desktop', macos: 'desktop', windows: 'desktop', win: 'desktop', 桌面: 'desktop', 桌面软件: 'desktop',
  social: 'poster', image: 'poster', banner: 'poster', card: 'poster', flyer: 'poster', cover: 'poster',
  slide: 'slides', deck: 'slides', ppt: 'slides', presentation: 'slides',
  mail: 'email', newsletter: 'email', edm: 'email',
}

/** 类型名（含常见别名）→ KINDS 里的一个；认不出返回 '' */
export function parseKind(input) {
  const k = String(input || '').trim().toLowerCase()
  if (!k) return ''
  if (KINDS.includes(k)) return k
  return KIND_ALIAS[k] || ''
}

/** 「1080x1920」「1080×1920」→ '1080x1920'；不像尺寸返回 '' */
export function parseSize(input) {
  const m = /^\s*(\d{2,5})\s*[x×*,]\s*(\d{2,5})\s*$/i.exec(String(input || ''))
  if (!m) return ''
  const w = Number(m[1])
  const h = Number(m[2])
  if (w < 100 || h < 100 || w > 8000 || h > 8000) return ''
  return `${w}x${h}`
}

/** 右侧显示的几屏：超过上限时留最新生成的，最早的先收起来。keep：正打开的那屏，不在里面也留着（挤掉最早的一屏） */
export function listScreens(root, keep = '') {
  const born = screensByBirth(root)
  let kept = born.slice(-MAX_SCREENS)
  if (keep && !kept.includes(keep)) {
    if (kept.length >= MAX_SCREENS) kept.shift()
    // 按创建顺序放回原位（打开文件夹取的是最早的一屏，别排到最后）；不在顶层的（一般不会有）放最后
    kept = born.includes(keep) ? born.filter((x) => x === keep || kept.includes(x)) : [...kept, keep]
  }
  return inManifestOrder(root, kept)
}

/** 目录里所有的屏。按文件名找、改全套的时候用这个，别漏掉收起来的 */
export function allScreens(root) {
  return inManifestOrder(root, screensByBirth(root))
}

/** 顶层的 HTML 文件，按创建时间（= 模型生成的顺序）排 */
function screensByBirth(root) {
  let dirents
  try { dirents = fs.readdirSync(root, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const d of dirents) {
    // . 开头是隐藏文件，_ 开头当草稿 / 模型的临时探针（_probe.html、_layout.html），都不算一屏
    if (!d.isFile() || !HTML_EXT.test(d.name) || d.name.startsWith('.') || d.name.startsWith('_')) continue
    let born = 0
    try {
      const st = fs.statSync(path.join(root, d.name))
      born = st.birthtimeMs || st.ctimeMs
    } catch { continue }
    out.push({ name: d.name, born })
  }
  out.sort((a, b) => a.born - b.born || a.name.localeCompare(b.name))
  return out.map((x) => x.name)
}

/** 有设计清单（design.json，从设计库来的模板 / 分享过的设计）：按清单里的顺序排，清单外的（模型后加的）按创建时间排在后面 */
function inManifestOrder(root, names) {
  const order = manifestOrder(root)
  if (!order.length) return names
  const rank = new Map(order.map((f, i) => [f.toLowerCase(), i]))
  const listed = names.filter((x) => rank.has(x.toLowerCase())).sort((a, b) => rank.get(a.toLowerCase()) - rank.get(b.toLowerCase()))
  return [...listed, ...names.filter((x) => !rank.has(x.toLowerCase()))]
}

/** design.json 里 screens 的文件名（读不了、写错了都当没有） */
export function manifestOrder(root) {
  let m
  try {
    const raw = fs.readFileSync(path.join(root, 'design.json'), 'utf8')
    if (raw.length > 256 * 1024) return []
    m = JSON.parse(raw)
  } catch { return [] }
  if (!m || !Array.isArray(m.screens)) return []
  return m.screens.map((s) => (s && typeof s.file === 'string' ? s.file : typeof s === 'string' ? s : '')).filter((f) => f && !/[\\/]/.test(f) && HTML_EXT.test(f)).slice(0, MAX_SCREENS)
}

/** 开发服务器上要并排看的几个路由 */
function normRoutes(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const r of list) {
    let s = String(r || '').trim()
    if (!s) continue
    const m = LOCAL_URL.exec(s)
    if (m) s = m[3] || '/'
    if (!s.startsWith('/')) s = '/' + s
    if (!out.includes(s)) out.push(s)
    if (out.length >= MAX_ROUTES) break
  }
  return out.length ? out : null
}

/** Windows 上 DSH 用 Git Bash 跑命令，模型给的路径常是 /c/Users/… 这种写法：换成 C:\\Users\\…；别的系统原样 */
export function fromBashPath(p, platform = process.platform) {
  if (platform !== 'win32') return p
  const m = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p)
  return m ? `${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}` : p
}

/**
 * @returns {{ kind: 'file', file, root } | { kind: 'proxy', port, path }}
 * @throws Error 带中文说明
 */
export function parseTarget(input, cwd = os.homedir()) {
  let s = String(input || '').trim()
  // Windows「复制为路径」会带一对引号："C:\a\b.html"
  const q = /^(["'“])(.*)(["'”])$/.exec(s)
  if (q && (q[1] === q[3] || (q[1] === '“' && q[3] === '”'))) s = q[2].trim()
  if (!s) throw new Error('地址是空的')
  if (/^\d{2,5}$/.test(s)) return proxyTarget(Number(s), '/')
  const m = LOCAL_URL.exec(s)
  if (m) return proxyTarget(Number(m[2]), m[3] || '/')
  if (/^https?:\/\//i.test(s)) throw new Error('只能预览本机的页面：本地 HTML 文件，或 localhost 上的开发服务器')
  let p = null
  // 标准的 file:// 地址交给 Node 转（Windows 上是 file:///C:/…，直接去掉前缀会变成 /C:/…）
  if (/^file:\/\//i.test(s)) try { p = fileURLToPath(s) } catch { /* file://~/… 之类的写法，按下面的老办法 */ }
  const full = (x) => {
    x = fromBashPath(x)
    if (x === '~' || x.startsWith('~/') || x.startsWith('~\\')) x = path.join(os.homedir(), x.slice(1))
    return path.resolve(cwd, x)
  }
  if (p === null) {
    const raw = s.replace(/^file:\/\//i, '')
    p = raw
    // %20 之类按网址解开；但文件名里本来就带 %（「浏览…」选的、拖进来的都是原样路径）且原样存在时，别解
    if (raw.includes('%') && !fs.existsSync(full(raw))) {
      try { p = decodeURIComponent(raw) } catch { /* 原样用 */ }
    }
  }
  p = full(p)
  let st
  try { st = fs.statSync(p) } catch { throw new Error(`找不到：${p}`) }
  if (st.isDirectory()) {
    // 有 index.html 开它；没有就开最先做的那屏（设计目录一屏一个文件，画布上会把同目录的几屏都排出来）
    const index = path.join(p, 'index.html')
    const first = fs.existsSync(index) ? 'index.html' : allScreens(p)[0]
    if (!first) {
      try { fs.readdirSync(p) } catch (e) { throw new Error(`读不了这个文件夹（${e.code === 'EACCES' || e.code === 'EPERM' ? '没有权限' : e.code || e.message}）：${p}`) }
      throw new Error(`这个文件夹里没有 HTML 文件：${p}`)
    }
    p = path.join(p, first)
  } else if (!HTML_EXT.test(p)) {
    throw new Error(`只能预览 .html 文件：${p}`)
  }
  return { kind: 'file', file: p, root: path.dirname(p) }
}

function proxyTarget(port, pathname) {
  if (!(port >= 1 && port <= 65535)) throw new Error(`端口不对：${port}`)
  return { kind: 'proxy', port, path: pathname.startsWith('/') ? pathname : '/' + pathname }
}

/** 预览服务器上的地址 */
export function urlFor(target, origin) {
  if (target.kind === 'file') {
    const rel = path.relative(target.root, target.file).split(path.sep).map(encodeURIComponent).join('/')
    return `${origin}/${rel}`
  }
  return origin + target.path
}

/** 工具栏上显示的短名字 */
export function labelOf(target) {
  return target.kind === 'file' ? path.basename(target.file) : `localhost:${target.port}${target.path === '/' ? '' : target.path}`
}

export function sameTarget(a, b) {
  if (!a || !b || a.kind !== b.kind) return false
  return a.kind === 'file' ? a.file === b.file : a.port === b.port && a.path === b.path
}

/** 工具参数（JSON 字符串或对象）里的写文件路径；不是写文件返回 '' */
const WRITE_TOOL = /^(write|edit|multi_?edit|create_file|str_replace\w*)$/i

function writtenPath(name, args) {
  if (!WRITE_TOOL.test(String(name || ''))) return ''
  let a = args
  if (typeof a === 'string') {
    try { a = JSON.parse(a) } catch { return '' }
  }
  if (!a || typeof a !== 'object') return ''
  const p = a.file_path || a.filePath || a.path
  return typeof p === 'string' ? p : ''
}

function textsOf(content) {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text)
}

/** HTML 文件里写了 <meta name="dsh-design">（设计技能让模型写的类型标记）就是设计稿 */
export function isDesignHtml(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(65536)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      return DESIGN_META.test(buf.subarray(0, n).toString('utf8'))
    } finally { fs.closeSync(fd) }
  } catch { return false }
}

/** 用户自己调了设计技能（输入框里打 /ui-design） */
function userLoadedSkill(data) {
  if (!data || !data.source || data.source.kind !== 'user') return false
  const c = data.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''
  return new RegExp(`<skill_content[^>]*name=["']${DESIGN_SKILL}["']|^\\s*/${DESIGN_SKILL}\\b`, 'm').test(text)
}

function argsOf(a) {
  if (a && typeof a === 'object') return a
  try { return JSON.parse(a) || {} } catch { return {} }
}

/**
 * 这条命令输出里有没有「开发服务器起来了」的地址：只认 bash 跑的启动命令（或输出里像启动信息的那一行），
 * curl / wget 之类只是去看别的端口的不算。
 */
export function devServerIn(command, text, skipPorts = new Set()) {
  const cmd = String(command || '')
  if (PROBE_CMD.test(cmd.replace(/\b(dev|serve|server|start|preview)\b/gi, ''))) return null
  const lines = String(text || '').split('\n').filter((l) => /https?:\/\//i.test(l) && (DEV_CMD.test(cmd) || BANNER.test(l)))
  return lines.length ? serverUrlIn(lines.join('\n'), skipPorts) : null
}

/** 命令输出里最后一个本机地址（开发服务器常常先打 Local: 再打 Network:，取 localhost 那个） */
// ── 预览里直接改字：在 HTML 源码的文字部分里找到那一处换掉 ──────────────────────

/** 标签、注释、脚本 / 样式这类不算文字的块；剩下的就是页面上看得到的字 */
const NOT_TEXT = /<!--[\s\S]*?-->|<(script|style|textarea|noscript|template|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>/gi
const ENT = {
  '&': '(?:&|&amp;|&#0*38;|&#x0*26;)',
  '<': '(?:<|&lt;|&#0*60;|&#x0*3c;)',
  '>': '(?:>|&gt;|&#0*62;|&#x0*3e;)',
  '"': '(?:"|&quot;|&#0*34;|&#x0*22;)',
  "'": "(?:'|&apos;|&#0*39;|&#x0*27;)",
}
const WS_SRC = '(?:\\s|&nbsp;|&#0*160;|&#x0*a0;)+'
const escHtml = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 页面上看到的一段字（空白已合并）→ 匹配它在源码里各种写法的正则 */
function textPattern(text) {
  let src = ''
  for (const ch of text) {
    if (/\s/.test(ch)) { if (!src.endsWith(WS_SRC)) src += WS_SRC }
    else src += ENT[ch] || ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(src, 'gi')
}

/**
 * 把 HTML 里第 nth 处（从 0 数，只数页面上看得到的文字，按出现顺序）before 换成 after。
 * before / after 是页面上看到的样子（空白合并过）；after 会转义成 HTML。
 * @returns {{ ok: true, html } | { ok: false, reason: 'empty' | 'not-found' }}
 */
export function replaceText(html, before, after, nth = 0) {
  const norm = (x) => String(x || '').replace(/[\s\u00a0]+/g, ' ').trim()
  const from = norm(before)
  const to = norm(after)
  if (!from || !to) return { ok: false, reason: 'empty' }
  const re = textPattern(from)
  let seen = 0
  let last = 0
  NOT_TEXT.lastIndex = 0
  for (let m = NOT_TEXT.exec(html); ; m = NOT_TEXT.exec(html)) {
    const end = m ? m.index : html.length
    const seg = html.slice(last, end)
    re.lastIndex = 0
    for (let t = re.exec(seg); t; t = re.exec(seg)) {
      if (seen++ === nth) {
        const at = last + t.index
        return { ok: true, html: html.slice(0, at) + escHtml(to) + html.slice(at + t[0].length) }
      }
    }
    if (!m) break
    last = m.index + m[0].length
  }
  return { ok: false, reason: 'not-found' }
}

// ── 预览里调样式：在 HTML 源码里找到那个元素的开头标签，把改的样式并进它的 style 属性 ─────────

/** 开头标签（属性值里可以有 >）；注释整块跳过，脚本 / 样式 / 模板这类连内容一起跳过（模板里的元素不在页面上；<SCRIPT> 大写也算） */
const TAG_SCAN = /<!--[\s\S]*?-->|<(script|style|textarea|title|template)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
/** 能调的几项；值只许数字、单位、颜色、var(--x) 这类，引号、分号、尖括号一律不收 */
export const STYLE_PROPS = ['font-size', 'font-weight', 'color', 'background', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap']
const STYLE_VALUE = /^[\w\s#%.,()+-]{1,80}$/

function attrsOf(s) {
  const out = {}
  ATTR.lastIndex = 0
  for (let m = ATTR.exec(s); m; m = ATTR.exec(s)) {
    const k = m[1].toLowerCase()
    if (!(k in out)) out[k] = { v: m[2] ?? m[3] ?? m[4] ?? '', at: m.index, len: m[0].length }
  }
  return out
}

/**
 * 页面上那个元素在源码里是哪个开头标签。loc：{ tag, n（页面上第几个这种标签）, total（页面上一共几个）, id, cls（页面上的类） }。
 * 页面上和源码里这种标签一样多：按第几个找，再核对 id 和类（页面脚本可能加了类，源码里的类都在就行）；
 * 对不上（页面脚本加过元素）：只认 id 和类完全一样、而且只有一个的。都不行就算找不到，宁可交给模型也别改错地方。
 */
export function findTag(html, { tag, n = 0, total = -1, id = '', cls = [] } = {}) {
  const name = String(tag || '').toLowerCase()
  if (!/^[a-z][\w-]*$/.test(name)) return null
  const list = []
  TAG_SCAN.lastIndex = 0
  for (let m = TAG_SCAN.exec(html); m; m = TAG_SCAN.exec(html)) {
    if (m[1] || !m[2] || m[2].toLowerCase() !== name) continue
    list.push({ start: m.index, end: m.index + m[0].length, name: m[2], attrs: m[3] || '' })
  }
  const want = new Set((Array.isArray(cls) ? cls : []).map(String))
  const classesOf = (x) => { const a = attrsOf(x.attrs); return { id: a.id ? a.id.v : '', cls: a.class ? a.class.v.split(/\s+/).filter(Boolean) : [] } }
  const same = (x) => { const a = classesOf(x); return a.id === String(id || '') && a.cls.length === want.size && a.cls.every((k) => want.has(k)) }
  const x = list[n]
  if (x && total === list.length) {
    const a = classesOf(x)
    if (a.id === String(id || '') && a.cls.every((k) => want.has(k))) return x
  }
  const hits = list.filter(same)
  return hits.length === 1 ? hits[0] : null
}

/** style 属性按 ; 拆成一条条（括号、引号里的不拆，比如 url(data:…;base64,…)） */
function splitDecls(s) {
  const out = []
  let depth = 0
  let q = ''
  let cur = ''
  for (const ch of s) {
    if (q) { if (ch === q) q = ''; cur += ch; continue }
    if (ch === '"' || ch === "'") q = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && !depth) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out.map((d) => d.trim()).filter(Boolean)
}

/**
 * 把 css（属性 → 值，值为空 = 去掉这一条）并进原来的 style（已解开实体的文字）：改过的原地换（同名的几条只留一条），新的放最后；
 * 写 background 时去掉 background-color / -image（不然前后打架）。自定义属性（--x）区分大小写，原样留着。
 */
export function mergeStyle(style, css) {
  const decls = splitDecls(String(style || '')).map((d) => {
    const i = d.indexOf(':')
    if (i <= 0) return null
    const p = d.slice(0, i).trim()
    return [p.startsWith('--') ? p : p.toLowerCase(), d.slice(i + 1).trim()]
  }).filter(Boolean)
  for (const [k, v] of Object.entries(css || {})) {
    const prop = k.toLowerCase()
    if (prop === 'background') for (let i = decls.length - 1; i >= 0; i--) if (/^background-(color|image)$/.test(decls[i][0])) decls.splice(i, 1)
    const i = decls.findIndex(([p]) => p === prop)
    for (let j = decls.length - 1; j > i && i >= 0; j--) if (decls[j][0] === prop) decls.splice(j, 1)
    if (!v) { if (i >= 0) decls.splice(i, 1); continue }
    if (i >= 0) decls[i][1] = v
    else decls.push([prop, v])
  }
  return decls.map(([p, v]) => `${p}: ${v}`).join('; ')
}

/** 属性值里的实体解回来（style 里用得到的：引号、&、尖括号） */
const unAttr = (s) => String(s)
  .replace(/&(quot|#0*34|#x0*22);/gi, '"').replace(/&(apos|#0*39|#x0*27);/gi, "'")
  .replace(/&(lt|#0*60|#x0*3c);/gi, '<').replace(/&(gt|#0*62|#x0*3e);/gi, '>').replace(/&(amp|#0*38|#x0*26);/gi, '&')

/** 只留能调的那几项、值合规的；一项都不剩返回 null */
export function cleanCss(css) {
  const out = {}
  for (const [k, v] of Object.entries(css && typeof css === 'object' ? css : {})) {
    const prop = String(k).toLowerCase()
    const val = String(v ?? '').trim()
    if (!STYLE_PROPS.includes(prop)) continue
    if (val && (!STYLE_VALUE.test(val) || /url\s*\(|expression/i.test(val))) continue
    out[prop] = val
  }
  return Object.keys(out).length ? out : null
}

/** 选择器写法统一：去引号、:: → :、空白压成一个、组合符和括号两边不留空格 */
const normSel = (s) => String(s || '').replace(/["']/g, '').replace(/::/g, ':').replace(/\s+/g, ' ').replace(/ ?([>+~,()]) ?/g, '$1').trim()

/**
 * 一条样式规则在源码（.css，或 HTML 里的 <style>）的第几行。
 * sel 是浏览器给的（规范化过：组合符两边加空格、属性值加双引号），源码里可能写得紧凑、换了引号、多了换行：都认（大小写照原样比）。
 * 不用拼正则：逐个字符找规则开头的「{」，把它前面那段选择器统一写法后比较，一遍扫完。
 * n：同样选择器的第几条（源码顺序，@media 里的也算）。找不到给 0
 */
export function findRule(text, sel, n = 0) {
  const want = normSel(sel)
  if (!want || want.length > 400) return 0
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // 注释换成空格（位置、行号不变）
  // HTML 只看 <style> 里面（脚本、正文里像 CSS 的字不算）
  const regions = []
  if (/<style\b/i.test(src)) {
    const re = /<style\b[^>]*>/gi
    let m
    while ((m = re.exec(src))) {
      const from = m.index + m[0].length
      const end = src.slice(from).search(/<\/style\s*>/i)
      regions.push([from, end < 0 ? src.length : from + end])
      re.lastIndex = end < 0 ? src.length : from + end
    }
  } else regions.push([0, src.length])
  let k = 0
  for (const [from, to] of regions) {
    let start = from
    for (let i = from; i < to; i++) {
      const ch = src[i]
      if (ch === '"' || ch === "'") { // 字符串里的 { } ; 不算
        let j = i + 1
        while (j < to && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
        i = j
      } else if (ch === '{') {
        const pre = src.slice(start, i)
        if (normSel(pre) === want && k++ === n) {
          const at = start + (pre.length - pre.trimStart().length)
          return src.slice(0, at).split('\n').length
        }
        start = i + 1
      } else if (ch === '}' || ch === ';') start = i + 1
    }
  }
  return 0
}

/**
 * 把 css 写进页面上那个元素（loc，见 findTag）在源码里的 style 属性。
 * @returns {{ ok: true, html } | { ok: false, reason: 'empty' | 'not-found' }}
 */
export function setStyle(html, loc, css) {
  const clean = cleanCss(css)
  if (!clean) return { ok: false, reason: 'empty' }
  const x = findTag(html, loc)
  if (!x) return { ok: false, reason: 'not-found' }
  const a = attrsOf(x.attrs).style
  const next = mergeStyle(a ? unAttr(a.v) : '', clean).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  let attrs
  if (a) attrs = x.attrs.slice(0, a.at) + (next ? `style="${next}"` : '') + x.attrs.slice(a.at + a.len)
  // 自闭合的 / 前面得是空白或引号（src=a.png/ 里的 / 是属性值的一部分）
  else if (next) attrs = /(^|["'\s])\/\s*$/.test(x.attrs) ? x.attrs.replace(/\s*\/\s*$/, ` style="${next}" /`) : x.attrs + ` style="${next}"`
  else attrs = x.attrs
  return { ok: true, html: html.slice(0, x.start) + `<${x.name}${attrs}>` + html.slice(x.end) }
}

export function serverUrlIn(text, skipPorts = new Set()) {
  let found = null
  URL_IN_TEXT.lastIndex = 0
  let m
  while ((m = URL_IN_TEXT.exec(String(text || '')))) {
    const port = Number(m[1])
    if (skipPorts.has(port)) continue
    if (!found) found = { port, path: m[2] || '/' }
  }
  return found
}

/**
 * 每个会话一份预览状态。
 *
 * state: { target, origin, url, label, source, rev, openRev, turn, writing, changedAt, error, kind, size, view, routes, screens }
 *   source   'tool' 模型调工具 | 'user' 用户在地址栏输入 | 'auto' 自动发现
 *   kind     设计类型（'' = 看页面自己的 <meta name="dsh-design">，再没有就当网页）
 *   size     画幅尺寸 '1080x1920'（'' = 按类型默认）
 *   view     'canvas' 几屏并排 | 'single' 只看一屏 | '' 自动（有好几屏就并排）
 *   screens  并排的几屏：本地文件是同目录的 HTML 文件名，开发服务器是路由
 *   openRev  每次要右侧栏自动弹出来就 +1（客户端看到变大就打开标签页）
 *   rev      页面内容变了就 +1（文件改动）
 *   turn     这个会话正在跑一轮（预览上显示「正在生成」）
 *   turns    这次运行里干完了几轮（右侧栏看它变了就自动体检）
 *   asking   模型用提问卡问了用户、在等回答（右侧栏不转圈，提示去对话里回答）
 *
 * @param opts.open (target) => Promise<{ origin }>  开预览服务器
 * @param opts.skipPorts () => Set<number>            不当开发服务器的端口（DSH 自己、预览服务器）
 * @param opts.store { load(): object, save(object) }  记住每个会话预览的是什么（DSH 重启后接着显示）
 */
// 插件塞进输入框的块：头一行认出说的是什么，后面几行是给模型看的细节（不算用户的话）
const BLOCK_HEAD = [
  [/^〔选中元素〕(.*?)(「.*」)?$/, (m) => m[2] || m[1]],
  [/^〔选中区域〕/, () => '选中区域'],
  [/^〔设计变量〕([^:：\s]+)/, (m) => m[1]],
  [/^(〔参考图〕|\[Reference image\])/, () => '参考图'],
]
const BLOCK_DETAIL = /^((文件|页面|位置|组件|HTML|样式|包含|主要颜色)：|(Main colors|File|Page):|- |照这张参考图|(Restyle|Design) .*this reference)/
const TEXT_ASK = /^(?:把页面上的「(.+?)」改成「(.*?)」|Change the text "(.+?)" to "(.*?)")/

/** 用户这一句说了什么（给版本起名）：只认用户自己打的字；点选 / 变量 / 参考图的块换成一个短名字，取前 40 个字 */
export function askOf(data) {
  if (!data || !data.source || data.source.kind !== 'user') return ''
  const c = data.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''
  const subjects = []
  let words = ''
  // 块有时紧贴在用户那句话后面（同一行），先断开
  const lines = String(text).replace(/(?=〔(选中元素|选中区域|设计变量|参考图)〕|\[Reference image\])/g, '\n').split('\n')
  for (const l of lines.map((x) => x.trim())) {
    if (!l || l.startsWith('<') || BLOCK_DETAIL.test(l)) continue
    const head = BLOCK_HEAD.find(([re]) => re.test(l))
    if (head) {
      const sub = head[1](l.match(head[0])).trim()
      if (sub && !subjects.includes(sub)) subjects.push(sub)
      continue
    }
    const ta = l.match(TEXT_ASK)
    if (ta) { words = words || `改字「${ta[1] || ta[3]}」→「${ta[2] ?? ta[4] ?? ''}」`; continue }
    words = words || l
  }
  const sub = subjects.slice(0, 2).join('、') + (subjects.length > 2 ? ' 等' : '')
  const line = sub && words ? `${sub} · ${words}` : sub ? (sub === '参考图' ? '照参考图改' : `改${sub}`) : words
  return line.length > 40 ? line.slice(0, 40) + '…' : line
}

/**
 * @param opts.alive (origin) → 这个预览服务器还开着吗（开的太多时旧的会被关掉；发现没了就重开）
 */
export function createTracker({ open, drafts = null, skipPorts = () => new Set(), now = Date.now, log = () => {}, store = null, history = null, alive = () => true, autoOpen = () => true, beforeRestore = () => {}, trust = () => '', watchTag = () => '' }) {
  const states = new Map() // sessionId → state
  const cwds = new Map() // sessionId → 最近一次工具的工作目录
  let saved = {}
  try { saved = (store && store.load()) || {} } catch (e) { log(e) }
  const restoring = new Set()

  function persist(id, st) {
    if (!store) return
    if (st.target) saved[id] = { target: st.target, source: st.source, design: st.design, kind: st.kind, size: st.size, view: st.view, routes: st.routes, order: st.target.kind === 'file' ? st.screens : undefined, cwd: cwds.get(id) || (saved[id] && saved[id].cwd) || undefined, at: now() }
    else delete saved[id]
    // 只留最近 200 个会话
    const ids = Object.keys(saved)
    if (ids.length > 200) {
      ids.sort((a, b) => saved[a].at - saved[b].at).slice(0, ids.length - 200).forEach((k) => delete saved[k])
    }
    try { store.save(saved) } catch (e) { log(e) }
  }

  /** 内存里没有、盘上记着的：重新开预览服务器（文件还在才开），不弹右侧栏 */
  function restore(id) {
    const rec = saved[id]
    if (!rec || !rec.target || restoring.has(id)) return
    const t = rec.target
    if (t.kind === 'file' && !fs.existsSync(t.file)) return
    // 以前不分是不是在做设计、自动打开的（比如别的项目的端口）：不是设计稿就不再接着显示
    if (rec.source === 'auto' && !rec.design && !(t.kind === 'file' && isDesignHtml(t.file))) return
    stateOf(id).design = stateOf(id).design || !!rec.design
    restoring.add(id)
    setTarget(id, t, { source: rec.source || 'auto', popup: false, kind: rec.kind || '', size: rec.size || '', view: rec.view || '', routes: rec.routes || null, order: rec.order })
      .catch((e) => log(e))
      .finally(() => restoring.delete(id))
  }

  /** 预览服务器被关了（开的太多，没人连着的旧服务器先关）：照原样重开一个，先试原来的端口（地址不变，右侧栏不用重载） */
  function revive(id, st) {
    if (restoring.has(id)) return
    const t = st.target
    let port = 0
    try { port = Number(new URL(st.origin).port) || 0 } catch { port = 0 }
    restoring.add(id)
    Promise.resolve()
      .then(() => open(t, { port }))
      .then(({ origin }) => {
        if (st.target !== t) return // 这期间换了别的页面
        st.origin = origin
        st.url = urlFor(t, origin)
      })
      .catch((e) => log(e))
      .finally(() => restoring.delete(id))
  }

  function stateOf(id) {
    let st = states.get(id)
    if (!st) {
      st = { target: null, origin: '', url: '', label: '', source: '', rev: 0, openRev: 0, turn: false, writing: '', changedAt: 0, error: '',
        kind: '', size: '', view: '', routes: null, screens: [], ask: '', vrev: 0, design: false, hint: '', calls: new Map(), jobs: new Map() }
      states.set(id, st)
    }
    return st
  }

  function cwdOf(id) {
    // DSH 重启后还没跑过工具时内存里没有，用缓存里记的（右侧栏「转成代码」要靠它找项目）
    return cwds.get(id) || (saved[id] && saved[id].cwd) || os.homedir()
  }

  /**
   * 新的一屏排到最后；同一屏的几个版本挨在一起、按字母排，方便挑：
   * 「再出两版」的 login-b.html / login-c.html 紧跟在 login.html 后面；开局的三个方向 home-a / home-b / home-c 哪个先写完都排成 a、b、c
   */
  function placeScreen(list, k) {
    const VAR = /^(.+)-([a-z])\.html?$/
    const part = (x) => {
      const v = VAR.exec(x.toLowerCase())
      return v ? { stem: v[1], letter: v[2] } : { stem: x.toLowerCase().replace(/\.html?$/, ''), letter: '' }
    }
    const me = part(k)
    const group = me.letter ? list.map((x, i) => ({ i, ...part(x) })).filter((x) => x.stem === me.stem) : []
    if (group.length) {
      const after = group.find((x) => x.letter > me.letter)
      list.splice(after ? after.i : group[group.length - 1].i + 1, 0, k)
      return
    }
    list.push(k)
  }


  function refreshScreens(st) {
    const t = st.target
    st.hidden = 0
    if (!t) { st.screens = []; return }
    if (t.kind === 'file') {
      const all = allScreens(t.root)
      const me = path.basename(t.file)
      const found = listScreens(t.root, me)
      // 已经排好的几屏位置不动：编辑器改文件常是写临时文件再换名，创建时间会变，按它重排画布会乱跳
      const list = st.screens.filter((k) => found.includes(k))
      for (const k of found) if (!list.includes(k)) placeScreen(list, k)
      st.screens = list
      st.hidden = Math.max(0, all.length + (all.includes(me) ? 0 : 1) - list.length)
    } else {
      const list = st.routes ? [...st.routes] : []
      if (!list.includes(t.path)) list.unshift(t.path)
      const kept = list.slice(0, MAX_SCREENS)
      if (!kept.includes(t.path)) kept[MAX_SCREENS - 1] = t.path // 正看的这个路由始终在
      st.screens = kept
      st.hidden = list.length - kept.length
    }
  }

  /** 和现在预览的是不是同一个目录 / 同一个开发服务器（是的话类型、视图这些设置留着） */
  function sameRoot(a, b) {
    if (!a || !b || a.kind !== b.kind) return false
    return a.kind === 'file' ? a.root === b.root : a.port === b.port
  }

  /** 设预览目标并开服务器；popup 为真时让右侧栏弹出来。kind / size / view / routes 不传就沿用（换了目录就清掉） */
  async function setTarget(id, target, { source, popup = true, kind, size, view, routes, order } = {}) {
    const st = stateOf(id)
    const { origin } = await open(target)
    const changed = !sameTarget(st.target, target)
    if (!sameRoot(st.target, target)) {
      st.kind = ''
      st.size = ''
      st.view = ''
      st.routes = null
      st.screens = []
    }
    if (Array.isArray(order)) st.screens = order.filter((k) => typeof k === 'string')
    if (kind !== undefined) st.kind = parseKind(kind)
    if (size !== undefined) st.size = parseSize(size)
    if (view !== undefined) st.view = view === 'canvas' || view === 'single' ? view : ''
    if (routes !== undefined) st.routes = normRoutes(routes)
    // 换到别的目录了：正在写的草稿是原来那套的，不再报（不然新设计里同名的那屏会被它挡住）
    if (st.draft && !(target.kind === 'file' && st.draft.root === target.root)) st.draft = null
    st.target = target
    st.origin = origin
    st.url = urlFor(target, origin)
    st.label = labelOf(target)
    st.source = source
    if (source === 'tool' || source === 'user') st.design = true // 模型调了预览工具 / 用户自己打开：这个会话就是在做设计
    st.hint = ''
    st.error = ''
    if (changed) st.rev++
    if (popup) st.openRev++
    refreshScreens(st)
    persist(id, st)
    return st
  }

  /** 右侧栏改设置：类型、尺寸、视图，或者换到另一屏（focus = 那一屏的文件名 / 路由） */
  async function setView(id, { kind, size, view, focus } = {}) {
    const st = stateOf(id)
    if (!st.target) throw new Error('还没有在预览的页面')
    if (kind !== undefined) st.kind = parseKind(kind)
    if (size !== undefined) st.size = parseSize(size)
    if (view !== undefined) st.view = view === 'canvas' || view === 'single' ? view : ''
    if (focus) {
      const t = st.target
      const key = String(focus)
      if (t.kind === 'file') {
        if (!allScreens(t.root).includes(key) && key !== path.basename(t.file)) throw new Error(`没有这一屏：${key}`)
        await setTarget(id, { kind: 'file', file: path.join(t.root, key), root: t.root }, { source: st.source, popup: false })
      } else {
        if (!key.startsWith('/')) throw new Error(`路由要以 / 开头：${key}`)
        await setTarget(id, { kind: 'proxy', port: t.port, path: key }, { source: st.source, popup: false })
      }
    }
    persist(id, st)
    return st
  }

  function clear(id) {
    const st = stateOf(id)
    st.target = null
    st.draft = null
    st.url = ''
    st.label = ''
    st.source = ''
    st.rev++
    persist(id, st)
  }

  /** 预览服务器报告某个目录里有文件改了：用到这个目录的会话都 rev+1（files：改了哪些，远程看的右侧栏按它决定哪几屏重新打包） */
  function changed(root, files) {
    for (const [id, st] of states) {
      if (st.target && st.target.kind === 'file' && st.target.root === root) {
        st.rev++
        st.changedAt = now()
        // 文件太多（预览服务器那边已经截断了）就不列：空的 = 不知道改了啥，右侧栏整屏刷新
        const list = Array.isArray(files) ? files.filter((f) => typeof f === 'string') : []
        st.changedFiles = list.length > 50 ? [] : list
        // 最近几批改动（递增序号）：远程看的右侧栏两次轮询之间可能来了好几批，按序号取并集，别只看最后一批
        st.changeN = (st.changeN || 0) + 1
        st.changes = [...(st.changes || []), { n: st.changeN, files: st.changedFiles }].slice(-CHANGE_LOG)
        const before = st.screens.join('\n')
        refreshScreens(st)
        if (st.screens.join('\n') !== before) persist(id, st)
      }
    }
  }

  function auto(id, target) {
    setTarget(id, target, { source: 'auto' }).catch((e) => log(e))
  }

  const absOf = (sessionId, p) => path.resolve(cwdOf(sessionId), p.replace(/^~(?=\/|$)/, os.homedir()))
  // 状态条说「正在写 x」的文件：在现在这套设计的文件夹里；还没有设计时，写什么都算（第一屏还在路上）
  const ownsFile = (st, abs) => !st.target || (st.target.kind === 'file' && (abs === st.target.file || abs.startsWith(st.target.root + path.sep)))

  /**
   * 模型边说边推的流（DSH 的 agent/assistant-stream）。写文件时参数要流好几分钟才到 tool/call，
   * 这里提前从半截参数里认出工具名和文件名，状态条就不会一直「在想」；顺手数一下写了多少行。
   */
  function stream(sessionId, frame) {
    const st = sessionId && frame ? states.get(sessionId) : null
    if (!st || !st.turn) return
    if (frame.type === 'start' || frame.type === 'end') {
      // 这一次说完了：没写完的页面收尾（在看的 iframe 停在写到的地方）
      if (st.parts) for (const part of st.parts.values()) if (part.draft && drafts) drafts.end(part.draft, part.did)
      st.parts = null
      if (frame.type === 'start') {
        st.tool = ''
        st.writing = ''
        st.lines = 0
        // 写完落了地的留着（右侧栏靠它认出「刚才看着写的就是这屏」，单屏好换过去）；没写完的作废
        if (st.draft && !(st.draft.file && fs.existsSync(st.draft.file))) st.draft = null
      }
      return
    }
    const c = frame.type === 'chunk' ? frame.chunk : null
    if (!c || c.type !== 'tool-call-delta') return
    const parts = st.parts || (st.parts = new Map())
    let part = parts.get(c.index)
    if (!part) {
      part = { name: '', head: '', tail: '', file: '', lines: 0, last: '', abs: '', dec: null, draft: '', did: 0, prov: '' }
      parts.set(c.index, part)
      if (parts.size > 16) {
        // 挤掉最早的一个：先挑没在写页面的；挤掉的草稿收个尾，别让在看的一直挂着
        let k = null
        for (const [i, p] of parts) if (i !== c.index && !(p.draft && p.dec && !p.dec.done)) { k = i; break }
        if (k === null) for (const i of parts.keys()) if (i !== c.index) { k = i; break }
        const old = parts.get(k)
        if (old && old.draft && drafts) drafts.end(old.draft, old.did) // 只收它自己那份：同一个文件后来又开始重写的不动
        parts.delete(k)
      }
    }
    if (c.name) part.name = String(c.name)
    if (!part.name) return
    st.tool = part.name
    if (!WRITE_TOOL.test(part.name)) return
    const delta = typeof c.argumentsDelta === 'string' ? c.argumentsDelta : ''
    if (part.dec) {
      // 页面正文在流：还原出来的一截直接推给在看的预览
      const was = part.dec.done
      const text = part.dec.push(delta)
      if (text && part.draft && drafts) drafts.push(part.draft, text, part.did)
      if (part.dec.done) {
        if (!was && part.draft && drafts) drafts.end(part.draft, part.did)
        // 有的模型把正文排在文件名前面（DeepSeek V4.1 就这样）：正文写完了，接着从后面认文件名
        if (!part.file) {
          part.tail = (part.tail + delta).slice(-16384) // 只留最后一段：文件名在正文后面，前面再大的一块也挤不掉它
          const p = pathIn(part.tail)
          if (p) settle(sessionId, st, part, absOf(sessionId, p))
        }
      }
    } else if (!part.skip && part.head.length < 8192 && part.file !== '-') {
      part.head += delta
      if (!part.file) {
        const p = pathIn(part.head)
        if (p) settle(sessionId, st, part, absOf(sessionId, p))
      }
      // 整页写（write 的 content / create 的 file_text）：开一份草稿，边写边给预览
      const body = part.file !== '-' && drafts ? /"(?:content|file_text)"\s*:\s*"/.exec(part.head) : null
      if (body) startBody(sessionId, st, part, part.head.slice(body.index + body[0].length))
    }
    // 参数是 JSON：内容里的换行是两个字 \n；跨块切开的也算上
    const seen = (part.last + delta).match(/\\n/g)
    part.lines += seen ? seen.length : 0
    part.last = delta.slice(-1)
    if (part.file !== '-') {
      if (part.file) st.writing = part.file
      st.lines = part.lines // 文件名还没到（正文在前）也数行：状态条和占位里的鼠标都靠它动
    }
  }

  const pathIn = (text) => {
    const m = /"(?:file_path|filePath|path)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)
    if (!m) return ''
    try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] }
  }

  /** 认出了这次写的是哪个文件：记下；正文在前、草稿先挂在临时名字上的，现在对上真名字（不是一屏就作废） */
  function settle(sessionId, st, part, abs) {
    part.abs = abs
    part.file = ownsFile(st, abs) ? path.basename(abs) : '-'
    if (part.file !== '-') st.lastDir = path.dirname(abs)
    if (!part.draft || !part.prov) return
    const d = st.draft
    const cur = !!d && d.serve === part.draft && !d.file
    if (part.file !== '-' && HTML_EXT.test(abs) && path.dirname(abs) === part.prov && !/^[._]/.test(part.file)) {
      if (cur) d.file = abs
    } else {
      // 不是一屏（子文件夹里的、探针、样式表）：作废，临时地址也读不到了（右侧栏已经在看后面那份的也作废）
      if (cur) st.draft = null
      if (drafts) drafts.drop(part.draft, part.did)
      part.draft = ''
    }
    part.prov = ''
  }

  let provisional = 0
  /**
   * 正文开始流了：要不要开草稿。名字先到的看名字（这套设计第一层的网页）；正文先到的看开头像不像网页，
   * 先挂在设计文件夹里一个临时名字上（相对地址照样对得上），名字到了再对上。
   * 还没有设计（第一屏）时先给这个文件夹开预览服务器，草稿从那里看。
   */
  function startBody(sessionId, st, part, rest) {
    const known = !!part.file
    const over = /(?:^|[^\\])(?:\\\\)*"/.test(rest) // 正文已经流完了（碰到没转义的引号）：不用再等
    if (!known && rest.length < 64 && !over) return // 正文先到：多攒一点再认是不是网页
    let ok = known ? HTML_EXT.test(part.abs) : /^\s*<(?:!doctype\s+html|html)\b/i.test(rest)
    if (ok && !st.target && !st.design) {
      // 页面开头自己写了设计类型标记（<meta name="dsh-design">）：也是在做设计
      if (/<meta[^>]*dsh-design/i.test(rest)) st.design = true
      else if (rest.length <= 3000 && !over) return // 还在开头：等等标记
      else ok = false // 开头这么长还没有标记：不是在做设计（比如写代码的会话写了个网页），不开
    }
    const root = !ok ? '' : st.target && st.target.kind === 'file' ? st.target.root : known ? path.dirname(part.abs) : st.lastDir || ''
    // 只给「一屏」开：设计文件夹第一层的网页，_ / . 开头的是模型的探针、草稿，不算
    if (ok && known && (path.dirname(part.abs) !== root || /^[._]/.test(part.file))) ok = false
    if (ok && !root) ok = false
    if (known && !ok) {
      part.skip = true
      return
    }
    // 正文先到的不开草稿也要跟着还原：好知道正文在哪儿结束，后面才认得出文件名
    part.dec = createJsonStringDecoder()
    part.tail = ''
    let draft = null
    if (ok) {
      const serve = known ? part.abs : path.join(root, `__ddp_draft_${++provisional}__.html`)
      part.draft = serve
      part.prov = known ? '' : root // 挂在临时名字上的：记着它属于哪个文件夹，名字到了自己核对（不管这时右侧栏在看哪份）
      draft = { file: known ? part.abs : '', serve, root, id: drafts.begin(serve), origin: st.target ? st.origin : '' }
      part.did = draft.id // 草稿编号：之后推、收尾、作废都核对它（同一个文件又开始重写时，旧的不碰新的）
      st.draft = draft
    }
    const text = part.dec.push(rest)
    if (draft && text) drafts.push(draft.serve, text, draft.id)
    if (part.dec.done) {
      if (draft) drafts.end(draft.serve, draft.id)
      if (!known) {
        part.tail = rest // 正文里的引号都转义过（\"），认文件名不会认到正文里去
        const p = pathIn(rest)
        if (p) settle(sessionId, st, part, absOf(sessionId, p))
      }
    }
    // 第一屏的草稿开始流了：右侧栏关着就什么都看不到，弹一次（规矩和模型开了新页面一样，「自动打开预览」关着不弹）
    if (draft && !st.target && autoOpen()) st.openRev++
    if (draft && !draft.origin) {
      open({ kind: 'file', file: draft.serve, root }).then((r) => {
        if (st.draft === draft) draft.origin = r.origin
      }, (e) => log(e))
    }
  }

  /** 会话事件 → 状态；自动发现只在没有目标、或目标也是自动发现的时候动手 */
  function observe(sessionId, event) {
    if (!sessionId || !event) return
    const d = event.data || {}
    const live = typeof event.time !== 'number' || now() - event.time < LIVE_MS
    const st = stateOf(sessionId)
    switch (event.type) {
      case 'user/message': {
        const ask = live ? askOf(d) : ''
        if (ask) st.ask = ask
        if (userLoadedSkill(d)) st.design = true
        break
      }
      case 'turn/start':
        if (live) {
          st.turn = true
          st.turnAt = now() // 右侧栏的状态条从这里开始计时
          st.tool = ''
          keepVersion(st, '')
        }
        break
      case 'turn/end':
        st.turn = false
        st.turnAt = 0
        st.tool = ''
        st.writing = ''
        st.lines = 0
        if (st.parts && drafts) for (const part of st.parts.values()) if (part.draft) drafts.end(part.draft, part.did)
        st.parts = null
        // 最后一屏整页一下子到、马上就说完了：落了地的草稿留着（快照里刚写完的几秒还报，右侧栏放完它）
        if (!(st.draft && st.draft.file && fs.existsSync(st.draft.file))) st.draft = null
        st.asking = false
        if (live) {
          keepVersion(st, st.ask)
          st.turns = (st.turns || 0) + 1 // 右侧栏靠它知道「又干完一轮」（很快的一轮轮询看不到 turn 变 true）
        }
        st.ask = '' // 用过就清：下一轮不是用户发起的（没有新的一句话）就不借这一句当名字
        break
      case 'tool/call': {
        // 加载了设计技能 / 调了预览工具：这个会话在做设计（重放历史时也认，DSH 重启后不丢）
        if (d.name === 'skill' && argsOf(d.arguments).name === DESIGN_SKILL) st.design = true
        if (d.name === 'preview_page') st.design = true
        if (!live) break
        if (d.name === ASK_TOOL) st.asking = true
        st.tool = String(d.name || '') // 状态条按它说「正在体检」「正在跑命令」…
        if (d.callId) {
          st.calls.set(d.callId, { name: d.name, args: argsOf(d.arguments) })
          if (st.calls.size > 64) st.calls.delete(st.calls.keys().next().value)
        }
        const p = writtenPath(d.name, d.arguments)
        if (!p) break
        const abs = absOf(sessionId, p)
        if (ownsFile(st, abs)) {
          st.writing = path.basename(abs)
          st.lastDir = path.dirname(abs) // 下一页要是正文先到，草稿先挂在这个文件夹里
        }
        if (HTML_EXT.test(abs) && (!st.target || (st.source === 'auto' && st.target.kind === 'file'))) {
          st.pendingHtml = abs // 写完（tool/result）再预览，免得打开一个还不存在的文件
        }
        break
      }
      case 'tool/result': {
        if (d.meta && typeof d.meta.cwd === 'string' && d.meta.cwd) {
          cwds.set(sessionId, d.meta.cwd)
          if (st.target && saved[sessionId] && saved[sessionId].cwd !== d.meta.cwd) persist(sessionId, st)
        }
        st.writing = ''
        st.lines = 0
        st.tool = ''
        if (!live) break
        const pending = st.pendingHtml
        st.pendingHtml = ''
        const callId = (d.message && (d.message.toolCallId || (d.message.source && d.message.source.callId))) || d.callId || ''
        const call = callId ? st.calls.get(callId) : null
        if (callId) st.calls.delete(callId)
        if (!call || call.name === ASK_TOOL) st.asking = false
        if (pending && fs.existsSync(pending) && (!st.target || st.source === 'auto') && !(st.target && st.target.file === pending)) {
          // 只有在做设计（加载了设计技能、或页面写了设计类型标记）才自动打开；别的任务写的网页只记下来，不弹
          // 用户关了「自动打开预览」：也只记下来，右侧栏给个按钮
          if (st.design || isDesignHtml(pending)) {
            st.design = true
            if (autoOpen()) auto(sessionId, { kind: 'file', file: pending, root: path.dirname(pending) })
            else st.hint = pending
          } else st.hint = pending
        }
        if (st.target && st.source !== 'auto') break
        if (!st.design || !call) break
        const err = d.message && d.message.isError
        if (err) break
        const texts = textsOf(d.message && d.message.content)
        let command = ''
        if (SHELL_TOOL.test(String(call.name))) {
          command = String(call.args.command || '')
          for (const text of texts) {
            const m = BG_JOB.exec(text)
            if (!m) continue
            st.jobs.set(m[1], command)
            if (st.jobs.size > 32) st.jobs.delete(st.jobs.keys().next().value)
          }
        } else if (JOB_READ_TOOL.test(String(call.name))) {
          // 不认识的 job（比如插件重启前起的）：命令当空的，只认像启动信息的那一行
          command = st.jobs.get(String(call.args.job_id || call.args.jobId || call.args.id || '')) || ''
        } else break
        for (const text of texts) {
          const found = devServerIn(command, text, skipPorts())
          if (found) {
            const t = { kind: 'proxy', port: found.port, path: '/' }
            if (!sameTarget(st.target, t) && autoOpen()) auto(sessionId, t)
            break
          }
        }
        break
      }
    }
  }

  /** 本地文件预览：存一版（和上一版一样就不存）；存了就让右侧栏刷新版本列表 */
  function keepVersion(st, label) {
    if (!history || !st.target || st.target.kind !== 'file') return null
    const v = history.snapshot(st.target.root, label)
    if (v) st.vrev++
    return v
  }

  /** 预览里直接改字：在这一屏（key = 文件名）的 HTML 里把第 nth 处 before 换成 after，改前改后各存一版 */
  function editText(id, { key, before, after, nth = 0 } = {}) {
    const short = String(after).replace(/\s+/g, ' ').trim()
    return rewrite(id, key, (html) => replaceText(html, before, after, Math.max(0, Math.floor(Number(nth) || 0))),
      `改字「${short.length > 16 ? short.slice(0, 16) + '…' : short}」`)
  }

  /** 预览里调样式：把 css 写进这一屏（key）里那个元素（loc，见 findTag）的 style 属性，改前改后各存一版 */
  function editStyle(id, { key, loc, css, name } = {}) {
    const short = String(name || (loc && loc.tag) || '').trim()
    return rewrite(id, key, (html) => setStyle(html, loc || {}, css), `调样式「${short.length > 24 ? short.slice(0, 24) + '…' : short}」`)
  }

  /**
   * 改这一屏（key = 文件名）的 HTML：fn(原文) → { ok, html }。
   * 开发服务器的页面源码在项目里、不一定是这份 HTML，不在这里改（右侧栏改成让模型去改）。
   * 模型正在干活时不改：它可能正整份重写这个文件，改了也会被盖掉。
   */
  function rewrite(id, key, fn, label) {
    const st = states.get(id)
    const t = st && st.target
    if (!t || t.kind !== 'file') return { ok: false, reason: 'not-file' }
    if (busyRoot(t.root)) return { ok: false, reason: 'busy' }
    const name = String(key || path.basename(t.file))
    const file = path.join(t.root, name)
    if (path.dirname(file) !== t.root || !HTML_EXT.test(name) || !fs.existsSync(file)) return { ok: false, reason: 'no-screen' }
    // 软链接指到目录外的不读也不写
    let real = ''
    try { real = fs.realpathSync(file) } catch { real = '' }
    if (!real.startsWith(fs.realpathSync(t.root) + path.sep)) return { ok: false, reason: 'no-screen' }
    const r = fn(fs.readFileSync(file, 'utf8'))
    if (!r.ok) return r
    keepVersion(st, '')
    fs.writeFileSync(file, r.html)
    keepVersion(st, label)
    return { ok: true, file: name }
  }

  /** 这个目录有没有会话的模型正在干活（它可能正整份重写文件，这时改了会被盖掉）；经软链接打开的同一个目录也算 */
  function busyRoot(root) {
    const realOf = (p) => { try { return fs.realpathSync(p) } catch { return p } }
    const mine = realOf(root)
    for (const o of states.values()) if (o.turn && o.target && o.target.kind === 'file' && (o.target.root === root || realOf(o.target.root) === mine)) return true
    return false
  }

  /**
   * 改设计目录里的几个文件（调节滑块写回：tokens.css、每屏 <html> 上的属性、tweaks.json）：fn(目录) → { ok, files, … }；
   * 改前改后各存一版。开发服务器的页面、模型正在干活时不改；给了 expectRoot 而现在看的不是它也不改
   */
  function editDir(id, fn, label, expectRoot) {
    const st = states.get(id)
    const t = st && st.target
    if (!t || t.kind !== 'file') return { ok: false, reason: 'not-file' }
    // 右侧栏发请求时看的是哪套设计：这期间换了设计就别写，免得写进另一套
    if (expectRoot !== undefined && t.root !== expectRoot) return { ok: false, reason: 'moved' }
    if (busyRoot(t.root)) return { ok: false, reason: 'busy' }
    keepVersion(st, '')
    const r = fn(t.root)
    if (r && r.ok && r.files && r.files.length) keepVersion(st, typeof label === 'function' ? label(r) : label)
    return r
  }

  /** 版本列表（新的在前）；开发服务器没有版本（项目自己有 git） */
  function versions(id) {
    const st = states.get(id)
    if (!history || !st || !st.target || st.target.kind !== 'file') return []
    return history.list(st.target.root)
  }

  /** 回到某一版：现在的先存一版，再写回那一版的文件（目录监听会让预览自己刷新） */
  function restoreVersion(id, n) {
    const st = states.get(id)
    if (!history || !st || !st.target || st.target.kind !== 'file') throw new Error('这个预览没有版本记录')
    const root = st.target.root
    const r = history.restore(root, n, { before: (html) => beforeRestore(root, html) })
    st.vrev++
    return r
  }

  /** 正在写的那页：预览服务器上的草稿地址 + 它在设计里的名字（和 screens 的 key 一样） */
  function draftOf(st) {
    const d = st ? st.draft : null
    if (!d || !d.origin) return null
    const relOf = (f) => path.relative(d.root, f).split(path.sep).join('/')
    const sv = relOf(d.serve || d.file)
    if (!sv || sv.startsWith('..')) return null
    // 就挂在这一屏自己的地址上，带个记号（serve.js 认它）：页面里的相对地址照常对得上。
    // 正文先到的先挂在临时名字上，key 空着（还不知道是哪屏），名字到了再填。
    // live：还在写、或刚写完（右侧栏这时才看到也值得放一遍：整页一下子到的，预览服务器会一截截放）
    const rec = drafts && drafts.get(d.serve)
    const live = !!rec && rec.id === d.id && (!rec.done || Date.now() - (rec.endAt || 0) < DRAFT_LIVE_MS)
    if (!st.turn && !live) return null // 这一轮说完了：只报刚写完的那份
    // 页面开头写的设计类型（<meta name="dsh-design" content="miniprogram 390x844">）：真文件还没摆出来时，右侧栏靠它套对外框
    const mt = rec && /<meta\b[^>]*\bname\s*=\s*["']?dsh-design\b[^>]*>/i.exec(rec.text.slice(0, 6000))
    const mc = mt && /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(mt[0])
    // lump：写完了、而且是整段一下子到的（右侧栏放完这份再换真文件；一路流着写的落地就换）
    return { key: d.file ? relOf(d.file) : '', url: `${d.origin}/${sv.split('/').map(encodeURIComponent).join('/')}?__ddp_draft=${d.id}`, live, lump: !!(live && rec.done && rec.lump), meta: mc ? (mc[1] ?? mc[2] ?? '').slice(0, 80) : '' }
  }

  function snapshot(id) {
    const st = states.get(id)
    if (!(st && st.target)) restore(id)
    else if (st.origin && !alive(st.origin)) revive(id, st)
    const turnFor = st && st.turn && st.turnAt ? Math.max(0, now() - st.turnAt) : 0
    if (!st || !st.target) return { target: null, rev: st ? st.rev : 0, openRev: st ? st.openRev : 0, turn: st ? st.turn : false, turnFor, tool: (st && st.turn && st.tool) || '', turns: st ? st.turns || 0 : 0, asking: !!(st && st.asking), writing: (st && st.turn && st.writing) || '', lines: (st && st.turn && st.lines) || 0, draft: draftOf(st), hint: st && st.hint && fs.existsSync(st.hint) ? st.hint : '', loading: restoring.has(id) }
    const { target, url, label, source, rev, openRev, turn, writing, changedAt, kind, size, view, origin } = st
    const file = target.kind === 'file'
    return {
      target: file ? { kind: 'file', file: target.file, root: target.root } : { kind: 'proxy', port: target.port, path: target.path },
      url,
      label,
      source,
      rev,
      openRev,
      turn,
      turnFor,
      tool: (turn && st.tool) || '',
      turns: st.turns || 0,
      asking: !!st.asking,
      writing,
      lines: (turn && st.lines) || 0,
      draft: draftOf(st),
      changedAt,
      changedFiles: st.changedFiles || [],
      changes: st.changes || [],
      kind,
      size,
      view,
      origin,
      vrev: st.vrev,
      trust: file ? trust() : '', // 「哪些算别人做的」的指纹：所有会话共用，远程看的右侧栏按它作废留着的打包结果
      watch: file ? watchTag(target.root) : '', // 预览服务器有没有在监听这个目录（开始 / 停止监听就变）：画布缩略图按它重新要（停了就得自己定时再要）
      focus: file ? path.basename(target.file) : target.path,
      hidden: st.hidden || 0, // 超过上限收起来的屏数
      maxScreens: MAX_SCREENS,
      screens: st.screens.map((key) => ({
        key,
        url: file ? `${origin}/${encodeURIComponent(key)}` : origin + key,
        label: file ? key.replace(HTML_EXT, '') : key,
      })),
    }
  }

  return { observe, stream, setTarget, setView, clear, changed, snapshot, cwdOf, stateOf, versions, restoreVersion, editText, editStyle, editDir, keepVersion: (id, label) => keepVersion(stateOf(id), label) }
}
