# SIXFOLD Ranked Duels — Phase 2 (Firebase) wiring recipe

Phase 1 (live now) is **Sentinel-only** ranked duels + the Tier ladder, fully
offline, no backend. Phase 2 turns on **real-human matchmaking + a global
leaderboard** by adding a Firebase project. The code is already written and
tested (`src/firebase-net.js`); Phase 2 is **paste config + one build line**,
not a coding job.

Nothing below changes the game logic — it only flips the transport seam
(`Net.configure`) from the LocalMock to Firebase.

---

## What you do when you're ready (~15 min, one-time)

### 1. Create the Firebase project
- console.firebase.google.com → **Add project** (free **Spark** plan is plenty to start).
- Add a **Web app** (`</>`), copy the `firebaseConfig` object it shows you.
- Build → **Realtime Database** → **Create database** → start in **locked mode**.

### 2. Paste the Realtime Database security rules
Database → **Rules** tab → paste, **Publish**:

```json
{
  "rules": {
    "lobby": {
      ".read": true,
      "$uid": { ".write": true }
    },
    "duels": {
      "$id": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
(Starter rules: open enough to matchmake, scoped per-node. Tighten with Firebase
**Auth** later — anonymous auth is the natural next step so `$uid` writes are
gated to the signed-in user. Not required to go live.)

### 3. Drop your config into the page `<head>` (before the closing `</head>`)
Edit `sixfold.src.html`, just above `</head>`, add:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
<script>
  window.SIXFOLD_FIREBASE = {
    apiKey: "…", authDomain: "…", databaseURL: "https://…firebasedatabase.app",
    projectId: "…", appId: "…"
  };
</script>
```
(Paste the exact values from step 1. `databaseURL` must be present.)

### 4. Include the backend in the build (one line)
Edit `tools/build.js` — add `"firebase-net"` to the `ORDER` array, right after
`"net"`:

```js
const ORDER = ["audio","music","predictor","resolve","readout","personalities",
  "rank","matchmaker","net","firebase-net","skins","stage","assists","engine"];
```

### 5. Build, verify, deploy
```bash
node tools/build.js
for f in tests/*.test.js; do node "$f"; done   # 14 suites
node tools/domcheck.js                          # globals incl. FirebaseNet
# bump CACHE in sw.js, commit, push (GitHub Pages auto-builds)
```

That's it. On load, `firebase-net.js` sees `window.SIXFOLD_FIREBASE` + the SDK
and calls `Net.configure(FirebaseBackend(...))` automatically. **Find a rival**
now searches the real lobby; with no humans online it still offers a Sentinel.

---

## How it works (so future-you can reason about it)

The duel is **lockstep + low-frequency** (a few tiny messages per round), so the
Realtime DB *is* the channel — no WebRTC, no signaling. Three jobs:

- **Presence** — `/lobby/$uid = {name,rating,ts,status}` with `onDisconnect().remove()`.
- **Matchmaking** — a searcher reads the lobby, picks the closest rival inside a
  widening rating band (`matchmaker.js`), and **claims** them with a transaction
  on `/lobby/$opp/lock` (race-safe: only one claimer wins). The winner creates
  `/duels/$id`; both sides converge there.
- **Commit-reveal relay** — per round: each side writes a `commit` (hash of
  pick+salt) to `/duels/$id/rounds/$n/$side`; only after BOTH commits exist does
  either write its `reveal`; the reveal is verified against the commit. **Neither
  side can see or change its pick after seeing the other's** — a live duel is as
  unexploitable as single-player (the fairness pillar, enforced over the wire).

`src/firebase-net.js` is **inert** until both the config and the SDK are present,
so it is safe to inline early; it can never affect the offline Phase-1 build.
The commit-reveal relay is unit-tested against an in-memory DB in
`tests/firebase-net.test.js` (12 checks). Matchmaking transactions should be
smoke-tested against your live project once wired (two browser tabs).

---

## Phase-2 hardening backlog (from the focus group — do before "real" competitive)

1. **Server-authoritative results + reconnect grace (~10–15s) + `visibilitychange`
   handling.** Today a local connection drop awards the win at *reduced* stakes as
   a stopgap (`handlePvpDisconnect`). With a backend, resolve from the last
   committed round on the server and let a brief blip reconnect into the same
   round instead of ending the match. *(This is the #1 mobile/integrity gap.)*
2. **Anonymous Auth + per-uid write rules** so ratings can't be forged and
   `localStorage`-wipe re-placement is closed (anti-smurf).
3. **Global leaderboard** — a `/ladder` index (top-N + your neighbourhood),
   replacing the local "Your standing" panel with real rivals.
4. **Wagering stays OFF the combat path** (cosmetic sunbeams only) — flag
   gambling/ratings review for the Asia launch with the game manager.
