import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { ForwardLocality } from "../../state/portForwards";

/** A coordinator's Open on board, which shows the channels of that coordinator's workers. */
export function openOnBoardVisible(state: {
  /** The thread's environment has rstack-board turned on in its settings. */
  readonly boardEnabled: boolean;
  /** This connection may open the board there. */
  readonly canOpen: boolean;
  readonly coordinator: boolean;
}): boolean {
  return state.coordinator && state.boardEnabled && state.canOpen;
}

export interface BoardEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly boardEnabled: boolean;
}

/** Environments the Board page can show, in the order given; the footer shows Board when any. */
export function boardEnvironmentIds(
  candidates: ReadonlyArray<BoardEnvironmentCandidate>,
): ReadonlyArray<EnvironmentId> {
  return candidates
    .filter((candidate) => candidate.connected && candidate.boardEnabled)
    .map((candidate) => candidate.environmentId);
}

/** Threads waiting on the person over these environments; `null` when none reports a count. */
export function totalNeedsYou(counts: ReadonlyArray<number | null>): number | null {
  const known = counts.filter((count) => count !== null);
  return known.length === 0 ? null : known.reduce((sum, count) => sum + count, 0);
}

/** The footer badge's text: none at 0 or without a count, capped at 99+. */
export function needsYouBadgeText(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * The environment whose board the page shows: the one a link asked for, else the one this device
 * chose last, else the last open thread's, else the first. Each only while it has the board.
 */
export function chooseBoardEnvironment(input: {
  readonly available: ReadonlyArray<EnvironmentId>;
  readonly requested: EnvironmentId | undefined;
  readonly remembered: EnvironmentId | null;
  readonly lastThread: EnvironmentId | null;
}): EnvironmentId | null {
  const candidates = [input.requested, input.remembered, input.lastThread];
  return (
    candidates.find((id) => id != null && input.available.includes(id)) ??
    input.available[0] ??
    null
  );
}

/**
 * How this client shows the board's page, which listens on the server machine's loopback:
 * `direct` when this client's own localhost is that machine's; `forward` when the desktop app
 * forwards the port here first; `locating` while the desktop is still telling whether the
 * environment runs on this computer; `address` when nothing here can reach it.
 */
export type BoardEmbed = "direct" | "forward" | "locating" | "address";

export function boardEmbed(input: {
  /** The desktop app reaches this environment through its tunnel and can forward its ports. */
  readonly canForward: boolean;
  readonly locality: ForwardLocality;
  /** This client loads the environment's localhost itself. */
  readonly reachesLoopback: boolean;
}): BoardEmbed {
  if (!input.canForward) return input.reachesLoopback ? "direct" : "address";
  if (input.locality === "local") return "direct";
  return input.locality === "pending" ? "locating" : "forward";
}

/** The port the board's page listens on, which a forward carries. */
export function boardPort(url: string): number {
  const parsed = new URL(url);
  return Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
}

/**
 * The board's address with `?theme=` set to the app's appearance, which the board's page uses
 * for that tab instead of the browser's `prefers-color-scheme`. Its `#/...` route is kept.
 */
export function boardUrlWithTheme(url: string, appearance: "light" | "dark"): string {
  const themed = new URL(url);
  themed.searchParams.set("theme", appearance);
  return themed.toString();
}

/**
 * `boardServer` and `boardThread` rather than generic names: the router merges every route's
 * search into one type for `navigate`. `boardThread` opens that coordinator's channels.
 */
export interface BoardSearch {
  readonly boardServer?: EnvironmentId | undefined;
  readonly boardThread?: ThreadId | undefined;
}

const bounded = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;

// Every key is an own key, even when undefined: the router lays these over the parent route's
// unvalidated search, where a key left out would keep its raw value.
export const boardSearchFromUrl = (raw: Record<string, unknown>): BoardSearch => ({
  boardServer: bounded(raw.boardServer) as EnvironmentId | undefined,
  boardThread: bounded(raw.boardThread) as ThreadId | undefined,
});
