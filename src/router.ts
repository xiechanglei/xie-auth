import type { Route } from './types.js'

/** 解析并规范 method 字符串：'GET,POST' → ['GET','POST']，默认 GET */
export function normalizeMethods(method?: string): string[] {
  if (!method) return ['GET']
  const list = method
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean)
  return list.length > 0 ? list : ['GET']
}

/** 把带 :param 的路径编译成匹配正则与参数名 */
export function compilePath(rawPath: string): { matcher: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const segments = rawPath.split('/').filter((s) => s.length > 0)
  let pattern = '^'
  for (const seg of segments) {
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1))
      pattern += '/([^/]+)'
    } else {
      pattern += '/' + escapeRegExp(seg)
    }
  }
  pattern += '/?$'
  return { matcher: new RegExp(pattern), paramNames }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 命中路由则返回参数映射，否则返回 null */
export function matchRoute(route: Route, pathname: string): Record<string, string> | null {
  const m = route.matcher.exec(pathname)
  if (!m) return null
  const params: Record<string, string> = {}
  route.paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1])
  })
  return params
}

/** 在路由表中查找匹配（路径 + 方法） */
export function findRoute(routes: Route[], pathname: string, method: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const params = matchRoute(route, pathname)
    if (params && route.methods.includes(method)) {
      return { route, params }
    }
  }
  return null
}

/** 路径是否存在方法不匹配（用于返回 405 与否的判定，可选） */
export function pathExists(routes: Route[], pathname: string): boolean {
  return routes.some((route) => matchRoute(route, pathname) !== null)
}

/** 把 glob 模式（含 ** 与 *）编译成正则，用于 authGuard */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++ // 跳过第二个 *
        // 吃掉紧随其后的 /
        if (pattern[i + 1] === '/') i++
      } else {
        out += '[^/]*'
      }
    } else {
      out += escapeRegExp(c)
    }
  }
  return new RegExp('^' + out + '/?$')
}
