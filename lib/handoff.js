/**
 * 转成代码：把设计目录整理成一份交接包，交给模型做成真项目的代码；做完一屏用 compare_design 和设计稿对一遍。
 *
 *   <设计目录>/handoff/HANDOFF.md        做什么、做到哪、用什么框架；每屏的文件、建议路由、截图、跳到哪；设计变量；
 *                                        几屏共用的部分（该抽成组件的）；交互和状态；滑块；素材；做法和验收
 *   <设计目录>/handoff/shots/<屏>-<n>.jpg 每屏按设计尺寸从上到下的截图（网页再加一张手机宽的）
 *
 * compare_design：设计稿的一屏和做出来的页面（本机地址）按同样尺寸各截一张，在无头浏览器里逐像素比，
 * 回一张「设计稿 | 做出来的 | 差异」拼图、差了多少，和差得最多的几块分别是哪个元素。
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepare } from './look.js'
import { listScreens } from './core.js'
import { readTweaks, shownValue } from './tweaks.js'
import { tokensOf } from './system.js'

export const HANDOFF_DIR = 'handoff'
const MAX_SCREENS = 12
const MAX_PARTS = 3 // 每屏最多截几段

export const FRAMEWORKS = {
  react: { label: 'React + Vite（TypeScript）', create: 'npm create vite@latest {name} -- --template react-ts', router: 'react-router-dom' },
  vue: { label: 'Vue 3 + Vite（TypeScript）', create: 'npm create vite@latest {name} -- --template vue-ts', router: 'vue-router' },
  next: { label: 'Next.js（App Router，TypeScript）', create: 'npx create-next-app@latest {name} --ts --app --use-npm', router: '' },
  html: { label: '纯 HTML / CSS（不用框架）', create: '', router: '' },
}

const FW_DEPS = [['next', 'next', 'Next.js'], ['nuxt', 'vue', 'Nuxt'], ['@sveltejs/kit', 'svelte', 'SvelteKit'], ['svelte', 'svelte', 'Svelte'], ['astro', 'astro', 'Astro'], ['@angular/core', 'angular', 'Angular'], ['solid-js', 'solid', 'Solid'], ['vue', 'vue', 'Vue'], ['react', 'react', 'React']]

/** 目录是不是个前端项目、用的什么：{ dir, pkg, name, framework, label, tailwind, ts, pm } */
export function detectProject(dir) {
  const out = { dir, pkg: false, name: path.basename(dir || ''), framework: '', label: '', tailwind: false, ts: false, pm: 'npm' }
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { return out }
  out.pkg = true
  if (typeof pkg.name === 'string' && pkg.name) out.name = pkg.name
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const hit = FW_DEPS.find(([d]) => deps[d])
  if (hit) { out.framework = hit[1]; out.label = hit[2] + (hit[0] === 'react' && deps.vite ? ' + Vite' : hit[0] === 'vue' && deps.vite ? ' + Vite' : '') }
  out.tailwind = !!deps.tailwindcss
  out.ts = !!deps.typescript || fs.existsSync(path.join(dir, 'tsconfig.json'))
  out.pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock')) ? 'bun' : 'npm'
  return out
}

/** 真实路径：不存在的部分接在最近一级存在的上级目录的真实路径后面（新建的目录也能按真实位置比） */
export function realish(p) {
  let cur = path.resolve(p)
  const rest = []
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest) } catch { /* 还不存在，往上找 */ }
    const up = path.dirname(cur)
    if (up === cur) return path.resolve(p)
    rest.unshift(path.basename(cur))
    cur = up
  }
}

// mac、Windows 的磁盘默认不分大小写
const fold = (p) => (process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p)

/** p 是不是 root 本身或在它里面（按真实路径，软链接、大小写都算上） */
export function within(p, root) {
  const a = fold(realish(p))
  const b = fold(realish(root))
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/**
 * 代码默认放哪：会话目录是个前端项目、又不在设计目录里 → 就放会话目录；
 * 否则新建 <设计名>-app：设计目录在会话目录下就建在会话目录里，不然建在设计目录旁边（别塞进设计目录）
 */
export function defaultDest(root, cwd, project) {
  const inside = !!root && within(cwd, root)
  if (project && project.pkg && !inside) return cwd
  const base = (root ? path.basename(root) : 'app').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app'
  const name = base === 'app' || base.endsWith('-app') ? `${base}-code` : `${base}-app`
  const under = !!root && !inside && within(root, cwd)
  return path.join(root && !under ? path.dirname(root) : cwd, name)
}

/** 文件名 → 建议路由：index / home → /，别的 /名字 */
export function routeOf(key) {
  const b = String(key).replace(/\.html?$/i, '').toLowerCase()
  return b === 'index' || b === 'home' ? '/' : '/' + b.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

const CLASS_TAGS = /^(header|nav|footer|aside|section|div|a|button|ul|ol|li|form|article|main|figure)$/

/** 几屏共用的 class（≥ 2 屏都有，多半该抽成组件）：[{ cls, n, screens }] */
export function sharedParts(htmlByKey) {
  const seen = new Map()
  for (const [key, html] of htmlByKey) {
    const mine = new Set()
    for (const m of String(html).matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      if (!CLASS_TAGS.test(m[1].toLowerCase())) continue
      for (const c of (m[3] || m[4] || '').split(/\s+/)) if (c && c.length <= 40 && !/^(is-|has-|active|on|sel|selected|current|hidden|show|open)$/.test(c)) mine.add(c)
    }
    for (const c of mine) { const e = seen.get(c) || { cls: c, n: 0, screens: [] }; e.n++; e.screens.push(key); seen.set(c, e) }
  }
  const all = [...seen.values()].filter((e) => e.n >= 2)
  // 外层的名字（.tabbar）比里面的（.tabbar-item）更像一个组件：前缀是别的共用 class 的就不单列
  const names = new Set(all.map((e) => e.cls))
  return all.filter((e) => ![...names].some((n) => n !== e.cls && (e.cls.startsWith(n + '-') || e.cls.startsWith(n + '__'))))
    .sort((a, b) => b.n - a.n || a.cls.localeCompare(b.cls)).slice(0, 14)
}

const pascal = (s) => s.replace(/(^|[-_]+)([a-z0-9])/gi, (_m, _a, c) => c.toUpperCase())

/** 截图 + 每屏的标题、跳转：每屏在无头浏览器里按设计尺寸开一次，从上到下截几段 */
async function shootScreens(browser, screens, size, kind, dir) {
  const [w, h] = size
  const out = []
  await Promise.all(screens.map(async (sc, i) => {
    const row = { key: sc.key, label: sc.label || sc.key, title: '', links: [], shots: [], page: 0, error: '' }
    try {
      await browser.withPage({ url: sc.url, w, h }, async (page) => {
        const { info } = await prepare(page, false)
        row.title = info && info.title ? String(info.title).slice(0, 40) : ''
        row.page = info ? info.page : 0
        row.links = await page.eval('window.__dshDesign.links ? window.__dshDesign.links() : []').catch(() => [])
        const s0 = await page.eval('window.__dshDesign.scroll(0)')
        const of = Math.min(MAX_PARTS, (s0 && s0.of) || 1)
        for (let p = 0; p < of; p++) {
          if (p) await page.eval(`window.__dshDesign.scroll(${p})`)
          const name = `${sc.key.replace(/\.html?$/i, '')}-${p + 1}.jpg`
          fs.writeFileSync(path.join(dir, name), await page.shot())
          row.shots.push(name)
        }
        if ((s0 && s0.of) > MAX_PARTS) row.more = s0.of - MAX_PARTS
      })
      // 网页再截一张手机宽的顶上一屏（看响应式怎么排）
      if (kind === 'web' && w > 600) {
        await browser.withPage({ url: sc.url, w: 390, h: 844 }, async (page) => {
          await prepare(page, false)
          const name = `${sc.key.replace(/\.html?$/i, '')}-mobile.jpg`
          fs.writeFileSync(path.join(dir, name), await page.shot())
          row.mobile = name
        })
      }
    } catch (e) {
      row.error = String((e && e.message) || e).slice(0, 120)
    }
    out[i] = row
  }))
  return out
}

/** 是软链接就先删掉链接本身（不碰它指的文件），再写的时候写成普通文件 */
export function unlinkIfLink(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file) } catch { /* 没有 */ }
}

/**
 * 生成交接包。screens：[{ key, url, label }]（预览服务器上的地址）；root：设计目录。
 * @returns { file, dir, md, shots, rows }
 */
export async function buildHandoff(browser, { root, screens, kind = 'web', size = [1280, 800], framework = 'react', dest = '', project = null, system = '', now = new Date() }) {
  const dir = path.join(root, HANDOFF_DIR)
  const shotDir = path.join(dir, 'shots')
  // handoff/、handoff/shots/ 得是设计目录里真的文件夹：是软链接就可能删到、写到别处去
  for (const d of [dir, shotDir]) {
    let st = null
    try { st = fs.lstatSync(d) } catch { fs.mkdirSync(d) }
    if (st && !st.isDirectory()) throw new Error(`${path.relative(root, d)} 不是普通文件夹（是软链接或文件），先挪走再交接`)
  }
  for (const f of fs.readdirSync(shotDir)) if (/\.jpg$/i.test(f)) fs.rmSync(path.join(shotDir, f), { force: true })
  const list = screens.slice(0, MAX_SCREENS)
  const rows = browser && browser.available() ? await shootScreens(browser, list, size, kind, shotDir) : list.map((sc) => ({ key: sc.key, label: sc.label, title: '', links: [], shots: [], error: '没有 Chrome / Edge，没截图' }))
  const htmlByKey = new Map()
  for (const sc of list) { try { htmlByKey.set(sc.key, fs.readFileSync(path.join(root, sc.key), 'utf8')) } catch { /* 读不了 */ } }
  const md = handoffMd({ root, rows, kind, size, framework, dest, project, system, htmlByKey, more: Math.max(0, screens.length - MAX_SCREENS), now })
  const file = path.join(dir, 'HANDOFF.md')
  unlinkIfLink(file)
  fs.writeFileSync(file, md)
  return { file, dir, md, shots: rows.reduce((m, r) => m + r.shots.length + (r.mobile ? 1 : 0), 0), rows }
}

/** 交接说明 */
export function handoffMd({ root, rows, kind, size, framework, dest, project, system, htmlByKey, more = 0, now = new Date() }) {
  const fw = FRAMEWORKS[framework] || null
  const same = framework === 'same' && project && project.framework
  const fwLabel = same ? `${project.label}（跟项目一样）` : fw ? fw.label : framework
  const name = path.basename(root)
  const keys = rows.map((r) => r.key)
  const route = (k) => routeOf(k)
  const keyOfLink = (p) => String(p || '').replace(/^\/+/, '').split(/[?#]/)[0]
  const lines = []
  lines.push(`# 交接：${name} → ${fwLabel}`, '')
  lines.push(`> 给写代码的模型看：照这份把设计稿做成真页面。设计稿就是源码——每屏一个 HTML，样式在 tokens.css 等样式表里。先读源文件，截图只用来对照，别凭截图猜数值。`, '')
  lines.push('## 做什么', '')
  lines.push(`- 设计目录：\`${root}\`（${rows.length} 屏${more ? `，另有 ${more} 屏没列进来` : ''}，${kind} ${size[0]}×${size[1]}）`)
  if (project && project.pkg) lines.push(`- 做到：\`${dest || project.dir}\`（现有项目 ${project.name}：${project.label || '没认出框架'}${project.tailwind ? ' + Tailwind' : ''}${project.ts ? '，TypeScript' : ''}，包管理 ${project.pm}）`)
  else if (fw && fw.create) lines.push(`- 做到：\`${dest}\`（新建项目：\`${fw.create.replace('{name}', path.basename(dest || name + '-app'))}\`，在 \`${path.dirname(dest || root)}\` 里跑）`)
  else lines.push(`- 做到：\`${dest}\``)
  lines.push(`- 框架：${fwLabel}`)
  if (system) lines.push(`- 设计系统：${system}（设计用的是它的 tokens.css / components.css，项目里也照它）`)
  lines.push(`- 生成时间：${now.toISOString().slice(0, 16).replace('T', ' ')}`, '')

  lines.push('## 屏幕和路由', '', '| 屏 | 设计文件 | 建议路由 | 截图（handoff/shots/） | 跳到 |', '| --- | --- | --- | --- | --- |')
  for (const r of rows) {
    const to = [...new Set((r.links || []).map((l) => keyOfLink(l.path)).filter((k) => k && k !== r.key))]
    const shots = r.error ? `没截成（${r.error}）` : [...r.shots, r.mobile].filter(Boolean).join('、') + (r.more ? `（还有 ${r.more} 段没截）` : '')
    lines.push(`| ${r.title || r.label} | ${r.key} | \`${route(r.key)}\` | ${shots} | ${to.map((k) => (keys.includes(k) ? k.replace(/\.html?$/i, '') : `${k}（没有这一屏）`)).join('、') || '—'} |`)
  }
  lines.push('')

  // 设计变量
  let tok = {}
  let hasTokens = false
  try { tok = tokensOf(fs.readFileSync(path.join(root, 'tokens.css'), 'utf8')); hasTokens = true } catch { tok = {} }
  const tn = Object.keys(tok)
  lines.push('## 设计变量', '')
  if (tn.length) {
    const colors = tn.filter((n) => /^--colou?r-/.test(n))
    lines.push(`\`tokens.css\` 里 ${tn.length} 个变量（颜色 ${colors.length} 个：${colors.slice(0, 10).map((n) => `\`${n}: ${tok[n]}\``).join('、')}${colors.length > 10 ? ' …' : ''}）。`, '')
    lines.push(project && project.tailwind
      ? '- 把 tokens.css 原样放进项目的全局样式并在入口引入；Tailwind 的 theme.extend 里把颜色、圆角、字号、阴影映射到这些变量（如 `primary: \'var(--color-primary)\'`），类名里别写死色值。'
      : '- 把 tokens.css 原样放进项目的全局样式（如 `src/styles/tokens.css`）并在入口引入；组件样式里一律用 `var(--…)`，别写死色值、字号。')
  } else if (hasTokens) lines.push('- `tokens.css` 的第一段 `:root` 里没读到变量：先打开看看，把各屏用到的颜色、字号收成 `:root` 上的变量再动手。')
  else lines.push('- 设计目录里没有 tokens.css：先把各屏 `<style>` 里 `:root` 上的变量收成一份 tokens.css 再动手。')
  const sheets = (() => { try { return fs.readdirSync(root).filter((n) => /\.css$/i.test(n) && n !== 'tokens.css') } catch { return [] } })()
  if (sheets.length) lines.push(`- 别的样式表：${sheets.map((n) => `\`${n}\``).join('、')}（公共样式，拆进对应组件或全局样式）`)
  lines.push('')

  // 共用部分
  const parts = sharedParts(htmlByKey)
  lines.push('## 几屏共用的部分（做成组件）', '')
  if (parts.length) for (const p of parts) lines.push(`- \`.${p.cls}\`：${p.n} 屏都有（${p.screens.map((k) => k.replace(/\.html?$/i, '')).join('、')}）→ \`${pascal(p.cls)}\` 组件`)
  else lines.push('- 没找到几屏共用的结构；按页面拆就行。')
  if (fs.existsSync(path.join(root, 'icons.svg'))) {
    let n = 0
    try { n = (fs.readFileSync(path.join(root, 'icons.svg'), 'utf8').match(/<symbol\b/g) || []).length } catch { n = 0 }
    lines.push(`- \`icons.svg\`：${n} 个图标（<symbol id>）→ 一个 \`Icon\` 组件按 id 取，或拆成单个 SVG 组件`)
  }
  lines.push('')

  // 交互和状态
  lines.push('## 交互和状态', '')
  const inter = []
  let hover = 0
  for (const n of [...sheets, 'tokens.css']) { try { hover += (fs.readFileSync(path.join(root, n), 'utf8').match(/:(hover|focus-visible|focus|active)\b/g) || []).length } catch { /* 没有 */ } }
  for (const [key, html] of htmlByKey) {
    const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim()).length
    const forms = (html.match(/<(input|textarea|select)\b/gi) || []).length
    hover += (html.match(/:(hover|focus-visible|focus|active)\b/g) || []).length
    const bits = []
    if (scripts) bits.push(`${scripts} 段脚本（改成框架里的状态和事件）`)
    if (forms) bits.push(`${forms} 个输入控件（做成受控组件、加校验和出错状态）`)
    if (/data-href=/.test(html)) bits.push('用 data-href 跳转的元素（改成路由跳转）')
    if (bits.length) inter.push(`- ${key}：${bits.join('；')}`)
  }
  lines.push(...(inter.length ? inter : ['- 设计稿里没有脚本和表单，纯展示。']))
  if (hover) lines.push(`- 悬停 / 聚焦 / 按下的样式 ${hover} 处：照搬，别丢。`)
  if ([...htmlByKey.values()].some((h) => /prefers-color-scheme\s*:\s*dark|data-theme=["']?dark/.test(h)) || /\[data-theme=["']?dark/.test(Object.keys(tok).length ? fs.readFileSync(path.join(root, 'tokens.css'), 'utf8') : '')) lines.push('- 有深色样式：项目里也要能切（跟系统，或 `<html data-theme="dark">`）。')
  const tw = readTweaks(root)
  if (tw && tw.list.length) lines.push(`- 调节滑块（tweaks.json）：${tw.list.map((k) => `${k.label}（${k.var || k.attr}，现在是 ${shownValue(k, k.value)}）`).join('、')}。最终值已经写在样式里；要在产品里留着可调，就做成主题设置（改同一个 CSS 变量 / <html> 属性）。`)
  lines.push('')

  // 素材
  const assets = []
  const walk = (d, rel, depth) => {
    if (depth > 2 || assets.length >= 40) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.') || /^(exports|refs|handoff|drafts|node_modules)$/.test(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(d, e.name), r, depth + 1)
      else if (/\.(png|jpe?g|webp|gif|avif|svg|woff2?|ttf|otf|mp4|webm)$/i.test(e.name) && e.name !== 'icons.svg') assets.push(r)
    }
  }
  walk(root, '', 0)
  lines.push('## 图片和字体', '')
  lines.push(assets.length ? `- ${assets.slice(0, 30).map((a) => `\`${a}\``).join('、')}${assets.length > 30 ? ' …' : ''}：照原样复制进项目的静态资源目录（public/ 或 src/assets/）` : '- 没有单独的图片、字体文件（图形都写在 HTML / SVG 里）。', '')

  // 做法
  const create = !(project && project.pkg) && fw && fw.create ? fw.create.replace('{name}', path.basename(dest || name + '-app')) : ''
  lines.push('## 做法和验收', '')
  lines.push(`1. 搭骨架：${create ? `新建项目 \`${create}\`，装好依赖${fw.router ? `和 ${fw.router}` : ''}` : framework === 'html' ? '整理成一个静态站点目录（每屏一个页面，公共样式一份）' : `在现有项目里加页面和路由（看清它现有的目录结构、样式写法、组件库再动手）`}；把 tokens.css${sheets.length ? '（和公共样式表）' : ''}搬进去。`)
  lines.push('2. 一屏一个页面，路由照上面的表；先抽几屏共用的组件，再拼页面。')
  lines.push('3. 结构、文案、数字、图标照设计稿的 HTML 搬；class 名可以改成项目的习惯，样式值（间距、字号、颜色、圆角、阴影）一律用设计变量。')
  lines.push('4. 每做完一屏：把开发服务器跑起来，调 `compare_design`（screen 填设计文件名，url 填这一屏在开发服务器上的地址），照差异图把不一样的地方改掉，直到差异在 3% 以内，或者剩下的差别说得出理由（比如真实数据、系统字体）。')
  lines.push('5. 全部做完：每屏再对一遍；告诉用户做了哪些页面、怎么跑起来（命令和地址）、还有哪里和设计稿不一样。')
  lines.push('', '别做：改设计（配色、文案、布局）、加设计稿里没有的功能、引入新的 UI 组件库（项目已经在用的除外）。', '')
  return lines.join('\n')
}

// ── compare_design：设计稿 vs 做出来的页面 ─────────────────────────────────────

// 页面上看得见的「块」（有字的、图片、按钮、有底色或边框的），差异区域按它说是哪个元素
const BLOCKS = `(() => {
  const out = []
  const W = innerWidth, H = innerHeight
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (out.length >= 600) break
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || +s.opacity < 0.05 || s.display === 'none') continue
    let text = ''
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue
    text = text.replace(/\\s+/g, ' ').trim()
    const tag = el.tagName.toLowerCase()
    if (/^(script|style|path|g|use|defs|symbol)$/.test(tag)) continue
    const leaf = text || /^(img|svg|button|input|select|textarea|video|canvas|picture)$/.test(tag)
    const box = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0
    if (!leaf && !box) continue
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : []
    out.push({ d: tag + (el.id ? '#' + el.id : '') + cls.map((c) => '.' + c).join(''), t: (text || el.getAttribute('alt') || el.getAttribute('aria-label') || '').slice(0, 24), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
  }
  return out
})()`

// 等单页应用画出东西来：body 里有字 / 有图，最多等 4 秒；再等字体
const SETTLE = `new Promise((res) => {
  const t0 = Date.now()
  ;(function w() {
    const b = document.body
    if ((b && (b.innerText.trim().length > 0 || b.querySelector('img,svg,canvas'))) || Date.now() - t0 > 4000) {
      Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 2500))]).then(() => setTimeout(() => res(true), 500))
    } else setTimeout(w, 100)
  })()
})`

// 滚到底：页面本身和里面能滚的区域（App 常把内容放在一个能滚的 main 里）都滚到底，再等新露出来的东西画好
const SCROLL_END = `new Promise((res) => {
  const se = document.scrollingElement || document.documentElement
  scrollTo({ left: 0, top: se.scrollHeight, behavior: 'instant' })
  const all = document.body ? document.body.getElementsByTagName('*') : []
  for (let i = 0, n = 0; i < all.length && n < 20; i++) {
    const el = all[i]
    if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < 40 || (el.id || '').startsWith('__dsh')) continue
    if (/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) { el.scrollTo({ left: el.scrollLeft, top: el.scrollHeight, behavior: 'instant' }); n++ }
  }
  Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 1500))]).then(() => setTimeout(() => res(true), 300))
})`

// 做出来的页面切深色：和设计稿那边（picker 的 dark）一模一样——样式里有 [data-theme="dark"] / .dark / [data-mode="dark"]
// 或 prefers-color-scheme: dark 的规则，就在 <html> 上打上属性，再在最后补一段 color-scheme: dark 和那些媒体规则
const IMPL_DARK = `new Promise((res) => {
  const media = []
  let attr = false
  const scan = (list) => {
    for (const r of list) {
      if (r.media && /prefers-color-scheme\\s*:\\s*dark/i.test(r.media.mediaText || '')) {
        for (const x of r.cssRules) media.push(x.cssText)
        continue
      }
      if (r.selectorText && /\\[data-theme=["']?dark|\\.dark\\b|\\[data-mode=["']?dark/i.test(r.selectorText)) attr = true
      if (r.cssRules && !r.media) { try { scan(r.cssRules) } catch (e) { /* 读不了 */ } }
    }
  }
  for (const s of document.styleSheets) { try { scan(s.cssRules) } catch (e) { /* 别的源 */ } }
  if (!attr && !media.length) return res(false)
  const de = document.documentElement
  de.setAttribute('data-theme', 'dark')
  de.setAttribute('data-mode', 'dark')
  de.classList.add('dark')
  const tag = document.createElement('style')
  tag.id = '__dsh_design_dark__'
  tag.textContent = ':root{color-scheme:dark}\\n' + media.join('\\n')
  ;(document.head || de).appendChild(tag)
  setTimeout(() => res(true), 400)
})`

/** 做出来的页面只许开本机的：localhost / 127.0.0.1 / ::1 的 http(s)、本地文件（跳转、脚本改地址也一样查） */
export function localOnly(u) {
  let x
  try { x = new URL(u) } catch { return false }
  if (/^(file|about|data|blob):$/.test(x.protocol)) return true
  return /^https?:$/.test(x.protocol) && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(x.hostname)
}

/* eslint-disable no-undef */
/** 在空白页里比两张无损截图：逐像素，每个点三个通道差加起来超过 24 就算不一样 → 差异比例、差得多的几块、拼图 */
async function diffIn(a, b, labels) {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('图片载不出来')); i.src = 'data:image/png;base64,' + src })
  const [A, B] = await Promise.all([load(a), load(b)])
  const w = A.width, h = A.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(A, 0, 0)
  const da = g.getImageData(0, 0, w, h).data
  g.clearRect(0, 0, w, h)
  g.drawImage(B, 0, 0, w, h)
  const db = g.getImageData(0, 0, w, h).data
  const CELL = 16
  const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL)
  const cells = new Float32Array(cw * ch)
  const heat = g.createImageData(w, h)
  let bad = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
      const hit = d > 24
      const l = (da[i] * 0.3 + da[i + 1] * 0.59 + da[i + 2] * 0.11) * 0.3 + 175
      if (hit) { bad++; cells[((y / CELL) | 0) * cw + ((x / CELL) | 0)]++ }
      heat.data[i] = hit ? 232 : l
      heat.data[i + 1] = hit ? 56 : l
      heat.data[i + 2] = hit ? 48 : l
      heat.data[i + 3] = 255
    }
  }
  // 差得多的格子连成块，按差的像素数排
  const on = (i) => cells[i] / (CELL * CELL) > 0.12
  const seen = new Uint8Array(cw * ch)
  const boxes = []
  for (let i = 0; i < cw * ch; i++) {
    if (seen[i] || !on(i)) continue
    const q = [i]
    seen[i] = 1
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0, score = 0
    while (q.length) {
      const j = q.pop()
      const x = j % cw, y = (j / cw) | 0
      score += cells[j]
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue
        const k = ny * cw + nx
        if (!seen[k] && on(k)) { seen[k] = 1; q.push(k) }
      }
    }
    if (score >= 120) boxes.push({ x: x0 * CELL, y: y0 * CELL, w: Math.min(w, (x1 + 1) * CELL) - x0 * CELL, h: Math.min(h, (y1 + 1) * CELL) - y0 * CELL, score })
  }
  boxes.sort((p, q) => q.score - p.score)
  const top = boxes.slice(0, 6)
  // 拼图：设计稿 | 做出来的 | 差异，差得多的几块标上号
  const PAD = 20, HEAD = 44
  const s = Math.min(1, 2400 / (w * 3 + PAD * 4))
  const out = document.createElement('canvas')
  out.width = Math.round((w * 3 + PAD * 4) * s)
  out.height = Math.round((h + HEAD + PAD) * s)
  const o = out.getContext('2d')
  o.scale(s, s)
  o.fillStyle = '#eef0f3'
  o.fillRect(0, 0, w * 3 + PAD * 4, h + HEAD + PAD)
  const hc = document.createElement('canvas')
  hc.width = w
  hc.height = h
  hc.getContext('2d').putImageData(heat, 0, 0)
  const pct = (bad / (w * h)) * 100
  ;[[A, labels[0]], [B, labels[1]], [hc, labels[2].replace('{pct}', pct.toFixed(1))]].forEach(([img, label], k) => {
    const x = PAD + k * (w + PAD)
    o.fillStyle = '#1f2329'
    o.font = '600 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    o.fillText(label, x, 30)
    o.drawImage(img, x, HEAD)
    o.strokeStyle = 'rgba(0,0,0,.12)'
    o.lineWidth = 1
    o.strokeRect(x - 0.5, HEAD - 0.5, w + 1, h + 1)
    if (k === 0) return
    top.forEach((bx, n) => {
      o.strokeStyle = '#e8382f'
      o.lineWidth = 3
      o.strokeRect(x + bx.x, HEAD + bx.y, bx.w, bx.h)
      o.fillStyle = '#e8382f'
      o.fillRect(x + bx.x, HEAD + bx.y - 22 < HEAD ? HEAD + bx.y : HEAD + bx.y - 22, 22, 22)
      o.fillStyle = '#fff'
      o.font = '700 15px -apple-system, sans-serif'
      o.fillText(String(n + 1), x + bx.x + 6, (HEAD + bx.y - 22 < HEAD ? HEAD + bx.y : HEAD + bx.y - 22) + 16)
    })
  })
  return { jpg: out.toDataURL('image/jpeg', 0.84).split(',')[1], pct, boxes: top, w, h }
}
/* eslint-enable no-undef */

/** 差异区域最像哪个元素：重叠面积 / 两者里大的那个，取最大的 */
export function blockAt(blocks, bx) {
  let best = null
  let score = 0
  for (const b of blocks || []) {
    const ix = Math.max(0, Math.min(bx.x + bx.w, b.x + b.w) - Math.max(bx.x, b.x))
    const iy = Math.max(0, Math.min(bx.y + bx.h, b.y + b.h) - Math.max(bx.y, b.y))
    const inter = ix * iy
    if (!inter) continue
    const s = inter / Math.max(bx.w * bx.h, b.w * b.h)
    if (s > score) { score = s; best = b }
  }
  return best
}

const describe = (b) => (b ? `${b.d}${b.t ? `「${b.t}」` : ''}` : '（空白处）')

/** 做出来的页面地址：本机的 http(s)，或本地 HTML 文件 */
export function implUrl(input, cwd) {
  const s = String(input || '').trim()
  if (/^\d{2,5}$/.test(s)) return `http://localhost:${s}/`
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s)
    if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) throw new Error('只比本机的页面（localhost 地址或本地 HTML 文件）')
    return u.href
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return 'http://' + s
  const p = path.resolve(cwd || '.', s)
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}`)
  return pathToFileURL(p).href
}

/**
 * 比一屏：设计稿（预览服务器上的地址，带设计台脚本）vs 做出来的页面，同样尺寸、同样滚动位置。
 * @returns { pct, boxes: [{ x, y, w, h, design, impl }], jpg, text }
 */
export async function compareScreens(browser, { design, impl, size, at = 'top', dark = false }) {
  const [w, h] = size
  // 两边一样准备：等画好 → 深色 → 滚到同一个位置（页面和里面能滚的区域都滚）→ 无损截图
  let blocked = []
  const shoot = (url, isDesign) => browser.withPage({ url, w, h, dark, allow: isDesign ? null : localOnly }, async (page) => {
    if (!isDesign && page.blocked) blocked = page.blocked
    if (isDesign) await prepare(page, dark)
    else {
      await page.eval(SETTLE)
      // 跳外网被拦下后停在了出错页：比它没意义
      if (blocked.length && (await page.eval('location.protocol').catch(() => '')) === 'chrome-error:') throw new Error('blocked')
      if (dark) await page.eval(IMPL_DARK)
    }
    if (at === 'bottom') await page.eval(SCROLL_END)
    const png = await page.shot({ format: 'png' })
    const blocks = await page.eval(BLOCKS).catch(() => [])
    const pageH = await page.eval('Math.max(document.documentElement.scrollHeight, innerHeight)').catch(() => 0)
    return { png, blocks, pageH, blocked: page.blocked ? page.blocked.slice() : [] }
  })
  // 一个接一个截：同时开两个页面时系统字体（中文）偶尔还没画好就截了，差异会虚高
  const A = await shoot(design.url, true)
  const B = await shoot(impl, false).catch((e) => {
    // 页面自己跳到外网被拦下、截图时页面没了：说清楚是跳走了
    if (blocked.length) throw new Error(`做出来的页面跳到了本机以外的地址，拦下了：${blocked[0].slice(0, 120)}`)
    throw e
  })
  const labels = ['设计稿', '做出来的', '差异 {pct}%']
  const r = await browser.withPage({ url: 'about:blank', w: 200, h: 200 }, (page) => page.eval(`(${diffIn})(${JSON.stringify(A.png.toString('base64'))}, ${JSON.stringify(B.png.toString('base64'))}, ${JSON.stringify(labels)})`))
  const boxes = r.boxes.map((bx) => ({ ...bx, design: blockAt(A.blocks, bx), impl: blockAt(B.blocks, bx) }))
  const lines = [`${design.label || design.key}（${w}×${h}${at === 'bottom' ? '，滚到底' : '，顶上一屏'}）：设计稿 vs ${impl}`]
  lines.push(`差异 ${r.pct.toFixed(1)}%（逐像素无损比）${r.pct < 3 ? '：基本一致' : r.pct < 10 ? '：大体对上了，下面几块要改' : '：差得比较多'}`)
  if (B.blocked.length) lines.push(`做出来的页面想跳到本机以外的地址，拦下了：${B.blocked.slice(0, 3).join('、')}`)
  if (A.pageH && B.pageH && Math.abs(A.pageH - B.pageH) > 24) lines.push(`页面高度：设计稿 ${A.pageH}px，做出来的 ${B.pageH}px（差 ${B.pageH - A.pageH > 0 ? '+' : ''}${B.pageH - A.pageH}px，多半是间距 / 字号 / 行高不一样）`)
  if (boxes.length) {
    lines.push('差得最多的几块（图里红框的号）：')
    boxes.forEach((b, i) => lines.push(`${i + 1}. 位置 ${b.x},${b.y}（${b.w}×${b.h}）：设计稿是 ${describe(b.design)}，做出来的是 ${describe(b.impl)}`))
    lines.push('整块挪了位置先查上面的间距和高度；颜色不对查设计变量；字的宽度不一样查字体、字号、字重。')
  } else lines.push('没有成片的差异。')
  return { pct: r.pct, boxes, jpg: Buffer.from(r.jpg, 'base64'), text: lines.join('\n') }
}

/** 设计目录里的几屏（交接、对比时按文件名找） */
export function screensOf(root) {
  return listScreens(root)
}
