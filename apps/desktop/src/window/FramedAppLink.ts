import { APP_LINK_PROTOCOL } from "@t3tools/shared/appIdentity";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";

/**
 * A plain `rstackcode://threads/<env>/<thread>` link clicked inside a page the app frames from
 * this machine's loopback, such as rstack-board's. Left alone, the frame would load it through
 * the app's own scheme and show nothing. Returns the link for the app to open, or null.
 */
export function framedAppThreadLink(input: {
  readonly url: string;
  readonly isMainFrame: boolean;
  readonly initiatorUrl: string | undefined;
}): string | null {
  if (input.isMainFrame || input.initiatorUrl === undefined) return null;
  if (!URL.canParse(input.url) || !URL.canParse(input.initiatorUrl)) return null;
  const initiator = new URL(input.initiatorUrl);
  if (initiator.protocol !== "http:" || !isLocalLoopbackHost(initiator.hostname)) return null;
  const link = new URL(input.url);
  if (!APP_LINK_PROTOCOL.test(link.protocol) || link.host !== "threads") return null;
  // Only a bare thread link: a prompt or other query from a framed page is never passed on.
  if (link.search !== "" || link.hash !== "") return null;
  return promptLinkAppPath(input.url) === null ? null : input.url;
}
