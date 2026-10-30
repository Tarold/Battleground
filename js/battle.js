'use strict';

// Кожна команда на кожній лінії має незалежний таймер підкріплень.
class GroundSpawner {
    constructor(team, lane) {
        this.team = team;
        this.lane = lane;
        this.timer = 0.3 + Math.random() * 3.5;
    }

    update(deltaTime) {
        this.timer -= deltaTime;

        if (this.timer > 0) {
            return;
        }

        const type = GroundUnit.randomType();
        GroundUnit.deploy(this.team, type, this.lane);

        // Різні інтервали та окремий вибір юніта для кожної лінії й команди.
        this.timer = type === INFANTRY
            ? 1.4 + Math.random() * 3.2
            : 2.6 + Math.random() * 4.2;
    }
}

// Увесь стан бою: пули сутностей і спавнери.
const battle = {
    smoke: Array.from({ length: 1000 }, () => new Smoke()),
    projectiles: Array.from({ length: 600 }, () => new Projectile()),
    groundUnits: Array.from({ length: 150 }, () => new GroundUnit()),
    // Пул літаків розрахований на максимум повзунка: спершу винищувачі, потім бомбардувальники.
    planes: ['fighter', 'bomber'].flatMap(kind =>
        Array.from({ length: settings.maxCount(kind) }, (_, index) => new Plane(index, kind === 'bomber'))),
    banners: Array.from({ length: 8 }, () => new Banner()),
    slowTimer: 0,
    flash: 0,
    showScores: false,
    spawners: Array.from({ length: LANE_OFFSETS.length * 2 }, (_, index) =>
        new GroundSpawner(index % 2, Math.floor(index / 2))),

    update(deltaTime, time) {
        for (const spawner of this.spawners) {
            spawner.update(deltaTime);
        }

        for (const plane of this.planes) {
            plane.update(deltaTime, time);
        }

        for (const unit of this.groundUnits) {
            if (unit.active) {
                unit.update(deltaTime);
            }
        }

        for (const projectile of this.projectiles) {
            if (projectile.active) {
                projectile.update(deltaTime);
            }
        }

        for (const smoke of this.smoke) {
            if (smoke.active) {
                smoke.update(deltaTime);
            }
        }

        for (const banner of this.banners) {
            if (banner.active) {
                banner.update(deltaTime);
            }
        }
    },

    render(time) {
        Art.drawBackground();

        // Далекі лінії малюються першими, щоб ближні перекривали їх.
        for (let lane = 0; lane < LANE_OFFSETS.length; lane++) {
            for (const unit of this.groundUnits) {
                if (unit.active && unit.lane === lane) {
                    unit.draw(time);
                }
            }
        }

        for (const smoke of this.smoke) {
            if (smoke.active) {
                smoke.draw();
            }
        }

        for (const projectile of this.projectiles) {
            if (projectile.active) {
                projectile.draw();
            }
        }

        for (const plane of this.planes) {
            if (plane.state !== PLANE_RESPAWNING) {
                plane.draw(time);
            }
        }

        for (const banner of this.banners) {
            if (banner.active) {
                banner.draw();
            }
        }

        if (this.showScores) {
            Art.drawScores([this.topScores(0), this.topScores(1)]);
        }

        if (this.flash > 0) {
            Art.drawFlash(this.flash);
        }
    },

    // Найкращий рахунок по кожному типу сутності команди: kills / потрібно до легенди.
    topScores(team) {
        const rows = UNIT_STATS.map(stats => ({
            name: stats.name, kills: 0, needed: stats.legend.kills, legendary: false
        }));

        for (const kind of ['fighter', 'bomber']) {
            rows.push({
                name: PLANE_STATS[kind].name, kills: 0,
                needed: PLANE_STATS[kind].legend.kills, legendary: false
            });
        }

        for (const unit of this.groundUnits) {
            if (unit.active && unit.team === team) {
                const row = rows[unit.type];
                row.kills = Math.max(row.kills, unit.kills);
                row.legendary = row.legendary || unit.legendary;
            }
        }

        for (const plane of this.planes) {
            if (plane.team === team && plane.state !== PLANE_RESPAWNING) {
                const row = rows[UNIT_STATS.length + (plane.bomber ? 1 : 0)];
                row.kills = Math.max(row.kills, plane.kills);
                row.legendary = row.legendary || plane.legendary;
            }
        }

        return rows;
    },

    // Початкові групи теж відрізняються чисельністю, складом і розташуванням.
    deployInitialForces() {
        for (const plane of this.planes) {
            plane.spawn();
        }

        this.applySettings();

        for (const spawner of this.spawners) {
            const direction = spawner.team === 0 ? 1 : -1;
            const advanceSpace = Math.max(0, world.width * 0.5 - world.basePosition(0) - 45);
            const infantryCount = 2 + Math.floor(Math.random() * 4);
            let advance = 12 + Math.random() * 25;

            for (let index = 0; index < infantryCount; index++) {
                GroundUnit.deploy(
                    spawner.team,
                    INFANTRY,
                    spawner.lane,
                    world.basePosition(spawner.team) + direction * Math.min(advanceSpace, advance)
                );

                advance += 22 + Math.random() * 34;
            }

            if (Math.random() < 0.55) {
                GroundUnit.deploy(spawner.team, GroundUnit.randomType(), spawner.lane);
            }
        }

        for (let team = 0; team < TEAM_COLORS.length; team++) {
            const antiaircraftLane = Math.floor(Math.random() * LANE_OFFSETS.length);
            const artilleryLane = (antiaircraftLane + 1 + Math.floor(Math.random() * 2)) % LANE_OFFSETS.length;

            GroundUnit.deploy(team, ANTIAIRCRAFT, antiaircraftLane);
            GroundUnit.deploy(team, ARTILLERY, artilleryLane);
        }
    },

    // Застосовує повзунки: зайвих юнітів прибирає одразу, літаки вмикає/вимикає по порядку пулу.
    applySettings() {
        UNIT_STATS.forEach((_, type) => {
            let excess = -settings.counts[ENTITY_SETTINGS[type].id];

            for (const unit of this.groundUnits) {
                if (unit.active && unit.type === type) {
                    excess++;

                    if (excess > 0) {
                        unit.active = false;
                    }
                }
            }
        });

        const used = { fighter: 0, bomber: 0 };

        for (const plane of this.planes) {
            const kind = plane.bomber ? 'bomber' : 'fighter';
            const enabled = used[kind]++ < settings.counts[kind];

            if (enabled === plane.enabled) {
                continue;
            }

            plane.enabled = enabled;

            if (!enabled) {
                // Падаючий літак доживає своє, решта зникає одразу.
                if (plane.state === PLANE_FLYING) {
                    plane.state = PLANE_RESPAWNING;
                }
            } else if (plane.state === PLANE_RESPAWNING) {
                plane.respawnTimer = 0.3 + Math.random() * 1.5;
            }
        }
    },

    handleResize() {
        world.resize();

        for (const unit of this.groundUnits) {
            if (unit.active) {
                Movement.keepGroundUnitOnField(unit);
            }
        }

        for (const projectile of this.projectiles) {
            if (projectile.active) {
                projectile.refreshImpactLevel();
            }
        }

        for (const plane of this.planes) {
            if (plane.state === PLANE_FLYING) {
                Movement.keepPlaneOnField(plane);
            }
        }
    }
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();

function loop(now) {
    const deltaTime = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;
    const time = now / 1000;

    // Уповільнення часу при підвищенні до легенди та ядерному вибуху.
    let gameDelta = deltaTime;

    if (battle.slowTimer > 0) {
        battle.slowTimer -= deltaTime;
        gameDelta *= LEGEND_SLOWMO_SCALE;
    }

    battle.flash = Math.max(0, battle.flash - deltaTime * 0.7);

    battle.update(gameDelta, time);
    battle.render(time);

    requestAnimationFrame(loop);
}

window.addEventListener('resize', () => battle.handleResize());

// Клавіша 1 вмикає/вимикає таблицю рахунку до легенди.
window.addEventListener('keydown', event => {
    if (event.key === '1' && !event.repeat) {
        battle.showScores = !battle.showScores;
    }
});

battle.deployInitialForces();
requestAnimationFrame(loop);
