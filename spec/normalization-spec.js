const { mergeItems, normalizeItems } = require("../lib/items");

describe("marker normalization snapshots", () => {
  it("owns merged ranges without changing a frozen provider array or its objects", () => {
    const first = Object.freeze({ row: 1, cls: "found" });
    const second = Object.freeze({ row: 2, end: 5, cls: "found" });
    const third = Object.freeze({ row: 8, cls: "found" });
    const provided = Object.freeze([third, second, first]);

    const normalized = normalizeItems(provided, { merge: true });

    expect(normalized).toEqual([
      { row: 1, end: 5, cls: "found" },
      { row: 8, cls: "found" },
    ]);
    expect(normalized[0]).not.toBe(first);
    expect(normalized[1]).not.toBe(third);
    expect(provided).toEqual([third, second, first]);
    expect(first.end).toBeUndefined();
  });

  it("preserves stable sort ties and the first surviving item's extra fields", () => {
    const metadata = { source: "first left" };
    const provided = [
      { row: 1, end: 3, cls: "found", position: "left", metadata: "long range" },
      { row: 1, cls: "found", position: "right", metadata: "first right" },
      { row: 1, cls: "found", position: "left", metadata },
      { row: 1, cls: "found", position: "left", metadata: "second left" },
    ];

    const normalized = normalizeItems(provided, { merge: true });

    expect(normalized).toEqual([
      { row: 1, cls: "found", position: "right", metadata: "first right" },
      { row: 1, end: 3, cls: "found", position: "left", metadata },
    ]);
    expect(normalized[1].metadata).toBe(metadata);
  });

  it("keeps class and position boundaries even when their ranges overlap", () => {
    const normalized = normalizeItems(
      [
        { row: 1, end: 3, cls: "a", position: "left" },
        { row: 2, end: 4, cls: "b", position: "left" },
        { row: 3, end: 5, cls: "b", position: "right" },
      ],
      { merge: true },
    );

    expect(normalized).toEqual([
      { row: 1, end: 3, cls: "a", position: "left" },
      { row: 2, end: 4, cls: "b", position: "left" },
      { row: 3, end: 5, cls: "b", position: "right" },
    ]);
  });

  it("retains the first item's field shape when null and omitted fields merge", () => {
    expect(
      normalizeItems([{ row: 1 }, { row: 2, cls: null, position: null }], { merge: true }),
    ).toEqual([{ row: 1, end: 2 }]);
    expect(
      normalizeItems([{ row: 1, cls: null, position: null }, { row: 2 }], { merge: true }),
    ).toEqual([{ row: 1, end: 2, cls: null, position: null }]);
  });

  it("does not merge an omitted position with an explicit layer default", () => {
    expect(
      normalizeItems([{ row: 1 }, { row: 2, position: "right" }], {
        merge: true,
        position: "right",
      }),
    ).toEqual([{ row: 1 }, { row: 2, position: "right" }]);
  });

  it("keeps its snapshot when the provider later changes cached items", () => {
    const provided = [
      { row: 1, cls: "found", position: "left" },
      { row: 2, cls: "found", position: "left" },
    ];
    const normalized = normalizeItems(provided, { merge: true });

    provided[0].row = 9;
    provided[0].end = 10;
    provided[0].cls = "changed";
    provided[0].position = "right";
    provided[1].row = 20;

    expect(normalized).toEqual([{ row: 1, end: 2, cls: "found", position: "left" }]);
  });

  it("keeps provider order and independent item copies without merging", () => {
    const provided = [{ row: 3 }, { row: 1 }, { row: 2 }];
    const normalized = normalizeItems(provided, { merge: false });

    expect(normalized).toEqual(provided);
    for (let i = 0; i < provided.length; i++) expect(normalized[i]).not.toBe(provided[i]);
  });

  it("preserves the exported merge helper's in-place sort and item identities", () => {
    const first = { row: 1 };
    const second = { row: 2 };
    const third = { row: 3 };
    const provided = [third, first, second];

    const merged = mergeItems(provided);

    expect(provided).toEqual([first, second, third]);
    expect(merged).toEqual([{ row: 1, end: 3 }]);
    expect(merged[0]).toBe(first);
    expect(first.end).toBe(3);
  });
});
