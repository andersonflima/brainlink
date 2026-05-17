import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ensureVault } from '../infrastructure/file-system-vault.js'

type OfflinePackBackupFile = {
  readonly name: string
  readonly contentB64: string
}

type OfflinePackBackupEnvelope = {
  readonly version: 1
  readonly createdAt: string
  readonly files: readonly OfflinePackBackupFile[]
}

export type CreateOfflinePackBackupInput = {
  readonly vaultPath: string
  readonly outputPath: string
}

export type CreateOfflinePackBackupResult = {
  readonly outputPath: string
  readonly fileCount: number
  readonly inputBytes: number
  readonly outputBytes: number
  readonly ratio: number
  readonly savedBytes: number
}

const packsDirectory = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', 'search-packs')

const toSortedBackupFiles = async (vaultPath: string): Promise<readonly string[]> => {
  const directory = packsDirectory(vaultPath)
  const names = await readdir(directory)

  return names
    .filter((name) => name.endsWith('.blpk') || name === 'manifest.json')
    .sort((left, right) => left.localeCompare(right))
}

export const createOfflinePackBackup = async (
  input: CreateOfflinePackBackupInput
): Promise<CreateOfflinePackBackupResult> => {
  const vaultPath = await ensureVault(input.vaultPath)
  const fileNames = await toSortedBackupFiles(vaultPath)
  const files: OfflinePackBackupFile[] = []
  let inputBytes = 0

  for (const name of fileNames) {
    const content = await readFile(join(packsDirectory(vaultPath), name))
    inputBytes += content.byteLength
    files.push({
      name,
      contentB64: content.toString('base64')
    })
  }

  const envelope: OfflinePackBackupEnvelope = {
    version: 1,
    createdAt: new Date().toISOString(),
    files
  }
  const serialized = Buffer.from(JSON.stringify(envelope), 'utf8')
  const compressed = gzipSync(serialized, { level: 9 })

  await mkdir(dirname(input.outputPath), { recursive: true })
  await writeFile(input.outputPath, compressed)

  const safeInput = Math.max(inputBytes, 1)
  return {
    outputPath: input.outputPath,
    fileCount: files.length,
    inputBytes,
    outputBytes: compressed.byteLength,
    ratio: compressed.byteLength / safeInput,
    savedBytes: Math.max(inputBytes - compressed.byteLength, 0)
  }
}
