/**
 * 字体库（#31）：目录、按名字找、@font-face 那段（只认明确选过的、名字不在了就去掉、CRLF）、下载核对、复制进设计、
 * 面板保存（applyTweaks + syncFonts）、use_fonts 工具、体检提醒、版本记录不存、分享包去掉那段、导出内联、预览服务器的字体地址
 *   node test/test-fonts.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  createFonts, loadFontIndex, loadFontPreviews, findFont, libFontOf, firstFamily, stackOf, syncFontBlock, fontBlockIds, stripFontBlock,
  fontPrefix, isLibFontRel, libFontIdOf, namesFamily, FALLBACK,
} from '../lib/fonts.js'
import { applyTweaks, syncFonts, lintFonts, libFontsUsed, setVarInHtml } from '../lib/tweaks.js'
import { pinRoots } from '../lib/handoff.js'
import { collect } from '../lib/history.js'
import { packDesign } from '../lib/gallery/pack.js'
import { bundle } from '../lib/bundle.js'
import { createHub } from '../lib/serve.js'
import { buildPack } from '../lib/htmlpack.js'
import { studio, fontTool } from '../lib/index.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-fonts-')))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

// ── 随插件发的目录 ──
{
  const idx = loadFontIndex()
  const pv = loadFontPreviews()
  check('目录读得出来、18 款', idx && idx.fonts.length === 18, idx && idx.fonts.length)
  check('包名、版本钉死', idx.package === 'dsh-design-fonts' && /^\d+\.\d+\.\d+$/.test(idx.version))
  check('每款都有预览图形', idx.fonts.every((f) => pv[f.id] && pv[f.id].w > 0 && typeof pv[f.id].d === 'string' && pv[f.id].d.length > 20))
  check('每款都有中英文名、说明、来源', idx.fonts.every((f) => f.zh && f.en && f.nzh && f.nen && /^https:\/\//.test(f.source)))
  check('得意黑是原文件（不裁）', idx.fonts.find((f) => f.id === 'smiley-sans').subset === null)
  check('中文都裁成常用字、英文裁成拉丁', idx.fonts.filter((f) => f.lang === 'zh' && f.id !== 'smiley-sans').every((f) => f.subset === 'cjk') && idx.fonts.filter((f) => f.lang === 'latin').every((f) => f.subset === 'latin'))
  check('单个文件不超过 4 MB（导出单屏预算够两款）', idx.fonts.every((f) => f.size < 4 * 1024 * 1024))
  check('没收有保留名不许改的霞鹜文楷、Playfair', !idx.fonts.some((f) => /wenkai|playfair/i.test(f.id)))
}

// 测试用的小目录（文件内容随便，按 sha256 核对）
const bytes = (id) => Buffer.from(`wOF2 fake ${id}`, 'latin1')
const font = (id, family, zh, cat, weights = null, lang = 'zh') => ({ id, family, zh, en: family, cat, lang, nzh: zh, nen: family, file: `fonts/${id}.woff2`, size: bytes(id).length, sha256: sha(bytes(id)), weights, subset: lang === 'zh' ? 'cjk' : 'latin', source: 'https://example.com' })
const index = {
  format: 1, package: 'dsh-design-fonts', version: '1.0.0', license: 'OFL-1.1',
  fonts: [
    font('noto-serif-sc', 'Noto Serif SC', '思源宋体', 'serif', [200, 900]),
    font('ma-shan-zheng', 'Ma Shan Zheng', '马善政毛笔楷书', 'hand'),
    font('inter', 'Inter', 'Inter', 'sans', [100, 900], 'latin'),
  ],
}

// ── 按名字找、字体栈 ──
check('中文名找得到', findFont(index, '思源宋体').id === 'noto-serif-sc')
check('英文名大小写空格不计', findFont(index, 'noto serif sc').id === 'noto-serif-sc' && findFont(index, 'MaShanZheng').id === 'ma-shan-zheng')
check('id 也认', findFont(index, 'inter').id === 'inter')
check('没有的给 null', findFont(index, '霞鹜文楷') === null && findFont(index, '') === null)
check('字体栈：库里的打头、同类系统字体垫后', stackOf(index.fonts[0]) === `"Noto Serif SC", ${FALLBACK.serif}`)
check('第一个名字', firstFamily(' "Noto Serif SC", serif') === 'Noto Serif SC' && firstFamily("'A B', x") === 'A B' && firstFamily('Georgia, serif') === 'Georgia')
check('打头的是库里的才算', libFontOf(index, '"Noto Serif SC", serif').id === 'noto-serif-sc' && libFontOf(index, '"Songti SC", "Noto Serif SC", serif') === null)
check('目录里格式不对的条目不要', loadFontIndex(path.join(tmp, 'nope.json')) === null)
{
  const bad = { ...index, fonts: [...index.fonts, { ...index.fonts[0], id: '../x' }, { ...index.fonts[0], id: 'y', family: 'A"B' }] }
  fs.writeFileSync(path.join(tmp, 'idx.json'), JSON.stringify(bad))
  check('id、名字不老实的不要', loadFontIndex(path.join(tmp, 'idx.json')).fonts.length === 3)
}

// ── @font-face 那段 ──
{
  const css = '/* 设计变量 */\n@import url("base.css");\n:root {\n  --font-display: "Noto Serif SC", "Songti SC", serif;\n  --font-sans: "PingFang SC", sans-serif;\n}\n'
  const out = syncFontBlock(css, ['noto-serif-sc'], index)
  check('加上那段：放在开头注释和 @import 后面', out.indexOf('@import') < out.indexOf('dsh-fonts:') && out.indexOf('dsh-fonts:') < out.indexOf(':root'))
  check('开头标记记着 id', fontBlockIds(out).join() === 'noto-serif-sc')
  check('@font-face 指到 dsh-fonts/、字重是可变范围', /@font-face \{ font-family: "Noto Serif SC"; src: url\("dsh-fonts\/noto-serif-sc\.woff2"\) format\("woff2"\); font-weight: 200 900; font-display: swap; \}/.test(out))
  check('再同步一次不变', syncFontBlock(out, ['noto-serif-sc'], index) === null)
  check('只有一种粗细的写成 100 900（不让浏览器描粗）', /Ma Shan Zheng[^}]*font-weight: 100 900/.test(syncFontBlock(css.replace('Noto Serif SC', 'Ma Shan Zheng'), ['ma-shan-zheng'], index)))
  const added = syncFontBlock(css, ['inter'], index)
  check('选了就加（名字还没写进样式也加：use_fonts 先放字体）', fontBlockIds(added).join() === 'inter')
  const gone = out.replace('"Noto Serif SC", "Songti SC", serif', '"Songti SC", serif')
  check('没说要去掉的：名字不在了也留着（只加不减）', syncFontBlock(gone, [], index) === null)
  const pruned = syncFontBlock(gone, [], index, { drop: ['noto-serif-sc'] })
  check('这次换走了（drop）且名字不在了 → 那段去掉', pruned !== null && !/dsh-fonts/.test(pruned) && /--font-display: "Songti SC", serif/.test(pruned))
  check('drop 了但这个文件里还写着名字 → 留着', syncFontBlock(out, [], index, { drop: ['noto-serif-sc'] }) === null)
  check('那段以外、注释以外的名字才算', syncFontBlock(gone.replace(':root', '/* "Noto Serif SC" */ :root'), [], index, { drop: ['noto-serif-sc'] }) !== null)
  const k1 = syncFontBlock(css, ['ma-shan-zheng'], index)
  const k2 = syncFontBlock(k1, ['noto-serif-sc'], index)
  check('连放两款（都还没写名字）：第一款不会被第二次顶掉', fontBlockIds(k2).join() === 'ma-shan-zheng,noto-serif-sc')
  check('名字匹配：Inter 不算 pointer、interface', !namesFamily('a{cursor:pointer}.interface{}', 'Inter') && namesFamily('a{font:700 16px Inter, sans-serif}', 'Inter') && namesFamily("--f:'Noto  Serif SC',serif", 'Noto Serif SC') && namesFamily('--f: Noto Serif SC, serif;', 'Noto Serif SC'))
  const two = syncFontBlock(out.replace('--font-sans: "PingFang SC"', '--font-sans: "Inter", "PingFang SC"'), ['inter'], index)
  check('第二款接着记在后面', fontBlockIds(two).join() === 'noto-serif-sc,inter')
  check('旧设计里写着的后备名字不会自己加进来（没人选）', syncFontBlock('.a{font-family:"Songti SC","Noto Serif SC",serif}', [], index) === null)
  const crlf = css.replace(/\n/g, '\r\n')
  const o2 = syncFontBlock(crlf, ['noto-serif-sc'], index)
  check('CRLF 的文件那段也用 CRLF', !/[^\r]\n/.test(o2) && fontBlockIds(o2).join() === 'noto-serif-sc')
  check('CRLF 的那段也去得掉', !/dsh-fonts/.test(stripFontBlock(o2)) && stripFontBlock(o2) === crlf)
  check('去掉那段 = 原样', stripFontBlock(out) === css)
  const html = '<!-- <style> 注释里 --><script>const s="<style>"</script><head><style>\n:root{--f:"Noto Serif SC",serif}\n</style></head>'
  const h1 = syncFontBlock(html, ['noto-serif-sc'], index, { isHtml: true })
  check('HTML：放进第一个真的 <style>（注释、脚本里的不算）', h1.indexOf('dsh-fonts') > h1.indexOf('<head><style>') && h1.startsWith('<!-- <style> 注释里 --><script>const s="<style>"</script>'))
  check('HTML：没有 <style> 就不动（不自己加：严格 CSP 的页面会拦）', syncFontBlock('<p style="font-family:Inter">x</p>', ['inter'], index, { isHtml: true }) === null)
  const himp = syncFontBlock('<head><style>@import "tokens.css";\n.a{font-family:Inter}</style></head>', ['inter'], index, { isHtml: true })
  check('HTML：<style> 开头的 @import 留在最前面', himp.indexOf('@import') < himp.indexOf('@font-face') && himp.indexOf('@font-face') < himp.indexOf('.a{'), himp)
  // 第 2 轮：不带引号的 Google Fonts 网址里有 ;（wght@400;700），整条 @import 之后再放
  const gimp = '@import url(https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;700&display=swap);\n:root{--a:1}\n'
  const gout = syncFontBlock(gimp, ['ma-shan-zheng'], index)
  check('不带引号、网址里有 ; 的 @import：整条留着，那段放在它后面', gout.startsWith(gimp.split('\n')[0] + '\n/* dsh-fonts:') && gout.includes('\n:root{--a:1}'), gout.slice(0, 200))
  const ghtml = syncFontBlock('<style>@import url(https://fonts.googleapis.com/css2?family=Inter:wght@400;700);\nh1{}</style>', ['inter'], index, { isHtml: true })
  check('HTML <style> 里同样的 @import 也不拆开', ghtml.startsWith('<style>@import url(https://fonts.googleapis.com/css2?family=Inter:wght@400;700);\n/* dsh-fonts:'), ghtml.slice(0, 160))
  const bom = syncFontBlock('\ufeff:root{--a:1}\n', ['inter'], index)
  check('文件带 BOM：那段放在 BOM 后面', bom.startsWith('\ufeff/* dsh-fonts:') && bom.includes('\n:root{--a:1}'), JSON.stringify(bom.slice(0, 40)))
  const lay = syncFontBlock('@layer reset, base;\n@import url("base.css");\n:root{--a:1}\n', ['inter'], index)
  check('开头先声明 @layer、再 @import：那段放在 @import 后面', lay.indexOf('@import') < lay.indexOf('dsh-fonts:') && lay.indexOf('@layer') < lay.indexOf('@import'), lay.slice(0, 120))
  const prn = syncFontBlock('<head><style media="print">body{color:#000}</style><style>h1{font-family:Inter}</style></head>', ['inter'], index, { isHtml: true })
  check('HTML 第一个 <style> 是打印用的：放进后面对屏幕生效的那个', prn.indexOf('media="print">body') > 0 && prn.indexOf('@font-face') > prn.indexOf('</style>'), prn.slice(0, 200))
  const pr1 = syncFontBlock('<style media="print">body{}</style>', ['inter'], index, { isHtml: true })
  check('HTML 只有打印用的 <style>：前面自己加一个放那段', pr1 && pr1.startsWith('<style data-dsh-fonts>') && pr1.indexOf('@font-face') < pr1.indexOf('media="print"'), pr1 && pr1.slice(0, 120))
  check('HTML 一个 <style> 都没有：不放（照实报没改）', syncFontBlock('<head><link rel="stylesheet" href="a.css"></head>', ['inter'], index, { isHtml: true }) === null)
  // 第 4 轮：手机 / 桌面分两个按尺寸的 <style>（属性里有 >），没有对整个屏幕生效的：自己加一个，带上 nonce；属性不弄坏
  const resp = syncFontBlock('<head><style media="(width >= 900px)" nonce="n1">:root{--f:"Inter"}</style><style media="(max-width: 899px)">:root{--f:"Inter"}</style></head>', ['inter'], index, { isHtml: true })
  check('只有按尺寸的 <style>：前面自己加一个（带 nonce），原来的不动', resp && resp.startsWith('<head><style data-dsh-fonts nonce="n1">') && resp.includes('<style media="(width >= 900px)" nonce="n1">:root{--f:"Inter"}</style><style media="(max-width: 899px)">'), resp && resp.slice(0, 200))
  check('再同步一次不变', syncFontBlock(resp, ['inter'], index, { isHtml: true }) === null)
  const gone2 = syncFontBlock(resp.replace(/--f:"Inter"/g, '--f:serif'), [], index, { isHtml: true, drop: ['inter'] })
  check('那段去掉时自己加的 <style> 也拿掉', gone2 === '<head><style media="(width >= 900px)" nonce="n1">:root{--f:serif}</style><style media="(max-width: 899px)">:root{--f:serif}</style></head>', gone2)
  const np = syncFontBlock('<style media="not print">h1{font-family:Inter}</style>', ['inter'], index, { isHtml: true })
  check('media="not print"：也自己加一个（不往按条件的里放）', np && np.startsWith('<style data-dsh-fonts>'))
  // 第 5 轮：<noscript> 里的备用样式不算；变量写回认引号里的 >（手机 / 桌面两个 <style> 都改）
  const ns = syncFontBlock('<head><noscript><style>.x{}</style></noscript><style>h1{font-family:Inter}</style></head>', ['inter'], index, { isHtml: true })
  check('<noscript> 里的 <style> 不放', ns && ns.indexOf('@font-face') > ns.indexOf('</noscript>'), ns && ns.slice(0, 160))
  const twoMq = setVarInHtml('<style media="(width < 900px)">:root{--f: Arial, sans-serif}</style><style media="(width >= 900px)">:root{--f: Arial, sans-serif}</style>', '--f', '"Inter", sans-serif')
  check('变量写回：media 里有 >= 的 <style> 也改到', twoMq && (twoMq.match(/"Inter", sans-serif/g) || []).length === 2 && twoMq.includes('<style media="(width >= 900px)">'), twoMq)
  const vfb = syncFontBlock(':root{--body:"Noto Sans SC", sans-serif}\n.logo{font-family:var(--brand-font, Inter), sans-serif}\n', ['inter'], index)
  check('var(--x, Inter) 里的后备字体也算在用：换走时不去掉', syncFontBlock(vfb, [], index, { drop: ['inter'] }) === null)
  check('style="font-family: Inter" 也算在用', namesFamily('<h1 style="font-family: Inter">', 'Inter') && !namesFamily('cursor: pointer; interface', 'Inter'))
  check('子目录里的文件到 dsh-fonts/ 的相对路径', fontPrefix('tokens.css') === 'dsh-fonts' && fontPrefix('pages/a.html') === '../dsh-fonts' && fontPrefix('a/b/c.css') === '../../dsh-fonts')
  const sub = syncFontBlock(css, ['noto-serif-sc'], index, { prefix: '../dsh-fonts' })
  check('子目录的样式写 ../dsh-fonts/', /url\("\.\.\/dsh-fonts\/noto-serif-sc\.woff2"\)/.test(sub))
}

// ── 下载、核对、复制 ──
function fakeMarket(files, calls) {
  return {
    fetchPackage: async (name, version, opt) => {
      calls.push([name, version, opt.limits])
      if (files instanceof Error) throw files
      return opt.check(files)
    },
  }
}
const allFiles = () => index.fonts.map((f) => ({ path: f.file, data: bytes(f.id) }))
const cacheDir = path.join(tmp, 'cache')
let lib
{
  const calls = []
  lib = createFonts({ market: fakeMarket(allFiles(), calls), index, cacheDir })
  check('没下过 → 没准备好', !lib.ready() && lib.cached('inter') === null)
  await Promise.all([lib.ensure(), lib.ensure()])
  check('并发只下一次、下的是钉死的版本', calls.length === 1 && calls[0][0] === 'dsh-design-fonts' && calls[0][1] === '1.0.0')
  check('单个文件上限放到 6 MB（照片是 4 MB）', calls[0][2].file === 6 * 1024 * 1024)
  check('下完就准备好了、缓存给得出文件', lib.ready() && fs.existsSync(lib.cached('inter')))
  check('不在目录里的 id 不给', lib.cached('../x') === null && lib.cached('nope') === null)
  const bad = createFonts({ market: fakeMarket(allFiles().map((x) => (x.path.includes('inter') ? { ...x, data: Buffer.from('evil') } : x)), []), index, cacheDir: path.join(tmp, 'c2') })
  let code = ''
  try { await bad.ensure() } catch (e) { code = e.code }
  check('哈希对不上 → 不收', code === 'mismatch' && !bad.ready())
  const off = createFonts({ market: { fetchPackage: async () => { throw Object.assign(new Error('off'), { code: 'off' }) } }, index, cacheDir: path.join(tmp, 'c3') })
  code = ''
  try { await off.ensure() } catch (e) { code = e.code }
  check('不联网开着 → off', code === 'off')

  const d = path.join(tmp, 'd1')
  fs.mkdirSync(d)
  lib.place(d, [index.fonts[0]], pinRoots([d]))
  check('复制进 dsh-fonts/', fs.readFileSync(path.join(d, 'dsh-fonts', 'noto-serif-sc.woff2')).equals(bytes('noto-serif-sc')))
  fs.writeFileSync(path.join(d, 'dsh-fonts', 'noto-serif-sc.woff2'), 'broken')
  lib.place(d, [index.fonts[0]], pinRoots([d]))
  check('坏了的换回对的', fs.readFileSync(path.join(d, 'dsh-fonts', 'noto-serif-sc.woff2')).equals(bytes('noto-serif-sc')))
  const d2 = path.join(tmp, 'd2')
  fs.mkdirSync(d2)
  const outside = path.join(tmp, 'outside')
  fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(d2, 'dsh-fonts'))
  code = ''
  try { lib.place(d2, [index.fonts[0]], pinRoots([d2])) } catch (e) { code = e.code }
  check('dsh-fonts/ 指到外面 → 不写', code === 'link' && !fs.existsSync(path.join(outside, 'noto-serif-sc.woff2')))
  code = ''
  try { lib.place(path.join(tmp, 'd1'), [index.fonts[0]], pinRoots([path.join(tmp, 'other')])) } catch (e) { code = e.code }
  check('不在允许的目录 → 不写', code === 'link')
}

// ── 面板保存：变量写进 tokens.css，@font-face 那段跟着变 ──
{
  const d = path.join(tmp, 'design')
  fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root {\n  --font-display: "Songti SC", serif;\n  --c: #fff;\n}\n')
  fs.writeFileSync(path.join(d, 'home.html'), '<html><head><link rel="stylesheet" href="tokens.css"></head><body><h1>你好</h1></body></html>')
  // 和 index.js tweakRoute 一样：存之前、之后各看一遍整套设计写着哪些库字体，这次换走了的才去掉
  const save = (vars) => {
    const picks = Object.values(vars).map((v) => libFontOf(index, v)).filter(Boolean)
    if (picks.length) lib.place(d, picks, pinRoots([d]))
    const before = libFontsUsed(d, index)
    const r = applyTweaks(d, {}, vars)
    if (r.ok && r.files.length) {
      const after = libFontsUsed(d, index)
      r.files = [...new Set([...r.files, ...syncFonts(d, r.files, picks.map((f) => f.id), index, { drop: [...before].filter((id) => !after.has(id)) })])]
    }
    return r
  }
  const pick = (v) => save({ '--font-display': v })
  const r = pick(stackOf(index.fonts[0]))
  const t1 = fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')
  check('换成字体库的：变量改了、那段加上了、文件复制了', r.ok && /--font-display: "Noto Serif SC"/.test(t1) && fontBlockIds(t1).join() === 'noto-serif-sc' && fs.existsSync(path.join(d, 'dsh-fonts/noto-serif-sc.woff2')))
  save({ '--c': '#000' })
  check('只改颜色：那段留着', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'noto-serif-sc')
  pick('"Kaiti SC", "KaiTi", serif')
  const t3 = fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')
  check('换回电脑自带的：那段去掉', !/dsh-fonts/.test(t3) && /--font-display: "Kaiti SC"/.test(t3))
  check('字体文件留着（不删用户目录里的文件）', fs.existsSync(path.join(d, 'dsh-fonts/noto-serif-sc.woff2')))
  // Fable 1：use_fonts 不填 var、模型把 font-family 写在页面 <style> 里，之后在面板里只改颜色
  fs.writeFileSync(path.join(d, 'tokens.css'), syncFontBlock(':root {\n  --font-display: "Kaiti SC", serif;\n  --c: #fff;\n}\n', ['ma-shan-zheng'], index))
  fs.writeFileSync(path.join(d, 'home.html'), '<html><head><link rel="stylesheet" href="tokens.css"><style>h1{font-family:"Ma Shan Zheng", serif}</style></head><body><h1>你好</h1></body></html>')
  save({ '--c': '#123' })
  check('页面里用着库字体、面板只改颜色 → 那段不动', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'ma-shan-zheng')
  save({ '--font-display': stackOf(index.fonts[0]) })
  check('变量换成别的库字体：页面里还在用的那款也留着', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'ma-shan-zheng,noto-serif-sc')
  // Sol 6：旧设计本来就写着和字体库一样的字体栈（没有 @font-face）：面板照样能把字体放进来
  fs.writeFileSync(path.join(d, 'home.html'), '<html><head><link rel="stylesheet" href="tokens.css"></head><body><h1>你好</h1></body></html>')
  fs.writeFileSync(path.join(d, 'tokens.css'), `:root {\n  --font-display: ${stackOf(index.fonts[0])};\n}\n`)
  save({ '--font-display': stackOf(index.fonts[0]) })
  check('值没变、但选的是字体库的 → 那段照样加上', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'noto-serif-sc')
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root {\n  --font-display: "Songti SC", serif;\n  --c: #fff;\n}\n')

  // 体检
  pick(stackOf(index.fonts[1]))
  check('都放好了 → 不提醒', lintFonts(d, index).length === 0)
  fs.rmSync(path.join(d, 'dsh-fonts/ma-shan-zheng.woff2'))
  check('文件丢了 → 提醒再放一次', lintFonts(d, index).some((x) => /ma-shan-zheng\.woff2 不在了/.test(x)))
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root{--font-display:"Ma Shan Zheng", serif}')
  check('打头用了库里少见的字体、却没有那段 → 提醒调 use_fonts', lintFonts(d, index).some((x) => /马善政毛笔楷书.*use_fonts/.test(x)))
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root{--font-sans:"Inter", "PingFang SC", sans-serif}')
  check('Inter 这种常被写在最前面的系统后备：没放过文件就不提醒', lintFonts(d, index).length === 0)
  // Astra 第 2 轮：旧设计从 Google Fonts 加载马善政，从没用过字体库 → 不报
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root{--font-display:"Ma Shan Zheng", serif}')
  fs.writeFileSync(path.join(d, 'gf.html'), '<html><head><link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap" rel="stylesheet"><link rel="stylesheet" href="tokens.css"></head><body></body></html>')
  check('设计自己外链了字体（Google Fonts）→ 不报没有 @font-face', lintFonts(d, index).length === 0, JSON.stringify(lintFonts(d, index)))
  fs.rmSync(path.join(d, 'gf.html'))
  check('去掉外链 → 照常提醒', lintFonts(d, index).some((x) => /Ma Shan Zheng/.test(x)))
  // Astra 6 / Sol 2：旧设计自己带着得意黑（自己的 @font-face、自己的文件）
  fs.writeFileSync(path.join(d, 'tokens.css'), '@font-face{font-family:"Smiley Sans";src:url("fonts/smiley.woff2")}\n:root{--font-display:"Smiley Sans", sans-serif}')
  check('设计自己 @font-face 过的同名字体 → 不提醒', lintFonts(d, index).length === 0)
  // Fable：use_fonts 的 file 填子目录的样式表，那段在 css/tokens.css 里
  fs.mkdirSync(path.join(d, 'css'))
  fs.writeFileSync(path.join(d, 'css/tokens.css'), syncFontBlock(':root{--font-display:"Ma Shan Zheng", serif}', ['ma-shan-zheng'], index, { prefix: '../dsh-fonts' }))
  fs.writeFileSync(path.join(d, 'tokens.css'), '')
  fs.writeFileSync(path.join(d, 'dsh-fonts/ma-shan-zheng.woff2'), bytes('ma-shan-zheng'))
  check('那段在子目录的样式表里 → 也认得、不提醒', lintFonts(d, index).length === 0, JSON.stringify(lintFonts(d, index)))
  fs.rmSync(path.join(d, 'css'), { recursive: true })

  // 版本记录不存字体库的文件
  const files = collect(d)
  check('版本记录跳过字体库复制进来的字体', files && !Object.keys(files).some((x) => x.startsWith('dsh-fonts/')) && 'tokens.css' in files)
  check('认得出字体库的文件名（用真目录）', isLibFontRel('dsh-fonts/noto-serif-sc.woff2') && !isLibFontRel('dsh-fonts/my-own.woff2') && !isLibFontRel('assets/noto-serif-sc.woff2'))
  // Astra 7 / Sol 2：设计自己的 fonts/inter.woff2 不是字体库的：照常进版本记录
  fs.mkdirSync(path.join(d, 'fonts'), { recursive: true })
  fs.writeFileSync(path.join(d, 'fonts/inter.woff2'), 'my own inter')
  check('设计自己的 fonts/inter.woff2 照常进版本记录', 'fonts/inter.woff2' in (collect(d) || {}) && !isLibFontRel('fonts/inter.woff2'))
}

// ── 分享包：那段去掉、字体文件不进包 ──
{
  const d = path.join(tmp, 'share')
  fs.mkdirSync(d)
  const css = syncFontBlock(':root{--font-display:"Noto Serif SC", serif}\n', ['noto-serif-sc'], index)
  fs.writeFileSync(path.join(d, 'tokens.css'), css)
  fs.mkdirSync(path.join(d, 'dsh-fonts'))
  fs.writeFileSync(path.join(d, 'dsh-fonts/noto-serif-sc.woff2'), bytes('noto-serif-sc'))
  fs.writeFileSync(path.join(d, 'home.html'), '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>首页 · 茶馆</title><link rel="stylesheet" href="tokens.css"></head><body><h1 style="font-family:var(--font-display)">茶馆</h1></body></html>')
  const r = packDesign(d, { screens: ['home.html'], license: 'CC0-1.0' })
  const fontErr = (r.errors || []).filter((e) => /font/i.test(e.code))
  check('分享检查不再因为 @font-face 拒收', fontErr.length === 0, JSON.stringify(r.errors))
  check('提示里说了字体库的字体不进包', (r.notes || []).some((n) => n.code === 'fontLib'))
}

// ── 导出单个 HTML：字体内联成 data: ──
{
  const css = syncFontBlock(':root{--f:"Noto Serif SC", serif}\nh1{font-family:var(--f)}\n', ['noto-serif-sc'], index)
  const files = { 'tokens.css': css, 'dsh-fonts/noto-serif-sc.woff2': bytes('noto-serif-sc') }
  const read = (rel) => (files[rel] == null ? null : Buffer.from(files[rel]))
  const out = bundle('<html><head><link rel="stylesheet" href="tokens.css"></head><body><h1>茶</h1></body></html>', { key: 'home.html', read })
  check('导出：字体换成 data:font/woff2', out.includes('url("data:font/woff2;base64,' + bytes('noto-serif-sc').toString('base64') + '")') || out.includes('data:font/woff2;base64,' + bytes('noto-serif-sc').toString('base64')), out.slice(0, 400))
}

// ── 预览服务器的字体地址（面板里试字体、还没存进设计时页面从这拿） ──
{
  const root = path.join(tmp, 'srv')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'a.html'), '<p>x</p>')
  const hub = createHub({ fontFile: (id) => lib.cached(id) })
  const { origin } = await hub.open({ kind: 'file', root })
  const get = (p) => new Promise((resolve) => {
    http.get(origin + p, (res) => { const bufs = []; res.on('data', (b) => bufs.push(b)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], corp: res.headers['cross-origin-resource-policy'], body: Buffer.concat(bufs) })) })
  })
  const ok = await get('/__dsh_design__/font/inter.woff2')
  check('字体库的字体：200、font/woff2、只许同源', ok.status === 200 && ok.type === 'font/woff2' && ok.corp === 'same-origin' && ok.body.equals(bytes('inter')))
  check('不在目录里的 → 404', (await get('/__dsh_design__/font/nope.woff2')).status === 404)
  check('路径不老实 → 404', (await get('/__dsh_design__/font/..%2F..%2Fetc.woff2')).status === 404 && (await get('/__dsh_design__/font/inter.ttf')).status === 404)
  hub.closeAll()
  // Sol 8：字体库的字体不进版本记录，看旧版本时从字体库缓存拿
  const hub2 = createHub({ fontFile: (id) => lib.cached(id), history: { fileOf: (r, v, rel) => (rel === 'a.html' ? path.join(root, 'a.html') : null), list: () => [] } })
  const o2 = (await hub2.open({ kind: 'file', root })).origin
  const get2 = (p) => new Promise((resolve) => { http.get(o2 + p, (res) => { const bufs = []; res.on('data', (b) => bufs.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(bufs) })) }) })
  const vf = await get2('/__dsh_design__/v/1/dsh-fonts/inter.woff2')
  check('旧版本要字体库的字体 → 从缓存给', vf.status === 200 && vf.body.equals(bytes('inter')), vf.status)
  check('旧版本要别的没存的文件 → 还是 404', (await get2('/__dsh_design__/v/1/dsh-fonts/nope.woff2')).status === 404 && (await get2('/__dsh_design__/v/1/fonts/inter.woff2')).status === 404)
  hub2.closeAll()
  // Sol 第 3 轮：现在的设计里 dsh-fonts/ 的文件不在了（复制时漏了）→ 预览也从缓存给；别的缺的文件照样 404
  const hub3 = createHub({ fontFile: (id) => lib.cached(id) })
  const o3 = (await hub3.open({ kind: 'file', root })).origin
  const get3 = (p) => new Promise((resolve) => { http.get(o3 + p, (res) => { const bufs = []; res.on('data', (b) => bufs.push(b)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(bufs) })) }) })
  const cf = await get3('/dsh-fonts/inter.woff2')
  check('现在的设计缺 dsh-fonts/ 里的库字体 → 从缓存给', cf.status === 200 && cf.type === 'font/woff2' && cf.body.equals(bytes('inter')), cf.status)
  check('缺的不是库字体 → 还是 404', (await get3('/dsh-fonts/nope.woff2')).status === 404 && (await get3('/fonts/inter.woff2')).status === 404)
  fs.mkdirSync(path.join(root, 'dsh-fonts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dsh-fonts/inter.woff2'), 'own')
  check('设计里有这个文件 → 给设计里的', (await get3('/dsh-fonts/inter.woff2')).body.toString() === 'own')
  hub3.closeAll()
}

// ── 整套 HTML 演示：外观面板里选了、还没存的库字体也带上（Sol 7） ──
{
  const files = { 'a.html': '<html><head><style>h1{font-family:var(--f)}</style></head><body><h1>A</h1></body></html>', 'b.html': '<html><body><h1>B</h1></body></html>' }
  const read = (rel) => (files[rel] == null ? null : Buffer.from(files[rel]))
  const big = Buffer.alloc(6000, 7) // 够大才会挪进共用的那份（小的 data: 留在各屏里）
  const libFont = (id) => { const f = index.fonts.find((x) => x.id === id); return f ? { family: f.family, weights: f.weights, data: big } : null }
  const { html } = buildPack({ screens: [{ key: 'a.html' }, { key: 'b.html' }], read, kind: 'web', w: 800, h: 600, tweak: { vars: { '--f': stackOf(index.fonts[2]) }, attrs: {}, fonts: ['inter', '../x'] }, libFont })
  const b64 = big.toString('base64')
  check('演示包：没存的库字体整套只放一份', html.split(b64).length - 1 === 1, html.split(b64).length - 1)
  check('演示包：字体写进每屏的配置（不认的 id 不要）', /family\\*":\\*"Inter/.test(html) && !html.includes('../x'))
  // Sol 第 3 轮：两款中文字体 + 一张 4.6 MB 的大图，一屏超过远程看的 12 MB，整套演示照样都带上
  const hero = Buffer.alloc(Math.round(4.6 * 1024 * 1024), 9)
  const fat = Buffer.alloc(3 * 1024 * 1024, 5)
  const css2 = syncFontBlock(':root{--f:"Noto Serif SC", serif}\n', ['noto-serif-sc', 'ma-shan-zheng'], index)
  const files2 = { 'p.html': '<html><head><link rel="stylesheet" href="tokens.css"></head><body><h1 style="font-family:\'Ma Shan Zheng\'">茶</h1><img src="hero.jpg"></body></html>', 'tokens.css': css2, 'hero.jpg': hero, 'dsh-fonts/noto-serif-sc.woff2': fat, 'dsh-fonts/ma-shan-zheng.woff2': Buffer.alloc(3 * 1024 * 1024, 6) }
  const read2 = (rel) => (files2[rel] == null ? null : Buffer.from(files2[rel]))
  const p2 = buildPack({ screens: [{ key: 'p.html' }], read: read2, kind: 'web', w: 800, h: 600 })
  check('演示包：字体 + 大图超过 12 MB 也都内联', !p2.html.includes(' src=\\"hero.jpg') && p2.html.includes(hero.subarray(0, 3000).toString('base64').slice(0, 3000)) && p2.html.includes(fat.subarray(0, 3000).toString('base64').slice(0, 3000)))
  check('演示包：都放进去了 → 不报缺', Array.isArray(p2.skipped) && p2.skipped.length === 0, p2.skipped)
  // 第 4 轮：一屏放不下（超过 48 MB）、单个文件太大（读的时候就拒了）→ 照样导出，但报出缺了哪些（不悄悄缺图）
  const imgs = Array.from({ length: 12 }, (_, k) => `g${k}.jpg`)
  const files3 = { ...files2, 'q.html': '<html><head><link rel="stylesheet" href="tokens.css"></head><body>' + imgs.map((x) => `<img src="${x}">`).join('') + '<img src="huge.jpg"></body></html>' }
  for (const x of imgs) files3[x] = hero
  const read3 = (rel) => (rel === 'huge.jpg' ? null : files3[rel] == null ? null : Buffer.from(files3[rel]))
  const p3 = buildPack({ screens: [{ key: 'q.html' }], read: read3, bigOf: (rel) => rel === 'huge.jpg', kind: 'web', w: 800, h: 600 })
  check('演示包：一屏超了上限的、单个太大的都报出来', p3.skipped.includes('huge.jpg') && p3.skipped.some((x) => /^g\d+\.jpg$/.test(x)) && !p3.skipped.includes('g0.jpg'), p3.skipped)
  // 第 5 轮：<picture> 里 <source media="(width >= 900px)" srcset=…> 的大图：照样认得出、太大的报出来
  const files4 = { 'r.html': '<html><body><picture><source media="(width >= 900px)" srcset="desk.jpg"><img src="mob.jpg"></picture></body></html>', 'mob.jpg': Buffer.alloc(1000, 1), 'desk.jpg': Buffer.alloc(2000, 2) }
  const read4 = (rel) => (rel === 'desk.jpg' ? null : files4[rel] == null ? null : Buffer.from(files4[rel]))
  const p4 = buildPack({ screens: [{ key: 'r.html' }], read: read4, bigOf: (rel) => rel === 'desk.jpg', kind: 'web', w: 800, h: 600 })
  check('<source media="(width >= 900px)"> 的大图报出来', p4.skipped.includes('desk.jpg') && !p4.skipped.includes('mob.jpg'), p4.skipped)
  const b5 = bundle('<picture><source media="(width >= 900px)" srcset="d.png"></picture>', { key: 'p.html', read: (rel) => (rel === 'd.png' ? Buffer.from('png') : null) })
  check('<source media="(width >= 900px)" srcset> 照样内联、标签不拆开', b5.includes('srcset="data:image/png;base64,') && b5.includes('media="(width >= 900px)"') && !b5.includes('900px)" srcset="d.png'), b5.slice(0, 200))
}

// ── use_fonts 工具 ──
{
  const d = path.join(tmp, 'tool')
  fs.mkdirSync(d)
  fs.writeFileSync(path.join(d, 'tokens.css'), '/* 设计变量 */\n:root {\n  --font-display: "PingFang SC", sans-serif;\n}\n')
  const saved = { tracker: studio.tracker, fonts: studio.fonts, sessionCwd: studio.sessionCwd }
  studio.tracker = { stateOf: () => ({ target: { kind: 'file', root: d } }), cwdOf: () => tmp }
  studio.sessionCwd = null
  studio.fonts = lib
  const exec = { agent: { session: { id: 's1' } } }
  const r1 = await fontTool.execute({ font: '思源宋体', var: '--font-display' }, exec)
  const t1 = fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')
  check('use_fonts：变量换好、那段写好、文件复制了', /--font-display: "Noto Serif SC"/.test(t1) && fontBlockIds(t1).join() === 'noto-serif-sc' && fs.existsSync(path.join(d, 'dsh-fonts/noto-serif-sc.woff2')), r1.text)
  check('use_fonts：回话里说了别整个重写 tokens.css', /别整个重写/.test(r1.text) && /SIL OFL/.test(r1.text))
  const r2 = await fontTool.execute({ font: 'Inter' }, exec)
  const t2 = fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')
  check('use_fonts 不给 var：只放字体、回字体栈', fontBlockIds(t2).join() === 'noto-serif-sc,inter' && /font-family 写 "Inter"/.test(r2.text) && /只有英文和数字/.test(r2.text))
  const r3 = await fontTool.execute({ font: '马善政毛笔楷书', var: '--nope' }, exec)
  check('变量不存在：照实说、字体照放', /没有 --nope/.test(r3.text) && fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).includes('ma-shan-zheng'))
  check('单一粗细的提醒', /只有一种粗细/.test(r3.text))
  check('没有的字体：列出有什么', /没有「霞鹜文楷」/.test((await fontTool.execute({ font: '霞鹜文楷' }, exec)).text))
  check('file 不老实 → 不写', /\.css 或 \.html/.test((await fontTool.execute({ font: 'Inter', file: '../x.css' }, exec)).text))
  fs.rmSync(path.join(d, 'tokens.css'))
  check('没有 tokens.css → 先建', /先建好 tokens\.css/.test((await fontTool.execute({ font: 'Inter' }, exec)).text))
  check('会话目录外面 → 不放', /不在会话目录/.test((await fontTool.execute({ font: 'Inter', dir: '/' }, exec)).text))
  // Sol 3 / Fable 2：两次不填 var 的并排调用都留得住
  fs.writeFileSync(path.join(d, 'tokens.css'), ':root {\n  --font-display: "PingFang SC", sans-serif;\n}\n')
  await Promise.all([fontTool.execute({ font: '马善政毛笔楷书' }, exec), fontTool.execute({ font: '思源宋体' }, exec)])
  check('并排调两次：两款都在那段里', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).sort().join() === 'ma-shan-zheng,noto-serif-sc')
  // Astra 2：下载期间文件被改了：下完再读，不拿旧内容盖回去
  const real = studio.fonts
  studio.fonts = { ...real, provide: async (...a) => { fs.appendFileSync(path.join(d, 'tokens.css'), '.late{color:red}\n'); return real.provide(...a) } }
  await fontTool.execute({ font: 'Inter' }, exec)
  studio.fonts = real
  const tl = fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')
  check('下载期间别处改的内容留着', tl.includes('.late{color:red}') && fontBlockIds(tl).includes('inter'))
  // 换掉变量原来的库字体：整套设计都不再写它就从那段去掉；页面里还在用就留着
  fs.writeFileSync(path.join(d, 'tokens.css'), syncFontBlock(':root {\n  --font-display: "Ma Shan Zheng", serif;\n}\n', ['ma-shan-zheng'], index))
  await fontTool.execute({ font: '思源宋体', var: '--font-display' }, exec)
  check('变量换走的库字体、别处不用 → 去掉', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'noto-serif-sc')
  fs.writeFileSync(path.join(d, 'tokens.css'), syncFontBlock(':root {\n  --font-display: "Ma Shan Zheng", serif;\n}\n', ['ma-shan-zheng'], index))
  fs.writeFileSync(path.join(d, 'home.html'), '<html><head><style>.logo{font-family:"Ma Shan Zheng"}</style></head><body></body></html>')
  await fontTool.execute({ font: '思源宋体', var: '--font-display' }, exec)
  check('变量换走的库字体、页面里还在用 → 留着', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'ma-shan-zheng,noto-serif-sc')
  // Astra 第 2 轮：页面太大（内联图）只看了开头，后面还在用的字体不能当成没用
  fs.writeFileSync(path.join(d, 'tokens.css'), syncFontBlock(':root {\n  --font-display: "Ma Shan Zheng", serif;\n}\n', ['ma-shan-zheng'], index))
  fs.writeFileSync(path.join(d, 'home.html'), '<html><head></head><body><img src="data:image/png;base64,' + 'A'.repeat(600 * 1024) + '"><footer style="font-family:\'Ma Shan Zheng\'">茶</footer></body></html>')
  check('页面超过扫描上限 → 标成没看全', libFontsUsed(d, index).partial === true)
  await fontTool.execute({ font: '思源宋体', var: '--font-display' }, exec)
  check('没看全时换走的库字体不去掉', fontBlockIds(fs.readFileSync(path.join(d, 'tokens.css'), 'utf8')).join() === 'ma-shan-zheng,noto-serif-sc')
  fs.rmSync(path.join(d, 'home.html'))
  // Sol 第 3 轮：页面直接引用 4 层深的样式（assets/css/components/brand/logo.css）里还用着 → 看得到；更深的标成没看全
  const deep = path.join(d, 'assets/css/components/brand')
  fs.mkdirSync(deep, { recursive: true })
  fs.writeFileSync(path.join(deep, 'logo.css'), '.logo{font-family:"Ma Shan Zheng", serif}')
  const used = libFontsUsed(d, index)
  check('4 层深的样式里写的名字看得到', used.has('ma-shan-zheng') && !used.partial, [...used].join() + ' ' + used.partial)
  const deeper = path.join(d, 'a/b/c/d/e/f/g')
  fs.mkdirSync(deeper, { recursive: true })
  check('更深的目录：标成没看全', libFontsUsed(d, index).partial === true)
  fs.rmSync(path.join(d, 'assets'), { recursive: true }); fs.rmSync(path.join(d, 'a'), { recursive: true })
  // Astra 8 / Sol 4：HTML 没有 <style> → 照实说没写，文件不动
  fs.writeFileSync(path.join(d, 'plain.html'), '<html><head><link rel="stylesheet" href="tokens.css"></head><body></body></html>')
  const rp = await fontTool.execute({ font: 'Inter', file: 'plain.html' }, exec)
  check('HTML 没有 <style>：说没写、文件不动', /没有 <style>/.test(rp.text) && !/已放进/.test(rp.text) && !/dsh-fonts/.test(fs.readFileSync(path.join(d, 'plain.html'), 'utf8')), rp.text)
  // Astra 1 / Sol 1：css/ 是指到同一会话目录里别的项目的软链接 → 不改
  const other = path.join(tmp, 'other-proj', 'css')
  fs.mkdirSync(other, { recursive: true })
  fs.writeFileSync(path.join(other, 'tokens.css'), ':root{--f:x}')
  fs.symlinkSync(other, path.join(d, 'css'))
  const rl = await fontTool.execute({ font: 'Inter', file: 'css/tokens.css' }, exec)
  check('样式文件在指到外面的软链接文件夹里 → 不改', /软链接/.test(rl.text) && fs.readFileSync(path.join(other, 'tokens.css'), 'utf8') === ':root{--f:x}', rl.text)
  // Sol 1：复制用的临时文件名上已经有个指到外面的软链接 → 不顺着写出去
  const victim = path.join(tmp, 'victim.txt')
  fs.writeFileSync(victim, 'keep')
  const to = path.join(d, 'dsh-fonts', 'inter.woff2')
  fs.writeFileSync(to, 'old')
  fs.symlinkSync(victim, `${to}.${process.pid}.tmp`)
  lib.place(d, [index.fonts[2]], pinRoots([d]))
  check('临时文件名上的软链接：不顺着写、字体照样放好', fs.readFileSync(victim, 'utf8') === 'keep' && fs.readFileSync(to).equals(bytes('inter')))
  studio.fonts = null
  check('没带字体库 → 用系统字体', /没带字体库/.test((await fontTool.execute({ font: 'Inter' }, exec)).text))
  Object.assign(studio, saved)
}

// ── 第 6 轮全员终审补强回归（Astra 3 项）────────────────────────────────────
{
  // 1. 变量写回跳过 <noscript>（不把备用样式当成主样式误改）
  const nsHtml = '<html><head><noscript><style>:root{--f:Arial}</style></noscript><style>@layer tokens{:root{--f:Arial}}</style></head></html>'
  const nsTop = setVarInHtml(nsHtml, '--f', '"Inter", sans-serif')
  const nsNest = setVarInHtml(nsHtml, '--f', '"Inter", sans-serif', true)
  check('变量写回跳过 <noscript>（顶层不误改备用块，退回嵌套改真正生效层）', nsTop === null && nsNest !== null && /<noscript><style>:root\{--f:Arial\}<\/style><\/noscript>/.test(nsNest) && /@layer tokens\{:root\{--f:"Inter", sans-serif\}\}/.test(nsNest))
  // 2. 体检扫 HTML 跳过注释与正文代码示例，但仍认 <style> 与行内 style=""
  const ld = path.join(tmp, 'lint-html-clean')
  fs.mkdirSync(ld)
  fs.writeFileSync(path.join(ld, 'index.html'), '<html><head><style>body{font-family:sans-serif}</style></head><body><!-- font-family: "Ma Shan Zheng", serif; --><pre><code>font-family: "Ma Shan Zheng", serif;</code></pre></body></html>')
  check('体检：HTML 注释与正文代码示例不误报缺字体', lintFonts(ld, index).length === 0)
  fs.writeFileSync(path.join(ld, 'inline.html'), '<html><body><h1 style="font-family: \'Ma Shan Zheng\', serif">茶</h1></body></html>')
  check('体检：行内 style="font-family: …" 仍正常提醒', lintFonts(ld, index).some((s) => /马善政/.test(s)))
  // 3. 导出跳过 HTML 注释里的旧图，不让注释图片吃掉 48 MB 预算
  const bigImg = Buffer.alloc(6 * 1024 * 1024, 0x41)
  const liveImg = Buffer.alloc(2 * 1024 * 1024, 0x42)
  const cFiles = { 'old1.png': bigImg, 'old2.png': bigImg, 'live.png': liveImg }
  const cSkipped = []
  const cOut = bundle('<html><body><!-- <img src="old1.png"><img src="old2.png"> --><img src="live.png"></body></html>', { key: 'index.html', read: (rel) => cFiles[rel] || null, maxTotal: 5 * 1024 * 1024, onSkip: (rel) => cSkipped.push(rel) })
  check('导出：HTML 注释里的旧图不占预算，可见主图正常内联且不误报缺图', cSkipped.length === 0 && /<!-- <img src="old1\.png"><img src="old2\.png"> -->/.test(cOut) && /data-dsh-src="live\.png"/.test(cOut), cSkipped)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
