import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrainlinkConfig, EmbeddingProviderName, SearchMode } from '../domain/types.js'
import { sanitizeAgentId } from '../domain/agents.js'
import { getDefaultVaultPath } from './paths.js'

export const defaultBrainlinkConfig: BrainlinkConfig = {
  vault: getDefaultVaultPath(),
  host: '127.0.0.1',
  port: 4321,
  allowedVaults: [],
  defaultAgent: undefined,
  autoIndexOnWrite: true,
  defaultSearchLimit: 10,
  defaultContextTokens: 2000,
  embeddingProvider: 'local',
  defaultSearchMode: 'hybrid',
  chunkSize: 1200
}

const configFilenames = ['brainlink.config.json', '.brainlink.json']

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const embeddingProviders: ReadonlySet<string> = new Set(['none', 'local'])
const searchModes: ReadonlySet<string> = new Set(['fts', 'semantic', 'hybrid'])

const sanitizeEmbeddingProvider = (value: unknown): EmbeddingProviderName =>
  typeof value === 'string' && embeddingProviders.has(value) ? (value as EmbeddingProviderName) : defaultBrainlinkConfig.embeddingProvider

export const sanitizeSearchMode = (value: unknown, fallback = defaultBrainlinkConfig.defaultSearchMode): SearchMode =>
  typeof value === 'string' && searchModes.has(value) ? (value as SearchMode) : fallback

const sanitizeAllowedVaults = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []

const readAllowedVaultsFromEnv = (): readonly string[] =>
  (process.env.BRAINLINK_ALLOWED_VAULTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

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
  defaultAgent:
    typeof value.defaultAgent === 'string' && value.defaultAgent.trim().length > 0
      ? sanitizeAgentId(value.defaultAgent)
      : defaultBrainlinkConfig.defaultAgent,
  autoIndexOnWrite: typeof value.autoIndexOnWrite === 'boolean' ? value.autoIndexOnWrite : defaultBrainlinkConfig.autoIndexOnWrite,
  defaultSearchLimit:
    typeof value.defaultSearchLimit === 'number' && value.defaultSearchLimit > 0
      ? value.defaultSearchLimit
      : defaultBrainlinkConfig.defaultSearchLimit,
  defaultContextTokens:
    typeof value.defaultContextTokens === 'number' && value.defaultContextTokens > 0
      ? value.defaultContextTokens
      : defaultBrainlinkConfig.defaultContextTokens,
  allowedVaults: [...sanitizeAllowedVaults(value.allowedVaults), ...readAllowedVaultsFromEnv()],
  chunkSize: typeof value.chunkSize === 'number' && value.chunkSize > 0 ? value.chunkSize : defaultBrainlinkConfig.chunkSize,
  embeddingProvider: sanitizeEmbeddingProvider(value.embeddingProvider),
  defaultSearchMode: sanitizeSearchMode(value.defaultSearchMode)
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
