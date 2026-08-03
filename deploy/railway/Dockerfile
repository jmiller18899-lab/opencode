# opencode server for Railway.
#
# This image does not build the monorepo. It installs the published opencode
# CLI, which already embeds the web UI that `opencode serve` hands to browsers.
# Building the workspace from source would pull the Electron desktop app and a
# private ghostty-web fork, neither of which a headless Railway service uses.
#
# Pin the version deliberately; Railway rebuilds on every push and an
# unpinned CLI would silently roll the agent forward under you.
ARG OPENCODE_VERSION=1.18.11

FROM node:22-bookworm-slim

ARG OPENCODE_VERSION

# git and ripgrep are not conveniences here: opencode's own tools shell out to
# them for repository operations and code search.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    less \
    openssh-client \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" \
  && npm cache clean --force \
  && opencode --version

# Everything opencode persists resolves through xdg-basedir, so pointing the
# XDG variables at one directory puts all mutable state under a single Railway
# volume: sessions, the SQLite database, auth credentials, and cloned repos.
ENV XDG_DATA_HOME=/data/share \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache \
    XDG_STATE_HOME=/data/state \
    OPENCODE_WORKSPACE=/data/workspace

# Created so the image runs without a volume attached. Mounting a Railway
# volume at /data shadows these and makes the state survive redeploys.
RUN mkdir -p /data/share /data/config /data/cache /data/state /data/workspace

WORKDIR /data/workspace

COPY deploy/railway/entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

# Informational only. The entrypoint binds Railway's injected $PORT.
EXPOSE 4096

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]
