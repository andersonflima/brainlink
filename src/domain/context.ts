import type { ContextSection, SearchResult } from './types.js'
import { middleOutIndices } from './middle-out.js'

const maxSectionsPerDocument = 3

const byScore = (left: SearchResult, right: SearchResult): number =>
  right.score - left.score || left.title.localeCompare(right.title)

const byOrdinal = (left: SearchResult, right: SearchResult): number =>
  (left.chunkOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.chunkOrdinal ?? Number.MAX_SAFE_INTEGER)

const middleOutDocumentResults = (results: readonly SearchResult[]): readonly SearchResult[] => {
  if (results.length <= 1) {
    return results
  }

  const sortedByOrdinal = [...results].sort(byOrdinal)
  const pivotChunkId = [...results].sort(byScore)[0]?.chunkId
  const pivotIndex = sortedByOrdinal.findIndex((result) => result.chunkId === pivotChunkId)

  if (pivotIndex < 0) {
    return [...results].sort(byScore)
  }

  return middleOutIndices(sortedByOrdinal.length, pivotIndex).map((index) => sortedByOrdinal[index])
}

export const selectContextSections = (
  results: readonly SearchResult[],
  maxTokens: number
): readonly ContextSection[] => {
  const grouped = results.reduce<Map<string, readonly SearchResult[]>>((state, result) => {
    const current = state.get(result.documentId) ?? []
    state.set(result.documentId, [...current, result])
    return state
  }, new Map())

  const documentOrder = Array.from(
    results.reduce<Map<string, number>>((state, result) => {
      if (!state.has(result.documentId)) {
        state.set(result.documentId, result.score)
      }
      return state
    }, new Map()).entries()
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([documentId]) => documentId)

  const selected = documentOrder.reduce<{
    readonly usedTokens: number
    readonly sections: readonly ContextSection[]
    readonly seenChunks: ReadonlySet<string>
  }>(
    (state, documentId) => {
      const ordered = middleOutDocumentResults(grouped.get(documentId) ?? [])
      let usedTokens = state.usedTokens
      let sections = state.sections
      let seenChunks = state.seenChunks

      for (let index = 0; index < ordered.length && index < maxSectionsPerDocument; index += 1) {
        const result = ordered[index]
        if (seenChunks.has(result.chunkId)) {
          continue
        }

      const tokenCost = Math.ceil(result.content.length / 4)

        if (usedTokens + tokenCost > maxTokens) {
          break
        }

        usedTokens += tokenCost
        sections = [
          ...sections,
          {
            title: result.title,
            path: result.path,
            content: result.content,
            score: result.score,
            searchMode: result.searchMode,
            tags: result.tags
          }
        ]
        seenChunks = new Set([...seenChunks, result.chunkId])
      }

      return {
        usedTokens,
        sections,
        seenChunks
      }
    },
    {
      usedTokens: 0,
      sections: [],
      seenChunks: new Set()
    }
  )

  return selected.sections
}

export const formatContextPackage = (query: string, sections: readonly ContextSection[]): string => {
  const body = sections
    .map(
      (section, index) => [
        `## ${index + 1}. ${section.title}`,
        `Source: ${section.path}`,
        section.tags.length > 0 ? `Tags: ${section.tags.map((tag) => `#${tag}`).join(' ')}` : null,
        `Score: ${section.score.toFixed(3)}`,
        `Mode: ${section.searchMode}`,
        '',
        section.content
      ]
        .filter((value): value is string => value !== null)
        .join('\n')
    )
    .join('\n\n')

  return [`# Brainlink Context`, `Query: ${query}`, '', body || 'No relevant context found.'].join('\n')
}
