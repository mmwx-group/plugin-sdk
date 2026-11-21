// 打插件包:收集 plugin.json + 后端脚本 + 前端产物 / 文案 / assets,算摘要(与主控 internal/plugins Digest 一致),可选签名。
import { createHash, createPrivateKey, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { writeZip } from './zip.mjs'

export const SIGNATURE_FILE = 'plugin.sig'
const MAX_PACKAGE = 10 << 20

function walk(root, dir, out) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(root, p, out)
    else out.add(relative(root, p).split(sep).join('/'))
  }
}

/** 包里要放哪些文件(相对插件根)。 */
export function packageFiles(root, manifest) {
  const files = new Set(['plugin.json'])
  if (manifest.backend?.entry) files.add(manifest.backend.entry)
  const fe = manifest.frontend
  if (fe?.entry) {
    const dir = posix.dirname(fe.entry)
    if (dir && dir !== '.') walk(root, join(root, dir), files)
    else files.add(fe.entry)
    if (fe.style) files.add(fe.style)
    for (const p of Object.values(fe.locales ?? {})) files.add(p)
  }
  walk(root, join(root, 'assets'), files)
  const list = [...files].filter((f) => !f.endsWith('.map'))
  for (const f of list) {
    if (!existsSync(join(root, f))) throw new Error(`plugin.json 里提到的 ${f} 不存在(前端要先 build)`)
  }
  return list.sort()
}

/** 规格 §1 的包摘要:按路径字典序拼「路径 \0 hex(sha256(内容)) \n」再 sha256。 */
export function digest(fileMap) {
  const h = createHash('sha256')
  for (const name of [...fileMap.keys()].filter((n) => n !== SIGNATURE_FILE).sort()) {
    h.update(name)
    h.update(Buffer.from([0]))
    h.update(createHash('sha256').update(fileMap.get(name)).digest('hex'))
    h.update('\n')
  }
  return h.digest()
}

// ed25519 私钥文件:base64(64 字节 = 种子 32 + 公钥 32),与 go run ./cmd/plugin-sign -genkey 一致
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

export function loadSignKey(file) {
  const raw = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
  if (raw.length !== 64) throw new Error('私钥文件格式不对(要 base64 的 64 字节 ed25519 私钥)')
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' })
}

export function signDigest(d, key) {
  return edSign(null, d, key).toString('base64')
}

/** 生成签名密钥对:返回 {privateB64, publicB64}(格式与 plugin-sign 一致)。 */
export function generateSignKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return { privateB64: Buffer.concat([seed, pub]).toString('base64'), publicB64: pub.toString('base64') }
}

/** 打包:返回 {zip, digest(hex), files, signed}。 */
export function pack(root, manifest, { keyFile } = {}) {
  const fileMap = new Map()
  for (const f of packageFiles(root, manifest)) fileMap.set(f, readFileSync(join(root, f)))
  const d = digest(fileMap)
  const entries = [...fileMap.entries()]
  if (keyFile) entries.push([SIGNATURE_FILE, Buffer.from(signDigest(d, loadSignKey(keyFile)))])
  const zip = writeZip(entries)
  if (zip.length > MAX_PACKAGE) throw new Error(`插件包 ${(zip.length / 1048576).toFixed(1)} MB,超过 10 MB 上限`)
  return { zip, digest: d.toString('hex'), files: [...fileMap.keys()], signed: Boolean(keyFile) }
}

export function readManifest(root) {
  const p = join(root, 'plugin.json')
  if (!existsSync(p)) throw new Error(`${root} 里没有 plugin.json(要在插件目录里运行,或用 --dir 指定)`)
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    throw new Error(`plugin.json 不是合法的 JSON: ${e.message}`)
  }
}

