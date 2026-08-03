#!/bin/sh
# Entrypoint for the Railway opencode service.
set -eu

PORT="${PORT:-4096}"
WORKSPACE="${OPENCODE_WORKSPACE:-/data/workspace}"

# A Railway service gets a public *.up.railway.app domain, and opencode's
# server is an AI agent with shell and filesystem access to this container.
# Unauthenticated, that domain is a remote code execution endpoint for anyone
# who finds it, so refuse to start rather than boot an open one by accident.
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  if [ "${OPENCODE_ALLOW_UNAUTHENTICATED:-}" = "1" ]; then
    echo "WARNING: starting with no password because OPENCODE_ALLOW_UNAUTHENTICATED=1." >&2
    echo "WARNING: anyone who reaches this URL can run commands in this container." >&2
  else
    echo "FATAL: OPENCODE_SERVER_PASSWORD is not set." >&2
    echo "" >&2
    echo "opencode serve exposes an agent that can run shell commands and read and" >&2
    echo "write files in this container. Railway serves it on a public domain, so" >&2
    echo "starting without a password would publish that access to the internet." >&2
    echo "" >&2
    echo "Set OPENCODE_SERVER_PASSWORD in the service variables, e.g." >&2
    echo "  railway variables --set \"OPENCODE_SERVER_PASSWORD=\$(openssl rand -base64 32)\"" >&2
    echo "" >&2
    echo "To override anyway, set OPENCODE_ALLOW_UNAUTHENTICATED=1." >&2
    exit 1
  fi
fi

mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# --hostname 0.0.0.0 is required: the CLI defaults to 127.0.0.1, which Railway's
# proxy cannot reach, and the deploy would fail its health probe.
exec opencode serve --hostname 0.0.0.0 --port "$PORT"
