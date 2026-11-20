import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardService from "./BoardService.ts";
import { type BoardIdentity, boardHandle, deriveBoardIdentity } from "./boardIdentity.ts";

const MAX_ANCESTORS = 8;
const MAX_HANDLES = 1_000;
const MAX_REPLIES = 20;
const MAX_ROOT_CHARS = 4_000;
const MAX_REPLY_CHARS = 1_500;
const MAX_PREVIEW_CHARS = 280;

// The board validates channels, ids and labels itself; every positional follows `--`.
export const BoardChannel = Schema.String.check(Schema.isMaxLength(120));
export const BoardMessageId = Schema.String.check(Schema.isMaxLength(80));
export const BoardLabelKey = Schema.String.check(Schema.isMaxLength(40));
export const BoardLabelMap = Schema.Record(
  BoardLabelKey,
  Schema.String.check(Schema.isMaxLength(200)),
);
export const BoardText = Schema.String.check(Schema.isMaxLength(8_000));
export const BoardNeeds = Schema.Literals([
  "approval",
  "decision",
  "action",
  "confirmation",
  "answer",
]);
export const BoardCheckinStatus = Schema.Literals(["working", "needs_input", "done"]);
export const BoardTaskOutcome = Schema.Literals(["done", "failed", "released"]);
export const BoardLabelFilter = Schema.String.check(Schema.isMaxLength(120));

export const BoardMessageView = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
});
export const BoardThreadSummaryView = Schema.Struct({
  id: Schema.String,
  channel: Schema.String,
  title: Schema.String,
  labels: Schema.Record(Schema.String, Schema.String),
  replyCount: Schema.Number,
  updatedAt: Schema.String,
  last: BoardMessageView,
});
export const BoardThreadView = Schema.Struct({
  id: Schema.String,
  channel: Schema.String,
  title: Schema.String,
  labels: Schema.Record(Schema.String, Schema.String),
  message: BoardMessageView,
  replies: Schema.Array(BoardMessageView),
  omittedReplies: Schema.optionalKey(Schema.Number),
});

export interface BoardCaller {
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
}

export class BoardCallerNotFoundError extends Schema.TaggedError<BoardCallerNotFoundError>()(
  "BoardCallerNotFoundError",
  { threadId: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class BoardRequestError extends Schema.TaggedError<BoardRequestError>()(
  "BoardRequestError",
  { problem: Schema.Literals(["no_labels", "no_task"]) },
) {
  override get message(): string {
    return this.problem === "no_labels"
      ? "Pass `set`, `unset`, or both."
      : "Pass `id`, or `channel` to take its oldest ready task.";
  }
}

export type BoardBridgeError =
  | BoardService.BoardError
  | BoardCallerNotFoundError
  | BoardRequestError;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const messageView = (message: BoardService.BoardMessage, max: number) => ({
  id: message.id,
  author: message.author,
  text: cut(message.text, max),
  createdAt: message.createdAt,
});

const summaryView = (thread: BoardService.BoardThreadSummary) => ({
  id: thread.id,
  channel: thread.channel,
  title: cut(thread.title, 200),
  labels: thread.labels,
  replyCount: thread.replyCount,
  updatedAt: thread.updatedAt,
  last: messageView(thread.last, MAX_PREVIEW_CHARS),
});

const threadView = (thread: BoardService.BoardThread) => {
  const omitted = Math.max(0, thread.replies.length - MAX_REPLIES);
  return {
    id: thread.id,
    channel: thread.channel,
    title: cut(thread.title, 200),
    labels: thread.labels,
    message: messageView(thread.message, MAX_ROOT_CHARS),
    replies: thread.replies.slice(omitted).map((reply) => messageView(reply, MAX_REPLY_CHARS)),
    ...(omitted === 0 ? {} : { omittedReplies: omitted }),
  };
};

const labelArgs = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);

/** Acts on the board as an rstack-code thread: identity, channel and trace labels come from it. */
export class BoardBridge extends Context.Service<
  BoardBridge,
  {
    readonly identity: (caller: BoardCaller) => Effect.Effect<BoardIdentity, BoardBridgeError>;
    readonly checkin: (
      caller: BoardCaller,
      input: {
        readonly status: typeof BoardCheckinStatus.Type;
        readonly note: string;
        readonly needs?: typeof BoardNeeds.Type | undefined;
        readonly pr?: number | undefined;
        readonly branch?: string | undefined;
      },
    ) => Effect.Effect<
      { readonly id: string; readonly channel: string; readonly labels: Record<string, string> },
      BoardBridgeError
    >;
    readonly post: (
      caller: BoardCaller,
      input: {
        readonly text: string;
        readonly channel?: string | undefined;
        readonly needs?: typeof BoardNeeds.Type | undefined;
        readonly labels?: Readonly<Record<string, string>> | undefined;
      },
    ) => Effect.Effect<{ readonly id: string; readonly channel: string }, BoardBridgeError>;
    readonly reply: (
      caller: BoardCaller,
      input: { readonly id: string; readonly text: string },
    ) => Effect.Effect<{ readonly id: string; readonly threadId: string }, BoardBridgeError>;
    readonly read: (
      caller: BoardCaller,
      input: {
        readonly target?: string | undefined;
        readonly label?: string | undefined;
        readonly limit?: number | undefined;
      },
    ) => Effect.Effect<
      | { readonly thread: typeof BoardThreadView.Type }
      | { readonly threads: ReadonlyArray<typeof BoardThreadSummaryView.Type> },
      BoardBridgeError
    >;
    readonly label: (
      caller: BoardCaller,
      input: {
        readonly id: string;
        readonly set?: Readonly<Record<string, string>> | undefined;
        readonly unset?: ReadonlyArray<string> | undefined;
      },
    ) => Effect.Effect<{ readonly labels: Record<string, string> }, BoardBridgeError>;
    readonly claim: (
      caller: BoardCaller,
      input: { readonly id?: string | undefined; readonly channel?: string | undefined },
    ) => Effect.Effect<typeof BoardThreadView.Type, BoardBridgeError>;
    readonly complete: (
      caller: BoardCaller,
      input: {
        readonly id: string;
        readonly outcome?: typeof BoardTaskOutcome.Type | undefined;
        readonly result?: string | undefined;
      },
    ) => Effect.Effect<
      { readonly id: string; readonly labels: Record<string, string> },
      BoardBridgeError
    >;
  }
>()("t3/board/BoardBridge") {}

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  // A thread keeps the handle it first posted under, though its title changes later.
  const handles = new Map<string, string>();
  const handleOf = (thread: { readonly id: string; readonly title: string }) => {
    const known = handles.get(thread.id);
    if (known !== undefined) return known;
    if (handles.size >= MAX_HANDLES) handles.clear();
    const handle = boardHandle(thread);
    handles.set(thread.id, handle);
    return handle;
  };

  const shell = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.mapError((cause) => new BoardCallerNotFoundError({ threadId, cause })),
      Effect.filterOrFail(
        (found): found is OrchestrationV2ThreadShell => found !== null && found.deletedAt === null,
        () => new BoardCallerNotFoundError({ threadId }),
      ),
    );

  const identity = Effect.fn("BoardBridge.identity")(function* (caller: BoardCaller) {
    const thread = yield* shell(caller.threadId);
    const ancestors: Array<OrchestrationV2ThreadShell> = [];
    let current = thread;
    while (
      current.lineage.relationshipToParent === "subagent" &&
      current.lineage.parentThreadId !== null &&
      ancestors.length < MAX_ANCESTORS
    ) {
      const parent = yield* shell(current.lineage.parentThreadId).pipe(Effect.option);
      if (Option.isNone(parent)) break;
      ancestors.push(parent.value);
      current = parent.value;
    }
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    const settings = yield* settingsService.getSettings;
    return deriveBoardIdentity({
      thread,
      ancestors,
      projectTitle: Option.isSome(project) ? project.value.title : null,
      environmentId: caller.environmentId,
      settings,
      handleOf,
    });
  });

  const traceLabels = (who: BoardIdentity) => ({ t3: who.labels.t3, env: who.labels.env });

  const checkin = Effect.fn("BoardBridge.checkin")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["checkin"]>[1],
  ) {
    const who = yield* identity(caller);
    const state =
      input.status === "working" ? "working" : input.status === "done" ? "done" : "blocked";
    const thread = yield* board.run(
      {
        args: [
          "checkin",
          "--file",
          "-",
          "--state",
          state,
          ...(who.coordinator === undefined ? [] : ["--coordinator", who.coordinator]),
          ...(input.status === "needs_input" ? ["--needs", input.needs ?? "answer"] : []),
          ...(input.status === "needs_input" ? [] : ["--unset", "needs"]),
          ...(input.pr === undefined ? [] : ["--pr", String(input.pr)]),
          ...labelArgs({
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            ...traceLabels(who),
          }),
        ],
        as: who.handle,
        stdin: input.note,
        threadId: caller.threadId,
      },
      BoardService.BoardThreadSummary,
    );
    return { id: thread.id, channel: thread.channel, labels: thread.labels };
  });

  const post = Effect.fn("BoardBridge.post")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["post"]>[1],
  ) {
    const who = yield* identity(caller);
    const channel = input.channel ?? who.channel;
    const message = yield* board.run(
      {
        args: [
          "post",
          "--file",
          "-",
          ...labelArgs({
            ...input.labels,
            ...(input.needs === undefined ? {} : { needs: input.needs }),
            ...traceLabels(who),
          }),
          "--",
          channel,
        ],
        as: who.handle,
        stdin: input.text,
        threadId: caller.threadId,
      },
      BoardService.BoardMessage,
    );
    return { id: message.id, channel: message.channel };
  });

  const reply = Effect.fn("BoardBridge.reply")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["reply"]>[1],
  ) {
    const who = yield* identity(caller);
    const message = yield* board.run(
      {
        args: ["reply", "--file", "-", "--", input.id],
        as: who.handle,
        stdin: input.text,
        threadId: caller.threadId,
      },
      BoardService.BoardMessage,
    );
    return { id: message.id, threadId: message.threadId };
  });

  const read = Effect.fn("BoardBridge.read")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["read"]>[1],
  ) {
    if (input.target?.startsWith("msg_") === true) {
      const thread = yield* board.run(
        { args: ["read", "--", input.target], threadId: caller.threadId },
        BoardService.BoardThread,
      );
      return { thread: threadView(thread) };
    }
    const { threads: found } = yield* board.run(
      {
        args: [
          "read",
          "-n",
          String(input.limit ?? 20),
          ...(input.label === undefined ? [] : ["--label", input.label]),
          ...(input.target === undefined ? [] : ["--", input.target]),
        ],
        threadId: caller.threadId,
      },
      BoardService.BoardThreadList,
    );
    return { threads: found.map(summaryView) };
  });

  const label = Effect.fn("BoardBridge.label")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["label"]>[1],
  ) {
    const set = Object.entries(input.set ?? {});
    const unset = input.unset ?? [];
    if (set.length === 0 && unset.length === 0) {
      return yield* new BoardRequestError({ problem: "no_labels" });
    }
    const who = yield* identity(caller);
    return yield* board.run(
      {
        args: [
          "label",
          ...unset.flatMap((key) => ["--unset", key]),
          "--",
          input.id,
          ...set.map(([key, value]) => `${key}=${value}`),
        ],
        as: who.handle,
        threadId: caller.threadId,
      },
      BoardService.BoardLabels,
    );
  });

  const claim = Effect.fn("BoardBridge.claim")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["claim"]>[1],
  ) {
    const target =
      input.id !== undefined
        ? ["--", input.id]
        : input.channel !== undefined
          ? ["--ready", input.channel]
          : undefined;
    if (target === undefined) return yield* new BoardRequestError({ problem: "no_task" });
    const who = yield* identity(caller);
    const thread = yield* board.run(
      { args: ["tasks", "claim", ...target], as: who.handle, threadId: caller.threadId },
      BoardService.BoardThread,
    );
    return threadView(thread);
  });

  const complete = Effect.fn("BoardBridge.complete")(function* (
    caller: BoardCaller,
    input: Parameters<BoardBridge["Service"]["complete"]>[1],
  ) {
    const who = yield* identity(caller);
    const verb =
      input.outcome === "failed" ? "fail" : input.outcome === "released" ? "release" : "complete";
    const thread = yield* board.run(
      {
        args: [
          "tasks",
          verb,
          "--",
          input.id,
          ...(input.result === undefined ? [] : [input.result]),
        ],
        as: who.handle,
        threadId: caller.threadId,
      },
      BoardService.BoardThreadSummary,
    );
    return { id: thread.id, labels: thread.labels };
  });

  return BoardBridge.of({ identity, checkin, post, reply, read, label, claim, complete });
});

export const layer = Layer.effect(BoardBridge, make);
