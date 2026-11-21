// 打包插件前端:src/index.(tsx|jsx|ts|js) → frontend.entry(默认 dist/index.js),CSS 一并输出。
// react / react/jsx-runtime / @mmwx/plugin-sdk 指到面板注入的 window.__MMWX_SDK__,插件包里不带 React
// (自带一份的话 hooks 一用就报 Invalid hook call)。
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REACT_EXPORTS = [
  'Children', 'Component', 'Fragment', 'PureComponent', 'StrictMode', 'Suspense', 'cloneElement', 'createContext',
  'createElement', 'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo', 'startTransition', 'use',
  'useActionState', 'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect', 'useId',
  'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useOptimistic', 'useReducer', 'useRef',
  'useState', 'useSyncExternalStore', 'useTransition', 'version',
]
const SDK_EXPORTS = [
  'version', 'React', 'jsxRuntime', 'ui', 'definePlugin', 'useApi', 'useQuery', 'useMutation', 'useQueryClient',
  'useT', 'useCurrentUser', 'useTheme', 'toast', 'confirm', 'navigate',
]
const GET_SDK = `const __sdk = window.__MMWX_SDK__; if (!__sdk) throw new Error('window.__MMWX_SDK__ 不存在:插件前端只能在妙妙屋X 面板里运行');`

const SHIMS = {
  '@mmwx/plugin-sdk': `${GET_SDK}\nexport default __sdk;\nexport const { ${SDK_EXPORTS.join(', ')} } = __sdk;`,
  react: `${GET_SDK}\nconst R = __sdk.React;\nexport default R;\nexport const { ${REACT_EXPORTS.join(', ')} } = R;`,
  'react/jsx-runtime': `${GET_SDK}\nexport const { jsx, jsxs, Fragment } = __sdk.jsxRuntime;`,
  'react/jsx-dev-runtime': `${GET_SDK}\nexport const { Fragment } = __sdk.jsxRuntime;\nexport const jsxDEV = (t, p, k) => __sdk.jsxRuntime.jsx(t, p, k);`,
  'react-dom': `throw new Error('插件里不能用 react-dom:弹窗用 SDK 的 ui.Dialog / ui.Sheet')`,
}

const shimPlugin = {
  name: 'mmwx-sdk-shim',
  setup(build) {
    build.onResolve({ filter: /^(@mmwx\/plugin-sdk|react|react\/jsx-runtime|react\/jsx-dev-runtime|react-dom)$/ }, (a) => ({
      path: a.path,
      namespace: 'mmwx-shim',
    }))
    build.onLoad({ filter: /.*/, namespace: 'mmwx-shim' }, (a) => ({ contents: SHIMS[a.path], loader: 'js' }))
  },
}

export function findSourceEntry(root) {
  for (const n of ['src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js']) {
    if (existsSync(join(root, n))) return join(root, n)
  }
  return null
}

async function loadEsbuild() {
  try {
    return await import('esbuild')
  } catch {
    throw new Error('找不到 esbuild:在插件目录里 npm install -D @mmwx/plugin-sdk(会带上 esbuild)')
  }
}

function options(root, manifest, { dev, plugins = [] } = {}) {
  const src = findSourceEntry(root)
  if (!src) return null
  const entry = manifest.frontend?.entry || 'dist/index.js'
  const outfile = join(root, entry)
  return {
    entryPoints: [src],
    outfile,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    plugins: [shimPlugin, ...plugins],
    logLevel: 'silent',
    absWorkingDir: root,
  }
}

/** 一次性构建(生产:压缩、无 sourcemap)。没有 src/index.* 就跳过(纯后端插件)。 */
export async function buildFrontend(root, manifest, { dev = false } = {}) {
  const opts = options(root, manifest, { dev })
  if (!opts) return { skipped: true }
  if (!manifest.frontend) {
    throw new Error('有 src/index.* 但 plugin.json 没有 frontend 段:加上 "frontend": {"entry": "dist/index.js", "style": "dist/index.css"}')
  }
  const esbuild = await loadEsbuild()
  rmSync(dirname(opts.outfile), { recursive: true, force: true })
  const res = await esbuild.build(opts)
  return { skipped: false, warnings: res.warnings, outfile: opts.outfile, cssExists: existsSync(opts.outfile.replace(/\.js$/, '.css')) }
}

/** 开发:增量构建 + 监听,每次构建完回调 onEnd({errors, warnings})。返回 dispose。 */
export async function watchFrontend(root, manifest, onEnd) {
  const end = { name: 'mmwx-on-end', setup: (b) => b.onEnd((r) => onEnd(r)) }
  const opts = options(root, manifest, { dev: true, plugins: [end] })
  if (!opts) return null
  const esbuild = await loadEsbuild()
  const ctx = await esbuild.context(opts)
  await ctx.watch()
  return () => ctx.dispose()
}

export function formatMessages(list) {
  return list
    .map((m) => {
      const loc = m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ` : ''
      return `${loc}${m.text}`
    })
    .join('\n')
}

