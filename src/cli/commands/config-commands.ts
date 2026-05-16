import type { Command } from 'commander'
import { doctorVault } from '../../application/analyze-vault.js'
import { indexVault } from '../../application/index-vault.js'
import { migrateVaultContent, shouldMigrateDefaultVault } from '../../application/migrate-vault.js'
import { defaultBrainlinkConfig, detectVaultConfigSource, loadBrainlinkConfig, loadRawConfig, resolveConfigPath, writeRawConfig } from '../../infrastructure/config.js'
import { assertVaultAllowed } from '../../infrastructure/file-system-vault.js'
import { print } from '../runtime.js'
import type { ConfigGetOptions, ConfigSetVaultOptions } from '../types.js'

type ConfigScope = 'local' | 'global'

const resolveScope = (globalOption: boolean | undefined): ConfigScope =>
  globalOption ? 'global' : 'local'

const normalizeVaultPath = (vault: string): string =>
  assertVaultAllowed(vault, [])

const uniqueValues = (values: readonly string[]): readonly string[] =>
  Array.from(new Set(values))

export const registerConfigCommands = (program: Command): void => {
  const configCommand = program.command('config').description('read or update Brainlink configuration')

  configCommand
    .command('get [key]')
    .option('--json', 'print machine-readable JSON')
    .description('read effective Brainlink config values')
    .action(async (key: string | undefined, options: ConfigGetOptions) => {
      const config = await loadBrainlinkConfig()

      if (!key) {
        print(options.json, config, () => JSON.stringify(config, null, 2))
        return
      }

      if (!(key in config)) {
        throw new Error(`Unknown config key: ${key}`)
      }

      const value = config[key as keyof typeof config]

      print(options.json, { key, value }, () => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    })

  configCommand
    .command('set-vault <vault>')
    .option('--global', 'write to global config in $BRAINLINK_HOME/brainlink.config.json')
    .option('--no-allowlist', 'do not append the vault to allowedVaults in the target config file')
    .option('--migrate-from <vault>', 'copy existing Markdown memory from another vault into the configured vault')
    .option('--no-migrate', 'skip migration step')
    .option('--no-index', 'skip reindex after migration')
    .option('--json', 'print machine-readable JSON')
    .description('set the default vault path in Brainlink config')
    .action(async (vault: string, options: ConfigSetVaultOptions) => {
      const scope = resolveScope(options.global)
      const before = await loadBrainlinkConfig()
      const targetVault = normalizeVaultPath(vault)
      const rawConfig = await loadRawConfig(scope)
      const configPath = resolveConfigPath(scope)
      const shouldAllowlist = options.allowlist !== false
      const nextAllowedVaults = shouldAllowlist
        ? uniqueValues([...(rawConfig.allowedVaults ?? []), targetVault])
        : rawConfig.allowedVaults
      const nextRawConfig = {
        ...rawConfig,
        vault: targetVault,
        ...(nextAllowedVaults ? { allowedVaults: nextAllowedVaults } : {})
      }

      await writeRawConfig(scope, nextRawConfig)

      const shouldMigrate = options.migrate !== false
      const explicitSource = options.migrateFrom ? normalizeVaultPath(options.migrateFrom) : undefined
      const shouldAutoMigrate =
        shouldMigrate &&
        explicitSource === undefined &&
        (await shouldMigrateDefaultVault(before.vault, targetVault))
      const migrationSource = shouldMigrate ? explicitSource ?? (shouldAutoMigrate ? before.vault : undefined) : undefined
      const migration = migrationSource ? await migrateVaultContent(migrationSource, targetVault) : undefined
      const shouldIndex = options.index !== false && migration !== undefined && migration.copied + migration.conflicted > 0
      const index = shouldIndex ? await indexVault(targetVault) : undefined
      const after = await loadBrainlinkConfig()

      print(
        options.json,
        {
          scope,
          configPath,
          beforeVault: before.vault,
          vault: targetVault,
          migration: migration ?? null,
          index: index ?? null,
          config: after
        },
        () => {
          const migrationMessage = migration
            ? ` Migrated ${migration.copied} files, preserved ${migration.conflicted} conflicts and kept ${migration.unchanged} unchanged files.`
            : ''
          const indexMessage = index
            ? ` Indexed ${index.documentCount} documents, ${index.chunkCount} chunks and ${index.linkCount} links.`
            : ''

          return `Configured ${scope} vault at ${targetVault} in ${configPath}.${migrationMessage}${indexMessage}`
        }
      )
    })

  configCommand
    .command('where')
    .option('--json', 'print machine-readable JSON')
    .description('show effective vault path and config file locations')
    .action(async (options: ConfigGetOptions) => {
      const config = await loadBrainlinkConfig()

      print(
        options.json,
        {
          vault: config.vault,
          localConfigPath: resolveConfigPath('local'),
          globalConfigPath: resolveConfigPath('global'),
          defaultVault: defaultBrainlinkConfig.vault
        },
        () =>
          [
            `vault=${config.vault}`,
            `localConfigPath=${resolveConfigPath('local')}`,
            `globalConfigPath=${resolveConfigPath('global')}`,
            `defaultVault=${defaultBrainlinkConfig.vault}`
          ].join('\n')
      )
    })

  configCommand
    .command('doctor')
    .option('--json', 'print machine-readable JSON')
    .description('inspect effective config sources and run vault readiness checks')
    .action(async (options: ConfigGetOptions) => {
      const config = await loadBrainlinkConfig()
      const source = await detectVaultConfigSource()
      const globalConfigPath = resolveConfigPath('global')
      const localConfigPath = resolveConfigPath('local')
      const allowedVaultCheck = assertVaultAllowed(config.vault, config.allowedVaults)
      const vaultDoctor = await doctorVault(config.vault)
      const response = {
        vault: config.vault,
        vaultSource: source,
        allowedVaultCheck,
        localConfigPath,
        globalConfigPath,
        doctor: vaultDoctor
      }

      print(
        options.json,
        response,
        () =>
          [
            `vault=${response.vault}`,
            `vaultSource=${response.vaultSource}`,
            `localConfigPath=${response.localConfigPath}`,
            `globalConfigPath=${response.globalConfigPath}`,
            ...response.doctor.checks.map((check) => `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.message}`),
            ...(response.doctor.recommendations && response.doctor.recommendations.length > 0
              ? ['Recommended next steps:', ...response.doctor.recommendations.map((recommendation) => `- ${recommendation}`)]
              : [])
          ].join('\n')
      )
    })
}
