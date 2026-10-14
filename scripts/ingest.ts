import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { KnowledgeService } from '../src/core/knowledge-service.ts'

const args = process.argv.slice(2)
const value = (key: string): string | undefined => args[args.indexOf(key) + 1]
const corpus = value('--corpus')
const data = value('--data')
if (!args.includes('--corpus') || !args.includes('--data') || corpus === undefined || data === undefined) {
  throw new Error('Usage: node --import tsx scripts/ingest.ts --corpus <folder> --data <index-folder> [--name <name>]')
}
const name = args.includes('--name') ? value('--name') ?? '血栓文献' : '血栓文献'
const service = new KnowledgeService(path.resolve(data))
const existing = (await service.listKnowledgeBases()).find(item => item.name === name)
const base = existing ?? await service.createKnowledgeBase(name, [path.resolve(corpus)])
const started = Date.now()
const result = await service.sync(base.id, { afterFile: progress => {
  if (progress.completedFiles % 25 === 0 || progress.completedFiles === progress.totalFiles) {
    console.log(`Indexed ${progress.completedFiles}/${progress.totalFiles} files; elapsed ${Math.round((Date.now() - started) / 1000)}s`)
  }
} })
const summary = (await service.listKnowledgeBases()).find(item => item.id === base.id)
await mkdir(path.resolve(data), { recursive: true })
await writeFile(path.join(data, 'ingestion-report.json'), JSON.stringify({ result, summary, durationSeconds: (Date.now() - started) / 1000 }, null, 2), 'utf8')
let inputCounts: unknown
try { inputCounts = (JSON.parse(await readFile(path.join(corpus, 'literature-manifest.json'), 'utf8')) as { counts: unknown }).counts } catch { inputCounts = undefined }
console.log(JSON.stringify({ inputCounts, result, summary }, null, 2))
if (result.counts.failed > 0) process.exitCode = 2
