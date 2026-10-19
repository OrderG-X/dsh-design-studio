/**
 * 设计技能的测试（不用开 DSH）：
 *   node test/test-skill.mjs
 *
 * 技能文件都在、提到的参考文件都有；提供者交出来的东西过得了 DSH 技能服务的校验；
 * 插件启动时（DSH 有技能服务）把提供者挂上。
 */
import fs from 'node:fs'
import path from 'node:path'
import { apply, skillProvider, designSkill } from '../lib/index.js'

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

// 插件启动：有技能服务就挂上
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
apply(fake(true))
check('DSH 有技能服务 → 挂上设计技能', mounted.length === 1 && mounted[0] === skillProvider)
let threw = false
try { apply(fake(false)) } catch { threw = true }
check('没有技能服务也照常启动', !threw && mounted.length === 1)

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
