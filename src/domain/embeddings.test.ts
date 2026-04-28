import { describe, expect, it } from 'vitest'
import { cosineSimilarity, createLocalEmbedding } from './embeddings.js'

describe('local embeddings', () => {
  it('creates deterministic vectors for semantic retrieval', () => {
    const query = createLocalEmbedding('jwt authentication token policy')
    const related = createLocalEmbedding('authentication policy for jwt tokens')
    const unrelated = createLocalEmbedding('sqlite graph backlinks and markdown notes')

    expect(query).toHaveLength(192)
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated))
  })
})
