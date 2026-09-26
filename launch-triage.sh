#!/bin/bash
# Launcher for the todoist-triage server, invoked by launchd
# (com.mattstempeck.todoist-triage).
#
# Hardened against a transient empty read of .env: while the file is being
# saved (e.g. updating API keys) grep can momentarily return nothing. Rather
# than export an empty TODOIST_API_TOKEN and let node crash — which, with
# KeepAlive, produces a tight crash loop — we retry the read, and if the token
# is genuinely absent we back off before exiting so launchd restarts calmly.
set -uo pipefail

REPO_DIR="/Users/home/Projects/todoist-triage"
ENV_FILE="$REPO_DIR/.env"
BACKEND_DIR="$REPO_DIR/backend"
NODE_BIN="/opt/homebrew/bin/node"

read_token() {
  # Last non-empty value wins; tolerates surrounding quotes and whitespace.
  grep '^TODOIST_API_TOKEN=' "$ENV_FILE" 2>/dev/null \
    | tail -n1 | cut -d= -f2- | tr -d '"'"'"' \t\r\n'
}

TOKEN=""
for attempt in 1 2 3 4 5; do
  TOKEN="$(read_token)"
  [ -n "$TOKEN" ] && break
  echo "launch-triage: TODOIST_API_TOKEN empty (attempt $attempt/5), retrying..." >&2
  sleep 2
done

if [ -z "$TOKEN" ]; then
  echo "launch-triage: TODOIST_API_TOKEN not found in $ENV_FILE; backing off before exit." >&2
  sleep 30
  exit 1
fi

export TODOIST_API_TOKEN="$TOKEN"
cd "$BACKEND_DIR" || exit 1
exec "$NODE_BIN" server.js
