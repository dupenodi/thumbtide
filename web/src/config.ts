/** Where the relay lives. Set VITE_RELAY_URL in production (Vercel env var). */
export const RELAY_URL: string =
  import.meta.env.VITE_RELAY_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${import.meta.env.VITE_RELAY_PORT || 8787}`;

/**
 * Base URL phones open from the QR code. VITE_JOIN_URL fixes it (the TV app, which runs from file://).
 * In dev the TV page is usually on localhost, which a phone can't reach, so swap in the machine's LAN IP.
 */
export function joinBase(): string {
  if (import.meta.env.VITE_JOIN_URL) return new URL(import.meta.env.VITE_JOIN_URL).toString();
  const u = new URL("/join/", location.href);
  if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && __LAN_IP__) u.hostname = __LAN_IP__;
  return u.toString();
}

/** Display host for "go to ___ and enter code" text. */
export function joinDisplay(): string {
  const u = new URL(joinBase());
  return `${u.host}${u.pathname.replace(/\/$/, "")}`;
}

/** Player colors by join index. Bright enough to read on a TV from across the room. */
export const PLAYER_COLORS = [
  "#ff5d73", "#3ec5ff", "#ffd23f", "#7cf29a", "#c18cff", "#ff9f43",
  "#ff6ad5", "#2de2c9", "#f7f7f7", "#a3e048", "#ff7a59", "#6c8cff",
  "#ffb3c6", "#9ad1d4", "#e0c097", "#b8b8ff",
];
export const colorFor = (index: number) => PLAYER_COLORS[index % PLAYER_COLORS.length]!;
