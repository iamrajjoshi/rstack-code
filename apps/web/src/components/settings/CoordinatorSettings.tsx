import type { CoordinatorWorkerIsolation, ModelSelection } from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_COORDINATOR_PARALLEL_WORKERS,
} from "@t3tools/contracts/settings";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";
import { msg, useGT, useMessages } from "gt-react";
import { useRef } from "react";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const ISOLATION_LABELS: Record<CoordinatorWorkerIsolation, string> = {
  worktree: msg("Own worktree"),
  shared: msg("Coordinator's checkout"),
};

/** The worker defaults `delegate_task` applies in threads marked as coordinators. */
export function CoordinatorSettings() {
  const gt = useGT();
  const messages = useMessages();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment, targets, connectedEnvironments } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const selection = settings.coordinatorWorkerModelSelection;
  const activeEntry = entries.find((entry) => entry.instanceId === selection.instanceId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection.instanceId,
    selection.model,
  );
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const mixedModel = useScopedSettingsMixed(["coordinatorWorkerModelSelection"]);
  const mixedIsolation = useScopedSettingsMixed(["coordinatorWorkerIsolation"]);
  const mixedMaxWorkers = useScopedSettingsMixed(["coordinatorMaxParallelWorkers"]);
  const mixedInstructions = useScopedSettingsMixed(["coordinatorStandingInstructions"]);
  const instructionsEdited = useRef(false);
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const defaults = DEFAULT_UNIFIED_SETTINGS;

  const setModel = (value: ModelSelection) => {
    const reason = modelDisabledReason(value.instanceId, value.model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Worker model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ coordinatorWorkerModelSelection: value });
  };

  return (
    <SettingsSection id="coordinator" title={gt("Coordinator")}>
      <SettingsRow
        serverScoped
        settingKeys={["coordinatorWorkerModelSelection"]}
        mixed={mixedModel}
        {...setting("coordinator-worker-model")}
        description={gt(
          "Model and effort for workers a coordinator thread delegates to, unless it names another.",
        )}
        resetAction={
          mixedModel || !Equal.equals(selection, defaults.coordinatorWorkerModelSelection) ? (
            <SettingResetButton
              ariaLabel={gt("Reset worker model to default")}
              onClick={() =>
                updateSettings({
                  coordinatorWorkerModelSelection: defaults.coordinatorWorkerModelSelection,
                })
              }
            />
          ) : null
        }
        control={
          connectedEnvironments.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              {gt("Connect an environment to choose its worker model.")}
            </span>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                environmentId={environment?.environmentId ?? null}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptions}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel={gt("Worker model")}
                {...(mixedModel
                  ? { triggerLabel: gt("Mixed", { $context: "values differ across targets" }) }
                  : {})}
                getModelDisabledReason={modelDisabledReason}
                onInstanceModelChange={(instanceId, model) =>
                  setModel(pickModelSelection(mixedModel ? null : selection, instanceId, model))
                }
              />
              {!mixedModel && activeEntry ? (
                <TraitsPicker
                  provider={activeEntry.driverKind}
                  models={activeEntry.models}
                  model={selection.model}
                  modelOptions={selection.options ?? []}
                  allowPromptInjectedEffort={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    setModel(createModelSelection(selection.instanceId, selection.model, options))
                  }
                />
              ) : null}
            </div>
          )
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["coordinatorWorkerIsolation"]}
        mixed={mixedIsolation}
        {...setting("coordinator-worker-isolation")}
        description={gt(
          "Where each worker makes its changes. Projects without a git repository use the coordinator's checkout.",
        )}
        resetAction={
          mixedIsolation ||
          settings.coordinatorWorkerIsolation !== defaults.coordinatorWorkerIsolation ? (
            <SettingResetButton
              ariaLabel={gt("Reset worker workspace to default")}
              onClick={() =>
                updateSettings({ coordinatorWorkerIsolation: defaults.coordinatorWorkerIsolation })
              }
            />
          ) : null
        }
        control={
          <Select
            value={mixedIsolation ? null : settings.coordinatorWorkerIsolation}
            onValueChange={(value) => {
              if (value === "worktree" || value === "shared")
                updateSettings({ coordinatorWorkerIsolation: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Worker workspace")}>
              <SelectValue>
                {(value: CoordinatorWorkerIsolation | null) =>
                  value === null
                    ? gt("Mixed", { $context: "values differ across targets" })
                    : messages(ISOLATION_LABELS[value])
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="worktree">
                {messages(ISOLATION_LABELS.worktree)}
              </SelectItem>
              <SelectItem hideIndicator value="shared">
                {messages(ISOLATION_LABELS.shared)}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["coordinatorMaxParallelWorkers"]}
        mixed={mixedMaxWorkers}
        {...setting("coordinator-max-workers")}
        description={gt(
          "Most workers one coordinator runs at once. It waits for one to finish before starting another.",
        )}
        resetAction={
          mixedMaxWorkers ||
          settings.coordinatorMaxParallelWorkers !== defaults.coordinatorMaxParallelWorkers ? (
            <SettingResetButton
              ariaLabel={gt("Reset maximum parallel workers to default")}
              onClick={() =>
                updateSettings({
                  coordinatorMaxParallelWorkers: defaults.coordinatorMaxParallelWorkers,
                })
              }
            />
          ) : null
        }
        control={
          <NumberField
            key={`${scopeKey}:${mixedMaxWorkers}:${settings.coordinatorMaxParallelWorkers}`}
            {...(mixedMaxWorkers ? {} : { defaultValue: settings.coordinatorMaxParallelWorkers })}
            min={1}
            max={MAX_COORDINATOR_PARALLEL_WORKERS}
            step={1}
            size="sm"
            className="w-32"
            onValueCommitted={(next) => {
              if (next === null) return;
              const workers = Math.round(next);
              if (mixedMaxWorkers || workers !== settings.coordinatorMaxParallelWorkers)
                updateSettings({ coordinatorMaxParallelWorkers: workers });
            }}
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label={gt("Fewer parallel workers")} />
              <NumberFieldInput aria-label={gt("Maximum parallel workers")} />
              <NumberFieldIncrement aria-label={gt("More parallel workers")} />
            </NumberFieldGroup>
          </NumberField>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["coordinatorStandingInstructions"]}
        {...setting("coordinator-standing-instructions")}
        description={gt("Appended to every task a coordinator thread delegates.")}
        resetAction={
          mixedInstructions || settings.coordinatorStandingInstructions !== "" ? (
            <SettingResetButton
              ariaLabel={gt("Reset standing instructions to default")}
              onClick={() => updateSettings({ coordinatorStandingInstructions: "" })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${mixedInstructions}:${settings.coordinatorStandingInstructions}`}
            aria-label={gt("Standing instructions for workers")}
            onChange={() => {
              instructionsEdited.current = true;
            }}
            rows={4}
            defaultValue={mixedInstructions ? "" : settings.coordinatorStandingInstructions}
            placeholder={
              mixedInstructions
                ? gt("Mixed. Enter instructions to apply to all selected targets.")
                : gt("Open a pull request when done. Run the checks beside your change first.")
            }
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (
                instructionsEdited.current &&
                (mixedInstructions || value !== settings.coordinatorStandingInstructions)
              )
                updateSettings({ coordinatorStandingInstructions: value });
              instructionsEdited.current = false;
            }}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
