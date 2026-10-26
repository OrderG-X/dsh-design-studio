/**
 * 设计技能、拆开的几行、设计模式的测试（不用开 DSH）：
 *   node test/test-skill.mjs
 *
 * 技能文件都在、提到的参考文件都有；提供者交出来的东西过得了 DSH 技能服务的校验；
 * 技能那行（DSH 有技能服务时）把提供者挂上；工具那行挂 preview_page，工作台没开时说清楚；
 * 自动打开预览那行开关得了；bundle patch 里每行都对得上包的入口，设计模式带齐标准模式的插件和这两行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { apply, skillProvider, designSkill, previewTool, studio } from '../lib/index.js'
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
check('工具那行挂上 preview_page', tools.length === 1 && tools[0].name === 'preview_page' && tools[0].parameters.required.includes('target'))
const saved = studio.tracker
studio.tracker = null
let msg = ''
try { await previewTool.execute({ target: '/tmp/x.html' }, { agent: { session: { id: 's1' } } }) } catch (e) { msg = e.message }
check('工作台关着 → 提示去插件页打开', /插件页/.test(msg), msg)
studio.tracker = saved

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
