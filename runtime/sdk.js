// 运行时的 @mmwx/plugin-sdk:面板把 SDK 挂在 window.__MMWX_SDK__,插件打包时 import 指到这里。
// (mmwx-plugin build 会自动把 react / react/jsx-runtime / @mmwx/plugin-sdk 指到面板那一份,插件包里不带 React。)
const sdk = typeof window !== 'undefined' ? window.__MMWX_SDK__ : undefined
if (!sdk) throw new Error('window.__MMWX_SDK__ 不存在:插件前端只能在妙妙屋X 面板里运行')
export default sdk
export const {
  version, React, jsxRuntime, ui, definePlugin, useApi, useQuery, useMutation, useQueryClient,
  useT, useCurrentUser, useTheme, toast, confirm, navigate,
} = sdk
