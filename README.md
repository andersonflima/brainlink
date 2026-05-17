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
4. Brainlink builds a local JSON index (`.brainlink/index.json`) and private encrypted search packs.
5. Agents query the index before responding.
6. Brainlink returns compact, source-backed context.

Markdown is the source of truth. `.brainlink/index.json` is a rebuildable index artifact.
After each index run, Brainlink also writes private encrypted search packs at `.brainlink/search-packs/*.blpk` to preserve fast retrieval and portable recovery.
Online retrieval always uses a single compression stage per pack; optional second-stage compression is reserved for offline backup artifacts only.
Pack decryption uses a Brainlink key from `$BRAINLINK_HOME/keys` or from `BRAINLINK_SEARCH_PACK_KEY` when explicitly configured.
Legacy `.jsonl.gz` packs are upgraded to `.blpk` automatically on first search/context access.

## Features

- Local-first Markdown vault.
- Obsidian-compatible `[[wiki links]]` and `#tags`.
- Weighted graph edges so agents can rank relationship importance and priority.
- Backlinks, broken-link reports, orphan detection and validation.
- Full-text, semantic and hybrid retrieval on a local file index.
- Middle-out context assembly around the strongest chunk per document.
- In-process index and context caching with automatic invalidation on index updates.
- Compressed-space prefiltering for `.blpk` packs before decryption and scan.
- Incremental indexing that reprocesses only changed markdown files and reuses existing chunks/embeddings for unchanged notes.
- Adaptive compressed-pack rebuild policy to keep indexing fast during small edit batches.
- Agent namespaces under `agents/<agent-id>/`.
- S3-compatible bucket vaults through `s3://bucket/prefix` URIs.
- CLI with machine-readable `--json` output.
- Short CLI alias: `blink`.
- Built-in MCP stdio server for agent tool integration.
- Local HTTP API.
- Realtime graph UI with agent selector and colored knowledge groups.
- Graph renderer optimized for large datasets with viewport-driven node culling and edge lookup by visible nodes.
- Large graph layout API automatically uses compact payload encoding and edge-cap transmission to reduce initial client load on very large vaults.
- Zoomed-out graph LOD now clusters dense regions and progressively expands nodes as zoom increases.
- Graph filtering runs in a dedicated browser worker to keep the UI thread responsive during heavy datasets.
- Edge rendering budgets adapt to zoom level to prevent frame spikes on large graph panoramas.

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

For a condensed setup path, see [docs/QUICKSTART.md](./docs/QUICKSTART.md).

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

Brainlink does not infer durable graph relationships from generated context. A context result is only a read package for the model. To create a real link in the knowledge graph, the agent must write Markdown that contains an explicit `[[Note Title]]` wiki link.

Writes with `blink add` reindex the vault automatically by default. This can be disabled with `--no-auto-index` and controlled globally with `autoIndexOnWrite` in `brainlink.config.json`.

When adding memory, follow this contract:

- Link the new note to at least one existing note when there is a related concept.
- Use the exact target note title inside `[[...]]`.
- Add retrieval tags such as `#architecture`, `#decision`, `#runbook` or `#preference`.
- Do not leave isolated notes unless they are intentionally root concepts.

If you disable auto-index, run `blink index` after batched writes.

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
6. Run `blink index` only when auto-index was disabled during a batch.
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

blink search "jwt auth" --vault ./vault

blink context "how does auth work?" --vault ./vault

blink server --vault ./vault --watch
```

Open the graph UI:

```txt
http://127.0.0.1:4321
```

When `--vault` is omitted, commands use the default vault at `$HOME/.brainlink/vault`. Pass `--vault` or configure `vault` in `brainlink.config.json` when you want a custom project-local vault.

## Bucket Vaults

Brainlink can use an S3-compatible bucket as the Markdown source of truth:

```bash
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

blink add "Architecture" \
  --vault "s3://my-memory-bucket/brainlink" \
  --content "Bucket Markdown is the source of truth. #architecture"

blink index --vault "s3://my-memory-bucket/brainlink"
blink context "architecture" --vault "s3://my-memory-bucket/brainlink"
```

For Cloudflare R2, MinIO or another S3-compatible endpoint:

```bash
export BRAINLINK_S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
export BRAINLINK_S3_FORCE_PATH_STYLE=1
```

Bucket vaults mirror Markdown into a local cache under
`$BRAINLINK_HOME/bucket-cache`. The bucket remains canonical; the local
`.brainlink/index.json` stays a disposable index artifact. Run `index` after remote
bucket changes before relying on `search`, `context`, graph or validation
commands. Watch mode is only supported for local filesystem vaults.

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
    index.json
```

Permanent data:

- Markdown notes
- optional Git history around the vault

Rebuildable data:

- `.brainlink/index.json`
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

### One-Command Agent Setup

If your agent runtime is Codex-compatible, run:

```bash
blink agent install --self-test
blink agent upgrade
```

This configures `~/.codex/config.toml` with Brainlink MCP (`brainlink-mcp`) so Brainlink is available by default in agent sessions.

If you are inside this repository and want plugin gallery setup too:

```bash
blink agent install --plugin-path ./plugins/brainlink
```

To verify:

```bash
blink agent status
```

For fully automated first run (vault index + health + bootstrap readiness + agent integration):

```bash
blink quickstart --query "what should I know before this task?" --json
```

For a locked-down setup, allowlist the vaults that MCP clients may access:

```json
{
  "mcpServers": {
    "brainlink": {
      "command": "brainlink-mcp",
      "env": {
        "BRAINLINK_ALLOWED_VAULTS": "/absolute/path/to/project-vault,/absolute/path/to/team-vault"
      }
    }
  }
}
```

### Install In MCP Client Stores

Brainlink can be exposed to MCP-compatible client stores in two ways:

1. Register the stdio server directly when the client accepts `mcpServers` configuration.
2. Register the local plugin from this repository when the client supports a plugin gallery or local marketplace.

Direct MCP server setup:

```bash
npm install -g @andespindola/brainlink@latest
command -v brainlink-mcp
```

Use this server configuration in any MCP-compatible client that reads a JSON MCP manifest:

```json
{
  "mcpServers": {
    "brainlink": {
      "command": "brainlink-mcp"
    }
  }
}
```

Local plugin gallery setup:

```bash
npm install -g @andespindola/brainlink@latest
git clone https://github.com/andersonflima/brainlink.git "$HOME/brainlink"
mkdir -p "$HOME/plugins"
ln -s "$HOME/brainlink/plugins/brainlink" "$HOME/plugins/brainlink"
```

Then register the plugin in the local marketplace file used by compatible clients:

```bash
node <<'NODE'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const marketplacePath = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json')
const pluginEntry = {
  name: 'brainlink',
  source: {
    source: 'local',
    path: './plugins/brainlink'
  },
  policy: {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL'
  },
  category: 'Productivity'
}

fs.mkdirSync(path.dirname(marketplacePath), { recursive: true })

const marketplace = fs.existsSync(marketplacePath)
  ? JSON.parse(fs.readFileSync(marketplacePath, 'utf8'))
  : {
      name: 'local',
      interface: {
        displayName: 'Local'
      },
      plugins: []
    }

const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
marketplace.plugins = [...plugins.filter((plugin) => plugin?.name !== 'brainlink'), pluginEntry]

fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`)
NODE
```

Restart the client after changing marketplace or MCP configuration so it reloads the Brainlink entry. The plugin starts `brainlink-mcp` and exposes the same tool set listed below.

Available tools:

- `brainlink_bootstrap`: plug-and-play entrypoint that runs index + health checks and can return context in one call.
- `brainlink_policy`: read or update bootstrap/context-first policy, including presets (`preset: "fully-auto" | "strict"`).
- `brainlink_recommendations`: return an automatic action plan so agents can run Brainlink in the recommended order.
- `brainlink_context`: read indexed context for a task or question.
- `brainlink_search`: search indexed notes.
- `brainlink_dedupe`: detect duplicate candidates using exact hash + semantic similarity scores.
- `brainlink_resolve_duplicate`: resolve duplicate pairs (`merge`, `link`, `ignore`) with connectivity-safe fallback edges.
- `brainlink_add_note`: write durable Markdown memory and reindex.
- `brainlink_add_file`: ingest a local file as a note and reindex.
- `brainlink_index`: rebuild the vault index.
- `brainlink_stats`: read indexed vault statistics.
- `brainlink_validate`: validate broken links and orphan notes.
- `brainlink_sync`: run index, stats, validation, broken-link and orphan checks in one call.
- `brainlink_graph`: read indexed graph nodes and weighted links.
- `brainlink_broken_links`: list unresolved wiki links.
- `brainlink_orphans`: list disconnected notes.

For the most automatic workflow, start MCP sessions with `brainlink_bootstrap` (optionally with `query`) and then continue with `brainlink_context`/`brainlink_add_note`.
By default, Brainlink enforces context-first for MCP reads (`enforceContextFirst=true`): non-context read tools return preflight until `brainlink_context` is called for the vault/agent session.
By default, MCP startup already runs bootstrap on the configured default vault/agent (`autoBootstrapOnStartup=true`), so sessions begin warm.
By default, Brainlink enforces bootstrap and auto-runs it for read tools when session state is missing or stale (`autoBootstrapOnRead=true`).
If you disable `autoBootstrapOnRead` through `brainlink_policy`, read tools return a preflight instruction with suggested `brainlink_bootstrap` arguments.
`brainlink_bootstrap`, `brainlink_policy` and preflight responses include structured `nextActions` so MCP clients can continue automatically without custom parsing.
For one-call planning, use `brainlink_recommendations` to get the recommended tool sequence for the current vault/agent/query.

The same linking rule applies through MCP: `brainlink_context` is read-only, and real graph links require Markdown notes with explicit `[[wiki links]]`. `brainlink_add_note` and `brainlink_add_file` reindex by default and include index + `writeConnectivity` metadata. Brainlink guarantees at least one edge per new note by auto-linking when needed.

Agents can raise the importance of a relationship by putting priority markers on the same line as a wiki link:

```md
- [ ] Review [[Architecture]] priority: high
Related: [[Incident Runbook]] #critical
```

Indexed edges expose `weight` and `priority` (`low`, `normal`, `high`, `critical`) through CLI JSON, HTTP graph APIs and `brainlink_graph`.

## Graph UI

Start the local frontend:

```bash
blink server --host 127.0.0.1 --port 4321 --watch
```

By default, the server uses `$HOME/.brainlink/vault`. Pass `--vault ./vault` only when you want to inspect a custom vault.
By default, `blink server` tries to open the graph in a native desktop GUI window:
- macOS: Swift + WebKit
- Windows: PowerShell WinForms WebBrowser
- Linux: optional Python GTK + WebKit2 (requires `python3` + `gi` + `WebKit2`)

On Linux, native GUI is disabled by default for better startup performance. Enable it with `BRAINLINK_LINUX_NATIVE_GUI=1`.
If native GUI launch is unavailable on your system, it falls back to dedicated app-window mode and then to the default browser.
For Chromium-family browsers on Linux (`chromium`, `chromium-browser`, `google-chrome`, `microsoft-edge`, `brave-browser`), Brainlink now auto-applies compatibility flags during launch (`--ozone-platform=x11`, `--disable-gpu`, `--disable-features=Vulkan,VaapiVideoDecoder`, `--disable-background-networking`) to avoid common Wayland/Vulkan/VAAPI startup issues.
Use `--no-open` to keep it headless.
When native GUI is used, the GUI window automatically closes when the `blink server` process stops.

The graph UI shows:

- notes as nodes
- `[[wiki links]]` as weighted edges
- details opened on node click (tags, outgoing links, backlinks, full Markdown content)
- neutral graph nodes with segment/group metadata
- agent selector (id-only labels) for isolated views
- graph filter matches title, path, tags and note content
- graph filter keeps hub context nodes visible (`Memory Hub`/`MOC`/high-degree fallback) to preserve relationship readability
- realtime refresh while `--watch` is enabled
- graph controls for zoom in, zoom out, fit visible nodes and reset-to-fit-all
- wheel zoom (including `cmd+scroll` and `ctrl+scroll`) anchored to cursor position for faster navigation in large graphs
- keyboard shortcuts: `+` zoom in, `-` zoom out, `0` reset fit
- double-click on canvas zooms in at cursor position
- floating graph totals (notes, links, tags) below the Brainlink title
- large-graph rendering safeguards (edge draw caps, lower redraw rate, zoom-aware interaction)
- massive-graph LOD progression: zoomed-out views prefer lightweight clusters, then progressively reveal nodes and edges as zoom increases

The server indexes before starting by default. Use `--no-index` to skip that step:

```bash
blink server --vault ./vault --no-index
```

## HTTP API

The HTTP API is read-only and exists only to power the graph UI and local inspection workflows.

The server always refuses non-loopback hosts. Brainlink HTTP only runs on localhost.

Routes:

- `GET /api/agents`
- `GET /api/graph`
- `GET /api/graph-layout`
- `GET /api/graph-node?id=<node-id>`
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

### `agent`

```bash
blink agent install
blink agent install --self-test
blink agent upgrade
blink agent policy --preset fully-auto
blink agent policy --preset strict
blink agent policy --enforce-context-first false
blink agent install --plugin-path ./plugins/brainlink
blink agent install --mcp-only --allowed-vaults "/absolute/vault,/absolute/team-vault"
blink agent status
```

Installs/checks agent integration. `install` writes Brainlink MCP config into `~/.codex/config.toml`.
When plugin files are available, it also links Brainlink plugin files into `~/plugins/brainlink` and updates `~/.agents/plugins/marketplace.json`.
With `--self-test`, install also validates MCP block presence, command wiring and local plugin registration signals.
Use `agent upgrade` on legacy installations to reapply current defaults and run the same self-test diagnostics.
Use `agent policy --preset fully-auto` for plug-and-play defaults, or `agent policy --preset strict` to require explicit bootstrap calls.
Both presets keep `enforceContextFirst=true` so Brainlink stays the primary context source for MCP sessions.

### `quickstart`

```bash
blink quickstart --json
blink quickstart --vault ./team-vault --agent coding-agent --query "architecture decisions" --json
blink quickstart --vault ./team-vault --mcp-only --json
```

Runs index + doctor + stats + validation, refreshes bootstrap session readiness, optionally returns context for a query, and (by default) upgrades local agent integration for plug-and-play MCP usage.
When `--mode`, `--limit` or `--tokens` are omitted, quickstart uses agent profile defaults when available.

### `config`

```bash
blink config where
blink config get vault
blink config doctor
blink config doctor --fix
blink config set-vault /absolute/path/to/existing-vault
blink config set-vault /absolute/path/to/existing-vault --migrate-from ~/.brainlink/vault
blink config set-vault "s3://my-memory-bucket/brainlink" --global
```

`config set-vault` writes configuration through CLI (no manual file edits required).  
By default it writes local config (`./brainlink.config.json`), appends the vault to `allowedVaults`, and migrates Markdown memory from the current configured vault when the target is empty.  
Use `--global` to write to `$BRAINLINK_HOME/brainlink.config.json`, `--no-migrate` to skip migration, and `--no-index` to skip post-migration indexing.
`config doctor` is dry-run by default; use `--fix` to apply safe config normalization and allowlist fixes.

### `migrate-vault`

```bash
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --dry-run
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault
blink migrate-vault --from ~/.brainlink/vault --to "s3://my-memory-bucket/brainlink"
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --report ./migration-report.json
```

Runs explicit markdown migration between vaults while preserving conflicts as `.conflict-<timestamp>` files.  
Use `--dry-run` to preview `copied`, `conflicted` and `unchanged` counts before writing.

### `db-import`

```bash
blink db-import --vault ./team-vault
blink db-import --vault ./team-vault --db ./legacy/brainlink.db
blink db-import --vault ./team-vault --db ./legacy/brainlink.db --table legacy_notes --dry-run
```

Imports durable memory from a legacy SQLite database into Markdown notes (`agents/<agent-id>/*.md`) and reindexes by default.
When `--db` is omitted, Brainlink auto-detects common legacy paths such as `<vault>/.brainlink/brainlink.db`.
Use `--agent <id>` to force all imported rows into one namespace, `--limit` for incremental imports, `--dry-run` to preview without writing files, and `--no-index` to defer reindexing.

### `init`

```bash
blink init
blink init ./vault
blink init ./team-vault --migrate-from ~/.brainlink/vault
```

Initializes vault metadata. Without an argument, Brainlink initializes the default vault at `$HOME/.brainlink/vault`.
When initializing an empty custom vault, existing Markdown content from the default vault is copied into it and reindexed so context is not left behind. Use `--no-migrate-existing` to start with an empty custom vault, or `--migrate-from <vault>` to copy from a specific source. Existing target files are never overwritten; conflicting source files are preserved with a `.conflict-<timestamp>` suffix.

### `add`

```bash
blink add "Note Title" --agent coding-agent --content "Markdown content"
blink add "Note Title" --vault ./vault --agent coding-agent --content "Markdown content"
blink add "Note Title" --vault ./vault --content-file ./notes.md
blink add "Note Title" --vault ./vault --content-file ./notes.md --no-auto-index
```

`--content` and `--content-file` are mutually exclusive. Add `--no-auto-index` when you want to defer reindexing.

Creates a Markdown note under `agents/<agent-id>/`. Common secret patterns are blocked by default; use `--allow-sensitive` only for an intentionally protected vault.
To avoid disconnected memory, Brainlink auto-adds a fallback wiki edge when a note is written without links, creating agent hub notes when needed.
`add` also returns `possibleDuplicates` (exact hash + semantic candidates) so agents can resolve duplicate memory right after writes.

### `dedupe`

```bash
blink dedupe --vault ./vault --json
blink dedupe --vault ./vault --agent coding-agent --limit 20 --min-score 0.92 --json
blink dedupe --vault ./vault --no-semantic --json
```

Detects `possibleDuplicate` pairs using exact content hashes and optional semantic similarity.

### `dedupe-resolve`

```bash
blink dedupe-resolve --vault ./vault --left agents/shared/a.md --right agents/shared/b.md --action merge --json
blink dedupe-resolve --vault ./vault --left agents/shared/a.md --right agents/shared/b.md --action link --json
blink dedupe-resolve --vault ./vault --left agents/shared/a.md --right agents/shared/b.md --action ignore --json
```

Resolves a duplicate pair with `merge`, `link` or `ignore`.
When action is not `merge`, Brainlink still creates a low-priority related edge (`#related-to`) so notes remain connected.

### `index`

```bash
blink index
blink index --vault ./vault
```

Rebuilds the local index from Markdown files.

### `bench`

```bash
blink bench --vault ./vault
blink bench --vault ./vault --watch
blink bench --vault ./vault --watch --debounce 500
blink bench --vault ./vault --json
```

Runs indexing with realtime phase telemetry (`start`, `scan`, `parse`, `embed`, `persist`, `packs`, `complete`) and prints a benchmark summary at the end of each run.

Summary includes compression behavior for `.blpk` packs when rebuild happens:
- pack rebuild reason
- pack count and pack build duration
- uncompressed input bytes vs compressed output bytes
- saved percentage
- objective guardrails (minimum savings and maximum latency regression thresholds)

Use `--watch` to keep benchmarking incremental reindex runs after Markdown changes (local filesystem vaults only).

### `pack-backup`

```bash
blink pack-backup --vault ./vault
blink pack-backup --vault ./vault --output ./vault/.brainlink/backups/custom.blpkbak.gz
blink pack-backup --vault ./vault --json
```

Creates an offline backup artifact of encrypted search packs with a second compression pass.
This is intentionally outside the online retrieval path (`index`, `search`, `context`).

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
If `--mode` or `--limit` is omitted, Brainlink resolves values from the current agent profile before falling back to global defaults.

Modes:

- `hybrid`: default; combines lexical matching with local embedding similarity.
- `fts`: exact lexical retrieval from the file index.
- `semantic`: local deterministic embedding similarity only.

Hybrid results are cached in-memory for a short TTL and invalidated automatically when the local index file changes.
Context selection uses a middle-out strategy: it starts from the strongest chunk in a note and expands to neighboring chunks while respecting token budget.

### `context`

```bash
blink context "question" --vault ./vault --limit 12 --tokens 2000
blink context "question" --vault ./vault --agent coding-agent --json
blink context "question" --vault ./vault --agent coding-agent --mode hybrid --json
```

Builds a compact context package for an agent.
Repeated calls with the same vault, agent, query, mode and token/limit settings are served from a short in-memory cache while the index is unchanged.

### `links`

```bash
blink links --vault ./vault
blink links --vault ./vault --agent coding-agent
```

Lists indexed wiki links. JSON output includes `weight` and `priority` for each relationship.

### `backlinks`

```bash
blink backlinks "Architecture" --vault ./vault
blink backlinks "Architecture" --vault ./vault --agent coding-agent
```

Lists notes pointing to a target title, ordered by strongest relationship first. JSON output includes `weight` and `priority`.

### `graph`

```bash
blink graph --vault ./vault --json
blink graph --vault ./vault --agent coding-agent --json
```

Prints indexed graph data. Edges include `weight` and `priority` so agents can categorize importance.

### `stats`

```bash
blink stats --vault ./vault
blink stats --vault ./vault --agent coding-agent --json
blink stats --vault ./vault --agent coding-agent --extended --json
```

Prints vault metrics.
Use `--extended` to include storage footprint, link quality ratios and observability probes (`index`, `search`, `context` latencies).

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

Runs environment and vault checks. When vault has zero markdown and zero indexed documents, `doctor` prints recommended next steps (add note, inspect config source, migrate memory).

### `watch`

```bash
blink watch --vault ./vault
```

Watches Markdown files and rebuilds the index when notes change.

### `server`

```bash
blink server --watch
blink server --vault ./vault --watch
blink server --vault ./vault --watch --no-open
```

Starts the local read-only graph UI and HTTP API.
By default, it tries to open a native desktop GUI window for the graph URL.
On Linux, native GUI is disabled by default; enable it with `BRAINLINK_LINUX_NATIVE_GUI=1`.
If native GUI launch is unavailable, it falls back to dedicated app-window mode and then browser open.
When fallback opens Chromium-family browsers on Linux, Brainlink automatically uses compatibility launch flags for stable rendering on Ubuntu/Wayland setups.
Use `--no-open` to skip that behavior.

The HTTP server only binds to loopback hosts such as `127.0.0.1`, `localhost` or `::1`.

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

Brainlink merges configuration in this order:

1. Global: `$BRAINLINK_HOME/brainlink.config.json` (or `$HOME/.brainlink/brainlink.config.json` by default)
2. Local: `brainlink.config.json` in the current working directory
3. Local legacy compatibility: `.brainlink.json` in the current working directory

If no `vault` is configured and no `--vault` flag is passed, Brainlink uses `$HOME/.brainlink/vault`.

```json
{
  "vault": ".brainlink-vault",
  "host": "127.0.0.1",
  "port": 4321,
  "allowedVaults": [".brainlink-vault"],
  "defaultAgent": "shared",
  "autoIndexOnWrite": true,
  "defaultSearchLimit": 10,
  "defaultContextTokens": 2000,
  "embeddingProvider": "local",
  "defaultSearchMode": "hybrid",
  "chunkSize": 1200,
  "searchPack": {
    "rowChunkSize": 5000,
    "compressionLevel": 5,
    "useDictionary": true,
    "guardrailMinSavingsPercent": 8,
    "guardrailMaxLatencyRegressionPercent": 5
  },
  "agentProfiles": {
    "coding-agent": {
      "defaultSearchMode": "semantic",
      "defaultSearchLimit": 8,
      "defaultContextTokens": 2400
    },
    "*": {
      "defaultSearchMode": "hybrid"
    }
  }
}
```

`defaultAgent` is optional. When set, CLI and MCP calls that omit `--agent`/`agent` use this value automatically. If not set, behavior remains as before.
`agentProfiles` is optional. When present, CLI and MCP resolve `mode`, `limit` and `tokens` per agent automatically, then fallback to global defaults.

`autoIndexOnWrite` is optional and defaults to `true`. Set it to `false` to defer indexing after writes.

Use `"embeddingProvider": "none"` when you want FTS-only indexing.

For local security checks, set your Snyk token in the environment:

```bash
export SNYK_TOKEN="snyk_..."
```

For GitHub Actions, add a repository secret `SNYK_TOKEN` and the CI/publish workflows will consume it automatically during build/test.

Set `BRAINLINK_ALLOWED_VAULTS` for external wrappers, including MCP servers, so a tool cannot pass arbitrary `--vault` paths:

```bash
export BRAINLINK_ALLOWED_VAULTS="/absolute/path/to/project-vault,/absolute/path/to/team-vault"
```

Bucket vaults can be allowlisted with the same variable:

```bash
export BRAINLINK_ALLOWED_VAULTS="s3://my-memory-bucket/brainlink"
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
  infrastructure/   filesystem and index adapters
```

Detailed notes:

- [Agent Usage](docs/AGENT_USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release](docs/RELEASE.md)

## Current Limits

- Semantic search uses deterministic local embeddings, not a remote model provider.
- `embeddingProvider` currently supports `local` and `none`.
- Link resolution is title-based inside each agent namespace, with `shared` as fallback.
- HTTP API is local and unauthenticated.
- Watch mode depends on the platform filesystem watcher.

## Beta Scope

The `0.1.0-beta` line is intended to stabilize the local-first memory loop:

- Markdown as durable memory.
- Rebuildable file index plus local embeddings and encrypted pack exports.
- CLI as the primary agent interface.
- HTTP graph API and frontend as inspection tools.
- Agent namespaces to avoid context mixing.
- MCP tools for context retrieval, durable memory writes and graph maintenance.

The beta includes local semantic retrieval. Remote embedding providers, remote auth, advanced deduplication and graph editing are future milestones.

## Security

Brainlink is local-first by default.

- Do not expose the HTTP server publicly without authentication.
- Brainlink HTTP is localhost-only and refuses non-loopback hosts.
- Brainlink blocks common secret patterns by default when adding notes. Use `--allow-sensitive` only for intentional, protected vaults.
- Do not store secrets, credentials, API keys or regulated personal data unless the vault is protected by your own storage controls.
- Treat `.brainlink/index.json` and `.brainlink/search-packs/` as disposable derived artifacts.

See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
Copyright (c) 2026 Substructa. See [COPYRIGHT.md](COPYRIGHT.md).

### Memory Optimization Loop (1-7)

Use this when your agent work needs consistent memory quality:

1. Start with `blink context "<task>" --agent "$BLINK_AGENT" --json`.
2. Keep notes focused with explicit `[[wiki links]]` and `#tags`.
3. Route agent-specific knowledge to dedicated namespaces under `agents/<agent-id>/`.
4. Keep `shared` as a curated global layer only.
5. Use targeted queries (`--limit`, explicit terms, `--mode hybrid`) before broad scans.
6. Run the sync command after writing notes:

```bash
npm run brainlink:sync -- --vault ./vault --agent "$BLINK_AGENT"
```

7. Before final response, keep the returned context sources as the grounding baseline.
