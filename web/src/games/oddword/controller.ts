// The phone, built the conventional way (docs/notes.md): your word on a face-down card in the middle (hold it to
// turn it over), and a panel at the bottom with what's happening and, when it's your move, one clear button.
// Voting: tap a name, then confirm. Everything public is on the TV.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { loadFonts } from "./font.ts";
import { esc, LOOK, mug, REVEAL_SETTLE_MS } from "./look.ts";
import type { OddGame, OddOwn, OddShared } from "./shared.ts";
import "./oddword.css";

interface Scene {
  key: string;
  html: string;
  /** A long list: the panel takes the whole screen (the card hides). */
  tall?: boolean;
  /** A vote: the panel's main button confirms the tapped name. */
  pick?: { options: string[]; label: (i: number) => string };
}

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<OddGame>;
  void loadFonts();
  const pad = gameById("oddword")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const feel = (id: string) => pad.buttons.find((b) => b.id === id)?.haptic ?? pad.choices.find((c) => c.id === id)?.haptic ?? 12;

  const root = document.createElement("div");
  root.className = "op";
  root.innerHTML = `
    <header class="op-head"><span class="op-me"></span><span class="op-name"></span><span class="op-chip"></span></header>
    <section class="op-stage">
      <div class="op-card" aria-label="Hold to see your word">
        <div class="op-card-in">
          <div class="op-face op-back"><span>?</span></div>
          <div class="op-face op-front"></div>
        </div>
      </div>
      <p class="op-hint">Hold the card to see your word</p>
    </section>
    <section class="op-panel" data-scroll></section>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const card = $(".op-card");
  const panel = $(".op-panel");

  const offs: Array<() => void> = [];
  let panelOffs: Array<() => void> = [];
  offs.push(
    button(card, {
      haptic: feel("word"),
      onPress: () => card.classList.add("open"),
      onRelease: () => card.classList.remove("open"),
    }),
  );

  let scene: Scene | null = null;
  let selected: number | null = null;
  let sentKey = "";
  let sentTimer: ReturnType<typeof setTimeout> | undefined;
  const revealAt = { round: -1, t: 0 };
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  const title = (h: string, p = "") => `<div class="op-title"><h2>${h}</h2>${p ? `<p>${p}</p>` : ""}</div>`;
  const btn = (act: string, text: string, cls = "primary") => `<button class="op-btn ${cls}" data-act="${act}" data-text="${esc(text)}">${esc(text)}</button>`;
  const actions = (...b: string[]) => `<div class="op-actions">${b.join("")}</div>`;
  const nameOf = (s: OddShared, id: string | null) => s.seats.find((x) => x.id === id)?.name ?? "someone";

  function sceneFor(s: OddShared, o: OddOwn): Scene {
    const at = `${s.phase}:${s.round}`;
    if (!o.playing) return { key: `watch:${s.round}`, html: title("You're in next round", "Watch this one on the TV.") };
    switch (s.phase) {
      case "describe":
        if (o.done) return { key: `${at}:done`, html: title("Done", "Waiting for the others…") };
        return {
          key: at,
          html:
            title(s.mode === "jobs" ? "Say what happens in this job" : "Say one adjective", "Hold the card to see it. Go when the TV says it's your turn.") +
            actions(btn("done", pad.buttons.find((b) => b.id === "done")?.label ?? "Done")),
        };
      case "vote": {
        if (o.vote) return { key: `${at}:voted`, html: title("Vote sent", `You voted for <b>${esc(nameOf(s, o.vote))}</b>.`) };
        if (!o.targets.length) return { key: `${at}:none`, html: title("Nobody to vote for", "Waiting for the others…") };
        const rows = o.targets
          .map((id, k) => {
            const x = s.seats.find((y) => y.id === id);
            return `<button class="op-row" data-pick="${k}"><span class="op-av">${x ? mug(x.color, x.shape) : ""}</span><span class="op-row-name">${esc(x?.name ?? "?")}</span><span class="op-radio"></span></button>`;
          })
          .join("");
        return {
          key: `${at}:${o.targets.join()}`,
          tall: o.targets.length > 3,
          html: title("Who has the odd word?", "Tap a name, then confirm.") + `<div class="op-list">${rows}</div>` + actions(btn("confirm", "Choose someone")),
          pick: { options: o.targets, label: (k) => `Vote out ${nameOf(s, o.targets[k]!)}` },
        };
      }
      case "reveal": {
        const r = s.reveal;
        if (!r) return { key: at, html: "" };
        const me = ctl.me?.id;
        const wasOdd = r.impostor === me;
        const head = r.left ? "The odd one left" : wasOdd ? (r.caught ? "You were caught" : "You got away") : r.caught ? "Caught!" : "They got away";
        const vip = ctx.isVip();
        // the TV shows the result first: the phone waits until its cards are down
        if (revealAt.round !== s.round) {
          revealAt.round = s.round;
          revealAt.t = Date.now();
          clearTimeout(revealTimer);
          revealTimer = setTimeout(render, REVEAL_SETTLE_MS + 50);
        }
        if (Date.now() - revealAt.t < REVEAL_SETTLE_MS) return { key: `${at}:wait`, html: title("Look at the TV", "Here comes the answer…") };
        return {
          key: `${at}:${vip}`,
          html:
            title(head, `The word was <b>${esc(r.word)}</b>. The odd one was <b>${esc(nameOf(s, r.impostor))}</b>.`) +
            (vip ? actions(btn("next", pad.buttons.find((b) => b.id === "next")?.label ?? "Next round", "ghost")) : `<p class="op-note">The next round starts by itself.</p>`),
        };
      }
    }
    return { key: at, html: "" };
  }

  function act(name: string) {
    if (name === "done") ctl.send({ type: "done" });
    else if (name === "next") ctl.send({ type: "next" });
    else if (name === "confirm") {
      if (!scene?.pick || selected === null) return;
      ctl.send({ type: "vote", target: scene.pick.options[selected]! });
    }
    sentKey = scene?.key ?? "";
    // a move the TV never got must not leave the panel stuck: after a while the buttons work again
    const k = sentKey;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => {
      if (sentKey === k && scene?.key === k) {
        sentKey = "";
        refresh();
      }
    }, 5000);
    refresh();
  }

  function wire() {
    panelOffs.forEach((f) => f());
    panelOffs = [];
    for (const el of panel.querySelectorAll<HTMLElement>("[data-pick]")) {
      panelOffs.push(
        button(el, {
          mode: "tap",
          haptic: feel("vote"),
          onPress: () => {
            if (sentKey === scene?.key) return;
            selected = Number(el.dataset.pick);
            refresh();
          },
        }),
      );
    }
    for (const el of panel.querySelectorAll<HTMLElement>("[data-act]")) {
      const a = el.dataset.act!;
      panelOffs.push(button(el, { mode: "tap", haptic: feel(a === "confirm" ? "vote" : a), onPress: () => !(el as HTMLButtonElement).disabled && act(a) }));
    }
  }

  function refresh() {
    const sent = !!scene && sentKey === scene.key;
    panel.querySelectorAll<HTMLElement>("[data-pick]").forEach((el) => el.classList.toggle("on", Number(el.dataset.pick) === selected));
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-act]")) {
      if (b.dataset.act === "confirm") {
        b.disabled = selected === null || sent;
        b.textContent = sent ? "Sent" : selected !== null && scene?.pick ? scene.pick.label(selected) : b.dataset.text!;
      } else b.disabled = sent;
    }
  }

  let cardKey = "";
  function drawCard(s: OddShared, o: OddOwn) {
    const key = `${o.round}:${o.playing}:${o.word}:${o.odd}:${s.mode}`;
    if (key === cardKey) return;
    cardKey = key;
    card.classList.remove("open");
    const front = $(".op-front");
    if (!o.playing) front.innerHTML = `<small>Next round</small><p>You get a word when the next round starts.</p>`;
    else if (o.odd) front.innerHTML = `<small>No word for you</small><h3 class="odd">You're the odd one out</h3><p>Listen to the others and blend in.</p>`;
    else front.innerHTML = `<small>${s.mode === "jobs" ? "Your job" : "Your word"}</small><h3>${esc(o.word)}</h3>`;
  }

  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    $(".op-name").textContent = ctl.me?.name ?? "";
    root.dataset.phase = s?.phase ?? "describe";
    root.style.setProperty("--stage", LOOK.stage[s?.phase ?? "describe"]);
    let next: Scene;
    if (!s || !o) next = { key: "wait", html: title("Getting ready…") };
    else next = sceneFor(s, o);
    root.classList.toggle("has-word", !!o?.playing);
    if (o) {
      $(".op-me").innerHTML = mug(o.color, o.shape, "idle");
      $(".op-chip").textContent = s ? `Round ${s.round}` : "";
      if (s) drawCard(s, o);
    }
    if (next.key !== scene?.key) {
      const fresh = !scene || next.html !== scene.html;
      scene = next;
      selected = null;
      root.classList.toggle("tall", !!next.tall);
      sentKey = "";
      if (fresh) {
        panel.innerHTML = next.html;
        panel.classList.remove("swap");
        void panel.offsetWidth;
        panel.classList.add("swap");
        wire();
      }
    }
    refresh();
  }

  offs.push(
    ctl.on("state", render),
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
    clearTimeout(sentTimer);
    clearTimeout(revealTimer);
    offs.forEach((f) => f());
    panelOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
