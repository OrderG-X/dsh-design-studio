/**
 * dsh-design-studio/preset：设计模式那一行。和 DSH 自带的 Agent 预设（@deepseek-ai/dsh-agent-preset）一模一样，
 * 换个入口好让 DSH「插件」页里显示成设计模式（名字和说明见 locale/preset/），而不是通用的「Agent 预设定义」。
 *
 * 不直接 re-export 那个包：用 link: 装、插件文件夹在 DSH 目录外面时（本地开发），从这里找不到 @deepseek-ai/* 包，
 * 这一行就起不来、模式列表里没有设计模式。官方实现只有十几行，照抄；两个键是 cordis 的全局符号（Symbol.for）。
 */
export default class DesignPreset {
  static inject = ['agentPresets']
  // 子插件的配置原样留着，等各自激活时再解析（官方的 EntryGroup.key）
  static [Symbol.for('cordis.group')] = true

  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
  }

  // 官方的 Service.init：注册上就算起来了，停用时 yield 出去的反注册会被调用
  async * [Symbol.for('cordis.init')]() {
    yield await this.ctx.agentPresets.register(this.config)
  }
}
