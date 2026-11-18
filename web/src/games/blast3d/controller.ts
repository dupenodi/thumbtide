// Blast 3D is a performance spike: the fighters are computer-controlled, so the phone only says so.
import type { ControllerMount } from "../types.ts";

const mount: ControllerMount = (ctx) => {
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:600 20px Inter,system-ui,sans-serif;color:#fff;background:#1d2a38";
  el.textContent = "Blast 3D test. Watch the TV.";
  ctx.root.appendChild(el);
  return () => el.remove();
};
export default mount;
