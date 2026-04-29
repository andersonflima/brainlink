import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const projectPath = process.cwd()
const cliEntryPoint = join(projectPath, 'src/cli/main.ts')
const tsxLoader = join(projectPath, 'node_modules/tsx/dist/loader.mjs')

const cli = async (args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<string> => {
  const { stdout } = await execFileAsync(process.execPath, ['--import', tsxLoader, cliEntryPoint, ...args], {
    cwd,
    env: {
      ...process.env,
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

    const init = parseJson<{ path: string }>(await cli(['init', vault, '--json'], projectPath))
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

    const init = parseJson<{ path: string }>(await cli(['init', '--json'], projectPath, env))
    expect(init.path).toBe(defaultVault)

    const defaultNote = parseJson<{ path: string }>(
      await cli(['add', 'Default Memory', '--content', 'Default Brainlink memory. #default', '--json'], projectPath, env)
    )
    expect(defaultNote.path).toContain(join(defaultVault, 'agents/shared/default-memory.md'))

    const defaultIndex = parseJson<{ documentCount: number }>(await cli(['index', '--json'], projectPath, env))
    expect(defaultIndex.documentCount).toBe(1)

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

  it('prints the package version', async () => {
    const packageJson = parseJson<{ version: string }>(await readFile(join(projectPath, 'package.json'), 'utf8'))

    expect(await cli(['--version'], projectPath)).toBe(packageJson.version)
  })
})
