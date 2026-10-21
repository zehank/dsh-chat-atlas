/**
 * memory_update 丢掉条目的回归测试（2026-10-20 事故）。
 * 跑：node scripts/test-memory-update.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_ATLAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'))
const core = await import('../host/core.js')

// 1) 建一条
const rec = core.writeEntry({ title: '测试条目', body: '第一版', kind: 'plugins' })
assert.ok(fs.existsSync(rec.file), '写入后文件应在')

// 2) 标题不变、只改正文：文件必须还在（旧版会把它删掉）
const up1 = core.updateEntry(rec.id, { content: '第二版' })
assert.ok(fs.existsSync(up1.file), '同标题更新后文件不能被删')
assert.equal(core.readEntry(rec.id).body, '第二版', '正文应更新')
assert.equal(up1.file, rec.file, '标题没变 → 路径不应变')

// 3) 改标题：旧文件清掉，新文件在，id 不变
const up2 = core.updateEntry(rec.id, { title: '改了标题', content: '第三版' })
assert.notEqual(up2.file, rec.file, '标题变了 → 路径应跟着变')
assert.ok(!fs.existsSync(rec.file), '旧文件应被清理')
assert.ok(fs.existsSync(up2.file), '新文件应在')
assert.equal(up2.id, rec.id, 'id 不变')
assert.equal(core.readEntry(rec.id).title, '改了标题')

// 4) 不存在的 id 返回 null
assert.equal(core.updateEntry('nope-000000', { content: 'x' }), null)

fs.rmSync(process.env.DSH_ATLAS_HOME, { recursive: true, force: true })
console.log('✓ memory_update 不再丢条目（同标题 / 改标题 / 缺 id）')
