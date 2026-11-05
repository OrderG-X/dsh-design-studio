# 微信小程序（kind: miniprogram）

## 画幅

- 按 375×812 设计（微信的 750rpx 就是 375px 宽），每屏 `<head>` 写 `<meta name="dsh-design" content="miniprogram">`。页面宽度跟着视口走（`width: 100%`），viewport 和 App 一样；别写死 375：多尺寸视图还会拿 375×667、414×896 来看。
- 下面的数字都是**这台预览手机（375×812，带灵动岛）**的：设计稿照它画就行；真机上状态栏高、胶囊位置、底部安全区每台都不一样，写交付代码时按 `wx.getWindowInfo()`（状态栏高、安全区）、`wx.getMenuButtonBoundingClientRect()`（胶囊）和 `env(safe-area-inset-bottom)` 算，别写死。
- 顶部 88px = 状态栏 44 + 导航栏 44。状态栏自己画（时间 9:41、信号、电量），中间空着——灵动岛外框会画。导航栏：17px 标题居中，二级页面左边加返回箭头；底色用白色或品牌色。
- **右上角的胶囊**（「···」和关闭圈，87×32，离顶 48、离右 7）是微信画在页面上面的，每个页面都有、盖不住。工作台外框会画它，页面里别画。导航栏右边空出 101px，搜索框、按钮、头像都放到左边或导航栏下面；体检会报「被小程序胶囊挡住」。顶栏是深色时，外框自动画白色胶囊；顶栏是图片或渐变、判断不准时，在 `<head>` 加 `<meta name="dsh-capsule" content="white">`（或 `black`）指定，和微信页面配置里的 `navigationBarTextStyle` 一样。
- 底部 34px 是这台预览手机的安全区（横条）：设计稿里标签栏、底部操作栏让出 34px（预览里 `env(safe-area-inset-bottom)` 是 0，不能靠它）。做成真小程序时换成 `env(safe-area-inset-bottom)`，没横条的手机是 0。

## 骨架（先抄进 `app.css`，再按品牌改颜色）

顶部 88、标签栏 84 这些数字照这台预览手机来，几屏共用，别每屏各写一套：

```css
.mp-top{position:sticky;top:0;z-index:10;background:var(--nav-bg,#fff)}            /* 状态栏 + 导航栏，共 88 */
.mp-status{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 26px 0 32px;font:600 15px/1 -apple-system,"PingFang SC",sans-serif}
.mp-nav{position:relative;height:44px;display:flex;align-items:center;justify-content:center;padding:0 101px} /* 右边 101 让给胶囊，左边也空 101，标题才在正中 */
.mp-nav h1{margin:0;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mp-nav.custom{justify-content:flex-start;padding-left:16px}                      /* 首页自定义导航：品牌 / 搜索靠左，右边照样让 101 */
.mp-back{position:absolute;left:4px;top:0;width:44px;height:44px;display:grid;place-items:center}
.mp-tabbar{position:fixed;left:0;right:0;bottom:0;height:84px;padding-bottom:34px;box-sizing:border-box;display:flex;background:#fff;border-top:.5px solid rgba(0,0,0,.12)}
.mp-tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;color:#6E7277;text-decoration:none}
.mp-tabbar a.on{color:var(--color-primary)}
.mp-tabbar svg{width:24px;height:24px}
.mp-page{padding:0 16px 100px}                                                      /* 有标签栏的页：底部让出 84 + 16 */
.mp-actionbar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;padding:8px 16px 42px;background:#fff;box-shadow:0 -.5px 0 rgba(0,0,0,.12)}
```

```html
<header class="mp-top">
  <div class="mp-status"><span>9:41</span><span>信号 · 电量图标</span></div>
  <div class="mp-nav"><a class="mp-back" href="list.html">返回图标</a><h1>商品详情</h1></div>
</header>
<main class="mp-page">…</main>
<nav class="mp-tabbar"><a class="on" href="index.html">图标<span>首页</span></a>…</nav>
```

- **一级页**（标签栏里的那几页）：有标签栏、没有返回；首页可以用 `.mp-nav.custom` 放品牌或搜索。**二级页**：标题居中、左边返回、没有标签栏，底部要操作就用 `.mp-actionbar`。从分享卡片直接打开的二级页，返回换成「回首页」小房子。
- 默认导航栏只能是**纯色底 + 黑或白的标题**（微信的 `navigationBarBackgroundColor` / `navigationBarTextStyle`），胶囊跟着标题一个颜色；渐变、图片顶栏要用自定义导航（`navigationStyle: custom`），内容和胶囊竖直居中对齐（中线 y 64）。
- 体检会报：被胶囊挡住、被灵动岛挡住、底栏伸进横条区、标签栏超过 5 项、这屏没有导航栏。

## 结构和组件（照微信的规矩）

- **标签栏（tabBar）**：2–5 项，图标 + 文字（10–12px），高 50 + 底部安全区（预览手机 34），当前项用主色。只有一级页面有；二级页面没有标签栏，左上角是返回箭头。
- **首页的导航栏**可以自己画（自定义导航）：放品牌名或搜索框，搜索框只到胶囊左边。
- **按钮**：一屏一个主按钮，高 44–48，圆角 8 或全圆；底部固定的操作栏放「客服 / 购物车 + 主按钮」。微信绿 #07C160 只在用户要「微信风格」或支付确认时用，别默认拿它当主色。
- **弹层**：底部弹出的操作菜单；居中的对话框（标题 + 一两句话 + 「取消 / 确定」两个按钮，确定在右）；toast 居中，带图标。
- **登录授权**：「微信一键登录」「手机号快捷登录」按钮，旁边给一个「暂不登录」。
- **分享、更多**：胶囊里已经有「···」，页面里不用再放「更多」菜单。
- 列表、表单、点击区（至少 44×44）同 App，见 `app.md`。

## 微信原生风格（用户要「像微信」「原生」「WeUI」时）

底 #EDEDED、卡片和列表白底；字 rgba(0,0,0,.9)，说明 rgba(0,0,0,.55)；主色 #07C160，危险 #FA5151，链接 #576B95。列表行（cell）最少 56 高、左右 16、分隔线 0.5px 从左边 16 起；分组之间空 8。主按钮 17px、高 48、圆角 8、宽 184 居中（底部操作区可以通栏）。对话框：标题 17 粗、正文 15 灰，「取消」灰、「确定」绿在右。

## 常见的一套

首页（搜索 + 图标宫格 + 推荐列表）→ 分类或列表 → 详情（底部固定操作栏）→ 下单或表单 → 支付结果 → 我的（头像昵称卡片、一排订单入口、设置列表）。几屏共用一套导航栏、标签栏和卡片样式，写进 `app.css`。

## 字体

系统字体：`-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`。正文 15–16px，说明 12–13px，最小 10px。
