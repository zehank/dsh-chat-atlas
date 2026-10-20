/**
 * chat-atlas / memory —— 记忆插件（宿主侧）。
 *
 * 记忆是文件：~/.dsh/chat-atlas/memory/<类别>/<标题>-<id>.md
 * 这里只暴露模型可调用的工具 + 给另外两个插件用的函数（core.js）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  KINDS, MEM, SUBJECTS, ensureDirs, excerpt, folderTree, invalidate,
  libraryKind, listEntries, progressReport, readEntry, readProgress, registerLibrary,
  search, semanticTop, fuseHybrid, syllabusNodes, tool, writeEntry, writeProgress,
} from './core.js'
import { embed } from './embed.js'

const name = 'memory-atlas'
const inject = ['tools']

const KIND_IDS = () => Object.keys(KINDS)

function fail(message, extra = {}) {
  return { ok: false, message, ...extra }
}

function ok(message, extra = {}) {
  return { ok: true, message, ...extra }
}

const jsonOutput = () => ({
  schema: { type: 'object', additionalProperties: true },
  render: (_a, v) => [{ type: 'text', text: v?.message || (v?.ok === false ? '失败' : '完成') }],
})

/** @type {import('@deepseek-ai/cordis').Plugin} */
function apply(ctx) {
  ensureDirs()

  ctx.tools.register(tool({
    name: 'memory_save',
    description:
      '把一条新记忆存进记忆库。必须自己判断类别 kind：programming=编程知识；science=已学会的理科知识（需 subject）；' +
      'library-science=理科资料（需 subject）；library-philosophy=哲学文本（需 category）；portrait=关于用户的画像；' +
      'modeling-preference=建模要求；modeling-work=建模成品；plugins=自制插件档案；inbox=暂时分不了类。' +
      '【找不到匹配的已有类别时，不要用 custom】：自己总结一个英文主题名，用 kind=library-<主题>（如 library-psychology / ' +
      'library-history）＋ library_label 给中文馆名（如「心理图书馆」），插件会自动建这个一级馆并存进去。' +
      '同一主题继续用同一个馆名，不要每次新建。',
    parameters: {
      title: { type: 'string', required: true, description: '一句话标题，之后靠它被检索到' },
      content: { type: 'string', required: true, description: '记忆正文，自包含，别写“如上”' },
      kind: { type: 'string', description: '类别；不给则先放 inbox 并提示分类。新主题用 library-<英文主题>' },
      library_label: { type: 'string', description: '新建一级馆时的中文馆名，如「心理图书馆」' },
      subject: { type: 'string', enum: SUBJECTS, description: 'science / library-science 必填' },
      category: { type: 'string', description: 'library-philosophy / custom 的二级分类' },
      tags: { type: 'array', items: { type: 'string' }, description: '3-6 个关键词标签' },
      source: { type: 'string', description: '来源：chat / 用户文件路径 / URL' },
      links: { type: 'array', items: { type: 'string' }, description: '相关条目的 id 列表' },
    },
    output: jsonOutput({
      id: { type: 'string' }, needFolder: { type: 'boolean' }, suggestion: { type: 'object' }, duplicateOf: { type: 'string' },
    }),
    execute(args) {
      const kind = args.kind || 'inbox'
      if (!KIND_IDS().includes(kind)) {
        if (!libraryKind(kind)) {
          return fail(`未知类别 ${kind}，可用：${KIND_IDS().join('/')}；新主题请用 library-<英文主题>`)
        }
        registerLibrary(kind, args.library_label || kind, `自动新建：${excerpt(args.content, 30)}`)
      }
      if ((kind === 'science' || kind === 'library-science') && !SUBJECTS.includes(args.subject)) {
        return fail(`${kind} 需要 subject，取值 ${SUBJECTS.join('/')}`)
      }
      if ((kind === 'custom' || kind === 'library-philosophy' || libraryKind(kind)) && !args.category) {
        return fail(`${kind} 需要 category（二级分类名）`)
      }
      // 去重：同类别下标题完全相同则不重复写（全量比对，不受检索结果排名影响）
      const near = listEntries().find((e) => e.kind === kind && e.title === args.title)
      if (near) return { ok: true, duplicateOf: near.id, message: `已存在同名条目（${near.id}），没有重复写入。要改它用 memory_update。` }

      const entry = writeEntry({
        title: args.title,
        body: args.content,
        kind,
        subject: args.subject,
        category: args.category,
        tags: Array.isArray(args.tags) ? args.tags : [],
        links: Array.isArray(args.links) ? args.links : [],
        source: args.source || 'chat',
      })
      return ok(`已存入 ${kind}${args.subject ? '/' + args.subject : ''}：${entry.title}（id ${entry.id}）`, { id: entry.id })
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_search',
    description: '按关键词检索记忆库，返回最相关的条目（标题、类别、摘要、id）。要读全文用 memory_read。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词，可以是句子' },
      limit: { type: 'number', description: '返回条数，默认 6' },
      kind: { type: 'string', description: '只看某个类别' },
    },
    output: jsonOutput({ hits: { type: 'array' } }),
    async execute(args) {
      const n = Math.min(Number(args.limit) || 6, 20)
      const kinds = args.kind ? [args.kind] : undefined
      let hits = search(args.query, { limit: n, kinds })
      try {
        const vec = await embed(args.query)
        if (vec) hits = fuseHybrid(search(args.query, { limit: n * 2, kinds }), semanticTop(vec, { limit: n * 2, kinds }), n)
      } catch (e) {}
      if (!hits.length) return fail('没有命中。可以换个说法，或先用 memory_list 看有哪几类。')
      const lines = hits.map((h, i) => `${i + 1}. [${h.id}] ${h.title} — ${h.kind}${h.subject ? '/' + h.subject : ''}${h.tags.length ? ' #' + h.tags.join(' #') : ''}\n   ${excerpt(h.body, 120)}`)
      return { ok: true, message: lines.join('\n'), hits: hits.map((h) => ({ id: h.id, title: h.title, kind: h.kind, ...(h.subject ? { subject: h.subject } : {}), score: Math.round((h.score ?? h.rrf ?? 0) * 100) / 100 })) }
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_read',
    description: '读一条记忆的全文。',
    parameters: { id: { type: 'string', required: true, description: '条目 id' } },
    output: jsonOutput({ entry: { type: 'object' } }),
    execute(args) {
      const e = readEntry(args.id)
      if (!e) return fail(`没有 id 为 ${args.id} 的条目`)
      return { ok: true, message: `# ${e.title}\n\n${e.body}`, entry: { id: e.id, title: e.title, kind: e.kind, tags: e.tags, body: e.body } }
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_list',
    description: '列出记忆库的目录结构、各类条目数和最近条目，用于了解库里有什么。',
    parameters: {},
    output: jsonOutput({ folders: { type: 'array' } }),
    execute() {
      const folders = folderTree()
      const recent = listEntries().sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 8)
      const lines = folders.map((f) => {
        if (f.children) return `- ${f.label} (${f.count})\n` + f.children.map((c) => `    - ${c.label} (${c.count})`).join('\n')
        return `- ${f.label} (${f.count})`
      })
      if (recent.length) lines.push('', '最近更新：', ...recent.map((r) => `- ${r.title}（${r.kind}）`))
      return { ok: true, message: lines.join('\n'), folders }
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_link',
    description: '给两条记忆建立关联（双向），用于思维导图里的连边。',
    parameters: {
      from_id: { type: 'string', required: true },
      to_id: { type: 'string', required: true },
    },
    output: jsonOutput({}),
    execute(args) {
      const a = readEntry(args.from_id)
      const b = readEntry(args.to_id)
      if (!a || !b) return fail('id 不存在')
      const link = (src, dst) => {
        const links = [...new Set([...(src.links || []), dst.id])]
        writeEntry({
          id: src.id, title: src.title, body: src.body, kind: src.kind, subject: src.subject,
          category: src.category, tags: src.tags, links, source: src.source, created: src.created,
        })
      }
      link(a, b)
      link(b, a)
      return ok(`已连边：${a.title} ↔ ${b.title}`)
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_update',
    description:
      '原地改一条已有记忆（id 不变、不新增条目）：正文、标题、标签、连边、来源。' +
      '要更新过时的评估/画像就用它，别用 memory_save 另存一条新的。',
    parameters: {
      id: { type: 'string', required: true, description: '条目 id' },
      title: { type: 'string', description: '新标题；不给则保留' },
      content: { type: 'string', description: '新正文；不给则保留' },
      tags: { type: 'array', items: { type: 'string' }, description: '新标签；不给则保留' },
      links: { type: 'array', items: { type: 'string' }, description: '新连边；不给则保留' },
      source: { type: 'string', description: '新来源；不给则保留' },
    },
    output: jsonOutput({ id: { type: 'string' } }),
    execute(args) {
      const e = readEntry(args.id)
      if (!e) return fail(`没有 id 为 ${args.id} 的条目`)
      const title = args.title || e.title
      const body = args.content === undefined || args.content === '' ? e.body : args.content
      const file = writeEntry({
        id: e.id,
        title,
        body,
        kind: e.kind,
        subject: e.subject,
        category: e.category,
        tags: Array.isArray(args.tags) ? args.tags : e.tags,
        links: Array.isArray(args.links) ? args.links : e.links,
        source: args.source ?? e.source,
        created: e.created,
      })
      if (file !== e.file) fs.rmSync(e.file, { force: true })
      return ok(`已更新 ${e.id}：${title}`, { id: e.id })
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_folder_create',
    description: '在某个馆下面新建二级分类（不建新馆；新馆直接 memory_save 用 library-<主题> 自动建）。',
    parameters: {
      parent: { type: 'string', required: true, description: '挂在哪个馆下，如 library-psychology / library-philosophy / custom' },
      name: { type: 'string', required: true, description: '二级分类名' },
    },
    output: jsonOutput({}),
    execute(args) {
      if (!KIND_IDS().includes(args.parent)) return fail(`没有这个馆：${args.parent}`)
      const dir = path.join(MEM, args.parent, args.name.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, '-'))
      fs.mkdirSync(dir, { recursive: true })
      invalidate()
      return ok(`已新建类别：${path.relative(MEM, dir)}`)
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_progress',
    description: '查理科四科的学习进度（已学知识点 / 大纲总数）。',
    parameters: { subject: { type: 'string', enum: SUBJECTS, description: '只查一科' } },
    output: jsonOutput({ progress: { type: 'array' } }),
    execute(args) {
      const rows = progressReport().filter((r) => !args.subject || r.subject === args.subject)
      const lines = rows.map((r) => `${r.label}：${r.done}/${r.total}（${r.percent}%）`)
      return { ok: true, message: lines.join('\n'), progress: rows }
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_mark_learned',
    description: '把理科大纲里的知识点标记为已学会。nodes 用 memory_progress 或大纲里给出的 id，如 "math:导数/求导法则"。',
    parameters: {
      nodes: { type: 'array', items: { type: 'string' }, required: true, description: '知识点 id 列表' },
      evidence: { type: 'string', description: '凭什么判定学会了，一句话' },
    },
    output: jsonOutput({ learned: { type: 'array' } }),
    execute(args) {
      const all = new Set()
      for (const s of SUBJECTS) for (const n of syllabusNodes(s)) all.add(n.id)
      const valid = (Array.isArray(args.nodes) ? args.nodes : []).filter((n) => all.has(n))
      if (!valid.length) return fail('没有合法的大纲节点 id')
      const p = readProgress()
      for (const n of valid) p[n] = { at: new Date().toISOString(), evidence: args.evidence || '' }
      writeProgress(p)
      return ok(`已标记 ${valid.length} 个知识点：${valid.join('、')}`, { learned: valid })
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_import_file',
    description: '把用户给的文件（工作区里的路径）读进来存成一条记忆。超过 200KB 会拒绝。',
    parameters: {
      file_path: { type: 'string', required: true, description: '绝对路径或工作区相对路径' },
      kind: { type: 'string', required: true, description: '归到哪一类' },
      subject: { type: 'string', enum: SUBJECTS },
      category: { type: 'string' },
      title: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    output: jsonOutput({ id: { type: 'string' } }),
    execute(args) {
      const kind = args.kind
      if (!KIND_IDS().includes(kind)) {
        return fail(`未知类别 ${kind}，可用：${KIND_IDS().join('/')}；新主题请先用 memory_save 建馆`)
      }
      if ((kind === 'science' || kind === 'library-science') && !SUBJECTS.includes(args.subject)) {
        return fail(`${kind} 需要 subject，取值 ${SUBJECTS.join('/')}`)
      }
      if ((kind === 'custom' || kind === 'library-philosophy' || libraryKind(kind)) && !args.category) {
        return fail(`${kind} 需要 category（二级分类名）`)
      }
      let p = args.file_path
      if (!path.isAbsolute(p)) p = path.resolve(process.cwd(), p)
      let text
      try {
        const st = fs.statSync(p)
        if (st.size > 200 * 1024) return fail('文件超过 200KB，先拆分或摘要再存')
        text = fs.readFileSync(p, 'utf8')
      } catch (e) {
        return fail(`读不到文件：${p}（相对路径按 ${process.cwd()} 解析，建议传绝对路径）`)
      }
      const entry = writeEntry({
        title: args.title || path.basename(p),
        body: text,
        kind: args.kind,
        subject: args.subject,
        category: args.category,
        tags: Array.isArray(args.tags) ? args.tags : [],
        source: p,
      })
      return ok(`已导入 ${path.basename(p)} → ${args.kind}（id ${entry.id}）`, { id: entry.id })
    },
  }))

  ctx.tools.register(tool({
    name: 'memory_graph',
    description: '导出记忆的节点和连边，供思维导图使用。',
    parameters: {},
    output: jsonOutput({ nodes: { type: 'array' }, edges: { type: 'array' } }),
    execute() {
      const entries = listEntries()
      const ids = new Set(entries.map((e) => e.id))
      const edges = []
      for (const e of entries) for (const l of e.links) if (ids.has(l)) edges.push({ a: e.id, b: l })
      return { ok: true, message: `${entries.length} 个节点，${edges.length} 条连边`, nodes: entries.map((e) => ({ id: e.id, title: e.title, kind: e.kind, ...(e.subject ? { subject: e.subject } : {}), tags: e.tags })), edges }
    },
  }))
}

export { apply, inject, name }
