import { describe, expect, it } from 'vitest'
import { createClientJs } from './client-js.js'

describe('graph client rendering policy', () => {
  it('keeps massive graph zoom-in rendering progressive and parseable', () => {
    const clientScript = createClientJs()

    expect(() => new Function(clientScript)).not.toThrow()
    expect(clientScript).toContain('const zoomedMassiveRenderNodeBudget = 2200')
    expect(clientScript).toContain('state.transform.scale >= 0.28')
    expect(clientScript).toContain('sourceWithCarryIds.has(node.id)')
    expect(clientScript).toContain('const drawEdgeBatch = (edges, options) =>')
    expect(clientScript).toContain('const drawNodeBatch = (nodes) =>')
    expect(clientScript).toContain('const regularEdgeBatchKey = (edge) =>')
    expect(clientScript).not.toContain('if (state.nodes.length <= largeGraphNodeThreshold) {\\n    state.renderNodes.forEach(node => drawSingleNode(node))')
    expect(clientScript).toContain('if (nodeCount > 50000) return 0.26')
    expect(clientScript).toContain('if (nodeCount > 50000) return 5.4')
    expect(clientScript).toContain("const webGlRenderer = createWebGlRenderer(glCanvas)")
    expect(clientScript).toContain('const drawAcceleratedGraph = (width, height, drawEdges) =>')
    expect(clientScript).toContain('const isDominantHub = (hub, nodeCount = state.visibleNodes.length) =>')
    expect(clientScript).toContain('const ecosystemGroupSize = 1000')
    expect(clientScript).toContain('const ecosystemGroupSizes = [1000, 250, 60]')
    expect(clientScript).toContain('const buildEcosystemGraph = (nodes) =>')
    expect(clientScript).toContain('const selectHierarchicalEcosystemClusters = viewport =>')
    expect(clientScript).toContain('state.renderClusterEdges = ecosystemEdgesForClusters(clusters)')
    expect(clientScript).not.toContain('if (scale < 0.006) return Math.max(factor, 1.48)')
  })
})
