/**
 * 设计库 › 市场 的接口：
 *
 *   GET  market     [?refresh=1]       目录（缓存优先；超过一小时后台刷；refresh=1 等刷完）
 *   GET  mthumb     ?id=               卡片封面（目录包里带的 webp）
 *   POST mstage     { id }             下载这一套所在的批次包、逐个文件核对、解开 → 截图列表
 *   GET  mshot      ?id=&f=_shots/x.jpg  核对过的每屏截图
 *   POST mlive      { id }             「实时看」：解开的那份用预览服务打开（硬规矩、断网），iframe 再关死
 *   POST muse       { session, id }    「用这个开始」：再查一遍下架名单 → 核对 → 规范化后落到新文件夹 → 登记 → 打开
 *   POST msystem    { id }             设计系统装进 ~/.dsh/design-systems/<短名>__<作者>/
 */

import fs from 'node:fs'
import path from 'node:path'
import { listScreens } from '../core.js'
import crypto from 'node:crypto'
import { preparePack, installPack, baseFor, UseError } from './use.js'
import { MarketError, STALE_MS } from './market.js'
import { checkPack, message, cleanPath } from './policy.js'
import { mergePast } from '../works.js'

const ERR = { gone: 410, stale: 409, nokeys: 503, off: 503, offline: 503, timeout: 504, mismatch: 422, pack: 422, path: 422, http: 502, host: 502, integrity: 502, big: 502, json: 502 }

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
// 包里这几样不装：清单（我们自己写 system.json）、source/（设计台自己放预览图和提取素材的地方；审核也不收）
const SKIP = (p) => p === 'design.json' || p === 'system.json' || /^source\//i.test(p)

/** 写文件：先写同目录的临时文件再改名换上（原来那个文件的 inode 不动，就算是硬链接也不会连带改到别处） */
function writeAtomic(abs, data) {
  const tmp = path.join(path.dirname(abs), `.dsh-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`)
  fs.writeFileSync(tmp, data, { flag: 'wx' })
  try { fs.renameSync(tmp, abs) } catch (e) { try { fs.rmSync(tmp, { force: true }) } catch { /* 算了 */ } throw e }
}

/** 目录里有没有软链接、硬链接、怪文件（有就不碰它：更新可能顺着链接写到 / 删到目录外面） */
function plainTree(dir, depth = 0) {
  if (depth > 6) return false
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const ent of ents) {
    const abs = path.join(dir, ent.name)
    let st
    try { st = fs.lstatSync(abs) } catch { return false }
    // 硬链接（nlink > 1）也不碰：写它会连带改掉目录外那个文件
    if (st.isDirectory()) { if (!plainTree(abs, depth + 1)) return false } else if (!st.isFile() || st.nlink > 1) return false
  }
  return true
}

/** system.json 的指纹：去掉 market.self 本身后按原样（键的顺序不变）序列化的 sha256；用户改了任何字段都对不上 */
function metaHash(meta) {
  const mk = { ...(meta.market || {}) }
  delete mk.self
  return sha256(JSON.stringify({ ...meta, market: mk }))
}

/** 这个已有目录能不能就地换成新版：是这一套装的、全是普通文件、装上后一个没改过、新版要写的地方没有用户自己加的文件 */
function canUpdate(dest, e, take) {
  if (!plainTree(dest)) return null
  let meta = null
  try { meta = JSON.parse(fs.readFileSync(path.join(dest, 'system.json'), 'utf8')) } catch { return null }
  const mk = meta && meta.market
  if (!mk || mk.id !== e.id || !mk.files || typeof mk.files !== 'object') return null
  // system.json 自己也不能被改过（改了名字、加了字段的，另装一份）
  if (typeof mk.self !== 'string' || mk.self !== metaHash(meta)) return null
  const old = new Map()
  for (const [p, h] of Object.entries(mk.files)) {
    const rel = cleanPath(p)
    if (!rel || typeof h !== 'string') return null
    let buf
    try { buf = fs.readFileSync(path.join(dest, rel)) } catch { return null }
    if (sha256(buf) !== h) return null
    old.set(rel, h)
  }
  for (const f of take) {
    if (old.has(f.rel)) continue
    // 新版要写的文件（或它的上级）已经存在、又不是上次装的：是用户自己加的，不覆盖
    const parts = f.rel.split('/')
    for (let k = 1; k <= parts.length; k++) {
      const sub = parts.slice(0, k).join('/')
      let st = null
      try { st = fs.lstatSync(path.join(dest, sub)) } catch { st = null }
      if (!st) break
      if (k < parts.length ? !st.isDirectory() : true) return null
    }
  }
  return old
}

/**
 * 市场的设计系统装进设计系统库：
 *   目录名 <短名>__<作者>（完整市场 id 换个顺序，不截断，不同作者撞不到一起）
 *   已有同名目录：是这一套装的、装上后没被改过、没有软链接、新版不会盖掉用户自己加的文件 → 换成新版（删掉旧版有新版没有的文件）；
 *   别的（用户自己的、别的来源、改过、加过文件、有链接）→ 一个都不动，另起 <名>-2、-3…
 *   包里核对过哈希的文件全装（assets/ 里的图也装），记下每个文件的 sha256，下次更新时认「改没改过」
 */
export function installSystem(systemsDir, e, files, { name, url = '', now = Date.now() } = {}) {
  const [login, short] = e.id.split('__')
  const base = `${short}__${login}`
  const take = files.map((f) => ({ rel: cleanPath(f.path), data: f.data })).filter((f) => f.rel && !SKIP(f.rel))
  fs.mkdirSync(systemsDir, { recursive: true })
  const lib = fs.realpathSync(systemsDir)
  for (let i = 1; i <= 50; i++) {
    const id = i === 1 ? base : `${base}-${i}`
    const dest = path.join(lib, id)
    let st = null
    try { st = fs.lstatSync(dest) } catch { st = null }
    let old = null
    if (st) {
      if (!st.isDirectory()) continue
      old = canUpdate(dest, e, take)
      if (!old) continue
    } else {
      try { fs.mkdirSync(dest) } catch { continue } // 刚好被别人建了：换下一个名字
    }
    const real = fs.realpathSync(dest)
    if (real !== dest) continue
    const inside = (rel) => { const abs = path.resolve(real, rel); return abs.startsWith(real + path.sep) ? abs : null }
    // 每一级上级目录都要是真目录、还在这一套里面（建之前、建之后都看）
    const safeDir = (abs) => {
      const rel = path.relative(real, path.dirname(abs))
      let cur = real
      for (const seg of rel ? rel.split(path.sep) : []) {
        cur = path.join(cur, seg)
        let s = null
        try { s = fs.lstatSync(cur) } catch { s = null }
        if (!s) { try { fs.mkdirSync(cur) } catch { return false } continue }
        if (!s.isDirectory()) return false
      }
      return fs.realpathSync(path.dirname(abs)) === path.dirname(abs)
    }
    const now1 = new Set(take.map((f) => f.rel))
    if (old) {
      for (const p of old.keys()) {
        if (now1.has(p)) continue
        const abs = inside(p)
        if (!abs || !safeDir(abs)) continue
        try { if (fs.lstatSync(abs).isFile()) fs.rmSync(abs) } catch { /* 算了 */ }
      }
    }
    const record = {}
    for (const f of take) {
      const abs = inside(f.rel)
      if (!abs || !safeDir(abs)) continue
      try { if (!fs.lstatSync(abs).isFile()) continue } catch { /* 没有：新建 */ }
      writeAtomic(abs, f.data)
      record[f.rel] = sha256(f.data)
    }
    const sysFile = path.join(real, 'system.json')
    try { if (!fs.lstatSync(sysFile).isFile()) throw new UseError('system.json') } catch (err) { if (err instanceof UseError) throw err }
    const shown = i > 1 ? `${name} (${i})` : name
    const meta = { name: shown, sources: [`设计市场 ${e.id}@${e.rev}`], market: { id: e.id, rev: e.rev, license: e.license || '', author: (e.author && e.author.login) || '', url, files: record }, createdAt: now }
    meta.market.self = metaHash(meta)
    writeAtomic(sysFile, JSON.stringify(meta, null, 2) + '\n')
    return { id, real, name: shown, updated: !!old, kept: i > 1 ? base : '', files: record }
  }
  throw new UseError('too many copies')
}

/**
 * 装好的设计系统记进作品库（藏着）：trust 'market' + HTML 哈希，预览时按别人做的加规矩。
 * 就地更新时，以前装过的各版 HTML 哈希去重留在 pastHashes（从版本记录退回旧版后，那些页面照样加规矩）；
 * 重装同一版不会多占。版本快照本身的预览不靠这个：装好的设计系统的旧版本一律加规矩（works.strictVersions）
 */
export function recordSystem(library, r, e, { name, url = '', now = Date.now() } = {}) {
  const hashes = Object.fromEntries(Object.entries(r.files || {}).filter(([p]) => /\.html?$/i.test(p)))
  const prev = r.updated ? library.get(r.real) : null
  const keep = prev ? mergePast(prev.pastHashes, Object.values(prev.hashes || {}), new Set(Object.values(hashes))) : []
  return library.put(r.real, { title: name, kind: 'system', trust: 'market', hashes, pastHashes: keep.length ? keep : undefined, from: { id: e.id, rev: e.rev, author: (e.author && e.author.login) || '', license: e.license || '', url }, hidden: true, hiddenAt: now })
}

export function createMarketRoutes({ admit, readBody, json, tracker, library, market, open, systemsDir, log = () => {}, sessionCwd = async (id) => tracker.cwdOf(id) }) {
  const lang = (body) => (body && body.lang === 'en' ? 'en' : 'zh')
  const fail = (res, e) => {
    if (e instanceof MarketError) return json(res, ERR[e.code] || 502, { error: e.code, x: e.x })
    if (e instanceof UseError) return json(res, 422, { error: e.message, errors: (e.errors || []).slice(0, 40) })
    log(e)
    return json(res, 500, { error: e.message })
  }
  async function body(req, res) {
    if (req.method !== 'POST') { json(res, 405, { error: 'method not allowed' }); return null }
    try { return await readBody(req) } catch (e) { json(res, 400, { error: e.message }); return null }
  }
  const idOf = (b) => String((b && b.id) || '')

  async function catalog(req, res) {
    if (!admit(req, res)) return
    const q = new URL(req.url, 'http://x').searchParams
    if (q.get('refresh') === '1') await market.refresh().catch(() => {})
    else market.maybeRefresh()
    json(res, 200, market.view())
  }

  // 给的是核对过的那份字节（不再按路径重读）；地址里带着版本（&r=），换版后不会看到旧图
  function sendBuf(res, buf, type) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    res.end(buf)
  }

  function thumb(req, res) {
    if (!admit(req, res)) return
    const f = market.thumbFile(new URL(req.url, 'http://x').searchParams.get('id') || '')
    if (!f) return json(res, 404, { error: 'no thumb' })
    sendBuf(res, f, 'image/webp')
  }

  async function stage(req, res) {
    if (!admit(req, res)) return
    const b = await body(req, res)
    if (!b) return
    try {
      const s = await market.stage(idOf(b))
      json(res, 200, { id: s.entry.id, rev: s.entry.rev, shots: s.shots })
    } catch (e) { fail(res, e) }
  }

  function shot(req, res) {
    if (!admit(req, res)) return
    const q = new URL(req.url, 'http://x').searchParams
    const f = market.shotFile(q.get('id') || '', q.get('f') || '')
    if (!f) return json(res, 404, { error: 'no shot' })
    sendBuf(res, f, 'image/jpeg')
  }

  async function live(req, res) {
    if (!admit(req, res)) return
    const b = await body(req, res)
    if (!b) return
    try {
      const s = await market.stage(idOf(b))
      const screens = s.entry.type === 'template' ? (s.entry.screens || []).map((x) => x.file).filter((f) => s.files.some((g) => g.path === f)) : ['components.html']
      if (!screens.length) return json(res, 422, { error: 'noScreens' })
      const { origin } = await open({ kind: 'file', root: s.dir, file: path.join(s.dir, screens[0]) })
      // 带上是哪一套、哪一版：界面拿它核对，晚回来的旧回包直接丢
      json(res, 200, { origin, screens, id: s.entry.id, rev: s.entry.rev })
    } catch (e) { fail(res, e) }
  }

  /** 用之前：目录超过一小时先刷一次（刷不动就用缓存），再确认没被下架 */
  async function fresh(id, rev) {
    const v = market.view()
    if (v.source === 'cache' && Date.now() - v.at > STALE_MS) await market.refresh().catch(() => {})
    const e = market.entry(id)
    if (!e) throw new MarketError('gone')
    // 界面上看的是旧版（目录刚换了新版）：不替用户装没看过的那版
    if (rev && rev !== e.rev) throw new MarketError('stale')
    return e
  }

  /** 下载完、落地前再看一眼：这会儿被下架了 / 换了新版就不装（下载途中目录可能刷新过） */
  function stillListed(e) {
    const now = market.entry(e.id)
    if (!now || now.rev !== e.rev) throw new MarketError('gone')
  }

  async function use(req, res) {
    if (!admit(req, res)) return
    const b = await body(req, res)
    if (!b) return
    const session = String(b.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    try {
      const e = await fresh(idOf(b), String(b.rev || ''))
      if (e.type !== 'template') return json(res, 400, { error: 'type' })
      const s = await market.stage(e.id)
      const base = baseFor(await sessionCwd(session))
      const prepared = preparePack(s.files, { lang: lang(b) })
      const t = prepared.manifest.title
      // 最后一次 await 之后、落地之前紧挨着再查：等的这会儿可能被下架了
      stillListed(e)
      const r = installPack(prepared, {
        base,
        name: (t && (t.zh || t.en)) || e.id.split('__')[1],
        trust: 'market',
        from: { id: e.id, rev: e.rev, author: (e.author && e.author.login) || '', license: e.license || '', url: market.url(e) },
        library,
      })
      await tracker.setTarget(session, { kind: 'file', file: r.first, root: r.dir }, { source: 'user', popup: false, kind: prepared.manifest.kind, size: prepared.manifest.size || '' })
      json(res, 200, { snap: tracker.snapshot(session), dir: r.dir, title: t, screens: r.screens, license: prepared.manifest.license, kind: prepared.manifest.kind, flags: prepared.flags.slice(0, 20), from: { id: e.id, author: (e.author && e.author.login) || '' } })
    } catch (e) { fail(res, e) }
  }

  async function system(req, res) {
    if (!admit(req, res)) return
    const b = await body(req, res)
    if (!b) return
    try {
      const e = await fresh(idOf(b), String(b.rev || ''))
      if (e.type !== 'system') return json(res, 400, { error: 'type' })
      const s = await market.stage(e.id)
      // 和机器人同一份规则再查一遍（核对过哈希，这里是兜底：插件的规则可能比当时严）
      const chk = checkPack(s.files, { mode: 'install' })
      if (!chk.ok || chk.type !== 'system') return json(res, 422, { error: 'check', errors: chk.errors.slice(0, 40).map((p) => ({ ...p, msg: message(p, lang(b)) })) })
      const short = e.id.split('__')[1]
      const name = [...String((e.title && (e.title[lang(b)] || e.title.zh || e.title.en)) || short)].filter((ch) => /[\p{L}\p{N} ·\-_&()（）]/u.test(ch)).join('').trim().slice(0, 40) || short
      stillListed(e)
      const r = installSystem(systemsDir, e, s.files, { name, url: market.url(e) })
      const { id, real } = r
      // 记进作品库的信任记录（藏着，不进「我的作品」列表）：装好的这份按「别人做的」预览（严格规矩），不靠市场目录还在不在
      try { recordSystem(library, r, e, { name, url: market.url(e) }) } catch (er) { log(er) }
      json(res, 200, { id, name: r.name, dir: real, screens: listScreens(real).length, updated: r.updated, kept: r.kept })
    } catch (e) { fail(res, e) }
  }

  return { market: catalog, mthumb: thumb, mstage: stage, mshot: shot, mlive: live, muse: use, msystem: system }
}
