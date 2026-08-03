export * as ProjectImport from "./project-import"

import path from "path"
import { ChildProcess } from "effect/unstable/process"
import { Context, Effect, Layer, Schema } from "effect"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { AppProcess } from "./process"
import { makeGlobalNode } from "./effect/app-node"

export interface GitHubInput {
  readonly repository: string
  readonly directory: AbsolutePath
  readonly token: string
}

export class InvalidRepositoryError extends Schema.TaggedErrorClass<InvalidRepositoryError>()(
  "ProjectImport.InvalidRepositoryError",
  { repository: Schema.String },
) {}

export class InvalidTokenError extends Schema.TaggedErrorClass<InvalidTokenError>()(
  "ProjectImport.InvalidTokenError",
  {},
) {}

export class DestinationUnavailableError extends Schema.TaggedErrorClass<DestinationUnavailableError>()(
  "ProjectImport.DestinationUnavailableError",
  { directory: AbsolutePath },
) {}

export class DestinationExistsError extends Schema.TaggedErrorClass<DestinationExistsError>()(
  "ProjectImport.DestinationExistsError",
  { directory: AbsolutePath },
) {}

export class CloneError extends Schema.TaggedErrorClass<CloneError>()("ProjectImport.CloneError", {
  message: Schema.String,
}) {}

export type Error =
  | InvalidRepositoryError
  | InvalidTokenError
  | DestinationUnavailableError
  | DestinationExistsError
  | CloneError

export interface Interface {
  readonly github: (input: GitHubInput) => Effect.Effect<AbsolutePath, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectImport") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service

    const github = Effect.fn("ProjectImport.github")(function* (input: GitHubInput) {
      const repository = githubRepository(input.repository)
      if (!repository) return yield* new InvalidRepositoryError({ repository: input.repository })
      if (input.token.length < 20 || input.token.length > 512 || !/^[A-Za-z0-9_]+$/.test(input.token))
        return yield* new InvalidTokenError()

      const directory = AbsolutePath.make(yield* fs.resolve(input.directory))
      if (!(yield* fs.isDir(directory))) return yield* new DestinationUnavailableError({ directory })
      const target = AbsolutePath.make(path.join(directory, repository))
      if (yield* fs.existsSafe(target)) return yield* new DestinationExistsError({ directory: target })

      return yield* cloneRepository({
        repository: input.repository,
        target,
        token: input.token,
      }).pipe(
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(AppProcess.Service, appProcess),
        Effect.scoped,
      )
    })

    return Service.of({ github })
  }),
)

export const cloneRepository = Effect.fn("ProjectImport.cloneRepository")(function* (input: {
  readonly repository: string
  readonly target: AbsolutePath
  readonly token: string
}) {
  const fs = yield* FSUtil.Service
  const appProcess = yield* AppProcess.Service
  const directory = yield* fs
    .makeTempDirectoryScoped({
      directory: path.dirname(input.target),
      prefix: ".opencode-clone-",
    })
    .pipe(
      Effect.mapError(
        () =>
          new CloneError({
            message: `Failed to prepare clone destination: ${path.dirname(input.target)}`,
          }),
      ),
    )
  const checkout = path.join(directory, "checkout")
  const askpass = path.join(directory, process.platform === "win32" ? "askpass.cmd" : "askpass.sh")
  yield* fs
    .writeFileString(
      askpass,
      process.platform === "win32"
        ? '@echo off\r\necho %~1 | findstr /I "Username" >nul\r\nif %ERRORLEVEL% EQU 0 (echo x-access-token) else (echo %OPENCODE_GITHUB_TOKEN%)\r\n'
        : '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token" ;; *) printf "%s\\n" "$OPENCODE_GITHUB_TOKEN" ;; esac\n',
    )
    .pipe(
      Effect.andThen(process.platform === "win32" ? Effect.void : fs.chmod(askpass, 0o700)),
      Effect.mapError(
        () =>
          new CloneError({
            message: "Failed to prepare GitHub authentication.",
          }),
      ),
    )

  const result = yield* appProcess
    .run(
      ChildProcess.make("git", ["clone", "--", input.repository, checkout], {
        cwd: path.dirname(input.target),
        env: {
          GIT_ASKPASS: askpass,
          GIT_ASKPASS_REQUIRE: "force",
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
          OPENCODE_GITHUB_TOKEN: input.token,
        },
        extendEnv: true,
        stdin: "ignore",
      }),
      { maxErrorBytes: 64 * 1024 },
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CloneError({
            message: redact(cause.message, input.token),
          }),
      ),
    )
  if (result.exitCode !== 0) {
    return yield* new CloneError({
      message: redact(
        result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Git clone failed.",
        input.token,
      ),
    })
  }

  yield* fs.rename(checkout, input.target).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        if (yield* fs.existsSafe(input.target)) return yield* new DestinationExistsError({ directory: input.target })
        return yield* new CloneError({ message: `Failed to finish clone: ${input.target}` })
      }),
    ),
  )
  return input.target
})

export function githubRepository(value: string) {
  const url = URL.parse(value)
  if (!url) return
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
  )
    return
  return repository
}

function redact(value: string, token: string) {
  return value.replaceAll(token, "[redacted]")
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, AppProcess.node],
})
