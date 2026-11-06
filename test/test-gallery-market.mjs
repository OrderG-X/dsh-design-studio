/**
 * 设计库第四步「逛市场」：从（假的）npm 镜像取目录、验签名、防回滚、下架名单只增不减、批次包逐个文件核对、
 * 只跟白名单主机跳转、断网用缓存、「用这个开始」和装设计系统
 *   node test/test-gallery-market.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createMarket, verifyCatalog, vcmp, race, MarketError, STALE_MS, RETRY_MS } from '../lib/gallery/market.js'
import { createMarketRoutes, installSystem, recordSystem } from '../lib/gallery/market-routes.js'
import { packDesign } from '../lib/gallery/pack.js'
import { checkPack } from '../lib/gallery/policy.js'
import { createLibrary, PAST_MAX } from '../lib/works.js'
import { createHistory } from '../lib/history.js'
import { listScreens } from '../lib/core.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-market-')))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

// ── tar.gz（npm 包的样子）──
function header(name, size, type = '0') {
  const h = Buffer.alloc(512)
  h.write(name, 0, 'utf8')
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124)
  h.write('00000000000\0', 136); h.write('        ', 148); h.write(type, 156)
  h.write('ustar\0', 257); h.write('00', 263)
  let s = 0
  for (const b of h) s += b
  h.write(s.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}
function tgz(files) {
  const parts = []
  for (const [name, data] of Object.entries(files)) {
    const b = Buffer.from(data)
    parts.push(header('package/' + name, b.length), b, Buffer.alloc((512 - (b.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(parts))
}
const integrity = (b) => 'sha512-' + crypto.createHash('sha512').update(b).digest('base64')

// ── 一套真能过检查的模板（和第二步一样用打包器做）──
const page = (screen, body) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="dsh-design" content="app"><title>${screen} · 抹茶时光</title><link rel="stylesheet" href="tokens.css"></head><body>${body}</body></html>`
const des = path.join(tmp, 'matcha')
fs.mkdirSync(des)
fs.writeFileSync(path.join(des, 'tokens.css'), ':root{--bg:#f6f3ea;--text:#1f2a1c;--primary:#5a7d3a}')
fs.writeFileSync(path.join(des, 'home.html'), page('首页', '<h1>抹茶时光</h1>'))
fs.writeFileSync(path.join(des, 'menu.html'), page('菜单', '<p>抹茶拿铁 ¥26</p>'))
const p = packDesign(des, { screens: listScreens(des), version: '0.11.0' })
check('样例模板能过打包检查', p.ok, JSON.stringify(p.errors.slice(0, 2)))
const tplFiles = p.files.map((f) => ({ path: f.path, data: f.data }))

// 设计系统
const sysManifest = { format: 1, type: 'system', title: { zh: '青竹', en: 'Bamboo' }, license: 'CC0-1.0', author: { login: 'bob', id: 2 }, ai: { generated: true, tool: 'dsh-design-studio@0.11.0' } }
const sysFiles = [
  { path: 'design.json', data: Buffer.from(JSON.stringify(sysManifest)) },
  { path: 'system.json', data: Buffer.from(JSON.stringify({ name: '<b>evil</b>名字' })) },
  { path: 'tokens.css', data: Buffer.from(':root{--color-bg:#ffffff;--color-text:#111111;--color-primary:#2f6f4f}') },
  { path: 'components.css', data: Buffer.from('.btn{color:var(--color-primary)}') },
  { path: 'components.html', data: Buffer.from('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>组件 · 青竹</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components.css"></head><body><button class="btn">按钮</button><img src="assets/icon.svg" alt="图标"></body></html>') },
  { path: 'DESIGN.md', data: Buffer.from('# 青竹\n') },
  { path: 'assets/icon.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2f6f4f"/></svg>') },
].map((f) => ({ ...f, data: Buffer.from(f.data) }))

const list = (files) => files.map((f) => ({ p: f.path, sha256: sha(f.data), size: f.data.length })).sort((a, b) => (a.p < b.p ? -1 : 1))
const digest = (files) => sha(list(files).map((f) => `${f.p}\0${f.sha256}\n`).join(''))
const PV = '2026.1106.1'
const shotJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const thumbWebp = Buffer.from('RIFFxxxxWEBP')
const media = (p, b) => ({ p, sha256: sha(b), size: b.length })
const tplEntry = { id: 'alice__matcha', type: 'template', rev: 'abc1234def56', title: { zh: '抹茶时光' }, kind: 'app', style: 'fresh', license: 'CC0-1.0', author: { login: 'alice', id: 1 }, screens: [{ file: 'home.html', title: { zh: '首页' } }, { file: 'menu.html', title: { zh: '菜单' } }], files: list(tplFiles), digest: digest(tplFiles), pack: { v: PV, path: 'd/alice__matcha/abc1234def56/' }, shots: [media('_shots/home.jpg', shotJpg), '_shots/menu.jpg'], thumb: media('thumbs/alice__matcha.webp', thumbWebp), minPlugin: '0.11.0', updated: '2026-11-06T00:00:00Z', shareHash: 'ab'.repeat(16) }
const sysEntry = { id: 'bob__bamboo', type: 'system', rev: 'fed9876abc12', title: sysManifest.title, license: 'CC0-1.0', author: { login: 'bob', id: 2 }, files: list(sysFiles), digest: digest(sysFiles), pack: { v: PV, path: 'd/bob__bamboo/fed9876abc12/' }, shareHash: 'NOT-HEX' }
const styleEntry = { id: 'carol__mint', type: 'style', rev: '0123456789ab', title: { zh: '薄荷' }, style: { c: { bg: '#ffffff', surface: '#f4fbf8', text: '#10221b', muted: '#3f5a50', line: '#d6e7e0', primary: '#1f7a5c', accent: '#f2a541', on: '#ffffff', link: '#1f7a5c' }, head: 'SANS', w: 700, radius: 12, shadow: 'none' } }
const tooNew = { ...tplEntry, id: 'dave__future', minPlugin: '9.0.0' }

const packFiles = {}
for (const f of tplFiles) packFiles[tplEntry.pack.path + f.path] = f.data
packFiles[tplEntry.pack.path + '_shots/home.jpg'] = shotJpg
packFiles[tplEntry.pack.path + '_shots/menu.jpg'] = shotJpg // 目录里没登记哈希的不收
for (const f of sysFiles) packFiles[sysEntry.pack.path + f.path] = f.data
let packTgz = tgz(packFiles)

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
const other = crypto.generateKeyPairSync('ed25519').privateKey
const sign = (bytes, key = privateKey) => crypto.sign(null, bytes, key).toString('base64')
function catalog({ serial, designs = [tplEntry, tooNew], systems = [sysEntry], revoked = [], restored, format = 1, key = privateKey, minPlugin = '0.11.0', extra = {} }) {
  const index = { format, serial, policy: 1, minPlugin, metadata: { kinds: ['app'] }, revoked, ...(restored ? { restored } : {}), designs, systems, styles: [styleEntry] }
  const bytes = Buffer.from(JSON.stringify(index))
  return tgz({ 'index.json': bytes, 'index.json.sig': sign(bytes, key), 'thumbs/alice__matcha.webp': thumbWebp, 'thumbs/nobody__x.webp': 'RIFF', 'package.json': '{}', ...extra })
}

// ── 假镜像 ──
let cat = { v: '2026.1106.1', tgz: catalog({ serial: 2026110601 }) }
let down = false
let redirectTo = ''
let hits = []
let hook = null
let packGate = null
const server = http.createServer((req, res) => {
  hits.push(req.url)
  if (hook) hook(req.url)
  if (down) { res.writeHead(503); return res.end() }
  const base = `http://127.0.0.1:${server.address().port}`
  if (req.url === '/dsh-design-gallery') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ 'dist-tags': { latest: cat.v }, versions: { [cat.v]: { dist: { tarball: redirectTo || `${base}/t/cat-${cat.v}.tgz`, integrity: integrity(cat.tgz) } } } }))
  }
  if (req.url === '/dsh-design-gallery-packs') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ 'dist-tags': { latest: PV }, versions: { [PV]: { dist: { tarball: `${base}/t/packs.tgz`, integrity: integrity(packTgz) } } } }))
  }
  if (req.url.startsWith('/t/cat-')) { res.writeHead(200); return res.end(cat.tgz) }
  if (req.url === '/t/packs.tgz') { const send = () => { res.writeHead(200); res.end(packTgz) }; return packGate ? void packGate.then(send) : send() }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const REG = `http://127.0.0.1:${server.address().port}`

const cacheDir = path.join(tmp, 'cache')
const stateDir = path.join(tmp, 'state')
const mk = (o = {}) => createMarket({ cacheDir, stateDir, version: '0.11.0', registries: [REG], keys: [pub], timing: { stagger: 50, each: 3000, total: 5000 }, ...o })

check('版本比较', vcmp('0.11.0', '0.10.9') === 1 && vcmp('0.9.0', '0.10.0') === -1 && vcmp('1.0.0', '1.0.0') === 0)
const someBytes = Buffer.from('x')
check('签名：对的钥匙过，别的钥匙不过，乱写的不过', verifyCatalog(someBytes, sign(someBytes), [pub]) && !verifyCatalog(someBytes, sign(someBytes, other), [pub]) && !verifyCatalog(someBytes, 'AAAA', [pub]))

let m = mk()
check('没取过、没自带：空的，不报错', m.view().designs.length === 0 && m.view().source === '')
await m.refresh()
let v = m.view()
check('取到目录：模板 / 设计系统 / 风格各一条', v.designs.length === 1 && v.systems.length === 1 && v.styles.length === 1 && v.source === 'cache', JSON.stringify(v).slice(0, 200))
check('要更新插件才能用的那条不显示', !v.designs.some((d) => d.id === 'dave__future'))
check('分享指纹：对的带给界面（认「我分享的已上架」），乱写的当没有', v.designs[0].shareHash === 'ab'.repeat(16) && v.systems[0].shareHash === '')
check('封面：只收目录里有的 id', !!m.thumbFile('alice__matcha') && !fs.existsSync(path.join(cacheDir, 'catalog', 'thumbs', 'nobody__x.webp')))
check('状态：serial 记到用户目录（不在缓存里）', JSON.parse(fs.readFileSync(path.join(stateDir, 'gallery-state.json'), 'utf8')).serial === 2026110601)

// 新开一个（像重启）：先读缓存，不联网也有
down = true
m = mk()
check('断网：照样显示上次的', m.view().designs.length === 1 && m.view().source === 'cache')
let err = null
try { await m.refresh() } catch (e) { err = e }
check('断网刷新：报错但缓存还在', err && m.view().designs.length === 1 && m.view().error !== '', err && err.code)
down = false

// 签名不对：不换
cat = { v: '2026.1106.2', tgz: catalog({ serial: 2026110602, key: other, designs: [] }) }
err = null
try { await m.refresh() } catch (e) { err = e }
check('签名不对：拒，缓存不动', err && err.code === 'signature' && m.view().designs.length === 1, err && err.code)

// 回滚：serial 更小
cat = { v: '2026.1106.3', tgz: catalog({ serial: 2026110500, designs: [] }) }
err = null
try { await m.refresh() } catch (e) { err = e }
check('旧目录（serial 变小）：拒', err && err.code === 'old' && m.view().designs.length === 1, err && err.code)

// 格式更高：提示更新
cat = { v: '2026.1106.4', tgz: catalog({ serial: 2026110610, format: 2 }) }
err = null
try { await m.refresh() } catch (e) { err = e }
check('格式更高：不用，提示更新设计台', err && err.code === 'format' && m.view().needUpdate && m.view().designs.length === 1)
m = mk()

// 包里有越界路径：整个拒
cat = { v: '2026.1106.45', tgz: catalog({ serial: 2026110611, extra: { 'thumbs/../../evil.webp': 'x' } }) }
err = null
try { await m.refresh() } catch (e) { err = e }
check('目录包里有越界路径：整个拒，什么都不写', err && err.code === 'tar' && !fs.existsSync(path.join(tmp, 'evil.webp')) && !fs.existsSync(path.join(cacheDir, 'evil.webp')), err && err.code)

// 只认白名单主机的 tarball
redirectTo = 'https://evil.example.com/x.tgz'
cat = { v: '2026.1106.5', tgz: catalog({ serial: 2026110611 }) }
err = null
try { await m.refresh() } catch (e) { err = e }
check('tarball 指到别的主机：拒', err && err.code === 'host', err && err.code)
redirectTo = ''

// ── 批次包 ──
await m.refresh()
const s1 = await m.stage('alice__matcha')
check('批次包：下载、核对、解开，截图在', s1.files.length === tplFiles.length && s1.shots.includes('_shots/home.jpg') && !!m.shotFile('alice__matcha', '_shots/home.jpg'))
check('截图：目录里没登记哈希的不收', !s1.shots.includes('_shots/menu.jpg') && !m.shotFile('alice__matcha', '_shots/menu.jpg') && !fs.existsSync(path.join(s1.dir, '_shots/menu.jpg')) && m.view().designs[0].shots === 1)
check('原样的市场页面预览时加硬规矩', m.strictHtml(tplFiles.find((f) => f.path === 'home.html').data) && !m.strictHtml(Buffer.from('<p>mine</p>')))
check('解开的目录算「别人做的」', m.isStaging(s1.dir) && !m.isStaging(tmp))
hits = []
await m.stage('alice__matcha')
check('第二次：用解好的，不再下载', !hits.some((u) => u.includes('packs')))

// 批次包被改过：拒
fs.rmSync(path.join(cacheDir, 'staging'), { recursive: true, force: true })
fs.rmSync(path.join(cacheDir, 'packs'), { recursive: true, force: true })
const evil = { ...packFiles, [tplEntry.pack.path + 'home.html']: page('首页', '<h1>抹茶时光</h1><img src=x onerror=alert(1)>') }
packTgz = tgz(evil)
err = null
try { await m.stage('alice__matcha') } catch (e) { err = e }
check('批次包里的文件和目录对不上：拒，坏包不留在缓存', err && err.code === 'mismatch' && !(fs.existsSync(path.join(cacheDir, 'packs')) && fs.readdirSync(path.join(cacheDir, 'packs')).length), err && err.code)
packTgz = tgz(packFiles)
// 缓存里的批次包坏了（上次下的是坏的 / 磁盘坏了）：删掉重下
fs.mkdirSync(path.join(cacheDir, 'packs'), { recursive: true })
fs.writeFileSync(path.join(cacheDir, 'packs', `${tplEntry.pack.v}.tgz`), tgz(evil))
const again = await m.stage('alice__matcha').catch((e) => e)
check('缓存里的批次包核对不过：删掉重下一次', again && again.files && again.files.length === tplFiles.length, again && again.code)
fs.writeFileSync(path.join(cacheDir, 'packs', `${tplEntry.pack.v}.tgz`), 'not a tgz')
fs.rmSync(path.join(cacheDir, 'staging'), { recursive: true, force: true })
const again2 = await m.stage('alice__matcha').catch((e) => e)
check('缓存里的批次包解不开：也重下', again2 && again2.files && again2.files.length === tplFiles.length, again2 && again2.code)

// 镜像换了截图 / 封面（目录签名不变）：不认
fs.rmSync(path.join(cacheDir, 'staging'), { recursive: true, force: true })
fs.rmSync(path.join(cacheDir, 'packs'), { recursive: true, force: true })
packTgz = tgz({ ...packFiles, [tplEntry.pack.path + '_shots/home.jpg']: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xd9]) })
const swapped = await m.stage('alice__matcha').catch((e) => e)
check('镜像换了截图：文件照常用，那张图不收', swapped && swapped.files && swapped.shots.length === 0 && !m.shotFile('alice__matcha', '_shots/home.jpg'), swapped && swapped.code)
packTgz = tgz(packFiles)
fs.rmSync(path.join(cacheDir, 'staging'), { recursive: true, force: true })
fs.rmSync(path.join(cacheDir, 'packs'), { recursive: true, force: true })
cat = { v: '2026.1106.55', tgz: catalog({ serial: 2026110612, extra: { 'thumbs/alice__matcha.webp': 'RIFFevilWEBP' } }) }
await m.refresh()
check('镜像换了封面：不收、不给', !m.thumbFile('alice__matcha') && !fs.existsSync(path.join(cacheDir, 'catalog', 'thumbs', 'alice__matcha.webp')) && m.view().designs[0].thumb === false)
fs.writeFileSync(path.join(cacheDir, 'catalog', 'thumbs', 'alice__matcha.webp'), 'RIFFevilWEBP')
check('缓存里的封面被换：也不给', !m.thumbFile('alice__matcha'))
cat = { v: '2026.1106.56', tgz: catalog({ serial: 2026110613 }) }
await m.refresh()
check('封面对上了又有', !!m.thumbFile('alice__matcha'))
// 暂存里的截图被改过（.ok 还在）：列表和取图都按目录再核对
{
  const a = await m.stage('alice__matcha')
  fs.writeFileSync(path.join(a.dir, '_shots/home.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]))
  const b = await m.stage('alice__matcha')
  check('暂存里的截图被改过：列表和取图都不认', b.files.length === tplFiles.length && !b.shots.includes('_shots/home.jpg') && !m.shotFile('alice__matcha', '_shots/home.jpg'), JSON.stringify([b.files.length, b.shots, a.shots, !!m.shotFile('alice__matcha', '_shots/home.jpg')]))
  // 下载批次包的途中目录刷新、这一套换了版本：下完也不落地
  fs.rmSync(path.join(cacheDir, 'staging'), { recursive: true, force: true })
  fs.rmSync(path.join(cacheDir, 'packs'), { recursive: true, force: true })
  let release
  packGate = new Promise((r) => { release = r })
  const pending = m.stage('alice__matcha').catch((e) => e)
  for (let k = 0; k < 50 && !hits.includes('/t/packs.tgz'); k++) await new Promise((r) => setTimeout(r, 20))
  cat = { v: '2026.1106.57', tgz: catalog({ serial: 2026110614, designs: [{ ...tplEntry, rev: 'abcdef123456' }, tooNew] }) }
  await m.refresh()
  release(); packGate = null
  const r = await pending
  check('下载途中这一套换了版本 / 下架：不落地', r && r.code === 'gone' && !fs.existsSync(path.join(cacheDir, 'staging', `alice__matcha@${tplEntry.rev}`)), r && r.code)
  cat = { v: '2026.1106.58', tgz: catalog({ serial: 2026110615 }) }
  await m.refresh()
}

// ── 下架：只增不减 ──
const staged = (await m.stage('alice__matcha')).dir
cat = { v: '2026.1106.6', tgz: catalog({ serial: 2026110620, revoked: [{ id: 'alice__matcha', reason: 'copyright' }] }) }
await m.refresh()
check('下架：从目录里消失，也取不到', m.view().designs.length === 0 && !m.entry('alice__matcha') && !m.thumbFile('alice__matcha'))
check('下架：解开的那份删掉；名单给界面（收藏、我的作品标「已下架」）', !fs.existsSync(staged) && m.view().revoked.some((r) => r.id === 'alice__matcha' && !r.rev))
cat = { v: '2026.1106.7', tgz: catalog({ serial: 2026110621 }) }
await m.refresh()
check('下一版目录漏了下架名单：本地记着，还是不显示', m.view().designs.length === 0)
fs.rmSync(cacheDir, { recursive: true, force: true })
m = mk()
await m.refresh()
check('清了缓存：下架名单还在（存在用户目录）', m.view().designs.length === 0)
cat = { v: '2026.1106.8', tgz: catalog({ serial: 2026110622, revoked: [{ id: 'alice__matcha', reason: 'policy' }], restored: [{ id: 'alice__matcha', at: '2026-11-07T00:00:00Z' }] }) }
await m.refresh()
check('撤销名单和下架名单都有它（又下架了）：还是不显示', m.view().designs.length === 0)
cat = { v: '2026.1106.9', tgz: catalog({ serial: 2026110623, restored: [{ id: 'alice__matcha', at: '2026-11-07T00:00:00Z' }, { id: '../x', at: 'x' }] }) }
await m.refresh()
check('签了名的撤销名单：放出来（界面也不再标「已下架」）', m.view().designs.length === 1 && !m.view().revoked.some((r) => r.id === 'alice__matcha') && !!m.entry('alice__matcha'))
cat = { v: '2026.1106.10', tgz: catalog({ serial: 2026110624, revoked: [{ id: 'alice__matcha', reason: 'policy' }] }) }
await m.refresh()
check('撤销后又下架：再藏起来', m.view().designs.length === 0)

// ── 「设计库不联网」开着：一个网址都不访问，缓存里有的照常看 ──
{
  let on = true
  const mo = mk({ online: () => on })
  await mo.refresh()
  on = false
  hits = []
  mo.maybeRefresh()
  const r = await mo.refresh().catch((e) => e)
  const st = await mo.stage('bob__bamboo').catch((e) => e)
  check('设计库不联网：不取目录、不下载，界面知道；缓存里的目录照常显示', !hits.length && r.code === 'off' && st.code === 'off' && mo.view().off && mo.view().systems.length === 1, JSON.stringify({ hits, r: r && r.code, st: st && st.code }))
  await new Promise((ok) => setTimeout(ok, 10))
  on = true
  const back = await mo.refresh().then(() => 'ok', (e) => e.code)
  check('关掉「不联网」：马上能刷（一开头就失败的那次不会一直挂着「正在刷新」）', back === 'ok' && !mo.view().refreshing && !mo.view().error && !mo.view().off, back)
}

// 正在取目录时打开「不联网」：正在下的掐掉，后面的 tarball 不再下
{
  let on = true
  const mo = mk({ online: () => on })
  cat = { v: '2026.1106.11', tgz: catalog({ serial: 2026110625 }) }
  hits = []
  hook = (u) => { if (u === '/dsh-design-gallery') { on = false; mo.abort() } }
  const r = await mo.refresh().catch((e) => e)
  hook = null
  check('取目录中途打开「不联网」：马上停，不再下 tarball', r && r.code === 'off' && !hits.some((u) => u.startsWith('/t/')) && mo.view().serial !== 2026110625, JSON.stringify({ hits, r: r && r.code }))
  on = true
}

// 最快的源给了签名不对的目录：不算成功，接着等下一个源
{
  const bad = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${bad.address().port}`
    if (req.url === '/dsh-design-gallery') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ 'dist-tags': { latest: '2026.1106.12' }, versions: { '2026.1106.12': { dist: { tarball: `${base}/t/x.tgz` } } } })) }
    if (req.url === '/t/x.tgz') { res.writeHead(200); return res.end(catalog({ serial: 2026110699, key: other })) }
    res.writeHead(404); res.end()
  })
  await new Promise((ok) => bad.listen(0, '127.0.0.1', ok))
  const BAD = `http://127.0.0.1:${bad.address().port}`
  cat = { v: '2026.1106.12', tgz: catalog({ serial: 2026110626 }) }
  const mr = mk({ registries: [BAD, REG], timing: { stagger: 2000, each: 3000, total: 5000 } })
  const got = await mr.refresh().then(() => 'ok', (e) => e.code)
  check('最快的源给了坏签名：换下一个源，取到好的', got === 'ok' && mr.view().serial === 2026110626 && mr.view().registry === REG, JSON.stringify({ got, serial: mr.view().serial, reg: mr.view().registry }))
  bad.close()
}

// 自动刷新失败后别一直重试（界面在「正在刷新」时每几秒来问一次）
{
  let t = Date.now() + 10 * STALE_MS
  const mf = mk({ now: () => t })
  down = true
  hits = []
  mf.maybeRefresh()
  await new Promise((ok) => setTimeout(ok, 100))
  const first = hits.length
  mf.maybeRefresh()
  mf.maybeRefresh()
  await new Promise((ok) => setTimeout(ok, 100))
  const again = hits.length
  t += RETRY_MS + 1
  mf.maybeRefresh()
  await new Promise((ok) => setTimeout(ok, 100))
  check('自动刷新失败后：5 分钟内不再自动试，过了再试', first > 0 && again === first && hits.length > again, JSON.stringify({ first, again, after: hits.length }))
  down = false
  const manual = await mf.refresh().then(() => 'ok', (e) => e.code)
  check('手动刷新不受这个限制', manual === 'ok', manual)
}

// 缓存被换成比记下的 serial 下限还旧的目录：不认
{
  const stateFile = path.join(stateDir, 'gallery-state.json')
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  fs.writeFileSync(stateFile, JSON.stringify({ ...st, serial: 2026119999 }))
  down = true
  const mc = mk()
  check('缓存比记下的 serial 下限旧：不显示（防旧目录让下架的复活）', mc.view().source !== 'cache' && mc.view().designs.length === 0, mc.view().source)
  down = false
  fs.writeFileSync(stateFile, JSON.stringify(st))
}

// ── 用这个开始 / 装设计系统（接口）──
fs.rmSync(stateDir, { recursive: true, force: true })
fs.rmSync(cacheDir, { recursive: true, force: true })
cat = { v: '2026.1106.8', tgz: catalog({ serial: 2026110630 }) }
m = mk()
await m.refresh()
const library = createLibrary({ dir: path.join(tmp, 'lib') })
const work = path.join(tmp, 'work')
fs.mkdirSync(work)
let target = null
const tracker = { setTarget: async (sid, t) => { target = t }, snapshot: () => ({ ok: 1 }), cwdOf: () => work }
const sysDir = path.join(tmp, 'systems')
const routes = createMarketRoutes({ admit: () => true, readBody: async (req) => req.body, json: (res, code, body) => { res.code = code; res.body = body }, tracker, library, market: m, open: async () => ({ origin: 'http://127.0.0.1:1' }), systemsDir: sysDir })
const call = async (name, body, url = '/x') => { const res = {}; await routes[name]({ method: body ? 'POST' : 'GET', url, body }, res); return res }
let r = await call('muse', { session: 's1', id: 'alice__matcha' })
check('用这个开始：落到会话目录下新文件夹，画布打开第一屏', r.code === 200 && r.body.dir === path.join(work, '抹茶时光') && target && target.file === path.join(r.body.dir, 'home.html'), JSON.stringify(r.body).slice(0, 200))
const w = library.get(r.body.dir)
check('用这个开始：登记成「市场来的」，带上来源', w && w.trust === 'market' && w.from.id === 'alice__matcha' && /github\.com\/OrderG-X\/dsh-design-gallery/.test(w.from.url))
check('用这个开始：落地的页面预览时加硬规矩', library.strictHtml(fs.readFileSync(path.join(r.body.dir, 'home.html'))))
// 等会话目录的这会儿目录刷新、这一套换了版本 / 下架：不落地
{
  let release
  const gate = new Promise((ok) => { release = ok })
  let asked = false
  const slow = createMarketRoutes({ admit: () => true, readBody: async (req) => req.body, json: (res, code, body) => { res.code = code; res.body = body }, tracker, library, market: m, open: async () => ({ origin: 'http://127.0.0.1:1' }), systemsDir: sysDir, sessionCwd: async () => { asked = true; await gate; return work } })
  const before = fs.readdirSync(work).length
  const res = {}
  const p = slow.muse({ method: 'POST', body: { session: 's1', id: 'alice__matcha' } }, res)
  for (let k = 0; k < 100 && !asked; k++) await new Promise((ok) => setTimeout(ok, 10))
  cat = { v: '2026.1106.81', tgz: catalog({ serial: 2026110631, designs: [{ ...tplEntry, rev: 'abcdef123456' }, tooNew] }) }
  await m.refresh()
  release()
  await p
  check('用这个开始：等的时候换了版本 / 下架 → 不落地', res.code === 410 && fs.readdirSync(work).length === before, JSON.stringify([res.code, res.body]))
  cat = { v: '2026.1106.82', tgz: catalog({ serial: 2026110632 }) }
  await m.refresh()
}
r = await call('muse', { session: 's1', id: 'nobody__nothing' })
check('用这个开始：没有的（或下架的）说「已下架」', r.code === 410 && r.body.error === 'gone')
// 界面上看的是旧版（目录刚换了新版）：不装没看过的那版
{
  const before = fs.readdirSync(work).length
  r = await call('muse', { session: 's1', id: 'alice__matcha', rev: 'old000000000' })
  check('用这个开始：界面上的版本和目录对不上 → 409 stale，不落地', r.code === 409 && r.body.error === 'stale' && fs.readdirSync(work).length === before, JSON.stringify([r.code, r.body]))
  r = await call('msystem', { id: 'bob__bamboo', rev: 'old000000000' })
  check('装设计系统：版本对不上 → 409 stale', r.code === 409 && r.body.error === 'stale', JSON.stringify([r.code, r.body]))
  r = await call('mlive', { id: 'alice__matcha' })
  check('实时看：回包带上是哪一套、哪一版（界面拿它丢掉晚到的旧回包）', r.code === 200 && r.body.id === 'alice__matcha' && r.body.rev === tplEntry.rev && r.body.origin, JSON.stringify(r.body))
}
// 同一个 id 在两类里都有（目录不该这样）：分不清，两边都不列、按 id 也找不到
{
  cat = { v: '2026.1106.83', tgz: catalog({ serial: 2026110633, systems: [sysEntry, { ...sysEntry, id: 'alice__matcha' }] }) }
  await m.refresh()
  const v = m.view()
  check('跨类型同 id：目录里两边都不列', !v.designs.some((e) => e.id === 'alice__matcha') && !v.systems.some((e) => e.id === 'alice__matcha') && v.systems.some((e) => e.id === 'bob__bamboo'), JSON.stringify(v.designs.map((e) => e.id).concat(v.systems.map((e) => e.id))))
  check('跨类型同 id：按 id 找不到', m.entry('alice__matcha') === null)
  r = await call('msystem', { id: 'alice__matcha' })
  check('跨类型同 id：装系统说「已下架」，不会拿到模板', r.code === 410 && r.body.error === 'gone', JSON.stringify([r.code, r.body]))
  cat = { v: '2026.1106.84', tgz: catalog({ serial: 2026110634 }) }
  await m.refresh()
}
// 用户自己已经有一个同名目录
fs.mkdirSync(path.join(sysDir, 'bamboo__bob'), { recursive: true })
fs.writeFileSync(path.join(sysDir, 'bamboo__bob', 'tokens.css'), ':root{--mine:1}')
r = await call('msystem', { id: 'bob__bamboo' })
const sj = r.body && r.body.dir ? JSON.parse(fs.readFileSync(path.join(r.body.dir, 'system.json'), 'utf8')) : {}
check('装设计系统：进设计系统库，名字按目录重写（不信包里的）、记上来源', r.code === 200 && fs.existsSync(path.join(r.body.dir, 'tokens.css')) && sj.name === '青竹 (2)' && sj.sources[0] === '设计市场 bob__bamboo@fed9876abc12', JSON.stringify(r.body).slice(0, 200))
check('装设计系统：用户自己的同名目录一个字不动，另起一个', r.body.id === 'bamboo__bob-2' && fs.readFileSync(path.join(sysDir, 'bamboo__bob', 'tokens.css'), 'utf8') === ':root{--mine:1}' && !fs.existsSync(path.join(sysDir, 'bamboo__bob', 'system.json')))
check('装设计系统：包里的图片也装上（相对路径不变）', fs.existsSync(path.join(r.body.dir, 'assets', 'icon.svg')) && sj.market.files['assets/icon.svg'] && !fs.existsSync(path.join(r.body.dir, 'design.json')))
r = await call('msystem', { id: 'bob__bamboo' })
{
  const sw = library.list().find((x) => x.from && x.from.id === 'bob__bamboo')
  const html = sysFiles.find((f) => f.path === 'components.html')
  check('装设计系统：记进作品库的信任记录（藏着），装好的页面按别人做的预览', sw && sw.hidden === true && sw.trust === 'market' && sw.kind === 'system' && library.strictHtml(html.data) && library.strictRoot(path.join(sysDir, r.body.id)), JSON.stringify(sw))
}
check('装设计系统：再装一次（没改过）就地换新', r.code === 200 && r.body.id === 'bamboo__bob-2' && r.body.updated === true && !fs.existsSync(path.join(sysDir, 'bamboo__bob-3')))
fs.appendFileSync(path.join(sysDir, 'bamboo__bob-2', 'components.css'), '\n.mine{}')
r = await call('msystem', { id: 'bob__bamboo' })
check('装设计系统：装上后用户改过的不覆盖，另起一个', r.code === 200 && r.body.id === 'bamboo__bob-3' && /\.mine/.test(fs.readFileSync(path.join(sysDir, 'bamboo__bob-2', 'components.css'), 'utf8')))
// 用户在装好的那份里自己加了文件，新版正好也有这个文件：不盖，另起一份
{
  const lib2 = fs.mkdtempSync(path.join(tmp, 'sys2-'))
  const E = { id: 'zed__leaf', rev: 'aaaaaaa1' }
  const v1 = installSystem(lib2, E, sysFiles, { name: 'Leaf' })
  fs.mkdirSync(path.join(v1.real, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(v1.real, 'assets', 'custom.svg'), '<svg>mine</svg>')
  fs.writeFileSync(path.join(v1.real, 'notes.md'), 'mine')
  const v2files = [...sysFiles, { path: 'assets/custom.svg', data: Buffer.from('<svg>upstream</svg>') }]
  const v2 = installSystem(lib2, { ...E, rev: 'bbbbbbb2' }, v2files, { name: 'Leaf' })
  check('装设计系统：新版会盖掉用户自己加的文件 → 另起一份、原文件不动', v2.id === 'leaf__zed-2' && fs.readFileSync(path.join(v1.real, 'assets', 'custom.svg'), 'utf8') === '<svg>mine</svg>')
  // 只加了不冲突的文件：就地更新、加的文件留着
  const v3 = installSystem(lib2, { ...E, rev: 'ccccccc3' }, sysFiles, { name: 'Leaf' })
  check('装设计系统：用户加的文件不冲突 → 就地更新、文件留着', v3.updated === true && v3.id === 'leaf__zed' && fs.readFileSync(path.join(v1.real, 'notes.md'), 'utf8') === 'mine')
  // system.json 换成指向外面的软链接：不碰它（外面的文件不变），另起一份
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-'))
  const target = path.join(outside, 'victim.json')
  fs.writeFileSync(target, fs.readFileSync(path.join(v1.real, 'system.json')))
  const before = fs.readFileSync(target, 'utf8')
  fs.rmSync(path.join(v1.real, 'system.json'))
  fs.symlinkSync(target, path.join(v1.real, 'system.json'))
  const v4 = installSystem(lib2, { ...E, rev: 'ddddddd4' }, sysFiles, { name: 'Leaf' })
  check('装设计系统：system.json 是软链接 → 不顺着写，另起一份', v4.id !== 'leaf__zed' && fs.readFileSync(target, 'utf8') === before)
  // assets/ 挪到外面再链回来：更新删旧文件时不能删到外面
  const lib3 = fs.mkdtempSync(path.join(tmp, 'sys3-'))
  const withAsset = [...sysFiles, { path: 'assets/old.svg', data: Buffer.from('<svg/>') }]
  const w1 = installSystem(lib3, E, withAsset, { name: 'Leaf' })
  const ext = path.join(outside, 'assets')
  fs.renameSync(path.join(w1.real, 'assets'), ext)
  fs.symlinkSync(ext, path.join(w1.real, 'assets'))
  const w2 = installSystem(lib3, { ...E, rev: 'eeeeeee5' }, sysFiles, { name: 'Leaf' })
  check('装设计系统：目录里有软链接 → 不删外面的文件，另起一份', w2.id === 'leaf__zed-2' && fs.existsSync(path.join(ext, 'old.svg')))
  // 目录里某个文件在外面有硬链接：写它会连带改掉外面那个 → 另起一份，外面的不变
  const lib4 = fs.mkdtempSync(path.join(tmp, 'sys4-'))
  const h1 = installSystem(lib4, E, sysFiles, { name: 'Leaf' })
  const hl = path.join(outside, 'hard.css')
  fs.linkSync(path.join(h1.real, 'tokens.css'), hl)
  const hbefore = fs.readFileSync(hl, 'utf8')
  const v2tokens = sysFiles.map((f) => (f.path === 'tokens.css' ? { ...f, data: Buffer.from(':root{--color-bg:#000000}') } : f))
  const h2 = installSystem(lib4, { ...E, rev: 'fffffff6' }, v2tokens, { name: 'Leaf' })
  check('装设计系统：有硬链接 → 不顺着改外面的文件，另起一份', h2.id === 'leaf__zed-2' && fs.readFileSync(hl, 'utf8') === hbefore)
  // 用户改过 system.json（改名、加字段）：不覆盖，另起一份
  const lib5 = fs.mkdtempSync(path.join(tmp, 'sys5-'))
  const m1 = installSystem(lib5, E, sysFiles, { name: 'Leaf' })
  const sjf = path.join(m1.real, 'system.json')
  const mine = { ...JSON.parse(fs.readFileSync(sjf, 'utf8')), name: '我的叶子', note: 'mine' }
  fs.writeFileSync(sjf, JSON.stringify(mine, null, 2))
  const m2 = installSystem(lib5, { ...E, rev: 'ggggggg7' }, sysFiles, { name: 'Leaf' })
  const kept = JSON.parse(fs.readFileSync(sjf, 'utf8'))
  check('装设计系统：用户改过 system.json → 不覆盖，另起一份', m2.id === 'leaf__zed-2' && kept.name === '我的叶子' && kept.note === 'mine', JSON.stringify([m2.id, kept.name]))
  // 只是重新排版（内容没变）：照样就地更新
  const m3 = installSystem(lib5, { ...E, rev: 'hhhhhhh8' }, sysFiles, { name: 'Leaf' })
  const sj2 = path.join(m3.real, 'system.json')
  fs.writeFileSync(sj2, JSON.stringify(JSON.parse(fs.readFileSync(sj2, 'utf8'))))
  const m4 = installSystem(lib5, { ...E, rev: 'iiiiiii9' }, sysFiles, { name: 'Leaf' })
  check('装设计系统：system.json 只是换了排版 → 就地更新', m4.updated === true && m4.id === m3.id, JSON.stringify([m3.id, m4.id, m4.updated]))
  // 更新后，旧版本的页面（版本快照里）预览时照样加规矩
  const lib6 = fs.mkdtempSync(path.join(tmp, 'sys6-'))
  const wl = createLibrary({ dir: fs.mkdtempSync(path.join(tmp, 'wl-')) })
  const html1 = sysFiles.find((f) => f.path === 'components.html').data
  const html2 = Buffer.from(html1.toString().replace('按钮', '按钮 v2'))
  const n1 = installSystem(lib6, E, sysFiles, { name: 'Leaf' })
  recordSystem(wl, n1, E, { name: 'Leaf' })
  const n2 = installSystem(lib6, { ...E, rev: 'jjjjjjj1' }, sysFiles.map((f) => (f.path === 'components.html' ? { ...f, data: html2 } : f)), { name: 'Leaf' })
  recordSystem(wl, n2, { ...E, rev: 'jjjjjjj1' }, { name: 'Leaf' })
  check('装设计系统：就地更新后，新旧两版页面都按别人做的预览', n2.updated === true && wl.strictHtml(html1) && wl.strictHtml(html2), JSON.stringify(wl.get(n2.real)))
  // 连着更新 45 次（每版页面都不同）：版本记录留着的那些旧版（最近 40 版）照样加规矩
  const htmlOf = (k) => Buffer.from(html1.toString().replace('按钮', `按钮 第${k}版`))
  for (let k = 3; k <= 47; k++) {
    const nk = installSystem(lib6, { ...E, rev: `rev${k}` }, sysFiles.map((f) => (f.path === 'components.html' ? { ...f, data: htmlOf(k) } : f)), { name: 'Leaf' })
    recordSystem(wl, nk, { ...E, rev: `rev${k}` }, { name: 'Leaf' })
  }
  // 再把最新这版重装 60 次：不多占，第一版的页面照样加规矩
  for (let k = 0; k < 60; k++) {
    const nk = installSystem(lib6, { ...E, rev: 'rev47' }, sysFiles.map((f) => (f.path === 'components.html' ? { ...f, data: htmlOf(47) } : f)), { name: 'Leaf' })
    recordSystem(wl, nk, { ...E, rev: 'rev47' }, { name: 'Leaf' })
  }
  const wl2 = createLibrary({ dir: path.dirname(wl.file) })
  const past = wl2.get(n2.real).pastHashes || []
  check('装设计系统：更新 45 次再重装 60 次，以前每一版的页面都还按别人做的预览（重开也一样）', wl2.strictHtml(html1) && wl2.strictHtml(html2) && [...Array(45).keys()].every((j) => wl2.strictHtml(htmlOf(47 - j))) && past.length === new Set(past).size && past.length === 46, JSON.stringify(past.length))
  check('装设计系统：它的旧版本快照一律按别人做的预览；别的目录不算', wl2.strictVersions(n2.real) && wl2.strictVersions(path.join(n2.real, 'sub')) && !wl2.strictVersions(lib6) && !wl2.strictVersions(tmp))
  // 退回旧版：旧哈希早被挤掉了（更新太多次），退回来的页面照样按别人做的预览；普通目录退回不记
  {
    const lib7 = fs.mkdtempSync(path.join(tmp, 'sys7-'))
    const wl3 = createLibrary({ dir: fs.mkdtempSync(path.join(tmp, 'wl3-')) })
    const hist = createHistory({ base: fs.mkdtempSync(path.join(tmp, 'hist-')) })
    const s1 = installSystem(lib7, E, sysFiles, { name: 'Leaf' })
    recordSystem(wl3, s1, E, { name: 'Leaf' })
    const page1 = fs.readFileSync(path.join(s1.real, 'components.html'))
    const v1 = hist.snapshot(s1.real, 'v1')
    const s2 = installSystem(lib7, { ...E, rev: 'kkkkkkk2' }, sysFiles.map((f) => (f.path === 'components.html' ? { ...f, data: Buffer.from(page1.toString().replace('按钮', '按钮 新版')) } : f)), { name: 'Leaf' })
    recordSystem(wl3, s2, { ...E, rev: 'kkkkkkk2' }, { name: 'Leaf' })
    // 模拟更新太多次：旧哈希被挤出去
    const filler = Array.from({ length: PAST_MAX }, (_, i) => crypto.createHash('sha256').update(`f${i}`).digest('hex'))
    wl3.put(s2.real, { pastHashes: filler })
    const before = !createLibrary({ dir: path.dirname(wl3.file) }).strictHtml(page1)
    hist.restore(s2.real, v1.n, { before: (h) => wl3.addPast(s2.real, h) })
    const wl4 = createLibrary({ dir: path.dirname(wl3.file) })
    const now = fs.readFileSync(path.join(s2.real, 'components.html'))
    check('装设计系统：旧哈希被挤掉后退回旧版，退回来的页面照样按别人做的预览', before && now.equals(page1) && wl4.strictHtml(now) && (wl4.get(s2.real).pastHashes || []).length <= PAST_MAX, JSON.stringify([before, now.equals(page1), (wl4.get(s2.real).pastHashes || []).length]))
    const plain = fs.mkdtempSync(path.join(tmp, 'plain-'))
    check('普通目录退回旧版：不记', wl4.addPast(plain, [crypto.createHash('sha256').update('x').digest('hex')]) === false)
    // 记不下（出错）：不退回
    fs.writeFileSync(path.join(s2.real, 'components.html'), 'changed')
    const v2 = hist.snapshot(s2.real, 'v2')
    let threw = false
    try { hist.restore(s2.real, v1.n, { before: () => { throw new Error('boom') } }) } catch { threw = true }
    check('退回前记不下 → 不退回', threw && fs.readFileSync(path.join(s2.real, 'components.html'), 'utf8') === 'changed' && !!v2)
  }
  // 设计系统带 source/：审核就拒
  const bad = checkPack([...sysFiles, { path: 'source/icon.svg', data: Buffer.from('<svg/>') }], { mode: 'ci' })
  check('设计系统带 source/ → 审核不收（装的时候也不装）', bad.errors.some((x) => x.code === 'systemSource'))
}
const longA = installSystem(sysDir, { id: `ann__${'x'.repeat(40)}`, rev: 'aaaaaaa' }, sysFiles, { name: 'A' })
const longB = installSystem(sysDir, { id: `bea__${'x'.repeat(40)}`, rev: 'bbbbbbb' }, sysFiles, { name: 'B' })
check('装设计系统：名字很长的两套（不同作者）不撞目录', longA.id !== longB.id && JSON.parse(fs.readFileSync(path.join(longA.real, 'system.json'), 'utf8')).name === 'A' && JSON.parse(fs.readFileSync(path.join(longB.real, 'system.json'), 'utf8')).name === 'B')
r = await call('mstage', { id: 'carol__mint' })
check('风格卡不用下载批次包', r.code === 410)

// ── 几个源：前一个挂了马上换下一个 ──
const t0 = Date.now()
const got = await race(['a', 'b'], async (s) => { if (s === 'a') throw new MarketError('http', '503'); return s }, { stagger: 2000, each: 1000, total: 3000 })
check('多个源：第一个失败马上试第二个（不等错开时间）', got.source === 'b' && Date.now() - t0 < 1000)
err = null
try { await race(['a'], () => new Promise(() => {}), { stagger: 50, each: 100, total: 200 }) } catch (e) { err = e }
check('多个源：都不回就超时', err && err.code === 'timeout')

server.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
