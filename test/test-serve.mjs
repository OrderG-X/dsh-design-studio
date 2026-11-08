/**
 * 预览服务器的测试（不用开 DSH）：
 *   node test/test-serve.mjs
 *
 * 本地文件：给文件、注入脚本、跳不出根目录、Host 把门、改文件推 change；
 * 开发服务器：转发、注入、Location 改写、拆掉 X-Frame-Options、WebSocket 透传、连不上时的提示页。
 */
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createHub, hostOk, injectPicker, resolveInRoot, webOrigins, trustedOrigins } from '../lib/serve.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

function get(url, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { host: u.host, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-serve-'))
const site = path.join(tmp, 'site')
fs.mkdirSync(path.join(site, 'css'), { recursive: true })
fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/css/a.css"></head><body><h1>Hi</h1></body></html>')
fs.writeFileSync(path.join(site, 'css', 'a.css'), 'h1{color:red}')
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'nope')
fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(site, 'leak.txt'))
// 子目录里的 index.html 是指到根外的软链接（访问 /sub/ 会补上 index.html）
fs.writeFileSync(path.join(tmp, 'secret.html'), '<p>SECRET</p>')
fs.mkdirSync(path.join(site, 'sub'))
fs.symlinkSync(path.join(tmp, 'secret.html'), path.join(site, 'sub', 'index.html'))

// 纯函数
check('injectPicker：插在 </body> 前', injectPicker('<body>x</body>').endsWith('<script src="/__dsh_design__/picker.js"></script></body>'))
check('injectPicker：没有 body 就接在末尾', injectPicker('<p>x').endsWith('picker.js"></script>'))
check('injectPicker：报错记录放在 <head> 最前（比页面脚本早）', injectPicker('<!doctype html><html><head><script>boom()</script></head><body></body></html>').startsWith('<!doctype html><html><head><script>(()=>{if(window.__dshErrs)'))
check('injectPicker：没写 <head> 时放在 doctype 后面（不进怪异模式）', injectPicker('<!DOCTYPE html><p>x').startsWith('<!DOCTYPE html><script>(()=>{'))
check('injectPicker：<header> 不当成 <head>', injectPicker('<!doctype html><header>h</header>').startsWith('<!doctype html><script>'))
check('hostOk：本机名 + 自己端口', hostOk('127.0.0.1:5000', 5000) && hostOk('localhost:5000', 5000) && !hostOk('evil.com:5000', 5000) && !hostOk('127.0.0.1:5001', 5000))
check('resolveInRoot：../ 跳不出去（被夹回根目录里）', resolveInRoot(site, '/../secret.txt').abs === path.join(site, 'secret.txt'))
check('resolveInRoot：软链接指到外面 → 拒', resolveInRoot(site, '/leak.txt') === null)

const changes = []
const hub = createHub({ onChange: (key, file) => changes.push({ key, file }) })

// ── 本地文件 ──
const a = await hub.open({ kind: 'file', root: site })
let r = await get(a.origin + '/index.html')
check('文件：HTML 能拿到', r.status === 200 && r.body.includes('<h1>Hi</h1>'))
check('文件：注入了选取脚本', r.body.includes('/__dsh_design__/picker.js'))
r = await get(a.origin + '/')
check('文件：目录给 index.html', r.status === 200 && r.body.includes('<h1>Hi</h1>'))
r = await get(a.origin + '/css/a.css')
check('文件：根路径资源能拿到、类型对', r.status === 200 && r.body === 'h1{color:red}' && /text\/css/.test(r.headers['content-type']))
check('文件：别的源拿不走子资源', r.headers['cross-origin-resource-policy'] === 'same-origin')
r = await get(a.origin + '/%2e%2e/secret.txt')
check('文件：编码过的 ../ 也跳不出去', r.status !== 200 || !r.body.includes('nope'), r.status)
r = await get(a.origin + '/leak.txt')
check('文件：软链接到根外 → 403', r.status === 403)
r = await get(a.origin + '/sub/')
check('文件：目录补的 index.html 是指到根外的软链接 → 403', r.status === 403 && !r.body.includes('SECRET'), r.status)
r = await get(a.origin + '/sub')
check('文件：不带斜杠的目录也一样 → 403', r.status === 403 && !r.body.includes('SECRET'), r.status)
r = await get(a.origin + '/index.html', { headers: { host: 'evil.example:' + new URL(a.origin).port } })
check('文件：Host 不对 → 403（防 DNS 重绑定）', r.status === 403)
r = await get(a.origin + '/nope.html')
check('文件：找不到 → 404 提示页', r.status === 404 && r.body.includes('找不到'))
r = await get(a.origin + '/__dsh_design__/picker.js')
check('文件：选取脚本带上配置（live）', r.status === 200 && r.body.startsWith('window.__DSH_DESIGN__={"live":true,'))
check('文件：选取脚本只认 DSH 的源（桌面版 dsh-app://app）', r.body.includes('"parents":["dsh-app://app"]'), r.body.slice(0, 120))
const again = await hub.open({ kind: 'file', root: site })
check('同一个目录复用同一个服务器', again.origin === a.origin && hub.size() === 1)

// SSE：改文件推 change
const sse = await new Promise((resolve) => {
  const u = new URL(a.origin + '/__dsh_design__/events')
  const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => {
    let buf = ''
    res.on('data', (c) => {
      buf += c
      if (buf.includes('event: change') && buf.includes('a.css')) { resolve(buf); req.destroy() } // 建测试目录时的改动可能晚到一步，等 a.css 那条
    })
    setTimeout(() => fs.writeFileSync(path.join(site, 'css', 'a.css'), 'h1{color:blue}'), 150)
    setTimeout(() => { resolve(buf); req.destroy() }, 3000)
  })
})
check('文件：改了 CSS → SSE 推 change', sse.includes('event: change') && sse.includes('a.css'), JSON.stringify(sse))
const hubGot = () => changes.some((c) => c.key === 'file:' + site && c.file.endsWith('a.css'))
for (let i = 0; i < 40 && !hubGot(); i++) await new Promise((r) => setTimeout(r, 50)) // hub 的通知可能比 SSE 晚到一点（CI 机器上见过）
check('文件：改动也通知到 hub（让右侧栏知道）', hubGot(), JSON.stringify(changes))

// ── 开发服务器 ──
const devSse = { open: 0, closed: 0 }
const devWs = { open: 0, closed: 0 }
const BIG = '<html><body>' + 'x'.repeat(9 * 1024 * 1024) + '<p>THE-END</p></body></html>' // 超过 8MB 的 HTML
const upstreamSeen = []
const dev = http.createServer((req, res) => {
  upstreamSeen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, ae: req.headers['accept-encoding'] })
  if (req.url === '/go') { res.writeHead(302, { Location: `http://localhost:${dev.address().port}/there` }); return res.end() }
  if (req.url === '/api') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":1}') }
  if (req.url === '/sse') { // 开发服务器的 SSE 热更新：下游断了要跟着断
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': hi\n\n')
    devSse.open++
    req.on('close', () => devSse.closed++)
    return
  }
  if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(BIG) }
  res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" })
  res.end('<html><body><div id="app">dev</div></body></html>')
})
dev.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Seen-Host: ${req.headers.host}\r\nX-Seen-Origin: ${req.headers.origin}\r\n\r\n`)
  socket.on('data', (d) => socket.write(d)) // 回声
  devWs.open++
  socket.on('end', () => devWs.closed++) // 代理那头关了（收到 FIN）；http 的升级连接是半开的，不会自己 close
  socket.on('error', () => {})
})
await new Promise((res) => dev.listen(0, '127.0.0.1', res))
const devPort = dev.address().port
const b = await hub.open({ kind: 'proxy', port: devPort })
r = await get(b.origin + '/', { headers: { accept: 'text/html', origin: b.origin, 'accept-encoding': 'gzip' } })
check('代理：HTML 转发过来并注入脚本', r.status === 200 && r.body.includes('dev') && r.body.includes('picker.js'))
check('代理：拆掉 X-Frame-Options 和 CSP（能嵌进右侧栏）', !r.headers['x-frame-options'] && !r.headers['content-security-policy'])
const seen = upstreamSeen[upstreamSeen.length - 1]
check('代理：Host / Origin 换成开发服务器自己的', seen.host === `localhost:${devPort}` && seen.origin === `http://localhost:${devPort}`, JSON.stringify(seen))
check('代理：要 HTML 时让上游别压缩', seen.ae === 'identity')
r = await get(b.origin + '/api')
check('代理：非 HTML 原样转发、不注入', r.body === '{"ok":1}')
r = await get(b.origin + '/go')
check('代理：跳转地址改回预览服务器', r.status === 302 && r.headers.location === `${b.origin}/there`, r.headers.location)
r = await get(b.origin + '/__dsh_design__/picker.js')
check('代理：选取脚本 live=false（交给热更新）', r.body.startsWith('window.__DSH_DESIGN__={"live":false,'))
r = await get(b.origin + '/big', { headers: { accept: 'text/html' } })
check('代理：超过 8MB 的 HTML 原样整份给出（不截断、不注入）', r.status === 200 && r.body === BIG, `${r.body.length} vs ${BIG.length}`)

// 浏览器 / 手机入口断了：往开发服务器的那条连接也断（不然 SSE 长连接越积越多）
await new Promise((resolve) => {
  const u = new URL(b.origin + '/sse')
  const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => {
    res.once('data', () => { req.destroy(); resolve() })
  })
  req.on('error', () => {})
  setTimeout(resolve, 2000)
})
await new Promise((r) => setTimeout(r, 200))
check('代理：下游断了，上游的 SSE 连接也断', devSse.open === 1 && devSse.closed === 1, JSON.stringify(devSse))

// WebSocket 透传
const ws = await new Promise((resolve) => {
  const s = net.connect(Number(new URL(b.origin).port), '127.0.0.1', () => {
    s.write(`GET /hmr HTTP/1.1\r\nHost: ${new URL(b.origin).host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: ${b.origin}\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  })
  let buf = ''
  s.on('data', (d) => {
    buf += d
    if (buf.includes('\r\n\r\n') && !buf.includes('PING')) s.write('PING')
    if (buf.includes('PING')) { resolve(buf); s.destroy() }
  })
  setTimeout(() => { resolve(buf); s.destroy() }, 2000)
})
check('代理：WebSocket 升级成功（热更新能用）', ws.startsWith('HTTP/1.1 101'), JSON.stringify(ws.slice(0, 60)))
check('代理：WebSocket 的 Host / Origin 也换了', ws.includes(`X-Seen-Host: localhost:${devPort}`) && ws.includes(`X-Seen-Origin: http://localhost:${devPort}`))
check('代理：WebSocket 数据双向通', ws.includes('PING'))

// 预览服务器被关（淘汰 / 关预览）：往开发服务器的 WebSocket 也关掉，不留挂着的连接
{
  const hw = createHub()
  const w = await hw.open({ kind: 'proxy', port: devPort })
  const before = { ...devWs }
  const cli = await new Promise((resolve) => {
    const s = net.connect(Number(new URL(w.origin).port), '127.0.0.1', () => {
      s.write(`GET /hmr HTTP/1.1\r\nHost: ${new URL(w.origin).host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    s.on('error', () => {})
    s.once('data', () => resolve(s))
    setTimeout(() => resolve(s), 2000)
  })
  check('WebSocket 接通', devWs.open === before.open + 1)
  hw.close(w.key)
  await new Promise((r) => setTimeout(r, 200))
  check('预览服务器关了：开发服务器那头的 WebSocket 也关了（一条不剩）', devWs.closed === devWs.open, JSON.stringify({ before, devWs }))
  cli.destroy()
}

// 连不上
const deadPort = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const c = await hub.open({ kind: 'proxy', port: deadPort })
r = await get(c.origin + '/', { headers: { accept: 'text/html' } })
check('代理：开发服务器没起来 → 提示页 + 自动重试', r.status === 502 && r.body.includes('连不上') && r.body.includes('http-equiv="refresh"'))

// 只听 IPv6 的开发服务器（新版 Vite 在 Mac 上的默认样子）
const dev6 = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>v6</body></html>') })
dev6.on('upgrade', (req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); socket.on('data', (d) => socket.write(d)) })
const v6ok = await new Promise((res) => { dev6.once('error', () => res(false)); dev6.listen(0, '::1', () => res(true)) })
if (v6ok) {
  const d6 = await hub.open({ kind: 'proxy', port: dev6.address().port })
  r = await get(d6.origin + '/', { headers: { accept: 'text/html' } })
  check('代理：开发服务器只听 ::1 也连得上', r.status === 200 && r.body.includes('v6') && r.body.includes('picker.js'), r.status + ' ' + r.body.slice(0, 80))
  const ws6 = await new Promise((resolve) => {
    const s = net.connect(Number(new URL(d6.origin).port), '127.0.0.1', () => {
      s.write(`GET /hmr HTTP/1.1\r\nHost: ${new URL(d6.origin).host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    let buf = ''
    s.on('data', (d) => { buf += d; if (buf.includes('\r\n\r\n') && !buf.includes('PING')) s.write('PING'); if (buf.includes('PING')) { resolve(buf); s.destroy() } })
    setTimeout(() => { resolve(buf); s.destroy() }, 2000)
  })
  check('代理：只听 ::1 时 WebSocket 也通', ws6.startsWith('HTTP/1.1 101') && ws6.includes('PING'), JSON.stringify(ws6.slice(0, 40)))
  dev6.close()
} else console.log('（这台机器没有 IPv6 回环，跳过 ::1 测试）')

hub.closeAll()
dev.close()
check('closeAll 之后全关了', hub.size() === 0)

// ── 只和 DSH 说话：picker 的配置里带上 DSH 的源 ──
check('webOrigins：本机地址的几种写法都认', JSON.stringify(webOrigins('http://127.0.0.1:5000')) === JSON.stringify(['http://127.0.0.1:5000', 'http://localhost:5000', 'http://[::1]:5000']))
check('trustedOrigins：DSH 声明的 host:port → http / https 两种', JSON.stringify(trustedOrigins(['dsh.example.com:8443'])) === JSON.stringify(['http://dsh.example.com:8443', 'https://dsh.example.com:8443']))
check('trustedOrigins：没写端口 → 默认端口 + 任意端口', JSON.stringify(trustedOrigins(['dsh.example.com'])) === JSON.stringify(['http://dsh.example.com', 'http://dsh.example.com:*', 'https://dsh.example.com', 'https://dsh.example.com:*']))
check('trustedOrigins：乱的、不是数组的不认', trustedOrigins(['a/b', 'x y', '', 3]).length === 0 && trustedOrigins(undefined).length === 0)
check('webOrigins：别的地址只认它自己、乱的不认',JSON.stringify(webOrigins('https://dsh.example.com/x')) === JSON.stringify(['https://dsh.example.com']) && webOrigins('').length === 0 && webOrigins('dsh-app://app').length === 0)
{
  const hp = createHub({ parents: () => ['http://127.0.0.1:9999'] })
  const p = await hp.open({ kind: 'file', root: site })
  const js = await get(p.origin + '/__dsh_design__/picker.js')
  check('选取脚本：DSH 网页端的源也带上', js.body.startsWith('window.__DSH_DESIGN__={"live":true,"parents":["dsh-app://app","http://127.0.0.1:9999"]}'), js.body.slice(0, 120))
  hp.closeAll()
}

// ── 出了意外：回 500，异常不往外冒 ──
{
  const hx = createHub({ history: { fileOf: () => { throw new Error('boom') } }, log: () => {} })
  const x = await hx.open({ kind: 'file', root: site })
  const bad = await get(x.origin + '/__dsh_design__/v/1/index.html')
  const ok = await get(x.origin + '/index.html')
  check('处理请求时抛错 → 500，服务器照常', bad.status === 500 && ok.status === 200, `${bad.status} ${ok.status}`)
  hx.closeAll()
}

// ── 开满 8 个：先关没有页面连着的；关掉的 alive() 报 false ──
{
  const he = createHub()
  const dirs = []
  for (let i = 0; i < 9; i++) {
    const d = path.join(tmp, 'e' + i)
    fs.mkdirSync(d)
    fs.writeFileSync(path.join(d, 'index.html'), `<p>${i}</p>`)
    dirs.push(d)
  }
  const first = await he.open({ kind: 'file', root: dirs[0] })
  // 第一个有页面连着（SSE），然后再开 7 个 → 第一个是最久没用的，但连着
  const sseReq = await new Promise((resolve) => {
    const u = new URL(first.origin + '/__dsh_design__/events')
    const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => res.once('data', () => resolve(req)))
    req.on('error', () => {})
  })
  const opened = [first]
  for (let i = 1; i < 8; i++) { await new Promise((r) => setTimeout(r, 3)); opened.push(await he.open({ kind: 'file', root: dirs[i] })) }
  check('开满 8 个', he.size() === 8)
  await he.open({ kind: 'file', root: dirs[8] })
  check('再开一个：关掉的是没人连着的里面最久没用的，连着的留下', he.size() === 8 && he.alive(first.origin) && !he.alive(opened[1].origin), `${he.alive(first.origin)} ${he.alive(opened[1].origin)}`)
  sseReq.destroy()
  // 被关掉的重开：先试原来的端口，地址不变（右侧栏不用当成换了页面）
  const back = await he.open({ kind: 'file', root: dirs[1] }, { port: Number(new URL(opened[1].origin).port) })
  check('重开时用回原来的端口', back.origin === opened[1].origin, `${back.origin} vs ${opened[1].origin}`)
  const busyPort = Number(new URL(first.origin).port) // 还在用的端口：要不到就换一个，不报错
  he.close(back.key)
  fs.mkdirSync(path.join(tmp, 'e9'))
  const other = await he.open({ kind: 'file', root: path.join(tmp, 'e9') }, { port: busyPort }).catch((e) => ({ error: e.message }))
  check('原来的端口被占了：换一个照常开', other.origin && other.origin !== first.origin, JSON.stringify(other))
  he.closeAll()
  check('关了以后 alive() 都是 false', opened.every((o) => !he.alive(o.origin)))
}
// ── 真浏览器：在右侧栏里改动由右侧栏转告，页面自己不开 SSE（画布上 6 屏就会占满 6 条连接） ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  fs.mkdirSync(path.join(tmp, 'relay'))
  fs.writeFileSync(path.join(tmp, 'relay', 'index.html'), '<!doctype html><title>r</title><h1>r</h1>')
  // 导出用：图标在外部的 icons.svg 里（<use href="icons.svg#sq">）
  fs.writeFileSync(path.join(tmp, 'relay', 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="sq" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></symbol></svg>')
  // 连线用：被固定底栏盖住的按钮不报，底栏里的照报
  fs.writeFileSync(path.join(tmp, 'relay', 'bar.html'), '<!doctype html><style>body{margin:0;height:600px}a{display:block}.bar{position:fixed;left:0;right:0;bottom:0;height:50px;background:#fff}</style>'
    + '<a href="b.html" style="height:40px">top</a><a href="c.html" style="position:absolute;top:160px;left:0;width:200px;height:30px">under</a><div class="bar"><a href="d.html" style="height:50px">tab</a></div>')
  fs.writeFileSync(path.join(tmp, 'relay', 'icon.html'), '<!doctype html><style>body{margin:0;background:#fff}</style><svg width="40" height="40"><use href="icons.svg#sq"/></svg>')
  let preview = ''
  // 假的 DSH：嵌预览，收到 hello 回 init（relay=1 是新版右侧栏；relay=0 是老版，不说 relay）
  const outer = http.createServer((req, res) => {
    const relay = req.url.includes('relay=1')
    res.writeHead(200, { 'content-type': 'text/html' })
    const src = preview + (new URL(req.url, 'http://x').searchParams.get('page') || 'index.html')
    res.end(`<!doctype html><iframe id="f" src="${src}" width="300" height="200"></iframe><script>
      window.got = []
      addEventListener('message', (e) => {
        const d = e.data || {}
        if (d.dshDesign !== 1) return
        window.got.push(d.type)
        if (d.type === 'hello') e.source.postMessage({ dshDesign: 1, type: 'init', relay: ${relay} }, '*')
        if (d.type === 'ready') e.source.postMessage({ dshDesign: 1, type: 'reveal' }, '*')
        if (d.type === 'captured') window.cap = d
        if (d.links) window.links = d.links.map((l) => l.path)
      })
      window.capture = () => document.getElementById('f').contentWindow.postMessage({ dshDesign: 1, type: 'capture', id: 1, scale: 1 }, '*')
      window.files = () => document.getElementById('f').contentWindow.postMessage({ dshDesign: 1, type: 'files', file: '', files: [] }, '*')
    </script>`)
  })
  await new Promise((r) => outer.listen(0, '127.0.0.1', r))
  const outerOrigin = `http://127.0.0.1:${outer.address().port}`
  const hr = createHub({ parents: () => [outerOrigin] })
  const er = await hr.open({ kind: 'file', root: path.join(tmp, 'relay') })
  preview = er.origin + '/'
  const b = createBrowser({ bin })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    const on = await b.withPage({ url: outerOrigin + '/?relay=1', w: 600, h: 400 }, async (page) => {
      await wait(3800)
      const n = hr.listeners()
      await page.eval('window.files()')
      await wait(400)
      return { n, got: await page.eval('window.got') }
    })
    check('右侧栏转告：页面没开改动通知（过了 3 秒也没开）', on.n === 0, JSON.stringify(on))
    check('右侧栏转告：转来的改动页面照常回 changed', on.got.includes('hello') && on.got.includes('changed'), JSON.stringify(on.got))
    const old = await b.withPage({ url: outerOrigin + '/?relay=0', w: 600, h: 400 }, async () => { await wait(3800); return hr.listeners() })
    check('老版右侧栏（不说 relay）：3 秒后页面自己开改动通知', old === 1, String(old))
    const lk = await b.withPage({ url: outerOrigin + '/?relay=1&page=bar.html', w: 600, h: 400 }, async (page) => {
      for (let i = 0; i < 40 && !(await page.eval('!!window.links')); i++) await wait(150)
      await wait(300)
      return page.eval('window.links')
    })
    check('连线：被固定底栏盖住的按钮不报（看不见），底栏里的照报', JSON.stringify(lk) === '["/b.html","/d.html"]', JSON.stringify(lk))
    const px = await b.withPage({ url: outerOrigin + '/?relay=1&page=icon.html', w: 600, h: 400 }, async (page) => {
      await wait(1200)
      await page.eval('window.capture()')
      for (let i = 0; i < 40 && !(await page.eval('!!window.cap')); i++) await wait(150)
      return page.eval(`(async () => {
        const c = window.cap
        if (!c || !c.png) return { error: c && c.error }
        const im = await createImageBitmap(c.png)
        const cv = document.createElement('canvas')
        cv.width = im.width; cv.height = im.height
        const g = cv.getContext('2d')
        g.drawImage(im, 0, 0)
        return { px: [...g.getImageData(20, 20, 1, 1).data].slice(0, 3) }
      })()`)
    })
    check('导出：外部 icons.svg 里的图标画进图里', px.px && px.px[0] > 200 && px.px[1] < 60 && px.px[2] < 60, JSON.stringify(px))
  } finally {
    b.stop()
    hr.closeAll()
    outer.close()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
// ── 边写边看：草稿一边写一边吐 ──
{
  const { createDrafts, createJsonStringDecoder } = await import('../lib/draft.js')
  const { draftInjector } = await import('../lib/serve.js')
  const dec = createJsonStringDecoder()
  const got = ['<p>你好\\', 'n', '世界 \\u4e', '2d \\"q\\"', ' \\ud83d', '\\ude00', '!"}', 'more'].map((x) => dec.push(x))
  check('JSON 字符串流式还原：转义被切在两块中间、\\u 被切开、表情两半分开来都对，收尾引号后不再吐', got.join('') === '<p>你好\n世界 中 "q" 😀!' && dec.done && got[4] === ' ' && got[7] === '', JSON.stringify(got))
  const TAG = '<script src="/__dsh_design__/draft.js"></script>'
  const a = draftInjector(TAG)
  const a1 = [a.push('  <!do'), a.push('ctype html><p>'), a.push('x')]
  check('草稿脚本插在 doctype 后面（doctype 被切成两块也认）', a1[0] === '' && a1[1] === '  <!doctype html>' + TAG + '<p>' && a1[2] === 'x' && a.flush() === '', JSON.stringify(a1))
  const b = draftInjector(TAG)
  check('没写 doctype → 插在最前面', b.push('<p>hi') === TAG + '<p>hi')
  const c = draftInjector(TAG)
  check('一直只有空白就写完了 → 收尾时补上', c.push('\n') === '' && c.flush() === TAG + '\n')

  const drafts = createDrafts()
  const hd = createHub({ drafts })
  const dsite = path.join(tmp, 'dsite')
  fs.mkdirSync(dsite, { recursive: true })
  fs.writeFileSync(path.join(dsite, 'tokens.css'), ':root{--brand:#c2410c}')
  const { origin: dor } = await hd.open({ kind: 'file', root: dsite })
  const abs = path.join(dsite, '新 页.html')
  drafts.begin(abs)
  drafts.push(abs, '<!doctype html><html><head><link rel="stylesheet" href="tokens.css">')
  const chunks = []
  const t0 = Date.now()
  const streamed = new Promise((resolve, reject) => {
    const u = new URL(`${dor}/${encodeURIComponent('新 页.html')}?__ddp_draft=1`)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => chunks.push({ at: Date.now() - t0, d }))
      res.on('end', () => resolve(res))
    })
    req.on('error', reject)
    req.end()
  })
  await new Promise((r) => setTimeout(r, 150))
  drafts.push(abs, '</head><body><h1>巷口')
  await new Promise((r) => setTimeout(r, 150))
  drafts.push(abs, '面馆</h1>')
  drafts.end(abs)
  const res = await streamed
  const body = chunks.map((x) => x.d).join('')
  check('草稿地址：先吐已经写到的（插上草稿脚本），之后来一截吐一截，写完收尾', res.statusCode === 200 && /text\/html/.test(res.headers['content-type']) && body === '<!doctype html>' + TAG + '<html><head><link rel="stylesheet" href="tokens.css"></head><body><h1>巷口面馆</h1>', JSON.stringify(body))
  check('草稿地址：真的是边写边到（第一块在写完之前就到了）', chunks.length >= 2 && chunks[0].at < 120, JSON.stringify(chunks.map((x) => x.at)))
  check('草稿地址：不缓存', /no-store/.test(res.headers['cache-control'] || ''))
  const done2 = await get(`${dor}/${encodeURIComponent('新 页.html')}?__ddp_draft=1`)
  check('草稿写完了再来拿 → 一次给全', done2.status === 200 && done2.body.endsWith('<h1>巷口面馆</h1>'))
  check('没在写的文件 → 404', (await get(`${dor}/nope.html?__ddp_draft=1`)).status === 404)
  check('草稿地址跳不出根目录', (await get(`${dor}/..%2F..%2Fsecret.html?__ddp_draft=1`)).status === 404)
  fs.writeFileSync(path.join(dsite, 'done.html'), '<!doctype html><p>真文件</p>')
  const real = await get(`${dor}/done.html?__ddp_draft=9`)
  check('草稿已经收走了（写完了）→ 给真文件', real.status === 200 && real.body.includes('真文件') && real.body.includes('picker.js'), real.body.slice(0, 80))
  const js = await get(`${dor}/__dsh_design__/draft.js`)
  check('草稿脚本：JS 类型、里面是跟着往下滚和三只鼠标', js.status === 200 && /javascript/.test(js.headers['content-type']) && js.body.includes('__ddpDraft') && js.body.includes('dshDraft'))
  check('草稿页里还能拿到同目录的样式（相对地址照常走）', (await get(`${dor}/tokens.css`)).body.includes('--brand'))
  // 正文先到的草稿挂在设计文件夹里一个临时名字上（文件不存在）：照样给
  const prov = path.join(dsite, '__ddp_draft_1__.html')
  drafts.begin(prov)
  drafts.push(prov, '<!doctype html><p>正文先到')
  drafts.end(prov)
  const pv = await get(`${dor}/__ddp_draft_1__.html?__ddp_draft=2`)
  check('临时名字上的草稿 → 照样给（插上草稿脚本）', pv.status === 200 && pv.body.includes('正文先到') && pv.body.includes('draft.js'), pv.body.slice(0, 80))
  // 整页一下子到：一截截放出来（几秒放完），<head> 里的样式一口气给
  const lump = path.join(dsite, 'lump.html')
  const head = '<!doctype html><html><head><style>' + 'b{color:red}'.repeat(400) + '</style></head><body>'
  const bodyText = '<p>一段字</p>'.repeat(600)
  drafts.begin(lump)
  drafts.push(lump, head + bodyText + '</body></html>')
  drafts.end(lump)
  const lc = []
  const lt0 = Date.now()
  await new Promise((resolve, reject) => {
    const u = new URL(`${dor}/lump.html?__ddp_draft=3`)
    http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => lc.push({ at: Date.now() - lt0, d }))
      res.on('end', resolve)
    }).on('error', reject).end()
  })
  const lbody = lc.map((x) => x.d).join('')
  const span = lc[lc.length - 1].at - lc[0].at
  check('整页一下子到 → 一截截放（好几截、拉开一两秒以上），拼起来一字不差', lc.length >= 10 && span >= 1500 && span < 9000 && lbody === head.replace('<!doctype html>', '<!doctype html>' + TAG) + bodyText + '</body></html>', JSON.stringify({ n: lc.length, span }))
  check('整页一下子到 → <head> 里的样式和 <body> 开头头一截就全给了（看不见的不用等）', lc[0].d.includes('<body>') && lc[0].d.length < head.length + TAG.length + 400, String(lc[0].d.length))
  // 开着看的时候整页才一块到、紧跟着写完 → 慢放；流到一半来了一大块（还没写完）→ 照样马上给
  const live2 = path.join(dsite, 'live2.html')
  drafts.begin(live2)
  drafts.push(live2, '<!doctype html><html><head></head><body>')
  const lc2 = []
  let l2End = 0
  const l2done = new Promise((resolve, reject) => {
    const u = new URL(`${dor}/live2.html?__ddp_draft=5`)
    http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => lc2.push({ at: Date.now(), d }))
      res.on('end', () => { l2End = Date.now(); resolve() })
    }).on('error', reject).end()
  })
  await new Promise((r) => setTimeout(r, 80))
  const bigMid = '<p>中途一大块</p>'.repeat(200)
  const tMid = Date.now()
  drafts.push(live2, bigMid)
  await new Promise((r) => setTimeout(r, 120))
  const gotMid = lc2.filter((x) => x.at >= tMid).map((x) => x.d).join('')
  check('流到一半来了一大块（还没写完）→ 马上整块给，不慢放', gotMid.includes(bigMid), String(gotMid.length))
  const tail = '<p>最后整段</p>'.repeat(400)
  const tLump = Date.now()
  drafts.push(live2, tail)
  drafts.end(live2)
  await l2done
  check('开着看时最后一大块到了紧跟着就写完（整页憋到最后给）→ 慢放（拉开一两秒）', l2End - tLump >= 1500 && lc2.map((x) => x.d).join('').endsWith(tail), String(l2End - tLump))
  // 一点点流得很快（每 20ms 来 300 字 ≈ 每秒 1.5 万字）：来多少吐多少，写完时不落在后头
  const fast = path.join(dsite, 'fast.html')
  drafts.begin(fast)
  drafts.push(fast, '<!doctype html><html><head></head><body>' + '<p>早就写好的</p>'.repeat(300))
  const fc = []
  const ft0 = Date.now()
  let fEnd = 0
  const fdone = new Promise((resolve, reject) => {
    const u = new URL(`${dor}/fast.html?__ddp_draft=4`)
    http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => fc.push(d))
      res.on('end', () => { fEnd = Date.now(); resolve() })
    }).on('error', reject).end()
  })
  await new Promise((r) => setTimeout(r, 60))
  for (let i = 0; i < 40; i++) {
    drafts.push(fast, `<p>${String(i).padStart(2, '0')}${'字'.repeat(290)}</p>`)
    await new Promise((r) => setTimeout(r, 20))
  }
  const fPushed = Date.now()
  drafts.end(fast)
  await fdone
  check('右侧栏中途才来看（前面已经写了一大段、还在写）→ 写到的一口气先给，不慢放', fc.slice(0, 2).join('').includes('<p>早就写好的</p>'.repeat(300)), JSON.stringify(fc.slice(0, 3).map((x) => x.length)))
  check('一点点流得很快 → 不排队、写完马上收尾（不落后）', fEnd - fPushed < 200 && fc.join('').includes('39' + '字'.repeat(290)), JSON.stringify({ lag: fEnd - fPushed, took: fEnd - ft0 }))
  // 一路流着写完的（拉开一两秒）→ 不算整段到的；右侧栏换了个框事后再看（第一屏落地时等待卡片换成单屏）→ 一口气给，不再放一遍
  check('整段一下子到的草稿记着 lump', drafts.get(lump).lump === true)
  const slow = path.join(dsite, 'slow.html')
  drafts.begin(slow)
  drafts.push(slow, '<!doctype html><html><head></head><body>')
  for (let i = 0; i < 18; i++) {
    drafts.push(slow, `<p>${'慢'.repeat(200)}</p>`)
    await new Promise((r) => setTimeout(r, 100))
  }
  drafts.end(slow)
  check('一路流着写完的草稿不算 lump', drafts.get(slow).lump === false)
  const sc = []
  const st0 = Date.now()
  let sEnd = 0
  await new Promise((resolve, reject) => {
    const u = new URL(`${dor}/slow.html?__ddp_draft=6`)
    http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host } }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => sc.push(d))
      res.on('end', () => { sEnd = Date.now(); resolve() })
    }).on('error', reject).end()
  })
  check('一路流着写完的、事后再来看 → 一口气给完，不慢放', sEnd - st0 < 300 && sc.join('').split('慢'.repeat(200)).length === 19, JSON.stringify({ took: sEnd - st0, n: sc.length }))
  hd.closeAll()
}

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
