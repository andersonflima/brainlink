import { createIndexedDocument, parseMarkdownDocument } from '../domain/markdown.js'
import type { IndexedDocument } from '../domain/types.js'
import { sharedAgentId } from '../domain/agents.js'
import { ensureVault, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export type IndexVaultResult = {
  readonly documentCount: number
  readonly chunkCount: number
  readonly linkCount: number
}

type ParsedDocument = ReturnType<typeof parseMarkdownDocument>

const toTitleEntry = (document: ParsedDocument): readonly [string, string] => [document.title.toLowerCase(), document.id]

const createScopedTitleMap = (
  document: ParsedDocument,
  documents: readonly ParsedDocument[]
): ReadonlyMap<string, string> =>
  new Map([
    ...documents.filter((candidate) => candidate.agentId === sharedAgentId).map(toTitleEntry),
    ...documents.filter((candidate) => candidate.agentId === document.agentId).map(toTitleEntry)
  ])

export const indexVault = async (vaultPath: string): Promise<IndexVaultResult> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const files = await readMarkdownFiles(absoluteVaultPath)
  const documents = files.map((file) =>
    parseMarkdownDocument({
      absolutePath: file.absolutePath,
      vaultPath: absoluteVaultPath,
      content: file.content,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    })
  )
  const indexedDocuments: readonly IndexedDocument[] = documents.map((document) =>
    createIndexedDocument(document, createScopedTitleMap(document, documents))
  )
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    index.reset()
    index.saveDocuments(indexedDocuments)

    return {
      documentCount: indexedDocuments.length,
      chunkCount: indexedDocuments.reduce((total, document) => total + document.chunks.length, 0),
      linkCount: indexedDocuments.reduce((total, document) => total + document.links.length, 0)
    }
  } finally {
    index.close()
  }
}
