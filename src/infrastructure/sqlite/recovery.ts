import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

const sqliteCorruptionHints = [
  'database disk image is malformed',
  'file is not a database',
  'database is corrupted',
  'malformed database schema',
  'sqlite quick_check failed'
]

const normalizeMessage = (error: unknown): string =>
  error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

const isSqliteCorruptionError = (error: unknown): boolean =>
  sqliteCorruptionHints.some((hint) => normalizeMessage(error).includes(hint))

const safeUnlink = (path: string): void => {
  if (!existsSync(path)) {
    return
  }

  try {
    unlinkSync(path)
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

const clearSidecars = (databasePath: string): void => {
  safeUnlink(`${databasePath}-wal`)
  safeUnlink(`${databasePath}-shm`)
}

const assertQuickCheck = (database: Database.Database): void => {
  const rows = database.prepare('PRAGMA quick_check').all() as readonly { readonly quick_check?: string }[]
  const first = rows[0]?.quick_check?.toLowerCase() ?? 'ok'

  if (first !== 'ok') {
    throw new Error(`sqlite quick_check failed: ${first}`)
  }
}

const archiveCorruptedDatabase = (databasePath: string): void => {
  if (!existsSync(databasePath)) {
    return
  }

  const archivedPath = `${databasePath}.corrupt-${Date.now()}`
  renameSync(databasePath, archivedPath)
}

const restoreFromBackupOrReset = (databasePath: string, backupPath: string): void => {
  clearSidecars(databasePath)
  archiveCorruptedDatabase(databasePath)

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, databasePath)
    clearSidecars(databasePath)
    return
  }

  rmSync(databasePath, { force: true })
}

const openCheckedDatabase = (databasePath: string): Database.Database => {
  const database = new Database(databasePath)

  try {
    assertQuickCheck(database)
  } catch (error) {
    database.close()
    throw error
  }

  return database
}

export const createRecoverySnapshot = (database: Database.Database, backupPath: string): void => {
  const backupDirectory = dirname(backupPath)
  const tempBackupPath = `${backupPath}.tmp`
  mkdirSync(backupDirectory, { recursive: true })
  rmSync(tempBackupPath, { force: true })
  database.prepare('VACUUM INTO ?').run(tempBackupPath)
  renameSync(tempBackupPath, backupPath)
}

export const openDatabaseWithRecovery = (databasePath: string, backupPath: string): Database.Database => {
  mkdirSync(dirname(databasePath), { recursive: true })

  try {
    return openCheckedDatabase(databasePath)
  } catch (error) {
    if (!isSqliteCorruptionError(error)) {
      throw error
    }

    restoreFromBackupOrReset(databasePath, backupPath)

    return openCheckedDatabase(databasePath)
  }
}
