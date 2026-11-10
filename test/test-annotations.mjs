/**
 * 业务标注（annotations.js、试验开关、技能、交接说明、打包、版本）：
 *   node test/test-annotations.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseAnnotations, readAnnotations, lintAnnotations, annotationFindings, annotationSection, annotationsMd, normPage, MAX_ANNOTATIONS } from '../lib/annotations.js'
import { createHistory } from '../lib/history.js'
import { packDesign } from '../lib/gallery/pack.js'
import { handoffMd } from '../lib/handoff.js'
import { studio, skillProvider } from '../lib/index.js'
import { apply as applyRow } from '../lib/annotations-row.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-annot-')))
const one = (o = {}) => ({ id: 'room-03', page: 'room.html', title: '价格含双人早餐', ...o })

// ── 格式 ──
{
  const r = parseAnnotations(JSON.stringify({ annotations: [one({ type: 'rule', detail: '含早', selector: '.p', anchorLabel: '底栏', fallbackText: '含早', source: 'PRD 2.6', tags: ['价格', 3], related: ['b-1'], status: 'OPEN' })] }))
  const a = r.list[0]
  check('合法的读得出来', !r.errors.length && a.id === 'room-03' && a.n === 1 && a.selector === '.p' && a.source === 'PRD 2.6', JSON.stringify(r))
  check('tags 数字转成字符串、status 转小写', a.tags[1] === '3' && a.status === 'open')
  check('最外层直接是数组也认', parseAnnotations(JSON.stringify([one()])).list.length === 1)
  check('不是 JSON 说清楚', /不是合法的 JSON/.test(parseAnnotations('{oops').errors[0]))
  check('没有 annotations 字段说清楚', /要有 "annotations"/.test(parseAnnotations('{}').errors[0]))
  const miss = parseAnnotations(JSON.stringify([{ page: 'a.html', title: 'x' }, { id: 'b', title: 'x' }, { id: 'c', page: 'a.html' }, one()]))
  check('缺必填的报出来，别的照常', miss.list.length === 1 && miss.errors.length === 3 && /缺 id/.test(miss.errors[0]) && /缺 page/.test(miss.errors[1]) && /缺 title/.test(miss.errors[2]), JSON.stringify(miss.errors))
  const dup = parseAnnotations(JSON.stringify([one(), one()]))
  check('id 重复的报出来', dup.list.length === 1 && /重复/.test(dup.errors[0]))
  const long = parseAnnotations(JSON.stringify([one({ title: 'x'.repeat(201) }), one({ id: 'ok' })]))
  check('太长的报出来，别的照常', long.list.length === 1 && long.list[0].id === 'ok' && /title/.test(long.errors[0]))
  const typed = parseAnnotations(JSON.stringify([one({ tags: 'x' }), one({ id: 'r', related: [{}] }), one({ id: 's', detail: {} })]))
  check('类型不对的报出来', typed.list.length === 0 && typed.errors.length === 3, JSON.stringify(typed.errors))
  const many = parseAnnotations(JSON.stringify(Array.from({ length: MAX_ANNOTATIONS + 5 }, (_, i) => one({ id: 'a' + i }))))
  {
    const junk = parseAnnotations(JSON.stringify(Array.from({ length: 200000 }, () => 0)))
    check('写坏的再多，错误也封顶，末尾说还有多少', junk.list.length === 0 && junk.errors.length === 31 && /还有 199970 处/.test(junk.errors[30]), String(junk.errors.length))
    const mixed = parseAnnotations(JSON.stringify([...Array.from({ length: 40 }, () => 1), one({ id: 'good' })]))
    check('坏条目在前也不耽误后面好的', mixed.list.length === 1 && mixed.list[0].id === 'good')
  }
  check('超条数：只留上限，说一次', many.list.length === MAX_ANNOTATIONS && many.errors.length === 1 && /最多/.test(many.errors[0]))
  const nos = parseAnnotations(JSON.stringify([one({ id: '1' }), one({ id: '2', page: 'b.html' }), one({ id: '3' })])).list
  check('编号按屏各数各的', nos[0].n === 1 && nos[1].n === 1 && nos[2].n === 2)
  check('page 规整', normPage('./a.html') === 'a.html' && normPage('/a.html') === 'a.html' && normPage('sub\\a.htm') === 'sub/a.htm')
  check('page 不收奇怪的', ['../a.html', 'a.png', 'a.html#x', 'a//b.html', ''].every((x) => normPage(x) === ''))
  const proto = parseAnnotations('[{"id":"x","page":"a.html","title":"t","__proto__":{"selector":"evil"}}]')
  check('__proto__ 不进结果', proto.list[0].selector === '')
  const sample = parseAnnotations(JSON.stringify([
    { id: 'P01-03', page: 'consent.html', type: 'rule', title: '首启协议同意门禁', detail: '首次启动必现隐私与用户协议同意', selector: '#consent-check', anchorLabel: '协议同意勾选框', fallbackText: '我已阅读并同意《用户协议》与《隐私政策》', source: 'PRD FR-55 / US-01 · PAGES P01', tags: ['合规', '同意', '门禁'] },
    { id: 'P01-05', page: 'consent.html', type: 'state', title: '拒绝协议进入只读态', detail: '进入可浏览、不可写入的只读态', selector: '.consent-foot .btn-line', anchorLabel: '暂不同意，先看看入口', fallbackText: '暂不同意，先看看', source: 'PRD FR-55 / 4.8.2 · PAGES P01 / 3.9', tags: ['只读', '合规', '状态'], related: ['P03-07'] },
  ]))
  check('作者贴的两条样例能读（加上 page）', sample.list.length === 2 && !sample.errors.length, JSON.stringify(sample.errors))
}

// ── 读文件 ──
{
  const d = path.join(tmp, 'read')
  fs.mkdirSync(d)
  check('没有文件是 null', readAnnotations(d) === null)
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one()]))
  const a = readAnnotations(d)
  check('读得到，带修改时间和签名', a.list.length === 1 && a.mtime > 0 && a.sig.includes('-'))
  check('同一个文件再读走缓存', readAnnotations(d) === a)
  if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
    const d3 = path.join(tmp, 'noperm')
    fs.mkdirSync(d3)
    const f3 = path.join(d3, 'annotations.json')
    fs.writeFileSync(f3, JSON.stringify([one()]))
    fs.chmodSync(f3, 0o000)
    const bad = readAnnotations(d3)
    fs.chmodSync(f3, 0o644)
    const good = readAnnotations(d3)
    check('读不了的不记缓存：权限好了下一轮就读到', bad.errors.length === 1 && good.errors.length === 0 && good.list.length === 1 && good.sig !== bad.sig, JSON.stringify([bad.errors, good.errors]))
  }
  {
    const at = new Date('2026-01-02T03:04:05Z')
    const same = ['same-a', 'same-b'].map((n) => {
      const dir = path.join(tmp, n)
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify([one()]))
      fs.utimesSync(path.join(dir, 'annotations.json'), at, at)
      return readAnnotations(dir)
    })
    check('两个目录文件大小、修改时间一样，签名也不同', same[0].mtime === same[1].mtime && same[0].sig !== same[1].sig, `${same[0].sig} / ${same[1].sig}`)
  }
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one(), one({ id: 'x' })]))
  check('改了重读', readAnnotations(d).list.length === 2)
  const link = path.join(tmp, 'link')
  fs.mkdirSync(link)
  fs.symlinkSync(path.join(d, 'annotations.json'), path.join(link, 'annotations.json'))
  check('软链接当没有', readAnnotations(link) === null)
  const big = path.join(tmp, 'big')
  fs.mkdirSync(big)
  fs.writeFileSync(path.join(big, 'annotations.json'), ' '.repeat(600 * 1024))
  check('太大说清楚', /太大/.test(readAnnotations(big).errors[0]))
  fs.writeFileSync(path.join(d, 'room.html'), '<h1>x</h1>')
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one(), one({ id: 'y', page: 'nope.html' })]))
  const lint = lintAnnotations(d)
  check('静态检查：指到不存在的屏', lint.length === 1 && /nope\.html/.test(lint[0]), JSON.stringify(lint))
}

// ── 定位结果 → 文字 ──
{
  const all = parseAnnotations(JSON.stringify([one({ id: 'a', selector: '.a', fallbackText: '字' }), one({ id: 'b', selector: '.b' }), one({ id: 'c', selector: '.c', fallbackText: '字' }), one({ id: 'd', selector: '.d' })])).list
  const out = annotationFindings(all, [{ page: 'room.html', list: [{ id: 'a', how: '', count: 0 }, { id: 'b', how: 'selector', count: 3 }, { id: 'c', how: 'text', count: 0 }, { id: 'd', how: 'selector', count: 1 }] }])
  check('定位不到、匹配多个、选择器失效各报一条，正常的不报', out.length === 3 && /定位不到/.test(out[0]) && /3 个/.test(out[1]) && /失效/.test(out[2]), JSON.stringify(out))
}

// ── 开关和技能 ──
{
  const before = (await skillProvider.get()).content
  check('关着时技能里没有业务标注', !before.includes('业务标注（用户打开了这个试验开关）'))
  let dispose = null
  applyRow({ effect: (fn) => { dispose = fn() } })
  check('开着计数加一', studio.annotations === 1)
  const on = (await skillProvider.get()).content
  check('开着技能多一节', on.startsWith(before) && on.slice(before.length) === annotationSection())
  check('那一节不长，细则在 references', annotationSection().split('\n').filter(Boolean).length <= 10 && annotationSection().includes('references/annotations.md'))
  dispose()
  check('关掉还原', studio.annotations === 0 && (await skillProvider.get()).content === before)
  check('细则文件在', fs.existsSync(new URL('../skills/ui-design/references/annotations.md', import.meta.url)))
}

// ── 交接说明 ──
{
  const r = parseAnnotations(JSON.stringify([
    one({ id: 'a', source: 'PRD 2.6', selector: '.p', anchorLabel: '底栏', detail: '第一行\n第二行' }),
    one({ id: 'b', title: '没出处' }),
    one({ id: 'c', title: '待确认的', status: 'open', source: 'PRD 9' }),
  ]))
  const md = annotationsMd(r).join('\n')
  check('交接说明：有出处的、模型推断、待确认分开', /## 业务规则/.test(md) && /- \*\*a /.test(md) && /模型推断[\s\S]*- \*\*b /.test(md) && /待确认[\s\S]*- \*\*c /.test(md), md)
  check('正文换行压成一行', md.includes('第一行 第二行'))
  {
    const two = parseAnnotations(JSON.stringify([one({ id: 'p1', page: 'a.html' }), one({ id: 'p2', page: 'b.html' })]))
    const only = annotationsMd(two, new Set(['a.html'])).join('\n')
    check('交接说明：只转一屏就只带这一屏的规则', /p1/.test(only) && !/p2/.test(only), only)
    check('交接说明：转的屏没有规则就没有这一节', annotationsMd(two, new Set(['c.html'])).length === 0)
    const typo = annotationsMd(two, new Set(['a.html']), new Set(['a.html', 'c.html'])).join('\n')
    check('交接说明：page 写错的单独列出来，没选中的正常屏不带', /屏名对不上[\s\S]*p2/.test(typo), typo)
    const notPicked = annotationsMd(two, new Set(['a.html']), new Set(['a.html', 'b.html'])).join('\n')
    check('交接说明：没选中的正常屏不带', !/p2/.test(notPicked) && !/屏名对不上/.test(notPicked), notPicked)
    const broken = parseAnnotations(JSON.stringify([one({ id: 'ok' }), one({ id: 'bad', tags: 'x' })]))
    const bm = annotationsMd(broken).join('\n')
    check('交接说明：写坏的报出来，不当成交接完了', /写坏了/.test(bm) && /bad/.test(bm) && /- \*\*ok /.test(bm), bm)
    const allBad = annotationsMd(parseAnnotations('{ 不是 JSON')).join('\n')
    check('交接说明：整份坏了也有这一节', /## 业务规则/.test(allBad) && /写坏了/.test(allBad), allBad)
  }
  check('没标注 / 关着没有这一节', annotationsMd(null).length === 0 && annotationsMd({ list: [], errors: [] }).length === 0)
  const d = path.join(tmp, 'ho')
  fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, 'room.html'), '<h1>x</h1>')
  const args = { root: d, rows: [{ key: 'room.html', label: 'room', title: '', links: [], shots: [] }], kind: 'web', size: [1280, 800], framework: 'react', dest: '', project: null, system: '', htmlByKey: new Map([['room.html', '<h1>x</h1>']]), now: new Date(0) }
  const off = handoffMd(args)
  const on = handoffMd({ ...args, annotations: r })
  check('没有标注时交接说明和现在一字不差', handoffMd({ ...args, annotations: null }) === off && !off.includes('业务规则'))
  check('有标注时多一节，放在素材前面', on.includes('## 业务规则') && on.indexOf('## 业务规则') > on.indexOf('## 交互和状态') && on.replace(/## 业务规则[\s\S]*?(?=^## )/m, '') === off, on.slice(0, 200))
}

// ── 打包和版本 ──
{
  const d = path.join(tmp, 'pack')
  fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>x</title><h1>x</h1>')
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one()]))
  const r = packDesign(d, { screens: ['index.html'], version: '1', license: 'MIT', author: 'a', title: 't', description: 'd' })
  check('annotations.json 不进 zip', !r.files.some((f) => f.path === 'annotations.json') && r.skipped.includes('annotations.json'), JSON.stringify(r.skipped))

  const h = createHistory({ base: path.join(tmp, 'hist') })
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one({ title: '第一版' })]))
  const v1 = h.snapshot(d, 'v1')
  fs.writeFileSync(path.join(d, 'annotations.json'), JSON.stringify([one({ title: '第二版' })]))
  const v2 = h.snapshot(d, 'v2')
  check('只改标注也算一版', !!v1 && !!v2 && v2.n > v1.n)
  h.restore(d, v1.n, {})
  check('回退时标注跟着回', /第一版/.test(fs.readFileSync(path.join(d, 'annotations.json'), 'utf8')))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
