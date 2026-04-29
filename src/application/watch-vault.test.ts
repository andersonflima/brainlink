import { describe, expect, it } from 'vitest'
import { startVaultWatcher } from './watch-vault.js'

describe('watch vault', () => {
  it('refuses bucket vaults', () => {
    expect(() =>
      startVaultWatcher({
        vaultPath: 's3://memory-vault/brainlink'
      })
    ).toThrow('Watch mode is only supported for local filesystem vaults.')
  })
})
