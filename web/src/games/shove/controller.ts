// The phone: a stick to move and one round Dash button. A status line on top says what is happening; the Dash
// button shows its own 1.5 s cooldown (the TV enforces it; this is only the picture of it).
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { DASH_COOL, STEP } from "./rules.ts";
import type { ShoveGame } from "./shared.ts";
import "./shove.css";

const COOL_MS = DASH_COOL * STEP * 1000;

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<ShoveGame>;
  let coolUntil = 0;
  const pad = gamepad(ctx.root, gameById("shove")!.controls!, {
    ctl,
    top: `<div class="shv-top"><div class="shv-who"><i></i><span></span></div><p class="shv-status"></p><button class="shv-again" hidden>Play again</button></div>`,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => {
      if (id !== "dash" || !playing()) return;
      const now = performance.now();
      if (now < coolUntil) return;
      coolUntil = now + COOL_MS;
      ctl.send({ type: "dash" });
      cooldown();
    },
  });
  pad.el.classList.add("shv-pad");
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".shv-again");
  const dashBtn = pad.btn("dash")!;
  const ring = document.createElement("i");
  ring.className = "shv-cd";
  dashBtn.appendChild(ring);

  const playing = () => ctl.shared?.phase === "play" && ctl.own?.state === "in";

  function cooldown() {
    ring.classList.remove("run");
    void ring.offsetWidth;
    ring.style.animationDuration = `${COOL_MS}ms`;
    ring.classList.add("run");
  }

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh) return "Joining…";
    if (own?.state === "watch") return "The ring is full. Watch the TV";
    if (own?.state === "next" && sh.phase !== "match") return "You join next round";
    switch (sh.phase) {
      case "wait":
        return "Waiting for one more wrestler";
      case "count":
        return "Get ready";
      case "play":
        return own?.state === "out" ? "Out. Back next round" : "Push them out";
      case "round":
        if (sh.roundWinner && sh.roundWinner === own?.name) return "You stay in. Round won";
        return sh.roundWinner ? `${sh.roundWinner} takes the round` : "Round over";
      case "match": {
        if (sh.winner && sh.winner === own?.name) return "You win the match!";
        return sh.winner ? `${sh.winner} wins the match` : "Match over";
      }
    }
  };

  const render = () => {
    const own = ctl.own;
    const sh = ctl.shared;
    pad.el.style.setProperty("--c", own?.color ?? "#8a90a0");
    $(".shv-who span").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".shv-status").textContent = status();
    pad.el.classList.toggle("shv-idle", !playing() && sh?.phase !== "count");
    again.hidden = !(sh?.phase === "match" && ctx.isVip());
    if (!playing()) {
      coolUntil = 0;
      ring.classList.remove("run");
    }
  };

  const offs = [
    ctl.on("state", render),
    ctx.onVip(render),
    ctl.on("message", (m) => {
      if (m?.type === "out") pad.buzz("out");
      else if (m?.type === "hit") pad.buzz("hit");
      else if (m?.type === "go") pad.buzz("go");
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
