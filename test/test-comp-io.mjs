/**
 * 组件（#30）接到各条路径上的测试：预览服务器展开、旧版本从快照读、整套演示遇错整份不出、导出预检、
 * 用了组件的屏不直接写回、先写组件文件不会被当成整套设计打开、体检报告。
 *   node test/test-comp-io.mjs
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHub, injectPicker } from '../lib/serve.js'
import { createHistory } from '../lib/history.js'
import { createTracker, parseTarget } from '../lib/core.js'
import { buildPack } from '../lib/htmlpack.js'
import { precheckScreens, dirReader, versionReader, expandPreview, expandFormal, designComponents, formatComponents, pageUsesComponents } from '../lib/comp-io.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { host: u.host } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-comp-'))
const site = path.join(tmp, 'site')
fs.mkdirSync(path.join(site, 'components'), { recursive: true })
const CARD1 = '<article class="card"><h3>{{title}}</h3><div class="act"><slot></slot></div></article>\n<style>.card{padding:4px}</style>\n'
fs.writeFileSync(path.join(site, 'components', 'card.html'), CARD1)
const INDEX = '<!doctype html><html><head><title>A</title><style>body{margin:0}</style></head><body><c-card title="周末徒步"><a href="plain.html">查看</a></c-card></body></html>'
const PLAIN = '<!doctype html><html><head><title>P</title></head><body><h1>Hi</h1><!-- <c-card title="x"></c-card> --></body></html>'
const MISS = '<!doctype html><html><head><title>M</title></head><body><c-nope></c-nope></body></html>'
fs.writeFileSync(path.join(site, 'index.html'), INDEX)
fs.writeFileSync(path.join(site, 'plain.html'), PLAIN)
fs.writeFileSync(path.join(site, 'miss.html'), MISS)
fs.writeFileSync(path.join(tmp, 'secret.html'), '<p>nope</p>')

// ── 读文件 ──
{
  const read = dirReader(site)
  check('读：设计目录里的组件读得到', String(read('components/card.html') || '') === CARD1)
  check('读：../ 跳不出去', read('../secret.html') === null && read('components/../../secret.html') === null)
  check('读：没有的给 null', read('components/none.html') === null)
}

// ── 展开（预览 / 正式）──
{
  const read = dirReader(site)
  const r = expandPreview(INDEX, read, 'index.html')
  check('预览：<c-card> 展开了、带组件标记', r.comp && !/<c-card/.test(r.html) && /data-dsh-c="card"/.test(r.html) && r.html.includes('周末徒步') && r.html.includes('<a href="plain.html">查看</a>'), r.html)
  check('预览：带上依赖（picker 靠它刷新）', /<meta name="dsh-comp-deps" content="components\/card\.html">/.test(r.html))
  check('预览：组件样式标了来源', /<style data-dsh-comp-css="card">/.test(r.html))
  const p = expandPreview(PLAIN, read, 'plain.html')
  check('预览：没用组件（注释里的不算）→ 原样', !p.comp && p.html === PLAIN)
  const m = expandPreview(MISS, read, 'miss.html')
  check('预览：缺组件 → 红框、依赖里也有它（建了要刷新）', /data-dsh-comp-error/.test(m.html) && m.deps.includes('components/nope.html'), JSON.stringify(m.deps))
  let err = null
  try { expandFormal(MISS, read, 'miss.html') } catch (e) { err = e }
  check('正式：缺组件 → 抛 compErr，带哪屏', err && err.code === 'compErr' && err.pages[0].page === 'miss.html' && err.pages[0].errors[0].code === 'missing', err && JSON.stringify(err.pages))
  check('用没用组件', pageUsesComponents(INDEX) && !pageUsesComponents(PLAIN) && !pageUsesComponents(''))
}

// ── 预览服务器 + 旧版本 ──
const history = createHistory({ base: path.join(tmp, 'hist') })
const hub = createHub({ history })
{
  const a = await hub.open({ kind: 'file', root: site })
  let r = await get(a.origin + '/index.html')
  check('服务器：页面展开后再注入', r.status === 200 && !/<c-card/.test(r.body) && r.body.includes('周末徒步') && r.body.includes('/__dsh_design__/picker.js'))
  r = await get(a.origin + '/plain.html')
  check('服务器：没用组件的页面和以前逐字节一样', r.body === injectPicker(PLAIN, { url: '/plain.html' }))
  const v1 = history.snapshot(site, 'v1')
  check('版本：存上了（含组件文件）', v1 && v1.files['components/card.html'])
  fs.writeFileSync(path.join(site, 'components', 'card.html'), CARD1.replace('<h3>', '<h3 class="new">'))
  r = await get(a.origin + '/index.html')
  check('服务器：改了组件 → 现在的页面跟着变', r.body.includes('<h3 class="new">'))
  r = await get(a.origin + `/__dsh_design__/v/${v1.n}/index.html`)
  check('版本：旧版本的页面用那一版的组件', r.status === 200 && !r.body.includes('<h3 class="new">') && r.body.includes('周末徒步'), r.body.slice(0, 300))
  // 那一版没有的组件：报缺，不拿现在的顶
  fs.writeFileSync(path.join(site, 'components', 'tag.html'), '<span class="tag">{{t}}</span>')
  fs.writeFileSync(path.join(site, 'tagged.html'), '<!doctype html><html><head></head><body><c-tag t="新"></c-tag></body></html>')
  const v2 = history.snapshot(site, 'v2')
  fs.rmSync(path.join(site, 'components', 'tag.html'))
  r = await get(a.origin + '/tagged.html')
  check('服务器：组件删了 → 红框', /data-dsh-comp-error/.test(r.body))
  r = await get(a.origin + `/__dsh_design__/v/${v2.n}/tagged.html`)
  check('版本：那一版有的组件照样展开（现在删了也不影响）', !/data-dsh-comp-error/.test(r.body) && r.body.includes('新'), r.body.slice(0, 300))
  const vr = versionReader(history, site, v1.n)
  check('版本读：那一版没有的文件给 null', vr('tagged.html') === null && String(vr('components/card.html')) === CARD1)
  fs.writeFileSync(path.join(site, 'components', 'card.html'), CARD1)
  fs.rmSync(path.join(site, 'tagged.html'))
  hub.closeAll()
}

// ── 整套 HTML 演示 / 导出预检 ──
{
  const read = dirReader(site)
  let err = null
  try { buildPack({ screens: [{ key: 'index.html' }, { key: 'miss.html' }, { key: 'plain.html' }], read, kind: 'web', w: 1280, h: 800 }) } catch (e) { err = e }
  check('演示：有屏组件出错 → 整份不出，说哪几屏', err && err.code === 'compErr' && err.pages.length === 1 && err.pages[0].page === 'miss.html', err && err.message)
  const pack = buildPack({ screens: [{ key: 'index.html' }, { key: 'plain.html' }], read, kind: 'web', w: 1280, h: 800 })
  check('演示：没错 → 出来的页面里没有 <c-', pack.count === 2 && !/<c-card/.test(pack.html) && pack.html.includes('周末徒步'))
  const bad = precheckScreens(['index.html', 'miss.html', 'plain.html', 'gone.html'], read)
  check('预检：只列有错的屏', bad.length === 1 && bad[0].page === 'miss.html')
}

// ── 体检 ──
{
  fs.writeFileSync(path.join(site, 'components', 'lonely.html'), '<i class="lonely">{{x}}</i>')
  const dc = designComponents(site, ['index.html', 'miss.html', 'plain.html'])
  const lines = formatComponents(dc)
  check('体检：缺组件报在那屏', lines.some((l) => l.includes('miss.html') && l.startsWith('- ✗')), lines.join('\n'))
  check('体检：没人用的组件提醒', dc.unused.includes('lonely') && lines.some((l) => l.includes('lonely')), lines.join('\n'))
  check('体检：短目录列出组件和参数', /card/.test(dc.line) && /title/.test(dc.line), dc.line)
  check('体检：谁用了哪个组件', (dc.usedBy.get('card') || []).includes('index.html'))
  fs.rmSync(path.join(site, 'components', 'lonely.html'))
  fs.writeFileSync(path.join(site, 'over.html'), '<!doctype html><html><head><style>.card{padding:20px}</style></head><body><c-card title="t"></c-card></body></html>')
  const d2 = designComponents(site, ['over.html', 'index.html'])
  const w = (d2.pages.find((p) => p.page === 'over.html') || { warnings: [] }).warnings
  check('体检：屏里又写了组件根元素的 class → 提醒', w.some((x) => x.code === 'page-css'), JSON.stringify(w))
  check('体检：只写在组件里的不提醒', !d2.pages.some((p) => p.page === 'index.html' && p.warnings.some((x) => x.code === 'page-css')))
  fs.rmSync(path.join(site, 'over.html'))
}

// ── 写回：用了组件的屏改字、调样式不直接写文件 ──
{
  const snaps = []
  const tk = createTracker({ open: async () => ({ origin: 'http://127.0.0.1:11' }), history: { snapshot: (root, label) => { snaps.push(label); return { n: snaps.length } }, list: () => [] } })
  await tk.setTarget('sC', parseTarget(path.join(site, 'index.html')), { source: 'tool' })
  const r = tk.editText('sC', { key: 'index.html', before: '周末徒步', after: '周末露营' })
  check('写回：改字 → comp，文件没动', r.reason === 'comp' && fs.readFileSync(path.join(site, 'index.html'), 'utf8') === INDEX, JSON.stringify(r))
  const s = tk.editStyle('sC', { key: 'index.html', loc: { tag: 'h3', n: 0 }, css: { color: 'red' }, name: 'h3' })
  check('写回：调样式（行内）→ comp', s.reason === 'comp', JSON.stringify(s))
  fs.writeFileSync(path.join(site, 'app.css'), '.card{color:blue}')
  const ru = tk.editRule('sC', { key: 'index.html', loc: { tag: 'article', n: 0 }, file: path.join(site, 'app.css'), sel: '.card', css: { color: 'red' }, name: 'card' })
  check('写回：调样式（共用规则）→ comp，样式表没动', ru.reason === 'comp' && fs.readFileSync(path.join(site, 'app.css'), 'utf8') === '.card{color:blue}', JSON.stringify(ru))
  const ok = tk.editText('sC', { key: 'plain.html', before: 'Hi', after: 'Hello' })
  check('写回：没用组件的屏照旧写', ok.ok === true && fs.readFileSync(path.join(site, 'plain.html'), 'utf8').includes('Hello'), JSON.stringify(ok))
  fs.writeFileSync(path.join(site, 'plain.html'), PLAIN)
}

// ── 先写组件文件：不当成整套设计打开 ──
{
  const opened = []
  const tk = createTracker({ open: async (t) => { opened.push(t); return { origin: 'http://127.0.0.1:12' } } })
  let seq = 0
  const ev = (type, data) => tk.observe('sA', { type, seq: seq++, time: Date.now(), data: { turn: 1, ...data } })
  ev('tool/call', { callId: 'sk', name: 'skill', arguments: JSON.stringify({ name: 'ui-design' }) })
  ev('tool/result', { message: { content: [], toolCallId: 'sk' } })
  const site2 = path.join(tmp, 'gen')
  fs.mkdirSync(path.join(site2, 'components'), { recursive: true })
  const comp = path.join(site2, 'components', 'card.html')
  fs.writeFileSync(comp, CARD1)
  ev('tool/call', { callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: comp, content: CARD1 }) })
  ev('tool/result', { message: { content: [{ type: 'text', text: 'ok' }], isError: false, toolCallId: 'w1' } })
  await new Promise((r) => setTimeout(r, 30))
  check('自动打开：先写组件文件 → 不打开', opened.length === 0, JSON.stringify(opened))
  const page = path.join(site2, 'index.html')
  fs.writeFileSync(page, INDEX)
  ev('tool/call', { callId: 'w2', name: 'write', arguments: JSON.stringify({ file_path: page, content: INDEX }) })
  ev('tool/result', { message: { content: [{ type: 'text', text: 'ok' }], isError: false, toolCallId: 'w2' } })
  await new Promise((r) => setTimeout(r, 30))
  check('自动打开：第一个真页面 → 打开设计目录（不是 components/）', opened.length === 1 && opened[0].root === site2, JSON.stringify(opened))
}

// ── 技能里的例子原样能跑（SKILL.md 最小例子、references/components.md 完整示例）──
{
  const { expandComponents } = await import('../lib/components.js')
  const here = path.dirname(fileURLToPath(import.meta.url)) // Windows：URL 的 pathname 是 /D:/…
  for (const f of ['skills/ui-design/SKILL.md', 'skills/ui-design/references/components.md']) {
    const md = fs.readFileSync(path.join(here, '..', f), 'utf8').replace(/\r\n/g, '\n') // Windows 签出可能是 CRLF
    const blocks = [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1].replace(/^\s{3}/gm, ''))
    const ci = blocks.findIndex((b) => /<!-- components\/activity-card\.html -->/.test(b))
    const comp = blocks[ci] || ''
    const page = blocks[ci + 1] || ''
    const r = expandComponents(`<!doctype html><html><head></head><body>${page}</body></html>`, {
      read: (rel) => (rel === 'components/activity-card.html' ? comp : null),
      page: 'home.html',
      mock: { activities: [{ title: '徒步', cover: 'assets/a.jpg', status: 'open', joined: false }] },
    })
    check(`技能例子能跑：${f}`, ci >= 0 && page.includes('<c-activity-card') && !r.errors.length && !/<c-activity-card/.test(r.html), JSON.stringify(r.errors.map((e) => e.message)))
  }
}

// ── 审查第 1 轮补的 ──
{
  // 老页面用外部脚本自己注册 c-*，设计里没有 components/：原样不动、不报缺组件，体检只提醒
  const old = path.join(tmp, 'old-ce')
  fs.mkdirSync(old, { recursive: true })
  const OLD = '<!doctype html><html><head><script type="module" src="ce.js"></script></head><body><c-rating value="4"></c-rating></body></html>'
  fs.writeFileSync(path.join(old, 'index.html'), OLD)
  const rd = dirReader(old)
  const r = expandPreview(OLD, rd, 'index.html')
  check('老页面自注册 c-*（没有 components/）：原样不动', r.comp === false && r.html === OLD, r.html)
  check('老页面自注册 c-*：改字照常直接写回', pageUsesComponents(OLD, rd) === false)
  let threw = false
  try { expandFormal(OLD, rd, 'index.html') } catch { threw = true }
  check('老页面自注册 c-*：正式导出不拦', !threw)
  const dc = designComponents(old, ['index.html'], rd)
  check('老页面自注册 c-*：体检只提醒「没展开」', dc.pages.length === 1 && !dc.pages[0].errors.length && dc.pages[0].warnings[0].code === 'unadopted', JSON.stringify(dc.pages))
  // 只建个空的 components/ 不算；里面有了组件文件以后，拼错的名字照样报缺组件
  fs.mkdirSync(path.join(old, 'components'))
  check('空的 components/ 不算用了组件', expandPreview(OLD, dirReader(old), 'index.html').comp === false)
  fs.writeFileSync(path.join(old, 'components', 'tab.html'), '<b class="tab">{{t}}</b>')
  const r2 = expandPreview(OLD, dirReader(old), 'index.html')
  check('components/ 里有组件文件以后：缺的组件照样报', r2.comp === true && r2.errors.some((e) => e.code === 'missing'), JSON.stringify(r2.errors))
  // 本地外部脚本里自己注册了 c-*：有 components/ 也不接管
  fs.writeFileSync(path.join(old, 'ce.js'), "customElements.define(/* 星级 */ 'c-rating', class extends HTMLElement {})")
  const r3 = expandPreview(OLD, dirReader(old), 'index.html')
  check('外部脚本自己 define(\'c-…\')：有 components/ 也原样不动', r3.comp === false && r3.html === OLD)
  // 老网页项目自己的 components/ 里放的是 JS 组件（main.js 再 import 进来注册）：不算我们的组件文件夹
  const js = path.join(tmp, 'js-comp')
  fs.mkdirSync(path.join(js, 'components'), { recursive: true })
  fs.writeFileSync(path.join(js, 'components', 'rating.js'), "customElements.define('c-rating', class extends HTMLElement {})")
  fs.writeFileSync(path.join(js, 'main.js'), "import './components/rating.js'")
  const JS = '<!doctype html><html><head><script type="module" src="main.js"></script></head><body><c-rating value="4"></c-rating></body></html>'
  const r5 = expandPreview(JS, dirReader(js), 'index.html')
  check('老项目 components/ 里是 JS 组件（经 import 注册）：原样不动', r5.comp === false && r5.html === JS)
  // 没有 components/、页面一个外部脚本都没有：只能是我们的组件（整个 components/ 删了）→ 照样报缺、正式导出照样拦
  const bare = path.join(tmp, 'bare')
  fs.mkdirSync(bare)
  const BARE = '<!doctype html><html><head></head><body><c-card title="x"></c-card></body></html>'
  const r4 = expandPreview(BARE, dirReader(bare), 'index.html')
  let t4 = null
  try { expandFormal(BARE, dirReader(bare), 'index.html') } catch (e) { t4 = e }
  check('没有 components/ 也没有外部脚本：报缺组件、正式导出拦下', r4.comp === true && r4.errors.some((e) => e.code === 'missing') && t4 && t4.code === 'compErr', JSON.stringify(r4.errors))
}
{
  // 注释里提到 <head>：依赖标记要插进真的 <head>（不然 picker 读不到、改组件不刷新）
  const html = '<!-- 模板：<head> 里放样式 --><!doctype html><html><head><title>A</title></head><body><c-card title="x"></c-card></body></html>'
  const r = expandPreview(html, dirReader(site), 'a.html')
  const at = r.html.indexOf('<meta name="dsh-comp-deps"')
  check('注释里的 <head> 不算：依赖标记进了真的 <head>', at > r.html.indexOf('<html><head>') && at > r.html.indexOf('-->'), r.html.slice(0, 160))
}
{
  // 体检报告：坏组件的文件名不重复 components/，提醒带文件和行号
  const lines = formatComponents({ pages: [{ page: 'a.html', errors: [], warnings: [{ code: 'css-scope', message: '选择器没以根 class 开头', file: 'components/card.html', line: 3 }] }], items: [{ name: 'bad', file: 'components/bad.html', error: '组件名不合法' }], unused: [] })
  check('体检：坏组件路径只有一层 components/', lines.some((l) => l.includes('✗ components/bad.html')) && !lines.some((l) => l.includes('components/components/')), lines.join('\n'))
  check('体检：提醒带组件文件和行号', lines.some((l) => l.includes('components/card.html 第 3 行')), lines.join('\n'))
  // 同一个组件文件的提醒：几屏都用到也只列一次；选择器没从根 class 开始的并成一行
  const w = (line, sel) => ({ code: 'css-scope', message: `选择器「${sel}」没有从根元素的 class 开始`, file: 'components/top.html', line, fix: '让每个选择器都以组件根元素的某个 class 开头。' })
  const ws = [w(45, '.mp-status'), w(53, '.mp-time'), w(59, '.mp-signals')]
  const l2 = formatComponents({ pages: [{ page: 'home.html', errors: [], warnings: ws }, { page: 'mine.html', errors: [], warnings: ws }], items: [], unused: [] })
  check('体检：组件选择器提醒并成一行、多屏不重复', l2.length === 1 && /home\.html 等 2 屏/.test(l2[0]) && /3 个选择器/.test(l2[0]) && /第 45、53、59 行/.test(l2[0]) && /\.mp-status/.test(l2[0]), l2.join('\n'))
}
{
  // 数据里写的图找不到：导出照样出，列出来
  const { dataAssets } = await import('../lib/bundle.js')
  const gone = []
  dataAssets({ list: [{ cover: 'assets/none.jpg' }, { cover: 'assets/none.jpg' }], files: ['assets/none.jpg'] }, () => null, 1e6, [], () => false, gone)
  check('数据里的图没有：列进 gone（同一张只列一次、记下写在数据的哪些路径，带真下标）', gone.length === 1 && gone[0].rel === 'assets/none.jpg' && gone[0].paths.includes('list[0].cover') && gone[0].paths.includes('list[1].cover') && gone[0].paths.includes('files[0]'), JSON.stringify(gone))
  // 组件绑到 src 的图没有：整份不出；只是数据里提到的文件名（没绑到 src）照样导出、结果里列出来
  const d = path.join(tmp, 'imgs')
  fs.mkdirSync(path.join(d, 'components'), { recursive: true })
  fs.writeFileSync(path.join(d, 'components', 'act.html'), '<article class="act"><img class="cv" src="{{cover | }}" alt="" data-if="cover"><h3>{{title}}</h3></article>')
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><html><head></head><body><div data-mock-each="a in acts"><template><c-act :cover="a.cover" :title="a.title"></c-act></template></div></body></html>')
  const rdI = dirReader(d)
  let ie = null
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ acts: [{ title: '徒步', cover: 'assets/hike.jpg' }] }))
  try { buildPack({ screens: [{ key: 'index.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie = e }
  check('演示：组件绑的图没有 → 整份不出，说图、字段、屏', ie && ie.code === 'imgMissing' && /assets\/hike\.jpg/.test(ie.message) && /cover/.test(ie.message) && /index\.html/.test(ie.message), ie && ie.message)
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ acts: [{ title: '徒步', cover: '' }], note: 'assets/readme.png' }))
  let pk = null
  try { pk = buildPack({ screens: [{ key: 'index.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk = e }
  check('演示：数据里只提到、没绑到 src 的图 → 照样导出，列进 gone', pk && pk.count === 1 && pk.gone.includes('assets/readme.png'), pk && (pk.message || JSON.stringify(pk.gone)))
  // 别的路径上同名字段的图缺了（archive.cover），组件绑的是 acts[*].cover：不拦
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(d, 'assets', 'hike.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ acts: [{ title: '徒步', cover: 'assets/hike.jpg' }], archive: { cover: 'assets/old.jpg' } }))
  let pk2 = null
  try { pk2 = buildPack({ screens: [{ key: 'index.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk2 = e }
  check('演示：没绑到的路径上同名字段缺图 → 不拦', pk2 && pk2.count === 1 && pk2.gone.includes('assets/old.jpg'), pk2 && (pk2.message || ''))
  // 列表别名直接绑整项（photo in photos → :p="photo"）缺图：拦
  fs.writeFileSync(path.join(d, 'components', 'pic.html'), '<img class="pic" src="{{p}}" alt="">')
  fs.writeFileSync(path.join(d, 'album.html'), '<!doctype html><html><head></head><body><div data-mock-each="photo in photos"><template><c-pic :p="photo"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ photos: ['assets/hike.jpg', 'assets/lake.jpg'] }))
  let ie2 = null
  try { buildPack({ screens: [{ key: 'album.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie2 = e }
  check('演示：列表别名绑整项缺图 → 拦（说出 photos[1]）', ie2 && ie2.code === 'imgMissing' && /lake\.jpg/.test(ie2.message) && /photos\[1\]/.test(ie2.message), ie2 && ie2.message)
  // 同屏两个列表都叫 item：两个都认
  fs.writeFileSync(path.join(d, 'two.html'), '<!doctype html><html><head></head><body><div data-mock-each="item in acts"><template><c-act :cover="item.cover" :title="item.title"></c-act></template></div><div data-mock-each="item in photos"><template><c-pic :p="item"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ acts: [{ title: '徒步', cover: 'assets/hike.jpg' }], photos: ['assets/lake.jpg'] }))
  let ie3 = null
  try { buildPack({ screens: [{ key: 'two.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie3 = e }
  check('演示：同屏两个列表同名别名，第二个缺图也拦', ie3 && ie3.code === 'imgMissing' && /lake\.jpg/.test(ie3.message), ie3 && ie3.message)
  // 单引号属性 + 中文别名
  fs.writeFileSync(path.join(d, 'cn.html'), "<!doctype html><html><head></head><body><div data-mock-each='图 in 图片'><template><c-pic :p='图'></c-pic></template></div></body></html>")
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ 图片: ['assets/lake.jpg'] }))
  let ie4 = null
  try { buildPack({ screens: [{ key: 'cn.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie4 = e }
  check('演示：单引号 + 中文别名缺图也拦', ie4 && ie4.code === 'imgMissing' && /图片\[0\]/.test(ie4.message), ie4 && ie4.message)
  // 注释掉的图不算
  fs.writeFileSync(path.join(d, 'cm.html'), '<!doctype html><html><head></head><body><c-act title="x"></c-act><!-- <img data-mock-attr="src: old.cover"> --></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ old: { cover: 'assets/gone.jpg' } }))
  let pk3 = null
  try { pk3 = buildPack({ screens: [{ key: 'cm.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk3 = e }
  check('演示：注释掉的图缺了 → 不拦', pk3 && pk3.count === 1 && pk3.gone.includes('assets/gone.jpg'), pk3 && (pk3.message || ''))
  // 字段名带空格：product["cover image"]
  fs.writeFileSync(path.join(d, 'sp.html'), '<!doctype html><html><head></head><body><c-pic :p=\'product["cover image"]\'></c-pic></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ product: { 'cover image': 'assets/gone.jpg' } }))
  let ie5 = null
  try { buildPack({ screens: [{ key: 'sp.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie5 = e }
  check('演示：字段名带空格缺图也拦', ie5 && ie5.code === 'imgMissing' && /cover image/.test(ie5.message), ie5 && ie5.message)
  // 同名别名按所在列表算：相册只显示 item.thumb，它数据里没用上的 cover 缺了 → 不拦
  fs.writeFileSync(path.join(d, 'assets', 'lake.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  fs.writeFileSync(path.join(d, 'two2.html'), '<!doctype html><html><head></head><body><div data-mock-each="item in acts"><template><c-pic :p="item.cover"></c-pic></template></div><div data-mock-each="item in photos"><template><c-pic :p="item.thumb"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ acts: [{ cover: 'assets/hike.jpg' }], photos: [{ thumb: 'assets/lake.jpg', cover: 'assets/gone.jpg' }] }))
  let pk4 = null
  try { pk4 = buildPack({ screens: [{ key: 'two2.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk4 = e }
  check('演示：同名别名不串到别的列表（没显示的字段缺图不拦）', pk4 && pk4.count === 1 && pk4.gone.includes('assets/gone.jpg'), pk4 && (pk4.message || ''))
  // 列表外面的 item.cover 是顶层字段，不被列表别名遮住
  fs.writeFileSync(path.join(d, 'top.html'), '<!doctype html><html><head></head><body><c-pic :p="item.cover"></c-pic><div data-mock-each="item in photos"><template><c-pic :p="item.thumb"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ item: { cover: 'assets/gone.jpg' }, photos: [{ thumb: 'assets/lake.jpg' }] }))
  let ie6 = null
  try { buildPack({ screens: [{ key: 'top.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie6 = e }
  check('演示：列表外的顶层 item.cover 缺图 → 拦', ie6 && ie6.code === 'imgMissing' && /gone\.jpg/.test(ie6.message), ie6 && ie6.message)
  // 连着两个带引号的键
  fs.writeFileSync(path.join(d, 'sp2.html'), '<!doctype html><html><head></head><body><c-pic :p=\'product["image sizes"]["cover image"]\'></c-pic></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ product: { 'image sizes': { 'cover image': 'assets/gone.jpg' } } }))
  let ie7 = null
  try { buildPack({ screens: [{ key: 'sp2.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie7 = e }
  check('演示：连着两个带引号的键缺图也拦', ie7 && ie7.code === 'imgMissing' && /image sizes\.cover image/.test(ie7.message), ie7 && ie7.message)
  // 写死下标：只用首图 photos[0]，第二张缺了不拦；首图缺了拦
  fs.writeFileSync(path.join(d, 'hero.html'), '<!doctype html><html><head></head><body><c-pic :p="photos[0]"></c-pic></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ photos: ['assets/hike.jpg', 'assets/gone.jpg'] }))
  let pk5 = null
  try { pk5 = buildPack({ screens: [{ key: 'hero.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk5 = e }
  check('演示：只用 photos[0]，第二张缺了 → 不拦', pk5 && pk5.count === 1 && pk5.gone.includes('assets/gone.jpg'), pk5 && (pk5.message || ''))
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ photos: ['assets/gone.jpg', 'assets/hike.jpg'] }))
  let ie8 = null
  try { buildPack({ screens: [{ key: 'hero.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie8 = e }
  check('演示：photos[0] 自己缺了 → 拦', ie8 && ie8.code === 'imgMissing' && /photos\[0\]/.test(ie8.message), ie8 && ie8.message)
  // 列表容器里、<template> 外面的元素用外层数据（不被列表别名遮住）
  fs.writeFileSync(path.join(d, 'prod.html'), '<!doctype html><html><head></head><body><div data-mock-each="product in recs"><c-pic :p="product.cover"></c-pic><template><c-pic :p="product.thumb"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ product: { cover: 'assets/gone.jpg' }, recs: [{ thumb: 'assets/lake.jpg' }] }))
  let ie9 = null
  try { buildPack({ screens: [{ key: 'prod.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie9 = e }
  check('演示：模板外的 product.cover 缺图 → 拦（别名只管模板里面）', ie9 && ie9.code === 'imgMissing' && /product\.cover/.test(ie9.message), ie9 && ie9.message)
  // 列表里第二个 <template>（备用，不显示）绑的图缺了：不拦
  fs.writeFileSync(path.join(d, 'alt.html'), '<!doctype html><html><head></head><body><div data-mock-each="item in recs"><template><c-pic :p="item.thumb"></c-pic></template><template><c-pic :p="product.cover"></c-pic></template></div></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ product: { cover: 'assets/gone.jpg' }, recs: [{ thumb: 'assets/lake.jpg' }] }))
  let pk6 = null
  try { pk6 = buildPack({ screens: [{ key: 'alt.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { pk6 = e }
  check('演示：备用模板里的图缺了 → 不拦', pk6 && pk6.count === 1 && pk6.gone.includes('assets/gone.jpg'), pk6 && (pk6.message || ''))
  // 同一张缺图在数据里出现很多次（目录 400 条 + 首页推荐 1 条）：首页绑的那条照样拦
  fs.writeFileSync(path.join(d, 'feat.html'), '<!doctype html><html><head></head><body><c-pic :p="featured[0].cover"></c-pic></body></html>')
  fs.writeFileSync(path.join(d, 'mock.json'), JSON.stringify({ catalog: Array.from({ length: 400 }, () => ({ img: 'assets/gone.jpg' })), featured: [{ cover: 'assets/gone.jpg' }] }))
  let ie10 = null
  try { buildPack({ screens: [{ key: 'feat.html' }], read: rdI, kind: 'web', w: 1280, h: 800 }) } catch (e) { ie10 = e }
  check('演示：缺图在数据里出现 400 次，首页绑的那条也拦', ie10 && ie10.code === 'imgMissing' && /featured\[0\]\.cover/.test(ie10.message), ie10 && ie10.message)
}
{
  // 版本没存成（目录太大）：记下原因，存成了就清掉
  const big = path.join(tmp, 'big')
  fs.mkdirSync(big)
  for (let i = 0; i < 305; i++) fs.writeFileSync(path.join(big, `p${i}.html`), `<p>${i}</p>`)
  const hist = createHistory({ base: path.join(tmp, 'hist-big') })
  check('版本太大没存成：snapshot 给 null', hist.snapshot(big, 't') === null)
  const sk = hist.skipped(big)
  check('版本太大没存成：skipped 说原因', !!sk && sk.files === 300 && sk.mb === 30, JSON.stringify(sk))
  for (let i = 10; i < 305; i++) fs.rmSync(path.join(big, `p${i}.html`))
  check('删小了再存：存上了、skipped 清掉', !!hist.snapshot(big, 't2') && hist.skipped(big) === null)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
