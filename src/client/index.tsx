import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { DSH_RAG_LOCALE_NS, en, type DshRagLocaleKey, zh } from './locales.ts'
import { DSH_RAG_STYLES } from './styles.ts'

export const inject = ['slots', 'locale']

type T = TranslateNS<typeof DSH_RAG_LOCALE_NS>
type LocalizedProps = PropsLocale<typeof DSH_RAG_LOCALE_NS>
type Tone = 'neutral' | 'success' | 'warning' | 'danger'

interface Notice {
  readonly key: DshRagLocaleKey
  readonly params?: Record<string, unknown>
  readonly kind?: 'status' | 'error'
}

interface ProbeState {
  readonly state: 'loading' | 'connected' | 'disconnected'
  readonly configured?: boolean
  readonly error?: string
}

interface ProviderSettingsState {
  readonly credential: {
    readonly configured: boolean
    readonly source: string
    readonly osVaultAvailable: boolean
    readonly osVaultWritable: boolean
    readonly osVaultBackend: string
    readonly sessionWritable: boolean
  }
  readonly endpoint: string
  readonly models: { readonly embedding: string; readonly rerank: string }
  readonly dataTransfer: { readonly originalBinaryUploads: boolean }
  readonly capabilities: { readonly aiContext: { readonly available: false; readonly reason: string } }
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
}

interface ClientSearchResult {
  readonly mode: 'local-bm25' | 'hybrid-rrf' | 'hybrid-reranked'
  readonly degraded: boolean
  readonly degradedReasons: readonly string[]
  readonly sources: readonly ClientSource[]
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

function useKnowledgeBases(): {
  readonly knowledgeBases: readonly KnowledgeBaseSummary[]
  readonly refresh: () => Promise<void>
  readonly error?: string
} {
  const [knowledgeBases, setKnowledgeBases] = useState<readonly KnowledgeBaseSummary[]>([])
  const [error, setError] = useState<string>()
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const body = await api<{ knowledgeBases: KnowledgeBaseSummary[] }>('/dsh-rag/api/v1/knowledge-bases')
      setKnowledgeBases(body.knowledgeBases)
      setError(undefined)
    } catch (cause) {
      setError(String(cause))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { knowledgeBases, refresh, ...(error === undefined ? {} : { error }) }
}

function useHostProbe(): ProbeState {
  const [state, setState] = useState<ProbeState>({ state: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/dsh-rag/api/m0', { signal: controller.signal, credentials: 'same-origin' })
      .then(async response => {
        const body = await response.json() as { ok?: boolean; credential?: { configured?: boolean }; error?: string }
        setState({
          state: response.ok && body.ok === true ? 'connected' : 'disconnected',
          ...(typeof body.credential?.configured === 'boolean' ? { configured: body.credential.configured } : {}),
          ...(body.error === undefined ? {} : { error: body.error }),
        })
      })
      .catch(error => {
        if (!controller.signal.aborted) setState({ state: 'disconnected', error: String(error) })
      })
    return () => { controller.abort() }
  }, [])
  return state
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

function KnowledgeSettings({ t }: LocalizedProps): JSX.Element {
  const probe = useHostProbe()
  const { provider, refreshProvider, providerError } = useProviderSettings()
  const { knowledgeBases, refresh, error } = useKnowledgeBases()
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

  const saveCredential = async (persistence: 'os' | 'session'): Promise<void> => {
    setBusy(`credential:${persistence}`); setNotice(undefined)
    try {
      await api('/dsh-rag/api/v1/provider/credential', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey, persistence }) })
      setApiKey(''); await refreshProvider(); setNotice({ key: persistence === 'os' ? 'notice.credentialVault' : 'notice.credentialSession' })
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

  const testProvider = async (): Promise<void> => {
    setBusy('provider:test'); setNotice({ key: 'notice.testing' })
    try {
      const body = await api<{ probe: { ok: boolean; embedding: { status: string; latencyMs: number }; rerank: { status: string; latencyMs: number } } }>('/dsh-rag/api/v1/provider/test', { method: 'POST' })
      setNotice({ key: 'notice.testResult', params: { result: t(body.probe.ok ? 'notice.passed' : 'notice.failed'), embedding: body.probe.embedding.status, embeddingMs: body.probe.embedding.latencyMs, reranker: body.probe.rerank.status, rerankerMs: body.probe.rerank.latencyMs }, ...(body.probe.ok ? {} : { kind: 'error' as const }) })
    } catch (cause) { setNotice({ key: 'error.testConnection', params: { error: String(cause) }, kind: 'error' }) } finally { setBusy(undefined) }
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

  const credentialConfigured = provider?.credential.configured === true || probe.configured === true
  const credentialSource = provider?.credential.source

  return (
    <section className="dsh-rag dsh-rag-page" data-dsh-rag-surface="settings">
      <Styles />
      <header className="dsh-rag-header"><div><div className="dsh-rag-eyebrow"><KnowledgeIcon />DSH-RAG</div><h2 className="dsh-rag-title">{t('settings.title')}</h2><p className="dsh-rag-subtitle">{t('settings.subtitle')}</p></div></header>
      <div className="dsh-rag-status-grid">
        <div className="dsh-rag-status-card"><div className="dsh-rag-status-label">{t('status.host')}</div><div className="dsh-rag-status-value"><StatusDot tone={probe.state === 'connected' ? 'success' : probe.state === 'loading' ? 'neutral' : 'danger'} /><span>{t(probe.state === 'connected' ? 'status.connected' : probe.state === 'loading' ? 'status.loading' : 'status.disconnected')}</span></div></div>
        <div className="dsh-rag-status-card"><div className="dsh-rag-status-label">{t('status.credential')}</div><div className="dsh-rag-status-value"><StatusDot tone={credentialConfigured ? 'success' : 'warning'} /><span>{credentialConfigured ? t('status.configured') : t('status.unconfigured')}{credentialConfigured && credentialSource !== undefined ? ` · ${credentialSource}` : ''}</span></div></div>
        <div className="dsh-rag-status-card"><div className="dsh-rag-status-label">{t('status.retrieval')}</div><div className="dsh-rag-status-value"><StatusDot tone="warning" /><span>{t('status.localBm25')}</span></div><p className="dsh-rag-status-note">{t('status.localBm25Hint')}</p></div>
      </div>
      <aside className="dsh-rag-boundary"><BoundaryIcon /><div><strong>{t('cloud.title')}</strong><p>{t('cloud.description')}</p></div></aside>
      {notice === undefined ? null : <Message notice={notice} t={t} />}
      {providerError === undefined ? null : <Message notice={{ key: 'error.providerState', params: { error: providerError }, kind: 'error' }} t={t} />}
      {error === undefined ? null : <Message notice={{ key: 'error.knowledgeLoad', params: { error }, kind: 'error' }} t={t} />}

      <section className="dsh-rag-card">
        <header className="dsh-rag-card-head"><div><h3 className="dsh-rag-card-title">{t('provider.title')}</h3><p className="dsh-rag-card-description">{t('provider.subtitle')}</p></div><StatusDot tone={credentialConfigured ? 'success' : 'warning'} /></header>
        <div className="dsh-rag-card-body">
          <div className="dsh-rag-form-grid">
            <label className="dsh-rag-field" data-span="full">{t('provider.endpoint')}<input className="dsh-rag-input" aria-label={t('provider.endpoint')} value={endpoint} onChange={event => { setEndpoint(event.target.value) }} /></label>
            <label className="dsh-rag-field">{t('provider.embedding')}<input className="dsh-rag-input" aria-label={t('provider.embedding')} value={embeddingModel} onChange={event => { setEmbeddingModel(event.target.value) }} /></label>
            <label className="dsh-rag-field">{t('provider.reranker')}<input className="dsh-rag-input" aria-label={t('provider.reranker')} value={rerankModel} onChange={event => { setRerankModel(event.target.value) }} /></label>
          </div>
          <div className="dsh-rag-actions"><button className="dsh-rag-button" data-variant="primary" type="button" disabled={busy !== undefined || endpoint.trim() === '' || embeddingModel.trim() === '' || rerankModel.trim() === ''} onClick={() => { void saveProviderConfig() }}>{busy === 'provider:config' ? t('action.saving') : t('action.saveConfig')}</button></div>
          <p className="dsh-rag-hint">{t('provider.endpointHint')}</p><div className="dsh-rag-divider" />
          <label className="dsh-rag-field">{t('provider.apiKey')}<input className="dsh-rag-input" aria-label={t('provider.apiKey')} type="password" autoComplete="off" value={apiKey} onChange={event => { setApiKey(event.target.value) }} /></label>
          <div className="dsh-rag-actions">
            <button className="dsh-rag-button" data-variant="primary" type="button" disabled={busy !== undefined || apiKey.trim() === '' || provider?.credential.osVaultWritable !== true} onClick={() => { void saveCredential('os') }}>{t('action.saveVault')}</button>
            <button className="dsh-rag-button" type="button" disabled={busy !== undefined || apiKey.trim() === ''} onClick={() => { void saveCredential('session') }}>{t('action.useSession')}</button>
            <button className="dsh-rag-button" type="button" disabled={busy !== undefined || provider?.credential.configured !== true} onClick={() => { void testProvider() }}>{busy === 'provider:test' ? t('action.testing') : t('action.testConnection')}</button>
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
              <div className="dsh-rag-library-top"><div><div className="dsh-rag-library-name"><StatusDot tone={syncTone(item.syncStatus.state)} /><span>{item.name}</span></div><div className="dsh-rag-meta"><span>{t('knowledge.documents', { count: item.documentCount })}</span><span>{t('knowledge.chunks', { count: item.chunkCount })}</span><span>{t('knowledge.generation', { count: item.generation })}</span><span>{syncLabel(item, t)}</span><span>{t('knowledge.checkpoints', { count: item.syncStatus.reusedCheckpointFiles })}</span></div></div>
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

function KnowledgeConversation(props: PropsRuntime<'conversation.view'> & LocalizedProps): JSX.Element {
  const { t } = props
  const { knowledgeBases, error } = useKnowledgeBases()
  const [selected, setSelected] = useState<readonly string[]>([])
  const [notice, setNotice] = useState<Notice>()
  const sessionId = String(props.sessionId)

  useEffect(() => {
    void api<{ selectedKnowledgeBaseIds: string[] }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/selection`).then(body => { setSelected(body.selectedKnowledgeBaseIds) }).catch(cause => { setNotice({ key: 'error.selectionLoad', params: { error: String(cause) }, kind: 'error' }) })
  }, [sessionId])

  const update = async (id: string, checked: boolean): Promise<void> => {
    const next = checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id)
    try {
      const body = await api<{ selectedKnowledgeBaseIds: string[] }>(`/dsh-rag/api/v1/sessions/${encodeURIComponent(sessionId)}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ knowledgeBaseIds: next }) })
      setSelected(body.selectedKnowledgeBaseIds); setNotice({ key: body.selectedKnowledgeBaseIds.length === 0 ? 'notice.selectionEmpty' : 'notice.selectionSaved' })
    } catch (cause) { setNotice({ key: 'error.selectionSave', params: { error: String(cause) }, kind: 'error' }) }
  }

  return (
    <section className="dsh-rag dsh-rag-page dsh-rag-conversation" data-dsh-rag-surface="conversation">
      <Styles />
      <header className="dsh-rag-header"><div><div className="dsh-rag-eyebrow"><KnowledgeIcon />DSH-RAG</div><h2 className="dsh-rag-title">{t('conversation.title')}</h2><p className="dsh-rag-subtitle">{t('conversation.subtitle')}</p></div><span className="dsh-rag-counter">{t('conversation.selectedCount', { selected: selected.length, total: knowledgeBases.length })}</span></header>
      {knowledgeBases.length === 0 ? <div className="dsh-rag-empty">{t('conversation.empty')}</div> : <div className="dsh-rag-check-list">{knowledgeBases.map(item => {
        const checked = selected.includes(item.id)
        return <label className="dsh-rag-check-row" data-selected={checked} key={item.id}><input className="dsh-rag-checkbox" type="checkbox" checked={checked} onChange={event => { void update(item.id, event.target.checked) }} /><span className="dsh-rag-check-copy"><span className="dsh-rag-check-name">{item.name}</span><span className="dsh-rag-check-meta">{t('knowledge.documents', { count: item.documentCount })} · {syncLabel(item, t)}</span></span><StatusDot tone={syncTone(item.syncStatus.state)} /></label>
      })}</div>}
      {error === undefined ? null : <Message notice={{ key: 'error.knowledgeLoad', params: { error }, kind: 'error' }} t={t} />}
      {notice === undefined ? null : <Message notice={notice} t={t} />}
      <div className="dsh-rag-command"><div><strong>{t('conversation.commandTitle')}</strong><p>{t('conversation.commandHelp')}</p></div><code className="dsh-rag-code">/dsh-rag &lt;question&gt;</code></div>
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

function KnowledgeToolView(props: ToolCallViewProps & LocalizedProps): JSX.Element {
  const { t } = props
  const result = findSearchResult(props.block)
  const [notice, setNotice] = useState<Notice>()
  const open = async (sourceId: string): Promise<void> => {
    try { const body = await api<{ path: string }>(`/dsh-rag/api/v1/sources/${encodeURIComponent(sourceId)}/resolve`, { method: 'POST' }); props.openFile(body.path); setNotice({ key: 'notice.opened' }) }
    catch (cause) { setNotice({ key: 'error.open', params: { error: String(cause) }, kind: 'error' }) }
  }
  return (
    <article className="dsh-rag dsh-rag-tool" data-dsh-rag-surface="tool">
      <Styles /><div className="dsh-rag-tool-head"><StatusDot tone={result === undefined || result.degraded ? 'warning' : 'success'} /><strong>{t('tool.title')}</strong></div>
      {result === undefined ? <p className="dsh-rag-tool-mode">{t('tool.pending')}</p> : <p className="dsh-rag-tool-mode">{t('tool.mode')}: {retrievalMode(result, t)}</p>}
      {result?.degraded === true && result.degradedReasons.length > 0 ? <p className="dsh-rag-tool-mode">{t('tool.degradedReason', { reasons: result.degradedReasons.join(' · ') })}</p> : null}
      {result?.sources.map(source => <section className="dsh-rag-source" key={`${source.sourceId}:${JSON.stringify(source.locator)}`}><div className="dsh-rag-source-head"><div><strong className="dsh-rag-source-title">{source.knowledgeBaseName} · {source.fileName}</strong><div className="dsh-rag-source-meta">{formatLocator(source.locator, t)} · {t('tool.score', { score: source.score })}</div></div><button className="dsh-rag-button" type="button" onClick={() => { void open(source.sourceId) }}>{t('action.openSource')}</button></div><p className="dsh-rag-context">{source.structuralContext}</p><blockquote className="dsh-rag-snippet">{source.snippet}</blockquote></section>)}
      {result?.sources.length === 0 ? <p className="dsh-rag-tool-mode">{t('tool.noSources')}</p> : null}
      {notice === undefined ? null : <Message notice={notice} t={t} />}
    </article>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(DSH_RAG_LOCALE_NS, { zh, en }), 'dsh-rag: bilingual UI dictionaries')
  const t = ctx.locale.bind(DSH_RAG_LOCALE_NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-rag', order: 40, label: () => t('nav.settings'), locale: DSH_RAG_LOCALE_NS }, KnowledgeSettings))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knowledge', order: 20, label: () => t('nav.conversation'), locale: DSH_RAG_LOCALE_NS }, KnowledgeConversation))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'knowledge_search', locale: DSH_RAG_LOCALE_NS }, KnowledgeToolView))
}
