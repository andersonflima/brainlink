import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createIndexedDocument, parseMarkdownDocument } from '../domain/markdown.js'
import type { IndexedDocument } from '../domain/types.js'
import { sharedAgentId } from '../domain/agents.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { ensureVault, readMarkdownFileSummaries } from '../infrastructure/file-system-vault.js'
import type { IndexedFileSnapshot } from '../infrastructure/index-state.js'
import { readIndexState, writeIndexState } from '../infrastructure/index-state.js'
import { buildSearchPacks } from '../infrastructure/search-packs.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export type IndexVaultResult = {
  readonly documentCount: number
  readonly chunkCount: number
  readonly linkCount: number
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

const packManifestPath = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', 'search-packs', 'manifest.json')

const hasPackManifest = async (vaultPath: string): Promise<boolean> => {
  try {
    await stat(packManifestPath(vaultPath))
    return true
  } catch {
    return false
  }
}

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
  const absoluteVaultPath = await ensureVault(vaultPath)
  const config = await loadBrainlinkConfig()
  const [summaries, previousState] = await Promise.all([
    readMarkdownFileSummaries(absoluteVaultPath),
    readIndexState(absoluteVaultPath)
  ])
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

    if (
      changedPaths.size === 0 &&
      !hasDeletes &&
      existingIndexedDocuments.length === summaries.length &&
      previousState != null
    ) {
      return toIndexResult(existingIndexedDocuments)
    }

    const changedSummaries = summaries.filter((summary) => changedPaths.has(summary.relativePath))
    const changedDocumentsByPath = await readChangedDocuments(absoluteVaultPath, changedSummaries)
    const documents = summaries.flatMap((summary) => {
      const changed = changedDocumentsByPath.get(summary.relativePath)
      if (changed) {
        return [changed]
      }
      const existing = existingByPath.get(summary.relativePath)
      return existing ? [existing.document] : []
    })
    const titleMaps = createTitleMaps(documents)
    const changedIndexedDocuments = changedDocumentsByPath.size > 0
      ? await embedIndexedDocuments(
          Array.from(changedDocumentsByPath.values()).map((document) =>
            createIndexedDocument(document, createScopedTitleResolver(document, titleMaps), config.chunkSize)
          ),
          config.embeddingProvider
        )
      : []
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

    await index.reset()
    await index.saveDocuments(indexedDocuments)

    const existingPackManifest = await hasPackManifest(absoluteVaultPath)
    const changedCount = changedPaths.size
    const documentCount = Math.max(indexedDocuments.length, 1)
    const changeRatio = changedCount / documentCount
    const previousPendingPackChanges = previousState?.pendingPackChanges ?? 0
    const pendingPackChanges = previousPendingPackChanges + changedCount
    const shouldRebuildPacks =
      !existingPackManifest ||
      settingsChanged ||
      hasDeletes ||
      changedCount >= 400 ||
      changeRatio >= 0.04 ||
      pendingPackChanges >= 1200

    if (shouldRebuildPacks) {
      try {
        await buildSearchPacks(absoluteVaultPath, indexedDocuments)
      } catch {
        // Pack generation is best-effort. The JSON index remains the primary path.
      }
    }

    await writeIndexState(absoluteVaultPath, {
      chunkSize: config.chunkSize,
      embeddingProvider: config.embeddingProvider,
      files: currentSnapshot,
      pendingPackChanges: shouldRebuildPacks ? 0 : pendingPackChanges
    })

    return toIndexResult(indexedDocuments)
  } finally {
    index.close()
  }
}
