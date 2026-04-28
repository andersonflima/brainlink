import type { BrokenLink, KnowledgeGraph, OrphanNode, VaultStats, VaultValidation } from './types.js'

export const getBrokenLinks = (graph: KnowledgeGraph): readonly BrokenLink[] => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))

  return graph.edges
    .filter((edge) => edge.target === null)
    .map((edge) => {
      const source = nodeById.get(edge.source)

      return {
        fromTitle: source?.title ?? edge.source,
        fromPath: source?.path ?? '',
        toTitle: edge.targetTitle
      }
    })
}

export const getOrphanNodes = (graph: KnowledgeGraph): readonly OrphanNode[] => {
  const linkedNodeIds = new Set(
    graph.edges.flatMap((edge) => (edge.target ? [edge.source, edge.target] : [edge.source]))
  )

  return graph.nodes
    .filter((node) => !linkedNodeIds.has(node.id))
    .map((node) => ({
      title: node.title,
      path: node.path,
      tags: node.tags
    }))
}

export const getVaultStats = (graph: KnowledgeGraph): VaultStats => {
  const brokenLinks = getBrokenLinks(graph)
  const orphans = getOrphanNodes(graph)
  const tags = Array.from(new Set(graph.nodes.flatMap((node) => node.tags))).sort((left, right) => left.localeCompare(right))

  return {
    documentCount: graph.nodes.length,
    linkCount: graph.edges.length,
    resolvedLinkCount: graph.edges.filter((edge) => edge.target !== null).length,
    brokenLinkCount: brokenLinks.length,
    orphanCount: orphans.length,
    tagCount: tags.length,
    tags
  }
}

export const validateGraph = (graph: KnowledgeGraph): VaultValidation => {
  const brokenLinks = getBrokenLinks(graph)
  const orphans = getOrphanNodes(graph)
  const stats = getVaultStats(graph)

  return {
    ok: brokenLinks.length === 0,
    stats,
    brokenLinks,
    orphans
  }
}
