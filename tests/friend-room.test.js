"use strict";
/* node tests/friend-room.test.js
 * The friend ROOM (sixfold/friends/<CODE>/room) against the in-memory tree
 * database: two phones meet, ready up, duel, see the score, rematch, talk, and
 * one leaves while the other stays. Also proves the talk (emotes and calls) can
 * never touch a committed pick or hold up a round. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// a TREE in-memory RTDB (parent reads see children, listeners fire for writes
// above or below their path, only on change) so the full findMatch pipeline
// (presence, lobby read, two-lock claim, duel node) runs against it.
function treeDb() {
  const data = {};
  const listeners = [];   // {path, cb, last}
  const segs = (p) => String(p).split("/").filter(Boolean);
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  function getAt(p) { let n = data; for (const s of segs(p)) { if (n == null || typeof n !== "object" || !(s in n)) return null; n = n[s]; } return clone(n); }
  function setAt(p, v) {
    const ss = segs(p); let n = data; const chain = [];
    for (let i = 0; i < ss.length - 1; i++) { if (n[ss[i]] == null || typeof n[ss[i]] !== "object") n[ss[i]] = {}; chain.push([n, ss[i]]); n = n[ss[i]]; }
    const last = ss[ss.length - 1];
    if (v == null) delete n[last]; else n[last] = clone(v);
    for (let i = chain.length - 1; i >= 0; i--) { const [par, k] = chain[i]; if (par[k] && typeof par[k] === "object" && !Object.keys(par[k]).length) delete par[k]; }
  }
  const related = (a, b) => { const x = segs(a), y = segs(b), n = Math.min(x.length, y.length); for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false; return true; };
  const snap = (v) => ({ val: () => clone(v) });
  function notify(w) {
    listeners.slice().forEach((l) => {
      if (!related(l.path, w) || listeners.indexOf(l) < 0) return;
      const v = getAt(l.path), j = JSON.stringify(v);
      if (j === l.last) return; l.last = j; l.cb(snap(v));
    });
  }
  function ref(p) {
    return {
      set: (v) => { setAt(p, v); notify(p); return Promise.resolve(); },
      update: (v) => { Object.keys(v).forEach((k) => setAt(p + "/" + k, v[k])); notify(p); return Promise.resolve(); },
      remove: () => { setAt(p, null); notify(p); return Promise.resolve(); },
      get: () => Promise.resolve(snap(getAt(p))),
      on: (ev, cb) => { const l = { path: p, cb, last: JSON.stringify(getAt(p)) }; listeners.push(l); cb(snap(getAt(p))); return cb; },
      off: (ev, cb) => { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p && listeners[i].cb === cb) listeners.splice(i, 1); },
      transaction: (fn) => { const next = fn(getAt(p)); if (next === undefined) return Promise.resolve({ committed: false, snapshot: snap(getAt(p)) }); setAt(p, next); notify(p); return Promise.resolve({ committed: true, snapshot: snap(getAt(p)) }); },
      onDisconnect: () => ({ remove: () => Promise.resolve() }),
      push: () => ({ key: "k" }),
      child: (c) => ref(p + "/" + c),
    };
  }
  return { ref, _data: data, _get: getAt };
}

function collect(room) {
  const ev = { duel: [], say: [], gone: [], back: [], ended: [], change: 0 };
  room.on("duel", (d) => ev.duel.push(d)).on("say", (s) => ev.say.push(s)).on("gone", (g) => ev.gone.push(g))
    .on("back", (b) => ev.back.push(b)).on("ended", (e) => ev.ended.push(e)).on("change", () => ev.change++);
  return ev;
}
// a clock the test moves by hand (the 2 s talk limit)
function fakeNow(start) { let t = start || 1000; const f = () => t; f.add = (ms) => { t += ms; }; return f; }

(async () => {
  const CODE = "K7QX", BASE = "sixfold/friends/K7QX/room";
  const db = treeDb();
  const clockA = fakeNow(1000), clockB = fakeNow(2000);
  const A = await FN.openRoom(db, CODE, { uid: "uA", name: "Stephen", now: clockA });
  const evA = collect(A);
  ok("the first player is alone in the room, score 0 to 0", A.view().friend === null && A.view().score.me === 0 && A.view().score.friend === 0);
  const B = await FN.openRoom(db, CODE, { uid: "uB", name: "<b>Jessie</b>", now: clockB });
  const evB = collect(B);
  await tick();
  ok("each player sees the other by name", A.view().friend && A.view().friend.name === "bJessie/b" && B.view().friend.name === "Stephen", A.view().friend && A.view().friend.name);
  ok("a name off the wire is cleaned of markup", !/[<>]/.test(A.view().friend.name));
  ok("the room lives under sixfold/friends/<CODE>/room", !!db._get(BASE + "/here/uA") && !!db._get(BASE + "/here/uB"));
  ok("the friend's arrival is announced to the first player", evA.back.length === 1 && evA.back[0].uid === "uB");

  let full = null;
  try { await FN.openRoom(db, CODE, { uid: "uC", name: "Third" }); } catch (e) { full = e.reason; }
  ok("a third player is told the room is full", full === "room-full");
  ok("and is not left behind in it", !db._get(BASE + "/here/uC"));
  let bad = null;
  try { await FN.openRoom(db, "AB1D", { uid: "uZ" }); } catch (e) { bad = e.reason; }
  ok("a bad code is refused before any write", bad === "bad-code");

  // ---- ready: one ready shows on the other phone; both ready starts ONE duel ----
  await A.setReady(true); await tick();
  ok("A ready shows as 'friend ready' on B", B.view().friendReady === true && B.view().myReady === false);
  ok("nothing starts while only one is ready", evA.duel.length === 0 && evB.duel.length === 0 && !db._get(BASE + "/duel"));
  await B.setReady(true); await tick(5);
  ok("both ready: both phones get the duel", evA.duel.length === 1 && evB.duel.length === 1);
  const d1a = evA.duel[0], d1b = evB.duel[0];
  ok("it is the same duel, number 1, with one phone on each side", d1a.id === d1b.id && d1a.n === 1 && d1a.a !== d1a.b && [d1a.a, d1a.b].sort().join() === "uA,uB");

  // ---- the duel itself: the usual commit-reveal relay, under .../friends/<CODE>/duels ----
  const sA = A.session(d1a), sB = B.session(d1b);
  ok("the session knows its opponent and that this is a room duel", sA.meta.id === "uB" && sA.meta.name === "bJessie/b" && sA.meta.room && sA.meta.friend && sB.meta.name === "Stephen");
  // the mind game: A CALLS Crane (4) out loud but commits Tiger (1)
  ok("a call is accepted", A.say("call", 4) === true);
  await tick();
  ok("B sees A's call as talk, with A's name", evB.say.length === 1 && evB.say[0].kind === "call" && evB.say[0].value === 4 && evB.say[0].name === "Stephen");
  const roundP = Promise.all([sA.exchangeStance(1, 1), sB.exchangeStance(1, 3)]);
  // a flood of talk during the round, written straight to the database (no throttle)
  for (let i = 0; i < 40; i++) await db.ref(BASE + "/say/uA").set({ k: "e", v: "fire", t: i, id: "flood" + i });
  const [ra, rb] = await roundP;
  ok("the round resolves with the COMMITTED picks, not the call", ra.oppPick === 3 && rb.oppPick === 1);
  ok("the round sits under sixfold/friends/<CODE>/duels/<id>/rounds", !!(db._get("sixfold/friends/K7QX/duels/" + d1a.id + "/rounds/1/a") || {}).commit);
  const say = db._get(BASE + "/say/uA");
  ok("a said thing carries no commit, reveal or salt", say && !("commit" in say) && !("reveal" in say) && !("salt" in say) && Object.keys(say).sort().join() === "id,k,t,v");
  ok("talk never writes under the duels path", JSON.stringify(db._get("sixfold/friends/K7QX/duels")).indexOf("fire") < 0);

  // ---- the result: score in the room, no ladder anywhere ----
  A.reportResult(1, true); B.reportResult(1, false); await tick();
  ok("after duel 1 the score reads You 1, Jessie 0 on A", A.view().score.me === 1 && A.view().score.friend === 0);
  ok("and the mirror on B", B.view().score.me === 0 && B.view().score.friend === 1);
  ok("one result recorded for duel 1", Object.keys(db._get(BASE + "/won")).length === 1);
  ok("after the duel nobody is ready (Ready is the rematch vote)", A.view().myReady === false && B.view().friendReady === false && A.view().nextN === 2);

  // ---- talk: limits and untrusted values ----
  ok("an emote is accepted", B.say("emote", "smirk") === true);
  ok("a second one inside 2 s is refused", B.say("emote", "yawn") === false);
  clockB.add(2000);
  ok("after 2 s the next one goes", B.say("emote", "yawn") === true);
  ok("an unknown emote id is refused", (clockB.add(3000), B.say("emote", "<script>")) === false);
  ok("a call that is not a stance is refused", B.say("call", 7) === false && B.say("call", 2.5) === false);
  await tick();
  const seen = evA.say.filter((s) => s.kind === "emote").map((s) => s.value);
  ok("A saw Smirk then Yawn", seen.join() === "smirk,yawn", seen.join());
  const before = evA.say.length;
  await db.ref(BASE + "/say/uB").set({ k: "e", v: "<img onerror=x>", t: 1, id: "evil1" });
  await db.ref(BASE + "/say/uB").set({ k: "c", v: "9", t: 1, id: "evil2" });
  await db.ref(BASE + "/say/uB").set({ k: "x", v: 1, t: 1, id: "evil3" });
  await tick();
  ok("hand-written junk in say is ignored", evA.say.length === before);

  // ---- rematch: a second and a third duel on the same code ----
  await A.setReady(true); await B.setReady(true); await tick(5);
  ok("duel 2 starts on both phones with a new id", evA.duel.length === 2 && evB.duel.length === 2 && evA.duel[1].n === 2 && evA.duel[1].id !== d1a.id && evA.duel[1].id === evB.duel[1].id);
  const s2a = A.session(evA.duel[1]), s2b = B.session(evB.duel[1]);
  const [x2a, x2b] = await Promise.all([s2a.exchangeStance(1, 0), s2b.exchangeStance(1, 5)]);
  ok("duel 2 relays a round", x2a.oppPick === 5 && x2b.oppPick === 0);
  A.reportResult(2, false); B.reportResult(2, true); await tick();
  ok("score after two duels: 1 to 1", A.view().score.me === 1 && A.view().score.friend === 1);
  await A.setReady(true); await B.setReady(true); await tick(5);
  ok("duel 3 starts too", evA.duel.length === 3 && evB.duel.length === 3 && evA.duel[2].n === 3);

  // ---- a duel called off reaches the other phone ----
  A.endDuel(3, "lost"); await tick();
  ok("B hears that duel 3 was called off", evB.ended.length === 1 && evB.ended[0].n === 3 && evB.ended[0].why === "lost");
  ok("the one who called it off is not told about it again", evA.ended.length === 0);

  // ---- taking Ready back in the same instant: the duel is called off, not left half-started ----
  // B is ready for duel 4; B's phone wrote duel 4 from a stale view where A was ready too
  await B.setReady(true); await A.setReady(false);
  await db.ref(BASE + "/duel").set({ n: 4, id: "r4_x", a: "uA", b: "uB", aName: "Stephen", bName: "Jessie", ts: 1 });
  await tick(5);
  ok("B (ready) starts duel 4, A (not ready) does not", evB.duel.length === 4 && evA.duel.length === 3);
  ok("A's phone calls duel 4 off so B is not left alone in it", evB.ended.some((x) => x.n === 4 && x.why === "unready"));

  // ---- leaving: the one who stays, stays ----
  await A.leave(); await tick();
  ok("B sees A LEFT the room (an explicit leave)", evB.gone.length === 1 && evB.gone[0].why === "left" && evB.gone[0].name === "Stephen");
  ok("B is still in the room, alone", B.view().friend === null && !!db._get(BASE + "/here/uB") && !db._get(BASE + "/here/uA"));
  ok("A's ready and talk were cleaned up", !db._get(BASE + "/ready/uA") && !db._get(BASE + "/say/uA"));
  // a new friend comes in on the same code
  const C = await FN.openRoom(db, CODE, { uid: "uC", name: "Jo" });
  await tick();
  ok("the same code takes a new friend in", B.view().friend && B.view().friend.name === "Jo" && C.view().friend.name === "bJessie/b");
  ok("the score is between the two in the room (0 to 0 with the newcomer)", B.view().score.me === 0 && B.view().score.friend === 0);
  // a drop (presence removed by the server, no leave marker)
  await db.ref(BASE + "/here/uC").remove(); await tick();
  ok("a drop reads as lost, not left", evB.gone.length === 2 && evB.gone[1].why === "lost");

  // ---- the duel session's grace: a blink offline does not end a room duel ----
  {
    const db2 = treeDb();
    await db2.ref("r/here/uB").set({ name: "B", at: 1 });
    const s = FN.makeRtdbSession(db2, "g1", "uA", "a", { id: "uB" }, { lobby: "r/here", duels: "r/duels" }, { graceMs: 60 });
    let dropped = 0; s.onDisconnect(() => dropped++);
    await db2.ref("r/here/uB").remove(); await tick(20);
    await db2.ref("r/here/uB").set({ name: "B", at: 1 }); await tick(80);
    ok("presence gone for 20 ms and back inside a 60 ms grace: still dueling", dropped === 0);
    await db2.ref("r/here/uB").remove(); await tick(90);
    ok("gone past the grace: the drop fires once", dropped === 1);
    const s0 = FN.makeRtdbSession(db2, "g2", "uA", "a", { id: "uX" }, { lobby: "r/here", duels: "r/duels" });
    await db2.ref("r/here/uX").set({ at: 1 }); let d0 = 0; s0.onDisconnect(() => d0++);
    await db2.ref("r/here/uX").remove();
    ok("without a grace (the public lobby) a drop fires at once, as before", d0 === 1);
  }

  ok("the emote list is six, each with a word", FN.EMOTES.length === 6 && FN.EMOTES.every((e) => e.id && e.w && e.e));
  B.leave();
  console.log("\n  friend-room.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
