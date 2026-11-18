// One pooled particle system for every effect in Blast Party 3D: ONE draw call.
//  - An instanced quad; each particle is one instance in a ring buffer (the oldest is overwritten when it is full).
//  - The CPU only writes a particle when it is born (16 floats); the vertex shader moves it from its birth data
//    (position, velocity, gravity, drag, size and colour over its life) and the clock. Dead particles are moved
//    off-screen in the vertex shader, so there is no per-frame JavaScript loop over particles at all.
//  - Premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA): a particle's "add" share decides whether it glows (fire,
//    sparks: alpha 0 = pure additive) or covers (smoke, dust, debris), so both kinds share the draw and need no
//    sorting to look right.
//  - The sprite is a soft disc worked out in the fragment shader from the quad's corner (two multiplies, no texture,
//    no discard).
//  - Caps: 600 particles (300 in lite mode, which also halves each burst).
import * as THREE from "three";

const STRIDE = 16;
const VERT = /* glsl */ `
attribute vec4 iA; // birth position, birth time
attribute vec4 iB; // velocity, life
attribute vec4 iC; // colour, add (1 = glows, 0 = covers)
attribute vec4 iD; // size at birth, size at death, gravity, drag
uniform float uTime;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  float age = uTime - iA.w;
  float t = age / iB.w;
  vUv = position.xy;
  vCol = vec4(0.0);
  if (t < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = iD.w;
  float s = k > 0.0 ? (1.0 - exp(-k * age)) / k : age;
  vec3 p = iA.xyz + iB.xyz * s + vec3(0.0, 0.5 * iD.z * age * age, 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * (0.5 * mix(iD.x, iD.y, t)); // sizes are diameters
  gl_Position = projectionMatrix * mv;
  float fade = 1.0 - t * t;
  vCol = vec4(iC.rgb * fade, fade * (1.0 - iC.w));
}`;
const FRAG = /* glsl */ `
varying vec4 vCol;
varying vec2 vUv;
void main() {
  float a = max(0.0, 1.0 - dot(vUv, vUv));
  gl_FragColor = vCol * (a * a);
}`;

export interface Spark {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  r: number; g: number; b: number;
  /** 1 glows (additive), 0 covers. */
  add: number;
  size0: number; size1: number;
  gravity: number;
  drag: number;
}

export class Particles {
  readonly mesh: THREE.Mesh;
  readonly cap: number;
  /** Lite mode: half of every burst. */
  lite: boolean;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private next = 0;
  private time = 0;
  private dirtyLo = -1;
  private dirtyHi = -1;
  private wrapped = false;
  private uniforms = { uTime: { value: 0 } };

  constructor(lite = false) {
    this.lite = lite;
    this.cap = lite ? 300 : 600;
    this.data = new Float32Array(this.cap * STRIDE);
    // everything starts dead: born long ago, with a tiny life
    for (let i = 0; i < this.cap; i++) {
      this.data[i * STRIDE + 3] = -1e3;
      this.data[i * STRIDE + 7] = 1e-3;
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iA", new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute("iB", new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute("iC", new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute("iD", new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.instanceCount = this.cap;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.matrixAutoUpdate = false;
    // one draw for the whole arena's effects: its bounds are the arena's
    (this.mesh as unknown as { boundingSphere: THREE.Sphere }).boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);
  }

  /** How many of `n` to make (lite mode halves a burst, never to nothing). */
  count(n: number) {
    return this.lite ? Math.max(1, Math.round(n / 2)) : n;
  }

  spawn(p: Spark) {
    const i = this.next;
    const o = i * STRIDE;
    const d = this.data;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = this.time;
    d[o + 4] = p.vx; d[o + 5] = p.vy; d[o + 6] = p.vz; d[o + 7] = p.life;
    d[o + 8] = p.r; d[o + 9] = p.g; d[o + 10] = p.b; d[o + 11] = p.add;
    d[o + 12] = p.size0; d[o + 13] = p.size1; d[o + 14] = p.gravity; d[o + 15] = p.drag;
    if (this.dirtyLo < 0) this.dirtyLo = i;
    this.dirtyHi = i;
    this.next = (i + 1) % this.cap;
    if (this.next === 0) this.wrapped = true;
  }

  /** Once a frame: set the clock, and send the particles born since the last frame to the GPU (one upload). */
  update(time: number) {
    this.time = time;
    this.uniforms.uTime.value = time;
    if (this.dirtyLo < 0) return;
    this.buf.clearUpdateRanges();
    if (this.wrapped) this.buf.addUpdateRange(0, this.cap * STRIDE);
    else this.buf.addUpdateRange(this.dirtyLo * STRIDE, (this.dirtyHi - this.dirtyLo + 1) * STRIDE);
    this.buf.needsUpdate = true;
    this.dirtyLo = this.dirtyHi = -1;
    this.wrapped = false;
  }

  /** Particles alive now (for the perf numbers; not called every frame). */
  alive() {
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const o = i * STRIDE;
      if (this.time - this.data[o + 3]! < this.data[o + 7]!) n++;
    }
    return n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
