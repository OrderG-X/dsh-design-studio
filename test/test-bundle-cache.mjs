/**
 * 远程看的打包缓存（不用开 DSH）：
 *   node test/test-bundle-cache.mjs
 *
 * 一屏打包好、文件没改过 → 直接复用上次那份并带上 ETag；带 If-None-Match 回来 → 304，body 一个字节都不传；
 * 改了这一屏用到的文件 → 换 ETag 重新打包；改目录里别的文件 → 仍然 304；坏 key / 缺屏照旧报错。
 * 目录里没改过的东西全在临时目录里（HOME 也指过去），不碰真实的 ~/.dsh 和设计目录。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-cache-home-'))
const design = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-cache-design-'))
// 插件把「每个会话预览什么」写在 ~/.dsh 下：先挪开，别碰真实目录（STORE_FILE 在模块加载时算出来）
// Windows 上 os.homedir() 认的是 USERPROFILE，两个都指过去
process.env.HOME = home
process.env.USERPROFILE = home

const store = path.join(home, '.dsh', 'cache', 'dsh-design-studio.json')
fs.writeFileSync(path.join(design, 'tokens.css'), ':root{--brand:#c8763e}\n')
fs.writeFileSync(path.join(design, 'app.css'), 'body{margin:0}\n')
fs.writeFileSync(path.join(design, 'a.html'), '<!doctype html><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="app.css"><h1>A</h1><a href="b.html">go</a>')
fs.writeFileSync(path.join(design, 'b.html'), '<!doctype html><link rel="stylesheet" href="tokens.css"><h1>B</h1><a href="a.html">back</a>')

const routes = new Map()
const disposers = []
const ctx = {
  logger: { warn() {} },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  get() { return null },
  on() {},
  webServer: {
    getOrigin: () => 'http://127.0.0.1:3080',
    register: (r) => { routes.set(r.path.replace('/dsh-design-studio/api/', ''), r.handler); return () => {} },
  },
}

const { apply, studio } = await import('../lib/index.js')
apply(ctx)
const tracker = studio.tracker

if (!tracker || !routes.get('bundle')) {
  console.log('✗ 插件没起来（没有 tracker 或 bundle 路由）')
  process.exit(1)
}

function call(url, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writeHead(code, h) { this.status = code; this.headers = h || {}; this.headersSent = true },
      setHeader() {}, getHeader() {},
      end(b) { resolve({ status: this.status, headers: this.headers, body: b ? String(b) : '' }) },
    }
    const req = { url, method: 'GET', headers: { host: '127.0.0.1:3080', ...headers }, socket: { remoteAddress: '127.0.0.1' } }
    Promise.resolve(routes.get('bundle')(req, res)).catch((e) => resolve({ status: 0, headers: {}, body: '', error: e.message }))
  })
}

const url = (key, extra = '') => `http://127.0.0.1:3080/dsh-design-studio/api/bundle?session=t&key=${encodeURIComponent(key)}&v=0${extra}`
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)

await tracker.setTarget('t', { kind: 'file', file: path.join(design, 'a.html'), root: design }, { source: 'user', popup: false })

const first = await call(url('a.html'))
const payload = first.status === 200 ? JSON.parse(first.body) : {}
check('第一次打包：200 + ETag', first.status === 200 && /^W\/"[0-9a-f]+"$/.test(String(first.headers.ETag)), `${first.status} ${first.headers.ETag}`)
check('缓存头允许条件请求（不再是 no-store）', first.headers['Cache-Control'] === 'private, max-age=0, must-revalidate', String(first.headers['Cache-Control']))
check('回的是这一屏的整页 HTML 和依赖清单', typeof payload.html === 'string' && payload.html.length > 0 && Array.isArray(payload.deps)
  && payload.deps.includes('tokens.css') && payload.deps.includes('app.css'), JSON.stringify(payload.deps))

const again = await call(url('a.html'))
check('同一屏再要一次：直接复用上次那份（同内容）', again.status === 200 && sha(again.body) === sha(first.body) && again.headers.ETag === first.headers.ETag)

const revalidated = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('带 If-None-Match：304 且不传 body', revalidated.status === 304 && revalidated.body === '', `${revalidated.status} ${revalidated.body.length}`)
const stale = await call(url('a.html'), { 'if-none-match': 'W/"something-else"' })
check('ETag 对不上：照常 200 给内容', stale.status === 200 && JSON.parse(stale.body).html.length > 0)

fs.writeFileSync(path.join(design, 'notes.txt'), 'x')
const unrelated = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('目录里改了用不到的文件：仍然 304', unrelated.status === 304, String(unrelated.status))
fs.rmSync(path.join(design, 'notes.txt'))

const before = fs.readFileSync(path.join(design, 'tokens.css'))
fs.writeFileSync(path.join(design, 'tokens.css'), ':root{--brand:#1f6feb}\n')
const depChanged = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('改了这一屏用到的 CSS：换 ETag 重新打包', depChanged.status === 200 && depChanged.headers.ETag !== first.headers.ETag)
check('新内容确实进去了', depChanged.body.includes('#1f6feb') || depChanged.body.includes('#1F6FEB'))
fs.writeFileSync(path.join(design, 'tokens.css'), before)

const restored = await call(url('a.html'))
check('改回去：内容与最初一致', restored.status === 200 && sha(JSON.parse(restored.body).html) === sha(payload.html))

const other = await call(url('b.html'))
const otherAgain = await call(url('b.html'), { 'if-none-match': other.headers.ETag })
check('另一屏单独缓存：自己的 ETag、自己 304', other.status === 200 && other.headers.ETag !== first.headers.ETag && otherAgain.status === 304)

const badKey = await call(url('../etc/passwd.html'))
check('越界的 key：400', badKey.status === 400, String(badKey.status))
const missing = await call(url('nope.html'))
check('没有这一屏：404', missing.status === 404, String(missing.status))

for (const d of disposers) { try { d() } catch { /* 关预览服务器 */ } }
try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* 临时目录，删不掉也无所谓 */ }
try { fs.rmSync(design, { recursive: true, force: true }) } catch { /* 同上 */ }
try { if (fs.existsSync(store)) fs.rmSync(store) } catch { /* 已经随 home 删掉 */ }

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
