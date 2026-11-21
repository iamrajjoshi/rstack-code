import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentBoardEnabled, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { boardEnvironmentIds, totalNeedsYou } from "./boardEntry.logic";

/** For menus built when they open, such as a sidebar row's. */
export function readBoardEntryState(environmentId: EnvironmentId) {
  return {
    boardEnabled: readEnvironmentBoardEnabled(environmentId),
    canOpen: appAtomRegistry.get(serverEnvironment.boardOpen.permissionAtom(environmentId)),
  };
}

export function useBoardEntryState(environmentId: EnvironmentId | null) {
  const serverConfigs = useServerConfigs();
  return {
    boardEnabled:
      environmentId !== null && serverConfigs.get(environmentId)?.settings.boardEnabled === true,
    canOpen: useAtomValue(serverEnvironment.boardOpen.permissionAtom(environmentId)),
  };
}

/** Connected environments with rstack-board turned on, which the Board page can show. */
export function useBoardEnvironments(): ReadonlyArray<{
  readonly environmentId: EnvironmentId;
  readonly label: string;
}> {
  const { environments } = useEnvironments();
  const ids = boardEnvironmentIds(
    environments.map((environment) => ({
      environmentId: environment.environmentId,
      connected: environment.connection.phase === "connected",
      boardEnabled: environment.serverConfig?.settings.boardEnabled === true,
    })),
  );
  return environments.filter((environment) => ids.includes(environment.environmentId));
}

// The subscription needs the grant the Board page does; without it there is no count to show.
const needsYouAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    if (!get(serverEnvironment.boardOpen.permissionAtom(environmentId))) return null;
    const result = get(serverEnvironment.boardNeedsYou({ environmentId, input: {} }));
    return AsyncResult.isSuccess(result) ? result.value.needsYou : null;
  }).pipe(Atom.withLabel(`board-needs-you:${environmentId}`)),
);

const needsYouTotalAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) =>
    totalNeedsYou(
      environmentIds
        .split(",")
        .filter((id) => id !== "")
        .map((id) => get(needsYouAtom(id as EnvironmentId))),
    ),
  ).pipe(Atom.withLabel(`board-needs-you-total:${environmentIds}`)),
);

/** Board threads waiting on the person in this environment; `null` while unknown. */
export function useBoardNeedsYou(environmentId: EnvironmentId): number | null {
  return useAtomValue(needsYouAtom(environmentId));
}

/** The same over these environments, re-rendering only when the total changes. */
export function useBoardNeedsYouTotal(environmentIds: ReadonlyArray<EnvironmentId>): number | null {
  return useAtomValue(needsYouTotalAtom(environmentIds.join(",")));
}

/** Opens the Board page; a coordinator's thread opens its environment's board at its channels. */
export function useOpenBoardPage(): (coordinator?: ScopedThreadRef) => Promise<void> {
  const navigate = useNavigate();
  return async (coordinator) => {
    await navigate({
      to: "/board",
      search: coordinator
        ? { boardServer: coordinator.environmentId, boardThread: coordinator.threadId }
        : {},
    });
  };
}
