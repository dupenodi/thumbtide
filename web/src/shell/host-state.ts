import type { Host } from "@thumbtide/sdk";
import type { ShellState } from "../games/types.ts";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Shell state the TV-side games can read (who's VIP, paused, the lobby's selected game). */
export const shell = {
  host: null as Host | null,
  vip: null as string | null,
  state: null as ShellState | null,
  mount: (_id: string): Promise<void> => Promise.resolve(),
  /** Fires when the VIP, pause state, settings or selection change. */
  onChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
    for (const fn of listeners) fn();
  },
};
