// Surfaces that never change (wood grain, agar) are drawn once into a texture laid over the ground, so the
// graphics chip doesn't work out the same noise for every pixel, every frame.
import * as THREE from "three";

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** A rectangle of ground, in world x and z. */
export interface Area {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The texture coordinate of a ground point, for a shader sampling a baked texture over `a`. */
export const areaUniform = (a: Area) => new THREE.Vector4(a.x0, a.z0, 1 / (a.x1 - a.x0), 1 / (a.z1 - a.z0));
export const AREA_UV = /* glsl */ `vec2 areaUv(vec2 p, vec4 a) { return (p - a.xy) * a.zw; }`;

/**
 * Draws a texture over `area` once, at `perUnit` texels to a unit. `head` holds GLSL functions; `body` reads
 * `vec2 p` (ground x, z) and sets gl_FragColor.
 */
export function bakeGround(
  renderer: THREE.WebGLRenderer,
  area: Area,
  perUnit: number,
  head: string,
  body: string,
  uniforms: Record<string, THREE.IUniform> = {},
) {
  const max = Math.min(2048, renderer.capabilities.maxTextureSize);
  const w = Math.max(4, Math.min(max, Math.ceil((area.x1 - area.x0) * perUnit)));
  const h = Math.max(4, Math.min(max, Math.ceil((area.z1 - area.z0) * perUnit)));
  const target = new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uFrom: { value: new THREE.Vector2(area.x0, area.z0) }, uTo: { value: new THREE.Vector2(area.x1, area.z1) } },
    vertexShader: VS,
    fragmentShader: `uniform vec2 uFrom;\nuniform vec2 uTo;\nvarying vec2 vUv;\n${head}\nvoid main() {\n  vec2 p = mix(uFrom, uTo, vUv);\n  ${body}\n}`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(before);
  quad.geometry.dispose();
  mat.dispose();
  return target;
}
