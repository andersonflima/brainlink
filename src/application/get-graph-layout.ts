import { createCauliflowerGraphLayout } from '../domain/graph-layout.js'
import type { KnowledgeGraph, KnowledgeGraphLayout } from '../domain/types.js'
import { getGraph } from './get-graph.js'

export type GraphLayoutPayload = {
  readonly signature: string
  readonly layout: KnowledgeGraphLayout
}

type CachedGraphLayout = {
  readonly signature: string
  readonly layout: KnowledgeGraphLayout
}

const graphLayoutCache = new Map<string, CachedGraphLayout>()

const createGraphSignature = (graph: KnowledgeGraph): string => {
  const nodesSignature = graph.nodes.map((node) => `${node.id}|${node.agentId}|${node.title}|${node.path}`).join('\n')
  const edgesSignature = graph.edges
    .map((edge) => `${edge.source}|${edge.target ?? ''}|${edge.targetTitle}|${edge.weight}|${edge.priority}`)
    .join('\n')

  return `${graph.nodes.length}:${nodesSignature}|${graph.edges.length}:${edgesSignature}`
}

export const getGraphLayout = async (vaultPath: string, agentId?: string): Promise<GraphLayoutPayload> => {
  const graph = await getGraph(vaultPath, agentId)
  const signature = createGraphSignature(graph)
  const cacheKey = `${vaultPath}:${agentId ?? ''}`
  const cached = graphLayoutCache.get(cacheKey)

  if (cached?.signature === signature) {
    return {
      signature,
      layout: cached.layout
    }
  }

  const layout = createCauliflowerGraphLayout(graph)
  graphLayoutCache.set(cacheKey, { signature, layout })

  return {
    signature,
    layout
  }
}
