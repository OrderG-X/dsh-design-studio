# DSH 插件（`dshplugin`）

给 DSH（DeepSeek Harness）桌面端做插件界面。插件长在 DSH 里面，所以每屏都带 **DSH 的外框**（左侧栏、会话顶栏、右侧栏、设置弹窗），你只设计插件那一块。外框是照 DSH 0.2.2 量的，浅色、深色都有。

## 四个位置

| 位置 | 外框文件 | 用户在哪看到 | 槽位（`data-slot`） |
| --- | --- | --- | --- |
| 左侧栏入口 | `sidebar.html` | 左侧栏「插件 / 自动化任务」那一排多一行，点开主区是插件整页 | `entry-icon`、`entry-label`、`main`（1000×760） |
| 设置分区 | `settings.html` | 设置弹窗左边导航多一项，右边是插件的设置 | `entry-icon`、`entry-label`、`main`（约 610×690，左右已留 24px） |
| 会话标签页 | `view.html` | 会话顶上「对话 / 轨迹」旁边多一个标签，下面整块是插件视图 | `tab-label`、`main`（1000×724） |
| 右侧栏面板 | `panel.html` | 会话顶栏多一个按钮，点开右侧栏是插件面板 | `button-icon`、`panel-title`、`main`（574×762） |

用户没说放哪就问一句（给这四个选项）；一个插件可以占好几个位置，一个位置一屏。

## 怎么做

1. **复制外框**：把技能目录 `frames/dsh/` 里的 `dsh-shell.css` 和要用的外框 HTML **原样**复制进设计目录（HTML 可以改文件名，照常用英文小写，比如 `pomodoro-view.html`）；`<title>` 照常改成「屏名 · 产品名」（如「标签页 · 番茄钟」），它不算外框。外框自带 `<meta name="dsh-design" content="dshplugin 1280x800">`，别改。
2. **只写槽位里面**：插件界面写进 `<div data-slot="main">`；`entry-icon` / `button-icon` 放一个 16×16 的线条 `<svg>`（`stroke="currentColor"`，别用彩色图），`entry-label` / `tab-label` / `panel-title` 换成插件名（2–6 个字）。几屏的图标、名字要一致。
3. **外框一个字都别动**：结构、文字、class、`style`、`dsh-shell.css` 都不改，也别删外框里的东西。改了体检报「外框被改动」，用户看到的就不是真 DSH 了。
4. **样式只管槽位**：插件的样式写在 `<head>` 里自己的 `<style>`，每条选择器都从 `[data-slot="main"]` 开头（`[data-slot="main"] .timer { … }`）。不写 `body`、`*`、`button`、`h1` 这种不带前缀的选择器——会改到外框。
5. **默认长得像 DSH**：不用 `pick_style`，也不用 `tokens.css`；颜色、圆角、字体用外框的变量，深色自动跟着变：

   | 变量 | 用途 |
   | --- | --- |
   | `--dsh-bg` / `--dsh-card` / `--dsh-side` | 主区底色 / 卡片、弹窗底色 / 侧栏底色 |
   | `--dsh-fg` / `--dsh-muted` | 正文 / 次要字 |
   | `--dsh-line` / `--dsh-hover` | 分隔线、边框 / 选中行、悬停 |
   | `--dsh-accent` | 选中、链接、强调（蓝） |
   | `--dsh-btn` / `--dsh-btn-fg` | 主按钮（浅色黑底白字，深色反过来） |
   | `--dsh-radius-sm` / `-md` / `-lg` | 8 / 12 / 16px |
   | `--dsh-font` / `--dsh-font-code` | 正文字体 / 代码字体 |

   DSH 自己的样子：正文 14px、标题 16–20px 中粗；卡片 1px `--dsh-line` 边、12–16px 圆角、不加重阴影；按钮高 28–32px，主按钮黑底（深色白底），次按钮描边。用户要自己的品牌风格时才建 `tokens.css`，变量也只在槽位里用。
6. **深色**：外框和 `--dsh-*` 变量自带；插件里另写的颜色要在 `[data-theme="dark"] [data-slot="main"] …` 里给深色值。
7. **放得下**：`main` 比内容小时会自己滚动，但关键内容放在第一屏；右侧栏只有 574 宽，按窄面板排（一列为主）。

## 示例

```html
<head>
  …外框原样…
  <style>
    [data-slot="main"] .pomo { padding: 32px 40px; display: grid; gap: 16px; }
    [data-slot="main"] .pomo-time { font: 600 56px/1 var(--dsh-font); }
    [data-slot="main"] .pomo-card { border: 1px solid var(--dsh-line); border-radius: var(--dsh-radius-lg); background: var(--dsh-card); padding: 16px; }
    [data-slot="main"] .pomo-go { height: 32px; padding: 0 16px; border: 0; border-radius: var(--dsh-radius-lg); background: var(--dsh-btn); color: var(--dsh-btn-fg); }
  </style>
</head>
…
<div class="dsh-tab on"><span data-slot="tab-label">番茄钟</span></div>
…
<div data-slot="main">
  <section class="pomo">
    <div class="pomo-time">25:00</div>
    <button class="pomo-go">开始专注</button>
    <div class="pomo-card">今天完成 3 个番茄</div>
  </section>
</div>
```

## 讲究

- 外框里的会话名、工作区、账号（「我的账号」）是占位，别换成真实的人名、手机号。
- 不要自己再画一个窗口、标题栏、DSH 侧栏——外框已经有了。
- 插件里的弹窗、下拉菜单也画在 `main` 里面（`position: absolute`），不要盖到外框上。
- 给别的软件、浏览器插件、平台做界面（不是 DSH）：见 `references/frames.md`，照截图做一个自己的外框存进外框库。
