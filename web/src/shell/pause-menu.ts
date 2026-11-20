// The TV's pause menu. Shows whenever the game is paused (from the VIP's phone, or from here), and opens
// with Back / Esc on a TV remote or keyboard. Arrow keys + OK move and choose, so no mouse is needed.
// In the lobby of the TV app, Back leaves the app.
import { juicy } from "../games/kit/juicy.ts";
import type { ShellState } from "../games/types.ts";
import { exitApp, isBackKey, isTV } from "./tv.ts";

interface Actions {
  isLobby(): boolean;
  state(): ShellState;
  pause(): void;
  resume(): void;
  restart(): void;
  lobby(): void;
}

export function createPauseMenu(a: Actions) {
  const el = document.createElement("div");
  // on the TV no backdrop blur: blurring the full 4K frame behind the menu is the costliest thing the compositor does
  el.className = isTV ? "pm pm-lite" : "pm";
  el.hidden = true;
  document.body.appendChild(el);

  let open = false; // opened from the TV itself
  let focus = 0;
  let items: { id: string; label: string; run: () => void }[] = [];

  function visible() {
    return !a.isLobby() && (open || a.state().paused);
  }

  function render() {
    const s = a.state();
    const show = visible();
    el.hidden = !show;
    if (!show) return;
    items = s.canPause
      ? [
          { id: "resume", label: "Resume", run: close },
          { id: "restart", label: "Restart round", run: () => (close(), a.restart()) },
          { id: "lobby", label: "Back to lobby", run: () => (close(), a.lobby()) },
        ]
      : [
          { id: "close", label: "Keep playing", run: close },
          { id: "lobby", label: "Back to lobby", run: () => (close(), a.lobby()) },
        ];
    focus = Math.min(focus, items.length - 1);
    el.innerHTML = `
      <div class="pm-card">
        <div class="pm-title">${juicy(s.paused ? "Paused" : "Menu", "candy")}</div>
        <p class="pm-sub">${s.paused ? "Take a breather. The VIP's phone can resume too." : "The game keeps running."}</p>
        <div class="pm-items">${items
          .map((it, i) => `<button class="pm-item ${i === focus ? "focus" : ""}" data-i="${i}">${it.label}</button>`)
          .join("")}</div>
        <p class="pm-hint">Arrows to move · OK to choose · Back to close</p>
      </div>`;
    for (const b of el.querySelectorAll<HTMLButtonElement>(".pm-item")) {
      b.onclick = () => items[Number(b.dataset.i)]?.run();
    }
  }

  function openMenu() {
    if (a.isLobby()) return;
    open = true;
    focus = 0;
    if (a.state().canPause) a.pause();
    render();
  }

  function close() {
    open = false;
    if (a.state().paused) a.resume();
    render();
  }

  window.addEventListener("keydown", (e) => {
    if (a.isLobby()) {
      if (isTV && isBackKey(e)) {
        e.preventDefault();
        exitApp();
      }
      return;
    }
    if (isBackKey(e)) {
      e.preventDefault();
      if (visible()) close();
      else openMenu();
      return;
    }
    if (!visible()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") focus = (focus + 1) % items.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") focus = (focus - 1 + items.length) % items.length;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      items[focus]?.run();
      return;
    } else return;
    e.preventDefault();
    render();
  });

  return {
    render,
    close() {
      open = false;
      render();
    },
  };
}
