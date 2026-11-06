/**
 * 设计库详情「实时看」：请求发出后换到新版（或别的一套），旧回包晚到也不能把旧页面写回来。
 * 用一个最小的 hooks 运行时（按调用顺序记状态）把 MarketDetail 渲染几遍。
 */
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
let slots = []
let idx = 0
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    const i = idx++
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init
    return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
  },
  useEffect: () => { idx++ },
  useRef: (v = null) => { const i = idx++; if (!(i in slots)) slots[i] = { current: v }; return slots[i] },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
let mod
globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { mod = factory((name) => (name === 'react' ? react : null)) } } }
globalThis.location = { origin: 'http://127.0.0.1:1' }
new Function(src)()
const { MarketDetail, makeT } = mod._test

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

// 假接口：mlive 的回包手动放行
const pending = []
globalThis.fetch = async (url, opt) => {
  const body = opt && opt.body ? JSON.parse(opt.body) : {}
  if (String(url).endsWith('mlive')) {
    return new Promise((ok) => pending.push({ body, reply: (data) => ok({ ok: true, json: async () => data }) }))
  }
  return { ok: true, json: async () => (String(url).includes('inspire') ? { items: [] } : {}) }
}

const t = makeT({})
const said = []
const base = { id: 'alice__matcha', type: 'template', rev: 'aaa111aaa111', kind: 'app', title: { zh: '抹茶' }, screens: [{ file: 'home.html' }], license: 'CC0-1.0', author: { login: 'alice' } }
const props = (e) => ({ t, e, onBack: () => {}, onUseTpl: async () => {}, onUseStyle: () => {}, onSay: (m) => said.push(m) })
const render = (e) => { idx = 0; return MarketDetail(props(e)) }
function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const x of node) { const f = find(x, pred); if (f) return f } return null }
  if (pred(node)) return node
  return find(node.children, pred)
}
const liveBtn = (tree) => find(tree, (n) => n.type === 'button' && n.children && n.children.includes(t('mkLive')))
const iframe = (tree) => find(tree, (n) => n.type === 'iframe')
const tick = () => new Promise((ok) => setTimeout(ok, 0))

// 1) 同一套出了新版：旧请求晚到 → 丢掉
let tree = render(base)
liveBtn(tree).props.onClick()
await tick()
check('点「实时看」发出了请求（带版本）', pending.length === 1 && pending[0].body.rev === base.rev, JSON.stringify(pending.map((p) => p.body)))
const v2 = { ...base, rev: 'bbb222bbb222' }
tree = render(v2) // 目录刷新：详情换成新版
pending.shift().reply({ origin: 'http://127.0.0.1:9', screens: ['home.html'], id: base.id, rev: base.rev })
await tick()
tree = render(v2)
check('换了新版后旧回包晚到：不显示旧页面', !iframe(tree), JSON.stringify(iframe(tree)))

// 2) 正常：回包和当前版本一致 → 显示
liveBtn(tree).props.onClick()
await tick()
pending.shift().reply({ origin: 'http://127.0.0.1:9', screens: ['home.html'], id: v2.id, rev: v2.rev })
await tick()
tree = render(v2)
check('版本对得上：显示实时页面', !!iframe(tree) && iframe(tree).props.src === 'http://127.0.0.1:9/home.html')

// 3) 换到别的一套：旧请求晚到 → 丢掉
slots = []
tree = render(base)
liveBtn(tree).props.onClick()
await tick()
const other = { ...base, id: 'bob__other', rev: 'ccc333ccc333' }
tree = render(other)
pending.shift().reply({ origin: 'http://127.0.0.1:9', screens: ['home.html'], id: base.id, rev: base.rev })
await tick()
tree = render(other)
check('换到别的一套后旧回包晚到：不显示', !iframe(tree))

// 4) 用户还停在旧版，但服务端已经换成新版（回包版本不同）：不显示，并提示
slots = []
said.length = 0
tree = render(base)
liveBtn(tree).props.onClick()
await tick()
pending.shift().reply({ origin: 'http://127.0.0.1:9', screens: ['home.html'], id: base.id, rev: 'ddd444ddd444' })
await tick()
tree = render(base)
check('回包是另一版：不显示，提示刚出了新版', !iframe(tree) && said.some((m) => m.includes(t('mkErr_stale'))), JSON.stringify(said))

console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
