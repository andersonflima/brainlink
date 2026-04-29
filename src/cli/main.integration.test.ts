import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const cli = async (args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<string> => {
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], {
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
  const projectPath = process.cwd()

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
})
