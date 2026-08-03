import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cloneGitRepository, createGitHubService, type GitHubToken, type GitHubTokenStore } from "./github"

const servers: Array<ReturnType<typeof Bun.serve>> = []
const directories: string[] = []

afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("GitHub desktop service", () => {
  test("connects an account and lists its repositories", async () => {
    const authorization: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        authorization.push(request.headers.get("authorization") ?? "")
        if (new URL(request.url).pathname === "/user") {
          return Response.json({
            login: "octocat",
            name: "The Octocat",
            avatar_url: "https://avatars.githubusercontent.com/u/583231",
          })
        }
        return Response.json([
          {
            id: 1,
            name: "hello-world",
            full_name: "octocat/hello-world",
            private: true,
            clone_url: "https://github.com/octocat/hello-world.git",
            default_branch: "main",
            updated_at: "2026-08-03T00:00:00Z",
            description: "A test repository",
            owner: { login: "octocat" },
          },
        ])
      },
    })
    servers.push(server)
    const tokens = memoryTokenStore()
    const github = createGitHubService({
      tokens,
      apiUrl: server.url.toString().replace(/\/$/, ""),
    })

    expect(await github.status()).toBeNull()
    expect(await github.connect("github_pat_abcdefghijklmnopqrstuvwxyz")).toEqual({
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      storage: "persistent",
    })
    expect(await github.repositories()).toEqual([
      {
        id: 1,
        name: "hello-world",
        nameWithOwner: "octocat/hello-world",
        owner: "octocat",
        private: true,
        cloneUrl: "https://github.com/octocat/hello-world.git",
        defaultBranch: "main",
        updatedAt: "2026-08-03T00:00:00Z",
        description: "A test repository",
      },
    ])
    expect(authorization).toEqual([
      "Bearer github_pat_abcdefghijklmnopqrstuvwxyz",
      "Bearer github_pat_abcdefghijklmnopqrstuvwxyz",
    ])

    github.disconnect()
    expect(await github.status()).toBeNull()
  })

  test("rejects non-GitHub clone URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-github-test-"))
    directories.push(root)
    const tokens = memoryTokenStore()
    tokens.set("github_pat_abcdefghijklmnopqrstuvwxyz")
    const github = createGitHubService({ tokens })

    await expect(
      github.clone({ url: "https://example.com/octocat/hello-world.git", destination: root }),
    ).rejects.toThrow("OpenCode can only clone HTTPS repositories from GitHub.")
  })
})

test("cloneGitRepository clones into a clean target", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-github-test-"))
  directories.push(root)
  const source = join(root, "source")
  const target = join(root, "clone")
  execFileSync("git", ["init", source])
  await Bun.write(join(source, "README.md"), "hello from github\n")
  execFileSync("git", ["-C", source, "add", "README.md"])
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=OpenCode",
    "-c",
    "user.email=test@opencode.ai",
    "commit",
    "-m",
    "init",
  ])

  await cloneGitRepository({
    url: source,
    target,
    token: "github_pat_not_exposed",
  })

  expect(await Bun.file(join(target, "README.md")).text()).toBe("hello from github\n")
  expect(execFileSync("git", ["-C", target, "remote", "get-url", "origin"], { encoding: "utf8" }).trim()).toBe(source)
})

function memoryTokenStore(): GitHubTokenStore {
  let token: GitHubToken | undefined
  return {
    get: () => token,
    set: (value) => (token = { value, persistent: true }),
    delete: () => {
      token = undefined
    },
  }
}
