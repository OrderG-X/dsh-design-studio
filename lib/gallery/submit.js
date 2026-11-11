/**
 * 一键投稿到设计市场（不用离开 DSH、不用拖 zip、不用装 git）：
 *
 *   1. 连 GitHub：设备授权——插件给一个码，用户在 github.com/login/device 输进去点同意。
 *      拿到的令牌只要 public_repo（动自己的公开仓库、开 issue），存在这台电脑上（只有自己能读），
 *      不发给页面、不进日志；「断开」就删掉。
 *   2. 投稿：zip 放进投稿人自己的仓库——内容仓库的主人直接放内容仓库的一个分支，
 *      别人（包括有写权限的协作者）先 fork 一份放进去；只放一个提交，地址按提交号钉死（之后改不了内容）。
 *      机器人只认「仓库主人 = 投稿人」的地址，所以协作者也得走自己的 fork。
 *   3. 用投稿人的身份开投稿 issue，格式和网页表单一样（四个确认在插件里勾过了）。
 *      之后和网页表单投稿完全一样：机器人下载、检查、转 PR、贴审核卡。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LIBRARY_DIR } from '../works.js'

// OAuth 应用「DSH Design Studio」（OrderG-X 名下，开了设备授权）的 Client ID：公开的，不是密钥
export const GH_CLIENT_ID = process.env.DSH_DESIGN_GH_CLIENT_ID ?? 'Ov23li7T6UcUOBKYE7Tc'
export const GALLERY = 'OrderG-X/dsh-design-gallery'
export const AUTH_FILE = path.join(LIBRARY_DIR, 'github.json')
const API = 'https://api.github.com'
const SCOPE = 'public_repo'
const UA = 'dsh-design-studio'
export const ZIP_MAX = 8 * 1024 * 1024 // 和机器人收稿的上限一样

// 投稿表单「授权」「确认」两栏的原文（机器人按表单的格式读）
export const FORM_LIC = { 'CC0-1.0': 'CC0-1.0（谁都能随便用，不用署名 / anyone can use it, no credit needed）', 'CC-BY-4.0': 'CC-BY-4.0（别人用要署你的名 / others must credit you）' }
const FORM_AGREE = [
  '这是我自己（或用设计台）做的原创设计，图片都是自己做的或 CC0 / 公有领域 / This is my original design; all images are mine or CC0 / public domain',
  '品牌是虚构的，没有仿冒真实网站、应用或机构 / The brand is made up and does not imitate a real site, app or organization',
  '里面没有真实的个人信息 / It contains no real personal data',
  '同意按上面选的授权公开，并收进设计市场 / I agree to publish it under the license above in the design gallery',
]

/** 出错的种类（页面按 code 出提示）：auth 要重新连、net 连不上 GitHub、denied 用户点了拒绝、expired 码过期… */
export class GhError extends Error {
  constructor(code, msg = '', status = 0) {
    super(msg || code)
    this.code = code
    this.status = status
  }
}

/** 投稿 issue 的正文：和网页表单交出来的一样（「### 标题」一段一段），机器人照常读；开头记着包的指纹（重试时认出投过了） */
export function issueBody({ zipUrl, slug = '', license = 'CC0-1.0', pack = '' }) {
  return [
    '<!-- 设计台一键投稿 / Submitted from the design studio -->',
    ...(/^[0-9a-f]{64}$/.test(pack) ? [`<!-- dsh-pack: ${pack} -->`] : []),
    '### 设计包 / Design pack',
    '',
    zipUrl,
    '',
    '### 短名 / Short name',
    '',
    /^[a-z0-9-]{3,40}$/.test(slug) ? slug : '_No response_',
    '',
    '### 授权 / License',
    '',
    FORM_LIC[license] || FORM_LIC['CC0-1.0'],
    '',
    '### 确认 / Confirm',
    '',
    ...FORM_AGREE.map((x) => `- [X] ${x}`),
    '',
  ].join('\n')
}

/** 包的内容指纹：文件路径 + 内容（不含 zip 里的时间），同一套内容重新打包也一样 */
export function packPrint(files) {
  const h = crypto.createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const d = Buffer.from(f.data)
    h.update(`${f.path}\0${d.length}\0`)
    h.update(d)
  }
  return h.digest('hex')
}

export function createGitHub({ file = AUTH_FILE, clientId = GH_CLIENT_ID, fetcher = (...a) => globalThis.fetch(...a), wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log = () => {} } = {}) {
  let flow = null // 正在等用户输码：{ code, uri, expiresAt, interval, error }
  let busy = null // 正在投的（一次只投一个，连点不会开两个 issue）
  let epoch = 0 // 每次「断开」加一：断开前发出去的换令牌、等输码，回来时作废，不能把授权又写回来
  let gen = 0 // 每次开始连、取消、断开都加一：要码的请求回来时对不上就作废（不能在取消之后又冒出一个码）

  function load() {
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'))
      return a && typeof a.token === 'string' && a.token && typeof a.login === 'string' ? a : null
    } catch { return null }
  }
  function save(a) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, file)
    try { fs.chmodSync(file, 0o600) } catch { /* Windows 不认，没关系 */ }
  }
  function clear() {
    try { fs.rmSync(file, { force: true }) } catch { /* 删不掉下次再说 */ }
  }

  async function form(url, params) {
    let r
    try {
      r = await fetcher(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(20000) })
    } catch (e) { throw new GhError('net', String((e && e.message) || e)) }
    // GitHub 临时出毛病（限流、5xx）：算连不上，授权留着，等会儿再试
    if (r.status === 429 || r.status >= 500) throw new GhError('net', `HTTP ${r.status}`)
    let j = null
    try { j = await r.json() } catch { j = null }
    if (!j || typeof j !== 'object') throw new GhError('net', `HTTP ${r.status}`)
    return j
  }

  async function call(token, method, p, body) {
    let r
    try {
      r = await fetcher(API + p, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90000),
      })
    } catch (e) { throw new GhError('net', String((e && e.message) || e)) }
    let j = null
    try { j = await r.json() } catch { j = null }
    // 令牌被拒：只删这一个（请求途中用户可能已经断开又重新连上了，新令牌不能跟着删）
    if (r.status === 401) {
      const a = load()
      if (a && a.token === token) clear()
      throw new GhError('auth', 'token rejected', 401)
    }
    if (r.status < 200 || r.status >= 300) throw new GhError('api', String((j && j.message) || `HTTP ${r.status}`).slice(0, 200), r.status)
    // 回包读不全（被截断、不是 JSON）：当连不上，别把「没读到」当成「没有」接着往下走
    if (!j || typeof j !== 'object') throw new GhError('net', `bad response ${r.status}`)
    return j
  }

  const record = (j, who) => ({
    token: j.access_token,
    refresh: typeof j.refresh_token === 'string' ? j.refresh_token : '',
    expiresAt: Number(j.expires_in) > 0 ? now() + Number(j.expires_in) * 1000 : 0,
    refreshExpiresAt: Number(j.refresh_token_expires_in) > 0 ? now() + Number(j.refresh_token_expires_in) * 1000 : 0,
    login: String(who.login),
    id: Number(who.id) || 0,
  })

  /** 能用的令牌：快过期了先换新的；换不了就要重新连 */
  async function token() {
    const a = load()
    if (!a) throw new GhError('auth')
    if (!a.expiresAt || now() < a.expiresAt - 120000) return a.token
    if (a.refresh && (!a.refreshExpiresAt || now() < a.refreshExpiresAt)) {
      // 连不上 GitHub（form 抛 net）：原样抛出去，授权留着，等会儿再试；GitHub 明说不行才要重新连
      const at = epoch
      const j = await form('https://github.com/login/oauth/access_token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: a.refresh })
      if (at !== epoch) throw new GhError('auth') // 等回包的时候用户断开了
      if (typeof j.access_token === 'string' && j.access_token) {
        save(record(j, a))
        return j.access_token
      }
      // 没给令牌也没说为什么：当临时故障，授权留着
      if (typeof j.error !== 'string' || !j.error) throw new GhError('net', 'refresh: no token')
    }
    clear()
    throw new GhError('auth')
  }

  async function poll(f, deviceCode) {
    const at = epoch
    while (flow === f && at === epoch) {
      await wait(f.interval * 1000)
      if (flow !== f) return
      if (now() > f.expiresAt) { f.error = 'expired'; return }
      let j
      try {
        j = await form('https://github.com/login/oauth/access_token', { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
      } catch { continue } // 网络抖一下：接着等，码过期了自然停
      if (flow !== f) return
      if (j.error === 'authorization_pending') continue
      if (j.error === 'slow_down') { f.interval = Math.max(f.interval + 5, Number(j.interval) || 0); continue }
      if (j.error || typeof j.access_token !== 'string' || !j.access_token) { f.error = j.error === 'access_denied' ? 'denied' : j.error === 'expired_token' ? 'expired' : 'device'; return }
      const who = await call(j.access_token, 'GET', '/user')
      if (flow !== f || at !== epoch) return
      save(record(j, who))
      flow = null
      return
    }
  }

  /** 给页面看的状态：连上的账号、或者正在等输的码（令牌不出这个文件） */
  function status() {
    const a = load()
    return { ready: !!clientId, login: a ? a.login : '', flow: flow ? { code: flow.code, uri: flow.uri, expiresAt: flow.expiresAt, error: flow.error } : null, busy: !!busy }
  }

  async function start() {
    if (!clientId) throw new GhError('noApp')
    flow = null
    const my = ++gen
    const j = await form('https://github.com/login/device/code', { client_id: clientId, scope: SCOPE })
    if (my !== gen) return status() // 等码的时候点了取消、断开或者又点了一次连
    if (typeof j.device_code !== 'string' || typeof j.user_code !== 'string') throw new GhError('device', String(j.error_description || j.error || ''))
    const uri = /^https:\/\/github\.com\/login\/device\b/.test(String(j.verification_uri)) ? String(j.verification_uri) : 'https://github.com/login/device'
    const f = { code: j.user_code.slice(0, 20), uri, expiresAt: now() + Math.min(Number(j.expires_in) || 900, 1800) * 1000, interval: Math.max(5, Number(j.interval) || 5), error: '' }
    flow = f
    poll(f, j.device_code).catch((e) => {
      if (flow === f) f.error = e instanceof GhError ? e.code : 'device'
      log(e)
    })
    return status()
  }

  function cancel() { gen++; flow = null }
  function logout() {
    epoch++
    gen++
    flow = null
    clear()
  }

  async function submitOnce({ zip, title, ref, slug, license, pack: fp = '', as = '' }) {
    if (!Buffer.isBuffer(zip) || !zip.length) throw new GhError('zip')
    if (zip.length > ZIP_MAX) throw new GhError('big')
    const tok = await token()
    const me = await call(tok, 'GET', '/user')
    const login = String(me.login || '')
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new GhError('api', 'no login')
    // 面板上显示的是另一个账号（别的窗口断开又连了别人）：先不投，让用户看清楚用谁投再点
    if (as && String(as).toLowerCase() !== login.toLowerCase()) throw new GhError('who', login)
    // 同一个包投过、那条投稿还开着（上次 issue 建好了但回包丢了、用户又点了一次）：直接给那条，不再开第二个。
    // 指纹按包里的文件内容算（routes 打包时算好传进来），重新打包时间变了也认得出；没传就按 zip 本身
    const pack = /^[0-9a-f]{64}$/.test(fp) ? fp : crypto.createHash('sha256').update(zip).digest('hex')
    const mark = `<!-- dsh-pack: ${pack} -->`
    let had = null
    for (let page = 1; !had; page++) {
      // 开着的超过一千条还没翻完：查不全就不投（宁可不投，也不重复开）
      if (page > 10) throw new GhError('api', 'too many open issues to check for duplicates')
      const mine = await call(tok, 'GET', `/repos/${GALLERY}/issues?creator=${encodeURIComponent(login)}&state=open&per_page=100&page=${page}`)
      if (!Array.isArray(mine)) throw new GhError('net', 'issues: not a list')
      had = mine.find((x) => x && !x.pull_request && typeof x.body === 'string' && x.body.includes(mark) && /^https:\/\/github\.com\//.test(String(x.html_url))) || null
      if (mine.length < 100) break
    }
    if (had) return { url: had.html_url, number: had.number, login, fork: '', again: true }
    // 放 zip 的仓库：内容仓库的主人放内容仓库，别人（协作者也一样）放自己的 fork——机器人只认「仓库主人 = 投稿人」
    let target = GALLERY
    if (login.toLowerCase() !== GALLERY.split('/')[0].toLowerCase()) {
      const fk = await call(tok, 'POST', `/repos/${GALLERY}/forks`, { default_branch_only: true })
      const owner = String((fk.owner && fk.owner.login) || '')
      if (typeof fk.full_name !== 'string' || owner.toLowerCase() !== login.toLowerCase() || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(fk.full_name)) throw new GhError('fork', String(fk.full_name || ''))
      target = fk.full_name
    }
    // fork 是后台慢慢建的：建好之前写不进去，隔几秒再试（最多一分多钟）
    let blob
    for (let i = 0; ; i++) {
      try {
        blob = await call(tok, 'POST', `/repos/${target}/git/blobs`, { content: zip.toString('base64'), encoding: 'base64' })
        break
      } catch (e) {
        if (i >= 14 || !(e instanceof GhError) || !(e.status === 404 || e.status === 409)) throw e
        await wait(5000)
      }
    }
    const tree = await call(tok, 'POST', `/repos/${target}/git/trees`, { tree: [{ path: 'submission.zip', mode: '100644', type: 'blob', sha: blob.sha }] })
    const commit = await call(tok, 'POST', `/repos/${target}/git/commits`, { message: `design submission ${ref}`, tree: tree.sha, parents: [] })
    if (!/^[0-9a-f]{40}$/.test(String(commit.sha))) throw new GhError('api', 'no commit')
    // 挂一个分支，免得提交被当成没人要的清理掉
    await call(tok, 'POST', `/repos/${target}/git/refs`, { ref: `refs/heads/dsh-submit/${ref}-${now().toString(36)}`, sha: commit.sha })
    const zipUrl = `https://github.com/${target}/raw/${commit.sha}/submission.zip`
    const issue = await call(tok, 'POST', `/repos/${GALLERY}/issues`, {
      title: `投稿 / Submission: ${String(title).replace(/\s+/g, ' ').trim().slice(0, 60)} · ${ref}`,
      body: issueBody({ zipUrl, slug, license, pack }),
      labels: ['submission'], // 外人开的会被 GitHub 悄悄去掉；机器人按标题认，回复时补上
    })
    if (!/^https:\/\/github\.com\//.test(String(issue.html_url))) throw new GhError('api', 'no issue')
    return { url: issue.html_url, number: issue.number, login, fork: target !== GALLERY ? target : '' }
  }

  async function submit(opts) {
    if (busy) throw new GhError('busy')
    busy = submitOnce(opts)
    try { return await busy } finally { busy = null }
  }

  return { status, start, cancel, logout, submit, token }
}
