import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { BOARD_OPEN_COMMAND, type EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { isPreviewAvailableFor, usePreviewAvailable } from "../../browser/previewRuntime";
import { m } from "../../i18n/messages";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentBoardEnabled, useServerConfigs } from "../../state/entities";
import { previewEnvironment } from "../../state/preview";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { boardEntryVisible, type BoardEntryState } from "./boardEntry.logic";

/** For menus built when they open, such as a sidebar row's. */
export function readBoardEntryState(environmentId: EnvironmentId): BoardEntryState {
  return {
    boardEnabled: readEnvironmentBoardEnabled(environmentId),
    canOpen: appAtomRegistry.get(serverEnvironment.boardOpen.permissionAtom(environmentId)),
    previewAvailable: isPreviewAvailableFor(environmentId),
    hasThread: true,
  };
}

/**
 * Opens rstack-board's own page in a thread's browser panel. The server starts the page when it
 * is not running; a remote environment's `localhost` resolves on its host, as for any server.
 * `coordinatorView` opens the channels of the thread's coordinator, when it has one.
 */
export function useOpenBoard(): (
  threadRef: ScopedThreadRef,
  options?: { readonly coordinatorView?: boolean },
) => Promise<void> {
  const gt = useGT();
  const runOpen = useAtomCommand(serverEnvironment.boardOpen, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });

  const fail = (error: unknown, serverSide: boolean) => {
    const reason = thrownErrorMessage(error, m) ?? gt("An error occurred.");
    toastManager.add({
      type: "error",
      title: gt("Could not open the board"),
      description: serverSide
        ? gt("{reason} To start its page on the server, run: {command}", {
            reason,
            command: BOARD_OPEN_COMMAND,
          })
        : reason,
    });
  };

  return async (threadRef, options) => {
    const opened = await runOpen({
      environmentId: threadRef.environmentId,
      input: options?.coordinatorView ? { threadId: threadRef.threadId } : {},
    });
    if (opened._tag === "Failure") {
      if (!isAtomCommandInterrupted(opened)) fail(squashAtomCommandFailure(opened), true);
      return;
    }
    const shown = await openUrlInPreview({
      threadRef,
      url: resolveDiscoveredServerUrl(threadRef.environmentId, opened.value.url),
      openPreview,
    });
    if (shown._tag === "Failure" && !isAtomCommandInterrupted(shown)) {
      fail(squashAtomCommandFailure(shown), false);
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
  const previewAvailable = usePreviewAvailable(environmentId);
  const openBoard = useOpenBoard();
  const state: BoardEntryState = {
    boardEnabled:
      environmentId !== null && serverConfigs.get(environmentId)?.settings.boardEnabled === true,
    canOpen,
    previewAvailable,
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
