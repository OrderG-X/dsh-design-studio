/**
 * 插件自带的离线种子（gallery-seed/）：断网、没有缓存目录时，设计库市场显示它；
 * 每种类型一套模板能「用这个开始」（文件、截图都核对得上），20 张风格卡都在，封面都在，都过落地检查
 *   node test/test-gallery-seed.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarket } from '../lib/gallery/market.js'
import { checkPack, KINDS, STYLE_IDS } from '../lib/gallery/policy.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

const seedDir = fileURLToPath(new URL('../gallery-seed', import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-seed-')))
try {
  check('种子目录在（发版前用内容仓库的 scripts/build-seed.mjs 出）', fs.existsSync(path.join(seedDir, 'index.json')))
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  check('种子跟着插件包发出去', pkg.files.includes('gallery-seed'))
  const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, x) => n + (x.isDirectory() ? size(path.join(d, x.name)) : fs.statSync(path.join(d, x.name)).size), 0)
  check('种子不超过 2MB', size(seedDir) <= 2 * 1024 * 1024, `${size(seedDir)}`)

  // 断网、没有签名钥匙、没有缓存：只能用种子
  const market = createMarket({ cacheDir: path.join(tmp, 'cache'), stateDir: path.join(tmp, 'state'), version: '0.11.0', registries: [], keys: [], seedDir, online: () => false })
  const v = market.view()
  check('断网没缓存：显示种子', v.source === 'seed', v.source)
  const kinds = v.designs.map((e) => e.kind).sort()
  check('每种类型一套模板', JSON.stringify(kinds) === JSON.stringify([...KINDS].sort()), JSON.stringify(kinds))
  check('20 张风格卡都在', v.styles.length === STYLE_IDS.length && STYLE_IDS.every((id) => v.styles.some((s) => s.style && s.id.endsWith(`__${id}`))), `${v.styles.length}`)
  check('每套都有封面', v.designs.every((e) => e.thumb && market.thumbFile(e.id)))
  check('空白页那排有精选的', v.designs.some((e) => e.featured))
  for (const e of v.designs) {
    const r = await market.stage(e.id)
    const pack = checkPack(r.files, { mode: 'install' })
    check(`${e.id}：断网也能解开、文件核对得上、过落地检查、带第一屏截图`, pack.ok && r.shots.length === 1 && market.shotFile(e.id, r.shots[0]), JSON.stringify(pack.errors.slice(0, 3)))
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
