# Changelog

## 0.1.0-beta.2

- Added MCP installation guidance for direct server configuration and local client stores.
- Documented MCP vault allowlisting with `BRAINLINK_ALLOWED_VAULTS`.
- Aligned the documented MCP tool list with the current server tools.
- Updated release documentation for the beta package line.

## 0.1.0-beta.0

- Promoted the package from alpha to beta.
- Added built-in MCP stdio server distribution through `brainlink-mcp`.
- Added agent namespaces, auto-indexing on writes and file ingestion flows.
- Added S3-compatible bucket vault support and weighted graph relationships.

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
