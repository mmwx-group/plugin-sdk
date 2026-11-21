// 终端输出:简单着色(不是 TTY 或设了 NO_COLOR 时不着色)。
const color = process.stdout.isTTY && !process.env.NO_COLOR
const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s))
export const c = {
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  bold: wrap('1'),
}

const time = (ms) => new Date(ms || Date.now()).toTimeString().slice(0, 8)

export function say(msg) {
  console.log(`${c.dim(time())} ${msg}`)
}
export function ok(msg) {
  say(`${c.green('✓')} ${msg}`)
}
export function warn(msg) {
  say(`${c.yellow('!')} ${msg}`)
}
export function fail(msg) {
  say(`${c.red('✗')} ${msg}`)
}

const KIND = { log: '', request: 'req', event: 'evt', cron: 'cron', filter: 'flt', push: 'push', tunnel: 'tun', session: 'ses' }

/** 打印一条实时日志(主控推来的或本机运行时的)。 */
export function printLog(l, { local = false } = {}) {
  const lv = l.level === 'error' ? c.red('ERR ') : l.level === 'warn' ? c.yellow('WARN') : c.dim('INFO')
  const tag = local ? c.magenta('local') : l.kind && KIND[l.kind] ? c.cyan(KIND[l.kind].padEnd(5)) : c.blue('log  ')
  const msg = l.level === 'error' ? c.red(l.message) : l.message
  console.log(`${c.dim(time(l.time))} ${lv} ${tag} ${msg}`)
}
