// The TV lobby. The selected game fills the screen: its tiny background image scaled up (a free blur), its title,
// tagline and card in front, the rest of the library as a strip of small cards, and everyone's seat below.
// The VIP picks from a grid of cards on their phone; the TV shows that game until it starts (it never cycles by
// itself). A TV remote (arrows + OK) still works, without any hint on screen.
// The selection lives in the shell (ShellState.selected): the phone's tap, the remote and this screen all go through it.
import { qrSvg } from "@thumbtide/sdk/qr";
import { colorFor, joinBase, joinDisplay } from "../../config.ts";
import { shell } from "../../shell/host-state.ts";
import { blip } from "../../shell/sound.ts";
import { pickableGames } from "../registry.ts";
import type { HostMount } from "../types.ts";
import { coverHtml, esc, gameColors, playersText } from "./library.ts";
import { playedText } from "./stats.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const CROWN = `<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M4 40 L8 10 L22 24 L32 4 L42 24 L56 10 L60 40 Z" fill="#ffd23f" stroke="#0b0b12" stroke-width="5" stroke-linejoin="round"/></svg>`;

/**
 * The animated background, precomputed: a soft multi-colour gradient drawn ONCE into a 96×54 canvas and kept as a
 * data URL. The page scales it up (the browser's bilinear scaling is free) as one oversized layer, and CSS moves
 * that layer with transform only (see .lb-drift). No per-frame JS, canvas or gradient work, no filter: the LG's
 * 4K screen repaints at ~1 s per full-screen frame, but moving an existing GPU texture costs only a composite.
 */
let driftUrl = "";
function driftImage(): string {
  if (driftUrl) return driftUrl;
  try {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 54;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0d0b1f";
    g.fillRect(0, 0, 96, 54);
    const blob = (x: number, y: number, r: number, col: string) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 96, 54);
    };
    blob(18, 12, 46, "rgba(124,92,255,0.75)");
    blob(80, 16, 40, "rgba(45,226,201,0.5)");
    blob(60, 50, 48, "rgba(255,90,150,0.5)");
    blob(8, 50, 34, "rgba(40,110,255,0.5)");
    driftUrl = c.toDataURL("image/png");
  } catch {
    /* no canvas: the dark base colour of .lb-bg stays */
  }
  return driftUrl;
}

let lastPick: string | null = null; // the lobby opens on the game picked last (End game comes back here)

const mount: HostMount = ({ host, root }) => {
  const games = pickableGames();
  const seen = new Set<string>(); // players already on screen: only newcomers pop in
  const owned = new Map<string, string>(); // player id -> colour already sent

  root.innerHTML = `
    <div class="lb">
      <div class="lb-bg" aria-hidden="true"><div class="lb-drift"></div><div class="lb-bgl" hidden></div><div class="lb-bgl" hidden></div></div>
      <aside class="lb-join">
        <div class="logo lb-logo">thumb<span>tide</span></div>
        <div class="lb-join-body">
          <div class="lb-qr" aria-label="QR code to join"></div>
          <p class="lb-url">Scan to join, or go to <b></b></p>
          <div class="lb-code"><small>Room code</small><b></b></div>
        </div>
      </aside>
      <main class="lb-main">
        <section class="lb-stage">
          <div class="lb-text">
            <p class="lb-eyebrow"></p>
            <h1 class="lb-title"></h1>
            <p class="lb-tagline"></p>
            <p class="lb-meta"><span class="lb-pl"></span><span class="lb-play"></span></p>
            <p class="lb-stats"><span class="lb-played"></span><span class="lb-last"></span></p>
          </div>
          <div class="lb-card"></div>
        </section>
        <footer class="lb-foot">
          <ul class="lb-seats"></ul>
          <p class="lb-status"></p>
        </footer>
      </main>
    </div>`;
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  if (driftImage()) $<HTMLElement>(".lb-drift").style.backgroundImage = `url(${driftImage()})`;
  const layers = [...root.querySelectorAll<HTMLElement>(".lb-bgl")];

  let lastQrFor = "";
  async function renderQr() {
    if (!host.code || host.code === lastQrFor) return;
    lastQrFor = host.code;
    $(".lb-qr").innerHTML = await qrSvg(host.joinUrl(joinBase()), { margin: 1 });
    $(".lb-url b").textContent = joinDisplay();
    $(".lb-code b").textContent = host.code;
  }

  // ------------------------------------------------------------------ selection
  const indexOf = (id: string | null | undefined) => games.findIndex((g) => g.id === id);
  const current = () => Math.max(0, indexOf(shell.state?.selected ?? lastPick));
  const pick = (id: string) => {
    lastPick = id;
    shell.select(id); // tells every phone, and calls render() through shell.onChange
  };
  const move = (d: number) => {
    blip("move");
    pick(games[(current() + d + games.length) % games.length]!.id);
  };

  let shownId = "";
  let layerOn = -1;
  let fadeTimer = 0;
  /** Background: only the selected game's 160×90 image is in the DOM (two layers only while crossfading). */
  function setBackground(g: (typeof games)[number]) {
    const next = layers[(layerOn + 1) % 2]!;
    const prev = layerOn >= 0 ? layers[layerOn]! : null;
    const [a, b] = gameColors(g);
    next.style.setProperty("--ga", a);
    next.style.setProperty("--gb", b);
    next.replaceChildren();
    next.hidden = false;
    layerOn = (layerOn + 1) % 2;
    const show = () => {
      next.classList.add("on");
      prev?.classList.remove("on");
      window.clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(() => {
        for (const l of layers) {
          if (!l.classList.contains("on")) {
            l.replaceChildren(); // the old image leaves the DOM
            l.hidden = true;
          }
        }
      }, 500);
    };
    if (g.thumbBg) {
      const img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.onload = img.onerror = show;
      img.src = g.thumbBg;
      next.append(img);
    } else {
      show();
    }
  }

  function renderSelection() {
    const selected = shell.state?.selected ?? null;
    if (selected) lastPick = selected;
    const i = current();
    const g = games[i]!;
    const connected = host.list.filter((p) => p.connected).length;
    const vip = host.list.find((p) => p.id === shell.vip);
    const enough = connected >= g.minPlayers;

    if (shownId !== g.id) {
      shownId = g.id;
      setBackground(g);
      $(".lb-card").innerHTML = coverHtml(g, { title: false });
      $(".lb-title").textContent = g.title;
      $(".lb-tagline").textContent = g.tagline;
      $(".lb-pl").textContent = playersText(g);
      const text = $<HTMLElement>(".lb-text");
      text.classList.remove("swap");
      void text.offsetWidth;
      text.classList.add("swap");
      const st = playedText(g.id);
      $(".lb-played").textContent = st.played;
      $(".lb-last").textContent = st.last;
    }
    $(".lb-eyebrow").innerHTML = vip
      ? `<i class="crown">${CROWN}</i><span><b>${esc(vip.name)}</b> is picking</span>`
      : `<span>${host.list.length ? "Waiting for the host" : "Pick a game"}</span>`;
    $(".lb-play").textContent = enough ? "" : `Needs ${g.minPlayers} players`;
    $(".lb-play").classList.toggle("short", !enough);
  }

  // ------------------------------------------------------------------ people
  let peopleKey = "";
  function renderPeople() {
    void renderQr();
    const players = host.list;
    const connected = players.filter((p) => p.connected).length;
    const key = JSON.stringify([players.map((p) => [p.id, p.name, p.index, p.connected, p.away]), shell.vip, host.config.maxPlayers]);
    if (key !== peopleKey) {
      peopleKey = key;
      // the room takes up to 16, but 16 empty circles would crowd the TV: show 8, and more as people arrive
      const max = Math.max(Math.min(host.config.maxPlayers, 8), players.length);
      $(".lb-seats").innerHTML = [
        ...players.map((p) => {
          const isNew = !seen.has(p.id);
          seen.add(p.id);
          return `<li class="seat ${p.connected && !p.away ? "" : "away"} ${isNew ? "new" : ""}" style="--c:${colorFor(p.index)}">
            <span class="av"><b>${esc((p.name.trim()[0] ?? "?").toUpperCase())}</b>${p.id === shell.vip ? `<i class="vip">${CROWN}</i>` : ""}</span>
            <span class="nm">${esc(p.name)}</span></li>`;
        }),
        ...Array.from({ length: max - players.length }, () => `<li class="seat empty"><span class="av"></span><span class="nm"></span></li>`),
      ].join("");
      $(".lb-status").textContent = !players.length ? "Scan the code with your phone's camera to join" : `${connected} here`;
    }
    for (const p of host.players.values()) {
      const color = colorFor(p.index);
      if (owned.get(p.id) === color) continue; // send only what changed: this runs on every selection
      owned.set(p.id, color);
      const own: LobbyOwn = { color };
      host.setOwn(p.id, own);
    }
  }

  const render = () => {
    renderSelection();
    renderPeople();
  };

  const start = () => {
    const g = games[current()]!;
    if (host.list.filter((p) => p.connected).length >= g.minPlayers) {
      blip("start");
      void shell.mount(g.id);
    }
  };

  // TV remote / keyboard
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter" || e.key === " ") return start();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  const offs = [
    host.on("room", render),
    host.on("join", () => {
      blip("join");
      render();
    }),
    host.on("drop", render),
    host.on("away", render),
    host.on("rejoin", render),
    host.on("leave", () => {
      blip("leave");
      render();
    }),
    shell.onChange(render),
  ];
  // open on the last pick (or the first game), and tell the phones
  if (!shell.state?.selected) shell.select(games[current()]!.id);
  render();

  return () => {
    window.clearTimeout(fadeTimer);
    window.removeEventListener("keydown", onKey);
    offs.forEach((off) => off());
  };
};

export default mount;
