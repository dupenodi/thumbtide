// GPU slowdown for the performance sandbox, injected into the page before any game code runs.
//
// A desktop graphics chip is 40–300× faster than a TV's, so the sandbox makes it do more of the same work: after
// each draw call, the same draw runs (K − 1) more times into a hidden framebuffer of the same size, in one
// instanced call. Every draw then costs about K times as much, in proportion to its own shader and its own
// pixels. The browser holds back animation frames while the graphics chip is busy, so the game sees slow frames,
// as it would on the TV, and its automatic resolution reacts to them.
//
// Limits: draws that are instanced already repeat with a capped loop; the hidden draws need a colour target, so
// a draw into a depth-only framebuffer is not repeated.
//
// Usage: page.addInitScript({ path }) after page.addInitScript(`window.__gpuSlowdown = K`).
/* eslint-disable no-var */
(function () {
  "use strict";
  var K = Number(window.__gpuSlowdown) || 1;
  if (K <= 1) return;
  var MAX_LOOP = 64; // repeats of a draw that is instanced already
  var stats = (window.__gpuSlowdownStats = { draws: 0, repeats: 0, skipped: 0 });

  function patch(proto, isGl2) {
    if (!proto || proto.__slowed) return;
    proto.__slowed = true;
    var orig = {};
    ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"].forEach(function (n) {
      if (proto[n]) orig[n] = proto[n];
    });

    /**
     * Per context: hidden framebuffers by size, the fraction of a repeat carried over, WebGL 1's instancing, and the
     * game's framebuffer and viewport (tracked here: reading them back from WebGL on every draw costs too much).
     */
    function state(gl) {
      var s = gl.__slow;
      if (!s) {
        var vp = gl.getParameter(gl.VIEWPORT);
        s = gl.__slow = {
          fbos: {},
          carry: 0,
          inst: isGl2 ? null : gl.getExtension("ANGLE_instanced_arrays"),
          fb: gl.getParameter(isGl2 ? gl.DRAW_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING),
          w: vp[0] + vp[2],
          h: vp[1] + vp[3],
        };
      }
      return s;
    }

    var bindFramebuffer = proto.bindFramebuffer;
    proto.bindFramebuffer = function (target, fb) {
      bindFramebuffer.call(this, target, fb);
      if (target === this.FRAMEBUFFER || target === 0x8ca9 /* DRAW_FRAMEBUFFER */) state(this).fb = fb;
    };
    var viewport = proto.viewport;
    proto.viewport = function (x, y, w, h) {
      viewport.call(this, x, y, w, h);
      var s = state(this);
      s.w = Math.max(1, x + w);
      s.h = Math.max(1, y + h);
    };

    function scratch(gl, s, w, h) {
      var key = w + "x" + h;
      var f = s.fbos[key];
      if (f) return f;
      var prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      var prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      f = gl.createFramebuffer();
      bindFramebuffer.call(gl, gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      bindFramebuffer.call(gl, gl.FRAMEBUFFER, prevFb);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      s.fbos[key] = f;
      return f;
    }

    /** How many extra draws this call gets: K − 1 on average, carrying the fraction to the next call. */
    function extra(s) {
      s.carry += K - 1;
      var n = Math.floor(s.carry);
      s.carry -= n;
      return n;
    }

    /** Run `again(count)` into the hidden framebuffer, then put the game's framebuffer back. */
    function repeat(gl, n, again) {
      if (n <= 0) return;
      var s = state(gl);
      var target = isGl2 ? gl.DRAW_FRAMEBUFFER : gl.FRAMEBUFFER;
      bindFramebuffer.call(gl, target, scratch(gl, s, s.w, s.h));
      again(n);
      bindFramebuffer.call(gl, target, s.fb);
      stats.repeats += n;
    }

    proto.drawArrays = function (mode, first, count) {
      orig.drawArrays.call(this, mode, first, count);
      stats.draws++;
      var gl = this;
      var s = state(gl);
      repeat(gl, extra(s), function (n) {
        if (isGl2) orig.drawArraysInstanced.call(gl, mode, first, count, n);
        else if (s.inst) s.inst.drawArraysInstancedANGLE(mode, first, count, n);
        else for (var i = 0; i < Math.min(n, MAX_LOOP); i++) orig.drawArrays.call(gl, mode, first, count);
      });
    };
    proto.drawElements = function (mode, count, type, offset) {
      orig.drawElements.call(this, mode, count, type, offset);
      stats.draws++;
      var gl = this;
      var s = state(gl);
      repeat(gl, extra(s), function (n) {
        if (isGl2) orig.drawElementsInstanced.call(gl, mode, count, type, offset, n);
        else if (s.inst) s.inst.drawElementsInstancedANGLE(mode, count, type, offset, n);
        else for (var i = 0; i < Math.min(n, MAX_LOOP); i++) orig.drawElements.call(gl, mode, count, type, offset);
      });
    };
    if (orig.drawRangeElements) {
      proto.drawRangeElements = function (mode, start, end, count, type, offset) {
        orig.drawRangeElements.call(this, mode, start, end, count, type, offset);
        stats.draws++;
        var gl = this;
        repeat(gl, extra(state(gl)), function (n) {
          orig.drawElementsInstanced.call(gl, mode, count, type, offset, n);
        });
      };
    }
    // already instanced: repeat the whole instanced draw, a capped number of times
    if (orig.drawArraysInstanced) {
      proto.drawArraysInstanced = function (mode, first, count, instances) {
        orig.drawArraysInstanced.call(this, mode, first, count, instances);
        stats.draws++;
        var gl = this;
        repeat(gl, extra(state(gl)), function (n) {
          for (var i = 0; i < Math.min(n, MAX_LOOP); i++) orig.drawArraysInstanced.call(gl, mode, first, count, instances);
          if (n > MAX_LOOP) stats.skipped += n - MAX_LOOP;
        });
      };
    }
    if (orig.drawElementsInstanced) {
      proto.drawElementsInstanced = function (mode, count, type, offset, instances) {
        orig.drawElementsInstanced.call(this, mode, count, type, offset, instances);
        stats.draws++;
        var gl = this;
        repeat(gl, extra(state(gl)), function (n) {
          for (var i = 0; i < Math.min(n, MAX_LOOP); i++) orig.drawElementsInstanced.call(gl, mode, count, type, offset, instances);
          if (n > MAX_LOOP) stats.skipped += n - MAX_LOOP;
        });
      };
    }
  }

  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype, false);
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, true);
})();
