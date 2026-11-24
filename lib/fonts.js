/**
 * 字体库（issue #31）：免费可商用（SIL OFL 1.1）的网页字体。面板里点选、模型调 use_fonts，字体文件复制进设计目录的 dsh-fonts/
 * （设计台专用的文件夹：不和设计自己放字体的 fonts/ 撞名），变量所在的样式里加一段设计台管的 @font-face。
 *
 * - 目录 fonts-index.json 随插件发（名字、分类、sha256），预览 fonts-preview.json 是名字画成的 SVG 路径（图形，不是字体）。
 * - 字体在 npm 包 dsh-design-fonts 里，第一次用到才下载；每个文件按目录里钉死的 sha256 核对。「设计库不联网」开着就不下载。
 * - @font-face 那段只认明确选过的（面板「存下」、use_fonts）：开头标记里记着 id。旧设计的字体栈里本来就写着 "Noto Serif SC"
 *   这类当系统字体的后备，不能因为名字对上就去下载、复制、改样子。
 * - 那段里的只在「这次操作把它换走了、整套设计里一处都不再写它的名字」时去掉（drop）；别的时候只加不减。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FONTS_CACHE = process.env.DSH_DESIGN_FONTS_CACHE || path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'fonts')
export const FONT_DIR = 'dsh-fonts'
export const MAX_FONTS = 4 // use_fonts 一次最多几款
const INDEX_FILE = fileURLToPath(new URL('./fonts-index.json', import.meta.url))
const PREVIEW_FILE = fileURLToPath(new URL('./fonts-preview.json', import.meta.url))
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CAP = 30 * 1024 * 1024
const LIMITS = { files: 100, file: 6 * 1024 * 1024, total: 40 * 1024 * 1024 }
const RETRY_MS = 60e3
const TIMING = { stagger: 8000, each: 60000, total: 120000 }
const CATS = new Set(['sans', 'serif', 'display', 'hand', 'mono'])

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
// 版本号比大小（和 gallery/market.js 的 vcmp 一样；这里不引它，版本记录也要用这个文件，免得绕成环）
const vcmp = (a, b) => {
  const pa = String(a || '0').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  return 0
}

/** 每类后面跟的系统字体：字体库只裁了常用字，不在里面的字、没下载到时由它们顶上（Mac / Windows 成对写） */
export const FALLBACK = {
  sans: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Songti SC", "SimSun", serif',
  display: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  hand: '"Kaiti SC", "KaiTi", serif',
  mono: 'Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
}

/** 读目录；格式不对的条目不要 */
export function loadFontIndex(file = INDEX_FILE) {
  let raw
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  if (!raw || raw.format !== 1 || typeof raw.package !== 'string' || typeof raw.version !== 'string' || !Array.isArray(raw.fonts)) return null
  const fonts = raw.fonts.filter((f) => f && ID_RE.test(String(f.id)) && /^[0-9a-f]{64}$/.test(String(f.sha256)) && f.size > 0 && CATS.has(f.cat) &&
    typeof f.family === 'string' && /^[A-Za-z0-9 ]{1,40}$/.test(f.family) && f.file === `fonts/${f.id}.woff2`)
  return { ...raw, fonts }
}

/** 预览：{ id: { w, h, d } }（d 是 SVG 路径，字体单位、y 向下） */
export function loadFontPreviews(file = PREVIEW_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}

export const stackOf = (f) => `"${f.family}", ${FALLBACK[f.cat] || FALLBACK.sans}`

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/["'\s_-]+/g, '')

/** 字体栈里的第一个名字（去引号） */
export function firstFamily(stack) {
  const m = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]*))/.exec(String(stack || ''))
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : ''
}

/** 字体栈打头的是不是字体库里的（是就给那款） */
export function libFontOf(index, stack) {
  if (!index) return null
  const fam = firstFamily(stack).toLowerCase()
  return (fam && index.fonts.find((f) => f.family.toLowerCase() === fam)) || null
}

/** 按名字找：id、CSS 名、中文名、英文名都认（大小写、空格、引号不计） */
export function findFont(index, name) {
  const n = norm(name)
  if (!index || !n) return null
  return index.fonts.find((f) => [f.id, f.family, f.zh, f.en].some((x) => norm(x) === n)) || null
}

// ── 设计台管的 @font-face 那段 ──────────────────────────────────────────────
// /* dsh-fonts: noto-serif-sc inter | 设计台字体库 …（这段由设计台管，别手改）*/ … /* /dsh-fonts */

const BLOCK_RE = /\/\*\s*dsh-fonts:([^*]*?)\|[^*]*\*\/[\s\S]*?\/\*\s*\/dsh-fonts\s*\*\/[ \t]*(?:\r?\n)?/g
const BLOCK_HEAD_RE = /\/\*\s*dsh-fonts:([^*|]*)\|/

/** 文件里那段记着的 id（没有那段给 []） */
export function fontBlockIds(text) {
  const m = BLOCK_HEAD_RE.exec(String(text || ''))
  return m ? [...new Set(m[1].trim().split(/\s+/).filter((x) => ID_RE.test(x)))] : []
}

/** 去掉那段（分享包、版本比较用） */
export const stripFontBlock = (text) => String(text).replace(BLOCK_RE, '')

/** 那段的文字：prefix 是这个文件到 fonts/ 的相对路径（「fonts」「../fonts」），nl 用文件自己的换行 */
export function fontBlock(fonts, prefix = FONT_DIR, nl = '\n') {
  if (!fonts.length) return ''
  const lines = [`/* dsh-fonts: ${fonts.map((f) => f.id).join(' ')} | 设计台字体库（SIL OFL 1.1，免费可商用），文件在 ${FONT_DIR}/。这段由设计台管，别手改 */`]
  for (const f of fonts) {
    // 只有一个字重的也写成 100 900：标题要 700、800 时浏览器就不会自己把它描粗（毛笔字、站酷那几款描粗了很难看）
    const w = Array.isArray(f.weights) && f.weights.length === 2 ? `${f.weights[0]} ${f.weights[1]}` : '100 900'
    lines.push(`@font-face { font-family: "${f.family}"; src: url("${prefix}/${f.id}.woff2") format("woff2"); font-weight: ${w}; font-display: swap; }`)
  }
  lines.push('/* /dsh-fonts */')
  return lines.join(nl) + nl
}

/**
 * CSS 文字里放那段的位置：开头的 BOM、注释、@charset、@layer 声明（不带大括号的）、@import 之后（@import 必须在最前面），接在那一行后面。
 * @import 的网址可能不带引号、里面有 ;（Google Fonts css2 的 wght@400;700），url(…) 整个跳过
 */
function cssInsertAt(css) {
  const re = /\s*(?:\/\*[\s\S]*?\*\/|@charset\b[^;]*;|@layer\b[^;{}]*;|@import\b(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)"']*)\s*\)|"[^"]*"|'[^']*'|(?!url\()[^;'"])*;)/y
  const bom = css.charCodeAt(0) === 0xfeff ? 1 : 0
  let at = bom
  for (;;) {
    re.lastIndex = at
    if (!re.exec(css)) break
    at = re.lastIndex
  }
  if (at === bom) return bom
  const nlAt = css.indexOf('\n', at)
  return nlAt === -1 || css.slice(at, nlAt).trim() ? at : nlAt + 1
}

const blank = (m) => m.replace(/[^\n]/g, ' ')
const STYLE_TAG = /<style\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi // 属性值里的 > 不算结束（media="(width >= 900px)"）
const WRAP_ATTR = 'data-dsh-fonts' // 设计台自己加的那个 <style>（页面里没有对整个屏幕生效的 <style> 时）

/** HTML 里所有真的 <style> 开头标签（注释、脚本里的不算）：[{ index, tag, screen: 对屏幕整个生效（没写 media、all、screen） }] */
function styleTags(html) {
  // <noscript> 里的是关了脚本才用的备用样式，不算
  const masked = html.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank)
  const out = []
  STYLE_TAG.lastIndex = 0
  for (let m; (m = STYLE_TAG.exec(masked));) {
    const media = /\smedia\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0])
    const v = media ? (media[1] ?? media[2] ?? media[3]).trim().toLowerCase() : ''
    out.push({ index: m.index, tag: m[0], screen: !v || v === 'all' || v === 'screen' })
  }
  return out
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const famRes = new Map()
/** 文字里写没写这个字体名：带引号的，或者不带引号、前后是字体栈的分隔（var(--x, Inter)、style="font-family: Inter" 都算；Inter 不算 pointer、interface 里的） */
export function namesFamily(text, family) {
  let re = famRes.get(family)
  if (!re) {
    const words = family.trim().split(/\s+/).map(escRe).join('\\s+')
    re = new RegExp(`["']\\s*${words}\\s*["']|(?:^|[\\s,:(])${words}(?=\\s*(?:[,;!})"']|$))`, 'im')
    famRes.set(family, re)
  }
  return re.test(String(text || ''))
}

/** 文字里（那段以外、注释以外）写着名字的字体库 id */
export function libIdsNamed(text, index) {
  const rest = stripFontBlock(String(text || '')).replace(/\/\*[\s\S]*?\*\//g, ' ')
  return index ? index.fonts.filter((f) => namesFamily(rest, f.family)).map((f) => f.id) : []
}

/**
 * 那段改成：原来记着的 + add，再去掉 drop 里（这次被换走、整套设计都不再写它名字的）且这个文件里也不写它名字的。没变给 null
 * isHtml：放进第一个对屏幕整个生效的 <style>；只有按尺寸 / 打印的 <style> 时在前面加一个设计台自己的；一个 <style> 都没有给 null（不自己加：只许外链样式的页面会悄悄拦掉）
 */
export function syncFontBlock(text, add, index, { prefix = FONT_DIR, isHtml = false, drop = [] } = {}) {
  const src = String(text)
  const cur = fontBlockIds(src)
  const all = [...new Set([...cur, ...add])]
  const named = new Set(drop.length ? libIdsNamed(src, index) : [])
  const want = all.filter((id) => add.includes(id) || !drop.includes(id) || named.has(id))
  const fonts = want.map((id) => index.fonts.find((f) => f.id === id)).filter(Boolean)
  const nl = /\r\n/.test(src) ? '\r\n' : '\n'
  const block = fontBlock(fonts, prefix, nl)
  const had = BLOCK_RE.test(src)
  BLOCK_RE.lastIndex = 0
  let body = src.replace(BLOCK_RE, '')
  // 设计台自己加的 <style> 空了就拿掉
  if (isHtml) body = body.replace(new RegExp(`<style\\b[^>]*\\b${WRAP_ATTR}\\b[^>]*>\\s*</style\\s*>(?:\\r?\\n)?`, 'gi'), '')
  let out
  if (!block) out = body
  else if (!isHtml) {
    const at = cssInsertAt(body)
    out = body.slice(0, at) + (at > 0 && !/[\n\ufeff]/.test(body[at - 1]) ? nl : '') + block + body.slice(at)
  } else {
    // @font-face 放在哪个 <style> 都对整页生效——前提是那个 <style> 对屏幕整个生效（media 限了尺寸、打印的，字体也跟着只在那时有）
    const tags = styleTags(body)
    const m = tags.find((x) => x.screen)
    if (m) {
      // <style> 里开头的 @import、@charset 要留在最前面（放到它们前面 @import 就不算了）
      const start = m.index + m.tag.length
      const close = body.slice(start).search(/<\/style\s*>/i)
      const ins = cssInsertAt(body.slice(start, close < 0 ? body.length : start + close))
      if (!ins) out = body.slice(0, start) + nl + block + body.slice(start).replace(/^\r?\n/, '')
      else {
        const at = start + ins
        out = body.slice(0, at) + (body[at - 1] !== '\n' ? nl : '') + block + body.slice(at)
      }
    } else if (tags.length) {
      // 只有按尺寸 / 打印的 <style>：在第一个前面自己加一个（带上页面 <style> 的 nonce，严格 CSP 也认）
      const nonce = tags.map((x) => /\snonce\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(x.tag)).find(Boolean)
      const attr = nonce ? ` nonce="${String(nonce[1] ?? nonce[2] ?? nonce[3]).replace(/["<>&]/g, '')}"` : ''
      const at = tags[0].index
      out = body.slice(0, at) + `<style ${WRAP_ATTR}${attr}>` + nl + block + '</style>' + nl + body.slice(at)
    } else return null // 没有 <style>：不自己加（页面可能只许外链样式，加了会被悄悄拦掉）
  }
  if (out === src || (!had && !block)) return null
  return out
}

/** 设计目录里的文件 rel 到 fonts/ 的相对路径 */
export const fontPrefix = (rel) => {
  const d = path.posix.dirname(String(rel).replace(/\\/g, '/'))
  return d === '.' ? FONT_DIR : path.posix.relative(d, FONT_DIR)
}

/** dsh-fonts/<id>.woff2 是字体库复制进来的就给 id，不是给 ''（版本记录不存它们：从库里随时能再拿） */
export function libFontIdOf(rel, index = defaultIndex()) {
  const m = /^dsh-fonts\/([a-z0-9-]+)\.woff2$/.exec(String(rel).replace(/\\/g, '/'))
  return m && index && index.fonts.some((f) => f.id === m[1]) ? m[1] : ''
}
export const isLibFontRel = (rel, index) => !!libFontIdOf(rel, index)

let cachedIndex
function defaultIndex() {
  if (cachedIndex === undefined) cachedIndex = loadFontIndex()
  return cachedIndex
}

// ── 下载、复制 ───────────────────────────────────────────────────────────────

export function createFonts({ market, index = loadFontIndex(), cacheDir = FONTS_CACHE, log = () => {}, now = Date.now } = {}) {
  let inflight = null
  let failedAt = -Infinity
  let lastErr = null
  const dirOf = () => path.join(cacheDir, index.version)
  const fileOf = (f) => path.join(dirOf(), `${f.id}.woff2`)
  const okFile = (f) => {
    try { return sha256(fs.readFileSync(fileOf(f))) === f.sha256 } catch { return false }
  }
  const has = (f) => { try { return fs.statSync(fileOf(f)).size === f.size } catch { return false } }
  const ready = () => index.fonts.every(has)

  async function download() {
    const files = await market.fetchPackage(index.package, index.version, {
      cap: CAP,
      limits: LIMITS,
      timing: TIMING,
      check: (list) => {
        const by = new Map(list.map((x) => [x.path, x.data]))
        return index.fonts.map((f) => {
          const data = by.get(f.file)
          if (!data || sha256(data) !== f.sha256) { const e = new Error('font mismatch'); e.code = 'mismatch'; throw e }
          return { f, data }
        })
      },
    })
    fs.mkdirSync(dirOf(), { recursive: true })
    for (const { f, data } of files) {
      const tmp = `${fileOf(f)}.${process.pid}.tmp`
      fs.writeFileSync(tmp, data)
      fs.renameSync(tmp, fileOf(f))
    }
    for (const n of fs.readdirSync(cacheDir)) {
      if (/^\d+\.\d+\.\d+/.test(n) && vcmp(n, index.version) < 0) try { fs.rmSync(path.join(cacheDir, n), { recursive: true, force: true }) } catch (e) { log(e) }
    }
  }

  /** 保证字体都在缓存里；失败抛错（err.code：off = 不联网开着） */
  function ensure() {
    if (ready()) return Promise.resolve()
    if (inflight) return inflight
    if (now() - failedAt < RETRY_MS && lastErr) return Promise.reject(lastErr)
    inflight = download().then(
      () => { failedAt = -Infinity; lastErr = null; inflight = null },
      (e) => { inflight = null; log(e); if (e && e.code === 'off') { failedAt = -Infinity; lastErr = null } else { failedAt = now(); lastErr = e } throw e },
    )
    return inflight
  }

  /** 预览服务器用：这个 id 的缓存文件（在、大小对才给） */
  const cached = (id) => {
    const f = index.fonts.find((x) => x.id === id)
    return f && has(f) ? fileOf(f) : null
  }

  /**
   * 把 fonts 复制进 <dir>/dsh-fonts/（同步；真实路径写之前核对）。已经在且内容对的不动，不对的换掉（字体库管这些文件名）。
   * allowed(真实路径) 说这个目录能不能写；fonts 指到外面就不写。
   */
  function place(dir, fonts, allowed = () => true) {
    const denied = () => Object.assign(new Error('outside'), { code: 'link' })
    let probe = path.resolve(dir)
    while (!fs.existsSync(probe)) {
      const up = path.dirname(probe)
      if (up === probe) break
      probe = up
    }
    if (!allowed(fs.realpathSync(probe))) throw denied()
    const sub = path.join(dir, FONT_DIR)
    fs.mkdirSync(sub, { recursive: true })
    const realDir = fs.realpathSync(dir)
    const realSub = fs.realpathSync(sub)
    if (!allowed(realDir) || realSub !== path.join(realDir, FONT_DIR)) throw denied()
    for (const f of fonts) {
      if (!okFile(f)) {
        try { fs.rmSync(fileOf(f), { force: true }) } catch (e) { log(e) }
        throw Object.assign(new Error(`bad cached font ${f.id}`), { code: 'mismatch' })
      }
      const to = path.join(realSub, `${f.id}.woff2`)
      let same = false
      try {
        const st = fs.lstatSync(to)
        if (!st.isFile()) throw denied() // 软链接、文件夹：不往里写
        same = st.size === f.size && sha256(fs.readFileSync(to)) === f.sha256
      } catch (e) {
        if (e && e.code === 'link') throw e
      }
      if (same) continue
      // 临时文件独占新建（同名的东西已经在了——哪怕是软链接——就先删掉它本身再建，不顺着它写出去）
      const tmp = `${to}.${process.pid}.tmp`
      try {
        fs.copyFileSync(fileOf(f), tmp, fs.constants.COPYFILE_EXCL)
      } catch (e) {
        if (!e || e.code !== 'EEXIST') throw e
        fs.rmSync(tmp, { force: true })
        fs.copyFileSync(fileOf(f), tmp, fs.constants.COPYFILE_EXCL)
      }
      fs.renameSync(tmp, to)
    }
  }

  /** 下载 → 复制；缓存里有坏文件时重下一次 */
  async function provide(dir, fonts, allowed) {
    await ensure()
    try { return place(dir, fonts, allowed) } catch (e) { if (!e || e.code !== 'mismatch') throw e }
    await ensure()
    return place(dir, fonts, allowed)
  }

  return { index, ready, ensure, place, provide, cached }
}
