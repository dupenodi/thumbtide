// Hardware probe: the same fixed workloads run on the TV and on the computer, so the two can be compared.
//
// Plain script, no build step and no modules: it must run as-is from file:// on webOS 6+ (Chromium 79+).
// Results go to window.__probe (read by Playwright), to the screen, and, when a `report` URL is given
// (?report=… or the webOS launch parameters), are POSTed there.
/* eslint-disable no-var */
(function () {
  "use strict";

  var W = 1920;
  var H = 1080;
  var out = document.getElementById("out");
  var log = function (s) {
    out.textContent += s + "\n";
  };

  function param(name) {
    var v = new URLSearchParams(location.search).get(name);
    if (v !== null) return v;
    try {
      var p = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || "{}");
      return p[name] == null ? null : String(p[name]);
    } catch (e) {
      return null;
    }
  }

  var now = function () {
    return performance.now();
  };
  var median = function (a) {
    var s = a.slice().sort(function (x, y) {
      return x - y;
    });
    return s[Math.floor(s.length / 2)];
  };
  var round = function (v, d) {
    var m = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * m) / m;
  };
  var nextFrame = function () {
    return new Promise(function (r) {
      requestAnimationFrame(function () {
        r();
      });
    });
  };
  /** Median time of `fn` over `runs` runs, after one warm-up run. */
  function timeIt(fn, runs) {
    fn();
    var t = [];
    for (var i = 0; i < (runs || 5); i++) {
      var a = now();
      fn();
      t.push(now() - a);
    }
    return round(median(t));
  }

  // ------------------------------------------------------------------ CPU
  var sink = 0;
  var cpu = {
    // float maths in a tight loop: game simulations, physics, easing
    math: function () {
      var s = 0;
      for (var i = 0; i < 2000000; i++) s += Math.sin(i * 0.001) * Math.sqrt(i + 1);
      sink += s;
    },
    // many short-lived objects: particles, messages, the garbage collector
    objects: function () {
      var a = [];
      for (var i = 0; i < 100000; i++) a.push({ x: i, y: -i, vx: 1, vy: 0.5, life: 1 });
      for (var k = 0; k < 8; k++) {
        for (var j = 0; j < a.length; j++) {
          var p = a[j];
          p.x += p.vx;
          p.y += p.vy;
          p.life *= 0.98;
        }
      }
      sink += a[500].x;
    },
    // typed arrays: buffer updates for the graphics chip
    typed: function () {
      var n = 500000;
      var a = new Float32Array(n);
      var b = new Float32Array(n);
      for (var k = 0; k < 20; k++) for (var i = 0; i < n; i++) a[i] = a[i] * 0.5 + b[i] + k;
      sink += a[7];
    },
    // JSON: network messages between the TV and the phones
    json: function () {
      var st = [];
      for (var i = 0; i < 400; i++) st.push({ id: i, name: "p" + i, x: i * 1.5, y: i * 2.5, tags: ["a", "b"], on: i % 2 === 0 });
      for (var k = 0; k < 20; k++) sink += JSON.parse(JSON.stringify(st)).length;
    },
    // style + layout: the HTML parts of a game screen (HUD, menus)
    dom: function () {
      var host = document.getElementById("scratch");
      for (var k = 0; k < 4; k++) {
        var frag = document.createDocumentFragment();
        for (var i = 0; i < 300; i++) {
          var d = document.createElement("div");
          d.className = "chip";
          d.style.transform = "translate(" + (i % 40) * 10 + "px," + Math.floor(i / 40) * 10 + "px)";
          d.textContent = "Player " + i;
          frag.appendChild(d);
        }
        host.appendChild(frag);
        sink += host.offsetHeight;
        host.textContent = "";
      }
    },
  };

  function runCpu() {
    var r = {};
    Object.keys(cpu).forEach(function (k) {
      r[k] = timeIt(cpu[k], 5);
    });
    return r;
  }

  // ------------------------------------------------------------------ WebGL
  function compile(gl, vs, fs) {
    var p = gl.createProgram();
    [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ].forEach(function (s) {
      var sh = gl.createShader(s[0]);
      gl.shaderSource(sh, s[1]);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    });
    gl.bindAttribLocation(p, 0, "pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  var VS = "attribute vec2 pos; uniform vec4 xf; varying vec2 uv;" + "void main(){ uv = pos*0.5+0.5; gl_Position = vec4(pos*xf.xy+xf.zw,0.,1.); }";
  var FS_FLAT = "precision highp float; varying vec2 uv; uniform vec4 col;" + "void main(){ gl_FragColor = vec4(col.rgb*uv.x, col.a); }";
  var FS_ALU =
    "precision highp float; varying vec2 uv; uniform vec4 col;" +
    "void main(){ float c = uv.x; for (int i = 0; i < 24; i++) { c = sin(c*1.3+uv.y)*cos(c*0.7+uv.x)+0.01*float(i); }" +
    " gl_FragColor = vec4(vec3(c)*col.rgb, col.a); }";
  var FS_TEX =
    "precision highp float; varying vec2 uv; uniform sampler2D tex; uniform vec4 col;" +
    "void main(){ vec4 s = vec4(0.);" +
    " for (int i = 0; i < 8; i++) { s += texture2D(tex, uv*1.7 + vec2(float(i)*0.031, float(i)*0.017)); }" +
    " gl_FragColor = vec4(s.rgb*0.125*col.rgb, col.a); }";

  function glInfo(gl, gl2) {
    var dbg = gl.getExtension("WEBGL_debug_renderer_info");
    var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    var info = {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewport: Array.prototype.slice.call(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
      maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxVaryings: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      maxVertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      fragmentHighp: hp ? { precision: hp.precision, rangeMin: hp.rangeMin, rangeMax: hp.rangeMax } : null,
      webgl2: !!gl2,
      maxSamples: gl2 ? gl2.getParameter(gl2.MAX_SAMPLES) : 0,
      extensions: gl.getSupportedExtensions(),
      extensions2: gl2 ? gl2.getSupportedExtensions() : [],
    };
    return info;
  }

  function quad(gl) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  var px = new Uint8Array(4);
  /** Wait until the graphics chip has finished everything queued so far. */
  var sync = function (gl) {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };

  /** Least-squares slope and intercept of y over x. */
  function fit(xs, ys) {
    var n = xs.length;
    var mx = 0;
    var my = 0;
    for (var i = 0; i < n; i++) {
      mx += xs[i] / n;
      my += ys[i] / n;
    }
    var num = 0;
    var den = 0;
    for (var j = 0; j < n; j++) {
      num += (xs[j] - mx) * (ys[j] - my);
      den += (xs[j] - mx) * (xs[j] - mx);
    }
    var slope = num / den;
    return { slope: slope, intercept: my - slope * mx };
  }

  /** Milliseconds per full-screen (1920x1080) layer drawn with `prog`, blended so tile-based chips can't skip any. */
  function layerCost(gl, prog, counts) {
    gl.useProgram(prog);
    gl.uniform4f(gl.getUniformLocation(prog, "xf"), 1, 1, 0, 0);
    gl.uniform4f(gl.getUniformLocation(prog, "col"), 0.9, 0.6, 0.3, 0.05);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    var draw = function (n) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 6);
      sync(gl);
    };
    draw(2);
    var xs = [];
    var ys = [];
    counts.forEach(function (n) {
      var t = [];
      for (var r = 0; r < 3; r++) {
        var a = now();
        draw(n);
        t.push(now() - a);
      }
      xs.push(n);
      ys.push(median(t));
    });
    gl.disable(gl.BLEND);
    var f = fit(xs, ys);
    return { msPerLayer: round(f.slope, 3), overheadMs: round(f.intercept, 2), mpixPerSec: round((W * H) / 1000 / f.slope, 0) };
  }

  function runGpu() {
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0.02;pointer-events:none";
    document.body.appendChild(canvas);
    var attrs = { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    var gl2 = null;
    try {
      gl2 = document.createElement("canvas").getContext("webgl2");
    } catch (e) {
      /* none */
    }
    var gl = canvas.getContext("webgl", attrs);
    if (!gl) return { info: null, error: "no WebGL" };
    var info = glInfo(gl, gl2);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    quad(gl);

    var flat = compile(gl, VS, FS_FLAT);
    var alu = compile(gl, VS, FS_ALU);
    var texp = compile(gl, VS, FS_TEX);

    var res = { info: info };
    res.fill = layerCost(gl, flat, [8, 16, 32, 48]);
    res.alu = layerCost(gl, alu, [2, 4, 6, 8]);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    var img = new Uint8Array(512 * 512 * 4);
    for (var i = 0; i < img.length; i++) img[i] = (i * 2654435761) >>> 24;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    res.texture = layerCost(gl, texp, [2, 4, 8, 12]);

    // draw calls: many tiny quads, one uniform change each (what a scene of separate objects costs)
    gl.useProgram(flat);
    var xf = gl.getUniformLocation(flat, "xf");
    var col = gl.getUniformLocation(flat, "col");
    var calls = function (n) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var i = 0; i < n; i++) {
        gl.uniform4f(xf, 0.01, 0.01, ((i % 100) / 50) - 1, (Math.floor(i / 100) % 100) / 50 - 1);
        gl.uniform4f(col, (i % 7) / 7, 0.5, 0.5, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      sync(gl);
    };
    calls(200);
    var dc = fit(
      [500, 1000, 2000],
      [500, 1000, 2000].map(function (n) {
        return timeIt(function () {
          calls(n);
        }, 3);
      }),
    );
    res.drawCalls = { usPerCall: round(dc.slope * 1000, 2) };

    // texture upload: what a new board or a canvas-to-texture HUD costs
    var big = new Uint8Array(1024 * 1024 * 4);
    res.upload = {
      ms1024: timeIt(function () {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, big);
        gl.useProgram(texp);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        sync(gl);
      }, 4),
    };

    // shader compile + link: the hitch when a new effect appears for the first time
    var n = 0;
    res.compile = {
      msPerProgram: timeIt(function () {
        n++;
        var p = compile(gl, VS, FS_ALU.replace("0.01*float(i)", "0.0" + n + "*float(i)"));
        gl.useProgram(p);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        sync(gl);
      }, 4),
    };

    res.canvas = canvas;
    res.gl = gl;
    return res;
  }

  // ------------------------------------------------------------------ Canvas 2D
  function run2d() {
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    var g = c.getContext("2d");
    return {
      msPerFrame: timeIt(function () {
        g.clearRect(0, 0, W, H);
        for (var i = 0; i < 800; i++) {
          g.fillStyle = "hsl(" + (i % 360) + ",70%,50%)";
          g.fillRect((i * 37) % W, (i * 91) % H, 60, 40);
        }
        g.font = "32px sans-serif";
        for (var j = 0; j < 80; j++) g.fillText("Score " + j, (j * 113) % W, (j * 57) % H);
        g.getImageData(0, 0, 1, 1);
      }, 5),
    };
  }

  // ------------------------------------------------------------------ frame pacing
  /** rAF intervals for `ms`, while clearing a full-screen WebGL canvas each frame (the cheapest possible game). */
  function pacing(gl, ms) {
    return new Promise(function (resolve) {
      var ts = [];
      var start = now();
      var tick = function (t) {
        ts.push(t);
        if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
        if (now() - start < ms) requestAnimationFrame(tick);
        else {
          var d = [];
          for (var i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
          d.sort(function (a, b) {
            return a - b;
          });
          var mean = (ts[ts.length - 1] - ts[0]) / d.length;
          resolve({ hz: round(1000 / mean, 1), meanMs: round(mean), p95Ms: round(d[Math.floor(d.length * 0.95)]), maxMs: round(d[d.length - 1]) });
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // ------------------------------------------------------------------ compositing + raster
  /** Mean rAF interval over `ms` while `each(t)` runs every frame. */
  function frameMs(ms, each) {
    return new Promise(function (resolve) {
      var ts = [];
      var start = now();
      var tick = function (t) {
        ts.push(t);
        each(t);
        // at least 4 frames, however slow they are (the first one is not counted: it may start mid-frame)
        if (now() - start < ms || ts.length < 4) requestAnimationFrame(tick);
        else resolve(round((ts[ts.length - 1] - ts[1]) / (ts.length - 2)));
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * What the browser's own drawing costs, outside WebGL: full-screen layers that only move (the compositor blends
   * them, every frame) and a full-screen area that is repainted every frame (raster, then compositing).
   */
  async function runCompositing() {
    var host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none";
    document.body.appendChild(host);
    var layers = [];
    var r = { layersMs: {} };
    r.layersMs[0] = await frameMs(1500, function () {});
    for (var n = 1; n <= 8; n *= 2) {
      while (layers.length < n) {
        var d = document.createElement("div");
        d.style.cssText = "position:absolute;inset:0;will-change:transform;opacity:0.5;background:linear-gradient(90deg,#f0a,#0af)";
        host.appendChild(d);
        layers.push(d);
      }
      r.layersMs[n] = await frameMs(1500, function (t) {
        for (var i = 0; i < layers.length; i++) layers[i].style.transform = "translateX(" + ((t / 8 + i * 3) % 4) + "px)";
      });
    }
    // least-squares cost of one more full-screen layer
    var xs = [1, 2, 4, 8];
    r.msPerLayer = round(
      fit(
        xs,
        xs.map(function (n) {
          return r.layersMs[n];
        }),
      ).slope,
      2,
    );
    host.textContent = "";
    var paint = document.createElement("div");
    paint.style.cssText = "position:absolute;inset:0";
    host.appendChild(paint);
    r.repaintMs = await frameMs(2000, function (t) {
      paint.style.background = "radial-gradient(circle at " + ((t / 10) % 100) + "% 50%, #fa0, #20f 60%)";
    });
    host.remove();
    return r;
  }

  // ------------------------------------------------------------------ run
  async function main() {
    var result = {
      when: new Date().toISOString(),
      env: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio: devicePixelRatio,
        jsHeapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
        webOS: !!window.PalmSystem,
      },
    };
    log("Thumbtide hardware probe");
    log(navigator.userAgent);
    await nextFrame();
    await nextFrame();

    log("CPU…");
    result.cpu = runCpu();
    log(JSON.stringify(result.cpu));
    await nextFrame();

    log("Graphics…");
    var g;
    try {
      g = runGpu();
    } catch (e) {
      g = { error: String(e && e.message ? e.message : e) };
    }
    var gl = g.gl;
    var canvas = g.canvas;
    delete g.gl;
    delete g.canvas;
    result.gpu = g;
    log(JSON.stringify({ renderer: g.info && (g.info.unmaskedRenderer || g.info.renderer), fill: g.fill, alu: g.alu, texture: g.texture, drawCalls: g.drawCalls }));
    await nextFrame();

    log("Canvas 2D…");
    result.canvas2d = run2d();
    log(JSON.stringify(result.canvas2d));

    log("Frame pacing (3s)…");
    result.pacing = await pacing(gl, 3000);
    log(JSON.stringify(result.pacing));
    if (canvas) canvas.remove();

    log("Compositing + raster…");
    result.compositing = await runCompositing();
    log(JSON.stringify(result.compositing));

    result.sink = sink % 1; // keep the CPU work from being optimised away
    window.__probe = result;
    var to = param("report");
    if (to) {
      try {
        await fetch(to, { method: "POST", mode: "no-cors", body: JSON.stringify(result) });
        log("Sent to " + to);
      } catch (e) {
        log("Couldn't send: " + e);
      }
    }
    log("Done.");
    document.title = "probe:done";
  }

  main().catch(function (e) {
    window.__probe = { error: String(e && e.stack ? e.stack : e) };
    log("Error: " + e);
    document.title = "probe:done";
  });
})();
