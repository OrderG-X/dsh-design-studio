/**
 * 设计库第二步「本地设计库」：zip 读写（防越界、防炸弹）、打包前规范化和预检、拖 zip 落地、作品库、灵感
 *   node test/test-gallery-library.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { writeZip, readZip, crc32 } from '../lib/gallery/zip.js'
import { packDesign, zipOf, stripMeta, splitTitle, buildManifest } from '../lib/gallery/pack.js'
import { imageMeta, localPathIn, checkPack, checkMarkup, inlineData, textFlags } from '../lib/gallery/policy.js'
import { visibleText } from '../lib/gallery/html.js'
import { preparePack, installPack, slugOf, baseFor } from '../lib/gallery/use.js'
import { createLibrary, sha256 } from '../lib/works.js'
import { createInspiration } from '../lib/inspire.js'
import { describeWork, createLibraryRoutes, shareHashOf } from '../lib/gallery/routes.js'
import { listScreens } from '../lib/core.js'
import { GhError } from '../lib/gallery/submit.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const throwsCode = (fn, code) => { try { fn(); return false } catch (e) { return e.code === code } }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-lib-')))

// ── zip ──
check('crc32 对得上', crc32(Buffer.from('hello')) === 0x3610a686)
const z = writeZip([{ path: 'design.json', data: '{}' }, { path: '首页.html', data: '<p>你好</p>' }, { path: 'assets/a.png', data: Buffer.from([1, 2, 3]) }])
const back = readZip(z)
check('zip：写了能读回来（中文文件名、子目录）', back.files.length === 3 && back.files[1].path === '首页.html' && back.files[1].data.toString() === '<p>你好</p>' && back.files[2].data.length === 3)

/** 手搓一个 zip（可指定方法、属性、名字），测坏包 */
function rawZip(entries) {
  const locals = []
  const cds = []
  let off = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags || 0x800, 6); lh.writeUInt16LE(e.method || 0, 8)
    lh.writeUInt32LE(crc32(e.data), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(e.usize ?? e.data.length, 22); lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.made ?? 0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags || 0x800, 8); ch.writeUInt16LE(e.method || 0, 10)
    ch.writeUInt32LE(crc32(e.data), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(e.usize ?? e.data.length, 24); ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42)
    cds.push(ch, name)
    off += 30 + name.length + data.length
  }
  const cd = Buffer.concat(cds)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
const one = (o) => rawZip([{ name: 'a.html', data: Buffer.from('x'), ...o }])
check('zip：../ 越界拒收', throwsCode(() => readZip(one({ name: '../evil.html' })), 'path'))
check('zip：绝对路径拒收', throwsCode(() => readZip(one({ name: '/etc/x.html' })), 'path'))
check('zip：反斜杠拒收', throwsCode(() => readZip(one({ name: '..\\x.html' })), 'path'))
check('zip：软链接拒收', throwsCode(() => readZip(one({ name: 'link.html', mode: 0o120777 })), 'link'))
check('zip：加密拒收', throwsCode(() => readZip(one({ flags: 0x801 })), 'crypt'))
check('zip：不认识的压缩方法拒收', throwsCode(() => readZip(one({ method: 12 })), 'method'))
check('zip：deflate 能解', readZip(one({ method: 8, data: Buffer.from('<p>压缩</p>') })).files[0].data.toString() === '<p>压缩</p>')
const bomb = Buffer.alloc(20 * 1024 * 1024)
check('zip：压缩炸弹（声明小、实际大）拒收', throwsCode(() => readZip(rawZip([{ name: 'a.html', data: bomb, method: 8, usize: 100 }])), 'big'))
check('zip：重名（大小写不同）拒收', throwsCode(() => readZip(rawZip([{ name: 'A.html', data: Buffer.from('1') }, { name: 'a.html', data: Buffer.from('2') }])), 'dup'))
check('zip：坏文件拒收', throwsCode(() => readZip(Buffer.from('not a zip at all, sorry, not a zip')), 'bad'))
const wrapped = readZip(rawZip([{ name: '晨光咖啡/design.json', data: Buffer.from('{}') }, { name: '晨光咖啡/home.html', data: Buffer.from('h') }, { name: '__MACOSX/晨光咖啡/._home.html', data: Buffer.from('junk') }, { name: '晨光咖啡/.DS_Store', data: Buffer.from('junk') }]))
check('zip：外面套的一层文件夹去掉，Mac 垃圾文件跳过', wrapped.files.map((f) => f.path).join(',') === 'design.json,home.html' && wrapped.wrapper === '晨光咖啡')

// ── 打包：规范化、预检 ──
const page = (screen, body, extra = '') => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="dsh-design" content="app"><title>${screen} · 晨光咖啡</title><link rel="stylesheet" href="tokens.css">${extra}</head><body>${body}</body></html>`
const des = path.join(tmp, 'coffee')
fs.mkdirSync(path.join(des, 'refs'), { recursive: true })
fs.mkdirSync(path.join(des, 'assets'))
fs.writeFileSync(path.join(des, 'tokens.css'), ':root{--bg:#fff;--primary:#6b4f3a}')
fs.writeFileSync(path.join(des, 'home.html'), page('首页', '<!-- 模型的备注 --><h1>晨光咖啡</h1><a href="https://example.com/x">官网</a><img src="assets/cup.jpg" alt="">'))
fs.writeFileSync(path.join(des, 'menu.html'), page('菜单', '<p>拿铁 ¥28</p>'))
fs.writeFileSync(path.join(des, '_probe.html'), '<script>probe</script>')
fs.writeFileSync(path.join(des, 'refs', 'photo.png'), 'not really')
fs.writeFileSync(path.join(des, 'notes.txt'), 'scratch')
// 带 EXIF 的 JPEG：SOI + APP1(Exif) + 一个 SOF0 + SOS
const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x12]), Buffer.from('Exif\0\0GPS-SECRET')])
const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9])])
fs.writeFileSync(path.join(des, 'assets', 'cup.jpg'), jpg)
check('去拍摄信息：JPEG 的 EXIF 去掉，图像数据留着', !stripMeta(jpg, 'jpg').includes(Buffer.from('GPS-SECRET')) && stripMeta(jpg, 'jpg').includes(sof))
check('标题拆屏名和产品名', splitTitle('首页 · 晨光咖啡').product === '晨光咖啡' && splitTitle('Home | Pedal').screen === 'Home')

const screens = listScreens(des)
const p1 = packDesign(des, { screens, version: '0.11.0' })
const names = p1.files.map((f) => f.path).sort().join(',')
check('打包：只要设计文件（不要 refs/、_ 草稿、txt）', names === 'assets/cup.jpg,design.json,home.html,menu.html,tokens.css', names)
check('打包：自动生成清单（产品名、类型、屏名、CC0、AI 标）', p1.manifest.title.zh === '晨光咖啡' && p1.manifest.kind === 'app' && p1.manifest.screens.map((s) => s.title.zh).join() === '首页,菜单' && p1.manifest.license === 'CC0-1.0' && p1.manifest.ai.tool === 'dsh-design-studio@0.11.0')
const home = p1.files.find((f) => f.path === 'home.html').data.toString()
check('打包：注释去掉、站外链接改成 #', !home.includes('模型的备注') && !home.includes('example.com') && p1.notes.some((n) => n.code === 'comment'))
check('打包：图片拍摄信息去掉', !p1.files.find((f) => f.path === 'assets/cup.jpg').data.includes(Buffer.from('GPS-SECRET')))
check('打包：干净的设计能过', p1.ok, JSON.stringify(p1.errors.slice(0, 3)))
check('打包：跳过的文件报出来', p1.skipped.includes('notes.txt'))

fs.writeFileSync(path.join(des, 'menu.html'), page('菜单', '<p>店长 13916827450</p><script>alert(1)</script>'))
const p2 = packDesign(des, { screens })
check('打包：真手机号、脚本拦下，每条带怎么改', !p2.ok && p2.errors.some((e) => e.code === 'phone' && /假号/.test(e.msg)) && p2.errors.some((e) => e.code === 'tag' && e.x === 'menu.html'), JSON.stringify(p2.errors.map((e) => e.code)))
fs.writeFileSync(path.join(des, 'menu.html'), page('菜单', '<p>拿铁 ¥28</p>'))

// 屏多的设计（#12）：自己打 zip 到 60 屏都行，分享到市场还是最多 24 屏
{
  const big = path.join(tmp, 'sixty')
  fs.mkdirSync(big)
  fs.copyFileSync(path.join(des, 'tokens.css'), path.join(big, 'tokens.css'))
  for (let i = 1; i <= 60; i++) fs.writeFileSync(path.join(big, `s${i}.html`), page(`第 ${i} 屏`, '<p>x</p>'))
  const z = packDesign(big, { screens: listScreens(big), mode: 'zip' })
  check('60 屏：自己打 zip 能过（60 个 HTML + 清单）', z.ok && z.manifest.screens.length === 60, JSON.stringify(z.errors.slice(0, 3)))
  const sh = packDesign(big, { screens: listScreens(big), mode: 'share', description: '六十屏的设计' })
  check('60 屏：分享到市场拦下', !sh.ok && sh.errors.some((e) => e.x === 'screens' || e.code === 'count'), JSON.stringify(sh.errors.slice(0, 3)))
}

// ── 分享包隐私：别的 JSON 不打包；所有文字查个人信息、本机路径、分享记号；WebP / GIF 去信息，AVIF 带信息拦 ──
{
  const pv = path.join(tmp, 'privacy')
  fs.cpSync(des, pv, { recursive: true })
  const tok = 'c0ffee'.repeat(5) + 'ab'
  fs.writeFileSync(path.join(pv, 'settings.json'), JSON.stringify({ email: 'zhangsan@qq.com', home: '/Users/zhangsan/Desktop', shareToken: tok }))
  const q1 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏', secrets: [tok] })
  check('隐私：别的 JSON（设置、记录）不打包', !q1.files.some((f) => f.path === 'settings.json') && q1.skipped.includes('settings.json') && q1.ok, JSON.stringify(q1.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'tweaks.json'), JSON.stringify({ note: '有问题找 zhangsan@qq.com' }))
  fs.writeFileSync(path.join(pv, 'tokens.css'), `/* 从 /Users/zhangsan/Downloads/brand.css 抄的；${tok} */\n:root{--bg:#fff}`)
  const q2 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏', secrets: [tok] })
  const codes = q2.errors.map((e) => `${e.code}:${e.x}`)
  check('隐私：留下的 JSON、CSS 注释也查个人邮箱', codes.includes('email:tweaks.json'), codes.join())
  check('隐私：本机路径拦下（带出电脑用户名）', codes.includes('localPath:tokens.css') && q2.errors.find((e) => e.code === 'localPath').msg.includes('本机路径'), codes.join())
  check('隐私：分享记号出现在包里任何文件都拦', codes.includes('secret:tokens.css'), codes.join())
  const z = packDesign(pv, { screens: listScreens(pv), mode: 'zip', secrets: [tok] })
  check('隐私：打 zip 给别人也拦', !z.ok && z.errors.some((e) => e.code === 'localPath'))
  fs.rmSync(path.join(pv, 'tweaks.json'))
  fs.writeFileSync(path.join(pv, 'tokens.css'), ':root{--bg:#fff}')
  // WebP：VP8X（标着有 EXIF）+ EXIF 块 + 图像块
  const chunk = (t, d) => { const h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32LE(d.length, 4); return Buffer.concat([h, d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]) }
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04; vp8x.writeUIntLE(15, 4, 3); vp8x.writeUIntLE(15, 7, 3)
  const webpBody = Buffer.concat([chunk('VP8X', vp8x), chunk('EXIF', Buffer.from('Exif\0\0GPS-SECRET')), chunk('XMP ', Buffer.from('<x:xmpmeta>who</x:xmpmeta>')), chunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0]))])
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), webpBody]); webp.writeUInt32LE(webp.length - 8, 4)
  const w2 = stripMeta(webp, 'webp')
  check('去拍摄信息：WebP 的 EXIF / XMP 块去掉，标记清掉，长度对', !w2.includes(Buffer.from('GPS-SECRET')) && !w2.includes(Buffer.from('xmpmeta')) && (w2[20] & 0x0c) === 0 && w2.readUInt32LE(4) === w2.length - 8 && imageMeta(webp, 'webp') && !imageMeta(w2, 'webp'))
  // GIF：注释块
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0]), Buffer.from([0x21, 0xfe, 10]), Buffer.from('GPS-SECRET'), Buffer.from([0]), Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b])])
  const g2 = stripMeta(gif, 'gif')
  check('去拍摄信息：GIF 的注释块去掉，图像留着', !g2.includes(Buffer.from('GPS-SECRET')) && g2[g2.length - 1] === 0x3b && g2.includes(Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0])) && imageMeta(gif, 'gif') && !imageMeta(g2, 'gif'))
  fs.writeFileSync(path.join(pv, 'assets', 'a.webp'), webp)
  fs.writeFileSync(path.join(pv, 'assets', 'b.gif'), gif)
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><img src="assets/cup.jpg" alt=""><img src="assets/a.webp" alt=""><img src="assets/b.gif" alt="">'))
  const q3 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('打包：WebP / GIF 自动去信息后能过', q3.ok && !q3.files.find((f) => f.path === 'assets/a.webp').data.includes(Buffer.from('GPS-SECRET')), JSON.stringify(q3.errors.map((e) => e.code)))
  const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypavif'), Buffer.alloc(8), Buffer.from('Exif\0\0MM')])
  fs.writeFileSync(path.join(pv, 'assets', 'c.avif'), avif)
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><img src="assets/c.avif" alt="">'))
  const q4 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：AVIF 带着拍摄信息（不会自动去）：拦下说换格式', !q4.ok && q4.errors.some((e) => e.code === 'imgMeta' && e.x === 'assets/c.avif'), JSON.stringify(q4.errors.map((e) => e.code)))
  // CSS 引号里的字（content: "…"）也会发出去；内嵌图片（data:image）也要去信息
  fs.rmSync(path.join(pv, 'assets', 'c.avif'))
  fs.writeFileSync(path.join(pv, 'tokens.css'), ':root{--bg:#fff} .tel::after{content:"店长 139 1682 7450"} .i{background:url("img@2x.png")}')
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1>'))
  const q5 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：CSS content 里的手机号拦下', !q5.ok && q5.errors.some((e) => e.code === 'phone' && e.x === 'tokens.css'), JSON.stringify(q5.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'tokens.css'), `:root{--bg:#fff} .hero{background:url(data:image/jpeg;base64,${jpg.toString('base64')})}`)
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1><img src="data:image/jpeg;base64,${jpg.toString('base64')}" alt="">`))
  const q6 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  const inl = q6.files.filter((f) => f.path === 'home.html' || f.path === 'tokens.css').map((f) => f.data.toString())
  check('打包：网页、样式里内嵌的 JPEG 也去掉拍摄信息', q6.ok && inl.length === 2 && inl.every((t) => t.includes('data:image/jpeg;base64,') && !Buffer.from(t.split('base64,')[1].split(/["')]/)[0], 'base64').includes(Buffer.from('GPS-SECRET'))) && q6.notes.some((n) => n.code === 'exif' && n.x === 'home.html'), JSON.stringify(q6.errors.map((e) => e.code)))
  const raw = checkPack([{ path: 'design.json', data: Buffer.from(JSON.stringify(q6.manifest)) }, { path: 'home.html', data: Buffer.from(page('首页', `<img src="data:image/jpeg;base64,${jpg.toString('base64')}" alt="">`)) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }], { mode: 'ci' })
  check('投稿检查：没去信息的内嵌图片拦下', raw.errors.some((e) => e.code === 'imgMetaInline' && e.x === 'home.html'), JSON.stringify(raw.errors.map((e) => e.code)))
  // 网页自己的 <style> 里的字也查；内嵌图片的 base64 中间夹换行 / 实体（浏览器照样能显示）：查得出、拦下（不去改它，免得改坏）
  fs.writeFileSync(path.join(pv, 'tokens.css'), ':root{--bg:#fff}')
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<style>.tel::after{content:"店长 139 1682 7450"}</style><h1>晨光咖啡</h1>'))
  const q7 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：网页 <style> 里的手机号拦下', !q7.ok && q7.errors.some((e) => e.code === 'phone' && e.x === 'home.html'), JSON.stringify(q7.errors.map((e) => e.code)))
  const chunkP = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, 'latin1'); return Buffer.concat([h, d, Buffer.alloc(4)]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  const pngMeta = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkP('IHDR', ihdr), chunkP('tEXt', Buffer.from('Author\0zhangsan GPS-SECRET')), chunkP('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00])), chunkP('IEND', Buffer.alloc(0))])
  const b64 = pngMeta.toString('base64')
  const split = (sep) => b64.slice(0, 20) + sep + b64.slice(20)
  for (const [name, html] of [
    ['换行', `<img src="data:image/png;base64,${split('\n')}" alt="">`],
    ['&#10;', `<img src="data:image/png;base64,${split('&#10;')}" alt="">`],
    ['百分号', `<img src="data:image/png;base64,${split('%0A')}" alt="">`],
    ['style 属性', `<div style="background:url('data:image/png;base64,${split('\\\n')}')"></div>`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：内嵌图片 base64 夹${name}：查出拍摄信息、拦下`, !q.ok && q.errors.some((e) => e.code === 'imgMetaInline' && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 不带 base64 的百分号写法（浏览器照样显示）：查得出；标准连续写法打包时自动去掉信息
  const pct = [...pngMeta].map((b) => '%' + b.toString(16).padStart(2, '0')).join('')
  for (const [name, html] of [
    ['百分号原始字节（夹换行）', `<img src="data:image/png,${pct.slice(0, 30)}\n${pct.slice(30)}" alt="">`],
    ['百分号原始字节 + 参数', `<div style="background:url(&quot;data:image/png;charset=x,${pct.slice(0, 30)}&#9;${pct.slice(30)}&quot;)"></div>`],
    ['类型中间夹换行', `<img src="data:image/p\nng,${pct}" alt="">`],
    ['data 中间夹 &#10;', `<img src="da&#10;ta:image/png;base64,${b64}" alt="">`],
    ['写错类型（PNG 写成 webp，夹换行）', `<img src="data:image/webp;base64,${split('\n')}" alt="">`],
    ['写错类型（PNG 写成 webp，百分号，夹换行）', `<img src="data:image/webp,${pct.slice(0, 30)}\n${pct.slice(30)}" alt="">`],
    ['不是图片类型（octet-stream）', `<img src="data:application/octet-stream;base64,${b64}" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：内嵌图片${name}：查出拍摄信息、拦下`, !q.ok && q.errors.some((e) => e.code === 'imgMetaInline' && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1><img src="data:image/png,${pct}" alt="">`))
  const qp = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  const qpHtml = qp.ok ? qp.files.find((f) => f.path === 'home.html').data.toString() : ''
  check('打包：百分号写法的内嵌 PNG 改写成 base64 并去掉文字块', qp.ok && !qpHtml.includes(pct) && /data:image\/png;base64,/.test(qpHtml) && !Buffer.from(qpHtml.split('base64,')[1].split('"')[0], 'base64').includes(Buffer.from('GPS-SECRET')), JSON.stringify(qp.errors.map((e) => e.code)))
  // 内嵌的 SVG（base64 / 百分号）：里面的邮箱、本机路径和单独的 .svg 一样拦
  const svgPriv = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><metadata>Author: someone@example.net; source: /Users/someone/private/a.svg</metadata><rect width="40" height="40" fill="red"/></svg>'
  for (const [name, html] of [
    ['SVG base64', `<img src="data:image/svg+xml;base64,${Buffer.from(svgPriv).toString('base64')}" alt="">`],
    ['SVG 百分号', `<img src="data:image/svg+xml,${encodeURIComponent(svgPriv)}" alt="">`],
    ['SVG 写成 text/plain', `<div style="background:url('data:text/plain;base64,${Buffer.from(svgPriv).toString('base64')}')"></div>`],
    ['SVG 里再内嵌带信息的 PNG', `<img src="data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${b64}"/></svg>`).toString('base64')}" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：内嵌 ${name}：里面的个人信息 / 拍摄信息拦下`, !q.ok && q.errors.some((e) => ['email', 'localPath', 'imgMetaInline'].includes(e.code) && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1><i style="background:url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')}')"></i>`))
  const qsv = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('内嵌的普通 SVG 图标照样能过', qsv.ok, JSON.stringify(qsv.errors.map((e) => e.code)))
  // 内嵌图片太多（查不完）：拦下，不能当查过了
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const many = Array.from({ length: 2001 }, (_, i) => { const b = Buffer.alloc(8); b.writeUInt32BE(i); return `<img src="data:image/png;base64,${Buffer.concat([sig, b]).toString('base64')}" alt="">` }).join('')
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${many}`))
  const qm = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：内嵌图片超过上限 → 拦下（不当查完了）', !qm.ok && qm.errors.some((e) => e.code === 'inlineMany'), JSON.stringify(qm.errors.map((e) => e.code)))
  for (const [name, html] of [
    ['写错类型的 base64', `<img src="data:image/webp;base64,${b64}" alt="">`],
    ['写错类型的百分号', `<img src="data:image/webp,${pct}" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    const out = q.ok ? q.files.find((f) => f.path === 'home.html').data.toString() : ''
    check(`打包：${name}（按字节认出是 PNG）也去掉文字块`, q.ok && /base64,/.test(out) && !Buffer.from(out.split('base64,')[1].split('"')[0], 'base64').includes(Buffer.from('GPS-SECRET')), JSON.stringify(q.errors.map((e) => e.code)))
  }
  const rawPct = checkPack([{ path: 'design.json', data: Buffer.from(JSON.stringify(q6.manifest)) }, { path: 'home.html', data: Buffer.from(page('首页', `<img src="data:image/png,${pct}" alt="">`)) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }], { mode: 'ci' })
  check('投稿检查：百分号写法、没去信息的内嵌图片拦下', rawPct.errors.some((e) => e.code === 'imgMetaInline'), JSON.stringify(rawPct.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'tokens.css'), `.a{background:url( "data:image/png;base64,${split('\\\n')}" )}`)
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1>'))
  const q8 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：CSS 里续行写法的内嵌图片也查出', !q8.ok && q8.errors.some((e) => e.code === 'imgMetaInline' && e.x === 'tokens.css'), JSON.stringify(q8.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'tokens.css'), ':root{--bg:#fff}')
  // CSS 转义（\64 ata: 就是 data:，u\72l( 就是 url(）、前面塞很多字符串：照 CSS 规范分词，照样查出
  const filler = Array.from({ length: 2100 }, (_, i) => `.f${i}{content:"x${i}"}`).join('')
  for (const [name, file, body] of [
    ['style 属性里转义的 data:', 'home.html', `<div style="background:url('\\64 ata:image/png;base64,${b64}')"></div>`],
    ['style 属性里转义的 url( 和 data:', 'home.html', `<div style="background:u\\72l(\\64 ata:image/png;base64,${b64})"></div>`],
    ['CSS 里转义的 url( 和 data:', 'tokens.css', `.a{background:u\\72l(\\64 ata:image/png;base64,${b64})}`],
    ['CSS 先塞 2100 个字符串再放转义图片', 'tokens.css', `${filler}.a{background:url('\\64 ata:image/png;base64,${b64}')}`],
  ]) {
    fs.writeFileSync(path.join(pv, 'tokens.css'), file === 'tokens.css' ? body : ':root{--bg:#fff}')
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${file === 'home.html' ? body : ''}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name}：查出拍摄信息、拦下`, !q.ok && q.errors.some((e) => e.code === 'imgMetaInline' && e.x === file), JSON.stringify(q.errors.map((e) => e.code)))
  }
  fs.writeFileSync(path.join(pv, 'tokens.css'), `${filler}.z::after{content:"zhang.san1987@qq.com"}`)
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1>'))
  const qf = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('隐私：CSS 先塞 2100 个字符串，后面 content 里的邮箱照样拦', !qf.ok && qf.errors.some((e) => e.code === 'email' && e.x === 'tokens.css'), JSON.stringify(qf.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'tokens.css'), ':root{--bg:#fff}')
  // 内嵌 SVG 里再套内嵌 SVG、UTF-16 的 SVG、写成图片其实不是图片：查不准，拦下
  const innerSvg = Buffer.from(svgPriv).toString('base64')
  const nested = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><g style="fill:url('data:image/svg+xml;base64,${innerSvg}')"/><image href="data:image/svg+xml;base64,${innerSvg}" width="40" height="40"/></svg>`
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(svgPriv, 'utf16le')])
  for (const [name, html, code] of [
    ['SVG 里再套 SVG', `<img src="data:image/svg+xml;base64,${Buffer.from(nested).toString('base64')}" alt="">`, 'inlineNested'],
    ['UTF-16 的 SVG（带 BOM）', `<img src="data:image/svg+xml;base64,${u16.toString('base64')}" alt="">`, 'inlineEncoding'],
    ['SVG 写了 charset=utf-16', `<img src="data:image/svg+xml;charset=utf-16,${encodeURIComponent(svgPriv)}" alt="">`, 'inlineEncoding'],
    ['SVG 声明 encoding="ISO-8859-1"', `<img src="data:image/svg+xml,${encodeURIComponent('<?xml version="1.0" encoding="ISO-8859-1"?>' + svgPriv)}" alt="">`, 'inlineEncoding'],
    ['写成 PNG、内容是别的', `<img src="data:image/png;base64,${Buffer.from('Author: someone@example.net '.repeat(4)).toString('base64')}" alt="">`, 'inlineBad'],
    ['写成 AVIF、内容是别的', `<img src="data:image/avif;base64,${Buffer.from('Exif-free payload '.repeat(4)).toString('base64')}" alt="">`, 'inlineBad'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：内嵌${name} → 拦下（${code}）`, !q.ok && q.errors.some((e) => e.code === code && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 第六轮：<svg><title> 里的 <style>（浏览器当网页读、照样生效）、内嵌 SVG 用 XML 实体拼地址、内嵌 SVG 的注释
  const ent = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY p "da"><!ENTITY q "ta:image/svg+xml;base64,${innerSvg}">]><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="&p;&q;" width="40" height="40"/></svg>`
  for (const [name, html, code] of [
    ['<svg><title> 里的 <style> 用转义写的内嵌图片', `<svg width="0" height="0"><title><style>.x{background-image:u\\72l("\\64 ata:image/png;base64,${b64}")}</style></title></svg><div class="x"></div>`, 'imgMetaInline'],
    ['SVG 用 XML 实体拼出内层 SVG 地址', `<img src="data:image/svg+xml;base64,${Buffer.from(ent).toString('base64')}" alt="">`, 'inlineSvgBad'],
    ['SVG 注释里写着邮箱', `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><!-- by zhang.san1987@qq.com --><circle r="4"/></svg>')}" alt="">`, 'inlineSvgBad'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下（${code}）`, !q.ok && q.errors.some((e) => e.code === code && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  check('<svg><title> 里的 <style>：@import 照样查出来；title 里的字照样算看得见的', checkMarkup('<svg><title><style>@import url(x.css);</style></title></svg>', { file: 'a.html' }).some((p) => p.code === 'cssImport') && visibleText('<svg><title>晨光 zhang.san1987@qq.com</title></svg>').includes('zhang.san1987@qq.com'))
  let iconE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>'
  while (iconE.length % 3) iconE = iconE.replace('<circle', ' <circle')
  const iconB64Early = Buffer.from(iconE).toString('base64')
  // 第七轮：<style> 的结束要认准、<style/> 照样是样式、矢量图 <style> 里 CDATA 中的 </style> 不算结束；跳回网页读的文本框里的字照样查
  const escUrl = `u\\72l("\\64 ata:image/png;base64,${b64}")`
  for (const [name, html, code] of [
    ['<style> 里先写 /* </stylex> */', `<style>/* </stylex> */ .x{background-image:${escUrl}}</style><div class="x"></div>`, 'imgMetaInline'],
    ['<style/> 自闭合写法', `<style/>.x{background-image:${escUrl}}</style><div class="x"></div>`, 'imgMetaInline'],
    ['矢量图 <style> 里 CDATA 夹着 </style>', `<svg width="0" height="0"><style><![CDATA[ </style> ]]> .x{background-image:${escUrl}}</style></svg><div class="x"></div>`, 'imgMetaInline'],
    ['<math><mtext><textarea> 里的邮箱', '<math><mtext><textarea><style>zhang.san1987@qq.com</style></textarea></mtext></math>', 'email'],
    ['<svg><p><textarea> 里的邮箱', '<svg><p><textarea><style>zhang.san1987@qq.com</style></textarea></p></svg>', 'email'],
    ['<xmp> 里的邮箱', '<xmp>zhang.san1987@qq.com</xmp>', 'email'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下（${code}）`, !q.ok && q.errors.some((e) => e.code === code && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 第八轮：个人信息整份文件都查（读法切换怎么绕都一样）；同一地址先在普通属性、再在图片地址里：照样按图片的规矩查
  const nestOuter = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="data:image/svg+xml;base64,${innerSvg}" width="40" height="40"/></svg>`
  const nestUrl = `data:image/svg+xml;base64,${Buffer.from(nestOuter).toString('base64')}`
  for (const [name, html, codes] of [
    ['<math><style/><mtext><textarea> 里的邮箱', '<math><style/><mtext><textarea><style>zhang.san1987@qq.com</style></textarea></mtext></math>', ['email']],
    ['藏在属性里的个人邮箱', '<p hidden data-a="zhang.san1987@qq.com"></p>', ['email']],
    ['实体写的手机号', '<p data-x="&#49;3912340987"></p>', ['phone']],
    ['同一 SVG 地址先在普通属性里、再当图片', `<i data-cache="${nestUrl}"></i><img src="${nestUrl}" alt="">`, ['inlineNested', 'inlineSvgBad']],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下（${codes.join(' / ')}）`, !q.ok && q.errors.some((e) => codes.includes(e.code) && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 矢量图里的 <style/>（XML 里是空的）后面的文字、路径坐标凑出的长数字：不误报
  const svgSelf = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><style/><text x="0" y="20">We're open
Monday</text><path d="M139 2045 1234 L0 0"/></svg>`
  for (const [name, html] of [
    ['网页里内联 SVG 的 <style/>', svgSelf],
    ['data SVG 的 <style/>', `<img src="data:image/svg+xml;base64,${Buffer.from(svgSelf).toString('base64')}" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`${name}照样能过`, q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify(q6.manifest)) }
    const r = checkPack([man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1><img src="assets/s.svg" alt="">')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, { path: 'assets/s.svg', data: Buffer.from(svgSelf) }], { mode: 'ci' })
    check('单独的 .svg 里 <style/> 后面带撇号的文字：不误报', !r.errors.some((e) => e.x === 'assets/s.svg'), JSON.stringify(r.errors))
    // 一堆 <style/>：不会每个都读到底（卡住）；查不完就拦
    const t0 = Date.now()
    const heavy = page('首页', `<h1>晨光咖啡</h1>${'<style/>'.repeat(20000)}<p>x</p>`)
    const r2 = checkPack([man, { path: 'home.html', data: Buffer.from(heavy) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }], { mode: 'ci' })
    const heavySvg = `<svg xmlns="http://www.w3.org/2000/svg">${'<style/>'.repeat(20000)}</svg>`
    const r3 = checkPack([man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1><img src="assets/h.svg" alt="">')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, { path: 'assets/h.svg', data: Buffer.from(heavySvg) }], { mode: 'ci' })
    const ms = Date.now() - t0
    check('两万个 <style/>：很快查完（重叠的样式段不重复读）', ms < 6000 && !!r2 && !!r3, `${ms}ms ${JSON.stringify(r2.errors.map((e) => e.code).slice(0, 5))}`)
  }
  // 第九轮：不换行空格隔开的手机号要查出；透明度小数、类名里的长数字不误报；长编码不卡；几个带 <style/> 的图标不触发上限
  for (const [name, html] of [
    ['&nbsp; 隔开的手机号', '<p>联系店长：139&nbsp;1234&nbsp;7788</p>'],
    ['窄空格隔开的手机号', '<p>联系店长：139\u202f1234\u202f7788</p>'],
    ['+86 开头的手机号', '<p>Tel: +8613912347788</p>'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下`, !q.ok && q.errors.some((e) => e.code === 'phone' && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 第十轮：全角 / 小型横线、减号、全角数字隔开的手机号；省略号前的邮箱；样式段去重也看实体还原后的边界
  for (const [name, html, code] of [
    ['全角横线隔开的手机号', '<p>联系店长：139－1234－7788</p>', 'phone'],
    ['小型横线隔开的手机号', '<p>联系店长：139﹣1234﹣7788</p>', 'phone'],
    ['减号隔开的手机号', '<p>联系店长：139−1234−7788</p>', 'phone'],
    ['全角数字的手机号', '<p>联系店长：１３９１２３４７７８８</p>', 'phone'],
    ['省略号前的邮箱', '<p>Contact: zhang.san1987@qq.com...Thanks!</p>', 'email'],
    ['全角 @ 的邮箱', '<p>Contact: zhang.san1987＠qq.com</p>', 'email'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下`, !q.ok && q.errors.some((e) => e.code === code && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  {
    const html = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><style/>&quot;<style>.x{background:u&#114;l("${nestUrl}")}</style></svg><div class="x" style="width:40px;height:40px"></div>`
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check('内联 SVG 里 <style/>&quot; 后面再写样式（实体拼的 url）：套娃 SVG 照样按图片的规矩查', !q.ok && q.errors.some((e) => ['inlineNested', 'inlineSvgBad'].includes(e.code) && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  for (const [name, html] of [
    ['正常邮箱后面跟句号、连字符', '<p>写信：hello@example.com. 也可以 x@example.com-</p>'],
    ['全角括号里的电话格式说明', '<p>电话格式：１３９－××××－××××</p>'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`${name}：照样能过`, q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  // 第十一轮：清单里每屏的标题、署名也查个人信息；上标脚注不拼进前面的数字；几个带 <style/> 的图标、标题里有撇号 / &apos; 也不触发上限
  {
    const base = JSON.parse(JSON.stringify(q6.manifest))
    const files = (m) => [{ path: 'design.json', data: Buffer.from(JSON.stringify(m)) }, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1>')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }]
    const mScreen = { ...base, screens: [{ file: 'home.html', title: { zh: '联系人13912347788' } }] }
    const mAuthor = { ...base, screens: [{ file: 'home.html' }], license: 'CC-BY-4.0', author: { name: '设计师 13912347788' } }
    for (const [name, m] of [['屏标题里的手机号', mScreen], ['署名里的手机号', mAuthor]]) {
      const share = checkPack(files(m), { mode: 'share' })
      const ci = checkPack(files(m), { mode: 'ci' })
      check(`隐私：清单${name} → 分享拦下、CI 标出`, !share.ok && share.errors.some((e) => e.code === 'phone' && e.x === 'design.json') && [...ci.errors, ...ci.flags].some((e) => e.code === 'phone' && e.x === 'design.json'), JSON.stringify([share.errors.map((e) => e.code), ci.flags.map((e) => e.code)]))
    }
    const ok = checkPack(files({ ...base, screens: [{ file: 'home.html', title: { zh: '首页', en: 'Home' } }] }), { mode: 'share' })
    check('清单里正常的屏标题照样能过', ok.ok, JSON.stringify(ok.errors))
  }
  const iconT = (t) => `<svg width="16" height="16" viewBox="0 0 16 16"><style/><title>${t}</title><circle cx="8" cy="8" r="8"/></svg>`
  for (const [name, html] of [
    ['上标脚注跟在订单号后面', '<p>订单号：1391234778¹</p>'],
    ['圈码数字后面跟号码样的编号', '<p>①３９１２３４７７８８</p>'],
    ['3 个带 <style/> 的图标，标题有撇号和 &apos;，后面长正文', `${iconT("Today's coffee")}${iconT('Today&apos;s tea')}${iconT('Menu')}<p>${'Morning coffee menu and cafe stories. '.repeat(1400)}</p><p>Coffee &amp; Tea</p>`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const t0 = Date.now()
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    const ms = Date.now() - t0
    check(`${name}：照样能过、不卡`, q.ok && ms < 3000, `${ms}ms ${JSON.stringify(q.errors.map((e) => [e.code, e.n]))}`)
  }
  // 样式段去重：后一段的起点在前一段的字符串 / 注释里（原文或实体还原后），后一段照样按样式读、严格查
  for (const [name, html] of [
    ['前一段的字符串里', `<style/>"<style>.x{background:url("${nestUrl}")}</style>`],
    ['前一段的注释里', `<style/>/*<style>*/.x{background:url("${nestUrl}")}</style>`],
    ['实体还原后前一段的字符串里', `<svg xmlns="http://www.w3.org/2000/svg"><style/>&apos;<style>.x{background:url('${nestUrl}')}</style></svg>`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}<div class="x"></div>`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`样式段起点在${name}：套娃 SVG 照样拦`, !q.ok && q.errors.some((e) => ['inlineNested', 'inlineSvgBad'].includes(e.code) && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  // 第十二轮：前面文本框里的假标签 <style a=" 的 > 落在真样式后面（起点倒退）：真样式照样严格查；url 里很深的括号不吃内存
  for (const [name, tail] of [['注释里的 >', ' /* > */}</style>'], ['选择器里的 >', '}.x > i{color:red}</style>'], ['文件末尾的 >', '}>']]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1><div class="x"></div><textarea readonly><style a="</textarea><style>.x{background:url("${nestUrl}")${tail}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`文本框里的假 <style a="，真样式${name}：套娃 SVG 照样拦`, !q.ok && q.errors.some((e) => ['inlineNested', 'inlineSvgBad'].includes(e.code) && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  {
    const t0 = Date.now()
    const m0 = process.memoryUsage().heapUsed
    const d = inlineData(`<style>.x{background:image-set(${'calc('.repeat(30000)}1</style>`, 'html')
    const mb = (process.memoryUsage().heapUsed - m0) / 1e6
    check('url 类函数里套三万层括号：很快、不吃内存', !d.more && Date.now() - t0 < 1000 && mb < 60, `${Date.now() - t0}ms ${mb.toFixed(1)}MB`)
  }
  // 第十二轮（续）：Tel. 紧跟的号码要查出；行内标签拆开的号码照样查；表格三个格子、换行、上标隔开的数字不拼成手机号
  for (const [name, html] of [
    ['Tel. 后紧跟的手机号', '<p>Tel.13912347788</p>'],
    ['全角 Tel． 后紧跟的全角手机号', '<p>Tel．１３９１２３４７７８８</p>'],
    ['<b> 拆开写的手机号', '<p>联系：139 <b>1234</b> 7788</p>'],
    ['<span> 拆开、横线连着的手机号', '<p><span>139</span>-<span>1234</span>-<span>7788</span></p>'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下`, !q.ok && q.errors.some((e) => e.code === 'phone' && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => e.code)))
  }
  for (const [name, html] of [
    ['统计表三个格子 139 / 1234 / 7788', '<table><tr><th>在售商品</th><th>今日访问</th><th>累计订单</th></tr><tr><td>139</td><td>1234</td><td>7788</td></tr></table>'],
    ['三个卡片里的数字', '<div class="stat">139</div>\n<div class="stat">1234</div>\n<div class="stat">7788</div>'],
    ['换行隔开的数字', '<p>139<br>1234<br>7788</p>'],
    ['小数（前面是冒号、空格）', '<p style="opacity:.13912347788">x .13912347788</p>'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`${name}：照样能过`, q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  // 第十三轮：排成两块的「Tel」标签后面的号码；CSS content 里相邻几段字符串拼出的号码 / 邮箱；源码缩进换行隔开的号码
  {
    const tokPath = path.join(pv, 'tokens.css')
    const tokOld = fs.readFileSync(tokPath, 'utf8')
    for (const [name, html, css, code, file] of [
      ['弹性排版的联系卡 <span>Tel</span><span><b>139</b> 1234 7788</span>', '<style>.contact{display:flex;gap:12px}</style><p class="contact"><span>Tel</span><span><b>139</b> 1234 7788</span></p>', null, 'phone', 'home.html'],
      ['<b> 包着的邮箱前半段', '<p><b>zhang.san1987</b>@qq.com</p>', null, 'email', 'home.html'],
      ['源码里缩进换行隔开的手机号', '<p>139\n        1234\n        7788</p>', null, 'phone', 'home.html'],
      ['网页样式 content 里相邻字符串拼出的手机号', '<style>.contact::after{content:"139 " "1234 " "7788"}</style><p class="contact"></p>', null, 'phone', 'home.html'],
      ['样式表 content 里相邻字符串拼出的邮箱', '<p class="contact"></p>', `${tokOld}\n.contact::after{content:"zhang.san1987" "@qq.com"}`, 'email', 'tokens.css'],
    ]) {
      fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
      fs.writeFileSync(tokPath, css === null ? tokOld : css)
      const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
      check(`隐私：${name} → 拦下`, !q.ok && q.errors.some((e) => e.code === code && e.x === file), JSON.stringify(q.errors.map((e) => [e.code, e.x])))
    }
    fs.writeFileSync(tokPath, tokOld)
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><style>.a::after{content:"139"}.b::after{content:"1234"}.c::after{content:"7788"}</style><p class="a"></p>'))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check('不同规则里的 content 数字不拼成手机号', q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  // 第十四轮：号码中间被行内标签 / 相邻 CSS 字符串随便哪里断开都照样连着查；小数中间加粗不误报
  for (const [name, html, code] of [
    ['搜索高亮拆开的手机号 139<mark>123</mark>47788', '<p>联系电话：139<mark>123</mark>47788</p>', 'phone'],
    ['局部加粗的身份证号', '<p>证件：110105<b>19491231</b>002X</p>', 'idcard'],
    ['content 里 "13912" "347788"', '<style>.c::after{content:"13912" "347788"}</style><p class="c"></p>', 'phone'],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`隐私：${name} → 拦下`, !q.ok && q.errors.some((e) => e.code === code && e.x === 'home.html'), JSON.stringify(q.errors.map((e) => [e.code, e.x])))
  }
  {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><p>比例：0.<b>139</b>12347788</p>'))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check('小数中间加粗：照样能过', q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  // 第十五轮：Markdown 里加粗 / 斜体的号码要查出（打码的不算）；整段小数加粗不误报；两栏并排各自高亮的号码都查出
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const base = [man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1>')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }]
    for (const [name, md, code] of [
      ['加粗的手机号', '联系电话：**13912347788**', 'phone'],
      ['斜体的手机号', '联系电话：*13912347788*', 'phone'],
      ['下划线加粗的身份证', '证件：__11010519491231002X__', 'idcard'],
    ]) {
      const r = checkPack([...base, { path: 'DESIGN.md', data: Buffer.from(`# 晨光咖啡\n\n${md}\n`) }], { mode: 'share' })
      check(`隐私：Markdown 里${name} → 拦下`, !r.ok && r.errors.some((e) => e.code === code && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.x])))
    }
    // 第十六轮：带 +86 / 全角的强调号码；打码邮箱、行内代码、词中间的下划线不误报
    for (const [name, md] of [
      ['双下划线 +86 号码', '联系电话：__+8613912347788__'],
      ['单下划线 +86 号码', '联系电话：_+8613912347788_'],
      ['下划线包着的全角号码', '联系电话：__１３９１２３４７７８８__'],
    ]) {
      const r = checkPack([...base, { path: 'DESIGN.md', data: Buffer.from(`# 晨光咖啡\n\n${md}\n`) }], { mode: 'share' })
      check(`隐私：Markdown 里${name} → 拦下`, !r.ok && r.errors.some((e) => e.code === 'phone' && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.x])))
    }
    const masked = checkPack([...base, { path: 'DESIGN.md', data: Buffer.from('# 晨光咖啡\n\n示例电话：139****7788，**营业时间** 8:00\n\n个人中心：zhang***@qq.com，代码里写 `zhang***@qq.com`，订单 order_13912347788_v2\n') }], { mode: 'share' })
    check('Markdown 里打码的号码 / 邮箱、行内代码、词中间的下划线、普通加粗：照样能过', masked.ok, JSON.stringify(masked.errors.map((e) => [e.code, e.n])))
  }
  {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><p>比例：0.<b>13912347788</b></p>'))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check('整段小数位加粗：照样能过', q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><div style="display:flex;gap:16px"><span><b>139</b>12347788</span><span><b>186</b>23456791</span></div>'))
    const q2 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    // 第十六轮：号码紧挨着别的数字、只隔着行内标签——拿不准（可能是两栏两个号码，也可能是一个长编号），提醒、不硬拦
    check('隐私：两栏并排各自高亮的手机号 → 都提醒', ['13912347788', '18623456791'].every((n) => q2.flags.some((e) => e.code === 'phone' && String(e.n).replace(/\D/g, '') === n)), JSON.stringify([q2.errors, q2.flags].map((l) => l.map((e) => [e.code, e.n]))))
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1><p>订单号：20261107<mark>139</mark>12347788</p><p>比例：0.2026<b>139</b>12347788</p>'))
    const q3 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check('长订单号、长小数中间高亮：能分享（只提醒）', q3.ok, JSON.stringify(q3.errors.map((e) => [e.code, e.n])))
  }
  // 第十七轮：Markdown 强调按 CommonMark 配对——嵌套、跨行、夹行内代码的号码查出；同一行几个打码邮箱、表格里的不误拦；个人信息提醒排最前面、不被条数截掉
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const base = [man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1>')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }]
    const mdCheck = (md) => checkPack([...base, { path: 'DESIGN.md', data: Buffer.from(`# 晨光咖啡\n\n${md}\n`) }], { mode: 'share' })
    for (const [name, md, code] of [
      ['嵌套强调里的手机号', '**联系人：*13912347788***', 'phone'],
      ['跨行加粗里的手机号', '**联系人：\n13912347788**', 'phone'],
      ['加粗里夹行内代码的手机号', '**联系人：`备用` 13912347788**', 'phone'],
      ['跨行加粗里的身份证', '**证件：\n11010519491231002X**', 'idcard'],
    ]) {
      const r = mdCheck(md)
      check(`隐私：Markdown ${name} → 拦下`, !r.ok && r.errors.some((e) => e.code === code && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.x])))
    }
    for (const [name, md] of [
      ['同一行两个打码邮箱', '用户 A：zhang***@qq.com，用户 B：li***@qq.com'],
      ['表格同一行两个打码邮箱', '| 主账号 | 备用 |\n|---|---|\n| zhang***@qq.com | li***@qq.com |'],
      ['列表里打码邮箱夹着加粗', '* 主账号 zhang***@qq.com\n* **备用** li***@qq.com'],
    ]) {
      const r = mdCheck(md)
      check(`Markdown ${name}：照样能过`, r.ok, JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    // 先有 120 条别的提醒，再来一个拿不准的手机号：手机号提醒还在、排第一
    const many = Array.from({ length: 120 }, (_, k) => `biz${k}@example-shop${k}.cn`).join('，')
    const r = checkPack([man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1><div style="display:flex"><span><b>139</b>12347788</span><span><b>186</b>23456791</span></div>')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, { path: 'DESIGN.md', data: Buffer.from(`# 晨光\n\n${many}\n`) }], { mode: 'share' })
    check('个人信息提醒排最前面、不被 100 条上限挤掉', r.flags.length && r.flags[0].code === 'phone' && r.flags.filter((f) => f.code === 'phone').length === 2, JSON.stringify(r.flags.slice(0, 3).map((f) => [f.code, f.n])) + ` 共 ${r.flags.length}`)
  }
  // 第十八轮：保留首尾的打码邮箱不截出后半段误报；emoji 紧挨的强调号码照样查出
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const files = (html, md) => [man, { path: 'home.html', data: Buffer.from(page('首页', `<h1>晨光咖啡</h1>${html}`)) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, ...(md ? [{ path: 'DESIGN.md', data: Buffer.from(`# 晨光\n\n${md}\n`) }] : [])]
    const ok = checkPack(files('<p>绑定邮箱：12****89@163.com</p><p>备用：zh•••san@qq.com</p>', '账户邮箱：zh***san@qq.com'), { mode: 'share' })
    check('保留首尾的打码邮箱（网页、Markdown）：照样能过', ok.ok, JSON.stringify(ok.errors.map((e) => [e.code, e.n])))
    for (const md of ['📞__13912347788__', '📞**+8613912347788**', '**13912347788**📞']) {
      const r = checkPack(files('', md), { mode: 'share' })
      check(`隐私：Markdown「${md}」→ 拦下`, !r.ok && r.errors.some((e) => e.code === 'phone' && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.x])))
    }
  }
  // 第十九轮：项目符号 / 尾注星号旁的完整邮箱照样查出；列表、表格、同一行里几个首尾打码邮箱不误拦
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const files = (html, md) => [man, { path: 'home.html', data: Buffer.from(page('首页', `<h1>晨光咖啡</h1>${html}`)) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, ...(md ? [{ path: 'DESIGN.md', data: Buffer.from(`# 晨光\n\n${md}\n`) }] : [])]
    for (const html of ['<p>•zhang.san1987@qq.com</p>', '<p>zhang.san1987@qq.com*</p>', '<p>**zhang.san1987@qq.com**</p>']) {
      const r = checkPack(files(html), { mode: 'share' })
      check(`隐私：${html} → 拦下`, !r.ok && r.errors.some((e) => e.code === 'email' && e.x === 'home.html'), JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    for (const [name, md] of [
      ['列表里两个首尾打码邮箱', '- 主邮箱：zh***san@qq.com\n- 备用邮箱：li***si@163.com'],
      ['表格里两个首尾打码邮箱', '| 主 | 备 |\n|---|---|\n| zh***san@qq.com | li***si@163.com |'],
      ['同一行两个首尾打码邮箱', '主邮箱：zh***san@qq.com，备用：li***si@163.com'],
      ['代码块里的打码邮箱', '```\nzh***san@qq.com li***si@163.com\n```'],
    ]) {
      const r = checkPack(files('', md), { mode: 'share' })
      check(`Markdown ${name}：照样能过`, r.ok, JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    for (const md of ['- **联系人：13912347788**', '| **13912347788** | 店长 |', '**zhang.san1987@qq.com**']) {
      const r = checkPack(files('', md), { mode: 'share' })
      check(`隐私：Markdown「${md}」→ 拦下`, !r.ok && r.errors.some((e) => ['phone', 'email'].includes(e.code) && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
  }
  // 第二十轮：竖线联系行、粗斜体紧挨汉字、强调夹在号码中间都查出；嵌套 / 引用列表里的打码邮箱不误拦；邮箱后面两个星号至少提醒
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const files = (html, md) => [man, { path: 'home.html', data: Buffer.from(page('首页', `<h1>晨光咖啡</h1>${html}`)) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, ...(md ? [{ path: 'DESIGN.md', data: Buffer.from(`# 晨光\n\n${md}\n`) }] : [])]
    for (const md of ['**张三 | 13912347788**', '联系电话***13912347788***', '139**1234**7788', '**证件：\n11010519491231002X**']) {
      const r = checkPack(files('', md), { mode: 'share' })
      check(`隐私：Markdown「${md.replace(/\n/g, '⏎')}」→ 拦下`, !r.ok && r.errors.some((e) => ['phone', 'idcard'].includes(e.code) && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    for (const [name, md] of [
      ['嵌套列表里的打码邮箱', '- 账户\n    - 主邮箱：zh**san@qq.com\n    - 备用邮箱：li**si@163.com'],
      ['引用里的列表打码邮箱', '> - zh**san@qq.com\n> - li**si@163.com'],
      ['订单号、长数字旁的强调', '订单 2026**13912347788**，比例 0.**13912347788**，编号 order_13912347788_v2'],
      ['打码手机号', '手机：139****7788'],
    ]) {
      const r = checkPack(files('', md), { mode: 'share' })
      check(`Markdown ${name}：照样能过`, r.ok, JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    const r = checkPack(files('<p>联系邮箱：zhang.san1987@qq.com**</p><p>** 工作日回复</p>'), { mode: 'share' })
    check('邮箱后面跟两个尾注星号：至少提醒', r.flags.some((f) => f.code === 'email') || r.errors.some((e) => e.code === 'email'), JSON.stringify([r.errors, r.flags].map((l) => l.map((e) => [e.code, e.n]))))
    const m = checkPack(files('<p>账户：zhang@q**q.com</p>'), { mode: 'share' })
    check('域名中间打码的邮箱：照样能过', m.ok && !m.flags.some((f) => f.code === 'email'), JSON.stringify(m.errors.map((e) => [e.code, e.n])))
  }
  // 第二十一轮：号码中间随便哪段加粗照样查出；加粗标签紧挨着的完整邮箱至少提醒
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify({ ...q6.manifest, screens: [{ file: 'home.html' }] })) }
    const files = (md) => [man, { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1>')) }, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, { path: 'DESIGN.md', data: Buffer.from(`# 晨光\n\n${md}\n`) }]
    for (const md of ['电话：139**123**47788', '证件号：110105**19491231**002X']) {
      const r = checkPack(files(md), { mode: 'share' })
      check(`隐私：Markdown「${md}」→ 拦下`, !r.ok && r.errors.some((e) => ['phone', 'idcard'].includes(e.code) && e.x === 'DESIGN.md'), JSON.stringify(r.errors.map((e) => [e.code, e.n])))
    }
    const r = checkPack(files('**邮箱**zhang.san1987@qq.com'), { mode: 'share' })
    check('加粗标签紧挨着的完整邮箱：至少提醒', r.flags.some((f) => f.code === 'email') || r.errors.some((e) => e.code === 'email'), JSON.stringify([r.errors, r.flags].map((l) => l.map((e) => [e.code, e.n]))))
    const ok = checkPack(files('订单 2026**139**12347788，比例 0.**139**12347788，打码 139****7788，账户 **an@qq.com'), { mode: 'share' })
    check('长编号、小数里的局部加粗和打码：照样能过', ok.ok, JSON.stringify(ok.errors.map((e) => [e.code, e.n])))
    const r2 = checkPack(files('**Email**zhang.san1987@qq.com'), { mode: 'share' })
    check('英文加粗标签紧挨着的完整邮箱：至少提醒', r2.flags.some((f) => f.code === 'email') || r2.errors.some((e) => e.code === 'email'), JSON.stringify([r2.errors, r2.flags].map((l) => l.map((e) => [e.code, e.n]))))
    for (const md of ['主邮箱：zh**san@qq.com，备用**Email**zhang.san1987@qq.com', '主邮箱：zh**san@qq.com，备用**邮箱**zhang.san1987@qq.com', '**li.si1990@qq.com**备用**Email**zhang.san1987@qq.com', '**Email**li.si1990@qq.com，备用**Email**zhang.san1987@qq.com', '**邮箱**li.si1990@qq.com，备用**邮箱**zhang.san1987@qq.com', '**联系** **an@qq.com，备用**Email**zhang.san1987@qq.com', '**Email**•••89@163.com，备用**Email**zhang.san1987@qq.com', '**Email**li@q**q.com，备用**邮箱**zhang.san1987@qq.com', '**•••89@163.com，备用**Email**zhang.san1987@qq.com', 'Backup**Email**zhang.san1987@qq.com', '**• Email**zhang.san1987@qq.com', '**● 邮箱**zhang.san1987@qq.com', 'li@qq.com**Email**zhang.san1987@qq.com', '**邮箱：**zhang.san1987@qq.com', 'zhang.san1987@qq.com**Email：** zh**san@qq.com', 'li@example.com**Email Address**zhang.san1987@qq.com', 'li@example.com**Email Address***note*，备用**邮箱**zhang.san1987@qq.com', '***重要**说明**主邮箱：li@example.com，备用**邮箱**zhang.san1987@qq.com', '*a**b***zhang.san1987@qq.com']) {
      const r3 = checkPack(files(md), { mode: 'share' })
      const all = [...r3.errors, ...r3.flags]
      check(`前面有打码 / 加粗邮箱，后面加粗标签紧挨的完整邮箱：至少提醒（${md.slice(0, 16)}…）`, all.some((e) => e.code === 'email' && e.n === 'zhang.san1987@qq.com'), JSON.stringify(all.map((e) => [e.code, e.n])))
    }
    const ok2 = checkPack(files('**主邮箱**：zh**san@qq.com\n\n- 主：zh**san@qq.com，备：li**si@163.com\n\n**Email**zh**san@qq.com，*邮箱*li*si@163.com\n\n' + 'x'.repeat(290) + ' **Email**zh**san@qq.com\n\n**Email**li.si1990@example.com，备用**Email**zh**san@qq.com\n\n**联系** **an@qq.com，备用**Email**zh**san@qq.com\n\n**Email**li@q**q.com，邮箱：zh**san@qq.com\n\n**•••89@163.com，备用**Email**zh**san@qq.com\n\nBackup**Email**zh**san@qq.com，**• Email**zh**san@qq.com\n\n主邮箱：li@qq.c**om，备：**an@qq.com\n\n**•••89@qq.com**Email: zh**san@qq.com\n\n备用：zhang@qq.co**m、wu@1**3.com\n\nli@example.com**Email Address**zh**san@qq.com\n\n主：li@qq.c**om and more, 备：zh**san@qq.com'), { mode: 'share' })
    const odd = checkPack(files('li@example.com**Email Address***note*，备用**邮箱**zh**san@qq.com'), { mode: 'share' })
    check('长短不一样的星号配对后面的打码邮箱：拿不准只提醒、不拦', odd.ok, JSON.stringify(odd.errors.map((e) => [e.code, e.n])))
    check('加粗标签后面（含紧挨着）的打码邮箱：照样能过、不提醒', ok2.ok && !ok2.flags.some((f) => f.code === 'email'), JSON.stringify([ok2.errors, ok2.flags].map((l) => l.map((e) => [e.code, e.n]))))
    // 64KB 以内的 DESIGN.md 走完整扫描；更长的一行直接测扫描本身
    const t0 = Date.now()
    const big = checkPack(files('**ab@example.com **E**cd@example.com x**ef@example.com '.repeat(600) + '\n' + '编号 12**3**4 '.repeat(1000)), { mode: 'share' })
    check('很长一行里很多加粗邮箱、加粗数字：完整扫描、不卡', !big.errors.some((e) => e.code === 'big') && Date.now() - t0 < 3000, `${Date.now() - t0}ms ${JSON.stringify(big.errors.slice(0, 3).map((e) => [e.code, e.n]))}`)
    const many = textFlags('**E**zhang@qq.com '.repeat(200), { urls: false, md: true }).filter((f) => f.code === 'email').length
    check('一行 200 个「**E**邮箱」：300 字小段从中间切开也配对正确、个个提醒', many === 200, `${many}`)
    for (const unit of ['**ab@qq.com ', '**E**ab@qq.com ', 'x***ab@qq.com **', '编号 12**3**4 ']) {
      const t1 = Date.now()
      textFlags(unit.repeat(80000), { urls: false, md: true })
      check(`约 1MB 一行「${unit.trim()}」直接扫：不卡`, Date.now() - t1 < 3000, `${Date.now() - t1}ms`)
    }
  }
  const longPath = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="${'M0 0L1 1'.repeat(12000)}"/></svg>`
  const iconStyle = '<svg width="16" height="16" viewBox="0 0 16 16"><style/><circle cx="8" cy="8" r="8"/></svg>'
  for (const [name, html] of [
    ['透明度、变换里的长小数和类名里的长数字', '<div class="c13912347788" style="opacity:0.13912347788;transform:matrix(0.13912347788,0,0,1,0,0)">咖啡</div>'],
    ['很长的 base64 SVG', `<img src="data:image/svg+xml;base64,${Buffer.from(longPath).toString('base64')}" alt="">`],
    ['8 个带 <style/> 的图标 + 长正文', `${iconStyle.repeat(8)}<p>${'Morning coffee menu and cafe stories. '.repeat(800)}</p>`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const t0 = Date.now()
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    const ms = Date.now() - t0
    check(`${name}：照样能过、不卡`, q.ok && ms < 3000, `${ms}ms ${JSON.stringify(q.errors.map((e) => [e.code, e.n]))}`)
  }
  // 正常写法别误伤：单引号属性、渐变 url(#g) 的百分号 SVG；base64 不带等号后面跟 #片段
  const grad = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><defs><linearGradient id='g'><stop offset='0' stop-color='%23f80'/></linearGradient></defs><circle cx='4' cy='4' r='4' fill='url(%23g)'/></svg>`
  for (const [name, html] of [
    ['单引号属性 + url(#g) 的百分号 SVG', `<img src="data:image/svg+xml,${grad.replace(/[<>"\s]/g, (c) => encodeURIComponent(c)).replace(/%2523/g, '%23')}" alt="">`],
    ['encodeURIComponent 的 SVG（单引号、括号不编码）', `<img src="data:image/svg+xml,${encodeURIComponent(grad.replace(/%23/g, '#'))}" alt="">`],
    ['base64 SVG 后面跟 #icon', `<img src="data:image/svg+xml;base64,${iconB64Early}#icon" alt="">`],
    ['base64 SVG 后面跟 #svgView(…)', `<img src="data:image/svg+xml;base64,${iconB64Early}#svgView(viewBox(0,0,20,20))" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`内嵌${name}照样能过`, q.ok, JSON.stringify(q.errors.map((e) => [e.code, e.n])))
  }
  // srcset 的「1x / 2x」不算进内嵌图片的内容（base64 不带等号结尾时最容易混进去）
  let icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>'
  while (icon.length % 3) icon = icon.replace('<circle', ' <circle')
  const iconB64 = Buffer.from(icon).toString('base64')
  const cleanPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkP('IHDR', ihdr), chunkP('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00])), chunkP('IEND', Buffer.alloc(0))])
  for (const [name, html] of [
    ['srcset 里的 SVG（base64 不带等号）', `<img src="a.png" srcset="data:image/svg+xml;base64,${iconB64} 1x, data:image/svg+xml;base64,${iconB64} 2x" alt="">`],
    ['srcset 里的 PNG 带 2x', `<img src="data:image/png;base64,${cleanPng.toString('base64')}" srcset="data:image/png;base64,${cleanPng.toString('base64')} 2x" alt="">`],
    ['image-set 里的 SVG', `<i style="background-image:image-set(&quot;data:image/svg+xml;base64,${iconB64}&quot; 1x)"></i>`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`内嵌${name}照样能过`, q.ok || !q.errors.some((e) => /^inline|imgMetaInline/.test(e.code)), JSON.stringify(q.errors.map((e) => e.code)))
  }
  for (const [name, html] of [
    ['带 <?xml encoding="UTF-8"?> 的 SVG 图标', `<img src="data:image/svg+xml,${encodeURIComponent('<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')}" alt="">`],
    ['写了 charset=utf-8 的 SVG 图标', `<i style="background:url(&quot;data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')}&quot;)"></i>`],
    ['带 UTF-8 BOM 的 SVG 图标', `<img src="data:image/svg+xml;base64,${Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')]).toString('base64')}" alt="">`],
  ]) {
    fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1>${html}`))
    const q = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
    check(`内嵌${name}照样能过`, q.ok, JSON.stringify(q.errors.map((e) => e.code)))
  }
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1>'))
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', `<h1>晨光咖啡</h1><img src="data:image/png;base64,${b64}" alt="">`))
  const q9 = packDesign(pv, { screens: listScreens(pv), mode: 'share', description: '咖啡店两屏' })
  check('打包：标准写法的内嵌 PNG 自动去掉文字块后能过', q9.ok && !q9.files.find((f) => f.path === 'home.html').data.toString().includes(b64), JSON.stringify(q9.errors.map((e) => e.code)))
  fs.writeFileSync(path.join(pv, 'home.html'), page('首页', '<h1>晨光咖啡</h1>'))
  {
    const man = { path: 'design.json', data: Buffer.from(JSON.stringify(q6.manifest)) }
    const hp = { path: 'home.html', data: Buffer.from(page('首页', '<h1>晨光咖啡</h1>')) }
    const r1 = checkPack([man, hp, { path: 'tokens.css', data: Buffer.from('@charset "iso-8859-1";:root{--bg:#fff}') }], { mode: 'ci' })
    const r2 = checkPack([man, hp, { path: 'tokens.css', data: Buffer.from(':root{--bg:#fff}') }, { path: 'assets/i.svg', data: Buffer.from('<?xml version="1.0" encoding="windows-1252"?><svg xmlns="http://www.w3.org/2000/svg"/>') }], { mode: 'ci' })
    const r3 = checkPack([man, hp, { path: 'tokens.css', data: Buffer.from('@charset "UTF-8";:root{--bg:#fff}') }, { path: 'assets/i.svg', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>') }], { mode: 'ci' })
    check('编码：CSS @charset、SVG encoding 写了别的编码 → 拦；写 UTF-8 照样过', r1.errors.some((e) => e.code === 'charset' && e.x === 'tokens.css') && r2.errors.some((e) => e.code === 'charset' && e.x === 'assets/i.svg') && !r3.errors.some((e) => e.code === 'charset'), JSON.stringify([r1.errors, r2.errors, r3.errors].map((x) => x.map((e) => e.code))))
  }
  check('本机路径：网址里的 /home/ 不算，相对路径不算', !localPathIn('https://x.com/home/abc/') && !localPathIn('href="home/x.html"') && !!localPathIn('C:\\Users\\zhang\\a.png') && !!localPathIn('src="/home/zhang/a.png"'))
}

// 已有清单：屏列表以目录为准，来源带成 derivedFrom
const m2 = buildManifest({ existing: { format: 1, type: 'template', title: { zh: '旧名' }, kind: 'app', screens: [{ file: 'menu.html', title: { zh: '菜单页' } }], license: 'CC-BY-4.0', from: { id: 'ann__coffee', rev: 'abc1234' } }, screens: ['home.html', 'menu.html'], htmls: new Map([['home.html', page('首页', '')], ['menu.html', page('菜单', '')]]) })
check('清单：已有的名字、屏名、授权留着，新屏补上，原作带上', m2.title.zh === '旧名' && m2.screens[1].title.zh === '菜单页' && m2.screens[0].title.zh === '首页' && m2.license === 'CC-BY-4.0' && m2.derivedFrom === 'ann__coffee@abc1234' && !m2.from)

// ── 落地 ──
const zipBuf = zipOf(p1)
const libDir = path.join(tmp, 'lib')
const library = createLibrary({ dir: libDir })
const work = path.join(tmp, 'work')
fs.mkdirSync(work)
const prepared = preparePack(readZip(zipBuf).files)
const r1 = installPack(prepared, { base: work, name: '晨光咖啡', trust: 'zip', from: { zip: '晨光咖啡.zip' }, library })
check('落地：放进 <会话目录>/<名字>', r1.dir === path.join(work, '晨光咖啡') && fs.existsSync(path.join(r1.dir, 'home.html')) && fs.existsSync(path.join(r1.dir, 'assets', 'cup.jpg')))
check('落地：屏的顺序照清单', listScreens(r1.dir).join() === 'home.html,menu.html')
check('落地：design.json 记上来源', JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8')).from.zip === '晨光咖啡.zip')
check('落地：登记成别人做的，内容哈希对得上', library.get(r1.dir).trust === 'zip' && library.strictHtml(fs.readFileSync(path.join(r1.dir, 'home.html'))) && library.strictRoot(r1.dir))
const r2 = installPack(prepared, { base: work, name: '晨光咖啡', trust: 'zip', from: { zip: 'x.zip' }, library })
check('落地：重名加 -2，不覆盖', r2.dir === path.join(work, '晨光咖啡-2'))
check('文件夹名：去掉路径符号', slugOf('../a/b:c*?.zip') === 'a-b-c' && slugOf('...') === 'template' && slugOf('CON') === 'template')
check('放哪：会话目录是家目录就放 ~/DSH 设计', baseFor(os.homedir()) === path.join(os.homedir(), 'DSH 设计') && baseFor(work) === work && baseFor('') === path.join(os.homedir(), 'DSH 设计'))

const evilZip = writeZip([{ path: 'design.json', data: JSON.stringify(p1.manifest) }, { path: 'home.html', data: page('首页', '<img src="x" onerror="alert(1)"><script src="https://evil.example/x.js"></script>') }, { path: 'menu.html', data: page('菜单', '') }, { path: 'tokens.css', data: '' }, { path: 'assets/cup.jpg', data: jpg }])
let rejected = null
try { preparePack(readZip(evilZip).files) } catch (e) { rejected = e }
check('落地：带脚本的包拒收，说清哪一条', rejected && rejected.message === 'check' && rejected.errors.some((e) => e.code === 'tag') && rejected.errors.some((e) => e.code === 'handler'), rejected && JSON.stringify(rejected.errors.map((e) => e.code)))
let noMan = null
try { preparePack(readZip(writeZip([{ path: 'index.html', data: '<p>x</p>' }])).files) } catch (e) { noMan = e }
check('落地：没有 design.json 的包说「不是设计包」', noMan && noMan.message === 'noManifest')
check('落地：被拒的包一个文件都没写', fs.readdirSync(work).length === 2)

// ── CC BY：署名（朋友之间只写名字也行）、转手时署名一路带着 ──
{
  const pBy = packDesign(r1.dir, { screens: listScreens(r1.dir), license: 'CC-BY-4.0', author: '小周\n（假的）' })
  check('CC BY 打包：署名只写名字也过（不是市场）、换行收成一行', pBy.ok && pBy.manifest.author && pBy.manifest.author.name === '小周 （假的）' && !pBy.manifest.author.login, JSON.stringify(pBy.errors.map((e) => e.code)))
  const byDir = installPack(preparePack(readZip(zipOf(pBy)).files), { base: work, name: '转手', trust: 'zip', from: { zip: 'by.zip' }, library }).dir
  const a1 = fs.readFileSync(path.join(byDir, 'ATTRIBUTION.md'), 'utf8')
  check('CC BY 落地：写 ATTRIBUTION.md，署上名字', /小周/.test(a1) && /CC BY 4\.0/.test(a1))
  const pAgain = packDesign(byDir, { screens: listScreens(byDir), license: 'CC-BY-4.0', author: '阿梅' })
  check('转手再打包：ATTRIBUTION.md 跟着走，原作者不在清单里冒充', pAgain.ok && pAgain.files.some((f) => f.path === 'ATTRIBUTION.md') && pAgain.manifest.author.name === '阿梅')
  const again = installPack(preparePack(readZip(zipOf(pAgain)).files), { base: work, name: '再转手', trust: 'zip', from: { zip: 'by2.zip' }, library }).dir
  const a2 = fs.readFileSync(path.join(again, 'ATTRIBUTION.md'), 'utf8')
  check('再落地：原来的署名留着，这一手接在后面', /小周/.test(a2) && /阿梅/.test(a2) && a2.indexOf('小周') < a2.indexOf('阿梅'), a2)
  const mk1 = installPack(preparePack(readZip(zipOf(pBy)).files), { base: work, name: '市场来的', trust: 'market', from: { id: 'zhou__x-1', url: 'https://github.com/OrderG-X/dsh-design-gallery/tree/main/templates/zhou__x-1' }, library }).dir
  const mk2 = installPack(preparePack(readZip(zipOf(pBy)).files), { base: work, name: '链接不对', trust: 'market', from: { id: 'zhou__x-1', url: 'javascript:alert(1)' }, library }).dir
  const a3 = fs.readFileSync(path.join(mk1, 'ATTRIBUTION.md'), 'utf8')
  const a4 = fs.readFileSync(path.join(mk2, 'ATTRIBUTION.md'), 'utf8')
  check('市场来的 CC BY：署名带上来源链接（只认 GitHub 链接）', a3.includes('Source: https://github.com/OrderG-X/dsh-design-gallery/tree/main/templates/zhou__x-1') && !/javascript|Source/.test(a4), a3)
  const pNoBy = packDesign(byDir, { screens: listScreens(byDir), license: 'CC0-1.0', author: '阿梅' })
  check('CC0 打包：不写署名（填了也不带）', pNoBy.ok && !pNoBy.manifest.author)
}

// ── 作品库卡片 ──
const card = describeWork(library.get(r1.dir))
check('作品卡片：名字、类型、屏数、缩略图版本', card.title === '晨光咖啡' && card.kind === 'app' && card.screens === 2 && card.exists && /^[0-9a-f]{10}$/.test(card.thumb) && card.trust === 'zip')
const gone = describeWork({ dir: path.join(tmp, 'nope'), title: '挪走了', kind: 'web' })
check('作品卡片：文件夹挪走了标出来', gone.exists === false && gone.title === '挪走了')
fs.renameSync(r2.dir, path.join(work, 'moved'))
library.move(r2.dir, path.join(work, 'moved'))
check('作品库：重新定位后信任记号跟着走', library.get(path.join(work, 'moved')).trust === 'zip' && library.strictRoot(path.join(work, 'moved')) && !library.get(r2.dir))

// ── 分享到市场：打包路由 ──
{
  const dl = path.join(tmp, 'dl')
  const routes = createLibraryRoutes({
    admit: () => true,
    readBody: async (req) => req.body,
    json: (res, code, obj) => { res.code = code; res.body = obj },
    tracker: { snapshot: () => null, cwdOf: () => '' },
    library, inspiration: null, studio: {}, open: () => {}, storeLoad: () => ({}), version: '0.11.0', exported: new Set(), downloads: dl,
  })
  const call = async (body) => { const res = {}; await routes.pack({ method: 'POST', body: { dir: r1.dir, ...body } }, res); return res }
  const agree = { own: true, brand: true, private: true, rules: true }
  const info0 = await call({ info: true })
  check('分享预填：名字、授权、还没分享过', info0.code === 200 && info0.body.title === '晨光咖啡' && info0.body.license === 'CC0-1.0' && info0.body.share === null && info0.body.screens === 2, JSON.stringify(info0.body))
  const noAgree = await call({ share: true, title: '晨光', agree: { ...agree, rules: false } })
  check('分享：四个确认少勾一个就不打包', noAgree.code === 400 && noAgree.body.error === 'agree' && !fs.existsSync(dl))
  const sh1 = await call({ share: true, title: '晨光咖啡馆', description: '小咖啡馆两屏', agree })
  const zipMan = (file) => JSON.parse(readZip(fs.readFileSync(file)).files.find((f) => f.path === 'design.json').data.toString('utf8'))
  const local1 = JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8'))
  const m1 = sh1.body.path ? zipMan(sh1.body.path) : {}
  check('分享：包里带指纹不带记号，名字介绍用填的', sh1.code === 200 && sh1.body.ok && m1.shareHash === shareHashOf(local1.shareToken) && !('shareToken' in m1) && m1.title.zh === '晨光咖啡馆' && m1.description.zh === '小咖啡馆两屏', JSON.stringify(sh1.body).slice(0, 300))
  check('分享：记号存在自己的 design.json（32 位），来源留着、不存指纹', /^[0-9a-f]{32}$/.test(local1.shareToken) && !('shareHash' in local1) && local1.from && local1.from.zip === '晨光咖啡.zip' && local1.title.zh === '晨光咖啡馆')
  check('分享：回给向导短号和预填短名', sh1.body.share.ref === m1.shareHash.slice(0, 12) && sh1.body.share.title === '晨光咖啡馆' && sh1.body.share.slug === '')
  const sh2 = await call({ share: true, title: '晨光咖啡馆', agree })
  check('再分享：沿用同一个记号（市场认得出是同一套）', sh2.body.ok && sh2.body.share.ref === sh1.body.share.ref && sh2.body.path !== sh1.body.path && JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8')).shareToken === local1.shareToken)
  const info1 = await call({ info: true })
  check('分享过：预填带上次的名字和短号', info1.body.title === '晨光咖啡馆' && info1.body.description === '小咖啡馆两屏' && info1.body.share.ref === sh1.body.share.ref)
  check('分享过：作品卡片认得出', describeWork(library.get(r1.dir)).share.ref === sh1.body.share.ref)
  {
    // 原来中英都有：预填没改就两种都留着；改了中文就只留新中文
    const man = JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8'))
    fs.writeFileSync(path.join(r1.dir, 'design.json'), JSON.stringify({ ...man, title: { zh: '晨光咖啡馆', en: 'Morning Cafe' } }))
    const same = await call({ share: true, title: '晨光咖啡馆', description: '小咖啡馆两屏', agree })
    const kept = JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8')).title
    check('再分享名字没改：英文名留着，投稿短名用英文', same.body.ok && kept.en === 'Morning Cafe' && kept.zh === '晨光咖啡馆' && same.body.share.slug === 'morning-cafe', JSON.stringify(kept) + same.body.share.slug)
    const changed = await call({ share: true, title: '晨光二店', agree })
    const t2 = JSON.parse(fs.readFileSync(path.join(r1.dir, 'design.json'), 'utf8')).title
    check('再分享改了中文名：只留新名字（旧英文名不再对得上）', changed.body.ok && t2.zh === '晨光二店' && !t2.en, JSON.stringify(t2))
  }
  const z1 = await call({})
  check('普通导出 zip：不带指纹', z1.body.ok && !('shareHash' in zipMan(z1.body.path)))
  check('分享：没有 Chrome 就跳过体检，标一句（机器人那边还会查）', sh1.body.flags.some((f) => f.code === 'noRender'))
  {
    // 一键投稿：投的是这次查过的包；同一套内容重新打包指纹不变；zip 投之前被改过就不认
    const got = []
    const r = createLibraryRoutes({
      admit: () => true, readBody: async (req) => req.body, json: (res, code, obj) => { res.code = code; res.body = obj },
      tracker: { snapshot: () => null, cwdOf: () => '' }, library, inspiration: null, studio: {}, open: () => {}, storeLoad: () => ({}), version: '0.11.0', exported: new Set(), downloads: dl,
      github: { status: () => ({}), submit: async (o) => { got.push(o); if (o.as === 'Alice') throw new GhError('who', 'Bob'); return { url: 'https://github.com/x/y/issues/1', number: 1, login: 'a', fork: '' } } },
    })
    const pk = async () => { const res = {}; await r.pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光三店', agree } }, res); return res.body }
    const sub = async (p, login) => { const res = {}; await r.submit({ method: 'POST', body: { path: p, ...(login ? { login } : {}) } }, res); return res }
    const a = await pk()
    await new Promise((ok) => setTimeout(ok, 1100)) // zip 里的时间换一秒
    const b = await pk()
    const sa = await sub(a.path)
    const sb = await sub(b.path)
    check('一键投稿：投这次查过的包，带内容指纹（重新打包也一样），不带 zip 指纹', sa.code === 200 && sb.code === 200 && got.length === 2 && /^[0-9a-f]{64}$/.test(got[0].pack) && got[0].pack === got[1].pack && !('zipSha' in got[0]) && Buffer.isBuffer(got[0].zip) && got[0].ref === a.share.ref && a.share.license === 'CC0-1.0' && got[0].license === 'CC0-1.0', JSON.stringify(got.map((g) => ({ ...g, zip: g.zip && g.zip.length }))))
    const sw = await sub(a.path, 'Alice')
    check('一键投稿：面板的账号带给后端；对不上回 409 和现在的账号', got[2] && got[2].as === 'Alice' && sw.code === 409 && sw.body.error === 'who' && sw.body.msg === 'Bob', JSON.stringify(sw))
    fs.appendFileSync(b.path, 'x')
    const sc = await sub(b.path)
    check('一键投稿：zip 打好后被改过，不投（回去重新查）', sc.code === 404 && sc.body.error === 'notShared' && got.length === 3)
  }
  {
    const seen = []
    const mkRoutes = (hard, boom, errors = [], qrLike = []) => createLibraryRoutes({
      admit: () => true, readBody: async (req) => req.body, json: (res, code, obj) => { res.code = code; res.body = obj },
      tracker: { snapshot: () => null, cwdOf: () => '' }, library, inspiration: null, studio: { browser: { available: () => true } }, open: () => {}, storeLoad: () => ({}), version: '0.11.0', exported: new Set(), downloads: dl,
      render: async (dir, o) => { seen.push({ files: fs.readdirSync(dir).sort(), o }); if (boom) throw new Error('chrome died'); return { hard, soft: [], errors, qrLike } },
    })
    const before = fs.readdirSync(dl).length
    const bad = {}
    await mkRoutes([{ file: 'home.html', type: 'img', text: 'cup.jpg' }]).pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光二店', agree } }, bad)
    check('分享前体检：机器人会拒的（图片坏了）先拦住，不出 zip', bad.body.ok === false && bad.body.errors.some((e) => e.code === 'hard' && /图片坏了/.test(e.msg) && /cup\.jpg/.test(e.msg)) && fs.readdirSync(dl).length === before, JSON.stringify(bad.body.errors))
    check('分享前体检：量的是打好的包（有清单、按清单的屏和类型）', seen[0] && seen[0].files.includes('design.json') && seen[0].o.screens.join() === 'home.html,menu.html' && seen[0].o.kind === 'app' && seen[0].o.shots === false, JSON.stringify(seen[0] && seen[0].o))
    const fine = {}
    await mkRoutes([]).pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光二店', agree } }, fine)
    check('分享前体检：没问题照常出 zip', fine.body.ok && fs.existsSync(fine.body.path) && !fine.body.flags.some((f) => f.code === 'noRender'))
    const crash = {}
    await mkRoutes([], true).pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光二店', agree } }, crash)
    check('分享前体检跑不起来：不挡分享，标一句', crash.body.ok && crash.body.flags.some((f) => f.code === 'noRender'))
    const broke = {}
    await mkRoutes([], false, [{ file: 'menu.html', error: 'timeout' }]).pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光二店', agree } }, broke)
    check('分享前体检：有屏开不出来（机器人也会拒）也拦下，不出 zip', broke.body.ok === false && broke.body.errors.some((e) => e.code === 'render' && e.x === 'menu.html' && /没能打开/.test(e.msg)), JSON.stringify(broke.body.errors))
    const qr = {}
    await mkRoutes([], false, [], [{ file: 'home.html' }]).pack({ method: 'POST', body: { dir: r1.dir, share: true, title: '晨光二店', agree } }, qr)
    check('分享前体检：像是有二维码 → 排在最前面提醒（不挡，机器人真扫）', qr.body.ok && qr.body.flags[0].code === 'qr' && /二维码/.test(qr.body.flags[0].msg) && seen[seen.length - 1].o.qr === true, JSON.stringify(qr.body.flags))
    const plain = {}
    seen.length = 0
    await mkRoutes([{ file: 'home.html', type: 'img' }]).pack({ method: 'POST', body: { dir: r1.dir } }, plain)
    check('普通导出 zip：不跑分享前体检', plain.body.ok && !seen.length)
  }
  const outside = {}
  await routes.pack({ method: 'POST', body: { dir: tmp, share: true, agree } }, outside)
  check('分享：作品库外的目录不打包', outside.code === 404)
}

// ── 灵感 ──
const ins = createInspiration({ dir: libDir })
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000030806000000', 'hex')
const im = ins.addImage({ name: '参考.png', data: png })
check('灵感：存图片（认得出尺寸）', im.type === 'image' && im.w === 2 && im.h === 3 && fs.existsSync(ins.imageFile(im.id)))
check('灵感：不是图片拒收', (() => { try { ins.addImage({ name: 'x', data: Buffer.from('<svg onload=alert(1)>') }); return false } catch { return true } })())
const u1 = ins.addUrl({ url: 'stripe.com/pricing' })
check('灵感：网址补 https、重复的不再加', u1.url === 'https://stripe.com/pricing' && ins.addUrl({ url: 'https://stripe.com/pricing' }).id === u1.id)
check('灵感：javascript: 不收', (() => { try { ins.addUrl({ url: 'javascript:alert(1)' }); return false } catch { return true } })())
const style = { c: { bg: '#ffffff', surface: '#f7f3ee', text: '#2b2118', muted: '#6b5d52', line: '#e6ddd3', primary: '#6b4f3a', accent: '#c9a227', on: '#ffffff', link: '#6b4f3a' }, head: 'SERIF', w: 700, radius: 14, shadow: 'none', dzh: '晨光咖啡的风格' }
const s1 = ins.addStyle({ name: '晨光', style })
check('灵感：存我的风格', s1.type === 'style' && s1.style.head === 'SERIF')
const sm = ins.addStyle({ name: '薄荷', style, mid: 'eve__mint' })
check('灵感：从市场收藏的风格，同一张只存一份（刷新页面后再点也不重复）', sm.mid === 'eve__mint' && ins.addStyle({ name: '薄荷', style, mid: 'eve__mint' }).id === sm.id && ins.remove(sm.id))
check('灵感：风格里塞 url() 拒收', (() => { try { ins.addStyle({ name: 'x', style: { ...style, bgImage: 'url(https://evil.example/x.png)' } }); return false } catch { return true } })())
check('灵感：删掉图片连文件一起删', ins.remove(im.id) && !ins.imageFile(im.id) && ins.list().length === 2)
const f1 = ins.addMarket({ mid: 'alice__matcha-time', mtype: 'template', name: '抹茶时光' })
check('灵感：收藏市场设计，同一套只记一次', f1.type === 'market' && ins.addMarket({ mid: 'alice__matcha-time', mtype: 'template', name: 'x' }).id === f1.id && ins.list().length === 3)
check('灵感：收藏的 id 不像市场的、类型不对都拒', ['../x', 'alice', 'Alice__x1x'].every((mid) => { try { ins.addMarket({ mid, mtype: 'template' }); return false } catch { return true } }) && (() => { try { ins.addMarket({ mid: 'eve__mint', mtype: 'style' }); return false } catch { return true } })())

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
