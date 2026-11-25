/**
 * 公网链接（#27）的测试（不联网，用 fixtures/fake-cloudflared.mjs 假装通道）：
 *   node test/test-tunnel.mjs
 *
 * 找 cloudflared；只放一个地址的小服务（口令、404、304、gzip、文件改了重新打包、没有 CSP）；
 * 起通道、连上、到点自动关、手动关（通道进程真没了）、起不来 / 连不上 / 断了；断了一会儿又连回来（链接不变）、
 * 断太久关掉；换了设计 / 电脑睡过头（定时器没走）有人打开时关掉；打包失败不每次重打；下载卡住 / 取消；
 * 插件被强行杀掉，通道进程跟着没了。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findCloudflared, createPublicShare, launchWatched, URL_RE, assetFor, downloadCloudflared } from '../lib/tunnel.js'
import { MAX_TOTAL as PACK_FILE_MAX } from '../lib/bundle.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const here = path.dirname(fileURLToPath(import.meta.url))
const FAKE = path.join(here, 'fixtures', 'fake-cloudflared.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-tunnel-'))
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v || Date.now() > end) return v
    await sleep(50)
  }
}
const get = (port, p, headers = {}, method = 'GET') => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
    const chunks = []
    res.on('data', (d) => chunks.push(d))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  })
  r.on('error', (e) => resolve({ status: 0, error: e.code }))
  r.end()
})

// ── 找 cloudflared ──
{
  const has = (set) => (f) => set.has(f)
  check('找 cloudflared：PATH 里有就用', findCloudflared({ env: { PATH: '/x/bin:/y/bin' }, platform: 'darwin', exists: has(new Set(['/y/bin/cloudflared'])), home: '/Users/a' }) === '/y/bin/cloudflared')
  check('找 cloudflared：从访达打开的 DSH（PATH 里没有 Homebrew）也找得到', findCloudflared({ env: { PATH: '/usr/bin:/bin' }, platform: 'darwin', exists: has(new Set(['/opt/homebrew/bin/cloudflared'])), home: '/Users/a' }) === '/opt/homebrew/bin/cloudflared')
  check('找 cloudflared：Windows 用 winget 装的', findCloudflared({ env: { Path: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, platform: 'win32', exists: has(new Set(['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'])), home: 'C:\\Users\\a' }) === 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe')
  check('找 cloudflared：先用插件自己下的，再用「手机端」插件下的', findCloudflared({ env: { PATH: '/usr/local/bin' }, platform: 'darwin', exists: has(new Set(['/Users/a/.dsh/dsh-mobile/bin/cloudflared', '/usr/local/bin/cloudflared'])), home: '/Users/a' }) === '/Users/a/.dsh/dsh-mobile/bin/cloudflared'
    && findCloudflared({ env: {}, platform: 'darwin', exists: has(new Set(['/d/bin/cloudflared', '/Users/a/.dsh/dsh-mobile/bin/cloudflared'])), home: '/Users/a', own: '/d' }) === '/d/bin/cloudflared')
  check('找 cloudflared：没装给空', findCloudflared({ env: { PATH: '/usr/bin' }, platform: 'darwin', exists: () => false, home: '/Users/a' }) === '')
  check('链接：认 xxx.trycloudflare.com，不认申请通道用的 api.trycloudflare.com', URL_RE.exec('Post "https://api.trycloudflare.com/tunnel"') === null && URL_RE.exec('|  https://quiet-river.trycloudflare.com   |')[1] === 'quiet-river.trycloudflare.com')
}

// ── 小服务 + 通道 ──
const page = path.join(tmp, 'home.html')
fs.writeFileSync(page, '<p>v1</p>')
let builds = 0
const build = (p) => {
  builds++
  if (p.boom) throw Object.assign(new Error('too big'), { code: 'tooBig' })
  return { html: `<!doctype html><title>${p.title}</title>` + fs.readFileSync(page, 'utf8'), deps: [page, path.join(tmp, 'later.css')] }
}
const pidFile = path.join(tmp, 'cf.pid')
const make = (mode = 'ok', { env = {}, ...extra } = {}) => createPublicShare({
  build,
  find: () => process.execPath,
  launch: (bin, args) => launchWatched(bin, [FAKE, ...args], { env: { ...process.env, FAKE_CF_MODE: mode, FAKE_CF_PIDFILE: pidFile, ...env } }),
  config: () => path.join(tmp, 'cf.yml'),
  ...extra,
})

{
  const pub = make()
  let st = await pub.start('s1', { title: '咖啡', root: tmp }, { name: '咖啡' })
  check('开：先是「正在连」，还没有链接', st.on && st.state === 'starting' && !st.url, JSON.stringify(st))
  st = await until(() => { const x = pub.status('s1'); return x.state === 'ready' ? x : null })
  const ins = pub._inspect('s1')
  check('连上了：链接是 https://xxx.trycloudflare.com/<口令>', !!st && /^https:\/\/quiet-river-test-moon\.trycloudflare\.com\/[\w-]{20,}$/.test(st.url) && st.url.endsWith('/' + ins.token), JSON.stringify(st))
  check('状态里有到期时间（约 2 小时后）和设计名', st && Math.abs(st.expires - Date.now() - 2 * 3600 * 1000) < 10000 && st.name === '咖啡')
  check('通道进程起来了（看门进程报了它的 pid）', alive(ins.pid) && Number(fs.readFileSync(pidFile, 'utf8')) === ins.pid)
  check('cloudflared 的状态口只开在本机、端口它自己挑（日志里认出来了）', /^127\.0\.0\.1:\d+$/.test(ins.metrics), ins.metrics)

  let r = await get(ins.port, '/' + ins.token)
  check('口令地址：200、是那份演示', r.status === 200 && /<title>咖啡<\/title><p>v1<\/p>/.test(r.body.toString()) && /text\/html/.test(r.headers['content-type']))
  check('响应头：不带 CSP（不然每屏的内联脚本跑不了）、不带来源、不让搜索引擎收、不让别的网站嵌', !r.headers['content-security-policy'] && r.headers['referrer-policy'] === 'no-referrer' && /noindex/.test(r.headers['x-robots-tag']) && r.headers['x-frame-options'] === 'DENY')
  check('不缓存旧的：no-cache + ETag', r.headers['cache-control'] === 'no-cache' && !!r.headers.etag)
  const etag = r.headers.etag
  r = await get(ins.port, '/' + ins.token + '/', { 'accept-encoding': 'gzip, br' })
  check('浏览器要 gzip 就给 gzip', r.status === 200 && r.headers['content-encoding'] === 'gzip' && /v1/.test(zlib.gunzipSync(r.body).toString()))
  r = await get(ins.port, '/' + ins.token, { 'if-none-match': etag })
  check('没改：304', r.status === 304)
  for (const p of ['/', '/favicon.ico', '/' + ins.token + 'x', '/' + ins.token + '/../etc/passwd', '/' + ins.token.slice(0, -1), '/' + ins.token + '/home.html', '/%2e%2e/package.json']) {
    r = await get(ins.port, p)
    if (r.status !== 404) { check(`别的地址一律 404：${p}`, false, String(r.status)); break }
  }
  check('别的地址（根、猜口令、带路径、../）一律 404', r.status === 404)
  r = await get(ins.port, '/' + ins.token, {}, 'POST')
  check('别的请求方法也 404', r.status === 404)
  r = await get(ins.port, '/' + ins.token, {}, 'HEAD')
  check('HEAD 可以（不计次数）', r.status === 200 && r.body.length === 0)

  const b0 = builds
  r = await get(ins.port, '/' + ins.token)
  check('文件没改：不重新打包', builds === b0 && /v1/.test(r.body.toString()))
  await sleep(1600)
  fs.writeFileSync(page, '<p>v2 改过了</p>')
  r = await get(ins.port, '/' + ins.token)
  check('文件改了：对方刷新就是新的', /v2 改过了/.test(r.body.toString()) && builds === b0 + 1 && r.headers.etag !== etag)
  await sleep(1600)
  fs.writeFileSync(path.join(tmp, 'later.css'), 'p{}')
  await get(ins.port, '/' + ins.token)
  check('原来没有的文件后来加了：也重新打包', builds === b0 + 2)
  check('打开次数（GET 才算）', pub.status('s1').views === 5, String(pub.status('s1').views))

  pub.update('s1', { title: '咖啡外带', root: tmp })
  r = await get(ins.port, '/' + ins.token)
  check('右侧栏换了参数：下次打开按新的', /<title>咖啡外带<\/title>/.test(r.body.toString()))
  check('换参数时换了设计（root 不一样）：不跟着换', pub.update('s1', { title: '别的设计', root: '/other' }) === false && /<title>咖啡外带<\/title>/.test((await get(ins.port, '/' + ins.token)).body.toString()))
  st = await pub.start('s1', { title: '再点一次', root: tmp })
  check('开着再点「开」：不新开通道、只换参数', st.on && pub._inspect('s1').pid === ins.pid)

  pub.stop('s1')
  st = pub.status('s1')
  check('关：状态马上是关的', !st.on && !st.ended && !st.error)
  r = await get(ins.port, '/' + ins.token)
  check('关：小服务马上不在了（旧链接失效）', r.status === 0, JSON.stringify(r))
  check('关：通道进程没了', await until(() => !alive(ins.pid), 4000))
  check('关：看门进程也退了', await until(() => !alive(ins.watchdog), 4000))
}

{
  const pub = make('ok', { ttlMs: 900 })
  await pub.start('s2', { title: 'ttl', root: '/r' })
  await until(() => pub.status('s2').state === 'ready')
  const ins = pub._inspect('s2')
  const st = await until(() => { const x = pub.status('s2'); return !x.on ? x : null }, 4000)
  check('到点自动关，告诉右侧栏是到点关的', st && st.ended === 'expired', JSON.stringify(st))
  check('到点关：通道进程没了', await until(() => !alive(ins.pid), 4000))
  check('到点关：旧链接失效', (await get(ins.port, '/' + ins.token)).status === 0)
}

{
  const pub = make('fail')
  await pub.start('s3', { title: 'x', root: '/r' })
  const st = await until(() => { const x = pub.status('s3'); return !x.on ? x : null })
  check('起不来（连不上 Cloudflare）：说清楚、带上它报的错，不带本机路径', st && st.error === 'tunnel' && /failed to request quick Tunnel/.test(st.message) && !/\/Users\//.test(st.message), JSON.stringify(st))
}

{
  const pub = make('hang', { readyMs: 700 })
  await pub.start('s4', { title: 'x', root: '/r' })
  const ins = pub._inspect('s4')
  check('给了链接、还没连上：不给链接', pub.status('s4').url === '')
  const st = await until(() => { const x = pub.status('s4'); return !x.on ? x : null }, 3000)
  check('一直连不上：超时关掉', st && st.error === 'timeout', JSON.stringify(st))
  check('超时关：通道进程没了', await until(() => !alive(ins.pid), 4000))
}

{
  const pub = make('drop')
  await pub.start('s5', { title: 'x', root: '/r' })
  const st = await until(() => { const x = pub.status('s5'); return !x.on ? x : null }, 4000)
  check('连上以后断了：告诉右侧栏「断了」', st && st.ended === 'dropped', JSON.stringify(st))
}

{
  // 和 Cloudflare 断了一会儿（cloudflared 自己在重连，进程还在）：显示「正在重连」、链接不变；连回来又是「公网可见」
  const pub = make('flap', { guardMs: 100, dropMs: 5000, env: { FAKE_CF_DOWN_MS: '900' } })
  await pub.start('f1', { title: 'x', root: '/r' })
  const up = await until(() => { const x = pub.status('f1'); return x.state === 'ready' ? x : null })
  const down = await until(() => { const x = pub.status('f1'); return x.state === 'reconnecting' ? x : null }, 3000)
  check('断了一会儿：右侧栏显示「正在重连」，链接还在、不变', !!down && down.on && down.url === up.url, JSON.stringify(down))
  const back = await until(() => { const x = pub.status('f1'); return x.state === 'ready' ? x : null }, 4000)
  check('连回来了：又是「公网可见」，还是那个链接', !!back && back.url === up.url, JSON.stringify(back))
  pub.stop('f1')
}

{
  // 以后的 cloudflared 改了日志措辞（不说 Registered）：状态口说连上了也算连上，不会卡在「正在连」直到超时
  const pub = make('quiet', { guardMs: 100, readyMs: 5000 })
  await pub.start('q1', { title: 'x', root: '/r' })
  const st = await until(() => { const x = pub.status('q1'); return x.state === 'ready' ? x : null }, 3000)
  check('日志里没说连上、状态口说连上了：也算连上、给链接', !!st && /trycloudflare\.com\//.test(st.url), JSON.stringify(pub.status('q1')))
  pub.stop('q1')
}

{
  // 断了再也连不回来（进程还在，比如网络一直不通）：90 秒（测试里 0.6 秒）后关掉、杀掉通道进程
  const pub = make('lost', { guardMs: 100, dropMs: 600 })
  await pub.start('l1', { title: 'x', root: '/r' })
  await until(() => pub.status('l1').state === 'ready')
  const ins = pub._inspect('l1')
  const st = await until(() => { const x = pub.status('l1'); return !x.on ? x : null }, 4000)
  check('断太久连不回来：关掉，告诉右侧栏「断了」', st && st.ended === 'dropped', JSON.stringify(st))
  check('断太久关掉：通道进程没了', await until(() => !alive(ins.pid), 4000))
}

{
  // 这个会话换了设计：插件自己定时看（右侧栏关着也关）
  let root = '/a'
  const pub = make('ok', { guardMs: 100, alive: (_s, p) => p.root === root })
  await pub.start('m1', { title: 'x', root: '/a' })
  await until(() => pub.status('m1').state === 'ready')
  const ins = pub._inspect('m1')
  root = '/b'
  await sleep(400)
  check('换了设计：插件自己关掉（不靠右侧栏）', !pub._inspect('m1') && pub.status('m1').ended === 'moved', JSON.stringify(pub.status('m1')))
  check('换了设计关掉：通道进程没了', await until(() => !alive(ins.pid), 4000))
  check('换了设计关掉：旧链接失效', (await get(ins.port, '/' + ins.token)).status === 0)
}

{
  // 换了设计后、定时检查之前就有人打开：回 404，顺手关掉
  let root = '/a'
  const pub = make('ok', { guardMs: 60000, alive: (_s, p) => p.root === root })
  await pub.start('m2', { title: 'x', root: '/a' })
  await until(() => pub.status('m2').state === 'ready')
  const ins = pub._inspect('m2')
  root = '/b'
  const r = await get(ins.port, '/' + ins.token)
  check('换了设计马上有人打开：404，不给看', r.status === 404 && !/<title>x/.test(r.body.toString()))
  check('…并且顺手关掉了', await until(() => !pub._inspect('m2'), 2000) && pub.status('m2', { brief: true }).ended === 'moved')
  check('…通道进程也没了', await until(() => !alive(ins.pid), 4000))
}

{
  // 电脑睡过头（定时器没走）：醒来第一个打开的人就看到失效，不再多放一分钟
  let t = Date.now()
  const pub = make('ok', { guardMs: 60000, now: () => t })
  await pub.start('e1', { title: 'x', root: '/r' })
  await until(() => pub.status('e1').state === 'ready')
  const ins = pub._inspect('e1')
  check('还没到点：能打开', (await get(ins.port, '/' + ins.token)).status === 200)
  t += 2 * 3600 * 1000 + 1000
  const r = await get(ins.port, '/' + ins.token)
  check('过了 2 小时（定时器还没响）：打开是 404，并且关掉、说是到点关的', r.status === 404 && await until(() => !pub._inspect('e1'), 2000) && pub.status('e1').ended === 'expired')
  check('到点关（醒来补上）：通道进程没了', await until(() => !alive(ins.pid), 4000))
  // 右侧栏刷新时也补上
  t = Date.now()
  await pub.start('e2', { title: 'x', root: '/r' })
  t += 2 * 3600 * 1000 + 1000
  check('过了 2 小时右侧栏一刷新：马上是关的', !pub.status('e2', { brief: true }).on && pub.status('e2').ended === 'expired')
  // 早该关的又点了「开」：关掉重开一个新的
  t = Date.now()
  await pub.start('e3', { title: 'x', root: '/r' })
  const old = pub._inspect('e3')
  t += 2 * 3600 * 1000 + 1000
  {
    const st = await pub.start('e3', { title: 'x', root: '/r' })
    check('早该关的又点「开」：关掉旧的、开个新的（口令也换）', st.on && pub._inspect('e3') && pub._inspect('e3').token !== old.token)
  }
  pub.stopAll()
}

{
  // 换参数打包失败：继续提供旧版本，短时间内不反复重打。
  const pub = make()
  await pub.start('p1', { title: 'x', root: '/r' })
  const ins = pub._inspect('p1')
  pub.update('p1', { title: 'x', root: '/r', boom: true })
  const b0 = builds
  const r1 = await get(ins.port, '/' + ins.token)
  const r2 = await get(ins.port, '/' + ins.token)
  const r3 = await get(ins.port, '/' + ins.token)
  check('换参数打包失败：三个请求都继续拿到上一版，只重打一次', [r1, r2, r3].every((r) => r.status === 200 && r.body.toString().includes('<title>x</title>')) && builds === b0 + 1, `${r1.status} ${builds - b0}`)
  check('开着以后重打失败：状态有原因，链接仍在', pub.status('p1').broken === 'tooBig' && pub.status('p1').brokenMsg === '新版本没发布：too big' && pub.status('p1').on, JSON.stringify(pub.status('p1')))
  pub.update('p1', { title: 'x', root: '/r', boom: true, dark: true })
  check('换了别的参数（切深浅色）但还没打成功：失败提示不消失', pub.status('p1').broken === 'tooBig')
  pub.update('p1', { title: '好了', root: '/r' })
  const r4 = await get(ins.port, '/' + ins.token)
  check('参数改好了：马上重打、能打开，失败提示清掉', r4.status === 200 && /<title>好了<\/title>/.test(r4.body.toString()) && !pub.status('p1').broken && !pub.status('p1').brokenMsg)
  check('右侧栏每次刷新带的状态很短（没有次数、链接，免得一直重画）', JSON.stringify(Object.keys(pub.status('p1', { brief: true }))) === '["on","state"]')
  pub.stop('p1')
  await pub.start('p1', { title: 'x', root: '/r', boom: true })
  check('关着时的简短状态只有开没开、原因代号（不带报错原文）', JSON.stringify(Object.keys(pub.status('p1', { brief: true })).sort()) === '["error","on"]', JSON.stringify(pub.status('p1', { brief: true })))
  pub.stop('p1')
}

{
  const file = path.join(tmp, 'same-mtime.html')
  const component = path.join(tmp, 'new-card.html')
  const mtime = new Date('2026-11-10T10:00:00Z')
  const write = (text) => { fs.writeFileSync(file, text); fs.utimesSync(file, mtime, mtime) }
  write('<p>one</p>')
  const before = fs.statSync(file)
  let time = Date.now()
  let count = 0
  const pub = make('ok', {
    now: () => time,
    build: () => {
      count++
      const html = fs.readFileSync(file, 'utf8')
      if (!html.includes('bad')) return { html, deps: [file] }
      if (!fs.existsSync(component)) throw Object.assign(new Error('same-mtime.html 缺少 new-card 组件'), { code: 'missing', deps: [file, component] })
      return { html: fs.readFileSync(component, 'utf8'), deps: [file, component] }
    },
  })
  await pub.start('fingerprint', { root: tmp })
  const { port, token } = pub._inspect('fingerprint')
  const visit = (headers) => get(port, '/' + token, headers)
  try {
    const first = await visit()
    write('<p>two</p>')
    time += 1600
    const changed = await visit({ 'if-none-match': first.headers.etag })
    const after = fs.statSync(file)
    check('内容指纹：尺寸和 mtime 完全一样，刷新能拿到新内容和 ETag', before.size === after.size && before.mtimeMs === after.mtimeMs
      && changed.status === 200 && changed.body.toString() === '<p>two</p>' && changed.headers.etag !== first.headers.etag && count === 2)
    write('<p>bad</p>')
    time += 1600
    const fallback = await visit()
    const status = pub.status('fingerprint')
    check('文件改坏：沿用旧成品、旧 ETag，状态说明哪屏缺哪个组件', fallback.status === 200 && fallback.body.toString() === '<p>two</p>'
      && fallback.headers.etag === changed.headers.etag && status.on && status.broken === 'missing' && status.brokenMsg === '新版本没发布：same-mtime.html 缺少 new-card 组件')
    time += 6000
    const unchanged = await visit({ 'if-none-match': changed.headers.etag })
    check('出错的文件没再改：旧 ETag 仍有效，不重复打包', unchanged.status === 304 && count === 3)
    fs.writeFileSync(component, '<p>fixed</p>')
    time += 1600
    const fixed = await visit({ 'if-none-match': changed.headers.etag })
    const recovered = pub.status('fingerprint')
    check('补上失败时才发现的新依赖：下次打开更新新版本并清掉原因', fixed.status === 200 && fixed.body.toString() === '<p>fixed</p>'
      && fixed.headers.etag !== changed.headers.etag && count === 4 && !recovered.broken && !recovered.brokenMsg)
  } finally {
    pub.stop('fingerprint')
  }
}

{
  const root = fs.realpathSync(tmp)
  const design = path.join(root, 'fingerprint-design')
  const sibling = design + '-sibling'
  fs.mkdirSync(design)
  fs.mkdirSync(sibling)
  const outside = path.join(sibling, 'asset.txt')
  const link = path.join(design, 'linked.txt')
  const big = path.join(design, 'oversize.txt')
  fs.writeFileSync(outside, 'outside')
  fs.symlinkSync(outside, link)
  fs.writeFileSync(big, '')
  fs.truncateSync(big, PACK_FILE_MAX + 1)
  let time = Date.now()
  let count = 0
  const opened = []
  const pub = make('ok', {
    now: () => time,
    build: () => ({ html: '<p>' + ++count + '</p>', deps: [link, big] }),
  })
  const open = fs.openSync
  fs.openSync = function (file, ...args) {
    if ([outside, link, big].includes(file)) opened.push(file)
    return open.call(this, file, ...args)
  }
  try {
    await pub.start('bounded', { root: design })
    const { port, token } = pub._inspect('bounded')
    const visit = () => get(port, '/' + token)
    time += 1600
    await visit()
    check('公网指纹：首次打包和后续检查都不打开目录外软链接或超限文件', opened.length === 0 && count === 1, opened.join())

    fs.truncateSync(big, 1)
    time += 1600
    const smaller = await visit()
    check('超限文件缩小后自动重打，开始读取内容', smaller.body.toString() === '<p>2</p>' && opened.includes(big) && !opened.includes(outside))

    fs.unlinkSync(link)
    fs.writeFileSync(link, 'inside')
    opened.length = 0
    time += 1600
    const replaced = await visit()
    check('目录外软链接换回目录内文件后自动重打', replaced.body.toString() === '<p>3</p>' && opened.includes(link) && !opened.includes(outside))
  } finally {
    fs.openSync = open
    pub.stop('bounded')
  }
}

{
  // 只放生成时那几屏：之后同目录新出现的网页不自动加进链接；删掉的去掉；都没了就不换
  let last = null
  const pub = createPublicShare({
    build: (p) => { last = p; return { html: 'x' + (p.screens || []).map((x) => x.key).join(','), deps: [] } },
    find: () => process.execPath,
    launch: (bin, args) => launchWatched(bin, [FAKE, ...args], { env: { ...process.env, FAKE_CF_MODE: 'ok' } }),
    config: () => path.join(tmp, 'cf.yml'),
  })
  await pub.start('k1', { root: '/r', screens: [{ key: 'a.html', label: '首页' }, { key: 'b.html', label: '详情' }] })
  check('放出去的屏写在状态里', JSON.stringify(pub.status('k1').screens) === '["首页","详情"]')
  pub.update('k1', { root: '/r', screens: [{ key: 'a.html', label: '首页' }, { key: 'b.html', label: '详情' }, { key: 'quote.html', label: '报价' }] })
  const ins = pub._inspect('k1')
  await get(ins.port, '/' + ins.token)
  check('后来新出现的屏（同目录刚下载的网页）不自动放出去', last && JSON.stringify(last.screens.map((x) => x.key)) === '["a.html","b.html"]' && JSON.stringify(pub.status('k1').screens) === '["首页","详情"]', JSON.stringify(last && last.screens))
  pub.update('k1', { root: '/r', screens: [{ key: 'b.html', label: '详情页' }] })
  await sleep(10)
  await get(ins.port, '/' + ins.token)
  check('删掉的屏去掉、改名跟着改', JSON.stringify(last.screens.map((x) => x.key)) === '["b.html"]' && JSON.stringify(pub.status('k1').screens) === '["详情页"]')
  check('生成时的屏都没了：不换（不会变成放别的屏）', pub.update('k1', { root: '/r', screens: [{ key: 'quote.html', label: '报价' }] }) === false)
  pub.stop('k1')
}

{
  // 看门进程被单独结束（系统、安全软件）：cloudflared 没人管了，插件直接杀掉它
  const pub = make()
  await pub.start('w1', { title: 'x', root: '/r' })
  await until(() => pub.status('w1').state === 'ready')
  const ins = pub._inspect('w1')
  process.kill(ins.watchdog, 'SIGKILL')
  check('看门进程单独没了：cloudflared 也被杀掉、右侧栏说断了', await until(() => !alive(ins.pid), 4000) && pub.status('w1').ended === 'dropped', JSON.stringify(pub.status('w1')))
}

{
  // 第一次打包就失败（设计太大）：原因留着（右侧栏轮询不冲掉），换了设计就不提了
  let root = '/big'
  const pub = make('ok', { alive: (_s, p) => p.root === root })
  const st = await pub.start('b1', { title: 'x', root: '/big', boom: true })
  check('打包失败：原因留到右侧栏下一次刷新', st.error === 'tooBig' && pub.status('b1').error === 'tooBig' && !('root' in pub.status('b1')), JSON.stringify(pub.status('b1')))
  root = '/other'
  check('换了设计：不再提上一个设计的打包失败', !pub.status('b1').error, JSON.stringify(pub.status('b1')))
}

{
  const pub = createPublicShare({ build, find: () => '' })
  const st = await pub.start('s6', { title: 'x', root: '/r' })
  check('没装 cloudflared：明确说，不开小服务', !st.on && st.error === 'no-cloudflared' && !pub._inspect('s6'))
  const pub2 = make()
  const st2 = await pub2.start('s7', { title: 'x', root: '/r', boom: true })
  check('打包不出来（太大）：不开通道、照打包的错说', !st2.on && st2.error === 'tooBig' && !pub2._inspect('s7'))
}

// ── 下载 cloudflared（用户点了才下）──
{
  check('下载：Mac 下 tgz、Windows 下 exe（ARM 的 Windows 用 x64 版）、Linux 下二进制', assetFor('darwin', 'arm64').name === 'cloudflared-darwin-arm64.tgz' && assetFor('win32', 'x64').name === 'cloudflared-windows-amd64.exe' && assetFor('win32', 'arm64').name === 'cloudflared-windows-amd64.exe' && assetFor('linux', 'x64').name === 'cloudflared-linux-amd64' && assetFor('freebsd', 'x64') === null)
  const body = Buffer.from('#!/bin/sh\necho fake\n')
  const fakeFetch = async (url) => ({ ok: true, url, headers: new Headers({ 'content-length': String(body.length) }), body: (async function* () { yield body.subarray(0, 5); yield body.subarray(5) })() })
  const seen = []
  const dir = path.join(tmp, 'dl')
  const f = await downloadCloudflared({ dir, platform: 'linux', arch: 'x64', fetchImpl: async (u) => { seen.push(u); return fakeFetch(u) }, onProgress: (p) => seen.push(p.got + '/' + p.total) })
  check('下载：从 Cloudflare 官方 GitHub 下，放进插件自己的目录、能执行、报进度', seen[0] === 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64' && f === path.join(dir, 'cloudflared') && fs.readFileSync(f).equals(body) && (process.platform === 'win32' || (fs.statSync(f).mode & 0o111) !== 0) && seen.includes(`${body.length}/${body.length}`), JSON.stringify(seen))
  check('下载：不留下半截的临时文件', fs.readdirSync(dir).every((n) => !n.endsWith('.part')))
  const bad = await downloadCloudflared({ dir: path.join(tmp, 'dl2'), platform: 'linux', arch: 'x64', fetchImpl: async () => ({ ok: false, status: 404 }) }).catch((e) => e.message)
  check('下载：GitHub 给了错误码就报错', bad === 'HTTP 404')
  const broken = await downloadCloudflared({ dir: path.join(tmp, 'dl3'), platform: 'linux', arch: 'x64', fetchImpl: async () => ({ ok: true, headers: new Headers(), body: (async function* () { yield body; throw new Error('socket hang up') })() }) }).catch((e) => e.message)
  check('下载：中途断了报错、不留半截文件', broken === 'socket hang up' && fs.readdirSync(path.join(tmp, 'dl3')).length === 0)
  // 卡住不动（国内连 GitHub 常见）：fetch 不认取消也照样停下
  const t0 = Date.now()
  const stalled = await downloadCloudflared({ dir: path.join(tmp, 'dl4'), platform: 'linux', arch: 'x64', idleMs: 300, fetchImpl: async () => ({ ok: true, headers: new Headers(), body: (async function* () { yield body.subarray(0, 3); await new Promise(() => {}) })() }) }).catch((e) => e)
  check('下载：卡住不动（这里 0.3 秒）就放弃、说是卡住了、不留半截文件', stalled.code === 'stalled' && Date.now() - t0 < 3000 && fs.readdirSync(path.join(tmp, 'dl4')).length === 0, String(stalled.code || stalled))
  const stuckConnect = await downloadCloudflared({ dir: path.join(tmp, 'dl5'), platform: 'linux', arch: 'x64', idleMs: 300, fetchImpl: () => new Promise(() => {}) }).catch((e) => e)
  check('下载：一直连不上（没有回应）也放弃', stuckConnect.code === 'stalled')
  const ac = new AbortController()
  const cancelled = downloadCloudflared({ dir: path.join(tmp, 'dl6'), platform: 'linux', arch: 'x64', signal: ac.signal, fetchImpl: async () => ({ ok: true, headers: new Headers(), body: (async function* () { yield body.subarray(0, 3); await new Promise(() => {}) })() }) }).catch((e) => e)
  await sleep(50)
  ac.abort()
  const ce = await cancelled
  check('下载：点了取消就停、不留半截文件', ce.code === 'cancelled' && fs.readdirSync(path.join(tmp, 'dl6')).length === 0, String(ce.code || ce))
  let release
  const pub = createPublicShare({ build, find: () => '', download: ({ onProgress }) => new Promise((r) => { onProgress({ got: 5, total: 10 }); release = r }) })
  pub.fetchTool()
  await sleep(10)
  const a = pub.status('x').dl
  pub.fetchTool() // 已经在下：不重复下
  release('/x/cloudflared')
  await sleep(20)
  check('下载：状态里有进度，下完了标记好', a && a.got === 5 && a.total === 10 && !a.done && pub.status('x').dl.done && !pub.status('x').dl.error)
  const pub2 = createPublicShare({ build, find: () => '', download: async () => { throw new Error('getaddrinfo ENOTFOUND github.com') } })
  pub2.fetchTool()
  await sleep(20)
  check('下载：下不下来（连不上 GitHub）把原因给右侧栏', /ENOTFOUND/.test(pub2.status('x').dl.error))
  let gotSignal = null
  const pub3 = createPublicShare({ build, find: () => '', download: ({ signal }) => new Promise((_r, reject) => { gotSignal = signal; signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }))) }) })
  pub3.fetchTool()
  await sleep(10)
  const during = pub3.status('x').dl
  pub3.cancelTool()
  await sleep(20)
  check('下载：右侧栏点「取消」→ 真停下、状态回到没下载', during && !during.done && gotSignal && gotSignal.aborted && !pub3.status('x').dl)
  const pub4 = createPublicShare({ build, find: () => '', download: async () => { throw Object.assign(new Error('stalled'), { code: 'stalled' }) } })
  pub4.fetchTool()
  await sleep(20)
  check('下载：卡住了给右侧栏一个代号（显示成人话）', pub4.status('x').dl.error === 'stalled')
}

// ── 插件（DSH）被强行杀掉：通道进程跟着没了，不留一个指着本机端口的公网链接 ──
{
  const host = path.join(tmp, 'host.mjs')
  fs.writeFileSync(host, `
import { createPublicShare, launchWatched } from ${JSON.stringify(new URL('../lib/tunnel.js', import.meta.url).href)}
const pub = createPublicShare({
  build: () => ({ html: 'x', deps: [] }),
  find: () => process.execPath,
  launch: (bin, args) => launchWatched(bin, [${JSON.stringify(FAKE)}, ...args]),
  config: () => ${JSON.stringify(path.join(tmp, 'cf2.yml'))},
})
await pub.start('k', { root: '/r' })
const t = setInterval(() => { const i = pub._inspect('k'); if (i && i.pid && pub.status('k').state === 'ready') { console.log('PID ' + i.pid); clearInterval(t) } }, 50)
setInterval(() => {}, 1000)
`)
  const child = spawn(process.execPath, [host], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const pid = Number(await until(() => (/PID (\d+)/.exec(out) || [])[1], 6000))
  check('（准备）另一个进程开了公网链接', alive(pid), out)
  child.kill('SIGKILL')
  check('插件进程被 kill -9：通道进程几秒内跟着没了', await until(() => !alive(pid), 6000))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
