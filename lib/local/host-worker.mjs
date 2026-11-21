// 本机运行时的辅助线程:替主线程向主控代调宿主 API。
// 主线程(跑插件脚本)要的是**同步**返回值(与主控里 goja 的语义一致),它发消息后 Atomics.wait 睡着,
// 这里做完 HTTP 请求把结果放回端口、Atomics.notify 叫醒它。
import { workerData } from 'node:worker_threads'

const { port, flag, master, token, pluginId } = workerData
const url = `${master}/api/plugin-dev/${encodeURIComponent(pluginId)}/host`

async function call(fn, args) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'mmwx-plugin' },
      body: JSON.stringify({ fn, args }),
    })
    if (!res.ok) return { ok: false, error: `宿主 API ${fn}: HTTP ${res.status}` }
    return await res.json()
  } catch (e) {
    return { ok: false, error: `宿主 API ${fn}: 连不上主控(${e.cause?.message || e.message})` }
  }
}

port.on('message', async (msg) => {
  const out = await call(msg.fn, msg.args)
  if (msg.noReply) return
  port.postMessage({ seq: msg.seq, ...out })
  Atomics.store(flag, 0, msg.seq)
  Atomics.notify(flag, 0)
})
