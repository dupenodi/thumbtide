// The TV lobby. The selected game fills the screen: its tiny background image scaled up (a free blur), its title,
// tagline and card in front, the rest of the library as a strip of small cards, and everyone's seat below.
// The VIP picks with Left / Right on their phone; a TV remote (arrows + OK) or a mouse works too.
// The selection lives in the shell (ShellState.selected): the phone's tap, the remote and this screen all go through it.
import { qrSvg } from "@thumbtide/sdk/qr";
import { colorFor, joinBase, joinDisplay } from "../../config.ts";
import { shell } from "../../shell/host-state.ts";
import { blip } from "../../shell/sound.ts";
import { pickableGames } from "../registry.ts";
import type { HostMount } from "../types.ts";
import { coverHtml, esc, gameColors, playersText } from "./library.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const CROWN = `<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M4 40 L8 10 L22 24 L32 4 L42 24 L56 10 L60 40 Z" fill="#ffd23f" stroke="#0b0b12" stroke-width="5" stroke-linejoin="round"/></svg>`;

let lastPick: string | null = null; // the lobby opens on the game picked last (End game comes back here)

const mount: HostMount = ({ host, root }) => {
  const games = pickableGames();
  const seen = new Set<string>(); // players already on screen: only newcomers pop in
  const owned = new Map<string, string>(); // player id -> colour already sent

  root.innerHTML = `
    <div class="lb">
      <div class="lb-bg" aria-hidden="true"><div class="lb-bgl" hidden></div><div class="lb-bgl" hidden></div></div>
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
          </div>
          <div class="lb-card"></div>
        </section>
        <nav class="lb-strip" aria-label="Games"><ul class="lb-rail">
          ${games
            .map((g, i) => `<li class="lb-tile" data-i="${i}">${coverHtml(g, { title: false, lazy: true })}<span class="lb-tn">${esc(g.title)}</span></li>`)
            .join("")}
        </ul></nav>
        <footer class="lb-foot">
          <ul class="lb-seats"></ul>
          <p class="lb-status"></p>
        </footer>
      </main>
    </div>`;
  const lb = root.firstElementChild as HTMLElement;
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const tiles = [...root.querySelectorAll<HTMLElement>(".lb-tile")];
  const rail = $<HTMLElement>(".lb-rail");
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
      // keep the selected card in the middle of the strip (a transform: no layout, no repaint of the page)
      const t = tiles[i]!;
      const view = rail.parentElement!.clientWidth;
      const max = Math.max(0, rail.scrollWidth - view);
      const x = Math.min(max, Math.max(0, t.offsetLeft + t.offsetWidth / 2 - view / 2));
      rail.style.transform = `translate3d(${-x}px,0,0)`;
      tiles.forEach((tile, k) => tile.classList.toggle("focus", k === i));
    }
    tiles.forEach((tile, k) => tile.classList.toggle("locked", connected < games[k]!.minPlayers));
    $(".lb-eyebrow").innerHTML = vip
      ? `<i class="crown">${CROWN}</i><span><b>${esc(vip.name)}</b> is picking</span>`
      : `<span>${host.list.length ? "Waiting for the host" : "Pick a game"}</span>`;
    $(".lb-play").innerHTML = enough ? `<kbd>OK</kbd> Play` : `Needs ${g.minPlayers} players`;
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
  // mouse: click a card to choose it, click the chosen one again to play
  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".lb-tile");
    if (!t) return;
    const i = Number(t.dataset.i);
    if (i === current()) start();
    else pick(games[i]!.id);
  };
  lb.addEventListener("click", onClick);

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
