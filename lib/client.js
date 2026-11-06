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
      emptyHintPick: '已有 HTML？点「浏览…」选一个，或直接拖进来；也能输入路径或端口：',
      browse: '浏览…',
      browseTip: '选一个本地 HTML 文件打开',
      pathNone: '拿不到这个文件的路径，请直接输入它的路径打开',
      pageDrop: '松开，打开这个页面',
      maybeDrop: '松开，打开这个文件夹或 HTML',
      pageDropSub: 'HTML 文件，或放着 HTML 的文件夹',
      dropWeb: '网页版拿不到本地文件的路径',
      dropWebSub: '请输入它在运行 DSH 的那台电脑上的路径打开',
      dropWebSay: '网页版拿不到本地文件的路径：请输入它在运行 DSH 的那台电脑上的路径打开',
      dropWhat: '这里只接 HTML、文件夹或图片',
      dropWhatSub: 'HTML 或文件夹会打开预览，图片当参考图',
      dropWhatWeb: '这里只接图片',
      dropWhatWebSub: '图片当参考图；要打开 HTML，请输入它的路径',
      pickDir: '选文件夹',
      pickDirFail: '没打开选文件夹的窗口：{msg}',
      hoMoved: '选的文件夹里已经有别的东西，代码会放进里面的 {name}（可以改）',
      hoBeside: '代码不能放进设计目录（设计稿要留着对比），改放在旁边的 {name}（可以改）',
      hoChecking: '正在看这个文件夹…',
      hoCheckFail: '没看成这个文件夹（{msg}），开始前请确认路径',
      hintOpen: '预览刚写的 {name}',
      headerHint: '刚写了 {name}，点开能预览',
      placeholder: '/路径/index.html 或 5173',
      go: '打开',
      pick: '选择',
      pickTip: '点选元素或框选区域，发给模型（Esc 取消）',
      pickAny: '点选任意一屏里的元素，或拖出一块区域 · Esc 取消',
      pickOne: '点选一个元素，或拖出一块区域 · Esc 取消',
      pickArea: '选中区域',
      chipOne: '1 个元素',
      chipMark: '标注图',
      chipText: '改字',
      chipStyle: '样式改动',
      chipVariant: '再出两版',
      chipDir: '选定方向',
      chipCheck: '体检 · {n} 个问题',
      chipCode: '转成代码',
      chipRef: '参考图',
      chipTweak: '滑块调整',
      chipTwMake: '做调节滑块',
      chipTwFix: '修调节滑块',
      chipSysEx: '提取设计系统',
      chipSysAp: '套用设计系统',
      chipLook: '风格 · {name}',
      chipTokens: '建设计变量',
      pickElems: '{n} 个元素',
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
      kindMini: '小程序',
      kindTablet: '平板',
      kindDesktop: '桌面软件',
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
      checkAsk: '〔设计体检〕发现 {n} 个问题：',
      checkTail: '请逐个修好：改源文件，只动有问题的地方；颜色、字号能改设计变量就改设计变量。',
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
      ck_capsule: '被小程序胶囊挡住',
      ck_island: '被灵动岛挡住',
      ck_homebar: '伸进底部横条区',
      ck_tabbar: '标签栏项太多',
      ck_navbar: '没有导航栏',
      ck_winctl: '被窗口按钮挡住',
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
      cd_capsule: '伸进右上角胶囊 {px}px（胶囊是微信画的、盖不住：顶栏右边从 x={x} 起空着）',
      cd_island: '被灵动岛挡住 {px}px（灵动岛在 y 11–45：状态栏中间空着，内容放到状态栏下面）',
      cd_homebar: '{bar} 里的字或图标伸进底部横条区 {px}px（底部留 34px：栏加 padding-bottom: 34px，预览里 env(safe-area-inset-bottom) 是 0）',
      cd_tabbar: '标签栏有 {n} 项（最多 5 项）',
      cd_navbar: '顶上 y {t}–{b}（导航栏）是空的：一级页放标题或品牌，二级页标题居中加返回',
      cd_winctl: '伸进{osName}窗口按钮 {px}px（外框画的、盖在页面上面：{zone}空着）',
      ckOs_mac: ' Mac ',
      ckOs_win: ' Windows ',
      ckZone_mac: '左上角 x 80、y 40 以内',
      ckZone_win: '右上角 138×32',
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
      pickShort: '就要这个',
      pickText: '〔选定方向〕就用「{name}」（{where}）。先把同组的 {others} 挪进 drafts/ 子目录（别删），再把它改名成 {base}.html；它的设计变量搬进 tokens.css（没有就新建）、改用 tokens.css。然后接着做全套。\n',
      pickKeep: '〔选定方向〕留原版「{name}」（{where}）。同组的 {others} 挪进 drafts/ 子目录（别删），其他不动。\n',
      variantText: '给「{name}」再出两版不同方向的设计（布局或视觉风格明显不同），存成同目录下的 {b}-b.html 和 {b}-c.html（原版：{where}），会紧挨着原版排在画布上。原版和 tokens.css 别动；新版要换配色就在自己文件里覆盖变量。\n',
      exThis: '导出这一屏',
      demo: '演示：点页面里的按钮跳到别的屏',
      demoOn: '演示中 · 点按钮跳转',
      demoBack: '返回上一屏',
      demoRestart: '从头开始',
      demoExit: '退出演示（Esc）',
      textEdit: '改字：点页面里的文字直接改，回车保存（Esc 退出）',
      mark: '画笔标注：在页面上画圈、箭头、写字，拼成一张图交给模型',
      mkPen: '画笔',
      mkHl: '荧光笔',
      mkArrow: '箭头',
      mkRect: '方框',
      mkOval: '圆圈',
      mkText: '文字',
      mkErase: '橡皮',
      mkColor: '颜色',
      mkSize: '粗细',
      mkUndo: '撤销',
      mkRedo: '重做',
      mkClear: '全部清掉',
      mkHint: '在页面上画，画完点「交给模型」',
      mkHow_pen: '按住拖动，随手画',
      mkHow_hl: '按住拖过去，把要改的地方涂亮',
      mkHow_arrow: '从起点按住，拖到要指的地方',
      mkHow_rect: '按住拖出一个框，框住要改的地方',
      mkHow_oval: '按住拖一下，圈出要改的地方',
      mkHow_text: '在要说明的地方点一下，写字，回车写完',
      mkHow_erase: '点一下笔画就擦掉，也能按住拖过去',
      mkCoach: '直接在页面上画',
      mkCoach1: '上面挑个工具：画笔、箭头、圆圈、文字…',
      mkCoach2: '在页面上按住拖动，画出要改的地方',
      mkCoach3: '画完点「交给模型」，再补一句要怎么改',
      mkCancel: '取消',
      mkSend: '交给模型',
      mkCopy: '复制',
      mkCopyTip: '把标注图复制到剪贴板，贴到别的地方用',
      mkCopied: '标注图复制好了，贴到别处就行',
      mkCopyFail: '没能复制到剪贴板，再点一次「复制」，或者「交给模型」',
      mkSending: '正在拼图…',
      mkTextPh: '写点什么，回车完成',
      mkEmpty: '还没画东西',
      mkFail: '标注图没存成：{msg}',
      mkAsk: '〔标注〕{path}\n{notes}这是我在设计上画了标注的截图（{where}）。先用 read_image 看这张图，按图上的圈、箭头和文字改对应的地方；没标的地方别动。\n',
      mkNotes: '图上写的字：{notes}\n',
      mkQuote: '「{v}」',
      mkIn: '标注图放进输入框了，补一句要怎么改再发',
      mkMany: '画到的屏太多，只拼了前 {n} 屏，其余留成灰块',
      mkMoved: '设计换了，这次标注没交出去',
      mkNoInput: '没能放进输入框，点一下聊天输入框再点「交给模型」',
      textSaved: '已改好，写回 {file}',
      textAsk: '把页面上的「{before}」改成「{after}」（{where}；只改这一处文字，别的不动）。\n',
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
      styleAskText: '〔调样式〕{name}（{sel}）：{list}。{rules}把这些写进它的样式规则（{where}；能用设计变量就用设计变量），别写成行内 style。\n',
      ruleFrom: '- {props}：现在由 {sel} 决定（{at}）',
      ruleMaybe: '- {props}：大概由 {sel} 决定（{at}；它在 @layer / @container 里，没细算，改之前看一眼）',
      ruleInline: '- {props}：现在写在元素的行内 style 上{over}',
      ruleOver: '，盖过了 {sel}（{at}）',
      ruleAt: '{file} 第 {line} 行',
      styleArrow: '{prop} {from} → {to}',
      styleJoin: '；',
      lang: 'zh',
      stylesHead: '先挑一个风格开工',
      stylesTip: '点一个看样板，满意了点「用这个风格」，整套配色、字体、圆角放进输入框；再写要做什么',
      stylesOpen: '换个风格…',
      stylesTitle: '换个风格',
      stylesSwap: '点一个看样板；「用这个风格」让模型把现在的设计换成它（先改 tokens.css，布局和文案不动）',
      stylesAll: '全部风格',
      stylePrev: '上一个（←）',
      styleNext: '下一个（→）',
      styleUse: '用这个风格',
      samBrand: '小森',
      samNav: '发现　课程　我的',
      samHead: '把日子过得好一点',
      samSub: '一句说明文字，看看正文和次要文字的样子。',
      samGo: '开始使用',
      samMore: '了解更多 →',
      samItem: '周末手作课',
      samMeta: '2 小时 · 6 人小班',
      samPrice: '¥128',
      samTag: '新',
      samStat: '本周完成',
      samStatMeta: '比上周多 12%',
      styleText: '〔风格〕{name}——{desc}\n配色：{colors}\n字体：{fonts}\n形状：{shape}\n要点：{notes}\n{ask}',
      styleColors: '底色 {bg}，卡片 {surface}，文字 {text}，次要文字 {muted}，分隔线 {line}，主色 {primary}（上面的字 {on}），点缀 {accent}（{accUse}），链接和小字强调 {link}{bgImage}',
      accBig: '图形、大字',
      accBlock: '只做图形和色块，别拿来写字；色块上的字用 {text}',
      accShape: '只做图形，别拿来写字',
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
      tryHead: '不知道怎么开口？点一句试试',
      try1: '帮我设计一个社区健身房的会员 App',
      try2: '做一个精品咖啡店的落地页',
      try3: '做一张周末市集的活动海报',
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
      twAskHead: '〔调节〕我在右侧调节滑块里调成了下面这样：',
      twAskTail: '照这个改设计（改样式源文件，tweaks.json 里对应的 value 也改成新值）。',
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
      emptyHintPick: 'Have HTML already? Click "Browse…" or drop it here, or enter a path or a port:',
      browse: 'Browse…',
      browseTip: 'Pick a local HTML file to open',
      pathNone: "Couldn't get this file's path. Type its path to open it.",
      pageDrop: 'Drop to open this page',
      maybeDrop: 'Drop to open this folder or HTML file',
      pageDropSub: 'An HTML file, or a folder with HTML files',
      dropWeb: "The web version can't see local file paths",
      dropWebSub: 'Type its path on the computer running DSH to open it',
      dropWebSay: "The web version can't see local file paths. Type its path on the computer running DSH to open it.",
      dropWhat: 'Only HTML, folders or images',
      dropWhatSub: 'HTML and folders open in the preview; images become references',
      dropWhatWeb: 'Only images here',
      dropWhatWebSub: 'Images become references. To open HTML, type its path',
      pickDir: 'Choose folder',
      pickDirFail: "Couldn't open the folder picker: {msg}",
      hoMoved: 'That folder already has other things in it, so the code goes into {name} inside it (you can change this)',
      hoBeside: "Code can't go inside the design folder (the design stays for comparison), so it goes into {name} next to it (you can change this)",
      hoChecking: 'Checking this folder…',
      hoCheckFail: "Couldn't check this folder ({msg}). Check the path before you start",
      hintOpen: 'Preview {name}',
      headerHint: '{name} was just written. Click to preview it',
      placeholder: '/path/index.html or 5173',
      go: 'Open',
      pick: 'Select',
      pickTip: 'Click an element or drag a region to send it to the model (Esc to cancel)',
      pickAny: 'Click an element in any screen, or drag a region · Esc to cancel',
      pickOne: 'Click an element or drag a region · Esc to cancel',
      pickArea: 'Selected region',
      chipOne: '1 element',
      chipMark: 'Markup',
      chipText: 'Text edit',
      chipStyle: 'Style changes',
      chipVariant: 'Two more takes',
      chipDir: 'Direction picked',
      chipCheck: 'Check · {n} issues',
      chipCode: 'Build as code',
      chipRef: 'Reference image',
      chipTweak: 'Tweaked values',
      chipTwMake: 'Make tweaks',
      chipTwFix: 'Fix tweaks',
      chipSysEx: 'Extract design system',
      chipSysAp: 'Apply design system',
      chipLook: 'Style · {name}',
      chipTokens: 'Create design tokens',
      pickElems: '{n} elements',
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
      kindMini: 'Mini program',
      kindTablet: 'Tablet',
      kindDesktop: 'Desktop app',
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
      checkAsk: '[Design check] Found {n} problems:',
      checkTail: 'Please fix each one in the source files, touching only what is listed; for colors and type sizes, change the design tokens where possible.',
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
      ck_capsule: 'Under the mini program capsule',
      ck_island: 'Under the Dynamic Island',
      ck_homebar: 'In the home indicator area',
      ck_tabbar: 'Too many tabs',
      ck_navbar: 'No navigation bar',
      ck_winctl: 'Under the window buttons',
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
      cd_capsule: '{px}px under the top-right capsule (WeChat draws it on top; keep the top bar clear from x={x})',
      cd_island: '{px}px under the Dynamic Island (it sits at y 11–45: keep the middle of the status bar empty and start content below the status bar)',
      cd_homebar: 'text or icons in {bar} reach {px}px into the home indicator area (leave 34px: give the bar padding-bottom: 34px; env(safe-area-inset-bottom) is 0 in the preview)',
      cd_tabbar: 'the tab bar has {n} items (5 at most)',
      cd_navbar: 'nothing at y {t}–{b} (the navigation bar): top-level pages show a title or brand, other pages a centered title and a back button',
      cd_winctl: '{px}px under the{osName}window buttons (the frame draws them on top: keep {zone} clear)',
      ckOs_mac: ' Mac ',
      ckOs_win: ' Windows ',
      ckZone_mac: 'the top-left 80×40',
      ckZone_win: 'the top-right 138×32',
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
      pickShort: 'Use this',
      pickText: '[Direction picked] Use "{name}" ({where}). First move the other takes in its group ({others}) into a drafts/ subfolder (don\'t delete them), then rename it to {base}.html; move its design tokens into tokens.css (create it if missing) and switch it to tokens.css. Then build the rest.\n',
      pickKeep: '[Direction picked] Keep the original "{name}" ({where}). Move the other takes in its group ({others}) into a drafts/ subfolder (don\'t delete them) and leave everything else as is.\n',
      variantText: 'Make two alternative designs of "{name}" in clearly different directions (layout or visual style). Save them next to it as {b}-b.html and {b}-c.html (original: {where}); they will sit right after the original on the canvas. Leave the original and tokens.css unchanged; override variables inside the new files if they need other colors.\n',
      exThis: 'Export this screen',
      demo: 'Play: tap buttons in the page to move between screens',
      demoOn: 'Playing · tap to navigate',
      demoBack: 'Back',
      demoRestart: 'Start over',
      demoExit: 'Stop playing (Esc)',
      textEdit: 'Edit text: click any text in the page, Enter to save (Esc to stop)',
      mark: 'Mark up: draw circles, arrows and notes on the page, then hand it to the model as one image',
      mkPen: 'Pen',
      mkHl: 'Highlighter',
      mkArrow: 'Arrow',
      mkRect: 'Rectangle',
      mkOval: 'Circle',
      mkText: 'Text',
      mkErase: 'Eraser',
      mkColor: 'Color',
      mkSize: 'Size',
      mkUndo: 'Undo',
      mkRedo: 'Redo',
      mkClear: 'Clear all',
      mkHint: 'Draw on the page, then send it to the model',
      mkHow_pen: 'Press and drag to draw freehand',
      mkHow_hl: 'Drag over what needs changing to highlight it',
      mkHow_arrow: 'Press at the start and drag to what you mean',
      mkHow_rect: 'Drag to box what needs changing',
      mkHow_oval: 'Drag to circle what needs changing',
      mkHow_text: 'Click where the note goes, type, Enter to finish',
      mkHow_erase: 'Click a stroke to erase it, or drag across',
      mkCoach: 'Draw right on the page',
      mkCoach1: 'Pick a tool above: pen, arrow, circle, text…',
      mkCoach2: 'Press and drag on the page to mark what to change',
      mkCoach3: 'Then click "Send to model" and add a line on what to do',
      mkCancel: 'Cancel',
      mkSend: 'Send to model',
      mkCopy: 'Copy',
      mkCopyTip: 'Copy the marked-up image to paste somewhere else',
      mkCopied: 'Markup image copied. Paste it anywhere',
      mkCopyFail: 'Could not copy to the clipboard. Click Copy again, or Send to model',
      mkSending: 'Building the image…',
      mkTextPh: 'Type a note, Enter to finish',
      mkEmpty: 'Nothing drawn yet',
      mkFail: 'Could not save the markup: {msg}',
      mkAsk: '[Markup] {path}\n{notes}A screenshot of the design with my markup on it ({where}). Look at it with read_image first, then change what the circles, arrows and notes point at; leave unmarked parts alone.\n',
      mkNotes: 'Notes written on it: {notes}\n',
      mkQuote: '"{v}"',
      mkIn: 'Markup added to the input. Say what to change, then send',
      mkMany: 'Too many screens marked: captured the first {n}, the rest are gray',
      mkMoved: 'The design changed, so the markup was not sent',
      mkNoInput: 'Could not add it to the input. Click the chat input, then Send to model again',
      textSaved: 'Saved to {file}',
      textAsk: 'Change the text "{before}" to "{after}" on the page ({where}; only this text, nothing else).\n',
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
      styleAskText: '[Style] {name} ({sel}): {list}. {rules}Put it in its stylesheet rule ({where}), using design tokens where you can, not an inline style.\n',
      ruleFrom: '- {props}: currently set by {sel} ({at})',
      ruleMaybe: '- {props}: probably set by {sel} ({at}; it sits in @layer / @container and was not fully resolved, check before editing)',
      ruleInline: '- {props}: currently in the element\'s inline style{over}',
      ruleOver: ', overriding {sel} ({at})',
      ruleAt: '{file} line {line}',
      styleArrow: '{prop} {from} → {to}',
      styleJoin: '; ',
      lang: 'en',
      stylesHead: 'Start from a style',
      stylesTip: 'Pick one to see a sample; "Use this style" puts its colors, fonts and shapes in the chat box, then say what to make',
      stylesOpen: 'Try another style…',
      stylesTitle: 'Change the style',
      stylesSwap: 'Pick one to see a sample; "Use this style" has the model restyle the current design (tokens.css first; layout and copy stay)',
      stylesAll: 'All styles',
      stylePrev: 'Previous (←)',
      styleNext: 'Next (→)',
      styleUse: 'Use this style',
      samBrand: 'Bloom',
      samNav: 'Explore  Classes  Me',
      samHead: 'Make every day a little better',
      samSub: 'One line of supporting text to show body and muted colors.',
      samGo: 'Get started',
      samMore: 'Learn more →',
      samItem: 'Weekend workshop',
      samMeta: '2 hrs · small group of 6',
      samPrice: '$18',
      samTag: 'New',
      samStat: 'Done this week',
      samStatMeta: '12% more than last week',
      styleText: '[Style] {name}: {desc}\nColors: {colors}\nFonts: {fonts}\nShape: {shape}\nNotes: {notes}\n{ask}',
      styleColors: 'background {bg}, cards {surface}, text {text}, muted text {muted}, lines {line}, primary {primary} (text on it {on}), accent {accent} ({accUse}), links and small emphasis {link}{bgImage}',
      accBig: 'graphics and large text only',
      accBlock: 'graphics and color blocks only, not for text; text on those blocks uses {text}',
      accShape: 'graphics only, not for text',
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
      tryHead: 'Not sure where to start? Try one',
      try1: 'Design a member app for a neighborhood gym',
      try2: 'Make a landing page for a specialty coffee shop',
      try3: 'Make a poster for a weekend street market',
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
      twAskHead: '[Tweaks] I set the tweaks in the sidebar to these values:',
      twAskTail: 'Change the design to match (edit the style sources and update the matching values in tweaks.json).',
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
        // 一次替换完：填进去的内容里就算有「{x}」（比如目录名）也不会再被换掉
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
        return s
      }
    }

    // ── 样式（DSH 设计变量，深浅主题跟着走）──────────────────────────────────

    const ACCENT = '#4d6bfe'
    const PICK_SRC = 'dsh-design-studio' // 输入框里点选标签的来源名（样式里也用）
    // 输入框里的各种标签：图标按来源名分（DSH 的标签上只带来源名），消息里和悬停卡片按 data-i
    const CHIP_ICON = {
      pick: 'M4 4l6.5 16 2.3-6.7L19.5 11z M13 13l6 6',
      mark: 'M4 20l4.5-1L19 8.5a2.1 2.1 0 0 0-3-3L5.5 16z M14 7.5l3 3',
      text: 'M5 7V5h14v2 M12 5v14 M9 19h6',
      style: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
      layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
      check: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M8 12.5l2.7 2.7L16 10',
      code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
      image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M14.5 9a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
      look: 'M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-1-1-1.4-1-2.4 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z M7.5 12h.01 M9.5 7.8h.01 M14.5 7.8h.01',
    }
    const chipSrc = (i) => i === 'pick' ? PICK_SRC : `${PICK_SRC}-${i}`
    const iconUrl = (d) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'><path d='${d}'/></svg>`)}")`
    const EASE = 'cubic-bezier(.2,.8,.2,1)'
    const CSS = `
.ddp{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:12px;container-type:inline-size}
.ddp-bar{position:relative;z-index:8;display:flex;align-items:center;gap:4px;height:40px;padding:0 8px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));flex:none}
.ddp-bar.editing>:not(form){display:none}
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
.ddp-dev.k-app,.ddp-dev.k-miniprogram,.ddp-dev.k-tablet{background:#0e0e12;box-shadow:inset 0 0 0 1.5px #2b2b33,0 0 0 1px rgba(0,0,0,.45),0 24px 60px rgba(0,0,0,.3)}
.ddp-dev.fill.k-app,.ddp-dev.fill.k-miniprogram,.ddp-dev.fill.k-tablet{background:#fff;box-shadow:none}
.ddp-vp{position:absolute;overflow:hidden;background:#fff;isolation:isolate}
.ddp-vp:has(.ddp-scr.dk),.ddp-scr.dk .ddp-frame{background:#111}
.ddp-chrome{position:absolute;left:0;right:0;top:0;align-items:center;gap:7px;padding:0 13px;background:#ebebef;border-bottom:1px solid rgba(0,0,0,.07);border-radius:inherit;border-bottom-left-radius:0;border-bottom-right-radius:0;overflow:hidden}
.ddp-chrome i{width:11px;height:11px;border-radius:50%;background:#ff5f57;flex:none}
.ddp-chrome i:nth-child(2){background:#febc2e}
.ddp-chrome i:nth-child(3){background:#28c840}
.ddp-chrome span{flex:1;min-width:0;margin:0 60px 0 18px;height:20px;border-radius:6px;background:rgba(0,0,0,.05);color:#6b6b74;font:12px/20px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-island{position:absolute;left:50%;width:118px;height:34px;margin-left:-59px;border-radius:20px;background:#000;z-index:4;pointer-events:none}
.ddp-cap{position:absolute;width:87px;height:32px;z-index:4;pointer-events:none;overflow:visible;fill:#000}
.ddp-dev.k-desktop{box-shadow:0 0 0 .5px rgba(0,0,0,.3),0 22px 60px rgba(0,0,0,.28)}
.ddp-dev.fill.k-desktop{box-shadow:none}
.ddp-win{position:absolute;z-index:4;pointer-events:none;overflow:visible}
.ddp-win .x{fill:none;stroke:#1f1f1f;stroke-width:1}
.ddp-win.w .x{stroke:#fff}
.ddp-cap .pl{fill:rgba(255,255,255,.6);stroke:rgba(0,0,0,.08);stroke-width:.5}
.ddp-cap .sp{stroke:rgba(0,0,0,.15);stroke-width:.5}
.ddp-cap .rg{fill:none;stroke:#000;stroke-width:2}
.ddp-cap.w{fill:#fff}
.ddp-cap.w .pl{fill:rgba(0,0,0,.15);stroke:rgba(255,255,255,.25)}
.ddp-cap.w .sp{stroke:rgba(255,255,255,.25)}
.ddp-cap.w .rg{stroke:#fff}
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
.ddp-mark{position:absolute;inset:0;z-index:6;outline:none;box-shadow:inset 0 0 0 2px rgba(77,107,254,.5)}
.ddp-mark .cv{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none}
.ddp-mark .cv.tx{cursor:text}
.ddp-mark .cv.er{cursor:cell}
.ddp-mark textarea{position:absolute;z-index:2;margin:0;padding:0 2px;border:1px dashed rgba(77,107,254,.85);border-radius:3px;background:rgba(255,255,255,.1);font-family:${'"Kaiti SC","STKaiti","KaiTi","楷体",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'};font-weight:700;line-height:1.3;resize:none;overflow:hidden;white-space:pre;outline:none;text-shadow:0 0 2px rgba(255,255,255,.9),0 0 3px rgba(255,255,255,.9)}
.ddp-mark textarea.lt{text-shadow:0 0 2px rgba(0,0,0,.7),0 0 3px rgba(0,0,0,.7)}
.ddp-mark textarea::placeholder{color:inherit;opacity:.55}
.ddp-mk-top,.ddp-mk-bot{position:absolute;left:8px;right:8px;z-index:3;display:flex;justify-content:center;pointer-events:none}
.ddp-mk-top{top:10px}
.ddp-mk-bot{bottom:12px}
.ddp-mk-tools{pointer-events:auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px;max-width:100%;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 8px 24px rgba(0,0,0,.18),0 0 0 .5px var(--dsw-alias-border-l3);animation:ddp-in .16s ${EASE}}
.ddp-mk-tools .ddp-btn.sel{background:rgba(77,107,254,.14);color:${ACCENT}}
.ddp-mk-color{position:relative;display:inline-flex}
.ddp-mk-color>.ddp-btn i{width:15px;height:15px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18),0 0 0 1px rgba(255,255,255,.35)}
.ddp-mk-pal{position:absolute;left:50%;top:34px;transform:translateX(-50%);z-index:2;display:grid;grid-template-columns:repeat(4,22px);gap:7px;padding:9px;border-radius:11px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 12px 32px rgba(0,0,0,.24),0 0 0 .5px var(--dsw-alias-border-l3)}
.ddp-mk-pal button{width:22px;height:22px;padding:0;border:0;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.ddp-mk-pal button.sel{outline:2px solid ${ACCENT};outline-offset:2px}
.ddp-mk-sz{display:inline-flex}
.ddp-mk-sz .ddp-btn{min-width:24px;padding:0 4px}
.ddp-mk-sz i{border-radius:50%;background:currentColor}
.ddp-mk-bar{pointer-events:auto;display:flex;align-items:center;gap:6px;max-width:100%;padding:4px 4px 4px 14px;border-radius:999px;background:rgba(24,24,27,.94);color:#f4f4f5;font-size:12px;
  box-shadow:0 8px 24px rgba(0,0,0,.25);animation:ddp-in .16s ${EASE}}
.ddp-mk-bar span{flex:1;min-width:0;margin-right:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(244,244,245,.8)}
.ddp-mk-bar span b{margin-right:6px;font-weight:600;color:#fff}
.ddp-mk-bar button{flex:none;height:28px;padding:0 13px;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#f4f4f5;font:inherit;cursor:pointer}
.ddp-mk-bar button:hover:not(:disabled){background:rgba(255,255,255,.2)}
.ddp-mk-bar button.go{background:${ACCENT};color:#fff;font-weight:600}
.ddp-mk-bar button.go:hover:not(:disabled){background:#3d5bf0}
.ddp-mk-bar button.go.idle{background:rgba(77,107,254,.45);color:rgba(255,255,255,.75)}
.ddp-mk-coach{position:absolute;left:50%;top:50%;z-index:2;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 32px);padding:14px 18px 12px;border-radius:14px;pointer-events:none;background:rgba(24,24,27,.86);color:#f4f4f5;font-size:13px;line-height:1.55;box-shadow:0 10px 30px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:ddp-in .2s ease}
.ddp-mk-coach b{display:block;margin-bottom:6px;font-size:14px;font-weight:600;color:#fff}
.ddp-mk-coach ol{margin:0;padding:0 0 0 1.3em;color:rgba(244,244,245,.86)}
.ddp-mk-coach li+li{margin-top:2px}
.ddp-mk-bar button:disabled{opacity:.5;cursor:default}
.ddp-skel{position:absolute;inset:0;z-index:2;padding:28px 24px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-bg-layer-1);transition:opacity .3s ease;pointer-events:none}
.ddp-skel.gone{opacity:0}
.ddp-skel b{display:block;border-radius:8px;background:var(--dsw-alias-bg-layer-2);position:relative;overflow:hidden}
.ddp-skel b::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(127,127,127,.14),transparent);animation:ddp-shine 1.3s ease-in-out infinite}
@keyframes ddp-shine{100%{transform:translateX(100%)}}
.ddp-wait{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px}
.ddp-wait .card{position:relative;width:min(78%,440px);aspect-ratio:16/11;border-radius:12px;overflow:hidden;box-shadow:0 0 0 .5px var(--dsw-alias-border-l3),0 14px 40px rgba(0,0,0,.14);animation:ddp-ghost 1.6s ease-in-out infinite}
.ddp-wait p{margin:0;color:var(--dsw-alias-label-tertiary);text-align:center;line-height:1.6}
.ddp-toast{position:absolute;left:12px;right:12px;top:14px;width:fit-content;max-width:calc(100% - 24px);margin-inline:auto;z-index:7;padding:7px 14px;border-radius:14px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.5;text-align:center;overflow-wrap:anywhere;box-shadow:0 6px 20px rgba(0,0,0,.2);animation:ddp-in .2s ease}
.ddp-empty{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;justify-content:safe center;gap:12px;padding:32px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
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
.ddp-empty form{display:flex;flex-wrap:wrap;gap:6px;width:100%;max-width:320px;margin-top:4px}
.ddp-browse{height:26px;padding:0 12px;flex:none;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.4));border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.ddp-browse:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.ddp-drop .in.no{border-color:var(--dsw-alias-label-tertiary)}
.ddp-drop .in.no svg{color:var(--dsw-alias-label-tertiary)}
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
.ddp-drop.soft{pointer-events:none}
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
.ddp-sc .pv{position:relative;display:block;height:74px;border-radius:10px;overflow:hidden;container-type:inline-size;box-shadow:0 0 0 .5px rgba(127,127,127,.35);transition:transform .15s ${EASE},box-shadow .15s}
.ddp-sc:hover .pv,.ddp-sc:focus-visible .pv{transform:translateY(-1px);box-shadow:0 0 0 1.5px ${ACCENT},0 6px 16px rgba(0,0,0,.12)}
.ddp-sc:focus-visible{outline:none}
.ddp-sc:hover,.ddp-sc:focus-visible{color:var(--dsw-alias-label-primary)}
.ddp-sc .pv .ddp-sam{width:calc(100cqw / .32);min-height:calc(100% / .32);transform:scale(.32);transform-origin:0 0;pointer-events:none}
.ddp-sam{display:flex;flex-direction:column;gap:7px;padding:12px 14px 14px;font-size:11px;line-height:1.45;text-align:left;overflow:hidden;box-sizing:border-box}
.ddp-sam b{font-weight:600;color:inherit} /* 空白页的 .ddp-empty b 会把字染成界面色 */
.ddp-sam .top{display:flex;align-items:center;gap:6px;margin-bottom:3px}
.ddp-sam .top b{font-size:12px}
.ddp-sam .lg{width:14px;height:14px;flex:none}
.ddp-sam .nv{margin-left:auto;font-size:10px;white-space:nowrap}
.ddp-sam .av{width:18px;height:18px;flex:none;border-radius:50%}
.ddp-sam h5{margin:2px 0 0;font-size:21px;line-height:1.2}
.ddp-sam p{margin:0}
.ddp-sam .acts{display:flex;align-items:center;gap:12px;margin:2px 0 4px;white-space:nowrap}
.ddp-sam .bt{display:inline-flex;align-items:center;height:26px;padding:0 13px;font-weight:600}
.ddp-sam .cards{display:grid;grid-template-columns:1.25fr 1fr;gap:9px;align-items:stretch}
.ddp-sam .cd{display:flex;flex-direction:column;gap:2px;min-width:0;padding:8px;font-size:10px;box-sizing:border-box}
.ddp-sam .cd>*{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ddp-sam .cd>b{font-size:11.5px}
.ddp-sam .im{display:block;flex:none;height:46px;margin-bottom:4px}
.ddp-sam .pr{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px}
.ddp-sam .pr b{font-size:15px;font-weight:700}
.ddp-sam .chip{padding:1px 7px;border-radius:999px;font-size:9.5px;font-weight:600}
.ddp-sam .cd>.num{margin:2px 0 6px;font-size:28px;line-height:1.1}
.ddp-sam .bar{position:relative;display:block;flex:none;height:5px;margin-bottom:5px;border-radius:3px}
.ddp-sam .bar i{position:absolute;left:0;top:0;bottom:0;width:86%;border-radius:inherit}
.ddp-samview{display:flex;flex-direction:column;gap:8px;text-align:left}
.ddp-samview .all{align-self:flex-start;height:24px;margin-left:-4px;font-size:12px}
.ddp-samview .all svg,.ddp-samview .row svg{width:14px;height:14px}
.ddp-samview .ddp-sam{border-radius:12px;box-shadow:0 0 0 .5px rgba(127,127,127,.35),0 8px 24px rgba(0,0,0,.10);animation:ddp-in .2s ${EASE}}
.ddp-samview .meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px}
.ddp-samview .meta b{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ddp-samview .meta p{flex-basis:100%;margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ddp-samview .sw{display:flex;gap:3px;margin-left:auto}
.ddp-samview .sw i{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 .5px rgba(127,127,127,.5)}
.ddp-samview .row{display:flex;align-items:center;gap:2px}
.ddp-samview .row .ddp-btn{height:26px;min-width:26px}
.ddp-samview .row .nx svg{transform:scaleX(-1)}
.ddp-samview .row em{min-width:40px;font-style:normal;font-size:11px;text-align:center;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.ddp-samview .row .ddp-go{margin-left:auto;height:28px;font-size:12px}
.ddp-sc .nm{font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ddp-tries{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:440px}
.ddp-tries>span{flex-basis:100%;font-size:11px;line-height:16px}
.ddp-try{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.ddp-try:hover{border-color:${ACCENT};color:${ACCENT}}
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
.ddp-flows .halo{fill:none;stroke:var(--dsw-alias-bg-layer-2);stroke-linecap:round;stroke-linejoin:round}
.ddp-flows .ln{fill:none;stroke:${ACCENT};stroke-linecap:round;stroke-linejoin:round}
.ddp-flows .hd{fill:${ACCENT};stroke:none}
.ddp-flows .dot{fill:${ACCENT};stroke:#fff}
.ddp-flows .hot{fill:rgba(77,107,254,.1);stroke:${ACCENT}}
.ddp-flows .hot.nav{fill:none;stroke-opacity:.75}
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
.ddp-toast.mk{top:auto;bottom:62px}
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
.ddp-take{flex:none;display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 8px 0 6px;border:0;border-radius:10px;
  background:rgba(77,107,254,.12);color:${ACCENT};font:inherit;font-size:11px;font-weight:500;cursor:pointer}
.ddp-take:hover{background:rgba(77,107,254,.2)}
.ddp-take svg{width:12px;height:12px;flex:none}
/* 画布缩得很小时只留 ✓，屏名先保住 */
.ddp-lab{container-type:inline-size}
.ddp-lab>span:first-child{min-width:3em}
@container (max-width:170px){.ddp-take{padding:0 4px}.ddp-take span{display:none}}
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
.ddp-sys form input,.ddp-ho input[type=text]{flex:1;min-width:0;box-sizing:border-box;height:28px;padding:0 9px;border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12px inherit;outline:none}
.ddp-sys form input:focus,.ddp-ho input[type=text]:focus{border-color:${ACCENT}}
.ddp-tokens.ddp-sys footer form button{width:auto;height:28px;flex:none;justify-content:center;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 12px}
.ddp-tokens.ddp-sys footer form button:disabled{opacity:.45;cursor:default}
.ddp-ho .bd{padding:0 14px 10px}
.ddp-ho .row{padding:9px 0 10px;border-top:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.16))}
.ddp-ho .row:first-child{border-top:0}
.ddp-ho label{display:block;margin-bottom:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ddp-ho .pathrow{display:flex;gap:6px;align-items:center}
.ddp-ho .moved{margin:6px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ddp-ho .moved.bad{color:var(--dsw-alias-state-error-primary,#d54941)}
.ddp-dirbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.ddp-dirbtn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.5))}
.ddp-dirbtn:disabled{opacity:.5;cursor:default}
.ddp-dirbtn svg{width:15px;height:15px}
.ddp-tokens.ddp-sys footer form button.ddp-dirbtn{width:28px;padding:0;border:1px solid var(--dsw-alias-separator-primary,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:8px}
.ddp-tokens.ddp-sys footer form button.ddp-dirbtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.5))}
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
/* 标注底栏：右侧栏窄时「这支笔怎么用」折成两行，不被三个按钮挤成省略号 */
@container (max-width:640px){.ddp-mk-bar{border-radius:18px}.ddp-mk-bar span{white-space:normal;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}}
/* 画标注时预览不动，画布右下角的缩放按钮被标注层盖着也点不到：先收起来，免得和底栏叠在一起 */
.ddp-stage:has(>.ddp-mark) .ddp-zoom{display:none}
/* 输入框里的标签：DSH 的引用标签换成我们的图标 + 底色；消息里我们自己画同样的样子 */
[data-composer-chip^="${PICK_SRC}"]>span,.ddp-pickpill{border-radius:6px;padding:0 6px 0 5px;background:var(--dsw-alias-state-business-tertiary,color-mix(in srgb,${ACCENT} 13%,transparent));color:var(--dsw-alias-state-business-primary,${ACCENT});cursor:default}
[data-composer-chip^="${PICK_SRC}"]>span>[aria-hidden]{width:12px;height:12px;align-self:center;font-size:0;background:currentColor}
[data-composer-chip^="${PICK_SRC}"]>span>[aria-hidden],.ddp-pickpill::before,.ddp-pickcard b::before{-webkit-mask-position:center;-webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;mask-position:center;mask-size:contain;mask-repeat:no-repeat}
${Object.entries(CHIP_ICON).map(([k, d]) => `[data-composer-chip="${chipSrc(k)}"]>span>[aria-hidden],.ddp-pickpill[data-i="${k}"]::before,.ddp-pickcard[data-i="${k}"] b::before{-webkit-mask-image:${iconUrl(d)};mask-image:${iconUrl(d)}}`).join('\n')}
.ddp-pickpill{display:inline;margin:0 2px;font-weight:500;white-space:inherit;overflow-wrap:anywhere;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ddp-pickpill::before{content:'';display:inline-block;width:.86em;height:.86em;margin-right:4px;vertical-align:-.1em;background:currentColor}
.ddp-pickcard{position:fixed;z-index:2147483000;max-width:min(340px,calc(100vw - 24px));padding:10px 12px;border-radius:12px;pointer-events:none;
  background:linear-gradient(var(--dsw-specific-menu,transparent),var(--dsw-specific-menu,transparent)),var(--dsw-specific-input-major,var(--dsw-alias-bg-base,#fff));
  color:var(--dsw-alias-label-primary,#18181b);font-size:13px;line-height:1.5;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  box-shadow:var(--dsw-elevation-prominent,0 0 0 1px rgba(0,0,0,.08),0 10px 28px rgba(0,0,0,.18));animation:ddp-in .12s ${EASE}}
.ddp-pickcard b{display:flex;align-items:center;gap:6px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-pickcard b::before{content:'';flex:none;width:14px;height:14px;background:${ACCENT}}
.ddp-pickcard code{display:block;margin-top:3px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#52525b);word-break:break-all}
.ddp-pickcard span{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary,#a1a1aa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-pickcard p{margin:3px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ddp-pickcard img{display:block;width:100%;max-height:200px;margin:7px 0 2px;object-fit:contain;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
.ddp-pickcard>i{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.ddp-pickcard>i>i{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(127,127,127,.35)}
.ddp-pickcard.wide{width:min(320px,calc(100vw - 24px))}
`
    // 页面不刷新就换了新版插件时，旧版留下的样式要换成新的；卸载时一起拿掉
    function ensureStyle() {
      if (typeof document === 'undefined') return () => {}
      let el = document.getElementById('dsh-design-studio-style')
      if (!el) {
        el = document.createElement('style')
        el.id = 'dsh-design-studio-style'
        document.head.appendChild(el)
      }
      if (el.textContent !== CSS) el.textContent = CSS
      return () => { if (el.textContent === CSS) el.remove() }
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
      miniprogram: () => svg([h('rect', { key: 1, x: 6, y: 2.5, width: 12, height: 19, rx: 2.4 }), h('rect', { key: 2, x: 11.5, y: 5.2, width: 4.5, height: 2.4, rx: 1.2 })]),
      tablet: () => svg([h('rect', { key: 1, x: 4.5, y: 3, width: 15, height: 18, rx: 2.2 }), h('path', { key: 2, d: 'M11 18h2' })]),
      desktop: () => svg([h('rect', { key: 1, x: 2.5, y: 4.5, width: 19, height: 15, rx: 2.6 }), h('path', { key: 2, d: 'M9 4.5v15' }), h('path', { key: 3, d: 'M4.8 7.2h.01M6.8 7.2h.01' })]),
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
      pen: () => svg([h('path', { key: 1, d: 'M4.5 19.5l.9-4.2L15.6 5.1a2 2 0 0 1 2.9 0l.4.4a2 2 0 0 1 0 2.9L8.7 18.6z' }), h('path', { key: 2, d: 'M13.8 6.9l3.3 3.3' })]),
      marker: () => svg([h('path', { key: 1, d: 'M14.5 4.5l5 5-7.5 7.5H8.5v-3.5z' }), h('path', { key: 2, d: 'M8.5 13.5L4 18h4.5' }), h('path', { key: 3, d: 'M13 20.5h7' })]),
      arrow: () => svg([h('path', { key: 1, d: 'M5 19L19 5' }), h('path', { key: 2, d: 'M10 5h9v9' })]),
      square: () => svg([h('rect', { key: 1, x: 4, y: 5, width: 16, height: 14, rx: 1.6 })]),
      circle: () => svg([h('ellipse', { key: 1, cx: 12, cy: 12, rx: 8.5, ry: 7.5 })]),
      eraser: () => svg([h('path', { key: 1, d: 'M8.6 19.5L4.4 15.3a1.5 1.5 0 0 1 0-2.1l8.8-8.8a1.5 1.5 0 0 1 2.1 0l4.2 4.2a1.5 1.5 0 0 1 0 2.1L11 19.5z' }), h('path', { key: 2, d: 'M8.8 9.2l6 6' }), h('path', { key: 3, d: 'M11 19.5h9' })]),
      undo: () => svg([h('path', { key: 1, d: 'M9 14L4.5 9.5 9 5' }), h('path', { key: 2, d: 'M4.5 9.5H15a5 5 0 0 1 0 10h-3' })]),
      redo: () => svg([h('path', { key: 1, d: 'M15 14l4.5-4.5L15 5' }), h('path', { key: 2, d: 'M19.5 9.5H9a5 5 0 0 0 0 10h3' })]),
      trash: () => svg([h('path', { key: 1, d: 'M4.5 7h15M9.5 7V4.5h5V7' }), h('path', { key: 2, d: 'M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12' }), h('path', { key: 3, d: 'M10.5 11v5.5M13.5 11v5.5' })]),
      folder: () => svg([h('path', { key: 1, d: 'M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' })]),
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

    /** 打开一个本地文件 / 文件夹 / 端口（地址栏、「浏览…」、拖进来都走这里），打开后马上拉一次新状态 */
    async function openTarget(sid, target) {
      const s = await post('open', { session: sid, target })
      const p = poller(sid)
      p.stop()
      p.start()
      return s
    }

    // DSH 桌面版给的两座桥：拿选中 / 拖进来的文件的真实路径；弹系统的选文件夹窗口。网页版没有，对应的按钮就不显示
    const hostPaths = () => { const b = globalThis.__DSH_HOST_PATHS__; return b && typeof b.pathFor === 'function' ? b : null }
    const dirPicker = () => { const b = globalThis.__DSH_DIRECTORY_PICKER__; return b && typeof b.pick === 'function' ? b : null }
    const pathOf = (file) => { try { const b = hostPaths(); return (b && file && b.pathFor(file)) || '' } catch { return '' } }
    const HTML_FILE = /\.html?$/i
    const isPageFile = (f) => !!f && (HTML_FILE.test(f.name || '') || /^text\/html$/i.test(f.type || ''))

    /**
     * 拖进来的是什么：'page' HTML 文件（桌面版能打开）、'maybe' 没类型的（多半是文件夹）、'web' 这两种但网页版拿不到路径、
     * 'image' 图片（当参考图）、'other' 别的文件。拖着的时候只看得到类型（文件夹、没后缀的文件类型是空的）
     */
    function dragKind(dt) {
      const all = [...((dt && dt.items) || [])].filter(Boolean)
      const items = all.filter((x) => x.kind === 'file')
      if (!items.length) return 'image'
      // 从网页上拖下来的图：带着网址和 <img> 那段 HTML，文件那项常常没类型——是图，不是文件夹
      const strs = all.filter((x) => x.kind === 'string').map((x) => String(x.type).toLowerCase())
      if (strs.includes('text/uri-list') && strs.includes('text/html') && items.every((x) => !x.type || /^image\//i.test(x.type))) return 'image'
      // 拖着时看不到文件名：标了 HTML 的是页面；没类型的多半是文件夹（也可能是 .ts、Makefile 这种），蒙层话说中性一点
      if (items.some((x) => /^text\/html$/i.test(x.type))) return hostPaths() ? 'page' : 'web'
      if (items.some((x) => !x.type)) return hostPaths() ? 'maybe' : 'web'
      if (items.some((x) => /^image\//i.test(x.type))) return 'image'
      return 'other'
    }

    /** 松手时拖进来的东西 → { page: 要打开的文件 / 文件夹的 File, dir: 是不是文件夹, image: 图片 File } */
    function droppedOf(dt) {
      const out = { page: null, dir: false, image: null, any: false }
      const items = [...((dt && dt.items) || [])].filter((x) => x && x.kind === 'file')
      const list = items.length
        ? items.map((x) => {
          let dir = false
          // 文件夹只有 entry 分得出来，得在 drop 里同步取
          try { const en = typeof x.webkitGetAsEntry === 'function' ? x.webkitGetAsEntry() : null; dir = !!(en && en.isDirectory) } catch { dir = false }
          let f = null
          try { f = x.getAsFile() } catch { f = null }
          return { f, dir }
        })
        : [...((dt && dt.files) || [])].map((f) => ({ f, dir: false }))
      for (const { f, dir } of list) {
        if (!f) continue
        out.any = true
        if (!out.page && (dir || isPageFile(f))) { out.page = f; out.dir = dir }
        else if (!out.image && !dir && /^image\//i.test(f.type || '')) out.image = f
      }
      return out
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

    // 插进输入框的字前后怎么接。prev / next 是光标前后的字（读不到为 null），start 是光标位置。
    // 光标前有字、又不在行首 → 先换行；open（要用户接着说要求）且字以换行结尾 → 末尾多留一个空行给光标：
    // 输入框里末尾单个换行显示不出来，光标会回到上一行末尾，接着打的字就粘在那行后面。
    // 不以换行结尾的（「照这个风格来做：」）光标就跟在后面接着写
    function padInsert(text, prev, next, start, open) {
      const lead = start > 0 && !(prev != null && prev.endsWith('\n')) ? '\n' : ''
      let body = text
      let back = 0
      if (open && body.endsWith('\n')) {
        body = body.replace(/\n+$/, '') + '\n'
        if (!(next != null && next.startsWith('\n'))) { body += '\n'; back = 1 }
      }
      return { text: lead + body, back }
    }

    // ── 点选标签：DSH 0.2.1 起输入框里放一个短标签（像 @文件），悬停看详情；发出去模型照样拿到整段 ──────

    const PICK_LINE = /^((文件|页面|位置|组件|HTML|样式|包含|屏宽)：|- )/
    const baseName = (s) => String(s || '').replace(/[?#].*$/, '').split(/[\\/]/).filter(Boolean).pop() || ''
    // 标签复制 / 发出去都是整段，前后空一行：贴回输入框、和用户的话挨着都不会粘成一块
    const pickClip = (text) => `\n\n${text}\n\n`

    /** 从插进去的那段字里读出标签要显示的：元素名、字、位置、大小、文件 */
    function pickInfo(text) {
      const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
      const head = lines[0] || ''
      const get = (k) => { const l = lines.find((x) => x.startsWith(k)); return l ? l.slice(k.length).trim() : '' }
      const file = baseName(get('文件：') || get('页面：'))
      let m = head.match(/^〔选中元素〕(.*?)(?:「(.*)」)?$/)
      if (m) return { kind: 'el', name: m[1], text: m[2] || '', sel: get('位置：'), size: (get('样式：').match(/^(\d+×\d+)/) || [])[1] || '', file }
      m = head.match(/^〔选中区域〕.*?(\d+×\d+)/)
      if (/^〔选中区域〕/.test(head)) return { kind: 'area', n: lines.filter((l) => l.startsWith('- ')).length, size: m ? m[1] : '', file, items: lines.filter((l) => l.startsWith('- ')).slice(0, 3).map((l) => l.slice(2)) }
      return null
    }

    /** 标签上的字固定：「1 个元素」，区域写里面有几个元素（是哪个元素悬停看） */
    function pickLabel(info, t) {
      if (!info) return ''
      if (info.kind !== 'area') return t('chipOne')
      return info.n > 1 ? t('pickElems', { n: info.n }) : info.n === 1 ? t('chipOne') : t('pickArea')
    }

    /** 点选标签的悬停卡片：元素上的字、元素名、大小、选择器、文件 */
    function pickItems(info, t) {
      if (info.kind === 'area') return [['b', t('pickArea')], ['code', [info.n ? t('pickElems', { n: info.n }) : '', info.size].filter(Boolean).join(' · ')], ...info.items.map((x) => ['span', x]), ['span', info.file]]
      return [['b', info.text || info.name], ['code', [info.name, info.size].filter(Boolean).join(' · ')],
        info.sel && info.sel !== info.name ? ['code', info.sel.length > 90 ? '…' + info.sel.slice(-90) : info.sel] : null, ['span', info.file]]
    }

    // ── 别的整段（标注、调样式、风格、体检、转成代码…）也一样：输入框里一个短标签，发出去模型拿到整段 ──────
    // 按我们自己的模板认（中英文各一份），{x} 那里是一行里的任意字

    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 「文件：…」以扩展名结尾、「页面：…」是地址（没有空格和中文）：旧消息里紧贴在后面的用户的话不会被算进来
    const WHERE_RE = '(?:文件：[^\\n]*\\.[A-Za-z0-9]{1,8}|页面：[!-~]*)'
    /** 模板 → 正则源和各组的名字；sp：哪个 {x} 用什么正则（默认一行里任意字，{where} 是「文件：/页面：」那行） */
    function tplSrc(tpl, sp = {}) {
      const keys = []
      const src = String(tpl).replace(/\n+$/, '').split(/(\{\w+\})/).map((p) => {
        const m = p.match(/^\{(\w+)\}$/)
        if (!m) return reEsc(p)
        keys.push(m[1])
        return '(' + (sp[m[1]] || (m[1] === 'where' ? WHERE_RE : '[^\\n]*')) + ')'
      }).join('')
      return { src, keys }
    }
    /** 正则源里的捕获组都改成不捕获（拼进别的模板里，免得组的序号乱） */
    const noCap = (src) => src.replace(/(?<!\\)\((?!\?)/g, '(?:')
    const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi
    const hexes = (s) => [...new Set(String(s || '').match(HEX) || [])]
    const fileOf = (v) => baseName(String(v.where || '').replace(/^(文件|页面)：/, ''))

    // 标注图、参考图的小图（悬停卡片上看一眼）：只在这次打开 DSH 时记着，最多 24 张
    const chipThumbs = new Map()
    function keepThumb(path, src) {
      try {
        const w = src.naturalWidth || src.width
        const ht = src.naturalHeight || src.height
        const k = Math.min(1, 640 / w, 640 / ht)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(w * k))
        c.height = Math.max(1, Math.round(ht * k))
        const g = c.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, c.width, c.height)
        g.drawImage(src, 0, 0, c.width, c.height)
        chipThumbs.set(path, { src: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height })
        if (chipThumbs.size > 24) chipThumbs.delete(chipThumbs.keys().next().value)
      } catch { /* 没小图就只显示文件名 */ }
    }

    let chipKinds = null
    /** 每种整段：图标、认它的正则（alts）、标签上的字、悬停卡片上的几行（[标签, 内容]） */
    function kinds() {
      if (chipKinds) return chipKinds
      const L = [ZH, EN]
      const both = (key, sp) => L.map((x) => tplSrc(x[key], sp))
      const lit = (keys) => '(?:' + keys.flatMap((k) => L.map((x) => reEsc(x[k].replace(/\n+$/, '')))).join('|') + ')'
      const quote = (t, s) => t('lang') === 'en' ? `"${s}"` : `「${s}」`
      chipKinds = [
        { i: 'mark', label: (v, t) => t('chipMark'),
          alts: L.map((x) => tplSrc(x.mkAsk, { where: '[^\\n]*', notes: `(?:${noCap(tplSrc(x.mkNotes).src)}\\n)?` })),
          card: (v, t) => [['b', t('chipMark')], ['img', chipThumbs.get(v.path)], ['p', String(v.notes || '').trim().replace(/^[^：:]*[：:]\s*/, '')], ['span', v.where], ['span', baseName(v.path)]] },
        { i: 'text', label: (v, t) => t('chipText'), alts: both('textAsk'),
          card: (v, t) => [['b', t('chipText')], ['p', `${quote(t, v.before)} → ${quote(t, v.after)}`], ['span', fileOf(v)]] },
        { i: 'style', label: (v, t) => t('chipStyle'), alts: both('styleAskText', { rules: '(?:\\n- [^\\n]*)*\\n|' }),
          card: (v, t) => [['b', t('chipStyle')], ['code', v.sel && v.sel !== v.name ? `${v.name} · ${v.sel}` : v.name], ['p', v.list], ['span', fileOf(v)]] },
        { i: 'layers', label: (v, t) => t('chipVariant'), alts: both('variantText'),
          card: (v, t) => [['b', t('chipVariant')], ['code', v.name], ['span', fileOf(v)]] },
        { i: 'layers', label: (v, t) => t('chipDir'), alts: [...both('pickText'), ...both('pickKeep')],
          card: (v, t) => [['b', t('chipDir')], ['code', v.name], ['span', v.others], ['span', fileOf(v)]] },
        { i: 'check', label: (v, t) => t('chipCheck', { n: v.n }),
          alts: L.map((x) => { const a = tplSrc(x.checkAsk, { n: '\\d+' }); const line = `(?:${noCap(tplSrc(x.ckScreen).src)}|\\d+\\. [^\\n]* — [^\\n]*)`; return { src: `${a.src}(?:\\n+${line})+\\n+${tplSrc(x.checkTail).src}`, keys: a.keys } }),
          card: (v, t, s) => { const it = s.split('\n').filter((l) => /^\d+\. /.test(l)); return [['b', t('chipCheck', { n: v.n })], ...it.slice(0, 4).map((l) => ['span', l.replace(/ — .*$/, '')]), it.length > 4 ? ['span', '…'] : null] } },
        { i: 'code', label: (v, t) => t('chipCode'), alts: both('hoText', { only: '(?:，screens: [^\\n]*)?' }),
          card: (v, t) => [['b', t('chipCode')], ['code', v.fw], ['span', v.dest], ['span', v.scope]] },
        { i: 'image', label: (v, t) => t('chipRef'), alts: L.map((x) => tplSrc(x.refText, { ask: lit(['refAsk', 'refAskNew']), w: '\\d+', h: '\\d+' })),
          card: (v, t) => [['b', t('chipRef')], ['img', chipThumbs.get(v.path)], ['sw', hexes(v.colors)], ['span', `${v.w}×${v.h} · ${v.tone}`], ['span', baseName(v.path)]] },
        { i: 'style', label: (v, t) => t('chipTweak'), alts: L.map((x) => ({ src: `${tplSrc(x.twAskHead).src}(?:\\n- [^\\n]*)+\\n${tplSrc(x.twAskTail).src}`, keys: [] })),
          card: (v, t, s) => [['b', t('chipTweak')], ...s.split('\n').filter((l) => l.startsWith('- ')).slice(0, 5).map((l) => ['span', l.slice(2)])] },
        { i: 'style', label: (v, t) => t('chipTwMake'), alts: both('twMakeText'), card: (v, t) => [['b', t('chipTwMake')], ['span', 'tweaks.json']] },
        { i: 'style', label: (v, t) => t('chipTwFix'), alts: both('twFixText'), card: (v, t) => [['b', t('chipTwFix')], ['p', v.errs]] },
        { i: 'look', label: (v, t) => t('chipSysEx'), alts: both('sysExtractText'), card: (v, t) => [['b', t('chipSysEx')], ['code', v.src]] },
        { i: 'look', label: (v, t) => t('chipSysAp'), alts: both('sysApplyText'), card: (v, t) => [['b', t('chipSysAp')], ['code', v.name], ['span', v.dir]] },
        { i: 'look', label: (v, t) => t('chipLook', { name: v.name }), alts: L.map((x) => tplSrc(x.styleText, { name: '[^\\n]*?', ask: lit(['styleStart', 'styleRestyle']) })),
          card: (v, t) => [['b', t('chipLook', { name: v.name })], ['p', v.desc], ['sw', hexes(v.colors)], ['span', v.fonts && v.fonts.split(/[;；]/)[0]]] },
        { i: 'look', label: (v) => v.name, alts: [{ src: `〔设计变量〕([^\\n]*?): ([^\\n]*)（(${WHERE_RE})）`, keys: ['name', 'value', 'where'] }],
          card: (v) => [['b', v.name], ['code', v.value], ['sw', hexes(v.value)], ['span', fileOf(v)]] },
        { i: 'look', label: (v, t) => t('chipTokens'), alts: both('tokensAskText'), card: (v, t) => [['b', t('chipTokens')], ['span', 'tokens.css']] },
      ]
      // 每种整段都以固定的一句（或固定的括号）收尾，后面还得是空行或结尾：旧版插成字的、用户的话紧跟着的都不认，照原样显示
      for (const k of chipKinds) for (const a of k.alts) a.re = new RegExp(`${a.src}(?=\\n\\n|$)`, 'y')
      return chipKinds
    }

    // 我们的整段没有特别长的行；有（贴进来的大段代码之类）就整条消息都不认，免得正则在长行上来回试很久
    const longLine = (s) => s.split('\n').some((l) => l.length > 4000)

    /** text 的 pos 处是不是我们的一整段：是就给出种类、各个 {x} 和结尾位置 */
    function chipAt(text, pos) {
      for (const k of kinds()) {
        for (const a of k.alts) {
          a.re.lastIndex = pos
          const m = a.re.exec(text)
          if (!m || !m[0]) continue
          const end = pos + m[0].length
          const v = {}
          a.keys.forEach((key, j) => { if (m[j + 1] != null && !(key in v)) v[key] = m[j + 1] })
          return { k, v, end }
        }
      }
      return null
    }

    /** 一个标签存的整段 → 图标、标签上的字、悬停卡片；不是我们的给 null */
    function chipOf(text, t) {
      const s = String(text || '').trim()
      const p = pickInfo(s)
      if (p) return { i: 'pick', label: pickLabel(p, t), items: () => pickItems(p, t) }
      if (longLine(s)) return null
      const c = chipAt(s, 0)
      if (!c || c.end !== s.length) return null
      return { i: c.k.i, label: c.k.label(c.v, t), items: () => c.k.card(c.v, t, s) }
    }

    /** 消息里的点选块（开头一行〔选中元素〕/〔选中区域〕，后面跟着细节行） */
    function pickRanges(text) {
      const out = []
      const re = /(^|\n)〔(?:选中元素|选中区域)〕/g
      let m
      while ((m = re.exec(text))) {
        const start = m.index + m[1].length
        let end = text.indexOf('\n', start)
        if (end < 0) end = text.length
        const n1 = text.indexOf('\n', end + 1)
        if (end >= text.length || !/^(文件|页面)：/.test(text.slice(end + 1, n1 < 0 ? text.length : n1).trim())) { re.lastIndex = start + 1; continue }
        while (end < text.length) {
          const nx = text.indexOf('\n', end + 1)
          const line = text.slice(end + 1, nx < 0 ? text.length : nx).trim()
          if (!PICK_LINE.test(line)) break
          end = nx < 0 ? text.length : nx
        }
        const block = text.slice(start, end)
        const ok = block.startsWith('〔选中元素〕') ? /\n位置：/.test(block) && /\nHTML：</.test(block) && /\n样式：/.test(block) : /^〔选中区域〕页面上 \([-\d.]+, [-\d.]+\) 起 [\d.]+×[\d.]+ 的一块\n/.test(block)
        if (!ok) { re.lastIndex = start + 1; continue }
        out.push({ start, end })
        re.lastIndex = Math.max(end, start + 1)
      }
      return out
    }

    /** 消息里我们的整段都在哪（点选块 + 别的整段），按位置排好 */
    let rangeMemo = { text: null, out: [] }
    function chipRanges(text) {
      if (rangeMemo.text === text) return rangeMemo.out
      const out = pickRanges(text)
      for (let pos = longLine(text) ? text.length : 0; pos < text.length;) {
        if ((pos === 0 || text[pos - 1] === '\n') && !out.some((r) => pos >= r.start && pos < r.end)) {
          const c = chipAt(text, pos)
          if (c) { out.push({ start: pos, end: c.end }); pos = c.end; continue }
        }
        const nx = text.indexOf('\n', pos)
        if (nx < 0) break
        pos = nx + 1
      }
      out.sort((x, y) => x.start - y.start)
      rangeMemo = { text, out }
      return out
    }

    /** 发出去的消息里：我们的整段显示成标签，前后的换行显示成一个空格（和用户的话排在一行） */
    const pickRule = {
      id: 'ddp-pick',
      order: -20,
      match(text, from) {
        for (const r of chipRanges(text)) {
          const pre = text.slice(0, r.start).match(/\n+$/)
          const post = text.slice(r.end).match(/^\n+/)
          const cands = [
            pre && r.start - pre[0].length > 0 ? { id: 'text', start: r.start - pre[0].length, end: r.start, data: { text: pre[0], display: ' ' } } : null,
            { id: 'ddp-pick', start: r.start, end: r.end, data: { text: text.slice(r.start, r.end) } },
            post && r.end + post[0].length < text.length ? { id: 'text', start: r.end, end: r.end + post[0].length, data: { text: post[0], display: ' ' } } : null,
          ]
          for (const c of cands) if (c && c.start >= from) return c
        }
        return undefined
      },
    }

    /** 悬停卡片：输入框里的标签和消息里的标签共用一个 */
    function pickCard(t) {
      if (typeof document === 'undefined') return () => {}
      let card = null
      let on = null
      const hide = () => { on = null; if (card) card.style.display = 'none' }
      // 输入框里的标签：从编辑器里读出这个标签存的那段字
      const textOf = (el) => {
        if (el.dataset && el.dataset.pick) return el.dataset.pick
        try {
          const root = el.closest('[data-lexical-editor]')
          const ed = root && root.__lexicalEditor
          const k = Object.keys(el).find((x) => x.startsWith('__lexicalKey_'))
          const node = ed && k ? ed.getEditorState()._nodeMap.get(el[k]) : null
          return node && typeof node.__ref === 'string' ? node.__ref : ''
        } catch { return '' }
      }
      const show = (el) => {
        const c = chipOf(textOf(el), t)
        if (!c) return
        if (!card) {
          card = document.createElement('div')
          card.className = 'ddp-pickcard'
          document.body.appendChild(card)
        }
        on = el
        for (const x of [el, ...el.querySelectorAll('[title]')]) x.removeAttribute('title') // DSH 自带的悬停提示只有名字，别和卡片叠在一起
        card.replaceChildren()
        card.dataset.i = c.i
        let wide = false
        for (const it of c.items()) {
          const [tag, v] = it || []
          if (!v || (Array.isArray(v) && !v.length)) continue
          let n
          if (tag === 'img') {
            n = document.createElement('img')
            n.src = v.src
            n.alt = ''
            n.style.aspectRatio = `${v.w} / ${v.h}` // 图还没解码时卡片高度也对
            wide = true
          } else if (tag === 'sw') {
            n = document.createElement('i')
            for (const hex of v.slice(0, 10)) { const d = document.createElement('i'); d.style.background = hex; n.appendChild(d) }
          } else {
            n = document.createElement(tag)
            n.textContent = v
          }
          card.appendChild(n)
        }
        card.classList.toggle('wide', wide)
        card.style.display = 'block'
        const r = el.getBoundingClientRect()
        const w = card.offsetWidth
        const ch = card.offsetHeight
        card.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px'
        card.style.top = (r.top - ch - 8 >= 8 ? r.top - ch - 8 : r.bottom + 8) + 'px'
      }
      const sel = `[data-composer-chip^="${PICK_SRC}"], .ddp-pickpill`
      const over = (e) => {
        const el = e.target && e.target.closest ? e.target.closest(sel) : null
        if (el === on) return
        if (el) show(el)
        else hide()
      }
      document.addEventListener('mouseover', over, true)
      document.addEventListener('scroll', hide, true)
      return () => {
        document.removeEventListener('mouseover', over, true)
        document.removeEventListener('scroll', hide, true)
        if (card) card.remove()
      }
    }

    // 输入框里插标签：apply 里拿到 DSH 的服务后填上（旧版 DSH 没有就一直是 null，照旧插字）
    let chips = null

    // DSH 的输入框（只认一个；分屏开着多个时不碰）
    function composerEl() {
      try {
        const els = document.querySelectorAll('[data-lexical-editor="true"]')
        return els.length === 1 ? els[0] : null
      } catch { return null }
    }

    // 输入框的纯文本，段落按换行连起来（和 captureInsertion 的位置对得上）；里面有引用块等别的东西时对不上，给 null
    function composerText(el) {
      if (!el || el.querySelector(':scope > :not(p), p :not(span[data-lexical-text]):not(br)')) return null
      return Array.from(el.children).map((p) => p.textContent).join('\n')
    }

    // 插完把键盘交回输入框，光标放在刚插的字后面（再往回 back 个字）：用户直接接着说要改什么，或者直接回车发出
    function focusAfter(el, text, back) {
      if (!el) return
      el.focus({ preventScroll: true })
      const nodes = []
      let all = ''
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push([n, all.length]); all += n.data }
      const at = all.lastIndexOf(text)
      const r = document.createRange()
      if (at < 0) { r.selectNodeContents(el); r.collapse(false) } else {
        const end = at + text.length - back
        const hit = nodes.find(([n, o]) => o + n.data.length >= end) || nodes[nodes.length - 1]
        r.setStart(hit[0], end - hit[1])
        r.collapse(true)
      }
      const s = window.getSelection()
      s.removeAllRanges()
      s.addRange(r)
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
      return `〔设计变量〕${tok.name}: ${String(tok.value).replace(/\s*\n\s*/g, ' ')}（${whereOf(tok.href, st)}）\n`
    }

    // ── 风格卡：开局挑一个风格（或给已有的设计换风格），整套配色、字体、圆角、阴影、要点放进输入框 ──────
    // 配色都量过对比度：正文和次要文字对底色 ≥ 4.5:1，主色按钮上的字 ≥ 4.5:1

    const SANS = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    const SERIF = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif'
    const ROUND = '"SF Pro Rounded", "PingFang SC", "HarmonyOS Sans SC", system-ui, sans-serif'
    const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
    const GROTESK = '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
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
      { id: 'guochao', zh: '国潮', en: 'Guochao', dzh: '中国红配金、粗宋体、传统纹样', den: 'Chinese red and gold, bold Song type, traditional patterns',
        c: { bg: '#FBF3E4', surface: '#FFFAF0', text: '#2A1410', muted: '#6F4A3A', line: '#E8D3B5', primary: '#B8202A', accent: '#C8952E', on: '#FFF7E6', link: '#A31D26' },
        head: SERIF, w: 800, radius: 6, shadow: '0 6px 18px rgba(140,30,20,.12)',
        nzh: '中国红的大色块配金色细线；标题用粗宋体，可以竖排；祥云、回纹、印章这类纹样用 SVG 画，只做点缀别铺满；底色是米黄纸色，不用纯白',
        nen: 'Big Chinese-red blocks with fine gold lines; bold Song headings, vertical text allowed; clouds, fret borders and seal stamps drawn in SVG as accents only; rice-paper background, not pure white' },
      { id: 'ink', zh: '中式雅致', en: 'Ink & paper', dzh: '宣纸底、墨色字、朱砂点缀', den: 'Paper white, ink-black type, a touch of cinnabar',
        c: { bg: '#F5F2EC', surface: '#FBF9F5', text: '#1E1E1C', muted: '#5F5B54', line: '#DAD4C8', primary: '#2F3B37', accent: '#8C2F2B', on: '#F5F2EC', link: '#8C2F2B' },
        head: SERIF, w: 500, radius: 4, shadow: 'none',
        nzh: '大量留白、细线分隔；标题细宋体、字距放开；朱砂红只像印章一样点一两处；插画用浅灰的水墨晕染（SVG 模糊色块），不用照片堆满',
        nen: 'Lots of space and hairline dividers; light Song headings with open tracking; cinnabar red only in one or two seal-like spots; illustrations as pale ink washes (blurred SVG shapes), not photo walls' },
      { id: 'cyber', zh: '赛博朋克', en: 'Cyberpunk', dzh: '近黑底、品红青色霓虹、等宽字', den: 'Near-black, magenta and cyan neon, monospace',
        c: { bg: '#0B0B16', surface: '#151528', text: '#E9E6FF', muted: '#A09CC8', line: '#2E2B52', primary: '#FF2E88', accent: '#22E1FF', on: '#0B0B16', link: '#22E1FF' },
        head: MONO, w: 700, radius: 2, shadow: '0 0 0 1px #FF2E88, 0 0 18px rgba(255,46,136,.45)',
        nzh: '标题用等宽字、全大写，可以加一点故障错位（两层彩色 text-shadow）；边框是 1px 霓虹线加外发光，发光只给主按钮和关键数字；背景可以叠细网格线；正文照样要清楚',
        nen: 'Monospace, all-caps headings with a slight glitch (two colored text-shadows); 1px neon borders with glow, glow only on the main button and key numbers; a fine grid on the background is fine; body text stays readable' },
      { id: 'cute', zh: '可爱卡通', en: 'Cute', dzh: '粉黄糖果色、大圆角、圆体字', den: 'Candy pink and yellow, big radii, rounded type',
        c: { bg: '#FFF4F6', surface: '#FFFFFF', text: '#3A2540', muted: '#7A5E80', line: '#F3D3DD', primary: '#FF7AA8', accent: '#FFC93C', on: '#3A2540', link: '#C2366F' },
        head: ROUND, w: 800, radius: 24, shadow: '0 6px 0 #F3C4D3',
        nzh: '圆角很大、字胖胖的；按钮像糖果，底下一道同色系的厚阴影；配小动物或角色插画（SVG 简单几何画）；粉色和黄色两种就够，主色按钮上用深色字',
        nen: 'Very round corners and chubby type; candy-like buttons with a thick same-hue shadow underneath; small animal or mascot illustrations (simple SVG shapes); pink and yellow are enough; dark text on the primary button' },
      { id: 'retro', zh: '复古', en: 'Retro', dzh: '焦橙芥末黄墨绿、粗衬线、颗粒感', den: 'Burnt orange, mustard and teal, fat serif, grain',
        c: { bg: '#F3E6CF', surface: '#FBF2E2', text: '#2E1F14', muted: '#6A5240', line: '#DDC7A4', primary: '#B5471D', accent: '#E0A526', on: '#FFF6E8', link: '#2F5D50' },
        head: SERIF, w: 800, radius: 14, shadow: '0 4px 0 #2E1F14',
        nzh: '焦橙、芥末黄、墨绿三色；粗衬线大标题；彩虹条纹、圆形徽章做装饰；底色叠一层很淡的颗粒噪点（SVG feTurbulence）；图片调成褪色暖调',
        nen: 'Burnt orange, mustard and teal; fat serif headlines; rainbow stripes and round badges as decoration; a very light grain over the background (SVG feTurbulence); faded warm photos' },
      { id: 'sale', zh: '电商促销', en: 'Sale', dzh: '红橙主色、大价格、优惠券', den: 'Red-orange, big prices, coupons',
        c: { bg: '#FFF5F0', surface: '#FFFFFF', text: '#1F1A17', muted: '#6B5E57', line: '#F5DDD2', primary: '#CF2E0E', accent: '#FFB800', on: '#FFFFFF', link: '#C2290B' },
        head: SANS, w: 800, radius: 12, shadow: '0 4px 12px rgba(207,46,14,.12)',
        nzh: '价格用大号粗体数字（¥ 小一号），原价灰色划线；「限时」「包邮」这类小标签用色块；优惠券用金黄色、带锯齿边；倒计时醒目；信息多但分区清楚，主按钮通栏',
        nen: 'Prices in big bold numerals (smaller currency sign), old price struck through in gray; small colored tags like "Limited" and "Free shipping"; gold coupons with notched edges; a prominent countdown; dense but clearly sectioned, full-width main button' },
      { id: 'japandi', zh: '日系原木', en: 'Japandi', dzh: '米色原木、低饱和、小字大留白', den: 'Oat and wood tones, muted, small type and lots of space',
        c: { bg: '#F2EEE6', surface: '#FAF8F3', text: '#2F2B26', muted: '#6B645A', line: '#DDD5C8', primary: '#4F4234', accent: '#8C9A6E', on: '#FAF8F3', link: '#6B4F33' },
        head: SANS, w: 500, radius: 6, shadow: '0 2px 8px rgba(79,66,52,.06)',
        nzh: '像杂货店和家居品牌：字号偏小、字重不重，留白很多；颜色只有米、原木棕、灰绿，饱和度都低；照片柔光、自然材质（木、麻、陶）；细线分隔，几乎不用阴影；主按钮深棕实底',
        nen: 'Like a lifestyle or homeware brand: smallish, light type and lots of space; only oat, wood brown and sage, all low saturation; soft-light photos of natural materials (wood, linen, ceramic); hairline dividers, almost no shadow; solid dark-brown main button' },
      { id: 'swiss', zh: '瑞士网格', en: 'Swiss grid', dzh: '白底黑字红色块、严格网格', den: 'White, black type, red blocks, strict grid',
        c: { bg: '#FFFFFF', surface: '#F1F1F1', text: '#0A0A0A', muted: '#545454', line: '#0A0A0A', primary: '#D9001B', accent: '#0A0A0A', on: '#FFFFFF', link: '#C2001A' },
        head: GROTESK, w: 800, radius: 0, shadow: 'none',
        nzh: '12 栏严格网格、全部左对齐（不居中）；标题是超大粗无衬线、字距收紧（-0.03em）；红色大色块只用一两处；用数字编号（01 02 03）和粗黑线分区；没有圆角、阴影和渐变',
        nen: 'A strict 12-column grid, everything left-aligned (nothing centered); huge, bold, tightly tracked sans headings (-0.03em); one or two big red blocks; numbered sections (01 02 03) and heavy black rules; no radius, shadow or gradient' },
      { id: 'brutal', zh: '粗野主义', en: 'Brutalist', dzh: '亮黄底、黑粗框、硬阴影、等宽字', den: 'Bright yellow, thick black borders, hard shadows, monospace',
        c: { bg: '#FFEF5C', surface: '#FFFFFF', text: '#000000', muted: '#3B3B3B', line: '#000000', primary: '#000000', accent: '#FF5C39', on: '#FFEF5C', link: '#1F3FD1' },
        head: MONO, w: 800, radius: 0, shadow: '5px 5px 0 #000000',
        nzh: '卡片和按钮 3px 黑粗边框 + 大偏移的硬阴影（不模糊）；标题等宽字、很大；亮黄、白、橙红高饱和撞色；元素可以故意错位、叠放；不用渐变、圆角和柔和阴影；链接带下划线',
        nen: '3px black borders and big unblurred offset shadows on cards and buttons; large monospace headings; loud yellow, white and red-orange blocks; deliberate offsets and overlaps are fine; no gradients, radius or soft shadows; underlined links' },
      { id: 'cream', zh: '奶油风', en: 'Cream', dzh: '奶白燕麦焦糖、大圆角、柔光', den: 'Milk, oat and caramel, big radii, soft light',
        c: { bg: '#FAF5EE', surface: '#FFFDF9', text: '#3A2F28', muted: '#76675C', line: '#EEE3D5', primary: '#8C5E3C', accent: '#E7C9A6', on: '#FFFFFF', link: '#8A5A36' },
        head: ROUND, w: 700, radius: 22, shadow: '0 10px 30px rgba(140,94,60,.10)',
        nzh: '奶白、燕麦、焦糖三个色；圆角大，多用圆形和胶囊形；阴影又大又淡、带一点暖色；字是深咖啡色不用纯黑；照片和插画柔光、低对比；整体软、暖、安静',
        nen: 'Milk, oat and caramel; big radii, lots of circles and pills; large, faint, warm-tinted shadows; dark coffee text, never pure black; soft, low-contrast photos and illustrations; soft, warm and calm overall' },
      { id: 'sport', zh: '运动能量', en: 'Sport', dzh: '黑底荧光绿、粗斜体、大数字', den: 'Black with volt green, heavy italics, big numbers',
        c: { bg: '#0E0F11', surface: '#1A1C20', text: '#F4F5F6', muted: '#A1A5AD', line: '#2B2E35', primary: '#C8FF2E', accent: '#FF5A1F', on: '#0E0F11', link: '#C8FF2E' },
        head: SANS, w: 900, radius: 6, shadow: 'none',
        nzh: '标题超粗斜体、全大写、字距收紧；荧光绿只给主按钮、进度和关键数字；配速、心率、卡路里这类数字做得很大（等宽数字）；可以用斜切的色块（transform: skewX(-8deg)）；照片高对比、有动感；橙色只做警示和次要强调',
        nen: 'Heavy italic, all-caps, tightly tracked headings; volt green only on the main button, progress and key numbers; big tabular numbers for pace, heart rate and calories; slanted blocks (transform: skewX(-8deg)) are fine; high-contrast action photos; orange only for alerts and secondary emphasis' },
    ]

    /** 样板上各风格的招牌细节（卡片、按钮、标题、配图块），没写的按 STYLES 里的圆角阴影来 */
    const LOOK = {
      minimal: { card: { boxShadow: '0 1px 2px rgba(24,24,27,.06), inset 0 0 0 1px #E4E4E7' }, img: 'linear-gradient(135deg, #E9EEF8, #C7D6F5)' },
      warm: { img: 'linear-gradient(135deg, #E7B08A, #A9542A)' },
      editorial: { card: { background: 'transparent', boxShadow: 'inset 0 3px 0 #111111', borderRadius: 0 }, head: { letterSpacing: '-0.02em' }, img: '#C8231B' },
      dark: { head: { letterSpacing: '.04em' }, img: 'linear-gradient(135deg, #2A2620, #C9A86A)' },
      playful: { card: { border: '2px solid #1D1B3A' }, btn: { border: '2px solid #1D1B3A', boxShadow: '3px 3px 0 #1D1B3A' }, img: '#1F9E92' },
      fresh: { card: { boxShadow: '0 6px 18px rgba(47,125,79,.10), inset 0 0 0 1px #DCE6DA' }, img: 'linear-gradient(135deg, #CFE6C9, #7DB08B)' },
      tech: { card: { boxShadow: '0 1px 3px rgba(15,23,42,.08), inset 0 0 0 1px #E2E8F0' }, img: 'linear-gradient(135deg, #DCE6FF, #2457F5)' },
      glass: { card: { background: 'rgba(255,255,255,.55)', backdropFilter: 'blur(14px)', boxShadow: '0 10px 30px rgba(16,21,28,.10), inset 0 0 0 1px rgba(255,255,255,.85)' }, img: 'linear-gradient(135deg, #FFD9C7, #C9E2FF)' },
      soft: { btn: { boxShadow: '4px 4px 10px #C8CED6, -4px -4px 10px #FFFFFF' }, img: 'linear-gradient(135deg, #DDE2EA, #F4F6F9)' },
      guochao: { card: { boxShadow: 'inset 0 0 0 1px #C8952E, 0 6px 18px rgba(140,30,20,.12)' } },
      ink: { head: { letterSpacing: '.12em' }, img: 'radial-gradient(ellipse at 35% 65%, rgba(30,30,28,.55), transparent 62%), #ECE7DD' },
      cyber: { card: { boxShadow: 'inset 0 0 0 1px #2E2B52' }, head: { textTransform: 'uppercase', letterSpacing: '.04em' } },
      cute: { btn: { boxShadow: '0 4px 0 #E0628E' }, img: 'linear-gradient(135deg, #FFD3E2, #FFC93C)' },
      retro: { card: { border: '2px solid #2E1F14' }, btn: { boxShadow: '0 3px 0 #2E1F14' }, img: 'linear-gradient(180deg, #B5471D 0 33%, #E0A526 33% 66%, #2F5D50 66%)' },
      sale: { img: 'linear-gradient(135deg, #FF8A3D, #CF2E0E)' },
      japandi: { card: { boxShadow: 'inset 0 0 0 1px #DDD5C8' }, img: 'linear-gradient(160deg, #DCD1BF, #B6A58C)' },
      swiss: { card: { boxShadow: 'none' }, head: { letterSpacing: '-0.03em' }, img: '#D9001B' },
      brutal: { card: { border: '3px solid #000000' }, btn: { border: '3px solid #000000', boxShadow: '3px 3px 0 #000000' }, img: '#FF5C39' },
      cream: { img: 'linear-gradient(135deg, #F3E3CF, #E7C9A6)' },
      sport: { head: { fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.01em' }, btn: { transform: 'skewX(-8deg)' }, img: 'linear-gradient(115deg, #C8FF2E 0 42%, #2B2E35 42%)' },
    }

    /** 一个风格在样板上的样子：卡片、主按钮、标题字、配图块、小标签 */
    function styleLook(x) {
      const c = x.c
      const o = LOOK[x.id] || {}
      // 小标签是 9.5px 的小字，要 4.5:1：点缀色在卡片和底色上都够就描边写点缀色，色块上正文色够就做色块，都不行用主色
      const chip = Math.min(hexRatio(c.accent, c.surface), hexRatio(c.accent, c.bg)) >= 4.5 ? { color: c.accent, boxShadow: `inset 0 0 0 1px ${c.accent}` }
        : hexRatio(c.text, c.accent) >= 4.5 ? { background: c.accent, color: c.text } : { background: c.primary, color: c.on }
      return {
        card: { background: c.surface, borderRadius: x.radius, boxShadow: x.shadow === 'none' ? `inset 0 0 0 1px ${c.line}` : x.shadow, ...o.card },
        btn: { background: c.primary, color: c.on, borderRadius: Math.min(x.radius, 14), ...o.btn },
        head: { fontFamily: x.head, fontWeight: x.w, ...o.head },
        img: o.img || `linear-gradient(135deg, ${c.primary}, ${c.accent})`,
        // 进度条底：分隔线是黑的（杂志、瑞士、粗野）就换成淡一点的正文色，不然和黑色主色分不开
        track: c.line === c.text || c.line === c.primary ? `color-mix(in srgb, ${c.text} 14%, ${c.surface})` : c.line,
        chip,
      }
    }

    /** 两个 #RRGGBB 的对比度（WCAG） */
    function hexRatio(a, b) {
      const l = (hex) => { const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
      const [x, y] = [l(a), l(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    /** 点缀色能怎么用：和底色、卡片都 ≥ 3:1 能写大字；不然只做色块（上面的字用正文色，要 ≥ 4.5:1）或只做图形 */
    function accentUse(c) {
      if (Math.min(hexRatio(c.accent, c.bg), hexRatio(c.accent, c.surface)) >= 3) return 'accBig'
      return hexRatio(c.text, c.accent) >= 4.5 ? 'accBlock' : 'accShape'
    }

    /** 选了一个风格 → 输入框里的一段字（restyle：给已经打开的设计换风格） */
    function formatStyle(t, pre, restyle) {
      const en = t('lang') === 'en'
      const c = pre.c
      const fonts = t('styleFonts', { head: `${pre.head} · ${pre.w}`, body: SANS })
      return t('styleText', {
        name: en ? pre.en : pre.zh,
        desc: en ? pre.den : pre.dzh,
        colors: t('styleColors', { ...c, accUse: t(accentUse(c), c), bgImage: pre.bgImage ? t('styleBgImage', { v: pre.bgImage }) : '' }),
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
        osName: it.type === 'winctl' ? t('ckOs_' + (it.os === 'win' ? 'win' : 'mac')) : '',
        zone: it.type === 'winctl' ? t('ckZone_' + (it.os === 'win' ? 'win' : 'mac')) : '',
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
      if (head === 'checkAsk') lines.push('', t('checkTail'))
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

    const SHOW_COLS = { app: 4, miniprogram: 4, tablet: 3, desktop: 2, web: 2, poster: 3, slides: 2, email: 3 }
    const CANVAS_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    const FRAMED = { app: 1, miniprogram: 1, tablet: 1, desktop: 1, web: 1 }

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
    function drawDevice(ctx, kind, img, x, y, w, ht, label, capWhite, os) {
      const f = frameOf(kind, w, ht)
      const pad = f.pad || 0
      const top = f.top || 0
      const r = f.r || 0
      const [W, H] = frameSize(kind, w, ht)
      const dark = kind === 'app' || kind === 'miniprogram' || kind === 'tablet'
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
      // 胶囊颜色用页面截图那一刻自己量的（和画布上一致）；老页面没报就看截图
      if (f.capsule) drawCapsule(ctx, x + pad + w - CAP.right - CAP.w, y + pad + CAP.top, typeof capWhite === 'boolean' ? capWhite : !!img && capDarkOf(img, w))
      if (f.win) {
        rrect(ctx, x + 0.25, y + 0.25, w - 0.5, ht - 0.5, f.r)
        ctx.strokeStyle = 'rgba(0,0,0,.28)'
        ctx.lineWidth = 0.5
        ctx.stroke()
        drawWinCtl(ctx, x, y, w, os, typeof capWhite === 'boolean' ? capWhite : os === 'win' && !!img && areaDarkOf(img, w, w - WINBTN.w * 3, 0, WINBTN.w * 3, WINBTN.h))
      }
    }

    /** 窗口按钮画到导出的图上（和画布上 WinCtl 一样） */
    function drawWinCtl(ctx, x, y, w, os, white) {
      ctx.save()
      if (os === 'win') {
        const W = WINBTN.w, H = WINBTN.h, x0 = x + w - W * 3
        ctx.strokeStyle = white ? '#fff' : '#1f1f1f'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x0 + W / 2 - 5, y + H / 2 + 0.5); ctx.lineTo(x0 + W / 2 + 5, y + H / 2 + 0.5)
        ctx.moveTo(x0 + W * 2.5 - 5, y + H / 2 - 5); ctx.lineTo(x0 + W * 2.5 + 5, y + H / 2 + 5)
        ctx.moveTo(x0 + W * 2.5 + 5, y + H / 2 - 5); ctx.lineTo(x0 + W * 2.5 - 5, y + H / 2 + 5)
        ctx.stroke()
        rrect(ctx, x0 + W * 1.5 - 4.5, y + H / 2 - 4.5, 9, 9, 1)
        ctx.stroke()
      } else {
        const { x: lx, y: ly, d, gap } = LIGHTS
        ;['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
          ctx.beginPath()
          ctx.arc(x + lx + d / 2 + i * (d + gap), y + ly + d / 2, d / 2 - 0.25, 0, Math.PI * 2)
          ctx.fillStyle = c
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,0,0,.12)'
          ctx.lineWidth = 0.5
          ctx.stroke()
        })
      }
      ctx.restore()
    }

    /** 截图里胶囊那块是不是深色（导出时没有页面可问，看图） */
    function capDarkOf(img, w) {
      return areaDarkOf(img, w, w - CAP.right - CAP.w, CAP.top, CAP.w, CAP.h)
    }

    /** 截图里 (sx, sy, sw, sh) 那块（屏幕坐标）是不是深色 */
    function areaDarkOf(img, w, sx, sy, sw, sh) {
      try {
        const k = img.width / w
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(sw * k))
        c.height = Math.max(1, Math.round(sh * k))
        const g = c.getContext('2d')
        g.drawImage(img, sx * k, sy * k, sw * k, sh * k, 0, 0, c.width, c.height)
        const d = g.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        return sum / (d.length / 4) < 140
      } catch { return false }
    }

    /** 小程序右上角的胶囊（「···」和关闭圈），和画布上 .ddp-cap 一样 */
    function drawCapsule(ctx, x, y, white) {
      const fg = white ? '#FFFFFF' : '#000000'
      ctx.save()
      rrect(ctx, x, y, CAP.w, CAP.h, CAP.h / 2)
      ctx.fillStyle = white ? 'rgba(0,0,0,.15)' : 'rgba(255,255,255,.6)'
      ctx.fill()
      rrect(ctx, x + 0.25, y + 0.25, CAP.w - 0.5, CAP.h - 0.5, CAP.h / 2)
      ctx.strokeStyle = white ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.08)'
      ctx.lineWidth = 0.5
      ctx.stroke()
      ctx.fillStyle = fg
      ;[[20.5, 2.2], [28, 3.1], [35.5, 2.2]].forEach(([cx, r]) => { ctx.beginPath(); ctx.arc(x + cx, y + 16, r, 0, Math.PI * 2); ctx.fill() })
      ctx.fillStyle = white ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.15)'
      ctx.fillRect(x + 43.25, y + 9, 0.5, 14)
      ctx.strokeStyle = fg
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x + 65, y + 16, 7.5, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = fg
      ctx.beginPath(); ctx.arc(x + 65, y + 16, 2.6, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    function canvasBlob(canvas) {
      return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
    }

    /** 一屏带外框（四周留出阴影的地方，背景透明） */
    async function composeOne(kind, size, img, label, top, os) {
      const [w, ht] = size
      const [W, H] = frameSize(kind, w, ht)
      const m = 56
      const S = Math.min(2, 6000 / (W + m * 2))
      const c = document.createElement('canvas')
      c.width = Math.round((W + m * 2) * S)
      c.height = Math.round((H + m * 2) * S)
      const ctx = c.getContext('2d')
      ctx.scale(S, S)
      drawDevice(ctx, kind, img, m, m, w, ht, label, top, os)
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
      return { w, h: ht, palette, img, data: await blobB64(blob) }
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
    async function composeShowcase({ kind, size, shots, title, sub, bg, accent, mark, os }) {
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
        drawDevice(ctx, kind, s.img, x, yy, w, ht, s.label, s.top, os)
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

    /** 这里能不能往剪贴板写图（http 远程打开、老浏览器不行；不行就不给「复制」按钮） */
    function canCopyImage() {
      try { return !!(window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem === 'function') } catch { return false }
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

    const KIND_LIST = ['web', 'app', 'miniprogram', 'tablet', 'desktop', 'poster', 'slides', 'email']
    const KIND_KEY = { web: 'kindWeb', app: 'kindApp', miniprogram: 'kindMini', tablet: 'kindTablet', desktop: 'kindDesktop', poster: 'kindPoster', slides: 'kindSlides', email: 'kindEmail' }
    const GHOST_MS = 90000 // 这么久没出新屏就撤掉「生成中…」占位
    const EDIT_GRACE_MS = 3000 // 退出改字后这么久里，页面交上来的最后一处改动还收
    const KIND_SIZE = { web: [1280, 800], app: [390, 844], miniprogram: [375, 812], tablet: [820, 1180], desktop: [1280, 800], poster: [1080, 1350], slides: [1280, 720], email: [640, 960] }
    // 外框：pad 边框厚度、top 顶上一条（浏览器栏）、r 外圆角、ir 屏幕圆角、island 灵动岛离顶的距离、capsule 小程序右上角的胶囊、win 桌面软件的窗口按钮
    const FRAME = {
      web: { pad: 0, top: 34, r: 10, ir: 0 },
      app: { pad: 11, top: 0, r: 55, ir: 44, island: 11 },
      miniprogram: { pad: 11, top: 0, r: 55, ir: 44, island: 11, capsule: 1 },
      tablet: { pad: 14, top: 0, r: 34, ir: 21 },
      desktop: { pad: 0, top: 0, r: 12, ir: 12, win: 1 },
      poster: { pad: 0, top: 0, r: 6, ir: 6 },
      slides: { pad: 0, top: 0, r: 8, ir: 8 },
      email: { pad: 0, top: 0, r: 10, ir: 10 },
    }

    /** 某个大小的外框：矮的手机（SE 那种，高不到宽的 1.9 倍）没有灵动岛，不然压住页面最上面 */
    function frameOf(kind, w, ht) {
      const f = FRAME[kind] || FRAME.web
      return f.island && w && ht / w < 1.9 ? { ...f, island: 0 } : f
    }
    // 小程序胶囊：离屏幕顶 48（状态栏 44 + 4）、离右边 7、87×32（和页面体检 picker.js 的 CAP 一样）
    const CAP = { top: 48, right: 7, w: 87, h: 32 }
    // 桌面软件的窗口按钮（和 picker.js 的一样）：Mac 红绿灯在左上 x 20、y 20 起，三个 12px 圆点隔 8；Windows 最小化 / 最大化 / 关闭在右上角，各 46×32
    const LIGHTS = { x: 20, y: 20, d: 12, gap: 8 }
    const WINBTN = { w: 46, h: 32 }
    const META_ALIAS = { phone: 'app', mobile: 'app', ios: 'app', android: 'app', mini: 'miniprogram', miniapp: 'miniprogram', weapp: 'miniprogram', wechat: 'miniprogram', 小程序: 'miniprogram', pad: 'tablet', ipad: 'tablet', pc: 'desktop', electron: 'desktop', tauri: 'desktop', mac: 'desktop', macos: 'desktop', windows: 'desktop', win: 'desktop', 桌面: 'desktop', 桌面软件: 'desktop', social: 'poster', image: 'poster', slide: 'slides', deck: 'slides', ppt: 'slides', mail: 'email' }

    /** 页面里 <meta name="dsh-design" content="app"> / "poster 1080x1920" / "desktop windows" → { kind, size, os }（os：win，不写是 Mac） */
    function parseMeta(content) {
      const out = { kind: '', size: '', os: '' }
      for (const w of String(content || '').toLowerCase().split(/[\s,;]+/)) {
        if (!out.kind && (KIND_LIST.includes(w) || META_ALIAS[w])) out.kind = KIND_LIST.includes(w) ? w : META_ALIAS[w]
        const m = /^(\d{2,5})[x×*](\d{2,5})$/.exec(w)
        if (!out.size && m) out.size = `${m[1]}x${m[2]}`
        if (!out.os && /^(windows|win|win10|win11)$/.test(w)) out.os = 'win'
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
     * 一样大时（高度先到顶了）多放几列：拉宽右侧栏就横着多排几屏，像网页卡片换行；但不让最后一行孤零零剩一屏。
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
        const tie = best && Math.abs(z - best.z) <= best.z * 1e-6
        if (!best || z > best.z * (1 + 1e-6) || (tie && (rows === 1 || count - (rows - 1) * cols > 1))) best = { cols, rows, z }
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
      miniprogram: [['szSmall', 'miniprogram', [375, 667]], ['szStd', 'miniprogram', [375, 812]], ['szLarge', 'miniprogram', [414, 896]]],
      tablet: [['szSmall', 'tablet', [744, 1133]], ['szStd', 'tablet', [820, 1180]], ['szLarge', 'tablet', [1032, 1376]]],
      desktop: [['szSmall', 'desktop', [1024, 680]], ['szStd', 'desktop', [1280, 800]], ['szLarge', 'desktop', [1440, 900]]],
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

    /**
     * 每屏报上来的跳转 → 一屏到另一屏一条，hots 是这一对所有的按钮。
     * nav：「导航」按钮（底栏、返回这种好几屏同一个位置都有、跳到同一屏的），画布上只描框、不画线
     */
    function flowsOf(screens, linksOf, file) {
      const keys = new Set(screens.map((s) => s.key))
      const spot = (to, l) => to + '|' + Math.round(l.x / 12) + '|' + Math.round(l.y / 12)
      const where = new Map() // 同一个位置、跳到同一屏的按钮出现在几屏上
      const per = screens.map((sc) => (linksOf(sc) || []).map((l) => ({ ...l, to: keyOfPath(l.path, file) })))
      per.forEach((ls) => { for (const k of new Set(ls.map((l) => spot(l.to, l)))) where.set(k, (where.get(k) || 0) + 1) })
      const out = []
      screens.forEach((sc, i) => {
        const pairs = new Map()
        for (const l of per[i]) {
          if (l.to === sc.key || !keys.has(l.to)) continue
          const hot = { x: l.x, y: l.y, w: l.w, h: l.h, nav: (where.get(spot(l.to, l)) || 0) >= 3 }
          if (!pairs.has(l.to)) pairs.set(l.to, [])
          pairs.get(l.to).push(hot)
        }
        for (const [to, hots] of pairs) out.push({ from: sc.key, to, ...hots[0], hots })
      })
      return out
    }

    /**
     * 选中那一屏「通向哪」的连线（画布坐标）。线只走屏和屏之间的缝（列间的竖缝、行间的横缝、外圈），不穿过别的屏：
     * 从按钮边上出发，就近出屏，在缝里直角转弯（圆角），落到目标屏的边上。几条线各走一道（错开几像素），不叠在一起。
     * 每种出 / 进的边都试一遍，挑最短、拐弯最少、在屏里走得最少的。
     * 只有导航按钮连着的（nav）不画线，只给按钮描虚线框。opts.z 是画布缩放（换算几像素的间距），opts.lift 是屏上面标题那一条的高度。
     */
    function flowLines(flows, keys, pos, kind, size, opts = {}) {
      const f = FRAME[kind] || FRAME.web
      const [dw, dh] = deviceBox(kind, size)
      const z = opts.z || 0.4
      const px = (n) => n / z
      const lift = opts.lift || 0
      const idx = new Map(keys.map((k, i) => [k, i]))
      const xs = [...new Set(pos.filter(Boolean).map((p) => p.x))].sort((m, n) => m - n)
      const ys = [...new Set(pos.filter(Boolean).map((p) => p.y))].sort((m, n) => m - n)
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
      // 竖缝：第 j 道在第 j 列左边（0 = 最左外圈，xs.length = 最右外圈）
      const vLane = (j) => {
        if (j <= 0) return { c: xs[0] - px(14), hw: px(8) }
        if (j >= xs.length) return { c: xs[xs.length - 1] + dw + px(14), hw: px(8) }
        const a = xs[j - 1] + dw
        return { c: (a + xs[j]) / 2, hw: (xs[j] - a) / 2 }
      }
      // 横缝：第 i 道在第 i 排上面（标题再上面）；0 = 最上外圈，ys.length = 最下外圈
      const hLane = (i) => {
        if (i <= 0) return { c: ys[0] - lift - px(9), hw: px(6) }
        if (i >= ys.length) return { c: ys[ys.length - 1] + dh + px(14), hw: px(9) }
        const a = ys[i - 1] + dh
        const b = ys[i] - lift
        return { c: (a + b) / 2, hw: Math.max(px(4), (b - a) / 2) }
      }
      const at = (lane, o) => lane.c + clamp(o, -lane.hw + px(2), lane.hw - px(2))
      const cellOf = (i) => ({ x0: pos[i].x, y0: pos[i].y, x1: pos[i].x + dw, y1: pos[i].y + dh, col: xs.indexOf(pos[i].x), row: ys.indexOf(pos[i].y) })

      /** 一条线：出边 E、进边 N、错开 o → 拐点 */
      function route(S, T, hot, E, N, o) {
        const cx = hot.x + hot.w / 2
        const cy = hot.y + hot.h / 2
        const pts = []
        let cur // 现在在哪道缝里：{ v: true/false, lane, p: 另一个坐标 }
        if (E === 'L' || E === 'R') {
          const lane = at(vLane(E === 'L' ? S.col : S.col + 1), o)
          pts.push([E === 'L' ? hot.x : hot.x + hot.w, cy], [lane, cy])
          cur = { v: true, c: lane, p: cy }
        } else {
          const lane = at(hLane(E === 'T' ? S.row : S.row + 1), o)
          pts.push([cx, E === 'T' ? hot.y : hot.y + hot.h], [cx, lane])
          cur = { v: false, c: lane, p: cx }
        }
        const side = N === 'L' || N === 'R'
        const tLane = side ? at(vLane(N === 'L' ? T.col : T.col + 1), o) : at(hLane(N === 'T' ? T.row : T.row + 1), o)
        // 落点：侧边上下留 20%；顶边避开左边的标题字，落在右半边
        // 从上 / 下进同一列的两屏时落点分开（往上进的靠里一点），不在缝里交叉成十字
        const yIn = (y) => clamp(y, T.y0 + dh * 0.2, T.y0 + dh * 0.8)
        const xIn = (x) => {
          const right = x > T.x0 + dw / 2
          if (N === 'T') return clamp(x, T.x0 + dw * 0.55, T.x0 + dw * (right ? 0.88 : 0.6))
          return clamp(x, T.x0 + dw * (right ? 0.4 : 0.14), T.x0 + dw * (right ? 0.72 : 0.6))
        }
        const edge = (p) => (N === 'L' ? [T.x0, p] : N === 'R' ? [T.x1, p] : N === 'T' ? [p, T.y0] : [p, T.y1])
        if (cur.v && side) {
          if (Math.abs(cur.c - tLane) < 0.5) {
            const y = yIn(cur.p)
            pts.push([cur.c, y], edge(y))
          } else {
            // 两道竖缝之间：找一道横缝过去
            let k = 0
            let bestD = Infinity
            for (let i = 0; i <= ys.length; i++) {
              const d = Math.abs(hLane(i).c - cur.p) + Math.abs(hLane(i).c - (T.y0 + dh / 2))
              if (d < bestD) { bestD = d; k = i }
            }
            const hy = at(hLane(k), o)
            const y = yIn(hy)
            pts.push([cur.c, hy], [tLane, hy], [tLane, y], edge(y))
          }
        } else if (cur.v && !side) {
          const x = xIn(cur.c)
          pts.push([cur.c, tLane], [x, tLane], edge(x))
        } else if (!cur.v && side) {
          const y = yIn(cur.c)
          pts.push([tLane, cur.c], [tLane, y], edge(y))
        } else if (Math.abs(cur.c - tLane) < 0.5) {
          const x = xIn(cur.p)
          pts.push([x, cur.c], edge(x))
        } else {
          // 两道横缝之间：找一道竖缝过去
          let k = 0
          let bestD = Infinity
          for (let j = 0; j <= xs.length; j++) {
            const d = Math.abs(vLane(j).c - cur.p) + Math.abs(vLane(j).c - (T.x0 + dw / 2))
            if (d < bestD) { bestD = d; k = j }
          }
          const vx = at(vLane(k), o)
          const x = xIn(vx)
          pts.push([vx, cur.c], [vx, tLane], [x, tLane], edge(x))
        }
        // 去掉重复、共线的点
        const clean = []
        for (const p of pts) {
          const q = clean[clean.length - 1]
          if (q && Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) continue
          const r = clean[clean.length - 2]
          if (q && r && ((Math.abs(r[0] - q[0]) < 0.01 && Math.abs(q[0] - p[0]) < 0.01) || (Math.abs(r[1] - q[1]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01))) clean.pop()
          clean.push(p)
        }
        return clean
      }
      const lenOf = (pts) => pts.slice(1).reduce((m, p, i) => m + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0)
      // 屏里那一小段压过别的按钮（底栏、别的行）分不清是谁的线，宁可绕一点
      const hits = (a, b, rs, src) => rs.filter((r) => r !== src && Math.min(a[0], b[0]) < r.x + r.w - 1 && Math.max(a[0], b[0]) > r.x + 1 && Math.min(a[1], b[1]) < r.y + r.h - 1 && Math.max(a[1], b[1]) > r.y + 1).length
      const costOf = (pts, E, N, rs, src) => {
        const inS = Math.abs(pts[1][0] - pts[0][0]) + Math.abs(pts[1][1] - pts[0][1])
        return lenOf(pts) + (pts.length - 2) * px(46) + inS * 2 + hits(pts[0], pts[1], rs, src) * px(300) + (E === 'T' ? px(30) : 0) + (N === 'T' ? px(24) : 0)
      }
      // 两条线的横竖段相交几次（共用端点不算）
      const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p])
      const cross = (A, B) => {
        let n = 0
        for (const [a, b] of A) {
          for (const [c, d] of B) {
            const av = Math.abs(a[0] - b[0]) < 0.01
            const cv = Math.abs(c[0] - d[0]) < 0.01
            if (av === cv) continue
            const [v0, v1, h0, h1] = av ? [a, b, c, d] : [c, d, a, b]
            const x = v0[0]
            const y = h0[1]
            const inV = y > Math.min(v0[1], v1[1]) + 0.01 && y < Math.max(v0[1], v1[1]) - 0.01
            const inH = x > Math.min(h0[0], h1[0]) + 0.01 && x < Math.max(h0[0], h1[0]) - 0.01
            if (inV && inH) n++
          }
        }
        return n
      }
      /** 拐点 → 圆角折线；末尾留出箭头的长度 */
      const pathOf = (pts, from, a) => {
        const P = pts.slice(from)
        const last = P[P.length - 1]
        const prev = P[P.length - 2]
        const ux = Math.sign(last[0] - prev[0])
        const uy = Math.sign(last[1] - prev[1])
        P[P.length - 1] = [last[0] - ux * a, last[1] - uy * a]
        let d = `M${P[0][0]} ${P[0][1]}`
        for (let i = 1; i < P.length - 1; i++) {
          const [x0, y0] = P[i - 1]
          const [x1, y1] = P[i]
          const [x2, y2] = P[i + 1]
          const r = Math.min(px(12), Math.hypot(x1 - x0, y1 - y0) / 2, Math.hypot(x2 - x1, y2 - y1) / 2)
          const ax = x1 - Math.sign(x1 - x0) * r
          const ay = y1 - Math.sign(y1 - y0) * r
          const bx = x1 + Math.sign(x2 - x1) * r
          const by = y1 + Math.sign(y2 - y1) * r
          d += `L${ax} ${ay}Q${x1} ${y1} ${bx} ${by}`
        }
        return d + `L${P[P.length - 1][0]} ${P[P.length - 1][1]}`
      }

      const out = []
      const todo = []
      // 每屏看得见的按钮框（挑出发点时别从别的按钮上穿过去）
      const shown = new Map()
      const spots = (fl, S) => {
        const ox = S.x0 + f.pad
        const oy = S.y0 + f.pad + f.top
        return (fl.hots || [fl]).filter((l) => l.y >= -1 && l.y + l.h <= size[1] + 1 && l.x + l.w > 0 && l.x < size[0])
          .map((l) => ({ x: ox + Math.max(0, l.x), y: oy + l.y, w: Math.min(l.w, size[0] - Math.max(0, l.x)), h: l.h }))
      }
      for (const fl of flows) {
        const a = idx.get(fl.from)
        if (a === undefined || !pos[a]) continue
        if (!shown.has(fl.from)) shown.set(fl.from, [])
        shown.get(fl.from).push(...spots(fl, cellOf(a)))
      }
      for (const fl of flows) {
        const a = idx.get(fl.from)
        const b = idx.get(fl.to)
        if (a === undefined || b === undefined || a === b || !pos[a] || !pos[b]) continue
        const S = cellOf(a)
        const T = cellOf(b)
        const ox = S.x0 + f.pad
        const oy = S.y0 + f.pad + f.top
        // 看得见的按钮（在屏幕里、没被往下滚出去）：导航的只描框；别的按钮里挑线最顺的那个出发。
        // 只有看不见的：从屏幕底边出发，画虚线
        const seen = (l) => l.y >= -1 && l.y + l.h <= size[1] + 1 && l.x + l.w > 0 && l.x < size[0]
        const rect = (l) => ({ x: ox + Math.max(0, l.x), y: oy + l.y, w: Math.min(l.w, size[0] - Math.max(0, l.x)), h: l.h })
        const hots = fl.hots || [fl]
        for (const l of hots) if (l.nav && seen(l)) out.push({ from: fl.from, to: fl.to, nav: true, hot: rect(l) })
        const cand = hots.filter((l) => !l.nav && seen(l)).map(rect)
        if (!cand.length && hots.some((l) => seen(l))) continue
        if (!cand.length && !hots.some((l) => !l.nav)) continue
        const rs = shown.get(fl.from) || []
        const same = (r, q) => Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5 && Math.abs(r.w - q.w) < 0.5
        let best = null
        for (const src of cand.length ? cand : [{ x: ox + size[0] / 2 - 1, y: oy + size[1] - 2, w: 2, h: 2 }]) {
          const own = rs.find((r) => same(r, src))
          for (const E of cand.length ? ['L', 'R', 'B', 'T'] : ['B']) {
            for (const N of ['L', 'R', 'T', 'B']) {
              const c = costOf(route(S, T, src, E, N, 0), E, N, rs, own)
              if (!best || c < best.c) best = { c, E, N, src }
            }
          }
        }
        const hot = cand.length ? best.src : null
        todo.push({ fl, S, T, hot, src: best.src, E: best.E, N: best.N })
      }
      // 各走一道，错开几像素；先按出发点从左上到右下排，线不多时再试各种先后，挑交叉最少的
      todo.sort((p, q) => p.src.x + p.src.y - (q.src.x + q.src.y))
      const sp = px(6)
      const offs = (ord) => ord.map((k) => (k - (todo.length - 1) / 2) * sp)
      const crossings = (ord) => {
        const o = offs(ord)
        const ss = todo.map((it, i) => segs(route(it.S, it.T, it.src, it.E, it.N, o[i])))
        let n = 0
        for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) n += cross(ss[i], ss[j])
        return n
      }
      let ord = todo.map((_, i) => i)
      if (todo.length > 1 && todo.length <= 6) {
        let low = crossings(ord)
        const perm = (arr, k) => {
          if (!low) return
          if (k === arr.length) {
            const n = crossings(arr)
            if (n < low) { low = n; ord = arr.slice() }
            return
          }
          for (let i = k; i < arr.length; i++) {
            ;[arr[k], arr[i]] = [arr[i], arr[k]]
            perm(arr, k + 1)
            ;[arr[k], arr[i]] = [arr[i], arr[k]]
          }
        }
        perm(ord.slice(), 0)
      }
      const os = offs(ord)
      todo.forEach((it, k) => {
        const pts = route(it.S, it.T, it.src, it.E, it.N, os[k])
        const a = px(7)
        const q = pts[pts.length - 1]
        const pr = pts[pts.length - 2]
        out.push({
          from: it.fl.from, to: it.fl.to, hot: it.hot, off: !it.hot,
          sx: pts[0][0], sy: pts[0][1], ex: q[0], ey: q[1], ux: Math.sign(q[0] - pr[0]), uy: Math.sign(q[1] - pr[1]),
          d: pathOf(pts, 0, a * 0.7),
          // 衬底从出了屏幕那一刻开始（屏里那段不用）
          halo: pathOf([it.E === 'L' ? [it.S.x0, pts[0][1]] : it.E === 'R' ? [it.S.x1, pts[0][1]] : [pts[0][0], it.E === 'T' ? it.S.y0 : it.S.y1], ...pts.slice(1)], 0, a * 0.7),
          pts,
        })
      })
      return out
    }

    /** 连线画成什么（和框架无关的描述，画布用 h() 画出来） */
    function flowMarks(lines, z) {
      const px = (n) => n / z
      const marks = []
      for (const ln of lines) {
        if (ln.hot) {
          const r = Math.min(px(6), ln.hot.w / 2, ln.hot.h / 2)
          marks.push(['rect', { className: 'hot' + (ln.nav ? ' nav' : ''), x: ln.hot.x, y: ln.hot.y, width: ln.hot.w, height: ln.hot.h, rx: r, strokeWidth: px(1.5), strokeDasharray: ln.nav ? `${px(3)} ${px(2.5)}` : undefined }])
        }
      }
      for (const ln of lines) {
        if (ln.nav) continue
        const a = px(7)
        const bx = ln.ex - ln.ux * a
        const by = ln.ey - ln.uy * a
        const vx = -ln.uy * a * 0.56
        const vy = ln.ux * a * 0.56
        marks.push(['path', { className: 'halo', d: ln.halo, strokeWidth: px(5.5) }])
        marks.push(['path', { className: 'ln' + (ln.off ? ' off' : ''), d: ln.d, strokeWidth: px(1.75), strokeDasharray: ln.off ? `${px(4)} ${px(3)}` : undefined }])
        marks.push(['path', { className: 'hd', d: `M${ln.ex} ${ln.ey}L${bx + vx} ${by + vy}L${bx - vx} ${by - vy}Z` }])
        marks.push(['circle', { className: 'dot', cx: ln.sx, cy: ln.sy, r: px(3.2), strokeWidth: px(1.4) }])
      }
      return marks
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

    function AddressForm({ t, sid, initial, onDone, autoFocus, className, onBrowse }) {
      const [value, setValue] = useState(initial || '')
      const [err, setErr] = useState('')
      const submit = async (e) => {
        if (e) e.preventDefault()
        if (!value.trim()) return onDone && onDone()
        try {
          await openTarget(sid, value.trim())
          setErr('')
          onDone && onDone()
        } catch (x) {
          setErr(t('openFailed', { msg: x.message }))
        }
      }
      // 工具栏里：焦点离开整个地址栏（输入框和「浏览…」都算在内）才收起；弹出选文件窗口时整个窗口失焦，不收
      const blur = (e) => {
        if (!onDone || className) return
        const form = e.currentTarget
        if (form.contains(e.relatedTarget)) return
        setTimeout(() => { if (document.hasFocus() && !form.contains(document.activeElement)) onDone() }, 150)
      }
      const esc = (e) => { if (e.key === 'Escape' && !(e.nativeEvent && e.nativeEvent.isComposing) && e.keyCode !== 229 && onDone) onDone() }
      return h('form', { onSubmit: submit, onBlur: blur, onKeyDown: esc, className, style: className ? undefined : { display: 'contents' } },
        h('input', {
          className: 'ddp-input',
          value,
          autoFocus,
          spellCheck: false,
          placeholder: t('placeholder'),
          onChange: (e) => { setValue(e.target.value); if (err) setErr('') },
        }),
        // 「浏览…」：桌面版弹系统的选文件窗口；按下时不抢输入框的焦点（工具栏里失焦会收起地址栏）
        onBrowse ? h('button', {
          type: 'button',
          className: className ? 'ddp-browse' : 'ddp-btn',
          title: t('browseTip'),
          'aria-label': className ? undefined : t('browseTip'),
          onMouseDown: (e) => e.preventDefault(),
          onClick: onBrowse,
        }, className ? t('browse') : h(I.folder)) : null,
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
     * 外框：网页是浏览器窗口，App / 平板是带圆角边框的设备（App 还有灵动岛，小程序再加右上角的胶囊），海报 / 幻灯片 / 邮件是一张卡片。
     * fill = 铺满舞台（单页看网页）。不管哪种，里面那屏都在同一个位置（换类型不重载页面）。top：页面顶栏右边是深色（胶囊画白的）
     */
    function Device({ kind, w, h: ht, fill, label, top, os, children }) {
      const f = fill ? { pad: 0, top: 0, r: 0, ir: 0 } : frameOf(kind, w, ht)
      return h('div', {
        className: `ddp-dev k-${kind}` + (fill ? ' fill' : ''),
        style: fill ? undefined : { width: w + f.pad * 2, height: ht + f.pad * 2 + f.top, borderRadius: f.r },
      },
      h('div', { className: 'ddp-chrome', style: { display: f.top ? 'flex' : 'none', height: f.top } }, h('i'), h('i'), h('i'), h('span', null, label || '')),
      h('div', { className: 'ddp-vp', style: fill ? { inset: 0 } : { left: f.pad, top: f.pad + f.top, width: w, height: ht, borderRadius: f.ir } }, children),
      h('div', { className: 'ddp-island', style: { display: f.island ? 'block' : 'none', top: (f.pad || 0) + (f.island || 0) } }),
      f.capsule ? h(Capsule, { white: !!top, style: { top: (f.pad || 0) + CAP.top, right: (f.pad || 0) + CAP.right } }) : null,
      f.win ? h(WinCtl, { os, white: !!top }) : null)
    }

    /** 桌面软件的窗口按钮：Mac 左上角红绿灯，Windows 右上角最小化 / 最大化 / 关闭（顶栏深色时画白的） */
    function WinCtl({ os, white }) {
      if (os === 'win') {
        const W = WINBTN.w, H = WINBTN.h
        return h('svg', { className: 'ddp-win' + (white ? ' w' : ''), style: { top: 0, right: 0, width: W * 3, height: H }, viewBox: `0 0 ${W * 3} ${H}`, 'aria-hidden': true },
          h('path', { className: 'x', d: `M${W / 2 - 5} ${H / 2 + 0.5}h10` }),
          h('rect', { className: 'x', x: W * 1.5 - 4.5, y: H / 2 - 4.5, width: 9, height: 9, rx: 1 }),
          h('path', { className: 'x', d: `M${W * 2.5 - 5} ${H / 2 - 5}l10 10M${W * 2.5 + 5} ${H / 2 - 5}l-10 10` }))
      }
      const { x, y, d, gap } = LIGHTS
      return h('svg', { className: 'ddp-win', style: { left: x, top: y, width: d * 3 + gap * 2, height: d }, viewBox: `0 0 ${d * 3 + gap * 2} ${d}`, 'aria-hidden': true },
        ['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => h('circle', { key: i, cx: d / 2 + i * (d + gap), cy: d / 2, r: d / 2 - 0.25, fill: c, stroke: 'rgba(0,0,0,.12)', strokeWidth: 0.5 })))
    }

    function Capsule({ white, style }) {
      return h('svg', { className: 'ddp-cap' + (white ? ' w' : ''), style, viewBox: `0 0 ${CAP.w} ${CAP.h}`, 'aria-hidden': true },
        h('rect', { className: 'pl', x: 0.25, y: 0.25, width: CAP.w - 0.5, height: CAP.h - 0.5, rx: CAP.h / 2 - 0.25 }),
        h('circle', { cx: 20.5, cy: 16, r: 2.2 }), h('circle', { cx: 28, cy: 16, r: 3.1 }), h('circle', { cx: 35.5, cy: 16, r: 2.2 }),
        h('path', { className: 'sp', d: 'M43.5 9v14' }),
        h('circle', { className: 'rg', cx: 65, cy: 16, r: 7.5 }), h('circle', { cx: 65, cy: 16, r: 2.6 }))
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
      if (!life.current) life.current = { next: 1, loading: 0, again: false, file: '', seeds: new Map(), seedOf: new Map(), readied: new Set(), tops: new Map(), snapTimer: null, gen: 0, at: '', deps: null }
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
          unpin: () => { if (curRef.current) postTo(curRef.current, { type: 'unpin' }) }, // 去掉「已选」虚线框
          // 画笔标注：这一屏的页面（iframe）现在摆在哪，拼图时按它的位置放截图
          frame: () => wins.current.get(curRef.current) || null,
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
        if (L.tops.has(id) && p.onTop) p.onTop(L.tops.get(id))
        if (first && p.onShown) p.onShown()
        if (first) { if (build && p.onBuilt) p.onBuilt(L.title || '') } else if (p.onNote) p.onNote({ changes, file: L.file, build })
        L.file = ''
        setTimeout(() => setFrames((fs) => fs.filter((f) => f.id >= curRef.current || f.id > id)), 450)
        for (const k of [...L.tops.keys()]) if (k < id) L.tops.delete(k)
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
        L.tops.clear()
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
              postTo(id, { type: 'init', seed, relay: true }) // 改动通知由右侧栏转告（见下面「本机预览」），页面别自己开 SSE
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
            case 'dragIn':
            case 'dragOut':
            case 'dropIn':
              if (p.onPageDrag) p.onPageDrag(d)
              break
            case 'top':
              // 每帧记着自己的；只有正显示的那帧算数（预载的换上来时再用，旧帧晚到的不管）
              L.tops.set(id, !!d.dark)
              if (isCur && p.onTop) p.onTop(!!d.dark)
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

      // 本机预览：同样按轮询到的改动转告页面，页面自己判断跟它有没有关系（有就交指纹、这里载新的一帧）。
      // 不让每屏各开一条 SSE：画布上到 6 屏就占满浏览器对同一地址的 6 条连接，之后的刷新全卡住
      const lchg = (!rem && props.remote && props.remote.changes) || []
      const lN = lchg.length ? lchg[lchg.length - 1].n : 0
      const lSeen = useRef(lN)
      useEffect(() => {
        const from = lSeen.current
        lSeen.current = lN
        if (rem || lN === from || !curRef.current) return
        const fresh = lchg.filter((c) => c.n > from)
        const unknown = lN < from || !fresh.length || lchg[0].n > from + 1 || fresh.some((c) => !(c.files || []).length)
        const files = unknown ? [] : [...new Set(fresh.flatMap((c) => c.files || []))]
        postTo(curRef.current, { type: 'files', file: files[files.length - 1] || '', files })
      }, [lN])

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
    function KindMenu({ t, kind, open, setOpen, onPick, disabled }) {
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
        h('button', { className: 'ddp-btn' + (open ? ' sel' : ''), title: t('kind'), disabled: !!disabled, onClick: () => setOpen(!open) },
          h(I[kind]), h('span', null, t(KIND_KEY[kind])), h(I.caret)),
        open ? h('div', { className: 'ddp-menu', role: 'menu' },
          h('div', { className: 'hd' }, t('kind')),
          ...KIND_LIST.map((k) => h('button', { key: k, role: 'menuitemradio', 'aria-checked': k === kind, className: k === kind ? 'sel' : '', onClick: () => onPick(k) },
            h(I[k]), h('span', null, t(KIND_KEY[k])), h('em', null, KIND_SIZE[k].join('×'))))) : null)
    }

    // ── 画笔标注：一层透明画布盖在预览上，画的东西按台面上的坐标（CSS 像素）一笔一笔记着，能撤销、能擦 ──
    // 一笔：pen / hl { p: [[x, y]…] } · arrow / rect / oval { a: [x, y], b: [x, y] } · text { x, y, f, v }；都带颜色 c，线宽 w
    const MARK_TOOLS = [['pen', 'pen', 'mkPen', 'p'], ['hl', 'marker', 'mkHl', 'h'], ['arrow', 'arrow', 'mkArrow', 'a'], ['rect', 'square', 'mkRect', 'r'], ['oval', 'circle', 'mkOval', 'o'], ['text', 'text', 'mkText', 't'], ['erase', 'eraser', 'mkErase', 'e']]
    const MARK_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff']
    const MARK_WIDTH = [2, 3, 5]
    const MARK_FONT = [16, 20, 28]
    // 手绘风：字用楷体（像手写），没有就退回系统字
    const MARK_FAMILY = '"Kaiti SC","STKaiti","KaiTi","楷体",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
    const MARK_MAX = 300 // 最多这么多笔（再多就是在乱画了）
    const MOD = /Mac|iPhone|iPad/i.test((typeof navigator !== 'undefined' && navigator.platform) || '') ? '⌘' : 'Ctrl+'

    let markMeasure = null
    /** 一行字画出来多宽 */
    function markTextWidth(text, f) {
      if (!markMeasure) markMeasure = document.createElement('canvas').getContext('2d')
      markMeasure.font = `700 ${f}px ${MARK_FAMILY}`
      return markMeasure.measureText(text).width
    }

    /** 浅色（白、黄）：字的描边换成深色 */
    function markLight(hex) {
      const n = parseInt(String(hex).slice(1), 16)
      return ((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114) > 170
    }

    /** 一笔占的地方（含线宽）：拼图时裁剪、橡皮擦字都按它 */
    function markBox(s) {
      if (s.t === 'text') {
        const lines = s.v.split('\n')
        const w = Math.max(...lines.map((l) => markTextWidth(l, s.f)))
        return { l: s.x, t: s.y, r: s.x + w, b: s.y + lines.length * s.f * 1.3 }
      }
      const pts = s.p || [s.a, s.b]
      const pad = s.w / 2 + (s.t === 'arrow' ? Math.max(14, s.w * 4) : s.p ? 0 : 4 + Math.max(Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1])) * 0.06)
      const xs = pts.map((q) => q[0])
      const ys = pts.map((q) => q[1])
      return { l: Math.min(...xs) - pad, t: Math.min(...ys) - pad, r: Math.max(...xs) + pad, b: Math.max(...ys) + pad }
    }

    /** 这一笔的随机数（-0.5…0.5）：按笔上记的种子 sd 来，重画、拼图时一模一样 */
    function markRand(seed) {
      let v = (seed | 0) % 2147483647
      if (v <= 0) v += 2147483646
      return () => (v = (v * 16807) % 2147483647) / 2147483647 - 0.5
    }

    /** 手绘的一条线：两头和中间都抖一点，弯一点（P：CSS 坐标 → 画布坐标；bend：这条线弯多少，描第二遍时一样） */
    function roughLine(ctx, P, a, b, rnd, amp, bend) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const nx = -(b[1] - a[1]) / len
      const ny = (b[0] - a[0]) / len
      const j = Math.min(len * 0.015, 2.2) * amp
      const bow = Math.min(len * 0.05, 9) * amp
      const pt = (t, off) => [a[0] + (b[0] - a[0]) * t + nx * off + rnd() * j, a[1] + (b[1] - a[1]) * t + ny * off + rnd() * j]
      const k1 = (bend ? bend[0] : rnd()) * bow * 2
      const k2 = (bend ? bend[1] : rnd()) * bow * 2
      const p0 = pt(0, 0)
      const c1 = pt(0.4, k1)
      const c2 = pt(0.75, k2)
      const p1 = pt(1, 0)
      ctx.moveTo(...P(p0))
      ctx.bezierCurveTo(...P(c1), ...P(c2), ...P(p1))
    }

    /** 手绘的圈：从一个随便的角度起笔，绕一圈多一点，半径微微起伏；点和点之间连成顺滑的曲线 */
    function roughLoop(ctx, P, cx, cy, rx, ry, rnd, amp) {
      const start = -Math.PI / 2 - 0.6 + rnd() * 1.2
      const over = 0.45 + rnd() * 0.35
      const n = 44
      const wob = [rnd(), rnd()]
      const pts = []
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const ang = start + t * (Math.PI * 2 + over)
        const m = 1 - 0.04 * amp + (wob[0] * Math.sin(t * 6.3) + wob[1] * Math.sin(t * 12.6 + 1) * 0.6) * 0.1 * amp + rnd() * 0.02 * amp + t * 0.09 * amp
        pts.push(P([cx + Math.cos(ang) * rx * m, cy + Math.sin(ang) * ry * m]))
      }
      ctx.moveTo(...pts[0])
      for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(...pts[i], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
      ctx.lineTo(...pts[pts.length - 1])
    }

    /** 一笔画到画布上（k：CSS 像素 → 画布像素；ox / oy：拼图时裁掉的左上角） */
    function drawMark(ctx, s, k = 1, ox = 0, oy = 0) {
      const X = (v) => (v - ox) * k
      const Y = (v) => (v - oy) * k
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = s.c
      ctx.fillStyle = s.c
      ctx.lineWidth = s.w * k
      if (s.t === 'pen' || s.t === 'hl') {
        // 荧光笔：半透明，压在字上还看得见字
        if (s.t === 'hl') ctx.globalAlpha = 0.38
        const p = s.p
        ctx.beginPath()
        ctx.moveTo(X(p[0][0]), Y(p[0][1]))
        if (p.length === 1) ctx.lineTo(X(p[0][0]) + 0.01, Y(p[0][1]))
        // 相邻两点的中点连二次曲线：手画的线顺一点
        for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(X(p[i][0]), Y(p[i][1]), X((p[i][0] + p[i + 1][0]) / 2), Y((p[i][1] + p[i + 1][1]) / 2))
        if (p.length > 1) ctx.lineTo(X(p[p.length - 1][0]), Y(p[p.length - 1][1]))
        ctx.stroke()
      } else if (s.t === 'arrow' || s.t === 'rect' || s.t === 'oval') {
        const P = (q) => [X(q[0]), Y(q[1])]
        const [x0, y0] = s.a
        const [x1, y1] = s.b
        const br = markRand(s.sd || 1)
        const bends = Array.from({ length: 4 }, () => [br(), br()])
        for (const pass of [0, 1]) {
          const rnd = markRand((s.sd || 1) + pass * 7919)
          ctx.beginPath()
          if (s.t === 'arrow') {
            // 杆子微微弯，箭头是两笔撇出去的（不填实心）
            const ang = Math.atan2(y1 - y0, x1 - x0)
            const head = Math.min(Math.max(16, s.w * 5), Math.hypot(x1 - x0, y1 - y0) * 0.6)
            roughLine(ctx, P, s.a, s.b, rnd, 1, bends[0])
            const sp = 0.5 + bends[3][0] * 0.12
            roughLine(ctx, P, s.b, [x1 - head * Math.cos(ang - sp), y1 - head * Math.sin(ang - sp)], rnd, 0.6, bends[1])
            roughLine(ctx, P, s.b, [x1 - head * Math.cos(ang + sp), y1 - head * Math.sin(ang + sp)], rnd, 0.6, bends[2])
          } else if (s.t === 'rect') {
            const l = Math.min(x0, x1)
            const r = Math.max(x0, x1)
            const tp = Math.min(y0, y1)
            const bt = Math.max(y0, y1)
            // 四条边各画一笔，拐角处稍微出头
            const o = Math.min(6, Math.min(r - l, bt - tp) * 0.06)
            roughLine(ctx, P, [l - o, tp], [r + o * 0.4, tp], rnd, 1, bends[0])
            roughLine(ctx, P, [r, tp - o * 0.4], [r, bt + o], rnd, 1, bends[1])
            roughLine(ctx, P, [r + o, bt], [l - o * 0.4, bt], rnd, 1, bends[2])
            roughLine(ctx, P, [l, bt + o * 0.4], [l, tp - o], rnd, 1, bends[3])
          } else {
            roughLoop(ctx, P, (x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, rnd, 1)
          }
          ctx.lineWidth = s.w * (pass ? 0.5 : 0.85) * k
          ctx.globalAlpha = pass ? 0.75 : 1
          ctx.stroke()
        }
      } else if (s.t === 'text') {
        // 手写的字：楷体，下面一道手画的线
        ctx.font = `700 ${s.f * k}px ${MARK_FAMILY}`
        ctx.textBaseline = 'middle'
        const lh = s.f * 1.3
        const rnd = markRand(s.sd || 1)
        const P = (q) => [X(q[0]), Y(q[1])]
        s.v.split('\n').forEach((line, i) => {
          const yy = s.y + lh * i + lh / 2
          // 描一圈反色的边：白、黄这类浅色描深色，深色描浅色（红字写在红按钮上也看得见）
          ctx.save()
          ctx.strokeStyle = markLight(s.c) ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.85)'
          ctx.lineWidth = Math.max(2, s.f / 7) * k
          ctx.strokeText(line, X(s.x), Y(yy))
          ctx.restore()
          ctx.fillText(line, X(s.x), Y(yy))
          const w = markTextWidth(line, s.f)
          if (!w) return
          ctx.beginPath()
          roughLine(ctx, P, [s.x - 2, yy + s.f * 0.62], [s.x + w + 3, yy + s.f * 0.56], rnd, 0.8)
          ctx.lineWidth = Math.max(1.2, s.f / 12) * k
          ctx.stroke()
        })
      }
      ctx.restore()
    }

    /** 点到线段的距离 */
    function segDist(px, py, a, b) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = dx * dx + dy * dy
      const u = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0
      return Math.hypot(px - a[0] - u * dx, py - a[1] - u * dy)
    }

    /** 手绘的圈、框、箭头实际画在哪：照 drawMark 同样画一遍，路径记成小段折线（橡皮按它判断，抖出去的线也擦得到） */
    function markPath(s) {
      const segs = []
      let cur = null
      const add = (q) => { if (cur) segs.push([cur, q]); cur = q }
      const ctx = {
        save() {}, restore() {}, stroke() {}, fill() {}, fillText() {}, strokeText() {},
        beginPath() { cur = null },
        moveTo(x, y) { cur = [x, y] },
        lineTo(x, y) { add([x, y]) },
        quadraticCurveTo(cx, cy, x, y) {
          const p0 = cur || [x, y]
          for (let i = 1; i <= 6; i++) { const t = i / 6; const u = 1 - t; add([u * u * p0[0] + 2 * u * t * cx + t * t * x, u * u * p0[1] + 2 * u * t * cy + t * t * y]) }
        },
        bezierCurveTo(ax, ay, bx, by, x, y) {
          const p0 = cur || [x, y]
          for (let i = 1; i <= 12; i++) { const t = i / 12; const u = 1 - t; add([u * u * u * p0[0] + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x, u * u * u * p0[1] + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y]) }
        },
      }
      drawMark(ctx, s)
      return segs
    }

    /** 橡皮擦到了这一笔没有（r：橡皮半径） */
    function markHit(s, x, y, r) {
      if (s.t === 'text') {
        const b = markBox(s)
        return x >= b.l - r && x <= b.r + r && y >= b.t - r && y <= b.b + r
      }
      const near = r + s.w / 2
      if (s.p) {
        if (s.p.length === 1) return Math.hypot(x - s.p[0][0], y - s.p[0][1]) <= near
        for (let i = 1; i < s.p.length; i++) if (segDist(x, y, s.p[i - 1], s.p[i]) <= near) return true
        return false
      }
      // 只认真正画出来的那条手绘线，不再按看不见的标准形状补判（不然会擦掉旁边的圈）
      const segs = markPath(s)
      if (segs.length) return segs.some(([a, b]) => segDist(x, y, a, b) <= near)
      return Math.hypot(x - s.a[0], y - s.a[1]) <= near
    }

    /** 按住 Shift：方框 / 圆圈画成正的，箭头吸到 45° 的倍数 */
    function markSnap(tool, a, b) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      if (tool === 'arrow') {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(dx, dy)
        return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len]
      }
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      return [a[0] + (dx < 0 ? -d : d), a[1] + (dy < 0 ? -d : d)]
    }

    /**
     * 一笔跟着它画在的那一屏走：画的时候记下那一屏的位置（an），侧栏拉宽拉窄、开面板、画布自己缩放后，按那一屏现在的位置和大小挪过去。
     * frames：台面上现在每一屏 { key, l, t, w }（台面坐标）
     */
    function markPlace(s, frames) {
      const fit = (an) => {
        const now = an && frames.find((x) => x.key === an.key)
        if (!now) return null
        const k = now.w / an.w
        if (Math.abs(k - 1) < 1e-3 && Math.abs(now.l - an.l) < 0.25 && Math.abs(now.t - an.t) < 0.25) return null
        return { k, P: (q) => [now.l + (q[0] - an.l) * k, now.t + (q[1] - an.t) * k] }
      }
      const A = fit(s.an)
      if (s.t === 'text') { if (!A) return s; const [x, y] = A.P([s.x, s.y]); return { ...s, x, y, f: s.f * A.k } }
      if (s.p && s.ans) {
        // 跨了几屏的自由线：每个点跟着自己那一屏（[x, y, 第几个锚点]）
        const F = s.ans.map(fit)
        return F.some(Boolean) ? { ...s, p: s.p.map((q) => (F[q[2]] ? [...F[q[2]].P(q), q[2]] : q)) } : s
      }
      if (s.p) return A ? { ...s, p: s.p.map(A.P) } : s
      // 箭头、方框、圆圈：两头各跟各的屏（从这一屏指到那一屏的箭头，画布重新排了也还指着那儿）
      const B = s.bn ? fit(s.bn) : A
      if (!A && !B) return s
      return { ...s, a: A ? A.P(s.a) : s.a, b: B ? B.P(s.b) : s.b }
    }

    /** 盖在台面上的画布 + 上面一条工具栏 + 下面「取消 / 交给模型」 */
    function MarkLayer({ t, sending, frames, onCancel, onSend, onCopy }) {
      const wrap = useRef(null)
      const cv = useRef(null)
      const area = useRef(null)
      const [tool, setTool] = useState('pen')
      const [color, setColor] = useState(MARK_COLORS[0])
      const [size, setSize] = useState(1)
      const [pal, setPal] = useState(false) // 颜色板开着
      const [hist, setHist] = useState({ list: [[]], i: 0 }) // 每画一笔存一份整张的，撤销 / 重做就是前后挪
      const [txt, setTxt] = useState(null) // 正在写的字：{ x, y, v }
      // 头几次打开时页面中间教一下怎么用（画了第一笔就收起）
      const [coach] = useState(() => {
        try { const n = Number(localStorage.getItem('ddp-mk-coach')) || 0; if (n >= 3) return false; localStorage.setItem('ddp-mk-coach', String(n + 1)) } catch { /* 存不了就每次都教 */ }
        return true
      })
      const shapes = hist.list[hist.i]
      const cur = useRef(shapes)
      cur.current = shapes
      const opt = useRef({})
      opt.current = { tool, color, size }
      const txtRef = useRef(txt)
      txtRef.current = txt
      const live = useRef(null) // 正在画的那一笔；橡皮：{ erase: 还剩下的, hit }
      const raf = useRef(0)
      const dims = useRef({ w: 0, h: 0, k: 1 })
      const fr = useRef(frames)
      fr.current = frames
      const [, setTick] = useState(0) // 屏挪了：正写着的字框跟着挪
      const where = () => { try { return fr.current() } catch { return [] } }
      const placed = (list, f = where()) => list.map((s) => markPlace(s, f))

      const paint = () => {
        raf.current = 0
        const c = cv.current
        if (!c) return
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, c.width, c.height)
        const lv = live.current
        for (const s of placed(lv && lv.erase ? lv.erase : cur.current)) drawMark(ctx, s, dims.current.k)
        if (lv && !lv.erase) drawMark(ctx, lv, dims.current.k)
      }
      const repaint = () => { if (!raf.current) raf.current = requestAnimationFrame(paint) }
      useEffect(() => () => cancelAnimationFrame(raf.current), [])
      useEffect(() => { paint() }, [shapes])
      // 底下的屏挪了（开关面板、画布自己缩放、模型加了一屏）：跟着重画
      useEffect(() => {
        let sig = ''
        const tm = setInterval(() => {
          const now = where().map((x) => `${x.key}:${Math.round(x.l)},${Math.round(x.t)},${Math.round(x.w)}`).join('|')
          if (now !== sig) { sig = now; repaint(); if (txtRef.current) setTick((n) => n + 1) }
        }, 250)
        return () => clearInterval(tm)
      }, [])

      // 画布跟着台面一样大（右侧栏拉宽拉窄），按屏幕像素密度画，线不糊
      useEffect(() => {
        const el = wrap.current
        if (!el) return undefined
        const fit = () => {
          const r = el.getBoundingClientRect()
          const k = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
          dims.current = { w: r.width, h: r.height, k }
          if (cv.current) {
            cv.current.width = Math.max(1, Math.round(r.width * k))
            cv.current.height = Math.max(1, Math.round(r.height * k))
          }
          paint()
        }
        fit()
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
        if (ro) ro.observe(el)
        try { el.focus({ preventScroll: true }) } catch { /* 点一下画布也行 */ }
        return () => { if (ro) ro.disconnect() }
      }, [])

      const commit = (next) => setHist((hs) => {
        const list = hs.list.slice(Math.max(0, hs.i - 79), hs.i + 1)
        list.push(next)
        return { list, i: list.length - 1 }
      })
      const undo = () => { if (!live.current) setHist((hs) => (hs.i > 0 ? { ...hs, i: hs.i - 1 } : hs)) }
      const redo = () => { if (!live.current) setHist((hs) => (hs.i < hs.list.length - 1 ? { ...hs, i: hs.i + 1 } : hs)) }
      // 清掉：正写着的字也不要了
      const clear = () => {
        if (txtRef.current) { txtRef.current = null; setTxt(null) }
        if (cur.current.length) commit([])
      }

      // 写字：回车 / 点别处算写完；Esc 不要了。颜色、大小按写完那一刻的
      const textOf = (x) => {
        const v = String(x.v || '').replace(/\s+$/, '').slice(0, 2000)
        return v.trim() ? { t: 'text', c: opt.current.color, w: 0, f: MARK_FONT[opt.current.size], x: x.x, y: x.y, v, an: x.an, sd: 1 + Math.floor(Math.random() * 2e9) } : null
      }
      // refocus：回车 / Esc / 点画布写完的，键盘交回画布；点到别处（比如聊天输入框）失焦的，别把焦点抢回来
      const endText = (keep, refocus) => {
        const x = txtRef.current
        if (!x) return null
        txtRef.current = null
        setTxt(null)
        const s = keep ? textOf(x) : null
        if (s && cur.current.length < MARK_MAX) commit([...cur.current, s])
        if (refocus) { try { wrap.current.focus({ preventScroll: true }) } catch { /* 已经关了 */ } }
        return s
      }
      useEffect(() => {
        if (!txt || !area.current || document.activeElement === area.current) return undefined
        const tm = setTimeout(() => { try { area.current.focus({ preventScroll: true }) } catch { /* 关了 */ } }, 0)
        return () => clearTimeout(tm)
      }, [!!txt])

      const at = (e) => {
        const r = wrap.current.getBoundingClientRect()
        return [e.clientX - r.left, e.clientY - r.top]
      }
      const eraseAt = (x, y) => {
        const lv = live.current
        const f = where()
        const left = lv.erase.filter((s) => !markHit(markPlace(s, f), x, y, 6))
        if (left.length !== lv.erase.length) { lv.erase = left; lv.hit = true; repaint() }
      }
      // 画的途中屏要是挪了：按落笔完那一刻那一屏的位置记（这一笔是照着现在看到的画的）
      const reAnchor = (an) => {
        const now = an && where().find((q) => q.key === an.key)
        return now ? { key: now.key, l: now.l, t: now.t, w: now.w } : an
      }
      // 自由线：看每个点落在哪屏；只在一屏里的照旧整条跟那一屏，跨屏的每个点记自己那屏（落在屏外的点跟最近的前后点）
      const penAnchors = (lv) => {
        const fz = where()
        const ans = []
        let last = null
        const idx = lv.p.map(([x, y]) => {
          const hit = last && x >= last.l && x <= last.l + last.w && y >= last.t && y <= last.t + last.h ? last
            : fz.find((q) => x >= q.l && x <= q.l + q.w && y >= q.t && y <= q.t + q.h)
          if (!hit) return -1
          last = hit
          let i = ans.findIndex((a) => a.key === hit.key)
          if (i < 0) { i = ans.length; ans.push({ key: hit.key, l: hit.l, t: hit.t, w: hit.w }) }
          return i
        })
        if (ans.length < 2) return { ...lv, an: ans[0] || reAnchor(lv.an) }
        for (let i = 1; i < idx.length; i++) if (idx[i] < 0) idx[i] = idx[i - 1]
        for (let i = idx.length - 2; i >= 0; i--) if (idx[i] < 0) idx[i] = idx[i + 1]
        return { ...lv, an: ans[0], ans, p: lv.p.map((q, i) => [q[0], q[1], idx[i]]) }
      }
      // 这一点落在哪一屏上（落在屏外就不跟着谁）
      const anchorAt = (x, y) => {
        const hit = where().find((q) => x >= q.l && x <= q.l + q.w && y >= q.t && y <= q.t + q.h)
        return hit ? { key: hit.key, l: hit.l, t: hit.t, w: hit.w } : null
      }
      const onDown = (e) => {
        if (e.button !== 0 || sending || live.current) return
        e.preventDefault()
        setPal(false)
        if (!wrap.current.contains(document.activeElement)) { try { wrap.current.focus({ preventScroll: true }) } catch { /* 键盘快捷键用不了而已 */ } }
        // 正写着字：这一下只算写完
        if (txtRef.current) { endText(true, true); return }
        const [x, y] = at(e)
        const o = opt.current
        if (o.tool === 'text') {
          if (cur.current.length < MARK_MAX) setTxt({ x, y: y - MARK_FONT[o.size] * 0.65, v: '', an: anchorAt(x, y) })
          return
        }
        if (o.tool !== 'erase' && cur.current.length >= MARK_MAX) return
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 拖出去就断了也没事 */ }
        if (o.tool === 'erase') {
          live.current = { erase: cur.current.slice(), hit: false }
          eraseAt(x, y)
          return
        }
        const w = MARK_WIDTH[o.size] * (o.tool === 'hl' ? 4 : 1)
        const an = anchorAt(x, y)
        live.current = o.tool === 'pen' || o.tool === 'hl' ? { t: o.tool, c: o.color, w, p: [[x, y]], an } : { t: o.tool, c: o.color, w, a: [x, y], b: [x, y], an, sd: 1 + Math.floor(Math.random() * 2e9) }
        repaint()
      }
      const onMove = (e) => {
        const lv = live.current
        if (!lv) return
        const [x, y] = at(e)
        if (lv.erase) { eraseAt(x, y); return }
        if (lv.p) {
          const q = lv.p[lv.p.length - 1]
          if (Math.hypot(x - q[0], y - q[1]) >= 1.5 && lv.p.length < 5000) lv.p.push([x, y])
        } else lv.b = e.shiftKey ? markSnap(lv.t, lv.a, [x, y]) : [x, y]
        repaint()
      }
      const onUp = () => {
        const lv = live.current
        if (!lv) return
        live.current = null
        if (lv.erase) { if (lv.hit) commit(lv.erase); else paint(); return }
        // 方框、箭头只点了一下没拖：不算
        if (lv.p) commit([...cur.current, penAnchors(lv)])
        else if (Math.hypot(lv.b[0] - lv.a[0], lv.b[1] - lv.a[1]) >= 4) {
          commit([...cur.current, { ...lv, an: reAnchor(lv.an), bn: anchorAt(lv.b[0], lv.b[1]) }])
        } else paint()
      }

      const onKey = (e) => {
        if (e.target === area.current) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endText(false, true) }
          else if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing) && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); endText(true, true) }
          return
        }
        if (e.target && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return
        const mod = e.metaKey || e.ctrlKey
        const k = String(e.key).toLowerCase()
        let done = true
        if (e.key === 'Escape') { if (pal) setPal(false); else if (!sending) onCancel() }
        else if (mod && k === 'z') { if (e.shiftKey) redo(); else undo() }
        else if (mod && k === 'y') redo()
        else if (mod && k === 'c' && onCopy && !e.shiftKey && !e.altKey) copy()
        else if (!mod && !e.altKey && MARK_TOOLS.some((x) => x[3] === k)) { setTool(MARK_TOOLS.find((x) => x[3] === k)[0]); setPal(false) }
        else done = false
        if (done) { e.preventDefault(); e.stopPropagation() }
      }

      // 交出去的是按屏现在的位置摆好的；正写着的字也算上
      const done = () => {
        const s = txtRef.current ? endText(true, true) : null
        return placed(s && cur.current.length < MARK_MAX ? [...cur.current, s] : cur.current)
      }
      const send = () => { if (!sending) onSend(done()) }
      // 复制：拼成同一张图放进剪贴板，贴到别的地方用（issue #6；不支持的环境不给这个按钮）
      const copy = () => { if (!sending && onCopy) onCopy(done()) }

      // 工具栏上按下去别抢走焦点：正写着的字不会被打断，快捷键也还管用
      const keep = (e) => { if (e.target !== area.current) e.preventDefault() }
      const btn = (key, icon, title, on, run, off) => h('button', { key, type: 'button', className: 'ddp-btn' + (on ? ' sel' : ''), title, 'aria-label': title, 'aria-pressed': on || undefined, disabled: !!off, onClick: run }, h(I[icon]))
      const f = MARK_FONT[size]
      let box = null
      if (txt) {
        // 字框和写完后的字一样跟着那一屏走
        const p = markPlace({ t: 'text', x: txt.x, y: txt.y, f, an: txt.an }, where())
        const pf = p.f
        const lines = txt.v.split('\n')
        const w = Math.max(markTextWidth(txt.v ? '' : t('mkTextPh'), pf), ...lines.map((l) => markTextWidth(l, pf))) + pf
        box = { left: p.x - 3, top: p.y - 1, width: Math.max(pf * 3, Math.min(w, dims.current.w - p.x - 6)), height: lines.length * pf * 1.3 + 2, fontSize: pf, color }
      }
      return h('div', { className: 'ddp-mark', ref: wrap, tabIndex: -1, onKeyDown: onKey },
        h('canvas', { ref: cv, className: 'cv' + (tool === 'text' ? ' tx' : tool === 'erase' ? ' er' : ''), onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp }),
        txt ? h('textarea', {
          ref: area,
          className: markLight(color) ? 'lt' : '',
          value: txt.v,
          placeholder: t('mkTextPh'),
          spellCheck: false,
          rows: 1,
          style: box,
          onChange: (e) => setTxt({ ...txt, v: e.target.value }),
          onBlur: () => endText(true),
        }) : null,
        h('div', { className: 'ddp-mk-top' },
          h('div', { className: 'ddp-mk-tools', onMouseDown: keep },
            ...MARK_TOOLS.map(([id, icon, label, key]) => btn(id, icon, `${t(label)} (${key.toUpperCase()})`, tool === id, () => { setTool(id); setPal(false) })),
            h('span', { className: 'ddp-sep' }),
            h('div', { className: 'ddp-mk-color' },
              h('button', { type: 'button', className: 'ddp-btn' + (pal ? ' sel' : ''), title: t('mkColor'), 'aria-label': t('mkColor'), 'aria-expanded': pal, onClick: () => setPal(!pal) }, h('i', { style: { background: color } })),
              pal ? h('div', { className: 'ddp-mk-pal' }, MARK_COLORS.map((c) => h('button', {
                key: c, type: 'button', className: c === color ? 'sel' : '', style: { background: c }, title: c, 'aria-label': c, onClick: () => { setColor(c); setPal(false) },
              }))) : null),
            h('div', { className: 'ddp-mk-sz', role: 'group', 'aria-label': t('mkSize') },
              MARK_WIDTH.map((_, i) => h('button', { key: i, type: 'button', className: 'ddp-btn' + (i === size ? ' sel' : ''), title: t('mkSize'), 'aria-label': `${t('mkSize')} ${i + 1}`, 'aria-pressed': i === size, onClick: () => setSize(i) },
                h('i', { style: { width: 4 + i * 3 + 'px', height: 4 + i * 3 + 'px' } })))),
            h('span', { className: 'ddp-sep' }),
            btn('undo', 'undo', `${t('mkUndo')} (${MOD}Z)`, false, undo, hist.i === 0),
            btn('redo', 'redo', `${t('mkRedo')} (${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`, false, redo, hist.i >= hist.list.length - 1),
            btn('clear', 'trash', t('mkClear'), false, clear, !shapes.length && !txt))),
        coach && !shapes.length && !txt ? h('div', { className: 'ddp-mk-coach', 'aria-hidden': true },
          h('b', null, t('mkCoach')),
          h('ol', null, h('li', null, t('mkCoach1')), h('li', null, t('mkCoach2')), h('li', null, t('mkCoach3')))) : null,
        h('div', { className: 'ddp-mk-bot' },
          h('div', { className: 'ddp-mk-bar', onMouseDown: keep },
            // 现在这个工具怎么用（只认图标的人也知道该怎么画）
            sending ? h('span', null, t('mkSending')) : h('span', { title: t('mkHow_' + tool) }, h('b', null, t(MARK_TOOLS.find((x) => x[0] === tool)[2])), t('mkHow_' + tool)),
            h('button', { type: 'button', disabled: sending, onClick: onCancel }, t('mkCancel')),
            onCopy ? h('button', { type: 'button', className: 'cp', title: `${t('mkCopyTip')} (${MOD}C)`, disabled: sending, onClick: copy }, t('mkCopy')) : null,
            h('button', { type: 'button', className: 'go' + (shapes.length || (txt && txt.v.trim()) ? '' : ' idle'), disabled: sending, onClick: send }, t('mkSend')))))
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

    /** 风格样板：用这个风格画的一小屏（顶栏、标题、按钮、商品卡、数据卡）；卡片上缩小着放，点开是原大 */
    function StyleSample({ t, x }) {
      const c = x.c
      const L = styleLook(x)
      const muted = { color: c.muted }
      return h('div', { className: 'ddp-sam', style: { background: c.bg, backgroundImage: x.bgImage || 'none', color: c.text, fontFamily: SANS } },
        h('div', { className: 'top' },
          h('i', { className: 'lg', style: { background: c.primary, borderRadius: Math.min(x.radius, 5) } }),
          h('b', { style: L.head }, t('samBrand')),
          h('span', { className: 'nv', style: muted }, t('samNav')),
          h('i', { className: 'av', style: { background: L.img } })),
        h('h5', { style: L.head }, t('samHead')),
        h('p', { style: muted }, t('samSub')),
        h('div', { className: 'acts' }, h('span', { className: 'bt', style: L.btn }, t('samGo')), h('span', { style: { color: c.link } }, t('samMore'))),
        h('div', { className: 'cards' },
          h('div', { className: 'cd', style: L.card },
            h('i', { className: 'im', style: { background: L.img, borderRadius: Math.max(0, x.radius - 6) } }),
            h('b', null, t('samItem')),
            h('span', { style: muted }, t('samMeta')),
            h('div', { className: 'pr' }, h('b', { style: { fontFamily: x.head } }, t('samPrice')), h('span', { className: 'chip', style: L.chip }, t('samTag')))),
          h('div', { className: 'cd', style: L.card },
            h('span', { style: muted }, t('samStat')),
            h('b', { className: 'num', style: L.head }, '86%'),
            h('i', { className: 'bar', style: { background: L.track } }, h('i', { style: { background: c.primary } })),
            h('span', { style: muted }, t('samStatMeta')))))
    }

    /** 一排风格卡：每张是缩小的样板；点一张看原大样板（左右翻），「用这个风格」才交给 onPick */
    function StyleCards({ t, onPick }) {
      const en = t('lang') === 'en'
      const [on, setOn] = useState(-1) // 正在看样板的那个；-1 是看全部
      const was = useRef(-1)
      const box = useRef(null)
      useEffect(() => {
        // 进样板：焦点给「用这个风格」；回全部：焦点回到刚才那张卡
        const el = box.current
        if (!el) return
        const f = on >= 0 ? el.querySelector('.ddp-go') : was.current >= 0 ? el.querySelectorAll('.ddp-sc')[was.current] : null
        if (f) f.focus({ preventScroll: true })
        // 列表和样板高矮不一样，外面滚动的位置会变：把样板 / 刚才那张卡滚进来
        if (was.current >= 0 || on >= 0) (on >= 0 ? el : f || el).scrollIntoView({ block: 'nearest' })
        if (on >= 0) was.current = on
      }, [on])
      const n = STYLES.length
      if (on >= 0) {
        const x = STYLES[on]
        const go = (d) => setOn((on + d + n) % n)
        const onKey = (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(e.key === 'ArrowLeft' ? -1 : 1) } else if (e.key === 'Escape') { e.stopPropagation(); setOn(-1) }
        }
        return h('div', { className: 'ddp-samview', ref: box, onKeyDown: onKey },
          h('button', { className: 'ddp-btn all', onClick: () => setOn(-1) }, h(I.back), h('span', null, t('stylesAll'))),
          h(StyleSample, { key: x.id, t, x }),
          h('div', { className: 'meta' },
            h('b', null, en ? x.en : x.zh),
            h('span', { className: 'sw' }, ...['bg', 'surface', 'text', 'primary', 'accent'].map((k) => h('i', { key: k, title: x.c[k], style: { background: x.c[k] } }))),
            h('p', null, en ? x.den : x.dzh)),
          h('div', { className: 'row' },
            h('button', { className: 'ddp-btn', title: t('stylePrev'), onClick: () => go(-1) }, h(I.back)),
            h('em', null, `${on + 1} / ${n}`),
            h('button', { className: 'ddp-btn nx', title: t('styleNext'), onClick: () => go(1) }, h(I.back)),
            h('button', { className: 'ddp-go', onClick: () => onPick(x) }, t('styleUse'))))
      }
      return h('div', { className: 'ddp-styles', ref: box }, ...STYLES.map((x, i) => h('button', { key: x.id, className: 'ddp-sc', title: en ? x.den : x.dzh, onClick: () => setOn(i) },
        h('span', { className: 'pv', 'aria-hidden': 'true' }, h(StyleSample, { t, x })),
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
      return t('twAskHead') + '\n' + rows.join('\n') + '\n' + t('twAskTail') + '\n'
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
    /** 输入框旁的「选文件夹」：桌面版弹系统的选文件夹窗口，选了填进去；网页版没有这个按钮 */
    function DirButton({ t, onPicked, onSay }) {
      const dp = dirPicker()
      const [busy, setBusy] = useState(false)
      if (!dp) return null
      const pick = async () => {
        if (busy) return
        setBusy(true)
        try {
          const p = await dp.pick()
          if (p) onPicked(p)
        } catch (e) {
          if (onSay) onSay(t('pickDirFail', { msg: e && e.message ? e.message : String(e) }))
        } finally {
          setBusy(false)
        }
      }
      return h('button', { type: 'button', className: 'ddp-dirbtn', title: t('pickDir'), 'aria-label': t('pickDir'), disabled: busy, onClick: pick }, h(I.folder))
    }

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
            h(DirButton, { t, onPicked: setSrc, onSay }),
            h('button', { type: 'submit', disabled: !src.trim() }, t('sysExtract')))))
    }

    const FW_LIST = ['react', 'vue', 'next', 'html']
    const FW_LABEL = { react: 'React + Vite', vue: 'Vue 3 + Vite', next: 'Next.js' }

    /** 转成代码：用什么做、放哪、转几屏；点了把一段话放进输入框，模型调 handoff_design 照交接包做，每屏做完 compare_design */
    function HandoffPanel({ t, sid, root, fileTarget, count, cur, onGo, onSay, onClose }) {
      const [info, setInfo] = useState(null)
      const [fw, setFw] = useState('')
      const [dest, setDest] = useState('')
      const [one, setOne] = useState(false)
      const [moved, setMoved] = useState(null) // 选的文件夹不能直接放：{ dest, why }（'nested' 在里面新建、'beside' 放设计目录旁边）
      const [checking, setChecking] = useState('') // 'busy' 正在问服务器这个文件夹；别的字是没问成的原因
      // 现在是哪套设计、第几次选：选文件夹的窗口开着时换了设计、或者又选了一次 / 手改了路径，旧的结果作废
      // hand：用户自己点过框架（换设计前一直听用户的，不再按选的文件夹自动换）
      const live = useRef({ root, seq: 0, hand: false })
      live.current.root = root
      // 换了会话或设计目录就重新问：先清掉旧的（别把上一套设计的目标发出去）
      useEffect(() => {
        let alive = true
        live.current.seq++
        live.current.hand = false
        setInfo(null)
        setFw('') // 上一套设计的框架（比如已经没有的「跟项目一样」）别留着
        setDest('')
        setMoved(null)
        setChecking('')
        if (!root) return () => { alive = false }
        getJson(`project?session=${encodeURIComponent(sid)}`).then((d) => {
          if (!alive) return
          setInfo(d)
          setFw(d.fw || 'react')
          setDest(d.root === root ? d.dest || '' : '')
        }, () => { if (alive) { setInfo({}); setFw('react') } })
        return () => { alive = false }
      }, [sid, root])
      // 选了文件夹：问一下它是不是项目——是就放进去、跟着它的框架；不是而且有东西，就在里面新建一个目录（下面说一声，能改）
      const pickDest = (dir) => {
        if (live.current.root !== root) return
        const my = ++live.current.seq
        setDest(dir)
        setMoved(null)
        setChecking('busy') // 问清楚之前「开始」点不了：别把没调整过的目录发出去
        getJson(`project?session=${encodeURIComponent(sid)}&dest=${encodeURIComponent(dir)}`).then((d) => {
          if (my !== live.current.seq) return
          if (!d || d.root !== root || typeof d.dest !== 'string') return setChecking(t('hoCheckFail', { msg: '?' }))
          setChecking('')
          setInfo(d)
          setDest(d.dest)
          setMoved(d.why ? { dest: d.dest, why: d.why } : null)
          // 框架按服务器给的默认（是项目就跟它一样，纯 HTML 站点就纯 HTML）；用户自己点过就听用户的，除非点的「跟项目一样」没了
          const same = !!(d.project && d.project.pkg && d.project.framework)
          setFw((f) => (live.current.hand && (f !== 'same' || same) ? f : d.fw || 'react'))
        }, (e) => { if (my === live.current.seq) setChecking(t('hoCheckFail', { msg: (e && e.message) || '?' })) })
      }
      const typeDest = (v) => { live.current.seq++; setChecking(''); setDest(v) }
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
            ...opts.map(([k, l]) => h('button', { key: k, className: 'opt' + (fw === k ? ' on' : ''), onClick: () => { live.current.hand = true; setFw(k) } }, h('i'), h('span', null, l)))),
          h('div', { className: 'row' }, h('label', null, t('hoDest')),
            h('div', { className: 'pathrow' },
              h('input', { type: 'text', value: dest, spellCheck: false, 'aria-label': t('hoDest'), onChange: (e) => typeDest(e.target.value) }),
              h(DirButton, { t, onPicked: pickDest, onSay })),
            checking ? h('p', { className: 'moved' + (checking === 'busy' ? '' : ' bad') }, checking === 'busy' ? t('hoChecking') : checking)
              : moved && moved.dest === dest ? h('p', { className: 'moved' }, t(moved.why === 'beside' ? 'hoBeside' : 'hoMoved', { name: moved.dest.split(/[\\/]/).pop() })) : null),
          count > 1 && cur ? h('div', { className: 'row' }, h('label', null, t('hoScope')),
            h('div', { className: 'seg' },
              h('button', { className: one ? '' : 'on', onClick: () => setOne(false) }, t('hoAll', { n: count })),
              h('button', { className: one ? 'on' : '', onClick: () => setOne(true) }, t('hoOne')))) : null),
        h('footer', null,
          h('button', { className: 'go', disabled: !fw || !dest.trim() || checking === 'busy', onClick: () => onGo({ fw, label, dest: dest.trim(), only: one && count > 1 ? cur : '' }) }, h(I.code), h('span', null, t('hoGo')))))
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
        if (e.target.closest && e.target.closest('.ddp-zoom, .ddp-act, .ddp-take')) return
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
          lab(sc.key, [h('span', { key: 's' }, labelOf(sc)), !picking && props.badge ? props.badge(sc) : null, on && !picking && props.actions ? h('span', { key: 'a', className: 'ddp-act' }, ...props.actions(sc)) : null], cw),
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
        // 只画选中那屏通向哪（不画哪些通向它），底栏、返回这种每屏都有的导航只描框
        const lines = sel ? flowLines(props.flows.filter((x) => x.from === sel), screens.map((x) => x.key), L.pos, kind, size, { lift: LAB / z, z }) : []
        if (lines.length) {
          flowSvg = h('svg', { key: '__flows', className: 'ddp-flows', width: 1, height: 1 },
            ...flowMarks(lines, z).map(([tag, attrs], i) => h(tag, { key: i, ...attrs })))
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
      const [tops, setTops] = useState({}) // 屏 → 顶栏右边是不是深色（小程序胶囊画白的）
      const setTop = (k, dk) => setTops((cur) => (cur[k] === dk ? cur : { ...cur, [k]: dk }))
      const [sel, setSel] = useState('')
      const [panel, setPanel] = useState(false)
      const [styles, setStyles] = useState(false) // 换风格面板
      const [dropping, setDropping] = useState('') // 正拖着文件进来：dragKind 给的种类
      const [dropSoft, setDropSoft] = useState(false) // 拖动在预览页面里：蒙层只是提示、不挡事件（松手由页面转告）
      const softTimer = useRef(0)
      const refInput = useRef(null)
      const pageInput = useRef(null)
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
      const [mark, setMark] = useState(false) // 画笔标注
      const [markBusy, setMarkBusy] = useState(false) // 正在把标注拼成图
      const [markSize, setMarkSize] = useState(null) // 开标注那一刻台面的大小：单页看网页时按它定住页面，台面变了整体缩放、不重排
      const markRun = useRef(0) // 每开 / 关一次标注加一：发送途中关掉（或关了又开）的，旧的那次作废
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
      // 画布上的标题去掉几屏都带的产品名（「首页 · 梅林练」→「首页」）；产品名留给导出的展示图做大标题
      const shortOf = (sc) => {
        const sp = splitTitles(shown.map(labelOf))
        const i = shown.indexOf(sc)
        return (sp.brand && i >= 0 && sp.labels[i]) || labelOf(sc)
      }
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

      // ── 打开本地的 HTML：「浏览…」选一个，或者把文件 / 文件夹拖进来（桌面版才拿得到路径）──
      const openLocal = async (p) => {
        if (!p) return say(t('pathNone'))
        try {
          await openTarget(sid, p)
          setEditing(false)
        } catch (e) {
          say(t('openFailed', { msg: e.message }))
        }
      }
      const browse = hostPaths() ? () => { if (pageInput.current) pageInput.current.click() } : null
      // 拖着文件在预览页面里：iframe 把拖动吃掉了（单页铺满时外面收不到 dragenter），页面转告过来。
      // 蒙层只当提示、不挡事件（不然页面自己的上传区就收不到后面的拖动了）；松手也是页面接住、把文件转过来
      const pageDrag = (d) => {
        clearTimeout(softTimer.current)
        if (d.type === 'dragIn') {
          const list = (Array.isArray(d.items) ? d.items : []).slice(0, 50).filter((x) => x && typeof x.kind === 'string' && typeof x.type === 'string')
          setDropSoft(true)
          setDropping(dragKind({ items: list }))
          // 拖着时页面隔一会儿就报一次；一阵没报（拖出去了、按了 Esc）就收起
          softTimer.current = setTimeout(() => setDropping(''), 900)
          return
        }
        setDropping('')
        if (d.type !== 'dropIn') return // dragOut：到了页面自己的上传区
        const files = (Array.isArray(d.files) ? d.files : []).slice(0, 20).filter((x) => x && x.f && typeof x.f.name === 'string')
        onDropped({ items: files.map((x) => ({ kind: 'file', getAsFile: () => x.f, webkitGetAsEntry: () => ({ isDirectory: !!x.dir }) })) })
      }
      useEffect(() => () => clearTimeout(softTimer.current), [])

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

      // 新版 DSH：我们的整段在输入框里放成一个短标签（悬停看要点，发出去模型拿到整段）。放进去了返回 true
      const chipIn = (text, done) => {
        const s = String(text).trim()
        const c = chipOf(s, t)
        const ia = props.inputActions
        if (!c || !chips || !ia || typeof ia.captureInsertion !== 'function') return false
        try {
          if (!chips.insert(sid, s, c.label, ia.captureInsertion(), chipSrc(c.i))) return false
        } catch (e) {
          console.warn('[dsh-design-studio] 插标签失败', e)
          return false
        }
        // 先把焦点从预览页拿回输入框，再让编辑器把光标放回标签后面（只 focus 元素，光标会跑到最前面）
        try { const el = composerEl(); if (el) { el.focus({ preventScroll: true }); const ed = el.__lexicalEditor; if (ed && typeof ed.focus === 'function') ed.focus() } } catch { /* 用户自己点一下输入框也行 */ }
        say(t(done))
        return true
      }

      // copy：插不进输入框时退回复制到剪贴板（画笔标注不要：别动用户的剪贴板）。插进去了返回 true
      const insert = (text, done = 'inserted', copy = true) => {
        if (chipIn(text, done)) return true
        const ia = props.inputActions
        try {
          if (ia && typeof ia.insertText === 'function') {
            const span = typeof ia.captureInsertion === 'function' ? ia.captureInsertion() : undefined
            const el = composerEl()
            const all = composerText(el)
            const at = span ? span.start : 0
            const ok = all != null && span && span.end <= all.length
            const p = padInsert(text, ok ? all.slice(0, at) : null, ok ? all.slice(span.end) : null, at, done === 'inserted')
            if (ia.insertText(p.text, span)) {
              try { focusAfter(el, p.text, p.back) } catch { /* 用户自己点一下输入框也行 */ }
              say(t(done))
              return true
            }
          }
        } catch (e) {
          console.warn('[dsh-design-studio] insertText 失败', e)
        }
        if (!copy) return false
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => say(t('copied')), (e) => say(t('failed', { msg: e.message })))
        } else say(t('failed', { msg: 'no input' }))
      }

      // 点选的元素 / 区域：新版 DSH 放成标签，旧版照旧插成字
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
        // 晚一拍再收蒙层：真拖放时这个捕获监听先跑，马上收的话 React 还没把 drop 交给蒙层，蒙层就没了（松手什么都不发生）
        const off = () => setTimeout(() => setDropping(''), 0)
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

      const renderScreen = (sc, z, fill) => h(Device, { kind, w: size[0], h: size[1], fill, label: labelOf(sc), top: tops[ik(sc)], os: meta.os },
        h(Screen, { t, remote, onPageDrag: pageDrag,
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
          onTop: (dk) => setTop(ik(sc), dk),
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
        return { img: await loadImg(r.png), w: r.w, h: r.h, links: Array.isArray(r.links) ? r.links : [], top: typeof r.top === 'boolean' ? r.top : null }
      }

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
              try { const c = await captureOf(sc, false); shots.push({ img: c.img, top: c.top, title: labelOf(sc) }) } catch (e) { console.warn('[dsh-design-studio] 截图失败', sc.key, e) }
            }
            if (!shots.length) throw new Error('no screens')
            const sp = splitTitles(shots.map((x) => x.title))
            const colors = pickColors(tokens)
            const blob = await composeShowcase({
              kind,
              size,
              shots: shots.map((x, i) => ({ img: x.img, top: x.top, label: sp.labels[i] || x.title })),
              os: meta.os,
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
          const { img, top } = await captureOf(sc, mode === 'long')
          if (mode === 'frame') await saveImage(base, await composeOne(kind, size, img, labelOf(sc), top, meta.os))
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

      // 几个方向并排时每屏标题旁都挂着「就要这个」，不用先点中那一屏才看得到
      const badge = (sc) => !sc.v && takesOf(shown.map((x) => x.key), sc.key)
        ? h('button', { key: 'p', className: 'ddp-take', title: t('pickThis'), onClick: () => pickDirection(sc) }, h(I.check), h('span', null, t('pickShort')))
        : null

      const actions = (sc) => [
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

      // ── 画笔标注：画完把台面上看得到的几屏各截一张，按位置摆好，叠上画的东西，存进 refs/，路径放进输入框让模型用 read_image 看（不动剪贴板） ──
      const markOff = !url || !!ver || !!demo || inMulti
      const toggleMark = () => {
        markRun.current++
        if (mark) { setMark(false); return }
        setPicking(false)
        setTextEdit(false)
        setStyleEdit(false)
        setPanel(false)
        setStyles(false)
        setHist(false)
        setPhone(false)
        closeCheck()
        setPane('')
        // 之前点选 / 调样式留下的「已选」框别夹在标注里
        for (const a of apis.current.values()) if (a && a.unpin) a.unpin()
        setMarkSize(box.w && box.h ? { w: box.w, h: box.h } : null)
        setMark(true)
      }
      // 换了设计、看旧版本、演示：画的东西对不上了，收掉
      useEffect(() => { markRun.current++; setMark(false) }, [url, markOff])
      // 台面上现在看得到的每一屏：页面 iframe 的位置（台面坐标，画布缩放过的也对），一点没露出来的不要
      const markFrames = () => {
        const stage = stageRef.current
        if (!stage) return []
        const sr = stage.getBoundingClientRect()
        const out = []
        for (const sc of shown) {
          const api = apis.current.get(ik(sc))
          const f = api && typeof api.frame === 'function' ? api.frame() : null
          if (!f) continue
          const r = f.getBoundingClientRect()
          if (r.width < 8 || r.height < 8 || r.right <= sr.left || r.left >= sr.right || r.bottom <= sr.top || r.top >= sr.bottom) continue
          if (typeof f.checkVisibility === 'function' && !f.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
          out.push({ key: ik(sc), sc, api, f, l: r.left - sr.left, t: r.top - sr.top, w: r.width, h: r.height, z: r.width / Math.max(1, f.offsetWidth) })
        }
        return out
      }
      const MARK_SHOTS = 40
      // 截到的是哪一页（只用来起名、写进提示）：本地文件按文件名；开发服务器按路由（/account）；单页应用的 #/account 路由带上
      const markPageOf = (sc, href) => {
        let key = pageOf(sc, href).key
        try {
          const u = new URL(href)
          if (u.origin !== new URL(sc.url).origin) return key
          if (key === sc.key && st && st.target && st.target.kind === 'proxy') key = decodeURIComponent(u.pathname) || sc.key
          if (/^#!?\//.test(u.hash)) key += decodeURIComponent(u.hash)
        } catch { /* 地址不对 */ }
        return key
      }
      // 把画的拼成一张图：画到的那几屏按现在的位置截图，叠上画的（交给模型、复制共用）
      const buildMark = async (list, stage) => {
        const sr = stage.getBoundingClientRect()
        const all = markFrames().filter((x) => x.api.ready())
        const ov = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
        const boxOf = (x) => ({ l: x.l, t: x.t, r: x.l + x.w, b: x.t + x.h })
        // 画到的那几屏（一屏都没碰到：画在屏外空白处的，就把看得到的都拼上）
        const marks = list.map(markBox)
        let shots = all.filter((x) => marks.some((m) => ov(boxOf(x), m)))
        if (!shots.length) shots = all
        // 裁到有东西的那块（画到的屏 + 画的），四周留一点；落在这块里的别的屏也拼上，免得图上空一块
        const pad = 16
        const span = (bs) => ({
          l: Math.max(0, Math.min(...bs.map((b) => b.l)) - pad),
          t: Math.max(0, Math.min(...bs.map((b) => b.t)) - pad),
          r: Math.min(sr.width, Math.max(...bs.map((b) => b.r)) + pad),
          b: Math.min(sr.height, Math.max(...bs.map((b) => b.b)) + pad),
        })
        const crop = span([...shots.map(boxOf), ...marks])
        shots = all.filter((x) => shots.includes(x) || ov(boxOf(x), crop))
        const { l: cl, t: ct, r: cr, b: cb } = crop
        if (!(cr - cl >= 1 && cb - ct >= 1)) throw new Error('empty')
        // 清晰度：至少按屏幕像素；画布缩小着看的，按页面原来的大小截（最多 4 倍），整张不超过 4096
        const zMin = Math.min(1, ...shots.map((x) => x.z))
        const k = Math.min(4096 / Math.max(cr - cl, cb - ct), Math.max(Math.min(2, Math.max(1, window.devicePixelRatio || 1)), Math.min(4, 1 / Math.max(0.05, zMin))))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round((cr - cl) * k))
        c.height = Math.max(1, Math.round((cb - ct) * k))
        const ctx = c.getContext('2d')
        let bg = ''
        for (let el = stage; el && !bg; el = el.parentElement) {
          const v = getComputedStyle(el).backgroundColor
          if (v && !/^(transparent|rgba\(.*,\s*0\))$/.test(v)) bg = v
        }
        ctx.fillStyle = bg || '#f4f4f5'
        ctx.fillRect(0, 0, c.width, c.height)
        if (shots.length > MARK_SHOTS) say(t('mkMany', { n: MARK_SHOTS }))
        const names = []
        for (const [i, x] of shots.entries()) {
          const X = (x.l - cl) * k
          const Y = (x.t - ct) * k
          // 手机框的圆角：往上找一层裁圆角的
          let rad = 0
          for (let el = x.f.parentElement, j = 0; el && el !== stage && j < 4 && !rad; el = el.parentElement, j++) {
            const cs = getComputedStyle(el)
            const v = parseFloat(cs.borderTopLeftRadius) || 0
            if (v && cs.overflow !== 'visible' && el.offsetWidth) rad = v * (el.getBoundingClientRect().width / el.offsetWidth)
          }
          ctx.save()
          ctx.beginPath()
          if (rad && typeof ctx.roundRect === 'function') ctx.roundRect(X, Y, x.w * k, x.h * k, rad * k)
          else ctx.rect(X, Y, x.w * k, x.h * k)
          ctx.clip()
          let name = x.sc.key
          try {
            if (i >= MARK_SHOTS) throw new Error('too many')
            const cap = await x.api.capture({ full: false, scale: Math.min(3, Math.max(1, x.z * k)) })
            // 页面里点链接跳到别的页了：按真正截到的那页起名
            if (cap.href) name = markPageOf(x.sc, cap.href)
            const img = await loadImg(cap.png)
            ctx.fillStyle = '#fff'
            ctx.fillRect(X, Y, x.w * k, x.h * k)
            ctx.drawImage(img, X, Y, cap.w * x.z * k, cap.h * x.z * k)
          } catch (e) {
            // 这一屏截不下来：留个灰块，画的东西还在
            if (i < MARK_SHOTS) console.warn('[dsh-design-studio] 标注截图失败', x.sc.key, e)
            ctx.fillStyle = 'rgba(127,127,127,.18)'
            ctx.fillRect(X, Y, x.w * k, x.h * k)
          }
          ctx.restore()
          if (!names.includes(name)) names.push(name)
        }
        for (const s of list) drawMark(ctx, s, k, cl, ct)
        return { c, names, blob: await canvasBlob(c) }
      }
      const sendMark = async (list) => {
        if (markBusy) return
        if (!list.length) { say(t('mkEmpty')); return }
        const stage = stageRef.current
        if (!stage) return
        const url0 = url
        const run0 = markRun.current
        const stale = () => stRef.current.url !== url0 || markRun.current !== run0
        const root0 = st && st.target && st.target.kind === 'file' ? st.target.root : null
        setMarkBusy(true)
        try {
          const { c, names, blob } = await buildMark(list, stage)
          // 拼图的时候换了设计、关了标注：这张图对不上了，别交
          if (stale()) { if (stRef.current.url !== url0) say(t('mkMoved')); return }
          if (!names.length && curScreen) names.push(curScreen.key)
          const stem = String(names[0] || 'page').replace(/\.html?(?=$|#)/i, '').split(/[/#!]+/).filter(Boolean).pop() || 'page'
          const body = { session: sid, name: `markup-${stem}`, data: await blobB64(blob) }
          if (root0 !== null) body.root = root0
          let saved
          try { saved = await post('ref', body) } catch (e) {
            if (/moved/.test(e.message)) { say(t('mkMoved')); return }
            throw e
          }
          if (stale()) { if (stRef.current.url !== url0) say(t('mkMoved')); return }
          keepThumb(saved.path, c)
          const where = (names.length ? names : [st.label || '']).join(t('sep'))
          // 写在图上的字也用文字带上：模型看图看漏了、或者用的模型看不了图，也知道要改什么
          const notes = list.filter((x) => x.t === 'text').map((x) => t('mkQuote', { v: x.v.replace(/\s*\n\s*/g, ' ') })).join(t('sep'))
          // 插不进输入框：标注层留着（画的还在），提示再点一次；不退回剪贴板
          if (insert(t('mkAsk', { path: saved.path, where, notes: notes ? t('mkNotes', { notes }) : '' }), 'mkIn', false)) setMark(false)
          else say(t('mkNoInput'))
        } catch (e) {
          say(t('mkFail', { msg: e.message }))
        } finally {
          setMarkBusy(false)
        }
      }
      // 复制：同一张图放进剪贴板（issue #6）。点按钮这一下就把「等图拼好」交给剪贴板——拼完再写，
      // Safari 这类会说不是用户点的、不让写；不认这种写法的再用拼好的图写一次
      const copyMark = (list) => {
        if (markBusy) return
        if (!list.length) { say(t('mkEmpty')); return }
        const stage = stageRef.current
        if (!stage) return
        const url0 = url
        const run0 = markRun.current
        const stale = () => stRef.current.url !== url0 || markRun.current !== run0
        const STALE = 'ddp-mark-stale'
        setMarkBusy(true)
        const made = buildMark(list, stage).then((r) => { if (stale()) throw new Error(STALE); return r })
        const png = made.then((r) => r.blob)
        png.catch(() => {}) // 结果在下面看
        let wrote
        try { wrote = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]) } catch (e) { wrote = Promise.reject(e) }
        wrote.catch(() => {})
        ;(async () => {
          try {
            const r = await made
            if (!(await wrote.then(() => true, () => false))) {
              // 等写的工夫里取消了、换了设计：别再把这张旧图写进去
              if (stale()) { if (stRef.current.url !== url0) say(t('mkMoved')); return }
              if (!(await copyImage(r.blob))) { say(t('mkCopyFail')); return }
            }
            if (stale()) return
            say(t('mkCopied'))
            setMark(false)
          } catch (e) {
            if (e && e.message === STALE) { if (stRef.current.url !== url0) say(t('mkMoved')) } else {
              console.warn('[dsh-design-studio] 标注图复制失败', e)
              say(t('mkCopyFail'))
            }
          } finally {
            setMarkBusy(false)
          }
        })()
      }
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

      const bar = h('div', { className: 'ddp-bar' + (editing ? ' editing' : '') },
        editing || !url
          ? h(AddressForm, { t, sid, initial: st && st.target && st.target.kind === 'file' ? st.target.file : st && st.label ? st.label : '', autoFocus: true, onDone: () => setEditing(false), onBrowse: browse })
          : h('div', { className: 'ddp-addr', title: t('editAddr'), onClick: () => setEditing(true) },
            h('i', { className: 'ddp-dot' + (busy ? ' wait' : '') }),
            h('span', null, canvas && screens.length > 1 ? `${st.label} · ${screens.length}` : st.label)),
        h('button', { className: 'ddp-btn pick' + (picking ? ' on' : ''), title: t('pickTip'), disabled: !url || !!ver || !!demo || mark, onClick: togglePick },
          h(I.pick), h('span', null, picking ? t('picking') : t('pick'))),
        h('button', { className: 'ddp-btn' + (textEdit ? ' on' : ''), title: t('textEdit'), disabled: !url || !!ver || !!demo || busy || mark, onClick: toggleText }, h(I.text)),
        h('button', { className: 'ddp-btn' + (styleEdit ? ' on' : ''), title: t('styleEdit'), disabled: styleOff || mark, onClick: toggleStyle }, h(I.sliders)),
        h('button', { className: 'ddp-btn' + (mark ? ' on' : ''), title: t('mark'), 'aria-pressed': mark, disabled: markOff, onClick: toggleMark }, h(I.pen)),
        h('span', { className: 'ddp-sep' }),
        h('div', { className: 'ddp-seg' },
          h('button', { className: 'ddp-btn' + (canvas && !inMulti ? ' sel' : ''), title: t('canvas'), disabled: mark, onClick: () => { setMulti(false); change({ view: 'canvas' }) } }, h(I.canvas)),
          h('button', { className: 'ddp-btn' + (!canvas && !inMulti ? ' sel' : ''), title: t('single'), disabled: mark, onClick: () => { setMulti(false); openSingle() } }, h(I.single)),
          h('button', { className: 'ddp-btn' + (inMulti ? ' sel' : ''), title: sizeSet ? t('sizes') : t('sizesNo'), disabled: !sizeSet || !!ver || mark, onClick: () => setMulti(!inMulti) }, h(I.sizes))),
        h('button', { className: 'ddp-btn o2' + (demo ? ' sel' : ''), title: t('demo'), disabled: !url || !!ver || mark, onClick: toggleDemo }, h(I.play)),
        h(KindMenu, { t, kind, open: menu, setOpen: setMenu, disabled: mark, onPick: (k) => { setMenu(false); change({ kind: k }) } }),
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
          ['o2', I.play, t('demoShort'), !!demo, !url || !!ver || mark, toggleDemo],
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
          keepThumb(saved.path, r.img)
          insert(formatRef(t, { path: saved.path, w: r.w, h: r.h, palette: r.palette, hasDesign: !!url }), 'insertedSend')
        } catch (e) {
          say(t('refFail', { msg: e.message }))
        }
      }
      const imageOf = (list) => [...(list || [])].find((f) => f && /^image\//.test(f.type))
      const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files')
      const pickRef = () => { if (refInput.current) refInput.current.click() }

      const onDropped = (dt) => {
        const d = droppedOf(dt)
        if (d.page) return hostPaths() ? openLocal(pathOf(d.page)) : say(t('dropWebSay'))
        if (d.image) return addRef(d.image)
        return say(d.any ? t(hostPaths() ? 'dropWhat' : 'dropWhatWeb') : t('refNotImage'))
      }

      const rootProps = {
        className: 'ddp',
        tabIndex: -1, // 点了右侧栏就能在这里粘贴图片
        // 拖动在右侧栏里时别让 DSH 看到：它在整页上数进出、松手就把文件加进对话框——
        // 不拦的话它的「拖到这里添加」会盖住右侧栏，我们接住松手后它的蒙层还收不回去
        onDragEnter: (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); clearTimeout(softTimer.current); setDropSoft(false); setDropping(dragKind(e.dataTransfer)) } },
        onDragOver: (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' } },
        onDragLeave: (e) => { if (hasFiles(e)) e.stopPropagation() },
        onDrop: (e) => {
          if (!hasFiles(e)) return
          // 平时是蒙层接住；蒙层刚好不在（比如鼠标动了一下收掉了）也别让文件掉进对话框
          e.preventDefault()
          e.stopPropagation()
          setDropping('')
          onDropped(e.dataTransfer)
        },
        onPaste: (e) => {
          const f = imageOf(e.clipboardData && e.clipboardData.files)
          if (!f) return
          e.preventDefault()
          addRef(f)
        },
      }
      // 盖住整个右侧栏接住松手（不然落在页面 iframe 上就被它吃掉了）；拖动在预览页面里时只是提示（soft），事件照样给页面
      const dropLayer = dropping ? h('div', {
        key: 'drop',
        className: 'ddp-drop' + (dropSoft ? ' soft' : ''),
        // 拖放中不会有 mousemove：鼠标一动就说明拖已经结束了（没收到 drop / dragleave 时别让蒙层一直盖着）
        onMouseMove: () => setDropping(''),
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
        onDragLeave: (e) => { if (e.target === e.currentTarget) setDropping('') },
        onDrop: (e) => {
          e.preventDefault()
          e.stopPropagation()
          setDropping('')
          onDropped(e.dataTransfer)
        },
      }, h('div', { className: 'in' + (dropping === 'web' || dropping === 'other' ? ' no' : '') },
        ...(dropping === 'page' || dropping === 'maybe' ? [h(I.page), h('b', null, t(dropping === 'page' ? 'pageDrop' : 'maybeDrop')), h('span', null, t('pageDropSub'))]
          : dropping === 'web' ? [h(I.page), h('b', null, t('dropWeb')), h('span', null, t('dropWebSub'))]
            : dropping === 'other' ? (hostPaths() ? [h(I.page), h('b', null, t('dropWhat')), h('span', null, t('dropWhatSub'))] : [h(I.page), h('b', null, t('dropWhatWeb')), h('span', null, t('dropWhatWebSub'))])
              : [h(I.image), h('b', null, t('refDrop')), h('span', null, t('refDropSub'))]))) : null
      const fileInput = h('input', {
        key: 'refFile',
        ref: refInput,
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        style: { display: 'none' },
        onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) addRef(f) },
      })
      const pageFileInput = h('input', {
        key: 'pageFile',
        ref: pageInput,
        type: 'file',
        accept: '.html,.htm,text/html',
        style: { display: 'none' },
        onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) openLocal(pathOf(f)) },
      })
      const root = (...kids) => h('div', rootProps, ...kids, dropLayer, fileInput, pageFileInput)

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
          return h(HandoffPanel, { t, sid, root: fileTarget ? st.target.root : '', fileTarget, count: screens.length, cur: (curScreen && curScreen.key) || focus, onGo: doHandoff, onSay: say, onClose: () => setPane('') })
        }
        return null
      }

      if (!url) {
        const toastEl = toast ? h('div', { className: 'ddp-toast' }, h('span', null, toast.text)) : null
        if (st ? st.loading : !waited) return root(h('div', { className: 'ddp-stage', ref: stageRef }), toastEl)
        if (busy) {
          // 模型在做第一屏：先放一个生成中的占位
          return root(
            h('div', { className: 'ddp-stage', ref: stageRef },
              h('div', { className: 'ddp-wait' }, h('div', { className: 'card' }, h(Skeleton, {})), h('p', null, t('waiting'))),
              h('div', { className: 'ddp-glow' }),
              h('div', { className: 'ddp-ring' }),
              busyChip('')),
            toastEl)
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
            h('div', { className: 'ddp-tries' }, h('span', null, t('tryHead')),
              ['try1', 'try2', 'try3'].map((k) => h('button', { key: k, className: 'ddp-try', onClick: () => insert(t(k), 'insertedSend') }, t(k)))),
            h('p', null, t(browse ? 'emptyHintPick' : 'emptyHint')),
            h(AddressForm, { t, sid, className: 'ddp-form', onDone: () => {}, onBrowse: browse }),
            h('p', { className: 'ddp-refline' }, t('refEmpty'), ' · ', h('button', { className: 'lk', onClick: pickRef }, t('refChoose'))),
            h('p', { className: 'ddp-refline' }, t('sysEmptyLine'), ' · ', h('button', { className: 'lk', onClick: () => openPane('systems') }, t('sysOpen'))),
            h('div', { className: 'ddp-stylepick' }, h('b', null, t('stylesHead')), h('p', null, t('stylesTip')), h(StyleCards, { t, onPick: (x) => insert(formatStyle(t, x, false)) }))),
          pane === 'systems' ? sidePane() : null,
          toastEl)
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
                h(Device, { kind, w: size[0], h: size[1], fill, label, top: tops[l.key], os: meta.os },
                  h(Screen, { t, remote, onPageDrag: pageDrag,
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
                    onTop: (dk) => setTop(l.key, dk),
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
          render: (sc, z, i) => h(Device, { kind: items[i].kind, w: items[i].size[0], h: items[i].size[1], label: labelOf(base), top: tops[ik(base) + '|' + i], os: meta.os },
            h(Screen, { t, remote, onPageDrag: pageDrag,
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
              onTop: (dk) => setTop(ik(base) + '|' + i, dk),
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
        const tagAt = (side) => ({ top: kind === 'app' || kind === 'miniprogram' || kind === 'tablet' ? 60 : 10, transform: `scale(${1 / z})`, transformOrigin: 'top ' + side })
        const screenOf = (sc) => h(Screen, { t, remote, onPageDrag: pageDrag, src: sc.url, label: labelOf(sc), busy: false, born: false, picking: false, dark, zoom: z, reloadSeq,
          apis: apis.current, apiKey: 'cmp|' + ik(sc), onMeta: (m, title, toks, dk) => remember(ik(sc), m, title, toks, dk), onTop: (dk) => setTop(ik(sc), dk) })
        body = h('div', { className: 'ddp-single' },
          h('div', { className: 'ddp-fit' + (fill ? ' fill' : ''), style: fill ? undefined : { width: dw, height: dh, transform: `translate(-50%, -50%) scale(${z})` } },
            // 胶囊那块露的是哪一边（把手拖过胶囊中间就是左边那一版），胶囊就跟哪一边的顶栏
            now ? h(Device, { kind, w: size[0], h: size[1], fill, label: labelOf(now), top: tops[ik(has && (cx / 100) * size[0] > size[0] - CAP.right - CAP.w / 2 ? old : now)], os: meta.os },
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
          badge,
          kind,
          size,
          ghost,
          picking: picking || textEdit || styleEdit,
          sel: sel || focus,
          labelOf: shortOf,
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
        // 画笔标注开着：网页按开标注时的大小定住（侧栏拉窄了就整体缩小，不重排），画的才对得上
        const lock = fill && mark && markSize ? markSize : null
        const z = lock ? Math.max(0.05, Math.min(1, box.w / lock.w, box.h / lock.h)) : fill ? 1 : Math.max(0.05, Math.min(1, (box.w - aside - 32) / dw, (box.h - 32 - (ver || hintTop ? 46 : 0)) / dh))
        const one = ver ? shown.find((x) => x.key === focus) || shown[0] || { key: focus, url, label: st.label } : { key: focus, url, label: st.label }
        body = h('div', { className: 'ddp-single', style: aside ? { right: aside } : undefined },
          h('div', { className: 'ddp-fit' + (fill && !lock ? ' fill' : ''), style: fill && !lock ? undefined : { width: lock ? lock.w : dw, height: lock ? lock.h : dh, transform: `translate(-50%, -50%) scale(${z})` } },
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
          mark && !markOff ? h(MarkLayer, { t, sending: markBusy, frames: markFrames, onCancel: () => { markRun.current++; setMark(false) }, onSend: sendMark, onCopy: canCopyImage() ? copyMark : null }) : null,
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
          toast ? h('div', { className: 'ddp-toast' + (mark ? ' mk' : ver || demo || hintText ? ' low' : '') }, h('span', null, toast.text),
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
      try { ctx.effect(() => ensureStyle(), 'dsh-design-studio: styles') } catch (e) { console.warn('[dsh-design-studio] styles', e) }
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

      // 点选标签（DSH 0.2.1 起有这些服务；没有就不注册，点选照旧插字）
      if (typeof ctx.inject === 'function') ctx.inject(['sessions', 'inputTriggers'], (scope) => {
        if (!scope.inputTriggers || typeof scope.inputTriggers.registerSource !== 'function') return
        // 每种图标一个来源（输入框里的标签只带来源名，图标靠它分）；@ 菜单里不出东西
        for (const i of Object.keys(CHIP_ICON)) {
          scope.effect(() => scope.inputTriggers.registerSource({
            trigger: '@',
            name: chipSrc(i),
            order: 1000,
            showGroupTitle: false,
            candidates: async () => [],
            onPick: () => undefined,
            // 标签存的就是整段字：复制出来是它，发给模型也是它（前后空一行，和用户的话分开）
            codec: { clipboardText: pickClip, serialize: async (ref) => pickClip(ref) },
          }), `dsh-design-studio: chips (${i})`)
        }
        scope.effect(() => {
          chips = {
            insert(sid, text, label, span, source) {
              const b = scope.sessions && typeof scope.sessions.binding === 'function' ? scope.sessions.binding(sid) : null
              const actx = b && b.ctx
              if (!actx || !span || !label) return false
              return actx.bail(actx, 'slash/input-insert-reference', { reference: { source: source || PICK_SRC, ref: text, label, clipboardText: pickClip(text) }, span }) === true
            },
          }
          return () => { chips = null }
        }, 'dsh-design-studio: chip insert')
      })
      if (typeof ctx.inject === 'function') ctx.inject(['uiConversation'], (scope) => {
        const ut = scope.uiConversation && scope.uiConversation.userText
        if (!ut || typeof ut.register !== 'function') return
        scope.effect(() => ut.register(pickRule), 'dsh-design-studio: chips in messages')
        scope.effect(() => pickCard(t), 'dsh-design-studio: chip card')
      })
      ctx.effect(() => ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
        name: 'conversation.user.text.node',
        key: 'ddp-pick',
        priority: 100,
      }, ({ node }) => { const c = chipOf(node.data.text, t); return h('span', { className: 'ddp-pickpill', 'data-pick': node.data.text, 'data-i': c ? c.i : 'pick' }, h('span', null, c ? c.label : t('chipOne'))) })), 'dsh-design-studio: chips in messages')

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
    exports._test = { dragKind, droppedOf, pickInfo, pickLabel, pickRanges, pickRule, chipOf, chipRanges, makeT, ZH, EN, formatCheck, formatTweaks, markHit, markPath, STYLES, formatStyle, accentUse, styleLook, padInsert, pageOf, pxOf, styleChanges, formatStyleAsk, takesOf, formatCheckTool, poller, frameOf, paletteOf, formatRef, layoutRow, keyOfPath, flowsOf, flowLines, flowMarks, formatPick, whereOf, parseMeta, sizeOf, layoutGrid, fitCam, tokenKind, formatToken, splitTitles, pickColors, hhmm }
    return module.exports
  },
})
