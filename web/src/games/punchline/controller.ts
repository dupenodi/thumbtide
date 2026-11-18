// The phone, built the conventional way: a status line on top, and a panel at the bottom with the action.
// Writing: the round's prompt, a text box and a big Send button that stays above the keyboard; after Send the phone
// says "Sent, waiting for the others" and the answer can be changed until time is up. Voting: every answer except
// your own as a big card; tap one, then confirm. Everything on the phone comes from the sticky shared / own state,
// so a phone that reloads lands on the right screen, and it moves on whenever the TV does.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { PunchGame, PunchOwn, PunchShared } from "./shared.ts";
import "./punchline.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MAX = 80;
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const promptHtml = (t: string) => esc(t).replace(/_{3,}([^ ]*)/g, `<span class="pl-nb"><span class="plp-blank"></span>$1</span>`);

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

  function writeScene(s: PunchShared, task: NonNullable<PunchOwn["task"]>) {
    setScene(
      `write:${task.key}`,
      `<div class="plp-write">
        <div class="plp-prompt" data-scroll><small class="plp-step"></small><p class="plp-q"></p></div>
        <div class="plp-panel plp-entry">
          <div class="plp-status"></div>
          <textarea class="plp-text" rows="2" maxlength="${MAX}" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" spellcheck="true" placeholder="Your answer"></textarea>
          <div class="plp-meta"><span class="plp-hint"></span><span class="plp-count"></span></div>
          <button class="plp-btn primary plp-send">Send</button>
        </div>
      </div>`,
      () => {
        shownTask = "";
        const ta = $<HTMLTextAreaElement>(".plp-text");
        ta.addEventListener("input", () => {
          // no line breaks; keep the count honest
          if (ta.value.includes("\n")) ta.value = ta.value.replace(/\n+/g, " ");
          drafts.set(shownTask, ta.value);
          count();
          render();
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
    const ta = $<HTMLTextAreaElement>(".plp-text");
    if (task.key !== shownTask) {
      shownTask = task.key;
      $(".plp-step").textContent = `Round ${s.round + 1} of ${s.rounds} · everyone gets this one`;
      ta.value = drafts.get(task.key) ?? task.text ?? "";
      count();
    }
    $(".plp-q").innerHTML = promptHtml(s.prompt);
    // what the TV has: sent (and what it holds), or not yet
    const clean = ta.value.replace(/\s+/g, " ").trim();
    const sent = task.text !== null;
    const same = sent && clean === task.text;
    const sending = pending === task.key;
    const status = $(".plp-status");
    status.classList.toggle("ok", sent);
    status.textContent = sent ? "Sent — waiting for the others. You can still change it." : "Type your answer, then send.";
    const btn = $<HTMLButtonElement>(".plp-send");
    btn.disabled = sending || same;
    btn.textContent = sending ? "Sending…" : same ? "Sent" : sent ? "Update my answer" : "Send";
  }

  function count() {
    const ta = body.querySelector<HTMLTextAreaElement>(".plp-text");
    if (!ta) return;
    const n = Array.from(ta.value).length;
    $(".plp-count").textContent = `${n} / ${MAX}`;
    $(".plp-count").classList.toggle("near", n >= MAX - 10);
    $(".plp-hint").textContent = "";
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

  function voteScene(s: PunchShared, own: PunchOwn) {
    const v = own.vote!;
    if (!v.options.length) {
      setScene(`vote:${v.key}:none`, info("Nothing to vote on", "Watch the TV."));
      return;
    }
    if (
      setScene(
        `vote:${v.key}`,
        `<div class="plp-final">
          <div class="plp-prompt"><small class="plp-step">Pick your favourite</small><p class="plp-q small">${promptHtml(s.prompt)}</p></div>
          <div class="plp-list" data-scroll>${v.options
            .map((i) => `<button class="plp-ans" data-pick="${i}"><span>${esc(s.answers[i] ?? "")}</span><em>Your vote</em></button>`)
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
    btn.textContent = picked === null ? "Tap an answer" : picked === v.mine ? "Voted. Waiting for the others" : v.mine === null ? "Vote for this one" : "Change my vote";
  }

  // ------------------------------------------------------------------ the rest
  function endScene(s: PunchShared, own: PunchOwn | null) {
    const vip = ctx.isVip();
    const sh = ctx.shell();
    const decider = sh?.players.find((p) => p.id === sh.vip)?.name ?? "The host";
    const me = own?.name;
    const won = !!me && s.winners.includes(me);
    const late = !!own && own.state !== "watch" && !own.played;
    const head = late ? "Joined late" : won ? (s.winners.length > 1 ? "You share the win" : "You win!") : s.winners.length ? `${esc(s.winners.join(" & "))} wins` : "Show's over";
    const sub = late ? "You're in from the next match." : own?.place && !won ? `You came ${ord(own.place)}.` : won ? "Best set of the night." : "";
    setScene(
      `end:${s.winners.join()}:${own?.place}:${late}:${vip}:${decider}`,
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
    chip.textContent = !s || s.phase === "wait" || s.phase === "end" ? "" : `Round ${s.round + 1} of ${s.rounds}`;

    // the pending send is settled once the TV holds an answer, or the scene moves on
    if (pending && own?.task?.key === pending && own.task.text !== null) {
      pending = "";
      if (pendingTimer) clearTimeout(pendingTimer);
    } else if (pending && own?.task?.key !== pending) {
      pending = "";
      if (pendingTimer) clearTimeout(pendingTimer);
    }
    root.classList.toggle("writing", s?.phase === "write" && !!own?.task);

    if (!s || !own) return void setScene("join", info("Taking your seat…"));
    if (s.phase === "end") return endScene(s, own);
    if (own.state === "watch") return void setScene("watch", info("All seats are taken", "Watch this round. You're in when a seat frees up."));
    switch (s.phase) {
      case "wait":
        return void setScene("wait", info("Waiting for players", "Three or more to start."));
      case "intro":
        return void setScene(`intro:${s.key}`, info(`Round ${s.round + 1} of ${s.rounds}`, "One prompt for everyone. Be funny."));
      case "write":
        if (own.state === "next") return void setScene("next", info("You're in next round", "You can vote on the answers in a moment."));
        // shared and own arrive apart: until this round's task is here, keep what is on screen
        if (!own.task || own.task.key !== s.key) return void (sceneKey || setScene("wait-tasks", info("Get ready")));
        return writeScene(s, own.task);
      case "vote":
        // shared and own arrive apart: until both name the same vote, keep what is on screen
        if (!own.vote || own.vote.key !== s.key) return void (sceneKey || setScene("vote-watch", info("Eyes on the TV")));
        return voteScene(s, own);
      case "reveal":
        return void setScene(`reveal:${s.key}`, info("Votes are in", own.gained > 0 ? `You scored ${own.gained}.` : "Watch the TV."));
      case "scores":
        return void setScene(`scores:${s.key}`, info("Standings", `You have ${own.score}. See the TV.`));
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
    offs.forEach((f) => f());
    sceneOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
