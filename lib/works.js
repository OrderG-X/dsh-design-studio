/**
 * 我的作品库（设计库 › 我的作品）和「哪些文件是别人做的」的记录。
 *
 *   <库>/works.json   { format: 1, works: [{ dir, title, kind, screens, added, updated, seen, pinned, hidden, hiddenAt, trust, hashes, pastHashes, from }] }
 *     trust：'market'（设计库市场来的）/ 'zip'（拖进来的 zip）/ 不写（自己做的）
 *     hidden：用户「移出列表」了（只藏记录，不动文件夹，trust 也留着：藏起来的照样按别人做的预览）；
 *             之后又在这个目录上做设计（seen 比 hiddenAt 新）就重新显示
 *     hashes：别人做的那些 HTML 落地时的 sha256；文件内容还和它一样，预览时就加硬规矩（不准跑脚本、不准联网、不准跳走），
 *             模型改过（内容变了）就当用户自己的，恢复普通预览
 *     pastHashes：同一个目录以前装过的各版的 HTML 哈希（去重，留最近 PAST_MAX 个；就地更新时记下以前各版的、退回旧版前记下退回来的，这些页面照样加规矩。版本快照本身的预览见 strictVersions）
 *
 * 记录放在插件自己的数据目录（~/.dsh/dsh-design-studio/），不放设计目录：模型能写设计目录，信任记号不能让它改。
 * 测试时用环境变量 DSH_DESIGN_LIBRARY_DIR 换位置。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一套装好的设计系统最多记多少个旧页面哈希（去重后；只有退回旧版、或就地更新时才会加） */
export const PAST_MAX = 4000

/** 旧哈希合进去：去重，新加的排最后（不会先被挤掉），现在这版的（cur）不用记，留最近 PAST_MAX 个 */
export function mergePast(old, add, cur = new Set()) {
  const ok = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)
  const all = [...(Array.isArray(old) ? old.flat() : []), ...(add || [])].filter(ok)
  const seen = new Set()
  const out = []
  for (let i = all.length - 1; i >= 0; i--) if (!seen.has(all[i]) && !cur.has(all[i])) { seen.add(all[i]); out.unshift(all[i]) }
  return out.slice(-PAST_MAX)
}

export const LIBRARY_DIR = process.env.DSH_DESIGN_LIBRARY_DIR || path.join(os.homedir(), '.dsh', 'dsh-design-studio')
const MAX_WORKS = 2000

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** 真实路径；还不存在的部分接在最近一层存在的目录的真实路径后面（/var → /private/var 这种也对得上） */
function realOf(p) {
  let cur = path.resolve(p)
  const rest = []
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()) } catch { /* 往上找 */ }
    const up = path.dirname(cur)
    if (up === cur) break
    rest.push(path.basename(cur))
    cur = up
  }
  return path.resolve(p)
}

export function createLibrary({ dir = LIBRARY_DIR, log = () => {} } = {}) {
  const file = path.join(dir, 'works.json')
  let cache = null
  let cacheKey = ''
  let hashSet = null // 所有「别人做的、还没改过」的 HTML 的 sha256
  let roots = null // 别人做的设计在哪些目录（真实路径）
  let sysRoots = null // 其中装好的设计系统

  function load() {
    let st = null
    try { st = fs.statSync(file) } catch { st = null }
    const key = st ? `${st.mtimeMs}:${st.size}` : 'none'
    if (cache && key === cacheKey) return cache
    let data = { format: 1, works: [] }
    if (st) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (raw && Array.isArray(raw.works)) data = { format: 1, works: raw.works.filter((w) => w && typeof w.dir === 'string') }
      } catch (e) {
        log(e)
        // 写坏了：留一份，重新开始（不能让一个坏文件弄得设计台打不开）
        try { fs.copyFileSync(file, `${file}.bad-${Date.now()}`) } catch { /* 算了 */ }
      }
    }
    cache = data
    cacheKey = key
    hashSet = null
    roots = null
    sysRoots = null
    return data
  }

  function save(data) {
    data.works = data.works.slice(-MAX_WORKS)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 })
    fs.renameSync(tmp, file)
    cache = null
    load()
  }

  function index() {
    if (hashSet) return
    const data = load()
    hashSet = new Set()
    roots = new Set()
    sysRoots = new Set()
    for (const w of data.works) {
      if (w.trust !== 'market' && w.trust !== 'zip') continue
      roots.add(realOf(w.dir))
      if (w.kind === 'system') sysRoots.add(realOf(w.dir))
      for (const h of [...Object.values(w.hashes || {}), ...(Array.isArray(w.pastHashes) ? w.pastHashes.flat() : [])]) if (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) hashSet.add(h)
    }
  }

  /** 这份 HTML 是不是别人做的、还没改过（要加硬规矩预览） */
  function strictHtml(buf) {
    index()
    return hashSet.size > 0 && hashSet.has(sha256(buf))
  }

  /** 这个目录（或它里面）是别人做的设计吗（SVG 当页面打开时也加规矩） */
  function strictRoot(root) {
    index()
    if (!roots.size) return false
    const r = realOf(root)
    for (const x of roots) if (r === x || r.startsWith(x + path.sep)) return true
    return false
  }

  /**
   * 这个目录（或它里面）是装好的别人的设计系统吗：它的旧版本快照里的页面一律加规矩
   * （系统会就地更新，旧版本里哪些页面是别人原样的，不靠记下的哈希猜）
   */
  function strictVersions(root) {
    index()
    if (!sysRoots.size) return false
    const r = realOf(root)
    for (const x of sysRoots) if (r === x || r.startsWith(x + path.sep)) return true
    return false
  }

  /**
   * 从版本记录退回旧版之前：退回来的页面在装好的别人的设计系统目录里 → 它们的哈希记进那套的 pastHashes
   * （和旧版本快照预览一样，一律按别人做的加规矩；之后再改过就是自己的）。不是这种目录 → false
   */
  function addPast(root, hashes) {
    const r = realOf(root)
    const data = load()
    const w = data.works.find((x) => (x.trust === 'market' || x.trust === 'zip') && x.kind === 'system' && (r === realOf(x.dir) || r.startsWith(realOf(x.dir) + path.sep)))
    if (!w) return false
    const past = mergePast(w.pastHashes, hashes, new Set(Object.values(w.hashes || {})))
    put(w.dir, { pastHashes: past.length ? past : undefined })
    return true
  }

  /** 找一套（按目录） */
  function get(d) {
    const r = realOf(d)
    return load().works.find((w) => realOf(w.dir) === r) || null
  }

  /** 记一套（有就合并）：别人做的要带 trust 和 hashes */
  function put(d, info) {
    const data = load()
    const r = realOf(d)
    const now = Date.now()
    let w = data.works.find((x) => realOf(x.dir) === r)
    if (!w) {
      w = { dir: path.resolve(d), added: now }
      data.works.push(w)
    }
    for (const [k, v] of Object.entries(info || {})) {
      if (v === undefined) delete w[k]
      else w[k] = v
    }
    w.updated = now
    save(data)
    return w
  }

  /** 移出列表：只藏起来（不动文件夹；别人做的那份信任记录要留着，不然藏起来的设计就按普通预览了） */
  function hide(d) {
    const w = get(d)
    if (!w) return false
    put(d, { hidden: true, hiddenAt: Date.now(), pinned: undefined })
    return true
  }

  /**
   * 设计台缓存里记着的会话（tracker 的 saved：会话 → { target, source, design, kind, at }）→ 补进作品库：
   * 本地文件、在做设计（模型调了预览工具 / 用户自己打开 / 记着 design）、目录还在、不是家目录或根目录
   * 已有的只更新最近一次看到的时间；藏起来的、后来又做过的重新显示。有变化才写盘
   */
  function sync(saved, { home = os.homedir() } = {}) {
    const data = load()
    const byReal = new Map(data.works.map((w) => [realOf(w.dir), w]))
    const homeReal = realOf(home)
    let changed = false
    for (const rec of Object.values(saved || {})) {
      const t = rec && rec.target
      if (!t || t.kind !== 'file' || typeof t.root !== 'string') continue
      if (!(rec.design || rec.source === 'tool' || rec.source === 'user')) continue
      const r = realOf(t.root)
      if (r === homeReal || path.dirname(r) === r) continue
      const at = Number(rec.at) || 0
      let w = byReal.get(r)
      if (!w) {
        try { if (!fs.statSync(r).isDirectory()) continue } catch { continue }
        w = { dir: r, added: at || Date.now(), seen: at, ...(rec.kind ? { kind: rec.kind } : {}) }
        data.works.push(w)
        byReal.set(r, w)
        changed = true
        continue
      }
      // 最近看到的时间一分钟内不重复写（每次切屏、换视图都会记一次）
      if (at > (w.seen || 0) + 60000 || (w.hidden && at > (w.hiddenAt || 0))) {
        w.seen = at
        if (rec.kind && !w.kind) w.kind = rec.kind
        if (w.hidden && at > (w.hiddenAt || 0)) { delete w.hidden; delete w.hiddenAt }
        changed = true
      }
    }
    if (changed) save(data)
    return changed
  }

  /** 文件夹挪走了、用户重新定位：记录搬到新目录（信任记号跟着走：按内容哈希认，内容没变照样算别人做的） */
  function move(from, to) {
    const data = load()
    const r = realOf(from)
    const w = data.works.find((x) => realOf(x.dir) === r)
    if (!w) return null
    const t = realOf(to)
    data.works = data.works.filter((x) => x === w || realOf(x.dir) !== t)
    w.dir = path.resolve(to)
    w.updated = Date.now()
    delete w.hidden
    delete w.hiddenAt
    save(data)
    return w
  }

  return { strictHtml, strictRoot, strictVersions, addPast, get, put, hide, move, sync, list: () => load().works.slice(), file }
}
