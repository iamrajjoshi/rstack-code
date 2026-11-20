import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { BOARD_OPEN_COMMAND, type EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import {
  browserReachesEnvironmentLoopback,
  resolveDiscoveredServerUrl,
  resolveExternalServerUrl,
} from "../../browser/browserTargetResolver";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { isPreviewAvailableFor, previewRuntimeFor } from "../../browser/previewRuntime";
import { m } from "../../i18n/messages";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentBoardEnabled, useServerConfigs } from "../../state/entities";
import { previewEnvironment } from "../../state/preview";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { boardEntryVisible, type BoardEntryState, boardOpenTarget } from "./boardEntry.logic";

/** For menus built when they open, such as a sidebar row's. */
export function readBoardEntryState(environmentId: EnvironmentId): BoardEntryState {
  return {
    boardEnabled: readEnvironmentBoardEnabled(environmentId),
    canOpen: appAtomRegistry.get(serverEnvironment.boardOpen.permissionAtom(environmentId)),
    hasThread: true,
  };
}

/**
 * Opens rstack-board's own page: in a thread's browser panel, else in a new tab when this
 * browser reaches the server's localhost, else it shows the address. The server starts the page
 * when it is not running. Every outcome shows something: a progress toast becomes the result.
 * `coordinatorView` opens the channels of the thread's coordinator, when it has one.
 */
export function useOpenBoard(): (
  threadRef: ScopedThreadRef,
  options?: { readonly coordinatorView?: boolean },
) => Promise<void> {
  const gt = useGT();
  const runOpen = useAtomCommand(serverEnvironment.boardOpen, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });

  const failure = (
    result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  ) =>
    isAtomCommandInterrupted(result)
      ? gt("The request was interrupted before the board answered.")
      : (thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."));

  return async (threadRef, options) => {
    const { environmentId } = threadRef;
    const target = boardOpenTarget({
      previewAvailable: isPreviewAvailableFor(environmentId),
      reachesServerLoopback: browserReachesEnvironmentLoopback(environmentId),
    });
    // Reserved now: browsers block a tab opened after the request returns.
    const pendingTab = target === "tab" ? window.open("", "_blank") : null;
    if (pendingTab) pendingTab.opener = null;
    const toastId = toastManager.add({
      type: "loading",
      title: gt("Opening the board…"),
      timeout: 0,
      data: { hideCopyButton: true },
    });
    const fail = (reason: string, serverSide: boolean) => {
      pendingTab?.close();
      toastManager.update(toastId, {
        type: "error",
        title: gt("Could not open the board"),
        description: serverSide
          ? gt("{reason} To start its page on the server, run: {command}", {
              reason,
              command: BOARD_OPEN_COMMAND,
            })
          : reason,
        timeout: undefined,
        data: { hideCopyButton: false },
      });
    };
    try {
      const opened = await runOpen({
        environmentId,
        input: options?.coordinatorView ? { threadId: threadRef.threadId } : {},
      });
      if (opened._tag === "Failure") return fail(failure(opened), true);
      const url = opened.value.url;
      if (target === "panel") {
        const shown = await openUrlInPreview({
          threadRef,
          // A server-side browser loads the server's own localhost.
          url:
            previewRuntimeFor(environmentId) === "server"
              ? url
              : resolveDiscoveredServerUrl(environmentId, url),
          openPreview,
        });
        if (shown._tag === "Failure") return fail(failure(shown), false);
        toastManager.close(toastId);
        return;
      }
      if (pendingTab) {
        pendingTab.location.href = resolveExternalServerUrl(environmentId, url);
        toastManager.close(toastId);
        return;
      }
      toastManager.update(toastId, {
        type: "info",
        title: gt("The board is running on the server"),
        description:
          target === "tab"
            ? gt("This browser blocked the new tab. Open {url} yourself.", { url })
            : gt(
                "Its page is at {url} on the server's machine, which this browser cannot reach. Open it from the desktop app, or forward the port to this machine.",
                { url },
              ),
        timeout: undefined,
        data: { hideCopyButton: false },
      });
    } catch (error) {
      fail(thrownErrorMessage(error, m) ?? gt("An error occurred."), false);
    }
  };
}

/** The sidebar's Board button and the command palette's Open board, for the thread on screen. */
export function useBoardEntry(threadRef: ScopedThreadRef | null): {
  readonly state: BoardEntryState;
  readonly visible: boolean;
  readonly open: (options?: { readonly coordinatorView?: boolean }) => Promise<void>;
} {
  const environmentId = threadRef?.environmentId ?? null;
  const serverConfigs = useServerConfigs();
  const canOpen = useAtomValue(serverEnvironment.boardOpen.permissionAtom(environmentId));
  const openBoard = useOpenBoard();
  const state: BoardEntryState = {
    boardEnabled:
      environmentId !== null && serverConfigs.get(environmentId)?.settings.boardEnabled === true,
    canOpen,
    hasThread: threadRef !== null,
  };
  return {
    state,
    visible: boardEntryVisible(state),
    open: async (options) => {
      if (threadRef !== null) await openBoard(threadRef, options);
    },
  };
}
