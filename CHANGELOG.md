# Changelog

## 0.1.0-beta.4

- Added bootstrap session-state persistence in `$BRAINLINK_HOME/session-state.json` for vault/agent readiness tracking.
- Added MCP `brainlink_policy` tool and default bootstrap enforcement for read tools.
- Added `agent install --self-test` diagnostics and bootstrap readiness details in `agent status`.
- Added `agent upgrade` for legacy installations to reapply latest MCP/plugin defaults with self-test diagnostics.
- Added `config doctor --fix` safe autofix mode with dry-run default behavior.
- Added detailed per-file migration reporting through `migrate-vault --report`.
- Added `quickstart` command to run plug-and-play vault + bootstrap + agent setup in one flow.
- Added structured MCP `nextActions` in bootstrap/policy/preflight responses for automatic client continuation.
- Added default MCP read auto-bootstrap behavior controlled by `brainlink_policy.autoBootstrapOnRead`.
- Added default MCP startup bootstrap behavior controlled by `brainlink_policy.autoBootstrapOnStartup`.
- Added CLI MCP policy presets through `blink agent policy --preset fully-auto|strict`.
- Added write-time non-orphan enforcement by auto-linking notes without wiki edges to agent hub notes.
- Added MCP `brainlink_policy` presets (`fully-auto`, `strict`) for one-call policy switching.
- Added MCP write connectivity metadata in `brainlink_add_note`/`brainlink_add_file` responses.
- Added MCP `brainlink_recommendations` tool for plug-and-play workflow guidance.
- Improved graph/index robustness by splitting oversized paragraphs into bounded chunks and dropping self-referential links.
- Added `agentProfiles` configuration support so CLI and MCP can resolve per-agent defaults for mode/limit/tokens.
- Added short-lived hybrid search cache with automatic invalidation on index changes.
- Added `stats --extended` observability output with storage, quality and latency probes.
- Added `docs/QUICKSTART.md` and aligned README/agent docs with the latest CLI/MCP flows.
- Added middle-out context assembly so chunk selection expands around the strongest note chunk.
- Added compressed-space pack prefiltering (token bloom index) before `.blpk` decryption and scan.
- Improved graph UI auto-fit and viewport recovery so loaded nodes are re-centered when zoom/pan drifts to empty canvas.
- Added cross-platform native desktop GUI auto-open for `blink server` (macOS Swift/WebKit, Windows PowerShell WinForms, Linux Python GTK/WebKit2), with app-window/browser fallback.
- Changed Linux default UI launch to app-window/browser for lighter startup; Linux native GUI is now opt-in via `BRAINLINK_LINUX_NATIVE_GUI=1`.
- Added native GUI parent-process monitoring so GUI windows close automatically when `blink server` stops.
- Improved non-mac browser detection fallback to try installed Edge/Chrome/Firefox/Chromium candidates before system default open.
- Improved graph filter rendering to keep hub anchor nodes visible (`Memory Hub`/`MOC`/high-degree fallback) for coherent relationship context.
- Fixed graph modal content loading by correcting agent query parameter composition for `/api/graph-node` and `/api/graph-filter` requests.
- Improved 50k+ graph rendering performance with viewport-aware spatial node culling, cached render visibility, and node-adjacent edge selection to avoid full graph scans every frame.
- Added incremental vault indexing with file snapshots to reuse unchanged documents/chunks/embeddings, plus adaptive search-pack rebuild thresholds to avoid full re-compression on small edits.
- Reduced large-graph HTTP payload size with compact `/api/graph-layout` encoding for high-node vaults and capped transmitted edges to improve UI load responsiveness.
- Added aggressive graph LOD clustering when zoomed out, dynamic per-zoom edge render budgets, and a dedicated frontend worker for off-main-thread graph filter matching.
- Improved Linux browser fallback launch stability by auto-applying Chromium compatibility flags (`--ozone-platform=x11`, `--disable-gpu`, `--disable-features=Vulkan,VaapiVideoDecoder`, `--disable-background-networking`) for app-window/browser modes.
- Improved massive-graph UI responsiveness with stricter render budgets, adaptive heavy-graph frame throttling, reduced interaction hit-test frequency, and URL-first agent selection on initial graph load.
- Improved 50k+ graph LOD behavior so zoomed-out views render lightweight cluster overviews and progressively reveal nodes/edges only as zoom increases.
- Added `blink bench` with realtime index phase telemetry and per-run compressed-pack analysis (input/output bytes, ratio, saved space, rebuild reason and duration), including continuous watch mode.
- Added tunable single-stage search-pack compression settings (`searchPack.rowChunkSize`, `searchPack.compressionLevel`, `searchPack.useDictionary`).
- Added benchmark guardrails for compression savings and latency regression (`searchPack.guardrailMinSavingsPercent`, `searchPack.guardrailMaxLatencyRegressionPercent`), reported in `blink bench`.
- Added `blink pack-backup` for offline second-stage compression backups of encrypted `.blpk` packs, outside the online query path.
- Hardened Linux browser launch flags for Ubuntu 26 Chromium/Wayland compatibility (`--disable-vulkan`, `--use-gl=swiftshader`, `--ozone-platform-hint=x11`).
- Improved pack resilience by auto-repairing missing search-pack manifests from existing `.blpk` files, avoiding unnecessary full repacks on small incremental updates.

## 0.1.0-beta.3

- Added CLI configuration commands for effective vault management, including `config where`, `config get`, `config doctor` and `config set-vault`.
- Added explicit `migrate-vault` command with `--dry-run` preview and conflict-preserving copy behavior.
- Added one-command agent setup through `agent install` plus `agent status` diagnostics.
- Added MCP `brainlink_bootstrap` default entrypoint guidance for plug-and-play agent memory flows.
- Added migration coverage for S3 bucket vault targets.
- Updated architecture and agent-usage documentation to reflect current CLI/MCP behavior and configuration precedence.

## 0.1.0-beta.2

- Added MCP installation guidance for direct server configuration and local client stores.
- Documented MCP vault allowlisting with `BRAINLINK_ALLOWED_VAULTS`.
- Aligned the documented MCP tool list with the current server tools.
- Updated release documentation for the beta package line.

## 0.1.0-beta.0

- Promoted the package to the beta prerelease channel.
- Added built-in MCP stdio server distribution through `brainlink-mcp`.
- Added agent namespaces, auto-indexing on writes and file ingestion flows.
- Added S3-compatible bucket vault support and weighted graph relationships.

## 0.1.0-alpha.0

- Added local-first Markdown vault indexing.
- Added local full-text indexing, local semantic retrieval, wiki links, backlinks and graph retrieval.
- Added semantic candidate bucket indexing to narrow vector candidates for larger vaults.
- Optimized title/link resolution with precomputed agent-scoped title maps.
- Added CLI, JSON output, HTTP API and graph UI.
- Added vault diagnostics: stats, broken links, orphans, validation and doctor.
- Added agent namespaces under `agents/<agent-id>/`.
- Added external MCP integration guidance through CLI subprocess wrappers.
- Added large vault benchmark command and graph layout stress coverage.
