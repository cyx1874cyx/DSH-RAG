import { cp, mkdir, open, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { RuntimeStorageResolution } from './storage-path.ts'

export interface RuntimeStoragePreparation {
  readonly path: string
  readonly source: RuntimeStorageResolution['source']
  readonly status: 'not-needed' | 'migrated' | 'conflict'
  readonly legacyPath?: string
}

const MIGRATION_MARKER = '.legacy-migration.json'

async function hasMatchingMigrationMarker(target: string, legacy: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(path.join(target, MIGRATION_MARKER), 'utf8')) as {
      readonly source?: unknown
      readonly target?: unknown
    }
    return marker.source === path.resolve(legacy) && marker.target === path.resolve(target)
  } catch {
    return false
  }
}

async function directoryState(target: string): Promise<'missing' | 'empty' | 'data'> {
  try {
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error(`storage path is not a directory: ${target}`)
    return (await readdir(target)).length === 0 ? 'empty' : 'data'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function validateJsonFiles(root: string): Promise<void> {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (entry.isFile() && entry.name.endsWith('.json')) JSON.parse(await readFile(entryPath, 'utf8'))
    }
  }
}

export async function prepareRuntimeStorage(
  resolution: RuntimeStorageResolution,
): Promise<RuntimeStoragePreparation> {
  const target = resolution.path
  const legacy = resolution.legacyPath
  if (resolution.source === 'environment' || legacy === undefined || path.resolve(legacy) === path.resolve(target)) {
    await mkdir(target, { recursive: true })
    return { path: target, source: resolution.source, status: 'not-needed' }
  }

  const legacyState = await directoryState(legacy)
  const targetState = await directoryState(target)
  if (legacyState !== 'data') {
    await mkdir(target, { recursive: true })
    return { path: target, source: resolution.source, status: 'not-needed' }
  }
  if (targetState === 'data') {
    return {
      path: target,
      source: resolution.source,
      status: await hasMatchingMigrationMarker(target, legacy) ? 'migrated' : 'conflict',
      legacyPath: legacy,
    }
  }

  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true })
  const migrationId = crypto.randomUUID()
  const temporary = path.join(parent, `${path.basename(target)}.migrating-${migrationId}`)
  const lockPath = path.join(parent, `${path.basename(target)}.migration.lock`)
  let lock: Awaited<ReturnType<typeof open>> | undefined
  let removedEmptyTarget = false
  try {
    lock = await open(lockPath, 'wx')
    await lock.writeFile(JSON.stringify({ source: legacy, target, pid: process.pid }))
    await cp(legacy, temporary, { recursive: true, errorOnExist: true })
    await writeFile(path.join(temporary, MIGRATION_MARKER), JSON.stringify({
      schemaVersion: 1,
      source: path.resolve(legacy),
      target: path.resolve(target),
      migratedAt: new Date().toISOString(),
    }))
    await validateJsonFiles(temporary)
    if (targetState === 'empty') {
      await rmdir(target)
      removedEmptyTarget = true
    }
    await rename(temporary, target)
    return { path: target, source: resolution.source, status: 'migrated', legacyPath: legacy }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if (removedEmptyTarget) await mkdir(target, { recursive: true })
    throw new Error(`DSH-RAG legacy data migration failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await lock?.close()
    if (lock !== undefined) await rm(lockPath, { force: true })
  }
}
