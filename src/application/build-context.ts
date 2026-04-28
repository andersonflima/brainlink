import { formatContextPackage, selectContextSections } from '../domain/context.js'
import type { ContextPackage, SearchMode } from '../domain/types.js'
import { searchKnowledge } from './search-knowledge.js'

export const buildContextPackage = async (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId?: string,
  mode?: SearchMode
): Promise<ContextPackage> => {
  const results = await searchKnowledge(vaultPath, query, limit, agentId, mode)
  const sections = selectContextSections(results, maxTokens)

  return {
    query,
    sections,
    content: formatContextPackage(query, sections)
  }
}

export const buildContext = async (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId?: string,
  mode?: SearchMode
): Promise<string> => {
  const contextPackage = await buildContextPackage(vaultPath, query, limit, maxTokens, agentId, mode)

  return contextPackage.content
}
