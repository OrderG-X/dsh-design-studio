# 组件（`components/`）

多屏共用的 HTML 结构写成纯 HTML 组件文件 `components/<名>.html`，各屏用 `<c-名>` 引用。插件在把页面交给浏览器或导出之前按文本展开成普通 HTML：改一处组件，所有用到它的屏一起变，导出的结果也能直接离线打开。

## 什么时候用，什么时候别用

- **该用**：整套设计 **4 屏以上**，且同一块出现在 **2 屏以上**——如标签栏、顶栏、卡片、列表项、按钮组。
- **别用**：只出现一次的块（如首页独有的首屏头图、单屏表单布局）；3 屏以内的小设计直接写普通 HTML + `app.css` 更轻。用户明确要抽组件时，屏数少也照做。
- **改老设计**：把几屏里重复的块抽进 `components/`、各屏换成 `<c-名>`，别自己写 JS 自定义元素或运行时注入；改完用 `look_design` / `check_design` 对一遍样子没变。
- **位置与目录**：组件文件**只放 `components/` 下**。自动打开预览会跳过 `components/`，写完第一个真页面再调 `preview_page`；`preview_page`、`check_design` 结果末尾会列出已有组件和参数，长对话里直接对照复用。

## 完整示例

```html
<!-- components/activity-card.html -->
<article class="activity-card" data-status="{{status | open}}">
  <img class="ac-cover" src="{{cover | }}" alt="{{title}}" data-if="cover">
  <h3 class="ac-title">{{title}}</h3>
  <span class="ac-tag" data-if="tag">{{tag | }}</span>
  <div class="ac-actions"><slot></slot></div>
</article>
<style>
  .activity-card { padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface); }
  .activity-card[data-status="ended"] { opacity: .6; }
</style>
```

```html
<!-- 页面里用（如 home.html） -->
<c-activity-card title="周末徒步" tag="热门"><a href="detail.html">查看</a></c-activity-card>
<c-activity-card title="读书会" status="ended" />
<div data-mock-each="act in activities"><template>
  <c-activity-card :title="act.title" :cover="act.cover" :status="act.status">
    <button data-mock-set="act.joined = true">报名</button>
  </c-activity-card>
</template></div>
```

## 写法规则（共 9 条）

1. **文件和结构**：文件放 `components/<名>.html`（名只用小写字母、数字和 `-`），页面里写 `<c-名>`。组件里只能有**一个根元素** + **可选 `<style>`**；不许 `<html>` / `<head>` / `<body>`、`<script>`、`on…` 内联事件（展开时直接去掉并报错）。`<style>` 每条选择器以根元素的 class 开头。
2. **参数与默认值**：`{{名}}` 必填；`{{名 | 默认}}` 有默认值；`{{名 | }}` 表示可选（默认空）。**同一个参数只在一处写默认值**。所有参数值一律转义后替换（不能靠参数传 HTML；传子元素用 `<slot>`）。
3. **条件显隐**：`data-if="名"` / `data-if="!名"` 按套上默认值后的值判断真假（见下表）。
4. **插槽**：最多一个 `<slot></slot>`，把实例里的子元素放进去；没子元素时可自闭合 `<c-名 ... />`。**不支持具名插槽**。
5. **动态接数据（`:名="字段路径"`）**：**只收数据路径**（如 `act.title`、`user.stage`），**不支持表达式**。展开成现成的 `data-mock-*`：文本包成 `<span data-mock-text>`（不碰旁边的图标），属性进 `data-mock-attr`，`data-if` 进 `data-mock-show`。路径在调用方的作用域里算；若组件内部 `data-mock-each` 列表别名和它撞名，直接报错。
6. **组件样式状态**：组件自己的几种样子用 `data-status` 或 `data-variant`；**`data-state` 不许出现在组件定义和实例上**（会误中页面状态 `<html data-state>` 的 CSS）。
7. **属性透传**：`class`、`style` 追加到根元素；透传名单里的属性搬到根元素，根元素已有同名属性就报错；实例上写 `data-mock-text` / `data-mock-each` / `data-mock-model` 直接报错（详见下方「属性透传」）。
8. **路径写法**：图片、`icons.svg#…`、页面链接等**一律按设计根目录写**（如 `icons.svg#cart`、`assets/hike.jpg`、`detail.html`），不要写成 `../`。动态图片只认直接绑到 `src` 的本地完整路径（如 `src="{{cover | }}"`，`mock.json` 存 `"assets/hike.jpg"`）。
9. **嵌套与循环**：组件可嵌套，最多 **8 层**；循环引用直接报错。

**当前不支持（别写）**：具名插槽、`:参数` 里写表达式、Shadow DOM、组件里写脚本。

## 真假怎么算（`data-if`）

`data-if="名"` / `data-if="!名"` 先套上默认值再判断真假：

| 传值方式 | 示例 | 算真 / 假 |
| --- | --- | --- |
| 静态不带值 | `<c-tab active>` | **真** |
| 静态空值 | `<c-tab active="">` | **假** |
| 没传（且无非空默认值） | `<c-tab>` | **假** |
| 静态非空文字（含 `false`、`0`） | `flag="false"`、`count="0"` | **真**（静态写的 `false`、`0` 是文字） |
| 动态参数（`:名="路径"`） | `:active="item.active"` | 按 mock 现有规则：`false`、`0`、空串、`null`、缺字段为**假** |

## 属性透传

实例 `<c-名 ...>` 上除组件自身参数（及 `:参数`）外的属性，按以下规则处理：

- **追加到根元素**：`class`、`style`。
- **搬到根元素（不合并，根元素已有同名属性就报错）**：`id`、`hidden`、`role`、`aria-*`、`tabindex`、`title`、`data-back`、`data-href`、`data-to`、`data-mock-show`、`data-mock-class`、`data-mock-set`、`data-mock-attr`、`data-mock-reset`。
- **禁止写在实例上（报错）**：`data-mock-text`、`data-mock-each`、`data-mock-model`（会改整棵子树；列表循环写在组件外层容器 + `<template>` 上，文本走 `:参数`）。
- **其他属性（既不是参数、也不在透传名单里）**：会被丢掉并提醒（多半是参数名拼错）。

## 组件样式

- 组件 `<style>` 里的每条选择器都以根元素的 class 开头（如 `.activity-card`、`.activity-card .ac-title`、`.activity-card[data-status="ended"]`），不要写裸标签选择器。
- 展开时每个用到的组件 `<style>` 每页放一份，插在本页 `<link rel="stylesheet">` 之后、本页 `<style>` 之前。
- 不要在页面自己的 `<style>` 里再写组件根 class 的规则（体检会提醒删掉）；要区分外观用 `data-status` / `data-variant` 或给实例传 `class`。

## 和 `mock.json`、`data-mock-*`、`?state=` 配合

- **页面状态 vs 组件状态**：整页状态用 `<meta name="dsh-states">` + `<html data-state="...">`，配 `?state=` 链接或 `data-mock="user.stage"`（角色、阶段存 `mock.json`，真按钮用 `data-mock-set` 改，`?state=` 用来预览）；组件自身外观用 `data-status` / `data-variant`，严禁写 `data-state`。
- **`:参数` 只传路径**：数据运算、拼接不要塞进 `:参数`；列表循环在外层写 `data-mock-each` + `<template>`，按钮交互可放 `<slot>` 或透传 `data-mock-set` 等属性到根元素。
- **`data-mock-*` 表达式避坑**（用于 `data-mock-text`、`data-mock-show`、`data-mock-class`、`data-mock-attr` 等）：

| 写法 | 问题 | 改用 |
| --- | --- | --- |
| `?.`（可选链） | 不支持 | `a ? a.b : ''` |
| `??`（空值合并） | 不支持 | `a != null ? a : '默认'` |
| `\|\|` 做兜底 | 会把 `0`、`false` 也换掉 | 需保留 `0` / `false` 时用 `a != null ? a : '默认'`，否则用三元判断 |

## 报错与提醒

### 报错（拦：预览显示红框，导出取消，公网保留上一版）

报错会带调用页和组件的文件名 + 行号、原写法与改法；`check_design` 末尾「组件」一节会列出全部。

| 报错 | 原因 | 怎么改 |
| --- | --- | --- |
| 缺组件 | 找不到 `components/<名>.html` | 核对 `<c-名>` 拼写或补建组件文件 |
| 语法错 / 缺必填参数 / 重复默认值 | 语法有误、漏传 `{{名}}`、同一参数多处写默认值、`:参数` 写了表达式 | 按行号修正；补传参数或加默认值 `{{名 \| 默认}}`；`:参数` 改成纯路径 |
| 循环引用 / 超过 8 层 | 组件直接或间接互相引用，或嵌套超过 8 层 | 拆掉循环、减少嵌套层数 |
| 别名撞名 | `:参数` 路径名与组件内 `data-mock-each` 别名冲突 | 改掉其中一边的列表别名 |
| 透传冲突 | 实例传了透传名单属性，但组件根元素已有同名属性 | 删掉重复属性，或改由组件参数控制 |
| 禁用 mock 属性 | 实例上写了 `data-mock-text` / `data-mock-each` / `data-mock-model` | 删掉；循环写外层容器 + `<template>`，文本用 `:参数` |
| 出现 `data-state` | 组件定义或实例上写了 `data-state` | 改成 `data-status` 或 `data-variant` |
| 禁止标签或脚本 | 组件内有 `<html>` / `<head>` / `<body>`、`<script>`、`on…` 事件 | 删掉，只留一个根元素 + 可选 `<style>` |
| 超大小上限 | 组件文件超 256 KB、展开后一屏超 4 MB，或一屏实例超 5000 个 | 拆小组件、减少重复内容 |

### 提醒（只提醒不拦）

| 提醒 | 原因 | 怎么处理 |
| --- | --- | --- |
| 未识别属性被丢掉 | 实例上的属性既不是参数，也不在透传名单里 | 多半拼错参数名，对照组件定义修正或删掉 |
| `:参数` 路径在初始 `mock.json` 找不到 | 初始为空列表、`null` 或点击后才写入的字段都正常，也可能是拼错 | 属动态后写入字段可忽略，否则修正路径 |
| 没人用的组件 | `components/` 里有未被任何屏引用的文件 | 确认是否漏用，不用就删掉 |
| 页面 `<style>` 写了组件根 class | 页面里又覆盖了组件样式 | 删掉页面覆盖，收进组件 `<style>` 或用 `data-status` / `data-variant` |

## 编辑和限制

- **改字 / 调样式**：用了组件的屏，在工作台里改字或调样式不会直接写文件，会交给你改。先确认是要改组件定义（`components/<名>.html`，所有用到它的屏一起变），还是改当前屏传的参数或页面内容。
- **老页面自定义元素**：页面自己用脚本调用 `customElements.define('c-…')` 的，插件不按组件接管。
- **暂不支持**：带组件的设计暂不支持「保存为外框」、打分享 zip、投稿设计市场（发给别人看请导出整套可交互 HTML）。
