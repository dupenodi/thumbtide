// The table the canvas lies on: clean, not painted. A plank tabletop drawn once into a texture (with the
// canvas's soft shadow baked in), and the canvas's own edge so it reads as a stretched canvas lying there.
import * as THREE from "three";
import { GRID_H, GRID_W } from "../shared.ts";
import { hexVec } from "./glsl.ts";

export const TABLE_Y = -1.4; // the canvas surface is y = 0; it stands this thick off the table

// the tabletop's extent in world units (x across, z toward the viewer); the camera only ever sees a margin of it
const X0 = -250;
const X1 = 250;
const Z0 = -240;
const Z1 = 160;
const PX = 4; // texture pixels per world unit

function tableTexture(): THREE.CanvasTexture {
  const w = (X1 - X0) * PX;
  const h = (Z1 - Z0) * PX;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  const X = (x: number) => (x - X0) * PX;
  const Z = (z: number) => (z - Z0) * PX;
  let seed = 31;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

  // planks running left to right, each a slightly different walnut
  const plank = 10 * PX;
  const tones = ["#8a5a37", "#805232", "#936243", "#7b4e2f", "#8d5d3a"];
  for (let y = 0, i = 0; y < h; y += plank, i++) {
    g.fillStyle = tones[i % tones.length]!;
    g.fillRect(0, y, w, plank);
    // grain: long, gentle waves
    for (let k = 0; k < 9; k++) {
      const gy = y + rand() * plank;
      const amp = 1 + rand() * 3;
      const f = 0.002 + rand() * 0.004;
      const ph = rand() * 10;
      g.strokeStyle = rand() < 0.6 ? "rgba(40, 20, 8, 0.16)" : "rgba(255, 214, 170, 0.07)";
      g.lineWidth = 1 + rand() * 2;
      g.beginPath();
      for (let x = 0; x <= w; x += 24) g.lineTo(x, gy + Math.sin(x * f + ph) * amp * PX * 0.4);
      g.stroke();
    }
    // the seam, and a butt joint somewhere along the plank
    g.fillStyle = "rgba(25, 12, 4, 0.55)";
    g.fillRect(0, y, w, 2);
    g.fillRect(rand() * w, y, 2, plank);
  }

  // light from the top left, falling away toward the edges of the room
  const fall = g.createLinearGradient(0, 0, w, h);
  fall.addColorStop(0, "rgba(255, 230, 200, 0.10)");
  fall.addColorStop(1, "rgba(0, 0, 0, 0.1)");
  g.fillStyle = fall;
  g.fillRect(0, 0, w, h);
  const vig = g.createRadialGradient(X(0), Z(0), 60 * PX, X(0), Z(0), 230 * PX);
  vig.addColorStop(0, "rgba(0, 0, 0, 0)");
  vig.addColorStop(1, "rgba(8, 4, 2, 0.4)");
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // the canvas's soft shadow, cast a little right and toward us (the canvas itself covers the rest)
  g.save();
  g.shadowColor = "rgba(10, 5, 2, 0.55)";
  g.shadowBlur = 5 * PX;
  g.shadowOffsetX = 2.2 * PX;
  g.shadowOffsetY = 1.8 * PX;
  g.fillStyle = "#000";
  g.fillRect(X(-GRID_W / 2), Z(-GRID_H / 2), GRID_W * PX, GRID_H * PX);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

export function createDecor(): THREE.Group {
  const group = new THREE.Group();

  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tableTexture() }),
  );
  table.position.set((X0 + X1) / 2, TABLE_Y, (Z0 + Z1) / 2);
  group.add(table);

  // the canvas's edge: linen, lit a little differently on each side
  // colours go to the screen as written, like the rest of the scene
  const linen = (hex: string) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...hexVec(hex).toArray()) });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(GRID_W, -TABLE_Y - 0.03, GRID_H), [
    linen("#e6dcc6"), // +x (right, catches the light less)
    linen("#efe6d2"), // -x
    linen("#f4ecdb"), // +y (under the paint, never seen)
    linen("#c9bda3"), // -y
    linen("#d9cdb3"), // +z (front, toward us)
    linen("#e9e0cb"), // -z
  ]);
  edge.position.y = TABLE_Y / 2 - 0.015;
  group.add(edge);
  return group;
}
