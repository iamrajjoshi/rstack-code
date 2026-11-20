export interface BoardIdentityThread {
  readonly id: string;
  readonly title: string;
  readonly coordinator?: boolean | undefined;
}

export interface BoardIdentity {
  /** Omitted when automatic identity is off: the board then uses its own default. */
  readonly handle?: string;
  /** The coordinator whose `<coordinator>/workers` channel holds this thread's check-ins. */
  readonly coordinator?: string;
  /** Where a new board thread goes when the agent names no channel. */
  readonly channel: string;
  /** Set on every board thread the bridge creates, to find the rstack-code thread again. */
  readonly labels: { readonly t3: string; readonly env: string };
}

const MAX_TITLE_SLUG = 24;
const MAX_CHANNEL_SLUG = 40;

const slug = (text: string, max: number) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, max)
    .replace(/-+$/u, "");

// Thread ids come in several shapes (uuids, `thread:mcp:...:0`), so hash the whole id (FNV-1a).
const shortId = (id: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(-6);
};

/** `fix-flaky-search-1x9k2b`: a slug of the title and a short hash of the thread id. */
export const boardHandle = (thread: Pick<BoardIdentityThread, "id" | "title">) =>
  `${slug(thread.title, MAX_TITLE_SLUG) || "thread"}-${shortId(thread.id)}`;

/**
 * `ancestors` runs from the parent up to the root. A worker checks in under the root-most
 * coordinator above it; a coordinator with none above it checks in under itself.
 */
export const deriveBoardIdentity = (input: {
  readonly thread: BoardIdentityThread;
  readonly ancestors: ReadonlyArray<BoardIdentityThread>;
  readonly projectTitle: string | null;
  readonly environmentId: string;
  readonly settings: { readonly boardChannel: string; readonly boardAutoIdentity: boolean };
  readonly handleOf?: (thread: BoardIdentityThread) => string;
}): BoardIdentity => {
  const handleOf = input.handleOf ?? boardHandle;
  const coordinatorThread =
    input.ancestors.findLast((ancestor) => ancestor.coordinator === true) ??
    (input.thread.coordinator === true ? input.thread : undefined);
  const channel =
    input.settings.boardChannel ||
    (input.projectTitle === null ? "" : slug(input.projectTitle, MAX_CHANNEL_SLUG)) ||
    "threads";
  return {
    ...(input.settings.boardAutoIdentity
      ? {
          handle: handleOf(input.thread),
          ...(coordinatorThread === undefined ? {} : { coordinator: handleOf(coordinatorThread) }),
        }
      : {}),
    channel,
    labels: { t3: input.thread.id, env: input.environmentId },
  };
};
