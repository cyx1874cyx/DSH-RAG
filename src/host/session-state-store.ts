import path from 'node:path'
import { readJsonIfExists, writeJsonAtomic } from '../core/atomic-json.ts'
import type { SearchResult } from '../core/knowledge-types.ts'
import { normalizeKnowledgeBaseIds } from './selection.ts'

export interface RetrievalCardRecord {
  readonly commandId: string
  readonly sessionId: string
  readonly knowledgeBaseNames: readonly string[]
  readonly result: SearchResult
}

interface SessionStateFile {
  readonly schemaVersion: 1
  readonly selections: Record<string, string[]>
  readonly parents: Record<string, string>
  readonly retrievals: Record<string, RetrievalCardRecord>
}

function emptyState(): SessionStateFile {
  return { schemaVersion: 1, selections: {}, parents: {}, retrievals: {} }
}

export class SessionStateStore {
  readonly #filePath: string
  #queue: Promise<void> = Promise.resolve()

  constructor(dataDirectory: string) {
    this.#filePath = path.join(dataDirectory, 'session-state.json')
  }

  async rememberParent(sessionId: string, parentSessionId: string | undefined): Promise<void> {
    if (parentSessionId === undefined) return
    await this.#mutate(state => {
      state.parents[sessionId] = parentSessionId
    })
  }

  async getSelection(sessionId: string): Promise<string[]> {
    return await this.#read(state => {
      const seen = new Set<string>()
      let current: string | undefined = sessionId
      while (current !== undefined && !seen.has(current)) {
        seen.add(current)
        const selected = state.selections[current]
        if (selected !== undefined) return [...selected]
        current = state.parents[current]
      }
      return []
    })
  }

  async setSelection(sessionId: string, ids: readonly string[]): Promise<string[]> {
    const selected = normalizeKnowledgeBaseIds(ids)
    await this.#mutate(state => {
      state.selections[sessionId] = selected
    })
    return selected
  }

  async removeKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    await this.#mutate(state => {
      for (const [sessionId, selected] of Object.entries(state.selections)) {
        state.selections[sessionId] = selected.filter(id => id !== knowledgeBaseId)
      }
    })
  }

  async saveRetrieval(record: RetrievalCardRecord): Promise<void> {
    await this.#mutate(state => {
      state.retrievals[record.commandId] = record
    })
  }

  async getRetrieval(sessionId: string, commandId: string): Promise<RetrievalCardRecord | undefined> {
    return await this.#read(state => {
      const record = state.retrievals[commandId]
      return record?.sessionId === sessionId ? record : undefined
    })
  }

  async #load(): Promise<SessionStateFile> {
    const state = await readJsonIfExists<SessionStateFile>(this.#filePath)
    return state?.schemaVersion === 1 ? state : emptyState()
  }

  async #read<T>(reader: (state: SessionStateFile) => T): Promise<T> {
    let result!: T
    const operation = this.#queue.then(async () => {
      result = reader(await this.#load())
    })
    this.#queue = operation.then(() => undefined, () => undefined)
    await operation
    return result
  }

  async #mutate(change: (state: SessionStateFile) => void): Promise<void> {
    const operation = this.#queue.then(async () => {
      const state = await this.#load()
      change(state)
      await writeJsonAtomic(this.#filePath, state)
    })
    this.#queue = operation.then(() => undefined, () => undefined)
    await operation
  }
}
