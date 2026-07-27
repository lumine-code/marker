const { MarkerStyles, drawRegions } = require("../lib/canvas");

describe("canvas", () => {
  let container, sheets;

  // What matters here is which regions reach the context, with what colour, in
  // what order -- a recording canvas keeps the assertions exact.
  function createCanvas() {
    const fills = [];
    return {
      fills,
      width: 0,
      height: 0,
      style: {},
      getContext() {
        return {
          globalAlpha: 1,
          fillStyle: "",
          setTransform() {},
          clearRect() {},
          fillRect(x, y, width, height) {
            fills.push({ x, y, width, height, color: this.fillStyle, alpha: this.globalAlpha });
          },
        };
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
