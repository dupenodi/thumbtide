// Bridge Panic on the TV: plain DOM on a 1920 x 1080 stage, scaled to fit. An olive bulkhead is baked once into a
// canvas; the instrument panel (hull gauge, sector counter, order ticker, alarm lamp) is DOM. The order timers are CSS
// animations that run once per order, so nothing is redrawn every frame; a 4 Hz tick only flips a few classes.
import { LOOK, SEAT_COLORS } from "./look.ts";
import { HULL_MAX, MAX_SEATS, type Bridge, type Phase } from "./rules.ts";

const W = 1920;
const H = 1080;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ------------------------------------------------------------------ the baked bulkhead
function paintBulkhead(cv: HTMLCanvasElement) {
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = LOOK.olive;
  c.fillRect(0, 0, W, H);
  // plates: a grid of seams with a lighter top edge and a darker bottom edge
  for (let y = 0; y < H; y += 270) {
    c.fillStyle = "rgba(0,0,0,0.22)";
    c.fillRect(0, y + 266, W, 4);
    c.fillStyle = "rgba(255,255,255,0.05)";
    c.fillRect(0, y, W, 3);
  }
  for (let x = 0; x < W; x += 480) {
    c.fillStyle = "rgba(0,0,0,0.2)";
    c.fillRect(x, 0, 4, H);
    c.fillStyle = "rgba(255,255,255,0.05)";
    c.fillRect(x + 4, 0, 3, H);
  }
  // rivets along every seam crossing
  for (let y = 0; y < H; y += 270) {
    for (let x = 0; x < W; x += 480) {
      for (const [dx, dy] of [[-18, -18], [18, -18], [-18, 18], [18, 18]] as const) {
        const px = x + dx + 2;
        const py = y + dy + 2;
        c.fillStyle = "rgba(0,0,0,0.3)";
        c.beginPath();
        c.arc(px + 1, py + 2, 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#6c7b55";
        c.beginPath();
        c.arc(px, py, 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "rgba(255,255,255,0.25)";
        c.fillRect(px - 3, py - 4, 4, 2);
      }
    }
  }
  // hazard stripes along the bottom lip
  c.save();
  c.beginPath();
  c.rect(0, H - 26, W, 26);
  c.clip();
  c.fillStyle = "#1d2022";
  c.fillRect(0, H - 26, W, 26);
  c.fillStyle = LOOK.amber;
  for (let x = -60; x < W + 60; x += 56) {
    c.beginPath();
    c.moveTo(x, H);
    c.lineTo(x + 28, H);
    c.lineTo(x + 54, H - 26);
    c.lineTo(x + 26, H - 26);
    c.closePath();
    c.fill();
  }
  c.restore();
  c.fillStyle = "rgba(0,0,0,0.18)";
  c.fillRect(0, 0, W, 10);
}

// ------------------------------------------------------------------ the hull gauge
const GCX = 240;
const GCY = 250;
const angle = (v: number) => ((-210 + (240 * v) / HULL_MAX) * Math.PI) / 180;
const pt = (r: number, v: number) => `${(GCX + r * Math.cos(angle(v))).toFixed(1)} ${(GCY + r * Math.sin(angle(v))).toFixed(1)}`;
const arc = (r: number, v0: number, v1: number) => `M ${pt(r, v0)} A ${r} ${r} 0 ${v1 - v0 > 50 ? 1 : 0} 1 ${pt(r, v1)}`;

function gaugeSvg(): string {
  let ticks = "";
  for (let v = 0; v <= HULL_MAX; v += 5) {
    const major = v % 25 === 0;
    ticks += `<path d="M ${pt(major ? 138 : 150, v)} L ${pt(166, v)}" stroke="${LOOK.label}" stroke-width="${major ? 5 : 3}" opacity="${major ? 0.95 : 0.55}"/>`;
  }
  const lab = (v: number) => {
    const a = angle(v);
    return `<text x="${(GCX + 112 * Math.cos(a)).toFixed(1)}" y="${(GCY + 112 * Math.sin(a) + 10).toFixed(1)}" text-anchor="middle" class="bp-gt">${v}</text>`;
  };
  return `<svg class="bp-gauge-svg" viewBox="0 0 480 366" width="480" height="366">
    <circle cx="${GCX}" cy="${GCY}" r="226" fill="#15181a"/>
    <circle cx="${GCX}" cy="${GCY}" r="226" fill="none" stroke="#5a6064" stroke-width="6"/>
    <path d="${arc(190, 0, 25)}" fill="none" stroke="${LOOK.alert}" stroke-width="16"/>
    <path d="${arc(190, 25, 50)}" fill="none" stroke="${LOOK.amber}" stroke-width="16"/>
    <path d="${arc(190, 50, 100)}" fill="none" stroke="#8fa86a" stroke-width="16"/>
    ${ticks}${lab(0)}${lab(50)}${lab(100)}
    <g class="bp-needle" style="transform-origin:${GCX}px ${GCY}px">
      <path d="M ${GCX - 9} ${GCY + 14} L ${GCX - 4} ${GCY - 176} L ${GCX} ${GCY - 190} L ${GCX + 4} ${GCY - 176} L ${GCX + 9} ${GCY + 14} Z" fill="${LOOK.label}"/>
      <path d="M ${GCX} ${GCY - 186} L ${GCX} ${GCY - 120}" stroke="${LOOK.alert}" stroke-width="4"/>
    </g>
    <circle cx="${GCX}" cy="${GCY}" r="24" fill="#3a3f43"/>
    <circle cx="${GCX}" cy="${GCY}" r="24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3" stroke-dasharray="70 200" transform="rotate(200 ${GCX} ${GCY})"/>
    <circle cx="${GCX}" cy="${GCY}" r="8" fill="#15181a"/>
  </svg>`;
}

// ------------------------------------------------------------------ the view
export interface View {
  render(game: Bridge, best: number): void;
  /** A small change: hull, counter, lamp. */
  update(game: Bridge, best: number): void;
  /** About 4 times a second: urgency classes. */
  tick(game: Bridge): void;
  /** A late or wrong order: shake the panel once. */
  shake(): void;
  setPaused(p: boolean): void;
  resize(): void;
  dispose(): void;
}

export function createView(root: HTMLElement): View {
  root.innerHTML = `
    <div class="bp bp-tv">
      <canvas class="bp-bg"></canvas>
      <div class="bp-stage">
        <div class="bp-panel">
          <header class="bp-top">
            <span class="bp-logo">BRIDGE PANIC</span>
            <span class="bp-event" hidden></span>
            <span class="bp-best"></span>
          </header>
          <aside class="bp-left">
            <div class="bp-gauge">${gaugeSvg()}<div class="bp-hull"><small>HULL</small><b>100</b></div></div>
            <div class="bp-instr">
              <div class="bp-sector"><small>SECTOR</small><div class="bp-nix"></div></div>
              <div class="bp-lampbox"><i class="bp-lamp"></i><small>ALARM</small></div>
            </div>
            <div class="bp-quota"><div class="bp-quota-h"><small>ORDERS</small><b>0 / 0</b></div><div class="bp-quota-bar"><i></i></div></div>
          </aside>
          <main class="bp-main"></main>
        </div>
      </div>
    </div>`;
  const el = root.firstElementChild as HTMLElement;
  const stage = el.querySelector(".bp-stage") as HTMLElement;
  const panel = el.querySelector(".bp-panel") as HTMLElement;
  const main = el.querySelector(".bp-main") as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  paintBulkhead(q<HTMLCanvasElement>(".bp-bg"));

  const needle = el.querySelector(".bp-needle") as SVGGElement;
  const hullNum = q(".bp-hull b");
  const nix = q(".bp-nix");
  const quotaTxt = q(".bp-quota-h b");
  const quotaFill = q(".bp-quota-bar i");
  const quotaBar = q(".bp-quota-bar");
  const lamp = q(".bp-lamp");
  const eventEl = q(".bp-event");
  const bestEl = q(".bp-best");

  let mainKey = "";
  let nixKey = "";
  let lampMode = "";
  let eventKey = "";
  let shakeTimer: ReturnType<typeof setTimeout> | null = null;
  let rowEls: HTMLElement[] = [];

  let crewBest = 0;

  function digits(n: number) {
    const s = String(Math.min(99, n)).padStart(2, "0");
    return [...s].map((d) => `<span class="bp-cell"><u>8</u><b>${d}</b></span>`).join("");
  }

  function message(phase: Phase, g: Bridge): string {
    if (phase === "wait") return `<div class="bp-msg"><h1>Waiting for crew</h1><p>Join with your phone.</p></div>`;
    if (phase === "intro")
      return `<div class="bp-msg"><small>NEW PANELS DEALT</small><h1>Sector ${g.sector}</h1><p>Find your controls. Orders start in a moment.</p>${crewChips(g)}</div>`;
    if (phase === "break")
      return `<div class="bp-msg ok"><small>SECTOR ${g.sector}</small><h1>Cleared</h1><p>Hull mended. Panels are dealt again.</p>${crewChips(g)}</div>`;
    const top = g.standings();
    return `<div class="bp-msg bad"><small>HULL BREACHED</small><h1>Voyage over</h1>
      <div class="bp-reached"><span>Reached sector</span><b>${g.sector}</b><span>Crew best</span><b>${Math.max(g.sector, crewBest)}</b></div>
      <div class="bp-crewdone">${top
        .map((s) => `<span style="--c:${SEAT_COLORS[s.slot % MAX_SEATS]}"><i></i>${esc(s.name)} <b>${s.done}</b></span>`)
        .join("")}</div></div>`;
  }
  const crewChips = (g: Bridge) =>
    `<div class="bp-crew">${g
      .list()
      .map((s) => `<span style="--c:${SEAT_COLORS[s.slot % MAX_SEATS]}"><i></i>${esc(s.name)}</span>`)
      .join("")}</div>`;

  function ticker(g: Bridge): string {
    const rows = g.orders();
    if (!rows.length) return `<div class="bp-msg"><h1>Stand by</h1></div>`;
    return `<div class="bp-ticker">${rows
      .map(
        ({ seat, order }) => `<div class="bp-row" data-id="${order.id}" style="--c:${SEAT_COLORS[seat.slot % MAX_SEATS]}">
          <i class="bp-chip">${esc([...seat.name][0] ?? "?")}</i><b class="bp-who">${esc(seat.name)}</b>
          <p class="bp-ord">${esc(order.text)}</p>
          <span class="bp-timer"><i style="animation-duration:${order.ttl}ms;animation-delay:${order.left - order.ttl}ms"></i></span>
        </div>`,
      )
      .join("")}</div>`;
  }

  function render(g: Bridge, best: number) {
    crewBest = best;
    const key =
      g.phase === "play"
        ? `play:${g.orders().map((o) => `${o.seat.id}.${o.order.id}`).join()}:${g.list().map((s) => s.name).join()}`
        : `${g.phase}:${g.sector}:${g.list().map((s) => s.id).join()}:${g.phase === "end" ? g.total : ""}`;
    if (key !== mainKey) {
      mainKey = key;
      main.innerHTML = g.phase === "play" ? ticker(g) : message(g.phase, g);
      main.classList.remove("swap");
      void main.offsetWidth;
      main.classList.add("swap");
      rowEls = [...main.querySelectorAll<HTMLElement>(".bp-row")];
    }
    update(g, best);
  }

  function update(g: Bridge, bestNow: number) {
    crewBest = bestNow;
    needle.style.transform = `rotate(${((g.hull - 50) * 2.4).toFixed(1)}deg)`;
    hullNum.textContent = String(Math.ceil(g.hull));
    q(".bp-gauge").classList.toggle("low", g.hull <= 30);
    const nk = `${g.sector}`;
    if (nk !== nixKey) {
      nixKey = nk;
      nix.innerHTML = digits(g.sector);
    }
    quotaTxt.textContent = `${g.done} / ${g.quota}`;
    quotaFill.style.width = `${g.quota ? Math.min(100, (100 * g.done) / g.quota) : 0}%`;
    quotaBar.style.setProperty("--step", `${g.quota ? 520 / g.quota : 520}px`);
    bestEl.textContent = crewBest ? `CREW BEST  SECTOR ${crewBest}` : "";
    const ek = g.event && g.phase === "play" ? g.event.kind : "";
    if (ek !== eventKey) {
      eventKey = ek;
      eventEl.hidden = !ek;
      eventEl.textContent = ek === "lights" ? "LIGHTS OUT  phones are dark" : ek === "swap" ? "SWAP  orders changed hands" : "";
      eventEl.classList.remove("pop");
      void eventEl.offsetWidth;
      eventEl.classList.add("pop");
    }
    tick(g);
  }

  function tick(g: Bridge) {
    let late = false;
    if (g.phase === "play") {
      for (const o of g.orders()) if (o.order.left < o.order.ttl * 0.25) late = true;
      rowEls.forEach((r, i) => {
        const o = g.orders()[i]?.order;
        const isLate = !!o && o.left < o.ttl * 0.25;
        if (r.classList.contains("late") !== isLate) r.classList.toggle("late", isLate);
      });
    }
    const mode = g.phase === "end" ? "dead" : g.hull <= 30 && g.phase === "play" ? "alarm" : late ? "warn" : g.phase === "play" ? "on" : "off";
    if (mode !== lampMode) {
      lampMode = mode;
      lamp.className = `bp-lamp ${mode}`;
    }
  }

  function shake() {
    panel.classList.remove("shake");
    void panel.offsetWidth;
    panel.classList.add("shake");
    if (shakeTimer) clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => panel.classList.remove("shake"), 500);
  }

  const resize = () => {
    const s = Math.min(el.clientWidth / W, el.clientHeight / H) || 1;
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  resize();

  return {
    render,
    update,
    tick,
    shake,
    setPaused(p) {
      el.classList.toggle("paused", p);
    },
    resize,
    dispose() {
      if (shakeTimer) clearTimeout(shakeTimer);
      root.innerHTML = "";
    },
  };
}
