import Database from 'better-sqlite3'
import { sanitizeAgentId } from '../../domain/agents.js'
import type { AgentSummary, GraphEdge, GraphLink, GraphNode, KnowledgeGraph, LinkPriority } from '../../domain/types.js'
import type { SqliteGraphReader } from './types.js'

type GraphLinkRow = {
  readonly agent_id: string
  readonly from_title: string
  readonly from_path: string
  readonly to_title: string
  readonly to_path: string | null
  readonly weight: number
  readonly priority: LinkPriority
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
  readonly weight: number
  readonly priority: LinkPriority
}

const toGraphLink = (row: GraphLinkRow): GraphLink => ({
  agentId: row.agent_id,
  fromTitle: row.from_title,
  fromPath: row.from_path,
  toTitle: row.to_title,
  toPath: row.to_path,
  weight: row.weight,
  priority: row.priority
})

type AgentSummaryRow = {
  readonly id: string
  readonly document_count: number
}

const normalizeAgentFilter = (agentId?: string): string | undefined =>
  agentId ? sanitizeAgentId(agentId) : undefined

const toTitleKey = (title: string): string =>
  title.toLowerCase()

export const createGraphReader = (database: Database.Database): SqliteGraphReader =>
  (() => {
    const listLinksStatement = database.prepare(`
      SELECT
        source.agent_id AS agent_id,
        source.title AS from_title,
        source.path AS from_path,
        COALESCE(target.title, links.to_title) AS to_title,
        target.path AS to_path,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      LEFT JOIN documents target ON target.id = links.to_document_id
      ORDER BY source.title, links.weight DESC, to_title
    `)

    const listLinksByAgentStatement = database.prepare(`
      SELECT
        source.agent_id AS agent_id,
        source.title AS from_title,
        source.path AS from_path,
        COALESCE(target.title, links.to_title) AS to_title,
        target.path AS to_path,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      LEFT JOIN documents target ON target.id = links.to_document_id
      WHERE source.agent_id = ?
      ORDER BY source.title, links.weight DESC, to_title
    `)

    const listBacklinksStatement = database.prepare(`
      SELECT
        source.agent_id AS agent_id,
        source.title AS from_title,
        source.path AS from_path,
        COALESCE(target.title, links.to_title) AS to_title,
        target.path AS to_path,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      LEFT JOIN documents target ON target.id = links.to_document_id
      WHERE links.to_title_key = ?
      ORDER BY links.weight DESC, source.title
    `)

    const listBacklinksByAgentStatement = database.prepare(`
      SELECT
        source.agent_id AS agent_id,
        source.title AS from_title,
        source.path AS from_path,
        COALESCE(target.title, links.to_title) AS to_title,
        target.path AS to_path,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      LEFT JOIN documents target ON target.id = links.to_document_id
      WHERE links.to_title_key = ? AND source.agent_id = ?
      ORDER BY links.weight DESC, source.title
    `)

    const graphNodesStatement = database.prepare(`
      SELECT id, agent_id, title, path, content, tags_json
      FROM documents
      ORDER BY title
    `)

    const graphNodesByAgentStatement = database.prepare(`
      SELECT id, agent_id, title, path, content, tags_json
      FROM documents
      WHERE agent_id = ?
      ORDER BY title
    `)

    const graphSummaryNodesStatement = database.prepare(`
      SELECT id, agent_id, title, path, '' AS content, tags_json
      FROM documents
      ORDER BY title
    `)

    const graphSummaryNodesByAgentStatement = database.prepare(`
      SELECT id, agent_id, title, path, '' AS content, tags_json
      FROM documents
      WHERE agent_id = ?
      ORDER BY title
    `)

    const graphEdgesStatement = database.prepare(`
      SELECT
        links.from_document_id AS source,
        links.to_document_id AS target,
        links.to_title AS target_title,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      ORDER BY links.from_document_id, links.weight DESC, links.to_title
    `)

    const graphEdgesByAgentStatement = database.prepare(`
      SELECT
        links.from_document_id AS source,
        links.to_document_id AS target,
        links.to_title AS target_title,
        links.weight AS weight,
        links.priority AS priority
      FROM links
      JOIN documents source ON source.id = links.from_document_id
      WHERE source.agent_id = ?
      ORDER BY links.from_document_id, links.weight DESC, links.to_title
    `)

    const graphNodeByIdStatement = database.prepare(`
      SELECT id, agent_id, title, path, content, tags_json
      FROM documents
      WHERE id = ?
    `)

    const graphNodeByIdAndAgentStatement = database.prepare(`
      SELECT id, agent_id, title, path, content, tags_json
      FROM documents
      WHERE id = ? AND agent_id = ?
    `)

    const listAgentsStatement = database.prepare(`
      SELECT agent_id AS id, count(*) AS document_count
      FROM documents
      GROUP BY agent_id
      ORDER BY agent_id
    `)

    return {
      listLinks: (agentId) => {
        const normalizedAgentId = normalizeAgentFilter(agentId)
        const rows = (
          normalizedAgentId
            ? listLinksByAgentStatement.all(normalizedAgentId)
            : listLinksStatement.all()
        ) as readonly GraphLinkRow[]

        return rows.map(toGraphLink)
      },
      listBacklinks: (title, agentId) => {
        const normalizedAgentId = normalizeAgentFilter(agentId)
        const titleKey = toTitleKey(title)
        const rows = (
          normalizedAgentId
            ? listBacklinksByAgentStatement.all(titleKey, normalizedAgentId)
            : listBacklinksStatement.all(titleKey)
        ) as readonly GraphLinkRow[]

        return rows.map(toGraphLink)
      },
      getGraph: (agentId) => {
        const normalizedAgentId = normalizeAgentFilter(agentId)
        const nodeRows = (
          normalizedAgentId
            ? graphNodesByAgentStatement.all(normalizedAgentId)
            : graphNodesStatement.all()
        ) as readonly GraphNodeRow[]
        const edgeRows = (
          normalizedAgentId
            ? graphEdgesByAgentStatement.all(normalizedAgentId)
            : graphEdgesStatement.all()
        ) as readonly GraphEdgeRow[]

        return {
          nodes: nodeRows.map(toGraphNode),
          edges: edgeRows.map(toGraphEdge)
        }
      },
      getGraphSummary: (agentId) => {
        const normalizedAgentId = normalizeAgentFilter(agentId)
        const nodeRows = (
          normalizedAgentId
            ? graphSummaryNodesByAgentStatement.all(normalizedAgentId)
            : graphSummaryNodesStatement.all()
        ) as readonly GraphNodeRow[]
        const edgeRows = (
          normalizedAgentId
            ? graphEdgesByAgentStatement.all(normalizedAgentId)
            : graphEdgesStatement.all()
        ) as readonly GraphEdgeRow[]

        return {
          nodes: nodeRows.map(toGraphNode),
          edges: edgeRows.map(toGraphEdge)
        }
      },
      getGraphNode: (id, agentId) => {
        const normalizedAgentId = normalizeAgentFilter(agentId)
        const row = (
          normalizedAgentId
            ? graphNodeByIdAndAgentStatement.get(id, normalizedAgentId)
            : graphNodeByIdStatement.get(id)
        ) as GraphNodeRow | undefined

        return row ? toGraphNode(row) : undefined
      },
      listAgents: () =>
        (listAgentsStatement.all() as readonly AgentSummaryRow[]).map((row) => ({
          id: row.id,
          documentCount: row.document_count
        }))
    }
  })()

const toGraphNode = (row: GraphNodeRow): GraphNode => ({
  id: row.id,
  agentId: row.agent_id,
  title: row.title,
  path: row.path,
  content: row.content,
  tags: JSON.parse(row.tags_json) as readonly string[]
})

const toGraphEdge = (row: GraphEdgeRow): GraphEdge => ({
  source: row.source,
  target: row.target,
  targetTitle: row.target_title,
  weight: row.weight,
  priority: row.priority
})
