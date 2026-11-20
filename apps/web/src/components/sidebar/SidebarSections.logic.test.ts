import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupSidebarActiveThreads,
  mergeSidebarSections,
  moveSidebarSectionIds,
  orderSidebarSections,
  placeSidebarSection,
  resolveSidebarThreadSectionId,
  stepSidebarSectionIds,
} from "./SidebarSections.logic";

const mac = EnvironmentId.make("mac");
const box = EnvironmentId.make("box");
const s = (id: string, name = id) => ({ id, name });

describe("mergeSidebarSections", () => {
  it("merges same-id sections across environments and keeps each list's relative order", () => {
    const merged = mergeSidebarSections([
      { environmentId: mac, sections: [s("a"), s("c")] },
      { environmentId: box, sections: [s("a"), s("b"), s("c"), s("d")] },
    ]);
    expect(merged.map((section) => section.id)).toEqual(["a", "b", "c", "d"]);
    expect(merged.find((section) => section.id === "a")?.environmentIds).toEqual([mac, box]);
    expect(merged.find((section) => section.id === "b")?.environmentIds).toEqual([box]);
  });

  it("names a section from the first environment that lists it", () => {
    const merged = mergeSidebarSections([
      { environmentId: mac, sections: [s("a", "Review")] },
      { environmentId: box, sections: [s("a", "Old name")] },
    ]);
    expect(merged[0]!.name).toBe("Review");
  });
});

describe("section list edits", () => {
  it("adds a section to another environment where the merged order puts it", () => {
    expect(placeSidebarSection([s("a"), s("c")], ["a", "b", "c"], s("b")).map((x) => x.id)).toEqual(
      ["a", "b", "c"],
    );
    // Already there: unchanged.
    expect(placeSidebarSection([s("a")], ["a"], s("a"))).toEqual([s("a")]);
  });

  it("reorders one environment's list to the merged order", () => {
    expect(
      orderSidebarSections([s("a"), s("b"), s("c")], ["c", "a", "b"]).map((x) => x.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("moves a dragged section to the one it was dropped on, and steps by one", () => {
    expect(moveSidebarSectionIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveSidebarSectionIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(stepSidebarSectionIds(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(stepSidebarSectionIds(["a", "b", "c"], "c", 1)).toBeNull();
  });
});

describe("groupSidebarActiveThreads", () => {
  const sections = mergeSidebarSections([
    { environmentId: mac, sections: [s("work"), s("empty")] },
  ]);
  const threads = [
    { id: "1", sectionId: "work" },
    { id: "2", coordinator: true },
    { id: "3", sectionId: "work", coordinator: true },
    { id: "4", sectionId: "deleted" },
    { id: "5" },
  ];

  it("puts section members in their section and the rest in the default groups", () => {
    const grouped = groupSidebarActiveThreads({
      threads,
      sections,
      coordinatorGroupsEnabled: true,
      filtered: false,
    });
    expect(
      grouped.sections.map((entry) => [entry.section.id, entry.threads.map((t) => t.id)]),
    ).toEqual([
      ["work", ["1", "3"]],
      ["empty", []],
    ]);
    expect(grouped.coordinators.map((t) => t.id)).toEqual(["2"]);
    // A thread whose section was deleted falls back to the default group.
    expect(grouped.others.map((t) => t.id)).toEqual(["4", "5"]);
  });

  it("hides sections without a visible thread while a filter is on", () => {
    const grouped = groupSidebarActiveThreads({
      threads: threads.slice(1),
      sections,
      coordinatorGroupsEnabled: false,
      filtered: true,
    });
    expect(grouped.sections.map((entry) => entry.section.id)).toEqual(["work"]);
    expect(grouped.others.map((t) => t.id)).toEqual(["2", "4", "5"]);
  });
});

describe("resolveSidebarThreadSectionId", () => {
  it("ignores a saved id no environment lists any more", () => {
    const ids = new Set(["work"]);
    expect(resolveSidebarThreadSectionId({ sectionId: "work" }, ids)).toBe("work");
    expect(resolveSidebarThreadSectionId({ sectionId: "gone" }, ids)).toBeNull();
    expect(resolveSidebarThreadSectionId({}, ids)).toBeNull();
  });
});
