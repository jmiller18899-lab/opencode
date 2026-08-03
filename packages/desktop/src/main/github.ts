import { execFile } from "node:child_process"
import { chmod, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { GitHubAccount, GitHubRepository } from "@opencode-ai/app/platform"

export type GitHubToken = {
  value: string
  persistent: boolean
}

export type GitHubTokenStore = {
  get(): GitHubToken | undefined
  set(value: string): GitHubToken
  delete(): void
}

type GitHubServiceOptions = {
  tokens: GitHubTokenStore
  apiUrl?: string
  fetch?: typeof fetch
}

const tokenPattern = /^[A-Za-z0-9_]+$/

export function createGitHubService(options: GitHubServiceOptions) {
  const request = options.fetch ?? fetch
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "")

  const github = async (path: string, token: string) => {
    return request(`${apiUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "OpenCode-Desktop",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    })
  }

  const account = async (token: GitHubToken, clearUnauthorized: boolean) => {
    const response = await github("/user", token.value)
    if (response.status === 401) {
      if (clearUnauthorized) options.tokens.delete()
      return
    }
    if (!response.ok) throw githubRequestError(response)
    return githubAccount(await response.json(), token.persistent)
  }

  const repositories = async (token: GitHubToken, page = 1): Promise<GitHubRepository[]> => {
    const response = await github(
      `/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&per_page=100&sort=updated&page=${page}`,
      token.value,
    )
    if (response.status === 401) {
      options.tokens.delete()
      throw new Error("Your GitHub connection has expired. Connect your account again.")
    }
    if (!response.ok) throw githubRequestError(response)
    const items = githubRepositories(await response.json())
    if (items.length < 100) return items
    return items.concat(await repositories(token, page + 1))
  }

  return {
    async status() {
      const token = options.tokens.get()
      if (!token) return null
      return (await account(token, true)) ?? null
    },
    async connect(input: string) {
      const value = input.trim()
      if (value.length < 20 || value.length > 512 || !tokenPattern.test(value)) {
        throw new Error("Enter a valid GitHub personal access token.")
      }
      const current = { value, persistent: false }
      const user = await account(current, false)
      if (!user) throw new Error("GitHub rejected this token. Check its access and try again.")
      return { ...user, storage: options.tokens.set(value).persistent ? "persistent" : "session" }
    },
    disconnect() {
      options.tokens.delete()
    },
    async repositories() {
      const token = options.tokens.get()
      if (!token) throw new Error("Connect GitHub before loading repositories.")
      return repositories(token)
    },
    async clone(input: { url: string; destination: string }) {
      const token = options.tokens.get()
      if (!token) throw new Error("Connect GitHub before cloning a repository.")
      const repository = githubCloneRepository(input.url)
      const destination = resolve(input.destination)
      if (
        !(await stat(destination).then(
          (item) => item.isDirectory(),
          () => false,
        ))
      ) {
        throw new Error("Choose an existing destination folder.")
      }
      const target = join(destination, repository)
      if (
        await stat(target).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error(`A folder named "${repository}" already exists in this destination.`)
      }
      await cloneGitRepository({
        url: input.url,
        target,
        token: token.value,
      })
      return target
    },
  }
}

export async function cloneGitRepository(input: { url: string; target: string; token: string }) {
  const directory = await mkdtemp(join(dirname(input.target), ".opencode-clone-"))
  const checkout = join(directory, "checkout")
  const askpass = join(directory, process.platform === "win32" ? "askpass.cmd" : "askpass.sh")
  return writeFile(
    askpass,
    process.platform === "win32"
      ? '@echo off\r\necho %~1 | findstr /I "Username" >nul\r\nif %ERRORLEVEL% EQU 0 (echo x-access-token) else (echo %OPENCODE_GITHUB_TOKEN%)\r\n'
      : '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token" ;; *) printf "%s\\n" "$OPENCODE_GITHUB_TOKEN" ;; esac\n',
    { mode: 0o700 },
  )
    .then(() => (process.platform === "win32" ? undefined : chmod(askpass, 0o700)))
    .then(
      () =>
        new Promise<void>((done, fail) => {
          execFile(
            "git",
            ["clone", "--", input.url, checkout],
            {
              env: {
                ...process.env,
                GIT_ASKPASS: askpass,
                GIT_TERMINAL_PROMPT: "0",
                LC_ALL: "C",
                OPENCODE_GITHUB_TOKEN: input.token,
              },
              maxBuffer: 5 * 1024 * 1024,
            },
            (error, _stdout, stderr) => {
              if (!error) return done()
              fail(new Error((stderr.trim() || error.message).replaceAll(input.token, "[redacted]")))
            },
          )
        }),
    )
    .then(() => rename(checkout, input.target))
    .catch(async (cause: unknown) => {
      await rm(checkout, { recursive: true, force: true })
      throw cause
    })
    .finally(() => rm(directory, { recursive: true, force: true }))
}

function githubCloneRepository(value: string) {
  const url = URL.parse(value)
  if (!url) throw new Error("OpenCode can only clone HTTPS repositories from GitHub.")
  const parts = url.pathname.replace(/^\/|\/$/g, "").split("/")
  const repository = parts[1]?.replace(/\.git$/, "")
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    !parts[0] ||
    !repository ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error("OpenCode can only clone HTTPS repositories from GitHub.")
  }
  return repository
}

function githubAccount(value: unknown, persistent: boolean): GitHubAccount {
  if (!record(value) || typeof value.login !== "string" || typeof value.avatar_url !== "string") {
    throw new Error("GitHub returned an invalid account response.")
  }
  return {
    login: value.login,
    name: typeof value.name === "string" ? value.name : undefined,
    avatarUrl: value.avatar_url,
    storage: persistent ? "persistent" : "session",
  }
}

function githubRepositories(value: unknown) {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid repository response.")
  return value.map(githubRepository)
}

function githubRepository(value: unknown): GitHubRepository {
  if (
    !record(value) ||
    typeof value.id !== "number" ||
    typeof value.name !== "string" ||
    typeof value.full_name !== "string" ||
    typeof value.private !== "boolean" ||
    typeof value.clone_url !== "string" ||
    typeof value.default_branch !== "string" ||
    typeof value.updated_at !== "string" ||
    !record(value.owner) ||
    typeof value.owner.login !== "string"
  ) {
    throw new Error("GitHub returned an invalid repository response.")
  }
  return {
    id: value.id,
    name: value.name,
    nameWithOwner: value.full_name,
    owner: value.owner.login,
    description: typeof value.description === "string" ? value.description : undefined,
    private: value.private,
    cloneUrl: value.clone_url,
    defaultBranch: value.default_branch,
    updatedAt: value.updated_at,
  }
}

function githubRequestError(response: Response) {
  if (response.status === 403) {
    return new Error("GitHub denied this request. Check the token's repository access or rate limit.")
  }
  return new Error(`GitHub request failed (${response.status}).`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
