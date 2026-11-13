// Loose paint: droplets flung by a splat or a bonk, flecks off a fast brush, and sparkles (added light) round
// pots. Simulated here on the CPU; each is a dab whose place is uploaded every frame.
import * as THREE from "three";
import { PALETTE_GLSL, type PaletteUniforms } from "./canvas.ts";
import { dabGeometry, dabMaterial, dabMesh, type Shared } from "./glsl.ts";

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  pal: number; size: number; gravity: number;
  seed: number;
}

function pool(shared: Shared, pal: PaletteUniforms, cap: number, glow: boolean, msaa: boolean) {
  const aPos = new Float32Array(cap * 3);
  const aData = new Float32Array(cap * 4); // pal, size, life 0..1 (0 = dead), seed
  const geo = dabGeometry(cap, { aPos: [aPos, 3], aData: [aData, 4] }, true);
  const mesh = dabMesh(
    geo,
    dabMaterial(shared, {
      glow,
      msaa,
      uniforms: { ...pal },
      head: PALETTE_GLSL + "in vec3 aPos; in vec4 aData;\n",
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          if (aData.z <= 0.0) { d.alive = 0.0; return; }
          vec4 r = hash4(aData.w);
          int k = int(aData.x + 0.5);
          vec3 c = palette(k, ${glow ? "0.9" : "0.62 + (r.x - 0.5) * 0.4"}, r.y);
          d.pos = aPos;
          d.dir = normalize(vec3(r.z - 0.5, 1.0, r.w - 0.5));
          d.size = vec2(0.8, 1.2) * aData.y * ${glow ? "aData.z" : "1.0"};
          d.c1 = ${glow ? "c * 0.9" : "jitter(c, r.yzw, 0.35)"};
          d.c2 = ${glow ? "vec3(1.0, 0.95, 0.8)" : "c * 1.2"};
          d.wet = 1.0;
          d.lift = 0.6;
          d.spin = uTime * (r.x - 0.5) * 8.0;
          d.cell = ${glow ? "4.0 + floor(r.z * 2.0)" : "-1.0"};
          d.seed = aData.w;
        }`,
      minPx: glow ? [2, 2] : [2.5, 3],
      cells: [4, 2],
    }),
    glow ? 9 : 7,
  );
  const items: P[] = [];

  return {
    mesh,
    spawn(p: Omit<P, "life" | "seed">) {
      if (items.length >= cap) items.shift();
      items.push({ ...p, life: p.max, seed: Math.random() * 997 });
    },
    update(dt: number) {
      let w = 0;
      for (const p of items) {
        p.life -= dt;
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.1 && p.gravity > 0) p.life = 0; // landed in the paint
        if (p.life > 0) items[w++] = p;
      }
      items.length = w;
      for (let i = 0; i < cap; i++) {
        const p = items[i];
        if (!p) {
          aData[i * 4 + 2] = 0;
          continue;
        }
        aPos[i * 3] = p.x;
        aPos[i * 3 + 1] = p.y;
        aPos[i * 3 + 2] = p.z;
        aData[i * 4] = p.pal;
        aData[i * 4 + 1] = p.size;
        aData[i * 4 + 2] = Math.min(1, p.life / p.max + 0.001);
        aData[i * 4 + 3] = p.seed;
      }
      (geo.attributes.aPos as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aData as THREE.BufferAttribute).needsUpdate = true;
    },
    clear() {
      items.length = 0;
    },
  };
}

export function createParticles(shared: Shared, pal: PaletteUniforms, o: { msaa: boolean; scale: number }) {
  const drops = pool(shared, pal, Math.round(700 * o.scale), false, o.msaa);
  const sparks = pool(shared, pal, Math.round(260 * o.scale), true, o.msaa);
  const rnd = Math.random;

  return {
    meshes: [drops.mesh, sparks.mesh],
    update(dt: number) {
      drops.update(dt);
      sparks.update(dt);
    },
    clear() {
      drops.clear();
      sparks.clear();
    },
    /** A glob bursts on the canvas. */
    splat(x: number, z: number, pal: number, k = 1) {
      for (let i = 0; i < 46 * k; i++) {
        const a = rnd() * Math.PI * 2;
        const s = (10 + rnd() * 26) * Math.sqrt(k);
        drops.spawn({ x, y: 0.6, z, vx: Math.cos(a) * s, vy: 9 + rnd() * 16, vz: Math.sin(a) * s, max: 1.6, pal, size: (0.7 + rnd() * 1.1) * Math.sqrt(k), gravity: 48 });
      }
      if (k >= 2) for (let i = 0; i < 30; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 8 + rnd() * 18;
        sparks.spawn({ x, y: 1.5, z, vx: Math.cos(a) * s, vy: 12 + rnd() * 14, vz: Math.sin(a) * s, max: 0.8 + rnd() * 0.4, pal: 10, size: 1 + rnd(), gravity: 20 });
      }
    },
    /** Turbo: sparks streaming off the back of the brush. */
    trail(x: number, z: number, pal: number) {
      sparks.spawn({ x: x + (rnd() - 0.5) * 1.5, y: 0.8 + rnd(), z: z + (rnd() - 0.5) * 1.5, vx: (rnd() - 0.5) * 3, vy: 2 + rnd() * 3, vz: (rnd() - 0.5) * 3, max: 0.45, pal, size: 0.8 + rnd() * 0.6, gravity: 0 });
    },
    /** Turpentine splashing ahead of the rag. */
    splash(x: number, z: number, ax: number, az: number) {
      drops.spawn({ x, y: 0.5, z, vx: ax * (14 + rnd() * 16) + (rnd() - 0.5) * 6, vy: 6 + rnd() * 10, vz: az * (14 + rnd() * 16) + (rnd() - 0.5) * 6, max: 0.9, pal: 0, size: 0.6 + rnd() * 0.9, gravity: 40 });
    },
    /** A brush knocked over: some of its paint flies off. */
    bonk(x: number, z: number, pal: number) {
      for (let i = 0; i < 20; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 6 + rnd() * 14;
        drops.spawn({ x, y: 3, z, vx: Math.cos(a) * s, vy: 8 + rnd() * 10, vz: Math.sin(a) * s, max: 1.4, pal, size: 0.6 + rnd() * 0.8, gravity: 44 });
      }
    },
    /** A loaded brush going fast throws off a fleck now and then. */
    fleck(x: number, z: number, vx: number, vz: number, pal: number) {
      drops.spawn({ x, y: 1.2, z, vx: -vx * 0.2 + (rnd() - 0.5) * 8, vy: 6 + rnd() * 6, vz: -vz * 0.2 + (rnd() - 0.5) * 8, max: 0.8, pal, size: 0.5 + rnd() * 0.5, gravity: 40 });
    },
    /** Pickup: a fountain of sparkle (rainbow, or gold). */
    pickup(x: number, z: number, gold: boolean) {
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 3 + rnd() * 8;
        sparks.spawn({ x, y: 2.5, z, vx: Math.cos(a) * s, vy: 10 + rnd() * 12, vz: Math.sin(a) * s, max: 0.9 + rnd() * 0.5, pal: gold ? 10 : 1 + Math.floor(rnd() * 8), size: 0.9 + rnd() * 0.8, gravity: 18 });
      }
    },
    /** A gold pot or a big brush glitters. */
    glitter(x: number, y: number, z: number, r: number, pal = 10) {
      const a = rnd() * Math.PI * 2;
      sparks.spawn({ x: x + Math.cos(a) * r, y: y + rnd() * 2, z: z + Math.sin(a) * r, vx: 0, vy: 2 + rnd() * 3, vz: 0, max: 0.7 + rnd() * 0.5, pal, size: 0.7 + rnd() * 0.6, gravity: 0 });
    },
  };
}
