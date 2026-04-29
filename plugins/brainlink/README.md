# Brainlink Codex Plugin

This plugin helps Codex use Brainlink as local-first Markdown memory.

It expects the Brainlink npm package to be installed:

```bash
npm install -g @andespindola/brainlink
```

The plugin starts the `brainlink-mcp` stdio server and gives Codex a skill that defines the correct memory workflow:

1. Read memory with `brainlink_context` before work.
2. Write durable memory with `brainlink_add_note`.
3. Use explicit `[[wiki links]]` and `#tags`.
4. Validate graph health with `brainlink_validate`, `brainlink_broken_links` and `brainlink_orphans`.

`brainlink_context` is read-only. It does not create graph links, backlinks or durable memory.
