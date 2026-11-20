import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentBoardEnabled, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { boardEnvironmentIds } from "./boardEntry.logic";

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
