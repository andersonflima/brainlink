<p align="center">
  <img src="./assets/brainlink-logo.svg" alt="Brainlink" width="720">
</p>

# Brainlink

Local-first memory and knowledge graph for AI agents.

Brainlink turns a folder of Markdown files into a searchable, link-aware memory layer that agents can use before answering, planning, coding, documenting or handing work to another agent.

It is inspired by Obsidian-style knowledge bases: plain Markdown, `[[wiki links]]`, backlinks, tags and graph navigation. The difference is that Brainlink is built for automation first: CLI, JSON output, local HTTP API and a graph frontend.

## Purpose

This repository exists to give agents a durable project memory that lives outside the model context window.

Without Brainlink, an agent usually depends on:

- the current prompt
- the current chat history
- files it happens to inspect in this run
- short-lived assumptions made during a task

With Brainlink, an agent can persist and retrieve:

- architecture decisions
- coding conventions
- user preferences
- operational runbooks
- previous investigation summaries
- domain concepts
- unresolved questions
- handoff notes for other agents

The goal is not to replace the model's context window. The goal is to make the model's context window smarter by filling it with the most relevant memory before the agent acts.

## How Brainlink Improves Agents

Brainlink improves agent behavior by giving them a repeatable memory workflow:

- **Less repeated discovery:** agents can retrieve previous decisions instead of rediscovering the same context.
- **Better continuity:** long-running projects keep memory across sessions and across different agents.
- **Grounded answers:** context packages include source paths, titles, tags and relevant excerpts.
- **Safer collaboration:** agent namespaces prevent private context from different agents being mixed accidentally.
- **Inspectable memory:** humans can open the vault as plain Markdown or in Obsidian-like tools.
- **Automation-ready output:** CLI commands support `--json`, so agents and external tool servers can consume stable machine-readable responses.

## Why

LLMs do not have infinite context. Brainlink gives agents an external memory layer:

1. Durable knowledge is written as Markdown.
2. Notes are connected with `[[wiki links]]`.
3. Concepts are classified with `#tags`.
4. Brainlink builds a local SQLite index with FTS records and local embeddings.
5. Agents query the index before responding.
6. Brainlink returns compact, source-backed context.

Markdown is the source of truth. `.brainlink/brainlink.db` is only a rebuildable index.

## Features

- Local-first Markdown vault.
- Obsidian-compatible `[[wiki links]]` and `#tags`.
- Backlinks, broken-link reports, orphan detection and validation.
- Full-text, semantic and hybrid retrieval modes.
- SQLite-backed semantic candidate buckets for larger vaults.
- Agent namespaces under `agents/<agent-id>/`.
- CLI with machine-readable `--json` output.
- Short CLI alias: `blink`.
- Built-in MCP stdio server for agent tool integration.
- Local HTTP API.
- Realtime graph UI with agent selector and colored knowledge groups.

## Install

Requirements:

- Node.js `>=22.5.0`
- npm

```bash
npm install -g @andespindola/brainlink@latest
```

The package installs two equivalent commands:

```bash
brainlink --help
blink --help
```

Use `brainlink` when clarity matters. Use `blink` for faster daily terminal usage.

The npm package page may show `npm i @andespindola/brainlink`. That installs
Brainlink as a project dependency. Use `-g` when you want the terminal commands
available globally, or run it without a global install:

```bash
npx @andespindola/brainlink@latest --help
```

## Agent Autonomous Setup

This section is written for agents. If you are an AI agent operating in a user workspace, use this workflow to install and use Brainlink without requiring the user to run commands manually.

### 1. Check Whether Brainlink Is Installed

```bash
command -v blink || command -v brainlink
```

If neither command exists, install it:

```bash
npm install -g @andespindola/brainlink@latest
```

Then verify:

```bash
blink --help
```

### 2. Use The Default Vault Or Choose A Custom Vault

By default, Brainlink stores memory in:

```bash
$HOME/.brainlink/vault
```

Use the default vault when memory should span many projects:

```bash
blink init
```

Choose a project-local vault only when memory belongs to one repository:

```bash
BLINK_VAULT=".brainlink-vault"
blink init "$BLINK_VAULT"
```

You can also set `BRAINLINK_HOME` to move Brainlink's default home directory:

```bash
export BRAINLINK_HOME="/path/to/brainlink-home"
```

### 3. Choose An Agent Namespace

Use a stable namespace for yourself:

```bash
BLINK_AGENT="coding-agent"
```

Use `shared` only for knowledge that should be visible to every workflow.

### 4. Read Memory Before Acting

Before answering or changing code, retrieve context:

```bash
blink context "What should I know before working on this task?" \
  --agent "$BLINK_AGENT" \
  --json
```

If the context is weak, inspect raw search results:

```bash
blink search "architecture conventions tests release" \
  --agent "$BLINK_AGENT" \
  --mode hybrid \
  --limit 10 \
  --json
```

### 5. Write Durable Memory After Learning Something Useful

Only store knowledge that is likely to matter later:

```bash
blink add "Testing Policy" \
  --agent "$BLINK_AGENT" \
  --content "Run npm run check before final delivery. Related: [[Release Checklist]]. #testing #process"
```

Brainlink does not infer durable graph relationships from generated context. A context result is only a read package for the model. To create a real link in the knowledge graph, the agent must write Markdown that contains an explicit `[[Note Title]]` wiki link and then rebuild the index.

When adding memory, follow this contract:

- Link the new note to at least one existing note when there is a related concept.
- Use the exact target note title inside `[[...]]`.
- Add retrieval tags such as `#architecture`, `#decision`, `#runbook` or `#preference`.
- Do not leave isolated notes unless they are intentionally root concepts.

Rebuild the index:

```bash
blink index
```

### 6. Validate Memory Health

```bash
blink validate --agent "$BLINK_AGENT" --json
blink broken-links --agent "$BLINK_AGENT" --json
blink orphans --agent "$BLINK_AGENT" --json
```

### Agent Operating Loop

Use this loop during real work:

1. Identify the task and choose `BLINK_AGENT`.
2. Run `blink context "<task>" --agent "$BLINK_AGENT" --json`.
3. Use returned sources as project memory.
4. Perform the task.
5. Save only durable learnings with `blink add`, including `[[wiki links]]` to related notes.
6. Run `blink index`.
7. Validate with `blink validate`, `blink broken-links` and `blink orphans` when graph links matter.

Do not store secrets, credentials, private keys, access tokens or transient chat noise.

## Quick Start

```bash
blink init ./vault

blink add "Architecture" \
  --vault ./vault \
  --content "Brainlink keeps Markdown as source of truth. #architecture"

blink add "Auth Decision" \
  --vault ./vault \
  --content "We chose JWT for API clients. [[Architecture]] #auth #jwt"

blink index --vault ./vault

blink search "jwt auth" --vault ./vault

blink context "how does auth work?" --vault ./vault

blink server --vault ./vault --watch
```

Open the graph UI:

```txt
http://127.0.0.1:4321
```

When `--vault` is omitted, commands use the default vault at `$HOME/.brainlink/vault`. Pass `--vault` or configure `vault` in `brainlink.config.json` when you want a custom project-local vault.

## Core Model

```txt
vault/
  agents/
    shared/
      architecture.md
    coding-agent/
      implementation-policy.md
    research-agent/
      source-review-policy.md
  .brainlink/
    brainlink.db
```

Permanent data:

- Markdown notes
- optional Git history around the vault

Rebuildable data:

- `.brainlink/brainlink.db`
- full-text records
- local embedding vectors
- local embedding buckets
- chunks
- resolved links
- backlinks

## Agent Namespaces

Brainlink separates memory by agent so multiple agents can use the same CLI without mixing private context.

Use `shared` for project-wide memory:

```bash
blink add "Project Rules" \
  --vault ./vault \
  --agent shared \
  --content "All agents should run tests before final answers. #process"
```

Use a dedicated namespace for private agent memory:

```bash
blink add "TypeScript Policy" \
  --vault ./vault \
  --agent coding-agent \
  --content "Prefer explicit types and functional core boundaries. [[Project Rules]] #typescript"
```

List indexed namespaces:

```bash
blink agents --vault ./vault
blink agents --vault ./vault --json
```

Query a single namespace:

```bash
blink search "typescript" --vault ./vault --agent coding-agent --json
blink search "authentication token policy" --vault ./vault --agent coding-agent --mode semantic --json
blink context "how should I change this module?" --vault ./vault --agent coding-agent
blink graph --vault ./vault --agent coding-agent --json
```

Link resolution is scoped:

1. same agent namespace
2. `shared`
3. unresolved link

This allows `coding-agent` and `research-agent` to both have a note named `Architecture` without contaminating each other's private memory.

## MCP Server Integration

Brainlink ships a stdio MCP server with the npm package:

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

Available tools:

- `brainlink_context`: read indexed context for a task or question.
- `brainlink_search`: search indexed notes.
- `brainlink_add_note`: write durable Markdown memory and reindex.
- `brainlink_index`: rebuild the vault index.
- `brainlink_validate`: validate broken links and orphan notes.
- `brainlink_graph`: read indexed graph nodes and links.
- `brainlink_broken_links`: list unresolved wiki links.
- `brainlink_orphans`: list disconnected notes.

The same linking rule applies through MCP: `brainlink_context` is read-only, and real graph links require Markdown notes with explicit `[[wiki links]]` followed by indexing.

## Graph UI

Start the local frontend:

```bash
blink server --host 127.0.0.1 --port 4321 --watch
```

By default, the server uses `$HOME/.brainlink/vault`. Pass `--vault ./vault` only when you want to inspect a custom vault.

The graph UI shows:

- notes as nodes
- `[[wiki links]]` as edges
- backlinks and outgoing links
- full Markdown content for the selected note
- neutral graph nodes with segment/group metadata
- agent selector for isolated views
- realtime refresh while `--watch` is enabled

The server indexes before starting by default. Use `--no-index` to skip that step:

```bash
blink server --vault ./vault --no-index
```

## HTTP API

The HTTP API is read-only and exists only to power the graph UI and local inspection workflows.

The server refuses non-loopback hosts by default. Use `--allow-public` only behind your own authentication, authorization and TLS.

Routes:

- `GET /api/agents`
- `GET /api/graph`
- `GET /api/graph-layout`
- `GET /api/search?q=<query>&limit=10&mode=hybrid`
- `GET /api/context?q=<query>&limit=12&tokens=2000&mode=hybrid`
- `GET /api/links`
- `GET /api/backlinks?title=<title>`
- `GET /api/stats`
- `GET /api/broken-links`
- `GET /api/orphans`
- `GET /api/validate`

Read routes accept `agent=<agent-id>`:

```txt
/api/graph-layout?agent=coding-agent
/api/search?q=typescript&agent=coding-agent&mode=hybrid
/api/context?q=module-boundaries&agent=coding-agent&mode=semantic
```

## CLI Reference

Every command works with either `brainlink` or `blink`.

### `init`

```bash
blink init
blink init ./vault
```

Initializes vault metadata. Without an argument, Brainlink initializes the default vault at `$HOME/.brainlink/vault`.

### `add`

```bash
blink add "Note Title" --agent coding-agent --content "Markdown content"
blink add "Note Title" --vault ./vault --agent coding-agent --content "Markdown content"
```

Creates a Markdown note under `agents/<agent-id>/`. Common secret patterns are blocked by default; use `--allow-sensitive` only for an intentionally protected vault.

### `index`

```bash
blink index
blink index --vault ./vault
```

Rebuilds the local index from Markdown files.

### `agents`

```bash
blink agents --vault ./vault
blink agents --vault ./vault --json
```

Lists indexed agent namespaces.

### `search`

```bash
blink search "query" --vault ./vault --limit 10
blink search "query" --vault ./vault --agent coding-agent --json
blink search "query" --vault ./vault --mode semantic --json
```

Runs retrieval over indexed chunks.

Modes:

- `hybrid`: default; combines SQLite FTS with local embedding similarity.
- `fts`: exact lexical retrieval through SQLite FTS.
- `semantic`: local deterministic embedding similarity only.

### `context`

```bash
blink context "question" --vault ./vault --limit 12 --tokens 2000
blink context "question" --vault ./vault --agent coding-agent --json
blink context "question" --vault ./vault --agent coding-agent --mode hybrid --json
```

Builds a compact context package for an agent.

### `links`

```bash
blink links --vault ./vault
blink links --vault ./vault --agent coding-agent
```

Lists indexed wiki links.

### `backlinks`

```bash
blink backlinks "Architecture" --vault ./vault
blink backlinks "Architecture" --vault ./vault --agent coding-agent
```

Lists notes pointing to a target title.

### `graph`

```bash
blink graph --vault ./vault --json
blink graph --vault ./vault --agent coding-agent --json
```

Prints indexed graph data.

### `stats`

```bash
blink stats --vault ./vault
blink stats --vault ./vault --agent coding-agent --json
```

Prints vault metrics.

### `broken-links`

```bash
blink broken-links --vault ./vault
```

Lists unresolved wiki links.

### `orphans`

```bash
blink orphans --vault ./vault
```

Lists notes without incoming or outgoing links.

### `validate`

```bash
blink validate --vault ./vault
```

Validates graph health. The command exits non-zero when required checks fail.

### `doctor`

```bash
blink doctor --vault ./vault
```

Runs environment and vault checks.

### `watch`

```bash
blink watch --vault ./vault
```

Watches Markdown files and rebuilds the index when notes change.

### `server`

```bash
blink server --watch
blink server --vault ./vault --watch
```

Starts the local read-only graph UI and HTTP API.

To bind outside localhost, pass `--allow-public` and put the server behind your own auth and TLS.

## Machine-Readable Output

Commands with finite output support `--json`:

```bash
blink context "question" --vault ./vault --agent coding-agent --json
```

When running through npm scripts, use `--silent` to keep stdout clean:

```bash
npm run --silent dev -- context "question" --vault ./vault --json
```

## Configuration

Brainlink reads `brainlink.config.json` or `.brainlink.json` from the current working directory. If no `vault` is configured and no `--vault` flag is passed, Brainlink uses `$HOME/.brainlink/vault`.

```json
{
  "vault": ".brainlink-vault",
  "host": "127.0.0.1",
  "port": 4321,
  "allowedVaults": [".brainlink-vault"],
  "defaultSearchLimit": 10,
  "defaultContextTokens": 2000,
  "embeddingProvider": "local",
  "defaultSearchMode": "hybrid",
  "chunkSize": 1200
}
```

Use `"embeddingProvider": "none"` when you want FTS-only indexing.

Set `BRAINLINK_ALLOWED_VAULTS` for external wrappers, including MCP servers, so a tool cannot pass arbitrary `--vault` paths:

```bash
export BRAINLINK_ALLOWED_VAULTS="/absolute/path/to/project-vault,/absolute/path/to/team-vault"
```

## Note Format

Brainlink supports Markdown with optional frontmatter:

```md
---
title: "Auth Decision"
agent: "coding-agent"
type: "decision"
---

# Auth Decision

We chose JWT for API clients.

Related:

- [[Architecture]]
- [[API Gateway]]

#auth #jwt #decision
```

Supported signals:

- `title` frontmatter
- `agent` frontmatter
- first `# Heading`
- file name fallback
- `[[Wiki Link]]`
- `[[Wiki Link#Section]]`
- `[[Wiki Link|Alias]]`
- `#tags`

## Development

```bash
npm install
npm run build
npm run test
npm run check
```

Large vault benchmark:

```bash
npm run benchmark:large -- --notes 5000
```

Use `--keep` to keep the generated temporary vault for inspection.

Local CLI:

```bash
npm run dev -- --help
npm run dev -- server --vault .brainlink-vault --watch
```

Package smoke test:

```bash
npm run pack:smoke
```

## Architecture

```txt
src/
  application/      use cases
  cli/              command-line adapter
  domain/           pure knowledge rules
  infrastructure/   filesystem and SQLite adapters
```

Detailed notes:

- [Agent Usage](docs/AGENT_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release](docs/RELEASE.md)

## Current Limits

- Semantic search uses deterministic local embeddings, not a remote model provider.
- Semantic search uses SQLite embedding buckets to narrow candidates before cosine scoring.
- `embeddingProvider` currently supports `local` and `none`.
- Link resolution is title-based inside each agent namespace, with `shared` as fallback.
- HTTP API is local and unauthenticated.
- Watch mode depends on the platform filesystem watcher.

## Alpha Scope

`0.1.0-alpha.0` is intended to prove the local-first memory loop:

- Markdown as durable memory.
- SQLite FTS plus local embeddings and semantic buckets as rebuildable retrieval index.
- CLI as the primary agent interface.
- HTTP graph API and frontend as inspection tools.
- Agent namespaces to avoid context mixing.

The alpha includes local semantic retrieval. Remote embedding providers, remote auth, advanced deduplication and graph editing are future milestones.

## Security

Brainlink is local-first by default.

- Do not expose the HTTP server publicly without authentication.
- Brainlink blocks common secret patterns by default when adding notes. Use `--allow-sensitive` only for intentional, protected vaults.
- Do not store secrets, credentials, API keys or regulated personal data unless the vault is protected by your own storage controls.
- Treat `.brainlink/brainlink.db` as disposable derived data.

See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
