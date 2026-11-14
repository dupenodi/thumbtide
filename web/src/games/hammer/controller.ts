// Phone controller for Rotor Brawl, upright or sideways: a fixed joystick (upright: centred, 3/4 down; sideways: left) flies the machine (Hammerfight's gamepad model,
// stick³ per frame), so flying in circles swings the weapon. Above it go the weapon cards between rounds
// and the K.O. / win screens.

import { type Controller, haptic } from "@thumbtide/sdk";
import { joystick } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import "./hammer.css";
import { loadGameFont } from "./font.ts";
import { WEAPON_ICON, WEAPON_STATS, WEAPON_TINT } from "./icons.ts";
import type { HammerGame } from "./shared.ts";
import {
  GUN_KINDS,
  type GunKind,
  PLATE_COUNT,
  PLATE_KINDS,
  type PlateKind,
  PLATES,
  SIDEARMS,
  takesSidearm,
  WEAPON_KINDS,
  WEAPON_LABEL,
  WEAPONS,
  type WeaponClass,
  type WeaponKind,
} from "./weapons.ts";

type Tab = WeaponClass | "gun" | "shield";
const TAB_LABEL: Record<Tab, string> = { hammer: "Hammers", axe: "Axes", mace: "Maces", sword: "Swords", dual: "Dual", gun: "Guns", shield: "Shields" };
/** Tabs in this order; a class with no weapons gets no tab. */
const CLASSES = (["hammer", "axe", "mace", "sword", "dual"] as WeaponClass[]).filter((c) => WEAPON_KINDS.some((w) => WEAPONS[w].cls === c));
const TABS: Tab[] = [...CLASSES, "gun", "shield"];
const plateBlurb = (k: PlateKind) => `${PLATE_COUNT} plates · break at ${Math.round(PLATES[k].overkill * 100)}`;

const bars = (n: number) => Array.from({ length: 5 }, (_, i) => `<i${i < n ? ' class="on"' : ""}></i>`).join("");

const mount: ControllerMount = (ctx) => {
  loadGameFont();
  const ctl = ctx.ctl as Controller<HammerGame>;
  const spec = gameById("hammer")!.controls!;
  ctl.setInputRate(spec.sendRate);

  const el = document.createElement("div");
  el.className = "hmc";
  el.innerHTML = `
    <div class="hmc-top">
      <div class="hmc-plate"><span class="hmc-p hd"></span><b class="hmc-name"></b></div>
      <div class="hmc-hp"><i></i></div>
      <div class="hmc-wins"></div>
    </div>
    <div class="hmc-body">
      <div class="hmc-stick"><b class="hmc-stick-hint">Fly</b></div>
      <button type="button" class="hmc-fire" hidden><b>FIRE</b><span class="hmc-ammo"></span></button>
      <button type="button" class="hmc-shield" hidden><b>SHIELD</b><span class="hmc-plates"></span></button>
      <div class="hmc-side">
        <div class="hmc-tip"><b>Fly in circles</b><span>to swing your weapon</span></div>
        <div class="hmc-pick" data-scroll hidden><p class="hmc-cls hmc-load"></p><div class="hmc-tabs">${TABS.map((c) => `<button type="button" data-c="${c}">${TAB_LABEL[c]}</button>`).join("")}</div>${[null, ...GUN_KINDS]
          .map((g) => `<button type="button" class="hmc-g" data-c="gun" data-g="${g ?? ""}"><h4>${g ? SIDEARMS[g].label : "No gun"}</h4><span>${g ? SIDEARMS[g].blurb : "Hands free."}</span></button>`)
          .join("")}${[null, ...PLATE_KINDS]
          .map((k) => `<button type="button" class="hmc-g hmc-s" data-c="shield" data-s="${k ?? ""}"><h4>${k ? PLATES[k].label : "No shield"}</h4><span>${k ? plateBlurb(k) : "Lighter, faster."}</span></button>`)
          .join("")}${WEAPON_KINDS.map((w) => {
          const st = WEAPON_STATS[w];
          return `<button type="button" class="hmc-w" data-w="${w}" data-c="${WEAPONS[w].cls}" style="--t:${WEAPON_TINT[w]}">${WEAPON_ICON[w]}<h4>${WEAPON_LABEL[w]}</h4>
            <div class="hmc-stats"><span>Weight</span><u>${bars(st.weight)}</u><span>Reach</span><u>${bars(st.reach)}</u><span>Cut</span><u>${bars(st.cut)}</u></div></button>`;
        }).join("")}</div>
        <div class="hmc-over" hidden><b></b><span></span></div>
      </div>
    </div>`;
  ctx.root.appendChild(el);

  const zone = el.querySelector<HTMLElement>(".hmc-stick")!;
  const tip = el.querySelector<HTMLElement>(".hmc-tip")!;
  const over = el.querySelector<HTMLElement>(".hmc-over")!;
  const pick = el.querySelector<HTMLElement>(".hmc-pick")!;
  const fire = el.querySelector<HTMLButtonElement>(".hmc-fire")!;
  const shieldBtn = el.querySelector<HTMLButtonElement>(".hmc-shield")!;

  // ---- the stick ---------------------------------------------------------------------------------
  const session = Math.floor(Math.random() * 1e9);
  const s = spec.stick!;
  // the stick and the fire button share one input: keep the last stick position to send with the trigger
  let sx = 0;
  let sy = 0;
  let firing: 0 | 1 = 0;
  let guarding: 0 | 1 = 0;
  const send = () => ctl.input({ s: session, k: 1, x: sx, y: sy, f: firing, g: guarding });
  const makeStick = () =>
    joystick(zone, {
      mode: "fixed",
      follow: false,
      radius: s.travel,
      deadzone: s.deadzone,
      fullAt: s.fullAt,
      curve: s.curve,
      directions: s.directions,
      hapticTouch: s.haptic,
      hapticRim: s.rimHaptic,
      onMove: (v) => {
        zone.classList.toggle("on", v.active);
        sx = v.x;
        sy = v.y;
        send();
      },
    });
  let stickOff = makeStick();
  // The fixed stick centres itself once, so build it again when the phone turns (the zone changes shape).
  let zoneSize = `${zone.clientWidth}x${zone.clientHeight}`;
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const size = `${zone.clientWidth}x${zone.clientHeight}`;
      if (size === zoneSize) return;
      zoneSize = size;
      stickOff();
      zone.querySelector(".tt-stick")?.remove();
      sx = sy = 0;
      send();
      stickOff = makeStick();
    }, 150);
  };
  window.addEventListener("resize", onResize);

  // fire: held down = the trigger is held (an arquebus fires 10 a second)
  const setFire = (on: 0 | 1) => {
    if (on === firing) return;
    firing = on;
    fire.classList.toggle("on", !!on);
    if (on) haptic(8);
    send();
  };
  fire.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fire.setPointerCapture?.(e.pointerId);
    setFire(1);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) fire.addEventListener(t, () => setFire(0));
  fire.addEventListener("contextmenu", (e) => e.preventDefault());

  // shield: held down = plates spread out round the machine, at half thrust
  const setGuard = (on: 0 | 1) => {
    if (on === guarding) return;
    guarding = on;
    shieldBtn.classList.toggle("on", !!on);
    if (on) haptic(8);
    send();
  };
  shieldBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    shieldBtn.setPointerCapture?.(e.pointerId);
    setGuard(1);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) shieldBtn.addEventListener(t, () => setGuard(0));
  shieldBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  // tabs: one class of cards at a time (opens on the class of the weapon you hold), then guns and shields
  let tab: Tab | null = null;
  const showTab = (c: Tab) => {
    if (c === tab) return;
    tab = c;
    for (const b of pick.querySelectorAll<HTMLElement>(".hmc-tabs button")) b.classList.toggle("sel", b.dataset.c === c);
    for (const b of pick.querySelectorAll<HTMLElement>(".hmc-w, .hmc-g")) b.hidden = b.dataset.c !== c;
  };
  for (const b of pick.querySelectorAll<HTMLButtonElement>(".hmc-tabs button")) {
    b.addEventListener("click", () => {
      haptic(8);
      showTab(b.dataset.c as Tab);
    });
  }

  for (const b of pick.querySelectorAll<HTMLButtonElement>(".hmc-g")) {
    b.addEventListener("click", () => {
      haptic(15);
      if (b.dataset.c === "shield") ctl.send({ type: "plate", plate: (b.dataset.s || null) as PlateKind | null });
      else ctl.send({ type: "gun", gun: (b.dataset.g || null) as GunKind | null });
    });
  }

  for (const b of pick.querySelectorAll<HTMLButtonElement>(".hmc-w")) {
    b.addEventListener("click", () => {
      haptic(15);
      ctl.send({ type: "weapon", weapon: b.dataset.w as WeaponKind });
    });
  }

  // ---- state -------------------------------------------------------------------------------------
  let overKey = "";
  const showOver = (big: string, small: string, color = "#fff") => {
    const key = `${big}|${small}|${color}`;
    if (key === overKey) return;
    overKey = key;
    over.hidden = !big;
    over.style.setProperty("--oc", color);
    (over.querySelector("b") as HTMLElement).textContent = big;
    (over.querySelector("span") as HTMLElement).textContent = small;
  };

  const render = () => {
    const own = ctl.own;
    const sh = ctl.shared;
    el.style.setProperty("--c", own?.color ?? "#7c5cff");
    (el.querySelector(".hmc-p") as HTMLElement).textContent = own && own.slot >= 0 ? (own.teamName ? `${own.teamName.toUpperCase()} · P${own.slot + 1}` : `P${own.slot + 1}`) : "—";
    (el.querySelector(".hmc-name") as HTMLElement).textContent = ctl.me?.name ?? "";
    const hp = Math.max(0, own?.hp ?? 100);
    (el.querySelector(".hmc-hp i") as HTMLElement).style.transform = `scaleX(${hp / 100})`;
    el.classList.toggle("low", hp <= 25);
    const target = sh?.winsToMatch ?? 3;
    (el.querySelector(".hmc-wins") as HTMLElement).innerHTML = Array.from({ length: target }, (_, i) => `<i${own && i < own.wins ? ' class="on"' : ""}></i>`).join("");
    for (const b of pick.querySelectorAll<HTMLElement>(".hmc-w")) b.classList.toggle("sel", b.dataset.w === own?.weapon);
    if (!tab) showTab(own ? WEAPONS[own.weapon].cls : CLASSES[0]!);
    const canGun = !own || takesSidearm(own.weapon);
    for (const b of pick.querySelectorAll<HTMLElement>(".hmc-g")) {
      if (b.dataset.c === "shield") {
        b.classList.toggle("sel", (b.dataset.s || null) === (own?.plate ?? null));
        continue;
      }
      b.classList.toggle("sel", (b.dataset.g || null) === (own?.sidearm ?? null));
      b.classList.toggle("off", !canGun && !!b.dataset.g);
    }
    if (own) {
      const gunName = own.sidearm && canGun ? SIDEARMS[own.sidearm].label : own.weapon === "tribune" ? "built-in gun" : "no gun";
      (pick.querySelector(".hmc-load") as HTMLElement).textContent = `${WEAPON_LABEL[own.weapon]} · ${gunName} · ${own.plate ? `${PLATES[own.plate].label} shield` : "no shield"}`;
    }
    // the shield button shows while plates are on
    const plates = own?.plates ?? 0;
    shieldBtn.hidden = plates <= 0;
    if (plates <= 0 && guarding) setGuard(0);
    (shieldBtn.querySelector(".hmc-plates") as HTMLElement).textContent = plates > 0 ? `${plates}/${PLATE_COUNT}` : "";
    // the fire button shows while the machine holds a gun (a sidearm, or the tribune's own)
    const gun = own?.gun ?? null;
    fire.hidden = !gun;
    if (!gun && firing) setFire(0);
    if (gun) {
      fire.classList.toggle("empty", gun.reloading);
      (fire.querySelector(".hmc-ammo") as HTMLElement).textContent = gun.reloading ? "reload" : `${gun.ammo}/${gun.clip}`;
    }

    const phase = sh?.phase ?? "pick";
    pick.hidden = phase !== "pick";
    tip.hidden = phase === "pick";
    // a win for my team counts as my win
    const won = !!sh && !!own && (sh.mode === "ffa" ? sh.winnerId === ctl.me?.id : sh.winnerTeam === own.team);
    // "CPU wins", but "Players win"
    const wins = (name: string) => `${name} ${/Players$/.test(name) ? "win" : "wins"}`;
    if (own && !own.seated) showOver("Wait", "You're in from the next round");
    else if (phase === "fight" && own && !own.alive) showOver("K.O.", "Next round soon", "#ff3d55");
    else if (phase === "result") showOver(won ? (sh?.mode === "ffa" ? "You win!" : "Your team wins!") : sh?.winner ? wins(sh.winner) : "Draw", "Next round soon", sh?.winnerColor ?? "#fff");
    else if (phase === "match") showOver(won ? "Champion!" : wins(sh?.winner ?? "Match"), "New match soon", sh?.winnerColor ?? "#fff");
    else showOver("", "");
  };

  const offs = [
    ctl.on("state", render),
    ctl.on("message", (d) => {
      const p = spec.buzz[d.type];
      if (p) haptic(p);
      if (d.type === "hurt") {
        el.classList.remove("ouch");
        void el.offsetWidth;
        el.classList.add("ouch");
      }
    }),
  ];
  render();

  return () => {
    offs.forEach((o) => o());
    window.removeEventListener("resize", onResize);
    clearTimeout(resizeTimer);
    stickOff();
    ctl.input({ s: session, k: 1, x: 0, y: 0, f: 0, g: 0 });
    el.remove();
  };
};

export default mount;
