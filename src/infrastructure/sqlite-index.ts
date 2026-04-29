import Database from 'better-sqlite3'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { createIndexWriter } from './sqlite/document-writer.js'
import { createGraphReader } from './sqlite/graph-reader.js'
import { createSchema } from './sqlite/schema.js'
import { createSearchReader } from './sqlite/search-reader.js'
import type { SqliteIndex } from './sqlite/types.js'

export const openSqliteIndex = (vaultPath: string): SqliteIndex => {
  const databasePath = join(vaultPath, '.brainlink', 'brainlink.db')
  const database = new Database(databasePath)

  chmodSync(databasePath, 0o600)

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
  `)
  createSchema(database)

  return {
    ...createIndexWriter(database),
    ...createSearchReader(database),
    ...createGraphReader(database),
    close: () => database.close()
  }
}
