# 前端设计工作台插件 · 可行性调研

2026-10-19

## 结论

**靠谱。** DSH 本身支持这几样关键能力：

- 右侧栏加自己的标签页
- 用代码打开右侧栏
- 文件一改就收到通知
- 往输入框里塞文字和图片

唯一要绕一下的是「选区域」：页面要通过插件自己的地址打开，才能在里面点选。

## 想要的效果 → DSH 能不能做

| 想要的 | 能不能 | 怎么做 |
| --- | --- | --- |
| 右边打开一个预览面板 | ✅ 原生支持 | 注册右侧栏标签页（`sidebarRightTabs` + `sidebar.right.pane.tab`），自带的「改动审阅」就是这么做的 |
| 模型一写页面就自动弹出来 | ✅ | `ctx.sidebarRight.openTab()`；服务端也能监听写文件事件 |
| 边写边刷新 | ✅ 有条件 | 监听文件变化后整页刷新；本地开发服务器的热更新会丢（桌面版不转发 WebSocket） |
| 选中一个元素 / 框一块区域 | ⚠️ 要绕 | 页面要走插件自己的路由（和 DSH 同源），才能在里面加高亮层；DSH 自带的 HTML 预览和浏览器都进不去 |
| 选中后发给模型 | ✅ | `inputActions.insertText()` 塞文字，`createDrafts()` + `addAttachments()` 塞截图（这个接口没写进文档，DSH 升级可能变） |
| 截图 | ⚠️ 要绕 | 在页面里自己画（html2canvas 一类），canvas / WebGL / 跨域图片画不准；或者服务端开无头浏览器 |
| 生成时的动画 | ✅ | 纯前端效果，自己画 |

## 已经有人做过的

| 插件 / 产品 | 做了什么 | 缺什么 |
| --- | --- | --- |
| [dsh-live-canvas](https://github.com/GooDAnDReaDY/dsh-live-canvas) | 大而全：31 个工具、预览、热刷新、点选元素、标注、部署… | 太杂；点选只是记下来，要模型自己调工具去取，不会进输入框；3 星 |
| [dsh-preview-plugin](https://github.com/RaulLazaro/dsh-preview-plugin) | 把本地开发服务器代理进右侧标签页 | 只能看，不能选 |
| [dsh-artifact-preview](https://github.com/nirvanaslash/dsh-artifact-preview) | 产出文件分屏预览，含 HTML 和本地端口 | 不能选 |
| [dsh-teaching-board](https://github.com/ArcaneOrion/dsh-teaching-board) | 页面上手绘标注，截图作为用户消息发回 | 面向讲解，不是做页面 |
| Claude Code 桌面版预览（标杆） | 右边跑你的项目，点「选择元素」→ 元素信息和截图直接进输入框 | DSH 里没有 |
| Google Stitch | 一句话生成多屏设计稿、无限画布、导出代码和 Figma | 另一类产品，工作量大得多 |

**空位：** DSH 里还没有一个专注、好看、像 Claude Code 那样「选中就进输入框」的预览插件。

### 2026-10-19 补查（做多屏画布 / 生成动画之前）

在插件目录（约 5900 个条目）里重新搜了一遍：

| 插件 | 做什么 | 和我们的关系 |
|---|---|---|
| [dsh-visual-edit](https://github.com/Han-1413141/dsh-visual-edit) | 在 DSH 自带的 HTML 预览 / 浏览器里点元素、画箭头、框区域，放进输入框；改完自动出前后对比截图 | 跟我们已做的「点选进输入框」最像；没有自动弹出、开发服务器热更新、换帧动画 |
| [dsh-html-inspector](https://github.com/robin421/dsh-html-inspector) | 浏览器标签 / 文件预览里点元素，定位信息写进输入框 | 只有点选；网页版为主 |
| [dsh-openpencil](https://github.com/ZSeven-W/dsh-openpencil) | OpenPencil 设计稿（`.op`）的多画板预览、可缩放画布、编辑器 | 有多屏画布，但画的是它自家设计稿格式，不是网页 |
| [dsh-canvas-preview](https://github.com/jiuyuechuwuhao/dsh-canvas-preview) | 「画板」页签：左边文件列表、右边预览 HTML 产物，导出 PNG | 一次看一个页面，不是并排画布 |
| dsh-live-canvas | 大杂烩里有「多设备并排」（同一页不同宽度） | 不是多个页面并排 |

DSH 自带（0.2.1-rc.2）只有浏览器和文件预览，没有画布。

**结论：** 网页的多屏画布、页面「长出来」的生成动画，目前都没人做。

## 建议先做的版本

1. **右侧「设计工作台」标签页**：显示模型写的 HTML，或本地开发服务器（经插件路由代理）；文件一改就刷新；能切手机 / 平板 / 桌面宽度。
2. **选区域**：点「选择」→ 鼠标移到哪高亮到哪 → 点一下选元素，或拖一个框选区域 → 输入框里出现一个小卡片（元素位置、HTML 片段、截图），用户补一句「改成蓝色」就发。
3. **自动弹出和动画**：模型开始写前端文件时自动展开右侧栏，生成中显示扫光 / 骨架动画，写完淡入新页面。

Stitch 那种「一句话出多屏设计稿」先不做，等预览加选区好用了再说。

## 风险

- **热更新会丢**：只能整页刷新，页面里填的状态会没；对单文件 HTML 没影响。
- **安全**：同源页面能访问 DSH 自己的接口，只适合预览本机自己的项目；要在面板上写明。
- **截图不完美**：canvas、WebGL、跨域图片可能截不出来。
- **没文档的接口**：塞截图用的接口没写进文档，DSH 升级后要回归测试。
- **桌面版没实测**：在桌面版里嵌 `http://localhost` 页面能不能加载，还要在真 DSH 里试一下。

## 来源

- [Google Stitch 2026 年 3 月更新](https://tech-insider.org/google-stitch-ai-design-tool-march-2026-update/)
- [Google Stitch 评测](https://www.banani.co/blog/google-stitch-ai-review)
- [Claude Code 预览与选元素](https://claude.com/blog/preview-review-and-merge-with-claude-code)
- [Claude Code 选元素细节](https://azukiazusa.dev/en/blog/claude-code-preview)
- [React Grab（开源选元素工具）](https://www.mintlify.com/aidenybai/react-grab/introduction)
- [Replit 元素选择器](https://docs.replit.com/replitai/element-selector)
- DSH 部分来自读 DeepSeek Harness 桌面版自带的代码，以及 awesome-dsh-plugin 目录
