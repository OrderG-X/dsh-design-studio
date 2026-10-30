/**
 * 自动提取设计系统（system.js）：
 *   node test/test-system.mjs
 *
 * 颜色解析和换算、对比度；扫项目文件夹（CSS 变量、写死的颜色、字体、Tailwind、组件库）；
 * 从量到的数字定角色（背景 / 正文 / 次要 / 主色 …）、字号阶梯；写出来的 tokens.css / components.css / DESIGN.md；
 * 库：列出来、设默认、给技能补的一节；
 * 本机装着 Chrome / Edge 时再真开一回：从一个网页提一套，角色、字体、圆角、组件、截图都对
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseColor, hexOf, contrast, deltaE, lch, scanProject, withCjk, typeScale, synthesize, tokensCss, componentsCss, designMd, specimenHtml, tokensOf, listSystems, setDefault, defaultSystem, skillSection, resolveSource, extractSystem } from '../lib/system.js'
import { findBrowser, createBrowser } from '../lib/browser.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-system-')))
const hex = (s) => hexOf(parseColor(s))

// ── 颜色 ──
check('颜色：#abc / #aabbcc / rgb / rgba / hsl / 名字', hex('#abc') === '#aabbcc' && hex('rgb(31, 61, 43)') === '#1f3d2b' && hex('rgba(0,0,0,.5)') === '#000000' && hex('hsl(0 100% 50%)') === '#ff0000' && hex('white') === '#ffffff')
check('颜色：oklch 认得出', /^#[0-9a-f]{6}$/.test(hex('oklch(62% 0.14 150)')))
check('颜色：shadcn 那种只写三个数的 HSL', hex('222.2 47.4% 11.2%') === '#0f172a', hex('222.2 47.4% 11.2%'))
check('颜色：透明 / 认不出给 null', parseColor('transparent') === null && parseColor('nope') === null && parseColor('') === null)
check('颜色：rgba 透明度留着', parseColor('rgba(0,0,0,.5)')[3] === 0.5)
check('对比度：黑白 21', Math.round(contrast([0, 0, 0], [255, 255, 255])) === 21)
check('色差：一样的是 0，黑白很大', deltaE([10, 20, 30], [10, 20, 30]) === 0 && deltaE([0, 0, 0], [255, 255, 255]) > 90)
check('OKLCH：灰色几乎没有彩度，橙色有', lch([128, 128, 128]).C < 0.01 && lch([200, 118, 43]).C > 0.1)

// ── 字体、字号 ──
check('字体：没有中文字体的补上苹方 / 雅黑', /PingFang SC/.test(withCjk('"Inter", sans-serif')) && withCjk('"PingFang SC", sans-serif').match(/PingFang/g).length === 1)
{
  const ts = typeScale([[16, 100], [14, 30], [20, 10], [32, 5], [56, 2]], 16, 56)
  check('字号阶梯：正文是 md，最大的放在 4xl，从小到大', ts.md === 16 && ts['4xl'] === 56 && Object.values(ts).every((v, i, a) => !i || v >= a[i - 1]), JSON.stringify(ts))
}

// ── 扫项目 ──
const proj = path.join(tmp, 'proj')
fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
fs.mkdirSync(path.join(proj, 'node_modules', 'x'), { recursive: true })
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'acme-web', dependencies: { react: '18', antd: '5' }, devDependencies: { tailwindcss: '3' } }))
fs.writeFileSync(path.join(proj, 'src', 'theme.css'), ':root {\n  --brand: #e4572e;\n  --background: #fffdf8;\n  --foreground: #222;\n  --radius: 12px;\n}\nbody { font-family: "Inter", sans-serif; color: #222 }\n.btn { background: #e4572e; border-radius: 12px }\n.card { border-radius: 16px; border: 1px solid #eee5d8 }\n')
fs.writeFileSync(path.join(proj, 'tailwind.config.js'), 'module.exports = { theme: { extend: { colors: { brand: "#e4572e" } } } }\n')
fs.writeFileSync(path.join(proj, 'node_modules', 'x', 'big.css'), ':root { --nope: #123456 }')
fs.writeFileSync(path.join(proj, 'index.html'), `<!doctype html><html><head><title>Acme</title></head><body><h1>Acme</h1><p>${'我们做好用的工具。'.repeat(20)}</p></body></html>`)
fs.writeFileSync(path.join(proj, 'shell.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
const sc = scanProject(proj)
check('扫项目：认出名字、组件库、Tailwind', sc.name === 'acme-web' && sc.libs.includes('Ant Design') && sc.libs.includes('Tailwind CSS') && /brand/.test(sc.tailwind), JSON.stringify({ name: sc.name, libs: sc.libs }))
check('扫项目：CSS 变量、颜色、字体、圆角都数到了', sc.vars.has('--brand') && [...sc.colors.keys()].length >= 3 && [...sc.fonts.keys()].some((f) => /Inter/.test(f)) && sc.radii.has('12'))
check('扫项目：node_modules 不扫', !sc.vars.has('--nope'))
check('扫项目：有内容的 HTML 入口找到了，空壳（Vite 那种）不算', sc.entries.some((f) => f.endsWith('index.html')) && !sc.entries.some((f) => f.endsWith('shell.html')))
{
  const sys = synthesize([], sc, { name: 'Acme' })
  check('只扫项目也能定角色：主色是品牌橙，背景是变量里的底色', hexOf(sys.colors.primary) === '#e4572e' && hexOf(sys.colors.bg) === '#fffdf8', JSON.stringify(Object.fromEntries(Object.entries(sys.colors).map(([k, v]) => [k, hexOf(v)]))))
  check('只扫项目：正文色对背景对比够', contrast(sys.colors.text, sys.colors.bg) >= 4.5)
  const css = tokensCss(sys, { source: proj, date: '2026-10-30' })
  const tok = tokensOf(css)
  check('tokens.css：模板里的变量名都有', ['--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-line', '--color-primary', '--color-primary-ink', '--color-accent', '--font-sans', '--font-display', '--text-md', '--space-4', '--radius-md', '--shadow-sm'].every((k) => tok[k]), Object.keys(tok).join())
  check('tokens.css：开头写着设计系统的名字（交接时认得出）', /设计系统「Acme」/.test(css.split('\n')[0]))
  check('tokens.css：带深色那一份', /prefers-color-scheme:\s*dark|\[data-theme="?dark/.test(css))
  const comp = componentsCss(sys)
  check('components.css：按钮、输入框、卡片、文字样式都有，用变量', ['.btn', '.btn-secondary', '.input', '.card', '.display', '.body'].every((c) => comp.includes(c + ' {') || comp.includes(c + ',') || comp.includes(c + ':')) && /var\(--color-primary\)/.test(comp))
  const md = designMd(sys, { source: proj })
  check('DESIGN.md：有颜色表、字体、品牌气质待补', /--color-primary/.test(md) && /字体/.test(md) && /品牌气质/.test(md))
  check('样张 HTML：link 了两份 CSS', /href="tokens\.css"/.test(specimenHtml(sys, {})) && /href="components\.css"/.test(specimenHtml(sys, {})))
}

// ── 网页上量来的怪值别把样式表写坏 ──
{
  const sys = synthesize([], sc, { name: '*/body{display:none}/*' })
  sys.font.sans = '"x";}body{display:none}'
  sys.shadow.md = '0 1px red;}*{color:red'
  const css = tokensCss(sys, { source: 'a */ b', date: '2026-10-30' })
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  check('tokens.css：名字、来源里的 */ 关不掉注释，怪字体、怪阴影换成默认', !/display:none|color:red/.test(bare) && /--font-sans: "PingFang SC"/.test(css) && tokensOf(css)['--shadow-md'] === '0 6px 20px rgb(0 0 0 / 0.08)', bare.slice(0, 300))
  const comp = componentsCss(sys).replace(/\/\*[\s\S]*?\*\//g, '')
  check('components.css：名字里的 */ 关不掉注释', !/display:none/.test(comp))
}
check('读变量：字符串里的 { } 不算括号', JSON.stringify(tokensOf(':root {\n--mark:"}";\n--color-primary:#123456;\n}')) === '{"--mark":"\\"}\\"","--color-primary":"#123456"}' && tokensOf(':root {\n--mark:"{";\n--color-primary:#123456;\n}\n[data-theme=dark]{--color-primary:#ffffff;}')['--color-primary'] === '#123456')
check('读变量：一行写完的 :root、最后一条没分号、注释里的不算', JSON.stringify(tokensOf(':root{--color-primary:#123456;--r:4px}')) === '{"--color-primary":"#123456","--r":"4px"}' && JSON.stringify(tokensOf('/* :root{--x:1} */\n:root {\n  --y: red;\n}')) === '{"--y":"red"}')

// ── 来源 ──
check('来源：网址、不带协议的域名、文件夹、HTML 文件', resolveSource('https://www.example.com/a').label === 'example.com' && resolveSource('example.com').kind === 'url' && resolveSource(proj).kind === 'dir' && resolveSource(path.join(proj, 'index.html')).kind === 'file')
{
  let msg = ''
  try { resolveSource(path.join(proj, 'package.json')) } catch (e) { msg = e.message }
  check('来源：别的文件说清楚', /不是 HTML 文件/.test(msg), msg)
}

// ── 库 ──
const lib = path.join(tmp, 'lib')
check('库：没有时列表空，技能里只说怎么提', listSystems(lib).length === 0 && /extract_design_system/.test(skillSection(lib)) && !/默认设计系统/.test(skillSection(lib)))
for (const [id, name, at] of [['acme', 'Acme', 1], ['lumen', 'Lumen', 2]]) {
  fs.mkdirSync(path.join(lib, id), { recursive: true })
  fs.writeFileSync(path.join(lib, id, 'tokens.css'), ':root {\n  --color-bg: #fff;\n  --color-primary: #e4572e;\n  --font-sans: "Inter", sans-serif;\n  --radius-md: 12px;\n}\n')
  fs.writeFileSync(path.join(lib, id, 'system.json'), JSON.stringify({ name, sources: ['https://' + id + '.com'], createdAt: at }))
}
check('库：两套，新的在前，没有默认', listSystems(lib).map((x) => x.id).join() === 'lumen,acme' && !defaultSystem(lib))
check('库：没设默认时技能里说点名才用', /没设默认/.test(skillSection(lib)) && /Acme/.test(skillSection(lib)))
setDefault(lib, 'acme')
{
  const l = listSystems(lib)
  check('库：设了默认排第一、带颜色和字体', l[0].id === 'acme' && l[0].default && l[0].colors.primary === '#e4572e' && l[0].font === 'Inter', JSON.stringify(l[0]))
  const s = skillSection(lib)
  check('技能：默认那套写清楚目录和做法（复制 tokens.css、components.css，不问感觉）', /默认设计系统.*Acme/.test(s) && s.includes(path.join(lib, 'acme')) && /tokens\.css/.test(s) && /不推风格卡/.test(s) && /其他.*Lumen|Lumen/.test(s))
}
{
  let msg = ''
  try { setDefault(lib, 'nope') } catch (e) { msg = e.message }
  check('库：设一个没有的报错', /没有这套/.test(msg))
  setDefault(lib, '')
  check('库：取消默认', !defaultSystem(lib))
}

// ── 提取：明说不设默认就不设；库里的文件夹是软链接就不写 ──
{
  const lib3 = path.join(tmp, 'lib3')
  const r = await extractSystem({ browser: null, sources: [proj], name: 'Acme', dir: lib3, makeDefault: false })
  check('提取：default:false 时库里原来没默认也不设', r.id === 'Acme' && !r.isDefault && !defaultSystem(lib3) && fs.existsSync(path.join(lib3, 'Acme', 'tokens.css')))
  if (process.platform !== 'win32') {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'tokens.css'), 'keep')
    const lib4 = path.join(tmp, 'lib4')
    fs.mkdirSync(lib4)
    fs.symlinkSync(outside, path.join(lib4, 'Acme'))
    let err = ''
    try { await extractSystem({ browser: null, sources: [proj], name: 'Acme', dir: lib4 }) } catch (e) { err = e.message }
    check('提取：库里同名的是软链接 → 不写，链接指的文件不动', /不是普通文件夹/.test(err) && fs.readFileSync(path.join(outside, 'tokens.css'), 'utf8') === 'keep' && fs.readdirSync(outside).length === 1, err)
    fs.rmSync(path.join(lib3, 'Acme', 'components.css'))
    fs.symlinkSync(path.join(outside, 'tokens.css'), path.join(lib3, 'Acme', 'components.css'))
    await extractSystem({ browser: null, sources: [proj], name: 'Acme', dir: lib3, makeDefault: false })
    check('提取：库里的文件是软链接 → 换成普通文件，链接指的文件不动', fs.readFileSync(path.join(outside, 'tokens.css'), 'utf8') === 'keep' && fs.lstatSync(path.join(lib3, 'Acme', 'components.css')).isFile())
  }
}

// ── 真浏览器 ──
const bin = findBrowser()
if (!bin) console.log('（没找到 Chrome / Edge，跳过真浏览器那几条）')
else {
  const site = path.join(tmp, 'site')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'index.html'), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Lumen 咖啡 | 每天一杯好咖啡</title>
<style>
:root{--green:#1f3d2b;--cream:#f6f1e7;--amber:#c8762b;--ink:#1d1d1b;--muted:#6b6b63;--line:#e3dccd}
body{margin:0;background:var(--cream);color:var(--ink);font-family:Georgia,"PingFang SC",sans-serif;font-size:16px;line-height:1.6}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 48px;background:#fff;border-bottom:1px solid var(--line)}
.logo{font-size:22px;font-weight:700;color:var(--green)}
nav a{margin-left:24px;color:var(--ink);text-decoration:none}
.hero{padding:96px 48px}
h1{font-size:56px;line-height:1.1;margin:0 0 16px;color:var(--green)}
p{color:var(--muted)}
.btn{display:inline-block;padding:12px 24px;border-radius:999px;background:var(--green);color:#fff;font-weight:600;border:0;font-size:16px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 48px 64px}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 16px rgba(31,61,43,.08);border:1px solid var(--line)}
.card h3{margin:0;color:var(--ink)}
input{padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:#fff}
a.more{color:var(--amber)}
</style></head><body>
<header><div class="logo">Lumen</div><nav><a href="#">菜单</a><a href="#">门店</a><a href="#">关于我们</a></nav></header>
<section class="hero"><h1>每天一杯好咖啡</h1><p>精选产地豆，当天烘焙，送到你家门口。每一包都写着烘焙日期。</p><button class="btn">立即订购</button><p><input placeholder="邮箱"></p></section>
<div class="cards">${['埃塞俄比亚', '哥伦比亚', '云南保山'].map((x) => `<div class="card"><h3>${x}</h3><p>花香、柑橘，明亮的酸。适合手冲和冷萃。</p><a class="more" href="#">了解更多</a></div>`).join('')}</div>
</body></html>`)
  const b = createBrowser({ bin })
  try {
    const out = path.join(tmp, 'systems')
    const t0 = Date.now()
    const r = await extractSystem({ browser: b, sources: [path.join(site, 'index.html')], dir: out })
    const c = Object.fromEntries(Object.entries(r.sys.colors).map(([k, v]) => [k, hexOf(v)]))
    check('真浏览器：品牌名取标志上的字', r.name === 'Lumen' && r.id === 'Lumen', r.name)
    check('真浏览器：背景、主色、点睛色、边框对', c.bg === '#f6f1e7' && c.primary === '#1f3d2b' && c.accent === '#c8762b' && c.line === '#e3dccd', JSON.stringify(c))
    check('真浏览器：正文是 body 的深色，段落的灰是次要文字', c.text === '#1d1d1b' && c.muted === '#6b6b63', JSON.stringify(c))
    check('真浏览器：主按钮胶囊形、卡片圆角 16', r.sys.pill === true && Object.values(r.sys.radius).includes(16), JSON.stringify(r.sys.radius))
    check('真浏览器：字体是 Georgia', /Georgia/.test(r.sys.font.sans), r.sys.font.sans)
    check('真浏览器：量到主按钮、输入框、卡片、顶栏', r.sys.comps.button && r.sys.comps.input && r.sys.comps.card && r.sys.comps.header)
    check('真浏览器：五个文件都写了，设成了默认', ['tokens.css', 'components.css', 'components.html', 'DESIGN.md', 'system.json'].every((f) => fs.existsSync(path.join(r.dir, f))) && r.isDefault && defaultSystem(out) === 'Lumen')
    check('真浏览器：截了网页、组件和样张（样张也存成缩略图）', r.images.length >= 3 && r.images.some((x) => x.key === 'specimen') && r.images.every((x) => x.jpg[0] === 0xff) && fs.existsSync(path.join(r.dir, 'source', 'preview.jpg')), r.images.map((x) => x.key).join())
    check('真浏览器：给模型的字里有颜色、下一步', /primary #1f3d2b/.test(r.text) && /接下来/.test(r.text))
    check('真浏览器：几秒内提完', Date.now() - t0 < 20000, `${Date.now() - t0}ms`)
    const again = await extractSystem({ browser: b, sources: [path.join(site, 'index.html')], dir: out, makeDefault: false })
    check('真浏览器：再提一次同名的覆盖，原来的留在 .prev', again.replaced && fs.existsSync(path.join(again.dir, '.prev', 'DESIGN.md')) && /重新提取/.test(again.text))
  } finally {
    b.stop()
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
