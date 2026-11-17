// Computer players. When a piece appears, a bot waits a moment (it "looks"), then scores every turn and column the
// piece can drop into: rows cleared, holes, total height, bumpiness and the highest column, plus a little noise.
// It then plays the best one with the same moves a phone sends, one move every few steps, like a quick human: turn,
// slide, drop. If a move is blocked it just drops. Each bot has its own speed and noise, so they can be beaten,
// and rising gravity outruns them in the end.
import { COLS, H, HIDDEN, MAX_SEATS, TURNS, dropY, fits, rowFull, type Kind, type Rng, type Seat, type Stack } from "./rules.ts";

export const BOT_NAMES = ["Staple", "Pica", "Gutter", "Folio", "Serif", "Kern", "Bleed", "Quire"];
export const isBot = (id: string) => id.startsWith("bot-");

interface Mind {
  pieceNo: number;
  plan: { rot: number; x: number } | null;
  wait: number;
  /** Steps between moves. */
  rate: number;
  /** Steps to look at a new piece. */
  react: number;
  noise: number;
}

/** How good a well looks: higher is better. */
export function judge(grid: Uint8Array, lines: number): number {
  const heights = new Array<number>(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let seen = false;
    for (let y = 0; y < H; y++) {
      if (grid[y * COLS + x]) {
        if (!seen) heights[x] = H - y;
        seen = true;
      } else if (seen) holes++;
    }
  }
  let agg = 0;
  let bump = 0;
  let max = 0;
  for (let x = 0; x < COLS; x++) {
    agg += heights[x]!;
    max = Math.max(max, heights[x]!);
    if (x) bump += Math.abs(heights[x]! - heights[x - 1]!);
  }
  const danger = Math.max(0, max - (H - HIDDEN) * 0.6);
  return -0.51 * agg + 0.8 * lines - 0.36 * holes * 2 - 0.18 * bump - 1.5 * danger * danger;
}

/** Every place a piece can drop into from where it is now, scored. */
export function placements(grid: Uint8Array, kind: Kind, fromY: number): { rot: number; x: number; score: number }[] {
  const out: { rot: number; x: number; score: number }[] = [];
  const g = new Uint8Array(grid.length);
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLS; x++) {
      if (!fits(grid, kind, rot, x, fromY)) continue;
      const y = dropY(grid, kind, rot, x, fromY);
      g.set(grid);
      for (const [cx, cy] of TURNS[kind][rot]!) if (y + cy >= 0) g[(y + cy) * COLS + x + cx] = 1;
      let lines = 0;
      for (let r = 0; r < H; r++) {
        if (!rowFull(g, r)) continue;
        lines++;
        g.copyWithin(COLS, 0, r * COLS);
        g.fill(0, 0, COLS);
      }
      out.push({ rot, x, score: judge(g, lines) });
    }
  }
  return out;
}

export function createBots(game: Stack, rng: Rng = Math.random) {
  const minds = new Map<string, Mind>();

  const plan = (s: Seat, m: Mind) => {
    const p = s.piece!;
    let best: { rot: number; x: number } | null = null;
    let bestScore = -Infinity;
    for (const c of placements(s.grid, p.kind, p.y)) {
      const score = c.score + (rng() - 0.5) * 2 * m.noise;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    m.plan = best ?? { rot: p.rot, x: p.x };
  };

  return {
    /** Add or remove bots to reach `n` (players come first: bots only take free seats). */
    setCount(n: number) {
      n = Math.max(0, Math.min(MAX_SEATS, Math.floor(n)));
      while (minds.size > n) {
        const id = [...minds.keys()].pop()!;
        minds.delete(id);
        game.removeSeat(id);
      }
      for (let i = 0; minds.size < n && i < MAX_SEATS; i++) {
        const id = `bot-${i}`;
        if (minds.has(id)) continue;
        if (!game.addSeat(id, BOT_NAMES[i]!, true)) break;
        const skill = rng();
        minds.set(id, {
          pieceNo: -1,
          plan: null,
          wait: 0,
          rate: 13 - Math.round(skill * 5),
          react: 40 - Math.round(skill * 18),
          noise: 2.2 - skill * 1.6,
        });
      }
    },

    /** Free a seat for a player who needs one. True if a bot stepped aside. */
    yieldOne(): boolean {
      const id = [...minds.keys()].pop();
      if (!id) return false;
      minds.delete(id);
      game.removeSeat(id);
      return true;
    },

    get count() {
      return minds.size;
    },

    step() {
      if (game.phase !== "play") return;
      for (const [id, m] of minds) {
        const s = game.seats.get(id);
        if (!s || !s.alive || !s.piece) continue;
        if (s.pieceNo !== m.pieceNo) {
          m.pieceNo = s.pieceNo;
          m.plan = null;
          m.wait = m.react + Math.floor(rng() * 8);
        }
        if (m.wait-- > 0) continue;
        if (!m.plan) plan(s, m);
        const p = s.piece;
        const t = m.plan!;
        let ok: boolean;
        if (p.rot !== t.rot) ok = game.input(id, "rotate");
        else if (p.x !== t.x) ok = game.input(id, p.x < t.x ? "right" : "left");
        else ok = game.input(id, "drop");
        if (!ok) game.input(id, "drop");
        m.wait = m.rate + Math.floor(rng() * 4);
      }
    },
  };
}
