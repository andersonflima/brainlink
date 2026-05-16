import { describe, expect, it } from 'vitest'
import { cosineSimilarity, createEmbeddingBuckets, createLocalEmbedding } from './embeddings.js'

describe('local embeddings', () => {
  it('creates deterministic vectors for semantic retrieval', () => {
    const query = createLocalEmbedding('jwt authentication token policy')
    const related = createLocalEmbedding('authentication policy for jwt tokens')
    const unrelated = createLocalEmbedding('graph backlinks and markdown notes')

    expect(query).toHaveLength(192)
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated))
  })

  it('creates stable semantic buckets for candidate retrieval', () => {
    const queryBuckets = createEmbeddingBuckets(createLocalEmbedding('jwt authentication token policy'))
    const relatedBuckets = createEmbeddingBuckets(createLocalEmbedding('authentication policy for jwt tokens'))
    const unrelatedBuckets = createEmbeddingBuckets(createLocalEmbedding('graph backlinks and markdown notes'))
    const relatedOverlap = queryBuckets.filter((bucket) => relatedBuckets.includes(bucket)).length
    const unrelatedOverlap = queryBuckets.filter((bucket) => unrelatedBuckets.includes(bucket)).length

    expect(queryBuckets.length).toBeGreaterThan(0)
    expect(queryBuckets.length).toBeLessThanOrEqual(24)
    expect(relatedOverlap).toBeGreaterThan(unrelatedOverlap)
  })

  it('ignores inherited object keys while expanding aliases', () => {
    expect(() => createLocalEmbedding('__proto__ constructor prototype auth token')).not.toThrow()
  })
})
