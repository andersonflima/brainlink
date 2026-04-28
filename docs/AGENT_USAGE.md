# Agent Usage

Brainlink is designed to be used by agents as an external memory and retrieval layer.

It is not a replacement for the model context window. It is a way to retrieve the most relevant historical knowledge before the model answers.

## Mental Model

```txt
Markdown vault       durable knowledge
Brainlink index      rebuildable retrieval cache
context command      compact memory package for agents
```

The correct dependency direction is:

```txt
agent -> Brainlink CLI -> Markdown vault + derived index
```

Agents should never depend on the internal SQLite schema as a public API.

The installed CLI exposes two equivalent binaries:

```bash
brainlink --help
blink --help
```

Use `blink` as the short terminal alias and `brainlink` in documentation when explicit naming is more important.

## Agent Namespaces

Each agent writes into a dedicated namespace under `agents/<agent-id>/`:

```txt
vault/
  agents/
    shared/
      project-decisions.md
    coding-agent/
      implementation-policy.md
    research-agent/
      source-review-policy.md
```

Rules:

- Use `shared` only for knowledge that should be visible to every workflow.
- Use a stable `--agent <agent-id>` for private agent memory.
- Do not write one agent's private context into another agent's folder.
- `[[links]]` resolve first inside the current agent namespace, then in `shared`.
- Run `agents` to inspect available namespaces.

## When To Use Brainlink

Use Brainlink when a task needs memory about:

- prior decisions
- project conventions
- architecture notes
- long-running conversations
- operational runbooks
- user preferences
- domain concepts
- implementation rationale

Do not use Brainlink as a dumping ground for every transient message. Store durable knowledge only.

## Write Policy

Good memory is curated.

Before adding a note, an agent should ask:

- Is this knowledge likely to be useful later?
- Does it have a clear title?
- Can it be linked to an existing concept?
- Does it need tags?
- Is it a fact, decision, preference, runbook, or open question?

Recommended note categories:

- `Decision`
- `Architecture`
- `Runbook`
- `Concept`
- `Preference`
- `Conversation Summary`
- `Open Question`

## Note Format

Preferred note:

```md
---
title: "Auth Decision"
type: "Decision"
---

# Auth Decision

We chose JWT for API clients.

Reason:

- Stateless API authentication.
- Simple integration with external clients.
- Existing infrastructure supports token validation.

Related:

- [[Architecture]]
- [[API Gateway]]

#auth #jwt #decision
```

Rules:

- Use a clear title.
- Use `[[Note Title]]` for relationships.
- Use tags for retrieval.
- Keep each note focused.
- Prefer summaries over raw transcripts.
- Preserve dates when the timing matters.

## Read Policy

Before answering a memory-dependent question, run:

```bash
blink context "<question>" --vault ./vault --agent coding-agent
```

Use the returned context as source-grounded memory.

For machine-readable output, use:

```bash
blink context "<question>" --vault ./vault --agent coding-agent --json
```

If the context is empty or weak:

1. Try a more explicit search query.
2. Run `search` to inspect raw matches.
3. Inspect links and backlinks.
4. Only then answer from general reasoning.

## Command Reference

### Initialize A Vault

```bash
blink init ./vault
```

Creates:

```txt
vault/
  .brainlink/
```

### Add A Note

```bash
blink add "Note Title" --vault ./vault --content "Markdown content"
```

This creates a slugged Markdown file with frontmatter and a heading.

The CLI blocks common secret patterns by default. Do not use `--allow-sensitive` unless the vault is intentionally protected.

For agent-private memory:

```bash
blink add "Implementation Policy" \
  --vault ./vault \
  --agent coding-agent \
  --content "Prefer functional TypeScript modules. [[Architecture]] #typescript"
```

This writes to:

```txt
vault/agents/coding-agent/implementation-policy.md
```

### Rebuild The Index

```bash
blink index --vault ./vault
```

This scans Markdown files and rebuilds:

- documents
- chunks
- links
- full-text search records

### Search Knowledge

```bash
blink search "jwt auth" --vault ./vault --limit 10
blink search "jwt auth" --vault ./vault --json
blink search "jwt auth" --vault ./vault --agent coding-agent --json
blink search "authentication token policy" --vault ./vault --mode semantic --json
```

This returns matching chunks with title, source path, score, `textScore`, `semanticScore`, `searchMode`, and content.

Search modes:

- `hybrid`: default; combines SQLite FTS and local embedding similarity.
- `fts`: lexical SQLite full-text search only.
- `semantic`: local deterministic embedding similarity only.

### Build Agent Context

```bash
blink context "how does authentication work?" --vault ./vault --limit 12 --tokens 2000
blink context "how does authentication work?" --vault ./vault --json
blink context "how does authentication work?" --vault ./vault --agent coding-agent --json
blink context "how does authentication work?" --vault ./vault --agent coding-agent --mode hybrid --json
```

This returns a Markdown context package optimized for prompt injection.

### Inspect Links

```bash
blink links --vault ./vault
blink links --vault ./vault --agent coding-agent
```

Example output:

```txt
Auth Decision (auth-decision.md) -> Architecture (architecture.md)
```

### Inspect Backlinks

```bash
blink backlinks "Architecture" --vault ./vault
blink backlinks "Architecture" --vault ./vault --agent coding-agent
```

Example output:

```txt
Auth Decision (auth-decision.md) -> Architecture
```

### List Agents

```bash
blink agents --vault ./vault
blink agents --vault ./vault --json
```

Example output:

```txt
coding-agent: 12 documents
research-agent: 7 documents
shared: 30 documents
```

### Start Graph UI

```bash
blink server --vault ./vault --host 127.0.0.1 --port 4321
```

This starts a local frontend for inspecting the knowledge graph.

The frontend includes an agent selector. Selecting an agent calls the same read APIs with `agent=<agent-id>` and renders that namespace instead of merging every agent into one graph.

The command reindexes by default, then serves:

```txt
http://127.0.0.1:4321/
http://127.0.0.1:4321/api/graph
http://127.0.0.1:4321/api/graph?agent=coding-agent
http://127.0.0.1:4321/api/agents
```

Use `--no-index` when you need to inspect the current index without rebuilding it:

```bash
blink server --vault ./vault --no-index
```

Use `--watch` to keep the graph updated after Markdown edits:

```bash
blink server --vault ./vault --watch
```

### Watch A Vault

```bash
blink watch --vault ./vault
```

This process watches Markdown files and rebuilds the index after changes.

### Use From An External MCP Server

Brainlink does not ship an MCP server. An MCP server can use Brainlink by executing the CLI and parsing `--json`.

Recommended wrapper mapping:

- `brainlink_context`: run `blink context "<query>" --vault <vault> --agent <agent> --mode hybrid --json`.
- `brainlink_search`: run `blink search "<query>" --vault <vault> --agent <agent> --mode hybrid --json`.
- `brainlink_add_note`: run `blink add "<title>" --vault <vault> --agent <agent> --content "<content>" --json`, then `blink index`.
- `brainlink_graph`: run `blink graph --vault <vault> --agent <agent> --json`.
- `brainlink_validate`: run `blink validate --vault <vault> --agent <agent> --json`.

External wrappers should set `BRAINLINK_ALLOWED_VAULTS` before invoking the CLI:

```bash
export BRAINLINK_ALLOWED_VAULTS="/absolute/path/to/project-vault"
```

### HTTP API

```txt
GET  /api/graph
GET  /api/graph-layout
GET  /api/search?q=<query>&limit=10&mode=hybrid
GET  /api/context?q=<query>&limit=12&tokens=2000&mode=hybrid
GET  /api/links
GET  /api/backlinks?title=<title>
GET  /api/stats
GET  /api/broken-links
GET  /api/orphans
GET  /api/validate
```

The HTTP API is read-only. Use the CLI for writes and indexing.

## Agent Integration Contract

Input:

- A Markdown vault path.
- A user question or task.
- Optional limits for result count and token budget.

Processing:

1. Ensure the vault has been indexed.
2. Search relevant chunks.
3. Select context sections within token budget.
4. Return Markdown with sources.

Output:

- Markdown context package.
- Each section includes title, source path, tags, score, and content.

Agents should include source paths in their reasoning or final answer when the user needs traceability.

## Operational Rules

- Re-run `index` after modifying notes.
- Treat `.brainlink/brainlink.db` as disposable.
- Commit Markdown notes, not local database files.
- Do not manually edit the database.
- Keep generated context short enough for the target model.
- Prefer specific queries over broad queries.

## Failure Modes

Empty context usually means:

- The vault was not indexed.
- The query terms do not match existing notes.
- The notes are missing useful tags.
- The knowledge was never written into the vault.

Unresolved links usually mean:

- A note title does not match the link text.
- The target note does not exist yet.
- The note uses a different first heading than expected.

Weak retrieval usually means:

- Notes are too large or unfocused.
- Tags are missing.
- The query is too generic.
- The wrong retrieval mode was selected for the question.

## Current Limits

- Search supports FTS, local semantic embeddings and hybrid ranking.
- Local embeddings are deterministic and provider-free; remote embedding providers are not implemented yet.
- MCP integration is external: wrap the CLI from your own MCP server.
- HTTP API is local and unauthenticated.
- Watch mode depends on platform filesystem watcher behavior.
