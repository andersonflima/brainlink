import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { AgentProfileConfig, BrainlinkConfig, EmbeddingProviderName, SearchMode } from '../domain/types.js'
import { sanitizeAgentId } from '../domain/agents.js'
import { getBrainlinkHomePath, getDefaultVaultPath } from './paths.js'

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
  chunkSize: 1200,
  agentProfiles: {}
}

const configFilenames = ['brainlink.config.json', '.brainlink.json']
const localConfigFilename = 'brainlink.config.json'
const globalConfigFilename = 'brainlink.config.json'
const globalConfigDirectoryMode = 0o700
const globalConfigFileMode = 0o600

export type ConfigScope = 'local' | 'global'
export type VaultConfigSource = 'local-legacy' | 'local' | 'global' | 'default'

const safeCwd = (): string => {
  try {
    return process.cwd()
  } catch {
    return homedir()
  }
}

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

const sanitizePositiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

const sanitizeAgentProfile = (value: unknown): AgentProfileConfig | null => {
  if (!isRecord(value)) {
    return null
  }

  const defaultSearchLimit = sanitizePositiveNumber(value.defaultSearchLimit)
  const defaultContextTokens = sanitizePositiveNumber(value.defaultContextTokens)
  const defaultSearchMode =
    typeof value.defaultSearchMode === 'string' && searchModes.has(value.defaultSearchMode)
      ? (value.defaultSearchMode as SearchMode)
      : undefined
  const profile: AgentProfileConfig = {
    ...(defaultSearchLimit ? { defaultSearchLimit } : {}),
    ...(defaultContextTokens ? { defaultContextTokens } : {}),
    ...(defaultSearchMode ? { defaultSearchMode } : {})
  }

  return Object.keys(profile).length > 0 ? profile : null
}

const sanitizeAgentProfiles = (value: unknown): Readonly<Record<string, AgentProfileConfig>> => {
  if (!isRecord(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, AgentProfileConfig>>((state, [key, profile]) => {
    const normalizedKey = key === '*' ? '*' : sanitizeAgentId(key)
    const sanitizedProfile = sanitizeAgentProfile(profile)

    if (!sanitizedProfile || normalizedKey.length === 0) {
      return state
    }

    return {
      ...state,
      [normalizedKey]: sanitizedProfile
    }
  }, {})
}

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

export const getGlobalConfigPath = (): string =>
  join(getBrainlinkHomePath(), globalConfigFilename)

export const getLocalConfigPath = (cwd = safeCwd()): string =>
  resolve(cwd, localConfigFilename)

export const resolveConfigPath = (scope: ConfigScope, cwd = safeCwd()): string =>
  scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath(cwd)

export const loadRawConfig = async (scope: ConfigScope, cwd = safeCwd()): Promise<Partial<BrainlinkConfig>> =>
  readJsonConfig(resolveConfigPath(scope, cwd))

export const loadLegacyLocalRawConfig = async (cwd = safeCwd()): Promise<Partial<BrainlinkConfig>> =>
  readJsonConfig(resolve(cwd, '.brainlink.json'))

export const detectVaultConfigSource = async (cwd = safeCwd()): Promise<VaultConfigSource> => {
  const [globalConfig, localConfig, legacyLocalConfig] = await Promise.all([
    loadRawConfig('global', cwd),
    loadRawConfig('local', cwd),
    loadLegacyLocalRawConfig(cwd)
  ])

  if (typeof legacyLocalConfig.vault === 'string' && legacyLocalConfig.vault.trim().length > 0) {
    return 'local-legacy'
  }

  if (typeof localConfig.vault === 'string' && localConfig.vault.trim().length > 0) {
    return 'local'
  }

  if (typeof globalConfig.vault === 'string' && globalConfig.vault.trim().length > 0) {
    return 'global'
  }

  return 'default'
}

export const writeRawConfig = async (scope: ConfigScope, value: Partial<BrainlinkConfig>, cwd = safeCwd()): Promise<string> => {
  const path = resolveConfigPath(scope, cwd)

  await mkdir(dirname(path), { recursive: true, mode: globalConfigDirectoryMode })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: globalConfigFileMode })

  return path
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
  defaultSearchMode: sanitizeSearchMode(value.defaultSearchMode),
  agentProfiles: sanitizeAgentProfiles(value.agentProfiles)
})

export type AgentRuntimeDefaults = {
  readonly defaultSearchLimit: number
  readonly defaultContextTokens: number
  readonly defaultSearchMode: SearchMode
}

export const resolveAgentRuntimeDefaults = (config: BrainlinkConfig, agent: string | undefined): AgentRuntimeDefaults => {
  const normalizedAgent = agent?.trim().length ? sanitizeAgentId(agent) : undefined
  const profile = (normalizedAgent ? config.agentProfiles[normalizedAgent] : undefined) ?? config.agentProfiles['*']

  return {
    defaultSearchLimit: profile?.defaultSearchLimit ?? config.defaultSearchLimit,
    defaultContextTokens: profile?.defaultContextTokens ?? config.defaultContextTokens,
    defaultSearchMode: profile?.defaultSearchMode ?? config.defaultSearchMode
  }
}

export const loadBrainlinkConfig = async (cwd = safeCwd()): Promise<BrainlinkConfig> => {
  const globalConfig = await readJsonConfig(getGlobalConfigPath())
  const localConfigs = await Promise.all(configFilenames.map((filename) => readJsonConfig(resolve(cwd, filename))))
  const merged = [globalConfig, ...localConfigs].reduce<Partial<BrainlinkConfig>>(
    (state, config) => ({
      ...state,
      ...config
    }),
    {}
  )

  return sanitizeConfig(merged)
}
