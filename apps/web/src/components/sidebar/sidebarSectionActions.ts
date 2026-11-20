import { runAtomCommand, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { SidebarSectionSetting } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import {
  newSidebarSectionId,
  orderSidebarSections,
  placeSidebarSection,
  type SidebarSectionView,
} from "./SidebarSections.logic";

type Result = AtomCommandResult<unknown, unknown>;
const SUCCESS: Result = AsyncResult.success(undefined);

function sectionsOf(environmentId: EnvironmentId): readonly SidebarSectionSetting[] {
  return (
    appAtomRegistry.get(serverEnvironment.settingsValueAtom(environmentId))?.sidebarSections ?? []
  );
}

function writeSections(
  environmentId: EnvironmentId,
  sidebarSections: readonly SidebarSectionSetting[],
): Promise<Result> {
  return runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { sidebarSections } } },
    { reportFailure: false },
  );
}

/** Runs writes in order and stops at the first failure, which it returns. */
async function inOrder(writes: ReadonlyArray<() => Promise<Result>>): Promise<Result> {
  for (const write of writes) {
    const result = await write();
    if (result._tag === "Failure") return result;
  }
  return SUCCESS;
}

/** Creates a section at the end of one environment's list. */
export async function createSidebarSection(
  environmentId: EnvironmentId,
  name: string,
): Promise<{ readonly result: Result; readonly id: string }> {
  const id = newSidebarSectionId();
  const result = await writeSections(environmentId, [
    ...sectionsOf(environmentId),
    { id, name: name.trim() },
  ]);
  return { result, id };
}

/** Renames a section in every environment that lists it. */
export function renameSidebarSection(section: SidebarSectionView, name: string): Promise<Result> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === section.name) return Promise.resolve(SUCCESS);
  return inOrder(
    section.environmentIds.map(
      (environmentId) => () =>
        writeSections(
          environmentId,
          sectionsOf(environmentId).map((entry) =>
            entry.id === section.id ? { ...entry, name: trimmed } : entry,
          ),
        ),
    ),
  );
}

/**
 * Removes a section everywhere it is listed. Threads keep the dangling id and show in the
 * default groups; recreating a section makes a new id, so they never return to it unasked.
 */
export function deleteSidebarSection(section: SidebarSectionView): Promise<Result> {
  return inOrder(
    section.environmentIds.map(
      (environmentId) => () =>
        writeSections(
          environmentId,
          sectionsOf(environmentId).filter((entry) => entry.id !== section.id),
        ),
    ),
  );
}

/** Writes the merged order to every environment whose own list disagrees. */
export function reorderSidebarSections(
  sections: readonly SidebarSectionView[],
  orderedIds: readonly string[],
): Promise<Result> {
  const environmentIds = [...new Set(sections.flatMap((section) => section.environmentIds))];
  return inOrder(
    environmentIds.flatMap((environmentId) => {
      const current = sectionsOf(environmentId);
      const next = orderSidebarSections(current, orderedIds);
      return next.every((entry, index) => entry.id === current[index]?.id)
        ? []
        : [() => writeSections(environmentId, next)];
    }),
  );
}

/**
 * Moves a thread into a section, or out of every section with null. A section that the thread's
 * environment does not list yet is added there first, so the thread keeps its place even when
 * the environments that listed it go away.
 */
export async function moveThreadToSidebarSection(input: {
  readonly threadRef: ScopedThreadRef;
  readonly section: SidebarSectionView | null;
  readonly orderedIds: readonly string[];
}): Promise<Result> {
  const { threadRef, section } = input;
  if (section !== null && !section.environmentIds.includes(threadRef.environmentId)) {
    const placed = await writeSections(
      threadRef.environmentId,
      placeSidebarSection(sectionsOf(threadRef.environmentId), input.orderedIds, {
        id: section.id,
        name: section.name,
      }),
    );
    if (placed._tag === "Failure") return placed;
  }
  return runAtomCommand(
    appAtomRegistry,
    threadEnvironment.setSection,
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, sectionId: section?.id ?? null },
    },
    { reportFailure: false },
  );
}
