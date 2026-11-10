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
check('一长串空格不卡', (() => { const t0 = Date.now(); autoStyle('风格' + ' '.repeat(50000) + '，做个 App', 'app'); return Date.now() - t0 < 500 })())
const three = pickStyles('做个记账 App', 'app', 3)
check('要三个方向：三张不同的卡，都不是米色系', three.length === 3 && new Set(three).size === 3 && three.every((x) => !BEIGE.includes(x.id)), three.map((x) => x.id).join())
check('几个方向：变量写在各自页面，选定后才建 tokens.css；一个方向还是先定 tokens.css', /各自页面/.test(pickStyleText('做个记账 App', 'app', 3)) && !/先把这些配色/.test(pickStyleText('做个记账 App', 'app', 3)) && /先把这些配色/.test(pickStyleText('做个记账 App', 'app', 1)))
check('要三个方向：字里分 A、B、C', ['方向 A', '方向 B', '方向 C'].every((x) => pickStyleText('做个记账 App', 'app', 3).includes(x)))
check('方向数夹在 1 到 3', pickStyles('做个记账 App', 'app', 0).length === 1 && pickStyles('做个记账 App', 'app', 9).length === 3 && pickStyles('做个记账 App', 'app', 'x').length === 1)
const en = pickStyleText('A habit tracker app for runners', 'app')
check('英文题目：整段英文', en.startsWith('Sport:') && en.includes('tokens.css') && !/[一-鿿]/.test(en), en)
check('工具：subject 必填', /不能空/.test((await styleTool.execute({})).text) && /不能空/.test((await styleTool.execute({ subject: '  ' })).text))
check('工具：返回挑好的卡', (await styleTool.execute({ subject: '奶茶店点单小程序', kind: 'miniprogram' })).text.startsWith('活泼年轻——'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
