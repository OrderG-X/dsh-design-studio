/**
 * 公网链接（#27，实验）：把「整套 HTML 演示」（htmlpack.js）临时放到公网上，发到微信里对方点开就能看、能点着换屏。
 *
 *   - 只放这一份演示：本机开一个只认一个地址的小服务（127.0.0.1，路径里带随机口令），不碰预览服务器、不列目录；
 *     别的地址、别的请求方法一律回同一个 404
 *   - 通道用用户自己装的 cloudflared（Cloudflare 的临时通道，不用账号、不经过我们的服务器），链接形如
 *     https://xxx.trycloudflare.com/<口令>
 *   - 默认 2 小时自动关；右侧栏能随时关；关掉马上断：杀掉通道进程、关掉小服务和它的连接
 *   - 插件自己每 5 秒看一眼（有人打开时也看）：到点了、这个会话换了设计 → 关；cloudflared 和 Cloudflare 断了
 *     （它自己会重连，链接不变）→ 右侧栏说「正在重连」，90 秒还没连回来 → 关
 *   - 文件内容改了就重新打包；重打失败仍提供上一份成功的演示，文件没改时支持 304
 *   - cloudflared 不直接由插件起，而是由一个小看门进程起：插件（DSH）被强行关掉时，看门进程的 stdin 断了，
 *     顺手把 cloudflared 也杀掉——不然公网链接会一直指着本机那个端口，端口被别的程序占了就把别的程序暴露出去
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn, execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { MAX_TOTAL as PACK_FILE_MAX } from './bundle.js'

export const TTL_MS = 2 * 60 * 60 * 1000
const READY_MS = 60 * 1000
const CHECK_MS = 1500 // 两次请求之间至少隔这么久才再看一眼文件改没改
const GUARD_MS = 5000 // 多久看一眼：到点没有、换没换设计、通道还连着没有
const DROP_MS = 90 * 1000 // 通道断了这么久还没连回来 → 关
const DL_IDLE_MS = 30 * 1000 // 下载这么久没收到一个字节 → 放弃
// 临时通道的地址：api.trycloudflare.com 是申请通道用的，不是给人看的
export const URL_RE = /https:\/\/(?!api\.)([a-z0-9-]+\.trycloudflare\.com)\b/i
const READY_RE = /Registered tunnel connection|Connection [0-9a-f-]+ registered/i
// cloudflared 自己的状态口（--metrics 127.0.0.1:0 让它挑端口，日志里说在哪）；GET /ready 连着 Cloudflare 回 200
const METRICS_RE = /metrics server on (127\.0\.0\.1:\d+)/i
// 看门进程第一行报 cloudflared 的 pid：只认行首、只认第一次（别被 cloudflared 输出里碰巧有的字骗去杀别的进程）
const PID_RE = /^ddp-tunnel-pid (\d+)\r?\n/m
// 插件自己的地方：下载的 cloudflared、给它的空配置
export const DATA_DIR = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'pub')
const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/'

/**
 * 找 cloudflared：插件自己下的 → 「手机端」插件下的 → PATH → 常见的安装位置
 * （从访达 / 开始菜单打开的 DSH，PATH 里往往没有 Homebrew 那些目录）
 */
export function findCloudflared({ env = process.env, platform = process.platform, exists = fs.existsSync, home = os.homedir(), own = platform === process.platform && home === os.homedir() ? DATA_DIR : '' } = {}) {
  const P = platform === 'win32' ? path.win32 : path.posix
  const exe = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const dirs = []
  if (own) dirs.push(P.join(own, 'bin'))
  dirs.push(P.join(home, '.dsh', 'dsh-mobile', 'bin'))
  dirs.push(...String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean))
  if (platform === 'win32') {
    for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)']) if (pf) dirs.push(P.join(pf, 'cloudflared'))
    if (env.LOCALAPPDATA) dirs.push(P.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'))
    dirs.push(P.join(home, 'scoop', 'shims'))
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', P.join(home, '.local', 'bin'), P.join(home, 'bin'), '/usr/bin', '/snap/bin')
  }
  for (const d of dirs) {
    const f = P.join(d, exe)
    try { if (exists(f)) return f } catch { /* 读不了的目录 */ }
  }
  return ''
}

/** 这台机器该下哪个文件（和「手机端」插件同一份）；不支持给 null */
export function assetFor(platform = process.platform, arch = process.arch) {
  const a = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' }[arch]
  if (!a) return null
  if (platform === 'darwin' && (a === 'amd64' || a === 'arm64')) return { name: `cloudflared-darwin-${a}.tgz`, tgz: true }
  if (platform === 'linux') return { name: `cloudflared-linux-${a}`, tgz: false }
  if (platform === 'win32' && (a === 'amd64' || a === '386')) return { name: `cloudflared-windows-${a}.exe`, tgz: false }
  // Windows on ARM 没有原生版：用 x64 的（系统自带转译）
  if (platform === 'win32' && a === 'arm64') return { name: 'cloudflared-windows-amd64.exe', tgz: false }
  return null
}

/**
 * 用户点了「下载」才下：Cloudflare 官方 GitHub 发布的最新版，放进插件自己的目录（不碰系统目录、不要管理员权限）。
 * @param onProgress ({ got, total }) => void
 * @param signal     取消（右侧栏点了「取消」）
 * @param idleMs     这么久一个字节都没收到就放弃（国内连 GitHub 常常卡住不动）
 * @returns 可执行文件路径
 */
export async function downloadCloudflared({ dir = path.join(DATA_DIR, 'bin'), onProgress = () => {}, fetchImpl = globalThis.fetch, platform = process.platform, arch = process.arch, signal = null, idleMs = DL_IDLE_MS } = {}) {
  const asset = assetFor(platform, arch)
  if (!asset) throw Object.assign(new Error(`no cloudflared build for ${platform}/${arch}`), { code: 'unsupported' })
  const ac = new AbortController()
  const onAbort = () => ac.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' }))
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }) }
  let idle = null
  const kick = () => {
    clearTimeout(idle)
    idle = setTimeout(() => ac.abort(Object.assign(new Error('stalled'), { code: 'stalled' })), idleMs) // 下完 / 出错都会清掉
  }
  // 卡住时不管 fetch 认不认 signal 都要停下：和「被取消」赛跑
  const aborted = new Promise((_r, reject) => ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true }))
  aborted.catch(() => {})
  const race = (p) => Promise.race([p, aborted])
  const rand = crypto.randomBytes(4).toString('hex') // 取消后马上重下：两次的临时文件别撞上
  const tmp = path.join(dir, `.${asset.name}.${process.pid}.${rand}.part`)
  const unpack = path.join(dir, `.unpack.${process.pid}.${rand}`)
  let out = null
  try {
    kick()
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const res = await race(fetchImpl(RELEASE + asset.name, { redirect: 'follow', signal: ac.signal }))
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    out = fs.createWriteStream(tmp, { mode: 0o755 })
    // pipeline：写盘出错、正文中途断了、卡住、取消都走到 catch（不会冒成没人接的 error 事件）
    await race(pipeline(async function* () {
      for await (const chunk of res.body) {
        if (ac.signal.aborted) throw ac.signal.reason
        kick()
        got += chunk.length
        onProgress({ got, total })
        yield chunk
      }
    }, out, { signal: ac.signal }))
  } catch (e) {
    if (!ac.signal.aborted) ac.abort(e) // 让还在读的正文也停下
    if (out && !out.closed) { out.destroy(); await new Promise((r) => out.once('close', r)) }
    try { fs.unlinkSync(tmp) } catch { /* 没写出来 */ }
    clearTimeout(idle)
    if (signal) signal.removeEventListener('abort', onAbort)
    throw ac.signal.reason && ac.signal.reason.code ? ac.signal.reason : e
  }
  clearTimeout(idle)
  const target = path.join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  try {
    // 先解到旁边的临时目录：解包时点了「取消」就不装上
    let file = tmp
    if (asset.tgz) {
      fs.mkdirSync(unpack, { recursive: true, mode: 0o700 })
      await new Promise((resolve, reject) => execFile('tar', ['-xzf', tmp, '-C', unpack, 'cloudflared'], (e) => (e ? reject(e) : resolve())))
      file = path.join(unpack, 'cloudflared')
    }
    if (ac.signal.aborted) throw ac.signal.reason
    fs.chmodSync(file, 0o755)
    fs.renameSync(file, target)
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    try { fs.unlinkSync(tmp) } catch { /* 已经挪走了 */ }
    try { fs.rmSync(unpack, { recursive: true, force: true }) } catch { /* 没解 */ }
  }
  return target
}

/** 给 cloudflared 一个空配置：用户自己的 ~/.cloudflared/config.yml 不该影响临时通道。放插件自己的目录（不放共享的临时目录） */
function emptyConfig(dir = DATA_DIR) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const f = path.join(dir, 'cloudflared.yml')
  fs.writeFileSync(f, '{}\n', { mode: 0o600 })
  return f
}

// 看门进程：起 cloudflared，告诉插件它的 pid；自己的 stdin 一断（插件没了、或者插件让关）就把它杀掉再退出
const WATCHDOG = `
const { spawn } = require('child_process')
const [bin, ...args] = JSON.parse(process.argv[1])
let c
try { c = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }) } catch (e) { console.error('ddp-watchdog-error ' + e.message); process.exit(127) }
c.on('error', (e) => { console.error('ddp-watchdog-error ' + e.message); process.exit(127) })
if (c.pid) console.error('ddp-tunnel-pid ' + c.pid)
let ending = false
const end = () => {
  if (ending) return
  ending = true
  try { c.kill() } catch {}
  setTimeout(() => { try { c.kill('SIGKILL') } catch {} process.exit(0) }, 2000).unref()
}
c.on('exit', (code) => process.exit(ending ? 0 : code == null ? 1 : code))
process.stdin.on('end', end)
process.stdin.on('close', end)
process.stdin.on('error', end)
process.on('SIGTERM', end)
process.on('SIGINT', end)
process.stdin.resume()
`

/** 起看门进程（DSH 里 process.execPath 是 Electron：要按 Node 跑） */
export function launchWatched(bin, args, { execPath = process.execPath, env = process.env } = {}) {
  return spawn(execPath, ['-e', WATCHDOG, JSON.stringify([bin, ...args])], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

const PAGE = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.6 -apple-system,system-ui,sans-serif;color:#555;background:#f5f5f7;text-align:center;padding:24px;box-sizing:border-box}b{display:block;color:#111;font-size:18px;margin-bottom:6px}</style>
</head><body><div><b>${title}</b>${text}</div></body></html>`
const NOT_FOUND = PAGE('链接失效了 / Link expired', '这个链接已经关了，或者地址不对。<br>This link has been closed or is wrong.')
const BUSY = PAGE('暂时打不开 / Not available', '过一会儿再刷新试试。<br>Please refresh in a moment.')

const SAFE_HEADERS = {
  'Referrer-Policy': 'no-referrer', // 页面里的外网字体、链接不带上通道地址（口令在路径里）
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // 不加 CSP：每屏是 srcdoc 的 iframe，会继承外层的 CSP，页面里的内联脚本就全跑不了了
}

/** 问 cloudflared 自己的状态口：还连着 Cloudflare 吗（连不上状态口也算没连着） */
function probeReady(addr, timeoutMs = 3000) {
  const [host, port] = String(addr).split(':')
  return new Promise((resolve) => {
    const req = http.get({ host, port: Number(port), path: '/ready', timeout: timeoutMs, agent: false }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

/**
 * @param opts.build   (params) → { html, deps: [绝对路径…] }，打不出来就抛错
 * @param opts.find    () → cloudflared 的路径，没有给 ''
 * @param opts.launch  (bin, args) → 子进程（默认带看门进程）
 * @param opts.alive   (session, params) → 这个会话现在看的还是不是这个设计；不是了就关
 * @param opts.probe   (127.0.0.1:端口) → Promise<bool> 通道还连着 Cloudflare 没有
 */
export function createPublicShare({ build, find = () => findCloudflared(), launch = launchWatched, config = emptyConfig, download = downloadCloudflared, alive = () => true, probe = probeReady, log = () => {}, now = Date.now, ttlMs = TTL_MS, readyMs = READY_MS, guardMs = GUARD_MS, dropMs = DROP_MS } = {}) {
  const shares = new Map() // session → share
  const ended = new Map() // session → 上一次是怎么关的（到点 / 断了 / 起不来 / 换了设计），给右侧栏说一声
  let dl = null // 正在下 / 下完的 cloudflared：{ got, total, done, error }
  let dlAbort = null

  /** 下载 cloudflared（已经在下就不重复下）；状态在 status().dl 里 */
  function fetchTool() {
    if (dl && !dl.done) return dl
    dl = { got: 0, total: 0, done: false, error: '' }
    const me = dl
    const ac = new AbortController()
    dlAbort = ac
    Promise.resolve().then(() => download({ signal: ac.signal, onProgress: ({ got, total }) => { me.got = got; me.total = total } }))
      .then(() => { me.done = true })
      .catch((e) => {
        log(e)
        me.done = true
        me.error = e.code === 'unsupported' || e.code === 'stalled' || e.code === 'cancelled' ? e.code : String(e.message || e).slice(0, 160)
      })
      .finally(() => { if (dlAbort === ac) dlAbort = null })
    return me
  }

  /** 右侧栏点了「取消下载」 */
  function cancelTool() {
    if (dlAbort) dlAbort.abort()
    dlAbort = null
    dl = null
  }

  /** 到点了、换了设计：给关掉的原因；还好好的给 null */
  function gone(s) {
    if (now() >= s.expires) return { ended: 'expired' }
    let ok = true
    try { ok = alive(s.session, s.params) !== false } catch (e) { log(e) }
    return ok ? null : { ended: 'moved' }
  }

  /** @param brief 只给开没开、什么状态（右侧栏每次刷新都带，别让次数、地址一变就重画） */
  function status(session, { brief = false } = {}) {
    let s = shares.get(session)
    if (s) {
      const why = gone(s)
      if (why) { finish(session, why, s); s = null }
    }
    if (!s) {
      let e = ended.get(session)
      if (e && e.root !== undefined) {
        // 打包失败记下的原因：只对那个设计说（插件本机路径不往外给）
        let same = false
        try { same = alive(session, { root: e.root }) !== false } catch (err) { log(err) }
        if (!same) { ended.delete(session); e = null } else { const { root: _r, ...rest } = e; e = rest }
      }
      if (brief) return { on: false, ...(e && e.ended ? { ended: e.ended } : {}), ...(e && e.error ? { error: e.error } : {}) }
      const d = dl ? { dl: { ...dl } } : {}
      return e ? { on: false, ...e, ...d } : { on: false, ...d }
    }
    if (brief) return { on: true, state: s.state }
    return {
      on: true,
      state: s.state, // starting | ready | reconnecting（cloudflared 和 Cloudflare 断了，在重连，链接不变）
      url: s.state === 'starting' ? '' : s.url,
      // 重打包失败时访客继续看上一版，发布者能看到这次失败的原因
      broken: s.broken,
      brokenMsg: s.brokenMsg,
      screens: s.labels, // 放出去的是哪几屏（生成时那几屏，新加的屏不自动放出去）
      expires: s.expires,
      views: s.views,
      name: s.name,
    }
  }

  /** 每 5 秒：到点 / 换了设计 → 关；问 cloudflared 还连着没有，断了 90 秒 → 关 */
  async function guard(s) {
    if (shares.get(s.session) !== s) return
    const why = gone(s)
    if (why) return finish(s.session, why, s)
    // 新版本没发布（组件错、太大……）：改好了就自己重打，不等有人来访（面板上「新版本没发布」也就消了）
    if (s.broken) { try { current(s) } catch (e) { log(e) } }
    if (!s.metrics || s.probing || (s.state === 'starting' && !s.url)) return
    s.probing = true
    let ok = false
    try { ok = await probe(s.metrics) } catch { ok = false } finally { s.probing = false }
    if (shares.get(s.session) !== s) return
    if (ok) {
      // 还在「正在连」但状态口说连上了：也算连上（以后新版 cloudflared 改了日志措辞也不会一直卡在「正在连」）
      if (s.state === 'starting') clearTimeout(s.readyTimer)
      s.state = 'ready'
      s.downSince = 0
      return
    }
    if (s.state === 'starting') return // 还没连上过：交给 60 秒的超时
    if (!s.downSince) s.downSince = now()
    s.state = 'reconnecting'
    if (now() - s.downSince >= dropMs) finish(s.session, { ended: 'dropped' }, s)
  }

  /**
   * 开（已经开着就只换参数：屏、画幅、深浅色这些按右侧栏现在的）。
   * @returns status；没装 cloudflared → { on: false, error: 'no-cloudflared' }
   */
  async function start(session, params, { name = '' } = {}) {
    const have = shares.get(session)
    const why = have && gone(have)
    if (why) finish(session, why, have) // 开着的早该关了（到点 / 换了设计）：关掉重开
    else if (have) {
      update(session, params)
      return status(session)
    }
    ended.delete(session)
    const bin = find()
    if (!bin) return { on: false, error: 'no-cloudflared' }
    // 先打一次包：打不出来（屏都没了、太大）就别开通道
    let first
    try { first = pack(params) } catch (e) {
      // 记着原因（右侧栏轮询别把它冲掉），换了设计就不提了
      const why = { error: e.code || 'pack', message: e.message, root: params && params.root }
      ended.set(session, why)
      return status(session)
    }
    const s = {
      session,
      params,
      name: String(name || '').slice(0, 80),
      token: crypto.randomBytes(18).toString('base64url'),
      state: 'starting',
      url: '',
      host: '',
      port: 0,
      views: 0,
      started: now(),
      expires: now() + ttlMs,
      cache: first,
      checkedAt: now(),
      attemptedDeps: first.deps,
      dirty: false,
      broken: '',
      brokenMsg: '',
      // 只放生成时那几屏：之后同目录里新出现的网页（比如刚下载的别的文件）不自动加进链接
      keys: Array.isArray(params && params.screens) ? new Set(params.screens.map((x) => x && x.key)) : null,
      labels: Array.isArray(params && params.screens) ? params.screens.map((x) => String((x && (x.label || x.key)) || '').slice(0, 80)) : [],
      sockets: new Set(),
      out: '',
      pid: 0,
      metrics: '',
      downSince: 0,
      probing: false,
    }
    const server = http.createServer((req, res) => {
      try { handle(s, req, res) } catch (e) {
        log(e)
        try { if (!res.headersSent) send(res, 500, BUSY); else res.destroy() } catch { /* 连接已经没了 */ }
      }
    })
    server.on('connection', (c) => { s.sockets.add(c); c.on('close', () => s.sockets.delete(c)) })
    server.on('clientError', (_e, c) => c.destroy())
    server.on('error', (e) => log(e))
    s.server = server
    shares.set(session, s)
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve())
      })
    } catch (e) {
      log(e)
      finish(session, { error: 'listen', message: e.message })
      return status(session)
    }
    if (shares.get(session) !== s) return status(session) // 等端口的时候被关了
    s.port = server.address().port
    let child
    try {
      // --protocol http2：默认的 QUIC 走 UDP，碰上代理 / 公司网络常常连不上
      // --metrics 127.0.0.1:0：只在本机开它的状态口、端口它自己挑，插件靠它知道通道断没断
      child = launch(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--config', config(), '--metrics', '127.0.0.1:0', '--url', `http://127.0.0.1:${s.port}`])
    } catch (e) {
      finish(session, { error: 'tunnel', message: e.message })
      return status(session)
    }
    s.child = child
    const onOut = (buf) => {
      s.out = (s.out + buf.toString('utf8')).slice(-8000)
      if (!s.pid) {
        const pid = PID_RE.exec(s.out)
        if (pid) s.pid = Number(pid[1])
      }
      if (!s.metrics) {
        const m = METRICS_RE.exec(s.out)
        if (m) s.metrics = m[1]
      }
      if (!s.url) {
        const m = URL_RE.exec(s.out)
        if (m) { s.host = m[1].toLowerCase(); s.url = `https://${s.host}/${s.token}` }
      }
      if (s.url && s.state === 'starting' && READY_RE.test(s.out)) {
        s.state = 'ready'
        clearTimeout(s.readyTimer)
      }
    }
    // 子进程、它的输出流出了错都接住：没人接的 error 事件会让整个 DSH 退出
    if (child.stdout) { child.stdout.on('data', onOut); child.stdout.on('error', () => {}) }
    if (child.stderr) { child.stderr.on('data', onOut); child.stderr.on('error', () => {}) }
    if (child.stdin) child.stdin.on('error', () => {})
    child.on('error', (e) => { log(e); if (shares.get(session) === s) finish(session, { error: 'tunnel', message: e.message }, s) })
    child.on('exit', (code) => {
      s.child = null
      if (shares.get(session) !== s) return
      // 看门进程自己没了（被系统、安全软件单独结束）：cloudflared 没人管了，直接杀掉，别让它一直指着本机端口
      if (s.pid) { try { process.kill(s.pid) } catch { /* 已经退了 */ } }
      // 还没连上就退了：起不来（多半是网络连不上 Cloudflare，或者本机的 cloudflared 配置文件不对）；连上以后退了：断了
      finish(session, s.state === 'starting' ? { error: 'tunnel', message: lastError(s.out) || `exit ${code}` } : { ended: 'dropped' }, s)
    })
    s.readyTimer = setTimeout(() => {
      if (shares.get(session) === s && s.state === 'starting') finish(session, { error: 'timeout', message: lastError(s.out) }, s)
    }, readyMs)
    s.ttlTimer = setTimeout(() => { if (shares.get(session) === s) finish(session, { ended: 'expired' }, s) }, ttlMs)
    // 电脑睡着时定时器不走：醒来靠这个每 5 秒的检查补上（到点、换了设计、通道断了）
    s.guardTimer = setInterval(() => { guard(s).catch((e) => log(e)) }, guardMs)
    for (const tm of [s.readyTimer, s.ttlTimer, s.guardTimer]) if (tm.unref) tm.unref()
    return status(session)
  }

  /** 右侧栏换了屏、画幅、深浅色：下次有人打开按新的打包 */
  function update(session, params) {
    const s = shares.get(session)
    if (!s || !params) return false
    if (s.params && params.root !== s.params.root) return false // 换了设计不跟着换：那是关掉（guard），不是悄悄换一份放出去
    if (s.keys && Array.isArray(params.screens)) {
      // 只认生成时那几屏（删掉的去掉，新加的不放）；都没了就不换
      const screens = params.screens.filter((x) => x && s.keys.has(x.key))
      if (!screens.length) return false
      params = { ...params, screens }
    }
    if (JSON.stringify(params) === JSON.stringify(s.params)) return true
    s.params = params
    s.labels = params.screens ? params.screens.map((x) => String(x.label || x.key || '').slice(0, 80)) : s.labels
    s.dirty = true // 参数变了马上重打，旧成品和失败提示保留到新成品可用
    return true
  }

  /**
   * 关：杀通道进程、关小服务、断开所有连接，旧链接马上失效
   * @param only 只关这一个（迟到的定时器、退出事件别把同一会话新开的那个关了）
   */
  function finish(session, why = {}, only = null) {
    const s = shares.get(session)
    if (!s || (only && s !== only)) return
    shares.delete(session)
    if (why.error || why.ended) ended.set(session, why)
    clearTimeout(s.readyTimer)
    clearTimeout(s.ttlTimer)
    clearInterval(s.guardTimer)
    const c = s.child
    if (c) {
      try { if (c.stdin) c.stdin.end() } catch { /* 已经断了 */ }
      if (s.pid) { try { process.kill(s.pid) } catch { /* 已经退了 */ } }
      // 看门进程收到 stdin 断了会自己收尾；万一它卡住，过一会儿再杀它（cloudflared 上面已经直接杀过）
      const tm = setTimeout(() => { try { c.kill() } catch { /* 已经退了 */ } }, 5000)
      if (tm.unref) tm.unref()
    }
    for (const sock of s.sockets) sock.destroy()
    try { s.server.close() } catch { /* 没开起来 */ }
  }

  function stop(session) {
    ended.delete(session)
    finish(session)
  }

  function stopAll() {
    for (const k of [...shares.keys()]) finish(k)
  }

  /** 本机找不找得到 cloudflared（右侧栏开面板时问一下：没有就先说要下载） */
  function hasTool() {
    return !!find()
  }

  // ── 小服务 ──────────────────────────────────────────────────────────────

  function pack(params) {
    const r = build(params)
    const html = Buffer.from(r.html, 'utf8')
    return {
      html,
      gz: zlib.gzipSync(html, { level: 6 }),
      etag: '"' + crypto.createHash('sha1').update(html).digest('base64url').slice(0, 22) + '"',
      deps: signatures(params.root, r.deps || []),
    }
  }

  /** 参数变了立刻重打。文件变化按最近一次尝试时的内容判断，包括失败时读到的新依赖。 */
  function current(s) {
    const at = now()
    if (!s.dirty && at - s.checkedAt < CHECK_MS) return s.cache
    s.checkedAt = at
    const next = signatures(s.params.root, s.attemptedDeps.keys())
    const changed = [...next].some(([f, sig]) => sig !== s.attemptedDeps.get(f))
    if (!s.dirty && !changed) return s.cache
    s.dirty = false
    try {
      s.cache = pack(s.params)
      s.attemptedDeps = s.cache.deps
      s.broken = ''
      s.brokenMsg = ''
    } catch (e) {
      // 打包器可把这次读过或缺少的文件绝对路径放进 err.deps，补上新依赖也能触发恢复。
      const deps = Array.isArray(e?.deps) ? e.deps.filter((f) => !next.has(f)) : []
      s.attemptedDeps = new Map([...next, ...signatures(s.params.root, deps)])
      s.broken = e?.code || 'pack'
      s.brokenMsg = `新版本没发布：${String(e?.message || e?.code || e || '打包失败').replace(/\s*\r?\n\s*/g, ' ').slice(0, 200)}`
      log(e)
    }
    return s.cache
  }

  function handle(s, req, res) {
    const p = String(req.url || '').split('?')[0]
    // 已经关了（迟到的请求）、到点了、这个会话换了设计：回 404，顺手关掉
    const why = shares.get(s.session) === s ? gone(s) : { ended: '' }
    if (why) {
      if (why.ended) {
        const end = () => finish(s.session, why, s)
        res.once('finish', end)
        res.once('close', end)
      }
      return send(res, 404, NOT_FOUND)
    }
    // 只认这一个地址（带不带结尾的 /），别的一律同一个 404
    if ((req.method !== 'GET' && req.method !== 'HEAD') || (p !== '/' + s.token && p !== '/' + s.token + '/')) return send(res, 404, NOT_FOUND)
    const c = current(s)
    if (!c) return send(res, 503, BUSY)
    const headers = { ...SAFE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: c.etag, Vary: 'Accept-Encoding' }
    if (String(req.headers['if-none-match'] || '') === c.etag) {
      res.writeHead(304, headers)
      return res.end()
    }
    if (req.method === 'GET') s.views++
    const gz = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))
    const body = gz ? c.gz : c.html
    res.writeHead(200, { ...headers, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /** 测试用：本机小服务的端口、口令、通道进程 */
  function _inspect(session) {
    const s = shares.get(session)
    return s ? { port: s.port, token: s.token, pid: s.pid || 0, watchdog: s.child ? s.child.pid : 0, metrics: s.metrics } : null
  }

  return { start, update, stop, stopAll, status, fetchTool, cancelTool, hasTool, _inspect }
}

function send(res, code, html) {
  const body = Buffer.from(html, 'utf8')
  res.writeHead(code, { ...SAFE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length })
  res.end(body)
}

function signatures(root, files) {
  const out = new Map()
  let base
  try { base = fs.realpathSync(root) } catch { /* 设计目录已不在 */ }
  const buf = Buffer.allocUnsafe(64 * 1024)
  for (const file of files) {
    if (!out.has(file)) out.set(file, base ? fileSignature(base, file, buf) : 'none')
  }
  return out
}

function fileSignature(base, file, buf) {
  let fd
  try {
    const real = fs.realpathSync(file)
    const rel = path.relative(base, real)
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return 'outside'
    const before = fs.statSync(real)
    if (!before.isFile()) return 'none'
    const large = (st) => `big:${st.size}:${st.mtimeMs}`
    if (before.size > PACK_FILE_MAX) return large(before)
    fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
    const st = fs.fstatSync(fd)
    if (!st.isFile() || st.dev !== before.dev || st.ino !== before.ino) return 'none'
    if (st.size > PACK_FILE_MAX) return large(st)
    // 按打开时的大小读，文件同时增长也不会超出单文件预算。
    const hash = crypto.createHash('sha1')
    let left = st.size
    while (left > 0) {
      const n = fs.readSync(fd, buf, 0, Math.min(left, buf.length), null)
      if (n === 0) break
      hash.update(buf.subarray(0, n))
      left -= n
    }
    return hash.digest('hex')
  } catch { return 'none' } // 文件还没建、已删或读不了
  finally { if (fd !== undefined) fs.closeSync(fd) }
}

/** cloudflared 输出里最后一条报错（ERR / failed），给右侧栏看；不带本机路径 */
function lastError(out) {
  const lines = String(out || '').split(/\r?\n/).filter((l) => /\bERR\b|error|failed|unable|cannot/i.test(l) && !/ddp-tunnel-pid/.test(l))
  const l = lines.length ? lines[lines.length - 1] : ''
  return l.replace(/^\S+\s+(ERR|WRN|INF)\s+/, '').replace(/(\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s"']+/g, '…').slice(0, 200)
}
