# Running opencode on Railway

Deploys the opencode **server** — the headless HTTP service plus the web UI
that the desktop app and `opencode web` talk to. You reach it from a browser at
your Railway domain.

This is not the Electron desktop app. That one needs a display and cannot run on
Railway; it is a local client. What Railway hosts is the same server the desktop
app runs on your laptop as "Local Server", moved to a container you can reach
from anywhere.

## What gets deployed

The image installs the published `opencode-ai` CLI from npm rather than building
this monorepo. The published binary already embeds the web UI, and a headless
service uses none of the desktop or terminal packages, so a source build would
add many minutes to every Railway deploy for artifacts nothing serves.

Bump `OPENCODE_VERSION` in `Dockerfile` to move to a newer CLI.

## Deploy

```sh
railway init
railway up
```

Railway reads `railway.json` at the repo root, which points at
`deploy/railway/Dockerfile`.

### 1. Set a password (required)

The service will refuse to boot without one:

```sh
railway variables --set "OPENCODE_SERVER_PASSWORD=$(openssl rand -base64 32)"
```

The server authenticates every route with HTTP basic auth. The username defaults
to `opencode` and is settable with `OPENCODE_SERVER_USERNAME`.

This matters more than a typical password gate. `opencode serve` exposes an
agent that runs shell commands and reads and writes files in the container.
On a public Railway domain, no password means anyone who finds the URL has a
remote shell. The entrypoint therefore exits rather than start unauthenticated;
`OPENCODE_ALLOW_UNAUTHENTICATED=1` overrides that if you have put your own
access control in front of it.

### 2. Add a volume

Attach a Railway volume mounted at **`/data`**.

Without it, every redeploy starts from an empty container: provider credentials,
sessions, message history, and any cloned repositories are gone. The image
points all four XDG base directories at `/data`, so one volume captures
everything opencode persists.

### 3. Add provider credentials

The agent needs a model provider. Set whichever you use as service variables,
for example:

```sh
railway variables --set "ANTHROPIC_API_KEY=sk-ant-..."
```

`opencode auth login` is the interactive alternative, but it needs a TTY. To use
it, run `railway ssh` into the service and log in there — the credentials land
in `/data/share/opencode` and survive redeploys because of the volume.

### 4. Open it

```sh
railway domain
```

Visit the domain and enter the username and password when the browser prompts.

## Notes

**No health check is configured.** Every route requires basic auth, and
Railway's probe cannot send credentials, so any `healthcheckPath` would get a
401 and fail an otherwise healthy deploy. Railway falls back to checking that
the process stays up, which is the accurate signal here.

**The container is the workspace.** The agent operates on `/data/workspace`,
not on this repository. Clone whatever you want it to work on into that
directory — via `railway ssh`, or by asking the agent itself once it is running.

**Sizing.** The agent spawns language servers and file watchers over your
checkout. Expect to need more than Railway's smallest instance for a
non-trivial repository.
