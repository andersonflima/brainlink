import { formatContextPackage, selectContextSections } from '../domain/context.js'
import type { ContextPackage } from '../domain/types.js'
import { searchKnowledge } from './search-knowledge.js'

export const buildContextPackage = async (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId?: string
): Promise<ContextPackage> => {
  const results = await searchKnowledge(vaultPath, query, limit, agentId)
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
  agentId?: string
): Promise<string> => {
  const contextPackage = await buildContextPackage(vaultPath, query, limit, maxTokens, agentId)

  return contextPackage.content
}
