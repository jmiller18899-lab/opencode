import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export class ProjectImportError extends Schema.ErrorClass<ProjectImportError>("ProjectImportError")(
  {
    name: Schema.Literal("ProjectImportError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ProjectImportGroup = HttpApiGroup.make("server.projectImport")
  .add(
    HttpApiEndpoint.post("projectImport.github", "/api/project/import/github", {
      payload: Schema.Struct({
        repository: Schema.String,
        directory: AbsolutePath,
        token: Schema.String,
      }),
      success: Schema.Struct({
        directory: AbsolutePath,
      }),
      error: ProjectImportError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.projectImport.github",
        summary: "Import a GitHub repository",
        description:
          "Clone an HTTPS GitHub repository into a new directory. The supplied token is used only for this request.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "projectImport", description: "Project import routes." }))
