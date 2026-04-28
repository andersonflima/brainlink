# Brainlink

Local-first memory and knowledge graph for AI agents.

Brainlink turns a folder of Markdown files into a searchable, link-aware memory layer that agents can use before answering, planning, coding, documenting or handing work to another agent.

It is inspired by Obsidian-style knowledge bases: plain Markdown, `[[wiki links]]`, backlinks, tags and graph navigation. The difference is that Brainlink is built for automation first: CLI, JSON output, MCP tools, local HTTP API and a graph frontend.

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
- **Automation-ready output:** CLI commands support `--json`, and MCP tools expose the same capabilities to compatible clients.

## Why

LLMs do not have infinite context. Brainlink gives agents an external memory layer:

1. Durable knowledge is written as Markdown.
2. Notes are connected with `[[wiki links]]`.
3. Concepts are classified with `#tags`.
4. Brainlink builds a local SQLite full-text index.
5. Agents query the index before responding.
6. Brainlink returns compact, source-backed context.

Markdown is the source of truth. `.brainlink/brainlink.db` is only a rebuildable index.

## Features

- Local-first Markdown vault.
- Obsidian-compatible `[[wiki links]]` and `#tags`.
- Backlinks, broken-link reports, orphan detection and validation.
- Agent namespaces under `agents/<agent-id>/`.
- CLI with machine-readable `--json` output.
- Short CLI alias: `blink`.
- MCP stdio server for compatible agents and IDEs.
- Local HTTP API.
- Realtime graph UI with agent selector and colored knowledge groups.
- Demo vault generator.

## Install

Requirements:

- Node.js `>=22.5.0`
- npm

```bash
npm install -g @andersonespindola/brainlink
```

The package installs two equivalent commands:

```bash
brainlink --help
blink --help
```

Use `brainlink` when clarity matters. Use `blink` for faster daily terminal usage.

## Agent Autonomous Setup

This section is written for agents. If you are an AI agent operating in a user workspace, use this workflow to install and use Brainlink without requiring the user to run commands manually.

### 1. Check Whether Brainlink Is Installed

```bash
command -v blink || command -v brainlink
```

If neither command exists, install it:

```bash
npm install -g @andersonespindola/brainlink
```

Then verify:

```bash
blink --help
```

### 2. Choose A Vault Path

Prefer a project-local vault when memory belongs to one repository:

```bash
BLINK_VAULT=".brainlink-vault"
```

Use a user-level vault only when memory should span many projects:

```bash
BLINK_VAULT="$HOME/.brainlink/vault"
```

Initialize the vault:

```bash
blink init "$BLINK_VAULT"
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
  --vault "$BLINK_VAULT" \
  --agent "$BLINK_AGENT" \
  --json
```

If the context is weak, inspect raw search results:

```bash
blink search "architecture conventions tests release" \
  --vault "$BLINK_VAULT" \
  --agent "$BLINK_AGENT" \
  --limit 10 \
  --json
```

### 5. Write Durable Memory After Learning Something Useful

Only store knowledge that is likely to matter later:

```bash
blink add "Testing Policy" \
  --vault "$BLINK_VAULT" \
  --agent "$BLINK_AGENT" \
  --content "Run npm run check before final delivery. Related: [[Release Checklist]]. #testing #process"
```

Rebuild the index:

```bash
blink index --vault "$BLINK_VAULT"
```

### 6. Validate Memory Health

```bash
blink validate --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --json
blink broken-links --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --json
blink orphans --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --json
```

### Agent Operating Loop

Use this loop during real work:

1. Identify the task and choose `BLINK_AGENT`.
2. Run `blink context "<task>" --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --json`.
3. Use returned sources as project memory.
4. Perform the task.
5. Save only durable learnings with `blink add`.
6. Run `blink index`.
7. Validate with `blink validate`.

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
blink context "how should I change this module?" --vault ./vault --agent coding-agent
blink graph --vault ./vault --agent coding-agent --json
```

Link resolution is scoped:

1. same agent namespace
2. `shared`
3. unresolved link

This allows `coding-agent` and `research-agent` to both have a note named `Architecture` without contaminating each other's private memory.

## MCP

Start Brainlink as an MCP stdio server:

```bash
blink mcp
```

Use this command in any MCP-compatible client that can launch a local stdio server.

Example client configuration shape:

```json
{
  "mcpServers": {
    "brainlink": {
      "command": "blink",
      "args": ["mcp"]
    }
  }
}
```

Claude Desktop style config:

```json
{
  "mcpServers": {
    "brainlink": {
      "command": "blink",
      "args": ["mcp"]
    }
  }
}
```

Cursor or agent runtime style config is the same whenever the client supports local stdio MCP servers:

```json
{
  "name": "brainlink",
  "command": "blink",
  "args": ["mcp"]
}
```

Codex or shell-based agents can use the CLI directly when MCP configuration is unavailable:

```bash
blink context "<task>" --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --json
blink add "Decision Title" --vault "$BLINK_VAULT" --agent "$BLINK_AGENT" --content "Durable memory. #decision"
blink index --vault "$BLINK_VAULT"
```

Available MCP tools:

- `brainlink_index`
- `brainlink_add_note`
- `brainlink_agents`
- `brainlink_search`
- `brainlink_context`
- `brainlink_graph`
- `brainlink_links`
- `brainlink_backlinks`
- `brainlink_stats`
- `brainlink_validate`
- `brainlink_broken_links`
- `brainlink_orphans`

Most read tools accept `vault` and `agent` arguments.

Example tool input:

```json
{
  "vault": "./vault",
  "agent": "coding-agent",
  "query": "typescript module boundaries",
  "limit": 8
}
```

## Graph UI

Start the local frontend:

```bash
blink server --vault ./vault --host 127.0.0.1 --port 4321 --watch
```

The graph UI shows:

- notes as nodes
- `[[wiki links]]` as edges
- backlinks and outgoing links
- full Markdown content for the selected note
- colored groups by knowledge area
- agent selector for isolated views
- realtime refresh while `--watch` is enabled

The server indexes before starting by default. Use `--no-index` to skip that step:

```bash
blink server --vault ./vault --no-index
```

## HTTP API

All read routes are local and unauthenticated. Do not expose the server publicly without adding your own authentication and transport security.

Routes:

- `GET /api/agents`
- `GET /api/graph`
- `GET /api/graph-layout`
- `GET /api/search?q=<query>&limit=10`
- `GET /api/context?q=<query>&limit=12&tokens=2000`
- `GET /api/links`
- `GET /api/backlinks?title=<title>`
- `GET /api/stats`
- `GET /api/broken-links`
- `GET /api/orphans`
- `GET /api/validate`
- `POST /api/index`
- `POST /api/notes`

Read routes accept `agent=<agent-id>`:

```txt
/api/graph-layout?agent=coding-agent
/api/search?q=typescript&agent=coding-agent
/api/context?q=module-boundaries&agent=coding-agent
```

Create a note through HTTP:

```bash
curl -X POST http://127.0.0.1:4321/api/notes \
  -H 'content-type: application/json' \
  -d '{
    "title": "Runtime Policy",
    "agent": "coding-agent",
    "content": "Use Node.js 22 or newer. #runtime"
  }'
```

## CLI Reference

Every command works with either `brainlink` or `blink`.

### `init`

```bash
blink init ./vault
```

Initializes vault metadata.

### `add`

```bash
blink add "Note Title" --vault ./vault --agent coding-agent --content "Markdown content"
```

Creates a Markdown note under `agents/<agent-id>/`.

### `index`

```bash
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
```

Runs full-text search over indexed chunks.

### `context`

```bash
blink context "question" --vault ./vault --limit 12 --tokens 2000
blink context "question" --vault ./vault --agent coding-agent --json
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

### `mcp`

```bash
blink mcp
```

Starts the MCP stdio server.

### `server`

```bash
blink server --vault ./vault --watch
```

Starts the local graph UI and HTTP API.

## Machine-Readable Output

Commands with finite output support `--json`:

```bash
blink context "question" --vault ./vault --agent coding-agent --json
```

When running through npm scripts, use `--silent` to keep stdout clean:

```bash
npm run --silent dev -- context "question" --vault ./vault --json
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

## Demo Vault

Generate a dense demo vault:

```bash
npm run --silent demo:seed -- --clean
npm run --silent dev -- server --vault .demo/vault --watch
```

The demo includes multiple namespaces:

- `shared`
- `coding-agent`
- `research-agent`
- `docs-agent`

## Development

```bash
npm install
npm run build
npm run test
npm run check
```

Local CLI:

```bash
npm run dev -- --help
npm run dev -- server --vault .demo/vault --watch
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
  demo/             demo vault seed
  domain/           pure knowledge rules
  infrastructure/   filesystem and SQLite adapters
```

Detailed notes:

- [Agent Usage](docs/AGENT_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)

## Current Limits

- Search is full-text only.
- Embeddings have a provider boundary, but only `none` is implemented.
- Link resolution is title-based inside each agent namespace, with `shared` as fallback.
- MCP is stdio-only.
- HTTP API is local and unauthenticated.
- Watch mode depends on the platform filesystem watcher.

## Alpha Scope

`0.1.0-alpha.0` is intended to prove the local-first memory loop:

- Markdown as durable memory.
- SQLite FTS as rebuildable retrieval index.
- CLI and MCP as the primary agent interfaces.
- HTTP graph API and frontend as inspection tools.
- Agent namespaces to avoid context mixing.

The alpha is not trying to solve semantic retrieval yet. Embeddings, vector search, remote auth, advanced deduplication and graph editing are future milestones.

## Security

Brainlink is local-first by default.

- Do not expose the HTTP server publicly without authentication.
- Do not store secrets, credentials, API keys or regulated personal data unless the vault is protected by your own storage controls.
- Treat `.brainlink/brainlink.db` as disposable derived data.

See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
