"use strict";

function compareItems(a, b) {
  return (
    a.row - b.row || (a.end ?? a.row) - (b.end ?? b.row) || (a.cls ?? "").localeCompare(b.cls ?? "")
  );
}

function mergeSortedItems(items, copyItems) {
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
      lastItem = copyItems ? { ...item } : item;
    }
  }
  if (lastItem) merged.push(lastItem);
  return merged;
}

// Sort by document position and merge items on adjacent rows that share the same
// cls and position, so providers can return raw ranges.
function mergeItems(items) {
  return mergeSortedItems(items.sort(compareItems), false);
}

// Turn what a provider returned into the array every renderer draws.
//
// The copy is not incidental: providers are told they may hand back a cached
// array, so merging has to work on items this function owns. The layer's
// threshold is deliberately not applied here -- hiding a noisy layer is a
// draw-time decision each renderer scales for itself.
function normalizeItems(items, props) {
  if (props.merge) {
    // Sort references without touching the provider's array. Only survivors
    // need owned objects: a merged-away item is read but never retained.
    return mergeSortedItems(items.slice().sort(compareItems), true);
  }
  return items.map((item) => ({ ...item }));
}

// Whether two item arrays would draw identically.
//
// Compares the four fields the contract defines and the renderers read, so a
// recompute that reproduced the same markers can be recognized -- and not
// reported -- however many objects it allocated on the way.
function itemsEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.row !== y.row || x.end !== y.end || x.cls !== y.cls || x.position !== y.position) {
      return false;
    }
  }
  return true;
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

module.exports = { classNameFor, itemsEqual, mergeItems, normalizeItems };
