// node tools/two_player_smoke.mjs [--offline] [--shots DIR]
// Two separate browser contexts (two "phones", 412x915) on a local static server
// of the BUILT page (port 8791), against the live database. Phone A taps Ranked
// Duel > Play a friend > Get a code and lands in the room; phone B opens the room
// LINK cold (?room=CODE, no first-run flag). Then: ready shows across, an emote
// and a call are seen on the other phone, both ready, a duel is played to the end,
// the result and score show in the room, duel 1's record is tidied away, ready
// again, a second duel starts, B does not pick in its first round and the 30 s
// clock settles it the same on both phones, B reloads mid duel and is back in the
// room with the duel called off, a third duel starts, A leaves mid duel and lands
// home, B stays at an Empty seat, C joins by typing the code, then both leave and
// the room record is gone. Prints PASS or the failure.
// --offline: one phone, every request off this machine blocked; checks that the
// page boots, that online play says why it cannot connect, and that a Sentinel
// duel still starts and plays a round. Puppeteer comes from lucid-winds.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/workspaces/lucid-winds/x.js'); const puppeteer = require('puppeteer');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791, BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const OFFLINE = process.argv.includes('--offline');
const si = process.argv.indexOf('--shots'); const SHOTS = si > 0 ? process.argv[si + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(ROOT, u === '/' ? '/index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
// offline: block the network for the WHOLE browser (service worker fetches and
// websockets bypass page request interception), leaving only this machine.
const NET_OFF = OFFLINE ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] : [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'].concat(NET_OFF) });
let failed = null;
const done = async (msg) => { console.log(msg); await browser.close().catch(() => {}); server.close(); process.exit(/^PASS/.test(msg) ? 0 : 1); };

async function phone(tag, o) {
  o = o || {};
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  p._errs = []; p._blocked = [];
  p.on('pageerror', (e) => p._errs.push(tag + ' pageerror: ' + String(e.message || e).slice(0, 200)));
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (/google-analytics|googletagmanager|portalPing|lucidwinds\.com/.test(u)) return r.abort();
    if (OFFLINE && !/^http:\/\/127\.0\.0\.1:/.test(u) && !/^data:/.test(u)) { p._blocked.push(u.slice(0, 90)); return r.abort('internetdisconnected'); }
    r.continue();
  });
  await p.evaluateOnNewDocument((cold, name) => { try { if (!cold) localStorage.setItem('sixfold_seen', '1'); if (name && !localStorage.getItem('sixfold_netname')) localStorage.setItem('sixfold_netname', name); } catch (e) {} }, !!o.cold, o.name || '');
  await p.goto(BASE + (o.query || ''), { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (o.query) await p.waitForFunction(() => document.getElementById('duelscreen').classList.contains('show'), { timeout: 20000 });
  else await p.waitForFunction(() => document.getElementById('title') && document.getElementById('title').classList.contains('show'), { timeout: 20000 });
  return p;
}
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
// wait for the first of several selectors to exist; returns the one that did
async function firstOf(p, sels, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { for (const s of sels) if (await p.$(s)) return s; await sleep(200); }
  return null;
}
async function openDuelScreen(p) {
  if (!(await click(p, '#tDuel'))) throw new Error('no Ranked Duel button on the title');
  if (!(await firstOf(p, ['#friendbtn'], 5000))) throw new Error('duel screen shows no Play a friend button');
}
// play until this phone's round counter moves past Round 1 (answering a bind prompt if a clash comes)
async function playOneRound(p, tag, stance) {
  const t0 = Date.now(); let tapped = false;
  while (Date.now() - t0 < 45000) {
    const st = await p.evaluate(() => ({ round: (document.getElementById('roundlbl') || {}).textContent || '', bind: document.querySelectorAll('.bindbtn-lg').length, verdict: (document.getElementById('verdict') || {}).textContent || '' }));
    if (!/Round 1\b/.test(st.round)) return st;
    if (st.bind) { await click(p, '.bindbtn-lg'); await sleep(400); continue; }
    // a stance takes two taps (pick, then "tap again" to lock it in)
    const sub = (await text(p, '#sub')) || '';
    if (!tapped || /tap again/i.test(sub)) { const ok = await p.evaluate((i) => { const n = document.querySelectorAll('#wheel .node')[i]; if (!n) return false; n.click(); return true; }, stance); if (!ok) throw new Error(tag + ': no wheel node to tap'); tapped = true; }
    await sleep(300);
  }
  throw new Error(tag + ': round 1 never resolved (stuck on "' + (await text(p, '#sub')) + '")');
}

// play a whole room duel on one phone: random stances (two taps each), any bind
// prompt answered, until the room comes back with the result. Optionally shoots
// the first reveal and reads the stance tags (You / the friend's name / Both).
async function playDuel(p, tag, shootReveal) {
  const t0 = Date.now(); let rounds = 0, lastRound = '', tags = '', tagShot = false;
  while (Date.now() - t0 < 240000) {
    const st = await p.evaluate(() => ({
      room: document.getElementById('duelscreen').classList.contains('show'),
      round: (document.getElementById('roundlbl') || {}).textContent || '',
      bind: document.querySelectorAll('.bindbtn-lg').length,
      sub: (document.getElementById('sub') || {}).textContent || '',
      tags: [...document.querySelectorAll('#wheel .ptag')].map((e) => e.textContent).join('|'),
    }));
    if (st.room) return { rounds, tags, tagShot };
    if (Date.now() - (p._lastLog || 0) > 15000) { p._lastLog = Date.now(); console.log('  .. ' + tag + ' ' + JSON.stringify(st) + (p._errs.length ? ' ERR ' + p._errs.join(' | ') : '')); }
    if (st.round !== lastRound) { lastRound = st.round; rounds++; }
    if (st.tags && !tagShot) { tags = st.tags + ' / sub "' + st.sub + '"'; tagShot = true; if (shootReveal && SHOTS) await p.screenshot({ path: SHOTS + '/duel-reveal.png' }); }
    if (st.bind) { await p.evaluate(() => { const b = document.querySelectorAll('.bindbtn-lg'); b[Math.floor(Math.random() * b.length)].click(); }); await sleep(500); continue; }
    if (/tap again/i.test(st.sub)) await p.evaluate(() => { const n = document.querySelector('#wheel .node.aiming'); if (n) n.click(); });
    else if (/^(tap a stance|tap to aim)$/i.test(st.sub)) await p.evaluate(() => { const n = document.querySelectorAll('#wheel .node'); n[Math.floor(Math.random() * 6)].click(); });
    await sleep(350);
  }
  throw new Error(tag + ': the duel never came back to the room');
}

try {
  if (OFFLINE) {
    const p = await phone('offline');
    if (SHOTS) await p.screenshot({ path: SHOTS + '/offline-title.png' });
    await openDuelScreen(p);
    await click(p, '#findbtn');
    const s = await firstOf(p, ['.netmsg', '.sentineloffer', '#modetag.ranked'], 30000);
    const msg = await text(p, '.netmsg .so-s');
    if (s !== '.netmsg') throw new Error('offline Find a rival did not explain itself (saw ' + s + ')');
    if (SHOTS) await p.screenshot({ path: SHOTS + '/offline-message.png' });
    if (!(await click(p, '#sooffline'))) throw new Error('no Duel a Sentinel button after the offline message');
    await sleep(1500);
    const tell = await text(p, '#foetell');
    if (!/Sentinel/.test(tell || '')) throw new Error('Sentinel duel did not start (foe line: ' + tell + ')');
    const st = await playOneRound(p, 'offline', 2);
    if (p._errs.length) throw new Error(p._errs.join(' | '));
    await done('PASS offline: page booted with ' + p._blocked.length + ' outside requests blocked; online play said "' + msg + '"; Sentinel duel started ("' + tell + '") and reached ' + st.round + '.');
  }

  // ---- the friend ROOM, two phones, against the live database ----
  const log = [];
  const say = (m) => { log.push(m); console.log('  .. ' + m); };
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: SHOTS + '/' + name + '.png' }); };
  const waitText = async (p, sel, re, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const s = await text(p, sel); if (s != null && re.test(s)) return s; await sleep(250); }
    throw new Error(what + ' (still "' + (await text(p, sel)) + '")');
  };
  const A = await phone('A', { name: 'Stephen' });
  await openDuelScreen(A);
  await click(A, '#friendbtn');
  await firstOf(A, ['#fhost'], 3000);
  await shot(A, 'friend-panel');
  await click(A, '#fhost');
  const got = await firstOf(A, ['#rcode', '.netmsg'], 40000);
  if (got !== '#rcode') {
    const why = got ? await text(A, '.netmsg .so-s') : 'nothing on screen after 40 s (still: ' + (await text(A, '#duelstatus')) + ')';
    throw new Error('phone A could not open a room: ' + why);
  }
  const code = await waitText(A, '#rcode', /^[A-Z2-9]{4}$/, 5000, 'no room code');
  const heading = await text(A, '#duelscreen h2');
  if (!/PLAY A FRIEND/.test(heading)) throw new Error('room heading is "' + heading + '"');
  say('A opened room ' + code + ' (heading "' + heading + '")');
  await shot(A, 'room-alone');
  // B arrives by the LINK, cold: no first-run flag, a name already typed once
  const B = await phone('B', { name: 'Jessie', cold: true, query: '?room=' + code });
  await waitText(B, '#rfrname', /Stephen/, 30000, 'B never saw Stephen in the room');
  await waitText(A, '#rfrname', /Jessie/, 30000, 'A never saw Jessie in the room');
  say('both in the room by name (B came in cold by the link)');
  // ready on one phone shows on the other
  await click(A, '#rready');
  await waitText(B, '#rnote', /Stephen is ready/, 15000, 'B never saw "Stephen is ready"');
  say('B sees "' + (await text(B, '#rnote')) + '"');
  // an emote and a call, each seen on the other phone
  await click(A, '#rtalk button.emo[data-emo="smirk"]');
  const bub = await waitText(B, '#rfrbub', /Smirk/, 10000, 'B never saw the Smirk emote');
  say('B saw the emote bubble "' + bub + '"');
  await click(B, '#rtalk .callbtn'); await sleep(200);
  await click(B, '#rtalk button.stc[data-call="4"]');
  const call = await waitText(A, '#rfrbub', /Jessie says: Crane/, 10000, 'A never saw the call');
  say('A saw the call "' + call + '"');
  await shot(B, 'room-ready');
  await shot(A, 'room-call');
  // both ready: the count, then the duel on both phones
  await click(B, '#rready');
  const friendly = async (p) => p.waitForFunction(() => (document.getElementById('modetag') || {}).textContent === 'Friendly' && !document.getElementById('duelscreen').classList.contains('show'), { timeout: 20000 }).then(() => true, () => false);
  await sleep(900); await shot(A, 'room-countdown');
  const [ma, mb] = await Promise.all([friendly(A), friendly(B)]);
  if (!ma || !mb) throw new Error('duel 1 did not start on both (A ' + ma + ', B ' + mb + ')');
  say('duel 1 started on both after the count');
  const card = await text(A, '#friendcard');
  if (!/Pick in secret/.test(card || '')) throw new Error('the first friend duel card did not show');
  await shot(A, 'friend-card');
  await click(A, '#friendcard'); await click(B, '#friendcard');
  // talk during the choosing phase: A taps Talk, sends Fire; B sees it by A's name on the board
  await sleep(1500);
  await click(A, '#talkbtn'); await sleep(250);
  await shot(A, 'duel-talk-open');
  await click(A, '#talkpop button.emo[data-emo="fire"]');
  const abub = await waitText(B, '#abub', /Fire/, 10000, 'B never saw the Fire emote during the duel');
  say('during duel 1, B saw "' + abub + '" by Stephen');
  await shot(B, 'duel-bubble');
  const [ra, rb] = await Promise.all([playDuel(A, 'A', true), playDuel(B, 'B', false)]);
  say('duel 1 played out (' + ra.rounds + ' rounds)');
  const [na, nb] = await Promise.all([waitText(A, '#rnote', /won/, 20000, 'A not back in the room with a result'), waitText(B, '#rnote', /won/, 20000, 'B not back in the room with a result')]);
  const [sca, scb] = [await waitText(A, '#rscore', /You 1|Jessie 1/, 10000, 'A score'), await waitText(B, '#rscore', /You 1|Stephen 1/, 10000, 'B score')];
  say('back in the room: A "' + na + '" / "' + sca + '"; B "' + nb + '" / "' + scb + '"');
  await shot(A, 'room-after-duel');
  if (ra.tagShot) say('reveal tags seen on A: ' + ra.tags);
  // the room keeps itself tidy: duel 1's record goes a few seconds after its result
  const dbGet = (p, path) => p.evaluate((path) => FirebaseNet.liveDb().ref(path).get().then((s) => s.val()), path);
  const waitGone = async (p, path, ms, what) => {
    const t0 = Date.now(); let v;
    while (Date.now() - t0 < ms) { v = await dbGet(p, path); if (v == null) return true; await sleep(1000); }
    throw new Error(what + ' (still ' + JSON.stringify(v).slice(0, 160) + ')');
  };
  await waitGone(A, 'sixfold/friends/' + code + '/duels', 25000, 'duel 1 record was not tidied away');
  const won1 = await dbGet(A, 'sixfold/friends/' + code + '/room/won');
  if (!won1 || !won1[1]) throw new Error('the score of duel 1 is not kept in the room');
  say('duel 1 record tidied away, the score kept in the room');
  // B steps away for a few seconds (network off), then the room carries on
  await B.setOfflineMode(true); await sleep(5000); await B.setOfflineMode(false); await sleep(3000);
  const stillA = await text(A, '#rfrname');
  say('after B was offline 5 s, A still shows "' + stillA + '" in the room');
  // ready again: the rematch
  await click(A, '#rready'); await sleep(400); await click(B, '#rready');
  const [m2a, m2b] = await Promise.all([friendly(A), friendly(B)]);
  if (!m2a || !m2b) throw new Error('duel 2 did not start (A ' + m2a + ', B ' + m2b + '; A note "' + (await text(A, '#rnote')) + '", B note "' + (await text(B, '#rnote')) + '")');
  const r2 = await text(A, '#roundlbl');
  say('duel 2 started on both (' + r2 + ')');
  // round 1 of duel 2: A picks, B never touches its phone. The round clock settles it.
  await sleep(1200);
  await A.evaluate(() => { const n = document.querySelectorAll('#wheel .node')[2]; if (n) n.click(); }); await sleep(400);
  await A.evaluate(() => { const n = document.querySelector('#wheel .node.aiming'); if (n) n.click(); });
  const clockA = await waitText(A, '#rclock', /Jessie has \d+ s/, 40000, 'A never saw the countdown while B did not pick');
  const clockB = await text(B, '#rclock');
  say('A sees "' + clockA + '", B sees "' + clockB + '"');
  await shot(A, 'duel-clock-wait'); await shot(B, 'duel-clock-pick');
  await Promise.all([waitText(A, '#roundlbl', /Round 2/, 40000, 'A: the unpicked round never settled'), waitText(B, '#roundlbl', /Round 2/, 40000, 'B: the unpicked round never settled')]);
  await sleep(600);
  const hp = async (p) => p.evaluate(() => ({ me: document.querySelectorAll('#php .pip.lost').length, foe: document.querySelectorAll('#ahp .pip.lost').length }));
  const [hpA, hpB] = [await hp(A), await hp(B)];
  if (!(hpA.me === 0 && hpA.foe === 2 && hpB.me === 2 && hpB.foe === 0)) throw new Error('the missed round did not settle the same on both phones (A ' + JSON.stringify(hpA) + ', B ' + JSON.stringify(hpB) + ')');
  say('the round B never picked settled after the clock: B took a clean hit on both phones (A ' + JSON.stringify(hpA) + ', B ' + JSON.stringify(hpB) + ')');
  await shot(A, 'duel-clock-settled');
  // B reloads the page in the middle of duel 2: back in the room, the duel called off
  await B.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  const bBack = await waitText(B, '#rnote', /Your duel was called off/, 40000, 'B (reloaded) was not told its duel was called off');
  const aTold = await waitText(A, '#rnote', /reloaded the page/, 30000, 'A was not told B reloaded');
  say('after B reloaded mid duel: B "' + bBack + '"; A "' + aTold + '"');
  await shot(B, 'room-after-reload');
  await click(A, '#rready'); await sleep(400); await click(B, '#rready');
  const [m3a, m3b] = await Promise.all([friendly(A), friendly(B)]);
  if (!m3a || !m3b) throw new Error('duel 3 did not start after the reload (A ' + m3a + ', B ' + m3b + ')');
  say('duel 3 started on both');
  // A leaves in the middle of duel 3: duel button, then Leave the room
  await sleep(1500);
  await click(A, '#duelbtn'); await sleep(500);
  await shot(A, 'room-during-duel');
  if (!(await click(A, '#rleave'))) throw new Error('no Leave the room button');
  const gone = await waitText(B, '#rnote', /Stephen left/, 20000, 'B was not told Stephen left');
  const bOpen = await B.evaluate(() => document.getElementById('duelscreen').classList.contains('show'));
  const bWait = await text(B, '#ractions');
  say('B sees "' + gone + '", room open ' + bOpen + ', buttons "' + bWait + '"');
  await shot(B, 'room-friend-left');
  const aWhere = await A.evaluate(() => ({ title: document.getElementById('title').classList.contains('show'), mode: (document.getElementById('modetag') || {}).textContent, url: location.search }));
  if (!aWhere.title) throw new Error('A did not land on the home screen after leaving');
  say('A is on the home screen (board behind: ' + aWhere.mode + ', url "' + aWhere.url + '")');
  if (!(await click(B, '#rwait'))) throw new Error('no Wait here button on B');
  await sleep(400);
  const bNote = await text(B, '#rnote');
  const bMode = await text(B, '#modetag');
  say('B tapped Wait here: "' + bNote + '"');
  if (!/Send the code or the link to play again/.test(bNote || '')) throw new Error('B is not waiting in the room ("' + bNote + '")');
  const seat = await text(B, '#rfrname');
  if (seat !== 'Empty seat') throw new Error('the empty seat reads "' + seat + '"');
  await shot(B, 'room-empty-seat');
  // the same code takes a new friend, this time by TYPING the code (the Join path)
  await A.close();
  const C = await phone('C', { name: 'Jo' });
  await openDuelScreen(C);
  await click(C, '#friendbtn'); await firstOf(C, ['#fcode'], 3000);
  await C.type('#fcode', code.toLowerCase()); await click(C, '#fjoin');
  await waitText(C, '#rfrname', /Jessie/, 30000, 'C (typed the code) never saw Jessie');
  const bNew = await waitText(B, '#rfrname', /Jo/, 30000, 'B never saw the newcomer');
  const bScore = await text(B, '#rscore');
  say('C joined by typing the code; B now sees "' + bNew + '", score "' + bScore + '"');
  const ladders = await Promise.all([B, C].map((p) => p.evaluate(() => localStorage.getItem('sixfold_pvp'))));
  // both leave: the last one out takes the room record with them
  await click(C, '#rleave'); await sleep(1500); await click(B, '#rleave');
  await waitGone(B, 'sixfold/friends/' + code, 20000, 'the room record was not removed after both left');
  say('both left: sixfold/friends/' + code + ' is gone');
  const errs = A._errs.concat(B._errs, C._errs);
  if (errs.length) throw new Error(errs.join(' | '));
  await done('PASS room ' + code + ': link join, ready, emote and call seen across, duel 1 to a result in the room (' + sca + ') and its record tidied, rematch, an unpicked round settled by the clock the same on both phones, a reload mid duel came back to the room with the duel called off, duel 3 started, A left mid duel and landed home, B stayed at an Empty seat, C joined by typing the code and met B, both left and the room record is gone; ladder untouched: ' + (ladders.every((l) => l == null || l === '{}' || /"wins":0,"losses":0/.test(l))));
} catch (e) {
  await done('FAIL ' + (e && e.message || e));
}
