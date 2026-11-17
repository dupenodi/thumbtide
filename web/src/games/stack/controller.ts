// The phone: Left and Right under the left thumb (hold to keep sliding), Turn and Drop under the right thumb, and a
// small Down (hold to ease the piece down) under Left and Right. A status line and the next piece sit on top.
import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { TURNS, type Move } from "./rules.ts";
import type { StackGame } from "./shared.ts";
import "./stack.css";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<StackGame>;
  const def = gameById("stack")!;
  const tune = def.controls?.tune ?? {};
  const REPEAT_DELAY = tune["repeat-delay"] ?? 170;
  const REPEAT_EVERY = tune["repeat-every"] ?? 55;

  const playing = () => ctl.shared?.phase === "play" && ctl.own?.state === "in";
  const send = (m: Move) => ctl.send({ type: "move", m });

  // Left / Right: one step on press, then repeat after a short delay while held (the last one pressed wins)
  let slide: "left" | "right" | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopSlide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    slide = null;
  };
  const startSlide = (dir: "left" | "right") => {
    stopSlide();
    if (!playing()) return;
    slide = dir;
    send(dir);
    const again = (ms: number) => {
      timer = setTimeout(() => {
        if (!slide || !playing()) return stopSlide();
        send(slide);
        again(REPEAT_EVERY);
      }, ms);
    };
    again(REPEAT_DELAY);
  };
  let soft = false;
  const setSoft = (on: boolean) => {
    if (soft === on) return;
    soft = on;
    send(on ? "softOn" : "softOff");
  };

  const pad = gamepad(ctx.root, def.controls!, {
    ctl,
    top: `<div class="sta-top"><div class="sta-info"><div class="sta-who"><i></i><span></span></div><p class="sta-status"></p></div>
      <div class="sta-next"><span>Next</span><div class="sta-mini"></div></div><button class="sta-again" hidden>Play again</button></div>`,
    onPress: (id) => {
      if (id === "left" || id === "right") startSlide(id);
      else if (id === "rotate" && playing()) send("rotate");
      else if (id === "drop" && playing()) {
        setSoft(false);
        send("drop");
      }
    },
    onRelease: (id) => {
      if (id === slide) stopSlide();
    },
  });
  pad.el.classList.add("sta-pad");
  // the small Down: a fifth button the pad language has no room for, built like the others
  const down = document.createElement("button");
  down.className = "gp-btn secondary";
  down.dataset.id = "down";
  down.innerHTML = `<span class="gp-ico"></span><b>Down</b>`;
  pad.el.querySelector(".gp-btns")!.appendChild(down);
  const offDown = button(down, {
    haptic: tune["down-haptic"] ?? 6,
    onPress: () => playing() && setSoft(true),
    onRelease: () => setSoft(false),
  });
  const $ = (sel: string) => pad.top.querySelector(sel) as HTMLElement;
  const again = $(".sta-again");
  const mini = $(".sta-mini");
  let shownNext = "";

  const status = (): string => {
    const sh = ctl.shared;
    const own = ctl.own;
    if (!sh) return "Joining…";
    if (own?.state === "watch") return "All wells are taken. Watch the TV";
    if (own?.state === "next" && sh.phase !== "match") return "You play next round";
    switch (sh.phase) {
      case "wait":
        return "Waiting for players";
      case "count":
        return "Get ready";
      case "play":
        return own?.state === "out" ? "Out. Back next round" : "Stack and clear";
      case "round":
        return sh.solo ? "Run over" : own?.state === "in" ? "You take the round" : "Round over";
      case "match": {
        if (sh.solo) return "Run over";
        const me = own?.name;
        const w = sh.winners;
        if (me && w.includes(me)) return w.length > 1 ? "You share the win" : "You win!";
        return w.length ? `${w.join(" & ")} wins` : "Match over";
      }
    }
  };

  const drawNext = () => {
    const k = ctl.own?.state === "in" && ctl.shared?.phase !== "match" ? ctl.own.next : null;
    const key = k ?? "";
    if (key === shownNext) return;
    shownNext = key;
    if (!k) {
      mini.innerHTML = "";
      return;
    }
    // trimmed to the piece's own cells
    const cells = TURNS[k][0]!;
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1;
    const h = Math.max(...ys) - y0 + 1;
    mini.style.setProperty("--w", String(w));
    mini.style.setProperty("--h", String(h));
    mini.innerHTML = cells.map(([x, y]) => `<b style="grid-column:${x - x0 + 1};grid-row:${y - y0 + 1}"></b>`).join("");
  };

  const render = () => {
    const own = ctl.own;
    pad.el.style.setProperty("--c", own?.color ?? "#8a8578");
    $(".sta-who span").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".sta-status").textContent = status();
    const live = playing();
    pad.el.classList.toggle("sta-idle", !live && ctl.shared?.phase !== "count");
    if (!live) {
      stopSlide();
      soft = false;
    }
    drawNext();
    again.hidden = !(ctl.shared?.phase === "match" && ctx.isVip());
  };

  const offs = [
    ctl.on("state", render),
    ctx.onVip(render),
    ctl.on("message", (m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "lock") pad.buzz("lock");
      else if (m.type === "clear") pad.buzz("clear");
      else if (m.type === "hit") pad.buzz("hit");
      else if (m.type === "out") pad.buzz("out");
      else if (m.type === "go") pad.buzz("go");
    }),
    button(again, { mode: "tap", onPress: () => ctl.send({ type: "again" }) }),
  ];
  render();

  return () => {
    stopSlide();
    if (soft) send("softOff");
    offDown();
    offs.forEach((o) => o());
    pad.destroy();
  };
};

export default mount;
