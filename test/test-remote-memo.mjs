/**
 * 远程看（手机走外网 / 别的电脑打开 DSH 网页）的页面端打包缓存（不用开 DSH）：
 *   node test/test-remote-memo.mjs
 *
 * 用一个最小的 hooks 夹具把 lib/client.js 里的 Screen 跑起来，假 fetch 控制回包的内容和先后：
 * 换目录不串、强刷覆盖同一条、信任变了（退回旧版 / 别的会话）不再用没加规矩的包、在途旧回包被拒收、
 * 错目标回包不显示不存、晚到的旧回包不盖强刷结果、卸载 / 换页 / 刷新时排着的定时器作废。
 */
import fs from 'node:fs'

const raw = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
// 远程看的页面端缓存在 Screen 里，不对外：测试时把它们临时挂到 _test 上
const source = raw.replace('exports._test = {', 'exports._test = { Screen, bundleOf, memoKeyOf, memoPut, memoGet, memoDrop, bundleMemo, memoReset, memoInvalidate,')
if (source === raw) { console.log('✗ client.js 里找不到 exports._test'); process.exit(1) }
let active
let mod
const hook = (factory) => {
  const i = active.i++
  return active.slots[i] ||= factory()
}
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    const s = hook(() => ({ v: typeof init === 'function' ? init() : init }))
    return [s.v, (v) => { s.v = typeof v === 'function' ? v(s.v) : v }]
  },
  useRef: (v = null) => hook(() => ({ current: v })),
  useEffect: (fn, deps) => {
    const s = hook(() => ({ deps: null, cleanup: null }))
    if (!s.deps || !deps || deps.some((v, i) => v !== s.deps[i])) {
      active.effects.push(() => { s.cleanup?.(); s.cleanup = fn() })
      s.deps = deps
    }
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useLayoutEffect: () => {},
}
globalThis.location = new URL('https://dsh.example')
globalThis.window = {
  __ModuleLoader__: { load: ({ factory }) => { mod = factory((name) => name === 'react' ? react : null) } },
  addEventListener() {},
  removeEventListener() {},
}
new Function(source)()
const { Screen, memoKeyOf, memoPut, memoGet, memoDrop, bundleMemo, memoReset } = mod._test
const instance = (props) => ({ props, slots: [], i: 0, effects: [] })
function render(inst) {
  active = inst
  inst.i = 0
  inst.effects = []
  const tree = Screen(inst.props)
  for (const effect of inst.effects) effect()
  return tree
}
function unmount(inst) {
  for (const slot of inst.slots) slot.cleanup?.()
}
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
const frames = (tree) => tree.children.flat(Infinity)
  .filter((node) => node?.type === 'iframe').map((node) => ({ html: node.props.srcDoc, sandbox: node.props.sandbox }))
const life = (inst) => inst.slots.find((slot) => slot.current?.seeds)?.current
const clearMemo = () => { for (const key of bundleMemo.keys()) memoDrop(key) }

const src = 'http://127.0.0.1:41001/index.html'
const ORIGIN = 'http://127.0.0.1:41001'
const base = { sid: 's', root: '/design/A', at: 0, trust: 'T1', changes: [] }
const props = (r = base, url = src) => ({ src: url, remote: r, reloadSeq: 0 })
const keyAt = (r) => `${r.at || 0}:${r.trust}`
const put = (html, r = base, url = src, strict = false) => memoPut(memoKeyOf(url, r), keyAt(r), html, ['index.html'], strict)
const last = (inst) => frames(render(inst)).at(-1)

let requests = []
let reply = () => ({ html: 'NEW', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN })
globalThis.fetch = async (url) => {
  requests.push(url)
  const d = await reply(url)
  return { ok: true, json: async () => d }
}
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) } }

// 1. 退回旧版后：memoReset 让当前页不再用留着的非 strict 包
clearMemo(); requests = []
put('OLD_NONSTRICT')
memoReset()
reply = () => ({ html: 'STRICT', strict: true, deps: ['index.html'], root: '/design/A', origin: ORIGIN })
const a = instance(props())
render(a); await wait()
ok('退回后（状态还是旧指纹）：不用留着的包，去服务端取', requests.length === 1 && last(a).html === 'STRICT', JSON.stringify({ n: requests.length, f: last(a) }))
unmount(a)

// 2. 已挂着的屏：信任指纹变了 → 重取
clearMemo(); requests = []
put('OLD_NONSTRICT')
const b = instance(props())
render(b); await wait()
ok('挂上时用留着的包（零请求）', requests.length === 0 && last(b).html === 'OLD_NONSTRICT')
life(b).loading = 0
b.props = props({ ...base, trust: 'T2' })
render(b); await wait(); await wait(500)
ok('轮询到新指纹：已挂着的屏重取', requests.length === 1 && /fresh=1/.test(requests[0]) && last(b).html === 'STRICT', JSON.stringify({ r: requests, f: last(b) }))
unmount(b)

// 3. 别的会话：留着的包是旧指纹存的，新指纹下重新打开 → 不命中
clearMemo(); requests = []
put('OLD_NONSTRICT')
const c = instance(props({ ...base, trust: 'T2' }))
render(c); await wait()
ok('别的会话（新指纹）重新打开：不用旧包', requests.length === 1 && last(c).html === 'STRICT')
unmount(c)

// 4. 请求发出后服务端换了目录：回包是 B 的，不能存到 A 的键下
clearMemo(); requests = []
reply = () => ({ html: 'FROM_B', strict: false, deps: ['index.html'], root: '/design/B', origin: 'http://127.0.0.1:41002' })
const d = instance(props())
render(d); await wait()
ok('错序回包（B 的内容）没进 A 的缓存', !memoGet(memoKeyOf(src, base), keyAt(base)), String(bundleMemo.size))
unmount(d)
reply = () => ({ html: 'NEW', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN })
const d2 = instance(props())
render(d2); await wait()
ok('切回 A：去服务端取，不显示 B', requests.length === 2 && last(d2).html === 'NEW')
unmount(d2)

// 5. 晚到的旧回包不盖强刷结果：X 普通请求挂着，Y 强刷先回来，X 后回来
clearMemo(); requests = []
let releaseOld
reply = (url) => /fresh=1/.test(url)
  ? { html: 'NEW_AFTER_REFRESH', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
  : new Promise((r) => { releaseOld = () => r({ html: 'OLD_LATE_REPLY', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }) })
const x = instance(props())
render(x); await wait()
const y = instance(props())
render(y); await wait()
life(y).loading = 0
y.props = { ...y.props, reloadSeq: 1 }
render(y); await wait(500)
ok('强刷换上了新内容', last(y).html === 'NEW_AFTER_REFRESH', JSON.stringify(last(y)))
releaseOld(); await wait()
const z = instance(props())
render(z); await wait()
ok('X 的旧回包晚到也没盖掉：再打开是强刷的内容', last(z).html === 'NEW_AFTER_REFRESH', JSON.stringify({ f: last(z), n: requests.length }))

// 6. 卸载后的旧回包：同上，X 卸载了再回来
clearMemo(); requests = []
const x2 = instance(props())
render(x2); await wait()
unmount(x2)
releaseOld(); await wait()
ok('卸载后回来的回包不写缓存', bundleMemo.size === 0, String(bundleMemo.size))

// 7. 在途请求按旧信任打包，回来前信任变了：不显示、不存，按新信任重取
clearMemo(); requests = []
let releaseT1
reply = (url) => requests.length === 1
  ? new Promise((r) => { releaseT1 = () => r({ html: 'T1_NONSTRICT', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }) })
  : { html: 'T2_STRICT', strict: true, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
const e = instance(props())
render(e); await wait()
e.props = props({ ...base, trust: 'T2' })
render(e); await wait()
releaseT1(); await wait(100)
const ef = frames(render(e))
ok('信任变了：旧信任的在途回包没显示，重取到加规矩的那份', !ef.some((f) => f.html === 'T1_NONSTRICT') && ef.at(-1)?.html === 'T2_STRICT' && requests.length === 2, JSON.stringify({ ef, n: requests.length }))
ok('旧信任的回包也没进缓存', ![...bundleMemo.values()].some((v) => v.html === 'T1_NONSTRICT'))
unmount(e)

// 8. 强刷在途时又挂上同一屏（比如切到多尺寸）：这次也强取，不发普通请求（普通请求可能先到服务端拿到旧包）
clearMemo(); requests = []
const pend = []
reply = (url) => /fresh=1/.test(url)
  ? new Promise((r) => pend.push(() => r({ html: 'F_NEW', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN })))
  : { html: 'N_OLD', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
const f1 = instance(props())
render(f1); await wait()
life(f1).loading = 0
f1.props = { ...f1.props, reloadSeq: 1 }
render(f1); await wait(500) // 强刷 F 发出，挂着
const n1 = instance(props())
render(n1); await wait()
ok('强刷在途时新挂上的同一屏也强取', /fresh=1/.test(requests.at(-1)) && requests.length === 3, JSON.stringify(requests))
for (const go of pend) go()
await wait()
ok('两份都回来后：缓存里是新内容，新挂上的那屏显示新内容', memoGet(memoKeyOf(src, base), keyAt(base))?.html === 'F_NEW' && frames(render(n1)).at(-1)?.html === 'F_NEW')
unmount(f1); unmount(n1)

// 9. 回包是别的目录的：不显示，重取到自己的再显示
clearMemo(); requests = []
reply = () => requests.length === 1
  ? { html: 'FROM_B', strict: false, deps: ['index.html'], root: '/design/B', origin: 'http://127.0.0.1:41002' }
  : { html: 'BACK_TO_A', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
const g = instance(props())
render(g); await wait(); await wait(500)
const gf = frames(render(g))
ok('别的目录的回包不显示；重取后显示自己的', !gf.some((x) => x.html === 'FROM_B') && gf.at(-1)?.html === 'BACK_TO_A' && requests.length === 2, JSON.stringify({ gf, n: requests.length }))
unmount(g)

// 10. 一直对不上：重取三回后当没取回来（显示「没取回来」），不显示错目录的内容、不存
clearMemo(); requests = []
reply = () => ({ html: 'ALWAYS_B', strict: false, deps: ['index.html'], root: '/design/B', origin: ORIGIN })
const h1 = instance(props())
render(h1); await wait(2500)
const htree = render(h1)
ok('一直对不上：重取三回后不显示、显示没取回来、不进缓存', frames(htree).length === 0 && requests.length === 4 && bundleMemo.size === 0 && JSON.stringify(htree).includes('ddp-away'), JSON.stringify({ n: requests.length, m: bundleMemo.size }))
unmount(h1)

// 11. 首次加载的定时器还没跑就卸载：不发请求
clearMemo(); requests = []
reply = () => ({ html: 'X', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN })
const k = instance(props())
render(k)
unmount(k)
await wait(50)
ok('首次加载前就卸载：不发请求、不写缓存', requests.length === 0 && bundleMemo.size === 0, String(requests.length))

// 12. 旧信任的帧已经加进来、还没换上（页面没回话），信任变了：撤掉它，不靠页面回话也会重取
clearMemo(); requests = []
put('PENDING_NONSTRICT')
reply = () => ({ html: 'T2_STRICT', strict: true, deps: ['index.html'], root: '/design/A', origin: ORIGIN })
const m = instance(props())
render(m); await wait()
ok('夹具：旧帧加进来了、还在等换上（loading 未清）', frames(render(m)).some((x) => x.html === 'PENDING_NONSTRICT') && life(m).loading > 0)
m.props = props({ ...base, trust: 'T2' })
render(m); await wait(600)
const mf = frames(render(m))
ok('信任变了：没换上的旧帧撤掉，重取到加规矩的那份', !mf.some((x) => x.html === 'PENDING_NONSTRICT') && mf.at(-1)?.html === 'T2_STRICT' && requests.length === 1, JSON.stringify({ mf, n: requests.length }))
unmount(m)

// 13. 空指纹 → 有指纹：也当作变了（之前显示的帧可能没核对过信任）
clearMemo(); requests = []
const q = instance(props({ ...base, trust: '' }))
render(q); await wait()
life(q).loading = 0
const n0 = requests.length
q.props = props({ ...base, trust: 'T2' })
render(q); await wait(600)
ok('空指纹 → 有指纹：重取一次', requests.length === n0 + 1, String(requests.length - n0))
unmount(q)

// 14. 正在显示没加规矩的帧，信任变了、重取又失败：立刻撤下，显示「没取回来」，不让旧脚本接着跑
clearMemo(); requests = []
put('SHOWN_NONSTRICT')
const w = instance(props())
render(w); await wait()
life(w).loading = 0
reply = () => { throw new Error('offline') }
w.props = props({ ...base, trust: 'T2' })
render(w); await wait(50)
const wtree = render(w)
ok('信任变了：没加规矩的帧立刻撤下', !frames(wtree).some((x) => x.html === 'SHOWN_NONSTRICT'), JSON.stringify(frames(wtree)))
ok('重取失败：显示没取回来', JSON.stringify(wtree).includes('ddp-away'), JSON.stringify(wtree).slice(0, 200))
unmount(w)

// 15. 错目标排了 300ms 重试，期间用户刷新成功：旧重试不再多取一次
clearMemo(); requests = []
reply = () => requests.length === 1
  ? { html: 'FROM_B', strict: false, deps: ['index.html'], root: '/design/B', origin: ORIGIN }
  : { html: 'A_OK', strict: false, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
const u = instance(props())
render(u); await wait() // 第一次回来是 B：拒收，排 300ms 重试
u.props = { ...u.props, reloadSeq: 1 }
render(u); await wait(100) // 用户点刷新（没有当前帧 → 立刻强取）
const n2 = requests.length
await wait(500)
ok('刷新成功后，排着的旧重试没再多取', requests.length === n2 && frames(render(u)).at(-1)?.html === 'A_OK', JSON.stringify({ before: n2, after: requests.length }))
unmount(u)

// 16. 之前连续失败到停了，信任变了：重试次数从头算，再失败一次还会重试
clearMemo(); requests = []
let failN = 0
reply = () => { failN++; throw new Error('offline') }
const v1 = instance(props())
render(v1); await wait(9500) // 首次 + 三次重试都失败（1.5s、3s、4.5s）
const stopped = requests.length
reply = () => requests.length === stopped + 1 ? (() => { throw new Error('blip') })() : { html: 'BACK', strict: true, deps: ['index.html'], root: '/design/A', origin: ORIGIN }
v1.props = props({ ...base, trust: 'T2' })
render(v1); await wait(2000)
ok('失败停下后信任变了：新一轮失败一次仍会重试并取回', requests.length === stopped + 2 && frames(render(v1)).at(-1)?.html === 'BACK', JSON.stringify({ stopped, n: requests.length }))
unmount(v1)

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
