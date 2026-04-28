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
    add-note.ts
    build-context.ts
    get-graph.ts
    index-vault.ts
    list-agents.ts
    list-links.ts
    search-knowledge.ts
    start-mcp-server.ts
    start-server.ts
    watch-vault.ts

  cli/
    main.ts

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
    file-system-vault.ts
    sqlite-index.ts
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
- start MCP stdio server
- watch vault changes

Application code depends on domain rules and infrastructure interfaces.

## Infrastructure

The infrastructure layer handles side effects:

- reading Markdown files from disk
- writing Markdown notes
- creating `.brainlink`
- writing and querying SQLite
- running FTS, semantic and hybrid retrieval

SQLite is an index, not the canonical storage model.

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
```

## Retrieval Flow

```txt
question
  -> selected mode: fts | semantic | hybrid
  -> optional query embedding
  -> FTS query and/or cosine similarity
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

```txt
MCP client
  -> stdio transport
  -> Brainlink MCP tools
  -> application use cases
  -> JSON text response
```

MCP tools intentionally reuse the same application use cases as the CLI and HTTP server.

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
- optional Git history around the vault

Canonical agent memory lives under:

```txt
vault/agents/<agent-id>/**/*.md
```

Rebuildable:

- `.brainlink/brainlink.db`
- FTS records
- local embedding vectors
- chunks
- resolved links

## Design Decisions

### Markdown As Source Of Truth

Markdown keeps the system portable, inspectable, Git-friendly, and compatible with Obsidian-like workflows.

### SQLite As Local Index

SQLite gives fast local search, local vector storage and rebuildable retrieval without forcing users to run external infrastructure.

### CLI First

The CLI is the smallest useful integration surface for agents. MCP and HTTP are adapters around the same application use cases.

### Functional Core

Parsing, transformation, selection, and formatting are implemented as pure functions where practical. Side effects stay at the edges.

## Future Architecture

Useful next boundaries:

- remote embedding providers
- dedicated vector adapter
- `graph-exporter`
