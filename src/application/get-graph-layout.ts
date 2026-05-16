import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createCauliflowerGraphLayout } from '../domain/graph-layout.js'
import type { KnowledgeGraph, KnowledgeGraphLayout } from '../domain/types.js'
import { indexStoragePath } from '../infrastructure/file-index.js'
import { getGraphSummary } from './get-graph-summary.js'

export type GraphLayoutPayload = {
  readonly signature: string
  readonly layout: KnowledgeGraphLayout
}

type CachedGraphLayout = {
  readonly databaseSignature: string
  readonly signature: string
  readonly layout: KnowledgeGraphLayout
}

const graphLayoutCache = new Map<string, CachedGraphLayout>()

const readDatabaseSignature = async (vaultPath: string): Promise<string> => {
  try {
    const info = await stat(indexStoragePath(vaultPath))

    return `${Math.floor(info.mtimeMs)}:${info.size}`
  } catch {
    return '0:0'
  }
}

const createGraphSignature = (graph: KnowledgeGraph): string => {
  const nodesSignature = graph.nodes.map((node) => `${node.id}|${node.agentId}|${node.title}|${node.path}`).join('\n')
  const edgesSignature = graph.edges
    .map((edge) => `${edge.source}|${edge.target ?? ''}|${edge.targetTitle}|${edge.weight}|${edge.priority}`)
    .join('\n')

  return createHash('sha256')
    .update(`${graph.nodes.length}:${nodesSignature}|${graph.edges.length}:${edgesSignature}`)
    .digest('hex')
}

export const getGraphLayout = async (vaultPath: string, agentId?: string): Promise<GraphLayoutPayload> => {
  const databaseSignature = await readDatabaseSignature(vaultPath)
  const cacheKey = `${vaultPath}:${agentId ?? ''}`
  const cached = graphLayoutCache.get(cacheKey)

  if (cached?.databaseSignature === databaseSignature) {
    return {
      signature: cached.signature,
      layout: cached.layout
    }
  }

  const graph = await getGraphSummary(vaultPath, agentId)
  const signature = createGraphSignature(graph)
  const layout = createCauliflowerGraphLayout(graph)
  graphLayoutCache.set(cacheKey, { databaseSignature, signature, layout })

  return {
    signature,
    layout
  }
}
