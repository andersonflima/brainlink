import { describe, expect, it } from 'vitest'
import { selectContextSections } from './context.js'
import type { SearchResult } from './types.js'

const result = (input: {
  readonly documentId: string
  readonly chunkId: string
  readonly chunkOrdinal: number
  readonly score: number
  readonly content: string
  readonly title?: string
}): SearchResult => ({
  documentId: input.documentId,
  agentId: 'shared',
  title: input.title ?? input.documentId,
  path: `agents/shared/${input.documentId}.md`,
  chunkId: input.chunkId,
  chunkOrdinal: input.chunkOrdinal,
  content: input.content,
  score: input.score,
  textScore: input.score,
  semanticScore: 0,
  searchMode: 'hybrid',
  tags: []
})

describe('context selection', () => {
  it('expands document chunks in middle-out order around the strongest chunk', () => {
    const sections = selectContextSections(
      [
        result({ documentId: 'doc-a', chunkId: 'a-2', chunkOrdinal: 2, score: 12, content: 'pivot' }),
        result({ documentId: 'doc-a', chunkId: 'a-1', chunkOrdinal: 1, score: 10, content: 'left' }),
        result({ documentId: 'doc-a', chunkId: 'a-3', chunkOrdinal: 3, score: 9, content: 'right' }),
        result({ documentId: 'doc-b', chunkId: 'b-1', chunkOrdinal: 1, score: 11, content: 'secondary doc' })
      ],
      5_000
    )

    expect(sections.slice(0, 3).map((section) => section.content)).toEqual(['pivot', 'left', 'right'])
  })

  it('respects token budget while preserving middle-out priority', () => {
    const sections = selectContextSections(
      [
        result({ documentId: 'doc-a', chunkId: 'a-2', chunkOrdinal: 2, score: 12, content: 'x'.repeat(200) }),
        result({ documentId: 'doc-a', chunkId: 'a-1', chunkOrdinal: 1, score: 10, content: 'y'.repeat(200) }),
        result({ documentId: 'doc-a', chunkId: 'a-3', chunkOrdinal: 3, score: 9, content: 'z'.repeat(200) })
      ],
      100
    )

    expect(sections).toHaveLength(2)
    expect(sections[0]?.content.startsWith('x')).toBe(true)
    expect(sections[1]?.content.startsWith('y')).toBe(true)
  })
})
