/**
 * dsh-design-studio/skill：把 ui-design 技能挂到 DSH 的技能服务（老版本没有就算了）。
 * 放在 bundle 顶层 → 所有模式都能用；放进设计模式 → 只挂在那个模式里。技能本身见 index.js 的 designSkill
 */
import { skillProvider } from './index.js'

export const name = 'dsh-design-studio-skill'

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  try {
    // 等技能服务就绪再挂，这一行关掉时一起摘掉
    ctx.inject(['skills'], (sub) => { sub.skills.registerProvider(() => skillProvider) })
  } catch (e) {
    try { ctx.logger.warn(`dsh-design-studio: ${e && e.message ? e.message : e}`) } catch { /* 没 logger 就算了 */ }
  }
}
