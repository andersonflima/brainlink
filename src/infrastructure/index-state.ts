import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type IndexedFileSnapshot = {
  readonly path: string
  readonly mtimeMs: number
  readonly size: number
}

export type IndexState = {
  readonly version: 1
  readonly updatedAt: string
  readonly chunkSize: number
  readonly embeddingProvider: string
  readonly files: readonly IndexedFileSnapshot[]
  readonly pendingPackChanges: number
}

const indexStateFileName = 'index-state.json'

const toIndexStatePath = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', indexStateFileName)

export const readIndexState = async (vaultPath: string): Promise<IndexState | null> => {
  try {
    const parsed = JSON.parse(await readFile(toIndexStatePath(vaultPath), 'utf8')) as Partial<IndexState>

    if (parsed.version !== 1 || !Array.isArray(parsed.files)) {
      return null
    }

    const files = parsed.files.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const row = entry as Partial<IndexedFileSnapshot>
      if (typeof row.path !== 'string' || typeof row.mtimeMs !== 'number' || typeof row.size !== 'number') {
        return []
      }

      return [
        {
          path: row.path,
          mtimeMs: row.mtimeMs,
          size: row.size
        }
      ]
    })

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      chunkSize: typeof parsed.chunkSize === 'number' ? parsed.chunkSize : 1200,
      embeddingProvider: typeof parsed.embeddingProvider === 'string' ? parsed.embeddingProvider : 'none',
      files,
      pendingPackChanges: typeof parsed.pendingPackChanges === 'number' && parsed.pendingPackChanges >= 0 ? parsed.pendingPackChanges : 0
    }
  } catch {
    return null
  }
}

export const writeIndexState = async (vaultPath: string, state: Omit<IndexState, 'version' | 'updatedAt'>): Promise<void> => {
  const payload: IndexState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    chunkSize: state.chunkSize,
    embeddingProvider: state.embeddingProvider,
    files: [...state.files].sort((left, right) => left.path.localeCompare(right.path)),
    pendingPackChanges: Math.max(0, Math.floor(state.pendingPackChanges))
  }

  await writeFile(toIndexStatePath(vaultPath), `${JSON.stringify(payload)}\n`, 'utf8')
}
