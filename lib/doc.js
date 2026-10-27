/**
 * 导出成文档：几屏截图（JPEG）拼成 PDF（每屏一页）或 PPT（每屏一张幻灯片，整页一张图）。
 * 不靠第三方库：PDF 直接写对象和交叉引用表，JPEG 原样塞进去（DCTDecode）；PPTX 是一个 zip，自己写最简的那几份 XML。
 * 屏和屏之间的跳转（原型里的按钮）照样能点：PDF 是链接注释，PPT 是盖在按钮上的透明形状（放映时点了跳到那一张）。
 */

import zlib from 'node:zlib'

/** JPEG 的宽高和通道数（读 SOF 段）；不是 JPEG 返回 null */
export function jpegInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null
    const m = buf[i + 1]
    if (m === 0xff) { i++; continue } // 填充
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    // SOF0–SOF15，除了 DHT(C4)、JPG(C8)、DAC(CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), comps: buf[i + 9] }
    }
    i += 2 + len
  }
  return null
}

/**
 * 这一页上跳到别的页的地方：[{ x, y, w, h, to }]，坐标是这一页的 CSS 像素，to 是目标页的下标。
 * 跳到自己、目标不存在、在页面外的都丢掉；最多 50 个
 */
export function pageLinks(p, count, self) {
  const out = []
  for (const l of Array.isArray(p && p.links) ? p.links : []) {
    const to = Number(l && l.to)
    if (!Number.isInteger(to) || to < 0 || to >= count || to === self) continue
    const [x, y, w, h] = [l.x, l.y, l.w, l.h].map(Number)
    if (![x, y, w, h].every(Number.isFinite)) continue
    const x1 = Math.max(0, x)
    const y1 = Math.max(0, y)
    const x2 = Math.min(p.w, x + w)
    const y2 = Math.min(p.h, y + h)
    if (x2 - x1 < 2 || y2 - y1 < 2) continue
    out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, to })
    if (out.length >= 50) break
  }
  return out
}

// ── PDF ──────────────────────────────────────────────────────────────────

/** PDF 文本串：纯 ASCII 用 ( )，带中文用 UTF-16BE 十六进制 */
function pdfText(s) {
  s = String(s)
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, '\\$&') + ')'
  const b = Buffer.from('﻿' + s, 'utf16le')
  for (let i = 0; i < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x }
  return '<' + b.toString('hex').toUpperCase() + '>'
}

/**
 * pages: [{ jpg: Buffer, w, h, title?, links? }]，w / h 是这一页的 CSS 像素（1px 按 0.75pt 算，和浏览器打印一样大）
 * 每页一张图铺满；有名字的页进书签，links 是点了跳到别的页的地方（见 pageLinks）。
 */
export function makePdf(pages, { title = '' } = {}) {
  const objs = [] // 下标 + 1 = 对象号
  const add = (parts) => { objs.push(parts); return objs.length }
  const catalog = add(null)
  const tree = add(null)
  const kids = pages.map(() => add(null)) // 页先占号：页上的链接要指到后面的页
  pages.forEach((p, i) => {
    const info = jpegInfo(p.jpg)
    if (!info) throw new Error('不是 JPEG')
    const cs = info.comps === 1 ? '/DeviceGray' : info.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB'
    const W = +(p.w * 0.75).toFixed(2)
    const H = +(p.h * 0.75).toFixed(2)
    const img = add([`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${info.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} /Length ${p.jpg.length} >>\nstream\n`, p.jpg, '\nendstream'])
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
    const content = add([`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`])
    const pt = (v) => +(v * 0.75).toFixed(2)
    const annots = pageLinks(p, pages.length, i).map((l) =>
      add([`<< /Type /Annot /Subtype /Link /Rect [${pt(l.x)} ${pt(p.h - l.y - l.h)} ${pt(l.x + l.w)} ${pt(p.h - l.y)}] /Border [0 0 0] /Dest [${kids[l.to]} 0 R /Fit] >>`]))
    objs[kids[i] - 1] = [`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R` +
      `${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`]
  })
  // 书签：每屏一条，名字是屏名（只有一页就不要了）
  const marks = pages.map((p, i) => ({ i, title: String(p.title || '').trim().slice(0, 120) })).filter((x) => x.title)
  let outlines = 0
  if (pages.length > 1 && marks.length) {
    outlines = add(null)
    const items = marks.map(() => add(null))
    items.forEach((o, k) => {
      objs[o - 1] = [`<< /Title ${pdfText(marks[k].title)} /Parent ${outlines} 0 R${k ? ` /Prev ${items[k - 1]} 0 R` : ''}${k < items.length - 1 ? ` /Next ${items[k + 1]} 0 R` : ''} /Dest [${kids[marks[k].i]} 0 R /Fit] >>`]
    })
    objs[outlines - 1] = [`<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`]
  }
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${tree} 0 R${outlines ? ` /Outlines ${outlines} 0 R` : ''} >>`]
  objs[tree - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`]
  const meta = add([`<< /Producer (dsh-design-studio)${title ? ` /Title ${pdfText(title)}` : ''} >>`])

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let at = chunks[0].length
  const offsets = []
  objs.forEach((parts, i) => {
    offsets.push(at)
    const bufs = [Buffer.from(`${i + 1} 0 obj\n`), ...parts.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x, 'latin1'))), Buffer.from('\nendobj\n')]
    for (const b of bufs) { chunks.push(b); at += b.length }
  })
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${meta} 0 R >>\nstartxref\n${at}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(chunks)
}

// ── ZIP（PPTX 用）─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** files: [{ name, data }]；文字压缩，图片（已经压过）原样存 */
export function zip(files) {
  const local = []
  const central = []
  let at = 0
  // 固定一个 DOS 时间（2026-01-01 00:00），同样的输入出同样的文件
  const dosTime = 0
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8')
    const store = /\.(jpe?g|png)$/i.test(f.name)
    const body = store ? raw : zlib.deflateRawSync(raw)
    const crc = crc32(raw)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
    head.writeUInt16LE(store ? 0 : 8, 8)
    head.writeUInt16LE(dosTime, 10)
    head.writeUInt16LE(dosDate, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(raw.length, 22)
    head.writeUInt16LE(name.length, 26)
    head.writeUInt16LE(0, 28)
    local.push(head, name, body)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(store ? 0 : 8, 10)
    cen.writeUInt16LE(dosTime, 12)
    cen.writeUInt16LE(dosDate, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(at, 42)
    central.push(cen, name)
    at += head.length + name.length + body.length
  }
  const cdir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cdir.length, 12)
  end.writeUInt32LE(at, 16)
  return Buffer.concat([...local, cdir, end])
}

// ── PPTX ─────────────────────────────────────────────────────────────────

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const EMU_MAX = 51206400 // PowerPoint 允许的最大边长（56 英寸）
const EMU_MIN = 914400

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

function rels(list) {
  return XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('') + '</Relationships>'
}

const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

function theme() {
  const solid = (c) => `<a:solidFill><a:schemeClr val="${c}"/></a:solidFill>`
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`
  const font = (latin) => `<a:latin typeface="${latin}"/><a:ea typeface=""/><a:cs typeface=""/>`
  const sys = (name, val) => `<a:${name}><a:srgbClr val="${val}"/></a:${name}>`
  return XML + `<a:theme xmlns:a="${NS_A}" name="Design Studio"><a:themeElements>` +
    '<a:clrScheme name="Design Studio">' + sys('dk1', '000000') + sys('lt1', 'FFFFFF') + sys('dk2', '1F2937') + sys('lt2', 'F3F4F6') +
    sys('accent1', '4D6BFE') + sys('accent2', 'F59E0B') + sys('accent3', '10B981') + sys('accent4', 'EF4444') + sys('accent5', '8B5CF6') + sys('accent6', '06B6D4') +
    sys('hlink', '4D6BFE') + sys('folHlink', '8B5CF6') + '</a:clrScheme>' +
    `<a:fontScheme name="Design Studio"><a:majorFont>${font('Calibri')}</a:majorFont><a:minorFont>${font('Calibri')}</a:minorFont></a:fontScheme>` +
    '<a:fmtScheme name="Design Studio">' +
    `<a:fillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
}

/** 幻灯片尺寸：按第一屏的比例，长边 13.333 英寸（和 PowerPoint 默认 16:9 一样宽） */
export function slideSize(w, h) {
  const LONG = 12192000
  let cx = w >= h ? LONG : Math.round(LONG * w / h)
  let cy = w >= h ? Math.round(LONG * h / w) : LONG
  cx = Math.min(EMU_MAX, Math.max(EMU_MIN, cx))
  cy = Math.min(EMU_MAX, Math.max(EMU_MIN, cy))
  return { cx, cy }
}

/**
 * pages: [{ jpg: Buffer, w, h, title, links? }]；每张幻灯片一张图，按比例放进去居中（比例不一样的留边，边上铺 bg 色）。
 * links 上盖透明形状，放映时点了跳到那一张。bg: 'RRGGBB'
 */
export function makePptx(pages, { title = '', bg = 'FFFFFF', date = new Date() } = {}) {
  if (!pages.length) throw new Error('没有页面')
  const { cx, cy } = slideSize(pages[0].w, pages[0].h)
  const fill = /^[0-9a-f]{6}$/i.test(bg) ? bg.toUpperCase() : 'FFFFFF'
  const files = []
  const slides = pages.map((p, i) => {
    if (!jpegInfo(p.jpg)) throw new Error('不是 JPEG')
    const n = i + 1
    const k = Math.min(cx / p.w, cy / p.h)
    const w = Math.round(p.w * k)
    const ht = Math.round(p.h * k)
    const x = Math.round((cx - w) / 2)
    const y = Math.round((cy - ht) / 2)
    const name = xmlEsc(p.title || `Screen ${n}`)
    // 跳转：每个目标页一条关系（rId3 起），每个按钮一个透明形状
    const targets = []
    const hot = pageLinks(p, pages.length, i).map((l, j) => {
      let r = targets.indexOf(l.to)
      if (r < 0) { targets.push(l.to); r = targets.length - 1 }
      return `<p:sp><p:nvSpPr><p:cNvPr id="${j + 3}" name="Link ${j + 1}"><a:hlinkClick r:id="rId${r + 3}" action="ppaction://hlinksldjump"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${x + Math.round(l.x * k)}" y="${y + Math.round(l.y * k)}"/><a:ext cx="${Math.max(1, Math.round(l.w * k))}" cy="${Math.max(1, Math.round(l.h * k))}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>'
    }).join('')
    files.push({ name: `ppt/media/image${n}.jpeg`, data: p.jpg })
    files.push({
      name: `ppt/slides/slide${n}.xml`,
      data: XML + `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld name="${name}">` +
        `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
        `<p:spTree>${EMPTY_TREE}<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${ht}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
        hot + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    })
    files.push({
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'], ['rId2', `${REL}/image`, `../media/image${n}.jpeg`],
        ...targets.map((to, r) => [`rId${r + 3}`, `${REL}/slide`, `slide${to + 1}.xml`])]),
    })
    return n
  })

  const CT = 'application/vnd.openxmlformats-officedocument.presentationml'
  files.unshift(
    {
      name: '[Content_Types].xml',
      data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
        `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>` +
        `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>` +
        `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>` +
        slides.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${CT}.slide+xml"/>`).join('') +
        `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presProps+xml"/>` +
        `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.viewProps+xml"/>` +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.tableStyles+xml"/>` +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data: rels([
        ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
        ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
        ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
      ]),
    },
    {
      name: 'docProps/core.xml',
      data: XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${xmlEsc(title)}</dc:title><dc:creator>dsh-design-studio</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${date.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
        '</cp:coreProperties>',
    },
    {
      name: 'docProps/app.xml',
      data: XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>dsh-design-studio</Application>' +
        `<Slides>${slides.length}</Slides></Properties>`,
    },
    {
      name: 'ppt/presentation.xml',
      data: XML + `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        `<p:sldIdLst>${slides.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n + 2}"/>`).join('')}</p:sldIdLst>` +
        `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: rels([
        ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
        ['rId2', `${REL}/theme`, 'theme/theme1.xml'],
        ...slides.map((n) => [`rId${n + 2}`, `${REL}/slide`, `slides/slide${n}.xml`]),
        [`rId${slides.length + 3}`, `${REL}/presProps`, 'presProps.xml'],
        [`rId${slides.length + 4}`, `${REL}/viewProps`, 'viewProps.xml'],
        [`rId${slides.length + 5}`, `${REL}/tableStyles`, 'tableStyles.xml'],
      ]),
    },
    { name: 'ppt/presProps.xml', data: XML + `<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>` },
    { name: 'ppt/viewProps.xml', data: XML + `<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: 'ppt/tableStyles.xml', data: XML + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/theme/theme1.xml', data: theme() },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: XML + `<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'], ['rId2', `${REL}/theme`, '../theme/theme1.xml']]) },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: XML + `<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]) },
  )
  return zip(files)
}
