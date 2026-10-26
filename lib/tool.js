/**
 * dsh-design-studio/tool：把 preview_page 工具挂给模型。
 * 放在 bundle 顶层 → 所有模式都能用；放进设计模式 → 只挂在那个模式里。工具本身见 index.js 的 previewTool
 */
import { previewTool } from './index.js'

export const name = 'dsh-design-studio-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({ ...previewTool })
}
