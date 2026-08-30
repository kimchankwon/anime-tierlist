import { describe, expect, it } from "vitest";
import {
  displayTitle,
  gridDeleteBody,
  editorSaveBadge,
  hasTitle,
  tileRemoveBody,
  toWire,
  UNTITLED,
  emptyCells,
  GRID_SIZE,
} from "./nine";
import type { NineCell } from "./nine";

describe("displayTitle", () => {
  it("falls back to Untitled 3x3 for empty or whitespace-only titles", () => {
    expect(displayTitle("")).toBe(UNTITLED);
    expect(displayTitle("   ")).toBe(UNTITLED);
    expect(displayTitle("My List")).toBe("My List");
    expect(displayTitle(" Attack on Titan ")).toBe("Attack on Titan");
  });
});

describe("hasTitle", () => {
  it("rejects empty and whitespace-only names, keeps a trailing space while typing", () => {
    expect(hasTitle("")).toBe(false);
    expect(hasTitle("   ")).toBe(false);
    expect(hasTitle("My List")).toBe(true);
    expect(hasTitle("Attack on ")).toBe(true);
  });
});

describe("editorSaveBadge", () => {
  it("shows Needs a title for a blank document even when saveState is idle", () => {
    expect(editorSaveBadge("idle", "", 3)).toEqual({
      text: "Needs a title",
      kind: "needs-title",
    });
    expect(editorSaveBadge("saved", "   ", 0)).toEqual({
      text: "Needs a title",
      kind: "needs-title",
    });
  });

  it("keeps Saving while a write is in flight, even if the box was just cleared", () => {
    expect(editorSaveBadge("saving", "", 3).text).toBe("Saving…");
  });

  it("falls back to n/9 for a named idle grid", () => {
    expect(editorSaveBadge("idle", "Best Girl", 4)).toEqual({
      text: "4/9",
      kind: "idle",
    });
  });
});

describe("gridDeleteBody", () => {
  it("names an untitled board and singularizes one tile", () => {
    expect(gridDeleteBody("", 1)).toBe(
      `“${UNTITLED}” and its 1 tile go away for good. This cannot be undone.`,
    );
    expect(gridDeleteBody("  ", 0)).toContain("0 tiles");
    expect(gridDeleteBody("Best Girl", 9)).toContain("“Best Girl”");
    expect(gridDeleteBody("Best Girl", 9)).toContain("9 tiles");
  });
});

describe("tileRemoveBody", () => {
  it("uses the caption, or a fallback when it is blank", () => {
    expect(tileRemoveBody("Luffy")).toContain("“Luffy”");
    expect(tileRemoveBody("   ")).toContain("“This tile”");
  });
});

describe("toWire", () => {
  it("drops the display-only url and keeps exactly one image source", () => {
    const cells: NineCell[] = emptyCells();
    cells[0] = {
      caption: "Luffy",
      subtitle: "One Piece",
      imageId: null,
      imageUrl: "https://img.example/luffy.jpg",
      url: "https://img.example/luffy.jpg",
    };
    const wired = toWire(cells);
    expect(wired).toHaveLength(GRID_SIZE);
    expect(wired[0]).toEqual({
      caption: "Luffy",
      subtitle: "One Piece",
      imageUrl: "https://img.example/luffy.jpg",
    });
    expect(wired[1]).toBeNull();
  });
});
