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

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { createHub, webOrigins, trustedOrigins, resolveInRoot, ERR_CATCHER, defang } from './serve.js'
import { bundle, inlinePicker, strictMeta, MAX_TOTAL as BUNDLE_MAX } from './bundle.js'
import { createLibrary } from './works.js'
import { createInspiration } from './inspire.js'
import { pickStyleText } from './styles.js'
import { createLibraryRoutes } from './gallery/routes.js'
import { createMarket } from './gallery/market.js'
import { createMarketRoutes } from './gallery/market-routes.js'
import { createPhotos, loadPhotoIndex, searchPhotos, onlyByTheme, ratioNote, isPhotoAsset, orientOf, MAX_PHOTOS } from './photos.js'
import { createTracker, parseTarget, findRule, KINDS } from './core.js'
import { createDrafts } from './draft.js'
import { createHistory } from './history.js'
import { createPhone } from './phone.js'
import { qrMatrix } from './qr.js'
import { makePdf, makePptx, jpegInfo } from './doc.js'
import { createBrowser } from './browser.js'
import { designOf, fitSize, metaOfFile, sizeOf, pickScreens, measureAll, shootAll, cropIssues, formatMeasure, issueSnapshot, formatShots, whereOf, MAX_SCREENS, MAX_SIZES, MAX_SHOTS, MAX_CROPS } from './look.js'
import { SYSTEMS_DIR, extractSystem, listSystems, setDefault, skillSection } from './system.js'
import { readTweaks, applyTweaks, lintTweaks } from './tweaks.js'
import { readAnnotations, lintAnnotations, annotationFindings, annotationSection } from './annotations.js'
import { FRAMEWORKS, detectProject, projectFor, defaultFramework, buildHandoff, compareScreens, implUrl, defaultDest, pickedDest, within, pinRoots } from './handoff.js'

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
export const studio = { tracker: null, autoOpen: 0, offline: 0, annotations: 0, check: null, browser: null, market: null, photos: null, sessionCwd: null, log: () => {} }

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
    if (studio.annotations > 0) extra += annotationSection()
    return { name, description, whenToUse, invocation, provider, source, resourceBase, content: (await fs.promises.readFile(designSkill.locator, 'utf8')) + extra }
  },
}

/** preview_page 工具（tool.js 挂到 DSH；不在这个文件的 apply 里挂，好让它单独开关、也能挂进设计模式） */
export const previewTool = {
  name: 'preview_page',
  description:
    '在右侧栏「设计工作台」里实时打开一个页面，用户能边看边点选要改的地方。' +
    '做网页、App 界面、小程序、海报、幻灯片、邮件这类界面设计时用：写好第一个 HTML 文件、或启动开发服务器后调一次就行，之后改文件会自动刷新，不用再调。' +
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
      description: '设计类型：web 网页（默认）、app 手机 App 界面（390×844）、miniprogram 微信小程序（375×812，外框带右上角胶囊）、tablet 平板、desktop 桌面软件（1280×800 的 Mac 窗口；Windows 软件在页面 meta 写 desktop windows）、poster 海报 / 社媒图（1080×1350）、slides 幻灯片（16:9）、email 邮件',
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
    const over = st.hidden ? `右侧最多显示 ${st.screens.length} 屏，还有 ${st.hidden} 屏没显示。` : ''
    return {
      text: `已在右侧「设计工作台」打开 ${what}。${target.kind === 'file' ? '这个目录里的文件一改就自动刷新。' + many : '开发服务器的热更新照常生效。'}${over}`,
      url: st.url,
    }
  },
}

/** 无头浏览器用的尺寸：没写尺寸的幻灯片 / 海报按页面实际大小（和右侧栏的画幅一样） */
const fitted = (b, d, names) => (d.auto && b && b.available() ? fitSize(b, pickScreens(d.snap, names, names && names.length ? 40 : 6).list, d.kind, d.size) : d.size)

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
    const design = designFor(id)
    const { snap, kind } = design
    const want = sizesFrom(a.sizes, kind)
    const b = studio.browser
    const anAt = annotationsAt(id) // 开始量时的设计目录和标注：量的过程中换了设计也不串
    if (b && b.available()) {
      try {
        const pick = pickScreens(snap, a.screens, MAX_SCREENS)
        if (!pick.list.length) return { text: `没找到要量的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
        const sizes = want.sizes.length ? want.sizes : [await fitted(b, design, a.screens)]
        const rows = await measureAll(b, { screens: pick.list, sizes, kind, dark: !!a.dark, annots: annotsByPage(anAt.ann), locate: (items) => locateRules(studio.tracker.stateOf(id), items) })
        if (rows.some((r) => !r.error)) {
          // 同一个会话上次量的结果：这次比一比修好了几个、新出了几个
          const prev = lastChecks.get(id) || null
          // 严重问题的局部截图（截不成就不附；附件库用不了的老版本 DSH 不截，清单照样给）
          let crops = []
          if (a.images !== false && ctx && typeof ctx.get === 'function' && ctx.get('attachments')) {
            try { crops = await cropIssues(b, rows, { screens: pick.list, dark: !!a.dark, kind }) } catch (e) { studio.log(e) }
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
          text += tweakNotes(id) + annotationNotes(anAt, rows)
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
    return { text: note + (r.error || r.text) + tweakNotes(id) + annotationNotes(anAt, null) }
  },
}

/** 这个会话现在的设计目录和里面的业务标注（开关关着、不是本地文件时 root 是 ''） */
function annotationsAt(id) {
  if (!(studio.annotations > 0)) return { root: '', ann: null }
  try {
    const t = studio.tracker.stateOf(id).target
    if (t && t.kind === 'file') return { root: t.root, ann: readAnnotations(t.root) }
  } catch (e) { studio.log(e) }
  return { root: '', ann: null }
}

/** 按屏分好的业务标注：无头浏览器量的时候顺手核对定位 */
function annotsByPage(r) {
  if (!r || !r.list.length) return null
  const m = new Map()
  for (const a of r.list) { if (!m.has(a.page)) m.set(a.page, []); m.get(a.page).push({ id: a.id, selector: a.selector, fallbackText: a.fallbackText }) }
  return m
}

/** 业务标注写坏的、定位不到的：check_design 末尾附上（at：开始量时的目录和标注；rows：无头浏览器量的结果，没量成是 null） */
function annotationNotes(at, rows) {
  if (!at.root) return ''
  let list = []
  try {
    list = lintAnnotations(at.root)
    const r = at.ann
    if (r && rows) list.push(...annotationFindings(r.list, rows.filter((x) => Array.isArray(x.annots)).map((x) => ({ page: x.key, list: x.annots }))))
    else if (r && r.list.length) list.push('这次没有无头浏览器，选择器定位不到的情况没核对；右侧栏「业务标注」面板里能看到')
  } catch (e) { studio.log(e) }
  return list.length ? `\n\n业务标注（annotations.json）：\n${list.map((x) => `- ${x}`).join('\n')}` : ''
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
    const design = designFor(id)
    const { snap, kind } = design
    const want = a.size ? sizeOf(a.size, kind) : await fitted(b, design, a.screens)
    if (!want) return { text: `认不出尺寸「${String(a.size).slice(0, 20)}」：写成 375x667，或只写宽度 375。` }
    const at = ['top', 'bottom', 'full'].includes(a.at) ? a.at : 'top'
    const pick = pickScreens(snap, a.screens, MAX_SHOTS)
    if (!pick.list.length) return { text: `没找到要截的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
    const shots = await shootAll(b, { screens: pick.list, size: want, at, selector: a.selector, dark: !!a.dark, kind, max: MAX_SHOTS })
    const good = shots.filter((s) => s.jpg).slice(0, MAX_SHOTS)
    const text = formatShots(shots, { where: whereOf(snap), missing: pick.missing, more: pick.more, kind })
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
    '用户说「转成代码」「做成真的项目」「用 React / Vue / uni-app 做出来」「做成小程序」时先调它，读 HANDOFF.md 照着做；每做完一屏用 compare_design 和设计稿比一遍，差异降到 3% 以下再做下一屏（原生小程序在浏览器里跑不起来，照 HANDOFF.md 说的请用户在微信开发者工具里看）。' +
    'framework：same 跟目标目录现有项目一样（认得出框架时默认，uni-app（含 HBuilderX 建的、没有 package.json 的）、Taro、微信原生小程序也认得出）、react、vue、next、html、uniapp、weapp；dest：代码放哪个目录（不填：会话目录是项目就放进去，不是就新建 <设计名>-app）。要先用 preview_page 打开过设计。',
  parameters: specToJsonSchema({
    framework: { type: 'string', enum: ['same', ...Object.keys(FRAMEWORKS)], description: 'same 跟现有项目一样；react（React + Vite）、vue（Vue 3 + Vite）、next（Next.js）、html（纯 HTML / CSS）、uniapp（uni-app，出微信小程序和网页版）、weapp（微信原生小程序 WXML / WXSS）。不填：目标目录（或它所在的项目）认得出框架就 same，没有 package.json 的纯 HTML 站点 html，小程序的设计 uniapp，别的 react' },
    dest: { type: 'string', description: '代码放哪：现有项目的目录（或它里面的子目录），或要新建的项目目录（绝对路径或相对会话目录）。不填：会话目录有 package.json 就放进去，没有就新建 <设计名>-app（设计目录在会话目录下就建在会话目录里，不然建在设计目录旁边）' },
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
    const design = designFor(id)
    const { kind } = design
    const size = await fitted(studio.browser, design, a.screens)
    const pick = pickScreens(snap, a.screens, 12)
    if (!pick.list.length) return { text: `没找到要转的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、')}` }
    const cwd = studio.tracker.cwdOf(id)
    // 先定下最终放哪（没给就和右侧栏建议的一样），再按真实路径查是不是在设计目录里
    const dest = typeof a.dest === 'string' && a.dest.trim() ? resolvePath(a.dest, cwd) : defaultDest(t.root, cwd, detectProject(cwd))
    if (within(dest, t.root)) return { text: `代码别放进设计目录（${t.root}）里：设计稿留着做对比。换一个目录。` }
    const project = projectFor(dest)
    const framework = typeof a.framework === 'string' && (a.framework === 'same' || FRAMEWORKS[a.framework]) ? a.framework : defaultFramework(project, kind)
    if (framework === 'same' && !project.framework) return { text: `${dest} 里没有认得出的前端项目（package.json 里没有 React / Vue / Next / uni-app …，也不是 HBuilderX 或微信原生小程序的项目）：framework 选 react、vue、next、html、uniapp 或 weapp。` }
    let r
    try {
      r = await buildHandoff(studio.browser, { root: t.root, screens: pick.list, kind, size, framework, dest, project, system: systemOfDir(t.root), annotations: studio.annotations > 0 ? readAnnotations(t.root) : null })
    } catch (e) {
      return { text: `没写成交接包：${String((e && e.message) || e).slice(0, 200)}` }
    }
    // 原生小程序跑不了网页版：比不了，照 HANDOFF.md 请用户在微信开发者工具里看
    const native = framework === 'weapp' || (framework === 'same' && project.framework === 'weapp')
    const head = `交接包写好了：${r.file}（${r.shots} 张截图在 handoff/shots/）。下面是全文，照「做法和验收」一屏一屏做，${native ? '每屏做完请用户在微信开发者工具里看' : '每屏做完用 compare_design 比'}。\n\n`
    // 每屏顶上一张附上，直接看到要做成什么样
    const firsts = r.rows.filter((row) => row.shots.length).slice(0, 4).map((row) => ({ key: row.key, jpg: fs.readFileSync(path.join(r.dir, 'shots', row.shots[0])) }))
    const kept = firsts.length ? await keepImages(ctx, id, firsts) : {}
    return kept.images ? { text: head + r.md, images: kept.images } : { text: head + r.md }
  },
}

const ORIENT = { landscape: '横图', portrait: '竖图', square: '方图' }

/** find_photos 工具：从自带照片库按描述找图，复制进设计目录（图用本地文件，分享、导出、离线预览都带得走） */
export const photoTool = {
  name: 'find_photos',
  description:
    '从设计台自带的照片库里按描述找照片，复制进设计目录的 assets/，返回能直接写进 HTML 的相对路径和替代文字。' +
    '民宿酒店、餐饮、奶茶咖啡、健身、美妆、服饰、教育、旅行风景这类靠照片说话的设计，需要头图、封面、商品图时用，别画插画冒充照片。' +
    '库里是 AI 生成的示意图；用户给了自己的照片就用用户的。',
  parameters: specToJsonSchema({
    query: { type: 'string', required: true, description: '要什么样的照片，中文英文都行，带上题材和画面，如「民宿 卧室」「奶茶 手拿」「gym interior」' },
    dir: { type: 'string', description: '这套设计的文件夹（绝对路径或相对会话目录），图放进它的 assets/。不填用正在预览的设计目录' },
    count: { type: 'number', description: `要几张，1–${MAX_PHOTOS}，默认 3` },
    ratio: { type: 'string', enum: Object.keys(ORIENT), description: 'landscape 横图、portrait 竖图、square 方图；不够时会补别的比例（用 object-fit: cover 裁）' },
  }),
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args, exec) {
    const id = toolSession(exec, '找照片')
    const a = args || {}
    const photos = studio.photos
    if (!photos) return { text: '这个版本的设计台没带照片库。这次用 CSS / SVG 画，并告诉用户这里需要一张什么样的照片。' }
    const query = typeof a.query === 'string' ? a.query.trim() : ''
    if (!query) return { text: 'query 不能空：写要什么样的照片，如「民宿 卧室」。' }
    const cwd = studio.sessionCwd ? await studio.sessionCwd(id) : studio.tracker.cwdOf(id)
    const t = studio.tracker.stateOf(id).target
    const root = t && t.kind === 'file' ? t.root : ''
    const dir = typeof a.dir === 'string' && a.dir.trim() ? resolvePath(a.dir, cwd) : root
    if (!dir) return { text: '不知道放哪：先建好这套设计的文件夹，把路径写进 dir。' }
    const allowed = pinRoots([cwd, root])
    if (!allowed(dir)) return { text: `${dir} 不在会话目录（${cwd}）里，图不能放那儿。放进这套设计自己的文件夹。` }
    const ratio = Object.hasOwn(ORIENT, a.ratio) ? a.ratio : ''
    const search = (used) => searchPhotos(photos.index, { query, ratio, count: a.count, used, seed: dir })
    // 先搜一遍：库里没有就不用下载
    if (!search(new Set()).length) {
      const names = Object.values(photos.index.themes).map((x) => x.label).join('、')
      return { text: `库里没有符合「${query}」的照片。现有题材：${names}。换个说法再找；实在没有就用 CSS / SVG 画，并告诉用户这里需要一张什么样的照片。` }
    }
    try {
      const placed = await photos.provide({ dir, allowed, pick: search })
      const want = Math.min(MAX_PHOTOS, Math.max(1, Math.floor(Number(a.count)) || 3))
      const broad = onlyByTheme(photos.index, { query })
      const few = !broad && placed.length < want ? `具体画面只找到这 ${placed.length} 张；要更多就只写题材再搜一次。\n` : ''
      const list = placed.map(({ p, rel }, i) => `${i + 1}. ${rel}（${ORIENT[orientOf(p.w, p.h)]} ${p.w}×${p.h}）alt：${p.alt} / ${p.altEn}`)
      return {
        text:
          `${broad ? `按题材找到 ${placed.length} 张（没有和「${query}」里具体画面对得上的标签，看描述合不合适再用；不合适就用 CSS / SVG 画，并告诉用户这里需要什么样的照片）` : `找到 ${placed.length} 张`}，已放进 ${path.join(dir, 'assets')}：\n${list.join('\n')}\n${few}${ratioNote(placed.map((x) => x.p), ratio)}` +
          '这是按关键词找的，先看上面的描述和需求对不对得上，对不上的别用（没用上的图不会进分享包）。\n' +
          '用法：<img src="assets/文件名" alt="…"> 配 object-fit: cover；alt 按界面语言选一个；HTML 不在这个文件夹时改相对路径。\n' +
          '这些是 AI 生成的示意图，不是用户真实的店铺或产品：别写「实拍」，也别把图上的场景当事实写进文案；做完告诉用户上线前换成真实照片。',
      }
    } catch (e) {
      studio.log(e)
      if (e && e.code === 'off') return { text: '「设计库不联网」开着，照片库下载不了。这次用 CSS / SVG 画，并告诉用户：关掉这个开关就能用自带照片。' }
      if (e && e.code === 'link') return { text: `${path.join(dir, 'assets')} 指向了这个文件夹外面，图不能放那儿。` }
      if (e && /^(EACCES|EPERM|EROFS|ENOTDIR|EEXIST|ENOSPC)$/.test(e.code || '')) return { text: `${path.join(dir, 'assets')} 写不进去（${e.code}）。换一个文件夹，或者这次用 CSS / SVG 画。` }
      return { text: '照片库这会儿下载不了（网络问题）。这次先用 CSS / SVG 画，并告诉用户这里需要一张什么样的照片，稍后可以再试。' }
    }
  },
}

/** pick_style 工具：用户没定风格时按题材挑一张风格卡（模型自己定，消费类题目总落回米色暖调；给了具体配色它照做得很好） */
export const styleTool = {
  name: 'pick_style',
  description:
    '新做一套设计、用户没定风格时，开工前先调这个：按题材挑一张风格卡，返回整套配色、字体、圆角阴影和要点，照它定进 tokens.css。' +
    '用户点了风格卡（消息里有〔风格〕）、自己定了具体的风格或配色、或有默认的品牌设计系统时不用调；只说「你定」「帮我推荐一个」「出几个风格挑」算没定，要调。',
  parameters: specToJsonSchema({
    subject: { type: 'string', required: true, description: '这次要做什么，直接写用户的原话' },
    kind: { type: 'string', enum: ['web', 'app', 'miniprogram', 'tablet', 'desktop', 'poster', 'slides', 'email'], description: '设计类型' },
    count: { type: 'number', description: '要几个方向，1–3，默认 1；要先出三个方向时填 3，每个方向一张不同的卡' },
  }),
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args) {
    const a = args || {}
    const subject = typeof a.subject === 'string' ? a.subject.trim() : ''
    if (!subject) return { text: 'subject 不能空：写这次要做什么，用用户的原话。' }
    return { text: pickStyleText(subject, typeof a.kind === 'string' ? a.kind : '', a.count) }
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
    const design = designFor(id)
    const { kind } = design
    const want = a.size ? sizeOf(a.size, kind) : await fitted(b, design, typeof a.screen === 'string' && a.screen.trim() ? [a.screen] : null)
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

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '' } catch { return '' } })()

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
  // 我的作品 + 哪些文件是别人做的（设计库来的）：别人做的、没改过的页面预览时加硬规矩
  const library = createLibrary({ log })
  // 设计市场：目录和批次包从 npm 镜像来，验过签名、逐个文件核对过才用；市场上的页面原样预览时也加硬规矩
  const seedDir = fileURLToPath(new URL('../gallery-seed', import.meta.url))
  // 「设计库不联网」那行开着：市场不访问任何网址
  const market = createMarket({ version: VERSION, log, seedDir: fs.existsSync(path.join(seedDir, 'index.json')) ? seedDir : '', online: () => studio.offline === 0 })
  const drafts = createDrafts({ log }) // 正在写的页面（边写边看）：tracker 往里推，预览服务器往外吐
  const hub = createHub({
    log,
    history,
    drafts,
    skipAnnots: () => studio.annotations > 0, // 业务标注开着时这个文件只给右侧栏看，改了不刷新页面
    strict: { html: (buf) => library.strictHtml(buf) || market.strictHtml(buf), root: (dir) => library.strictRoot(dir) || market.isStaging(dir), versions: (dir) => library.strictVersions(dir) },
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
    drafts,
    log,
    history,
    // 记会话的同时，在做的设计目录补进「我的作品」
    store: { load: fileStore.load, save: (data) => { fileStore.save(data); try { library.sync(data) } catch (e) { log(e) } } },
    alive: (origin) => hub.alive(origin),
    autoOpen: () => studio.autoOpen > 0,
    // 装好的别人的设计系统退回旧版：退回来的页面先记成别人做的（预览照样加规矩）
    beforeRestore: (root, html) => { if (html.length) library.addPast(root, html) },
    skipPorts: () => {
      const s = new Set(previewPorts)
      const own = ownHost(ctx).split(':')[1]
      if (own) s.add(Number(own))
      return s
    },
  })
  ctx.effect(() => () => { drafts.clear(); hub.closeAll() }, 'dsh-design-studio: preview servers')
  ctx.effect(() => {
    studio.tracker = tracker
    studio.log = log
    studio.market = market
    const photoIndex = loadPhotoIndex()
    const photos = photoIndex ? createPhotos({ market, index: photoIndex, log }) : null
    studio.photos = photos
    studio.sessionCwd = sessionCwd
    return () => {
      if (studio.tracker === tracker) { studio.tracker = null; studio.log = () => {} }
      if (studio.market === market) { market.abort(); studio.market = null }
      if (studio.photos === photos) studio.photos = null
      if (studio.sessionCwd === sessionCwd) studio.sessionCwd = null
    }
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

  /** 业务标注：开关开着才有这个键（null = 还没有文件）。an 是右侧栏手上那份的签名，没变就不再传一遍（一份可能上百 KB，轮询很勤） */
  function annotsField(session, an = '') {
    const t = tracker.stateOf(session).target
    if (!(studio.annotations > 0) || !t || t.kind !== 'file') return {}
    let annotations = null
    try {
      const r = readAnnotations(t.root)
      annotations = r && an && r.sig === an ? { sig: r.sig, same: true } : r
    } catch (e) { log(e) }
    return { annotations }
  }

  function state(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    const ph = phone.status(session)
    const c = checks.get(session)
    // 调节滑块：tweaks.json 改了（模型写的 / 写回的）右侧栏跟着变
    const t = tracker.stateOf(session).target
    let tweaks = null
    if (t && t.kind === 'file') { try { tweaks = readTweaks(t.root) } catch (e) { log(e) } }
    const snap = tracker.snapshot(session)
    json(res, 200, { ...snap, strict: strictScreens(snap), phone: { on: ph.on, seen: ph.seen || 0 }, tweaks, ...annotsField(session, new URL(req.url, 'http://x').searchParams.get('an')), ...(c ? { checkReq: c.id } : {}) })
  }

  /** 正在看的几屏里，哪些是别人做的、没改过的（地址列表）：右侧栏给它们的 iframe 加沙盒、不给剪贴板 */
  const strictCache = new Map() // 文件 → { sig, strict }
  function strictScreens(snap) {
    const t = snap.target
    if (!t || t.kind !== 'file' || !Array.isArray(snap.screens)) return []
    const out = []
    const files = new Set([...snap.screens.map((s) => s.key), snap.focus].filter(Boolean))
    for (const key of files) {
      const file = path.join(t.root, key)
      let st
      try { st = fs.statSync(file) } catch { continue }
      const sig = `${st.mtimeMs}:${st.size}:${library.file && fs.existsSync(library.file) ? fs.statSync(library.file).mtimeMs : 0}`
      let hit = strictCache.get(file)
      if (!hit || hit.sig !== sig) {
        let strict = false
        try { strict = st.size <= 8 * 1024 * 1024 && library.strictHtml(fs.readFileSync(file)) } catch { strict = false }
        hit = { sig, strict }
        strictCache.set(file, hit)
        if (strictCache.size > 500) strictCache.delete(strictCache.keys().next().value)
      }
      if (hit.strict) out.push(`${snap.origin}/${encodeURIComponent(key)}`)
    }
    return out
  }

  /** 调节滑块写回文件：values = { id: 值 }；外观面板里直接改的设计变量：vars = { '--名字': 值 } */
  async function tweakRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {}
    try {
      const vars = body.vars && typeof body.vars === 'object' && !Array.isArray(body.vars) ? body.vars : null
      const r = tracker.editDir(String(body.session || ''), (root) => applyTweaks(root, values, vars), (x) => `调节：${x.changed.map((c) => `${c.label} ${c.to}`).join('、')}`.slice(0, 60), String(body.root || ''))
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
  async function projectRoute(req, res) {
    if (!admit(req, res)) return
    const q = new URL(req.url, 'http://x').searchParams
    const session = q.get('session') || ''
    // 新会话（还没跑过工具，比如从设计库「用这个开始」、浏览打开的）插件不知道目录：问 DSH，别拿家目录当项目找
    const cwd = await sessionCwd(session)
    const p = detectProject(cwd)
    const t = tracker.stateOf(session).target
    const root = t && t.kind === 'file' ? t.root : ''
    // root 一起回去：右侧栏按它认这份建议是不是给现在这套设计的；project 按最终放的目录认（默认框架跟着它选）
    // 带 dest：用户刚选了个文件夹，按它定最终放哪
    const picked = (q.get('dest') || '').trim()
    const pk = picked ? pickedDest(resolvePath(picked, cwd), root) : null
    const dest = pk ? pk.dest : defaultDest(root, cwd, p)
    const project = projectFor(dest)
    // 设计类型跟着回去：小程序的设计右侧栏多两个选项（uni-app、原生小程序），默认 uni-app
    const kind = root ? designFor(session).kind : ''
    json(res, 200, { cwd, root, kind, project, fw: defaultFramework(project, kind), dest, why: pk ? pk.why : '', frameworks: Object.fromEntries(Object.entries(FRAMEWORKS).map(([k, v]) => [k, v.label])) })
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
      // 输入框里写的相对路径按会话目录算（新会话也问 DSH 要）
      const target = parseTarget(body.target, await sessionCwd(session))
      await tracker.setTarget(session, target, { source: 'user', popup: false })
      json(res, 200, { ...tracker.snapshot(session), ...annotsField(session) })
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
      json(res, 200, { ...tracker.snapshot(session), ...annotsField(session) })
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
      // 别人做的设计（设计库来的、没改过）：加硬规矩，右侧栏的沙盒也不放行表单
      const strict = library.strictHtml(page) || (v > 0 && library.strictVersions(t.root))
      const nonce = strict ? crypto.randomBytes(16).toString('base64') : ''
      const lead = strict ? strictMeta(nonce) + ERR_CATCHER.replace('<script>', `<script nonce="${nonce}">`) : ERR_CATCHER
      let html = bundle(strict ? defang(page.toString('utf8')) : page.toString('utf8'), { key, read, base: href, lead, tail: inlinePicker(fs.readFileSync(PICKER_FILE, 'utf8'), parent, href, nonce) })
      // 打包后图片变成 data: 地址，文件名没了：把用到的 AI 示意图记在页面里，导出时照样提醒
      const aiNames = [...deps].filter((x) => isPhotoAsset(x)).map((x) => path.basename(x))
      if (aiNames.length) html = html.replace(lead, () => `${lead}<meta name="ddp-ai-photos" content="${aiNames.join(',').replace(/[^a-z0-9.,-]/gi, '')}">`)
      // 用到的文件太多就不列（null = 右侧栏不按文件筛，目录里一有改动就重新打包）
      json(res, 200, { html, deps: deps.size > 200 ? null : [...deps], strict })
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

  /** 导出途中换了设计：还按开始时的那套比一下，对不上就不存（不然 A 的文件会落到 B 的 exports/ 里） */
  const targetKeyOf = (t) => (!t ? '' : t.kind === 'file' ? `file|${t.root}` : `proxy|${t.port}`)
  function targetMoved(res, session, expect) {
    if (typeof expect !== 'string' || !expect || expect === targetKeyOf(tracker.stateOf(session).target)) return false
    json(res, 409, { error: 'designChanged' })
    return true
  }

  async function exportRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_EXPORT) } catch (e) { return json(res, 400, { error: e.message }) }
    const buf = Buffer.from(String(body.png || ''), 'base64')
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return json(res, 400, { error: '不是 PNG' })
    if (targetMoved(res, String(body.session || ''), body.target)) return
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
      const bg = String(body.bg || '')
      const opts = { layout: String(body.layout || '').slice(0, 20), cols: body.cols === 2 ? 2 : 1 }
      buf = format === 'pdf' ? makePdf(pages, { title, bg, ...opts }) : makePptx(pages, { title, bg, ...opts })
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
    if (targetMoved(res, String(body.session || ''), body.target)) return
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
    // 画笔标注带着画的那份设计的目录来：这期间换了设计，别把旧图存进新设计
    if (typeof body.root === 'string' && !(st.target && st.target.kind === 'file' && st.target.root === body.root)) return json(res, 409, { error: 'moved' })
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

  // 设计库：我的作品、灵感、打 zip、拖 zip 进来用
  const inspiration = createInspiration({ log })
  /**
   * 会话目录：跑过工具的会话插件自己记着；新会话（还没跑过工具）问 DSH——先看活着的会话，再查存下来的会话头。
   * 都拿不到给家目录（「用这个开始」就放到 ~/DSH 设计）
   */
  async function sessionCwd(id) {
    const known = tracker.cwdOf(id)
    if (known && path.resolve(known) !== path.resolve(os.homedir())) return known
    const ok = (c) => typeof c === 'string' && path.isAbsolute(c) ? c : ''
    try {
      const ss = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      const live = ss && typeof ss.list === 'function' ? [...ss.list()].find((s) => s && s.id === id) : null
      const c = live && ok(live.header && live.header.cwd)
      if (c) return c
    } catch (e) { log(e) }
    try {
      const q = ctx && typeof ctx.get === 'function' ? ctx.get('sessionQuery') : null
      if (q && typeof q.listSessions === 'function') {
        const rec = (await q.listSessions()).find((r) => r && r.header && r.header.id === id)
        const c = rec && ok(rec.header.cwd)
        if (c) return c
      }
    } catch (e) { log(e) }
    return known
  }
  const lib = createLibraryRoutes({ admit, readBody, json, tracker, library, inspiration, studio, open, storeLoad: fileStore.load, version: VERSION, exported, log, sessionCwd })
  const mk = createMarketRoutes({ admit, readBody, json, tracker, library, market, open, systemsDir: SYSTEMS_DIR, log, sessionCwd })

  const routes = { works: lib.works, workthumb: lib.workthumb, pack: lib.pack, usezip: lib.usezip, ghauth: lib.ghauth, submit: lib.submit, inspire: lib.inspire, inspimg: lib.inspimg, ...mk, state, open: openRoute, view: viewRoute, close: closeRoute, history: historyRoute, restore: restoreRoute, edit: editRoute, style: styleRoute, bundle: bundleRoute, ref: refRoute, export: exportRoute, doc: docRoute, reveal: revealRoute, phone: phoneRoute, check: checkRoute, locate: locateRoute, tweak: tweakRoute, systems: systemsRoute, systhumb: systhumbRoute, project: projectRoute }
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
    // 模型边说边推的流：写大文件时参数要流好几分钟，靠它提前知道在写哪个文件（老版本 DSH 没有这个事件，就只是收不到）
    ctx.on('agent/assistant-stream', (e) => {
      try {
        const id = e && e.agent && e.agent.session && e.agent.session.id
        if (id && e.frame) tracker.stream(id, e.frame)
      } catch (err) {
        log(err)
      }
    }, { global: true })
  }
}
