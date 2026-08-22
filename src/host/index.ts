import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-projection'

import { SingleTurnActivationGate } from '../core/activation-gate.ts'
import { KnowledgeService } from '../core/knowledge-service.ts'
import { SystemCredentialVault } from './credential-vault.ts'
import { RuntimeProviderCredential } from './provider-credential.ts'
import { ProviderSettingsStore } from './provider-settings.ts'
import { SiliconFlowProvider } from './siliconflow-provider.ts'
import {
  foldKnowledgeSelection,
  normalizeKnowledgeBaseIds,
  type KnowledgeSelectionProjection,
} from './selection.ts'

export * from '../core/activation-gate.ts'
export * from '../core/bm25.ts'
export * from '../core/provider.ts'
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

export const name = '@kai232/dsh-rag'
export const inject = ['tools']

const credential = credentialRef('SILICONFLOW_API_KEY')
const projectionSchema = z.object({ selectedKnowledgeBaseIds: z.array(z.string()) })

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

function runtimeStoragePath(): string {
  const explicit = process.env.DSH_RAG_DATA_DIR?.trim()
  if (explicit !== undefined && explicit !== '') return path.resolve(explicit)
  const home = process.env.DSH_HOME?.trim()
  if (home !== undefined && home !== '') return path.join(path.resolve(home), 'dsh-rag')
  return path.join(process.cwd(), '.dsh-rag')
}

export function setSelectedKnowledgeBases(agent: Agent, ids: readonly string[]): string[] {
  const knowledgeBaseIds = normalizeKnowledgeBaseIds(ids)
  agent.session.append('dsh-rag/selection', { knowledgeBaseIds })
  return knowledgeBaseIds
}

export function apply(ctx: Context): void {
  const activations = new SingleTurnActivationGate<Agent>()
  const vault = new SystemCredentialVault()
  const providerCredential = new RuntimeProviderCredential(vault)
  const storagePath = runtimeStoragePath()
  const providerSettings = ProviderSettingsStore.at(storagePath)
  const initialProviderSettings = providerSettings.get()
  const provider = new SiliconFlowProvider({
    apiKey: async () => await providerCredential.resolve(),
    ...initialProviderSettings,
  })
  const knowledge = new KnowledgeService(storagePath, {
    embeddingProvider: provider,
    rerankProvider: provider,
    embeddingModel: initialProviderSettings.embeddingModel,
  })

  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'reject' && !signal.aborted) {
      activations.enter(agent, messages.map(message => String(message.id)), turn)
    }
    return decision
  })

  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.register<'dsh-rag', KnowledgeSelectionProjection>({
      key: 'dsh-rag',
      stateSchema: projectionSchema,
      init: () => ({ selectedKnowledgeBaseIds: [] }),
      apply: (state, event) => {
        if (event.type !== 'dsh-rag/selection') return state
        return { selectedKnowledgeBaseIds: normalizeKnowledgeBaseIds(event.data.knowledgeBaseIds) }
      },
      wire: {
        viewSchema: projectionSchema,
        view: state => state,
      },
      stateVersion: 1,
    })
  })

  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      name: 'dsh-rag',
      description: '在当前 Session 已选择的知识库中检索一次',
      input: { hint: '<问题>' },
      handler: ({ agent, rawInput }) => {
        const question = rawInput.trim()
        if (question === '') return { kind: 'error', text: '请输入要检索的问题。' }
        const selected = foldKnowledgeSelection(agent.session.events)
        if (selected.length === 0) {
          return { kind: 'error', text: '请先在 Knowledge 中选择至少一个知识库。' }
        }
        const message = createUserMessage({
          content: [{ type: 'text', text: question }],
          source: { kind: 'user' },
        })
        activations.issue(agent, String(message.id), selected)
        agent.steer(message)
        return { kind: 'success', text: '已为下一轮启用所选知识库检索。' }
      },
    })
  })

  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: 'Search the knowledge bases explicitly activated by the current /dsh-rag turn.',
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
        throw new Error('knowledge_search is only available once in the turn created by /dsh-rag')
      }
      return JSON.stringify(await knowledge.search(claim.knowledgeBaseIds, args.query))
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
      const result = await knowledge.sync(args.knowledgeBaseId)
      await knowledge.startWatcher(args.knowledgeBaseId)
      return JSON.stringify(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_status',
    description: 'List configured local knowledge bases and index counts without returning document text.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return JSON.stringify(await knowledge.listKnowledgeBases())
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
            persistent: credentialStatus.source !== 'session' && credentialStatus.source !== 'none',
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
                embedding: 'Only new or changed extracted chunks.',
                rerank: 'The query and a limited set of candidate chunks.',
                originalBinaryUploads: false,
              },
              capabilities: {
                aiContext: { available: false, reason: 'release-quality-gate-failed' },
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
            writeJson(res, 200, {
              ok: true,
              endpoint: saved.endpoint,
              models: {
                embedding: saved.embeddingModel,
                rerank: saved.rerankModel,
              },
            })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/credential' && req.method === 'POST') {
            const body = z.object({ apiKey: z.string().min(1).max(4096), persistence: z.enum(['os', 'session']) }).parse(await readJsonBody(req))
            await providerCredential.set(body.apiKey, body.persistence)
            writeJson(res, 200, { ok: true, credential: await providerCredential.describe() })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/credential' && req.method === 'DELETE') {
            await providerCredential.delete()
            writeJson(res, 200, { ok: true, credential: await providerCredential.describe() })
            return
          }
          if (pathname === '/dsh-rag/api/v1/provider/test' && req.method === 'POST') {
            writeJson(res, 200, { ok: true, probe: await provider.probe() })
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
          const knowledgeBaseMatch = /^\/dsh-rag\/api\/v1\/knowledge-bases\/([^/]+)$/u.exec(pathname)
          if (knowledgeBaseMatch !== null && req.method === 'DELETE') {
            const knowledgeBaseId = decodeURIComponent(knowledgeBaseMatch[1] ?? '')
            await knowledge.deleteKnowledgeBase(knowledgeBaseId)
            for (const session of routeCtx.sessions.list()) {
              const selected = foldKnowledgeSelection(session.events)
              const next = selected.filter(id => id !== knowledgeBaseId)
              if (next.length !== selected.length) session.append('dsh-rag/selection', { knowledgeBaseIds: next })
            }
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
              writeJson(res, 200, { ok: true, selectedKnowledgeBaseIds: foldKnowledgeSelection(session.events) })
              return
            }
            if (req.method === 'POST') {
              const body = z.object({ knowledgeBaseIds: z.array(z.string()) }).parse(await readJsonBody(req))
              const ids = normalizeKnowledgeBaseIds(body.knowledgeBaseIds)
              if (ids.length > 0 && !await knowledge.hasKnowledgeBases(ids)) {
                writeJson(res, 400, { ok: false, error: 'unknown-knowledge-base' })
                return
              }
              session.append('dsh-rag/selection', { knowledgeBaseIds: ids })
              writeJson(res, 200, { ok: true, selectedKnowledgeBaseIds: ids })
              return
            }
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
}
