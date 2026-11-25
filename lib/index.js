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
 *     POST /dsh-design-studio/api/drift            共用部件各屏写得不一样（体检面板单独一组）{ session } → { items, more, total }
 *     POST /dsh-design-studio/api/states           各屏写了哪几个状态（导出「每个状态各出一张」）{ session } → { map: { key: [{ name, label }] } }
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
 *     POST /dsh-design-studio/api/pubshare         公网链接（实验）：{ session, on: true, …整套演示的参数 } 用 cloudflared 临时通道放出整套 HTML 演示、
 *                                                   { on: false } 关掉、{ peek: true } 看状态（带二维码）、{ update: true, … } 换参数、
 *                                                   { download: true } 下载 cloudflared（人点了才下）、{ cancel: true } 取消下载
 *
 * 页面本身由 serve.js 开的独立端口提供（见那边的说明）。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { createHub, webOrigins, trustedOrigins, resolveInRoot, ERR_CATCHER, stateScript, defang } from './serve.js'
import { bundle, dataAssets, inlinePicker, strictMeta, MAX_TOTAL as BUNDLE_MAX } from './bundle.js'
import { buildPack, PACK_SCREENS } from './htmlpack.js'
import { createLibrary } from './works.js'
import { createInspiration } from './inspire.js'
import { pickStyleText } from './styles.js'
import { createLibraryRoutes } from './gallery/routes.js'
import { createMarket } from './gallery/market.js'
import { createMarketRoutes } from './gallery/market-routes.js'
import { createPhotos, loadPhotoIndex, searchPhotos, onlyByTheme, ratioNote, isPhotoAsset, orientOf, MAX_PHOTOS } from './photos.js'
import { createTracker, parseTarget, findRule, allScreens, classSigs, exportOrder, KINDS } from './core.js'
import { createDrafts } from './draft.js'
import { createHistory } from './history.js'
import { createPhone } from './phone.js'
import { createPublicShare } from './tunnel.js'
import { qrMatrix } from './qr.js'
import { makePdf, makePptx, jpegInfo } from './doc.js'
import { createBrowser } from './browser.js'
import { createCanvasThumbs, createDirRevs } from './canvthumb.js'
import { designOf, fitSize, metaOfFile, sizeOf, pickScreens, measureAll, shootAll, cropIssues, formatMeasure, issueSnapshot, formatShots, whereOf, MAX_SCREENS, MAX_SIZES, MAX_SHOTS, MAX_CROPS } from './look.js'
import { SYSTEMS_DIR, extractSystem, listSystems, setDefault, skillSection } from './system.js'
import { saveFrame, listFrames, frameSection, frameDir, renameFrame, removeFrame } from './frames.js'
import { readTweaks, applyTweaks, lintTweaks, syncFonts, lintFonts, libFontsUsed, setVarDecl, setVarInHtml } from './tweaks.js'
import { createFonts, loadFontIndex, loadFontPreviews, libFontOf, findFont, stackOf, syncFontBlock, fontBlockIds, fontPrefix, libFontIdOf, FONT_DIR } from './fonts.js'
import { readAnnotations, lintAnnotations, annotationFindings, annotationSection } from './annotations.js'
import { createImpl } from './impl.js'
import { FRAMEWORKS, detectProject, projectFor, defaultFramework, HANDOFF_BATCH_SIZE, handoffScreens, findHandoffScreen, handoffBatch, buildHandoff, compareScreens, implUrl, implServe, defaultDest, pickedDest, within, pinRoots, frameCss } from './handoff.js'
import { editsNotice, noticeMessage, langOf } from './edits.js'
import { statesOfFile, expandStates, splitStateNames, withState } from './states.js'
import { MOCK_FILE, MOCK_MAX, mockOf, mockOfBuf, mockScript, saveMock } from './mock.js'
import { partDrift, formatDrift } from './drift.js'
import { expandPreview, precheckScreens, dirReader, versionReader, designComponents, formatComponents, pageUsesComponents, hasCompDir } from './comp-io.js'

export const name = 'dsh-design-studio'
export const inject = ['webServer']

const API = '/dsh-design-studio/api/'
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
/**
 * DSH 的 WebServer 准入（0.2.2 起，默认 auth: 'required'）把验过登录与来源的 Peer 作为 handler 最后一个参数传进来。
 * 拿到它说明这一条请求 DSH 已经放过了，不用再按「只认本机」挡一次——否则从局域网地址、反向代理、域名进来的
 * 请求会被这一层挡掉（DSH 0.2.3 起 connection 的 requestRejection 也删了，老写法没有别的放行途径）。
 * 只认主人（peer.principal.kind === 'owner'，DSH 自己的共享接口也这么判）：别的身份直接 403。
 * 老版本 DSH 没有这个参数：req 上不会有这个标记，退回原来的 connection / loopback 判断。
 */
const ADMITTED = Symbol('dsh-design-studio:admitted-peer')
const MAX_BODY = 64 * 1024
const MAX_EXPORT = 48 * 1024 * 1024 // 导出图片的请求体（base64）
const MAX_DOC = 160 * 1024 * 1024 // 导出 PDF / PPT 的请求体（几十屏的 JPEG，base64）
const MAX_PAGES = 1000 // PDF / PPT 最多几页（#29：画布只显示 60 屏，导出要全部）
const DOC_CHUNK = 40 // 分批传的时候一批最多几页（截图一张几百 KB，几百屏一次传不动）
const DOC_JOB_BYTES = 1024 * 1024 * 1024 // 一份 PDF / PPT 攒的图片最多这么多
const DOC_JOB_TTL = 10 * 60 * 1000 // 一批传完到下一批最多等多久（右侧栏关了、换了设计就别一直占着内存）
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
export const studio = { tracker: null, impl: null, openPreview: null, autoOpen: 0, offline: 0, annotations: 0, check: null, browser: null, market: null, photos: null, fonts: null, sessionCwd: null, log: () => {} }

/** 设计技能：模型做界面设计时加载（DSH 的 skill 工具），也能让用户手动调 */
export const designSkill = {
  name: 'ui-design',
  description:
    '做网页、App 界面、小程序、平板界面、桌面软件、海报 / 社媒图、幻灯片、邮件、图表（思维导图、技术路线图、产品路线图、架构图）、DSH 插件界面、组件这类设计之前先加载；改已有的设计、把几屏重复的部分抽成组件（components/ 写法）也先加载：' +
    '配合右侧「设计工作台」画布的做法（一屏一个文件、设计变量、类型标记）、现代设计原则、中文排版、各类型画幅要点、避免 AI 味、设计自查清单。' +
    '只是把回答做成一页给用户看或用（对比、表格、清单、数据图表、计算器这类，或者在对话里随手看一张导图）不算设计：有 show_page 工具就直接用它，不加载这个技能；' +
    '要「设计」、做好看的、要导出成图片 / PDF / PPT 的思维导图、路线图、架构图才用这个技能。',
  whenToUse: '用户要做或改网站 / App / 海报 / 幻灯片 / 思维导图 / 路线图 / 架构图这类界面或视觉设计时（把回答做成一页、有 show_page 工具时用 show_page）',
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
    try { extra += frameSection() } catch (e) { studio.log(e) }
    if (studio.annotations > 0) extra += annotationSection()
    return { name, description, whenToUse, invocation, provider, source, resourceBase, content: (await fs.promises.readFile(designSkill.locator, 'utf8')) + extra }
  },
}

/** preview_page 工具（tool.js 挂到 DSH；不在这个文件的 apply 里挂，好让它单独开关、也能挂进设计模式） */
export const previewTool = {
  name: 'preview_page',
  description:
    '在右侧栏「设计工作台」里实时打开一个页面，用户能边看边点选要改的地方。' +
    '做网页、App 界面、小程序、海报、幻灯片、邮件、图表（思维导图、路线图、架构图）、DSH 插件界面这类设计时用：写好第一个 HTML 文件、或启动开发服务器后调一次就行，之后改文件会自动刷新，不用再调。' +
    '只是把回答做成一页（对比、表格、清单、数据图表、计算器）给用户看或用时，有 show_page 工具就用它，不用这里。' +
    '本地 HTML 写文件路径；开发服务器写地址或端口（如 http://localhost:5173）。只能预览本机页面。' +
    'kind 说明是哪类设计，右侧按它的画幅显示（App 套手机外框、幻灯片 16:9 …）。' +
    '动手设计前先加载 ui-design 技能（设计流程、规范和自查清单）。' +
    '要做好几屏（App 的几个界面、网站的几个页面）时，每屏一个 HTML 文件放在同一个目录，右侧画布会按生成顺序并排显示，一屏一屏写就行。' +
    '几屏重复的部分（标签栏、顶栏、卡片）抽成组件时：写 components/<名>.html，各屏用 <c-名> 引用，插件展开成普通 HTML（别自己写 JS 自定义元素或运行时注入）；写法见 ui-design 技能的 references/components.md。' +
    '用户在预览里点选的内容会以「〔选中元素〕」或「〔选中区域〕」开头出现在消息里，带 CSS 路径、HTML、关键样式，' +
    '拿得到时还有组件和源码位置：照它找到源码里对应的地方再改。',
  parameters: specToJsonSchema({
    target: { type: 'string', required: true, description: '本地 HTML 文件的绝对路径，或开发服务器地址 / 端口，例如 /Users/me/site/index.html、http://localhost:5173、5173' },
    kind: {
      type: 'string',
      enum: KINDS,
      description: '设计类型：web 网页（默认）、app 手机 App 界面（390×844）、miniprogram 微信小程序（375×812，外框带右上角胶囊）、tablet 平板、desktop 桌面软件（1280×800 的 Mac 窗口；Windows 软件在页面 meta 写 desktop windows）、poster 海报 / 社媒图（1080×1350）、slides 幻灯片（16:9）、email 邮件、diagram 路线图·导图（界面上的叫法；技术路线图 / 申报书、研究框架图、架构图、思维导图、产品路线图，默认 1600×1000，图多大画幅跟着多大）、dshplugin DSH 插件（1280×800，套 DSH 桌面端外框，只设计插件那块：左侧栏入口 / 设置分区 / 会话标签页 / 右侧栏面板）、framed 自定义外壳（外框库里用户自己的外框，界面上叫外壳；画幅跟外框走，只设计槽位里那块）',
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
    // 组件文件（#30）不是一屏：单独打开只是一块碎片，还会把 components/ 当成整套设计
    if (target.kind === 'file' && path.basename(path.dirname(target.file)) === 'components') {
      return { text: `${path.basename(target.file)} 是组件文件，不单独预览：打开用到它的那一屏（设计目录里的页面，比如 ${path.join(path.dirname(path.dirname(target.file)), 'index.html')}）。`, url: '' }
    }
    const opts = { source: 'tool' }
    if (args.kind !== undefined) opts.kind = args.kind
    if (args.size !== undefined) opts.size = args.size
    if (args.screens !== undefined) opts.routes = args.screens
    const st = await tracker.setTarget(id, target, opts)
    const what = target.kind === 'file' ? target.file : `localhost:${target.port}${target.path}`
    const many = target.kind === 'file' ? '同目录再写别的 HTML 文件，会作为新的一屏并排出现。' : ''
    const over = st.hidden ? `右侧最多显示 ${st.screens.length} 屏，还有 ${st.hidden} 屏没显示。` : ''
    return {
      text: `已在右侧「设计工作台」打开 ${what}。${target.kind === 'file' ? '这个目录里的文件一改就自动刷新。' + many : '开发服务器的热更新照常生效。'}${over}${target.kind === 'file' ? compLine(id) : ''}`,
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

/** 共用部件各屏写得不一样（#30 第 1 步）：这套设计（本地文件）所有屏比一遍；没有就是 null */
const driftSeen = new Map() // 目录 → { stamp, r }：各屏没改过就不再读一遍
function driftOf(id) {
  const t = studio.tracker.snapshot(id).target
  if (!t || t.kind !== 'file') return null
  const root = t.root || path.dirname(t.file)
  const keys = allScreens(root)
  if (keys.length < 2) return null
  const stamp = keys.slice(0, 600).map((k) => { try { const s = fs.statSync(path.join(root, k)); return `${k}:${s.mtimeMs}:${s.size}` } catch { return '' } }).join('|')
  const hit = driftSeen.get(root)
  if (hit && hit.stamp === stamp) return hit.r
  let r = null
  try { r = { ...partDrift(root, keys), total: keys.length } } catch (e) { studio.log(e); return null }
  driftSeen.delete(root)
  driftSeen.set(root, { stamp, r })
  if (driftSeen.size > 8) driftSeen.delete(driftSeen.keys().next().value)
  return r
}
const driftNotes = (id) => { const r = driftOf(id); return r ? formatDrift(r, r.total) : '' }

/** 组件（#30）：这套设计（本地文件）各屏组件的错、提醒、没人用的组件；没组件给 null。各屏和组件都没改过就不重算 */
const compSeen = new Map() // 目录 → { stamp, r }
function compOf(id) {
  const t = studio.tracker.snapshot(id).target
  if (!t || t.kind !== 'file') return null
  const root = t.root || path.dirname(t.file)
  const keys = allScreens(root).slice(0, 600)
  // 组件文件、mock.json，还有页面引的本地脚本（接不接管 <c-…> 要看它们有没有自己注册 c-*）
  const files = [...keys, MOCK_FILE, ...(() => { try { return fs.readdirSync(path.join(root, 'components')).map((n) => 'components/' + n) } catch { return [] } })(),
    ...(() => { try { return fs.readdirSync(root).filter((n) => /\.m?js$/i.test(n)) } catch { return [] } })()]
  const stamp = files.map((k) => { try { const s = fs.statSync(path.join(root, k)); return `${k}:${s.mtimeMs}:${s.size}` } catch { return '' } }).join('|')
  const hit = compSeen.get(root)
  if (hit && hit.stamp === stamp) return hit.r
  let r = null
  try {
    let mock = null
    try { const m = mockOf(root); mock = m && !m.err ? m.data : null } catch { mock = null } // 和预览同一套：软链接当没有、太大不读
    r = designComponents(root, keys, dirReader(root), mock)
  } catch (e) { studio.log(e); return null }
  if (!r.items.length && !r.pages.length) r = null
  compSeen.delete(root)
  compSeen.set(root, { stamp, r })
  if (compSeen.size > 8) compSeen.delete(compSeen.keys().next().value)
  return r
}
/** 体检报告末尾：组件的问题（没有就空） */
const compNotes = (id) => { const r = compOf(id); const lines = r ? formatComponents(r) : []; return lines.length ? `\n\n组件（components/）：\n${lines.join('\n')}` : '' }
/** preview_page / check_design 末尾一行短目录：长对话压缩后模型也知道有哪些组件、参数怎么传 */
const compLine = (id) => { const r = compOf(id); return r && r.line ? `\n${r.line}` : '' }

/** 一页多状态（#30）：屏 → 它的文件里写了哪几个状态（不是本地文件的设计当没写） */
function statesOfScreen(id) {
  const t = studio.tracker.snapshot(id).target
  if (!t || t.kind !== 'file') return () => []
  const root = t.root || path.dirname(t.file)
  return (sc) => {
    const hit = sc && typeof sc.key === 'string' ? resolveInRoot(root, sc.key) : null
    return hit && hit.real ? statesOfFile(hit.real) : []
  }
}

/** screens 里点名的状态这屏没写：说出来（这屏有哪几个），别当量过 / 截过了。all：那屏一个都没对上时怎么办的 */
function stateMisses(list, stOf, only, all) {
  if (!only) return ''
  const out = []
  for (const sc of list) {
    const want = only(sc)
    if (!want) continue
    const st = stOf(sc)
    const bad = [...want].filter((n) => !st.some((x) => x.name === n))
    if (!bad.length) continue
    const none = bad.length === want.size
    out.push(`${sc.key} 没有状态 ${bad.join('、')}（${st.length ? `这屏有：${st.map((x) => x.name).join('、')}` : '这屏没写状态'}）${none ? `，${all}` : ''}`)
  }
  return out.length ? `\n点名的状态没找到：${out.join('；')}` : ''
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
    screens: { type: 'array', items: { type: 'string' }, description: '量哪几屏：文件名（home.html 或 home）或开发服务器的路由；不填量全部。写了几个状态的屏每个状态都量，只量某个状态写 order.html?state=paid' },
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
        // 一页多状态（#30）：写了几个状态的屏，每个状态各量一遍；screens 里写了 order.html?state=paid 的只量那个状态
        const sn = splitStateNames(a.screens, (n) => pickScreens(snap, [n], 1).list[0])
        const pick0 = pickScreens(snap, sn.names, MAX_SCREENS)
        if (!pick0.list.length) return { text: `没找到要量的屏：${pick0.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
        const stOf = statesOfScreen(id)
        const ex = expandStates(pick0.list, stOf, { only: sn.only })
        const pick = { ...pick0, list: ex.list }
        const sizes = want.sizes.length ? want.sizes : [await fitted(b, design, sn.names)]
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
          if (ex.skipped) text += `\n状态太多，有 ${ex.skipped} 个状态没量：screens 写成 order.html?state=状态名 单量那个状态`
          text += stateMisses(pick0.list, stOf, sn.only, '量的是这屏全部状态')
          text += tweakNotes(id) + fontNotes(id) + annotationNotes(anAt, rows) + driftNotes(id) + compNotes(id) + compLine(id)
          return kept && kept.images ? { text, images: kept.images } : { text }
        }
        studio.log(new Error(`check_design 无头浏览器没量成：${rows[0] && rows[0].error}`))
      } catch (e) {
        studio.log(e)
      }
    }
    // 没有无头浏览器（或者它没量成）：让右侧栏在显示着的页面上量
    if (!studio.check) return { text: '这台电脑上没找到能用的 Chrome / Edge，「设计工作台」也没开着，量不了。照 ui-design 技能里的「自查」清单自己过一遍。' + compNotes(id) + compLine(id) }
    const r = await studio.check(id)
    const note = want.sizes.length || a.dark ? '（这台电脑上没找到能用的 Chrome / Edge，没法按指定尺寸 / 深色量；下面是右侧栏按它现在显示的尺寸量的）\n' : ''
    if (!r) return { text: '右侧栏「设计工作台」现在没开着，量不了。照 ui-design 技能里的「自查」清单自己过一遍。' + compNotes(id) + compLine(id) }
    if (!r.error && !r.measured) return { text: '右侧栏开着，但预览页面没回应，这次没量成（可能还在加载）。过一会儿再调一次，或照 ui-design 技能里的「自查」清单自己过一遍。' + compNotes(id) + compLine(id) }
    return { text: note + (r.error || r.text) + tweakNotes(id) + fontNotes(id) + annotationNotes(anAt, null) + (r.error ? '' : driftNotes(id)) + compNotes(id) + compLine(id) }
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
    else if (r && r.list.length) list.push('这次没有无头浏览器，选择器定位不到的情况没核对；右侧栏「需求说明」面板里能看到')
  } catch (e) { studio.log(e) }
  return list.length ? `\n\n业务标注（annotations.json）：\n${list.map((x) => `- ${x}`).join('\n')}` : ''
}

/** 字体库的字体有没有真放进来：check_design 末尾附上 */
function fontNotes(id) {
  let list = []
  try {
    const t = studio.tracker.stateOf(id).target
    if (t && t.kind === 'file' && studio.fonts) list = lintFonts(t.root, studio.fonts.index)
  } catch (e) { studio.log(e) }
  return list.length ? `\n\n字体库：\n${list.map((x) => `- ${x}`).join('\n')}` : ''
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
    screens: { type: 'array', items: { type: 'string' }, description: `截哪几屏：文件名（home.html 或 home）或开发服务器的路由；不填截全部（最多 ${MAX_SHOTS} 屏）。看某个状态写 order.html?state=paid` },
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
    const sn = splitStateNames(a.screens, (n) => pickScreens(snap, [n], 1).list[0])
    let miss = ''
    const want = a.size ? sizeOf(a.size, kind) : await fitted(b, design, sn.names)
    if (!want) return { text: `认不出尺寸「${String(a.size).slice(0, 20)}」：写成 375x667，或只写宽度 375。` }
    const at = ['top', 'bottom', 'full'].includes(a.at) ? a.at : 'top'
    const pick = pickScreens(snap, sn.names, MAX_SHOTS)
    if (sn.only) { // 看某个状态：那一屏换成带 ?state= 的地址（文件里没写这个状态的照原样截）
      const stOf = statesOfScreen(id)
      miss = stateMisses(pick.list, stOf, sn.only, '截的是默认状态')
      pick.list = pick.list.flatMap((sc) => {
        const want = sn.only(sc)
        const has = want ? stOf(sc).filter((x) => want.has(x.name)) : []
        return has.length ? has.map((x) => ({ ...sc, key: `${sc.key}?state=${x.name}`, url: withState(sc.url, x.name), label: `${sc.label || sc.key}（${x.label}）` })) : [sc]
      }).slice(0, MAX_SHOTS)
    }
    if (!pick.list.length) return { text: `没找到要截的屏：${pick.missing.join('、')}。现在有：${(snap.screens || []).map((x) => x.key).join('、') || snap.focus}` }
    const shots = await shootAll(b, { screens: pick.list, size: want, at, selector: a.selector, dark: !!a.dark, kind, max: MAX_SHOTS })
    const good = shots.filter((s) => s.jpg).slice(0, MAX_SHOTS)
    const text = formatShots(shots, { where: whereOf(snap), missing: pick.missing, more: pick.more, kind }) + miss
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

/** save_frame 工具：把写好的外框存进外框库（检查、算指纹、截图） */
export const frameTool = {
  name: 'save_frame',
  description:
    '把写好的「外框」存进用户的外框库（~/.dsh/design-frames/<id>/），以后做设计原样套上、只改槽位。' +
    '用户要给某个软件 / 浏览器插件 / 平台做界面、说「照这张截图做个外壳 / 外框」「套上 XX 的外壳 / 外框」时：先读 ui-design 技能的 references/frames.md，在一个文件夹里写好 frame.json、每个位置一个 HTML（根元素 data-frame="<id>/<位置>"，槽位 data-slot，必须有 main）和样式，再调它。' +
    '它检查 frame.json 和槽位对不对，用无头浏览器打开每个位置（浅色、深色）算外框指纹（体检「外框被改动」靠它），截图回给你核对；同 id 再存一次就覆盖。',
  parameters: specToJsonSchema({
    dir: { type: 'string', required: true, description: '写好外框的文件夹（里面有 frame.json），绝对路径或相对会话目录' },
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
    if (typeof a.dir !== 'string' || !a.dir.trim()) return { text: '没给 dir：写好外框的文件夹（里面有 frame.json）。' }
    const cwd = studio.tracker && id ? studio.tracker.cwdOf(id) : os.homedir()
    const src = resolvePath(a.dir, cwd)
    let st = null
    try { st = fs.statSync(src) } catch { /* 下面说 */ }
    if (!st || !st.isDirectory()) return { text: `找不到文件夹：${src}` }
    // 外框里用组件（#30）：外框库存的是单个页面，认不了 components/，存了也是空标签
    try {
      const htmls = fs.readdirSync(src).filter((n) => /\.html?$/i.test(n)).slice(0, 500)
      const rd = dirReader(src)
      const hit = htmls.find((n) => { try { return pageUsesComponents(fs.readFileSync(path.join(src, n), 'utf8'), rd) } catch { return false } })
      if (hit) return { text: `外框里不能用组件（<c-…>）：${hit} 用了组件。外框存的是单个页面，把组件的内容直接写进外框页面再存。` }
    } catch { /* 读不了：交给 saveFrame 报 */ }
    let r
    try {
      r = await saveFrame({ browser: studio.browser, src })
    } catch (e) {
      return { text: `外框没存：${String((e && e.message) || e).slice(0, 300)}` }
    }
    if (!r.images.length) return { text: r.text }
    const kept = await keepImages(ctx, id || 'frame', r.images, true)
    if (kept.images) return { text: r.text, images: kept.images }
    return { text: r.text }
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
    'HANDOFF.md 一直列全部屏。截图和逐屏说明分批补齐，用 batch 继续下一批，或用 screens 指定要截的屏。' +
    '用户说「转成代码」「做成真的项目」「用 React / Vue / uni-app 做出来」「做成小程序」时先调它，读 HANDOFF.md 照着做；每做完一屏用 compare_design 和设计稿比一遍，差异降到 3% 以下再做下一屏（原生小程序在浏览器里跑不起来，照 HANDOFF.md 说的请用户在微信开发者工具里看）。' +
    'framework：same 跟目标目录现有项目一样（认得出框架时默认，uni-app（含 HBuilderX 建的、没有 package.json 的）、Taro、微信原生小程序也认得出）、react、vue、next、html、uniapp、weapp；dest：代码放哪个目录（不填：会话目录是项目就放进去，不是就新建 <设计名>-app）。要先用 preview_page 打开过设计。',
  parameters: specToJsonSchema({
    framework: { type: 'string', enum: ['same', ...Object.keys(FRAMEWORKS)], description: 'same 跟现有项目一样；react（React + Vite）、vue（Vue 3 + Vite）、next（Next.js）、html（纯 HTML / CSS）、uniapp（uni-app，出微信小程序和网页版）、weapp（微信原生小程序 WXML / WXSS）。不填：目标目录（或它所在的项目）认得出框架就 same，没有 package.json 的纯 HTML 站点 html，小程序的设计 uniapp，别的 react' },
    dest: { type: 'string', description: '代码放哪：现有项目的目录（或它里面的子目录），或要新建的项目目录（绝对路径或相对会话目录）。不填：会话目录有 package.json 就放进去，没有就新建 <设计名>-app（设计目录在会话目录下就建在会话目录里，不然建在设计目录旁边）' },
    batch: { type: 'integer', minimum: 1, description: `截图批次，从 1 开始，每批最多 ${HANDOFF_BATCH_SIZE} 屏，默认第 1 批。填了 screens 时按指定的屏截` },
    screens: { type: 'array', items: { type: 'string' }, description: `按文件名指定本次要截图和补说明的屏，最多 ${HANDOFF_BATCH_SIZE} 屏` },
  }),
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args, exec) {
    const id = toolSession(exec, '转成代码')
    const a = args || {}
    const snap = studio.tracker.snapshot(id)
    if (!snap.url) return { text: '还没有在预览的设计：先用 preview_page 打开设计文件。' }
    const t = studio.tracker.stateOf(id).target
    if (!t || t.kind !== 'file') return { text: '现在预览的是开发服务器上的页面，它已经是代码了：直接在那个项目里改；要比对设计稿就先用 preview_page 打开设计的 HTML 文件。' }
    const design = designFor(id)
    const { kind } = design
    const catalog = handoffScreens(t.root, snap.origin)
    const pick = handoffBatch(catalog, { batch: a.batch, names: a.screens })
    if (pick.error) return { text: pick.error }
    if (!pick.list.length) return { text: `没找到要转的屏${pick.missing.length ? '：' + pick.missing.join('、') : ''}。目录里有 ${catalog.length} 屏，可用 batch=1 查看交接清单。` }
    const cwd = studio.tracker.cwdOf(id)
    // 先定下最终放哪（没给就和右侧栏建议的一样），再按真实路径查是不是在设计目录里
    const dest = typeof a.dest === 'string' && a.dest.trim() ? resolvePath(a.dest, cwd) : defaultDest(t.root, cwd, detectProject(cwd))
    if (within(dest, t.root)) return { text: `代码别放进设计目录（${t.root}）里：设计稿留着做对比。换一个目录。` }
    const project = projectFor(dest)
    const framework = typeof a.framework === 'string' && (a.framework === 'same' || FRAMEWORKS[a.framework]) ? a.framework : defaultFramework(project, kind)
    if (framework === 'same' && !project.framework) return { text: `${dest} 里没有认得出的前端项目（package.json 里没有 React / Vue / Next / uni-app …，也不是 HBuilderX 或微信原生小程序的项目）：framework 选 react、vue、next、html、uniapp 或 weapp。` }
    let r
    try {
      const b = studio.browser
      const samples = a.screens?.length ? pick.list : pick.list.slice(0, 6)
      const size = design.auto && b?.available() ? await fitSize(b, samples, kind, design.size) : design.size
      r = await buildHandoff(b, { root: t.root, catalog, selection: pick, kind, size, framework, dest, project, system: systemOfDir(t.root), annotations: studio.annotations > 0 ? readAnnotations(t.root) : null, tuned: studio.tracker.versions(id) })
    } catch (e) {
      return { text: `没写成交接包：${String((e && e.message) || e).slice(0, 200)}` }
    }
    studio.tracker.markHandoff(id, t.root) // 右侧栏的步骤条：交接包写好了，模型在照着做
    // 原生小程序跑不了网页版：比不了，照 HANDOFF.md 请用户在微信开发者工具里看
    const native = framework === 'weapp' || (framework === 'same' && project.framework === 'weapp')
    const verify = native ? '每屏做完请用户在微信开发者工具里看' : '每屏做完用 compare_design 比'
    const batch = pick.batch ? `第 ${pick.batch} 批` : '本次指定'
    const lines = [
      `${batch} ${r.rows.length} 屏（${r.rows.map((row) => row.key).join('、')}），新增或更新 ${r.shots} 张截图。`,
      `交接说明：${r.file}`,
      `截图目录：${path.join(r.dir, 'shots')}`,
    ]
    if (pick.missing.length) lines.push(`没找到指定的屏：${pick.missing.join('、')}。`)
    for (const row of r.rows) if (row.error) lines.push(`没截成 ${row.key}：${row.error}`)
    if (r.pending.length) {
      // 这一批一张都没截成（没有能用的浏览器、屏一直截不了）：别让模型反复调同一批空跑
      const stuck = r.rows.length > 0 && r.rows.every((row) => row.error)
      const rest = r.pending.filter((n) => n !== (pick.batch || 0))
      if (stuck) lines.push('这一批一张截图也没截成（多半是这台电脑没有能用的 Chrome / Edge）：先照 HANDOFF.md 写代码，截图以后再补，不用反复调。')
      else if (rest.length) {
        const next = rest.find((n) => n > (pick.batch || 0)) ?? rest[0]
        lines.push(`第 ${rest.join('、')} 批还有待截或待重截的屏，调 handoff_design batch=${next} 继续。`)
      }
    }
    lines.push(`读 HANDOFF.md，${verify}。`)
    return { text: lines.join('\n') }
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

const FONT_CAT = { sans: '黑体 / 无衬线', serif: '宋体 / 衬线', display: '标题', hand: '书法手写', mono: '等宽' }
/** 工具说明里列字体库（名字 + 说明），模型不用先调一次才知道有什么 */
const fontMenu = () => {
  const idx = loadFontIndex()
  if (!idx) return ''
  const zh = idx.fonts.filter((f) => f.lang === 'zh').map((f) => `${f.zh}（${FONT_CAT[f.cat]}，${f.nzh}）`)
  const en = idx.fonts.filter((f) => f.lang !== 'zh').map((f) => `${f.en}（${f.nzh}）`)
  return `中文：${zh.join('；')}。英文（只有英文和数字）：${en.join('；')}。`
}

/** use_fonts 工具（#31）：从字体库把一款字体放进设计（复制文件 + 写 @font-face），给了 var 就顺便把变量换成它 */
export const fontTool = {
  name: 'use_fonts',
  description:
    '把设计台字体库（免费可商用，SIL OFL）里的一款字体放进这套设计：字体文件复制进设计目录的 dsh-fonts/，tokens.css 里写好 @font-face，给了 var 就顺便把那个变量换成这款字体的字体栈。' +
    '用户点名要某种字体（思源宋体、毛笔字、手写、得意黑…），或这套设计要系统字体给不了的气质（国风书法标题、潮流海报、手账手写）时用；普通界面用系统字体栈就够，不用调。一次放一款，标题和正文各要一款就调两次。' +
    fontMenu(),
  parameters: specToJsonSchema({
    font: { type: 'string', required: true, description: '字体名，中文名、英文名都行，如「思源宋体」「Smiley Sans」「马善政毛笔楷书」' },
    var: { type: 'string', description: '顺便换成这款字体的 CSS 变量，如 --font-display（tokens.css 的 :root 里要已经有它）；不填只放字体，自己写 font-family' },
    file: { type: 'string', description: '写 @font-face 和变量的样式文件（相对设计目录），默认 tokens.css；变量写在页面 <style> 里时填那个 .html' },
    dir: { type: 'string', description: '这套设计的文件夹（绝对路径或相对会话目录）。不填用正在预览的设计目录' },
  }),
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  async execute(args, exec) {
    const id = toolSession(exec, '放字体')
    const a = args || {}
    const lib = studio.fonts
    if (!lib) return { text: '这个版本的设计台没带字体库。用系统字体栈。' }
    const f = findFont(lib.index, typeof a.font === 'string' ? a.font : '')
    if (!f) return { text: `字体库里没有「${String(a.font || '').slice(0, 40)}」。有这些：${fontMenu()}没有合适的就用系统字体栈。` }
    const cwd = studio.sessionCwd ? await studio.sessionCwd(id) : studio.tracker.cwdOf(id)
    const t = studio.tracker.stateOf(id).target
    const root = t && t.kind === 'file' ? t.root : ''
    const dir = typeof a.dir === 'string' && a.dir.trim() ? resolvePath(a.dir, cwd) : root
    if (!dir) return { text: '不知道放哪：先建好这套设计的文件夹，把路径写进 dir。' }
    const allowed = pinRoots([cwd, root])
    if (!allowed(dir)) return { text: `${dir} 不在会话目录（${cwd}）里，字体不能放那儿。放进这套设计自己的文件夹。` }
    const rel = (typeof a.file === 'string' && a.file.trim() ? a.file.trim() : 'tokens.css').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!/\.(css|html?)$/i.test(rel) || rel.split('/').includes('..') || path.isAbsolute(rel)) return { text: 'file 要填设计目录里的 .css 或 .html（相对路径）。' }
    const file = path.join(dir, rel)
    // 要改的文件得是这套设计自己的：真实位置在设计文件夹里（中间哪层是指到别处的软链接也不行）
    const own = () => {
      try {
        if (!fs.lstatSync(file).isFile()) return 'none'
        const realDir = fs.realpathSync(dir)
        return fs.realpathSync(file).startsWith(realDir + path.sep) ? '' : 'out'
      } catch { return 'none' }
    }
    const bad = own()
    if (bad === 'none') return { text: `${file} 不存在：先建好 ${rel}（设计变量写在里面），再调 use_fonts。` }
    if (bad === 'out') return { text: `${file} 指向了这套设计外面（软链接），不能改。把 @font-face 写进这套设计自己的样式文件。` }
    const v = typeof a.var === 'string' ? a.var.trim() : ''
    if (v && !/^--[A-Za-z0-9_-]{1,60}$/.test(v)) return { text: 'var 要写 CSS 变量名，如 --font-display。' }
    try {
      await lib.provide(dir, [f], allowed)
    } catch (e) {
      studio.log(e)
      if (e && e.code === 'off') return { text: '「设计库不联网」开着，字体库下载不了。这次用系统字体栈，并告诉用户：关掉这个开关就能用字体库。' }
      if (e && e.code === 'link') return { text: `${path.join(dir, FONT_DIR)} 指向了这个文件夹外面，字体不能放那儿。` }
      if (e && /^(EACCES|EPERM|EROFS|ENOTDIR|EEXIST|ENOSPC)$/.test(e.code || '')) return { text: `${path.join(dir, FONT_DIR)} 写不进去（${e.code}）。这次用系统字体栈。` }
      return { text: '字体库这会儿下载不了（网络问题）。这次先用系统字体栈，稍后可以再试。' }
    }
    // 下载完再读（第一次要下好一会儿，这期间文件可能被改过）；从这里到写回不再等别的，几次调用不会互相盖掉
    if (own()) return { text: `${file} 读不了。` }
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { return { text: `${file} 读不了。` } }
    const isHtml = /\.html?$/i.test(rel)
    const stack = stackOf(f)
    let varNote = ''
    const before = v ? libFontsUsed(dir, lib.index) : null
    if (v) {
      const next = isHtml ? (setVarInHtml(text, v, stack) ?? setVarInHtml(text, v, stack, true)) : (setVarDecl(text, v, stack) ?? setVarDecl(text, v, stack, true))
      if (next === null) varNote = `${rel} 的 :root 里没有 ${v}，没改变量：自己把要用的变量写成 ${stack}。\n`
      else { text = next; varNote = `${v} 已经换成：${stack}\n` }
    }
    // 这次把变量原来的库字体换走了、整套设计都不再写它的名字：那段里去掉它（别的一概只加不减）
    const after = before ? libFontsUsed(dir, lib.index, { [rel]: text }) : null
    const drop = before && !before.partial && !after.partial ? [...before].filter((x) => !after.has(x) && x !== f.id) : []
    const synced = syncFontBlock(text, [f.id], lib.index, { prefix: fontPrefix(rel), isHtml, drop })
    if (synced !== null) text = synced
    if (!fontBlockIds(text).includes(f.id)) {
      return { text: isHtml ? `${rel} 里没有 <style>，@font-face 放不进去，什么都没改（字体文件已经放进 ${FONT_DIR}/）。file 改填这页引用的 .css（如 tokens.css），或者先在这页 <head> 里加一个 <style>。` : `${rel} 里没能写进 @font-face，什么都没改。` }
    }
    try { fs.writeFileSync(file, text) } catch (e) { return { text: `${file} 写不进去（${e.code || e.message}）。` } }
    const one = !Array.isArray(f.weights)
    const notes = [
      one ? '这款只有一种粗细：标题写 700、800 也不会变粗（已经让浏览器别硬描粗），要对比就靠字号。' : '',
      f.lang !== 'zh' ? '这款只有英文和数字，中文由字体栈后面的系统字体显示。' : '只带了常用的 6763 个汉字，生僻字由字体栈后面的系统字体显示。',
    ].filter(Boolean).join('')
    return {
      text:
        `已放进 ${path.join(dir, FONT_DIR, `${f.id}.woff2`)}（${f.zh}，${(f.size / 1024 / 1024).toFixed(1)} MB），${rel} 开头写好了 @font-face（「dsh-fonts」那段由设计台管，别改）。\n` +
        varNote +
        (v ? '' : `用法：font-family 写 ${stack}\n`) +
        notes + '\n' +
        `之后改 ${rel} 用局部修改，别整个重写（重写了那段会丢，再调一次 use_fonts）。免费可商用（SIL OFL 1.1），可以告诉用户。`,
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
    kind: { type: 'string', enum: KINDS, description: '设计类型' },
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
    '照设计稿写代码时每做完一屏调一次（url 给开发服务器上那一页的地址，如 http://localhost:5173/login），照差异改到 3% 以下。at=bottom 比滚到底的样子。要先用 preview_page 打开过设计。' +
    '设计稿套了外框（DSH 插件、外框库）时只比外框里的 main 槽位：外框是宿主画的，做出来的页面就是槽位那块本身，会按槽位的尺寸打开。',
  parameters: specToJsonSchema({
    url: { type: 'string', required: true, description: '做出来的页面：本机地址（http://localhost:5173/login，或端口 5173）或本地 HTML 文件' },
    screen: { type: 'string', description: '和设计稿的哪一屏比（文件名，如 login 或 login.html）；不填用右侧正在看的那屏' },
    size: { type: 'string', description: '尺寸，如 375x667 或只写宽度；不填按设计的尺寸' },
    at: { type: 'string', enum: ['top', 'bottom'], description: 'top 顶上一屏（默认）、bottom 滚到底' },
    dark: { type: 'boolean', description: '比深色' },
    whole: { type: 'boolean', description: '设计稿套了外框时默认只比 main 槽位；做出来的页面自己也套了同一个外框（整屏和设计稿一样大）才填 true，整屏比' },
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
    const out = await runCompare(id, a)
    if (!out.r) return { text: out.text }
    keepImpl(id, out, 'model', !!a.size)
    if (!out.r.jpg) return { text: out.r.text } // 没截图就停下了（套了外框但槽位露不出来）
    const kept = await keepImages(ctx, id, [{ key: `compare-${out.sc.key}`, jpg: out.r.jpg }], true)
    if (kept.images) return { text: out.r.text, images: kept.images }
    return { text: `${out.r.text}\n（这个 DSH 版本没法把图直接给你，存成了文件：${kept.files.join('、')}）` }
  },
}

/** 设计记在哪个名下：本地设计按目录，开发服务器的按端口 */
/** 填的本地文件就是设计稿自己的某一屏（设计目录里登记的那几个文件）：不算做出来的 */
export const isDesignFile = (at, u, catalog) => {
  if (u.protocol !== 'file:' || !at.snap.target || at.snap.target.kind !== 'file') return false
  try {
    const rel = path.relative(path.resolve(at.root), fileURLToPath(u)).split(path.sep).join('/')
    return catalog ? catalog.some((sc) => sc.key === rel) : allScreens(at.root).includes(rel)
  } catch { return false }
}
export const implRoot = (snap) => (snap && snap.target ? (snap.target.kind === 'file' ? snap.target.root : `proxy:${snap.target.port}`) : '')

/**
 * 比一屏（compare_design 和右侧栏「和做出来的比」里的「重新比」共用）
 * a: { url, screen, size, at, dark, whole }
 * @returns { text } 没比成；{ r, sc, impl, want, opts, root } 比完了（r.jpg 为空 = 套了外框但槽位露不出来，r.text 说了怎么办；
 *          root：开始比时在看的设计，比的时候换了设计也记回这一份）
 */
async function runCompare(id, a) {
  const snap = studio.tracker.snapshot(id)
  const root = implRoot(snap)
  if (!snap.url) return { text: '还没有在预览的设计稿：先用 preview_page 打开设计文件，再比。' }
  const b = studio.browser
  if (!b || !b.available()) return { text: '这台电脑上没找到 Chrome / Edge（比对要用无头浏览器截图），比不了。' }
  const design = designFor(id)
  const { kind } = design
  const catalog = snap.target?.kind === 'file' ? handoffScreens(root, snap.origin) : null
  // 指定了哪屏就只认那屏，找不到就说（别悄悄拿第一屏比，结果对不上号）；没指定才用正在看的 / 第一屏
  const asked = typeof a.screen === 'string' && a.screen.trim()
  const sc = catalog
    ? findHandoffScreen(catalog, asked || snap.focus) || (!asked && catalog[0])
    : pickScreens(snap, [asked || snap.focus], 1).list[0] || (!asked && pickScreens(snap, null, 1).list[0])
  if (!sc) {
    const all = catalog || snap.screens || []
    return { text: `没找到设计稿的这一屏：${asked || '（没有屏）'}。共 ${all.length} 屏：${all.slice(0, HANDOFF_BATCH_SIZE).map((x) => x.key).join('、')}${all.length > HANDOFF_BATCH_SIZE ? ' 等，可用 handoff_design 查看完整清单' : ''}。` }
  }
  const want = Array.isArray(a.size) ? a.size : a.size ? sizeOf(a.size, kind) : !catalog
    ? await fitted(b, design, asked ? [a.screen] : null)
    : design.auto ? await fitSize(b, asked ? [sc] : catalog.slice(0, 6), kind, design.size) : design.size
  if (!want) return { text: `认不出尺寸「${String(a.size).slice(0, 20)}」：写成 375x667，或只写宽度 375。` }
  // 相对路径、本地 HTML 的预览根：先问 DSH 会话目录（和右侧栏填地址一样），问不到才用记着的
  let cwd = ''
  try { cwd = studio.sessionCwd ? await studio.sessionCwd(id) : '' } catch { cwd = '' }
  if (!cwd) cwd = studio.tracker.cwdOf(id)
  let impl
  try { impl = implUrl(a.url, cwd) } catch (e) { return { text: e.message } }
  if ((snap.origin && impl.startsWith(snap.origin + '/')) || isDesignFile({ snap, root }, new URL(impl), catalog)) return { text: '这个地址是设计稿自己（设计工作台的预览或设计目录里的文件），给做出来的那个项目的地址。' }
  const opts = { at: a.at === 'bottom' ? 'bottom' : 'top', dark: !!a.dark, whole: a.whole === true }
  let r
  try {
    // 本地 HTML 经预览服务器（http）打开再截：直接开 file:// 时 Vite 这类打包出来的模块脚本、/assets 这种根路径都载不出来（和右侧栏里看到的一样）
    let shotUrl = impl
    if (/^file:/i.test(impl) && studio.openPreview) {
      const u = new URL(impl)
      const s = implServe(fileURLToPath(u), cwd)
      const p = await studio.openPreview({ kind: 'file', root: s.root })
      shotUrl = `${p.origin}${s.rel}${u.search}${u.hash}`
    }
    r = await compareScreens(b, { design: sc, impl: shotUrl, shown: impl, size: want, ...opts })
  } catch (e) {
    return { text: `没比成：${String((e && e.message) || e).slice(0, 200)}（做出来的页面打得开吗？开发服务器起来了吗？）` }
  }
  return { r, sc, impl, want, opts, root }
}

/** 比完记一笔（右侧栏「和做出来的比」显示分数、标红框）；by：model 模型比的 / user 右侧栏点的 */
function keepImpl(id, out, by, sizeGiven) {
  const store = studio.impl
  const root = out.root
  if (!store || !root || !out.sc) return null
  const { r } = out
  // 这次没比成分数（套了外框、槽位露不出来）：地址没变就不动原来的记录（旧分数别标成这次比的）
  if (typeof r.pct !== 'number') {
    const cur = store.get(root, out.sc.key)
    if (cur && cur.url === out.impl) return cur
    return store.set(root, out.sc.key, { url: out.impl, ...out.opts, by })
  }
  const rec = store.set(root, out.sc.key, {
    url: out.impl, ...out.opts, by, size: sizeGiven ? out.want : undefined,
    ...(typeof r.pct === 'number' ? { pct: r.pct, boxes: r.boxes, cmp: r.cmp, slot: r.slot } : {}),
  })
  if (r.jpg) store.shot(root, out.sc.key, r.jpg)
  return rec
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
  const thumbDirs = createDirRevs() // 画布缩略图（issue #17）：各目录的资源修订号，预览服务器报改动时更新
  const hub = createHub({
    log,
    history,
    drafts,
    skipAnnots: () => studio.annotations > 0, // 业务标注开着时这个文件只给右侧栏看，改了不刷新页面
    fontFile: (id) => (studio.fonts ? studio.fonts.cached(id) : null), // 字体库（#31）：面板里试字体时页面从这里拿（还没存进设计）
    strict: { html: (buf) => library.strictHtml(buf) || market.strictHtml(buf), root: (dir) => library.strictRoot(dir) || market.isStaging(dir), versions: (dir) => library.strictVersions(dir) },
    // 桌面版的 dsh-app://app 是默认就认的；这里补上 DSH 网页端的地址，和 DSH 配置里声明的对外地址（反向代理 / 域名）
    parents: () => {
      let own = []
      try { own = webOrigins(ctx.webServer.getOrigin()) } catch { own = [] }
      const conn = connectionOf(ctx)
      return [...own, ...trustedOrigins(conn && conn.trustedHosts)]
    },
    onChange: (key, file, files) => {
      if (!key.startsWith('file:')) return
      dropBundlesOf(key.slice(5))
      thumbDirs.touched(key.slice(5)) // 先于 tracker：页面看到改动再来要缩略图时，目录的修订号已经变了
      if (tracker) tracker.changed(key.slice(5), files)
    },
    onWatch: (key) => { if (key.startsWith('file:')) thumbDirs.watched(key.slice(5)) },
    onUnwatch: (key) => { if (key.startsWith('file:')) thumbDirs.unwatched(key.slice(5)) },
  })
  const open = async (target, opts) => {
    const r = await hub.open(target.kind === 'file' ? { kind: 'file', root: target.root } : target, opts)
    previewPorts.add(Number(new URL(r.origin).port))
    return r
  }
  tracker = createTracker({
    open,
    watchTag: (root) => thumbDirs.tag(root),
    drafts,
    log,
    history,
    // 记会话的同时，在做的设计目录补进「我的作品」
    store: { load: fileStore.load, save: (data) => { fileStore.save(data); try { library.sync(data) } catch (e) { log(e) } } },
    alive: (origin) => hub.alive(origin),
    autoOpen: () => studio.autoOpen > 0,
    // 装好的别人的设计系统退回旧版：退回来的页面先记成别人做的（预览照样加规矩）
    beforeRestore: (root, html) => { if (html.length) library.addPast(root, html) },
    trust: () => { try { return library.trustRev() } catch (e) { log(e); return '' } },
    skipPorts: () => {
      const s = new Set(previewPorts)
      const own = ownHost(ctx).split(':')[1]
      if (own) s.add(Number(own))
      return s
    },
  })
  ctx.effect(() => () => { drafts.clear(); hub.closeAll() }, 'dsh-design-studio: preview servers')
  const implStore = createImpl({ log }) // 「和做出来的比」：每屏对应的页面地址、上次比对的分数
  ctx.effect(() => {
    studio.tracker = tracker
    studio.log = log
    studio.market = market
    const photoIndex = loadPhotoIndex()
    const photos = photoIndex ? createPhotos({ market, index: photoIndex, log }) : null
    studio.photos = photos
    const fontIndex = loadFontIndex()
    const fonts = fontIndex ? createFonts({ market, index: fontIndex, log }) : null
    studio.fonts = fonts
    studio.sessionCwd = sessionCwd
    studio.impl = implStore
    studio.openPreview = open
    return () => {
      if (studio.impl === implStore) { implStore.flush(); studio.impl = null }
      if (studio.openPreview === open) studio.openPreview = null
      if (studio.tracker === tracker) { studio.tracker = null; studio.log = () => {} }
      if (studio.market === market) { market.abort(); studio.market = null }
      if (studio.photos === photos) studio.photos = null
      if (studio.fonts === fonts) studio.fonts = null
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
  // 公网链接（#27）：只放整套 HTML 演示，每次有人打开按现在的文件打包（文件没改就用上次的）
  const pub = createPublicShare({
    build: (p) => {
      const { pack, files } = packDesign(p.root, 0, p)
      return { html: pack.html, deps: files }
    },
    // 这个会话换了设计（或关了）：关掉，别把不在眼前的设计一直开在公网上（插件自己每 5 秒看一眼，不靠右侧栏开着）
    alive: (session, p) => {
      const t = tracker.stateOf(session).target
      return !!(t && t.kind === 'file' && t.root === p.root)
    },
    log,
  })
  ctx.effect(() => () => { pub.stopAll(); pub.cancelTool() }, 'dsh-design-studio: public links')

  // ── 接口 ──────────────────────────────────────────────────────────────────

  function admit(req, res) {
    const peer = req[ADMITTED]
    if (peer) {
      // DSH 的 WebServer 准入已经验过登录与来源（见 ADMITTED 的说明）；设计台只给「主人」用：别的身份（以后 DSH 加的访客之类）一律不让进
      if (peer.principal && peer.principal.kind === 'owner') return true
      json(res, 403, { error: 'forbidden' })
      return false
    }
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
    json(res, 200, { ...snap, impl: implStore.list(implRoot(snap)), strict: strictScreens(snap), phone: { on: ph.on, seen: ph.seen || 0 }, pub: pub.status(session, { brief: true }), tweaks, ...annotsField(session, new URL(req.url, 'http://x').searchParams.get('an')), ...(c ? { checkReq: c.id } : {}) })
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
      const session = String(body.session || '')
      const want = String(body.root || '')
      // 字体库（#31）：换成字体库的字体要先下载好、复制进设计的 dsh-fonts/（只往右侧栏正看着的这套设计里放）
      const lib = studio.fonts
      const picks = lib && vars ? [...new Set(Object.values(vars).map((v) => libFontOf(lib.index, v)).filter(Boolean))] : []
      if (picks.length) {
        const t = tracker.stateOf(session).target
        if (!t || t.kind !== 'file') return json(res, 200, { ok: false, reason: 'not-file' })
        if (t.root !== want) return json(res, 200, { ok: false, reason: 'moved' })
        try {
          await lib.provide(t.root, picks, pinRoots([t.root]))
        } catch (e) {
          log(e)
          return json(res, 200, { ok: false, reason: e && e.code === 'off' ? 'font-off' : e && /^(link|EACCES|EPERM|EROFS|ENOTDIR|ENOSPC)$/.test(e.code || '') ? 'font-write' : 'font-net' })
        }
      }
      const r = tracker.editDir(session, (root) => {
        // 只在这次改了字体栈时才扫整套设计（只改颜色、拖滑块不用读一遍所有文件）
        const fontish = (v) => /["']/.test(String(v)) || /(?:^|,)\s*(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[\w-]+)\s*(?:,|$)/i.test(String(v))
        const before = lib && vars && Object.values(vars).some(fontish) ? libFontsUsed(root, lib.index) : null
        const x = applyTweaks(root, values, vars)
        // 变量写进了哪些样式，那里的 @font-face 那段跟着变：选了字体库的加上；这次换走了、整套设计都不再写名字的去掉（别的不动）
        if (x.ok && x.files.length && lib) {
          const after = before ? libFontsUsed(root, lib.index) : null
          const drop = before && !before.partial && !after.partial ? [...before].filter((id) => !after.has(id)) : []
          x.files = [...new Set([...x.files, ...syncFonts(root, x.files, picks.map((f) => f.id), lib.index, { drop })])]
        }
        return x
      }, (x) => `调节：${x.changed.map((c) => `${c.label} ${c.to}`).join('、')}`.slice(0, 60), want)
      json(res, 200, r)
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /**
   * 字体库（#31）：GET → 列表（名字、分类、说明、字体栈、预览图形）和下载好了没有；
   * POST → 下载（第一次点字体库的字体时，好在页面上马上换给用户看）
   */
  async function fontsRoute(req, res) {
    if (!admit(req, res)) return
    const lib = studio.fonts
    if (!lib) return json(res, 200, { fonts: [], ready: false, none: true })
    if (req.method === 'POST') {
      try { await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
      try {
        await lib.ensure()
      } catch (e) {
        return json(res, 200, { ok: false, reason: e && e.code === 'off' ? 'off' : 'net' })
      }
      return json(res, 200, { ok: true, ready: true })
    }
    const pv = fontPreviews || (fontPreviews = loadFontPreviews())
    json(res, 200, {
      ready: lib.ready(),
      size: lib.index.fonts.reduce((n, f) => n + f.size, 0),
      fonts: lib.index.fonts.map((f) => ({ id: f.id, family: f.family, zh: f.zh, en: f.en, cat: f.cat, lang: f.lang, nzh: f.nzh, nen: f.nen, size: f.size, stack: stackOf(f), weights: f.weights, pv: pv[f.id] || null })),
    })
  }
  let fontPreviews = null

  /** 「数据」面板的「存成初始数据」（#30）：POST { session, root, data, fp } → 写回 mock.json（记一版、告诉模型用户改了） */
  async function mockSaveRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MOCK_MAX + 64 * 1024) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      const r = tracker.editDir(String(body.session || ''), (root) => saveMock(root, body.data, typeof body.fp === 'string' ? body.fp : ''), () => '模拟数据：存成初始数据', String(body.root || ''))
      json(res, 200, r)
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  // ── 和做出来的比（#25）────────────────────────────────────────────────────

  /** 这个会话正在看的设计里有这一屏：{ snap, root }，没有给 null */
  const implScreen = (session, key) => {
    const snap = tracker.snapshot(session)
    const root = implRoot(snap)
    if (!root || !key || !(snap.screens || []).some((x) => x.key === key)) return null
    return { snap, root }
  }
  /** 填的本地文件就是设计稿里的某一屏（拿设计稿和自己比） */

  /**
   * POST { session, screen, url?, whole? } → { url, live, rec }
   * 填了地址（或改了整屏 / 只比槽位）先记下；再按记着的地址开一个预览服务器（开发服务器走代理、热更新照常；本地 HTML 按目录开），
   * 页面里注入设计台脚本（两边滚动同步）。地址只认本机的，不能是设计稿自己
   */
  async function implRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const key = String(body.screen || '')
    const at = implScreen(session, key)
    if (!at) return json(res, 404, { error: 'no-screen' })
    let rec = implStore.get(at.root, key)
    let url = rec ? rec.url : ''
    // 相对路径按会话目录算（新会话也问 DSH 要，和「打开本地设计」一样）；本地 HTML 的预览根也不出会话目录
    // 用户填的：按 DSH 里这个会话的目录算（模型可能在子目录跑过工具，记着的不一定是会话目录）
    let cwd = ''
    try { cwd = await dshCwd(session) } catch { cwd = '' }
    if (!cwd) cwd = tracker.cwdOf(session)
    if (typeof body.url === 'string' && body.url.trim()) {
      try { url = implUrl(body.url.trim().slice(0, 2000), cwd) } catch (e) { return json(res, 400, { error: 'bad-url', msg: e.message }) }
    }
    if (!url) return json(res, 404, { error: 'no-url' })
    let u = null
    try { u = new URL(url) } catch { /* 记录文件被手改坏了 */ }
    if (!u || !/^(https?|file):$/.test(u.protocol)) return json(res, 400, { error: 'bad-url', msg: '' })
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
    // 设计稿自己（预览地址、或设计目录里的那几屏文件）、设计台别的预览页、DSH 自己的网页：都不是做出来的项目
    const own = Number(ownHost(ctx).split(':')[1]) || 0
    if ((at.snap.origin && url.startsWith(at.snap.origin + '/')) || (u.protocol !== 'file:' && (previewPorts.has(port) || port === own)) || isDesignFile(at, u)) return json(res, 400, { error: 'self' })
    if (u.protocol === 'https:') return json(res, 400, { error: 'https' }) // 代理只会接 http 的开发服务器
    if (url !== (rec && rec.url) || (typeof body.whole === 'boolean' && body.whole !== (rec && rec.whole))) {
      rec = implStore.set(at.root, key, { url, by: 'user', ...(typeof body.whole === 'boolean' ? { whole: body.whole } : {}) })
    }
    let live
    try {
      if (u.protocol === 'file:') {
        const s = implServe(fileURLToPath(u), cwd)
        const r = await open({ kind: 'file', root: s.root })
        live = `${r.origin}${s.rel}${u.search}${u.hash}`
      } else {
        const r = await open({ kind: 'proxy', port })
        live = r.origin + u.pathname + u.search + u.hash
      }
    } catch (e) {
      log(e)
      return json(res, 500, { error: 'open', msg: String((e && e.message) || e).slice(0, 200) })
    }
    json(res, 200, { url, live, rec })
  }

  /** POST { session, screen, size, dark } → 照记着的地址在无头浏览器里比一次（和 compare_design 一样），记下分数 → { rec, text } */
  async function implCmpRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const key = String(body.screen || '')
    const at = implScreen(session, key)
    if (!at) return json(res, 404, { error: 'no-screen' })
    const rec = implStore.get(at.root, key)
    if (!rec) return json(res, 404, { error: 'no-url' })
    // 眼前看的不是记录里的地址了（模型刚换了地址、画面还没跟上）：不比，等画面换过去
    if (typeof body.url === 'string' && body.url && body.url !== rec.url) return json(res, 200, { error: 'stale' })
    // 画幅能设 100–8000（自定义画幅）：照眼前的比，不走模型那边 200 起的尺寸规矩
    const m = typeof body.size === 'string' ? /^(\d{2,5})x(\d{2,5})$/.exec(body.size) : null
    const size = m && +m[1] >= 100 && +m[2] >= 100 && +m[1] <= 8000 && +m[2] <= 8000 ? [+m[1], +m[2]] : rec.size ? rec.size.join('x') : ''
    const out = await runCompare(session, { url: rec.url, screen: key, size, at: rec.at, dark: typeof body.dark === 'boolean' ? body.dark : rec.dark, whole: rec.whole })
    if (!out.r) return json(res, 200, { error: 'failed', text: out.text })
    // 比的这会儿换了设计、或这屏改填了别的地址：这次的分数不算数，别写回去
    const now = implStore.get(at.root, key)
    if (out.root !== at.root || implRoot(tracker.snapshot(session)) !== at.root || !now || now.url !== rec.url) return json(res, 200, { error: 'stale' })
    const next = keepImpl(session, out, 'user', !!size)
    json(res, 200, { rec: next, text: out.r.text, ok: !!out.r.jpg })
  }

  /** GET ?session=&screen= → 最近一次比对的拼图（设计稿 | 做出来的 | 差异） */
  function implShotRoute(req, res) {
    if (!admit(req, res)) return
    const q = new URL(req.url, 'http://x').searchParams
    const key = q.get('screen') || ''
    const at = implScreen(q.get('session') || '', key)
    const jpg = at ? implStore.shot(at.root, key) : null
    if (!jpg) return json(res, 404, { error: 'none' })
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length, 'Cache-Control': 'no-store' })
    res.end(jpg)
  }

  /** 外框库：GET 列出来（首页「套外框」下面挑外框用）；POST { op: rename | delete | reveal, id, name?, en? }（我的作品 › 外框 ⋯） */
  async function framesRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method === 'POST') {
      let body
      try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
      const id = String(body.id || '')
      const op = String(body.op || '')
      if (op === 'reveal') {
        const d = frameDir(id)
        if (!d) return json(res, 404, { error: 'noFrame' })
        const [cmd, args] = process.platform === 'darwin' ? ['open', [d]] : process.platform === 'win32' ? ['explorer', [d]] : ['xdg-open', [d]]
        execFile(cmd, args, (e) => { if (e && process.platform !== 'win32') log(e) }) // explorer 正常也返回 1
        return json(res, 200, { ok: true })
      }
      const r = op === 'rename' ? renameFrame(id, body.name, { en: !!body.en }) : op === 'delete' ? removeFrame(id) : { ok: false, error: 'bad op' }
      return json(res, r.ok ? 200 : r.error === 'noFrame' ? 404 : 400, r)
    }
    let list = []
    try { list = listFrames() } catch (e) { log(e) }
    json(res, 200, { frames: list.map((x) => ({ id: x.id, name: x.name, nameEn: x.nameEn, size: x.size, positions: x.frames.map((f) => f.name) })) })
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
      // 组件文件（#30）不是一屏：拖进来、选中它都不当整套设计开
      if (target.kind === 'file' && path.basename(path.dirname(target.file)) === 'components' && /\.html?$/i.test(target.file)) throw new Error(`${path.basename(target.file)} 是组件文件，不单独打开：打开用到它的那一屏`)
      await tracker.setTarget(session, target, { source: 'user', popup: false })
      // 换了设计，公网链接马上关（右侧栏要马上知道，不等下一次刷新）
      json(res, 200, { ...tracker.snapshot(session), ...annotsField(session), pub: pub.status(session, { brief: true }) })
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
      json(res, 200, { ...tracker.snapshot(session), ...annotsField(session), pub: pub.status(session, { brief: true }) })
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
    pub.stop(String(body.session || ''))
    json(res, 200, tracker.snapshot(String(body.session || '')))
  }

  function historyRoute(req, res) {
    if (!admit(req, res)) return
    const session = new URL(req.url, 'http://x').searchParams.get('session') || ''
    json(res, 200, { versions: tracker.versions(session), skip: tracker.versionSkip ? tracker.versionSkip(session) : null })
  }

  async function restoreRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    try {
      const r = tracker.restoreVersion(String(body.session || ''), Number(body.n), { root: typeof body.root === 'string' ? body.root : '', at: Number(body.at) || 0 })
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
      json(res, 200, tracker.editText(String(body.session || ''), { key: body.key, before: body.before, after: body.after, nth: body.nth, sig: typeof body.sig === 'string' ? body.sig : '', raw: typeof body.raw === 'string' ? body.raw : '' }))
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
      const id = String(body.session || '')
      // 右侧栏点的时候是哪套设计：中途换了（这次保存晚到）就不写，免得写进另一套同名的屏
      if (typeof body.target === 'string' && body.target !== targetKeyOf(tracker.stateOf(id).target)) return json(res, 200, { ok: false, reason: 'moved' })
      const rule = body.rule && typeof body.rule === 'object' ? body.rule : null
      if (rule) return json(res, 200, styleToRule(id, body, rule))
      json(res, 200, tracker.editStyle(id, { key: body.key, loc: body.loc, css: body.css, name: body.name, imp: Array.isArray(body.imp) ? body.imp.slice(0, 20) : [] }))
    } catch (e) {
      json(res, 500, { error: e.message })
    }
  }

  /**
   * 调样式「各屏一起改」：写进右侧栏指的那条规则（{ href, sel, n, cls }，href 是预览地址上的样式表）。
   * 只认这个会话预览的本地目录里的 .css；外框的样式表（锁着的）不写。写不了给 { ok: false, reason }，右侧栏退回只改这一处
   */
  function styleToRule(id, body, rule) {
    const st = tracker.stateOf(id)
    const t = st && st.target
    if (!t || t.kind !== 'file' || !st.origin) return { ok: false, reason: 'not-file' }
    let u
    try { u = new URL(String(rule.href || '')) } catch { return { ok: false, reason: 'no-rule' } }
    if (u.origin !== st.origin || u.pathname.startsWith('/__dsh_design__/') || !/\.css$/i.test(u.pathname)) return { ok: false, reason: 'no-rule' }
    const hit = resolveInRoot(t.root, u.pathname)
    if (!hit || !hit.real) return { ok: false, reason: 'no-rule' }
    const key = String(body.key || path.basename(t.file))
    let html = ''
    try { html = fs.readFileSync(path.join(t.root, path.basename(key)), 'utf8') } catch { /* 读不了就当没套外框 */ }
    const locked = new Set(frameCss(t.root, [html]).map((x) => x.toLowerCase()))
    if (locked.has(path.basename(hit.abs).toLowerCase())) return { ok: false, reason: 'frame' }
    return tracker.editRule(id, { key, loc: body.loc, file: hit.abs, sel: String(rule.sel || '').slice(0, 400), n: Math.max(0, Math.floor(Number(rule.n) || 0)), css: body.css, name: body.name, cls: String(rule.cls || '').slice(0, 80) })
  }

  /**
   * 「各屏一起改」默认勾不勾（#28）：设计里所有屏（收起来的也算）带这个 class 的元素，是不是都和选中的同一种（sig：picker 算的「标签|class」）。
   * 有一处不一样（.btn 既是按钮又是链接）、读不了、太大：same: false，右侧栏默认只改这一处。
   * 按目录 + class 记一下（各屏的修改时间、大小都没变就不重读），点来点去不用每次全读
   */
  const shareSeen = new Map() // `${root}|${cls}` → { stamp, sigs: Set(sig) }，只留最近 20 个
  /** 体检面板里「部件各屏写得不一样」那一组（#30）：{ session } → { items, more, total }（不是本地文件 / 不到两屏：items 空） */
  async function driftRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const r = driftOf(String(body.session || ''))
    json(res, 200, r || { items: [], more: 0, total: 0 })
  }

  /** 导出「每个状态各出一张」（#30）：各屏写了哪几个状态 { session } → { map: { key: [{ name, label }] } }（只列写了的屏） */
  async function statesRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const st = tracker.stateOf(String(body.session || ''))
    const t = st && st.target
    if (!t || t.kind !== 'file') return json(res, 200, { map: {} })
    const map = {}
    for (const k of allScreens(t.root).slice(0, MAX_PAGES)) {
      const list = statesOfFile(path.join(t.root, k))
      if (list.length) map[k] = list
    }
    json(res, 200, { map })
  }

  async function shareCheckRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const st = tracker.stateOf(String(body.session || ''))
    const t = st && st.target
    const cls = String(body.cls || '')
    const sig = String(body.sig || '')
    if (!t || t.kind !== 'file' || !/^-?[_a-zA-Z][\w-]{0,79}$/.test(cls) || !sig) return json(res, 200, { same: false })
    const files = allScreens(t.root).slice(0, MAX_PAGES)
    const stats = files.map((k) => { try { return fs.statSync(path.join(t.root, k)) } catch { return null } })
    const stamp = files.map((k, i) => (stats[i] ? `${k}:${stats[i].mtimeMs}:${stats[i].size}` : '')).join('|')
    const ck = `${t.root}|${cls}`
    let hit = shareSeen.get(ck)
    if (!hit || hit.stamp !== stamp) {
      const sigs = new Set()
      for (const [i, k] of files.entries()) {
        if (!stats[i]) continue // 刚删掉的屏不算
        if (stats[i].size > 2 * 1024 * 1024) { sigs.add('?'); break }
        try { for (const x of classSigs(fs.readFileSync(path.join(t.root, k), 'utf8'), cls)) sigs.add(x) } catch { sigs.add('?') }
        if (sigs.size > 1) break
      }
      hit = { stamp, sigs }
      shareSeen.delete(ck)
      shareSeen.set(ck, hit)
      while (shareSeen.size > 20) shareSeen.delete(shareSeen.keys().next().value)
    }
    json(res, 200, { target: targetKeyOf(t), same: hit.sigs.size === 1 && hit.sigs.has(sig) })
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

  // ── 远程看的打包缓存 ──────────────────────────────────────────────────────
  // 一屏连同样式、图片打成一整份很贵（3MB 的屏要几十毫秒，而且同步阻塞事件循环），但只要这一屏
  // 用到的文件一个都没动，结果就完全一样。按「每个文件的 mtime + 大小 + inode」判断上次那份还能不能用；
  // 能用就直接给，并带上 ETag：浏览器带 If-None-Match 过来时回 304，body 一个字节都不传。
  // 远程访问的主要成本就在这份 body 上——画布一次要 N 份，切 单页 ↔ 画布、关掉侧栏再开都要再来一遍。
  const bundleCache = new Map() // `${session}|${root}|${v}|${key}` → { etag, root, href, parent, v, picker, body, stamps, bytes }
  let bundleBytes = 0
  const BUNDLE_CACHE_BYTES = 64 * 1024 * 1024 // 存着的字符串总量上限，超了按 LRU 丢
  const BUNDLE_CACHE_MAX = 64
  const BUNDLE_CACHE_ONE = 24 * 1024 * 1024 // 单份太大（图多）就不进缓存，免得一份把整池占满

  function dropBundle(name) {
    const e = bundleCache.get(name)
    if (!e) return
    bundleBytes -= e.bytes
    bundleCache.delete(name)
  }

  /**
   * 目录里有改动（预览服务器的监听报上来的）：这个目录的打包结果全不要了。
   * 印记看不出来的改动（保留 mtime 的覆盖、粗精度盘上同一刻度里改两次、大小没变）靠这个兜住
   */
  function dropBundlesOf(root) {
    const r = path.resolve(root)
    for (const [name, e] of bundleCache) if (e.root === r) dropBundle(name)
  }

  function keepBundle(name, entry) {
    dropBundle(name)
    bundleCache.set(name, entry)
    bundleBytes += entry.bytes
    while (bundleCache.size > BUNDLE_CACHE_MAX || bundleBytes > BUNDLE_CACHE_BYTES) {
      const oldest = bundleCache.keys().next()
      if (oldest.done) break
      dropBundle(oldest.value)
    }
  }

  /**
   * 一个文件现在的样子。inode 也看：编辑器常写临时文件再换名，mtime 可能没变但文件已经换了。
   * 读不到记 '-'，后来才建出来的文件会让判断从 '-' 变成新值，缓存自然失效。
   */
  function stampOf(root, v, rel) {
    try {
      const f = bundleFile(root, v, rel)
      if (!f) return '-'
      const s = fs.statSync(f)
      return `${s.mtimeMs}:${s.size}:${s.ino}`
    } catch {
      return '-'
    }
  }

  /**
   * 打包时这个文件从哪读。打包（read）、印记（stampOf）、命中时重算 strict 都走这一套：
   * 旧版本里没有这个文件时，都退回目录里的当前文件，不然退回的那份改了、缓存却不会失效
   */
  function bundleFile(root, v, rel) {
    let f = ''
    if (v) f = history.fileOf(root, v, rel) || ''
    // 组件文件（#30）：旧版本只认那一版快照里的，没有就是没有（不拿现在的顶上，不然旧版本会混进新组件）
    if (v && /^components\//.test(rel)) return f
    // 模拟数据和预览一个规矩（serve.js versionMock / mockOf）：旧版本只认那一版自己的 mock.json（那版没有就是没有，
    // 不拿现在的顶上）；现在的是软链接就当没有
    if (rel === MOCK_FILE) {
      if (v) return f
      const p = path.join(root, MOCK_FILE)
      try { return fs.lstatSync(p).isFile() ? p : '' } catch { return '' }
    }
    if (!f) {
      const hit = resolveInRoot(root, '/' + rel.split('/').map(encodeURIComponent).join('/'))
      f = hit && hit.real ? hit.real : ''
    }
    // 字体库（#31）：dsh-fonts/<库 id>.woff2 不进版本记录、也可能被手动删了，从字体库缓存拿（和 serve.js 历史预览一样）
    if (!f && studio.fonts && libFontIdOf(rel)) f = studio.fonts.cached(libFontIdOf(rel)) || ''
    return f
  }

  /** picker.js 的指纹：它被内联进每一份包里，换了就不能再用留着的包 */
  function pickerStamp() {
    try {
      const s = fs.statSync(PICKER_FILE)
      return `${s.size}:${Math.round(s.mtimeMs)}`
    } catch {
      return '-'
    }
  }

  /**
   * 交打包结果：浏览器手上那份就是这份（ETag 按内容算，对上了内容就一样）就 304，让它用自己缓存的。
   */
  function sendBundle(req, res, entry) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      ETag: entry.etag,
    }
    // 反代可能压缩过：同一份内容的字节表示不止一种，所以是弱校验（W/）
    const inm = String(req.headers['if-none-match'] || '')
    if (inm && inm.split(',').some((x) => x.trim() === entry.etag)) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    headers['Content-Length'] = Buffer.byteLength(entry.body)
    res.writeHead(200, headers)
    res.end(entry.body)
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
    // 一页多状态（#30）：?state=paid 打包时就把 <html data-state> 设好（沙盒里的 srcdoc 没有地址参数，设状态那段读不到）
    const state = /^[A-Za-z0-9_-]{1,32}$/.test(q.get('state') || '') ? q.get('state') : ''
    const href = st.origin ? `${st.origin}/${v ? `__dsh_design__/v/${v}/` : ''}${key.split('/').map(encodeURIComponent).join('/')}${state ? '?state=' + state : ''}` : ''
    const name = `${q.get('session') || ''}|${t.root}|${v}|${key}|${state}`
    // fresh=1：右侧栏要求「真的重取」（刷新按钮、目录里刚改过、失败重试）。这种情况下服务端必须重新打包，
    // 不能拿印记去复用——mtime 精度粗的盘（HFS+ 1s、FAT32 2s、部分网络盘）上，同一刻度里改两次、
    // 大小又没变，印记一模一样，光靠标记永远换不出新内容
    const fresh = q.get('fresh') === '1'
    // 打的是哪个目标：右侧栏拿它核对，请求发出后会话换了目录（或预览服务器换了端口）的回包不存进它的缓存
    const whose = { root: t.root, origin: st.origin || '' }
    // 先看大小，太大的不读（打包总量也封顶，见 bundle.js）
    const big = new Set() // 有、但太大没读的
    const readRel = (rel) => {
      const f = bundleFile(t.root, v, rel)
      if (!f) return null
      const s = fs.statSync(f)
      if (s.isFile() && s.size > BUNDLE_MAX) big.add(rel)
      return s.isFile() && s.size <= BUNDLE_MAX ? fs.readFileSync(f) : null
    }
    // 别人做的设计（设计库来的、没改过）：加硬规矩，右侧栏的沙盒也不放行表单
    // 市场来的原版也算（和本地预览、正式打包同一套判定）
    const strictOf = (page) => library.strictHtml(page) || market.strictHtml(page) || (v > 0 && library.strictVersions(t.root))
    const had = fresh ? null : bundleCache.get(name)
    // 上次那份还能用：用到的文件一个都没动，地址没换（预览端口变了，里面的 <base> 就不一样了），
    // 内联的 picker 没换，而且现在仍然不用加硬规矩——文件没动、信任却变了（退回旧版时记下了别人做的页面）
    // 也不能再给那份没加规矩的。进缓存的都是不加规矩的，所以这里只要看现在是不是要加
    let hit = false
    try {
      hit = !!had && had.href === href && had.parent === parent && had.v === v && had.picker === pickerStamp()
        && [...had.stamps].every(([rel, stamp]) => stampOf(t.root, v, rel) === stamp)
      if (hit) { const page = readRel(key); hit = !!page && !strictOf(page) }
    } catch {
      hit = false
    }
    if (hit) {
      keepBundle(name, had) // 挪到队尾，当 LRU 用
      return sendBundle(req, res, had)
    }
    dropBundle(name)
    const started = Date.now()
    const picker = pickerStamp()
    const deps = new Set() // 这一屏用到的文件（含没找到的）：右侧栏看到这些改了才重新打包
    const pre = new Map() // 读之前的印记：和读完后的对不上（打包这段时间里被改、被删）就不进缓存
    const read = (rel) => {
      if (!deps.has(rel)) { deps.add(rel); pre.set(rel, stampOf(t.root, v, rel)) }
      return readRel(rel)
    }
    if (!(v > 0)) read.hasCompDir = () => hasCompDir(t.root) // 旧版本：快照里有用到的组件文件才算（见 adopts）
    try {
      const page = read(key)
      if (!page) return json(res, 404, { error: 'no-screen' })
      const strict = strictOf(page)
      const nonce = strict ? crypto.randomBytes(16).toString('base64') : ''
      // 页面写了这个状态才设（老页面自己拿 ?state= 当参数的不动）
      const setState = state ? stateScript(page.toString('utf8'), '?state=' + state) : ''
      // 模拟数据（#30）：读 mock.json 也记进用到的文件（改了就重新打包）；存的键按设计目录分开（右侧栏同一个源里放着几套设计）
      const mk = mockOfBuf(read(MOCK_FILE), big.has(MOCK_FILE)) // 太大的：和预览一样带上运行时、报「太大」
      // 数据里写的本地图片：远程那边够不着预览地址，和页面里的图一样换成 data: 地址
      const over = []
      const mockAssets = mk ? dataAssets(mk.data, read, BUNDLE_MAX, over, (rel) => big.has(rel)) : null
      // 换不下的图（太大）：不悄悄留成坏图，报进这屏的页面错误（体检、屏上看得到）
      const mockErr = mk ? [mk.err, over.length ? `数据里的图太大，远程看时没带上：${over.slice(0, 3).join('、')}${over.length > 3 ? ' 等' : ''}` : ''].filter(Boolean).join('；') : ''
      const mockTag = mk ? mockScript({ ...mk, assets: mockAssets, err: mockErr }, { scope: crypto.createHash('sha1').update(t.root).digest('hex').slice(0, 10) }) : ''
      const lead = strict ? strictMeta(nonce) + (ERR_CATCHER + setState + mockTag).replaceAll('<script>', `<script nonce="${nonce}">`) : ERR_CATCHER + setState + mockTag
      // 组件（#30）：先展开（读组件也走 read：记进用到的文件，组件一改就重新打包）；别人做的按原始字节认，展开后再去脚本
      let text = page.toString('utf8')
      try { text = expandPreview(text, read, key).html } catch (e) { log(e) }
      let html = bundle(strict ? defang(text) : text, { key, read, base: href, lead, tail: inlinePicker(fs.readFileSync(PICKER_FILE, 'utf8'), parent, href, nonce) })
      // 打包后图片变成 data: 地址，文件名没了：把用到的 AI 示意图记在页面里，导出时照样提醒
      const aiNames = [...deps].filter((x) => isPhotoAsset(x)).map((x) => path.basename(x))
      if (aiNames.length) html = html.replace(lead, () => `${lead}<meta name="ddp-ai-photos" content="${aiNames.join(',').replace(/[^a-z0-9.,-]/gi, '')}">`)
      // 用到的文件太多就不列也不缓存（null = 右侧栏不按文件筛）：一次 stat 两百多个不划算，宁可重新打包
      if (deps.size > 200) return json(res, 200, { html, deps: null, strict, ...whose })
      // strict 那一份里带的是这次现生成的随机 nonce：不复用，也就不进缓存
      if (strict) return json(res, 200, { html, deps: [...deps], strict, ...whose })
      const stamps = new Map([...deps].map((rel) => [rel, stampOf(t.root, v, rel)]))
      const body = JSON.stringify({ html, deps: [...deps], strict, ...whose })
      // 这几种情况不进缓存：打包这段时间里有文件变了（读之前和读完后的印记对不上：被改、被换、被删，
      // 可能是半新半旧），picker 换了，或者某个文件刚刚才写过（2 秒内的 mtime 说明它还在被反复改，
      // 粗精度盘上这时候的印记不可信）
      const raced = picker !== pickerStamp() || [...stamps].some(([rel, s]) => {
        if (pre.get(rel) !== s) return true
        if (s === '-') return false
        const ms = Number(s.slice(0, s.indexOf(':')))
        return ms >= started || started - ms < 2000
      })
      if (body.length > BUNDLE_CACHE_ONE || raced) return json(res, 200, { html, deps: [...deps], strict, ...whose })
      // ETag 按交出去的内容算：内容不一样 ETag 就一定不一样，浏览器手上的旧内容不会被 304 认成新的
      // （按文件印记算的话，印记看不出来的改动会让新旧两份共用一个 ETag）
      const etag = 'W/"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 32) + '"'
      const entry = { etag, root: path.resolve(t.root), href, parent, v, picker, body, stamps, bytes: body.length }
      keepBundle(name, entry)
      sendBundle(req, res, entry)
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
  function writeExport(session, name, ext, buf) {
    const base = String(name || 'design').replace(new RegExp(`\\.${ext}$`, 'i'), '').replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design'
    const dir = exportDir(session)
    fs.mkdirSync(dir, { recursive: true })
    // 独占创建（wx）：查名和写入之间别人刚好建了同名文件，也不会盖掉它，换下一个名字
    for (let i = 1; i < 1000; i++) {
      const file = path.join(dir, i === 1 ? `${base}.${ext}` : `${base}-${i}.${ext}`)
      try { fs.writeFileSync(file, buf, { flag: 'wx' }) } catch (e) { if (e.code === 'EEXIST') continue; throw e }
      exported.add(file)
      return file
    }
    throw new Error('too many files with this name')
  }
  function saveExport(res, session, name, ext, buf) {
    try {
      json(res, 200, { path: writeExport(session, name, ext, buf) })
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

  /**
   * 导出图片 / PDF / PPT 前的组件预检（#30）：截图不经打包，组件出错的红框会被当成正常画面存下来，所以先查。
   * POST { session, keys?, v? } → { pages: [{ page, errors }] }（只列有错的；某一版就从那一版的快照读）
   */
  async function compCheckRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const st = tracker.stateOf(String(body.session || ''))
    const t = st && st.target
    if (!t || t.kind !== 'file') return json(res, 200, { pages: [] })
    const v = Math.max(0, Math.floor(Number(body.v) || 0))
    // 没挑屏 = 整套：某一版就按那一版存下的屏（后来删掉的屏旧版里还在，截图会截到）
    const verScreens = () => { const x = v > 0 ? tracker.versions(String(body.session || '')).find((y) => y.n === v) : null; return x ? x.screens : allScreens(t.root) }
    const keys = Array.isArray(body.keys) ? [...new Set(body.keys.filter((k) => typeof k === 'string').map((k) => k.replace(/^v\d+\|/, '').split(/[?#]/)[0]).filter((k) => /^[^/\\]+\.html?$/i.test(k)))].slice(0, 2000) : verScreens()
    const read = v > 0 ? versionReader(history, t.root, v) : dirReader(t.root)
    let pages = []
    try { pages = precheckScreens(keys, read) } catch (e) { log(e); return json(res, 500, { error: 'compcheck' }) } // 查不了不当成没错
    json(res, 200, { pages: pages.slice(0, 50).map((x) => ({ page: x.page, errors: x.errors.slice(0, 5).map((d) => ({ code: d.code, message: d.message, file: d.file, line: d.line, fix: d.fix })) })) })
  }

  /**
   * 屏多过上限（#29）：导出用的全部屏，按导出的先后（显示的照右侧栏的顺序，收起来的照设计清单 / 生成先后插回原位），带页面标题（导出的目录、演示的下拉里用）。
   * 右侧栏导出前现问这一份，不靠它自己记的（刚加的屏、改了名的收起来的屏，它都还没轮询到）。没收起来的给空（右侧栏就用显示的这些）
   */
  async function hiddenRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const st = tracker.stateOf(session)
    const t = st.target
    const hid = tracker.hiddenScreens(session)
    if (!hid.length) return json(res, 200, { target: targetKeyOf(t), list: [] })
    const on = new Set(hid)
    const all = exportOrder(st.screens, hid, allScreens(t.root))
    const keys = all.slice(0, MAX_PAGES) // 一次最多导出这么多屏，多的（排在最后的）右侧栏提示没导出
    const list = keys.map((key) => {
      let title = ''
      try {
        const fd = fs.openSync(path.join(t.root, key), 'r')
        try { const buf = Buffer.alloc(8192); const n = fs.readSync(fd, buf, 0, buf.length, 0); title = (/<title[^>]*>([^<]{1,120})<\/title>/i.exec(buf.subarray(0, n).toString('utf8')) || [])[1] || '' } finally { fs.closeSync(fd) }
      } catch { title = '' }
      return { key, title: title.replace(/\s+/g, ' ').trim(), hidden: on.has(key) }
    })
    json(res, 200, { target: targetKeyOf(t), list, cut: all.length - keys.length })
  }

  // PDF / PPT 分批传（#29）：几百屏的截图一次传不动，右侧栏每截几十屏传一批，最后一批带 done 再拼。job → { session, pages, bytes, at }
  const docJobs = new Map()
  const sweepDocJobs = () => { const old = Date.now() - DOC_JOB_TTL; for (const [k, j] of docJobs) if (j.at < old) docJobs.delete(k) }
  // 导出到一半退出 / 右侧栏关了：没人再来传，也按时清掉攒着的截图（不等下一次导出）
  ctx.effect(() => { const iv = setInterval(sweepDocJobs, 60 * 1000); if (iv.unref) iv.unref(); return () => { clearInterval(iv); docJobs.clear() } }, 'dsh-design-studio: doc jobs')

  /** 一页截图：JPEG + CSS 尺寸 + 标题 + 跳转链接；不是 JPEG 给 null */
  function docPage(p) {
    const jpg = Buffer.from(String((p && p.jpg) || ''), 'base64')
    const info = jpegInfo(jpg)
    if (!info) return null
    // 页面大小（CSS 像素）：没给或不像话就按图片的一半算（截图是 2 倍）
    const ok = (v) => Number.isFinite(+v) && +v >= 16 && +v <= 30000
    const w = ok(p.w) && ok(p.h) ? +p.w : info.width / 2
    const h = ok(p.w) && ok(p.h) ? +p.h : info.height / 2
    // 跳转链接原样带过去，doc.js 里挑掉不合法的；分批传的链接写的是目标屏的 key（到最后才知道它是第几页）
    return { jpg, w, h, key: typeof p.key === 'string' ? p.key.slice(0, 300) : '', title: String(p.title || '').slice(0, 80), links: Array.isArray(p.links) ? p.links.slice(0, 50) : [] }
  }

  /** 几屏拼成 PDF / PPT：每屏一页，页面大小按那一屏的 CSS 尺寸。带 job 的是分批传：没 done 的只攒着 */
  async function docRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, MAX_DOC) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const job = typeof body.job === 'string' && /^[a-z0-9]{8,40}$/i.test(body.job) ? body.job : ''
    let pages = []
    if (job) {
      sweepDocJobs()
      if (body.cancel) { if (docJobs.get(job)?.session === session) docJobs.delete(job); return json(res, 200, { ok: true }) } // 导出到一半换了设计
      // at：右侧栏说之前已经传了几页。前面传过、这里却没了（等太久被清掉、DSH 重启过），或页数对不上：别拿半截拼，整份重来
      const sent = typeof body.at === 'number' ? Math.max(0, Math.floor(body.at)) : -1
      let j = docJobs.get(job)
      if (!j) {
        if (sent > 0) return json(res, 410, { error: 'jobGone' })
        j = { session, pages: [], bytes: 0, at: Date.now() }
        docJobs.set(job, j)
      }
      if (j.session !== session) return json(res, 400, { error: 'job' })
      if (sent >= 0 && j.pages.length !== sent) { docJobs.delete(job); return json(res, 409, { error: 'jobGone' }) }
      for (const p of Array.isArray(body.pages) ? body.pages.slice(0, DOC_CHUNK) : []) {
        const pg = docPage(p)
        if (!pg) { docJobs.delete(job); return json(res, 400, { error: '不是 JPEG' }) }
        j.bytes += pg.jpg.length
        if (j.pages.length >= MAX_PAGES || j.bytes > DOC_JOB_BYTES) { docJobs.delete(job); return json(res, 413, { error: 'tooBig' }) }
        j.pages.push(pg)
      }
      j.at = Date.now()
      if (!body.done) return json(res, 200, { ok: true, n: j.pages.length })
      docJobs.delete(job)
      pages = j.pages
      // 链接：目标屏的 key 换成第几页（没截上的屏不算）
      const at = new Map(pages.map((p, i) => [p.key, i]))
      // 跳到某个状态（order.html?state=paid）：这次没按状态各出一页就跳到那屏
      const toOf = (k) => (at.has(k) ? at.get(k) : at.has(k.split('?')[0]) ? at.get(k.split('?')[0]) : -1)
      for (const p of pages) p.links = p.links.map((l) => (l && typeof l.key === 'string' ? { x: l.x, y: l.y, w: l.w, h: l.h, to: toOf(l.key) } : l)).filter((l) => l && l.to >= 0)
    } else {
      for (const p of Array.isArray(body.pages) ? body.pages.slice(0, MAX_PAGES) : []) {
        const pg = docPage(p)
        if (!pg) return json(res, 400, { error: '不是 JPEG' })
        pages.push(pg)
      }
    }
    const format = body.format === 'pdf' || body.format === 'pptx' ? body.format : ''
    if (!format) return json(res, 400, { error: 'format 只能是 pdf / pptx' })
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
    if (targetMoved(res, session, body.target)) return
    saveExport(res, session, body.name, format, buf)
  }

  /** 整套 HTML 演示的参数（导出和公网链接共用）：挑掉不合法、重复的屏；画幅、深浅色、调节值按右侧栏给的。没有屏给 null */
  function packParams(body) {
    const okKey = (k) => typeof k === 'string' && /^[^\\]+\.html?$/i.test(k) && !k.split('/').some((p) => !p || p === '.' || p === '..')
    const seen = new Set()
    const screens = []
    for (const s of Array.isArray(body.screens) ? body.screens.slice(0, PACK_SCREENS) : []) {
      if (!s || !okKey(s.key) || seen.has(s.key)) continue
      seen.add(s.key)
      screens.push({ key: s.key, label: String(s.label || s.key).slice(0, 80), top: s.top === true })
    }
    if (!screens.length) return null
    const dim = (x, d) => (Number.isFinite(+x) && +x >= 100 && +x <= 8000 ? Math.round(+x) : d)
    const tw = body.tweak && typeof body.tweak === 'object' ? body.tweak : null
    const plain = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, x]) => typeof k === 'string' && k.length < 80 && (typeof x === 'string' || typeof x === 'number' || x === null || typeof x === 'boolean')).slice(0, 200))
    return {
      screens,
      kind: typeof body.kind === 'string' ? body.kind : 'web',
      w: dim(body.w, 1280),
      h: dim(body.h, 800),
      os: body.os === 'win' ? 'win' : '',
      dark: body.dark === true,
      scheme: body.scheme === 'dark' ? 'dark' : 'light',
      // fonts：外观面板里选了、还没存的字体库字体（只要 id，打包时从字体库缓存读）
      tweak: tw ? { vars: plain(tw.vars), attrs: plain(tw.attrs), fonts: Array.isArray(tw.fonts) ? [...new Set(tw.fonts.map((x) => (x && typeof x === 'object' ? x.id : x)).filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)))].slice(0, 8) : [] } : null,
      title: String(body.title || '').slice(0, 120),
      lang: body.lang === 'en' ? 'en' : 'zh',
      fit: body.fit === true,
    }
  }

  /** 打包一个设计目录（v 是历史版本，0 = 现在的文件）：deps 是读过的相对路径，files 是对应的文件（公网链接按它们判断要不要重新打包） */
  function packDesign(root, v, params) {
    const deps = new Set()
    const files = new Set()
    const big = new Set() // 有、但太大没读的（数据里绑的图读不了要报出来，不能当没有）
    const read = (rel) => {
      deps.add(rel)
      const f = bundleFile(root, v, rel)
      files.add(f || path.join(root, ...rel.split('/')))
      if (!f) return null
      const s = fs.statSync(f)
      if (s.isFile() && s.size > BUNDLE_MAX) big.add(rel)
      return s.isFile() && s.size <= BUNDLE_MAX ? fs.readFileSync(f) : null
    }
    if (!(v > 0)) read.hasCompDir = () => hasCompDir(root) // 旧版本：快照里有用到的组件文件才算（见 adopts）
    const strictOf = (page) => library.strictHtml(page) || market.strictHtml(page) || (v > 0 && library.strictVersions(root))
    const libFont = (id) => {
      const f = studio.fonts && studio.fonts.index.fonts.find((x) => x.id === id)
      const p = f && studio.fonts.cached(id)
      return p ? { family: f.family, weights: f.weights, data: fs.readFileSync(p) } : null
    }
    let pack
    try { pack = buildPack({ ...params, read, bigOf: (rel) => big.has(rel), strictOf, libFont }) } catch (e) {
      // 打不出来（比如组件有错、缺组件）：带上这次读过和想读的文件，公网链接看着它们，改好了自己重打
      if (e && typeof e === 'object') e.deps = [...files]
      throw e
    }
    return { pack, deps, files: [...files] }
  }

  /**
   * 整套 HTML 演示（#26）：本地文件的设计，所有屏打进一个 .html（见 htmlpack.js），存进 exports/。
   * 屏、版本、画幅、深浅色、外壳、调节滑块还没存的值都按右侧栏眼前的来；不截图，几秒出来
   */
  async function htmlPackRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, 1024 * 1024) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    const st = tracker.stateOf(session)
    const t = st && st.target
    if (!t || t.kind !== 'file') return json(res, 400, { error: 'not-file' })
    if (targetMoved(res, session, body.target)) return
    const v = Math.max(0, Math.floor(Number(body.v) || 0))
    const params = packParams(body)
    if (!params) return json(res, 400, { error: 'noScreens' })
    let pack, deps
    try {
      ;({ pack, deps } = packDesign(t.root, v, params))
    } catch (e) {
      // compErr（#30）：哪几屏的组件有错，右侧栏列出来、能点过去
      return json(res, e.code ? 400 : 500, { error: e.code || e.message, ...(e.pages ? { pages: e.pages } : {}), ...(e.files ? { files: e.files.slice(0, 10), message: e.message } : {}) })
    }
    // 打包时会话换了设计：别把 A 的演示存进 B 的 exports/
    if (targetMoved(res, session, body.target)) return
    const ai = new Set([...deps].filter((x) => isPhotoAsset(x)).map((x) => path.basename(x)))
    try {
      const file = writeExport(session, body.name, 'html', Buffer.from(pack.html, 'utf8'))
      json(res, 200, { path: file, count: pack.count, missing: pack.missing, skipped: pack.skipped.slice(0, 20), skippedN: pack.skipped.length, gone: (pack.gone || []).slice(0, 20), goneN: (pack.gone || []).length, ai: ai.size, bytes: pack.html.length })
    } catch (e) {
      json(res, 500, { error: e.message })
    }
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
    // keep：右侧栏只是换了一屏，入口已经关了（别处点了停止、闲着自动关）就别重开
    if (body.keep === true && !phone.status(session).on) return json(res, 200, phone.status(session))
    const st = await phone.start(session, typeof body.path === 'string' && body.path.startsWith('/') ? body.path : '/')
    // 二维码一行一串 0 / 1，右侧栏画成 SVG
    json(res, 200, st.on ? { ...st, qr: qrMatrix(st.url).map((row) => row.map((c) => (c ? 1 : 0)).join('')) } : st)
  }

  /**
   * 公网链接（#27，实验）：{ session, on: true, …整套演示的参数 } 开（开着就换参数），{ on: false } 关，
   * { peek: true } 只看状态（连上了带二维码）。只能右侧栏里人点开，不给模型工具
   */
  async function pubShareRoute(req, res) {
    if (!admit(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    let body
    try { body = await readBody(req, 1024 * 1024) } catch (e) { return json(res, 400, { error: e.message }) }
    const session = String(body.session || '')
    if (!session) return json(res, 400, { error: '缺 session' })
    const withQr = (x) => (x.on && x.url ? { ...x, qr: qrMatrix(x.url).map((row) => row.map((c) => (c ? 1 : 0)).join('')) } : x)
    if (body.on === false) {
      pub.stop(session)
      return json(res, 200, { ...pub.status(session), tool: pub.hasTool() })
    }
    // 看状态：顺带说本机有没有 cloudflared（没有的话右侧栏先请人下载）
    if (body.peek === true) return json(res, 200, { ...withQr(pub.status(session)), tool: pub.hasTool() })
    // 人点了「下载」：从 Cloudflare 官方 GitHub 下到插件自己的目录，进度在 peek 里；「取消」停下
    if (body.download === true || body.cancel === true) {
      if (body.cancel === true) pub.cancelTool()
      else pub.fetchTool()
      return json(res, 200, { ...pub.status(session), tool: pub.hasTool() })
    }
    const t = tracker.stateOf(session).target
    if (!t || t.kind !== 'file') return json(res, 400, { error: 'not-file' })
    if (targetMoved(res, session, body.target)) return
    const params = packParams(body)
    if (!params) return json(res, 400, { error: 'noScreens' })
    const p = { root: t.root, ...params }
    // 右侧栏换了屏、画幅、深浅色：开着就跟着换，没开不新开（开要人点）
    if (body.update === true) return json(res, 200, { ok: pub.update(session, p) })
    const r = await pub.start(session, p, { name: params.title || path.basename(t.root) })
    // 没开起来的原因（没装 cloudflared、打包不出来）start 直接给；开着的照状态给
    const now = pub.status(session)
    json(res, 200, { ...withQr(now.on ? now : { ...now, ...r }), tool: pub.hasTool() })
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
    return (await dshCwd(id)) || known
  }
  /** DSH 里这个会话的目录（会话头里记的）；问不到回空 */
  async function dshCwd(id) {
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
    return ''
  }
  const lib = createLibraryRoutes({ admit, readBody, json, tracker, library, inspiration, studio, open, storeLoad: fileStore.load, version: VERSION, exported, log, sessionCwd, vocab: () => market.vocab() })
  // 画布上睡着的屏的缩略图（issue #17）
  const canvasThumbs = createCanvasThumbs({
    tracker,
    dirs: thumbDirs,
    browser: () => studio.browser,
    trust: () => { try { return library.trustRev() } catch (e) { log(e); return '' } },
    strictRoot: (root) => { try { return library.strictRoot(root) || market.isStaging(root) } catch (e) { log(e); return true } },
    admit,
    json,
    log,
  })
  const mk = createMarketRoutes({ admit, readBody, json, tracker, library, market, open, systemsDir: SYSTEMS_DIR, log, sessionCwd })

  const routes = { works: lib.works, workthumb: lib.workthumb, scrthumb: canvasThumbs.route, verthumb: canvasThumbs.verRoute, pack: lib.pack, usezip: lib.usezip, ghauth: lib.ghauth, submit: lib.submit, inspire: lib.inspire, inspimg: lib.inspimg, ...mk, state, open: openRoute, view: viewRoute, close: closeRoute, history: historyRoute, restore: restoreRoute, hidden: hiddenRoute, edit: editRoute, style: styleRoute, sharecheck: shareCheckRoute, compcheck: compCheckRoute, drift: driftRoute, states: statesRoute, bundle: bundleRoute, ref: refRoute, export: exportRoute, doc: docRoute, htmlpack: htmlPackRoute, pubshare: pubShareRoute, reveal: revealRoute, phone: phoneRoute, check: checkRoute, locate: locateRoute, tweak: tweakRoute, fonts: fontsRoute, mocksave: mockSaveRoute, systems: systemsRoute, frames: framesRoute, systhumb: systhumbRoute, project: projectRoute, impl: implRoute, implcmp: implCmpRoute, implshot: implShotRoute }
  for (const [key, handler] of Object.entries(routes)) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: API + key,
      handler: (req, res, peer) => {
        if (peer) req[ADMITTED] = peer // 新版 DSH 准入给的 Peer：admit() 认它，见 ADMITTED 的说明
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
    // 会话归档了：它的公网链接马上关（面板进不去了，别让链接一直开到点）。老版本 DSH 没有这个事件，就只是收不到
    ctx.on('workspace/session-archived', (req) => {
      try {
        const id = req && req.sessionId
        if (id) pub.stop(String(id))
      } catch (e) {
        log(e)
      }
    }, { global: true })
    // 用户在右侧栏亲手改了设计：模型下一步开始前补一条说明（DSH 自带的时间、操作卡片提醒也是这么加的），
    // 免得它凭自己之前写的内容接着改、做进项目时用回旧样子（#28）。老版本 DSH 没有这个事件，就只是收不到
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = typeof next === 'function' ? await next() : undefined
      try {
        if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages) || (payload && payload.signal && payload.signal.aborted)) return decision
        const id = payload && payload.agent && payload.agent.session && payload.agent.session.id
        if (!id) return decision
        const edits = tracker.takeEdits(String(id))
        const note = editsNotice(edits, langOf(decision.messages))
        if (!note) return decision
        return { ...decision, messages: [...decision.messages, noticeMessage(note, crypto.randomUUID())] }
      } catch (e) {
        log(e)
        return decision
      }
    }, { prepend: true })
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
