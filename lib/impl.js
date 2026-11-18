/**
 * 「和做出来的比」（#25）：设计稿的每一屏对应做出来的哪个页面、上次比对差了多少
 *
 *   - 模型调 compare_design、用户在右侧栏填地址 / 点「重新比」都记一笔：地址、整屏还是只比槽位、深色、尺寸、差异 %、红框
 *   - 按设计目录分开记，存在 ~/.dsh/cache/dsh-design-studio/impl.json（重开 DSH 还在）；最近的拼图只留在内存里
 *   - 右侧栏轮询的状态里带上正在看的设计那份（list），对比视图据此打开真页面、显示分数
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const IMPL_FILE = path.join(os.homedir(), '.dsh', 'cache', 'dsh-design-studio', 'impl.json')
const MAX_ROOTS = 100 // 最多记这么多个设计目录（最久没碰的先丢）
const MAX_KEYS = 60 // 一个设计最多这么多屏（和屏数上限一样）
const MAX_SHOTS = 24 // 内存里留几张拼图

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const box = (b) => (b && typeof b === 'object' ? { x: Math.round(num(b.x) || 0), y: Math.round(num(b.y) || 0), w: Math.round(num(b.w) || 0), h: Math.round(num(b.h) || 0) } : null)

/** 一屏的记录：只留认得的字段（文件可能被手改过） */
export function cleanRec(r) {
  if (!r || typeof r !== 'object' || typeof r.url !== 'string' || !r.url || r.url.length > 2000) return null
  const out = { url: r.url, whole: r.whole === true, dark: r.dark === true, at: r.at === 'bottom' ? 'bottom' : 'top', by: r.by === 'user' ? 'user' : 'model', when: num(r.when) || 0 }
  if (Array.isArray(r.size) && r.size.length === 2 && r.size.every((n) => Number.isInteger(n) && n > 0 && n < 20000)) out.size = [r.size[0], r.size[1]]
  if (num(r.pct) != null) {
    out.pct = Math.round(r.pct * 10) / 10
    out.boxes = (Array.isArray(r.boxes) ? r.boxes : []).slice(0, 6).map(box).filter((b) => b && b.w > 0 && b.h > 0)
    if (Array.isArray(r.cmp) && r.cmp.length === 2 && r.cmp.every((n) => Number.isInteger(n) && n > 0)) out.cmp = [r.cmp[0], r.cmp[1]] // 比的那块多大（套了外框是槽位）
    out.slot = r.slot === true
  }
  return out
}

export function createImpl({ file = IMPL_FILE, log = () => {}, now = Date.now } = {}) {
  let data = null // { [设计目录]: { used, screens: { [屏]: 记录 } } }
  const shots = new Map() // `${目录}\n${屏}` → jpg（Buffer）
  let timer = null

  function load() {
    if (data) return data
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { data = {} }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {}
    return data
  }
  function flush() {
    clearTimeout(timer)
    timer = null
    if (!data) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data))
      fs.renameSync(tmp, file)
    } catch (e) { log(e) }
  }
  function save() {
    clearTimeout(timer)
    timer = setTimeout(flush, 400)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  /** 这个设计每屏记着的（只读的拷贝，认不出的不给） */
  function list(root) {
    const d = load()[root]
    if (!d || !d.screens || typeof d.screens !== 'object') return {}
    const out = {}
    for (const [k, r] of Object.entries(d.screens)) {
      const c = cleanRec(r)
      if (c) out[k] = c
    }
    return out
  }
  const get = (root, key) => list(root)[key] || null

  /** 记一笔：patch 合进去；换了地址就把旧分数清掉（那是别的页面的分） */
  function set(root, key, patch) {
    if (!root || !key || typeof key !== 'string' || key.length > 300) return null
    const all = load()
    const d = all[root] && typeof all[root] === 'object' ? all[root] : { screens: {} }
    if (!d.screens || typeof d.screens !== 'object') d.screens = {}
    const was = cleanRec(d.screens[key])
    let next = { ...(was || {}), ...patch, when: now() }
    if (was && patch.url && patch.url !== was.url && patch.pct === undefined) {
      next = { ...next }
      delete next.pct
      delete next.boxes
      delete next.cmp
      delete next.slot
      // 整屏比、比到底是给原来那个页面定的（比如原来的页面连外框一起做了）：换了页面回到默认，除非这次说了
      if (patch.whole === undefined) next.whole = false
      if (patch.at === undefined) next.at = 'top'
      shots.delete(`${root}\n${key}`)
    }
    const rec = cleanRec(next)
    if (!rec) return null
    d.screens[key] = rec
    const keys = Object.keys(d.screens)
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => (d.screens[a].when || 0) - (d.screens[b].when || 0))
      for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete d.screens[k]
    }
    d.used = now()
    all[root] = d
    const roots = Object.keys(all)
    if (roots.length > MAX_ROOTS) {
      roots.sort((a, b) => (all[a].used || 0) - (all[b].used || 0))
      for (const r of roots.slice(0, roots.length - MAX_ROOTS)) delete all[r]
    }
    save()
    return rec
  }

  function shot(root, key, jpg) {
    const k = `${root}\n${key}`
    if (jpg === undefined) return shots.get(k) || null
    shots.delete(k)
    if (jpg) shots.set(k, jpg)
    while (shots.size > MAX_SHOTS) shots.delete(shots.keys().next().value)
    return jpg
  }

  return { list, get, set, shot, flush }
}
