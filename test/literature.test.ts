import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { diversifySources, expandMedicalQuery, matchesLiterature, readLiteratureMetadata } from '../src/core/literature.ts'
import { KnowledgeService } from '../src/core/knowledge-service.ts'
import { renderRetrievalContext } from '../src/core/retrieval-context.ts'

test('Chinese clinical queries retrieve English evidence, with bounded citations and source roles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'thrombus-rag-'))
  const corpus = path.join(root, 'corpus')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(corpus)
  await writeFile(path.join(corpus, 'paper.md'), '# Methods\nElectrical impedance spectroscopy identified erythrocyte rich clots.\n\n# Results\nThe study measured ex vivo clot composition, not treatment benefit.\n')
  await writeFile(path.join(corpus, 'note.md'), '# Reading note\n这是一份精读笔记。电阻抗谱与红细胞比例相关。\n')
  await writeFile(path.join(corpus, 'other.md'), '# Ultrasound\nPhotoacoustic imaging detects optical absorption of hemoglobin.\n')
  await writeFile(path.join(corpus, 'literature-manifest.json'), JSON.stringify({
    papers: [{ gid: 'G001', title: 'Synthetic impedance study', authors: ['Test Author'], year: '2023', doi: 'https://doi.org/10.0000/TEST', module_all: ['EIS'] }, { gid: 'G002', title: 'Synthetic photoacoustic study', authors: [], year: '2024', module_all: ['PA'] }],
    files: [{ path: 'paper.md', paper_id: 'G001', role: 'original' }, { path: 'note.md', paper_id: 'G001', role: 'reading_note' }, { path: 'other.md', paper_id: 'G002', role: 'original' }],
  }))
  const service = new KnowledgeService(path.join(root, 'index'))
  const kb = await service.createKnowledgeBase('Test', [corpus])
  const synced = await service.sync(kb.id)
  assert.equal(synced.counts.failed, 0)
  const result = await service.search([kb.id], '电阻抗检测红细胞', 8, undefined, { roles: ['original'], topics: ['EIS'], yearFrom: 2022 })
  assert.ok(result.sources.length > 0)
  assert.ok(result.sources.every(s => s.literature?.role === 'original' && s.literature.topics.includes('EIS')))
  assert.equal(result.sources[0]?.literature?.doi, '10.0000/test')
  assert.equal(result.sources[0]?.citationId, 'S1')
  assert.equal(result.degraded, false)
  assert.equal((await service.search([kb.id], 'zzxyxunknown9182')).sources.length, 0)
  assert.equal((await service.search([kb.id], 'impedance', 8, undefined, { yearFrom: 2025 })).sources.length, 0)
  const text = renderRetrievalContext(result, ['Test'])
  assert.ok(text.includes('PDF 文件页码'))
  assert.ok(text.includes('reading_note'))
  assert.ok(!text.includes(corpus))
  const again = await service.sync(kb.id)
  assert.equal(again.counts.added, 0)
  assert.equal(again.counts.unchanged, 3)
  assert.equal(again.generation, synced.generation, 'Unchanged recovery scans must not rewrite the whole catalog')
})

test('Metadata strips paths and mixed-case DOI prefixes; filters do not invent years', async () => {
  assert.ok(expandMedicalQuery('光声与NETs').includes('photoacoustic'))
  assert.equal(matchesLiterature(undefined, { yearFrom: 2020 }), false)
  assert.equal(matchesLiterature(undefined, {}), true)
  assert.equal(await readLiteratureMetadata(os.tmpdir(), 'missing.txt'), undefined)
})

test('Source diversity counts a paper and its reading note as one article', () => {
  const metadata = { paperId: 'G001', title: 'Test', doi: '', authors: [], topics: ['EIS'], role: 'original' as const }
  const sources = [{ sourceId: 'a', literature: metadata }, { sourceId: 'b', literature: metadata }, { sourceId: 'c', literature: metadata }, { sourceId: 'd' }]
  assert.deepEqual(diversifySources(sources, 4, 2).map(s => s.sourceId), ['a', 'b', 'd'])
})
