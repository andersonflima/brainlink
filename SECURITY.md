# Security

Brainlink is local-first.

## Defaults

- The HTTP server binds to `127.0.0.1` by default.
- The HTTP server always refuses non-loopback hosts.
- The HTTP server is read-only and does not expose note creation, indexing or update routes.
- Local index artifacts (`.brainlink/index.json` and `.brainlink/search-packs/`) are derived data.
- Markdown files are user-owned source data.
- Brainlink-created Markdown files use `0600` permissions.
- Brainlink-created directories and `.brainlink` use `0700` permissions.

## Remote Exposure

Brainlink HTTP is intentionally localhost-only. It does not support binding to a public interface.

## Sensitive Memory

Brainlink blocks common secret patterns by default when adding notes through the CLI.

Use `--allow-sensitive` only when the vault is intentionally protected by your own storage and access controls.

Avoid storing secrets, credentials, private keys, tokens or regulated personal data in a vault unless the vault is protected by your own storage and access controls.

## Vault Allowlist

External tool wrappers, including MCP servers, should set `BRAINLINK_ALLOWED_VAULTS` to restrict which vault paths the CLI can access.

```bash
export BRAINLINK_ALLOWED_VAULTS="/absolute/path/to/project-vault"
```

For bucket vaults, allowlist the S3 URI prefix:

```bash
export BRAINLINK_ALLOWED_VAULTS="s3://my-memory-bucket/brainlink"
```

When the allowlist is set, CLI commands fail if `--vault` points outside the allowed roots.

## Bucket Credentials

Bucket vaults use the standard AWS SDK credential chain. Prefer short-lived,
least-privilege credentials scoped to the specific bucket prefix used by
Brainlink. Do not store bucket credentials in Markdown notes.
