const { MarkerStyles, drawRegions, resizeCanvas, resolveLength } = require("../lib/canvas");

describe("canvas", () => {
  let container, sheets;

  // What matters here is which regions reach the context, with what colour, in
  // what order -- a recording canvas keeps the assertions exact.
  function createCanvas() {
    const fills = [];
    const context = {
      globalAlpha: 1,
      fillStyle: "",
      setTransform() {},
      clearRect() {},
      fillRect(x, y, width, height) {
        fills.push({ x, y, width, height, color: this.fillStyle, alpha: this.globalAlpha });
      },
    };
    return {
      fills,
      context,
      ownerDocument: document,
      width: 0,
      height: 0,
      style: {},
      getContext() {
        return context;
      },
    };
  }

  function styleSheet(css) {
    const element = document.createElement("style");
    element.textContent = css;
    document.head.appendChild(element);
    sheets.push(element);
    return element;
  }

  function makeStyles(css) {
    styleSheet(css);
    const styles = new MarkerStyles({ label: "spec" });
    container.appendChild(styles.element);
    return styles;
  }

  beforeEach(() => {
    container = document.createElement("div");
    jasmine.attachToDOM(container);
    sheets = [];
  });

  afterEach(() => {
    for (const sheet of sheets) {
      sheet.remove();
    }
    container.remove();
  });

  it("resolves numeric marker heights as pixels, including zero and fractional lengths", () => {
    expect(resolveLength(4, 200, 9)).toBe(4);
    expect(resolveLength(0.5, 200, 9)).toBe(0.5);
    expect(resolveLength(0, 200, 9)).toBe(0);
  });

  it("uses the fallback for nonfinite numeric marker heights", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(resolveLength(value, 200, 9)).toBe(9);
    }
  });

  it("retains CSS pixel, percentage and automatic marker-height resolution", () => {
    expect(resolveLength("4px", 200, 9)).toBe(4);
    expect(resolveLength("12.5%", 200, 9)).toBe(25);
    expect(resolveLength("0px", 200, 9)).toBe(0);
    expect(resolveLength("auto", 200, 9)).toBe(9);
    expect(resolveLength(undefined, 200, 9)).toBe(9);
    expect(resolveLength("invalid", 200, 9)).toBe(9);
  });

  it("fills a marker with the colour its stylesheet gives it", () => {
    const styles = makeStyles(".marker.marker-a { background-color: rgb(255, 0, 0); }");
    const canvas = createCanvas();

    drawRegions(canvas, styles, [{ y: 4, height: 2, className: "marker marker-a" }], 10, 100);

    expect(canvas.fills.length).toBe(1);
    expect(canvas.fills[0].color).toBe("rgb(255, 0, 0)");
    expect(canvas.fills[0].y).toBe(4);
  });

  // Ordering is what lets one stylesheet stack layers the same way on all maps.
  it("draws overlapping markers in z-index order", () => {
    const styles = makeStyles(
      `.marker.marker-low { background-color: rgb(0, 0, 255); z-index: 11; }
       .marker.marker-high { background-color: rgb(0, 255, 0); z-index: 19; }`,
    );
    const canvas = createCanvas();

    drawRegions(
      canvas,
      styles,
      [
        { y: 0, height: 2, className: "marker marker-high" },
        { y: 0, height: 2, className: "marker marker-low" },
      ],
      10,
      100,
    );

    expect(canvas.fills.map((fill) => fill.color)).toEqual(["rgb(0, 0, 255)", "rgb(0, 255, 0)"]);
  });

  it("resolves each class once while keeping equal-z regions in their original order", () => {
    const byClass = {
      low: { x: 0, width: 10, minHeight: 1, color: "blue", opacity: 1, zIndex: -2 },
      a: { x: 0, width: 10, minHeight: 1, color: "red", opacity: 0.5, zIndex: 3 },
      b: { x: 0, width: 10, minHeight: 1, color: "green", opacity: 0.5, zIndex: 3 },
      hidden: {
        x: 0,
        width: 10,
        minHeight: 1,
        color: "rgba(0, 0, 0, 0)",
        opacity: 1,
        zIndex: 0,
      },
    };
    const styles = {
      styleFor: jasmine.createSpy("resolve style").and.callFake((className) => byClass[className]),
      prune: jasmine.createSpy("prune"),
    };
    const regions = Object.freeze(
      Array.from({ length: 1000 }, (_, index) =>
        Object.freeze({
          y: index / 10,
          height: 1.5,
          className: ["a", "low", "b", "hidden"][index % 4],
        }),
      ),
    );
    const canvas = createCanvas();

    drawRegions(canvas, styles, regions, 10, 100);

    expect(styles.styleFor).toHaveBeenCalledTimes(4);
    expect(canvas.fills.map((fill) => fill.y)).toEqual([
      ...regions.filter((region) => region.className === "low").map((region) => region.y),
      ...regions
        .filter((region) => region.className === "a" || region.className === "b")
        .map((region) => region.y),
    ]);
    expect(styles.prune).toHaveBeenCalledWith(new Set(["a", "low", "b", "hidden"]));
    expect(canvas.context.globalAlpha).toBe(1);
  });

  it("keeps every translucent overlap while avoiding repeated context state writes", () => {
    const style = { x: 2, width: 4, minHeight: 1, color: "red", opacity: 0.5, zIndex: 0 };
    const styles = { styleFor: () => style, prune() {} };
    const canvas = createCanvas();
    const alphaWrites = [];
    const colorWrites = [];
    let alpha = 1;
    let color = "";
    Object.defineProperties(canvas.context, {
      globalAlpha: {
        get: () => alpha,
        set: (value) => {
          alphaWrites.push(value);
          alpha = value;
        },
      },
      fillStyle: {
        get: () => color,
        set: (value) => {
          colorWrites.push(value);
          color = value;
        },
      },
    });
    const region = Object.freeze({ y: 3.25, height: 2.5, className: "a" });

    drawRegions(canvas, styles, [region, region, region], 10, 100);

    expect(canvas.fills).toEqual(
      Array(3).fill({ x: 2, y: 3.25, width: 4, height: 2.5, color: "red", alpha: 0.5 }),
    );
    expect(alphaWrites).toEqual([0.5, 1]);
    expect(colorWrites).toEqual(["red"]);
  });

  it("matches per-region source-over pixels for interleaved styles and repeated overlaps", () => {
    const byClass = {
      low: { x: 0, width: 7, minHeight: 1, height: 2, color: "blue", opacity: 0.25, zIndex: -2 },
      a: {
        x: 1,
        width: 5,
        minHeight: 1,
        height: 2,
        color: "rgba(255, 0, 0, 0.5)",
        opacity: 0.5,
        zIndex: 3,
      },
      b: { x: 2, width: 3, minHeight: 1, height: 2, color: "green", opacity: 0.5, zIndex: 3 },
    };
    const regions = [
      { y: 2.25, height: 3.5, className: "a" },
      { y: 1, height: 0, className: "low" },
      { y: 3, height: 4, className: "b" },
      { y: 2.25, height: 3.5, className: "a" },
      { y: 5.5, height: -1, className: "low" },
      { y: 2, className: "b" },
    ];
    const actual = document.createElement("canvas");
    drawRegions(actual, { styleFor: (name) => byClass[name], prune() {} }, regions, 8, 10);

    const expected = document.createElement("canvas");
    const context = resizeCanvas(expected, 8, 10);
    const order = regions
      .map((region, index) => ({ region, index }))
      .sort(
        (a, b) =>
          byClass[a.region.className].zIndex - byClass[b.region.className].zIndex ||
          a.index - b.index,
      );
    for (const { region } of order) {
      const style = byClass[region.className];
      context.globalAlpha = style.opacity;
      context.fillStyle = style.color;
      context.fillRect(
        style.x,
        region.y,
        style.width,
        Math.max(style.minHeight, region.height || style.height || 1),
      );
    }

    expect(
      Array.from(actual.getContext("2d").getImageData(0, 0, actual.width, actual.height).data),
    ).toEqual(Array.from(context.getImageData(0, 0, expected.width, expected.height).data));
  });

  it("draws nothing for a colourless marker and reports it once", () => {
    spyOn(console, "warn");
    const styles = makeStyles(".marker.marker-styled { background-color: rgb(1, 2, 3); }");
    const canvas = createCanvas();
    const regions = [
      { y: 0, height: 2, className: "marker marker-unstyled" },
      { y: 4, height: 2, className: "marker marker-styled" },
    ];

    drawRegions(canvas, styles, regions, 10, 100);
    drawRegions(canvas, styles, regions, 10, 100);

    expect(canvas.fills.map((fill) => fill.color)).toEqual(["rgb(1, 2, 3)", "rgb(1, 2, 3)"]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.calls.argsFor(0)[0]).toMatch(/marker-unstyled/);
  });

  it("reads styles once and re-reads after an invalidation", () => {
    const styles = makeStyles(".marker.marker-a { background-color: rgb(255, 0, 0); }");
    let reads = 0;
    const read = styles.read.bind(styles);
    styles.read = (...args) => {
      reads++;
      return read(...args);
    };

    styles.styleFor("marker marker-a", 10, 100);
    styles.styleFor("marker marker-a", 10, 100);
    expect(reads).toBe(1);

    styles.invalidate();
    styles.styleFor("marker marker-a", 10, 100);
    expect(reads).toBe(2);
  });

  it("re-resolves percentage styles for every class after width or height changes", () => {
    const styles = makeStyles(`
      .marker.marker-a { position: absolute; width: 50%; min-height: 25%; background: red; }
      .marker.marker-b { position: absolute; width: 25%; min-height: 50%; background: blue; }
    `);
    const size = (width, height) => {
      styles.element.style.cssText = `position: relative; width: ${width}px; height: ${height}px;`;
    };
    const read = spyOn(styles, "read").and.callThrough();
    size(20, 40);
    expect(styles.styleFor("marker marker-a", 20, 40).width).toBe(10);
    expect(styles.styleFor("marker marker-b", 20, 40).width).toBe(5);
    expect(read).toHaveBeenCalledTimes(2);

    size(40, 40);
    const wideA = styles.styleFor("marker marker-a", 40, 40);
    const wideB = styles.styleFor("marker marker-b", 40, 40);
    expect(wideA.width).toBe(20);
    expect(wideB.width).toBe(10);
    expect(read).toHaveBeenCalledTimes(4);

    size(40, 80);
    const tallA = styles.styleFor("marker marker-a", 40, 80);
    const tallB = styles.styleFor("marker marker-b", 40, 80);
    expect(tallA.minHeight).toBe(20);
    expect(tallB.minHeight).toBe(40);
    expect(read).toHaveBeenCalledTimes(6);

    expect(styles.styleFor("marker marker-a", 40, 80)).toBe(tallA);
    expect(styles.styleFor("marker marker-b", 40, 80)).toBe(tallB);
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("repaints resized marker geometry and prunes classes without losing the new style cache", () => {
    const styles = makeStyles(`
      .marker.marker-a, .marker.marker-b { position: absolute; width: 50%; min-height: 25%; background: red; }
    `);
    const canvas = createCanvas();
    const read = spyOn(styles, "read").and.callThrough();
    styles.element.style.cssText = "position: relative; width: 20px; height: 40px;";
    drawRegions(
      canvas,
      styles,
      [
        { y: 0, className: "marker marker-a" },
        { y: 12, className: "marker marker-b" },
      ],
      20,
      40,
    );
    expect(canvas.fills.map(({ width, height }) => [width, height])).toEqual([
      [10, 10],
      [10, 10],
    ]);

    styles.element.style.cssText = "position: relative; width: 40px; height: 80px;";
    const regions = [{ y: 0, className: "marker marker-a" }];
    drawRegions(canvas, styles, regions, 40, 80);
    expect(canvas.fills[2].width).toBe(20);
    expect(canvas.fills[2].height).toBe(20);
    expect([...styles.probes.keys()]).toEqual(["marker marker-a"]);
    expect([...styles.cache.keys()]).toEqual(["marker marker-a"]);
    drawRegions(canvas, styles, regions, 40, 80);
    expect(read).toHaveBeenCalledTimes(3);
  });

  // The digest exists so a restyle that misses the markers costs nothing.
  it("moves the signature only when a marker's own styling moves", () => {
    const styles = makeStyles(".marker.marker-a { background-color: rgb(255, 0, 0); }");
    styles.styleFor("marker marker-a", 10, 100);
    const before = styles.signature(10, 100);

    const unrelated = styleSheet(".something-else { color: rgb(9, 9, 9); }");
    expect(styles.signature(10, 100)).toBe(before);
    unrelated.remove();

    styleSheet(".marker.marker-a { background-color: rgb(0, 0, 255); }");
    expect(styles.signature(10, 100)).not.toBe(before);
  });

  it("drops probes for classes nothing draws any more", () => {
    const styles = makeStyles(
      ".marker.marker-a, .marker.marker-b { background-color: rgb(1, 1, 1); }",
    );
    const canvas = createCanvas();

    drawRegions(
      canvas,
      styles,
      [
        { y: 0, height: 1, className: "marker marker-a" },
        { y: 2, height: 1, className: "marker marker-b" },
      ],
      10,
      100,
    );
    expect(styles.probes.size).toBe(2);

    drawRegions(canvas, styles, [{ y: 0, height: 1, className: "marker marker-a" }], 10, 100);

    expect([...styles.probes.keys()]).toEqual(["marker marker-a"]);
  });
});
