import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import { writeJsonAtomic } from '../core/atomic-json.ts'
import {
  DEFAULT_ENDPOINT,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_RERANK_MODEL,
  normalizeSiliconFlowSettings,
  type SiliconFlowProviderSettings,
} from './siliconflow-provider.ts'

export type ProviderRuntimeSettings = SiliconFlowProviderSettings

const schema = z.strictObject({
  schemaVersion: z.literal(1),
  endpoint: z.string(),
  embeddingModel: z.string(),
  rerankModel: z.string(),
  generationModel: z.string().optional(),
})

function normalize(input: Partial<ProviderRuntimeSettings> = {}): ProviderRuntimeSettings {
  return normalizeSiliconFlowSettings(input)
}

export class ProviderSettingsStore {
  private current: ProviderRuntimeSettings

  constructor(private readonly filePath: string) {
    try {
      const parsed = schema.parse(JSON.parse(readFileSync(filePath, 'utf8')))
      this.current = normalize(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.current = normalize({
        endpoint: DEFAULT_ENDPOINT,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        rerankModel: DEFAULT_RERANK_MODEL,
      })
    }
  }

  get(): ProviderRuntimeSettings {
    return { ...this.current }
  }

  async set(input: ProviderRuntimeSettings): Promise<ProviderRuntimeSettings> {
    const next = normalize(input)
    await writeJsonAtomic(this.filePath, { schemaVersion: 1, ...next })
    this.current = next
    return this.get()
  }

  static at(storagePath: string): ProviderSettingsStore {
    return new ProviderSettingsStore(path.join(storagePath, 'provider-settings.json'))
  }
}
