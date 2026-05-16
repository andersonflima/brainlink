import { indexVault } from '../application/index-vault.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { assertVaultAllowed } from '../infrastructure/file-system-vault.js'
import { getBootstrapPolicy, touchBootstrapSession } from '../infrastructure/session-state.js'

export type StartupBootstrapResult = {
  readonly attempted: boolean
  readonly skipped: boolean
  readonly reason?: string
  readonly vault?: string
  readonly agent?: string
  readonly index?: {
    readonly documentCount: number
    readonly chunkCount: number
    readonly linkCount: number
  }
  readonly error?: string
}

export const runStartupBootstrap = async (): Promise<StartupBootstrapResult> => {
  try {
    const policy = await getBootstrapPolicy()

    if (!policy.autoBootstrapOnStartup) {
      return {
        attempted: false,
        skipped: true,
        reason: 'autoBootstrapOnStartup=false'
      }
    }

    const config = await loadBrainlinkConfig()
    const vault = assertVaultAllowed(config.vault, config.allowedVaults)
    const agent = config.defaultAgent
    const index = await indexVault(vault)
    await touchBootstrapSession(vault, agent)

    return {
      attempted: true,
      skipped: false,
      vault,
      agent: agent ?? '*',
      index
    }
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
