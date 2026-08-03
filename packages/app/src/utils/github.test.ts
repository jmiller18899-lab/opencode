import { afterEach, describe, expect, test } from "bun:test"
import { createWebGitHubPlatform } from "./github"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  servers.splice(0).forEach((server) => server.stop(true))
})

describe("web GitHub platform", () => {
  test("keeps credentials in memory and imports through the selected server", async () => {
    const requests: Array<{ path: string; authorization: string; body?: unknown }> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname
        requests.push({
          path,
          authorization: request.headers.get("authorization") ?? "",
          body: request.method === "POST" ? await request.json() : undefined,
        })
        if (path === "/user") {
          return Response.json({
            login: "octocat",
            name: "The Octocat",
            avatar_url: "https://avatars.githubusercontent.com/u/583231",
          })
        }
        if (path === "/user/repos") {
          return Response.json([
            {
              id: 1,
              name: "Hello-World",
              full_name: "octocat/Hello-World",
              private: true,
              clone_url: "https://github.com/octocat/Hello-World.git",
              default_branch: "main",
              updated_at: "2026-08-03T00:00:00Z",
              description: "A test repository",
              owner: { login: "octocat" },
            },
          ])
        }
        if (path === "/api/project/import/github") {
          return Response.json({ directory: "/workspace/Hello-World" })
        }
        return new Response(undefined, { status: 404 })
      },
    })
    servers.push(server)
    const url = server.url.toString().replace(/\/$/, "")
    const github = createWebGitHubPlatform({ apiUrl: url })

    expect(await github.status()).toBeNull()
    expect(await github.connect("github_pat_abcdefghijklmnopqrstuvwxyz")).toEqual({
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      storage: "session",
    })
    expect(await github.repositories()).toEqual([
      {
        id: 1,
        name: "Hello-World",
        nameWithOwner: "octocat/Hello-World",
        owner: "octocat",
        private: true,
        cloneUrl: "https://github.com/octocat/Hello-World.git",
        defaultBranch: "main",
        updatedAt: "2026-08-03T00:00:00Z",
        description: "A test repository",
      },
    ])
    expect(
      await github.clone({
        url: "https://github.com/octocat/Hello-World.git",
        destination: "/workspace",
        server: { url, username: "opencode", password: "secret" },
      }),
    ).toBe("/workspace/Hello-World")
    expect(requests).toEqual([
      {
        path: "/user",
        authorization: "Bearer github_pat_abcdefghijklmnopqrstuvwxyz",
      },
      {
        path: "/user/repos",
        authorization: "Bearer github_pat_abcdefghijklmnopqrstuvwxyz",
      },
      {
        path: "/api/project/import/github",
        authorization: "Basic b3BlbmNvZGU6c2VjcmV0",
        body: {
          repository: "https://github.com/octocat/Hello-World.git",
          directory: "/workspace",
          token: "github_pat_abcdefghijklmnopqrstuvwxyz",
        },
      },
    ])

    await github.disconnect()
    expect(await github.status()).toBeNull()
  })

  test("refuses to send credentials to an insecure remote server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/583231",
        }),
    })
    servers.push(server)
    const github = createWebGitHubPlatform({ apiUrl: server.url.toString() })
    await github.connect("github_pat_abcdefghijklmnopqrstuvwxyz")

    await expect(
      github.clone({
        url: "https://github.com/octocat/Hello-World.git",
        destination: "/workspace",
        server: { url: "http://example.com" },
      }),
    ).rejects.toThrow("Use an HTTPS OpenCode server before sending GitHub credentials.")
  })
})
