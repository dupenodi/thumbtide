// The phone: a status line on top, the board in the middle and a panel at the bottom.
// Agents tap a card to propose it (tap it again to take it back); the team's majority reveals it. The handler's board
// shows the key, and on their turn the panel holds the clue form: a real text field, a number, and a big Send button.
// The whole screen fits the visible area, so the keyboard pushes the board smaller instead of covering the button.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { STOP, checkClue } from "./rules.ts";
import { TEAM_COLOR, TEAM_NAME, type Owner, type SpyGame, type SpyOwn, type SpyShared, type Team } from "./shared.ts";
import "./spyline.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ON_TEAM: Record<Team, string> = { cobalt: "#f2efe8", saffron: "#1d2024" };
const OWNER_LINE: Record<Owner, string> = { cobalt: "a Cobalt card", saffron: "a Saffron card", neutral: "a bystander", burn: "the burn card" };

interface Scene {
  key: string;
  html: string;
  form?: boolean;
}

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<SpyGame>;
  const pad = gameById("spyline")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const feel = (id: string, fallback: number) => pad.buttons.find((b) => b.id === id)?.haptic ?? fallback;

  const root = document.createElement("div");
  root.className = "spp";
  root.innerHTML = `
    <header class="spp-head"><span class="spp-dot"></span><span class="spp-name"></span><span class="spp-chip"></span><span class="spp-clock" hidden></span></header>
    <section class="spp-clue" hidden></section>
    <section class="spp-grid"></section>
    <section class="spp-panel"></section>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const gridEl = $(".spp-grid");
  const panel = $(".spp-panel");
  const clueEl = $(".spp-clue");

  const offs: Array<() => void> = [];
  let panelOffs: Array<() => void> = [];
  let cellOffs: Array<() => void> = [];
  let scene: Scene | null = null;

  // the clue form keeps what you typed across updates
  let draft = "";
  let num = 2;
  let sending = false;
  let seenErr = 0;
  let localErr = "";
  /** A pick sent and not yet confirmed by the TV (so the tap shows at once). */
  let optimistic: { i: number | null; at: number } | null = null;

  // ------------------------------------------------------------------ who am I
  const meIndex = (s: SpyShared) => s.seats.findIndex((x) => x.id === ctl.me?.id);
  const myPick = (s: SpyShared): number | null => {
    if (optimistic && performance.now() - optimistic.at < 1500) return optimistic.i;
    const me = meIndex(s);
    if (me < 0) return null;
    if (s.stop.includes(me)) return STOP;
    const i = s.cards.findIndex((c) => c.picks.includes(me));
    return i >= 0 ? i : null;
  };
  const agentTurn = (s: SpyShared, o: SpyOwn) => s.phase === "guess" && o.role === "agent" && o.team === s.turn;

  // ------------------------------------------------------------------ the board
  let gridKey = "";
  let cells: HTMLButtonElement[] = [];
  function drawGrid(s: SpyShared, o: SpyOwn | null) {
    const key = s.round + ":" + s.cards.map((c) => c.word).join();
    if (key !== gridKey) {
      gridKey = key;
      cellOffs.forEach((f) => f());
      cellOffs = [];
      gridEl.innerHTML = s.cards
        .map((c, i) => {
          const size = Math.max(10.5, Math.min(15, Math.floor((64 / (c.word.length * 0.62)) * 2) / 2));
          return `<button class="spp-cell" data-i="${i}" style="font-size:${size}px"><span>${esc(c.word)}</span><span class="dots"></span></button>`;
        })
        .join("");
      cells = [...gridEl.querySelectorAll<HTMLButtonElement>(".spp-cell")];
      cells.forEach((el, i) => cellOffs.push(button(el, { mode: "tap", haptic: feel("pick", 12), onPress: () => tapCard(i) })));
    }
    const live = !!o && agentTurn(s, o);
    const mine = live ? myPick(s) : null;
    const handler = o?.role === "handler" && !!o.key;
    s.cards.forEach((c, i) => {
      const el = cells[i]!;
      const owner = handler ? o!.key![i]! : c.owner;
      el.dataset.o = owner && (handler || c.revealed || s.phase === "round" || s.phase === "match") ? owner : "";
      el.classList.toggle("key", handler);
      el.classList.toggle("rev", c.revealed);
      el.classList.toggle("mine", live && mine === i);
      el.disabled = !live || c.revealed;
      const dots = c.revealed || s.phase !== "guess" ? 0 : c.picks.length;
      const d = el.lastElementChild as HTMLElement;
      if (d.childElementCount !== dots) d.innerHTML = "<i></i>".repeat(dots);
    });
    root.classList.toggle("agent-turn", live);
  }

  function tapCard(i: number) {
    const s = ctl.shared;
    const o = ctl.own;
    if (!s || !o || !agentTurn(s, o) || s.cards[i]?.revealed) return;
    const next = myPick(s) === i ? null : i;
    optimistic = { i: next, at: performance.now() };
    ctl.send({ type: "pick", i: next });
    render();
    setTimeout(render, 1600); // if the TV refused it, the outline goes back
  }

  // ------------------------------------------------------------------ the panel
  const status = (h: string, small = "") => `<p class="spp-status">${h}${small ? `<small>${small}</small>` : ""}</p>`;
  const btn = (act: string, text: string, cls = "") => `<button class="spp-btn ${cls}" data-act="${act}">${esc(text)}</button>`;

  function sceneFor(s: SpyShared, o: SpyOwn): Scene {
    const me = s.seats[meIndex(s)];
    const T = (t: Team) => TEAM_NAME[t];
    const handlerOf = (t: Team) => s.seats.find((x) => x.team === t && x.role === "handler")?.name ?? "";
    const mine = o.team === s.turn;
    const at = `${s.phase}:${s.round}:${s.turn}:${o.role}:${o.team}`;
    switch (s.phase) {
      case "brief":
        return o.role === "handler"
          ? { key: at, html: status("You're the handler", "Only you can see the key. Give your team one-word clues.") }
          : { key: at + handlerOf(o.team!), html: status("You're an agent", `${esc(handlerOf(o.team!))} gives your clues. Talk it over with your team.`) };
      case "clue":
        if (mine && o.role === "handler") {
          return {
            key: `form:${s.round}:${s.turn}:${s.cards.filter((c) => c.revealed).length}`,
            form: true,
            html: `${status("Your turn: give a clue")}
              <div class="spp-form">
                <input class="spp-input" type="text" maxlength="18" placeholder="One word" enterkeyhint="send"
                  autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-label="Clue word" />
                <div class="spp-row">
                  <button class="spp-step" data-step="-1" aria-label="Fewer">−</button>
                  <span class="spp-num"></span>
                  <button class="spp-step" data-step="1" aria-label="More">+</button>
                  <button class="spp-btn primary" data-act="send">Send clue</button>
                </div>
                <p class="spp-err"></p>
              </div>`,
          };
        }
        if (mine) return { key: at, html: status(`${esc(handlerOf(s.turn))} is thinking of a clue`, "Get ready to talk it over.") };
        return { key: at, html: status(`${T(s.turn)} is waiting for a clue`, "Their handler is thinking.") };
      case "guess":
        if (mine && o.role === "agent") {
          return {
            key: at,
            html: status("Tap a card to pick it", `${s.need} ${s.need === 1 ? "pick reveals" : "picks reveal"} a card. Tap again to take it back.`) +
              `<div class="spp-actions">${btn("stop", "Stop guessing")}</div>`,
          };
        }
        if (mine) return { key: at, html: status("Your agents are guessing", "Keep a straight face.") };
        return { key: at, html: status(`${T(s.turn)} is guessing`, "Watch the TV.") };
      case "reveal": {
        const l = s.last;
        if (!l) return { key: at, html: status("Revealing…") };
        const word = esc(s.cards[l.idx]?.word.toUpperCase() ?? "");
        const good = l.owner === l.team;
        return {
          key: `${at}:${l.idx}`,
          html: status(`${word} is ${OWNER_LINE[l.owner]}`, good ? (mine ? "Nice." : `Good for ${T(l.team)}.`) : l.owner === "burn" ? `${T(l.team)} loses the round.` : `${T(l.team)}'s turn is over.`),
        };
      }
      case "round": {
        const won = s.winner === o.team;
        return { key: at, html: status(won ? "You take the round" : `${T(s.winner!)} takes the round`, s.why === "burn" ? `${T(s.winner === "cobalt" ? "saffron" : "cobalt")} touched the burn card.` : "Every card found.") };
      }
      case "match": {
        const won = s.matchWinner === o.team;
        const vip = ctx.isVip();
        const sh = ctx.shell();
        const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
        return {
          key: `match:${s.matchWinner}:${vip}:${decider}`,
          html:
            status(won ? "Your team wins the match" : `${T(s.matchWinner!)} wins the match`, `${s.wins.cobalt}–${s.wins.saffron}`) +
            (vip
              ? `<div class="spp-actions">${btn("again", "Play again", "primary")}${btn("lobby", "Back to lobby")}</div>`
              : `<p class="spp-status"><small>${esc(decider ?? "The host")} picks what's next.</small></p>`),
        };
      }
    }
    return { key: at + (me?.name ?? ""), html: "" };
  }

  function wire() {
    panelOffs.forEach((f) => f());
    panelOffs = [];
    for (const el of panel.querySelectorAll<HTMLElement>("[data-act]")) {
      const a = el.dataset.act!;
      // Send fires on press: the text field keeps its focus (and the keyboard stays) until the clue is taken
      panelOffs.push(button(el, { mode: a === "send" ? "press" : "tap", haptic: feel(a, 14), onPress: () => !(el as HTMLButtonElement).disabled && act(a) }));
    }
    for (const el of panel.querySelectorAll<HTMLElement>("[data-step]")) {
      panelOffs.push(
        button(el, {
          mode: "press",
          haptic: 8,
          onPress: () => {
            num = Math.max(1, Math.min(9, num + Number(el.dataset.step)));
            refresh();
          },
        }),
      );
    }
    const input = panel.querySelector<HTMLInputElement>(".spp-input");
    if (input) {
      input.value = draft;
      const onInput = () => {
        // letters as you type; spaces stay so "One word only" can show; digits and symbols are dropped with a hint
        const typed = input.value;
        const letters = typed.replace(/[^A-Za-z ]/g, "");
        const clean = letters.replace(/^ +/, "").replace(/ {2,}/g, " ").slice(0, 18);
        if (clean !== typed) input.value = clean;
        draft = clean;
        localErr = letters.length < typed.length ? "Letters only, please" : /\S +\S/.test(clean) ? "One word only" : "";
        refresh();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          act("send");
        }
      };
      const onFocus = () => root.classList.add("typing");
      const onBlur = () => root.classList.remove("typing");
      input.addEventListener("input", onInput);
      input.addEventListener("keydown", onKey);
      input.addEventListener("focus", onFocus);
      input.addEventListener("blur", onBlur);
      panelOffs.push(() => {
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKey);
        input.removeEventListener("focus", onFocus);
        input.removeEventListener("blur", onBlur);
        root.classList.remove("typing");
      });
    }
  }

  function act(a: string) {
    const s = ctl.shared;
    switch (a) {
      case "send": {
        if (!s || sending) return;
        const err = checkClue(draft, s.cards.map((c) => c.word));
        if (err) {
          localErr = err;
          buzz("bad");
          refresh();
          return;
        }
        sending = true;
        localErr = "";
        ctl.send({ type: "clue", word: draft.trim(), n: num });
        break;
      }
      case "stop": {
        if (!s) return;
        const next = myPick(s) === STOP ? null : STOP;
        optimistic = { i: next, at: performance.now() };
        ctl.send({ type: "pick", i: next });
        break;
      }
      case "again":
        ctl.send({ type: "again" });
        break;
      case "lobby":
        ctx.exitToLobby();
        return;
    }
    render();
  }

  /** Updates the panel in place (no rebuild): the number, errors, the Send and Stop buttons. */
  function refresh() {
    const s = ctl.shared;
    const o = ctl.own;
    const numEl = panel.querySelector(".spp-num");
    if (numEl) numEl.textContent = String(num);
    if (o && o.errorNo !== seenErr) {
      seenErr = o.errorNo;
      if (o.error) {
        sending = false;
        localErr = o.error;
        buzz("bad");
      }
    }
    const errEl = panel.querySelector(".spp-err");
    if (errEl) errEl.textContent = localErr;
    const send = panel.querySelector<HTMLButtonElement>('[data-act="send"]');
    if (send) {
      send.disabled = sending || !draft;
      send.textContent = sending ? "Sending…" : "Send clue";
    }
    const stop = panel.querySelector<HTMLButtonElement>('[data-act="stop"]');
    if (stop && s) {
      const me = meIndex(s);
      const mine = myPick(s) === STOP;
      stop.disabled = s.guesses < 1;
      stop.classList.toggle("on", mine);
      const others = s.stop.filter((x) => x !== me).length + (mine ? 1 : 0);
      stop.textContent = s.guesses < 1 ? "Stop guessing (after one card)" : others ? `Stop guessing · ${others}/${s.need}` : "Stop guessing";
    }
  }

  // ------------------------------------------------------------------ drawing
  let lastClue = "";
  function drawClue(s: SpyShared) {
    const c = s.phase === "guess" || s.phase === "reveal" ? s.clue : null;
    const left = Math.max(0, s.maxGuesses - s.guesses);
    const k = c ? `${c.word}:${c.n}:${c.team}:${left}` : "";
    if (k === lastClue) return;
    lastClue = k;
    clueEl.hidden = !c;
    if (!c) return;
    clueEl.style.setProperty("--tc", TEAM_COLOR[c.team]);
    clueEl.innerHTML = `<small>${TEAM_NAME[c.team]}<br>clue</small><b>${esc(c.word)}</b><span class="n">${c.n}</span><span class="left">${left} ${left === 1 ? "guess" : "guesses"}<br>left</span>`;
  }

  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    $(".spp-name").textContent = ctl.me?.name ?? "";
    const chip = $(".spp-chip");
    if (o?.team) {
      root.style.setProperty("--c", TEAM_COLOR[o.team]);
      root.style.setProperty("--on-c", ON_TEAM[o.team]);
      chip.textContent = `${TEAM_NAME[o.team]} · ${o.role === "handler" ? "Handler" : "Agent"}`;
    } else {
      root.style.removeProperty("--c");
      chip.textContent = o?.role === "watch" ? "Watching" : "";
    }

    let next: Scene;
    if (!s || !s.cards.length) next = { key: "wait", html: status("Joining…") };
    else if (!o) next = { key: "wait2", html: status("Taking a seat…") };
    else if (o.role === "watch") next = { key: "watch", html: status("You're watching", "Every seat is taken. You get one when someone leaves.") };
    else next = sceneFor(s, o);

    if (s && s.cards.length) {
      drawGrid(s, o);
      drawClue(s);
    }
    if (next.key !== scene?.key) {
      const wasForm = !!scene?.form;
      scene = next;
      if (!next.form && wasForm) {
        sending = false;
        if (s?.phase !== "clue") draft = "";
        localErr = "";
      }
      panel.innerHTML = next.html;
      wire();
    }
    refresh();
  }

  // the clock: the TV sends what's left when the beat starts, the phone counts down
  let deadline = 0;
  let clockFor: unknown = null;
  const clockEl = $(".spp-clock");
  const drawClock = () => {
    const s = ctl.shared;
    const on = !!s && deadline > 0 && (s.phase === "clue" || s.phase === "guess");
    clockEl.hidden = !on;
    if (!on) return;
    const sec = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    clockEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    clockEl.classList.toggle("low", sec <= 10);
  };
  const clockTimer = setInterval(drawClock, 500);
  offs.push(() => clearInterval(clockTimer));

  offs.push(
    ctl.on("state", () => {
      if (ctl.shared !== clockFor) {
        clockFor = ctl.shared;
        deadline = ctl.shared && ctl.shared.left > 0 ? performance.now() + ctl.shared.left : 0;
        drawClock();
      }
      // the TV has answered: drop the guess we were showing
      if (optimistic && ctl.shared) {
        const s = ctl.shared;
        const me = meIndex(s);
        const card = s.cards.findIndex((c) => c.picks.includes(me));
        const now = s.stop.includes(me) ? STOP : card >= 0 ? card : null;
        if (now === optimistic.i || s.phase !== "guess") optimistic = null;
      }
      render();
    }),
    ctx.onVip(() => {
      scene = null;
      render();
    }),
    ctl.on("message", (d) => {
      if (d && typeof d === "object" && d.type === "buzz") buzz(d.kind);
    }),
  );
  render();

  return () => {
    offs.forEach((f) => f());
    panelOffs.forEach((f) => f());
    cellOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
