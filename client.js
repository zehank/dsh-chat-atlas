/**
 * chat-atlas / client —— 角色选择条 + 记忆星图。
 *
 * 1) conversation.input.dock：没选角色时是六张卡，选了之后是一条角色徽章 + 角色特色面板。
 * 2) shell.overlay：右下角一个悬浮按钮，点开是记忆的力导向图（距离 = 相关度）。
 *
 * 数据全部来自宿主侧的 /atlas/* 路由，组件本身不碰会话状态。
 */
window.__ModuleLoader__.load({
  id: '@local/chat-atlas',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef, useMemo } = React

    const api = {
      async get(path) {
        const r = await fetch(path, { headers: { accept: 'application/json' } })
        return r.json()
      },
      async post(path, payload) {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return r.json()
      },
    }

    // 全部走 DSH 的主题 token，跟随明/暗色自动切换；不给深色兜底，避免浅色模式下白字白底
    const C = {
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      dim2: 'var(--dsw-alias-label-tertiary)',
      bg: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-interactive-bg-hover)',
      border: 'var(--dsw-alias-border-l2)',
      track: 'var(--dsw-alias-border-l1)',
      accent: 'var(--dsw-alias-brand-primary)',
      danger: 'var(--dsw-alias-state-error-primary)',
    }

    const KIND_COLOR = {
      programming: '#3fb950',
      science: '#58a6ff',
      'library-science': '#1f6feb',
      'library-philosophy': '#d2a8ff',
      'library-psychology': '#56d4dd',
      portrait: '#ff7b72',
      'modeling-preference': '#ffa657',
      'modeling-work': '#f0883e',
      inbox: '#8b949e',
      custom: '#e3b341',
    }

    const QUOTES = [
      ['你现在不需要一个答案，你需要的是承认自己已经知道的那件事。', '—— 提醒'],
      ['人不是被事情困住，是被自己对事情的看法困住。', '爱比克泰德《手册》'],
      ['你所抗拒的，会持续。', '荣格（常被误引，方向没错）'],
      ['把注意力放回你能控制的部分，其余的交给时间。', '斯多葛练习'],
      ['焦虑常常是想象力用错了地方。', '—— 提醒'],
      ['未经省察的人生不值得过。', '苏格拉底《申辩篇》'],
      ['你不是懒，你可能是累了，或者怕失败。分清这两件事。', '—— 提醒'],
    ]

    function quoteOfDay() {
      const d = new Date()
      return QUOTES[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % QUOTES.length]
    }

    function Bar({ pct, color }) {
      return h('div', {
        style: { height: 4, borderRadius: 2, background: C.track, overflow: 'hidden', flex: 1, minWidth: 40 },
      }, h('div', { style: { width: `${pct > 0 ? Math.max(2, pct) : 0}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s' } }))
    }

    function Card({ role, active, onPick }) {
      const [hover, setHover] = useState(false)
      return h('button', {
        onClick: () => onPick(role.id),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title: role.tagline,
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left',
          padding: '8px 9px', borderRadius: 10, cursor: 'pointer', boxSizing: 'border-box',
          border: `1px solid ${active || hover ? role.color : C.border}`,
          background: hover ? C.bg2 : 'transparent',
          color: C.text, minWidth: 0, transition: 'all .15s',
        },
      },
        h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' } },
          h('span', { style: { fontSize: 14, lineHeight: '18px', color: role.color, width: 18, textAlign: 'center', flex: 'none' } }, role.icon),
          h('span', { style: { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, role.name)),
        h('span', {
          style: {
            fontSize: 10, color: C.dim, lineHeight: '14px',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', maxWidth: '100%',
          },
        }, role.tagline))
    }

    function RoleExtras({ role, progress }) {
      if (role === 'professor' && Array.isArray(progress) && progress.length) {
        return h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 } },
          progress.map((p) => h('div', { key: p.subject, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 120, flex: '1 1 120px' } },
            h('span', { style: { fontSize: 11, color: C.dim, width: 26 } }, p.label),
            h(Bar, { pct: p.percent, color: C.accent }),
            h('span', { style: { fontSize: 10, color: C.dim, width: 30, textAlign: 'right' } }, `${p.percent}%`))))
      }
      if (role === 'mentor') {
        const [q, src] = quoteOfDay()
        return h('div', { style: { marginTop: 6, fontSize: 11, color: C.dim, lineHeight: '16px' } },
          h('span', { style: { color: C.accent } }, '今日 · '), q, h('span', { style: { opacity: .7 } }, ` ${src}`))
      }
      return null
    }

    function RoleBar({ sessionId }) {
      const [data, setData] = useState(null)
      const [open, setOpen] = useState(false)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const d = await api.get(`/atlas/state?sessionId=${encodeURIComponent(sessionId)}`)
          if (d && d.ok) {
            // 进度轮询每 5 秒一次：数据没变就不重渲染（角色面板要能被点，别每轮都闪）
            setData((prev) => {
              if (!prev) return d
              if (prev.role === d.role && prev.mode === d.mode) {
                const a = JSON.stringify(prev.progress || [])
                const b = JSON.stringify(d.progress || [])
                if (a === b && prev.roles?.length === d.roles?.length) return prev
              }
              return d
            })
            setErr('')
          } else setErr(d?.message || '记忆服务未就绪')
        } catch (e) {
          setErr('连接不到 chat-atlas 服务')
        }
      }, [sessionId])

      // 进度条要跟着 memory_mark_learned 自己动：每 5 秒拉一次 state，页面切回来时立刻拉一次
      useEffect(() => {
        load()
        const tick = () => { if (document.visibilityState !== 'hidden') load() }
        const timer = setInterval(tick, 5000)
        const onVis = () => { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVis)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVis)
        }
      }, [load])

      const pick = async (id) => {
        setBusy(true)
        try {
          const r = await api.post('/atlas/role', { sessionId, role: id })
          if (!r.ok) setErr(r.message || '设置失败')
          await load()
          setOpen(false)
        } finally {
          setBusy(false)
        }
      }

      const toggleMode = async () => {
        await api.post('/atlas/mode', { mode: data?.mode === 'auto' ? 'manual' : 'auto' })
        await load()
      }

      if (err && !data) return h('div', { style: { fontSize: 11, color: C.dim, padding: '2px' } }, `角色面板：${err}`)
      if (!data) return null

      const current = data.roles.find((r) => r.id === data.role)
      const showCards = !current || open
      const mode = data.mode === 'auto' ? '自动' : '手动'

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 2px 4px', fontSize: 12, color: C.text } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 } },
          current
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                h('span', { style: { color: current.color, fontSize: 14 } }, current.icon),
                h('span', { style: { fontWeight: 600 } }, current.name),
                h('span', { style: { color: C.dim, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current.tagline))
            : h('span', { style: { color: C.dim } }, '选一个角色开始这次会话'),
          h('div', { style: { flex: 1 } }),
          h('button', {
            onClick: toggleMode, title: '切换手动/自动选择',
            style: { fontSize: 11, color: C.dim, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 8px', cursor: 'pointer' },
          }, `${mode}选择`),
          current ? h('button', {
            onClick: () => setOpen(!open),
            style: { fontSize: 11, color: C.dim, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 8px', cursor: 'pointer' },
          }, open ? '收起' : '换角色') : null),

        showCards
          ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 } },
              [...data.roles].sort((a, b) => (a.id === 'none' ? 1 : 0) - (b.id === 'none' ? 1 : 0)).map((r) => h(Card, { key: r.id, role: r, active: r.id === data.role, onPick: busy ? () => {} : pick })))
          : h(RoleExtras, { role: data.role, progress: data.progress }),

        err ? h('div', { style: { fontSize: 10, color: C.danger } }, err) : null)
    }

    /* ── 记忆星图（分层 + 相关度连线，Obsidian 风格）────────── */

    const SIZE_KEY = 'chat-atlas:panel-size'

    const FOLDER_COLOR = {
      programming: '#3fb950',
      science: '#58a6ff',
      'library-science': '#1f6feb',
      'library-philosophy': '#d2a8ff',
      'library-psychology': '#56d4dd',
      portrait: '#ff7b72',
      modeling: '#ffa657',
      plugins: '#7ee787',
      inbox: '#8b949e',
      custom: '#e3b341',
      math: '#58a6ff',
      physics: '#79c0ff',
      chemistry: '#56d4dd',
      biology: '#7ee787',
    }

    /** 从画布继承的 CSS 变量里解析颜色，跟随明暗主题 */
    function resolveColors(el) {
      let cs
      try { cs = window.getComputedStyle(el) } catch (e) { cs = null }
      const read = (name, fb) => (cs ? (cs.getPropertyValue(name) || '').trim() : '') || fb
      return {
        text: read('--dsw-alias-label-primary', '#e6edf3'),
        dim: read('--dsw-alias-label-secondary', '#8b949e'),
        faint: read('--dsw-alias-label-tertiary', '#6e7681'),
        edge: read('--dsw-alias-border-l2', '#8b949e'),
        surface: read('--dsw-alias-bg-layer-1', '#161b22'),
      }
    }

    function buildGraph(data) {
      const hub = { id: 'hub', label: (data.crumbs[data.crumbs.length - 1] || {}).name || '记忆库', kind: 'hub' }
      const nodes = [hub]
      const links = []
      const seen = new Set(['hub'])
      for (const f of data.folders) {
        const id = 'd:' + f.path
        if (seen.has(id)) continue
        seen.add(id)
        nodes.push({ id, label: f.name, kind: 'folder', path: f.path, count: f.count, color: FOLDER_COLOR[f.name] || '#8b949e' })
        links.push({ a: 'hub', b: id, type: 'tree' })
      }
      for (const e of data.entries) {
        const id = 'e:' + e.id
        if (seen.has(id)) continue
        seen.add(id)
        nodes.push({ id, label: e.title, kind: 'entry', eid: e.id, tags: e.tags || [], color: KIND_COLOR[e.kind] || '#8b949e' })
        links.push({ a: 'hub', b: id, type: 'tree' })
      }
      const index = new Map(nodes.map((n, i) => [n.id, i]))
      const items = nodes.filter((n) => n.kind === 'entry')
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (!items[i].tags.length || !items[j].tags.length) continue
          const shared = items[i].tags.filter((t) => items[j].tags.includes(t))
          if (!shared.length) continue
          links.push({ a: items[i].id, b: items[j].id, type: 'rel', w: shared.length })
        }
      }
      return { nodes, links, index }
    }

    function layoutGraph(g) {
      const n = g.nodes.length
      const pos = new Array(n)
      const golden = Math.PI * (3 - Math.sqrt(5))
      for (let i = 0; i < n; i++) {
        if (i === 0) { pos[i] = { x: 0, y: 0, vx: 0, vy: 0 }; continue }
        const r = 70 + Math.sqrt(i) * 34
        const a = i * golden
        pos[i] = { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 }
      }
      const tree = g.links.filter((l) => l.type === 'tree')
      const rel = g.links.filter((l) => l.type === 'rel')
      const ITER = 340
      for (let it = 0; it < ITER; it++) {
        const alpha = 1 - it / ITER
        for (let i = 1; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            let dx = pos[i].x - pos[j].x
            let dy = pos[i].y - pos[j].y
            let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1 }
            const d = Math.sqrt(d2)
            const f = Math.min(900, 2600 / d2)
            pos[i].vx += (dx / d) * f
            pos[i].vy += (dy / d) * f
            pos[j].vx -= (dx / d) * f
            pos[j].vy -= (dy / d) * f
          }
        }
        for (const l of tree) {
          const i = g.index.get(l.a)
          const j = g.index.get(l.b)
          const dx = pos[j].x - pos[i].x
          const dy = pos[j].y - pos[i].y
          const d = Math.hypot(dx, dy) || 1
          const f = (d - 92) * 0.07
          pos[j].vx -= (dx / d) * f
          pos[j].vy -= (dy / d) * f
          pos[i].vx += (dx / d) * f
          pos[i].vy += (dy / d) * f
        }
        for (const l of rel) {
          const i = g.index.get(l.a)
          const j = g.index.get(l.b)
          const dx = pos[j].x - pos[i].x
          const dy = pos[j].y - pos[i].y
          const d = Math.hypot(dx, dy) || 1
          const f = (d - 44) * 0.022 * Math.min(2, l.w)
          pos[j].vx -= (dx / d) * f
          pos[j].vy -= (dy / d) * f
          pos[i].vx += (dx / d) * f
          pos[i].vy += (dy / d) * f
        }
        for (let i = 1; i < n; i++) {
          pos[i].vx -= pos[i].x * 0.0035
          pos[i].vy -= pos[i].y * 0.0035
          pos[i].x += pos[i].vx * alpha * 0.65
          pos[i].y += pos[i].vy * alpha * 0.65
          pos[i].vx *= 0.55
          pos[i].vy *= 0.55
        }
      }
      return pos
    }

    function Browser({ onClose, side }) {
      const [path, setPath] = useState('')
      const [data, setData] = useState(null)
      const [graph, setGraph] = useState(null)
      const [detail, setDetail] = useState(null)
      const [hover, setHover] = useState(null)
      const [mode, setMode] = useState(() => {
        try {
          const v = window.localStorage.getItem('chat-atlas:view')
          if (v === 'list' || v === 'graph') return v
        } catch (e) {}
        return 'graph'
      })
      useEffect(() => {
        try { window.localStorage.setItem('chat-atlas:view', mode) } catch (e) {}
      }, [mode])
      const [rev, bump] = useState(0)
      const [err, setErr] = useState('')
      const [size, setSize] = useState(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem(SIZE_KEY) || 'null')
          if (saved && saved.w >= 300 && saved.h >= 300) return { w: saved.w, h: saved.h }
        } catch (e) {}
        return { w: 520, h: 600 }
      })
      const canvasRef = useRef(null)
      const posRef = useRef(null)
      const viewRef = useRef({ x: 0, y: 0, k: 1 })
      const dragRef = useRef(null)

      useEffect(() => {
        try { window.localStorage.setItem(SIZE_KEY, JSON.stringify(size)) } catch (e) {}
      }, [size])

      const load = useCallback(async (p) => {
        try {
          const d = await api.get(`/atlas/browse?path=${encodeURIComponent(p || '')}`)
          if (d && d.ok) {
            setData(d)
            setPath(d.path || '')
            setDetail(null)
            setErr('')
            const g = buildGraph(d)
            posRef.current = layoutGraph(g)
            viewRef.current = { x: 0, y: 0, k: 1 }
            setGraph(g)
          } else setErr(d?.message || '读不到这个目录')
        } catch (e) {
          setErr('连接不到记忆服务')
        }
      }, [])

      useEffect(() => { load('') }, [load])

      const up = () => {
        if (detail) {
          setDetail(null)
          return
        }
        const parts = path.split('/').filter(Boolean)
        parts.pop()
        load(parts.join('/'))
      }

      /* 自动缩放，把整张图放进画布 */
      useEffect(() => {
        if (!graph || !canvasRef.current) return
        const W = canvasRef.current.clientWidth
        const H = canvasRef.current.clientHeight
        const pos = posRef.current
        let minX = 0, maxX = 0, minY = 0, maxY = 0
        for (const p of pos) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
        }
        const bw = Math.max(120, maxX - minX)
        const bh = Math.max(120, maxY - minY)
        const k = Math.max(0.45, Math.min(1.6, Math.min((W - 90) / bw, (H - 80) / bh)))
        viewRef.current = { x: 0, y: 0, k }
        bump((n) => n + 1)
      }, [graph, size.w, size.h, mode])

      /* 绘制 */
      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !graph) return
        const dpr = window.devicePixelRatio || 1
        const W = canvas.clientWidth
        const H = canvas.clientHeight
        if (!W || !H) return
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
        const ctx2 = canvas.getContext('2d')
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx2.clearRect(0, 0, W, H)
        const col = resolveColors(canvas)
        const v = viewRef.current
        const pos = posRef.current
        const nbr = new Set()
        if (hover) {
          for (const l of graph.links) {
            if (l.a === hover) nbr.add(l.b)
            if (l.b === hover) nbr.add(l.a)
          }
        }
        ctx2.save()
        ctx2.translate(W / 2 + v.x, H / 2 + v.y)
        ctx2.scale(v.k, v.k)
        ctx2.lineCap = 'round'

        for (const l of graph.links) {
          const i = graph.index.get(l.a)
          const j = graph.index.get(l.b)
          if (i === undefined || j === undefined) continue
          const a = pos[i]
          const b = pos[j]
          const active = hover && (l.a === hover || l.b === hover)
          ctx2.globalAlpha = active ? 0.9 : l.type === 'rel' ? 0.28 : 0.35
          ctx2.strokeStyle = l.type === 'rel' ? col.faint : col.edge
          ctx2.lineWidth = (l.type === 'rel' ? 0.8 : 1.1) / v.k
          if (l.type === 'rel') ctx2.setLineDash([3 / v.k, 3 / v.k])
          else ctx2.setLineDash([])
          ctx2.beginPath()
          ctx2.moveTo(a.x, a.y)
          ctx2.lineTo(b.x, b.y)
          ctx2.stroke()
        }
        ctx2.setLineDash([])

        for (let i = 0; i < graph.nodes.length; i++) {
          const nd = graph.nodes[i]
          const p = pos[i]
          const dimmed = hover && hover !== nd.id && !nbr.has(nd.id)
          const r = nd.kind === 'hub' ? 9 : nd.kind === 'folder' ? 5 + Math.min(5, Math.sqrt(nd.count || 0) * 1.4) : 4
          ctx2.globalAlpha = dimmed ? 0.28 : 1
          ctx2.beginPath()
          ctx2.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx2.fillStyle = nd.kind === 'hub' ? col.text : nd.color
          ctx2.fill()
          if (nd.kind === 'hub' || hover === nd.id) {
            ctx2.strokeStyle = col.surface
            ctx2.lineWidth = 2 / v.k
            ctx2.stroke()
          }
          if (v.k > 0.4 && !dimmed) {
            ctx2.fillStyle = nd.kind === 'hub' ? col.text : col.dim
            ctx2.font = `${nd.kind === 'hub' ? 13 : nd.kind === 'folder' ? 11.5 : 10.5}px -apple-system, system-ui, sans-serif`
            ctx2.textBaseline = 'middle'
            const label = nd.label.length > 26 ? nd.label.slice(0, 25) + '…' : nd.label
            ctx2.fillText(label, p.x + r + 5 / v.k, p.y + 0.5)
          }
        }
        ctx2.globalAlpha = 1
        ctx2.restore()
      }, [graph, hover, rev, size.w, size.h, mode])

      const toWorld = (ev) => {
        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        const v = viewRef.current
        const W = rect.width
        const H = rect.height
        return {
          x: (ev.clientX - rect.left - W / 2 - v.x) / v.k,
          y: (ev.clientY - rect.top - H / 2 - v.y) / v.k,
        }
      }

      const hitNode = (ev) => {
        if (!graph || !posRef.current) return -1
        const w = toWorld(ev)
        const v = viewRef.current
        let best = -1
        let bd = Infinity
        for (let i = 0; i < graph.nodes.length; i++) {
          const p = posRef.current[i]
          const d = Math.hypot(p.x - w.x, p.y - w.y)
          const lim = (graph.nodes[i].kind === 'hub' ? 12 : 9) / Math.max(0.6, v.k)
          if (d < lim && d < bd) { bd = d; best = i }
        }
        return best
      }

      const onDown = (ev) => {
        if (ev.button !== 0) return
        const i = hitNode(ev)
        dragRef.current = { sx: ev.clientX, sy: ev.clientY, vx: viewRef.current.x, vy: viewRef.current.y, node: i, moved: false }
      }

      const onMove = (ev) => {
        const d = dragRef.current
        if (d && d.node >= 0 && d.moved) {
          const w = toWorld(ev)
          posRef.current[d.node].x = w.x
          posRef.current[d.node].y = w.y
          bump((n) => n + 1)
          return
        }
        if (d) {
          const dx = ev.clientX - d.sx
          const dy = ev.clientY - d.sy
          if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.moved) {
            viewRef.current.x = d.vx + dx
            viewRef.current.y = d.vy + dy
            viewRef.current = { ...viewRef.current }
            bump((n) => n + 1)
          }
          return
        }
        const i = hitNode(ev)
        const id = i >= 0 ? graph.nodes[i].id : null
        if (id !== hover) setHover(id)
      }

      const onUp = (ev) => {
        const d = dragRef.current
        dragRef.current = null
        if (!d || d.moved) return
        const i = hitNode(ev)
        if (i < 0) return
        const nd = graph.nodes[i]
        if (nd.kind === 'folder') load(nd.path)
        else if (nd.kind === 'entry') {
          api.get(`/atlas/entry?id=${encodeURIComponent(nd.eid)}`).then((r) => r && r.ok && setDetail(r.entry))
        }
      }

      /* React 的 onWheel 是 passive 的，preventDefault 无效，这里挂原生非 passive 监听 */
      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const onWheel = (ev) => {
          ev.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const v = viewRef.current
          const mx = ev.clientX - rect.left - rect.width / 2
          const my = ev.clientY - rect.top - rect.height / 2
          const k2 = Math.max(0.3, Math.min(4, v.k * (ev.deltaY > 0 ? 0.9 : 1.1)))
          viewRef.current = { k: k2, x: mx - ((mx - v.x) * k2) / v.k, y: my - ((my - v.y) * k2) / v.k }
          bump((n) => n + 1)
        }
        canvas.addEventListener('wheel', onWheel, { passive: false })
        return () => canvas.removeEventListener('wheel', onWheel)
      }, [graph, mode])

      const startResize = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const sx = e.clientX
        const sy = e.clientY
        const sw = size.w
        const sh = size.h
        const move = (ev) => {
          const w = Math.max(320, Math.min(window.innerWidth - 60, sw + (ev.clientX - sx)))
          const hh = Math.max(320, Math.min(window.innerHeight - 300, sh + (ev.clientY - sy)))
          setSize({ w, h: hh })
        }
        const stop = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', stop)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', stop)
      }

      const listRows = []
      if (mode === 'list' && data) {
        data.folders.forEach((f) => listRows.push(h('button', {
          key: 'd:' + f.path,
          onClick: () => load(f.path),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent',
            color: C.text, cursor: 'pointer', fontSize: 12,
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = C.bg2 },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
        },
          h('span', { style: { fontSize: 14, width: 18, textAlign: 'center' } }, f.icon || '📁'),
          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name),
          h('span', { style: { fontSize: 10, color: C.dim } }, String(f.count)),
          h('span', { style: { color: C.dim, fontSize: 12 } }, '›'))))

        data.entries.forEach((e) => listRows.push(h('button', {
          key: 'e:' + e.id,
          onClick: () => api.get(`/atlas/entry?id=${encodeURIComponent(e.id)}`).then((r) => r && r.ok && setDetail(r.entry)),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '6px 10px', borderRadius: 8, border: 'none', background: 'transparent',
            color: C.text, cursor: 'pointer', fontSize: 12,
          },
          onMouseEnter: (e2) => { e2.currentTarget.style.background = C.bg2 },
          onMouseLeave: (e2) => { e2.currentTarget.style.background = 'transparent' },
        },
          h('span', { style: { width: 8, height: 8, borderRadius: 4, flex: 'none', background: KIND_COLOR[e.kind] || '#8b949e' } }),
          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.title),
          e.tags.length ? h('span', { style: { fontSize: 10, color: C.dim, flex: 'none' } }, '#' + e.tags.slice(0, 2).join(' #')) : null)))

        if (!data.folders.length && !data.entries.length) {
          listRows.push(h('div', { key: 'empty', style: { padding: '14px 10px', fontSize: 11, color: C.dim } }, '这个文件夹还是空的。'))
        }
      }

      const canUp = !!detail || path !== ''
      return h('div', {
        style: {
          position: 'fixed', ...(side === 'left' ? { left: 24 } : { right: 24 }), bottom: 268, width: size.w, height: size.h, zIndex: 60,
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
        },
      },
        h('div', {
          onMouseDown: startResize,
          title: '拖动调整大小',
          style: {
            position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, zIndex: 2,
            cursor: 'nwse-resize',
            background: 'linear-gradient(135deg, transparent 52%, var(--dsw-alias-label-tertiary) 52%, var(--dsw-alias-label-tertiary) 62%, transparent 62%, transparent 72%, var(--dsw-alias-label-tertiary) 72%, var(--dsw-alias-label-tertiary) 82%, transparent 82%)',
          },
        }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}` } },
          h('button', {
            onClick: up, disabled: !canUp,
            title: '返回上一级',
            style: {
              background: 'transparent', border: 'none', fontSize: 15, lineHeight: '20px',
              color: canUp ? C.text : C.dim, opacity: canUp ? 1 : .35,
              cursor: canUp ? 'pointer' : 'default', padding: '0 4px',
            },
          }, '←'),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2, overflow: 'hidden' } },
            (data?.crumbs || [{ name: '记忆库', path: '' }]).map((c, i) => h('span', { key: c.path || 'root', style: { display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 } },
              i ? h('span', { style: { color: C.dim, fontSize: 10 } }, '/') : null,
              h('button', {
                onClick: () => load(c.path),
                style: {
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 12, color: i === (data?.crumbs || []).length - 1 ? C.text : C.dim,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
                },
              }, c.name)))),
          h('div', { style: { display: 'flex', gap: 2, marginRight: 2 } },
            [['list', '☰', '文件夹视图'], ['graph', '🕸', '网状图']].map(([m, icon, tip]) => h('button', {
              key: m,
              onClick: () => setMode(m),
              title: tip,
              style: {
                background: mode === m ? C.bg2 : 'transparent',
                border: `1px solid ${mode === m ? C.border : 'transparent'}`,
                color: mode === m ? C.text : C.dim,
                borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: '18px', padding: '0 6px',
              },
            }, icon))),
          h('button', {
            onClick: onClose,
            style: { background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 16, lineHeight: '16px' },
          }, '×')),

        h('div', { style: { position: 'relative', flex: 1, minHeight: 0, background: C.bg } },
          mode === 'graph'
            ? h('canvas', {
                ref: canvasRef,
                onMouseDown: onDown,
                onMouseMove: onMove,
                onMouseUp: onUp,
                onMouseLeave: () => { dragRef.current = null; if (hover) setHover(null) },
                style: { width: '100%', height: '100%', display: 'block', cursor: hover ? 'pointer' : 'grab' },
              })
            : h('div', { style: { position: 'absolute', inset: 0, overflowY: 'auto', padding: '6px' } }, listRows),
          err ? h('div', { style: { position: 'absolute', left: 10, top: 10, fontSize: 11, color: C.danger } }, err) : null,
          mode === 'graph' && graph && graph.nodes.length <= 1
            ? h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.dim, pointerEvents: 'none' } }, '这个文件夹还是空的。')
            : null,
          detail
            ? h('div', {
                style: {
                  position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: '52%', overflow: 'auto',
                  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px',
                  boxShadow: '0 8px 28px rgba(0,0,0,.35)',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
                  h('div', { style: { flex: 1, fontSize: 12.5, fontWeight: 600, color: C.text } }, detail.title),
                  h('button', {
                    onClick: () => setDetail(null),
                    style: { background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, lineHeight: '14px' },
                  }, '×')),
                h('div', { style: { fontSize: 10, color: C.dim, margin: '6px 0 8px' } },
                  detail.kind, detail.tags?.length ? ' · #' + detail.tags.join(' #') : ''),
                h('div', { style: { fontSize: 12, lineHeight: '19px', color: C.text, whiteSpace: 'pre-wrap' } }, detail.body || '（空）'))
            : null),

        h('div', { style: { padding: '6px 12px', fontSize: 10, color: C.dim, borderTop: `1px solid ${C.border}` } },
          mode === 'graph' ? '点文件夹进入下一层 · 拖动平移 · 滚轮缩放 · ← 返回上一级' : '点文件夹进入下一层 · ← 返回上一级'))
    }

    const BALL_KEY = 'chat-atlas:ball-pos'

    function AtlasBall() {
      const [open, setOpen] = useState(false)
      const [count, setCount] = useState(null)
      const [pos, setPos] = useState(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem(BALL_KEY) || 'null')
          if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y }
        } catch (e) {}
        return { x: window.innerWidth - 68, y: window.innerHeight - 244 }
      })
      const drag = useRef(null)
      const suppressClick = useRef(false)

      useEffect(() => {
        try { window.localStorage.setItem(BALL_KEY, JSON.stringify(pos)) } catch (e) {}
      }, [pos])

      useEffect(() => {
        const onResize = () => setPos((p) => ({
          x: Math.max(8, Math.min(window.innerWidth - 52, p.x)),
          y: Math.max(8, Math.min(window.innerHeight - 52, p.y)),
        }))
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      useEffect(() => {
        if (!open) return
        api.get('/atlas/graph').then((d) => d && d.ok && setCount(d.nodes.length)).catch(() => {})
      }, [open])
      useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      return h(React.Fragment, null,
        open ? h('div', {
          onMouseDown: () => setOpen(false),
          style: { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 58, background: 'transparent', pointerEvents: 'auto' },
        }) : null,
        h('button', {
          onMouseDown: (e) => {
            if (e.button !== 0) return
            e.preventDefault()
            drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false }
            const move = (ev) => {
              const d = drag.current
              if (!d) return
              const dx = ev.clientX - d.sx
              const dy = ev.clientY - d.sy
              if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
              if (!d.moved) return
              setPos({
                x: Math.max(8, Math.min(window.innerWidth - 52, d.ox + dx)),
                y: Math.max(8, Math.min(window.innerHeight - 52, d.oy + dy)),
              })
            }
            const up = () => {
              const moved = drag.current?.moved === true
              drag.current = null
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
              if (moved) {
                suppressClick.current = true
                // click 在 mouseup 之后立刻派发；这里延时清掉，避免拖到按钮外时吞掉下一次点击
                window.setTimeout(() => { suppressClick.current = false }, 0)
              }
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          },
          onClick: () => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            setOpen(!open)
          },
          title: '记忆库（可拖动）',
          style: {
            position: 'fixed', left: pos.x, top: pos.y, zIndex: 59,
            width: 44, height: 44, borderRadius: 22, cursor: 'grab',
            border: `1px solid ${C.border}`, background: C.bg, color: C.text,
            fontSize: 18, boxShadow: '0 6px 20px rgba(0,0,0,.35)',
            userSelect: 'none', touchAction: 'none',
          },
        }, open ? '×' : '🕸'),
        open ? h(Browser, { onClose: () => setOpen(false), side: pos.x + 22 < window.innerWidth / 2 ? 'left' : 'right' }) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'chat-atlas-role',
          order: 20,
          inject: (sessionId) => ({ props: { sessionId } }),
        }, RoleBar))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'chat-atlas-graph',
          order: 60,
        }, AtlasBall))
      },
    }
  },
})
