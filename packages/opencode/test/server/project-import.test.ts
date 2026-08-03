import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const it = testEffect(httpApiLayer)

describe("project import endpoint", () => {
  it.live("rejects invalid repositories without exposing credentials", () =>
    Effect.gen(function* () {
      const token = "github_pat_abcdefghijklmnopqrstuvwxyz"
      const response = yield* request("/api/project/import/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repository: "https://example.com/octocat/Hello-World.git",
          directory: "/tmp",
          token,
        }),
      })
      const body = yield* response.json.pipe(Effect.map((value) => value as { data: { message: string } }))

      expect(response.status).toBe(400)
      expect(body.data.message).toBe("OpenCode can only clone HTTPS repositories from GitHub.")
      expect(JSON.stringify(body)).not.toContain(token)
    }),
  )

  it.live("rejects missing destination folders before cloning", () =>
    Effect.gen(function* () {
      const response = yield* request("/api/project/import/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repository: "https://github.com/octocat/Hello-World.git",
          directory: "/path/that/does/not/exist",
          token: "github_pat_abcdefghijklmnopqrstuvwxyz",
        }),
      })
      const body = yield* response.json.pipe(Effect.map((value) => value as { data: { message: string } }))

      expect(response.status).toBe(400)
      expect(body.data.message).toContain("Choose an existing destination folder")
    }),
  )
})
