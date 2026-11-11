/**
 * 一键投稿：GitHub 设备授权、令牌存放、把 zip 放进自己的仓库、开投稿 issue（假的 GitHub，不联网）
 *   node test/test-gallery-submit.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGitHub, issueBody, packPrint, GALLERY, ZIP_MAX } from '../lib/gallery/submit.js'
import { createLibraryRoutes } from '../lib/gallery/routes.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const rejects = async (p, code) => { try { await p; return false } catch (e) { return e.code === code } }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-submit-')))
const SHA = 'c'.repeat(40)

/** 假的 GitHub：按 方法 + 地址 回预设的；记下每个请求 */
function fakeGitHub({ push = false, tokenSteps = null, user = { login: 'Alice-1', id: 42 }, blob404 = 1, forkOwner = 'Alice-1', userStatus = 200, openIssues = [], refreshDown = false, refreshReply = null, issuesReply = null, deviceGate = null } = {}) {
  const log = []
  const steps = tokenSteps || [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { access_token: 'tok1', refresh_token: 'ref1', expires_in: 28800, refresh_token_expires_in: 15897600, scope: 'public_repo' }]
  let blobMiss = blob404
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
  const fetcher = async (url, o = {}) => {
    const method = o.method || 'GET'
    const body = o.body && String(o.headers && o.headers['Content-Type']).includes('json') ? JSON.parse(o.body) : o.body ? Object.fromEntries(new URLSearchParams(o.body)) : null
    log.push({ method, url, body, auth: o.headers && o.headers.Authorization })
    if (url === 'https://github.com/login/device/code' && deviceGate) await deviceGate
    if (url === 'https://github.com/login/device/code') return reply(200, { device_code: 'dc1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
    if (url === 'https://github.com/login/oauth/access_token') {
      if (body.grant_type === 'refresh_token' && refreshDown) throw new Error('ETIMEDOUT')
      if (body.grant_type === 'refresh_token' && refreshReply) return reply(refreshReply.status, refreshReply.body)
      if (body.grant_type === 'refresh_token') return reply(200, body.refresh_token === 'ref1' ? { access_token: 'tok2', refresh_token: 'ref2', expires_in: 28800 } : { error: 'bad_refresh_token' })
      return reply(200, steps.length > 1 ? steps.shift() : steps[0])
    }
    const p = url.replace('https://api.github.com', '')
    if (p === '/user') return reply(userStatus, userStatus === 200 ? user : { message: 'Bad credentials' })
    if (p === `/repos/${GALLERY}` && method === 'GET') return reply(200, { full_name: GALLERY, permissions: { push, pull: true } })
    if (p.startsWith(`/repos/${GALLERY}/issues?`) && method === 'GET') {
      if (issuesReply) return issuesReply(p)
      const page = Number(new URLSearchParams(p.split('?')[1]).get('page') || 1)
      return reply(200, Array.isArray(openIssues[0]) ? openIssues[page - 1] || [] : page === 1 ? openIssues : [])
    }
    if (p === `/repos/${GALLERY}/forks`) return reply(202, { full_name: `${forkOwner}/dsh-design-gallery`, owner: { login: forkOwner } })
    if (/\/git\/blobs$/.test(p)) { if (blobMiss-- > 0) return reply(404, { message: 'Not Found' }); return reply(201, { sha: 'b'.repeat(40) }) }
    if (/\/git\/trees$/.test(p)) return reply(201, { sha: 't'.repeat(40) })
    if (/\/git\/commits$/.test(p)) return reply(201, { sha: SHA })
    if (/\/git\/refs$/.test(p)) return reply(201, { ref: body.ref })
    if (p === `/repos/${GALLERY}/issues`) return reply(201, { html_url: `https://github.com/${GALLERY}/issues/99`, number: 99 })
    return reply(404, { message: 'Not Found' })
  }
  return { fetcher, log }
}

// ── 投稿 issue 的正文：和网页表单一个样 ──
{
  const b = issueBody({ zipUrl: `https://github.com/Alice-1/dsh-design-gallery/raw/${SHA}/submission.zip`, slug: 'morning-cafe', license: 'CC-BY-4.0' })
  check('正文：四段标题和表单一样', ['### 设计包 / Design pack', '### 短名 / Short name', '### 授权 / License', '### 确认 / Confirm'].every((x) => b.includes(x)))
  check('正文：zip 地址、短名、授权原文', b.includes(`/raw/${SHA}/submission.zip`) && b.includes('\nmorning-cafe\n') && b.includes('CC-BY-4.0（别人用要署你的名'))
  check('正文：四个确认都勾上', (b.match(/^- \[X\] /gm) || []).length === 4)
  check('正文：短名不合规就留空（机器人按标题生成）', issueBody({ zipUrl: 'x', slug: '../evil' }).includes('_No response_') && issueBody({ zipUrl: 'x', license: 'MIT' }).includes('CC0-1.0（'))
}

// ── 连 GitHub：设备授权 ──
const file = path.join(tmp, 'auth', 'github.json')
{
  const gh0 = createGitHub({ file, clientId: '', fetcher: async () => { throw new Error('不该联网') } })
  check('没配应用：状态里标出来，开始连直接报 noApp', gh0.status().ready === false && await rejects(gh0.start(), 'noApp'))

  const f = fakeGitHub()
  let waited = []
  let clock = 1_000_000
  const gh = createGitHub({ file, clientId: 'Iv1.test', fetcher: f.fetcher, wait: async (ms) => { waited.push(ms); clock += ms }, now: () => clock })
  const s = await gh.start()
  check('开始连：给码和输码的地址', s.flow && s.flow.code === 'ABCD-1234' && s.flow.uri === 'https://github.com/login/device' && !s.login)
  check('要的权限只有 public_repo', f.log[0].body.scope === 'public_repo' && f.log[0].body.client_id === 'Iv1.test')
  for (let i = 0; i < 20 && !gh.status().login; i++) await new Promise((r) => setImmediate(r))
  const st = gh.status()
  check('等用户输码：pending 接着等、slow_down 放慢，拿到令牌后连上', st.login === 'Alice-1' && !st.flow && waited[0] === 5000 && waited[2] >= 10000, JSON.stringify({ st, waited }))
  check('状态里没有令牌', !JSON.stringify(st).includes('tok1') && !JSON.stringify(st).includes('ref1'))
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  check('令牌存在本机文件里（带账号）', saved.token === 'tok1' && saved.refresh === 'ref1' && saved.login === 'Alice-1' && saved.id === 42 && saved.expiresAt > clock)
  if (process.platform !== 'win32') check('令牌文件只有自己能读', (fs.statSync(file).mode & 0o077) === 0, (fs.statSync(file).mode & 0o777).toString(8))
  check('拿 /user 时用的是新令牌', f.log.some((x) => x.url.endsWith('/user') && x.auth === 'Bearer tok1'))

  // 快过期了：先换新令牌
  clock = saved.expiresAt - 1000
  check('快过期：用刷新令牌换新的', await gh.token() === 'tok2' && JSON.parse(fs.readFileSync(file, 'utf8')).token === 'tok2')
  // 换新令牌时连不上 GitHub：报 net，授权留着
  const saved2 = JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.writeFileSync(file, JSON.stringify({ ...saved2, expiresAt: 1, refresh: 'ref1' }))
  const ghDown = createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub({ refreshDown: true }).fetcher, wait: async () => {}, now: () => clock })
  check('换新令牌时断网：报 net，不删授权', await rejects(ghDown.token(), 'net') && fs.existsSync(file))
  const ghBusy = createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub({ refreshReply: { status: 503, body: { error: 'temporarily_unavailable' } } }).fetcher, wait: async () => {}, now: () => clock })
  check('换新令牌时 GitHub 503：报 net，不删授权', await rejects(ghBusy.token(), 'net') && fs.existsSync(file))
  const ghOdd = createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub({ refreshReply: { status: 200, body: {} } }).fetcher, wait: async () => {}, now: () => clock })
  check('换新令牌时回包没令牌也没说原因：报 net，不删授权', await rejects(ghOdd.token(), 'net') && fs.existsSync(file))
  // 换新令牌的回包还没到，用户点了「断开」：回包到了也不能把授权写回来
  let letGo
  const gate = new Promise((r) => { letGo = r })
  const slowF = fakeGitHub()
  const ghSlow = createGitHub({ file, clientId: 'Iv1.test', fetcher: async (u, o) => { if (u.includes('access_token')) await gate; return slowF.fetcher(u, o) }, wait: async () => {}, now: () => clock })
  const pending = ghSlow.token()
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
  ghSlow.logout()
  letGo()
  check('换令牌途中断开：回包作废，授权不会又回来', await rejects(pending, 'auth') && !fs.existsSync(file) && ghSlow.status().login === '')
  fs.writeFileSync(file, JSON.stringify({ ...saved2, expiresAt: 1, refresh: 'ref1' }))
  gh.logout()
  check('断开：令牌文件删掉', !fs.existsSync(file) && gh.status().login === '' && await rejects(gh.token(), 'auth'))

  // 用户点了拒绝 / 码过期
  const g2 = createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub({ tokenSteps: [{ error: 'access_denied' }] }).fetcher, wait: async () => {} })
  await g2.start()
  for (let i = 0; i < 20 && !(g2.status().flow || {}).error; i++) await new Promise((r) => setImmediate(r))
  check('用户在 GitHub 点了拒绝：标 denied，不存令牌', g2.status().flow.error === 'denied' && !fs.existsSync(file))
  let c3 = 0
  const g3 = createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub({ tokenSteps: [{ error: 'authorization_pending' }] }).fetcher, wait: async (ms) => { c3 += ms }, now: () => 1_000_000 + c3 })
  await g3.start()
  for (let i = 0; i < 400 && !(g3.status().flow || {}).error; i++) await new Promise((r) => setImmediate(r))
  check('一直没输：码过期就停，标 expired', g3.status().flow && g3.status().flow.error === 'expired')
  g3.cancel()
  check('取消：不再显示码', g3.status().flow === null)

  // 要码的请求还没回来就点了取消 / 断开：回来的码作废，不开始等
  for (const how of ['cancel', 'logout']) {
    let open
    const gate = new Promise((r) => { open = r })
    const fg = fakeGitHub({ deviceGate: gate })
    const g4 = createGitHub({ file, clientId: 'Iv1.test', fetcher: fg.fetcher, wait: async () => {} })
    const p4 = g4.start()
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    g4[how]()
    open()
    const s4 = await p4
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
    check(`要码途中${how === 'cancel' ? '取消' : '断开'}：码作废、不去等授权`, s4.flow === null && g4.status().flow === null && !fg.log.some((x) => x.url.includes('access_token')))
  }
}

/** 直接放一个能用的令牌（跳过输码） */
const authed = (extra = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ token: 'tok1', refresh: '', expiresAt: 0, login: 'Alice-1', id: 42, ...extra }))
}
const zip = Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'latin1')

// ── 投稿：别人（没有写权限）走自己的 fork ──
{
  authed()
  const f = fakeGitHub({ blob404: 2 })
  let waits = 0
  const gh = createGitHub({ file, clientId: 'Iv1.test', fetcher: f.fetcher, wait: async () => { waits++ }, now: () => 1_700_000_000_000 })
  const r = await gh.submit({ zip, title: '晨光  咖啡馆', ref: 'abcdef012345', slug: 'morning-cafe', license: 'CC0-1.0' })
  const urls = f.log.map((x) => `${x.method} ${x.url.replace('https://api.github.com', '')}`)
  check('外人：先 fork，zip 放进自己的 fork', urls.includes(`POST /repos/${GALLERY}/forks`) && urls.includes('POST /repos/Alice-1/dsh-design-gallery/git/blobs') && r.fork === 'Alice-1/dsh-design-gallery', urls.join('\n'))
  check('fork 还没建好（404）：等一会儿再写', waits === 2 && urls.filter((u) => u.endsWith('/git/blobs')).length === 3)
  const blob = f.log.find((x) => x.url.endsWith('/git/blobs') && x.method === 'POST')
  check('zip 原样 base64 上传', blob.body.encoding === 'base64' && Buffer.from(blob.body.content, 'base64').equals(zip))
  const commit = f.log.find((x) => x.url.endsWith('/git/commits'))
  const tree = f.log.find((x) => x.url.endsWith('/git/trees'))
  check('只放一个文件、一个没有上级的提交', tree.body.tree.length === 1 && tree.body.tree[0].path === 'submission.zip' && commit.body.parents.length === 0)
  const ref = f.log.find((x) => x.url.endsWith('/git/refs'))
  check('挂一个分支留住提交', /^refs\/heads\/dsh-submit\/abcdef012345-[a-z0-9]+$/.test(ref.body.ref) && ref.body.sha === SHA)
  const issue = f.log.find((x) => x.url.endsWith(`/repos/${GALLERY}/issues`))
  check('开 issue：标题带投稿记号（「看投稿进度」按它找）', issue.body.title === '投稿 / Submission: 晨光 咖啡馆 · abcdef012345' && issue.body.labels[0] === 'submission')
  check('开 issue：正文里的 zip 地址按提交号钉死、在自己仓库', issue.body.body.includes(`https://github.com/Alice-1/dsh-design-gallery/raw/${SHA}/submission.zip`))
  const packMark = `<!-- dsh-pack: ${crypto.createHash('sha256').update(zip).digest('hex')} -->`
  check('开 issue：记着包的指纹；投之前先查自己开着的投稿', issue.body.body.includes(packMark) && urls.indexOf(`GET /repos/${GALLERY}/issues?creator=Alice-1&state=open&per_page=100&page=1`) > -1 && urls.indexOf(`GET /repos/${GALLERY}/issues?creator=Alice-1&state=open&per_page=100&page=1`) < urls.indexOf(`POST /repos/${GALLERY}/forks`))
  check('回给页面：issue 地址', r.url === `https://github.com/${GALLERY}/issues/99` && r.login === 'Alice-1')
  check('每个请求都带令牌', f.log.filter((x) => x.url.startsWith('https://api.github.com')).every((x) => x.auth === 'Bearer tok1'))
}

// ── 投稿：维护者（有写权限）直接放内容仓库 ──
{
  authed({ login: 'OrderG-X' })
  const f = fakeGitHub({ push: true, blob404: 0, user: { login: 'OrderG-X', id: 7 }, forkOwner: 'OrderG-X' })
  const gh = createGitHub({ file, clientId: 'Iv1.test', fetcher: f.fetcher, wait: async () => {} })
  const r = await gh.submit({ zip, title: 'x', ref: 'abcdef012345', slug: '', license: 'CC0-1.0' })
  const urls = f.log.map((x) => x.url.replace('https://api.github.com', ''))
  check('维护者：不 fork，放内容仓库的分支', !urls.some((u) => u.endsWith('/forks')) && urls.includes(`/repos/${GALLERY}/git/blobs`) && r.fork === '')
  check('维护者：zip 地址在内容仓库', f.log.find((x) => x.url.endsWith('/issues')).body.body.includes(`https://github.com/${GALLERY}/raw/${SHA}/submission.zip`))
  // 协作者有写权限，但机器人只认「仓库主人 = 投稿人」：照样走自己的 fork
  authed({ login: 'Bob' })
  const fb = fakeGitHub({ push: true, blob404: 0, user: { login: 'Bob', id: 8 }, forkOwner: 'Bob' })
  const rb = await createGitHub({ file, clientId: 'Iv1.test', fetcher: fb.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345' })
  check('协作者（有写权限）：也走自己的 fork', rb.fork === 'Bob/dsh-design-gallery' && fb.log.some((x) => x.url.endsWith('/forks')) && !fb.log.some((x) => x.url.endsWith(`/repos/${GALLERY}/git/blobs`)))
}

// ── 投稿：同一个包上次已经开好 issue（回包丢了、又点一次）→ 直接给那条 ──
{
  authed()
  const mark = `<!-- dsh-pack: ${crypto.createHash('sha256').update(zip).digest('hex')} -->`
  const f = fakeGitHub({ openIssues: [{ number: 5, html_url: `https://github.com/${GALLERY}/pull/5`, pull_request: {}, body: mark }, { number: 7, html_url: `https://github.com/${GALLERY}/issues/7`, body: `x\n${mark}\n` }] })
  const r = await createGitHub({ file, clientId: 'Iv1.test', fetcher: f.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345' })
  check('同一个包投过、还开着：给原来那条，不传不开新的', r.url === `https://github.com/${GALLERY}/issues/7` && r.again && !f.log.some((x) => x.method === 'POST'), JSON.stringify(r))
  const f2 = fakeGitHub({ openIssues: [{ number: 7, html_url: `https://github.com/${GALLERY}/issues/7`, body: '<!-- dsh-pack: ' + '0'.repeat(64) + ' -->' }] })
  const r2 = await createGitHub({ file, clientId: 'Iv1.test', fetcher: f2.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345' })
  check('包变了：照常开新的', r2.url.endsWith('/issues/99'))
  // 投过的那条在第二页（开着的投稿很多）
  const filler = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, html_url: `https://github.com/${GALLERY}/issues/${1000 + i}`, body: 'x' }))
  const f3 = fakeGitHub({ openIssues: [filler, [{ number: 8, html_url: `https://github.com/${GALLERY}/issues/8`, body: mark }]] })
  const r3 = await createGitHub({ file, clientId: 'Iv1.test', fetcher: f3.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345' })
  check('投过的那条在第二页：也认得出', r3.url.endsWith('/issues/8') && r3.again && !f3.log.some((x) => x.method === 'POST'))
  const f3b = fakeGitHub({ openIssues: Array.from({ length: 11 }, () => filler) })
  check('开着的超过十页还没查完：不投（不能当成没投过）', await rejects(createGitHub({ file, clientId: 'Iv1.test', fetcher: f3b.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345' }), 'api') && !f3b.log.some((x) => x.method === 'POST') && f3b.log.filter((x) => x.url.includes('/issues?')).length === 10)
  // 打包时传了内容指纹：按它认（重新打包 zip 时间变了也一样）
  const fp = 'e'.repeat(64)
  const f4 = fakeGitHub({ openIssues: [{ number: 9, html_url: `https://github.com/${GALLERY}/issues/9`, body: `<!-- dsh-pack: ${fp} -->` }] })
  const r4 = await createGitHub({ file, clientId: 'Iv1.test', fetcher: f4.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345', pack: fp })
  check('按打包时的内容指纹认投过的', r4.url.endsWith('/issues/9') && r4.again)
  const f5 = fakeGitHub()
  await createGitHub({ file, clientId: 'Iv1.test', fetcher: f5.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'abcdef012345', pack: fp })
  check('开 issue 时记的是内容指纹', f5.log.find((x) => x.url.endsWith(`/repos/${GALLERY}/issues`) && x.method === 'POST').body.body.includes(`<!-- dsh-pack: ${fp} -->`))
  // 查投过没有的回包读坏了：不能当成「没投过」接着开
  const trunc = () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input') } })
  const f6 = fakeGitHub({ issuesReply: trunc })
  check('查投过没有：回包被截断就报 net，不上传不开 issue', await rejects(createGitHub({ file, clientId: 'Iv1.test', fetcher: f6.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'r' }), 'net') && !f6.log.some((x) => x.method === 'POST'))
  const f7 = fakeGitHub({ issuesReply: () => ({ status: 200, ok: true, json: async () => ({ message: 'odd' }) }) })
  check('查投过没有：回的不是列表也报 net', await rejects(createGitHub({ file, clientId: 'Iv1.test', fetcher: f7.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'r' }), 'net') && !f7.log.some((x) => x.method === 'POST'))
}

// ── 内容指纹：和文件顺序、zip 时间无关，内容变了就变 ──
{
  const a = [{ path: 'design.json', data: Buffer.from('{}') }, { path: 'home.html', data: Buffer.from('<p>1</p>') }]
  const b = [a[1], a[0]]
  const c = [a[0], { path: 'home.html', data: Buffer.from('<p>2</p>') }]
  const d = [{ path: 'design.json', data: Buffer.from('{}home.html') }, { path: '', data: Buffer.from('<p>1</p>') }]
  check('内容指纹：顺序不同一样、内容变了不一样、拼接不会撞', packPrint(a) === packPrint(b) && packPrint(a) !== packPrint(c) && packPrint(a) !== packPrint(d) && /^[0-9a-f]{64}$/.test(packPrint(a)))
}

// ── 投稿：出错 ──
{
  authed()
  const gh = (o, w = async () => {}) => createGitHub({ file, clientId: 'Iv1.test', fetcher: fakeGitHub(o).fetcher, wait: w })
  check('包太大：不上传', await rejects(gh({}).submit({ zip: Buffer.alloc(ZIP_MAX + 1), title: 'x', ref: 'r' }), 'big'))
  check('fork 回来的不是自己的：停', await rejects(gh({ forkOwner: 'mallory', blob404: 0 }).submit({ zip, title: 'x', ref: 'r' }), 'fork'))
  check('fork 一直建不好：最后报错，不无限等', await rejects(gh({ blob404: 99 }).submit({ zip, title: 'x', ref: 'r' }), 'api'))
  check('令牌被撤了（401）：要重新连，令牌文件删掉', await rejects(gh({ userStatus: 401 }).submit({ zip, title: 'x', ref: 'r' }), 'auth') && !fs.existsSync(file))
  check('没连过：要先连', await rejects(gh({}).submit({ zip, title: 'x', ref: 'r' }), 'auth'))
  {
    // 面板上显示 Alice，令牌其实已经是 Bob 的（别的窗口换了号）：不投，告诉页面现在是谁
    authed({ login: 'Bob' })
    const fw = fakeGitHub({ user: { login: 'Bob', id: 8 }, forkOwner: 'Bob' })
    let err = null
    try { await createGitHub({ file, clientId: 'Iv1.test', fetcher: fw.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'r', as: 'Alice-1' }) } catch (e) { err = e }
    check('面板的账号和令牌对不上：不投，报出现在的账号', err && err.code === 'who' && err.message === 'Bob' && !fw.log.some((x) => x.method === 'POST' || x.url.includes('/issues?')))
    const fo = fakeGitHub({ user: { login: 'Bob', id: 8 }, forkOwner: 'Bob' })
    const ro = await createGitHub({ file, clientId: 'Iv1.test', fetcher: fo.fetcher, wait: async () => {} }).submit({ zip, title: 'x', ref: 'r', as: 'bob' })
    check('账号对得上（大小写不管）：照常投', !!ro.url)
    authed()
  }
  {
    // 旧令牌的请求还没回来，用户断开又连上了新账号：旧请求的 401 不能把新令牌删掉
    authed()
    let open
    const gate = new Promise((r) => { open = r })
    const f401 = fakeGitHub({ userStatus: 401 })
    const old = createGitHub({ file, clientId: 'Iv1.test', fetcher: async (u, o) => { if (u.endsWith('/user')) await gate; return f401.fetcher(u, o) }, wait: async () => {} })
    const p = old.submit({ zip, title: 'x', ref: 'r' })
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    authed({ token: 'tok9', login: 'Carol' })
    open()
    check('旧令牌被拒：新连上的令牌不删', await rejects(p, 'auth') && JSON.parse(fs.readFileSync(file, 'utf8')).token === 'tok9')
    fs.rmSync(file, { force: true })
  }
  authed({ expiresAt: 1, refresh: 'nope' })
  check('过期又换不了：要重新连', await rejects(gh({}).submit({ zip, title: 'x', ref: 'r' }), 'auth') && !fs.existsSync(file))
  authed()
  let release
  const slow = gh({ blob404: 1 }, () => new Promise((r) => { release = r }))
  const first = slow.submit({ zip, title: 'x', ref: 'r' })
  const second = await rejects(slow.submit({ zip, title: 'x', ref: 'r' }), 'busy')
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r))
  release()
  const done = await first.then((r) => !!r.url, () => false)
  check('正在投：再点不会开第二个 issue', second && done)
  check('投完：又能投了', !slow.status().busy)
}

// ── 路由：只投这次分享打出来的包 ──
{
  const calls = []
  const github = { status: () => ({ ready: true, login: 'Alice-1', flow: null, busy: false }), start: async () => ({ ready: true, login: '', flow: { code: 'X' } }), cancel: () => calls.push('cancel'), logout: () => calls.push('logout'), submit: async (o) => { calls.push(o); return { url: 'https://github.com/x/y/issues/1', number: 1, login: 'Alice-1', fork: '' } } }
  const routes = createLibraryRoutes({
    admit: () => true, readBody: async (req) => req.body, json: (res, code, obj) => { res.code = code; res.body = obj },
    tracker: { snapshot: () => null, cwdOf: () => '' }, library: { get: () => null, list: () => [] }, inspiration: null, studio: {}, open: () => {}, storeLoad: () => ({}), exported: new Set(), github,
  })
  const st = {}
  await routes.ghauth({ method: 'GET' }, st)
  check('路由：GET ghauth 给状态', st.code === 200 && st.body.login === 'Alice-1')
  const lo = {}
  await routes.ghauth({ method: 'POST', body: { op: 'logout' } }, lo)
  check('路由：断开', lo.code === 200 && calls.includes('logout'))
  const bad = {}
  await routes.ghauth({ method: 'POST', body: { op: 'nope' } }, bad)
  check('路由：不认识的操作拒', bad.code === 400)
  const zf = path.join(tmp, 'a.zip')
  fs.writeFileSync(zf, zip)
  const ns = {}
  await routes.submit({ method: 'POST', body: { path: zf } }, ns)
  check('路由：不是这次分享打出来的包不投（别的文件也读不到）', ns.code === 404 && ns.body.error === 'notShared' && !calls.some((c) => c && c.zip))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
