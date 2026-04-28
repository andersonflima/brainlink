import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { assertVaultAllowed } from '../infrastructure/file-system-vault.js'
import type { VaultOptions } from './types.js'

export const parsePositiveInteger = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const resolveOptions = async (options: VaultOptions) => {
  const config = await loadBrainlinkConfig()
  const vault = options.vault ?? config.vault
  const allowedVault = assertVaultAllowed(vault, config.allowedVaults)

  return {
    config,
    vault: allowedVault
  }
}

export const print = (json: boolean | undefined, value: unknown, human: () => string): void => {
  console.log(json ? JSON.stringify(value, null, 2) : human())
}
