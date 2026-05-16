import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrainlinkHomePath } from './paths.js'

export type BootstrapPolicy = {
  readonly enforceBootstrap: boolean
  readonly enforceContextFirst: boolean
  readonly autoBootstrapOnRead: boolean
  readonly autoBootstrapOnStartup: boolean
  readonly staleAfterMinutes: number
}

export type BootstrapSessionEntry = {
  readonly vault: string
  readonly agent: string
  readonly lastBootstrappedAt: string
}

export type BootstrapSessionStatus = {
  readonly ready: boolean
  readonly stale: boolean
  readonly lastBootstrappedAt?: string
  readonly ageMinutes?: number
}

export type ContextSessionEntry = {
  readonly vault: string
  readonly agent: string
  readonly lastContextAt: string
}

export type ContextSessionStatus = {
  readonly ready: boolean
  readonly stale: boolean
  readonly lastContextAt?: string
  readonly ageMinutes?: number
}

type BrainlinkSessionState = {
  readonly policy: BootstrapPolicy
  readonly bootstraps: readonly BootstrapSessionEntry[]
  readonly contexts: readonly ContextSessionEntry[]
}

const defaultPolicy: BootstrapPolicy = {
  enforceBootstrap: true,
  enforceContextFirst: true,
  autoBootstrapOnRead: true,
  autoBootstrapOnStartup: true,
  staleAfterMinutes: 120
}

const defaultState: BrainlinkSessionState = {
  policy: defaultPolicy,
  bootstraps: [],
  contexts: []
}

const sessionStatePath = (): string =>
  join(getBrainlinkHomePath(), 'session-state.json')

const normalizeAgent = (agent: string | undefined): string =>
  agent?.trim() ? agent.trim() : '*'

const safePositive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const sanitizeState = (value: unknown): BrainlinkSessionState => {
  if (typeof value !== 'object' || value === null) {
    return defaultState
  }

  const record = value as Readonly<Record<string, unknown>>
  const policyRecord = typeof record.policy === 'object' && record.policy !== null ? (record.policy as Readonly<Record<string, unknown>>) : {}
  const rawBootstraps = Array.isArray(record.bootstraps) ? record.bootstraps : []
  const rawContexts = Array.isArray(record.contexts) ? record.contexts : []
  const bootstraps = rawBootstraps.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const row = entry as Readonly<Record<string, unknown>>
    const vault = typeof row.vault === 'string' && row.vault.trim().length > 0 ? row.vault.trim() : undefined
    const agent = typeof row.agent === 'string' && row.agent.trim().length > 0 ? row.agent.trim() : undefined
    const lastBootstrappedAt =
      typeof row.lastBootstrappedAt === 'string' && row.lastBootstrappedAt.trim().length > 0 ? row.lastBootstrappedAt.trim() : undefined

    return vault && agent && lastBootstrappedAt ? [{ vault, agent, lastBootstrappedAt }] : []
  })
  const contexts = rawContexts.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }

    const row = entry as Readonly<Record<string, unknown>>
    const vault = typeof row.vault === 'string' && row.vault.trim().length > 0 ? row.vault.trim() : undefined
    const agent = typeof row.agent === 'string' && row.agent.trim().length > 0 ? row.agent.trim() : undefined
    const lastContextAt =
      typeof row.lastContextAt === 'string' && row.lastContextAt.trim().length > 0 ? row.lastContextAt.trim() : undefined

    return vault && agent && lastContextAt ? [{ vault, agent, lastContextAt }] : []
  })

  return {
    policy: {
      enforceBootstrap: typeof policyRecord.enforceBootstrap === 'boolean' ? policyRecord.enforceBootstrap : defaultPolicy.enforceBootstrap,
      enforceContextFirst:
        typeof policyRecord.enforceContextFirst === 'boolean'
          ? policyRecord.enforceContextFirst
          : defaultPolicy.enforceContextFirst,
      autoBootstrapOnRead:
        typeof policyRecord.autoBootstrapOnRead === 'boolean'
          ? policyRecord.autoBootstrapOnRead
          : defaultPolicy.autoBootstrapOnRead,
      autoBootstrapOnStartup:
        typeof policyRecord.autoBootstrapOnStartup === 'boolean'
          ? policyRecord.autoBootstrapOnStartup
          : defaultPolicy.autoBootstrapOnStartup,
      staleAfterMinutes: safePositive(policyRecord.staleAfterMinutes, defaultPolicy.staleAfterMinutes)
    },
    bootstraps,
    contexts
  }
}

const readState = async (): Promise<BrainlinkSessionState> => {
  try {
    const content = await readFile(sessionStatePath(), 'utf8')

    return sanitizeState(JSON.parse(content) as unknown)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return defaultState
    }

    throw error
  }
}

const writeState = async (state: BrainlinkSessionState): Promise<void> => {
  const path = sessionStatePath()

  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export const getSessionStatePath = (): string =>
  sessionStatePath()

export const getBootstrapPolicy = async (): Promise<BootstrapPolicy> =>
  (await readState()).policy

export const setBootstrapPolicy = async (patch: Partial<BootstrapPolicy>): Promise<BootstrapPolicy> => {
  const state = await readState()
  const next: BootstrapPolicy = {
    enforceBootstrap: typeof patch.enforceBootstrap === 'boolean' ? patch.enforceBootstrap : state.policy.enforceBootstrap,
    enforceContextFirst:
      typeof patch.enforceContextFirst === 'boolean' ? patch.enforceContextFirst : state.policy.enforceContextFirst,
    autoBootstrapOnRead:
      typeof patch.autoBootstrapOnRead === 'boolean' ? patch.autoBootstrapOnRead : state.policy.autoBootstrapOnRead,
    autoBootstrapOnStartup:
      typeof patch.autoBootstrapOnStartup === 'boolean' ? patch.autoBootstrapOnStartup : state.policy.autoBootstrapOnStartup,
    staleAfterMinutes: safePositive(patch.staleAfterMinutes, state.policy.staleAfterMinutes)
  }

  await writeState({
    ...state,
    policy: next
  })

  return next
}

export const touchBootstrapSession = async (vault: string, agent: string | undefined): Promise<BootstrapSessionEntry> => {
  const state = await readState()
  const normalizedAgent = normalizeAgent(agent)
  const entry: BootstrapSessionEntry = {
    vault,
    agent: normalizedAgent,
    lastBootstrappedAt: new Date().toISOString()
  }
  const bootstraps = [
    entry,
    ...state.bootstraps.filter((item) => !(item.vault === entry.vault && item.agent === entry.agent))
  ].slice(0, 500)

  await writeState({
    ...state,
    bootstraps
  })

  return entry
}

export const touchContextSession = async (vault: string, agent: string | undefined): Promise<ContextSessionEntry> => {
  const state = await readState()
  const normalizedAgent = normalizeAgent(agent)
  const entry: ContextSessionEntry = {
    vault,
    agent: normalizedAgent,
    lastContextAt: new Date().toISOString()
  }
  const contexts = [
    entry,
    ...state.contexts.filter((item) => !(item.vault === entry.vault && item.agent === entry.agent))
  ].slice(0, 500)

  await writeState({
    ...state,
    contexts
  })

  return entry
}

export const getBootstrapSessionStatus = async (vault: string, agent: string | undefined): Promise<BootstrapSessionStatus> => {
  const state = await readState()
  const normalizedAgent = normalizeAgent(agent)
  const match = state.bootstraps.find((entry) => entry.vault === vault && entry.agent === normalizedAgent)

  if (!match) {
    return {
      ready: false,
      stale: true
    }
  }

  const ageMinutes = Math.max(0, (Date.now() - new Date(match.lastBootstrappedAt).getTime()) / 60000)
  const stale = ageMinutes > state.policy.staleAfterMinutes

  return {
    ready: !stale,
    stale,
    lastBootstrappedAt: match.lastBootstrappedAt,
    ageMinutes
  }
}

export const getContextSessionStatus = async (vault: string, agent: string | undefined): Promise<ContextSessionStatus> => {
  const state = await readState()
  const normalizedAgent = normalizeAgent(agent)
  const match = state.contexts.find((entry) => entry.vault === vault && entry.agent === normalizedAgent)

  if (!match) {
    return {
      ready: false,
      stale: true
    }
  }

  const ageMinutes = Math.max(0, (Date.now() - new Date(match.lastContextAt).getTime()) / 60000)
  const stale = ageMinutes > state.policy.staleAfterMinutes

  return {
    ready: !stale,
    stale,
    lastContextAt: match.lastContextAt,
    ageMinutes
  }
}
