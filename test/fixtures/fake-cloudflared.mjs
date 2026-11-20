// 测试用的假 cloudflared：照真的那样往 stderr 打链接和「连上了」，不联网。
// FAKE_CF_MODE：ok（默认）/ fail（起不来）/ hang（给了链接但一直连不上）/ drop（连上一会儿进程就退了）
//               / flap（连上后断开 FAKE_CF_DOWN_MS 毫秒又连回来，进程不退）/ lost（连上后断开再也连不回来，进程不退）
//               / quiet（连上了但日志里不说「Registered」，只有状态口知道：模拟以后的版本改了措辞）
// 带 --metrics 127.0.0.1:0 时也像真的一样开状态口：GET /ready 连着回 200、断着回 503
import fs from 'node:fs'
import http from 'node:http'
const mode = process.env.FAKE_CF_MODE || 'ok'
if (process.env.FAKE_CF_PIDFILE) fs.writeFileSync(process.env.FAKE_CF_PIDFILE, String(process.pid))
const log = (s) => process.stderr.write(`2026-11-21T00:00:00Z ${s}\n`)
let connected = false
const mi = process.argv.indexOf('--metrics')
if (mi > 0) {
  const srv = http.createServer((req, res) => {
    const code = req.url === '/ready' && connected ? 200 : 503
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: code, readyConnections: connected ? 1 : 0 }))
  })
  srv.listen(0, '127.0.0.1', () => log(`INF Starting metrics server on 127.0.0.1:${srv.address().port}/metrics`))
}
log('INF Requesting new quick Tunnel on trycloudflare.com...')
if (mode === 'fail') {
  log('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: i/o timeout')
  process.exit(1)
}
log('INF +--------------------------------------------------------------------------------------------+')
log('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |')
log('INF |  https://quiet-river-test-moon.trycloudflare.com                                           |')
log('INF +--------------------------------------------------------------------------------------------+')
if (mode !== 'hang') {
  setTimeout(() => {
    connected = true
    if (mode !== 'quiet') log('INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.13 location=nrt01 protocol=http2')
  }, 150)
}
if (mode === 'drop') setTimeout(() => process.exit(0), 600)
if (mode === 'flap' || mode === 'lost') {
  setTimeout(() => {
    connected = false
    log('ERR Connection terminated error="there are no free edge addresses left to resolve to" connIndex=0')
    if (mode === 'flap') setTimeout(() => { connected = true; log('INF Registered tunnel connection connIndex=0 connection=def event=0') }, Number(process.env.FAKE_CF_DOWN_MS || 800))
  }, 500)
}
process.on('SIGTERM', () => process.exit(0))
setInterval(() => {}, 1000)
