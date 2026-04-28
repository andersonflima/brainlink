# Security

Brainlink is local-first.

## Defaults

- The HTTP server binds to `127.0.0.1` by default.
- The HTTP server refuses non-loopback hosts unless `--allow-public` is passed.
- The HTTP server is read-only and does not expose note creation, indexing or update routes.
- The SQLite database is a derived local index.
- Markdown files are user-owned source data.
- Brainlink-created Markdown files use `0600` permissions.
- Brainlink-created directories and `.brainlink` use `0700` permissions.

## Remote Exposure

Do not expose the HTTP server on a public interface without adding authentication, authorization and transport security.

## Sensitive Memory

Brainlink blocks common secret patterns by default when adding notes through the CLI.

Use `--allow-sensitive` only when the vault is intentionally protected by your own storage and access controls.

Avoid storing secrets, credentials, private keys, tokens or regulated personal data in a vault unless the vault is protected by your own storage and access controls.

## Vault Allowlist

External tool wrappers, including MCP servers, should set `BRAINLINK_ALLOWED_VAULTS` to restrict which vault paths the CLI can access.

```bash
export BRAINLINK_ALLOWED_VAULTS="/absolute/path/to/project-vault"
```

When the allowlist is set, CLI commands fail if `--vault` points outside the allowed roots.
