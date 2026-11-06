/**
 * 设计库的检查规则：内容仓库的机器人、插件「用这个开始」前、插件「分享」前，用的都是这一份。
 * 不依赖 Node（也不依赖浏览器）：传进来的是文件内容（Uint8Array 或字符串），Node、浏览器里都能跑。
 *
 *   checkPack(files, opts)     整套查：路径、类型、大小、清单（design.json）、每个 HTML / CSS / SVG 的危险写法、个人信息
 *   checkManifest(m, opts)     只查清单
 *   normalizeHtml(src, opts)   能自动修的先修掉：注释、站外链接（改成 #）、表单提交地址
 *   message(p, lang)           一条问题 → 一句能照着改的话
 *
 * 只收静态设计稿：没有脚本、不联网（图片 / 样式只能用包里的文件或 data: 图片）、表单只留样子交不出数据。
 */

import crypto from 'node:crypto'
import { tokenize, scanTags, decodeEntities, lineAt, visibleText, rawEnd } from './html.js'
import { scanCss, cssTokens, URL_FUNCS } from './css.js'

export const FORMAT = 1
export const LIMITS = {
  files: 60, // 一套最多几个文件
  screens: 24, // 最多几屏（和工作台画布一样）
  depth: 3, // 目录最多几层
  html: 200 * 1024,
  css: 200 * 1024,
  svg: 200 * 1024,
  json: 64 * 1024,
  md: 64 * 1024,
  image: 400 * 1024,
  side: 2400, // 图片长边
  total: 2 * 1024 * 1024,
  name: 64, // 文件名长度
}
export const TYPES = ['template', 'system', 'style']
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0']
export const KINDS = ['web', 'app', 'miniprogram', 'tablet', 'desktop', 'poster', 'slides', 'email']
export const STYLE_IDS = ['minimal', 'warm', 'editorial', 'dark', 'playful', 'fresh', 'tech', 'glass', 'soft', 'guochao', 'ink', 'cyber', 'cute', 'retro', 'sale', 'japandi', 'swiss', 'brutal', 'cream', 'sport']
export const HEADS = ['SANS', 'SERIF', 'ROUND', 'MONO', 'GROTESK'] // 风格卡的字体只能是这几种系统字体栈
const META_ALIAS = { phone: 'app', mobile: 'app', ios: 'app', android: 'app', mini: 'miniprogram', miniapp: 'miniprogram', weapp: 'miniprogram', wechat: 'miniprogram', 小程序: 'miniprogram', pad: 'tablet', ipad: 'tablet', pc: 'desktop', electron: 'desktop', tauri: 'desktop', mac: 'desktop', macos: 'desktop', windows: 'desktop', win: 'desktop', 桌面: 'desktop', 桌面软件: 'desktop', social: 'poster', image: 'poster', slide: 'slides', deck: 'slides', ppt: 'slides', mail: 'email' }

const EXT = { html: 'html', css: 'css', svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', json: 'json', md: 'md' }
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif)(;[a-z0-9=._-]+)*(;base64)?,/i
const DATA_SVG = /^data:image\/svg\+xml(;[a-z0-9=._-]+)*(;base64)?,/i
// 这些元素一律不收
const BAD_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'base', 'foreignobject', 'handler', 'listener', 'fencedframe', 'xss', 'param'])
// <link rel> 只收这几种
const LINK_RELS = new Set(['stylesheet', 'icon', 'shortcut', 'apple-touch-icon', 'mask-icon'])
// 值是地址的属性（会去拿，或点了会跳过去）
const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'srcset', 'imagesrcset', 'poster', 'data', 'background', 'lowsrc', 'dynsrc', 'longdesc', 'cite', 'action', 'formaction', 'manifest', 'codebase', 'archive', 'usemap', 'icon', 'profile', 'data-href'])
const DROP_ATTRS = new Set(['action', 'formaction', 'ping']) // 自动修：表单交不出去、点链接不往外发通知
// SVG 的这些属性按 CSS 值读（fill="url(#g)" 这种），里面的转义也会还原
const PRES_ATTRS = new Set(['fill', 'stroke', 'filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end', 'marker', 'cursor', 'color-profile'])
const BAD_SCHEME = /^(javascript|vbscript|livescript|mocha|feed|jar):|^data:(text\/html|application\/|text\/xml|image\/svg)/i
const NAV_TAGS = new Set(['a', 'area'])
const SVG_ANIM = new Set(['set', 'animate', 'animatetransform', 'animatemotion', 'animatecolor'])

// ── 可疑字（只标出来给人看，不直接拒） ────────────────────────────────────────
const PHISH = /登录|登陆|密码|验证码|银行卡|身份证|转账|汇款|客服|中奖|领取奖|充值|提现|\b(log ?in|sign ?in|password|passcode|verification code|bank card|credit card|wire transfer|account number|cvv)\b/i
const BRANDS = /微信支付|支付宝|淘宝|天猫|京东|拼多多|抖音|快手|美团|饿了么|小红书|哔哩哔哩|bilibili|微博|知乎|百度|腾讯|阿里巴巴|字节跳动|中国银行|工商银行|建设银行|农业银行|招商银行|交通银行|邮政储蓄|中国移动|中国联通|中国电信|12306|\b(apple|icloud|google|gmail|microsoft|outlook|paypal|amazon|netflix|facebook|instagram|whatsapp|wechat|alipay|taobao|tiktok|steam|binance|coinbase)\b/i
const INJECT = /忽略(之前|以上|前面|上面|先前)|无视(之前|以上|前面)|不要理会|你(现在)?是一个|你的新(任务|指令)|系统提示|提示词|\b(ignore (all |any )?(the )?(previous|prior|above|earlier)|disregard (all |the )?(previous|prior|above)|system prompt|you are now|new instructions|developer mode|jailbreak)\b|\b(preview_page|check_design|look_design|handoff_design|compare_design|extract_design_system|show_page|run_command|write_file|edit_file|read_file|ask_user_question|bash|shell)\b|rm -rf|\bsudo\b|\bcurl\s+-|\bwget\s|\|\s*(ba)?sh\b|powershell|chmod\s|\bnpm (i|install)\b|\bpip install\b/i
const URLISH = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.|\b[a-z0-9-]+\.(com|cn|net|org|io|xyz|top|cc|me|co|app|dev|site|shop|vip|info)\b/i
const PERSONAL_MAIL = /@(qq|163|126|yeah|sina|sohu|139|189|foxmail|aliyun|gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|mac|proton|protonmail)\.(com|cn|net|com\.cn)\b/i
const FAKE_MAIL = /@([a-z0-9-]+\.)*(example\.(com|org|net)|test|invalid|localhost|example)$/i

/** 一条问题的说明（{x} 换成具体内容）。sev：error 拒收 / flag 标给人看 */
const MSG = {
  path: { zh: '文件名「{x}」不行：只能用字母、数字、中文和 . _ -，不能以 . 开头，不能有 ..，目录最多 3 层', en: 'File name "{x}" is not allowed: use letters, digits, . _ - only, no leading dot, no "..", at most 3 folders deep' },
  ext: { zh: '「{x}」这种文件不收：只收 html、css、svg、png、jpg、webp、gif、avif、json、md（第一版不收脚本和字体文件）', en: '"{x}" files are not accepted: only html, css, svg, png, jpg, webp, gif, avif, json and md (no scripts or font files in this version)' },
  magic: { zh: '「{x}」的内容和扩展名对不上（比如改了扩展名的别的文件）：用真正的图片文件', en: '"{x}" does not match its extension (e.g. another file renamed): use a real image file' },
  utf8: { zh: '「{x}」不是 UTF-8 文字：另存为 UTF-8', en: '"{x}" is not UTF-8 text: save it as UTF-8' },
  nul: { zh: '「{x}」里有空字符（\\0）：删掉', en: '"{x}" contains NUL characters: remove them' },
  big: { zh: '「{x}」太大（{n}，上限 {max}）：压小一点', en: '"{x}" is too big ({n}, limit {max}): make it smaller' },
  side: { zh: '图片「{x}」太大（{n}，长边最多 {max} 像素）：缩小一点', en: 'Image "{x}" is too large ({n}, longest side at most {max} px): scale it down' },
  total: { zh: '整套太大（{n}，上限 {max}）：压缩图片、删掉没用的文件', en: 'The whole design is too big ({n}, limit {max}): compress images, remove unused files' },
  count: { zh: '文件太多（{n} 个，上限 {max}）', en: 'Too many files ({n}, limit {max})' },
  dup: { zh: '「{x}」重复了（不分大小写）', en: '"{x}" appears twice (case-insensitive)' },
  noManifest: { zh: '缺 design.json（设计清单）', en: 'design.json (the design manifest) is missing' },
  json: { zh: '「{x}」不是合法的 JSON：{n}', en: '"{x}" is not valid JSON: {n}' },
  field: { zh: 'design.json 的「{x}」不对：{n}', en: 'design.json field "{x}" is wrong: {n}' },
  unknownField: { zh: 'design.json 里有不认识的字段「{x}」：删掉', en: 'design.json has an unknown field "{x}": remove it' },
  screenMissing: { zh: 'design.json 列的屏「{x}」不在包里', en: 'Screen "{x}" listed in design.json is not in the package' },
  screenUnlisted: { zh: '「{x}」没列进 design.json 的 screens：加进去，或者改名成 _ 开头（不算一屏）', en: '"{x}" is not listed in design.json screens: add it, or rename it to start with _ (not a screen)' },
  subHtml: { zh: '子目录里的 HTML「{x}」不收：每屏都放在最外层', en: 'HTML in a subfolder ("{x}") is not accepted: keep every screen at the top level' },
  meta: { zh: '「{x}」缺 <meta name="dsh-design" content="{n}">，或者写的类型和 design.json 的 kind 不一样', en: '"{x}" lacks <meta name="dsh-design" content="{n}">, or its kind differs from design.json' },
  titleFmt: { zh: '「{x}」的 <title> 要写成「屏名 · 产品名」（中间是 ·）', en: '"{x}" needs a <title> like "Screen · Product" (with a middle dot)' },
  charset: { zh: '「{x}」声明的编码不是 UTF-8：改成 UTF-8（网页写 <meta charset="utf-8">）', en: '"{x}" declares a charset other than UTF-8: use UTF-8 (in HTML, <meta charset="utf-8">)' },
  tag: { zh: '「{x}」第 {line} 行有 <{n}>：不收（第一版不收脚本、内嵌网页、插件、<base>）', en: '"{x}" line {line} has <{n}>: not accepted (no scripts, embedded pages, plugins or <base>)' },
  handler: { zh: '「{x}」第 {line} 行有事件属性 {n}=：删掉（不收脚本）', en: '"{x}" line {line} has an event attribute {n}=: remove it (no scripts)' },
  scheme: { zh: '「{x}」第 {line} 行的 {n} 用了 javascript: / data:text/html 这类会运行代码的地址：删掉', en: '"{x}" line {line}: {n} uses a code-running URL (javascript:, data:text/html …): remove it' },
  srcdoc: { zh: '「{x}」第 {line} 行有 srcdoc：删掉', en: '"{x}" line {line} has srcdoc: remove it' },
  httpEquiv: { zh: '「{x}」第 {line} 行有 <meta http-equiv>（自动跳转 / 改规则）：删掉', en: '"{x}" line {line} has <meta http-equiv> (redirect / policy): remove it' },
  linkRel: { zh: '「{x}」第 {line} 行的 <link rel="{n}"> 不收：只收样式表和图标', en: '"{x}" line {line}: <link rel="{n}"> is not accepted (only stylesheets and icons)' },
  external: { zh: '「{x}」第 {line} 行引用了站外地址「{n}」：图片、样式、字体只能用包里的文件（或 data: 图片），不联网', en: '"{x}" line {line} references an outside URL "{n}": images, styles and fonts must come from the package (or data: images)' },
  externalLink: { zh: '「{x}」第 {line} 行的链接指向站外「{n}」：改成 #（分享时会自动改）', en: '"{x}" line {line} links outside ("{n}"): change it to # (sharing does this for you)' },
  absolute: { zh: '「{x}」第 {line} 行的地址「{n}」以 / 开头：改成相对路径（比如 assets/a.png）', en: '"{x}" line {line}: "{n}" starts with /: use a relative path (e.g. assets/a.png)' },
  backslash: { zh: '「{x}」第 {line} 行的地址「{n}」里有反斜杠 \\：改成 /', en: '"{x}" line {line}: "{n}" contains a backslash: use /' },
  outside: { zh: '「{x}」第 {line} 行的地址「{n}」跑到包外面了', en: '"{x}" line {line}: "{n}" points outside the package' },
  missing: { zh: '「{x}」第 {line} 行引用的「{n}」不在包里', en: '"{x}" line {line} references "{n}", which is not in the package' },
  badEscape: { zh: '「{x}」第 {line} 行的 {n} 里有看不懂的转义（&…;）：直接写字', en: '"{x}" line {line}: {n} has an unknown character reference (&…;): write the character directly' },
  animHref: { zh: '「{x}」第 {line} 行的 SVG 动画会改链接地址：删掉', en: '"{x}" line {line}: an SVG animation changes a link: remove it' },
  ping: { zh: '「{x}」第 {line} 行的链接有 ping（点了会往外发通知）：删掉（分享时会自动删）', en: '"{x}" line {line}: a link has ping (sends a request when clicked): remove it (sharing does this)' },
  form: { zh: '「{x}」第 {line} 行的表单有提交地址（{n}）：删掉（分享时会自动删，表单只留样子）', en: '"{x}" line {line}: the form has a submit target ({n}): remove it (sharing does this; forms stay visual only)' },
  comment: { zh: '「{x}」第 {line} 行有 HTML 注释：删掉（分享时会自动删）', en: '"{x}" line {line} has an HTML comment: remove it (sharing does this)' },
  cssImport: { zh: '「{x}」第 {line} 行用了 @import：把样式直接写进来，或在 HTML 里用 <link>', en: '"{x}" line {line} uses @import: inline the styles or <link> them from the HTML' },
  cssFunc: { zh: '「{x}」第 {line} 行用了 {n}()：删掉', en: '"{x}" line {line} uses {n}(): remove it' },
  cssProp: { zh: '「{x}」第 {line} 行用了 {n}：删掉', en: '"{x}" line {line} uses {n}: remove it' },
  cssBad: { zh: '「{x}」第 {line} 行的 CSS 写坏了（url 或字符串没写完整）：改对', en: '"{x}" line {line}: broken CSS (unfinished url or string): fix it' },
  fontUrl: { zh: '「{x}」第 {line} 行的 @font-face 用了字体文件：第一版只用系统字体（src 只能写 local()）', en: '"{x}" line {line}: @font-face loads a font file: only system fonts for now (src: local() only)' },
  svgDoctype: { zh: 'SVG「{x}」里有 <!DOCTYPE> / <!ENTITY> / <?…?>：删掉', en: 'SVG "{x}" has <!DOCTYPE>, <!ENTITY> or <?…?>: remove it' },
  notSvg: { zh: '「{x}」不像 SVG 文件', en: '"{x}" does not look like an SVG file' },
  eofTag: { zh: '「{x}」第 {line} 行的 <{n}> 没写完：补上 >', en: '"{x}" line {line}: <{n}> is not closed: add >' },
  style: { zh: 'style.json 的「{x}」不对：{n}', en: 'style.json field "{x}" is wrong: {n}' },
  contrast: { zh: 'style.json 配色对比度不够：{x} 只有 {n}:1（要 ≥ 4.5:1）', en: 'style.json contrast too low: {x} is {n}:1 (need ≥ 4.5:1)' },
  system: { zh: '设计系统缺「{x}」', en: 'The design system lacks "{x}"' },
  systemSource: { zh: '「{x}」：source/ 是设计台在本机放截图的地方，不分享也不安装；样张要用的图放到 assets/ 里', en: '"{x}": source/ is where the studio keeps local screenshots and is never shared or installed; put images the sample page uses in assets/' },
  asset: { zh: 'design.json 的 assets 里「{x}」：{n}', en: 'design.json assets "{x}": {n}' },
  // 个人信息：分享前插件里硬拦（一交上去就公开）；机器人那边标给人看
  phone: { zh: '「{x}」第 {line} 行像真的手机号（{n}）：改成 138 0000 0000 或 138****0000 这种假号', en: '"{x}" line {line} looks like a real phone number ({n}): use a fake one like 138 0000 0000' },
  idcard: { zh: '「{x}」第 {line} 行像真的身份证号（{n}）：改成打码的 1101**********1234', en: '"{x}" line {line} looks like a real ID number ({n}): mask it like 1101**********1234' },
  email: { zh: '「{x}」第 {line} 行像个人邮箱（{n}）：改成 hello@example.com 这种', en: '"{x}" line {line} looks like a personal email ({n}): use something like hello@example.com' },
  localPath: { zh: '「{x}」第 {line} 行有本机路径（{n}）：会带出你电脑的用户名，删掉或改成相对路径', en: '"{x}" line {line} has a local path ({n}): it reveals your computer user name; remove it or use a relative path' },
  inlineMany: { zh: '「{x}」里内嵌的图片太多（超过 {n} 份），没法逐个查：换成单独的图片文件', en: '"{x}" has too many inline images (over {n}) to check one by one: use separate image files' },
  inlineNested: { zh: '「{x}」第 {line} 行内嵌的矢量图里又套了内嵌的矢量图，没法查里面的字：改成单独的 .svg 文件', en: '"{x}" line {line} has an inline SVG nested inside another inline SVG, which cannot be checked: use a separate .svg file' },
  inlineSvgBad: { zh: '「{x}」第 {line} 行内嵌的矢量图里有不收的写法（{n}）：改成单独的 .svg 文件，按提示改', en: '"{x}" line {line} has an inline SVG with markup that is not accepted ({n}): move it into a separate .svg file and fix it there' },
  inlineEncoding: { zh: '「{x}」第 {line} 行内嵌的矢量图不是 UTF-8 编码，没法查里面的字：另存为 UTF-8，或改成单独的 .svg 文件', en: '"{x}" line {line} has an inline SVG that is not UTF-8, so it cannot be checked: re-save it as UTF-8, or use a separate .svg file' },
  inlineBad: { zh: '「{x}」第 {line} 行内嵌的图片认不出格式（写的是图片，内容不是）：换成单独的图片文件', en: '"{x}" line {line} has an inline image whose content is not a recognizable image: use a separate image file' },
  imgMetaInline: { zh: '「{x}」第 {line} 行内嵌的图片（data:image）带着拍摄信息：换成单独的图片文件，或另存一份不带信息的', en: '"{x}" line {line} has an inline image (data:image) that still carries photo metadata: use a separate image file, or re-save it without metadata' },
  imgMeta: { zh: '「{x}」里带着拍摄信息（EXIF / XMP / 注释）：另存一份不带信息的，或换成 PNG / JPG', en: '"{x}" still carries photo metadata (EXIF / XMP / comments): re-save it without metadata, or use PNG / JPG' },
  secret: { zh: '「{x}」里有你的分享记号（只该留在你自己电脑上）：删掉这段再分享', en: '"{x}" contains your share token (it should stay on your computer): remove it before sharing' },
  // 只标出来
  bizEmail: { zh: '「{x}」第 {line} 行有邮箱（{n}）：示例里最好用 example.com', en: '"{x}" line {line} has an email ({n}): prefer example.com in samples' },
  address: { zh: '「{x}」第 {line} 行像详细地址（{n}）：用虚构地址', en: '"{x}" line {line} looks like a street address ({n}): use a made-up one' },
  password: { zh: '「{x}」有密码框：要人看一眼是不是仿冒真实网站的登录页', en: '"{x}" has a password field: needs a human look (impersonation check)' },
  phish: { zh: '「{x}」有「{n}」这类字：要人看一眼是不是仿冒', en: '"{x}" contains words like "{n}": needs a human look (impersonation check)' },
  brand: { zh: '「{x}」出现了真实品牌「{n}」：市场只收虚构品牌', en: '"{x}" mentions the real brand "{n}": only made-up brands are accepted' },
  inject: { zh: '「{x}」里有像给模型下指令的字（「{n}」）：删掉或改写', en: '"{x}" has text that looks like instructions to the model ("{n}"): remove or rephrase it' },
  url: { zh: '「{x}」的文字里有网址（{n}）', en: '"{x}" text contains a URL ({n})' },
}

/** 一条问题 → 一句话 */
export function message(p, lang = 'zh') {
  const m = MSG[p.code] || { zh: p.code, en: p.code }
  return (lang === 'en' ? m.en : m.zh).replace(/\{(\w+)\}/g, (_, k) => (p[k] === undefined ? '' : String(p[k])))
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`)
const cut = (s, n = 60) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }

// ── 路径和地址 ────────────────────────────────────────────────────────────────

const SEG = /^[\p{L}\p{N}._-]+$/u

/** 包里的相对路径是否合规；合规返回规范写法（/ 分隔），不合规返回 '' */
export function cleanPath(p) {
  const s = String(p || '')
  if (!s || s.includes('\\') || s.startsWith('/') || /[\x00-\x1f\x7f]/.test(s)) return ''
  const segs = s.split('/')
  if (segs.length > LIMITS.depth + 1) return ''
  for (const g of segs) {
    if (!g || g === '.' || g === '..' || g.startsWith('.') || g.length > LIMITS.name || !SEG.test(g)) return ''
  }
  return segs.join('/')
}

function posixJoin(dir, rel) {
  const out = dir ? dir.split('/') : []
  for (const g of rel.split('/')) {
    if (g === '' || g === '.') continue
    if (g === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(g)
  }
  return out.join('/')
}

/**
 * 一个地址合不合规。ctx：'res' 会去拿的（图片 / 样式）、'nav' 点了跳过去的、'css' CSS 里的、'font' @font-face 里的
 * 返回 null（没问题）或 { code, ref }：external externalLink absolute backslash outside missing scheme
 */
export function checkRef(raw, { dir = '', files = null, ctx = 'res' } = {}) {
  // 浏览器读地址时去掉首尾空白，中间的制表符、换行也丢掉
  const v = String(raw).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, '')
  if (!v) return null
  const squash = v.replace(/[\x00-\x20]/g, '')
  if (BAD_SCHEME.test(squash) && !(DATA_SVG.test(squash) && ctx !== 'nav')) return { code: 'scheme', ref: cut(v) }
  if (v.startsWith('#')) return null
  if (/^data:/i.test(v)) {
    if (ctx === 'nav') return { code: 'scheme', ref: cut(v) }
    if (DATA_IMAGE.test(v) || DATA_SVG.test(v)) return ctx === 'font' ? { code: 'fontUrl', ref: cut(v) } : null
    return { code: 'external', ref: cut(v) }
  }
  if (v.includes('\\')) return { code: 'backslash', ref: cut(v) }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return { code: ctx === 'nav' ? 'externalLink' : 'external', ref: cut(v) }
  if (v.startsWith('/')) return { code: 'absolute', ref: cut(v) }
  if (ctx === 'font') return { code: 'fontUrl', ref: cut(v) }
  let p = v.replace(/[?#].*$/, '')
  if (!p) return null
  try { p = decodeURIComponent(p) } catch { return { code: 'outside', ref: cut(v) } }
  if (p.includes('\\') || /[\x00-\x1f]/.test(p)) return { code: 'backslash', ref: cut(v) }
  const full = posixJoin(dir, p)
  if (full === null) return { code: 'outside', ref: cut(v) }
  if (files && !files.has(full.toLowerCase())) return { code: 'missing', ref: cut(v) }
  return null
}

/** srcset：「地址 描述, 地址 描述」 */
function srcsetUrls(v) {
  const out = []
  const s = String(v)
  let i = 0
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++
    let j = i
    while (j < s.length && !/\s/.test(s[j])) j++
    let url = s.slice(i, j)
    if (url.endsWith(',')) url = url.replace(/,+$/, '')
    else {
      // 描述到下一个逗号（括号里的逗号不算）
      let depth = 0
      while (j < s.length && !(s[j] === ',' && depth === 0)) { if (s[j] === '(') depth++; if (s[j] === ')') depth--; j++ }
    }
    if (url) out.push(url)
    i = j + 1
  }
  return out
}

// ── 图片 ──────────────────────────────────────────────────────────────────────

const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n))

/** 看文件头：真实格式和宽高（认不出 → null） */
export function imageInfo(b) {
  if (!b || b.length < 12) return null
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return b.length >= 24 ? { type: 'png', w: u32(b, 16), h: u32(b, 20) } : null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue }
      const m = b[o + 1]
      if (m === 0xff) { o++; continue }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue }
      const len = (b[o + 2] << 8) + b[o + 3]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpg', h: (b[o + 5] << 8) + b[o + 6], w: (b[o + 7] << 8) + b[o + 8] }
      o += 2 + len
    }
    return { type: 'jpg', w: 0, h: 0 }
  }
  if (ascii(b, 0, 4) === 'GIF8') return { type: 'gif', w: b[6] + (b[7] << 8), h: b[8] + (b[9] << 8) }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const k = ascii(b, 12, 4)
    if (k === 'VP8 ' && b.length >= 30) return { type: 'webp', w: (b[26] + (b[27] << 8)) & 0x3fff, h: (b[28] + (b[29] << 8)) & 0x3fff }
    if (k === 'VP8L' && b.length >= 25) { const x = b[21] + (b[22] << 8) + (b[23] << 16) + (b[24] << 24 >>> 0); return { type: 'webp', w: (x & 0x3fff) + 1, h: ((x >>> 14) & 0x3fff) + 1 } }
    if (k === 'VP8X' && b.length >= 30) return { type: 'webp', w: 1 + b[24] + (b[25] << 8) + (b[26] << 16), h: 1 + b[27] + (b[28] << 8) + (b[29] << 16) }
    return { type: 'webp', w: 0, h: 0 }
  }
  if (ascii(b, 4, 4) === 'ftyp' && /^avi[fs]$/.test(ascii(b, 8, 4))) {
    for (let o = 12; o + 20 < b.length && o < 4096; o++) {
      if (b[o] === 0x69 && ascii(b, o, 4) === 'ispe') return { type: 'avif', w: u32(b, o + 8), h: u32(b, o + 12) }
    }
    return { type: 'avif', w: 0, h: 0 }
  }
  return null
}

const le32 = (b, o) => (b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0))
function hasAscii(b, str) {
  const n = str.length
  outer: for (let i = 0; i + n <= b.length; i++) {
    for (let j = 0; j < n; j++) if (b[i + j] !== str.charCodeAt(j)) continue outer
    return true
  }
  return false
}
/** GIF 里有注释块、XMP 块吗 */
function gifMeta(b) {
  let i = 13
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1))
  const skipSub = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i++ }
  while (i < b.length) {
    const t = b[i]
    if (t === 0x3b) return false
    if (t === 0x21) {
      const label = b[i + 1]
      if (label === 0xfe) return true
      if (label === 0xff && b[i + 2] === 11 && ascii(b, i + 3, 8) === 'XMP Data') return true
      i += 2
      skipSub()
    } else if (t === 0x2c) {
      const packed = b[i + 9]
      i += 10
      if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1))
      i++ // LZW 最小码长
      skipSub()
    } else return true // 看不懂：当它有（让人换个格式）
  }
  return false
}
/**
 * 图片里还带着拍摄信息 / 文字块吗（EXIF、GPS、XMP、注释）。分享、投稿前要去掉（插件打包时会自动去 JPG / PNG / WebP / GIF 的）
 * 看不懂的结构当「有」
 */
export function imageMeta(b, type) {
  try {
    if (type === 'jpg' || type === 'jpeg') {
      let i = 2
      while (i + 4 <= b.length) {
        if (b[i] !== 0xff) return true
        const mk = b[i + 1]
        if (mk === 0xda) return false
        if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) { i += 2; continue }
        if (mk === 0xe1 || mk === 0xed || mk === 0xfe) return true
        i += 2 + ((b[i + 2] << 8) + b[i + 3])
      }
      return false
    }
    if (type === 'png') {
      let i = 8
      while (i + 12 <= b.length) {
        const t = ascii(b, i + 4, 4)
        if (['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(t)) return true
        if (t === 'IEND') return false
        i += 12 + u32(b, i)
      }
      return false
    }
    if (type === 'webp') {
      let i = 12
      while (i + 8 <= b.length) {
        const t = ascii(b, i, 4)
        if (t === 'EXIF' || t === 'XMP ') return true
        const len = le32(b, i + 4)
        i += 8 + len + (len & 1)
      }
      return false
    }
    if (type === 'gif') return gifMeta(b)
    if (type === 'avif') return hasAscii(b, 'Exif') || hasAscii(b, 'xmpmeta') || hasAscii(b, 'ns.adobe.com/xap')
  } catch { return true }
  return false
}

/**
 * CSS 里的字符串和地址（照 CSS 规范分词，转义已还原：\64 ata: 就是 data:，u\72l( 就是 url(）。不封顶。
 * → [{ v, url }]：url 是 true 的是「一个确切的地址」（url(…) 记号、url / image-set 这些取地址的函数里的字符串）
 */
export function cssValues(text, toks = null) {
  const out = []
  const stack = []
  let prevStr = false // 上一个（不算空白、注释）记号是字符串：content: "139 " "1234" 在页面上是连着显示的
  for (const tk of toks || cssTokens(String(text || ''))) {
    if (tk.t === 'ws' || tk.t === 'comment') continue
    const isStr = (tk.t === 'str' || tk.t === 'bad-str') && typeof tk.v === 'string'
    if (tk.t === 'func') stack.push(String(tk.v || '').toLowerCase())
    else if (tk.t === '(') stack.push('')
    else if (tk.t === ')') stack.pop()
    else if (isStr) out.push({ v: tk.v, url: stack.some((f) => URL_FUNCS.has(f)), next: prevStr })
    else if ((tk.t === 'url' || tk.t === 'bad-url') && typeof tk.v === 'string') out.push({ v: tk.v, url: true })
    prevStr = isStr
  }
  return out
}

/** CSS 里的字符串（默认不要地址：那不是给人看的字）；urls：地址也要。紧挨着的几个字符串（content: "139 " "1234"）拼成一个，中间留看不见的分界 \u200b */
export function cssStrings(text, { urls = false } = {}) {
  const out = []
  let kept = false
  for (const x of cssValues(text)) {
    if (!urls && x.url) { kept = false; continue }
    if (x.next && kept) out[out.length - 1] += `\u200b${x.v}`
    else out.push(x.v)
    kept = true
  }
  return out
}

/** 一个 data: 网址按浏览器的做法解开（去 Tab/换行 → 百分号解码 → 写了 ;base64 再去空白解 base64）→ { mime, buf } | null */
export function parseDataUrl(v) {
  // 网址里的 Tab、换行先全部去掉（「da\nta:」「image/p\nng」这种浏览器照样认）
  // 地址里第一个 # 起是片段（#icon、#svgView(…)），不是内容；内容里的 # 要写成 %23
  const m = /^[\f ]*data:([^,#]*),([^#]*)/i.exec(String(v).replace(/[\t\n\r]+/g, ''))
  if (!m) return null
  const buf = /;[ ]*base64[ ]*$/i.test(m[1]) ? Buffer.from(pctBytes(m[2]).toString('latin1').replace(/[\t\n\f\r ]+/g, ''), 'base64') : pctBytes(m[2])
  return { mime: m[1].split(';')[0].trim().toLowerCase(), params: m[1], buf }
}

/** data: 网址 → 是位图就 { type（按字节认，不看写的类型）, buf }，不然 null */
export function parseDataImage(v) {
  const d = parseDataUrl(v)
  if (!d) return null
  const info = imageInfo(d.buf)
  return info ? { type: info.type, buf: d.buf } : null
}

/** 解出来的是不是 SVG（写的类型是 svg，或者内容开头就是 <svg） */
function isSvgData(d) {
  return d.mime === 'image/svg+xml' || /^\s*(?:<\?xml[^>]*>\s*)?(?:(?:<!--[\s\S]*?-->|<!doctype[^>]*>)\s*)*<svg[\s>/]/i.test(d.buf.subarray(0, 8192).toString('utf8'))
}

/**
 * 内嵌 SVG 的字：只认 UTF-8。开头是 UTF-16 的 BOM、data: 网址写了别的 charset、<?xml encoding> 写了别的编码、
 * 不是合法 UTF-8 → null（浏览器会按别的编码读，我们查不准，拦下来）
 */
export function svgText(buf, params = '') {
  let b = buf
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3)
  else if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0xff && b[1] === 0xfe)) return null
  else {
    const cs = /;\s*charset\s*=\s*"?([^;"]*)/i.exec(params || '')
    if (cs && !/^\s*utf-?8\s*$/i.test(cs[1])) return null
  }
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null }
  if (text.includes('\0')) return null
  const decl = /^\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i.exec(text)
  if (decl && !/^\s*utf-?8\s*$/i.test(decl[1])) return null
  return text
}

/** 百分号解码成字节（%XX 按字节，其余按 UTF-8） */
export function pctBytes(s) {
  const raw = Buffer.from(String(s), 'utf8')
  const out = Buffer.alloc(raw.length)
  let n = 0
  const hex = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1)
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x25 && i + 2 < raw.length && hex(raw[i + 1]) >= 0 && hex(raw[i + 2]) >= 0) { out[n++] = hex(raw[i + 1]) * 16 + hex(raw[i + 2]); i += 2 } else out[n++] = raw[i]
  }
  return out.subarray(0, n)
}

export const INLINE_MAX = 2000

/** 字节看着像 SVG（UTF-8，或 UTF-16 两种字节序） */
function looksSvg(buf) {
  const head = buf.subarray(0, 8192)
  const re = /<svg[\s>/]/i
  if (re.test(head.toString('utf8')) || re.test(head.toString('utf16le'))) return true
  const be = Buffer.from(head.subarray(0, head.length - (head.length % 2)))
  return re.test(be.swap16().toString('utf16le'))
}

/**
 * 一段（已解码的）值里的 data: 网址 → 往 st 里加
 *   exact：值本身就是一个地址（src / href / srcset 拆开的每一项、CSS 的 url(…) 和取地址函数里的字符串）：照浏览器的读法解，
 *          解出来是 SVG 但不是 UTF-8、写的是图片但认不出 → 记下来要拦
 *   loose：在一段字里搜（别的属性、注释、原文兜底）：边界不确定，先取到第一个引号 / 括号 / 尖括号，不行再取到逗号后的第一个空白
 *          （srcset 的「1x」不算进去）；都解不出图片 / SVG 的不算（不是浏览器会显示的东西），但看着是 SVG、又不是 UTF-8 的照样拦
 * 同一份内容只记一次；超过 INLINE_MAX 份记 more（不能当查完了）
 */
function dataUrlsIn(v, at, st, mode = 'loose') {
  const s = String(v).replace(/[\t\n\r]+/g, '')
  const starts = mode === 'exact' ? (/^[\f ]*data:/i.test(s) ? [0] : []) : [...s.matchAll(/data:/gi)].map((m) => m.index)
  for (const k of starts) {
    let cands
    if (mode === 'exact') cands = [s.slice(k, k + 16 * 1024 * 1024)]
    else {
      let rest = s.slice(k)
      const e = rest.search(/["'()<>]|&quot;|&#0*39;|&apos;/i)
      if (e > 0) rest = rest.slice(0, e)
      cands = [rest]
      const comma = rest.indexOf(',')
      const ws = comma >= 0 ? rest.slice(comma).search(/[\f ]/) : -1
      if (ws > 0) cands.push(rest.slice(0, comma + ws))
    }
    let pick = null
    let fallback = null
    for (const c of cands) {
      const d = parseDataUrl(c)
      if (!d || !d.buf.length) continue
      const info = imageInfo(d.buf)
      if (info) { pick = { d, item: { kind: 'image', type: info.type } }; break }
      if (mode === 'exact' ? isSvgData(d) : looksSvg(d.buf)) {
        const text = svgText(d.buf, d.params)
        if (text !== null) { pick = { d, item: { kind: 'svg', text } }; break }
        fallback = fallback || { d, item: { kind: 'svg', text: null } }
      } else if (mode === 'exact' && /^image\//.test(d.mime)) fallback = fallback || { d, item: { kind: 'bad', mime: d.mime } }
    }
    pick = pick || fallback
    if (!pick) continue
    const key = crypto.createHash('sha1').update(pick.d.mime).update('\0').update(pick.d.buf).digest('hex')
    if (st.seen.has(key)) {
      // 同一份内容先被兜底搜到、后来又在确切地址里出现：按确切地址的规矩查（和出现的先后无关）
      const was = st.seen.get(key)
      if (was && was.loose && mode === 'exact') { was.loose = false; was.at = at }
      continue
    }
    if (st.seen.size >= INLINE_MAX) { st.more = true; return }
    let rec = null
    if (pick.item.kind === 'image') st.images.push({ type: pick.item.type, buf: pick.d.buf, at })
    else if (pick.item.kind === 'svg') st.svgs.push((rec = { text: pick.item.text, at, loose: mode !== 'exact' }))
    else st.bad.push({ mime: pick.item.mime, at }) // 写的是图片、内容认不出：藏着别的东西也查不了
    st.seen.set(key, rec)
  }
}

/**
 * 网页 / 矢量图里的 CSS：<style> 的内容、style="…" 属性（实体已解码）→ [{ text, at }]（查注释、引号里的字用）。
 * 只按默认读法：另一种读法会把 <svg> 里 <style/> 后面的东西都当样式，误报；手机号 / 身份证 / 邮箱另外整份文件查（personalAll）
 */
export function htmlCss(src) {
  const out = []
  for (const t of tokenize(String(src || ''))) {
    if (t.type === 'text' && t.raw === 'style') out.push({ text: t.text, at: t.start })
    else if (t.type === 'tag') for (const a of t.tag.attrs) if (a.name === 'style' && a.value) out.push({ text: a.value, at: a.vStart })
  }
  return out
}

/**
 * 网页 / 样式 / 矢量图里内嵌的东西（任何 data: 网址）→ { images: [{ type, buf, at }], svgs: [{ text, at }], bad: [{ mime, at }], more }
 *   images：解出来的字节是位图（不看写的类型）；分享、投稿前要查拍摄信息
 *   svgs：内嵌的 SVG（写成 base64 或百分号也一样），里面的字、<metadata>、本机路径也会跟着发出去，要和单独的 .svg 一样查；
 *         text 是 null：不是 UTF-8（查不准，要拦）
 *   bad：写的是图片、内容认不出（要拦）
 *   more：太多了没查完（要拦）
 * 不管在哪（<svg><title> 里、注释里、别的标签的属性值里）：每个「<字母」都当标签读（和 checkMarkup 第一步一样），
 * 地址属性（src、href、srcset 拆开的每一项…）按一个确切的地址解；会当 CSS 读的属性（style、fill、mask… 带 url( 的）和
 * 每个 <style> 到下一个 </style> 之间（再按实体还原一遍）照 CSS 规范分词还原转义；别的属性和原文再搜一遍（兜底）。都不封顶
 */
export function inlineData(text, kind = '') {
  const src = String(text || '')
  const st = { images: [], svgs: [], bad: [], more: false, seen: new Map(), work: 0 }
  const hasData = (v) => /data:/i.test(String(v).replace(/[\t\n\r]+/g, ''))
  const exactUrl = (v, at) => {
    const t = String(v).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
    if (/^data:/i.test(t.replace(/[\t\n\r]+/g, ''))) dataUrlsIn(t, at, st, 'exact')
    else if (hasData(t)) dataUrlsIn(t, at, st, 'loose')
  }
  // 一共最多按 CSS 读这么多字（一堆 <style/> 每个都读到下一个 </style> 会重复读）：超了算没查完（要拦）
  const budget = 8 * src.length + 65536
  const fromCss = (css, at, toks = null) => {
    st.work += css.length
    if (st.work > budget) { st.more = true; return }
    for (const x of cssValues(css, toks)) {
      if (!hasData(x.v)) continue
      if (x.url) exactUrl(x.v, at)
      else dataUrlsIn(x.v, at, st, 'loose')
      if (st.more) return
    }
  }
  const cssLike = (a) => a.name === 'style' || PRES_ATTRS.has(a.name) || /url\s*\(/i.test(a.value) || (a.value.includes('\\') && a.value.includes('('))
  if (kind === 'html' || kind === 'svg') {
    const decOf = (x) => decodeEntities(x.replace(/<!\[CDATA\[|\]\]>/g, '')).text
    // 终点相同的一组 <style> 区段（一堆 <style/> 都读到同一个 </style>）：原文、实体还原后各一份，每段从自己的起点往后按 CSS 分词。
    // 读到以前某段在同一位置、同样括号状态下的记号起点就停——分词只往后看，后面读出来和那段一模一样（也不重复记工作量）
    let g = null
    // 括号栈：同样的栈拿同一个编号（编号 0 是空栈），每次进出只花一步，不用每个记号都抄一遍整栈
    const ids = new Map()
    const parent = [0]
    const urlsOf = [0]
    const push = (id, f) => {
      const key = `${id}\u0000${f}`
      let n = ids.get(key)
      if (n === undefined) { n = parent.length; ids.set(key, n); parent.push(id); urlsOf.push(urlsOf[id] + (URL_FUNCS.has(f) ? 1 : 0)) }
      return n
    }
    const cssScan = (text, from, seen, at) => {
      let id = 0
      let k = 0
      let end = text.length
      const take = (out) => {
        for (; k < out.length; k++) {
          const tk = out[k]
          const urls = urlsOf[id]
          if (tk.t === 'func') id = push(id, String(tk.v || '').toLowerCase())
          else if (tk.t === '(') id = push(id, '')
          else if (tk.t === ')') id = parent[id]
          else if ((tk.t === 'str' || tk.t === 'bad-str' || tk.t === 'url' || tk.t === 'bad-url') && typeof tk.v === 'string' && hasData(tk.v)) {
            if (tk.t === 'url' || tk.t === 'bad-url' || urls > 0) exactUrl(tk.v, at)
            else dataUrlsIn(tk.v, at, st, 'loose')
          }
        }
      }
      const out = cssTokens(text, {
        from,
        stop: (i, out) => {
          take(out)
          if (st.more) { end = i; return true }
          if (st.work + (i - from) > budget) { st.more = true; end = i; return true }
          // 括号里没有 url() 这类：状态都算一样（以后读到的字是不是地址只看新进去的括号）；有的话整个括号栈要一样
          const sig = urlsOf[id] ? id : 0
          const had = seen.get(i)
          if (had === sig || (had instanceof Set && had.has(sig))) { end = i; return true }
          if (had === undefined) seen.set(i, sig)
          else if (had instanceof Set) had.add(sig)
          else seen.set(i, new Set([had, sig]))
          return false
        },
      })
      take(out)
      st.work += end - from
    }
    for (const t of scanTags(src)) {
      for (const a of t.attrs) {
        if (!a.value) continue
        if (cssLike(a)) fromCss(a.value, a.vStart)
        if (a.name === 'style' || !hasData(a.value)) continue
        if (a.name === 'srcset' || a.name === 'imagesrcset') for (const u of srcsetUrls(a.value)) exactUrl(u, a.vStart)
        else if (URL_ATTRS.has(a.name)) exactUrl(a.value, a.vStart)
        else dataUrlsIn(a.value, a.vStart, st, 'loose')
        if (st.more) break
      }
      // <style/> 在网页里斜杠不算（照样是样式），一样查；矢量图（XML）里就是空的。到下一个真正的 </style 为止（CDATA 里的不算）
      if (t.name === 'style' && !t.eof && !st.more && !(kind === 'svg' && t.selfClosing)) {
        const s0 = t.close
        const e0 = rawEnd(src, 'style', s0, true)
        // 新的一组：终点变了；起点没往后走（标签按 < 的位置排，不按 > 的位置：前面一个假标签的 > 可能在后面）；
        // 或者起点前面是「]]>」（去掉 CDATA 标记后 > 也没了，实体还原后的位置不能接着算）
        if (!g || g.e !== e0 || s0 <= g.at || src.startsWith(']]>', s0 - 3)) {
          const raw = src.slice(s0, e0)
          const dec = decOf(raw)
          st.work += raw.length
          g = { e: e0, base: s0, raw, dec: dec === raw ? null : dec, rawSeen: new Map(), decSeen: new Map(), at: s0, decLen: 0 }
        } else {
          // 实体还原后这段从哪起：一小截一小截往后加（起点都在某个标签的 > 后面，实体、CDATA 标记跨不过去）
          if (g.dec !== null) {
            const part = src.slice(g.at, s0)
            st.work += part.length
            g.decLen += decOf(part).length
          }
          g.at = s0
        }
        if (st.work > budget) st.more = true
        else {
          cssScan(g.raw, s0 - g.base, g.rawSeen, s0)
          if (g.dec !== null && !st.more) cssScan(g.dec, g.decLen, g.decSeen, s0)
        }
      }
      if (st.more) break
    }
  } else if (kind === 'css') fromCss(src, 0)
  if (!st.more) dataUrlsIn(src, 0, st, 'loose')
  return { images: st.images, svgs: st.svgs, bad: st.bad, more: st.more }
}

/** 兼容：只要内嵌的位图 */
export function inlineImages(text, kind = '') {
  return inlineData(text, kind).images
}

// ── 文字 ──────────────────────────────────────────────────────────────────────

/** 本机路径（/Users/名字/、/home/名字/、C:\Users\名字、file:///）：带着就把电脑用户名带出去了 */
const LOCAL_PATH = /(?<![\w:/.%-])\/(?:Users|home)\/[^\s"'<>/\\]{1,64}\/|(?<![\w])[A-Za-z]:(?:\\{1,2}|\/)(?:Users|Documents and Settings)(?:\\{1,2}|\/)[^\s"'<>/\\]{1,64}|file:\/\/\//i
export function localPathIn(text) {
  const m = LOCAL_PATH.exec(String(text || ''))
  return m ? { n: m[0], at: m.index } : null
}

function asText(data) {
  if (typeof data === 'string') return { text: data.replace(/^﻿/, '') }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '') }
  } catch {
    return { text: null }
  }
}

/** CSS 转义还原（整段粗还原，查个人信息用）：\ + 换行去掉，\31 这种十六进制，\x 就是 x */
function cssUnescape(v) {
  return String(v).replace(/\\\r?\n/g, '').replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '' }).replace(/\\([\s\S])/g, '$1')
}

/** 数字很多的属性（路径、坐标、变换）：整份文件查个人信息时先空掉，免得坐标凑出像手机号的数 */
const NUMERIC_ATTRS = new Set(['d', 'points', 'viewbox', 'transform', 'gradienttransform', 'patterntransform', 'values', 'keytimes', 'keysplines', 'keypoints', 'coords', 'path', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'width', 'height', 'offset', 'stroke-dasharray', 'kernelmatrix', 'tablevalues', 'rotate', 'stddeviation', 'basefrequency'])

/**
 * 整份文件里的手机号 / 身份证 / 邮箱：不管浏览器显不显示（<svg>、<math> 里怎么切换读法都一样），都会跟着包发出去。
 * 按原文、实体还原、CSS 转义还原各查一遍；数字很多的属性值先空掉 → [{ code, n }]
 */
export function personalAll(src) {
  const s = String(src || '')
  let t = s
  if (/<[a-z]/i.test(s)) {
    const parts = []
    let last = 0
    const spans = []
    for (const tag of scanTags(s)) for (const a of tag.attrs) if (NUMERIC_ATTRS.has(a.name) && a.vEnd > a.vStart) spans.push([a.vStart, a.vEnd])
    spans.sort((a, b) => a[0] - b[0])
    for (const [a, b] of spans) { if (a < last) continue; parts.push(s.slice(last, a), ' '); last = b }
    parts.push(s.slice(last))
    t = parts.join('')
  }
  const out = []
  const seen = new Map()
  const dec = decodeEntities(t).text
  for (const v of new Set([t, dec, cssUnescape(dec)])) {
    for (const p of textFlags(v, { urls: false, throughTags: true })) {
      if (p.code !== 'phone' && p.code !== 'idcard' && p.code !== 'email') continue
      const k = `${p.code}|${p.n}`
      const was = seen.get(k)
      if (!was) { const x = { code: p.code, n: p.n, ...(p.maybe ? { maybe: true } : {}) }; seen.set(k, x); out.push(x) } else if (!p.maybe) delete was.maybe
    }
  }
  return out
}

const PSEP = '[\\s\\u200b-\\u200d\\u2060\\-\\u2010-\\u2015\\u2043\\u2212\\u2e3a\\u2e3b\\u30fc\\ufe58\\ufe63\\uff0d\\uff65\\u00b7\\u30fb]{0,3}'
// 不相干的几段字拼起来查时用的隔开符（不算号码里的分隔：不同地方的 139 / 1234 / 7788 不拼成手机号）
const PART_SEP = '\n\u0001\n'
// 号码本身（前后边界另外判断，见 numbersIn）
const PHONE_CORE = new RegExp(`(?:\\+?86${PSEP})?1[3-9]\\d${PSEP}\\d{4}${PSEP}\\d{4}`, 'g')
const IDCARD_CORE = /\d{17}[\dXx]/g
// Markdown：号码中间夹的加粗 / 斜体记号（139**1234**7788）页面上看不见，也当分隔
const PHONE_CORE_MD = new RegExp(PHONE_CORE.source.replaceAll('\\u00b7', '\\u00b7*_'), 'g')

/**
 * 在 joined 里找号码（re 是不带边界的号码正则）：前后紧挨字母数字、* + 的不算（类名、哈希、更长的数）；
 * 前面紧挨的「.」：前面是字母（Tel.、No.）照样算，前面是数字、标点或开头（0.139…、:.139…）是小数，不算；后面「.数字」也是小数。
 * soft：看不见的分界的位置（行内标签、相邻 CSS 字符串那里）——号码中间的分界本来就去掉了（139<mark>123</mark>47788 照样连着），
 * 号码紧挨字母但中间有分界（<span>Tel</span><span>139…</span>）不算紧挨；紧挨数字、小数点照样不算号码（0.<b>139</b>12347788）
 */
const MAYBE = 2
// 个人信息类的提醒（排前面、不受条数限制）
export const PERSONAL_CODES = new Set(['phone', 'idcard', 'email', 'localPath', 'address'])
function numbersIn(joined, soft, re, throughTags = false, md = false) {
  const out = []
  const letter = /\p{L}/u
  const TAG_END = /<\/?[A-Za-z][^<>]*>$/
  const TAG_START = /^<\/?[A-Za-z][^<>]*>/
  // throughTags（整份原文扫的时候）：紧挨着的是标签，就越过标签看页面上真正挨着的字——
  // 0.<b>13912347788</b> 在页面上是小数，不算（看得见的字另外按页面上的样子查过）
  const prevAt = (i) => {
    if (!throughTags) return i
    for (let g = 0; g < 64 && joined[i - 1] === '>'; g++) {
      const k = joined.lastIndexOf('<', i - 1)
      if (k < 0 || !TAG_END.test(joined.slice(k, i))) break
      i = k
    }
    return i
  }
  const nextAt = (j) => {
    if (!throughTags) return j
    for (let g = 0; g < 64 && joined[j] === '<'; g++) {
      const k = joined.indexOf('>', j)
      if (k < 0 || !TAG_START.test(joined.slice(j, k + 1))) break
      j = k + 1
    }
    return j
  }
  // md（Markdown）：紧挨的一串 * / _ 越过去看外面的字——外面是数字（接着别的数）、或 _ 外面是英文字母数字（order_139…_v2 这种标识符）才不算
  const ASCII_AN = /[A-Za-z0-9]/
  const mdBefore = (i) => {
    let k = i
    while (k > 0 && (joined[k - 1] === '*' || joined[k - 1] === '_')) k--
    if (k === i) return null
    const c = joined[k - 1]
    if (c === undefined) return true
    if (/[0-9]/.test(c)) return false
    if (joined.slice(k, i).includes('_') && ASCII_AN.test(c)) return false
    if (c === '.') return k >= 2 && letter.test(joined[k - 2])
    return true
  }
  const mdAfter = (j) => {
    let k = j
    while (k < joined.length && (joined[k] === '*' || joined[k] === '_')) k++
    if (k === j) return null
    const c = joined[k]
    if (c === undefined) return true
    if (/[0-9]/.test(c)) return false
    if (joined.slice(j, k).includes('_') && ASCII_AN.test(c)) return false
    if (c === '.') return !/[0-9]/.test(joined[k + 1] || '')
    return true
  }
  const before = (i0) => {
    if (md) { const r = mdBefore(i0); if (r !== null) return r }
    const i = prevAt(i0)
    if (i === 0) return true
    const b = joined[i - 1]
    if (b === '.') return i >= 2 && letter.test(joined[i - 2])
    if (i !== i0) return !/[0-9]/.test(b) // 越过了标签：只看是不是接着前面的数
    // 紧挨数字：中间有分界只算「拿不准」（两栏并排的 <b>139</b>12347788 / <b>186</b>23456791 是两个号码；
    // 订单号 20261107<mark>139</mark>12347788 是一个长编号）——提醒，不硬拦
    if (/[0-9]/.test(b)) return soft.has(i) ? MAYBE : false
    if (/[*+]/.test(b)) return false
    return soft.has(i) || !/\w/.test(b)
  }
  const after = (j0) => {
    if (md) { const r = mdAfter(j0); if (r !== null) return r }
    const j = nextAt(j0)
    const c = joined[j]
    if (c === undefined) return true
    if (c === '.') return !/[0-9]/.test(joined[j + 1] || '')
    if (j !== j0) return !/[0-9]/.test(c)
    if (/[0-9]/.test(c)) return soft.has(j) ? MAYBE : false
    if (c === '*') return false
    return soft.has(j) || !/\w/.test(c)
  }
  re.lastIndex = 0
  let m
  while ((m = re.exec(joined))) {
    const e = m.index + m[0].length
    const a = before(m.index)
    const b = a && after(e)
    if (b) { if (a === MAYBE || b === MAYBE) m.maybe = true; out.push(m); re.lastIndex = e } else re.lastIndex = m.index + 1
  }
  return out
}

/** 邮箱：从每个 @ 往两边找（不用整段正则回溯，长编码串里也是线性的）；域名一段一段读，遇到「..」这类就停在前面 → [{ n, at }] */
// 打码用的记号
const MASK = /[*•●∗⁎◦]/
const PUNCT = /[\p{P}\p{S}]/u
// s[m..] 这串记号是不是前面加粗 / 斜体的收尾（**Email**zhang@…、**邮箱**zhang@…）：前面不是空白，
// 同一行往前 300 字里，一模一样、单出来的几串从左往右配对（能开头的开、能收尾的收），最后还有一串开着没收，
// 而且从那里到这儿没有 @。已经收过的（**Email**zh**san@ 里 Email 后面那串）不会再被当成开头；
// 前面没有开着的、后面紧接着邮箱前半段的（zh**san@、**an@ 里那串，是打码）不当开头
// 只往前看 300 字：长行里很多个也不慢
const MASKED_LOCAL = /[\w.+-]{0,64}@/y
function closesEmphasis(s, m, run) {
  if (m === 0 || /\s/.test(s[m - 1]) || !/^\*+$/.test(run)) return false // 加粗 / 斜体只认星号（• 这些不是）
  let from = Math.max(0, m - 300)
  let w = s.slice(from, m) // 只在这一小段里找（整串往回找，长行里会很慢）
  const nl = w.lastIndexOf('\n')
  if (nl >= 0) { from += nl + 1; w = w.slice(nl + 1) }
  const blank = (c) => c === undefined || /\s/.test(c)
  const punct = (c) => c !== undefined && PUNCT.test(c)
  let open = -1
  for (let k = w.indexOf(run); k >= 0; k = w.indexOf(run, k + 1)) {
    const p = from + k
    const q = p + run.length
    k += run.length - 1 // k 是小段里的位置（不是整串里的）
    if (q > m || s[p - 1] === '*' || s[q] === '*') continue // 不是单出来的同样一串星号（**•••89@ 里的 ** 照算）
    const prev = s[p - 1]
    const next = s[q]
    const canOpen = !blank(next) && (!punct(next) || blank(prev) || punct(prev))
    const canClose = !blank(prev) && (!punct(prev) || blank(next) || punct(next))
    if (open >= 0 && canClose) { open = -1; continue } // 前面有开着的：先当收尾（**Email**li@… 里 Email 后面那串）
    // 没有开着的、后面紧接着邮箱前半段再到 @（zh**san@、**an@）：是打码，不当开头；
    // 但邮箱后面又跟着一模一样的一串（**wang@qq.com**）是对称包着的加粗，照常当开头
    MASKED_LOCAL.lastIndex = q
    if (MASKED_LOCAL.test(s)) {
      let d = MASKED_LOCAL.lastIndex
      const at = d - 1
      while (d < s.length && d - at <= 255 && /[\w.-]/.test(s[d])) d++
      if (!s.startsWith(run, d) || s[d + run.length] === '*') continue
    }
    if (canOpen) open = q
  }
  return open >= 0 && !s.slice(open, m).includes('@')
}
function emailsIn(s) {
  const out = []
  const local = /[\w.+-]/
  const lab = /[\w-]/
  for (let i = s.indexOf('@'); i >= 0; i = s.indexOf('@', i + 1)) {
    let a = i
    while (a > 0 && i - a < 64 && local.test(s[a - 1])) a--
    // 前半段前面是打码记号（zh***san@、12****89@、•••89@）：是打了码的邮箱，不是 san@ / 89@。
    // 只有一个记号、前面又不是邮箱的字（•zhang@…、* zhang@… 这种项目符号）不算打码
    // 前后对称包着的（**zhang@qq.com**）是装饰，不是打码
    // 这串记号是前面加粗的收尾（**Email**zhang@…）：邮箱是完整露出来的，但拿不准 → 提醒
    let pre = ''
    let closes = false
    if (a > 0 && MASK.test(s[a - 1])) {
      let m = a - 1
      while (m > 0 && m > a - 64 && MASK.test(s[m - 1])) m--
      closes = closesEmphasis(s, m, s.slice(m, a))
      if (!closes) {
        if (m > 0 && local.test(s[m - 1])) continue
        if (a - m >= 2) pre = s.slice(m, a)
      }
    }
    while (a < i && s[a] === '.') a++
    if (a >= i) continue
    let b = i + 1
    const label = () => { const st = b; while (b < s.length && b - i <= 255 && lab.test(s[b])) b++; return b > st }
    if (!label()) continue
    let dots = 0
    while (b < s.length && b - i <= 255 && s[b] === '.' && lab.test(s[b + 1] || '')) { b++; label(); dots++ }
    // 域名里打了码（zhang@qq.c**、zhang@q*q.com）：后面连着两个以上记号，或者记号后面还接着域名的字；只有一个记号（尾注 zhang@qq.com*）不算
    let maybe = closes
    if (pre && !s.startsWith(pre, b)) continue
    if (!pre && MASK.test(s[b] || '')) {
      let m = b
      while (m < s.length && MASK.test(s[m])) m++
      if (/[\w.-]/.test(s[m] || '')) continue // 记号后面还接着域名的字（zhang@q**q.com）：打了码
      // 后面连着两个以上记号：域名看着完整（最后一段两个字母以上，zhang@qq.com**）可能是尾注，拿不准 → 提醒；不完整（zhang@qq.c**）是打码
      if (m - b >= 2) { if (/\.[A-Za-z]{2,}$/.test(s.slice(i + 1, b))) maybe = true; else continue }
    }
    const loc = s.slice(a, i).replace(/^_+/, '')
    const dom = s.slice(i + 1, b).replace(/[-_]+$/, '')
    if (dots && loc) out.push({ n: `${loc}@${dom}`, at: a, ...(maybe ? { maybe: true } : {}) })
  }
  return out
}

/** 身份证号校验位对不对、生日像不像 */
function idOk(s) {
  if (!/^[1-8]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(s)) return false
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * w[i]
  return '10X98765432'[sum % 11] === s[17].toUpperCase()
}

/** 明显是假的手机号：后八位全一样、连号，或常见的示例号 */
function fakePhone(d) {
  const tail = d.slice(3)
  if (/^(\d)\1{7}$/.test(tail)) return true
  if ('0123456789012'.includes(tail) || '9876543210987'.includes(tail)) return true
  return d === '13800138000' || d === '13912345678' || /^1\d{2}0000\d{4}$/.test(d)
}

/**
 * 一段文字里的个人信息和可疑字。返回 [{ code, n, at }]（at：在 text 里的位置）
 *   phone idcard email（个人邮箱） bizEmail address phish brand inject url
 */
export function textFlags(text, { urls = true, throughTags = false, md = false } = {}) {
  const out = []
  const s = String(text)
  // 手机号 / 身份证 / 邮箱：全角数字、全角横线、全角 @ 这些先换成半角再找（一个字换一个字，位置不变）。
  // 不用 NFKC：上标、圈码会被拼进前后的数字（订单号 1391234778¹ 不是手机号）
  // 手机号：3-4-4，中间可以夹空格（含不换行 / 全角 / 零宽）、各种横线；前面可带 +86。前后边界见 numbersIn
  const ns = s.replace(/[\uff01-\uff5e\ufe6b]/g, (c) => (c === '\ufe6b' ? '@' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
  // 看不见的分界（\u200b：行内标签、相邻的 CSS 字符串那里）先去掉、记下位置：号码、邮箱在页面上是连着的
  const pieces = ns.split('\u200b')
  const soft = new Set()
  for (let k = 0, pos = 0; k < pieces.length - 1; k++) { pos += pieces[k].length; soft.add(pos) }
  const joined = pieces.length > 1 ? pieces.join('') : ns
  for (const m of numbersIn(joined, soft, md ? PHONE_CORE_MD : PHONE_CORE, throughTags, md)) {
    let d = m[0].replace(/\D/g, '')
    if (d.length === 13 && d.startsWith('86')) d = d.slice(2)
    if (d.length === 11 && !fakePhone(d)) out.push({ code: 'phone', n: m[0], at: m.index, ...(m.maybe ? { maybe: true } : {}) })
  }
  for (const m of numbersIn(joined, soft, IDCARD_CORE, throughTags, md)) if (idOk(m[0])) out.push({ code: 'idcard', n: m[0], at: m.index, ...(m.maybe ? { maybe: true } : {}) })
  // Markdown：号码中间随便哪段加粗 / 斜体（139**123**47788、110105**19491231**002X），页面上是连着的。
  // 把夹在两个数字中间的 * / _ 去掉再查一遍；前后的边界照旧（2026**139…** 前面接着数字，还是不算）
  if (md && /\d[*_]+\d/.test(joined)) {
    const keep = []
    const digit = (c) => c >= '0' && c <= '9'
    for (let k = 0; k < joined.length; k++) {
      if ((joined[k] === '*' || joined[k] === '_') && k > 0 && digit(joined[k - 1])) {
        let e = k
        while (e < joined.length && (joined[e] === '*' || joined[e] === '_')) e++
        if (digit(joined[e])) { k = e - 1; continue }
      }
      keep.push(k)
    }
    const dj = keep.map((k) => joined[k]).join('')
    const back = (i) => (i < keep.length ? keep[i] : joined.length)
    const dsoft = new Set()
    for (let i = 0, k = 0; i <= keep.length; i++) { const at = back(i); while (k <= at) { if (soft.has(k)) dsoft.add(i); k++ } }
    const had = new Set(out.filter((p) => p.code === 'phone' || p.code === 'idcard').map((p) => p.n.replace(/[^\dXx]/g, '').slice(-11)))
    for (const m of numbersIn(dj, dsoft, PHONE_CORE, throughTags, md)) {
      let d = m[0].replace(/\D/g, '')
      if (d.length === 13 && d.startsWith('86')) d = d.slice(2)
      if (d.length === 11 && !fakePhone(d) && !had.has(d)) out.push({ code: 'phone', n: m[0], at: back(m.index), ...(m.maybe ? { maybe: true } : {}) })
    }
    for (const m of numbersIn(dj, dsoft, IDCARD_CORE, throughTags, md)) if (idOk(m[0]) && !had.has(m[0].slice(-11))) out.push({ code: 'idcard', n: m[0], at: back(m.index), ...(m.maybe ? { maybe: true } : {}) })
  }
  for (const m of emailsIn(joined)) {
    if (FAKE_MAIL.test(m.n)) continue
    out.push({ code: PERSONAL_MAIL.test(m.n) ? 'email' : 'bizEmail', n: m.n, at: m.at, ...(m.maybe ? { maybe: true } : {}) })
  }
  for (const m of s.matchAll(/[一-鿿]{2,30}(省|市|区|县)[一-鿿]{0,12}(路|街|道|巷|弄|大道)\d{1,5}号(\d{1,4}(室|栋|幢|单元|楼))?/g)) out.push({ code: 'address', n: m[0], at: m.index })
  const ph = PHISH.exec(s)
  if (ph) out.push({ code: 'phish', n: ph[0], at: ph.index })
  const br = BRANDS.exec(s)
  if (br) out.push({ code: 'brand', n: br[0], at: br.index })
  const inj = INJECT.exec(s)
  if (inj) out.push({ code: 'inject', n: cut(inj[0], 30), at: inj.index })
  if (urls) {
    const u = URLISH.exec(s)
    if (u) out.push({ code: 'url', n: cut(u[0], 40), at: u.index })
  }
  return out
}

// ── HTML ──────────────────────────────────────────────────────────────────────

/** 查 CSS 文字（样式表 / <style> / style=""），问题写进 add；base：这段 CSS 在文件里的起点（算行号） */
function checkCssText(css, { file, src, base, dir, files, add }) {
  const { refs, problems } = scanCss(css)
  const line = (at) => lineAt(src, base + at)
  for (const p of problems) {
    const code = p.code === 'import' ? 'cssImport' : p.code === 'func' ? 'cssFunc' : p.code === 'prop' ? 'cssProp' : 'cssBad'
    add({ code, x: file, line: line(p.at), n: p.detail || '' })
  }
  for (const r of refs) {
    const bad = checkRef(r.url, { dir, files, ctx: r.kind === 'font' ? 'font' : 'css' })
    if (bad) add({ code: bad.code === 'scheme' ? 'scheme' : bad.code, x: file, line: line(r.at), n: bad.code === 'scheme' ? 'url()' : bad.ref })
  }
}

/** 文件所在目录（包里的相对写法） */
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 查一个 HTML（或 SVG）文件的危险写法。
 * @param opts.files 包里所有文件（小写路径的 Set）；不给就不查「引用的文件在不在」
 * @param opts.svg   是独立的 SVG 文件
 * @returns [{ code, x, line, n }]
 */
export function checkMarkup(src, { file = 'index.html', files = null, svg = false } = {}) {
  const out = []
  const seen = new Set()
  const add = (p) => {
    const k = `${p.code}|${p.line}|${p.n}`
    if (seen.has(k) || out.length >= 200) return
    seen.add(k)
    out.push(p)
  }
  const dir = dirOf(file)
  const lineOf = (i) => lineAt(src, i)
  if (svg) {
    if (!/<svg[\s>]/i.test(src)) add({ code: 'notSvg', x: file, line: 1 })
    if (/<!doctype|<!entity|<!element|<!attlist/i.test(src) || /<\?(?!xml\s)/i.test(src) || (src.match(/<\?xml\s/gi) || []).length > 1) add({ code: 'svgDoctype', x: file, line: 1 })
    // 声明了别的编码：浏览器按那个编码读，和我们查的对不上
    const enc = /^\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i.exec(src)
    if (enc && !/^\s*utf-?8\s*$/i.test(enc[1])) add({ code: 'charset', x: file, line: 1 })
  }
  // 1) 每个「<字母」都当标签查（藏在注释、样式、属性值里的也算）
  for (const t of scanTags(src)) {
    const line = lineOf(t.start)
    if (t.eof && t.name) add({ code: 'eofTag', x: file, line, n: t.name })
    if (BAD_TAGS.has(t.name)) add({ code: 'tag', x: file, line, n: t.name })
    if (t.name === 'meta' && t.attrs.some((a) => a.name === 'http-equiv')) add({ code: 'httpEquiv', x: file, line })
    if (t.name === 'meta') {
      const cs = t.attrs.find((a) => a.name === 'charset')
      if (cs && !/^\s*utf-?8\s*$/i.test(cs.value)) add({ code: 'charset', x: file, line })
    }
    if (t.name === 'link') {
      const rel = (t.attrs.find((a) => a.name === 'rel') || { value: '' }).value.toLowerCase().split(/\s+/).filter(Boolean)
      const bad = rel.find((r) => !LINK_RELS.has(r))
      if (bad || !rel.length) add({ code: 'linkRel', x: file, line, n: bad || '' })
    }
    if (SVG_ANIM.has(t.name)) {
      const target = (t.attrs.find((a) => a.name === 'attributename') || { value: '' }).value.trim().toLowerCase()
      if (/href$/.test(target) || target === 'src' || target === 'style' || target.startsWith('on')) add({ code: 'animHref', x: file, line })
    }
    const isNav = NAV_TAGS.has(t.name)
    for (const a of t.attrs) {
      const n = a.name
      if (/^on/.test(n.replace(/^[^a-z]+/, ''))) { add({ code: 'handler', x: file, line, n }); continue }
      if (n === 'srcdoc') { add({ code: 'srcdoc', x: file, line }); continue }
      if (n === 'http-equiv') continue
      const val = a.value
      const squash = val.replace(/[\x00-\x20]/g, '')
      if (BAD_SCHEME.test(squash) && !(DATA_SVG.test(squash) && !isNav && n !== 'href' && n !== 'xlink:href' && n !== 'data-href')) { add({ code: 'scheme', x: file, line, n }); continue }
      // 任何属性值里出现 javascript: 都不收（SVG 动画的 values / to 也会被当地址用）
      if (/(javascript|vbscript|livescript):/i.test(squash)) { add({ code: 'scheme', x: file, line, n }); continue }
      if (t.end) continue
      if (n === 'style' || PRES_ATTRS.has(n) || /url\s*\(/i.test(val) || (val.includes('\\') && val.includes('('))) {
        if (a.unknown.length) add({ code: 'badEscape', x: file, line, n })
        checkCssText(val, { file, src, base: a.vStart, dir, files, add: (p) => add({ ...p, line }) })
      }
      if (URL_ATTRS.has(n)) {
        if (a.unknown.length) { add({ code: 'badEscape', x: file, line, n }); continue }
        if (n === 'action' || n === 'formaction') { if (val.trim()) add({ code: 'form', x: file, line, n }); continue }
        const urls = n === 'srcset' || n === 'imagesrcset' ? srcsetUrls(val) : [val]
        const ctx = (isNav && (n === 'href' || n === 'xlink:href')) || n === 'data-href' ? 'nav' : 'res'
        for (const u of urls) {
          // <use href="#x"> 这种片段在 checkRef 里放行
          const bad = checkRef(u, { dir, files, ctx })
          if (!bad) continue
          // 链接到包里没有的页面：原型没连完整，不算危险（体检会报「跳到不存在的页面」）
          if (bad.code === 'missing' && ctx === 'nav') continue
          add({ code: bad.code, x: file, line, n: bad.code === 'scheme' ? n : bad.ref })
        }
      }
      if (n === 'ping') add({ code: 'ping', x: file, line })
    }
  }
  // 2) 照规范分词：<style> 里的 CSS（原文和还原转义后的都查：<svg> 里的 <style> 会还原转义）、注释。
  //    <style> 按网页读、认外来内容读各走一遍（浏览器在 <svg> / <math> 里会跳回网页读），重复的 add 会去掉；
  //    注释认外来内容读就够了（它只把 <style> 当纯文字，看到的注释最多）
  //    第二遍（按网页读）只在网页里走（矢量图是 XML，不会这么读），也不报「写坏的字符串」（那段多半根本不是样式）
  const second = svg ? [] : tokenize(src, { foreign: false }).filter((t) => t.type === 'text' && t.raw === 'style').map((t) => ({ ...t, second: true }))
  for (const tk of [...tokenize(src), ...second]) {
    if (tk.type === 'text' && tk.raw === 'style') {
      const base = tk.start
      const addCss = tk.second ? (p) => { if (p.code !== 'cssBad') add(p) } : add
      checkCssText(tk.text, { file, src, base, dir, files, add: addCss })
      const dec = decodeEntities(tk.text.replace(/<!\[CDATA\[|\]\]>/g, '')).text
      if (dec !== tk.text) checkCssText(dec, { file, src, base, dir, files, add: (p) => addCss({ ...p, line: lineOf(base) }) })
    } else if (tk.type === 'comment') add({ code: 'comment', x: file, line: lineOf(tk.start) })
    else if (tk.type === 'bogus' && !svg && /^<!/.test(tk.text) && !/^<!doctype/i.test(tk.text)) add({ code: 'comment', x: file, line: lineOf(tk.start) })
  }
  return out
}

/**
 * 能自动修的先修：删注释、站外链接改成 #、表单的提交地址 / 方法 / ping 删掉。
 * 返回 { text, changes: [{ code, x, line, n }] }（修了什么，列给作者看）
 */
export function normalizeHtml(src, { file = 'index.html' } = {}) {
  const edits = [] // [start, end, replacement]
  const changes = []
  for (const tk of tokenize(src)) {
    if (tk.type === 'comment' || (tk.type === 'bogus' && /^<!(?!doctype)/i.test(tk.text))) {
      edits.push([tk.start, tk.end, ''])
      changes.push({ code: 'comment', x: file, line: lineAt(src, tk.start) })
      continue
    }
    if (tk.type !== 'tag') continue
    const t = tk.tag
    for (const a of t.attrs) {
      if (DROP_ATTRS.has(a.name)) {
        edits.push([a.start, a.end, ''])
        changes.push({ code: a.name === 'ping' ? 'ping' : 'form', x: file, line: lineAt(src, a.start), n: a.name })
        continue
      }
      if ((NAV_TAGS.has(t.name) && (a.name === 'href' || a.name === 'xlink:href')) || a.name === 'data-href') {
        const bad = checkRef(a.value, { ctx: 'nav' })
        if (bad && (bad.code === 'externalLink' || bad.code === 'absolute')) {
          edits.push([a.vStart, a.vEnd, '#'])
          changes.push({ code: 'externalLink', x: file, line: lineAt(src, a.start), n: bad.ref })
        }
      }
    }
  }
  if (!edits.length) return { text: src, changes }
  edits.sort((a, b) => b[0] - a[0])
  let text = src
  let last = Infinity
  for (const [s, e, r] of edits) {
    if (e > last) continue // 重叠的跳过
    text = text.slice(0, s) + r + text.slice(e)
    last = s
  }
  return { text, changes }
}

/** <meta name="dsh-design"> 的类型（和 look.js parseMeta 一样） */
export function metaKind(src) {
  for (const t of scanTags(src.slice(0, 65536))) {
    if (t.name !== 'meta') continue
    const name = t.attrs.find((a) => a.name === 'name')
    if (!name || name.value.trim().toLowerCase() !== 'dsh-design') continue
    const content = (t.attrs.find((a) => a.name === 'content') || { value: '' }).value
    for (const w of content.toLowerCase().split(/[\s,;]+/)) {
      if (KINDS.includes(w)) return w
      if (META_ALIAS[w]) return META_ALIAS[w]
    }
    return ''
  }
  return null
}

/** <title> 的文字 */
export function titleOf(src) {
  for (const tk of tokenize(src)) if (tk.type === 'text' && tk.raw === 'title') return decodeEntities(tk.text).text.trim()
  return ''
}

// ── 清单 ──────────────────────────────────────────────────────────────────────

// shareHash：分享记号（只在作者电脑上）的 sha256 前 32 位；目录里带着它，插件就认得出「这套是我分享的，已上架」
const MANIFEST_KEYS = new Set(['format', 'type', 'title', 'description', 'kind', 'size', 'os', 'screens', 'style', 'categories', 'tags', 'lang', 'dark', 'license', 'assets', 'author', 'ai', 'derivedFrom', 'shareHash'])
const LOCAL_KEYS = new Set(['from', 'shareToken']) // 只在用户电脑上的 design.json 里（从市场来的、分享过的记号）
const ID_RE = /^[a-z0-9-]{1,39}__[a-z0-9-]{3,40}$/
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const len = (s) => [...String(s)].length

function textField(v, max, maxEn = max * 2) {
  if (!isObj(v)) return '要写成 {"zh": "…", "en": "…"}'
  const keys = Object.keys(v)
  if (keys.some((k) => k !== 'zh' && k !== 'en')) return '只能有 zh / en'
  if (!keys.length || keys.every((k) => typeof v[k] !== 'string' || !v[k].trim())) return '至少写一种语言'
  for (const k of keys) {
    const s = v[k]
    if (typeof s !== 'string') return `${k} 要是文字`
    if (/[\x00-\x1f\x7f\u2028\u2029]/.test(s)) return `${k} 只能写一行`
    if (len(s) > (k === 'en' ? maxEn : max)) return `${k} 太长（最多 ${k === 'en' ? maxEn : max} 字）`
    if (URLISH.test(s)) return `${k} 里不能有网址`
  }
  return ''
}

/**
 * 查清单。opts.mode：'ci'（机器人：严格，未知字段拒收、要有作者）、'share'（分享前：作者由机器人补）、'install'（落地前：只查要用到的）
 * opts.vocab：{ categories: [], tags: [] } 受控词表；不给就只查写法
 */
export function checkManifest(m, { mode = 'install', vocab = null } = {}) {
  const out = []
  const bad = (x, n) => out.push({ code: 'field', x, n })
  if (!isObj(m)) { bad('（整个文件）', '要是一个 JSON 对象'); return out }
  for (const k of Object.keys(m)) {
    if (MANIFEST_KEYS.has(k)) continue
    if (LOCAL_KEYS.has(k) && mode !== 'ci') continue
    if (mode === 'ci' || mode === 'share') out.push({ code: 'unknownField', x: k })
  }
  if (m.format !== FORMAT) bad('format', `要写 ${FORMAT}`)
  if (!TYPES.includes(m.type)) bad('type', `只能是 ${TYPES.join(' / ')}`)
  let e = textField(m.title, 24, 40)
  if (e) bad('title', e)
  if (m.description !== undefined || mode !== 'install') {
    e = textField(m.description, 120, 200)
    if (e) bad('description', e)
  }
  if (!LICENSES.includes(m.license)) bad('license', `只能是 ${LICENSES.join(' / ')}`)
  if (m.type === 'template') {
    if (!KINDS.includes(m.kind)) bad('kind', `只能是 ${KINDS.join(' / ')}`)
    if (m.size !== undefined && !/^\d{3,4}x\d{3,4}$/.test(String(m.size))) bad('size', '写成 1080x1920 这样')
    if (m.os !== undefined && !['mac', 'windows'].includes(m.os)) bad('os', '只能是 mac / windows')
    if (!Array.isArray(m.screens) || !m.screens.length) bad('screens', '至少一屏')
    else if (m.screens.length > LIMITS.screens) bad('screens', `最多 ${LIMITS.screens} 屏`)
    else {
      const seen = new Set()
      m.screens.forEach((s, i) => {
        if (!isObj(s) || typeof s.file !== 'string') return bad(`screens[${i}]`, '要写成 {"file": "home.html", "title": {…}}')
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}\.html$/.test(s.file)) bad(`screens[${i}].file`, '最外层的 .html 文件，用英文字母、数字、. _ -，不能以 _ 开头')
        if (seen.has(s.file.toLowerCase())) bad(`screens[${i}].file`, '重复了')
        seen.add(s.file.toLowerCase())
        if (s.title !== undefined) { const te = textField(s.title, 24, 40); if (te) bad(`screens[${i}].title`, te) }
        if (Object.keys(s).some((k) => k !== 'file' && k !== 'title')) bad(`screens[${i}]`, '只能有 file / title')
      })
    }
  }
  if (m.style !== undefined && !STYLE_IDS.includes(m.style) && m.style !== 'custom') bad('style', '20 个风格 id 之一，或 custom')
  for (const [k, max] of [['categories', 2], ['tags', 8]]) {
    if (m[k] === undefined) continue
    if (!Array.isArray(m[k]) || m[k].length > max || m[k].some((x) => typeof x !== 'string' || !/^[a-z0-9-]{2,24}$/.test(x))) bad(k, `最多 ${max} 个，从词表里选`)
    else if (vocab && Array.isArray(vocab[k]) && m[k].some((x) => !vocab[k].includes(x))) bad(k, `不在词表里：${m[k].filter((x) => !vocab[k].includes(x)).join('、')}`)
  }
  if (m.lang !== undefined && !['zh', 'en', 'both'].includes(m.lang)) bad('lang', '只能是 zh / en / both')
  if (m.dark !== undefined && typeof m.dark !== 'boolean') bad('dark', '要是 true / false')
  if (m.assets !== undefined) {
    if (!Array.isArray(m.assets) || m.assets.length > LIMITS.files) bad('assets', '要是列表')
    else m.assets.forEach((a, i) => {
      if (!isObj(a) || typeof a.path !== 'string' || !cleanPath(a.path)) return bad(`assets[${i}]`, '要有 path（包里的图片）')
      if (!['self', 'cc0', 'pd'].includes(a.source)) bad(`assets[${i}].source`, 'self（自己做的）/ cc0 / pd（公有领域）')
      if (a.source !== 'self' && (typeof a.url !== 'string' || !/^https:\/\/[^\s]{4,300}$/.test(a.url))) bad(`assets[${i}].url`, '写明来源网址（https://…）')
      if (Object.keys(a).some((k) => !['path', 'source', 'url', 'license'].includes(k))) bad(`assets[${i}]`, '只能有 path / source / url / license')
    })
  }
  if (m.author !== undefined || mode === 'ci') {
    const a = m.author
    // 朋友之间传的 zip（不是市场）：署名可以只写名字；市场的必须是 GitHub 账号（机器人从 PR 填）
    const nameOnly = mode !== 'ci' && isObj(a) && a.login === undefined && a.id === undefined
    if (nameOnly) {
      if (typeof a.name !== 'string' || !a.name.trim() || len(a.name) > 40 || /[\x00-\x1f]/.test(a.name) || URLISH.test(a.name)) bad('author.name', '最多 40 字，不能有网址')
      else if (Object.keys(a).some((k) => k !== 'name')) bad('author', '只能有 login / id / name')
    } else if (!isObj(a) || typeof a.login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(a.login) || !Number.isInteger(a.id) || a.id <= 0) bad('author', '要写成 {"login": GitHub 用户名, "id": 数字 id}')
    else if (a.name !== undefined && (typeof a.name !== 'string' || len(a.name) > 40 || /[\x00-\x1f]/.test(a.name) || URLISH.test(a.name))) bad('author.name', '最多 40 字，不能有网址')
    else if (Object.keys(a).some((k) => !['login', 'id', 'name'].includes(k))) bad('author', '只能有 login / id / name')
  }
  if (!isObj(m.ai) || typeof m.ai.generated !== 'boolean' || (m.ai.tool !== undefined && (typeof m.ai.tool !== 'string' || !/^[\w@./ -]{1,60}$/.test(m.ai.tool)))) bad('ai', '要写成 {"generated": true, "tool": "dsh-design-studio@0.11.0"}')
  if (m.derivedFrom !== undefined && (typeof m.derivedFrom !== 'string' || !/^[a-z0-9-]{1,39}__[a-z0-9-]{3,40}@[0-9a-f]{7,40}$/.test(m.derivedFrom))) bad('derivedFrom', '写成 作者__名字@版本')
  if (m.shareHash !== undefined && (typeof m.shareHash !== 'string' || !/^[0-9a-f]{32}$/.test(m.shareHash))) bad('shareHash', '32 位小写十六进制')
  return out
}

/** 风格（style.json）：只收白名单字段，颜色只能 #rrggbb，字体只能是几种系统字体栈 */
export function checkStyle(s) {
  const out = []
  const bad = (x, n) => out.push({ code: 'style', x, n })
  if (!isObj(s)) { bad('（整个文件）', '要是一个 JSON 对象'); return out }
  const KEYS = ['c', 'head', 'w', 'radius', 'shadow', 'nzh', 'nen', 'dzh', 'den', 'bgImage']
  for (const k of Object.keys(s)) if (!KEYS.includes(k)) bad(k, '不认识的字段')
  const C = ['bg', 'surface', 'text', 'muted', 'line', 'primary', 'accent', 'on', 'link']
  if (!isObj(s.c)) bad('c', '要写配色')
  else {
    for (const k of C) if (typeof s.c[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.c[k])) bad(`c.${k}`, '写成 #rrggbb')
    for (const k of Object.keys(s.c)) if (!C.includes(k)) bad(`c.${k}`, '不认识的颜色')
    if (!out.length) {
      for (const [a, b] of [['text', 'bg'], ['muted', 'bg'], ['text', 'surface'], ['on', 'primary']]) {
        const r = hexRatio(s.c[a], s.c[b])
        if (r < 4.5) out.push({ code: 'contrast', x: `${a} / ${b}`, n: r.toFixed(2) })
      }
    }
  }
  if (!HEADS.includes(s.head)) bad('head', HEADS.join(' / '))
  if (!Number.isInteger(s.w) || s.w < 100 || s.w > 900 || s.w % 100) bad('w', '100–900 的整百')
  if (typeof s.radius !== 'number' || s.radius < 0 || s.radius > 48) bad('radius', '0–48')
  if (typeof s.shadow !== 'string' || len(s.shadow) > 120 || !/^(none|[-0-9a-z.,()#%\s]+)$/i.test(s.shadow) || /url|image|var|expression/i.test(s.shadow)) bad('shadow', 'none 或 box-shadow 写法（只能有数字、px、rgba()、#颜色）')
  for (const k of ['dzh', 'den']) if (s[k] !== undefined && (typeof s[k] !== 'string' || len(s[k]) > (k === 'den' ? 80 : 40) || /[\x00-\x1f]/.test(s[k]))) bad(k, '一行，最多 40 字')
  for (const k of ['nzh', 'nen']) {
    if (s[k] === undefined) continue
    const items = typeof s[k] === 'string' ? s[k].split(/[；;]/).map((x) => x.trim()).filter(Boolean) : null
    if (!items || items.length > 4 || items.some((x) => len(x) > (k === 'nen' ? 100 : 40)) || /[\x00-\x1f]/.test(s[k])) bad(k, '要点最多 4 条（用；分开），每条最多 40 字')
  }
  if (s.bgImage !== undefined && (typeof s.bgImage !== 'string' || len(s.bgImage) > 300 || !/^(repeating-)?(linear|radial|conic)-gradient\(/i.test(s.bgImage) || !/^[-a-z0-9#(),.%\s]+$/i.test(s.bgImage) || /url|image\(|var|expression|attr|env/i.test(s.bgImage.replace(/-gradient\(/gi, '(')))) bad('bgImage', '只能写渐变（linear-gradient(…)），不能有 url()')
  for (const k of ['nzh', 'nen', 'dzh', 'den']) {
    if (typeof s[k] !== 'string') continue
    const f = textFlags(s[k]).find((x) => x.code === 'inject' || x.code === 'url')
    if (f) bad(k, `不能有指令或网址（${f.n}）`)
  }
  return out
}

/** 两个 #rrggbb 的对比度（WCAG，和 client.js hexRatio 一样） */
export function hexRatio(a, b) {
  const l = (hex) => { const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  const [x, y] = [l(a), l(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// ── 整套 ──────────────────────────────────────────────────────────────────────

/**
 * 查一整套。
 * @param files [{ path, data }]：data 是 Uint8Array 或字符串
 * @param opts.mode  'ci' | 'share' | 'install' | 'zip'
 *   ci：机器人（个人信息只标出来给人看）；share：分享前（个人信息硬拦）；zip：打 zip 给别人前（个人信息也硬拦）；
 *   install：落地前（市场来的、拖进来的 zip，个人信息只标出来）
 * @param opts.vocab 受控词表
 * @returns { ok, errors, flags, manifest, screens, bytes, kind }
 */
export function checkPack(files, { mode = 'install', vocab = null } = {}) {
  const errors = []
  const flags = []
  const err = (p) => { if (errors.length < 300 && !errors.some((e) => e.code === p.code && e.x === p.x && e.line === p.line && e.n === p.n)) errors.push({ ...p, sev: 'error' }) }
  // 提醒最多 100 条；个人信息的提醒不受这个限制（最后排在最前面，界面截短也先看到）
  const flag = (p) => { if ((flags.length < 100 || PERSONAL_CODES.has(p.code)) && !flags.some((f) => f.code === p.code && f.x === p.x && f.n === p.n)) flags.push({ ...p, sev: 'flag' }) }
  const list = []
  const lower = new Set()
  let bytes = 0
  for (const f of Array.isArray(files) ? files : []) {
    const p = cleanPath(f && f.path)
    if (!p) { err({ code: 'path', x: cut(String((f && f.path) || ''), 80) }); continue }
    const key = p.toLowerCase()
    if (lower.has(key)) { err({ code: 'dup', x: p }); continue }
    lower.add(key)
    const ext = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : ''
    const kind = EXT[ext]
    if (!kind) { err({ code: 'ext', x: p }); continue }
    const size = typeof f.data === 'string' ? new TextEncoder().encode(f.data).length : (f.data && f.data.length) || 0
    bytes += size
    list.push({ path: p, ext, kind, data: f.data, size })
  }
  if (list.length > LIMITS.files) err({ code: 'count', n: list.length, max: LIMITS.files })
  if (bytes > LIMITS.total) err({ code: 'total', n: kb(bytes), max: kb(LIMITS.total) })

  const texts = new Map()
  for (const f of list) {
    if (f.kind === 'image') {
      const info = typeof f.data === 'string' ? null : imageInfo(f.data)
      if (!info || (info.type !== f.ext && !(info.type === 'jpg' && f.ext === 'jpeg'))) { err({ code: 'magic', x: f.path }); continue }
      if (f.size > LIMITS.image) err({ code: 'big', x: f.path, n: kb(f.size), max: kb(LIMITS.image) })
      if (Math.max(info.w, info.h) > LIMITS.side) err({ code: 'side', x: f.path, n: `${info.w}×${info.h}`, max: LIMITS.side })
      // 要公开的（分享、打给别人、投稿）：拍摄信息、XMP 不能带
      if ((mode === 'share' || mode === 'zip' || mode === 'ci') && imageMeta(f.data, info.type)) err({ code: 'imgMeta', x: f.path })
      continue
    }
    const max = LIMITS[f.kind] || LIMITS.html
    if (f.size > max) { err({ code: 'big', x: f.path, n: kb(f.size), max: kb(max) }); continue }
    const { text } = asText(f.data)
    if (text === null) { err({ code: 'utf8', x: f.path }); continue }
    if (text.includes('\0')) { err({ code: 'nul', x: f.path }); continue }
    texts.set(f.path, text)
  }

  // 清单
  let manifest = null
  const mtext = texts.get('design.json')
  if (mtext === undefined) {
    if (!list.some((f) => f.path === 'design.json')) err({ code: 'noManifest' })
  } else {
    try {
      manifest = JSON.parse(mtext)
      for (const p of checkManifest(manifest, { mode: mode === 'zip' ? 'install' : mode, vocab })) err(p)
    } catch (e) {
      err({ code: 'json', x: 'design.json', n: cut(e.message, 80) })
    }
  }
  const type = manifest && TYPES.includes(manifest.type) ? manifest.type : 'template'
  const screens = manifest && Array.isArray(manifest.screens) ? manifest.screens.filter((s) => s && typeof s.file === 'string').map((s) => s.file) : []
  const screenSet = new Set(screens.map((s) => s.toLowerCase()))
  const kind = manifest && KINDS.includes(manifest.kind) ? manifest.kind : ''

  if (type === 'template') {
    for (const s of screens) if (!lower.has(s.toLowerCase())) err({ code: 'screenMissing', x: s })
  }
  if (type === 'system') {
    for (const need of ['system.json', 'tokens.css', 'components.css', 'components.html', 'DESIGN.md']) if (!list.some((f) => f.path === need)) err({ code: 'system', x: need })
    // source/ 是设计台在本机放网站截图、提取素材的地方，装的时候不装：要用的图放 assets/
    const src = list.find((f) => /^source\//i.test(f.path))
    if (src) err({ code: 'systemSource', x: src.path })
  }
  if (type === 'style') {
    const st = texts.get('style.json')
    if (st === undefined) err({ code: 'style', x: 'style.json', n: '缺这个文件' })
    else {
      try { for (const p of checkStyle(JSON.parse(st))) err(p) } catch (e) { err({ code: 'json', x: 'style.json', n: cut(e.message, 80) }) }
    }
  }

  const personalHard = mode === 'share' || mode === 'zip' // 分享前、打 zip 给别人前：个人信息直接拦（发出去就收不回）
  for (const f of list) {
    const text = texts.get(f.path)
    if (text === undefined) continue
    if (f.kind === 'html') {
      const top = !f.path.includes('/')
      if (!top) err({ code: 'subHtml', x: f.path })
      else if (type === 'template' && !screenSet.has(f.path.toLowerCase())) err({ code: 'screenUnlisted', x: f.path })
      for (const p of checkMarkup(text, { file: f.path, files: lower })) {
        // 注释、表单地址、站外链接在分享 / 投稿时会自动修；落地前（市场来的已经修过）照样算错
        err(p)
      }
      if (type === 'template' && screenSet.has(f.path.toLowerCase())) {
        const mk = metaKind(text)
        if (!mk || (kind && mk !== kind)) err({ code: 'meta', x: f.path, n: kind || 'web' })
        const title = titleOf(text)
        if (!/\S\s*·\s*\S/.test(title)) err({ code: 'titleFmt', x: f.path })
      }
      if (/<input\b[^>]*\btype\s*=\s*["']?password/i.test(text)) flag({ code: 'password', x: f.path })
      scanText(visibleText(text), text, f.path)
      scanCss(text, f.path)
    } else if (f.kind === 'svg') {
      for (const p of checkMarkup(text, { file: f.path, files: lower, svg: true })) err(p)
      scanText(visibleText(text), text, f.path)
      scanCss(text, f.path)
    } else if (f.kind === 'css') {
      checkCssText(text, { file: f.path, src: text, base: 0, dir: dirOf(f.path), files: lower, add: err })
      const cs = /^@charset\s+"([^"]*)"/i.exec(text)
      if (cs && !/^utf-?8$/i.test(cs[1].trim())) err({ code: 'charset', x: f.path, line: 1 })
      // 注释和引号里的字（content: "…"）都会跟着包发出去
      const notes = [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]).concat(cssStrings(text)).join(PART_SEP)
      if (notes) scanText(notes, text, f.path)
    } else if (f.kind === 'json') {
      if (f.path !== 'design.json') {
        try { JSON.parse(text) } catch (e) { err({ code: 'json', x: f.path, n: cut(e.message, 80) }) }
        scanText(text, text, f.path)
      }
    } else if (f.kind === 'md') {
      // Markdown：号码前后紧挨的 * / _（加粗、斜体，不管配没配上，号码在页面上都看得见）不挡；邮箱的打码 / 装饰见 emailsIn
      scanText(text, text, f.path, { md: true })
    }
    // 网页、样式、矢量图里内嵌的图片：一样不能带拍摄信息（插件打包时会自动去掉 JPG / PNG / WebP / GIF 的）
    // 内嵌的 SVG：和单独的 .svg 一样查里面的字、样式、本机路径，再往里一层查它内嵌的图片；里面再套 SVG、不是 UTF-8、认不出的图都拦
    if (f.kind === 'html' || f.kind === 'css' || f.kind === 'svg') {
      const strict = mode === 'share' || mode === 'zip' || mode === 'ci'
      const hard = strict ? err : flag
      const d = inlineData(text, f.kind)
      if (d.more) hard({ code: 'inlineMany', x: f.path, n: INLINE_MAX })
      const svgs = d.svgs.slice(0, 300)
      if (d.svgs.length > svgs.length) hard({ code: 'inlineMany', x: f.path, n: 300 })
      const imgs = [...d.images]
      const bad = [...d.bad]
      for (const sv of svgs) {
        const line = lineAt(text, sv.at)
        if (sv.text === null) { hard({ code: 'inlineEncoding', x: f.path, line }); continue }
        // 浏览器会显示的（地址属性、CSS 的 url）：和单独的 .svg 一样的写法规矩（DOCTYPE / 实体、注释、脚本、外链…），里面不许再套 SVG
        // ——实体能把地址拼出来、注释里的字也会跟着发出去。兜底搜到的（边界不确定，可能是一截）不会被显示：只查里面的字
        const inner = inlineData(sv.text, 'svg')
        if (!sv.loose) {
          const mk = checkMarkup(sv.text, { file: f.path, svg: true })
          if (mk.length) hard({ code: 'inlineSvgBad', x: f.path, line, n: [...new Set(mk.map((p) => p.code))].slice(0, 4).join(', ') })
          if (inner.more) hard({ code: 'inlineMany', x: f.path, n: INLINE_MAX })
          if (inner.svgs.length) hard({ code: 'inlineNested', x: f.path, line })
        }
        imgs.push(...inner.images.map((x) => ({ ...x, at: sv.at })))
        if (!sv.loose) bad.push(...inner.bad.map((x) => ({ ...x, at: sv.at })))
        // 兜底搜到的不会被显示，只是跟着发出去的字节：整段（实体还原后）都查
        const parts = sv.loose ? [decodeEntities(sv.text).text] : [visibleText(sv.text)]
        if (!sv.loose) for (const c of htmlCss(sv.text)) parts.push(...[...c.text.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]), ...cssStrings(c.text))
        for (const p of textFlags(parts.join(PART_SEP))) {
          const item = { code: p.code, x: f.path, line, n: cut(p.n, 40) }
          if (p.code === 'phone' || p.code === 'idcard' || p.code === 'email') (personalHard && !p.maybe ? err : flag)(item)
          else if (p.code !== 'url') flag(item)
        }
        if (!sv.loose) for (const p of personalAll(sv.text)) (personalHard && !p.maybe ? err : flag)({ code: p.code, x: f.path, line, n: cut(p.n, 40) })
        const lp = localPathIn(sv.text)
        if (lp) (personalHard || mode === 'ci' ? err : flag)({ code: 'localPath', x: f.path, line, n: cut(lp.n, 40) })
      }
      if (bad.length) hard({ code: 'inlineBad', x: f.path, line: lineAt(text, bad[0].at) })
      for (const im of imgs) {
        if (!imageMeta(im.buf, im.type)) continue
        hard({ code: 'imgMetaInline', x: f.path, line: lineAt(text, im.at) })
        break
      }
    }
    // 网页 / 矢量图 / 样式：整份文件的手机号、身份证、邮箱（看不看得见都会发出去；md / json 本来就整份查）
    if (f.kind === 'html' || f.kind === 'svg' || f.kind === 'css') {
      for (const p of personalAll(text)) (personalHard && !p.maybe ? err : flag)({ code: p.code, x: f.path, line: lineNear(text, p.n), n: cut(p.n, 40) })
    }
    // 所有文字文件（连 design.json）：本机路径
    const lp = localPathIn(text)
    if (lp) (personalHard || mode === 'ci' ? err : flag)({ code: 'localPath', x: f.path, line: lineAt(text, lp.at), n: cut(lp.n, 40) })
  }
  if (manifest && Array.isArray(manifest.assets)) {
    for (const a of manifest.assets) if (a && typeof a.path === 'string' && cleanPath(a.path) && !lower.has(cleanPath(a.path).toLowerCase())) err({ code: 'asset', x: a.path, n: '包里没有这个文件' })
  }
  // 清单里人写的字：名字、介绍、每屏的标题、署名（编号、哈希、受控词这些不查）
  if (manifest) {
    const own = [manifest.title, manifest.description, ...(Array.isArray(manifest.screens) ? manifest.screens.map((x) => (isObj(x) ? x.title : null)) : [])]
    const who = isObj(manifest.author) && typeof manifest.author.name === 'string' ? [manifest.author.name] : []
    scanText([...own.flatMap((x) => (isObj(x) ? Object.values(x).filter((v) => typeof v === 'string') : [])), ...who].join(PART_SEP), null, 'design.json')
  }

  // 网页 / 矢量图里 <style> 和 style 属性：注释和引号里的字（content: "…"）也会跟着发出去
  function scanCss(src, file) {
    const parts = []
    for (const c of htmlCss(src)) parts.push(...[...c.text.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]), ...cssStrings(c.text))
    if (parts.length) scanText(parts.join(PART_SEP), src, file)
  }

  function scanText(visible, src, file, { md = false } = {}) {
    for (const p of textFlags(visible, { md })) {
      const line = src ? lineNear(src, p.n) : 1
      const item = { code: p.code, x: file, line, n: cut(p.n, 40) }
      // 拿不准的（号码紧挨着别的数字、只隔着行内标签）：提醒，不硬拦
      if (p.code === 'phone' || p.code === 'idcard' || p.code === 'email') (personalHard && !p.maybe ? err : flag)(item)
      else if (p.code === 'url' && file === 'design.json') err(item)
      else if (p.code !== 'url') flag(item)
    }
  }

  flags.sort((a, b) => Number(PERSONAL_CODES.has(b.code)) - Number(PERSONAL_CODES.has(a.code)))
  return { ok: !errors.length, errors, flags, manifest, screens, bytes, kind, type }
}

function lineNear(src, needle) {
  const i = src.indexOf(needle)
  return i >= 0 ? lineAt(src, i) : 1
}
