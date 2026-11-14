// Hammer lab: a workbench for the fight's feel, played with the mouse (only while `pnpm dev` runs).
// Open http://localhost:5173/lab/hammer/
//
// Click the arena to capture the mouse. Your mouse moves the machine, as in Hammerfight.
// 1 / 2 / 3 pick hammer / chain ball / sword. R resets. Hold Space for slow motion. P pauses. H hides the panel.

import { type Bot, type BotMode, driveBot, makeBot } from "./bots.ts";
import "./lab.css";
import { Fx, Renderer } from "./render.ts";
import { Arena, type Machine, STEP, VIEW_H, VIEW_W } from "./sim.ts";
import { DEFAULT_TUNING, TUNING_FIELDS, type Tuning } from "./tuning.ts";
import { WEAPON_KINDS, WEAPON_LABEL, type WeaponKind } from "./weapons.ts";

const STORE = "hammer-lab-tuning-v3";
const COLORS = ["#ff5d73", "#3ec5ff", "#7dffa3", "#ffd166"];
const SPAWNS: [number, number][] = [
  [240, 200],
  [720, 200],
  [480, 130],
  [720, 390],
];

function loadTuning(): Tuning {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_TUNING, ...(JSON.parse(raw) as Partial<Tuning>) };
  } catch {
    /* private window or blocked storage: use defaults */
  }
  return { ...DEFAULT_TUNING };
}

function saveTuning(t: Tuning): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

const tuning = loadTuning();
const arena = new Arena(tuning);
const fx = new Fx();

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="hl-stage"><canvas class="hl-canvas"></canvas></div>
  <div class="hl-hud">
    <div><b>Hammer lab</b> · <span data-weapon></span></div>
    <div class="hl-keys">click: capture mouse · [ ] weapon (1–4 class) · R reset · Space slow-mo · P pause · H panel</div>
  </div>
  <div class="hl-lock">Click to capture the mouse</div>
  <aside class="hl-panel"></aside>
`;
const canvas = app.querySelector<HTMLCanvasElement>(".hl-canvas")!;
const lockHint = app.querySelector<HTMLElement>(".hl-lock")!;
const weaponLabel = app.querySelector<HTMLElement>("[data-weapon]")!;
const panel = app.querySelector<HTMLElement>(".hl-panel")!;
const renderer = new Renderer(canvas);

// ---- machines -------------------------------------------------------------------------------

let playerWeapon: WeaponKind = "hammer";
let botCount = Math.min(3, Math.max(0, Number(new URLSearchParams(location.search).get("bots") ?? 1) || 0));
let botMode: BotMode = "fight";
let botWeapon: WeaponKind | "mixed" = "mixed";
const bots = new Map<Machine, Bot>();
const respawnAt = new Map<Machine, number>();
let player: Machine;

function botWeaponFor(i: number): WeaponKind {
  return botWeapon === "mixed" ? WEAPON_KINDS[i % WEAPON_KINDS.length]! : botWeapon;
}

function reset(): void {
  for (const m of [...arena.machines]) arena.remove(m);
  bots.clear();
  respawnAt.clear();
  fx.trails.clear();
  const [px0, py0] = SPAWNS[0]!;
  player = arena.add({ id: 0, name: "You", color: COLORS[0]!, weapon: playerWeapon, x: px0, y: py0 });
  for (let i = 1; i <= botCount; i++) {
    const [x, y] = SPAWNS[i]!;
    const m = arena.add({ id: i, name: `Bot ${i}`, color: COLORS[i]!, weapon: botWeaponFor(i), x, y });
    bots.set(m, makeBot(botMode, x, y));
  }
  weaponLabel.textContent = WEAPON_LABEL[playerWeapon];
}

function respawn(m: Machine): void {
  const [x, y] = SPAWNS[m.id] ?? [VIEW_W / 2, VIEW_H / 3];
  arena.respawn(m, x, y, m === player ? playerWeapon : m.weapon);
  fx.trails.delete(m);
  const bot = bots.get(m);
  if (bot) {
    bot.homeX = x;
    bot.homeY = y;
  }
}

// ---- input ----------------------------------------------------------------------------------

canvas.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  lockHint.hidden = document.pointerLockElement === canvas;
});
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas && player.alive) arena.push(player, e.movementX, e.movementY);
});

let slow = false;
let paused = false;
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
  const k = e.key.toLowerCase();
  // [ / ] cycle through all weapons; 1–4 jump to the first of each class (hammer, axe, mace, sword)
  const idx = WEAPON_KINDS.indexOf(playerWeapon);
  const pick =
    k === "]" ? WEAPON_KINDS[(idx + 1) % WEAPON_KINDS.length]
    : k === "[" ? WEAPON_KINDS[(idx + WEAPON_KINDS.length - 1) % WEAPON_KINDS.length]
    : "1234".includes(k) && k ? WEAPON_KINDS[(Number(k) - 1) * 3]
    : undefined;
  if (pick) {
    playerWeapon = pick;
    weaponLabel.textContent = WEAPON_LABEL[playerWeapon];
    respawnAt.delete(player);
    respawn(player);
  } else if (k === "r") reset();
  else if (k === " ") {
    slow = true;
    e.preventDefault();
  } else if (k === "p") paused = !paused;
  else if (k === "h") {
    panel.hidden = !panel.hidden;
    fit();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") slow = false;
});

// ---- panel ----------------------------------------------------------------------------------

function buildPanel(): void {
  const rows = TUNING_FIELDS.map(
    (f) => `
    <label class="hl-row">
      <span>${f.label}</span><output data-out="${f.key}"></output>
      <input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" />
    </label>`,
  ).join("");
  const opts = (list: string[], cur: string) => list.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v}</option>`).join("");
  panel.innerHTML = `
    <h3>Opponents</h3>
    <div class="hl-row"><span>Bots</span><select data-bots>${opts(["0", "1", "2", "3"], String(botCount))}</select></div>
    <div class="hl-row"><span>Bot mode</span><select data-mode>${opts(["fight", "wander", "idle"], botMode)}</select></div>
    <div class="hl-row"><span>Bot weapon</span><select data-bweapon>${opts(["mixed", ...WEAPON_KINDS], botWeapon)}</select></div>
    <h3>Feel</h3>
    ${rows}
    <div class="hl-buttons">
      <button data-copy>Copy JSON</button>
      <button data-defaults>Defaults</button>
    </div>
    <h3>Live</h3>
    <div class="hl-stats" data-stats></div>
  `;
  const sync = () => {
    for (const f of TUNING_FIELDS) {
      panel.querySelector<HTMLInputElement>(`[data-key="${f.key}"]`)!.value = String(tuning[f.key]);
      panel.querySelector<HTMLOutputElement>(`[data-out="${f.key}"]`)!.textContent = String(tuning[f.key]);
    }
  };
  sync();
  panel.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.key as keyof Tuning | undefined;
    if (!key) return;
    tuning[key] = Number(el.value);
    panel.querySelector<HTMLOutputElement>(`[data-out="${key}"]`)!.textContent = el.value;
    saveTuning(tuning);
  });
  panel.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.bots !== undefined) botCount = Number(el.value);
    else if (el.dataset.mode !== undefined) botMode = el.value as BotMode;
    else if (el.dataset.bweapon !== undefined) botWeapon = el.value as WeaponKind | "mixed";
    else return;
    reset();
    el.blur();
  });
  panel.querySelector("[data-copy]")!.addEventListener("click", () => {
    void navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2));
  });
  panel.querySelector("[data-defaults]")!.addEventListener("click", () => {
    Object.assign(tuning, DEFAULT_TUNING);
    saveTuning(tuning);
    sync();
  });
}

// ---- loop -----------------------------------------------------------------------------------

let acc = 0;
let last = performance.now();
let hitstop = 0;
let fps = 60;
let lastHit = "–";

function handleEvents(): void {
  for (const e of arena.events) {
    if (e.type === "hit") {
      if (e.dmg >= 3 && tuning.hitstop > 0) hitstop = Math.max(hitstop, Math.min(0.12, (e.dmg / 10) * (tuning.hitstop / 1000)));
      fx.shake = Math.min(12, fx.shake + e.dmg * 0.35);
      fx.burst(e.x, e.y, 4 + Math.round(e.dmg), 220 + e.dmg * 18, e.cut > 1 ? "#ffffff" : "#ffe08a", 2.5);
      fx.burst(e.x, e.y, 3, 120, e.victim.color, 3);
      if (e.dmg > 0) fx.text(e.x, e.y - 12, e.cut > 2 ? `${e.dmg}!` : String(e.dmg), "#fff", 14 + Math.min(16, e.dmg * 0.6));
      lastHit = `${WEAPON_LABEL[e.attacker.weapon]}: ${e.dmg} hp, impact ${e.impact.toFixed(0)}, cut ${e.cut.toFixed(1)}`;
    } else if (e.type === "disarm") {
      fx.burst(e.x, e.y, 24, 360, "#cfe3ff", 2);
      fx.text(e.x, e.y - 20, "DISARMED", "#cfe3ff", 20);
    } else if (e.type === "pickup" || e.type === "shot" || e.type === "blast") {
      // nothing to show beyond the weapon snapping on, or the shot itself
    } else if (e.type === "clash") {
      fx.burst(e.x, e.y, 4 + Math.min(10, Math.round(e.impact / 10)), 220, "#cfe3ff", 1.5);
    } else {
      fx.burst(e.x, e.y, 40, 420, "#ffb547", 3);
      fx.burst(e.x, e.y, 16, 200, e.victim.color, 4);
      fx.shake = 14;
      fx.text(e.x, e.y - 30, "KO", "#ffb547", 34);
      respawnAt.set(e.victim, arena.t + 1.6);
    }
  }
  arena.events.length = 0;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;
  const dt = STEP;

  if (!paused) {
    if (hitstop > 0) {
      hitstop -= real;
    } else {
      // The sim's own slow motion (Hammerfight's time warp) works inside step(); Space is a lab-only slow view.
      acc += real * (slow ? 0.25 : 1);
      let steps = 0;
      while (acc >= dt && steps < 8) {
        for (const [m, bot] of bots) driveBot(arena, m, bot);
        arena.step();
        acc -= dt;
        steps++;
        handleEvents();
        if (hitstop > 0) {
          acc = 0;
          break;
        }
      }
      if (steps === 8) acc = 0;
      for (const [m, t] of respawnAt) {
        if (arena.t >= t) {
          respawnAt.delete(m);
          respawn(m);
        }
      }
    }
    fx.update(real);
  }

  renderer.draw(arena, Math.min(1, acc / dt), fx);
  stats();
}

let statsTimer = 0;
function stats(): void {
  if (panel.hidden || ++statsTimer % 10) return;
  const el = panel.querySelector<HTMLElement>("[data-stats]");
  if (!el) return;
  const h = player.hull;
  const s = player.striker;
  const wMass = player.parts.reduce((sum, b) => sum + b.mass, 0);
  el.textContent = [
    `fps          ${fps.toFixed(0)}`,
    `machine      ${Math.hypot(h.vx, h.vy).toFixed(0)} px/s`,
    `weapon       ${Math.hypot(s.vx, s.vy).toFixed(0)} px/s`,
    `weapon/hull  ${(wMass / h.mass).toFixed(2)} mass`,
    `time warp    ${arena.timewarp.toFixed(2)}`,
    `health       ${player.hp.toFixed(0)}`,
    `last hit     ${lastHit}`,
  ].join("\n");
}

/** Fit the 16:9 canvas into the space left of the panel. */
function fit(): void {
  document.body.classList.toggle("hl-with-panel", !panel.hidden);
  const stage = canvas.parentElement!.getBoundingClientRect();
  const w = Math.min(stage.width, (stage.height * 16) / 9);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${(w * 9) / 16}px`;
  renderer.resize();
}

window.addEventListener("resize", fit);
buildPanel();
reset();
fit();
requestAnimationFrame(frame);
