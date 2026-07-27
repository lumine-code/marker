"use strict";

// Sort by document position and merge items on adjacent rows that share the same
// cls and position, so providers can return raw ranges.
function mergeItems(items) {
  items.sort(
    (a, b) =>
      a.row - b.row ||
      (a.end ?? a.row) - (b.end ?? b.row) ||
      (a.cls ?? "").localeCompare(b.cls ?? ""),
  );
  const merged = [];
  let lastItem = null;
  for (const item of items) {
    if (
      lastItem &&
      (item.cls ?? "") === (lastItem.cls ?? "") &&
      (item.position ?? "") === (lastItem.position ?? "") &&
      item.row <= (lastItem.end ?? lastItem.row) + 1
    ) {
      lastItem.end = Math.max(lastItem.end ?? lastItem.row, item.end ?? item.row);
    } else {
      if (lastItem) merged.push(lastItem);
      lastItem = item;
    }
  }
  if (lastItem) merged.push(lastItem);
  return merged;
}

// Turn what a provider returned into the array every renderer draws.
//
// The copy is not incidental: providers are told they may hand back a cached
// array, so merging has to work on items this function owns. The layer's
// threshold is deliberately not applied here -- hiding a noisy layer is a
// draw-time decision each renderer scales for itself.
function normalizeItems(items, props) {
  let out = items.map((item) => ({ ...item }));
  if (props.merge) {
    out = mergeItems(out);
  }
  return out;
}

// The class string every renderer resolves colors through.
//
// It has to be identical on both maps: it is what makes one stylesheet rule in a
// layer package paint the same color on a scrollbar strip and on a minimap.
function classNameFor(props, item) {
  let className = `marker marker-${props.name}`;
  const position = item.position ?? props.position;
  if (position) {
    className += ` ${position}`;
  }
  if (item.cls) {
    className += ` ${item.cls}`;
  }
  return className;
}

module.exports = { classNameFor, mergeItems, normalizeItems };
