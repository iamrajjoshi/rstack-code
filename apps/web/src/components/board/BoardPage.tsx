import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  BOARD_OPEN_COMMAND,
  type BoardStatus,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ExternalLinkIcon, MessagesSquareIcon, RotateCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { browserReachesEnvironmentLoopback } from "../../browser/browserTargetResolver";
import { isElectron } from "../../env";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { m } from "../../i18n/messages";
import { readLocalApi } from "../../localApi";
import { useEnvironment } from "../../state/environments";
import {
  canForwardPorts,
  forwardedUrl,
  forwardPort,
  useForwardLocality,
} from "../../state/portForwards";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { getMainAppThreadTarget } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  boardEmbed,
  boardPort,
  boardUrlWithTheme,
  chooseBoardEnvironment,
} from "./boardEntry.logic";
import { useBoardEnvironments } from "./useBoardEntry";

const STORAGE_KEY = "t3.board.environment";

function readRememberedEnvironment(): EnvironmentId | null {
  try {
    return (window.localStorage.getItem(STORAGE_KEY) as EnvironmentId | null) ?? null;
  } catch {
    return null;
  }
}

function rememberEnvironment(environmentId: EnvironmentId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, environmentId);
  } catch {
    // Private windows may refuse storage; the choice then lasts this visit.
  }
}

type BoardLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "address"; readonly url: string }
  | { readonly kind: "failed"; readonly reason: string; readonly command: boolean };

export function BoardPage() {
  const search = useSearch({ from: "/_chat/board" });
  const navigate = useNavigate();
  const environments = useBoardEnvironments();
  const [remembered, setRemembered] = useState(readRememberedEnvironment);
  const [attempt, setAttempt] = useState(0);
  const lastThread = getMainAppThreadTarget();
  const environmentId = chooseBoardEnvironment({
    available: environments.map((environment) => environment.environmentId),
    requested: search.boardServer,
    remembered,
    lastThread: lastThread?.kind === "server" ? lastThread.threadRef.environmentId : null,
  });
  // A coordinator's view belongs to the environment the link named.
  const threadId = search.boardServer === environmentId ? search.boardThread : undefined;

  const select = (next: EnvironmentId) => {
    rememberEnvironment(next);
    setRemembered(next);
    void navigate({ to: "/board", search: {}, replace: true });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {environmentId === null ? (
        <div className="flex min-h-0 flex-1 flex-col bg-background">
          <BoardHeader />
          <BoardEmpty
            title={<T>No environment has the board</T>}
            description={
              <T>
                Turn on Settings → Threads → Board → Connect rstack-board on an environment, then
                come back here.
              </T>
            }
          />
        </div>
      ) : (
        <BoardView
          key={`${environmentId}:${threadId ?? ""}:${attempt}`}
          environmentId={environmentId}
          threadId={threadId}
          environments={environments}
          onSelect={select}
          onRefresh={() => setAttempt((value) => value + 1)}
        />
      )}
    </SidebarInset>
  );
}

function BoardHeader(props: { readonly children?: ReactNode }) {
  const gt = useGT();
  return (
    <WorkspacePageHeader electron={isElectron} className="relative bg-background">
      <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")}>
        <WorkspaceBreadcrumbItem current>
          <h1 className="truncate">
            <T context="page title, rstack-board">Board</T>
          </h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {props.children}
    </WorkspacePageHeader>
  );
}

function BoardEmpty(props: {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <MessagesSquareIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      {props.children ? <EmptyContent>{props.children}</EmptyContent> : null}
    </Empty>
  );
}

function BoardView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly onSelect: (environmentId: EnvironmentId) => void;
  readonly onRefresh: () => void;
}) {
  const { environmentId, threadId } = props;
  const gt = useGT();
  const appearance = useRenderedAppearance();
  const environment = useEnvironment(environmentId);
  const canOpen = useAtomValue(serverEnvironment.boardOpen.permissionAtom(environmentId));
  const canForward = environment?.connection.phase === "connected" && canForwardPorts(environment);
  const locality = useForwardLocality(canForward ? environmentId : null);
  const embed = boardEmbed({
    canForward,
    locality,
    reachesLoopback: browserReachesEnvironmentLoopback(environmentId),
  });
  const runStatus = useAtomCommand(serverEnvironment.boardStatus, { reportFailure: false });
  const runOpen = useAtomCommand(serverEnvironment.boardOpen, { reportFailure: false });
  const [status, setStatus] = useState<BoardStatus | "failed" | null>(null);
  const [load, setLoad] = useState<BoardLoad>({ kind: "loading" });

  const failure = (
    result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  ) =>
    isAtomCommandInterrupted(result)
      ? gt("The request was interrupted before the board answered.")
      : (thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."));

  const resolveLoad = async (): Promise<BoardLoad> => {
    const opened = await runOpen({ environmentId, input: threadId ? { threadId } : {} });
    if (opened._tag === "Failure")
      return { kind: "failed", reason: failure(opened), command: true };
    const serverUrl = opened.value.url;
    if (embed === "address") return { kind: "address", url: serverUrl };
    let url = serverUrl;
    if (embed === "forward") {
      try {
        url = forwardedUrl(await forwardPort(environmentId, boardPort(serverUrl)), serverUrl);
      } catch (error) {
        const reason = thrownErrorMessage(error, m) ?? gt("An error occurred.");
        return { kind: "failed", reason, command: false };
      }
    }
    try {
      // An opaque answer is enough: it shows the page is reachable before the frame loads it.
      await fetch(url, { mode: "no-cors", cache: "no-store" });
    } catch {
      return {
        kind: "failed",
        reason: gt("The board's page did not answer at {url}.", { url }),
        command: false,
      };
    }
    return { kind: "ready", url };
  };

  const start = useEffectEvent((isCurrent: () => boolean) => {
    void runStatus({ environmentId, input: {} }).then((result) => {
      if (isCurrent()) setStatus(result._tag === "Success" ? result.value : "failed");
    });
    void resolveLoad().then((next) => {
      if (isCurrent()) setLoad(next);
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server for the board's status and page, starting it when needed, once the embedding is known
  useEffect(() => {
    if (!canOpen || embed === "locating") return;
    let current = true;
    start(() => current);
    return () => {
      current = false;
    };
  }, [embed, canOpen]);

  const frameUrl = load.kind === "ready" ? boardUrlWithTheme(load.url, appearance) : null;
  const statusText =
    status === null
      ? gt("Checking the board…")
      : status === "failed"
        ? gt("Could not read the board's status")
        : status.error !== null
          ? status.error
          : status.version !== null
            ? gt("Connected to rstack-board {version}", { version: status.version })
            : gt("Connected to rstack-board");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <BoardHeader>
        {props.environments.length > 1 ? (
          <div className="[-webkit-app-region:no-drag]">
            <Select
              value={environmentId}
              onValueChange={(value) => {
                if (value) props.onSelect(value as EnvironmentId);
              }}
            >
              <SelectTrigger
                aria-label={gt("Board environment")}
                size="compact"
                variant="ghost"
                className="w-auto min-w-0"
              >
                <SelectValue>
                  {props.environments.find((option) => option.environmentId === environmentId)
                    ?.label ?? environmentId}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {props.environments.map((option) => (
                  <SelectItem key={option.environmentId} value={option.environmentId}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {canOpen ? statusText : null}
        </span>
        <div
          className="flex items-center gap-1 [-webkit-app-region:no-drag]"
          data-workspace-titlebar-controls
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Refresh the board")}
            title={gt("Refresh the board")}
            onClick={props.onRefresh}
          >
            <RotateCwIcon />
          </Button>
          {frameUrl !== null ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={gt("Open the board in your browser")}
              title={gt("Open the board in your browser")}
              onClick={() => void readLocalApi()?.shell.openExternal(frameUrl)}
            >
              <ExternalLinkIcon />
            </Button>
          ) : null}
        </div>
      </BoardHeader>
      {!canOpen ? (
        <BoardEmpty
          title={<T>This connection can't open the board</T>}
          description={
            <T>Opening the board needs permission to operate threads on this environment.</T>
          }
        />
      ) : frameUrl !== null ? (
        // oxlint-disable-next-line react/iframe-missing-sandbox -- the board's own app on its own origin needs its scripts and same-origin API, which a sandbox would only re-grant.
        <iframe
          title={gt("rstack-board")}
          src={frameUrl}
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      ) : load.kind === "address" ? (
        <BoardEmpty
          title={gt("The board is running on the server")}
          description={gt(
            "Its page is at {url} on the server's machine, which this browser cannot reach. Open it from the desktop app, or forward the port to this machine.",
            { url: load.url },
          )}
        />
      ) : load.kind === "failed" ? (
        <BoardEmpty
          title={gt("Could not open the board")}
          description={
            load.command
              ? gt("{reason} To start its page on the server, run: {command}", {
                  reason: load.reason,
                  command: BOARD_OPEN_COMMAND,
                })
              : load.reason
          }
        >
          <Button variant="outline" size="sm" onClick={props.onRefresh}>
            <T>Retry</T>
          </Button>
        </BoardEmpty>
      ) : (
        <BoardEmpty
          title={gt("Opening the board…")}
          description={<T>The server starts the board's page if it is not running.</T>}
        />
      )}
    </div>
  );
}
