import { type EnvironmentContextRecord, resolveEnvironmentMachineKind } from "@t3tools/contracts";

import { useGT } from "gt-react";

import { useEnvironment } from "~/state/environments";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
<<<<<<< HEAD
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { APP_BASE_NAME } from "~/branding";
=======
import { SharedTooltipTrigger } from "./ui/shared-tooltip";
>>>>>>> 7fa73d3ef339fb88b4a4f59bd710b43e2cbaff1a

/**
 * Inline chip for a mentioned machine, in the composer and in sent messages. Prefers the
 * name this client knows the machine by, and draws it with its machine icon.
 */
export function EnvironmentContextChip(props: {
  record: Pick<EnvironmentContextRecord, "environmentId" | "label">;
  copyMarkdown?: string;
}) {
  const gt = useGT();
  const environment = useEnvironment(props.record.environmentId);
  const label = environment?.label.trim() || props.record.label;
  return (
<<<<<<< HEAD
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="environment"
            tabIndex={0}
            aria-label={gt("Machine, {label}", { label })}
            data-markdown-copy={props.copyMarkdown}
          >
            <EnvironmentMachineIcon
              kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
            />
            <ContextChipLabel>{label}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {environment
          ? gt("{app} environment", { app: APP_BASE_NAME })
          : gt("Machine not in this app")}
      </TooltipPopup>
    </Tooltip>
=======
    <SharedTooltipTrigger
      render={
        <ContextChip
          kind="environment"
          tabIndex={0}
          aria-label={gt("Machine, {label}", { label })}
          data-markdown-copy={props.copyMarkdown}
        >
          <EnvironmentMachineIcon
            kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
          />
          <ContextChipLabel>{label}</ContextChipLabel>
        </ContextChip>
      }
      label={environment ? gt("T3 Code environment") : gt("Machine not in this app")}
    />
>>>>>>> 7fa73d3ef339fb88b4a4f59bd710b43e2cbaff1a
  );
}
