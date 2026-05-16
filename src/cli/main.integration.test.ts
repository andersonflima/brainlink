import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const projectPath = process.cwd()
const cliEntryPoint = join(projectPath, 'src/cli/main.ts')
const tsxLoader = join(projectPath, 'node_modules/tsx/dist/loader.mjs')
const defaultTestHome = join(tmpdir(), `brainlink-cli-home-${process.pid}`)

const cli = async (args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<string> => {
  const { stdout } = await execFileAsync(process.execPath, ['--import', tsxLoader, cliEntryPoint, ...args], {
    cwd,
    env: {
      ...process.env,
      BRAINLINK_HOME: env.BRAINLINK_HOME ?? process.env.BRAINLINK_HOME ?? defaultTestHome,
      ...env
    },
    maxBuffer: 1024 * 1024
  })

  return stdout.trim()
}

const parseJson = <T>(value: string): T => JSON.parse(value) as T

describe('brainlink cli integration', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('creates, indexes, searches and returns agent context as JSON', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-vault-'))
    tempPaths.push(vault)

    const init = parseJson<{ path: string }>(await cli(['init', vault, '--no-migrate-existing', '--json'], projectPath))
    expect(init.path).toBe(vault)

    const architecture = parseJson<{ path: string }>(
      await cli(['add', 'Architecture', '--vault', vault, '--content', 'Markdown is the source of truth. #architecture', '--json'], projectPath)
    )
    expect((await stat(architecture.path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(vault, '.brainlink'))).mode & 0o777).toBe(0o700)

    await expect(
      cli(
        ['add', 'Credentials', '--vault', vault, '--content', 'OPENAI_API_KEY=sk-test12345678901234567890', '--json'],
        projectPath
      )
    ).rejects.toThrow('Sensitive memory blocked')

    const blockedVault = await mkdtemp(join(tmpdir(), 'brainlink-blocked-vault-'))
    tempPaths.push(blockedVault)
    await expect(cli(['index', '--vault', blockedVault, '--json'], projectPath, { BRAINLINK_ALLOWED_VAULTS: vault })).rejects.toThrow(
      'Vault path is not allowed'
    )

    await cli(
      [
        'add',
        'Auth Decision',
        '--vault',
        vault,
        '--content',
        'We chose JWT for API clients. [[Architecture]] #auth #jwt',
        '--json'
      ],
      projectPath
    )

    const indexed = parseJson<{ documentCount: number; linkCount: number }>(
      await cli(['index', '--vault', vault, '--json'], projectPath)
    )
    expect(indexed).toMatchObject({ documentCount: 2, linkCount: 1 })

    const search = parseJson<{ mode: string; results: readonly { title: string; searchMode: string }[] }>(
      await cli(['search', 'jwt auth', '--vault', vault, '--mode', 'hybrid', '--json'], projectPath)
    )
    expect(search.mode).toBe('hybrid')
    expect(search.results[0]?.title).toBe('Auth Decision')
    expect(search.results[0]?.searchMode).toBe('hybrid')

    const semanticSearch = parseJson<{ results: readonly { title: string; searchMode: string; semanticScore: number }[] }>(
      await cli(['search', 'authentication token', '--vault', vault, '--mode', 'semantic', '--json'], projectPath)
    )
    expect(semanticSearch.results[0]).toMatchObject({
      title: 'Auth Decision',
      searchMode: 'semantic'
    })
    expect(semanticSearch.results[0]?.semanticScore).toBeGreaterThan(0)

    const context = parseJson<{ sections: readonly { title: string }[]; content: string }>(
      await cli(['context', 'how does auth work?', '--vault', vault, '--json'], projectPath)
    )
    expect(context.sections[0]?.title).toBe('Auth Decision')
    expect(context.content).toContain('Brainlink Context')

    const backlinks = parseJson<{ backlinks: readonly { fromTitle: string }[] }>(
      await cli(['backlinks', 'Architecture', '--vault', vault, '--json'], projectPath)
    )
    expect(backlinks.backlinks).toEqual([
      expect.objectContaining({
        fromTitle: 'Auth Decision'
      })
    ])

    const stats = parseJson<{ documentCount: number; brokenLinkCount: number; orphanCount: number }>(
      await cli(['stats', '--vault', vault, '--json'], projectPath)
    )
    expect(stats).toMatchObject({
      documentCount: 2,
      brokenLinkCount: 0,
      orphanCount: 0
    })

    await cli(
      [
        'add',
        'Architecture',
        '--agent',
        'coding-agent',
        '--vault',
        vault,
        '--content',
        'The coding agent architecture uses TypeScript boundaries. #typescript'
      ],
      projectPath
    )
    await cli(
      [
        'add',
        'Coding Decision',
        '--agent',
        'coding-agent',
        '--vault',
        vault,
        '--content',
        'Use functional TypeScript modules. [[Architecture]] #typescript'
      ],
      projectPath
    )
    await cli(
      [
        'add',
        'Architecture',
        '--agent',
        'research-agent',
        '--vault',
        vault,
        '--content',
        'The research agent architecture stores source reviews. #research'
      ],
      projectPath
    )
    await cli(['index', '--vault', vault], projectPath)

    const agents = parseJson<{ agents: readonly { id: string; documentCount: number }[] }>(
      await cli(['agents', '--vault', vault, '--json'], projectPath)
    )
    expect(agents.agents).toEqual(
      expect.arrayContaining([
        { id: 'shared', documentCount: 2 },
        { id: 'coding-agent', documentCount: 2 },
        { id: 'research-agent', documentCount: 1 }
      ])
    )

    const codingSearch = parseJson<{ results: readonly { agentId: string; title: string }[] }>(
      await cli(['search', 'typescript', '--agent', 'coding-agent', '--vault', vault, '--json'], projectPath)
    )
    expect(codingSearch.results.every((result) => result.agentId === 'coding-agent')).toBe(true)

    const codingBacklinks = parseJson<{ backlinks: readonly { fromTitle: string; fromPath: string }[] }>(
      await cli(['backlinks', 'Architecture', '--agent', 'coding-agent', '--vault', vault, '--json'], projectPath)
    )
    expect(codingBacklinks.backlinks).toEqual([
      expect.objectContaining({
        fromTitle: 'Coding Decision',
        fromPath: expect.stringContaining('agents/coding-agent/')
      })
    ])
  }, 20000)

  it('uses the Brainlink home vault by default and keeps explicit custom vaults', async () => {
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-home-'))
    const customVault = await mkdtemp(join(tmpdir(), 'brainlink-custom-vault-'))
    const configuredWorkspace = await mkdtemp(join(tmpdir(), 'brainlink-configured-workspace-'))
    const configuredVault = join(configuredWorkspace, 'configured-vault')
    tempPaths.push(brainlinkHome, customVault, configuredWorkspace)

    const env = { BRAINLINK_HOME: brainlinkHome }
    const defaultVault = join(brainlinkHome, 'vault')
    const migratedVault = join(brainlinkHome, 'migrated-vault')

    const init = parseJson<{ path: string }>(await cli(['init', '--json'], projectPath, env))
    expect(init.path).toBe(defaultVault)

    const defaultNote = parseJson<{ path: string }>(
      await cli(['add', 'Default Memory', '--content', 'Default Brainlink memory. #default', '--json'], projectPath, env)
    )
    expect(defaultNote.path).toContain(join(defaultVault, 'agents/shared/default-memory.md'))

    const defaultIndex = parseJson<{ documentCount: number }>(await cli(['index', '--json'], projectPath, env))
    expect(defaultIndex.documentCount).toBe(1)

    const migratedInit = parseJson<{
      path: string
      migration: { copied: number; conflicted: number; unchanged: number }
      index: { documentCount: number }
    }>(await cli(['init', migratedVault, '--json'], projectPath, env))
    expect(migratedInit.path).toBe(migratedVault)
    expect(migratedInit.migration).toMatchObject({ copied: 1, conflicted: 0, unchanged: 0 })
    expect(migratedInit.index.documentCount).toBe(1)
    await expect(readFile(join(migratedVault, 'agents/shared/default-memory.md'), 'utf8')).resolves.toContain('Default Brainlink memory')

    const conflictVault = join(brainlinkHome, 'conflict-vault')
    await mkdir(join(conflictVault, 'agents/shared'), { recursive: true })
    await writeFile(join(conflictVault, 'agents/shared/default-memory.md'), 'Different existing memory. #different')
    const conflictInit = parseJson<{
      migration: { copied: number; conflicted: number; unchanged: number }
      index: { documentCount: number }
    }>(await cli(['init', conflictVault, '--migrate-from', defaultVault, '--json'], projectPath, env))
    expect(conflictInit.migration).toMatchObject({ copied: 0, conflicted: 1, unchanged: 0 })
    expect(conflictInit.index.documentCount).toBe(2)
    expect(await readdir(join(conflictVault, 'agents/shared'))).toEqual(
      expect.arrayContaining(['default-memory.md', expect.stringMatching(/^default-memory\.conflict-\d+T\d+Z\.md$/)])
    )

    const explicitNote = parseJson<{ path: string }>(
      await cli(
        ['add', 'Custom Memory', '--vault', customVault, '--content', 'Explicit custom vault memory. #custom', '--json'],
        projectPath,
        env
      )
    )
    expect(explicitNote.path).toContain(join(customVault, 'agents/shared/custom-memory.md'))

    await writeFile(
      join(configuredWorkspace, 'brainlink.config.json'),
      JSON.stringify(
        {
          vault: configuredVault
        },
        null,
        2
      )
    )

    const configuredNote = parseJson<{ path: string }>(
      await cli(['add', 'Configured Memory', '--content', 'Configured workspace vault memory. #configured', '--json'], configuredWorkspace, env)
    )
    expect(configuredNote.path).toContain(join(configuredVault, 'agents/shared/configured-memory.md'))
  }, 20000)

  it('updates vault config through CLI commands and migrates memory', async () => {
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-config-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-config-workspace-'))
    const sourceVault = await mkdtemp(join(tmpdir(), 'brainlink-config-source-'))
    const targetVault = await mkdtemp(join(tmpdir(), 'brainlink-config-target-'))
    const globalVault = await mkdtemp(join(tmpdir(), 'brainlink-config-global-'))
    const secondaryWorkspace = await mkdtemp(join(tmpdir(), 'brainlink-config-secondary-'))
    tempPaths.push(brainlinkHome, workspace, sourceVault, targetVault, globalVault, secondaryWorkspace)

    const env = { BRAINLINK_HOME: brainlinkHome }

    await cli(['add', 'Source Memory', '--vault', sourceVault, '--content', 'Migrated from source vault. #migrate', '--json'], projectPath, env)

    const setLocalVault = parseJson<{
      scope: string
      vault: string
      migration: { copied: number; conflicted: number; unchanged: number } | null
      index: { documentCount: number } | null
    }>(await cli(['config', 'set-vault', targetVault, '--migrate-from', sourceVault, '--json'], workspace, env))

    expect(setLocalVault.scope).toBe('local')
    expect(setLocalVault.vault).toBe(targetVault)
    expect(setLocalVault.migration).toMatchObject({ copied: 1, conflicted: 0, unchanged: 0 })
    expect(setLocalVault.index?.documentCount).toBe(1)

    const configuredLocalVault = parseJson<{ key: string; value: string }>(await cli(['config', 'get', 'vault', '--json'], workspace, env))
    expect(configuredLocalVault).toEqual({ key: 'vault', value: targetVault })
    await expect(readFile(join(targetVault, 'agents/shared/source-memory.md'), 'utf8')).resolves.toContain('Migrated from source vault')

    const localNote = parseJson<{ path: string }>(
      await cli(['add', 'Target Memory', '--content', 'Written through configured local vault. #local', '--json'], workspace, env)
    )
    expect(localNote.path).toContain(join(targetVault, 'agents/shared/target-memory.md'))

    const setGlobalVault = parseJson<{ scope: string; vault: string }>(
      await cli(['config', 'set-vault', globalVault, '--global', '--no-migrate', '--json'], projectPath, env)
    )
    expect(setGlobalVault).toMatchObject({ scope: 'global', vault: globalVault })

    const configuredGlobalVault = parseJson<{ key: string; value: string }>(
      await cli(['config', 'get', 'vault', '--json'], secondaryWorkspace, env)
    )
    expect(configuredGlobalVault).toEqual({ key: 'vault', value: globalVault })
  }, 20000)

  it('previews vault migration and reports empty-vault recommendations', async () => {
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-migration-home-'))
    const sourceVault = await mkdtemp(join(tmpdir(), 'brainlink-migration-source-'))
    const targetVault = await mkdtemp(join(tmpdir(), 'brainlink-migration-target-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-migration-workspace-'))
    tempPaths.push(brainlinkHome, sourceVault, targetVault, workspace)
    const env = { BRAINLINK_HOME: brainlinkHome }
    const reportPath = join(workspace, 'migration-report.json')

    await cli(['add', 'Migratable Note', '--vault', sourceVault, '--content', 'Migration candidate. #migration', '--json'], projectPath, env)

    const preview = parseJson<{ dryRun: boolean; copied: number; conflicted: number; unchanged: number }>(
      await cli(['migrate-vault', '--from', sourceVault, '--to', targetVault, '--dry-run', '--report', reportPath, '--json'], workspace, env)
    )
    expect(preview).toMatchObject({
      dryRun: true,
      copied: 1,
      conflicted: 0,
      unchanged: 0
    })

    const migrated = parseJson<{ dryRun: boolean; copied: number; conflicted: number; unchanged: number; index: { documentCount: number } }>(
      await cli(['migrate-vault', '--from', sourceVault, '--to', targetVault, '--json'], workspace, env)
    )
    expect(migrated).toMatchObject({
      dryRun: false,
      copied: 1,
      conflicted: 0,
      unchanged: 0
    })
    expect(migrated.index.documentCount).toBe(1)
    const report = parseJson<{ entries: readonly { kind: string; sourceRelativePath: string; targetRelativePath: string }[] }>(
      await readFile(reportPath, 'utf8')
    )
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'copy',
          sourceRelativePath: expect.stringContaining('.md'),
          targetRelativePath: expect.stringContaining('.md')
        })
      ])
    )

    const emptyVault = await mkdtemp(join(tmpdir(), 'brainlink-empty-vault-'))
    tempPaths.push(emptyVault)
    await cli(['config', 'set-vault', emptyVault, '--no-migrate', '--json'], workspace, env)

    const configDoctor = parseJson<{
      vault: string
      vaultSource: string
      doctor: { recommendations?: readonly string[] }
      fix: { dryRun: boolean; applied: boolean }
    }>(await cli(['config', 'doctor', '--json'], workspace, env))
    expect(configDoctor.vault).toBe(emptyVault)
    expect(configDoctor.vaultSource).toBe('local')
    expect(configDoctor.doctor.recommendations?.length ?? 0).toBeGreaterThan(0)
    expect(configDoctor.fix).toMatchObject({
      dryRun: true,
      applied: false
    })

    const fixedDoctor = parseJson<{ fix: { dryRun: boolean; applied: boolean; path: string | null } }>(
      await cli(['config', 'doctor', '--fix', '--json'], workspace, env)
    )
    expect(fixedDoctor.fix).toMatchObject({
      dryRun: false,
      applied: true
    })
    expect(typeof fixedDoctor.fix.path).toBe('string')

    const configDoctorHuman = await cli(['config', 'doctor'], workspace, env)
    expect(configDoctorHuman).toContain('Recommended next steps:')
  }, 20000)

  it('applies agent profile defaults and exposes extended stats', async () => {
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-profile-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-profile-workspace-'))
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-profile-vault-'))
    tempPaths.push(brainlinkHome, workspace, vault)
    const env = { BRAINLINK_HOME: brainlinkHome }

    await writeFile(
      join(workspace, 'brainlink.config.json'),
      JSON.stringify(
        {
          vault,
          defaultSearchMode: 'fts',
          defaultSearchLimit: 9,
          agentProfiles: {
            'coding-agent': {
              defaultSearchMode: 'semantic',
              defaultSearchLimit: 2,
              defaultContextTokens: 1200
            }
          }
        },
        null,
        2
      )
    )

    await cli(
      [
        'add',
        'Architecture',
        '--vault',
        vault,
        '--agent',
        'coding-agent',
        '--content',
        'Architecture memory and semantic retrieval. #architecture'
      ],
      workspace,
      env
    )

    const codingSearch = parseJson<{ mode: string; limit: number }>(
      await cli(['search', 'architecture', '--agent', 'coding-agent', '--json'], workspace, env)
    )
    expect(codingSearch).toMatchObject({
      mode: 'semantic',
      limit: 2
    })

    const sharedSearch = parseJson<{ mode: string; limit: number }>(
      await cli(['search', 'architecture', '--json'], workspace, env)
    )
    expect(sharedSearch).toMatchObject({
      mode: 'fts',
      limit: 9
    })

    const extendedStats = parseJson<{
      stats: { documentCount: number }
      storage: { markdownFileCount: number; totalFileCount: number; totalBytes: number }
      quality: { resolvedLinkRatio: number; priorityDistribution: Record<string, number> }
      observability: { probeQuery: string; latenciesMs: { index: number; search: number; context: number } }
    }>(await cli(['stats', '--agent', 'coding-agent', '--extended', '--json'], workspace, env))

    expect(extendedStats.stats.documentCount).toBeGreaterThan(0)
    expect(extendedStats.storage.markdownFileCount).toBeGreaterThan(0)
    expect(extendedStats.storage.totalFileCount).toBeGreaterThan(0)
    expect(extendedStats.storage.totalBytes).toBeGreaterThan(0)
    expect(typeof extendedStats.quality.resolvedLinkRatio).toBe('number')
    expect(extendedStats.quality.priorityDistribution).toMatchObject({
      low: expect.any(Number),
      normal: expect.any(Number),
      high: expect.any(Number),
      critical: expect.any(Number)
    })
    expect(extendedStats.observability.probeQuery.length).toBeGreaterThan(0)
    expect(extendedStats.observability.latenciesMs.index).toBeGreaterThanOrEqual(0)
    expect(extendedStats.observability.latenciesMs.search).toBeGreaterThanOrEqual(0)
    expect(extendedStats.observability.latenciesMs.context).toBeGreaterThanOrEqual(0)
  }, 20000)

  it('installs Brainlink agent integration in one command and reports status', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'brainlink-agent-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-agent-workspace-'))
    tempPaths.push(fakeHome, workspace)

    const env = {
      HOME: fakeHome
    }

    const install = parseJson<{
      installed: boolean
      codexConfigPath: string
      mcpServer: string
      command: string
      pluginSymlinkPath: string
      marketplacePath: string
      warnings?: readonly string[]
    }>(await cli(['agent', 'install', '--plugin-path', join(projectPath, 'plugins/brainlink'), '--json'], workspace, env))

    expect(install).toMatchObject({
      installed: true,
      mcpServer: 'brainlink',
      command: 'brainlink-mcp'
    })
    await expect(readFile(install.codexConfigPath, 'utf8')).resolves.toContain('[mcp_servers.brainlink]')
    await expect(readFile(install.codexConfigPath, 'utf8')).resolves.toContain('command = "brainlink-mcp"')
    const pluginLink = await lstat(install.pluginSymlinkPath)
    expect(pluginLink.isSymbolicLink()).toBe(true)
    await expect(readFile(install.marketplacePath, 'utf8')).resolves.toContain('"name": "brainlink"')

    const status = parseJson<{
      configured: boolean
      hasMcpSection: boolean
      hasCommand: boolean
      pluginSymlinkExists: boolean
      marketplaceEntryExists: boolean
    }>(await cli(['agent', 'status', '--json'], workspace, env))

    expect(status).toMatchObject({
      configured: true,
      hasMcpSection: true,
      hasCommand: true,
      pluginSymlinkExists: true,
      marketplaceEntryExists: true
    })
  }, 20000)

  it('runs self-test diagnostics after agent install', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'brainlink-agent-self-test-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-agent-self-test-workspace-'))
    tempPaths.push(fakeHome, workspace)

    const env = {
      HOME: fakeHome
    }

    const install = parseJson<{
      installed: boolean
      selfTest: {
        ok: boolean
        mcpCommandInPath: boolean
        hasMcpSection: boolean
        hasCommand: boolean
      }
    }>(await cli(['agent', 'install', '--mcp-only', '--self-test', '--json'], workspace, env))

    expect(install.installed).toBe(true)
    expect(install.selfTest).toMatchObject({
      hasMcpSection: true,
      hasCommand: true
    })
    expect(typeof install.selfTest.ok).toBe('boolean')
    expect(typeof install.selfTest.mcpCommandInPath).toBe('boolean')
  }, 20000)

  it('reapplies latest integration defaults for legacy installs', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'brainlink-agent-upgrade-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-agent-upgrade-workspace-'))
    tempPaths.push(fakeHome, workspace)

    const env = {
      HOME: fakeHome
    }

    await cli(['agent', 'install', '--mcp-only', '--json'], workspace, env)

    const upgrade = parseJson<{
      upgraded: boolean
      installed: boolean
      selfTest: {
        ok: boolean
        hasMcpSection: boolean
        hasCommand: boolean
      }
    }>(await cli(['agent', 'upgrade', '--mcp-only', '--json'], workspace, env))

    expect(upgrade.upgraded).toBe(true)
    expect(upgrade.installed).toBe(true)
    expect(upgrade.selfTest).toMatchObject({
      hasMcpSection: true,
      hasCommand: true
    })
    expect(typeof upgrade.selfTest.ok).toBe('boolean')
  }, 20000)

  it('runs plug-and-play quickstart with bootstrap readiness and next actions', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'brainlink-quickstart-home-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-quickstart-brainlink-home-'))
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-quickstart-vault-'))
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-quickstart-workspace-'))
    tempPaths.push(fakeHome, brainlinkHome, vault, workspace)

    const env = {
      HOME: fakeHome,
      BRAINLINK_HOME: brainlinkHome
    }

    const firstRun = parseJson<{
      vault: string
      agent: string
      stats: { documentCount: number }
      bootstrapStatus: { ready: boolean }
      agentIntegration: { installed: boolean; selfTest?: { ok: boolean } } | null
      nextActions: readonly { priority: string; command: string; reason: string }[]
    }>(await cli(['quickstart', '--vault', vault, '--agent', 'coding-agent', '--mcp-only', '--json'], workspace, env))

    expect(firstRun.vault).toBe(vault)
    expect(firstRun.agent).toBe('coding-agent')
    expect(firstRun.stats.documentCount).toBe(0)
    expect(firstRun.bootstrapStatus.ready).toBe(true)
    expect(firstRun.agentIntegration?.installed).toBe(true)
    expect(firstRun.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'required'
        })
      ])
    )

    await cli(
      [
        'add',
        'Architecture',
        '--vault',
        vault,
        '--agent',
        'coding-agent',
        '--content',
        'Quickstart durable memory with [[Roadmap]] priority: high. #architecture',
        '--json'
      ],
      workspace,
      env
    )

    const secondRun = parseJson<{
      stats: { documentCount: number }
      context: { query: string } | null
      nextActions: readonly { priority: string; command: string; reason: string }[]
    }>(
      await cli(
        ['quickstart', '--vault', vault, '--agent', 'coding-agent', '--query', 'architecture', '--mcp-only', '--json'],
        workspace,
        env
      )
    )

    expect(secondRun.stats.documentCount).toBeGreaterThan(0)
    expect(secondRun.context?.query).toBe('architecture')
    expect(secondRun.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'recommended'
        })
      ])
    )
  }, 20000)

  it('prints the package version', async () => {
    const packageJson = parseJson<{ version: string }>(await readFile(join(projectPath, 'package.json'), 'utf8'))

    expect(await cli(['--version'], projectPath)).toBe(packageJson.version)
  })
})
