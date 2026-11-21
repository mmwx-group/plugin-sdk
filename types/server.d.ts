// 插件后端脚本(server.js)里的全局 mmwx —— 在 server.js 顶上加
//   /// <reference types="@mmwx/plugin-sdk/server" />
// 宿主 API 全部同步返回;处理函数可以 async,但主控里 Promise 必须在同一轮里完成(不能等定时器)。

declare namespace Mmwx {
  interface RouteRequest {
    method: string
    /** 插件内路径,如 /items/42 */
    path: string
    /** 路径参数(/items/:id → { id }) */
    params: Record<string, string>
    query: Record<string, string | string[]>
    /** 小写请求头(不含凭据) */
    headers: Record<string, string>
    /** JSON / 表单解析后的值,解析不了给原字符串,空体为 null */
    body: any
    /** 登录用户;公开路由恒为 null */
    user: { username: string; role: string } | null
    /** 客户端 IP(放在反代后面要配 MMWX_TRUSTED_PROXIES) */
    ip: string
  }
  /** 返回对象 = 200 JSON;字符串 = 200 text/plain;{status, headers?, body?} = 自定义;null = 204 */
  type RouteResult = unknown
  type Handler<A extends unknown[], R = unknown> = (...args: A) => R | Promise<R>

  interface Event {
    /** 事件类型(通知事件的 type,如 login、user_registered、over_limit…) */
    type: string
    time: number
    data: { title?: string; message?: string; [k: string]: unknown }
  }
  interface FetchResponse {
    status: number
    ok: boolean
    headers: Record<string, string>
    body: string
    json(): any
  }
  interface SubscriptionContext {
    username: string
    client: string
    file: string
  }
}

declare const mmwx: {
  readonly id: string
  readonly version: string
  /** 注册路由:/api/plugins/<id>/<path>。role 默认 admin;需要对应的 routes:* 权限。只能在加载时调用。 */
  route(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, handler: Mmwx.Handler<[Mmwx.RouteRequest], Mmwx.RouteResult>): void
  route(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: { role?: 'admin' | 'user' | 'public' },
    handler: Mmwx.Handler<[Mmwx.RouteRequest], Mmwx.RouteResult>
  ): void
  /** 订阅事件(需要 events:<type> 或 events:*)。 */
  on(type: string, handler: Mmwx.Handler<[Mmwx.Event], void>): void
  /** 改 Clash 订阅(需要 filter:subscription);返回新配置,返回 null 表示不改。限时 300 毫秒。 */
  filter(kind: 'subscription', fn: (config: Record<string, any>, ctx: Mmwx.SubscriptionContext) => Record<string, any> | null | void): void
  /** 定时任务(需要 cron):5 段 cron「分 时 日 月 周」,按主控时区。 */
  cron(spec: string, handler: Mmwx.Handler<[], void>): void
  /** 插件自己的键值存储:单值 ≤ 256 KB,总量 ≤ 5 MB。 */
  kv: {
    get<T = any>(key: string): T | null
    set(key: string, value: unknown): void
    delete(key: string): void
    list(prefix?: string): Array<{ key: string; value: any }>
  }
  settings: {
    get(): Record<string, any>
    onChange(fn: (values: Record<string, any>) => void): void
  }
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
  /** 访问外部网址(域名要在 http:fetch:<domain> 里声明;拒内网)。 */
  http: {
    fetch(
      url: string,
      opts?: { method?: string; headers?: Record<string, string>; body?: unknown; timeout?: number }
    ): Mmwx.FetchResponse
  }
  /** 经管理员配置的通知渠道发消息(需要 notify:send)。 */
  notify: { send(msg: { title?: string; text: string }): void }
  /** 以下返回值与开放 API 同结构(如 packages.list() → { packages: [...] }) */
  users: { get(username: string): any; create(body: Record<string, unknown>): any; setPassword(username: string, password: string): any }
  packages: { list(): any }
  assignments: {
    list(username: string): any
    create(username: string, body: Record<string, unknown>): any
    update(username: string, id: number, body: Record<string, unknown>): any
    delete(username: string, id: number): any
  }
  servers: { list(): Array<{ id: number; name: string; ip: string; status: string; [k: string]: unknown }> }
  nodes: { list(): Array<{ id: number; name: string; protocol: string; [k: string]: unknown }> }
  uid(): string
  now(): number
}

declare const console: {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}
