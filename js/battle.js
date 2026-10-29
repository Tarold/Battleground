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
    planes: Array.from({ length: 12 }, (_, index) => new Plane(index)),
    banners: Array.from({ length: 8 }, () => new Banner()),
    slowTimer: 0,
    flash: 0,
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

        if (this.flash > 0) {
            Art.drawFlash(this.flash);
        }
    },

    // Початкові групи теж відрізняються чисельністю, складом і розташуванням.
    deployInitialForces() {
        for (const plane of this.planes) {
            plane.spawn();
        }

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

battle.deployInitialForces();
requestAnimationFrame(loop);
