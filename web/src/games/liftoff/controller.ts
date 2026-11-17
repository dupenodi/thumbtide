// The phone: one huge round Thrust button in the player's colour (a lone pilot gets two: left and right engine).
// On top: the status line, a small rocket with this player's thruster lit, and the height.
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { LiftoffGame } from "./shared.ts";
import "./liftoff.css";

const SHIP = `
  <path class="lft-s-nose" d="M-8.5 -13 Q-8 -24.5 0 -30.5 Q8 -24.5 8.5 -13 Z"/>
  <rect class="lft-s-body" x="-8.5" y="-13" width="17" height="29"/>
  <circle class="lft-s-port" cx="0" cy="-7.4" r="3.6"/>
  <path class="lft-s-fin" d="M-8.5 3.5 L-15 15.5 L-15 23 L-8.5 17.5 Z M8.5 3.5 L15 15.5 L15 23 L8.5 17.5 Z"/>
  <path class="lft-s-skirt" d="M-8.5 16 L8.5 16 L10 21 L-10 21 Z"/>`;

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<LiftoffGame>;
  const held = { thrust: false, left: false, right: false };
  const send = () => {
    const two = ctl.own?.mode === "two";
    const l = two ? held.left : held.thrust;
    const r = two ? held.right : held.thrust;
    ctl.input({ l: l ? 1 : 0, r: r ? 1 : 0 });
    // the small flame under this player's thruster shows while they fire
    padEl?.classList.toggle("lft-firing", l || r);
  };
  let padEl: HTMLElement | null = null;
  const pad = gamepad(ctx.root, gameById("liftoff")!.controls!, {
    ctl,
    top: `<div class="lft-top">
      <div class="lft-who"><i></i><span></span></div>
      <p class="lft-status"></p>
      <div class="lft-info">
        <svg class="lft-ship" viewBox="-19 -33 38 63" aria-hidden="true">${SHIP}<g class="lft-s-noz"></g></svg>
        <div class="lft-ph-alt"><small>Altitude</small><div><b>0</b><span>m</span></div></div>
      </div>
      <button class="lft-again" hidden>Play again</button>
    </div>`,
    onPress: (id) => {
      if (id in held) held[id as keyof typeof held] = true;
      send();
    },
    onRelease: (id) => {
      if (id in held) held[id as keyof typeof held] = false;
      send();
    },
  });
  pad.el.classList.add("lft-pad");
  padEl = pad.el;
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".lft-again");
  const noz = pad.top.querySelector(".lft-s-noz") as SVGGElement;
  let nozKey = "";

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh || !own) return "Joining…";
    if (own.state === "watch") return "The rocket is full. Watch the TV";
    switch (sh.phase) {
      case "wait":
        return "Waiting for a crew";
      case "count":
        return own.state === "next" ? "You board next run" : "Get ready";
      case "fly":
        return own.state === "next" ? "You board next run" : "Hold to fire";
      case "result":
        return `Run ${sh.run} over at ${sh.height} m`;
      case "match":
        return `Mission over. Best ${sh.best} m`;
    }
  };

  const render = () => {
    const own = ctl.own;
    const sh = ctl.shared;
    pad.el.style.setProperty("--c", own?.color ?? "#8c97b3");
    pad.el.classList.toggle("two", own?.mode === "two");
    $(".lft-who span").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".lft-status").textContent = status();
    $(".lft-ph-alt b").textContent = String(sh?.height ?? 0);
    const live = (sh?.phase === "fly" || sh?.phase === "count") && own?.state === "fly";
    pad.el.classList.toggle("lft-idle", !live);
    again.hidden = !(sh?.phase === "match" && ctx.isVip());
    // the small rocket: every thruster, this player's lit
    const spots = own?.spots ?? [];
    const k = `${spots.join(",")}|${(own?.mine ?? []).join(",")}`;
    if (k !== nozKey) {
      nozKey = k;
      const w = Math.min(5.6, 19 / Math.max(1, spots.length));
      noz.innerHTML = spots
        .map((d, i) => {
          const x = d * 9.5;
          const mine = own?.mine.includes(i);
          return `<path class="${mine ? "mine" : ""}" d="M${x - w * 0.32} 21 L${x + w * 0.32} 21 L${x + w * 0.5} 25.5 L${x - w * 0.5} 25.5 Z"/>${
            mine ? `<path class="lft-s-flame" d="M${x - w * 0.5} 26.5 Q${x - w * 0.4} 30 ${x} 33 Q${x + w * 0.4} 30 ${x + w * 0.5} 26.5 Z"/>` : ""
          }`;
        })
        .join("");
    }
    send();
  };

  const offs = [
    ctl.on("state", render),
    ctx.onVip(render),
    ctl.on("message", (m) => {
      if (m?.type === "crash") pad.buzz("crash");
      else if (m?.type === "go") pad.buzz("go");
    }),
    button(again, { mode: "tap", onPress: () => ctl.send({ type: "again" }) }),
  ];
  render();

  return () => {
    offs.forEach((o) => o());
    pad.destroy();
    ctl.input({ l: 0, r: 0 });
  };
};

export default mount;
