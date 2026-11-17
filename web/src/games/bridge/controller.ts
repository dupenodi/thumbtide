// The phone: your order at the top (big text, a timer bar), then your panel of hardware-like controls. Everything
// comes from the sticky shared / own state, so a phone that reloads lands on the right screen. A tap goes to the TV
// as {act}; the TV owns the control state, the phone shows it at once (a guess) and corrects itself from the TV.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { BridgeControl, BridgeGame, BridgeOwn, BridgeShared } from "./shared.ts";
import "./bridge.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CAPS = ["#e53935", "#ffb000", "#8fa86a", "#d8d3c2", "#5d9bd1"];
const capOf = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAPS[h % CAPS.length]!;
};

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<BridgeGame>;
  const pad = gameById("bridge")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const hapticOf = (id: string, d: number) => pad.buttons.find((b) => b.id === id)?.haptic ?? d;

  const root = document.createElement("div");
  root.className = "bpp";
  root.innerHTML = `
    <header class="bpp-head"><span class="bpp-dot"></span><span class="bpp-name"></span><span class="bpp-chip"></span></header>
    <section class="bpp-order"><small>Your order</small><p></p><div class="bpp-timer idle"><i></i></div></section>
    <section class="bpp-grid"></section>
    <section class="bpp-msg" hidden></section>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const orderEl = $(".bpp-order");
  const orderTxt = $(".bpp-order p");
  const orderLabel = $(".bpp-order small");
  const timer = $(".bpp-timer");
  const grid = $(".bpp-grid");
  const msg = $(".bpp-msg");

  const offs: Array<() => void> = [];
  let gridKey = "";
  let gridOffs: Array<() => void> = [];
  let orderId = -1;
  let msgKey = "";
  let msgOffs: Array<() => void> = [];
  /** What this phone shows for each control (a guess until the TV confirms). */
  const local = new Map<string, number>();

  const act = (name: string, value: number) => {
    ctl.send({ type: "act", ctl: name, value });
  };

  // ------------------------------------------------------------------ the panel
  function ctlHtml(c: BridgeControl): string {
    const n = esc(c.name);
    switch (c.kind) {
      case "button":
        return `<div class="bpc bpc-button" data-ctl="${n}" style="--cap:${capOf(c.name)}"><i class="bpc-cap"></i><span class="bpc-name">${n}</span></div>`;
      case "toggle":
        return `<div class="bpc bpc-toggle" data-ctl="${n}"><span class="bpc-sw"></span><span class="bpc-state"></span><span class="bpc-name">${n}</span></div>`;
      case "lever":
        return `<div class="bpc bpc-lever" data-ctl="${n}"><span class="bpc-name">${n}</span><div class="bpc-track"><span class="bpc-handle"></span><i data-v="0">${esc(c.opts![0])}</i><i data-v="1">${esc(c.opts![1])}</i></div></div>`;
      case "dial":
        return `<div class="bpc bpc-dial wide" data-ctl="${n}"><div class="bpc-top"><span class="bpc-name">${n}</span><span class="bpc-knob"></span></div><div class="bpc-ticks">${[1, 2, 3, 4, 5].map((v) => `<i data-v="${v}">${v}</i>`).join("")}</div></div>`;
      case "slider":
        return `<div class="bpc bpc-slider wide" data-ctl="${n}"><span class="bpc-name">${n}</span><div class="bpc-ticks"><span class="bpc-cap-s"></span>${[0, 1, 2, 3, 4].map((v) => `<i data-v="${v}">${v}</i>`).join("")}</div></div>`;
    }
  }

  function wire(el: HTMLElement, c: BridgeControl) {
    const press = (v: number) => {
      if (c.kind !== "button") {
        local.set(c.name, v);
        refresh(c, el);
      } else {
        el.classList.remove("fired");
        void el.offsetWidth;
        el.classList.add("fired");
      }
      act(c.name, v);
    };
    if (c.kind === "button") gridOffs.push(button(el, { haptic: hapticOf("push", 14), onPress: () => press(1) }));
    else if (c.kind === "toggle")
      gridOffs.push(button(el, { haptic: hapticOf("switch", 12), onPress: () => press((local.get(c.name) ?? c.state) ? 0 : 1) }));
    else
      for (const z of el.querySelectorAll<HTMLElement>("[data-v]"))
        gridOffs.push(button(z, { haptic: hapticOf(c.kind === "lever" ? "switch" : "set", 12), onPress: () => press(Number(z.dataset.v)) }));
  }

  function refresh(c: BridgeControl, el: HTMLElement) {
    const v = local.get(c.name) ?? c.state;
    el.dataset.s = String(v);
    if (c.kind === "toggle") (el.querySelector(".bpc-state") as HTMLElement).textContent = v ? "ON" : "OFF";
    if (c.kind === "dial") el.style.setProperty("--rot", `${(v - 3) * 50}deg`);
    if (c.kind === "slider") el.style.setProperty("--pos", String(v));
    for (const z of el.querySelectorAll<HTMLElement>("[data-v]")) z.classList.toggle("on", Number(z.dataset.v) === v);
  }

  function showPanel(own: BridgeOwn) {
    const key = `${own.deal}:${own.panel.map((c) => `${c.name}.${c.kind}`).join()}`;
    if (key !== gridKey) {
      gridKey = key;
      gridOffs.forEach((f) => f());
      gridOffs = [];
      local.clear();
      grid.innerHTML = own.panel.map(ctlHtml).join("");
      grid.classList.remove("new");
      for (const c of own.panel) wire(grid.querySelector(`[data-ctl="${CSS.escape(c.name)}"]`) as HTMLElement, c);
    }
    // the TV's word wins over our guess
    for (const c of own.panel) {
      local.delete(c.name);
      refresh(c, grid.querySelector(`[data-ctl="${CSS.escape(c.name)}"]`) as HTMLElement);
    }
  }

  // ------------------------------------------------------------------ the order
  function showOrder(own: BridgeOwn, s: BridgeShared) {
    const o = own.order;
    if (!o) {
      orderId = -1;
      orderTxt.textContent = s.phase === "intro" ? `Sector ${s.sector}: find your controls` : "…";
      orderLabel.textContent = s.phase === "intro" ? "Stations" : "Your order";
      timer.classList.add("idle");
      return;
    }
    orderLabel.textContent = "Your order";
    orderTxt.textContent = o.text;
    if (o.id !== orderId) {
      orderId = o.id;
      orderEl.classList.remove("new");
      void orderEl.offsetWidth;
      orderEl.classList.add("new");
    }
    // the bar runs on the phone, from what is left when the TV sent it
    const bar = timer.querySelector("i") as HTMLElement;
    timer.classList.remove("idle");
    const spec = `${o.ttl}|${o.left}`;
    if (bar.dataset.spec !== `${o.id}|${spec}`) {
      bar.dataset.spec = `${o.id}|${spec}`;
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = "";
      bar.style.animationDuration = `${o.ttl}ms`;
      bar.style.animationDelay = `${o.left - o.ttl}ms`;
    }
  }

  // ------------------------------------------------------------------ messages in place of the panel
  function showMsg(key: string, html: string, wireFn?: (el: HTMLElement) => void) {
    grid.hidden = true;
    orderEl.hidden = true;
    msg.hidden = false;
    if (key === msgKey) return;
    msgKey = key;
    msgOffs.forEach((f) => f());
    msgOffs = [];
    msg.innerHTML = html;
    wireFn?.(msg);
  }
  function hideMsg() {
    msg.hidden = true;
    msgKey = "";
    grid.hidden = false;
    orderEl.hidden = false;
  }

  function render() {
    const s = ctl.shared;
    const own = ctl.own;
    root.style.setProperty("--c", own?.color ?? "#9aa3ad");
    $(".bpp-name").textContent = own?.name ?? ctl.me?.name ?? "";
    $(".bpp-chip").textContent = s && (s.phase === "play" || s.phase === "intro") ? `Sector ${s.sector} · Hull ${s.hull}%` : "";
    root.classList.toggle("lights", s?.phase === "play" && s.event === "lights");

    if (!s || !own) return showMsg("join", `<h2>Taking your seat…</h2>`);
    if (own.state === "watch") return showMsg("watch", `<h2>The crew is full</h2><p>You are in when a seat frees up.</p>`);
    switch (s.phase) {
      case "wait":
        return showMsg("wait", `<h2>Waiting for crew</h2><p>The ship sails when somebody is aboard.</p>`);
      case "break":
        return showMsg(
          `break:${s.sector}`,
          `<h2>Sector ${s.sector} cleared</h2><p>Hull mended. New panels in a moment.</p>`,
        );
      case "end": {
        const vip = ctx.isVip();
        const sh = ctx.shell();
        const decider = sh?.players.find((p) => p.id === sh.vip)?.name ?? "The host";
        return showMsg(
          `end:${s.reached}:${s.best}:${own.done}:${vip}:${decider}`,
          `<h2>Hull breached</h2><div class="big">${s.reached}</div><p>sectors reached · crew best ${Math.max(s.best, s.reached)}</p><p>You finished ${own.done} orders.</p>${
            vip
              ? `<div class="bpp-actions"><button class="bpp-btn" data-act="again">Sail again</button><button class="bpp-btn ghost" data-act="lobby">Back to the lobby</button></div>`
              : `<p><b>${esc(decider)}</b> picks what is next.</p>`
          }`,
          (el) => {
            for (const b of el.querySelectorAll<HTMLElement>("[data-act]"))
              msgOffs.push(
                button(b, { mode: "tap", onPress: () => (b.dataset.act === "again" ? ctl.send({ type: "again" }) : ctx.exitToLobby()) }),
              );
          },
        );
      }
      default:
        hideMsg();
        // shared and own arrive apart: if this panel is older than the sector, keep what is on screen
        showPanel(own);
        showOrder(own, s);
    }
  }

  offs.push(
    ctl.on("state", render),
    ctx.onVip(() => {
      msgKey = "";
      render();
    }),
    ctl.on("message", (m) => {
      if (m && typeof m === "object" && m.type === "buzz") buzz(m.kind);
    }),
  );
  render();

  return () => {
    offs.forEach((f) => f());
    gridOffs.forEach((f) => f());
    msgOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
