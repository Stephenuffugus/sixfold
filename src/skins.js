/* SIXFOLD — skins.js  (cosmetic art layer)
 *
 * PILLAR: a skin is art only. Nothing here touches damage, odds, the meter, or
 * the bind. Skins are pure swap-in cosmetics.
 *
 * A skin = ONE sprite atlas (the artist's single sheet IS the game asset) plus a
 * frame map. The loader slices frames by CSS background-position, so swapping a
 * frame is an instant GPU-cheap cut while the CSS pose/lunge transforms still
 * play on the wrapper. Drop-in: add a REGISTRY entry pointing at a URL/dataURI —
 * no other code changes. The vector "placeholder" renders when no atlas is set.
 *
 * Frame contract (matches the art sheet brief / ART_SHEET.md):
 *   2x3 grid, fixed anchor 50% x / 88% y, transparent bg, facing right:
 *     [ idle ][ strike ][ hit ]
 *     [ ko   ][ guard  ][ win ]
 *   Opponent = the same atlas mirrored with scaleX(-1) on the wrapper.
 *
 * API:
 *   FRAMES                    -> ["idle","strike","hit","ko","guard","win"]
 *   list()                    -> [{id,name,kind,cols,rows,frames}]
 *   get(id)                   -> skin meta (falls back to placeholder)
 *   atlasPos(skin, frameName) -> "x% y%"   (pure; for background-position)
 *   src(skin, palette)        -> atlas URL/dataURI (demo skins are generated)
 */
(function (root) {
  "use strict";

  const FRAMES = ["idle", "strike", "hit", "ko", "guard", "win"];
  // canonical 2x3 layout: [col,row] of each frame in the sheet
  const GRID = {
    cols: 3, rows: 2,
    frames: { idle: [0, 0], strike: [1, 0], hit: [2, 0], ko: [0, 1], guard: [1, 1], win: [2, 1] },
  };

  // background-position for a frame, given the atlas' col/row count.
  function atlasPos(skin, name) {
    const map = (skin && skin.frames) || GRID.frames;
    const f = map[name] || [0, 0];
    const c = (skin && skin.cols) || GRID.cols;
    const r = (skin && skin.rows) || GRID.rows;
    const x = c > 1 ? (f[0] / (c - 1)) * 100 : 0;
    const y = r > 1 ? (f[1] / (r - 1)) * 100 : 0;
    return x + "% " + y + "%";
  }

  // ---- demo skin: one vector warrior posed across all 6 frames, tinted by the
  // player's palette. Proves the atlas pipeline end-to-end before real art lands.
  function demoAtlas(pal) {
    pal = pal || "#cf4130";
    const POSE = {
      idle:   { rot: 0,   dy: 0,  head: 34, blade: [80, 70] },
      strike: { rot: 8,   dy: 0,  head: 32, blade: [95, 47] },
      hit:    { rot: -12, dy: 2,  head: 30, blade: [64, 80] },
      ko:     { rot: 76,  dy: 12, head: 42, blade: [90, 88] },
      guard:  { rot: 4,   dy: 1,  head: 33, blade: [57, 36] },
      win:    { rot: -4,  dy: -2, head: 30, blade: [74, 16] },
    };
    function fig(p) {
      const t = "translate(0 " + p.dy + ") rotate(" + p.rot + " 50 88)";
      return '<g transform="' + t + '">' +
        // robe
        '<path d="M30 88 Q25 60 34 47 L44 51 Q50 47 56 51 L66 47 Q75 60 70 88 Z" fill="' + pal + '" stroke="#0007" stroke-width="2"/>' +
        // sash / shoulders
        '<path d="M34 47 Q50 36 66 47 L62 56 Q50 50 38 56 Z" fill="#1a1d2b" stroke="#0006" stroke-width="1.3"/>' +
        // head
        '<circle cx="50" cy="' + p.head + '" r="9" fill="#1a1d2b" stroke="#0007" stroke-width="1.5"/>' +
        // blade
        '<line x1="54" y1="54" x2="' + p.blade[0] + '" y2="' + p.blade[1] + '" stroke="' + pal + '" stroke-width="4.5" stroke-linecap="round"/>' +
        '</g>';
    }
    let cells = "";
    FRAMES.forEach((name) => {
      const f = GRID.frames[name];
      cells += '<g transform="translate(' + f[0] * 100 + " " + f[1] * 100 + ')">' + fig(POSE[name]) + "</g>";
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">' + cells + "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  const REGISTRY = [
    { id: "placeholder", name: "Vector (default)", kind: "vector" },
    { id: "inkblade", name: "Inkblade (demo)", kind: "atlas", cols: GRID.cols, rows: GRID.rows, frames: GRID.frames, gen: demoAtlas },
    // --- real watercolor sheets (1 PNG each, 3x2 layout; ART_SHEET.md) ---
    { id: "ronin", name: "Crimson Ronin", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/ronin.png" },
    { id: "kage", name: "Shadow", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kage.png" },
    { id: "tetsu", name: "Iron Monk", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tetsu.png" },
    { id: "onibi", name: "Ember Oni", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/onibi.png" },
    { id: "sora", name: "Sky Crane", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/sora.png" },
    { id: "honekage", name: "Bonedrifter", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/honekage.png" },
    { id: "raiden", name: "Storm", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/raiden.png" },
    { id: "yurei", name: "Pale Ghost", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/yurei.png" },
    { id: "mukade", name: "Centipede", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/mukade.png" },
    { id: "tengu", name: "Tengu", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tengu.png" },
    { id: "kitsune", name: "Kitsune", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kitsune.png" },
    { id: "kappa", name: "Kappa Grappler", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kappa.png" },
    { id: "lantern", name: "Lantern Wraith", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/lantern.png" },
    { id: "jorogumo", name: "Jorogumo", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/jorogumo.png" },
    { id: "moth", name: "Moth Priestess", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/moth.png" },
    { id: "painter", name: "Brush Duelist", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/painter.png" },
    { id: "heron", name: "Snow Heron", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/heron.png" },
    { id: "beetle", name: "Beetle Warrior", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/beetle.png" },
    { id: "tanuki", name: "Tanuki Warrior", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tanuki.png" },
    { id: "shikigami", name: "Paper Shikigami", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/shikigami.png" },
    // --- second art drop (2026-06-21): 20 new fighters, soft-matte cut + packed ---
    { id: "seaserpent", name: "Sea Serpent Ronin", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/seaserpent.png" },
    { id: "kirin", name: "Kirin", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kirin.png" },
    { id: "zato", name: "Zato the Blind", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/zato.png" },
    { id: "raijin", name: "Raijin", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/raijin.png" },
    { id: "onnabugeisha", name: "Onna-bugeisha", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/onnabugeisha.png" },
    { id: "daimyo", name: "Daimyo", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/daimyo.png" },
    { id: "yukionna", name: "Yuki-onna", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/yukionna.png" },
    { id: "kabukimono", name: "Kabukimono", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kabukimono.png" },
    { id: "baku", name: "Baku", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/baku.png" },
    { id: "tsukiusagi", name: "Tsuki-usagi", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tsukiusagi.png" },
    { id: "fujin", name: "Fujin", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/fujin.png" },
    { id: "nue", name: "Nue", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/nue.png" },
    { id: "rikishi", name: "Rikishi", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/rikishi.png" },
    { id: "kasaobake", name: "Kasa-obake", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kasaobake.png" },
    { id: "nekomata", name: "Nekomata", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/nekomata.png" },
    { id: "hannya", name: "Hannya", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/hannya.png" },
    { id: "mochiknight", name: "Moon-Rabbit Knight", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/mochiknight.png" },
    { id: "komainu", name: "Komainu", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/komainu.png" },
    { id: "kyudoka", name: "Kyudoka", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kyudoka.png" },
    { id: "gashadokuro", name: "Gashadokuro", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/gashadokuro.png" },
    // --- third art drop (2026-06-21): 30 new fighters (soft-matte cut + packed) ---
    { id: "yamabiko", name: "Yamabiko", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/yamabiko.png" },
    { id: "karakasa", name: "Karakasa Twins", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/karakasa.png" },
    { id: "moondeer", name: "Moon Deer Oracle", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/moondeer.png" },
    { id: "kitsunebi", name: "Kitsune-bi", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kitsunebi.png" },
    { id: "shisa", name: "Shisa", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/shisa.png" },
    { id: "tancho", name: "Tancho Priestess", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tancho.png" },
    { id: "nureonna", name: "Nure-onna", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/nureonna.png" },
    { id: "komainucub", name: "Komainu Cub", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/komainucub.png" },
    { id: "mizuchi", name: "Mizuchi", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/mizuchi.png" },
    { id: "tsuchinoko", name: "Tsuchinoko", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tsuchinoko.png" },
    { id: "toranokami", name: "Tora-no-Kami", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/toranokami.png" },
    { id: "bakucalf", name: "Baku Calf", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/bakucalf.png" },
    { id: "jinmenju", name: "Jinmenju", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/jinmenju.png" },
    { id: "kawauso", name: "Kawauso", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kawauso.png" },
    { id: "yatagarasu", name: "Yatagarasu", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/yatagarasu.png" },
    { id: "maskmaker", name: "Mask Maker", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/maskmaker.png" },
    { id: "tidelion", name: "Tide Guardian", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tidelion.png" },
    { id: "tengugeneral", name: "Tengu General", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tengugeneral.png" },
    { id: "frogshogun", name: "Frog Shōgun", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/frogshogun.png" },
    { id: "umibozu", name: "Umi-bōzu", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/umibozu.png" },
    { id: "tatsumaiden", name: "Tatsu Maiden", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tatsumaiden.png" },
    { id: "kappaknight", name: "Kappa Shell Knight", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kappaknight.png" },
    { id: "bakeneko", name: "Bakeneko", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/bakeneko.png" },
    { id: "mujina", name: "Mujina", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/mujina.png" },
    { id: "shachihoko", name: "Shachihoko", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/shachihoko.png" },
    { id: "spectraldog", name: "Spectral Hound", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/spectraldog.png" },
    { id: "battocat", name: "Battō Cat", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/battocat.png" },
    { id: "kijimuna", name: "Kijimuna", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/kijimuna.png" },
    { id: "tsuchigumo", name: "Tsuchigumo", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/tsuchigumo.png" },
    { id: "hoo", name: "Hōō Dancer", kind: "atlas", cols: 3, rows: 2, frames: GRID.frames, url: "skins/hoo.png" },
  ];

  function list() {
    return REGISTRY.map((s) => ({ id: s.id, name: s.name, kind: s.kind, cols: s.cols, rows: s.rows, frames: s.frames }));
  }
  function get(id) { return REGISTRY.find((s) => s.id === id) || REGISTRY[0]; }
  function src(skin, pal) { if (!skin) return null; if (skin.gen) return skin.gen(pal); return skin.url || null; }

  const api = { FRAMES, GRID, atlasPos, list, get, src };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Skins = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
