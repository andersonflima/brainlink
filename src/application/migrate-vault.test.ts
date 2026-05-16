import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ensureVault = vi.fn<() => Promise<string>>()
const listVaultFiles = vi.fn<() => Promise<readonly string[]>>()
const writeMarkdownFile = vi.fn<() => Promise<string>>()

vi.mock('../infrastructure/file-system-vault.js', () => ({
  ensureVault,
  listVaultFiles,
  resolveVaultPath: (value: string) => value,
  isBucketVaultPath: (value: string) => value.startsWith('s3://'),
  writeMarkdownFile
}))

describe('migrate vault', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    ensureVault.mockReset()
    listVaultFiles.mockReset()
    writeMarkdownFile.mockReset()
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('writes migrated markdown files to bucket vaults through bucket writer', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'brainlink-migrate-source-'))
    const targetRoot = await mkdtemp(join(tmpdir(), 'brainlink-migrate-target-'))
    tempPaths.push(sourceRoot, targetRoot)
    const sourceFile = join(sourceRoot, 'agents/shared/source-note.md')
    await mkdir(join(sourceRoot, 'agents/shared'), { recursive: true })
    await writeFile(sourceFile, 'Bucket migration content. #migration', 'utf8')

    ensureVault.mockImplementation(async (vault) => {
      if (vault === 'source-vault') {
        return sourceRoot
      }

      if (vault === 's3://memory-bucket/brainlink') {
        return targetRoot
      }

      return vault
    })
    listVaultFiles.mockResolvedValue([sourceFile])
    writeMarkdownFile.mockResolvedValue('s3://memory-bucket/brainlink/agents/shared/source-note.md')

    const { migrateVaultContent } = await import('./migrate-vault.js')
    const result = await migrateVaultContent('source-vault', 's3://memory-bucket/brainlink')

    expect(result).toMatchObject({
      copied: 1,
      conflicted: 0,
      unchanged: 0
    })
    expect(writeMarkdownFile).toHaveBeenCalledWith(
      's3://memory-bucket/brainlink',
      'agents/shared/source-note.md',
      'Bucket migration content. #migration'
    )
  })
})
