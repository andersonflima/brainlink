import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrainlinkConfig } from '../domain/types.js'

export const defaultBrainlinkConfig: BrainlinkConfig = {
  vault: '.',
  host: '127.0.0.1',
  port: 4321,
  defaultSearchLimit: 10,
  defaultContextTokens: 2000,
  embeddingProvider: 'none',
  chunkSize: 1200
}

const configFilenames = ['brainlink.config.json', '.brainlink.json']

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJsonConfig = async (path: string): Promise<Partial<BrainlinkConfig>> => {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

const sanitizeConfig = (value: Partial<BrainlinkConfig>): BrainlinkConfig => ({
  ...defaultBrainlinkConfig,
  ...value,
  port: typeof value.port === 'number' && value.port > 0 ? value.port : defaultBrainlinkConfig.port,
  defaultSearchLimit:
    typeof value.defaultSearchLimit === 'number' && value.defaultSearchLimit > 0
      ? value.defaultSearchLimit
      : defaultBrainlinkConfig.defaultSearchLimit,
  defaultContextTokens:
    typeof value.defaultContextTokens === 'number' && value.defaultContextTokens > 0
      ? value.defaultContextTokens
      : defaultBrainlinkConfig.defaultContextTokens,
  chunkSize: typeof value.chunkSize === 'number' && value.chunkSize > 0 ? value.chunkSize : defaultBrainlinkConfig.chunkSize,
  embeddingProvider: value.embeddingProvider === 'none' ? value.embeddingProvider : defaultBrainlinkConfig.embeddingProvider
})

export const loadBrainlinkConfig = async (cwd = process.cwd()): Promise<BrainlinkConfig> => {
  const configs = await Promise.all(configFilenames.map((filename) => readJsonConfig(resolve(cwd, filename))))
  const merged = configs.reduce<Partial<BrainlinkConfig>>(
    (state, config) => ({
      ...state,
      ...config
    }),
    {}
  )

  return sanitizeConfig(merged)
}
