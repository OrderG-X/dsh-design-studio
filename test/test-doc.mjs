/**
 * 导出 PDF / PPT 的测试（不用开 DSH）：
 *   node test/test-doc.mjs
 *
 * doc.js：读 JPEG 尺寸、PDF 的结构和交叉引用、zip 能解开且校验和对、PPTX 该有的部件和幻灯片尺寸；
 * 接口 /api/doc：存进设计目录的 exports/、同名不覆盖、乱给的东西拒掉。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import zlib from 'node:zlib'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

// HOME 换成临时目录：接口会记会话状态（~/.dsh/cache），别碰真的
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-doc-'))
process.env.HOME = tmp
process.env.USERPROFILE = tmp
const { jpegInfo, makePdf, makePptx, zip, crc32, slideSize, pageLinks } = await import('../lib/doc.js')

// 16×8 的 JPEG
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDIooor5E/SD//Z', 'base64')

check('jpegInfo：宽高、通道数', JSON.stringify(jpegInfo(JPG)) === JSON.stringify({ height: 8, width: 16, comps: 3 }), JSON.stringify(jpegInfo(JPG)))
check('jpegInfo：不是 JPEG → null', jpegInfo(Buffer.from('89504e470d0a1a0a', 'hex')) === null && jpegInfo(Buffer.alloc(0)) === null)
check('crc32 标准值', crc32(Buffer.from('123456789')) === 0xcbf43926)

// ── PDF ──
const pdf = makePdf([{ jpg: JPG, w: 390, h: 844 }, { jpg: JPG, w: 1280, h: 720 }], { title: '咖啡外带 App' })
const text = pdf.toString('latin1')
check('PDF：头尾', text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'))
check('PDF：两页，页面大小按 CSS 像素 × 0.75', (text.match(/\/Type \/Page\b/g) || []).length === 2 && text.includes('/MediaBox [0 0 292.5 633]') && text.includes('/MediaBox [0 0 960 540]'))
const xref = Number(/startxref\n(\d+)/.exec(text)[1])
check('PDF：startxref 指到 xref', text.slice(xref, xref + 4) === 'xref')
const offs = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
check('PDF：每个对象的偏移都对得上', offs.length > 0 && offs.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj`)), offs.join(','))
check('PDF：JPEG 原样放进去', pdf.includes(JPG) && text.includes('/Filter /DCTDecode') && text.includes('/Width 16 /Height 8'))
check('PDF：中文标题用 UTF-16', /\/Title <FEFF[0-9A-F]+>/.test(text))
let threw = false
try { makePdf([{ jpg: Buffer.from('nope'), w: 1, h: 1 }]) } catch { threw = true }
check('PDF：不是 JPEG 就报错', threw)

// 跳转链接和书签
check('pageLinks：跳到自己、目标不存在、页面外、不是数的都丢掉，越界的裁到页面里',
  JSON.stringify(pageLinks({ w: 100, h: 200, links: [
    { x: 10, y: 20, w: 30, h: 10, to: 1 }, { x: 0, y: 0, w: 5, h: 5, to: 0 }, { x: 0, y: 0, w: 5, h: 5, to: 9 },
    { x: 500, y: 0, w: 5, h: 5, to: 1 }, { x: 'a', y: 0, w: 5, h: 5, to: 1 }, { x: 90, y: 190, w: 40, h: 40, to: 1 },
  ] }, 2, 0)) === JSON.stringify([{ x: 10, y: 20, w: 30, h: 10, to: 1 }, { x: 90, y: 190, w: 10, h: 10, to: 1 }]))
const lp = makePdf([{ jpg: JPG, w: 390, h: 844, title: '首页', links: [{ x: 20, y: 700, w: 350, h: 48, to: 1 }] }, { jpg: JPG, w: 390, h: 844, title: 'Menu' }]).toString('latin1')
const pageObj = (n) => Number(new RegExp(`/Kids \\[(?:\\d+ 0 R ){${n}}(\\d+) 0 R`).exec(lp)[1])
const link = /\/Subtype \/Link \/Rect \[([\d. ]+)\] \/Border \[0 0 0\] \/Dest \[(\d+) 0 R \/Fit\]/.exec(lp)
check('PDF：按钮做成链接，点了跳到第二页（坐标换成 pt、上下翻过来）', link && link[1] === '15 72 277.5 108' && Number(link[2]) === pageObj(1), link && link.slice(1).join(' | '))
check('PDF：第一页登记了这个链接', new RegExp(`${pageObj(0)} 0 obj\\n<< /Type /Page [^\\n]*/Annots \\[\\d+ 0 R\\]`).test(lp))
check('PDF：每屏一条书签，中文名用 UTF-16', /\/Type \/Catalog \/Pages \d+ 0 R \/Outlines \d+ 0 R/.test(lp) && /\/Type \/Outlines [^>]*\/Count 2/.test(lp) && lp.includes('/Title <FEFF99969875> /Parent') && lp.includes('/Title (Menu)'))
check('PDF：只有一页不加书签', !makePdf([{ jpg: JPG, w: 10, h: 10, title: 'x' }]).toString('latin1').includes('/Outlines'))

// ── zip ──
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const n = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out = {}
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(at + 10)
    const crc = buf.readUInt32LE(at + 16)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    const lnl = buf.readUInt16LE(local + 26)
    const body = buf.subarray(local + 30 + lnl, local + 30 + lnl + size)
    const data = method === 8 ? zlib.inflateRawSync(body) : body
    out[name] = { data, crcOk: crc32(data) === crc }
    at += 46 + nameLen
  }
  return out
}
const z = unzip(zip([{ name: 'a.xml', data: '<a>你好</a>' }, { name: 'b.jpeg', data: JPG }]))
check('zip：解得开，校验和对，图片原样存', z['a.xml'].data.toString() === '<a>你好</a>' && z['a.xml'].crcOk && z['b.jpeg'].crcOk && z['b.jpeg'].data.equals(JPG))

// ── PPTX ──
check('幻灯片尺寸：16:9 和 PowerPoint 默认一样', JSON.stringify(slideSize(1280, 720)) === JSON.stringify({ cx: 12192000, cy: 6858000 }))
check('幻灯片尺寸：竖屏按比例，长边 13.333 英寸', JSON.stringify(slideSize(390, 844)) === JSON.stringify({ cx: Math.round(12192000 * 390 / 844), cy: 12192000 }))
const pp = unzip(makePptx([{ jpg: JPG, w: 390, h: 844, title: '登录 & <首页>' }, { jpg: JPG, w: 1280, h: 720, title: '宽的' }], { title: '咖啡', bg: 'f5efe6' }))
const need = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/media/image1.jpeg', 'docProps/core.xml']
check('PPTX：该有的部件都在，校验和都对', need.every((n) => pp[n]) && Object.values(pp).every((x) => x.crcOk), need.filter((n) => !pp[n]).join(','))
const xml = (n) => pp[n].data.toString('utf8')
check('PPTX：两张幻灯片都登记了', (xml('ppt/presentation.xml').match(/<p:sldId /g) || []).length === 2 && (xml('[Content_Types].xml').match(/slide\d\.xml"/g) || []).length === 2)
check('PPTX：尺寸按第一屏（竖的）', xml('ppt/presentation.xml').includes(`<p:sldSz cx="${Math.round(12192000 * 390 / 844)}" cy="12192000"/>`))
const s2 = xml('ppt/slides/slide2.xml')
const ext = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(s2.slice(s2.indexOf('<p:pic>'))).slice(1).map(Number)
check('PPTX：比例不一样的那屏按比例放进去、居中', ext[0] === 0 && Math.abs(ext[1] * 2 + ext[3] - 12192000) <= 1 && Math.abs(ext[2] / ext[3] - 16 / 9) < 0.01, ext.join(','))
check('PPTX：标题转义、留边铺底色', xml('ppt/slides/slide1.xml').includes('name="登录 &amp; &lt;首页&gt;"') && s2.includes('<a:srgbClr val="F5EFE6"/>'))
const lk = unzip(makePptx([{ jpg: JPG, w: 390, h: 844, title: 'A', links: [{ x: 0, y: 422, w: 390, h: 422, to: 2 }, { x: 0, y: 0, w: 10, h: 10, to: 2 }] }, { jpg: JPG, w: 390, h: 844, title: 'B' }, { jpg: JPG, w: 390, h: 844, title: 'C' }]))
const ls1 = lk['ppt/slides/slide1.xml'].data.toString('utf8')
const lr1 = lk['ppt/slides/_rels/slide1.xml.rels'].data.toString('utf8')
const hl = [...ls1.matchAll(/<a:hlinkClick r:id="(rId\d+)" action="ppaction:\/\/hlinksldjump"\/>/g)].map((m) => m[1])
check('PPTX：两个按钮两个透明形状，同一个目标只登记一次关系', hl.length === 2 && hl[0] === 'rId3' && hl[1] === 'rId3' && (lr1.match(/relationships\/slide"/g) || []).length === 1 && lr1.includes('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide3.xml"'), lr1)
const sp = /<p:sp>.*?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>.*?<a:noFill\/><a:ln><a:noFill\/><\/a:ln>/.exec(ls1)
check('PPTX：透明形状盖在下半屏（按比例换算）', sp && Number(sp[1]) === 0 && Math.abs(Number(sp[2]) - 6096000) <= 1 && Math.abs(Number(sp[4]) - 6096000) <= 1, sp && sp.slice(1).join(','))
check('PPTX：没链接的幻灯片没有多余的关系', !lk['ppt/slides/_rels/slide2.xml.rels'].data.toString('utf8').includes('relationships/slide"'))
check('PPTX：每个 XML 收尾对', Object.entries(pp).filter(([n]) => /\.(xml|rels)$/.test(n)).every(([, x]) => /<\/[\w:]+>$|\/>$/.test(x.data.toString('utf8').trim())))

// ── 接口 /api/doc ──
const { apply } = await import('../lib/index.js')
const handlers = {}
const ctx = {
  logger: { warn: () => {}, info: () => {} },
  effect: (fn) => { try { return fn() } catch { return () => {} } },
  webServer: { register: (r) => { handlers[r.path] = r.handler; return () => {} }, getOrigin: () => 'http://127.0.0.1:1' },
  tools: { register: () => {} },
  on: () => () => {},
  get: () => null,
  inject: () => {},
}
apply(ctx)
const srv = http.createServer((req, res) => {
  const h = handlers[new URL(req.url, 'http://x').pathname]
  if (h) h(req, res); else { res.writeHead(404); res.end() }
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const call = (name, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/dsh-design-studio/api/' + name, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let acc = ''
    res.on('data', (d) => { acc += d })
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(acc || '{}') }))
  })
  r.on('error', reject)
  r.end(data)
})
const site = path.join(tmp, 'site')
fs.mkdirSync(site)
fs.writeFileSync(path.join(site, 'home.html'), '<!doctype html><title>首页</title><p>hi</p>')
const opened = await call('open', { session: 's1', target: path.join(site, 'home.html') })
check('接口：先打开一个设计目录', opened.status === 200, JSON.stringify(opened.body))
const page = { jpg: JPG.toString('base64'), w: 390, h: 844, title: '首页', links: [{ x: 0, y: 0, w: 100, h: 40, to: 1 }] }
let r = await call('doc', { session: 's1', format: 'pdf', name: '咖啡/外带 App', pages: [page, page] })
check('接口：PDF 存进设计目录的 exports/', r.status === 200 && r.body.path === path.join(site, 'exports', '咖啡-外带-App.pdf') && fs.readFileSync(r.body.path).toString('latin1', 0, 8) === '%PDF-1.4', JSON.stringify(r.body))
r = await call('doc', { session: 's1', format: 'pdf', name: '咖啡/外带 App', pages: [page] })
check('接口：同名不覆盖', r.status === 200 && r.body.path.endsWith('咖啡-外带-App-2.pdf'), JSON.stringify(r.body))
r = await call('doc', { session: 's1', format: 'pptx', name: 'deck', title: '咖啡', bg: 'ffffff', pages: [page] })
check('接口：PPTX', r.status === 200 && r.body.path.endsWith('deck.pptx') && unzip(fs.readFileSync(r.body.path))['ppt/slides/slide1.xml'], JSON.stringify(r.body))
r = await call('doc', { session: 's1', format: 'docx', pages: [page] })
check('接口：不认识的格式拒', r.status === 400)
r = await call('doc', { session: 's1', format: 'pdf', pages: [{ ...page, jpg: Buffer.from('not a jpeg at all').toString('base64') }] })
check('接口：不是 JPEG 拒', r.status === 400)
r = await call('doc', { session: 's1', format: 'pdf', pages: [] })
check('接口：没有页面拒', r.status === 400)
r = await call('doc', { session: 's1', format: 'pdf', name: 'odd', pages: [{ ...page, w: -5, h: 1e9 }] })
check('接口：页面尺寸不像话就按图片的一半算', r.status === 200 && fs.readFileSync(r.body.path).toString('latin1').includes('/MediaBox [0 0 6 3]'), JSON.stringify(r.body))

srv.close()
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
