# Changelog

## 0.1.0-alpha.0

- Added local-first Markdown vault indexing.
- Added SQLite FTS, local semantic retrieval, wiki links, backlinks and graph retrieval.
- Added SQLite semantic bucket indexing to narrow vector candidates for larger vaults.
- Optimized title/link resolution with precomputed agent-scoped title maps.
- Added CLI, JSON output, HTTP API and graph UI.
- Added vault diagnostics: stats, broken links, orphans, validation and doctor.
- Added agent namespaces under `agents/<agent-id>/`.
- Added external MCP integration guidance through CLI subprocess wrappers.
- Added large vault benchmark command and graph layout stress coverage.
