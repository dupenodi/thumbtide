// The phone: your pawn and cash on top, your plots as small district-colour chips, the rivals, and a panel at the
// bottom with the actions of the moment as big buttons: Roll, Buy or Pass, Build, Offer a trade, End turn, and an
// Accept / Decline card when someone offers you a trade. Everything comes from the TV's shared and own state, so a
// phone that reloads shows the right screen in any phase.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { esc, money, pawnSvg } from "./look.ts";
import { BOARD, DISTRICTS, SIZE } from "./rules.ts";
import { PLAYER_COLORS, type BoomGame, type BoomOwn, type BoomShared } from "./shared.ts";
import "./boomtown.css";

type Mode = "menu" | "build" | "pick" | "to" | "price";

const WAIT: Record<string, string> = {
  roll: "is about to roll",
  move: "is on the move",
  buy: "is deciding on a purchase",
  act: "is building and trading",
  trade: "is waiting for an answer",
  card: "is reading a rumour",
  skip: "sits this turn out",
};

const plotInfo = (i: number) => {
  const sp = BOARD[i]!;
  if (sp.kind !== "plot") return { name: sp.name, color: "#777", district: "", price: 0 };
  const d = DISTRICTS[sp.district]!;
  return { name: sp.name, color: d.color, district: d.name, price: sp.price };
};

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<BoomGame>;
  const pad = gameById("boomtown")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const feel = (id: string, fallback: number) => pad.buttons.find((b) => b.id === id)?.haptic ?? fallback;

  const root = document.createElement("div");
  root.className = "btp";
  root.innerHTML = `
    <header class="btp-head"><span class="btp-pawn"></span><span class="btp-name"></span><span class="btp-chip"></span><span class="btp-clock" hidden></span></header>
    <section class="btp-cash"><small>Cash</small><b></b><span></span></section>
    <section class="btp-plots"></section>
    <section class="btp-rivals"></section>
    <section class="btp-panel"></section>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const panel = $(".btp-panel");

  const offs: Array<() => void> = [];
  let panelOffs: Array<() => void> = [];

  // local screen state: which sheet is open, and what is being offered
  let mode: Mode = "menu";
  let offerPlot = -1;
  let offerTo = -1;
  let offerPrice = 100;
  let errText = "";
  let sceneKey = "";
  let lastHtml = "";

  const me = (s: BoomShared) => s.players.findIndex((p) => p.id === ctl.me?.id);

  // ------------------------------------------------------------------ the panel
  const status = (h: string, small = "") => `<p class="btp-status">${h}${small ? `<small>${small}</small>` : ""}</p>`;
  const btn = (act: string, text: string, cls = "", sub = "", data = "") =>
    `<button class="btp-btn ${cls}" data-act="${act}" ${data}>${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
  const deed = (plot: number, right = "") => {
    const p = plotInfo(plot);
    return `<div class="btp-deed" style="--d:${p.color}"><i></i><div><small>${esc(p.district)}</small><b>${esc(p.name)}</b></div>${right ? `<span>${right}</span>` : ""}</div>`;
  };

  function panelHtml(s: BoomShared, o: BoomOwn | null, seat: number): string {
    const turn = s.players[s.turn];
    const mine = seat === s.turn && !!turn && !turn.out;
    const self = s.players[seat];
    const err = errText ? `<p class="btp-err">${esc(errText)}</p>` : `<p class="btp-err"></p>`;
    if (s.phase === "over") {
      const w = s.players[s.winner];
      const won = s.winner === seat;
      const vip = ctx.isVip();
      const sh = ctx.shell();
      const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
      return (
        status(won ? "You win the match" : `${esc(w?.name ?? "Someone")} wins the match`, s.why === "last" ? "Last one standing." : "Richest when the clock ran out.") +
        (vip
          ? `<div class="btp-actions">${btn("again", "Play again", "primary")}${btn("lobby", "Back to lobby")}</div>`
          : `<p class="btp-status"><small>${esc(decider ?? "The host")} picks what is next.</small></p>`)
      );
    }
    if (seat < 0) return status("You are watching", "Every seat is taken. You get one when someone leaves.");
    if (self?.out) return status("You are out of the game", "Watch the rest on the TV.");

    // an offer for me
    if (s.phase === "trade" && s.offer && s.offer.to === seat) {
      const seller = s.players[s.offer.from]?.name ?? "Someone";
      const can = (self?.cash ?? 0) >= s.offer.price;
      return (
        status(`${esc(seller)} offers you a plot`, "Say yes or no. No answer means no.") +
        `<div style="margin-top:10px">${deed(s.offer.plot, money(s.offer.price))}</div>` +
        `<div class="btp-actions row">${btn("accept", "Accept", "primary", can ? "" : "Not enough cash", can ? "" : "disabled")}${btn("decline", "Decline")}</div>`
      );
    }

    if (mine) {
      switch (s.phase) {
        case "roll":
          return status("Your turn", "Roll the dice.") + `<div class="btp-actions">${btn("roll", "Roll", "primary xl")}</div>`;
        case "move":
          return status("Rolling…");
        case "buy": {
          const p = plotInfo(s.buying);
          return (
            `<div>${deed(s.buying, money(p.price))}</div>` +
            `<div class="btp-actions row">${btn("buy", `Buy ${money(p.price)}`, "primary xl")}${btn("pass", "Pass", "xl")}</div>`
          );
        }
        case "card":
          return s.card ? status(esc(s.card.title), esc(s.card.text)) : status("A rumour…");
        case "skip":
          return status("Dock Strike", "You sit this turn out.");
        case "trade":
          return status("Waiting for an answer", "They have 20 seconds.");
        case "act":
          return actHtml(s, o!, err);
        default:
          break;
      }
    }
    const who = esc(turn?.name ?? "Someone");
    return status(`${who} ${WAIT[s.phase] ?? ""}`, s.phase === "card" && s.card ? esc(s.card.title) : "Watch the TV.");
  }

  function actHtml(s: BoomShared, o: BoomOwn, err: string): string {
    const buildable = o.buildable;
    if (mode === "build" && buildable.length) {
      return (
        status("Build a storey", "Pick a plot. Storeys go up evenly across the district.") +
        `<div class="btp-list">${buildable
          .map((b) => {
            const p = plotInfo(b.plot);
            return `<button class="btp-pick" style="--d:${p.color}" data-act="build" data-plot="${b.plot}"><i></i>${esc(p.name)}<em>${money(b.cost)}</em></button>`;
          })
          .join("")}</div>
        <div class="btp-actions">${btn("back", "Back")}</div>${err}`
      );
    }
    if (mode === "pick" && o.tradable.length) {
      return (
        status("Offer which plot?") +
        `<div class="btp-list">${o.tradable
          .map((q) => {
            const p = plotInfo(q);
            return `<button class="btp-pick" style="--d:${p.color}" data-act="pick" data-plot="${q}"><i></i>${esc(p.name)}<em>${money(p.price)}</em></button>`;
          })
          .join("")}</div>
        <div class="btp-actions">${btn("back", "Back")}</div>`
      );
    }
    if (mode === "to" && offerPlot >= 0) {
      return (
        status(`Offer ${esc(plotInfo(offerPlot).name)} to…`) +
        `<div class="btp-list">${s.players
          .map((p, i) => ({ p, i }))
          .filter(({ p, i }) => i !== o.seat && !p.out)
          .map(({ p, i }) => `<button class="btp-pick" data-act="to" data-to="${i}" ${p.cash < 10 ? "disabled" : ""}><span class="btp-pawn">${pawnSvg(p.color, 30)}</span>${esc(p.name)}<em>${money(p.cash)}</em></button>`)
          .join("")}</div>
        <div class="btp-actions">${btn("back", "Back")}</div>`
      );
    }
    if (mode === "price" && offerPlot >= 0 && offerTo >= 0) {
      const buyer = s.players[offerTo];
      return (
        status(`${esc(plotInfo(offerPlot).name)} to ${esc(buyer?.name ?? "")}`, `They have ${money(buyer?.cash ?? 0)}. List price ${money(plotInfo(offerPlot).price)}.`) +
        `<div class="btp-price"><button class="btp-step" data-step="-50">-50</button><button class="btp-step" data-step="-10">-10</button><span class="num">${money(offerPrice)}</span><button class="btp-step" data-step="10">+10</button><button class="btp-step" data-step="50">+50</button></div>
        <div class="btp-actions row">${btn("send", "Send offer", "primary")}${btn("back", "Back")}</div>${err}`
      );
    }
    const none = !buildable.length;
    return (
      status("Your turn", "Build, offer a trade, or end your turn.") +
      `<div class="btp-actions">
        ${btn("build", "Build", "", none ? "Needs a whole district and cash" : `${buildable.length} ${buildable.length === 1 ? "plot" : "plots"} ready`, none ? "disabled" : "")}
        ${btn("offer", "Offer a trade", "", o.canOffer ? (o.tradable.length ? "One offer a turn" : "You have no plot to offer") : "Used this turn", o.canOffer && o.tradable.length ? "" : "disabled")}
        ${btn("end", "End turn", "primary xl")}
      </div>${err}`
    );
  }

  function wire() {
    panelOffs.forEach((f) => f());
    panelOffs = [];
    for (const el of panel.querySelectorAll<HTMLElement>("[data-act]")) {
      const a = el.dataset.act!;
      panelOffs.push(
        button(el, {
          mode: "tap",
          haptic: feel(a === "build" ? "build" : a === "offer" ? "offer" : a === "buy" || a === "pass" ? "buy" : a === "roll" ? "roll" : "end", 14),
          onPress: () => !(el as HTMLButtonElement).disabled && act(a, el),
        }),
      );
    }
    for (const el of panel.querySelectorAll<HTMLElement>("[data-step]")) {
      panelOffs.push(
        button(el, {
          mode: "press",
          haptic: 8,
          onPress: () => {
            const s = ctl.shared;
            const cap = Math.max(10, Math.floor((s?.players[offerTo]?.cash ?? 9990) / 10) * 10);
            offerPrice = Math.max(10, Math.min(cap, offerPrice + Number(el.dataset.step)));
            render();
          },
        }),
      );
    }
  }

  function act(a: string, el: HTMLElement) {
    const s = ctl.shared;
    const o = ctl.own;
    errText = "";
    switch (a) {
      case "roll":
        ctl.send({ type: "roll" });
        break;
      case "buy":
        ctl.send({ type: "buy" });
        break;
      case "pass":
        ctl.send({ type: "pass" });
        break;
      case "end":
        ctl.send({ type: "end" });
        break;
      case "accept":
        ctl.send({ type: "respond", accept: true });
        break;
      case "decline":
        ctl.send({ type: "respond", accept: false });
        break;
      case "build":
        if (el.dataset.plot !== undefined) ctl.send({ type: "build", plot: Number(el.dataset.plot) });
        else mode = "build";
        break;
      case "offer":
        mode = "pick";
        break;
      case "pick":
        offerPlot = Number(el.dataset.plot);
        mode = "to";
        break;
      case "to": {
        offerTo = Number(el.dataset.to);
        const cap = Math.max(10, Math.floor((s?.players[offerTo]?.cash ?? 9990) / 10) * 10);
        const list = (BOARD[offerPlot] as { price?: number } | undefined)?.price ?? 100;
        offerPrice = Math.max(10, Math.min(cap, Math.round(list / 10) * 10));
        mode = "price";
        break;
      }
      case "send":
        ctl.send({ type: "offer", plot: offerPlot, to: offerTo, price: offerPrice });
        break;
      case "back":
        mode = mode === "price" ? "to" : mode === "to" ? "pick" : "menu";
        break;
      case "again":
        ctl.send({ type: "again" });
        break;
      case "lobby":
        ctx.exitToLobby();
        return;
    }
    void o;
    render();
  }

  // ------------------------------------------------------------------ drawing
  let headKey = "";
  let plotsKey = "";
  let rivalsKey = "";
  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    const nameEl = $(".btp-name");
    nameEl.textContent = ctl.me?.name ?? "";
    if (!s || !s.players.length) {
      panel.innerHTML = status("Joining…");
      return;
    }
    const seat = me(s);
    const self = s.players[seat];
    const turn = s.players[s.turn];
    // header
    const color = self ? PLAYER_COLORS[self.color]! : "#8a8f96";
    const onC = color === PLAYER_COLORS[2] || color === PLAYER_COLORS[4] ? "#1e2a2f" : "#fff";
    const chip = s.phase === "over" ? "Match over" : self?.out ? "Out" : seat === s.turn ? "Your turn" : seat < 0 ? "Watching" : "";
    const hk = `${color}:${self?.name}:${chip}`;
    if (hk !== headKey) {
      headKey = hk;
      root.style.setProperty("--c", color);
      root.style.setProperty("--on-c", onC);
      $(".btp-pawn").innerHTML = self ? pawnSvg(self.color, 36) : "";
      const c = $(".btp-chip");
      c.textContent = chip;
      c.classList.toggle("you", seat === s.turn && s.phase !== "over");
    }
    // cash
    $(".btp-cash b").textContent = self ? money(self.cash) : "$0";
    $(".btp-cash span").textContent = self ? `Worth ${money(self.worth)}` : "";
    // plots
    const mineList: number[] = [];
    for (let i = 0; i < SIZE; i++) if (seat >= 0 && s.owner[i] === seat) mineList.push(i);
    const pk = mineList.map((i) => `${i}:${s.storeys[i]}`).join();
    if (pk !== plotsKey) {
      plotsKey = pk;
      $(".btp-plots").innerHTML = mineList
        
.map((i) => `<span class="btp-chip-plot" style="--d:${plotInfo(i).color}"><b>${esc(plotInfo(i).name)}</b><i>${"<s></s>".repeat(s.storeys[i]!)}</i></span>`)
        .join("");
    }
    // rivals
    const rk = JSON.stringify([s.players.map((p) => [p.name, p.cash, p.out, p.color]), s.turn, seat]);
    if (rk !== rivalsKey) {
      rivalsKey = rk;
      $(".btp-rivals").innerHTML = s.players
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => i !== seat)
        .map(({ p, i }) => `<div class="btp-rival ${i === s.turn ? "turn" : ""} ${p.out ? "out" : ""}"><span class="btp-pawn">${pawnSvg(p.color, 22)}</span>${esc(p.name)}<b>${p.out ? "Out" : money(p.cash)}</b></div>`)
        .join("");
    }
    // the panel: rebuilt only when it changes
    const base = `${s.phase}:${s.turn}:${s.round}:${s.offer?.plot ?? ""}`;
    if (base !== sceneKey) {
      sceneKey = base;
      mode = "menu";
      errText = "";
      offerPlot = offerTo = -1;
    }
    // a sheet whose options are gone falls back to the menu
    if (o && (mode === "build" && !o.buildable.length)) mode = "menu";
    const html = o || s.phase === "over" || seat < 0 ? panelHtml(s, o ?? null, seat) : status("Taking a seat…");
    void turn;
    if (html !== lastHtml) {
      lastHtml = html;
      panel.innerHTML = html;
      wire();
    }
    drawClock();
  }

  // the clock: the TV sends what is left when a phase starts, the phone counts down (only when the game waits for you)
  let deadline = 0;
  let clockFor: unknown = null;
  const clockEl = $(".btp-clock");
  function drawClock() {
    const s = ctl.shared;
    const seat = s ? me(s) : -1;
    const waiting = !!s && ((["roll", "buy", "act"].includes(s.phase) && s.turn === seat) || (s.phase === "trade" && s.offer?.to === seat));
    const on = waiting && deadline > 0;
    clockEl.hidden = !on;
    if (!on) return;
    const sec = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    clockEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    clockEl.classList.toggle("low", sec <= 8);
  }
  const clockTimer = setInterval(drawClock, 500);
  offs.push(() => clearInterval(clockTimer));

  offs.push(
    ctl.on("state", () => {
      if (ctl.shared !== clockFor) {
        clockFor = ctl.shared;
        deadline = ctl.shared && ctl.shared.left > 0 ? performance.now() + ctl.shared.left : 0;
      }
      render();
    }),
    ctx.onVip(() => {
      lastHtml = "";
      render();
    }),
    ctl.on("message", (d) => {
      if (!d || typeof d !== "object") return;
      if (d.type === "buzz") buzz(d.kind);
      else if (d.type === "refused") {
        errText = d.text;
        buzz("rent");
        lastHtml = "";
        render();
      }
    }),
  );
  render();

  return () => {
    offs.forEach((f) => f());
    panelOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
