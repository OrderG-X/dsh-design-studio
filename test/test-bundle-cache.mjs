/**
 * 远程看的打包缓存（不用开 DSH）：
 *   node test/test-bundle-cache.mjs
 *
 * 一屏打包好、文件没改过 → 直接复用上次那份并带上 ETag；带 If-None-Match 回来 → 304，body 一个字节都不传；
 * 改了这一屏用到的文件 → 重新打包；改目录里别的文件 → 仍然 304；坏 key / 缺屏照旧报错。
 * 另外管两种「印记看不出来」的情况：fresh=1 必须真的重取；刚写过的文件不进缓存。
 * ETag 按内容算（浏览器手上的旧内容不会被 304 认成新的）；目录监听报了改动就作废；打包时文件被删不进缓存；
 * picker 换了不用旧包；文件没动但信任变了（要加硬规矩）不用旧包。
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

// 审计到的「刚写过就不进缓存」是按 mtime 算的（2 秒内）：夹具先把时间调旧，否则第一次打包都不进缓存
const OLD = new Date(Date.now() - 30000)
const writeOld = (name, text) => {
  const f = path.join(design, name)
  fs.writeFileSync(f, text)
  fs.utimesSync(f, OLD, OLD)
  return f
}
writeOld('tokens.css', ':root{--brand:#c8763e}\n')
writeOld('app.css', 'body{margin:0}\n')
writeOld('a.html', '<!doctype html><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="app.css"><h1>A</h1><a href="b.html">go</a>')
writeOld('b.html', '<!doctype html><link rel="stylesheet" href="tokens.css"><h1>B</h1><a href="a.html">back</a>')

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
const htmlOf = (r) => { try { return JSON.parse(r.body).html || '' } catch { return '' } }

await tracker.setTarget('t', { kind: 'file', file: path.join(design, 'a.html'), root: design }, { source: 'user', popup: false })

const first = await call(url('a.html'))
const payload = first.status === 200 ? JSON.parse(first.body) : {}
check('第一次打包：200 + ETag', first.status === 200 && /^W\/"[0-9a-f]+"$/.test(String(first.headers.ETag)), `${first.status} ${first.headers.ETag}`)
check('缓存头允许条件请求（不再是 no-store）', first.headers['Cache-Control'] === 'private, max-age=0, must-revalidate', String(first.headers['Cache-Control']))
check('回包带着打的是哪个目标（目录、预览地址），右侧栏拿它核对', payload.root === design && /^http:\/\/127\.0\.0\.1:\d+$/.test(payload.origin || ''), `${payload.root} ${payload.origin}`)
check('回的是这一屏的整页 HTML 和依赖清单', typeof payload.html === 'string' && payload.html.length > 0 && Array.isArray(payload.deps)
  && payload.deps.includes('tokens.css') && payload.deps.includes('app.css'), JSON.stringify(payload.deps))

const again = await call(url('a.html'))
check('同一屏再要一次：直接复用上次那份（同内容）', again.status === 200 && sha(again.body) === sha(first.body) && again.headers.ETag === first.headers.ETag)

const revalidated = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('带 If-None-Match：304 且不传 body', revalidated.status === 304 && revalidated.body === '', `${revalidated.status} ${revalidated.body.length}`)
const stale = await call(url('a.html'), { 'if-none-match': 'W/"something-else"' })
check('ETag 对不上：照常 200 给内容', stale.status === 200 && htmlOf(stale).length > 0)

writeOld('notes.txt', 'x')
const unrelated = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('目录里改了用不到的文件：仍然 304', unrelated.status === 304, String(unrelated.status))
fs.rmSync(path.join(design, 'notes.txt'))

// 改这一屏用到的 CSS，刚写完 → 重新打包，但不进缓存（响应没有 ETag）
const tokensFile = path.join(design, 'tokens.css')
fs.writeFileSync(tokensFile, ':root{--brand:#1f6feb}\n')
const justWritten = await call(url('a.html'), { 'if-none-match': first.headers.ETag })
check('刚改过的依赖：重新打包且这次不进缓存（没有 ETag）', justWritten.status === 200 && !justWritten.headers.ETag, `${justWritten.status} ${justWritten.headers.ETag}`)
check('新内容确实进去了', htmlOf(justWritten).includes('#1f6feb') || htmlOf(justWritten).includes('#1F6FEB'))
// 时间调旧（模拟「已经稳定下来」）→ 又能进缓存，且内容还是新的
fs.utimesSync(tokensFile, OLD, OLD)
const settled = await call(url('a.html'))
check('文件稳定下来后重新进缓存（有 ETag，内容仍是新的）', settled.status === 200 && !!settled.headers.ETag
  && (htmlOf(settled).includes('#1f6feb') || htmlOf(settled).includes('#1F6FEB')))

// 同 mtime 同大小改写（粗精度盘上的真实情形）：不带 fresh 会一直给旧的那份，带 fresh 必须换出来
const before = fs.readFileSync(tokensFile)
const st = fs.statSync(tokensFile)
fs.writeFileSync(tokensFile, before.toString('utf8').replace('#1f6feb', '#c8763e'))
fs.utimesSync(tokensFile, st.atime, st.mtime)                      // 把 mtime 原样按回去，印记不变
const sameStamp = fs.statSync(tokensFile)
check('夹具确实构造出「内容变了、印记没变」', sameStamp.size === st.size && Math.round(sameStamp.mtimeMs) === Math.round(st.mtimeMs))
const blind = await call(url('a.html'), { 'if-none-match': settled.headers.ETag })
check('印记没变时，普通请求还以为是最新的（这正是要 fresh 的原因）', blind.status === 304, String(blind.status))
const forced = await call(url('a.html', '&fresh=1'), { 'if-none-match': settled.headers.ETag })
check('fresh=1：跳过缓存、重新打包，换出新内容', forced.status === 200
  && (htmlOf(forced).includes('#c8763e') || htmlOf(forced).includes('#C8763E')), String(forced.status))
const afterFresh = await call(url('a.html'), { 'if-none-match': forced.headers.ETag })
check('fresh 那次把缓存更新了：下一次普通请求就是新内容', afterFresh.status === 304, String(afterFresh.status))
const afterFreshBody = await call(url('a.html'))
check('缓存里确实是新内容', htmlOf(afterFreshBody).includes('#c8763e') || htmlOf(afterFreshBody).includes('#C8763E'))

check('fresh 换出了新内容，ETag 也跟着换了（按内容算）', !!forced.headers.ETag && forced.headers.ETag !== settled.headers.ETag, `${settled.headers.ETag} → ${forced.headers.ETag}`)
// 浏览器普通地址下还存着旧内容（fresh 是另一个地址，它那份没被换掉），带旧 ETag 来问：不能 304
const oldTag = await call(url('a.html'), { 'if-none-match': settled.headers.ETag })
check('带旧内容的 ETag 来问：给 200 和新内容，不会 304 让浏览器接着用旧的', oldTag.status === 200
  && (htmlOf(oldTag).includes('#c8763e') || htmlOf(oldTag).includes('#C8763E')), String(oldTag.status))

// 印记看不出来的改动、也没人点刷新：等目录监听报上来，缓存跟着作废，普通请求就是新内容
const lastN = () => { const c = tracker.stateOf('t').changes || []; return c.length ? c[c.length - 1].n : 0 }
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)) } return fn() }
await new Promise((r) => setTimeout(r, 400)) // 前面几次写的监听先报完
const n0 = lastN()
const st2 = fs.statSync(tokensFile)
fs.writeFileSync(tokensFile, fs.readFileSync(tokensFile, 'utf8').replace(/#c8763e/i, '#2d9b5a'))
fs.utimesSync(tokensFile, st2.atime, st2.mtime) // 印记照样不变
check('目录监听报了这次改动', await until(() => lastN() > n0, 5000), `changeN ${n0} → ${lastN()}`)
const watched = await call(url('a.html'), { 'if-none-match': afterFresh.headers.ETag || forced.headers.ETag })
check('监听报了改动：缓存作废，普通请求拿到新内容', watched.status === 200 && /#2d9b5a/i.test(htmlOf(watched)), String(watched.status))

// 打包这段时间里，读过的文件被删了（读完 tokens.css、还在读 app.css 时）：这一份不能进缓存
await new Promise((r) => setTimeout(r, 400))
const realRead = fs.readFileSync
const realStat = fs.statSync
let armed = true
fs.readFileSync = function (f, ...rest) {
  const out = realRead.call(this, f, ...rest)
  if (armed && typeof f === 'string' && f.endsWith(`${path.sep}app.css`)) { armed = false; fs.renameSync(tokensFile, tokensFile + '.gone') }
  return out
}
let racedDel
try { racedDel = await call(url('a.html', '&fresh=1')) } finally { fs.readFileSync = realRead }
check('夹具确实在打包中途删了文件', !armed && !fs.existsSync(tokensFile))
check('打包中途删了用到的文件：照常给内容，但不进缓存（没有 ETag）', racedDel.status === 200 && !racedDel.headers.ETag, `${racedDel.status} ${racedDel.headers.ETag}`)
fs.renameSync(tokensFile + '.gone', tokensFile)

const other = await call(url('b.html'))
const otherAgain = await call(url('b.html'), { 'if-none-match': other.headers.ETag })
check('另一屏单独缓存：自己的 ETag、自己 304', other.status === 200 && other.headers.ETag !== first.headers.ETag && otherAgain.status === 304)

const badKey = await call(url('../etc/passwd.html'))
check('越界的 key：400', badKey.status === 400, String(badKey.status))
const missing = await call(url('nope.html'))
check('没有这一屏：404', missing.status === 404, String(missing.status))

// picker 换了（升级了插件、运行中替换了文件）：不能再给内联着旧 picker 的那份
await new Promise((r) => setTimeout(r, 400)) // 前面挪回 tokens.css 的监听先报完，别在两次请求之间清掉缓存
let pickerReads = 0
fs.readFileSync = function (f, ...rest) {
  if (typeof f === 'string' && f.endsWith(`${path.sep}picker.js`)) pickerReads++
  return realRead.call(this, f, ...rest)
}
try {
  await call(url('b.html'))
  pickerReads = 0
  await call(url('b.html'))
  check('picker 没换：直接用留着的包（没重新打包）', pickerReads === 0, String(pickerReads))
  fs.statSync = function (f, ...rest) {
    const s = realStat.call(this, f, ...rest)
    return typeof f === 'string' && f.endsWith(`${path.sep}picker.js`) ? { ...s, size: s.size + 1, isFile: () => true } : s
  }
  const swapped = await call(url('b.html'))
  check('picker 换了：不用留着的包，重新打包', pickerReads === 1 && swapped.status === 200, `${pickerReads} ${swapped.status}`)
} finally {
  fs.readFileSync = realRead
  fs.statSync = realStat
}

// 文件没动、信任变了：这套是装好的别人的设计系统，退回一版和现在一模一样的旧版——文件一个都没写，
// 但退回来的页面从此按别人做的预览（要加硬规矩）。不能再给缓存里那份没加规矩的
const ver = tracker.keepVersion('t', '测试')
const { LIBRARY_DIR } = await import('../lib/works.js')
const libFile = path.join(LIBRARY_DIR, 'works.json')
let lib = { format: 1, works: [] }
try { lib = JSON.parse(fs.readFileSync(libFile, 'utf8')) } catch { /* 还没有 */ }
// 「我的作品」里已经记着这个目录（自己做的）：换成「装好的别人的设计系统」（/var → /private/var 这种按真实路径比）
const realDesign = fs.realpathSync(design)
lib.works = lib.works.filter((w) => { try { return fs.realpathSync(w.dir) !== realDesign } catch { return true } })
lib.works.push({ dir: realDesign, trust: 'zip', kind: 'system', hashes: { 'other.html': 'f'.repeat(64) } })
fs.mkdirSync(LIBRARY_DIR, { recursive: true })
fs.writeFileSync(libFile, JSON.stringify(lib))
const warm = await call(url('b.html'))
let warmBody = {}
try { warmBody = JSON.parse(warm.body) } catch { /* 下面报 */ }
check('夹具：退回之前这一屏不加规矩、进了缓存', warm.status === 200 && warmBody.strict === false && !!warm.headers.ETag, `${warm.status} ${warmBody.strict} ${warm.headers.ETag}`)
const bBefore = fs.statSync(path.join(design, 'b.html'))
const trustBefore = tracker.snapshot('t').trust
tracker.restoreVersion('t', ver && ver.n)
await tracker.setTarget('t2', { kind: 'file', file: path.join(design, 'b.html'), root: design }, { source: 'user', popup: false })
const trustAfter = tracker.snapshot('t').trust
check('信任指纹跟着变了，别的会话看到的也是新的（远程看的右侧栏按它作废留着的包）', !!trustBefore && !!trustAfter && trustAfter !== trustBefore && tracker.snapshot('t2').trust === trustAfter, `${trustBefore} → ${trustAfter} / ${tracker.snapshot('t2').trust}`)
const bAfter = fs.statSync(path.join(design, 'b.html'))
check('夹具：退回时文件一个都没写（印记不变）', bBefore.mtimeMs === bAfter.mtimeMs && bBefore.ino === bAfter.ino)
const nowStrict = await call(url('b.html'), { 'if-none-match': warm.headers.ETag })
let strictBody = {}
try { strictBody = JSON.parse(nowStrict.body) } catch { /* 下面报 */ }
check('信任变了、文件没动：重新打包成加规矩的那份，不回 304', nowStrict.status === 200 && strictBody.strict === true, `${nowStrict.status} strict=${strictBody.strict}`)

for (const d of disposers) { try { d() } catch { /* 关预览服务器 */ } }
try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* 临时目录，删不掉也无所谓 */ }
try { fs.rmSync(design, { recursive: true, force: true }) } catch { /* 同上 */ }

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
