import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage, freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { SingleTurnActivationGate } from '../core/activation-gate.ts'
import { formatKnowledgeBaseSelector, parseDshRagCommandInput } from '../core/command-input.ts'
import { KnowledgeService } from '../core/knowledge-service.ts'
import type { SearchResult } from '../core/knowledge-types.ts'
import { renderRetrievalContext } from '../core/retrieval-context.ts'
import { SystemCredentialVault } from './credential-vault.ts'
import { RuntimeProviderCredential } from './provider-credential.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { SiliconFlowProvider, type ProviderProbeResult, type ProviderProbeStatus } from './siliconflow-provider.ts'
import { prepareRuntimeStorage } from './storage-migration.ts'
import { resolveRuntimeStorage } from './storage-path.ts'
import { normalizeKnowledgeBaseIds } from './selection.ts'
import { TOPIC_LABELS, SOURCE_ROLES, type LiteratureFilters } from '../core/literature.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'thrombus-rag': { kind: 'thrombus-rag'; form: 'notice'; summary: string }
  }
}
import { SessionStateStore } from './session-state-store.ts'

export * from '../core/activation-gate.ts'
export * from '../core/bm25.ts'
export * from '../core/command-input.ts'
export * from '../core/provider.ts'
export * from '../core/retrieval-context.ts'
export * from '../core/knowledge-service.ts'
export * from '../core/knowledge-types.ts'
export * from '../core/local-vector.ts'
export * from '../core/hybrid-retrieval.ts'
export * from '../core/incremental-watcher.ts'
export * from '../core/office-parser.ts'
export * from '../core/pdf-parser.ts'
export * from '../core/path-security.ts'
export * from './selection.ts'
export * from './siliconflow-provider.ts'
export * from './credential-vault.ts'
export * from './provider-credential.ts'
export * from './provider-settings.ts'
export * from './session-state-store.ts'

export const name = '@cyx1874cyx/dsh-thrombus-rag'
export const inject = ['tools']

const credential = credentialRef('SILICONFLOW_API_KEY')

type ProviderHealthStatus = 'checking' | 'connected' | 'unconfigured' | 'invalid-credential' | 'unavailable'

interface ProviderHealthState {
  readonly status: ProviderHealthStatus
  readonly checkedAt?: string
  readonly probe?: ProviderProbeResult
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function originAllowed(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function apply(ctx: Context): Promise<void> {
  const activations = new SingleTurnActivationGate<Agent, SearchResult>()
  const vault = new SystemCredentialVault()
  const providerCredential = new RuntimeProviderCredential(vault)
  const storagePreparation = await prepareRuntimeStorage(resolveRuntimeStorage())
  const storagePath = storagePreparation.path
  const sessionState = new SessionStateStore(storagePath)
  const providerSettings = ProviderSettingsStore.at(storagePath)
  const initialProviderSettings = providerSettings.get()
  let providerHealth: ProviderHealthState = { status: 'checking' }
  const healthStatus = (status: ProviderProbeStatus): ProviderHealthStatus => {
    if (status === 'ok') return 'connected'
    if (status === 'unconfigured') return 'unconfigured'
    if (status === 'auth') return 'invalid-credential'
    return 'unavailable'
  }
  const reportProviderStatus = (status: ProviderProbeStatus): void => {
    providerHealth = { status: healthStatus(status), checkedAt: new Date().toISOString() }
  }
  const provider = new SiliconFlowProvider({
    apiKey: async () => await providerCredential.resolve(),
    ...initialProviderSettings,
    onStatus: reportProviderStatus,
  })
  const refreshProviderHealth = async (): Promise<ProviderHealthState> => {
    providerHealth = { status: 'checking' }
    if (!(await providerCredential.describe()).configured) {
      providerHealth = { status: 'unconfigured', checkedAt: new Date().toISOString() }
      return providerHealth
    }
    const probe = await provider.probe(AbortSignal.timeout(10_000))
    const statuses = [probe.embedding.status, probe.rerank.status]
    const status = probe.ok
      ? 'connected'
      : statuses.includes('auth')
        ? 'invalid-credential'
        : statuses.includes('unconfigured')
          ? 'unconfigured'
          : 'unavailable'
    providerHealth = { status, checkedAt: new Date().toISOString(), probe }
    return providerHealth
  }
  const cloudRetrievalEnabled = process.env.DSH_RAG_CLOUD_RETRIEVAL === '1'
  const knowledge = new KnowledgeService(storagePath, cloudRetrievalEnabled ? {
    embeddingProvider: provider,
    rerankProvider: provider,
    embeddingModel: initialProviderSettings.embeddingModel,
  } : {})

  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'reject' && !signal.aborted) {
      activations.enter(agent, messages.map(message => String(message.id)), turn)
    }
    return decision
  })

  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      name: 'rag',
      description: '显示知识库概况，或检索当前 Session/本轮指定的知识库',
      input: { hint: '[@知识库名] <问题>' },
      handler: async ({ agent, commandId, rawInput, signal }) => {
        const parsed = parseDshRagCommandInput(rawInput)
        const question = parsed.question
        const knowledgeBases = await knowledge.listKnowledgeBases()
        await sessionState.rememberParent(String(agent.session.id), agent.session.header.parentSession === undefined ? undefined : String(agent.session.header.parentSession))
        if (rawInput.trim() === '') {
          const selectedIds = await sessionState.getSelection(String(agent.session.id))
          const selectedNames = knowledgeBases.filter(item => selectedIds.includes(item.id)).map(item => item.name)
          const documents = knowledgeBases.reduce((total, item) => total + item.documentCount, 0)
          const chunks = knowledgeBases.reduce((total, item) => total + item.chunkCount, 0)
          return {
            kind: 'success',
            text: `知识库：${knowledgeBases.length} 个，${documents} 份文档，${chunks} 个分块。\n当前会话：${selectedNames.length === 0 ? '未选择知识库' : selectedNames.join('、')}。\n使用：/rag <问题>；临时指定：/rag @知识库名 <问题>（名称含空格时加引号）。`,
          }
        }
        if (question === '') return { kind: 'error', text: '请输入要检索的问题。' }
        const byName = new Map(knowledgeBases.map(item => [item.name, item]))
        const unknownNames = parsed.knowledgeBaseNames.filter(item => !byName.has(item))
        if (unknownNames.length > 0) {
          return { kind: 'error', text: `找不到知识库：${unknownNames.join('、')}。请输入 /rag 并从第一次命令提示中选择。` }
        }
        const selected = parsed.knowledgeBaseNames.length > 0
          ? parsed.knowledgeBaseNames.map(item => byName.get(item)?.id).filter((id): id is string => id !== undefined)
          : await sessionState.getSelection(String(agent.session.id))
        if (selected.length === 0) {
          return { kind: 'error', text: '请输入 /rag 并从第一次命令提示中选择本轮知识库，或在 Knowledge 中设置会话范围。' }
        }
        const selectedNames = parsed.knowledgeBaseNames.length > 0
          ? parsed.knowledgeBaseNames
          : knowledgeBases.filter(item => selected.includes(item.id)).map(item => item.name)
        const result = await knowledge.search(selected, question, 8, signal, await sessionState.getFilters(String(agent.session.id)))
        signal.throwIfAborted()
        if (result.sources.length === 0) return { kind: 'error', text: '当前范围没有检索到支持此问题的资料，请调整问题或筛选条件。' }
        const visibleCommand = `/rag ${selectedNames.map(formatKnowledgeBaseSelector).join('')}${question}`
        const message = freezeMessage({
          id: MessageId(String(commandId)),
          role: 'user' as const,
          content: [{ type: 'text', text: visibleCommand }],
          source: { kind: 'user' },
        })
        await sessionState.saveRetrieval({
          commandId: String(commandId),
          sessionId: String(agent.session.id),
          result,
          knowledgeBaseNames: selectedNames,
        })
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: renderRetrievalContext(result, selectedNames) }],
          source: { kind: 'thrombus-rag', form: 'notice', summary: `文献检索返回 ${result.sources.length} 条来源` },
        }))
        activations.issue(agent, String(message.id), result)
        signal.throwIfAborted()
        agent.steer(message)
        return {
          kind: 'success',
          text: `已检索 ${selectedNames.length} 个知识库，找到 ${result.sources.length} 条来源，正在生成回答。`,
        }
      },
    })
  })

  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: 'Return the retrieval result already prepared by the current /rag turn.',
    parameters: {
      query: { type: 'string', required: true, description: 'The user question to retrieve evidence for.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      const claim = agent === undefined ? undefined : activations.consume(agent)
      if (claim === undefined) {
        throw new Error('knowledge_search is only available once in the turn created by /rag')
      }
      return JSON.stringify(claim.payload)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_sync',
    description: 'Synchronize one already-authorized local knowledge base.',
    parameters: {
      knowledgeBaseId: { type: 'string', required: true, description: 'Configured knowledge base ID.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const configured = await knowledge.listKnowledgeBases()
      const current = configured.find(item => item.id === args.knowledgeBaseId)
      if (current === undefined) throw new Error('knowledge base not found')
      const result = await knowledge.sync(args.knowledgeBaseId)
      await knowledge.startWatcher(args.knowledgeBaseId)
      return JSON.stringify(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_status',
    description: 'Report only the knowledge bases that the current Session is allowed to search, plus index counts.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const configured = await knowledge.listKnowledgeBases()
      const selectedKnowledgeBaseIds = exec.agent === undefined
        ? []
        : await sessionState.getSelection(String(exec.agent.session.id))
      return JSON.stringify({
        selectedKnowledgeBaseIds,
        selectedKnowledgeBases: configured.filter(item => selectedKnowledgeBaseIds.includes(item.id)),
      })
    },
  }))

  ctx.inject(['webServer', 'credentials'], routeCtx => {
    routeCtx.effect(() => routeCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-rag/api/m0',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        if (!originAllowed(req, routeCtx.webServer.port)) {
          writeJson(res, 403, { ok: false, error: 'origin-not-allowed' })
          return
        }
        const info = await routeCtx.credentials.describe(credential)
        const credentialStatus = await providerCredential.describe()
        writeJson(res, 200, {
          ok: true,
          plugin: name,
          credential: {
            ...credentialStatus,
            writable: credentialStatus.osVaultWritable,
            persistent: credentialStatus.source !== 'none',
            backend: credentialStatus.osVaultBackend,
            dshSource: info.source,
          },
        })
      },
    }), 'dsh-rag: m0 host-client endpoint')
  })

  ctx.inject(['webServer', 'sessions'], routeCtx => {
    routeCtx.effect(() => routeCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-rag/api/v1',
      handler: async (req, res) => {
        if (!originAllowed(req, routeCtx.webServer.port)) {
          writeJson(res, 403, { ok: false, error: 'origin-not-allowed' })
          return
        }
        const pathname = new URL(req.url ?? '/', `http://127.0.0.1:${routeCtx.webServer.port}`).pathname
        try {
          if (pathname === '/dsh-rag/api/v1/storage/open' && req.method === 'POST') {
            const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            const child = spawn(command, [storagePath], { stdio: 'ignore', windowsHide: false })
            child.on('error', () => { /* The data path remains visible if the system file manager is unavailable. */ })
            child.unref()
            writeJson(res, 200, { ok: true })
            return
          }
          const pdfMatch = /^\/dsh-rag\/api\/v1\/sources\/([^/]+)\/pdf$/u.exec(pathname)
          if (pdfMatch !== null && req.method === 'GET') {
            const filePath = await knowledge.resolveSource(decodeURIComponent(pdfMatch[1] ?? ''))
            if (!filePath.toLowerCase().endsWith('.pdf')) throw new Error('该来源不是 PDF')
            const pdf = await readFile(filePath)
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'self'" })
            res.end(pdf)
            return
          }
          const openMatch = /^\/dsh-rag\/api\/v1\/sources\/([^/]+)\/open$/u.exec(pathname)
          if (openMatch !== null && req.method === 'POST') {
            const filePath = await knowledge.resolveSource(decodeURIComponent(openMatch[1] ?? ''))
            const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            const child = spawn(command, [filePath], { stdio: 'ignore', windowsHide: false })
            child.on('error', () => {})
            child.unref()
            writeJson(res, 200, { ok: true })
            return
          }
          const filtersMatch = /^\/dsh-rag\/api\/v1\/sessions\/([^/]+)\/filters$/u.exec(pathname)
          if (filtersMatch !== null) {
            const sessionId = decodeURIComponent(filtersMatch[1] ?? '')
            if (routeCtx.sessions.get(SessionId(sessionId)) === undefined) throw new Error('session-not-found')
            if (req.method === 'GET') {
              writeJson(res, 200, { ok: true, filters: await sessionState.getFilters(sessionId) })
              return
            }
            if (req.method === 'POST') {
              const filters = z.object({ topics: z.array(z.string()).max(20).optional(), roles: z.array(z.enum(SOURCE_ROLES)).optional(), yearFrom: z.number().int().min(1800).max(2200).optional(), yearTo: z.number().int().min(1800).max(2200).optional() }).parse(await readJsonBody(req)) as LiteratureFilters
              if (filters.yearFrom !== undefined && filters.yearTo !== undefined && filters.yearFrom > filters.yearTo) throw new Error('起始年份不能晚于结束年份')
              await sessionState.setFilters(sessionId, filters)
              writeJson(res, 200, { ok: true, filters })
              return
            }
          }
          if (pathname === '/dsh-rag/api/v1/search' && req.method === 'POST') {
            const body = z.object({
              knowledgeBaseIds: z.array(z.string()).min(1),
              query: z.string().trim().min(1).max(1500),
              limit: z.number().int().min(1).max(30).default(8),
              filters: z.object({ topics: z.array(z.string()).max(20).optional(), roles: z.array(z.enum(SOURCE_ROLES)).optional(), yearFrom: z.number().int().min(1800).max(2200).optional(), yearTo: z.number().int().min(1800).max(2200).optional(), maxPerPaper: z.number().int().min(1).max(8).optional() }).optional(),
            }).parse(await readJsonBody(req))
            if (body.filters?.yearFrom !== undefined && body.filters.yearTo !== undefined && body.filters.yearFrom > body.filters.yearTo) throw new Error('起始年份不能晚于结束年份')
            const result = await knowledge.search(body.knowledgeBaseIds, body.query, body.limit, undefined, body.filters as LiteratureFilters | undefined)
            writeJson(res, 200, { ok: true, result, topics: TOPIC_LABELS })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider' && req.method === 'GET') {
            const settings = providerSettings.get()
            writeJson(res, 200, {
              ok: true,
              credential: await providerCredential.describe(),
              endpoint: settings.endpoint,
              models: {
                embedding: settings.embeddingModel,
                rerank: settings.rerankModel,
              },
              dataTransfer: {
                embedding: 'The first cloud index sends all extracted text chunks; later syncs send only new or changed chunks.',
                rerank: 'The query and a limited set of candidate chunks.',
                originalBinaryUploads: false,
              },
              capabilities: {
                aiContext: { available: false, reason: 'release-quality-gate-failed' },
              },
              health: providerHealth,
            })
            return
          }
          if (pathname === '/dsh-rag/api/v1/storage' && req.method === 'GET') {
            writeJson(res, 200, {
              ok: true,
              path: storagePath,
              source: storagePreparation.source,
              migration: {
                status: storagePreparation.status,
                legacyPath: storagePreparation.legacyPath,
              },
            })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/config' && req.method === 'POST') {
            const body = z.strictObject({
              endpoint: z.string().min(1).max(2048),
              embeddingModel: z.string().min(1).max(256),
              rerankModel: z.string().min(1).max(256),
            }).parse(await readJsonBody(req))
            const saved = await providerSettings.set(body)
            provider.configure(saved)
            knowledge.configureProviderModels(saved.embeddingModel)
            const health = await refreshProviderHealth()
            writeJson(res, 200, {
              ok: true,
              endpoint: saved.endpoint,
              models: {
                embedding: saved.embeddingModel,
                rerank: saved.rerankModel,
              },
              health,
            })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/credential' && req.method === 'POST') {
            const body = z.object({ apiKey: z.string().min(1).max(4096) }).parse(await readJsonBody(req))
            await providerCredential.set(body.apiKey)
            writeJson(res, 200, { ok: true, credential: await providerCredential.describe(), health: await refreshProviderHealth() })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/credential' && req.method === 'DELETE') {
            await providerCredential.delete()
            providerHealth = (await providerCredential.describe()).configured
              ? await refreshProviderHealth()
              : { status: 'unconfigured', checkedAt: new Date().toISOString() }
            writeJson(res, 200, { ok: true, credential: await providerCredential.describe(), health: providerHealth })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/health' && req.method === 'POST') {
            writeJson(res, 200, { ok: true, health: await refreshProviderHealth() })
            return
          }
          if (pathname === '/dsh-rag/api/v1/knowledge-bases' && req.method === 'GET') {
            await knowledge.startAllWatchers()
            writeJson(res, 200, { ok: true, knowledgeBases: await knowledge.listKnowledgeBases() })
            return
          }
          if (pathname === '/dsh-rag/api/v1/knowledge-bases' && req.method === 'POST') {
            const body = z.object({ name: z.string(), roots: z.array(z.string()).min(1) }).parse(await readJsonBody(req))
            const created = await knowledge.createKnowledgeBase(body.name, body.roots)
            await knowledge.startWatcher(created.id)
            writeJson(res, 201, { ok: true, knowledgeBase: created })
            return
          }
          const sessionKnowledgeMatch = /^\/dsh-rag\/api\/v1\/sessions\/([^/]+)\/knowledge-bases$/u.exec(pathname)
          if (sessionKnowledgeMatch !== null) {
            const sessionId = SessionId(decodeURIComponent(sessionKnowledgeMatch[1] ?? ''))
            const session = routeCtx.sessions.get(sessionId)
            if (session === undefined) {
              writeJson(res, 404, { ok: false, error: 'session-not-found' })
              return
            }
            if (req.method === 'GET') {
              writeJson(res, 200, {
                ok: true,
                knowledgeBases: await knowledge.listKnowledgeBases(),
              })
              return
            }
          }
          const knowledgeBaseMatch = /^\/dsh-rag\/api\/v1\/knowledge-bases\/([^/]+)$/u.exec(pathname)
          if (knowledgeBaseMatch !== null && req.method === 'DELETE') {
            const knowledgeBaseId = decodeURIComponent(knowledgeBaseMatch[1] ?? '')
            await knowledge.deleteKnowledgeBase(knowledgeBaseId)
            await sessionState.removeKnowledgeBase(knowledgeBaseId)
            writeJson(res, 200, { ok: true, originalFilesDeleted: false })
            return
          }
          const syncMatch = /^\/dsh-rag\/api\/v1\/knowledge-bases\/([^/]+)\/sync$/u.exec(pathname)
          if (syncMatch !== null && req.method === 'POST') {
            const knowledgeBaseId = decodeURIComponent(syncMatch[1] ?? '')
            const result = await knowledge.sync(knowledgeBaseId)
            await knowledge.startWatcher(knowledgeBaseId)
            writeJson(res, 200, { ok: true, result })
            return
          }
          const cancelMatch = /^\/dsh-rag\/api\/v1\/knowledge-bases\/([^/]+)\/sync\/cancel$/u.exec(pathname)
          if (cancelMatch !== null && req.method === 'POST') {
            const cancelled = knowledge.cancelSync(decodeURIComponent(cancelMatch[1] ?? ''))
            writeJson(res, cancelled ? 202 : 409, { ok: cancelled, cancelled, ...(!cancelled && { error: 'sync-not-running' }) })
            return
          }
          const selectionMatch = /^\/dsh-rag\/api\/v1\/sessions\/([^/]+)\/selection$/u.exec(pathname)
          if (selectionMatch !== null) {
            const session = routeCtx.sessions.get(SessionId(decodeURIComponent(selectionMatch[1] ?? '')))
            if (session === undefined) {
              writeJson(res, 404, { ok: false, error: 'session-not-found' })
              return
            }
            if (req.method === 'GET') {
              await sessionState.rememberParent(String(session.id), session.header.parentSession === undefined ? undefined : String(session.header.parentSession))
              writeJson(res, 200, { ok: true, selectedKnowledgeBaseIds: await sessionState.getSelection(String(session.id)) })
              return
            }
            if (req.method === 'POST') {
              const body = z.object({ knowledgeBaseIds: z.array(z.string()) }).parse(await readJsonBody(req))
              const ids = normalizeKnowledgeBaseIds(body.knowledgeBaseIds)
              if (ids.length > 0 && !await knowledge.hasKnowledgeBases(ids)) {
                writeJson(res, 400, { ok: false, error: 'unknown-knowledge-base' })
                return
              }
              const selectedKnowledgeBaseIds = await sessionState.setSelection(String(session.id), ids)
              writeJson(res, 200, { ok: true, selectedKnowledgeBaseIds })
              return
            }
          }
          const retrievalMatch = /^\/dsh-rag\/api\/v1\/sessions\/([^/]+)\/retrievals\/([^/]+)$/u.exec(pathname)
          if (retrievalMatch !== null && req.method === 'GET') {
            const sessionId = decodeURIComponent(retrievalMatch[1] ?? '')
            const commandId = decodeURIComponent(retrievalMatch[2] ?? '')
            const record = await sessionState.getRetrieval(sessionId, commandId)
            if (record === undefined) {
              writeJson(res, 404, { ok: false, error: 'retrieval-not-found' })
              return
            }
            writeJson(res, 200, { ok: true, retrieval: record })
            return
          }
          const sourceMatch = /^\/dsh-rag\/api\/v1\/sources\/([^/]+)\/resolve$/u.exec(pathname)
          if (sourceMatch !== null && req.method === 'POST') {
            writeJson(res, 200, { ok: true, path: await knowledge.resolveSource(decodeURIComponent(sourceMatch[1] ?? '')) })
            return
          }
          writeJson(res, 404, { ok: false, error: 'not-found' })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'request-failed' })
        }
      },
    }), 'dsh-rag: M1 knowledge API')
  })

  if (cloudRetrievalEnabled) void refreshProviderHealth()
}
