/**
 * 自带照片库：按描述搜、第一次用到才下载且逐张核对、复制进设计目录不覆盖、不联网开关
 *   node test/test-photos.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createPhotos, loadPhotoIndex, searchPhotos, ratioNote, onlyByTheme, usedPhotos, isPhotoAsset, orientOf } from '../lib/photos.js'
import { pinRoots } from '../lib/handoff.js'
import { packDesign } from '../lib/gallery/pack.js'
import { createMarket } from '../lib/gallery/market.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-photos-')))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

const jpg = (id) => Buffer.from(`\xff\xd8 fake ${id}`, 'latin1')
const photo = (id, theme, w, h, tags) => ({ id, theme, w, h, size: jpg(id).length, sha256: sha(jpg(id)), alt: `${id} 中文`, altEn: `${id} en`, tags })
const index = {
  format: 1, package: 'dsh-design-photos', version: '1.0.0',
  themes: { hotel: { label: '民宿酒店', words: ['民宿', '酒店', 'hotel', 'homestay'] }, drink: { label: '奶茶咖啡', words: ['奶茶', '咖啡', 'coffee', 'milk tea'] } },
  photos: [
    photo('hotel-01', 'hotel', 1200, 800, ['卧室', 'bedroom']),
    photo('hotel-02', 'hotel', 1200, 800, ['庭院', 'courtyard']),
    photo('hotel-03', 'hotel', 800, 1200, ['浴缸', 'bathtub']),
    photo('hotel-04', 'hotel', 1000, 1000, ['早餐', 'breakfast', '咖啡']),
    photo('drink-01', 'drink', 1200, 800, ['拉花', 'latte art']),
    photo('drink-02', 'drink', 800, 1200, ['手拿', 'boba', '奶茶']),
  ],
}
const ids = (r) => r.map((p) => p.id).join()
const sea = {
  format: 1, package: 'x', version: '1.0.0',
  themes: { scene: { label: '风景', words: ['风景'] }, shop: { label: '服饰', words: ['鞋', '服饰'] }, fit: { label: '健身', words: ['健身', '运动'] } },
  photos: [
    photo('sea-01', 'scene', 1200, 800, ['海', '水']),
    photo('shoe-01', 'shop', 1200, 800, ['运动鞋']),
    photo('shop-02', 'shop', 1200, 800, ['衣架']),
    photo('gym-01', 'fit', 1200, 800, ['健身房']),
    photo('gym-02', 'fit', 1200, 800, ['哑铃']),
  ],
}

// ── 搜 ──
check('横竖判断', orientOf(1200, 800) === 'landscape' && orientOf(800, 1200) === 'portrait' && orientOf(1000, 1000) === 'square')
check('题材词命中只在该题材里挑', searchPhotos(index, { query: '民宿 卧室', count: 8 }).every((p) => p.theme === 'hotel'))
check('题材内标签命中的排最前', searchPhotos(index, { query: '民宿的卧室', count: 1 })[0].id === 'hotel-01')
check('英文复数也认', searchPhotos(index, { query: 'hotels courtyard', count: 1 })[0].id === 'hotel-02')
check('多词标签按整词找', searchPhotos(index, { query: 'milk tea latte art', count: 1 })[0].id === 'drink-01')
check('要竖图时竖图优先', searchPhotos(index, { query: 'hotel', ratio: 'portrait', count: 1 })[0].id === 'hotel-03')
check('竖图不够时补别的比例', searchPhotos(index, { query: 'hotel', ratio: 'portrait', count: 4 }).length === 4)
check('已用过的排最后', searchPhotos(index, { query: 'hotel', count: 4, used: new Set(['hotel-01']) })[3].id === 'hotel-01')
check('没题材词时看标签', ids(searchPhotos(index, { query: '浴缸', count: 3 })) === 'hotel-03')
check('什么都没命中 → 空', searchPhotos(index, { query: '火箭发射', count: 3 }).length === 0)
check('英文短词不会乱命中子串', searchPhotos(index, { query: 'hot', count: 3 }).length === 0)
check('「海报」「水果」这种词不算命中单字标签', searchPhotos(sea, { query: '火箭发射台的海报' }).length === 0 && searchPhotos(sea, { query: '水果' }).length === 0)
check('单字词单独写是算的', ids(searchPhotos(sea, { query: '海', count: 3 })) === 'sea-01')
check('最长词优先：「运动鞋」只算服饰', searchPhotos(sea, { query: '运动鞋', count: 8 }).every((p) => p.theme === 'shop') && searchPhotos(sea, { query: '运动鞋', count: 8 }).length === 1)
check('标签里含题材词也算题材（「健身房」）', searchPhotos(sea, { query: '健身房的照片', count: 1 })[0].id === 'gym-01')
check('说了具体画面只要命中的，宁少勿滥', ids(searchPhotos(index, { query: '民宿 浴缸', count: 3 })) === 'hotel-03')
check('比例不够时照实说，都对得上就不多话', ratioNote([{ w: 800, h: 1200 }, { w: 1200, h: 800 }], 'landscape').includes('1 张不是横图') && ratioNote([{ w: 1200, h: 800 }], 'landscape') === '' && ratioNote([{ w: 800, h: 1200 }], '') === '')
check('内容比横竖要紧', searchPhotos(index, { query: '民宿 卧室', ratio: 'portrait', count: 1 })[0].id === 'hotel-01')
check('只说题材：题材里都能选（奶茶本身也是某张的标签）', searchPhotos(index, { query: '奶茶', count: 8 }).length === 2)
{
  const en = {
    format: 1, package: 'x', version: '1.0.0',
    themes: { food: { label: '餐饮', words: ['meal', 'food'] }, fit: { label: '健身', words: ['gym'] }, edu: { label: '教育', words: ['school'] } },
    photos: [photo('fit-08', 'fit', 1000, 1000, ['meal prep']), photo('food-01', 'food', 1000, 1000, ['burger']), photo('edu-04', 'edu', 1000, 1000, ['art']), photo('edu-05', 'edu', 1000, 1000, ['latte art'])],
  }
  check('英文短语优先：「meal prep」不算「meal」', ids(searchPhotos(en, { query: 'meal prep', count: 3 })) === 'fit-08')
  check('英文短语优先：「latte art」不算「art」', ids(searchPhotos(en, { query: 'latte art', count: 3 })) === 'edu-05')
}
{
  const mix = {
    format: 1, package: 'x', version: '1.0.0', generic: ['特写', '内景', 'product', 'close up'],
    themes: { drink: { label: '茶', words: ['咖啡', 'milk tea', 'coffee'] }, scene: { label: '风景', words: ['户外', 'outdoor'] }, fit: { label: '健身', words: ['健身'] }, inn: { label: '民宿', words: ['民宿'] } },
    photos: [
      photo('drink-01', 'drink', 1000, 1000, ['特写', '柠檬茶']), photo('drink-02', 'drink', 1000, 1000, ['拉花']),
      photo('scene-01', 'scene', 1000, 1000, ['古镇']), photo('fit-01', 'fit', 1000, 1000, ['跑步', '户外', 'running']),
      photo('inn-01', 'inn', 1000, 1000, ['tea', '内景', '咖啡']),
    ],
  }
  check('英文短语复数也认：「milk teas」不串到 tea', searchPhotos(mix, { query: 'milk teas', count: 8 }).every((p) => p.theme === 'drink'))
  check('准确的画面不会被题材词挡掉：「户外跑步」', ids(searchPhotos(mix, { query: '户外跑步', count: 3 })) === 'fit-01' && ids(searchPhotos(mix, { query: 'outdoor running', count: 3 })) === 'fit-01')
  check('只有通用修饰词 → 不算找到：「汽车 内景」', searchPhotos(mix, { query: '汽车 内景' }).length === 0 && searchPhotos(mix, { query: 'car product close up' }).length === 0)
  check('「咖啡 特写」：只算题材，特写的排前面，并如实说明', searchPhotos(mix, { query: '咖啡 特写', count: 1 })[0].id === 'drink-01' && onlyByTheme(mix, { query: '咖啡 特写' }))
  check('题材词出现在别的题材标签里不算画面：「咖啡」仍是咖啡题材', searchPhotos(mix, { query: '咖啡', count: 8 }).every((p) => p.theme === 'drink'))
}
check('只对上题材时如实说明；对上具体画面不说', onlyByTheme(index, { query: '民宿 游泳池' }) && !onlyByTheme(index, { query: '民宿 卧室' }) && !onlyByTheme(index, { query: '火箭' }))
check('张数封顶 8、最少 1', searchPhotos(index, { query: 'hotel', count: 99 }).length === 4 && searchPhotos(index, { query: 'hotel', count: 0 }).length === 3 && searchPhotos(index, { query: 'hotel', count: -5 }).length === 1)
check('同一套设计结果稳定', ids(searchPhotos(index, { query: 'hotel', seed: '/a' })) === ids(searchPhotos(index, { query: 'hotel', seed: '/a' })))
{
  const seen = new Set()
  for (let i = 0; i < 20; i++) seen.add(ids(searchPhotos(index, { query: 'hotel', count: 1, seed: `/d${i}` })))
  check('不同设计不总是同一张', seen.size > 1)
}

// ── 下载、核对、放进目录 ──
function fakeMarket(files, calls) {
  return {
    fetchPackage: async (name, version, opt) => {
      calls.push([name, version])
      if (files instanceof Error) throw files
      return opt.check(files)
    },
  }
}
const allFiles = () => index.photos.map((p) => ({ path: `photos/${p.id}.jpg`, data: jpg(p.id) }))

{
  const calls = []
  const cacheDir = path.join(tmp, 'c1')
  const ph = createPhotos({ market: fakeMarket(allFiles(), calls), index, cacheDir })
  check('没下过 → 没准备好', !ph.ready())
  await Promise.all([ph.ensure(), ph.ensure()])
  check('并发只下一次', calls.length === 1, JSON.stringify(calls))
  check('下的是钉死的版本', calls[0][0] === 'dsh-design-photos' && calls[0][1] === '1.0.0')
  check('下完就准备好了', ph.ready())
  await ph.ensure()
  check('下过了不再下', calls.length === 1)

  const dir = path.join(tmp, 'design')
  fs.mkdirSync(dir)
  const picks = [index.photos[0], index.photos[1]]
  const out = ph.place(dir, picks)
  check('复制进 assets，带 ai-photo- 前缀', out[0].rel === 'assets/ai-photo-hotel-01.jpg' && fs.existsSync(path.join(dir, out[0].rel)))
  check('内容一字不差', fs.readFileSync(path.join(dir, out[1].rel)).equals(jpg('hotel-02')))
  check('认得出用过哪几张', [...usedPhotos(dir, index)].sort().join() === 'hotel-01,hotel-02')
  check('认得出 AI 示意图的文件名', isPhotoAsset('a/assets/ai-photo-hotel-01.jpg') && !isPhotoAsset('assets/me.jpg'))

  fs.writeFileSync(path.join(dir, 'assets/ai-photo-hotel-01.jpg'), 'my real photo')
  ph.place(dir, picks)
  check('同名文件不覆盖（用户可能换成了真照片）', fs.readFileSync(path.join(dir, 'assets/ai-photo-hotel-01.jpg'), 'utf8') === 'my real photo')

  fs.writeFileSync(path.join(cacheDir, '1.0.0', 'hotel-03.jpg'), jpg('xxxxxxxx'))
  let code = ''
  try { ph.place(dir, [index.photos[2]]) } catch (e) { code = e.code }
  check('缓存里的图被改过 → 不复制', code === 'mismatch', code)
  check('…目标目录里也没留下', !fs.existsSync(path.join(dir, 'assets/ai-photo-hotel-03.jpg')))
  check('…坏图从缓存删掉', !fs.existsSync(path.join(cacheDir, '1.0.0', 'hotel-03.jpg')) && !ph.ready())
  {
    const before = calls.length
    fs.writeFileSync(path.join(cacheDir, '1.0.0', 'hotel-04.jpg'), Buffer.alloc(jpg('hotel-04').length, 7))
    const d3 = path.join(tmp, 'design3')
    fs.mkdirSync(d3)
    const r = await ph.provide({ dir: d3, pick: () => [index.photos[3]] })
    check('同大小的坏缓存：重新下一次就好了', r.length === 1 && fs.readFileSync(path.join(d3, r[0].rel)).equals(jpg('hotel-04')) && calls.length === before + 1, String(calls.length - before))
  }
  {
    const d4 = path.join(tmp, 'design4')
    const [a, b] = await Promise.all(['x', 'y'].map(() => ph.provide({ dir: d4, pick: (used) => searchPhotos(index, { query: 'hotel', count: 2, used, seed: d4 }) })))
    check('同一目录并发找图不会选到同一批', a.concat(b).length === 4 && new Set(a.concat(b).map((x) => x.p.id)).size === 4, ids(a.concat(b).map((x) => x.p)))
  }
  {
    const inside = path.join(tmp, 'inside')
    const away = path.join(tmp, 'away')
    fs.mkdirSync(inside)
    fs.mkdirSync(away)
    fs.symlinkSync(away, path.join(inside, 'late'), process.platform === 'win32' ? 'junction' : undefined)
    let c = ''
    try { await ph.provide({ dir: path.join(inside, 'late'), allowed: (p) => p === inside || p.startsWith(inside + path.sep), pick: () => [index.photos[0]] }) } catch (e) { c = e.code }
    check('下载期间目录被换成指向外面：写之前再核对，不写', c === 'link' && !fs.readdirSync(away).length, c)
    let c2 = ''
    try { await ph.provide({ dir: path.join(away, 'new', 'deep'), allowed: (p) => p === inside, pick: () => [index.photos[0]] }) } catch (e) { c2 = e.code }
    check('…不在允许范围的目录，连空文件夹也不建', c2 === 'link' && !fs.existsSync(path.join(away, 'new')), c2)
  }

  if (process.platform !== 'win32') {
    const d2 = path.join(tmp, 'design2')
    fs.mkdirSync(d2)
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(d2, 'assets'))
    code = ''
    try { ph.place(d2, [index.photos[3]]) } catch (e) { code = e.code }
    check('assets 指到外面 → 不写', code === 'link' && !fs.readdirSync(outside).length, code)
  }
}
{
  const calls = []
  const bad = allFiles()
  bad[2].data = Buffer.from('swapped')
  const ph = createPhotos({ market: fakeMarket(bad, calls), index, cacheDir: path.join(tmp, 'c2') })
  let code = ''
  try { await ph.ensure() } catch (e) { code = e.code }
  check('有一张哈希不对 → 整包不要', code === 'mismatch' && !ph.ready(), code)
  check('…一张都没写进缓存', !fs.existsSync(path.join(tmp, 'c2', '1.0.0')))
}
{
  const calls = []
  let t = 1000
  const err = Object.assign(new Error('net'), { code: 'timeout' })
  const ph = createPhotos({ market: fakeMarket(err, calls), index, cacheDir: path.join(tmp, 'c3'), now: () => t })
  await ph.ensure().catch(() => {})
  await ph.ensure().catch(() => {})
  check('下载失败后一分钟内不再试', calls.length === 1, String(calls.length))
  t += 61e3
  await ph.ensure().catch(() => {})
  check('过一分钟可以再试', calls.length === 2, String(calls.length))
}
{
  fs.mkdirSync(path.join(tmp, 'c4', '0.9.0'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'c4', '0.9.0', 'x.jpg'), 'old')
  fs.mkdirSync(path.join(tmp, 'c4', '2.0.0'), { recursive: true })
  const ph = createPhotos({ market: fakeMarket(allFiles(), []), index, cacheDir: path.join(tmp, 'c4') })
  await ph.ensure()
  check('旧版本的图清掉', !fs.existsSync(path.join(tmp, 'c4', '0.9.0')) && fs.existsSync(path.join(tmp, 'c4', '1.0.0')))
  check('更新的版本不动（可能是另一个配置里更新的插件下的）', fs.existsSync(path.join(tmp, 'c4', '2.0.0')))
}

// ── 钉住目录边界：之后根目录被换成软链，边界不跟着变 ──
if (process.platform !== 'win32') {
  const base = path.join(tmp, 'pin')
  const inner = path.join(base, 'root')
  const out2 = path.join(base, 'out')
  fs.mkdirSync(inner, { recursive: true })
  fs.mkdirSync(out2)
  const allow = pinRoots([inner, ''])
  check('边界：里面可以', allow(path.join(inner, 'x')))
  fs.rmSync(inner, { recursive: true })
  fs.symlinkSync(out2, inner)
  check('边界：根目录换成软链后，外面仍然不行', !allow(out2))
}

// ── 分享：没用上的库图不打包，用上的（大小写、转义都算）照常带 ──
{
  const d = path.join(tmp, 'share')
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true })
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
  for (const n of ['a', 'b', 'c', 'd', 'e']) fs.writeFileSync(path.join(d, `assets/ai-photo-${n}.jpg`), jpeg)
  fs.writeFileSync(path.join(d, 'home.html'), '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>首页</title><style>.x{background:url(assets/ai-photo-c.jpg)}</style></head><body class="x"><h1>一个页面</h1><img src="assets/ai-photo-a.jpg" alt="a"><img src="assets/%61i-photo-d.jpg" alt="d"><!-- <img src="assets/ai-photo-b.jpg"> --><a href="assets/AI-Photo-e.jpg">大图</a></body></html>')
  fs.writeFileSync(path.join(d, 'design.json'), JSON.stringify({ assets: [{ path: 'assets/ai-photo-a.jpg', source: 'self' }, { path: 'assets/ai-photo-b.jpg', source: 'self' }] }))
  const r = packDesign(d, { screens: ['home.html'], version: '1.0.0', title: 't', description: 'd' })
  const names = r.files.map((f) => f.path).filter((p) => p.includes('photo')).sort().join()
  check('分享只带页面真用到的库图（注释里的不算，转义的算，CSS 里的算）', names === 'assets/ai-photo-a.jpg,assets/ai-photo-c.jpg,assets/ai-photo-d.jpg,assets/ai-photo-e.jpg', names)
  check('…清单里也去掉没带的图', r.manifest.assets.length === 1 && r.manifest.assets[0].path === 'assets/ai-photo-a.jpg', JSON.stringify(r.manifest.assets))
  check('…带了几张就提醒几张', r.notes.filter((n) => n.code === 'aiPhoto').length === 4, JSON.stringify(r.notes))
  check('…没有因此报缺文件', !r.errors.some((e) => e.code === 'missing'), JSON.stringify(r.errors.map((e) => e.code)))
}

// ── 真的 market.fetchPackage：抢着下、坏源算失败、不联网 ──
function header(name, size) {
  const h = Buffer.alloc(512)
  h.write(name, 0, 'utf8')
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124)
  h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156)
  h.write('ustar\0', 257); h.write('00', 263)
  let s = 0
  for (const b of h) s += b
  h.write(s.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}
function tgz(files) {
  const parts = []
  for (const f of files) parts.push(header('package/' + f.path, f.data.length), f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512))
  parts.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(parts))
}
function site(files) {
  const buf = tgz(files)
  const doc = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/-/p.tgz', integrity: 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64') } } } }
  return async (u) => new Response(u.endsWith('.tgz') ? buf : JSON.stringify(doc), { status: 200 })
}
{
  let online = true
  const hit = []
  const good = site(allFiles())
  const market = createMarket({
    cacheDir: path.join(tmp, 'mk'), stateDir: path.join(tmp, 'mk-s'), registries: ['https://registry.npmjs.org'], keys: ['x'], online: () => online,
    fetch: (u, o) => { hit.push(u); return good(u, o) },
  })
  const ph = createPhotos({ market, index, cacheDir: path.join(tmp, 'c5') })
  await ph.ensure()
  check('走 npm 取回、解包、核对、写缓存', ph.ready() && hit.some((u) => u.endsWith('/dsh-design-photos')), hit.join())

  online = false
  hit.length = 0
  const ph2 = createPhotos({ market, index, cacheDir: path.join(tmp, 'c6') })
  let code = ''
  try { await ph2.ensure() } catch (e) { code = e.code }
  check('不联网开着 → 一个网址都不访问', code === 'off' && hit.length === 0, code)
  // 第一个源失败、第二个下着时开了开关：错误被合并也算开关挡的，不进冷却
  {
    let on = true
    const m2 = createMarket({
      cacheDir: path.join(tmp, 'mk2'), stateDir: path.join(tmp, 'mk2-s'), registries: ['https://registry.npmjs.org', 'https://registry.npmmirror.com'], keys: ['x'], online: () => on,
      fetch: async (u) => { if (u.includes('npmjs')) return new Response('', { status: 503 }); on = false; return new Response('', { status: 500 }) },
    })
    const ph3 = createPhotos({ market: m2, index, cacheDir: path.join(tmp, 'c7') })
    let c3 = ''
    try { await ph3.ensure() } catch (e) { c3 = e.code }
    check('混合失败期间开了不联网 → 按开关算', c3 === 'off', c3)
  }
  online = true
  await ph2.ensure()
  check('关掉开关马上能下（不被一分钟冷却挡住）', ph2.ready())
}

// ── 目录文件（发版前必须有，且图都登记全）──
{
  const real = loadPhotoIndex()
  check('随插件发的目录读得出来', !!real && real.photos.length > 0)
  if (real) {
    check('每张都有中英文替代文字', real.photos.every((p) => p.alt && p.altEn))
    check('编号不重复', new Set(real.photos.map((p) => p.id)).size === real.photos.length)
    check('每个题材都有图', Object.keys(real.themes).every((k) => real.photos.some((p) => p.theme === k)))
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
