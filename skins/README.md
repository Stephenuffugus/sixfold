# skins/ — drop generated character sheets here

This folder holds the **PNG sprite sheets** for real character art. The game
serves them from the same origin (GitHub Pages), and the service worker caches
them automatically on first load (cache-first), so they work offline after one
visit.

## How to add a character (one line of code)

1. Generate a sheet per **`ART_SHEET.md`** (3×2 grid: idle/strike/hit/ko/guard/win,
   facing right, transparent background, feet on a shared baseline, watercolor
   house style). Save it here as `skins/<id>.png` — e.g. `skins/ronin.png`.
2. Add one entry to `REGISTRY` in `src/skins.js`:

   ```js
   { id:"ronin", name:"Crimson Ronin", kind:"atlas",
     cols:3, rows:2, frames:GRID.frames, url:"skins/ronin.png" },
   ```

3. `node tools/build.js` to re-inline, then commit. The skin shows up in
   **Customize → Skin** and `setFrame` hard-cuts between the six frames.

## Safety nets already in place

- **Bad/missing sheet never breaks play:** if a `url:` sheet fails to load
  (missing, blocked, malformed), the game hot-swaps that fighter to the built-in
  vector stand-in. So you can register a skin before the PNG exists, or ship a
  half-finished roster, without risk.
- **Cosmetic only (the Pillar):** a skin changes nothing about damage, odds, the
  meter, or the bind. Art is the only purchase and it never touches combat.

## Recommended export

- Cell 512×512 → sheet **1536×1024**, PNG-32 (transparent). Smaller is fine if
  square and 3×2. Keep file weight reasonable for mobile (aim < ~500 KB/sheet;
  run them through a PNG optimizer if needed).
