/**
 * 一页多状态（#30）：还是一屏一个 HTML 文件，同一个页面的几种样子（空列表 / 有数据 / 已付款）写在同一个文件里——
 *
 *   <meta name="dsh-states" content="default:有数据, empty:空列表, paid:已付款">   这屏有哪几个状态，第一个是默认
 *   <html data-state="default">                                                  文件里写着默认状态
 *   [data-state="empty"] .list { display: none }                                 差别全用 CSS
 *   <a href="order.html?state=paid">                                             跳到某个状态
 *
 * 预览服务器打开 ?state=paid、页面写了这个状态时，在页面开画前把 <html data-state> 设好（serve.js 的 stateScript）。
 * 服务端（体检、转代码、整套演示）用这里的；client.js 里有一份一样的 parseStates（浏览器里跑，test-client 比着）。
 */
import fs from 'node:fs'

/** 状态名只认这种写法（英文、数字、- _）：要放进地址、CSS 属性选择器，转代码时当枚举名 */
export const STATE_RE = /^[A-Za-z0-9_-]{1,32}$/
export const MAX_STATES = 8

/** meta 内容 → [{ name, label }]（第一个是默认；名字后面可以跟「:中文名」）；不到两个当没写 */
export function parseStates(raw) {
  const out = []
  for (const part of String(raw || '').split(/[,，;；\n]+/)) {
    const m = /^\s*([A-Za-z0-9_-]{1,32})\s*(?:[:：=]\s*(.*?))?\s*$/.exec(part)
    if (!m || out.some((x) => x.name === m[1])) continue
    out.push({ name: m[1], label: String(m[2] || '').trim().slice(0, 24) || m[1] })
    if (out.length >= MAX_STATES) break
  }
  return out.length >= 2 ? out : []
}

/** HTML（开头那段就够）里写的状态（注释里的示例不算：浏览器里它不是 <meta>） */
/** 这页的状态跟着模拟数据走（<meta name="dsh-states" … data-mock="…">）：不点名就是数据里那个，点名第一个不能省 */
export function followsMock(html) {
  const s = String(html || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const re = /<meta\b[^>]*>/gi
  let m
  while ((m = re.exec(s))) if (/\bname\s*=\s*["']?dsh-states["'\s/>]/i.test(m[0])) return /\sdata-mock\s*=/i.test(m[0])
  return false
}

export function statesOfHtml(html) {
  const s = String(html || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const re = /<meta\b[^>]*>/gi
  let m
  while ((m = re.exec(s))) {
    if (!/\bname\s*=\s*["']?dsh-states["'\s/>]/i.test(m[0])) continue
    const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0])
    return parseStates(c ? c[1] ?? c[2] : '')
  }
  return []
}

const HEAD_MAX = 512 * 1024 // 读到 </head> 为止，最多这么多（<head> 里塞了一大段内联 CSS 的，meta 可能在很后面）

/** 文件里写的状态（meta 在 <head> 里：一块一块读，读到 </head> 就停；没写 </head> 的读到上限） */
export function statesOfFile(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const parts = []
    let total = 0
    const buf = Buffer.alloc(65536)
    while (total < HEAD_MAX) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, HEAD_MAX - total), total)
      if (!n) break
      parts.push(Buffer.from(buf.subarray(0, n)))
      total += n
      // 带上前一块的尾巴一起看，免得 </head> 正好被切在两块中间
      if (/<\/head\s*>/i.test(Buffer.concat(parts.slice(-2)).toString('latin1'))) break
    }
    return statesOfHtml(Buffer.concat(parts).toString('utf8'))
  } catch {
    return []
  } finally {
    if (fd != null) try { fs.closeSync(fd) } catch { /* 关过了 */ }
  }
}

/** 屏的地址换成某个状态（空 = 去掉 ?state=） */
export function withState(url, state) {
  try {
    const u = new URL(url)
    if (state && STATE_RE.test(state)) u.searchParams.set('state', state)
    else u.searchParams.delete('state')
    return u.href
  } catch {
    return url
  }
}

/**
 * 要量的屏展开成「每屏 × 每个状态」：写了状态的屏，原来那一行就是默认状态（标上状态名），后面紧跟着其余状态各一行
 * （key 是 order.html?state=paid，体检、截图、复查按它分开记）。
 * perScreen：每屏最多量几个状态；extra：总共最多多量几行（屏多、状态多时别量太久）
 * only(sc)：这屏只量哪几个状态（Set，模型写了 order.html?state=paid）；null = 全部。点名的状态不受 perScreen / extra 限制
 * @returns { list, skipped 没量的状态数 }
 */
export function expandStates(list, statesOf, { perScreen = 6, extra = 12, only = null } = {}) {
  const out = []
  let added = 0
  let skipped = 0
  // 默认那行 key 不变；地址也写明第一个状态（状态跟着模拟数据走的屏，不写就是数据里那个状态，会和后面某行重复）
  const row = (sc, x, first) => first
    ? { ...sc, url: withState(sc.url, x.name), base: sc.key, state: x.name, stateLabel: x.label }
    : { ...sc, key: `${sc.key}?state=${x.name}`, url: withState(sc.url, x.name), base: sc.key, state: x.name, stateLabel: x.label }
  for (const sc of list) {
    const st = statesOf(sc) || []
    if (st.length < 2) { out.push(sc); continue }
    const want = only ? only(sc) : null
    const named = want ? st.filter((x) => want.has(x.name)) : []
    if (named.length) { for (const x of named) out.push(row(sc, x, x === st[0])); continue }
    out.push(row(sc, st[0], true))
    const rest = st.slice(1, perScreen)
    skipped += st.length - 1 - rest.length
    for (const x of rest) {
      if (added >= extra) { skipped++; continue }
      out.push(row(sc, x, false))
      added++
    }
  }
  return { list: out, skipped }
}

/**
 * 工具的 screens 参数里可以写 order.html?state=paid（只量 / 只截这个状态）：拆成屏名 + 每屏点了哪几个状态。
 * pick(names) 是按屏名找屏的（look.js 的 pickScreens 绑好 snap）；同一屏也写了不带状态的 → 全部状态
 */
export function splitStateNames(names, pick) {
  if (!Array.isArray(names)) return { names, only: null }
  const bases = []
  const want = new Map() // 屏 key → Set(状态)；null = 全部
  for (const n of names.slice(0, 40)) {
    let m = /^(.+?)\?state=([A-Za-z0-9_-]{1,32})$/.exec(String(n ?? '').trim())
    // 开发服务器的路由本来就带 ?state=（/stores?state=CA 是单独一屏）：整个找到的屏和拆掉状态找到的不是同一屏 → 当屏名，不拆
    if (m) { const whole = pick(n); const base = whole ? pick(m[1]) : null; if (whole && (!base || base.key !== whole.key)) m = null }
    bases.push(m ? m[1] : n)
    const hit = pick(m ? m[1] : n)
    if (!hit) continue
    if (!m) want.set(hit.key, null)
    else if (want.get(hit.key) !== null) want.set(hit.key, (want.get(hit.key) || new Set()).add(m[2]))
  }
  return { names: bases, only: want.size ? (sc) => want.get(sc.key) || null : null }
}

/** 体检、转代码里怎么称呼某屏的某个状态：order.html（状态 paid「已付款」） */
export function stateName(base, state, label) {
  if (!state) return base
  return `${base}（状态 ${state}${label && label !== state ? `「${label}」` : ''}）`
}
