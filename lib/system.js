/**
 * 设计系统：从用户自己的网站或代码里提一套品牌规范，存进设计系统库，以后做新设计都照它来。
 *
 *   <库>/<名字>/tokens.css       设计变量（和 ui-design 技能的起手模板同一套名字，设计目录直接复制过去 link）
 *   <库>/<名字>/components.css   按钮、卡片、输入框、标签、文字样式，照网站原样，全用上面的变量
 *   <库>/<名字>/components.html  样张：色板、字号、组件（工作台里能打开看）
 *   <库>/<名字>/DESIGN.md        说明：每个颜色干什么用、字体、组件写法、注意事项（品牌气质由模型补）
 *   <库>/<名字>/system.json      { name, sources, createdAt }
 *   <库>/<名字>/source/          网站截图、组件截图；preview.jpg 是样张的缩略图
 *   <库>/index.json              { default: 名字 }：做新设计默认用哪套
 *
 * 提取：网站地址 / 本地 HTML 用无头浏览器打开，在页面里量算出来的样式（颜色按面积、字按字数加权；字体、字号、圆角、阴影；
 *      按钮、输入框、卡片、顶栏长什么样）；项目文件夹先扫样式文件（CSS 变量、写死的颜色、字体、圆角、Tailwind 配置、用了哪个组件库），
 *      里面有能直接打开的 HTML 也量一下。量到的数归成角色（背景、表面、正文、次要文字、主色、主色上的字、点缀、边框），
 *      写成上面几个文件，交给模型核对、补说明。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SYSTEMS_DIR = process.env.DSH_DESIGN_SYSTEMS_DIR || path.join(os.homedir(), '.dsh', 'design-systems') // 测试时用环境变量换到临时目录
export const MAX_SOURCES = 5
const MAX_CROPS = 4
const SCAN_EXT = /\.(css|scss|sass|less|styl|pcss|vue|svelte|astro|html?)$/i
const THEME_FILE = /(^|[\\/])(tailwind\.config\.[cm]?[jt]s|[\w.-]*theme[\w.-]*\.[cm]?[jt]s|tokens?\.[cm]?[jt]s|colors?\.[cm]?[jt]s)$/i
const SKIP_DIR = /^(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.output|\.svelte-kit|\.cache|\.turbo|coverage|vendor|exports|refs|handoff|drafts)$|^\./
const MAX_SCAN_FILES = 1500
const MAX_SCAN_BYTES = 400 * 1024
const CJK_SANS = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif'
const CJK_SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
const HAS_CJK_FONT = /PingFang|YaHei|Hiragino Sans GB|Noto (Sans|Serif) (SC|CJK)|Source Han|HarmonyOS|MiSans|Songti|SimSun|SimHei/i

// ── 颜色：CSS 写法 ↔ sRGB ↔ OKLab，对比度 ────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function toOklab([r, g, b]) {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return rgb.map((c) => Math.round(clamp(gam(clamp(c, 0, 1)), 0, 1) * 255))
}

/** { L, C, H }：明度 0–1、彩度、色相（度） */
export function lch(rgb) {
  const [L, a, b] = toOklab(rgb)
  return { L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

/** 两个颜色差多少（OKLab 距离 × 100，差 2 以内肉眼几乎分不出） */
export function deltaE(a, b) {
  const x = toOklab(a), y = toOklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
}

const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255)
export function contrast(a, b) {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

export const hexOf = (c) => '#' + c.slice(0, 3).map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')

/** 两个颜色按 t（0–1，t 是 b 的份量）在 OKLab 里混 */
export function mix(a, b, t) {
  const x = toOklab(a), y = toOklab(b)
  return fromOklab(x.map((v, i) => v + (y[i] - v) * t))
}

function hsl2rgb(h, s, l) {
  s = clamp(s, 0, 100) / 100
  l = clamp(l, 0, 100) / 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255))
}

const NAMED = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], gray: [128, 128, 128], grey: [128, 128, 128], orange: [255, 165, 0] }

/** CSS 颜色 → [r, g, b, a]（a 0–1）；认不出、透明给 null。也认 shadcn 那种「222.2 47.4% 11.2%」的 HSL 三元组 */
export function parseColor(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase()
  if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor' || s === 'inherit') return null
  if (NAMED[s]) return [...NAMED[s], 1]
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1]
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((x) => parseInt(x + x, 16))
      return [v[0], v[1], v[2], h.length === 4 ? Math.round((v[3] / 255) * 100) / 100 : 1]
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16))
      return [v[0], v[1], v[2], h.length === 8 ? Math.round((v[3] / 255) * 100) / 100 : 1]
    }
    return null
  }
  const parts = (body) => body.split(/[\s,/]+/).filter(Boolean)
  const alpha = (v) => (v == null ? 1 : clamp(/%$/.test(v) ? parseFloat(v) / 100 : parseFloat(v), 0, 1))
  m = /^rgba?\(([^)]*)\)$/.exec(s)
  if (m) {
    const p = parts(m[1])
    if (p.length < 3) return null
    const ch = (v) => clamp(/%$/.test(v) ? (parseFloat(v) * 255) / 100 : parseFloat(v), 0, 255)
    const v = p.slice(0, 3).map(ch)
    if (v.some((x) => !Number.isFinite(x))) return null
    const a = alpha(p[3])
    return a > 0 ? [...v.map(Math.round), a] : null
  }
  const hue = (v) => (/turn$/.test(v) ? parseFloat(v) * 360 : /rad$/.test(v) ? (parseFloat(v) * 180) / Math.PI : parseFloat(v))
  m = /^hsla?\(([^)]*)\)$/.exec(s)
  if (m) {
    const p = parts(m[1])
    if (p.length < 3) return null
    const v = hsl2rgb(hue(p[0]), parseFloat(p[1]), parseFloat(p[2]))
    if (v.some((x) => !Number.isFinite(x))) return null
    const a = alpha(p[3])
    return a > 0 ? [...v, a] : null
  }
  m = /^oklch\(([^)]*)\)$/.exec(s)
  if (m) {
    const p = parts(m[1])
    if (p.length < 3) return null
    const L = /%$/.test(p[0]) ? parseFloat(p[0]) / 100 : parseFloat(p[0])
    const C = /%$/.test(p[1]) ? (parseFloat(p[1]) / 100) * 0.4 : parseFloat(p[1])
    const H = p[2] === 'none' ? 0 : (hue(p[2]) * Math.PI) / 180
    if (![L, C, H].every(Number.isFinite)) return null
    const a = alpha(p[3])
    return a > 0 ? [...fromOklab([L, C * Math.cos(H), C * Math.sin(H)]), a] : null
  }
  m = /^(-?[\d.]+)(deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/.exec(s)
  if (m) {
    const v = hsl2rgb(parseFloat(m[1]), parseFloat(m[3]), parseFloat(m[4]))
    return v.every(Number.isFinite) ? [...v, alpha(m[5])] : null
  }
  return null
}

// ── 在页面里量（无头浏览器里跑，自成一体，不能引用外面的东西） ─────────────────────────

/* eslint-disable no-undef */
function collect() {
  const W = innerWidth, H = Math.max(1, innerHeight)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })
  const memo = new Map()
  // 任何 CSS 颜色（含 oklch、color-mix）都画一个像素读回来，统一成 sRGB
  const col = (c) => {
    if (!c || c === 'transparent' || c === 'none') return null
    if (memo.has(c)) return memo.get(c)
    let v = null
    g.fillStyle = '#010203'
    g.fillStyle = c
    if (String(g.fillStyle) !== '#010203' || /^#010203$/i.test(c)) {
      g.clearRect(0, 0, 1, 1)
      g.fillRect(0, 0, 1, 1)
      const d = g.getImageData(0, 0, 1, 1).data
      if (d[3] > 12) v = [d[0], d[1], d[2], Math.round(d[3] / 2.55) / 100]
    }
    memo.set(c, v)
    return v
  }
  const px = (v) => parseFloat(v) || 0
  const own = (el) => {
    let s = ''
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue
    return s.replace(/\s+/g, ' ').trim()
  }
  const keyOf = (c) => (c ? c.join(',') : '')
  const bump = (m, k, w, extra) => {
    if (!k) return
    const e = m.get(k) || { w: 0, ...(extra || {}) }
    e.w += w
    m.set(k, e)
  }
  const vis = (el, s) => s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05
  const sy = scrollY, sx = scrollX
  const bgOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = col(getComputedStyle(e).backgroundColor)
      if (c && c[3] > 0.5) return c
    }
    return col(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1]
  }
  const bgs = new Map(), texts = new Map(), borders = new Map(), sizes = new Map(), fams = new Map(), radii = new Map(), shadows = new Map(), links = new Map()
  const all = document.body ? [...document.body.querySelectorAll('*')].slice(0, 6000) : []
  const SKIP = /^(script|style|noscript|template|link|meta|br|wbr|title|head|path|g|defs|use|symbol|clippath|mask|lineargradient|radialgradient|stop|desc|circle|rect|line|polyline|polygon|ellipse|text|tspan)$/
  const pageBg = bgOf(document.body || document.documentElement)
  bump(bgs, keyOf(pageBg), 3, { c: pageBg, page: true })
  for (const el of all) {
    const tag = el.tagName.toLowerCase()
    if (SKIP.test(tag)) continue
    const s = getComputedStyle(el)
    if (!vis(el, s)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.top + sy > 6 * H) continue
    const a = (Math.min(r.width, W) * Math.min(r.height, 2 * H)) / (W * H)
    const bg = col(s.backgroundColor)
    if (bg && bg[3] > 0.5) bump(bgs, keyOf(bg), a, { c: bg, page: r.width >= W * 0.9 && r.height >= H * 0.25 })
    const t = tag === 'svg' ? '' : own(el)
    if (t) {
      const fs = px(s.fontSize)
      const w = (Math.min(t.length, 400) * fs) / 16
      const c = col(s.color)
      const head = /^h[1-3]$/.test(tag) || fs >= 28
      if (c) bump(texts, keyOf(c), w, { c, head: 0 })
      if (c && head) texts.get(keyOf(c)).head += w
      bump(sizes, String(Math.round(fs)), w)
      bump(fams, s.fontFamily, w, { head: 0 })
      if (head) fams.get(s.fontFamily).head += w
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (px(s[`border${side}Width`]) < 1 || s[`border${side}Style`] === 'none') continue
      const c = col(s[`border${side}Color`])
      if (c) bump(borders, keyOf(c), side === 'Top' || side === 'Bottom' ? r.width : r.height, { c })
    }
    const rd = px(s.borderTopLeftRadius)
    if (rd > 0 && tag !== 'svg' && tag !== 'img') bump(radii, String(Math.round(rd) >= Math.min(r.width, r.height) / 2 - 1 ? 999 : Math.round(rd)), 1)
    if (s.boxShadow && s.boxShadow !== 'none') bump(shadows, s.boxShadow, 1)
  }
  const spec = (el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const bw = px(s.borderTopWidth)
    return {
      bg: col(s.backgroundColor), fg: col(s.color), bd: bw >= 1 && s.borderTopStyle !== 'none' ? col(s.borderTopColor) : null, bw: Math.round(bw),
      radius: Math.round(px(s.borderTopLeftRadius)), h: Math.round(r.height), w: Math.round(r.width),
      py: Math.round(px(s.paddingTop)), px: Math.round(px(s.paddingLeft)), fs: Math.round(px(s.fontSize)), fw: String(s.fontWeight), ff: s.fontFamily,
      tt: s.textTransform === 'none' ? '' : s.textTransform, ls: s.letterSpacing === 'normal' ? '' : s.letterSpacing,
      shadow: s.boxShadow === 'none' ? '' : s.boxShadow, grad: /gradient/.test(s.backgroundImage), parent: bgOf(el.parentElement || el),
      text: String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      top: Math.round(r.top + sy),
    }
  }
  const reps = []
  const group = (els, sig, max) => {
    const m = new Map()
    for (const el of els) {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (!vis(el, s) || r.width < 8 || r.height < 8 || r.top + sy > 6 * H) continue
      const sp = spec(el)
      const k = sig(sp)
      const e = m.get(k)
      if (e) { e.n++; if (sp.top < e.spec.top) { e.spec = sp; reps[e.rep] = el } } else {
        reps.push(el)
        m.set(k, { n: 1, spec: sp, rep: reps.length - 1 })
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, max)
  }
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 9
  const BTN = 'button, [role=button], input[type=submit], input[type=button], a[class*=btn], a[class*=button], a[class*=Btn], a[class*=Button], a[class*=cta]'
  const btnEls = new Set([...document.querySelectorAll(BTN)].slice(0, 200))
  // 没写成按钮的「按钮」：有底色、有内边距的链接
  for (const a of [...document.querySelectorAll('a')].slice(0, 400)) {
    const s = getComputedStyle(a)
    const c = col(s.backgroundColor)
    if ((c && c[3] > 0.5 && !same(c, bgOf(a.parentElement || a))) || (px(s.borderTopWidth) >= 1 && px(s.paddingLeft) >= 10 && px(s.borderTopLeftRadius) > 0)) {
      if (px(s.paddingLeft) >= 8) btnEls.add(a)
    }
  }
  const buttons = group([...btnEls], (p) => [keyOf(p.bg && p.bg[3] > 0.5 && !same(p.bg, p.parent) ? p.bg : null), keyOf(p.fg), keyOf(p.bd), p.radius, Math.round(p.h / 6)].join('|'), 6)
  const inputs = group([...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]):not([type=file]), textarea, select')].slice(0, 80),
    (p) => [keyOf(p.bg), keyOf(p.bd), p.radius, Math.round(p.h / 6)].join('|'), 3)
  // 卡片：和外面底色不一样（或带阴影 / 一圈边框）、有圆角、不太大不太小、里面有字
  const cardEls = []
  for (const el of all) {
    if (cardEls.length >= 300) break
    if (btnEls.has(el) || /^(input|textarea|select|button|img|svg|a|span|label|li|ul|ol|p|h\d|header|nav|footer|html|body)$/.test(el.tagName.toLowerCase())) continue
    const s = getComputedStyle(el)
    if (!vis(el, s) || px(s.borderTopLeftRadius) < 2) continue
    const r = el.getBoundingClientRect()
    if (r.width < 120 || r.width > W * 0.96 || r.height < 60 || r.height > H * 1.6) continue
    const c = col(s.backgroundColor)
    const lifted = (c && c[3] > 0.5 && !same(c, bgOf(el.parentElement || el))) || (s.boxShadow && s.boxShadow !== 'none') || (px(s.borderTopWidth) >= 1 && px(s.borderBottomWidth) >= 1)
    if (lifted && String(el.innerText || '').trim().length >= 8) cardEls.push(el)
  }
  const cards = group(cardEls, (p) => [keyOf(p.bg), p.radius, p.shadow.slice(0, 40), keyOf(p.bd)].join('|'), 3)
  for (const a of [...document.querySelectorAll('a')].slice(0, 400)) {
    if (btnEls.has(a)) continue
    const s = getComputedStyle(a)
    const r = a.getBoundingClientRect()
    if (!vis(a, s) || r.width < 1 || !own(a)) continue
    const c = col(s.color)
    if (c) bump(links, keyOf(c), 1, { c, line: /underline/.test(s.textDecorationLine) ? 1 : 0, fw: s.fontWeight })
  }
  let header = null
  for (const el of document.querySelectorAll('header, [role=banner], nav')) {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!vis(el, s) || r.height < 24 || r.top + sy > 240 || r.width < W * 0.6) continue
    const bw = px(s.borderBottomWidth)
    header = { h: Math.round(r.height), bg: bgOf(el), pos: s.position, line: bw >= 1 ? col(s.borderBottomColor) : null, shadow: s.boxShadow === 'none' ? '' : s.boxShadow, blur: /blur/.test(s.backdropFilter || s.webkitBackdropFilter || '') }
    reps.push(el)
    header.rep = reps.length - 1
    break
  }
  const heads = {}
  for (const tg of ['h1', 'h2', 'h3']) {
    const el = [...document.querySelectorAll(tg)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && own(e) })
    if (!el) continue
    const s = getComputedStyle(el)
    heads[tg] = { ff: s.fontFamily, fs: Math.round(px(s.fontSize)), fw: String(s.fontWeight), lh: s.lineHeight, ls: s.letterSpacing === 'normal' ? '' : s.letterSpacing, c: col(s.color), tt: s.textTransform === 'none' ? '' : s.textTransform }
  }
  let body = null
  let most = 0
  for (const el of [...document.querySelectorAll('p, li')].slice(0, 300)) {
    const t = own(el)
    if (t.length <= most) continue
    const s = getComputedStyle(el)
    if (!vis(el, s)) continue
    most = t.length
    body = { ff: s.fontFamily, fs: Math.round(px(s.fontSize)), fw: String(s.fontWeight), lh: s.lineHeight, c: col(s.color) }
  }
  let logo = null
  for (const el of document.querySelectorAll('header img, header svg, [class*=logo] img, [class*=logo] svg, [id*=logo] img, [id*=logo] svg, img[alt*=logo i], a[class*=logo], [class*=brand] img, [class*=brand] svg')) {
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 8 || r.top + sy > 300) continue
    reps.push(el)
    logo = { rep: reps.length - 1, w: Math.round(r.width), h: Math.round(r.height) }
    break
  }
  const vars = []
  const seen = new Set()
  const rootCs = getComputedStyle(document.documentElement)
  let dark = false
  const scan = (rules) => {
    for (const r of rules) {
      if (r.media && /prefers-color-scheme\s*:\s*dark/i.test(r.media.mediaText || '')) { dark = true; continue }
      if (r.cssRules && !r.selectorText) { try { scan(r.cssRules) } catch { /* 读不了 */ } continue }
      if (!r.style || !r.selectorText) continue
      if (/\[data-theme=["']?dark|\.dark\b/.test(r.selectorText)) dark = true
      if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText)) continue
      for (let i = 0; i < r.style.length && vars.length < 200; i++) {
        const n = r.style[i]
        if (!n.startsWith('--') || seen.has(n)) continue
        seen.add(n)
        const v = (rootCs.getPropertyValue(n) || r.style.getPropertyValue(n)).trim()
        if (v && v.length <= 120) vars.push([n, v])
      }
    }
  }
  for (const sheet of document.styleSheets) { try { scan(sheet.cssRules) } catch { /* 别的源的样式表读不了 */ } }
  const fontsLoaded = [...new Set([...(document.fonts || [])].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/^["']|["']$/g, '')))].slice(0, 12)
  const fontLinks = [...document.querySelectorAll('link[rel=stylesheet][href]')].map((l) => l.href).filter((h) => /fonts\.(googleapis|loli|font\.im)|typekit|fonts\.bunny|fontshare/i.test(h)).slice(0, 4)
  const tc = document.querySelector('meta[name=theme-color]')
  // 品牌名：og:site_name / application-name，或者标志上的字
  const metaName = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]')
  let brand = metaName ? String(metaName.getAttribute('content') || '').trim().slice(0, 30) : ''
  if (!brand) {
    for (const el of document.querySelectorAll('[class*=logo], [id*=logo], [class*=brand], header a[href="/"], header a[href="./"]')) {
      const t = String(el.innerText || el.getAttribute('aria-label') || (el.querySelector('img[alt]') || {}).alt || '').replace(/\s+/g, ' ').trim()
      if (t && t.length <= 24 && !/logo/i.test(t)) { brand = t; break }
    }
  }
  window.__dsx = reps
  const list = (m) => [...m.values()].sort((a, b) => b.w - a.w).slice(0, 24)
  return {
    url: location.href, title: document.title, lang: document.documentElement.lang || '', w: W, h: H,
    page: Math.max(document.documentElement.scrollHeight, H), n: all.length, pageBg,
    bgs: list(bgs), texts: list(texts), borders: list(borders),
    sizes: [...sizes].map(([k, v]) => [+k, v.w]).sort((a, b) => b[1] - a[1]).slice(0, 30),
    fams: [...fams].map(([k, v]) => ({ ff: k, w: v.w, head: v.head })).sort((a, b) => b.w - a.w).slice(0, 8),
    radii: [...radii].map(([k, v]) => [+k, v.w]).sort((a, b) => b[1] - a[1]).slice(0, 12),
    shadows: [...shadows].map(([k, v]) => [k, v.w]).sort((a, b) => b[1] - a[1]).slice(0, 6),
    links: list(links).slice(0, 6), buttons, inputs, cards, header, heads, body, logo, vars, dark, brand, bodyColor: col(getComputedStyle(document.body).color),
    headerText: String((document.querySelector('header, [role=banner]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 200),
    fontsLoaded, fontLinks, themeColor: tc ? String(tc.getAttribute('content') || '') : '',
  }
}
/* eslint-enable no-undef */

const COLLECT = `(async () => {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]) } catch (e) { /* 没有字体接口 */ }
  await new Promise((r) => setTimeout(r, 500))
  return (${collect})()
})()`

// 截一个量到的元素（按钮、卡片……）：滚到屏幕中间，四周留 12px
const CROP = (i) => `(() => {
  const el = (window.__dsx || [])[${i}]
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
  const r = el.getBoundingClientRect()
  const pad = 12
  const x0 = Math.max(0, r.left - pad), y0 = Math.max(0, r.top - pad)
  const x1 = Math.min(innerWidth, r.right + pad), y1 = Math.min(innerHeight, r.bottom + pad)
  if (x1 - x0 < 4 || y1 - y0 < 4) return null
  return { x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0 }
})()`

/** 开一页量：样式数据、顶上一屏的截图、几个组件的截图 */
async function renderPage(browser, url, label) {
  return browser.withPage({ url, w: 1280, h: 800 }, async (page) => {
    const data = await page.eval(COLLECT)
    const shots = [{ key: `${label}-top`, label: `${label} 顶上一屏`, jpg: await page.shot() }]
    const picks = []
    const btn = data.buttons.find((b) => b.spec.bg && b.spec.bg[3] > 0.5) || data.buttons[0]
    if (btn) picks.push(['button', btn.rep])
    const btn2 = data.buttons.find((b) => b !== btn)
    if (btn2) picks.push(['button-2', btn2.rep])
    if (data.cards[0]) picks.push(['card', data.cards[0].rep])
    if (data.inputs[0]) picks.push(['input', data.inputs[0].rep])
    if (data.logo) picks.unshift(['logo', data.logo.rep])
    for (const [what, i] of picks.slice(0, MAX_CROPS)) {
      try {
        const clip = await page.eval(CROP(i))
        if (clip) shots.push({ key: `${label}-${what}`, label: `${label} ${CROP_NAME[what]}`, jpg: await page.shot({ clip }), what })
      } catch { /* 截不了就算了 */ }
    }
    return { url, label, data, shots }
  })
}

const CROP_NAME = { logo: '标志', button: '主按钮', 'button-2': '另一种按钮', card: '卡片', input: '输入框' }

// ── 扫项目文件夹（不开浏览器也有的东西） ──────────────────────────────────────

const LIBS = [
  ['tailwindcss', 'Tailwind CSS'], ['antd', 'Ant Design'], ['@mui/material', 'MUI'], ['element-plus', 'Element Plus'], ['element-ui', 'Element UI'],
  ['vant', 'Vant'], ['@chakra-ui/react', 'Chakra UI'], ['bootstrap', 'Bootstrap'], ['@arco-design/web-react', 'Arco Design'], ['@arco-design/web-vue', 'Arco Design'],
  ['naive-ui', 'Naive UI'], ['@nextui-org/react', 'NextUI'], ['@radix-ui/themes', 'Radix Themes'], ['@mantine/core', 'Mantine'], ['tdesign-react', 'TDesign'], ['tdesign-vue-next', 'TDesign'],
  ['vuetify', 'Vuetify'], ['quasar', 'Quasar'], ['daisyui', 'daisyUI'], ['@headlessui/react', 'Headless UI'], ['styled-components', 'styled-components'], ['@emotion/react', 'Emotion'],
]

/** 项目里的样式：CSS 变量、写死的颜色、字体、圆角（按出现次数）、Tailwind 主题、组件库、能直接打开的 HTML */
export function scanProject(root) {
  const out = { root, files: 0, vars: new Map(), colors: new Map(), fonts: new Map(), radii: new Map(), libs: [], tailwind: '', entries: [], fontLinks: new Set(), name: '' }
  const files = []
  const walk = (dir, depth) => {
    if (depth > 6 || files.length >= MAX_SCAN_FILES) return
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= MAX_SCAN_FILES) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, depth + 1) } else if (e.isFile() && (SCAN_EXT.test(e.name) || THEME_FILE.test(p) || (depth === 0 && (e.name === 'package.json' || e.name === 'components.json')))) files.push({ p, depth })
    }
  }
  walk(root, 0)
  const bump = (m, k, extra) => { const e = m.get(k) || { n: 0, ...(extra || {}) }; e.n++; m.set(k, e) }
  for (const { p, depth } of files) {
    let text
    try {
      if (fs.statSync(p).size > MAX_SCAN_BYTES) continue
      text = fs.readFileSync(p, 'utf8')
    } catch { continue }
    out.files++
    const base = path.basename(p)
    if (base === 'package.json') {
      try {
        const pkg = JSON.parse(text)
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
        out.libs = LIBS.filter(([k]) => deps[k]).map(([, v]) => v).filter((v, i, a) => a.indexOf(v) === i)
        if (typeof pkg.name === 'string' && depth === 0) out.name = pkg.name.replace(/^@[^/]+\//, '')
      } catch { /* 不是 JSON */ }
      continue
    }
    if (base === 'components.json') { if (/shadcn|"style"\s*:/.test(text) && !out.libs.includes('shadcn/ui')) out.libs.push('shadcn/ui'); continue }
    if (/^tailwind\.config\./.test(base)) {
      const i = text.search(/\btheme\s*:/)
      out.tailwind = (i >= 0 ? text.slice(i) : text).slice(0, 3000)
    }
    if (/\.html?$/i.test(base)) {
      const bodyText = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (depth <= 2 && bodyText.length >= 160) out.entries.push(p)
      for (const m of text.matchAll(/href=["'](https?:\/\/fonts\.(?:googleapis|loli)\.[^"']+)["']/g)) out.fontLinks.add(m[1].replace(/&amp;/g, '&'))
    }
    for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}\n]+?)\s*(?:;|}|\n)/g)) {
      const v = m[2].trim()
      if (v.length <= 120 && !/^var\(/.test(v)) bump(out.vars, m[1], { v })
    }
    for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]{4,60}\)/g)) {
      const c = parseColor(m[0])
      if (c && c[3] > 0.5) bump(out.colors, hexOf(c), { c })
    }
    for (const m of text.matchAll(/font-family\s*:\s*([^;}\n]+)/gi)) bump(out.fonts, m[1].trim())
    for (const m of text.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem)\b/gi)) bump(out.radii, String(Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'rem' ? 16 : 1))))
  }
  out.fontLinks = [...out.fontLinks]
  return out
}

// ── 归成角色 ──────────────────────────────────────────────────────────────

/** 颜色按「看起来是同一个」归堆：权重大的先占位，差不到 3.5 的并进去 */
function clusters(entries) {
  const out = []
  for (const e of [...entries].sort((a, b) => b.w - a.w)) {
    if (!e.c || e.w <= 0) continue
    const hit = out.find((k) => deltaE(k.c, e.c) < 3.5)
    if (hit) {
      hit.w += e.w
      for (const [k, v] of Object.entries(e.as || {})) hit.as[k] = (hit.as[k] || 0) + v
    } else out.push({ c: e.c.slice(0, 3), w: e.w, as: { ...(e.as || {}) } })
  }
  return out
}

const NAME_HINT = {
  primary: /^--(?:color-)?(?:primary|brand)(?:-color|-500|-600|-base|-main)?$/,
  bg: /^--(?:color-)?(?:background|bg|body-bg|page-bg|bg-page|base-100)$/,
  text: /^--(?:color-)?(?:foreground|text|body-color|text-color|fg|base-content)$/,
  line: /^--(?:color-)?(?:border|line|divider|border-color)$/,
}

/** 网站 / 项目里按名字就能认出角色的变量（--primary、--background …）→ { 角色: [r, g, b] } */
function hinted(vars) {
  const out = {}
  for (const [n, v] of vars) {
    for (const [role, re] of Object.entries(NAME_HINT)) {
      if (out[role] || !re.test(n.toLowerCase())) continue
      const c = parseColor(v)
      if (c && c[3] > 0.8) out[role] = c.slice(0, 3)
    }
  }
  return out
}

const roundTo = (v, step = 1) => Math.round(v / step) * step
const familyOf = (ff) => String(ff || '').split(',')[0].trim().replace(/^["']|["']$/g, '')
const isSerif = (ff) => /(^|,)\s*serif\s*$/i.test(String(ff || '')) || /serif|song|ming|georgia|times|garamond|playfair|lora|merriweather|noto serif/i.test(familyOf(ff))

/** 字体栈：没有中文字体就补上（标题是衬线就补宋体） */
export function withCjk(ff) {
  const s = String(ff || '').trim().replace(/\s*,\s*/g, ', ')
  if (!s) return ''
  if (HAS_CJK_FONT.test(s)) return s
  const serif = isSerif(s)
  return s.replace(/,?\s*(sans-serif|serif|system-ui|-apple-system|BlinkMacSystemFont)(,\s*(sans-serif|serif|system-ui|-apple-system|BlinkMacSystemFont))*\s*$/i, '') + ', ' + (serif ? CJK_SERIF : CJK_SANS)
}

const TEXT_STEPS = [['xs', 12], ['sm', 14], ['md', 16], ['lg', 20], ['xl', 24], ['2xl', 32], ['3xl', 40], ['4xl', 56]]

/** 量到的字号（字号 → 权重）+ 正文字号 → 八档字号阶梯：每档挑离模板比例最近的真实字号（差 12% 以内），没有就按比例算 */
export function typeScale(sizes, base = 16, display = 0) {
  const md = clamp(Math.round(base) || 16, 13, 20)
  const total = sizes.reduce((m, [, w]) => m + w, 0) || 1
  const real = sizes.filter(([, w]) => w / total >= 0.01).map(([s]) => s)
  const out = {}
  let prev = 0
  for (const [name, t] of TEXT_STEPS) {
    const want = Math.round((t * md) / 16)
    let v = name === 'md' ? md : real.filter((s) => Math.abs(s - want) / want <= 0.12).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] || want
    if (v <= prev) v = prev + (prev < 20 ? 1 : 2)
    out[name] = v
    prev = v
  }
  if (display > out['4xl']) out['4xl'] = display
  return out
}

/** 计算样式里的阴影 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px' → 模糊半径 */
const blurOf = (sh) => { const m = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(sh); return m ? +m[3] : 0 }

/**
 * 量到的数 → 一套设计系统。
 * pages：页面里量到的（collect 的结果）；scan：扫项目的结果（可以没有）
 */
export function synthesize(pages = [], scan = null, opts = {}) {
  const notes = []
  const entries = []
  const add = (c, w, as) => { if (c && c[3] > 0.85 && w > 0) entries.push({ c: c.slice(0, 3), w, as: { [as]: w } }) }
  const vars = []
  for (const p of pages) {
    for (const b of p.bgs) add(b.c, b.w * (b.page ? 2 : 1), b.page ? 'page' : 'bg')
    const tw = p.texts.reduce((m, x) => m + x.w, 0) || 1
    for (const t of p.texts) add(t.c, (t.w / tw) * 1.5, 'text')
    const bw = p.borders.reduce((m, x) => m + x.w, 0) || 1
    for (const b of p.borders) add(b.c, (b.w / bw) * 0.3, 'border')
    for (const b of p.buttons) {
      const s = b.spec
      if (s.bg && s.bg[3] > 0.5 && !(s.parent && deltaE(s.bg, s.parent) < 3)) add(s.bg, 0.4 * b.n, 'button')
      if (s.fg) add(s.fg, 0.05 * b.n, 'buttonText')
    }
    for (const l of p.links) add(l.c, 0.08 * l.w, 'link')
    vars.push(...p.vars)
  }
  if (scan) {
    const total = [...scan.colors.values()].reduce((m, x) => m + x.n, 0) || 1
    for (const e of scan.colors.values()) add(e.c, (e.n / total) * (pages.length ? 0.5 : 3), 'literal')
    for (const [n, e] of scan.vars) vars.push([n, e.v])
  }
  const cl = clusters(entries)
  const by = (as) => cl.filter((k) => k.as[as]).sort((a, b) => b.as[as] - a.as[as])
  const hint = hinted(vars)
  const C = (k) => k && k.c
  const L = (c) => lch(c).L

  // 背景：整块铺满的底色；没量到就看变量名，再不行白色
  let bg = hint.bg || C(by('page')[0]) || C(by('bg')[0]) || C(by('literal').find((k) => lch(k.c).C < 0.03 && (L(k.c) > 0.9 || L(k.c) < 0.2))) || [255, 255, 255]
  const darkBg = L(bg) < 0.5
  // 正文：字最多的颜色（和背景对比要够），次要文字：另一个够得着的中性色
  const texts = by('text').length ? by('text') : by('literal').filter((k) => contrast(k.c, bg) >= 4)
  // 段落常用次要灰、标题和导航用深色：<body> 的颜色在常用的几种里、对比够就用它；不然取常用的中性色里对比最高的
  const wOf = (k) => k.as.text || k.as.literal || 0
  const topW = texts.length ? wOf(texts[0]) : 0
  const usual = texts.filter((k) => wOf(k) >= topW * 0.12 && contrast(k.c, bg) >= 4.5)
  const bodyC = pages.map((p) => p.bodyColor).find((c) => c && c[3] > 0.85)
  const bodyHit = bodyC && usual.find((k) => deltaE(k.c, bodyC) < 3)
  const darkest = usual.filter((k) => lch(k.c).C < 0.06).sort((a, b) => contrast(b.c, bg) - contrast(a.c, bg))[0]
  let text = hint.text || C(bodyHit) || C(darkest) || C(texts.find((k) => contrast(k.c, bg) >= 3)) || (darkBg ? [240, 240, 240] : [24, 24, 27])
  let muted = C(texts.find((k) => k.c !== text && deltaE(k.c, text) > 8 && lch(k.c).C < 0.08 && contrast(k.c, bg) >= 2 && contrast(k.c, bg) < contrast(text, bg)))
  if (!muted) { muted = mix(text, bg, 0.38); notes.push('次要文字的颜色是按正文和背景混出来的（网站上没量到明显的第二种文字色）') }
  if (contrast(muted, bg) < 4.5) notes.push(`次要文字 ${hexOf(muted)} 对背景只有 ${contrast(muted, bg).toFixed(1)}:1，小字（正文大小）别用它，至少要 4.5:1`)
  // 表面：卡片、弹层的底；和背景接近但不一样的中性色
  const surfaces = by('bg').filter((k) => deltaE(k.c, bg) > 1.5 && lch(k.c).C < 0.05 && Math.abs(L(k.c) - L(bg)) < 0.12)
  const surface = C(surfaces[0]) || (darkBg ? mix(bg, [255, 255, 255], 0.06) : L(bg) > 0.97 ? [255, 255, 255] : mix(bg, [255, 255, 255], 0.6))
  const surface2 = C(surfaces.find((k) => deltaE(k.c, surface) > 1.5)) || mix(bg, text, darkBg ? 0.08 : 0.04)
  // 主色：最常见的实心按钮的底色；没有按钮就看变量名、链接色、最常见的彩色
  const btns = by('button').filter((k) => deltaE(k.c, bg) > 6)
  const chroma = (k) => lch(k.c).C
  let primary = hint.primary || C(btns.find((k) => chroma(k) >= 0.04)) || C(btns[0]) ||
    C(by('link').find((k) => chroma(k) >= 0.05)) ||
    C(cl.filter((k) => chroma(k) >= 0.06 && deltaE(k.c, bg) > 6).sort((a, b) => b.w * chroma(b) - a.w * chroma(a))[0])
  if (!primary) { primary = text; notes.push('网站基本没有彩色（黑白灰为主），主色就用了正文色：主按钮是深色实心的') }
  // 主色上的字：主按钮上的字；没有就挑对比更高的黑 / 白
  let ink = null
  for (const p of pages) {
    const b = p.buttons.find((x) => x.spec.bg && deltaE(x.spec.bg, primary) < 4)
    if (b && b.spec.fg) { ink = b.spec.fg.slice(0, 3); break }
  }
  if (!ink || contrast(ink, primary) < 3) ink = contrast([255, 255, 255], primary) >= contrast([17, 17, 17], primary) ? [255, 255, 255] : [17, 17, 17]
  if (contrast(ink, primary) < 4.5) notes.push(`主色上的字对比度只有 ${contrast(ink, primary).toFixed(1)}:1，主按钮的字用大一点、粗一点（≥ 18px 或 ≥ 14px 粗体）`)
  // 点缀：和主色色相差得开的另一个彩色，少用
  const hp = lch(primary).H
  const accentK = cl.filter((k) => chroma(k) >= 0.06 && deltaE(k.c, primary) > 10 && deltaE(k.c, bg) > 6 && Math.min(Math.abs(lch(k.c).H - hp), 360 - Math.abs(lch(k.c).H - hp)) >= 35).sort((a, b) => b.w - a.w)[0]
  const accent = C(accentK) || primary
  // 边框：最常见的边框色（彩色的不算）
  const line = hint.line || C(by('border').find((k) => chroma(k) < 0.06 && deltaE(k.c, bg) > 2)) || mix(bg, text, darkBg ? 0.16 : 0.1)
  // 链接：和主色、正文都不一样就单列
  let link = null
  for (const p of pages) for (const l of p.links) if (!link && l.c && deltaE(l.c, primary) > 6 && deltaE(l.c, text) > 6 && chroma({ c: l.c }) >= 0.05) link = l.c.slice(0, 3)
  const colors = { bg, surface, 'surface-2': surface2, text, muted, line, primary, 'primary-ink': ink, accent }
  if (link) colors.link = link

  // 用量：主色、点缀在页面上大概占多少（给 DESIGN.md）
  const share = (c) => { const k = cl.find((x) => deltaE(x.c, c) < 3.5); const all = cl.reduce((m, x) => m + x.w, 0) || 1; return k ? Math.round((k.w / all) * 1000) / 10 : 0 }

  // ── 字体 ──
  const fams = new Map()
  for (const p of pages) for (const f of p.fams) { const e = fams.get(f.ff) || { ff: f.ff, w: 0, head: 0 }; e.w += f.w; e.head += f.head; fams.set(f.ff, e) }
  const famList = [...fams.values()]
  let bodyFf = (pages.find((p) => p.body) || {}).body?.ff || famList.sort((a, b) => (b.w - b.head) - (a.w - a.head))[0]?.ff || ''
  let headFf = (pages.find((p) => p.heads && p.heads.h1) || {}).heads?.h1?.ff || famList.sort((a, b) => b.head - a.head)[0]?.ff || bodyFf
  if (!bodyFf && scan && scan.fonts.size) {
    const top = [...scan.fonts].sort((a, b) => b[1].n - a[1].n)
    bodyFf = top[0][0]
    headFf = (top.find(([ff]) => isSerif(ff) !== isSerif(bodyFf)) || top[0])[0]
  }
  const sans = withCjk(bodyFf) || '-apple-system, BlinkMacSystemFont, ' + CJK_SANS
  const display = familyOf(headFf) && familyOf(headFf) !== familyOf(bodyFf) ? withCjk(headFf) : ''
  const loaded = [...new Set(pages.flatMap((p) => p.fontsLoaded || []))]
  const fontLinks = [...new Set([...pages.flatMap((p) => p.fontLinks || []), ...((scan && scan.fontLinks) || [])])].slice(0, 3)
  const named = [familyOf(bodyFf), familyOf(headFf)].filter(Boolean)
  const selfHosted = named.filter((f) => loaded.includes(f) && !fontLinks.some((l) => l.toLowerCase().includes(f.toLowerCase().replace(/\s+/g, '+'))))
  if (selfHosted.length) notes.push(`网站用了自己托管的字体「${[...new Set(selfHosted)].join('、')}」，设计稿里没有这个字体文件时会退回到后面的字体（要一模一样，把字体文件放进设计目录、加 @font-face）`)

  // ── 字号 ──
  const sizeW = new Map()
  for (const p of pages) for (const [s, w] of p.sizes) sizeW.set(s, (sizeW.get(s) || 0) + w)
  const bodyFs = (pages.find((p) => p.body) || {}).body?.fs || [...sizeW].sort((a, b) => b[1] - a[1]).map(([s]) => s).find((s) => s >= 13 && s <= 20) || 16
  const h1 = (pages.find((p) => p.heads && p.heads.h1) || {}).heads?.h1 || null
  const text_ = typeScale([...sizeW], bodyFs, h1 ? h1.fs : 0)
  const heads = {}
  for (const tg of ['h1', 'h2', 'h3']) { const h = (pages.find((p) => p.heads && p.heads[tg]) || {}).heads?.[tg]; if (h) heads[tg] = h }
  const bodySpec = (pages.find((p) => p.body) || {}).body || null

  // ── 圆角、阴影 ──
  const firstSpec = (what) => { for (const p of pages) if (p[what] && p[what][0]) return p[what][0].spec; return null }
  const btnSpec = (() => { for (const p of pages) { const b = p.buttons.find((x) => x.spec.bg && deltaE(x.spec.bg, primary) < 6) || p.buttons[0]; if (b) return b.spec } return null })()
  const btn2Spec = (() => { for (const p of pages) { const b = p.buttons.find((x) => x.spec !== btnSpec && !(x.spec.bg && deltaE(x.spec.bg, primary) < 6)); if (b) return b.spec } return null })()
  const inputSpec = firstSpec('inputs')
  const cardSpec = firstSpec('cards')
  const radW = new Map()
  for (const p of pages) for (const [r, w] of p.radii) radW.set(r, (radW.get(r) || 0) + w)
  if (scan) for (const [r, e] of scan.radii) radW.set(+r, (radW.get(+r) || 0) + e.n * 0.5)
  const common = [...radW].filter(([r]) => r > 0 && r < 100).sort((a, b) => b[1] - a[1]).map(([r]) => r)
  const pill = !!(btnSpec && btnSpec.radius >= btnSpec.h / 2 - 1)
  const sharp = !!(btnSpec && btnSpec.radius === 0 && (!cardSpec || cardSpec.radius === 0))
  let radius
  if (sharp) radius = { sm: 0, md: 0, lg: 0, xl: 0 }
  else {
    const md = btnSpec && !pill && btnSpec.radius > 0 ? btnSpec.radius : common[0] || 10
    const sm = inputSpec && inputSpec.radius > 0 && inputSpec.radius <= md ? inputSpec.radius : Math.min(md, [...common].sort((a, b) => a - b)[0] || Math.round(md * 0.66))
    const lg = cardSpec && cardSpec.radius >= md ? cardSpec.radius : Math.max(md, [...common].filter((r) => r > md).sort((a, b) => a - b)[0] || Math.round(md * 1.4))
    const xl = Math.max(lg, [...common].filter((r) => r > lg).sort((a, b) => a - b)[0] || Math.round(lg * 1.5))
    radius = { sm, md, lg, xl }
    if (sm > md) radius.sm = md
  }
  if (sharp) notes.push('网站的按钮、卡片都是直角：设计稿里也别加圆角')
  if (pill) notes.push('主按钮是胶囊形（两头全圆），用 --radius-full')
  const shadowList = []
  for (const p of pages) for (const [s] of p.shadows) if (!shadowList.includes(s)) shadowList.push(s)
  const sorted = [...shadowList].sort((a, b) => blurOf(a) - blurOf(b))
  const shadowMd = (cardSpec && cardSpec.shadow) || sorted[sorted.length - 1] || ''
  const shadowSm = sorted.find((s) => blurOf(s) < blurOf(shadowMd)) || (btnSpec && btnSpec.shadow) || ''
  if (!shadowList.length && pages.length) notes.push('网站几乎不用阴影（靠底色和边框分层）：--shadow-sm / --shadow-md 是 none，设计稿里也别加大阴影')

  const brand = String(opts.name || '').trim()
  return {
    name: brand,
    colors,
    share: { primary: share(primary), accent: accent === primary ? 0 : share(accent) },
    dark: pages.some((p) => p.dark),
    font: { sans, display, loaded, links: fontLinks },
    text: text_,
    heads,
    body: bodySpec,
    radius,
    pill,
    shadow: { sm: shadowSm || (pages.length ? 'none' : ''), md: shadowMd || (pages.length ? 'none' : '') },
    comps: { button: btnSpec, button2: btn2Spec, input: inputSpec, card: cardSpec, header: (pages.find((p) => p.header) || {}).header || null },
    vars: vars.slice(0, 60),
    libs: (scan && scan.libs) || [],
    tailwind: (scan && scan.tailwind) || '',
    notes,
  }
}

// ── 写成文件 ──────────────────────────────────────────────────────────────

const ROLE_NOTE = {
  bg: '页面背景', surface: '卡片、弹层', 'surface-2': '次一级表面、分组背景', text: '正文', muted: '次要文字', line: '边框、分割线',
  primary: '主色：关键按钮、选中态', 'primary-ink': '主色上的文字', accent: '点睛色，少用', link: '文字链接',
}

/** 颜色值 → 设计变量名（等于某个角色就用 var()） */
function colorRef(sys, c) {
  if (!c) return ''
  for (const [k, v] of Object.entries(sys.colors)) if (deltaE(v, c) < 2) return `var(--color-${k})`
  return c[3] != null && c[3] < 1 ? `rgb(${c.slice(0, 3).join(' ')} / ${c[3]})` : hexOf(c)
}
const radiusRef = (sys, r) => {
  if (r == null) return 'var(--radius-md)'
  for (const k of ['sm', 'md', 'lg', 'xl']) if (sys.radius[k] === r) return `var(--radius-${k})`
  return r >= 100 ? 'var(--radius-full)' : `${r}px`
}
const sizeRef = (sys, fs) => {
  for (const [k, v] of Object.entries(sys.text)) if (v === fs) return `var(--text-${k})`
  return `${fs}px`
}

/**
 * 网页上量来的值写进 CSS 前过一遍：带 ; { } < > \、注释、换行，或引号不配对的不要（换成默认），
 * 免得网页故意给个怪值把样式表写坏、塞进别的规则
 */
export function cssVal(v, fb = '') {
  const s = String(v == null ? '' : v).trim()
  if (!s || /[;{}<>\\\n\r]|\/\*|\*\//.test(s)) return fb
  if ((s.match(/"/g) || []).length % 2 || (s.match(/'/g) || []).length % 2) return fb
  return s
}

/** 写进 CSS 注释的字（名字、来源）：*\/ 拆开、换行换成空格，别提前把注释关掉 */
export const cmt = (v) => String(v == null ? '' : v).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ')

export function tokensCss(sys, meta = {}) {
  const c = sys.colors
  const line = (k, note) => `  --color-${k}: ${hexOf(c[k])};${' '.repeat(Math.max(1, 12 - k.length))}/* ${note} */`
  const dark = (() => {
    const h = Math.round(lch(c.primary).H)
    return [`  --color-bg: oklch(18% 0.01 ${h});`, `  --color-surface: oklch(22% 0.012 ${h});`, `  --color-surface-2: oklch(26% 0.012 ${h});`, '  --color-text: oklch(95% 0.005 85);', '  --color-muted: oklch(72% 0.01 85);', `  --color-line: oklch(32% 0.012 ${h});`]
  })()
  return [
    `/* 设计系统「${cmt(sys.name)}」的设计变量（从 ${cmt(meta.source || '网站')} 提取${meta.date ? '，' + cmt(meta.date) : ''}）。复制到设计目录，每屏 <link rel="stylesheet" href="tokens.css"> */`,
    ':root {',
    '  /* 颜色：按角色定义 */',
    ...Object.keys(c).map((k) => line(k, ROLE_NOTE[k] || '')),
    '  --color-success: oklch(62% 0.14 150);',
    '  --color-warning: oklch(75% 0.15 75);',
    '  --color-danger: oklch(58% 0.2 25);',
    '',
    '  /* 字体 */',
    `  --font-sans: ${cssVal(sys.font.sans, CJK_SANS)};`,
    `  --font-display: ${cssVal(sys.font.display, 'var(--font-sans)')};`,
    '  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;',
    '',
    '  /* 字号阶梯 */',
    ...Object.entries(sys.text).map(([k, v]) => `  --text-${k}: ${v}px;`),
    '',
    '  /* 间距（4 / 8 的倍数） */',
    ...[4, 8, 12, 16, 24, 32, 48, 64].map((v, i) => `  --space-${i + 1}: ${v}px;`),
    '',
    '  /* 圆角 */',
    ...['sm', 'md', 'lg', 'xl'].map((k) => `  --radius-${k}: ${sys.radius[k]}px;`),
    '  --radius-full: 999px;',
    '',
    '  /* 阴影 */',
    `  --shadow-sm: ${cssVal(sys.shadow.sm, '0 1px 2px rgb(0 0 0 / 0.06)')};`,
    `  --shadow-md: ${cssVal(sys.shadow.md, '0 6px 20px rgb(0 0 0 / 0.08)')};`,
    '',
    '  /* 动效 */',
    '  --ease: cubic-bezier(.2, .8, .2, 1);',
    '  --dur: 200ms;',
    '}',
    '',
    `/* 深色版（${sys.dark ? '网站有深色模式，下面是按主色色相配的，核对后再用' : '网站没有深色模式，下面是按主色色相配的起点'}）：<html data-theme="dark"> */`,
    '[data-theme="dark"] {',
    ...dark,
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root { --dur: 0ms; }',
    '}',
    '',
  ].join('\n')
}

export function componentsCss(sys) {
  const b = sys.comps.button || {}
  const b2 = sys.comps.button2 || null
  const inp = sys.comps.input || {}
  const card = sys.comps.card || {}
  const h = sys.heads
  const pad = (s, dy, dx) => `${s && s.py != null ? s.py : dy}px ${s && s.px != null ? s.px : dx}px`
  const tt = (s) => (s && cssVal(s.tt) ? `\n  text-transform: ${cssVal(s.tt)};` : '') + (s && cssVal(s.ls) ? `\n  letter-spacing: ${cssVal(s.ls)};` : '')
  const textStyle = (cls, hh, fallback) => {
    if (!hh) return `.${cls} {\n  font: ${fallback};\n}`
    return `.${cls} {\n  font-family: ${cls === 'body' ? 'var(--font-sans)' : 'var(--font-display)'};\n  font-size: ${sizeRef(sys, hh.fs)};\n  font-weight: ${cssVal(hh.fw, '400')};\n  line-height: ${/px$/.test(hh.lh) ? Math.round((parseFloat(hh.lh) / hh.fs) * 100) / 100 : hh.lh === 'normal' ? 1.2 : cssVal(hh.lh, '1.4')};${cssVal(hh.ls) ? `\n  letter-spacing: ${cssVal(hh.ls)};` : ''}${cssVal(hh.tt) ? `\n  text-transform: ${cssVal(hh.tt)};` : ''}\n  color: var(--color-text);\n}`
  }
  const secondary = b2
    ? `.btn-secondary {\n  background: ${b2.bg && b2.bg[3] > 0.5 ? colorRef(sys, b2.bg) : 'transparent'};\n  color: ${colorRef(sys, b2.fg) || 'var(--color-text)'};\n  border-color: ${b2.bd ? colorRef(sys, b2.bd) : 'transparent'};\n  border-radius: ${radiusRef(sys, b2.radius >= b2.h / 2 - 1 ? 999 : b2.radius)};\n}`
    : '.btn-secondary {\n  background: transparent;\n  color: var(--color-text);\n  border-color: var(--color-line);\n}'
  return `/* 设计系统「${cmt(sys.name)}」的组件样式：照网站上的按钮、输入框、卡片量出来的，全用 tokens.css 里的变量。复制到设计目录，在 tokens.css 后面 link */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: ${b.h ? Math.max(32, b.h) : 44}px;
  padding: ${pad(b, 10, 20)};
  border: ${b.bw || 1}px solid ${b.bd ? colorRef(sys, b.bd) : 'transparent'};
  border-radius: ${sys.pill ? 'var(--radius-full)' : radiusRef(sys, b.radius)};
  background: var(--color-primary);
  color: var(--color-primary-ink);
  font: ${cssVal(b.fw, '600')} ${b.fs ? sizeRef(sys, b.fs) : 'var(--text-md)'}/1.2 var(--font-sans);${tt(b)}${cssVal(b.shadow) ? `\n  box-shadow: ${cssVal(b.shadow)};` : ''}
  cursor: pointer;
  transition: filter var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.btn:hover { filter: brightness(1.06); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
${secondary}
.btn-ghost {
  background: transparent;
  color: var(--color-primary);
  border-color: transparent;
}

.input {
  min-height: ${inp.h ? Math.max(32, inp.h) : 44}px;
  padding: ${pad(inp, 10, 12)};
  border: ${inp.bw || 1}px solid ${inp.bd ? colorRef(sys, inp.bd) : 'var(--color-line)'};
  border-radius: ${radiusRef(sys, inp.radius != null ? inp.radius : sys.radius.sm)};
  background: ${inp.bg && inp.bg[3] > 0.5 ? colorRef(sys, inp.bg) : 'var(--color-surface)'};
  color: var(--color-text);
  font: 400 ${inp.fs ? sizeRef(sys, inp.fs) : 'var(--text-md)'}/1.4 var(--font-sans);
}
.input::placeholder { color: var(--color-muted); }
.input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 22%, transparent); }

.card {
  background: ${card.bg && card.bg[3] > 0.5 ? colorRef(sys, card.bg) : 'var(--color-surface)'};
  border-radius: ${radiusRef(sys, card.radius != null ? card.radius : sys.radius.lg)};
  border: ${card.bd ? `${card.bw || 1}px solid ${colorRef(sys, card.bd)}` : 'none'};
  box-shadow: ${card.shadow ? 'var(--shadow-md)' : 'none'};
  padding: ${card.py != null ? Math.max(12, card.py) : 24}px ${card.px != null ? Math.max(12, card.px) : 24}px;
}

.tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: ${sys.pill ? 'var(--radius-full)' : 'var(--radius-sm)'};
  background: color-mix(in oklab, var(--color-primary) 12%, var(--color-surface));
  color: var(--color-primary);
  font: 600 var(--text-xs)/1 var(--font-sans);
}

.link {
  color: var(--color-${sys.colors.link ? 'link' : 'primary'});
  text-decoration: none;
}
.link:hover { text-decoration: underline; }

/* 文字样式 */
${textStyle('display', h.h1, '700 var(--text-4xl)/1.1 var(--font-display)')}
${textStyle('h2', h.h2, '700 var(--text-2xl)/1.25 var(--font-display)')}
${textStyle('h3', h.h3, '600 var(--text-lg)/1.35 var(--font-display)')}
${textStyle('body', sys.body ? { ...sys.body, fs: sys.body.fs } : null, '400 var(--text-md)/1.65 var(--font-sans)')}
.caption {
  font: 400 var(--text-sm)/1.5 var(--font-sans);
  color: var(--color-muted);
}
`
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** 样张：色板、字号、组件（放进设计工作台、或浏览器里看） */
export function specimenHtml(sys, meta = {}) {
  const c = sys.colors
  const sw = Object.keys(c).map((k) => {
    const ratio = contrast(c[k], k === 'primary-ink' ? c.primary : k === 'bg' ? c.text : c.bg)
    return `<figure class="sw"><i style="background:var(--color-${k})"></i><figcaption><b>${esc(ROLE_NOTE[k] || k)}</b><code>--color-${k}</code><span>${hexOf(c[k])} · ${ratio.toFixed(1)}:1</span></figcaption></figure>`
  }).join('\n      ')
  const steps = Object.entries(sys.text).slice().reverse().map(([k, v]) => `<div class="step"><code>--text-${k} · ${v}px</code><span style="font-size:var(--text-${k})">${v >= 32 ? '好设计，一眼看得懂' : '好设计一眼看得懂，Good design is obvious'}</span></div>`).join('\n      ')
  const radii = ['sm', 'md', 'lg', 'xl', 'full'].map((k) => `<div class="rd"><i style="border-radius:var(--radius-${k})"></i><code>${k}</code></div>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="dsh-design" content="web">
<title>${esc(sys.name)} · 设计系统</title>
${(sys.font.links || []).map((l) => `<link rel="stylesheet" href="${esc(l)}">`).join('\n')}
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components.css">
<style>
  body { margin: 0; background: var(--color-bg); color: var(--color-text); font: 400 var(--text-md)/1.6 var(--font-sans); }
  main { max-width: 1120px; margin: 0 auto; padding: 56px 40px 80px; }
  header.top { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; border-bottom: 1px solid var(--color-line); padding-bottom: 24px; margin-bottom: 40px; }
  header.top p { margin: 0; color: var(--color-muted); font-size: var(--text-sm); }
  section { margin: 0 0 48px; }
  h2.sec { font: 600 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--color-muted); margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .sw { margin: 0; border: 1px solid var(--color-line); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
  .sw i { display: block; height: 72px; border-bottom: 1px solid var(--color-line); }
  .sw figcaption { display: grid; gap: 2px; padding: 10px 12px; font-size: var(--text-xs); }
  .sw b { font-size: var(--text-sm); }
  .sw code, .sw span { color: var(--color-muted); }
  .step { display: grid; grid-template-columns: 150px 1fr; align-items: baseline; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--color-line); }
  .step code { color: var(--color-muted); font-size: var(--text-xs); }
  .step span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .rd { display: grid; justify-items: center; gap: 6px; font-size: var(--text-xs); color: var(--color-muted); }
  .rd i { width: 64px; height: 64px; background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface)); border: 1px solid var(--color-line); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
  .fonts p { margin: 0 0 8px; }
  .sh { display: flex; gap: 24px; }
  .sh div { width: 120px; height: 72px; border-radius: var(--radius-md); background: var(--color-surface); display: grid; place-items: center; font-size: var(--text-xs); color: var(--color-muted); }
  @media (max-width: 720px) { main { padding: 32px 18px 48px; } .two { grid-template-columns: 1fr; } .step { grid-template-columns: 1fr; gap: 4px; } }
</style>
</head>
<body>
<main>
  <header class="top">
    <div><p>设计系统</p><h1 class="display" style="margin:4px 0 0">${esc(sys.name)}</h1></div>
    <p>${esc(meta.source || '')}${meta.date ? ' · ' + esc(meta.date) : ''}</p>
  </header>

  <section>
    <h2 class="sec">颜色</h2>
    <div class="grid">
      ${sw}
    </div>
  </section>

  <section class="two">
    <div>
      <h2 class="sec">字体</h2>
      <div class="fonts">
        <p class="display" style="margin-bottom:12px">标题 Display Aa</p>
        <p class="h2">二级标题 Heading</p>
        <p class="h3">三级标题 Subheading</p>
        <p class="body">正文：好的界面让人不用想就知道下一步做什么。The quick brown fox jumps over the lazy dog.</p>
        <p class="caption">说明文字 · Caption · 2026</p>
      </div>
    </div>
    <div>
      <h2 class="sec">组件</h2>
      <div class="row" style="margin-bottom:16px">
        <button class="btn">${esc((sys.comps.button && sys.comps.button.text) || '立即开始')}</button>
        <button class="btn btn-secondary">${esc((sys.comps.button2 && sys.comps.button2.text) || '了解更多')}</button>
        <button class="btn btn-ghost">文字按钮</button>
        <span class="tag">标签</span>
      </div>
      <input class="input" placeholder="输入框占位文字" style="width:100%;margin-bottom:16px">
      <div class="card"><p class="h3" style="margin:0 0 6px">卡片标题</p><p class="caption" style="margin:0">卡片里的说明文字，两行以内。<a class="link" href="#">文字链接</a></p></div>
    </div>
  </section>

  <section>
    <h2 class="sec">字号阶梯</h2>
    ${steps}
  </section>

  <section class="two">
    <div>
      <h2 class="sec">圆角</h2>
      <div class="row">${radii}</div>
    </div>
    <div>
      <h2 class="sec">阴影</h2>
      <div class="sh"><div style="box-shadow:var(--shadow-sm)">--shadow-sm</div><div style="box-shadow:var(--shadow-md)">--shadow-md</div></div>
    </div>
  </section>
</main>
</body>
</html>
`
}

const fmtColor = (sys, k) => `\`${hexOf(sys.colors[k])}\``

export function designMd(sys, meta = {}) {
  const c = sys.colors
  const rows = Object.keys(c).map((k) => {
    const on = k === 'primary-ink' ? c.primary : k === 'bg' ? c.text : c.bg
    return `| ${ROLE_NOTE[k] || k} | \`--color-${k}\` | ${fmtColor(sys, k)} | ${contrast(c[k], on).toFixed(1)}:1 |`
  })
  const comp = (label, s, extra = '') => {
    if (!s) return ''
    const parts = []
    if (s.bg && s.bg[3] > 0.5) parts.push(`底色 ${colorRef(sys, s.bg)}`)
    if (s.fg) parts.push(`字 ${colorRef(sys, s.fg)}`)
    if (s.bd) parts.push(`边框 ${s.bw || 1}px ${colorRef(sys, s.bd)}`)
    parts.push(`圆角 ${s.radius >= s.h / 2 - 1 ? '全圆（胶囊）' : s.radius + 'px'}`)
    if (s.h) parts.push(`高 ${s.h}px`)
    if (s.py != null) parts.push(`内边距 ${s.py}px ${s.px}px`)
    if (s.fs) parts.push(`字 ${s.fs}px / ${s.fw}`)
    if (s.tt) parts.push(`文字 ${s.tt}`)
    if (s.shadow) parts.push('有阴影')
    if (s.grad) parts.push('底色是渐变')
    return `- **${label}**：${parts.join('，')}${s.text ? `（网站上写的是「${s.text}」）` : ''}${extra}`
  }
  const hd = sys.comps.header
  const head = (tg) => { const x = sys.heads[tg]; return x ? `${tg.toUpperCase()} ${x.fs}px / ${x.fw}${x.ls ? `，字距 ${x.ls}` : ''}${x.tt ? `，${x.tt}` : ''}` : '' }
  return `# 「${sys.name}」设计系统

来源：${meta.source || '—'}${meta.date ? `（${meta.date} 提取）` : ''}

> 做新设计时：把这个目录里的 \`tokens.css\`、\`components.css\` 复制进设计目录，每屏都 link 这两个文件（先 tokens 后 components）。颜色、字体、圆角、阴影、按钮输入框卡片都照这里来，不要另起一套配色。
> 样张：\`components.html\`（色板、字号、组件放在一起看）。

## 品牌气质

（待补：两三句话说清这个品牌给人什么感觉、设计时该保持什么、该避免什么。看 source/ 里的网站截图写。）

## 颜色

| 角色 | 变量 | 值 | 对比度 |
| --- | --- | --- | --- |
${rows.join('\n')}

主色在网站上大约占 ${sys.share.primary}% 的面积${sys.share.accent ? `，点缀色约 ${sys.share.accent}%` : ''}：主色只用在关键按钮、选中态和少量强调，大面积还是背景和表面色。

## 字体

- 正文：\`${sys.font.sans}\`
- 标题：${sys.font.display ? `\`${sys.font.display}\`` : '和正文同一款'}
${sys.font.links.length ? `- 网站从这里载入字体：${sys.font.links.map((l) => `\`${l}\``).join('、')}（样张已经 link 了，设计稿要用同样的字体也 link 它）\n` : ''}- 标题：${['h1', 'h2', 'h3'].map(head).filter(Boolean).join('；') || '没量到'}
- 正文：${sys.body ? `${sys.body.fs}px，行高 ${sys.body.lh}` : '没量到'}
- 字号阶梯：${Object.entries(sys.text).map(([k, v]) => `${k} ${v}`).join(' · ')}（px）

## 形状与层次

- 圆角：sm ${sys.radius.sm}px · md ${sys.radius.md}px · lg ${sys.radius.lg}px · xl ${sys.radius.xl}px${sys.pill ? ' · 按钮用全圆' : ''}
- 阴影：sm \`${sys.shadow.sm || 'none'}\`；md \`${sys.shadow.md || 'none'}\`

## 组件（components.css 里有现成的类）

${[comp('主按钮 `.btn`', sys.comps.button), comp('次按钮 `.btn-secondary`', sys.comps.button2), comp('输入框 `.input`', sys.comps.input), comp('卡片 `.card`', sys.comps.card)].filter(Boolean).join('\n') || '- 没量到按钮、输入框、卡片（项目里没有能直接打开的页面）；components.css 按设计变量给了一套默认写法'}
${hd ? `- **顶栏**：高 ${hd.h}px，底色 ${colorRef(sys, hd.bg)}${hd.pos === 'fixed' || hd.pos === 'sticky' ? '，滚动时固定在顶上' : ''}${hd.line ? `，底边一条 ${colorRef(sys, hd.line)} 的线` : ''}${hd.shadow ? '，带阴影' : ''}${hd.blur ? '，毛玻璃' : ''}` : ''}
- 文字样式：\`.display\` \`.h2\` \`.h3\` \`.body\` \`.caption\`；标签 \`.tag\`；文字链接 \`.link\`

## 注意

${sys.notes.length ? sys.notes.map((n) => `- ${n}`).join('\n') : '- 没有'}
${sys.libs.length ? `\n项目用了：${sys.libs.join('、')}。在这个项目里写代码时，优先用它的组件，样式按上面的变量改。\n` : ''}
## 原始数据（提取时量到的，核对用）

${sys.vars.length ? `网站 / 项目里的 CSS 变量（前 ${Math.min(sys.vars.length, 40)} 个）：\n\n\`\`\`css\n${sys.vars.slice(0, 40).map(([n, v]) => `${n}: ${v};`).join('\n')}\n\`\`\`\n` : '没有 CSS 变量。\n'}${sys.tailwind ? `\nTailwind 配置（theme 部分）：\n\n\`\`\`js\n${sys.tailwind.slice(0, 2000)}\n\`\`\`\n` : ''}`
}

// ── 设计系统库：列出、默认用哪套 ─────────────────────────────────────────────

/** 库里的文件夹得是真文件夹：是软链接（或文件）就不往里写，免得写到库外面去 */
function realDir(d) {
  let st = null
  try { st = fs.lstatSync(d) } catch { fs.mkdirSync(d) }
  if (st && !st.isDirectory()) throw new Error(`${d} 不是普通文件夹（是软链接或文件），先挪走再提取`)
}

/** 是普通文件（不是软链接） */
const isFile = (f) => { try { return fs.lstatSync(f).isFile() } catch { return false } }

/** 写文件：原来是软链接就先删掉链接本身（不碰它指的文件），再写成普通文件 */
function writeOwn(file, data) {
  try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file) } catch { /* 没有 */ }
  fs.writeFileSync(file, data)
}

const safeName = (s) => String(s || '').replace(/[^\w一-鿿-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * tokens.css 第一段 :root 里的变量（按括号配对找这段的结尾，一行写完、最后一条没分号的也认）。
 * 先把注释、字符串遮住（等长）再找：字符串里的 { } ; 不算，值从原文里取
 */
export function tokensOf(text) {
  const css = String(text || '')
  const masked = css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/g, (x) => (x.startsWith('/*') ? ' ' : '_').repeat(x.length))
  const out = {}
  const m = /:root\s*\{/.exec(masked)
  if (!m) return out
  const from = m.index + m[0].length
  let depth = 1
  let i = from
  for (; i < masked.length && depth; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') depth--
  }
  const to = depth ? i : i - 1
  for (const x of masked.slice(from, to).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+?)\s*(?:;|$)/gd)) {
    const [a, b] = x.indices[2]
    out[x[1]] = css.slice(from + a, from + b).trim()
  }
  return out
}

export function defaultSystem(dir = SYSTEMS_DIR) {
  const idx = readJson(path.join(dir, 'index.json'))
  const id = idx && typeof idx.default === 'string' ? idx.default : ''
  return id && fs.existsSync(path.join(dir, id, 'tokens.css')) ? id : ''
}

export function setDefault(dir = SYSTEMS_DIR, id = '') {
  if (id && !fs.existsSync(path.join(dir, id, 'tokens.css'))) throw new Error(`没有这套设计系统：${id}`)
  fs.mkdirSync(dir, { recursive: true })
  const idx = readJson(path.join(dir, 'index.json')) || {}
  idx.default = id || ''
  writeOwn(path.join(dir, 'index.json'), JSON.stringify(idx, null, 2))
  return idx.default
}

/** 库里的每一套：名字、来源、几个主要颜色、字体（右侧栏列出来；技能里告诉模型） */
export function listSystems(dir = SYSTEMS_DIR) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const def = defaultSystem(dir)
  const out = []
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const root = path.join(dir, e.name)
    let tok
    try { tok = tokensOf(fs.readFileSync(path.join(root, 'tokens.css'), 'utf8')) } catch { continue }
    const meta = readJson(path.join(root, 'system.json')) || {}
    const colors = ['bg', 'surface', 'text', 'muted', 'primary', 'accent', 'line'].map((k) => [k, tok[`--color-${k}`]]).filter(([, v]) => v)
    out.push({
      id: e.name,
      name: String(meta.name || e.name),
      sources: Array.isArray(meta.sources) ? meta.sources.slice(0, 5) : [],
      createdAt: meta.createdAt || 0,
      dir: root,
      colors: Object.fromEntries(colors),
      font: familyOf(tok['--font-display'] && !/^var\(/.test(tok['--font-display']) ? tok['--font-display'] : tok['--font-sans']),
      radius: tok['--radius-md'] || '',
      preview: fs.existsSync(path.join(root, 'source', 'preview.jpg')),
      default: e.name === def,
    })
  }
  return out.sort((a, b) => (b.default - a.default) || (b.createdAt - a.createdAt))
}

/** 给 ui-design 技能补的一段：用户有哪些设计系统、默认用哪套、怎么用 */
export function skillSection(dir = SYSTEMS_DIR) {
  const list = listSystems(dir)
  const def = list.find((x) => x.default)
  const others = list.filter((x) => !x.default)
  const head = '\n\n## 设计系统（用户自己的品牌）\n\n'
  const how = '用户给了自己的网站地址或项目目录、说「照我们的品牌来」：调 `extract_design_system` 提一套（网站地址最准；项目目录会扫样式文件），提完核对 DESIGN.md、补上「品牌气质」，再 `preview_page` 打开它的 `components.html` 给用户看一眼。'
  if (!list.length) return head + how + '\n'
  const line = (x) => `「${x.name}」：${x.dir}${x.sources.length ? `（来自 ${x.sources[0]}）` : ''}`
  let s = head
  if (def) {
    s += `**默认设计系统**：${line(def)}\n\n做新设计时照它来：\n\n` +
      '- 先读它的 `DESIGN.md`，把它的 `tokens.css`、`components.css` 复制进设计目录（不用技能自带的起手模板），每屏都 link 这两个文件，按钮、输入框、卡片直接用里面的类；\n' +
      '- 第 0 步不问「想要什么感觉」、不推风格卡：品牌已经定了；只问给谁用、要哪几屏、必须有的内容。三个方向用同一套配色和字体，在版式和信息重点上拉开；\n' +
      '- 用户点了风格卡、或者说这次不用品牌（「换个风格」「别照官网」）就不用它。\n'
  } else s += '用户有设计系统，但没设默认：用户点名时（「用 XX 的设计系统」）照下面那套来，做法同上：复制 tokens.css、components.css，读 DESIGN.md。\n'
  if (others.length) s += `\n${def ? '其他' : '库里'}的设计系统（用户点名时用）：\n\n${others.slice(0, 8).map((x) => `- ${line(x)}`).join('\n')}\n`
  s += '\n' + how + '\n'
  return s
}

// ── 提取：解析来源、量、写文件 ────────────────────────────────────────────────

/** 来源 → { kind: 'url' | 'file' | 'dir', url?, path?, label } */
export function resolveSource(input, cwd = os.homedir()) {
  const s = String(input || '').trim()
  if (!s) throw new Error('没给来源：网站地址、HTML 文件或项目文件夹')
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s)
    return { kind: 'url', url: u.href, label: u.hostname.replace(/^www\./, '') }
  }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && !fs.existsSync(path.resolve(cwd, s))) {
    const u = new URL('https://' + s)
    return { kind: 'url', url: u.href, label: u.hostname.replace(/^www\./, '') }
  }
  const p = path.resolve(cwd, s.replace(/^~(?=$|[\\/])/, os.homedir()))
  let st
  try { st = fs.statSync(p) } catch { throw new Error(`找不到 ${p}`) }
  if (st.isDirectory()) return { kind: 'dir', path: p, label: path.basename(p) }
  if (/\.html?$/i.test(p)) return { kind: 'file', path: p, url: pathToFileURL(p).href, label: path.basename(p) }
  throw new Error(`${p} 不是 HTML 文件，也不是文件夹`)
}

function guessName(rendered, scans, srcs) {
  for (const r of rendered) if (r.data.brand) return r.data.brand
  for (const r of rendered) {
    // 标题「品牌 | 口号」「页面 - 品牌」：哪段在页面的标志 / 顶栏里出现就是哪段，不然取第一段
    const t = String(r.data.title || '').split(/\s+[|\-–—·:：_]\s+|\s*[|｜–—·：]\s*/).map((x) => x.trim()).filter((x) => x && x.length <= 24)
    if (t.length) return t.find((x) => r.data.headerText && r.data.headerText.includes(x)) || t[0]
  }
  for (const s of scans) if (s.name) return s.name
  const u = srcs.find((x) => x.kind === 'url')
  if (u) return u.label.split('.').slice(0, -1).join('.') || u.label
  return srcs[0] ? srcs[0].label.replace(/\.html?$/i, '') : '我的品牌'
}

function mergeScans(list) {
  if (!list.length) return null
  if (list.length === 1) return list[0]
  const out = { ...list[0], vars: new Map(), colors: new Map(), fonts: new Map(), radii: new Map(), libs: [], entries: [], fontLinks: [] }
  for (const s of list) {
    for (const k of ['vars', 'colors', 'fonts', 'radii']) for (const [a, b] of s[k]) { const e = out[k].get(a); if (e) e.n += b.n; else out[k].set(a, { ...b }) }
    out.libs.push(...s.libs.filter((x) => !out.libs.includes(x)))
    out.entries.push(...s.entries)
    out.fontLinks.push(...s.fontLinks)
    if (!out.tailwind && s.tailwind) out.tailwind = s.tailwind
  }
  return out
}

/**
 * 提一套设计系统，写进库里。
 * @returns { id, name, dir, sys, text, images: [{ key, label, jpg }], replaced }
 */
export async function extractSystem({ browser, sources, name = '', cwd = os.homedir(), dir = SYSTEMS_DIR, makeDefault = true, now = new Date() }) {
  const srcs = []
  const bad = []
  for (const s of (Array.isArray(sources) ? sources : [sources]).filter(Boolean).slice(0, MAX_SOURCES)) {
    try { srcs.push(resolveSource(s, cwd)) } catch (e) { bad.push(e.message) }
  }
  if (!srcs.length) throw new Error(bad[0] || '没给来源')
  const scans = []
  const toRender = []
  for (const s of srcs) {
    if (s.kind === 'dir') {
      const sc = scanProject(s.path)
      scans.push(sc)
      for (const f of sc.entries.slice(0, 2)) toRender.push({ url: pathToFileURL(f).href, label: path.relative(s.path, f).replace(/\.html?$/i, '').replace(/[\\/]+/g, '-') })
    } else toRender.push({ url: s.url, label: s.label.replace(/\.html?$/i, '') })
  }
  const rendered = []
  const errors = [...bad]
  const canRender = browser && browser.available()
  if (canRender) {
    for (const t of toRender.slice(0, MAX_SOURCES)) {
      try { rendered.push(await renderPage(browser, t.url, safeName(t.label) || 'page')) } catch (e) { errors.push(`${t.url}：${String((e && e.message) || e).slice(0, 120)}`) }
    }
  } else if (toRender.length) errors.push('这台电脑上没找到 Chrome / Edge，网页没法打开量，只扫了项目里的样式文件')
  const scan = mergeScans(scans)
  const scanned = scan && (scan.colors.size || scan.vars.size || scan.fonts.size)
  if (!rendered.length && !scanned) throw new Error(`没量到东西：${errors.join('；') || '项目里没找到样式文件'}`)
  const nm = String(name || '').trim() || guessName(rendered, scans, srcs)
  const sys = synthesize(rendered.map((r) => r.data), scan, { name: nm })
  const id = safeName(nm) || 'brand'
  fs.mkdirSync(dir, { recursive: true })
  const root = path.join(dir, id)
  realDir(root)
  const replaced = isFile(path.join(root, 'tokens.css'))
  if (replaced) {
    // 重新提取同一套：原来的几个文件留一份（DESIGN.md 里模型补过的说明）
    const prev = path.join(root, '.prev')
    realDir(prev)
    for (const f of ['tokens.css', 'components.css', 'DESIGN.md']) { if (isFile(path.join(root, f))) writeOwn(path.join(prev, f), fs.readFileSync(path.join(root, f))) }
  }
  realDir(path.join(root, 'source'))
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const source = srcs.map((s) => s.url && s.kind === 'url' ? s.url : s.path).join('、')
  const meta = { source, date }
  writeOwn(path.join(root, 'tokens.css'), tokensCss(sys, meta))
  writeOwn(path.join(root, 'components.css'), componentsCss(sys))
  writeOwn(path.join(root, 'components.html'), specimenHtml(sys, meta))
  writeOwn(path.join(root, 'DESIGN.md'), designMd(sys, meta))
  writeOwn(path.join(root, 'system.json'), JSON.stringify({ name: nm, sources: srcs.map((s) => s.url && s.kind === 'url' ? s.url : s.path), createdAt: now.getTime(), version: 1 }, null, 2))
  const images = []
  for (const r of rendered) {
    for (const s of r.shots) {
      writeOwn(path.join(root, 'source', `${s.key}.jpg`), s.jpg)
      images.push(s)
    }
  }
  // 样张截一张（右侧栏的缩略图；也给模型看提出来的长什么样）
  if (canRender) {
    try {
      const jpg = await browser.withPage({ url: pathToFileURL(path.join(root, 'components.html')).href, w: 1280, h: 800 }, async (page) => {
        await page.eval('Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]).then(() => true)')
        return page.shot()
      })
      writeOwn(path.join(root, 'source', 'preview.jpg'), jpg)
      images.push({ key: 'specimen', label: '提出来的设计系统（样张）', jpg })
    } catch (e) { errors.push(`样张没截成：${String((e && e.message) || e).slice(0, 80)}`) }
  }
  // 明说了不设默认就不动默认（哪怕现在还没有默认）
  if (makeDefault) setDefault(dir, id)
  const isDefault = defaultSystem(dir) === id
  return { id, name: nm, dir: root, sys, images: images.slice(0, 8), replaced, isDefault, text: summaryText({ sys, root, nm, rendered, scan, errors, replaced, isDefault, images }) }
}

function summaryText({ sys, root, nm, rendered, scan, errors, replaced, isDefault, images }) {
  const c = sys.colors
  const lines = [
    `${replaced ? '重新提取并覆盖了' : '提好了'}设计系统「${nm}」：${root}${isDefault ? '（已设为默认：以后做新设计都照它来）' : ''}`,
    `量了：${rendered.map((r) => r.url).join('、') || '（没开网页）'}${scan ? `；扫了项目里 ${scan.files} 个文件` : ''}`,
    '',
    '颜色：' + Object.keys(c).map((k) => `${k} ${hexOf(c[k])}`).join(' · '),
    `字体：正文 ${familyOf(sys.font.sans)}${sys.font.display ? `，标题 ${familyOf(sys.font.display)}` : ''}；字号阶梯 ${Object.values(sys.text).join(' / ')}px`,
    `圆角：${['sm', 'md', 'lg', 'xl'].map((k) => sys.radius[k]).join(' / ')}px${sys.pill ? '（按钮全圆）' : ''}；阴影：${sys.shadow.md && sys.shadow.md !== 'none' ? '有' : '基本不用'}`,
    `组件：${[sys.comps.button && '主按钮', sys.comps.button2 && '次按钮', sys.comps.input && '输入框', sys.comps.card && '卡片', sys.comps.header && '顶栏'].filter(Boolean).join('、') || '没量到（components.css 用的默认写法）'}`,
  ]
  if (sys.libs.length) lines.push(`项目用了：${sys.libs.join('、')}`)
  if (sys.vars.length) lines.push(`网站 / 项目里有 ${sys.vars.length} 个 CSS 变量（DESIGN.md 末尾列着，角色猜得不对时对照它改）`)
  if (sys.notes.length) lines.push('', '注意：', ...sys.notes.map((n) => `- ${n}`))
  if (errors.length) lines.push('', '没量成的：', ...errors.map((e) => `- ${e}`))
  lines.push('',
    '文件：tokens.css（设计变量）、components.css（按钮 / 输入框 / 卡片 / 文字样式）、components.html（样张）、DESIGN.md（说明）、source/（截图）。',
    images.length ? `附了 ${images.length} 张图：网站截图、组件截图${images.some((x) => x.key === 'specimen') ? '，最后一张是提出来的样张' : ''}。` : '',
    '接下来：',
    '1. 对照网站截图看样张：角色猜错了（比如主色其实是另一个颜色、背景不对）就改 tokens.css，components.css 跟着变量走；',
    '2. 把 DESIGN.md 的「品牌气质」补上两三句（看截图写：给人什么感觉、该保持什么、该避免什么）；',
    '3. 用 preview_page 打开 components.html 给用户看一眼，说清提出来的主色、字体、圆角；',
    '4. 以后做新设计：复制这套 tokens.css、components.css 进设计目录（ui-design 技能的「设计系统」一节有写）。')
  return lines.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n')
}
