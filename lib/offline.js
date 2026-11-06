/**
 * dsh-design-studio/offline：设计库不联网（默认关）。
 * 打开后设计库的「市场」一个网址都不访问，只显示已经下载过的；「我的作品」「灵感」照常用。
 * 默认关、反着来：老版本升级上来插件页里还没有这一行时，市场照常联网
 */
import { studio } from './index.js'

export const name = 'dsh-design-studio-offline'

export function apply(ctx) {
  ctx.effect(() => {
    studio.offline++
    // 正在下载的目录 / 批次包马上掐掉（不等下完）
    try { if (studio.market) studio.market.abort() } catch { /* 市场还没起来 */ }
    return () => { studio.offline-- }
  }, 'dsh-design-studio: gallery offline')
}
