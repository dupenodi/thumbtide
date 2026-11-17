// The phone: a stick to move, a big Bomb button, and a smaller Punch and Jump. A status line on top says what is
// happening; each button shows its own cooldown (the TV enforces it; this is only the picture of it).
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { BOMB_COOL, JUMP_REST, JUMP_STEPS, PUNCH_COOL, STEP } from "./rules.ts";
import type { BlastGame } from "./shared.ts";
import { TEAM_NAMES } from "./look.ts";
import "./blast.css";

const COOL: Record<string, number> = {
  bomb: BOMB_COOL * STEP * 1000,
  punch: PUNCH_COOL * STEP * 1000,
  jump: (JUMP_STEPS + JUMP_REST) * STEP * 1000,
};
const POWER_TEXT: Record<string, string> = {
  big: "Big bombs",
  triple: "Triple bombs",
  sticky: "Sticky bombs",
  speed: "Speed up",
  shield: "Shield on",
};

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<BlastGame>;
  const coolUntil: Record<string, number> = {};
  const pad = gamepad(ctx.root, gameById("blast")!.controls!, {
    ctl,
    top: `<div class="blt-top"><div class="blt-who"><i></i><span></span></div><p class="blt-status"></p><button class="blt-again" hidden>Play again</button></div>`,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => {
      if (!playing()) return;
      const now = performance.now();
      if (now < (coolUntil[id] ?? 0)) return;
      coolUntil[id] = now + COOL[id]!;
      ctl.send({ type: id as "bomb" | "punch" | "jump" });
      cooldown(id);
    },
  });
  pad.el.classList.add("blt-pad");
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".blt-again");
  const rings = new Map<string, HTMLElement>();
  for (const id of ["bomb", "punch", "jump"]) {
    const b = pad.btn(id)!;
    const ring = document.createElement("i");
    ring.className = "blt-cd";
    b.appendChild(ring);
    rings.set(id, ring);
  }

  const playing = () => ctl.shared?.phase === "play" && ctl.own?.state === "in";

  function cooldown(id: string) {
    const ring = rings.get(id)!;
    ring.classList.remove("run");
    void ring.offsetWidth;
    ring.style.animationDuration = `${COOL[id]}ms`;
    ring.classList.add("run");
  }

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh) return "Joining…";
    if (own?.state === "watch") return "The arena is full. Watch the TV";
    if (own?.state === "next" && sh.phase !== "match") return "You join next round";
    const team = sh.mode === "team";
    switch (sh.phase) {
      case "wait":
        return "Waiting for one more fighter";
      case "count":
        return "Get ready";
      case "play":
        if (own?.state === "out") return "Knocked off. Back next round";
        return own?.power.length ? own.power.map((p) => POWER_TEXT[p]).join(" · ") : "Blast them off the edge";
      case "round":
        if (!sh.roundWinner) return "Draw. Nobody takes the round";
        if (team) return sh.roundTeam === own?.team ? "Your team takes the round" : `${sh.roundWinner} takes the round`;
        if (sh.roundWinner === own?.name) return "You stay on. Round won";
        return `${sh.roundWinner} takes the round`;
      case "match": {
        if (team) return sh.winTeam === own?.team ? "Your team wins the match!" : `${sh.winner ?? "Nobody"} wins the match`;
        if (sh.winner && sh.winner === own?.name) return "You win the match!";
        return sh.winner ? `${sh.winner} wins the match` : "Match over";
      }
    }
  };

  const render = () => {
    const own = ctl.own;
    const sh = ctl.shared;
    pad.el.style.setProperty("--c", own?.color ?? "#8a90a0");
    const team = own && own.team >= 0 ? ` · ${TEAM_NAMES[own.team]}` : "";
    $(".blt-who span").textContent = `${own?.name ?? ctl.me?.name ?? ""}${team}`;
    $(".blt-status").textContent = status();
    pad.el.classList.toggle("blt-idle", !playing() && sh?.phase !== "count");
    again.hidden = !(sh?.phase === "match" && ctx.isVip());
    if (!playing()) {
      for (const [id, r] of rings) {
        coolUntil[id] = 0;
        r.classList.remove("run");
      }
    }
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
