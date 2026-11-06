/**
 * 设计库读 npm 包（tgz）：只收 package/ 下的普通文件；软链接、路径穿越、超限都拒。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { readTar } from '../lib/gallery/tar.js'
import * as gallery from '../lib/gallery/index.js'

function header(name, { size = 0, type = '0', link = '' } = {}) {
  const h = Buffer.alloc(512)
  h.write(name.slice(0, 100), 0, 'utf8')
  h.write('0000644\0', 100)
  h.write('0000000\0', 108)
  h.write('0000000\0', 116)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124)
  h.write('00000000000\0', 136)
  h.write('        ', 148)
  h.write(type, 156)
  if (link) h.write(link, 157)
  h.write('ustar\0', 257)
  h.write('00', 263)
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}
function tar(entries) {
  const parts = []
  for (const e of entries) {
    const data = Buffer.from(e.data || '')
    parts.push(header(e.name, { size: data.length, type: e.type || '0', link: e.link }))
    if (data.length) parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(parts))
}

test('读出 package/ 下的文件，去掉前缀', () => {
  const f = readTar(tar([{ name: 'package/', type: '5' }, { name: 'package/index.json', data: '{"a":1}' }, { name: 'package/thumbs/a.webp', data: 'RIFF' }]))
  assert.deepEqual(f.map((x) => x.path), ['index.json', 'thumbs/a.webp'])
  assert.equal(f[0].data.toString(), '{"a":1}')
})

test('软链接、硬链接、设备文件拒', () => {
  assert.throws(() => readTar(tar([{ name: 'package/x', type: '2', link: '/etc/passwd' }])), (e) => e.code === 'link')
  assert.throws(() => readTar(tar([{ name: 'package/x', type: '1', link: 'package/y' }])), (e) => e.code === 'link')
  assert.throws(() => readTar(tar([{ name: 'package/x', type: '3' }])), (e) => e.code === 'link')
})

test('路径穿越、绝对路径、不在 package/ 下的拒', () => {
  assert.throws(() => readTar(tar([{ name: 'package/../../x', data: 'a' }])), (e) => e.code === 'path')
  assert.throws(() => readTar(tar([{ name: '/etc/x', data: 'a' }])), (e) => e.code === 'path')
  assert.throws(() => readTar(tar([{ name: 'other/x', data: 'a' }])), (e) => e.code === 'path')
  assert.throws(() => readTar(tar([{ name: 'package/a\\b', data: 'a' }])), (e) => e.code === 'path')
  assert.throws(() => readTar(tar([{ name: 'package/A.txt', data: 'a' }, { name: 'package/a.txt', data: 'b' }])), (e) => e.code === 'path')
})

test('超限拒；校验和不对拒', () => {
  assert.throws(() => readTar(tar([{ name: 'package/a', data: 'x'.repeat(100) }]), { files: 10, file: 50, total: 1000 }), (e) => e.code === 'big')
  assert.throws(() => readTar(tar([{ name: 'package/a', data: 'x' }, { name: 'package/b', data: 'x' }]), { files: 1, file: 50, total: 1000 }), (e) => e.code === 'count')
  const raw = zlib.gunzipSync(tar([{ name: 'package/a', data: 'x' }]))
  raw[0] = 0x51 // 改了名字，校验和就对不上
  assert.throws(() => readTar(raw), (e) => e.code === 'bad')
})

test('pax 长文件名', () => {
  const long = 'package/' + 'd/'.repeat(30) + 'a-very-long-file-name.json'
  const rec = ` path=${long}\n`
  const len = String(rec.length + 2).length + rec.length
  const pax = `${len}${rec}`
  const f = readTar(tar([{ name: 'PaxHeader', type: 'x', data: pax }, { name: 'package/short', data: '1' }]))
  assert.equal(f[0].path, long.slice('package/'.length))
})

// 记录长度按字节算：「<n> key=value\n」里 n 包括自己的位数
function paxRec(key, value) {
  const body = ` ${key}=${value}\n`
  const b = Buffer.byteLength(body)
  let n = b + 1
  while (String(n).length + b !== n) n = String(n).length + b
  return `${n}${body}`
}

test('pax 长中文文件名（按字节算长度），后面还有别的键', () => {
  const name = 'package/assets/' + '设'.repeat(40) + '.svg'
  const pax = paxRec('path', name) + paxRec('mtime', '1730000000.5') + paxRec('ctime', '1730000000.5')
  const f = readTar(tar([{ name: 'PaxHeader/x', type: 'x', data: pax }, { name: 'package/assets/short.svg', data: '<svg/>' }, { name: 'package/b.txt', data: 'b' }]))
  assert.deepEqual(f.map((x) => x.path), ['assets/' + '设'.repeat(40) + '.svg', 'b.txt'])
})

test('pax 记录边界不对：拒', () => {
  // 长度写小了（按字符数算的）：切出来不以换行结尾
  const name = 'package/' + '设'.repeat(40) + '.svg'
  const body = ` path=${name}\n`
  const bad = `${body.length + 3}${body}`
  assert.throws(() => readTar(tar([{ name: 'PaxHeader/x', type: 'x', data: bad }, { name: 'package/a', data: '1' }])), (e) => e.code === 'bad')
  // 长度越界
  assert.throws(() => readTar(tar([{ name: 'PaxHeader/x', type: 'x', data: '999 path=package/a\n' }, { name: 'package/a', data: '1' }])), (e) => e.code === 'bad')
  // 长度不是数
  assert.throws(() => readTar(tar([{ name: 'PaxHeader/x', type: 'x', data: 'zz path=package/a\n' }, { name: 'package/a', data: '1' }])), (e) => e.code === 'bad')
})

test('./gallery 出口齐全', () => {
  for (const k of ['checkPack', 'normalizeHtml', 'message', 'readZip', 'writeZip', 'readTar', 'renderPack', 'KIND_SIZE', 'findBrowser', 'LICENSES']) assert.ok(k in gallery, k)
})
