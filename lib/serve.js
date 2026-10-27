/**
 * 预览服务器：每个预览目标单独开一个 127.0.0.1 随机端口，页面在自己的源里跑。
 *
 *   file   本地 HTML：以它所在目录为根，静态给文件；目录里有改动就通过 SSE 让页面整页刷新
 *   proxy  本地开发服务器（vite / next / …）：原样转发，WebSocket 也转（热更新照常用）
 *
 * 为什么不挂在 DSH 自己的地址下：
 *   - 挂在子路径下，页面里 /assets/x.js 这种根路径会打到 DSH 自己身上；独立端口就没这个问题
 *   - DSH 桌面版不转发 WebSocket，开发服务器的热更新会断；自己的端口可以转
 *   - 页面和 DSH 不同源，预览的页面碰不到 DSH 的接口
 *
 * 每个 HTML 页面都注入 /__dsh_design__/picker.js：负责点选 / 框选，用 postMessage 和右侧栏通信。
 */

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INTERNAL = '/__dsh_design__/'
const PICKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'picker.js')
const MAX_SERVERS = 8
const MAX_HTML = 8 * 1024 * 1024 // 要注入脚本的 HTML 最多读这么大
const UP_HOSTS = ['127.0.0.1', '::1'] // 开发服务器可能只听其中一个
const DEBOUNCE_MS = 120

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
}

// 改动通知里不算的：版本库、依赖、系统垃圾
const EXPORTS = /^(exports([\\/][^\\/]+\.(png|pdf|pptx))?|refs([\\/][^\\/]+\.(png|jpe?g|gif|webp))?)$/i // 导出的图片 / PDF / PPT、参考图（和第一次建的 exports / refs 目录）：不算设计改了
const IGNORED = /(^|[\\/])(\.git|node_modules|\.DS_Store|\.next|\.cache|\.turbo)([\\/]|$)/

/** 只认本机名 + 自己的端口（防 DNS 重绑定：外站把域名解析到 127.0.0.1 也进不来） */
export function hostOk(host, port) {
  const h = String(host || '').toLowerCase()
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`
}

/**
 * 最先跑的一小段：记下页面脚本报错、没载出来的样式表 / 脚本（设计体检报给模型）。
 * picker 在 </body> 前，等它装上，前面脚本的报错早过去了
 */
export const ERR_CATCHER = '<script>(()=>{if(window.__dshErrs)return;const L=window.__dshErrs=[];const add=(x)=>{if(L.length<30)L.push(x)};' +
  'addEventListener("error",(e)=>{const t=e.target;if(t&&t!==window&&t.tagName){add({res:1,tag:t.tagName.toLowerCase(),src:String(t.currentSrc||t.src||t.href||"").slice(0,300)})}' +
  'else add({msg:String(e.message||"").slice(0,300),src:String(e.filename||"").slice(0,300),line:e.lineno||0})},true);' +
  'addEventListener("unhandledrejection",(e)=>{const r=e.reason;add({msg:String((r&&r.message)||r).slice(0,300),src:"",line:0})})})()</script>'

/** 放进 <head> 最前面；没写 <head> 就放在 <html> / <!doctype> 后面（放到 doctype 前面页面会进怪异模式） */
export function headInsert(html, tag) {
  const m = /<head\b[^>]*>/i.exec(html) || /<html\b[^>]*>/i.exec(html) || /^\s*<!doctype\b[^>]*>/i.exec(html)
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html
}

/** 在 </body> 前（没有就在末尾）插入选取脚本，<head> 最前面放报错记录 */
export function injectPicker(html) {
  const tag = `<script src="${INTERNAL}picker.js"></script>`
  const i = html.toLowerCase().lastIndexOf('</body>')
  return headInsert(i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag, ERR_CATCHER)
}

/** 真实路径在不在根目录（也取真实路径）里面 */
function inRoot(root, real) {
  const realRoot = fs.realpathSync(root)
  return real === realRoot || real.startsWith(realRoot + path.sep)
}

/** URL 路径 → 根目录下的真实文件；跳出根目录（含软链接）返回 null */
export function resolveInRoot(root, pathname) {
  let rel
  try { rel = decodeURIComponent(pathname) } catch { return null }
  if (rel.includes('\0')) return null
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel))
  let real
  try { real = fs.realpathSync(abs) } catch { return { abs, real: null } }
  if (!inRoot(root, real)) return null
  return { abs, real }
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

function errorPage(title, detail, retry) {
  return injectPicker(`<!doctype html><html><head><meta charset="utf-8">${retry ? '<meta http-equiv="refresh" content="2">' : ''}
<title>${title}</title><style>
html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:14px/1.6 -apple-system,system-ui,sans-serif;color:#8a8f98;background:transparent}
div{text-align:center;max-width:360px;padding:24px}b{display:block;color:#c9ccd2;font-weight:500;margin-bottom:4px}
</style></head><body><div><b>${title}</b>${detail}</div></body></html>`)
}

/**
 * 桌面版 DSH 的界面在 dsh-app://app/（自己注册的标准协议），右侧栏就在这个源里；
 * 预览页面里的 picker 只和它（以及 opts.parents 给的 DSH 网页端地址）说话，别的网站嵌进来收不到、也指挥不动
 */
export const DESKTOP_ORIGIN = 'dsh-app://app'

/** DSH 网页端的源（浏览器里开 DSH 时右侧栏在这里；本机地址的 localhost / 127.0.0.1 / [::1] 写法都认） */
export function webOrigins(origin) {
  let u
  try { u = new URL(origin) } catch { return [] }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return []
  const out = [u.origin]
  if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(u.host)) {
    for (const h of ['127.0.0.1', 'localhost', '[::1]']) out.push(`${u.protocol}//${h}${u.port ? ':' + u.port : ''}`)
  }
  return [...new Set(out)]
}

/**
 * DSH 声明过的对外地址（dsh-client-connection 的 trustedHosts：反向代理 / 域名，写成 host 或 host:port）→ 网页端可能的源。
 * 前面是 http 还是 https 看不出来，两种都认；没写端口的匹配任意端口，记成 「源:*」（picker 按外层的真实源比对）
 */
export function trustedOrigins(hosts) {
  const out = []
  for (const h of Array.isArray(hosts) ? hosts : []) {
    if (typeof h !== 'string' || !h || /[/?#@\s]/.test(h)) continue
    const anyPort = !/(^|[^:]):\d+$|\]:\d+$/.test(h)
    for (const proto of ['http:', 'https:']) {
      let u
      try { u = new URL(`${proto}//${h}`) } catch { continue }
      out.push(u.origin)
      if (anyPort) out.push(`${proto}//${u.host}:*`)
    }
  }
  return [...new Set(out)]
}

/**
 * @param opts.log 出错时写日志
 * @param opts.onChange (key, file, files) 目录里有文件改了（file 目标；files：这一批的相对路径）
 * @param opts.history  设计版本（lib/history.js）：/__dsh_design__/v/<版本>/<文件> 给出那一版的文件
 * @param opts.parents  () → 还有哪些 DSH 页面的源能嵌预览（DSH 网页端的地址）
 */
export function createHub({ log = () => {}, onChange = () => {}, history = null, parents = () => [] } = {}) {
  const servers = new Map() // key → entry

  function touch(entry) {
    entry.used = Date.now()
  }

  /** 满了先关一个：没有页面连着的里面最久没用的；全都连着才关最久没用的 */
  function evict() {
    if (servers.size < MAX_SERVERS) return
    const all = [...servers.values()].sort((a, b) => a.used - b.used)
    const victim = all.find((e) => !e.sockets.size && !e.clients.size) || all[0]
    if (victim) close(victim.key)
  }

  function parentOrigins() {
    let more = []
    try { more = parents() || [] } catch (e) { log(e) }
    return [...new Set([DESKTOP_ORIGIN, ...more.filter((o) => typeof o === 'string' && o)])]
  }

  function picker(res, entry) {
    fs.readFile(PICKER_FILE, 'utf8', (err, src) => {
      if (err) return send(res, 500, 'picker missing')
      const cfg = JSON.stringify({ live: entry.kind === 'file', parents: parentOrigins() })
      send(res, 200, `window.__DSH_DESIGN__=${cfg};\n${src}`, { 'Content-Type': 'text/javascript; charset=utf-8' })
    })
  }

  // ── 本地文件 ──────────────────────────────────────────────────────────────

  function serveFile(req, res, entry, pathname) {
    const hit = resolveInRoot(entry.root, pathname)
    if (!hit) return send(res, 403, 'forbidden')
    let file = hit.real
    if (file) {
      let st
      try { st = fs.statSync(file) } catch { st = null }
      if (st && st.isDirectory()) {
        // 目录补 index.html：它自己也可能是指到根外的软链接，取真实路径再查一遍
        try { file = fs.realpathSync(path.join(file, 'index.html')) } catch { file = null }
        if (file && !inRoot(entry.root, file)) return send(res, 403, 'forbidden')
      }
    }
    if (!file) {
      const html = errorPage('找不到这个文件', String(pathname).replace(/[<>&]/g, ''), false)
      return send(res, 404, html, { 'Content-Type': 'text/html; charset=utf-8' })
    }
    const ext = path.extname(file).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    if (ext === '.html' || ext === '.htm') {
      fs.readFile(file, 'utf8', (err, html) => {
        if (err) return send(res, 500, '读不了这个文件')
        send(res, 200, req.method === 'HEAD' ? '' : injectPicker(html), { 'Content-Type': type })
      })
      return
    }
    // 别的源不能把这里的文件当子资源拿走
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' })
    if (req.method === 'HEAD') return res.end()
    const stream = fs.createReadStream(file)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  /** 旧版本里的文件（只读；HTML 照样注入 picker，好在画布里显示和对比） */
  function serveVersion(req, res, entry, pathname) {
    const m = /^\/__dsh_design__\/v\/(\d+)\/(.*)$/.exec(pathname)
    let rel = ''
    try { rel = m ? decodeURIComponent(m[2]) : '' } catch { rel = '' }
    const file = m && history && !rel.split('/').includes('..') ? history.fileOf(entry.root, Number(m[1]), rel) : null
    if (!file) return send(res, 404, 'no such version file')
    const ext = path.extname(rel || 'index.html').toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'no such version file')
      if (ext === '.html' || ext === '.htm') return send(res, 200, req.method === 'HEAD' ? '' : injectPicker(buf.toString('utf8')), { 'Content-Type': type })
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' })
      res.end(req.method === 'HEAD' ? undefined : buf)
    })
  }

  /** SSE：目录里有改动就推一条 change，页面收到后整页刷新 */
  function events(req, res, entry) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': hi\n\n')
    entry.clients.add(res)
    const beat = setInterval(() => {
      touch(entry) // 页面还开着：算在用（满了不先关它）
      res.write(': ping\n\n')
    }, 20000)
    req.on('close', () => {
      clearInterval(beat)
      entry.clients.delete(res)
    })
  }

  /** 目录里有改动：攒一小会儿一起报（file 是最后一个，files 是这一批全部；页面靠 files 判断跟自己有没有关系） */
  function watch(entry) {
    let timer = null
    let last = ''
    const batch = new Set()
    try {
      entry.watcher = fs.watch(entry.root, { recursive: true }, (_type, name) => {
        const rel = String(name || '')
        if (IGNORED.test(rel) || /(^|[\\/])\./.test(rel) || EXPORTS.test(rel)) return
        last = rel
        batch.add(rel.split(path.sep).join('/'))
        clearTimeout(timer)
        timer = setTimeout(() => {
          // 一批改了太多文件就不列了（空的 = 不知道改了啥，页面整屏刷新），列一半会漏掉这一屏用到的
          const files = batch.size > 50 ? [] : [...batch]
          batch.clear()
          for (const c of entry.clients) c.write(`event: change\ndata: ${JSON.stringify({ file: last, files })}\n\n`)
          try { onChange(entry.key, path.join(entry.root, last), files) } catch (e) { log(e) }
        }, DEBOUNCE_MS)
      })
      entry.watcher.on('error', (e) => log(e))
    } catch (e) {
      log(e)
    }
  }

  // ── 开发服务器 ────────────────────────────────────────────────────────────

  /**
   * 开发服务器听在哪个本机地址上：新版 Vite 等在 Mac 上 localhost 解析成 ::1，只听 IPv6；
   * 先试 127.0.0.1 再试 ::1，连得上的记下来（连不上了再重新找）
   */
  function upHost(entry) {
    if (entry.upHost) return Promise.resolve(entry.upHost)
    return new Promise((resolve) => {
      let i = 0
      const next = () => {
        if (i >= UP_HOSTS.length) return resolve(UP_HOSTS[0])
        const host = UP_HOSTS[i++]
        const s = net.connect({ port: entry.port, host })
        s.setTimeout(1500)
        s.once('connect', () => { s.destroy(); entry.upHost = host; resolve(host) })
        s.once('error', () => { s.destroy(); next() })
        s.once('timeout', () => { s.destroy(); next() })
      }
      next()
    })
  }

  /** 发往开发服务器的头：Host / Origin / Referer 换回它自己的，免得被它的「只认本机名」挡掉 */
  function upstreamHeaders(headers, entry) {
    const out = { ...headers, host: `localhost:${entry.port}` }
    const mine = entry.origin
    const theirs = `http://localhost:${entry.port}`
    if (out.origin === mine) out.origin = theirs
    if (typeof out.referer === 'string' && out.referer.startsWith(mine)) out.referer = theirs + out.referer.slice(mine.length)
    return out
  }

  function proxy(req, res, entry) {
    const headers = upstreamHeaders(req.headers, entry)
    const wantsHtml = /text\/html/.test(String(req.headers.accept || ''))
    if (wantsHtml) headers['accept-encoding'] = 'identity' // 要往 HTML 里插脚本，别压缩
    upHost(entry).then((host) => forward(req, res, entry, headers, host)).catch((e) => fail(res, e))
  }

  function forward(req, res, entry, headers, host) {
    if (res.destroyed) return // 浏览器已经走了
    let gone = false
    const up = http.request({ host, port: entry.port, method: req.method, path: req.url, headers }, (upRes) => {
      const h = { ...upRes.headers }
      delete h['x-frame-options']
      if (typeof h.location === 'string') h.location = h.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/i, entry.origin)
      const isHtml = /text\/html/i.test(String(h['content-type'] || '')) && !h['content-encoding']
      if (!isHtml || req.method === 'HEAD') {
        res.writeHead(upRes.statusCode || 502, h)
        upRes.pipe(res)
        return
      }
      const chunks = []
      let size = 0
      const onData = (c) => {
        size += c.length
        chunks.push(c)
        if (size <= MAX_HTML) return
        // 太大的 HTML：不注入了，攒下的连同后面的原样流下去（不截断）
        upRes.off('data', onData)
        upRes.off('end', onEnd)
        delete h['content-security-policy']
        res.writeHead(upRes.statusCode || 200, h)
        for (const x of chunks) res.write(x)
        upRes.pipe(res)
      }
      const onEnd = () => {
        delete h['content-length']
        delete h['content-security-policy'] // 会挡住注入的脚本和被嵌入
        delete h['transfer-encoding']
        res.writeHead(upRes.statusCode || 200, h)
        res.end(injectPicker(Buffer.concat(chunks).toString('utf8')))
      }
      upRes.on('data', onData)
      upRes.on('end', onEnd)
      upRes.on('error', () => res.destroy())
    })
    // 下游（浏览器 / 手机入口）断了：上游也断，不然开发服务器的长连接（SSE 热更新）一直挂着
    res.on('close', () => {
      if (res.writableFinished) return
      gone = true
      up.destroy()
    })
    up.on('error', () => {
      if (gone) return
      entry.upHost = ''
      if (res.headersSent) return res.destroy()
      const html = errorPage(`连不上 localhost:${entry.port}`, '开发服务器可能还没启动，起来后这里会自动刷新。', true)
      send(res, 502, html, { 'Content-Type': 'text/html; charset=utf-8' })
    })
    req.pipe(up)
  }

  /** WebSocket（热更新）：原样接到开发服务器上，两头对接 */
  function upgrade(req, socket, head, entry) {
    if (entry.kind !== 'proxy' || !hostOk(req.headers.host, entry.listenPort)) return socket.destroy()
    upHost(entry).then((host) => pipeSocket(req, socket, head, entry, host)).catch((e) => { log(e); socket.destroy() })
  }

  function pipeSocket(req, socket, head, entry, host) {
    const up = net.connect(entry.port, host, () => {
      const headers = upstreamHeaders(req.headers, entry)
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
      for (const [k, v] of Object.entries(headers)) {
        for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`
      }
      up.write(raw + '\r\n')
      if (head && head.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    // 一头断了（含预览服务器被关、开发服务器停了）另一头也关，不留挂着的连接
    const done = () => { up.destroy(); socket.destroy() }
    up.on('error', done)
    socket.on('error', done)
    up.on('close', done)
    socket.on('close', done)
  }

  // ── 开关 ──────────────────────────────────────────────────────────────────

  /** 处理请求时出了意外：回 500，异常绝不往外冒（DSH 遇到没接住的异常会整个退出） */
  function fail(res, e) {
    log(e)
    try {
      if (!res.headersSent) send(res, 500, 'internal error')
      else res.destroy()
    } catch { /* 连接已经没了 */ }
  }

  function route(req, res, entry) {
    if (!hostOk(req.headers.host, entry.listenPort)) return send(res, 403, 'forbidden')
    touch(entry)
    let pathname
    try { pathname = new URL(req.url, 'http://x').pathname } catch { return send(res, 400, 'bad url') }
    if (pathname === INTERNAL + 'picker.js') return picker(res, entry)
    if (pathname === INTERNAL + 'events') {
      if (entry.kind === 'file') return events(req, res, entry)
      return send(res, 204, '')
    }
    if (entry.kind === 'file') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
      if (pathname.startsWith(INTERNAL + 'v/')) return serveVersion(req, res, entry, pathname)
      return serveFile(req, res, entry, pathname)
    }
    return proxy(req, res, entry)
  }

  function handler(entry) {
    return (req, res) => {
      try { route(req, res, entry) } catch (e) { fail(res, e) }
    }
  }

  /**
   * 拿到（没有就开）一个目标的预览服务器。
   * @param target { kind: 'file', root } | { kind: 'proxy', port }
   * @param opts.port 想用的端口（被关掉后重开时先试原来的，地址不变；被占了就随便挑一个）
   * @returns { key, origin }
   */
  async function open(target, { port: want = 0 } = {}) {
    const key = target.kind === 'file' ? `file:${path.resolve(target.root)}` : `proxy:${target.port}`
    const have = servers.get(key)
    if (have) {
      touch(have)
      await have.ready
      return { key, origin: have.origin }
    }
    evict()
    const entry = {
      key,
      kind: target.kind,
      root: target.kind === 'file' ? path.resolve(target.root) : null,
      port: target.kind === 'proxy' ? Number(target.port) : null,
      clients: new Set(),
      sockets: new Set(),
      watcher: null,
      listenPort: 0,
      origin: '',
      used: Date.now(),
    }
    const server = http.createServer(handler(entry))
    server.on('upgrade', (req, socket, head) => {
      try { upgrade(req, socket, head, entry) } catch (e) { log(e); socket.destroy() }
    })
    server.on('connection', (s) => {
      entry.sockets.add(s)
      s.on('close', () => entry.sockets.delete(s))
    })
    server.on('clientError', (_e, s) => s.destroy())
    server.on('error', (e) => log(e)) // 一直挂着：没人接的 error 会让整个进程退出
    entry.server = server
    servers.set(key, entry)
    const listen = (p) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(p, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const wanted = Number.isInteger(Number(want)) && want > 0 && want < 65536 ? Number(want) : 0
    entry.ready = (wanted ? listen(wanted).catch(() => listen(0)) : listen(0)).then(() => {
      entry.listenPort = server.address().port
      entry.origin = `http://127.0.0.1:${entry.listenPort}`
    })
    try {
      await entry.ready
    } catch (e) {
      servers.delete(key)
      throw e
    }
    if (entry.kind === 'file') watch(entry)
    return { key, origin: entry.origin }
  }

  function close(key) {
    const entry = servers.get(key)
    if (!entry) return
    servers.delete(key)
    try { entry.watcher && entry.watcher.close() } catch { /* 已经关了 */ }
    for (const c of entry.clients) c.end()
    for (const s of entry.sockets) s.destroy()
    entry.server.close()
  }

  function closeAll() {
    for (const key of [...servers.keys()]) close(key)
  }

  /** 这个地址的预览服务器还开着吗（满了会关掉最久没用的，会话那边发现没了就重开） */
  function alive(origin) {
    for (const e of servers.values()) if (e.origin && e.origin === origin) return true
    return false
  }

  return { open, close, closeAll, alive, size: () => servers.size }
}
