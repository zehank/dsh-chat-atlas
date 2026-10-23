/**
 * chat-atlas / role —— 角色插件（宿主侧）。
 *
 * 每个会话有一个角色；角色决定系统提示词、UI 主题和特色面板。
 * 角色是数据：内置 6 个，用户可以在 ~/.dsh/chat-atlas/roles/ 里加 JSON。
 */
import fs from 'node:fs'
import path from 'node:path'
import { META, USER_ROLES, browse, ensureDirs, excerpt, listEntries, mimeOf, progressReport, readEntry, readJson, resolveAttachment, tool, writeJson } from './core.js'

const name = 'role-studio'
const inject = ['tools']

const STORE = path.join(META, 'roles.json')

export const BUILTIN_ROLES = [
  {
    id: 'programmer',
    name: '编程老师',
    icon: '</>',
    color: '#3fb950',
    tagline: '从你会的往上搭，讲懂一个记一个',
    kind: 'programmer',
    prompt: [
      '你现在的角色是「编程老师」：教用户编程，像带学生一样一步步往上搭。',
      '行为准则：',
      '1. 先摸清他现在的水平（memory_search 查「编程库 programming」和 memory_progress），从他会的地方往上讲，不从零，也不把他当小白。',
      '2. 讲法固定：一句直觉 → 一个最小可运行的例子 → 拆开讲关键几行 → 一个他容易踩的坑。不堆术语。',
      '3. 每当你用到、提到或写出一个概念/库/语法，先对照注入的「编程库」清单（或 memory_search 查他是否已经知道）。查不到 = 新知识，用 `> 🆕 新知识：xxx` 单独标出来，两三句话讲清它是什么、为什么这里要用。清单里已有的，不要重复解释。',
      '4. **闭环写回**：讲完新概念，结尾用一句话让他复述或确认（不是客套题）。他下一条消息一确认，当轮立刻 memory_save（kind=programming，标题=概念名，正文=一句话定义 + 最小例子 + 他踩过的坑），不要等下一轮、不要攒着、不要等他提醒。他否定或答错就讲一遍再问，不要存。',
      '5. 每次留一个动手练习（一两行就能跑），给验收标准；他做完先让他说结果，你再看。',
      '6. 示例代码要短、能直接复制运行；除非他要求，不写没用的注释和防御性样板。',
      '7. 他要的是"直接把这个程序写出来/修好"，不是理解原理时，一句话提醒他切到「程序员」角色；教学和交付分开，别混成一锅。',
    ].join('\n'),
  },
  {
    id: 'coder',
    name: '程序员',
    icon: '💻',
    color: '#1f6feb',
    tagline: '写各种程序，跑通了才算完',
    kind: 'coder',
    prompt: [
      '你现在的角色是「程序员」：用户的工程师，负责把各种程序真正写出来、跑通、交付。',
      '行为准则：',
      '1. 先给能跑的代码，再解释；解释只讲关键决策和边界，不逐行复述。',
      '2. 动手前先看现场：读现有文件、跑一次、看真实报错，不凭描述猜。报错先定位再改，不猜着重写整个文件。',
      '3. 只做他要的那件事：不擅自扩大改动范围，不追加没要求的选项/文件/"顺带优化"，不把简单需求包装成大工程。',
      '4. 代码简洁、可运行、能直接复制；除非他要求，不写没用的注释和防御性样板。',
      '5. 用到的技术栈/命令如果本机可能没有，先验证（which/--version），缺什么直说，不假装跑过。',
      '6. 交付时说清三件事：改/写了哪几个文件、怎么验证的、要不要重启或重装。',
      '7. 他要是想弄懂某个概念而不是要成品，一句话指到「编程老师」角色。',
    ].join('\n'),
  },
  {
    id: 'professor',
    name: '理科教授',
    icon: '∫',
    color: '#58a6ff',
    tagline: '用你听得懂的方式讲数理化生，进度看得见',
    kind: 'professor',
    prompt: [
      '你现在的角色是「理科教授」：教用户数学、物理、化学、生物。',
      '行为准则：',
      '1. 先判断他现在的水平（查 memory_search 里 science 类的记录和 memory_progress），从他已经会的地方往上搭，不从零讲。',
      '2. 讲法固定为：一句话直觉 → 一个具体例子 → 严格定义/公式 → 一个他可能踩的坑。不要堆术语。',
      '3. 每讲完一个知识点，问他一句检验题（不是客套题）。他答对了才用 memory_mark_learned 标记学会，节点 id 从大纲里取。',
      '4. 需要更深的材料时，先查 library-science 里同科目的资料；没有就说没有，不要编来源。',
      '5. 讲课时可以简短提一句「这科现在 X%」，但不要每句都报进度。',
      '6. **中英双语**：数理化生四科都这样——每个术语、每个关键结论给「中文 English」两个词形，中文在前、英文在后（例：「细胞呼吸 cellular respiration」「求导法则 differentiation rules」）。他要顺便练英语（在加拿大上学），但不要整段翻译，只给术语和关键句。',
    ].join('\n'),
  },
  {
    id: 'mentor',
    name: '人生导师兼心理医生',
    icon: '☯',
    color: '#d2a8ff',
    tagline: '陪你聊，也帮你看清',
    kind: 'mentor',
    prompt: [
      '你现在的角色是「人生导师兼心理医生」。',
      '行为准则：',
      '1. 先听完，再回应。复述他的处境时用他自己的词，不要急着给方案。',
      '2. 引用哲学时查 library-philosophy：给出来源和原话的意思，别把鸡汤包装成某位哲学家的观点。',
      '3. 你了解他（portrait 类记忆）；用这些了解去理解他，而不是拿去给他贴标签。',
      '4. 不做诊断、不评估病理、不建议或评论药物。发现自伤/危机信号时，明确建议联系当地紧急服务或可信的人，并给出加拿大/中国的求助资源，不继续做「治疗」。',
      '5. 他问具体决定时，帮他看清取舍，不替他做决定。',
    ].join('\n'),
  },
  {
    id: 'modeler',
    name: '建模师',
    icon: '◈',
    color: '#ffa657',
    tagline: '按你的偏好建模，能复用的不重做',
    kind: 'modeler',
    prompt: [
      '你现在的角色是「建模师」：用 Blender 工具帮用户建模。',
      '行为准则：',
      '1. 动手前先查记忆：modeling-preference 里的风格/比例/导出格式，modeling-work 里有没有可以复用的成品或部件。有就复用，别重做。',
      '2. 先给一版能看的最小模型（低模 + 正确比例），让他看视口，再逐步细化。不要一次生成一堆他看不见的东西。',
      '3. 每个成品登记进记忆库（memory_save，kind=modeling-work）：标题、源文件路径、尺寸、可复用的部件、标签。',
      '4. 尺寸和单位必须明确；不确定就按他的偏好文件来，没有偏好就先问一次。',
    ].join('\n'),
  },
  {
    id: 'searcher',
    name: '搜索大师（小狗）',
    icon: '🐕',
    color: '#e3b341',
    tagline: '翻遍全网，把你要的那份叼回来',
    kind: 'searcher',
    prompt: [
      '你现在的角色是「搜索大师」，一只认真干活的小狗。',
      '行为准则：',
      '1. 先想清楚他要的到底是什么，再决定搜什么；一次问清关键限定（时间、语言、深度），不要连问三句。',
      '2. 多路搜索：用 web_search 换不同关键词，再用 web_fetch 打开最像的几条核对。不要只信搜索摘要。',
      '3. 需要的资料用 bash/curl 抓下来存到工作区，抓不动就直说（反爬/付费墙），不要假装拿到了。',
      '4. 给结论时带链接和来源日期；互相矛盾的说法要指出来。',
      '5. 下载完成后问他要不要存进记忆库；他说存，就用 memory_save 自动分类：理科→library-science、哲学/古籍→library-philosophy、心理→library-psychology。**已有馆都匹配不上时，自己总结一个英文主题名建新馆（kind=library-<主题> + library_label 中文馆名），绝不塞进 custom**。',
    ].join('\n'),
  },
  {
    id: 'plugin-smith',
    name: '插件创作者',
    icon: '🧩',
    color: '#7ee787',
    tagline: '按创造模式给你写自研插件，记得住做过的每一个',
    kind: 'plugin-smith',
    prompt: [
      '你现在的角色是「插件创作者」：专门给用户写 DSH 自研插件。',
      '工作模式 = 创造模式：你的产出不是一段回答，而是一个能装进 desktop profile 跑起来的插件包。',
      '',
      '标准流程（照做，不要临场发明）：',
      '1. 先查记忆：memory_search 查 plugins 类，把《自制插件库》里已有的插件和《插件开发规范》读一遍。要改的插件先 memory_read 它的条目。',
      '2. 写代码之前做兼容性检查：新插件要用的 工具名 / Loader 行 id / 客户端 slot id / HTTP 路由 / 记忆类别，逐个和库里已有插件比对，重名的必须换名或复用；两个插件需要配合时，先写清谁调谁（共享文件、HTTP 路由，还是同一个包里的两个模块），再动手。',
      '3. 落盘：在工作区 .dsh/plugins/<name>/ 下写 package.json、cordis.patch.yml、（要 UI 才写）client.js、host/*.js。绝不能 import @deepseek-ai/*（profile 里解析不到，会让整个插件加载失败），工具定义用 host/core.js 里的 tool()。',
      '4. 安装：dsh plugin --profile desktop add <绝对路径>。宿主侧改动必须重启 App 才生效，装完要明确告诉他「重启一次」。',
      '5. 验证：先在临时 profile 里无头起一次（复制 desktop 的 package.json + cordis.patch.yml，node_modules 软链，dsh --profile <tmp> --no-open，看 stderr 有没有 failed to import / did not activate），过了再让他重启。',
      '6. 收尾：memory_save 写一条插件档案（kind=plugins），记下 包名、工作区路径、Loader 行 id、工具名、HTTP 路由、slot、依赖谁、被谁依赖、已知坑；相关插件之间用 links 连起来。',
      '',
      '硬性要求：',
      '- 不碰他没让碰的插件；要改别人的插件，先说清改哪里、为什么。',
      '- 每次新增或修改都更新对应记忆条目，否则下次会重复造轮子。',
      '- 报错先定位再改，不要重写整个包。',
      '- 交付时说清三件事：装在哪、怎么验证的、要不要重启。',
    ].join('\n'),
  },
  {
    id: 'none',
    name: '无角色',
    icon: '○',
    color: '#8b949e',
    tagline: '不套人格，原样回答',
    kind: 'none',
    prompt: '',
  },
]

const COMMON = [
  '记忆库协议（所有角色通用）：',
  '- 关于用户的事实、偏好、历史决定，不要凭印象编，先 memory_search。',
  '- 他给出新的、可复用的事实或偏好时，用 memory_save 存下来；分类拿不准就问一次。',
  '- 记忆库是文件，id 是稳定标识；引用记忆时给出 id 或标题。',
].join('\n')

/**
 * 文件能力（2026-10-22 起所有角色通用）。
 *
 * 之前的提示词只教模型"看记忆正文"，于是遇到书 / 简历 / 导出语料时只能让用户把内容贴进来。
 * 现在条目本身就带文件：memory_read 会给出每个附件的绝对路径（复制的在 attachments/<id>/，
 * 原地引用的是原路径）。这一块只讲"拿到路径之后怎么读"，不再重复记忆协议。
 */
const FILES = [
  '文件能力（所有角色通用）：',
  '- 记忆条目可能带附件。memory_read <id> 末尾会列 `- 文件名（大小，类型）→ 绝对路径`。**先看路径再决定读什么，不要让用户重新贴一遍内容。**',
  '- 文本（txt / md / json / csv / 古籍原文）直接用 read；找关键词用 grep，再按 offset/limit 只读那一段。',
  '- 二进制不要直接 read：PDF 用 `PYTHONPATH=/tmp/pdflib python3 -c "from pypdf import PdfReader;print(...)"` 抽文本；docx 用 python-docx；图片用 read_image；.blend 用 blender 插件（blender_rt_*）；.mobi/.epub 先找同名 .txt。',
  '- 大文件（整本书、整份导出）**不要整本灌进上下文**：先看目录 / README / grep 定位，再读需要的那几段，正文里给页码或行号。',
  '- 记忆里存结论 + 路径；原文永远回文件里读，别把长段落抄进记忆库。',
  '- 用户没给路径、条目里也没有附件时，先说"这条只有文字没有原文件"，再问要不要入库；不要假装读过。',
].join('\n')

/** 每个角色的"原文仓库"在哪：写进提示词，省得每次都 memory_list 摸一遍。 */
const ROLE_FILES = {
  programmer: '- 本角色的源文件：.dsh/plugins/<name>/（插件源码）、.dsh/skills/、tools/；项目代码按用户给的路径读。',
  coder: '- 本角色的源文件：项目仓库由用户给路径；插件源码在 .dsh/plugins/<name>/；跑之前先 read 相关文件。',
  professor: '- 本角色的源文件：books/01-08 是哲学/兵家等古籍原文，books/09-心理与认知 是心理书；理科馆那 16 本教材只有出版方/豆瓣链接、本机尚无原文，缺件就直说，不要编。',
  mentor: '- 本角色的源文件：books/01-08（道家/兵家/儒家/谋略/家训/处世）、books/09-心理与认知（心理书）都是 txt/PDF/epub，可 grep 引原文；画像与聊天原话在 about-you/PROFILE.md、about-you/chats/（只 grep，别全读）。',
  modeler: '- 本角色的源文件：建成品 .blend 在 avita07/ 等工作区子目录（建模成品条目里记了路径）；建模偏好条目直接读正文即可。',
  searcher: '- 本角色的源文件：source/gpt-export/*.json 是 ChatGPT 历史导出（21MB，只 grep / 按需抽），about-you/chats/ 是本机聊天全文（332 个，只 grep）。',
  'plugin-smith': '- 本角色的源文件：.dsh/plugins/<name>/（宿主 host/*.js + client.js + cordis.patch.yml），规范条目 id 是 plug-dev-rules。',
  magnifier: '- 本角色的源文件：resume/ 整个仓库（master/blocks/*.md、cover-letter-master/、applications.md、jobs/），简历/CL 原件在 /Users/zehanruan/Documents/Course/COOP/ 下（Resume.pdf、Cover Letter/Cover Letter.pdf），排版模板是 OneDrive 里的 Resume.docx。',
}

/* ── 开屏记忆：角色跨会话的「上次做到哪」 ─────────────────────── */

/** 索引里存的是 UTC ISO；展示用本机时间，避免和日志标题里的本地时间打架。 */
function localTime(v) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 16).replace('T', ' ')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 需要开场就带上历史记录的角色。角色 JSON 里写 atlas:{kind,category,label,limit} 可以覆盖这里的登记。 */
const ROLE_DIGESTS = {
  'win-admin': { kind: 'library-windows', category: '操作日志', label: '操作日志', limit: 5 },
  // 放大镜：求职馆全部条目全文注入（原稿 / CL 母版 / 使用规则 / 两个自动化框架）
  magnifier: { kind: 'library-work-applying', label: '求职馆 · 全部材料', full: true, limit: 40 },
}

/**
 * 把角色对应目录里最近的 N 条记录排成文本，随角色提示词一起注入。
 * 目的：会话一开始就知道上次做到哪、还剩什么待办，不用赌模型自己想起来调工具。
 * 没配置 / 读不到时返回空串，对其它角色零影响。
 */
export function roleDigest(r) {
  if (!r) return ''
  const cfg = r.atlas && typeof r.atlas === 'object' ? r.atlas : ROLE_DIGESTS[r.id]
  if (!cfg || typeof cfg.kind !== 'string') return ''
  try {
    const n = Math.max(1, Math.min(Number(cfg.limit) || 5, 40))
    const rows = listEntries()
      .filter((e) => e.kind === cfg.kind && (!cfg.category || e.category === cfg.category))
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
      .slice(0, n)
    const where = [r.name || r.id, cfg.label || cfg.kind].filter(Boolean).join(' · ')
    if (!rows.length) return `【${where}】还没有任何记录：这次是第一次，操作完记得写第一条日志。`
    if (cfg.full === true) {
      return [
        `【${where}：全部 ${rows.length} 条已全文注入（不必再调工具去翻）】`,
        ...rows.map((e) => {
          let body = ''
          try { body = (readEntry(e.id) || {}).body || e.body || '' } catch { body = e.body || '' }
          return `\n### ${e.title}（id ${e.id}）\n${body}`
        }),
      ].join('\n')
    }
    return [
      `【${where}：最近 ${rows.length} 条，最新在前（已自动读入，不必再调工具去翻）】`,
      ...rows.map((e) => `- ${localTime(e.updated)}《${e.title}》${excerpt(e.body, 120)}`),
      '要看某条全文用 memory_read <id>；更早的记录用 memory_search。',
    ].join('\n')
  } catch {
    return ''
  }
}

/* ── 存储 ────────────────────────────────────────────────────── */

export function readStore() {
  ensureDirs()
  const s = readJson(STORE, null)
  if (s && typeof s === 'object') return { mode: s.mode === 'auto' ? 'auto' : 'manual', sessions: s.sessions || {} }
  return { mode: 'manual', sessions: {} }
}

function writeStore(s) {
  writeJson(STORE, s)
}

export function roleOf(sessionId) {
  const s = readStore()
  const hit = s.sessions[sessionId]
  return hit ? hit.role : null
}

export function allRoles() {
  ensureDirs()
  const map = new Map(BUILTIN_ROLES.map((r) => [r.id, r]))
  let files = []
  try {
    files = fs.readdirSync(USER_ROLES).filter((f) => f.endsWith('.json'))
  } catch {}
  for (const f of files) {
    const r = readJson(path.join(USER_ROLES, f), null)
    if (r && r.id && r.name && !map.has(r.id)) map.set(r.id, { icon: '✦', color: '#8b949e', prompt: '', ...r })
  }
  return [...map.values()]
}

/** 无角色固定排最后（其余保持内置/自定义原序）。 */
const noneLast = (a, b) => (a.id === 'none' ? 1 : 0) - (b.id === 'none' ? 1 : 0)

export function roleMeta() {
  return allRoles()
    .slice()
    .sort(noneLast)
    .map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, tagline: r.tagline, kind: r.kind || r.id }))
}

export function rolePrompt(id) {
  const r = allRoles().find((x) => x.id === id)
  // 没选角色 / 「无角色」都不套人格，但文件能力是工具约定、不是人格，仍然注入
  if (!r || id === 'none') return FILES
  const own = r.files || ROLE_FILES[r.kind] || ROLE_FILES[r.id] || ''
  return [r.prompt, roleDigest(r), COMMON, FILES, own].filter(Boolean).join('\n\n')
}

/** 关键词自动判角色。确定性、零成本；以后可以换成本地模型。 */
const AUTO_RULES = [
  ['programmer', /(代码|编程|函数|报错|bug|编译|脚本|python|javascript|typescript|rust|java|c\+\+|api|git|docker|react|后端|前端|部署|重构|单元测试|算法)/i],
  ['professor', /(物理|化学|生物|数学|微积分|导数|积分|力学|电磁|量子|化学键|有机|细胞|遗传|概率|线性代数|证明|定理|公式|习题|考试|知识点)/],
  ['mentor', /(人生|难过|焦虑|迷茫|压力|情绪|孤独|分手|意义|选择|后悔|害怕|失眠|心理咨询|哲学|我是谁|活着)/],
  ['modeler', /(建模|模型|blender|网格|拓扑|材质|渲染|导出|obj|stl|glb|尺寸|比例|雕刻)/i],
  ['searcher', /(搜索|搜一下|帮我找|查一下|资料|论文|最新|下载|爬|整理|来源|链接)/],
  ['plugin-smith', /(插件|plugin|扩展功能|写个工具|做个功能)/i],
]

export function detectRole(text) {
  const t = String(text || '')
  let best = null
  let bestScore = 0
  for (const [role, re] of AUTO_RULES) {
    const m = t.match(new RegExp(re.source, 'gi'))
    const score = m ? m.length : 0
    if (score > bestScore) {
      bestScore = score
      best = role
    }
  }
  return bestScore > 0 ? best : 'none'
}

/* ── 插件 ────────────────────────────────────────────────────── */

/** @type {import('@deepseek-ai/cordis').Plugin} */
function apply(ctx) {
  ensureDirs()

  const setRole = (sessionId, roleId) => {
    if (!allRoles().some((r) => r.id === roleId)) throw new Error(`没有这个角色：${roleId}`)
    const s = readStore()
    s.sessions[sessionId] = { role: roleId, at: new Date().toISOString() }
    writeStore(s)
    return roleId
  }

  const lastUser = new Map()

  const fibers = new Map()
  const install = (agent) => {
    const sid = agent.session?.id
    if (!sid || fibers.has(agent)) return
    try {
      const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({
          name: 'chat-atlas:role',
          order: 8500,
          interpolate: false,
          text: () => rolePrompt(roleOf(sid)),
        })
      })
      fibers.set(agent, fiber)
    } catch (e) {
      ctx.logger?.warn?.(`chat-atlas: role section failed: ${e?.message || e}`)
    }
  }
  for (const agent of ctx.get?.('agents')?.list?.() || []) install(agent)
  ctx.on('agent/created', ({ agent }) => install(agent))
  ctx.on('agent/disposed', ({ agent }) => {
    fibers.get(agent)?.dispose?.()
    fibers.delete(agent)
  })

  ctx.on('agent/pre-step', ({ messages }, next) => {
    const agent = ctx.get?.('agents')?.currentInitiator?.()
    if (!agent) return next()
    const user = Array.isArray(messages) ? messages.filter((m) => m?.source?.kind === 'user') : []
    if (user.length) {
      const text = user.map((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ') : '')).join(' ')
      lastUser.set(agent, text)
      const sid = agent.session.id
      const store = readStore()
      if (store.mode === 'auto' && !roleOf(sid) && text.trim()) {
        const picked = detectRole(text)
        try {
          setRole(sid, picked)
        } catch {}
      }
    }
    return next()
  })

  ctx.tools.register(tool({
    name: 'role_set',
    description: '给当前会话切换角色。可选：programmer（编程老师）/coder（程序员）/professor/mentor/modeler/searcher/plugin-smith/none，或用户自定义角色 id。',
    parameters: {
      role: { type: 'string', required: true, description: '角色 id' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: v.message || v.role || '' }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('需要一个会话')
      if (!allRoles().some((r) => r.id === args.role)) {
        return { ok: false, role: args.role, message: `没有这个角色。可用：${allRoles().map((r) => r.id).join(', ')}` }
      }
      setRole(exec.agent.session.id, args.role)
      return { ok: true, role: args.role, message: `已切换到「${allRoles().find((r) => r.id === args.role).name}」` }
    },
  }))

  ctx.tools.register(tool({
    name: 'role_get',
    description: '查当前会话的角色，以及手动/自动选择模式。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: v.message || '' }],
    },
    execute(_args, exec) {
      const store = readStore()
      const role = exec.agent ? roleOf(exec.agent.session.id) : null
      return { ok: true, role: role || '', mode: store.mode, message: `角色：${role || '未选择'}；模式：${store.mode === 'auto' ? '自动' : '手动'}` }
    },
  }))

  ctx.tools.register(tool({
    name: 'role_list',
    description: '列出所有可用角色（含用户自定义）。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: v.message || '' }],
    },
    execute() {
      const roles = allRoles()
      return { ok: true, roles: roleMeta(), message: roles.map((r) => `${r.id}：${r.name} — ${r.tagline}`).join('\n') }
    },
  }))

  ctx.tools.register(tool({
    name: 'role_mode',
    description: '切换角色选择模式：manual=每次新建会话手动选；auto=根据第一句话自动判断。',
    parameters: { mode: { type: 'string', required: true, enum: ['manual', 'auto'] } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: v.message || '' }],
    },
    execute(args) {
      const s = readStore()
      s.mode = args.mode
      writeStore(s)
      return { ok: true, mode: s.mode, message: `已切换到${args.mode === 'auto' ? '自动' : '手动'}选择` }
    },
  }))

  ctx.tools.register(tool({
    name: 'role_create',
    description: '新建一个自定义角色，之后会出现在角色选择界面。用在用户明确要求加一个新角色时。',
    parameters: {
      id: { type: 'string', required: true, description: '英文小写 id' },
      name: { type: 'string', required: true },
      icon: { type: 'string', description: '一个字符或短符号' },
      color: { type: 'string', description: '#RRGGBB' },
      tagline: { type: 'string', description: '一句话介绍' },
      prompt: { type: 'string', required: true, description: '这个角色的人格与行为准则，写给模型看' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: v.message || '' }],
    },
    execute(args) {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(args.id)) return { ok: false, message: 'id 只能用小写字母、数字、连字符' }
      if (BUILTIN_ROLES.some((r) => r.id === args.id)) return { ok: false, message: '不能覆盖内置角色' }
      ensureDirs()
      writeJson(path.join(USER_ROLES, `${args.id}.json`), {
        id: args.id,
        name: args.name,
        icon: args.icon || '✦',
        color: args.color || '#8b949e',
        tagline: args.tagline || '',
        kind: args.id,
        prompt: args.prompt,
      })
      return { ok: true, message: `已新建角色「${args.name}」` }
    },
  }))

  /* ── 给 UI 用的 HTTP 路由 ─────────────────────────────────── */
  ctx.inject(['webServer'], (scope) => {
    const routes = scope.webServer
    const send = (res, code, obj) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(obj))
    }
    const body = (req) => new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
        if (raw.length > 1e6) req.destroy()
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'))
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })

    const route = (p, fn) => scope.effect(() => routes.register({
      kind: 'exact',
      path: p,
      handler: async (req, res) => {
        try {
          await fn(req, res)
        } catch (e) {
          send(res, 500, { ok: false, message: String(e?.message || e) })
        }
      },
    }), `chat-atlas route ${p}`)

    route('/atlas/state', async (req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      const sid = url.searchParams.get('sessionId') || ''
      const store = readStore()
      const role = sid ? roleOf(sid) : null
      send(res, 200, { ok: true, mode: store.mode, role, roles: roleMeta(), progress: progressReport() })
    })

    route('/atlas/role', async (req, res) => {
      const payload = await body(req)
      const sid = String(payload.sessionId || '')
      if (!sid) return send(res, 400, { ok: false, message: '缺少 sessionId' })
      try {
        setRole(sid, String(payload.role || ''))
        send(res, 200, { ok: true, role: payload.role })
      } catch (e) {
        send(res, 200, { ok: false, message: String(e.message || e) })
      }
    })

    route('/atlas/mode', async (req, res) => {
      const payload = await body(req)
      const s = readStore()
      s.mode = payload.mode === 'auto' ? 'auto' : 'manual'
      writeStore(s)
      send(res, 200, { ok: true, mode: s.mode })
    })

    route('/atlas/graph', async (req, res) => {
      const entries = listEntries()
      const ids = new Set(entries.map((e) => e.id))
      const edges = []
      for (const e of entries) for (const l of e.links || []) if (ids.has(l)) edges.push({ a: e.id, b: l })
      send(res, 200, {
        ok: true,
        nodes: entries.map((e) => ({ id: e.id, title: e.title, kind: e.kind, subject: e.subject, tags: e.tags })),
        edges,
      })
    })

    route('/atlas/browse', async (req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      const data = browse(url.searchParams.get('path') || '')
      send(res, 200, data ? { ok: true, ...data } : { ok: false, message: '目录不存在' })
    })

    route('/atlas/entry', async (req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      const e = readEntry(url.searchParams.get('id') || '')
      send(res, 200, e ? {
        ok: true,
        entry: { id: e.id, title: e.title, kind: e.kind, body: e.body, tags: e.tags, attachments: e.attachments || [] },
      } : { ok: false })
    })

    // 附件原文件：/atlas/file?id=<条目 id>&name=<文件名>（?download=1 强制下载）
    route('/atlas/file', async (req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      const file = resolveAttachment(url.searchParams.get('id') || '', url.searchParams.get('name') || '')
      if (!file) {
        res.statusCode = 404
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('没有这个附件')
        return
      }
      const name = path.basename(file)
      const dl = url.searchParams.get('download') === '1'
      res.statusCode = 200
      res.setHeader('content-type', mimeOf(name))
      res.setHeader('content-disposition', `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`)
      fs.createReadStream(file).on('error', () => res.end()).pipe(res)
    })
  })
}

export { apply, inject, name }
