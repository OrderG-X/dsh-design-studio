/**
 * 画布上睡着的屏的缩略图（issue #17）：屏多时画布只挂离镜头近的 LIVE_MAX 屏，别的屏先放一张无头浏览器截的图，挪近了再换成真页面。
 *
 *   GET scrthumb ?session=&root=&key=&w=&h=&dark=   → JPEG（取不到 404 / 503，页面上照旧显示「挪近就加载」）。响应头：
 *     X-Dsh-Title 页面标题；X-Dsh-Thumb 这张图的名字（同一张页面就不换）；X-Dsh-Recheck 目录没在监听（改了不会通知）时，过几秒再来要
 *
 * 只截本地文件的设计：开发服务器的页面别在后台再开一份（可能会发请求、改数据）。root 必须是这个会话现在开着的目录
 * （换了设计，晚到的请求不会拿新设计的图冒充），key 必须是它现在的某一屏。
 * 按「这屏 HTML 的修改时间和大小 + 目录里别的文件（样式、图片…；会嵌别的 HTML 的屏连别的 HTML）的清单和修改时间 + 信任指纹 + 画幅 + 深浅色」缓存在
 * ~/.dsh/cache/dsh-design-studio/canvas/，同一屏只留最新那张，总数超了删最旧的。浏览器那边不缓存（地址相同不代表图相同）。
 * 同一屏同时只截一张，一次最多截 RUN 张（别挤掉体检），排着队的没人等了（页面关了、换了设计）就不截了。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepare } from './look.js'

export const THUMB_DIR = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'canvas')
const WIDTH = 480 // 截出来最宽多少像素：睡着的屏都是缩得很小的时候看的
const KEEP = 1500 // 缓存最多留几张
const RUN = 2 // 同时截几张
const ASSET_MS = 1500 // 目录没报改动时，别的文件多久重新扫一次（报了改动立刻重扫）
const BLIND_MS = 10_000 // 没扫全、又没在监听的目录：截的图只认这么久
const RECHECK_S = 10 // 目录没在监听时，页面隔几秒再来要一次
const HTML_RE = /\.html?$/i
const SKIP_DIRS = new Set(['node_modules', '.git', '__dsh_design__'])

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')
// 按字（码点）截短：别把 emoji 劈成半个（响应头编码会抛错）
const cut = (s, n) => Array.from(String(s || '')).slice(0, n).join('')
const intIn = (v, lo, hi) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : 0
}

/**
 * 目录里文件的指纹：路径、修改时间、大小（加、删、改名、改内容都会变）。
 * v：HTML 以外的（样式、脚本、图片、字体…，每屏都可能用到）；h：别的 HTML（只有会嵌 / 载别的 HTML 的屏才看）。
 * partial：没扫全（太深、太多），扫不到的那些变了指纹不变
 */
export function assetScan(root, { maxFiles = 3000, depth = 6 } = {}) {
  const found = []
  const pages = []
  let seen = 0
  let partial = false
  const walk = (dir, d) => {
    let list = []
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (++seen > maxFiles) { partial = true; return }
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        if (d < depth) walk(p, d + 1)
        else partial = true
        continue
      }
      if (!e.isFile()) continue
      try {
        const st = fs.statSync(p)
        ;(HTML_RE.test(e.name) ? pages : found).push(`${path.relative(root, p)}\0${Math.round(st.mtimeMs)}\0${st.size}`)
      } catch { /* 刚删了 */ }
    }
  }
  walk(root, 0)
  return { v: sha1(found.sort().join('\n')).slice(0, 12), h: sha1(pages.sort().join('\n')).slice(0, 12), partial }
}
export const assetStamp = (root, opts) => assetScan(root, opts).v

// 这屏会不会把别的 HTML 嵌进来 / 载进来（iframe、fetch…）：会的话别的 HTML 改了它的样子也可能变。宁可多算：
// 引了本地脚本（<script src="app.js">，脚本里可能 fetch）、module 脚本（可能 import 本地脚本）也算；只引 CDN 上的脚本（http(s):、//、data:）不算
const DEPS_RE = /<(?:iframe|frame|embed|object|portal)\b|\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|\bhx-(?:get|post|put|patch|delete)\b|\.load\s*\(|<link\b[^>]*\bimport\b|<script\b[^>]*\btype\s*=\s*["']?module\b|<script\b[^>]*?\bsrc\s*=\s*(?:["']|(?=[^\s"'>]))(?!\s*(?:(?:https?:)?\/\/|data:))/i
const DEPS_MAX = 4 << 20

/**
 * 每个目录的修订号，所有会话共用。预览服务器开始监听它、报它有改动、不再监听（关了、出错）都 +1。
 * 只有正在好好监听的目录才给记号（token）；没在听的给 ''：那时改了什么不知道。
 * 记号带这一份的随机前缀：重启、插件重新启用都换新的，不会和以前的号撞上
 */
export function createDirRevs() {
  const boot = crypto.randomBytes(6).toString('hex')
  const revs = new Map() // 目录 → { n, live, turns }
  const get = (root) => {
    const k = path.resolve(root)
    let r = revs.get(k)
    if (!r) { r = { n: 0, live: false, turns: 0 }; revs.set(k, r) }
    return r
  }
  return {
    token: (root) => { const r = revs.get(path.resolve(root)); return r && r.live ? `${boot}.${r.n}` : '' },
    // 给页面看的：开始 / 停止监听就变（改动不变，改动页面另有 changedAt），页面的缩略图按它重新要
    tag: (root) => { const r = revs.get(path.resolve(root)); return r ? `${r.live ? 'on' : 'off'}.${boot}.${r.turns}` : 'off' },
    watched: (root) => { const r = get(root); r.n++; r.turns++; r.live = true },
    unwatched: (root) => { const r = get(root); r.n++; r.turns++; r.live = false },
    touched: (root) => { get(root).n++ },
  }
}

export function createCanvasThumbs({ tracker, browser, trust = () => '', strictRoot = () => false, admit, json, log = () => {}, dirs = createDirRevs(), dir = THUMB_DIR, run = RUN, keep = KEEP, assetMs = ASSET_MS, blindMs = BLIND_MS }) {
  const assets = new Map() // 目录 → { at, tok, scan }
  // 目录的记号变了（报了改动、重新监听）就重扫，没变的话 assetMs 内复用；force 一律重扫
  const assetsOf = (root, force) => {
    const now = Date.now()
    const tok = dirs.token(root)
    const a = assets.get(root)
    if (!force && a && a.tok === tok && now - a.at < assetMs) return a.scan
    const scan = assetScan(root)
    assets.delete(root)
    assets.set(root, { at: now, tok, scan })
    if (assets.size > 50) assets.delete(assets.keys().next().value)
    return scan
  }
  const deps = new Map() // 文件|mtime|size → 会不会嵌别的 HTML
  const depsOf = (file, st) => {
    const k = `${file}|${Math.round(st.mtimeMs)}|${st.size}`
    if (deps.has(k)) return deps.get(k)
    let v = true // 读不了、太大：当它会
    try { if (st.size <= DEPS_MAX) v = DEPS_RE.test(fs.readFileSync(file, 'utf8')) } catch { v = true }
    deps.set(k, v)
    if (deps.size > 500) deps.delete(deps.keys().next().value)
    return v
  }
  // 这屏现在的样子的记号：HTML 本身、别的文件（会嵌别的 HTML 的屏连别的 HTML 一起）、信任（别人做的设计按硬规矩预览，截出来不一样）。
  // 没扫全的大目录：再拼上目录的记号（扫不到的深处改了也重截；代价是那种目录里改任何文件，睡着的屏都重截）；
  // 目录没在好好监听（记号空）时改了什么不知道：按 blindMs 一段一段地重截
  const stampOf = (o, force = false) => {
    const file = path.join(o.root, o.key)
    const st = fs.statSync(file)
    const scan = assetsOf(o.root, force)
    const parts = [Math.round(st.mtimeMs), st.size, scan.v, depsOf(file, st) ? scan.h : '', trust()]
    if (scan.partial) parts.push(dirs.token(o.root) || `?${Math.floor(Date.now() / blindMs)}`)
    return sha1(parts.join('|')).slice(0, 12)
  }

  const jobs = new Map() // 一屏（目录 + key + 画幅 + 深浅色）→ 正在截 / 排着队的那一次
  const queue = []
  let running = 0
  let writes = 0

  // 每张图旁边一个 .json 记页面标题（右侧栏没载过的屏也能显示标题，不只是文件名）
  const baseOf = (n) => n.replace(/\.(jpg|json)$/, '')
  const titleOf = (file) => {
    try { return cut(JSON.parse(fs.readFileSync(file.replace(/\.jpg$/, '.json'), 'utf8')).title, 80) } catch { return '' }
  }

  // 每次落盘都来：fresh（截完文件没再变）才删这屏别的旧图；总数每 40 次查一回（截完文件又变了的那张也算数，下次这屏截新图时一起删）
  function prune(id, keep1, fresh) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { return }
    if (fresh) for (const n of names) if (n.startsWith(id + '-') && baseOf(n) !== keep1) fs.rmSync(path.join(dir, n), { force: true })
    if (++writes % 40 !== 0 || names.length <= keep * 2) return
    // 总数超了：删最旧的（连同它的标题）
    const all = []
    for (const n of names) {
      if (!n.endsWith('.jpg')) continue
      try { all.push([fs.statSync(path.join(dir, n)).mtimeMs, baseOf(n)]) } catch { /* 刚删了 */ }
    }
    all.sort((a, b) => a[0] - b[0])
    for (const [, b] of all.slice(0, Math.max(0, all.length - keep))) for (const ext of ['.jpg', '.json']) fs.rmSync(path.join(dir, b + ext), { force: true })
  }

  async function capture(job) {
    const { o } = job
    const stamp = stampOf(o)
    job.stamp = stamp
    const name = `${job.id}-${stamp}`
    const file = path.join(dir, name + '.jpg')
    if (fs.existsSync(file)) return { file, title: titleOf(file) }
    const b = browser()
    if (!b || !b.available()) throw new Error('no browser')
    let title = ''
    const jpg = await b.withPage({ url: o.url, w: o.w, h: o.h, scale: Math.min(1, WIDTH / o.w), dark: o.dark, offline: strictRoot(o.root) }, async (page) => {
      const { info } = await prepare(page, o.dark)
      title = cut(String((info && info.title) || '').replace(/\s+/g, ' ').trim(), 80)
      return page.shot({ quality: 72 })
    })
    fs.mkdirSync(dir, { recursive: true })
    // 标题先落地、图后落地：看得到图就一定有标题
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ title }))
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, jpg)
    fs.renameSync(tmp, file)
    // 截的时候文件又改了：这张留给等着的人，但别把（可能已经截好的）新的那张当旧的删了
    let fresh = false
    try { fresh = stampOf(o, true) === stamp } catch { fresh = false }
    prune(job.id, name, fresh)
    return { file, title }
  }

  function pump() {
    while (running < run && queue.length) {
      const job = queue.shift()
      if (job.waiters <= 0) { // 没人等了：不截
        if (jobs.get(job.id) === job) jobs.delete(job.id)
        job.reject(Object.assign(new Error('gone'), { code: 'gone' }))
        continue
      }
      running++
      job.started = true
      capture(job).then(job.resolve, job.reject).finally(() => {
        running--
        if (jobs.get(job.id) === job) jobs.delete(job.id)
        pump()
      })
    }
  }

  /** 这屏的缩略图 { file, title }（要截就排队）。onLeave 交出「这个请求不等了」的回调 */
  function thumb(o, onLeave) {
    const id = sha1([path.resolve(o.root), o.key, o.w, o.h, o.dark ? 1 : 0].join('\0')).slice(0, 20)
    const stamp = stampOf(o) // 文件没了这里就抛
    const file = path.join(dir, `${id}-${stamp}.jpg`)
    if (fs.existsSync(file)) return Promise.resolve({ file, title: titleOf(file) })
    let job = jobs.get(id)
    // 已经在截的是改之前的样子：另排一次（截完的那次不会把这次从表里删掉）
    if (job && job.started && job.stamp && job.stamp !== stamp) job = null
    if (!job) {
      job = { id, o, waiters: 0, started: false, stamp: '' }
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject })
      job.promise.catch(() => {})
      jobs.set(id, job)
      queue.push(job)
    } else if (!job.started) job.o = o // 排着队还没截：按最新的地址截
    job.waiters++
    let left = false
    const leave = () => { if (!left) { left = true; job.waiters-- } }
    onLeave(leave)
    pump()
    return job.promise.finally(leave)
  }

  async function route(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    const q = new URL(req.url, 'http://x').searchParams
    const sid = q.get('session') || ''
    const root = q.get('root') || ''
    const key = q.get('key') || ''
    const w = intIn(q.get('w'), 100, 8000)
    const h = intIn(q.get('h'), 100, 8000)
    if (!sid || !root || !key || !w || !h) return json(res, 400, { error: 'bad request' })
    const snap = tracker.snapshot(sid)
    const t = snap && snap.target
    if (!t || t.kind !== 'file' || !t.root) return json(res, 404, { error: 'not a local design' })
    if (t.root !== root) return json(res, 404, { error: 'design changed' })
    const sc = (snap.screens || []).find((x) => x.key === key)
    if (!sc || !HTML_RE.test(key)) return json(res, 404, { error: 'no such screen' })
    const b = browser()
    if (!b || !b.available()) return json(res, 503, { error: 'no browser' })
    let got
    let buf = null
    try {
      // 先整张读进来再回：拿到路径和读之间，这张可能刚被同一屏的新图顶掉删了，那就再要一次（这回给的是新的）
      for (let i = 0; i < 2 && !buf; i++) {
        got = await thumb({ root: t.root, key, url: sc.url, w, h, dark: q.get('dark') === '1' }, (leave) => res.on('close', leave))
        try { buf = await fs.promises.readFile(got.file) } catch (e) { if (e.code !== 'ENOENT') throw e }
      }
    } catch (e) {
      if (e.code !== 'gone' && e.code !== 'ENOENT') log(e)
      if (!res.headersSent) json(res, e.code === 'ENOENT' ? 404 : 503, { error: 'thumb failed' })
      return
    }
    if (res.destroyed || res.headersSent) return
    if (!buf || !buf.length) return json(res, 503, { error: 'thumb failed' })
    let title = ''
    try { title = encodeURIComponent(got.title || '') } catch { title = '' }
    // 标题放在响应头里（页面用 fetch 取图，顺手拿到）
    const head = { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Dsh-Title': title, 'X-Dsh-Thumb': path.basename(got.file) }
    if (!dirs.token(t.root)) head['X-Dsh-Recheck'] = String(RECHECK_S) // 没在监听：改了不会通知页面，让它自己隔一会儿再来要
    res.writeHead(200, head)
    res.end(buf)
  }

  return { route, thumb, pending: () => queue.length + running }
}
