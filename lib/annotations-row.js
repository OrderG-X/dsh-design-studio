/**
 * dsh-design-studio/annotations：业务标注（试验，默认关）。
 * 打开后模型做设计时同时写 annotations.json，右侧栏多一个「业务标注」按钮；关着时界面、技能说明、体检、交接说明都和没有这个功能一样
 */
import { studio } from './index.js'

export const name = 'dsh-design-studio-annotations'

export function apply(ctx) {
  ctx.effect(() => {
    studio.annotations++
    return () => { studio.annotations-- }
  }, 'dsh-design-studio: annotations')
}
