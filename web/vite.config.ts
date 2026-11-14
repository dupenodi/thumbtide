import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** First LAN IPv4, so the QR code on the TV points somewhere a phone can reach in dev. */
function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
    }
  }
  return "localhost";
}

/**
 * Test-only code (the frame monitor, the perf sandbox's injected scripts) must never ship. Builds without
 * VITE_PERF=1 fail if any of its markers turn up in the bundle. See tools/perf.
 */
function noPerfCode(): Plugin {
  const markers = ["__thumbtidePerf", "__gpuSlowdown", "__refreshHz", "__probe"];
  return {
    name: "thumbtide:no-perf-code",
    apply: "build",
    generateBundle(_, bundle) {
      if (process.env.VITE_PERF === "1") return;
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const hit = markers.find((m) => chunk.code.includes(m));
        if (hit) this.error(`${file} contains perf-test code (${hit}). Keep it behind PERF_BUILD (src/shell/perf.ts).`);
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // `vite build --mode tv`: the TV page alone, packaged as an LG webOS app (scripts/tv.mjs).
  // It's opened from file://, so paths are relative and everything goes in one plain script:
  // TV browsers can refuse ES modules from file:// URLs.
  const tv = mode === "tv";
  return {
    base: tv ? "./" : "/",
    plugins: [noPerfCode()],
    define: {
      __LAN_IP__: JSON.stringify(command === "serve" ? lanIp() : ""),
    },
    server: { port: 5173, watch: { ignored: ["**/dist-tv/**"] } },
    build: tv
      ? {
          outDir: "dist-tv/app",
          emptyOutDir: true,
          // webOS 6 (2021 TVs) runs Chromium 79
          target: "chrome79",
          modulePreload: false,
          chunkSizeWarningLimit: 2000,
          rollupOptions: {
            input: resolve(__dirname, "index.html"),
            output: { format: "iife", inlineDynamicImports: true },
          },
        }
      : {
          // three.js (~150KB gzipped) is expected in the TV-only Wet Paint chunk; phones never load it.
          chunkSizeWarningLimit: 700,
          rollupOptions: {
            input: {
              host: resolve(__dirname, "index.html"),
              join: resolve(__dirname, "join/index.html"),
            },
          },
        },
  };
});
