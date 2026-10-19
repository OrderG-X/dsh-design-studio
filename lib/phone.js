/**
 * 手机上看：在局域网开一个入口，手机扫二维码就能打开正在设计的页面（手机和电脑连同一个 Wi-Fi）。
 *
 *   - 默认不开；右侧栏点了才开，30 分钟没人看自动关，也能随时关
 *   - 只监听本机在局域网里的那个地址（不是 0.0.0.0），Host 也得是它
 *   - 链接带口令 ?k=<随机 128 位>：手机第一次打开时换成 Cookie（只在这个端口用），之后的图片、样式靠 Cookie；
 *     口令不对、没有 Cookie 的一律 403。关掉再开换新口令，旧链接作废
 *   - 原样转发到这个会话现在的预览服务器（127.0.0.1），路径不变（开发服务器的根路径照常）；WebSocket 也转（热更新）
 *   - HTML 里补上 viewport（没写的话手机会按电脑宽度缩小显示），再插一段小脚本：电脑上换了一屏，手机跟着跳
 */

import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'

export const PHONE = '/__dsh_phone__/'
const IDLE_MS = 30 * 60 * 1000
const MAX_HTML = 8 * 1024 * 1024

/** 本机在局域网里的 IPv4：优先私有网段（192.168 / 10 / 172.16–31），Wi-Fi / 有线网卡在前；没有给 '' */
export function lanAddress(ifaces = os.networkInterfaces()) {
  const cands = []
  for (const [name, list] of Object.entries(ifaces || {})) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4
      if (!v4 || a.internal || /^169\.254\./.test(a.address)) continue
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      const virtual = /^(utun|bridge|vmnet|vbox|docker|veth|tailscale|zt|llw|awdl|anpi|ap\d)/i.test(name)
      cands.push({ ip: a.address, score: (priv ? 0 : 10) + (virtual ? 5 : 0) + (/^(en|eth|wlan|wl|Wi-?Fi|以太网)/i.test(name) ? 0 : 1) })
    }
  }
  cands.sort((a, b) => a.score - b.score)
  return cands.length ? cands[0].ip : ''
}

/** 给 HTML 补 viewport、插跟随脚本 */
export function phoneHtml(html) {
  let out = html
  if (!/<meta[^>]+name=["']?viewport/i.test(out)) {
    const meta = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    const i = out.search(/<head[^>]*>/i)
    out = i >= 0 ? out.replace(/<head[^>]*>/i, (m) => m + meta) : meta + out
  }
  const tag = `<script src="${PHONE}follow.js"></script>`
  const j = out.toLowerCase().lastIndexOf('</body>')
  return j >= 0 ? out.slice(0, j) + tag + out.slice(j) : out + tag
}

// 手机页面里的小脚本：电脑上换了一屏就跳过去（同一个入口下的路径）
const FOLLOW_JS = `(() => {
  if (!window.EventSource) return
  const es = new EventSource('${PHONE}events')
  es.addEventListener('goto', (e) => {
    try {
      const p = JSON.parse(e.data).path
      if (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && p !== location.pathname + location.search) location.replace(p)
    } catch {}
  })
})()`

const DENIED = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>链接失效了</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.6 -apple-system,system-ui,sans-serif;color:#555;background:#f5f5f7;text-align:center;padding:24px;box-sizing:border-box}b{display:block;color:#111;font-size:18px;margin-bottom:6px}</style>
</head><body><div><b>链接失效了</b>回到电脑上，在「设计工作台」里点手机按钮，重新扫一次二维码。</div></body></html>`

function same(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function cookieOf(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

/**
 * @param opts.upstream (session) → 这个会话现在的预览地址（http://127.0.0.1:端口），没有给 ''
 * @param opts.address  () → 局域网地址（测试可换）
 * @param opts.idleMs   多久没人看自动关
 */
export function createPhone({ upstream, address = () => lanAddress(), log = () => {}, now = Date.now, idleMs = IDLE_MS } = {}) {
  const shares = new Map() // session → share

  /** 给右侧栏的状态 */
  function status(session) {
    const s = shares.get(session)
    if (!s) return { on: false }
    return { on: true, url: s.url, ip: s.ip, port: s.port, seen: s.seen, lastSeen: s.lastSeen }
  }

  /**
   * 打开（已经开着就沿用）。path 是手机先打开哪一页（如 /login.html）。
   * @returns status；没有局域网地址时 { on: false, error: 'no-lan' }
   */
  async function start(session, path = '/') {
    const have = shares.get(session)
    if (have) {
      if (path) have.path = path
      return status(session)
    }
    const ip = address()
    if (!ip) return { on: false, error: 'no-lan' }
    const s = {
      session,
      ip,
      token: crypto.randomBytes(16).toString('base64url'),
      path: path || '/',
      port: 0,
      url: '',
      seen: 0,
      lastSeen: 0,
      started: now(),
      followers: new Set(),
      sockets: new Set(),
    }
    s.cookie = 'ddp_phone'
    const server = http.createServer((req, res) => handle(s, req, res))
    server.on('upgrade', (req, socket, head) => upgrade(s, req, socket, head))
    server.on('connection', (c) => { s.sockets.add(c); c.on('close', () => s.sockets.delete(c)) })
    server.on('clientError', (_e, c) => c.destroy())
    s.server = server
    shares.set(session, s)
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, ip, () => resolve())
      })
    } catch (e) {
      shares.delete(session)
      log(e)
      return { on: false, error: 'listen', message: e.message }
    }
    s.port = server.address().port
    s.cookie = `ddp_phone_${s.port}` // Cookie 不分端口：带上端口免得几个会话互相顶掉
    s.url = `http://${ip}:${s.port}${encodePath(s.path)}${s.path.includes('?') ? '&' : '?'}k=${s.token}`
    s.timer = setInterval(() => {
      if (s.followers.size) s.lastSeen = now() // 手机页面开着（连着跟随通道）就算有人在看
      else if (now() - Math.max(s.started, s.lastSeen) > idleMs) stop(session)
    }, Math.min(60000, idleMs))
    if (s.timer.unref) s.timer.unref()
    return status(session)
  }

  function stop(session) {
    const s = shares.get(session)
    if (!s) return
    shares.delete(session)
    clearInterval(s.timer)
    for (const f of s.followers) f.end()
    for (const c of s.sockets) c.destroy()
    s.server.close()
  }

  function stopAll() {
    for (const k of [...shares.keys()]) stop(k)
  }

  /** 电脑上换了一屏：开着的手机跟着跳 */
  function follow(session, path) {
    const s = shares.get(session)
    if (!s || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false
    s.path = path
    for (const f of s.followers) f.write(`event: goto\ndata: ${JSON.stringify({ path: encodePath(path) })}\n\n`)
    return true
  }

  // ── 入口 ──────────────────────────────────────────────────────────────────

  function authed(s, req) {
    return same(cookieOf(req.headers.cookie, s.cookie), s.token)
  }

  function handle(s, req, res) {
    if (String(req.headers.host || '').toLowerCase() !== `${s.ip}:${s.port}`) return deny(res)
    let url
    try { url = new URL(req.url, 'http://x') } catch { return deny(res) }
    const k = url.searchParams.get('k')
    if (k !== null) {
      if (!same(k, s.token)) return deny(res)
      // 口令换成 Cookie，再跳到不带口令的地址（口令不留在手机的地址栏和历史里）
      url.searchParams.delete('k')
      res.writeHead(302, {
        'Set-Cookie': `${s.cookie}=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        Location: url.pathname.replace(/^\/+/, '/') + url.search,
        'Cache-Control': 'no-store',
      })
      return res.end()
    }
    if (!authed(s, req)) return deny(res)
    s.lastSeen = now()
    if (url.pathname === PHONE + 'follow.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(FOLLOW_JS)
    }
    if (url.pathname === PHONE + 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.write(': hi\n\n')
      s.followers.add(res)
      const beat = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => { clearInterval(beat); s.followers.delete(res) })
      return
    }
    const up = upstreamOf(s)
    if (!up) return deny(res, 503)
    if (/text\/html/.test(String(req.headers.accept || '')) && req.method === 'GET') s.seen++
    proxy(s, up, req, res)
  }

  function deny(res, code = 403) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(DENIED)
  }

  function upstreamOf(s) {
    const origin = String(upstream(s.session) || '')
    const m = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(origin)
    return m ? { origin, port: Number(m[1]) } : null
  }

  /** 发往预览服务器的头：Host / Origin / Referer 换成它自己的，口令 Cookie 不往下传 */
  function headersFor(s, up, headers) {
    const out = { ...headers, host: `127.0.0.1:${up.port}` }
    const mine = `http://${s.ip}:${s.port}`
    if (out.origin === mine) out.origin = up.origin
    if (typeof out.referer === 'string' && out.referer.startsWith(mine)) out.referer = up.origin + out.referer.slice(mine.length)
    if (out.cookie) {
      const rest = String(out.cookie).split(';').filter((p) => p.split('=')[0].trim() !== s.cookie).join(';').trim()
      if (rest) out.cookie = rest
      else delete out.cookie
    }
    return out
  }

  function proxy(s, up, req, res) {
    const headers = headersFor(s, up, req.headers)
    const wantsHtml = /text\/html/.test(String(req.headers.accept || ''))
    if (wantsHtml) headers['accept-encoding'] = 'identity'
    const r = http.request({ host: '127.0.0.1', port: up.port, method: req.method, path: req.url, headers }, (upRes) => {
      const h = { ...upRes.headers }
      if (typeof h.location === 'string' && h.location.startsWith(up.origin)) h.location = h.location.slice(up.origin.length) || '/'
      const isHtml = /text\/html/i.test(String(h['content-type'] || '')) && !h['content-encoding']
      if (!isHtml || req.method === 'HEAD') {
        res.writeHead(upRes.statusCode || 502, h)
        upRes.pipe(res)
        return
      }
      const chunks = []
      let size = 0
      upRes.on('data', (c) => { size += c.length; if (size <= MAX_HTML) chunks.push(c) })
      upRes.on('end', () => {
        if (res.headersSent || res.destroyed) return
        delete h['content-length']
        delete h['transfer-encoding']
        const text = Buffer.concat(chunks).toString('utf8')
        res.writeHead(upRes.statusCode || 200, h)
        res.end(size > MAX_HTML ? text : phoneHtml(text))
      })
      upRes.on('error', () => res.destroy())
    })
    r.on('error', () => { if (res.headersSent) res.destroy(); else deny(res, 502) })
    req.pipe(r)
  }

  function upgrade(s, req, socket, head) {
    const up = upstreamOf(s)
    if (String(req.headers.host || '').toLowerCase() !== `${s.ip}:${s.port}` || !authed(s, req) || !up) return socket.destroy()
    s.lastSeen = now()
    const conn = net.connect(up.port, '127.0.0.1', () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
      for (const [k, v] of Object.entries(headersFor(s, up, req.headers))) for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`
      conn.write(raw + '\r\n')
      if (head && head.length) conn.write(head)
      conn.pipe(socket)
      socket.pipe(conn)
    })
    const done = () => { conn.destroy(); socket.destroy() }
    conn.on('error', done)
    socket.on('error', done)
  }

  return { start, stop, stopAll, status, follow }
}

/** 路径里的中文、空格编码一下（已经编码过的不重复编码） */
function encodePath(p) {
  try { return encodeURI(decodeURI(p)) } catch { return encodeURI(p) }
}
