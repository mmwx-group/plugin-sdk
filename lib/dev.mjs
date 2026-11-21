// mmwx-plugin dev:本机开发一条龙。
//
//   1. 构建前端并推送到主控(第一次推送 = 安装;之后热重载、保持信任)
//   2. 起本机开发服务器:插件前端从本机加载 + 反代整个面板(默认 http://localhost:5174)
//   3. 改 src/ → 增量构建 → 浏览器里插件自动热更新(不推送)
//      改 server.js → 推送到主控热重载;--local-backend 时改为重启本机运行时
//      改 plugin.json → 推送 + 面板重取插件清单
//   4. 终端里看实时日志(插件日志 + 请求 / 事件 / 定时任务 / 推送过程)
//   5. --local-backend:后端跑在本机(主控把调用转过来),--inspect 可以下断点
import { fork } from 'node:child_process'
import { watch } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFrontend, findSourceEntry, formatMessages, watchFrontend } from './build.mjs'
import { DevClient, resolveTarget } from './client.mjs'
import { startDevServer } from './devserver.mjs'
import { pack, readManifest } from './pack.mjs'
import { c, fail, ok, printLog, say, warn } from './ui.mjs'

const RUNNER = fileURLToPath(new URL('./local/runner.mjs', import.meta.url))

function debounce(fn, ms) {
  let t
  return (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

export async function dev(root, opts) {
  let manifest = readManifest(root)
  const target = resolveTarget(root, opts, manifest.id)
  const client = new DevClient(target)
  const port = Number(opts.port || 5174)
  const proxy = opts.proxy !== false
  const localBackend = Boolean(opts['local-backend'] || opts.local || opts.inspect)

  const info = await client.info()
  ok(`主控 ${target.master}(${info.master_version}),插件 ${c.bold(manifest.id)}${info.installed ? ` 已安装 v${info.version}` : ' 还没安装'}`)
  if (info.expires_at) say(c.dim(`开发令牌 ${new Date(info.expires_at * 1000).toLocaleString()} 过期`))

  // ---------- 推送 ----------
  let pushing = Promise.resolve()
  // build = 推送前先构建一次前端(只在启动时;之后前端由增量构建维护,别去删它的产物)
  const push = (why, { build = false } = {}) => {
    pushing = pushing.then(async () => {
      try {
        manifest = readManifest(root)
        if (build && findSourceEntry(root)) await buildFrontend(root, manifest, { dev: true })
        const p = pack(root, manifest)
        const res = await client.push(p.zip)
        if (res.requires_consent) {
          warn(`已推送 v${res.version}(${why}),要到面板「系统设置 → 插件」确认权限并启用`)
          if (res.has_frontend !== false && !res.signed && !res.trusted) warn('未签名插件还要点「信任」,前端才会加载')
        } else if (!res.success) {
          fail(`已推送 v${res.version},但加载失败:\n${res.error}`)
        } else {
          ok(`已推送 v${res.version}(${why})${res.trusted || res.signed ? '' : c.yellow(' · 前端要在面板点「信任」才会加载')}`)
        }
        return res
      } catch (e) {
        fail(`推送失败:${e.message}`)
      }
    })
    return pushing
  }
  if (opts.push !== false) await push('启动', { build: true })

  // ---------- 本机开发服务器 ----------
  const server = await startDevServer({ root, pluginId: manifest.id, port, master: target.master, proxy, log: ok })
  if (proxy) {
    say(`打开 ${c.bold(`http://localhost:${port}`)} —— 反代的主控面板,插件前端来自本机(第一次要在这个地址登录)`)
  }
  say(c.dim(`或在原面板「开发者模式」里打开「这台浏览器从本机加载前端」,地址 ${server.assetBase}`))

  // ---------- 前端增量构建 ----------
  let disposeWatch = null
  if (findSourceEntry(root)) {
    let first = true
    disposeWatch = await watchFrontend(root, manifest, (r) => {
      if (r.errors.length) {
        fail(`前端构建出错:\n${formatMessages(r.errors)}`)
        return
      }
      if (r.warnings.length) warn(formatMessages(r.warnings))
      if (first) {
        first = false
        ok('前端已构建,监听 src/ 变化')
        return
      }
      ok('前端已重新构建,浏览器里热更新')
      server.broadcast('reload')
    })
  }

  // ---------- 本机运行时 ----------
  let runner = null
  let runnerWanted = localBackend
  let restartTimer = null
  let backoff = 1000
  function startRunner() {
    if (!runnerWanted || runner) return
    const entry = manifest.backend?.entry
    if (!entry) {
      warn('plugin.json 没有 backend,不用本机运行时')
      runnerWanted = false
      return
    }
    const execArgv = []
    if (opts.inspect) execArgv.push(opts.inspect === true ? '--inspect=9229' : `--inspect=${opts.inspect}`)
    const child = fork(RUNNER, [], {
      execArgv,
      env: {
        ...process.env,
        MMWX_RUNNER: JSON.stringify({
          master: target.master,
          token: target.token,
          pluginId: manifest.id,
          entry: join(root, entry),
          entryRel: entry,
          version: manifest.version,
        }),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    runner = child
    child.on('message', (m) => {
      switch (m.type) {
        case 'ready': {
          backoff = 1000
          const r = m.registration
          ok(`后端已切到本机运行(路由 ${r.routes.length}、事件 ${r.events.length}、定时 ${r.crons.length}、过滤器 ${r.filters})`)
          if (opts.inspect) {
            const port = opts.inspect === true ? '9229' : String(opts.inspect).split(':').pop()
            say(`调试:Chrome 打开 ${c.bold('chrome://inspect')} → Open dedicated DevTools for Node,或 VS Code 附加到 ${port}`)
          }
          break
        }
        case 'log':
          printLog({ level: m.level, message: m.message }, { local: true })
          break
        case 'invoke':
          if (opts.verbose) say(c.dim(`本机处理 ${m.kind} #${m.idx}`))
          break
        case 'fatal':
          fail(m.message)
          break
        case 'closed':
          warn(`隧道断开(${m.code}${m.reason ? ' ' + m.reason : ''})`)
          break
      }
    })
    child.on('exit', (code) => {
      runner = null
      if (!runnerWanted || child.restarting) return
      if (code === 5) {
        // 主控拒绝(没启用 / 权限不够):等改了文件再试
        warn('本机运行时没起来,改好后保存文件会重试')
        return
      }
      warn(`本机运行时退出(${code}),${backoff / 1000} 秒后重连`)
      clearTimeout(restartTimer)
      restartTimer = setTimeout(startRunner, backoff)
      backoff = Math.min(backoff * 2, 15000)
    })
  }
  function restartRunner() {
    if (!runnerWanted) return
    backoff = 1000
    if (!runner) {
      startRunner()
      return
    }
    const old = runner
    old.restarting = true
    old.once('exit', () => setTimeout(startRunner, 100))
    old.send({ type: 'shutdown' })
  }
  startRunner()

  // ---------- 实时日志 ----------
  let stopLogs = null
  const connectLogs = (backlog) => {
    stopLogs = client.streamLogs({
      backlog,
      onLog: (l) => {
        // 本机运行时打的日志已经在本地打过了
        if (l.source === 'local') return
        printLog(l)
      },
      onEnd: () => {
        fail('开发会话已结束或过期(面板里结束了开发 / 令牌到期),退出')
        shutdown(1)
      },
      onError: (e) => {
        warn(`实时日志断开(${e.message}),5 秒后重连`)
        setTimeout(() => connectLogs(0), 5000)
      },
    })
  }
  connectLogs(Number(opts.backlog ?? 20))

  // ---------- 监听文件 ----------
  const backendEntry = () => manifest.backend?.entry
  const onBackend = debounce(() => {
    if (runnerWanted) {
      say('server.js 变了,重启本机运行时')
      restartRunner()
    } else {
      push('server.js 变了')
    }
  }, 200)
  const onManifest = debounce(async () => {
    const res = await push('plugin.json 变了')
    if (res?.success) server.broadcast('manifest')
    if (runnerWanted) restartRunner()
  }, 200)
  const onLocales = debounce(() => {
    ok('文案变了,浏览器里热更新')
    server.broadcast('reload')
  }, 200)
  const watcher = watch(root, { recursive: true }, (_ev, file) => {
    if (!file) return
    const rel = relative(root, join(root, file)).split(sep).join('/')
    if (rel.startsWith('node_modules/') || rel.startsWith('dist/') || rel.startsWith('.')) return
    if (rel === 'plugin.json') onManifest()
    else if (rel === backendEntry()) onBackend()
    else if (rel.startsWith('locales/')) onLocales()
  })

  // ---------- 退出 ----------
  let exiting = false
  function shutdown(code = 0) {
    if (exiting) return
    exiting = true
    runnerWanted = false
    clearTimeout(restartTimer)
    watcher.close()
    stopLogs?.()
    disposeWatch?.()
    server.close()
    if (runner) {
      runner.send({ type: 'shutdown' })
      runner.once('exit', () => process.exit(code))
      setTimeout(() => process.exit(code), 1500).unref()
    } else {
      setTimeout(() => process.exit(code), 50)
    }
  }
  process.on('SIGINT', () => {
    console.log()
    say('退出(后端会换回已推送的版本;要把本机前端也更新到主控,运行 mmwx-plugin deploy)')
    shutdown(0)
  })
  process.on('SIGTERM', () => shutdown(0))
  say(c.dim('Ctrl+C 退出'))
}
