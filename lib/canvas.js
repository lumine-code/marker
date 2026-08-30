"use strict";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

function resolveLength(value, basis, fallback = 0) {
  if (!value || value === "auto") {
    return fallback;
  }
  if (value.endsWith("%")) {
    return (parseFloat(value) / 100) * basis;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resizeCanvas(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

// Resolves what a marker looks like by asking the stylesheets.
//
// A hidden probe element carries the marker's classes, and `getComputedStyle`
// answers with the color, opacity, width, offset and stacking the cascade
// produced. That is what lets a layer package ship one ordinary CSS rule and
// have both maps paint it identically, and lets a user restyle a layer without
// the package knowing.
//
// The probe lives inside the renderer, so the width it reports is a share of
// *that* map: the same `20%` is a few pixels of scrollbar and a slab of minimap.
class MarkerStyles {
  /**
   * @param {object} [options]
   * @param {string} [options.resolverClass] Class for the container the probes live in.
   * @param {string} [options.probeClass] Class added to every probe.
   * @param {string} [options.label] Name used when warning about an invisible layer.
   */
  constructor({
    resolverClass = "marker-style-resolver",
    probeClass = "marker-style-probe",
    label = "marker",
  } = {}) {
    this.probeClass = probeClass;
    this.label = label;
    this.probes = new Map();
    this.cache = new Map();
    this.warned = new Set();

    this.element = document.createElement("div");
    this.element.className = resolverClass;
  }

  probeFor(className) {
    let probe = this.probes.get(className);
    if (!probe) {
      probe = document.createElement("div");
      probe.className = `${className} ${this.probeClass}`;
      this.element.appendChild(probe);
      this.probes.set(className, probe);
    }
    return probe;
  }

  read(className, width, height) {
    const probe = this.probeFor(className);
    const computed = getComputedStyle(probe);
    const probeWidth = probe.offsetWidth || resolveLength(computed.width, width, width);
    const probeHeight = probe.offsetHeight || resolveLength(computed.height, height, 1);
    const zIndex = parseInt(computed.zIndex, 10);

    return {
      x: probe.offsetLeft || 0,
      width: Math.max(1, probeWidth),
      minHeight: Math.max(1, resolveLength(computed.minHeight, height, 1)),
      height: Math.max(0, probeHeight),
      color: computed.backgroundColor,
      opacity: Number.isFinite(parseFloat(computed.opacity)) ? parseFloat(computed.opacity) : 1,
      zIndex: Number.isFinite(zIndex) ? zIndex : 0,
    };
  }

  // Reading a probe costs a synchronous layout, and a map redraws on every
  // scroll frame, so the answer is kept until something can change it: a
  // restyle, or a resize that moves what a percentage means.
  styleFor(className, width, height) {
    let style = this.cache.get(className);
    if (style === undefined) {
      style = this.read(className, width, height);
      this.cache.set(className, style);
      this.warnIfInvisible(className, style);
    }
    return style;
  }

  // A marker with no background color is not an error anywhere: it is simply
  // never drawn. That silence is the single most confusing way for a layer to
  // fail -- most often a stylesheet still scoped to the other renderer -- so say
  // it once, with the class that resolved to nothing.
  warnIfInvisible(className, style) {
    if (style.color && style.color !== TRANSPARENT) {
      return;
    }
    if (this.warned.has(className)) {
      return;
    }
    this.warned.add(className);
    console.warn(
      `${this.label}: "${className}" resolves to no background color, so it draws nothing. ` +
        `A layer stylesheet should set color, opacity and z-index on its own classes, ` +
        `without scoping them to one renderer.`,
    );
  }

  // A digest of everything a draw reads off the probes. Comparing two digests
  // answers the only question a stylesheet change raises: would drawing again
  // put different pixels on the canvas? It deliberately re-reads rather than
  // using the cache, since the point is to detect that the cache is stale.
  signature(width, height) {
    if (!this.probes.size) {
      return "";
    }
    const parts = [];
    for (const className of this.probes.keys()) {
      parts.push(`${className}:${Object.values(this.read(className, width, height)).join(",")}`);
    }
    return parts.join("|");
  }

  invalidate() {
    this.cache.clear();
  }

  // Drops probes for classes nothing draws any more. Called after a draw, not
  // during one, so a layer that alternates between two classes does not thrash.
  prune(classNames) {
    for (const [className, probe] of this.probes) {
      if (!classNames.has(className)) {
        probe.remove();
        this.probes.delete(className);
        this.cache.delete(className);
      }
    }
  }

  destroy() {
    this.probes.clear();
    this.cache.clear();
    this.element.remove();
  }
}

// Fills marker regions on a canvas, ordered by the z-index their stylesheets
// asked for. Regions are `{ y, height, className }` in CSS pixels.
function drawRegions(canvas, styles, regions, width, height) {
  const ctx = resizeCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);

  const classNames = new Set(regions.map((region) => region.className));

  const sorted = regions
    .map((region, index) => ({
      ...region,
      index,
      style: styles.styleFor(region.className, width, height),
    }))
    .filter(({ style }) => style.color && style.color !== TRANSPARENT)
    .sort((a, b) => a.style.zIndex - b.style.zIndex || a.index - b.index);

  for (const region of sorted) {
    const { style } = region;
    const markerHeight = Math.max(style.minHeight, region.height || style.height || 1);
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = style.color;
    ctx.fillRect(style.x, region.y, style.width, markerHeight);
  }
  ctx.globalAlpha = 1;

  styles.prune(classNames);
}

// A canvas with its own style resolver, for a renderer that draws markers and
// nothing else.
class MarkerCanvas {
  /**
   * @param {object} options
   * @param {string} options.className Class of the root element.
   * @param {string} [options.canvasClass] Defaults to `<className>-canvas`.
   * @param {string} [options.resolverClass] Defaults to `<className>-style-resolver`.
   * @param {string} [options.probeClass] Defaults to `<className>-style-probe`.
   */
  constructor({ className, canvasClass, resolverClass, probeClass }) {
    this.styles = new MarkerStyles({
      resolverClass: resolverClass ?? `${className}-style-resolver`,
      probeClass: probeClass ?? `${className}-style-probe`,
      label: className,
    });

    this.element = document.createElement("div");
    this.element.className = className;

    this.canvas = document.createElement("canvas");
    this.canvas.className = canvasClass ?? `${className}-canvas`;
    this.element.appendChild(this.canvas);
    this.element.appendChild(this.styles.element);
  }

  draw(regions, width, height) {
    drawRegions(this.canvas, this.styles, regions, width, height);
  }

  signature(width, height) {
    return this.styles.signature(width, height);
  }

  invalidate() {
    this.styles.invalidate();
  }

  destroy() {
    this.styles.destroy();
    this.element.remove();
  }
}

module.exports = {
  MarkerCanvas,
  MarkerStyles,
  drawRegions,
  resolveLength,
  resizeCanvas,
};
