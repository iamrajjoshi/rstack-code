import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  requiredScopesForProjectMutation,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { traceLocalHandlerWork } from "../cloud/traceRelayRequest.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as AgentSessionImporter from "./AgentSessionImporter.ts";
import * as ProjectCloneTracker from "./ProjectCloneTracker.ts";
import * as ProjectService from "./ProjectService.ts";
import { mutateProjectWithClone } from "./ProjectMutation.ts";

const failProjectMutation = Effect.fn("environment.projects.failMutation")(function* (
  cause: ProjectService.ProjectServiceError | ServerRuntimeStartup.ServerRuntimeStartupError,
) {
  if (
    cause._tag === "ProjectNotFoundError" ||
    cause._tag === "ProjectConflictError" ||
    cause._tag === "ProjectNotEmptyError" ||
    cause._tag === "ProjectInvalidError"
  ) {
    return yield* failEnvironmentInvalidRequest("invalid_command");
  }
  return yield* failEnvironmentInternal("project_mutation_failed", cause);
});

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "projects",
  Effect.fnUntraced(function* (handlers) {
    const projects = yield* ProjectService.ProjectService;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    const projectClones = yield* ProjectCloneTracker.ProjectCloneTracker;
    const agentSessionImporter = yield* AgentSessionImporter.AgentSessionImporter;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.projects.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projects.snapshot.pipe(
            traceLocalHandlerWork,
            Effect.catch((cause) => failEnvironmentInternal("project_snapshot_failed", cause)),
          );
        }),
      )
      .handle(
        "mutate",
        Effect.fn("environment.projects.mutate")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          for (const scope of requiredScopesForProjectMutation(args.payload)) {
            yield* requireEnvironmentScope(scope);
          }
          const operation = mutateProjectWithClone(projects, projectClones, args.payload);
          return yield* startup
            .enqueueCommand(operation)
            .pipe(traceLocalHandlerWork, Effect.catch(failProjectMutation));
        }),
      )
      .handle(
        "importAgentSessions",
        Effect.fn("environment.projects.importAgentSessions")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* agentSessionImporter.importRecentAgentThreads(args.payload).pipe(
            traceLocalHandlerWork,
            Effect.catchTags({
              AgentSessionImportProjectNotFoundError: () =>
                failEnvironmentInvalidRequest("invalid_command"),
              AgentSessionImportProjectChangedError: () =>
                failEnvironmentInvalidRequest("invalid_command"),
            }),
            Effect.catch((cause) => failEnvironmentInternal("project_mutation_failed", cause)),
          );
        }),
      )
      .handle(
        "applyClaudeSessionTree",
        Effect.fn("environment.projects.applyClaudeSessionTree")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* agentSessionImporter.applyClaudeSessionTree(args.payload).pipe(
            traceLocalHandlerWork,
            Effect.catch((cause) => failEnvironmentInternal("project_mutation_failed", cause)),
          );
        }),
      );
  }),
);
