# 图表（kind: diagram）

思维导图、技术路线图、产品路线图、架构图。**位置和连线不要自己算**：把这个技能目录里的 `diagram.css` 复制进设计目录，写下面的结构，排版、连线、箭头、分叉都由它排，改字、加节点会自己重排。

## 先挑哪一种

| 用户说的 | 用 | 根元素 |
| --- | --- | --- |
| 思维导图、脑图、知识梳理、大纲、读书笔记、头脑风暴 | 思维导图 | `<div class="dg mm">` |
| 技术路线、研究路线、技术方案流程（申报书、开题、论文那种） | 技术路线图 | `<div class="dg tr">` |
| 产品路线图、规划、版本计划、按季度 / 月份排的路线 | 产品路线图 | `<div class="dg rm">` |
| 系统架构、技术架构、分层图、平台全景 | 架构图 | `<div class="dg ar">` |

「技术路线」没说清是哪种：按时间分阶段排计划 → 产品路线图；分析步骤、研究方法一步步往下走 → 技术路线图。拿不准就问一句。带回路、乱连线的任意流程图不在这四种里：自己用 SVG 画，每条线连到框的边上。

## 文件骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="dsh-design" content="diagram 1600x1000">
<title>思维导图 · 产品经理入门</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="diagram.css">
</head>
<body class="dg-page">
<main class="dg-canvas">
  <header class="dg-head"><span class="dg-kicker">技术路线图</span><h1>标题</h1><p>一句说明（可选）</p></header>
  <!-- 图放这里：.dg.mm / .dg.tr / .dg.rm / .dg.ar -->
  <footer class="dg-foot"><ul class="dg-legend"><li class="c1">进行中</li><li class="plan">规划中</li></ul><p class="dg-note">数据来源 / 更新时间（可选）</p></footer>
</main>
</body>
</html>
```

- **画幅**：默认 1600×1000。常用：1920×1080（放进 PPT）、1400×1800 左右的竖图（申报书、论文的技术路线图）、2400×1400（分支多的思维导图）。写进 meta，调 `preview_page` 时也带 `size`。图比画幅大时页面会往右、往下长，画布按实际大小显示；交付前把 meta 改成合适的画幅。
- **标题区可选**：思维导图一般不要标题（中心主题就是标题）；路线图、架构图放标题。
- **颜色**：全部来自 `tokens.css`，第 1 个分支色是主色，后面自动配。要指定某个分支 / 泳道 / 层 / 阶段的颜色，在它上面加 `c1`–`c6`。全图只用主色：根元素加 `data-tone="mono"`；技术路线图默认只用主色，要每个阶段一个颜色加 `data-tone="multi"`。
- **不要**：给节点写 `position: absolute`、写死坐标、自己画 SVG 连线、写脚本——会和自动排版打架。要改间距、线粗，在自己的 `<style>` 里覆盖变量（`.mm { --gx: 40px }`），别改 `diagram.css`。

## 思维导图 `.mm`

```html
<div class="dg mm">
  <div class="mm-root">产品经理入门<small>90 天学习地图</small></div>
  <ul class="mm-side mm-right">
    <li><span class="mm-node">用户研究</span>
      <ul>
        <li><span class="mm-node">用户访谈</span>
          <ul><li><span class="mm-node">提纲怎么写</span></li></ul>
        </li>
        <li><span class="mm-node">用户画像<small>3–5 个就够</small></span></li>
      </ul>
    </li>
  </ul>
  <ul class="mm-side mm-left"> …另一半分支（可选）… </ul>
</div>
```

- 每个 `li` 第一个孩子是 `<span class="mm-node">`，有下一级就在它后面跟一个 `ul`。不要把字直接写在 `li` 里。
- 分支多（5 个以上）就左右对称：按大小分成两半，`mm-right` 和 `mm-left` 各放一半；少就只写 `mm-right`。
- 节点写关键词（中文 2–12 个字），补充说明放 `<small>`；一个节点一层意思。一级分支 3–7 个，每个下面 2–6 个；超过 4 层就拆成两张图。
- 一级分支自带颜色块，二级白底细框，三级以下只有字。

## 技术路线图 `.tr`

```html
<div class="dg tr">
  <section class="tr-stage">
    <h3 class="tr-label">数据获取<small>第 1–6 个月</small></h3>
    <div class="tr-body">
      <div class="tr-row">
        <div class="tr-box">多源遥感影像<small>Sentinel-2、高分三号</small></div>
        <div class="tr-box">地面观测数据</div>
      </div>
      <div class="tr-row"><div class="tr-box soft">时空配准与质量控制</div></div>
    </div>
    <div class="tr-out"><b>成果 1</b>多源数据集</div>
  </section>
  <section class="tr-stage"> … </section>
</div>
```

- 一个 `tr-stage` 是一个阶段：左边 `tr-label` 阶段名，中间 `tr-body` 虚线框里一行行 `tr-row`，右边 `tr-out` 这一阶段的成果（可选；有一个阶段写了，就会多出右边一栏）。
- 阶段之间、同一阶段里上下两行之间**自动画箭头**；一行几个框时自动画分叉（从上面分到每个框）和汇合（汇到中间往下走）。一行最多 6 个框，框会等宽。
- 一行里是先后顺序（A → B → C）：`<div class="tr-row seq">`，框之间画横向箭头。
- 框的写法：`tr-box` 白底；`soft` 浅色底（中间步骤、汇总）；`key` 主色实心（核心方法、创新点，全图一两个）。框里第一行是名称，`<small>` 补一句；要列几条用 `<ul><li>`。
- 阶段名竖排（窄的申报书插图）：根元素加 `data-label="vertical"`，阶段名写短（2–6 个字）。
- 阶段 3–6 个；框里的字一般不超过 20 个字。
- **技术路线图要看得出是一条路线**：评审一眼要看到「先做什么 → 再做什么 → 得到什么」。阶段之间、行和行之间的箭头、分叉汇合是 `diagram.css` 画的（在 `.tr-body::before`、`.tr-row::before / ::after`、`.tr-out::before` 上），换风格时别把它们隐藏或盖掉，也别改成三栏表格。研究内容多时，一个阶段分两三行往下走（研究内容 → 关键方法 → 阶段汇总），让箭头体现递进，比在一个框里塞一长串要点清楚。

## 产品路线图 `.rm`

```html
<div class="dg rm" style="--cols: 4">
  <div class="rm-head"><span>Q1 · 1–3 月</span><span>Q2 · 4–6 月</span><span>Q3 · 7–9 月</span><span>Q4 · 10–12 月</span></div>
  <section class="rm-lane">
    <h3 class="rm-name">编辑器<small>核心体验</small></h3>
    <div class="rm-track">
      <div class="rm-bar done" style="--from: 1; --span: 2">块编辑器重写<small>打开速度 2.1s → 0.6s</small></div>
      <div class="rm-bar" style="--from: 3">离线写作</div>
      <div class="rm-bar plan" style="--from: 4">手写笔支持</div>
      <div class="rm-ms" style="--at: 2">v3.0 发布</div>
    </div>
  </section>
  <div class="rm-now" style="--at: 2.4"><span>今天</span></div>
</div>
```

- `--cols` 是一共几段时间（4 个季度、12 个月、3 年……），`rm-head` 里就写几个；跨两段的表头（年份）写 `<span style="--span: 4">2026</span>`，可以放两行 `rm-head`，年份那行加 `big`。
- 横条 `rm-bar`：`--from` 从第几段开始，`--span` 占几段（不写是 1）。`--from + --span - 1` 不能超过 `--cols`。同一行放不下的会自动挪到下一行，不会叠。`done` 已完成（颜色更实），`plan` 规划中（虚线框）。
- 里程碑 `rm-ms`：`--at` 第几段，菱形落在那一段开头；`mid` 放中间、`end` 放结尾。
- 「今天」竖线 `rm-now`：`--at` 可以是小数（2.5 = 第二段正中），不要就不写。
- 泳道 3–7 条，每条 1–5 个横条；横条上的字写短（一行能放下），说明放 `<small>`。

## 架构图 `.ar`

```html
<div class="dg ar">
  <div class="ar-main">
    <section class="ar-layer">
      <h3 class="ar-name">接入层</h3>
      <div class="ar-mods">
        <div class="ar-mod">用户 App<small>iOS / Android</small></div>
        <div class="ar-mod key">API 网关</div>
      </div>
    </section>
    <section class="ar-layer">
      <h3 class="ar-name">业务服务</h3>
      <div class="ar-mods">
        <div class="ar-group"><h4>交易</h4><div class="ar-mods"><div class="ar-mod">订单</div><div class="ar-mod">支付</div></div></div>
        <div class="ar-group"><h4>履约</h4><div class="ar-mods"><div class="ar-mod">仓储</div></div></div>
      </div>
    </section>
  </div>
  <aside class="ar-side"><h3 class="ar-name">安全</h3><div class="ar-mods"><div class="ar-mod">鉴权</div><div class="ar-mod">审计</div></div></aside>
</div>
```

- 从上到下：用户能碰到的一层在最上面，基础设施在最下面。每层一个 `ar-layer`，层名 `ar-name`，模块 `ar-mod` 放进 `ar-mods`，会自动等分、放不下换行。
- 一层里再分组：`ar-group`（虚线框 + `<h4>` 组名），组的宽度按模块个数分。
- 贯穿所有层的（监控、安全、运维）：`ar-main` 后面放 `ar-side`，竖着一栏，最多两栏。
- `key` 标出重点模块（全图两三个）。层 3–7 个，每层模块 2–8 个。

## 体检和导出

- 照常调 `check_design`：除了截断、叠字、对比度，还会查图表结构（节点没包 `mm-node`、一行框太多、横条超出时间轴、节点字太多、图超出画幅）。
- 用户要贴进 Word / PPT：告诉他在工作台「导出」里选 PNG（高清）或 PDF。
