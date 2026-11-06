/**
 * 「用这个开始」：把一个设计包（朋友传的 zip，以后还有市场下载的）落到用户电脑上的一个新文件夹里
 *
 *   1. 规范化（去注释、站外链接改成 #）后，用和机器人同一份规则再查一遍；不过就拒
 *   2. 定目标目录：<会话目录>/<名字>，重名加 -2；会话目录是家目录或没有时放 ~/DSH 设计/<名字>
 *   3. 新建目录（必须是新的），防软链接越界，按清单里屏的顺序逐个写（画布按创建时间排，清单也认）
 *   4. design.json 带上来源（from），CC-BY 的写 ATTRIBUTION.md
 *   5. 在作品库登记：trust（zip / market）+ 每个 HTML 落地时的 sha256 —— 预览时内容没变就按「别人做的」加严格规矩
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkPack, normalizeHtml, message, cleanPath } from './policy.js'
import { sha256 } from '../works.js'

/** 文件夹名：去掉路径和系统不让用的字符，限长；空了用 fallback */
export function slugOf(name, fallback = 'template') {
  const s = [...String(name || '').normalize('NFC')
    .replace(/\.zip$/i, '')
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]+/g, ' ')
    .replace(/^[.\s_-]+|[.\s]+$/g, '')
    .replace(/\s+/g, '-')].slice(0, 40).join('').replace(/[.-]+$/, '')
  return s && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? s : fallback
}

/** 目标目录：base/<slug>，有了就 -2、-3… */
export function freshDir(base, slug) {
  for (let i = 1; i < 100; i++) {
    const p = path.join(base, i === 1 ? slug : `${slug}-${i}`)
    if (!fs.existsSync(p)) return p
  }
  throw new Error('同名的文件夹太多了')
}

/** 放在哪个目录下：会话目录（不是家目录、存在）→ 它；不然 ~/DSH 设计 */
export function baseFor(cwd, home = os.homedir()) {
  try {
    if (cwd && path.resolve(cwd) !== path.resolve(home) && fs.statSync(cwd).isDirectory()) return path.resolve(cwd)
  } catch { /* 用默认 */ }
  return path.join(home, 'DSH 设计')
}

class UseError extends Error {
  constructor(msg, errors = []) {
    super(msg)
    this.errors = errors
  }
}

/**
 * 包（[{ path, data: Buffer }]）→ 检查过的、要写的文件 + 清单；不过关抛 UseError（errors 里是每条问题）
 * 规范化只做「去掉 / 改掉」的事（注释、站外链接、表单地址），别的照原样
 */
export function preparePack(files, { lang = 'zh' } = {}) {
  const fixed = files.map((f) => {
    if (/\.html$/i.test(f.path) && Buffer.isBuffer(f.data)) {
      const r = normalizeHtml(f.data.toString('utf8'), { file: f.path })
      return { path: f.path, data: Buffer.from(r.text, 'utf8') }
    }
    return f
  })
  const r = checkPack(fixed, { mode: 'install' })
  if (!r.ok) {
    const errors = r.errors.map((p) => ({ ...p, msg: message(p, lang) }))
    throw new UseError(errors.some((e) => e.code === 'noManifest') ? 'noManifest' : 'check', errors)
  }
  if (r.type !== 'template') throw new UseError('type')
  return { files: fixed, manifest: r.manifest, screens: r.screens, kind: r.kind, flags: r.flags.map((p) => ({ ...p, msg: message(p, lang) })) }
}

/**
 * 落地。from：{ zip: 文件名 } 或 { id, rev, author, license, url }（市场）
 * 返回 { dir, first, screens, manifest }
 */
export function installPack(prepared, { base, name, trust, from, library, now = Date.now() }) {
  const { files, manifest, screens } = prepared
  fs.mkdirSync(base, { recursive: true })
  const realBase = fs.realpathSync(base)
  const dest = freshDir(realBase, slugOf(name))
  fs.mkdirSync(dest)
  const realDest = fs.realpathSync(dest)
  if (path.dirname(realDest) !== realBase) throw new UseError('path')
  const inside = (p) => p.startsWith(realDest + path.sep)
  const rank = new Map(screens.map((s, i) => [s.toLowerCase(), i]))
  const ordered = [...files].filter((f) => f.path !== 'design.json').sort((a, b) => {
    const ra = rank.has(a.path.toLowerCase()) ? rank.get(a.path.toLowerCase()) : -1
    const rb = rank.has(b.path.toLowerCase()) ? rank.get(b.path.toLowerCase()) : -1
    // 样式、图片先写（屏一出来就有样子），屏按清单顺序最后写
    if ((ra < 0) !== (rb < 0)) return ra < 0 ? -1 : 1
    return ra - rb || a.path.localeCompare(b.path)
  })
  const hashes = {}
  for (const f of ordered) {
    const rel = cleanPath(f.path)
    if (!rel) throw new UseError('path')
    const abs = path.resolve(realDest, rel)
    if (!inside(abs)) throw new UseError('path')
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const parent = fs.realpathSync(path.dirname(abs))
    if (parent !== realDest && !inside(parent)) throw new UseError('path')
    fs.writeFileSync(abs, f.data, { flag: 'wx' }) // 新目录里不该已经有：有就是包里重名，出错
    if (/\.html$/i.test(rel)) hashes[rel] = sha256(f.data)
  }
  const m = { ...manifest, from: { ...from, at: new Date(now).toISOString() } }
  delete m.shareToken
  delete m.shareHash // 别人分享时的记号，不是你的
  fs.writeFileSync(path.join(realDest, 'design.json'), JSON.stringify(m, null, 2) + '\n', { flag: 'wx' })
  if (manifest.license === 'CC-BY-4.0') {
    const who = (manifest.author && (manifest.author.name || manifest.author.login)) || (from && from.author) || ''
    const title = (manifest.title && (manifest.title.zh || manifest.title.en)) || ''
    // CC BY 要写清：名字、作者、来源、授权（来源只认 GitHub 上的链接：目录签过名，这里再挡一下）
    const src = from && typeof from.url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/[\w./%-]*$/.test(from.url) ? from.url : ''
    const line = `这套设计基于「${title}」${who ? `（作者：${who}）` : ''}，按 CC BY 4.0 授权使用。${src ? `来源：${src}` : ''}\nBased on "${title}"${who ? ` by ${who}` : ''}, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).${src ? ` Source: ${src}` : ''}\n`
    // 包里已经有署名（转手的 CC BY 设计）：原来的留着，这一手接在后面
    const had = ordered.find((f) => f.path.toLowerCase() === 'attribution.md')
    if (had) fs.appendFileSync(path.join(realDest, cleanPath(had.path)), '\n' + line)
    else fs.writeFileSync(path.join(realDest, 'ATTRIBUTION.md'), `# 署名 / Attribution\n\n${line}`, { flag: 'wx' })
  }
  const title = (manifest.title && (manifest.title.zh || manifest.title.en)) || path.basename(realDest)
  if (library) library.put(realDest, { title, kind: manifest.kind, screens: screens.length, trust, hashes, from: m.from, hidden: undefined })
  return { dir: realDest, first: path.join(realDest, screens[0]), screens, manifest: m }
}

export { UseError }
