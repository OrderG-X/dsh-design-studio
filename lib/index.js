/**
 * dsh-design-studio（服务端）
 *
 *   preview_page 工具   模型做界面时调一次，右侧栏「设计工作台」打开这个页面（可以带类型：网页 / App / 海报 …）
 *   check_design 工具   模型写完 / 改完后调：无头浏览器按真实尺寸量每一屏（设计体检，可指定几种尺寸），测量数字和问题清单交回给模型；
 *                      电脑上没有 Chrome / Edge 时让右侧栏在显示着的页面上量（browser.js、look.js）
 *   look_design 工具    无头浏览器按真实尺寸截每一屏（顶上 / 滚到底 / 从上到下 / 某个元素），图直接回给模型
 *   自动发现           模型写了 HTML、或命令输出里出现 localhost:端口（开发服务器起来了），自动预览
 *   ui-design 技能     设计流程、设计原则、中文排版、各类型要点、避免 AI 味、自查清单（skills/ui-design/，DSH 有技能服务时才挂上）
 *
 * 拆成几行，每行在 DSH「插件」页里有自己的开关（见 cordis.patch.yml）：
 *   dsh-design-studio        工作台本体：右侧栏、接口、预览服务器、跟踪会话（这个文件的 apply）
 *   dsh-design-studio/auto   自动打开预览（auto.js）
 *   dsh-design-studio/tool   preview_page、check_design、look_design 三个工具（tool.js）
 *   dsh-design-studio/skill  ui-design 技能（skill.js）
 *   preset-design            设计模式：标准模式的全套工具 + 上面两行，人设换成做设计的
 * 工具和技能在顶层挂一份（所有模式都能用），设计模式里再挂一份（只关顶层那份，设计模式照样有）。
 *   接口（DSH 自己的地址，要登录态）：
 *     GET  /dsh-design-studio/api/state?session=  右侧栏轮询：预览什么、有哪几屏、要不要弹出来、模型在不在干活、
 *                                                   模型要不要体检（checkReq）
 *     POST /dsh-design-studio/api/check            体检结果交给 check_design { session, id, text, measured } 或 { session, id, error }
 *                                                   （measured = 0：一屏都没量到，先不收，等别的右侧栏）
 *     POST /dsh-design-studio/api/open             地址栏输入新地址 { session, target }
 *     POST /dsh-design-studio/api/view             改类型 / 尺寸 / 视图，或换到另一屏 { session, kind?, size?, view?, focus? }
 *     POST /dsh-design-studio/api/close            清掉预览 { session }
 *     GET  /dsh-design-studio/api/history?session= 设计版本（每轮对话前后各存一版），新的在前
 *     POST /dsh-design-studio/api/restore          回到某一版 { session, n }（现在的先存一版）
 *     POST /dsh-design-studio/api/export           存导出的图片 { session, name, png: base64 } → 设计目录的 exports/
 *     POST /dsh-design-studio/api/doc              几屏拼成文档 { session, format: 'pdf' | 'pptx', name, title, bg, pages: [{ jpg: base64, w, h, title, links }] }
 *                                                   → 设计目录的 exports/（每屏一页；links: [{ x, y, w, h, to }] 点了跳到第 to 页）
 *     POST /dsh-design-studio/api/ref              存参考图 { session, name, data: base64 } → 设计目录的 refs/（没有设计目录就存插件缓存）
 *     POST /dsh-design-studio/api/reveal           在访达 / 资源管理器里显示刚导出的图片 { path }
 *     POST /dsh-design-studio/api/edit             预览里直接改字 { session, key, before, after, nth } → 写回那一屏的 HTML（改前改后各存一版）
 *     POST /dsh-design-studio/api/style            预览里调样式 { session, key, loc, css, name } → 写进那个元素在源码里的 style 属性（改前改后各存一版）
 *     POST /dsh-design-studio/api/locate           样式规则在源码第几行 { session, items: [{ href, sel, n }] } → { items: [{ file, line } | null] }
 *     GET  /dsh-design-studio/api/bundle?session=&key=&v=&parent=  远程看：这一屏连同样式、图片打成一份 → { html, deps }（放进沙盒 iframe；deps 改了再取）
 *     POST /dsh-design-studio/api/phone            手机上看：{ session, on: true, path } 开局域网入口（给链接和二维码）、
 *                                                   { on: false } 关掉、{ follow: path } 电脑上换了一屏手机跟着跳
 *
 * 页面本身由 serve.js 开的独立端口提供（见那边的说明）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { createHub, webOrigins, trustedOrigins, resolveInRoot, ERR_CATCHER } from './serve.js'
import { bundle, inlinePicker, MAX_TOTAL as BUNDLE_MAX } from './bundle.js'
import { createTracker, parseTarget, findRule, KINDS } from './core.js'
import { createHistory } from './history.js'
import { createPhone } from './phone.js'
import { qrMatrix } from './qr.js'
import { makePdf, makePptx, jpegInfo } from './doc.js'
import { createBrowser } from './browser.js'
import { designOf, metaOfFile, sizeOf, pickScreens, measureAll, shootAll, cropIssues, formatMeasure, issueSnapshot, formatShots, whereOf, MAX_SCREENS, MAX_SIZES, MAX_SHOTS, MAX_CROPS } from './look.js'
import { SYSTEMS_DIR, extractSystem, listSystems, setDefault, skillSection } from './system.js'
import { readTweaks, applyTweaks, lintTweaks } from './tweaks.js'
import { FRAMEWORKS, detectProject, buildHandoff, compareScreens, implUrl, defaultDest, within } from './handoff.js'

export const name = 'dsh-design-studio'
export const inject = ['webServer']

const API = '/dsh-design-studio/api/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const MAX_BODY = 64 * 1024
const MAX_EXPORT = 48 * 1024 * 1024 // 导出图片的请求体（base64）
const MAX_DOC = 160 * 1024 * 1024 // 导出 PDF / PPT 的请求体（几十屏的 JPEG，base64）
const MAX_PAGES = 60
const CHECK_WAIT = 30000 // check_design 等右侧栏量完的最长时间（右侧栏每屏最多等 6 秒载入 + 15 秒量完，几屏一起量）
const HISTORY_DIR = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'history')
// 每个会话预览的是什么，存这里（DSH 重启后接着显示）
// 参考图：没有本地设计目录（开发服务器 / 还没开始）时存这里
const REFS_DIR = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'refs')
const STORE_FILE = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio.json')
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-design')
const PICKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'picker.js')
const SKILL_RANK = 600 // 和 DSH 自带的技能同一档；用户 / 项目里同名的技能优先

/**
 * 几行之间靠这个互通（同一个包里的模块 Node 只加载一次）：工作台起来后放 tracker、无头浏览器（browser）；
 * 「自动打开预览」那行开着时 autoOpen > 0
 */
export const studio = { tracker: null, autoOpen: 0, check: null, browser: null, log: () => {} }

/** 设计技能：模型做界面设计时加载（DSH 的 skill 工具），也能让用户手动调 */
export const designSkill = {
  name: 'ui-design',
  description:
    '做网页、App 界面、平板界面、海报 / 社媒图、幻灯片、邮件、组件这类界面设计之前先加载：' +
    '配合右侧「设计工作台」画布的做法（一屏一个文件、设计变量、类型标记）、现代设计原则、中文排版、各类型画幅要点、避免 AI 味、设计自查清单。' +
    '只是把回答做成一页给用户看或用（对比、表格、清单、图表、计算器这类）不算界面设计：有 show_page 工具就直接用它，不加载这个技能。',
  whenToUse: '用户要做或改网站 / App / 海报 / 幻灯片这类界面或视觉设计时（把回答做成一页、有 show_page 工具时用 show_page）',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'dsh-design-studio',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: SKILL_DIR },
  rank: SKILL_RANK,
  locator: path.join(SKILL_DIR, 'SKILL.md'),
}

export const skillProvider = {
  name: 'dsh-design-studio',
  list: () => Promise.resolve([designSkill]),
  async get() {
    const { name, description, whenToUse, invocation, provider, source, resourceBase } = designSkill
    // 用户的设计系统（默认用哪套、库里有哪些）每次现读，提了新的下次加载技能就知道
    let extra = ''
    try { extra = skillSection() } catch (e) { studio.log(e) }
    return { name, description, whenToUse, invocation, provider, source, resourceBase, content: (await fs.promises.readFile(designSkill.locator, 'utf8')) + extra }
  },
}

/** preview_page 工具（tool.js 挂到 DSH；不在这个文件的 apply 里挂，好让它单独开关、也能挂进设计模式） */
export const previewTool = {
  name: 'preview_page',
  description:
    '在右侧栏「设计工作台」里实时打开一个页面，用户能边看边点选要改的地方。' +
    '做网页、App 界面、海报、幻灯片、邮件这类界面设计时用：写好第一个 HTML 文件、或启动开发服务器后调一次就行，之后改文件会自动刷新，不用再调。' +
    '只是把回答做成一页（对比、表格、清单、图表、计算器）给用户看或用时，有 show_page 工具就用它，不用这里。' +
    '本地 HTML 写文件路径；开发服务器写地址或端口（如 http://localhost:5173）。只能预览本机页面。' +
    'kind 说明是哪类设计，右侧按它的画幅显示（App 套手机外框、幻灯片 16:9 …）。' +
    '动手设计前先加载 ui-design 技能（设计流程、规范和自查清单）。' +
    '要做好几屏（App 的几个界面、网站的几个页面）时，每屏一个 HTML 文件放在同一个目录，右侧画布会按生成顺序并排显示，一屏一屏写就行。' +
    '用户在预览里点选的内容会以「〔选中元素〕」或「〔选中区域〕」开头出现在消息里，带 CSS 路径、HTML、关键样式，' +
    '拿得到时还有组件和源码位置：照它找到源码里对应的地方再改。',
  parameters: specToJsonSchema({
    target: { type: 'string', required: true, description: '本地 HTML 文件的绝对路径，或开发服务器地址 / 端口，例如 /Users/me/site/index.html、http://localhost:5173、5173' },
    kind: {
      type: 'string',
      enum: KINDS,
      description: '设计类型：web 网页（默认）、app 手机 App 界面（390×844）、tablet 平板、poster 海报 / 社媒图（1080×1350）、slides 幻灯片（16:9）、email 邮件',
    },
    size: { type: 'string', description: '画幅尺寸，可选，如 1080x1920；不填按类型的默认尺寸' },
    screens: {
      type: 'array',
      items: { type: 'string' },
      description: '开发服务器上要并排显示的几个路由，可选，如 ["/", "/login", "/settings"]。本地 HTML 不用填：同目录的 HTML 文件自动并排',
    },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, url: { type: 'string' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args, exec) {
    const session = exec && exec.agent && exec.agent.session
    const id = session && session.id
    if (!id) throw new Error('拿不到当前会话，没法打开预览')
    const tracker = studio.tracker
    if (!tracker) throw new Error('「设计工作台」在 DSH 的插件页里关着，打开后再预览')
    const target = parseTarget(args.target, tracker.cwdOf(id))
    const opts = { source: 'tool' }
    if (args.kind !== undefined) opts.kind = args.kind
    if (args.size !== undefined) opts.size = args.size
    if (args.screens !== undefined) opts.routes = args.screens
    const st = await tracker.setTarget(id, target, opts)
    const what = target.kind === 'file' ? target.file : `localhost:${target.port}${target.path}`
    const many = target.kind === 'file' ? '同目录再写别的 HTML 文件，会作为新的一屏并排出现。' : ''
    return {
      text: `已在右侧「设计工作台」打开 ${what}。${target.kind === 'file' ? '这个目录里的文件一改就自动刷新。' + many : '开发服务器的热更新照常生效。'}`,
      url: st.url,
    }
  },
}

/** 这个会话在预览的设计：哪几屏、哪类、多大（工具在无头浏览器里量 / 截图用） */
function designFor(id) {
  const snap = studio.tracker.snapshot(id)
  const t = snap.target
  const sc0 = (snap.screens || [])[0]
  const first = t && t.kind === 'file' ? path.join(path.dirname(t.file), (sc0 && sc0.key) || path.basename(t.file)) : ''
  const focus = t && t.kind === 'file' ? t.file : ''
  return { snap, ...designOf(snap, () => metaOfFile(focus) || (first && first !== focus ? metaOfFile(first) : '')) }
}

/** 工具参数里的尺寸：'375x667' / 375 / ['375', '430x932'] → [[w, h]]，认不出的记下来 */
function sizesFrom(v, kind) {
  const list = Array.isArray(v) ? v : v == null || v === '' ? [] : [v]
  const out = []
  const bad = []
  for (const x of list.slice(0, 12)) {
    const s = sizeOf(x, kind)
    if (!s) bad.push(String(x).slice(0, 20))
    else if (!out.some(([w, h]) => w === s[0] && h === s[1])) out.push(s)
  }
  return { sizes: out.slice(0, MAX_SIZES), bad, more: Math.max(0, out.length - MAX_SIZES) }
}

const toolSession = (exec, what) => {
  const session = exec && exec.agent && exec.agent.session
  const id = session && session.id
  if (!id) throw new Error(`拿不到当前会话，没法${what}`)
  if (!studio.tracker) throw new Error(`「设计工作台」在 DSH 的插件页里关着，打开后再${what}`)
  return id
}

/** check_design 工具：在无头浏览器里按真实尺寸量每一屏（没有浏览器就让右侧栏量），问题清单和测量数字交回给模型 */
export const checkTool = {
  name: 'check_design',
  description:
    '量一下右侧「设计工作台」里的设计（默认每一屏、按设计的尺寸）：文字被截断 / 超出框、文字叠在一起、对比度不够、点击区太小、字太小、字号太杂、超出屏幕、图片被拉变形 / 没加载出来、一行太长、短字断行、' +
    '固定的顶栏 / 底栏压住内容（滚到底也看不全）或贴得太近、页面脚本报错、样式表 / 脚本 / 字体没载出来、跳到不存在的页面。' +
    '在电脑上用无头浏览器按真实尺寸打开每一屏量，和右侧栏怎么显示无关；返回量了哪几屏、每种尺寸下页面多高、固定栏离内容多远，和问题清单（哪一屏、哪个元素的 CSS 选择器、具体数字）。' +
    '写完一批屏、或改完之后调一次，照清单改源文件；要看小屏 / 大屏就给 sizes（如 ["375x667", "430x932"]，或只写宽度）。比另开浏览器截图自查准，也省得多；要看长什么样用 look_design。' +
    `严重的问题（被栏压住、文字叠在一起 / 被截断 / 超出框、超出屏幕、图片没出来、对比度很低）自动附上那一块的局部截图（最多 ${MAX_CROPS} 张，红框圈出元素）。` +
    '要先用 preview_page 打开过页面。',
  parameters: specToJsonSchema({
    screens: { type: 'array', items: { type: 'string' }, description: '量哪几屏：文件名（home.html 或 home）或开发服务器的路由；不填量全部' },
    sizes: { type: 'array', items: { type: 'string' }, description: '按哪几种尺寸量，如 ["375x667", "390x844", "430x932"]，或只写宽度 ["320", "375"]（高按机型）；不填按设计的尺寸。最多 4 种' },
    dark: { type: 'boolean', description: '切到深色量（页面带深色样式时）' },
    images: { type: 'boolean', description: `严重问题附局部截图（默认附，最多 ${MAX_CROPS} 张）；false 只要文字` },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object' } } },
      required: ['text'],
    },
    render: (_args, value) => withImages(value),
  },
  async execute(args, exec, ctx) {
    const id = toolSession(exec, '体检')
    const a = args || {}
    if (!studio.tracker.snapshot(id).url) return { text: '还没有在预览的页面：先用 preview_page 打开设计文件，再体检。' }
    const { snap, kind, size } = designFor(id)
    const want = sizesFrom(a.sizes, kind)
    const b = studio.browser
    if (b && b.available()) {
      try {
        const pick = pickScreens(snap, a.screens, MAX_SCREENS)
        if (!pick.list.length) return { text: `没找到要量的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
        const sizes = want.sizes.length ? want.sizes : [size]
        const rows = await measureAll(b, { screens: pick.list, sizes, kind, dark: !!a.dark, locate: (items) => locateRules(studio.tracker.stateOf(id), items) })
        if (rows.some((r) => !r.error)) {
          // 同一个会话上次量的结果：这次比一比修好了几个、新出了几个
          const prev = lastChecks.get(id) || null
          // 严重问题的局部截图（截不成就不附；附件库用不了的老版本 DSH 不截，清单照样给）
          let crops = []
          if (a.images !== false && ctx && typeof ctx.get === 'function' && ctx.get('attachments')) {
            try { crops = await cropIssues(b, rows, { screens: pick.list, dark: !!a.dark }) } catch (e) { studio.log(e) }
          }
          const kept = crops.length ? await keepImages(ctx, id, crops) : null
          if (kept && !kept.images) crops = [] // 存进附件库失败：不提图
          let text = formatMeasure(rows, { sizes, where: whereOf(snap), missing: pick.missing, more: pick.more, dark: !!a.dark, prev, crops })
          const next = new Map(prev || [])
          for (const [k, v] of issueSnapshot(rows, !!a.dark)) next.set(k, v)
          lastChecks.delete(id)
          lastChecks.set(id, next)
          while (lastChecks.size > 20) lastChecks.delete(lastChecks.keys().next().value)
          if (want.bad.length) text += `\n认不出的尺寸（没量）：${want.bad.join('、')}，写成 375x667 或 375`
          if (want.more) text += `\n尺寸太多，只量了前 ${MAX_SIZES} 种`
          text += tweakNotes(id)
          return kept && kept.images ? { text, images: kept.images } : { text }
        }
        studio.log(new Error(`check_design 无头浏览器没量成：${rows[0] && rows[0].error}`))
      } catch (e) {
        studio.log(e)
      }
    }
    // 没有无头浏览器（或者它没量成）：让右侧栏在显示着的页面上量
    if (!studio.check) return { text: '这台电脑上没找到能用的 Chrome / Edge，「设计工作台」也没开着，量不了。照 ui-design 技能里的「自查」清单自己过一遍。' }
    const r = await studio.check(id)
    const note = want.sizes.length || a.dark ? '（这台电脑上没找到能用的 Chrome / Edge，没法按指定尺寸 / 深色量；下面是右侧栏按它现在显示的尺寸量的）\n' : ''
    if (!r) return { text: '右侧栏「设计工作台」现在没开着，量不了。照 ui-design 技能里的「自查」清单自己过一遍。' }
    if (!r.error && !r.measured) return { text: '右侧栏开着，但预览页面没回应，这次没量成（可能还在加载）。过一会儿再调一次，或照 ui-design 技能里的「自查」清单自己过一遍。' }
    return { text: note + (r.error || r.text) + tweakNotes(id) }
  },
}

/** 调节滑块（tweaks.json）有没有真接上：check_design 末尾附上 */
function tweakNotes(id) {
  let list = []
  try {
    const t = studio.tracker.stateOf(id).target
    if (t && t.kind === 'file') list = lintTweaks(t.root)
  } catch (e) { studio.log(e) }
  return list.length ? `\n\n调节滑块（tweaks.json）：\n${list.map((x) => `- ${x}`).join('\n')}` : ''
}

/**
 * 浏览器给的规则（样式表地址 + 选择器 + 同一文件里第几条）→ 设计目录里的文件和行号。
 * 只认这个会话正在预览的本地目录里的文件（≤ 2MB）；别的地址、插件自己的、跑出目录的给 null
 */
function locateRules(st, items) {
  const t = st && st.target
  if (!t || t.kind !== 'file' || !st.origin) return items.map(() => null)
  const texts = new Map()
  return items.map((it) => {
    try {
      const u = new URL(String((it && it.href) || ''))
      if (u.origin !== st.origin || u.pathname.startsWith('/__dsh_design__/')) return null
      const hit = resolveInRoot(t.root, u.pathname)
      if (!hit || !hit.real) return null
      if (!texts.has(hit.real)) {
        const stat = fs.statSync(hit.real)
        texts.set(hit.real, stat.isFile() && stat.size <= 2 * 1024 * 1024 ? fs.readFileSync(hit.real, 'utf8') : '')
      }
      const rel = path.relative(t.root, hit.abs).split(path.sep).join('/')
      return { file: rel, line: findRule(texts.get(hit.real), String(it.sel || ''), Math.max(0, Math.floor(Number(it.n) || 0))) }
    } catch {
      return null
    }
  })
}

/** check_design 每个会话上次量出来的问题（复查时比修好了几个、新出了几个）；只记最近 20 个会话 */
const lastChecks = new Map()

/** 存成文件的截图（老版本 DSH）只留一天 */
function pruneLookDir(maxAge = 24 * 3600 * 1000) {
  let dirs = []
  try { dirs = fs.readdirSync(LOOK_DIR) } catch { return }
  const old = Date.now() - maxAge
  for (const d of dirs) {
    const dir = path.join(LOOK_DIR, d)
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).mtimeMs < old) fs.rmSync(p, { force: true })
      }
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir)
    } catch { /* 删不掉下次再说 */ }
  }
}

/** look_design 截的图存进 DSH 的附件库；附件引用（可序列化）放在工具结果里，render 直接读 */
const LOOK_DIR = path.join(os.tmpdir(), 'dsh-design-look')

/** look_design 工具：在无头浏览器里按真实尺寸打开每一屏截图，图直接回给模型看 */
export const lookTool = {
  name: 'look_design',
  description:
    '看一眼右侧「设计工作台」里的设计长什么样：在电脑上用无头浏览器按真实尺寸打开每一屏，截图直接回给你（真实渲染的像素）。' +
    '默认每屏截顶上一屏；at=bottom 滚到底（看底栏有没有压住内容）、at=full 从上到下每屏一张；selector 只截一个元素；size 换尺寸（如 375x667 或 375）；dark 看深色。' +
    `一次最多 ${MAX_SHOTS} 张。自己检查视觉效果（层次、留白、配色、图片、整体观感）用这个；要问题清单和数字用 check_design。要先用 preview_page 打开过页面。`,
  parameters: specToJsonSchema({
    screens: { type: 'array', items: { type: 'string' }, description: `截哪几屏：文件名（home.html 或 home）或开发服务器的路由；不填截全部（最多 ${MAX_SHOTS} 屏）` },
    size: { type: 'string', description: '尺寸，如 375x667，或只写宽度 375（高按机型）；不填按设计的尺寸' },
    at: { type: 'string', enum: ['top', 'bottom', 'full'], description: 'top 顶上一屏（默认）、bottom 滚到底、full 从上到下每屏一张' },
    selector: { type: 'string', description: '只截这个元素（CSS 选择器），如 .tabbar、#hero' },
    dark: { type: 'boolean', description: '切到深色看（页面带深色样式时）' },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object' } } },
      required: ['text'],
    },
    render: (_args, value) => withImages(value),
  },
  async execute(args, exec, ctx) {
    const id = toolSession(exec, '截图')
    const a = args || {}
    if (!studio.tracker.snapshot(id).url) return { text: '还没有在预览的页面：先用 preview_page 打开设计文件，再看。' }
    const b = studio.browser
    if (!b || !b.available()) return { text: '这台电脑上没找到 Chrome / Edge（无头浏览器截图要用），看不了。用 check_design 拿测量数字，或者让用户看右侧栏。' }
    const { snap, kind, size } = designFor(id)
    const want = a.size ? sizeOf(a.size, kind) : size
    if (!want) return { text: `认不出尺寸「${String(a.size).slice(0, 20)}」：写成 375x667，或只写宽度 375。` }
    const at = ['top', 'bottom', 'full'].includes(a.at) ? a.at : 'top'
    const pick = pickScreens(snap, a.screens, MAX_SHOTS)
    if (!pick.list.length) return { text: `没找到要截的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
    const shots = await shootAll(b, { screens: pick.list, size: want, at, selector: a.selector, dark: !!a.dark, max: MAX_SHOTS })
    const good = shots.filter((s) => s.jpg).slice(0, MAX_SHOTS)
    const text = formatShots(shots, { where: whereOf(snap), missing: pick.missing, more: pick.more })
    if (!good.length) return { text }
    const kept = await keepImages(ctx, id, good, true)
    if (kept.images) return { text, images: kept.images }
    return { text: `${text}\n（这个 DSH 版本没法把图直接给你，存成了文件：\n${kept.files.join('\n')}）` }
  },
}

/** extract_design_system 工具：从用户的网站 / 项目里提一套设计系统，放进库里，以后做新设计都照它来 */
export const systemTool = {
  name: 'extract_design_system',
  description:
    '从用户自己的网站或项目里提取一套设计系统（品牌的颜色、字体、字号阶梯、圆角、阴影，和按钮 / 输入框 / 卡片的样子），存进用户的设计系统库，默认设为以后做新设计都照它来。' +
    '用户给了网站地址、项目文件夹或 HTML 文件，说「照我们官网的风格」「用我们的品牌」时用。网站地址最准：在无头浏览器里打开量真实渲染的样式、截组件；项目文件夹会扫 CSS / Tailwind 配置 / 主题文件，有 HTML 入口也会打开量。' +
    '返回提出来的配色、字体、圆角、组件，和网站截图、组件截图、样张截图；文件（tokens.css、components.css、components.html 样张、DESIGN.md）在 ~/.dsh/design-systems/<名字>/ 里。' +
    '提完对照截图检查角色猜得对不对（不对就改 tokens.css），把 DESIGN.md 的「品牌气质」补上，再用 preview_page 打开 components.html 给用户看。',
  parameters: specToJsonSchema({
    sources: { type: 'array', items: { type: 'string' }, required: true, description: '来源，1–5 个：网站地址（https://example.com，可以给同一个站的几页）、项目文件夹或 HTML 文件的路径' },
    name: { type: 'string', description: '这套设计系统叫什么（品牌名），可选；不填从网站标题 / package.json 里猜' },
    default: { type: 'boolean', description: '设为默认（以后做新设计都照它来），默认 true' },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object' } } },
      required: ['text'],
    },
    render: (_args, value) => withImages(value),
  },
  async execute(args, exec, ctx) {
    const session = exec && exec.agent && exec.agent.session
    const id = (session && session.id) || ''
    const a = args || {}
    const sources = (Array.isArray(a.sources) ? a.sources : [a.sources]).filter((x) => typeof x === 'string' && x.trim())
    if (!sources.length) return { text: '没给来源：sources 写网站地址、项目文件夹或 HTML 文件。' }
    const cwd = studio.tracker && id ? studio.tracker.cwdOf(id) : os.homedir()
    let r
    try {
      r = await extractSystem({ browser: studio.browser, sources, name: typeof a.name === 'string' ? a.name : '', cwd, makeDefault: a.default !== false })
    } catch (e) {
      return { text: `没提成：${String((e && e.message) || e).slice(0, 300)}` }
    }
    if (!r.images.length) return { text: r.text }
    const kept = await keepImages(ctx, id || 'system', r.images, true)
    if (kept.images) return { text: r.text, images: kept.images }
    return { text: `${r.text}\n（截图存在 ${path.join(r.dir, 'source')}）` }
  },
}

/** 设计目录里的 tokens.css 是不是从库里哪套设计系统复制来的（文件头写着「设计系统「名字」」） */
function systemOfDir(root) {
  try {
    const head = fs.readFileSync(path.join(root, 'tokens.css'), 'utf8').slice(0, 400)
    const m = /设计系统「([^」]{1,40})」/.exec(head)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

/** 路径里的 ~ 换成家目录，相对路径按会话的目录算 */
const resolvePath = (p, cwd) => path.resolve(cwd, String(p).trim().replace(/^~(?=$|[\\/])/, os.homedir()))

/** handoff_design 工具：把设计整理成交接包（说明 + 每屏截图），照它做成真项目的代码 */
export const handoffTool = {
  name: 'handoff_design',
  description:
    '把右侧「设计工作台」里的设计（本地 HTML 那几屏）整理成交接包，准备做成真项目的代码：写好 <设计目录>/handoff/HANDOFF.md（每屏的文件、建议路由、跳转、设计变量、几屏共用该抽成组件的部分、交互和状态、调节滑块、素材、做法和验收），和每屏从上到下的截图。' +
    '用户说「转成代码」「做成真的项目」「用 React / Vue 做出来」时先调它，读 HANDOFF.md 照着做；每做完一屏用 compare_design 和设计稿比一遍，差异降到 3% 以下再做下一屏。' +
    'framework：same 跟目标目录现有项目一样（有 package.json 时默认）、react、vue、next、html；dest：代码放哪个目录（不填放在会话目录里新建）。要先用 preview_page 打开过设计。',
  parameters: specToJsonSchema({
    framework: { type: 'string', enum: ['same', ...Object.keys(FRAMEWORKS)], description: 'same 跟现有项目一样；react（React + Vite）、vue（Vue 3 + Vite）、next（Next.js）、html（纯 HTML / CSS）。不填：目标目录有项目就 same，没有就 react' },
    dest: { type: 'string', description: '代码放哪：现有项目的目录，或要新建的项目目录（绝对路径或相对会话目录）。不填：会话目录有项目就放进去，没有就在会话目录下新建' },
    screens: { type: 'array', items: { type: 'string' }, description: '只转哪几屏（文件名）；不填全部' },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object' } } },
      required: ['text'],
    },
    render: (_args, value) => withImages(value),
  },
  async execute(args, exec, ctx) {
    const id = toolSession(exec, '转成代码')
    const a = args || {}
    const snap = studio.tracker.snapshot(id)
    if (!snap.url) return { text: '还没有在预览的设计：先用 preview_page 打开设计文件。' }
    const t = studio.tracker.stateOf(id).target
    if (!t || t.kind !== 'file') return { text: '现在预览的是开发服务器上的页面，它已经是代码了：直接在那个项目里改；要比对设计稿就先用 preview_page 打开设计的 HTML 文件。' }
    const { kind, size } = designFor(id)
    const pick = pickScreens(snap, a.screens, 12)
    if (!pick.list.length) return { text: `没找到要转的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、')}` }
    const cwd = studio.tracker.cwdOf(id)
    // 先定下最终放哪（没给就和右侧栏建议的一样），再按真实路径查是不是在设计目录里
    const dest = typeof a.dest === 'string' && a.dest.trim() ? resolvePath(a.dest, cwd) : defaultDest(t.root, cwd, detectProject(cwd))
    if (within(dest, t.root)) return { text: `代码别放进设计目录（${t.root}）里：设计稿留着做对比。换一个目录。` }
    const project = detectProject(dest)
    const framework = typeof a.framework === 'string' && (a.framework === 'same' || FRAMEWORKS[a.framework]) ? a.framework : project.pkg && project.framework ? 'same' : 'react'
    if (framework === 'same' && !(project.pkg && project.framework)) return { text: `${dest} 里没有认得出的前端项目（package.json 里没有 React / Vue / Next …）：framework 选 react、vue、next 或 html。` }
    let r
    try {
      r = await buildHandoff(studio.browser, { root: t.root, screens: pick.list, kind, size, framework, dest, project, system: systemOfDir(t.root) })
    } catch (e) {
      return { text: `没写成交接包：${String((e && e.message) || e).slice(0, 200)}` }
    }
    const head = `交接包写好了：${r.file}（${r.shots} 张截图在 handoff/shots/）。下面是全文，照「做法和验收」一屏一屏做，每屏做完用 compare_design 比。\n\n`
    // 每屏顶上一张附上，直接看到要做成什么样
    const firsts = r.rows.filter((row) => row.shots.length).slice(0, 4).map((row) => ({ key: row.key, jpg: fs.readFileSync(path.join(r.dir, 'shots', row.shots[0])) }))
    const kept = firsts.length ? await keepImages(ctx, id, firsts) : {}
    return kept.images ? { text: head + r.md, images: kept.images } : { text: head + r.md }
  },
}

/** compare_design 工具：设计稿的一屏和做出来的页面按同样尺寸截图，逐像素比 */
export const compareTool = {
  name: 'compare_design',
  description:
    '把做出来的页面和右侧「设计工作台」里的设计稿比一比：按同样尺寸在无头浏览器里各截一张，逐像素比，回一张「设计稿 | 做出来的 | 差异」拼图（差得多的地方红框标号）、差了百分之几，和每块差异在两边分别是哪个元素。' +
    '照设计稿写代码时每做完一屏调一次（url 给开发服务器上那一页的地址，如 http://localhost:5173/login），照差异改到 3% 以下。at=bottom 比滚到底的样子。要先用 preview_page 打开过设计。',
  parameters: specToJsonSchema({
    url: { type: 'string', required: true, description: '做出来的页面：本机地址（http://localhost:5173/login，或端口 5173）或本地 HTML 文件' },
    screen: { type: 'string', description: '和设计稿的哪一屏比（文件名，如 login 或 login.html）；不填用右侧正在看的那屏' },
    size: { type: 'string', description: '尺寸，如 375x667 或只写宽度；不填按设计的尺寸' },
    at: { type: 'string', enum: ['top', 'bottom'], description: 'top 顶上一屏（默认）、bottom 滚到底' },
    dark: { type: 'boolean', description: '比深色' },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object' } } },
      required: ['text'],
    },
    render: (_args, value) => withImages(value),
  },
  async execute(args, exec, ctx) {
    const id = toolSession(exec, '比对')
    const a = args || {}
    const snap = studio.tracker.snapshot(id)
    if (!snap.url) return { text: '还没有在预览的设计稿：先用 preview_page 打开设计文件，再比。' }
    const b = studio.browser
    if (!b || !b.available()) return { text: '这台电脑上没找到 Chrome / Edge（比对要用无头浏览器截图），比不了。' }
    const { kind, size } = designFor(id)
    const want = a.size ? sizeOf(a.size, kind) : size
    if (!want) return { text: `认不出尺寸「${String(a.size).slice(0, 20)}」：写成 375x667，或只写宽度 375。` }
    // 指定了哪屏就只认那屏，找不到就说（别悄悄拿第一屏比，结果对不上号）；没指定才用正在看的 / 第一屏
    const asked = typeof a.screen === 'string' && a.screen.trim()
    const pick = pickScreens(snap, asked ? [a.screen] : [snap.focus], 1)
    const sc = pick.list[0] || (asked ? null : pickScreens(snap, null, 1).list[0])
    if (!sc) return { text: `没找到设计稿的这一屏：${asked ? a.screen : '（没有屏）'}。现在有：${(snap.screens || []).map((x) => x.key).join('、')}` }
    let impl
    try { impl = implUrl(a.url, studio.tracker.cwdOf(id)) } catch (e) { return { text: e.message } }
    if (snap.origin && impl.startsWith(snap.origin + '/')) return { text: '这个地址是设计稿自己（设计工作台的预览），给做出来的那个项目的地址。' }
    let r
    try {
      r = await compareScreens(b, { design: sc, impl, size: want, at: a.at === 'bottom' ? 'bottom' : 'top', dark: !!a.dark })
    } catch (e) {
      return { text: `没比成：${String((e && e.message) || e).slice(0, 200)}（做出来的页面打得开吗？开发服务器起来了吗？）` }
    }
    const kept = await keepImages(ctx, id, [{ key: `compare-${sc.key}`, jpg: r.jpg }], true)
    if (kept.images) return { text: r.text, images: kept.images }
    return { text: `${r.text}\n（这个 DSH 版本没法把图直接给你，存成了文件：${kept.files.join('、')}）` }
  },
}

/** 工具结果显示成：文字 + 一张张图 */
function withImages(value) {
  const blocks = [{ type: 'text', text: value.text }]
  for (const ref of Array.isArray(value.images) ? value.images : []) blocks.push({ type: 'image', attachment: ref })
  return blocks
}

/**
 * 截的图交给 DSH：存进附件库，附件引用（可序列化）放进工具结果，render 直接读 → { images }。
 * 附件库用不了（老版本 DSH）：toFile 时存成文件 → { files }（一天前的顺手删掉），否则 {}
 */
async function keepImages(ctx, id, list, toFile = false) {
  const attachments = ctx && typeof ctx.get === 'function' ? ctx.get('attachments') : null
  if (attachments) {
    try {
      const refs = await attachments.saveImages(list.map((s, i) => ({ data: s.jpg, mediaType: 'image/jpeg', name: `design-${String(s.key).replace(/[^\w-]+/g, '-')}-${i + 1}.jpg` })))
      return { images: [...refs] }
    } catch (e) { studio.log(e) }
  }
  if (!toFile) return {}
  pruneLookDir()
  const dir = path.join(LOOK_DIR, String(id).replace(/[^\w-]+/g, '_'))
  fs.mkdirSync(dir, { recursive: true })
  const files = list.map((s, i) => {
    const f = path.join(dir, `${Date.now().toString(36)}-${i + 1}-${String(s.key).replace(/[^\w.-]+/g, '-')}.jpg`)
    fs.writeFileSync(f, s.jpg)
    return f
  })
  return { files }
}

const fileStore = {
  load: () => JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')),
  save: (data) => {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(data), { mode: 0o600 })
    fs.renameSync(STORE_FILE + '.tmp', STORE_FILE)
  },
}

function ownHost(ctx) {
  try { return new URL(ctx.webServer.getOrigin()).host } catch { return '' }
}

function fenceOk(req, own) {
  const host = String(req.headers.host || '')
  if (!LOOPBACK_HOST.test(host) && !(own && host === own)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

function connectionOf(ctx) {
  try {
    const c = ctx.get('connection')
    return c && typeof c.requestRejection === 'function' ? c : null
  } catch {
    return null
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

function specToJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, node] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = node
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export function apply(ctx) {
  const log = (e) => {
    try { ctx.logger.warn(`dsh-design-studio: ${e && e.message ? e.message : e}`) } catch { /* 没 logger 就算了 */ }
  }
  const previewPorts = new Set()
  let tracker = null
  const history = createHistory({ base: HISTORY_DIR, log })
  const hub = createHub({
    log,
    history,
    // 桌面版的 dsh-app://app 是默认就认的；这里补上 DSH 网页端的地址，和 DSH 配置里声明的对外地址（反向代理 / 域名）
    parents: () => {
      let own = []
      try { own = webOrigins(ctx.webServer.getOrigin()) } catch { own = [] }
      const conn = connectionOf(ctx)
      return [...own, ...trustedOrigins(conn && conn.trustedHosts)]
    },
    onChange: (key, file, files) => {
      if (tracker && key.startsWith('file:')) tracker.changed(key.slice(5), files)
    },
  })
  const open = async (target, opts) => {
    const r = await hub.open(target.kind === 'file' ? { kind: 'file', root: target.root } : target, opts)
    previewPorts.add(Number(new URL(r.origin).port))
    return r
  }
  tracker = createTracker({
    open,
    log,
    history,
    store: fileStore,
    alive: (origin) => hub.alive(origin),
    autoOpen: () => studio.autoOpen > 0,
    skipPorts: () => {
      const s = new Set(previewPorts)
      const own = ownHost(ctx).split(':')[1]
      if (own) s.add(Number(own))
      return s
    },
  })
  ctx.effect(() => () => hub.closeAll(), 'dsh-design-studio: preview servers')
  ctx.effect(() => {
    studio.tracker = tracker
    studio.log = log
    return () => { if (studio.tracker === tracker) { studio.tracker = null; studio.log = () => {} } }
  }, 'dsh-design-studio: tracker')
  // check_design / look_design 用的无头浏览器：用到时才开，闲置自己关，这一行停用时关掉
  ctx.effect(() => {
    const browser = createBrowser({ log })
    studio.browser = browser
    return () => {
      browser.destroy()
      if (studio.browser === browser) studio.browser = null
    }
  }, 'dsh-design-studio: headless browser')
  const phone = createPhone({ upstream: (session) => tracker.snapshot(session).origin || '', log })
  ctx.effect(() => () => phone.stopAll(), 'dsh-design-studio: phone links')

  // ── 接口 ──────────────────────────────────────────────────────────────────

  function admit(req, res) {
    const conn = connectionOf(ctx)
    if (conn) {
      const rejected = conn.requestRejection(req)
      if (rejected) {
        json(res, rejected, { error: rejected === 401 ? 'unauthorized' : 'forbidden' })
        return false
      }
      return true
    }
    if (!LOOPBACK.has(req.socket.remoteAddress) || !fenceOk(req, ownHost(ctx))) {
      json(res, 403, { error: 'forbidden' })
      return false
    }
    return true
  }

  // ── 模型调 check_design：轮询里带上 checkReq，右侧栏量完 POST /api/check 交回来；右侧栏没开就等到超时 ──
  const checks = new Map()
  let checkSeq = 0
  function requestCheck(session, ms = CHECK_WAIT) {
    const had = checks.get(session)
    if (had) return had.promise
    const c = { id: `c${++checkSeq}-${Date.now().toString(36)}` }
    c.promise = new Promise((resolve) => {
      c.done = (r) => {
        clearTimeout(c.timer)
        if (checks.get(session) === c) checks.delete(session)
        resolve(r)
      }
      c.timer = setTimeout(() => c.done(c.fallback || null), ms)
    })
    checks.set(session, c)
    return c.promise
  }
  ctx.effect(() => {
    studio.check = requestCheck
    return () => {
      if (studio.check === requestCheck) studio.check = null
      for (const c of [...checks.values()]) c.done(null)
    }
  }, 'dsh-design-studio: check')

  function state(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    const ph = phone.status(session)
    const c = checks.get(session)
    // 调节滑块：tweaks.json 改了（模型写的 / 写回的）右侧栏跟着变
    const t = tracker.stateOf(session).target
    let tweaks = null
    if (t && t.kind === 'file') { try { tweaks = readTweaks(t.root) } catch (e) { log(e) } }
    json(res, 200, { ...tracker.snapshot(session), phone: { on: ph.on, seen: ph.seen || 0 }, tweaks, ...(c ? { checkReq: c.id } : {}) })
  }

  /** 调节滑块写回文件：values = { id: 值 } */
  async function tweakRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {}
    try {
      const r = tracker.editDir(String(body.session || ''), (root) => applyTweaks(root, values), (x) => `调节：${x.changed.map((c) => `${c.label} ${c.to}`).join('、')}`.slice(0, 60), String(body.root || ''))
      json(res, 200, r)
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /** 设计系统库：GET 列出来；POST { id, default: true / false } 设 / 取消默认 */
  async function systemsRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method === 'POST') {
      let body
      try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
      const id = String(body.id || '')
      // 只认库里列得出来的那几套（id 就是库目录下的文件夹名，别让 ../ 之类指到外面）
      const sys = listSystems().find((x) => x.id === id)
      if (!sys) return json(res, 404, { error: 'no such system' })
      try {
        if (body.default === false) { if (sys.default) setDefault(SYSTEMS_DIR, '') }
        else setDefault(SYSTEMS_DIR, id)
      } catch (e) { return json(res, 400, { error: e.message }) }
    }
    json(res, 200, { dir: SYSTEMS_DIR, systems: listSystems() })
  }

  /** 设计系统的缩略图（样张截图，没有就用第一张网站截图） */
  function systhumbRoute(req, res) {
    if (!admit(req, res)) return
    const id = new URL(req.url, 'http://x').searchParams.get('id') || ''
    const sys = listSystems().find((x) => x.id === id)
    if (!sys) return json(res, 404, { error: 'no such system' })
    const src = path.join(sys.dir, 'source')
    // 只给 source/ 里真的图片文件：软链接、文件夹都不认（别借缩略图读到库外面的文件）
    const own = (f) => { try { return fs.lstatSync(f).isFile() } catch { return false } }
    let srcOk = false
    try { srcOk = fs.lstatSync(src).isDirectory() } catch { srcOk = false }
    if (!srcOk) return json(res, 404, { error: 'no preview' })
    let file = path.join(src, 'preview.jpg')
    if (!own(file)) {
      let first = ''
      try { first = fs.readdirSync(src).find((f) => /\.jpg$/i.test(f) && own(path.join(src, f))) || '' } catch { first = '' }
      if (!first) return json(res, 404, { error: 'no preview' })
      file = path.join(src, first)
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
    fs.createReadStream(file).on('error', () => res.end()).pipe(res)
  }

  /** 转成代码前：会话目录是不是个前端项目（右侧栏默认选「跟项目一样」、填好放哪） */
  function projectRoute(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    const cwd = tracker.cwdOf(session)
    const p = detectProject(cwd)
    const t = tracker.stateOf(session).target
    const root = t && t.kind === 'file' ? t.root : ''
    // root 一起回去：右侧栏按它认这份建议是不是给现在这套设计的；project 按最终放的目录认（默认框架跟着它选）
    const dest = defaultDest(root, cwd, p)
    json(res, 200, { cwd, root, project: dest === cwd ? p : detectProject(dest), dest, frameworks: Object.fromEntries(Object.entries(FRAMEWORKS).map(([k, v]) => [k, v.label])) })
  }

  async function checkRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const c = checks.get(String(body.session || ''))
    if (!c || c.id !== body.id) return json(res, 200, { ok: false })
    const r = { text: String(body.text || '').slice(0, 20000), error: String(body.error || '').slice(0, 500), measured: Number(body.measured) || 0 }
    // 一屏都没量到：先记着，等别的右侧栏（比如电脑上的）交真结果；到点还没有就用它
    if (!r.error && !r.measured) {
      c.fallback = r
      return json(res, 200, { ok: true, held: true })
    }
    c.done(r)
    json(res, 200, { ok: true })
  }

  async function openRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    try {
      const target = parseTarget(body.target, tracker.cwdOf(session))
      await tracker.setTarget(session, target, { source: 'user', popup: false })
      json(res, 200, tracker.snapshot(session))
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  async function viewRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    const patch = {}
    for (const k of ['kind', 'size', 'view', 'focus']) if (typeof body[k] === 'string') patch[k] = body[k]
    try {
      await tracker.setView(session, patch)
      json(res, 200, tracker.snapshot(session))
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  async function closeRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    tracker.clear(String(body.session || ''))
    phone.stop(String(body.session || ''))
    json(res, 200, tracker.snapshot(String(body.session || '')))
  }

  function historyRoute(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    json(res, 200, { versions: tracker.versions(session) })
  }

  async function restoreRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      const r = tracker.restoreVersion(String(body.session || ''), Number(body.n))
      json(res, 200, { ...r, versions: tracker.versions(String(body.session || '')) })
    } catch (e) {
      json(res, 400, { error: e.message })
    }
  }

  /** 预览里直接改字：写回这一屏的 HTML；找不到那段字就告诉右侧栏（它会改成让模型去改） */
  async function editRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      json(res, 200, tracker.editText(String(body.session || ''), { key: body.key, before: body.before, after: body.after, nth: body.nth }))
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /** 预览里调样式：写进那个元素在源码里的 style 属性；找不到它就告诉右侧栏（它会改成让模型去改） */
  async function styleRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      json(res, 200, tracker.editStyle(String(body.session || ''), { key: body.key, loc: body.loc, css: body.css, name: body.name }))
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /**
   * 调样式交给模型前：每项样式胜出的那条规则在源码第几行（picker 给 { href, sel, n }，这里在设计目录的文件里找）。
   * 只认这个会话预览的本地目录里的文件；开发服务器的样式多半是编译出来的，不找
   */
  async function locateRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const items = Array.isArray(body.items) ? body.items.slice(0, 12) : []
    json(res, 200, { items: locateRules(tracker.stateOf(String(body.session || '')), items) })
  }

  /**
   * 远程看（手机走外网 / 别的电脑打开 DSH 网页，连不上本机的预览端口）：这一屏连同样式、图片打成一份 HTML（见 bundle.js），
   * 右侧栏放进沙盒 iframe。回 JSON（不直接给 HTML：在 DSH 的地址下直接打开时，页面脚本不能拿 DSH 的源跑）。
   * parent：右侧栏所在的源，picker 只和它说话。v：看旧版本。
   */
  function bundleRoute(req, res) {
    if (!admit(req, res)) return
    const q = new URL(req.url, 'http://x').searchParams
    const st = tracker.stateOf(q.get('session') || '')
    const t = st && st.target
    if (!t || t.kind !== 'file') return json(res, 404, { error: 'not-file' })
    const key = q.get('key') || path.basename(t.file)
    if (!/^[^\\]+\.html?$/i.test(key) || key.split('/').some((p) => !p || p === '.' || p === '..')) return json(res, 400, { error: 'bad key' })
    const v = Math.max(0, Math.floor(Number(q.get('v')) || 0))
    let parent = ''
    try { const u = new URL(q.get('parent') || ''); if (u.protocol === 'http:' || u.protocol === 'https:') parent = u.origin } catch { parent = '' }
    const deps = new Set() // 这一屏用到的文件（含没找到的）：右侧栏看到这些改了才重新打包
    const read = (rel) => {
      deps.add(rel)
      // 先看大小，太大的不读（打包总量也封顶，见 bundle.js）
      const small = (f) => { const s = fs.statSync(f); return s.isFile() && s.size <= BUNDLE_MAX }
      if (v) {
        const f = history.fileOf(t.root, v, rel)
        if (f) return small(f) ? fs.readFileSync(f) : null
      }
      const hit = resolveInRoot(t.root, '/' + rel.split('/').map(encodeURIComponent).join('/'))
      if (!hit || !hit.real || !small(hit.real)) return null
      return fs.readFileSync(hit.real)
    }
    try {
      const page = read(key)
      if (!page) return json(res, 404, { error: 'no-screen' })
      const href = st.origin ? `${st.origin}/${v ? `__dsh_design__/v/${v}/` : ''}${key.split('/').map(encodeURIComponent).join('/')}` : ''
      const html = bundle(page.toString('utf8'), { key, read, base: href, lead: ERR_CATCHER, tail: inlinePicker(fs.readFileSync(PICKER_FILE, 'utf8'), parent, href) })
      // 用到的文件太多就不列（null = 右侧栏不按文件筛，目录里一有改动就重新打包）
      json(res, 200, { html, deps: deps.size > 200 ? null : [...deps] })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  const exported = new Set() // 这次运行里导出过的图片（只许在访达里显示这些）

  /** 导出的图片存哪：本地文件预览存设计目录的 exports/，开发服务器存「下载」 */
  function exportDir(session) {
    const st = tracker.stateOf(session)
    if (st.target && st.target.kind === 'file') return path.join(st.target.root, 'exports')
    return path.join(os.homedir(), 'Downloads')
  }

  /** 存进导出目录：文件名只留字母数字中文和 -，同名不覆盖（加 -2、-3 …） */
  function saveExport(res, session, name, ext, buf) {
    const base = String(name || 'design').replace(new RegExp(`\\.${ext}$`, 'i'), '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design'
    const dir = exportDir(session)
    try {
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, `${base}.${ext}`)
      for (let i = 2; fs.existsSync(file) && i < 1000; i++) file = path.join(dir, `${base}-${i}.${ext}`)
      fs.writeFileSync(file, buf)
      exported.add(file)
      json(res, 200, { path: file })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  async function exportRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_EXPORT) } catch (e) { return json(res, 400, { error: e.message }) }
    const buf = Buffer.from(String(body.png || ''), 'base64')
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return json(res, 400, { error: '不是 PNG' })
    saveExport(res, String(body.session || ''), body.name, 'png', buf)
  }

  /** 几屏拼成 PDF / PPT：每屏一页，页面大小按那一屏的 CSS 尺寸 */
  async function docRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_DOC) } catch (e) { return json(res, 400, { error: e.message }) }
    const format = body.format === 'pdf' || body.format === 'pptx' ? body.format : ''
    if (!format) return json(res, 400, { error: 'format 只能是 pdf / pptx' })
    const pages = []
    for (const p of Array.isArray(body.pages) ? body.pages.slice(0, MAX_PAGES) : []) {
      const jpg = Buffer.from(String((p && p.jpg) || ''), 'base64')
      const info = jpegInfo(jpg)
      if (!info) return json(res, 400, { error: '不是 JPEG' })
      // 页面大小（CSS 像素）：没给或不像话就按图片的一半算（截图是 2 倍）
      const ok = (v) => Number.isFinite(+v) && +v >= 16 && +v <= 30000
      const w = ok(p.w) && ok(p.h) ? +p.w : info.width / 2
      const h = ok(p.w) && ok(p.h) ? +p.h : info.height / 2
      // 跳转链接原样带过去，doc.js 里挑掉不合法的
      pages.push({ jpg, w, h, title: String(p.title || '').slice(0, 80), links: Array.isArray(p.links) ? p.links.slice(0, 50) : [] })
    }
    if (!pages.length) return json(res, 400, { error: '没有页面' })
    const title = String(body.title || '').slice(0, 120)
    let buf
    try {
      buf = format === 'pdf' ? makePdf(pages, { title }) : makePptx(pages, { title, bg: String(body.bg || '') })
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
    saveExport(res, String(body.session || ''), body.name, format, buf)
  }

  /** 图片格式看文件头，不信文件名 */
  function imageExt(buf) {
    if (buf.length < 12) return ''
    if (buf.readUInt32BE(0) === 0x89504e47) return 'png'
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
    if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
    return ''
  }

  /** 存参考图：本地文件预览存设计目录的 refs/，不然存插件缓存；同名不覆盖 */
  async function refRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_EXPORT) } catch (e) { return json(res, 400, { error: e.message }) }
    const buf = Buffer.from(String(body.data || ''), 'base64')
    const ext = imageExt(buf)
    if (!ext) return json(res, 400, { error: '不是图片' })
    const st = tracker.stateOf(String(body.session || ''))
    const dir = st.target && st.target.kind === 'file' ? path.join(st.target.root, 'refs') : REFS_DIR
    const base = String(body.name || 'ref').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ref'
    try {
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, `${base}.${ext}`)
      for (let i = 2; fs.existsSync(file) && i < 1000; i++) file = path.join(dir, `${base}-${i}.${ext}`)
      fs.writeFileSync(file, buf)
      json(res, 200, { path: file })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  async function revealRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const file = String(body.path || '')
    if (!exported.has(file) || !fs.existsSync(file)) return json(res, 404, { error: 'not exported here' })
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', file]]
      : process.platform === 'win32' ? ['explorer', [`/select,${file}`]]
        : ['xdg-open', [path.dirname(file)]]
    execFile(cmd, args, (e) => { if (e && process.platform !== 'win32') log(e) }) // explorer 正常也返回 1
    json(res, 200, { ok: true })
  }

  /** 手机上看：开 / 关局域网入口，或让开着的手机跟着跳到另一屏 */
  async function phoneRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    if (typeof body.follow === 'string') return json(res, 200, { ok: phone.follow(session, body.follow) })
    if (body.on === false) {
      phone.stop(session)
      return json(res, 200, phone.status(session))
    }
    if (!tracker.snapshot(session).origin) return json(res, 400, { error: '还没有在预览的页面' })
    const st = await phone.start(session, typeof body.path === 'string' && body.path.startsWith('/') ? body.path : '/')
    // 二维码一行一串 0 / 1，右侧栏画成 SVG
    json(res, 200, st.on ? { ...st, qr: qrMatrix(st.url).map((row) => row.map((c) => (c ? 1 : 0)).join('')) } : st)
  }

  const routes = { state, open: openRoute, view: viewRoute, close: closeRoute, history: historyRoute, restore: restoreRoute, edit: editRoute, style: styleRoute, bundle: bundleRoute, ref: refRoute, export: exportRoute, doc: docRoute, reveal: revealRoute, phone: phoneRoute, check: checkRoute, locate: locateRoute, tweak: tweakRoute, systems: systemsRoute, systhumb: systhumbRoute, project: projectRoute }
  for (const [key, handler] of Object.entries(routes)) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: API + key,
      handler: (req, res) => {
        Promise.resolve(handler(req, res)).catch((e) => {
          log(e)
          if (!res.headersSent) json(res, 500, { error: 'internal' })
        })
      },
    }), `dsh-design-studio: ${key} route`)
  }

  // ── 自动发现 ──────────────────────────────────────────────────────────────

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      try {
        if (session && event && session.id) tracker.observe(session.id, event)
      } catch (e) {
        log(e)
      }
    })
  }
}
