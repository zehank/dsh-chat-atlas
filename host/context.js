/**
 * chat-atlas / context —— 上下文插件（宿主侧）。
 *
 * 每一轮在系统提示词里带上一小块「相关记忆」：按本轮用户消息检索记忆库，
 * 取前几条的标题 + 摘要 + id。没有命中就只留目录索引，不占预算。
 */
import { folderTree, excerpt, search, listEntries } from './core.js'
import { roleOf } from './role.js'

const name = 'context-loom'
const inject = ['systemPrompt']

const MAX_CHARS = 1100
const PROG_MAX = 25

/** 编程库清单：不靠检索命中，每轮常驻，让他会的概念一直在眼前。 */
function progLine() {
  const rows = listEntries().filter((e) => e.kind === 'programming')
  if (!rows.length) return ''
  const sorted = rows.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
  const titles = sorted.slice(0, PROG_MAX).map((e) => e.title.replace(/^[^·]{1,12} · /, '').slice(0, 24))
  const more = sorted.length > titles.length ? ` …共 ${sorted.length} 条` : ''
  return `编程库（${rows.length}）：${titles.join(' / ')}${more}`
}

function folderLine() {
  const rows = folderTree().filter((f) => f.count > 0)
  if (!rows.length) return ''
  return '记忆库目录：' + rows.map((f) => `${short(f.label)}(${f.count})`).join(' · ')
}

function short(label) {
  return String(label)
    // 这两个馆的目录名/显示名是英文（用户要求的），但每轮注入的目录索引要短
    .replace('science knowledge base', '理科')
    .replace('programming knowledge base', '编程')
    .replace('知识储备', '').replace('图书馆', '馆').replace('我的形象', '画像')
    .replace('建模要求与偏好', '建模偏好').replace('建模成品', '成品')
}

function build(text) {
  const index = folderLine()
  const prog = progLine()
  const tail = [prog, index].filter(Boolean)
  const hits = text && text.trim() ? search(text, { limit: 5 }) : []
  if (!hits.length) return [...tail, '（本轮没有检索到直接相关的记忆；需要时用 memory_search。）'].join('\n')
  const lines = ['记忆库·本轮相关：']
  let used = 200
  for (const h of hits) {
    const tag = h.kind === 'custom' ? `custom/${h.category}` : h.kind + (h.subject ? '/' + h.subject : '')
    const line = `- [${h.id}]《${h.title}》(${tag})${h.tags.length ? ' #' + h.tags.slice(0, 3).join(' #') : ''}：${excerpt(h.body, 90)}`
    if (used + line.length > MAX_CHARS) break
    used += line.length
    lines.push(line)
  }
  lines.push('要读全文用 memory_read <id>；要更多用 memory_search。')
  lines.push(...tail)
  return lines.join('\n')
}

/** @type {import('@deepseek-ai/cordis').Plugin} */
function apply(ctx) {
  const lastUser = new Map()

  ctx.on('agent/pre-step', ({ messages }, next) => {
    const agent = ctx.get?.('agents')?.currentInitiator?.()
    if (!agent) return next()
    if (!Array.isArray(messages)) return next()
    const user = messages.filter((m) => m?.source?.kind === 'user')
    if (!user.length) return next()
    const text = user
      .map((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ') : ''))
      .join('\n')
      .trim()
    if (text) lastUser.set(agent, text)
    return next()
  })

  const fibers = new Map()
  const install = (agent) => {
    const sid = agent.session?.id
    if (!sid || fibers.has(agent)) return
    try {
      const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({
          name: 'chat-atlas:context',
          order: 8600,
          interpolate: false,
          text: () => {
            if (roleOf(sid) === 'none') return ''
            try {
              return build(lastUser.get(agent) || '')
            } catch {
              return ''
            }
          },
        })
      })
      fibers.set(agent, fiber)
    } catch (e) {
      ctx.logger?.warn?.(`chat-atlas: context section failed: ${e?.message || e}`)
    }
  }
  for (const agent of ctx.get?.('agents')?.list?.() || []) install(agent)
  ctx.on('agent/created', ({ agent }) => install(agent))
  ctx.on('agent/disposed', ({ agent }) => {
    fibers.get(agent)?.dispose?.()
    fibers.delete(agent)
    lastUser.delete(agent)
  })
}

export { apply, build, inject, name }
