import { watch, type FSWatcher } from 'node:fs'
import type { IndexVaultProgressEvent, IndexVaultResult } from './index-vault.js'
import { indexVaultWithOptions } from './index-vault.js'
import { isBucketVaultPath, resolveVaultPath } from '../infrastructure/file-system-vault.js'

type WatchVaultInput = {
  readonly vaultPath: string
  readonly debounceMs?: number
  readonly onIndex?: (result: IndexVaultResult) => void
  readonly onProgress?: (event: IndexVaultProgressEvent) => void
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
  let running = false
  let pending = false

  const runIndex = (): void => {
    if (running) {
      pending = true
      return
    }

    running = true
    indexVaultWithOptions(absoluteVaultPath, {
      onProgress: input.onProgress
    })
      .then(input.onIndex)
      .catch(input.onError)
      .finally(() => {
        running = false
        if (pending) {
          pending = false
          runIndex()
        }
      })
  }

  const schedule = (filename: string | null): void => {
    if (shouldIgnore(filename)) {
      return
    }

    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      runIndex()
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
