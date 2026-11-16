import { createWriteStream } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CLOSE_CODES,
  LIMITS,
  PROTOCOL_VERSION,
  isValidRoomCode,
  normalizeRoomCode,
  type ControllerToServer,
  type ErrorCode,
  type HostToServer,
} from "@thumbtide/protocol";
import { keepAwake } from "./keep-awake.ts";
import { RoomManager, type Conn, type Room } from "./rooms.ts";

export interface StartOptions {
  port?: number;
  playerGraceMs?: number;
  hostGraceMs?: number;
  /** See RoomManager (tests use 0). */
  ghostMinMs?: number;
  /** Comma-separated allowlist; empty = allow all origins. */
  allowedOrigins?: string[];
  /** Play-test recorder: every phone and TV message, one JSON line each (THUMBTIDE_RECORD=<file>). */
  record?: (line: object) => void;
}

const HEARTBEAT_MS = 15_000;

/** Token bucket per socket. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private warned = 0;
  constructor(
    private readonly perSec: number = LIMITS.ratePerSec,
    private readonly burst: number = LIMITS.rateBurst,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** Avoid spamming the error back — at most once per second. */
  shouldWarn(): boolean {
    const now = Date.now();
    if (now - this.warned < 1000) return false;
    this.warned = now;
    return true;
  }
}

function toConn(ws: WebSocket): Conn {
  return {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
    bufferedAmount: () => ws.bufferedAmount,
  };
}

function sendError(ws: WebSocket, code: ErrorCode, message: string) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "error", code, message }));
}

/** Parse a frame, enforcing size + rate limits. Returns null if it should be ignored. */
function parseFrame(ws: WebSocket, raw: Buffer | ArrayBuffer | Buffer[], limiter: RateLimiter): any {
  const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
  if (buf.byteLength > LIMITS.maxMessageBytes) {
    sendError(ws, "too-large", `message exceeds ${LIMITS.maxMessageBytes} bytes`);
    return null;
  }
  if (!limiter.take()) {
    if (limiter.shouldWarn()) sendError(ws, "rate-limited", "slow down");
    return null;
  }
  try {
    const msg = JSON.parse(buf.toString("utf8"));
    return msg && typeof msg === "object" && typeof msg.t === "string" ? msg : null;
  } catch {
    return null;
  }
}

export function startServer(opts: StartOptions = {}) {
  const rooms = new RoomManager({ playerGraceMs: opts.playerGraceMs, hostGraceMs: opts.hostGraceMs, ghostMinMs: opts.ghostMinMs });
  const allowed = new Set(opts.allowedOrigins?.filter(Boolean) ?? []);
  const rec = opts.record ? (line: object) => opts.record!({ ts: Date.now(), ...line }) : null;

  const http = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.rooms.size, sockets: wss.clients.size }));
      return;
    }
    res.setHeader("content-type", "text/plain");
    res.end("thumbtide relay\n");
  });

  // Hard cap is above the soft limit so oversized frames get a friendly error instead of a disconnect.
  const wss = new WebSocketServer({ server: http, maxPayload: LIMITS.maxMessageBytes * 4 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws, req) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    if (allowed.size && !allowed.has(req.headers.origin ?? "")) {
      ws.close(CLOSE_CODES.badRequest, "origin not allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://x");
    const role = url.searchParams.get("role");
    if (role === "host") handleHost(ws, url);
    else if (role === "controller") handleController(ws, url);
    else ws.close(CLOSE_CODES.badRequest, "role must be host or controller");
  });

  function handleHost(ws: WebSocket, url: URL) {
    const conn = toConn(ws);
    const tok = url.searchParams.get("token");
    let room: Room | null | undefined;
    let resumed = false;

    if (tok) {
      room = rooms.byToken(tok);
      if (!room) {
        sendError(ws, "bad-token", "room expired");
        ws.close(CLOSE_CODES.badToken, "room expired");
        return;
      }
      resumed = true;
    } else {
      room = rooms.create();
      if (!room) {
        ws.close(CLOSE_CODES.serverFull, "server full");
        return;
      }
      const game = url.searchParams.get("game");
      if (game) room.config.game = game.slice(0, 64);
    }

    const r = room;
    r.attachHost(conn, resumed);
    rec?.({ room: r.code, ev: "host-open", resumed });
    const limiter = new RateLimiter(LIMITS.hostRatePerSec, LIMITS.hostRateBurst);
    ws.on("message", (raw) => {
      const msg = parseFrame(ws, raw, limiter) as HostToServer | null;
      if (msg && msg.t !== "ping") rec?.({ room: r.code, ev: "tv", m: msg });
      if (msg && !r.closed) r.onHostMessage(msg);
    });
    ws.on("close", () => {
      rec?.({ room: r.code, ev: "host-close" });
      r.detachHost(conn);
    });
  }

  function handleController(ws: WebSocket, url: URL) {
    const code = normalizeRoomCode(url.searchParams.get("room") ?? "");
    const room = isValidRoomCode(code) ? rooms.get(code) : undefined;
    if (!room) {
      sendError(ws, "room-not-found", `no room ${code}`);
      ws.close(CLOSE_CODES.roomNotFound, "room not found");
      return;
    }

    const conn = toConn(ws);
    const result = room.joinController(conn, url.searchParams.get("name") ?? "", url.searchParams.get("token"));
    if (typeof result === "number") {
      const errCode: ErrorCode = result === CLOSE_CODES.roomLocked ? "room-locked" : "room-full";
      sendError(ws, errCode, errCode === "room-locked" ? "game in progress" : "room is full");
      ws.close(result, errCode);
      return;
    }

    const player = result;
    rec?.({ room: room.code, ev: "phone-open", id: player.info.id, name: player.info.name });
    const limiter = new RateLimiter();
    let lastSig = "";
    let lastIn = 0;
    ws.on("message", (raw) => {
      const msg = parseFrame(ws, raw, limiter) as ControllerToServer | null;
      if (msg && msg.t !== "ping" && rec) {
        // stick input comes ~60 times a second: keep every message whose buttons or mode change, and the stick
        // itself at most every 100 ms (an hour of 8 phones was ~150-200 MB with every message)
        const d = msg.t === "in" && msg.d && typeof msg.d === "object" ? (msg.d as Record<string, unknown>) : null;
        const sig = d ? Object.entries(d).filter(([k]) => k !== "x" && k !== "y").map(([k, v]) => `${k}${v}`).join() : "";
        const now = Date.now();
        if (!d || sig !== lastSig || now - lastIn >= 100) {
          lastSig = sig;
          lastIn = now;
          rec({ room: room.code, ev: "phone", id: player.info.id, m: msg });
        }
      }
      if (msg && !room.closed) room.onControllerMessage(player, msg);
    });
    ws.on("close", (code) => {
      rec?.({ room: room.code, ev: "phone-close", id: player.info.id, code });
      room.detachController(player, conn);
    });
  }

  // Server-side liveness: kill sockets that stop answering protocol pings
  // (phones that slept, wifi that vanished without a FIN).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  const ready = new Promise<number>((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return {
    ready,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

// Run directly: `tsx src/index.ts` (pathToFileURL, so Windows paths match too)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  // THUMBTIDE_RECORD=<file>: a play-test log of every phone and TV message (append, one JSON line each)
  const recFile = process.env.THUMBTIDE_RECORD;
  const recStream = recFile ? createWriteStream(recFile, { flags: "a" }) : null;
  if (recFile) console.log(`[thumbtide] recording all room traffic to ${recFile}`);
  const server = startServer({
    port,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()),
    record: recStream ? (line) => recStream.write(`${JSON.stringify(line)}\n`) : undefined,
  });
  server.ready.then((p) => console.log(`[thumbtide] relay listening on :${p}`));
  const stopKeepAwake = keepAwake();
  const shutdown = () => {
    stopKeepAwake?.();
    return server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
