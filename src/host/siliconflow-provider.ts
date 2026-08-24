import { z } from 'zod'

import {
  ProviderError,
  type EmbeddingProvider,
  type GenerationProvider,
  type GenerationResult,
  type ProviderErrorCode,
  type RerankProvider,
  type RerankScore,
} from '../core/provider.ts'

export const DEFAULT_ENDPOINT = 'https://api.siliconflow.cn/v1'
export const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-m3'
export const DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3'

const embeddingResponseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).min(1),
  })),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
})

const rerankResponseSchema = z.object({
  results: z.array(z.object({
    index: z.number().int().nonnegative(),
    relevance_score: z.number().finite(),
  })),
  meta: z.object({
    tokens: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
  }).optional(),
})

const generationResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
})

export interface SiliconFlowProviderOptions {
  readonly apiKey: () => Promise<string | undefined>
  readonly endpoint?: string
  readonly embeddingModel?: string
  readonly rerankModel?: string
  readonly timeoutMs?: number
  readonly onUsage?: (usage: ProviderUsageEvent) => void
}

export interface ProviderUsageEvent {
  readonly operation: 'embedding' | 'rerank' | 'generation'
  readonly model: string
  readonly inputTokens?: number
  readonly outputTokens?: number
}

export interface SiliconFlowProviderSettings {
  readonly endpoint: string
  readonly embeddingModel: string
  readonly rerankModel: string
}

export type ProviderProbeStatus = 'ok' | 'unconfigured' | 'auth' | 'rate-limited' | 'model-not-found' | 'unavailable' | 'bad-response' | 'http-error'

export interface ProviderProbeItem {
  readonly status: ProviderProbeStatus
  readonly latencyMs: number
}

export interface ProviderProbeResult {
  readonly ok: boolean
  readonly embedding: ProviderProbeItem
  readonly rerank: ProviderProbeItem
}

const CONNECTION_PROBE_TEXT = 'DSH-RAG connection probe. This is fixed non-sensitive text.'

function probeStatus(error: unknown): ProviderProbeStatus {
  if (!(error instanceof ProviderError)) return 'unavailable'
  if (error.code === 'UNCONFIGURED') return 'unconfigured'
  if (error.code === 'AUTH') return 'auth'
  if (error.code === 'RATE_LIMIT') return 'rate-limited'
  if (error.status === 404) return 'model-not-found'
  if (error.code === 'BAD_RESPONSE') return 'bad-response'
  if (error.code === 'UNAVAILABLE' || error.code === 'ABORTED') return 'unavailable'
  return 'http-error'
}

function checkedEndpoint(value: string): string {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  const official = url.protocol === 'https:' && url.hostname === 'api.siliconflow.cn'
  if (!official && !loopback) {
    throw new TypeError('Provider endpoint must use the official SiliconFlow host (loopback is allowed only for tests)')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

function checkedText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new TypeError(`${label} must not be empty`)
  return normalized
}

function checkedModel(value: string, label: string): string {
  const normalized = checkedText(value, label)
  if (normalized.length > 256) throw new TypeError(`${label} is too long`)
  return normalized
}

export function normalizeSiliconFlowSettings(input: Partial<SiliconFlowProviderSettings> = {}): SiliconFlowProviderSettings {
  return {
    endpoint: checkedEndpoint(input.endpoint ?? DEFAULT_ENDPOINT),
    embeddingModel: checkedModel(input.embeddingModel ?? DEFAULT_EMBEDDING_MODEL, 'embedding model'),
    rerankModel: checkedModel(input.rerankModel ?? DEFAULT_RERANK_MODEL, 'rerank model'),
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

function statusCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 503 || status === 504) return 'UNAVAILABLE'
  return 'HTTP_ERROR'
}

export class SiliconFlowProvider implements EmbeddingProvider, RerankProvider, GenerationProvider {
  private readonly apiKey: () => Promise<string | undefined>
  private endpoint: string
  private embeddingModel: string
  private rerankModel: string
  private readonly timeoutMs: number
  private readonly onUsage: ((usage: ProviderUsageEvent) => void) | undefined

  constructor(options: SiliconFlowProviderOptions) {
    this.apiKey = options.apiKey
    const settings = normalizeSiliconFlowSettings(options)
    this.endpoint = settings.endpoint
    this.embeddingModel = settings.embeddingModel
    this.rerankModel = settings.rerankModel
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.onUsage = options.onUsage
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number')
    }
  }

  settings(): SiliconFlowProviderSettings {
    return { endpoint: this.endpoint, embeddingModel: this.embeddingModel, rerankModel: this.rerankModel }
  }

  configure(input: SiliconFlowProviderSettings): SiliconFlowProviderSettings {
    const settings = normalizeSiliconFlowSettings(input)
    this.endpoint = settings.endpoint
    this.embeddingModel = settings.embeddingModel
    this.rerankModel = settings.rerankModel
    return settings
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0 || texts.some(text => text.trim() === '')) {
      throw new TypeError('embedding texts must be a non-empty list of non-empty strings')
    }
    const response = await this.post('embeddings', {
      model: this.embeddingModel,
      input: texts,
      encoding_format: 'float',
    }, signal)
    const parsed = embeddingResponseSchema.safeParse(response)
    if (!parsed.success || parsed.data.data.length !== texts.length) {
      throw new ProviderError('SiliconFlow returned an invalid embedding response', 'BAD_RESPONSE')
    }
    const ordered = [...parsed.data.data].sort((left, right) => left.index - right.index)
    if (ordered.some((item, index) => item.index !== index)) {
      throw new ProviderError('SiliconFlow returned invalid embedding indices', 'BAD_RESPONSE')
    }
    const dimensions = ordered[0]?.embedding.length
    if (dimensions === undefined || ordered.some(item => item.embedding.length !== dimensions)) {
      throw new ProviderError('SiliconFlow returned inconsistent embedding dimensions', 'BAD_RESPONSE')
    }
    this.reportUsage({
      operation: 'embedding',
      model: this.embeddingModel,
      ...(parsed.data.usage?.prompt_tokens === undefined ? {} : { inputTokens: parsed.data.usage.prompt_tokens }),
      ...(parsed.data.usage?.completion_tokens === undefined ? {} : { outputTokens: parsed.data.usage.completion_tokens }),
    })
    return ordered.map(item => item.embedding)
  }

  async rerank(
    query: string,
    documents: readonly string[],
    topN: number,
    signal?: AbortSignal,
  ): Promise<readonly RerankScore[]> {
    checkedText(query, 'rerank query')
    if (documents.length === 0 || documents.some(document => document.trim() === '')) {
      throw new TypeError('rerank documents must be a non-empty list of non-empty strings')
    }
    if (!Number.isInteger(topN) || topN < 1 || topN > documents.length) {
      throw new TypeError('topN must be an integer within the document list')
    }
    const response = await this.post('rerank', {
      model: this.rerankModel,
      query,
      documents,
      top_n: topN,
      return_documents: false,
    }, signal)
    const parsed = rerankResponseSchema.safeParse(response)
    if (!parsed.success || parsed.data.results.length > topN) {
      throw new ProviderError('SiliconFlow returned an invalid rerank response', 'BAD_RESPONSE')
    }
    const seen = new Set<number>()
    for (const result of parsed.data.results) {
      if (result.index >= documents.length || seen.has(result.index)) {
        throw new ProviderError('SiliconFlow returned invalid rerank indices', 'BAD_RESPONSE')
      }
      seen.add(result.index)
    }
    this.reportUsage({
      operation: 'rerank',
      model: this.rerankModel,
      ...(parsed.data.meta?.tokens?.input_tokens === undefined ? {} : { inputTokens: parsed.data.meta.tokens.input_tokens }),
      ...(parsed.data.meta?.tokens?.output_tokens === undefined ? {} : { outputTokens: parsed.data.meta.tokens.output_tokens }),
    })
    return parsed.data.results.map(result => ({ index: result.index, score: result.relevance_score }))
  }

  async generate(system: string, user: string, model: string, signal?: AbortSignal): Promise<GenerationResult> {
    checkedText(system, 'generation system prompt')
    checkedText(user, 'generation user prompt')
    const requestedModel = checkedText(model, 'generation model')
    const response = await this.post('chat/completions', {
      model: requestedModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      max_tokens: 256,
      temperature: 0,
      enable_thinking: false,
    }, signal)
    const parsed = generationResponseSchema.safeParse(response)
    const text = parsed.success ? parsed.data.choices[0]?.message.content.trim() : undefined
    if (!parsed.success || text === undefined || text === '') {
      throw new ProviderError('SiliconFlow returned an invalid generation response', 'BAD_RESPONSE')
    }
    this.reportUsage({
      operation: 'generation',
      model: requestedModel,
      ...(parsed.data.usage?.prompt_tokens === undefined ? {} : { inputTokens: parsed.data.usage.prompt_tokens }),
      ...(parsed.data.usage?.completion_tokens === undefined ? {} : { outputTokens: parsed.data.usage.completion_tokens }),
    })
    return {
      text,
      ...(parsed.data.usage?.prompt_tokens === undefined ? {} : { inputTokens: parsed.data.usage.prompt_tokens }),
      ...(parsed.data.usage?.completion_tokens === undefined ? {} : { outputTokens: parsed.data.usage.completion_tokens }),
    }
  }

  async probe(signal?: AbortSignal): Promise<ProviderProbeResult> {
    const run = async (operation: () => Promise<unknown>): Promise<ProviderProbeItem> => {
      const started = performance.now()
      try {
        await operation()
        return { status: 'ok', latencyMs: Number((performance.now() - started).toFixed(2)) }
      } catch (error) {
        return { status: probeStatus(error), latencyMs: Number((performance.now() - started).toFixed(2)) }
      }
    }
    const embedding = await run(async () => await this.embed([CONNECTION_PROBE_TEXT], signal))
    const rerank = await run(async () => await this.rerank(CONNECTION_PROBE_TEXT, [CONNECTION_PROBE_TEXT], 1, signal))
    return { ok: embedding.status === 'ok' && rerank.status === 'ok', embedding, rerank }
  }

  private reportUsage(usage: ProviderUsageEvent): void {
    try {
      this.onUsage?.(usage)
    } catch {
      // Observability must never change a provider request outcome.
    }
  }

  private async post(path: string, body: unknown, callerSignal?: AbortSignal): Promise<unknown> {
    const rawKey = await this.apiKey()
    const key = rawKey?.trim()
    if (key === undefined || key === '') {
      throw new ProviderError('SiliconFlow credential is not configured', 'UNCONFIGURED')
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout])
    let response: Response
    try {
      response = await fetch(`${this.endpoint}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': '@kai232/dsh-rag/0.1.1',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new ProviderError('SiliconFlow request was aborted', 'ABORTED', { cause: error })
      throw new ProviderError('SiliconFlow request failed before a response', 'UNAVAILABLE', { cause: error })
    }
    const requestId = response.headers.get('x-siliconcloud-trace-id') ?? undefined
    if (!response.ok) {
      const retryDelay = retryAfterMs(response.headers.get('retry-after'))
      throw new ProviderError(`SiliconFlow request failed with HTTP ${response.status}`, statusCode(response.status), {
        status: response.status,
        ...(retryDelay === undefined ? {} : { retryAfterMs: retryDelay }),
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    try {
      return await response.json()
    } catch (error) {
      throw new ProviderError('SiliconFlow returned non-JSON content', 'BAD_RESPONSE', {
        ...(requestId === undefined ? {} : { requestId }),
        cause: error,
      })
    }
  }
}
