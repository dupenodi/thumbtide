// The phone in the lobby. The VIP steps through the games with big Left / Right buttons (every tap goes to the TV
// at once), sees the game's card and settings, and presses Play. Everyone else sees who is picking and what.
import { button } from "@thumbtide/sdk/ui";
import { settingsHtml, syncSettings, wireSettings } from "../../shell/settings-ui.ts";
import { gameById, pickableGames } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { coverHtml, esc, gameColors, playersText } from "./library.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const chev = (d: "l" | "r") =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const mount: ControllerMount = (ctx) => {
  const { ctl, root, isVip, startGame } = ctx;
  const games = pickableGames();
  root.innerHTML = `<div class="lp" data-scroll></div>`;
  const el = root.firstElementChild as HTMLElement;
  let cleanups: Array<() => void> = [];
  let lastKey = "";
  let sel = games[0]!.id; // the game shown (the VIP's own taps lead; the TV's word follows)
  let shownSel = "";
  let pendingUntil = 0; // after a tap, ignore older confirmations from the TV for a moment

  const serverSel = () => {
    const id = ctx.shell()?.selected;
    return id && gameById(id) ? id : games[0]!.id;
  };

  function render(force = false) {
    const own = ctl.own as LobbyOwn | null;
    const me = ctl.me;
    const s = ctx.shell();
    if (!me) return;
    const vip = isVip();
    const players = s?.players.filter((p) => p.connected).length ?? 1;
    if (!vip || performance.now() >= pendingUntil || serverSel() === sel) sel = serverSel();
    const vipName = s?.players.find((p) => p.id === s.vip)?.name;
    // Rebuild only when the page itself changes; a selection updates in place, so a tap in progress, the
    // scroll position and the settings' state survive.
    const key = JSON.stringify([own?.color, me.name, vip, vip ? null : sel, vip ? null : vipName]);
    if (key === lastKey && !force) {
      patch(players);
      return;
    }
    lastKey = key;
    cleanups.forEach((c) => c());
    cleanups = [];
    el.style.setProperty("--c", own?.color ?? "#7c5cff");
    el.className = "lp";
    shownSel = "";

    if (vip) {
      el.classList.add("lp-vip");
      el.innerHTML = `
        <header class="lp-head"><h1>Pick a game</h1><span class="lp-count"></span></header>
        <div class="lp-card"></div>
        <div class="lp-info">
          <div class="lp-title"><h2 class="lp-gt"></h2><span class="lp-gp"></span></div>
          <p class="lp-tagline"></p>
        </div>
        <div class="lp-nav">
          <button class="lp-lr" data-d="-1" aria-label="Previous game">${chev("l")}<span>Left</span></button>
          <span class="lp-pos"></span>
          <button class="lp-lr" data-d="1" aria-label="Next game"><span>Right</span>${chev("r")}</button>
        </div>
        <section class="lp-settings"><h2>Settings</h2><div class="lp-st"></div></section>
        <section class="lp-players"><h2>Players</h2><ul class="lp-pl"></ul></section>
        <div class="lp-go"><button class="lp-start"></button></div>`;
      for (const b of el.querySelectorAll<HTMLButtonElement>(".lp-lr")) {
        // "press": goes out on touch-down, not on release
        cleanups.push(button(b, { mode: "press", haptic: 15, onPress: () => step(Number(b.dataset.d)) }));
      }
      const start = el.querySelector(".lp-start") as HTMLButtonElement;
      cleanups.push(button(start, { mode: "tap", haptic: 25, onPress: () => !start.disabled && startGame(sel) }));
      patch(players);
      return;
    }

    // everyone else: you, and what the host is picking
    const g = gameById(sel)!;
    el.classList.add("lp-guest");
    el.style.setProperty("--ga", gameColors(g)[0]);
    el.style.setProperty("--gb", gameColors(g)[1]);
    el.innerHTML = `
      <div class="lp-me">
        <span class="lp-av">${esc((me.name.trim()[0] ?? "?").toUpperCase())}</span>
        <h1>${esc(me.name)}</h1>
        <p>You're in</p>
      </div>
      <div class="lp-next">
        <p class="lp-label">${vipName ? `<b>${esc(vipName)}</b> is picking` : "Waiting for the host"}</p>
        ${coverHtml(g, { title: false })}
        <div class="lp-title"><h2>${esc(g.title)}</h2><span>${playersText(g)}</span></div>
      </div>`;
  }

  /** Left / Right: show it here at once and tell the TV straight away (no debounce). */
  function step(d: number) {
    const i = games.findIndex((g) => g.id === sel);
    sel = games[(i + d + games.length) % games.length]!.id;
    pendingUntil = performance.now() + 600;
    ctx.sys({ $sys: "select", game: sel });
    patch(ctx.shell()?.players.filter((p) => p.connected).length ?? 1);
  }

  /** In-place updates: the selected game, player count, the Play button, settings confirmed by the TV. */
  function patch(players: number) {
    const count = el.querySelector(".lp-count");
    if (count) count.textContent = `${players} ${players === 1 ? "player" : "players"}`;
    if (!el.classList.contains("lp-vip")) return;
    const g = gameById(sel)!;
    const s = ctx.shell();
    if (shownSel !== g.id) {
      shownSel = g.id;
      el.style.setProperty("--ga", gameColors(g)[0]);
      el.style.setProperty("--gb", gameColors(g)[1]);
      el.querySelector(".lp-card")!.innerHTML = coverHtml(g, { title: false });
      el.querySelector(".lp-gt")!.textContent = g.title;
      el.querySelector(".lp-gp")!.textContent = playersText(g);
      el.querySelector(".lp-tagline")!.textContent = g.tagline;
      el.querySelector(".lp-pos")!.textContent = `${games.indexOf(g) + 1} of ${games.length}`;
      const st = el.querySelector(".lp-settings") as HTMLElement;
      st.hidden = !g.settings?.length;
      // the TV's settings for this game arrive with its confirmation; until then show the defaults
      const mine = s?.selected === g.id ? s.settings : {};
      el.querySelector(".lp-st")!.innerHTML = g.settings?.length ? settingsHtml(g, mine) : "";
      if (g.settings?.length) wireSettings(el, g, (k, v) => ctx.sys({ $sys: "setting", game: g.id, key: k, value: v }));
    } else if (s?.selected === g.id) {
      syncSettings(el, g, s.settings ?? {});
    }
    // who's in (the host menu up top has Remove); a short list, so it's rebuilt each time
    const list = el.querySelector(".lp-pl");
    const all = s?.players ?? [];
    if (list) {
      list.innerHTML = all
        .map((p) => {
          const here = p.connected && !p.away;
          return `<li class="${here ? "" : "away"}">${esc(p.name)}${p.id === ctl.me?.id ? " <small>(you)</small>" : here ? "" : " <small>(away)</small>"}</li>`;
        })
        .join("");
    }
    const start = el.querySelector(".lp-start") as HTMLButtonElement | null;
    if (start) {
      const enough = players >= g.minPlayers;
      start.disabled = !enough;
      start.textContent = enough ? `Play ${g.title}` : `Needs ${g.minPlayers} players`;
    }
  }

  const offs = [ctl.on("state", () => render()), ctl.on("ready", () => render()), ctx.onShell(() => render())];
  render(true);
  return () => {
    offs.forEach((o) => o());
    cleanups.forEach((c) => c());
  };
};

export default mount;
