import { describe, expect, it } from 'vitest'
import { createCauliflowerGraphLayout, getMinimumLayoutDistance } from './graph-layout.js'
import type { KnowledgeGraph } from './types.js'

describe('graph layout', () => {
  it('keeps content group metadata while assigning graph segments', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        { id: 'moc', agentId: 'shared', title: 'MOC Brainlink', path: '00-maps/moc-brainlink.md', content: '', tags: [] },
        { id: 'agent', agentId: 'shared', title: 'Agent Runtime Loop', path: '40-agents/agent-runtime-loop.md', content: '', tags: [] },
        { id: 'context', agentId: 'shared', title: 'Context Builder', path: '50-retrieval/context-builder.md', content: '', tags: [] }
      ],
      edges: [
        { source: 'moc', target: 'agent', targetTitle: 'Agent Runtime Loop' },
        { source: 'moc', target: 'context', targetTitle: 'Context Builder' },
        { source: 'agent', target: 'context', targetTitle: 'Context Builder' }
      ]
    }
    const layout = createCauliflowerGraphLayout(graph)
    const moc = layout.nodes.find((node) => node.id === 'moc')
    const agent = layout.nodes.find((node) => node.id === 'agent')
    const context = layout.nodes.find((node) => node.id === 'context')

    expect(moc?.group).toBe('maps')
    expect(agent?.group).toBe('agents')
    expect(context?.group).toBe('retrieval')
    expect(moc?.segment).toBe('Brainlink')
    expect(agent?.segment).toBe('Brainlink')
    expect(context?.segment).toBe('Brainlink')
    expect(layout.edges).toHaveLength(3)
  })

  it('places cauliflower petals by graph segment instead of content folder group', () => {
    const graph: KnowledgeGraph = {
      nodes: [
        { id: 'moc-a', agentId: 'shared', title: 'MOC Architecture', path: '00-maps/moc-architecture.md', content: '', tags: [] },
        { id: 'moc-b', agentId: 'shared', title: 'MOC Retrieval', path: '00-maps/moc-retrieval.md', content: '', tags: [] },
        { id: 'concept-a', agentId: 'shared', title: 'API Gateway', path: '20-concepts/api-gateway.md', content: '', tags: [] },
        { id: 'decision-a', agentId: 'shared', title: 'HTTP Local API ADR', path: '30-architecture/http-local-api.md', content: '', tags: [] },
        { id: 'concept-b', agentId: 'shared', title: 'Context Builder', path: '20-concepts/context-builder.md', content: '', tags: [] },
        { id: 'decision-b', agentId: 'shared', title: 'Ranking Strategy', path: '50-retrieval/ranking-strategy.md', content: '', tags: [] }
      ],
      edges: [
        { source: 'moc-a', target: 'concept-a', targetTitle: 'API Gateway' },
        { source: 'moc-a', target: 'decision-a', targetTitle: 'HTTP Local API ADR' },
        { source: 'moc-b', target: 'concept-b', targetTitle: 'Context Builder' },
        { source: 'moc-b', target: 'decision-b', targetTitle: 'Ranking Strategy' },
        { source: 'concept-a', target: 'concept-b', targetTitle: 'Context Builder' }
      ]
    }
    const layout = createCauliflowerGraphLayout(graph)
    const conceptA = layout.nodes.find((node) => node.id === 'concept-a')
    const decisionA = layout.nodes.find((node) => node.id === 'decision-a')
    const conceptB = layout.nodes.find((node) => node.id === 'concept-b')
    const mocA = layout.nodes.find((node) => node.id === 'moc-a')
    const mocB = layout.nodes.find((node) => node.id === 'moc-b')
    const architectureDistance = Math.hypot((conceptA?.x ?? 0) - (mocA?.x ?? 0), (conceptA?.y ?? 0) - (mocA?.y ?? 0))
    const crossSegmentDistance = Math.hypot((conceptA?.x ?? 0) - (mocB?.x ?? 0), (conceptA?.y ?? 0) - (mocB?.y ?? 0))

    expect(conceptA?.group).toBe('concepts')
    expect(decisionA?.group).toBe('architecture')
    expect(conceptA?.segment).toBe('Architecture')
    expect(decisionA?.segment).toBe('Architecture')
    expect(conceptB?.segment).toBe('Retrieval')
    expect(architectureDistance).toBeLessThan(crossSegmentDistance)
  })

  it('keeps dense layouts separated enough for labels and nodes', () => {
    const nodes = Array.from({ length: 36 }, (_, index) => ({
      id: `node-${index}`,
      agentId: 'shared',
      title: `Node ${index}`,
      path: `20-concepts/node-${index}.md`,
      content: '',
      tags: []
    }))
    const graph: KnowledgeGraph = {
      nodes,
      edges: nodes.slice(1).map((node) => ({
        source: 'node-0',
        target: node.id,
        targetTitle: node.title
      }))
    }
    const layout = createCauliflowerGraphLayout(graph)

    expect(getMinimumLayoutDistance(layout.nodes)).toBeGreaterThan(58)
  })
})
