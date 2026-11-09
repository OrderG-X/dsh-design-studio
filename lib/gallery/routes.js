/**
 * 设计库的接口（右侧栏 › 设计库）：
 *
 *   GET  works                       我的作品（顺手从设计台缓存补回以前的设计）
 *   POST works      { op, dir, to? } pin / unpin / hide（移出列表）/ reveal（在文件夹里显示）/ relocate（挪走了，重新定位）
 *   GET  workthumb  ?id=             作品缩略图（第一屏，无头浏览器截的，按文件修改时间缓存）
 *   POST pack       { dir, license } 打成 zip：先规范化，再用和机器人同一份规则查；过了存到「下载」
 *   POST usezip     { session, name, data } 拖进来的 zip →「用这个开始」：查、落到新文件夹、登记、打开
 *   GET  inspire                     灵感（参考图、网址、我的风格）
 *   POST inspire    { op, … }        addImage / addUrl / addStyle / addMarket / remove
 *   GET  inspimg    ?id=             灵感里的图片
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { listScreens, allScreens } from '../core.js'
import { parseMeta, metaOfFile, KIND_SIZE, prepare } from '../look.js'
import { packDesign, zipOf, splitTitle } from './pack.js'
import { PERSONAL_CODES } from './policy.js'
import { readZip, ZipError } from './zip.js'
import { renderPack } from './render.js'
import { preparePack, installPack, baseFor, slugOf, UseError } from './use.js'

const THUMB_DIR = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'works', 'thumbs')
const MAX_ZIP_BODY = 12 * 1024 * 1024 // base64 的 8MB zip
const MAX_IMG_BODY = 9 * 1024 * 1024

const idOf = (dir) => crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16)

/** 页面开头的 <title>（只读前 16KB） */
function headTitle(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(16384)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const m = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(buf.subarray(0, n).toString('utf8'))
    return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim() : ''
  } catch { return '' } finally { if (fd != null) try { fs.closeSync(fd) } catch { /* 关过了 */ } }
}

function localManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'design.json'), 'utf8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null
  } catch { return null }
}
function manifestTitle(dir) {
  const t = (localManifest(dir) || {}).title
  return t && typeof t === 'object' ? String(t.zh || t.en || '').slice(0, 40) : ''
}
const TOKEN_RE = /^[0-9a-f]{32}$/
/** 分享记号 → 目录里的指纹（sha256 前 32 位）和给人看的短号 */
export const shareHashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)
function shareOf(dir) {
  const tk = (localManifest(dir) || {}).shareToken
  if (typeof tk !== 'string' || !TOKEN_RE.test(tk)) return null
  const hash = shareHashOf(tk)
  return { hash, ref: hash.slice(0, 12) }
}
/** 投稿表单的「短名」：标题或文件夹名能拼成 a-z0-9- 就预填，不然留空让机器人生成 */
const slugFor = (...xs) => { for (const x of xs) { const s = String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); if (s.length >= 3) return s } return '' }

/** 分享前体检：机器人会拒的那几类（被系统栏压住、图片坏了、跳到不存在的页…），名字和内容仓库的一样 */
const HARD_NAMES = {
  covered: ['内容被系统栏压住', 'content under the system bar'],
  capsule: ['被小程序胶囊挡住', 'covered by the mini-program capsule'],
  island: ['被灵动岛挡住', 'covered by the Dynamic Island'],
  winctl: ['被窗口按钮挡住', 'covered by the window buttons'],
  homebar: ['被底部横条压住', 'covered by the home bar'],
  img: ['图片坏了', 'broken image'],
  deadlink: ['跳到不存在的页', 'link to a missing page'],
}
const hardMsg = (x, en) => {
  const n = (HARD_NAMES[x.type] || [x.type, x.type])[en ? 1 : 0] + (x.text ? (en ? ` (${x.text})` : `（${x.text}）`) : '')
  return en ? `"${x.file}" has a serious layout problem: ${n}` : `「${x.file}」体检有严重问题：${n}`
}

/** 一条作品记录 → 右侧栏卡片要的样子（目录不在了 exists: false） */
export function describeWork(w) {
  const dir = w.dir
  let exists = false
  try { exists = fs.statSync(dir).isDirectory() } catch { exists = false }
  const base = { id: idOf(dir), dir, name: path.basename(dir), pinned: !!w.pinned, trust: w.trust || '', from: w.from || null, added: w.added || 0, exists, share: exists ? shareOf(dir) : null }
  if (!exists) return { ...base, title: w.title || path.basename(dir), kind: w.kind || '', screens: w.screens || 0, updated: w.updated || w.seen || 0 }
  const screens = listScreens(dir)
  let updated = 0
  let sig = ''
  for (const f of screens) {
    try {
      const st = fs.statSync(path.join(dir, f))
      updated = Math.max(updated, st.mtimeMs)
      if (!sig) sig = `${f}:${Math.round(st.mtimeMs)}:${st.size}`
    } catch { /* 刚删了 */ }
  }
  const first = screens[0] ? path.join(dir, screens[0]) : ''
  const product = first ? splitTitle(headTitle(first)).product : ''
  const kind = w.kind || (first ? parseMeta(metaOfFile(first)).kind : '') || 'web'
  return { ...base, title: manifestTitle(dir) || product || w.title || path.basename(dir), kind, screens: screens.length, first: screens[0] || '', updated: Math.round(updated || w.updated || w.seen || 0), thumb: sig ? crypto.createHash('sha1').update(sig).digest('hex').slice(0, 10) : '' }
}

export function createLibraryRoutes({ admit, readBody, json, tracker, library, inspiration, studio, open, storeLoad, version = '', exported, log = () => {}, thumbDir = THUMB_DIR, downloads = path.join(os.homedir(), 'Downloads'), sessionCwd = async (id) => tracker.cwdOf(id), render = renderPack }) {
  const lang = (body) => (body && body.lang === 'en' ? 'en' : 'zh')

  // 作品库里登记的、目录在哪（id → 记录）：只认列得出来的，别让请求指到别的目录
  const byId = (id) => library.list().find((w) => idOf(w.dir) === id) || null
  const byDir = (dir) => {
    const w = library.get(String(dir || ''))
    return w && !w.hidden ? w : null
  }

  function synced() {
    try { library.sync(storeLoad()) } catch (e) { if (e.code !== 'ENOENT') log(e) }
  }

  async function works(req, res) {
    if (!admit(req, res)) return
    if (req.method === 'GET') {
      synced()
      const list = library.list().filter((w) => !w.hidden).map(describeWork)
      list.sort((a, b) => (b.pinned - a.pinned) || (b.exists - a.exists) || (b.updated - a.updated))
      return json(res, 200, { works: list.slice(0, 500) })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const w = byDir(body.dir)
    if (!w) return json(res, 404, { error: 'not in library' })
    switch (body.op) {
      case 'pin':
      case 'unpin':
        library.put(w.dir, { pinned: body.op === 'pin' ? true : undefined })
        break
      case 'hide':
        library.hide(w.dir)
        break
      case 'reveal': {
        if (!fs.existsSync(w.dir)) return json(res, 404, { error: 'gone' })
        const [cmd, args] = process.platform === 'darwin' ? ['open', [w.dir]] : process.platform === 'win32' ? ['explorer', [w.dir]] : ['xdg-open', [w.dir]]
        execFile(cmd, args, (e) => { if (e && process.platform !== 'win32') log(e) })
        break
      }
      case 'relocate': {
        const to = path.resolve(String(body.to || ''))
        let ok = false
        try { ok = fs.statSync(to).isDirectory() && listScreens(to).length > 0 } catch { ok = false }
        if (!ok) return json(res, 400, { error: 'noScreens' })
        library.move(w.dir, to)
        break
      }
      default:
        return json(res, 400, { error: 'bad op' })
    }
    json(res, 200, { ok: true })
  }

  // 缩略图一次只截一张（无头浏览器同时开的页面有限，别挤掉体检）
  let chain = Promise.resolve()
  const making = new Map()
  function makeThumb(w, d, file) {
    if (making.has(file)) return making.get(file)
    const job = chain.then(async () => {
      const browser = studio.browser
      if (!browser) throw new Error('no browser')
      const { origin } = await open({ kind: 'file', root: w.dir, file: path.join(w.dir, d.first) })
      const [vw, vh] = KIND_SIZE[d.kind] || KIND_SIZE.web
      const scale = Math.min(1, 480 / vw)
      const jpg = await browser.withPage({ url: `${origin}/${encodeURIComponent(d.first)}`, w: vw, h: Math.min(vh, Math.round(vw * 1.25)), scale, offline: library.strictRoot(w.dir) }, async (page) => {
        await prepare(page, false)
        return page.shot({ quality: 70 })
      })
      fs.mkdirSync(thumbDir, { recursive: true })
      fs.writeFileSync(file + '.tmp', jpg)
      fs.renameSync(file + '.tmp', file)
      return file
    })
    chain = job.catch(() => {})
    making.set(file, job)
    job.finally(() => making.delete(file)).catch(() => {})
    return job
  }

  async function workthumb(req, res) {
    if (!admit(req, res)) return
    const id = new URL(req.url, 'http://x').searchParams.get('id') || ''
    const w = /^[0-9a-f]{16}$/.test(id) ? byId(id) : null
    if (!w) return json(res, 404, { error: 'no such work' })
    const d = describeWork(w)
    if (!d.exists || !d.first || !d.thumb) return json(res, 404, { error: 'no screens' })
    const file = path.join(thumbDir, `${d.id}-${d.thumb}.jpg`)
    if (!fs.existsSync(file)) {
      try {
        await makeThumb(w, d, file)
        // 旧版本的缩略图清掉
        for (const f of fs.readdirSync(thumbDir)) if (f.startsWith(d.id + '-') && f !== path.basename(file)) fs.rmSync(path.join(thumbDir, f), { force: true })
      } catch (e) {
        log(e)
        return json(res, 503, { error: 'thumb failed' })
      }
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' })
    fs.createReadStream(file).on('error', () => res.end()).pipe(res)
  }

  async function pack(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    // 只打包作品库里的、或者某个会话正在预览的设计目录
    const dir = path.resolve(String(body.dir || ''))
    const snap = body.session ? tracker.snapshot(String(body.session)) : null
    const open = snap && snap.target && snap.target.kind === 'file' && path.resolve(snap.target.root) === dir
    if (!open && !byDir(dir)) return json(res, 404, { error: 'not a design here' })
    const screens = allScreens(dir) // 打包按整套算：屏数超了要明确报，不能悄悄少几屏
    if (!screens.length) return json(res, 400, { error: 'noScreens' })
    const local = localManifest(dir)
    // 分享向导先要一份预填：名字、介绍、授权、分享过没有
    if (body.info === true) {
      const pick = (v) => (v && typeof v === 'object' ? String(v[lang(body)] || v.zh || v.en || '') : '')
      return json(res, 200, { title: pick(local && local.title) || manifestTitle(dir) || path.basename(dir), description: pick(local && local.description), license: local && local.license === 'CC-BY-4.0' ? 'CC-BY-4.0' : 'CC0-1.0', share: shareOf(dir), screens: screens.length })
    }
    const license = body.license === 'CC-BY-4.0' ? 'CC-BY-4.0' : 'CC0-1.0'
    // 分享到市场：四个确认都要勾；分享记号第一次分享时生成，存在作者自己的 design.json 里，包里只带它的指纹
    const share = body.share === true
    if (share && !['own', 'brand', 'private', 'rules'].every((k) => body.agree && body.agree[k] === true)) return json(res, 400, { error: 'agree' })
    const token = share ? (local && typeof local.shareToken === 'string' && TOKEN_RE.test(local.shareToken) ? local.shareToken : crypto.randomBytes(16).toString('hex')) : ''
    const shareHash = token ? shareHashOf(token) : ''
    let p
    try {
      p = packDesign(dir, { screens, version, license, author: license === 'CC-BY-4.0' ? String(body.author || '') : '', mode: share ? 'share' : 'zip', lang: lang(body), title: share ? String(body.title || '') : '', description: share ? String(body.description || '') : '', shareHash, secrets: [token, local && local.shareToken].filter(Boolean) })
    } catch (e) {
      log(e)
      return json(res, 500, { error: e.message })
    }
    // 分享前体检：断网开出来量一遍（同机器人那套），机器人会拒的先在这拦住；没装 Chrome 就跳过（机器人那边还会查）
    const flags = [...p.flags]
    if (share && p.ok) {
      const browser = studio && studio.browser
      if (!browser || typeof browser.available !== 'function' || !browser.available()) flags.push({ code: 'noRender', msg: lang(body) === 'en' ? 'Chrome not found, so the layout check was skipped; the review bot will run it after you submit' : '没找到 Chrome，没做分享前体检；投稿后机器人会查' })
      else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-share-'))
        try {
          for (const f of p.files) {
            const to = path.join(tmp, f.path)
            fs.mkdirSync(path.dirname(to), { recursive: true })
            fs.writeFileSync(to, f.data)
          }
          const r = await render(tmp, { screens: p.manifest.screens.map((x) => x.file), kind: p.manifest.kind || 'web', shots: false, browser, qr: true })
          // 像是有二维码：先提醒（插件不解码）；真能扫出来的，机器人会退回
          flags.unshift(...(r.qrLike || []).slice(0, 5).map((x) => ({ code: 'qr', x: x.file, msg: lang(body) === 'en' ? `"${x.file}" seems to contain a QR code: the gallery does not accept scannable QR codes, so replace it with a placeholder square (otherwise the review bot will send it back)` : `「${x.file}」里像是有二维码：市场不收能扫的二维码，换成一个占位方块（不然机器人会退回）` })))
          for (const x of r.hard || []) p.errors.push({ code: 'hard', x: x.file, sev: 'error', msg: hardMsg(x, lang(body) === 'en') })
          // 开不出来的屏：机器人那边也会拒（同一套体检）
          for (const x of r.errors || []) p.errors.push({ code: 'render', x: x.file, sev: 'error', msg: lang(body) === 'en' ? `"${x.file}" could not be opened for the check (${String(x.error || '').slice(0, 80)}): open it on the canvas to see what is wrong, then try again` : `「${x.file}」没能打开量一遍（${String(x.error || '').slice(0, 80)}）：先在画布上打开看看哪里不对，再试一次` })
        } catch (e) {
          log(e)
          flags.push({ code: 'noRender', msg: lang(body) === 'en' ? 'The layout check could not run; the review bot will run it after you submit' : '分享前体检没跑成；投稿后机器人会查' })
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true })
        }
        if (p.errors.length) p.ok = false
      }
    }
    flags.sort((a, b) => Number(PERSONAL_CODES.has(b.code)) - Number(PERSONAL_CODES.has(a.code))) // 个人信息的提醒排最前面
    const out = { ok: p.ok, errors: p.errors.slice(0, 60), more: Math.max(0, p.errors.length - 60), flags: flags.slice(0, 30), flagsMore: Math.max(0, flags.length - 30), notes: p.notes.filter((x) => x.code !== 'aiPhoto').slice(0, 60), aiPhotos: p.notes.filter((x) => x.code === 'aiPhoto').length, skipped: p.skipped, bytes: p.bytes, title: p.manifest.title, screens: p.manifest.screens.length }
    if (!p.ok) return json(res, 200, out)
    try {
      fs.mkdirSync(downloads, { recursive: true })
      const t = p.manifest.title
      const stem = slugOf(t.zh || t.en || path.basename(dir), 'design')
      let file = path.join(downloads, `${stem}.zip`)
      for (let i = 2; fs.existsSync(file) && i < 100; i++) file = path.join(downloads, `${stem}-${i}.zip`)
      fs.writeFileSync(file, zipOf(p), { flag: 'wx' })
      exported.add(file)
      if (!share) return json(res, 200, { ...out, path: file })
      // 作者这边记下：分享记号 + 这次填的名字介绍（下次分享预填、「我的作品」认得出已上架）；从市场来的 from 留着
      const keep = { ...p.manifest }
      delete keep.shareHash
      const mine = { ...keep, ...(local && local.from ? { from: local.from } : {}), shareToken: token }
      const tmp = path.join(dir, `.design.json.${process.pid}.tmp`)
      fs.writeFileSync(tmp, JSON.stringify(mine, null, 2) + '\n')
      fs.renameSync(tmp, path.join(dir, 'design.json'))
      json(res, 200, { ...out, path: file, share: { ref: shareHash.slice(0, 12), slug: slugFor(t.en, t.zh, path.basename(dir)), title: t.zh || t.en || '' } })
    } catch (e) {
      log(e)
      json(res, 500, { error: e.message })
    }
  }

  async function usezip(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_ZIP_BODY) } catch (e) { return json(res, 400, { error: e.message === 'too large' ? 'big' : e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    const buf = Buffer.from(String(body.data || ''), 'base64')
    let prepared
    try {
      const { files } = readZip(buf)
      prepared = preparePack(files, { lang: lang(body) })
    } catch (e) {
      if (e instanceof ZipError) return json(res, 400, { error: 'zip', code: e.code, x: e.x })
      if (e instanceof UseError) return json(res, 400, { error: e.message, errors: (e.errors || []).slice(0, 40), more: Math.max(0, (e.errors || []).length - 40) })
      log(e)
      return json(res, 500, { error: e.message })
    }
    try {
      const name = String(body.name || '').replace(/\.zip$/i, '')
      const t = prepared.manifest.title
      const r = installPack(prepared, {
        base: baseFor(await sessionCwd(session)),
        name: (t && (t.zh || t.en)) || name,
        trust: 'zip',
        from: { zip: [...name].slice(0, 80).join('') || 'design.zip' },
        library,
      })
      await tracker.setTarget(session, { kind: 'file', file: r.first, root: r.dir }, { source: 'user', popup: false, kind: prepared.manifest.kind, size: prepared.manifest.size || '' })
      json(res, 200, { snap: tracker.snapshot(session), dir: r.dir, title: t, screens: r.screens, license: prepared.manifest.license, kind: prepared.manifest.kind, flags: prepared.flags.slice(0, 20) })
    } catch (e) {
      log(e)
      json(res, 500, { error: e.message })
    }
  }

  async function inspire(req, res) {
    if (!admit(req, res)) return
    if (req.method === 'GET') return json(res, 200, { items: inspiration.list() })
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_IMG_BODY) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      let item = null
      if (body.op === 'addImage') item = inspiration.addImage({ name: body.name, data: Buffer.from(String(body.data || ''), 'base64') })
      else if (body.op === 'addUrl') item = inspiration.addUrl({ url: body.url, name: body.name })
      else if (body.op === 'addStyle') item = inspiration.addStyle({ name: body.name, style: body.style, mid: body.mid })
      else if (body.op === 'addMarket') item = inspiration.addMarket({ mid: body.mid, mtype: body.mtype, name: body.name })
      else if (body.op === 'remove') inspiration.remove(String(body.id || ''))
      else return json(res, 400, { error: 'bad op' })
      json(res, 200, { item, items: inspiration.list() })
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  function inspimg(req, res) {
    if (!admit(req, res)) return
    const id = new URL(req.url, 'http://x').searchParams.get('id') || ''
    const file = /^[0-9a-f]{16}$/.test(id) ? inspiration.imageFile(id) : null
    if (!file) return json(res, 404, { error: 'no such image' })
    const ext = path.extname(file).slice(1)
    res.writeHead(200, { 'Content-Type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    fs.createReadStream(file).on('error', () => res.end()).pipe(res)
  }

  return { works, workthumb, pack, usezip, inspire, inspimg }
}
