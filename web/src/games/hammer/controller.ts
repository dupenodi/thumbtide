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
import { WEAPON_KINDS, WEAPON_LABEL, WEAPONS, type WeaponClass, type WeaponKind } from "./weapons.ts";

const CLASS_LABEL: Record<WeaponClass, string> = { hammer: "Hammers", axe: "Axes", mace: "Maces", sword: "Swords", dual: "Dual" };

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
      <div class="hmc-side">
        <div class="hmc-tip"><b>Fly in circles</b><span>to swing your weapon</span></div>
        <div class="hmc-pick" hidden>${WEAPON_KINDS.map((w, i) => {
          const cls = WEAPONS[w].cls;
          const head = i === 0 || WEAPONS[WEAPON_KINDS[i - 1]!].cls !== cls ? `<p class="hmc-cls">${CLASS_LABEL[cls]}</p>` : "";
          const st = WEAPON_STATS[w];
          return `${head}<button type="button" class="hmc-w" data-w="${w}" style="--t:${WEAPON_TINT[w]}">${WEAPON_ICON[w]}<h4>${WEAPON_LABEL[w]}</h4>
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

  // ---- the stick ---------------------------------------------------------------------------------
  const session = Math.floor(Math.random() * 1e9);
  const s = spec.stick!;
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
        ctl.input({ s: session, k: 1, x: v.x, y: v.y });
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
      ctl.input({ s: session, k: 1, x: 0, y: 0 });
      stickOff = makeStick();
    }, 150);
  };
  window.addEventListener("resize", onResize);

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

    const phase = sh?.phase ?? "pick";
    pick.hidden = phase !== "pick";
    tip.hidden = phase === "pick";
    // a win for my team counts as my win
    const won = !!sh && !!own && (sh.mode === "ffa" ? sh.winnerId === ctl.me?.id : sh.winnerTeam === own.team);
    if (own && !own.seated) showOver("Wait", "You're in from the next round");
    else if (phase === "fight" && own && !own.alive) showOver("K.O.", "Next round soon", "#ff3d55");
    else if (phase === "result") showOver(won ? (sh?.mode === "ffa" ? "You win!" : "Your team wins!") : sh?.winner ? `${sh.winner} wins` : "Draw", "Next round soon", sh?.winnerColor ?? "#fff");
    else if (phase === "match") showOver(won ? "Champion!" : `${sh?.winner ?? "Match"} wins`, "New match soon", sh?.winnerColor ?? "#fff");
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
    ctl.input({ s: session, k: 1, x: 0, y: 0 });
    el.remove();
  };
};

export default mount;
