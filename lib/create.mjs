// mmwx-plugin create:从模板新建插件项目。
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('../templates/default/', import.meta.url))
const SDK_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function create(id, dir, { name } = {}) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id) || ['ui', 'admin', 'api', 'sdk'].includes(id)) {
    throw new Error('插件 id 只能是小写字母开头的 2–32 位小写字母 / 数字 / -,且不能是 ui / admin / api / sdk')
  }
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} 已存在且不是空目录`)
  cpSync(TEMPLATE, dir, { recursive: true })
  const vars = { id, name: name || id, sdkVersion: SDK_VERSION }
  for (const f of walk(dir)) {
    const s = readFileSync(f, 'utf8')
    writeFileSync(f, s.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m))
  }
  // npm 发包会吃掉 .gitignore,模板里存成 gitignore
  const gi = join(dir, 'gitignore')
  if (existsSync(gi)) renameSync(gi, join(dir, '.gitignore'))
}
