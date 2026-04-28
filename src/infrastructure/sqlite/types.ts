import type { AgentSummary, GraphLink, IndexedDocument, KnowledgeGraph, SearchMode, SearchResult } from '../../domain/types.js'

export type SqliteIndex = {
  readonly reset: () => void
  readonly saveDocuments: (documents: readonly IndexedDocument[]) => void
  readonly search: (query: string, limit: number, agentId?: string, mode?: SearchMode, queryEmbedding?: readonly number[]) => readonly SearchResult[]
  readonly listLinks: (agentId?: string) => readonly GraphLink[]
  readonly listBacklinks: (title: string, agentId?: string) => readonly GraphLink[]
  readonly getGraph: (agentId?: string) => KnowledgeGraph
  readonly listAgents: () => readonly AgentSummary[]
  readonly close: () => void
}

export type SqliteIndexWriter = Pick<SqliteIndex, 'reset' | 'saveDocuments'>
export type SqliteSearchReader = Pick<SqliteIndex, 'search'>
export type SqliteGraphReader = Pick<SqliteIndex, 'listLinks' | 'listBacklinks' | 'getGraph' | 'listAgents'>
