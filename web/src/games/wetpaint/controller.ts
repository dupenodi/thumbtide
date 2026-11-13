import type { Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { juicy, type JuicyTheme } from "../kit/juicy.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { PAINTS, TUNING, type HudRow, type WetPaintGame } from "./shared.ts";
import "./wetpaint.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
const CROWN = `<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M4 40 L8 10 L22 24 L32 4 L42 24 L56 10 L60 40 Z" fill="#ffd23f" stroke="#0b0b12" stroke-width="4" stroke-linejoin="round"/></svg>`;

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<WetPaintGame>;
  const def = gameById("wetpaint")!;
  const wrap = document.createElement("div");
  wrap.className = "wpc";
  ctx.root.appendChild(wrap);

  const pad = gamepad(wrap, def.controls!, {
    ctl,
    top: `
      <div class="wpc-ready"><span class="wpc-ready-blob"></span><span class="wpc-ready-txt"><small>You're</small><b class="wpc-ready-paint"></b></span><span class="wpc-count"></span></div>
      <div class="wpc-head">
        <span class="wpc-name"></span><span class="wpc-paint"></span>
        <span class="wpc-time"></span><span class="wpc-rank-chip"></span><span class="wpc-pct"></span>
      </div>
      <div class="wpc-meter"><i></i><span>PAINT</span></div>
      <div class="wpc-hero"><div class="wpc-hero-blob"><b class="wpc-hero-pct">0%</b><small>of the canvas</small></div></div>`,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => {
      if (id === "dash") ctl.send({ type: "dash" });
      if (id === "splat") {
        if (!warmup() && (hud[8] || (hud[0] >= TUNING.splatCost && !hud[2]))) ctl.send({ type: "splat" });
        else pad.buzz("nope");
      }
    },
  });
  const over = document.createElement("div");
  over.className = "wpc-over";
  over.setAttribute("data-scroll", "");
  over.hidden = true;
  wrap.appendChild(over);
  const pops = document.createElement("div");
  pops.className = "wpc-pops";
  wrap.appendChild(pops);

  const $ = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
  const meter = $(".wpc-meter");
  const meterFill = meter.querySelector("i") as HTMLElement;
  const meterText = meter.querySelector("span") as HTMLElement;
  const splatBtn = pad.btn("splat")!;
  const dashBtn = pad.btn("dash")!;
  const splatLabel = splatBtn.querySelector("b") as HTMLElement;

  let hud: HudRow = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let timeLeft = 0;
  let overKey = "";
  let lastPhase = "";
  let lastCount = "";
  /** The count-in: you can already drive (and dash) around, the paint starts flowing on GO. */
  const warmup = () => (ctl.shared?.phase ?? "intro") === "intro";

  /** A candy-lettered callout on the phone. */
  function pop(text: string, theme: JuicyTheme) {
    const e = document.createElement("div");
    e.className = "wpc-pop";
    e.innerHTML = juicy(text, theme);
    pops.appendChild(e);
    setTimeout(() => e.remove(), 1400);
  }

  function setOver(key: string, html: string | null, cls = "") {
    if (key === overKey) return;
    overKey = key;
    over.className = `wpc-over ${cls}`;
    over.hidden = html === null;
    over.innerHTML = html ?? "";
    for (const b of over.querySelectorAll<HTMLButtonElement>("[data-act]")) {
      button(b, {
        mode: "tap",
        onPress: () => {
          if (b.dataset.act === "again") ctl.send({ type: "again" });
          else ctx.exitToLobby();
        },
      });
    }
  }

  function render() {
    const own = ctl.own;
    const shared = ctl.shared;
    const me = ctl.me;
    if (own) {
      wrap.style.setProperty("--c", own.color);
      wrap.style.setProperty("--cl", own.light);
    }
    $(".wpc-name").textContent = me?.name ?? "";
    $(".wpc-paint").textContent = own?.paint ?? "";

    if (!own) {
      if (me && shared?.watching?.includes(me.id)) {
        setOver("full", `<h2>Watching</h2><p>All eight brushes are taken. You'll get one when one comes free.</p>`);
      } else {
        setOver("wait", `<div class="spinner"></div><p>Getting your brush…</p>`);
      }
      return;
    }
    const phase = shared?.phase ?? "intro";
    wrap.classList.toggle("wpc-warmup", phase === "intro");
    if (phase === "play" && lastPhase === "intro") {
      pop("PAINT!", "gold");
      pad.buzz("go");
    }
    if (phase !== lastPhase) {
      lastPhase = phase;
      renderHud();
    }
    if (phase === "intro") {
      // nothing in the way: the controls stay live for the warm-up
      $(".wpc-ready-paint").textContent = own.paint;
      setOver("play", null);
      return;
    }
    if (phase === "end" && shared?.results) {
      const results = shared.results;
      const rank = results.findIndex((r) => r.id === me?.id);
      const mine = results[rank];
      const vip = ctx.isVip();
      const sh = ctx.shell();
      const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
      setOver(
        `end:${shared.round}:${vip}:${decider}`,
        `<div class="wpc-end">
           <section class="wpc-end-me">
             ${rank === 0 ? `<span class="wpc-crown">${CROWN}</span>` : ""}
             <h2>${juicy(rank === 0 ? "You win!" : rank > 0 ? `${ordinal(rank + 1)} place` : "Round over", rank === 0 ? "gold" : rank === 1 ? "sky" : rank === 2 ? "grape" : "mint")}</h2>
             ${mine ? `<p>${mine.pct.toFixed(1)}% of the canvas</p>` : ""}
             ${
               vip
                 ? `<div class="wpc-actions"><button class="wpc-btn primary" data-act="again">Play again</button><button class="wpc-btn" data-act="lobby">Lobby</button></div>`
                 : `<p class="wpc-wait"><b>${esc(decider ?? "The host")}</b> picks what's next</p>`
             }
           </section>
           <ol class="wpc-results">${results
             .map(
               (r, i) => `<li class="${r.id === me?.id ? "wpc-me" : ""}" style="--sc:${PAINTS[r.slot]!.half}">
                 <span class="rk">${i + 1}</span><span class="sw"></span><span class="nm">${esc(r.name)}</span><b>${r.pct.toFixed(1)}%</b></li>`,
             )
             .join("")}</ol>
         </div>`,
        "wpc-end-over",
      );
      return;
    }
    if (hud[2]) {
      setOver("stun", `<div class="wpc-stun">${juicy("SPLAT!", "fire")}</div><p>Shake it off…</p>`, "wpc-splatted wpc-passthru");
      return;
    }
    setOver("play", null);
  }

  function renderHud() {
    const [load, dashCd, , pct, , , , dryT, bomb, rank] = hud;
    const chip = $(".wpc-rank-chip");
    chip.textContent = rank ? (rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`) : "";
    chip.dataset.rank = String(rank);
    const frenzy = !!ctl.shared?.frenzy;
    const warm = warmup();
    meterFill.style.width = `${Math.round(load * 100)}%`;
    meter.classList.toggle("low", load < 0.12 && !frenzy && dryT <= 0);
    meter.classList.toggle("dried", dryT > 0);
    meter.classList.toggle("frenzy", frenzy);
    meterText.textContent = warm
      ? "PAINT FLOWS ON GO"
      : dryT > 0 ? "DRIED UP"
      : load < 0.12 && !frenzy ? "EMPTY · FIND A PAINT POT"
      : "PAINT";
    splatBtn.classList.toggle("bomb", !!bomb);
    splatBtn.classList.toggle("off", warm || (!bomb && load < TUNING.splatCost));
    splatLabel.textContent = bomb ? "BOMB!" : "SPLAT!";
    dashBtn.style.setProperty("--cd", String(dashCd));
    $(".wpc-pct").textContent = `${pct.toFixed(0)}%`;
    // the count-in, in sync with the TV
    const count = warm ? (timeLeft >= 1 && timeLeft <= 3 ? String(timeLeft) : "") : "";
    if (count !== lastCount) {
      lastCount = count;
      const c = $(".wpc-count");
      c.textContent = count;
      c.classList.remove("tick");
      void c.offsetWidth;
      c.classList.add("tick");
      if (count) pad.buzz("count");
    }
    $(".wpc-hero-pct").textContent = warm ? count || "Ready?" : `${pct.toFixed(0)}%`;
    $(".wpc-hero small").textContent = warm ? "get ready" : "of the canvas";
    $(".wpc-hero").dataset.rank = String(rank);
    $(".wpc-time").textContent = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`;
  }

  const offs = [
    ctl.on("state", render),
    ctx.onVip(() => {
      overKey = "";
      render();
    }),
    ctl.on("message", (d) => {
      if (!d || typeof d !== "object") return;
      if (d.type === "hud") {
        const mine = ctl.me ? d.p[ctl.me.id] : undefined;
        timeLeft = d.t;
        if (mine) {
          const wasStunned = hud[2];
          hud = mine;
          if (wasStunned !== hud[2]) render();
        }
        renderHud();
      } else if (d.type === "buzz") {
        // the phone is a controller: it buzzes, the TV does the showing
        pad.buzz(d.kind);
      } else if (d.type === "power") {
        pad.buzz("power");
      }
    }),
  ];
  render();
  renderHud();

  return () => {
    pad.destroy();
    offs.forEach((o) => o());
    wrap.remove();
    ctl.input({ x: 0, y: 0 });
  };
};

export default mount;
