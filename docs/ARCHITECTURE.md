# Architecture

Brainlink follows a small clean architecture boundary.

```txt
CLI -> application use cases -> domain functions -> infrastructure adapters
```

The core rule is simple:

Domain code must not know about the CLI, filesystem, or SQLite.

## Modules

```txt
src/
  application/
    frontend/
      client-css.ts
      client-html.ts
      client-js.ts
    server/
      routes.ts
      http.ts
    add-note.ts
    build-context.ts
    get-graph.ts
    index-vault.ts
    list-agents.ts
    list-links.ts
    search-knowledge.ts
    start-server.ts
    watch-vault.ts

  cli/
    commands/
      agent-commands.ts
      config-commands.ts
      read-commands.ts
      write-commands.ts
    main.ts
    runtime.ts

  domain/
    agents.ts
    context.ts
    graph-analysis.ts
    graph-layout.ts
    embeddings.ts
    ids.ts
    markdown.ts
    tokens.ts
    types.ts

  infrastructure/
    sqlite/
      document-writer.ts
      graph-reader.ts
      schema.ts
      search-reader.ts
    file-system-vault.ts
    session-state.ts
    sqlite-index.ts

  mcp/
    main.ts
    server.ts
    tools.ts
```

## Domain

The domain layer contains pure knowledge rules:

- parse Markdown documents
- resolve agent namespaces from frontmatter or `agents/<agent-id>/...`
- extract frontmatter
- extract note titles
- extract `[[wiki links]]`
- extract `#tags`
- split documents into chunks
- create deterministic local embeddings
- create deterministic embedding buckets for semantic candidate retrieval
- calculate cosine similarity
- estimate token counts
- select context sections
- format context packages

Important files:

- `src/domain/markdown.ts`
- `src/domain/context.ts`
- `src/domain/embeddings.ts`
- `src/domain/types.ts`

## Application

The application layer coordinates use cases:

- add a note
- index a vault
- search knowledge
- build context
- list links
- list backlinks
- start HTTP graph/API server
- watch vault changes

Application code depends on domain rules and infrastructure interfaces.

## Infrastructure

The infrastructure layer handles side effects:

- reading Markdown files from disk
- mirroring S3-compatible bucket Markdown into a local cache
- writing Markdown notes
- creating `.brainlink`
- writing and querying SQLite
- running FTS, semantic and hybrid retrieval
- narrowing semantic candidates through SQLite embedding buckets before cosine scoring

SQLite is an index, not the canonical storage model. For bucket vaults, Markdown
objects in the bucket remain canonical and SQLite is still local derived data.

## Indexing Flow

```txt
read markdown files
  -> parse documents
  -> build agent-scoped title maps
  -> resolve links
  -> split chunks
  -> create chunk embeddings
  -> reset SQLite index
  -> persist documents, chunks and links
  -> populate FTS records
  -> persist embedding vectors
  -> persist embedding buckets
```

## Retrieval Flow

```txt
question
  -> selected mode: fts | semantic | hybrid
  -> optional query embedding
  -> FTS query and/or embedding bucket candidate lookup
  -> cosine similarity over candidate chunks
  -> ranked chunks with textScore and semanticScore
  -> token-budget selection
  -> Markdown context package
```

## Graph Server Flow

```txt
server command
  -> optional index rebuild
  -> HTTP server
  -> /api/agents lists indexed namespaces
  -> /api/graph reads indexed documents and links
  -> browser renders graph canvas
```

The graph UI is intentionally read-only. Markdown remains the write interface and SQLite remains a derived index.

## HTTP API Flow

```txt
HTTP request
  -> route handler
  -> application use case
  -> filesystem and SQLite adapters
  -> JSON response
```

The HTTP API is local-first and unauthenticated. It is meant for local agents, browser UI, and development workflows.

## MCP Flow

Brainlink includes a stdio MCP server for agent integrations.

```txt
MCP client
  -> brainlink-mcp
  -> application use case
  -> MCP tool result
```

The MCP adapter stays thin. It validates tool inputs, resolves the configured vault and calls the same application use cases used by the CLI.
At server startup, Brainlink runs a bootstrap pass on the configured default vault/agent, then keeps enforcing bootstrap policy on read tools.
For MCP agents, non-context read tools also enforce context-first by default, requiring a recent `brainlink_context` call before additional reads.
When `mode`/`limit`/`tokens` are omitted, MCP read tools resolve per-agent defaults from `agentProfiles` and then fallback to global config defaults.
Session state is persisted in `$BRAINLINK_HOME/session-state.json` with independent bootstrap/context freshness per vault/agent so read tools can enforce bootstrap and context-first policies with optional automation.

## Link Resolution

Links are extracted from Markdown using wiki-link syntax:

```md
[[Architecture]]
[[Architecture#Runtime]]
[[Architecture|System design]]
```

Resolution is title-based, case-insensitive and scoped by agent namespace.

When indexing a document, Brainlink resolves a link in this order:

1. matching title inside the same `agentId`
2. matching title inside `shared`
3. unresolved link

The current title resolution priority is:

1. `title` frontmatter
2. first Markdown `# Heading`
3. file name without `.md`

## Backlinks

Backlinks are not stored as separate Markdown files.

They are derived from indexed links:

```txt
source note -> target note
```

The `backlinks` command queries indexed links pointing to a target title. With `--agent`, it only returns links from that namespace.

## Weighted Links

Each indexed wiki link is stored as a graph edge with:

- `weight`: numeric relationship strength.
- `priority`: one of `low`, `normal`, `high` or `critical`.

The parser derives weight from repeated links, task-list context, heading context and priority markers on the same line as a wiki link. Examples:

```md
Related: [[Architecture]]
- [ ] Review [[Architecture]] priority: high
Escalate [[Incident Runbook]] #critical
```

Backlink and graph readers return those fields to CLI JSON, HTTP API and MCP clients. Backlink queries use the normalized `to_title_key` column instead of applying `lower(...)` at read time.

## Context Building

`context` uses search results and selects one chunk per document while staying inside an estimated token budget.

The output format is Markdown because it is easy for agents and models to consume:

```md
# Brainlink Context
Query: question

## 1. Note Title
Source: note.md
Tags: #tag
Score: 0.000
Mode: hybrid

Relevant content
```

## Persistence Model

Permanent:

- Markdown files
- S3-compatible Markdown objects when the vault is `s3://bucket/prefix`
- optional Git history around the vault

Canonical agent memory lives under:

```txt
vault/agents/<agent-id>/**/*.md
```

Rebuildable:

- `.brainlink/brainlink.db`
- `$BRAINLINK_HOME/bucket-cache`
- FTS records
- local embedding vectors
- local embedding bucket index
- chunks
- resolved links

## Design Decisions

### Markdown As Source Of Truth

Markdown keeps the system portable, inspectable, Git-friendly, and compatible with Obsidian-like workflows.

### SQLite As Local Index

SQLite gives fast local search, local vector storage and rebuildable retrieval without forcing users to run external infrastructure.
Hybrid retrieval also uses a short-lived in-memory cache keyed by vault/query/agent and invalidated by index file mtime to reduce repeated query latency.
Brainlink also writes a local rollback snapshot (`.brainlink/brainlink.db.backup`) after successful indexing. On corruption detection (`quick_check`/SQLite malformed errors), Brainlink restores from snapshot automatically before reopening the index.
Indexing additionally exports private encrypted pack files (`.brainlink/search-packs/*.blpk`) from indexed chunks. Search falls back to these packs when SQLite is unavailable, preserving retrieval continuity in degraded mode.
Pack encryption keys are resolved from `$BRAINLINK_HOME/keys` or from `BRAINLINK_SEARCH_PACK_KEY` when configured.

### CLI First

The CLI is the smallest useful integration surface for agents. HTTP is a local inspection adapter, and Brainlink also ships a built-in MCP server (`brainlink-mcp`) that uses the same application use cases.

### Functional Core

Parsing, transformation, selection, and formatting are implemented as pure functions where practical. Side effects stay at the edges.

## Future Architecture

Useful next boundaries:

- remote embedding providers
- dedicated vector adapter
- `graph-exporter`
