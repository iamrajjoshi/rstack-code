import { useAtomValue } from "@effect/atom-react";
import { BOARD_INSTALL_COMMAND, type BoardStatus } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

type Check = { readonly status: BoardStatus } | { readonly failed: true } | null;

/** rstack-code: connects agents to rstack-board, the local message board, through `board_*` tools. */
export function BoardSettings() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment, targets } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const defaults = DEFAULT_UNIFIED_SETTINGS;
  const mixedEnabled = useScopedSettingsMixed(["boardEnabled"]);
  const mixedCliPath = useScopedSettingsMixed(["boardCliPath"]);
  const mixedChannel = useScopedSettingsMixed(["boardChannel"]);
  const mixedIdentity = useScopedSettingsMixed(["boardAutoIdentity"]);
  const mixedReplies = useScopedSettingsMixed(["boardDeliverReplies"]);
  const mixedAutoStatus = useScopedSettingsMixed(["boardAutoStatus"]);
  const cliPathEdited = useRef(false);
  const channelEdited = useRef(false);
  const canCheck = useAtomValue(serverEnvironment.boardStatus.permissionAtom(environmentId));
  const runStatus = useAtomCommand(serverEnvironment.boardStatus, { reportFailure: false });
  const [check, setCheck] = useState<Check>(null);
  const [checking, setChecking] = useState(false);

  const testConnection = async () => {
    if (environmentId === null) return;
    setChecking(true);
    const result = await runStatus({ environmentId, input: {} });
    setChecking(false);
    setCheck(result._tag === "Success" ? { status: result.value } : { failed: true });
  };

  const checkOnChange = useEffectEvent(() => {
    void testConnection();
  });
  const checkKey =
    canCheck && settings.boardEnabled ? `${environmentId}:${settings.boardCliPath}` : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server to run the board CLI when the board's settings change
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The status arrives from the server.
    if (checkKey !== null) checkOnChange();
  }, [checkKey]);

  const status = check !== null && "status" in check ? check.status : null;
  const statusText = checking
    ? gt("Checking the board…")
    : check === null
      ? undefined
      : status === null
        ? gt("This server cannot report the board's status.")
        : status.error !== null
          ? status.error
          : status.webUrl !== null
            ? gt("Connected to rstack-board {version}. Board page: {url} on the server.", {
                version: status.version ?? "",
                url: status.webUrl,
              })
            : gt(
                "Connected to rstack-board {version}. Run rstack-board on the server to open its page.",
                {
                  version: status.version ?? "",
                },
              );

  return (
    <SettingsSection id="board" title={gt("Board")}>
      <SettingsRow
        serverScoped
        settingKeys={["boardEnabled"]}
        mixed={mixedEnabled}
        {...setting("board-connect")}
        description={gt(
          "Give agents in every thread tools to post status and questions to rstack-board, a local message board, on the server's machine.",
        )}
        status={
          statusText === undefined ? undefined : (
            <span className="grid gap-1.5">
              <span>{statusText}</span>
              {status !== null && !status.installed ? (
                <code className="block overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre">
                  {BOARD_INSTALL_COMMAND}
                </code>
              ) : null}
            </span>
          )
        }
        resetAction={
          mixedEnabled || settings.boardEnabled !== defaults.boardEnabled ? (
            <SettingResetButton
              ariaLabel={gt("Reset board connection to default")}
              onClick={() => updateSettings({ boardEnabled: defaults.boardEnabled })}
            />
          ) : null
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={!canCheck || checking}
              onClick={() => void testConnection()}
            >
              {gt("Test connection")}
            </Button>
            <Switch
              checked={!mixedEnabled && settings.boardEnabled}
              onCheckedChange={(checked) => updateSettings({ boardEnabled: checked })}
              aria-label={gt("Connect rstack-board")}
            />
          </div>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["boardCliPath"]}
        mixed={mixedCliPath}
        {...setting("board-cli-path")}
        description={gt(
          "The rstack-board executable on the server. Leave empty to find it on PATH, then in ~/.local/bin.",
        )}
        resetAction={
          mixedCliPath || settings.boardCliPath !== defaults.boardCliPath ? (
            <SettingResetButton
              ariaLabel={gt("Reset board CLI path to default")}
              onClick={() => updateSettings({ boardCliPath: defaults.boardCliPath })}
            />
          ) : null
        }
        control={
          <Input
            key={`${scopeKey}:${mixedCliPath}:${settings.boardCliPath}`}
            aria-label={gt("Board CLI path")}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={
              mixedCliPath
                ? gt("Mixed", { $context: "values differ across targets" })
                : "rstack-board"
            }
            defaultValue={mixedCliPath ? "" : settings.boardCliPath}
            onChange={() => {
              cliPathEdited.current = true;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (cliPathEdited.current && (mixedCliPath || value !== settings.boardCliPath))
                updateSettings({ boardCliPath: value });
              cliPathEdited.current = false;
            }}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["boardChannel"]}
        mixed={mixedChannel}
        {...setting("board-channel")}
        description={gt(
          "Where agents start board threads when they name no channel. Leave empty to use the project's name.",
        )}
        resetAction={
          mixedChannel || settings.boardChannel !== defaults.boardChannel ? (
            <SettingResetButton
              ariaLabel={gt("Reset default board channel to default")}
              onClick={() => updateSettings({ boardChannel: defaults.boardChannel })}
            />
          ) : null
        }
        control={
          <Input
            key={`${scopeKey}:${mixedChannel}:${settings.boardChannel}`}
            aria-label={gt("Default board channel")}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={
              mixedChannel
                ? gt("Mixed", { $context: "values differ across targets" })
                : gt("Project name")
            }
            defaultValue={mixedChannel ? "" : settings.boardChannel}
            onChange={() => {
              channelEdited.current = true;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (channelEdited.current && (mixedChannel || value !== settings.boardChannel))
                updateSettings({ boardChannel: value });
              channelEdited.current = false;
            }}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["boardAutoIdentity"]}
        mixed={mixedIdentity}
        {...setting("board-auto-identity")}
        description={gt(
          "Post as a handle made from each thread's title, with workers filed under their coordinator. Off leaves the handle to the board.",
        )}
        resetAction={
          mixedIdentity || settings.boardAutoIdentity !== defaults.boardAutoIdentity ? (
            <SettingResetButton
              ariaLabel={gt("Reset automatic board identity to default")}
              onClick={() => updateSettings({ boardAutoIdentity: defaults.boardAutoIdentity })}
            />
          ) : null
        }
        control={
          <Switch
            checked={!mixedIdentity && settings.boardAutoIdentity}
            onCheckedChange={(checked) => updateSettings({ boardAutoIdentity: checked })}
            aria-label={gt("Automatic board identity")}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["boardDeliverReplies"]}
        mixed={mixedReplies}
        {...setting("board-deliver-replies")}
        description={gt(
          "Send your replies on a thread's board threads, and your approve, hold and release, to that thread as messages. Agents' board posts are never sent.",
        )}
        resetAction={
          mixedReplies || settings.boardDeliverReplies !== defaults.boardDeliverReplies ? (
            <SettingResetButton
              ariaLabel={gt("Reset board replies to threads to default")}
              onClick={() => updateSettings({ boardDeliverReplies: defaults.boardDeliverReplies })}
            />
          ) : null
        }
        control={
          <Switch
            checked={!mixedReplies && settings.boardDeliverReplies}
            onCheckedChange={(checked) => updateSettings({ boardDeliverReplies: checked })}
            aria-label={gt("Board replies to threads")}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["boardAutoStatus"]}
        mixed={mixedAutoStatus}
        {...setting("board-auto-status")}
        description={gt(
          "Check a coordinator's workers in on the board when they start, wait on you, and finish or fail, even when their agents forget to.",
        )}
        resetAction={
          mixedAutoStatus || settings.boardAutoStatus !== defaults.boardAutoStatus ? (
            <SettingResetButton
              ariaLabel={gt("Reset automatic board status to default")}
              onClick={() => updateSettings({ boardAutoStatus: defaults.boardAutoStatus })}
            />
          ) : null
        }
        control={
          <Switch
            checked={!mixedAutoStatus && settings.boardAutoStatus}
            onCheckedChange={(checked) => updateSettings({ boardAutoStatus: checked })}
            aria-label={gt("Automatic board status")}
          />
        }
      />
    </SettingsSection>
  );
}
