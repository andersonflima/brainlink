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

## Default Vault

When `--vault` is omitted, Brainlink uses a user-level vault:

```txt
$HOME/.brainlink/vault
```

`blink server` follows the same rule, so it serves the default Brainlink vault instead of the current working directory.

Use `--vault <path>` for a one-off custom vault, or set `vault` in config for a persistent default.
Configuration precedence is:

1. global: `$BRAINLINK_HOME/brainlink.config.json` (or `$HOME/.brainlink/brainlink.config.json`)
2. local: `./brainlink.config.json`
3. local legacy: `./.brainlink.json`

Set `BRAINLINK_HOME` when the whole Brainlink home directory should live somewhere else.

Use `blink config where` and `blink config doctor` to inspect active paths and effective source.

You can also set `defaultAgent` in `brainlink.config.json` / `.brainlink.json` (for example `"defaultAgent": "coding-agent"`). When set, CLI commands and MCP calls reuse it when `--agent`/`agent` is not passed.

`autoIndexOnWrite` (default: `true`) controls whether `add` and MCP write tools index right after writing.

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
- Put priority markers near links when the relationship is important.
- Use tags for retrieval.
- Keep each note focused.
- Prefer summaries over raw transcripts.
- Preserve dates when the timing matters.

## Linking Contract

Brainlink only builds graph edges from Markdown `[[wiki links]]`.

The `context` command is read-only. It retrieves indexed notes and returns a compact package for the model, but it does not write memory, create backlinks, infer relationships or modify the graph. If an agent reads context and then learns something durable, the agent must write a note with explicit links before that knowledge becomes connected memory.

Graph edges are weighted during indexing. Repeated links increase weight. Links inside headings or task-list lines receive a small boost. Priority markers on the same line as a link raise its priority:

```md
- [ ] Review [[Architecture]] priority: high
Related: [[Incident Runbook]] #critical
```

Agents should use weighted graph output to sort relationships by importance. Edges expose `weight` and `priority`, where priority is one of `low`, `normal`, `high` or `critical`.

Required write behavior:

1. Choose a clear title for the new note.
2. Look for an existing related concept with `search`, `links` or `backlinks`.
3. Add at least one `[[Existing Note Title]]` link unless the note is intentionally a root concept.
4. Add useful `#tags` for retrieval.
5. `add` writes are indexed by default. Only batch with explicit `--no-auto-index`, then run `index` once.
6. Run `validate`, `broken-links` or `orphans` when the graph should be connected.

Good linked note:

```bash
blink add "SQLite Index Rebuild" \
  --agent coding-agent \
  --content "Legacy derived indexes without agent columns are rebuilt because SQLite is disposable. Related: [[Architecture]], [[Agent Namespaces]]. #sqlite #architecture #decision"
blink validate --agent coding-agent
```

Poor disconnected note:

```bash
blink add "SQLite Index Rebuild" \
  --agent coding-agent \
  --content "We rebuild old indexes now."
```

The poor note may be searchable, but it will not create graph links, backlinks or useful traversal paths.

## Read Policy

Before answering a memory-dependent question, run:

```bash
blink context "<question>" --agent coding-agent
```

Use the returned context as source-grounded memory.

For machine-readable output, use:

```bash
blink context "<question>" --agent coding-agent --json
```

If the context is empty or weak:

1. Try a more explicit search query.
2. Run `search` to inspect raw matches.
3. Inspect links and backlinks.
4. Only then answer from general reasoning.

## Optimized Agent Workflow (1 to 7)

Use this exact loop for higher signal and lower noise:

1. Read memory before decisions:
   - `blink context "<task>" --agent "$BLINK_AGENT" --json`
   - Add `--mode hybrid` for mixed retrieval.
2. Keep vault structure deterministic:
   - Keep shared knowledge in `agents/shared`.
   - Keep private work-in-progress in your own agent namespace.
3. Write durable notes only, with explicit links and tags:
   - include at least one `[[...]]` link
   - include `#tags` for retrieval
4. Store only stable decisions and update an existing note when possible.
5. Use cache-conscious read/refresh cycle:
   - prefer targeted queries over broad dumps.
   - avoid re-indexing unless note set changed.
6. Run guardrails regularly:
   - `npm run brainlink:sync -- --vault ./vault --agent "$BLINK_AGENT"`.
   - the sync flow runs `index`, `stats`, `validate`, `broken-links`, `orphans` and a quick context probe.
7. Before responding:
   - cite sources from context output
   - keep output anchored in retrieved references.

Templates are available in `docs/templates` for quick note creation.

Recommended template:

```bash
cp docs/templates/agent-note-template.md /tmp/agent-note.md
```

### MCP Usage for the Optimized Flow

When using MCP, use this compact sequence for the same memory discipline:

1. Bootstrap context:
   - `brainlink_bootstrap` with `agent`, optional `query`, `mode: hybrid`, `limit`.
2. Capture durable decisions:
   - `brainlink_add_note` or `brainlink_add_file` with explicit `[[wiki links]]` and `#tags`.
3. Run maintenance before handoff or before the next step:
   - `brainlink_sync` with `agent`, `contextQuery`, `mode: hybrid`.
4. Diagnose graph issues only when needed:
   - `brainlink_validate`, `brainlink_broken_links`, `brainlink_orphans`.
5. Inspect relationships:
   - `brainlink_graph`.
6. Use `brainlink_stats` for a quick health snapshot.

## Examples For Common Coding Agents

These examples assume the agent can run shell commands in the user workspace.

### Codex-Style Terminal Agent

Run this at the start of a task:

```bash
export BLINK_AGENT="codex"
blink init
blink context "$USER_TASK" --agent "$BLINK_AGENT" --mode hybrid --json
```

After discovering durable project knowledge:

```bash
blink add "Implementation Boundary" \
  --agent "$BLINK_AGENT" \
  --content "Keep use cases in application and pure transformations in domain. [[Architecture]] #architecture #typescript"
blink index
```

### Claude Code-Style Agent

Use Brainlink as a preflight memory read before editing files:

```bash
blink context "task: $USER_TASK repo: $(basename "$PWD")" \
  --vault .brainlink-vault \
  --agent claude-code \
  --tokens 2500 \
  --json
```

Store only stable outcomes:

```bash
blink add "Test Command" \
  --vault .brainlink-vault \
  --agent claude-code \
  --content "For this repository, run npm run check before final delivery. #testing #process"
blink index --vault .brainlink-vault
```

### Cursor Or IDE Agent

Use a project-local vault and a namespace per assistant profile:

```bash
blink search "frontend graph layout conventions" \
  --vault .brainlink-vault \
  --agent ide-agent \
  --mode hybrid \
  --limit 8 \
  --json
```

When the IDE agent changes architecture, persist the rationale:

```bash
blink add "Frontend Asset Boundary" \
  --vault .brainlink-vault \
  --agent ide-agent \
  --content "Frontend graph assets live outside server routing modules so UI changes do not affect HTTP bootstrap. #frontend #architecture"
blink index --vault .brainlink-vault
```

## Command Reference

### Initialize A Vault

```bash
blink init
blink init ./vault
```

Creates:

```txt
$HOME/.brainlink/vault/
  .brainlink/
```

`blink init ./vault` creates a custom vault instead. If the custom vault is empty and the default `$HOME/.brainlink/vault` already has Markdown memory, Brainlink copies that content into the custom vault and reindexes it. Use `blink init ./vault --no-migrate-existing` to intentionally start empty, or `blink init ./vault --migrate-from <old-vault>` to migrate from a specific previous vault. Existing target files are not overwritten; conflicting source files are preserved with a `.conflict-<timestamp>` suffix.

### Configure Defaults

```bash
blink config where
blink config get vault
blink config doctor
blink config doctor --fix
blink config set-vault /absolute/path/to/vault
blink config set-vault /absolute/path/to/vault --global
```

`config set-vault` updates Brainlink config through CLI. By default it writes local `brainlink.config.json`, appends the vault to `allowedVaults`, and migrates markdown when the target is empty.

### Migrate Vaults Explicitly

```bash
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --dry-run
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault
blink migrate-vault --from ~/.brainlink/vault --to "s3://my-memory-bucket/brainlink"
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --report ./migration-report.json
```

Use `--dry-run` to preview `copied`, `conflicted`, `unchanged` before writing files.

### Install Agent Integration

```bash
blink agent install
blink agent install --self-test
blink agent install --plugin-path ./plugins/brainlink
blink agent status
```

`agent install` configures Brainlink MCP in `~/.codex/config.toml` so compatible agents can use Brainlink by default.

### Add A Note

```bash
blink add "Note Title" --vault ./vault --content "Markdown content"
blink add "Note Title" --vault ./vault --content-file ./notes.md
blink add "Note Title" --vault ./vault --content-file ./notes.md --no-auto-index
```

`--content` and `--content-file` are mutually exclusive. Use `--no-auto-index` if you want to defer indexing in batch operations.

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
- `semantic`: local deterministic embedding similarity with SQLite bucket candidate narrowing.

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
blink server --host 127.0.0.1 --port 4321
blink server --vault ./vault --host 127.0.0.1 --port 4321
```

This starts a local frontend for inspecting the knowledge graph.

Without `--vault`, the graph UI serves `$HOME/.brainlink/vault`.

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

### Use From MCP

Brainlink ships a stdio MCP server:

```bash
brainlink-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "brainlink": {
      "command": "brainlink-mcp"
    }
  }
}
```

Available MCP tools:

- `brainlink_bootstrap`
- `brainlink_policy`
- `brainlink_context`
- `brainlink_search`
- `brainlink_add_note`
- `brainlink_add_file`
- `brainlink_index`
- `brainlink_stats`
- `brainlink_validate`
- `brainlink_sync`
- `brainlink_graph`
- `brainlink_broken_links`
- `brainlink_orphans`

Recommended start of every memory-dependent task: call `brainlink_bootstrap` first, then `brainlink_context` only when additional retrieval is needed. By default, Brainlink enforces bootstrap for MCP read tools and returns a preflight response when bootstrap is missing or stale.

MCP clients can pass `vault` and `agent` arguments per tool call. Set `BRAINLINK_ALLOWED_VAULTS` when exposing Brainlink to an external agent process so a tool cannot pass arbitrary vault paths:

`brainlink_graph` returns weighted edges. Agents should prefer higher `weight` and stronger `priority` when deciding which related notes matter most.

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

Non-goals:

- `context` must not be treated as a write operation.
- Retrieved context must not be assumed to create graph edges.
- Backlinks are derived only from indexed `[[wiki links]]`.

## Operational Rules

- Re-run `index` after modifying notes.
- Treat `.brainlink/brainlink.db` as disposable.
- Commit Markdown notes, not local database files.
- Do not manually edit the database.
- Keep generated context short enough for the target model.
- Prefer specific queries over broad queries.
- Write explicit `[[wiki links]]` when durable memory should be connected.
- Check `orphans` before assuming the graph is healthy.

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

- Search supports FTS, local semantic embeddings, SQLite semantic buckets and hybrid ranking.
- Local embeddings are deterministic and provider-free; remote embedding providers are not implemented yet.
- MCP integration is available through the `brainlink-mcp` stdio server.
- HTTP API is local and unauthenticated.
- Bucket vaults support S3-compatible `s3://bucket/prefix` URIs and use a local cache for SQLite indexes.
- Watch mode depends on platform filesystem watcher behavior and is only supported for local filesystem vaults.
