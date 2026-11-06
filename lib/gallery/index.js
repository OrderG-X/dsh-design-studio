/**
 * `dsh-design-studio/gallery`：给设计市场的内容仓库（机器人 / CI）用的出口。
 * 规则和插件里「用这个开始」「打成 zip」是同一份，机器人按版本钉住插件，两边不会各查各的。
 *
 *   checkPack / checkManifest / checkStyle / normalizeHtml / message   检查规则（不依赖 Node）
 *   readZip / writeZip / readTar                                         zip、npm 包 tgz（不加依赖）
 *   cssTokens                                                            CSS 分词（转义会还原）
 *   renderPack                                                           断网开出来跑体检、截图（要 Chrome）
 */

export {
  FORMAT, LIMITS, TYPES, LICENSES, KINDS, STYLE_IDS, HEADS,
  checkPack, checkManifest, checkStyle, normalizeHtml, message, hexRatio, metaKind, titleOf, cleanPath, textFlags, imageMeta, localPathIn,
} from './policy.js'
export { stripMeta, stripInline } from './pack.js'
export { readZip, writeZip, crc32, ZipError, ZIP_LIMITS } from './zip.js'
export { readTar, TarError, TAR_LIMITS } from './tar.js'
export { cssTokens } from './css.js'
export { renderPack, HARD } from './render.js'
export { decodePng, findQrLike } from './qrfind.js'
export { KIND_SIZE } from '../look.js'
export { findBrowser } from '../browser.js'
