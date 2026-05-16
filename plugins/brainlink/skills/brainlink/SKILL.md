---
name: brainlink
description: Use Brainlink as local-first Markdown memory for Codex tasks. Read context before work, write durable linked notes after important learnings, and validate graph health through Brainlink MCP tools.
---

# Brainlink Memory Workflow

Use this skill when a task may benefit from project memory, durable decisions, repeated conventions, handoff notes or agent continuity.

## Core Rules

- Brainlink Markdown files are the source of truth.
- The SQLite index is derived and disposable.
- `brainlink_context` is read-only.
- Retrieved context does not create notes, backlinks or graph edges.
- Real relationships require explicit `[[wiki links]]` in Markdown notes.
- Important relationships should put a priority marker on the same line as the link, such as `priority: high`, `#important` or `#critical`.
- Run indexing after writes. The MCP `brainlink_add_note` tool already writes and reindexes.
- Store durable knowledge only. Do not store secrets, credentials, private keys, access tokens or transient chat noise.

## Before Work

When Brainlink MCP is available, call `brainlink_bootstrap` first in every task that may depend on project memory.

Call `brainlink_bootstrap` before answering or changing code when memory may matter.

Recommended arguments:

```json
{
  "query": "task or question",
  "agent": "codex",
  "mode": "hybrid",
  "limit": 12,
  "tokens": 2000
}
```

If you only need retrieval without index/health checks, call `brainlink_context`:

```json
{
  "query": "task or question",
  "agent": "codex",
  "mode": "hybrid",
  "limit": 12,
  "tokens": 2000
}
```

Use returned titles, paths, tags and excerpts as grounded memory. If context is weak, call `brainlink_search` with a more explicit query.

## After Durable Learning

When a new fact, decision, convention, runbook or preference should survive the session, call `brainlink_add_note`.

Good memory content includes:

- A concise durable statement.
- At least one `[[Existing Note Title]]` link when a related concept exists.
- Priority markers near important links when the relationship should be ranked above ordinary links.
- Useful tags such as `#architecture`, `#decision`, `#runbook`, `#testing` or `#preference`.

Example:

```json
{
  "title": "SQLite Index Rebuild",
  "agent": "codex",
  "content": "Legacy derived SQLite indexes are rebuilt because SQLite is disposable and Markdown is source of truth. Related: [[Architecture]], [[Agent Namespaces]]. #sqlite #architecture #decision"
}
```

Avoid disconnected memory like:

```txt
We rebuild old indexes now.
```

That may be searchable, but it does not create useful graph traversal paths.

## Weighted Graph Reads

Use `brainlink_graph` when a task needs relationship structure. Edges include `weight` and `priority`; prefer stronger edges when choosing which related notes matter most.

## Validation

Use validation after writes or before handoff:

- `brainlink_validate`
- `brainlink_broken_links`
- `brainlink_orphans`

Broken links usually mean a note title does not match the `[[link]]` text or the target note does not exist. Orphans usually mean the note has no incoming or outgoing graph links.

## Vault Selection

If no `vault` argument is passed, Brainlink uses the configured default vault.

Use `vault` when the user wants a project-local vault. For external agent processes, prefer setting `BRAINLINK_ALLOWED_VAULTS` so tools cannot access arbitrary vault paths.
