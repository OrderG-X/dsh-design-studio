#!/usr/bin/env node
// DSH 兼容检查：在一个全新的临时 DSH 里装上这个插件，启动 Web 版，用无头 Chrome 打开一次，
// 看三件事：DSH 肯不肯装（版本范围）、后端有没有启动起来、前端有没有报错。
//
//   node .github/dsh-compat.mjs <plugin.tgz> [--dsh latest|next|<version>] [--cli-dir <目录>] [--keep]
//
// 只碰临时目录：DSH_HOME 和 HOME 都指到 mkdtemp 出来的地方，不会读写真实的 ~/.dsh。
// --cli-dir：DSH 命令行装在这个目录、留着下次用（CI 在 Windows 上缓存它：DSH 有 1.4 GB、9 万多个文件，现装要十几分钟）。
//   每次都先问 npm 这个标签现在是哪个版本，和目录里装的对不上就重装，所以 DSH 出了新版照样测新版。插件本身每次现装。
// 本模板在 dsh-plugins/_ci/，用 _ci/sync.sh 同步进五个仓库；改这里，别改仓库里的副本。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1] }
const keep = args.includes('--keep') && args.splice(args.indexOf('--keep'), 1)
const dshSpec = flag('--dsh', 'latest')
const cliOpt = flag('--cli-dir', '')
const tgz = path.resolve(args[0] || '')
if (!args[0] || !fs.existsSync(tgz)) { console.error('用法: node dsh-compat.mjs <plugin.tgz> [--dsh latest|next|<版本>]'); process.exit(2) }

const REGISTRY = 'https://registry.npmjs.org/'
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compat-')))
const env = { ...process.env, DSH_HOME: path.join(tmp, 'dsh-home'), HOME: path.join(tmp, 'home'), npm_config_registry: REGISTRY }
for (const d of [env.DSH_HOME, env.HOME]) fs.mkdirSync(d, { recursive: true })

const problems = []
const notes = []
const OS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform
const WIN = process.platform === 'win32'
let server = null
let chrome = null

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { env, encoding: 'utf8', maxBuffer: 64 << 20, ...opts })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' }
}
// Windows 上 kill() 只结束进程本身，DSH 和 Chrome 的子进程要连根拔掉，不然临时目录删不掉
function stop(p, signal) {
  if (!p || p.exitCode !== null) return
  try { WIN ? spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { timeout: 30_000 }) : p.kill(signal) } catch {}
}
function finish() {
  stop(server, 'SIGTERM')
  stop(chrome, 'SIGKILL')
  const ok = problems.length === 0
  const lines = [
    `## ${OS} · DSH ${dshVersion || dshSpec} · ${pkgName || path.basename(tgz)}`,
    ok ? '✅ 兼容：装得上、后端启动、前端无报错' : '❌ 不兼容',
    ...problems.map((p) => `- ❌ ${p}`),
    ...notes.map((n) => `- ℹ️ ${n}`),
  ]
  console.log('\n' + lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n')
  if (keep) console.log('临时目录保留在', tmp)
  else try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) } catch (e) { console.log('临时目录没删干净：', e.message) }
  process.exit(ok ? 0 : 1)
}
let dshVersion = ''
let pkgName = ''

// 1. 装指定版本的 DSH 命令行，外加它装插件要用的 pnpm（GitHub 的机器上默认没有）
const npm = WIN ? 'npm.cmd' : 'npm'
const npmFlags = [`--registry=${REGISTRY}`, '--no-audit', '--no-fund', '--loglevel=error']
const installCli = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}')
  return run(npm, ['i', `@deepseek-ai/dsh@${dshSpec}`, 'pnpm@11', ...npmFlags], { cwd: dir, shell: WIN })
}
let cliRoot = path.join(tmp, 'cli')
let inst
if (cliOpt) {
  // 这个标签现在指哪个版本（每次现问，DSH 出新版就对不上、重装）；装好的目录里记着装的是哪个版本、哪个 node
  cliRoot = path.resolve(cliOpt)
  const stampFile = path.join(cliRoot, 'dsh-compat.json')
  const view = run(npm, ['view', `@deepseek-ai/dsh@${dshSpec}`, 'version', '--json', ...npmFlags], { cwd: tmp, shell: WIN })
  let want = ''
  try { want = [].concat(JSON.parse(view.stdout.trim())).pop() || '' } catch {}
  let stamp = null
  try { stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')) } catch {}
  const node = process.versions.modules
  if (want && stamp?.dsh === want && stamp.node === node && fs.existsSync(path.join(cliRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) {
    inst = { code: 0, out: '' }
    console.log(`用装好的 DSH 命令行（${want}）：${cliRoot}`)
  } else {
    // 先装在旁边，装成了再挪过去：装到一半失败不会留下一个看着像装好了的目录被缓存
    const fresh = `${cliRoot}.new`
    inst = installCli(fresh)
    if (inst.code === 0) {
      const v = JSON.parse(fs.readFileSync(path.join(fresh, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
      fs.writeFileSync(path.join(fresh, 'dsh-compat.json'), JSON.stringify({ dsh: v, node }))
      fs.rmSync(cliRoot, { recursive: true, force: true })
      fs.renameSync(fresh, cliRoot)
    }
  }
} else {
  inst = installCli(cliRoot)
}
const PATH_KEY = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH' // Windows 上叫 Path
env[PATH_KEY] = `${path.join(cliRoot, 'node_modules', '.bin')}${path.delimiter}${env[PATH_KEY]}`
if (inst.code !== 0) { problems.push(`装不上 @deepseek-ai/dsh@${dshSpec}（npm 退出码 ${inst.code}）\n\n${inst.out.slice(-2000)}`); finish() }
const cliDir = path.join(cliRoot, 'node_modules', '@deepseek-ai', 'dsh')
dshVersion = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')).version
const dsh = (argv, opts) => run(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), ...argv], opts)
console.log(`DSH ${dshVersion}（${dshSpec}）`)

// 启动 Web 版：proc 是进程，url 等它打印地址（没起来是 null），log() 是到现在为止的输出
function startWeb() {
  let text = ''
  let proc = null
  const url = new Promise((resolve) => {
    proc = spawn(process.execPath, [path.join(cliDir, 'lib', 'bin.js'), 'web', '--no-open', '--port', '0', '--host', '127.0.0.1'], { env, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] })
    const on = (d) => { text += d; const m = /dsh web: (http:\/\/\S+)/.exec(text); if (m) resolve(m[1]) }
    proc.stdout.on('data', on)
    proc.stderr.on('data', on)
    proc.on('exit', () => resolve(null))
    setTimeout(() => resolve(null), 180_000)
  })
  return { proc, url, log: () => text }
}
const startupErrors = (text) => text.split(/\n(?=\S)/).filter((b) => /did not activate|incompatible|Error/i.test(b)).map((b) => b.trim())
// 没启动的条目单独一段：「image-offload (@deepseek-ai/dsh-compaction-image-offload): Error: …」，按开头的「名字 (包名):」认
const entryOf = (b) => (/^(\S+ \([^()\s]+\)):/.exec(b) || [])[1] || null

// 1b. 先不装插件起一次，记下 DSH 自己启动就有的报错：后面只有「装上插件后多出来的」才算插件的事
// 起不来就再试一次；还不行就算检查失败（没有基线就看不出插件挤掉了 DSH 自带的哪部分，不能当兼容通过）
let baseline = null
for (let attempt = 1; attempt <= 2 && !baseline; attempt++) {
  const bare = startWeb()
  if (await bare.url) {
    await new Promise((r) => setTimeout(r, 3000))
    baseline = new Set(startupErrors(bare.log()).map(entryOf).filter(Boolean))
  } else if (attempt === 2) {
    problems.push(`不装插件时 Web 版两次都没起来，没法和装插件后比对启动报错\n\n${bare.log().slice(-2000)}`)
  }
  const exited = new Promise((r) => (bare.proc.exitCode !== null ? r() : bare.proc.once('exit', r)))
  stop(bare.proc, 'SIGTERM')
  await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))])
}

// 2. 用 DSH 自己的插件安装把 tgz 装进 web 配置（版本不兼容时这里就会被拒）
const add = dsh(['plugin', '--profile', 'web', 'add', tgz], { cwd: tmp })
const profile = path.join(env.DSH_HOME, 'profiles', 'web')
if (add.code !== 0) {
  const rejected = (add.out.match(/installation rejected:[^\n]*/) || [])[0]
  const why = rejected || add.out.split('\n').filter((l) => /dsh:|ERR/.test(l)).join('\n')
  problems.push(`DSH ${dshVersion} ${rejected ? '拒绝安装' : '安装失败'}：${why.slice(0, 1500)}`)
  finish()
}
const pj = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
pkgName = Object.keys(pj.dependencies || {}).find((n) => String(pj.dependencies[n]).includes(path.basename(tgz))) || ''
if (!pkgName) { problems.push('装完了但在配置里找不到这个包'); finish() }
const clientWanted = (() => {
  try { return Boolean(JSON.parse(fs.readFileSync(path.join(profile, 'node_modules', pkgName, 'package.json'), 'utf8')).dsh?.client) } catch { return false }
})()
console.log(`已安装 ${pkgName}`)

// 2b. 配置里引用的 DSH 自带插件（比如照抄标准模式的预设）在这个版本里都还在：少一个，引用它的那一组就整个起不来，日志里也不一定有字
{
  const pkgDir = path.join(profile, 'node_modules', pkgName)
  let text = ''
  const patch = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).dsh?.bundle?.patch
  for (const f of [].concat(patch || [])) { // 一个路径或一组路径
    try { text += fs.readFileSync(path.join(pkgDir, f), 'utf8') + '\n' } catch (e) { problems.push(`读不到 dsh.bundle.patch 写的 ${f}：${e.message}`) }
  }
  text = text.replace(/(^|\s)#.*$/gm, '$1') // YAML 注释里的插件名不算
  const refs = [...new Set([...text.matchAll(/^\s*(?:-\s+)?name:\s*['"]?(@deepseek-ai\/[\w.-]+(?:\/[\w./-]+)?)/gm)].map((m) => m[1]))]
  const roots = [path.join(cliRoot, 'node_modules'), path.join(cliDir, 'node_modules'), path.join(profile, 'node_modules')]
  // exports 里有这个子路径：照写的键，或 "./x/*" 这种通配
  const exported = (ex, sub) => Object.keys(ex).some((k) => k === sub || (k.includes('*') && new RegExp(`^${k.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`).test(sub)))
  const gone = refs.filter((ref) => {
    const [scope, base, ...sub] = ref.split('/')
    const dir = roots.map((r) => path.join(r, scope, base)).find((d) => fs.existsSync(path.join(d, 'package.json')))
    if (!dir) return true
    if (!sub.length) return false
    const ex = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).exports
    return Boolean(ex && typeof ex === 'object') && !exported(ex, `./${sub.join('/')}`) // 没写 exports 的不好判断，放过
  })
  if (gone.length) problems.push(`配置里引用的 DSH 插件在 ${dshVersion} 里没有了：${gone.join('、')}（引用它们的那一组会整个起不来）`)
}

// 3. 启动 Web 版，等它打印地址；启动日志里「did not activate」提到我们就算失败。
//    没提我们、但比不装插件时多了没启动的部分，也算失败：多半是插件挤掉了 DSH 自带的部分（比如抢注同名的东西，桥 #4）
const web = startWeb()
server = web.proc
const url = await web.url
const log = web.log()
if (!url) { problems.push(`Web 版没起来\n\n${log.slice(-3000)}`); finish() }
await new Promise((r) => setTimeout(r, 3000))
const mentions = (s) => s.includes(pkgName) || s.includes(pkgName.replace(/^@[^/]+\//, ''))
const failed = startupErrors(web.log())
// 不装插件时好好的条目、装上后报错了：多半是被插件挤掉的（比如抢先注册了它要注册的东西）
const extra = baseline ? failed.filter((b) => !mentions(b) && entryOf(b) && !baseline.has(entryOf(b))) : []
for (const b of failed) {
  if (mentions(b)) problems.push(`启动日志：${b.slice(0, 1500)}`)
  else if (extra.includes(b)) problems.push(`装上插件后 DSH 自带的部分没启动（不装插件时没有这条）：${b.slice(0, 1500)}`)
  else notes.push(`启动日志：${b.slice(0, 1500)}`)
}

// 4. 无头 Chrome 打开一次：我们的前端模块要被加载（200），而且不能有未捕获的异常
const chromeBin = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .flatMap((d) => [path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
].find((p) => fs.existsSync(p))
if (!chromeBin) { notes.push('没找到 Chrome，跳过前端检查'); finish() }
chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-sandbox',
  `--user-data-dir=${path.join(tmp, 'chrome')}`, '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve) => {
  let b = ''
  chrome.stderr.on('data', (d) => { b += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) resolve(m[1]) })
  setTimeout(() => resolve(null), 30_000)
})
if (!wsUrl) { notes.push('Chrome 没起来，跳过前端检查'); finish() }
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else if (m.method) events.push(m)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
for (const d of ['Runtime', 'Log', 'Network', 'Page']) await send(`${d}.enable`)
await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, 15_000))

const responses = events.filter((e) => e.method === 'Network.responseReceived').map((e) => e.params.response)
const clientPath = `${pkgName}/client.js`
const clientRes = responses.filter((r) => r.url.includes(clientPath))
if (clientWanted && !clientRes.length) problems.push(`前端模块 ${clientPath} 没被加载`)
for (const r of clientRes) if (r.status !== 200) problems.push(`前端模块加载失败：HTTP ${r.status}`)
for (const e of events) {
  if (e.method === 'Runtime.exceptionThrown') {
    const d = e.params.exceptionDetails
    const text = `${d.exception?.description || d.text} @ ${d.url || ''}`
    problems.push(`前端未捕获异常：${text.slice(0, 1500)}`)
  }
  if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
    const text = e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    ;(mentions(text) ? problems : notes).push(`前端 console.error：${text.slice(0, 800)}`)
  }
}
const title = await send('Runtime.evaluate', { expression: 'document.title' })
if (!/DeepSeek/i.test(title.result?.result?.value || '')) problems.push(`页面没打开（标题：${title.result?.result?.value}）`)
ws.close()
finish()
