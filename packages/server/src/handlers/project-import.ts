import { ProjectImport } from "@opencode-ai/core/project-import"
import { ProjectImportError } from "@opencode-ai/protocol/groups/project-import"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ProjectImportHandler = HttpApiBuilder.group(Api, "server.projectImport", (handlers) =>
  Effect.gen(function* () {
    const projectImport = yield* ProjectImport.Service

    return handlers.handle("projectImport.github", (ctx) =>
      projectImport.github(ctx.payload).pipe(
        Effect.map((directory) => ({ directory })),
        Effect.mapError(
          (error) =>
            new ProjectImportError({
              name: "ProjectImportError",
              data: { message: message(error) },
            }),
        ),
      ),
    )
  }),
)

function message(error: ProjectImport.Error) {
  if (error instanceof ProjectImport.InvalidRepositoryError)
    return "OpenCode can only clone HTTPS repositories from GitHub."
  if (error instanceof ProjectImport.InvalidTokenError) return "Enter a valid GitHub personal access token."
  if (error instanceof ProjectImport.DestinationUnavailableError)
    return `Choose an existing destination folder: ${error.directory}`
  if (error instanceof ProjectImport.DestinationExistsError)
    return `A folder already exists at this destination: ${error.directory}`
  return error.message
}
