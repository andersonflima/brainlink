import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolvePath } from './paths.js'
import { getBucketVaultCachePath, isBucketVaultUri, parseBucketVaultUri, syncBucketVaultToCache, writeBucketMarkdownFile } from './bucket-vault.js'

export type MarkdownFile = {
  readonly absolutePath: string
  readonly content: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

const excludedDirectories = new Set(['.brainlink', '.git', 'node_modules', 'dist'])
const directoryMode = 0o700
const fileMode = 0o600

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

const walkVaultFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name) ? [] : walkVaultFiles(absolutePath)
      }

      return entry.isFile() ? [absolutePath] : []
    })
  )

  return nested.flat()
}

export const resolveVaultPath = (vaultPath: string): string =>
  isBucketVaultUri(vaultPath) ? getBucketVaultCachePath(vaultPath) : resolvePath(vaultPath)

export const isBucketVaultPath = (vaultPath: string): boolean =>
  isBucketVaultUri(vaultPath)

const isPathInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)

  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

const isBucketPrefixInside = (parent: string, child: string): boolean =>
  parent === '' || child === parent || child.startsWith(`${parent}/`)

const secureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: directoryMode })
  await chmod(path, directoryMode)
}

export const assertVaultAllowed = (vaultPath: string, allowedVaults: readonly string[]): string => {
  if (isBucketVaultUri(vaultPath)) {
    const vault = parseBucketVaultUri(vaultPath)
    const allowed = allowedVaults.filter(isBucketVaultUri).map(parseBucketVaultUri)

    if (
      allowedVaults.length > 0 &&
      !allowed.some((allowedVault) => vault.bucket === allowedVault.bucket && isBucketPrefixInside(allowedVault.prefix, vault.prefix))
    ) {
      throw new Error(`Vault path is not allowed: ${vault.uri}. Configure BRAINLINK_ALLOWED_VAULTS or allowedVaults.`)
    }

    return vault.uri
  }

  const absoluteVaultPath = resolveVaultPath(vaultPath)
  const allowed = allowedVaults.filter((allowedVault) => !isBucketVaultUri(allowedVault)).map(resolveVaultPath)

  if (allowed.length > 0 && !allowed.some((allowedPath) => isPathInside(allowedPath, absoluteVaultPath))) {
    throw new Error(`Vault path is not allowed: ${absoluteVaultPath}. Configure BRAINLINK_ALLOWED_VAULTS or allowedVaults.`)
  }

  return absoluteVaultPath
}

export const ensureVault = async (vaultPath: string): Promise<string> => {
  if (isBucketVaultUri(vaultPath)) {
    return syncBucketVaultToCache(vaultPath)
  }

  const absoluteVaultPath = resolveVaultPath(vaultPath)

  await secureDirectory(join(absoluteVaultPath, '.brainlink'))

  return absoluteVaultPath
}

export const readMarkdownFiles = async (vaultPath: string): Promise<readonly MarkdownFile[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
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

export const listVaultFiles = async (vaultPath: string): Promise<readonly string[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)

  return walkVaultFiles(absoluteVaultPath)
}

export const writeMarkdownFile = async (vaultPath: string, filename: string, content: string): Promise<string> => {
  if (isBucketVaultUri(vaultPath)) {
    return writeBucketMarkdownFile(vaultPath, filename, content)
  }

  const absoluteVaultPath = await ensureVault(vaultPath)
  const absolutePath = resolve(absoluteVaultPath, filename.endsWith('.md') ? filename : `${filename}.md`)

  if (!isPathInside(absoluteVaultPath, absolutePath)) {
    throw new Error(`Refusing to write outside vault: ${absolutePath}`)
  }

  await secureDirectory(dirname(absolutePath))
  await writeFile(absolutePath, content, { encoding: 'utf8', mode: fileMode })
  await chmod(absolutePath, fileMode)

  return absolutePath
}
