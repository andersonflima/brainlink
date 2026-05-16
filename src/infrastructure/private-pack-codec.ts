import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrainlinkHomePath } from './paths.js'

const magic = Buffer.from('BLPK2', 'ascii')
const version = 1
const nonceLength = 12
const authTagLength = 16
const algorithm = 'aes-256-gcm'

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

const parseHeader = (payload: Buffer): { readonly nonce: Buffer; readonly authTag: Buffer; readonly ciphertext: Buffer } => {
  if (payload.length < magic.length + 1 + nonceLength + authTagLength) {
    throw new Error('Invalid private pack payload: too short.')
  }
  const payloadMagic = payload.subarray(0, magic.length)
  const payloadVersion = payload[magic.length]

  if (!payloadMagic.equals(magic) || payloadVersion !== version) {
    throw new Error('Invalid private pack payload: unsupported format.')
  }

  const nonceStart = magic.length + 1
  const authTagStart = nonceStart + nonceLength
  const dataStart = authTagStart + authTagLength

  return {
    nonce: payload.subarray(nonceStart, authTagStart),
    authTag: payload.subarray(authTagStart, dataStart),
    ciphertext: payload.subarray(dataStart)
  }
}

export const encodePrivatePack = async (vaultPath: string, content: Buffer): Promise<Buffer> => {
  const key = await readOrCreateKey(vaultPath)
  const nonce = randomBytes(nonceLength)
  const compressed = brotliCompressSync(content)
  const cipher = createCipheriv(algorithm, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([magic, Buffer.from([version]), nonce, authTag, ciphertext])
}

export const decodePrivatePack = async (vaultPath: string, payload: Buffer): Promise<Buffer> => {
  const key = await readOrCreateKey(vaultPath)
  const { nonce, authTag, ciphertext } = parseHeader(payload)
  const decipher = createDecipheriv(algorithm, key, nonce)
  decipher.setAuthTag(authTag)
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return brotliDecompressSync(compressed)
}

export const isPrivatePackPayload = (payload: Buffer): boolean =>
  payload.length >= magic.length + 1 && payload.subarray(0, magic.length).equals(magic)

