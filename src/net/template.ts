/**
 * 按点路径从 model 取值：`user.name`、`list.0.title`。
 * 任一段为 undefined/null 则返回 undefined。
 */
function resolvePath(model: unknown, expr: string): unknown {
  const segs = expr.split('.')
  let cur: unknown = model
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const i = Number(s)
      if (Number.isNaN(i)) return undefined
      cur = cur[i]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[s]
    } else {
      return undefined
    }
  }
  return cur
}

/** 把取值结果转成要插入的字符串 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * 极简 Mustache 模板渲染（零依赖）：
 * - `{{ expr }}` 与 `{{{ expr }}}` 均**原样插入**（不做任何转义），内容由使用者自行保证安全
 * - expr 支持点路径与数组下标，如 `user.name`、`list.0.title`
 * - 未取到的变量替换为空串
 *
 * 注意：不做条件 / 循环 / 逻辑，纯值替换；需要时请在 handler 里先算好再塞进 model。
 */
export function renderTemplate(template: string, model: Record<string, unknown>): string {
  return template.replace(/\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g, (_whole, raw, escaped) => {
    const expr = String(raw !== undefined ? raw : escaped).trim()
    return stringify(resolvePath(model, expr))
  })
}
