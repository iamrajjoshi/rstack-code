import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { NetworkIcon } from "lucide-react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useQuietThreadProjection } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, type ComposerControlSize } from "./ComposerControl";

/** Marks the thread, or the draft it will be created from, as a coordinator. */
export function ComposerCoordinatorToggle(props: {
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;
  size: ComposerControlSize;
}) {
  const gt = useGT();
  const serverThread =
    useQuietThreadProjection(props.routeKind === "server" ? props.routeThreadRef : null)?.projection
      .thread ?? null;
  const draftSession = useComposerDraftStore((store) =>
    props.routeKind === "server"
      ? store.getDraftSessionByRef(props.routeThreadRef)
      : props.draftId
        ? store.getDraftSession(props.draftId)
        : null,
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const coordinator =
    serverThread !== null ? serverThread.coordinator === true : draftSession?.coordinator === true;
  const label = coordinator
    ? gt("Coordinator: delegates implementation to workers")
    : gt("Make this thread a coordinator");
  const toggle = () => {
    if (serverThread !== null) {
      void updateThreadMetadata({
        environmentId: props.environmentId,
        input: { threadId: serverThread.id, coordinator: !coordinator },
      });
      return;
    }
    const target = props.routeKind === "server" ? props.routeThreadRef : props.draftId;
    if (target) {
      useComposerDraftStore.getState().setDraftThreadContext(target, { coordinator: !coordinator });
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size={props.size}
            aria-label={label}
            aria-pressed={coordinator}
            disabled={serverThread === null && draftSession === null}
            onClick={toggle}
          />
        }
      >
        <NetworkIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
