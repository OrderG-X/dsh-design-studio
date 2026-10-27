/**
 * check_design / look_design 在无头浏览器里干的活（浏览器见 browser.js）：
 * 量哪几屏、按哪几种尺寸，每屏开一个那么大的页面量问题 / 截图，最后拼成给模型的一段字。
 *
 * 量的是什么都写清楚（哪屏、多宽多高、页面多高、固定栏离内容多远），不只回一句「没问题」：
 * 模型拿到的是测量结果，不用再自己搭检查页、开浏览器截图去核实。
 */

import fs from 'node:fs'
import path from 'node:path'

export const KIND_SIZE = { web: [1280, 800], app: [390, 844], tablet: [820, 1180], poster: [1080, 1350], slides: [1280, 720], email: [640, 960] }
const KIND_LIST = Object.keys(KIND_SIZE)
const META_ALIAS = { phone: 'app', mobile: 'app', ios: 'app', android: 'app', pad: 'tablet', ipad: 'tablet', social: 'poster', image: 'poster', slide: 'slides', deck: 'slides', ppt: 'slides', mail: 'email' }
// 只给宽度时的高：常见真机的屏幕高；别的宽度按这一类默认的宽高比
const PHONE_H = { 320: 568, 360: 780, 375: 667, 390: 844, 393: 852, 402: 874, 412: 915, 414: 896, 428: 926, 430: 932, 440: 956 }
const TABLET_H = { 744: 1133, 768: 1024, 810: 1080, 820: 1180, 834: 1194, 1024: 1366, 1032: 1376 }

export const MAX_SCREENS = 12 // check_design 一次最多量几屏
export const MAX_SIZES = 4 // 最多几种尺寸
export const MAX_SHOTS = 8 // look_design 一次最多几张图

/** 页面里 <meta name="dsh-design" content="app"> / "poster 1080x1920" → { kind, size }（和右侧栏 client.js 的 parseMeta 一样） */
export function parseMeta(content) {
  const out = { kind: '', size: '' }
  for (const w of String(content || '').toLowerCase().split(/[\s,;]+/)) {
    if (!out.kind && (KIND_LIST.includes(w) || META_ALIAS[w])) out.kind = KIND_LIST.includes(w) ? w : META_ALIAS[w]
    const m = /^(\d{2,5})[x×*](\d{2,5})$/.exec(w)
    if (!out.size && m) out.size = `${m[1]}x${m[2]}`
  }
  return out
}

/** 'WxH' / 宽度数字 → [w, h]；不认识的给 null */
export function sizeOf(v, kind) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  let m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(s)
  if (m) {
    const w = +m[1], h = +m[2]
    return w >= 200 && h >= 200 && w <= 4000 && h <= 6000 ? [w, h] : null
  }
  m = /^(\d{2,5})(px)?$/.exec(s)
  if (!m) return null
  const w = +m[1]
  if (w < 200 || w > 4000) return null
  const [dw, dh] = KIND_SIZE[kind] || KIND_SIZE.web
  if (kind === 'app' && PHONE_H[w]) return [w, PHONE_H[w]]
  if (kind === 'tablet' && TABLET_H[w]) return [w, TABLET_H[w]]
  if (kind === 'app' || kind === 'tablet' || kind === 'poster' || kind === 'slides') return [w, Math.round((w * dh) / dw)]
  return [w, dh]
}

/** 设计稿是哪类、多大：preview_page 给的 → 页面里的 <meta name="dsh-design"> → 默认网页 */
export function designOf(snap, readHead) {
  let meta = { kind: '', size: '' }
  if (!snap.kind || !snap.size) {
    try { meta = parseMeta(readHead() || '') } catch { /* 读不到就按默认 */ }
  }
  const kind = KIND_LIST.includes(snap.kind) ? snap.kind : meta.kind || 'web'
  const size = sizeOf(snap.size, kind) || sizeOf(meta.size, kind) || KIND_SIZE[kind]
  return { kind, size }
}

/** 本地 HTML 文件里 dsh-design 那个 meta 的内容（只读开头一段） */
export function metaOfFile(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(16384)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const head = buf.subarray(0, n).toString('utf8')
    const tag = /<meta\b[^>]*\bname\s*=\s*["']?dsh-design["']?[^>]*>/i.exec(head)
    const c = tag && /\bcontent\s*=\s*(["'])([^"']*)\1/i.exec(tag[0])
    return c ? c[2] : ''
  } catch {
    return ''
  } finally {
    if (fd != null) try { fs.closeSync(fd) } catch { /* 关过了 */ }
  }
}

/** 要量 / 截的几屏：names（文件名、路由、去掉 .html 的名字都认）挑出来，不给就全部；单页预览就是那一页 */
export function pickScreens(snap, names, max) {
  const all = snap.screens && snap.screens.length ? snap.screens : [{ key: snap.focus || '', url: snap.url, label: snap.label || '' }]
  if (!Array.isArray(names) || !names.length) return { list: all.slice(0, max), missing: [], more: Math.max(0, all.length - max) }
  const norm = (x) => String(x || '').trim().replace(/^\.?\//, '').replace(/\.html?$/i, '').toLowerCase()
  const list = []
  const missing = []
  for (const n of names.slice(0, 40)) {
    const hit = all.find((s) => norm(s.key) === norm(n) || norm(s.label) === norm(n))
    if (!hit) missing.push(String(n).slice(0, 60))
    else if (!list.includes(hit)) list.push(hit)
  }
  return { list: list.slice(0, max), missing, more: Math.max(0, list.length - max) }
}

/** 截图的缩放：长边放大到 1568 像素左右（模型看图的常用上限），最多 2 倍 */
export const scaleFor = (w, h) => Math.max(1, Math.min(2, Math.round((1568 / Math.max(w, h)) * 100) / 100))

const READY = 'new Promise((r) => { const t = Date.now(); (function w() { if (window.__dshDesign || Date.now() - t > 4000) r(!!window.__dshDesign); else setTimeout(w, 50) })() })'

/** 开好一屏：等 picker 装上、字体图片载完；要深色就切过去 */
async function prepare(page, dark) {
  if (!(await page.eval(READY))) throw new Error('页面没装上设计台脚本（不是 HTML，或者载入出错）')
  await page.eval('window.__dshDesign.settle()')
  let darkOk = true
  if (dark) darkOk = await page.eval('window.__dshDesign.dark(true)')
  return { info: await page.eval('window.__dshDesign.info()'), darkOk }
}

/**
 * 量：每屏 × 每种尺寸开一个页面跑体检。
 * @returns [{ key, label, w, h, issues, metrics, error }]
 */
// 这几类问题由元素自己的哪项样式决定：量完顺手问一下是哪条规则，再找回文件和行号（模型不用再 grep）
const RULE_PROP = { contrast: 'color', tiny: 'font-size' }
const MAX_RULES = 12

export async function measureAll(browser, { screens, sizes, kind, dark, fetcher = globalThis.fetch, locate = null }) {
  const jobs = []
  for (const sc of screens) for (const [w, h] of sizes) jobs.push({ sc, w, h })
  const gone = new Map() // 地址 → Promise<是不是 404>（几屏、几种尺寸指着同一页只问一次）
  const isGone = (url) => {
    if (!gone.has(url)) {
      gone.set(url, (async () => {
        try {
          const r = await fetcher(url, { signal: AbortSignal.timeout(5000) })
          try { await r.body?.cancel() } catch { /* 不要内容 */ }
          return r.status === 404
        } catch { return false }
      })())
    }
    return gone.get(url)
  }
  const rows = await Promise.all(jobs.map(async ({ sc, w, h }, i) => {
    const row = { key: sc.key, label: sc.label || sc.key, w, h, issues: [], metrics: null, error: '' }
    try {
      await browser.withPage({ url: sc.url, w, h, dark }, async (page) => {
        const { info, darkOk } = await prepare(page, dark)
        if (info && info.title) row.title = String(info.title).slice(0, 40)
        if (dark && !darkOk) row.noDark = true
        const r = await page.eval(`window.__dshDesign.check(${JSON.stringify(kind)})`)
        row.issues = Array.isArray(r && r.issues) ? r.issues : []
        row.metrics = (r && r.metrics) || null
        if (locate) {
          for (const it of row.issues.filter((x) => RULE_PROP[x.type] && x.sel).slice(0, MAX_RULES)) {
            const prop = RULE_PROP[it.type]
            const rule = await page.eval(`(() => { const s = window.__dshDesign.style && window.__dshDesign.style(${JSON.stringify(it.sel)}); return s && s.rules ? s.rules[${JSON.stringify(prop)}] || null : null })()`).catch(() => null)
            if (rule && rule.inline) it.rule = { prop, inline: true }
            else if (rule && rule.sel) it.rule = { prop, sel: rule.sel, href: rule.href, n: rule.n, ...(rule.maybe ? { maybe: true } : {}) }
          }
        }
        // 跳转：每屏只在第一种尺寸上收一次（几种尺寸下链接一样）
        if (i % sizes.length === 0 && fetcher) row.links = await page.eval('window.__dshDesign.links ? window.__dshDesign.links() : []').catch(() => [])
      })
    } catch (e) {
      row.error = String((e && e.message) || e).slice(0, 160)
    }
    return row
  }))
  // 规则 → 文件和行号（一次问完）
  if (locate) {
    const withRule = rows.flatMap((r) => r.issues.filter((it) => it.rule && it.rule.sel))
    if (withRule.length) {
      let found = []
      try { found = await locate(withRule.map((it) => it.rule)) } catch { found = [] }
      withRule.forEach((it, i) => { if (found[i] && found[i].file) Object.assign(it.rule, { file: found[i].file, line: found[i].line || 0 }) })
    }
  }
  // 跳到不存在的页面（404）：算在这一屏每种尺寸上（不是某个尺寸才有的问题）
  for (const sc of screens) {
    const first = rows.find((r) => r.key === sc.key && Array.isArray(r.links))
    if (!first) continue
    const dead = []
    const seen = new Set()
    for (const l of first.links.slice(0, 40)) {
      if (!l || typeof l.path !== 'string' || seen.has(l.path)) continue
      seen.add(l.path)
      let url
      try { url = new URL(l.path.split('/').map(encodeURIComponent).join('/'), sc.url).href } catch { continue }
      if (await isGone(url)) dead.push({ type: 'deadlink', sel: '', text: String(l.text || '').slice(0, 24), src: l.path.replace(/^\//, '') })
    }
    for (const r of rows) if (r.key === sc.key && !r.error) r.issues.push(...dead)
    first.linkCount = seen.size // 查了几个跳转（没问题也让模型知道查过）
  }
  for (const r of rows) delete r.links
  return rows
}

/**
 * 截图：每屏一张（at = top 顶上一屏 / bottom 滚到底 / full 从上到下几屏），selector 只截那个元素。
 * @returns [{ key, label, w, h, at, part, of, jpg, note }]
 */
export async function shootAll(browser, { screens, size, at, selector, dark, max = MAX_SHOTS }) {
  const [w, h] = size
  const scale = scaleFor(w, h)
  const out = []
  const perScreen = at === 'full' ? Math.max(1, Math.floor(max / Math.max(1, screens.length))) : 1
  await Promise.all(screens.map(async (sc, si) => {
    const shots = []
    const base = { key: sc.key, label: sc.label || sc.key, w, h }
    try {
      await browser.withPage({ url: sc.url, w, h, scale, dark }, async (page) => {
        const { info, darkOk } = await prepare(page, dark)
        const title = info && info.title ? String(info.title).slice(0, 40) : ''
        const note = { page: info ? info.page : 0, title, noDark: dark && !darkOk }
        if (selector) {
          const r = await page.eval(`window.__dshDesign.rect(${JSON.stringify(String(selector).slice(0, 200))})`)
          if (!r || r.w < 1 || r.h < 1) { shots.push({ ...base, ...note, at: 'selector', error: `没找到「${selector}」或它没有大小` }); return }
          // 四周留 8px，但不伸出视口（元素比视口大就只截视口里那块）
          const pad = 8
          const vx = r.vx || 0, vy = r.vy || 0, vw = r.vw || w, vh = r.vh || h
          const x0 = Math.max(vx, r.x - pad), y0 = Math.max(vy, r.y - pad)
          const x1 = Math.min(vx + vw, r.x + r.w + pad), y1 = Math.min(vy + vh, r.y + r.h + pad)
          if (x1 - x0 < 1 || y1 - y0 < 1) { shots.push({ ...base, ...note, at: 'selector', error: `「${selector}」不在屏幕里` }); return }
          const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
          shots.push({ ...base, ...note, at: 'selector', jpg: await page.shot({ clip }) })
          return
        }
        if (at === 'bottom') {
          await page.eval("window.__dshDesign.scroll('end')")
          shots.push({ ...base, ...note, at, jpg: await page.shot() })
          return
        }
        if (at === 'full') {
          // 段数超过能截的张数：截前面几段 + 最后一段（底栏压没压住内容在最后一段看），说明里写明跳过了哪些
          const cap = Math.min(perScreen, 4)
          const s0 = await page.eval('window.__dshDesign.scroll(0)')
          const of = (s0 && s0.of) || 1
          const parts = of <= cap ? [...Array(of).keys()] : [...[...Array(cap - 1).keys()], of - 1]
          for (const i of parts) {
            if (i) await page.eval(`window.__dshDesign.scroll(${i})`)
            shots.push({ ...base, ...note, at, part: i + 1, of, jpg: await page.shot() })
          }
          return
        }
        shots.push({ ...base, ...note, at: 'top', jpg: await page.shot() })
      })
    } catch (e) {
      shots.push({ ...base, at, error: String((e && e.message) || e).slice(0, 160) })
    }
    out[si] = shots
  }))
  return out.flat().filter(Boolean)
}

// ── 给模型的字 ────────────────────────────────────────────────────────────

const TYPE = {
  hscroll: '超出屏幕', clipped: '文字被截断', overflow: '文字超出框', overlap: '文字叠在一起', contrast: '对比度不够', tap: '点击区太小',
  tiny: '字太小', img: '图片没加载出来', fonts: '字号太杂', distort: '图片被拉变形', long: '一行太长', wrap: '文字被挤断行',
  covered: '被固定栏压住', tight: '离固定栏太近', jserr: '页面脚本报错', missing: '文件没载出来', deadlink: '跳到的页面不存在',
}
const EDGE = { top: '顶栏', bottom: '底栏' }
const WHAT = { css: '样式表', script: '脚本', font: '字体', link: '文件', video: '视频', audio: '音频', source: '媒体', iframe: '内嵌页' }

const PROP = { color: '文字颜色', 'font-size': '字号' }
/** 问题由哪条样式规则决定、在哪个文件第几行（找得到才写） */
function whereRule(r) {
  if (!r) return ''
  if (r.inline) return `；${PROP[r.prop] || r.prop}写在元素的行内 style 上`
  if (!r.sel) return ''
  const at = r.file ? `，${r.file}${r.line ? ` 第 ${r.line} 行` : ''}` : ''
  return `；${PROP[r.prop] || r.prop}${r.maybe ? '大概' : ''}由 ${r.sel} 决定${at}`
}

/** 一条问题的具体数字 */
export function detailOf(it) {
  switch (it.type) {
    case 'hscroll': return `伸出屏幕 ${it.px}px`
    case 'clipped': return `被切掉 ${it.px}px`
    case 'overflow': return `伸出框 ${it.px}px`
    case 'overlap': return `和 ${it.other}「${String(it.otherText || '').slice(0, 20)}」叠在一起`
    case 'deadlink': return `指向 ${it.src}，这个文件不存在（404）：补上这一屏，或改成已有的屏`
    case 'contrast': return `${it.fg} 配 ${it.bg}，${it.ratio}:1（要 ≥ ${it.need}:1）`
    case 'tap': return `${it.w}×${it.h}（至少 ${it.min}×${it.min}）`
    case 'tiny': return `${it.size}px（至少 ${it.min}px）`
    case 'img': return String(it.src || '')
    case 'fonts': return `一屏用了 ${(it.sizes || []).length} 种字号：${(it.sizes || []).join(' / ')}`
    case 'distort': return `原图 ${it.nw}×${it.nh}，显示成 ${it.w}×${it.h}（用 object-fit: cover 或改尺寸）`
    case 'long': return `一行约 ${it.chars} 字（最好 ≤ ${it.max}）`
    case 'wrap': return `折成了 ${it.lines} 行（给它更多宽度、white-space: nowrap 或缩短文字）`
    case 'covered': return `${it.edge === 'top' ? '没滚时' : '滚到底还'}被${EDGE[it.edge] || ''} ${it.bar} 压住 ${it.px}px（给内容留出栏的高度：${it.edge === 'top' ? 'padding-top' : 'padding-bottom'}，栏是 fixed 时也可以用 scroll-padding）`
    case 'tight': return `离${EDGE[it.edge] || ''} ${it.bar} 只有 ${it.px}px（留 16px 以上）`
    case 'jserr': return `${it.msg}${it.src ? `（${it.src}${it.line ? `:${it.line}` : ''}）` : ''}`
    case 'missing': return `${WHAT[it.what] || '文件'} ${it.src} 载不出来（路径写错了，或者文件不在）`
    default: return ''
  }
}

const sizeText = (w, h) => `${w}×${h}`
const nameOf = (r) => `${r.key}${r.title && r.title !== r.key ? `「${r.title}」` : ''}`

/** 一种尺寸下这一屏量出来的样子：页面多高、固定栏多高、离内容多远 */
function metricsLine(m) {
  if (!m) return ''
  const parts = [m.page > m.h + 1 ? `页面高 ${m.page}（比屏幕高，要滚动，正常）` : `页面高 ${m.page}（一屏放得下）`]
  if (m.areas) parts.push(`里面有 ${m.areas} 块能单独滚的区域`)
  for (const b of m.bars || []) {
    const gap = b.gap == null ? '' : b.gap < 0 ? `，压住内容 ${-b.gap}px` : `，${b.edge === 'bottom' ? '滚到底时' : ''}离内容 ${b.gap}px`
    parts.push(`${EDGE[b.edge] || '栏'} ${b.name} 高 ${b.h}${gap}`)
  }
  return parts.join('；')
}

/**
 * 体检结果 → 给模型的字。同一屏几种尺寸都有的问题只列一次，只在部分尺寸出现的标上尺寸
 * @param rows measureAll 的结果
 */
/** 一条问题认得出是同一个（复查时比上次修好了哪些、新出了哪些） */
const issueKey = (it) => `${it.type}|${it.sel}|${it.text || ''}|${it.msg || ''}|${it.src || ''}`
const rowKey = (r, dark) => `${r.key}|${r.w}x${r.h}${dark ? '|dark' : ''}`

/** 这次量出来的（每屏每种尺寸一组问题），下次复查拿来比 */
export function issueSnapshot(rows, dark = false) {
  const out = new Map()
  for (const r of rows) if (!r.error) out.set(rowKey(r, dark), new Set(r.issues.map(issueKey)))
  return out
}

export function formatMeasure(rows, { sizes, where, missing = [], more = 0, dark = false, prev = null }) {
  const keys = [...new Set(rows.map((r) => r.key))]
  const n = new Set(rows.flatMap((r) => r.issues.map((it) => `${r.key}|${issueKey(it)}`))).size
  const failed = rows.filter((r) => r.error).length
  // 和上次同样的屏、同样的尺寸比：修好了几个、新出了几个（新的在清单里标出来）
  const fresh = new Set()
  let fixed = 0
  let compared = 0
  if (prev) {
    for (const r of rows) {
      const before = r.error ? null : prev.get(rowKey(r, dark))
      if (!before) continue
      compared++
      const now = new Set(r.issues.map(issueKey))
      for (const k of before) if (!now.has(k)) fixed++
      for (const k of now) if (!before.has(k)) fresh.add(`${r.key}|${k}`)
    }
  }
  const sz = sizes.map(([w, h]) => sizeText(w, h)).join('、')
  const status = failed === rows.length
    ? '一次都没量成，这次检查没完成（原因见下）。'
    : n
      ? `发现 ${n} 个问题，逐个改源文件，只动有问题的地方；颜色、字号能改设计变量就改设计变量${failed ? `（另有 ${failed} 次没量成，见下，检查不完整）` : ''}：`
      : failed
        ? `量成的都没问题，但有 ${failed} 次没量成（见下），这次检查不完整。`
        : '没发现问题：下面每屏每种尺寸都量过、都通过了（要滚动的屏看「滚到底时离内容」，是正数就没被压住）。'
  const lines = [`用无头浏览器按真实尺寸量了 ${keys.length} 屏 × ${sizes.length} 种尺寸（${sz}${dark ? '，深色' : ''}）${where ? `，设计目录 ${where}` : ''}。${status}`]
  if (compared) lines.push(`比上次（同样的屏和尺寸）：修好 ${fixed} 个，新出 ${fresh.size} 个${fresh.size ? '（清单里标了「新」）' : ''}。`)
  if (missing.length) lines.push(`没找到这几屏：${missing.join('、')}`)
  if (more) lines.push(`还有 ${more} 屏这次没量（一次最多 ${MAX_SCREENS} 屏，用 screens 挑着量）`)
  for (const key of keys) {
    const mine = rows.filter((r) => r.key === key)
    lines.push('', nameOf(mine.find((r) => r.title) || mine[0]))
    for (const r of mine) {
      if (r.error) lines.push(`  ${sizeText(r.w, r.h)}：没量成（${r.error}）`)
      else lines.push(`  ${sizeText(r.w, r.h)}：${metricsLine(r.metrics)}${r.noDark ? '；这一屏没有深色样式，量的是浅色' : ''}`)
    }
    const seen = new Map()
    for (const r of mine) {
      for (const it of r.issues) {
        const k = issueKey(it)
        if (!seen.has(k)) seen.set(k, { it, at: [] })
        seen.get(k).at.push(sizeText(r.w, r.h))
      }
    }
    const ok = mine.filter((r) => !r.error).length
    let i = 0
    for (const [k, { it, at }] of seen) {
      const tag = (fresh.has(`${key}|${k}`) ? '[新] ' : '') + (at.length < ok && mine.length > 1 ? `[${at.join('、')}] ` : '')
      const what = [it.sel, it.text ? `「${it.text}」` : ''].filter(Boolean).join('')
      lines.push(`  ${++i}. ${tag}${TYPE[it.type] || it.type}${what ? `：${what}` : ''} — ${detailOf(it)}${whereRule(it.rule)}`)
    }
    const lc = mine.find((r) => typeof r.linkCount === 'number')
    if (lc && lc.linkCount) {
      const dead = [...seen.values()].filter(({ it }) => it.type === 'deadlink').length
      lines.push(`  跳转：查了 ${lc.linkCount} 个，${dead ? `${dead} 个打不开（见上）` : '都能打开'}`)
    }
  }
  return lines.join('\n') + '\n'
}

/** 截图的说明：第几张是哪屏、什么尺寸、哪一段 */
export function formatShots(shots, { where, missing = [], more = 0 }) {
  const AT = { top: '顶上一屏', bottom: '滚到底', selector: '元素' }
  const lines = [`无头浏览器按真实尺寸截的图（真实渲染的像素）${where ? `，设计目录 ${where}` : ''}：`]
  let n = 0
  for (const s of shots) {
    const what = s.at === 'full' ? `第 ${s.part}/${s.of} 屏` : AT[s.at] || ''
    if (s.error) { lines.push(`- ${nameOf(s)} ${sizeText(s.w, s.h)} ${what}：没截成（${s.error}）`); continue }
    lines.push(`- 图 ${++n}：${nameOf(s)} ${sizeText(s.w, s.h)} ${what}${s.page ? `，页面高 ${s.page}` : ''}${s.noDark ? '，没有深色样式（截的是浅色）' : ''}`)
  }
  for (const key of new Set(shots.filter((s) => s.at === 'full' && s.of > 1 && !s.error).map((s) => s.key))) {
    const mine = shots.filter((s) => s.key === key && s.at === 'full' && !s.error)
    const skipped = mine[0].of - mine.length
    if (skipped > 0) lines.push(`${key} 一共 ${mine[0].of} 段，中间 ${skipped} 段没截（要看就单截这一屏，或用 selector 截那一块）`)
  }
  if (missing.length) lines.push(`没找到这几屏：${missing.join('、')}`)
  if (more) lines.push(`还有 ${more} 屏没截（一次最多 ${MAX_SHOTS} 张，用 screens 挑着截）`)
  return lines.join('\n')
}

/** 设计目录（给模型看文件在哪）：本地文件预览是那个目录，开发服务器是地址 */
export function whereOf(snap) {
  if (snap.target && snap.target.kind === 'file') return path.dirname(snap.target.file)
  return ''
}
