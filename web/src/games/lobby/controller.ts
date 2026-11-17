// The phone in the lobby. The VIP browses the library and opens a game's page (settings, Start);
// everyone else sees who they are and what's coming up.
import { button } from "@thumbtide/sdk/ui";
import { settingsHtml, syncSettings, wireSettings } from "../../shell/settings-ui.ts";
import { gameById, pickableGames } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { coverHtml, esc, playersText } from "./library.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const mount: ControllerMount = (ctx) => {
  const { ctl, root, isVip, startGame } = ctx;
  root.innerHTML = `<div class="lp" data-scroll></div>`;
  const el = root.firstElementChild as HTMLElement;
  let cleanups: Array<() => void> = [];
  let open: string | null = null; // the game page the VIP has open
  let lastKey = "";

  function render(force = false) {
    const own = ctl.own as LobbyOwn | null;
    const me = ctl.me;
    const s = ctx.shell();
    if (!me) return;
    const vip = isVip();
    if (!vip) open = null;
    const players = s?.players.filter((p) => p.connected).length ?? 1;
    const selected = s?.selected ? gameById(s.selected) : undefined;
    const vipName = s?.players.find((p) => p.id === s.vip)?.name;
    // Only rebuild when the page itself changes; otherwise update in place, so a tap in progress or the
    // scroll position is never lost when someone joins or a setting is confirmed.
    const key = JSON.stringify([own?.color, me.name, vip, open, vip ? null : s?.selected, vip ? null : vipName]);
    if (key === lastKey && !force) {
      patch(players);
      return;
    }
    lastKey = key;
    const scroll = el.scrollTop;
    cleanups.forEach((c) => c());
    cleanups = [];
    el.style.setProperty("--c", own?.color ?? "#7c5cff");
    el.className = "lp";

    if (vip && open) {
      // a game's page: cover, settings, start
      const g = gameById(open)!;
      const [a, b] = g.colors ?? ["#7c5cff", "#2de2c9"];
      el.classList.add("lp-game");
      el.style.setProperty("--ga", a);
      el.style.setProperty("--gb", b);
      el.innerHTML = `
        <div class="lp-hero">${coverHtml(g, { title: false })}
          <button class="lp-back" aria-label="Back to games"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        <div class="lp-title"><h1>${esc(g.title)}</h1><span>${playersText(g)}</span></div>
        <p class="lp-tagline">${esc(g.tagline)}</p>
        ${g.settings?.length ? `<section class="lp-settings"><h2>Settings</h2>${settingsHtml(g, s?.settings ?? {})}</section>` : ""}
        <section class="lp-players"><h2>Players</h2><ul class="lp-pl"></ul></section>
        <div class="lp-go"><button class="lp-start"></button></div>`;
      cleanups.push(
        button(el.querySelector(".lp-back") as HTMLElement, {
          mode: "tap",
          onPress: () => {
            open = null;
            ctx.sys({ $sys: "select", game: null });
            render(true);
          },
        }),
      );
      const start = el.querySelector(".lp-start") as HTMLButtonElement;
      cleanups.push(button(start, { mode: "tap", haptic: 25, onPress: () => !start.disabled && startGame(g.id) }));
      wireSettings(el, g, (k, v) => ctx.sys({ $sys: "setting", game: g.id, key: k, value: v }));
      patch(players);
      if (!force) el.scrollTop = scroll;
      return;
    }

    if (vip) {
      // the library
      el.classList.add("lp-lib");
      el.innerHTML = `
        <header class="lp-head"><h1>Pick a game</h1><span class="lp-count"></span></header>
        <div class="lp-shelf">${pickableGames()
          .map((g) => `<button class="lp-tile" data-id="${esc(g.id)}">${coverHtml(g)}<span>${esc(g.tagline)}</span></button>`)
          .join("")}</div>`;
      for (const b of el.querySelectorAll<HTMLButtonElement>(".lp-tile")) {
        cleanups.push(
          button(b, {
            mode: "tap",
            onPress: () => {
              open = b.dataset.id!;
              ctx.sys({ $sys: "select", game: open });
              render(true);
            },
          }),
        );
      }
      patch(players);
      return;
    }

    // everyone else: you, and what's coming up
    el.classList.add("lp-guest");
    el.innerHTML = `
      <div class="lp-me">
        <span class="lp-av">${esc((me.name.trim()[0] ?? "?").toUpperCase())}</span>
        <h1>${esc(me.name)}</h1>
        <p>You're in</p>
      </div>
      <div class="lp-next">
        <p class="lp-label">${
          selected ? `<b>${esc(vipName ?? "The host")}</b> is looking at` : vipName ? `<b>${esc(vipName)}</b> is picking a game` : "Waiting for the host"
        }</p>
        ${selected ? coverHtml(selected) : `<div class="lp-wait" aria-hidden="true"><i></i><i></i><i></i></div>`}
      </div>`;
  }

  /** In-place updates: player count, the start button, and settings confirmed by the TV. */
  function patch(players: number) {
    const count = el.querySelector(".lp-count");
    if (count) count.textContent = `${players} ${players === 1 ? "player" : "players"}`;
    const g = open ? gameById(open) : undefined;
    if (!g) return;
    syncSettings(el, g, ctx.shell()?.settings ?? {});
    // who's in (the host menu up top has Remove); a short list, so it's rebuilt each time
    const list = el.querySelector(".lp-pl");
    const all = ctx.shell()?.players ?? [];
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
