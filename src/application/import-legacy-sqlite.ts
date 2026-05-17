import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { extractTags, extractWikiLinks } from '../domain/markdown.js'
import { sanitizeAgentId, sharedAgentId } from '../domain/agents.js'
import { ensureVault, listVaultFiles, writeMarkdownFile } from '../infrastructure/file-system-vault.js'
import { getBrainlinkHomePath } from '../infrastructure/paths.js'

const execFileAsync = promisify(execFile)
const fieldSeparator = '\u001f'
const rowSeparator = '\u001e'
const contentColumnCandidates = ['content', 'markdown', 'body', 'text', 'note']
const titleColumnCandidates = ['title', 'note_title', 'name', 'headline']
const pathColumnCandidates = ['path', 'file_path', 'filepath', 'source_path', 'source']
const agentColumnCandidates = ['agent', 'agent_id', 'namespace', 'scope']
const tagColumnCandidates = ['tags', 'tag_list', 'keywords']
const createdColumnCandidates = ['created_at', 'createdat', 'created', 'ctime']
const updatedColumnCandidates = ['updated_at', 'updatedat', 'updated', 'mtime']
const systemHubTitle = 'Memory Hub'
const systemRootTitle = 'Knowledge Root'

export type LegacyDbImportOptions = {
  readonly dbPath?: string
  readonly table?: string
  readonly agentOverride?: string
  readonly limit?: number
  readonly dryRun?: boolean
}

export type LegacyDbImportResult = {
  readonly vault: string
  readonly dbPath: string
  readonly table: string
  readonly detectedTables: readonly string[]
  readonly rowsRead: number
  readonly imported: number
  readonly skipped: number
  readonly createdSystemNotes: number
  readonly dryRun: boolean
  readonly importedFiles: readonly string[]
}

type LegacyTableMapping = {
  readonly table: string
  readonly columns: readonly string[]
  readonly titleColumn: string | null
  readonly contentColumn: string | null
  readonly pathColumn: string | null
  readonly agentColumn: string | null
  readonly tagsColumn: string | null
  readonly createdColumn: string | null
  readonly updatedColumn: string | null
  readonly score: number
}

type LegacyRow = {
  readonly title: string
  readonly content: string
  readonly path: string
  readonly agent: string
  readonly tags: readonly string[]
}

const normalizeTitle = (title: string): string =>
  title.trim().replace(/\.md$/i, '').toLowerCase()

const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`

const pickColumn = (columns: readonly string[], candidates: readonly string[]): string | null => {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]))

  return candidates.map((candidate) => byLower.get(candidate)).find((column): column is string => Boolean(column)) ?? null
}

const parseDelimitedRows = (rawOutput: string): readonly (readonly string[])[] => {
  const normalized = rawOutput.trim()

  if (normalized.length === 0) {
    return []
  }

  return normalized
    .split(rowSeparator)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(fieldSeparator))
}

const runSqliteQuery = async (databasePath: string, sql: string): Promise<readonly (readonly string[])[]> => {
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-readonly', '-noheader', '-separator', fieldSeparator, '-newline', rowSeparator, databasePath, sql],
      { maxBuffer: 1024 * 1024 * 64 }
    )

    return parseDelimitedRows(stdout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    if (lower.includes('enoent') || lower.includes('not found')) {
      throw new Error('sqlite3 CLI was not found. Install sqlite3 to use db-import.')
    }

    throw new Error(`Unable to read SQLite database: ${message}`)
  }
}

const detectLegacyDbPath = async (vaultPath: string, explicitPath?: string): Promise<string> => {
  if (explicitPath) {
    return resolve(explicitPath)
  }

  const vaultRoot = await ensureVault(vaultPath)
  const candidates = [
    join(vaultRoot, '.brainlink', 'brainlink.db'),
    join(vaultRoot, '.brainlink', 'index.db'),
    join(getBrainlinkHomePath(), 'brainlink.db'),
    join(getBrainlinkHomePath(), 'vault', '.brainlink', 'brainlink.db')
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }

  throw new Error(
    `No legacy SQLite database found. Checked: ${candidates.join(', ')}. Use --db <path-to-db> to import explicitly.`
  )
}

const listTables = async (dbPath: string): Promise<readonly string[]> => {
  const rows = await runSqliteQuery(
    dbPath,
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`
  )

  return rows.map((columns) => columns[0]).filter(Boolean)
}

const listColumns = async (dbPath: string, table: string): Promise<readonly string[]> => {
  const rows = await runSqliteQuery(dbPath, `PRAGMA table_info(${quoteIdentifier(table)})`)

  return rows.map((columns) => columns[1]).filter(Boolean)
}

const tableScore = (columns: readonly string[]): number => {
  const contentColumn = pickColumn(columns, contentColumnCandidates)
  const titleColumn = pickColumn(columns, titleColumnCandidates)
  const pathColumn = pickColumn(columns, pathColumnCandidates)
  const agentColumn = pickColumn(columns, agentColumnCandidates)

  return (contentColumn ? 6 : 0) + (titleColumn ? 4 : 0) + (pathColumn ? 2 : 0) + (agentColumn ? 1 : 0)
}

const detectTableMapping = async (
  dbPath: string,
  tableOverride?: string
): Promise<{ readonly mapping: LegacyTableMapping; readonly detectedTables: readonly string[] }> => {
  const tables = await listTables(dbPath)

  if (tables.length === 0) {
    throw new Error('Legacy SQLite database has no readable tables.')
  }

  const mappings = await Promise.all(
    tables.map(async (table) => {
      const columns = await listColumns(dbPath, table)

      return {
        table,
        columns,
        titleColumn: pickColumn(columns, titleColumnCandidates),
        contentColumn: pickColumn(columns, contentColumnCandidates),
        pathColumn: pickColumn(columns, pathColumnCandidates),
        agentColumn: pickColumn(columns, agentColumnCandidates),
        tagsColumn: pickColumn(columns, tagColumnCandidates),
        createdColumn: pickColumn(columns, createdColumnCandidates),
        updatedColumn: pickColumn(columns, updatedColumnCandidates),
        score: tableScore(columns)
      } satisfies LegacyTableMapping
    })
  )

  if (tableOverride) {
    const overridden = mappings.find((mapping) => mapping.table === tableOverride)

    if (!overridden) {
      throw new Error(`Table not found in SQLite database: ${tableOverride}`)
    }

    if (!overridden.contentColumn) {
      throw new Error(`Table ${tableOverride} does not expose a readable content column.`)
    }

    return { mapping: overridden, detectedTables: tables }
  }

  const selected = [...mappings]
    .filter((mapping) => mapping.contentColumn)
    .sort((left, right) => right.score - left.score)[0]

  if (!selected) {
    throw new Error('Could not detect a legacy table with content column in SQLite database.')
  }

  return { mapping: selected, detectedTables: tables }
}

const hexExpression = (column: string | null): string =>
  column ? `hex(COALESCE(CAST(${quoteIdentifier(column)} AS BLOB), X''))` : `hex(X'')`

const decodeHexUtf8 = (value: string | undefined): string =>
  value ? Buffer.from(value, 'hex').toString('utf8') : ''

const parseLegacyTags = (value: string): readonly string[] =>
  Array.from(
    new Set(
      value
        .split(/[\s,;|]+/)
        .map((item) => item.trim().replace(/^#/, '').toLowerCase())
        .filter((item) => /^[a-z0-9][a-z0-9_-]*$/i.test(item))
    )
  )

const titleFromPath = (pathValue: string): string =>
  basename(pathValue).replace(extname(pathValue), '').replace(/[-_]+/g, ' ').trim()

const appendMissingTags = (content: string, tags: readonly string[]): string => {
  if (tags.length === 0) {
    return content
  }

  const existingTags = new Set(extractTags(content).map((tag) => tag.toLowerCase()))
  const missing = tags.filter((tag) => !existingTags.has(tag.toLowerCase()))

  if (missing.length === 0) {
    return content
  }

  return `${content.trim()}\n\nTags: ${missing.map((tag) => `#${tag}`).join(' ')}`
}

const buildNote = (title: string, content: string, agentId: string): string =>
  [
    '---',
    `title: "${title.replaceAll('"', '\\"')}"`,
    `agent: "${agentId}"`,
    '---',
    '',
    `# ${title}`,
    '',
    content.trim(),
    ''
  ].join('\n')

const parseLegacyRow = (columns: readonly string[], rowIndex: number): LegacyRow => {
  const [titleHex, contentHex, pathHex, agentHex, tagsHex] = columns
  const content = decodeHexUtf8(contentHex).trim()
  const path = decodeHexUtf8(pathHex).trim()
  const titleCandidate = decodeHexUtf8(titleHex).trim()
  const fallbackTitleFromPath = path ? titleFromPath(path) : ''
  const title = titleCandidate || fallbackTitleFromPath || `Imported Memory ${rowIndex + 1}`

  return {
    title,
    content,
    path,
    agent: decodeHexUtf8(agentHex).trim(),
    tags: parseLegacyTags(decodeHexUtf8(tagsHex))
  }
}

const noteRelativePath = (agentId: string, slug: string, suffix = 0): string =>
  `agents/${agentId}/${suffix > 0 ? `${slug}-${suffix + 1}` : slug || 'untitled'}.md`

const reserveUniquePath = (agentId: string, title: string, reserved: Set<string>): string => {
  const slug = slugify(title)

  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const relativePath = noteRelativePath(agentId, slug, suffix)

    if (!reserved.has(relativePath)) {
      reserved.add(relativePath)
      return relativePath
    }
  }

  throw new Error(`Could not allocate unique path for imported note: ${title}`)
}

const ensureSystemNote = async (
  vaultPath: string,
  reserved: Set<string>,
  created: Set<string>,
  agentId: string,
  title: string,
  content: string,
  dryRun: boolean
): Promise<void> => {
  const filename = noteRelativePath(agentId, slugify(title))

  if (reserved.has(filename)) {
    return
  }

  reserved.add(filename)
  created.add(filename)

  if (dryRun) {
    return
  }

  await writeMarkdownFile(vaultPath, filename, buildNote(title, content, agentId))
}

const applyConnectivityRule = async (
  vaultPath: string,
  reserved: Set<string>,
  created: Set<string>,
  title: string,
  content: string,
  agentId: string,
  dryRun: boolean
): Promise<string> => {
  const links = extractWikiLinks(content).filter((link) => normalizeTitle(link) !== normalizeTitle(title))

  if (links.length > 0) {
    return content.trim()
  }

  const normalized = normalizeTitle(title)

  if (normalized === normalizeTitle(systemHubTitle)) {
    await ensureSystemNote(
      vaultPath,
      reserved,
      created,
      agentId,
      systemRootTitle,
      `Entry point for agent memory. [[${systemHubTitle}]] #memory #root`,
      dryRun
    )
    return `${content.trim()}\n\nRelated: [[${systemRootTitle}]]`
  }

  await ensureSystemNote(
    vaultPath,
    reserved,
    created,
    agentId,
    systemHubTitle,
    'Central memory index for this agent namespace. #memory #hub',
    dryRun
  )

  return `${content.trim()}\n\nRelated: [[${systemHubTitle}]]`
}

const importRowsFromMapping = async (
  vaultPath: string,
  dbPath: string,
  mapping: LegacyTableMapping,
  options: LegacyDbImportOptions,
  reserved: Set<string>
): Promise<{
  readonly rowsRead: number
  readonly imported: number
  readonly skipped: number
  readonly createdSystemNotes: number
  readonly importedFiles: readonly string[]
}> => {
  const limit = Number.isFinite(options.limit) && (options.limit ?? 0) > 0 ? Math.floor(options.limit ?? 0) : undefined
  const sql = [
    'SELECT',
    `${hexExpression(mapping.titleColumn)} AS title_hex,`,
    `${hexExpression(mapping.contentColumn)} AS content_hex,`,
    `${hexExpression(mapping.pathColumn)} AS path_hex,`,
    `${hexExpression(mapping.agentColumn)} AS agent_hex,`,
    `${hexExpression(mapping.tagsColumn)} AS tags_hex,`,
    `${hexExpression(mapping.createdColumn)} AS created_hex,`,
    `${hexExpression(mapping.updatedColumn)} AS updated_hex`,
    `FROM ${quoteIdentifier(mapping.table)}`,
    ...(limit ? [`LIMIT ${limit}`] : [])
  ].join(' ')

  const rows = await runSqliteQuery(dbPath, sql)
  const createdSystemNotes = new Set<string>()
  const importedFiles: string[] = []
  let imported = 0
  let skipped = 0

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = parseLegacyRow(rows[rowIndex], rowIndex)

    if (!row.content) {
      skipped += 1
      continue
    }

    const agentId = sanitizeAgentId(options.agentOverride || row.agent || sharedAgentId)
    const filename = reserveUniquePath(agentId, row.title, reserved)
    const mergedContent = appendMissingTags(row.content, row.tags)
    const connectedContent = await applyConnectivityRule(
      vaultPath,
      reserved,
      createdSystemNotes,
      row.title,
      mergedContent,
      agentId,
      options.dryRun === true
    )
    const note = buildNote(row.title, connectedContent, agentId)

    if (options.dryRun !== true) {
      await writeMarkdownFile(vaultPath, filename, note)
    }

    importedFiles.push(filename)
    imported += 1
  }

  return {
    rowsRead: rows.length,
    imported,
    skipped,
    createdSystemNotes: createdSystemNotes.size,
    importedFiles
  }
}

export const importLegacySqliteDatabase = async (
  vaultPath: string,
  options: LegacyDbImportOptions = {}
): Promise<LegacyDbImportResult> => {
  const vault = await ensureVault(vaultPath)
  const dbPath = await detectLegacyDbPath(vaultPath, options.dbPath)
  const { mapping, detectedTables } = await detectTableMapping(dbPath, options.table)
  const existingFiles = (await listVaultFiles(vaultPath))
    .filter((path) => extname(path).toLowerCase() === '.md')
    .map((path) => relative(vault, path))
  const reserved = new Set(existingFiles)
  const imported = await importRowsFromMapping(vaultPath, dbPath, mapping, options, reserved)

  return {
    vault,
    dbPath,
    table: mapping.table,
    detectedTables,
    rowsRead: imported.rowsRead,
    imported: imported.imported,
    skipped: imported.skipped,
    createdSystemNotes: imported.createdSystemNotes,
    dryRun: options.dryRun === true,
    importedFiles: imported.importedFiles
  }
}
