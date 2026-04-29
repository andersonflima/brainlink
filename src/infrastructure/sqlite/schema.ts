import Database from 'better-sqlite3'

const schemaVersion = 4
const requiredTableColumns: Readonly<Record<string, readonly string[]>> = {
  documents: ['id', 'agent_id', 'title', 'path', 'content', 'tags_json', 'frontmatter_json', 'created_at', 'updated_at'],
  chunks: ['id', 'document_id', 'ordinal', 'content', 'token_count', 'embedding_provider', 'embedding_json'],
  chunks_fts: ['chunk_id', 'document_id', 'agent_id', 'title', 'content']
}

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
    DROP TABLE IF EXISTS embedding_buckets;
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS links;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS documents;
  `)
}

const getTableColumns = (database: Database.Database, tableName: string): readonly string[] => {
  const rows = database.prepare(`SELECT name FROM pragma_table_info(?)`).all(tableName) as readonly { readonly name: string }[]

  return rows.map((row) => row.name)
}

const hasCompatibleSchemaShape = (database: Database.Database): boolean =>
  Object.entries(requiredTableColumns).every(([tableName, requiredColumns]) => {
    const columns = getTableColumns(database, tableName)

    return columns.length === 0 || requiredColumns.every((column) => columns.includes(column))
  })

export const createSchema = (database: Database.Database): void => {
  const storedSchemaVersion = getStoredSchemaVersion(database)

  if ((storedSchemaVersion > 0 && storedSchemaVersion < schemaVersion) || !hasCompatibleSchemaShape(database)) {
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

    CREATE TABLE IF NOT EXISTS embedding_buckets (
      bucket TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      PRIMARY KEY (bucket, chunk_id),
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_buckets_bucket ON embedding_buckets(bucket);

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
