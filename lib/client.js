/**
 * dsh-design-studio 的客户端部分
 *
 *   右侧栏标签页「设计工作台」（sidebarRightTabs + sidebar.right.pane.tab）
 *     - 工具栏：地址（点一下能改）、选择、画布 / 单页、类型（网页 / App / 平板 / 海报 / 幻灯片 / 邮件）、刷新、在浏览器打开
 *     - 画布：同一个目录里的几屏按生成顺序排成网格，套上对应的外框（手机、浏览器窗口 …），能拖、能缩放；
 *       模型还在出新的一屏时，末尾留一个「生成中…」的占位
 *     - 单页：只看一屏；网页铺满，别的类型按比例缩进来
 *     - 页面跑在预览服务器的独立端口里（iframe），和 DSH 不同源
 *     - 模型在干活时舞台边上一圈流光；刚生成的一屏播生成动画（元素从上到下浮现）
 *     - 页面改了：后台载好新的一帧再淡入换上来（不白屏），改过的地方在页面里闪一下，角上报「已更新 · N 处改动」
 *     - 选择：通知页面里的 picker.js 进入选取，选好的元素 / 区域整理成一段文字塞进输入框
 *     - 设计规范面板：页面 :root 上的设计变量（颜色、字体、字号、间距、圆角、阴影），点一个放进输入框让模型改
 *   会话标题栏右边一个小按钮（conversation.session.header.utilities）：
 *     - 点了打开预览
 *     - 一直挂着，顺便盯着服务端：模型刚开了新页面（openRev 变大）就把右侧栏弹出来
 *
 * 状态全在服务端（/dsh-design-studio/api/state），这里轮询。
 */
window.__ModuleLoader__.load({
  id: 'dsh-design-studio',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    let react = null
    try { react = require('react') } catch (_) { react = null }
    const INJECT = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']
    if (!react) {
      exports.apply = () => {}
      exports.inject = INJECT
      return module.exports
    }
    const h = react.createElement
    const { useState, useEffect, useRef, useCallback } = react

    const NS = 'dsh-design-studio'
    const TAB_ID = 'dsh-design-studio'
    const KIND = 'design-studio'
    const API = '/dsh-design-studio/api/'

    const ZH = {
      title: '设计工作台',
      guideDesc: '实时看页面，点选要改的地方',
      empty: '还没有要预览的页面',
      emptyHint: '也可以直接输入 HTML 文件路径或端口：',
      hintOpen: '预览刚写的 {name}',
      headerHint: '刚写了 {name}，点开能预览',
      placeholder: '/路径/index.html 或 5173',
      go: '打开',
      pick: '选择',
      pickTip: '点选元素或框选区域，发给模型（Esc 取消）',
      pickAny: '点选任意一屏里的元素，或拖出一块区域 · Esc 取消',
      pickOne: '点选一个元素，或拖出一块区域 · Esc 取消',
      textAny: '点任意一屏里的文字直接改 · 回车保存 · Esc 退出',
      refPick: '照参考图改风格…',
      refChoose: '选一张',
      refPickTip: '选一张参考图，照它的风格改（也可以把图片拖进预览区，或在这里粘贴）',
      refEmpty: '有参考图？拖进来或粘贴，照它的风格做',
      refDrop: '松开，作为参考图',
      refDropSub: '存进设计目录的 refs/，提取配色放进输入框',
      refNotImage: '只认图片（PNG / JPG / WebP / GIF）',
      refFail: '参考图没存上：{msg}',
      refText: '〔参考图〕{path}（{w}×{h}，{tone}）\n主要颜色：{colors}\n{ask}\n',
      refLight: '整体偏浅',
      refDark: '整体偏深',
      refAccent: '（点缀）',
      refJoin: '、',
      refAsk: '照这张参考图的风格改现在的设计：先把配色、圆角、阴影和字体气质更新到 tokens.css，再让各屏跟着变；布局和文案先不动。',
      refAskNew: '照这张参考图的风格来做：先把配色、圆角、阴影和字体气质定在 tokens.css 里，再出页面。',
      textOne: '点页面里的文字直接改 · 回车保存 · Esc 退出',
      picking: '选择中…',
      canvas: '画布：几屏并排看',
      single: '单页：只看一屏',
      sizes: '多尺寸：同一屏在手机 / 平板 / 电脑上并排看',
      sizesNo: '海报、幻灯片、邮件是固定画幅，没有多尺寸',
      szPhone: '手机',
      szTablet: '平板',
      szDesktop: '电脑',
      szSmall: '小屏',
      szStd: '标准',
      szLarge: '大屏',
      kind: '类型',
      kindWeb: '网页',
      kindApp: 'App',
      kindTablet: '平板',
      kindPoster: '海报',
      kindSlides: '幻灯片',
      kindEmail: '邮件',
      tokens: '设计规范',
      tokensTip: '点一个放进输入框，补一句怎么改；改它所有屏一起变',
      tokensEmpty: '这套设计还没有设计变量（:root 上的 CSS 变量），颜色字号散在各处，改起来不统一。',
      tokensAsk: '让模型建一份',
      tokensAskText: '按 ui-design 技能给这套设计建一份 tokens.css（颜色、字体、字号、间距、圆角、阴影），所有屏都改成用这些变量。',
      gColor: '颜色',
      gFont: '字体',
      gSize: '字号',
      gSpace: '间距',
      gRadius: '圆角',
      gShadow: '阴影',
      gOther: '其他',
      exportT: '导出',
      exFrame: '这一屏 · 带外框',
      exRaw: '这一屏 · 纯画面',
      exLong: '这一屏 · 整页长图',
      exShow: '整套展示图',
      exPdf: 'PDF · 每屏一页',
      exPptx: 'PPT · 每屏一页（整页图片）',
      exWhere: '存到设计目录的 exports/；图片还会复制到剪贴板',
      exportedDoc: '已导出 {name}（{n} 页）',
      check: '设计体检',
      checkTip: '设计体检：量一量文字溢出、重叠、对比度、点击区、字号',
      checking: '正在体检…',
      checkNone: '没发现问题',
      checkSum: '{s} 屏 · {n} 个问题',
      checkFix: '交给模型修',
      checkAgain: '再查一次',
      checkFail: '没查成：{msg}',
      checkNote: '只量得出排版上的硬伤，好不好看还得你看',
      checkCount: '设计体检：上次量出 {n} 个问题，点开看',
      checkAsk: '〔设计体检〕发现 {n} 个问题，请逐个修好：改源文件，只动有问题的地方；颜色、字号能改设计变量就改设计变量。',
      ckToolHead: '量了 {s} 屏，发现 {n} 个问题。逐个改源文件，只动有问题的地方；颜色、字号能改设计变量就改设计变量：',
      ckToolOk: '量了 {s} 屏（{labels}），没发现问题。',
      ckToolOff: '用户正在看旧版本、演示或多尺寸，右侧栏现在量不了；过一会儿再调，或照「自查」清单自己过一遍。',
      ckToolErr: '{label}：没量成（{msg}）',
      ck_hscroll: '超出屏幕',
      ck_clipped: '文字被截断',
      ck_overflow: '文字超出框',
      ck_overlap: '文字叠在一起',
      ck_contrast: '对比度不够',
      ck_tap: '点击区太小',
      ck_tiny: '字太小',
      ck_img: '图片没加载出来',
      ck_fonts: '字号太杂',
      ck_distort: '图片被拉变形',
      ck_long: '一行太长',
      ck_wrap: '文字被挤断行',
      ck_covered: '被固定栏压住',
      ck_tight: '离固定栏太近',
      ck_jserr: '页面脚本报错',
      ck_missing: '文件没载出来',
      cd_hscroll: '伸出屏幕 {px}px',
      cd_clipped: '被切掉 {px}px',
      cd_overflow: '伸出框 {px}px',
      cd_overlap: '和 {other}「{otherText}」叠在一起',
      cd_contrast: '{fg} 配 {bg}，{ratio}:1（要 ≥ {need}:1）',
      cd_tap: '{w}×{h}（至少 {min}×{min}）',
      cd_tiny: '{size}px（至少 {min}px）',
      cd_img: '{src}',
      cd_fonts: '一屏用了 {n} 种字号：{sizes}',
      cd_distort: '原图 {nw}×{nh}，显示成 {w}×{h}（用 object-fit: cover 或改尺寸）',
      cd_long: '一行约 {chars} 字（最好 ≤ {max}）',
      cd_wrap: '折成了 {lines} 行（按钮、价格这种短字别断行：给它更多宽度、white-space: nowrap 或缩短文字）',
      cd_covered: '{when}被{edgeName} {bar} 压住 {px}px（给内容留出栏的高度）',
      cd_tight: '离{edgeName} {bar} 只有 {px}px（留 16px 以上）',
      cd_jserr: '{msg}{at}',
      cd_missing: '{what} {src} 载不出来（路径写错了，或者文件不在）',
      ckEdge_top: '顶栏',
      ckEdge_bottom: '底栏',
      ckWhen_top: '没滚时',
      ckWhen_bottom: '滚到底还',
      ckWhat_css: '样式表',
      ckWhat_script: '脚本',
      ckWhat_font: '字体',
      ckWhat_other: '文件',
      ckSize: '{w}×{h}，页面高 {page}',
      ckSizeBar: '，{edgeName} {bar} 离内容 {gap}px',
      ckScreen: '{label}（{where}）',
      ckItem: '{i}. {type}：{where}{text} — {detail}',
      ckQuote: '「{text}」',
      exporting: '正在导出…',
      exported: '已导出 {name}',
      exportedCopied: '已导出 {name}，也复制到剪贴板了',
      exportFail: '导出失败：{msg}',
      reveal: '打开文件夹',
      madeWith: '用 DSH 设计工作台做的',
      showSub: '{n} 屏 · {kind} · {date}',
      history: '版本',
      histTip: '每轮对话前后各存一版。点一版看当时的样子，还能和现在左右对比',
      histEmpty: '还没有版本。模型每轮改完会自动存一版。',
      now: '现在',
      vN: '第 {n} 版',
      vBefore: '这轮开始前',
      vSaved: '回退前的样子',
      vChanged: '改了 {files}',
      vMore: '{first} 等 {n} 个文件',
      vFirst: '最早的一版 · {n} 个文件',
      sep: '、',
      viewing: '第 {n} 版 · {time}',
      compare: '对比',
      restore: '回到这一版',
      backNow: '回到现在',
      restored: '已回到第 {n} 版（之前的样子也存了一版）',
      notInVer: '第 {n} 版里还没有这一屏',
      cmpNow: '现在',
      dark: '深色模式',
      variants: '再出两版',
      pickThis: '就要这个：其他版本挪进 drafts/，接着做全套',
      pickText: '〔选定方向〕就用「{name}」（{where}）。先把同组的 {others} 挪进 drafts/ 子目录（别删），再把它改名成 {base}.html；它的设计变量搬进 tokens.css（没有就新建）、改用 tokens.css。然后接着做全套。\n',
      pickKeep: '〔选定方向〕留原版「{name}」（{where}）。同组的 {others} 挪进 drafts/ 子目录（别删），其他不动。\n',
      variantText: '给「{name}」再出两版不同方向的设计（布局或视觉风格明显不同），存成同目录下的 {b}-b.html 和 {b}-c.html，会紧挨着原版排在画布上。原版和 tokens.css 别动；新版要换配色就在自己文件里覆盖变量。\n{where}\n',
      exThis: '导出这一屏',
      demo: '演示：点页面里的按钮跳到别的屏',
      demoOn: '演示中 · 点按钮跳转',
      demoBack: '返回上一屏',
      demoRestart: '从头开始',
      demoExit: '退出演示（Esc）',
      textEdit: '改字：点页面里的文字直接改，回车保存（Esc 退出）',
      textSaved: '已改好，写回 {file}',
      textAsk: '把页面上的「{before}」改成「{after}」（只改这一处文字，别的不动）。\n{where}\n',
      styleEdit: '调样式：点页面里的元素，拖滑块改字号、颜色、圆角、间距（Esc 退出）',
      styleAny: '点任意一屏里的元素调样式 · Esc 退出',
      styleOne: '点页面里的元素调样式 · Esc 退出',
      style: '调样式',
      styleNone: '在页面上点一个元素。改的时候页面上先看效果，满意了再写回文件。',
      styleFont: '字号',
      styleWeight: '字重',
      styleColor: '文字',
      styleBg: '背景',
      styleClear: '透明',
      styleRadius: '圆角',
      stylePadY: '上下内边距',
      stylePadX: '左右内边距',
      styleGap: '子元素间距',
      styleW400: '常规',
      styleW500: '中等',
      styleW600: '半粗',
      styleW700: '粗',
      styleVar: '设计变量 {name}',
      styleGradient: '现在是渐变，选一个颜色会换成纯色',
      styleReset: '还原',
      styleAsk: '交给模型',
      styleSave: '写回文件',
      styleSaveTip: '写进这个元素在源码里的 style 属性（改前改后各存一版）',
      styleAskTip: '让模型改进样式表（能用设计变量就用）',
      styleNoWrite: '开发服务器的页面不在这里写回，交给模型改',
      styleBusyTip: '模型在干活，等它停了再写回',
      styleSaved: '样式已写回 {file}',
      styleMiss: '源码里没找到这个元素（可能是脚本生成的），改成交给模型',
      styleN: '改了 {n} 项',
      styleAskText: '〔调样式〕{name}（{sel}）：{list}。{rules}把这些写进它的样式规则（能用设计变量就用设计变量），别写成行内 style。\n{where}\n',
      ruleFrom: '- {props}：现在由 {sel} 决定（{at}）',
      ruleMaybe: '- {props}：大概由 {sel} 决定（{at}；它在 @layer / @container 里，没细算，改之前看一眼）',
      ruleInline: '- {props}：现在写在元素的行内 style 上{over}',
      ruleOver: '，盖过了 {sel}（{at}）',
      ruleAt: '{file} 第 {line} 行',
      styleArrow: '{prop} {from} → {to}',
      styleJoin: '；',
      lang: 'zh',
      stylesHead: '先挑一个风格开工',
      stylesTip: '点一个，整套配色、字体、圆角放进输入框；再写要做什么',
      stylesOpen: '换个风格…',
      stylesTitle: '换个风格',
      stylesSwap: '点一个，让模型把现在的设计换成这个风格（先改 tokens.css，布局和文案不动）',
      styleText: '〔风格〕{name}——{desc}\n配色：{colors}\n字体：{fonts}\n形状：{shape}\n要点：{notes}\n{ask}',
      styleColors: '底色 {bg}，卡片 {surface}，文字 {text}，次要文字 {muted}，分隔线 {line}，主色 {primary}（上面的字 {on}），点缀 {accent}（只做图形、大字），链接和小字强调 {link}{bgImage}',
      styleBgImage: '；底色上叠 {v}',
      styleFonts: '标题 {head}；正文 {body}',
      styleShape: '圆角 {r}px；阴影 {s}',
      styleStart: '照这个风格来做（先把这些定进 tokens.css；不用再问想要什么感觉）：',
      styleRestyle: '把现在的设计换成这个风格：先改 tokens.css（配色、字体、圆角、阴影），各屏跟着变；页面里写死的颜色也换成变量；布局和文案先不动。\n',
      demoNone: '这一屏还没有跳到别的屏的按钮；可以让模型用 <a href="detail.html"> 把几屏串起来',
      phone: '在手机上看',
      away: '这里看不到预览：开发服务器跑在电脑本机上，从手机或别的电脑打开 DSH 时连不过去（本地 HTML 文件的设计能看）。回到那台电脑上看；想在手机上看，就在电脑上点「在手机上看」扫码（同一个 Wi-Fi）。',
      remoteFail: '这一屏没能传过来（连接断了，或图片太大）。点「刷新」再试。',
      phoneStarting: '正在打开…',
      phoneHow: '用手机相机扫一扫',
      phoneWifi: '手机和电脑要连同一个 Wi-Fi',
      phoneWait: '等手机打开…',
      phoneSeen: '手机已打开',
      phoneFollow: '电脑上点哪一屏，手机跟着跳；改了设计，手机也自动刷新。',
      phoneCopy: '复制链接',
      phoneCopied: '链接已复制，可以发到手机上打开',
      phoneStop: '停止',
      phoneAuto: '只有扫了这个码的手机能打开，30 分钟没人看自动关。',
      phoneNoLan: '电脑没连上 Wi-Fi 或有线网，手机连不过来。',
      phoneFail: '没打开：{msg}',
      phoneHelp: '打不开？确认在同一个 Wi-Fi；手机开着代理 / VPN 的先关掉；电脑问「是否允许传入连接」时点允许。',
      zoomIn: '放大',
      zoomOut: '缩小',
      fit: '适合画布',
      openScreen: '双击只看这一屏',
      generating: '生成中…',
      waiting: '模型正在工作，页面写出来就显示在这里',
      refresh: '刷新',
      external: '在浏览器里打开',
      more: '更多',
      demoShort: '演示',
      editAddr: '换一个地址',
      working: '模型正在工作',
      asking: '模型在等你回答（在对话里）',
      writing: '正在写 {file}',
      born: '已生成 {name}',
      updated: '已更新{file}',
      updatedN: '已更新{file} · {n} 处改动',
      updatedWhole: '已更新{file} · 整页重排',
      step1: '让模型做一个网页、App 界面或海报',
      step2: '点「选择」，点元素或拖出一块区域',
      step3: '在输入框补一句要怎么改，发出去',
      inserted: '已放进输入框，补一句要怎么改',
      insertedSend: '已放进输入框，发出去就行',
      copied: '已复制，粘贴到输入框里',
      failed: '没放进去：{msg}',
      openFailed: '打不开：{msg}',
      headerTip: '设计工作台',
      tweaks: '调节滑块',
      twTip: '模型给这套设计做的几个维度：拖的时候所有屏一起变，还没写进文件。',
      twEmpty: '这套设计还没有专属滑块。让模型挑几个最值得试的维度（留白、圆角、主色、排法……），做成滑块放在这里。',
      twMake: '让模型做几个',
      twFix: '让模型修好',
      twMakeText: '〔调节滑块〕给这套设计做 3–5 个调节滑块：挑最值得试的维度（比如留白、圆角、主色、卡片排法），照 ui-design 技能「调节滑块」一节写进设计目录的 tweaks.json，把样式接上，做完用 check_design 查一遍。',
      twFixText: '〔调节滑块〕tweaks.json 有问题：{errs}。照 ui-design 技能「调节滑块」一节改好。',
      twAskHead: '〔调节〕我在右侧调节滑块里调成了下面这样，照这个改设计（改样式源文件，tweaks.json 里对应的 value 也改成新值）：',
      twAskTip: '让模型照这几个值改设计（可以顺手调整相关的地方）',
      twSaveTip: 'CSS 变量写进 tokens.css 的默认值，属性写到每屏的 <html> 上（改前改后各存一版）',
      twNoWrite: '开发服务器的页面不能直接写回，交给模型改',
      twMoved: '设计已经换了，没写回；再拖一次',
      twSaved: '已写回 {n} 项',
      twMissed: '{names} 在样式里没找到默认值，没写回：交给模型改',
      systems: '品牌设计系统',
      sysOpen: '品牌设计系统…',
      sysEmptyLine: '有自己的品牌？',
      sysTip: '从你的网站或项目里提取的颜色、字体、圆角和组件。设为默认后，做新设计都照它来。',
      sysEmpty: '还没有。在下面填你的网站地址或项目文件夹，让模型提一套。',
      sysDefault: '默认',
      sysSet: '设为默认',
      sysUnset: '不再默认',
      sysApply: '套用到当前设计',
      sysPh: '网站地址或项目文件夹',
      sysExtract: '提取',
      sysExtractText: '〔提取设计系统〕从 {src} 提取我的品牌设计系统（调 extract_design_system），设为默认，以后做新设计都照它来。提完对照截图核对一遍，再打开样张给我看。',
      sysApplyText: '〔套用设计系统〕把右侧这套设计换成设计系统「{name}」（{dir}）：复制它的 tokens.css、components.css 进设计目录，每屏都 link 上，按钮、输入框、卡片换成里面的类，颜色、字体、圆角都照它；版式和内容不变。',
      sysSetOk: '之后做新设计都照「{name}」',
      sysUnsetOk: '已取消默认',
      handoff: '转成代码',
      hoTip: '把设计做成真项目的代码：先整理交接说明和截图，再一屏一屏写，每屏写完和设计稿逐像素比，对上了再做下一屏。',
      hoFw: '用什么做',
      hoSame: '跟现有项目一样（{label}）',
      hoHtml: '纯 HTML / CSS',
      hoDest: '代码放在',
      hoScope: '范围',
      hoAll: '全部 {n} 屏',
      hoOne: '只转这一屏',
      hoScopeOne: '只做 {name}',
      hoGo: '开始转成代码',
      hoProxy: '现在预览的是开发服务器上的页面，它已经是代码了。要转的是用本地 HTML 做的设计。',
      hoLoading: '正在看会话目录…',
      hoText: '〔转成代码〕把右侧的设计做成真项目的代码。\n- 用：{fw}\n- 放在：{dest}\n- 范围：{scope}\n先调 handoff_design（framework: {key}，dest: {dest}{only}）拿交接说明，照 HANDOFF.md 一屏一屏做；每屏做完把开发服务器跑起来，用 compare_design 和设计稿比，差异降到 3% 以下再做下一屏。设计目录里的文件别改。',
    }
    const EN = {
      title: 'Design Studio',
      guideDesc: 'Live page, pick what to change',
      empty: 'Nothing to preview yet',
      emptyHint: 'Or enter an HTML path or a port:',
      hintOpen: 'Preview {name}',
      headerHint: '{name} was just written. Click to preview it',
      placeholder: '/path/index.html or 5173',
      go: 'Open',
      pick: 'Select',
      pickTip: 'Click an element or drag a region to send it to the model (Esc to cancel)',
      pickAny: 'Click an element in any screen, or drag a region · Esc to cancel',
      pickOne: 'Click an element or drag a region · Esc to cancel',
      textAny: 'Click text in any screen to edit · Enter to save · Esc to stop',
      refPick: 'Restyle from a reference…',
      refChoose: 'Choose one',
      refPickTip: 'Pick a reference image to restyle after (or drop / paste an image into the preview)',
      refEmpty: 'Have a reference image? Drop or paste it here to design in its style',
      refDrop: 'Drop to use as a reference',
      refDropSub: 'Saved to refs/ in the design folder; its colors go into the input',
      refNotImage: 'Images only (PNG / JPG / WebP / GIF)',
      refFail: 'Could not save the reference: {msg}',
      refText: '[Reference image] {path} ({w}×{h}, {tone})\nMain colors: {colors}\n{ask}\n',
      refLight: 'light overall',
      refDark: 'dark overall',
      refAccent: ' (accent)',
      refJoin: ', ',
      refAsk: 'Restyle the current design after this reference: update colors, radii, shadows and type feel in tokens.css first, then let every screen follow. Keep layout and copy for now.',
      refAskNew: 'Design in the style of this reference: set colors, radii, shadows and type feel in tokens.css first, then build the pages.',
      textOne: 'Click any text in the page to edit · Enter to save · Esc to stop',
      picking: 'Selecting…',
      canvas: 'Canvas: screens side by side',
      single: 'Single: one screen',
      sizes: 'Sizes: the same screen on phone, tablet and desktop side by side',
      sizesNo: 'Posters, slides and emails have a fixed size',
      szPhone: 'Phone',
      szTablet: 'Tablet',
      szDesktop: 'Desktop',
      szSmall: 'Small',
      szStd: 'Standard',
      szLarge: 'Large',
      kind: 'Type',
      kindWeb: 'Web',
      kindApp: 'App',
      kindTablet: 'Tablet',
      kindPoster: 'Poster',
      kindSlides: 'Slides',
      kindEmail: 'Email',
      tokens: 'Design tokens',
      tokensTip: 'Click one to put it in the input, then say how to change it. All screens follow',
      tokensEmpty: 'This design has no tokens yet (CSS variables on :root), so colors and sizes are scattered.',
      tokensAsk: 'Ask the model for one',
      tokensAskText: 'Following the ui-design skill, create a tokens.css for this design (colors, fonts, type sizes, spacing, radii, shadows) and make every screen use those variables.',
      gColor: 'Colors',
      gFont: 'Fonts',
      gSize: 'Type sizes',
      gSpace: 'Spacing',
      gRadius: 'Radii',
      gShadow: 'Shadows',
      gOther: 'Other',
      exportT: 'Export',
      exFrame: 'This screen · in frame',
      exRaw: 'This screen · plain',
      exLong: 'This screen · full page',
      exShow: 'Showcase of all screens',
      exPdf: 'PDF · one page per screen',
      exPptx: 'PowerPoint · one slide per screen (as images)',
      exWhere: 'Saved to exports/ in the design folder; images are also copied to the clipboard',
      exportedDoc: 'Exported {name} ({n} pages)',
      check: 'Design check',
      checkTip: 'Design check: measure overflowing or overlapping text, contrast, tap targets and type sizes',
      checking: 'Checking…',
      checkNone: 'No problems found',
      checkSum: '{s} screens · {n} problems',
      checkFix: 'Ask the model to fix',
      checkAgain: 'Check again',
      checkFail: 'Check failed: {msg}',
      checkNote: 'Only measurable layout problems; whether it looks good is still up to you',
      checkCount: 'Design check: {n} problems last time. Click to see them',
      checkAsk: '[Design check] Found {n} problems. Please fix each one in the source files, touching only what is listed; for colors and type sizes, change the design tokens where possible.',
      ckToolHead: 'Measured {s} screens and found {n} problems. Fix each one in the source files, touching only what is listed; for colors and type sizes, change the design tokens where possible:',
      ckToolOk: 'Measured {s} screens ({labels}). No problems found.',
      ckToolOff: 'The user is looking at an old version, the demo or the multi-size view, so the sidebar can\'t measure right now. Try again in a moment, or go through the self-check list yourself.',
      ckToolErr: '{label}: could not measure ({msg})',
      ck_hscroll: 'Wider than the screen',
      ck_clipped: 'Text cut off',
      ck_overflow: 'Text spills out of its box',
      ck_overlap: 'Overlapping text',
      ck_contrast: 'Low contrast',
      ck_tap: 'Tap target too small',
      ck_tiny: 'Text too small',
      ck_img: 'Image failed to load',
      ck_fonts: 'Too many type sizes',
      ck_distort: 'Stretched image',
      ck_long: 'Lines too long',
      ck_wrap: 'Short text wraps',
      ck_covered: 'Hidden under a fixed bar',
      ck_tight: 'Too close to a fixed bar',
      ck_jserr: 'Script error',
      ck_missing: 'File failed to load',
      cd_hscroll: 'sticks out {px}px',
      cd_clipped: '{px}px cut off',
      cd_overflow: 'sticks out {px}px',
      cd_overlap: 'overlaps {other} "{otherText}"',
      cd_contrast: '{fg} on {bg}, {ratio}:1 (needs ≥ {need}:1)',
      cd_tap: '{w}×{h} (at least {min}×{min})',
      cd_tiny: '{size}px (at least {min}px)',
      cd_img: '{src}',
      cd_fonts: '{n} type sizes on one screen: {sizes}',
      cd_distort: '{nw}×{nh} shown at {w}×{h} (use object-fit: cover or fix the size)',
      cd_long: 'about {chars} characters per line (keep it ≤ {max})',
      cd_wrap: 'breaks onto {lines} lines (keep short labels and prices on one line: more width, white-space: nowrap, or shorter text)',
      cd_covered: '{when}{px}px hidden under the {edgeName} {bar} (leave room for the bar)',
      cd_tight: 'only {px}px from the {edgeName} {bar} (leave 16px or more)',
      cd_jserr: '{msg}{at}',
      cd_missing: '{what} {src} did not load (wrong path, or the file is missing)',
      ckEdge_top: 'top bar',
      ckEdge_bottom: 'bottom bar',
      ckWhen_top: 'before scrolling, ',
      ckWhen_bottom: 'even scrolled to the end, ',
      ckWhat_css: 'stylesheet',
      ckWhat_script: 'script',
      ckWhat_font: 'font',
      ckWhat_other: 'file',
      ckSize: '{w}×{h}, page height {page}',
      ckSizeBar: ', {edgeName} {bar} {gap}px from the content',
      ckScreen: '{label} ({where})',
      ckItem: '{i}. {type}: {where}{text} — {detail}',
      ckQuote: ' "{text}"',
      exporting: 'Exporting…',
      exported: 'Exported {name}',
      exportedCopied: 'Exported {name} and copied it',
      exportFail: 'Export failed: {msg}',
      reveal: 'Show in folder',
      madeWith: 'Made with DSH Design Studio',
      showSub: '{n} screens · {kind} · {date}',
      history: 'Versions',
      histTip: 'A version is saved before and after every turn. Click one to see it, or compare it side by side',
      histEmpty: 'No versions yet. One is saved after every turn.',
      now: 'Now',
      vN: 'Version {n}',
      vBefore: 'Before this turn',
      vSaved: 'Before restoring',
      vChanged: 'Changed {files}',
      vMore: '{first} and {rest} more',
      vFirst: 'Earliest kept · {n} files',
      sep: ', ',
      viewing: 'Version {n} · {time}',
      compare: 'Compare',
      restore: 'Restore this',
      backNow: 'Back to now',
      restored: 'Restored version {n} (what you had is saved as a version too)',
      notInVer: 'Version {n} has no such screen yet',
      cmpNow: 'Now',
      dark: 'Dark mode',
      variants: 'Two more takes',
      pickThis: 'Use this one: move the other takes to drafts/ and build the rest',
      pickText: '[Direction picked] Use "{name}" ({where}). First move the other takes in its group ({others}) into a drafts/ subfolder (don\'t delete them), then rename it to {base}.html; move its design tokens into tokens.css (create it if missing) and switch it to tokens.css. Then build the rest.\n',
      pickKeep: '[Direction picked] Keep the original "{name}" ({where}). Move the other takes in its group ({others}) into a drafts/ subfolder (don\'t delete them) and leave everything else as is.\n',
      variantText: 'Make two alternative designs of "{name}" in clearly different directions (layout or visual style). Save them next to it as {b}-b.html and {b}-c.html; they will sit right after the original on the canvas. Leave the original and tokens.css unchanged; override variables inside the new files if they need other colors.\n{where}\n',
      exThis: 'Export this screen',
      demo: 'Play: tap buttons in the page to move between screens',
      demoOn: 'Playing · tap to navigate',
      demoBack: 'Back',
      demoRestart: 'Start over',
      demoExit: 'Stop playing (Esc)',
      textEdit: 'Edit text: click any text in the page, Enter to save (Esc to stop)',
      textSaved: 'Saved to {file}',
      textAsk: 'Change the text "{before}" to "{after}" on the page (only this text, nothing else).\n{where}\n',
      styleEdit: 'Style: click an element, then drag sliders for size, colors, radius and spacing (Esc to stop)',
      styleAny: 'Click an element in any screen to style it · Esc to stop',
      styleOne: 'Click an element in the page to style it · Esc to stop',
      style: 'Style',
      styleNone: 'Click an element in the page. Changes show in the preview first; save them to the file when you like them.',
      styleFont: 'Font size',
      styleWeight: 'Weight',
      styleColor: 'Text',
      styleBg: 'Background',
      styleClear: 'transparent',
      styleRadius: 'Radius',
      stylePadY: 'Padding (top / bottom)',
      stylePadX: 'Padding (left / right)',
      styleGap: 'Gap',
      styleW400: 'Regular',
      styleW500: 'Medium',
      styleW600: 'Semi',
      styleW700: 'Bold',
      styleVar: 'Token {name}',
      styleGradient: 'It is a gradient now; picking a color makes it solid',
      styleReset: 'Reset',
      styleAsk: 'Ask the model',
      styleSave: 'Save to file',
      styleSaveTip: 'Writes into this element\'s style attribute in the source (a version is kept before and after)',
      styleAskTip: 'Let the model move it into the stylesheet (using tokens where it can)',
      styleNoWrite: 'Dev-server pages are not written here; ask the model',
      styleBusyTip: 'The model is working; save when it stops',
      styleSaved: 'Style saved to {file}',
      styleMiss: 'Could not find this element in the source (maybe a script made it); asking the model instead',
      styleN: '{n} changed',
      styleAskText: '[Style] {name} ({sel}): {list}. {rules}Put it in its stylesheet rule, using design tokens where you can, not an inline style.\n{where}\n',
      ruleFrom: '- {props}: currently set by {sel} ({at})',
      ruleMaybe: '- {props}: probably set by {sel} ({at}; it sits in @layer / @container and was not fully resolved, check before editing)',
      ruleInline: '- {props}: currently in the element\'s inline style{over}',
      ruleOver: ', overriding {sel} ({at})',
      ruleAt: '{file} line {line}',
      styleArrow: '{prop} {from} → {to}',
      styleJoin: '; ',
      lang: 'en',
      stylesHead: 'Start from a style',
      stylesTip: 'Pick one to put its colors, fonts and shapes in the chat box, then say what to make',
      stylesOpen: 'Try another style…',
      stylesTitle: 'Change the style',
      stylesSwap: 'Pick one and the model restyles the current design (tokens.css first; layout and copy stay)',
      styleText: '[Style] {name}: {desc}\nColors: {colors}\nFonts: {fonts}\nShape: {shape}\nNotes: {notes}\n{ask}',
      styleColors: 'background {bg}, cards {surface}, text {text}, muted text {muted}, lines {line}, primary {primary} (text on it {on}), accent {accent} (graphics and large text only), links and small emphasis {link}{bgImage}',
      styleBgImage: '; on the background: {v}',
      styleFonts: 'headings {head}; body {body}',
      styleShape: 'radius {r}px; shadow {s}',
      styleStart: 'Design in this style (put these into tokens.css first; no need to ask about the feel again):',
      styleRestyle: 'Restyle the current design to this: update tokens.css first (colors, fonts, radius, shadows) so every screen follows; replace hard-coded colors in the pages with tokens; keep layout and copy for now.\n',
      demoNone: 'This screen has no links to other screens yet. Ask the model to connect screens with <a href="detail.html">',
      phone: 'View on phone',
      away: 'The dev server runs on the computer itself, so it can\'t load when DSH is opened from a phone or another computer (designs made of local HTML files do show). View it on that computer, or click "View on phone" there and scan the code (same Wi-Fi).',
      remoteFail: 'This screen couldn\'t be sent over (connection dropped, or the images are too large). Click Reload to try again.',
      phoneStarting: 'Starting…',
      phoneHow: 'Scan with your phone camera',
      phoneWifi: 'Phone and computer must be on the same Wi-Fi',
      phoneWait: 'Waiting for your phone…',
      phoneSeen: 'Open on your phone',
      phoneFollow: 'Your phone follows the screen you pick here and refreshes when the design changes.',
      phoneCopy: 'Copy link',
      phoneCopied: 'Link copied. Send it to your phone',
      phoneStop: 'Stop',
      phoneAuto: 'Only a phone that scanned this code can open it. Closes after 30 minutes idle.',
      phoneNoLan: 'This computer is not on Wi-Fi or a wired network, so a phone cannot reach it.',
      phoneFail: 'Could not start: {msg}',
      phoneHelp: "Won't open? Check both are on the same Wi-Fi, turn off any VPN or proxy on the phone, and allow incoming connections if your computer asks.",
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit',
      openScreen: 'Double-click to view this screen alone',
      generating: 'Generating…',
      waiting: 'The model is working. The page shows up here once it is written',
      refresh: 'Reload',
      external: 'Open in browser',
      more: 'More',
      demoShort: 'Play',
      editAddr: 'Change address',
      working: 'The model is working',
      asking: 'The model is waiting for your answer (in the chat)',
      writing: 'Writing {file}',
      born: 'Generated {name}',
      updated: 'Updated{file}',
      updatedN: 'Updated{file} · {n} changes',
      updatedWhole: 'Updated{file} · whole page',
      step1: 'Ask the model for a web page, app screen or poster',
      step2: 'Click Select, then an element or drag a region',
      step3: 'Say what to change in the input and send',
      inserted: 'Added to the input. Say what to change',
      insertedSend: 'Added to the input. Just send it',
      copied: 'Copied. Paste it into the input',
      failed: 'Could not add it: {msg}',
      openFailed: 'Could not open: {msg}',
      headerTip: 'Design Studio',
      tweaks: 'Tweaks',
      twTip: 'Knobs the model made for this design. Every screen follows as you drag; nothing is written yet.',
      twEmpty: 'This design has no tweaks yet. Ask the model to pick the dimensions most worth trying (spacing, radius, brand color, layout…) and put them here as knobs.',
      twMake: 'Ask the model',
      twFix: 'Ask the model to fix it',
      twMakeText: '[Tweaks] Make 3–5 tweaks for this design: pick the dimensions most worth trying (spacing, radius, brand color, card layout…), write them to tweaks.json in the design folder as the ui-design skill describes under "Tweaks", wire up the styles, then run check_design.',
      twFixText: '[Tweaks] tweaks.json has problems: {errs}. Fix it as the ui-design skill describes under "Tweaks".',
      twAskHead: '[Tweaks] I set the tweaks in the sidebar to these values. Change the design to match (edit the style sources and update the matching values in tweaks.json):',
      twAskTip: 'Let the model apply these values (and adjust related details)',
      twSaveTip: 'CSS variables go into the defaults in tokens.css, attributes onto each screen\'s <html> (a version is kept before and after)',
      twNoWrite: 'Dev-server pages cannot be written back. Ask the model instead',
      twMoved: 'The design changed, so nothing was written. Try again',
      twSaved: 'Wrote back {n}',
      twMissed: 'No default found in the styles for {names}, not written. Ask the model instead',
      systems: 'Brand design systems',
      sysOpen: 'Brand design systems…',
      sysEmptyLine: 'Have your own brand?',
      sysTip: 'Colors, fonts, radii and components pulled from your site or project. The default one is used for every new design.',
      sysEmpty: 'None yet. Enter your website or project folder below and let the model extract one.',
      sysDefault: 'Default',
      sysSet: 'Make default',
      sysUnset: 'Stop using',
      sysApply: 'Apply to this design',
      sysPh: 'Website or project folder',
      sysExtract: 'Extract',
      sysExtractText: '[Design system] Extract my brand design system from {src} (call extract_design_system) and make it the default for new designs. Check it against the screenshots, then open the specimen for me.',
      sysApplyText: '[Design system] Switch the design in the sidebar to the design system "{name}" ({dir}): copy its tokens.css and components.css into the design folder, link them on every screen, use its button, input and card classes, and follow its colors, fonts and radii. Keep the layout and content.',
      sysSetOk: 'New designs will follow "{name}"',
      sysUnsetOk: 'No default design system now',
      handoff: 'Build as code',
      hoTip: 'Turn the design into a real project: a handoff note and screenshots first, then one screen at a time, each pixel-compared with the design before moving on.',
      hoFw: 'Build with',
      hoSame: 'Same as the project ({label})',
      hoHtml: 'Plain HTML / CSS',
      hoDest: 'Put the code in',
      hoScope: 'Scope',
      hoAll: 'All {n} screens',
      hoOne: 'This screen only',
      hoScopeOne: 'only {name}',
      hoGo: 'Start building',
      hoProxy: 'This preview is a dev-server page, which is already code. Building works on designs made as local HTML.',
      hoLoading: 'Looking at the session folder…',
      hoText: '[Build as code] Build the design in the sidebar as a real project.\n- With: {fw}\n- In: {dest}\n- Scope: {scope}\nCall handoff_design (framework: {key}, dest: {dest}{only}) for the handoff note and follow HANDOFF.md one screen at a time. After each screen, run the dev server and call compare_design until the difference is under 3%, then move on. Do not edit the design folder.',
    }

    function makeT(ctx) {
      let bound = null
      try { bound = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : null } catch { bound = null }
      return (key, vars) => {
        let s = ''
        try { s = bound ? bound(key) : '' } catch { s = '' }
        if (!s || s === key || s === `${NS}.${key}`) s = ZH[key] || key
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
        return s
      }
    }

    // ── 样式（DSH 设计变量，深浅主题跟着走）──────────────────────────────────

    const ACCENT = '#4d6bfe'
    const EASE = 'cubic-bezier(.2,.8,.2,1)'
    const CSS = `
.ddp{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:12px;container-type:inline-size}
.ddp-bar{position:relative;z-index:8;display:flex;align-items:center;gap:4px;height:40px;padding:0 8px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));flex:none}
.ddp-addr{flex:1;min-width:0;display:flex;align-items:center;gap:7px;height:26px;padding:0 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:text;border:.5px solid transparent;overflow:hidden}
.ddp-addr:hover{border-color:var(--dsw-alias-border-l3)}
.ddp-addr span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;flex:none;box-shadow:0 0 0 3px rgba(34,197,94,.15)}
.ddp-dot.off{background:var(--dsw-alias-label-tertiary);box-shadow:none}
.ddp-dot.wait{background:#f5a524;box-shadow:0 0 0 3px rgba(245,165,36,.15);animation:ddp-blink 1s ease-in-out infinite}
.ddp-input{flex:1;min-width:0;height:26px;padding:0 10px;border-radius:999px;border:.5px solid ${ACCENT};background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.ddp-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;min-width:28px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;flex:none;white-space:nowrap}
.ddp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.ddp-btn:disabled{opacity:.4;pointer-events:none}
.ddp-btn svg{width:15px;height:15px;flex:none}
.ddp-btn.on{background:${ACCENT};color:#fff}
.ddp-btn.sel{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}
.ddp-btn.pick{padding:0 9px}
.ddp-btn .cr{width:10px;height:10px;margin-left:-2px;opacity:.6}
.ddp-seg{display:inline-flex;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);flex:none}
.ddp-seg .ddp-btn{height:24px;min-width:26px;border-radius:5px}
.ddp-seg .ddp-btn.sel{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.ddp-sep{width:.5px;height:16px;background:var(--dsw-alias-border-l3);margin:0 2px;flex:none}
.ddp-kind{position:relative;flex:none}
.ddp-kind>.ddp-btn.sel{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.ddp-menu{position:absolute;right:0;top:33px;min-width:196px;padding:5px;border-radius:11px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 12px 32px rgba(0,0,0,.24),0 0 0 .5px var(--dsw-alias-border-l3);animation:ddp-in .16s ${EASE}}
.ddp-menu .hd{padding:5px 9px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.ddp-menu a{display:flex;align-items:center;gap:9px;height:30px;padding:0 9px;border-radius:7px;color:var(--dsw-alias-label-primary);text-decoration:none}
.ddp-menu a:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-menu a svg{width:15px;height:15px;flex:none;color:var(--dsw-alias-label-secondary)}
.ddp-menu button{display:flex;align-items:center;gap:9px;width:100%;height:30px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left}
.ddp-menu button:disabled{opacity:.4;cursor:default}
.ddp-menu button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-menu button svg{width:15px;height:15px;flex:none;color:var(--dsw-alias-label-secondary)}
.ddp-menu button.sel,.ddp-menu button.sel svg{color:${ACCENT}}
.ddp-menu em{margin-left:auto;font-style:normal;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.ddp-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.ddp-stage.full{background:#fff}
.ddp-scr{position:absolute;inset:0;overflow:hidden}
.ddp-away{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px;line-height:1.6;color:var(--dsw-alias-text-secondary,#888);background:var(--dsw-alias-bg-layer-1)}
.ddp-frame{position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#fff;opacity:0;z-index:0;pointer-events:none}
.ddp-frame.old{opacity:1;z-index:1}
.ddp-frame.cur{opacity:1;z-index:2;pointer-events:auto;transition:opacity .32s ease}
.ddp-dev{position:relative;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.14),0 18px 48px rgba(0,0,0,.2)}
.ddp-dev.fill{position:absolute;inset:0;box-shadow:none;border-radius:0}
.ddp-dev.k-app,.ddp-dev.k-tablet{background:#0e0e12;box-shadow:inset 0 0 0 1.5px #2b2b33,0 0 0 1px rgba(0,0,0,.45),0 24px 60px rgba(0,0,0,.3)}
.ddp-dev.fill.k-app,.ddp-dev.fill.k-tablet{background:#fff;box-shadow:none}
.ddp-vp{position:absolute;overflow:hidden;background:#fff;isolation:isolate}
.ddp-vp:has(.ddp-scr.dk),.ddp-scr.dk .ddp-frame{background:#111}
.ddp-chrome{position:absolute;left:0;right:0;top:0;align-items:center;gap:7px;padding:0 13px;background:#ebebef;border-bottom:1px solid rgba(0,0,0,.07);border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0;overflow:hidden}
.ddp-chrome i{width:11px;height:11px;border-radius:50%;background:#ff5f57;flex:none}
.ddp-chrome i:nth-child(2){background:#febc2e}
.ddp-chrome i:nth-child(3){background:#28c840}
.ddp-chrome span{flex:1;min-width:0;margin:0 60px 0 18px;height:20px;border-radius:6px;background:rgba(0,0,0,.05);color:#6b6b74;font:12px/20px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-island{position:absolute;left:50%;width:118px;height:34px;margin-left:-59px;border-radius:20px;background:#000;z-index:4;pointer-events:none}
.ddp-body{position:absolute;inset:0}
.ddp-body.vb{top:46px}
.ddp-single{position:absolute;inset:0;overflow:hidden}
.ddp-fit{position:absolute;left:50%;top:50%;transform-origin:center center}
.ddp-fit.fill{left:0;top:0;width:100%;height:100%;transform:none}
.ddp-canvas{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
  background-color:var(--dsw-alias-bg-layer-2);background-image:radial-gradient(circle,rgba(127,127,127,.3) 1px,transparent 1.4px)}
.ddp-canvas.drag{cursor:grabbing}
.ddp-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.ddp-world.anim{transition:transform .45s ${EASE}}
.ddp-cell{position:absolute;transition:left .45s ${EASE},top .45s ${EASE};animation:ddp-cell .5s ${EASE}}
@keyframes ddp-cell{from{opacity:0;scale:.94}}
.ddp-cell.sel>.ddp-dev{outline:calc(2px / var(--z)) solid ${ACCENT};outline-offset:calc(5px / var(--z))}
.ddp-shield{position:absolute;inset:0;z-index:6;cursor:default}
.ddp-lab{position:absolute;left:0;bottom:100%;height:28px;display:flex;align-items:center;gap:6px;padding-bottom:6px;transform-origin:0 100%;
  color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;cursor:default}
.ddp-lab span{overflow:hidden;text-overflow:ellipsis}
.ddp-cell.sel .ddp-lab{color:${ACCENT};font-weight:500}
.ddp-lab .sp{width:10px;height:10px;flex:none;border-radius:50%;border:1.5px solid rgba(77,107,254,.25);border-top-color:${ACCENT};animation:ddp-rot .75s linear infinite}
.ddp-cell.ghost>.ddp-dev{animation:ddp-ghost 1.6s ease-in-out infinite}
.ddp-cell.ghost .ddp-vp::after{content:"";position:absolute;inset:0;z-index:3;border:calc(2px / var(--z)) dashed rgba(77,107,254,.55);border-radius:inherit}
.ddp-cell.ghost .ddp-lab{color:${ACCENT}}
@keyframes ddp-ghost{50%{opacity:.62}}
.ddp-zoom{position:absolute;right:12px;bottom:12px;z-index:6;display:flex;align-items:center;gap:1px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 4px 14px rgba(0,0,0,.14),0 0 0 .5px var(--dsw-alias-border-l3)}
.ddp-zoom .ddp-btn{height:24px;min-width:24px;padding:0 4px}
.ddp-zoom .ddp-btn svg{width:14px;height:14px}
.ddp-zoom b{min-width:36px;text-align:center;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:11px}
.ddp-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:7;max-width:calc(100% - 24px);padding:6px 13px;border-radius:999px;
  background:rgba(18,18,24,.84);color:#ececf0;font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  box-shadow:0 6px 18px rgba(0,0,0,.22);backdrop-filter:blur(8px);pointer-events:none;animation:ddp-in .2s ease}
.ddp-hint.side{left:calc((100% - 296px) / 2);max-width:calc(100% - 320px)}
@property --ddp-a{syntax:'<angle>';initial-value:0deg;inherits:false}
.ddp-ring{position:absolute;inset:0;z-index:4;pointer-events:none;padding:2.5px;
  background:conic-gradient(from var(--ddp-a),transparent 0deg 140deg,${ACCENT} 240deg,#a78bfa 300deg,#5eead4 340deg,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  animation:ddp-spin 2.8s linear infinite,ddp-fade .4s ease}
.ddp-glow{position:absolute;inset:0;z-index:4;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(77,107,254,.32),inset 0 0 48px rgba(77,107,254,.22);animation:ddp-breathe 2.6s ease-in-out infinite,ddp-fade .4s ease}
@keyframes ddp-spin{to{--ddp-a:360deg}}
@keyframes ddp-breathe{50%{opacity:.45}}
@keyframes ddp-fade{from{opacity:0}}
.ddp-chip{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:8px;max-width:calc(100% - 24px);padding:6px 13px 6px 10px;border-radius:999px;
  background:rgba(18,18,24,.8);color:#f1f1f4;font-size:12px;line-height:16px;backdrop-filter:blur(10px) saturate(1.4);
  box-shadow:0 8px 24px rgba(0,0,0,.2),inset 0 0 0 .5px rgba(255,255,255,.14);pointer-events:none;animation:ddp-in .28s ${EASE}}
.ddp-chip.left{left:12px;transform:none;max-width:calc(100% - 150px)}
.ddp-chip>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-chip .sp{width:12px;height:12px;flex:none;border-radius:50%;border:1.6px solid rgba(255,255,255,.22);border-top-color:#9db0ff;animation:ddp-rot .75s linear infinite}
.ddp-chip .tx{background:linear-gradient(90deg,#f1f1f4 0 38%,#a9b8ff 50%,#f1f1f4 62% 100%);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ddp-txt 2.2s linear infinite}
.ddp-chip.ok svg{width:14px;height:14px;flex:none;color:#4ade80}
.ddp-chip .q{width:8px;height:8px;flex:none;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.25)}
@keyframes ddp-rot{to{transform:rotate(360deg)}}
@keyframes ddp-txt{from{background-position:100% 0}to{background-position:-160% 0}}
@keyframes ddp-blink{50%{opacity:.25}}
@keyframes ddp-in{from{opacity:0;translate:0 6px;scale:.98}}
.ddp-skel{position:absolute;inset:0;z-index:2;padding:28px 24px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-bg-layer-1);transition:opacity .3s ease;pointer-events:none}
.ddp-skel.gone{opacity:0}
.ddp-skel b{display:block;border-radius:8px;background:var(--dsw-alias-bg-layer-2);position:relative;overflow:hidden}
.ddp-skel b::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(127,127,127,.14),transparent);animation:ddp-shine 1.3s ease-in-out infinite}
@keyframes ddp-shine{100%{transform:translateX(100%)}}
.ddp-wait{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px}
.ddp-wait .card{position:relative;width:min(78%,440px);aspect-ratio:16/11;border-radius:12px;overflow:hidden;box-shadow:0 0 0 .5px var(--dsw-alias-border-l3),0 14px 40px rgba(0,0,0,.14);animation:ddp-ghost 1.6s ease-in-out infinite}
.ddp-wait p{margin:0;color:var(--dsw-alias-label-tertiary);text-align:center;line-height:1.6}
.ddp-toast{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:7;padding:7px 14px;border-radius:999px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font-size:12px;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.2);animation:ddp-in .2s ease}
.ddp-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.ddp-empty b{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500}
.ddp-empty p{margin:6px 0 0;max-width:300px;line-height:1.6}
.ddp-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;text-align:left;counter-reset:s}
.ddp-steps li{display:flex;align-items:center;gap:9px;color:var(--dsw-alias-label-secondary);line-height:18px}
.ddp-steps li::before{counter-increment:s;content:counter(s);flex:none;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600;color:${ACCENT};background:rgba(77,107,254,.12)}
.ddp-art{width:176px;height:120px;overflow:visible;margin-bottom:2px}
.ddp-art .pg{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l3);stroke-width:1}
.ddp-art .ln{stroke:var(--dsw-alias-border-l3);stroke-width:1}
.ddp-art .dt{fill:var(--dsw-alias-border-l3)}
.ddp-art .sk{fill:var(--dsw-alias-bg-layer-2)}
.ddp-art .bt{fill:${ACCENT};opacity:.9}
.ddp-art .sel{fill:rgba(77,107,254,.08);stroke:${ACCENT};stroke-width:1.3;stroke-dasharray:4 3;animation:ddp-ants .9s linear infinite,ddp-sel 3.6s ease-in-out infinite}
.ddp-art .cur{fill:var(--dsw-alias-label-primary);stroke:var(--dsw-alias-bg-layer-1);stroke-width:1;animation:ddp-cur 3.6s ease-in-out infinite}
@keyframes ddp-ants{to{stroke-dashoffset:-14}}
@keyframes ddp-sel{0%,30%{opacity:0}42%,88%{opacity:1}100%{opacity:0}}
@keyframes ddp-cur{0%,100%{transform:translate(132px,98px)}36%,90%{transform:translate(58px,76px)}}
.ddp-empty form{display:flex;gap:6px;width:100%;max-width:320px;margin-top:4px}
.ddp-go{height:26px;padding:0 12px;border:0;border-radius:999px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font:inherit;cursor:pointer}
.ddp-err{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:11.5px}
.ddp-head{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative}
.ddp-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.ddp-head svg{width:16px;height:16px}
.ddp-head.hint::after{content:"";position:absolute;right:5px;top:5px;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-accent-primary,#4f6ef7)}
.ddp-head.live::after{content:"";position:absolute;right:5px;top:5px;width:5px;height:5px;border-radius:50%;background:#22c55e}
.ddp-tokens{position:absolute;top:10px;right:10px;bottom:10px;width:min(276px,calc(100% - 20px));z-index:7;display:flex;flex-direction:column;border-radius:12px;
  background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 36px rgba(0,0,0,.22),0 0 0 .5px var(--dsw-alias-border-l3);overflow:hidden;animation:ddp-in .2s ${EASE}}
.ddp-tokens header{display:flex;align-items:center;gap:8px;padding:10px 8px 2px 14px;font-size:13px;font-weight:500}
.ddp-tokens header b{flex:1;font-weight:500}
.ddp-tokens header>svg{width:15px;height:15px;flex:none;color:var(--dsw-alias-label-secondary)}
.ddp-tokens header .ddp-btn{height:24px;min-width:24px}
.ddp-tokens .tip{margin:0;padding:0 14px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.ddp-tokens .bd{flex:1;min-height:0;overflow:auto;padding:0 8px 10px}
.ddp-tokens h4{margin:10px 6px 4px;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.ddp-phone{bottom:auto;max-height:calc(100% - 20px)}
.ddp-phone .bd{display:flex;flex-direction:column;align-items:center;text-align:center;padding:4px 16px 14px;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ddp-phone .bd>*{flex:none}
.ddp-phone .qr{width:176px;height:176px;margin:6px 0 4px;padding:0;border-radius:12px;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.12)}
.ddp-phone .qr svg{display:block;width:100%;height:100%}
.ddp-phone b.how{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ddp-phone p{margin:0}
.ddp-phone .st{display:inline-flex;align-items:center;gap:6px;margin:4px 0;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ddp-phone .st.ok{background:rgba(52,199,89,.14);color:#2f9e55}
.ddp-phone .st svg{width:13px;height:13px}
.ddp-phone .st i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.55;animation:ddp-pulse 1.2s ease-in-out infinite}
.ddp-phone .fine{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.ddp-phone .row{display:flex;gap:6px;margin-top:6px}
.ddp-phone .row .ddp-go{height:28px;padding:0 12px;font-size:12px}
@keyframes ddp-pulse{50%{opacity:1}}
.ddp-tokens .none{padding:6px 6px 0;color:var(--dsw-alias-label-secondary);line-height:1.6}
.ddp-tokens .none .ddp-go{margin-top:10px}
.ddp-tokens footer{padding:8px 10px 10px;border-top:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.16))}
.ddp-tokens footer button{display:flex;align-items:center;gap:7px;width:100%;height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;text-align:left}
.ddp-tokens footer button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.ddp-tokens footer svg{width:15px;height:15px;flex:none}
.ddp{position:relative;outline:none}
.ddp-drop{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:ddp-in .15s ease}
.ddp-drop *{pointer-events:none}
.ddp-drop .in{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;max-width:340px;padding:28px 20px;border:1.5px dashed ${ACCENT};border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 30px rgba(0,0,0,.18);text-align:center;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.ddp-drop .in svg{width:28px;height:28px;color:${ACCENT};margin-bottom:4px}
.ddp-drop .in b{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500}
.ddp-empty .ddp-refline{margin-top:0}
.ddp-empty .lk{border:0;padding:0;background:transparent;color:${ACCENT};font:inherit;cursor:pointer}
.ddp-empty .lk:hover{text-decoration:underline;text-underline-offset:2px}
.ddp-ck{align-items:flex-start}
.ddp-ck .no{width:18px;height:18px;flex:none;margin-top:1px;border-radius:9px;background:#f59e0b;color:#fff;font:700 10px/18px system-ui,sans-serif;text-align:center}
.ddp-ck .no.hi{background:#e5484d}
.ddp-tok.ddp-ck .nm{font-family:inherit;font-size:12px;line-height:17px}
.ddp-tok.ddp-ck .vl{white-space:normal;overflow-wrap:anywhere}
.ddp-check .ok{display:flex;align-items:center;gap:8px;padding:14px 6px;color:var(--dsw-alias-label-secondary)}
.ddp-check .ok svg{width:16px;height:16px;flex:none;color:#30a46c}
.ddp-check footer.row,.ddp-style footer.row{display:flex;gap:6px}
.ddp-check footer.row button,.ddp-style footer.row button{flex:1;justify-content:center;padding:0 6px}
.ddp-check footer .go,.ddp-style footer .go{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.ddp-check footer .go:hover,.ddp-style footer .go:hover{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);opacity:.88}
.ddp-check footer button:disabled,.ddp-style footer button:disabled{opacity:.45;cursor:default}
.ddp-style .bd{padding:0 14px 10px}
.ddp-style .who{margin:0;padding:0 14px 6px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-style .who code{font:11px/17px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}
.ddp-style .row{padding:9px 0 10px;border-top:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.16))}
.ddp-style label{display:flex;align-items:baseline;gap:8px;margin-bottom:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ddp-style label span{flex:1}
.ddp-style label em{font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:var(--dsw-alias-label-tertiary);max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-style label em.v{color:${ACCENT}}
.ddp-style input[type=range]{display:block;width:100%;margin:0;accent-color:${ACCENT};cursor:pointer}
.ddp-style .chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:7px}
.ddp-style .row>.chips:first-of-type{margin-top:0}
.ddp-style .chip{height:22px;max-width:100%;padding:0 7px;border:0;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary);font:11px/22px inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-style .chip:hover{color:var(--dsw-alias-label-primary)}
.ddp-style .chip.on{box-shadow:inset 0 0 0 1.5px ${ACCENT};color:var(--dsw-alias-label-primary)}
.ddp-style .chip.c{width:22px;padding:2px}
.ddp-style .chip.c i{display:block;width:100%;height:100%;border-radius:4px;box-shadow:inset 0 0 0 .5px rgba(127,127,127,.45)}
.ddp-style input[type=color]{width:30px;height:22px;padding:0;border:0;border-radius:6px;background:none;cursor:pointer}
.ddp-style .seg{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.ddp-style .seg button{flex:1;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/24px inherit;cursor:pointer}
.ddp-style .seg button.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.14)}
.ddp-style .note{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ddp-style .cnt{padding:0 14px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ddp-styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px 8px}
.ddp-sc{display:flex;flex-direction:column;gap:5px;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
.ddp-sc .pv{position:relative;display:block;height:58px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 .5px rgba(127,127,127,.35);transition:transform .15s ${EASE},box-shadow .15s}
.ddp-sc:hover .pv{transform:translateY(-1px);box-shadow:0 0 0 1.5px ${ACCENT},0 6px 16px rgba(0,0,0,.12)}
.ddp-sc:hover{color:var(--dsw-alias-label-primary)}
.ddp-sc .pv b{position:absolute;left:8px;top:6px;font-size:17px;line-height:1}
.ddp-sc .pv .bt{position:absolute;right:8px;top:8px;width:20px;height:9px}
.ddp-sc .pv .cd{position:absolute;left:8px;right:8px;bottom:7px;height:20px}
.ddp-sc .pv .ln{position:absolute;left:6px;top:6px;width:46%;height:3px;border-radius:2px;opacity:.85}
.ddp-sc .pv .ln.s{top:12px;width:30%;opacity:.6}
.ddp-sc .nm{font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-stylepick{width:100%;max-width:440px;margin:4px 0 6px;text-align:left}
.ddp-stylepick>b{display:block;margin-bottom:2px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ddp-stylepick>p{margin:0 0 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ddp-tok{display:flex;align-items:center;gap:9px;width:100%;min-height:32px;padding:4px 6px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.ddp-tok:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-tok .pv{width:24px;height:24px;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ddp-tok .sw{width:24px;height:24px;border-radius:7px;box-shadow:inset 0 0 0 .5px rgba(127,127,127,.35)}
.ddp-tok .rd{width:20px;height:20px;border:1.5px solid var(--dsw-alias-label-secondary);border-right:0;border-bottom:0}
.ddp-tok .bar{height:8px;border-radius:2px;background:${ACCENT};opacity:.75}
.ddp-tok .pv.lt{border-radius:7px;background:#ececef}
.ddp-tok .sh{width:14px;height:11px;border-radius:3px;background:#fff}
.ddp-tok .tx{flex:1;min-width:0;display:flex;flex-direction:column}
.ddp-tok .nm,.ddp-tok .vl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-tok .nm{font:11px/16px ui-monospace,Menlo,monospace}
.ddp-tok .vl{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.ddp-btn.has::after{content:"";position:absolute;right:4px;top:4px;width:5px;height:5px;border-radius:50%;background:${ACCENT}}
.ddp-btn{position:relative}
.ddp-btn .bdg{position:absolute;top:0;right:0;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:#f59e0b;color:#fff;font:700 9px/14px system-ui,sans-serif;text-align:center;pointer-events:none}
.ddp-menu .ft{margin:4px 4px 2px;padding:6px 6px 2px;border-top:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;max-width:220px;white-space:normal}
.ddp-ver{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;padding:8px 10px;margin-bottom:2px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.ddp-ver:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-ver.sel{background:rgba(77,107,254,.12);box-shadow:inset 0 0 0 1px rgba(77,107,254,.35)}
.ddp-ver b{display:flex;align-items:center;gap:6px;font-weight:500;font-size:12.5px}
.ddp-ver b em{margin-left:auto;font-style:normal;font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.ddp-ver b .live{width:7px;height:7px;border-radius:50%;background:#2fbf71;box-shadow:0 0 0 3px rgba(47,191,113,.16)}
.ddp-ver span{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-ver small{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-flows{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:20}
.ddp-flows path{fill:none;stroke:${ACCENT};stroke-linecap:round;transition:opacity .2s}
.ddp-flows .hd{fill:${ACCENT};stroke:none}
.ddp-flows circle{fill:${ACCENT};stroke:#fff}
.ddp-flows g.dim{opacity:.45}
.ddp-demo{position:absolute;inset:0;overflow:hidden}
.ddp-demo .lay{position:absolute;inset:0;transition:transform .42s ${EASE},opacity .42s ${EASE}}
.ddp-demo .lay.wait{opacity:0;pointer-events:none}
.ddp-demo .lay.wait.f{transform:translateX(18%)}
.ddp-demo .lay.wait.b{transform:translateX(-18%)}
.ddp-demo .lay.out{opacity:0;pointer-events:none}
.ddp-demo .lay.out.f{transform:translateX(-12%)}
.ddp-demo .lay.out.b{transform:translateX(12%)}
.ddp-banner{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:6px;max-width:calc(100% - 20px);padding:4px 4px 4px 12px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.18),0 0 0 .5px var(--dsw-alias-border-l3);font-size:12px;white-space:nowrap;animation:ddp-in .2s ${EASE}}
.ddp-banner>svg{width:14px;height:14px;flex:none;color:${ACCENT}}
.ddp-banner>span{overflow:hidden;text-overflow:ellipsis;min-width:0;margin-right:2px}
.ddp-banner .ddp-go{height:24px;padding:0 10px;font-size:12px;flex:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ddp-banner .ddp-go.on{background:${ACCENT};color:#fff}
.ddp-banner .ddp-go.pri{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.ddp-banner .ddp-btn{height:24px;min-width:24px;border-radius:999px}
.ddp-toast{display:flex;align-items:center;gap:10px}
.ddp-toast.low{top:56px}
.ddp-toast button{border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.ddp-cmp{position:absolute;inset:0;overflow:hidden}
.ddp-cmp>.ly{position:absolute;inset:0}
.ddp-cmp>.ly.r{left:auto;overflow:hidden}
.ddp-cmp>.ly.r>div{position:absolute;top:0;bottom:0}
.ddp-cmp.drag iframe{pointer-events:none}
.ddp-cmp .miss{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:#f4f4f6;color:#8a8a93;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}
.ddp-knob{position:absolute;top:0;bottom:0;width:32px;margin-left:-16px;z-index:5;cursor:ew-resize;touch-action:none}
.ddp-knob::before{content:"";position:absolute;left:15px;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.25),0 0 12px rgba(0,0,0,.25)}
.ddp-knob i{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.ddp-knob i::before,.ddp-knob i::after{content:"";position:absolute;top:10px;border:5px solid transparent}
.ddp-knob i::before{left:2px;border-right-color:#555}
.ddp-knob i::after{right:2px;border-left-color:#555}
.ddp-cmp .tag{position:absolute;top:10px;z-index:4;padding:3px 9px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:500 11px/16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none}
.ddp-cmp .tag.l{left:10px}
.ddp-cmp .tag.r{right:10px;background:${ACCENT}}
.ddp-act{margin-left:auto;display:flex;gap:1px;flex:none}
.ddp-act .ddp-btn{height:22px;min-width:22px;padding:0 4px;color:${ACCENT}}
.ddp-act .ddp-btn svg{width:13px;height:13px}
@container (max-width:500px){.ddp-btn.pick span,.ddp-kind>.ddp-btn span{display:none}}
.ddp-tw .row:first-child{border-top:0}
.ddp-sys .bd{display:flex;flex-direction:column;gap:8px;padding:2px 10px 10px}
.ddp-sysc{display:flex;flex-direction:column;gap:5px;padding:8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
.ddp-sysc.def{box-shadow:inset 0 0 0 1.5px ${ACCENT}}
.ddp-sysc img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.ddp-sysc .nm{display:flex;align-items:center;gap:6px;font-size:13px}
.ddp-sysc .nm b{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-sysc .nm span{flex:none;height:18px;padding:0 6px;border-radius:9px;background:${ACCENT};color:#fff;font-size:11px;line-height:18px}
.ddp-sysc .sw{display:flex;align-items:center;gap:3px;min-width:0}
.ddp-sysc .sw i{width:14px;height:14px;flex:none;border-radius:4px;box-shadow:inset 0 0 0 .5px rgba(127,127,127,.45)}
.ddp-sysc .sw em{margin-left:4px;font-size:11px;font-style:normal;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-sysc small{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-sysc .acts{display:flex;gap:4px}
.ddp-sysc .acts button{flex:1;height:26px;padding:0 6px;border:0;border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:12px/26px inherit;cursor:pointer;white-space:nowrap}
.ddp-sysc .acts button:hover{color:var(--dsw-alias-label-primary)}
.ddp-sys form{display:flex;gap:6px}
.ddp-sys form input,.ddp-ho input[type=text]{flex:1;min-width:0;height:28px;padding:0 9px;border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12px inherit;outline:none}
.ddp-sys form input:focus,.ddp-ho input[type=text]:focus{border-color:${ACCENT}}
.ddp-tokens.ddp-sys footer form button{width:auto;height:28px;flex:none;justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 12px}
.ddp-tokens.ddp-sys footer form button:disabled{opacity:.45;cursor:default}
.ddp-ho .bd{padding:0 14px 10px}
.ddp-ho .row{padding:9px 0 10px;border-top:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.16))}
.ddp-ho .row:first-child{border-top:0}
.ddp-ho label{display:block;margin-bottom:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ddp-ho input[type=text]{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.ddp-ho .opt{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/18px inherit;text-align:left;cursor:pointer}
.ddp-ho .opt:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-ho .opt i{width:12px;height:12px;flex:none;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--dsw-alias-label-tertiary)}
.ddp-ho .opt.on{color:var(--dsw-alias-label-primary)}
.ddp-ho .opt.on i{box-shadow:inset 0 0 0 4px ${ACCENT}}
.ddp-ho footer .go{justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.ddp-ho footer .go:hover{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);opacity:.88}
.ddp-ho footer .go:disabled{opacity:.45;cursor:default}
.ddp-more{display:none}
.ddp-menu .o1,.ddp-menu .o2{display:none}
@container (max-width:700px){.ddp-bar>.o1{display:none}.ddp-bar>.ddp-more{display:block}.ddp-menu .o1{display:flex}}
@container (max-width:580px){.ddp-bar>.o2{display:none}.ddp-menu .o2{display:flex}}
`
    function ensureStyle() {
      if (typeof document === 'undefined' || document.getElementById('dsh-design-studio-style')) return
      const el = document.createElement('style')
      el.id = 'dsh-design-studio-style'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    // ── 图标 ─────────────────────────────────────────────────────────────────

    const svg = (d, extra) => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra }, ...d)
    const I = {
      pick: () => svg([h('path', { key: 1, d: 'M4 4l6.5 16 2.3-6.7L19.5 11z' }), h('path', { key: 2, d: 'M13 13l6 6' })]),
      canvas: () => svg([h('rect', { key: 1, x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.6 }), h('rect', { key: 2, x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.6 }),
        h('rect', { key: 3, x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.6 }), h('rect', { key: 4, x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.6 })]),
      single: () => svg([h('rect', { key: 1, x: 5, y: 3.5, width: 14, height: 17, rx: 2.2 })]),
      web: () => svg([h('rect', { key: 1, x: 3, y: 4.5, width: 18, height: 15, rx: 2.2 }), h('path', { key: 2, d: 'M3 9h18' }), h('path', { key: 3, d: 'M6 6.8h.01M8.5 6.8h.01' })]),
      app: () => svg([h('rect', { key: 1, x: 7, y: 2.5, width: 10, height: 19, rx: 2.4 }), h('path', { key: 2, d: 'M10.5 5h3' })]),
      tablet: () => svg([h('rect', { key: 1, x: 4.5, y: 3, width: 15, height: 18, rx: 2.2 }), h('path', { key: 2, d: 'M11 18h2' })]),
      poster: () => svg([h('rect', { key: 1, x: 5, y: 3, width: 14, height: 18, rx: 1.8 }), h('path', { key: 2, d: 'M5 16l4-4 3 3 2-2 5 5' }), h('circle', { key: 3, cx: 14.5, cy: 8, r: 1.6 })]),
      slides: () => svg([h('rect', { key: 1, x: 2.5, y: 4, width: 19, height: 12, rx: 1.8 }), h('path', { key: 2, d: 'M12 16v3M8.5 20.5h7' }), h('path', { key: 3, d: 'M6.5 8h6M6.5 11h4' })]),
      email: () => svg([h('rect', { key: 1, x: 3, y: 5, width: 18, height: 14, rx: 2.2 }), h('path', { key: 2, d: 'M3.5 6.5l8.5 6.5 8.5-6.5' })]),
      caret: () => svg([h('path', { key: 1, d: 'M6 9.5l6 6 6-6', strokeWidth: 2.4 })], { className: 'cr' }),
      palette: () => svg([h('path', { key: 1, d: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.6 0-.9-.8-1.3-.8-2.1 0-.9.8-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3z' }),
        h('circle', { key: 2, cx: 7.6, cy: 11.2, r: 1.25, fill: 'currentColor', stroke: 'none' }), h('circle', { key: 3, cx: 10.2, cy: 7.4, r: 1.25, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 4, cx: 14.8, cy: 7.6, r: 1.25, fill: 'currentColor', stroke: 'none' })]),
      close: () => svg([h('path', { key: 1, d: 'M6 6l12 12M18 6L6 18' })]),
      download: () => svg([h('path', { key: 1, d: 'M12 4v11' }), h('path', { key: 2, d: 'M7.5 10.5L12 15l4.5-4.5' }), h('path', { key: 3, d: 'M5 19.5h14' })]),
      image: () => svg([h('rect', { key: 1, x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.2 }), h('circle', { key: 2, cx: 9, cy: 10, r: 1.7 }), h('path', { key: 3, d: 'M20 16l-4.5-4.5L7 19.5' })]),
      long: () => svg([h('rect', { key: 1, x: 6.5, y: 2.5, width: 11, height: 19, rx: 2 }), h('path', { key: 2, d: 'M9.5 7h5M9.5 10.5h5M9.5 14h3' })]),
      history: () => svg([h('path', { key: 1, d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1' }), h('path', { key: 2, d: 'M3.5 4.5v4h4' }), h('path', { key: 3, d: 'M12 7.5V12l3 2' })]),
      scan: () => svg([h('path', { key: 1, d: 'M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5' }),
        h('rect', { key: 2, x: 9, y: 7.5, width: 6, height: 9, rx: 1.3 })]),
      sizes: () => svg([h('rect', { key: 1, x: 2.5, y: 5, width: 12, height: 9.5, rx: 1.4 }), h('path', { key: 2, d: 'M6.5 18h4' }),
        h('rect', { key: 3, x: 16.5, y: 8, width: 5, height: 10.5, rx: 1.2 })]),
      text: () => svg([h('path', { key: 1, d: 'M5 7V5h11v2M10.5 5v14M8 19h5' }), h('path', { key: 2, d: 'M17 12v8M15.5 12h3M15.5 20h3' })]),
      sliders: () => svg([h('path', { key: 1, d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }), h('circle', { key: 2, cx: 15, cy: 7, r: 2 }), h('circle', { key: 3, cx: 9, cy: 17, r: 2 })]),
      image: () => svg([h('rect', { key: 1, x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }), h('circle', { key: 2, cx: 9, cy: 10, r: 1.6 }), h('path', { key: 3, d: 'M4 17l5-4.5 4 3.5 3-2.5 4.5 4', strokeLinejoin: 'round' })]),
      more: () => svg([h('circle', { key: 1, cx: 5.5, cy: 12, r: 1.3 }), h('circle', { key: 2, cx: 12, cy: 12, r: 1.3 }), h('circle', { key: 3, cx: 18.5, cy: 12, r: 1.3 })]),
      play: () => svg([h('path', { key: 1, d: 'M8 5.5v13l10.5-6.5z', strokeLinejoin: 'round' })]),
      back: () => svg([h('path', { key: 1, d: 'M14.5 6l-6 6 6 6', strokeWidth: 2.2 })]),
      moon: () => svg([h('path', { key: 1, d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' })]),
      sparkle: () => svg([h('path', { key: 1, d: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z' }), h('path', { key: 2, d: 'M18.5 16v4M16.5 18h4' })]),
      plus: () => svg([h('path', { key: 1, d: 'M12 5v14M5 12h14' })]),
      minus: () => svg([h('path', { key: 1, d: 'M5 12h14' })]),
      fit: () => svg([h('path', { key: 1, d: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15' })]),
      refresh: () => svg([h('path', { key: 1, d: 'M20 11a8 8 0 1 0-2.3 5.7' }), h('path', { key: 2, d: 'M20 5v6h-6' })]),
      external: () => svg([h('path', { key: 1, d: 'M14 4h6v6' }), h('path', { key: 2, d: 'M20 4l-9 9' }), h('path', { key: 3, d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' })]),
      check: () => svg([h('path', { key: 1, d: 'M5 12.5l4.5 4.5L19 7.5', strokeWidth: 2.4 })]),
      stetho: () => svg([h('path', { key: 1, d: 'M6 3.5H5a1 1 0 0 0-1 1V9a5 5 0 0 0 10 0V4.5a1 1 0 0 0-1-1h-1' }), h('path', { key: 2, d: 'M9 14v1.5a4.5 4.5 0 0 0 9 0V13' }), h('circle', { key: 3, cx: 18, cy: 11, r: 2 })]),
      pdf: () => svg([h('path', { key: 1, d: 'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z' }), h('path', { key: 2, d: 'M14 3.5v5h5' }), h('path', { key: 3, d: 'M8.5 13h7M8.5 16.5h4.5' })]),
      deck: () => svg([h('rect', { key: 1, x: 3, y: 4, width: 18, height: 12.5, rx: 1.8 }), h('path', { key: 2, d: 'M12 16.5V20M8.5 20.5h7' }), h('path', { key: 3, d: 'M7 12.5l3-3 2.5 2 4-4' })]),
      dial: () => svg([h('circle', { key: 1, cx: 12, cy: 13.5, r: 6.5 }), h('path', { key: 2, d: 'M12 13.5l3.2-3.2' }), h('path', { key: 3, d: 'M12 3.5v2M4.6 7.6l1.4 1.1M19.4 7.6L18 8.7' })]),
      code: () => svg([h('path', { key: 1, d: 'M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5' }), h('path', { key: 2, d: 'M13.5 5l-3 14' })]),
      library: () => svg([h('rect', { key: 1, x: 3.5, y: 4, width: 5, height: 16, rx: 1.2 }), h('rect', { key: 2, x: 10, y: 4, width: 5, height: 16, rx: 1.2 }), h('path', { key: 3, d: 'M16.6 5.4l3.7 13.9' })]),
      page: (p) => svg([h('rect', { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 2.5 }), h('path', { key: 2, d: 'M3 9h18' }), h('rect', { key: 3, x: 7, y: 12.5, width: 5, height: 4, rx: 1, strokeDasharray: '2 1.6' })], p),
    }
    // 引导页上的大图标
    function GuideIcon(props) {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', width: 26, height: 26, ...props },
        h('rect', { x: 2.5, y: 3.5, width: 19, height: 15, rx: 2.5 }),
        h('path', { d: 'M2.5 8h19' }),
        h('rect', { x: 6, y: 11, width: 5, height: 4, rx: 1, strokeDasharray: '2 1.5' }),
        h('path', { d: 'M13.5 12.5l3.6 8.7 1.2-3.6 3.6-1.3z', fill: 'currentColor', stroke: 'none' }))
    }

    // ── 服务端状态（每个会话一个轮询，几个组件共用）──────────────────────────

    const pollers = new Map()
    function poller(sid) {
      let p = pollers.get(sid)
      if (p) return p
      p = { state: null, subs: new Set(), timer: null, refs: 0, inflight: false }
      const tick = async () => {
        p.timer = null
        if (!p.inflight) {
          p.inflight = true
          try {
            const r = await fetch(`${API}state?session=${encodeURIComponent(sid)}`, { credentials: 'same-origin', cache: 'no-store' })
            if (r.ok) p.set(await r.json())
          } catch { /* 下一轮再试 */ }
          p.inflight = false
        }
        if (p.refs > 0) p.timer = setTimeout(tick, p.state && p.state.turn ? 700 : 1500)
      }
      p.set = (s) => {
        if (JSON.stringify(s) === JSON.stringify(p.state)) return
        p.state = s
        for (const f of p.subs) f(s)
      }
      p.start = () => { if (!p.timer && !p.inflight) tick() }
      p.stop = () => { clearTimeout(p.timer); p.timer = null }
      pollers.set(sid, p)
      return p
    }
    function usePreview(sid) {
      const p = sid ? poller(sid) : null
      const [s, setS] = useState(p ? p.state : null)
      useEffect(() => {
        if (!p) return undefined
        p.subs.add(setS)
        p.refs++
        p.start()
        setS(p.state)
        return () => {
          p.subs.delete(setS)
          if (--p.refs <= 0) p.stop()
        }
      }, [sid])
      return [s, p]
    }

    async function post(path, body) {
      const r = await fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    }

    // ── 选中内容 → 输入框里的一段字 ──────────────────────────────────────────

    /** 页面地址 → 用户认得的位置：本地文件给路径，开发服务器给 localhost 地址 */
    /**
     * 这一屏里现在显示的是哪页（在预览里点链接跳过页，就是跳到的那页）→ { key, url }。
     * 同一个预览服务器上的 .html 才算、旧版本不算；不然还是这一屏。写回文件按它找文件，别写到原来那页去。
     */
    function pageOf(sc, href) {
      try {
        const u = new URL(href)
        const p = decodeURIComponent(u.pathname).replace(/^\/+/, '')
        if (u.origin === new URL(sc.url).origin && /\.html?$/i.test(p) && !p.startsWith('__dsh_design__/')) return { key: p, url: u.origin + u.pathname }
      } catch { /* 地址不对 */ }
      return { key: sc.key, url: sc.url }
    }

    function whereOf(href, st) {
      try {
        const u = new URL(href)
        if (st && st.target && st.target.kind === 'file') {
          const file = st.target.file
          // Windows 的路径是反斜杠：按文件自己用的分隔符拼
          const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
          const sep = file[cut] || '/'
          const dir = file.slice(0, cut)
          const rel = decodeURIComponent(u.pathname)
          const abs = rel === '/' ? file : dir + rel.split('/').join(sep)
          return `文件：${abs}`
        }
        if (st && st.target && st.target.kind === 'proxy') return `页面：http://localhost:${st.target.port}${u.pathname}${u.search}`
      } catch { /* 地址不对就原样 */ }
      return `页面：${href}`
    }

    function sourceLine(src) {
      if (!src) return ''
      const parts = [src.component, src.file].filter(Boolean)
      return parts.length ? `组件：${src.component || ''}${src.file ? `（${src.file}）` : ''}${src.framework ? ` · ${src.framework}` : ''}` : ''
    }

    // 改样式最常问到的几项，按这个顺序最多 6 项
    const STYLE_KEYS = ['color', 'background-color', 'background-image', 'font-size', 'font-weight', 'padding', 'border-radius', 'border', 'display', 'gap']
    function stylesLine(p) {
      const s = p.styles || {}
      const size = p.rect ? `${p.rect.w}×${p.rect.h}` : ''
      const items = STYLE_KEYS.filter((k) => s[k]).slice(0, 6).map((k) => `${k}: ${s[k]}`)
      return '样式：' + [size, ...items].filter(Boolean).join(' · ')
    }

    function formatPick(p, st) {
      const lines = []
      if (p.kind === 'region') {
        lines.push(`〔选中区域〕页面上 (${p.rect.x}, ${p.rect.y}) 起 ${p.rect.w}×${p.rect.h} 的一块`)
        lines.push(whereOf(p.href, st))
        if (p.elements && p.elements.length) {
          lines.push('包含：')
          for (const e of p.elements) {
            const src = e.source && (e.source.component || e.source.file) ? `　[${[e.source.component, e.source.file].filter(Boolean).join(' ')}]` : ''
            const txt = e.text ? (e.text.length > 24 ? e.text.slice(0, 24) + '…' : e.text) : ''
            lines.push(`- ${e.selector}${txt ? `「${txt}」` : ''}${src}`)
          }
        }
      } else {
        const txt = p.text ? (p.text.length > 24 ? p.text.slice(0, 24) + '…' : p.text) : ''
        lines.push(`〔选中元素〕${p.name}${txt ? `「${txt}」` : ''}`)
        lines.push(whereOf(p.href, st))
        lines.push(`位置：${p.selector}`)
        const src = sourceLine(p.source)
        if (src) lines.push(src)
        lines.push(`HTML：${p.html}`)
        lines.push(stylesLine(p))
      }
      return lines.join('\n') + '\n'
    }

    // ── 设计变量 ─────────────────────────────────────────────────────────────

    const TOKEN_GROUPS = ['color', 'font', 'size', 'space', 'radius', 'shadow', 'other']
    const TOKEN_KEY = { color: 'gColor', font: 'gFont', size: 'gSize', space: 'gSpace', radius: 'gRadius', shadow: 'gShadow', other: 'gOther' }
    const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\(.*\))$/i
    const LENGTH_RE = /^-?[\d.]+(px|rem|em)$/

    /** 变量归哪一组：看名字和值 */
    function tokenKind(tok) {
      const n = String(tok.name).toLowerCase()
      const v = String(tok.value).trim()
      if (/shadow|elevation/.test(n)) return 'shadow'
      if (/radius|round|corner/.test(n)) return 'radius'
      if (/font|family|typeface/.test(n) && !/size|weight|leading|line|track/.test(n) && /[a-z]/i.test(v) && !LENGTH_RE.test(v)) return 'font'
      if (LENGTH_RE.test(v)) return /text|font|size|fs|title|heading|body|caption|display/.test(n) && !/space|gap|pad|margin|gutter/.test(n) ? 'size' : 'space'
      let color = COLOR_RE.test(v)
      if (!color) { try { color = typeof CSS !== 'undefined' && CSS.supports('color', v) && !/^[\d.]+$/.test(v) && !/^(inherit|initial|unset|currentcolor)$/i.test(v) } catch { color = false } }
      return color ? 'color' : 'other'
    }

    /** 点了一个变量 → 输入框里的一段字 */
    function formatToken(tok, st) {
      return `〔设计变量〕${tok.name}: ${tok.value}\n${whereOf(tok.href, st)}\n`
    }

    // ── 风格卡：开局挑一个风格（或给已有的设计换风格），整套配色、字体、圆角、阴影、要点放进输入框 ──────
    // 配色都量过对比度：正文和次要文字对底色 ≥ 4.5:1，主色按钮上的字 ≥ 4.5:1

    const SANS = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    const SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
    const ROUND = '"SF Pro Rounded", "PingFang SC", "HarmonyOS Sans SC", system-ui, sans-serif'
    const STYLES = [
      { id: 'minimal', zh: '极简白', en: 'Minimal', dzh: '大留白、细线、黑白加一点蓝', den: 'Lots of space, hairlines, black and white with a touch of blue',
        c: { bg: '#FAFAF9', surface: '#FFFFFF', text: '#18181B', muted: '#6B6B73', line: '#E4E4E7', primary: '#18181B', accent: '#2563EB', on: '#FFFFFF', link: '#2563EB' },
        head: SANS, w: 600, radius: 10, shadow: '0 1px 2px rgba(24,24,27,.06)',
        nzh: '靠字号和留白分层级，不靠色块；分隔用 1px 细线；蓝色只给链接和选中态；大标题字距收 -0.02em',
        nen: 'Hierarchy from type size and whitespace, not color blocks; 1px hairlines; blue only for links and selection; tighten big headings to -0.02em' },
      { id: 'warm', zh: '温暖手作', en: 'Warm craft', dzh: '纸感底色、圆润、手绘感', den: 'Paper tones, soft and rounded, hand-made feel',
        c: { bg: '#F6EFE6', surface: '#FFF9F2', text: '#2B1D14', muted: '#6E5A4B', line: '#E7D9C8', primary: '#A9542A', accent: '#5E7A4A', on: '#FFFFFF', link: '#52703F' },
        head: SERIF, w: 600, radius: 16, shadow: '0 8px 24px rgba(120,72,30,.12)',
        nzh: '标题用衬线字，正文无衬线；插画用手绘线条和色块；阴影带暖色；中性色都偏暖，不用纯灰',
        nen: 'Serif headings, sans body; hand-drawn line illustrations and color blocks; warm-tinted shadows; warm neutrals, no pure gray' },
      { id: 'editorial', zh: '杂志编辑', en: 'Editorial', dzh: '大标题、黑线栅格、红色点题', den: 'Big headlines, black-rule grid, a red accent',
        c: { bg: '#F4F1EA', surface: '#FFFFFF', text: '#111111', muted: '#555555', line: '#111111', primary: '#C8231B', accent: '#111111', on: '#FFFFFF', link: '#C8231B' },
        head: SERIF, w: 700, radius: 2, shadow: 'none',
        nzh: '标题很大、粗细对比强烈；用粗细两种黑线分栏；版式不对称、有留白；红色只在一两处；几乎没有圆角和阴影',
        nen: 'Very large headlines with strong weight contrast; thick and thin black rules for columns; asymmetric layout; red in one or two places only; almost no radius or shadow' },
      { id: 'dark', zh: '深色高级', en: 'Dark luxe', dzh: '近黑底、香槟金点缀、大图', den: 'Near-black, champagne gold accents, big imagery',
        c: { bg: '#0E0E10', surface: '#18181B', text: '#F2EFE9', muted: '#A19C93', line: '#2C2C30', primary: '#C9A86A', accent: '#E8E2D6', on: '#17140E', link: '#C9A86A' },
        head: SERIF, w: 500, radius: 12, shadow: '0 12px 40px rgba(0,0,0,.45)',
        nzh: '金色只点在关键按钮和细线上；层级靠表面色深浅，不靠阴影；标题细一点、字距放开；留白要多',
        nen: 'Gold only on key buttons and fine lines; layers from surface shades, not shadows; lighter, tracked-out headings; generous space' },
      { id: 'playful', zh: '活泼年轻', en: 'Playful', dzh: '粗描边、硬阴影、贴纸感', den: 'Thick outlines, hard shadows, sticker feel',
        c: { bg: '#FFF7E8', surface: '#FFFFFF', text: '#1D1B3A', muted: '#5D5A82', line: '#1D1B3A', primary: '#FF6A3D', accent: '#1F9E92', on: '#1D1B3A', link: '#137167' },
        head: ROUND, w: 800, radius: 20, shadow: '4px 4px 0 #1D1B3A',
        nzh: '卡片和按钮 2px 深色描边 + 不模糊的硬阴影；主色按钮上用深色字；元素可以略微倾斜、像贴纸；颜色最多三种',
        nen: '2px dark outlines and hard, unblurred shadows on cards and buttons; dark text on the primary button; slightly tilted sticker-like bits; three colors max' },
      { id: 'fresh', zh: '清新自然', en: 'Fresh', dzh: '浅绿底、圆角卡片、轻插画', den: 'Pale green, rounded cards, light illustration',
        c: { bg: '#F3F7F2', surface: '#FFFFFF', text: '#1F2A22', muted: '#56665A', line: '#DCE6DA', primary: '#2F7D4F', accent: '#C9962A', on: '#FFFFFF', link: '#2F7D4F' },
        head: SANS, w: 600, radius: 14, shadow: '0 6px 18px rgba(47,125,79,.10)',
        nzh: '大面积浅色、卡片白底；插画用叶子、阳光这类自然元素；黄色只做小点缀；整体轻、透气',
        nen: 'Large light areas with white cards; nature motifs (leaves, sunlight) in illustrations; yellow only as a small accent; light and airy' },
      { id: 'tech', zh: '专业科技', en: 'Pro / tech', dzh: '冷灰蓝、信息密、数字清楚', den: 'Cool gray-blue, dense info, crisp numbers',
        c: { bg: '#F5F7FB', surface: '#FFFFFF', text: '#0F172A', muted: '#55657D', line: '#E2E8F0', primary: '#2457F5', accent: '#0F8F8E', on: '#FFFFFF', link: '#2457F5' },
        head: SANS, w: 600, radius: 8, shadow: '0 1px 3px rgba(15,23,42,.08)',
        nzh: '信息密度高但对齐严格；数字用等宽（font-variant-numeric: tabular-nums）；表格行高 44–48；状态用小色点和标签；主色只给主操作',
        nen: 'Dense but strictly aligned; tabular numbers (font-variant-numeric: tabular-nums); 44–48px table rows; status as small dots and tags; primary color only for the main action' },
      { id: 'glass', zh: '玻璃质感', en: 'Glass', dzh: '柔光底、浮层毛玻璃', den: 'Soft glow background, frosted overlays',
        c: { bg: '#EAF0F6', surface: '#F7F9FC', text: '#10151C', muted: '#4F5B69', line: '#D5DEE8', primary: '#CC4520', accent: '#2B6CB0', on: '#FFFFFF', link: '#2B6CB0' },
        bgImage: 'radial-gradient(circle at 20% 15%, #FFD9C7 0, transparent 45%), radial-gradient(circle at 85% 70%, #C9E2FF 0, transparent 50%)',
        head: SANS, w: 600, radius: 18, shadow: '0 10px 30px rgba(16,21,28,.10)',
        nzh: '底色加两三团柔和的光斑（别用紫蓝渐变）；只有浮层、卡片、标签栏用毛玻璃（半透明白 + backdrop-filter: blur(20px) + 1px 白色描边），正文区是实色；毛玻璃上的字照样要够深',
        nen: 'Two or three soft light blobs on the background (not a purple-blue gradient); frosted glass only on overlays, cards and tab bars (translucent white + backdrop-filter: blur(20px) + 1px white border), solid elsewhere; text on glass stays dark enough' },
      { id: 'soft', zh: '柔和立体', en: 'Soft UI', dzh: '同色底、凸起凹陷的柔光阴影', den: 'Same-color surfaces with raised and pressed soft shadows',
        c: { bg: '#E9EDF2', surface: '#E9EDF2', text: '#2D3440', muted: '#556072', line: '#D3D9E1', primary: '#3E5BD8', accent: '#22A06B', on: '#FFFFFF', link: '#3E5BD8' },
        head: ROUND, w: 700, radius: 18, shadow: '6px 6px 14px #C8CED6, -6px -6px 14px #FFFFFF',
        nzh: '卡片和底同色，靠一亮一暗两道阴影凸起，按下用内阴影；容易看不清，所以主按钮一定用主色实底、文字够深；别整屏都是凸起',
        nen: 'Cards share the background color and rise with a light and a dark shadow; pressed states use inset shadows; it gets low-contrast fast, so the main button is solid primary with strong text; don\'t make everything raised' },
    ]

    /** 选了一个风格 → 输入框里的一段字（restyle：给已经打开的设计换风格） */
    function formatStyle(t, pre, restyle) {
      const en = t('lang') === 'en'
      const c = pre.c
      const fonts = t('styleFonts', { head: `${pre.head} · ${pre.w}`, body: SANS })
      return t('styleText', {
        name: en ? pre.en : pre.zh,
        desc: en ? pre.den : pre.dzh,
        colors: t('styleColors', { ...c, bgImage: pre.bgImage ? t('styleBgImage', { v: pre.bgImage }) : '' }),
        fonts,
        shape: t('styleShape', { r: pre.radius, s: pre.shadow }),
        notes: en ? pre.nen : pre.nzh,
        ask: t(restyle ? 'styleRestyle' : 'styleStart'),
      })
    }

    // ── 调样式 ───────────────────────────────────────────────────────────────

    const VAR_ONLY = /^var\(\s*(--[\w-]+)\s*\)$/
    /** 面板上能调的几项：属性 → [文案, 哪一行]（上下 / 左右内边距各管两条） */
    const STYLE_LABEL = { 'font-size': 'styleFont', 'font-weight': 'styleWeight', color: 'styleColor', background: 'styleBg', 'border-radius': 'styleRadius',
      'padding-top': 'stylePadY', 'padding-bottom': 'stylePadY', 'padding-left': 'stylePadX', 'padding-right': 'stylePadX', gap: 'styleGap' }

    /** 变量名 → 它现在的值（页面 :root 上的） */
    const tokenVal = (name, tokens) => { const tok = (tokens || []).find((x) => x.name === name); return tok ? String(tok.value).trim() : '' }

    /** 值 → 像素数（var(--x) 先换成变量的值；rem / em 按 16）；认不出返回 null */
    function pxOf(v, tokens) {
      let s = String(v || '').trim()
      const m = VAR_ONLY.exec(s)
      if (m) s = tokenVal(m[1], tokens)
      const n = parseFloat(s)
      if (!isFinite(n)) return null
      return /r?em$/.test(s) ? n * 16 : n
    }

    /** 透明的颜色（没设背景时 getComputedStyle 给 rgba(0, 0, 0, 0)） */
    const clearColor = (v) => /^(transparent|rgba\(.*,\s*0\)|hsla\(.*,\s*0%?\))$/i.test(String(v || '').trim())

    /** 值 → '#rrggbb'（颜色框只认这个）；透明的给白色，不然显示成黑的 */
    const colorHex = (v, tokens) => {
      const m = VAR_ONLY.exec(String(v || '').trim())
      const c = m ? tokenVal(m[1], tokens) : v
      return '#' + (clearColor(c) ? 'ffffff' : hexOf(c))
    }

    /** 给人看的值：颜色换成 #RRGGBB，透明的说透明，别的原样 */
    const showVal = (prop, v, t) => {
      if (!/^(color|background)$/.test(prop)) return String(v)
      if (clearColor(v)) return t ? t('styleClear') : 'transparent'
      return /^(rgb|hsl)/i.test(String(v)) ? '#' + hexOf(v).toUpperCase() : String(v)
    }

    /** 改了的几项 → 「字号 15px → 17px」这种；上下 / 左右内边距只说一次 */
    function styleChanges(t, sty) {
      const out = []
      const seen = new Set()
      for (const [k, v] of Object.entries((sty && sty.live) || {})) {
        const key = STYLE_LABEL[k]
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(t('styleArrow', { prop: t(key), from: showVal(k, sty.base[k], t), to: showVal(k, v, t) }))
      }
      return out
    }

    const ruleKey = (r) => `${r.href}|${r.sel}|${r.n}`
    /** 规则在哪：服务端找到了行号就是「app.css 第 42 行」，没找到就是文件名 */
    function ruleAt(t, r, located) {
      const hit = located && located.get(ruleKey(r))
      if (hit && hit.file) return hit.line ? t('ruleAt', { file: hit.file, line: hit.line }) : hit.file
      try { return decodeURIComponent(new URL(r.href).pathname.split('/').pop()) || r.href } catch { return String(r.href || '') }
    }

    /** 改了的这几项现在各由哪条规则决定（同一条规则的合成一行），模型照着去改那条，不用再 grep */
    function ruleLines(t, sty, located) {
      const groups = new Map()
      for (const k of Object.keys((sty && sty.live) || {})) {
        const r = sty.rules && sty.rules[k]
        const key = STYLE_LABEL[k]
        if (!r || !key) continue
        const g = r.inline ? `inline|${r.sel ? ruleKey(r) : ''}` : ruleKey(r)
        if (!groups.has(g)) groups.set(g, { r, props: [] })
        const label = t(key)
        if (!groups.get(g).props.includes(label)) groups.get(g).props.push(label)
      }
      const out = []
      for (const { r, props } of groups.values()) {
        const p = props.join('、')
        if (r.inline) out.push(t('ruleInline', { props: p, over: r.sel ? t('ruleOver', { sel: r.sel, at: ruleAt(t, r, located) }) : '' }))
        else out.push(t(r.maybe ? 'ruleMaybe' : 'ruleFrom', { props: p, sel: r.sel, at: ruleAt(t, r, located) }))
      }
      return out
    }

    /** 调好的样式交给模型：哪一屏、哪个元素、改了什么、现在由哪条规则决定（located：服务端找到的行号），让它改进样式表 */
    function formatStyleAsk(t, sty, st, located) {
      const rules = ruleLines(t, sty, located)
      return t('styleAskText', { name: sty.name, sel: sty.selector, list: styleChanges(t, sty).join(t('styleJoin')), rules: rules.length ? `\n${rules.join('\n')}\n` : '', where: whereOf(sty.url, st) })
    }

    // ── 设计体检 ─────────────────────────────────────────────────────────────

    /** 一条问题的具体数字（「#C8C8C8 配 #FFFFFF，1.7:1」这种） */
    function checkDetail(t, it) {
      const edge = it.edge === 'top' || it.edge === 'bottom' ? it.edge : ''
      return t('cd_' + it.type, {
        ...it,
        n: it.sizes ? it.sizes.length : '',
        sizes: it.sizes ? it.sizes.join(' / ') : '',
        otherText: String(it.otherText || '').slice(0, 20),
        edgeName: edge ? t('ckEdge_' + edge) : '',
        when: edge ? t('ckWhen_' + edge) : '',
        what: it.type === 'missing' ? t('ckWhat_' + (['css', 'script', 'font'].includes(it.what) ? it.what : 'other')) : '',
        at: it.type === 'jserr' && it.src ? ` (${it.src}${it.line ? ':' + it.line : ''})` : '',
      })
    }

    /** 量的时候这一屏多大、页面多高、固定栏离内容多远（让模型知道量的是什么） */
    function sizeLine(t, m) {
      if (!m || !m.w) return ''
      let out = t('ckSize', { w: m.w, h: m.h, page: m.page || m.h })
      for (const b of m.bars || []) if (b.gap != null) out += t('ckSizeBar', { edgeName: t('ckEdge_' + b.edge), bar: b.name, gap: b.gap })
      return out
    }

    /** 体检结果 → 输入框里的一段字：按屏分组，带文件位置、选择器和数字，模型照着改 */
    function formatCheck(t, list, st, head = 'checkAsk') {
      const n = list.reduce((m, x) => m + x.issues.length, 0)
      const lines = [t(head, { n, s: list.length })]
      for (const sc of list) {
        if (sc.error && head !== 'checkAsk') lines.push('', t('ckToolErr', { label: sc.label, msg: sc.error }))
        if (!sc.issues.length) continue
        const sz = head === 'checkAsk' ? '' : sizeLine(t, sc.metrics)
        lines.push('', t('ckScreen', { label: sc.label, where: whereOf(sc.url, st) }) + (sz ? ` · ${sz}` : ''))
        sc.issues.forEach((it, i) => lines.push(t('ckItem', {
          i: i + 1,
          type: t('ck_' + it.type),
          where: it.sel || '',
          text: it.text ? t('ckQuote', { text: it.text }) : '',
          detail: checkDetail(t, it),
        })))
      }
      return lines.join('\n') + '\n'
    }

    /**
     * 一屏是不是「同一屏的几个版本」之一：home-a / home-b / home-c，或 login / login-b / login-c（和 core.js 的 placeScreen 一个规则）。
     * 是就给出 { stem, letter, others }（others：同组的其他文件名），不是给 null
     */
    function takesOf(keys, key) {
      const VAR = /^(.+)-([a-z])\.html?$/i
      const part = (x) => {
        const v = VAR.exec(x)
        return v ? { stem: v[1].toLowerCase(), letter: v[2].toLowerCase() } : { stem: x.toLowerCase().replace(/\.html?$/i, ''), letter: '' }
      }
      if (!/\.html?$/i.test(key)) return null
      const me = part(key)
      const others = keys.filter((x) => x !== key && /\.html?$/i.test(x) && part(x).stem === me.stem && (me.letter || part(x).letter))
      if (!others.length || (!me.letter && !others.some((x) => part(x).letter))) return null
      return { stem: VAR.exec(key) ? VAR.exec(key)[1] : key.replace(/\.html?$/i, ''), letter: me.letter, others }
    }

    /** 体检结果 → 交给 check_design 工具的一段字（模型自己调的，不带〔设计体检〕开头） */
    function formatCheckTool(t, list, st) {
      const n = list.reduce((m, x) => m + x.issues.length, 0)
      if (n || list.some((x) => x.error)) return formatCheck(t, list, st, 'ckToolHead')
      return t('ckToolOk', { s: list.length, labels: list.map((x) => { const sz = sizeLine(t, x.metrics); return sz ? `${x.label} ${sz}` : x.label }).join(' / ') })
    }

    // ── 导出图片：设备外框、整套展示图 ───────────────────────────────────────

    const SHOW_COLS = { app: 4, tablet: 3, web: 2, poster: 3, slides: 2, email: 3 }
    const CANVAS_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    const FRAMED = { app: 1, tablet: 1, web: 1 }

    function loadImg(blob) {
      return new Promise((resolve, reject) => {
        const u = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(u); resolve(img) }
        img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('image decode failed')) }
        img.src = u
      })
    }

    function rrect(ctx, x, y, w, ht, r) {
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, w, ht, r)
      else ctx.rect(x, y, w, ht)
    }

    /** 外框加上去之后的大小（和画布上一样） */
    function frameSize(kind, w, ht) {
      const f = FRAME[kind] || FRAME.web
      return [w + (f.pad || 0) * 2, ht + (f.pad || 0) * 2 + (f.top || 0)]
    }

    /** 在 (x, y) 画一个带外框的屏：w × ht 是屏幕本身；img 按宽铺进去，高出来的裁掉 */
    function drawDevice(ctx, kind, img, x, y, w, ht, label) {
      const f = frameOf(kind, w, ht)
      const pad = f.pad || 0
      const top = f.top || 0
      const r = f.r || 0
      const [W, H] = frameSize(kind, w, ht)
      const dark = kind === 'app' || kind === 'tablet'
      ctx.save()
      ctx.shadowColor = 'rgba(15, 18, 30, .22)'
      ctx.shadowBlur = 48
      ctx.shadowOffsetY = 18
      rrect(ctx, x, y, W, H, r)
      ctx.fillStyle = dark ? '#0e0e12' : '#fff'
      ctx.fill()
      ctx.restore()
      if (dark) {
        rrect(ctx, x + 0.75, y + 0.75, W - 1.5, H - 1.5, r - 0.75)
        ctx.strokeStyle = '#2b2b33'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      if (top) {
        ctx.save()
        rrect(ctx, x, y, W, top, [r, r, 0, 0])
        ctx.fillStyle = '#ebebef'
        ctx.fill()
        ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
          ctx.beginPath()
          ctx.arc(x + 18.5 + i * 18, y + top / 2, 5.5, 0, Math.PI * 2)
          ctx.fillStyle = c
          ctx.fill()
        })
        const px = x + 86
        const pw = W - 86 - 60
        rrect(ctx, px, y + (top - 20) / 2, pw, 20, 6)
        ctx.fillStyle = 'rgba(0,0,0,.05)'
        ctx.fill()
        ctx.fillStyle = '#6b6b74'
        ctx.font = `12px ${CANVAS_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label || '', px + pw / 2, y + top / 2 + 0.5, pw - 16)
        ctx.fillStyle = 'rgba(0,0,0,.07)'
        ctx.fillRect(x, y + top - 1, W, 1)
        ctx.restore()
      }
      ctx.save()
      rrect(ctx, x + pad, y + pad + top, w, ht, top ? [0, 0, r, r] : f.ir != null ? f.ir : r)
      ctx.clip()
      ctx.fillStyle = '#fff'
      ctx.fillRect(x + pad, y + pad + top, w, ht)
      if (img) ctx.drawImage(img, x + pad, y + pad + top, w, img.height * (w / img.width))
      ctx.restore()
      if (f.island) {
        rrect(ctx, x + W / 2 - 59, y + pad + f.island, 118, 34, 17)
        ctx.fillStyle = '#000'
        ctx.fill()
      }
    }

    function canvasBlob(canvas) {
      return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
    }

    /** 一屏带外框（四周留出阴影的地方，背景透明） */
    async function composeOne(kind, size, img, label) {
      const [w, ht] = size
      const [W, H] = frameSize(kind, w, ht)
      const m = 56
      const S = Math.min(2, 6000 / (W + m * 2))
      const c = document.createElement('canvas')
      c.width = Math.round((W + m * 2) * S)
      c.height = Math.round((H + m * 2) * S)
      const ctx = c.getContext('2d')
      ctx.scale(S, S)
      drawDevice(ctx, kind, img, m, m, w, ht, label)
      return canvasBlob(c)
    }

    /** 一串页面标题 → 共同的品牌名 + 每屏自己的名字（「登录 · 八克咖啡」「首页 · 八克咖啡」→ 八克咖啡 / 登录、首页） */
    function splitTitles(titles) {
      const SEP = /\s*[·｜|—]\s*|\s+[-–]\s+/
      const parts = titles.map((x) => String(x || '').split(SEP).map((s) => s.trim()).filter(Boolean))
      if (titles.length > 1 && parts.every((p) => p.length >= 2)) {
        const last = parts[0][parts[0].length - 1]
        if (parts.every((p) => p[p.length - 1] === last)) return { brand: last, labels: parts.map((p) => p.slice(0, -1).join(' · ')) }
        const first = parts[0][0]
        if (parts.every((p) => p[0] === first)) return { brand: first, labels: parts.map((p) => p.slice(1).join(' · ')) }
      }
      return { brand: '', labels: titles.map((x) => String(x || '')) }
    }

    /** 从设计变量里挑展示图的底色和点缀色 */
    function pickColors(tokens) {
      const colors = (tokens || []).filter((tk) => tokenKind(tk) === 'color')
      const find = (re, not) => (colors.find((tk) => re.test(tk.name) && !(not && not.test(tk.name))) || {}).value || ''
      return {
        bg: find(/(^|-)(bg|background|canvas|base|paper)(-|$)/i, /ink|text|fg|on-/i),
        accent: find(/primary|brand|accent/i, /ink|text|fg|on-|soft|veil|line|muted|bg/i),
      }
    }

    /**
     * 参考图的主要颜色。px 是 RGBA 像素（缩小过的图）。
     * 先按每通道 5 位分桶，从占比大的桶里挑彼此差得开的几种做种子，再按桶做几轮 k-means 收拢；
     * 占比太小的不要，但图里有鲜艳的点缀色（按钮、强调）时单独补上一个。
     * @returns {{ colors: [{ hex, share, accent? }], light: boolean }}
     */
    function paletteOf(px, max = 6) {
      const buckets = new Map()
      let n = 0
      let lum = 0
      for (let i = 0; i + 3 < px.length; i += 4) {
        if (px[i + 3] < 128) continue
        const r = px[i], g = px[i + 1], b = px[i + 2]
        const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        let e = buckets.get(k)
        if (!e) buckets.set(k, (e = { r: 0, g: 0, b: 0, n: 0 }))
        e.r += r; e.g += g; e.b += b; e.n++
        n++
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      if (!n) return { colors: [], light: true }
      const list = [...buckets.values()].map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n })).sort((a, b) => b.n - a.n)
      const dist = (a, b) => {
        const rm = (a.r + b.r) / 2
        const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b
        return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
      }
      const sat = (c) => { const hi = Math.max(c.r, c.g, c.b); return hi ? (hi - Math.min(c.r, c.g, c.b)) / hi : 0 }
      const FAR = 36 // 再近就算同一种（白卡片和浅灰底还分得开）
      let seeds = []
      for (const c of list) {
        if (seeds.length >= max) break
        if (seeds.every((p) => dist(p, c) > FAR)) seeds.push({ r: c.r, g: c.g, b: c.b })
      }
      const near = (c, set) => { let bi = 0, bd = Infinity; set.forEach((p, i) => { const d = dist(p, c); if (d < bd) { bd = d; bi = i } }); return bi }
      for (let it = 0; it < 4; it++) {
        const acc = seeds.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
        for (const c of list) { const a = acc[near(c, seeds)]; a.r += c.r * c.n; a.g += c.g * c.n; a.b += c.b * c.n; a.n += c.n }
        seeds = seeds.map((p, i) => (acc[i].n ? { r: acc[i].r / acc[i].n, g: acc[i].g / acc[i].n, b: acc[i].b / acc[i].n } : p))
      }
      const share = seeds.map(() => 0)
      for (const c of list) share[near(c, seeds)] += c.n
      let out = seeds.map((p, i) => ({ ...p, share: share[i] / n }))
      // 收拢后挨得太近的两种并成一种
      for (let merged = true; merged;) {
        merged = false
        for (let i = 0; i < out.length && !merged; i++) {
          for (let j = i + 1; j < out.length && !merged; j++) {
            if (dist(out[i], out[j]) >= FAR) continue
            const a = out[i], b = out[j], w = a.share + b.share
            out[i] = { r: (a.r * a.share + b.r * b.share) / w, g: (a.g * a.share + b.g * b.share) / w, b: (a.b * a.share + b.b * b.share) / w, share: w }
            out.splice(j, 1)
            merged = true
          }
        }
      }
      out = out.filter((c) => c.share >= 0.015)
      // 点缀色：现有几种里没有鲜艳的，就在鲜艳的桶里找一团够多、和已有颜色差得开的
      const isVivid = (c) => sat(c) > 0.4 && Math.max(c.r, c.g, c.b) > 100
      if (!out.some(isVivid)) {
        const vivid = list.filter((c) => isVivid(c) && out.every((o) => dist(o, c) > FAR))
        let best = null
        for (const c of vivid.slice(0, 60)) {
          const group = vivid.filter((o) => dist(o, c) < FAR)
          const w = group.reduce((s, o) => s + o.n, 0)
          const score = w * sat(c) * sat(c)
          if (!best || score > best.score) best = { w, group, score }
        }
        if (best && best.w / n >= 0.004) {
          const g = best.group
          const avg = (ch) => g.reduce((s, o) => s + o[ch] * o.n, 0) / best.w
          if (out.length >= max) out.pop()
          out.push({ r: avg('r'), g: avg('g'), b: avg('b'), share: best.w / n, accent: true })
        }
      }
      const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
      out = out.sort((a, b) => b.share - a.share)
      return { colors: out.map((c) => (c.accent ? { hex: hex(c), share: c.share, accent: true } : { hex: hex(c), share: c.share })), light: lum / n / 255 > 0.55 }
    }

    /** 参考图 → 输入框里的一段字：路径、尺寸、深浅、主要颜色，加一句怎么用 */
    function formatRef(t, { path, w, h, palette, hasDesign }) {
      const colors = palette.colors.map((c) => `${c.hex} ${Math.max(1, Math.round(c.share * 100))}%${c.accent ? t('refAccent') : ''}`).join(t('refJoin'))
      return t('refText', { path, w, h, tone: t(palette.light ? 'refLight' : 'refDark'), colors: colors || '—', ask: t(hasDesign ? 'refAsk' : 'refAskNew') })
    }

    /** 读参考图：缩小了取颜色；文件本身原样送去存（太大或不是常见格式就重新编成 PNG） */
    async function readRef(file) {
      const img = await loadImg(file)
      const w = img.naturalWidth
      const ht = img.naturalHeight
      const k = Math.min(1, 96 / Math.max(w, ht))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * k))
      c.height = Math.max(1, Math.round(ht * k))
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const palette = paletteOf(ctx.getImageData(0, 0, c.width, c.height).data)
      let blob = file
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 16 * 1024 * 1024) {
        const big = document.createElement('canvas')
        const s = Math.min(1, 2400 / Math.max(w, ht))
        big.width = Math.max(1, Math.round(w * s))
        big.height = Math.max(1, Math.round(ht * s))
        big.getContext('2d').drawImage(img, 0, 0, big.width, big.height)
        blob = await canvasBlob(big)
      }
      return { w, h: ht, palette, data: await blobB64(blob) }
    }

    function lumaOf(color) {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 1
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#808080'
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      } catch { return 1 }
    }

    /**
     * 整套展示图：几屏带外框排成网格，上面是品牌名和一行说明，铺一层底色 + 点缀色的光晕。
     * shots: [{ img, label }]
     */
    async function composeShowcase({ kind, size, shots, title, sub, bg, accent, mark }) {
      const [w, ht] = size
      const [DW, DH] = frameSize(kind, w, ht)
      const u = Math.max(1, Math.min(2, DW / 430))
      const n = shots.length
      const cols = Math.min(n, SHOW_COLS[kind] || 3)
      const rows = Math.ceil(n / cols)
      const gap = 64 * u
      const labH = 52 * u
      const pad = 104 * u
      const titleSize = 46 * u
      const head = (title ? titleSize * 1.25 + 14 * u : 0) + 22 * u + 72 * u
      const W = pad * 2 + cols * DW + (cols - 1) * gap
      const H = pad + head + rows * (DH + labH) + (rows - 1) * gap * 0.6 + pad * 0.8
      const S = Math.max(0.5, Math.min(2, 7000 / W, 7000 / H))
      const c = document.createElement('canvas')
      c.width = Math.round(W * S)
      c.height = Math.round(H * S)
      const ctx = c.getContext('2d')
      ctx.scale(S, S)
      const base = bg || '#f3f3f6'
      ctx.fillStyle = '#f3f3f6'
      ctx.fillStyle = base
      ctx.fillRect(0, 0, W, H)
      if (accent) {
        for (const [gx, gy, gr, ga] of [[0.05, 0.02, 0.75, 0.16], [0.98, 0.95, 0.7, 0.12]]) {
          ctx.save()
          ctx.globalAlpha = ga
          const g = ctx.createRadialGradient(W * gx, H * gy, 0, W * gx, H * gy, Math.max(W, H) * gr)
          g.addColorStop(0, accent)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
          ctx.restore()
        }
      }
      const light = lumaOf(base) > 0.55
      const ink = light ? '#16161a' : '#f5f5f7'
      const muted = light ? 'rgba(22,22,26,.55)' : 'rgba(245,245,247,.6)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      let y = pad
      if (title) {
        ctx.fillStyle = ink
        ctx.font = `600 ${titleSize}px ${CANVAS_FONT}`
        y += titleSize
        ctx.fillText(title, pad, y, W - pad * 2)
        y += 14 * u
      }
      ctx.fillStyle = muted
      ctx.font = `${18 * u}px ${CANVAS_FONT}`
      y += 22 * u
      ctx.fillText(sub, pad, y, W - pad * 2)
      y += 72 * u
      shots.forEach((s, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const inRow = Math.min(cols, n - row * cols)
        const off = ((cols - inRow) * (DW + gap)) / 2 // 最后一行不满就居中
        const x = pad + off + col * (DW + gap)
        const yy = y + row * (DH + labH + gap * 0.6)
        drawDevice(ctx, kind, s.img, x, yy, w, ht, s.label)
        ctx.fillStyle = muted
        ctx.font = `500 ${16 * u}px ${CANVAS_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText(s.label || '', x + DW / 2, yy + DH + 34 * u, DW)
        ctx.textAlign = 'left'
      })
      if (mark) {
        ctx.fillStyle = muted
        ctx.globalAlpha = 0.7
        ctx.font = `${13 * u}px ${CANVAS_FONT}`
        ctx.textAlign = 'right'
        ctx.fillText(mark, W - pad * 0.5, H - pad * 0.32)
        ctx.globalAlpha = 1
      }
      return canvasBlob(c)
    }

    /** CSS 颜色 → 'RRGGBB'（PPT 留边的底色）；认不出就白色 */
    function hexOf(color) {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 1
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillStyle = color || '#ffffff'
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((x) => x.toString(16).padStart(2, '0')).join('')
      } catch { return 'ffffff' }
    }

    /** 截图 → JPEG（base64）。PDF / PPT 里一页一张，JPEG 小得多；透明的地方垫白 */
    async function jpegB64(img) {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0)
      const blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9))
      return blobB64(blob)
    }

    function blobB64(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
        r.onerror = () => reject(r.error)
        r.readAsDataURL(blob)
      })
    }

    /** 图片放进剪贴板（DSH 窗口没焦点之类的拿不到就算了） */
    async function copyImage(blob) {
      try {
        if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        return true
      } catch { return false }
    }

    /** 时间：今天的只写时分，别的天带上月日 */
    /** 2026.10.19：不跟系统区域走（DSH 按 en-US 起，toLocaleDateString 会给 10/19/2026） */
    function ymd(d) {
      return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
    }
    function hhmm(at) {
      const d = new Date(at)
      const p = (x) => String(x).padStart(2, '0')
      const now = new Date()
      const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
      return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
    }

    // ── 设计类型：画幅和外框 ─────────────────────────────────────────────────

    const KIND_LIST = ['web', 'app', 'tablet', 'poster', 'slides', 'email']
    const KIND_KEY = { web: 'kindWeb', app: 'kindApp', tablet: 'kindTablet', poster: 'kindPoster', slides: 'kindSlides', email: 'kindEmail' }
    const GHOST_MS = 90000 // 这么久没出新屏就撤掉「生成中…」占位
    const EDIT_GRACE_MS = 3000 // 退出改字后这么久里，页面交上来的最后一处改动还收
    const KIND_SIZE = { web: [1280, 800], app: [390, 844], tablet: [820, 1180], poster: [1080, 1350], slides: [1280, 720], email: [640, 960] }
    // 外框：pad 边框厚度、top 顶上一条（浏览器栏）、r 外圆角、ir 屏幕圆角、island 灵动岛离顶的距离
    const FRAME = {
      web: { pad: 0, top: 34, r: 10, ir: 0 },
      app: { pad: 11, top: 0, r: 55, ir: 44, island: 11 },
      tablet: { pad: 14, top: 0, r: 34, ir: 21 },
      poster: { pad: 0, top: 0, r: 6, ir: 6 },
      slides: { pad: 0, top: 0, r: 8, ir: 8 },
      email: { pad: 0, top: 0, r: 10, ir: 10 },
    }

    /** 某个大小的外框：矮的手机（SE 那种，高不到宽的 1.9 倍）没有灵动岛，不然压住页面最上面 */
    function frameOf(kind, w, ht) {
      const f = FRAME[kind] || FRAME.web
      return f.island && w && ht / w < 1.9 ? { ...f, island: 0 } : f
    }
    const META_ALIAS = { phone: 'app', mobile: 'app', ios: 'app', android: 'app', pad: 'tablet', ipad: 'tablet', social: 'poster', image: 'poster', slide: 'slides', deck: 'slides', ppt: 'slides', mail: 'email' }

    /** 页面里 <meta name="dsh-design" content="app"> / "poster 1080x1920" → { kind, size } */
    function parseMeta(content) {
      const out = { kind: '', size: '' }
      for (const w of String(content || '').toLowerCase().split(/[\s,;]+/)) {
        if (!out.kind && (KIND_LIST.includes(w) || META_ALIAS[w])) out.kind = KIND_LIST.includes(w) ? w : META_ALIAS[w]
        const m = /^(\d{2,5})[x×*](\d{2,5})$/.exec(w)
        if (!out.size && m) out.size = `${m[1]}x${m[2]}`
      }
      return out
    }

    /** 'WxH'（没有就按类型默认）→ [w, h] */
    function sizeOf(size, kind) {
      const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(size || ''))
      if (m && +m[1] >= 100 && +m[2] >= 100) return [Math.min(8000, +m[1]), Math.min(8000, +m[2])]
      return KIND_SIZE[kind] || KIND_SIZE.web
    }

    /** 外框加上去之后的整块大小 */
    function deviceBox(kind, size) {
      const f = FRAME[kind] || FRAME.web
      return [size[0] + f.pad * 2, size[1] + f.pad * 2 + f.top]
    }

    // ── 画布排版 ─────────────────────────────────────────────────────────────

    const ZMIN = 0.04
    const ZMAX = 2
    const PAD = 28
    const PAD_TOP = 52 // 第一行上面要留出标题的地方
    const LAB = 34 // 每屏上面标题占的高度（屏幕像素，不跟着缩放）
    const GAP = 18 // 两屏之间最少隔开的屏幕像素
    const clampZ = (z) => Math.max(ZMIN, Math.min(ZMAX, z))

    /**
     * n 屏排成网格：试每种列数，挑缩进舞台后最大的那种。
     * 行距 = 按比例的空隙 + 标题的高度（标题不缩放，所以换算回画布坐标是 LAB / z）。
     */
    function layoutGrid(n, dw, dh, sw, sh) {
      const gx = Math.max(56, Math.round(dw * 0.14))
      const gy = Math.max(48, Math.round(dh * 0.07))
      const count = Math.max(1, n)
      const W = sw - PAD * 2
      const H = sh - PAD_TOP - PAD
      let best = null
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols)
        const zw = (W - (cols - 1) * GAP) / (cols * dw + (cols - 1) * gx)
        const zh = (H - (rows - 1) * LAB) / (rows * dh + (rows - 1) * gy)
        const z = Math.min(zw, zh)
        if (!best || z > best.z + 1e-9) best = { cols, rows, z }
      }
      const zl = clampZ(Math.min(1, best.z))
      const stepX = dw + gx + GAP / zl
      const stepY = dh + gy + LAB / zl
      const pos = []
      for (let i = 0; i < count; i++) pos.push({ x: (i % best.cols) * stepX, y: Math.floor(i / best.cols) * stepY })
      const bw = best.cols * stepX - gx - GAP / zl
      const bh = best.rows * stepY - gy - LAB / zl
      return { ...best, bw, bh, pos }
    }

    /** 整块居中放进舞台（最大 100%） */
    function fitCam(L, sw, sh) {
      const z = clampZ(Math.min(1, L.z))
      return { z, x: (sw - L.bw * z) / 2, y: PAD_TOP + Math.max(0, (sh - PAD_TOP - PAD - L.bh * z) / 2) }
    }

    /** 多尺寸并排：网页看手机 / 平板 / 电脑，App 看小屏 / 标准 / 大屏，平板看三种 iPad */
    const SIZE_SETS = {
      web: [['szPhone', 'app', [390, 844]], ['szTablet', 'tablet', [820, 1180]], ['szDesktop', 'web', [1440, 900]]],
      app: [['szSmall', 'app', [375, 667]], ['szStd', 'app', [393, 852]], ['szLarge', 'app', [430, 932]]],
      tablet: [['szSmall', 'tablet', [744, 1133]], ['szStd', 'tablet', [820, 1180]], ['szLarge', 'tablet', [1032, 1376]]],
    }

    /** 大小不一的几块排成一行（顶端对齐），算出整块大小和放得下的缩放 */
    function layoutRow(boxes, sw, sh) {
      const maxW = Math.max(...boxes.map((b) => b[0]))
      const gx = Math.max(56, Math.round(maxW * 0.08))
      const pos = []
      let x = 0
      for (const [w] of boxes) {
        pos.push({ x, y: 0 })
        x += w + gx
      }
      const bw = x - gx
      const bh = Math.max(...boxes.map((b) => b[1]))
      const z = Math.min((sw - PAD * 2 - (boxes.length - 1) * GAP) / bw, (sh - PAD_TOP - PAD) / bh)
      return { cols: boxes.length, rows: 1, z, bw, bh, pos }
    }

    /** 跳转的路径 → 画布上的屏（本地文件是相对目录的文件名，开发服务器是路由；旧版本的路径去掉 /__dsh_design__/v/N/） */
    function keyOfPath(p, file) {
      let k = String(p || '').replace(/^\/__dsh_design__\/v\/\d+\//, '/')
      if (!file) return k || '/'
      k = k.replace(/^\/+/, '')
      if (!k || k.endsWith('/')) k += 'index.html'
      return k
    }

    /** 每屏报上来的跳转 → 一屏到另一屏一条（同一对只留第一处） */
    function flowsOf(screens, linksOf, file) {
      const keys = new Set(screens.map((s) => s.key))
      const seen = new Set()
      const out = []
      for (const sc of screens) {
        for (const l of linksOf(sc) || []) {
          const to = keyOfPath(l.path, file)
          if (to === sc.key || !keys.has(to)) continue
          const k = sc.key + '>' + to
          if (seen.has(k)) continue
          seen.add(k)
          out.push({ from: sc.key, to, x: l.x, y: l.y, w: l.w, h: l.h })
        }
      }
      return out
    }

    /**
     * 连线的几何（画布坐标）：从页面里那个按钮的边上出发，落到目标屏的左边（目标在左边就落右边），
     * 两头水平进出的三次曲线；同一屏进来好几条，落点上下错开。
     */
    function flowLines(flows, keys, pos, kind, size, opts = {}) {
      const f = FRAME[kind] || FRAME.web
      const [dw, dh] = deviceBox(kind, size)
      const idx = new Map(keys.map((k, i) => [k, i]))
      const incoming = new Map()
      const out = []
      const lift = opts.lift || 0 // 屏上面标题那一条有多高（世界坐标）：绕行的线不压标题
      // 一屏占的地方（连上面的标题）；曲线要是穿过别的屏，就改走屏和屏之间的空当
      const boxes = pos.map((p) => p && { x0: p.x, y0: p.y - lift, x1: p.x + dw, y1: p.y + dh })
      const xs = [...new Set(pos.filter(Boolean).map((p) => p.x))].sort((m, n) => m - n)
      const ys = [...new Set(pos.filter(Boolean).map((p) => p.y))].sort((m, n) => m - n)
      const gaps = xs.slice(1).map((x, i) => x - xs[i] - dw).filter((x) => x > 0)
      const g = (gaps.length ? Math.min(...gaps) : 64) / 2 // 竖着走的线放在两列中间
      const r = Math.min(g * 0.7, 24) // 拐角圆一点
      const crosses = (pts, skip) => boxes.some((b, i) => b && !skip.includes(i) && pts.some(([x, y]) => x > b.x0 + 2 && x < b.x1 - 2 && y > b.y0 + 2 && y < b.y1 - 2))
      const bez = (p0, p1, p2, p3) => Array.from({ length: 23 }, (_, i) => {
        const t = (i + 1) / 24
        const u = 1 - t
        return [0, 1].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j])
      })
      /** 横着走那一道的高度：同一排 → 这一排标题上面；不同排 → 下面那排和上一排之间的空当 */
      function laneOf(ya, yb) {
        const R = Math.max(ya, yb)
        const prev = ys.filter((y) => y < R - 1).pop()
        if (prev === undefined) return R - lift - Math.max(16, g * 0.6)
        const bottom = prev + dh
        return bottom + Math.max(R - lift - bottom, 12) / 2
      }
      /** 直角绕行：出屏 → 竖着到那一道 → 横着走 → 竖着到目标边上 → 进屏 */
      function detour(sx, sy, hOut, cx1, lane, cx2, ey, hIn, ex) {
        const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0)
        let d = `M${sx} ${sy}H${cx1 - hOut * r}`
        const corner = (x, y, dx, dy) => `Q${x} ${y} ${x + dx * r} ${y + dy * r}`
        const hl = sgn(cx2 - cx1)
        if (!hl) {
          const v = sgn(ey - sy)
          return d + corner(cx1, sy, 0, v) + `V${ey - v * r}` + corner(cx1, ey, hIn, 0) + `H${ex}`
        }
        const v1 = sgn(lane - sy)
        const v2 = sgn(ey - lane)
        return d + corner(cx1, sy, 0, v1) + `V${lane - v1 * r}` + corner(cx1, lane, hl, 0)
          + `H${cx2 - hl * r}` + corner(cx2, lane, 0, v2) + `V${ey - v2 * r}` + corner(cx2, ey, hIn, 0) + `H${ex}`
      }
      for (const fl of flows) {
        const a = idx.get(fl.from)
        const b = idx.get(fl.to)
        if (a === undefined || b === undefined || a === b || !pos[a] || !pos[b]) continue
        const pa = pos[a]
        const pb = pos[b]
        const ox = pa.x + f.pad
        const oy = pa.y + f.pad + f.top
        const dir = pb.x > pa.x + 1 ? 1 : pb.x < pa.x - 1 ? -1 : 0
        const n = incoming.get(fl.to) || 0
        incoming.set(fl.to, n + 1)
        const sy = oy + Math.max(0, Math.min(size[1], fl.y + fl.h / 2))
        const ey = pb.y + f.pad + f.top + size[1] * Math.min(0.85, 0.32 + n * 0.09)
        const sx = ox + Math.max(0, Math.min(size[0], dir > 0 ? fl.x + fl.w : fl.x))
        // 先在这一屏里水平走到边上（不斜着划过画面），出了屏再弯到目标
        const edge = dir > 0 ? pa.x + dw : pa.x
        const ex = dir < 0 ? pb.x + dw : pb.x
        const k = Math.max(90, Math.abs(ex - edge) * 0.42)
        const c1 = dir > 0 ? edge + k : edge - k - (dir ? 0 : 60)
        const c2 = dir < 0 ? ex + k : ex - k - (dir ? 0 : 60)
        let d = `M${sx} ${sy}H${edge}C${c1} ${sy} ${c2} ${ey} ${ex} ${ey}`
        if (crosses(bez([edge, sy], [c1, sy], [c2, ey], [ex, ey]), [a, b])) {
          const hOut = dir || -1
          const hIn = dir || 1
          d = detour(sx, sy, hOut, edge + hOut * g, laneOf(pa.y, pb.y), ex - hIn * g, ey, hIn, ex)
        }
        out.push({ from: fl.from, to: fl.to, sx, sy, ex, ey, tip: dir < 0 ? -1 : 1, d })
      }
      return out
    }

    // ── 小部件 ───────────────────────────────────────────────────────────────

    function Skeleton({ gone }) {
      return h('div', { className: 'ddp-skel' + (gone ? ' gone' : '') },
        h('b', { style: { height: 22, width: '38%' } }),
        h('b', { style: { height: 140 } }),
        h('div', { style: { display: 'flex', gap: 14 } },
          h('b', { style: { height: 90, flex: 1 } }), h('b', { style: { height: 90, flex: 1 } }), h('b', { style: { height: 90, flex: 1 } })),
        h('b', { style: { height: 14, width: '72%' } }),
        h('b', { style: { height: 14, width: '54%' } }))
    }

    function AddressForm({ t, sid, initial, onDone, autoFocus, className }) {
      const [value, setValue] = useState(initial || '')
      const [err, setErr] = useState('')
      const submit = async (e) => {
        if (e) e.preventDefault()
        if (!value.trim()) return onDone && onDone()
        try {
          await post('open', { session: sid, target: value.trim() })
          const p = poller(sid)
          p.stop()
          p.start()
          setErr('')
          onDone && onDone()
        } catch (x) {
          setErr(t('openFailed', { msg: x.message }))
        }
      }
      return h('form', { onSubmit: submit, className, style: className ? undefined : { display: 'contents' } },
        h('input', {
          className: 'ddp-input',
          value,
          autoFocus,
          spellCheck: false,
          placeholder: t('placeholder'),
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Escape') onDone && onDone() },
          onBlur: () => { if (!err && onDone && !className) setTimeout(onDone, 150) },
        }),
        className ? h('button', { className: 'ddp-go', type: 'submit' }, t('go')) : null,
        err ? h('div', { className: 'ddp-err', style: className ? { width: '100%' } : { position: 'absolute', top: 40, left: 12 } }, err) : null)
    }

    /** 空状态的小插画：页面线框，光标移过去，框出一块 */
    function EmptyArt() {
      return h('svg', { className: 'ddp-art', viewBox: '0 0 176 120', 'aria-hidden': true },
        h('rect', { className: 'pg', x: 8, y: 6, width: 160, height: 108, rx: 11 }),
        h('path', { className: 'ln', d: 'M8 23h160' }),
        h('circle', { className: 'dt', cx: 19, cy: 14.5, r: 2.4 }),
        h('circle', { className: 'dt', cx: 27, cy: 14.5, r: 2.4 }),
        h('circle', { className: 'dt', cx: 35, cy: 14.5, r: 2.4 }),
        h('rect', { className: 'sk', x: 22, y: 35, width: 78, height: 9, rx: 4.5 }),
        h('rect', { className: 'sk', x: 22, y: 50, width: 58, height: 6, rx: 3 }),
        h('rect', { className: 'bt', x: 22, y: 66, width: 44, height: 15, rx: 7.5 }),
        h('rect', { className: 'sk', x: 106, y: 35, width: 48, height: 48, rx: 9 }),
        h('rect', { className: 'sk', x: 22, y: 92, width: 132, height: 10, rx: 5 }),
        h('rect', { className: 'sel', x: 16, y: 60, width: 56, height: 27, rx: 10 }),
        h('path', { className: 'cur', d: 'M0 0l6.5 16 2.4-6.6 6.6-2.4z' }))
    }

    /**
     * 外框：网页是浏览器窗口，App / 平板是带圆角边框的设备（App 还有灵动岛），海报 / 幻灯片 / 邮件是一张卡片。
     * fill = 铺满舞台（单页看网页）。不管哪种，里面那屏都在同一个位置（换类型不重载页面）。
     */
    function Device({ kind, w, h: ht, fill, label, children }) {
      const f = fill ? { pad: 0, top: 0, r: 0, ir: 0 } : frameOf(kind, w, ht)
      return h('div', {
        className: `ddp-dev k-${kind}` + (fill ? ' fill' : ''),
        style: fill ? undefined : { width: w + f.pad * 2, height: ht + f.pad * 2 + f.top, borderRadius: f.r },
      },
      h('div', { className: 'ddp-chrome', style: { display: f.top ? 'flex' : 'none', height: f.top } }, h('i'), h('i'), h('i'), h('span', null, label || '')),
      h('div', { className: 'ddp-vp', style: fill ? { inset: 0 } : { left: f.pad, top: f.pad + f.top, width: w, height: ht, borderRadius: f.ir } }, children),
      h('div', { className: 'ddp-island', style: { display: f.island ? 'block' : 'none', top: (f.pad || 0) + (f.island || 0) } }))
    }

    /**
     * 一屏：几帧 iframe 叠在一起。cur 是正在显示的；比它新的在后台载，载好了淡入换上来，旧的随后拆掉（不白屏）。
     * 和页面里 picker.js 的握手：hello → init（上一帧的滚动位置和指纹）→ ready → 换上来 → reveal（闪改动 / 播生成动画）。
     */
    const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i
    /** 预览在电脑本机，而 DSH 网页是从别的设备打开的 */
    function away(src) {
      try { return !!src && LOCAL_HOST.test(new URL(src).hostname) && /^https?:$/.test(location.protocol) && !LOCAL_HOST.test(location.hostname) } catch { return false }
    }
    // 远程看（本地文件的预览）：服务端把这一屏连同样式、图片打成一份 HTML，放进沙盒 iframe 的 srcdoc
    const remOf = (p) => (p.remote && away(p.src) ? p.remote : null)
    const OLD_VER = /^__dsh_design__\/v\/(\d+)\/(.*)$/
    /** 这一屏（预览服务器上的地址）打包后的取法 */
    function bundleOf(href, sid) {
      let p
      try { p = new URL(href).pathname } catch { return '' }
      try { p = decodeURIComponent(p) } catch { /* 原样 */ }
      p = p.replace(/^\/+/, '')
      let v = ''
      const m = OLD_VER.exec(p)
      if (m) { v = m[1]; p = m[2] }
      if (!p || p.endsWith('/')) p += 'index.html'
      return `${API}bundle?${new URLSearchParams({ session: sid, key: p, v, parent: location.origin })}`
    }

    function Screen(props) {
      const src = props.src
      const origin = src ? new URL(src).origin : ''
      const [frames, setFrames] = useState([])
      const [cur, setCur] = useState(0)
      const [failed, setFailed] = useState(false) // 远程看：打包没取回来
      const rem = remOf(props)
      const wins = useRef(new Map())
      const life = useRef(null)
      if (!life.current) life.current = { next: 1, loading: 0, again: false, file: '', seeds: new Map(), seedOf: new Map(), readied: new Set(), snapTimer: null, gen: 0, at: '', deps: null }
      const curRef = useRef(0)
      const P = useRef(props)
      P.current = props
      const caps = useRef(new Map()) // 导出图片：请求 id → { resolve, reject }
      const editWas = useRef(false)
      const editOffAt = useRef(0) // 上次退出改字的时间
      const api = useRef(null)
      if (!api.current) {
        let seq = 0
        api.current = {
          ready: () => !!curRef.current && life.current.readied.has(curRef.current),
          capture: (opts) => new Promise((resolve, reject) => {
            if (!curRef.current) { reject(new Error('not loaded')); return }
            const id = `${Date.now()}-${++seq}`
            caps.current.set(id, { resolve, reject })
            postTo(curRef.current, { type: 'capture', id, ...opts })
            setTimeout(() => { if (caps.current.has(id)) { caps.current.delete(id); reject(new Error('timeout')) } }, 30000)
          }),
          // 设计体检：页面里量完回 { issues }，问题同时标在页面上（quiet：只要结果，不标）
          check: (kind, quiet) => new Promise((resolve, reject) => {
            if (!curRef.current) { reject(new Error('not loaded')); return }
            const id = `${Date.now()}-${++seq}`
            caps.current.set(id, { resolve, reject })
            postTo(curRef.current, { type: 'check', id, kind, quiet: !!quiet })
            setTimeout(() => { if (caps.current.has(id)) { caps.current.delete(id); reject(new Error('timeout')) } }, 15000)
          }),
          checkFocus: (i) => { if (curRef.current) postTo(curRef.current, { type: 'checkFocus', i }) },
          checkClear: () => { if (curRef.current) postTo(curRef.current, { type: 'checkClear' }) },
        }
      }
      // 登记到右侧栏：导出图片时按屏找到它
      useEffect(() => {
        const m = props.apis
        const k = props.apiKey
        if (!m || !k) return undefined
        m.set(k, api.current)
        return () => { if (m.get(k) === api.current) m.delete(k) }
      }, [props.apiKey])

      const postTo = (id, msg) => {
        const f = wins.current.get(id)
        if (!f || !f.contentWindow) return
        // 远程看：沙盒里的页面是不透明的源，只能发给 *（发的都是界面指令，没有要保密的）
        if (f.hasAttribute('srcdoc')) f.contentWindow.postMessage({ dshDesign: 1, ...msg }, '*')
        else if (origin) f.contentWindow.postMessage({ dshDesign: 1, ...msg }, origin)
      }

      // 在后台载一帧新的；正在载就记一笔，等它换上来再载
      const load = (seed) => {
        const L = life.current
        if (L.loading) { L.again = true; return }
        const id = L.next++
        L.loading = id
        if (seed) L.seedOf.set(id, seed)
        const r = remOf(P.current)
        if (r) {
          const gen = L.gen
          fetch(bundleOf(L.at || P.current.src, r.sid), { credentials: 'same-origin', cache: 'no-store' })
            .then((res) => res.json().then((d) => {
              if (!res.ok || !d || typeof d.html !== 'string') throw new Error((d && d.error) || `HTTP ${res.status}`)
              return d
            }))
            .then((d) => {
              if (L.gen !== gen || L.loading !== id) return
              L.deps = Array.isArray(d.deps) ? d.deps : null
              L.fails = 0
              setFailed(false)
              setFrames((fs) => [...fs, { id, doc: d.html }])
            })
            .catch(() => {
              if (L.gen !== gen || L.loading !== id) return
              L.loading = 0
              if (!curRef.current) setFailed(true)
              // 没取回来：那次改动还没显示出来，过一会儿再试（最多三回），别等下一次改动
              L.fails = (L.fails || 0) + 1
              if (L.again || L.fails <= 3) { L.again = false; setTimeout(() => { if (L.gen === gen) load(null) }, 1500 * Math.min(L.fails, 3)) }
            })
          return
        }
        let url = P.current.src
        try { if (seed && seed.href && new URL(seed.href).origin === origin) url = seed.href } catch { /* 用原地址 */ }
        setFrames((fs) => [...fs, { id, src: url }])
      }

      const pickMsg = () => ({ type: 'pick', hint: false }) // 提示放在右侧栏（页面顶上会被手机的灵动岛挡住）
      // 调样式：开模式、选中右侧栏记着的那个元素、把改到一半的样式再套上（新载的一帧要从头告诉它）
      const styleTo = (id, p) => {
        postTo(id, { type: 'styleMode', on: true })
        if (p.styleSel) postTo(id, { type: 'styleSel', selector: p.styleSel })
        if (p.styleCss) postTo(id, { type: 'style', css: p.styleCss })
      }

      // 一帧好了：淡入换上来
      const swap = (id, changes) => {
        const L = life.current
        if (L.loading === id) L.loading = 0
        const first = !curRef.current
        curRef.current = id
        setCur(id)
        const p = P.current
        const build = first ? !!p.born : !!(changes && changes.whole && p.busy)
        postTo(id, { type: 'reveal', build })
        postTo(id, { type: 'busy', on: !!p.busy })
        postTo(id, { type: 'zoom', z: p.zoom || 1 })
        if (p.picking) postTo(id, pickMsg())
        if (p.demo) postTo(id, { type: 'demo', on: true })
        if (p.textEdit) postTo(id, { type: 'edit', on: true, hint: false })
        if (p.styleEdit) styleTo(id, p)
        if (first && p.onShown) p.onShown()
        if (first) { if (build && p.onBuilt) p.onBuilt(L.title || '') } else if (p.onNote) p.onNote({ changes, file: L.file, build })
        L.file = ''
        setTimeout(() => setFrames((fs) => fs.filter((f) => f.id >= curRef.current || f.id > id)), 450)
        if (L.again) {
          L.again = false
          postTo(id, { type: 'snapshot' })
        }
      }

      // 换了页面：从头来
      useEffect(() => {
        const L = life.current
        L.loading = 0
        L.again = false
        L.seeds.clear()
        L.seedOf.clear()
        L.gen++
        L.at = ''
        L.deps = null
        L.fails = 0
        curRef.current = 0
        setCur(0)
        setFrames([])
        setFailed(false)
        if (src) setTimeout(() => load(null), 0)
      }, [src, !!rem])

      // 页面发来的消息（几屏共用一个源，按 iframe 认是不是自己的）
      useEffect(() => {
        const on = (e) => {
          if (rem ? e.origin !== 'null' : !origin || e.origin !== origin) return
          let id = 0
          for (const [k, f] of wins.current) if (f && f.contentWindow === e.source) { id = k; break }
          const d = e.data
          if (!id || !d || d.dshDesign !== 1) return
          const L = life.current
          const p = P.current
          const isCur = id === curRef.current
          switch (d.type) {
            case 'hello': {
              // 自己整页刷新的（热更新 / 点了链接）用它走之前留下的指纹，新载的一帧用载它时的
              const seed = L.seeds.get(id) || L.seedOf.get(id) || null
              L.seeds.delete(id)
              L.seedOf.delete(id)
              postTo(id, { type: 'init', seed })
              break
            }
            case 'ready':
              L.readied.add(id)
              L.title = d.title || ''
              if (p.dark) postTo(id, { type: 'theme', dark: true })
              if (p.tweak) postTo(id, { type: 'tweak', vars: p.tweak.vars, attrs: p.tweak.attrs })
              if (p.onMeta) p.onMeta(d.meta || '', d.title || '', Array.isArray(d.tokens) ? d.tokens : [], !!d.dark, Array.isArray(d.links) ? d.links : [])
              if (p.onHref && d.href) p.onHref(d.href)
              if (isCur) {
                postTo(id, { type: 'reveal' })
                postTo(id, { type: 'zoom', z: p.zoom || 1 })
                if (p.picking) postTo(id, pickMsg())
                if (p.demo) postTo(id, { type: 'demo', on: true })
                if (p.textEdit) postTo(id, { type: 'edit', on: true, hint: false })
                if (p.styleEdit) styleTo(id, p)
                if (d.changes && d.changes.count && p.onNote) p.onNote({ changes: d.changes, file: '' })
              } else if (id > curRef.current) swap(id, d.changes)
              break
            case 'links':
              if (p.onLinks && Array.isArray(d.links)) p.onLinks(d.links)
              break
            case 'changed':
              if (isCur) { L.file = d.file || L.file; load(d.seed) }
              break
            case 'snap':
              if (isCur) { clearTimeout(L.snapTimer); load(d.seed) }
              break
            case 'bye':
              if (isCur) L.seeds.set(id, d.seed)
              break
            case 'updated':
              if (isCur && p.onNote) p.onNote({ changes: d.changes, file: '' })
              break
            case 'cancelled':
              if (!isCur) break
              if (d.style) { if (p.onStyleCancel) p.onStyleCancel() } else if (p.onCancelled) p.onCancelled()
              break
            case 'stylePick':
              if (isCur && p.styleEdit && p.onStylePick && d.payload && d.payload.loc) p.onStylePick(d.payload)
              break
            // 点选、改字只在用户开着对应模式时收（页面自己的脚本也能发这种消息，不能随时往输入框里塞字、往文件里写）
            case 'picked':
              if (isCur && p.picking && p.onPicked) p.onPicked(d.payload)
              break
            case 'nav':
              if (!isCur || typeof d.path !== 'string') break
              if (p.onNav) p.onNav(d.path)
              else if (remOf(p)) { L.at = origin + d.path; load(null) } // 远程看：页面里点了跳页，这一框换成那一页（和本机预览时 iframe 自己跳过去一样）
              break
            case 'edited':
              if (isCur && (p.textEdit || Date.now() - editOffAt.current < EDIT_GRACE_MS) && p.onEdited && typeof d.before === 'string' && typeof d.after === 'string') p.onEdited(d)
              break
            case 'editDone':
              if (isCur && p.onEditDone) p.onEditDone()
              break
            case 'checked':
            case 'captured': {
              const c = caps.current.get(d.id)
              if (c) {
                caps.current.delete(d.id)
                if (d.error) c.reject(new Error(d.error))
                else c.resolve(d)
              }
              break
            }
            default:
          }
        }
        window.addEventListener('message', on)
        return () => window.removeEventListener('message', on)
      }, [origin, src, !!rem])

      // 模型在不在干活、画布缩放比例、选取开关：告诉页面
      useEffect(() => { if (cur) postTo(cur, { type: 'busy', on: !!props.busy }) }, [!!props.busy, cur])
      const zq = Math.round((props.zoom || 1) * 100)
      useEffect(() => { if (cur) postTo(cur, { type: 'zoom', z: zq / 100 }) }, [zq])
      useEffect(() => { if (cur) postTo(cur, props.picking ? pickMsg() : { type: 'cancel' }) }, [!!props.picking])
      useEffect(() => { if (cur) postTo(cur, { type: 'theme', dark: !!props.dark }) }, [!!props.dark])
      useEffect(() => { if (cur) { if (props.styleEdit) styleTo(cur, props); else postTo(cur, { type: 'styleMode', on: false }) } }, [!!props.styleEdit])
      useEffect(() => { if (cur && props.styleEdit) postTo(cur, { type: 'styleSel', selector: props.styleSel || '' }) }, [props.styleSel || ''])
      const cssSig = JSON.stringify(props.styleCss || {})
      useEffect(() => { if (cur && props.styleEdit) postTo(cur, { type: 'style', css: props.styleCss || {} }) }, [cssSig])
      useEffect(() => { if (cur) postTo(cur, { type: 'demo', on: !!props.demo }) }, [!!props.demo])
      // 调节滑块：拖的时候改页面上的 CSS 变量 / <html> 属性（新载的一帧在 ready 时套上）
      const twSig = JSON.stringify(props.tweak || null)
      useEffect(() => { if (cur) postTo(cur, { type: 'tweak', vars: (props.tweak || {}).vars || {}, attrs: (props.tweak || {}).attrs || {} }) }, [twSig])
      useEffect(() => {
        // 刚退出改字（点按钮、Esc、模型开始干活）：页面会把正在改的那一处交上来，这一小会儿还收
        if (editWas.current && !props.textEdit) editOffAt.current = Date.now()
        editWas.current = !!props.textEdit
        if (cur) postTo(cur, { type: 'edit', on: !!props.textEdit, hint: false })
      }, [!!props.textEdit])

      // 刷新：先问当前这帧要滚动位置和指纹，问不到就直接载
      const refresh = () => {
        const L = life.current
        if (!curRef.current) { load(null); return }
        clearTimeout(L.snapTimer)
        L.snapTimer = setTimeout(() => load(null), 400)
        postTo(curRef.current, { type: 'snapshot' })
      }
      const seq = useRef(props.reloadSeq)
      useEffect(() => {
        if (seq.current === props.reloadSeq) return
        seq.current = props.reloadSeq
        refresh()
      }, [props.reloadSeq])

      // 远程看：页面连不上预览服务器、收不到它的改动通知，跟着右侧栏轮询到的「目录里改了哪些文件」重新打包
      // （改的全是这一屏没用到的就不动；旧版本不会变）。两次轮询之间可能来了好几批：按序号取上次看到之后所有批的并集，
      // 记录断了档（中间的批已经挤掉了）就不知道改了啥，整屏重打包
      const changes = (rem && rem.changes) || []
      const chgN = changes.length ? changes[changes.length - 1].n : 0
      const chg = rem ? `${rem.at || 0}|${chgN}` : ''
      const chgWas = useRef(chg)
      const seenN = useRef(chgN)
      useEffect(() => {
        if (chgWas.current === chg) return
        chgWas.current = chg
        const from = seenN.current
        seenN.current = chgN
        if (!rem || !rem.at) return
        const L = life.current
        let path = ''
        try { path = new URL(L.at || src).pathname.replace(/^\/+/, '') } catch { /* 地址不对 */ }
        if (OLD_VER.test(path)) return
        const fresh = changes.filter((c) => c.n > from)
        const unknown = !changes.length || changes[0].n > from + 1 || fresh.some((c) => !(c.files || []).length)
        const files = [...new Set(fresh.flatMap((c) => c.files || []))]
        if (!unknown && L.deps && !files.some((f) => L.deps.includes(f))) return
        L.file = files[files.length - 1] || L.file
        refresh()
      }, [chg])

      // 页面没装上脚本（极少数，比如不是 HTML）：载完等一会儿也换上来
      const onFrameLoad = (id) => {
        setTimeout(() => {
          const L = life.current
          if (!L.readied.has(id) && id > curRef.current && wins.current.has(id)) swap(id, null)
        }, 1600)
      }

      // 预览服务器只听电脑本机（127.0.0.1）。从手机（dsh-mobile）或别的电脑打开 DSH 网页时，这个地址指的是它们自己：
      // 本地文件的预览打包传过来（上面）；开发服务器的没法打包，框里会一直空白，说清楚
      const tell = (k) => h('div', { className: 'ddp-scr' + (props.dark ? ' dk' : '') }, h('div', { className: 'ddp-away', style: { fontSize: 13 / Math.max(0.25, props.zoom || 1) } }, props.t ? props.t(k) : ZH[k])) // 画布缩小了，字别跟着变小
      if (away(src) && !rem) return tell('away')
      if (rem && failed && !cur) return tell('remoteFail')
      return h('div', { className: 'ddp-scr' + (props.dark ? ' dk' : '') },
        ...frames.map((f) => h('iframe', {
          key: f.id,
          ref: (el) => { if (el) wins.current.set(f.id, el); else wins.current.delete(f.id) },
          className: 'ddp-frame' + (f.id === cur ? ' cur' : f.id < cur ? ' old' : ''),
          ...(typeof f.doc === 'string' ? { srcDoc: f.doc, sandbox: 'allow-scripts allow-forms', referrerPolicy: 'no-referrer' } : { src: f.src }),
          title: props.label || '',
          tabIndex: f.id === cur ? 0 : -1,
          'aria-hidden': f.id === cur ? undefined : true,
          allow: 'clipboard-read; clipboard-write; fullscreen',
          onLoad: () => onFrameLoad(f.id),
        })),
        h(Skeleton, { gone: !!cur }))
    }

    /** 类型菜单：网页 / App / 平板 / 海报 / 幻灯片 / 邮件 */
    function KindMenu({ t, kind, open, setOpen, onPick }) {
      const ref = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', off, true)
        window.addEventListener('keydown', esc)
        return () => {
          document.removeEventListener('pointerdown', off, true)
          window.removeEventListener('keydown', esc)
        }
      }, [open])
      return h('div', { className: 'ddp-kind', ref },
        h('button', { className: 'ddp-btn' + (open ? ' sel' : ''), title: t('kind'), onClick: () => setOpen(!open) },
          h(I[kind]), h('span', null, t(KIND_KEY[kind])), h(I.caret)),
        open ? h('div', { className: 'ddp-menu', role: 'menu' },
          h('div', { className: 'hd' }, t('kind')),
          ...KIND_LIST.map((k) => h('button', { key: k, role: 'menuitemradio', 'aria-checked': k === kind, className: k === kind ? 'sel' : '', onClick: () => onPick(k) },
            h(I[k]), h('span', null, t(KIND_KEY[k])), h('em', null, KIND_SIZE[k].join('×'))))) : null)
    }

    /** 设计规范面板：按组列出变量，点一个放进输入框 */
    function TokensPanel({ t, tokens, onPick, onAsk, onRef, onStyles, onSystems, onClose }) {
      const groups = {}
      for (const tok of tokens) (groups[tokenKind(tok)] = groups[tokenKind(tok)] || []).push(tok)
      const px = (v) => Math.max(0, parseFloat(v) * (/rem|em$/.test(v) ? 16 : 1)) || 0
      const preview = (kind, v) => {
        switch (kind) {
          case 'color': return h('i', { className: 'sw', style: { background: v } })
          case 'font': return h('span', { style: { fontFamily: v, fontSize: 15, fontWeight: 600 } }, 'Aa')
          case 'size': return h('span', { style: { fontSize: Math.min(22, px(v)), fontWeight: 600, lineHeight: 1 } }, '字')
          case 'space': return h('i', { className: 'bar', style: { width: Math.max(2, Math.min(24, px(v) / 2)) } })
          case 'radius': return h('i', { className: 'rd', style: { borderTopLeftRadius: Math.min(14, px(v)) } })
          case 'shadow': return h('i', { className: 'sh', style: { boxShadow: v } })
          default: return null
        }
      }
      return h('div', { className: 'ddp-tokens', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.palette), h('b', null, t('tokens')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        tokens.length ? h('p', { className: 'tip' }, t('tokensTip')) : null,
        h('div', { className: 'bd' },
          tokens.length
            ? TOKEN_GROUPS.filter((g) => groups[g]).map((g) => h('div', { key: g },
              h('h4', null, t(TOKEN_KEY[g])),
              ...groups[g].map((tok) => h('button', { key: tok.name, className: 'ddp-tok', title: `${tok.name}: ${tok.value}`, onClick: () => onPick(tok) },
                h('span', { className: g === 'shadow' ? 'pv lt' : 'pv' }, preview(g, tok.value)),
                h('span', { className: 'tx' }, h('span', { className: 'nm' }, tok.name), h('span', { className: 'vl' }, tok.value))))))
            : h('div', { className: 'none' }, t('tokensEmpty'), h('div', null, h('button', { className: 'ddp-go', onClick: onAsk }, t('tokensAsk'))))),
        onRef || onStyles ? h('footer', null,
          onStyles ? h('button', { onClick: onStyles }, h(I.sparkle), h('span', null, t('stylesOpen'))) : null,
          onSystems ? h('button', { onClick: onSystems }, h(I.library), h('span', null, t('sysOpen'))) : null,
          onRef ? h('button', { title: t('refPickTip'), onClick: onRef }, h(I.image), h('span', null, t('refPick'))) : null) : null)
    }

    /** 设计体检的结果：按屏列出问题（和页面上的编号一样），点一条在页面上滚过去、那个框闪一下 */
    function CheckPanel({ t, ck, onFocus, onFix, onAgain, onClose }) {
      const list = ck.list || []
      const n = list.reduce((m, x) => m + x.issues.length, 0)
      const multi = list.length > 1
      return h('div', { className: 'ddp-tokens ddp-check', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.stetho), h('b', null, t('check')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        h('p', { className: 'tip' }, ck.running ? t('checking') : n ? t('checkSum', { s: list.filter((x) => x.issues.length).length, n }) : t('checkNote')),
        h('div', { className: 'bd' },
          ...list.filter((sc) => sc.issues.length || sc.error).map((sc) => h('div', { key: sc.key },
            multi ? h('h4', null, sc.label) : null,
            sc.error ? h('div', { className: 'none' }, t('checkFail', { msg: sc.error })) : null,
            ...sc.issues.map((it, i) => h('button', { key: i, className: 'ddp-tok ddp-ck', title: it.sel || '', onClick: () => onFocus(sc.key, i) },
              h('span', { className: 'no' + (it.sev > 1 ? ' hi' : '') }, String(i + 1)),
              h('span', { className: 'tx' },
                h('span', { className: 'nm' }, t('ck_' + it.type) + (it.text ? ` · ${it.text}` : '')),
                h('span', { className: 'vl' }, checkDetail(t, it))))))),
          !ck.running && !n ? h('div', { className: 'ok' }, h(I.check), h('span', null, t('checkNone'))) : null),
        n ? h('p', { className: 'tip' }, t('checkNote')) : null,
        h('footer', { className: 'row' },
          h('button', { onClick: onAgain, disabled: ck.running }, h(I.refresh), h('span', null, t('checkAgain'))),
          h('button', { className: 'go', onClick: onFix, disabled: ck.running || !n }, h(I.sparkle), h('span', null, t('checkFix')))))
    }

    /**
     * 调样式面板：选中的元素的字号、字重、颜色、背景、圆角、内边距、间距。
     * 拖的时候页面上先看效果（还没写进文件）；设计变量列成小块，点一个就用 var(--x)。
     * write：{ ok, tip } 能不能写回文件（开发服务器、模型在干活时不能）
     */
    function StylePanel({ t, sty, tokens, write, onSet, onReset, onAsk, onSave, onClose }) {
      const head = h('header', null, h(I.sliders), h('b', null, t('style')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close)))
      const box = (...kids) => h('div', { className: 'ddp-tokens ddp-style', onPointerDown: (e) => e.stopPropagation() }, head, ...kids)
      if (!sty) return box(h('p', { className: 'tip' }, t('styleNone')))
      const groups = {}
      for (const tok of tokens || []) (groups[tokenKind(tok)] = groups[tokenKind(tok)] || []).push(tok)
      const cur = (k) => (k in sty.live ? sty.live[k] : sty.base[k])
      // 现在用的是哪个变量：改过的看改成了什么，没改的看样式表里怎么写的
      const varOf = (k) => { const m = VAR_ONLY.exec(String(cur(k) || '').trim()); return m ? m[1] : k in sty.live ? '' : (sty.vars || {})[k] || '' }
      const set = (props, v) => onSet(Object.fromEntries(props.map((p) => [p, v])))
      const chips = (kind, props) => (groups[kind] || []).slice(0, 10).map((tok) => h('button', {
        key: tok.name,
        className: 'chip' + (kind === 'color' ? ' c' : '') + (varOf(props[0]) === tok.name ? ' on' : ''),
        title: `${tok.name}: ${tok.value}`,
        onClick: () => set(props, `var(${tok.name})`),
      }, kind === 'color' ? h('i', { style: { background: tok.value } }) : tok.name.replace(/^--/, '')))
      const shown = (k, text) => (varOf(k) ? h('em', { className: 'v', title: t('styleVar', { name: varOf(k) }) }, varOf(k)) : h('em', null, text))
      const slider = (key, props, max, kind) => {
        const v = Math.round(pxOf(cur(props[0]), tokens) ?? 0)
        const c = kind ? chips(kind, props) : []
        return h('div', { className: 'row', key },
          h('label', null, h('span', null, t(key)), shown(props[0], `${v}px`)),
          h('input', { type: 'range', min: 0, max: Math.max(max, v), step: 1, value: v, 'aria-label': t(key), onChange: (e) => set(props, `${e.target.value}px`) }),
          c.length ? h('div', { className: 'chips' }, ...c) : null)
      }
      const color = (key, prop, note) => h('div', { className: 'row', key },
        h('label', null, h('span', null, t(key)), shown(prop, showVal(prop, cur(prop), t))),
        h('div', { className: 'chips' },
          h('input', { type: 'color', value: colorHex(cur(prop), tokens), 'aria-label': t(key), onChange: (e) => set([prop], e.target.value) }),
          ...chips('color', [prop])),
        note ? h('div', { className: 'note' }, note) : null)
      const w = Math.min(700, Math.max(400, Math.round(parseInt(cur('font-weight'), 10) / 100) * 100 || 400))
      const n = Object.keys(sty.live).length
      return box(
        h('p', { className: 'who', title: sty.selector }, h('code', null, sty.name), sty.text ? ` · ${sty.text}` : ''),
        h('div', { className: 'bd' },
          slider('styleFont', ['font-size'], 72, 'size'),
          h('div', { className: 'row', key: 'w' },
            h('label', null, h('span', null, t('styleWeight')), h('em', null, String(cur('font-weight')))),
            h('div', { className: 'seg' }, ...[400, 500, 600, 700].map((x) => h('button', { key: x, className: x === w ? 'on' : '', style: { fontWeight: x }, onClick: () => set(['font-weight'], String(x)) }, t('styleW' + x))))),
          color('styleColor', 'color'),
          color('styleBg', 'background', sty.gradient && !('background' in sty.live) ? t('styleGradient') : ''),
          slider('styleRadius', ['border-radius'], 40, 'radius'),
          slider('stylePadY', ['padding-top', 'padding-bottom'], 48, 'space'),
          slider('stylePadX', ['padding-left', 'padding-right'], 48, 'space'),
          sty.layout ? slider('styleGap', ['gap'], 48, 'space') : null),
        n ? h('div', { className: 'cnt' }, t('styleN', { n: styleChanges(t, sty).length })) : null,
        h('footer', { className: 'row' },
          h('button', { onClick: onReset, disabled: !n }, h('span', null, t('styleReset'))),
          h('button', { onClick: onAsk, disabled: !n, title: t('styleAskTip') }, h('span', null, t('styleAsk'))),
          h('button', { className: 'go', onClick: onSave, disabled: !n || !write.ok, title: write.tip }, h('span', null, t('styleSave')))))
    }

    /** 一排风格卡：每张是个小样（底色、标题字、卡片、主色按钮），点了交给 onPick */
    function StyleCards({ t, onPick }) {
      const en = t('lang') === 'en'
      return h('div', { className: 'ddp-styles' }, ...STYLES.map((x) => h('button', { key: x.id, className: 'ddp-sc', title: en ? x.den : x.dzh, onClick: () => onPick(x) },
        h('span', { className: 'pv', style: { background: x.c.bg, backgroundImage: x.bgImage || 'none', color: x.c.text } },
          h('b', { style: { fontFamily: x.head, fontWeight: x.w } }, en ? 'Aa' : '字'),
          h('i', { className: 'bt', style: { background: x.c.primary, borderRadius: Math.min(x.radius, 6), boxShadow: x.id === 'playful' ? `1.5px 1.5px 0 ${x.c.line}` : 'none', outline: x.id === 'playful' ? `1px solid ${x.c.line}` : 'none' } }),
          h('i', { className: 'cd', style: { background: x.id === 'glass' ? 'rgba(255,255,255,.6)' : x.c.surface, borderRadius: Math.min(x.radius, 8) / 2 + 2,
            boxShadow: x.id === 'soft' ? '2px 2px 5px #C8CED6, -2px -2px 5px #FFFFFF' : x.id === 'playful' ? `2px 2px 0 ${x.c.line}` : x.id === 'editorial' ? `inset 0 1px 0 ${x.c.line}` : `0 0 0 .5px ${x.c.line}` } },
            h('i', { className: 'ln', style: { background: x.c.text } }), h('i', { className: 'ln s', style: { background: x.c.muted } }))),
        h('span', { className: 'nm' }, en ? x.en : x.zh))))
    }

    /** 换风格面板（设计已经打开时）：点一张卡让模型整套换成那个风格 */
    function StylesPanel({ t, onPick, onClose }) {
      return h('div', { className: 'ddp-tokens', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.palette), h('b', null, t('stylesTitle')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        h('p', { className: 'tip' }, t('stylesSwap')),
        h('div', { className: 'bd' }, h(StyleCards, { t, onPick })))
    }

    // ── 调节滑块、品牌设计系统、转成代码 ─────────────────────────────────────

    /** 滑块的值 → 写到页面上的样子（和服务端 tweaks.js 的 cssValue 一样） */
    const tweakCss = (k, v) => (k.kind === 'range' ? `${v}${k.unit || ''}` : String(v))
    const tweakShown = (k, v) => (k.kind === 'choice' ? ((k.options || []).find((o) => o.value === String(v)) || { label: v }).label : tweakCss(k, v))
    const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

    /** 拖过的滑块（id → 值）→ 发给页面的 { vars, attrs }；没拖过的不发（页面用文件里的） */
    function tweakMsg(list, live) {
      const vars = {}
      const attrs = {}
      for (const k of list) {
        if (!hasOwn(live, k.id)) continue
        if (k.var) vars[k.var] = tweakCss(k, live[k.id])
        else if (k.attr) attrs[k.attr] = String(live[k.id])
      }
      return { vars, attrs }
    }

    /** 拖过的滑块 → 交给模型的一段字 */
    function formatTweaks(t, list, live) {
      const rows = list.filter((k) => hasOwn(live, k.id)).map((k) => `- ${k.label}：${tweakShown(k, k.value)} → ${tweakShown(k, live[k.id])}（${k.var || k.attr}）`)
      return t('twAskHead') + '\n' + rows.join('\n') + '\n'
    }

    /** 调节滑块面板：模型给这套设计做的几个维度（tweaks.json），拖的时候所有屏一起变，定下来写回文件或交给模型 */
    function TweaksPanel({ t, tw, live, write, onSet, onReset, onAsk, onSave, onMake, onClose }) {
      const head = h('header', null, h(I.dial), h('b', null, t('tweaks')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close)))
      const box = (...kids) => h('div', { className: 'ddp-tokens ddp-style ddp-tw', onPointerDown: (e) => e.stopPropagation() }, head, ...kids)
      const list = (tw && tw.list) || []
      const errs = (tw && tw.errors) || []
      if (!list.length) {
        return box(h('div', { className: 'bd' }, h('div', { className: 'none' },
          errs.length ? errs.map((e, i) => h('div', { key: i }, e)) : t('twEmpty'),
          h('div', null, h('button', { className: 'ddp-go', onClick: () => onMake(errs) }, t(errs.length ? 'twFix' : 'twMake'))))))
      }
      const cur = (k) => (hasOwn(live, k.id) ? live[k.id] : k.value)
      const row = (k) => {
        const v = cur(k)
        const lab = h('label', null, h('span', { title: k.var || k.attr }, k.label), h('em', { className: hasOwn(live, k.id) ? 'v' : '' }, tweakShown(k, v)))
        const note = k.note ? h('div', { className: 'note' }, k.note) : null
        if (k.kind === 'range') {
          return h('div', { className: 'row', key: k.id }, lab,
            h('input', { type: 'range', min: k.min, max: k.max, step: k.step, value: v, 'aria-label': k.label, onChange: (e) => onSet(k, Number(e.target.value)) }), note)
        }
        if (k.kind === 'color') {
          return h('div', { className: 'row', key: k.id }, lab,
            h('div', { className: 'chips' }, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000', 'aria-label': k.label, onChange: (e) => onSet(k, e.target.value) })), note)
        }
        return h('div', { className: 'row', key: k.id }, lab,
          h('div', { className: 'seg' }, ...(k.options || []).map((o) => h('button', { key: o.value, className: String(v) === o.value ? 'on' : '', onClick: () => onSet(k, o.value) }, o.label))), note)
      }
      const n = list.filter((k) => hasOwn(live, k.id)).length
      return box(
        h('p', { className: 'tip' }, t('twTip')),
        h('div', { className: 'bd' }, ...list.map(row), errs.length ? h('div', { className: 'note', key: 'err' }, errs.join('；')) : null),
        h('footer', { className: 'row' },
          h('button', { onClick: onReset, disabled: !n }, h('span', null, t('styleReset'))),
          h('button', { onClick: onAsk, disabled: !n, title: t('twAskTip') }, h('span', null, t('styleAsk'))),
          h('button', { className: 'go', onClick: onSave, disabled: !n || !write.ok, title: write.tip }, h('span', null, t('styleSave')))))
    }

    async function getJson(path) {
      const r = await fetch(API + path, { credentials: 'same-origin' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    }

    /** 品牌设计系统库：从用户的网站 / 项目提取的几套，默认那套以后做新设计都照它来。rev 变了（模型干完一轮）重新列 */
    function SystemsPanel({ t, rev, hasDesign, onExtract, onApply, onSay, onClose }) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const [src, setSrc] = useState('')
      useEffect(() => {
        let alive = true
        getJson('systems').then((d) => { if (alive) { setData(d); setErr('') } }, (e) => { if (alive) setErr(e.message) })
        return () => { alive = false }
      }, [rev])
      const setDef = (x, on) => post('systems', { id: x.id, default: on }).then((d) => { setData(d); onSay(on ? t('sysSetOk', { name: x.name }) : t('sysUnsetOk')) }, (e) => setErr(e.message))
      const list = (data && data.systems) || []
      const go = (e) => {
        e.preventDefault()
        const v = src.trim()
        if (!v) return
        onExtract(v)
        setSrc('')
      }
      return h('div', { className: 'ddp-tokens ddp-sys', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.library), h('b', null, t('systems')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        h('p', { className: 'tip' }, t('sysTip')),
        h('div', { className: 'bd' },
          err ? h('div', { className: 'none' }, err) : null,
          data && !list.length ? h('div', { className: 'none' }, t('sysEmpty')) : null,
          ...list.map((x) => h('div', { key: x.id, className: 'ddp-sysc' + (x.default ? ' def' : '') },
            x.preview ? h('img', { src: `${API}systhumb?id=${encodeURIComponent(x.id)}&v=${x.createdAt || 0}`, alt: '', loading: 'lazy' }) : null,
            h('div', { className: 'nm' }, h('b', { title: x.dir }, x.name), x.default ? h('span', null, t('sysDefault')) : null),
            h('div', { className: 'sw' }, ...Object.entries(x.colors || {}).slice(0, 7).map(([k, v]) => h('i', { key: k, title: `${k} ${v}`, style: { background: v } })), x.font ? h('em', null, x.font) : null),
            x.sources && x.sources.length ? h('small', { title: x.sources.join('\n') }, x.sources[0]) : null,
            h('div', { className: 'acts' },
              h('button', { onClick: () => setDef(x, !x.default) }, x.default ? t('sysUnset') : t('sysSet')),
              hasDesign ? h('button', { onClick: () => onApply(x) }, t('sysApply')) : null)))),
        h('footer', null,
          h('form', { onSubmit: go },
            h('input', { value: src, placeholder: t('sysPh'), 'aria-label': t('sysPh'), onChange: (e) => setSrc(e.target.value) }),
            h('button', { type: 'submit', disabled: !src.trim() }, t('sysExtract')))))
    }

    const FW_LIST = ['react', 'vue', 'next', 'html']
    const FW_LABEL = { react: 'React + Vite', vue: 'Vue 3 + Vite', next: 'Next.js' }

    /** 转成代码：用什么做、放哪、转几屏；点了把一段话放进输入框，模型调 handoff_design 照交接包做，每屏做完 compare_design */
    function HandoffPanel({ t, sid, root, fileTarget, count, cur, onGo, onClose }) {
      const [info, setInfo] = useState(null)
      const [fw, setFw] = useState('')
      const [dest, setDest] = useState('')
      const [one, setOne] = useState(false)
      // 换了会话或设计目录就重新问：先清掉旧的（别把上一套设计的目标发出去）
      useEffect(() => {
        let alive = true
        setInfo(null)
        setDest('')
        if (!root) return () => { alive = false }
        getJson(`project?session=${encodeURIComponent(sid)}`).then((d) => {
          if (!alive) return
          setInfo(d)
          setFw(d.project && d.project.pkg && d.project.framework ? 'same' : 'react')
          setDest(d.root === root ? d.dest || '' : '')
        }, () => { if (alive) setInfo({}) })
        return () => { alive = false }
      }, [sid, root])
      const head = h('header', null, h(I.code), h('b', null, t('handoff')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close)))
      const box = (...kids) => h('div', { className: 'ddp-tokens ddp-style ddp-ho', onPointerDown: (e) => e.stopPropagation() }, head, ...kids)
      if (!fileTarget) return box(h('div', { className: 'bd' }, h('div', { className: 'none' }, t('hoProxy'))))
      if (!info) return box(h('p', { className: 'tip' }, t('hoLoading')))
      const p = info.project || {}
      const same = p.pkg && p.framework
      const opts = [...(same ? [['same', t('hoSame', { label: p.label })]] : []), ...FW_LIST.map((k) => [k, k === 'html' ? t('hoHtml') : FW_LABEL[k]])]
      const label = (opts.find(([k]) => k === fw) || ['', ''])[1]
      return box(
        h('p', { className: 'tip' }, t('hoTip')),
        h('div', { className: 'bd' },
          h('div', { className: 'row' }, h('label', null, t('hoFw')),
            ...opts.map(([k, l]) => h('button', { key: k, className: 'opt' + (fw === k ? ' on' : ''), onClick: () => setFw(k) }, h('i'), h('span', null, l)))),
          h('div', { className: 'row' }, h('label', null, t('hoDest')),
            h('input', { type: 'text', value: dest, spellCheck: false, 'aria-label': t('hoDest'), onChange: (e) => setDest(e.target.value) })),
          count > 1 && cur ? h('div', { className: 'row' }, h('label', null, t('hoScope')),
            h('div', { className: 'seg' },
              h('button', { className: one ? '' : 'on', onClick: () => setOne(false) }, t('hoAll', { n: count })),
              h('button', { className: one ? 'on' : '', onClick: () => setOne(true) }, t('hoOne')))) : null),
        h('footer', null,
          h('button', { className: 'go', disabled: !fw || !dest.trim(), onClick: () => onGo({ fw, label, dest: dest.trim(), only: one && count > 1 ? cur : '' }) }, h(I.code), h('span', null, t('hoGo')))))
    }

    /** 菜单开着时：点外面、按 Esc 关掉 */
    function useDismiss(open, setOpen, ref) {
      useEffect(() => {
        if (!open) return undefined
        const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', off, true)
        window.addEventListener('keydown', esc)
        return () => {
          document.removeEventListener('pointerdown', off, true)
          window.removeEventListener('keydown', esc)
        }
      }, [open])
    }

    /** 导出菜单：这一屏（带外框 / 纯画面 / 整页长图）、整套展示图 */
    function ExportMenu({ t, kind, count, open, setOpen, onPick, disabled }) {
      const ref = useRef(null)
      useDismiss(open, setOpen, ref)
      const items = []
      if (FRAMED[kind]) items.push(['frame', I.single, t('exFrame')])
      items.push(['raw', I.image, t('exRaw')])
      if (kind !== 'poster' && kind !== 'slides') items.push(['long', I.long, t('exLong')]) // 海报、幻灯片画幅是定的，没有「整页」
      if (count > 1) items.push(['show', I.canvas, t('exShow')])
      items.push(['pdf', I.pdf, t('exPdf')], ['pptx', I.deck, t('exPptx')])
      return h('div', { className: 'ddp-kind', ref },
        h('button', { className: 'ddp-btn' + (open ? ' sel' : ''), title: t('exportT'), disabled, onClick: () => setOpen(!open) }, h(I.download)),
        open ? h('div', { className: 'ddp-menu', role: 'menu' },
          h('div', { className: 'hd' }, t('exportT')),
          ...items.map(([mode, Icon, label]) => h('button', { key: mode, role: 'menuitem', onClick: () => onPick(mode) }, h(Icon), h('span', null, label))),
          h('div', { className: 'ft' }, t('exWhere'))) : null)
    }

    /**
     * 「更多」：右侧栏窄的时候，工具栏上放不下的几个按钮收进这里（哪几个收起来由容器宽度的 CSS 决定）。
     * items: [显示档 'o1' | 'o2', 图标, 名字, 选中, 不可用, 点了做什么（字符串就是在浏览器里打开的地址）]
     */
    function MoreMenu({ t, open, setOpen, has, items }) {
      const ref = useRef(null)
      useDismiss(open, setOpen, ref)
      return h('div', { className: 'ddp-kind ddp-more', ref },
        h('button', { className: 'ddp-btn' + (open ? ' sel' : '') + (has ? ' has' : ''), title: t('more'), onClick: () => setOpen(!open) }, h(I.more)),
        open ? h('div', { className: 'ddp-menu', role: 'menu' },
          ...items.filter(Boolean).map(([tier, Icon, label, on, off, run]) => (typeof run === 'string'
            ? h('a', { key: label, className: tier, role: 'menuitem', href: run, target: '_blank', rel: 'noopener noreferrer', onClick: () => setOpen(false) }, h(Icon), h('span', null, label))
            : h('button', { key: label, className: tier + (on ? ' sel' : ''), role: 'menuitem', disabled: off, onClick: () => { setOpen(false); run() } }, h(Icon), h('span', null, label))))) : null)
    }

    /** 二维码矩阵（一行一串 0 / 1）→ SVG（四周留 4 格白边） */
    function QrCode({ rows }) {
      const n = rows.length
      let d = ''
      rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '1') d += `M${x + 4} ${y + 4}h1v1h-1z` })
      return h('svg', { viewBox: `0 0 ${n + 8} ${n + 8}`, shapeRendering: 'crispEdges', role: 'img', 'aria-label': 'QR' }, h('path', { d, fill: '#000' }))
    }

    /** 手机上看：打开就开局域网入口，给二维码；手机打开了显示一下 */
    function PhonePanel({ t, sid, path, seen, onCopy, onStop, onClose }) {
      const [res, setRes] = useState(null)
      const [err, setErr] = useState('')
      // 换了一屏：重新要一次（入口沿用），二维码和链接跟着指到现在这一屏
      useEffect(() => {
        let alive = true
        post('phone', { session: sid, on: true, path }).then((d) => { if (alive) { setRes(d); setErr('') } }).catch((e) => { if (alive) setErr(e.message) })
        return () => { alive = false }
      }, [sid, path])
      let bd
      if (err) bd = h('p', null, t('phoneFail', { msg: err }))
      else if (!res) bd = h('p', null, t('phoneStarting'))
      else if (!res.on) bd = h('p', null, res.error === 'no-lan' ? t('phoneNoLan') : t('phoneFail', { msg: res.message || res.error || '' }))
      else {
        bd = [
          h('div', { key: 'qr', className: 'qr' }, h(QrCode, { rows: res.qr || [] })),
          h('b', { key: 'how', className: 'how' }, t('phoneHow')),
          h('p', { key: 'wifi' }, t('phoneWifi')),
          seen ? h('span', { key: 'st', className: 'st ok' }, h(I.check), t('phoneSeen')) : h('span', { key: 'st', className: 'st' }, h('i'), t('phoneWait')),
          h('p', { key: 'fl', className: 'fine' }, t('phoneFollow')),
          h('div', { key: 'row', className: 'row' },
            h('button', { className: 'ddp-go', onClick: () => onCopy(res.url) }, t('phoneCopy')),
            h('button', { className: 'ddp-go', onClick: onStop }, t('phoneStop'))),
          h('p', { key: 'auto', className: 'fine' }, t('phoneAuto')),
          seen ? null : h('p', { key: 'help', className: 'fine' }, t('phoneHelp')),
        ]
      }
      return h('div', { className: 'ddp-tokens ddp-phone', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.scan), h('b', null, t('phone')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        h('div', { className: 'bd' }, bd))
    }

    /** 版本面板：现在 + 存过的几版（新的在前），点一版看当时的样子 */
    function HistoryPanel({ t, versions, ver, onPick, onClose }) {
      const files = (list) => {
        const names = list.map((f) => f.split('/').pop())
        return names.length <= 2 ? names.join(t('sep')) : t('vMore', { first: names.slice(0, 2).join(t('sep')), n: names.length, rest: names.length - 2 })
      }
      const labelOf = (v) => (v.label === '回退前' ? t('vSaved') : v.label || t('vBefore'))
      return h('div', { className: 'ddp-tokens ddp-hist', onPointerDown: (e) => e.stopPropagation() },
        h('header', null, h(I.history), h('b', null, t('history')), h('button', { className: 'ddp-btn', title: '×', onClick: onClose }, h(I.close))),
        h('p', { className: 'tip' }, t('histTip')),
        h('div', { className: 'bd' },
          h('button', { className: 'ddp-ver' + (!ver ? ' sel' : ''), onClick: () => onPick(null) },
            h('b', null, h('i', { className: 'live' }), t('now'))),
          versions.length
            ? versions.map((v) => h('button', { key: v.n, className: 'ddp-ver' + (ver && ver.n === v.n ? ' sel' : ''), onClick: () => onPick(v) },
              h('b', null, t('vN', { n: v.n }), h('em', null, hhmm(v.at))),
              h('span', null, labelOf(v)),
              v.changed && v.changed.length ? h('small', null, t('vChanged', { files: files(v.changed) }))
                : v.first ? h('small', null, t('vFirst', { n: v.count })) : null))
            : h('div', { className: 'none' }, t('histEmpty'))))
    }

    /**
     * 画布：几屏排成网格，能拖、能缩放（触控板双指滑 = 平移，捏合 / ⌘ 滚轮 = 缩放）。
     * 平时每屏上盖一层「挡板」：点一下选中，双击只看这一屏；选取时拿掉挡板，直接在页面里点。
     */
    function Canvas(props) {
      const { t, screens, kind, size, ghost, picking, sel, labelOf } = props
      const ref = useRef(null)
      const [box, setBox] = useState({ w: 0, h: 0 })
      const [cam, setCam] = useState(null)
      const [anim, setAnim] = useState(false)
      const [drag, setDrag] = useState(false)
      const auto = useRef(true)
      const camRef = useRef(cam)
      camRef.current = cam
      const lastTap = useRef({ key: '', at: 0 })
      const f = FRAME[kind] || FRAME.web
      const [dw, dh] = deviceBox(kind, size)
      const n = screens.length + (ghost ? 1 : 0)
      // 多尺寸：每块自己的类型和大小（items[i] = { kind, size }）
      const items = props.items || null
      const boxes = items ? items.map((it) => deviceBox(it.kind, it.size)) : null
      const L = box.w > 0 && box.h > 0 ? (boxes ? layoutRow(boxes, box.w, box.h) : layoutGrid(n, dw, dh, box.w, box.h)) : null
      const layoutKey = L ? [n, L.cols, dw, dh, box.w, box.h, boxes ? boxes.join(';') : ''].join('|') : ''

      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
      }, [])

      // 屏数 / 类型 / 舞台大小变了：用户没自己动过镜头就重新摆好
      useEffect(() => {
        if (!L) return
        if (auto.current || !camRef.current) {
          setAnim(!!camRef.current)
          setCam(fitCam(L, box.w, box.h))
        }
      }, [layoutKey])

      // 让某一屏露出来（体检里点了一条）：整屏不在看得见的地方就把镜头挪过去；右边 inset 像素被面板挡着
      const rv = props.reveal
      useEffect(() => {
        const c = camRef.current
        if (!rv || !L || !c) return
        const i = screens.findIndex((x) => x.key === rv.key)
        if (i < 0) return
        const [cw, ch] = boxes ? boxes[i] : [dw, dh]
        const vw = Math.max(120, box.w - (props.inset || 0))
        const x0 = c.x + L.pos[i].x * c.z
        const y0 = c.y + L.pos[i].y * c.z
        const w = cw * c.z
        const hh = ch * c.z
        let x = c.x
        let y = c.y
        if (x0 < 8 || x0 + w > vw - 8) x += (w > vw - 16 ? 8 : (vw - w) / 2) - x0
        if (y0 < LAB || y0 + hh > box.h - 8) y += (hh > box.h - LAB - 8 ? LAB : (box.h - hh) / 2) - y0
        if (x === c.x && y === c.y) return
        auto.current = false
        setAnim(true)
        setCam({ ...c, x, y })
      }, [rv && rv.n])

      const zoomAt = (factor, px, py, smooth) => {
        const c = camRef.current
        if (!c) return
        const z = clampZ(c.z * factor)
        auto.current = false
        setAnim(!!smooth)
        setCam({ z, x: px - ((px - c.x) * z) / c.z, y: py - ((py - c.y) * z) / c.z })
      }

      useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const onWheel = (e) => {
          e.preventDefault()
          const c = camRef.current
          if (!c) return
          if (e.ctrlKey || e.metaKey) {
            const r = el.getBoundingClientRect()
            zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top, false)
          } else {
            auto.current = false
            setAnim(false)
            setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })
          }
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [])

      // 拖背景 / 挡板 = 平移；没拖动就算点了一下
      const onPointerDown = (e) => {
        if (e.button !== 0 || !camRef.current) return
        if (e.target.closest && e.target.closest('.ddp-zoom, .ddp-act')) return
        const keyEl = e.target.closest ? e.target.closest('[data-key]') : null
        const d = { x: e.clientX, y: e.clientY, cam: camRef.current, moved: false, key: keyEl ? keyEl.getAttribute('data-key') : '' }
        const move = (ev) => {
          const dx = ev.clientX - d.x
          const dy = ev.clientY - d.y
          if (!d.moved && Math.hypot(dx, dy) < 4) return
          if (!d.moved) {
            d.moved = true
            auto.current = false
            setAnim(false)
            setDrag(true)
          }
          setCam({ ...d.cam, x: d.cam.x + dx, y: d.cam.y + dy })
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          setDrag(false)
          if (d.moved) return
          if (props.onSelect) props.onSelect(d.key)
          const now = Date.now()
          if (d.key && props.onOpen && lastTap.current.key === d.key && now - lastTap.current.at < 380) props.onOpen(d.key)
          lastTap.current = { key: d.key, at: now }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const center = (factor) => zoomAt(factor, box.w / 2, box.h / 2, true)
      const fit = () => {
        if (!L) return
        auto.current = true
        setAnim(true)
        setCam(fitCam(L, box.w, box.h))
      }

      const z = cam ? cam.z : 1
      let grid = 24 * z
      while (grid < 12) grid *= 2
      while (grid > 48) grid /= 2
      const lab = (key, body, w = dw) => h('div', { className: 'ddp-lab', 'data-key': key, style: { width: w * z, transform: `scale(${1 / z})` } }, ...body)
      const cells = []
      if (cam && L) {
        screens.forEach((sc, i) => {
          const on = sel === sc.key
          const [cw, ch] = boxes ? boxes[i] : [dw, dh]
          const fr = items ? FRAME[items[i].kind] || FRAME.web : f
          cells.push(h('div', {
            key: sc.id || sc.key,
            className: 'ddp-cell' + (on ? ' sel' : ''),
            style: { left: L.pos[i].x, top: L.pos[i].y, width: cw, height: ch },
          },
          lab(sc.key, [h('span', { key: 's' }, labelOf(sc)), on && !picking && props.actions ? h('span', { key: 'a', className: 'ddp-act' }, ...props.actions(sc)) : null], cw),
          props.render(sc, z, i),
          picking ? null : h('div', { className: 'ddp-shield', 'data-key': sc.key, title: items ? '' : t('openScreen'), style: { borderRadius: fr.r } })))
        })
        if (ghost) {
          const p = L.pos[n - 1]
          cells.push(h('div', { key: '__ghost', className: 'ddp-cell ghost', style: { left: p.x, top: p.y, width: dw, height: dh } },
            lab('', [h('i', { key: 'i', className: 'sp' }), h('span', { key: 's' }, t('generating'))]),
            h(Device, { kind, w: size[0], h: size[1], label: '' }, h(Skeleton, {}))))
        }
      }
      let flowSvg = null
      if (cam && L && props.flows && props.flows.length && !picking) {
        const lines = flowLines(props.flows, screens.map((x) => x.key), L.pos, kind, size, { lift: LAB / z }).filter((ln) => !sel || ln.from === sel || ln.to === sel)
        if (lines.length) {
          const sw = 2 / z
          const a = 9 / z
          flowSvg = h('svg', { key: '__flows', className: 'ddp-flows', width: 1, height: 1 },
            ...lines.map((ln, i) => h('g', { key: i, className: ln.from === sel ? '' : 'dim' },
              h('path', { d: ln.d, strokeWidth: sw }),
              h('path', { className: 'hd', d: `M${ln.ex} ${ln.ey}l${-a * ln.tip} ${-a * 0.62}v${a * 1.24}z` }),
              h('circle', { cx: ln.sx, cy: ln.sy, r: 4.5 / z, strokeWidth: 1.5 / z }))))
        }
      }
      return h('div', {
        className: 'ddp-canvas' + (drag ? ' drag' : ''),
        ref,
        onPointerDown,
        style: cam ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${cam.x}px ${cam.y}px` } : undefined,
      },
      cam && L ? h('div', {
        className: 'ddp-world' + (anim ? ' anim' : ''),
        style: { transform: `translate(${cam.x}px, ${cam.y}px) scale(${z})`, '--z': z },
      }, ...cells, flowSvg) : null,
      h('div', { className: 'ddp-zoom' },
        h('button', { className: 'ddp-btn', title: t('zoomOut'), onClick: () => center(1 / 1.25) }, h(I.minus)),
        h('b', null, Math.round(z * 100) + '%'),
        h('button', { className: 'ddp-btn', title: t('zoomIn'), onClick: () => center(1.25) }, h(I.plus)),
        h('button', { className: 'ddp-btn', title: t('fit'), onClick: fit }, h(I.fit))))
    }

    // ── 右侧栏标签页 ─────────────────────────────────────────────────────────

    function PreviewTab(props) {
      const t = props.t
      const sid = props.sid || props.sessionId
      const [st, poll] = usePreview(sid)
      // 刚打开（DSH 重启）时状态还没拿到、或服务端正在接着开上次的预览：先空着，别闪一下「还没有要预览的页面」；拿不到状态最多等 2.5 秒
      const [waited, setWaited] = useState(false)
      useEffect(() => { const tm = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(tm) }, [])
      const [picking, setPicking] = useState(false)
      const [textEdit, setTextEdit] = useState(false) // 改字：点页面里的文字直接改
      const [styleEdit, setStyleEdit] = useState(false) // 调样式：点元素、拖滑块，写回它的 style 属性
      const [sty, setSty] = useState(null) // 调样式选中的元素：{ key, url, name, selector, text, loc, base, vars, gradient, layout, live }
      const [editing, setEditing] = useState(false)
      const [menu, setMenu] = useState(false)
      const [toast, setToast] = useState('')
      const [flash, setFlash] = useState('')
      const [reloadSeq, setReloadSeq] = useState(0)
      const [info, setInfo] = useState({}) // 目录|屏 → { meta, title }（页面报上来的）
      const [sel, setSel] = useState('')
      const [panel, setPanel] = useState(false)
      const [styles, setStyles] = useState(false) // 换风格面板
      const [dropping, setDropping] = useState(false) // 正拖着图片进来
      const refInput = useRef(null)
      const [exMenu, setExMenu] = useState(false)
      const [more, setMore] = useState(false) // 窄的时候收起来的几个按钮
      const [hist, setHist] = useState(false) // 版本面板
      const [versions, setVersions] = useState([])
      const [ver, setVer] = useState(null) // 正在看的旧版本
      const [cmp, setCmp] = useState(false) // 和现在左右对比
      const [cx, setCx] = useState(50)
      const [cmpDrag, setCmpDrag] = useState(false)
      const [dark, setDark] = useState(false)
      const [phone, setPhone] = useState(false) // 手机上看的面板
      const [multi, setMulti] = useState(false) // 多尺寸并排
      const [ck, setCk] = useState(null) // 设计体检：null = 面板关着；{ running, list: [{ key, label, url, issues, error }] }
      const [ckCount, setCkCount] = useState(0) // 最近一次体检（模型干完活会悄悄查一次）有几个问题：面板关着时标在按钮上
      const [reveal, setReveal] = useState(null) // 画布上要露出来的那一屏 { key, n }（体检里点了一条）
      const [demo, setDemo] = useState(null) // 演示：{ stack: [屏…], layers: [{ id, key, dir, shown }] }
      const [pane, setPane] = useState('') // 右边的面板：tweaks 调节滑块、systems 品牌设计系统、handoff 转成代码
      const [tw, setTw] = useState({}) // 拖过的滑块：id → 值（还没写进文件）
      const apis = useRef(new Map()) // 屏 → 截图用的接口
      const cmpRef = useRef(null)
      const [box, setBox] = useState({ w: 0, h: 0 })
      const stageRef = useRef(null)
      const flashTimer = useRef(null)
      const toastTimer = useRef(null)
      const stRef = useRef(st)
      stRef.current = st
      const url = st && st.url ? st.url : ''
      const origin = url ? new URL(url).origin : ''
      // 预览的是哪个目录 / 哪个开发服务器：预览服务器被关掉重开、端口变了也还是同一个（不当成换了页面，不重播动画、不退出演示）
      const tg = st && st.target
      const site = tg ? (tg.kind === 'file' ? 'file:' + String(tg.file || '').replace(/[\\/][^\\/]*$/, '') : 'proxy:' + tg.port) : origin
      const busy = !!(st && st.turn)
      const screens = (st && st.screens) || []

      // 哪几屏是「刚生成的」：第一次看到它时模型正在干活 → 第一次显示时播生成动画（播过就不再播）
      // 这一轮开始时已有的屏记下来：这轮里出了新的一屏，就在画布末尾留个「生成中…」等下一屏；
      // 一阵子（GHOST_MS）没再出新屏多半是在改了，占位撤掉；正在写一个还没有的 HTML 时一定留着
      const marks = useRef({ site: '', born: new Map(), built: new Set(), turnKeys: null, lastNew: 0 })
      const M = marks.current
      if (M.site !== site) {
        M.site = site
        M.born = new Map()
        M.built = new Set()
        M.turnKeys = null
        M.lastNew = 0
      }
      if (!busy) M.turnKeys = null
      else if (!M.turnKeys) M.turnKeys = new Set(screens.map((s) => s.key))
      for (const sc of screens) {
        if (M.born.has(sc.key)) continue
        M.born.set(sc.key, busy)
        if (busy) M.lastNew = Date.now()
      }
      const isBorn = (key) => !!M.born.get(key) && !M.built.has(key)

      const infoOf = (key) => info[site + '|' + key] || null
      const ik = (sc) => (sc.v ? 'v' + sc.v + '|' : '') + sc.key // 旧版本的屏单独记标题
      const focus = (st && st.focus) || ''
      const main = infoOf(focus) || (screens[0] && infoOf(screens[0].key)) || {}
      const meta = parseMeta(main.meta || '')
      const tokens = main.tokens || []
      const kind = (st && st.kind) || meta.kind || 'web'
      const size = sizeOf((st && st.size) || meta.size, kind)
      const view = (st && st.view) || (screens.length >= 2 && screens.length <= 12 ? 'canvas' : 'single')
      const canvas = view === 'canvas'
      const writingNew = !!(st && st.writing) && /\.html?$/i.test(st.writing) && !screens.some((s) => s.key === st.writing)
      const fresh = !!M.turnKeys && screens.some((s) => !M.turnKeys.has(s.key)) && Date.now() - M.lastNew < GHOST_MS
      const ghost = canvas && busy && !ver && (writingNew || fresh)
      const [, setTick] = useState(0)
      useEffect(() => {
        if (!fresh || writingNew) return
        const id = setTimeout(() => setTick((n) => n + 1), Math.max(0, M.lastNew + GHOST_MS - Date.now()) + 50)
        return () => clearTimeout(id)
      }, [fresh, writingNew, M.lastNew])
      const labelOf = (sc) => (infoOf(ik(sc)) || {}).title || sc.label
      const anyDark = Object.keys(info).some((k) => k.startsWith(site + '|') && info[k].dark)
      const fileTarget = !!(st && st.target && st.target.kind === 'file')
      // 远程看（手机走外网等）：本地文件的预览由服务端打包传过来（见 Screen），目录里改了哪些文件也一起带过去
      const remote = fileTarget && sid ? { sid, at: st.changedAt || 0, files: st.changedFiles || [], changes: st.changes || [] } : null

      // 调节滑块：tweaks.json 改了（写回了、模型改了）就把和文件一样的值放掉；换了设计全放掉
      const tweaks = (fileTarget && st.tweaks) || null
      const tlist = (tweaks && tweaks.list) || []
      const tsig = JSON.stringify(tlist.map((k) => [k.id, k.value]))
      useEffect(() => {
        setTw((c) => {
          const out = {}
          for (const [id, v] of Object.entries(c)) { const k = tlist.find((x) => x.id === id); if (k && String(k.value) !== String(v)) out[id] = v }
          return Object.keys(out).length === Object.keys(c).length ? c : out
        })
      }, [tsig])
      useEffect(() => { setTw({}) }, [site])
      const tweak = Object.keys(tw).length ? tweakMsg(tlist, tw) : null

      // 看旧版本：画布上换成那一版的几屏（按现在的顺序，那一版独有的接在后面）
      const vbase = ver ? `${origin}/__dsh_design__/v/${ver.n}/` : ''
      const shown = ver
        ? [...screens.map((x) => x.key).filter((k) => ver.screens.includes(k)), ...ver.screens.filter((k) => !screens.some((x) => x.key === k))]
          .map((key) => ({ key, id: `v${ver.n}|${key}`, v: ver.n, url: vbase + encodeURIComponent(key), label: key.replace(/\.html?$/i, '') }))
        : screens

      // 手机上看：现在这一屏在预览服务器上的路径；手机开着时，电脑上换屏手机跟着跳
      const phoneOn = !!(st && st.phone && st.phone.on)
      const demoKey = demo ? demo.layers[demo.layers.length - 1].key : ''
      const urlOfKey = (key) => {
        const sc = screens.find((x) => x.key === key)
        if (sc) return sc.url
        return fileTarget ? `${origin}/${key.split('/').map(encodeURIComponent).join('/')}` : origin + key
      }
      const curScreen = demo ? { key: demoKey, url: urlOfKey(demoKey) } : screens.find((x) => x.key === (canvas ? sel || focus : focus)) || screens[0]
      let curPath = '/'
      try { if (curScreen) { const u = new URL(curScreen.url); curPath = u.pathname + u.search } } catch { /* 地址不对 */ }
      const lastFollow = useRef('')
      useEffect(() => {
        if (!phoneOn || ver) { lastFollow.current = ''; return }
        if (lastFollow.current === curPath) return
        const first = !lastFollow.current
        lastFollow.current = curPath
        if (!first) post('phone', { session: sid, follow: curPath }).catch(() => {})
      }, [phoneOn, curPath, ver])

      const say = (text, act) => {
        setToast({ text, act: act || null })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), act ? 6000 : 2600)
      }

      const showFlash = (text) => {
        setFlash(text)
        clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(''), 2800)
      }

      const note = (n, sc) => {
        const changes = n.changes
        const name = n.file ? ' ' + String(n.file).split(/[\\/]/).pop() : canvas && sc ? ' ' + labelOf(sc) : ''
        showFlash(changes && changes.whole
          ? t('updatedWhole', { file: name })
          : changes && changes.count ? t('updatedN', { file: name, n: changes.count }) : t('updated', { file: name }))
      }

      const onBuilt = (sc, title) => {
        M.built.add(sc.key)
        showFlash(t('born', { name: title || labelOf(sc) }))
      }

      const remember = (key, m, title, toks, dk, links) => {
        const k = site + '|' + key
        const sig = JSON.stringify([toks || [], links || []])
        setInfo((cur) => (cur[k] && cur[k].meta === m && cur[k].title === title && cur[k].sig === sig && cur[k].dark === dk ? cur
          : { ...cur, [k]: { meta: m, title, tokens: toks || [], links: links || [], sig, dark: dk } }))
      }

      const rememberLinks = (key, links) => {
        const k = site + '|' + key
        setInfo((cur) => {
          const c = cur[k]
          if (!c) return cur
          const sig = JSON.stringify([c.tokens || [], links || []])
          return c.sig === sig ? cur : { ...cur, [k]: { ...c, links: links || [], sig } }
        })
      }

      /** 改设置（类型 / 视图 / 换一屏）：先在本地改了显示，再告诉服务端；换屏要等服务端给新地址 */
      const change = (patch) => {
        if (!patch.focus && poll && poll.state) poll.set({ ...poll.state, ...patch })
        post('view', { session: sid, ...patch }).then((s) => poll && poll.set(s), (e) => say(t('openFailed', { msg: e.message })))
      }

      // 量舞台大小，单页时按比例缩放
      useEffect(() => {
        const el = stageRef.current
        if (!el) return undefined
        const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
      }, [!!url])

      useEffect(() => { setPicking(false); setTextEdit(false); setStyleEdit(false); setSel(''); setVer(null); setCmp(false) }, [site])

      // 版本列表：面板开着时拉一次，存了新版本（vrev 变了）再拉
      const vrev = st ? st.vrev : 0
      useEffect(() => {
        if (!hist || !sid || !fileTarget) return undefined
        let dead = false
        fetch(`${API}history?session=${encodeURIComponent(sid)}`, { credentials: 'same-origin', cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => { if (!dead) setVersions(Array.isArray(d.versions) ? d.versions : []) }, () => {})
        return () => { dead = true }
      }, [hist, sid, vrev, origin])

      const insert = (text, done = 'inserted') => {
        const ia = props.inputActions
        try {
          if (ia && typeof ia.insertText === 'function') {
            const span = typeof ia.captureInsertion === 'function' ? ia.captureInsertion() : undefined
            // 光标前面已经有字（用户先打了要求）→ 另起一行，不和那句话粘在一起
            const lead = span && span.start > 0 ? '\n' : ''
            if (ia.insertText(lead + text, span)) return say(t(done))
          }
        } catch (e) {
          console.warn('[dsh-design-studio] insertText 失败', e)
        }
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => say(t('copied')), (e) => say(t('failed', { msg: e.message })))
        } else say(t('failed', { msg: 'no input' }))
      }

      const deliver = (payload, note) => {
        setPicking(false)
        insert(formatPick(payload, stRef.current) + (note || ''))
      }

      const togglePick = () => {
        if (picking) { setPicking(false); return }
        setTextEdit(false)
        setStyleEdit(false)
        setPicking(true)
        if (!canvas) {
          // 单页：把焦点给页面，Esc 在页面里也管用
          setTimeout(() => { try { const f = stageRef.current && stageRef.current.querySelector('.ddp-frame.cur'); f && f.focus() } catch { /* 用鼠标也行 */ } }, 0)
        }
      }

      // ── 改字：页面里改完一处，本地文件直接写回；开发服务器（或源码里找不到这段字）就交给模型 ──
      const toggleText = () => {
        if (textEdit) { setTextEdit(false); return }
        setPicking(false)
        setStyleEdit(false)
        setTextEdit(true)
      }

      const askText = (sc, d) => insert(t('textAsk', { before: d.before, after: d.after, where: whereOf(pageOf(sc, d.href).url, stRef.current) }), 'insertedSend')

      const onEdited = (sc, d) => {
        if (!fileTarget) return askText(sc, d)
        post('edit', { session: sid, key: pageOf(sc, d.href).key, before: d.before, after: d.after, nth: d.nth })
          .then((r) => (r && r.ok ? say(t('textSaved', { file: r.file })) : askText(sc, d)), () => askText(sc, d))
      }

      // 模型在干活时不能改字（它可能正整份重写文件，改了会被盖掉）
      useEffect(() => { if (ver || demo || busy) setTextEdit(false) }, [!!ver, !!demo, busy])

      // ── 调样式：点一个元素，面板里拖滑块先在页面上看效果；写回文件 = 并进它在源码里的 style 属性 ──
      const toggleStyle = () => {
        if (styleEdit) { setStyleEdit(false); return }
        setPicking(false)
        setTextEdit(false)
        setPanel(false)
        setStyles(false)
        setHist(false)
        setPhone(false)
        closeCheck()
        setStyleEdit(true)
      }
      useEffect(() => { if (!styleEdit) setSty(null) }, [styleEdit])
      const onStylePick = (sc, p) => {
        if (canvas) setSel(sc.key)
        const pg = pageOf(sc, p.href)
        setSty({ key: pg.key, url: pg.url, name: p.name, selector: p.selector, text: p.text, loc: p.loc, base: p.css || {}, vars: p.vars || {}, rules: p.rules && typeof p.rules === 'object' ? p.rules : {}, gradient: !!p.gradient, layout: !!p.layout, live: {} })
      }
      const setStyleProp = (patch) => setSty((c) => (c ? { ...c, live: { ...c.live, ...patch } } : c))
      // 交给模型：先问服务端那几条规则在源码第几行（本地文件才有；问不到就只写文件名）
      const askStyle = async () => {
        const s0 = sty
        if (!s0) return
        let located = null
        const items = [...new Map(Object.keys(s0.live || {}).map((k) => s0.rules && s0.rules[k]).filter((r) => r && r.sel && r.href).map((r) => [`${r.href}|${r.sel}|${r.n}`, r])).values()]
        if (fileTarget && items.length) {
          try {
            const r = await post('locate', { session: sid, items: items.map((x) => ({ href: x.href, sel: x.sel, n: x.n })) })
            located = new Map(items.map((x, i) => [`${x.href}|${x.sel}|${x.n}`, r && Array.isArray(r.items) ? r.items[i] : null]))
          } catch { /* 找不到行号就只写文件名 */ }
        }
        insert(formatStyleAsk(t, s0, stRef.current, located), 'insertedSend')
      }
      const saveStyle = () => {
        const s0 = sty
        if (!s0 || !Object.keys(s0.live).length) return
        if (!fileTarget) return askStyle()
        const saved = s0.live
        post('style', { session: sid, key: s0.key, loc: s0.loc, css: saved, name: s0.name }).then((r) => {
          if (r && r.ok) {
            say(t('styleSaved', { file: r.file }))
            // 写进去的算「原样」了；写的时候又拖过的留着
            setSty((c) => (c && c.key === s0.key && c.selector === s0.selector
              ? { ...c, base: { ...c.base, ...saved }, live: Object.fromEntries(Object.entries(c.live).filter(([k, v]) => saved[k] !== v)) } : c))
          } else if (r && r.reason === 'busy') say(t('styleBusyTip'))
          else { say(t('styleMiss')); askStyle() }
        }, () => askStyle())
      }
      useEffect(() => {
        if (!styleEdit) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setStyleEdit(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [styleEdit])

      useEffect(() => {
        if (!dropping) return undefined
        const off = () => setDropping(false)
        window.addEventListener('dragend', off, true)
        window.addEventListener('drop', off, true)
        return () => { window.removeEventListener('dragend', off, true); window.removeEventListener('drop', off, true) }
      }, [dropping])

      useEffect(() => {
        if (!textEdit) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setTextEdit(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [textEdit])

      useEffect(() => {
        if (!picking) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setPicking(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [picking])

      // ── 演示：点页面里的按钮跳到别的屏，前进从右边滑进来、返回从左边 ──
      const demoSeq = useRef(0)
      const startDemo = () => {
        const k = canvas ? sel || focus : focus
        const key = screens.some((x) => x.key === k) ? k : screens[0] ? screens[0].key : focus
        setPicking(false)
        setPanel(false)
        setHist(false)
        setDemo({ stack: [key], layers: [{ id: ++demoSeq.current, key, dir: 0, shown: false }] })
        const inf = infoOf(key)
        if (inf && !(inf.links || []).length) say(t('demoNone'))
      }
      const demoGo = (path) => demoTo(keyOfPath(path, fileTarget))
      const demoTo = (key) => {
        setDemo((d) => {
          if (!d) return d
          const top = d.stack[d.stack.length - 1]
          if (key === top) return d
          const back = d.stack.length > 1 && d.stack[d.stack.length - 2] === key
          const stack = back ? d.stack.slice(0, -1) : [...d.stack, key].slice(-30)
          const last = d.layers[d.layers.length - 1]
          return { stack, layers: [last, { id: ++demoSeq.current, key, dir: back ? -1 : 1, shown: false }] }
        })
      }
      const demoRestart = () => setDemo((d) => {
        if (!d || d.stack.length < 2) return d
        const last = d.layers[d.layers.length - 1]
        return { stack: [d.stack[0]], layers: [last, { id: ++demoSeq.current, key: d.stack[0], dir: -1, shown: false }] }
      })
      const demoBack = () => setDemo((d) => {
        if (!d || d.stack.length < 2) return d
        const stack = d.stack.slice(0, -1)
        const last = d.layers[d.layers.length - 1]
        return { stack, layers: [last, { id: ++demoSeq.current, key: stack[stack.length - 1], dir: -1, shown: false }] }
      })
      const demoShown = (id) => {
        setDemo((d) => (d ? { ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, shown: true } : l)) } : d))
        setTimeout(() => setDemo((d) => (d && d.layers.length > 1 && d.layers[d.layers.length - 1].id === id ? { ...d, layers: [d.layers[d.layers.length - 1]] } : d)), 480)
      }
      // 页面自己用脚本跳了（没走我们拦下的链接）：只改记下的是哪一屏，不重载
      const demoHref = (id, href) => {
        let key = ''
        try { key = keyOfPath(decodeURIComponent(new URL(href).pathname), fileTarget) } catch { return }
        setDemo((d) => {
          if (!d) return d
          const last = d.layers[d.layers.length - 1]
          if (last.id !== id || last.key === key) return d
          return { stack: [...d.stack.slice(0, -1), key], layers: d.layers.map((l) => (l.id === id ? { ...l, key } : l)) }
        })
      }
      useEffect(() => {
        if (!demo) return undefined
        const onKey = (e) => { if (e.key === 'Escape') setDemo(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [!!demo])
      useEffect(() => { setDemo(null) }, [site])

      const openSingle = () => {
        if (sel && sel !== focus && screens.some((s) => s.key === sel)) change({ view: 'single', focus: sel })
        else change({ view: 'single' })
      }

      const renderScreen = (sc, z, fill) => h(Device, { kind, w: size[0], h: size[1], fill, label: labelOf(sc) },
        h(Screen, { t, remote,
          src: sc.url,
          label: labelOf(sc),
          busy: busy && !sc.v,
          born: !sc.v && isBorn(sc.key),
          picking: picking && !sc.v,
          textEdit: textEdit && !sc.v,
          styleEdit: styleEdit && !sc.v,
          styleSel: sty && sty.key === sc.key ? sty.selector : '',
          styleCss: sty && sty.key === sc.key ? sty.live : null,
          tweak: sc.v ? null : tweak,
          onStylePick: (p) => onStylePick(sc, p),
          onStyleCancel: () => setStyleEdit(false),
          dark,
          apis: apis.current,
          apiKey: ik(sc),
          quietPick: canvas,
          zoom: z,
          reloadSeq,
          onPicked: (payload) => { if (canvas) setSel(sc.key); deliver(payload) },
          onCancelled: () => setPicking(false),
          onEdited: (d) => onEdited(sc, d),
          onEditDone: () => setTextEdit(false),
          onNote: (n) => note(n, sc),
          onMeta: (m, title, toks, dk, links) => remember(ik(sc), m, title, toks, dk, links),
          onLinks: (links) => rememberLinks(ik(sc), links),
          onBuilt: (title) => onBuilt(sc, title),
        }))

      // ── 导出图片 ──
      // 截一屏：图片和它的 CSS 尺寸（PDF / PPT 按这个定页面大小）
      // 那一屏的接口（截图、体检）；刚载入的等它就绪
      const apiOf = async (sc) => {
        let api = apis.current.get(ik(sc))
        for (let i = 0; i < 40 && !(api && api.ready()); i++) {
          await new Promise((r) => setTimeout(r, 150))
          api = apis.current.get(ik(sc))
        }
        if (!api) throw new Error('not loaded')
        return api
      }
      const captureOf = async (sc, full) => {
        const api = await apiOf(sc)
        const r = await api.capture({ full: !!full, scale: 2 })
        return { img: await loadImg(r.png), w: r.w, h: r.h, links: Array.isArray(r.links) ? r.links : [] }
      }
      const shotOf = async (sc, full) => (await captureOf(sc, full)).img

      const saveImage = async (name, blob) => {
        const png = await blobB64(blob)
        const r = await post('export', { session: sid, name, png })
        const copied = await copyImage(blob)
        const file = String(r.path || '').split(/[\\/]/).pop()
        say(t(copied ? 'exportedCopied' : 'exported', { name: file }), { label: t('reveal'), run: () => post('reveal', { path: r.path }).catch(() => {}) })
      }

      const doExport = async (mode, key) => {
        setExMenu(false)
        say(t('exporting'))
        try {
          const prefix = ver ? `v${ver.n}-` : ''
          const suffix = dark ? '-dark' : ''
          if (mode === 'pdf' || mode === 'pptx') {
            // 每屏一页。PDF 里网页、邮件放整页长图（页面多高就多高）；PPT 一张幻灯片一个画面
            const long = mode === 'pdf' && (kind === 'web' || kind === 'email')
            const pages = []
            const keys = []
            for (const sc of shown) {
              try {
                const r = await captureOf(sc, long)
                pages.push({ jpg: await jpegB64(r.img), w: r.w, h: r.h, title: labelOf(sc), links: r.links })
                keys.push(sc.key)
              } catch (e) { console.warn('[dsh-design-studio] 截图失败', sc.key, e) }
            }
            if (!pages.length) throw new Error('no screens')
            // 原型里的跳转：路径换成第几页，PDF / PPT 里点了能跳过去
            for (const p of pages) {
              p.links = p.links.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, to: keys.indexOf(keyOfPath(l.path, fileTarget)) })).filter((l) => l.to >= 0)
            }
            const sp = splitTitles(pages.map((x) => x.title))
            const folder = st && st.target && st.target.kind === 'file' ? String(st.target.file).split(/[\\/]/).slice(-2, -1)[0] : ''
            const title = sp.brand || folder || st.label || ''
            const r = await post('doc', { session: sid, format: mode, name: prefix + (title || 'design') + suffix, title, bg: hexOf(pickColors(tokens).bg), pages })
            const file = String(r.path || '').split(/[\\/]/).pop()
            say(t('exportedDoc', { name: file, n: pages.length }), { label: t('reveal'), run: () => post('reveal', { path: r.path }).catch(() => {}) })
            return
          }
          if (mode === 'show') {
            const shots = []
            for (const sc of shown) {
              try { shots.push({ img: await shotOf(sc, false), title: labelOf(sc) }) } catch (e) { console.warn('[dsh-design-studio] 截图失败', sc.key, e) }
            }
            if (!shots.length) throw new Error('no screens')
            const sp = splitTitles(shots.map((x) => x.title))
            const colors = pickColors(tokens)
            const blob = await composeShowcase({
              kind,
              size,
              shots: shots.map((x, i) => ({ img: x.img, label: sp.labels[i] || x.title })),
              title: sp.brand || (st && st.target && st.target.kind === 'file' ? String(st.target.file).split(/[\\/]/).slice(-2, -1)[0] : st.label) || '',
              sub: t('showSub', { n: shots.length, kind: t(KIND_KEY[kind]), date: ymd(new Date()) }),
              bg: colors.bg,
              accent: colors.accent || ACCENT,
              mark: t('madeWith'),
            })
            await saveImage(prefix + (sp.brand || 'showcase') + suffix, blob)
            return
          }
          const k = key || (canvas ? sel || focus : focus)
          const sc = shown.find((x) => x.key === k) || shown[0]
          if (!sc) throw new Error('no screen')
          const base = prefix + sc.key.replace(/\.html?$/i, '') + suffix
          const img = await shotOf(sc, mode === 'long')
          if (mode === 'frame') await saveImage(base, await composeOne(kind, size, img, labelOf(sc)))
          else {
            const c = document.createElement('canvas')
            c.width = img.width
            c.height = img.height
            c.getContext('2d').drawImage(img, 0, 0)
            await saveImage(base + (mode === 'long' ? '-full' : ''), await canvasBlob(c))
          }
        } catch (e) {
          say(t('exportFail', { msg: e.message }))
        }
      }

      const doRestore = () => {
        if (!ver) return
        const n = ver.n
        post('restore', { session: sid, n }).then((d) => {
          setVersions(Array.isArray(d.versions) ? d.versions : [])
          setVer(null)
          setCmp(false)
          say(t('restored', { n }))
        }, (e) => say(t('failed', { msg: e.message })))
      }

      const askVariants = (sc) => {
        const b = sc.key.replace(/\.html?$/i, '')
        insert(t('variantText', { name: labelOf(sc), b, where: whereOf(sc.url, stRef.current) }), 'insertedSend')
      }

      // 同一屏的几个版本（开局的三个方向 home-a / b / c，或「再出两版」的 login / login-b / login-c）：挑一个
      const pickDirection = (sc) => {
        const g = takesOf(shown.map((x) => x.key), sc.key)
        if (!g) return
        const others = g.others.join('、')
        const where = whereOf(sc.url, stRef.current)
        insert(g.letter ? t('pickText', { name: labelOf(sc), where, others, base: g.stem }) : t('pickKeep', { name: labelOf(sc), where, others }), 'insertedSend')
      }

      const actions = (sc) => [
        !sc.v && takesOf(shown.map((x) => x.key), sc.key) ? h('button', { key: 'p', className: 'ddp-btn', title: t('pickThis'), onClick: () => pickDirection(sc) }, h(I.check)) : null,
        h('button', { key: 'x', className: 'ddp-btn', title: t('exThis'), onClick: () => doExport(FRAMED[kind] ? 'frame' : 'raw', sc.key) }, h(I.download)),
        sc.v ? null : h('button', { key: 'v', className: 'ddp-btn', title: t('variants'), onClick: () => askVariants(sc) }, h(I.sparkle)),
        h('button', { key: 'o', className: 'ddp-btn', title: t('openScreen'), onClick: () => change({ view: 'single', focus: sc.key }) }, h(I.single)),
      ]

      // 对比：拖中间的把手
      const dragKnob = (e) => {
        const el = cmpRef.current
        if (!el) return
        e.preventDefault()
        const target = e.currentTarget
        try { target.setPointerCapture(e.pointerId) } catch { /* 老浏览器 */ }
        setCmpDrag(true)
        const move = (ev) => {
          const r = el.getBoundingClientRect()
          if (r.width > 0) setCx(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)))
        }
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          target.removeEventListener('pointercancel', up)
          setCmpDrag(false)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', up)
        move(e)
      }

      const sizeSet = SIZE_SETS[kind] || null
      const inMulti = multi && !!sizeSet && !ver
      // 单页看手机 / 平板时，选择、改字的提示条放在设备上方，给它让出一条（不然压住设备顶边）
      const hintTop = (picking || textEdit) && !canvas && !inMulti && !ver && !demo && kind !== 'web'
      const flows = canvas && !inMulti && !picking && !textEdit ? flowsOf(shown, (sc) => (infoOf(ik(sc)) || {}).links, fileTarget) : []

      // ── 设计体检：画布上量所有屏，单页量这一屏；问题标在页面上，列在面板里 ──
      const closeCheck = () => {
        if (ck) for (const sc of ck.list || []) { const a = apis.current.get(ik(sc)); if (a) a.checkClear() }
        setCk(null)
      }
      const checkList = () => (canvas ? shown : [shown.find((x) => x.key === focus) || { key: focus, url, label: st.label }])
      // 几屏一起量（各量各的 iframe），一屏卡住不拖累别的
      const measure = (list, quiet) => Promise.all(list.map(async (sc) => {
        const row = { key: sc.key, v: sc.v, label: labelOf(sc), url: sc.url, issues: [] }
        try {
          const r = await (await apiOf(sc)).check(kind, quiet)
          row.issues = Array.isArray(r.issues) ? r.issues : []
          if (r.metrics && typeof r.metrics === 'object') row.metrics = r.metrics
        } catch (e) { row.error = e.message }
        return row
      }))
      const total = (list) => list.reduce((m, x) => m + x.issues.length, 0)
      const runCheck = async () => {
        setPanel(false); setHist(false); setPhone(false)
        setCk({ running: true, list: [] })
        const out = await measure(checkList(), false)
        setCk({ running: false, list: out })
        setCkCount(total(out))
        // 有问题的第一屏被面板挡着、在画布外面：挪过来
        const first = out.find((x) => x.issues.length)
        if (canvas && first) setReveal((r) => ({ key: first.key, n: ((r && r.n) || 0) + 1 }))
        return out
      }
      const focusIssue = (key, i) => {
        const sc = (ck && ck.list.find((x) => x.key === key)) || null
        if (!sc) return
        if (canvas) { setSel(key); setReveal((r) => ({ key, n: ((r && r.n) || 0) + 1 })) }
        const a = apis.current.get(ik(sc))
        if (a) a.checkFocus(i)
      }
      // 打开一套设计、模型又干完一轮（turns 变了）：面板开着就再查一次（改没改好一眼看到）；关着就悄悄量一下，问题数标在按钮上。
      // 模型干着活时不量；等一会儿再量：刚写完的屏还在刷新、播生成动画
      const autoCk = useRef(null)
      const ckKey = url && !busy ? `${site}|${(st && st.turns) || 0}` : ''
      const seenCk = useRef('')
      useEffect(() => {
        if (!ckKey || ckKey === seenCk.current) return undefined
        seenCk.current = ckKey
        const timer = setTimeout(async () => {
          const a = autoCk.current
          if (a.off) return
          if (a.ck && !a.ck.running) return a.run()
          if (a.ck) return
          const out = await a.measure(a.list(), true)
          if (!autoCk.current.ck) setCkCount(total(out))
        }, 2500)
        return () => clearTimeout(timer)
      }, [ckKey])
      useEffect(() => { setCkCount(0) }, [site])
      // 模型调了 check_design（轮询里出现新的 checkReq）：量完把清单交回去；面板开着就顺手刷新面板，关着就只更新按钮上的数。
      // 稍等一下再量：模型刚写完的屏还在刷新
      const ckReq = (st && st.checkReq) || ''
      const doneReq = useRef('')
      useEffect(() => {
        if (!ckReq || ckReq === doneReq.current) return undefined
        doneReq.current = ckReq
        const timer = setTimeout(async () => {
          const a = autoCk.current
          let body
          if (a.off) body = { error: t('ckToolOff') }
          else {
            const out = a.ck && !a.ck.running ? await a.run() : await a.measure(a.list(), true)
            if (!autoCk.current.ck) setCkCount(total(out))
            // measured：真量到的屏数。一屏都没量到（这台设备上的预览不回话）时服务端先不收，等别的设备上的右侧栏
            body = { text: formatCheckTool(t, out, stRef.current), measured: out.filter((x) => !x.error).length }
          }
          post('check', { session: sid, id: ckReq, ...body }).catch(() => {})
        }, 1500)
        return () => clearTimeout(timer)
      }, [ckReq])
      const fixIssues = () => {
        if (!ck) return
        insert(formatCheck(t, ck.list, stRef.current), 'insertedSend')
        closeCheck()
      }
      const checkOff = !url || !!ver || !!demo || inMulti
      const styleOff = !url || !!ver || !!demo || inMulti || busy
      useEffect(() => { if (styleOff) setStyleEdit(false) }, [styleOff])
      autoCk.current = { ck, off: checkOff, run: runCheck, list: checkList, measure }
      useEffect(() => { if (checkOff && ck) closeCheck() }, [checkOff])

      const toggleDemo = () => (demo ? setDemo(null) : startDemo())
      const toggleHist = () => { setHist(!hist); setPanel(false); setStyles(false); setPhone(false); closeCheck(); setStyleEdit(false) }
      // 右边同一时间只开一个面板：别的开了，这几个关掉；开这几个时别的关掉
      const oldOpen = !!(panel || styles || hist || phone || ck || styleEdit)
      useEffect(() => { if (oldOpen) setPane('') }, [oldOpen])
      const openPane = (p) => {
        const next = pane === p ? '' : p
        if (next) { setPanel(false); setStyles(false); setHist(false); setPhone(false); closeCheck(); setStyleEdit(false) }
        setPane(next)
      }
      const setTweak = (k, v) => setTw((c) => {
        if (String(k.value) === String(v)) { const out = { ...c }; delete out[k.id]; return out }
        return { ...c, [k.id]: v }
      })
      const saveTweaks = async () => {
        try {
          // 带上拖的是哪套设计：请求路上会话换了设计，服务端就不写
          const r = await post('tweak', { session: sid, root: st && st.target ? st.target.root : '', values: tw })
          if (!r.ok) return say(r.reason === 'busy' ? t('styleBusyTip') : r.reason === 'moved' ? t('twMoved') : t('twNoWrite'))
          if (r.missed && r.missed.length) say(t('twMissed', { names: r.missed.map((x) => x.label).join(t('sep')) }))
          else showFlash(t('twSaved', { n: r.changed.length }))
        } catch (e) {
          say(t('failed', { msg: e.message }))
        }
      }
      const doHandoff = ({ fw, label, dest, only }) => {
        insert(t('hoText', {
          fw: label,
          key: fw,
          dest,
          scope: only ? t('hoScopeOne', { name: only }) : t('hoAll', { n: screens.length || 1 }),
          only: only ? `，screens: ["${only}"]` : '',
        }), 'insertedSend')
        setPane('')
      }
      const togglePhone = () => { setPhone(!phone); setPanel(false); setStyles(false); setHist(false); closeCheck(); setStyleEdit(false) }
      const reload = () => setReloadSeq((x) => x + 1)

      const bar = h('div', { className: 'ddp-bar' },
        editing || !url
          ? h(AddressForm, { t, sid, initial: st && st.target && st.target.kind === 'file' ? st.target.file : st && st.label ? st.label : '', autoFocus: true, onDone: () => setEditing(false) })
          : h('div', { className: 'ddp-addr', title: t('editAddr'), onClick: () => setEditing(true) },
            h('i', { className: 'ddp-dot' + (busy ? ' wait' : '') }),
            h('span', null, canvas && screens.length > 1 ? `${st.label} · ${screens.length}` : st.label)),
        h('button', { className: 'ddp-btn pick' + (picking ? ' on' : ''), title: t('pickTip'), disabled: !url || !!ver || !!demo, onClick: togglePick },
          h(I.pick), h('span', null, picking ? t('picking') : t('pick'))),
        h('button', { className: 'ddp-btn' + (textEdit ? ' on' : ''), title: t('textEdit'), disabled: !url || !!ver || !!demo || busy, onClick: toggleText }, h(I.text)),
        h('button', { className: 'ddp-btn' + (styleEdit ? ' on' : ''), title: t('styleEdit'), disabled: styleOff, onClick: toggleStyle }, h(I.sliders)),
        h('span', { className: 'ddp-sep' }),
        h('div', { className: 'ddp-seg' },
          h('button', { className: 'ddp-btn' + (canvas && !inMulti ? ' sel' : ''), title: t('canvas'), onClick: () => { setMulti(false); change({ view: 'canvas' }) } }, h(I.canvas)),
          h('button', { className: 'ddp-btn' + (!canvas && !inMulti ? ' sel' : ''), title: t('single'), onClick: () => { setMulti(false); openSingle() } }, h(I.single)),
          h('button', { className: 'ddp-btn' + (inMulti ? ' sel' : ''), title: sizeSet ? t('sizes') : t('sizesNo'), disabled: !sizeSet || !!ver, onClick: () => setMulti(!inMulti) }, h(I.sizes))),
        h('button', { className: 'ddp-btn o2' + (demo ? ' sel' : ''), title: t('demo'), disabled: !url || !!ver, onClick: toggleDemo }, h(I.play)),
        h(KindMenu, { t, kind, open: menu, setOpen: setMenu, onPick: (k) => { setMenu(false); change({ kind: k }) } }),
        h('button', { className: 'ddp-btn' + (panel ? ' sel' : '') + (tokens.length && !panel ? ' has' : ''), title: t('tokens'), onClick: () => { setPanel(!panel); setStyles(false); setHist(false); setPhone(false); closeCheck(); setStyleEdit(false) } }, h(I.palette)),
        h('button', { className: 'ddp-btn o2' + (pane === 'tweaks' ? ' sel' : '') + (tlist.length && pane !== 'tweaks' ? ' has' : ''), title: t('tweaks'), disabled: !fileTarget || !!ver, onClick: () => openPane('tweaks') }, h(I.dial)),
        h('button', { className: 'ddp-btn o2' + (ck ? ' sel' : ''), title: ckCount && !ck ? t('checkCount', { n: ckCount }) : t('checkTip'), disabled: checkOff, onClick: () => (ck ? closeCheck() : runCheck()) },
          h(I.stetho), ckCount && !ck && !checkOff ? h('span', { className: 'bdg' }, ckCount > 99 ? '99+' : String(ckCount)) : null),
        h('button', { className: 'ddp-btn o2' + (hist || ver ? ' sel' : ''), title: t('history'), disabled: !fileTarget, onClick: toggleHist }, h(I.history)),
        h('button', { className: 'ddp-btn o2' + (pane === 'handoff' ? ' sel' : ''), title: t('handoff'), disabled: !url || !!ver, onClick: () => openPane('handoff') }, h(I.code)),
        h(ExportMenu, { t, kind, count: shown.length, open: exMenu, setOpen: setExMenu, onPick: (m) => doExport(m), disabled: !url }),
        anyDark || dark ? h('button', { className: 'ddp-btn o1' + (dark ? ' sel' : ''), title: t('dark'), onClick: () => setDark(!dark) }, h(I.moon)) : null,
        h('button', { className: 'ddp-btn o1' + (phone ? ' sel' : '') + (phoneOn && !phone ? ' has' : ''), title: t('phone'), disabled: !url, onClick: togglePhone }, h(I.scan)),
        h('button', { className: 'ddp-btn o1', title: t('refresh'), onClick: reload }, h(I.refresh)),
        h('a', { className: 'ddp-btn o1', title: t('external'), href: url, target: '_blank', rel: 'noopener noreferrer' }, h(I.external)),
        h(MoreMenu, { t, open: more, setOpen: setMore, has: (phoneOn && !phone) || (!!ckCount && !ck && !checkOff), items: [
          ['o2', I.play, t('demoShort'), !!demo, !url || !!ver, toggleDemo],
          ['o2', I.stetho, t('check'), !!ck, checkOff, () => (ck ? closeCheck() : runCheck())],
          ['o2', I.history, t('history'), hist || !!ver, !fileTarget, toggleHist],
          ['o2', I.dial, t('tweaks'), pane === 'tweaks', !fileTarget || !!ver, () => openPane('tweaks')],
          ['o2', I.code, t('handoff'), pane === 'handoff', !url || !!ver, () => openPane('handoff')],
          ['', I.library, t('systems'), pane === 'systems', false, () => openPane('systems')],
          anyDark || dark ? ['o1', I.moon, t('dark'), dark, false, () => setDark(!dark)] : null,
          ['o1', I.scan, t('phone'), phone, !url, togglePhone],
          ['o1', I.refresh, t('refresh'), false, false, reload],
          ['o1', I.external, t('external'), false, !url, url],
        ] }))

      // 模型用提问卡问你、在等回答：不转圈，换成一个橙点
      const busyChip = (cls) => st && st.asking
        ? h('div', { className: 'ddp-chip' + cls, key: 'busy' }, h('i', { className: 'q' }), h('span', null, t('asking')))
        : h('div', { className: 'ddp-chip' + cls, key: 'busy' }, h('i', { className: 'sp' }),
          h('span', { className: 'tx' }, st && st.writing ? t('writing', { file: st.writing }) : t('working')))

      // ── 参考图：拖进来 / 粘贴 / 从设计规范面板选；存进设计目录的 refs/，尺寸和主要颜色放进输入框 ──
      const addRef = async (file) => {
        if (!file || !/^image\//.test(file.type)) return say(t('refNotImage'))
        try {
          const r = await readRef(file)
          const saved = await post('ref', { session: sid, name: file.name || 'ref', data: r.data })
          insert(formatRef(t, { path: saved.path, w: r.w, h: r.h, palette: r.palette, hasDesign: !!url }), 'insertedSend')
        } catch (e) {
          say(t('refFail', { msg: e.message }))
        }
      }
      const imageOf = (list) => [...(list || [])].find((f) => f && /^image\//.test(f.type))
      const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files')
      const pickRef = () => { if (refInput.current) refInput.current.click() }
      const rootProps = {
        className: 'ddp',
        tabIndex: -1, // 点了右侧栏就能在这里粘贴图片
        onDragEnter: (e) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true) } },
        onDragOver: (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } },
        onPaste: (e) => {
          const f = imageOf(e.clipboardData && e.clipboardData.files)
          if (!f) return
          e.preventDefault()
          addRef(f)
        },
      }
      // 盖住整个右侧栏接住松手（不然落在页面 iframe 上就被它吃掉了）
      const dropLayer = dropping ? h('div', {
        className: 'ddp-drop',
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
        onDragLeave: (e) => { if (e.target === e.currentTarget) setDropping(false) },
        onDrop: (e) => {
          e.preventDefault()
          e.stopPropagation()
          setDropping(false)
          addRef(imageOf(e.dataTransfer.files))
        },
      }, h('div', { className: 'in' }, h(I.image), h('b', null, t('refDrop')), h('span', null, t('refDropSub')))) : null
      const fileInput = h('input', {
        ref: refInput,
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        style: { display: 'none' },
        onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) addRef(f) },
      })
      const root = (...kids) => h('div', rootProps, ...kids, dropLayer, fileInput)

      // 调节滑块 / 品牌设计系统 / 转成代码（右边的面板）
      const sidePane = () => {
        if (pane === 'tweaks') {
          return h(TweaksPanel, {
            t,
            tw: tweaks,
            live: tw,
            write: busy ? { ok: false, tip: t('styleBusyTip') } : { ok: true, tip: t('twSaveTip') },
            onSet: setTweak,
            onReset: () => setTw({}),
            onAsk: () => insert(formatTweaks(t, tlist, tw), 'insertedSend'),
            onSave: saveTweaks,
            onMake: (errs) => insert(errs && errs.length ? t('twFixText', { errs: errs.join('；') }) + '\n' : t('twMakeText') + '\n', 'insertedSend'),
            onClose: () => setPane(''),
          })
        }
        if (pane === 'systems') {
          return h(SystemsPanel, {
            t,
            rev: (st && st.turns) || 0,
            hasDesign: !!url,
            onExtract: (src) => insert(t('sysExtractText', { src }) + '\n', 'insertedSend'),
            onApply: (x) => insert(t('sysApplyText', { name: x.name, dir: x.dir }) + '\n', 'insertedSend'),
            onSay: say,
            onClose: () => setPane(''),
          })
        }
        if (pane === 'handoff') {
          return h(HandoffPanel, { t, sid, root: fileTarget ? st.target.root : '', fileTarget, count: screens.length, cur: (curScreen && curScreen.key) || focus, onGo: doHandoff, onClose: () => setPane('') })
        }
        return null
      }

      if (!url) {
        if (st ? st.loading : !waited) return root(h('div', { className: 'ddp-stage', ref: stageRef }))
        if (busy) {
          // 模型在做第一屏：先放一个生成中的占位
          return root(
            h('div', { className: 'ddp-stage', ref: stageRef },
              h('div', { className: 'ddp-wait' }, h('div', { className: 'card' }, h(Skeleton, {})), h('p', null, t('waiting'))),
              h('div', { className: 'ddp-glow' }),
              h('div', { className: 'ddp-ring' }),
              busyChip('')))
        }
        return root(
          h('div', { className: 'ddp-empty' },
            h(EmptyArt),
            h('b', null, t('empty')),
            st && st.hint ? h('button', {
              className: 'ddp-go',
              onClick: () => post('open', { session: sid, target: st.hint }).then((s) => { if (poll) poll.set(s) }, (e) => say(t('openFailed', { msg: e.message }))),
            }, t('hintOpen', { name: st.hint.split(/[\\/]/).pop() })) : null,
            h('ol', { className: 'ddp-steps' }, h('li', null, t('step1')), h('li', null, t('step2')), h('li', null, t('step3'))),
            h('div', { className: 'ddp-stylepick' }, h('b', null, t('stylesHead')), h('p', null, t('stylesTip')), h(StyleCards, { t, onPick: (x) => insert(formatStyle(t, x, false)) })),
            h('p', null, t('emptyHint')),
            h(AddressForm, { t, sid, className: 'ddp-form', onDone: () => {} }),
            h('p', { className: 'ddp-refline' }, t('refEmpty'), ' · ', h('button', { className: 'lk', onClick: pickRef }, t('refChoose'))),
            h('p', { className: 'ddp-refline' }, t('sysEmptyLine'), ' · ', h('button', { className: 'lk', onClick: () => openPane('systems') }, t('sysOpen')))),
          pane === 'systems' ? sidePane() : null,
          toast ? h('div', { className: 'ddp-toast' }, h('span', null, toast.text)) : null)
      }

      let body
      if (demo) {
        const fill = kind === 'web'
        const [dw, dh] = deviceBox(kind, size)
        const z = fill ? 1 : Math.max(0.05, Math.min(1, (box.w - 32) / dw, (box.h - 32 - 46) / dh))
        const top = demo.layers[demo.layers.length - 1]
        body = h('div', { className: 'ddp-demo' }, ...demo.layers.map((l) => {
          const isTop = l.id === top.id
          const cls = 'lay' + (isTop ? (l.shown || !l.dir ? '' : ' wait') : top.shown ? ' out' : '') + (l.dir < 0 || (!isTop && top.dir < 0) ? ' b' : ' f')
          const label = (infoOf(l.key) || {}).title || l.key.replace(/\.html?$/i, '')
          return h('div', { key: l.id, className: cls },
            h('div', { className: 'ddp-single' },
              h('div', { className: 'ddp-fit' + (fill ? ' fill' : ''), style: fill ? undefined : { width: dw, height: dh, transform: `translate(-50%, -50%) scale(${z})` } },
                h(Device, { kind, w: size[0], h: size[1], fill, label },
                  h(Screen, { t, remote,
                    src: urlOfKey(l.key),
                    label,
                    busy: false,
                    born: false,
                    picking: false,
                    demo: isTop,
                    dark,
                    tweak,
                    zoom: z,
                    reloadSeq,
                    onNav: isTop ? demoGo : undefined,
                    onHref: isTop ? (href) => demoHref(l.id, href) : undefined,
                    onShown: () => demoShown(l.id),
                    onMeta: (m, title, toks, dk, links) => remember(l.key, m, title, toks, dk, links),
                    onLinks: (links) => rememberLinks(l.key, links),
                  })))))
        }))
      } else if (inMulti) {
        // 多尺寸：现在这一屏，按几档宽度并排
        const base = curScreen || { key: focus, url, label: st.label }
        const items = sizeSet.map(([lk, k, sz]) => ({ kind: k, size: sz, label: `${t(lk)} · ${sz[0]}` }))
        const fake = items.map((it, i) => ({ key: 'sz' + i, id: 'sz' + i + '|' + base.key, url: base.url, label: it.label }))
        body = h(Canvas, {
          key: 'multi',
          t,
          screens: fake,
          items,
          kind,
          size,
          ghost: false,
          picking: picking || textEdit,
          sel: '',
          labelOf: (sc) => sc.label,
          render: (sc, z, i) => h(Device, { kind: items[i].kind, w: items[i].size[0], h: items[i].size[1], label: labelOf(base) },
            h(Screen, { t, remote,
              src: base.url,
              label: labelOf(base),
              busy,
              born: false,
              picking,
              textEdit,
              dark,
              tweak,
              quietPick: true,
              zoom: z,
              reloadSeq,
              onPicked: (payload) => deliver(payload, `屏宽：${items[i].size[0]}（${items[i].label.split(' · ')[0]}）\n`),
              onCancelled: () => setPicking(false),
              onEdited: (d) => onEdited(base, d),
              onEditDone: () => setTextEdit(false),
              onNote: (n) => note(n, base),
            })),
        })
      } else if (ver && cmp) {
        // 对比：同一屏，左边那一版、右边现在，中间的把手左右拖
        const k = canvas ? sel || focus : focus
        const now = screens.find((x) => x.key === k) || screens[0]
        const has = now && ver.screens.includes(now.key)
        const old = now ? { key: now.key, id: `v${ver.n}|${now.key}`, v: ver.n, url: vbase + encodeURIComponent(now.key), label: now.label } : null
        const fill = kind === 'web'
        const [dw, dh] = deviceBox(kind, size)
        const z = fill ? 1 : Math.max(0.05, Math.min(1, (box.w - 32) / dw, (box.h - 32 - (ver ? 46 : 0)) / dh))
        // 两边的小标签不跟着画面缩小（缩了看不清）；手机、平板躲开状态栏
        const tagAt = (side) => ({ top: kind === 'app' || kind === 'tablet' ? 60 : 10, transform: `scale(${1 / z})`, transformOrigin: 'top ' + side })
        const screenOf = (sc) => h(Screen, { t, remote, src: sc.url, label: labelOf(sc), busy: false, born: false, picking: false, dark, zoom: z, reloadSeq,
          apis: apis.current, apiKey: 'cmp|' + ik(sc), onMeta: (m, title, toks, dk) => remember(ik(sc), m, title, toks, dk) })
        body = h('div', { className: 'ddp-single' },
          h('div', { className: 'ddp-fit' + (fill ? ' fill' : ''), style: fill ? undefined : { width: dw, height: dh, transform: `translate(-50%, -50%) scale(${z})` } },
            now ? h(Device, { kind, w: size[0], h: size[1], fill, label: labelOf(now) },
              h('div', { className: 'ddp-cmp' + (cmpDrag ? ' drag' : ''), ref: cmpRef },
                h('div', { className: 'ly' }, has ? screenOf(old) : h('div', { className: 'miss' }, t('notInVer', { n: ver.n }))),
                // 右边一层只露出把手右边那块：外层裁宽度，里面整屏往左挪（iframe 不变大小、不重排；clip-path 盖 iframe 有的内核画不出来）
                cx < 100 ? h('div', { className: 'ly r', style: { width: (100 - cx) + '%' } },
                  h('div', { style: { width: (10000 / (100 - cx)) + '%', left: (-100 * cx / (100 - cx)) + '%' } }, screenOf(now))) : null,
                h('div', { className: 'ddp-knob', style: { left: cx + '%' }, onPointerDown: dragKnob }, h('i')),
                h('span', { className: 'tag l', style: tagAt('left') }, t('vN', { n: ver.n })),
                h('span', { className: 'tag r', style: tagAt('right') }, t('cmpNow')))) : null))
      } else if (canvas) {
        body = h(Canvas, {
          key: 'grid',
          t,
          screens: shown,
          actions,
          kind,
          size,
          ghost,
          picking: picking || textEdit || styleEdit,
          sel: sel || focus,
          labelOf,
          reveal,
          inset: ck || styleEdit || panel || styles || pane ? 296 : 0, // 右边的面板 276 宽，离边 10
          render: (sc, z) => renderScreen(sc, z, false),
          flows,
          onSelect: setSel,
          onOpen: (key) => change({ view: 'single', focus: key }),
        })
      } else {
        const fill = kind === 'web'
        const [dw, dh] = deviceBox(kind, size)
        // 右边开着面板（体检、调样式、设计规范、换风格）：手机这类有外框的让到面板左边（侧栏够宽时），别被挡住
        const aside = !fill && (ck || styleEdit || panel || styles || pane) && box.w - 296 >= 240 ? 296 : 0
        const z = fill ? 1 : Math.max(0.05, Math.min(1, (box.w - aside - 32) / dw, (box.h - 32 - (ver || hintTop ? 46 : 0)) / dh))
        const one = ver ? shown.find((x) => x.key === focus) || shown[0] || { key: focus, url, label: st.label } : { key: focus, url, label: st.label }
        body = h('div', { className: 'ddp-single', style: aside ? { right: aside } : undefined },
          h('div', { className: 'ddp-fit' + (fill ? ' fill' : ''), style: fill ? undefined : { width: dw, height: dh, transform: `translate(-50%, -50%) scale(${z})` } },
            renderScreen(one, z, fill)))
      }

      let chip = null
      const side = canvas || inMulti ? ' left' : ''
      const hintText = picking ? t(canvas || inMulti ? 'pickAny' : 'pickOne') : textEdit ? t(canvas || inMulti ? 'textAny' : 'textOne') : styleEdit && !sty ? t(canvas ? 'styleAny' : 'styleOne') : ''
      if (flash) chip = h('div', { className: 'ddp-chip ok' + side, key: 'ok' }, h(I.check), h('span', null, flash))
      else if (busy) chip = busyChip(side)

      return root(
        bar,
        h('div', { className: 'ddp-stage' + (!canvas && !inMulti && kind === 'web' ? ' full' : ''), ref: stageRef },
          h('div', { className: 'ddp-body' + (ver || demo || hintTop ? ' vb' : '') }, body),
          busy ? h('div', { className: 'ddp-glow' }) : null,
          busy ? h('div', { className: 'ddp-ring' }) : null,
          // 右边开着面板时提示条居中在面板左边那块，别被面板盖住一半
          hintText ? h('div', { className: 'ddp-hint' + ((ck || styleEdit || panel || styles || pane) && box.w - 296 >= 240 ? ' side' : '') }, hintText) : null,
          ck ? h(CheckPanel, { t, ck, onFocus: focusIssue, onFix: fixIssues, onAgain: runCheck, onClose: closeCheck }) : null,
          styleEdit ? h(StylePanel, {
            t,
            sty,
            tokens: (sty && (infoOf(sty.key) || {}).tokens) || tokens,
            write: !fileTarget ? { ok: false, tip: t('styleNoWrite') } : busy ? { ok: false, tip: t('styleBusyTip') } : { ok: true, tip: t('styleSaveTip') },
            onSet: setStyleProp,
            onReset: () => setSty((c) => (c ? { ...c, live: {} } : c)),
            onAsk: askStyle,
            onSave: saveStyle,
            onClose: () => setStyleEdit(false),
          }) : null,
          panel ? h(TokensPanel, { t, tokens, onPick: (tok) => insert(formatToken(tok, stRef.current)), onAsk: () => insert(t('tokensAskText') + '\n', 'insertedSend'), onRef: pickRef,
            onStyles: () => { setPanel(false); setStyles(true) }, onSystems: () => openPane('systems'), onClose: () => setPanel(false) }) : null,
          pane ? sidePane() : null,
          styles ? h(StylesPanel, { t, onPick: (x) => { setStyles(false); insert(formatStyle(t, x, true), 'insertedSend') }, onClose: () => setStyles(false) }) : null,
          phone ? h(PhonePanel, {
            t,
            sid,
            path: curPath,
            seen: st && st.phone ? st.phone.seen : 0,
            onCopy: (link) => { navigator.clipboard.writeText(link).then(() => say(t('phoneCopied'))).catch(() => say(link)) },
            onStop: () => { post('phone', { session: sid, on: false }).catch(() => {}); setPhone(false); if (poll && poll.state) poll.set({ ...poll.state, phone: { on: false, seen: 0 } }) },
            onClose: () => setPhone(false),
          }) : null,
          hist ? h(HistoryPanel, { t, versions, ver, onPick: (v) => { setVer(v); if (!v) setCmp(false) }, onClose: () => setHist(false) }) : null,
          demo ? h('div', { className: 'ddp-banner' },
            h(I.play),
            h('span', null, t('demoOn') + ' · ' + ((infoOf(demoKey) || {}).title || demoKey.replace(/\.html?$/i, ''))),
            h('button', { className: 'ddp-btn', title: t('demoBack'), disabled: demo.stack.length < 2, onClick: demoBack }, h(I.back)),
            h('button', { className: 'ddp-btn', title: t('demoRestart'), disabled: demo.stack.length < 2, onClick: demoRestart }, h(I.refresh)),
            h('button', { className: 'ddp-btn', title: t('demoExit'), onClick: () => setDemo(null) }, h(I.close))) : null,
          ver ? h('div', { className: 'ddp-banner' },
            h(I.history),
            h('span', null, t('viewing', { n: ver.n, time: hhmm(ver.at) })),
            h('button', { className: 'ddp-go' + (cmp ? ' on' : ''), onClick: () => setCmp(!cmp) }, t('compare')),
            h('button', { className: 'ddp-go pri', onClick: doRestore }, t('restore')),
            h('button', { className: 'ddp-btn', title: t('backNow'), onClick: () => { setVer(null); setCmp(false) } }, h(I.close))) : null,
          chip,
          toast ? h('div', { className: 'ddp-toast' + (ver || demo || hintText ? ' low' : '') }, h('span', null, toast.text),
            toast.act ? h('button', { onClick: () => { toast.act.run(); setToast('') } }, toast.act.label) : null) : null))
    }

    // ── 标题栏按钮：打开预览，顺便在模型开了新页面时把右侧栏弹出来 ──────────

    function HeaderButton(props) {
      const t = props.t
      const sid = props.sid || props.sessionId
      const [st] = usePreview(sid)
      const seen = useRef(null)
      useEffect(() => {
        if (!st) return
        if (seen.current === null) { seen.current = st.openRev; return } // 刚挂上：不为以前的事弹
        if (st.openRev > seen.current) {
          seen.current = st.openRev
          props.open(sid)
        }
      }, [st && st.openRev])
      const hint = st && !st.target && st.hint ? st.hint.split(/[\\/]/).pop() : ''
      return h('button', {
        className: 'ddp-head' + (st && st.target ? ' live' : hint ? ' hint' : ''),
        title: hint ? t('headerHint', { name: hint }) : t('headerTip'),
        'aria-label': t('headerTip'),
        onClick: () => props.open(sid, true),
      }, h(I.page))
    }

    // ── 注册 ─────────────────────────────────────────────────────────────────

    function apply(ctx) {
      ensureStyle()
      const t = makeT(ctx)
      try { ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-design-studio: copy') } catch (e) { console.warn('[dsh-design-studio] locale', e) }

      /** 打开右侧栏的预览标签；force=false 时只在这个会话正显示在屏幕上时才弹 */
      const open = (sid, force) => {
        try {
          const m = ctx.sidebarRight.mounted
          const onScreen = m && typeof m.getSnapshot === 'function' ? m.getSnapshot() : sid
          if (!force && onScreen !== sid) return
          ctx.sidebarRight.openTab(KIND)
        } catch (e) {
          console.warn('[dsh-design-studio] 打不开右侧栏', e)
        }
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        title: () => t('title'),
        keepMounted: true,
        guide: [{ id: 'open', order: 30, title: () => t('title'), description: () => t('guideDesc'), icon: GuideIcon }],
      }), 'dsh-design-studio: tab type')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
        inject: (sessionId) => ({ sid: sessionId, t }),
      }, PreviewTab)), 'dsh-design-studio: tab body')

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-design-studio',
        order: -10,
        locale: NS,
        inject: (sessionId) => ({ sid: sessionId, t, open }),
      }, HeaderButton)), 'dsh-design-studio: header button')
    }

    exports.apply = apply
    // 注意：这里是客户端**服务名**（短的），不是包名
    exports.inject = INJECT
    // 测试用
    exports._test = { STYLES, formatStyle, pageOf, pxOf, styleChanges, formatStyleAsk, takesOf, formatCheckTool, poller, frameOf, paletteOf, formatRef, layoutRow, keyOfPath, flowsOf, flowLines, formatPick, whereOf, parseMeta, sizeOf, layoutGrid, fitCam, tokenKind, formatToken, splitTitles, pickColors, hhmm }
    return module.exports
  },
})
