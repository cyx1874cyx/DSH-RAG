import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export interface RuntimeStorageResolution {
  readonly path: string
  readonly source: 'environment' | 'dsh-home'
  readonly legacyPath?: string
}

export function resolveRuntimeStorage(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): RuntimeStorageResolution {
  const explicit = env.DSH_RAG_DATA_DIR?.trim()
  if (explicit !== undefined && explicit !== '') {
    if (!path.isAbsolute(explicit)) throw new Error('DSH_RAG_DATA_DIR must be an absolute path')
    return { path: path.normalize(explicit), source: 'environment' }
  }

  return {
    path: path.join(resolveDshHome(undefined, env), 'dsh-rag'),
    source: 'dsh-home',
    legacyPath: path.join(path.resolve(cwd), '.dsh-rag'),
  }
}
