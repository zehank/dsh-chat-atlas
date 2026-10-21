/**
 * 让 @xenova/transformers 在 Node 下能 import：它顶层 require('sharp')，
 * 但我们只做文本 embedding，不需要图片处理。这里把 pnpm 装进来的 sharp
 * 换成一个空壳（只改 main 指向），避免它的原生二进制缺失导致整个模块加载失败。
 *
 *   pnpm install && node scripts/setup-sharp.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pnpmDir = path.join(root, 'node_modules', '.pnpm')
if (!fs.existsSync(pnpmDir)) {
  console.log('没有 node_modules/.pnpm，先跑 pnpm install')
  process.exit(1)
}
const targets = fs.readdirSync(pnpmDir)
  .filter((d) => d.startsWith('sharp@'))
  .map((d) => path.join(pnpmDir, d, 'node_modules', 'sharp'))
  .filter((p) => fs.existsSync(p))

if (!targets.length) {
  console.log('没找到 sharp 包，跳过')
  process.exit(0)
}
for (const dir of targets) {
  fs.writeFileSync(path.join(dir, 'stub.js'), [
    "function sharp() { throw new Error('sharp is stubbed in dsh-chat-atlas (text-only embeddings)') }",
    'sharp.cache = () => {}',
    'sharp.concurrency = () => {}',
    'sharp.simd = () => {}',
    'module.exports = sharp',
    'module.exports.default = sharp',
    '',
  ].join('\n'))
  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  if (pkg.main !== 'stub.js') {
    pkg.main = 'stub.js'
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  }
  console.log('stubbed', path.relative(root, dir))
}
