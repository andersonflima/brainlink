import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { addNote } from '../../application/add-note.js'
import { indexVault } from '../../application/index-vault.js'
import { migrateVaultContent, shouldMigrateDefaultVault } from '../../application/migrate-vault.js'
import { startServer } from '../../application/start-server.js'
import { startVaultWatcher } from '../../application/watch-vault.js'
import { doctorVault } from '../../application/analyze-vault.js'
import { defaultBrainlinkConfig } from '../../infrastructure/config.js'
import { loadBrainlinkConfig } from '../../infrastructure/config.js'
import { assertVaultAllowed, ensureVault } from '../../infrastructure/file-system-vault.js'
import { parsePositiveInteger, print, resolveOptions } from '../runtime.js'
import type { AddOptions, InitOptions, ServerOptions, VaultOptions } from '../types.js'

const resolveAddContent = (options: AddOptions): string => {
  if (options.content != null && options.content.trim().length > 0) {
    return options.content
  }

  if (options.contentFile == null || options.contentFile.trim().length === 0) {
    throw new Error('Use --content or --content-file to provide note content.')
  }

  return readFileSync(options.contentFile, 'utf8')
}

export const registerWriteCommands = (program: Command): void => {
  program
    .command('init')
  .argument('[vault]', 'vault directory')
  .option('--migrate-from <vault>', 'copy existing vault content into the initialized vault')
  .option('--no-migrate-existing', 'skip automatic migration from the default Brainlink vault into an empty custom vault')
  .option('--json', 'print machine-readable JSON')
  .description('initialize a Brainlink vault')
  .action(async (vault: string | undefined, options: InitOptions) => {
    const config = await loadBrainlinkConfig()
    const targetVault = assertVaultAllowed(vault ?? config.vault, config.allowedVaults)
    const path = await ensureVault(targetVault)
    const explicitSource = options.migrateFrom ? assertVaultAllowed(options.migrateFrom, config.allowedVaults) : undefined
    const shouldAutoMigrate =
      explicitSource === undefined &&
      options.migrateExisting !== false &&
      (await shouldMigrateDefaultVault(defaultBrainlinkConfig.vault, targetVault))
    const migration = explicitSource || shouldAutoMigrate ? await migrateVaultContent(explicitSource ?? defaultBrainlinkConfig.vault, targetVault) : undefined
    const index = migration && migration.copied + migration.conflicted > 0 ? await indexVault(targetVault) : undefined

    print(
      options.json,
      { path, ...(migration ? { migration } : {}), ...(index ? { index } : {}) },
      () => {
        const migrated = migration
          ? ` Migrated ${migration.copied} files, preserved ${migration.conflicted} conflicts and kept ${migration.unchanged} unchanged files.`
          : ''

        return `Initialized Brainlink vault at ${path}.${migrated}`
      }
    )
  })

  program
    .command('add')
  .argument('<title>', 'note title')
  .option('-c, --content <content>', 'markdown content')
  .option('-f, --content-file <contentFile>', 'read markdown content from a file')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'agent memory namespace')
  .option('--allow-sensitive', 'allow writing content that looks like a secret')
  .option('--no-auto-index', 'skip reindexing after add')
  .option('--json', 'print machine-readable JSON')
  .description('add a markdown note to the vault')
  .action(async (title: string, options: AddOptions) => {
    const resolved = await resolveOptions(options)
    const content = resolveAddContent(options)
    const notePath = await addNote(resolved.vault, title, content, resolved.agent, {
      allowSensitive: Boolean(options.allowSensitive)
    })
    const shouldAutoIndex = options.autoIndex !== false && resolved.config.autoIndexOnWrite
    const index = shouldAutoIndex ? await indexVault(resolved.vault) : undefined

    print(
      options.json,
      { title, agent: resolved.agent ?? 'shared', path: notePath, ...(index ? { index } : {}) },
      () => `Created note at ${notePath}`
    )
  })

  program
    .command('index')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON')
  .description('index markdown notes, links, tags and chunks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const result = await indexVault(resolved.vault)

    print(
      options.json,
      result,
      () => `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
    )
  })

  program
    .command('doctor')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON')
  .description('run Brainlink environment and vault checks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const report = await doctorVault(resolved.vault)

    print(options.json, report, () =>
      report.checks.map((check) => `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.message}`).join('\n')
    )
    process.exitCode = report.ok ? 0 : 1
  })

  program
    .command('watch')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON events')
  .description('watch markdown files and reindex on changes')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const initial = await indexVault(resolved.vault)
    const watcher = startVaultWatcher({
      vaultPath: resolved.vault,
      onIndex: (result) => {
        print(options.json, { event: 'indexed', result }, () =>
          `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
        )
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        print(options.json, { event: 'error', message }, () => message)
      }
    })

    print(options.json, { event: 'watching', vault: resolved.vault, initial }, () => `Watching ${resolved.vault}`)

    process.once('SIGINT', () => {
      watcher.close()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      watcher.close()
      process.exit(0)
    })
  })

  program
    .command('server')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-h, --host <host>', 'server host', '127.0.0.1')
  .option('-p, --port <port>', 'server port', '4321')
  .option('--no-index', 'skip indexing before starting the server')
  .option('-w, --watch', 'watch markdown files and reindex on changes')
  .option('--json', 'print machine-readable JSON')
  .description('start a local web UI for the knowledge graph')
  .action(async (options: ServerOptions) => {
    const resolved = await resolveOptions(options)
    const server = await startServer({
      vaultPath: resolved.vault,
      host: options.host ?? resolved.config.host,
      port: parsePositiveInteger(options.port ?? String(resolved.config.port), resolved.config.port),
      shouldIndex: options.index,
      shouldWatch: Boolean(options.watch)
    })

    print(options.json, { url: server.url, watch: Boolean(options.watch), readonly: true }, () => `Brainlink graph server running at ${server.url}`)
  })
}
