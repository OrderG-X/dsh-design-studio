/**
 * dsh-design-studio/tool：把 preview_page、check_design、look_design、extract_design_system、handoff_design、compare_design 挂给模型。
 * 放在 bundle 顶层 → 所有模式都能用；放进设计模式 → 只挂在那个模式里。工具本身见 index.js
 */
import { previewTool, checkTool, lookTool, systemTool, handoffTool, compareTool } from './index.js'

export const name = 'dsh-design-studio-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({ ...previewTool })
  // 截的图要存进 DSH 的附件库（ctx.get('attachments')），把这一行的 ctx 带进去
  ctx.tools.register({ ...checkTool, execute: (args, exec) => checkTool.execute(args, exec, ctx) })
  ctx.tools.register({ ...lookTool, execute: (args, exec) => lookTool.execute(args, exec, ctx) })
  ctx.tools.register({ ...systemTool, execute: (args, exec) => systemTool.execute(args, exec, ctx) })
  ctx.tools.register({ ...handoffTool, execute: (args, exec) => handoffTool.execute(args, exec, ctx) })
  ctx.tools.register({ ...compareTool, execute: (args, exec) => compareTool.execute(args, exec, ctx) })
}
