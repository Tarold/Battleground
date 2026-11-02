# Architecture (per-file map)

| File | Contents |
|---|---|
| `config.js` | `canvas`, `context`, `world` (size, `groundLevel`, `laneLevel`, `impactLevel`, `basePosition`), all constants (`UNIT_STATS`, `PLANE_STATS`, bomb/rocket/AA-missile tunables), `clamp()` |
| `movement.js` | `Movement`: ground advance/bounds, `stepProjectile`, `guideRocket` (homing), `stepSmoke`, plane steer/fly/fall, `bombLandingX`, `alignment`, ballistics (`artilleryShot`, `directShot`, `groundShot`) |
| `art.js` | `Art`: `drawBackground`, `drawGroundUnit` → `drawInfantry`/`drawTank`/`drawAntiAircraft` (pickup, legendary missile trailer)/`drawArtillery` (САУ, legendary MLRS via `drawRocketPack`), plane sprites |
| `effects.js` | `Smoke`, `Banner` classes + `spawnSmoke`, `spawnBombCloud`, `spawnExplosion`, `spawnLegendEffect`, `spawnNuclearExplosion`; area damage: `damageArea` (ground), `damagePlanesArea` |
| `projectile.js` | `segmentHitsRectangle`, `Projectile` (`static fire(options)`, `update`, `hitPlane`, `hitGroundUnit`, `detonate`, `detonateRocket`, `draw`) — covers bullets, shells, bombs, rockets, AA missiles |
| `ground-unit.js` | `GroundUnit`: types INFANTRY/TANK/ANTIAIRCRAFT/ARTILLERY; `deploy`, `spawn`, `update`, `selectTarget`, `findGroundTarget`, `findAirTarget`, `fire`, `tryLaunchMissile` (AA), `draw` |
| `plane.js` | `Plane(index, kind)`: `kind` = key in `PLANE_STATS` (`bomber` is a getter); states FLYING/FALLING/RESPAWNING; `tryShoot`, `tryLaunchRocket`, `tryDropBomb`, `continueCarpetBombing`, targeting helpers, `draw` |
| `helicopter.js` | `Helicopter extends Plane` (kind `'heli'`): hovers low near the nearest enemy ground unit (`hover` → `Movement.steerHeli`), minigun turret with its own `turretAngle` (`findTarget`, `aimTurret`, `tryShoot` in bursts), legend fires an unguided rocket salvo (`tryLaunchRocket`/`continueSalvo`); `draw` → `Art.drawHelicopter` |
| `battle.js` | `GroundSpawner`, `battle` (`update`, `render`, `deployInitialForces`, `handleResize`), main `loop` |

## Flow
`loop` → `battle.update` (spawners, units, planes, projectiles, smoke) → `battle.render`.
Combat: entity picks target → `Projectile.fire({...})` → `update` detects hit → `detonate` → `spawnExplosion` + `damageArea`/`damagePlanesArea`.

## Legends
`kills` → `addKill()` → `becomeLegend()` (in `GroundUnit` and `Plane`). The killer is credited via `Projectile.owner` → `takeDamage(amount, attacker)`; area damage passes `owner` through `damageArea`/`damagePlanesArea`.
Per-type thresholds, legend HP and perks live in `UNIT_STATS[type].legend` / `PLANE_STATS[kind].legend` (`shots`, `missiles`, `rpg`, `rockets`, `nuke`); entities read them through the `perk` getter (null if not legendary).
Only bombers can become legends among planes (fighter has no `legend`); killing a bomber counts `BOMBER_KILL_VALUE` (2) kills. Kill value (what a victim is worth to its killer): `killValue` in `UNIT_STATS` (infantry 0.5, legend infantry 0.5, others 1), bomber 2 (`BOMBER_KILL_VALUE`), other planes 1.
Key `1` toggles the top-score panel (`battle.showScores`, `battle.topScores(team)` → `Art.drawScores`): best kills per type vs. kills needed for legend.
Base AA and base fighter have only guns; AA missiles and fighter rockets are legend-only (`perk.missiles` / `perk.rockets`). Plane legends reset on death/respawn. Legend `health` is optional (bomber gets +2, and `regen` heals it up to that legend HP while flying). AA prefers bombers (`findAirTarget`), fires its missile salvo one by one; homing rockets retarget in a cone ahead when they miss (`Projectile.retargetRocket`).
Promotion effect: `spawnLegendEffect` (beam, ring, `Banner`, slow-motion via `battle.slowTimer`). Nuke: `Projectile.detonateNuke` → `spawnNuclearExplosion` (flash via `battle.flash`).

## Helicopters
Live in `battle.planes` (pool order `PLANE_KINDS`: fighter, bomber, heli), so AA, fighter guns, missiles and `damagePlanesArea` hit them like any plane; falling/respawn reuse `Plane`. Tunables: `PLANE_STATS.heli` and `HELI_*` in config. Target priority: enemy heli in `HELI_AIR_RANGE` → ground unit in `HELI_GUN_RANGE` (any lane) → other plane. Fighters pursue enemy bombers first, then helicopters (`Plane.findPursuitTarget`). Crash damage per kind: `PLANE_STATS[kind].crashRadius` / `crashDamage`. Player mode (`player.mode === 'heli'`): `Helicopter.updatePlayer` — follows the cursor on a leash (`HELI_PLAYER_LEASH`; closer = hovers in place) via `Movement.steerHeli`, turret aims at the cursor, LMB = `fireMinigun` (continuous, no burst pauses), RMB = legend `startSalvo` straight at the cursor point; bullet lane from `playerAimLane` (unit along the turret), rocket lane from `cursorLane` (enemy under the cursor, else lane nearest the cursor). Back under AI the heli resumes burst fire.

## Settings
Key `2` toggles the settings panel (`settings.js`, `settingsPanel`): one slider per entity from `ENTITY_SETTINGS` (0 … `defaultCount * ENTITY_COUNT_MAX_FACTOR`). Values live in `settings.counts`; `battle.applySettings()` applies them. Ground units: cap on alive units per type, checked in `GroundUnit.deploy`, excess removed at once. Planes: pool is sized for the slider max (fighters then bombers); planes beyond the count get `enabled = false` and stay in `PLANE_RESPAWNING`.

## Where to change X
- Balance numbers → `config.js`
- New unit type → add const + `UNIT_STATS` row (config), sprite in `art.js`, behavior in `ground-unit.js`
- New weapon → config constants, launch in owner entity, behavior branch in `projectile.js`, homing/ballistics in `movement.js`
- Visual effect → `effects.js`

## Player
Key `3` cycles off → first left-team fighter → first bomber → first helicopter → off (`player.cycle()`; `player.mode` null/'fighter'/'bomber'/'heli', off by default); a message fades in at the top (`player.message`, `Art.drawPlayerMode`). F1 shows shortcuts (`help.js`). `player.js` holds mouse state and `player.plane`. `Plane.isPlayer` → `updatePlayer`: flies toward the cursor (`Movement.steerPlayerPlane`), LMB held = `shootGun`, RMB = fighter `firePlayerRockets` (legend only; homing if an enemy plane is in sights, else ground rockets) or bomber `dropPlayerBombs` (carpet, or nuke when legendary). Legend after the usual kills; resets on death like any plane.
