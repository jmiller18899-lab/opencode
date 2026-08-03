import { describe, expect, test } from "bun:test"
import { createWebGitHubPlatform } from "./github"

describe("web GitHub platform", () => {
  test("keeps credentials in memory and imports through the selected server", async () => {
    const requests: Array<{ path: string; authorization: string; body?: unknown }> = []
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      const headers = new Headers(init?.headers)
      requests.push({
        path: url.pathname,
        authorization: headers.get("authorization") ?? "",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (url.pathname === "/user") {
        return Response.json({
          login: "octocat",
          name: "The Octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/583231",
        })
      }
      if (url.pathname === "/user/repos") {
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
      if (url.pathname === "/api/project/import/github") {
        return Response.json({ directory: "/workspace/Hello-World" })
      }
      return new Response(undefined, { status: 404 })
    }
    const github = createWebGitHubPlatform({ apiUrl: "https://api.github.test", fetch: request })

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
        server: { url: "http://localhost:4096", username: "opencode", password: "secret" },
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
    const github = createWebGitHubPlatform({
      fetch: async () =>
        Response.json({
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/583231",
        }),
    })
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
