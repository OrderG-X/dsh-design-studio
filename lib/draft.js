/**
 * 边写边看：模型写一整页 HTML 时，write 工具的参数要流好几分钟才到。这里把流到一半的页面内容攒着，
 * 预览服务器（serve.js：某屏的地址带 ?__ddp_draft=）一边收一边原样吐给 iframe，浏览器就一段段画出来。
 *
 *   createDrafts()            文件（绝对路径）→ 正在写的内容；订阅的人随到随收
 *   createJsonStringDecoder() 参数是 JSON：把流过来的「字符串里面那一截」一块块还原（转义可能被切在两块中间）
 */

const MAX_TEXT = 4 * 1024 * 1024 // 一页最多攒这么多（再大的也不是正常的设计稿）
const KEEP = 6 // 最多记几份（每轮开始清一次，这里只是兜底）
// 「整段一下子到的」：最后一阵（中间没停过 GAP_MS）在 LUMP_MS 里就到齐了，有 LUMP_CHARS 字以上、占全文一半以上。
// 这种才值得事后补放一遍（serve.js 晚来的也一截截放、右侧栏放完再换真文件）；一路流着写的看过了，不重放
const LUMP_CHARS = 1500
const LUMP_MS = 1500
const GAP_MS = 1000

export function createDrafts({ log = () => {} } = {}) {
  const map = new Map() // abs → { id, text, done, subs }
  let ids = 0

  const emit = (d, ev) => {
    for (const fn of [...d.subs]) {
      try { fn(ev) } catch (e) { log(e) }
    }
  }

  return {
    /** 开始写（同一个文件重写也从头来）；返回这一份的编号，地址里带上，iframe 才会重载 */
    begin(abs) {
      const old = map.get(abs)
      if (old) emit(old, { done: true, gone: true })
      const d = { id: ++ids, text: '', done: false, subs: new Set() }
      map.delete(abs)
      map.set(abs, d)
      while (map.size > KEEP) {
        const [k, v] = map.entries().next().value
        emit(v, { done: true, gone: true })
        map.delete(k)
      }
      return d.id
    },
    // push / end / drop 带上 begin 给的编号时只认那一份（同一个文件后来又开始重写了，旧的不碰新的）
    push(abs, text, id) {
      const d = map.get(abs)
      if (!d || d.done || !text || (id && d.id !== id)) return
      const room = MAX_TEXT - d.text.length
      if (room <= 0) return
      const s = text.length > room ? text.slice(0, room) : text
      const now = Date.now()
      if (!d.burstAt || now - d.lastAt > GAP_MS) {
        d.burstAt = now
        d.burst = 0
      }
      d.burst += s.length
      d.lastAt = now
      d.text += s
      emit(d, { text: s })
    },
    /** 参数流完了（或者这次作废了）：在看的那头收尾 */
    end(abs, id) {
      const d = map.get(abs)
      if (!d || d.done || (id && d.id !== id)) return
      d.done = true
      d.endAt = Date.now()
      d.lump = !!d.burstAt && d.burst >= LUMP_CHARS && d.burst * 2 >= d.text.length && d.endAt - d.burstAt < LUMP_MS
      emit(d, { done: true })
    },
    /** 作废：在看的那头收尾，之后这个地址读不到 */
    drop(abs, id) {
      const d = map.get(abs)
      if (!d || (id && d.id !== id)) return
      d.done = true
      emit(d, { done: true, gone: true })
      map.delete(abs)
    },
    get(abs) {
      return map.get(abs) || null
    },
    /** 订阅：先拿 get() 的现有内容，之后的增量走 fn({ text }) / fn({ done }) */
    sub(abs, fn) {
      const d = map.get(abs)
      if (!d) return () => {}
      d.subs.add(fn)
      return () => d.subs.delete(fn)
    },
    clear() {
      for (const d of map.values()) emit(d, { done: true, gone: true })
      map.clear()
    },
  }
}

const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '\\': '\\', '"': '"' }

/** JSON 字符串内容的流式还原：push(原文的一块) → 还原出来的一块；碰到收尾的引号就停（done） */
export function createJsonStringDecoder() {
  let pend = '' // 切在两块中间的半个转义
  let hi = '' // 半个表情（高位代理），等下一块
  let done = false
  return {
    get done() {
      return done
    },
    push(chunk) {
      if (done) return ''
      const src = pend + String(chunk || '')
      pend = ''
      let out = ''
      let i = 0
      while (i < src.length) {
        const c = src[i]
        if (c === '"') {
          done = true
          break
        }
        if (c !== '\\') {
          let j = i + 1
          while (j < src.length && src[j] !== '\\' && src[j] !== '"') j++
          out += src.slice(i, j)
          i = j
          continue
        }
        if (i + 1 >= src.length) {
          pend = src.slice(i)
          break
        }
        const e = src[i + 1]
        if (e === 'u') {
          if (i + 6 > src.length) {
            pend = src.slice(i)
            break
          }
          const code = parseInt(src.slice(i + 2, i + 6), 16)
          if (!Number.isNaN(code)) out += String.fromCharCode(code)
          i += 6
          continue
        }
        out += ESC[e] ?? e
        i += 2
      }
      out = hi + out
      hi = ''
      const last = out.charCodeAt(out.length - 1)
      if (!done && last >= 0xd800 && last <= 0xdbff) {
        hi = out.slice(-1)
        out = out.slice(0, -1)
      }
      return out
    },
  }
}
