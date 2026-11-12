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

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenize } from './gallery/html.js'

export const INTERNAL = '/__dsh_design__/'
const PICKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'picker.js')
const DRAFT_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'draft-page.js')
// 草稿往外吐：模型一点点流的时候来多少吐多少（不拖后腿，右侧栏中途才来看也是先把写到的一口气给）；
// 整页一下子到的（模型服务把参数憋到最后一块给：一块 DRAFT_LUMP 字以上、紧跟着就写完了，或者来看时已经写完、draft.js 记着是整段到的）才排队，
// 每 50ms 一截、约 60 拍（3 秒）放完，一截至少 100 字
const DRAFT_TICK = 50
const DRAFT_STEP = 100
const DRAFT_SPREAD = 60
const DRAFT_LUMP = 1500
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
const ANNOTATIONS = /^annotations\.json(\.[0-9a-z]+\.tmp)?$/i // 业务标注（DSH 写文件时先写 .tmp 再改名）：右侧栏靠轮询跟上，页面用不到它，别一改就整屏刷新
const HANDOFF = /^handoff([\\/]|$)/i // 转成代码的交接包（说明和截图）：不算设计改了，也别在截图时把页面刷掉

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
  'addEventListener("error",(e)=>{const t=e.target;if(t&&t!==window&&t.tagName){const h=t.href;add({res:1,tag:t.tagName.toLowerCase(),src:String(t.currentSrc||t.src||(h&&typeof h.baseVal==="string"?h.baseVal:h)||"").slice(0,300)})}' +
  'else add({msg:String(e.message||"").slice(0,300),src:String(e.filename||"").slice(0,300),line:e.lineno||0})},true);' +
  'addEventListener("unhandledrejection",(e)=>{const r=e.reason;add({msg:String((r&&r.message)||r).slice(0,300),src:"",line:0})})})()</script>'

/** 放进 <head> 最前面；没写 <head> 就放在 <html> / <!doctype> 后面（放到 doctype 前面页面会进怪异模式） */
export function headInsert(html, tag) {
  const m = /<head\b[^>]*>/i.exec(html) || /<html\b[^>]*>/i.exec(html) || /^\s*<!doctype\b[^>]*>/i.exec(html)
  return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : tag + html
}

/**
 * 在 </body> 前（没有就在末尾）插入选取脚本，<head> 最前面放报错记录。
 * nonce：别人做的设计（设计库来的）加了「只准带这个记号的脚本跑」的规矩，我们自己的两段脚本带上它；data-strict 让 picker 拦外链
 */
export function injectPicker(html, { nonce = '' } = {}) {
  const n = nonce ? ` nonce="${nonce}"` : ''
  const tag = `<script src="${INTERNAL}picker.js"${n}${nonce ? ' data-strict="1"' : ''}></script>`
  const i = html.toLowerCase().lastIndexOf('</body>')
  return headInsert(i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag, nonce ? ERR_CATCHER.replace('<script>', `<script${n}>`) : ERR_CATCHER)
}

/**
 * 别人做的设计（设计库市场来的、拖进来的 zip，且没被改过）预览时的硬规矩：
 * 只有带 nonce 的脚本（我们注入的 picker）能跑；不联网（样式、图片、字体只能是自己这个预览地址或 data:）；
 * 表单交不出去；不能嵌别的页面、不能改 <base>
 */
export function strictCsp(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** 硬规矩预览的其他响应头 */
export const STRICT_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=()',
}
/**
 * 硬规矩预览前再拆掉 CSP 管不到的几样：<meta http-equiv>（自动跳走）、<link rel="preconnect / dns-prefetch / prerender …">（偷偷连外网）、
 * a[ping]。只改属性名（data-dsh-off-…），不改别的字。正常的设计库内容本来就没有这些（检查规则拒收），这里是兜底
 */
export function defang(html) {
  const edits = []
  for (const tk of tokenize(html)) {
    if (tk.type !== 'tag') continue
    const t = tk.tag
    for (const a of t.attrs) {
      const off = (t.name === 'meta' && a.name === 'http-equiv')
        || (t.name === 'link' && a.name === 'rel' && !/^\s*(stylesheet|icon|shortcut icon|apple-touch-icon)\s*$/i.test(a.value))
        || a.name === 'ping'
      if (off) edits.push(a.start)
    }
  }
  let out = html
  for (const at of edits.sort((a, b) => b - a)) out = out.slice(0, at) + 'data-dsh-off-' + out.slice(at)
  return out
}

// 别人做的 SVG 被当页面直接打开时：不准跑任何脚本
const STRICT_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

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
  if (path.sep === '\\') rel = rel.replace(/\\/g, '/') // Windows：反斜杠也是分隔符，先换成 / 再去掉 ..（不然 ..\ 绕得出去）
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel))
  const base = path.resolve(root)
  if (abs !== base && !abs.startsWith(base + path.sep)) return null // 文件还不存在（正在写的草稿）也不许出根目录
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
 * @param opts.onWatch  (key) 开始监听一个目录（之前没在听：那段时间改了什么不知道）
 * @param opts.onUnwatch (key) 不再监听（关了、监听出错）：之后改了什么不知道
 * @param opts.history  设计版本（lib/history.js）：/__dsh_design__/v/<版本>/<文件> 给出那一版的文件
 * @param opts.parents  () → 还有哪些 DSH 页面的源能嵌预览（DSH 网页端的地址）
 * @param opts.strict   { html(buf) → 这份 HTML 是别人做的、没改过吗, root(dir) → 这个目录是别人做的设计吗 }：是就加硬规矩
 */
/**
 * 草稿页往外吐的时候，在 doctype 后面插上草稿脚本（插在 doctype 前面会进怪异模式）。
 * 开头可能被切成好几块：攒到能判断为止。
 */
export function draftInjector(tag) {
  const LIMIT = 4096
  let buf = ''
  let done = false
  let mid = false // 开头的注释太长：已经先吐出去一截，buf 接着在注释里面
  let open = false // 看到 buf 末尾时还在一段没收尾的注释里
  return {
    push(text) {
      if (done) return text
      buf += text
      let out = ''
      let inCmt = mid
      let i = inCmt ? 0 : /^\uFEFF?\s*/.exec(buf)[0].length // buf[0, i) 看过了：空白、完整的注释
      const at = (k) => {
        done = true
        const s = out + buf.slice(0, k) + tag + buf.slice(k)
        buf = ''
        return s
      }
      // 还得等：攒太多了就先把看过的（注释里的也行，留两个字防 --> 被切开）吐出去，接着等 doctype
      const hold = () => {
        open = inCmt
        if (buf.length <= LIMIT) return out
        const k = inCmt ? Math.max(i, buf.length - 2) : i
        out += buf.slice(0, k)
        buf = buf.slice(k)
        mid = inCmt
        return out
      }
      // 开头的注释跳过去（<!-- license --> 后面才是 doctype）；doctype 后面插，没有 doctype 就插在注释后面
      for (;;) {
        if (inCmt) {
          const e = buf.indexOf('-->', i)
          if (e < 0) return hold()
          inCmt = false
          i = e + 3
          i += /^\s*/.exec(buf.slice(i))[0].length
          continue
        }
        const rest = buf.slice(i)
        if (!rest) return hold()
        if (rest.startsWith('<!--')) {
          inCmt = true
          i += 4
          continue
        }
        if (rest.length < 9 && ('<!doctype'.startsWith(rest.toLowerCase()) || '<!--'.startsWith(rest))) return hold() // 还没到全
        if (/^<!doctype/i.test(rest)) {
          const e = buf.indexOf('>', i)
          if (e >= 0) return at(e + 1)
          return rest.length > LIMIT ? at(i) : hold() // 这么长还没完：不像 doctype，不等了
        }
        return at(i)
      }
    },
    flush() {
      if (done) return ''
      done = true
      // 停在一段没写完的注释里：先把注释收上，脚本才会跑
      const out = open ? buf + '-->' + tag : mid ? buf + tag : tag + buf
      buf = ''
      return out
    },
  }
}

export function createHub({ log = () => {}, onChange = () => {}, onWatch = () => {}, onUnwatch = () => {}, history = null, parents = () => [], strict = null, drafts = null, skipAnnots = () => false } = {}) {
  const strictHtml = (buf) => { try { return !!(strict && strict.html && strict.html(buf)) } catch (e) { log(e); return true } }
  const strictRoot = (dir) => { try { return !!(strict && strict.root && strict.root(dir)) } catch (e) { log(e); return true } }
  const strictVer = (dir) => { try { return !!(strict && strict.versions && strict.versions(dir)) } catch (e) { log(e); return true } }

  /** 发一份 HTML：别人做的加硬规矩（CSP + nonce），我们的脚本照常注入 */
  function sendHtml(res, req, buf, type, force = false) {
    if (force || strictHtml(buf)) {
      const nonce = crypto.randomBytes(16).toString('base64')
      return send(res, 200, req.method === 'HEAD' ? '' : injectPicker(defang(buf.toString('utf8')), { nonce }), { 'Content-Type': type, 'Content-Security-Policy': strictCsp(nonce), ...STRICT_HEADERS })
    }
    send(res, 200, req.method === 'HEAD' ? '' : injectPicker(buf.toString('utf8')), { 'Content-Type': type })
  }
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

  function draftJs(res) {
    fs.readFile(DRAFT_JS, 'utf8', (err, src) => {
      if (err) return send(res, 500, 'draft script missing')
      send(res, 200, src, { 'Content-Type': MIME['.js'] })
    })
  }

  /** 正在写的那一页（地址带 ?__ddp_draft=）：先吐出已经写到的，之后来一截吐一截，写完收尾（浏览器边收边画） */
  function serveDraft(req, res, entry, pathname) {
    if (entry.kind !== 'file' || !drafts || strictRoot(entry.root)) return send(res, 404, 'not found')
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
    const hit = resolveInRoot(entry.root, pathname)
    if (!hit) return send(res, 403, 'forbidden')
    let want = ''
    try { want = new URL(req.url, 'http://x').searchParams.get('__ddp_draft') || '' } catch { /* route 里已经验过 */ }
    const got = drafts.get(hit.abs)
    // 地址里的编号对得上才给：同一个文件又开始重写（别的会话、或下一次写）时，旧框子拿到的是真文件，不串到新的那份
    const d = got && String(got.id) === want ? got : null
    if (!d) return serveFile(req, res, entry, pathname) // 已经写完收走了：给真文件
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    if (req.method === 'HEAD') return res.end()
    const inj = draftInjector(`<script src="${INTERNAL}draft.js"></script>`)
    let off = () => {}
    let ended = false
    // 一大段一下子到：排着队一截截放，看着还是一段段长出来的；<head> 里的样式看不见，一口气给。
    // step 是 0 = 没在排队，来多少吐多少
    const q = { buf: '', body: false, src: false, timer: null, step: 0, big: false }
    const spread = (len) => Math.max(DRAFT_STEP, Math.ceil(len / DRAFT_SPREAD))
    const stop = () => {
      ended = true
      clearTimeout(q.timer)
      off()
    }
    const pump = () => {
      q.timer = null
      if (ended) return
      if (q.big) {
        q.big = false
        if (q.src) q.step = Math.max(q.step, spread(q.buf.length)) // 一大块到了紧跟着就写完了：整页憋到最后给的，慢放
      }
      let n = q.buf.length
      if (!q.body) {
        const m = /<body\b[^>]*>/i.exec(q.buf) || /<\/head\s*>/i.exec(q.buf)
        if (m) {
          q.body = true
          n = m.index + m[0].length
          if (q.step) q.step = spread(q.buf.length - n) // 剩下的正文按原来的时长放
        } else if (q.src) q.body = true // 写完了也没找到 <body>：整页都按拍子放
      }
      if (q.body && q.step && n === q.buf.length) n = Math.min(n, q.step)
      if (n < q.buf.length && /[\ud800-\udbff]/.test(q.buf[n - 1] || '')) n++ // 别把表情切成两半
      const s = inj.push(q.buf.slice(0, n))
      q.buf = q.buf.slice(n)
      try { if (s) res.write(s) } catch (e) { log(e) }
      if (q.buf) q.timer = setTimeout(pump, DRAFT_TICK)
      else if (!q.src) q.step = 0 // 放完了：之后又是一点点流的，来多少吐多少
      else {
        stop()
        try { res.end(inj.flush()) } catch (e) { log(e) }
      }
    }
    // how：'lump' 慢放；'now' 一口气给；不填 = 流过来的一块，一大块的话等这一下过完看是不是紧跟着就写完了
    const out = (text, how) => {
      if (ended) return
      if (text) {
        q.buf += text
        if (how === 'lump') q.step = Math.max(q.step, spread(q.buf.length))
        else if (!how && text.length >= DRAFT_LUMP) q.big = true
      }
      if (q.big) {
        if (!q.timer) q.timer = setTimeout(pump, 0)
        return
      }
      if (!q.timer) pump()
    }
    const finish = () => {
      q.src = true
      out('')
    }
    off = drafts.sub(hit.abs, (ev) => {
      if (ev.text) out(ev.text)
      if (ev.done) finish()
    })
    res.on('close', stop)
    res.on('error', stop)
    // 来看时已经写到的：整段一下子到、已经写完的补放一遍；别的（还在写，或一路流着写完、右侧栏换了个框重新打开的）一口气给
    if (d.done) q.src = true // 先记下已经写完（找不到 <body> 的页面靠它整页按拍子放）
    out(d.text, d.done && d.lump ? 'lump' : 'now')
    if (d.done) finish()
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
      fs.readFile(file, (err, buf) => {
        if (err) return send(res, 500, '读不了这个文件')
        sendHtml(res, req, buf, type)
      })
      return
    }
    // 别的源不能把这里的文件当子资源拿走
    const extra = strictRoot(entry.root) ? { 'X-Content-Type-Options': 'nosniff', ...(ext === '.svg' ? { 'Content-Security-Policy': STRICT_SVG_CSP } : {}) } : {}
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', ...extra })
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
      // 装好的别人的设计系统：旧版本里的页面一律加规矩
      if (ext === '.html' || ext === '.htm') return sendHtml(res, req, buf, type, strictVer(entry.root))
      const extra = strictRoot(entry.root) ? { 'X-Content-Type-Options': 'nosniff', ...(ext === '.svg' ? { 'Content-Security-Policy': STRICT_SVG_CSP } : {}) } : {}
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', ...extra })
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
    const lost = () => { try { onUnwatch(entry.key) } catch (e) { log(e) } }
    try {
      const w = fs.watch(entry.root, { recursive: true }, (_type, name) => {
        const rel = String(name || '')
        if (IGNORED.test(rel) || /(^|[\\/])\./.test(rel) || EXPORTS.test(rel) || HANDOFF.test(rel) || (skipAnnots() && ANNOTATIONS.test(rel))) return
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
      entry.watcher = w
      // 监听出错（句柄用光、目录被删…）：关掉、清空，下次 open 再补上
      w.on('error', (e) => {
        log(e)
        try { w.close() } catch { /* 已经关了 */ }
        if (entry.watcher === w) { entry.watcher = null; lost() }
      })
      try { onWatch(entry.key) } catch (e) { log(e) }
    } catch (e) {
      log(e)
      entry.watcher = null
      lost()
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
    if (pathname === INTERNAL + 'draft.js') return draftJs(res)
    // 草稿就挂在这一屏自己的地址上（/menu.html?__ddp_draft=…），页面里的相对地址（tokens.css、图片）照常对得上
    if (entry.kind === 'file' && /[?&]__ddp_draft=/.test(req.url)) return serveDraft(req, res, entry, pathname)
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
      if (have.kind === 'file' && !have.watcher) watch(have) // 先开的时候目录还没建（边写边看的第一屏）：现在补上监听
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
    if (entry.kind === 'file') try { onUnwatch(key) } catch (e) { log(e) }
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

  /** 现在一共连着几条改动通知（SSE）：右侧栏里的页面靠转告，不该自己开（浏览器对同一地址最多 6 条连接） */
  function listeners() {
    let n = 0
    for (const e of servers.values()) n += e.clients.size
    return n
  }

  return { open, close, closeAll, alive, listeners, size: () => servers.size }
}
