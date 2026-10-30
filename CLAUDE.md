# ASCII Battleground

Vanilla JS canvas game (no build, no deps, no tests). Open `index.html` in a browser.
Comments in code are in Ukrainian; match that style. Use 4-space indent, `'use strict'`, single quotes.

## Rules
- Plain `<script>` tags, global scope. **Load order matters** (see `index.html`): config → movement → art → effects → projectile → ground-unit → plane → battle → settings. New file = add a `<script>` tag.
- Tunables/constants go in `js/config.js`, not inline.
- `movement.js` = math/physics only; `art.js` = drawing only; entities own state + behavior.
- Pooled objects (`Smoke`, `Projectile`, `GroundUnit`) are reused via `spawn`/`launch`/`fire` — don't `new` per event.
- Teams: 0 (left, blue) and 1 (right, red). Lanes 0–2 (`LANE_OFFSETS`).

## Map
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for per-file API. Read only the file you need.
