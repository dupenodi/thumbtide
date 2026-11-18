// The TV's game HUD: player cards, the announcer, the kill feed and the warm-up strip.
// Built once and updated by diffing, so the TV only repaints what changes.

import { WEAPON_ICON } from "./icons.ts";
import type { WeaponKind } from "./weapons.ts";

export interface SeatView {
  id: string;
  name: string;
  color: string;
  slot: number;
  weapon: WeaponKind;
  hp: number;
  wins: number;
  alive: boolean;
  stunned: boolean;
  armed: boolean;
  human: boolean;
}

export type AnnounceKind = "round" | "count" | "fight" | "ko" | "win" | "champ";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Card {
  el: HTMLElement;
  hp: HTMLElement;
  chip: HTMLElement;
  pips: HTMLElement;
  icon: HTMLElement;
  stamp: HTMLElement;
  key: string;
  /** What the icon and the pips show now (rebuilt only when these change, not on every hit). */
  weapon: string;
  pipKey: string;
}

export class Hud {
  readonly el: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private feedEl: HTMLElement;
  private ann: HTMLElement;
  private warm: HTMLElement;
  private warmText: HTMLElement;
  private warmBar: HTMLElement;
  private cards = new Map<string, Card>();
  private layoutKey = "";
  private annTimer = 0;
  private warmKey = "";
  private fpsEl: HTMLElement;
  private fpsShown = -1;
  private levelEl: HTMLElement;

  /** The level name at the top centre; the page changes only when the name does (once per arena change). */
  setLevel(name: string): void {
    if (this.levelEl.textContent !== name) this.levelEl.textContent = name;
  }

  /** The small frame-rate counter in the bottom-right corner; the page changes only when the number does. */
  setFps(fps: number): void {
    if (fps === this.fpsShown) return;
    this.fpsShown = fps;
    this.fpsEl.textContent = `${fps} fps`;
  }

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "hm-hud";
    this.el.innerHTML = `
      <div class="hm-side hm-left"></div>
      <div class="hm-side hm-right"></div>
      <div class="hm-feed"></div>
      <div class="hm-ann"></div>
      <div class="hm-warm" hidden><b></b><i><s></s></i></div>
      <div class="hm-fps"></div>
      <div class="hm-level"></div>`;
    root.appendChild(this.el);
    this.fpsEl = this.el.querySelector(".hm-fps")!;
    this.levelEl = this.el.querySelector(".hm-level")!;
    this.left = this.el.querySelector(".hm-left")!;
    this.right = this.el.querySelector(".hm-right")!;
    this.feedEl = this.el.querySelector(".hm-feed")!;
    this.ann = this.el.querySelector(".hm-ann")!;
    this.warm = this.el.querySelector(".hm-warm")!;
    this.warmText = this.warm.querySelector("b")!;
    this.warmBar = this.warm.querySelector("s")!;
  }

  /** Called every frame; touches the DOM only where something changed. */
  update(seats: SeatView[], winsToMatch: number): void {
    const layout = seats.map((s) => `${s.id}:${s.slot}:${s.name}:${s.color}`).join("|");
    if (layout !== this.layoutKey) {
      this.layoutKey = layout;
      // 5–8 players: smaller cards, 4 a side
      this.el.classList.toggle("many", seats.length > 4);
      this.left.innerHTML = "";
      this.right.innerHTML = "";
      this.cards.clear();
      for (const s of seats) {
        const el = document.createElement("div");
        el.className = `hm-card${s.slot % 2 ? " flip" : ""}`;
        el.style.setProperty("--c", s.color);
        el.innerHTML = `
          <div class="hm-plate">
            <span class="hm-p">P${s.slot + 1}</span>
            <span class="hm-name">${esc(s.name)}</span>
            <span class="hm-ico"></span>
          </div>
          <div class="hm-bar"><i class="hm-chip"></i><i class="hm-hp"></i></div>
          <div class="hm-pips"></div>
          <span class="hm-stamp"></span>`;
        (s.slot % 2 ? this.right : this.left).appendChild(el);
        this.cards.set(s.id, {
          el,
          hp: el.querySelector(".hm-hp")!,
          chip: el.querySelector(".hm-chip")!,
          pips: el.querySelector(".hm-pips")!,
          icon: el.querySelector(".hm-ico")!,
          stamp: el.querySelector(".hm-stamp")!,
          key: "",
          weapon: "",
          pipKey: "",
        });
      }
    }
    for (const s of seats) {
      const c = this.cards.get(s.id);
      if (!c) continue;
      const hp = Math.max(0, Math.round(s.hp));
      const key = `${hp}|${s.wins}|${winsToMatch}|${s.alive}|${s.stunned}|${s.armed}|${s.weapon}`;
      if (key === c.key) continue;
      c.key = key;
      // transform, not width: no layout, so the TV only recomposites the bar
      const t = `scaleX(${hp / 100})`;
      c.hp.style.transform = t;
      c.chip.style.transform = t;
      c.el.classList.toggle("low", hp <= 25);
      c.el.classList.toggle("out", !s.alive);
      c.el.classList.toggle("stun", s.alive && s.stunned);
      c.el.classList.toggle("bare", s.alive && !s.armed);
      if (c.weapon !== s.weapon) {
        c.weapon = s.weapon;
        c.icon.innerHTML = WEAPON_ICON[s.weapon];
      }
      const pipKey = `${s.wins}/${winsToMatch}`;
      if (c.pipKey !== pipKey) {
        c.pipKey = pipKey;
        c.pips.innerHTML = Array.from({ length: winsToMatch }, (_, i) => `<i${i < s.wins ? ' class="on"' : ""}></i>`).join("");
      }
      // only when it changes: a new text node (even the same text) means layout and a repaint of the HUD on the TV
      const stamp = !s.alive ? "K.O." : s.stunned ? "STUNNED" : !s.armed ? "NO WEAPON" : "";
      if (c.stamp.textContent !== stamp) c.stamp.textContent = stamp;
    }
  }

  /** Big centre text. `ms` 0 keeps it until the next call. */
  announce(kind: AnnounceKind, big: string, small = "", color = "", ms = 1400): void {
    clearTimeout(this.annTimer);
    // A new element starts its animation from the beginning, without forcing a layout of the page
    // (reading offsetWidth to restart it cost a full synchronous layout on the TV, several times a round).
    const el = document.createElement("div");
    el.className = `hm-ann ${kind} go`;
    el.style.setProperty("--c", color || "#ffd84d");
    el.innerHTML = `<b data-t="${esc(big)}">${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ""}`;
    this.ann.replaceWith(el);
    this.ann = el;
    if (ms) this.annTimer = window.setTimeout(() => this.clearAnnounce(), ms);
  }

  clearAnnounce(): void {
    clearTimeout(this.annTimer);
    this.ann.className = "hm-ann";
    this.ann.innerHTML = "";
  }

  /** "A ✕ B" line in the kill feed. */
  feed(by: { name: string; color: string } | null, victim: { name: string; color: string }): void {
    const row = document.createElement("div");
    row.className = "hm-kill";
    row.innerHTML = by
      ? `<b style="color:${by.color}">${esc(by.name)}</b><i>✕</i><b style="color:${victim.color}">${esc(victim.name)}</b>`
      : `<b style="color:${victim.color}">${esc(victim.name)}</b><i>crashed</i>`;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 3) this.feedEl.lastElementChild!.remove();
    window.setTimeout(() => row.remove(), 5000);
  }

  clearFeed(): void {
    this.feedEl.innerHTML = "";
  }

  /**
   * The bottom strip (the warm-up, and the wave timer in co-op vs monsters): a line of text and how much of the
   * countdown is left (0–1, or null for none); `urgent` turns it red (the last seconds).
   */
  warmup(text: string | null, frac: number | null, urgent = false): void {
    const key = `${text}|${frac === null ? "-" : Math.round(frac * 50)}|${urgent}`;
    if (key === this.warmKey) return;
    this.warmKey = key;
    this.warm.hidden = text === null;
    if (text === null) return;
    this.warmText.textContent = text;
    this.warm.classList.toggle("timed", frac !== null);
    this.warm.classList.toggle("urgent", urgent);
    // transform, not width: the TV only recomposites the bar (width meant layout + paint all warm-up long)
    this.warmBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac ?? 0))})`;
  }
}
