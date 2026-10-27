/**
 * 设计体检的浏览器测试：用插件自己的预览服务器给几张故意做坏的页面，套在一个仿右侧栏的外层页面里，
 * 无头 Chrome 打开，发 check，看报上来的问题对不对；干净的页面一条都不该报。
 *
 *   node e2e/check-page.mjs
 *
 * 要本机装着 Chrome（CHROME_BIN 可指定）。不进 npm test（CI 的单元测试不带浏览器）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { createHub } from '../lib/serve.js'

const WIN = process.platform === 'win32'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${extra}`}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddp-check-'))
const site = path.join(tmp, 'site')
fs.mkdirSync(site)
const head = (kind) => `<!doctype html><html><head><meta charset="utf-8"><meta name="dsh-design" content="${kind}"><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1f2937;background:#fff}</style></head><body>`
fs.writeFileSync(path.join(site, 'bad.html'), head('app') + `
<div class="clip" style="width:120px;overflow:hidden;white-space:nowrap">这是一段很长很长的标题文字装不下</div>
<div class="ell" style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">这是一段省略号收尾的很长文字</div>
<div class="spill" style="width:100px;height:20px;margin-bottom:60px">两行三行的文字溢出到框外面去了还在溢出</div>
<div style="position:relative;height:40px">
  <span class="a1" style="position:absolute;left:0;top:0">叠在一起的字</span>
  <span class="a2" style="position:absolute;left:6px;top:4px">另一段字</span>
</div>
<div style="position:relative;height:60px">
  <span class="deco" style="position:absolute;left:0;top:0;font-size:48px;opacity:.08">背景大字</span>
  <span class="front" style="position:absolute;left:10px;top:14px">前景正常字</span>
</div>
<p class="pale" style="color:#c8c8c8">浅灰色的说明文字</p>
<button class="tiny-btn" style="width:28px;height:28px;padding:0">×</button>
<span class="micro" style="font-size:8px">小到看不清</span>
<img class="broken" src="missing.png" alt="" width="40" height="40">
<div class="wide" style="width:600px;background:#eee">这一条比屏幕还宽</div>
<div style="overflow-x:auto;width:300px"><div style="width:900px">轮播里的长条，能滚，不算</div></div>
<p>一段话里有个<a href="#x" style="font-size:16px">链接</a>不算点击区</p>
<button class="squeeze" style="width:58px;min-height:44px;font-size:16px">再来一单</button>
<div class="price" style="width:64px;font-size:16px"><b>¥32</b> <span class="take">可外带</span></div>
<p class="orphan" style="width:200px;font-size:16px">今天豆子刚烘好九点前下单就</p>
<p style="width:300px;font-size:16px">一段很长的话里，<span class="flow">跟着文字折行的这几个字</span>不算被挤断行，因为它本来就是正文的一部分，折行很正常。</p>
</body></html>`)
fs.writeFileSync(path.join(site, 'good.html'), head('app') + `
<header style="padding:16px 20px"><h1 style="font-size:24px;margin:0">早上好</h1><p style="margin:4px 0 0;color:#4b5563">今天想喝点什么</p></header>
<main style="padding:0 20px">
  <a href="detail.html" style="display:flex;align-items:center;min-height:48px;padding:0 16px;border-radius:12px;background:#1f2937;color:#fff;text-decoration:none">立即点单</a>
  <p style="color:#4b5563;font-size:14px">满 30 减 5，限今天</p>
  <div style="display:flex;gap:12px"><button style="min-width:44px;height:44px">－</button><span style="line-height:44px">2</span><button style="min-width:44px;height:44px">＋</button></div>
</main>
</body></html>`)
fs.writeFileSync(path.join(site, 'dark.html'), head('web').replace('background:#fff', 'background:#111827;color:#f9fafb') + `
<p style="color:#9ca3af">深色底上的浅灰字，对比度够</p>
<p class="dim" style="color:#374151">深色底上的深灰字，不够</p>
</body></html>`)

// 长文章（网页）：一行太长、图片被拉变形
fs.writeFileSync(path.join(site, 'pic.jpg'), Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDIooor5E/SD//Z', 'base64')) // 16×8
const zh = '设计体检会量一量每一行有多长，'.repeat(12)
const en = 'Long lines are tiring to read because the eye has to travel far back to find the next line. '.repeat(4)
fs.writeFileSync(path.join(site, 'article.html'), head('web') + `
<p class="wide-zh" style="width:1200px">${zh}</p>
<p class="ok-zh" style="max-width:36em">${zh}</p>
<p class="wide-en" style="width:1200px">${en}</p>
<h2 style="width:1200px">${'一行写完的大标题不算'.repeat(3)}</h2>
<img class="squash" src="pic.jpg" alt="" style="width:200px;height:200px">
<img class="cover" src="pic.jpg" alt="" style="width:200px;height:200px;object-fit:cover">
<img class="fine" src="pic.jpg" alt="" style="width:160px;height:80px">
</body></html>`)

// 仿右侧栏：外层页面，iframe 进预览，按 picker 的握手走
const harness = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const src = u.searchParams.get('src') || ''
  const kind = u.searchParams.get('kind') || 'app'
  const [w, h] = (u.searchParams.get('size') || '390x844').split('x')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><body style="margin:0"><iframe id="f" src="${src}" style="width:${w}px;height:${h}px;border:0"></iframe><script>
    const f = document.getElementById('f'); const origin = new URL(${JSON.stringify(src)}).origin
    window.__res = null
    const send = (m) => f.contentWindow.postMessage({ dshDesign: 1, ...m }, origin)
    addEventListener('message', (e) => {
      if (e.origin !== origin || !e.data || e.data.dshDesign !== 1) return
      const d = e.data
      if (d.type === 'hello') send({ type: 'init', seed: null })
      else if (d.type === 'ready') setTimeout(() => send({ type: 'check', id: 'c1', kind: ${JSON.stringify(kind)} }), 300)
      else if (d.type === 'checked') window.__res = d
    })
  </script></body>`)
})
await new Promise((r) => harness.listen(0, '127.0.0.1', r))
const harnessOrigin = `http://127.0.0.1:${harness.address().port}`
const hub = createHub({ parents: () => [harnessOrigin] })

function chromeBin() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const c = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: roots.map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  }
  return [process.env.CHROME_BIN, ...(c[process.platform] || [])].filter(Boolean).find((p) => fs.existsSync(p)) || null
}
function launchChrome(bin) {
  const proc = spawn(bin, ['--remote-debugging-pipe', `--user-data-dir=${path.join(tmp, 'chrome')}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,1000', ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map()
  let seq = 0
  let buf = Buffer.alloc(0)
  proc.stdio[4].on('data', (d) => {
    buf = Buffer.concat([buf, d])
    let i
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'))
      buf = buf.subarray(i + 1)
      const p = msg.id && pending.get(msg.id)
      if (!p) continue
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result)
    }
  })
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    proc.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} 超时`)) }, 30000)
  })
  const close = () => new Promise((r) => {
    if (proc.exitCode !== null) return r()
    if (WIN) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => r())
    else { proc.kill('SIGKILL'); setTimeout(r, 500) }
  })
  return { cdp, close }
}

let chrome = null
try {
  const bin = chromeBin()
  if (!bin) throw new Error('没有 Chrome')
  chrome = launchChrome(bin)
  const entry = await hub.open({ kind: 'file', root: site })
  const run = async (file, kind, size) => {
    const url = `${harnessOrigin}/?src=${encodeURIComponent(`${entry.origin}/${file}`)}&kind=${kind}&size=${size}`
    const { targetId } = await chrome.cdp('Target.createTarget', { url })
    const { sessionId } = await chrome.cdp('Target.attachToTarget', { targetId, flatten: true })
    let res = null
    for (let i = 0; i < 40 && !res; i++) {
      await sleep(250)
      const r = await chrome.cdp('Runtime.evaluate', { expression: 'window.__res', returnByValue: true }, sessionId)
      res = r.result.value
    }
    await chrome.cdp('Target.closeTarget', { targetId })
    return res
  }

  // 拿真设计稿试：node e2e/check-page.mjs --dir <设计目录> [--kind app] [--size 390x844]，只列出报了什么
  const argv = process.argv.slice(2)
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
  if (arg('--dir')) {
    const dir = path.resolve(arg('--dir'))
    const own = await hub.open({ kind: 'file', root: dir })
    for (const f of fs.readdirSync(dir).filter((x) => /\.html?$/i.test(x))) {
      const url = `${harnessOrigin}/?src=${encodeURIComponent(`${own.origin}/${f}`)}&kind=${arg('--kind', 'app')}&size=${arg('--size', '390x844')}`
      const { targetId } = await chrome.cdp('Target.createTarget', { url })
      const { sessionId } = await chrome.cdp('Target.attachToTarget', { targetId, flatten: true })
      let res = null
      for (let i = 0; i < 60 && !res; i++) {
        await sleep(250)
        res = (await chrome.cdp('Runtime.evaluate', { expression: 'window.__res', returnByValue: true }, sessionId)).result.value
      }
      await chrome.cdp('Target.closeTarget', { targetId })
      console.log(`\n${f}：${res ? res.issues.length : '没回话'}`)
      for (const x of (res && res.issues) || []) console.log(`  ${x.sev > 1 ? '!' : '·'} ${x.type} ${x.name}「${x.text}」${JSON.stringify({ ...x, sel: undefined, name: undefined, text: undefined, type: undefined, sev: undefined, rect: undefined })}`)
    }
    process.exit(0)
  }

  const bad = await run('bad.html', 'app', '390x844')
  check('坏页面：报上来了', bad && Array.isArray(bad.issues), JSON.stringify(bad))
  const issues = (bad && bad.issues) || []
  const has = (type, re) => issues.some((x) => x.type === type && (!re || re.test(x.sel + ' ' + x.text)))
  const show = () => issues.map((x) => `${x.type}:${x.name}「${x.text}」`).join(' | ')
  check('截断：overflow:hidden 的长标题', has('clipped', /clip|装不下/), show())
  check('省略号收尾的不报', !issues.some((x) => /省略号/.test(x.text)), show())
  check('超出框：定高的框里字溢出来', has('overflow', /溢出/), show())
  check('重叠：两段字叠在一起', has('overlap', /叠在一起|另一段/), show())
  check('很淡的装饰大字不算重叠', !issues.some((x) => x.type === 'overlap' && /背景大字|前景正常字/.test(x.text + x.otherText)), show())
  const pale = issues.find((x) => x.type === 'contrast' && /浅灰/.test(x.text))
  check('对比度：浅灰字（约 1.7，要 4.5）', pale && pale.ratio < 2 && pale.need === 4.5 && pale.fg === '#C8C8C8' && pale.bg === '#FFFFFF', JSON.stringify(pale))
  const tap = issues.find((x) => x.type === 'tap')
  check('点击区：28×28 的按钮（App 要 44）', tap && tap.w === 28 && tap.h === 28 && tap.min === 44, JSON.stringify(tap))
  check('一段话里的链接不算点击区', !issues.some((x) => x.type === 'tap' && /链接/.test(x.text)), show())
  check('字太小：8px', has('tiny', /看不清/), show())
  check('图片没加载出来', has('img'), show())
  const wide = issues.find((x) => x.type === 'hscroll')
  check('超出屏幕：600 宽的块（屏宽 390）', wide && /这一条/.test(wide.text) && wide.px >= 200, JSON.stringify(wide))
  check('能滚的轮播不算超出屏幕', !issues.some((x) => /轮播/.test(x.text)), show())
  check('挤断行：58 宽的按钮「再来一单」', has('wrap', /squeeze|再来一单/), show())
  check('挤断行：最后一行只剩一两个字', has('wrap', /orphan/), show())
  check('正文里跟着折行的几个字不算挤断行', !issues.some((x) => x.type === 'wrap' && /flow|跟着文字/.test(x.sel + x.text)), show())
  check('严重的排在前面', issues.length > 1 && issues.every((x, i) => i === 0 || issues[i - 1].sev >= x.sev), issues.map((x) => x.sev).join(','))
  check('每条带位置（选择器 + 页面坐标）', issues.filter((x) => x.type !== 'fonts').every((x) => x.sel && x.rect && x.rect.w > 0))

  const good = await run('good.html', 'app', '390x844')
  check('干净的页面：一条都不报', good && good.issues.length === 0, JSON.stringify(good && good.issues))

  const art = await run('article.html', 'web', '1280x800')
  const ai = (art && art.issues) || []
  const longs = ai.filter((x) => x.type === 'long')
  check('一行太长：1200 宽的中文段落、英文段落', longs.length === 2 && longs.some((x) => /wide-zh/.test(x.sel) && x.chars > 45 && x.max === 45) && longs.some((x) => /wide-en/.test(x.sel) && x.max === 90), JSON.stringify(longs))
  check('限宽 36em 的段落、一行写完的标题不算太长', !ai.some((x) => x.type === 'long' && /ok-zh|h2/.test(x.sel)), JSON.stringify(longs))
  const sq = ai.filter((x) => x.type === 'distort')
  check('图片被拉变形：2:1 的图塞进方框；object-fit: cover、按比例的不算', sq.length === 1 && /squash/.test(sq[0].sel) && sq[0].nw === 16 && sq[0].nh === 8 && sq[0].w === 200, JSON.stringify(sq))
  const app = await run('article.html', 'app', '390x844')
  check('App 不查一行太长', !((app && app.issues) || []).some((x) => x.type === 'long'), JSON.stringify(app && app.issues.map((x) => x.type)))

  const dark = await run('dark.html', 'web', '1280x800')
  const dk = (dark && dark.issues) || []
  check('深色底：浅灰字够、深灰字不够', dk.length === 1 && dk[0].type === 'contrast' && /深灰/.test(dk[0].text), JSON.stringify(dk))
} catch (e) {
  check('没有异常', false, (e && e.stack) || e)
} finally {
  if (chrome) await chrome.close()
  harness.close()
  hub.closeAll && hub.closeAll()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  const bad = results.filter((r) => !r.ok).length
  console.log(bad ? `\n❌ ${bad} 项没过` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}
