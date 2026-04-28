# Contributing

## Development

```bash
npm install
npm run check
```

## Local CLI

```bash
npm run dev -- --help
```

## Package Smoke Test

```bash
npm run pack:smoke
```

## Design Rules

- Markdown files are the source of truth.
- SQLite is a derived index and must remain rebuildable.
- Domain parsing, graph analysis and layout should stay pure and testable.
- CLI, HTTP, MCP, filesystem and SQLite code are adapters around application use cases.
