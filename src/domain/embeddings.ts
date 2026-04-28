export type EmbeddingVector = readonly number[]

export type EmbeddingProvider = {
  readonly name: string
  readonly embed: (input: readonly string[]) => Promise<readonly EmbeddingVector[]>
}

export const createDisabledEmbeddingProvider = (): EmbeddingProvider => ({
  name: 'none',
  embed: async () => []
})
