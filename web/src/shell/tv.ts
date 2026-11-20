// When the TV page runs as a TV app (LG webOS, or the Android TV app in web/tv/android): the remote's Back key,
// leaving the app, and, on webOS, keeping the screen saver away (everyone plays on their phones, so the remote sits
// idle for a whole game; the Android app keeps the screen on itself).
// Elsewhere (a browser on a laptop or a TV), it only does Back keys.

interface Bridge {
  call(uri: string, params: string): void;
  onservicecallback?: (msg: string) => void;
}
const w = window as unknown as {
  PalmSystem?: { platformBack?(): void; launchParams?: string };
  PalmServiceBridge?: new () => Bridge;
};

export const isWebOS = !!w.PalmSystem || /Web0S|webOS/.test(navigator.userAgent);

// The Android TV app (web/tv/android) loads this page in a WebView. It adds "ThumbtideAndroidTV" to the user agent
// and a `ThumbtideTV` object with exit(), and turns the remote's Back button into an Escape key press.
export const isAndroidTV = /ThumbtideAndroidTV/.test(navigator.userAgent);

/** Running as a TV app (LG or Android TV): games use their lighter mode, and Back in the lobby leaves the app. */
export const isTV = isWebOS || isAndroidTV;

/** A start-up option: from the page's URL (?game=…), or, in the TV app, from what it was launched with. */
export function startParam(name: string): string | null {
  const v = new URLSearchParams(location.search).get(name);
  if (v !== null) return v;
  try {
    const p = JSON.parse(w.PalmSystem?.launchParams || "{}") as Record<string, unknown>;
    return p[name] === undefined || p[name] === null ? null : String(p[name]);
  } catch {
    return null;
  }
}

// LG's Back button is keyCode 461. Keyboards and other remotes send these.
const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack", "Backspace", "ContextMenu"]);
export const isBackKey = (e: KeyboardEvent) => BACK_KEYS.has(e.key) || e.keyCode === 461;

/** Close the app and go back to the TV's home screen. */
export function exitApp() {
  const android = (window as unknown as { ThumbtideTV?: { exit?(): void } }).ThumbtideTV;
  if (w.PalmSystem?.platformBack) w.PalmSystem.platformBack();
  else if (android?.exit) android.exit();
  else window.close();
}

// A call to one of the TV's system services.
function luna(uri: string, params: object, onReply?: (r: Record<string, unknown>) => void): Bridge | null {
  if (!w.PalmServiceBridge) return null;
  try {
    const b = new w.PalmServiceBridge();
    b.onservicecallback = (msg) => {
      try {
        onReply?.(JSON.parse(msg));
      } catch {
        /* not JSON */
      }
    };
    b.call(uri, JSON.stringify(params));
    return b;
  } catch {
    return null; // no such service on this TV
  }
}

// The TV asks before it starts the screen saver; we answer "not now". Exported so the subscription is kept alive.
export const screenSaverHold = isWebOS ? holdScreenSaver() : null;
function holdScreenSaver() {
  const clientName = "thumbtide";
  return luna("luna://com.webos.service.tvpower/power/registerScreenSaverRequest", { subscribe: true, clientName }, (r) => {
    if (r.timestamp === undefined) return;
    luna("luna://com.webos.service.tvpower/power/responseScreenSaverRequest", { clientName, ack: false, timestamp: r.timestamp });
  });
}

// webOS 6 TVs (Chromium 79) predate replaceChildren
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
    this.textContent = "";
    this.append(...nodes);
  };
}
