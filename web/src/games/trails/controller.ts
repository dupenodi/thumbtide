// The phone: two big buttons, Left and Right, held to turn. A status line on top says what is happening.
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { TrailsGame } from "./shared.ts";
import "./trails.css";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<TrailsGame>;
  const held = { left: false, right: false };
  const send = () => ctl.input({ l: held.left ? 1 : 0, r: held.right ? 1 : 0 });
  const pad = gamepad(ctx.root, gameById("trails")!.controls!, {
    ctl,
    top: `<div class="trl-top"><div class="trl-who"><i></i><span></span></div><p class="trl-status"></p><button class="trl-again" hidden>Play again</button></div>`,
    onPress: (id) => {
      if (id === "left" || id === "right") held[id] = true;
      send();
    },
    onRelease: (id) => {
      if (id === "left" || id === "right") held[id] = false;
      send();
    },
  });
  pad.el.classList.add("trl-pad");
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".trl-again");

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh) return "Joining…";
    if (own?.state === "watch") return "All lines are taken. Watch the TV";
    switch (sh.phase) {
      case "wait":
        return "Waiting for one more player";
      case "count":
        return own?.state === "next" ? "You join next round" : "Get ready";
      case "play":
        return own?.state === "next" ? "You join next round" : own?.state === "out" ? "Out. Back next round" : "Hold to turn";
      case "round":
        return own?.state === "next" ? "You join next round" : "Round over";
      case "match": {
        const me = own?.name;
        const w = sh.winners;
        if (me && w.includes(me)) return w.length > 1 ? "You share the win" : "You win!";
        return w.length ? `${w.join(" & ")} wins` : "Match over";
      }
    }
  };

  const render = () => {
    const own = ctl.own;
    pad.el.style.setProperty("--c", own?.color ?? "#8a90a0");
    $(".trl-who span").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".trl-status").textContent = status();
    const racing = ctl.shared?.phase === "play" && own?.state === "in";
    pad.el.classList.toggle("trl-idle", !racing && ctl.shared?.phase !== "count");
    again.hidden = !(ctl.shared?.phase === "match" && ctx.isVip());
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
