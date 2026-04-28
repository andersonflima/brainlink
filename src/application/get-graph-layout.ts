import { createCauliflowerGraphLayout } from '../domain/graph-layout.js'
import type { KnowledgeGraphLayout } from '../domain/types.js'
import { getGraph } from './get-graph.js'

export const getGraphLayout = async (vaultPath: string, agentId?: string): Promise<KnowledgeGraphLayout> =>
  createCauliflowerGraphLayout(await getGraph(vaultPath, agentId))
