/**
 * 自带照片库：AI 提前生成、人工挑过的示意照片。模型调 find_photos 按描述找，图复制进设计目录，页面用本地文件。
 *
 * - 目录 photos-index.json 随插件发（描述、标签、尺寸、sha256），搜索不联网。
 * - 图在 npm 包 dsh-design-photos 里，第一次用到才下载；每张按目录里钉死的 sha256 核对，镜像换了图也不认。
 * - 「设计库不联网」开着就不下载（走 market 的 fetchPackage，开关在那边）。
 * - 复制进设计目录的文件名都带 ai-photo- 前缀：转代码时认这个前缀提醒「上线前换成真实照片」，用户一眼也看得出。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vcmp } from './gallery/market.js'

export const PHOTO_PREFIX = 'ai-photo-'
export const PHOTOS_CACHE = process.env.DSH_DESIGN_PHOTOS_CACHE || path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'photos')
export const MAX_PHOTOS = 8
const INDEX_FILE = fileURLToPath(new URL('./photos-index.json', import.meta.url))
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CAP = 60 * 1024 * 1024
const LIMITS = { files: 1000, file: 4 * 1024 * 1024, total: 120 * 1024 * 1024 }
const RETRY_MS = 60e3 // 下载失败后隔多久才再试（模型连着调不用每次都等超时）
// 一次下一个大包：比市场目录的默认超时长得多，每个源 60 秒，总共 2 分钟
const TIMING = { stagger: 8000, each: 60000, total: 120000 }

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase()
const ascii = (s) => /^[a-z0-9 -]+$/.test(s)

export const orientOf = (w, h) => (w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'square')

/** 读目录；格式不对的条目不要（目录随插件发，这里只防手滑） */
export function loadPhotoIndex(file = INDEX_FILE) {
  let raw
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  if (!raw || raw.format !== 1 || typeof raw.package !== 'string' || typeof raw.version !== 'string' || !Array.isArray(raw.photos)) return null
  const themes = raw.themes && typeof raw.themes === 'object' ? raw.themes : {}
  const photos = raw.photos.filter((p) => p && ID_RE.test(String(p.id)) && /^[0-9a-f]{64}$/.test(String(p.sha256)) && p.w > 0 && p.h > 0 && themes[p.theme])
  return { ...raw, themes, photos }
}

const dicts = new WeakMap()
/** 题材词表 + 全部中文词（长的在前）；标签里含本题材词的也算题材词（「奶茶店」「健身房」「运动鞋」） */
function dictOf(index) {
  let d = dicts.get(index)
  if (d) return d
  const base = {}
  const words = {}
  const cjk = new Set()
  for (const [k, v] of Object.entries(index.themes)) {
    base[k] = new Set((Array.isArray(v.words) ? v.words : []).map(norm).filter(Boolean))
    words[k] = new Set(base[k])
  }
  for (const p of index.photos) {
    for (const t of Array.isArray(p.tags) ? p.tags : []) {
      const x = norm(t)
      if (!x) continue
      if (!ascii(x)) cjk.add(x)
      if (!ascii(x) && [...base[p.theme]].some((w) => !ascii(w) && x.includes(w))) words[p.theme].add(x)
    }
  }
  for (const set of Object.values(words)) for (const w of set) if (!ascii(w)) cjk.add(w)
  const phrases = new Set()
  for (const set of Object.values(words)) for (const w of set) if (ascii(w) && w.includes(' ')) phrases.add(w)
  for (const p of index.photos) for (const t of Array.isArray(p.tags) ? p.tags : []) { const x = norm(t); if (ascii(x) && x.includes(' ')) phrases.add(x) }
  const allBase = new Set(Object.values(base).flatMap((x) => [...x]))
  const generic = new Set((Array.isArray(index.generic) ? index.generic : []).map(norm))
  d = { base, allBase, generic, words, terms: [...cjk].sort((a, b) => b.length - a.length), phrases: [...phrases].sort((a, b) => b.length - a.length) }
  dicts.set(index, d)
  return d
}

const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const singularAll = (s) => s.split(' ').map(singular).join(' ')

/**
 * 查询里命中了哪些词。中文最长词优先吃掉（「运动鞋」不再算「运动」）；
 * 单字词只认单独成段的（「海报」「水果」不算「海」「水」）。
 * 英文先按原词归成单数，短语也先吃掉（「meal prep」不再算「meal」，「milk teas」算「milk tea」），其余按整词。
 */
function matcherOf(dict, query) {
  const q = norm(query)
  const got = new Set()
  let plain = ` ${singularAll(q.replace(/[^a-z0-9]+/g, ' ').trim())} `
  for (const t of dict.phrases) {
    const needle = ` ${singularAll(t)} `
    if (plain.includes(needle)) { got.add(t); plain = plain.split(needle).join('  ') }
  }
  const words = new Set(plain.split(/\s+/).filter((w) => w.length >= 2))
  let rest = q
  for (const t of dict.terms) {
    if ([...t].length > 1 && rest.includes(t)) { got.add(t); rest = rest.split(t).join(' ') }
  }
  const singles = new Set(dict.terms.filter((t) => [...t].length === 1))
  for (const seg of rest.split(/[^\p{Script=Han}]+/u)) if (singles.has(seg)) got.add(seg)
  return (t) => {
    const x = norm(t)
    if (!x) return false
    if (!ascii(x)) return got.has(x)
    return x.includes(' ') ? got.has(x) : words.has(singular(x))
  }
}

/**
 * 按描述搜：先看具体画面（标签），对上了的只要它们，同题材的优先（宁少勿滥，准确的画面不会被题材词挡掉）；
 * 一个都没对上才按题材挑。题材词本身、「特写」「内景」这类通用修饰词不算对上画面，只帮排序。
 * 这套设计已经用过的排最后，内容比横竖要紧；同分时按 seed 打散（同一套设计结果稳定，不同设计不总是同几张）。
 */
export function searchPhotos(index, opts = {}) {
  const { count = 3 } = opts
  const n = Math.min(MAX_PHOTOS, Math.max(1, Math.floor(Number(count)) || 3))
  return scan(index, opts).rows.slice(0, n).map((r) => r.p)
}

/** 这次只命中了题材、没有对得上的具体画面（工具要照实告诉模型，让它看描述再决定用不用） */
export const onlyByTheme = (index, opts) => { const r = scan(index, opts); return r.rows.length > 0 && !r.specific }

function scan(index, { query, ratio = '', used = new Set(), seed = '' } = {}) {
  const dict = dictOf(index)
  const hit = matcherOf(dict, query)
  const themeScore = {}
  let best = 0
  for (const k of Object.keys(index.themes)) {
    themeScore[k] = [...dict.words[k]].filter(hit).length
    best = Math.max(best, themeScore[k])
  }
  const all = index.photos.map((p) => {
    const hits = (Array.isArray(p.tags) ? p.tags : []).filter(hit).map(norm).filter((t) => !dict.allBase.has(t))
    const core = hits.filter((t) => !dict.generic.has(t)).length
    return { p, core, mods: hits.length - core, theme: themeScore[p.theme], seen: used.has(p.id) ? 1 : 0, fit: ratio && orientOf(p.w, p.h) === ratio ? 1 : 0, rank: sha256(`${seed}\n${p.id}`) }
  })
  const exact = all.filter((r) => r.core > 0)
  const specific = exact.length > 0
  const inBest = best ? exact.filter((r) => r.theme === best) : []
  const rows = specific ? (inBest.length ? inBest : exact) : best ? all.filter((r) => r.theme === best) : []
  rows.sort((a, b) => a.seen - b.seen || b.core - a.core || b.mods - a.mods || b.theme - a.theme || b.fit - a.fit || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
  return { rows, specific }
}

/** 设计目录里已经放了哪几张（按文件名认，同一套设计别老用同一张） */
export function usedPhotos(dir, index) {
  const out = new Set()
  let names = []
  try { names = fs.readdirSync(path.join(dir, 'assets')) } catch { return out }
  const ids = new Set(index.photos.map((p) => p.id))
  for (const n of names) {
    const m = n.startsWith(PHOTO_PREFIX) && n.endsWith('.jpg') ? n.slice(PHOTO_PREFIX.length, -4) : ''
    if (m && ids.has(m)) out.add(m)
  }
  return out
}

/** 目录（或它里面的页面）用了几张 AI 示意图：转代码时提醒 */
export const isPhotoAsset = (name) => path.basename(String(name)).startsWith(PHOTO_PREFIX)

export function createPhotos({ market, index = loadPhotoIndex(), cacheDir = PHOTOS_CACHE, log = () => {}, now = Date.now } = {}) {
  let inflight = null
  let failedAt = -Infinity
  let lastErr = null
  const dirOf = () => path.join(cacheDir, index.version)
  const fileOf = (p) => path.join(dirOf(), `${p.id}.jpg`)
  const okFile = (p) => {
    try { return sha256(fs.readFileSync(fileOf(p))) === p.sha256 } catch { return false }
  }
  const ready = () => {
    // 判断「下过了没有」只看大小（每次全算哈希没必要）；真正复制之前逐张核对
    return index.photos.every((p) => { try { return fs.statSync(fileOf(p)).size === p.size } catch { return false } })
  }

  async function download() {
    const files = await market.fetchPackage(index.package, index.version, {
      cap: CAP,
      limits: LIMITS,
      timing: TIMING,
      // 在抢下载的回调里核对：哪个源的图不对，算它失败，接着等别的源
      check: (list) => {
        const by = new Map(list.map((f) => [f.path, f.data]))
        const out = []
        for (const p of index.photos) {
          const data = by.get(`photos/${p.id}.jpg`)
          if (!data || sha256(data) !== p.sha256) { const e = new Error('photo mismatch'); e.code = 'mismatch'; throw e }
          out.push({ p, data })
        }
        return out
      },
    })
    const dir = dirOf()
    fs.mkdirSync(dir, { recursive: true })
    for (const { p, data } of files) {
      const tmp = `${fileOf(p)}.${process.pid}.tmp`
      fs.writeFileSync(tmp, data)
      fs.renameSync(tmp, fileOf(p))
    }
    // 只清比自己旧的版本（另一个配置里更新的插件下的不能动）
    for (const n of fs.readdirSync(cacheDir)) {
      if (/^\d+\.\d+\.\d+/.test(n) && vcmp(n, index.version) < 0) try { fs.rmSync(path.join(cacheDir, n), { recursive: true, force: true }) } catch (e) { log(e) }
    }
  }

  /** 保证图都在缓存里；失败抛错（err.code：off = 不联网开着） */
  function ensure() {
    if (ready()) return Promise.resolve()
    if (inflight) return inflight
    if (now() - failedAt < RETRY_MS && lastErr) return Promise.reject(lastErr)
    inflight = download().then(
      () => { failedAt = -Infinity; lastErr = null; inflight = null },
      (e) => { inflight = null; log(e); if (e && e.code === 'off') { failedAt = -Infinity; lastErr = null } else { failedAt = now(); lastErr = e } throw e },
    )
    return inflight
  }

  /**
   * 把 picks 复制进 <dir>/assets/，返回 [{ p, rel }]。全程同步，真实路径就在写之前核对。
   * allowed(真实路径) 说这个目录能不能写；同名文件已经在了就不动（可能是用户换成了自己的照片）；assets 指到外面就不写。
   */
  function place(dir, picks, allowed = () => true) {
    const denied = () => Object.assign(new Error('outside'), { code: 'link' })
    let probe = path.resolve(dir)
    while (!fs.existsSync(probe)) {
      const up = path.dirname(probe)
      if (up === probe) break
      probe = up
    }
    if (!allowed(fs.realpathSync(probe))) throw denied()
    const assets = path.join(dir, 'assets')
    fs.mkdirSync(assets, { recursive: true })
    const realDir = fs.realpathSync(dir)
    const realAssets = fs.realpathSync(assets)
    if (!allowed(realDir) || realAssets !== path.join(realDir, 'assets')) throw denied()
    const out = []
    for (const p of picks) {
      if (!okFile(p)) {
        // 缓存里这张坏了：删掉，下次 ensure 会重新下
        try { fs.rmSync(fileOf(p), { force: true }) } catch (e) { log(e) }
        throw Object.assign(new Error(`bad cached photo ${p.id}`), { code: 'mismatch' })
      }
      const name = `${PHOTO_PREFIX}${p.id}.jpg`
      try {
        fs.copyFileSync(fileOf(p), path.join(realAssets, name), fs.constants.COPYFILE_EXCL)
      } catch (e) {
        if (!e || e.code !== 'EEXIST') throw e
      }
      out.push({ p, rel: `assets/${name}` })
    }
    return out
  }

  /**
   * 下载 → 看这套设计用过哪些 → 选图 → 复制。下载之后全程同步，同一目录并发调用不会选到同一批。
   * pick(used) 返回要的图；缓存有坏图时重下一次。
   */
  async function provide({ dir, allowed, pick }) {
    await ensure()
    try {
      return place(dir, pick(usedPhotos(dir, index)), allowed)
    } catch (e) {
      if (!e || e.code !== 'mismatch') throw e
    }
    await ensure()
    return place(dir, pick(usedPhotos(dir, index)), allowed)
  }

  return { index, ready, ensure, place, provide }
}
