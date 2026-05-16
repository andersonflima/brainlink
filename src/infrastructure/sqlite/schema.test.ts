import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createSchema } from './schema.js'

const getColumns = (database: Database.Database, tableName: string): readonly string[] => {
  const rows = database.prepare(`SELECT name FROM pragma_table_info(?)`).all(tableName) as readonly { readonly name: string }[]

  return rows.map((row) => row.name)
}

describe('sqlite schema', () => {
  it('rebuilds legacy indexes that do not have agent namespace columns', () => {
    const database = new Database(':memory:')

    try {
      database.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          frontmatter_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          chunk_id UNINDEXED,
          document_id UNINDEXED,
          title,
          content
        );
      `)

      createSchema(database)

      expect(getColumns(database, 'documents')).toContain('agent_id')
      expect(getColumns(database, 'chunks_fts')).toContain('agent_id')
      expect(
        database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
      ).toEqual({
        value: '6'
      })
    } finally {
      database.close()
    }
  })

  it('creates weighted link columns and lookup indexes', () => {
    const database = new Database(':memory:')

    try {
      createSchema(database)

      expect(getColumns(database, 'links')).toEqual([
        'from_document_id',
        'to_title',
        'to_title_key',
        'to_document_id',
        'weight',
        'priority'
      ])
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_links_to_title_key'").get()
      ).toEqual({ name: 'idx_links_to_title_key' })
    } finally {
      database.close()
    }
  })
})
