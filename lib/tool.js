/**
 * dsh-design-studio/tool：把 preview_page、check_design、look_design 三个工具挂给模型。
 * 放在 bundle 顶层 → 所有模式都能用；放进设计模式 → 只挂在那个模式里。工具本身见 index.js 的 previewTool / checkTool / lookTool
 */
import { previewTool, checkTool, lookTool } from './index.js'

export const name = 'dsh-design-studio-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({ ...previewTool })
  ctx.tools.register({ ...checkTool })
  // 截的图要存进 DSH 的附件库（ctx.get('attachments')），把这一行的 ctx 带进去
  ctx.tools.register({ ...lookTool, execute: (args, exec) => lookTool.execute(args, exec, ctx) })
}
