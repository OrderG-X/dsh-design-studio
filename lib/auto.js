/**
 * dsh-design-studio/auto：自动打开预览。
 * 开着时，模型写了设计用的 HTML、或开发服务器起来了，右侧栏自动预览；关掉后只在右侧栏给个「预览刚写的 …」按钮
 */
import { studio } from './index.js'

export const name = 'dsh-design-studio-auto'

export function apply(ctx) {
  ctx.effect(() => {
    studio.autoOpen++
    return () => { studio.autoOpen-- }
  }, 'dsh-design-studio: auto open')
}
