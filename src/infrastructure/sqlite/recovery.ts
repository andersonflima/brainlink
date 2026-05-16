import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const sqliteCorruptionHints = [
  'database disk image is malformed',
  'file is not a database',
  'database is corrupted',
  'malformed database schema',
  'sqlite quick_check failed'
]
const maxSnapshotFiles = 24

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

const snapshotDirectoryPath = (backupPath: string): string =>
  join(dirname(backupPath), `${basename(backupPath)}.snapshots`)

const snapshotFileName = (): string =>
  `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`

const cleanupSnapshotOverflow = (backupPath: string): void => {
  const directory = snapshotDirectoryPath(backupPath)
  if (!existsSync(directory)) {
    return
  }

  const snapshots = readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .sort((left, right) => right.localeCompare(left))

  snapshots.slice(maxSnapshotFiles).forEach((name) => {
    rmSync(join(directory, name), { force: true })
  })
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

const isValidDatabaseSnapshot = (path: string): boolean => {
  if (!existsSync(path)) {
    return false
  }

  try {
    const size = statSync(path).size
    if (size <= 0) {
      return false
    }
  } catch {
    return false
  }

  try {
    const database = new Database(path)
    try {
      assertQuickCheck(database)
      return true
    } finally {
      database.close()
    }
  } catch {
    return false
  }
}

const candidateBackupFiles = (backupPath: string): readonly string[] => {
  const directory = snapshotDirectoryPath(backupPath)
  const snapshots = existsSync(directory)
    ? readdirSync(directory)
      .filter((name) => name.endsWith('.db'))
      .sort((left, right) => right.localeCompare(left))
      .map((name) => join(directory, name))
    : []

  return [backupPath, ...snapshots]
}

const ensureSnapshotDirectory = (backupPath: string): void => {
  mkdirSync(snapshotDirectoryPath(backupPath), { recursive: true, mode: 0o700 })
}

const writeRecoveryMarker = (backupPath: string, restoredFrom: string): void => {
  const markerPath = join(dirname(backupPath), 'recovery-last-restore.json')
  const payload = {
    restoredAt: new Date().toISOString(),
    restoredFrom
  }

  writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

const restoreFromBackupOrReset = (databasePath: string, backupPath: string): void => {
  clearSidecars(databasePath)
  archiveCorruptedDatabase(databasePath)

  for (const candidate of candidateBackupFiles(backupPath)) {
    if (!isValidDatabaseSnapshot(candidate)) {
      continue
    }

    copyFileSync(candidate, databasePath)
    clearSidecars(databasePath)

    if (isValidDatabaseSnapshot(databasePath)) {
      writeRecoveryMarker(backupPath, candidate)
      return
    }
  }

  rmSync(databasePath, { force: true })
}

export const createRecoverySnapshot = (database: Database.Database, backupPath: string): void => {
  const backupDirectory = dirname(backupPath)
  const tempBackupPath = `${backupPath}.tmp`
  const snapshotDirectory = snapshotDirectoryPath(backupPath)
  const snapshotPath = join(snapshotDirectory, snapshotFileName())
  mkdirSync(backupDirectory, { recursive: true })
  ensureSnapshotDirectory(backupPath)
  rmSync(tempBackupPath, { force: true })
  try {
    database.pragma('wal_checkpoint(PASSIVE)')
  } catch {
    // Checkpoint is best-effort.
  }
  database.prepare('VACUUM INTO ?').run(tempBackupPath)
  renameSync(tempBackupPath, backupPath)
  copyFileSync(backupPath, snapshotPath)
  cleanupSnapshotOverflow(backupPath)
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
