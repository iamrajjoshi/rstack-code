import type { EnvironmentId } from "@t3tools/contracts";
import type { SidebarSectionSetting } from "@t3tools/contracts/settings";

/**
 * A section as the sidebar shows it. Each environment stores its own list in the
 * `sidebarSections` setting; entries with the same id across environments are one section.
 */
export interface SidebarSectionView {
  readonly id: string;
  readonly name: string;
  readonly environmentIds: readonly EnvironmentId[];
}

/**
 * Merges each environment's section list into one ordered list. Lists are visited in the given
 * order, and a section new to the result lands right after its predecessor in its own list, so
 * environments that agree on relative order merge to that order.
 */
export function mergeSidebarSections(
  lists: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly sections: readonly SidebarSectionSetting[];
  }>,
): SidebarSectionView[] {
  const merged: { id: string; name: string; environmentIds: EnvironmentId[] }[] = [];
  for (const { environmentId, sections } of lists) {
    let previous = -1;
    for (const section of sections) {
      const index = merged.findIndex((candidate) => candidate.id === section.id);
      if (index === -1) {
        merged.splice(previous + 1, 0, {
          id: section.id,
          name: section.name,
          environmentIds: [environmentId],
        });
        previous += 1;
      } else {
        if (!merged[index]!.environmentIds.includes(environmentId)) {
          merged[index]!.environmentIds.push(environmentId);
        }
        previous = index;
      }
    }
  }
  return merged;
}

/** One environment's list with `section` added where the merged order puts it. */
export function placeSidebarSection(
  list: readonly SidebarSectionSetting[],
  mergedIds: readonly string[],
  section: SidebarSectionSetting,
): SidebarSectionSetting[] {
  if (list.some((entry) => entry.id === section.id)) return [...list];
  return orderSidebarSections([...list, section], mergedIds);
}

/** One environment's list sorted by the merged order; ids it does not know keep their place last. */
export function orderSidebarSections(
  list: readonly SidebarSectionSetting[],
  mergedIds: readonly string[],
): SidebarSectionSetting[] {
  const rank = new Map(mergedIds.map((id, index) => [id, index]));
  return list.toSorted(
    (left, right) =>
      (rank.get(left.id) ?? Number.POSITIVE_INFINITY) -
      (rank.get(right.id) ?? Number.POSITIVE_INFINITY),
  );
}

/** The merged ids after dragging section `id` onto section `overId`. */
export function moveSidebarSectionIds(
  ids: readonly string[],
  id: string,
  overId: string,
): readonly string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return ids;
  const next = ids.filter((candidate) => candidate !== id);
  next.splice(to, 0, id);
  return next;
}

/** The merged ids after moving section `id` one place up or down, or null at an end. */
export function stepSidebarSectionIds(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): readonly string[] | null {
  const from = ids.indexOf(id);
  const overId = ids[from + direction];
  return from === -1 || overId === undefined ? null : moveSidebarSectionIds(ids, id, overId);
}

/** A short random id, unique enough for one person's sections. */
export function newSidebarSectionId(random: () => number = Math.random): string {
  return `section-${Math.floor(random() * 2 ** 48).toString(36)}`;
}

/** The section a thread shows in: its saved id, when some environment still lists that section. */
export function resolveSidebarThreadSectionId(
  thread: { readonly sectionId?: string },
  sectionIds: ReadonlySet<string>,
): string | null {
  return thread.sectionId !== undefined && sectionIds.has(thread.sectionId)
    ? thread.sectionId
    : null;
}

export const SIDEBAR_SECTION_HEADER_PREFIX = "section-header:";
const SECTION_GROUP_PREFIX = "section:";

export function sidebarSectionGroupId(sectionId: string): string {
  return `${SECTION_GROUP_PREFIX}${sectionId}`;
}

/** The section id a drop group names, or null for the default groups. */
export function sectionIdOfSidebarGroup(group: string | null): string | null {
  return group?.startsWith(SECTION_GROUP_PREFIX) ? group.slice(SECTION_GROUP_PREFIX.length) : null;
}

/**
 * Splits the active list into the user's sections, in their order, and the default groups.
 * A thread outside every section goes to coordinators or others as before. With a filter or
 * search narrowing the list, sections left without a visible thread hide.
 */
export function groupSidebarActiveThreads<
  T extends { readonly sectionId?: string; readonly coordinator?: boolean },
>(input: {
  readonly threads: readonly T[];
  readonly sections: readonly SidebarSectionView[];
  readonly coordinatorGroupsEnabled: boolean;
  readonly filtered: boolean;
}): {
  readonly sections: ReadonlyArray<{ readonly section: SidebarSectionView; readonly threads: T[] }>;
  readonly coordinators: T[];
  readonly others: T[];
} {
  const byId = new Map(
    input.sections.map((section) => [section.id, { section, threads: [] as T[] }]),
  );
  const coordinators: T[] = [];
  const others: T[] = [];
  for (const thread of input.threads) {
    const section = thread.sectionId === undefined ? undefined : byId.get(thread.sectionId);
    if (section) section.threads.push(thread);
    else if (input.coordinatorGroupsEnabled && thread.coordinator === true)
      coordinators.push(thread);
    else others.push(thread);
  }
  return {
    sections: [...byId.values()].filter((entry) => !input.filtered || entry.threads.length > 0),
    coordinators,
    others,
  };
}

/** Where a thread lands when dropped into the active list: a section, or its default group. */
export function resolveSidebarDropGroup(input: {
  readonly slotGroup: string | null;
  readonly coordinator: boolean;
  readonly coordinatorGroups: boolean;
}): string {
  if (sectionIdOfSidebarGroup(input.slotGroup) !== null) return input.slotGroup!;
  return input.coordinatorGroups && input.coordinator ? "coordinators" : "threads";
}
