"use strict";

// A pair of throttled functions sharing one timer, where the first outranks the
// second: while a call to `fns[0]` is pending, calls to `fns[1]` are dropped,
// and a pending `fns[1]` is replaced by `fns[0]`. Recomputing a layer's items
// makes redrawing it redundant, so the cheaper call must never cancel the
// costlier one.
//
// The last argument is the interval in milliseconds.
function throttles(...args) {
  const timeout = args.pop();
  let timer = null;
  let level = -1;
  const fns = args.map((func, i) => () => {
    if (timer && level <= i) return;
    if (timer) clearTimeout(timer);
    level = i;
    timer = setTimeout(() => {
      timer = null;
      level = -1;
      func();
    }, timeout);
  });
  fns.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      level = -1;
    }
  };
  return fns;
}

// Collapse a burst of calls into a single one on the next microtask.
//
// Unlike a throttle, the callback still runs within the task that scheduled it,
// so what it paints lands before the browser's next rendering opportunity. That
// matters for the theme: the swap attaches its stylesheets inside a View
// Transition, which snapshots the whole window -- canvases included -- one frame
// later. A repaint deferred to a timer or an animation frame misses that
// snapshot, and the markers visibly pop to their new colors once the 0.25s
// cross-fade has already finished.
function coalesce(callback) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      callback(...args);
    });
  };
}

module.exports = { coalesce, throttles };
