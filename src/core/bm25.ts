import type { KnowledgeBaseConfig, KnowledgeCatalog, SearchSource } from './knowledge-types.ts'

const WORD = /[\p{Script=Han}]|[\p{Letter}\p{Number}]+/gu

export type Tokenizer = (value: string) => string[]

export function tokenizeUnicode(value: string): string[] {
  return [...value.toLocaleLowerCase().matchAll(WORD)].map(match => match[0] ?? '').filter(Boolean)
}

export function tokenize(value: string): string[] {
  const base = tokenizeUnicode(value)
  const han = base.filter(token => /^\p{Script=Han}$/u.test(token))
  const bigrams = han.slice(0, -1).map((token, index) => `${token}${han[index + 1] ?? ''}`)
  return [...base, ...bigrams]
}

export function tokenizeTrigram(value: string): string[] {
  const characters = [...value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()]
  if (characters.length < 3) return []
  return characters.slice(0, -2).map((character, index) => `${character}${characters[index + 1] ?? ''}${characters[index + 2] ?? ''}`)
}

const wordSegmenter = new Intl.Segmenter(['zh', 'en'], { granularity: 'word' })

export function tokenizeSegmented(value: string): string[] {
  return [...wordSegmenter.segment(value.normalize('NFKC').toLocaleLowerCase())]
    .filter(item => item.isWordLike)
    .map(item => item.segment)
}

export function tokenizeHybridSegmented(value: string): string[] {
  return [...new Set([...tokenize(value), ...tokenizeSegmented(value)])]
}

export function selectTokenizer(query: string): Tokenizer {
  return /\p{Script=Han}/u.test(query) ? tokenizeHybridSegmented : tokenize
}

export interface Bm25Item {
  readonly id: string
  readonly text: string
}

export interface Bm25Rank {
  readonly id: string
  readonly score: number
}

export function rankBm25(
  items: readonly Bm25Item[],
  query: string,
  limit = 5,
  tokenizer: Tokenizer = tokenize,
): Bm25Rank[] {
  const queryTerms = [...new Set(tokenizer(query))]
  if (queryTerms.length === 0 || limit <= 0 || items.length === 0) return []
  const rows = items.map(item => ({ item, terms: tokenizer(item.text) }))
  const avgLength = rows.reduce((sum, row) => sum + row.terms.length, 0) / rows.length
  const documentFrequency = new Map<string, number>()
  for (const term of queryTerms) documentFrequency.set(term, rows.filter(row => row.terms.includes(term)).length)
  const k1 = 1.2
  const b = 0.75
  return rows.map(row => {
    let score = 0
    for (const term of queryTerms) {
      const frequency = row.terms.filter(token => token === term).length
      if (frequency === 0) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (rows.length - df + 0.5) / (df + 0.5))
      const lengthNorm = 1 - b + b * row.terms.length / Math.max(avgLength, 1)
      score += idf * frequency * (k1 + 1) / (frequency + k1 * lengthNorm)
    }
    return { id: row.item.id, score }
  }).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(item => ({ id: item.id, score: Number(item.score.toFixed(6)) }))
}

interface SearchCorpus {
  readonly config: KnowledgeBaseConfig
  readonly catalog: KnowledgeCatalog
}

export function searchBm25(
  corpora: readonly SearchCorpus[],
  query: string,
  limit = 5,
  aiContextByChunkId: ReadonlyMap<string, string> = new Map(),
): SearchSource[] {
  const rows = corpora.flatMap(({ config, catalog }) => catalog.documents.flatMap(document => document.chunks.map(chunk => ({
    config,
    document,
    chunk,
  }))))
  const rowById = new Map(rows.map(row => [row.chunk.id, row]))
  return rankBm25(
    rows.map(row => ({
      id: row.chunk.id,
      text: `${row.chunk.structuralContext}\n${aiContextByChunkId.get(row.chunk.id) ?? ''}\n${row.chunk.text}`,
    })),
    query,
    limit,
    selectTokenizer(query),
  )
    .map(({ id, score }) => {
      const row = rowById.get(id)
      if (row === undefined) throw new Error('BM25 row identity invariant failed')
      return ({
      chunkId: row.chunk.id,
      sourceId: row.document.sourceId,
      knowledgeBaseId: row.config.id,
      knowledgeBaseName: row.config.name,
      fileName: row.document.displayName,
      locator: row.chunk.locator,
      snippet: row.chunk.text,
      structuralContext: row.chunk.structuralContext,
      score: Number(score.toFixed(6)),
      })
    })
}
