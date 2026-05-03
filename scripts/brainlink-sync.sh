#!/usr/bin/env bash

set -euo pipefail

parse_args() {
  VAULT="${BLINK_VAULT:-./vault}"
  AGENT="${BLINK_AGENT:-shared}"
  QUERY="${BRAINLINK_SMOKE_QUERY:-architecture}"

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --vault)
        VAULT="$2"
        shift 2
        ;;
      --agent)
        AGENT="$2"
        shift 2
        ;;
      --smoke-query)
        QUERY="$2"
        shift 2
        ;;
      --no-smoke)
        QUERY=""
        shift 1
        ;;
      --)
        shift
        break
        ;;
      *)
        break
        ;;
    esac
  done
}

run_cmd() {
  local args=("$@")
  if [[ "${BRAINLINK_USE_GLOBAL_CLI:-0}" == "1" ]] && command -v blink >/dev/null 2>&1; then
    blink "${args[@]}"
    return
  fi

  npm run --silent dev -- "${args[@]}"
}

main() {
  parse_args "$@"

  if [[ ! -d "$VAULT" ]]; then
    echo "Error: vault not found at $VAULT" >&2
    exit 1
  fi

  run_cmd index --vault "$VAULT"
  run_cmd stats --vault "$VAULT" --agent "$AGENT"
  run_cmd validate --vault "$VAULT" --agent "$AGENT"
  run_cmd broken-links --vault "$VAULT" --agent "$AGENT"
  run_cmd orphans --vault "$VAULT" --agent "$AGENT"

  if [[ -n "$QUERY" ]]; then
    run_cmd context "$QUERY" --vault "$VAULT" --agent "$AGENT" --json
  fi
}

main "$@"
