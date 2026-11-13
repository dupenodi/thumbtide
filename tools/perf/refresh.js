// Holds animation frames to the TV's refresh rate (60Hz) on a faster display, injected before any game code runs.
// On a 120Hz display, callbacks run on every other vsync; all callbacks of one frame get the same timestamp.
// On a display at the TV's rate or slower, frames pass through unchanged.
//
// Usage: page.addInitScript(`window.__refreshHz = 60`) before page.addInitScript({ path }).
/* eslint-disable no-var */
(function () {
  "use strict";
  var hz = Number(window.__refreshHz) || 60;
  var period = 1000 / hz;
  var raf = window.requestAnimationFrame.bind(window);
  var queue = [];
  var nextId = 1;
  var pumping = false;
  var due = 0; // the earliest time for the next frame

  function pump(t) {
    pumping = false;
    if (!queue.length) return;
    // 1ms slack: a vsync that lands a hair early still counts
    if (t + 1 < due) {
      pumping = true;
      raf(pump);
      return;
    }
    due = due + period > t ? due + period : t + period - 1;
    var run = queue;
    queue = [];
    for (var i = 0; i < run.length; i++) {
      if (run[i].cb) {
        try {
          run[i].cb(t);
        } catch (e) {
          setTimeout(function () {
            throw e;
          });
        }
      }
    }
  }

  window.requestAnimationFrame = function (cb) {
    var id = nextId++;
    queue.push({ id: id, cb: cb });
    if (!pumping) {
      pumping = true;
      raf(pump);
    }
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    for (var i = 0; i < queue.length; i++) if (queue[i].id === id) queue[i].cb = null;
  };
})();
