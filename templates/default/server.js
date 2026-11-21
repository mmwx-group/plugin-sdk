/// <reference types="@mmwx/plugin-sdk/server" />
// 插件后端:跑在主控里(goja),或 `mmwx-plugin dev --local-backend` 时跑在你电脑上。
// 宿主 API 都是同步的;要存东西用 mmwx.kv(全局变量不保证跨请求保留)。

mmwx.route('GET', '/hello', { role: 'admin' }, (req) => {
  const { greeting } = mmwx.settings.get()
  const hits = (mmwx.kv.get('hits') || 0) + 1
  mmwx.kv.set('hits', hits)
  console.log('hello 被调用', { user: req.user && req.user.username, hits })
  return { message: `${greeting || '你好'}, ${req.user ? req.user.username : '访客'}`, hits }
})
