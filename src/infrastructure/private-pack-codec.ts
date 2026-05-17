import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrainlinkHomePath } from './paths.js'

const magic = Buffer.from('BLPK2', 'ascii')
const legacyVersion = 1
const currentVersion = 2
const nonceLength = 12
const authTagLength = 16
const algorithm = 'aes-256-gcm'
const compressionLevelMask = 0x0f
const compressionDictionaryMask = 0x10
const defaultCompressionLevel = 5

export type PackCompressionSettings = {
  readonly compressionLevel: number
  readonly useDictionary: boolean
}

const builtinDictionary = Buffer.from(
  [
    '"documentId","agentId","title","path","chunkId","chunkOrdinal","content","tags"',
    '"searchMode","textScore","semanticScore","weight","priority","shared"',
    'agents/shared memory-hub architecture context index search graph markdown tags links',
    '#memory #architecture #context #graph #search #index [[Memory Hub]] [[Architecture]]',
    'The quick brown fox jumps over the lazy dog. Brainlink context package metadata.',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-:/.#[]{}(), '
  ].join('\n'),
  'utf8'
)

const keyFilePath = (vaultPath: string): string => {
  const vaultHash = createHash('sha256').update(vaultPath).digest('hex').slice(0, 24)

  return join(getBrainlinkHomePath(), 'keys', `search-pack-${vaultHash}.key`)
}

const deriveKeyFromSecret = (secret: string): Buffer =>
  createHash('sha256').update(secret, 'utf8').digest()

const readOrCreateKey = async (vaultPath: string): Promise<Buffer> => {
  const envSecret = process.env.BRAINLINK_SEARCH_PACK_KEY?.trim()
  if (envSecret && envSecret.length > 0) {
    return deriveKeyFromSecret(envSecret)
  }

  const path = keyFilePath(vaultPath)
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing.length > 0) {
      return deriveKeyFromSecret(existing)
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const secret = randomBytes(48).toString('base64url')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })

  return deriveKeyFromSecret(secret)
}

const parseHeader = (payload: Buffer): {
  readonly compression: PackCompressionSettings
  readonly nonce: Buffer
  readonly authTag: Buffer
  readonly ciphertext: Buffer
} => {
  if (payload.length < magic.length + 1 + nonceLength + authTagLength) {
    throw new Error('Invalid private pack payload: too short.')
  }
  const payloadMagic = payload.subarray(0, magic.length)
  const payloadVersion = payload[magic.length] ?? 0

  if (!payloadMagic.equals(magic) || (payloadVersion !== legacyVersion && payloadVersion !== currentVersion)) {
    throw new Error('Invalid private pack payload: unsupported format.')
  }

  const hasCompressionSettings = payloadVersion >= 2
  const settingsByte = hasCompressionSettings ? payload[magic.length + 1] ?? 0 : null
  const nonceStart = magic.length + 1 + (hasCompressionSettings ? 1 : 0)
  const authTagStart = nonceStart + nonceLength
  const dataStart = authTagStart + authTagLength

  return {
    compression: settingsByte != null
      ? {
        compressionLevel: settingsByte & compressionLevelMask,
        useDictionary: (settingsByte & compressionDictionaryMask) !== 0
      }
      : {
          compressionLevel: defaultCompressionLevel,
          useDictionary: false
        },
    nonce: payload.subarray(nonceStart, authTagStart),
    authTag: payload.subarray(authTagStart, dataStart),
    ciphertext: payload.subarray(dataStart)
  }
}

const toCompressionLevel = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultCompressionLevel
  }

  const normalized = Math.round(value)
  if (normalized < 0) {
    return 0
  }
  if (normalized > 11) {
    return 11
  }

  return normalized
}

const encodeCompressionSettings = (settings: PackCompressionSettings): number =>
  (settings.compressionLevel & compressionLevelMask) | (settings.useDictionary ? compressionDictionaryMask : 0)

const brotliEncode = (content: Buffer, settings: PackCompressionSettings): Buffer => {
  const options: Record<string, unknown> = {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: settings.compressionLevel
    }
  }

  if (settings.useDictionary) {
    options.dictionary = builtinDictionary
  }

  return brotliCompressSync(content, options as never)
}

const brotliDecode = (content: Buffer, settings: PackCompressionSettings): Buffer => {
  const options: Record<string, unknown> = {}
  if (settings.useDictionary) {
    options.dictionary = builtinDictionary
  }

  return brotliDecompressSync(content, options as never)
}

export const encodePrivatePack = async (
  vaultPath: string,
  content: Buffer,
  settings?: Partial<PackCompressionSettings>
): Promise<Buffer> => {
  const key = await readOrCreateKey(vaultPath)
  const nonce = randomBytes(nonceLength)
  const normalizedSettings: PackCompressionSettings = {
    compressionLevel: toCompressionLevel(settings?.compressionLevel),
    useDictionary: settings?.useDictionary ?? true
  }
  const compressed = brotliEncode(content, normalizedSettings)
  const cipher = createCipheriv(algorithm, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  const authTag = cipher.getAuthTag()
  const settingsByte = Buffer.from([encodeCompressionSettings(normalizedSettings)])

  return Buffer.concat([magic, Buffer.from([currentVersion]), settingsByte, nonce, authTag, ciphertext])
}

export const decodePrivatePack = async (vaultPath: string, payload: Buffer): Promise<Buffer> => {
  const key = await readOrCreateKey(vaultPath)
  const { nonce, authTag, ciphertext, compression } = parseHeader(payload)
  const decipher = createDecipheriv(algorithm, key, nonce)
  decipher.setAuthTag(authTag)
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return brotliDecode(compressed, compression)
}

export const isPrivatePackPayload = (payload: Buffer): boolean =>
  payload.length >= magic.length + 1 && payload.subarray(0, magic.length).equals(magic)
