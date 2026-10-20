/**
 * chat-atlas / embed —— 本地语义向量（all-MiniLM-L6-v2，384 维，onnx）。
 *
 * 模型在插件目录的 models/ 下，离线可用；加载失败就静默降级回词面检索。
 * 只在 Electron 主进程里跑（原生 onnxruntime），别在无头测试里直接 import。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODEL_DIR = path.join(HERE, '..', 'models')
export const MODEL_ID = 'Xenova/multilingual-e5-small'

let extractor = null
let loading = null
let disabled = false

export function embedStatus() {
  return { ready: !!extractor, loading: !!loading, disabled }
}

export async function loadEmbedder() {
  if (disabled) return null
  if (extractor) return extractor
  if (loading) return loading
  loading = (async () => {
    const build = async (allowRemote) => {
      const { env, pipeline } = await import('@xenova/transformers')
      env.cacheDir = MODEL_DIR
      env.localModelPath = MODEL_DIR
      env.allowLocalModels = true
      env.allowRemoteModels = allowRemote
      return pipeline('feature-extraction', MODEL_ID, { quantized: true })
    }
    try {
      // 先只用本地模型；没有就允许下载一次（约 130MB），缓存进 models/
      extractor = await build(false).catch(() => build(true))
      return extractor
    } catch (e) {
      disabled = true
      console.warn('[chat-atlas] 语义模型不可用，退回词面检索:', e?.message || e)
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 文本 → 归一化向量；超时或不可用返回 null（调用方退回词面检索）。 */
export async function embed(text, { timeoutMs = 2500, type = 'query' } = {}) {
  const pipe = await loadEmbedder()
  if (!pipe) return null
  const body = String(text || '').slice(0, 512)
  if (!body.trim()) return null
  const input = (type === 'passage' ? 'passage: ' : 'query: ') + body
  const run = pipe(input, { pooling: 'mean', normalize: true }).then((out) => Array.from(out.data))
  const timed = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
  return Promise.race([run, timed])
}
