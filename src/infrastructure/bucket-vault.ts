import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { posix } from 'node:path'
import { getBrainlinkHomePath } from './paths.js'

export type BucketVaultReference = {
  readonly uri: string
  readonly bucket: string
  readonly prefix: string
}

type BucketManifest = {
  readonly uri: string
  readonly keys: readonly string[]
}

const directoryMode = 0o700
const fileMode = 0o600
const bucketScheme = 's3:'
const manifestPath = '.brainlink/bucket-manifest.json'
const excludedSegments = new Set(['.brainlink', '.git', 'node_modules', 'dist'])

export const isBucketVaultUri = (value: string): boolean =>
  value.trim().toLowerCase().startsWith('s3://')

const trimSlashes = (value: string): string =>
  value.replace(/^\/+|\/+$/g, '')

const normalizePrefix = (value: string): string =>
  trimSlashes(posix.normalize(trimSlashes(value))).replace(/^\.$/, '')

export const parseBucketVaultUri = (uri: string): BucketVaultReference => {
  const parsed = new URL(uri)

  if (parsed.protocol !== bucketScheme || !parsed.hostname) {
    throw new Error(`Unsupported bucket vault URI: ${uri}. Use s3://bucket/prefix.`)
  }

  return {
    uri: formatBucketVaultUri(parsed.hostname, normalizePrefix(decodeURIComponent(parsed.pathname))),
    bucket: parsed.hostname,
    prefix: normalizePrefix(decodeURIComponent(parsed.pathname))
  }
}

export const formatBucketVaultUri = (bucket: string, prefix: string): string =>
  prefix ? `s3://${bucket}/${prefix}` : `s3://${bucket}`

export const getBucketVaultCachePath = (uri: string): string => {
  const hash = createHash('sha256').update(parseBucketVaultUri(uri).uri).digest('hex').slice(0, 24)

  return join(getBrainlinkHomePath(), 'bucket-cache', hash)
}

const ensureDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: directoryMode })
  await chmod(path, directoryMode)
}

const isPathInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)

  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

const toSafeRelativePath = (key: string): string | null => {
  const normalized = normalizePrefix(key)

  if (!normalized || normalized.split('/').some((segment) => segment === '..' || excludedSegments.has(segment))) {
    return null
  }

  return normalized.endsWith('.md') ? normalized : null
}

const toObjectKey = (reference: BucketVaultReference, relativePath: string): string =>
  reference.prefix ? `${reference.prefix}/${relativePath}` : relativePath

const toRelativeObjectKey = (reference: BucketVaultReference, objectKey: string): string | null => {
  const relativePath = reference.prefix
    ? objectKey.startsWith(`${reference.prefix}/`)
      ? objectKey.slice(reference.prefix.length + 1)
      : null
    : objectKey

  return relativePath ? toSafeRelativePath(relativePath) : null
}

const createBucketClient = (): S3Client =>
  new S3Client({
    region: process.env.AWS_REGION ?? process.env.BRAINLINK_S3_REGION ?? 'us-east-1',
    endpoint: process.env.BRAINLINK_S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL,
    forcePathStyle: process.env.BRAINLINK_S3_FORCE_PATH_STYLE === '1'
  })

const streamToString = async (body: unknown): Promise<string> => {
  if (body && typeof body === 'object' && 'transformToString' in body && typeof body.transformToString === 'function') {
    return body.transformToString()
  }

  throw new Error('Unsupported S3 object body.')
}

const readManifest = async (cachePath: string): Promise<BucketManifest> => {
  try {
    return JSON.parse(await readFile(join(cachePath, manifestPath), 'utf8')) as BucketManifest
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        uri: '',
        keys: []
      }
    }

    throw error
  }
}

const writeManifest = async (cachePath: string, manifest: BucketManifest): Promise<void> => {
  const path = join(cachePath, manifestPath)

  await ensureDirectory(dirname(path))
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: fileMode })
  await chmod(path, fileMode)
}

const listBucketMarkdownKeys = async (client: S3Client, reference: BucketVaultReference): Promise<readonly string[]> => {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: reference.bucket,
        Prefix: reference.prefix ? `${reference.prefix}/` : undefined,
        ContinuationToken: continuationToken
      })
    )

    keys.push(...(result.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])))
    continuationToken = result.NextContinuationToken
  } while (continuationToken)

  return keys.flatMap((key) => {
    const relativePath = toRelativeObjectKey(reference, key)

    return relativePath ? [relativePath] : []
  })
}

const removeStaleCachedFiles = async (
  cachePath: string,
  previousKeys: readonly string[],
  currentKeys: ReadonlySet<string>
): Promise<void> => {
  await Promise.all(
    previousKeys
      .filter((key) => !currentKeys.has(key))
      .map(async (key) => {
        const absolutePath = join(cachePath, key)

        if (isPathInside(cachePath, absolutePath)) {
          await rm(absolutePath, { force: true })
        }
      })
  )
}

const downloadMarkdownFiles = async (
  client: S3Client,
  reference: BucketVaultReference,
  cachePath: string,
  keys: readonly string[]
): Promise<void> => {
  await Promise.all(
    keys.map(async (key) => {
      const absolutePath = join(cachePath, key)

      if (!isPathInside(cachePath, absolutePath)) {
        throw new Error(`Refusing to cache bucket object outside vault cache: ${key}`)
      }

      const result = await client.send(
        new GetObjectCommand({
          Bucket: reference.bucket,
          Key: toObjectKey(reference, key)
        })
      )

      await ensureDirectory(dirname(absolutePath))
      await writeFile(absolutePath, await streamToString(result.Body), { encoding: 'utf8', mode: fileMode })
      await chmod(absolutePath, fileMode)
    })
  )
}

export const syncBucketVaultToCache = async (uri: string): Promise<string> => {
  const reference = parseBucketVaultUri(uri)
  const cachePath = getBucketVaultCachePath(reference.uri)
  const client = createBucketClient()
  const previousManifest = await readManifest(cachePath)
  const keys = await listBucketMarkdownKeys(client, reference)
  const currentKeys = new Set(keys)

  await ensureDirectory(join(cachePath, '.brainlink'))
  await removeStaleCachedFiles(cachePath, previousManifest.uri === reference.uri ? previousManifest.keys : [], currentKeys)
  await downloadMarkdownFiles(client, reference, cachePath, keys)
  await writeManifest(cachePath, {
    uri: reference.uri,
    keys
  })

  return cachePath
}

export const writeBucketMarkdownFile = async (uri: string, filename: string, content: string): Promise<string> => {
  const reference = parseBucketVaultUri(uri)
  const cachePath = getBucketVaultCachePath(reference.uri)
  const relativePath = toSafeRelativePath(filename.endsWith('.md') ? filename : `${filename}.md`)

  if (!relativePath) {
    throw new Error(`Invalid bucket Markdown path: ${filename}`)
  }

  const absolutePath = join(cachePath, relativePath)

  if (!isPathInside(cachePath, absolutePath)) {
    throw new Error(`Refusing to write outside bucket cache: ${absolutePath}`)
  }

  await ensureDirectory(join(cachePath, '.brainlink'))
  await ensureDirectory(dirname(absolutePath))
  await writeFile(absolutePath, content, { encoding: 'utf8', mode: fileMode })
  await chmod(absolutePath, fileMode)

  await createBucketClient().send(
    new PutObjectCommand({
      Bucket: reference.bucket,
      Key: toObjectKey(reference, relativePath),
      Body: content,
      ContentType: 'text/markdown; charset=utf-8'
    })
  )

  const manifest = await readManifest(cachePath)
  await writeManifest(cachePath, {
    uri: reference.uri,
    keys: Array.from(new Set([...manifest.keys, relativePath])).sort()
  })

  return `${reference.uri}/${relativePath}`
}
