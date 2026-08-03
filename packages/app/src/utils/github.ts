import type { GitHubAccount, GitHubPlatform, GitHubRepository } from "@/context/platform"
import { authTokenFromCredentials } from "./server"

type Options = {
  apiUrl?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export function createWebGitHubPlatform(options: Options = {}): GitHubPlatform {
  const request = options.fetch ?? fetch
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "")
  let token: string | undefined
  let current: GitHubAccount | null = null

  const github = async (path: string, value: string) =>
    request(`${apiUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${value}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    })

  const repositories = async (value: string, page = 1): Promise<GitHubRepository[]> => {
    const response = await github(
      `/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&per_page=100&sort=updated&page=${page}`,
      value,
    )
    if (response.status === 401) {
      token = undefined
      current = null
      throw new Error("Your GitHub connection has expired. Connect your account again.")
    }
    if (!response.ok) throw githubRequestError(response)
    const items = githubRepositories(await response.json())
    if (items.length < 100) return items
    return items.concat(await repositories(value, page + 1))
  }

  return {
    status: async () => current,
    async connect(input) {
      const value = input.trim()
      if (value.length < 20 || value.length > 512 || !/^[A-Za-z0-9_]+$/.test(value)) {
        throw new Error("Enter a valid GitHub personal access token.")
      }
      const response = await github("/user", value)
      if (response.status === 401) throw new Error("GitHub rejected this token. Check its access and try again.")
      if (!response.ok) throw githubRequestError(response)
      token = value
      current = githubAccount(await response.json())
      return current
    },
    async disconnect() {
      token = undefined
      current = null
    },
    async repositories() {
      if (!token) throw new Error("Connect GitHub before loading repositories.")
      return repositories(token)
    },
    canClone: (server) => server.type === "http",
    async clone(input) {
      if (!token) throw new Error("Connect GitHub before cloning a repository.")
      if (!secureServer(input.server.url)) {
        throw new Error("Use an HTTPS OpenCode server before sending GitHub credentials.")
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (input.server.password) {
        headers.Authorization = `Basic ${authTokenFromCredentials({
          username: input.server.username,
          password: input.server.password,
        })}`
      }
      const response = await request(new URL("/api/project/import/github", input.server.url), {
        method: "POST",
        headers,
        body: JSON.stringify({
          repository: input.url,
          directory: input.destination,
          token,
        }),
      })
      const result: unknown = await response.json()
      if (!response.ok) {
        if (record(result) && record(result.data) && typeof result.data.message === "string") {
          throw new Error(result.data.message)
        }
        throw new Error(`OpenCode server request failed (${response.status}).`)
      }
      if (!record(result) || typeof result.directory !== "string") {
        throw new Error("OpenCode returned an invalid project import response.")
      }
      return result.directory
    },
  }
}

function secureServer(value: string) {
  const url = URL.parse(value)
  if (!url) return false
  if (url.protocol === "https:") return true
  if (url.protocol !== "http:") return false
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
}

function githubAccount(value: unknown): GitHubAccount {
  if (!record(value) || typeof value.login !== "string" || typeof value.avatar_url !== "string") {
    throw new Error("GitHub returned an invalid account response.")
  }
  return {
    login: value.login,
    name: typeof value.name === "string" ? value.name : undefined,
    avatarUrl: value.avatar_url,
    storage: "session",
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
