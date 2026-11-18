/**
 * 套了外框的设计（DSH 插件、外框库）里 main 槽位在哪：两处用同一份量法（#25）
 *   - compare_design（无头浏览器里 page.eval）：只截槽位那块比
 *   - 预览页面里的 picker.js（预览服务器发脚本时带上 window.__DSH_DESIGN_SLOT__）：「和做出来的比」把真页面盖在槽位上
 * 都是页面里跑的表达式源码（字符串），这里不引别的模块
 */

// 套了外框的设计（DSH 插件、外框库）：外框是宿主画的，做出来的只有槽位 main 那块 → 只截这块比（#25）
// 返回整页坐标（截图 clip 用）和视口坐标（对元素块用）；槽位太小或看不见给 null，照整屏比
// 量的是内容那块：槽位自己的边框、内边距是宿主留的白（DSH 设置分区左右 24px），真插件的页面从内容那块开始
// 外框根和体检一样认：第一个带 data-frame、里面有 data-slot 的元素，而且是登记过的（DSH 自带的四个，或页面里有外框库那段 <template id="dsh-frame">）；
// 普通设计里碰巧写了 data-frame 的包裹层（手机示意框之类）不算
export const FRAME_MAIN = `(() => {
  const f = [...document.querySelectorAll('[data-frame]')].find((x) => x.querySelector('[data-slot]'))
  if (!f) return null
  if (!/^dsh\\/(sidebar|settings|view|panel)$/.test(f.getAttribute('data-frame') || '') && !document.getElementById('dsh-frame')) return null
  return f.querySelector('[data-slot="main"]')
})()`
export const SLOT_BOX = `(() => {
  const el = ${FRAME_MAIN}
  if (!el) return null
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  const n = (k) => parseFloat(s[k]) || 0
  const left = r.left + n('borderLeftWidth') + n('paddingLeft'), top = r.top + n('borderTopWidth') + n('paddingTop')
  const right = r.left + n('borderLeftWidth') + el.clientWidth - n('paddingRight'), bottom = r.top + n('borderTopWidth') + el.clientHeight - n('paddingBottom')
  const vx = Math.max(0, Math.round(left)), vy = Math.max(0, Math.round(top))
  const w = Math.min(Math.round(right), innerWidth) - vx, h = Math.min(Math.round(bottom), innerHeight) - vy
  // 外框自己多大：页面开头类型标记里写的（外框库存的「framed 宽x高」），没写就量外框根元素（自带 DSH 外框固定 1280×800）
  const mm = /(\\d{3,4})\\s*[x×]\\s*(\\d{3,4})/.exec((document.querySelector('meta[name="dsh-design"]') || {}).content || '')
  const fr = el.closest('[data-frame]').getBoundingClientRect()
  const fw = mm ? +mm[1] : Math.round(fr.width), fh = mm ? +mm[2] : Math.round(fr.height)
  if (w < 40 || h < 40) return { hidden: true, fw, fh } // 认出了外框，但这个尺寸下槽位露不出来：别退回整屏比（会拿外框去比）
  // 开的尺寸装不下整个槽位（只露出一部分）：照样比露出来的，但要说一声
  const part = w < Math.round(right - left) - 1 || h < Math.round(bottom - top) - 1
  return { x: vx + Math.round(scrollX), y: vy + Math.round(scrollY), vx, vy, w, h, part, fw, fh }
})()`
