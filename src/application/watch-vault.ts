import { watch, type FSWatcher } from 'node:fs'
import type { IndexVaultResult } from './index-vault.js'
import { indexVault } from './index-vault.js'
import { isBucketVaultPath, resolveVaultPath } from '../infrastructure/file-system-vault.js'

type WatchVaultInput = {
  readonly vaultPath: string
  readonly debounceMs?: number
  readonly onIndex?: (result: IndexVaultResult) => void
  readonly onError?: (error: unknown) => void
}

type RunningWatcher = {
  readonly close: () => void
}

const shouldIgnore = (filename: string | null): boolean => {
  if (!filename) {
    return false
  }

  return filename.includes('.brainlink') || !filename.endsWith('.md')
}

export const startVaultWatcher = (input: WatchVaultInput): RunningWatcher => {
  if (isBucketVaultPath(input.vaultPath)) {
    throw new Error('Watch mode is only supported for local filesystem vaults.')
  }

  const absoluteVaultPath = resolveVaultPath(input.vaultPath)
  const debounceMs = input.debounceMs ?? 350
  let timeout: NodeJS.Timeout | null = null

  const schedule = (filename: string | null): void => {
    if (shouldIgnore(filename)) {
      return
    }

    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      indexVault(absoluteVaultPath).then(input.onIndex).catch(input.onError)
    }, debounceMs)
  }

  const watcher: FSWatcher = watch(absoluteVaultPath, { recursive: true }, (_eventType, filename) => {
    schedule(filename?.toString() ?? null)
  })

  return {
    close: () => {
      if (timeout) {
        clearTimeout(timeout)
      }

      watcher.close()
    }
  }
}
