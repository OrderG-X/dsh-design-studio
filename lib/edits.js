/**
 * 用户在右侧栏亲手改了设计（调样式、改字、调节滑块、回到某一版）之后，模型下一步开始前插件补给它的一段说明。
 *
 * 为什么要：模型记得的是自己上次写的内容，不一定重读文件；用户手调的颜色、字，它接着改或做进项目时会用回旧样子（#28）。
 * 走 DSH 的 agent/pre-step（和 DSH 自带的时间、操作卡片提醒一样），以「通知」的样子进对话：用户看得到一行，模型拿到全文。
 */


const CJK = /[㐀-鿿豈-﫿]/

/** 用户这一轮说的话里有中文就用中文写说明，否则英文（DSH 没告诉插件界面语言） */
export function langOf(messages) {
  for (const m of [...(messages || [])].reverse()) {
    if (!m || !m.source || m.source.kind !== 'user') continue
    const c = m.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''
    if (text.trim()) return CJK.test(text) ? 'zh' : 'en'
  }
  return 'zh'
}

const cssText = (css) => Object.entries(css || {}).map(([k, v]) => `${k}: ${v || '(去掉)'}`).join('; ')
const cssTextEn = (css) => Object.entries(css || {}).map(([k, v]) => `${k}: ${v || '(removed)'}`).join('; ')

/** 一条手改记录说成一行 */
function line(e, zh) {
  const files = (e.files || []).join(zh ? '、' : ', ') + (e.more ? (zh ? ` 等 ${e.files.length + e.more} 个文件` : ` and ${e.more} more`) : '')
  if (e.kind === 'style') return zh
    ? `- ${files}：调样式「${e.name}」→ ${cssText(e.css)}（写在这个元素的行内 style 上）`
    : `- ${files}: restyled "${e.name}" → ${cssTextEn(e.css)} (written as an inline style on that element)`
  if (e.kind === 'rule') return zh
    ? `- ${files}：调样式「${e.name}」→ 写进 ${e.file} 的 ${e.sel} 规则：${cssText(e.css)}（用这条规则的各屏一起变）`
    : `- ${files}: restyled "${e.name}" → written into the ${e.sel} rule in ${e.file}: ${cssTextEn(e.css)} (every screen using that rule changes)`
  if (e.kind === 'text') return zh
    ? `- ${files}：改字「${e.before}」→「${e.after}」`
    : `- ${files}: changed the text "${e.before}" to "${e.after}"`
  if (e.kind === 'restore') return zh
    ? `- 整套设计回到了第 ${e.n} 版（${e.count} 个文件换回那一版的内容）`
    : `- The whole design was restored to version ${e.n} (${e.count} files now hold that version's content)`
  return zh ? `- ${files}：${e.label || '改了'}` : `- ${files}: ${e.label || 'edited'}`
}

/**
 * @param edits 核心记下的手改（见 core.js 的 noteEdit），旧的在前
 * @returns {{ text, summary } | null}
 */
export function editsNotice(edits, lang = 'zh') {
  const list = (edits || []).filter(Boolean)
  if (!list.length) return null
  const zh = lang !== 'en'
  const roots = [...new Set(list.map((e) => e.root).filter(Boolean))]
  const where = roots.length ? roots.map((r) => `\`${r}\``).join(zh ? '、' : ', ') : ''
  const lines = list.map((e) => line(e, zh))
  const text = zh
    ? [`〔设计工作台〕你上次写完之后，用户自己在右侧设计工作台里改了设计${where ? `（${where}）` : ''}，这些就是用户要的样子：`, ...lines,
      '接着改这套设计、或者把它做进项目里之前：先重新读上面这些文件，以文件现在的内容为准，别照你之前写的内容来，也别把这些改回去（除非用户这次就是要你改）。行内 style 上的值是用户手调的：做成组件时把它并进组件的样式。'].join('\n')
    : [`[Design Studio] Since you last wrote, the user edited the design by hand in the Design Studio sidebar${where ? ` (${where})` : ''}. This is how the user wants it:`, ...lines,
      'Before you change this design again or build it into a project: re-read the files above and treat their current content as the truth. Do not go by what you wrote earlier, and do not undo these edits (unless the user asks for that now). Values in inline styles were tuned by the user: when you turn the element into a component, carry those values into the component\'s styles.'].join('\n')
  const n = list.length
  const summary = zh ? `用户在设计工作台里手改了 ${n} 处` : `The user hand-edited the design (${n} ${n === 1 ? 'edit' : 'edits'})`
  return { text, summary }
}

/** 给 DSH 的一条「通知」消息（和 @deepseek-ai/dsh-llm 的 createUserMessage 出来的一样：有 id、冻住） */
export function noticeMessage({ text, summary }, id) {
  const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o }
  return deepFreeze({ id, role: 'user', source: { kind: 'design-studio', form: 'notice', summary }, content: [{ type: 'text', text }] })
}

