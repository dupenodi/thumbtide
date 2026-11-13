/// <reference types="vite/client" />
declare const __LAN_IP__: string;

interface ImportMetaEnv {
  /** Relay WebSocket URL, e.g. wss://relay.thumbtide.com. Defaults to ws://<page host>:8787 in dev. */
  readonly VITE_RELAY_URL?: string;
  /** The page phones open from the QR code, e.g. https://thumbtide.com/join/. Defaults to /join/ next to the TV page. */
  readonly VITE_JOIN_URL?: string;
}
