/**
 * 业务标注（试验，插件页一行开关，默认关）：模型随设计写一份 annotations.json，记界面上看不出来的规则、状态、边界、口径。
 * 右侧栏列卡片、页面上出编号、两边互相定位，转成代码时写进交接说明。
 *
 * annotations.json 放在设计目录里、和 tweaks.json 并排（也可以直接是数组）：
 *   { "annotations": [
 *       { "id": "room-03", "page": "room.html", "type": "rule", "title": "价格含双人早餐",
 *         "detail": "底栏价格是含早价", "selector": ".ab-price", "anchorLabel": "底栏价格",
 *         "fallbackText": "含双人早餐", "source": "PRD 2.6", "tags": ["价格"], "related": ["booking-02"], "status": "open" }
 *   ] }
 *
 * 文件是模型写的，一律当数据：选择器只进 querySelector（包 try），文字只走 React 文字节点和 textContent。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { allScreens } from './core.js'

export const ANNOTATIONS_FILE = 'annotations.json'
export const MAX_ANNOTATIONS = 200
const MAX_FILE = 512 * 1024

// 单个字段的长度上限（超了这条报出来、不显示，别的照常）
const LIMITS = { id: 64, page: 200, type: 24, title: 200, detail: 4000, selector: 500, anchorLabel: 120, fallbackText: 200, source: 300, status: 24 }
const MAX_ITEMS = 20 // tags、related 各最多几个
const MAX_ITEM = 64 // tags、related 每个多长
const MAX_ERRORS = 30 // 写坏的最多列几条（一份 512 KB 的文件能写出几十万条错）

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** 字段 → 去掉首尾空白的字符串（数字也认）；没写是 ''；类型不对或太长是 null */
function field(x, key) {
  if (!hasOwn(x, key) || x[key] == null) return ''
  const v = x[key]
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  return s.length > LIMITS[key] ? null : s
}

/** tags / related → 字符串数组；没写是 []；类型不对或太多是 null */
function strings(x, key) {
  if (!hasOwn(x, key) || x[key] == null) return []
  const v = x[key]
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null
  const out = []
  for (const it of v) {
    if (typeof it !== 'string' && typeof it !== 'number') return null
    const s = String(it).trim()
    if (s.length > MAX_ITEM) return null
    if (s) out.push(s)
  }
  return out
}

/** page → 设计目录里的相对路径（room.html、sub/room.html）；不像一个 HTML 文件时是 '' */
export function normPage(s) {
  const p = String(s || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  if (!/\.html?$/i.test(p) || /[?#]/.test(p) || p.split('/').some((x) => x === '..' || x === '')) return ''
  return p
}

/**
 * annotations.json 的内容 → { list, errors }。
 * list：[{ id, n, page, type, title, detail, selector, anchorLabel, fallbackText, source, tags, related, status }]；n 是这一屏的第几条（编号）
 */
export function parseAnnotations(text) {
  let raw
  try { raw = JSON.parse(String(text || '')) } catch (e) { return { list: [], errors: [`annotations.json 不是合法的 JSON：${String(e.message).slice(0, 80)}`] } }
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.annotations) ? raw.annotations : null
  if (!arr) return { list: [], errors: ['annotations.json 里要有 "annotations": [ … ]'] }
  const list = []
  const errors = []
  const ids = new Set()
  const perPage = new Map()
  let more = 0
  let tooMany = 0
  const fail = (m) => { if (errors.length < MAX_ERRORS) errors.push(m); else more++ }
  for (let i = 0; i < arr.length; i++) (() => {
    const x = arr[i]
    const at = `第 ${i + 1} 条`
    if (!x || typeof x !== 'object' || Array.isArray(x)) { fail(`${at}不是对象`); return }
    const f = {}
    for (const k of Object.keys(LIMITS)) f[k] = field(x, k)
    const name = f.id ? `${at}（${f.id}）` : at
    const bad = Object.keys(LIMITS).filter((k) => f[k] === null)
    if (bad.length) { fail(`${name}的 ${bad.join('、')} 类型不对或太长`); return }
    const tags = strings(x, 'tags')
    const related = strings(x, 'related')
    if (!tags || !related) { fail(`${name}的 ${!tags ? 'tags' : 'related'} 要是字符串数组，最多 ${MAX_ITEMS} 个，每个 ${MAX_ITEM} 字以内`); return }
    if (!f.id) { fail(`${at}缺 id`); return }
    if (!f.title) { fail(`${name}缺 title`); return }
    if (!f.page) { fail(`${name}缺 page（这一屏的文件名，如 room.html）`); return }
    const page = normPage(f.page)
    if (!page) { fail(`${name}的 page 要写这一屏的文件名（如 room.html），现在是「${f.page.slice(0, 40)}」`); return }
    if (ids.has(f.id)) { fail(`${name}的 id 和前面重复了`); return }
    if (list.length >= MAX_ANNOTATIONS) { tooMany++; return }
    ids.add(f.id)
    const n = (perPage.get(page) || 0) + 1
    perPage.set(page, n)
    list.push({ ...f, page, n, status: f.status.toLowerCase(), tags, related })
  })()
  if (tooMany) errors.push(`最多 ${MAX_ANNOTATIONS} 条，后面的 ${tooMany} 条没显示`)
  if (more) errors.push(`还有 ${more} 处写坏了，没列出来`)
  return { list, errors }
}

const cache = new Map()

/** 读设计目录里的 annotations.json（改了才重新解析）→ { list, errors, mtime, sig }；没有这个文件是 null */
export function readAnnotations(root) {
  if (!root) return null
  const file = path.join(root, ANNOTATIONS_FILE)
  let st
  try { st = fs.lstatSync(file) } catch { cache.delete(file); return null }
  // 只认设计目录里的普通文件：软链接（可能指到目录外）当没有
  if (!st.isFile()) return null
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.r
  let r
  let failed = false
  try {
    r = st.size > MAX_FILE ? { list: [], errors: ['annotations.json 太大了（最多 512 KB）'] } : parseAnnotations(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    r = { list: [], errors: [`annotations.json 读不了：${String(e.message).slice(0, 80)}`] }
    failed = true // 权限这类问题可能马上好：下一轮重读，不记缓存
  }
  // 签名带上目录：换了一套设计，哪怕文件大小和修改时间碰巧一样，也不能当成同一份
  const dirId = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10)
  r = { ...r, mtime: st.mtimeMs, sig: `${dirId}-${st.mtimeMs}-${st.size}` }
  if (failed) r = { ...r, sig: `err-${r.sig}` }
  else cache.set(file, { mtime: st.mtimeMs, size: st.size, r })
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  return r
}

/**
 * 只看文件：写坏的、指到不存在的屏的。
 * @returns [文字]（check_design 的结果里列出来）
 */
export function lintAnnotations(root) {
  const r = readAnnotations(root)
  if (!r) return []
  const out = [...r.errors]
  if (!r.list.length) return out
  const screens = new Set(allScreens(root))
  for (const a of r.list) if (!screens.has(a.page)) out.push(`${a.id}：page 写的 ${a.page} 不是这套设计里的屏`)
  return out
}

/** 无头浏览器核对的结果 → [文字]。found：[{ page, list: [{ id, how, count }] }]；how：selector / text / page / '' */
export function annotationFindings(all, found) {
  const byId = new Map(all.map((a) => [a.id, a]))
  const out = []
  for (const { page, list } of found) {
    for (const f of list || []) {
      const a = byId.get(f.id)
      if (!a) continue
      if (!f.how) out.push(`${page}：${a.id}「${a.title}」定位不到（${a.selector ? `选择器 ${a.selector}` : ''}${a.selector && a.fallbackText ? ' 和' : ''}${a.fallbackText ? `文字「${a.fallbackText}」` : ''}都没找到）`)
      else if (f.how === 'text' && a.selector) out.push(`${page}：${a.id}「${a.title}」的选择器 ${a.selector} 失效了，现在靠文字找到的，把选择器改对`)
      else if (f.how === 'selector' && f.count > 1) out.push(`${page}：${a.id}「${a.title}」的选择器 ${a.selector} 匹配到 ${f.count} 个，用的第一个，写得再具体一点`)
    }
  }
  return out
}

/** 给 ui-design 技能补的一段（开关开着才加） */
export function annotationSection() {
  return '\n\n## 业务标注（用户打开了这个试验开关）\n\n' +
    '每套新设计都带一份 `annotations.json`（放在设计目录，和 `tokens.css` 并排），不用等用户说。字段、例子、选择器怎么写，看 `references/annotations.md`。\n\n' +
    '- **什么时候写**：一套设计的屏都做完、最后一次 `check_design` 之前写；之后改了设计，同步改它。\n' +
    '- **写什么**：界面上看不出来的规则、状态、边界、数据口径，每屏 3–8 条，不复述页面上的字。\n' +
    '- **有需求文档**：用户给了 PRD 或需求文件就先读，照它写，`source` 记出处。没给就不编出处，`source` 留空；拿不准的 `status` 写 `open`。\n' +
    '- **选择器**：用自己写的语义类名或 id；`fallbackText` 写这个元素上看得见的字。\n' +
    '- **不为标注多跑体检**：`check_design` 末尾报了定位不到的，顺手修。\n' +
    '- **用户说「room-03 改成…」**：直接改这个文件里 `id` 对得上的那条。\n'
}

const TYPE_NAME = { rule: '业务规则', state: '状态边界', logic: '逻辑', flow: '流程', metric: '口径', data: '口径' }

function ruleLine(a) {
  const where = [a.anchorLabel, a.selector ? `\`${a.selector}\`` : '', a.fallbackText && !a.selector ? `「${a.fallbackText}」` : ''].filter(Boolean).join(' ')
  const bits = [TYPE_NAME[a.type] || a.type, where, a.source ? `出处：${a.source}` : ''].filter(Boolean).join('；')
  const body = a.detail ? `：${a.detail.replace(/\s*\n\s*/g, ' ')}` : ''
  return `- **${a.id} ${a.title}**${bits ? `（${bits}）` : ''}${body}`
}

/**
 * 交接说明里「业务规则」那一节；没有标注（或开关关着，r 是 null）时是 []。
 * pages：这次交接的屏（Set），只带这几屏的规则；不传是全部。
 * known：这套设计所有的屏（Set）：page 写错、对不上任何一屏的，单独列出来，别悄悄没了
 */
export function annotationsMd(r, pages = null, known = null) {
  if (!r) return []
  const list = pages ? r.list.filter((a) => pages.has(a.page)) : r.list
  const stray = known ? r.list.filter((a) => !known.has(a.page) && !(pages && pages.has(a.page))) : []
  const errors = r.errors || []
  if (!list.length && !errors.length && !stray.length) return []
  const open = list.filter((a) => a.status === 'open')
  const guessed = list.filter((a) => a.status !== 'open' && !a.source)
  const sure = list.filter((a) => a.status !== 'open' && a.source)
  const lines = ['## 业务规则', '']
  if (errors.length) lines.push(`> annotations.json 有 ${errors.length} 处写坏了，这些规则下面没有，别当成已经交接完：`, ...errors.slice(0, 20).map((e) => `> - ${String(e).replace(/\s*\n\s*/g, ' ')}`), ...(errors.length > 20 ? [`> - 还有 ${errors.length - 20} 处`] : []), '')
  if (list.length) lines.push(`来自设计目录的 annotations.json，共 ${list.length} 条。写代码时照着实现；选择器指的是设计稿里的元素。`, '')
  const byPage = (list) => {
    const keys = [...new Set(list.map((a) => a.page))]
    return keys.flatMap((p) => [`**${p}**`, '', ...list.filter((a) => a.page === p).map(ruleLine), ''])
  }
  if (sure.length) lines.push(...byPage(sure))
  if (guessed.length) lines.push('### 模型推断（没有出处，开发前和产品核对）', '', ...byPage(guessed))
  if (open.length) lines.push('### 待确认（别当成定论）', '', ...byPage(open))
  if (stray.length) lines.push('### 屏名对不上的（page 写错了，开发前核对）', '', ...byPage(stray))
  return lines
}
