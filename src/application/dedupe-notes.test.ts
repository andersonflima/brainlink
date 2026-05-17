import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDuplicateNotes, scanDuplicateNotes } from './dedupe-notes.js'

describe('dedupe notes', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('detects exact duplicates by content hash', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-dedupe-scan-'))
    tempPaths.push(vault)
    await mkdir(join(vault, 'agents/shared'), { recursive: true })

    const content = ['# API Memory', '', 'Durable context for auth. [[Architecture]] #auth'].join('\n')
    await writeFile(join(vault, 'agents/shared/api-memory.md'), content, 'utf8')
    await writeFile(join(vault, 'agents/shared/api-memory-copy.md'), content, 'utf8')

    const duplicates = await scanDuplicateNotes(vault, { includeSemantic: false })

    expect(duplicates).toEqual([
      expect.objectContaining({
        possibleDuplicate: true,
        kind: 'exact',
        score: 1
      })
    ])
  })

  it('resolves ignore action by creating a low-priority related edge line', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-dedupe-resolve-'))
    tempPaths.push(vault)
    await mkdir(join(vault, 'agents/shared'), { recursive: true })

    await writeFile(
      join(vault, 'agents/shared/architecture.md'),
      ['---', 'title: "Architecture"', '---', '', '# Architecture', '', 'Primary architecture context. #architecture', ''].join('\n'),
      'utf8'
    )
    await writeFile(
      join(vault, 'agents/shared/architecture-copy.md'),
      ['---', 'title: "Architecture Copy"', '---', '', '# Architecture Copy', '', 'Secondary duplicate context. #architecture', ''].join('\n'),
      'utf8'
    )

    const result = await resolveDuplicateNotes(vault, {
      leftPath: 'agents/shared/architecture-copy.md',
      rightPath: 'agents/shared/architecture.md',
      action: 'ignore',
      autoIndex: false
    })

    expect(result).toMatchObject({
      action: 'ignore',
      leftPath: 'agents/shared/architecture-copy.md',
      rightPath: 'agents/shared/architecture.md',
      updatedPaths: ['agents/shared/architecture-copy.md']
    })

    const updated = await readFile(join(vault, 'agents/shared/architecture-copy.md'), 'utf8')
    expect(updated).toContain('Related: [[Architecture]] priority: low #related-to')
  })
})
