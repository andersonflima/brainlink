import { describe, expect, it } from 'vitest'
import { getBrokenLinks, getOrphanNodes, getVaultStats } from './graph-analysis.js'
import type { KnowledgeGraph } from './types.js'

describe('graph analysis', () => {
  const graph: KnowledgeGraph = {
    nodes: [
      { id: 'a', agentId: 'shared', title: 'A', path: 'a.md', content: '', tags: ['x'] },
      { id: 'b', agentId: 'shared', title: 'B', path: 'b.md', content: '', tags: ['y'] },
      { id: 'c', agentId: 'shared', title: 'C', path: 'c.md', content: '', tags: ['x'] }
    ],
    edges: [
      { source: 'a', target: 'b', targetTitle: 'B', weight: 1, priority: 'normal' },
      { source: 'a', target: null, targetTitle: 'Missing', weight: 1, priority: 'normal' }
    ]
  }

  it('detects broken links', () => {
    expect(getBrokenLinks(graph)).toEqual([{ fromTitle: 'A', fromPath: 'a.md', toTitle: 'Missing' }])
  })

  it('detects orphan nodes and stats', () => {
    expect(getOrphanNodes(graph)).toEqual([{ title: 'C', path: 'c.md', tags: ['x'] }])
    expect(getVaultStats(graph)).toMatchObject({
      documentCount: 3,
      linkCount: 2,
      resolvedLinkCount: 1,
      brokenLinkCount: 1,
      orphanCount: 1,
      tagCount: 2
    })
  })
})
