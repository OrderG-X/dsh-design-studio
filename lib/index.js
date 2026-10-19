/**
 * dsh-design-studio（服务端）
 *
 *   preview_page 工具   模型做界面时调一次，右侧栏「设计工作台」打开这个页面（可以带类型：网页 / App / 海报 …）
 *   自动发现           模型写了 HTML、或命令输出里出现 localhost:端口（开发服务器起来了），自动预览
 *   ui-design 技能     设计流程、设计原则、中文排版、各类型要点、避免 AI 味、自查清单（skills/ui-design/，DSH 有技能服务时才挂上）
 *   接口（DSH 自己的地址，要登录态）：
 *     GET  /dsh-design-studio/api/state?session=  右侧栏轮询：预览什么、有哪几屏、要不要弹出来、模型在不在干活
 *     POST /dsh-design-studio/api/open             地址栏输入新地址 { session, target }
 *     POST /dsh-design-studio/api/view             改类型 / 尺寸 / 视图，或换到另一屏 { session, kind?, size?, view?, focus? }
 *     POST /dsh-design-studio/api/close            清掉预览 { session }
 *     GET  /dsh-design-studio/api/history?session= 设计版本（每轮对话前后各存一版），新的在前
 *     POST /dsh-design-studio/api/restore          回到某一版 { session, n }（现在的先存一版）
 *     POST /dsh-design-studio/api/export           存导出的图片 { session, name, png: base64 } → 设计目录的 exports/
 *     POST /dsh-design-studio/api/ref              存参考图 { session, name, data: base64 } → 设计目录的 refs/（没有设计目录就存插件缓存）
 *     POST /dsh-design-studio/api/reveal           在访达 / 资源管理器里显示刚导出的图片 { path }
 *     POST /dsh-design-studio/api/edit             预览里直接改字 { session, key, before, after, nth } → 写回那一屏的 HTML（改前改后各存一版）
 *     POST /dsh-design-studio/api/phone            手机上看：{ session, on: true, path } 开局域网入口（给链接和二维码）、
 *                                                   { on: false } 关掉、{ follow: path } 电脑上换了一屏手机跟着跳
 *
 * 页面本身由 serve.js 开的独立端口提供（见那边的说明）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { createHub } from './serve.js'
import { createTracker, parseTarget, KINDS } from './core.js'
import { createHistory } from './history.js'
import { createPhone } from './phone.js'
import { qrMatrix } from './qr.js'

export const name = 'dsh-design-studio'
export const inject = ['tools', 'webServer']

const API = '/dsh-design-studio/api/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const MAX_BODY = 64 * 1024
const MAX_EXPORT = 48 * 1024 * 1024 // 导出图片的请求体（base64）
const HISTORY_DIR = path.join(process.env.HOME || '.', '.dsh', 'cache', 'dsh-design-studio', 'history')
// 每个会话预览的是什么，存这里（DSH 重启后接着显示）
// 参考图：没有本地设计目录（开发服务器 / 还没开始）时存这里
const REFS_DIR = path.join(process.env.HOME || '.', '.dsh', 'cache', 'dsh-design-studio', 'refs')
const STORE_FILE = path.join(process.env.HOME || '.', '.dsh', 'cache', 'dsh-design-studio.json')
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-design')
const SKILL_RANK = 600 // 和 DSH 自带的技能同一档；用户 / 项目里同名的技能优先

/** 设计技能：模型做界面设计时加载（DSH 的 skill 工具），也能让用户手动调 */
export const designSkill = {
  name: 'ui-design',
  description:
    '做网页、App 界面、平板界面、海报 / 社媒图、幻灯片、邮件、组件这类界面设计之前先加载：' +
    '配合右侧「设计工作台」画布的做法（一屏一个文件、设计变量、类型标记）、现代设计原则、中文排版、各类型画幅要点、避免 AI 味、设计自查清单。',
  whenToUse: '用户要做或改任何看得见的界面 / 视觉设计时',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-design-studio',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: SKILL_DIR },
  rank: SKILL_RANK,
  locator: path.join(SKILL_DIR, 'SKILL.md'),
}

export const skillProvider = {
  name: 'dsh-design-studio',
  list: () => Promise.resolve([designSkill]),
  async get() {
    const { name, description, whenToUse, invocation, provider, source, resourceBase } = designSkill
    return { name, description, whenToUse, invocation, provider, source, resourceBase, content: await fs.promises.readFile(designSkill.locator, 'utf8') }
  },
}

const fileStore = {
  load: () => JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')),
  save: (data) => {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(data), { mode: 0o600 })
    fs.renameSync(STORE_FILE + '.tmp', STORE_FILE)
  },
}

function ownHost(ctx) {
  try { return new URL(ctx.webServer.getOrigin()).host } catch { return '' }
}

function fenceOk(req, own) {
  const host = String(req.headers.host || '')
  if (!LOOPBACK_HOST.test(host) && !(own && host === own)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

function connectionOf(ctx) {
  try {
    const c = ctx.get('connection')
    return c && typeof c.requestRejection === 'function' ? c : null
  } catch {
    return null
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

function specToJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, node] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = node
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export function apply(ctx) {
  const log = (e) => {
    try { ctx.logger.warn(`dsh-design-studio: ${e && e.message ? e.message : e}`) } catch { /* 没 logger 就算了 */ }
  }
  const previewPorts = new Set()
  let tracker = null
  const history = createHistory({ base: HISTORY_DIR, log })
  const hub = createHub({
    log,
    history,
    onChange: (key) => {
      if (tracker && key.startsWith('file:')) tracker.changed(key.slice(5))
    },
  })
  const open = async (target) => {
    const r = await hub.open(target.kind === 'file' ? { kind: 'file', root: target.root } : target)
    previewPorts.add(Number(new URL(r.origin).port))
    return r
  }
  tracker = createTracker({
    open,
    log,
    history,
    store: fileStore,
    skipPorts: () => {
      const s = new Set(previewPorts)
      const own = ownHost(ctx).split(':')[1]
      if (own) s.add(Number(own))
      return s
    },
  })
  ctx.effect(() => () => hub.closeAll(), 'dsh-design-studio: preview servers')
  const phone = createPhone({ upstream: (session) => tracker.snapshot(session).origin || '', log })
  ctx.effect(() => () => phone.stopAll(), 'dsh-design-studio: phone links')

  // 设计技能：等 DSH 的技能服务就绪再挂（老版本没有就算了），插件卸载时一起摘掉
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['skills'], (sub) => { sub.skills.registerProvider(() => skillProvider) })
    } catch (e) {
      log(e)
    }
  }

  // ── 接口 ──────────────────────────────────────────────────────────────────

  function admit(req, res) {
    const conn = connectionOf(ctx)
    if (conn) {
      const rejected = conn.requestRejection(req)
      if (rejected) {
        json(res, rejected, { error: rejected === 401 ? 'unauthorized' : 'forbidden' })
        return false
      }
      return true
    }
    if (!LOOPBACK.has(req.socket.remoteAddress) || !fenceOk(req, ownHost(ctx))) {
      json(res, 403, { error: 'forbidden' })
      return false
    }
    return true
  }

  function state(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    const ph = phone.status(session)
    json(res, 200, { ...tracker.snapshot(session), phone: { on: ph.on, seen: ph.seen || 0 } })
  }

  async function openRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    try {
      const target = parseTarget(body.target, tracker.cwdOf(session))
      await tracker.setTarget(session, target, { source: 'user', popup: false })
      json(res, 200, tracker.snapshot(session))
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  async function viewRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    const patch = {}
    for (const k of ['kind', 'size', 'view', 'focus']) if (typeof body[k] === 'string') patch[k] = body[k]
    try {
      await tracker.setView(session, patch)
      json(res, 200, tracker.snapshot(session))
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  async function closeRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    tracker.clear(String(body.session || ''))
    phone.stop(String(body.session || ''))
    json(res, 200, tracker.snapshot(String(body.session || '')))
  }

  function historyRoute(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    json(res, 200, { versions: tracker.versions(session) })
  }

  async function restoreRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      const r = tracker.restoreVersion(String(body.session || ''), Number(body.n))
      json(res, 200, { ...r, versions: tracker.versions(String(body.session || '')) })
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  /** 预览里直接改字：写回这一屏的 HTML；找不到那段字就告诉右侧栏（它会改成让模型去改） */
  async function editRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      json(res, 200, tracker.editText(String(body.session || ''), { key: body.key, before: body.before, after: body.after, nth: body.nth }))
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  const exported = new Set() // 这次运行里导出过的图片（只许在访达里显示这些）

  /** 导出的图片存哪：本地文件预览存设计目录的 exports/，开发服务器存「下载」 */
  function exportDir(session) {
    const st = tracker.stateOf(session)
    if (st.target && st.target.kind === 'file') return path.join(st.target.root, 'exports')
    return path.join(os.homedir(), 'Downloads')
  }

  async function exportRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_EXPORT) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const buf = Buffer.from(String(body.png || ''), 'base64')
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return json(res, 400, { error: '不是 PNG' })
    const base = String(body.name || 'design').replace(/\.png$/i, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design'
    const dir = exportDir(session)
    try {
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, base + '.png')
      for (let i = 2; fs.existsSync(file) && i < 1000; i++) file = path.join(dir, `${base}-${i}.png`)
      fs.writeFileSync(file, buf)
      exported.add(file)
      json(res, 200, { path: file })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /** 图片格式看文件头，不信文件名 */
  function imageExt(buf) {
    if (buf.length < 12) return ''
    if (buf.readUInt32BE(0) === 0x89504e47) return 'png'
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
    if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
    return ''
  }

  /** 存参考图：本地文件预览存设计目录的 refs/，不然存插件缓存；同名不覆盖 */
  async function refRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_EXPORT) } catch (e) { return json(res, 400, { error: e.message }) }
    const buf = Buffer.from(String(body.data || ''), 'base64')
    const ext = imageExt(buf)
    if (!ext) return json(res, 400, { error: '不是图片' })
    const st = tracker.stateOf(String(body.session || ''))
    const dir = st.target && st.target.kind === 'file' ? path.join(st.target.root, 'refs') : REFS_DIR
    const base = String(body.name || 'ref').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ref'
    try {
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, `${base}.${ext}`)
      for (let i = 2; fs.existsSync(file) && i < 1000; i++) file = path.join(dir, `${base}-${i}.${ext}`)
      fs.writeFileSync(file, buf)
      json(res, 200, { path: file })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  async function revealRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const file = String(body.path || '')
    if (!exported.has(file) || !fs.existsSync(file)) return json(res, 404, { error: 'not exported here' })
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', file]]
      : process.platform === 'win32' ? ['explorer', [`/select,${file}`]]
        : ['xdg-open', [path.dirname(file)]]
    execFile(cmd, args, (e) => { if (e && process.platform !== 'win32') log(e) }) // explorer 正常也返回 1
    json(res, 200, { ok: true })
  }

  /** 手机上看：开 / 关局域网入口，或让开着的手机跟着跳到另一屏 */
  async function phoneRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    if (typeof body.follow === 'string') return json(res, 200, { ok: phone.follow(session, body.follow) })
    if (body.on === false) {
      phone.stop(session)
      return json(res, 200, phone.status(session))
    }
    if (!tracker.snapshot(session).origin) return json(res, 400, { error: '还没有在预览的页面' })
    const st = await phone.start(session, typeof body.path === 'string' && body.path.startsWith('/') ? body.path : '/')
    // 二维码一行一串 0 / 1，右侧栏画成 SVG
    json(res, 200, st.on ? { ...st, qr: qrMatrix(st.url).map((row) => row.map((c) => (c ? 1 : 0)).join('')) } : st)
  }

  const routes = { state, open: openRoute, view: viewRoute, close: closeRoute, history: historyRoute, restore: restoreRoute, edit: editRoute, ref: refRoute, export: exportRoute, reveal: revealRoute, phone: phoneRoute }
  for (const [key, handler] of Object.entries(routes)) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: API + key,
      handler: (req, res) => {
        Promise.resolve(handler(req, res)).catch((e) => {
          log(e)
          if (!res.headersSent) json(res, 500, { error: 'internal' })
        })
      },
    }), `dsh-design-studio: ${key} route`)
  }

  // ── 工具 ──────────────────────────────────────────────────────────────────

  ctx.tools.register({
    name: 'preview_page',
    description:
      '在右侧栏「设计工作台」里实时打开一个页面，用户能边看边点选要改的地方。' +
      '做网页、App 界面、海报、幻灯片、邮件这类界面设计时用：写好第一个 HTML 文件、或启动开发服务器后调一次就行，之后改文件会自动刷新，不用再调。' +
      '本地 HTML 写文件路径；开发服务器写地址或端口（如 http://localhost:5173）。只能预览本机页面。' +
      'kind 说明是哪类设计，右侧按它的画幅显示（App 套手机外框、幻灯片 16:9 …）。' +
      '动手设计前先加载 ui-design 技能（设计流程、规范和自查清单）。' +
      '要做好几屏（App 的几个界面、网站的几个页面）时，每屏一个 HTML 文件放在同一个目录，右侧画布会按生成顺序并排显示，一屏一屏写就行。' +
      '用户在预览里点选的内容会以「〔选中元素〕」或「〔选中区域〕」开头出现在消息里，带 CSS 路径、HTML、关键样式，' +
      '拿得到时还有组件和源码位置：照它找到源码里对应的地方再改。',
    parameters: specToJsonSchema({
      target: { type: 'string', required: true, description: '本地 HTML 文件的绝对路径，或开发服务器地址 / 端口，例如 /Users/me/site/index.html、http://localhost:5173、5173' },
      kind: {
        type: 'string',
        enum: KINDS,
        description: '设计类型：web 网页（默认）、app 手机 App 界面（390×844）、tablet 平板、poster 海报 / 社媒图（1080×1350）、slides 幻灯片（16:9）、email 邮件',
      },
      size: { type: 'string', description: '画幅尺寸，可选，如 1080x1920；不填按类型的默认尺寸' },
      screens: {
        type: 'array',
        items: { type: 'string' },
        description: '开发服务器上要并排显示的几个路由，可选，如 ["/", "/login", "/settings"]。本地 HTML 不用填：同目录的 HTML 文件自动并排',
      },
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' }, url: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const session = exec && exec.agent && exec.agent.session
      const id = session && session.id
      if (!id) throw new Error('拿不到当前会话，没法打开预览')
      const target = parseTarget(args.target, tracker.cwdOf(id))
      const opts = { source: 'tool' }
      if (args.kind !== undefined) opts.kind = args.kind
      if (args.size !== undefined) opts.size = args.size
      if (args.screens !== undefined) opts.routes = args.screens
      const st = await tracker.setTarget(id, target, opts)
      const what = target.kind === 'file' ? target.file : `localhost:${target.port}${target.path}`
      const many = target.kind === 'file' ? '同目录再写别的 HTML 文件，会作为新的一屏并排出现。' : ''
      return {
        text: `已在右侧「设计工作台」打开 ${what}。${target.kind === 'file' ? '这个目录里的文件一改就自动刷新。' + many : '开发服务器的热更新照常生效。'}`,
        url: st.url,
      }
    },
  })

  // ── 自动发现 ──────────────────────────────────────────────────────────────

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      try {
        if (session && event && session.id) tracker.observe(session.id, event)
      } catch (e) {
        log(e)
      }
    })
  }
}
