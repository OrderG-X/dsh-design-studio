# 图表（kind: diagram）

思维导图、技术路线图、产品路线图、架构图。**位置和连线不要自己算**：把这个技能目录里的 `diagram.css` 复制进设计目录，写下面的结构，排版、连线、箭头、分叉都由它排，改字、加节点会自己重排。

## 先挑哪一种

| 用户说的 | 用 | 根元素 |
| --- | --- | --- |
| 思维导图、脑图、知识梳理、大纲、读书笔记、头脑风暴 | 思维导图 | `<div class="dg mm">` |
| 技术路线、研究路线、技术方案流程（申报书、开题、论文那种） | 技术路线图 | `<div class="dg tr">` |
| 产品路线图、规划、版本计划、按季度 / 月份排的路线 | 产品路线图 | `<div class="dg rm">` |
| 系统架构、技术架构、分层图、平台全景 | 架构图 | `<div class="dg ar">` |
| 研究框架图、育人模式图、总体框架（申报书、结题报告那种，几层几块、互相支撑） | 架构图，层和层之间加 `dg-links` | `<div class="dg ar">` |

「技术路线」没说清是哪种：按时间分阶段排计划 → 产品路线图；分析步骤、研究方法一步步往下走 → 技术路线图。拿不准就问一句。带回路、乱连线的任意流程图不在这四种里：自己用 SVG 画，每条线连到框的边上。

不管哪种，**版块之间的关系要画出来**（见「版块之间要有关系」）；用户给了参考图，先看「照参考图画」；申报书、结题报告那种图默认画得炫一点，看「申报书炫酷样式」；要贴进 Word / PPT，看「字号」。

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

- **画幅**：默认 1600×1000。常用：1920×1080（放进 PPT）、1200×900 / 1100×1400 左右（申报书、论文插图，导出选 2 倍或 3 倍照样清楚）、2400×1400（分支多、只在屏幕上看的思维导图）。画幅越宽，贴进 Word 字越小，见「字号」。写进 meta，调 `preview_page` 时也带 `size`。图比画幅大时页面会往右、往下长，画布按实际大小显示；交付前把 meta 改成合适的画幅。
- **标题区可选**：思维导图一般不要标题（中心主题就是标题）；路线图、架构图放标题。
- **颜色**：全部来自 `tokens.css`，第 1 个分支色是主色，后面自动配。要指定某个分支 / 泳道 / 层 / 阶段的颜色，在它上面加 `c1`–`c6`。全图只用主色：根元素加 `data-tone="mono"`；技术路线图默认只用主色，要每个阶段一个颜色加 `data-tone="multi"`。
- **不要**：给节点写 `position: absolute`、写死坐标、自己画 SVG 连线、写脚本——会和自动排版打架。版块之间要加箭头用 `dg-link`。要改间距、线粗、字号，在自己的 `<style>` 里覆盖变量（`.mm { --gx: 40px }`、`.dg-page { --dg-scale: 1.5 }`），别改 `diagram.css`。

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
- 一层里有先后（A → B → C）：`<div class="ar-mods seq">`，箭头画在模块之间的空隙里。
- 层和层之间的关系：两个 `ar-layer` 中间放一排 `dg-links`，一个 `dg-link` 对着一个模块（上下两层模块个数一样就正好对齐；挨着箭头的层模块不换行，太多就拆层；这两层里别插 `dg-link`、别用 `ar-group`，递进用 `ar-mods seq`，不然会连偏，体检报「箭头没对着模块」），箭头上写关系词：

```html
<section class="ar-layer"><h3 class="ar-name">研究内容</h3><div class="ar-mods"><div class="ar-mod">内容 1</div><div class="ar-mod">内容 2</div><div class="ar-mod">内容 3</div></div></section>
<div class="dg-links"><div class="dg-link"><b>落实</b></div><div class="dg-link"><b>落实</b></div><div class="dg-link"><b>落实</b></div></div>
<section class="ar-layer"><h3 class="ar-name">实施路径</h3><div class="ar-mods">…三个模块…</div></section>
```

## 先理逻辑，确认了再画

框架图、模式图、技术路线图、架构图（三块以上、块和块之间有关系，申报书、结题报告、论文里那种）：**先别画**，先把逻辑理出来请用户确认。原文往往一节一节写，没写清「哪个问题对应哪项内容、哪个维度落在哪个课堂」；直接一节画一层，画出来就是几块各管各的。这些关系懂课题的人最清楚，你猜的不一定对。思维导图、产品路线图不用这一步（层级、时间就是关系）。**只在第一次新画、关系还没确认过时问**；改已有的图（调字号、配色、挪位置、改几个字）直接改，不再列骨架。

**这一步别省**：用户给了整段原文、写了要几张图、带了参考图，也照样先问——写得详细的是内容，不是关系；参考图管的是画法，也不是关系。用户没说「直接做」「不用问」，就列完骨架停下等回答，别「先画出来再解释」。

1. 读完用户给的内容，在回复里列「逻辑骨架」，十几行以内，用用户原文的词：
   - **核心**：一句话（模型名、核心理念，比如「四维贯通」）
   - **几块**：分几层、几栏，每块放什么
   - **关系**：一行一条——`问题① ↔ 内容① ↔ 目标①`、`认知 → 第一课堂`、`实践平台 —支撑→ 三课堂`、`反思 ⟲ 认知（闭环）`
   - **版式**：几层几栏，哪几块上下对齐（有参考图就说照它哪种画法）
   - 原文没写、你推出来的关系，后面标「（推测）」，请用户重点看
2. 请用户确认：有 `ask_user_question` 工具就用它问（选项「对，照这个画」「我改几条」），没有就在回复里问完、停下等回答。用户改了就按改的来。
3. 用户说了「直接做」「不用问」：骨架照样先列出来（几行），不等回答，接着画。
4. 画的时候，骨架里每一条关系都要在图上看得见（下面一节的箭头、对齐、编号）；画完对一遍，漏的补上。

## 版块之间要有关系

申报书、结题报告里的框架图、模式图，评审看的是**逻辑**：问题 → 目标 → 内容 → 路径 / 措施 → 成果，谁支撑谁、谁对应谁。几层各画各的、版块之间没有线，看着就是几张卡片叠在一起——真实用户的反馈原话：「没有逻辑关系，各个版块都很独立，之间的对应关系没有」。

动笔前先把关系理一遍：每一块从哪来、到哪去、和哪一块对应。然后至少用上下面两三种：

- **带关系词的箭头**：两块之间放 `dg-link`，箭头上写一个词（支撑、引领、驱动、落实、对应、转化、反馈）。往上 `up`、往右 `right`、往左 `left`、两头 `two`；层和层之间放一排 `dg-links`。自己写的版块也能用（复制了 `diagram.css` 就有）。
- **对齐成栏**：对应的东西放在同一栏（第一课堂 ↔ 认知 ↔ 研究内容 1），各层栏数一样、上下对齐；对不上就合并几块，或者用 `ar-group` 把几栏包成一组。
- **编号对应**：问题①、目标①、内容①是一组，同一个编号同一种颜色，读者顺着编号就能对上。
- **一个核心**：模型有核心（「四维贯通」「三维十二要素」这种）就放在中间，各块用箭头连到它；有循环（闭环迭代、螺旋上升）就画回环箭头。
- **层内递进**：同一层里有先后的串起来——架构图用 `ar-mods seq`，技术路线图用 `tr-row seq`，自己写的版块用 `dg-link right`。

画完自己看一遍：每一块都该有箭头或编号连到别的块。孤零零的一块，先想想是不是漏了关系（它支撑谁、对应谁）；真是并列的几项，就放进同一组、同一栏或用编号表示——别凭空连线，也别删用户的内容。

## 照参考图画

输入框里有〔参考图〕时：

1. 先打开参考图看清楚（图大就裁几块看细节）：分几层几栏、层名怎么标（左侧竖条、色带）、标题和标签的形状、卡片样子、箭头粗细和样式、编号、字号比例、颜色占比，**版块之间怎么连**。
2. 版式和画法照它学：可以不套 `.mm / .tr / .rm / .ar`，自己写 HTML + CSS；版块之间的箭头照样用 `dg-link`，颜色写进 `tokens.css`。参考图是申报书那种立体渐变的（竖条层名、色带标题、立体标签、粗箭头）：**直接用 `fx-*` 部件搭**（见「申报书炫酷样式」），颜色改 `tokens.css`，部件没有的才自己补几条 CSS。
3. 内容用用户的，不抄参考图里的字。参考图的层数、栏数和用户的内容对不上时按内容改，别硬凑。
4. 画完和参考图并排比一遍：第一眼像不像同一套画法、关系线有没有画出来。

## 申报书炫酷样式 `fx-*`

课题申报书、结题报告、开题、教学成果奖、育人模式、人才培养方案里的框架图、模式图、路线图：这一行比的是「好看、有冲击力」，**默认用这套**——立体渐变的层名竖条、色带标题、红色立体标签、粗箭头、回环箭头、发光面板。用户要素净、黑白印刷、投期刊论文就不用，照上面四种的普通画法。用户给的参考图是立体渐变那种，也用它。

- **别从零重写一套**：部件的深浅色、导出、字号都调好了，自己写的多半更素、还容易被体检挑出毛病。嫌太花就少用几种部件、body 上去掉 `fx-page`（不要柔光点阵底），别把部件换掉。
- 部件都在 `diagram.css` 里（复制过来就有），`<body class="dg-page fx-page">` 开始，不套 `.mm / .tr / .rm / .ar`；排版帮手 `fx-wrap`（整页）、`fx-head`（页头）、`fx-sec`、`fx-flow`、`fx-col`（一栏从上到下）、`fx-bridge`（层间箭头 + 横幅）、`fx-map`（对照表）够搭大多数版面，不够再自己写 grid / flex。
- 「先理逻辑」照做；关系照样要画出来：栏和栏之间 `fx-flow` 自动画粗箭头，层和层之间 `fx-arrow down` + `fx-ribbon`，闭环用 `fx-loop`，问题 / 内容 / 目标用同一个编号对上。

| 部件 | 样子 | 写法 |
| --- | --- | --- |
| `fx-title` | 渐变大标题 | `<h1 class="fx-title">` |
| `fx-gem` | 小徽章（标题上面的「课题申报 · 研究框架」） | `<span class="fx-gem">` |
| `fx-panel` | 大面板：渐变描边 + 彩色柔影，一节一个 | `<section class="fx-panel">` |
| `fx-sec` | 一节 = 左边竖条 + 右边内容 | `<div class="fx-sec"><div class="fx-rail">四维贯通</div><div>…</div></div>` |
| `fx-rail` | 层名竖条（圆柱感、竖排字） | 字 ≤ 6 个，字多会把整节撑高 |
| `fx-flow` | 等宽几栏，栏间自动画粗箭头 | `style="--fx-at: 36%"` 把箭头挪到栏高 36% 处（默认正中） |
| `fx-band` | 渐变色带标题，左边白圆里一对 » | `<div class="fx-band"><i></i>认知<small>课程教学</small></div>` |
| `fx-card` | 白卡片 | `<div class="fx-card"><small>理论对接</small><b>设计认识论</b><p>一句说明</p></div>` |
| `fx-tag` | 红色立体标签（结论两三个字） | `<span class="fx-tag">认知引领</span>` |
| `fx-slab` | 立体板，右下有厚度 | `<div class="fx-slab">课堂学</div>` |
| `fx-item` | 条目块：左色条淡底；`.solid` 实心白字 | `<div class="fx-item solid"><b class="fx-num">1</b><div><b>课程体系重构</b><span>一句说明</span></div></div>` |
| `fx-list` / `fx-num` | 编号条目 / 圆形编号 | `<ol class="fx-list"><li><b>1</b>文字</li></ol>` |
| `fx-arrow` | 粗渐变箭头，往右；`.left` `.down` `.up` | `<i class="fx-arrow down"></i>` |
| `fx-ribbon` | 双圈丝带横幅（层间那句话） | `<span class="fx-ribbon">四维贯通 · 融入三课堂</span>` |
| `fx-loop` | 回环箭头：放在一排下面，右端拐回左端 | `<div class="fx-loop"><span>闭环迭代 · 螺旋上升</span></div>` |
| `fx-core` / `fx-disc` | 发光核心球 / 立体圆台（模型核心、底座） | `<div class="fx-core">四维贯通</div>` |
| `fx-shift` | 转变：灰框 → 红色立体块 | `<div class="fx-shift"><span>教师讲</span><span>学生做</span></div>` |

**颜色**：三种色调，写在部件或它外面任何一层上，里面的都跟着变：`fx-main`（主色，默认）、`fx-warm`（红，问题、结论标签）、`fx-cool`（主色转过去的另一种色，目标、场景）。颜色来自 `tokens.css` 的 `--color-primary` 和 `--color-danger`：要紫色、蓝色就改 tokens，别在部件上手写颜色。深色模式自动跟。

```html
<body class="dg-page fx-page">
<main class="fx-wrap">
  <header class="fx-head"><span class="fx-gem">课题申报 · 研究框架</span><h1 class="fx-title">「三环联动」社区阅读推广模式</h1><p>以三所社区图书馆为试点</p></header>
  <section class="fx-panel">
    <div class="fx-sec">
      <div class="fx-rail">三环联动</div>
      <div>
        <div class="fx-flow" style="--fx-at: 36%">
          <div class="fx-col"><div class="fx-band"><i></i>引读</div><div class="fx-card"><small>理论对接</small><b>阅读动机理论</b></div><span class="fx-tag">兴趣引领</span></div>
          <!-- 另外两栏同样写 -->
        </div>
        <div class="fx-loop" style="margin-inline: 12%"><span>循环推进 · 螺旋上升</span></div>
      </div>
    </div>
    <div class="fx-bridge"><i class="fx-arrow down fx-cool"></i><span class="fx-ribbon">三环落到三类场景</span><i class="fx-arrow down fx-cool"></i></div>
    <div class="fx-sec fx-cool"><div class="fx-rail">三类场景</div><div class="fx-flow">…</div></div>
  </section>
  <section class="fx-panel">
    <div class="fx-sec"><div class="fx-rail fx-warm">研究逻辑</div>
      <div class="fx-map"><!-- 五栏：问题 | 箭头 | 内容 | 箭头 | 目标；栏宽改 --fx-cols -->
        <div class="fx-item fx-warm"><b class="fx-num">1</b>读者参与少</div><i class="fx-arrow fx-warm"></i>
        <div class="fx-item solid"><b class="fx-num">1</b><div><b>三环活动设计</b><span>引读、共读、创读逐级递进</span></div></div><i class="fx-arrow fx-cool"></i>
        <div class="fx-item fx-cool"><b class="fx-num">1</b>形成可复制的活动方案</div>
      </div>
    </div>
  </section>
</main>
```

- 画幅 1600 宽（部件按这个宽度调的），高度按内容；一张图 2–3 个 `fx-panel`，每节一根 `fx-rail`。
- 每栏从上到下：色带标题 → 卡片 → 标签或立体板；同一排栏数一样、上下对齐。
- 特效挑着用：一节里两三种部件就够；标签、立体板只写结论（两到六个字），长句放卡片。
- 部件的字号已经乘 `--dg-scale`，贴进 Word 够大；自己写的字用 `calc(16px * var(--dg-scale, 1.25))` 起步，别再加新字号（一屏字号别超过 7 种）。

## 字号

导出的图贴进 Word 会缩到页宽（约 16 厘米），字跟着缩：画幅越宽，字越小。

- **正文字号 ≥ 画幅宽 ÷ 70**（1600 宽 → 23px，1200 宽 → 17px），小字 ≥ 画幅宽 ÷ 85。`diagram.css` 的字号都乘 `--dg-scale`（默认 1.25）：整体放大写 `.dg-page { --dg-scale: 1.6 }`；自己写的版块自己定字号。
- 申报书、论文插图：画幅 1200×900（横）或 1100×1400（竖）就够，别用 2400 那种大画幅塞满字。
- 放不下就删减、合并或者拆成两张图——加大画幅，字在 Word 里一样小。
- 体检的「字偏小」按这个算：正文比画幅宽 ÷ 100 还小就提醒。

## 体检和导出

- 照常调 `check_design`：除了截断、叠字、对比度，还会查图表结构（节点没包 `mm-node`、一行框太多、横条超出时间轴、节点字太多、图超出画幅、层间箭头没对着模块）和字偏小（贴进 Word 看不清）。
- 用户要贴进 Word / PPT：告诉他在工作台「导出」里选 PNG（高清）或 PDF。
