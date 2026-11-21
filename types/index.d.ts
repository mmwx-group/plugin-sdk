// @mmwx/plugin-sdk —— 插件前端 SDK 的类型(运行时由面板提供:window.__MMWX_SDK__,版本 1.0.0)。
// 手写的契约声明,面板内部重构不影响这里;新增能力会提高 SDK 版本。
import type * as React from 'react'

export declare const version: string

// ---------- 插件定义 ----------

export interface PluginDefinition {
  /** 插件第一次用到时调用一次(页面打开 / 插槽渲染前)。 */
  activate(ctx: PluginContext): void | Promise<void>
}
export declare function definePlugin(def: PluginDefinition): PluginDefinition

export interface PluginContext {
  id: string
  version: string
  api: PluginApiClient
  pages: {
    /** pageId 要在 plugin.json frontend.pages 里声明过 */
    register(pageId: string, component: React.ComponentType): void
  }
  slots: {
    /** slot 要在 plugin.json frontend.slots 里声明过(settings.section 除外) */
    add<S extends PluginSlotName>(slot: S, contribution: SlotContributionMap[S]): void
  }
  settings: { get(): Promise<Record<string, unknown>> }
  /** 插件自己的文案(locales/*.json),{{var}} 插值 */
  t(key: string, vars?: Record<string, unknown>): string
}

/** 打插件自己的后端路由 /api/plugins/<id>/<path>,返回解析后的 JSON(非 2xx 抛错)。 */
export interface PluginApiClient {
  get<T = any>(path: string, params?: Record<string, unknown>): Promise<T>
  post<T = any>(path: string, body?: unknown): Promise<T>
  put<T = any>(path: string, body?: unknown): Promise<T>
  patch<T = any>(path: string, body?: unknown): Promise<T>
  delete<T = any>(path: string, params?: Record<string, unknown>): Promise<T>
}

// ---------- 插槽 ----------

export type PluginSlotName =
  | 'settings.section'
  | 'dashboard.card'
  | 'user.dashboard.card'
  | 'nodes.row.action'
  | 'servers.row.action'
  | 'users.row.action'
  | 'packages.row.action'
  | 'nodes.bulk.action'
  | 'users.bulk.action'
  | 'nodes.toolbar'
  | 'servers.toolbar'
  | 'users.toolbar'

export interface NodeRow {
  id: number
  name: string
  protocol: string
  server_id: number | null
  server_name: string
  server: string
  port: number | null
  tags: string[]
  node_type: string
}
export interface ServerRow {
  id: number
  name: string
  ip: string
  status: string
}
export interface UserRow {
  username: string
  nickname: string
  role: string
  enabled: boolean
}
export interface PackageRow {
  id: number
  name: string
}

export interface RowActionContribution<R> {
  id: string
  label: string
  /** lucide 图标名(kebab-case) */
  icon?: string
  visible?: (row: R) => boolean
  onClick?: (row: R) => void | Promise<void>
  dialog?: React.ComponentType<{ row: R; close: () => void }>
}
export interface BulkActionContribution<R> {
  id: string
  label: string
  icon?: string
  onClick?: (rows: R[]) => void | Promise<void>
  dialog?: React.ComponentType<{ rows: R[]; close: () => void }>
}
export interface ToolbarContribution {
  id: string
  label: string
  icon?: string
  onClick?: () => void | Promise<void>
  dialog?: React.ComponentType<{ close: () => void }>
}
export interface CardContribution {
  id: string
  title?: string
  size?: 'third' | 'half' | 'full'
  component: React.ComponentType
}
export type SettingsSectionContribution = React.ComponentType<{
  values: Record<string, unknown>
  save: (values: Record<string, unknown>) => Promise<void>
}>

export interface SlotContributionMap {
  'settings.section': SettingsSectionContribution
  'dashboard.card': CardContribution
  'user.dashboard.card': CardContribution
  'nodes.row.action': RowActionContribution<NodeRow>
  'servers.row.action': RowActionContribution<ServerRow>
  'users.row.action': RowActionContribution<UserRow>
  'packages.row.action': RowActionContribution<PackageRow>
  'nodes.bulk.action': BulkActionContribution<NodeRow>
  'users.bulk.action': BulkActionContribution<UserRow>
  'nodes.toolbar': ToolbarContribution
  'servers.toolbar': ToolbarContribution
  'users.toolbar': ToolbarContribution
}

// ---------- UI 组件(面板组件的稳定接口) ----------

type AnyProps = Record<string, any> & { className?: string; children?: React.ReactNode }
export interface SelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}
export interface DataTableColumn<R> {
  key: string
  title: React.ReactNode
  render?: (row: R) => React.ReactNode
}

export declare const ui: {
  Button: React.ComponentType<
    AnyProps & {
      variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
      size?: 'default' | 'sm' | 'lg' | 'icon'
      onClick?: (e: React.MouseEvent) => void
      disabled?: boolean
      type?: 'button' | 'submit'
    }
  >
  Card: React.ComponentType<AnyProps>
  CardHeader: React.ComponentType<AnyProps>
  CardTitle: React.ComponentType<AnyProps>
  CardDescription: React.ComponentType<AnyProps>
  CardContent: React.ComponentType<AnyProps>
  CardFooter: React.ComponentType<AnyProps>
  Badge: React.ComponentType<AnyProps & { variant?: 'default' | 'secondary' | 'destructive' | 'outline' }>
  Input: React.ComponentType<AnyProps & React.InputHTMLAttributes<HTMLInputElement>>
  Textarea: React.ComponentType<AnyProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>>
  Label: React.ComponentType<AnyProps & { htmlFor?: string }>
  Select: React.ComponentType<{
    value?: string
    onChange?: (v: string) => void
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
  }>
  Switch: React.ComponentType<AnyProps & { checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }>
  Checkbox: React.ComponentType<AnyProps & { checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }>
  Tabs: React.ComponentType<{
    items: Array<{ value: string; label: React.ReactNode; content: React.ReactNode }>
    value?: string
    defaultValue?: string
    onChange?: (v: string) => void
  }>
  Dialog: React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: React.ReactNode
    description?: React.ReactNode
    footer?: React.ReactNode
    children?: React.ReactNode
  }>
  Sheet: React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: React.ReactNode
    description?: React.ReactNode
    footer?: React.ReactNode
    side?: 'right' | 'left' | 'top' | 'bottom'
    children?: React.ReactNode
  }>
  Table: React.ComponentType<AnyProps>
  TableHeader: React.ComponentType<AnyProps>
  TableBody: React.ComponentType<AnyProps>
  TableRow: React.ComponentType<AnyProps>
  TableHead: React.ComponentType<AnyProps>
  TableCell: React.ComponentType<AnyProps>
  DataTable: <R extends Record<string, unknown>>(props: {
    rows: R[]
    columns: DataTableColumn<R>[]
    rowKey?: (row: R, index: number) => string | number
    empty?: React.ReactNode
  }) => React.ReactElement
  Skeleton: React.ComponentType<AnyProps>
  Tooltip: React.ComponentType<{ content: React.ReactNode; children: React.ReactElement }>
  Separator: React.ComponentType<AnyProps>
  ScrollArea: React.ComponentType<AnyProps>
  Alert: React.ComponentType<{ title?: React.ReactNode; variant?: 'default' | 'destructive'; children?: React.ReactNode }>
}

// ---------- hooks / 工具 ----------

/** 当前插件的后端客户端。 */
export declare function useApi(): PluginApiClient
/** 插件文案。 */
export declare function useT(): (key: string, vars?: Record<string, unknown>) => string
export declare function useCurrentUser(): { username: string; nickname?: string; role: string; isAdmin: boolean } | null
export declare function useTheme(): { theme: string; resolvedTheme: 'light' | 'dark' | string }
/** TanStack Query(面板同一个 QueryClient;queryKey 请以插件 id 开头)。 */
export declare const useQuery: (options: any) => any
export declare const useMutation: (options: any) => any
export declare const useQueryClient: () => any
export declare const toast: {
  (msg: React.ReactNode): void
  success(msg: React.ReactNode): void
  error(msg: React.ReactNode): void
  info(msg: React.ReactNode): void
  warning(msg: React.ReactNode): void
}
export declare function confirm(opts: {
  title: React.ReactNode
  description?: string
  confirmText?: string
  destructive?: boolean
}): Promise<boolean>
/** 面板内跳转(如 '/p/<id>/<page>')。 */
export declare function navigate(to: string): void
export declare const React: typeof import('react')
export declare const jsxRuntime: any

declare const sdk: {
  version: typeof version
  React: typeof React
  jsxRuntime: typeof jsxRuntime
  ui: typeof ui
  definePlugin: typeof definePlugin
  useApi: typeof useApi
  useQuery: typeof useQuery
  useMutation: typeof useMutation
  useQueryClient: typeof useQueryClient
  useT: typeof useT
  useCurrentUser: typeof useCurrentUser
  useTheme: typeof useTheme
  toast: typeof toast
  confirm: typeof confirm
  navigate: typeof navigate
}
export default sdk
