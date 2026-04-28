import type { ContextSection, SearchResult } from './types.js'

export const selectContextSections = (
  results: readonly SearchResult[],
  maxTokens: number
): readonly ContextSection[] => {
  const selected = results.reduce<{
    readonly usedTokens: number
    readonly sections: readonly ContextSection[]
    readonly seenDocuments: ReadonlySet<string>
  }>(
    (state, result) => {
      const tokenCost = Math.ceil(result.content.length / 4)

      if (state.usedTokens + tokenCost > maxTokens || state.seenDocuments.has(result.documentId)) {
        return state
      }

      return {
        usedTokens: state.usedTokens + tokenCost,
        sections: [
          ...state.sections,
          {
            title: result.title,
            path: result.path,
            content: result.content,
            score: result.score,
            searchMode: result.searchMode,
            tags: result.tags
          }
        ],
        seenDocuments: new Set([...state.seenDocuments, result.documentId])
      }
    },
    {
      usedTokens: 0,
      sections: [],
      seenDocuments: new Set()
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
