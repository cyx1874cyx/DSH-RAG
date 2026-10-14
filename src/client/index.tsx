import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type { LiteratureMetadata, LiteratureFilters } from '../shared/literature.ts'
import { TOPIC_LABELS, SOURCE_ROLES } from '../shared/literature.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { DSH_RAG_LOCALE_NS, en, type DshRagLocaleKey, zh } from './locales.ts'
import { DSH_RAG_STYLES } from './styles.ts'

export const inject = ['slots', 'locale', 'inputTriggers', 'workspaces', 'uiConversation', 'sessions', 'conversation']

type T = TranslateNS<typeof DSH_RAG_LOCALE_NS>
type LocalizedProps = PropsLocale<typeof DSH_RAG_LOCALE_NS>
type Tone = 'neutral' | 'success' | 'warning' | 'danger'

function formatKnowledgeBaseSelector(name: string): string {
  return /^@?[^\s"\\]+$/u.test(name) ? `@${name.replace(/^@/u, '')} ` : `@${JSON.stringify(name)} `
}

interface ClientRetrievalRecord {
  readonly commandId: string
  readonly sessionId: string
  readonly result: ClientSearchResult
  readonly knowledgeBaseNames: readonly string[]
}

interface ClientRetrievalNode {
  readonly commandId: string
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'dsh-rag/retrieval': ClientRetrievalNode
  }
}

export function isRagSlashQuery(query: string): boolean {
  const normalized = query.replace(/^\//u, '').toLocaleLowerCase()
  return normalized === 'rag'
}

const COMPLETE_KNOWLEDGE_SELECTOR_PREFIX = /^(?:@(?:"(?:\\.|[^"\\])*"|[^\s@"\\]+)\s+)*$/u

/** Keep the knowledge-base @ source private to the leading selector area of `/rag`. */
export function isRagKnowledgeReferenceQuery(draft: string, query: string): boolean {
  const line = draft.trimStart()
  const activeToken = `@${query}`
  if (!line.endsWith(activeToken)) return false
  const beforeToken = line.slice(0, -activeToken.length)
  if (!beforeToken.startsWith('/rag ')) return false
  return COMPLETE_KNOWLEDGE_SELECTOR_PREFIX.test(beforeToken.slice('/rag '.length))
}

interface Notice {
  readonly key: DshRagLocaleKey
  readonly params?: Record<string, unknown>
  readonly kind?: 'status' | 'error'
}

interface ProviderSettingsState {
  readonly credential: {
    readonly configured: boolean
    readonly source: string
    readonly osVaultAvailable: boolean
    readonly osVaultWritable: boolean
    readonly osVaultBackend: string
  }
  readonly endpoint: string
  readonly models: { readonly embedding: string; readonly rerank: string }
  readonly dataTransfer: { readonly originalBinaryUploads: boolean }
  readonly capabilities: { readonly aiContext: { readonly available: false; readonly reason: string } }
  readonly health: {
    readonly status: 'checking' | 'connected' | 'unconfigured' | 'invalid-credential' | 'unavailable'
    readonly checkedAt?: string
  }
}

interface KnowledgeBaseSummary {
  readonly id: string
  readonly name: string
  readonly roots: readonly string[]
  readonly generation: number
  readonly documentCount: number
  readonly chunkCount: number
  readonly syncStatus: {
    readonly state: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'
    readonly completedFiles: number
    readonly totalFiles: number
    readonly reusedCheckpointFiles: number
  }
}

interface StorageState {
  readonly path: string
  readonly source: 'environment' | 'dsh-home'
  readonly migration: {
    readonly status: 'not-needed' | 'migrated' | 'conflict'
    readonly legacyPath?: string
  }
}

type ClientLocator =
  | { readonly kind: 'text'; readonly lineStart: number; readonly lineEnd: number; readonly titlePath: readonly string[] }
  | { readonly kind: 'pdf'; readonly page: number; readonly titlePath: readonly string[] }
  | { readonly kind: 'docx'; readonly paragraphStart: number; readonly paragraphEnd: number; readonly titlePath: readonly string[] }
  | { readonly kind: 'pptx'; readonly slide: number; readonly hasNotes: boolean; readonly titlePath: readonly string[] }

interface ClientSource {
  readonly sourceId: string
  readonly knowledgeBaseName: string
  readonly fileName: string
  readonly snippet: string
  readonly structuralContext: string
  readonly score: number
  readonly locator: ClientLocator
  readonly literature?: LiteratureMetadata
  readonly citationId?: string
}

interface ClientSearchResult {
  readonly mode: 'local-bm25' | 'hybrid-rrf' | 'hybrid-reranked'
  readonly degraded: boolean
  readonly degradedReasons: readonly string[]
  readonly sources: readonly ClientSource[]
}

function retrievalCommandFromMatch(match: ConversationMatch): ClientRetrievalNode {
  if (match.event.type !== 'command/run' || match.event.data.name !== 'rag') throw new Error('DSH-RAG retrieval state requires its command/run event')
  return { commandId: String(match.event.data.commandId) }
}

export const retrievalStateDefinition: ConversationNodeDefinition<ClientRetrievalNode> = {
  kind: 'dsh-rag/retrieval-state',
  match: event => event.type === 'command/run' && event.data.name === 'rag'
    ? { id: String(event.data.commandId), role: 'start' }
    : null,
  start: (_context, match) => retrievalCommandFromMatch(match),
  update: context => context.state,
}

export const retrievalConversationDefinition: ConversationNodeDefinition<ClientRetrievalNode | null> = {
  kind: 'dsh-rag/retrieval',
  target: 'chat',
  match: event => event.type === 'command/run'
    && event.data.name === 'rag'
    && (event.data.args ?? '').trim() !== ''
    ? { id: String(event.data.commandId), role: 'start' }
    : null,
  start: (_context, match) => match.event.type === 'command/run' ? { commandId: String(match.event.data.commandId) } : null,
  update: context => context.state,
  buildViewNode: context => {
    const start = context.start ?? context.matches[0]
    if (context.state === undefined || context.state === null || start === undefined) return null
    return {
      key: context.key,
      kind: 'dsh-rag/retrieval',
      id: context.id,
      target: 'chat',
      anchorSeq: start.event.seq + 0.1,
      location: start.location,
      visibility: 'visible',
      data: context.state,
    }
  },
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  const body = await response.json() as T & { ok?: boolean; error?: string }
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

function Styles(): JSX.Element {
  return <style>{DSH_RAG_STYLES}</style>
}

function KnowledgeIcon(): JSX.Element {
  return (
    <svg className="dsh-rag-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.75 5.5a2.25 2.25 0 0 1 2.25-2.25h4.25v15.5H7a2.25 2.25 0 0 0-2.25 2.25V5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M19.25 5.5A2.25 2.25 0 0 0 17 3.25h-4.25v15.5H17A2.25 2.25 0 0 1 19.25 21V5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function BoundaryIcon(): JSX.Element {
  return (
    <svg className="dsh-rag-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.25 19 6v5.2c0 4.38-2.88 7.85-7 9.55-4.12-1.7-7-5.17-7-9.55V6l7-2.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatusDot({ tone = 'neutral' }: { readonly tone?: Tone }): JSX.Element {
  return <span className="dsh-rag-dot" data-tone={tone} aria-hidden="true" />
}

function Message({ notice, t }: { readonly notice: Notice; readonly t: T }): JSX.Element {
  return (
    <div className="dsh-rag-message" data-kind={notice.kind ?? 'status'} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <StatusDot tone={notice.kind === 'error' ? 'danger' : 'success'} />
      <span>{t(notice.key, notice.params)}</span>
    </div>
  )
}

function useKnowledgeBases(sessionId?: string): {
  readonly knowledgeBases: readonly KnowledgeBaseSummary[]
  readonly refresh: () => Promise<void>
  readonly error?: string
} {
  const [knowledgeBases, setKnowledgeBases] = useState<readonly KnowledgeBaseSummary[]>([])
  const [error, setError] = useState<string>()
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const body = await api<{ knowledgeBases: KnowledgeBaseSummary[] }>(sessionId === undefined
        ? '/dsh-rag/api/v1/knowledge-bases'
        : `/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/knowledge-bases`)
      setKnowledgeBases(body.knowledgeBases)
      setError(undefined)
    } catch (cause) {
      setError(String(cause))
    }
  }, [sessionId])
  useEffect(() => { void refresh() }, [refresh])
  return { knowledgeBases, refresh, ...(error === undefined ? {} : { error }) }
}

function useKnowledgeSelection(sessionId: string): {
  readonly selected: readonly string[]
  readonly setSelected: (ids: readonly string[]) => void
  readonly error?: string
} {
  const [selected, setSelected] = useState<readonly string[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    void api<{ selectedKnowledgeBaseIds: string[] }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/selection`)
      .then(body => { setSelected(body.selectedKnowledgeBaseIds); setError(undefined) })
      .catch(cause => { setError(String(cause)) })
  }, [sessionId])
  return { selected, setSelected, ...(error === undefined ? {} : { error }) }
}

function useProviderSettings(): {
  readonly provider?: ProviderSettingsState
  readonly refreshProvider: () => Promise<void>
  readonly providerError?: string
} {
  const [provider, setProvider] = useState<ProviderSettingsState>()
  const [providerError, setProviderError] = useState<string>()
  const refreshProvider = useCallback(async (): Promise<void> => {
    try {
      const body = await api<ProviderSettingsState>('/dsh-rag/api/v1/provider')
      setProvider(body)
      setProviderError(undefined)
    } catch (cause) {
      setProviderError(String(cause))
    }
  }, [])
  useEffect(() => { void refreshProvider() }, [refreshProvider])
  return { refreshProvider, ...(provider === undefined ? {} : { provider }), ...(providerError === undefined ? {} : { providerError }) }
}

function useStorage(): { readonly storage?: StorageState; readonly storageError?: string } {
  const [storage, setStorage] = useState<StorageState>()
  const [storageError, setStorageError] = useState<string>()
  useEffect(() => {
    void api<StorageState>('/dsh-rag/api/v1/storage').then(value => {
      setStorage(value)
      setStorageError(undefined)
    }).catch(cause => { setStorageError(String(cause)) })
  }, [])
  return { ...(storage === undefined ? {} : { storage }), ...(storageError === undefined ? {} : { storageError }) }
}

function syncLabel(item: KnowledgeBaseSummary, t: T): string {
  const status = item.syncStatus
  if (status.state === 'running') return t('sync.running', { completed: status.completedFiles, total: status.totalFiles })
  return t(`sync.${status.state}` as const)
}

function syncTone(state: KnowledgeBaseSummary['syncStatus']['state']): Tone {
  if (state === 'completed') return 'success'
  if (state === 'running' || state === 'cancelled') return 'warning'
  if (state === 'failed') return 'danger'
  return 'neutral'
}

function documentCount(item: KnowledgeBaseSummary, t: T): string {
  return t(item.documentCount === 1 ? 'knowledge.document' : 'knowledge.documents', { count: item.documentCount })
}

const countKeys: Readonly<Record<string, DshRagLocaleKey>> = {
  added: 'count.added',
  modified: 'count.modified',
  renamed: 'count.renamed',
  deleted: 'count.deleted',
  unchanged: 'count.unchanged',
  failed: 'count.failed',
}

function formatCounts(counts: Readonly<Record<string, number>>, t: T): string {
  return Object.entries(counts).map(([key, value]) => `${countKeys[key] === undefined ? key : t(countKeys[key])} ${value}`).join(' · ')
}

function KnowledgeSettings({ t, openPath }: LocalizedProps & { readonly openPath: (path: string) => Promise<void> }): JSX.Element {
  const { provider, refreshProvider, providerError } = useProviderSettings()
  const { knowledgeBases, refresh, error } = useKnowledgeBases()
  const { storage, storageError } = useStorage()
  const [name, setName] = useState('')
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [endpoint, setEndpoint] = useState('https://api.siliconflow.cn/v1')
  const [embeddingModel, setEmbeddingModel] = useState('BAAI/bge-m3')
  const [rerankModel, setRerankModel] = useState('BAAI/bge-reranker-v2-m3')
  const [apiKey, setApiKey] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string>()

  useEffect(() => {
    if (provider === undefined) return
    setEndpoint(provider.endpoint)
    setEmbeddingModel(provider.models.embedding)
    setRerankModel(provider.models.rerank)
  }, [provider])

  useEffect(() => {
    if (busy === undefined || busy === 'create') return
    const timer = setInterval(() => { void refresh() }, 250)
    return () => { clearInterval(timer) }
  }, [busy, refresh])

  const create = async (): Promise<void> => {
    setBusy('create'); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/knowledge-bases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, roots: [root] }) })
      setName(''); setRoot(''); setNotice({ key: 'notice.created' }); await refresh()
    } catch (cause) { setNotice({ key: 'error.create', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const saveCredential = async (): Promise<void> => {
    setBusy('credential:save'); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/provider/credential', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) })
      setApiKey(''); await refreshProvider(); setNotice({ key: 'notice.credentialVault' })
    } catch (cause) { setNotice({ key: 'error.saveCredential', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const deleteCredential = async (): Promise<void> => {
    setBusy('credential:delete'); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/provider/credential', { method: 'DELETE' }); setApiKey(''); await refreshProvider(); setNotice({ key: 'notice.credentialDeleted' })
    } catch (cause) { setNotice({ key: 'error.deleteCredential', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const saveProviderConfig = async (): Promise<void> => {
    setBusy('provider:config'); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/provider/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, embeddingModel, rerankModel }) })
      await refreshProvider(); setNotice({ key: 'notice.configSaved' })
    } catch (cause) { setNotice({ key: 'error.saveConfig', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const retryProvider = async (): Promise<void> => {
    setBusy('provider:health'); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/provider/health', { method: 'POST' }); await refreshProvider()
    } catch (cause) { setNotice({ key: 'error.providerHealth', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const sync = async (id: string): Promise<void> => {
    setBusy(id); setNotice(undefined)
    try {
      const body = await api<{ result: { status: 'completed' | 'cancelled'; counts: Record<string, number> } }>(`/dsh-rag/api/v1/knowledge-bases/${encodeURIComponent(id)}/sync`, { method: 'POST' })
      setNotice({ key: body.result.status === 'cancelled' ? 'notice.syncCancelled' : 'notice.syncCompleted', params: { counts: formatCounts(body.result.counts, t) } }); await refresh()
    } catch (cause) { setNotice({ key: 'error.sync', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const cancel = async (id: string): Promise<void> => {
    try { await api(`/dsh-rag/api/v1/knowledge-bases/${encodeURIComponent(id)}/sync/cancel`, { method: 'POST' }); setNotice({ key: 'notice.cancelling' }) }
    catch (cause) { setNotice({ key: 'error.cancel', params: { error: String(cause) }, kind: 'error' }) }
  }

  const deleteKnowledgeBase = async (id: string): Promise<void> => {
    setBusy(`delete:${id}`); setNotice(undefined)
    try {
      await api(`/dsh-rag/api/v1/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setPendingDeleteId(undefined); setNotice({ key: 'notice.knowledgeBaseDeleted' }); await refresh()
    } catch (cause) { setNotice({ key: 'error.deleteKnowledgeBase', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
  }

  const credentialConfigured = provider?.credential.configured === true
  const providerStatus = provider?.health.status ?? 'checking'
  const providerTone: Tone = providerStatus === 'connected'
    ? 'success'
    : providerStatus === 'invalid-credential'
      ? 'danger'
      : providerStatus === 'checking'
        ? 'neutral'
        : 'warning'

  return (
    <section className="dsh-rag dsh-rag-page" data-dsh-rag-surface="settings">
      <Styles />
      <header className="dsh-rag-header"><div><div className="dsh-rag-eyebrow"><KnowledgeIcon />Thrombus Literature</div><h2 className="dsh-rag-title">{t('settings.title')}</h2><p className="dsh-rag-subtitle">{t('settings.subtitle')}</p></div></header>
      {notice === undefined ? null : <Message notice={notice} t={t} />}
      {providerError === undefined ? null : <Message notice={{ key: 'error.providerState', params: { error: providerError }, kind: 'error' }} t={t} />}
      {error === undefined ? null : <Message notice={{ key: 'error.knowledgeLoad', params: { error }, kind: 'error' }} t={t} />}
      {storageError === undefined ? null : <Message notice={{ key: 'error.storageLoad', params: { error: storageError }, kind: 'error' }} t={t} />}

      <section className="dsh-rag-card">
        <header className="dsh-rag-card-head"><div><h3 className="dsh-rag-card-title">{t('storage.title')}</h3><p className="dsh-rag-card-description">{t('storage.subtitle')}</p></div></header>
        <div className="dsh-rag-card-body">
          {storage === undefined ? <p className="dsh-rag-hint">{t('status.loading')}</p> : <><code className="dsh-rag-root">{storage.path}</code><p className="dsh-rag-hint">{t(`storage.source.${storage.source}` as const)}</p>{storage.migration.status === 'conflict' ? <Message notice={{ key: 'storage.conflict', params: { legacyPath: storage.migration.legacyPath ?? '' }, kind: 'error' }} t={t} /> : null}<div className="dsh-rag-actions"><button className="dsh-rag-button" type="button" onClick={() => { void openPath(storage.path) }}>{t('action.openStorage')}</button></div></>}
        </div>
      </section>

      <section className="dsh-rag-card">
        <header className="dsh-rag-card-head"><div><h3 className="dsh-rag-card-title">{t('provider.title')}</h3><p className="dsh-rag-card-description">{t('provider.subtitle')}</p></div><span className="dsh-rag-state-badge" data-tone={providerError === undefined ? providerTone : 'danger'}><StatusDot tone={providerError === undefined ? providerTone : 'danger'} />{providerError === undefined ? t(`provider.health.${providerStatus}` as const) : t('status.disconnected')}</span></header>
        <div className="dsh-rag-card-body">
          <aside className="dsh-rag-boundary"><BoundaryIcon /><div><strong>{t('cloud.title')}</strong><p>{t('cloud.description')}</p></div></aside>
          <div className="dsh-rag-form-grid">
            <label className="dsh-rag-field" data-span="full">{t('provider.endpoint')}<input className="dsh-rag-input" aria-label={t('provider.endpoint')} value={endpoint} onChange={event => { setEndpoint(event.target.value) }} /></label>
            <label className="dsh-rag-field">{t('provider.embedding')}<input className="dsh-rag-input" aria-label={t('provider.embedding')} value={embeddingModel} onChange={event => { setEmbeddingModel(event.target.value) }} /></label>
            <label className="dsh-rag-field">{t('provider.reranker')}<input className="dsh-rag-input" aria-label={t('provider.reranker')} value={rerankModel} onChange={event => { setRerankModel(event.target.value) }} /></label>
          </div>
          <div className="dsh-rag-actions"><button className="dsh-rag-button" data-variant="primary" type="button" disabled={busy !== undefined || endpoint.trim() === '' || embeddingModel.trim() === '' || rerankModel.trim() === ''} onClick={() => { void saveProviderConfig() }}>{busy === 'provider:config' ? t('action.saving') : t('action.save')}</button></div>
          <p className="dsh-rag-hint">{t('provider.endpointHint')}</p><div className="dsh-rag-divider" />
          <label className="dsh-rag-field">{t('provider.apiKey')}<input className="dsh-rag-input" aria-label={t('provider.apiKey')} type="password" autoComplete="off" value={apiKey} onChange={event => { setApiKey(event.target.value) }} /></label>
          <div className="dsh-rag-actions">
            <button className="dsh-rag-button" data-variant="primary" type="button" disabled={busy !== undefined || apiKey.trim() === '' || provider?.credential.osVaultWritable !== true} onClick={() => { void saveCredential() }}>{t('action.saveKey')}</button>
            {providerStatus === 'unavailable' || providerStatus === 'invalid-credential' ? <button className="dsh-rag-button" type="button" disabled={busy !== undefined || !credentialConfigured} onClick={() => { void retryProvider() }}>{busy === 'provider:health' ? t('action.testing') : t('action.retry')}</button> : null}
            <button className="dsh-rag-button" data-variant="danger" type="button" disabled={busy !== undefined || provider?.credential.configured !== true} onClick={() => { void deleteCredential() }}>{t('action.deleteKey')}</button>
          </div>
          {provider?.credential.osVaultWritable === false ? <p className="dsh-rag-hint">{t('provider.vaultUnavailable', { backend: provider.credential.osVaultBackend })}</p> : null}
        </div>
      </section>

      <section className="dsh-rag-card">
        <header className="dsh-rag-card-head"><div><h3 className="dsh-rag-card-title">{t('knowledge.title')}</h3><p className="dsh-rag-card-description">{t('knowledge.subtitle')}</p></div><span className="dsh-rag-counter">{knowledgeBases.length}</span></header>
        <div className="dsh-rag-card-body">
          <div className="dsh-rag-form-grid">
            <label className="dsh-rag-field">{t('knowledge.name')}<input className="dsh-rag-input" aria-label={t('knowledge.name')} value={name} onChange={event => { setName(event.target.value) }} /></label>
            <label className="dsh-rag-field">{t('knowledge.root')}<input className="dsh-rag-input" aria-label={t('knowledge.root')} value={root} onChange={event => { setRoot(event.target.value) }} placeholder={t('knowledge.rootPlaceholder')} /></label>
          </div>
          <div className="dsh-rag-actions"><button className="dsh-rag-button" data-variant="primary" type="button" disabled={busy !== undefined || name.trim() === '' || root.trim() === ''} onClick={() => { void create() }}>{busy === 'create' ? t('action.creating') : t('action.create')}</button></div><div className="dsh-rag-divider" />
          {knowledgeBases.length === 0 ? <div className="dsh-rag-empty">{t('knowledge.empty')}</div> : <div className="dsh-rag-library-list">{knowledgeBases.map(item => (
            <article className="dsh-rag-library" key={item.id}>
              <div className="dsh-rag-library-top"><div><div className="dsh-rag-library-name"><StatusDot tone={syncTone(item.syncStatus.state)} /><span>{item.name}</span></div><div className="dsh-rag-meta"><span>{documentCount(item, t)}</span><span>{t('knowledge.chunks', { count: item.chunkCount })}</span><span>{t('knowledge.generation', { count: item.generation })}</span><span>{syncLabel(item, t)}</span><span>{t('knowledge.checkpoints', { count: item.syncStatus.reusedCheckpointFiles })}</span></div></div>
                <div className="dsh-rag-actions" style={{ marginTop: 0 }}><button className="dsh-rag-button" type="button" disabled={busy !== undefined} onClick={() => { void sync(item.id) }}>{busy === item.id ? t('action.syncing') : t('action.sync')}</button>{busy === item.id ? <button className="dsh-rag-button" data-variant="danger" type="button" onClick={() => { void cancel(item.id) }}>{t('action.cancelSync')}</button> : <button className="dsh-rag-button" data-variant="danger" type="button" disabled={busy !== undefined} onClick={() => { setPendingDeleteId(item.id) }}>{t('action.deleteKnowledgeBase')}</button>}</div>
              </div>
              <div className="dsh-rag-roots">{item.roots.map(value => <code className="dsh-rag-root" key={value}>{value}</code>)}</div>
              {pendingDeleteId === item.id ? <div className="dsh-rag-delete-confirm" role="alert"><p>{t('knowledge.deleteWarning')}</p><div className="dsh-rag-actions"><button className="dsh-rag-button" data-variant="danger" type="button" disabled={busy !== undefined} onClick={() => { void deleteKnowledgeBase(item.id) }}>{t('action.confirmDeleteKnowledgeBase')}</button><button className="dsh-rag-button" type="button" disabled={busy !== undefined} onClick={() => { setPendingDeleteId(undefined) }}>{t('action.cancelDelete')}</button></div></div> : null}
            </article>
          ))}</div>}
        </div>
      </section>
    </section>
  )
}

function KnowledgeConversation(props: PropsRuntime<'conversation.view'> & LocalizedProps & { ask: (sessionId: string, question: string) => Promise<void> }): JSX.Element {
  const { t } = props
  const sessionId = String(props.sessionId)
  const { knowledgeBases, error } = useKnowledgeBases(sessionId)
  const { selected, setSelected, error: selectionError } = useKnowledgeSelection(sessionId)
  const [notice, setNotice] = useState<Notice>()
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('')
  const [role, setRole] = useState('')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [result, setResult] = useState<ClientSearchResult>()
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  useEffect(() => {
    void api<{ filters: LiteratureFilters }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/filters`).then(({ filters }) => {
      setTopic(filters.topics?.[0] ?? '')
      setRole(filters.roles?.[0] ?? '')
      setYearFrom(filters.yearFrom === undefined ? '' : String(filters.yearFrom))
      setYearTo(filters.yearTo === undefined ? '' : String(filters.yearTo))
    }).catch(() => { /* A fresh Session has no saved filters. */ })
  }, [sessionId])
  const filters = (): LiteratureFilters => ({
    ...(topic === '' ? {} : { topics: [topic] }),
    ...(role === '' ? {} : { roles: SOURCE_ROLES.filter(value => value === role) }),
    ...(yearFrom === '' ? {} : { yearFrom: Number(yearFrom) }),
    ...(yearTo === '' ? {} : { yearTo: Number(yearTo) }),
  })
  const retrieve = async (ask: boolean): Promise<void> => {
    if (query.trim() === '' || selected.length === 0) return
    setSearching(true)
    setSearchError('')
    try {
      await api(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/filters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filters()) })
      if (ask) await props.ask(sessionId, query.trim())
      else {
        const body = await api<{ result: ClientSearchResult }>('/dsh-rag/api/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ knowledgeBaseIds: selected, query, filters: filters(), limit: 12 }) })
        setResult(body.result)
      }
    } catch (cause) { setSearchError(String(cause)) }
    finally { setSearching(false) }
  }

  const update = async (id: string, checked: boolean): Promise<void> => {
    const next = checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id)
    try {
      const body = await api<{ selectedKnowledgeBaseIds: string[] }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ knowledgeBaseIds: next }) })
      setSelected(body.selectedKnowledgeBaseIds)
      setNotice({ key: body.selectedKnowledgeBaseIds.length === 0 ? 'notice.selectionEmpty' : 'notice.selectionSaved' })
    } catch (cause) { setNotice({ key: 'error.selectionSave', params: { error: String(cause) }, kind: 'error' }) }
  }

  return (
    <section className="dsh-rag dsh-rag-page dsh-rag-conversation" data-dsh-rag-surface="conversation">
      <Styles />
      <header className="dsh-rag-header"><div><div className="dsh-rag-eyebrow"><KnowledgeIcon />Thrombus Literature</div><h2 className="dsh-rag-title">{t('conversation.title')}</h2><p className="dsh-rag-subtitle">{t('conversation.subtitle')}</p></div><span className="dsh-rag-counter">{t('conversation.selectedCount', { selected: selected.length, total: knowledgeBases.length })}</span></header>
      {knowledgeBases.length === 0 ? <div className="dsh-rag-empty">{t('conversation.empty')}</div> : <div className="dsh-rag-check-list">{knowledgeBases.map(item => {
        const checked = selected.includes(item.id)
        return <label className="dsh-rag-check-row" data-selected={checked} key={item.id}><input className="dsh-rag-checkbox" type="checkbox" checked={checked} onChange={event => { void update(item.id, event.target.checked) }} /><span className="dsh-rag-check-copy"><span className="dsh-rag-check-name">{item.name}</span><span className="dsh-rag-check-meta">{documentCount(item, t)} · {syncLabel(item, t)}</span></span><StatusDot tone={syncTone(item.syncStatus.state)} /></label>
      })}</div>}
      {error === undefined ? null : <Message notice={{ key: 'error.knowledgeLoad', params: { error }, kind: 'error' }} t={t} />}
      {selectionError === undefined ? null : <Message notice={{ key: 'error.selectionSave', params: { error: selectionError }, kind: 'error' }} t={t} />}
      {notice === undefined ? null : <Message notice={notice} t={t} />}
      <form className="dsh-rag-panel" onSubmit={event => { event.preventDefault(); void retrieve(false) }}>
        <h3>{t('research.title')}</h3>
        <p className="dsh-rag-hint">{t('research.hint')}</p>
        <label className="dsh-rag-field"><span>{t('research.question')}</span><textarea className="dsh-rag-input" rows={3} value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('research.placeholder')} maxLength={1500} /></label>
        <div className="dsh-rag-research-filters">
          <label className="dsh-rag-field"><span>{t('research.topic')}</span><select className="dsh-rag-input" value={topic} onChange={event => { setTopic(event.target.value) }}><option value="">{t('research.all')}</option>{Object.entries(TOPIC_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="dsh-rag-field"><span>{t('research.role')}</span><select className="dsh-rag-input" value={role} onChange={event => { setRole(event.target.value) }}><option value="">{t('research.all')}</option>{SOURCE_ROLES.map(value => <option key={value} value={value}>{t(`source.${value}`)}</option>)}</select></label>
          <label className="dsh-rag-field"><span>{t('research.fromYear')}</span><input className="dsh-rag-input" type="number" min={1800} max={2200} value={yearFrom} onChange={event => { setYearFrom(event.target.value) }} /></label>
          <label className="dsh-rag-field"><span>{t('research.toYear')}</span><input className="dsh-rag-input" type="number" min={1800} max={2200} value={yearTo} onChange={event => { setYearTo(event.target.value) }} /></label>
        </div>
        <div className="dsh-rag-actions"><button className="dsh-rag-button" type="submit" disabled={searching || selected.length === 0 || query.trim() === ''}>{t('research.search')}</button><button className="dsh-rag-button" type="button" disabled={searching || selected.length === 0 || query.trim() === ''} onClick={() => { void retrieve(true) }}>{t('research.ask')}</button></div>
        {searchError === '' ? null : <p role="alert">{searchError}</p>}
      </form>
      {result === undefined ? null : <KnowledgeResultCard result={result} t={t} openFile={() => { /* PDF source buttons below open their exact page in the browser. */ }} surface="tool" />}
      <div className="dsh-rag-command"><div><strong>{t('conversation.commandTitle')}</strong><p>{t('conversation.commandHelp')}</p></div><code className="dsh-rag-code">/rag &lt;question&gt;</code></div>
    </section>
  )
}

function findSearchResult(value: unknown, seen = new Set<unknown>()): ClientSearchResult | undefined {
  if (typeof value === 'string') { try { return findSearchResult(JSON.parse(value) as unknown, seen) } catch { return undefined } }
  if (typeof value !== 'object' || value === null || seen.has(value)) return undefined
  seen.add(value)
  const record = value as Record<string, unknown>
  if ((record.mode === 'local-bm25' || record.mode === 'hybrid-rrf' || record.mode === 'hybrid-reranked') && typeof record.degraded === 'boolean' && Array.isArray(record.sources)) return record as unknown as ClientSearchResult
  for (const child of Object.values(record)) { const result = findSearchResult(child, seen); if (result !== undefined) return result }
  return undefined
}

export function formatLocator(locator: ClientLocator, t: T): string {
  if (locator.kind === 'text') return t('locator.text', { start: locator.lineStart, end: locator.lineEnd })
  if (locator.kind === 'pdf') return t('locator.pdf', { page: locator.page })
  if (locator.kind === 'docx') return t('locator.docx', { start: locator.paragraphStart, end: locator.paragraphEnd })
  return t('locator.pptx', { slide: locator.slide, notes: locator.hasNotes ? t('locator.notes') : '' })
}

function retrievalMode(result: ClientSearchResult, t: T): string {
  if (result.mode === 'hybrid-reranked') return t('tool.modeReranked')
  if (result.mode === 'hybrid-rrf') return t('tool.modeRrf')
  return t('tool.modeBm25')
}

function KnowledgeResultCard({
  result,
  t,
  openFile,
  surface,
}: {
  readonly result: ClientSearchResult | undefined
  readonly t: T
  readonly openFile: (path: string) => void
  readonly surface: 'tool' | 'retrieval'
}): JSX.Element {
  const [notice, setNotice] = useState<Notice>()
  const [expanded, setExpanded] = useState(false)
  const [located, setLocated] = useState<ClientSource>()
  const open = async (sourceId: string): Promise<void> => {
    try { const body = await api<{ path: string }>(`/dsh-rag/api/v1/sources/${encodeURIComponent(sourceId)}/resolve`, { method: 'POST' }); if (surface === 'tool') await api(`/dsh-rag/api/v1/sources/${encodeURIComponent(sourceId)}/open`, { method: 'POST' }); else openFile(body.path); setNotice({ key: 'notice.opened' }) }
    catch (cause) { setNotice({ key: 'error.open', params: { error: String(cause) }, kind: 'error' }) }
  }
  return (
    <article className="dsh-rag dsh-rag-tool" data-dsh-rag-surface={surface}>
      <Styles /><div className="dsh-rag-tool-head"><div><StatusDot tone={result === undefined || result.degraded ? 'warning' : 'success'} /><strong>{t('tool.title')}</strong>{result === undefined ? null : <span className="dsh-rag-tool-count">{t('tool.sourceCount', { count: result.sources.length })}</span>}</div>{result !== undefined && result.sources.length > 1 ? <button className="dsh-rag-link-button" type="button" onClick={() => { setExpanded(value => !value) }}>{expanded ? t('action.collapseSources') : t('action.showMoreSources', { count: result.sources.length - 1 })}</button> : null}</div>
      {result === undefined ? <p className="dsh-rag-tool-mode">{t('tool.pending')}</p> : <p className="dsh-rag-tool-mode">{t('tool.mode')}: {retrievalMode(result, t)}</p>}
      {result?.degraded === true && result.degradedReasons.length > 0 ? <p className="dsh-rag-tool-mode">{t('tool.degradedReason', { reasons: result.degradedReasons.join(' · ') })}</p> : null}
      {result?.sources.slice(0, expanded ? undefined : 1).map(source => <section className="dsh-rag-source" key={`${source.sourceId}:${JSON.stringify(source.locator)}`}><div className="dsh-rag-source-head"><div><strong className="dsh-rag-source-title">[{source.citationId ?? 'S'}] {source.literature?.title ?? source.fileName}</strong><div className="dsh-rag-source-meta">{source.literature === undefined ? source.knowledgeBaseName : `${t(`source.${source.literature.role}`)} · ${source.literature.year ?? ''} · ${source.literature.authors.slice(0, 3).join('; ')}`} · {formatLocator(source.locator, t)}</div>{source.literature?.doi ? <a href={`https://doi.org/${encodeURI(source.literature.doi)}`} target="_blank" rel="noreferrer">DOI: {source.literature.doi}</a> : null}</div><div className="dsh-rag-actions" style={{ marginTop: 0 }}><button className="dsh-rag-button" type="button" onClick={() => { setLocated(source) }}>{t('action.locateSource')}</button>{source.locator.kind === 'pdf' ? <a className="dsh-rag-button" href={`/dsh-rag/api/v1/sources/${encodeURIComponent(source.sourceId)}/pdf#page=${source.locator.page}`} target="_blank" rel="noreferrer">{t('research.openPage')}</a> : <button className="dsh-rag-button" type="button" onClick={() => { void open(source.sourceId) }}>{t('action.openSource')}</button>}</div></div>{source.literature === undefined ? <p className="dsh-rag-context">{source.structuralContext}</p> : null}<blockquote className="dsh-rag-snippet">{source.snippet}</blockquote></section>)}
      {result?.sources.length === 0 ? <p className="dsh-rag-tool-mode">{t('tool.noSources')}</p> : null}
      {notice === undefined ? null : <Message notice={notice} t={t} />}
      {located === undefined ? null : <div className="dsh-rag-locator-panel" role="dialog" aria-modal="false" aria-label={t('locator.previewTitle')}><div className="dsh-rag-source-head"><div><strong>{t('locator.previewTitle')}</strong><div className="dsh-rag-source-meta">{located.fileName} · {formatLocator(located.locator, t)}</div></div><button className="dsh-rag-button" type="button" onClick={() => { setLocated(undefined) }}>{t('action.close')}</button></div><p className="dsh-rag-context">{located.structuralContext}</p><pre className="dsh-rag-locator-text">{located.snippet}</pre><p className="dsh-rag-hint">{t('locator.previewHint')}</p></div>}
    </article>
  )
}

function KnowledgeToolView(props: ToolCallViewProps & LocalizedProps): JSX.Element {
  return <KnowledgeResultCard result={findSearchResult(props.block)} t={props.t} openFile={props.openFile} surface="tool" />
}

function KnowledgeRetrievalView(props: PropsRuntime<'conversation.chat.node', 'dsh-rag/retrieval'> & LocalizedProps): JSX.Element {
  const [retrieval, setRetrieval] = useState<ClientRetrievalRecord>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt = 0): Promise<void> => {
      try {
        const body = await api<{ retrieval: ClientRetrievalRecord }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(String(props.sessionId))}/retrievals/${encodeURIComponent(props.node.data.commandId)}`)
        if (!cancelled) { setRetrieval(body.retrieval); setError(undefined) }
      } catch (cause) {
        if (cancelled) return
        if (attempt < 15) timer = setTimeout(() => { void load(attempt + 1) }, 1000)
        else setError(String(cause))
      }
    }
    void load()
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [props.node.data.commandId, props.sessionId])
  return <><KnowledgeResultCard result={retrieval?.result} t={props.t} openFile={props.openFile} surface="retrieval" />{error === undefined ? null : <Message notice={{ key: 'error.knowledgeLoad', params: { error }, kind: 'error' }} t={props.t} />}</>
}

function DshRagCommandView(props: PropsRuntime<'conversation.chat.commandview', 'rag'>): JSX.Element | null {
  if (props.node.outcome?.text === undefined || ((props.node.args ?? '').trim() !== '' && props.node.outcome.kind === 'success')) return null
  return <div className="dsh-rag dsh-rag-message" role="status"><Styles /><StatusDot tone={props.node.outcome.kind === 'success' ? 'success' : 'danger'} /><span style={{ whiteSpace: 'pre-line' }}>{props.node.outcome.text}</span></div>
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(DSH_RAG_LOCALE_NS, { zh, en }), 'dsh-rag: bilingual UI dictionaries')
  const t = ctx.locale.bind(DSH_RAG_LOCALE_NS)
  const KnowledgeSettingsView = (props: LocalizedProps): JSX.Element => <KnowledgeSettings {...props} openPath={async () => { await api('/dsh-rag/api/v1/storage/open', { method: 'POST' }) }} />
  const KnowledgeConversationView = (props: PropsRuntime<'conversation.view'> & LocalizedProps): JSX.Element => <KnowledgeConversation {...props} ask={async (sessionId, question) => {
    const outcome = await ctx.remote.commands.execute(sessionId as SessionId, `/rag ${question}`, [])
    if (!outcome.ok) throw new Error(outcome.error.message)
    if (outcome.value?.result.kind === 'error') throw new Error(outcome.value.result.text)
  }} />
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-rag', order: 40, label: () => t('nav.settings'), locale: DSH_RAG_LOCALE_NS }, KnowledgeSettingsView))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knowledge', order: 20, label: () => t('nav.conversation'), locale: DSH_RAG_LOCALE_NS }, KnowledgeConversationView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'knowledge_search', locale: DSH_RAG_LOCALE_NS }, KnowledgeToolView))
  ctx.effect(() => ctx.uiConversation.events.register(retrievalStateDefinition), 'dsh-rag: retrieval conversation state')
  ctx.effect(() => ctx.uiConversation.events.register(retrievalConversationDefinition), 'dsh-rag: retrieval conversation card')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'dsh-rag/retrieval', locale: DSH_RAG_LOCALE_NS }, KnowledgeRetrievalView))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'rag', locale: DSH_RAG_LOCALE_NS }, DshRagCommandView))
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  const slashSource: InputTriggerSource = {
    trigger: '/',
    name: 'dsh-rag-knowledge-bases',
    order: -100,
    showGroupTitle: false,
    candidates: async (session, request) => {
      if (request.position !== 'leading' || !isRagSlashQuery(request.query)) return []
      const sessionId = encodeURIComponent(String(session.sessionId))
      const body = await api<{ knowledgeBases: KnowledgeBaseSummary[] }>(`/dsh-rag/api/v1/sessions/${sessionId}/knowledge-bases`, { signal: request.signal })
      return body.knowledgeBases.map(item => ({
        name: `rag · ${item.name}`,
        description: `${t('picker.useOnceDescription')} · ${documentCount(item, t)} · ${syncLabel(item, t)}`,
        icon: 'file',
        section: t('picker.useOnceSection'),
        value: item.name,
      }))
    },
    onPick: ({ candidate }) => ({ text: `/rag ${formatKnowledgeBaseSelector(candidate.value ?? candidate.name)}` }),
  }
  const knowledgeReferenceSource: InputTriggerSource = {
    trigger: '@',
    name: 'dsh-rag-knowledge-bases',
    order: -1000,
    showGroupTitle: false,
    candidates: async (session, request) => {
      if (request.position !== 'inline') return []
      const scope = ctx.sessions.scope(session.sessionId)
      if (scope === undefined) return []
      const draft = ctx.conversation.input.for(scope).state.getSnapshot().draft
      if (!isRagKnowledgeReferenceQuery(draft, request.query)) return []
      const sessionId = encodeURIComponent(String(session.sessionId))
      const body = await api<{ knowledgeBases: KnowledgeBaseSummary[] }>(`/dsh-rag/api/v1/sessions/${sessionId}/knowledge-bases`, { signal: request.signal })
      const query = request.query.replace(/^"/u, '').toLocaleLowerCase()
      return body.knowledgeBases
        .filter(item => item.name.toLocaleLowerCase().includes(query))
        .map(item => ({
          name: item.name,
          description: `${t('picker.useOnceDescription')} · ${documentCount(item, t)} · ${syncLabel(item, t)}`,
          icon: 'file',
          section: t('picker.useOnceSection'),
          value: item.name,
        }))
    },
    onPick: ({ candidate }) => {
      const name = candidate.value ?? candidate.name
      return { text: formatKnowledgeBaseSelector(name) }
    },
  }
  ctx.effect(() => inputTriggers.registerSource(slashSource), 'dsh-rag: contextual slash knowledge-base picker')
  ctx.effect(() => inputTriggers.registerSource(knowledgeReferenceSource), 'dsh-rag: contextual inline knowledge-base picker')
}
