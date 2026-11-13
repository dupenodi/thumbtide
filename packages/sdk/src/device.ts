/** Phone helpers for controllers. All are safe no-ops where unsupported. */

// ------------------------------------------------------------------------------------------- platform

export type Platform = "ios" | "android" | "other";

export function platform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Launched from the home screen (no browser toolbars at all). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches
  );
}

// ------------------------------------------------------------------------------------------- haptics

let hapticsOn = true;
let iosSwitch: HTMLLabelElement | null = null;

/** Turn vibration on or off for every haptic() call (a player preference). */
export function setHaptics(on: boolean) {
  hapticsOn = on;
}

/**
 * A buzz. Android: the Vibration API (patterns work). iPhone has no Vibration API, but since iOS 18 toggling
 * a switch control gives a light tap, so we toggle a hidden one. That only works inside a touch handler,
 * which is exactly when buttons call this.
 */
export function haptic(pattern: number | number[] = 15): void {
  if (!hapticsOn || typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function" && platform() !== "ios") {
      navigator.vibrate(pattern);
      return;
    }
  } catch {
    /* ignore */
  }
  if (platform() !== "ios" || typeof document === "undefined") return;
  if (!iosSwitch) {
    iosSwitch = document.createElement("label");
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

/** @deprecated use haptic() */
export const vibrate = haptic;

// ------------------------------------------------------------------------------------------- keep the screen on

/**
 * Keep the phone screen on while the controller is open. Uses the Wake Lock API (re-taken whenever the
 * page comes back), and on phones without it a muted, looping, invisible video. Call it from a tap the
 * first time (the video fallback needs one). Returns a release function.
 */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let video: HTMLVideoElement | null = null;
  let stopped = false;

  const startVideo = async () => {
    if (video || stopped) return;
    const { BLANK_MP4 } = await import("./nosleep-video.ts");
    if (stopped) return;
    video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.muted = true;
    video.loop = true;
    video.src = BLANK_MP4;
    video.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    void video.play().catch(() => {});
  };

  const acquire = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    if ("wakeLock" in navigator) {
      try {
        lock = await navigator.wakeLock.request("screen");
        return;
      } catch {
        /* not allowed (e.g. plain http): fall back */
      }
    }
    if (video) void video.play().catch(() => {});
    else void startVideo();
  };
  const onVis = () => void acquire();
  // some browsers only grant it (or play the video) after a tap: try again on the next touch if we don't have it
  const onTouch = () => {
    if ((!lock || lock.released) && (!video || video.paused)) void acquire();
  };
  document.addEventListener("visibilitychange", onVis);
  document.addEventListener("pointerdown", onTouch, true);
  void acquire();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVis);
    document.removeEventListener("pointerdown", onTouch, true);
    void lock?.release().catch(() => {});
    video?.remove();
  };
}

// ------------------------------------------------------------------------------------------- fullscreen

export function canFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && platform() !== "ios";
}

export function isFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

/**
 * Go fullscreen (hides the URL bar and system bars on Android). Must be called from a tap.
 * Optionally lock the orientation (only works while fullscreen, on Android).
 */
export async function enterFullscreen(orientation?: "portrait" | "landscape"): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch {
    return false; // iPhone doesn't allow fullscreen for pages
  }
  if (orientation) {
    try {
      await (screen.orientation as unknown as { lock(o: string): Promise<void> })?.lock?.(orientation);
    } catch {
      /* not supported */
    }
  }
  return isFullscreen();
}

export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener("fullscreenchange", h);
  return () => document.removeEventListener("fullscreenchange", h);
}

// ------------------------------------------------------------------------------------------- motion

/**
 * Ask for motion-sensor access. iOS requires this to be called from a user
 * gesture (tap handler). Resolves true if tilt events will flow.
 */
export async function requestMotion(): Promise<boolean> {
  const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === "function") {
    try {
      return (await DOE.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export interface Tilt {
  /** Left/right, -1..1. */
  x: number;
  /** Toward/away, -1..1. */
  y: number;
}

/**
 * Tilt the phone like a steering wheel / marble maze. `maxDeg` is the angle
 * that maps to ±1. Call `requestMotion()` first on iOS.
 */
export function onTilt(cb: (t: Tilt) => void, maxDeg = 30): () => void {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const handler = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const angle = (screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0) as number;
    let x = e.gamma;
    let y = e.beta;
    // Remap axes in landscape so "left" is always left.
    if (angle === 90) [x, y] = [e.beta, -e.gamma];
    else if (angle === -90 || angle === 270) [x, y] = [-e.beta, e.gamma];
    cb({ x: clamp(x / maxDeg), y: clamp(y / maxDeg) });
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}
