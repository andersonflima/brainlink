import { access, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Command } from 'commander'
import { loadBrainlinkConfig } from '../../infrastructure/config.js'
import { getBootstrapPolicy, getBootstrapSessionStatus, getSessionStatePath, setBootstrapPolicy } from '../../infrastructure/session-state.js'
import { print } from '../runtime.js'
import type { AgentInstallOptions, AgentPolicyOptions, AgentStatusOptions } from '../types.js'

type MarketplacePluginEntry = {
  readonly name: string
  readonly source: {
    readonly source: 'local'
    readonly path: string
  }
  readonly policy: {
    readonly installation: 'AVAILABLE'
    readonly authentication: 'ON_INSTALL'
  }
  readonly category: 'Productivity'
}

type MarketplaceDocument = {
  readonly name: string
  readonly interface: {
    readonly displayName: string
  }
  readonly plugins: readonly MarketplacePluginEntry[]
}

const getCodexConfigPath = (): string =>
  join(homedir(), '.codex', 'config.toml')

const getMarketplacePath = (): string =>
  join(homedir(), '.agents', 'plugins', 'marketplace.json')

const getDefaultPluginSourcePath = (): string =>
  resolve(process.cwd(), 'plugins', 'brainlink')

const getPluginSymlinkPath = (): string =>
  join(homedir(), 'plugins', 'brainlink')

const execFileAsync = promisify(execFile)

const toTomlValue = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const removeBrainlinkMcpSection = (content: string): string => {
  const lines = content.split('\n')
  const output: string[] = []
  let skip = false

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(.+)\]\s*$/)

    if (!skip && sectionMatch?.[1] === 'mcp_servers.brainlink') {
      skip = true
      continue
    }

    if (skip && sectionMatch) {
      skip = false
    }

    if (!skip) {
      output.push(line)
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

const buildBrainlinkMcpSection = (options: { allowedVaults?: string; brainlinkHome?: string }): string => {
  const envEntries: string[] = []

  if (options.allowedVaults) {
    envEntries.push(`BRAINLINK_ALLOWED_VAULTS = ${toTomlValue(options.allowedVaults)}`)
  }

  if (options.brainlinkHome) {
    envEntries.push(`BRAINLINK_HOME = ${toTomlValue(options.brainlinkHome)}`)
  }

  return [
    '[mcp_servers.brainlink]',
    `command = ${toTomlValue('brainlink-mcp')}`,
    ...(envEntries.length > 0 ? [`env = { ${envEntries.join(', ')} }`] : [])
  ].join('\n')
}

const upsertCodexMcpConfig = async (configPath: string, options: { allowedVaults?: string; brainlinkHome?: string }): Promise<void> => {
  let existing = ''

  try {
    existing = await readFile(configPath, 'utf8')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const withoutSection = removeBrainlinkMcpSection(existing)
  const section = buildBrainlinkMcpSection(options)
  const merged = `${withoutSection}\n\n${section}\n`.replace(/^\n+/, '')

  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 })
  await writeFile(configPath, merged, { encoding: 'utf8', mode: 0o600 })
}

const ensurePluginSymlink = async (sourcePath: string, symlinkPath: string): Promise<void> => {
  await access(sourcePath)
  await mkdir(dirname(symlinkPath), { recursive: true, mode: 0o700 })

  try {
    const info = await lstat(symlinkPath)

    if (info.isSymbolicLink()) {
      await rm(symlinkPath, { force: true })
    } else {
      await rm(symlinkPath, { recursive: true, force: true })
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  await symlink(sourcePath, symlinkPath)
}

const loadMarketplace = async (path: string): Promise<MarketplaceDocument> => {
  try {
    const content = await readFile(path, 'utf8')
    const parsed = JSON.parse(content) as Partial<MarketplaceDocument>
    const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : []

    return {
      name: typeof parsed.name === 'string' ? parsed.name : 'local',
      interface: {
        displayName: typeof parsed.interface?.displayName === 'string' ? parsed.interface.displayName : 'Local'
      },
      plugins: plugins as readonly MarketplacePluginEntry[]
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }

    return {
      name: 'local',
      interface: {
        displayName: 'Local'
      },
      plugins: []
    }
  }
}

const upsertMarketplacePlugin = async (marketplacePath: string): Promise<void> => {
  const marketplace = await loadMarketplace(marketplacePath)
  const pluginEntry: MarketplacePluginEntry = {
    name: 'brainlink',
    source: {
      source: 'local',
      path: './plugins/brainlink'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  }

  const plugins = marketplace.plugins.filter((plugin) => plugin?.name !== 'brainlink')
  const next = {
    ...marketplace,
    plugins: [...plugins, pluginEntry]
  }

  await mkdir(dirname(marketplacePath), { recursive: true, mode: 0o700 })
  await writeFile(marketplacePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

const parseAllowedVaults = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized.join(',') : undefined
}

export type InstallAgentIntegrationInput = {
  readonly mcpOnly?: boolean
  readonly pluginPath?: string
  readonly allowedVaults?: string
  readonly brainlinkHome?: string
  readonly selfTest?: boolean
}

type InstallAgentIntegrationResult = {
  readonly installed: true
  readonly codexConfigPath: string
  readonly mcpServer: 'brainlink'
  readonly command: 'brainlink-mcp'
  readonly pluginSourcePath?: string
  readonly pluginSymlinkPath?: string
  readonly marketplacePath?: string
  readonly warnings?: readonly string[]
  readonly selfTest?: {
    readonly ok: boolean
    readonly mcpCommandInPath: boolean
    readonly hasMcpSection: boolean
    readonly hasCommand: boolean
    readonly pluginSymlinkExists: boolean | null
    readonly marketplaceEntryExists: boolean | null
  }
}

export const installAgentIntegration = async (input: InstallAgentIntegrationInput): Promise<InstallAgentIntegrationResult> => {
  const codexConfigPath = getCodexConfigPath()
  const allowedVaults = parseAllowedVaults(input.allowedVaults)
  await upsertCodexMcpConfig(codexConfigPath, {
    allowedVaults,
    brainlinkHome: input.brainlinkHome
  })

  const warnings: string[] = []
  const pluginSourcePath = input.pluginPath ? resolve(input.pluginPath) : getDefaultPluginSourcePath()
  const pluginSymlinkPath = getPluginSymlinkPath()
  const marketplacePath = getMarketplacePath()

  if (input.mcpOnly !== true) {
    try {
      await ensurePluginSymlink(pluginSourcePath, pluginSymlinkPath)
      await upsertMarketplacePlugin(marketplacePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(
        `Plugin marketplace setup skipped: ${message}. MCP is configured, but install repository plugin files to enable local gallery auto-discovery.`
      )
    }
  }

  const selfTestResult = input.selfTest
    ? await (async () => {
        const codexConfig = await readFile(codexConfigPath, 'utf8')
        const mcp = isBrainlinkConfigured(codexConfig)
        const mcpCommandInPath = await hasMcpCommandInPath()
        const pluginSymlinkExists =
          input.mcpOnly === true
            ? null
            : await (async () => {
                try {
                  return (await lstat(pluginSymlinkPath)).isSymbolicLink()
                } catch {
                  return false
                }
              })()
        const marketplaceEntryExists =
          input.mcpOnly === true
            ? null
            : (await loadMarketplace(marketplacePath)).plugins.some((plugin) => plugin?.name === 'brainlink')

        return {
          ok:
            mcp.hasMcpSection &&
            mcp.hasCommand &&
            mcpCommandInPath &&
            (input.mcpOnly === true || (Boolean(pluginSymlinkExists) && Boolean(marketplaceEntryExists))),
          mcpCommandInPath,
          hasMcpSection: mcp.hasMcpSection,
          hasCommand: mcp.hasCommand,
          pluginSymlinkExists,
          marketplaceEntryExists
        }
      })()
    : undefined

  return {
    installed: true,
    codexConfigPath,
    mcpServer: 'brainlink',
    command: 'brainlink-mcp',
    ...(input.mcpOnly !== true ? { pluginSourcePath, pluginSymlinkPath, marketplacePath } : {}),
    ...(selfTestResult ? { selfTest: selfTestResult } : {}),
    ...(warnings.length > 0 ? { warnings } : {})
  }
}

const hasMcpCommandInPath = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync('sh', ['-lc', 'command -v brainlink-mcp'], { maxBuffer: 1024 * 1024 })

    return stdout.trim().length > 0
  } catch {
    return false
  }
}

const isBrainlinkConfigured = (codexConfig: string): { hasMcpSection: boolean; hasCommand: boolean } => {
  const hasMcpSection = codexConfig.includes('[mcp_servers.brainlink]')
  const hasCommand = /(^|\n)\s*command\s*=\s*"brainlink-mcp"\s*(\n|$)/m.test(codexConfig)

  return { hasMcpSection, hasCommand }
}

const parseBooleanOption = (value: string | undefined, name: string): boolean | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`Invalid value for ${name}: ${value}. Use true or false.`)
}

const parsePositiveIntegerOption = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${name}: ${value}. Use a positive integer.`)
  }

  return parsed
}

const applyPolicyPreset = (preset: string | undefined): Partial<Awaited<ReturnType<typeof getBootstrapPolicy>>> => {
  if (!preset) {
    return {}
  }

  if (preset === 'fully-auto') {
    return {
      enforceBootstrap: true,
      autoBootstrapOnRead: true,
      autoBootstrapOnStartup: true
    }
  }

  if (preset === 'strict') {
    return {
      enforceBootstrap: true,
      autoBootstrapOnRead: false,
      autoBootstrapOnStartup: false
    }
  }

  throw new Error(`Unknown policy preset: ${preset}. Use "fully-auto" or "strict".`)
}

export const registerAgentCommands = (program: Command): void => {
  const agent = program.command('agent').description('install or inspect Brainlink agent integration')

  agent
    .command('install')
    .option('--mcp-only', 'only configure MCP server in Codex config')
    .option('--plugin-path <path>', 'custom source path for Brainlink plugin files')
    .option('--allowed-vaults <paths>', 'comma separated vault allowlist to inject in MCP env')
    .option('--brainlink-home <path>', 'BRAINLINK_HOME value to inject in MCP env')
    .option('--self-test', 'run post-install checks and include diagnostics in the result')
    .option('--json', 'print machine-readable JSON')
    .description('install Brainlink as default MCP memory integration for the local agent')
    .action(async (options: AgentInstallOptions) => {
      const result = await installAgentIntegration({
        mcpOnly: options.mcpOnly,
        pluginPath: options.pluginPath,
        allowedVaults: options.allowedVaults,
        brainlinkHome: options.brainlinkHome,
        selfTest: options.selfTest
      })

      print(
        options.json,
        result,
        () =>
          [
            `Installed Brainlink MCP at ${result.codexConfigPath}`,
            ...(options.mcpOnly === true ? [] : [`Plugin symlink: ${result.pluginSymlinkPath}`, `Marketplace: ${result.marketplacePath}`]),
            ...(result.selfTest ? [`Self-test: ${result.selfTest.ok ? 'ok' : 'failed'}`] : []),
            ...(result.warnings && result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map((warning) => `- ${warning}`)] : [])
          ].join('\n')
      )
    })

  agent
    .command('upgrade')
    .option('--mcp-only', 'only configure MCP server in Codex config')
    .option('--plugin-path <path>', 'custom source path for Brainlink plugin files')
    .option('--allowed-vaults <paths>', 'comma separated vault allowlist to inject in MCP env')
    .option('--brainlink-home <path>', 'BRAINLINK_HOME value to inject in MCP env')
    .option('--json', 'print machine-readable JSON')
    .description('reapply latest Brainlink agent integration defaults for legacy installs')
    .action(async (options: AgentInstallOptions) => {
      const result = await installAgentIntegration({
        mcpOnly: options.mcpOnly,
        pluginPath: options.pluginPath,
        allowedVaults: options.allowedVaults,
        brainlinkHome: options.brainlinkHome,
        selfTest: true
      })

      print(
        options.json,
        {
          upgraded: true,
          ...result
        },
        () => `Upgraded Brainlink agent integration at ${result.codexConfigPath}. Self-test: ${result.selfTest?.ok ? 'ok' : 'failed'}`
      )
    })

  agent
    .command('policy')
    .option('--preset <preset>', 'policy preset: fully-auto or strict')
    .option('--enforce-bootstrap <true|false>', 'override enforceBootstrap')
    .option('--auto-bootstrap-on-read <true|false>', 'override autoBootstrapOnRead')
    .option('--auto-bootstrap-on-startup <true|false>', 'override autoBootstrapOnStartup')
    .option('--stale-after-minutes <minutes>', 'override staleAfterMinutes with positive integer')
    .option('--json', 'print machine-readable JSON')
    .description('read or update Brainlink MCP bootstrap policy')
    .action(async (options: AgentPolicyOptions) => {
      const presetPatch = applyPolicyPreset(options.preset)
      const enforceBootstrap = parseBooleanOption(options.enforceBootstrap, '--enforce-bootstrap')
      const autoBootstrapOnRead = parseBooleanOption(options.autoBootstrapOnRead, '--auto-bootstrap-on-read')
      const autoBootstrapOnStartup = parseBooleanOption(options.autoBootstrapOnStartup, '--auto-bootstrap-on-startup')
      const staleAfterMinutes = parsePositiveIntegerOption(options.staleAfterMinutes, '--stale-after-minutes')
      const overridePatch = {
        ...(enforceBootstrap !== undefined ? { enforceBootstrap } : {}),
        ...(autoBootstrapOnRead !== undefined ? { autoBootstrapOnRead } : {}),
        ...(autoBootstrapOnStartup !== undefined ? { autoBootstrapOnStartup } : {}),
        ...(staleAfterMinutes !== undefined ? { staleAfterMinutes } : {})
      }
      const patch = {
        ...presetPatch,
        ...overridePatch
      }
      const policy = Object.keys(patch).length === 0 ? await getBootstrapPolicy() : await setBootstrapPolicy(patch)

      print(
        options.json,
        {
          policy,
          ...(options.preset ? { presetApplied: options.preset } : {})
        },
        () =>
          [
            ...(options.preset ? [`presetApplied=${options.preset}`] : []),
            `enforceBootstrap=${policy.enforceBootstrap}`,
            `autoBootstrapOnRead=${policy.autoBootstrapOnRead}`,
            `autoBootstrapOnStartup=${policy.autoBootstrapOnStartup}`,
            `staleAfterMinutes=${policy.staleAfterMinutes}`
          ].join('\n')
      )
    })

  agent
    .command('status')
    .option('-a, --agent <agent>', 'agent memory namespace for bootstrap session status')
    .option('--json', 'print machine-readable JSON')
    .description('check if Brainlink MCP integration is configured for the local agent')
    .action(async (options: AgentStatusOptions) => {
      const codexConfigPath = getCodexConfigPath()
      let codexConfig = ''

      try {
        codexConfig = await readFile(codexConfigPath, 'utf8')
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw error
        }
      }

      const { hasMcpSection, hasCommand } = isBrainlinkConfigured(codexConfig)
      const pluginSymlinkPath = getPluginSymlinkPath()
      const marketplacePath = getMarketplacePath()
      let pluginSymlinkExists = false
      let marketplaceEntryExists = false

      try {
        pluginSymlinkExists = (await lstat(pluginSymlinkPath)).isSymbolicLink()
      } catch {}

      try {
        const marketplace = await loadMarketplace(marketplacePath)
        marketplaceEntryExists = marketplace.plugins.some((plugin) => plugin?.name === 'brainlink')
      } catch {}

      const config = await loadBrainlinkConfig()
      const policy = await getBootstrapPolicy()
      const bootstrapStatus = await getBootstrapSessionStatus(config.vault, options.agent ?? config.defaultAgent)
      const sessionStatePath = getSessionStatePath()

      print(
        options.json,
        {
          configured: hasMcpSection && hasCommand,
          codexConfigPath,
          hasMcpSection,
          hasCommand,
          pluginSymlinkPath,
          pluginSymlinkExists,
          marketplacePath,
          marketplaceEntryExists,
          sessionStatePath,
          vault: config.vault,
          agent: options.agent ?? config.defaultAgent ?? '*',
          bootstrapPolicy: policy,
          bootstrapStatus
        },
        () =>
          [
            `codexConfigPath=${codexConfigPath}`,
            `configured=${hasMcpSection && hasCommand}`,
            `pluginSymlinkExists=${pluginSymlinkExists}`,
            `marketplaceEntryExists=${marketplaceEntryExists}`,
            `vault=${config.vault}`,
            `agent=${options.agent ?? config.defaultAgent ?? '*'}`,
            `bootstrapReady=${bootstrapStatus.ready}`,
            `bootstrapStale=${bootstrapStatus.stale}`
          ].join('\n')
      )
    })
}
