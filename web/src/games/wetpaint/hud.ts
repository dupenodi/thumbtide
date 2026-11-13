// The TV's overlay: the clock, the paint race (standings), announcements, and the gallery card
// at the end. Plain DOM over the WebGL canvas.
import { juicy, type JuicyTheme } from "../kit/juicy.ts";
import { createRace } from "./race.ts";
import { PAINTS, type ResultRow } from "./shared.ts";
import type { Sim } from "./sim.ts";
import type { PaintView } from "./paint/view.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement, sim: Sim, view: PaintView) {
  const el = document.createElement("div");
  el.className = "wp-hud";
  el.innerHTML = `
    <header class="wp-top">
      <div class="wp-sign">Wet <b>Paint</b></div>
      <div class="wp-clock">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="43"/><circle class="arc" cx="50" cy="50" r="43" pathLength="100"/></svg>
        <span class="wp-time">1:30</span>
      </div>
    </header>
    <div class="wp-banner" hidden></div>
    <div class="wp-toasts"></div>
    <div class="wp-gallery" hidden></div>`;
  root.appendChild(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const timeEl = $(".wp-time");
  const clockEl = $(".wp-clock");
  const arc = el.querySelector(".wp-clock .arc") as SVGCircleElement;
  const race = createRace($(".wp-top"));
  $(".wp-top").appendChild(clockEl); // sign · race · clock
  const bannerEl = $(".wp-banner");
  const toastsEl = $(".wp-toasts");
  const galleryEl = $(".wp-gallery");

  let bannerTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    update() {
      // clock
      const left = sim.phase === "intro" ? 0 : Math.max(0, Math.ceil(sim.phaseLeft));
      const shown = sim.phase === "play" ? left : sim.phase === "intro" ? sim.roundLength : 0;
      timeEl.textContent = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`;
      const frac = sim.phase === "play" ? Math.max(0, sim.phaseLeft / sim.roundLength) : sim.phase === "intro" ? 1 : 0;
      arc.style.strokeDashoffset = String(100 - frac * 100);
      clockEl.dataset.zone = frac > 0.5 ? "calm" : frac > 0.2 ? "warm" : "hot";
      clockEl.classList.toggle("hurry", sim.phase === "play" && left <= 10);

      // the paint race
      race.update(sim, performance.now());
    },

    /** Big candy lettering in the middle of the screen, with an optional line under it. */
    banner(text: string, ms = 1100, theme: JuicyTheme = "gold", kind = "", sub = "") {
      bannerEl.hidden = false;
      bannerEl.className = `wp-banner ${kind}`;
      bannerEl.innerHTML = `${juicy(text, theme)}${sub ? `<small>${esc(sub)}</small>` : ""}`;
      // restart the animation
      void bannerEl.offsetWidth;
      bannerEl.classList.add("show");
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => (bannerEl.hidden = true), ms);
    },

    toast(html: string) {
      const t = document.createElement("div");
      t.className = "wp-toast";
      t.innerHTML = html;
      toastsEl.prepend(t);
      while (toastsEl.children.length > 2) toastsEl.lastElementChild!.remove();
      setTimeout(() => t.classList.add("out"), 2600);
      setTimeout(() => t.remove(), 3200);
    },

    /**
     * The end of a round: the painting is hung on the left, and a results panel slides in beside it.
     * `next` names whoever decides what happens next.
     */
    gallery(title: string, round: number, rows: ResultRow[] | null, next?: string) {
      if (!rows) {
        galleryEl.hidden = true;
        galleryEl.classList.remove("show");
        root.classList.remove("wp-ended");
        return;
      }
      const top = rows[0];
      const won = !!top && top.pct > 0 && (!rows[1] || top.pct > rows[1].pct);
      const max = Math.max(0.1, ...rows.map((r) => r.pct));
      const coin = (r: ResultRow) => `<span class="coin" style="--c:${PAINTS[r.slot]!.half}">${esc((r.name.trim()[0] ?? "?").toUpperCase())}</span>`;
      galleryEl.innerHTML = `
        <aside class="wp-res">
          <p class="wp-res-kicker">Round ${round}</p>
          ${
            won
              ? `<div class="wp-res-win"><h2 style="--fit:${Math.min(1, 12 / (top!.name.length + 5)).toFixed(2)}">${juicy(`${top!.name} wins!`, "gold")}</h2><p>${coin(top!)}${top!.pct.toFixed(1)}% of the canvas</p></div>`
              : `<div class="wp-res-win"><h2>${juicy("It's a draw!", "sky")}</h2></div>`
          }
          <p class="wp-res-label"><i>${esc(title)}</i><span>Oil on canvas</span></p>
          <ol class="wp-res-list">${rows
            .map(
              (r, i) => `<li style="--c:${PAINTS[r.slot]!.half};--w:${((r.pct / max) * 100).toFixed(1)}%">
                <span class="rk">${i + 1}</span>${coin(r)}
                <span class="nm">${esc(r.name)}${r.wins > 1 ? `<small>${r.wins} wins</small>` : ""}</span>
                <span class="bar"><i></i></span><b>${r.pct.toFixed(1)}%</b>
              </li>`,
            )
            .join("")}</ol>
          ${next ? `<p class="wp-res-next"><b>${esc(next)}</b> picks what's next</p>` : ""}
        </aside>`;
      root.classList.add("wp-ended");
      galleryEl.hidden = false;
      void galleryEl.offsetWidth;
      galleryEl.classList.add("show");
    },

    dispose() {
      if (bannerTimer) clearTimeout(bannerTimer);
      el.remove();
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
