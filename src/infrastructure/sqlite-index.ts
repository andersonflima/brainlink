import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { createIndexWriter } from './sqlite/document-writer.js'
import { createGraphReader } from './sqlite/graph-reader.js'
import { createRecoverySnapshot, openDatabaseWithRecovery } from './sqlite/recovery.js'
import { createSchema } from './sqlite/schema.js'
import { createSearchReader } from './sqlite/search-reader.js'
import type { SqliteIndex } from './sqlite/types.js'

export const openSqliteIndex = (vaultPath: string): SqliteIndex => {
  const databasePath = join(vaultPath, '.brainlink', 'brainlink.db')
  const backupPath = join(vaultPath, '.brainlink', 'brainlink.db.backup')
  const database = openDatabaseWithRecovery(databasePath, backupPath)
  const indexWriter = createIndexWriter(database)

  chmodSync(databasePath, 0o600)

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -20000;
  `)
  createSchema(database)

  return {
    reset: () => indexWriter.reset(),
    saveDocuments: (documents) => {
      indexWriter.saveDocuments(documents)
      try {
        createRecoverySnapshot(database, backupPath)
      } catch {
        // Snapshot creation is best-effort. Indexing success should not fail because of backup I/O.
      }
    },
    ...createSearchReader(database),
    ...createGraphReader(database),
    close: () => database.close()
  }
}
