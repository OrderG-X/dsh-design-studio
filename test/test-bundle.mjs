/**
 * 远程看的打包（不用开 DSH）：
 *   node test/test-bundle.mjs
 *
 * 样式表、@import、url()、脚本、图片、srcset 内联；外网地址、找不到的、越界的原样留着；<base>、picker 放对地方；
 * 内联的脚本里写着 </script> 也不会提前结束。
 */
import { bundle, inlinePicker } from '../lib/bundle.js'

let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${name}`) } else { fail++; console.log(`✗ ${name} ${extra}`) }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const files = {
  'tokens.css': ':root{--brand:#e60}',
  'css/app.css': '@import "../tokens.css";\n@import url(print.css) print;\n.hero{background:url(../img/bg.png)}\n.x{background:url("https://cdn.example/x.png")}',
  'css/print.css': 'body{color:#000}',
  'img/bg.png': PNG,
  'img/a.png': PNG,
  'img/a@2x.png': PNG,
  'app.js': 'console.log("</script><b>")',
  'sub/page.html': '<link rel="stylesheet" href="../tokens.css"><img src="/img/a.png">',
}
const asked = []
const read = (rel) => {
  asked.push(rel)
  if (rel.startsWith('..')) return null
  const v = files[rel]
  return v == null ? null : Buffer.isBuffer(v) ? v : Buffer.from(v)
}
const b64 = PNG.toString('base64')

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="css/app.css">
<link rel="icon" href="img/a.png">
<link rel="stylesheet" href="https://fonts.example/f.css">
<style>.y{background-image:url('img/a.png')}</style>
</head><body>
<img src="img/a.png" srcset="img/a.png 1x, img/a@2x.png 2x" alt="">
<img src="missing.png"><img src="../secret.png"><img src="data:image/gif;base64,R0lG">
<div style="background:url(img/bg.png)"></div>
<a href="cart.html">去结算</a>
<script src="app.js"></script>
<script src="https://cdn.example/lib.js"></script>
</body></html>`

const out = bundle(html, { key: 'menu.html', read, base: 'http://127.0.0.1:5000/menu.html', tail: '<!--TAIL-->' })

check('样式表内联成 <style data-href>', /<style data-href="css\/app.css">/.test(out) && !/<link rel="stylesheet" href="css\/app.css">/.test(out))
check('@import 展开（相对样式表算路径）', out.includes(':root{--brand:#e60}'))
check('带媒体条件的 @import 包进 @media', /@media print\{body\{color:#000\}\}/.test(out))
check('样式表里的 url() 换成 data:', out.includes(`.hero{background:url("data:image/png;base64,${b64}")}`))
check('外网 url() 原样留着', out.includes('url("https://cdn.example/x.png")'))
check('图标 <link href> 换成 data:', out.includes(`<link rel="icon" href="data:image/png;base64,${b64}">`))
check('外网样式表原样留着', out.includes('<link rel="stylesheet" href="https://fonts.example/f.css">'))
check('页面 <style> 里的 url() 内联', out.includes(`.y{background-image:url("data:image/png;base64,${b64}")}`))
check('img src 内联', out.includes(`<img src="data:image/png;base64,${b64}"`))
check('srcset 每一项都内联', out.includes(`srcset="data:image/png;base64,${b64} 1x, data:image/png;base64,${b64} 2x"`))
check('找不到的原样留着', out.includes('<img src="missing.png">'))
check('越界的原样留着', out.includes('<img src="../secret.png">'))
check('data: 不动', out.includes('<img src="data:image/gif;base64,R0lG">'))
check('行内 style 的 url() 内联（不带引号，不会和属性的引号打架）', out.includes(`style="background:url(data:image/png;base64,${b64})"`))
check('链接不动', out.includes('<a href="cart.html">去结算</a>'))
check('本地脚本换成 data: 地址（正文里的 </script> 不会提前结束）', out.includes(`<script src="data:text/javascript;charset=utf-8;base64,${Buffer.from(files['app.js']).toString('base64')}"></script>`))
check('外网脚本原样留着', out.includes('<script src="https://cdn.example/lib.js"></script>'))
check('<base> 放在 <head> 最前面', out.includes('<head><base href="http://127.0.0.1:5000/menu.html"><meta charset="utf-8">'))
check('picker 放在 </body> 前', out.includes('<!--TAIL--></body></html>'))
check('读过的文件都记着（含没找到的）', ['css/app.css', 'tokens.css', 'css/print.css', 'img/bg.png', 'img/a.png', 'img/a@2x.png', 'app.js', 'missing.png'].every((f) => asked.includes(f)), JSON.stringify(asked))

// 子目录里的一屏：/ 开头的从目录根算，../ 相对它自己
{
  const o = bundle(files['sub/page.html'], { key: 'sub/page.html', read })
  check('子目录：../ 相对这一屏', o.includes(':root{--brand:#e60}'))
  check('子目录：/ 开头从根算', o.includes(`data:image/png;base64,${b64}`))
  check('没有 <head> / </body>：<base> 放最前、picker 放最后', bundle('<p>hi</p>', { key: 'a.html', read, base: 'http://x/a.html', tail: 'T' }) === '<base href="http://x/a.html"><p>hi</p>T')
}

// Astra 审查的几种：同一张图引用很多次、defer、模块、单引号 style、SVG 精灵图
{
  const big = Buffer.alloc(1024 * 1024)
  const o = bundle('<img src="a.png">'.repeat(24), { key: 'a.html', read: () => big })
  check('同一张 1MB 图引用 24 次：按内联次数算，总量不超上限', o.length < 13 * 1024 * 1024 && o.includes('<img src="a.png">') && o.includes('<img src="data:'), String(o.length))
  const d = bundle('<head><script defer src="app.js"></script></head><body><button>x</button></body>', { key: 'a.html', read: (r) => (r === 'app.js' ? Buffer.from('document.querySelector("button").onclick=1') : null) })
  check('defer 脚本：还是外链（data:），defer 留着', /<script defer src="data:text\/javascript;charset=utf-8;base64,[^"]+"><\/script>/.test(d), d)
  const mf = { 'js/app.js': 'import { x } from "./dep.js";\nexport * from \'../lib/util.js\';\nimport("./lazy.js")', 'js/dep.js': 'export const x = 1', 'lib/util.js': 'export const u = 2', 'js/lazy.js': 'export default 3', 'js/inline.js': 'export const i = 4' }
  const mread = (r) => (mf[r] == null ? null : Buffer.from(mf[r]))
  const mo = bundle('<head><meta charset="utf-8"></head><script type="module" src="js/app.js"></script><script type="module">import { i } from "./js/inline.js"</script>', { key: 'menu.html', read: mread, base: 'http://127.0.0.1:5000/menu.html' })
  const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(mo)?.[1] || '{}').imports || {}
  const dec = (u) => Buffer.from(String(u).split(',')[1] || '', 'base64').toString()
  const entry = /<script type="module" src="(data:[^"]+)"><\/script>/.exec(mo)?.[1]
  check('模块：importmap 放在 <head> 最前（<base> 后面），依赖都映射到 data:', mo.indexOf('<script type="importmap">') < mo.indexOf('<script type="module"') && ['js/dep.js', 'lib/util.js', 'js/lazy.js', 'js/inline.js'].every((f) => String(map['http://127.0.0.1:5000/' + f]).startsWith('data:text/javascript')), JSON.stringify(Object.keys(map)))
  check('模块：入口换成 data:，里面的相对 import 改成原预览地址', !!entry && dec(entry).includes('from "http://127.0.0.1:5000/js/dep.js"') && dec(entry).includes("from 'http://127.0.0.1:5000/lib/util.js'") && dec(entry).includes('import("http://127.0.0.1:5000/js/lazy.js")'), entry && dec(entry))
  check('模块：行内模块正文不动（靠 <base> 解析）', mo.includes('<script type="module">import { i } from "./js/inline.js"</script>'))
  const ld = bundle('<!doctype html><p>x', { key: 'p.html', read: () => null, base: 'http://127.0.0.1:5000/p.html', lead: '<script>L</script>' })
  check('lead：放在 <base> 后面；没有 <head> 时不插到 doctype 前面', ld.startsWith('<!doctype html><base href="http://127.0.0.1:5000/p.html"><script>L</script><p>x'), ld)
  const twin = bundle('<script type="module">import "./a.js"; import "./b.js"</script>', { key: 'p.html', read: (r) => (r === 'a.js' || r === 'b.js' ? Buffer.from('export const v = 1') : null), base: 'http://127.0.0.1:5000/p.html' })
  const tm = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(twin)?.[1] || '{}').imports || {}
  check('模块：内容一样的两个文件还是两个模块（data: 不同，带 sourceURL）', tm['http://127.0.0.1:5000/a.js'] && tm['http://127.0.0.1:5000/b.js'] && tm['http://127.0.0.1:5000/a.js'] !== tm['http://127.0.0.1:5000/b.js'] && dec(tm['http://127.0.0.1:5000/a.js']).includes('//# sourceURL=http://127.0.0.1:5000/a.js'), JSON.stringify(tm))
  const own = bundle('<script type="importmap">{"imports":{}}</script><script type="module" src="js/app.js"></script>', { key: 'menu.html', read: mread, base: 'http://127.0.0.1:5000/menu.html' })
  check('页面自己有 importmap：模块不动', own.includes('<script type="module" src="js/app.js"></script>') && (own.match(/type="importmap"/g) || []).length === 1)
  const sq = bundle(`<div style='background:url(img/bg.png)'></div><p style="background:url('img/bg.png')"></p><i style="background:url(&quot;img/bg.png&quot;)"></i>`, { key: 'a.html', read })
  check('单引号、双引号、&quot; 包着的行内 style 都内联成合法属性', sq.includes(`<div style='background:url(data:image/png;base64,${b64})'>`) && sq.includes(`<p style="background:url(data:image/png;base64,${b64})">`) && sq.includes(`<i style="background:url(data:image/png;base64,${b64})">`), sq)
  const ICONS = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:red}</style><script>alert(1)</script><symbol id="check" onload="x()"><path d="M0 0" fill="url(#g)"/></symbol><linearGradient id="g"/><symbol id="x"/><use href="#x"/></svg>'
  const OTHER = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="check"><circle r="1"/></symbol></svg>'
  const sv = bundle('<body><svg><use href="icons.svg#check"></use></svg><svg><use xlink:href="icons.svg#x"/></svg><svg><use href="other.svg#check"/></svg></body>', { key: 'a.html', read: (r) => (r === 'icons.svg' ? Buffer.from(ICONS) : r === 'other.svg' ? Buffer.from(OTHER) : null) })
  check('<use href="icons.svg#check">：SVG 放进页面，href 改成带文件前缀的 #id', sv.includes('<use href="#dsh1-check">') && sv.includes('<use xlink:href="#dsh1-x"/>') && /<div aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><svg [^>]*>/.test(sv) && (sv.match(/<symbol id="dsh1-check"/g) || []).length === 1 && !sv.includes('<?xml'), sv)
  check('两份 SVG 都有 #check：各用各的，不串图', sv.includes('<use href="#dsh2-check"/>') && sv.includes('<symbol id="dsh2-check">'), sv)
  check('雪碧图里的脚本、事件、<style> 去掉，内部引用跟着改名', !sv.includes('alert(1)') && !sv.includes('onload=') && !sv.includes('fill:red') && sv.includes('url(#dsh1-g)') && sv.includes('<use href="#dsh1-x"/>'), sv)
}

// 太大的不内联
{
  const big = Buffer.alloc(13 * 1024 * 1024)
  const o = bundle('<img src="big.png">', { key: 'a.html', read: () => big })
  check('超过总量上限的原样留着', o === '<img src="big.png">')
}

// @import 自己套自己：有层数上限，不会死循环
{
  const o = bundle('<link rel="stylesheet" href="loop.css">', { key: 'a.html', read: () => Buffer.from('@import "loop.css";p{}') })
  check('@import 循环：到上限就停', o.includes('p{}') && o.length < 2000)
}

// picker 配置
{
  const s = inlinePicker('var a = "</script>";', 'https://dsh.example', 'http://127.0.0.1:5000/menu.html')
  const cfg = JSON.parse(/window\.__DSH_DESIGN__=(.*?);\n/.exec(s)[1])
  check('picker 配置：远程、不连改动通知、只认右侧栏的源', cfg.remote === true && cfg.live === false && cfg.parents.length === 1 && cfg.parents[0] === 'https://dsh.example' && cfg.href === 'http://127.0.0.1:5000/menu.html')
  check('picker 源码里的 </script> 转义', !/<\/script>.*<\/script>/s.test(s.replace(/<\/script>$/, '')) && s.endsWith('</script>'))
  check('没给右侧栏的源：谁也不认', JSON.parse(/window\.__DSH_DESIGN__=(.*?);\n/.exec(inlinePicker('', ''))[1]).parents.length === 0)
}

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
