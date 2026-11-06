/**
 * 内容仓库的机器人用：一套设计断网开出来，跑体检（同 check_design）、每屏截一张图。
 *
 *   - 用设计台自己的预览服务器（只听 127.0.0.1），每个 HTML 都按「别人做的」加严格规矩（CSP + nonce）
 *   - 浏览器断网：除了这台预览服务器，什么都不让拿
 *   - 体检结果分两档：hard（CI 里算失败）和 soft（标出来给人看）。
 *     CI 的字体和用户电脑不一样，截断 / 溢出 / 叠字这类先算 soft；被系统栏压住、图片坏了、跳转到不存在的页算 hard
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHub } from '../serve.js'
import { createBrowser } from '../browser.js'
import { measureAll, shootAll, prepare, KIND_SIZE } from '../look.js'
import { decodePng, findQrLike } from './qrfind.js'

const IMG_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i
// 扫描预算：每屏最多几段、一共最多几段、最多几张图。超了的不算「查过」：记进 skipped，机器人标出来转人工
export const QR_BUDGET = { parts: 60, total: 300, images: 40 }

/** 设计目录里的图片（相对路径；软链接不跟）→ { list, more }（more：超过预算没列进来的） */
function imagesIn(dir, cap) {
  const out = []
  let more = false
  const walk = (abs, rel, depth) => {
    let ents = []
    try { ents = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const d of ents) {
      if (d.name.startsWith('.')) continue
      const r = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) { if (depth < 6) walk(path.join(abs, d.name), r, depth + 1); else more = true } else if (d.isFile() && IMG_EXT.test(d.name)) { if (out.length < cap) out.push(r); else more = true }
    }
  }
  walk(dir, '', 0)
  return { list: out, more }
}

/**
 * 找二维码用的截图（无损 PNG、1 倍）：每屏从上到下每半屏截一张（长页面中段也截），再加每张图片单独开一次
 * → { shots: [{ file, png }], skipped: [{ file, why }] }（why：long 页面太长没截完 / budget 总段数用完 / images 图太多 / open 开不出来）
 */
async function qrShots(b, { list, origin, dir, size, budget = QR_BUDGET }) {
  const out = []
  const skipped = []
  let left = budget.total
  const [w, h] = size
  for (const sc of list) {
    if (left <= 0) { skipped.push({ file: sc.key, why: 'budget' }); continue }
    try {
      await b.withPage({ url: sc.url, w, h, scale: 1 }, async (page) => {
        await prepare(page, false)
        const s0 = await page.eval('window.__dshDesign.scroll(0)')
        const of = Math.max(1, Number(s0 && s0.of) || 1)
        // 每次只往下滚半屏：相邻两张重叠一半，正好卡在接缝上的二维码在另一张里是整的
        const at = []
        for (let k = 0; k <= 2 * (of - 1); k++) at.push(k / 2)
        const n = Math.min(at.length, budget.parts, left)
        if (n < at.length) skipped.push({ file: sc.key, why: at.length > budget.parts ? 'long' : 'budget' })
        for (let i = 0; i < n; i++) {
          if (i) await page.eval(`window.__dshDesign.scroll(${at[i]})`)
          out.push({ file: sc.key, png: await page.shot({ format: 'png' }) })
          left--
        }
      })
    } catch { skipped.push({ file: sc.key, why: 'open' }) /* 这一屏开不出来：上面的体检也会报 */ }
  }
  const imgs = imagesIn(dir, budget.images)
  if (imgs.more) skipped.push({ file: '', why: 'images' })
  for (const img of imgs.list) {
    try {
      await b.withPage({ url: `${origin}/${img.split('/').map(encodeURIComponent).join('/')}`, w: 1000, h: 1000, scale: 1 }, async (page) => {
        out.push({ file: img, png: await page.shot({ format: 'png' }) })
      })
    } catch { skipped.push({ file: img, why: 'open' }) /* 打不开的图：体检里「图片坏了」会报 */ }
  }
  return { shots: out, skipped }
}

export const HARD = new Set(['covered', 'capsule', 'island', 'winctl', 'homebar', 'img', 'deadlink'])

/**
 * @param dir     设计目录（已经检查过、规范化过）
 * @param screens 屏的文件名，按顺序
 * @param thumb   给第一屏另截一张多宽的小图（webp，卡片封面用）；0 不截
 * @param qr      找二维码：true 只给 qrLike（像二维码的文件）；'shots' 另外把用来找的 PNG 截图也给出来（机器人拿去用 jsQR 真扫）
 * @param qrBudget 扫描预算（默认 QR_BUDGET）；超了的进 qrSkipped
 * @param qrPages  不算屏、但也要扫二维码的页面（相对路径）
 * @returns { rows, shots: [{ file, jpg }], thumb: webp | null, hard: [{ file, type, text }], soft: [...], errors: [{ file, error }], qrLike: [{ file }], qrSkipped: [{ file, why }], qrShots: [{ file, png }] }
 */
export async function renderPack(dir, { screens, kind = 'web', dark = false, shots = true, thumb = 0, browser = null, bin, qr = false, qrBudget = QR_BUDGET, qrPages = [] } = {}) {
  const hub = createHub({ strict: { html: () => true, root: () => true } })
  const own = !browser
  const b = browser || createBrowser(bin ? { bin } : {})
  if (!b.available()) throw new Error('没找到 Chrome / Chromium（设 CHROME_PATH）')
  const offline = { ...b, withPage: (o, fn) => b.withPage({ ...o, offline: true }, fn) }
  try {
    const { origin } = await hub.open({ kind: 'file', root: dir })
    const list = screens.map((f) => ({ key: f, label: f, url: `${origin}/${f.split('/').map(encodeURIComponent).join('/')}` }))
    const size = KIND_SIZE[kind] || KIND_SIZE.web
    const rows = await measureAll(offline, { screens: list, sizes: [size], kind, dark })
    const hard = []
    const soft = []
    const errors = []
    for (const r of rows) {
      if (r.error) { errors.push({ file: r.key, error: r.error }); continue }
      for (const it of r.issues) (HARD.has(it.type) ? hard : soft).push({ file: r.key, type: it.type, text: String(it.text || it.src || it.sel || '').slice(0, 60) })
    }
    const pics = shots
      ? (await shootAll(offline, { screens: list, size, at: 'top', dark, kind, max: list.length })).map((s) => ({ file: s.key, jpg: s.jpg || null, error: s.error || '' }))
      : []
    for (const s of pics) if (s.error) errors.push({ file: s.file, error: s.error })
    let cover = null
    if (thumb > 0 && list.length) {
      const [w, h] = size
      try {
        await offline.withPage({ url: list[0].url, w, h, scale: thumb / w, dark }, async (page) => {
          await prepare(page, dark)
          if (kind === 'miniprogram') await page.eval("window.__dshDesign.capsule('solid')").catch(() => null)
          if (kind === 'desktop') await page.eval("window.__dshDesign.winctl('solid')").catch(() => null)
          cover = await page.shot({ format: 'webp', quality: 72 })
        })
      } catch (e) {
        errors.push({ file: list[0].key, error: String((e && e.message) || e).slice(0, 160) })
      }
    }
    const qrLike = []
    let qrPngs = []
    let qrSkipped = []
    if (qr) {
      // 不算屏的页面（_ 开头的、设计系统子目录里的）也扫：能从链接点进去
      const more = (qrPages || []).filter((f) => !screens.includes(f)).map((f) => ({ key: f, label: f, url: `${origin}/${f.split('/').map(encodeURIComponent).join('/')}` }))
      const q0 = await qrShots(offline, { list: [...list, ...more], origin, dir, size, budget: qrBudget })
      qrPngs = q0.shots
      qrSkipped = q0.skipped
      for (const q of qrPngs) {
        if (qrLike.some((x) => x.file === q.file)) continue
        const hit = findQrLike(decodePng(q.png))
        if (hit) qrLike.push({ file: q.file, at: hit.at })
      }
    }
    return { rows, shots: pics, thumb: cover, hard, soft, errors, size, qrLike, qrSkipped, qrShots: qr === 'shots' ? qrPngs : [] }
  } finally {
    hub.closeAll()
    if (own) b.destroy()
  }
}
