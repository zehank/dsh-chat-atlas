function sharp() {
  throw new Error('sharp is not available in dsh-chat-atlas (text-only embeddings)')
}
sharp.cache = () => {}
sharp.concurrency = () => {}
sharp.simd = () => {}
module.exports = sharp
module.exports.default = sharp
