/**
 * 设计市场（插件这头）：从 npm 镜像取目录、验签名、缓存；取内容批次、逐个文件核对；断网用缓存
 *
 *   目录包 dsh-design-gallery：index.json + index.json.sig（ed25519，签原始字节）+ thumbs/<id>.webp
 *   批次包 dsh-design-gallery-packs@<v>：d/<id>/<rev>/ 下是设计文件和 _shots/ 每屏截图
 *
 * 信任只来自两样：钉在这里的公钥（验目录签名），和目录里每个文件的 sha256（验批次包里的文件、封面、截图）。
 * 镜像、跳转、tarball 都按不可信处理：主机白名单、大小上限、超时；tarball 有 integrity 就核对。
 *
 * 本机：
 *   缓存   ~/.dsh/cache/dsh-design-studio/gallery/   catalog/（index.json、.sig、thumbs/）、meta.json、packs/<v>.tgz、staging/<id>@<rev>/
 *   状态   ~/.dsh/dsh-design-studio/gallery-state.json  serial 下限、下架名单并集（不放缓存，清缓存也不丢，防旧目录让下架的复活）
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readTar } from './tar.js'
import { cleanPath } from './policy.js'
import { LIBRARY_DIR } from '../works.js'

export const CATALOG_PKG = 'dsh-design-gallery'
export const PACKS_PKG = 'dsh-design-gallery-packs'
export const FORMAT = 1
export const POLICY = 1
export const REPO_URL = 'https://github.com/OrderG-X/dsh-design-gallery'

/**
 * 钉死的公钥（base64 的 32 字节 ed25519 原始公钥）：现用的一把 + 下一次换钥匙用的一把。
 * 钥匙由维护者生成（内容仓库 scripts/sign.mjs keygen），生成后填在这里再发版。空着时市场只显示自带的。
 */
export const KEYS = []

export const REGISTRIES = [
  'https://registry.npmmirror.com',
  'https://mirrors.cloud.tencent.com/npm',
  'https://repo.huaweicloud.com/repository/npm',
  'https://registry.npmjs.org',
]
// 跳转和 tarball 只认这些主机（npmmirror 的 tarball 会跳到 cdn.npmmirror.com）
const HOSTS = new Set(['registry.npmmirror.com', 'cdn.npmmirror.com', 'mirrors.cloud.tencent.com', 'repo.huaweicloud.com', 'registry.npmjs.org'])

export const CACHE_DIR = process.env.DSH_DESIGN_GALLERY_CACHE || path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'gallery')
export const STALE_MS = 3600e3
export const RETRY_MS = 300e3 // 自动刷新失败后，过这么久才再自动试（手动点「刷新」不受限）
const PACKS_CAP = 300 * 1024 * 1024
const MAX = { json: 8 * 1024 * 1024, catalog: 40 * 1024 * 1024, packs: 40 * 1024 * 1024 }
export const ID_RE = /^[a-z0-9-]{1,39}__[a-z0-9-]{3,40}$/
const REV_RE = /^[0-9a-f]{7,64}$/
const VER_RE = /^\d{4}\.\d{3,4}\.\d{1,4}$/

export class MarketError extends Error {
  constructor(code, x = '') {
    super(`${code}${x ? ': ' + x : ''}`)
    this.code = code
    this.x = x
  }
}

/** a 比 b 新返回 1，旧 -1，一样 0（x.y.z，后缀不管） */
export function vcmp(a, b) {
  const pa = String(a || '0').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  return 0
}

const SPKI = Buffer.from('302a300506032b6570032100', 'hex')
/** 目录签名对不对（任何一把钉死的公钥验过就行） */
export function verifyCatalog(bytes, sigB64, keys = KEYS) {
  const sig = Buffer.from(String(sigB64 || '').trim(), 'base64')
  if (sig.length !== 64) return false
  return keys.some((k) => {
    try {
      const raw = Buffer.from(String(k), 'base64')
      if (raw.length !== 32) return false
      return crypto.verify(null, bytes, crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' }), sig)
    } catch { return false }
  })
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

const SHOT_RE = /^_shots\/[^/]+\.jpg$/
const MEDIA_CAP = 2 * 1024 * 1024
/** 目录里登记的一张图：{ p, sha256, size } */
const mediaOk = (m, re) => !!m && typeof m === 'object' && typeof m.p === 'string' && re.test(m.p) && typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.sha256) && Number.isInteger(m.size) && m.size > 0 && m.size <= MEDIA_CAP
const sameMedia = (m, buf) => !!buf && buf.length === m.size && sha256(buf) === m.sha256
/** 一套登记了的截图（格式不对的不认） */
export const shotsOf = (e) => (e && Array.isArray(e.shots) ? e.shots : []).filter((x) => mediaOk(x, SHOT_RE))
/** 一套登记了的封面（路径只能是 thumbs/<id>.webp） */
export const thumbOf = (e) => (e && mediaOk(e.thumb, /^thumbs\/[a-z0-9_-]+\.webp$/) && e.thumb.p === `thumbs/${e.id}.webp` ? e.thumb : null)

/** 读 tgz；坏包（越界路径、链接、超限）整个拒 */
function untar(buf, limits) {
  try { return readTar(buf, limits) } catch (e) { throw new MarketError('tar', e && e.code ? e.code : '') }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

/** 读响应体，超过上限就停（声明的长度不可信） */
async function readCapped(res, cap) {
  const len = Number(res.headers.get('content-length') || 0)
  if (len > cap) throw new MarketError('big')
  if (!res.body) return Buffer.alloc(0)
  const chunks = []
  let n = 0
  for await (const c of res.body) {
    n += c.length
    if (n > cap) throw new MarketError('big')
    chunks.push(Buffer.from(c))
  }
  return Buffer.concat(chunks)
}

/** 包名 + 镜像列表（环境变量 DSH_DESIGN_GALLERY_REGISTRY 可以换成自己的，逗号隔开；测试用） */
export function registriesFromEnv(env = process.env) {
  const own = String(env.DSH_DESIGN_GALLERY_REGISTRY || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => /^https?:\/\//.test(s))
  return own.length ? own : REGISTRIES
}
/** 测试用：只有换了镜像时才认环境变量里多给的公钥 */
export function keysFromEnv(env = process.env) {
  if (!String(env.DSH_DESIGN_GALLERY_REGISTRY || '').trim()) return KEYS
  const extra = String(env.DSH_DESIGN_GALLERY_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return [...KEYS, ...extra]
}

/**
 * 依次试几个源：第一个马上发，后面的每隔 stagger 再发一个（前一个失败了就立刻发下一个）；谁先成功用谁
 * 每个请求 each 毫秒超时，整体 total 毫秒
 */
export function race(sources, task, { stagger = 3000, each = 10000, total = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const all = new AbortController()
    const errs = []
    let next = 0
    let running = 0
    let done = false
    let timer = null
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(cap); all.abort(); fn() }
    const cap = setTimeout(() => finish(() => reject(new MarketError('timeout'))), total)
    const launch = () => {
      if (done || next >= sources.length) return
      const src = sources[next++]
      running++
      clearTimeout(timer)
      timer = setTimeout(launch, stagger)
      const signal = AbortSignal.any([all.signal, AbortSignal.timeout(each)])
      Promise.resolve().then(() => task(src, signal)).then(
        (value) => finish(() => resolve({ value, source: src })),
        (e) => {
          errs.push(e)
          running--
          if (next < sources.length) launch()
          else if (!running) finish(() => reject(errs.length === 1 || errs.every((x) => x && x.code && x.code === errs[0].code) ? errs[0] : new MarketError('offline', errs.map((x) => x && x.code ? x.code : String(x && x.message)).join(','))))
        },
      )
    }
    launch()
  })
}

/**
 * 市场：目录（取、验、缓存、过滤）+ 批次包（取、核对、解到 staging）
 * fetch 可注入（测试）；registries / keys 默认从环境变量来
 */
export function createMarket({
  cacheDir = CACHE_DIR,
  stateDir = LIBRARY_DIR,
  version = '0.0.0',
  fetch: fetchImpl = globalThis.fetch,
  registries = registriesFromEnv(),
  keys = keysFromEnv(),
  seedDir = '',
  log = () => {},
  now = Date.now,
  timing = {},
  online = () => true,
} = {}) {
  const catDir = path.join(cacheDir, 'catalog')
  const packDir = path.join(cacheDir, 'packs')
  const stageDir = path.join(cacheDir, 'staging')
  const metaFile = path.join(cacheDir, 'meta.json')
  const stateFile = path.join(stateDir, 'gallery-state.json')
  const ownHosts = new Set(registries.map((r) => { try { return new URL(r).host } catch { return '' } }).filter(Boolean))
  const hostOk = (u) => { try { const x = new URL(u); return (x.protocol === 'https:' || (x.protocol === 'http:' && ownHosts.has(x.host))) && (HOSTS.has(x.hostname) || ownHosts.has(x.host)) } catch { return false } }

  let loaded = null // { index, bytes, source: 'cache' | 'seed', at }
  let lastError = ''
  let needUpdate = false
  let inflight = null
  let lastFail = 0
  const live = new Set() // 正在进行的请求：打开「不联网」时全部掐掉

  const state = () => {
    const s = readJson(stateFile, null)
    return { serial: Number(s && s.serial) || 0, revoked: Array.isArray(s && s.revoked) ? s.revoked.filter((r) => r && typeof r.id === 'string') : [] }
  }
  function remember(index) {
    const s = state()
    const key = (r) => `${r.id}@${r.rev || ''}`
    const map = new Map(s.revoked.map((r) => [key(r), r]))
    for (const r of index.revoked || []) if (r && typeof r.id === 'string' && ID_RE.test(r.id)) map.set(key(r), { id: r.id, ...(typeof r.rev === 'string' && REV_RE.test(r.rev) ? { rev: r.rev } : {}), reason: String(r.reason || '').slice(0, 20) })
    // 撤销下架：本地的下架名单只认签了名的「撤销名单」才放出来（这一版又下架的不放）
    const again = new Set((index.revoked || []).filter((r) => r && typeof r.id === 'string').map((r) => r.id))
    for (const r of Array.isArray(index.restored) ? index.restored : []) {
      if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id) || again.has(r.id)) continue
      for (const [k, v] of map) if (v.id === r.id) map.delete(k)
    }
    writeAtomic(stateFile, JSON.stringify({ serial: Math.max(s.serial, Number(index.serial) || 0), revoked: [...map.values()].slice(-5000) }, null, 1))
    // 下架的：解开的那份也删掉（用户复制走的作品不动）
    let names = []
    try { names = fs.readdirSync(stageDir) } catch { return }
    for (const r of index.revoked || []) {
      if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id)) continue
      for (const n of names) if (n === `${r.id}@${r.rev}` || (!r.rev && n.startsWith(`${r.id}@`))) try { fs.rmSync(path.join(stageDir, n), { recursive: true, force: true }) } catch { /* 下次再删 */ }
    }
  }
  const isRevoked = (e, s = state()) => s.revoked.some((r) => r.id === e.id && (!r.rev || r.rev === e.rev))

  async function get(url, { signal, cap, accept }) {
    const ctl = new AbortController()
    live.add(ctl)
    const sig = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal
    try {
      let u = url
      for (let hop = 0; hop < 4; hop++) {
        // 每一跳之前都看一眼「不联网」开关（开着就一个网址都不访问）
        if (!online()) throw new MarketError('off')
        if (!hostOk(u)) throw new MarketError('host', (() => { try { return new URL(u).host } catch { return 'bad url' } })())
        const res = await fetchImpl(u, { redirect: 'manual', signal: sig, headers: { 'User-Agent': `dsh-design-studio/${version}`, ...(accept ? { Accept: accept } : {}) } })
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          if (!loc) throw new MarketError('http', String(res.status))
          u = new URL(loc, u).href
          continue
        }
        if (!res.ok) throw new MarketError('http', String(res.status))
        return await readCapped(res, cap)
      }
      throw new MarketError('redirects')
    } catch (e) {
      if (ctl.signal.aborted || !online()) throw new MarketError('off')
      throw e
    } finally {
      live.delete(ctl)
    }
  }
  /** 打开「不联网」：正在下的全部掐掉 */
  function abort() {
    for (const c of [...live]) c.abort()
  }

  /** 一个源上某包的 { version, tarball, integrity }（不给版本就是 latest） */
  async function lookup(reg, name, want, signal) {
    const raw = await get(`${reg}/${name}`, { signal, cap: MAX.json, accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' })
    let doc
    try { doc = JSON.parse(raw.toString('utf8')) } catch { throw new MarketError('json') }
    const v = want || (doc && doc['dist-tags'] && doc['dist-tags'].latest)
    const d = v && doc.versions && doc.versions[v] && doc.versions[v].dist
    if (!d || typeof d.tarball !== 'string') throw new MarketError('nover', String(v || ''))
    return { version: v, tarball: d.tarball, integrity: typeof d.integrity === 'string' ? d.integrity : '' }
  }

  async function download(info, cap, signal) {
    const buf = await get(info.tarball, { signal, cap })
    const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(info.integrity.split(/\s+/).find((x) => x.startsWith('sha512-')) || '')
    if (m && crypto.createHash('sha512').update(buf).digest('base64') !== m[1]) throw new MarketError('integrity')
    return buf
  }

  /** 解析、验签名、查格式和 serial；过了返回 index（不写盘） */
  function accept(bytes, sig, { floor = state().serial } = {}) {
    if (!keys.length) throw new MarketError('nokeys')
    if (!verifyCatalog(bytes, sig, keys)) throw new MarketError('signature')
    let index
    try { index = JSON.parse(bytes.toString('utf8')) } catch { throw new MarketError('json') }
    if (!index || typeof index !== 'object') throw new MarketError('json')
    if (Number(index.format) > FORMAT) { needUpdate = true; throw new MarketError('format', String(index.format)) }
    if (Number(index.format) !== FORMAT) throw new MarketError('format', String(index.format))
    if (!(Number(index.serial) >= floor)) throw new MarketError('old', String(index.serial))
    return index
  }

  function loadCache() {
    try {
      const bytes = fs.readFileSync(path.join(catDir, 'index.json'))
      const sig = fs.readFileSync(path.join(catDir, 'index.json.sig'), 'utf8')
      const meta = readJson(metaFile, {}) || {}
      // 缓存也重新验一遍（在用户自己的目录里，但便宜）；serial 下限也要过（缓存被换成旧的不认）
      const index = accept(bytes, sig)
      return { index, source: 'cache', at: Number(meta.at) || 0, version: meta.version || '', registry: meta.registry || '' }
    } catch (e) {
      if (e.code !== 'ENOENT' && !(e instanceof MarketError && e.code === 'nokeys')) log(e)
      return null
    }
  }
  function loadSeed() {
    if (!seedDir) return null
    const index = readJson(path.join(seedDir, 'index.json'), null)
    return index && Number(index.format) === FORMAT ? { index, source: 'seed', at: 0, version: '', registry: '' } : null
  }
  function current() {
    if (!loaded) loaded = loadCache() || loadSeed()
    return loaded
  }

  /** 去镜像上取最新目录；新就换掉缓存。同时只跑一个 */
  function refresh() {
    if (inflight) return inflight
    const job = (async () => {
      try {
        if (!keys.length) throw new MarketError('nokeys')
        if (!online()) throw new MarketError('off')
        const have = current()
        // 一个源要解开、验过签名、serial 也够新才算成功；坏包、旧目录的源算失败，接着等别的源
        const { value, source } = await race(registries, async (reg, signal) => {
          const info = await lookup(reg, CATALOG_PKG, '', signal)
          if (have && have.source === 'cache' && have.version === info.version && fs.existsSync(path.join(catDir, 'index.json'))) return { info, same: true }
          const buf = await download(info, MAX.catalog, signal)
          const files = untar(buf, { files: 3000, file: 8 * 1024 * 1024, total: MAX.catalog * 3 })
          const idx = files.find((f) => f.path === 'index.json')
          const sig = files.find((f) => f.path === 'index.json.sig')
          if (!idx || !sig) throw new MarketError('incomplete')
          return { info, files, idx, sig, index: accept(idx.data, sig.data.toString('utf8')) }
        }, timing)
        if (!online()) throw new MarketError('off')
        if (value.same) {
          writeAtomic(metaFile, JSON.stringify({ ...(readJson(metaFile, {}) || {}), at: now(), registry: source }))
          loaded = { ...have, at: now(), registry: source }
        } else {
          const { files, idx, sig, index } = value
          // 新目录写到旁边，整个换上去（换的那一下中断了也不会半新半旧）
          const fresh = `${catDir}.new`
          fs.rmSync(fresh, { recursive: true, force: true })
          fs.mkdirSync(path.join(fresh, 'thumbs'), { recursive: true })
          fs.writeFileSync(path.join(fresh, 'index.json'), idx.data)
          fs.writeFileSync(path.join(fresh, 'index.json.sig'), sig.data)
          // 封面只收目录里登记过、sha256 和大小都对得上的（镜像换了图也不认）
          const byId = new Map([...(index.designs || []), ...(index.systems || [])].filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]))
          for (const f of files) {
            const m = /^thumbs\/([a-z0-9_-]+)\.webp$/.exec(f.path)
            const t = m && ID_RE.test(m[1]) && thumbOf(byId.get(m[1]))
            if (t && sameMedia(t, f.data)) fs.writeFileSync(path.join(fresh, 'thumbs', `${m[1]}.webp`), f.data)
          }
          const old = `${catDir}.old`
          fs.rmSync(old, { recursive: true, force: true })
          if (fs.existsSync(catDir)) fs.renameSync(catDir, old)
          fs.renameSync(fresh, catDir)
          fs.rmSync(old, { recursive: true, force: true })
          remember(index)
          writeAtomic(metaFile, JSON.stringify({ version: value.info.version, at: now(), registry: source }))
          loaded = { index, source: 'cache', at: now(), version: value.info.version, registry: source }
        }
        lastError = ''
        lastFail = 0
        return loaded
      } catch (e) {
        if (!(e instanceof MarketError && (e.code === 'off' || e.code === 'nokeys'))) lastFail = now()
        lastError = e instanceof MarketError ? e.code : 'offline'
        if (!(e instanceof MarketError)) log(e)
        throw e
      }
    })()
    // 在外面清：一开头就失败（不联网、没公钥）时 async 函数同步跑完，里面的 finally 会早于这次赋值
    inflight = job
    job.finally(() => { if (inflight === job) inflight = null }).catch(() => {})
    return inflight
  }

  /** 缓存超过一小时就在后台刷（不等它） */
  function maybeRefresh() {
    const c = current()
    if (!keys.length || !online()) return
    if (lastFail && now() - lastFail < RETRY_MS) return // 刚失败过：别一直重试（界面在刷新时会反复来问）
    if (!c || c.source !== 'cache' || now() - c.at > STALE_MS) refresh().catch(() => {})
  }

  /** 能用的条目：去掉下架的、要新版插件的、规矩版本更高的、id 不对的 */
  function usable(list, s) {
    return (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object'
      && ID_RE.test(String(e.id)) && REV_RE.test(String(e.rev || ''))
      && !(e.minPlugin && vcmp(e.minPlugin, version) > 0)
      && !(Number(e.policy) > POLICY)
      && !isRevoked(e, s))
  }

  /** 给界面的目录：三类条目 + 词表 + 状态 */
  function view() {
    const c = current()
    const s = state()
    // revoked：下架名单（收藏、我的作品里标「已下架」用）
    const base = { source: c ? c.source : '', at: c ? c.at : 0, registry: c ? c.registry : '', error: lastError, needUpdate, keys: keys.length > 0, off: !online(), refreshing: !!inflight, revoked: s.revoked.map((r) => (r.rev ? { id: r.id, rev: r.rev } : { id: r.id })) }
    if (!c) return { ...base, designs: [], systems: [], styles: [], metadata: {} }
    const ix = c.index
    const tooNew = ix.minPlugin && vcmp(ix.minPlugin, version) > 0
    if (tooNew) return { ...base, needUpdate: true, designs: [], systems: [], styles: [], metadata: {} }
    const hasThumb = (e) => !!thumbOf(e) && (c.source === 'cache' ? fs.existsSync(path.join(catDir, 'thumbs', `${e.id}.webp`)) : !!(seedDir && fs.existsSync(path.join(seedDir, 'thumbs', `${e.id}.webp`))))
    const card = (e) => {
      const out = {
        id: e.id, type: e.type, rev: e.rev, title: e.title || {}, description: e.description || {}, kind: e.kind || '', style: e.type === 'style' ? e.style : e.style || '',
        categories: e.categories || [], tags: e.tags || [], lang: e.lang || '', dark: !!e.dark, license: e.license || '', author: e.author || {},
        ai: e.ai || null, derivedFrom: e.derivedFrom || null, featured: !!e.featured, added: e.added || '', updated: e.updated || '',
        palette: e.palette || {}, disclosure: e.disclosure || null, check: e.check || null, bytes: Number(e.bytes) || 0, submission: e.submission || '',
        shareHash: typeof e.shareHash === 'string' && /^[0-9a-f]{32}$/.test(e.shareHash) ? e.shareHash : '', // 「我的作品」认自己分享上架的
      }
      if (e.type !== 'style') {
        out.screens = Array.isArray(e.screens) ? e.screens.map((x) => ({ file: x.file, title: x.title || {} })) : []
        out.shots = shotsOf(e).length
        out.thumb = hasThumb(e)
      }
      return out
    }
    // 同一个 id 在两类里都有：分不清，两边都不列（和 entry() 一致）
    const seen = new Map()
    for (const e of [...usable(ix.designs, s), ...usable(ix.systems, s), ...usable(ix.styles, s)]) seen.set(e.id, (seen.get(e.id) || 0) + 1)
    const one = (e) => seen.get(e.id) === 1
    return {
      ...base,
      serial: ix.serial,
      metadata: ix.metadata || {},
      designs: usable(ix.designs, s).filter((e) => e.type === 'template' && one(e)).map(card),
      systems: usable(ix.systems, s).filter((e) => e.type === 'system' && one(e)).map(card),
      styles: usable(ix.styles, s).filter((e) => e.type === 'style' && e.style && typeof e.style === 'object' && one(e)).map(card),
    }
  }

  /** 按 id 找一条（能用的才算） */
  function entry(id) {
    const c = current()
    if (!c) return null
    const s = state()
    const ix = c.index
    if (ix.minPlugin && vcmp(ix.minPlugin, version) > 0) return null
    // 同一个 id 出现在两类里（目录不该这样）：分不清是哪一套，当没有
    const hit = [...usable(ix.designs, s), ...usable(ix.systems, s), ...usable(ix.styles, s)].filter((e) => e.id === id)
    return hit.length === 1 ? hit[0] : null
  }

  /** 封面：和目录里登记的 sha256、大小对得上才给（返回核对过的那份字节） */
  function thumbFile(id) {
    const e = ID_RE.test(id) ? entry(id) : null
    const t = thumbOf(e)
    if (!t) return null
    const c = current()
    const f = c.source === 'cache' ? path.join(catDir, 'thumbs', `${id}.webp`) : path.join(seedDir, 'thumbs', `${id}.webp`)
    try { const buf = fs.readFileSync(f); return sameMedia(t, buf) ? buf : null } catch { return null }
  }

  /** 这些文件和目录里登记的一模一样吗（个数、路径、大小、sha256） */
  function matches(e, files) {
    const want = Array.isArray(e.files) ? e.files : []
    if (!want.length || want.length !== files.length) return false
    const by = new Map(files.map((f) => [f.path, f.data]))
    return want.every((w) => {
      const d = by.get(w.p)
      return d && d.length === w.size && sha256(d) === w.sha256
    })
  }

  /** 批次包（缓存命中就不下载；fresh 时不用缓存）→ 这一套的文件和截图 */
  async function packEntries(e, fresh = false) {
    if (!e.pack || !VER_RE.test(String(e.pack.v || '')) || e.pack.path !== `d/${e.id}/${e.rev}/`) throw new MarketError('pack')
    const c = current()
    if (c.source === 'seed') {
      const root = path.join(seedDir, 'd', e.id, e.rev)
      const out = []
      const walk = (dir, rel) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          const r = rel ? `${rel}/${d.name}` : d.name
          if (d.isDirectory()) walk(path.join(dir, d.name), r)
          else if (d.isFile()) out.push({ path: r, data: fs.readFileSync(path.join(dir, d.name)) })
        }
      }
      walk(root, '')
      return out
    }
    const file = path.join(packDir, `${e.pack.v}.tgz`)
    let buf = null
    if (!fresh) try { buf = fs.readFileSync(file) } catch { buf = null }
    const prefix = e.pack.path
    const pick = (b) => untar(b).filter((f) => f.path.startsWith(prefix)).map((f) => ({ path: f.path.slice(prefix.length), data: f.data }))
    if (!buf) {
      if (!online()) throw new MarketError('off')
      // 这一套的文件逐个核对过才算这个源成功（最快的源给了坏包，接着等别的源）
      const { value } = await race(registries, async (reg, signal) => {
        const b = await download(await lookup(reg, PACKS_PKG, e.pack.v, signal), MAX.packs, signal)
        const all = pick(b)
        if (!matches(e, all.filter((f) => !f.path.startsWith('_shots/')))) throw new MarketError('mismatch')
        return { b, all }
      }, { ...timing, total: Math.max(timing.total || 0, 60000), each: Math.max(timing.each || 0, 45000) })
      writeAtomic(file, value.b)
      prunePacks(file)
      return value.all
    }
    try { const t = new Date(); fs.utimesSync(file, t, t) } catch { /* 只是 LRU 记号 */ }
    return pick(buf)
  }

  /** 批次包缓存超过 300MB：按最近用过的时间删旧的（刚用的那个不删） */
  function prunePacks(keep) {
    let list = []
    try { list = fs.readdirSync(packDir).filter((f) => f.endsWith('.tgz')).map((f) => { const p = path.join(packDir, f); const st = fs.statSync(p); return { p, size: st.size, t: st.mtimeMs } }) } catch { return }
    let total = list.reduce((n, x) => n + x.size, 0)
    for (const x of list.sort((a, b) => a.t - b.t)) {
      if (total <= PACKS_CAP) break
      if (x.p === keep) continue
      try { fs.rmSync(x.p, { force: true }); total -= x.size } catch { /* 下次再删 */ }
    }
  }

  /**
   * 准备一套（模板 / 设计系统）：下载批次、逐个文件核对、解到 staging/<id>@<rev>/（截图在 _shots/）
   * 已经解过、标记还对就直接用。返回 { entry, dir, files, shots }
   */
  const staging = new Map()
  function stage(id) {
    const e = entry(id)
    if (!e || e.type === 'style') return Promise.reject(new MarketError('gone'))
    const key = `${e.id}@${e.rev}`
    if (staging.has(key)) return staging.get(key)
    const job = (async () => {
      const dir = path.join(stageDir, key)
      const mark = path.join(dir, '.ok')
      const digest = String(e.digest || '')
      const want = (Array.isArray(e.files) ? e.files : []).map((f) => f.p)
      const read = () => want.map((p) => ({ path: p, data: fs.readFileSync(path.join(dir, p)) }))
      if (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8') === digest) {
        try {
          const files = read()
          if (matches(e, files)) return { entry: e, dir, files, shots: shotList(dir, e) }
        } catch { /* 坏了就重解 */ }
      }
      // 核对不过：缓存的那份删掉重下一次（坏包别一直留着）；新下的也不对就报错，也不留
      const seed = current().source === 'seed'
      const cached = path.join(packDir, `${e.pack.v}.tgz`)
      const hadCache = !seed && fs.existsSync(cached)
      const take = async (fresh) => {
        let all = null
        try { all = await packEntries(e, fresh) } catch (er) { if (fresh || !hadCache || !(er instanceof MarketError) || er.code !== 'tar') throw er }
        const files = all && all.filter((f) => !f.path.startsWith('_shots/'))
        if (files && matches(e, files)) return { all, files }
        if (!seed) try { fs.rmSync(cached, { force: true }) } catch { /* 算了 */ }
        return null
      }
      const got = (await take(false)) || (hadCache ? await take(true) : null)
      if (!got) throw new MarketError('mismatch')
      // 下载的这会儿目录刷新了、这一套被下架或换了新版：不落地（下架时清掉的暂存也不再写回来）
      const still = entry(id)
      if (!still || still.rev !== e.rev) throw new MarketError('gone')
      const { all, files } = got
      // 截图也逐张核对（目录里登记了 sha256 和大小）
      const wantShots = new Map(shotsOf(e).map((x) => [x.p, x]))
      const shots = all.filter((f) => wantShots.has(f.path) && sameMedia(wantShots.get(f.path), f.data))
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
      const real = fs.realpathSync(dir)
      for (const f of [...files, ...shots]) {
        const rel = cleanPath(f.path)
        if (!rel) throw new MarketError('path')
        const abs = path.resolve(real, rel)
        if (!abs.startsWith(real + path.sep)) throw new MarketError('path')
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, f.data)
      }
      fs.writeFileSync(mark, digest)
      return { entry: e, dir: real, files, shots: shotList(real, e) }
    })()
    staging.set(key, job)
    job.finally(() => staging.delete(key)).catch(() => {})
    return job
  }
  // 暂存里的截图每次都按目录登记的大小、sha256 再核对（暂存目录被改过的不认）
  const shotOk = (dir, x) => { try { return sameMedia(x, fs.readFileSync(path.join(dir, x.p))) } catch { return false } }
  const shotList = (dir, e) => shotsOf(e).filter((x) => shotOk(dir, x)).map((x) => x.p)

  /** 已经核对过的某张截图的字节（没解过、对不上返回 null） */
  function shotFile(id, name) {
    const e = entry(id)
    const want = e && shotsOf(e).find((x) => x.p === name)
    if (!want) return null
    const dir = path.join(stageDir, `${e.id}@${e.rev}`)
    try {
      if (fs.readFileSync(path.join(dir, '.ok'), 'utf8') !== String(e.digest || '')) return null
      const buf = fs.readFileSync(path.join(dir, name))
      return sameMedia(want, buf) ? buf : null
    } catch { return null }
  }

  /** 这份 HTML 是市场上某一套的原样吗（预览时加硬规矩） */
  let htmlSet = null
  let htmlFor = null
  function strictHtml(buf) {
    const c = current()
    if (!c) return false
    if (htmlFor !== c) {
      htmlSet = new Set()
      for (const e of [...(c.index.designs || []), ...(c.index.systems || [])]) for (const f of (e && Array.isArray(e.files) ? e.files : [])) if (/\.html?$/i.test(String(f.p)) && typeof f.sha256 === 'string') htmlSet.add(f.sha256)
      htmlFor = c
    }
    return htmlSet.size > 0 && htmlSet.has(sha256(buf))
  }
  const isStaging = (dir) => {
    const r = path.resolve(String(dir || ''))
    let base = stageDir
    try { base = fs.realpathSync(stageDir) } catch { /* 还没有 */ }
    return r === base || r.startsWith(base + path.sep) || r.startsWith(path.resolve(stageDir) + path.sep)
  }

  return { view, refresh, maybeRefresh, abort, entry, thumbFile, stage, shotFile, strictHtml, isStaging, state, url: (e) => e.submission || `${REPO_URL}/tree/main/${e.type === 'system' ? 'systems' : e.type === 'style' ? 'styles' : 'templates'}/${e.id}` }
}
