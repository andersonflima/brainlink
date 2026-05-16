import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { ensureVault, isBucketVaultPath, listVaultFiles, resolveVaultPath, writeMarkdownFile } from '../infrastructure/file-system-vault.js'

export type VaultMigrationResult = {
  readonly source: string
  readonly target: string
  readonly copied: number
  readonly unchanged: number
  readonly conflicted: number
}

export type VaultMigrationAction = {
  readonly sourcePath: string
  readonly targetPath: string
  readonly sourceContent: Buffer
  readonly kind: 'copy' | 'unchanged' | 'conflict'
}

const directoryMode = 0o700
const fileMode = 0o600
const isMarkdownPath = (path: string): boolean => extname(path).toLowerCase() === '.md'

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

const writeMigratedFile = async (targetVault: string, targetRoot: string, absolutePath: string, content: Buffer): Promise<void> => {
  if (isBucketVaultPath(targetVault)) {
    await writeMarkdownFile(targetVault, relative(targetRoot, absolutePath), content.toString('utf8'))
    return
  }

  await writePreservedFile(absolutePath, content)
}

export const planVaultMigration = async (source: string, target: string): Promise<readonly VaultMigrationAction[]> => {
  const sourceFiles = (await listVaultFiles(source)).filter(isMarkdownPath)

  return sourceFiles.reduce<Promise<readonly VaultMigrationAction[]>>(async (statePromise, sourceFile) => {
    const state = await statePromise
    const targetFile = join(target, relative(source, sourceFile))

    if (!isPathInside(target, targetFile)) {
      return state
    }

    const sourceContent = await readFile(sourceFile)

    try {
      const targetContent = await readFile(targetFile)

      if (sourceContent.equals(targetContent)) {
        return [...state, { kind: 'unchanged', sourcePath: sourceFile, targetPath: targetFile, sourceContent }]
      }

      return [...state, { kind: 'conflict', sourcePath: sourceFile, targetPath: conflictPath(targetFile), sourceContent }]
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error
      }

      return [...state, { kind: 'copy', sourcePath: sourceFile, targetPath: targetFile, sourceContent }]
    }
  }, Promise.resolve([]))
}

export const previewVaultMigration = async (sourceVault: string, targetVault: string): Promise<VaultMigrationResult> => {
  const source = await ensureVault(sourceVault)
  const target = await ensureVault(targetVault)

  if (source === target) {
    return { source, target, copied: 0, unchanged: 0, conflicted: 0 }
  }

  const actions = await planVaultMigration(source, target)
  const copied = actions.filter((action) => action.kind === 'copy').length
  const unchanged = actions.filter((action) => action.kind === 'unchanged').length
  const conflicted = actions.filter((action) => action.kind === 'conflict').length

  return { source, target, copied, unchanged, conflicted }
}

export const migrateVaultContent = async (sourceVault: string, targetVault: string): Promise<VaultMigrationResult> => {
  const source = await ensureVault(sourceVault)
  const target = await ensureVault(targetVault)

  if (source === target) {
    return { source, target, copied: 0, unchanged: 0, conflicted: 0 }
  }

  const actions = await planVaultMigration(source, target)

  for (const action of actions) {
    if (action.kind === 'unchanged') {
      continue
    }

    await writeMigratedFile(targetVault, target, action.targetPath, action.sourceContent)
  }

  const copied = actions.filter((action) => action.kind === 'copy').length
  const unchanged = actions.filter((action) => action.kind === 'unchanged').length
  const conflicted = actions.filter((action) => action.kind === 'conflict').length

  return { source, target, copied, unchanged, conflicted }
}

export const shouldMigrateDefaultVault = async (sourceVault: string, targetVault: string): Promise<boolean> => {
  const source = resolveVaultPath(sourceVault)
  const target = resolveVaultPath(targetVault)

  if (source === target) {
    return false
  }

  const [sourceFiles, targetFiles] = await Promise.all([listVaultFiles(source), listVaultFiles(target)])

  return sourceFiles.filter(isMarkdownPath).length > 0 && targetFiles.filter(isMarkdownPath).length === 0
}
