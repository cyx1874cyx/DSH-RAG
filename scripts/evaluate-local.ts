import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { KnowledgeService } from '../src/core/knowledge-service.ts'
import type { LiteratureFilters } from '../src/shared/literature.ts'

const data = process.argv[2]
if (data === undefined) throw new Error('Usage: node --import tsx scripts/evaluate-local.ts <index-directory>')
const service = new KnowledgeService(path.resolve(data))
const bases = await service.listKnowledgeBases()
const ids = bases.map(base => base.id)
const cases: { question: string; filters: LiteratureFilters }[] = [
  { question: 'Clotild CLOT OUT 术中电阻抗 人体研究', filters: { topics: ['EIS'], roles: ['original'] } },
  { question: '红细胞 血小板 电阻抗 spectroscopy Clotbase', filters: { topics: ['EIS'], roles: ['original'] } },
  { question: '光声 无标记 血栓 imaging', filters: { topics: ['PA'], roles: ['original'] } },
  { question: '磁共振 susceptibility vessel sign 红细胞', filters: { topics: ['MRI'], roles: ['original'] } },
  { question: 'NETs 溶栓抵抗 neutrophil extracellular traps', filters: { topics: ['PATH'], roles: ['original'] } },
  { question: 'zzxxyyunknown9182abcdefg', filters: {} },
]
const report = []
for (const item of cases) {
  const start = Date.now()
  const result = await service.search(ids, item.question, 8, undefined, item.filters)
  report.push({ question: item.question, filters: item.filters, elapsedMs: Date.now() - start, mode: result.mode, sources: result.sources.map(source => ({ citationId: source.citationId, title: source.literature?.title, paperId: source.literature?.paperId, role: source.literature?.role, locator: source.locator, snippet: source.snippet.slice(0, 400) })) })
  console.log(JSON.stringify({ query: item.question, count: result.sources.length, ms: Date.now() - start, top: result.sources.slice(0, 3).map(source => ({ id: source.literature?.paperId, page: source.locator.kind === 'pdf' ? source.locator.page : undefined, title: source.literature?.title })) }))
  if (item.filters.roles?.includes('original') && result.sources.some(source => source.literature?.role !== 'original' || source.locator.kind !== 'pdf')) throw new Error('Original-source filter or PDF provenance failed')
  if (item.question.startsWith('zzxx') && result.sources.length !== 0) throw new Error('Unknown query returned spurious evidence')
}
await writeFile(path.join(data, 'retrieval-evaluation.json'), JSON.stringify(report, null, 2), 'utf8')
