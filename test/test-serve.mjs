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
import { createHub, hostOk, injectPicker, resolveInRoot } from '../lib/serve.js'

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

// 纯函数
check('injectPicker：插在 </body> 前', injectPicker('<body>x</body>').endsWith('<script src="/__dsh_design__/picker.js"></script></body>'))
check('injectPicker：没有 body 就接在末尾', injectPicker('<p>x').endsWith('picker.js"></script>'))
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
r = await get(a.origin + '/index.html', { headers: { host: 'evil.example:' + new URL(a.origin).port } })
check('文件：Host 不对 → 403（防 DNS 重绑定）', r.status === 403)
r = await get(a.origin + '/nope.html')
check('文件：找不到 → 404 提示页', r.status === 404 && r.body.includes('找不到'))
r = await get(a.origin + '/__dsh_design__/picker.js')
check('文件：选取脚本带上配置（live）', r.status === 200 && r.body.startsWith('window.__DSH_DESIGN__={"live":true}'))
const again = await hub.open({ kind: 'file', root: site })
check('同一个目录复用同一个服务器', again.origin === a.origin && hub.size() === 1)

// SSE：改文件推 change
const sse = await new Promise((resolve) => {
  const u = new URL(a.origin + '/__dsh_design__/events')
  const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: u.host } }, (res) => {
    let buf = ''
    res.on('data', (c) => {
      buf += c
      if (buf.includes('event: change')) { resolve(buf); req.destroy() }
    })
    setTimeout(() => fs.writeFileSync(path.join(site, 'css', 'a.css'), 'h1{color:blue}'), 150)
    setTimeout(() => { resolve(buf); req.destroy() }, 3000)
  })
})
check('文件：改了 CSS → SSE 推 change', sse.includes('event: change') && sse.includes('a.css'), JSON.stringify(sse))
check('文件：改动也通知到 hub（让右侧栏知道）', changes.some((c) => c.key === 'file:' + site && c.file.endsWith('a.css')), JSON.stringify(changes))

// ── 开发服务器 ──
const upstreamSeen = []
const dev = http.createServer((req, res) => {
  upstreamSeen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, ae: req.headers['accept-encoding'] })
  if (req.url === '/go') { res.writeHead(302, { Location: `http://localhost:${dev.address().port}/there` }); return res.end() }
  if (req.url === '/api') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":1}') }
  res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" })
  res.end('<html><body><div id="app">dev</div></body></html>')
})
dev.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Seen-Host: ${req.headers.host}\r\nX-Seen-Origin: ${req.headers.origin}\r\n\r\n`)
  socket.on('data', (d) => socket.write(d)) // 回声
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
check('代理：选取脚本 live=false（交给热更新）', r.body.startsWith('window.__DSH_DESIGN__={"live":false}'))

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
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
