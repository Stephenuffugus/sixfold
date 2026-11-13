// node tools/two_player_smoke.mjs [--offline] [--shots DIR]
// Two separate browser contexts (two "phones", 412x915) on a local static server
// of the BUILT page (port 8791). Phone A taps Ranked Duel > Play a friend > Get a
// code; phone B taps Play a friend, types the code, taps Join; both play one full
// round over the live database. Prints PASS or the exact failure.
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

async function phone(tag) {
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
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('sixfold_seen', '1'); } catch (e) {} });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => document.getElementById('title') && document.getElementById('title').classList.contains('show'), { timeout: 20000 });
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

  const A = await phone('A');
  await openDuelScreen(A);
  if (SHOTS) await A.screenshot({ path: SHOTS + '/duel-screen.png' });
  await click(A, '#friendbtn');
  await firstOf(A, ['#fhost'], 3000);
  if (SHOTS) await A.screenshot({ path: SHOTS + '/friend-panel.png' });
  await click(A, '#fhost');
  const got = await firstOf(A, ['.friendcode b', '.netmsg'], 40000);
  if (SHOTS) await A.screenshot({ path: SHOTS + '/friend-host.png' });
  if (got !== '.friendcode b') {
    const why = got ? await text(A, '.netmsg .so-s') : 'nothing on screen after 40 s (still: ' + (await text(A, '#duelstatus')) + ')';
    throw new Error('phone A could not get a code: ' + why);
  }
  const code = await text(A, '.friendcode b');
  const B = await phone('B');
  await openDuelScreen(B);
  await click(B, '#friendbtn');
  await firstOf(B, ['#fcode'], 3000);
  await B.type('#fcode', code.toLowerCase());
  await click(B, '#fjoin');
  const matched = async (p) => p.waitForFunction(() => (document.getElementById('modetag') || {}).textContent === 'Friendly', { timeout: 30000 }).then(() => true, () => false);
  const [ma, mb] = await Promise.all([matched(A), matched(B)]);
  if (!ma || !mb) throw new Error('code ' + code + ': not matched (A ' + ma + ' "' + (await text(A, '#duelstatus')) + '", B ' + mb + ' "' + (await text(B, '#duelstatus')) + '")');
  const [na, nb] = [await text(A, '#foename'), await text(B, '#foename')];
  const ratingBefore = await Promise.all([A, B].map((p) => p.evaluate(() => localStorage.getItem('sixfold_pvp'))));
  const [sa, sb] = await Promise.all([playOneRound(A, 'A', 1), playOneRound(B, 'B', 4)]);
  const ratingAfter = await Promise.all([A, B].map((p) => p.evaluate(() => localStorage.getItem('sixfold_pvp'))));
  const errs = A._errs.concat(B._errs);
  if (errs.length) throw new Error(errs.join(' | '));
  await done('PASS code ' + code + ': matched (A sees "' + na + '", B sees "' + nb + '"); round 1 resolved on both (A "' + sa.verdict + '", B "' + sb.verdict + '"); ladder untouched: ' + (ratingBefore.join() === ratingAfter.join()));
} catch (e) {
  await done('FAIL ' + (e && e.message || e));
}
