// Punchline on the TV: plain DOM on a 1920 × 1080 stage, scaled to fit. The brick wall, the curtains and the
// spotlight are painted once into one canvas (per mount); nothing moves every frame. Each screen is rebuilt when the
// phase or the pair on show changes; in between only small things change in place (who has sent, the vote count,
// the clock). Reveals are CSS animations that run once: chalk tally marks one by one, then the names, then the
// winning card bounces.
import { LOOK, SEAT_COLORS } from "./look.ts";
import { MAX_SEATS, type Punchline, type Seat } from "./rules.ts";

const W = 1920;
const H = 1080;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Delay before the first tally mark, and between marks (ms). Matches revealMs() in rules.ts. */
const TALLY_START = 700;
const TALLY_EVERY = 320;

// ------------------------------------------------------------------ the baked backdrop

function paintBackdrop(cv: HTMLCanvasElement) {
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  // a seeded wobble so the wall looks the same every time
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // mortar
  c.fillStyle = "#3a1a14";
  c.fillRect(0, 0, W, H);
  const bw = 132;
  const bh = 54;
  const gap = 7;
  for (let row = 0, y = 0; y < H; row++, y += bh + gap) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let x = off; x < W; x += bw + gap) {
      const t = rnd();
      const r = 142 - 26 * t + (rnd() - 0.5) * 12;
      const g = 59 - 14 * t + (rnd() - 0.5) * 6;
      const b = 44 - 10 * t;
      c.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      c.fillRect(x, y, bw, bh);
      // a lighter top edge and a few pits
      c.fillStyle = "rgba(255,220,190,0.07)";
      c.fillRect(x, y, bw, 4);
      c.fillStyle = "rgba(0,0,0,0.12)";
      c.fillRect(x, y + bh - 5, bw, 5);
      for (let k = 0; k < 5; k++) {
        c.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.12})`;
        c.fillRect(x + rnd() * (bw - 6), y + rnd() * (bh - 6), 2 + rnd() * 4, 2 + rnd() * 3);
      }
    }
  }
  // the room is dark: darken everything, then light it with one spotlight from above
  c.fillStyle = "rgba(20,6,6,0.62)";
  c.fillRect(0, 0, W, H);
  const spot = c.createRadialGradient(W / 2, 330, 40, W / 2, 420, 900);
  spot.addColorStop(0, "rgba(255,231,163,0.42)");
  spot.addColorStop(0.35, "rgba(255,231,163,0.2)");
  spot.addColorStop(0.7, "rgba(255,231,163,0.05)");
  spot.addColorStop(1, "rgba(255,231,163,0)");
  c.globalCompositeOperation = "lighter";
  c.fillStyle = spot;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = "source-over";
  // the corners fall away into the dark
  const vig = c.createRadialGradient(W / 2, 420, 380, W / 2, 520, 1250);
  vig.addColorStop(0, "rgba(10,2,2,0)");
  vig.addColorStop(1, "rgba(10,2,2,0.78)");
  c.fillStyle = vig;
  c.fillRect(0, 0, W, H);
  // curtains at both sides: maroon folds, darker towards the wall
  const curtain = (x0: number, w: number, flip: boolean) => {
    for (let i = 0; i < 7; i++) {
      const fw = w / 7;
      const x = x0 + i * fw;
      const g = c.createLinearGradient(x, 0, x + fw, 0);
      g.addColorStop(0, "#3b0814");
      g.addColorStop(0.45, LOOK.curtain);
      g.addColorStop(0.6, "#74182b");
      g.addColorStop(1, "#330611");
      c.fillStyle = g;
      c.fillRect(x, 0, fw + 1, H);
    }
    const shade = c.createLinearGradient(x0, 0, x0 + w, 0);
    shade.addColorStop(flip ? 1 : 0, "rgba(0,0,0,0.55)");
    shade.addColorStop(flip ? 0 : 1, "rgba(0,0,0,0)");
    c.fillStyle = shade;
    c.fillRect(x0, 0, w, H);
  };
  curtain(0, 150, false);
  curtain(W - 150, 150, true);
  // a valance across the top
  const top = c.createLinearGradient(0, 0, 0, 70);
  top.addColorStop(0, "#2a0510");
  top.addColorStop(1, LOOK.curtain);
  c.fillStyle = top;
  c.fillRect(0, 0, W, 64);
  c.fillStyle = "rgba(0,0,0,0.35)";
  for (let x = 0; x < W; x += 96) {
    c.beginPath();
    c.ellipse(x + 48, 64, 48, 16, 0, 0, Math.PI);
    c.fillStyle = LOOK.curtain;
    c.fill();
  }
  // the floor edge: a dark stage lip
  const floor = c.createLinearGradient(0, H - 90, 0, H);
  floor.addColorStop(0, "rgba(0,0,0,0)");
  floor.addColorStop(1, "rgba(0,0,0,0.6)");
  c.fillStyle = floor;
  c.fillRect(0, H - 90, W, 90);
}

/** The open-mic stand at the front of the stage, shown while people write. Painted once. */
function paintMic(cv: HTMLCanvasElement) {
  const w = 300;
  const h = 400;
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  c.translate(0, h - 330);
  // the pool of light on the floor
  const pool = c.createRadialGradient(150, 312, 10, 150, 312, 150);
  pool.addColorStop(0, "rgba(255,231,163,0.32)");
  pool.addColorStop(1, "rgba(255,231,163,0)");
  c.fillStyle = pool;
  c.beginPath();
  c.ellipse(150, 312, 150, 26, 0, 0, Math.PI * 2);
  c.fill();
  const metal = (x0: number, x1: number) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "#4b5158");
    g.addColorStop(0.45, LOOK.mic);
    g.addColorStop(0.6, "#d7dde3");
    g.addColorStop(1, "#5d646c");
    return g;
  };
  // base
  c.fillStyle = "#2a2d31";
  c.beginPath();
  c.ellipse(150, 306, 64, 12, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = metal(86, 214);
  c.beginPath();
  c.ellipse(150, 300, 62, 11, 0, 0, Math.PI * 2);
  c.fill();
  // pole, then a short tilted top
  c.fillStyle = metal(144, 156);
  c.fillRect(144, 120, 12, 182);
  c.fillStyle = "#30343a";
  c.fillRect(140, 168, 20, 14);
  c.save();
  c.translate(150, 124);
  c.rotate(-0.42);
  c.fillStyle = metal(-5, 5);
  c.fillRect(-5, -64, 10, 66);
  // clip and the microphone
  c.fillStyle = "#2a2d31";
  c.fillRect(-9, -74, 18, 16);
  c.translate(0, -78);
  c.fillStyle = "#1f2226";
  c.beginPath();
  c.moveTo(-9, 0);
  c.lineTo(9, 0);
  c.lineTo(13, -46);
  c.lineTo(-13, -46);
  c.closePath();
  c.fill();
  const head = c.createRadialGradient(-8, -66, 4, 0, -60, 26);
  head.addColorStop(0, "#eef1f4");
  head.addColorStop(0.5, LOOK.mic);
  head.addColorStop(1, "#3c4147");
  c.fillStyle = head;
  c.beginPath();
  c.arc(0, -60, 22, 0, Math.PI * 2);
  c.fill();
  c.clip();
  c.strokeStyle = "rgba(30,32,36,0.45)";
  c.lineWidth = 1.5;
  for (let k = -16; k <= 16; k += 6) {
    c.beginPath();
    c.moveTo(k, -80);
    c.lineTo(k, -40);
    c.stroke();
  }
  c.restore();
}

// ------------------------------------------------------------------ chalk tally marks

/** One chalk stroke, a little wobbly. `i` is the mark's place in a group of five (4 = the slash). */
function mark(i: number, group: number, delay: number, seed: number): string {
  const gx = group * 92;
  const j = (n: number) => (((seed * 9301 + n * 49297) % 233280) / 233280 - 0.5) * 6;
  const d =
    i < 4
      ? `M${gx + 10 + i * 17 + j(1)} ${8 + j(2)} L${gx + 12 + i * 17 + j(3)} ${70 + j(4)}`
      : `M${gx + 2 + j(5)} ${58 + j(6)} L${gx + 76 + j(7)} ${18 + j(8)}`;
  return `<path class="halo" d="${d}" style="animation-delay:${delay}ms"/><path d="${d}" style="animation-delay:${delay}ms"/>`;
}

function tally(delays: number[], seed: number): string {
  const marks = delays.map((d, n) => mark(n % 5, Math.floor(n / 5), d, seed + n)).join("");
  const groups = Math.max(1, Math.ceil(delays.length / 5));
  return `<svg class="pl-tally" viewBox="0 0 ${groups * 92} 78" width="${groups * 92}" height="78">${marks}</svg>`;
}

// ------------------------------------------------------------------ the view

export interface View {
  render(g: Punchline, now: number): void;
  progress(g: Punchline): void;
  clock(seconds: number | null): void;
  resize(): void;
  dispose(): void;
}

/** Answer text size (px) for n cards on the vote screen: bigger for fewer cards, shrinking for long answers. Never under 36. */
export function answerSize(len: number, n: number): number {
  if (n <= 3) return len < 30 ? 56 : len < 55 ? 48 : 42;
  if (n <= 6) return len < 30 ? 48 : len < 55 ? 42 : 38;
  return len < 22 ? 46 : len < 45 ? 40 : 36;
}

export function createView(root: HTMLElement): View {
  root.innerHTML = `<div class="pl"><div class="pl-stage">
    <canvas class="pl-bg"></canvas><canvas class="pl-mic"></canvas>
    <header class="pl-top"><div class="pl-logo">Punchline</div><div class="pl-round"></div><div class="pl-clock" hidden><b></b></div></header>
    <main class="pl-main"></main>
  </div></div>`;
  const wrap = root.firstElementChild as HTMLElement;
  const stage = wrap.querySelector(".pl-stage") as HTMLElement;
  const main = wrap.querySelector(".pl-main") as HTMLElement;
  const roundEl = wrap.querySelector(".pl-round") as HTMLElement;
  const clockEl = wrap.querySelector(".pl-clock") as HTMLElement;
  const clockNum = clockEl.querySelector("b") as HTMLElement;
  paintBackdrop(wrap.querySelector(".pl-bg") as HTMLCanvasElement);
  paintMic(wrap.querySelector(".pl-mic") as HTMLCanvasElement);

  let key = "";
  let shownSecs = -1;

  const resize = () => {
    const s = Math.min(wrap.clientWidth / W, wrap.clientHeight / H) || 1;
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  resize();

  const color = (s: Seat | undefined) => (s ? SEAT_COLORS[s.slot % MAX_SEATS]! : LOOK.mic);
  const nameTag = (s: Seat | undefined) => `<span class="pl-name" style="--c:${color(s)}"><i></i>${esc(s?.name ?? "Someone")}</span>`;
  /** The prompt text, with each blank drawn as a chalk line. */
  const promptHtml = (t: string) => esc(t).replace(/_{3,}([^ ]*)/g, `<span class="pl-nb"><span class="pl-blank"></span>$1</span>`);
  const sign = (text: string, cls = "") => `<div class="pl-sign ${cls}"><div class="pl-sign-in"><p>${promptHtml(text)}</p></div></div>`;
  const signTitle = (title: string, sub = "") =>
    `<div class="pl-sign pl-sign-title"><div class="pl-sign-in"><h1>${esc(title)}</h1>${sub ? `<p class="pl-sub">${esc(sub)}</p>` : ""}</div></div>`;
  const pts = (n: number) => (n > 0 ? `+${n}` : "0");
  const roundName = (g: Punchline) => `Round ${g.round + 1} of ${g.opts.rounds}`;

  function writeScreen(g: Punchline): string {
    const tags = g.players()
      .map((s) => `<li data-id="${esc(s.id)}" class="${g.doneWriting(s.id) ? "done" : ""}">${nameTag(s)}<em>Sent</em></li>`)
      .join("");
    return `${sign(g.prompt!.text, "pl-sign-big")}
      <p class="pl-cue">Everyone answers this one, on their phone</p>
      <ul class="pl-tags">${tags}</ul>`;
  }

  function cardsScreen(g: Punchline, reveal: boolean): string {
    const r = g.result;
    const n = g.shown.length;
    const cols = n <= 3 ? n : n <= 4 ? 4 : n <= 6 ? 3 : 4;
    const width = n <= 3 ? 470 : n <= 4 ? 366 : n <= 6 ? 480 : 366;
    const gap = 24;
    // tally marks: in the order the votes came in
    const delays = g.shown.map(() => [] as number[]);
    if (reveal) {
      let c = 0;
      for (const v of g.votes.values()) delays[v]!.push(TALLY_START + TALLY_EVERY * c++);
    }
    const after = TALLY_START + TALLY_EVERY * g.votes.size + 350;
    const d = `animation-delay:${after}ms`;
    const cards = g.shown
      .map((ei, k) => {
        const text = g.entries[ei]!.text!;
        const author = g.seats.get(g.authorOf(k));
        const top = reveal && !!r && r.top.includes(k);
        const lost = reveal && !!r && !top && r.top.length > 0;
        return `<div class="pl-col" style="width:${width}px">
          <div class="pl-card${top ? " win" : ""}${lost ? " lost" : ""}" style="${top || lost ? d : ""}">
            ${top ? `<i class="pl-ring" style="${d}"></i>` : ""}<p style="font-size:${answerSize(Array.from(text).length, n)}px">${esc(text)}</p>
            ${reveal ? `<div class="pl-byline" style="${d}">${nameTag(author)}</div>` : ""}
            ${reveal && r!.sweep === k ? `<span class="pl-sweep" style="animation-delay:${after + 250}ms">Clean sweep</span>` : ""}
          </div>
          <div class="pl-score-row">${reveal ? `${tally(delays[k]!, k * 13 + g.round)}<b class="pl-pts" style="${d}">${pts(r!.points[k]!)}</b>` : ""}</div>
        </div>`;
      })
      .join("");
    const status = reveal
      ? r && r.top.length === 0
        ? `<p class="pl-cue">No votes</p>`
        : ""
      : `<p class="pl-cue pl-count">Vote for your favourite, on your phone <span class="pl-in"></span></p>`;
    return `${sign(g.prompt!.text, "pl-sign-slim")}<div class="pl-grid" style="width:${cols * width + (cols - 1) * gap}px">${cards}</div>${status}`;
  }

  function board(g: Punchline, end: boolean): string {
    const list = g.standings();
    const top = list[0]?.score ?? 0;
    const rows = list
      .map((s, k) => {
        const lead = end && s.score === top && top > 0;
        return `<li class="${lead ? "lead" : ""}" style="--c:${color(s)};animation-delay:${120 * (list.length - k)}ms">
          <span class="pl-rank">${k + 1}</span>${nameTag(s)}<em>${s.gained > 0 && !end ? pts(s.gained) : ""}</em><b>${s.score}</b></li>`;
      })
      .join("");
    return `<ol class="pl-board${list.length > 6 ? " tight" : ""}">${rows}</ol>`;
  }

  function endScreen(g: Punchline): string {
    const w = g.winners();
    const title = w.length === 1 ? `${w[0]!.name} wins` : w.length === 2 ? `${w[0]!.name} & ${w[1]!.name}` : "A tie at the top";
    return `<div class="pl-end"><div class="pl-end-head">${signTitle(title, w.length === 2 ? "Shared win" : "Best set of the night")}</div>${board(g, true)}</div>`;
  }

  function render(g: Punchline) {
    const k = `${g.match}:${g.phase}:${g.round}`;
    if (k === key) return;
    key = k;
    roundEl.textContent = g.phase === "wait" || g.phase === "end" ? "" : roundName(g);
    let html = "";
    switch (g.phase) {
      case "wait":
        html = `${signTitle("Punchline", "Waiting for players")}<p class="pl-cue">Three or more to start</p>`;
        break;
      case "intro":
        html = `<div class="pl-intro">${signTitle(roundName(g), g.round + 1 === g.opts.rounds ? "The last round" : "Fill in the blank")}</div>`;
        break;
      case "write":
        html = writeScreen(g);
        break;
      case "vote":
      case "reveal":
        html = cardsScreen(g, g.phase === "reveal");
        break;
      case "scores":
        html = `<div class="pl-scores">${signTitle("Standings", `${g.opts.rounds - g.round - 1} to go`)}${board(g, false)}</div>`;
        break;
      case "end":
        html = endScreen(g);
        break;
    }
    main.className = `pl-main ph-${g.phase}`;
    stage.classList.toggle("mic", g.phase === "write" || g.phase === "intro" || g.phase === "wait");
    main.innerHTML = html;
    shownSecs = -1;
    progress(g);
  }

  function progress(g: Punchline) {
    if (g.phase === "write") {
      for (const li of main.querySelectorAll<HTMLElement>(".pl-tags li")) li.classList.toggle("done", g.doneWriting(li.dataset.id!));
    } else if (g.phase === "vote") {
      const el = main.querySelector(".pl-in");
      const voters = g.voters();
      if (el) el.textContent = `${voters.filter((s) => g.hasVoted(s.id)).length} of ${voters.length} in`;
    }
  }

  function clock(seconds: number | null) {
    clockEl.hidden = seconds === null;
    if (seconds === null || seconds === shownSecs) return;
    shownSecs = seconds;
    clockNum.textContent = String(seconds);
    clockEl.classList.toggle("low", seconds <= 10);
  }

  return {
    render: (g) => render(g),
    progress,
    clock,
    resize,
    dispose: () => wrap.remove(),
  };
}
