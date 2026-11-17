// The TV lobby: how to join on the left, the game library on the right, and everyone's seat along the bottom.
// The VIP picks from their phone; a TV remote (arrows + OK) or a mouse works too.
import { qrSvg } from "@thumbtide/sdk/qr";
import { colorFor, joinBase, joinDisplay } from "../../config.ts";
import { shell } from "../../shell/host-state.ts";
import { blip } from "../../shell/sound.ts";
import { gameById, pickableGames } from "../registry.ts";
import type { HostMount } from "../types.ts";
import { coverHtml, esc } from "./library.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const CROWN = `<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M4 40 L8 10 L22 24 L32 4 L42 24 L56 10 L60 40 Z" fill="#ffd23f" stroke="#0b0b12" stroke-width="5" stroke-linejoin="round"/></svg>`;

const mount: HostMount = ({ host, root }) => {
  const games = pickableGames();
  let cursor = 0;
  let lastSelected: string | null = null;
  let focusShown = "";
  const seen = new Set<string>(); // players already on screen: only newcomers pop in

  root.innerHTML = `
    <div class="lb">
      <aside class="lb-join">
        <div class="logo lb-logo">thumb<span>tide</span></div>
        <div class="lb-join-body">
          <div class="lb-qr" aria-label="QR code to join"></div>
          <p class="lb-url">Scan to join, or go to <b></b></p>
          <div class="lb-code"><small>Room code</small><b></b></div>
        </div>
      </aside>
      <main class="lb-main">
        <header class="lb-head">
          <h2>Games</h2>
          <p class="lb-keys"><kbd>◀</kbd><kbd>▶</kbd><span>Choose</span><kbd>OK</kbd><span>Play</span></p>
        </header>
        <div class="lb-shelf-wrap"><ul class="lb-shelf">
          ${games.map((g, i) => `<li class="lb-tile" data-i="${i}">${coverHtml(g)}<span class="lb-pick" hidden></span></li>`).join("")}
          <li class="lb-tile lb-soon" aria-hidden="true"><div class="cv"><span>More games<br>on the way</span></div></li>
        </ul></div>
        <section class="lb-detail"><h1></h1><p></p></section>
        <footer class="lb-foot">
          <ul class="lb-seats"></ul>
          <p class="lb-status"></p>
        </footer>
      </main>
    </div>`;
  const lb = root.firstElementChild as HTMLElement;
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const tiles = [...root.querySelectorAll<HTMLElement>(".lb-tile:not(.lb-soon)")];

  let lastQrFor = "";
  async function renderQr() {
    if (!host.code || host.code === lastQrFor) return;
    lastQrFor = host.code;
    $(".lb-qr").innerHTML = await qrSvg(host.joinUrl(joinBase()), { margin: 1 });
    $(".lb-url b").textContent = joinDisplay();
    $(".lb-code b").textContent = host.code;
  }

  function render() {
    void renderQr();
    const players = host.list;
    const connected = players.filter((p) => p.connected).length;
    const vip = players.find((p) => p.id === shell.vip);

    // the VIP's pick (from their phone) moves the focus; the remote can move it too
    const selected = shell.state?.selected ?? null;
    if (selected !== lastSelected) {
      lastSelected = selected;
      const i = games.findIndex((g) => g.id === selected);
      if (i >= 0) cursor = i;
    }
    const focus = games[cursor]!;
    const picked = selected === focus.id;
    const [a, b] = focus.colors ?? ["#7c5cff", "#2de2c9"];
    lb.style.setProperty("--ga", a);
    lb.style.setProperty("--gb", b);

    tiles.forEach((t, i) => {
      const g = games[i]!;
      t.classList.toggle("focus", i === cursor);
      t.classList.toggle("locked", connected < g.minPlayers);
      const pick = t.querySelector(".lb-pick") as HTMLElement;
      pick.hidden = !(selected === g.id && vip);
      if (!pick.hidden) pick.textContent = `${vip!.name}'s pick`;
    });
    if (focusShown !== focus.id) {
      focusShown = focus.id;
      const d = $<HTMLElement>(".lb-detail");
      d.querySelector("h1")!.textContent = focus.title;
      d.querySelector("p")!.textContent = focus.tagline;
      d.animate([{ opacity: 0, transform: "translateY(0.4em)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "ease-out" });
      tiles[cursor]!.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    }

    // seats: everyone who's here, then the empty ones
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

    $(".lb-status").innerHTML = !players.length
      ? `Scan the code with your phone's camera to join`
      : connected < focus.minPlayers
        ? `${esc(focus.title)} needs ${focus.minPlayers} players`
        : vip
          ? picked
            ? `<i class="crown">${CROWN}</i><b>${esc(vip.name)}</b> picked ${esc(focus.title)}`
            : `<i class="crown">${CROWN}</i><b>${esc(vip.name)}</b> picks the game on their phone`
          : "";

    for (const p of host.players.values()) {
      const own: LobbyOwn = { color: colorFor(p.index) };
      host.setOwn(p.id, own);
    }
  }

  const start = (g = games[cursor]) => {
    if (g && host.list.filter((p) => p.connected).length >= g.minPlayers) {
      blip("start");
      void shell.mount(g.id);
    }
  };

  // TV remote / keyboard
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") cursor = (cursor + 1) % games.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") cursor = (cursor - 1 + games.length) % games.length;
    else if (e.key === "Enter" || e.key === " ") return start();
    else return;
    e.preventDefault();
    blip("move");
    render();
  };
  window.addEventListener("keydown", onKey);
  // mouse: click to choose, click again to play
  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".lb-tile:not(.lb-soon)");
    if (!t) return;
    const i = Number(t.dataset.i);
    if (i === cursor) start();
    cursor = i;
    render();
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
  render();

  return () => {
    window.removeEventListener("keydown", onKey);
    offs.forEach((off) => off());
  };
};

export default mount;
