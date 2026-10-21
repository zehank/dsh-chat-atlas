/**
 * chat-atlas / core —— 三个插件共用的底座。
 *
 * 记忆 = 磁盘上的 markdown（frontmatter + 正文），索引是派生缓存。
 * 这里只做四件事：路径与目录、条目读写、索引与检索、理科大纲。
 * 不依赖 Cordis，纯 Node。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const HOME = process.env.DSH_ATLAS_HOME || path.join(os.homedir(), '.dsh', 'chat-atlas')
export const MEM = path.join(HOME, 'memory')
export const META = path.join(HOME, 'meta')
export const USER_ROLES = path.join(HOME, 'roles')

export const SUBJECTS = ['math', 'physics', 'chemistry', 'biology']
export const SUBJECT_ZH = { math: '数学', physics: '物理', chemistry: '化学', biology: '生物' }

/** 记忆分区：id → 目录与说明。custom:<name> 是用户自建类别。 */
export const KINDS = {
  programming: { dir: 'programming knowledge base', label: 'programming knowledge base', hint: '编程实力参考：能力评估 + 已掌握的概念、语言特性、工具用法' },
  science: { dir: 'science knowledge base', label: 'science knowledge base', hint: '理科实力参考：能力评估 + 已学会的知识点（按科目分目录）' },
  'library-science': { dir: 'library-science', label: '理科图书馆', hint: '外部下载的理科资料（按科目分目录，不重复收录）' },
  'library-philosophy': { dir: 'library-philosophy', label: '哲学图书馆', hint: '哲学文本与思想（按流派/主题自分类）' },
  portrait: { dir: 'portrait', label: '我的形象', hint: '关于用户的画像：性格、经历、目标、偏好' },
  'modeling-preference': { dir: 'modeling/preferences', label: '建模要求与偏好', hint: '建模风格、比例、导出格式、硬性要求' },
  'modeling-work': { dir: 'modeling/works', label: '建模成品', hint: '已完成模型的可复用登记（含源文件路径与标签）' },
  plugins: { dir: 'plugins', label: '自制插件库', hint: '每个自研插件的档案：包名、行 id、工具、路由、依赖与兼容注意' },
  inbox: { dir: 'inbox', label: '待分类', hint: '还没决定归类的记忆' },
  custom: { dir: 'custom', label: '自定义类别', hint: '用户自建的记忆类别' },
}

/**
 * 动态馆：用户要的「匹配不上就新建一个馆」，而不是都塞进 custom。
 * 任何 library-<slug> 都能当一级馆（library-science 是内置的，按科目分）。
 * 新建的馆登记在 meta/libraries.json，重启后自动装回 KINDS。
 */
const LIBS_FILE = path.join(META, 'libraries.json')

export function loadLibraries() {
  try {
    const extra = JSON.parse(fs.readFileSync(LIBS_FILE, 'utf8'))
    for (const [kind, def] of Object.entries(extra)) {
      if (kind.startsWith('library-')) KINDS[kind] = { dir: kind, label: def.label || kind, hint: def.hint || '' }
    }
  } catch {}
}

export function libraryKind(kind) {
  return typeof kind === 'string' && kind.startsWith('library-') && kind !== 'library-science'
}

export function registerLibrary(kind, label, hint = '') {
  if (!libraryKind(kind)) throw new Error(`不是可新建的馆名：${kind}（要 library-<英文主题>）`)
  KINDS[kind] = { dir: kind, label: label || kind, hint }
  let extra = {}
  try {
    extra = JSON.parse(fs.readFileSync(LIBS_FILE, 'utf8'))
  } catch {}
  extra[kind] = { label: label || kind, hint }
  fs.mkdirSync(META, { recursive: true })
  fs.writeFileSync(LIBS_FILE, JSON.stringify(extra, null, 2), 'utf8')
  fs.mkdirSync(path.join(MEM, kind), { recursive: true })
  invalidate()
  return KINDS[kind]
}

loadLibraries()

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store'])

export function ensureDirs() {
  fs.mkdirSync(MEM, { recursive: true })
  fs.mkdirSync(META, { recursive: true })
  fs.mkdirSync(USER_ROLES, { recursive: true })
  for (const kind of Object.values(KINDS)) fs.mkdirSync(path.join(MEM, kind.dir), { recursive: true })
  for (const s of SUBJECTS) {
    fs.mkdirSync(path.join(MEM, KINDS.science.dir, s), { recursive: true })
    fs.mkdirSync(path.join(MEM, KINDS['library-science'].dir, s), { recursive: true })
  }
  // 迁移：目录改名后，旧的空目录可能被旧版进程重新建出来（连空子目录一起）。
  // 只在整个旧目录里一条 .md 条目都没有时才删，避免误伤数据。
  const live = new Set(Object.values(KINDS).map((k) => k.dir))
  for (const legacy of ['science', 'programming']) {
    if (live.has(legacy)) continue
    const p = path.join(MEM, legacy)
    try {
      if (fs.statSync(p).isDirectory() && walkMarkdown(p).length === 0) fs.rmSync(p, { recursive: true, force: true })
    } catch {}
  }
}

/* ── frontmatter ─────────────────────────────────────────────── */

function parseList(raw) {
  const s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  return s ? [s.replace(/^["']|["']$/g, '')] : []
}

export function parseEntry(text) {
  const meta = {}
  let body = text
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end > 0) {
      const raw = text.slice(3, end).trim()
      body = text.slice(text.indexOf('\n', end + 1) + 1)
      for (const line of raw.split('\n')) {
        const i = line.indexOf(':')
        if (i < 0) continue
        const key = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (key === 'tags' || key === 'links') meta[key] = parseList(value)
        else meta[key] = value.replace(/^["']|["']$/g, '')
      }
    }
  }
  return { meta, body: body.trim() }
}

function yamlValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]`
  return JSON.stringify(String(v ?? ''))
}

export function renderEntry(e) {
  const lines = ['---']
  for (const key of ['id', 'title', 'kind', 'subject', 'category', 'source', 'created', 'updated']) {
    if (e[key] !== undefined && e[key] !== '') lines.push(`${key}: ${yamlValue(e[key])}`)
  }
  lines.push(`tags: ${yamlValue(e.tags || [])}`)
  lines.push(`links: ${yamlValue(e.links || [])}`)
  lines.push('---', '', e.body || '', '')
  return lines.join('\n')
}

/* ── 路径 ────────────────────────────────────────────────────── */

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'entry'
}

export function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

/** kind/subject/category → 相对目录。注意目录名不一定等于 kind，一律走 KINDS[kind].dir。 */
export function kindDir(kind, subject, category) {
  const def = KINDS[kind]
  if (!def) throw new Error(`未知记忆类别：${kind}`)
  if (kind === 'science' || kind === 'library-science') {
    if (!SUBJECTS.includes(subject)) throw new Error(`理科分科必须是 ${SUBJECTS.join('/')}`)
    return path.join(def.dir, subject)
  }
  if (kind === 'library-philosophy' || libraryKind(kind)) return path.join(def.dir, slug(category || 'general'))
  if (kind === 'custom') {
    if (!category) throw new Error('自定义类别需要 category')
    return path.join(def.dir, slug(category))
  }
  return def.dir
}

/* ── 索引 ────────────────────────────────────────────────────── */

let cache = { at: 0, entries: [] }

export function walkMarkdown(dir, out = []) {
  let names
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of names) {
    if (IGNORE.has(d.name)) continue
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walkMarkdown(p, out)
    else if (d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('_')) out.push(p)
  }
  return out
}

export function relKind(file) {
  const rel = path.relative(MEM, file).split(path.sep)
  // 目录名不一定等于 kind（例如理科馆的目录已改成 'science knowledge base'），按 dir 反查
  const found = Object.entries(KINDS).find(([, v]) => v.dir === rel[0])
  const kind = found ? found[0] : null

  if (kind === 'science' || kind === 'library-science') {
    // 直接放在馆根下的条目（如整馆能力评估）不属于任何分科，别把文件名当分科
    return { kind, subject: SUBJECTS.includes(rel[1]) ? rel[1] : undefined }
  }
  if (kind === 'library-philosophy' || (kind && libraryKind(kind))) {
    return { kind, category: rel[1] }
  }
  if (rel[0] === 'custom') return { kind: 'custom', category: rel[1] }
  if (rel[0] === 'modeling') return { kind: rel[1] === 'works' ? 'modeling-work' : 'modeling-preference' }
  return { kind: kind || 'inbox' }
}

export function listEntries({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < 4000) return cache.entries
  const entries = []
  for (const file of walkMarkdown(MEM)) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    let head = ''
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(4096)
      const n = fs.readSync(fd, buf, 0, 4096, 0)
      fs.closeSync(fd)
      head = buf.slice(0, n).toString('utf8')
    } catch {
      continue
    }
    const { meta, body } = parseEntry(head)
    const loc = relKind(file)
    entries.push({
      id: meta.id || path.basename(file, '.md'),
      title: meta.title || path.basename(file, '.md'),
      kind: meta.kind || loc.kind,
      subject: meta.subject || loc.subject,
      category: meta.category || loc.category,
      tags: meta.tags || [],
      links: meta.links || [],
      source: meta.source || '',
      created: meta.created || '',
      updated: meta.updated || stat.mtime.toISOString(),
      body: body.slice(0, 600),
      file,
    })
  }
  cache = { at: Date.now(), entries }
  return entries
}

export function invalidate() {
  cache = { at: 0, entries: [] }
}

/* ── 检索：CJK 1/2/3-gram + 拉丁词，BM25 + 词面加成 + 图扩散 ──── */

export function tokenize(text) {
  const out = []
  const low = String(text || '').toLowerCase()
  for (const m of low.matchAll(/[a-z0-9_+#.]{2,}/g)) out.push(m[0])
  for (const m of low.matchAll(/[\u4e00-\u9fff]+/g)) {
    const s = m[0]
    for (let i = 0; i < s.length; i++) out.push(s[i])
    for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2))
    for (let i = 0; i + 2 < s.length; i++) out.push(s.slice(i, i + 3))
  }
  return out
}

/** 让「原句里出现过这个词」比零散命中更强。 */
function phraseBonus(e, raw) {
  const q = String(raw || '').trim().toLowerCase()
  if (q.length < 2) return 1
  let k = 1
  if (e.title.toLowerCase().includes(q)) k += 0.5
  for (const t of e.tags || []) {
    const tag = String(t).toLowerCase()
    if (q.includes(tag) && tag.length >= 2) { k += 0.35; break }
  }
  return k
}

export function search(query, { limit = 6, kinds, expand = true, boost } = {}) {
  const entries = listEntries()
  const q = tokenize(query)
  if (!q.length) return []
  const N = entries.length || 1
  const df = new Map()
  const docs = entries.map((e) => {
    const title = tokenize(e.title)
    const tags = tokenize(e.tags.join(' '))
    const body = tokenize(e.body)
    const tf = new Map()
    const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w)
    for (const t of title) add(t, 5)
    for (const t of tags) add(t, 3)
    for (const t of body) add(t, 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
    return { e, tf, len: title.length + tags.length + body.length }
  })
  const avg = docs.reduce((a, d) => a + d.len, 0) / N || 1
  const k1 = 1.4
  const b = 0.75
  const scored = []
  for (const d of docs) {
    if (kinds && !kinds.includes(d.e.kind)) continue
    let score = 0
    for (const t of q) {
      const f = d.tf.get(t)
      if (!f) continue
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)))
    }
    if (score <= 0) continue
    score *= phraseBonus(d.e, query)
    if (boost && boost[d.e.kind]) score *= boost[d.e.kind]
    // 最近更新过的轻微加权，避免老条目永远压住新结论
    const age = Date.now() - Date.parse(d.e.updated || 0)
    if (Number.isFinite(age)) score *= 1 + Math.max(0, 0.08 - age / (1000 * 60 * 60 * 24 * 365) * 0.08)
    scored.push({ ...d.e, score })
  }
  scored.sort((a, b2) => b2.score - a.score)

  // 一跳图扩散：命中条目的 links 邻居按 0.45 倍分补进来
  if (expand && scored.length) {
    const byId = new Map(entries.map((e) => [e.id, e]))
    const seen = new Set(scored.map((s) => s.id))
    const extra = []
    for (const hit of scored.slice(0, 3)) {
      for (const lid of hit.links || []) {
        if (seen.has(lid)) continue
        const t = byId.get(lid)
        if (!t) continue
        seen.add(lid)
        extra.push({ ...t, score: hit.score * 0.45, via: hit.id })
      }
    }
    scored.push(...extra)
    scored.sort((a, b2) => b2.score - a.score)
  }
  return scored.slice(0, limit)
}

/* ── 语义索引（embedding 缓存，派生数据） ───────────────────── */

export const EMB_MODEL = 'multilingual-e5-small'
const EMB_FILE = path.join(META, 'embeddings.json')
let embCache = null

export function loadEmbeddings() {
  if (embCache) return embCache
  const j = readJson(EMB_FILE, null)
  embCache = j && j.model === EMB_MODEL && j.items ? j : { model: EMB_MODEL, dim: 384, items: {} }
  return embCache
}

export function saveEmbeddings(j) {
  embCache = j
  writeJson(EMB_FILE, j)
}

/** 给还没有向量（或内容变了）的条目补向量，一次最多 limit 条。 */
export async function ensureEmbeddings(embedFn, { limit = 400 } = {}) {
  const entries = listEntries()
  const store = loadEmbeddings()
  let changed = 0
  let n = 0
  for (const e of entries) {
    if (n >= limit) break
    const rec = store.items[e.id]
    if (rec && rec.h === e.updated && rec.v) continue
    const text = `${e.title}\n${(e.tags || []).join(' ')}\n${e.body.slice(0, 400)}`
    const v = await embedFn(text, { type: 'passage' })
    if (!v) break
    store.items[e.id] = { h: e.updated, v }
    changed++
    n++
    if (n % 15 === 0) saveEmbeddings(store)
  }
  if (changed) saveEmbeddings(store)
  return changed
}

/** 向量最近邻（余弦，向量已归一化）。 */
export function semanticTop(vec, { limit = 6, kinds } = {}) {
  if (!vec || !vec.length) return []
  const store = loadEmbeddings()
  const out = []
  for (const e of listEntries()) {
    if (kinds && !kinds.includes(e.kind)) continue
    const rec = store.items[e.id]
    if (!rec || !rec.v) continue
    let dot = 0
    const n = Math.min(vec.length, rec.v.length)
    for (let i = 0; i < n; i++) dot += vec[i] * rec.v[i]
    out.push({ ...e, score: dot })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

/** 倒数排名融合：词面 + 语义，两路都靠前的排最前。 */
export function fuseHybrid(lexical, semantic, limit = 6) {
  const byId = new Map()
  const add = (e, i) => {
    const cur = byId.get(e.id) || { ...e, rrf: 0 }
    cur.rrf += 1 / (60 + i)
    byId.set(e.id, cur)
  }
  lexical.forEach(add)
  semantic.forEach(add)
  return [...byId.values()].sort((a, b) => b.rrf - a.rrf).slice(0, limit)
}

/* ── 读写 ────────────────────────────────────────────────────── */

export function writeEntry({ id, title, body, kind, subject, category, tags = [], links = [], source = '', created }) {
  ensureDirs()
  const dir = path.join(MEM, kindDir(kind, subject, category))
  fs.mkdirSync(dir, { recursive: true })
  const eid = id || newId()
  const now = new Date().toISOString()
  const file = path.join(dir, `${slug(title)}-${eid.slice(-6)}.md`)
  const record = {
    id: eid, title, kind, subject, category, source,
    tags, links, created: created || now, updated: now, body,
  }
  fs.writeFileSync(file, renderEntry(record), 'utf8')
  invalidate()
  return { ...record, file }
}

/**
 * 原地更新一条记忆（id 不变）。
 *
 * 坑：writeEntry 返回的是**记录对象**，不是路径。旧版 memory_update 把返回值当字符串
 * 和 e.file 比，永远不相等，于是把刚写好的文件又删了（2026-10-20 丢了两次条目）。
 * 这里只比较 record.file，且路径相同绝不删。
 */
export function updateEntry(id, patch = {}) {
  const e = readEntry(id)
  if (!e) return null
  const title = patch.title || e.title
  const body = patch.content === undefined || patch.content === '' ? e.body : patch.content
  const record = writeEntry({
    id: e.id,
    title,
    body,
    kind: e.kind,
    subject: e.subject,
    category: e.category,
    tags: Array.isArray(patch.tags) ? patch.tags : e.tags,
    links: Array.isArray(patch.links) ? patch.links : e.links,
    source: patch.source ?? e.source,
    created: e.created,
  })
  if (record?.file && record.file !== e.file) fs.rmSync(e.file, { force: true })
  return record
}

export function readEntry(id) {
  const e = listEntries().find((x) => x.id === id)
  if (!e) return null
  const full = fs.readFileSync(e.file, 'utf8')
  const { body } = parseEntry(full)
  return { ...e, body }
}

export function folderTree() {
  const entries = listEntries()
  const counts = new Map()
  for (const e of entries) {
    const key = e.kind === 'custom' || e.kind === 'library-philosophy' || libraryKind(e.kind) ? `${e.kind}/${e.category}` : e.kind
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const rows = []
  for (const [kind, def] of Object.entries(KINDS)) {
    if (kind === 'science' || kind === 'library-science') {
      const perSubject = SUBJECTS.map((s) => ({ kind, subject: s, label: SUBJECT_ZH[s], count: countEntries(kind, s) }))
      // 直接放在馆根下的条目（如整馆的理科能力评估）不属于任何分科，单列「总览」
      const loose = entries.filter((e) => e.kind === kind && !SUBJECTS.includes(e.subject)).length
      const children = loose ? [{ kind, subject: null, label: '总览', count: loose }, ...perSubject] : perSubject
      const all = perSubject.reduce((a, c) => a + c.count, 0) + loose
      rows.push({ kind, label: def.label, count: all, children })
      continue
    }
    if (kind === 'custom' || kind === 'library-philosophy' || libraryKind(kind)) {
      const cats = [...counts.keys()].filter((k) => k.startsWith(kind + '/')).map((k) => k.split('/')[1])
      if (!cats.length) continue
      rows.push({ kind, label: def.label, count: cats.reduce((a, c) => a + (counts.get(`${kind}/${c}`) || 0), 0), children: cats.map((c) => ({ kind, category: c, label: c, count: counts.get(`${kind}/${c}`) || 0 })) })
      continue
    }
    rows.push({ kind, label: def.label, count: counts.get(kind) || 0 })
  }
  return rows
}

function countEntries(kind, subject) {
  return listEntries().filter((e) => e.kind === kind && e.subject === subject).length
}

/* ── 理科大纲与进度 ──────────────────────────────────────────── */

export const SYLLABUS = {
  math: [
    ['集合与逻辑', ['集合运算', '命题与量词', '充分必要条件', '数学归纳法']],
    ['函数', ['定义域与值域', '单调性与奇偶性', '指数函数', '对数函数', '三角函数与图像']],
    ['数列', ['等差等比', '递推与通项', '数列求和']],
    ['导数', ['极限直觉', '导数定义', '求导法则', '单调性与极值', '切线方程']],
    ['积分', ['不定积分', '定积分与面积', '换元与分部', '微积分基本定理']],
    ['线性代数', ['向量与线性组合', '矩阵运算', '行列式', '线性方程组', '特征值与特征向量']],
    ['概率统计', ['古典概型', '条件概率与贝叶斯', '随机变量与分布', '期望与方差', '参数估计']],
    ['微分方程', ['一阶可分离变量', '一阶线性方程', '二阶常系数线性']],
    ['复变与级数', ['复数运算', '泰勒与傅里叶级数', '留数定理入门']],
  ],
  physics: [
    ['力学', ['运动学', '牛顿三定律', '动量与冲量', '功与能量', '圆周运动', '万有引力']],
    ['振动与波', ['简谐振动', '波的传播', '干涉与衍射', '多普勒效应']],
    ['热学', ['温度与热量', '理想气体定律', '热力学第一定律', '熵与第二定律']],
    ['电磁学', ['静电场', '高斯定理', '电势与电容', '电流与电阻', '磁场与安培力', '电磁感应', '麦克斯韦方程组']],
    ['光学', ['几何光学', '干涉', '偏振']],
    ['近代物理', ['狭义相对论', '光电效应', '原子模型', '量子力学初步', '核物理']],
  ],
  chemistry: [
    ['物质结构', ['原子结构', '元素周期律', '化学键', '分子几何']],
    ['化学计量', ['摩尔与质量', '化学方程式配平', '溶液浓度', '产率计算']],
    ['反应原理', ['化学平衡', '反应速率', '酸碱理论', '氧化还原', '电化学']],
    ['热力学', ['焓与盖斯定律', '熵与吉布斯自由能']],
    ['有机化学', ['烃类', '官能团', '立体化学', '反应机理', '聚合物']],
    ['分析化学', ['滴定', '光谱分析', '色谱']],
  ],
  biology: [
    // 前 25 条是 2026-10-20 已标记的粗节点，id 不能动；后面按 AP Bio CED 8 units
    // + 人教高中生物（必修1/2 + 选择性必修1/2/3）补齐细项，总 60 条。
    ['分子基础', ['水与碳', '蛋白质', '核酸', '酶动力学', '代谢与ATP', '糖类与脂类', '氨基酸与肽键', '蛋白质结构层次', '酶抑制与调节', '生物大分子鉴定', '自由能与反应耦合']],
    ['细胞', ['细胞结构', '膜运输', '细胞呼吸', '光合作用', '细胞周期', '细胞器与内膜系统', '细胞骨架与细胞连接', '糖酵解', '三羧酸循环', '氧化磷酸化与化学渗透', '光反应与卡尔文循环', '有丝分裂与减数分裂', '细胞信号转导']],
    ['遗传', ['孟德尔定律', 'DNA复制', '转录与翻译', '基因表达调控', '突变与修复', '转录后加工与可变剪接', '表观遗传', '原核操纵子', '病毒与转座子', 'PCR与凝胶电泳', 'CRISPR基因编辑', '系谱分析']],
    ['进化', ['自然选择', '群体遗传', '物种形成', 'Hardy-Weinberg平衡', '系统发生与同源', '生命起源与内共生']],
    ['生理', ['神经传导', '循环系统', '免疫系统', '内分泌', '动作电位与突触', '体液免疫与细胞免疫', '血糖与体温调节', '肾脏与渗透调节', '呼吸与气体交换', '消化与吸收', '肌肉收缩', '植物激素与向性']],
    ['生态', ['种群', '群落', '能量流动', '种群增长模型', '碳氮循环', '生物多样性与保护', '种间关系']],
  ],
}

export function syllabusNodes(subject) {
  const groups = SYLLABUS[subject] || []
  const nodes = []
  for (const [group, items] of groups) for (const item of items) nodes.push({ id: `${subject}:${group}/${item}`, group, name: item })
  return nodes
}

const progressFile = path.join(META, 'progress.json')
export function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(progressFile, 'utf8'))
  } catch {
    return {}
  }
}

export function writeProgress(p) {
  ensureDirs()
  fs.writeFileSync(progressFile, JSON.stringify(p, null, 2), 'utf8')
}

export function progressReport() {
  const learned = readProgress()
  const out = []
  for (const s of SUBJECTS) {
    const nodes = syllabusNodes(s)
    const done = nodes.filter((n) => learned[n.id]).length
    out.push({ subject: s, label: SUBJECT_ZH[s], done, total: nodes.length, percent: nodes.length ? Math.round((done / nodes.length) * 100) : 0, doneIds: nodes.filter((n) => learned[n.id]).map((n) => n.id) })
  }
  return out
}

/* ── 小工具 ──────────────────────────────────────────────────── */

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

export function excerpt(s, n = 160) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ── 工具定义 ────────────────────────────────────────────────── */

/**
 * 本机 profile 里的插件解析不到 @deepseek-ai/dsh-tools（它只存在于 app.asar 里），
 * 所以这里自己把紧凑写法编译成工具注册表要的 JSON Schema。
 */
export function toJsonSchema(spec = {}) {
  const properties = {}
  const required = []
  for (const [key, field] of Object.entries(spec)) {
    const node = { type: field.type }
    if (field.description) node.description = field.description
    if (field.enum) node.enum = field.enum
    if (field.items) node.items = field.items
    properties[key] = node
    if (field.required) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export function tool(def) {
  const render = def.output?.render || ((_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : v?.message || (v?.ok === false ? '失败' : '完成') }])
  return {
    name: def.name,
    description: def.description,
    parameters: toJsonSchema(def.parameters),
    output: { schema: { type: 'object', additionalProperties: true }, render },
    execute: def.execute,
    ...(def.timeoutMs ? { timeoutMs: def.timeoutMs } : {}),
  }
}

/* ── 目录浏览（给记忆面板用） ─────────────────────────────────── */

const FOLDER_ICON = {
  programming: '🧑‍💻',
  science: '🔬',
  'library-science': '📚',
  'library-philosophy': '🏛️',
  portrait: '🪞',
  modeling: '🧊',
  plugins: '🧩',
  inbox: '📥',
  custom: '✨',
}

export function folderIcon(name) {
  return FOLDER_ICON[name] || '📁'
}

/** 列出某一层目录：子文件夹 + 本层条目。rel 为空表示根。 */
export function browse(rel = '') {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/\.{2,}/g, '').replace(/^\/+|\/+$/g, '')
  const dir = path.join(MEM, clean)
  if (!dir.startsWith(MEM)) return null
  let nodes
  try {
    nodes = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const folders = []
  const entries = []
  for (const d of nodes) {
    if (IGNORE.has(d.name) || d.name.startsWith('.')) continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) {
      folders.push({
        name: d.name,
        path: clean ? `${clean}/${d.name}` : d.name,
        icon: folderIcon(d.name),
        count: walkMarkdown(full).length,
      })
    } else if (d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('_')) {
      let head = ''
      try {
        const fd = fs.openSync(full, 'r')
        const buf = Buffer.alloc(2048)
        const n = fs.readSync(fd, buf, 0, 2048, 0)
        fs.closeSync(fd)
        head = buf.slice(0, n).toString('utf8')
      } catch {}
      const { meta } = parseEntry(head)
      const loc = relKind(full)
      entries.push({
        id: meta.id || path.basename(full, '.md'),
        title: meta.title || path.basename(full, '.md'),
        kind: meta.kind || loc.kind,
        tags: meta.tags || [],
        updated: meta.updated || '',
      })
    }
  }
  folders.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  entries.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
  const crumbs = [{ name: '记忆库', path: '' }]
  if (clean) {
    let acc = ''
    for (const seg of clean.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg
      crumbs.push({ name: seg, path: acc })
    }
  }
  return { path: clean, crumbs, folders, entries }
}
