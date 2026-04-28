import Database from 'better-sqlite3'
import { sanitizeAgentId } from '../../domain/agents.js'
import type { AgentSummary, GraphEdge, GraphLink, GraphNode, KnowledgeGraph } from '../../domain/types.js'
import type { SqliteGraphReader } from './types.js'

type GraphLinkRow = {
  readonly agent_id: string
  readonly from_title: string
  readonly from_path: string
  readonly to_title: string
  readonly to_path: string | null
}

type GraphNodeRow = {
  readonly id: string
  readonly agent_id: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly tags_json: string
}

type GraphEdgeRow = {
  readonly source: string
  readonly target: string | null
  readonly target_title: string
}

const toGraphLink = (row: GraphLinkRow): GraphLink => ({
  agentId: row.agent_id,
  fromTitle: row.from_title,
  fromPath: row.from_path,
  toTitle: row.to_title,
  toPath: row.to_path
})

type AgentSummaryRow = {
  readonly id: string
  readonly document_count: number
}

const normalizeAgentFilter = (agentId?: string): string | undefined =>
  agentId ? sanitizeAgentId(agentId) : undefined

export const createGraphReader = (database: Database.Database): SqliteGraphReader => ({
  listLinks: (agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const agentFilter = normalizedAgentId ? 'WHERE source.agent_id = ?' : ''
      const rows = database
        .prepare(
          `
          SELECT
            source.agent_id AS agent_id,
            source.title AS from_title,
            source.path AS from_path,
            COALESCE(target.title, links.to_title) AS to_title,
            target.path AS to_path
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          LEFT JOIN documents target ON target.id = links.to_document_id
          ${agentFilter}
          ORDER BY source.title, to_title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphLinkRow[]

      return rows.map(toGraphLink)
    },
  listBacklinks: (title, agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const agentFilter = normalizedAgentId ? 'AND source.agent_id = ?' : ''
      const rows = database
        .prepare(
          `
          SELECT
            source.agent_id AS agent_id,
            source.title AS from_title,
            source.path AS from_path,
            COALESCE(target.title, links.to_title) AS to_title,
            target.path AS to_path
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          LEFT JOIN documents target ON target.id = links.to_document_id
          WHERE (lower(links.to_title) = lower(?) OR lower(target.title) = lower(?))
          ${agentFilter}
          ORDER BY source.title
        `
        )
        .all(...(normalizedAgentId ? [title, title, normalizedAgentId] : [title, title])) as unknown as readonly GraphLinkRow[]

      return rows.map(toGraphLink)
    },
  getGraph: (agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const documentAgentFilter = normalizedAgentId ? 'WHERE agent_id = ?' : ''
      const edgeAgentFilter = normalizedAgentId ? 'WHERE source.agent_id = ?' : ''
      const nodeRows = database
        .prepare(
          `
          SELECT id, agent_id, title, path, content, tags_json
          FROM documents
          ${documentAgentFilter}
          ORDER BY title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphNodeRow[]
      const edgeRows = database
        .prepare(
          `
          SELECT
            links.from_document_id AS source,
            links.to_document_id AS target,
            links.to_title AS target_title
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          ${edgeAgentFilter}
          ORDER BY links.from_document_id, links.to_title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphEdgeRow[]
      const nodes: readonly GraphNode[] = nodeRows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        title: row.title,
        path: row.path,
        content: row.content,
        tags: JSON.parse(row.tags_json) as readonly string[]
      }))
      const edges: readonly GraphEdge[] = edgeRows.map((row) => ({
        source: row.source,
        target: row.target,
        targetTitle: row.target_title
      }))

      return {
        nodes,
        edges
      }
    },
  listAgents: () => {
      const rows = database
        .prepare(
          `
          SELECT agent_id AS id, count(*) AS document_count
          FROM documents
          GROUP BY agent_id
          ORDER BY agent_id
        `
        )
        .all() as unknown as readonly AgentSummaryRow[]

      return rows.map((row) => ({
        id: row.id,
        documentCount: row.document_count
      }))
    }
})
