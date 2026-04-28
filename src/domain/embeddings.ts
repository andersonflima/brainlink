import type { EmbeddingProviderName } from './types.js'

export type EmbeddingVector = readonly number[]

export type EmbeddingProvider = {
  readonly name: EmbeddingProviderName
  readonly embed: (input: readonly string[]) => Promise<readonly EmbeddingVector[]>
}

const localDimensions = 192
const tokenPattern = /[\p{L}\p{N}_-]+/gu

const stopWords = new Set([
  'a',
  'as',
  'and',
  'ao',
  'aos',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'for',
  'is',
  'o',
  'os',
  'para',
  'por',
  'que',
  'the',
  'to',
  'um',
  'uma',
  'use',
  'uses',
  'using'
])

const aliases: Readonly<Record<string, readonly string[]>> = {
  ai: ['agent', 'model'],
  api: ['interface', 'client'],
  auth: ['authentication', 'authorization', 'identity'],
  authentication: ['auth', 'identity'],
  backend: ['server', 'api'],
  cli: ['terminal', 'command'],
  context: ['memory', 'knowledge'],
  db: ['database', 'storage'],
  frontend: ['ui', 'browser'],
  jwt: ['token', 'auth', 'authentication'],
  llm: ['ai', 'agent', 'model'],
  mcp: ['agent', 'tool', 'integration'],
  memory: ['context', 'knowledge'],
  nodejs: ['node', 'runtime'],
  test: ['tests', 'testing', 'validation'],
  tests: ['test', 'testing', 'validation'],
  token: ['jwt', 'auth'],
  ui: ['frontend', 'browser']
}

const normalizeToken = (token: string): string =>
  token
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const tokenize = (input: string): readonly string[] =>
  input
    .match(tokenPattern)
    ?.map(normalizeToken)
    .filter((token) => token.length > 1 && !stopWords.has(token)) ?? []

const expandTokens = (tokens: readonly string[]): readonly string[] =>
  tokens.flatMap((token) => [token, ...(aliases[token] ?? [])])

const hash = (value: string): number =>
  Array.from(value).reduce((state, char) => Math.imul(state ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0

const featureHash = (feature: string): readonly [number, number] => {
  const value = hash(feature)
  const index = value % localDimensions
  const sign = value & 1 ? 1 : -1

  return [index, sign]
}

const normalizeVector = (vector: readonly number[]): EmbeddingVector => {
  const magnitude = Math.hypot(...vector)

  return magnitude === 0 ? vector : vector.map((value) => value / magnitude)
}

const addFeature = (vector: number[], feature: string, weight: number): number[] => {
  const [index, sign] = featureHash(feature)

  return vector.map((value, currentIndex) => (currentIndex === index ? value + sign * weight : value))
}

const tokenFeatures = (tokens: readonly string[]): readonly string[] => [
  ...tokens.map((token) => `t:${token}`),
  ...tokens.slice(0, -1).map((token, index) => `b:${token}:${tokens[index + 1]}`)
]

export const createLocalEmbedding = (input: string): EmbeddingVector => {
  const tokens = expandTokens(tokenize(input))
  const initial = Array.from({ length: localDimensions }, () => 0)
  const weighted = tokenFeatures(tokens).reduce(
    (vector, feature) => addFeature(vector, feature, feature.startsWith('b:') ? 0.65 : 1),
    initial
  )

  return normalizeVector(weighted)
}

export const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  const length = Math.min(left.length, right.length)

  if (length === 0) {
    return 0
  }

  const dot = left.slice(0, length).reduce((total, value, index) => total + value * (right[index] ?? 0), 0)
  const leftMagnitude = Math.hypot(...left.slice(0, length))
  const rightMagnitude = Math.hypot(...right.slice(0, length))

  return leftMagnitude === 0 || rightMagnitude === 0 ? 0 : dot / (leftMagnitude * rightMagnitude)
}

export const createDisabledEmbeddingProvider = (): EmbeddingProvider => ({
  name: 'none',
  embed: async (input) => input.map(() => [])
})

export const createLocalEmbeddingProvider = (): EmbeddingProvider => ({
  name: 'local',
  embed: async (input) => input.map(createLocalEmbedding)
})

export const createEmbeddingProvider = (name: EmbeddingProviderName): EmbeddingProvider =>
  name === 'local' ? createLocalEmbeddingProvider() : createDisabledEmbeddingProvider()
