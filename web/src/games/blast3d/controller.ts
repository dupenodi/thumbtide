// The phone: a stick to move and four buttons (Bomb, Punch, Jump, Grab). A status line on top says what is
// happening, with the fighter's lives and health. The TV enforces every rule; the phone only sends the presses.
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { B3dGame } from "./shared.ts";
import "./blast3d.css";

const POWER_TEXT: Record<string, string> = {
  triple: "Triple bombs",
  impact: "Impact bombs",
  sticky: "Sticky bombs",
  gloves: "Boxing gloves",
  shield: "Shield on",
  health: "Patched up",
};

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<B3dGame>;
  const pad = gamepad(ctx.root, gameById("blast3d")!.controls!, {
    ctl,
    top: `<div class="b3d-ptop"><div class="b3d-who"><i></i><span></span><div class="b3d-plives"></div></div><div class="b3d-php"><b></b></div><p class="b3d-status"></p><button class="b3d-again" hidden>Play again</button></div>`,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => {
      if (playing()) ctl.send({ type: id as "bomb" | "punch" | "jump" | "grab" });
    },
  });
  pad.el.classList.add("b3d-pad");
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".b3d-again");

  const playing = () => ctl.shared?.phase === "play" && ctl.own?.state === "in";

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh) return "Joining…";
    if (own?.state === "watch") return "The deck is full. Watch the TV";
    if (own?.state === "next" && sh.phase !== "match") return "You join next round";
    switch (sh.phase) {
      case "wait":
        return "Waiting for one more fighter";
      case "count":
        return "Get ready";
      case "play":
        if (own?.state === "out") return "Out of lives. Back next round";
        if (own?.state === "down") return "Knocked out. Back in a moment";
        if (own?.holding) return "Push the stick and press any button to throw";
        return own?.power.length ? own.power.map((p) => POWER_TEXT[p]).join(" · ") : "Knock them off the deck";
      case "round":
        if (!sh.roundWinner) return "Draw. Nobody takes the round";
        return sh.roundWinner === own?.name ? "Last one standing. Round won" : `${sh.roundWinner} takes the round`;
      case "match":
        if (sh.winner && sh.winner === own?.name) return "You win the match!";
        return sh.winner ? `${sh.winner} wins the match` : "Match over";
    }
  };

  let livesSig = "";
  const render = () => {
    const own = ctl.own;
    const sh = ctl.shared;
    pad.el.style.setProperty("--c", own?.color ?? "#8a90a0");
    $(".b3d-who span").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".b3d-status").textContent = status();
    const sig = `${own?.lives ?? 0}/${own?.maxLives ?? 0}`;
    if (sig !== livesSig) {
      livesSig = sig;
      $(".b3d-plives").innerHTML = Array.from({ length: own?.maxLives ?? 0 }, (_, i) => `<i class="${i < (own?.lives ?? 0) ? "on" : ""}"></i>`).join("");
    }
    const hp = $(".b3d-php b");
    hp.style.width = `${(own?.hp ?? 0) * 10}%`;
    hp.className = (own?.hp ?? 0) <= 3 ? "low" : "";
    pad.el.classList.toggle("b3d-idle", !playing() && sh?.phase !== "count");
    pad.el.classList.toggle("b3d-hold", playing() && !!own?.holding);
    again.hidden = !(sh?.phase === "match" && ctx.isVip());
  };

  const offs = [
    ctl.on("state", render),
    ctx.onVip(render),
    ctl.on("message", (m) => {
      if (m?.type === "out") pad.buzz("out");
      else if (m?.type === "hit") pad.buzz("hit");
      else if (m?.type === "go") pad.buzz("go");
      else if (m?.type === "pick") pad.buzz("pick");
    }),
    button(again, { mode: "tap", onPress: () => ctl.send({ type: "again" }) }),
  ];
  render();

  return () => {
    offs.forEach((o) => o());
    pad.destroy();
    ctl.input({ x: 0, y: 0 });
  };
};

export default mount;
