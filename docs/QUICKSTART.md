# Quickstart

Use this path when you want Brainlink running as agent memory with the smallest setup.

## 1) Install Brainlink

```bash
npm install -g @andespindola/brainlink@latest
```

## 2) Install Agent Integration

```bash
blink agent install --self-test
blink agent upgrade
blink agent status
```

For local plugin gallery in this repository:

```bash
blink agent install --plugin-path ./plugins/brainlink --self-test
```

One-command setup and readiness check:

```bash
blink quickstart --query "what should I know before this task?" --json
```

## 3) Initialize Or Select Vault

```bash
blink init
blink config where
```

To set a different default vault:

```bash
blink config set-vault /absolute/path/to/vault
```

Optional per-agent retrieval defaults in `brainlink.config.json`:

```json
{
  "agentProfiles": {
    "coding-agent": {
      "defaultSearchMode": "semantic",
      "defaultSearchLimit": 8,
      "defaultContextTokens": 2400
    }
  }
}
```

## 4) Run Bootstrap Before Work

MCP clients should call `brainlink_bootstrap` first for each vault/agent session.
Read tools auto-bootstrap by default when state is missing/stale, and bootstrap/preflight responses include structured `nextActions` for automatic client flows.

For CLI workflows:

```bash
blink context "what should I know before this task?" --mode hybrid --json
```

## 5) Write Durable Memory

```bash
blink add "Architecture Decision" --content "Use explicit [[Bounded Context]] links and #tags. #architecture #decision"
```

## 6) Validate Health

```bash
blink validate
blink doctor
blink stats --extended --json
```

## 7) Migrate Existing Memory (Optional)

Preview first:

```bash
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --dry-run --report ./migration-report.json
```

Apply:

```bash
blink migrate-vault --from ~/.brainlink/vault --to ./team-vault --report ./migration-report.json
```

S3 target:

```bash
blink migrate-vault --from ~/.brainlink/vault --to "s3://my-memory-bucket/brainlink" --dry-run
```
