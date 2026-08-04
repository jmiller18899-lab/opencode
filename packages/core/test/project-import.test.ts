import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectImport } from "@opencode-ai/core/project-import"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, AppProcess.node])))

describe("ProjectImport", () => {
  test("accepts only HTTPS GitHub repository URLs", () => {
    expect(ProjectImport.githubRepository("https://github.com/octocat/Hello-World.git")).toBe("Hello-World")
    expect(ProjectImport.githubRepository("https://github.com/octocat/Hello-World")).toBe("Hello-World")
    expect(ProjectImport.githubRepository("git@github.com:octocat/Hello-World.git")).toBeUndefined()
    expect(ProjectImport.githubRepository("https://example.com/octocat/Hello-World.git")).toBeUndefined()
    expect(ProjectImport.githubRepository("https://token@github.com/octocat/Hello-World.git")).toBeUndefined()
  })

  it.live("clones through an ephemeral credential helper", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), "opencode-project-import-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const source = path.join(root, "source")
      const target = AbsolutePath.make(path.join(root, "clone"))
      execFileSync("git", ["init", source])
      yield* Effect.promise(() => Bun.write(path.join(source, "README.md"), "hello from the PWA\n"))
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

      yield* ProjectImport.cloneRepository({
        repository: source,
        target,
        token: "github_pat_not_exposed",
      })

      expect(yield* Effect.promise(() => Bun.file(path.join(target, "README.md")).text())).toBe("hello from the PWA\n")
      expect(execFileSync("git", ["-C", target, "remote", "get-url", "origin"], { encoding: "utf8" }).trim()).toBe(
        source,
      )
    }),
  )
})
