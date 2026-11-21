#!/usr/bin/env node
// mmwx-plugin:妙妙屋X 插件开发命令行。用法见 mmwx-plugin help。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildFrontend, formatMessages } from '../lib/build.mjs'
import { DevClient, resolveTarget } from '../lib/client.mjs'
import { create } from '../lib/create.mjs'
import { generateSignKey, pack, readManifest } from '../lib/pack.mjs'
import { c, fail, ok, printLog, say, warn } from '../lib/ui.mjs'

const HELP = `
${c.bold('mmwx-plugin')} —— 妙妙屋X 插件开发工具

  mmwx-plugin create <id> [目录]           新建插件项目(前端页面 + 后端路由示例)
  mmwx-plugin dev                          本机开发:推送、反代面板、热更新、实时日志
      --master <url>   主控面板地址        --token <令牌>   开发令牌(面板「系统设置 → 插件 → 开发者模式」生成)
      --port 5174      本机开发服务器端口  --no-proxy       不反代面板,只发插件资源
      --local-backend  后端跑在本机        --inspect[=9229] 后端可下断点(隐含 --local-backend)
      --no-push        启动时不推送        --save           把 master / token 存进 .mmwx-dev.json
  mmwx-plugin build                        生产构建前端到 dist/
  mmwx-plugin pack [--key 私钥文件] [-o 输出.zip]   构建并打成插件包(可签名)
  mmwx-plugin deploy                       构建、打包并推送到主控(参数同 dev)
  mmwx-plugin logs                         只看实时日志(参数同 dev)
  mmwx-plugin keygen -o <私钥文件>          生成签名密钥对(公钥填进主控 PLUGIN_SIGN_PUB_KEYS)

  主控地址和令牌也可以用环境变量 MMWX_MASTER / MMWX_DEV_TOKEN,或插件目录里的 .mmwx-dev.json。
  通用:--dir <插件目录>(默认当前目录)
`

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o') {
      out.out = argv[++i]
    } else if (a.startsWith('--no-')) {
      out[a.slice(5)] = false
    } else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2)
      if (v !== undefined) out[k] = v
      else if (['inspect', 'save', 'local-backend', 'local', 'verbose', 'help'].includes(k)) out[k] = true
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) out[k] = argv[++i]
      else out[k] = true
    } else {
      out._.push(a)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const root = resolve(args.dir || '.')
  switch (cmd) {
    case 'create': {
      const id = args._[1]
      if (!id) throw new Error('用法: mmwx-plugin create <插件 id> [目录]')
      const dir = resolve(args._[2] || id)
      create(id, dir, { name: args.name })
      ok(`已新建 ${dir}`)
      console.log(`\n  cd ${args._[2] || id}\n  npm install\n  npx mmwx-plugin dev --master https://你的面板 --token <开发令牌> --save\n`)
      return
    }
    case 'build': {
      const m = readManifest(root)
      const r = await buildFrontend(root, m, { dev: false })
      if (r.skipped) warn('没有 src/index.*,跳过前端构建')
      else ok(`前端已构建 → ${r.outfile}${r.warnings?.length ? '\n' + formatMessages(r.warnings) : ''}`)
      return
    }
    case 'pack': {
      const m = readManifest(root)
      await buildFrontend(root, m, { dev: false })
      const p = pack(root, m, { keyFile: args.key })
      const out = resolve(args.out || `${m.id}-${m.version}.zip`)
      writeFileSync(out, p.zip)
      ok(`${out}(${(p.zip.length / 1024).toFixed(1)} KB,${p.files.length} 个文件${p.signed ? ',已签名' : ',未签名'})`)
      say(c.dim(`摘要 ${p.digest}`))
      return
    }
    case 'deploy': {
      const m = readManifest(root)
      const client = new DevClient(resolveTarget(root, args, m.id))
      await buildFrontend(root, m, { dev: false })
      const p = pack(root, m, { keyFile: args.key })
      const res = await client.push(p.zip)
      if (!res.success && res.error) throw new Error(`已推送,但加载失败:\n${res.error}`)
      ok(`已推送 ${m.id} v${res.version}`)
      if (res.requires_consent) warn('到面板「系统设置 → 插件」确认权限并启用')
      return
    }
    case 'logs': {
      const m = readManifest(root)
      const client = new DevClient(resolveTarget(root, args, m.id))
      await client.info()
      ok(`实时日志:${m.id}(Ctrl+C 退出)`)
      client.streamLogs({
        backlog: Number(args.backlog ?? 50),
        onLog: (l) => printLog(l),
        onEnd: () => {
          fail('开发会话已结束')
          process.exit(1)
        },
        onError: (e) => {
          fail(e.message)
          process.exit(1)
        },
      })
      return
    }
    case 'dev': {
      const { dev } = await import('../lib/dev.mjs')
      await dev(root, args)
      return
    }
    case 'keygen': {
      if (!args.out) throw new Error('用法: mmwx-plugin keygen -o <私钥文件>')
      const k = generateSignKey()
      writeFileSync(resolve(args.out), k.privateB64 + '\n', { mode: 0o600 })
      ok(`私钥已写入 ${args.out}(妥善保管,不要提交)`)
      console.log(`公钥(主控 PLUGIN_SIGN_PUB_KEYS):\n${k.publicB64}`)
      return
    }
    case 'version':
    case '--version':
    case '-v':
      console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version)
      return
    default:
      console.log(HELP)
      if (cmd && cmd !== 'help' && !args.help) process.exitCode = 1
  }
}

main().catch((e) => {
  fail(e.message)
  process.exit(1)
})
