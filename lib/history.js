/**
 * 设计版本：本地文件预览的目录，每轮对话前后各存一份，能翻回去看、和现在对比、回到那一版。
 *
 *   <base>/<目录哈希>/index.json          [{ n, at, label, files: { 相对路径: sha1 } }]，旧的在前
 *   <base>/<目录哈希>/objects/<sha1>      文件内容（按内容存，几版之间没改的文件只存一份）
 *
 * 只存做设计用的文件（HTML / CSS / JS / 图片 / 字体，单个 ≤ 2MB，一共 ≤ 30MB、≤ 300 个），
 * 跳过 node_modules、.git、隐藏目录、exports/（导出的图片）和 refs/（参考图）。目录太大（多半是整个项目）就不存。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const KEEP_EXT = /\.(html?|css|m?js|json|svg|txt|md|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i
const SKIP_DIR = /^(node_modules|\.git|\.next|\.cache|\.turbo|dist|build|exports|refs)$|^\./
const MAX_FILE = 2 * 1024 * 1024
const MAX_TOTAL = 30 * 1024 * 1024
const MAX_FILES = 300
const MAX_SCAN = 3000 // 最多看这么多个目录项，再多就当不是设计目录
const MAX_DEPTH = 3
const MAX_VERSIONS = 40

const HASH = /^[0-9a-f]{40}$/

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

/** 某一版里这个文件的内容哈希：只认它自己的键（toString / __proto__ 这种名字不会摸到原型上去），格式不对给 null */
function hashOf(v, key) {
  const files = v && v.files
  if (!files || typeof files !== 'object' || !Object.hasOwn(files, key)) return null
  return typeof files[key] === 'string' && HASH.test(files[key]) ? files[key] : null
}

/** dest 写下去会落在哪个真实目录里（还没建的几层往上找已有的那层）；那层是坏掉的软链接给 null */
function realParent(dest) {
  let dir = path.dirname(dest)
  for (;;) {
    try { fs.lstatSync(dir); break } catch { /* 还没有这一层 */ }
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
  try { return fs.realpathSync(dir) } catch { return null }
}

/** 目录里要存的文件 → { 相对路径: 绝对路径 }；不像设计目录（太大）给 null */
export function collect(root) {
  const out = {}
  let scanned = 0
  let count = 0
  let total = 0
  const walk = (dir, rel, depth) => {
    let list
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return true }
    for (const d of list) {
      if (++scanned > MAX_SCAN) return false
      const r = rel ? rel + '/' + d.name : d.name
      const abs = path.join(dir, d.name)
      if (d.isDirectory()) {
        if (SKIP_DIR.test(d.name) || depth >= MAX_DEPTH) continue
        if (!walk(abs, r, depth + 1)) return false
        continue
      }
      if (!d.isFile() || d.name.startsWith('.') || !KEEP_EXT.test(d.name)) continue
      let st
      try { st = fs.statSync(abs) } catch { continue }
      if (st.size > MAX_FILE) continue
      if (++count > MAX_FILES || (total += st.size) > MAX_TOTAL) return false
      out[r] = abs
    }
    return true
  }
  return walk(root, '', 0) ? out : null
}

/** 两版之间改了哪些文件（新增、改了、删了） */
export function diffFiles(a = {}, b = {}) {
  const changed = []
  for (const k of Object.keys(b)) if (a[k] !== b[k]) changed.push(k)
  for (const k of Object.keys(a)) if (!(k in b)) changed.push(k)
  return changed.sort()
}

/**
 * @param opts.base 存放目录
 * @param opts.now  取时间（测试用）
 */
export function createHistory({ base, now = Date.now, log = () => {} }) {
  const dirOf = (root) => path.join(base, sha1(path.resolve(root)).slice(0, 16))
  const sigs = new Map() // root → 上次存的时候各文件的大小 + 修改时间（没变就不用再读一遍算哈希）

  function load(root) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dirOf(root), 'index.json'), 'utf8'))
      return Array.isArray(list) ? list : []
    } catch { return [] }
  }

  function save(root, list) {
    const dir = dirOf(root)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `index.json.${process.pid}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(list))
    fs.renameSync(tmp, path.join(dir, 'index.json'))
  }

  /** 旧版本删掉后，没人用的文件内容一起清掉 */
  function gc(root, list) {
    const keep = new Set()
    for (const v of list) for (const h of Object.values(v.files)) keep.add(h)
    const objDir = path.join(dirOf(root), 'objects')
    let names = []
    try { names = fs.readdirSync(objDir) } catch { return }
    for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(objDir, n), { force: true })
  }

  /**
   * 存一版：和最近一版一模一样就不存。
   * @returns 新的一版 { n, at, label, files } / null（没变、不像设计目录、出错）
   */
  function snapshot(root, label = '') {
    try {
      return take(root, label, false)
    } catch (e) {
      log(e)
      return null
    }
  }

  /** snapshot 的本体：出错直接抛；strict 时目录太大（存不下）也抛 */
  function take(root, label, strict) {
    const found = collect(root)
    if (!found && strict) throw new Error('目录太大（多半是整个项目），存不了现在的样子')
    if (!found || !Object.keys(found).length) return null
    let sig = ''
    for (const [rel, abs] of Object.entries(found)) {
      try { const st = fs.statSync(abs); sig += `${rel}:${st.size}:${st.mtimeMs}\n` } catch { /* 刚删 */ }
    }
    if (sigs.get(root) === sig && load(root).length) return null
    const objDir = path.join(dirOf(root), 'objects')
    fs.mkdirSync(objDir, { recursive: true })
    const files = {}
    for (const [rel, abs] of Object.entries(found)) {
      let buf
      try { buf = fs.readFileSync(abs) } catch { continue }
      const h = sha1(buf)
      const obj = path.join(objDir, h)
      if (!fs.existsSync(obj)) fs.writeFileSync(obj, buf)
      files[rel] = h
    }
    const list = load(root)
    const last = list[list.length - 1]
    if (last && !diffFiles(last.files, files).length) { sigs.set(root, sig); return null }
    const v = { n: last ? last.n + 1 : 1, at: now(), label: String(label || '').slice(0, 80), files }
    list.push(v)
    const cut = list.length > MAX_VERSIONS ? list.splice(0, list.length - MAX_VERSIONS) : []
    save(root, list)
    sigs.set(root, sig) // 真存上了才记（存到一半出错，下次还得重存）
    if (cut.length) { try { gc(root, list) } catch (e) { log(e) } }
    return v
  }

  /** 给右侧栏的版本列表：新的在前，带改了哪些文件（最早的一版带一共几个文件） */
  function list(root) {
    const all = load(root)
    return all.map((v, i) => ({
      n: v.n,
      at: v.at,
      label: v.label,
      changed: i ? diffFiles(all[i - 1].files, v.files) : [], // 最早的一版没得比
      first: !i,
      count: Object.keys(v.files).length,
      screens: Object.keys(v.files).filter((f) => /^[^/]+\.html?$/i.test(f)),
    })).reverse()
  }

  /** 某一版里某个文件存在哪（给预览服务器读）；没有给 null */
  function fileOf(root, n, rel) {
    const v = load(root).find((x) => x && x.n === Number(n))
    if (!v) return null
    const key = String(rel || '').replace(/^\/+/, '') || 'index.html'
    const h = hashOf(v, key) || (key.endsWith('/') ? hashOf(v, key + 'index.html') : null)
    return h ? path.join(dirOf(root), 'objects', h) : null
  }

  /**
   * 回到某一版：先把那一版的文件全读出来，再把现在的存一版（随时能再切回来），最后写回目录。
   * 先读：存「回退前」那一版时满 40 版会裁掉最旧的，要回的正好是它的话内容会被一起清掉。
   * 现在的存不下（目录太大、出错）就不回，免得盖掉没存过的改动；
   * 要被盖掉的文件有没进存档的（单个超过 2MB、读不了）也整次不回，说明是哪几个。
   * 那一版之后新加的文件不删；落到目录外的（父目录是指到外面的软链接）不写。
   * @returns { restored: 文件数, saved: 回退前存的那一版 | null }
   */
  function restore(root, n) {
    const v = load(root).find((x) => x && x.n === Number(n))
    if (!v) throw new Error(`没有第 ${n} 版`)
    const objDir = path.join(dirOf(root), 'objects')
    const wanted = []
    for (const rel of Object.keys(v.files || {})) {
      const h = hashOf(v, rel)
      let buf = null
      try { buf = h && fs.readFileSync(path.join(objDir, h)) } catch { buf = null }
      if (!buf) throw new Error(`第 ${n} 版的文件不全（${rel}），没有回退`)
      wanted.push([rel, buf])
    }
    let saved
    try {
      saved = take(root, '回退前', true)
    } catch (e) {
      log(e)
      throw new Error(`回退前没能先存一份现在的样子（${e.message}），没有回退`)
    }
    const realRoot = fs.realpathSync(root)
    const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep)
    const latest = load(root).at(-1) // 现在的样子（刚存的「回退前」，或和它一样的上一版）
    const plan = []
    const unsaved = []
    for (const [rel, buf] of wanted) {
      const dest = path.resolve(realRoot, rel)
      if (!dest.startsWith(realRoot + path.sep)) continue // 不往目录外写
      try { if (fs.lstatSync(dest).isSymbolicLink()) continue } catch { /* 现在没有这个文件 */ }
      const parent = realParent(dest)
      if (!parent || !inside(parent)) continue // 父目录是指到外面的软链接：不顺着写出去
      let cur = null
      try { cur = fs.readFileSync(dest) } catch { /* 现在没有这个文件 */ }
      if (cur && cur.equals(buf)) continue
      // 要盖掉的内容得在存档里（超过 2MB 的文件存档时被跳过，盖了就找不回来）
      if (cur && hashOf(latest, rel) !== sha1(cur)) unsaved.push(rel)
      plan.push([dest, buf])
    }
    if (unsaved.length) {
      throw new Error(`${unsaved.slice(0, 5).join('、')}${unsaved.length > 5 ? ` 等 ${unsaved.length} 个文件` : ''}现在的内容没法存进版本（单个超过 2MB 或读不了），回退会把它盖掉、找不回来，所以没有回退`)
    }
    let restored = 0
    for (const [dest, buf] of plan) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, buf)
      restored++
    }
    return { restored, saved }
  }

  return { snapshot, list, fileOf, restore, dirOf }
}
