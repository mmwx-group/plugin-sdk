// 本机运行时:在开发者电脑上跑插件后端脚本,经隧道接主控转来的路由 / 事件 / 定时任务 / 过滤器调用。
//
// 由 `mmwx-plugin dev --local-backend` 用 child_process.fork 起;加 --inspect 时这个进程可以用
// Chrome(chrome://inspect)或 VS Code 附加调试,在 server.js 里直接下断点。
//
// 与主控里的 goja 运行时保持同样的约定:
//   - mmwx.route / on / filter / cron / settings.onChange 只能在脚本加载时调用
//   - 宿主 API(kv / http.fetch / users …)同步返回值,权限照主控授予的来(由主控代调)
//   - 没有 setTimeout / require / process 等 Node 能力(主控里也没有),写出来的代码两边都能跑
// 差别:这里 async 处理函数可以真的 await(主控里 Promise 必须同步完成),上线前请在主控里再跑一遍。
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import vm from 'node:vm'
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads'

const cfg = JSON.parse(process.env.MMWX_RUNNER || '{}')
const { master, token, pluginId, entry, version } = cfg
const send = (m) => process.send?.(m)

// ---------- 同步宿主调用 ----------
const flagBuf = new SharedArrayBuffer(4)
const flag = new Int32Array(flagBuf)
const { port1, port2 } = new MessageChannel()
const worker = new Worker(new URL('./host-worker.mjs', import.meta.url), {
  workerData: { port: port2, flag, master, token, pluginId },
  transferList: [port2],
})
worker.unref()
let seq = 0

function hostSync(fn, args) {
  // 主线程里的调用是一个接一个的(同步阻塞),所以一面旗子够用:清零 → 发出 → 等辅助线程置位并叫醒
  const my = ++seq
  Atomics.store(flag, 0, 0)
  port1.postMessage({ seq: my, fn, args })
  const deadline = Date.now() + 45_000
  for (;;) {
    let m
    while ((m = receiveMessageOnPort(port1))) {
      const r = m.message
      if (r.seq !== my) continue
      if (!r.ok) throw new Error(r.error || `宿主 API ${fn} 出错`)
      return r.value
    }
    const left = deadline - Date.now()
    if (left <= 0) throw new Error(`宿主 API ${fn} 超时`)
    Atomics.wait(flag, 0, 0, Math.min(left, 20))
  }
}

function hostAsync(fn, args) {
  port1.postMessage({ seq: 0, fn, args, noReply: true })
}

// ---------- mmwx.* ----------
const reg = { routes: [], events: [], filters: 0, crons: [], changes: 0 }
const handlers = { route: [], event: [], filter: [], cron: [], change: [] }
let loading = true
const onlyAtLoad = (name) => {
  if (!loading) throw new Error(`${name} 只能在脚本加载时调用`)
}
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const fmt = (args) =>
  args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || String(a) : inspect(a, { depth: 4, colors: false, breakLength: Infinity })))

function logFn(level) {
  return (...args) => {
    const text = fmt(args).join(' ')
    send({ type: 'log', level, message: text })
    // 也落到主控的插件日志(面板「日志」页看得到);不等结果
    hostAsync(`log.${level}`, args.map((a) => (typeof a === 'string' ? a : (() => { try { return plain(a) } catch { return String(a) } })())))
  }
}
const log = { info: logFn('info'), warn: logFn('warn'), error: logFn('error') }
const consoleShim = { log: log.info, info: log.info, warn: log.warn, error: log.error, debug: log.info }

const call = (fn) => (...args) => hostSync(fn, plain(args) ?? [])
const mmwx = {
  id: pluginId,
  version,
  route(method, path, opts, fn) {
    onlyAtLoad('mmwx.route')
    let role = 'admin'
    if (typeof opts === 'function') fn = opts
    else if (opts && opts.role) role = opts.role
    if (typeof fn !== 'function') throw new Error('mmwx.route: 最后一个参数要是函数')
    reg.routes.push({ method: String(method).toUpperCase(), path: String(path), role })
    handlers.route.push(fn)
  },
  on(type, fn) {
    onlyAtLoad('mmwx.on')
    if (typeof fn !== 'function') throw new Error('mmwx.on: 第 2 个参数要是函数')
    reg.events.push(String(type))
    handlers.event.push(fn)
  },
  filter(kind, fn) {
    onlyAtLoad('mmwx.filter')
    if (kind !== 'subscription') throw new Error('mmwx.filter: 只支持 subscription')
    reg.filters++
    handlers.filter.push(fn)
  },
  cron(spec, fn) {
    onlyAtLoad('mmwx.cron')
    reg.crons.push(String(spec))
    handlers.cron.push(fn)
  },
  kv: { get: call('kv.get'), set: call('kv.set'), delete: call('kv.delete'), list: call('kv.list') },
  settings: {
    get: call('settings.get'),
    onChange(fn) {
      onlyAtLoad('mmwx.settings.onChange')
      reg.changes++
      handlers.change.push(fn)
    },
  },
  log,
  http: {
    fetch(url, opts) {
      const r = hostSync('http.fetch', plain([url, opts ?? {}]))
      if (r && typeof r === 'object') {
        r.json = () => JSON.parse(r.body)
      }
      return r
    },
  },
  notify: { send: call('notify.send') },
  users: { get: call('users.get'), create: call('users.create'), setPassword: call('users.setPassword') },
  packages: { list: call('packages.list') },
  assignments: {
    list: call('assignments.list'),
    create: call('assignments.create'),
    update: call('assignments.update'),
    delete: call('assignments.delete'),
  },
  servers: { list: call('servers.list') },
  nodes: { list: call('nodes.list') },
  uid: call('uid'),
  now: () => Date.now(),
}

// ---------- 加载脚本 ----------
// 调用栈只留插件自己文件的那几帧,路径改成相对插件目录(不把本机的目录结构带到主控日志里)
const rootDir = entry.slice(0, entry.length - (cfg.entryRel || '').length)
function cleanStack(stack) {
  const lines = String(stack).split('\n')
  const head = lines[0]
  const frames = lines.slice(1).filter((l) => l.includes(rootDir) && !l.includes('/node_modules/'))
  return [head, ...frames].join('\n').split(rootDir).join('')
}
function errInfo(e) {
  if (e instanceof Error || (e && typeof e === 'object' && 'stack' in e)) {
    const stack = cleanStack(e.stack || e)
    const at = /\(?([^\s()]+:\d+:\d+)\)?/.exec(stack.split('\n')[1] || '')
    return { error: `${e.name || 'Error'}: ${e.message}${at ? ` at ${at[1]}` : ''}`, stack }
  }
  return { error: String(e), stack: String(e) }
}

try {
  const src = readFileSync(entry, 'utf8')
  const ctx = vm.createContext({ mmwx, console: consoleShim })
  // 主控里加载限时 2 秒;带调试器时不限(停在断点上会超时)
  const debugging = process.execArgv.some((a) => a.startsWith('--inspect'))
  new vm.Script(src, { filename: entry }).runInContext(ctx, debugging ? {} : { timeout: 2000 })
} catch (e) {
  send({ type: 'fatal', message: `加载脚本失败: ${errInfo(e).stack}` })
  process.exit(3)
}
loading = false

// ---------- 隧道 ----------
const wsURL = `${master.replace(/^http/, 'ws')}/api/plugin-dev/${encodeURIComponent(pluginId)}/tunnel`
let ws
try {
  ws = new WebSocket(wsURL)
} catch (e) {
  send({ type: 'fatal', message: `建隧道失败: ${e.message}` })
  process.exit(4)
}
let closing = false
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello', token, registration: reg }))
})
ws.addEventListener('message', async (ev) => {
  let msg
  try {
    msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
  } catch {
    return
  }
  if (msg.type === 'ready') {
    send({ type: 'ready', registration: reg, plugin: msg.plugin })
    return
  }
  if (msg.type === 'error') {
    closing = true
    send({ type: 'fatal', message: `主控拒绝隧道: ${msg.error}` })
    process.exit(5)
  }
  if (msg.type !== 'invoke') return
  const fn = handlers[msg.kind]?.[msg.idx]
  const reply = (r) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'result', id: msg.id, ...r }))
  if (!fn) {
    reply({ ok: false, error: `处理函数不存在(${msg.kind} #${msg.idx}),本机脚本和主控登记的不一致` })
    return
  }
  send({ type: 'invoke', kind: msg.kind, idx: msg.idx, args: msg.args })
  try {
    let v = fn(...(msg.args || []))
    if (v && typeof v.then === 'function') v = await v
    reply({ ok: true, value: plain(v) ?? null })
  } catch (e) {
    // 主控会带上「路由 GET /x:」之类的上下文记进插件日志,实时日志里就能看到,这里不重复打
    reply({ ok: false, ...errInfo(e) })
  }
})
ws.addEventListener('close', (ev) => {
  if (closing) return
  send({ type: 'closed', code: ev.code, reason: ev.reason })
  process.exit(6)
})
ws.addEventListener('error', () => {
  // close 会接着来
})

process.on('message', (m) => {
  if (m?.type === 'shutdown') {
    closing = true
    try {
      ws.close(1000, 'bye')
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 300).unref()
  }
})
process.on('disconnect', () => process.exit(0))
