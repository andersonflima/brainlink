# Security

Brainlink is local-first.

## Defaults

- The HTTP server binds to `127.0.0.1` by default.
- The SQLite database is a derived local index.
- Markdown files are user-owned source data.

## Remote Exposure

Do not expose the HTTP server on a public interface without adding authentication, authorization and transport security.

## Sensitive Memory

Avoid storing secrets, credentials, private keys, tokens or regulated personal data in a vault unless the vault is protected by your own storage and access controls.
