import { readFile } from 'node:fs/promises'
import { createIndexedDocument, parseMarkdownDocument } from '../domain/markdown.js'
import type { IndexedDocument } from '../domain/types.js'
import { sharedAgentId } from '../domain/agents.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { ensureVault, readMarkdownFileSummaries } from '../infrastructure/file-system-vault.js'
import type { IndexedFileSnapshot } from '../infrastructure/index-state.js'
import { readIndexState, writeIndexState } from '../infrastructure/index-state.js'
import type { SearchPackBuildResult } from '../infrastructure/search-packs.js'
import { buildSearchPacks, ensureSearchPackManifest, toSearchPackBuildOptions } from '../infrastructure/search-packs.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export type IndexVaultResult = {
  readonly documentCount: number
  readonly chunkCount: number
  readonly linkCount: number
  readonly elapsedMs?: number
  readonly changedDocumentCount?: number
  readonly packs?: {
    readonly rebuilt: boolean
    readonly reason: string
    readonly packCount?: number
    readonly recordCount?: number
    readonly durationMs?: number
    readonly compression?: SearchPackBuildResult['compression']
  }
}

export type IndexVaultProgressPhase =
  | 'start'
  | 'scan'
  | 'parse'
  | 'embed'
  | 'persist'
  | 'packs'
  | 'complete'

export type IndexVaultProgressEvent = {
  readonly phase: IndexVaultProgressPhase
  readonly status: 'start' | 'finish' | 'skip'
  readonly message: string
  readonly elapsedMs: number
  readonly timestamp: string
  readonly details?: Record<string, unknown>
}

export type IndexVaultOptions = {
  readonly onProgress?: (event: IndexVaultProgressEvent) => void
}

type ParsedDocument = ReturnType<typeof parseMarkdownDocument>

type IndexedTitle = {
  readonly id: string
  readonly path: string
}

type TitleMaps = {
  readonly shared: ReadonlyMap<string, IndexedTitle>
  readonly byAgent: ReadonlyMap<string, ReadonlyMap<string, IndexedTitle>>
}

type MutableTitleMaps = {
  readonly shared: Map<string, IndexedTitle>
  readonly byAgent: Map<string, Map<string, IndexedTitle>>
}

const toTitleKey = (title: string): string =>
  title.toLowerCase()

const appendTitleEntry = (map: Map<string, IndexedTitle>, document: ParsedDocument): Map<string, IndexedTitle> => {
  const key = toTitleKey(document.title)

  if (!map.has(key)) {
    map.set(key, {
      id: document.id,
      path: document.path
    })
  }

  return map
}

const createTitleMaps = (documents: readonly ParsedDocument[]): TitleMaps =>
  [...documents]
    .sort((left, right) => left.path.localeCompare(right.path))
    .reduce<MutableTitleMaps>(
      (state, document) => {
        const agentMap = state.byAgent.get(document.agentId) ?? new Map<string, IndexedTitle>()
        appendTitleEntry(agentMap, document)
        state.byAgent.set(document.agentId, agentMap)

        if (document.agentId === sharedAgentId) {
          appendTitleEntry(state.shared, document)
        }

        return state
      },
      {
        shared: new Map(),
        byAgent: new Map()
      }
    )

const createScopedTitleResolver = (document: ParsedDocument, titleMaps: TitleMaps) => ({
  get: (title: string): string | undefined =>
    titleMaps.byAgent.get(document.agentId)?.get(title)?.id ?? titleMaps.shared.get(title)?.id
})

const embedIndexedDocuments = async (
  documents: readonly IndexedDocument[],
  providerName: ReturnType<typeof createEmbeddingProvider>['name']
): Promise<readonly IndexedDocument[]> => {
  if (documents.length === 0) {
    return documents
  }

  const provider = createEmbeddingProvider(providerName)
  const chunks = documents.flatMap((document) => document.chunks)
  const embeddings = await provider.embed(chunks.map((chunk) => chunk.content))
  const embeddingByChunkId = new Map(chunks.map((chunk, index) => [chunk.id, embeddings[index] ?? []]))

  return documents.map((indexedDocument) => ({
    ...indexedDocument,
    chunks: indexedDocument.chunks.map((chunk) => ({
      ...chunk,
      embeddingProvider: provider.name,
      embedding: embeddingByChunkId.get(chunk.id) ?? []
    }))
  }))
}

const relinkIndexedDocument = (indexedDocument: IndexedDocument, titleMaps: TitleMaps): IndexedDocument => {
  const resolver = createScopedTitleResolver(indexedDocument.document, titleMaps)

  return {
    ...indexedDocument,
    links: indexedDocument.links
      .map((link) => ({
        ...link,
        toDocumentId: resolver.get(link.toTitle.toLowerCase()) ?? null
      }))
      .filter((link) => link.toDocumentId !== indexedDocument.document.id)
  }
}

const toIndexResult = (documents: readonly IndexedDocument[]): IndexVaultResult => ({
  documentCount: documents.length,
  chunkCount: documents.reduce((total, document) => total + document.chunks.length, 0),
  linkCount: documents.reduce((total, document) => total + document.links.length, 0)
})

const toSnapshot = (
  summaries: readonly { relativePath: string; updatedAt: Date; size: number }[]
): readonly IndexedFileSnapshot[] =>
  summaries.map((summary) => ({
    path: summary.relativePath,
    mtimeMs: summary.updatedAt.getTime(),
    size: summary.size
  }))

const createSnapshotMap = (snapshot: readonly IndexedFileSnapshot[]): ReadonlyMap<string, IndexedFileSnapshot> =>
  new Map(snapshot.map((entry) => [entry.path, entry]))

const readChangedDocuments = async (
  absoluteVaultPath: string,
  changedSummaries: readonly {
    absolutePath: string
    createdAt: Date
    relativePath: string
    updatedAt: Date
  }[]
): Promise<ReadonlyMap<string, ParsedDocument>> => {
  const parsed = await Promise.all(
    changedSummaries.map(async (summary) =>
      parseMarkdownDocument({
        absolutePath: summary.absolutePath,
        vaultPath: absoluteVaultPath,
        content: await readFile(summary.absolutePath, 'utf8'),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt
      })
    )
  )

  return new Map(parsed.map((document) => [document.path, document]))
}

export const indexVault = async (vaultPath: string): Promise<IndexVaultResult> => {
  return indexVaultWithOptions(vaultPath, {})
}

export const indexVaultWithOptions = async (vaultPath: string, options: IndexVaultOptions): Promise<IndexVaultResult> => {
  const startedAt = process.hrtime.bigint()
  const elapsedMs = (): number => Number(process.hrtime.bigint() - startedAt) / 1_000_000
  const emit = (
    phase: IndexVaultProgressPhase,
    status: 'start' | 'finish' | 'skip',
    message: string,
    details?: Record<string, unknown>
  ): void => {
    options.onProgress?.({
      phase,
      status,
      message,
      elapsedMs: elapsedMs(),
      timestamp: new Date().toISOString(),
      details
    })
  }

  emit('start', 'start', 'Indexing started')
  const absoluteVaultPath = await ensureVault(vaultPath)
  const config = await loadBrainlinkConfig()
  emit('scan', 'start', 'Scanning markdown files')
  const [summaries, previousState] = await Promise.all([
    readMarkdownFileSummaries(absoluteVaultPath),
    readIndexState(absoluteVaultPath)
  ])
  emit('scan', 'finish', 'Scan complete', {
    markdownFiles: summaries.length,
    hasPreviousState: previousState != null
  })
  const index = openFileIndex(absoluteVaultPath)

  try {
    const existingIndexedDocuments = await index.getIndexedDocuments()
    const existingByPath = new Map(existingIndexedDocuments.map((document) => [document.document.path, document]))
    const currentSnapshot = toSnapshot(summaries)
    const currentSnapshotMap = createSnapshotMap(currentSnapshot)
    const previousSnapshotMap = createSnapshotMap(previousState?.files ?? [])
    const settingsChanged =
      previousState == null ||
      previousState.chunkSize !== config.chunkSize ||
      previousState.embeddingProvider !== config.embeddingProvider
    const packSettingsChanged =
      previousState == null ||
      previousState.searchPackRowChunkSize !== config.searchPack.rowChunkSize ||
      previousState.searchPackCompressionLevel !== config.searchPack.compressionLevel ||
      previousState.searchPackUseDictionary !== config.searchPack.useDictionary
    const changedPaths = new Set<string>()

    for (let index = 0; index < summaries.length; index += 1) {
      const summary = summaries[index]
      const previous = previousSnapshotMap.get(summary.relativePath)
      const changed =
        settingsChanged ||
        previous == null ||
        previous.mtimeMs !== summary.updatedAt.getTime() ||
        previous.size !== summary.size ||
        !existingByPath.has(summary.relativePath)

      if (changed) {
        changedPaths.add(summary.relativePath)
      }
    }

    const hasDeletes = previousState
      ? previousState.files.some((entry) => !currentSnapshotMap.has(entry.path))
      : false
    const manifestRecovery = await ensureSearchPackManifest(absoluteVaultPath)

    if (
      changedPaths.size === 0 &&
      !hasDeletes &&
      existingIndexedDocuments.length === summaries.length &&
      previousState != null
    ) {
      const result = {
        ...toIndexResult(existingIndexedDocuments),
        elapsedMs: elapsedMs(),
        changedDocumentCount: 0,
        packs: {
          rebuilt: false,
          reason: manifestRecovery.repaired ? 'No changes detected; pack manifest repaired' : 'No changes detected'
        }
      } satisfies IndexVaultResult
      emit('complete', 'skip', 'Index skipped: no changes detected', {
        elapsedMs: result.elapsedMs,
        manifestRepaired: manifestRecovery.repaired,
        manifestRecoverySource: manifestRecovery.source
      })
      return result
    }

    const changedSummaries = summaries.filter((summary) => changedPaths.has(summary.relativePath))
    emit('parse', 'start', 'Parsing changed markdown files', {
      changedFiles: changedSummaries.length
    })
    const changedDocumentsByPath = await readChangedDocuments(absoluteVaultPath, changedSummaries)
    emit('parse', 'finish', 'Parse complete', {
      changedDocuments: changedDocumentsByPath.size
    })
    const documents = summaries.flatMap((summary) => {
      const changed = changedDocumentsByPath.get(summary.relativePath)
      if (changed) {
        return [changed]
      }
      const existing = existingByPath.get(summary.relativePath)
      return existing ? [existing.document] : []
    })
    const titleMaps = createTitleMaps(documents)
    emit('embed', 'start', 'Embedding changed chunks', {
      changedDocuments: changedDocumentsByPath.size
    })
    const changedIndexedDocuments = changedDocumentsByPath.size > 0
      ? await embedIndexedDocuments(
          Array.from(changedDocumentsByPath.values()).map((document) =>
            createIndexedDocument(document, createScopedTitleResolver(document, titleMaps), config.chunkSize)
          ),
          config.embeddingProvider
        )
      : []
    emit('embed', changedDocumentsByPath.size > 0 ? 'finish' : 'skip', changedDocumentsByPath.size > 0 ? 'Embedding complete' : 'Embedding skipped', {
      changedIndexedDocuments: changedIndexedDocuments.length
    })
    const changedIndexedByPath = new Map(changedIndexedDocuments.map((document) => [document.document.path, document]))
    const needsRelink = settingsChanged || hasDeletes || changedPaths.size > 0
    const indexedDocuments = documents.map((document) => {
      const changed = changedIndexedByPath.get(document.path)
      if (changed) {
        return changed
      }

      const existing = existingByPath.get(document.path)
      if (!existing) {
        return createIndexedDocument(document, createScopedTitleResolver(document, titleMaps), config.chunkSize)
      }

      return needsRelink ? relinkIndexedDocument(existing, titleMaps) : existing
    })

    emit('persist', 'start', 'Persisting index')
    await index.reset()
    await index.saveDocuments(indexedDocuments)
    emit('persist', 'finish', 'Index persisted', {
      indexedDocuments: indexedDocuments.length
    })

    const existingPackManifest = manifestRecovery.repaired || manifestRecovery.source === 'not-needed'
    const changedCount = changedPaths.size
    const documentCount = Math.max(indexedDocuments.length, 1)
    const changeRatio = changedCount / documentCount
    const previousPendingPackChanges = previousState?.pendingPackChanges ?? 0
    const pendingPackChanges = previousPendingPackChanges + changedCount
    const shouldRebuildPacks =
      !existingPackManifest ||
      settingsChanged ||
      packSettingsChanged ||
      hasDeletes ||
      changedCount >= 400 ||
      changeRatio >= 0.04 ||
      pendingPackChanges >= 1200

    let packResult: SearchPackBuildResult | undefined
    const packReason = !existingPackManifest
      ? 'Missing pack manifest'
      : manifestRecovery.repaired
        ? 'Pack manifest repaired from existing packs'
      : settingsChanged
        ? 'Index settings changed'
        : packSettingsChanged
          ? 'Search pack settings changed'
        : hasDeletes
          ? 'Document deletions detected'
          : changedCount >= 400
            ? 'Changed file count threshold reached'
            : changeRatio >= 0.04
              ? 'Change ratio threshold reached'
              : pendingPackChanges >= 1200
                ? 'Pending pack changes threshold reached'
                : 'Pack rebuild skipped'
    if (shouldRebuildPacks) {
      emit('packs', 'start', 'Rebuilding compressed search packs', {
        reason: packReason
      })
      try {
        packResult = await buildSearchPacks(absoluteVaultPath, indexedDocuments, toSearchPackBuildOptions(config))
        emit('packs', 'finish', 'Compressed packs rebuilt', {
          reason: packReason,
          packCount: packResult.packCount,
          recordCount: packResult.recordCount,
          durationMs: packResult.durationMs,
          compressionRatio: packResult.compression.ratio
        })
      } catch {
        // Pack generation is best-effort. The JSON index remains the primary path.
        emit('packs', 'skip', 'Pack rebuild failed; continuing with JSON index', {
          reason: packReason
        })
      }
    } else {
      emit('packs', 'skip', 'Pack rebuild not required', {
        reason: packReason
      })
    }

    const packsRebuilt = packResult != null
    const packResultReason = shouldRebuildPacks && !packsRebuilt ? `${packReason} (failed)` : packReason

    await writeIndexState(absoluteVaultPath, {
      chunkSize: config.chunkSize,
      embeddingProvider: config.embeddingProvider,
      searchPackRowChunkSize: config.searchPack.rowChunkSize,
      searchPackCompressionLevel: config.searchPack.compressionLevel,
      searchPackUseDictionary: config.searchPack.useDictionary,
      files: currentSnapshot,
      pendingPackChanges: packsRebuilt ? 0 : pendingPackChanges
    })

    const result = {
      ...toIndexResult(indexedDocuments),
      elapsedMs: elapsedMs(),
      changedDocumentCount: changedDocumentsByPath.size,
      packs: {
        rebuilt: packsRebuilt,
        reason: packResultReason,
        ...(packResult
          ? {
              packCount: packResult.packCount,
              recordCount: packResult.recordCount,
              durationMs: packResult.durationMs,
              compression: packResult.compression
            }
          : {})
      }
    } satisfies IndexVaultResult
    emit('complete', 'finish', 'Indexing complete', {
      documentCount: result.documentCount,
      chunkCount: result.chunkCount,
      linkCount: result.linkCount,
      elapsedMs: result.elapsedMs
    })

    return result
  } finally {
    index.close()
  }
}
