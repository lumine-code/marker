const { classNameFor, itemsEqual, mergeItems, normalizeItems } = require("../lib/items");

describe("items", () => {
  it("joins adjacent rows sharing a class and position", () => {
    const merged = mergeItems([{ row: 3 }, { row: 1 }, { row: 2 }, { row: 7 }]);
    expect(merged).toEqual([{ row: 1, end: 3 }, { row: 7 }]);
  });

  it("keeps ranges with different classes apart", () => {
    const merged = mergeItems([
      { row: 1, cls: "added" },
      { row: 2, cls: "removed" },
    ]);
    expect(merged.length).toBe(2);
  });

  it("keeps ranges in different positions apart", () => {
    const merged = mergeItems([
      { row: 1, position: "left" },
      { row: 2, position: "right" },
    ]);
    expect(merged.length).toBe(2);
  });

  // Providers are told they may hand back a cached array, so the pipeline has
  // to own its copies before merging rewrites their ends.
  it("never mutates what the provider returned", () => {
    const provided = [{ row: 1 }, { row: 2 }];
    normalizeItems(provided, { name: "spec", merge: true });
    expect(provided).toEqual([{ row: 1 }, { row: 2 }]);
  });

  // The threshold hides at draw time, per renderer. Emptying here would throw
  // away the items every renderer below its own scaled limit still wants.
  it("ignores the threshold entirely", () => {
    lumine.config.set("marker.specThreshold", 2);
    const props = { name: "spec", threshold: "marker.specThreshold" };
    expect(normalizeItems([{ row: 1 }, { row: 2 }, { row: 3 }], props).length).toBe(3);
  });

  it("composes the layer, position and item classes", () => {
    expect(classNameFor({ name: "git-diff" }, {})).toBe("marker marker-git-diff");
    expect(classNameFor({ name: "git-diff", position: "right" }, { cls: "added" })).toBe(
      "marker marker-git-diff right added",
    );
    // The item's own position wins over the layer default.
    expect(classNameFor({ name: "git-diff", position: "right" }, { position: "full" })).toBe(
      "marker marker-git-diff full",
    );
  });

  describe("itemsEqual", () => {
    it("matches on the four contract fields regardless of object identity", () => {
      expect(itemsEqual([], [])).toBe(true);
      expect(
        itemsEqual(
          [{ row: 1, end: 2, cls: "a", position: "left" }],
          [{ row: 1, end: 2, cls: "a", position: "left" }],
        ),
      ).toBe(true);
    });

    it("differs on any field, on length, and on order", () => {
      expect(itemsEqual([{ row: 1 }], [{ row: 2 }])).toBe(false);
      expect(itemsEqual([{ row: 1 }], [{ row: 1, end: 3 }])).toBe(false);
      expect(itemsEqual([{ row: 1 }], [{ row: 1, cls: "x" }])).toBe(false);
      expect(itemsEqual([{ row: 1 }], [{ row: 1, position: "full" }])).toBe(false);
      expect(itemsEqual([{ row: 1 }], [{ row: 1 }, { row: 2 }])).toBe(false);
      expect(itemsEqual([{ row: 1 }, { row: 2 }], [{ row: 2 }, { row: 1 }])).toBe(false);
    });
  });
});
