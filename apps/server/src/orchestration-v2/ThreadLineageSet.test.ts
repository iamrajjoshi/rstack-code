import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for lineage changes"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "thread-lineage-set" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const projectId = ProjectId.make("project:thread-lineage-set");

it.effect("nests threads under a parent, follows the root, and refuses cycles", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const [coordinator, worker, grandchild] = ["coordinator", "worker", "grandchild"].map((name) =>
      ThreadId.make(`thread:lineage:${name}`),
    ) as [ThreadId, ThreadId, ThreadId];
    for (const threadId of [coordinator, worker, grandchild]) {
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`create:${threadId}`),
        threadId,
        projectId,
        title: threadId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
    }
    const nest = (threadId: ThreadId, parentThreadId: ThreadId, suffix = "") =>
      orchestrator.dispatch({
        type: "thread.lineage.set",
        commandId: CommandId.make(`nest:${threadId}:${parentThreadId}${suffix}`),
        threadId,
        parentThreadId,
      });

    yield* nest(worker, coordinator);
    yield* nest(grandchild, worker);
    const nested = yield* projections.getThread(grandchild);
    assert.deepStrictEqual(nested.lineage, {
      parentThreadId: worker,
      relationshipToParent: "subagent",
      rootThreadId: coordinator,
    });

    const sequence = yield* orchestrator.getThreadEventSequence(worker);
    yield* nest(worker, coordinator, ":again");
    assert.strictEqual(yield* orchestrator.getThreadEventSequence(worker), sequence);

    const cycle = yield* Effect.flip(nest(coordinator, grandchild));
    assert.strictEqual(cycle._tag, "OrchestratorDispatchError");
    assert.include(String("cause" in cycle ? cycle.cause : ""), "cycle");
    assert.strictEqual((yield* projections.getThread(coordinator)).lineage.parentThreadId, null);
  }).pipe(Effect.provide(layerTest)),
);
