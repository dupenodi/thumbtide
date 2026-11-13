// The canvas. The world is painted into a picture first; this finishes its surface: the weave of the linen under
// thin paint, a little varnish, a vignette, and (at the end of a round) a sweep of fresh varnish across it.
// Adapted from "Oil paint" by @blendi (https://patch.gg/blendi/oil-paint), MIT: see LICENSE-oilpaint.txt.
import * as THREE from "three";
import type { Shared } from "./glsl.ts";

export function createFrame(renderer: THREE.WebGLRenderer, shared: Shared, { samples = 4 } = {}) {
  const size = new THREE.Vector2(1, 1);
  const target = new THREE.WebGLRenderTarget(1, 1, { samples, depthBuffer: true, generateMipmaps: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;

  const uniforms = {
    tNoise: shared.tNoise,
    tColor: { value: target.texture },
    uSize: { value: size.clone() },
    uCanvas: { value: 1 },
    uSweep: { value: -1 }, // -1 off, otherwise 0..1 across the picture
    uFade: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tNoise;
      uniform sampler2D tColor;
      uniform vec2 uSize;
      uniform float uCanvas;
      uniform float uSweep;
      uniform float uFade;
      in vec2 vUv;
      layout(location = 0) out vec4 outC;

      float weave(vec2 p) {
        // warp and weft of a medium linen, each thread a little uneven
        vec2 q = p / 2.6;
        float n = texture(tNoise, p / 310.0).r;
        float a = sin(q.x * 3.14159) * sin(q.y * 3.14159 + floor(q.x) * 3.14159);
        return a * (0.3 + 1.4 * n * n);
      }

      void main() {
        vec3 col = texture(tColor, vUv).rgb;
        if (uCanvas > 0.0) {
          vec2 px = vUv * uSize;
          float w = weave(px);
          float dx = weave(px + vec2(1.0, 0.0)) - w, dy = weave(px + vec2(0.0, 1.0)) - w;
          col *= 1.0 + (0.6 * dx - 0.8 * dy) * 0.022 * uCanvas + w * 0.006 * uCanvas;
        }
        // fresh varnish wiped across the finished painting
        if (uSweep >= 0.0) {
          float diag = (vUv.x * 0.8 + (1.0 - vUv.y) * 0.6) / 1.4;
          float band = exp(-pow((diag - uSweep * 1.3 + 0.15) * 9.0, 2.0));
          float streak = 0.7 + 0.6 * texture(tNoise, vec2(vUv.x * 3.0 - vUv.y * 2.0, vUv.y * 0.4)).r;
          col += vec3(1.0, 0.95, 0.85) * band * 0.22 * streak;
        }
        // the brightest passages roll off toward the white of the paint and never past it
        vec3 over = max(col - 0.8, 0.0);
        col = min(col, 0.8) + over / (1.0 + over * 5.0);
        // varnish: a little more depth in the darks, the lights left alone
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
        // the room falls off toward the edges of the view
        vec2 v = vUv - 0.5;
        col *= 1.0 - dot(v, v) * 0.55;
        outC = vec4(col * uFade, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const flat = new THREE.Camera();

  return {
    target,
    uniforms,
    setSize(w: number, h: number) {
      size.set(w, h);
      target.setSize(w, h);
      uniforms.uSize.value.copy(size);
    },
    render(world: THREE.Scene, camera: THREE.Camera) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(world, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, flat);
    },
  };
}
