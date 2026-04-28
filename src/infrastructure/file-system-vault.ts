import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'

export type MarkdownFile = {
  readonly absolutePath: string
  readonly content: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

const excludedDirectories = new Set(['.brainlink', '.git', 'node_modules', 'dist'])

const walkMarkdownFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name) ? [] : walkMarkdownFiles(absolutePath)
      }

      return entry.isFile() && extname(entry.name).toLowerCase() === '.md' ? [absolutePath] : []
    })
  )

  return nested.flat()
}

export const resolveVaultPath = (vaultPath: string): string =>
  resolve(process.cwd(), vaultPath)

export const ensureVault = async (vaultPath: string): Promise<string> => {
  const absoluteVaultPath = resolveVaultPath(vaultPath)

  await mkdir(join(absoluteVaultPath, '.brainlink'), { recursive: true })

  return absoluteVaultPath
}

export const readMarkdownFiles = async (vaultPath: string): Promise<readonly MarkdownFile[]> => {
  const absoluteVaultPath = resolveVaultPath(vaultPath)
  const paths = await walkMarkdownFiles(absoluteVaultPath)

  return Promise.all(
    paths.map(async (absolutePath) => {
      const [content, stats] = await Promise.all([readFile(absolutePath, 'utf8'), stat(absolutePath)])

      return {
        absolutePath,
        content,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime
      }
    })
  )
}

export const writeMarkdownFile = async (vaultPath: string, filename: string, content: string): Promise<string> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const absolutePath = join(absoluteVaultPath, filename.endsWith('.md') ? filename : `${filename}.md`)

  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')

  return absolutePath
}
