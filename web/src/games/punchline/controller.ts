// The phone, built the conventional way: a status line on top, and a panel at the bottom with the action.
// Writing: the prompt, a text box and a big Send button that stays above the keyboard; after Send, "Sent" and the
// second prompt. Voting: the answers as big buttons. Everything on the phone comes from the sticky shared / own
// state, so a phone that reloads lands on the right screen, and it moves on whenever the TV does.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { PunchGame, PunchOwn, PunchShared, PunchTask } from "./shared.ts";
import "./punchline.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MAX = 60;
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<PunchGame>;
  const pad = gameById("punchline")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const sendHaptic = pad.buttons.find((b) => b.id === "send")?.haptic ?? 16;
  const voteHaptic = pad.choices.find((c) => c.id === "vote")?.haptic ?? 14;

  const root = document.createElement("div");
  root.className = "plp";
  root.innerHTML = `
    <header class="plp-head"><span class="plp-dot"></span><span class="plp-name"></span><span class="plp-chip"></span></header>
    <section class="plp-body"></section>`;
  ctx.root.appendChild(root);
  const body = root.querySelector(".plp-body") as HTMLElement;
  const $ = <T extends HTMLElement>(sel: string) => body.querySelector(sel) as T;

  let sceneKey = "";
  let sceneOffs: Array<() => void> = [];
  const offs: Array<() => void> = [];

  const info = (h: string, p = "", extra = "") =>
    `<div class="plp-info"><h2>${h}</h2>${p ? `<p>${p}</p>` : ""}</div>${extra}`;

  function setScene(key: string, html: string, wire?: () => void) {
    if (key === sceneKey) return false;
    sceneKey = key;
    sceneOffs.forEach((f) => f());
    sceneOffs = [];
    body.innerHTML = html;
    body.classList.remove("swap");
    void body.offsetWidth;
    body.classList.add("swap");
    wire?.();
    return true;
  }

  // ------------------------------------------------------------------ writing
  const drafts = new Map<string, string>();
  let shownTask = "";
  let pending = "";
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function writeScene(tasks: PunchTask[]) {
    const fresh = setScene(
      `write:${tasks.map((t) => t.key).join()}`,
      `<div class="plp-write">
        <div class="plp-prompt" data-scroll><small class="plp-step"></small><p class="plp-q"></p><div class="plp-toast" hidden>Sent</div></div>
        <div class="plp-panel plp-entry">
          <textarea class="plp-text" rows="2" maxlength="${MAX}" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" spellcheck="true" placeholder="Your answer"></textarea>
          <div class="plp-meta"><span class="plp-hint"></span><span class="plp-count"></span></div>
          <button class="plp-btn primary plp-send">Send</button>
        </div>
        <div class="plp-panel plp-done" hidden><h2>Sent</h2><p>Your answers are in. Watch the TV.</p></div>
      </div>`,
      () => {
        shownTask = "";
        const ta = $<HTMLTextAreaElement>(".plp-text");
        ta.addEventListener("input", () => {
          // no line breaks; keep the count honest
          if (ta.value.includes("\n")) ta.value = ta.value.replace(/\n+/g, " ");
          drafts.set(shownTask, ta.value);
          count();
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            send();
          }
        });
        // press mode: fires on touch-down and keeps the focus (and the keyboard) on the text box
        sceneOffs.push(button($(".plp-send"), { haptic: sendHaptic, onPress: send }));
      },
    );
    const cur = tasks.find((t) => !t.sent);
    const entry = $(".plp-entry");
    const done = $(".plp-done");
    const ta = $<HTMLTextAreaElement>(".plp-text");
    if (!cur) {
      if (!entry.hidden) {
        entry.hidden = true;
        done.hidden = false;
        $(".plp-prompt").hidden = true;
        ta.blur();
      }
      return;
    }
    if (cur.key !== shownTask) {
      const wasFocused = document.activeElement === ta;
      const after = !fresh && shownTask !== "";
      shownTask = cur.key;
      const n = tasks.indexOf(cur);
      $(".plp-step").textContent = tasks.length > 1 ? `Prompt ${n + 1} of ${tasks.length}` : "Everyone gets this one";
      $(".plp-q").textContent = cur.prompt;
      ta.value = drafts.get(cur.key) ?? "";
      if (after) toast();
      if (wasFocused) ta.focus();
      count();
    }
    const sending = pending === cur.key;
    const btn = $<HTMLButtonElement>(".plp-send");
    btn.disabled = sending;
    btn.textContent = sending ? "Sending…" : "Send";
  }

  function count() {
    const ta = body.querySelector<HTMLTextAreaElement>(".plp-text");
    if (!ta) return;
    const n = Array.from(ta.value).length;
    $(".plp-count").textContent = `${n} / ${MAX}`;
    $(".plp-count").classList.toggle("near", n >= MAX - 10);
    $(".plp-hint").textContent = "";
  }

  function toast() {
    const t = $(".plp-toast");
    t.hidden = false;
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      const el = body.querySelector<HTMLElement>(".plp-toast");
      if (el) el.hidden = true;
    }, 1400);
  }

  function send() {
    const ta = body.querySelector<HTMLTextAreaElement>(".plp-text");
    if (!ta || !shownTask || pending === shownTask) return;
    const text = ta.value.replace(/\s+/g, " ").trim();
    if (!text) {
      $(".plp-hint").textContent = "Type something first";
      ta.focus();
      return;
    }
    if (!ctl.send({ type: "answer", key: shownTask, text: Array.from(text).slice(0, MAX).join("") })) return;
    pending = shownTask;
    // if the TV never confirms (a dropped message), let them try again
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pending = "";
      render();
    }, 4000);
    render();
  }

  // ------------------------------------------------------------------ voting
  let picked: number | null = null;

  function pairVote(s: PunchShared, own: PunchOwn) {
    const v = own.vote!;
    if (v.author) {
      setScene(`vote:${v.key}:mine`, info("That's yours up there", "No voting on your own. Fingers crossed."));
      return;
    }
    const vote = s.vote!;
    setScene(
      `vote:${v.key}`,
      `<div class="plp-prompt" data-scroll><small class="plp-step">Which is funnier?</small><p class="plp-q small">${esc(vote.prompt)}</p></div>
       <div class="plp-panel plp-votes">${vote.answers
         .map((a, i) => `<button class="plp-ans" data-pick="${i}"><span>${esc(a)}</span><em>Your vote</em></button>`)
         .join("")}</div>`,
      () => {
        for (const el of body.querySelectorAll<HTMLElement>("[data-pick]")) {
          sceneOffs.push(
            button(el, {
              mode: "tap",
              haptic: voteHaptic,
              onPress: () => {
                const cur = ctl.own?.vote;
                if (cur && cur.key === v.key) ctl.send({ type: "vote", key: v.key, pick: Number(el.dataset.pick) });
              },
            }),
          );
        }
      },
    );
    for (const el of body.querySelectorAll<HTMLElement>("[data-pick]")) {
      const on = v.mine === Number(el.dataset.pick);
      el.classList.toggle("on", on);
      el.classList.toggle("dim", v.mine !== null && !on);
    }
  }

  function finalVote(s: PunchShared, own: PunchOwn) {
    const v = own.vote!;
    const vote = s.vote!;
    if (!v.options.length) {
      setScene(`final:${v.key}:none`, info("Nothing to vote on", "Watch the TV."));
      return;
    }
    if (
      setScene(
        `final:${v.key}`,
        `<div class="plp-final">
          <div class="plp-prompt"><small class="plp-step">Pick your favourite</small><p class="plp-q small">${esc(vote.prompt)}</p></div>
          <div class="plp-list" data-scroll>${v.options
            .map((i) => `<button class="plp-ans small" data-pick="${i}"><span>${esc(vote.answers[i] ?? "")}</span><em>Your vote</em></button>`)
            .join("")}</div>
          <div class="plp-panel"><button class="plp-btn primary plp-confirm">Tap an answer</button></div>
        </div>`,
        () => {
          for (const el of body.querySelectorAll<HTMLElement>("[data-pick]")) {
            sceneOffs.push(
              button(el, {
                mode: "tap",
                haptic: voteHaptic,
                onPress: () => {
                  picked = Number(el.dataset.pick);
                  render();
                },
              }),
            );
          }
          sceneOffs.push(
            button($(".plp-confirm"), {
              mode: "tap",
              haptic: sendHaptic,
              onPress: () => {
                const cur = ctl.own?.vote;
                if (picked === null || !cur || cur.key !== v.key) return;
                ctl.send({ type: "vote", key: v.key, pick: picked });
              },
            }),
          );
        },
      )
    )
      picked = v.mine;
    for (const el of body.querySelectorAll<HTMLElement>("[data-pick]")) {
      const i = Number(el.dataset.pick);
      el.classList.toggle("sel", picked === i && v.mine !== i);
      el.classList.toggle("on", v.mine === i);
    }
    const btn = $<HTMLButtonElement>(".plp-confirm");
    btn.disabled = picked === null || picked === v.mine;
    btn.textContent = picked === null ? "Tap an answer" : picked === v.mine ? "Voted" : v.mine === null ? "Vote for this one" : "Change my vote";
  }

  // ------------------------------------------------------------------ the rest
  function endScene(s: PunchShared, own: PunchOwn | null) {
    const vip = ctx.isVip();
    const sh = ctx.shell();
    const decider = sh?.players.find((p) => p.id === sh.vip)?.name ?? "The host";
    const me = own?.name;
    const won = !!me && s.winners.includes(me);
    const head = won ? (s.winners.length > 1 ? "You share the win" : "You win!") : s.winners.length ? `${esc(s.winners.join(" & "))} wins` : "Show's over";
    const sub = own?.place && !won ? `You came ${ord(own.place)}.` : won ? "Best set of the night." : "";
    setScene(
      `end:${s.winners.join()}:${own?.place}:${vip}:${decider}`,
      `${info(head, sub)}${
        vip
          ? `<div class="plp-panel plp-actions"><button class="plp-btn primary" data-act="again">Play again</button><button class="plp-btn ghost" data-act="lobby">Back to the lobby</button></div>`
          : `<div class="plp-panel"><p class="plp-note"><b>${esc(decider)}</b> picks what's next.</p></div>`
      }`,
      () => {
        for (const el of body.querySelectorAll<HTMLElement>("[data-act]")) {
          sceneOffs.push(
            button(el, {
              mode: "tap",
              onPress: () => (el.dataset.act === "again" ? ctl.send({ type: "again" }) : ctx.exitToLobby()),
            }),
          );
        }
      },
    );
  }

  function render() {
    const s = ctl.shared;
    const own = ctl.own;
    root.style.setProperty("--c", own?.color ?? "#9aa3ad");
    (root.querySelector(".plp-name") as HTMLElement).textContent = own?.name ?? ctl.me?.name ?? "";
    const chip = root.querySelector(".plp-chip") as HTMLElement;
    chip.textContent = !s || s.phase === "wait" || s.phase === "end" ? "" : s.final ? "Last laugh" : s.round === 1 ? "Round 2 · double" : "Round 1";

    // the pending send is settled once the TV says so, or the scene moves on
    if (pending && !own?.tasks.some((t) => t.key === pending && !t.sent)) {
      pending = "";
      if (pendingTimer) clearTimeout(pendingTimer);
    }
    root.classList.toggle("writing", s?.phase === "write" && !!own?.tasks.length);

    if (!s || !own) return void setScene("join", info("Taking your seat…"));
    if (s.phase === "end") return endScene(s, own);
    if (own.state === "watch") return void setScene("watch", info("All seats are taken", "Watch this round. You're in when a seat frees up."));
    switch (s.phase) {
      case "wait":
        return void setScene("wait", info("Waiting for players", "Three or more to start."));
      case "intro":
        return void setScene(
          `intro:${s.round}`,
          info(s.final ? "The last laugh" : `Round ${s.round + 1}`, s.final ? "One prompt. Everyone answers it." : s.round === 1 ? "Points count double." : "Two prompts each. Be funny."),
        );
      case "write":
        if (own.state === "next" || !own.tasks.length) return void setScene("next", info("You're in next round", "You can vote on the answers in a moment."));
        return writeScene(own.tasks);
      case "vote":
        if (!own.vote || !s.vote) return void setScene("vote-watch", info("Eyes on the TV"));
        return s.final ? finalVote(s, own) : pairVote(s, own);
      case "reveal":
        return void setScene(`reveal`, info("Votes are in", "Watch the TV."));
      case "scores":
        return void setScene(`scores:${s.round}`, info("Standings", "On the TV."));
    }
  }

  offs.push(
    ctl.on("state", render),
    ctx.onVip(() => {
      sceneKey = "";
      render();
    }),
    ctl.on("message", (m) => {
      if (m && typeof m === "object" && m.type === "buzz") buzz(m.kind);
    }),
  );
  render();

  return () => {
    if (pendingTimer) clearTimeout(pendingTimer);
    if (toastTimer) clearTimeout(toastTimer);
    offs.forEach((f) => f());
    sceneOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
