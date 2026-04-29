# Brainlink Agent Guide

This file tells coding agents and AI assistants how to use this repository.

## Project Purpose

Brainlink is a local-first knowledge memory for agents.

It reads a Markdown vault, extracts `[[wiki links]]` and `#tags`, builds a local SQLite full-text index, and returns compact context packages that agents can inject into prompts.

## Source Of Truth

Markdown files are the source of truth.

The SQLite database at `.brainlink/brainlink.db` is a derived index. It can be deleted and rebuilt with:

```bash
npm run dev -- index --vault ./vault
```

Do not store permanent knowledge only in SQLite.

By default, the installed Brainlink CLI uses `$HOME/.brainlink/vault` as its vault. Passing `--vault` or setting `vault` in `brainlink.config.json` intentionally selects a custom vault such as `./vault`.

## Agent Workflow

Use this loop when using Brainlink as memory:

1. Write durable knowledge into Markdown notes.
2. Link related notes with explicit `[[Note Title]]` wiki links inside the note body.
3. Add explicit `#tags` for retrieval.
4. Run `index` after writes.
5. Run `context "<task or question>"` before answering.
6. Use the returned sources as grounded context.

`context` is read-only. It does not create notes, backlinks, graph edges or durable memory by itself. A relationship exists only when a Markdown note contains a `[[wiki link]]` to another note and the vault has been indexed after that write.

When an agent adds durable memory, it should connect the new note to at least one existing concept unless the note is intentionally a root concept. Prefer exact note titles in links, for example `[[Architecture]]`, and run `broken-links`, `orphans` or `validate` when the graph looks disconnected.

## Commands

```bash
npm install
npm run build
npm run test
npm run check
```

Create and query a vault:

```bash
npm run dev -- init ./vault
npm run dev -- add "Architecture" --vault ./vault --content "Markdown is the source of truth. #architecture"
npm run dev -- index --vault ./vault
npm run dev -- context "what architecture decisions exist?" --vault ./vault
npm run dev -- context "what architecture decisions exist?" --vault ./vault --json
```

Inspect graph relationships:

```bash
npm run dev -- links --vault ./vault
npm run dev -- backlinks "Architecture" --vault ./vault
```

Start the local graph UI:

```bash
npm run dev -- server --vault ./vault --port 4321
```

The server reindexes by default and exposes:

```txt
http://127.0.0.1:4321/
http://127.0.0.1:4321/api/graph
```

Use watch mode while editing notes:

```bash
npm run dev -- server --vault ./vault --watch
npm run dev -- watch --vault ./vault
```

Start MCP over stdio:

```bash
npm run dev:mcp
```

Automation-facing CLI commands support `--json`. When invoking through `npm`, use `npm run --silent dev -- ...` so stdout remains valid JSON.

Vault health commands:

```bash
npm run dev -- stats --vault ./vault
npm run dev -- broken-links --vault ./vault
npm run dev -- orphans --vault ./vault
npm run dev -- validate --vault ./vault
npm run dev -- doctor --vault ./vault
```

## Implementation Boundaries

- Keep domain rules in `src/domain`.
- Keep use cases in `src/application`.
- Keep filesystem and SQLite details in `src/infrastructure`.
- Keep CLI concerns in `src/cli`.
- Prefer pure functions for parsing, ranking, formatting, and transformation.
- Do not make SQLite the canonical storage layer.
- Do not add comments with emojis.
- Keep JSON output backwards compatible where possible.

## Expected Context Output

The `context` command returns Markdown:

```md
# Brainlink Context
Query: user question

## 1. Note Title
Source: note.md
Tags: #tag
Score: 0.000

Relevant chunk content
```

Agents should treat `Source` as citation metadata and preserve it when reasoning about project memory.

## Verification Before Handoff

Run:

```bash
npm run check
```

For CLI behavior, also run a smoke flow with a temporary vault:

```bash
npm run dev -- init .tmp-vault
npm run dev -- add "Architecture" --vault .tmp-vault --content "Markdown source of truth. #architecture"
npm run dev -- index --vault .tmp-vault
npm run dev -- context "architecture" --vault .tmp-vault
```
