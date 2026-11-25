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

import { PHOTO_PREFIX, isPhotoAsset } from './photos.js'
import { isLibFontRel, loadFontIndex } from './fonts.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { prepare } from './look.js'
import { allScreens } from './core.js'
import { readTweaks, shownValue } from './tweaks.js'
import { annotationsMd } from './annotations.js'
import { tokensOf } from './system.js'
import { FRAMES_DIR } from './frames.js'
import { FRAME_MAIN, SLOT_BOX } from './slot.js'
import { statesOfHtml } from './states.js'
import { mockExpr, mockOf } from './mock.js'
import { componentFiles, dirReader, expandPreview } from './comp-io.js'
import { catalog as componentCatalog } from './components.js'
import { tokenize } from './gallery/html.js'

/**
 * 交接文档里的「页面状态」：写了几个状态的屏，列出状态、各状态用到的样式条数、哪些按钮会切到哪个状态
 * @param htmlByKey 屏 → HTML；css 共用样式表的内容（数 [data-state] 规则用）
 */
export function statesMd(htmlByKey, css = '') {
  const out = []
  for (const [key, html] of htmlByKey) {
    const st = statesOfHtml(html)
    if (!st.length) continue
    const all = String(html) + '\n' + css
    const uses = (n) => (all.match(new RegExp(`\\[data-state\\s*=\\s*["']?${n}["']?\\s*\\]`, 'g')) || []).length
    const names = st.map((x, i) => `\`${x.name}\`${x.label !== x.name ? `（${x.label}）` : ''}${i === 0 ? '·默认' : ''}${uses(x.name) ? `，样式 ${uses(x.name)} 处` : ''}`)
    const go = new Set()
    for (const m of String(html).matchAll(/(?:href|data-href|data-to)\s*=\s*["']([^"'#]*?)\?state=([A-Za-z0-9_-]{1,32})/gi)) go.add(`${m[1] ? m[1].replace(/^\.?\//, '') : key} → ${m[2]}`)
    out.push(`- ${key} 有 ${st.length} 个状态：${names.join('；')}。是同一个页面的几种样子：做成一个组件 + 状态（如 \`status: ${st.map((x) => `'${x.name}'`).join(' | ')}\`），按 \`[data-state="…"]\` 那几条样式显示 / 隐藏，别拆成几个页面${go.size ? `；会切状态的链接：${[...go].slice(0, 8).join('、')}` : ''}。`)
  }
  return out
}

/**
 * 交接文档里的「模拟数据」（#30）：设计目录里有 mock.json 才有。原型的数据都在这一份里、各屏用 data-mock-* 绑上；
 * 转代码时做成一份初始数据 + 全局状态，页面从状态里读、点了改状态
 */
export function mockMd(htmlByKey, root, savedNotes = null) {
  const m = mockOf(root)
  if (!m) return []
  const top = Object.keys(m.data)
  const out = [
    `- 原型的数据都在设计目录的 \`mock.json\` 里${m.err ? `（现在读不出来：${m.err}——先修好再做）` : top.length ? `（顶层：${top.slice(0, 12).join('、')}${top.length > 12 ? ' 等' : ''}）` : ''}，各屏用 \`data-mock-*\` 绑在上面。照搬成项目里的一份初始数据 + 一个全局状态（Pinia / Zustand / Context / 小程序的全局 store 之类）：页面上的值从状态里读，点了改状态，换页还在；以后接真接口只换状态的来源，页面不用动。`,
    '- 写法对照：`data-mock-text` 显示值；`data-mock-show` 条件显示；`data-mock-each="x in list"` + `<template>` 是列表；`data-mock-class` / `data-mock-attr` 按条件加 class、属性；`data-mock-model` 双向绑定的输入框；`data-mock-set="a = …; b = …"` 点了改数据（做成点击事件）；`data-mock-reset` 恢复初始数据（演示用）。',
  ]
  const topSet = new Set(top)
  const follow = []
  const notes = savedNotes || [...htmlByKey].map(([key, html]) => mockNotes(key, html, topSet))
  for (const note of notes) {
    if (!note) continue
    if (note.line) out.push(note.line)
    follow.push(...note.follow)
  }
  if (follow.length) out.push(`- 状态跟着数据走的屏：${follow.slice(0, 8).join('、')}——这几屏的状态别放在页面自己里，读全局状态的那个字段（一处改了所有页一起变）。`)
  return out
}

function mockNotes(key, html, topSet) {
  html = String(html)
  const follow = []
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bname\s*=\s*["']?dsh-states["'\s/>]/i.test(tag)) continue
    const d = /\bdata-mock\s*=\s*["']([^"']+)["']/i.exec(tag)
    if (d) follow.push(`${key}（${d[1].trim()}）`)
  }
  const used = new Set()
  let sets = 0
  for (const a of html.matchAll(/\sdata-mock-(text|show|each|set|model|class|attr)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (a[1].toLowerCase() === 'set') sets++
    const v = (a[2] !== undefined ? a[2] : a[3] || '').replace(/'[^']*'|"[^"]*"/g, ' ')
    for (const p of v.matchAll(/[A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*(?:\.[\w$\u4e00-\u9fa5]+|\[\d+\])*/g)) if (topSet.has(p[0].split(/[.[]/)[0])) used.add(p[0])
  }
  const fields = [...used].slice(0, 8).map((x) => '`' + x + '`').join('、')
  const line = used.size || sets ? `- ${key}：用到 ${fields || '（只有改数据的按钮）'}${used.size > 8 ? ` 等 ${used.size} 个字段` : ''}${sets ? `；点了改数据 ${sets} 处` : ''}` : ''
  return { line, follow }
}

export const HANDOFF_DIR = 'handoff'
/** 版本名里哪些是用户在右侧栏亲手改的（见 core.js：改字、调样式、调节滑块） */
const TUNED = /^(改字「|调样式「|调节：)/
export const HANDOFF_BATCH_SIZE = 12
const MAX_PARTS = 3 // 每屏最多截几段

export const FRAMEWORKS = {
  react: { label: 'React + Vite（TypeScript）', create: 'npm create vite@latest {name} -- --template react-ts', router: 'react-router-dom' },
  vue: { label: 'Vue 3 + Vite（TypeScript）', create: 'npm create vite@latest {name} -- --template vue-ts', router: 'vue-router' },
  next: { label: 'Next.js（App Router，TypeScript）', create: 'npx create-next-app@latest {name} --ts --app --use-npm', router: '' },
  html: { label: '纯 HTML / CSS（不用框架）', create: '', router: '' },
  // 小程序：uni-app 一份代码出微信小程序和网页版（网页版能用 compare_design 比）；原生写 WXML / WXSS（没有脚手架命令，手搭骨架）
  uniapp: { label: 'uni-app（Vue 3 + Vite，TypeScript；出微信小程序和网页版）', create: 'npx degit dcloudio/uni-preset-vue#vite-ts {name}', router: '' },
  weapp: { label: '微信原生小程序（WXML / WXSS）', create: '', router: '' },
}

/** 做成小程序的写法（交接说明按小程序的规矩写：rpx、page 上的变量、view / text、pages.json / app.json 登记页面） */
const MINI = new Set(['uniapp', 'weapp', 'taro'])

const FW_DEPS = [['@dcloudio/uni-app', 'uniapp', 'uni-app'], ['@tarojs/taro', 'taro', 'Taro'], ['next', 'next', 'Next.js'], ['nuxt', 'vue', 'Nuxt'], ['@sveltejs/kit', 'svelte', 'SvelteKit'], ['svelte', 'svelte', 'Svelte'], ['astro', 'astro', 'Astro'], ['@angular/core', 'angular', 'Angular'], ['solid-js', 'solid', 'Solid'], ['@builder.io/qwik', 'qwik', 'Qwik'], ['ember-source', 'ember', 'Ember'], ['preact', 'preact', 'Preact'], ['lit', 'lit', 'Lit'], ['vue', 'vue', 'Vue'], ['react-native', 'react-native', 'React Native'], ['react', 'react', 'React']]

// 文件夹里只有这些就算空的
const JUNK = /^\.(DS_Store|git|gitignore)$|^(Thumbs\.db|desktop\.ini)$/i

/** 文件夹里有没有正经东西（不存在 / 读不了算没有） */
function hasStuff(dir) {
  try { return fs.readdirSync(dir).some((f) => !JUNK.test(f)) } catch { return false }
}

// 有这些就算网页入口（没有 package.json 的纯 HTML 站点也算个项目）
const HTML_ENTRIES = ['index.html', 'src/index.html', 'public/index.html', 'app/index.html']

/** workspaces 列表里有本目录以外的（只写 '.' 的不算 monorepo；'!' 开头是排除） */
const listsOthers = (xs) => xs.some((x) => typeof x === 'string' && !/^!|^\.\/?$/.test(x.trim()))

/** 读文本：去掉 BOM、换行统一成 \n（Windows 检出的文件常是 CRLF）；读不了返回 null */
function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') } catch { return null }
}

/** 像是 monorepo 根目录：package.json 的 workspaces、lerna / rush / Nx 集成式（根上没有 project.json）、pnpm-workspace.yaml 的 packages 里列了别的包（只用来提醒模型放进子包，不拿来改放哪） */
function monoRoot(dir, pkg) {
  const ws = pkg && pkg.workspaces
  const list = Array.isArray(ws) ? ws : ws && Array.isArray(ws.packages) ? ws.packages : null
  if (list && listsOthers(list)) return true
  const has = (f) => fs.existsSync(path.join(dir, f))
  if (has('lerna.json') || has('rush.json') || (has('nx.json') && !has('project.json'))) return true
  let y = readText(path.join(dir, 'pnpm-workspace.yaml'))
  if (y === null) return false
  y = y.replace(/#.*$/gm, '')
  // packages: ['a/*', 'b'] 或者下面一行一个 - a/*
  const m = y.match(/^packages[ \t]*:(.*(?:\n(?:[ \t]+.*|-.*|[ \t]*))*)/m)
  return !!m && listsOthers([...m[1].matchAll(/['"]?([^'"\s,[\]-][^'"\s,[\]]*)['"]?/g)].map((x) => x[1]))
}

/** 读 JSON 对象：读不了、写坏了、不是对象都返回 null */
function readObj(file) {
  try { const o = JSON.parse(readText(file)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null }
}

/**
 * 没有 package.json 也认得出的小程序项目：
 * HBuilderX 建的 uni-app（根目录有 manifest.json 和写了 pages 的 pages.json；manifest.json 里 vueVersion 是 3 就是 Vue 3，没写是 Vue 2）、
 * 微信原生小程序（project.config.json，miniprogramRoot 指的目录（默认根目录）里有 app.json）
 */
/** Taro 的源码目录：config/index 里写死的 sourceRoot（只认项目里面的相对目录），没写或认不出就是默认的 src/ */
function taroRoot(dir) {
  for (const f of ['index.ts', 'index.js', 'index.mjs', 'index.cjs']) {
    const m = /\bsourceRoot\s*:\s*(['"`])([^'"`$\n]+)\1/.exec(readText(path.join(dir, 'config', f)) || '')
    if (!m) continue
    const r = m[2].trim().replace(/\\/g, '/').replace(/^(\.\/)+|\/+$/g, '')
    return r && r !== '.' && !/(^|\/)\.\.(\/|$)|^\/|^[a-z]:/i.test(r) ? r + '/' : 'src/'
  }
  return 'src/'
}

function miniOf(dir) {
  if (!dir) return null
  const pages = readText(path.join(dir, 'pages.json'))
  if (pages !== null && /"pages"\s*:/.test(pages) && fs.existsSync(path.join(dir, 'manifest.json'))) {
    const v3 = /"vueVersion"\s*:\s*"?3/.test(readText(path.join(dir, 'manifest.json')) || '')
    return { framework: 'uniapp', label: `uni-app（HBuilderX，Vue ${v3 ? 3 : 2}）`, hbx: true, pagesAt: '' }
  }
  const cfg = readObj(path.join(dir, 'project.config.json'))
  if (!cfg) return null
  // miniprogramRoot 只认项目里面的相对目录（'miniprogram/'），别的当根目录
  const sub = typeof cfg.miniprogramRoot === 'string' && !/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(cfg.miniprogramRoot) ? cfg.miniprogramRoot.replace(/\\/g, '/').replace(/^(\.\/)+|\/+$/g, '') : ''
  if (fs.existsSync(path.join(dir, sub, 'app.json'))) return { framework: 'weapp', label: '微信原生小程序', hbx: false, pagesAt: sub ? sub + '/' : '' }
  if (sub && fs.existsSync(path.join(dir, 'app.json'))) return { framework: 'weapp', label: '微信原生小程序', hbx: false, pagesAt: '' }
  return null
}

/**
 * 目录是不是个项目、用的什么：{ dir, pkg, site（有 index.html 入口）, empty（不存在或没正经东西）, mono（像 monorepo 根目录）, name, framework, label, tailwind, ts, pm }
 * 后端、monorepo 根目录、只用 CDN 的纯 HTML 站点也都算项目：是不是前端、页面该放进哪个子包，交接说明里让写代码的模型看清结构自己定（猜不准）
 */
export function detectProject(dir) {
  const out = { dir, pkg: false, site: false, empty: true, mono: false, name: path.basename(dir || ''), framework: '', label: '', tailwind: false, ts: false, pm: 'npm', hbx: false, pagesAt: '' }
  out.site = !!dir && HTML_ENTRIES.some((f) => fs.existsSync(path.join(dir, f)))
  out.empty = !dir || !hasStuff(dir)
  const mini = miniOf(dir)
  const pkg = dir ? readObj(path.join(dir, 'package.json')) : null
  if (!pkg) {
    if (mini) Object.assign(out, mini, { ts: fs.existsSync(path.join(dir, 'tsconfig.json')) })
    return out
  }
  out.pkg = true
  if (typeof pkg.name === 'string' && pkg.name) out.name = pkg.name
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const hit = FW_DEPS.find(([d]) => deps[d])
  // HBuilderX 项目、原生小程序也常有 package.json（装 uView、Vant Weapp 这些）：没写 uni-app / Taro 的依赖就按目录结构认
  if (mini && !(hit && MINI.has(hit[1]))) Object.assign(out, mini)
  else if (hit && hit[1] === 'uniapp') Object.assign(out, { framework: 'uniapp', label: `uni-app（Vue ${/^\D*2\./.test(String(deps.vue || '')) ? 2 : 3}）`, pagesAt: fs.existsSync(path.join(dir, 'src', 'pages.json')) ? 'src/' : '' })
  else if (hit && hit[1] === 'taro') Object.assign(out, { framework: 'taro', label: 'Taro', pagesAt: taroRoot(dir) })
  else if (hit) { out.framework = hit[1]; out.label = hit[2] + (hit[0] === 'react' && deps.vite ? ' + Vite' : hit[0] === 'vue' && deps.vite ? ' + Vite' : '') }
  out.tailwind = !!deps.tailwindcss
  out.mono = monoRoot(dir, pkg)
  out.ts = !!deps.typescript || fs.existsSync(path.join(dir, 'tsconfig.json'))
  out.pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock')) ? 'bun' : 'npm'
  return out
}

/** 是个项目（不用往里面再套一层）：有 package.json、index.html 入口、.git，或是认得出的小程序（后端、monorepo 根目录、刚建只有 README 的仓库都算） */
function isProject(dir) {
  return ['package.json', '.git', ...HTML_ENTRIES].some((f) => fs.existsSync(path.join(dir, f))) || !!miniOf(dir)
}

/** 认得出的现有项目：有 package.json，或者是没有 package.json 的小程序（HBuilderX 的 uni-app、微信原生） */
export const isCode = (p) => !!(p && (p.pkg || p.framework))

/**
 * 不指定框架时用什么：认得出框架的项目就跟它一样，纯 HTML 站点（没有 package.json）就纯 HTML，
 * 别的：小程序的设计用 uni-app（能出微信小程序，网页版还能逐像素比），其余用 React（右侧栏和 handoff_design 都按这个）
 */
export function defaultFramework(project, kind = '') {
  if (project && project.framework) return 'same'
  if (project && project.site && !project.pkg) return 'html'
  return kind === 'miniprogram' ? 'uniapp' : 'react'
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

/** 把允许的目录当场解析成真实路径钉住，返回判断函数（之后目录被换成软链，边界也不跟着变） */
/** 本机时间，写明时区：2026-11-10 12:07（UTC+8） */
export function localStamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const a = Math.abs(off)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}（UTC${off < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + p(a % 60) : ''}）`
}

export function pinRoots(roots) {
  const pins = roots.filter(Boolean).map((r) => fold(realish(r)))
  return (p) => {
    const a = fold(realish(p))
    return pins.some((b) => a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep))
  }
}

/**
 * 代码放进 dest 时算哪个项目：dest 自己就是项目就用它；不是、但已经在某个项目里面（比如选了它的 src/pages）→ 用往上最近的那个
 * （往上找到家目录为止，家目录本身不算：有人在家目录放 package.json；还不存在的目录不往上找：那是要新建的项目）
 * dest 里有 index.html 时：上面的项目认得出框架才算它的（Angular、webpack 项目的 src/index.html）；
 * 认不出的（Node 库仓库里的 docs/ 静态站点）还是当纯 HTML 站点
 */
export function projectFor(dest) {
  const own = detectProject(dest)
  if (isCode(own) || !fs.existsSync(dest)) return own
  const home = fold(realish(os.homedir()))
  for (let cur = path.dirname(realish(dest)); fold(cur) !== home && path.dirname(cur) !== cur; cur = path.dirname(cur)) {
    if (!fs.existsSync(path.join(cur, 'package.json')) && !miniOf(cur)) continue
    const p = detectProject(cur)
    if (isCode(p)) return own.site && !p.framework ? own : p
  }
  return own
}

/**
 * 代码默认放哪：会话目录是个项目（有 package.json，或是认得出的小程序）、又不在设计目录里 → 就放会话目录；
 * 否则新建 <设计名>-app：设计目录在会话目录下就建在会话目录里，不然建在设计目录旁边（别塞进设计目录）
 */
export function defaultDest(root, cwd, project) {
  const inside = !!root && within(cwd, root)
  if (isCode(project) && !inside) return cwd
  const under = !!root && !inside && within(root, cwd)
  return path.join(root && !under ? path.dirname(root) : cwd, appDirName(root))
}

/** 新建的代码目录叫什么：<设计名>-app */
export function appDirName(root) {
  const base = (root ? path.basename(root) : 'app').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app'
  return base === 'app' || base.endsWith('-app') ? `${base}-code` : `${base}-app`
}

/**
 * 用户在右侧栏选了个文件夹 → { dest, why }：
 * 是个项目（有 package.json、index.html 或 .git，后端、monorepo 根目录也算）、在某个项目里面（比如它的 src/pages）、空文件夹、还不存在、
 * 或者本来就叫 <设计名>-app（上回放过的）→ 就放这里（why 空）；
 * 别的有东西的文件夹（比如 ~/Projects）→ 在它里面新建 <设计名>-app（why 'nested'）；
 * 选到设计目录里面了 → 放到设计目录旁边（why 'beside'：设计稿要留着做对比，handoff_design 也不收设计目录里的地方）
 */
export function pickedDest(dir, root) {
  const name = appDirName(root)
  const beside = { dest: path.join(path.dirname(root || dir), name), why: 'beside' }
  if (root && within(dir, root)) return beside
  let out = { dest: dir, why: '' }
  if (!isProject(dir) && !isCode(projectFor(dir)) && path.basename(dir).toLowerCase() !== name) {
    if (hasStuff(dir)) out = { dest: path.join(dir, name), why: 'nested' } // 还不存在 / 读不了 / 空的：就用它
  }
  return root && within(out.dest, root) ? beside : out
}

/** 文件名 → 建议路由：index / home → /，别的 /名字 */
export function routeOf(key) {
  const b = String(key).replace(/\.html?$/i, '').toLowerCase()
  return b === 'index' || b === 'home' ? '/' : '/' + b.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** 文件名 → 小程序的页面路径（登记进 pages.json / app.json 的，相对它们所在的目录）：index / home → pages/index/index，别的 pages/名字/名字（Taro 是 pages/名字/index） */
export function pagePathOf(key, target = 'uniapp') {
  const r = routeOf(key)
  const b = r === '/' ? 'index' : r.slice(1) || 'page'
  return `pages/${b}/${target === 'taro' ? 'index' : b}`
}

/** 交接和比对共用设计清单，顺序跟 allScreens（设计清单 / 创建顺序）一致。 */
export function handoffScreens(root, origin = '') {
  const keys = allScreens(root)
  const stems = keys.map((key) => key.replace(/\.html?$/i, ''))
  const counts = new Map()
  for (const stem of stems) counts.set(stem.toLowerCase(), (counts.get(stem.toLowerCase()) || 0) + 1)
  return keys.map((key, i) => {
    const label = stems[i]
    // 同名的 .htm / .html 各有自己的截图，保留其他屏的旧文件名。
    const shotStem = label.startsWith('~') || counts.get(label.toLowerCase()) > 1 ? '~' + createHash('sha1').update(key).digest('hex') : label
    const url = origin ? `${origin}/${encodeURIComponent(key)}` : pathToFileURL(path.join(root, key)).href
    return { key, label, url, route: routeOf(key), shotStem, batch: Math.floor(i / HANDOFF_BATCH_SIZE) + 1 }
  })
}

export function findHandoffScreen(screens, name) {
  const raw = String(name ?? '').trim()
  const key = raw.replace(/^\.?\//, '')
  const norm = key.replace(/\.html?$/i, '').toLowerCase()
  return screens.find((sc) => sc.key === key) || (norm && screens.find((sc) => sc.key.replace(/\.html?$/i, '').toLowerCase() === norm || sc.label?.toLowerCase() === norm)) || screens.find((sc) => raw && sc.route === raw)
}

export function handoffBatch(catalog, { batch = 1, names } = {}) {
  const total = Math.ceil(catalog.length / HANDOFF_BATCH_SIZE)
  if (Array.isArray(names) && names.length) {
    const chosen = new Set()
    const missing = []
    for (const name of names) {
      const sc = findHandoffScreen(catalog, name)
      if (sc) chosen.add(sc)
      else missing.push(String(name).slice(0, 60))
    }
    if (chosen.size > HANDOFF_BATCH_SIZE) return { error: `一次最多截 ${HANDOFF_BATCH_SIZE} 屏。请减少 screens，或用 batch 按批截图（共 ${total} 批）。` }
    return { list: [...chosen], missing }
  }
  if (!Number.isSafeInteger(batch) || batch < 1 || (total && batch > total)) return { error: `batch 要填 1 到 ${total || 1} 的整数。` }
  return { list: catalog.filter((sc) => sc.batch === batch), missing: [], batch }
}

/** 未截图也能列出源码里的静态跳转。截图时再补运行页面产生的链接。 */
function sourceRow(sc, raw) {
  const html = String(raw || '').replace(/<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const title = /<title\b[^>]*>([^<]*)<\/title\s*>/i.exec(html)?.[1].trim().slice(0, 40) || ''
  const pageUrl = new URL(sc.url)
  const here = pageUrl.protocol === 'file:' ? new URL('http://localhost/' + encodeURIComponent(sc.key)) : pageUrl
  const links = new Set()
  for (const [tag, tagName] of html.matchAll(/<([a-z][\w-]*)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map()
    for (const [, key, a, b, c] of tag.slice(tagName.length + 1, -1).matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(key.toLowerCase(), a ?? b ?? c)
    const js = /(?:location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*)['"]([^'"]+)['"]/.exec(attrs.get('onclick') || '')
    const rawLink = ((tagName.toLowerCase() === 'a' && attrs.get('href')) || attrs.get('data-href') || attrs.get('data-to') || js?.[1] || '').trim()
    if (!rawLink || rawLink.startsWith('#')) continue
    try {
      const url = new URL(rawLink.replace(/&amp;/gi, '&'), here)
      if (url.origin !== here.origin || url.protocol !== here.protocol) continue
      links.add(decodeURIComponent(url.pathname))
    } catch { /* 不是可识别的页面地址 */ }
  }
  return { title, links: [...links].map((path) => ({ path })) }
}

const mockPaths = mockExpr()

/** 从页面调用处取动态参数，组件定义自身的 mock 字段另由组件清单提供。 */
function collectInstancePaths(raw, contracts) {
  for (const t of tokenize(raw)) {
    if (t.type !== 'tag' || !t.tag.name.startsWith('c-')) continue
    const contract = contracts.get(t.tag.name.slice(2))
    if (!contract) continue
    for (const a of t.tag.attrs) {
      if (!a.name.startsWith(':') || !contract.params.has(a.name.slice(1))) continue
      const value = a.value.trim()
      try {
        const ast = mockPaths.parse(value)
        if (ast.t === 'path' && ast.segs.every((s) => s.t === 'lit' &&
          ['number', 'string'].includes(typeof s.v) && !mockPaths.BAD.has(String(s.v))) &&
          !mockPaths.lex(value).some((token) => token.k === 'op' && ['(', ')'].includes(token.v))) contract.paths.add(value)
      } catch { /* 无效绑定交给组件体检 */ }
    }
  }
}

const CLASS_TAGS = /^(header|nav|footer|aside|section|div|a|button|ul|ol|li|form|article|main|figure)$/

/** 页面套了登记过的外框：DSH 自带的四个（data-frame="dsh/…"），或带外框库那段 <template id="dsh-frame">；还得有槽位。和体检、compare_design 一个认法 */
export const isFramed = (html) => {
  const s = String(html || '')
  return /\sdata-slot\s*=/i.test(s) && (/\bdata-frame\s*=\s*["']?dsh\/(sidebar|settings|view|panel)["'\s>]/i.test(s) || /<template\b[^>]*\bid\s*=\s*["']?dsh-frame["'\s>]/i.test(s))
}

/** 页面套了外框就只留各个 data-slot 里面的（外框是宿主画的，不用做，也不算「几屏共用的部分」）；没套原样给 */
export function slotHtml(html) {
  const s = String(html || '')
  if (!isFramed(s)) return s
  const out = []
  const open = /<([a-z][a-z0-9-]*)\b[^>]*?\sdata-slot\s*=[^>]*>/gi
  let m
  while ((m = open.exec(s))) {
    // 找配对的结束标签：同名标签数层数（槽位里的槽位跟着一起拿走，不重复）
    const close = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi')
    close.lastIndex = open.lastIndex
    let depth = 1
    let end = s.length
    let x
    while ((x = close.exec(s))) {
      if (!x[1] && /\/\s*>$/.test(x[0])) continue
      depth += x[1] ? -1 : 1
      if (!depth) { end = x.index; break }
    }
    out.push(s.slice(open.lastIndex, end))
    open.lastIndex = end
  }
  return out.join('\n')
}

/** 设计目录里哪些样式表是外框的：自带 DSH 外框是 dsh-shell.css；外框库的照库里 frame.json 写的 css（库里没有这个外框就认不出） */
export function frameCss(root, htmls) {
  const ids = new Set()
  for (const h of htmls) for (const m of String(h).matchAll(/\bdata-frame\s*=\s*["']?([a-z0-9][a-z0-9-]*)\//gi)) ids.add(m[1].toLowerCase())
  const names = new Set()
  for (const id of ids) {
    if (id === 'dsh') { names.add('dsh-shell.css'); continue }
    try {
      const m = JSON.parse(fs.readFileSync(path.join(FRAMES_DIR, id, 'frame.json'), 'utf8').replace(/^\uFEFF/, ''))
      for (const c of [].concat(m.css || [])) if (typeof c === 'string') names.add(c.toLowerCase())
    } catch { /* 库里没有 */ }
  }
  try { return fs.readdirSync(root).filter((n) => names.has(n.toLowerCase())) } catch { return [] }
}

/** 几屏共用的 class（≥ 2 屏都有，多半该抽成组件）：[{ cls, n, screens }]；套了外框的页面只看槽位里的 */
export function sharedParts(htmlByKey) {
  const seen = new Map()
  for (const [key, raw] of htmlByKey) {
    const html = slotHtml(raw)
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
const shotName = (sc, part) => `${sc.shotStem}-${part}.jpg`
const desktopShots = (sc) => Array.from({ length: MAX_PARTS }, (_, i) => shotName(sc, i + 1))

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
          const name = shotName(sc, p + 1)
          fs.writeFileSync(path.join(dir, name), await page.shot())
          row.shots.push(name)
        }
        if ((s0 && s0.of) > MAX_PARTS) row.more = s0.of - MAX_PARTS
      })
      // 网页再截一张手机宽的顶上一屏（看响应式怎么排）
      if (kind === 'web' && w > 600) {
        await browser.withPage({ url: sc.url, w: 390, h: 844 }, async (page) => {
          await prepare(page, false)
          const name = shotName(sc, 'mobile')
          fs.writeFileSync(path.join(dir, name), await page.shot())
          row.mobile = name
        })
      }
    } catch (e) {
      row.error = String((e && e.message) || e).slice(0, 120)
      row.shots = []
      delete row.mobile
      delete row.more
    }
    out[i] = row
  }))
  return out
}

/** 是软链接就先删掉链接本身（不碰它指的文件），再写的时候写成普通文件 */
export function unlinkIfLink(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file) } catch { /* 没有 */ }
}

function writeHandoffFile(file, text) {
  const temp = path.join(path.dirname(file), `.handoff-${randomUUID()}`)
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' })
    unlinkIfLink(file)
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function styleSheets(root, frames = []) {
  try { return fs.readdirSync(root).filter((n) => /\.css$/i.test(n) && n !== 'tokens.css' && !frames.includes(n)) } catch { return [] }
}

function screenStyles(root, sheets) {
  return [...sheets, 'tokens.css'].map((n) => readText(path.join(root, n)) || '').join('\n')
}

function screenNotes(key, html, css, mockData) {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim()).length
  // 外框上的表单、跳转由宿主负责，页面脚本仍按整页数。
  const inner = slotHtml(html)
  const forms = (inner.match(/<(input|textarea|select)\b/gi) || []).length
  const inter = []
  if (scripts) inter.push(`${scripts} 段脚本（改成框架里的状态和事件）`)
  if (forms) inter.push(`${forms} 个输入控件（做成受控组件、加校验和出错状态）`)
  if (/data-href=/.test(inner)) inter.push('用 data-href 跳转的元素（改成路由跳转）')
  return {
    inter: inter.length ? `- ${key}：${inter.join('；')}` : '',
    states: statesMd(new Map([[key, html]]), css),
    mock: mockData ? mockNotes(key, html, new Set(Object.keys(mockData.data))) : null,
    back: /\sdata-back\b/i.test(inner),
    hover: (html.match(/:(hover|focus-visible|focus|active)\b/g) || []).length,
  }
}

/**
 * 生成交接包。catalog / selection 共用工具选出的完整清单和本批；screens 兼容旧调用的截图 URL。
 */
export async function buildHandoff(browser, { root, catalog = handoffScreens(root), selection, screens, batch, kind = 'web', size = [1280, 800], framework = 'react', dest = '', project = null, system = '', annotations = null, tuned = [], now = new Date() }) {
  const overrides = new Map((screens || []).filter((sc) => typeof sc === 'object' && sc).map((sc) => [sc.key, sc]))
  const withPreview = (sc) => {
    const custom = overrides.get(sc.key)
    return custom ? { ...sc, url: custom.url || sc.url, label: custom.label || sc.label } : sc
  }
  const pick = selection || handoffBatch(catalog, { batch, names: screens?.map((sc) => typeof sc === 'string' ? sc : sc?.key) })
  if (pick.error) throw new Error(pick.error)
  const list = pick.list.map(withPreview)
  const dir = path.join(root, HANDOFF_DIR)
  const shotDir = path.join(dir, 'shots')
  // handoff/、handoff/shots/ 得是设计目录里真的文件夹：是软链接就可能删到、写到别处去
  for (const d of [dir, shotDir]) {
    let st = null
    try { st = fs.lstatSync(d) } catch { fs.mkdirSync(d) }
    if (st && !st.isDirectory()) throw new Error(`${path.relative(root, d)} 不是普通文件夹（是软链接或文件），先挪走再交接`)
  }
  const htmlByKey = new Map()
  const source = new Map()
  const readFile = dirReader(root)
  const compFiles = new Map()
  const readComponent = (rel) => {
    if (!compFiles.has(rel)) {
      const buf = readFile(rel)
      compFiles.set(rel, { buf, hash: buf ? createHash('sha256').update(buf).digest('hex') : null })
    }
    return compFiles.get(rel).buf
  }
  readComponent.hasCompDir = readFile.hasCompDir // 接不接管 <c-…> 和预览同一套（见 comp-io adopts）
  const components = componentCatalog(readComponent, componentFiles(root)).filter((c) => !c.error)
  const contracts = new Map(components.map((c) => [c.name, {
    screens: [], params: new Set(c.params.map((p) => p.name)), paths: new Set(c.mockPaths),
  }]))
  for (const screen of catalog) {
    const sc = withPreview(screen)
    const raw = readText(path.join(root, sc.key)) ?? ''
    const expanded = expandPreview(raw, readComponent, sc.key)
    if (expanded.comp) {
      for (const name of expanded.used) contracts.get(name)?.screens.push(sc.key)
      collectInstancePaths(raw, contracts)
    }
    const deps = expanded.deps.map((rel) => [rel, compFiles.get(rel)?.hash ?? null])
    const fingerprint = createHash('sha256').update(raw).update('\0').update(JSON.stringify(deps)).digest('hex')
    htmlByKey.set(sc.key, expanded.html)
    source.set(sc.key, { ...sc, ...sourceRow(sc, expanded.html), fingerprint })
  }
  for (const c of components) {
    const contract = contracts.get(c.name)
    c.screens = contract.screens
    c.mockPaths = [...contract.paths].sort()
  }
  const available = !!(list.length && browser?.available())
  const staged = available ? fs.mkdtempSync(path.join(dir, '.shots-')) : ''
  try {
    const rows = available ? await shootScreens(browser, list, size, kind, staged) : list.map((sc) => ({
      ...sc, shots: [], error: '没有 Chrome / Edge，没截图',
    }))
    // 截图完成后再读最新记录，合并到同一份文档。不同批次同时结束也能各自补进去。
    const stateFile = path.join(dir, '.screens.json')
    const state = fs.lstatSync(stateFile, { throwIfNoEntry: false })?.isFile() ? readObj(stateFile) : null
    const saved = new Map(Object.entries(state || {}).filter(([, row]) => row && Array.isArray(row.links) && Array.isArray(row.shots) && Array.isArray(row.notes?.states)))
    const frames = frameCss(root, [...htmlByKey.values()].filter(isFramed))
    const css = screenStyles(root, styleSheets(root, frames))
    const mockData = mockOf(root)
    for (const row of rows) {
      const sc = list.find((x) => x.key === row.key)
      const prior = saved.get(row.key)
      const base = source.get(row.key)
      const notes = screenNotes(row.key, htmlByKey.get(row.key) || '', css, mockData)
      if (row.error) {
        saved.set(row.key, { ...prior, links: prior?.links || [], shots: prior?.shots || [], error: row.error, notes })
        continue
      }
      row.links = [...new Map([...base.links, ...row.links].map((link) => [link.path, link])).values()]
      row.title ||= base.title
      const files = [...row.shots, row.mobile].filter(Boolean)
      for (const shot of files) fs.renameSync(path.join(staged, shot), path.join(shotDir, shot))
      for (const old of [...desktopShots(sc), shotName(sc, 'mobile')]) {
        if (!files.includes(old)) fs.rmSync(path.join(shotDir, old), { force: true })
      }
      saved.set(row.key, {
        title: row.title, links: row.links, shots: row.shots, mobile: row.mobile, more: row.more, notes, fingerprint: base.fingerprint,
      })
    }
    const previousShots = new Set(fs.readdirSync(shotDir, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name))
    const all = catalog.map((sc) => {
      const base = source.get(sc.key)
      const past = saved.get(sc.key)
      const shots = desktopShots(sc).filter((f) => previousShots.has(f))
      const mobile = shotName(sc, 'mobile')
      const fresh = past?.fingerprint === base.fingerprint
      const notes = fresh ? past.notes : past || shots.length ? screenNotes(sc.key, htmlByKey.get(sc.key) || '', css, mockData) : null
      return { ...base, shots, mobile: previousShots.has(mobile) ? mobile : '', notes,
        ...(fresh ? { title: past.title, links: past.links, more: past.more } : {}),
        stale: shots.length > 0 && !fresh, error: past?.error,
      }
    })
    const md = handoffMd({ root, rows: all, kind, size, framework, dest, project, system, annotations, tuned, htmlByKey, batched: true, components, now })
    const file = path.join(dir, 'HANDOFF.md')
    writeHandoffFile(stateFile, JSON.stringify(Object.fromEntries(catalog.filter((sc) => saved.has(sc.key)).map((sc) => [sc.key, saved.get(sc.key)]))))
    writeHandoffFile(file, md)
    const pending = [...new Set(all.filter((sc) => !sc.shots.length || sc.stale || sc.error).map((sc) => sc.batch))]
    return { file, dir, md, shots: rows.reduce((m, r) => m + r.shots.length + (r.mobile ? 1 : 0), 0), rows, pending }
  } finally {
    if (staged) fs.rmSync(staged, { recursive: true, force: true })
  }
}

/** 交接说明 */
export function handoffMd({ root, rows, kind, size, framework, dest, project, system, annotations = null, tuned = [], htmlByKey, batched = false, components = [], now = new Date() }) {
  const fw = FRAMEWORKS[framework] || null
  const same = framework === 'same' && project && project.framework
  const fwLabel = same ? `${project.label}（跟项目一样）` : fw ? fw.label : framework
  const name = path.basename(root)
  const keys = new Set(rows.map((r) => r.key))
  // 做成什么：跟项目一样就是项目的框架；小程序的写法（uni-app / 原生 / Taro）按小程序的规矩写
  const target = framework === 'same' ? (project && project.framework) || '' : framework
  const uni = target === 'uniapp'
  const wx = target === 'weapp'
  const taro = target === 'taro'
  const mini = MINI.has(target)
  const known = isCode(project)
  // 目标目录本来就是这种小程序项目（往里加页面，不新建）
  const hasMini = mini && !!project && project.framework === target
  // 目标目录是别的前端项目（React / Vue 网页、别种小程序）：不往里硬加，在里面另建子项目
  const mismatch = mini && known && !hasMini && !!project.framework
  // 页面、pages.json 在哪个目录：现有项目照它（命令行建的 uni-app、Taro 在 src/）；新建的 uni-app 模板也在 src/
  // Taro 照项目 config/index 的 sourceRoot（默认 src/）
  const at = hasMini ? project.pagesAt || (taro ? 'src/' : '') : uni ? 'src/' : ''
  const cfgFile = uni ? `${at}pages.json` : wx ? `${at}app.json` : `${at}app.config`
  const api = uni ? 'uni' : taro ? 'Taro' : 'wx'
  const route = (k) => (mini ? pagePathOf(k, target) : routeOf(k))
  const keyOfLink = (p) => p === '/' && keys.has('index.html') ? 'index.html' : String(p || '').replace(/^\/+/, '').split(/[?#]/)[0]
  const cell = (s) => String(s).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|')
  const lines = []
  lines.push(`# 交接：${name} → ${fwLabel}`, '')
  lines.push(`> 给写代码的模型看：照这份把设计稿做成真页面。设计稿就是源码——每屏一个 HTML，样式在 tokens.css 等样式表里；元素上的行内 \`style="…"\` 多半是用户在工作台里手调的，值以它为准（做成组件时并进组件的样式）。先读源文件（现在的，别照你之前写过的内容），截图只用来对照，别凭截图猜数值。`, '')
  lines.push('## 做什么', '')
  lines.push(`- 设计目录：\`${root}\`（${rows.length} 屏，${kind} ${size[0]}×${size[1]}）`)
  // 目录里已经有别的东西、又不是 Node 项目（别的语言的仓库、后端……）：别在原地或旁边跑脚手架
  // （纯 HTML 站点再做成纯 HTML 不算：就加在这个站点里，下面第 1 步提醒别覆盖现有页面）
  const occupied = !!(project && !known && project.empty === false) && !(project.site && framework === 'html')
  if (known) lines.push(`- 做到：\`${dest || project.dir}\`（现有项目 ${project.name}：${project.label || '没认出框架'}${project.tailwind ? ' + Tailwind' : ''}${project.ts ? '，TypeScript' : ''}${project.pkg ? `，包管理 ${project.pm}` : '，没有 package.json'}）`)
  else if (occupied) lines.push(`- 做到：\`${dest}\`（目录里已经有别的东西，不是 Node 项目：先看清结构，前端放进它里面新的子目录）`)
  else if (fw && fw.create) lines.push(`- 做到：\`${dest}\`（新建项目：\`${fw.create.replace('{name}', path.basename(dest || name + '-app'))}\`，在 \`${path.dirname(dest || root)}\` 里跑）`)
  else lines.push(`- 做到：\`${dest}\``)
  lines.push(`- 框架：${fwLabel}`)
  if (system) lines.push(`- 设计系统：${system}（设计用的是它的 tokens.css / components.css，项目里也照它）`)
  lines.push(`- 生成时间：${localStamp(now)}`, '')
  if (kind === 'miniprogram' && !mini) {
    // 小程序的设计、选的是网页框架：做成手机网页，别混进小程序的写法
    lines.push('## 小程序设计做成网页（H5）', '')
    lines.push(`- 这是微信小程序的设计（${size[0]} 宽）。框架选的「${fwLabel}」，就做成手机网页：样式照设计稿写 px（宽 ${size[0]} 的移动端页面，带 \`<meta name="viewport" content="width=device-width, initial-scale=1">\`），不用 rpx、不用 \`wx.*\`。用户其实要真小程序的话，用 handoff_design 的 framework: uniapp（uni-app）或 weapp（原生）重新出交接说明。`)
    lines.push('- 设计稿顶上画的状态栏、右上角的胶囊是微信自己画的，网页里不做；导航栏做成页面自己的顶栏。底部标签栏做成固定在底部的导航，留出安全区 `env(safe-area-inset-bottom)`。', '')
  }
  if (mini) {
    const cfg = uni ? `${cfgFile} 的 \`globalStyle\` / 页面的 \`style\`` : taro ? `\`${cfgFile}\` / 页面的 \`.config\`` : `${cfgFile} / 页面 json`
    lines.push('## 小程序要点', '')
    lines.push(taro
      ? `- 尺寸：Taro 会自己把样式里的 px 换成 rpx，按 \`config/index\` 的 \`designWidth\` 算（默认 750）。别改项目的 designWidth（旧页面会跟着变大变小）：照它换算——designWidth 是 750 时设计稿 1px 写 ${Math.round((750 / size[0]) * 100) / 100}px，是 ${size[0]} 就照设计稿写。`
      : `- 尺寸换成 rpx：设计稿 1px = ${Math.round((750 / size[0]) * 100) / 100}rpx（整屏宽 750rpx）。`)
    if (kind === 'miniprogram') {
      // 胶囊位置只有小程序里拿得到；uni-app、Taro 的网页版（拿来逐像素比的）要分开写
      const h5Nav = uni ? '（`getMenuButtonBoundingClientRect` 网页版没有：包在 `// #ifdef MP-WEIXIN` … `// #endif` 里，网页版走 `// #ifdef H5`，顶栏高按 44px、状态栏按 0）'
        : taro ? '（`getMenuButtonBoundingClientRect` 网页版拿不到：用 `process.env.TARO_ENV === \'weapp\'` 分开，网页版顶栏高按 44px、状态栏按 0）' : ''
      lines.push(`- 设计稿顶上画的状态栏不用做，微信自带；右上角的胶囊也是微信画的。导航栏用 ${cfg} 里的默认导航栏，或 \`navigationStyle: custom\` 自己画——自己画时状态栏高用 \`${api}.getWindowInfo().statusBarHeight\`、导航栏高度和右边让开的宽度按 \`${api}.getMenuButtonBoundingClientRect()\` 算（设计稿的 44 / 88 / 101px 只是预览手机的）${h5Nav}。顶栏是深色的（预览里胶囊是白的），页面配置写 \`navigationBarTextStyle: white\`。`)
      lines.push(`- 底部标签栏写进 \`${cfgFile}\` 的 \`tabBar\`（样式特殊就用自定义 tabBar），底部留出安全区 \`env(safe-area-inset-bottom)\`。`)
    }
    if (mismatch) lines.push(`- 目标目录 \`${dest || project.dir}\` 是 ${project.label} 项目，不是 ${fwLabel}：按下面第 1 步在里面另建一个子项目，下面说的路径都相对那个子项目。`)
    lines.push('')
  }
  if (uni) {
    lines.push('## 做成 uni-app', '')
    lines.push(`- 页面：每屏一个 \`${at}pages/<名字>/<名字>.vue\`，在 \`${cfgFile}\` 的 \`pages\` 里登记（第一项是首页），标题、导航栏颜色写在那一页的 \`style\` 里。下面表里的「页面路径」就是要登记的 path。`)
    lines.push('- 标签换成 uni-app 的组件：`div` → `view`，文字 → `text`，`img` → `image`（照设计的裁切写 `mode`，比如 `aspectFill`），输入框、按钮用同名组件；点击写 `@tap`；跳转用 `uni.navigateTo`（标签页 `uni.switchTab`），别用 `<a>` 和 vue-router。')
    lines.push('- 设计变量放进 `App.vue` 的全局样式，选择器写 `page`（小程序里没有 `:root`，网页版也认 `page`）：`page { --color-primary: …; }`，各处用 `var(--…)`。')
    lines.push('- 别用 `window`、`document`、`localStorage`、`fetch`：换成 `uni.getStorageSync`、`uni.request` 这些。')
    if (hasMini) lines.push(`- 先看清项目现有的写法再动手：Vue ${/Vue 2/.test(project.label) ? '2（选项式）' : '3（`<script setup>` 还是选项式）'}、用没用 uni-ui / uView 这些组件库、\`uni.scss\` 里有没有现成的变量，照它来。`)
    if (hasMini && project.hbx) lines.push(project.pkg ? '- 这是 HBuilderX 建的项目：别跑 npm 脚手架；要的依赖照现有 package.json 装，跑起来让用户在 HBuilderX 里点「运行」。' : '- 这是 HBuilderX 建的项目（没有 package.json）：别跑 npm 脚手架、别装依赖；跑起来让用户在 HBuilderX 里点「运行」。')
    lines.push('')
  }
  if (wx) {
    lines.push('## 做成原生小程序', '')
    lines.push(`- 页面：每屏一个目录 \`${at}pages/<名字>/\`，四个文件 \`<名字>.wxml / .wxss / .js / .json\`，在 \`${cfgFile}\` 的 \`pages\` 里登记（第一项是首页）；公共样式写 \`${at}app.wxss\`。下面表里的「页面路径」就是要登记的。`)
    if (!hasMini) lines.push('- 这里还没有小程序：先手搭最小骨架——`app.json`、`app.js`（`App({})`）、`app.wxss`、`sitemap.json`，`project.config.json` 里写 `"compileType": "miniprogram"`、`appid` 用户有就填，没有先写 `touristappid`（游客模式）。别找 npm 脚手架。')
    lines.push('- HTML 换成 WXML：`div` → `view`，文字 → `text`，`img` → `image`（照设计的裁切写 `mode`），点击 `bindtap`，列表 `wx:for`，条件 `wx:if`；跳转 `wx.navigateTo`（标签页 `wx.switchTab`）；页面数据放 `Page({ data })`，用 `this.setData` 改。设计稿里的脚本照这个改写。')
    lines.push(`- 设计变量写在 \`${at}app.wxss\` 的 \`page { … }\` 上（WXSS 没有 \`:root\`），各页用 \`var(--…)\`。`)
    lines.push('- WXSS 只用常见的选择器（class、id、标签、后代 / 子代、`::before` / `::after`）；`*` 通配、属性选择器、`:hover` 别用——按下的样式用组件的 `hover-class`。')
    lines.push('')
  }
  if (taro) {
    lines.push('## 做成 Taro', '')
    lines.push(`- 源码目录是 \`${at}\`（项目 \`config/index\` 里的 \`sourceRoot\`${at === 'src/' ? '，默认 src；那里写的不是 src 就照它' : ''}）。页面放 \`${at}pages/<名字>/index\`（\`.tsx\` 还是 \`.vue\` 看项目用 React 还是 Vue），在 \`${cfgFile}\`（\`.ts\` 或 \`.js\`，看项目）的 \`pages\` 里登记；组件用 \`@tarojs/components\` 的 \`View\`、\`Text\`、\`Image\`；跳转 \`Taro.navigateTo\`（标签页 \`Taro.switchTab\`）。`)
    lines.push(`- 设计变量写在 \`${at}app\` 的全局样式里，选择器写 \`page, .taro_page { … }\`：小程序认 \`page\`（没有 \`:root\`），网页版的页面容器是 \`.taro_page\`（\`page\` 在网页版不生效）；各处用 \`var(--…)\`。先看清项目现有的写法、组件库（Taro UI、NutUI 之类）再动手。`)
    lines.push('')
  }

  if (kind === 'desktop') {
    lines.push('## 桌面软件要点', '')
    lines.push(`- 这是桌面软件的设计（窗口内容 ${size[0]}×${size[1]}）。要做成真软件：Electron 或 Tauri 套网页，框架选的「${fwLabel}」写界面；用户要原生（SwiftUI / WinUI）就先问清。`)
    lines.push('- 窗口按钮是系统画的：Mac 用无边框标题栏（Electron `titleBarStyle: \'hiddenInset\'`，Tauri `titleBarStyle: \'Overlay\'`），红绿灯盖在左上角，设计稿左上空出的 80×52 照留；顶栏可拖动的地方加 `-webkit-app-region: drag`，按钮、输入框加 `no-drag`。Windows 用自定义标题栏时右上角 138×32 留给系统按钮（Electron `titleBarOverlay`）。')
    lines.push('- 整个窗口不滚，侧栏、列表、详情各自滚（`overflow: auto`）；最小窗口尺寸照设计里最小的那种（多尺寸里的 1024×680）设。', '')
  }

  // 套了外框（DSH 插件、外框库）：外框是宿主画的，只做槽位里的（#25）
  const framedKeys = [...(htmlByKey || new Map())].filter(([, x]) => isFramed(x)).map(([k]) => k)
  const plainKeys = [...(htmlByKey || new Map()).keys()].filter((k) => !framedKeys.includes(k))
  const framedHtml = framedKeys.map((k) => htmlByKey.get(k))
  const frameSheets = frameCss(root, framedHtml)
  const fsNames = frameSheets.map((n) => `\`${n}\``).join('、')
  if (framedHtml.length) { // 按这次交接的屏里真有外框才写（DSH 插件项目里只交接普通欢迎页就不写）
    const dsh = kind === 'dshplugin' || framedHtml.some((x) => /\bdata-frame\s*=\s*["']?dsh\//i.test(x))
    const host = dsh ? 'DSH 桌面端' : '那个软件 / 浏览器'
    lines.push('## 外框要点', '')
    const short = (ks) => ks.map((k) => k.replace(/\.html?$/i, '')).join('、')
    const which = framedKeys.length && plainKeys.length ? `${short(framedKeys)} 这几屏` : '这几屏'
    lines.push(`- ${which}套了${dsh ? ' DSH 插件的' : '外框库里的'}外框：外框（${dsh ? '侧栏、标题栏、设置弹窗这些' : '窗口、工具栏这些'}）是${host}自己画的，**不用做**。只做每屏 \`data-slot\` 里面的：\`main\` 是主体，做成页面 / 组件；\`entry-icon\`、\`entry-label\`、\`tab-label\` 这类小槽位是${host}入口上的图标和字，照${dsh ? ' DSH 插件的注册接口' : '它的插件清单 / 配置'}填，不做成页面。${framedKeys.length && plainKeys.length ? `别的屏（${short(plainKeys)}）没套外框，照常整页做。` : ''}`)
    lines.push(`- 外框的样式表（${fsNames || '从外框库复制来的那几个'}）：外框部件的样式（外框自己的 class）和外框用的图不搬；但里面的变量（\`--\` 开头的，浅色、深色两段）和槽位 \`main\` 的基础样式（字号、字色、背景）要带进项目——槽位里的内容用着它们（真插件里也可以换成宿主自己的同名变量）。tokens.css 有的话照搬。`)
    lines.push('- 开发服务器上的页面就是 `main` 这一块本身，铺满窗口，别自己再画一圈外框。`compare_design` 会自动只截设计稿里 `main` 那块，按它的尺寸打开你的页面来比；只有项目里自己也套了同一个外框、整屏和设计稿一样大时，才传 `whole: true` 整屏比。', '')
  }

  lines.push(mini ? '## 屏幕和页面' : '## 屏幕和路由', '', `| 屏 | 设计文件 | ${mini ? '页面路径' : '建议路由'} | 截图（handoff/shots/） | 跳到 |`, '| --- | --- | --- | --- | --- |')
  for (const r of rows) {
    const to = [...new Set((r.links || []).map((l) => keyOfLink(l.path)).filter((k) => k && k !== r.key))]
    const files = [...r.shots, r.mobile].filter(Boolean).join('、')
    const waiting = batched && r.stale ? `截图已过期，第 ${r.batch} 批重截` : batched && !r.shots.length ? `第 ${r.batch} 批截` : ''
    const shots = [files, waiting, r.error ? `没截成（${r.error}）` : '', r.more ? `（还有 ${r.more} 段没截）` : ''].filter(Boolean).join(' · ')
    const links = to.map((k) => (keys.has(k) ? k.replace(/\.html?$/i, '') : `${k}（没有这一屏）`)).join('、') || '—'
    lines.push(`| ${cell(r.title || r.label || r.key)} | ${cell(r.key)} | \`${mini ? route(r.key) : r.route ?? route(r.key)}\` | ${cell(shots)} | ${cell(links)} |`)
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
    lines.push(mini
      ? `- 把 tokens.css 里的变量搬进${uni ? ' `App.vue` 全局样式' : wx ? ` \`${at}app.wxss\`` : '全局样式'}的 \`${taro ? 'page, .taro_page' : 'page'} { … }\`（小程序没有 \`:root\`）；组件样式里一律用 \`var(--…)\`，别写死色值、字号。`
      : project && project.tailwind
      ? '- 把 tokens.css 原样放进项目的全局样式并在入口引入；Tailwind 的 theme.extend 里把颜色、圆角、字号、阴影映射到这些变量（如 `primary: \'var(--color-primary)\'`），类名里别写死色值。'
      : '- 把 tokens.css 原样放进项目的全局样式（如 `src/styles/tokens.css`）并在入口引入；组件样式里一律用 `var(--…)`，别写死色值、字号。')
  } else if (hasTokens) lines.push('- `tokens.css` 的第一段 `:root` 里没读到变量：先打开看看，把各屏用到的颜色、字号收成 `:root` 上的变量再动手。')
  else {
    if (frameSheets.length) lines.push(`- 没有 tokens.css：套外框的屏用的是外框样式表（${fsNames}）里的变量，照上面「外框要点」带进项目。`)
    // 没套外框的屏（或者认不出外框样式表）：页面里自己写的变量照旧收
    if (!frameSheets.length || plainKeys.length) lines.push(`- 设计目录里没有 tokens.css：先把${frameSheets.length ? '没套外框那几屏' : '各屏'} \`<style>\` 里 \`:root\` 上的变量收成一份 tokens.css 再动手。`)
  }
  // 外框的样式表不算公共样式（上面「外框要点」说了怎么带）
  const sheets = styleSheets(root, frameSheets)
  if (sheets.length) lines.push(`- 别的样式表：${sheets.map((n) => `\`${n}\``).join('、')}（公共样式，拆进对应组件或全局样式）`)
  lines.push('')

  // 共用部分
  const parts = sharedParts(htmlByKey)
  lines.push('## 几屏共用的部分（做成组件）', '')
  // 小程序设计的骨架（技能里的 .mp-status / .mp-nav / .mp-tabbar …）是在模拟微信自己画的东西：照微信的做法，别做成组件
  const tabCfg = `\`${cfgFile}\``
  const chrome = kind !== 'miniprogram' ? {} : mini
    ? { 'mp-status': '预览手机的状态栏，不做（微信自带）', 'mp-top': '状态栏 + 导航栏的外壳：照上面「小程序要点」用默认导航栏，或自己画导航', 'mp-nav': '导航栏：纯色底就用默认导航栏（标题、颜色写进页面配置）；渐变、图片、搜索框这种才做自定义导航组件', 'mp-back': '返回按钮：默认导航栏自带', 'mp-tabbar': `底部标签栏：写进 ${tabCfg} 的 \`tabBar\`（样式特殊才做自定义 tabBar）` }
    : { 'mp-status': '预览手机的状态栏，网页里不做', 'mp-top': '→ 页面顶栏组件', 'mp-tabbar': '→ 固定在底部的导航组件' }
  if (parts.length) for (const p of parts) lines.push(chrome[p.cls] ? `- \`.${p.cls}\`：${chrome[p.cls]}` : `- \`.${p.cls}\`：${p.n} 屏都有（${p.screens.map((k) => k.replace(/\.html?$/i, '')).join('、')}）→ \`${pascal(p.cls)}\` 组件`)
  else lines.push('- 没找到几屏共用的结构；按页面拆就行。')
  if (fs.existsSync(path.join(root, 'icons.svg'))) {
    let n = 0
    try { n = (fs.readFileSync(path.join(root, 'icons.svg'), 'utf8').match(/<symbol\b/g) || []).length } catch { n = 0 }
    lines.push(mini
      ? `- \`icons.svg\`：${n} 个图标（<symbol id>）→ 小程序的模板里不能直接写 \`<svg>\`，本地 .svg 文件用 \`<image>\` 显示也不是每个版本都稳：导出成 PNG（3 倍图）用 \`<image>\`，或者把 SVG 写成 \`data:image/svg+xml\` 放进 \`background-image\`（要换颜色就改里面的 fill），或做成图标字体`
      : `- \`icons.svg\`：${n} 个图标（<symbol id>）→ 一个 \`Icon\` 组件按 id 取，或拆成单个 SVG 组件`)
  }
  lines.push('')

  if (components.length) {
    lines.push('## 组件', '', '- 每个组件实现为一个代码文件，多个路由引用同一个组件文件，别每屏复制。', '')
    const listed = (values = []) => values.map((v) => `\`${v}\``).join('、') || '无'
    for (const c of components) {
      const code = pascal(c.name)
      const file = wx ? `components/${c.name}/${c.name}.js` : `components/${code}.${uni || target === 'vue' ? 'vue' : target === 'html' ? 'js' : 'tsx'}`
      const params = (c.params || []).map((p) => `\`${p.name}\`（${p.required ? '必填' : '选填'}${p.def != null ? `，默认 \`${JSON.stringify(p.def)}\`` : ''}）`)
      lines.push(`### ${code}`, '',
        `- 设计文件 \`${c.file}\` → ${wx ? '小程序 component 入口' : '组件文件'} \`${file}\``,
        `- 参数 ${params.join('、') || '无'}`,
        `- 插槽 ${c.slot ? '一个默认插槽' : '无'}`,
        `- \`data-status\` ${listed(c.statuses)}`,
        `- \`data-variant\` ${listed(c.variants)}`,
        `- 用在 ${listed(c.screens)}`,
        `- 读取 mock 字段 ${listed(c.mockPaths)}`, '')
    }
  }

  // 用户在工作台里亲手改过的（#28）：模型做组件时常照样式表里的那条规则来，手调写在行内的值就丢了
  const hand = (tuned || []).filter((v) => v && TUNED.test(String(v.label || ''))).slice(0, 12)
  if (hand.length) {
    lines.push('## 用户手调过的（以这些为准）', '')
    for (const v of hand) {
      const d = new Date(v.at)
      const p = (x) => String(x).padStart(2, '0')
      const files = (v.changed || []).slice(0, 4).join('、') + ((v.changed || []).length > 4 ? ` 等 ${v.changed.length} 个文件` : '')
      lines.push(`- ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${v.label}${files ? `（${files}）` : ''}`)
    }
    lines.push('- 这些是用户在右侧栏亲手改的，文件里已经是改过的样子：照文件现在的内容做；写在行内 style 上的值要带进对应的组件，别按样式表里的旧值做。', '')
  }

  // 交互和状态
  lines.push('## 交互和状态', '')
  const css = screenStyles(root, sheets)
  const mock = mockOf(root)
  const notes = batched ? rows.map((r) => r.notes).filter(Boolean) : [...htmlByKey].map(([key, html]) => screenNotes(key, html, css, mock))
  const inter = notes.map((n) => n.inter).filter(Boolean)
  if (inter.length) lines.push(...inter)
  else lines.push(batched && notes.length < rows.length ? '- 已分析的屏没有脚本和表单。' : '- 设计稿里没有脚本和表单，纯展示。')
  lines.push(...notes.flatMap((n) => n.states))
  lines.push(...mockMd(htmlByKey, root, notes.map((n) => n.mock)))
  if (notes.some((n) => n.back)) lines.push('- 写了 `data-back` 的返回按钮：做成「返回上一页」（router.back() / navigation.goBack()），没有上一页时才去它写的 href。')
  const hover = (css.match(/:(hover|focus-visible|focus|active)\b/g) || []).length + notes.reduce((sum, n) => sum + n.hover, 0)
  if (hover) lines.push(`- 悬停 / 聚焦 / 按下的样式 ${hover} 处：照搬，别丢。`)
  if ([...htmlByKey.values()].some((h) => /prefers-color-scheme\s*:\s*dark|data-theme=["']?dark/.test(h)) || /\[data-theme=["']?dark/.test(Object.keys(tok).length ? fs.readFileSync(path.join(root, 'tokens.css'), 'utf8') : '')) lines.push('- 有深色样式：项目里也要能切（跟系统，或 `<html data-theme="dark">`）。')
  const tw = readTweaks(root)
  if (tw && tw.list.length) lines.push(`- 调节滑块（tweaks.json）：${tw.list.map((k) => `${k.label}（${k.var || k.attr}，现在是 ${shownValue(k, k.value)}）`).join('、')}。最终值已经写在样式里；要在产品里留着可调，就做成主题设置（改同一个 CSS 变量 / <html> 属性）。`)
  lines.push('')

  // 业务规则（业务标注开着才有）
  const knownScreens = annotations ? (batched ? keys : new Set(allScreens(root))) : null
  lines.push(...annotationsMd(annotations, new Set(htmlByKey.keys()), knownScreens))

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
  lines.push(assets.length ? `- ${assets.slice(0, 30).map((a) => `\`${a}\``).join('、')}${assets.length > 30 ? ' …' : ''}：照原样复制进项目的静态资源目录（${mini ? (uni ? `\`${at}static/\`` : taro ? `\`${at}assets/\`` : `\`${at}images/\` 之类`) : 'public/ 或 src/assets/'}）` : '- 没有单独的图片、字体文件（图形都写在 HTML / SVG 里）。')
  const aiPhotos = assets.filter((x) => isPhotoAsset(x))
  if (aiPhotos.length) lines.push(`- 文件名带 \`${PHOTO_PREFIX}\` 的 ${aiPhotos.length} 张是 AI 生成的示意图：先照常接上，做完提醒用户上线前换成真实照片。`)
  const libFonts = assets.filter((x) => isLibFontRel(x))
  if (libFonts.length) {
    const idx = loadFontIndex()
    const names = libFonts.map((x) => { const id = path.posix.basename(x, '.woff2'); const f = idx && idx.fonts.find((y) => y.id === id); return f ? `${f.zh}（${f.source}）` : id })
    lines.push(`- \`dsh-fonts/\` 里的 ${libFonts.length} 款是设计台字体库的字体（SIL OFL 1.1，可商用；中文只裁了常用 6763 字的网页版）：先照原样接上（样式里的 @font-face 跟着搬，路径按新位置改），提醒用户上线前可以换官方完整版：${names.join('；')}。`)
  }
  if (mini) lines.push(`- 小程序主包不能超过 2MB：大图放服务器用网址；字体文件要用 \`${api}.loadFontFace\` 从网址加载，加载不了就用系统字体。`)
  lines.push('')

  // 做法
  // 在认不出前端框架的项目（后端）或 monorepo 里选了个空的新文件夹：就在这里新建前端项目，不用再看结构、另套一层
  const fresh = !!(project && project.pkg && (!project.framework || project.mono) && dest && fold(realish(dest)) !== fold(realish(project.dir)) && !hasStuff(dest))
  // 「跟项目一样」新建子包时照项目的框架；装依赖用项目的包管理器（create-next-app 自己装依赖，换成对应的 --use-xxx）
  // 只认得出是普通 React / Vue / Next.js 时才套现成的脚手架命令（Nuxt 也算 vue，但不能用 Vue + Vite 的命令搭）
  const PLAIN = { react: 'React', vue: 'Vue', next: 'Next.js' }
  const fwNew = fw || (fresh && same && PLAIN[project.framework] === String(project.label || '').replace(/ \+ Vite$/, '') ? FRAMEWORKS[project.framework] : null)
  const pm = fresh && project.pm && project.pm !== 'npm' ? project.pm : ''
  const create = (!known || fresh) && !occupied && fwNew && fwNew.create ? fwNew.create.replace('{name}', path.basename(dest || name + '-app')).replace('--use-npm', pm ? `--use-${pm}` : '--use-npm') : ''
  lines.push('## 做法和验收', '')
  // 现有项目但没认出前端框架（后端、monorepo 根目录、别的语言的仓库）/ 像 monorepo 根目录：页面该放哪让模型看清结构再定，别直接往根目录塞
  const bare = !create && framework !== 'html' && framework !== 'same' && !!(project && ((project.pkg && !project.framework) || occupied))
  const sub = fw && fw.create ? fw.create.replace('{name}', 'web') : ''
  const mono = !create && !fresh && !!(project && project.mono)
  const keep = project && project.empty === false ? '；目录里已经有文件：别覆盖现有的页面，重名的先问用户' : ''
  const tokTail = (mini ? `；tokens.css 里的变量搬进全局样式的 \`${taro ? 'page, .taro_page' : 'page'} { }\`${sheets.length ? '，公共样式表也拆进去' : ''}`
    : hasTokens || !frameSheets.length ? `；把 tokens.css${sheets.length ? '（和公共样式表）' : ''}搬进去` : sheets.length ? '；把公共样式表搬进去' : '')
    + (frameSheets.length ? `；外框样式表（${fsNames}）里的变量和槽位基础样式照「外框要点」带进去` : '')
  const step1 = create ? `新建项目 \`${create}\`${fresh ? `（在 \`${path.dirname(dest)}\` 里跑）` : ''}，${pm ? `用 ${pm} ` : ''}装好依赖${fwNew.router ? `和 ${fwNew.router}` : ''}${uni ? '（GitHub 连不上就从 gitee 下载模板压缩包 `https://gitee.com/dcloud/uni-preset-vue/repository/archive/vite-ts.zip`，解开当项目目录）' : ''}`
    : framework === 'html' ? `整理成一个静态站点目录（每屏一个页面，公共样式一份）${keep}`
    : fresh ? `在这个空文件夹里新建一个 ${fwLabel.replace('（跟项目一样）', '')} 子项目，照仓库里别的子包怎么搭的来（monorepo 记得加进 workspace）${pm ? `，用 ${pm} 装依赖` : ''}`
    : bare ? `这个目录里已经有东西，但没认出前端框架（可能是后端、monorepo 根目录或别的语言的仓库）：先看清它的结构和用途再定放哪——适合直接加页面就加；不适合就在里面另建一个前端（monorepo 放进 apps/ 之类的子包，别的放进新的子目录${sub ? `，比如在里面跑 \`${sub}\`` : wx ? '，比如 `miniprogram/`，照上面搭骨架' : ''}），用 ${fw ? fw.label : framework} 搭，别打乱现有代码`
    : mismatch ? `这个目录是 ${project.label} 项目，不是 ${fwLabel}：别往里面硬加——在里面另建一个子目录（比如 \`${uni ? 'uni-app' : 'miniprogram'}/\`）${uni ? `，在里面跑 \`${FRAMEWORKS.uniapp.create.replace('{name}', 'uni-app')}\` 新建 uni-app 项目再装依赖` : '，照上面「做成原生小程序」搭骨架'}，现有代码别动`
    : wx && !hasMini ? `在 \`${dest}\` 里照上面「做成原生小程序」搭好骨架${keep}`
    : mini ? `在现有项目里加页面：放进 \`${at}pages/\`，登记进 \`${cfgFile}\`（看清它现有的目录结构、写法、组件库再动手）`
    : '在现有项目里加页面和路由（看清它现有的目录结构、样式写法、组件库再动手）'
  lines.push(`1. 搭骨架：${step1}${mono && !bare ? '（这像是 monorepo 根目录：先看根目录和 apps/ 之类的子包里有没有现成的前端应用，有就加进去；没有再新建一个子包，别把页面散放在根目录）' : ''}${tokTail}。`)
  lines.push(mini
    ? `2. 一屏一个页面，照上面的表登记页面路径；先抽几屏共用的组件（${wx ? '做成自定义组件，放 `components/`' : '放 `components/`'}），再拼页面。`
    : '2. 一屏一个页面，路由照上面的表；先抽几屏共用的组件，再拼页面。')
  lines.push(`3. 结构、文案、数字、图标照设计稿的 HTML 搬${mini ? `（标签换成${wx ? ' WXML ' : '小程序'}的组件）` : ''}；class 名可以改成项目的习惯，样式值（间距、字号、颜色、圆角、阴影）一律用设计变量${mini && !taro ? '，尺寸按上面换成 rpx' : ''}。`)
  if (wx) {
    lines.push('4. 每做完一屏：原生小程序在浏览器里跑不起来，`compare_design` 比不了——让用户用微信开发者工具「导入项目」打开这个目录（没有 AppID 就用测试号 / 游客模式）看这一屏，截图发回来，和 handoff/shots/ 里的截图对照着改。')
    lines.push('5. 全部做完：告诉用户做了哪些页面、在微信开发者工具里导入哪个目录、还有哪里和设计稿不一样。')
  } else if (mini) {
    const h5 = uni && hasMini && project.hbx ? '让用户在 HBuilderX 里点「运行 → 运行到浏览器」' : '后台跑 `npm run dev:h5`'
    // 现有的命令行项目不一定配了网页版
    const noH5 = hasMini && !project.hbx ? `（package.json 里没有 \`dev:h5\` 就是没配网页版：先问用户要不要加；不加就请用户在微信开发者工具里看这一屏，照截图对）` : ''
    lines.push(`4. 每做完一屏：先跑网页版（${h5}）${noH5}，调 \`compare_design\`（screen 填设计文件名，url 填这一屏在网页版上的地址，比如 \`http://localhost:5173/#/${route(rows[0] ? rows[0].key : 'index')}\`），照差异图把不一样的地方改掉，直到差异在 3% 以内，或者剩下的差别说得出理由（网页版顶上是 ${uni ? 'uni-app' : 'Taro'} 画的导航栏、没有状态栏和胶囊，这块不一样是正常的）。`)
    lines.push(`5. 全部做完：每屏再对一遍；告诉用户做了哪些页面、网页版怎么跑起来、微信小程序怎么出（${uni && hasMini && project.hbx ? 'HBuilderX「运行 → 运行到小程序模拟器 → 微信开发者工具」' : uni ? '`npm run dev:mp-weixin`，再用微信开发者工具打开 `dist/dev/mp-weixin`' : '`npm run dev:weapp`，再用微信开发者工具打开项目目录'}）、还有哪里和设计稿不一样。`)
  } else {
    lines.push('4. 每做完一屏：把开发服务器跑起来，调 `compare_design`（screen 填设计文件名，url 填这一屏在开发服务器上的地址），照差异图把不一样的地方改掉，直到差异在 3% 以内，或者剩下的差别说得出理由（比如真实数据、系统字体）。')
    lines.push('5. 全部做完：每屏再对一遍；告诉用户做了哪些页面、怎么跑起来（命令和地址）、还有哪里和设计稿不一样。')
  }
  lines.push('', '别做：改设计（配色、文案、布局）、加设计稿里没有的功能、引入新的 UI 组件库（项目已经在用的除外）。', '')
  return lines.join('\n')
}

// ── compare_design：设计稿 vs 做出来的页面 ─────────────────────────────────────

// 页面上看得见的「块」（有字的、图片、按钮、有底色或边框的），差异区域按它说是哪个元素
const blocksIn = (root) => `(() => {
  const out = []
  const W = innerWidth, H = innerHeight
  const root = ${root}
  for (const el of root ? root.querySelectorAll('*') : []) {
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
const BLOCKS = blocksIn('document.body')

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
export async function diffIn(a, b, labels) {
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
  // 差异照样逐点算（1px 的线也不能漏）；热力图大图按 st×st 一格画（#21：省掉一张全尺寸的图），格子里有一点不一样就标红
  const st = Math.max(1, Math.round(Math.sqrt((w * h) / 1e6)))
  const hw = Math.ceil(w / st), hh = Math.ceil(h / st)
  const heat = g.createImageData(hw, hh)
  let bad = 0
  for (let y = 0; y < h; y++) {
    const hy = (y / st) | 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = (hy * hw + ((x / st) | 0)) * 4
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
      const hit = d > 24
      const l = (da[i] * 0.3 + da[i + 1] * 0.59 + da[i + 2] * 0.11) * 0.3 + 175
      if (hit) { bad++; cells[((y / CELL) | 0) * cw + ((x / CELL) | 0)]++ }
      if (hit) { heat.data[j] = 232; heat.data[j + 1] = 56; heat.data[j + 2] = 48; heat.data[j + 3] = 255 }
      else if (y % st === 0 && x % st === 0 && !heat.data[j + 3]) { heat.data[j] = l; heat.data[j + 1] = l; heat.data[j + 2] = l; heat.data[j + 3] = 255 }
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
  hc.width = hw
  hc.height = hh
  hc.getContext('2d').putImageData(heat, 0, 0)
  const pct = (bad / (w * h)) * 100
  ;[[A, labels[0]], [B, labels[1]], [hc, labels[2].replace('{pct}', pct.toFixed(1))]].forEach(([img, label], k) => {
    const x = PAD + k * (w + PAD)
    o.fillStyle = '#1f2329'
    o.font = '600 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    o.fillText(label, x, 30)
    o.drawImage(img, x, HEAD, w, h) // 热力图是取样大小、做出来的截图可能不一样大：都画成设计稿那么大
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

/**
 * 本地 HTML 经预览服务器开时，服务器的根放哪、页面在根下的地址。
 * 默认就是 HTML 所在的文件夹（Vite 打包的 /assets 根路径要这样才对）；
 * 页面引用了上级目录（../css/app.css）就往上提几层，最多 3 层，不然那些资源 404、页面没样式。
 * 往上提有边：只在会话目录里提、不出会话目录（会话目录外的 HTML 不提）；无论如何不提到家目录（及更上面）——预览服务器能读的范围别一下变大。
 * @returns { root, rel } rel 已按段编码，以 / 开头
 */
export function implServe(file, limit = '') {
  let up = 0
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('link') // 软链接不读（可能指到目录外面）：按所在文件夹
    const fd = fs.openSync(file, 'r')
    let html = ''
    try { const buf = Buffer.alloc(1024 * 1024); html = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)) } finally { fs.closeSync(fd) }
    const re = /(?:\b(?:src|href|srcset|poster|data)\s*=\s*["']?|url\(\s*["']?|\bimport\s*(?:[^'"]*from\s*)?["']|\bimport\(\s*["'])((?:\.\.\/)+)/gi
    let m
    while ((m = re.exec(html))) up = Math.max(up, m[1].length / 3)
  } catch { /* 读不了就按所在文件夹 */ }
  let root = path.dirname(file)
  const home = os.homedir()
  const cap = limit && within(file, limit) ? limit : ''
  if (!cap) up = 0
  for (let i = 0; i < Math.min(up, 3); i++) {
    const p = path.dirname(root)
    if (p === root || within(home, p) || (cap && !within(p, cap))) break
    root = p
  }
  const rel = path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/')
  return { root, rel: '/' + rel }
}

/** 做出来的页面地址：本机的 http(s)，或本地 HTML 文件 */
export function implUrl(input, cwd) {
  const s = String(input || '').trim()
  const bad = () => new Error(`认不出这个地址：${s.slice(0, 80)}（端口是 1–65535 的数）`)
  const web = (x) => { try { return new URL(x) } catch { throw bad() } }
  if (/^\d{2,5}$/.test(s)) {
    if (Number(s) < 1 || Number(s) > 65535) throw bad()
    return `http://localhost:${Number(s)}/`
  }
  if (/^https?:\/\//i.test(s)) {
    const u = web(s)
    if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) throw new Error('只比本机的页面（localhost 地址或本地 HTML 文件）')
    return u.href
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return web('http://' + s).href
  // 本地 HTML：路径（相对的按会话目录算，~/ 是家目录）或记下来的 file:// 地址；给文件夹就用里面的 index.html
  // 网络共享（\\server\share、//server/share）不比：只比这台电脑上的
  if (/^(\\\\|\/\/)/.test(s) || /^file:\/\/[^/]/i.test(s)) throw new Error('只比这台电脑上的页面（网络共享里的文件不比）')
  let p
  let tail = '' // file:// 地址带的 ?参数 和 #路由：原样留着
  try {
    if (/^file:\/\//i.test(s)) {
      const u = new URL(s)
      tail = u.search + u.hash
      p = fileURLToPath(u)
    } else {
      p = path.resolve(cwd || '.', s.replace(/^~(?=[\\/]|$)/, os.homedir()))
      // 路径后面带了 #路由 / ?参数（dist/index.html#/login）：文件按前半截找
      const m = !fs.existsSync(p) && s.match(/^([^?#]+)([?#].*)$/)
      if (m) { p = path.resolve(cwd || '.', m[1].replace(/^~(?=[\\/]|$)/, os.homedir())); tail = m[2] }
    }
  } catch { throw new Error(`认不出这个地址：${s.slice(0, 80)}`) }
  if (process.platform === 'win32' && /^\\\\/.test(p)) throw new Error('只比这台电脑上的页面（网络共享里的文件不比）')
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}`)
  if (fs.statSync(p).isDirectory()) {
    const idx = path.join(p, 'index.html')
    if (!fs.existsSync(idx)) throw new Error(`${p} 是文件夹，里面没有 index.html：给页面的 HTML 文件或开发服务器地址`)
    p = idx
  } else if (!/\.html?$/i.test(p)) throw new Error(`只比网页：给 .html 文件或开发服务器地址（${path.basename(p)} 不是）`)
  return pathToFileURL(p).href + tail
}

/**
 * 比一屏：设计稿（预览服务器上的地址，带设计台脚本）vs 做出来的页面，同样尺寸、同样滚动位置。
 * @returns { pct, boxes: [{ x, y, w, h, design, impl }], jpg, text }
 */
export async function compareScreens(browser, { design, impl, shown = '', size, at = 'top', dark = false, whole = false }) {
  const [w, h] = size
  // 两边一样准备：等画好 → 深色 → 滚到同一个位置（页面和里面能滚的区域都滚）→ 无损截图
  // 设计稿套了外框（whole 没要整屏）：只截槽位 main，做出来的页面按槽位的尺寸开
  let blocked = []
  let slot = null
  const shoot = (url, isDesign, [vw, vh]) => browser.withPage({ url, w: vw, h: vh, dark, allow: isDesign ? null : localOnly }, async (page) => {
    if (!isDesign && page.blocked) blocked = page.blocked
    if (isDesign) await prepare(page, dark)
    else {
      await page.eval(SETTLE)
      // 跳外网被拦下后停在了出错页：比它没意义
      if (blocked.length && (await page.eval('location.protocol').catch(() => '')) === 'chrome-error:') throw new Error('blocked')
      if (dark) await page.eval(IMPL_DARK)
    }
    if (at === 'bottom') await page.eval(SCROLL_END)
    if (isDesign && !whole) slot = await page.eval(SLOT_BOX).catch(() => null)
    const cut = isDesign && slot && !slot.hidden
    const png = await page.shot({ format: 'png', ...(cut ? { clip: { x: slot.x, y: slot.y, width: slot.w, height: slot.h } } : {}) })
    // 套了外框只收槽位里面的元素（外框、被弹窗压在底下的都不算），挪成以槽位左上角为原点
    let blocks = await page.eval(cut ? blocksIn(FRAME_MAIN) : BLOCKS).catch(() => [])
    if (cut) blocks = blocks.filter((b) => b.x < slot.vx + slot.w && b.x + b.w > slot.vx && b.y < slot.vy + slot.h && b.y + b.h > slot.vy).map((b) => ({ ...b, x: b.x - slot.vx, y: b.y - slot.vy }))
    const pageH = cut ? 0 : await page.eval('Math.max(document.documentElement.scrollHeight, innerHeight)').catch(() => 0)
    return { png, blocks, pageH, blocked: page.blocked ? page.blocked.slice() : [] }
  })
  // 一个接一个截：同时开两个页面时系统字体（中文）偶尔还没画好就截了，差异会虚高
  // 刚写完文件就比：预览服务器的「改了自动刷新」可能在截图途中把页面刷新一次（页面没了）→ 重截一次
  const again = (fn) => fn().catch((e) => (!blocked.length && /navigated or closed/i.test(e.message) ? fn() : Promise.reject(e)))
  const A = await again(() => shoot(design.url, true, [w, h]))
  if (slot && slot.hidden) return { pct: null, boxes: [], jpg: null, text: `没比：${design.label || design.key} 套了外框，按 ${w}×${h} 开时外框里的 main 槽位露不出来。size 填外框自己的尺寸 ${slot.fw}x${slot.fh} 再比。` }
  const B = await again(() => shoot(impl, false, slot ? [slot.w, slot.h] : [w, h])).catch((e) => {
    // 页面自己跳到外网被拦下、截图时页面没了：说清楚是跳走了
    if (blocked.length) throw new Error(`做出来的页面跳到了本机以外的地址，拦下了：${blocked[0].slice(0, 120)}`)
    throw e
  })
  const labels = ['设计稿', '做出来的', '差异 {pct}%']
  const r = await browser.withPage({ url: 'about:blank', w: 200, h: 200 }, (page) => page.eval(`(${diffIn})(${JSON.stringify(A.png.toString('base64'))}, ${JSON.stringify(B.png.toString('base64'))}, ${JSON.stringify(labels)})`))
  const boxes = r.boxes.map((bx) => ({ ...bx, design: blockAt(A.blocks, bx), impl: blockAt(B.blocks, bx) }))
  const where = slot ? `只比外框里的 main 槽位 ${slot.w}×${slot.h}，做出来的页面按这个尺寸开；外框是宿主画的，不算差异` : `${w}×${h}`
  const lines = [`${design.label || design.key}（${where}${at === 'bottom' ? '，滚到底' : '，顶上一屏'}）：设计稿 vs ${shown || impl}`]
  if (slot && slot.part) lines.push(`注意：这个尺寸（${w}×${h}）装不下整个外框，槽位只露出 ${slot.w}×${slot.h}，做出来的页面也只按这么大开；size 填外框自己的尺寸 ${slot.fw}x${slot.fh} 再比。`)
  lines.push(`差异 ${r.pct.toFixed(1)}%（逐像素无损比）${r.pct < 3 ? '：基本一致' : r.pct < 10 ? '：大体对上了，下面几块要改' : '：差得比较多'}`)
  if (B.blocked.length) lines.push(`做出来的页面想跳到本机以外的地址，拦下了：${B.blocked.slice(0, 3).join('、')}`)
  if (A.pageH && B.pageH && Math.abs(A.pageH - B.pageH) > 24) lines.push(`页面高度：设计稿 ${A.pageH}px，做出来的 ${B.pageH}px（差 ${B.pageH - A.pageH > 0 ? '+' : ''}${B.pageH - A.pageH}px，多半是间距 / 字号 / 行高不一样）`)
  if (boxes.length) {
    lines.push('差得最多的几块（图里红框的号）：')
    boxes.forEach((b, i) => lines.push(`${i + 1}. 位置 ${b.x},${b.y}（${b.w}×${b.h}）：设计稿是 ${describe(b.design)}，做出来的是 ${describe(b.impl)}`))
    lines.push('整块挪了位置先查上面的间距和高度；颜色不对查设计变量；字的宽度不一样查字体、字号、字重。')
  } else lines.push('没有成片的差异。')
  // cmp：比的那块多大（套了外框是槽位）；slot：只比了槽位。右侧栏「和做出来的比」按它把红框标回去
  return { pct: r.pct, boxes, jpg: Buffer.from(r.jpg, 'base64'), text: lines.join('\n'), cmp: slot ? [slot.w, slot.h] : [w, h], slot: !!slot }
}
