/**
 * 无头浏览器：check_design / look_design 在电脑上另开一个看不见的 Chrome（或 Edge、Chromium、Brave），
 * 按指定尺寸打开预览页面，量问题、截真实像素的图。和右侧栏开没开、用户在看哪一屏、画布怎么摆都无关。
 *
 * 用 --remote-debugging-pipe 和它说话（不开端口，别的程序连不进来）；临时用户目录，用完删掉；
 * 闲置一会儿自己关，插件停用时一起关。找不到浏览器 → available() 是 false，调用的地方退回右侧栏量。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'

const IDLE_MS = 90000 // 闲置多久关掉
const CALL_MS = 30000 // 一条指令最多等多久
const LOAD_MS = 15000 // 页面载入最多等多久（到点照样往下走：有个图一直载不完也能量）
const MAX_PAGES = 3 // 同时开几个页面

/** 这台电脑上的 Chromium 系浏览器；DSH_DESIGN_BROWSER / CHROME_BIN 可以指定 */
export function findBrowser({ env = process.env, platform = process.platform, exists = fs.existsSync, home = os.homedir() } = {}) {
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
  const mac = (app, bin) => [`/Applications/${app}.app/Contents/MacOS/${bin}`, `${home}/Applications/${app}.app/Contents/MacOS/${bin}`]
  const list = {
    darwin: [...mac('Google Chrome', 'Google Chrome'), ...mac('Microsoft Edge', 'Microsoft Edge'), ...mac('Chromium', 'Chromium'), ...mac('Brave Browser', 'Brave Browser')],
    win32: roots.flatMap((d) => [`${d}\\Google\\Chrome\\Application\\chrome.exe`, `${d}\\Microsoft\\Edge\\Application\\msedge.exe`, `${d}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`]),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'],
  }
  for (const p of [env.DSH_DESIGN_BROWSER, env.CHROME_BIN, ...(list[platform] || [])]) {
    if (!p) continue
    try { if (exists(p)) return p } catch { /* 读不了就下一个 */ }
  }
  return null
}

/** CDP 管道上的消息：JSON 后面跟一个 \0。一块数据里可能有半条、也可能有好几条 */
export function frameReader(onMsg) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    let i
    while ((i = buf.indexOf(0)) >= 0) {
      const text = buf.subarray(0, i).toString('utf8')
      buf = buf.subarray(i + 1)
      let msg
      try { msg = JSON.parse(text) } catch { continue }
      onMsg(msg)
    }
  }
}

const PREFIX = 'dsh-design-browser-'
const STALE_MS = 3600 * 1000 // 一小时没动过的临时用户目录：上回没删掉的（DSH 被强退、插件进程直接退出）
let swept = false

/** 清掉以前留下的临时用户目录（每个进程只扫一次；正在用的浏览器闲置 90 秒就关，不会一小时不动） */
function sweep(dir = os.tmpdir(), now = Date.now()) {
  if (swept) return
  swept = true
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const n of names) {
    if (!n.startsWith(PREFIX)) continue
    const p = path.join(dir, n)
    try { if (now - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { recursive: true, force: true }) } catch { /* 下次再说 */ }
  }
}

export function createBrowser({ bin = findBrowser(), log = () => {}, idleMs = IDLE_MS, launch = spawn, platform = process.platform } = {}) {
  let proc = null
  let starting = null
  let dir = ''
  let seq = 0
  let open = 0
  let idle = null
  let dead = false // destroy() 之后：不再开浏览器，排队的、新来的都直接失败
  const pending = new Map() // 指令 id → { resolve, reject, timer }
  const waiters = new Set() // 等事件的：{ method, sessionId, done }
  const queue = [] // 等空位开页面的

  const fail = (err) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err) }
    pending.clear()
  }

  const onMsg = (msg) => {
    if (msg.id) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error.message || 'cdp error'))
      else p.resolve(msg.result || {})
      return
    }
    for (const w of [...waiters]) if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) w.done(msg.params || {})
  }

  function call(method, params = {}, sessionId) {
    if (!proc) return Promise.reject(new Error('browser not running'))
    return new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timeout`)) }, CALL_MS)
      pending.set(id, { resolve, reject, timer })
      try { proc.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`) } catch (e) { pending.delete(id); clearTimeout(timer); reject(e) }
    })
  }

  /** 等一个事件（到点就当等到了，返回 null） */
  function once(method, sessionId, ms) {
    let w
    const p = new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(w); resolve(null) }, ms)
      w = { method, sessionId, done: (v) => { clearTimeout(timer); waiters.delete(w); resolve(v) } }
      waiters.add(w)
    })
    return p
  }

  /** 一直听某个事件（不像 once 只等一次）；返回取消的函数 */
  function listen(method, sessionId, fn) {
    const w = { method, sessionId, done: (v) => { if (v) fn(v) } }
    waiters.add(w)
    return () => waiters.delete(w)
  }

  // 宿主进程退出时浏览器来不及报「退出了」：那时同步删掉临时目录
  let onHostExit = null
  function cleanup() {
    if (onHostExit) { process.removeListener('exit', onHostExit); onHostExit = null }
    proc = null
    starting = null
    fail(new Error('browser exited'))
    for (const w of [...waiters]) w.done(null) // 等页面载入的不用再等了
    const d = dir
    dir = ''
    // 自己建的临时用户目录：浏览器退了马上删（Windows 上进程刚退时文件可能还占着，隔一会儿再试，最多三次；
    // 还删不掉的，下次开浏览器时按时间清掉）
    if (d) {
      let tries = 0
      const rm = () => {
        try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {
          if (++tries < 4) setTimeout(rm, 2000).unref?.()
          else log(new Error(`临时目录删不掉，留在 ${d}：${e && e.message}`))
        }
      }
      rm()
    }
  }

  async function start() {
    if (proc) return
    if (starting) return starting
    if (!bin) throw new Error('no-browser')
    if (dead) throw new Error('browser closed')
    sweep()
    starting = (async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
      const d = dir
      onHostExit = () => { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 下次开浏览器时按时间清 */ } }
      process.once('exit', onHostExit)
      const args = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-default-apps', '--disable-component-update',
        '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb',
        ...(platform === 'darwin' ? ['--use-mock-keychain'] : []),
        ...(platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
        'about:blank']
      const p = launch(bin, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
      proc = p
      p.on('exit', () => { if (proc === p) cleanup() })
      p.on('error', (e) => { log(e); if (proc === p) cleanup() })
      p.stdio[4].on('data', frameReader(onMsg))
      p.stdio[3].on('error', () => {})
      await call('Browser.getVersion')
    })()
    try { await starting } catch (e) { stop(); throw e } finally { starting = null }
  }

  function stop() {
    clearTimeout(idle)
    const p = proc
    if (!p) return
    try { p.stdio[3].end() } catch { /* 已经断了 */ }
    if (platform === 'win32') {
      execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], (err) => {
        if (!err) return
        log(err)
        try { p.kill() } catch { /* 已经退了 */ }
      })
    } else { try { p.kill('SIGKILL') } catch { /* 已经退了 */ } }
  }

  /** 插件停用：关掉浏览器，排队等页面的都失败，之后再也不开 */
  function destroy() {
    dead = true
    for (const next of queue.splice(0)) next()
    stop()
  }

  const touch = () => {
    clearTimeout(idle)
    if (!open) idle = setTimeout(() => { if (!open) stop() }, idleMs)
  }

  /**
   * 开一个 w×h 的页面载入 url，fn(page) 里量 / 截图，完了关掉。
   *   page.eval(表达式)：在页面里算（Promise 会等），返回 JSON 值
   *   page.shot({ clip, format })：截视口；clip（{ x, y, width, height }，CSS 像素，按整页坐标 = 视口位置 + 滚动距离）只截那一块 → JPEG Buffer（format: 'png' 无损）
   *   allow(网址)：给了就只让它说行的页面载入（主页面、iframe，连跳转、脚本改地址都算），别的拦下，记在 page.blocked
   */
  async function withPage({ url, w, h, scale = 1, dark = false, allow = null }, fn) {
    if (dead) throw new Error('browser closed')
    if (open >= MAX_PAGES) await new Promise((r) => queue.push(r))
    if (dead) throw new Error('browser closed')
    open++
    clearTimeout(idle)
    let targetId = ''
    let unlisten = null
    const blocked = []
    try {
      await start()
      ;({ targetId } = await call('Target.createTarget', { url: 'about:blank' }))
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
      const c = (m, p) => call(m, p, sessionId)
      if (allow) {
        // 每个页面请求（包括 302 之后的每一跳）先停下来问一遍，不行就当被拦了
        unlisten = listen('Fetch.requestPaused', sessionId, (q) => {
          let ok = false
          try { ok = !!allow(q.request.url) } catch { ok = false }
          if (!ok && blocked.length < 10) blocked.push(q.request.url)
          c(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: q.requestId } : { requestId: q.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
        })
        await c('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] })
      }
      await c('Page.enable')
      // 和右侧栏里一样按桌面方式排版（mobile: false）：页面宽就是 w，不看 <meta viewport>
      await c('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false })
      await c('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
      const loaded = once('Page.loadEventFired', sessionId, LOAD_MS)
      const nav = await c('Page.navigate', { url })
      if (nav.errorText) throw new Error(blocked.length ? `不是允许的地址，没打开：${blocked[0].slice(0, 120)}` : nav.errorText)
      await loaded
      const page = {
        eval: async (expression) => {
          const r = await c('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'eval failed')
          return r.result ? r.result.value : undefined
        },
        shot: async ({ clip, quality = 82, format = 'jpeg' } = {}) => {
          const r = await c('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
          return Buffer.from(r.data, 'base64')
        },
        blocked,
      }
      return await fn(page)
    } finally {
      if (unlisten) unlisten()
      if (targetId && proc) call('Target.closeTarget', { targetId }).catch(() => {})
      open--
      const next = queue.shift()
      if (next) next()
      touch()
    }
  }

  return {
    available: () => !!bin,
    bin: () => bin,
    withPage,
    stop,
    destroy,
    running: () => !!proc,
  }
}
