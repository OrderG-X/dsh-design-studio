/**
 * 接口准入：谁能调 /dsh-design-studio/api/*
 *   node test/test-admission.mjs
 *
 * 三种来源要分开对待：
 *   1. 新版 DSH（WebServer 准入，默认 auth: 'required'）—— handler 拿到已验过登录与来源的 Peer，直接放行；
 *      这条路径是「局域网 IP / 域名反代打开 DSH」能用的前提（否则右侧栏轮询全 403，用户看到「连不上预览」）。
 *   2. 老版本 DSH —— connection 服务还有 requestRejection，照旧交给它判断。
 *   3. 都没有 —— 只认本机，跨站一律拒（兜底不放松）。
 *
 * 不起 DSH：假 ctx + 直接调注册进去的 handler。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

// 插件把「每个会话预览什么」写在 ~/.dsh 下（STORE_FILE 在模块加载时算），先挪开，别碰真实目录
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-admit-home-'))
process.env.HOME = home
process.env.USERPROFILE = home

const routes = new Map()
const disposers = []
/** 老版本 DSH 的 connection：设成 null 表示新版（没有 requestRejection） */
let legacy = null
const ctx = {
  logger: { warn() {} },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  get(k) { return k === 'connection' ? legacy : null },
  on() {},
  webServer: {
    // 从局域网 IP 访问时的样子（不是 loopback）
    getOrigin: () => 'http://192.168.168.226:3080',
    register: (r) => { routes.set(r.path.replace('/dsh-design-studio/api/', ''), r.handler); return () => {} },
  },
}

const { apply } = await import('../lib/index.js')
apply(ctx)
const state = routes.get('state')
if (!state) {
  console.log('✗ 插件没起来（没有 state 路由）')
  process.exit(1)
}

/** 发一次请求；peer 有值就是新版 DSH 准入过的样子 */
function call({ remoteAddress = '192.168.168.226', host = '192.168.168.226:3080', headers = {}, peer } = {}) {
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writeHead(code, h) { this.status = code; this.headers = h || {}; this.headersSent = true },
      setHeader() {}, getHeader() {},
      end(b) { resolve({ status: this.status, headers: this.headers, body: b ? String(b) : '' }) },
    }
    const req = { url: '/dsh-design-studio/api/state?session=t', method: 'GET', headers: { host, ...headers }, socket: { remoteAddress } }
    Promise.resolve(state(req, res, peer)).catch((e) => resolve({ status: 0, headers: {}, body: '', error: e.message }))
  })
}
const okJson = (r) => r.status === 200 && (() => { try { return typeof JSON.parse(r.body) === 'object' } catch { return false } })()

// ── 兜底：没有 Peer、也不是本机来源 → 照旧拒绝（修复不能把这条路放开）──
const lanNoPeer = await call()
check('局域网来源、没有 Peer：仍然 403（兜底不放松）', lanNoPeer.status === 403 && JSON.parse(lanNoPeer.body).error === 'forbidden', `${lanNoPeer.status} ${lanNoPeer.body}`)

const cross = await call({ headers: { 'sec-fetch-site': 'cross-site' } })
check('跨站、没有 Peer：403', cross.status === 403, String(cross.status))

const loop = await call({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3080' })
check('本机来源、没有 Peer：照旧放行（老行为不变）', okJson(loop), `${loop.status} ${loop.body.slice(0, 80)}`)

// ── 新版 DSH：handler 收到准入 Peer → 放行（这一条就是局域网 / 反代能用的关键）──
const lanPeer = await call({ peer: { id: 'peer-1', principal: { kind: 'owner' } } })
check('局域网来源、有准入 Peer：放行（修复点）', okJson(lanPeer), `${lanPeer.status} ${lanPeer.body.slice(0, 80)}`)

const crossPeer = await call({ headers: { 'sec-fetch-site': 'cross-site' }, peer: { id: 'peer-1', principal: { kind: 'owner' } } })
check('有准入 Peer 时不再按本机的规矩拦（来源已由 DSH 验过）', okJson(crossPeer), `${crossPeer.status} ${crossPeer.body.slice(0, 80)}`)

const proxyPeer = await call({ remoteAddress: '172.25.0.2', host: 'chat.example.com', peer: { id: 'peer-2', principal: { kind: 'owner' } } })
check('反代来源、有准入 Peer：放行', okJson(proxyPeer), `${proxyPeer.status} ${proxyPeer.body.slice(0, 80)}`)

// ── 准入了、但不是主人（以后 DSH 的访客之类）：设计台不让进，连本机来源也一样 ──
const guest = await call({ peer: { id: 'peer-4', principal: { kind: 'guest' } } })
check('有 Peer 但不是主人：403', guest.status === 403, `${guest.status} ${guest.body.slice(0, 80)}`)
const guestLoop = await call({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3080', peer: { id: 'peer-5', principal: { kind: 'guest' } } })
check('不是主人、从本机来：也 403（不退回本机兜底）', guestLoop.status === 403, `${guestLoop.status}`)
const bare = await call({ peer: { id: 'peer-6' } })
check('Peer 没写身份：403', bare.status === 403, `${bare.status}`)

// ── 老版本 DSH：connection.requestRejection 还在，照旧听它的 ──
let seen = 0
legacy = { requestRejection: () => { seen++; return 0 }, trustedHosts: [] }
const legacyAllow = await call()
check('老版本 DSH：requestRejection 放行 → 200', okJson(legacyAllow) && seen === 1, `${legacyAllow.status} seen=${seen}`)

let rejected = 0
legacy = { requestRejection: () => { rejected++; return 403 }, trustedHosts: [] }
const legacyDeny = await call()
check('老版本 DSH：requestRejection 拒绝 → 403', legacyDeny.status === 403 && rejected === 1, `${legacyDeny.status} rejected=${rejected}`)

let called = 0
legacy = { requestRejection: () => { called++; return 0 }, trustedHosts: [] }
const peerWins = await call({ peer: { id: 'peer-3', principal: { kind: 'owner' } } })
check('有准入 Peer 时不再走老 connection 那套', okJson(peerWins) && called === 0, `${peerWins.status} called=${called}`)

for (const d of disposers) { try { d() } catch { /* 收尾 */ } }
fs.rmSync(home, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
