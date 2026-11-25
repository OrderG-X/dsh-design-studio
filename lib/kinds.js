// 设计类型的唯一一份表（服务端用）：加新类型改这里，core / look / gallery/policy 都从这里取。
// client.js 是单独打包进页面的，有自己的一份，靠 test-client 里的对照测试看住。

/** 设计类型和默认画幅（宽, 高） */
export const KIND_SIZE = { web: [1280, 800], app: [390, 844], miniprogram: [375, 812], tablet: [820, 1180], desktop: [1280, 800], poster: [1080, 1350], slides: [1280, 720], email: [640, 960], diagram: [1600, 1000], dshplugin: [1280, 800], framed: [1280, 800] }

/** 全部类型（顺序 = 界面里列出的顺序） */
export const KINDS = Object.keys(KIND_SIZE)

/** 页面 <meta name="dsh-design"> 里认的类型别名（比 core 的 parseKind 少，故意不合并） */
export const META_ALIAS = { phone: 'app', mobile: 'app', ios: 'app', android: 'app', mini: 'miniprogram', miniapp: 'miniprogram', weapp: 'miniprogram', wechat: 'miniprogram', 小程序: 'miniprogram', pad: 'tablet', ipad: 'tablet', pc: 'desktop', electron: 'desktop', tauri: 'desktop', mac: 'desktop', macos: 'desktop', windows: 'desktop', win: 'desktop', 桌面: 'desktop', 桌面软件: 'desktop', social: 'poster', image: 'poster', slide: 'slides', deck: 'slides', ppt: 'slides', mail: 'email', mindmap: 'diagram', roadmap: 'diagram', architecture: 'diagram', flowchart: 'diagram', 思维导图: 'diagram', 导图: 'diagram', 路线图: 'diagram', 架构图: 'diagram', 图表: 'diagram', '路线图·导图': 'diagram', dsh: 'dshplugin', 'dsh-plugin': 'dshplugin', dsh插件: 'dshplugin', frame: 'framed', 外框: 'framed', 自定外框: 'framed', 套外框: 'framed', 外壳: 'framed', 自定义外壳: 'framed' }
