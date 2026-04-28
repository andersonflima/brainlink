import Database from 'better-sqlite3'
import type { SqliteIndexWriter } from './types.js'

export const createIndexWriter = (database: Database.Database): SqliteIndexWriter => ({
reset: () => {
      database.exec(`
        DELETE FROM chunks_fts;
        DELETE FROM links;
        DELETE FROM chunks;
        DELETE FROM documents;
      `)
    },
  saveDocuments: (documents) => {
      const insertDocument = database.prepare(`
        INSERT INTO documents (id, agent_id, title, path, content, tags_json, frontmatter_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertChunk = database.prepare(`
        INSERT INTO chunks (id, document_id, ordinal, content, token_count, embedding_provider, embedding_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertChunkFts = database.prepare(`
        INSERT INTO chunks_fts (chunk_id, document_id, agent_id, title, content)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertLink = database.prepare(`
        INSERT INTO links (from_document_id, to_title, to_document_id)
        VALUES (?, ?, ?)
      `)

      const transaction = database.transaction(() => {
        documents.forEach(({ document, chunks, links }) => {
          insertDocument.run(
            document.id,
            document.agentId,
            document.title,
            document.path,
            document.content,
            JSON.stringify(document.tags),
            JSON.stringify(document.frontmatter),
            document.createdAt,
            document.updatedAt
          )

          chunks.forEach((chunk) => {
            insertChunk.run(
              chunk.id,
              chunk.documentId,
              chunk.ordinal,
              chunk.content,
              chunk.tokenCount,
              chunk.embeddingProvider,
              JSON.stringify(chunk.embedding)
            )
            insertChunkFts.run(chunk.id, chunk.documentId, document.agentId, document.title, chunk.content)
          })
        })

        documents.forEach(({ links }) => {
          links.forEach((link) => {
            insertLink.run(link.fromDocumentId, link.toTitle, link.toDocumentId)
          })
        })
      })

      transaction()
  }
})
