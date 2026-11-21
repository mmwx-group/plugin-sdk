// 本机开发服务器:
//   /__mmwx/<id>/…          插件前端资源(dist/、locales/、assets/),允许跨源(面板直接从这里加载时要)
//   /__mmwx/<id>/__events   热更新通知(SSE:reload = 前端变了,manifest = plugin.json 变了)
//   其余一切                 反代到主控(含 WebSocket),HTML 里注入一小段脚本:让这个页面的插件前端从本机加载
//
// 打开 http://localhost:<port> 看到的就是你的主控面板,登录、加密信道都照常工作(加密信道按页面来源绑定,
// 不看主机名,所以 localhost 也能握手)。
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { extname, join, normalize, sep } from 'node:path'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
// 本机只发这些目录里的文件(不发 server.js、.mmwx-dev.json 之类)
const SERVE_DIRS = ['dist', 'locales', 'assets']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  // Chrome 的「私有网络访问」:https 公网页面请求 localhost 时要这个头
  'Access-Control-Allow-Private-Network': 'true',
}

export function startDevServer({ root, pluginId, port, master, proxy, log }) {
  const prefix = `/__mmwx/${pluginId}/`
  const clients = new Set()
  const masterURL = master ? new URL(master) : null

  function broadcast(event) {
    for (const res of clients) res.write(`event: ${event}\ndata: {}\n\n`)
  }

  function serveAsset(req, res, rel) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }
    if (rel === '__events') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': ready\n\n')
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }
    const clean = normalize(decodeURIComponent(rel.split('?')[0])).replace(/^([/\\])+/, '')
    const top = clean.split(sep)[0]
    const file = join(root, clean)
    if (!SERVE_DIRS.includes(top) || clean.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`not found: ${clean}`)
      return
    }
    res.writeHead(200, { ...CORS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  }

  const injectScript =
    `<script>try{var k='mmwx-plugin-dev-frontend',o=JSON.parse(localStorage.getItem(k)||'{}');` +
    `o[${JSON.stringify(pluginId)}]=${JSON.stringify(prefix)};localStorage.setItem(k,JSON.stringify(o))}catch(e){}</script>`

  function proxyHeaders(req) {
    const h = { ...req.headers }
    delete h['accept-encoding'] // 要改 HTML,统一要明文(本机开发,不在乎这点流量)
    h.host = masterURL.host
    if (h.origin) h.origin = masterURL.origin
    if (h.referer) h.referer = h.referer.replace(/^https?:\/\/[^/]+/, masterURL.origin)
    return h
  }

  function rewriteSetCookie(v) {
    const list = Array.isArray(v) ? v : [v]
    return list.map((c) => {
      let s = c.replace(/;\s*domain=[^;]*/gi, '')
      if (masterURL.protocol === 'https:') s = s.replace(/;\s*secure/gi, '').replace(/;\s*samesite=none/gi, '; SameSite=Lax')
      return s
    })
  }

  function proxyHTTP(req, res, localOrigin) {
    const mod = masterURL.protocol === 'https:' ? https : http
    const up = mod.request(
      {
        protocol: masterURL.protocol,
        hostname: masterURL.hostname,
        port: masterURL.port || (masterURL.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: req.url,
        headers: proxyHeaders(req),
      },
      (ur) => {
        const headers = { ...ur.headers }
        if (headers['set-cookie']) headers['set-cookie'] = rewriteSetCookie(headers['set-cookie'])
        if (headers.location) headers.location = headers.location.replace(masterURL.origin, localOrigin)
        delete headers['strict-transport-security']
        const isHTML = String(headers['content-type'] || '').includes('text/html')
        if (!isHTML) {
          res.writeHead(ur.statusCode, headers)
          ur.pipe(res)
          return
        }
        const chunks = []
        ur.on('data', (c) => chunks.push(c))
        ur.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8')
          html = html.includes('<head>') ? html.replace('<head>', '<head>' + injectScript) : injectScript + html
          const body = Buffer.from(html)
          delete headers['content-length']
          delete headers['content-security-policy']
          headers['content-length'] = String(body.length)
          headers['cache-control'] = 'no-store'
          res.writeHead(ur.statusCode, headers)
          res.end(body)
        })
      }
    )
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`反代到主控失败: ${e.message}`)
    })
    req.pipe(up)
  }

  function proxyUpgrade(req, socket, head) {
    const isTLS = masterURL.protocol === 'https:'
    const port = Number(masterURL.port || (isTLS ? 443 : 80))
    const up = isTLS
      ? tls.connect({ host: masterURL.hostname, port, servername: masterURL.hostname })
      : net.connect({ host: masterURL.hostname, port })
    up.on(isTLS ? 'secureConnect' : 'connect', () => {
      const h = proxyHeaders(req)
      h.connection = 'Upgrade'
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
      for (const [k, v] of Object.entries(h)) {
        for (const vv of Array.isArray(v) ? v : [v]) raw += `${k}: ${vv}\r\n`
      }
      up.write(raw + '\r\n')
      if (head?.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    const kill = () => {
      up.destroy()
      socket.destroy()
    }
    up.on('error', kill)
    socket.on('error', kill)
  }

  const server = http.createServer((req, res) => {
    const localOrigin = `http://${req.headers.host || `localhost:${port}`}`
    if (req.url.startsWith(prefix)) {
      serveAsset(req, res, req.url.slice(prefix.length))
      return
    }
    if (proxy && masterURL) {
      proxyHTTP(req, res, localOrigin)
      return
    }
    res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('mmwx-plugin dev:没开反代(--no-proxy),这里只发插件资源 ' + prefix)
  })
  server.on('upgrade', (req, socket, head) => {
    if (proxy && masterURL && !req.url.startsWith(prefix)) proxyUpgrade(req, socket, head)
    else socket.destroy()
  })

  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') reject(new Error(`端口 ${port} 被占用,用 --port 换一个`))
      else reject(e)
    })
    server.listen(port, '127.0.0.1', () => {
      log?.(`本机开发服务器 http://localhost:${port}`)
      resolve({
        broadcast,
        close: () => {
          for (const r of clients) r.end()
          server.close()
        },
        assetBase: `http://localhost:${port}${prefix}`,
      })
    })
  })
}
