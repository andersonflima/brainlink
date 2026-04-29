import type { GraphEdge, GraphLayoutNode, GraphNode, KnowledgeGraph, KnowledgeGraphLayout } from './types.js'

const groupLabels: Readonly<Record<string, string>> = {
  '00-maps': 'maps',
  '10-agent-memory': 'agent-memory',
  '20-concepts': 'concepts',
  '30-architecture': 'architecture',
  '40-agents': 'agents',
  '50-retrieval': 'retrieval',
  '60-operations': 'operations',
  '70-evaluation': 'evaluation',
  '80-sessions': 'sessions',
  '90-security': 'security',
  root: 'root'
}

const segmentAngles: Readonly<Record<string, number>> = {
  Brainlink: -1.58,
  Architecture: -0.74,
  Agents: -0.05,
  Retrieval: 0.68,
  Operations: 1.34,
  Evaluation: 2.08,
  Security: 2.82
}

const hashText = (value: string): number =>
  Array.from(value).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)

const jitter = (value: string, range: number): number => {
  const normalized = Math.abs(hashText(value) % 1000) / 1000

  return (normalized - 0.5) * range
}

const pathSegments = (path: string): readonly string[] =>
  path.split('/').filter(Boolean)

const groupKey = (node: GraphNode): string => {
  const segments = pathSegments(node.path)

  if (segments[0] === 'agents') {
    return segments[2] ?? 'root'
  }

  return segments[0] ?? 'root'
}

const groupLabel = (key: string): string =>
  groupLabels[key] ?? key

const incrementDegreeBy = (degrees: Map<string, number>, id: string, amount: number): Map<string, number> => {
  degrees.set(id, (degrees.get(id) ?? 0) + amount)

  return degrees
}

const edgeDegreeWeight = (edge: GraphEdge): number =>
  Math.max(1, Math.min(edge.weight, 8))

const countDegrees = (edges: readonly GraphEdge[]): ReadonlyMap<string, number> =>
  edges.reduce<Map<string, number>>(
    (degrees, edge) => {
      const weight = edgeDegreeWeight(edge)

      return edge.target
        ? incrementDegreeBy(incrementDegreeBy(degrees, edge.source, weight), edge.target, weight)
        : incrementDegreeBy(degrees, edge.source, weight)
    },
    new Map()
  )

const uniqueIds = (ids: readonly string[]): readonly string[] =>
  Array.from(new Set(ids))

const createAdjacency = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): ReadonlyMap<string, readonly string[]> => {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const emptyAdjacency = new Map(nodes.map((node) => [node.id, [] as readonly string[]]))

  return edges.reduce<ReadonlyMap<string, readonly string[]>>((adjacency, edge) => {
    if (!edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return adjacency
    }

    return new Map([
      ...adjacency,
      [edge.source, uniqueIds([...(adjacency.get(edge.source) ?? []), edge.target])],
      [edge.target, uniqueIds([...(adjacency.get(edge.target) ?? []), edge.source])]
    ])
  }, emptyAdjacency)
}

const byTitle = (left: GraphNode, right: GraphNode): number =>
  left.title.localeCompare(right.title)

const byDegreeThenTitle = (degrees: ReadonlyMap<string, number>) => (left: GraphNode, right: GraphNode): number => {
  const degreeDelta = (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0)

  return degreeDelta === 0 ? byTitle(left, right) : degreeDelta
}

const naturalSegmentSeed = (node: GraphNode): boolean =>
  groupKey(node) === '00-maps' || /\b(moc|map)\b/i.test(node.title)

const segmentName = (node: GraphNode): string =>
  node.title.replace(/^MOC\s+/i, '').replace(/\s+Memory Map$/i, '').trim() || node.title

const collectComponent = (
  adjacency: ReadonlyMap<string, readonly string[]>,
  startId: string,
  visited: Set<string>
): readonly string[] => {
  const queue = [startId]
  const component: string[] = []
  visited.add(startId)

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    component.push(id)

    ;(adjacency.get(id) ?? []).forEach((nextId) => {
      if (!visited.has(nextId)) {
        visited.add(nextId)
        queue.push(nextId)
      }
    })
  }

  return component
}

const connectedComponents = (
  nodes: readonly GraphNode[],
  adjacency: ReadonlyMap<string, readonly string[]>
): readonly (readonly string[])[] => {
  const visited = new Set<string>()

  return [...nodes].sort(byTitle).reduce<readonly (readonly string[])[]>(
    (components, node) => (visited.has(node.id) ? components : [...components, collectComponent(adjacency, node.id, visited)]),
    []
  )
}

const selectSegmentSeeds = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  degrees: ReadonlyMap<string, number>
): readonly GraphNode[] => {
  const adjacency = createAdjacency(nodes, edges)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  return connectedComponents(nodes, adjacency).flatMap((component) => {
    const componentNodes = component.map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node))
    const naturalSeeds = componentNodes.filter(naturalSegmentSeed).sort(byDegreeThenTitle(degrees))

    return naturalSeeds.length > 0 ? naturalSeeds : componentNodes.sort(byDegreeThenTitle(degrees)).slice(0, 1)
  })
}

const assignSegments = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  degrees: ReadonlyMap<string, number>
): ReadonlyMap<string, string> => {
  const adjacency = createAdjacency(nodes, edges)
  const seeds = selectSegmentSeeds(nodes, edges, degrees)
  const assignments = new Map(seeds.map((seed) => [seed.id, segmentName(seed)]))
  const queue = seeds.map((seed) => seed.id)

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    const segment = assignments.get(id)

    if (!segment) {
      continue
    }

    ;(adjacency.get(id) ?? []).forEach((nextId) => {
      if (!assignments.has(nextId)) {
        assignments.set(nextId, segment)
        queue.push(nextId)
      }
    })
  }

  return new Map(nodes.map((node) => [node.id, assignments.get(node.id) ?? groupLabel(groupKey(node))]))
}

const groupNodesBySegment = (
  nodes: readonly GraphNode[],
  segments: ReadonlyMap<string, string>
): ReadonlyMap<string, readonly GraphNode[]> =>
  nodes.reduce<ReadonlyMap<string, readonly GraphNode[]>>((groups, node) => {
    const segment = segments.get(node.id) ?? groupLabel(groupKey(node))

    return new Map([...groups, [segment, [...(groups.get(segment) ?? []), node]]])
  }, new Map())

const segmentAngle = (segment: string, index: number, count: number): number =>
  segmentAngles[segment] ?? (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2

const createSegmentNodes = (
  segments: ReadonlyMap<string, string>,
  degrees: ReadonlyMap<string, number>,
  segmentCount: number
) => ([segment, nodes]: readonly [string, readonly GraphNode[]], segmentIndex: number): readonly GraphLayoutNode[] => {
  const sortedNodes = [...nodes].sort(byDegreeThenTitle(degrees))
  const angle = segmentAngle(segment, segmentIndex, segmentCount)
  const baseRadius = segmentCount === 1 ? 0 : 340 + Math.min(sortedNodes.length, 22) * 10
  const centerX = Math.cos(angle) * baseRadius
  const centerY = Math.sin(angle) * (baseRadius * 0.78)
  const petalSpread = 40 + Math.sqrt(sortedNodes.length) * 14

  return sortedNodes.map((node, index) => {
    const localAngle = index * 2.399963 + jitter(node.title, 0.42)
    const localRadius = Math.sqrt(index + 1) * petalSpread
    const hubPull = segmentCount === 1 ? 0 : Math.min(degrees.get(node.id) ?? 0, 12) * 12

    return {
      ...node,
      group: groupLabel(groupKey(node)),
      segment: segments.get(node.id) ?? segment,
      x: centerX + Math.cos(localAngle) * localRadius - Math.cos(angle) * hubPull + jitter(node.id, 24),
      y: centerY + Math.sin(localAngle) * localRadius * 0.78 - Math.sin(angle) * hubPull + jitter(node.path, 24)
    }
  })
}

const distanceBetween = (left: GraphLayoutNode, right: GraphLayoutNode): number =>
  Math.hypot(right.x - left.x, right.y - left.y)

const separatePair = (
  minDistance: number,
  left: GraphLayoutNode,
  right: GraphLayoutNode
): readonly [GraphLayoutNode, GraphLayoutNode] => {
  const dx = right.x - left.x
  const dy = right.y - left.y
  const distance = Math.max(Math.hypot(dx, dy), 0.001)

  if (distance >= minDistance) {
    return [left, right]
  }

  const push = (minDistance - distance) / 2
  const ux = dx / distance
  const uy = dy / distance

  return [
    {
      ...left,
      x: left.x - ux * push,
      y: left.y - uy * push
    },
    {
      ...right,
      x: right.x + ux * push,
      y: right.y + uy * push
    }
  ]
}

const relaxCollisions = (
  nodes: readonly GraphLayoutNode[],
  minDistance = 132,
  rounds = 32
): readonly GraphLayoutNode[] => {
  const relaxRound = (currentNodes: readonly GraphLayoutNode[]): readonly GraphLayoutNode[] =>
    currentNodes.reduce<readonly GraphLayoutNode[]>((resolvedNodes, node) => {
      const resolved = resolvedNodes.reduce<{
        readonly previous: readonly GraphLayoutNode[]
        readonly current: GraphLayoutNode
      }>(
        (state, previousNode) => {
          const [nextPrevious, nextCurrent] = separatePair(minDistance, previousNode, state.current)

          return {
            previous: [...state.previous, nextPrevious],
            current: nextCurrent
          }
        },
        {
          previous: [],
          current: node
        }
      )

      return [...resolved.previous, resolved.current]
    }, [])

  return Array.from({ length: rounds }).reduce<readonly GraphLayoutNode[]>((currentNodes) => relaxRound(currentNodes), nodes)
}

export const createCauliflowerGraphLayout = (graph: KnowledgeGraph): KnowledgeGraphLayout => {
  const degrees = countDegrees(graph.edges)
  const segments = assignSegments(graph.nodes, graph.edges, degrees)
  const segmentGroups = Array.from(groupNodesBySegment(graph.nodes, segments).entries())
    .sort(([left], [right]) => left.localeCompare(right))
  const nodes = relaxCollisions(segmentGroups.flatMap(createSegmentNodes(segments, degrees, segmentGroups.length)))

  return {
    nodes,
    edges: graph.edges
  }
}

export const getMinimumLayoutDistance = (nodes: readonly GraphLayoutNode[]): number =>
  nodes.reduce(
    (minimumDistance, leftNode, leftIndex) =>
      nodes.slice(leftIndex + 1).reduce(
        (innerMinimum, rightNode) => Math.min(innerMinimum, distanceBetween(leftNode, rightNode)),
        minimumDistance
      ),
    Number.POSITIVE_INFINITY
  )
