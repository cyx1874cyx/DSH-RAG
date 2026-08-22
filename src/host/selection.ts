import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

export interface KnowledgeSelectionProjection {
  readonly selectedKnowledgeBaseIds: readonly string[]
}

export function normalizeKnowledgeBaseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))].sort()
}

export function foldKnowledgeSelection(events: readonly SessionEvent[]): string[] {
  let selected: string[] = []
  for (const event of events) {
    if (event.type === 'dsh-rag/selection') {
      selected = normalizeKnowledgeBaseIds(event.data.knowledgeBaseIds)
    }
  }
  return selected
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'dsh-rag/selection': { knowledgeBaseIds: string[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'dsh-rag': KnowledgeSelectionProjection
  }

  interface SessionProjectionStateMap {
    'dsh-rag': KnowledgeSelectionProjection
  }
}
