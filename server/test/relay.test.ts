import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Controller, Host } from "@thumbtide/sdk";
import { startServer } from "../src/index.ts";

let server: ReturnType<typeof startServer>;
let url = "";
const cleanup: Array<{ close?: () => void; leave?: () => void }> = [];

before(async () => {
  server = startServer({ port: 0, playerGraceMs: 400, awayGraceMs: 1500, hostGraceMs: 400, ghostMinMs: 0 });
  url = `ws://127.0.0.1:${await server.ready}`;
});
after(async () => {
  for (const c of cleanup) {
    try {
      c.close?.();
    } catch {}
  }
  await server.close();
});

/** Resolve on the next `event` from an SDK emitter, or fail after `ms`. */
function next<T = any>(em: { once: (e: any, fn: any) => () => void }, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), ms);
    em.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve((args.length > 1 ? args : args[0]) as T);
    });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newHost(opts: Partial<ConstructorParameters<typeof Host>[0]> = {}) {
  const host = new Host({ server: url, game: "test", persist: false, ...opts });
  cleanup.push(host);
  await host.ready();
  return host;
}
async function newController(host: Host, name = "Sam") {
  const ctl = new Controller({ server: url, room: host.code, name, persist: false });
  cleanup.push({ close: () => ctl.leave() });
  const joined = next(host, "join");
  await next(ctl, "ready");
  await joined;
  return ctl;
}
/** Force-drop a socket server-side with a non-terminal code, like a network blip. */
function blipPlayer(host: Host, playerId: string) {
  const room = server.rooms.get(host.code)!;
  room.players.get(playerId)!.conn!.close(1012, "blip");
}

/** The phone's tab goes away (closed, or the browser dropped it): no leave message, no reconnect. */
function closeTab(ctl: Controller) {
  (ctl as any).link.close();
}

describe("relay", () => {
  test("host creates a room and a controller joins it", async () => {
    const host = await newHost();
    assert.match(host.code, /^[A-Z]{4}$/);
    const ctl = await newController(host, "Alex");
    assert.equal(ctl.me?.name, "Alex");
    assert.equal(ctl.config?.game, "test");
    assert.equal(ctl.hostConnected, true);
    assert.equal(host.players.size, 1);
    assert.equal(host.list[0]?.index, 0);
  });

  test("messages route both ways, targeted and broadcast", async () => {
    const host = await newHost();
    const a = await newController(host, "A");
    const b = await newController(host, "B");

    const got = next(host, "message");
    a.send({ type: "jump" });
    const [from, data] = await got;
    assert.equal(from.id, a.me!.id);
    assert.deepEqual(data, { type: "jump" });

    // Targeted: only B should get it.
    let aGot = false;
    a.once("message", () => (aGot = true));
    const bGot = next(b, "message");
    host.send(b.me!.id, { type: "buzz" });
    assert.deepEqual(await bGot, { type: "buzz" });
    await sleep(50);
    assert.equal(aGot, false);

    const both = Promise.all([next(a, "message"), next(b, "message")]);
    host.broadcast({ type: "all" });
    assert.deepEqual(await both, [{ type: "all" }, { type: "all" }]);
  });

  test("duplicate names get a suffix", async () => {
    const host = await newHost();
    await newController(host, "Sam");
    const second = await newController(host, "sam");
    assert.equal(second.me?.name, "sam 2");
  });

  test("sticky state is replayed to late joiners and reconnecting players", async () => {
    const host = await newHost();
    const a = await newController(host, "A");
    const own = next(a, "state");
    host.setOwn(a.me!.id, { color: "red" });
    assert.deepEqual((await own).own, { color: "red" });
    host.setShared({ phase: "playing" });
    await sleep(50);

    const late = new Controller({ server: url, room: host.code, name: "Late", persist: false });
    cleanup.push({ close: () => late.leave() });
    await next(late, "ready");
    assert.deepEqual(late.shared, { phase: "playing" });
    assert.equal(late.own, null);

    // A reconnects after a blip and still has its own state.
    const rejoined = next(host, "rejoin");
    blipPlayer(host, a.me!.id);
    const [p] = [await rejoined];
    assert.equal(p.id, a.me!.id);
    assert.deepEqual(a.own, { color: "red" });
  });

  test("controller reconnect keeps the same player id and slot", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const id = ctl.me!.id;
    const dropped = next(host, "drop");
    const rejoined = next(host, "rejoin");
    blipPlayer(host, id);
    assert.equal((await dropped).id, id);
    assert.equal((await rejoined).id, id);
    assert.equal(ctl.me!.id, id);
    assert.equal(host.players.size, 1);
    assert.equal(host.players.get(id)!.connected, true);
  });

  test("away and back reach the host, and away clears the player's input", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const id = ctl.me!.id;
    assert.equal(host.players.get(id)!.away, false);
    const moved = next(host, "input");
    ctl.input({ x: 1, y: 0 });
    await moved;
    const away = next(host, "away");
    ctl.setAway(true);
    const p = await away;
    assert.equal(p.id, id);
    assert.equal(p.away, true);
    assert.equal(p.input, null);
    assert.equal(p.connected, true);
    const back = next(host, "away");
    ctl.setAway(false);
    assert.equal((await back).away, false);
    assert.equal(server.rooms.get(host.code)!.players.get(id)!.info.away, false);
  });

  test("an away phone whose socket dies keeps its seat past the normal grace, up to the away limit", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const id = ctl.me!.id;
    const away = next(host, "away");
    ctl.setAway(true);
    await away;
    const dropped = next(host, "drop");
    closeTab(ctl);
    const p = await dropped;
    assert.equal(p.away, true);
    await sleep(700); // past playerGraceMs (400)
    assert.equal(host.players.has(id), true);
    const [gone, reason] = await next(host, "leave", 3000); // awayGraceMs (1500)
    assert.equal(gone.id, id);
    assert.equal(reason, "timeout");
  });

  test("a phone that came back, then dropped, gets the normal grace (a real disconnect)", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const away = next(host, "away");
    ctl.setAway(true);
    await away;
    const back = next(host, "away");
    ctl.setAway(false);
    await back;
    const t0 = Date.now();
    const left = next(host, "leave", 1200);
    closeTab(ctl);
    const [gone] = await left;
    assert.equal(gone.id, ctl.me!.id);
    assert.ok(Date.now() - t0 < 1200);
  });

  test("a full room does not give an away phone's seat to a newcomer", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    const a = await newController(host, "A");
    await newController(host, "B");
    const away = next(host, "away");
    a.setAway(true);
    await away;
    const dropped = next(host, "drop");
    closeTab(a);
    await dropped;
    const late = new Controller({ server: url, room: host.code, name: "C", persist: false });
    assert.equal(await next(late, "closed"), "room-full");
    assert.deepEqual(host.list.map((p) => p.name), ["A", "B"]);
  });

  test("the away flag outlives a reconnect, and the phone says back again after the welcome", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const id = ctl.me!.id;
    const away = next(host, "away");
    ctl.setAway(true);
    await away;
    // reconnect while still away: the relay keeps the flag
    let rejoined = next(host, "rejoin");
    blipPlayer(host, id);
    assert.equal((await rejoined).away, true);
    assert.equal(host.players.get(id)!.away, true);
    // the phone came back, but its "back" went into a dead socket: the next welcome puts it right
    (ctl as any).away = false;
    rejoined = next(host, "rejoin");
    const back = next(host, "away");
    blipPlayer(host, id);
    await rejoined;
    assert.equal((await back).away, false);
    assert.equal(host.players.get(id)!.away, false);
  });

  test("continuous input is coalesced and latest-wins", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    let count = 0;
    host.on("input", () => count++);
    for (let i = 0; i <= 100; i++) ctl.input({ x: i / 100, y: 0 });
    await sleep(150);
    assert.ok(count >= 1 && count <= 5, `expected few input frames, got ${count}`);
    assert.deepEqual(host.players.get(ctl.me!.id)!.input, { x: 1, y: 0 });
  });

  test("locked rooms reject new players", async () => {
    const host = await newHost();
    await newController(host, "A");
    host.lock(true);
    await sleep(50);
    const late = new Controller({ server: url, room: host.code, name: "B", persist: false });
    assert.equal(await next(late, "closed"), "room-locked");
  });

  test("room full", async () => {
    const host = await newHost({ maxPlayers: 1 });
    await sleep(50);
    await newController(host, "A");
    const late = new Controller({ server: url, room: host.code, name: "B", persist: false });
    assert.equal(await next(late, "closed"), "room-full");
  });

  test("a full room frees the seat of a dropped phone for a new player", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    const a = await newController(host, "A");
    await newController(host, "B");
    // A's phone goes away (closed tab): its seat is held in the grace period
    const dropped = next(host, "drop");
    closeTab(a);
    await dropped;
    const left = next(host, "leave");
    const c = await newController(host, "C");
    const [gone, reason] = await left;
    assert.equal(gone.id, a.me!.id);
    assert.equal(reason, "timeout");
    assert.equal(c.me?.name, "C");
    assert.deepEqual(host.list.map((p) => p.name), ["B", "C"]);
  });

  test("a full room of connected phones still refuses a new player", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    await newController(host, "A");
    await newController(host, "B");
    const late = new Controller({ server: url, room: host.code, name: "C", persist: false });
    assert.equal(await next(late, "closed"), "room-full");
    assert.equal(host.players.size, 2);
  });

  test("a phone back without its token gets its own seat back by name", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    const a = await newController(host, "Sam");
    await newController(host, "B");
    const id = a.me!.id;
    const oldToken = server.rooms.get(host.code)!.players.get(id)!.token;
    const dropped = next(host, "drop");
    closeTab(a);
    await dropped;
    const rejoined = next(host, "rejoin");
    const back = new Controller({ server: url, room: host.code, name: " sam ", persist: false });
    cleanup.push({ close: () => back.leave() });
    const ready = await next(back, "ready");
    assert.equal(ready.you.id, id);
    assert.equal(ready.resumed, true);
    assert.equal((await rejoined).id, id);
    assert.equal(host.players.size, 2);
    // the seat has a new token, so the old tab can't take it back
    assert.notEqual(server.rooms.get(host.code)!.players.get(id)!.token, oldToken);
  });

  test("a locked room refuses a phone without its token, also by name", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    const a = await newController(host, "Sam");
    host.lock(true);
    const dropped = next(host, "drop");
    closeTab(a);
    await dropped;
    const back = new Controller({ server: url, room: host.code, name: "Sam", persist: false });
    cleanup.push({ close: () => back.leave() });
    assert.equal(await next(back, "closed"), "room-locked");
  });

  test("a connected player's name is not taken over", async () => {
    const host = await newHost();
    const a = await newController(host, "Sam");
    const b = await newController(host, "Sam");
    assert.notEqual(b.me!.id, a.me!.id);
    assert.equal(b.me!.name, "Sam 2");
    assert.equal(host.players.get(a.me!.id)!.connected, true);
  });

  test("locked rooms still refuse strangers even when a seat is a ghost", async () => {
    const host = await newHost({ maxPlayers: 2 });
    await sleep(50);
    const a = await newController(host, "A");
    await newController(host, "B");
    host.lock(true);
    const dropped = next(host, "drop");
    closeTab(a);
    await dropped;
    const late = new Controller({ server: url, room: host.code, name: "C", persist: false });
    assert.equal(await next(late, "closed"), "room-locked");
    assert.equal(host.players.size, 2);
  });

  test("a resumed host pushes its seat limit to the room", async () => {
    const host = await newHost({ maxPlayers: 16 });
    await sleep(50);
    const room = server.rooms.get(host.code)!;
    assert.equal(room.config.maxPlayers, 16);
    // the room still has an older page's limit when the host reconnects and resumes it
    room.config.maxPlayers = 8;
    const resumed = next(host, "room");
    room.host!.close(1012, "blip");
    assert.equal((await resumed).resumed, true);
    await sleep(50);
    assert.equal(room.config.maxPlayers, 16);
  });

  test("a host can fan sticky state out to 16 phones joining at once", async () => {
    const host = await newHost({ maxPlayers: 16 });
    await sleep(50);
    let limited = 0;
    host.on("error", (code) => code === "rate-limited" && limited++);
    // like the lobby: on every join, refresh every phone's own state twice
    host.on("join", () => {
      for (let k = 0; k < 2; k++) for (const p of host.players.values()) host.setOwn(p.id, { k });
    });
    const ctls = Array.from({ length: 16 }, (_, i) => {
      const c = new Controller({ server: url, room: host.code, name: `P${i}`, persist: false });
      cleanup.push({ close: () => c.leave() });
      return next(c, "ready");
    });
    await Promise.all(ctls);
    await sleep(300);
    assert.equal(limited, 0);
    assert.equal(host.players.size, 16);
  });

  test("kick removes the player and tells their phone", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const closed = next(ctl, "closed");
    const left = next(host, "leave");
    host.kick(ctl.me!.id);
    assert.equal(await closed, "kicked");
    const [, reason] = await left;
    assert.equal(reason, "kicked");
    assert.equal(host.players.size, 0);
  });

  test("unknown room code", async () => {
    const ctl = new Controller({ server: url, room: "ZZZZ", name: "X", persist: false });
    assert.equal(await next(ctl, "closed"), "room-not-found");
  });

  test("host refresh resumes the same room; controllers see host blip", async () => {
    const host = await newHost();
    const code = host.code;
    const ctl = await newController(host);
    const off = next(ctl, "host");
    const on = new Promise<boolean>((r) => {
      let n = 0;
      ctl.on("host", (c) => {
        if (++n === 2) r(c);
      });
    });
    server.rooms.get(code)!.host!.close(1012, "blip");
    assert.equal(await off, false);
    assert.equal(await on, true);
    assert.equal(host.code, code);
    assert.equal(host.players.size, 1);
  });

  test("player who never returns is removed after the grace period", async () => {
    const host = await newHost();
    // Raw socket so nothing auto-reconnects.
    const ws = new WebSocket(`${url}?role=controller&room=${host.code}&name=Ghost`);
    const [p] = [await next(host, "join")];
    const left = next(host, "leave", 3000);
    ws.close();
    const [gone, reason] = await left;
    assert.equal(gone.id, p.id);
    assert.equal(reason, "timeout");
  });

  test("room closes for everyone if the host never returns", async () => {
    const ws = new WebSocket(`${url}?role=host`);
    const welcome: any = await new Promise((r) => ws.addEventListener("message", (e) => r(JSON.parse(e.data)), { once: true }));
    const ctl = new Controller({ server: url, room: welcome.room, name: "A", persist: false });
    await next(ctl, "ready");
    const closed = next(ctl, "closed", 3000);
    ws.close();
    assert.equal(await closed, "host-timeout");
    assert.equal(server.rooms.get(welcome.room), undefined);
  });

  test("host whose room expired gets a fresh room automatically", async () => {
    const host = await newHost();
    const oldCode = host.code;
    // Expire the room server-side while the host is mid-reconnect.
    server.rooms.get(oldCode)!.close("host-timeout");
    const [info] = [await next(host, "room", 3000)];
    assert.notEqual(info.code, oldCode);
    assert.equal(info.resumed, false);
  });

  test("oversized messages are rejected without disconnecting", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    const err = next(ctl, "error");
    ctl.send({ blob: "x".repeat(20_000) });
    const [code] = await err;
    assert.equal(code, "too-large");
    assert.equal(ctl.status, "open");
  });

  test("message floods are rate limited", async () => {
    const host = await newHost();
    const ctl = await newController(host);
    let received = 0;
    host.on("message", () => received++);
    const err = next(ctl, "error");
    for (let i = 0; i < 500; i++) ctl.send({ i });
    const [code] = await err;
    assert.equal(code, "rate-limited");
    await sleep(100);
    assert.ok(received < 250, `expected flood to be capped, got ${received}`);
    assert.equal(ctl.status, "open");
  });
});
