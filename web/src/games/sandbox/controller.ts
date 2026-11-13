import type { Controller } from "@thumbtide/sdk";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { SandboxGame } from "./shared.ts";
import "./sandbox.css";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<SandboxGame>;
  const pad = gamepad(ctx.root, gameById("sandbox")!.controls!, {
    ctl,
    top: `<div class="sbx-top"><span class="sbx-name"></span><span class="sbx-ping"></span></div>`,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => id === "pulse" && ctl.send({ type: "pulse" }),
  });

  const render = () => {
    pad.el.style.setProperty("--c", ctl.own?.color ?? "#7c5cff");
    pad.el.style.setProperty("--cl", ctl.own?.color ?? "#9d85ff");
    (pad.top.querySelector(".sbx-name") as HTMLElement).textContent = ctl.me?.name ?? "";
  };
  const offs = [
    ctl.on("state", render),
    ctl.on("message", (d) => {
      if (d?.type !== "buzz") return;
      pad.buzz("echo");
      const b = pad.btn("pulse")!;
      b.classList.remove("flash");
      void b.offsetWidth;
      b.classList.add("flash");
    }),
  ];
  const pingTimer = setInterval(() => ((pad.top.querySelector(".sbx-ping") as HTMLElement).textContent = `${Math.round(ctl.rtt)}ms`), 500);
  render();

  return () => {
    pad.destroy();
    offs.forEach((o) => o());
    clearInterval(pingTimer);
    ctl.input({ x: 0, y: 0 });
  };
};

export default mount;
