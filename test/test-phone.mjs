/**
 * 手机上看的测试（不用开 DSH、不用真手机）：
 *   node test/test-phone.mjs
 *
 * 二维码：尺寸、定位图案、格式信息、太长报错；
 * 局域网入口：挑网卡、补 viewport、口令换 Cookie、没口令 403、Host 不对 403、转发、跟随跳屏、WebSocket、关掉、闲置自动关。
 */
import http from 'node:http'
import net from 'node:net'
import { qrMatrix, qrPath, formatBits } from '../lib/qr.js'
import { createPhone, lanAddress, phoneHtml, PHONE } from '../lib/phone.js'

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 二维码 ──────────────────────────────────────────────────────────────────

{
  const m = qrMatrix('hello')
  check('短内容是版本 1（21×21）', m.length === 21 && m.every((r) => r.length === 21))
  const finder = (x0, y0) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
        if (m[y0 + dy][x0 + dx] !== (d !== 2)) return false
      }
    }
    return true
  }
  check('三个角都有定位图案', finder(0, 0) && finder(14, 0) && finder(0, 14))
  check('时序图案黑白相间', [8, 9, 10, 11, 12].every((i) => m[6][i] === (i % 2 === 0) && m[i][6] === (i % 2 === 0)))
  check('左下角固定黑块', m[21 - 8][8] === true)
  // 格式信息读回来是 M 级 + 某个掩码
  let bits = 0
  for (let i = 0; i <= 5; i++) bits |= (m[i][8] ? 1 : 0) << i
  bits |= (m[7][8] ? 1 : 0) << 6
  bits |= (m[8][8] ? 1 : 0) << 7
  bits |= (m[8][7] ? 1 : 0) << 8
  for (let i = 9; i < 15; i++) bits |= (m[8][14 - i] ? 1 : 0) << i
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => formatBits(k) === bits)
  check('格式信息是 M 级加一个合法掩码', mask !== undefined, bits.toString(2))
  check('M 级掩码 0 的格式码是标准值 101010000010010', formatBits(0) === 0b101010000010010)
}
{
  const link = 'http://192.168.31.208:51234/%E7%99%BB%E5%BD%95.html?k=' + 'A'.repeat(22)
  const m = qrMatrix(link)
  check('局域网链接放得下（版本 ≤ 5）', m.length >= 21 && m.length <= 37, String(m.length))
  check('同一内容结果稳定', JSON.stringify(m) === JSON.stringify(qrMatrix(link)))
  const big = qrMatrix('x'.repeat(200))
  check('长内容用到版本 10（57×57）', big.length === 57)
  let threw = false
  try { qrMatrix('x'.repeat(300)) } catch { threw = true }
  check('超过版本 10 报错', threw)
  check('SVG 路径每个黑块一个方块', qrPath(m).split('M').length - 1 === m.flat().filter(Boolean).length)
}

// ── 挑网卡 ──────────────────────────────────────────────────────────────────

{
  const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal })
  check('挑 Wi-Fi 的私有地址', lanAddress({ lo0: [v4('127.0.0.1', true)], utun3: [v4('10.8.0.2')], en0: [v4('192.168.1.8')] }) === '192.168.1.8')
  check('跳过 169.254 和 IPv6', lanAddress({ en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, v4('169.254.3.4')], en1: [v4('10.0.0.5')] }) === '10.0.0.5')
  check('私有地址优先于公网地址', lanAddress({ en0: [v4('8.8.8.8')], en1: [v4('172.20.1.2')] }) === '172.20.1.2')
  check('只有虚拟网卡也能用', lanAddress({ bridge100: [v4('192.168.64.1')] }) === '192.168.64.1')
  check('没网给空', lanAddress({ lo0: [v4('127.0.0.1', true)] }) === '')
}

// ── 补 viewport / 插脚本 ─────────────────────────────────────────────────────

{
  const out = phoneHtml('<html><head><title>a</title></head><body><p>x</p></body></html>')
  check('没 viewport 补上', /<head><meta name="viewport"/.test(out))
  check('跟随脚本插在 </body> 前', out.includes(`<script src="${PHONE}follow.js"></script></body>`))
  const has = phoneHtml('<head><meta name="viewport" content="width=390"></head><body></body>')
  check('有 viewport 不动', (has.match(/name="viewport"/g) || []).length === 1 && has.includes('width=390'))
  check('没 body 也接在最后', phoneHtml('<p>hi</p>').endsWith('follow.js"></script>'))
}

// ── 局域网入口 ──────────────────────────────────────────────────────────────

// 假的预览服务器：HTML、CSS、跳转、回显请求头、WebSocket 回显
const seenHeaders = []
const upstream = http.createServer((req, res) => {
  seenHeaders.push({ url: req.url, ...req.headers })
  if (req.url.startsWith('/a.css')) { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end('h1{color:red}') }
  if (req.url === '/go') { res.writeHead(302, { Location: `http://127.0.0.1:${upstream.address().port}/b.html` }); return res.end() }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '41' })
  res.end('<html><head></head><body>hi</body></html>')
})
upstream.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  socket.on('data', (d) => socket.write('echo:' + d))
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upOrigin = `http://127.0.0.1:${upstream.address().port}`

let clock = 1000
const origins = { s1: upOrigin, s2: '' }
const phone = createPhone({ upstream: (s) => origins[s] || '', address: () => '127.0.0.1', now: () => clock, idleMs: 200 })

{
  const off = createPhone({ upstream: () => upOrigin, address: () => '' })
  const r = await off.start('x', '/')
  check('没局域网地址：不开、说清楚', r.on === false && r.error === 'no-lan')
}

const st = await phone.start('s1', '/首页.html')
check('打开后给链接', st.on && /^http:\/\/127\.0\.0\.1:\d+\/%E9%A6%96%E9%A1%B5\.html\?k=[\w-]{22}$/.test(st.url), st.url)
check('再开一次沿用同一个链接', (await phone.start('s1', '/首页.html')).url === st.url)
const base = `http://127.0.0.1:${st.port}`
const token = new URL(st.url).searchParams.get('k')

{
  const r = await get(base + '/a.html')
  check('没口令 403，给手机看的提示页', r.status === 403 && r.body.includes('链接失效了'))
  const r2 = await get(base + '/a.html?k=wrong')
  check('口令不对 403', r2.status === 403)
  const r3 = await get(`${base}/a.html?k=${token}`, { headers: { host: `localhost:${st.port}` } })
  check('Host 不对 403（防 DNS 重绑）', r3.status === 403)
}

let cookie = ''
{
  const r = await get(`${base}/%E9%A6%96%E9%A1%B5.html?x=1&k=${token}`)
  cookie = String(r.headers['set-cookie'] || '').split(';')[0]
  check('口令换 Cookie 再跳回不带口令的地址', r.status === 302 && r.headers.location === '/%E9%A6%96%E9%A1%B5.html?x=1', r.headers.location)
  check('Cookie 只给 HTTP、按端口分开', cookie === `ddp_phone_${st.port}=${token}` && /HttpOnly/.test(r.headers['set-cookie']) && /SameSite=Lax/.test(r.headers['set-cookie']))
  const r2 = await get(`${base}//evil.example/x?k=${token}`)
  check('跳转不会跳到别的网站', r2.status === 302 && /^\/(?!\/)/.test(r2.headers.location), r2.headers.location)
}

{
  check('还没人打开时 seen 是 0', phone.status('s1').seen === 0)
  const r = await get(base + '/a.html', { headers: { cookie: `theme=dark; ${cookie}`, accept: 'text/html', origin: base, referer: base + '/x.html' } })
  check('带 Cookie 能打开，转发到预览服务器', r.status === 200 && r.body.includes('hi'))
  check('HTML 补了 viewport 和跟随脚本', r.body.includes('name="viewport"') && r.body.includes('follow.js'))
  check('改过 HTML 后长度不对的头去掉了', r.headers['content-length'] === undefined)
  const h = seenHeaders.at(-1)
  check('往下转发时 Host / Origin / Referer 换成预览服务器的', h.host === `127.0.0.1:${upstream.address().port}` && h.origin === upOrigin && h.referer === upOrigin + '/x.html')
  check('口令 Cookie 不往下传，别的 Cookie 照传', h.cookie === 'theme=dark')
  check('手机打开了：seen 记上', phone.status('s1').seen === 1)
  const css = await get(base + '/a.css', { headers: { cookie } })
  check('CSS 原样转发', css.status === 200 && css.body === 'h1{color:red}')
  const go = await get(base + '/go', { headers: { cookie } })
  check('预览服务器的跳转地址改成相对的', go.status === 302 && go.headers.location === '/b.html', go.headers.location)
  const js = await get(base + PHONE + 'follow.js', { headers: { cookie } })
  check('跟随脚本能拿到', js.status === 200 && js.body.includes('EventSource'))
}

{
  // 跟随：手机连着事件流，电脑上换一屏，手机收到 goto
  const got = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: st.port, path: PHONE + 'events', headers: { host: `127.0.0.1:${st.port}`, cookie } }, (res) => {
      let buf = ''
      res.on('data', (c) => {
        buf += c
        if (buf.includes('event: goto')) { resolve(buf); req.destroy() }
      })
      setTimeout(() => {
        check('乱给的路径不跳', phone.follow('s1', '//evil.example') === false && phone.follow('s1', 'http://x') === false)
        phone.follow('s1', '/设置.html')
      }, 50)
    })
    req.end()
    setTimeout(() => resolve(''), 2000)
  })
  check('电脑上换屏，手机收到跳转', got.includes('"path":"/%E8%AE%BE%E7%BD%AE.html"'), got)
  check('没开的会话 follow 不报错', phone.follow('nope', '/a.html') === false)
}

{
  // WebSocket：带 Cookie 才转，转过去能来回说话
  const talk = (withCookie) => new Promise((resolve) => {
    const c = net.connect(st.port, '127.0.0.1', () => {
      c.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${st.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${withCookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`)
    })
    let buf = ''
    c.on('data', (d) => {
      buf += d
      if (buf.includes('\r\n\r\n') && !buf.includes('echo:')) c.write('ping')
      if (buf.includes('echo:ping')) { c.destroy(); resolve(buf) }
    })
    c.on('close', () => resolve(buf))
    setTimeout(() => { c.destroy(); resolve(buf) }, 1500)
  })
  check('WebSocket 带 Cookie 能通', (await talk(true)).includes('echo:ping'))
  check('WebSocket 没 Cookie 直接断', (await talk(false)) === '')
}

{
  const s2 = await phone.start('s2', '/')
  const k2 = new URL(s2.url).searchParams.get('k')
  check('两个会话各开各的端口和口令', s2.port !== st.port && k2 !== token)
  const r = await get(`http://127.0.0.1:${s2.port}/`, { headers: { cookie: `ddp_phone_${s2.port}=${k2}` } })
  check('会话没在预览时 503', r.status === 503)
  const cross = await get(`http://127.0.0.1:${s2.port}/`, { headers: { cookie } })
  check('别的会话的 Cookie 进不来', cross.status === 403)
  phone.stop('s2')
}

{
  phone.stop('s1')
  check('关掉后状态是 off', phone.status('s1').on === false)
  let refused = false
  try { await get(base + '/a.html', { headers: { cookie } }) } catch { refused = true }
  check('关掉后端口不再接受连接', refused)
  const again = await phone.start('s1', '/')
  check('关掉再开换新口令', new URL(again.url).searchParams.get('k') !== token)
  clock += 1000
  await wait(350)
  check('闲置超时自动关', phone.status('s1').on === false)
}

{
  // 手机页面开着（跟随通道连着）不算闲置
  const s3 = await phone.start('s3', '/')
  origins.s3 = upOrigin
  const k3 = new URL(s3.url).searchParams.get('k')
  const req = http.request({ host: '127.0.0.1', port: s3.port, path: PHONE + 'events', headers: { host: `127.0.0.1:${s3.port}`, cookie: `ddp_phone_${s3.port}=${k3}` } }, () => {})
  req.end()
  await wait(80)
  clock += 1000
  await wait(350)
  check('手机开着就不自动关', phone.status('s3').on === true)
  req.destroy()
  await wait(50)
  clock += 1000
  await wait(350)
  check('手机关了页面，过一阵自动关', phone.status('s3').on === false)
}

phone.stopAll()
upstream.close()
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
