// A game's settings as rows of pills. Used by the host menu (mid-game) and the lobby's game page.
import { button } from "@thumbtide/sdk/ui";
import type { GameDef, SettingDef, SettingValue, Settings } from "../games/types.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const valueOf = (def: GameDef, key: string, current: Settings) => current[key] ?? def.settings?.find((d) => d.key === key)?.default;
const shown = (def: GameDef, s: SettingDef, current: Settings) => !s.when || valueOf(def, s.when.key, current) === s.when.value;

export function settingsHtml(def: GameDef, current: Settings): string {
  return `<div class="st">${(def.settings ?? [])
    .map(
      (s) => `<div class="st-row" data-row="${esc(s.key)}" ${shown(def, s, current) ? "" : "hidden"}>
        <span class="st-label">${esc(s.label)}${s.applies === "now" ? "" : `<small>next round</small>`}</span>
        <div class="st-pills" data-key="${esc(s.key)}">${s.options
          .map(
            (o, i) =>
              `<button class="st-pill ${valueOf(def, s.key, current) === o.value ? "on" : ""}" data-i="${i}">${esc(o.label)}</button>`,
          )
          .join("")}</div>
      </div>`,
    )
    .join("")}</div>`;
}

/** Bring rendered rows up to date: which pill is on, and which rows show. */
export function syncSettings(root: HTMLElement, def: GameDef, current: Settings) {
  for (const s of def.settings ?? []) {
    const row = root.querySelector<HTMLElement>(`.st-row[data-row="${s.key}"]`);
    if (!row) continue;
    row.hidden = !shown(def, s, current);
    const value = valueOf(def, s.key, current);
    row.querySelectorAll<HTMLElement>(".st-pill").forEach((p, i) => p.classList.toggle("on", s.options[i]?.value === value));
  }
}

/** The values the pills show right now. */
function picked(root: HTMLElement, def: GameDef): Settings {
  const out: Settings = {};
  for (const s of def.settings ?? []) {
    const i = [...root.querySelectorAll(`.st-pills[data-key="${s.key}"] .st-pill`)].findIndex((p) => p.classList.contains("on"));
    if (i >= 0) out[s.key] = s.options[i]!.value;
  }
  return out;
}

export function wireSettings(root: HTMLElement, def: GameDef, onChange: (key: string, value: SettingValue) => void) {
  for (const row of root.querySelectorAll<HTMLElement>(".st-pills")) {
    const s = def.settings?.find((d) => d.key === row.dataset.key);
    if (!s) continue;
    for (const pill of row.querySelectorAll<HTMLButtonElement>(".st-pill")) {
      button(pill, {
        mode: "tap",
        haptic: 8,
        onPress: () => {
          const opt = s.options[Number(pill.dataset.i)];
          if (!opt) return;
          // show it straight away; the TV's confirmation re-renders with the same result
          for (const p of row.querySelectorAll(".st-pill")) p.classList.toggle("on", p === pill);
          syncSettings(root, def, picked(root, def));
          onChange(s.key, opt.value);
        },
      });
    }
  }
}
