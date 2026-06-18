# SIXFOLD — Character Art Sheet (artist / image-pipeline brief)

**One character = one sheet = one file.** Every warrior ships as a **single image**
holding **6 frames in a 2×3 grid**. The game slices frames straight off the sheet
by position, so the sheet you deliver *is* the game asset — no cutting up, no
per-frame export. This is what keeps a roster of hundreds of characters consistent
and lets us drop a new skin in by adding one line of config.

> **The Pillar:** art is the *only* purchase and it *never* touches combat. A skin
> changes nothing about damage, odds, the meter, or the bind. Make it beautiful;
> it stays purely cosmetic.

---

## The grid (read top-left → right, then next row)

```
+-----------+-----------+-----------+
|   IDLE    |  STRIKE   |    HIT    |
+-----------+-----------+-----------+
|    KO     |  GUARD    |    WIN    |
+-----------+-----------+-----------+
```

| # | Frame | When the game shows it | Pose direction |
|---|-------|------------------------|----------------|
| 1 | **idle**   | resting / between rounds; base of every stance lean | balanced ready stance, weapon held neutral, weight centered |
| 2 | **strike** | the attack lunge on reveal | committed forward thrust, weapon extended toward the enemy (screen-right) |
| 3 | **hit**    | this fighter took a glance or a clean blow | recoiling, head/torso knocked back, off-balance, weapon dipping |
| 4 | **ko**     | this fighter lost the match (0 HP) | downed / collapsing toward the ground, defeated |
| 5 | **guard**  | the Clash Bind "locked blades" hold | braced, weapon raised across the body, leaning into the clash |
| 6 | **win**    | this fighter won the match | victory flourish, weapon raised, triumphant |

The engine **generates all 6 stance leans** (Heaven/Tiger/River/Earth/Crane/Shadow)
by tilting/translating the `idle` and `strike` frames — so you do **not** draw a
separate image per stance. Six frames cover everything.

---

## Hard technical contract (every frame, no exceptions)

These rules are what make transforms line up across the whole roster. Breaking any
one makes the character jitter or float relative to others.

1. **Facing RIGHT.** The opponent is auto-mirrored by the game (`scaleX(-1)`); never
   draw a left-facing version.
2. **Fixed pivot anchor: 50% across, 88% down.** Put the character's **feet/base on
   that anchor line** in every frame. Idle and strike especially must share the same
   foot position so the lunge reads as motion, not teleporting. (For `ko`, the body
   may rotate/fall, but it should pivot *around* that same anchor.)
3. **Identical canvas + identical scale** in all 6 cells. Same character size cell to
   cell. Don't zoom one frame in.
4. **Transparent background.** No backdrop, no ground shadow baked in (the game adds
   staging). PNG with alpha.
5. **Square cells.** Each frame cell is square; the full sheet is 3 wide × 2 tall.
6. **Consistent light + palette** across the sheet (it's one character in one scene's
   lighting). Silhouette should read clearly at small size — this plays on phones.

### Recommended dimensions
- **Cell:** 512 × 512 px → **Sheet:** **1536 × 1024 px**, PNG-32 (transparent).
- Smaller is fine for lighter weight (e.g. 256 cell → 768×512 sheet); keep it square
  and keep the 3×2 layout.

---

## House style (LOCKED 2026-06-18): paper + watercolor

The game's visual identity is **watercolor pigment on washi paper** — soft wet-edge
washes, visible paper grain, sumi-e brush linework, restrained palette with seal-red
and gold accents. Every character must read as if **painted in that same scroll** so
the roster feels like one collection. Keep this style line identical across all
characters; only the `<<CHARACTER>>` slot changes.

> Style line (paste verbatim into every prompt):
> *"traditional Japanese watercolor and sumi-e ink wash painting, soft wet-on-wet
> color bleeds, visible washi paper texture, expressive brush-stroke outlines, muted
> natural pigments with a few bold accent colors, painterly not digital, no hard
> cel-shading."*

## Ready-to-paste generation prompt (AI image tools)

Generate the whole sheet in **one shot** so style/lighting/proportions stay consistent.
Fill in the `<<…>>` slots per character.

```
A character sprite sheet for a 2D fighting game, arranged as a clean 3-columns ×
2-rows grid on a fully transparent background. The SAME character — <<CHARACTER
DESCRIPTION: e.g. a lean masked ronin in a crimson kimono with a katana>> — drawn
six times, one pose per cell, identical art style, identical scale, identical
lighting, facing to the RIGHT in every cell. Feet aligned to the same baseline in
every cell.

Cell order, left to right, top row then bottom row:
1) IDLE — balanced ready stance, weapon held neutral, weight centered.
2) STRIKE — committed forward lunge, weapon thrust toward the right, attacking.
3) HIT — recoiling backward from a blow, off-balance, head knocked back.
4) KO — defeated, collapsing toward the ground.
5) GUARD — braced, weapon raised across the body, leaning into a blade clash.
6) WIN — victorious flourish, weapon raised high, triumphant.

Style: traditional Japanese watercolor and sumi-e ink wash painting, soft wet-on-wet
color bleeds, visible washi paper texture, expressive brush-stroke outlines, muted
natural pigments with a few bold accent colors, painterly not digital, no hard
cel-shading. No background, no ground shadow, no text, no grid lines, no border.
Transparent PNG. Full-body, consistent character design across all six poses.
```

Tips for consistency: lock a seed if your tool supports it; generate the sheet once
rather than per-frame; if a pose drifts, inpaint just that cell rather than
regenerating the whole sheet. In Midjourney use `--style raw` and a square-ish ar;
the transparent-grid requirement is best honored by GPT image tools.

## Starter roster (unlock rewards — fill the `<<CHARACTER>>` slot)

A first batch of distinct silhouettes for the single-player unlock cast. Each is one
sheet; drop in with one `REGISTRY` line (id in parens).

1. **Crimson Ronin** (`ronin`) — a lean masked ronin in a flowing crimson kimono, a
   single long katana, straw hat slung on the back.
2. **Shadow (Kage)** (`kage`) — a slim ninja in deep indigo-black wraps, face hidden,
   twin short blades, wisps of smoke.
3. **Iron Monk (Tetsu)** (`tetsu`) — a broad bald warrior-monk in grey robes, iron-banded
   forearms, a heavy bo staff; calm, immovable.
4. **Pale Ghost (Yurei)** (`yurei`) — a translucent pale spirit in tattered white burial
   robes, long black hair, a ghostly naginata, faint blue glow.
5. **Ember Oni (Onibi)** (`onibi`) — a horned oni in charred armor, ember cracks glowing
   orange, a massive iron kanabō club.
6. **Sky Crane (Sora)** (`sora`) — an elegant duelist in pale blue & white with crane
   motifs, a slender feather-light spear, graceful.
7. **Storm (Raiden)** (`raiden`) — an armored warrior wreathed in faint lightning,
   gold-trimmed black armor, a war-fan and a jagged blade.
8. **Centipede (Mukade)** (`mukade`) — a sinister armored fighter in segmented dark-green
   plate, paired sai, low coiled stance.

Backdrops too: each arena theme (Moonlit Dojo / Sunset Cliff / Bamboo Grove / Night
Torii) can later take a painted watercolor backdrop image — same house style, **16:9,
no characters, soft depth** — to drop behind the CSS scene. Optional; the CSS scene
ships today without it.

---

## Dropping a finished sheet into the game

1. Put the file somewhere the page can load it (e.g. `skins/crimson-ronin.png`, or a
   CDN/GCS URL, or a data-URI).
2. Add one entry to the registry in `src/skins.js` (`REGISTRY`):
   ```js
   { id:"crimson-ronin", name:"Crimson Ronin", kind:"atlas",
     cols:3, rows:2, frames:GRID.frames, url:"skins/crimson-ronin.png" },
   ```
3. Re-run `node tools/build.js` to re-inline into the shipped `sixfold.html`.
4. The skin now appears in the Customize → **Skin** picker, and `setFrame` will hard-cut
   between the six frames automatically. Nothing else to wire.

The built-in **"Inkblade (demo)"** skin is a vector stand-in generated in code (no
file) so the pipeline is testable before real art exists — use it as the reference
for pose framing and the anchor.

---

## Cheaper fallbacks (if 6 frames is too much for a character)

The system reads the `frames` map, so a skin can ship fewer cells and reuse them:

- **3 frames** `[idle][strike][hit]` (1×3): map `ko/guard/win` to `strike` or `hit`.
- **2 frames** `[idle][strike]` (1×2): the validated spec minimum — all flinch/KO is
  done with CSS transforms on those two.

Point the extra frame names at an existing cell in the `frames` map, e.g.
`frames:{ idle:[0,0], strike:[1,0], hit:[2,0], ko:[2,0], guard:[1,0], win:[1,0] }`.
Full 6-frame sheets look best; these exist so a character is never blocked on art.
