/**
 * 风格卡的服务端一份：pick_style 工具用（模型自己定风格时，消费类题目总落回米色暖调）。
 * 和右侧栏 client.js 里的 STYLES、autoStyle 是同一份内容：客户端是单文件、不能 import，
 * 改了要两边一起改，test-client.mjs 会比对。
 */
import { contrast, parseColor } from './system.js'

const SANS = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif'
const SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
const ROUND = '"SF Pro Rounded", "PingFang SC", "HarmonyOS Sans SC", system-ui, sans-serif'
const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
const GROTESK = '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
export const STYLES = [
  { id: 'minimal', zh: '极简白', en: 'Minimal', dzh: '大留白、细线、黑白加一点蓝', den: 'Lots of space, hairlines, black and white with a touch of blue',
    c: { bg: '#FAFAF9', surface: '#FFFFFF', text: '#18181B', muted: '#6B6B73', line: '#E4E4E7', primary: '#18181B', accent: '#2563EB', on: '#FFFFFF', link: '#2563EB' },
    head: SANS, w: 600, radius: 10, shadow: '0 1px 2px rgba(24,24,27,.06)',
    nzh: '靠字号和留白分层级，不靠色块；分隔用 1px 细线；蓝色只给链接和选中态；大标题字距收 -0.02em',
    nen: 'Hierarchy from type size and whitespace, not color blocks; 1px hairlines; blue only for links and selection; tighten big headings to -0.02em' },
  { id: 'warm', zh: '温暖手作', en: 'Warm craft', dzh: '纸感底色、圆润、手绘感', den: 'Paper tones, soft and rounded, hand-made feel',
    c: { bg: '#F6EFE6', surface: '#FFF9F2', text: '#2B1D14', muted: '#6E5A4B', line: '#E7D9C8', primary: '#A9542A', accent: '#5E7A4A', on: '#FFFFFF', link: '#52703F' },
    head: SERIF, w: 600, radius: 16, shadow: '0 8px 24px rgba(120,72,30,.12)',
    nzh: '标题用衬线字，正文无衬线；插画用手绘线条和色块；阴影带暖色；中性色都偏暖，不用纯灰',
    nen: 'Serif headings, sans body; hand-drawn line illustrations and color blocks; warm-tinted shadows; warm neutrals, no pure gray' },
  { id: 'editorial', zh: '杂志编辑', en: 'Editorial', dzh: '大标题、黑线栅格、红色点题', den: 'Big headlines, black-rule grid, a red accent',
    c: { bg: '#F4F1EA', surface: '#FFFFFF', text: '#111111', muted: '#555555', line: '#111111', primary: '#C8231B', accent: '#111111', on: '#FFFFFF', link: '#C8231B' },
    head: SERIF, w: 700, radius: 2, shadow: 'none',
    nzh: '标题很大、粗细对比强烈；用粗细两种黑线分栏；版式不对称、有留白；红色只在一两处；几乎没有圆角和阴影',
    nen: 'Very large headlines with strong weight contrast; thick and thin black rules for columns; asymmetric layout; red in one or two places only; almost no radius or shadow' },
  { id: 'dark', zh: '深色高级', en: 'Dark luxe', dzh: '近黑底、香槟金点缀、大图', den: 'Near-black, champagne gold accents, big imagery',
    c: { bg: '#0E0E10', surface: '#18181B', text: '#F2EFE9', muted: '#A19C93', line: '#2C2C30', primary: '#C9A86A', accent: '#E8E2D6', on: '#17140E', link: '#C9A86A' },
    head: SERIF, w: 500, radius: 12, shadow: '0 12px 40px rgba(0,0,0,.45)',
    nzh: '金色只点在关键按钮和细线上；层级靠表面色深浅，不靠阴影；标题细一点、字距放开；留白要多',
    nen: 'Gold only on key buttons and fine lines; layers from surface shades, not shadows; lighter, tracked-out headings; generous space' },
  { id: 'playful', zh: '活泼年轻', en: 'Playful', dzh: '粗描边、硬阴影、贴纸感', den: 'Thick outlines, hard shadows, sticker feel',
    c: { bg: '#FFF7E8', surface: '#FFFFFF', text: '#1D1B3A', muted: '#5D5A82', line: '#1D1B3A', primary: '#FF6A3D', accent: '#1F9E92', on: '#1D1B3A', link: '#137167' },
    head: ROUND, w: 800, radius: 20, shadow: '4px 4px 0 #1D1B3A',
    nzh: '卡片和按钮 2px 深色描边 + 不模糊的硬阴影；主色按钮上用深色字；元素可以略微倾斜、像贴纸；颜色最多三种',
    nen: '2px dark outlines and hard, unblurred shadows on cards and buttons; dark text on the primary button; slightly tilted sticker-like bits; three colors max' },
  { id: 'fresh', zh: '清新自然', en: 'Fresh', dzh: '浅绿底、圆角卡片、轻插画', den: 'Pale green, rounded cards, light illustration',
    c: { bg: '#F3F7F2', surface: '#FFFFFF', text: '#1F2A22', muted: '#56665A', line: '#DCE6DA', primary: '#2F7D4F', accent: '#C9962A', on: '#FFFFFF', link: '#2F7D4F' },
    head: SANS, w: 600, radius: 14, shadow: '0 6px 18px rgba(47,125,79,.10)',
    nzh: '大面积浅色、卡片白底；插画用叶子、阳光这类自然元素；黄色只做小点缀；整体轻、透气',
    nen: 'Large light areas with white cards; nature motifs (leaves, sunlight) in illustrations; yellow only as a small accent; light and airy' },
  { id: 'tech', zh: '专业科技', en: 'Pro / tech', dzh: '冷灰蓝、信息密、数字清楚', den: 'Cool gray-blue, dense info, crisp numbers',
    c: { bg: '#F5F7FB', surface: '#FFFFFF', text: '#0F172A', muted: '#55657D', line: '#E2E8F0', primary: '#2457F5', accent: '#0F8F8E', on: '#FFFFFF', link: '#2457F5' },
    head: SANS, w: 600, radius: 8, shadow: '0 1px 3px rgba(15,23,42,.08)',
    nzh: '信息密度高但对齐严格；数字用等宽（font-variant-numeric: tabular-nums）；表格行高 44–48；状态用小色点和标签；主色只给主操作',
    nen: 'Dense but strictly aligned; tabular numbers (font-variant-numeric: tabular-nums); 44–48px table rows; status as small dots and tags; primary color only for the main action' },
  { id: 'glass', zh: '玻璃质感', en: 'Glass', dzh: '柔光底、浮层毛玻璃', den: 'Soft glow background, frosted overlays',
    c: { bg: '#EAF0F6', surface: '#F7F9FC', text: '#10151C', muted: '#4F5B69', line: '#D5DEE8', primary: '#CC4520', accent: '#2B6CB0', on: '#FFFFFF', link: '#2B6CB0' },
    bgImage: 'radial-gradient(circle at 20% 15%, #FFD9C7 0, transparent 45%), radial-gradient(circle at 85% 70%, #C9E2FF 0, transparent 50%)',
    head: SANS, w: 600, radius: 18, shadow: '0 10px 30px rgba(16,21,28,.10)',
    nzh: '底色加两三团柔和的光斑（别用紫蓝渐变）；只有浮层、卡片、标签栏用毛玻璃（半透明白 + backdrop-filter: blur(20px) + 1px 白色描边），正文区是实色；毛玻璃上的字照样要够深',
    nen: 'Two or three soft light blobs on the background (not a purple-blue gradient); frosted glass only on overlays, cards and tab bars (translucent white + backdrop-filter: blur(20px) + 1px white border), solid elsewhere; text on glass stays dark enough' },
  { id: 'soft', zh: '柔和立体', en: 'Soft UI', dzh: '同色底、凸起凹陷的柔光阴影', den: 'Same-color surfaces with raised and pressed soft shadows',
    c: { bg: '#E9EDF2', surface: '#E9EDF2', text: '#2D3440', muted: '#556072', line: '#D3D9E1', primary: '#3E5BD8', accent: '#22A06B', on: '#FFFFFF', link: '#3E5BD8' },
    head: ROUND, w: 700, radius: 18, shadow: '6px 6px 14px #C8CED6, -6px -6px 14px #FFFFFF',
    nzh: '卡片和底同色，靠一亮一暗两道阴影凸起，按下用内阴影；容易看不清，所以主按钮一定用主色实底、文字够深；别整屏都是凸起',
    nen: 'Cards share the background color and rise with a light and a dark shadow; pressed states use inset shadows; it gets low-contrast fast, so the main button is solid primary with strong text; don\'t make everything raised' },
  { id: 'guochao', zh: '国潮', en: 'Guochao', dzh: '中国红配金、粗宋体、传统纹样', den: 'Chinese red and gold, bold Song type, traditional patterns',
    c: { bg: '#FBF3E4', surface: '#FFFAF0', text: '#2A1410', muted: '#6F4A3A', line: '#E8D3B5', primary: '#B8202A', accent: '#C8952E', on: '#FFF7E6', link: '#A31D26' },
    head: SERIF, w: 800, radius: 6, shadow: '0 6px 18px rgba(140,30,20,.12)',
    nzh: '中国红的大色块配金色细线；标题用粗宋体，可以竖排；祥云、回纹、印章这类纹样用 SVG 画，只做点缀别铺满；底色是米黄纸色，不用纯白',
    nen: 'Big Chinese-red blocks with fine gold lines; bold Song headings, vertical text allowed; clouds, fret borders and seal stamps drawn in SVG as accents only; rice-paper background, not pure white' },
  { id: 'ink', zh: '中式雅致', en: 'Ink & paper', dzh: '宣纸底、墨色字、朱砂点缀', den: 'Paper white, ink-black type, a touch of cinnabar',
    c: { bg: '#F5F2EC', surface: '#FBF9F5', text: '#1E1E1C', muted: '#5F5B54', line: '#DAD4C8', primary: '#2F3B37', accent: '#8C2F2B', on: '#F5F2EC', link: '#8C2F2B' },
    head: SERIF, w: 500, radius: 4, shadow: 'none',
    nzh: '大量留白、细线分隔；标题细宋体、字距放开；朱砂红只像印章一样点一两处；插画用浅灰的水墨晕染（SVG 模糊色块），不用照片堆满',
    nen: 'Lots of space and hairline dividers; light Song headings with open tracking; cinnabar red only in one or two seal-like spots; illustrations as pale ink washes (blurred SVG shapes), not photo walls' },
  { id: 'cyber', zh: '赛博朋克', en: 'Cyberpunk', dzh: '近黑底、品红青色霓虹、等宽字', den: 'Near-black, magenta and cyan neon, monospace',
    c: { bg: '#0B0B16', surface: '#151528', text: '#E9E6FF', muted: '#A09CC8', line: '#2E2B52', primary: '#FF2E88', accent: '#22E1FF', on: '#0B0B16', link: '#22E1FF' },
    head: MONO, w: 700, radius: 2, shadow: '0 0 0 1px #FF2E88, 0 0 18px rgba(255,46,136,.45)',
    nzh: '标题用等宽字、全大写，可以加一点故障错位（两层彩色 text-shadow）；边框是 1px 霓虹线加外发光，发光只给主按钮和关键数字；背景可以叠细网格线；正文照样要清楚',
    nen: 'Monospace, all-caps headings with a slight glitch (two colored text-shadows); 1px neon borders with glow, glow only on the main button and key numbers; a fine grid on the background is fine; body text stays readable' },
  { id: 'cute', zh: '可爱卡通', en: 'Cute', dzh: '粉黄糖果色、大圆角、圆体字', den: 'Candy pink and yellow, big radii, rounded type',
    c: { bg: '#FFF4F6', surface: '#FFFFFF', text: '#3A2540', muted: '#7A5E80', line: '#F3D3DD', primary: '#FF7AA8', accent: '#FFC93C', on: '#3A2540', link: '#C2366F' },
    head: ROUND, w: 800, radius: 24, shadow: '0 6px 0 #F3C4D3',
    nzh: '圆角很大、字胖胖的；按钮像糖果，底下一道同色系的厚阴影；配小动物或角色插画（SVG 简单几何画）；粉色和黄色两种就够，主色按钮上用深色字',
    nen: 'Very round corners and chubby type; candy-like buttons with a thick same-hue shadow underneath; small animal or mascot illustrations (simple SVG shapes); pink and yellow are enough; dark text on the primary button' },
  { id: 'retro', zh: '复古', en: 'Retro', dzh: '焦橙芥末黄墨绿、粗衬线、颗粒感', den: 'Burnt orange, mustard and teal, fat serif, grain',
    c: { bg: '#F3E6CF', surface: '#FBF2E2', text: '#2E1F14', muted: '#6A5240', line: '#DDC7A4', primary: '#B5471D', accent: '#E0A526', on: '#FFF6E8', link: '#2F5D50' },
    head: SERIF, w: 800, radius: 14, shadow: '0 4px 0 #2E1F14',
    nzh: '焦橙、芥末黄、墨绿三色；粗衬线大标题；彩虹条纹、圆形徽章做装饰；底色叠一层很淡的颗粒噪点（SVG feTurbulence）；图片调成褪色暖调',
    nen: 'Burnt orange, mustard and teal; fat serif headlines; rainbow stripes and round badges as decoration; a very light grain over the background (SVG feTurbulence); faded warm photos' },
  { id: 'sale', zh: '电商促销', en: 'Sale', dzh: '红橙主色、大价格、优惠券', den: 'Red-orange, big prices, coupons',
    c: { bg: '#FFF5F0', surface: '#FFFFFF', text: '#1F1A17', muted: '#6B5E57', line: '#F5DDD2', primary: '#CF2E0E', accent: '#FFB800', on: '#FFFFFF', link: '#C2290B' },
    head: SANS, w: 800, radius: 12, shadow: '0 4px 12px rgba(207,46,14,.12)',
    nzh: '价格用大号粗体数字（¥ 小一号），原价灰色划线；「限时」「包邮」这类小标签用色块；优惠券用金黄色、带锯齿边；倒计时醒目；信息多但分区清楚，主按钮通栏',
    nen: 'Prices in big bold numerals (smaller currency sign), old price struck through in gray; small colored tags like "Limited" and "Free shipping"; gold coupons with notched edges; a prominent countdown; dense but clearly sectioned, full-width main button' },
  { id: 'japandi', zh: '日系原木', en: 'Japandi', dzh: '米色原木、低饱和、小字大留白', den: 'Oat and wood tones, muted, small type and lots of space',
    c: { bg: '#F2EEE6', surface: '#FAF8F3', text: '#2F2B26', muted: '#6B645A', line: '#DDD5C8', primary: '#4F4234', accent: '#8C9A6E', on: '#FAF8F3', link: '#6B4F33' },
    head: SANS, w: 500, radius: 6, shadow: '0 2px 8px rgba(79,66,52,.06)',
    nzh: '像杂货店和家居品牌：字号偏小、字重不重，留白很多；颜色只有米、原木棕、灰绿，饱和度都低；照片柔光、自然材质（木、麻、陶）；细线分隔，几乎不用阴影；主按钮深棕实底',
    nen: 'Like a lifestyle or homeware brand: smallish, light type and lots of space; only oat, wood brown and sage, all low saturation; soft-light photos of natural materials (wood, linen, ceramic); hairline dividers, almost no shadow; solid dark-brown main button' },
  { id: 'swiss', zh: '瑞士网格', en: 'Swiss grid', dzh: '白底黑字红色块、严格网格', den: 'White, black type, red blocks, strict grid',
    c: { bg: '#FFFFFF', surface: '#F1F1F1', text: '#0A0A0A', muted: '#545454', line: '#0A0A0A', primary: '#D9001B', accent: '#0A0A0A', on: '#FFFFFF', link: '#C2001A' },
    head: GROTESK, w: 800, radius: 0, shadow: 'none',
    nzh: '12 栏严格网格、全部左对齐（不居中）；标题是超大粗无衬线、字距收紧（-0.03em）；红色大色块只用一两处；用数字编号（01 02 03）和粗黑线分区；没有圆角、阴影和渐变',
    nen: 'A strict 12-column grid, everything left-aligned (nothing centered); huge, bold, tightly tracked sans headings (-0.03em); one or two big red blocks; numbered sections (01 02 03) and heavy black rules; no radius, shadow or gradient' },
  { id: 'brutal', zh: '粗野主义', en: 'Brutalist', dzh: '亮黄底、黑粗框、硬阴影、等宽字', den: 'Bright yellow, thick black borders, hard shadows, monospace',
    c: { bg: '#FFEF5C', surface: '#FFFFFF', text: '#000000', muted: '#3B3B3B', line: '#000000', primary: '#000000', accent: '#FF5C39', on: '#FFEF5C', link: '#1F3FD1' },
    head: MONO, w: 800, radius: 0, shadow: '5px 5px 0 #000000',
    nzh: '卡片和按钮 3px 黑粗边框 + 大偏移的硬阴影（不模糊）；标题等宽字、很大；亮黄、白、橙红高饱和撞色；元素可以故意错位、叠放；不用渐变、圆角和柔和阴影；链接带下划线',
    nen: '3px black borders and big unblurred offset shadows on cards and buttons; large monospace headings; loud yellow, white and red-orange blocks; deliberate offsets and overlaps are fine; no gradients, radius or soft shadows; underlined links' },
  { id: 'cream', zh: '奶油风', en: 'Cream', dzh: '奶白燕麦焦糖、大圆角、柔光', den: 'Milk, oat and caramel, big radii, soft light',
    c: { bg: '#FAF5EE', surface: '#FFFDF9', text: '#3A2F28', muted: '#76675C', line: '#EEE3D5', primary: '#8C5E3C', accent: '#E7C9A6', on: '#FFFFFF', link: '#8A5A36' },
    head: ROUND, w: 700, radius: 22, shadow: '0 10px 30px rgba(140,94,60,.10)',
    nzh: '奶白、燕麦、焦糖三个色；圆角大，多用圆形和胶囊形；阴影又大又淡、带一点暖色；字是深咖啡色不用纯黑；照片和插画柔光、低对比；整体软、暖、安静',
    nen: 'Milk, oat and caramel; big radii, lots of circles and pills; large, faint, warm-tinted shadows; dark coffee text, never pure black; soft, low-contrast photos and illustrations; soft, warm and calm overall' },
  { id: 'sport', zh: '运动能量', en: 'Sport', dzh: '黑底荧光绿、粗斜体、大数字', den: 'Black with volt green, heavy italics, big numbers',
    c: { bg: '#0E0F11', surface: '#1A1C20', text: '#F4F5F6', muted: '#A1A5AD', line: '#2B2E35', primary: '#C8FF2E', accent: '#FF5A1F', on: '#0E0F11', link: '#C8FF2E' },
    head: SANS, w: 900, radius: 6, shadow: 'none',
    nzh: '标题超粗斜体、全大写、字距收紧；荧光绿只给主按钮、进度和关键数字；配速、心率、卡路里这类数字做得很大（等宽数字）；可以用斜切的色块（transform: skewX(-8deg)）；照片高对比、有动感；橙色只做警示和次要强调',
    nen: 'Heavy italic, all-caps, tightly tracked headings; volt green only on the main button, progress and key numbers; big tabular numbers for pace, heart rate and calories; slanted blocks (transform: skewX(-8deg)) are fine; high-contrast action photos; orange only for alerts and secondary emphasis' },
]

export const AUTO_STYLE = [
  ['sport', /跑步|健身|运动|赛事|马拉松|骑行|瑜伽|球馆|\b(runners?|running|fitness|gym|workouts?|sports?|marathons?|cycling|athletes?)\b/i],
  ['cyber', /电音|夜店|电竞|游戏|音乐节|livehouse|酒吧|\b(game|gaming|esports?|nightclub|club|rave|festival)\b/i],
  ['sale', /促销|大促|双十一|双11|618|秒杀|优惠|团购|外卖|\b(sale|deals?|coupons?|promo|black friday)\b/i],
  ['tech', /后台|管理系统|仪表盘|看板|数据|金融|理财|银行|证券|\b(saas|crm|erp|dashboard|admin|analytics|finance|fintech|bank|banking|crypto|b2b|devops|api)\b/i],
  ['dark', /奢|高端|珠宝|腕表|名表|红酒|威士忌|私人|黑卡|\b(luxury|premium|jewel|jewelry|jewellery|wristwatch(es)?|timepieces?|wine|whisky|concierge)\b/i],
  ['cute', /儿童|幼儿|宠物|猫|狗|萌|甜品|蛋糕|玩具|\b(kids?|children|pets?|cats?|dogs?|puppy|toys?|dessert|candy)\b/i],
  ['fresh', /健康|医疗|医院|诊所|户外|露营|母婴|植物|花店|有机|环保|民宿|旅行|旅游|度假|\b(health|medical|clinic|hospital|outdoor|camping|baby|plants?|florist|organic|eco|travel|trip|stays?|vacation|hotel|bnb)\b/i],
  ['playful', /奶茶|果茶|饮品|饮料|社交|交友|学生|校园|潮牌|\b(bubble tea|boba|drinks?|smoothie|social|dating|students?|campus|streetwear)\b/i],
  ['guochao', /春节|新年|中秋|端午|国潮|老字号|文创|庙会/],
  ['retro', /咖啡|黑胶|唱片|市集|古着|理发|面包|\b(vinyl|records?|vintage|barber|bakery|coffee)\b/i],
  ['glass', /音乐|播放器|天气|智能家居|\b(music|player|weather|smart home|podcast)\b/i],
  ['editorial', /新闻|杂志|博客|阅读|读书|书店|媒体|播客|\b(news|magazine|blog|reading|books?|media|newsletter)\b/i],
  ['swiss', /设计工作室|建筑|展览|美术馆|画廊|作品集|\b(agency|studio|architecture|exhibition|gallery|museum|portfolio)\b/i],
]
export const AUTO_BY_KIND = { slides: 'swiss', web: 'minimal', desktop: 'tech', email: 'minimal', poster: 'playful', tablet: 'minimal' }
export const AUTO_SPREAD = ['minimal', 'editorial', 'playful', 'fresh', 'tech', 'glass', 'dark', 'sport']
// 「北欧风」「清新风：首页…」「中国风的界面」算说了风格；先去掉「通风」「台风」「新风系统」「风控」「风景」这类不是风格的词
export const NOT_STYLE_FENG = /通风|台风|新风(系统|机|量)|风险|风控|风景|风扇|风味|风暴|风光|风速|风向|风筝|风铃|风车|吹风|防风|挡风|避风|屏风|旋风|狂风|微风|寒风|疾风|顺风|逆风|作风|中风|风湿|风水/g
export const SAID_STYLE = /风格|配色|色调|主色|色系|[红橙黄绿青蓝紫粉黑白灰棕金银米]色|蓝白|黑白|黑金|红白|绿白|深色|浅色|暗色|亮色|[^\s。，,、：:；;（(]风|\b(style|styled|aesthetic|vibe|palette|colou?r scheme|look and feel|dark|light)\b/i
export function autoStyle(text, kind) {
  const s = String(text || '')
  if (!s.trim()) return null
  const said = s.replace(NOT_STYLE_FENG, ' ')
  if (SAID_STYLE.test(said) || STYLES.some((x) => said.includes(x.zh) || new RegExp(`\\b${x.en}\\s+(style|look|theme|aesthetic|vibe)\\b`, 'i').test(said))) return null
  return topicStyle(s, kind)
}

/** 只按题材和类型挑一张，不管用户说没说风格（说没说由调工具的模型判断） */
function topicStyle(s, kind) {
  const by = (id) => STYLES.find((x) => x.id === id) || null
  for (const [id, re] of AUTO_STYLE) if (re.test(s)) return by(id)
  if (AUTO_BY_KIND[kind]) return by(AUTO_BY_KIND[kind])
  let n = 0
  for (const ch of s) n = (n * 31 + ch.codePointAt(0)) >>> 0
  return by(AUTO_SPREAD[n % AUTO_SPREAD.length])
}

const hexRatio = (a, b) => contrast(parseColor(a), parseColor(b))

function accentUse(c, en) {
  if (Math.min(hexRatio(c.accent, c.bg), hexRatio(c.accent, c.surface)) >= 3) return en ? 'graphics and large text only' : '图形、大字'
  if (hexRatio(c.text, c.accent) >= 4.5) return en ? `graphics and color blocks only, not for text; text on those blocks uses ${c.text}` : `只做图形和色块，别拿来写字；色块上的字用 ${c.text}`
  return en ? 'graphics only, not for text' : '只做图形，别拿来写字'
}

/** 一张卡写成给模型看的字（和点风格卡时放进输入框的内容一样全） */
function cardText(x, en) {
  const c = x.c
  const bgImage = x.bgImage ? (en ? `; on the background: ${x.bgImage}` : `；底色上叠 ${x.bgImage}`) : ''
  return en
    ? `${x.en}: ${x.den}\nColors: background ${c.bg}, cards ${c.surface}, text ${c.text}, muted text ${c.muted}, lines ${c.line}, primary ${c.primary} (text on it ${c.on}), accent ${c.accent} (${accentUse(c, true)}), links and small emphasis ${c.link}${bgImage}\nFonts: headings ${x.head} · ${x.w}; body ${SANS}\nShape: radius ${x.radius}px; shadow ${x.shadow}\nNotes: ${x.nen}`
    : `${x.zh}——${x.dzh}\n配色：底色 ${c.bg}，卡片 ${c.surface}，文字 ${c.text}，次要文字 ${c.muted}，分隔线 ${c.line}，主色 ${c.primary}（上面的字 ${c.on}），点缀 ${c.accent}（${accentUse(c, false)}），链接和小字强调 ${c.link}${bgImage}\n字体：标题 ${x.head} · ${x.w}；正文 ${SANS}\n形状：圆角 ${x.radius}px；阴影 ${x.shadow}\n要点：${x.nzh}`
}

const hashOf = (s) => { let n = 0; for (const ch of s) n = (n * 31 + ch.codePointAt(0)) >>> 0; return n }

/**
 * 按题材挑卡。第一张和首页「风格：自动」挑的一样；要几个方向就往后从不是米色的几张里接着取。
 * 用户定没定风格由模型判断：调了就给卡（自然语言猜不全，猜错了会把用户指定的配色换掉）
 */
export function pickStyles(subject, kind, count = 1) {
  const first = topicStyle(String(subject), kind)
  const n = Math.min(3, Math.max(1, Math.floor(Number(count)) || 1))
  const out = [first]
  const start = hashOf(String(subject))
  for (let i = 0; out.length < n && i < AUTO_SPREAD.length; i++) {
    const x = STYLES.find((s) => s.id === AUTO_SPREAD[(start + i) % AUTO_SPREAD.length])
    if (x && !out.includes(x)) out.push(x)
  }
  return out
}

/** pick_style 工具的返回文字 */
export function pickStyleText(subject, kind, count = 1) {
  const en = !/[一-鿿]/.test(String(subject))
  const list = pickStyles(subject, kind, count)
  const cards = list.map((x, i) => (list.length > 1 ? `${en ? 'Direction' : '方向'} ${'ABC'[i]}: ` : '') + cardText(x, en)).join('\n\n')
  if (list.length > 1) {
    return en
      ? `${cards}\n\nIf the user already chose a specific style or colors, follow them and do not use these cards. Otherwise: each direction keeps its own colors and fonts: write the variables inside that page's own <style>. Create the shared tokens.css only after the user has chosen. Do not swap them for a beige or cream look. Say briefly what style each direction is.`
      : `${cards}\n\n用户已经定了具体风格或配色的话，照用户的来，不用这些卡。否则：每个方向用各自的配色和字体，变量写在各自页面的 <style> 里；用户挑定以后再建公共的 tokens.css。别换成米色、奶油底。用一两句话说清每个方向是什么风格。`
  }
  return en
    ? `${cards}\n\nIf the user already chose a specific style or colors, follow them and do not use this card. Otherwise: put these colors and fonts into tokens.css first and build the whole set with them. Do not swap them for a beige or cream look. In your first sentence, tell the user which style you are using; it is easy to change if they do not like it.`
    : `${cards}\n\n用户已经定了具体风格或配色的话，照用户的来，不用这张卡。否则：先把这些配色和字体定进 tokens.css，整套照它做，别换成米色、奶油底。第一句话告诉用户用的是哪个风格，不喜欢可以换。`
}
