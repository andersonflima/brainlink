import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { ensureVault, listVaultFiles, resolveVaultPath } from '../infrastructure/file-system-vault.js'

export type VaultMigrationResult = {
  readonly source: string
  readonly target: string
  readonly copied: number
  readonly unchanged: number
  readonly conflicted: number
}

const directoryMode = 0o700
const fileMode = 0o600

const timestamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z')

const isPathInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)

  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

const conflictPath = (targetPath: string): string => {
  const extension = extname(targetPath)
  const base = extension ? targetPath.slice(0, -extension.length) : targetPath

  return `${base}.conflict-${timestamp()}${extension}`
}

const writePreservedFile = async (absolutePath: string, content: Buffer): Promise<void> => {
  await mkdir(dirname(absolutePath), { recursive: true, mode: directoryMode })
  await writeFile(absolutePath, content, { mode: fileMode })
  await chmod(absolutePath, fileMode)
}

export const migrateVaultContent = async (sourceVault: string, targetVault: string): Promise<VaultMigrationResult> => {
  const source = await ensureVault(sourceVault)
  const target = await ensureVault(targetVault)

  if (source === target) {
    return { source, target, copied: 0, unchanged: 0, conflicted: 0 }
  }

  const sourceFiles = await listVaultFiles(source)

  const migrated = await sourceFiles.reduce<Promise<VaultMigrationResult>>(async (statePromise, sourceFile) => {
    const state = await statePromise
    const targetFile = join(target, relative(source, sourceFile))

    if (!isPathInside(target, targetFile)) {
      return state
    }

    const sourceContent = await readFile(sourceFile)

    try {
      const targetContent = await readFile(targetFile)

      if (sourceContent.equals(targetContent)) {
        return { ...state, unchanged: state.unchanged + 1 }
      }

      await writePreservedFile(conflictPath(targetFile), sourceContent)

      return { ...state, conflicted: state.conflicted + 1 }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error
      }

      await writePreservedFile(targetFile, sourceContent)

      return { ...state, copied: state.copied + 1 }
    }
  }, Promise.resolve({ source, target, copied: 0, unchanged: 0, conflicted: 0 }))

  return migrated
}

export const shouldMigrateDefaultVault = async (sourceVault: string, targetVault: string): Promise<boolean> => {
  const source = resolveVaultPath(sourceVault)
  const target = resolveVaultPath(targetVault)

  if (source === target) {
    return false
  }

  const [sourceFiles, targetFiles] = await Promise.all([listVaultFiles(source), listVaultFiles(target)])

  return sourceFiles.length > 0 && targetFiles.length === 0
}
