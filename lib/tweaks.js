/**
 * 专属调节滑块：模型按这套设计挑几个最值得试的维度（留白、圆角、主色、卡片排法……），写进设计目录的 tweaks.json。
 * 右侧栏把它们列成滑块 / 取色 / 几选一，拖的时候所有屏一起变（只在页面上改 CSS 变量和 <html> 上的属性，不动文件）；
 * 定下来再写回文件：CSS 变量改样式里 :root 上的默认值（tokens.css 优先），属性写到每屏的 <html> 上，tweaks.json 的 value 跟着改。
 *
 * tweaks.json（也可以直接是数组）：
 *   { "tweaks": [
 *       { "id": "density", "label": "留白", "var": "--density", "min": 0.8, "max": 1.4, "step": 0.05, "value": 1 },
 *       { "id": "radius", "label": "圆角", "var": "--radius-md", "min": 0, "max": 28, "unit": "px", "value": 12 },
 *       { "id": "brand", "label": "主色", "var": "--color-primary", "type": "color", "value": "#c26a32" },
 *       { "id": "layout", "label": "商品排法", "attr": "data-layout", "options": [{ "label": "两列", "value": "grid" }, { "label": "大图", "value": "list" }], "value": "grid" }
 *   ] }
 *   var + min / max → 滑块；var + type: color → 取色；options（var 或 attr）→ 几选一。attr 只认 data-*。
 */

import fs from 'node:fs'
import path from 'node:path'
import { listScreens } from './core.js'
import { parseColor, hexOf } from './system.js'

export const TWEAKS_FILE = 'tweaks.json'
export const MAX_TWEAKS = 8
const VAR_NAME = /^--[A-Za-z0-9_-]{1,60}$/
const ATTR_NAME = /^data-[a-z0-9-]{1,40}$/
const MAX_FILE = 512 * 1024

/** 小数位数（1e-7 这种写法也认） */
const decimals = (n) => {
  const s = String(n)
  const e = /e-(\d+)$/.exec(s)
  return e ? Number(e[1]) : (s.split('.')[1] || '').length
}

/** 夹进 [min, max]，再从 min 起按步长取整（和 <input type=range> 一样；最后一格不够一步就退一格） */
const quantize = (v, min, max, step) => {
  const x = Math.max(min, Math.min(max, v))
  let q = min + Math.round((x - min) / step) * step
  if (q > max + step * 1e-9) q -= step
  return Number(Math.max(min, q).toFixed(Math.min(6, Math.max(decimals(step), decimals(min)))))
}

/** 括号、方括号成对（不成对的值写进去会把后面的样式吞掉） */
const balanced = (s) => {
  const st = []
  for (const ch of s) {
    if (ch === '(') st.push(')')
    else if (ch === '[') st.push(']')
    else if ((ch === ')' || ch === ']') && st.pop() !== ch) return false
  }
  return !st.length
}

/** 滑块的数：±1000000 以内、最多 6 位小数（再细写回时也分不出来） */
const fine = (n) => Number.isFinite(n) && Math.abs(n) <= 1e6 && decimals(n) <= 6

/** 几选一的选项：[{ label, value }] / ["a", "b"] / { "两列": "grid" } → [{ label, value }] */
function optionsOf(o) {
  const list = Array.isArray(o) ? o.map((x) => (x && typeof x === 'object' ? { label: x.label, value: x.value } : { label: x, value: x }))
    : o && typeof o === 'object' ? Object.entries(o).map(([label, value]) => ({ label, value })) : []
  return list
    // 值会原样写进 CSS / HTML：引号、分号、花括号、注释、反斜杠、!、$ 都不收，圆括号方括号要成对
    .filter((x) => x.value != null && String(x.value).length <= 60 && /^[^<>"'`;{}\\*!$&]*$/.test(String(x.value)) && balanced(String(x.value)) && String(x.value).trim() !== '')
    .map((x) => ({ label: String(x.label == null ? x.value : x.label).slice(0, 12), value: String(x.value) }))
    .slice(0, 6)
}

/**
 * tweaks.json 的内容 → { list, errors }。
 * list：[{ id, i, label, note, kind: 'range' | 'color' | 'choice', var?, attr?, min, max, step, unit, options, value }]（i 是在原数组里第几个，写回时用）
 */
export function parseTweaks(text) {
  let raw
  try { raw = JSON.parse(String(text || '')) } catch (e) { return { list: [], errors: [`tweaks.json 不是合法的 JSON：${String(e.message).slice(0, 80)}`] } }
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.tweaks) ? raw.tweaks : null
  if (!arr) return { list: [], errors: ['tweaks.json 里要有 "tweaks": [ … ]'] }
  const list = []
  const errors = []
  const ids = new Set()
  let over = false
  arr.forEach((x, i) => {
    if (list.length >= MAX_TWEAKS) { if (!over) errors.push(`最多 ${MAX_TWEAKS} 个滑块，后面的没显示`); over = true; return }
    if (!x || typeof x !== 'object') { errors.push(`第 ${i + 1} 个不是对象`); return }
    const v = typeof x.var === 'string' && VAR_NAME.test(x.var) ? x.var : ''
    const a = typeof x.attr === 'string' && ATTR_NAME.test(x.attr.toLowerCase()) ? x.attr.toLowerCase() : ''
    const label = String(x.label || x.name || x.id || v || a || '').slice(0, 16)
    if (!v && !a) { errors.push(`「${label || i + 1}」要写 var（CSS 变量，如 --density）或 attr（data- 开头的属性，如 data-layout）`); return }
    let id = typeof x.id === 'string' && /^[\w-]{1,32}$/.test(x.id) ? x.id : (v || a).replace(/^--|^data-/, '')
    while (ids.has(id)) id += '-2'
    ids.add(id)
    const k = { id, i, label, note: typeof x.note === 'string' ? x.note.slice(0, 40) : '' }
    if (v) k.var = v
    else k.attr = a
    const opts = optionsOf(x.options)
    if (opts.length >= 2) {
      k.kind = 'choice'
      k.options = opts
      const cur = x.value == null ? opts[0].value : String(x.value)
      k.value = opts.some((o) => o.value === cur) ? cur : opts[0].value
    } else if (a) {
      errors.push(`「${label}」用 attr 时要给 options（至少两个选项）`)
      return
    } else if (x.type === 'color') {
      const c = parseColor(x.value)
      k.kind = 'color'
      k.value = c ? hexOf(c) : '#000000'
    } else {
      const min = Number(x.min), max = Number(x.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) { errors.push(`「${label}」是滑块，要给 min、max（min 比 max 小）`); return }
      if (!fine(min) || !fine(max)) { errors.push(`「${label}」的 min、max 要在 ±1000000 以内，最多 6 位小数`); return }
      // 没写步长：范围大（像素、度数）一格 1，小的（倍数）分 100 格
      // 步长：要是有限的正数，而且一共不超过 1000 格（太细的按 100 格算）
      const given = Number(x.step)
      const step = fine(given) && given > 0 && (max - min) / given <= 1000 ? given
        : max - min >= 20 ? 1 : Number(((max - min) / 100).toPrecision(1))
      if (!(step > 0) || !fine(step)) { errors.push(`「${label}」的范围太小，分不出格`); return }
      k.kind = 'range'
      k.min = min
      k.max = max
      k.step = step
      k.unit = typeof x.unit === 'string' && /^[a-z%]{0,4}$/i.test(x.unit) ? x.unit : ''
      const val = Number.isFinite(Number(x.value)) ? Number(x.value) : min
      k.value = quantize(val, min, max, step)
    }
    list.push(k)
  })
  return { list, errors }
}

/** 一个滑块的值规整一下（越界、不在选项里的给 null） */
export function normValue(k, v) {
  if (k.kind === 'range') {
    const n = Number(v)
    return Number.isFinite(n) ? quantize(n, k.min, k.max, k.step) : null
  }
  if (k.kind === 'color') { const c = parseColor(v); return c ? hexOf(c) : null }
  return k.options.some((o) => o.value === String(v)) ? String(v) : null
}

/** 写进 CSS 的值：滑块带单位 */
export const cssValue = (k, v) => (k.kind === 'range' ? `${v}${k.unit}` : String(v))

/** 给人看的值：滑块带单位，几选一写选项名 */
export const shownValue = (k, v) => (k.kind === 'choice' ? (k.options.find((o) => o.value === String(v)) || { label: v }).label : cssValue(k, v))

const cache = new Map() // 文件 → { mtime, size, r }

/** 设计目录里的 tweaks.json → { list, errors }；没有这个文件给 null（按修改时间缓存） */
export function readTweaks(root) {
  if (!root) return null
  const file = path.join(root, TWEAKS_FILE)
  let st
  try { st = fs.lstatSync(file) } catch { cache.delete(file); return null }
  // 只认设计目录里的普通文件：软链接（可能指到目录外）当没有
  if (!st.isFile()) return null
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.r
  const r = st.size > MAX_FILE ? { list: [], errors: ['tweaks.json 太大了'] } : parseTweaks(fs.readFileSync(file, 'utf8'))
  cache.set(file, { mtime: st.mtimeMs, size: st.size, r })
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  return r
}

// ── 写回 ──────────────────────────────────────────────────────────────────

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const blank = (m) => m.replace(/[^\n]/g, ' ')
/**
 * 注释换成等长的空格、字符串和 url(…) 换成等长的 _（下标不变，换行留着）：找声明时不会找到这些里面去，
 * 里面的分号、括号也不会把声明切断
 */
const fill = (m) => m.replace(/[^\n]/g, '_')
// 一遍从左往右认：先碰到哪个算哪个（字符串里的 /* 不是注释，注释里的引号也不是字符串）；
// 字符串、url(…) 换成非空白：它们是值的一部分，不能被当成空白吃掉
const mask = (css) => css.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\burl\(\s*[^)'"\s][^)]*\)/gi, (m) => (m.startsWith('/*') ? blank(m) : fill(m)))
/** HTML 里的注释、<script> / <style> 的内容换成等长空格：找 <html> 标签时不会找到这些里面去 */
const maskHtml = (html, keepStyle = false) => html.replace(/<!--[\s\S]*?-->/g, blank)
  .replace(keepStyle ? /<(script)\b[^>]*>[\s\S]*?<\/script\s*>/gi : /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank)

/** 下标 i 在哪个规则块里：{ selector, depth }（depth 1 = 顶层规则，@media 里面的是 2） */
function blockAt(css, i) {
  const stack = []
  let start = 0
  for (let j = 0; j < i; j++) {
    const ch = css[j]
    if (ch === '{') { stack.push(css.slice(start, j).trim()); start = j + 1 } else if (ch === '}') { stack.pop(); start = j + 1 } else if (ch === ';') start = j + 1
  }
  return stack.length ? { selector: stack[stack.length - 1], depth: stack.length } : null
}

const ROOTISH = /(^|,)\s*(:root|html)\s*(,|$)/i

/**
 * 样式文本里 :root / html 上的 name 声明换成 value（只换值，!important、注释、别的声明都不动）。没找到给 null
 * nested 为假：顶层的全改（同一个变量写了几遍时生效的是最后一处，只改第一处等于没改）；
 * nested 为真：只改 @media 等里面的第一处（整个设计目录都没有顶层声明时才用）
 */
export function setVarDecl(css, name, value, nested = false) {
  const m0 = mask(css)
  // 只认一条声明的开头（前面是 { ; } 加空白）：--other--r、别的变量值里的「--r:」都不算；值到 ; } ! 为止
  const re = new RegExp(`(?<=[{};]\\s*)(${escRe(name)}\\s*:\\s*)([^;{}!]*?)(\\s*(?:;|}|!))`, 'g')
  const hits = []
  for (const m of m0.matchAll(re)) {
    const b = blockAt(m0, m.index)
    if (!b || !ROOTISH.test(b.selector) || (b.depth === 1) === nested) continue
    hits.push(m)
    if (nested) break
  }
  if (!hits.length) return null
  let out = css
  for (const m of hits.reverse()) {
    const at = m.index + m[1].length
    out = out.slice(0, at) + value + out.slice(at + m[2].length)
  }
  return out
}

/** HTML 里 <style> 块中的 :root 声明（规则同 setVarDecl；注释、脚本里的不算） */
function setVarInHtml(html, name, value, nested = false) {
  const re = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi
  const m0 = maskHtml(html, true)
  let out = html
  let hit = false
  for (const m of [...m0.matchAll(re)].reverse()) {
    const at = m.index + m[1].length
    const r = setVarDecl(html.slice(at, at + m[2].length), name, value, nested)
    if (r === null) continue
    out = out.slice(0, at) + r + out.slice(at + m[2].length)
    hit = true
    if (nested) break
  }
  return hit ? out : null
}

/** <html> 开头标签上设属性（有就改，没有就加；注释、脚本里的 <html> 不算） */
export function setHtmlAttr(html, attr, value) {
  const m = /<html\b(?:"[^"]*"|'[^']*'|[^'">])*>/i.exec(maskHtml(html))
  if (!m) return null
  const tag = html.slice(m.index, m.index + m[0].length)
  const val = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const put = ` ${attr}="${val}"`
  // 一个个属性往后读（引号里的不算），找到同名的就换掉它那一段；没有就加在最后
  const ATTR = /\s*([^\s"'>/=]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/y
  for (let i = 5; i < tag.length;) {
    ATTR.lastIndex = i
    const a = ATTR.exec(tag)
    if (!a) { i++; continue }
    if (a[1].toLowerCase() === attr.toLowerCase()) {
      const next = tag.slice(0, a.index) + put + tag.slice(a.index + a[0].length)
      return html.slice(0, m.index) + next + html.slice(m.index + tag.length)
    }
    i = a.index + a[0].length
  }
  const end = /\s*\/?>$/.exec(tag)
  const next = tag.slice(0, end.index) + put + tag.slice(end.index).trimStart()
  return html.slice(0, m.index) + next + html.slice(m.index + tag.length)
}

/** 设计目录第一层的这个文件是不是自己的：普通文件、不是软链接、真实位置在目录里 */
function ownFile(root, realRoot, rel) {
  const p = path.join(root, rel)
  try {
    if (!fs.lstatSync(p).isFile()) return false
    return path.dirname(fs.realpathSync(p)) === realRoot
  } catch { return false }
}

/** 设计目录里能放 CSS 变量默认值的文件：tokens.css 在前，再是别的 .css，最后是每屏 HTML 里的 <style>（软链接、指到外面的不算） */
function cssFiles(root, realRoot = '') {
  if (!realRoot) { try { realRoot = fs.realpathSync(root) } catch { return [] } }
  let names = []
  try { names = fs.readdirSync(root) } catch { return [] }
  const css = names.filter((n) => /\.css$/i.test(n) && !n.startsWith('.')).sort((a, b) => (a === 'tokens.css' ? -1 : b === 'tokens.css' ? 1 : a.localeCompare(b)))
  return [...css, ...listScreens(root)].filter((rel) => ownFile(root, realRoot, rel))
}

/**
 * 写回：values = { id: 值 }。CSS 变量改样式里的默认值，属性写到每屏的 <html> 上，tweaks.json 的 value 跟着改。
 * @returns { ok, changed: [{ id, label, from, to }], files: [相对路径], missed: [{ id, label }] }（missed：样式里找不到这个变量的默认值）
 */
export function applyTweaks(root, values) {
  const r0 = readTweaks(root)
  if (!r0 || !r0.list.length) return { ok: false, reason: 'no-tweaks' }
  let realRoot
  try { realRoot = fs.realpathSync(root) } catch { return { ok: false, reason: 'no-tweaks' } }
  // tweaks.json 是软链接（指到别处）就不写：写回只改设计目录自己的文件
  if (!ownFile(root, realRoot, TWEAKS_FILE)) return { ok: false, reason: 'no-tweaks' }
  const file = path.join(root, TWEAKS_FILE)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const arr = Array.isArray(raw) ? raw : raw.tweaks
  const texts = new Map()
  const read = (rel) => (texts.has(rel) ? texts.get(rel) : fs.readFileSync(path.join(root, rel), 'utf8'))
  const changed = []
  const missed = []
  for (const k of r0.list) {
    if (!values || !Object.hasOwn(values, k.id)) continue
    const v = normValue(k, values[k.id])
    if (v == null || v === k.value) continue
    if (k.var) {
      // 先把所有文件里顶层的声明都改掉（哪份样式后加载就是哪份生效，全改才稳）；一处都没有再退到 @media 里的第一处
      let done = false
      for (const nested of [false, true]) {
        for (const rel of cssFiles(root, realRoot)) {
          let t
          try { t = read(rel) } catch { continue }
          const next = /\.html?$/i.test(rel) ? setVarInHtml(t, k.var, cssValue(k, v), nested) : setVarDecl(t, k.var, cssValue(k, v), nested)
          if (next === null) continue
          texts.set(rel, next)
          done = true
          if (nested) break
        }
        if (done) break
      }
      if (!done) { missed.push({ id: k.id, label: k.label }); continue }
    } else {
      for (const rel of listScreens(root)) {
        if (!ownFile(root, realRoot, rel)) continue
        const next = setHtmlAttr(read(rel), k.attr, v)
        if (next !== null) texts.set(rel, next)
      }
    }
    if (arr[k.i] && typeof arr[k.i] === 'object') arr[k.i].value = k.kind === 'range' ? v : String(v)
    changed.push({ id: k.id, label: k.label, from: shownValue(k, k.value), to: shownValue(k, v) })
  }
  if (!changed.length) return { ok: true, changed, files: [], missed }
  texts.set(TWEAKS_FILE, JSON.stringify(raw, null, 2) + '\n')
  for (const [rel, t] of texts) fs.writeFileSync(path.join(root, rel), t)
  return { ok: true, changed, files: [...texts.keys()], missed }
}

// ── 体检：滑块有没有真接上 ───────────────────────────────────────────────────

/**
 * 只看源码：变量有没有样式在用、有没有默认值；属性有没有样式按它区分。
 * @returns [文字]（check_design 的结果里列出来）
 */
export function lintTweaks(root) {
  const r = readTweaks(root)
  if (!r) return []
  const out = [...r.errors]
  if (!r.list.length) return out
  let all = ''
  for (const rel of cssFiles(root)) {
    // 只去掉注释：属性选择器里的引号（[data-layout="list"]）要留着
    try { all += '\n' + fs.readFileSync(path.join(root, rel), 'utf8').slice(0, MAX_FILE).replace(/\/\*[\s\S]*?\*\//g, blank) } catch { /* 读不了 */ }
  }
  for (const k of r.list) {
    if (k.var) {
      if (!new RegExp(`var\\(\\s*${escRe(k.var)}\\b`).test(all)) out.push(`「${k.label}」拖了不会有变化：没有样式用到 var(${k.var})`)
      else if (!new RegExp(`${escRe(k.var)}\\s*:`).test(all)) out.push(`「${k.label}」的 ${k.var} 在样式里没有默认值（写在 tokens.css 的 :root 里，写回文件时才找得到地方写）`)
      if (k.kind === 'choice') {
        const miss = k.options.filter((o) => !all.includes(o.value))
        if (miss.length === k.options.length) out.push(`「${k.label}」的选项值在样式里一个都没出现，${k.var} 换成这些值多半不起作用`)
      }
    } else {
      if (!new RegExp(`\\[\\s*${escRe(k.attr)}\\b`, 'i').test(all)) { out.push(`「${k.label}」拖了不会有变化：没有样式按 ${k.attr} 区分（写成 [${k.attr}="${k.options[1].value}"] .xxx { … }）`); continue }
      const used = k.options.filter((o) => new RegExp(`\\[\\s*${escRe(k.attr)}\\s*[~|^$*]?=\\s*["']?${escRe(o.value)}["'\\]\\s]`, 'i').test(all))
      const others = k.options.filter((o) => o.value !== k.value)
      if (!others.some((o) => used.includes(o))) out.push(`「${k.label}」除了现在这个，别的选项（${others.map((o) => o.label).join('、')}）在样式里都没有对应的 [${k.attr}="…"] 规则`)
    }
  }
  return out
}
