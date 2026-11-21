// 跟主控的插件开发接口说话(/api/plugin-dev/<id>/…,开发令牌鉴权)。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEV_CONFIG = '.mmwx-dev.json'

/** 主控地址与开发令牌:命令行参数 > 环境变量 MMWX_MASTER / MMWX_DEV_TOKEN > 插件目录里的 .mmwx-dev.json。 */
export function resolveTarget(root, opts, pluginId) {
  let file = {}
  const p = join(root, DEV_CONFIG)
  if (existsSync(p)) {
    try {
      file = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      throw new Error(`${DEV_CONFIG} 不是合法的 JSON`)
    }
  }
  const master = String(opts.master || process.env.MMWX_MASTER || file.master || '').replace(/\/+$/, '')
  const token = String(opts.token || process.env.MMWX_DEV_TOKEN || file.token || '')
  if (!master) throw new Error('缺主控地址:--master https://你的面板(或环境变量 MMWX_MASTER)')
  if (!/^https?:\/\//.test(master)) throw new Error(`主控地址要以 http:// 或 https:// 开头:${master}`)
  if (!token) throw new Error('缺开发令牌:到面板「系统设置 → 插件 → 开发者模式」生成,用 --token 传入(或环境变量 MMWX_DEV_TOKEN)')
  const m = /^mmwxdev_([a-z][a-z0-9-]*)_/.exec(token)
  if (!m) throw new Error('开发令牌格式不对(应以 mmwxdev_ 开头)')
  if (pluginId && m[1] !== pluginId) {
    throw new Error(`这个开发令牌是给插件 ${m[1]} 的,当前目录的插件是 ${pluginId}`)
  }
  if (opts.save) {
    writeFileSync(p, JSON.stringify({ master, token }, null, 2) + '\n', { mode: 0o600 })
  }
  return { master, token, pluginId: m[1] }
}

export class DevClient {
  constructor({ master, token, pluginId }) {
    this.master = master
    this.token = token
    this.id = pluginId
    this.base = `${master}/api/plugin-dev/${encodeURIComponent(pluginId)}`
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, 'User-Agent': 'mmwx-plugin', ...extra }
  }

  async json(path, init = {}) {
    let res
    try {
      res = await fetch(this.base + path, { ...init, headers: this.headers(init.headers) })
    } catch (e) {
      throw new Error(`连不上主控 ${this.master}: ${e.cause?.message || e.message}`)
    }
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { error: text.slice(0, 300) }
    }
    if (res.status === 401) throw new Error(`开发令牌无效或已过期(${body.message || body.error || 401}),到面板重新生成`)
    if (res.status === 404 && body.error === 'not_found') {
      throw new Error('主控没有插件开发接口:主控版本太旧,或插件系统被 MMWX_DISABLE_PLUGINS 关闭了')
    }
    if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`)
    return body
  }

  info() {
    return this.json('/info')
  }

  push(zip) {
    return this.json('/push', { method: 'POST', body: zip, headers: { 'Content-Type': 'application/zip' } })
  }

  /** 实时日志(SSE)。onLog(log);流结束(会话结束)时 onEnd()。返回 abort。 */
  streamLogs({ backlog = 0, onLog, onEnd, onError }) {
    const ac = new AbortController()
    ;(async () => {
      let res
      try {
        res = await fetch(`${this.base}/logs${backlog ? `?backlog=${backlog}` : ''}`, {
          headers: this.headers({ Accept: 'text/event-stream' }),
          signal: ac.signal,
        })
      } catch (e) {
        if (!ac.signal.aborted) onError?.(e)
        return
      }
      if (!res.ok) {
        onError?.(new Error(`实时日志 HTTP ${res.status}`))
        return
      }
      const dec = new TextDecoder()
      let buf = ''
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i)
            buf = buf.slice(i + 2)
            let event = 'message'
            let data = ''
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            if (event === 'end') {
              onEnd?.()
              return
            }
            if (data) {
              try {
                onLog(JSON.parse(data))
              } catch {
                // 忽略坏行
              }
            }
          }
        }
        if (!ac.signal.aborted) onError?.(new Error('实时日志连接断开'))
      } catch (e) {
        if (!ac.signal.aborted) onError?.(e)
      }
    })()
    return () => ac.abort()
  }

  tunnelURL() {
    return this.base.replace(/^http/, 'ws') + '/tunnel'
  }
}
