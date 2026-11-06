/**
 * 设计库第一步「底座」：设计清单排屏、作品库（哪些文件是别人做的）、硬规矩预览（CSP / nonce / 沙盒 / 拦外链）。
 * 有 Chrome / Edge 时用真浏览器打开恶意样例：脚本不跑、不联网、不跳走，体检照常。
 *   node test/test-gallery-strict.mjs
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createHub, injectPicker, strictCsp, defang } from '../lib/serve.js'
import { strictMeta, inlinePicker } from '../lib/bundle.js'
import { listScreens, manifestOrder } from '../lib/core.js'
import { createLibrary, sha256 } from '../lib/works.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host: u.host, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject)
  })
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-strict-'))

// ── 设计清单决定屏的顺序 ──
const d1 = path.join(tmp, 'tpl')
fs.mkdirSync(d1)
for (const f of ['a.html', 'b.html', 'c.html', 'extra.html', '_probe.html']) {
  fs.writeFileSync(path.join(d1, f), `<title>${f}</title>`)
}
check('没有清单：按创建时间', JSON.stringify(listScreens(d1)) === '["a.html","b.html","c.html","extra.html"]', JSON.stringify(listScreens(d1)))
fs.writeFileSync(path.join(d1, 'design.json'), JSON.stringify({ format: 1, screens: [{ file: 'c.html' }, { file: 'a.html' }, { file: 'gone.html' }, { file: '../x.html' }, { file: 'b.html' }] }))
check('有清单：按清单排，清单外的（模型后加的）排在后面', JSON.stringify(listScreens(d1)) === '["c.html","a.html","b.html","extra.html"]', JSON.stringify(listScreens(d1)))
check('清单里跑出目录的名字不认', !manifestOrder(d1).includes('../x.html'))
fs.writeFileSync(path.join(d1, 'design.json'), '{bad json')
check('清单写坏了：当没有', JSON.stringify(listScreens(d1)) === '["a.html","b.html","c.html","extra.html"]')

// ── 作品库 ──
const libDir = path.join(tmp, 'lib')
const lib = createLibrary({ dir: libDir })
const evilHtml = Buffer.from('<!doctype html><title>x · y</title><script>parent.postMessage({pwned:1},"*")</script>')
check('作品库：空的时候什么都不算别人做的', !lib.strictHtml(evilHtml) && !lib.strictRoot(d1))
lib.put(d1, { title: '测试', trust: 'zip', hashes: { 'a.html': sha256(evilHtml) } })
check('作品库：记下的内容算别人做的', lib.strictHtml(evilHtml))
check('作品库：改过一个字就不算', !lib.strictHtml(Buffer.concat([evilHtml, Buffer.from(' ')])))
check('作品库：目录和子目录算别人做的', lib.strictRoot(d1) && lib.strictRoot(path.join(d1, 'assets')) && !lib.strictRoot(tmp))
check('作品库：存在插件自己的目录，不在设计目录', fs.existsSync(path.join(libDir, 'works.json')) && !fs.existsSync(path.join(d1, 'works.json')))
const lib2 = createLibrary({ dir: libDir })
check('作品库：重开还在', lib2.strictHtml(evilHtml) && lib2.get(d1).title === '测试')
lib.put(d1, { pinned: true })
check('作品库：合并改字段，不丢信任记号', lib.get(d1).pinned === true && lib.get(d1).trust === 'zip')
fs.writeFileSync(path.join(libDir, 'works.json'), '{oops')
const lib3 = createLibrary({ dir: libDir, log: () => {} })
check('作品库：文件写坏了不报错、留一份备份', lib3.list().length === 0 && fs.readdirSync(libDir).some((f) => f.startsWith('works.json.bad-')))
lib3.put(d1, { trust: 'market', hashes: { 'a.html': sha256(evilHtml) } })
check('作品库：移出列表只藏起来，信任记号还在（藏起来的照样按别人做的预览）', lib3.hide(d1) && lib3.get(d1).hidden === true && lib3.strictHtml(evilHtml))
lib3.sync({ s1: { target: { kind: 'file', root: d1, file: path.join(d1, 'a.html') }, source: 'tool', at: Date.now() + 1000 } })
check('作品库：藏起来后又做过 → 重新显示', !lib3.get(d1).hidden && lib3.get(d1).trust === 'market')
const d3 = fs.mkdtempSync(path.join(tmp, 'mine-'))
lib3.sync({ s2: { target: { kind: 'file', root: d3, file: path.join(d3, 'x.html') }, design: true, kind: 'app', at: 5 }, s3: { target: { kind: 'file', root: os.homedir(), file: '' }, design: true, at: 6 }, s4: { target: { kind: 'proxy', port: 3000 }, source: 'tool', at: 7 } })
check('作品库：从设计台缓存补回以前的设计（家目录、开发服务器不算）', !!lib3.get(d3) && lib3.get(d3).kind === 'app' && !lib3.get(os.homedir()) && lib3.list().length === 2)

// ── 注入和规矩 ──
const n = 'abc123'
const inj = injectPicker('<!doctype html><head></head><body>x</body>', { nonce: n })
check('nonce：两段注入的脚本都带上', (inj.match(/nonce="abc123"/g) || []).length === 2 && inj.includes('data-strict="1"'))
check('nonce：普通预览不带', !injectPicker('<body></body>').includes('nonce'))
const csp = strictCsp(n)
check('CSP：只准带 nonce 的脚本、不联网、表单交不出去、不能嵌页面', ["script-src 'nonce-abc123'", "default-src 'none'", "connect-src 'self'", "form-action 'none'", "frame-src 'none'", "base-uri 'none'", "img-src 'self' data: blob:"].every((x) => csp.includes(x)), csp)
check('CSP：没有 unsafe-eval / unsafe-inline 脚本', !/script-src[^;]*unsafe/.test(csp))
const df = defang('<meta http-equiv="refresh" content="0;url=https://e.x"><link rel="preconnect" href="https://e.x"><link rel="stylesheet" href="a.css"><a href="b.html" ping="https://e.x">b</a>')
check('拆掉：meta http-equiv、preconnect、ping；样式表留着', /data-dsh-off-http-equiv/.test(df) && /data-dsh-off-rel="preconnect"/.test(df) && /<link rel="stylesheet"/.test(df) && /data-dsh-off-ping/.test(df))
check('远程看：CSP meta + 内联 picker 带 nonce', strictMeta(n).includes("script-src 'nonce-abc123'") && inlinePicker('/*p*/', 'http://x', '', n).startsWith('<script nonce="abc123">') && inlinePicker('/*p*/', 'http://x', '', n).includes('"strict":true'))

// ── 预览服务器 ──
const site = path.join(tmp, 'site')
fs.mkdirSync(site)
const mine = '<!doctype html><title>mine</title><p>mine</p>'
fs.writeFileSync(path.join(site, 'theirs.html'), evilHtml)
fs.writeFileSync(path.join(site, 'mine.html'), mine)
fs.writeFileSync(path.join(site, 'i.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
const strictLib = createLibrary({ dir: path.join(tmp, 'lib-s') })
strictLib.put(site, { trust: 'market', hashes: { 'theirs.html': sha256(evilHtml) } })
const hub = createHub({ strict: { html: (b) => strictLib.strictHtml(b), root: (d) => strictLib.strictRoot(d) }, history: { fileOf: (_r, v, rel) => (rel === 'theirs.html' ? path.join(site, 'theirs.html') : null) } })
const s1 = await hub.open({ kind: 'file', root: site })
let r = await get(s1.origin + '/theirs.html')
const cspH = r.headers['content-security-policy'] || ''
const nonce = (/'nonce-([^']+)'/.exec(cspH) || [])[1]
check('别人做的：带 CSP', !!nonce && cspH.includes("default-src 'none'"), cspH)
check('别人做的：注入的脚本带同一个 nonce，页面自己的脚本不带', r.body.split(`nonce="${nonce}"`).length === 3 && /<script>parent\.postMessage/.test(r.body))
check('别人做的：其他响应头', r.headers['x-content-type-options'] === 'nosniff' && r.headers['referrer-policy'] === 'no-referrer' && /clipboard-read=\(\)/.test(r.headers['permissions-policy'] || ''))
const r2 = await get(s1.origin + '/theirs.html')
check('别人做的：每次 nonce 都换', !r2.headers['content-security-policy'].includes(nonce))
r = await get(s1.origin + '/mine.html')
check('自己的：不加规矩', !r.headers['content-security-policy'] && !r.body.includes('nonce'))
r = await get(s1.origin + '/i.svg')
check('别人的目录里的 SVG：当页面打开也不准跑脚本', /default-src 'none'/.test(r.headers['content-security-policy'] || ''))
r = await get(s1.origin + '/__dsh_design__/v/3/theirs.html')
check('旧版本里没改过的别人的页面：一样加规矩', /nonce-/.test(r.headers['content-security-policy'] || ''))
fs.appendFileSync(path.join(site, 'theirs.html'), '<!-- 模型改过 -->')
r = await get(s1.origin + '/theirs.html')
check('模型改过之后：恢复普通预览', !r.headers['content-security-policy'])
fs.writeFileSync(path.join(site, 'theirs.html'), evilHtml)
// 装好的别人的设计系统：旧版本里的页面（哈希早就不认得了）也一律加规矩；普通目录的旧版本照常
{
  const sys = path.join(tmp, 'sys-v')
  fs.mkdirSync(sys)
  fs.writeFileSync(path.join(sys, 'components.html'), mine)
  const old = path.join(tmp, 'old-v1.html')
  fs.writeFileSync(old, '<!doctype html><title>v1</title><p>很早以前的一版</p>')
  const sl = createLibrary({ dir: path.join(tmp, 'lib-sv') })
  sl.put(sys, { kind: 'system', trust: 'market', hashes: {} })
  const hv = createHub({ strict: { html: (b) => sl.strictHtml(b), root: (d) => sl.strictRoot(d), versions: (d) => sl.strictVersions(d) }, history: { fileOf: () => old } })
  const sv = await hv.open({ kind: 'file', root: sys })
  let rv = await get(sv.origin + '/__dsh_design__/v/2/components.html')
  check('装好的设计系统：旧版本页面一律加规矩', /nonce-/.test(rv.headers['content-security-policy'] || ''), JSON.stringify(rv.headers))
  rv = await get(sv.origin + '/components.html')
  check('装好的设计系统：现在这版改过的页面照常（不靠旧版规则）', !rv.headers['content-security-policy'])
  const sv2 = await hv.open({ kind: 'file', root: site })
  rv = await get(sv2.origin + '/__dsh_design__/v/2/x.html')
  check('普通目录的旧版本：不加规矩', !rv.headers['content-security-policy'])
  await hv.closeAll?.()
}
const hubBad = createHub({ log: () => {}, strict: { html: () => { throw new Error('boom') } } })
const s2 = await hubBad.open({ kind: 'file', root: site })
r = await get(s2.origin + '/mine.html')
check('判断出错时宁可加规矩', /nonce-/.test(r.headers['content-security-policy'] || ''))
hubBad.closeAll()

// ── 真浏览器：恶意样例 ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  // 「坏人的服务器」：数一数被访问了几次
  const hits = []
  const evil = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('x') })
  await new Promise((rs) => evil.listen(0, '127.0.0.1', rs))
  const E = `http://127.0.0.1:${evil.address().port}`
  const bad = path.join(tmp, 'bad')
  fs.mkdirSync(bad)
  fs.writeFileSync(path.join(bad, 'ok.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="dsh-design" content="app"><title>坏 · 样例</title>
<link rel="stylesheet" href="${E}/css"><link rel="prefetch" href="${E}/prefetch"><link rel="preconnect" href="${E}">
<style>@import url(${E}/import); body{margin:0;font:16px sans-serif} .bg{height:20px;background:url(${E}/bg)} @font-face{font-family:Z;src:url(${E}/font)} .z{font-family:Z}</style>
<script>parent.postMessage({ pwned: 'inline' }, '*'); fetch('${E}/fetch')</script>
<base href="${E}/base/">
</head><body>
<img src="ok.png" onerror="parent.postMessage({pwned:'onerror'},'*')"><img src="nope.png" onerror="parent.postMessage({pwned:'onerror'},'*')">
<img src="${E}/img"><div class="bg"></div><p class="z">字</p>
<iframe src="${E}/iframe"></iframe><object data="${E}/object"></object>
<a id="out" href="${E}/click">外链</a> <a id="dl" href="ok.png" download>下载</a> <a id="ping" href="#x" ping="${E}/ping">ping</a>
<form id="f" action="${E}/form" method="post"><input name="q" value="1"><button id="go">提交</button></form>
<p style="font-size:9px;color:#eee">对比度不够的小字</p>
</body></html>`
  fs.writeFileSync(path.join(bad, 'bad.html'), page)
  fs.writeFileSync(path.join(bad, 'refresh.html'), `<!doctype html><meta http-equiv="refresh" content="0;url=${E}/refresh"><title>r · s</title><p>r</p>`)
  const badLib = createLibrary({ dir: path.join(tmp, 'lib-b') })
  badLib.put(bad, { trust: 'zip', hashes: { 'bad.html': sha256(Buffer.from(page)), 'refresh.html': sha256(fs.readFileSync(path.join(bad, 'refresh.html'))) } })
  const hb = createHub({ strict: { html: (b) => badLib.strictHtml(b), root: (d) => badLib.strictRoot(d) } })
  const ctl = path.join(tmp, 'ctl')
  fs.mkdirSync(ctl)
  fs.writeFileSync(path.join(ctl, 'bad.html'), page + ' ') // 对照：差一个空格的页面（内容不一样 = 当自己的），脚本会跑
  let preview = ''
  const outer = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams
    const sb = q.get('sandbox') === '1' ? ' sandbox="allow-scripts allow-same-origin"' : ''
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><iframe id="f"${sb} src="${q.get('src')}" width="390" height="844"></iframe><script>
      window.got = []; window.pwned = []; window.blocked = []
      addEventListener('message', (e) => {
        const d = e.data || {}
        if (d.pwned) window.pwned.push(d.pwned)
        if (d.dshDesign !== 1) return
        window.got.push(d.type)
        if (d.type === 'hello') e.source.postMessage({ dshDesign: 1, type: 'init', relay: true }, '*')
        if (d.type === 'ready') e.source.postMessage({ dshDesign: 1, type: 'reveal' }, '*')
        if (d.type === 'blocked') window.blocked.push(d.href)
        if (d.type === 'checked') window.checked = d
      })
      window.runCheck = () => document.getElementById('f').contentWindow.postMessage({ dshDesign: 1, type: 'check', id: 'c1', kind: 'app', quiet: true }, '*')
    </script>`)
  })
  await new Promise((rs) => outer.listen(0, '127.0.0.1', rs))
  const O = `http://127.0.0.1:${outer.address().port}`
  const hp = createHub({ parents: () => [O], strict: { html: (b) => badLib.strictHtml(b), root: (d) => badLib.strictRoot(d) } })
  const sb = await hp.open({ kind: 'file', root: bad })
  const sc = await hp.open({ kind: 'file', root: ctl })
  preview = sb.origin
  const b = createBrowser({ bin })
  try {
    // 对照：自己的页面（不加规矩）脚本会跑 —— 证明这个测试真能看出脚本跑没跑
    const control = await b.withPage({ url: `${O}/?src=${encodeURIComponent(sc.origin + '/bad.html')}`, w: 500, h: 900 }, async (pg) => {
      await wait(1500)
      return pg.eval('window.pwned')
    })
    check('对照：当自己的页面打开，脚本会跑', control.includes('inline'), JSON.stringify(control))
    hits.length = 0
    const res = await b.withPage({ url: `${O}/?sandbox=1&src=${encodeURIComponent(sb.origin + '/bad.html')}`, w: 500, h: 900 }, async (pg) => {
      for (let i = 0; i < 40 && !(await pg.eval('window.got.includes("ready")')); i++) await wait(150)
      await wait(800)
      // 在页面里点外链、点下载、点 ping、提交表单（同源 iframe 才能伸手进去点：用 CDP 点坐标太绕，这里用页面里的 picker 拿不到，就靠外层发 click）
      const inner = await pg.eval(`(() => {
        const f = document.getElementById('f')
        try { const d = f.contentDocument; return d ? 'same' : 'cross' } catch { return 'cross' }
      })()`)
      return { inner, pwned: await pg.eval('window.pwned'), got: await pg.eval('window.got') }
    })
    check('别人做的：内联脚本、onerror 都没跑', res.pwned.length === 0, JSON.stringify(res.pwned))
    check('别人做的：picker 照常装上（nonce 放行）', res.got.includes('hello') && res.got.includes('ready'), JSON.stringify(res.got))
    check('别人做的：样式、图片、字体、@import、iframe、object、预取都没连外网', hits.length === 0, JSON.stringify(hits))
    // 体检照常工作
    const chk = await b.withPage({ url: `${O}/?sandbox=1&src=${encodeURIComponent(sb.origin + '/bad.html')}`, w: 500, h: 900 }, async (pg) => {
      for (let i = 0; i < 40 && !(await pg.eval('window.got.includes("ready")')); i++) await wait(150)
      await pg.eval('window.runCheck()')
      for (let i = 0; i < 60 && !(await pg.eval('!!window.checked')); i++) await wait(150)
      return pg.eval('window.checked')
    })
    check('别人做的：体检照常工作（量出了对比度问题）', chk && Array.isArray(chk.issues) && chk.issues.some((x) => x.type === 'contrast' || x.type === 'tiny'), JSON.stringify(chk && (chk.issues || chk.error)).slice(0, 300))
    // 直接开预览地址（不在 iframe 里）点外链 / 提交表单 / 自动跳转：页面不能离开
    hits.length = 0
    const nav = await b.withPage({ url: sb.origin + '/bad.html', w: 500, h: 900 }, async (pg) => {
      await wait(600)
      await pg.eval(`document.getElementById('out').click()`)
      await wait(400)
      const after1 = await pg.eval('location.href')
      await pg.eval(`document.getElementById('go').click()`)
      await wait(400)
      const after2 = await pg.eval('location.href')
      await pg.eval(`document.getElementById('ping').click()`)
      await wait(400)
      return { after1, after2, pwned: await pg.eval('typeof window.__dshErrs') }
    })
    check('别人做的：点站外链接不跳走', nav.after1.endsWith('/bad.html'), nav.after1)
    check('别人做的：提交表单交不出去', nav.after2.startsWith(sb.origin), nav.after2)
    check('别人做的：链接的 ping 没发出去、表单没到坏人服务器', !hits.some((h) => /ping|form|click/.test(h)), JSON.stringify(hits))
    const rf = await b.withPage({ url: sb.origin + '/refresh.html', w: 400, h: 400 }, async (pg) => { await wait(1500); return pg.eval('location.href') })
    check('别人做的：<meta http-equiv="refresh"> 不跳', rf.endsWith('/refresh.html'), rf)
  } finally {
    b.stop()
    hp.closeAll()
    hb.closeAll()
    outer.close()
    evil.close()
  }
}

hub.closeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
