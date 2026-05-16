import Database from 'better-sqlite3'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecoverySnapshot, openDatabaseWithRecovery } from './recovery.js'

describe('sqlite recovery', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('restores from backup when primary database is corrupted', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-sqlite-recovery-'))
    tempPaths.push(workspace)
    const databasePath = join(workspace, 'brainlink.db')
    const backupPath = join(workspace, 'brainlink.db.backup')
    const setupDatabase = new Database(databasePath)

    try {
      setupDatabase.exec(`
        CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL);
        INSERT INTO notes (id, title) VALUES ('1', 'Architecture');
      `)
      createRecoverySnapshot(setupDatabase, backupPath)
    } finally {
      setupDatabase.close()
    }

    await writeFile(databasePath, Buffer.from('this is not sqlite'))

    const restored = openDatabaseWithRecovery(databasePath, backupPath)
    try {
      const row = restored.prepare('SELECT title FROM notes WHERE id = ?').get('1') as { readonly title: string } | undefined
      expect(row?.title).toBe('Architecture')
    } finally {
      restored.close()
    }

    const files = await readdir(workspace)
    expect(files.some((name) => name.startsWith('brainlink.db.corrupt-'))).toBe(true)
    expect(files).toContain('recovery-last-restore.json')
  })

  it('recreates a clean database when no backup exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-sqlite-recovery-nobackup-'))
    tempPaths.push(workspace)
    const databasePath = join(workspace, 'brainlink.db')
    const backupPath = join(workspace, 'brainlink.db.backup')

    await writeFile(databasePath, Buffer.from('broken'))

    const database = openDatabaseWithRecovery(databasePath, backupPath)
    try {
      const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as readonly { readonly name: string }[]
      expect(Array.isArray(rows)).toBe(true)
    } finally {
      database.close()
    }
  })

  it('restores from an older snapshot when latest backup is invalid', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'brainlink-sqlite-recovery-older-snapshot-'))
    tempPaths.push(workspace)
    const databasePath = join(workspace, 'brainlink.db')
    const backupPath = join(workspace, 'brainlink.db.backup')
    const setupDatabase = new Database(databasePath)

    try {
      setupDatabase.exec(`
        CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL);
        INSERT INTO notes (id, title) VALUES ('1', 'Architecture');
      `)
      createRecoverySnapshot(setupDatabase, backupPath)
    } finally {
      setupDatabase.close()
    }

    await writeFile(backupPath, Buffer.from('broken latest backup'))
    await writeFile(databasePath, Buffer.from('broken primary db'))

    const restored = openDatabaseWithRecovery(databasePath, backupPath)
    try {
      const row = restored.prepare('SELECT title FROM notes WHERE id = ?').get('1') as { readonly title: string } | undefined
      expect(row?.title).toBe('Architecture')
    } finally {
      restored.close()
    }
  })
})
