import Database from 'better-sqlite3'

const schemaVersion = 3

const getStoredSchemaVersion = (database: Database.Database): number => {
  const hasMetadata = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'")
    .get() as { readonly name: string } | undefined

  if (!hasMetadata) {
    return 0
  }

  const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
    | { readonly value: string }
    | undefined

  return Number.parseInt(row?.value ?? '0', 10)
}

const dropDerivedSchema = (database: Database.Database): void => {
  database.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS links;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS documents;
  `)
}

export const createSchema = (database: Database.Database): void => {
  const storedSchemaVersion = getStoredSchemaVersion(database)

  if (storedSchemaVersion > 0 && storedSchemaVersion < schemaVersion) {
    dropDerivedSchema(database)
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding_provider TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS links (
      from_document_id TEXT NOT NULL,
      to_title TEXT NOT NULL,
      to_document_id TEXT,
      FOREIGN KEY (from_document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (to_document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      document_id UNINDEXED,
      agent_id UNINDEXED,
      title,
      content
    );
  `)

  database
    .prepare(
      `
      INSERT INTO metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
    )
    .run(String(schemaVersion))
}
