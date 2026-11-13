"use strict";
/* the TREE in-memory RTDB the room tests share (parent reads see children,
 * listeners fire for writes above or below their path, only on change).
 * Not a suite itself: required by tests/room-clock.test.js. */
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
module.exports = { treeDb };
