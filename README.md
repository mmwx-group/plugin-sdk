# @mmwx/plugin-sdk

妙妙屋X 插件开发工具:插件前端 / 后端的类型定义,加上 `mmwx-plugin` 命令行。

## 快速开始

```bash
npx @mmwx/plugin-sdk create my-plugin
cd my-plugin && npm install
```

到面板「系统设置 → 插件 → 开发者模式」,给 `my-plugin` 生成开发令牌(插件还没装也可以),然后:

```bash
npx mmwx-plugin dev --master https://你的面板 --token <开发令牌> --save
```

- 第一次推送会安装插件,到面板里确认权限、启用(未签名插件再点「信任」)。
- 打开 **http://localhost:5174**:这是反代过来的你的面板,插件前端来自本机,改 `src/` 自动热更新。
- 改 `server.js` 自动推送到主控热重载;改 `plugin.json` 自动推送并让面板重取插件清单。
- 终端里是实时日志:插件自己打的日志、每个请求(路径 / 状态码 / 耗时)、事件、定时任务、推送结果、带调用栈的错误。

不想用反代?在原面板「开发者模式」里打开「这台浏览器从本机加载前端」,直接在面板里调(只认 localhost 地址,只对这台浏览器生效,右下角会一直提示)。

## 后端在本机跑、下断点

```bash
npx mmwx-plugin dev --inspect          # 隐含 --local-backend,调试端口 9229
```

主控把这个插件的路由 / 事件 / 定时任务 / 订阅过滤器调用经隧道转到你电脑上执行,`mmwx.kv`、`mmwx.http.fetch`
等宿主 API 由主控代调(权限与在主控里跑完全一样)。Chrome 打开 `chrome://inspect` → *Open dedicated DevTools for Node*
(或 VS Code 附加到 9229),就能在 `server.js` 里下断点、单步、看变量。停在断点上时主控那边的请求会等着(最长 2 分钟)。

本机运行时与主控保持同样的约定(宿主 API 同步、没有 setTimeout / require),唯一的差别是 async 处理函数在本机可以真的
await 网络,而主控里 Promise 必须同步完成 —— 上线前不带 `--local-backend` 再跑一遍。退出 `dev`(或在面板结束开发)后,
主控换回已推送的脚本。

## 开发者模式下主控的变化

只对开发中的插件、只在开发会话有效期内(24 小时,可在面板随时结束):

- 出错不计入熔断(不会被自动停用),错误响应与日志带完整调用栈
- `http.fetch` 与公开路由的限流放宽 10 倍
- 推送新包保持「信任」(未签名插件每次推送摘要都变)

开发令牌只对一个插件有效,只能推送这个插件、看它的日志、建它的隧道,够不到任何管理接口。别提交进仓库(模板的
`.gitignore` 已经忽略 `.mmwx-dev.json`)。

## 命令

| 命令 | 作用 |
|---|---|
| `mmwx-plugin create <id> [目录]` | 新建插件项目 |
| `mmwx-plugin dev` | 本机开发(见上) |
| `mmwx-plugin build` | 生产构建前端到 `dist/` |
| `mmwx-plugin pack [--key 私钥] [-o out.zip]` | 构建并打包,可签名 |
| `mmwx-plugin deploy` | 构建、打包并推送到主控 |
| `mmwx-plugin logs` | 只看实时日志 |
| `mmwx-plugin keygen -o <私钥文件>` | 生成签名密钥对 |

主控地址与令牌:`--master` / `--token`,或环境变量 `MMWX_MASTER` / `MMWX_DEV_TOKEN`,或插件目录里的 `.mmwx-dev.json`
(`dev --save` 会写)。

## 类型

```js
// 前端
import { definePlugin, ui, useApi } from '@mmwx/plugin-sdk'
// 后端 server.js 顶上
/// <reference types="@mmwx/plugin-sdk/server" />
```

打包时 `react`、`react/jsx-runtime`、`@mmwx/plugin-sdk` 会指到面板注入的那一份,插件包里不带 React。
