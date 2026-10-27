/**
 * 设计技能、拆开的几行、设计模式的测试（不用开 DSH）：
 *   node test/test-skill.mjs
 *
 * 技能文件都在、提到的参考文件都有；提供者交出来的东西过得了 DSH 技能服务的校验；
 * 技能那行（DSH 有技能服务时）把提供者挂上；工具那行挂 preview_page 和 check_design，工作台没开时说清楚；
 * check_design 经轮询（checkReq）交给右侧栏、右侧栏 POST /api/check 交回来，右侧栏没开就超时说明；
 * 自动打开预览那行开关得了；bundle patch 里每行都对得上包的入口，设计模式带齐标准模式的插件和这两行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import os from 'node:os'
import { parseTarget } from '../lib/core.js'
import { apply, skillProvider, designSkill, previewTool, checkTool, studio } from '../lib/index.js'
import * as skillRow from '../lib/skill.js'
import * as toolRow from '../lib/tool.js'
import * as autoRow from '../lib/auto.js'
import DesignPreset from '../lib/preset.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

const dir = designSkill.resourceBase.path
const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
check('SKILL.md 在', body.length > 1000)
const refs = [...new Set(body.match(/references\/[\w-]+\.md/g) || [])]
check('提到的参考文件都在', refs.length >= 5 && refs.every((r) => fs.existsSync(path.join(dir, r))), refs.join(','))
check('六种类型都讲到', ['web', 'app', 'tablet', 'poster', 'slides', 'email'].every((k) => body.includes('`' + k + '`')))
check('起手的设计变量模板在', /--color-primary/.test(fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8')))

// 按 DSH 技能服务（dsh-skill）的校验规则过一遍
const list = await skillProvider.list()
const c = list[0]
check('名字是短横线小写', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name))
check('候选项字段齐全', c.description.length > 0 && typeof c.source === 'string' && Number.isFinite(c.rank) && c.provider === skillProvider.name &&
  typeof c.invocation.modelInvocable === 'boolean' && typeof c.invocation.userInvocable === 'boolean')
const def = await skillProvider.get(c)
check('载入的内容就是 SKILL.md，带资源目录', def.content === body && def.resourceBase.kind === 'directory' && def.name === c.name && def.provider === c.provider)

// 技能那行：有技能服务就挂上
const mounted = []
const fake = (withSkills) => ({
  logger: { warn: () => {} },
  effect: () => {},
  webServer: { register: () => () => {}, getOrigin: () => 'http://127.0.0.1:1' },
  tools: { register: () => {} },
  on: () => {},
  get: () => null,
  inject: (deps, fn) => { if (withSkills && deps.includes('skills')) fn({ skills: { registerProvider: (f) => mounted.push(f({ invalidate() {} })) } }) },
})
skillRow.apply(fake(true))
check('DSH 有技能服务 → 挂上设计技能', mounted.length === 1 && mounted[0] === skillProvider)
let threw = false
try { skillRow.apply(fake(false)) } catch { threw = true }
check('没有技能服务也照常启动', !threw && mounted.length === 1)
apply(fake(true))
check('工作台本体不再自己挂技能（交给技能那行）', mounted.length === 1)

// 工具那行：挂 preview_page；工作台关着时调用会说清楚
const tools = []
toolRow.apply({ tools: { register: (t) => tools.push(t) } })
check('工具那行挂上 preview_page、check_design、look_design', tools.length === 3 && tools[0].name === 'preview_page' && tools[0].parameters.required.includes('target') && tools[1].name === 'check_design' && tools[2].name === 'look_design')
const saved = studio.tracker
studio.tracker = null
let msg = ''
try { await previewTool.execute({ target: '/tmp/x.html' }, { agent: { session: { id: 's1' } } }) } catch (e) { msg = e.message }
check('工作台关着 → 提示去插件页打开', /插件页/.test(msg), msg)
msg = ''
try { await checkTool.execute({}, { agent: { session: { id: 's1' } } }) } catch (e) { msg = e.message }
check('工作台关着 → 体检也提示去插件页打开', /插件页/.test(msg), msg)
studio.tracker = saved

// check_design 走一圈：模型调工具 → 轮询里出现 checkReq → 右侧栏交回结果 → 工具拿到那段字
{
  const routes = {}
  const disposers = []
  apply({
    logger: { warn: () => {} },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    webServer: { register: (r) => { routes[r.path.split('/').pop()] = r.handler; return () => {} }, getOrigin: () => 'http://127.0.0.1:1' },
    tools: { register: () => {} },
    on: () => {},
    get: () => null,
  })
  const call = (name, method, url, body) => new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    Object.assign(req, { method, url, headers: { host: '127.0.0.1:1' }, socket: { remoteAddress: '127.0.0.1' } })
    const res = { headersSent: false, writeHead(code) { this.code = code; this.headersSent = true }, end(s) { resolve({ code: this.code, body: JSON.parse(s) }) } }
    routes[name](req, res)
  })
  const exec = { agent: { session: { id: 'sCk' } } }
  const realTracker = studio.tracker
  // 这一段测右侧栏那条路：当这台电脑上没有无头浏览器（有浏览器的那条路见 test-look.mjs）
  const realBrowser = studio.browser
  check('工作台起来时备好无头浏览器（用到才开）', !!realBrowser && typeof realBrowser.withPage === 'function' && realBrowser.running() === false)
  studio.browser = null
  studio.tracker = { snapshot: () => ({ url: '' }) }
  const none = await checkTool.execute({}, exec)
  check('check_design：还没预览 → 让模型先调 preview_page', /preview_page/.test(none.text), none.text)
  studio.tracker = { snapshot: () => ({ url: 'http://127.0.0.1:9/home.html' }) }
  const pending = checkTool.execute({}, exec)
  studio.tracker = realTracker
  const st1 = await call('state', 'GET', '/dsh-design-studio/api/state?session=sCk')
  const id = st1.body.checkReq
  check('check_design：轮询里出现 checkReq', typeof id === 'string' && id.length > 0, JSON.stringify(st1.body))
  const other = await call('state', 'GET', '/dsh-design-studio/api/state?session=sOther')
  check('check_design：别的会话的轮询里没有', other.body.checkReq === undefined)
  const wrong = await call('check', 'POST', '/dsh-design-studio/api/check', { session: 'sCk', id: 'nope', text: 'x' })
  check('check_design：对不上号的结果不收', wrong.body.ok === false)
  const held = await call('check', 'POST', '/dsh-design-studio/api/check', { session: 'sCk', id, text: 'home：没量成（timeout）', measured: 0 })
  const st1b = await call('state', 'GET', '/dsh-design-studio/api/state?session=sCk')
  check('check_design：一屏都没量到的结果先记着，接着等别的右侧栏', held.body.held === true && st1b.body.checkReq === id, JSON.stringify(held.body))
  const right = await call('check', 'POST', '/dsh-design-studio/api/check', { session: 'sCk', id, text: '量了 3 屏，发现 1 个问题：…', measured: 3 })
  const got = await pending
  check('check_design：右侧栏交回的那段字就是工具结果', right.body.ok === true && got.text === '量了 3 屏，发现 1 个问题：…', JSON.stringify(got))
  const st2 = await call('state', 'GET', '/dsh-design-studio/api/state?session=sCk')
  check('check_design：交回以后 checkReq 就没了', st2.body.checkReq === undefined)
  const late = await studio.check('sLate', 50)
  check('check_design：右侧栏没开 → 超时给空，工具说明量不了', late === null)
  const viaTool = await (async () => {
    const real = studio.check
    studio.check = (sid) => real(sid, 50)
    studio.tracker = { snapshot: () => ({ url: 'http://127.0.0.1:9/home.html' }) }
    try { return await checkTool.execute({}, { agent: { session: { id: 'sLate2' } } }) } finally { studio.check = real; studio.tracker = realTracker }
  })()
  check('check_design：右侧栏没开 → 让模型照自查清单自己看', /没开着/.test(viaTool.text) && /自查/.test(viaTool.text), viaTool.text)
  const noReply = await (async () => {
    const real = studio.check
    studio.check = (sid) => real(sid, 300)
    studio.tracker = { snapshot: () => ({ url: 'http://127.0.0.1:9/home.html' }) }
    try {
      const p = checkTool.execute({}, { agent: { session: { id: 'sDead' } } })
      const st = await call('state', 'GET', '/dsh-design-studio/api/state?session=sDead')
      await call('check', 'POST', '/dsh-design-studio/api/check', { session: 'sDead', id: st.body.checkReq, text: 'home：没量成（timeout）', measured: 0 })
      return await p
    } finally { studio.check = real; studio.tracker = realTracker }
  })()
  check('check_design：右侧栏开着但预览没回应 → 到点说清楚没量成', /没回应/.test(noReply.text), noReply.text)
  // 调样式找行号：浏览器给的规则（样式表地址 + 选择器 + 第几条）→ 项目里的文件和行号
  {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locate-')))
    fs.mkdirSync(path.join(dir, '样式'))
    fs.writeFileSync(path.join(dir, '样式', 'app.css'), '.a{}\n.btn {\n  color: red\n}\n')
    fs.writeFileSync(path.join(dir, 'home.html'), '<style>\n.btn{padding:0}\n</style>')
    await realTracker.setTarget('sLoc', parseTarget(path.join(dir, 'home.html')), { source: 'tool' })
    const o = realTracker.snapshot('sLoc').origin
    const r = await call('locate', 'POST', '/x', { session: 'sLoc', items: [
      { href: `${o}/${encodeURIComponent('样式')}/app.css`, sel: '.btn', n: 0 }, { href: `${o}/home.html`, sel: '.btn', n: 0 }, { href: `${o}/home.html`, sel: '.nope', n: 0 },
      { href: 'http://evil.example/x.css', sel: '.btn', n: 0 }, { href: `${o}/__dsh_design__/picker.js`, sel: '.btn', n: 0 }, { href: `${o}/../../etc/passwd`, sel: 'x', n: 0 },
    ] })
    const it = r.body.items || []
    check('调样式找行号：样式表（中文目录）和页面里的 <style> 都找到行号', it[0] && it[0].file === '样式/app.css' && it[0].line === 2 && it[1] && it[1].file === 'home.html' && it[1].line === 2, JSON.stringify(it))
    check('调样式找行号：找不到的给文件不给行号；别的地址、插件自己的、跑出目录的一律不管', it[2] && it[2].line === 0 && it[3] === null && it[4] === null && (it[5] === null || it[5].line === 0), JSON.stringify(it))
    const none = await call('locate', 'POST', '/x', { session: 'nobody', items: [{ href: `${o}/home.html`, sel: '.btn', n: 0 }] })
    check('调样式找行号：别的会话（没开着预览）一律给空', JSON.stringify(none.body.items) === '[null]', JSON.stringify(none.body))
    fs.rmSync(dir, { recursive: true, force: true })
  }
  studio.tracker = { snapshot: () => ({ url: 'http://127.0.0.1:9/home.html' }) }
  const t0 = Date.now()
  const waiting = checkTool.execute({}, exec)
  studio.browser = realBrowser
  disposers.forEach((d) => d())
  const stopped = await waiting
  studio.tracker = realTracker
  check('check_design：插件停掉时等着的体检马上返回', Date.now() - t0 < 1000 && /没开着/.test(stopped.text) && studio.check === null, stopped.text)
  check('插件停掉时无头浏览器也收走', studio.browser === null)
}

// 自动打开预览那行：开着 +1，关掉还原
const effects = []
const before = studio.autoOpen
autoRow.apply({ effect: (fn) => effects.push(fn()) })
check('自动打开预览那行开着', studio.autoOpen === before + 1)
effects.forEach((d) => d())
check('关掉就还原', studio.autoOpen === before)

// bundle patch：每行的入口包里都有；设计模式带齐标准模式的插件
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').replace(/\r\n/g, '\n') // Windows 上签出可能是 CRLF
const rowNames = [...patch.matchAll(/^\s+name: '?(dsh-design-studio[^'\s]*)'?$/gm)].map((m) => m[1])
check('patch 里的几行都能从包里找到', rowNames.length >= 6 && rowNames.every((n) => n === 'dsh-design-studio' || pkg.exports['./' + n.split('/')[1]]), rowNames.join(','))
for (const sub of ['auto', 'tool', 'skill', 'preset']) {
  const ok = ['zh', 'en'].every((l) => {
    const f = pkg.exports[`./${sub}/locale/*.json`]
    const meta = f && JSON.parse(fs.readFileSync(path.join(root, f.replace('*', l)), 'utf8')).meta
    return meta && meta.title && meta.description
  })
  check(`${sub} 那行有中英文名字和说明`, ok)
}
check('有设计模式', /- id: preset-design\n\s+name: dsh-design-studio\/preset\n/.test(patch) && /\n\s+id: design\n/.test(patch))
const need = ['dsh-persona', 'dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-tool-fs', 'dsh-tool-fs-search', 'dsh-skill-filesystem', 'dsh-tool-skill', 'dsh-plan-mode', 'dsh-compaction-basic', 'dsh-tool-subagent', 'dsh-tool-ask-user', 'dsh-tool-todo', 'dsh-tool-web']
check('设计模式带齐标准模式的工具', need.every((n) => patch.includes(`'@deepseek-ai/${n}'`)))
check('设计模式挂了预览工具和设计技能', /name: dsh-design-studio\/tool\n\s+- id: design-skill\n\s+name: dsh-design-studio\/skill\s*$/.test(patch))
// 设计模式那行自己不引 @deepseek-ai/*（用 link: 装在 DSH 目录外面时找不到），照官方预设的样子注册
{
  const src = fs.readFileSync(path.join(root, 'lib', 'preset.js'), 'utf8')
  check('设计模式那行不引 DSH 的包', !/from\s+['"]@deepseek-ai\//.test(src))
  const got = []
  const off = () => { got.push('off') }
  const cfg = { id: 'design', plugins: [] }
  const it = new DesignPreset({ agentPresets: { register: async (c) => { got.push(c); return off } } }, cfg)[Symbol.for('cordis.init')]()
  const first = await it.next()
  check('设计模式按官方预设的方式注册、交出反注册', got[0] === cfg && first.value === off && DesignPreset.inject.includes('agentPresets') && DesignPreset[Symbol.for('cordis.group')] === true)
}
// 装好的 DSH 里有的话，拿它的标准模式比一比：少了哪个插件
try {
  const req = createRequire(import.meta.url)
  const std = fs.readFileSync(req.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml'), 'utf8')
  const names = (t) => new Set([...t.matchAll(/name: '(@deepseek-ai\/[^']+)'/g)].map((m) => m[1]))
  const mine = names(patch)
  const missing = [...names(std)].filter((n) => !mine.has(n) && n !== '@deepseek-ai/dsh-agent-preset')
  check('和装好的 DSH 标准模式一致', missing.length === 0, missing.join(','))
} catch { /* 没装 DSH 就不比 */ }

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
