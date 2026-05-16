export type ISODateString = string

export type KnowledgeDocument = {
  readonly id: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly tags: readonly string[]
  readonly links: readonly string[]
  readonly frontmatter: Readonly<Record<string, string>>
  readonly createdAt: ISODateString
  readonly updatedAt: ISODateString
}

export type KnowledgeChunk = {
  readonly id: string
  readonly documentId: string
  readonly ordinal: number
  readonly content: string
  readonly tokenCount: number
  readonly embeddingProvider: EmbeddingProviderName
  readonly embedding: readonly number[]
}

export type KnowledgeLink = {
  readonly fromDocumentId: string
  readonly toTitle: string
  readonly toDocumentId: string | null
  readonly weight: number
  readonly priority: LinkPriority
}

export type IndexedDocument = {
  readonly document: KnowledgeDocument
  readonly chunks: readonly KnowledgeChunk[]
  readonly links: readonly KnowledgeLink[]
}

export type SearchResult = {
  readonly documentId: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly chunkId: string
  readonly content: string
  readonly score: number
  readonly textScore: number
  readonly semanticScore: number
  readonly searchMode: SearchMode
  readonly tags: readonly string[]
}

export type GraphLink = {
  readonly agentId: string
  readonly fromTitle: string
  readonly fromPath: string
  readonly toTitle: string
  readonly toPath: string | null
  readonly weight: number
  readonly priority: LinkPriority
}

export type GraphNode = {
  readonly id: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly tags: readonly string[]
}

export type GraphEdge = {
  readonly source: string
  readonly target: string | null
  readonly targetTitle: string
  readonly weight: number
  readonly priority: LinkPriority
}

export type LinkPriority = 'low' | 'normal' | 'high' | 'critical'

export type KnowledgeGraph = {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

export type GraphLayoutNode = GraphNode & {
  readonly group: string
  readonly segment: string
  readonly x: number
  readonly y: number
}

export type GraphLayoutEdge = GraphEdge

export type KnowledgeGraphLayout = {
  readonly nodes: readonly GraphLayoutNode[]
  readonly edges: readonly GraphLayoutEdge[]
}

export type ContextSection = {
  readonly title: string
  readonly path: string
  readonly content: string
  readonly score: number
  readonly searchMode: SearchMode
  readonly tags: readonly string[]
}

export type ContextPackage = {
  readonly query: string
  readonly sections: readonly ContextSection[]
  readonly content: string
}

export type BrainlinkConfig = {
  readonly vault: string
  readonly host: string
  readonly port: number
  readonly allowedVaults: readonly string[]
  readonly defaultAgent?: string
  readonly autoIndexOnWrite: boolean
  readonly defaultSearchLimit: number
  readonly defaultContextTokens: number
  readonly embeddingProvider: EmbeddingProviderName
  readonly defaultSearchMode: SearchMode
  readonly chunkSize: number
  readonly agentProfiles: Readonly<Record<string, AgentProfileConfig>>
}

export type AgentProfileConfig = {
  readonly defaultSearchLimit?: number
  readonly defaultContextTokens?: number
  readonly defaultSearchMode?: SearchMode
}

export type EmbeddingProviderName = 'none' | 'local'

export type SearchMode = 'fts' | 'semantic' | 'hybrid'

export type AgentSummary = {
  readonly id: string
  readonly documentCount: number
}

export type BrokenLink = {
  readonly fromTitle: string
  readonly fromPath: string
  readonly toTitle: string
}

export type OrphanNode = {
  readonly title: string
  readonly path: string
  readonly tags: readonly string[]
}

export type VaultStats = {
  readonly documentCount: number
  readonly linkCount: number
  readonly resolvedLinkCount: number
  readonly brokenLinkCount: number
  readonly orphanCount: number
  readonly tagCount: number
  readonly tags: readonly string[]
}

export type VaultExtendedStats = {
  readonly stats: VaultStats
  readonly storage: {
    readonly markdownFileCount: number
    readonly totalFileCount: number
    readonly totalBytes: number
    readonly averageMarkdownBytes: number
    readonly newestNoteUpdatedAt?: ISODateString
    readonly oldestNoteUpdatedAt?: ISODateString
  }
  readonly quality: {
    readonly resolvedLinkRatio: number
    readonly brokenLinkRatio: number
    readonly orphanRatio: number
    readonly priorityDistribution: Readonly<Record<LinkPriority, number>>
  }
  readonly observability: {
    readonly probeQuery: string
    readonly latenciesMs: {
      readonly index: number
      readonly search: number
      readonly context: number
    }
  }
}

export type VaultValidation = {
  readonly ok: boolean
  readonly stats: VaultStats
  readonly brokenLinks: readonly BrokenLink[]
  readonly orphans: readonly OrphanNode[]
}

export type DoctorCheck = {
  readonly name: string
  readonly ok: boolean
  readonly message: string
}

export type DoctorReport = {
  readonly ok: boolean
  readonly checks: readonly DoctorCheck[]
  readonly recommendations?: readonly string[]
}
