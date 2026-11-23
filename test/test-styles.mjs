/**
 * pick_style：按题材挑风格卡、给模型的字带全套、定没定风格由模型判断
 *   node test/test-styles.mjs
 */
import { STYLES, autoStyle, pickStyles, pickStyleText } from '../lib/styles.js'
import { styleTool } from '../lib/index.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const BEIGE = ['warm', 'cream', 'japandi', 'ink']
const id = (s, k, n) => (pickStyles(s, k, n) || []).map((x) => x.id).join()

check('按题材挑卡', id('做一个城市民宿预订 App', 'app') === 'fresh' && id('奶茶店点单小程序', 'miniprogram') === 'playful' && id('季度业务复盘幻灯片', 'slides') === 'swiss', [id('做一个城市民宿预订 App', 'app'), id('奶茶店点单小程序', 'miniprogram'), id('季度业务复盘幻灯片', 'slides')].join(' / '))
const text = pickStyleText('做一个城市民宿预订 App', 'app')
const fresh = STYLES.find((x) => x.id === 'fresh')
check('给模型的字带全套：名字、配色、字体、形状、要点、要它定进 tokens.css', text.startsWith(`${fresh.zh}——`) && text.includes(fresh.c.bg) && text.includes(fresh.c.primary) && text.includes(`圆角 ${fresh.radius}px`) && text.includes(fresh.nzh) && text.includes('tokens.css'), text)
check('pick_style 听模型的：调了就给卡，回话提醒用户定了就照用户的', pickStyles('做民宿 App，先出三个不同风格给我挑', 'app', 3)?.length === 3 && pickStyles('帮我推荐一下风格，做奶茶店小程序', 'miniprogram')?.length === 1 && /照用户的来/.test(pickStyleText('民宿 App，配色选蓝白', 'app')) && /照用户的来/.test(pickStyleText('民宿 App，配色选蓝白', 'app', 3)) && /follow them/.test(pickStyleText('a hotel app in a brutalist style', 'app')))
// 真实用户会打的说法：首页只允许一种错——宁可不附卡（模型自己会调 pick_style），不能盖掉用户说的
for (const s of ['暖色自然风的民宿小程序', '做个北欧风的民宿 App', '民宿 App，配色定为蓝白', '做一个民宿 App，配色选蓝白', '风格选黑白极简，做个民宿 App', 'a hotel app in a brutalist style', '先出三个不同风格给我挑，做民宿 App', '帮我推荐个风格，做民宿 App', '风格你定，做民宿 App', '风格你定，主要用蓝色', '配色随便，但要深色', 'a hotel app, any style', '做个深色的记账 App', '整体蓝白的民宿 App', '黑金的酒吧海报', '白色为主的官网', 'a dark finance app']) check(`首页自动：不附卡，交给模型：${s}`, autoStyle(s, 'app') === null)
for (const s of ['做一个城市民宿预订 App', '奶茶店点单小程序', '季度业务复盘幻灯片', 'A habit tracker app for runners']) check(`首页自动：没提风格就按题材附卡：${s}`, autoStyle(s, 'app') !== null)
check('说了感觉先按感觉挑：可爱的习惯打卡 App 挑可爱风，不落到随机的运动风；简约的记账 App 挑极简', autoStyle('帮我做一个可爱的习惯打卡 App', 'app')?.id === 'cute' && autoStyle('A cute habit tracker app', 'app')?.id === 'cute' && autoStyle('简约的记账 App', 'app')?.id === 'minimal' && autoStyle('跑步 App', 'app')?.id === 'sport')
check('没认出题材的随机兜底不给运动风（黑底荧光绿只给运动题材）', Array.from({ length: 300 }, (_, i) => autoStyle(`第 ${i} 号小工具 App`, 'app')?.id).every((x) => x && x !== 'sport') && pickStyles('做个记账 App', 'app', 3).every((x) => x.id !== 'sport'))
check('一长串空格不卡', (() => { const t0 = Date.now(); autoStyle('风格' + ' '.repeat(50000) + '，做个 App', 'app'); return Date.now() - t0 < 500 })())
const three = pickStyles('做个记账 App', 'app', 3)
check('要三个方向：三张不同的卡，都不是米色系', three.length === 3 && new Set(three).size === 3 && three.every((x) => !BEIGE.includes(x.id)), three.map((x) => x.id).join())
check('几个方向：变量写在各自页面，选定后才建 tokens.css；一个方向还是先定 tokens.css', /各自页面/.test(pickStyleText('做个记账 App', 'app', 3)) && !/先把这些配色/.test(pickStyleText('做个记账 App', 'app', 3)) && /先把这些配色/.test(pickStyleText('做个记账 App', 'app', 1)))
check('要三个方向：字里分 A、B、C', ['方向 A', '方向 B', '方向 C'].every((x) => pickStyleText('做个记账 App', 'app', 3).includes(x)))
check('方向数夹在 1 到 3', pickStyles('做个记账 App', 'app', 0).length === 1 && pickStyles('做个记账 App', 'app', 9).length === 3 && pickStyles('做个记账 App', 'app', 'x').length === 1)
const en = pickStyleText('A habit tracker app for runners', 'app')
check('英文题目：整段英文', en.startsWith('Sport:') && en.includes('tokens.css') && !/[一-鿿]/.test(en), en)
check('感觉词前面说了不要就不算：不要可爱 / 别做得太复古 / not too cute / 治愈率看板', autoStyle('做个跑步 App，界面不要可爱', 'app')?.id === 'sport' && autoStyle('咖啡店小程序，别做得太复古', 'miniprogram')?.id !== 'retro' && autoStyle('A running app, not too cute', 'app')?.id === 'sport' && autoStyle('肿瘤治愈率看板', 'web')?.id === 'tech' && autoStyle('可爱但不要太幼稚的记账 App', 'app')?.id === 'cute' && autoStyle('治愈系的日记 App', 'app')?.id === 'cute' && ['做个跑步 App，不想要太可爱', '做个跑步 App，界面别走可爱路线', '跑步 App，不要那种很可爱的', 'A running app, not a cute app', 'Running app, nothing cute'].every((x) => autoStyle(x, 'app')?.id === 'sport') && autoStyle('不要太暗，要可爱的记账 App', 'app')?.id === 'cute' && autoStyle('一款不一样的可爱记账 App', 'app')?.id === 'cute' && ['跑步 App，不那么可爱', '跑步 App，没那么可爱', '跑步 App，不希望太可爱', "A running app, I don't want it to look cute"].every((x) => autoStyle(x, 'app')?.id === 'sport') && ['特别可爱的记账 App', '告别拖延的可爱打卡 App', '非常可爱的记账 App', '不要太复杂但要可爱的记账 App'].every((x) => autoStyle(x, 'app')?.id === 'cute') && autoStyle('界面要特别简约的记账 App', 'app')?.id === 'minimal' && autoStyle('跑步 App，不要太可爱或者卡通', 'app')?.id === 'sport' && autoStyle('not cute but minimal', 'app')?.id === 'minimal' && ['跑步 App，不要 cute 的', 'A running app, it isn’t cute', 'A running app that doesn’t look cute'].every((x) => autoStyle(x, 'app')?.id === 'sport') && autoStyle('要 cute 一点的记账 App', 'app')?.id === 'cute' && ['跑步 App，不要太可爱、卡通', '跑步 App，别搞可爱、童趣那套', '跑步 App，不要做成那种特别可爱、卡通的样子', '做个跑步 App，不要做成那种很可爱、很卡通的样子'].every((x) => autoStyle(x, 'app')?.id === 'sport'))
check('工具：subject 必填', /不能空/.test((await styleTool.execute({})).text) && /不能空/.test((await styleTool.execute({ subject: '  ' })).text))
check('工具：返回挑好的卡', (await styleTool.execute({ subject: '奶茶店点单小程序', kind: 'miniprogram' })).text.startsWith('活泼年轻——'))
check('像申报书那种图：首页不附卡；pick_style 先说申报书图用炫酷样式、卡照给（「个税申报流程图」这种由模型照卡做）；别的照常只给卡', autoStyle('帮我画课题申报书的技术路线图，课题是《三环联动社区阅读推广模式研究》', 'diagram') === null && /申报书炫酷样式/.test(pickStyleText('课题申报书技术路线图：三环联动社区阅读推广', 'diagram')) && /配色：|Colors:/.test(pickStyleText('课题申报书技术路线图：三环联动社区阅读推广', 'diagram')) && /风格或配色/.test(pickStyleText('课题申报书技术路线图：三环联动社区阅读推广', 'diagram')) && /申报书炫酷样式/.test(pickStyleText('课题申报书技术路线图', '', 3)) && /方向 C/.test(pickStyleText('课题申报书技术路线图', '', 3)) && /proposal style/.test(pickStyleText('A research proposal roadmap', 'diagram')) && /配色：|Colors:/.test(pickStyleText('A research proposal roadmap', 'diagram')) && /申报书炫酷样式/.test(pickStyleText('个人所得税申报流程图', 'diagram')) && /配色：|Colors:/.test(pickStyleText('个人所得税申报流程图', 'diagram')) && /照卡做的那类：先把/.test(pickStyleText('课题申报书技术路线图：三环联动社区阅读推广', 'diagram')) && !/否则：/.test(pickStyleText('课题申报书技术路线图：三环联动社区阅读推广', 'diagram')) && /照卡做的那类：每个方向/.test(pickStyleText('课题申报书技术路线图', '', 3)) && /For the kinds that use the card: put/.test(pickStyleText('A research proposal roadmap', 'diagram')) && /否则：先把/.test(pickStyleText('零基础学 Python 思维导图', 'diagram')) && !/申报书炫酷样式/.test(pickStyleText('零基础学 Python 思维导图', 'diagram')) && !/申报书炫酷样式/.test(pickStyleText('课题申报管理系统', 'web')))
check('DSH 插件：首页不自动挑风格卡（默认用 DSH 的样子）；模型自己调 pick_style 照样给卡、几张都不报错', autoStyle('做一个番茄钟插件', 'dshplugin') === null && [undefined, 1, 2, 3].every((c) => pickStyleText('做一个番茄钟插件', 'dshplugin', c).length > 100))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
