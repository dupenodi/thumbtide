// The leaderboard as a paint race: one glossy bar split into everyone's colour, each share as wide as the
// canvas they own, best first, with the bare canvas still up for grabs at the end. Overtakes slide past each
// other, big gains pop, and the leader wears the crown.
import { PAINTS } from "./shared.ts";
import type { Sim } from "./sim.ts";

const CROWN = `<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M4 40 L8 10 L22 24 L32 4 L42 24 L56 10 L60 40 Z" fill="#ffd23f" stroke="#7a4300" stroke-width="4" stroke-linejoin="round"/><path d="M10 34 H54" stroke="#ffef9a" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="4" r="4" fill="#ff5d73" stroke="#7a4300" stroke-width="2.5"/></svg>`;

interface Seg {
  el: HTMLElement;
  pct: number;
  gainFrom: number;
  gainAt: number;
}

export function createRace(host: HTMLElement) {
  const el = document.createElement("div");
  el.className = "wp-race";
  el.innerHTML = `<div class="wp-seg bare"><span class="wp-bare"><b></b> bare</span></div><i class="wp-crown">${CROWN}</i>`;
  host.appendChild(el);
  const bare = el.querySelector(".wp-seg.bare") as HTMLElement;
  const bareLabel = bare.querySelector("b") as HTMLElement;
  const crown = el.querySelector(".wp-crown") as HTMLElement;
  const segs = new Map<string, Seg>();
  let order = "";
  let lastUpdate = 0;
  let leader = "";

  function make(id: string, name: string, slot: number): Seg {
    const p = PAINTS[slot]!;
    const e = document.createElement("div");
    e.className = "wp-seg";
    e.style.setProperty("--c", p.half);
    e.style.setProperty("--cl", p.light);
    e.style.setProperty("--cs", p.shade);
    e.innerHTML = `<span class="wp-coin"></span><span class="wp-nm"></span><b class="wp-pct"></b>`;
    (e.querySelector(".wp-coin") as HTMLElement).textContent = (name.trim()[0] ?? "?").toUpperCase();
    (e.querySelector(".wp-nm") as HTMLElement).textContent = name;
    el.insertBefore(e, bare);
    const s = { el: e, pct: 0, gainFrom: 0, gainAt: 0 };
    segs.set(id, s);
    return s;
  }

  return {
    update(sim: Sim, now: number) {
      if (now - lastUpdate < 120) return;
      lastUpdate = now;
      const ranked = sim.standings();
      const live = new Set<string>();
      let painted = 0;
      for (const b of ranked) {
        live.add(b.id);
        const s = segs.get(b.id) ?? make(b.id, b.name, b.slot);
        const pct = sim.pct(b.slot);
        painted += pct;
        // a big jump (a splat, paint rain) makes the segment pop
        if (now - s.gainAt > 1200) {
          s.gainFrom = s.pct;
          s.gainAt = now;
        } else if (pct - s.gainFrom > 2) {
          s.el.classList.remove("gain");
          void s.el.offsetWidth;
          s.el.classList.add("gain");
          s.gainFrom = pct;
          s.gainAt = now;
        }
        s.pct = pct;
        s.el.style.flexGrow = String(Math.max(pct, 0.01));
        (s.el.querySelector(".wp-pct") as HTMLElement).textContent = `${pct < 9.95 ? pct.toFixed(1) : pct.toFixed(0)}%`;
        s.el.classList.toggle("away", !b.connected);
      }
      for (const [id, s] of segs) {
        if (!live.has(id)) {
          s.el.remove();
          segs.delete(id);
        }
      }
      const rest = Math.max(0, 100 - painted);
      bare.style.flexGrow = String(Math.max(rest, 0.01));
      bareLabel.textContent = `${rest.toFixed(0)}%`;

      // overtakes: re-order, then slide everyone from where they were (FLIP)
      const key = ranked.map((b) => b.id).join();
      if (key !== order) {
        const before = new Map([...segs].map(([id, s]) => [id, s.el.getBoundingClientRect().left]));
        for (const b of ranked) el.insertBefore(segs.get(b.id)!.el, bare);
        if (order) {
          for (const [id, s] of segs) {
            const dx = (before.get(id) ?? 0) - s.el.getBoundingClientRect().left;
            if (Math.abs(dx) < 1) continue;
            s.el.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: 450, easing: "cubic-bezier(.2,1.3,.4,1)" });
          }
        }
        order = key;
      }

      bare.classList.toggle("narrow", bare.getBoundingClientRect().width < bare.getBoundingClientRect().height * 2.6);

      // the crown sits on whoever's ahead (once anyone has painted a bit)
      const top = ranked[0];
      const show = !!top && sim.pct(top.slot) >= 1.5 && (!ranked[1] || sim.pct(top.slot) > sim.pct(ranked[1].slot));
      crown.hidden = !show;
      if (show) {
        const seg = segs.get(top.id)!.el;
        crown.style.transform = `translateX(${seg.offsetLeft + 4}px)`;
        if (leader !== top.id) {
          leader = top.id;
          crown.classList.remove("hop");
          void crown.offsetWidth;
          crown.classList.add("hop");
        }
      }
    },
    reset() {
      for (const s of segs.values()) s.el.remove();
      segs.clear();
      order = "";
      leader = "";
    },
  };
}
