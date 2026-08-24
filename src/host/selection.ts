export function normalizeKnowledgeBaseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))].sort()
}
