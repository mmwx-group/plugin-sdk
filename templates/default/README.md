# {{name}}

妙妙屋X 插件。

```bash
npm install
# 面板「系统设置 → 插件 → 开发者模式」给 {{id}} 生成开发令牌,然后:
npx mmwx-plugin dev --master https://你的面板 --token <开发令牌> --save
# 打开 http://localhost:5174 —— 反代的面板,插件前端来自本机,改了自动热更新
```

- `npm run dev:local`:后端也跑在本机,Chrome 打开 `chrome://inspect` 可以在 server.js 下断点
- `npm run deploy`:生产构建并推送到主控
- `npm run pack`:打成插件包 zip(`-- --key 私钥文件` 签名)
