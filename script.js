'use strict';

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

const canvas = document.getElementById('battlefield');
const context = canvas.getContext('2d');
let width = canvas.width = window.innerWidth;
let height = canvas.height = window.innerHeight;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_COLORS = ['#66c2ff', '#ff7766'];
const SMOKE_CHARACTERS = ['@', '%', '#', '*', '+', ':', '.'];
const GRAVITY = 180;

const INFANTRY = 0;
const TANK = 1;
const ANTIAIRCRAFT = 2;
const ARTILLERY = 3;

const PLANE_FLYING = 0;
const PLANE_FALLING = 1;
const PLANE_RESPAWNING = 2;

const LANE_OFFSETS = [38, 21, 4];
const LANE_SCALES = [0.78, 0.9, 1];

// Параметри наземних юнітів, індекс = тип юніта.
const UNIT_HEALTH = [2, 9, 6, 5];
const UNIT_SPEEDS = [30, 22, 25, 17];
const UNIT_RANGES = [145, 245, 430, 650];
const UNIT_RELOADS = [0.8, 1.65, 0.5, 3.8];
const UNIT_DAMAGE = [1, 3, 2, 6];

const ANTIAIRCRAFT_GROUND_RANGE = 260;
const ARTILLERY_MINIMUM_RANGE = 110;
const ARTILLERY_EXPLOSION_RADIUS = 72;

const PLANE_STATS = {
    fighter: {
        health: 3, speed: 180, turnRate: 3.5, wobble: 0.48,
        trailInterval: 0.04, fireInterval: 0.13,
        halfWidth: 20, halfHeight: 10,
        sprite: '0̳̅=/̸̚', spriteOffsetX: 0
    },
    bomber: {
        health: 7, speed: 125, turnRate: 2.3, wobble: 0.24,
        trailInterval: 0.055, fireInterval: 0.25,
        halfWidth: 28, halfHeight: 13,
        sprite: '0̳̅0̳̅==/̸̚', spriteOffsetX: -15
    }
};

const BOMB_DAMAGE = 7;
const BOMB_RADIUS = 78;
const BOMB_RELOAD = 1.4;
const BOMB_HORIZONTAL_FACTOR = 0.65;
const BOMB_TARGETING_TOLERANCE = 95;
const PLANE_GUN_SPEED = 470;
const PLANE_FALL_GRAVITY = 240;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function planeStats(plane) {
    return plane.bomber ? PLANE_STATS.bomber : PLANE_STATS.fighter;
}

function groundLevel() {
    return height - 60;
}

function laneLevel(lane) {
    return groundLevel() - LANE_OFFSETS[lane];
}

function basePosition(team) {
    const margin = Math.min(115, width * 0.18);
    return team === 0 ? margin : width - margin;
}

// ---------------------------------------------------------------------------
// Object pools and entities
// ---------------------------------------------------------------------------

const smokePool = Array.from({ length: 1000 }, () => ({
    active: false, x: 0, y: 0, velocityX: 0, velocityY: 0,
    life: 0, maximumLife: 1, fire: false
}));

const projectilePool = Array.from({ length: 600 }, () => ({
    active: false, x: 0, y: 0, previousX: 0, previousY: 0,
    velocityX: 0, velocityY: 0, angle: 0, team: 0,
    damage: 1, heavy: false, bomb: false, shell: false,
    gravity: 0, explosionRadius: 0, impactY: 0, life: 0,
    targetLane: -1
}));

const groundPool = Array.from({ length: 150 }, () => ({
    active: false, type: INFANTRY, team: 0, lane: 0,
    x: 0, y: 0, health: 1, reload: 0, animationPhase: 0,
    aimAngle: 0, moving: false
}));

const planes = Array.from({ length: 12 }, (_, index) => ({
    team: index % 2,
    bomber: index % 6 < 2,
    state: PLANE_FLYING, x: 0, y: 0, velocityX: 0, velocityY: 0,
    angle: 0, targetAngle: 0, health: 1,
    reload: 0, bombReload: 0, smokeTimer: 0, respawnTimer: 0,
    phase: Math.random() * 10,
    flightLane: index % LANE_OFFSETS.length,
    crashLane: -1
}));

// Кожна команда на кожній лінії має незалежний таймер підкріплень.
const groundSpawners = Array.from({ length: LANE_OFFSETS.length * 2 }, (_, index) => ({
    team: index % 2,
    lane: Math.floor(index / 2),
    timer: 0.3 + Math.random() * 3.5
}));

let smokeIndex = 0;
let projectileIndex = 0;
let lastTime = performance.now();

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    for (const unit of groundPool) {
        if (unit.active) {
            unit.x = clamp(unit.x, 20, width - 20);
            unit.y = laneLevel(unit.lane);
        }
    }

    for (const projectile of projectilePool) {
        if (projectile.active) {
            projectile.impactY = impactLevel(projectile.targetLane);
        }
    }

    for (const plane of planes) {
        if (plane.state === PLANE_FLYING) {
            plane.x = clamp(plane.x, 30, width - 30);
            plane.y = clamp(plane.y, 35, groundLevel() - 80);
        }
    }
});

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function spawnSmoke(x, y, velocityX, velocityY, fire = false, lifeScale = 1) {
    const smoke = smokePool[smokeIndex];
    smokeIndex = (smokeIndex + 1) % smokePool.length;

    smoke.active = true;
    smoke.x = x + (Math.random() - 0.5) * 4;
    smoke.y = y + (Math.random() - 0.5) * 4;
    smoke.velocityX = velocityX + (Math.random() - 0.5) * 20;
    smoke.velocityY = velocityY - 8 - Math.random() * 18;
    smoke.maximumLife = (0.7 + Math.random() * 0.6) * lifeScale;
    smoke.life = smoke.maximumLife;
    smoke.fire = fire;
}

function spawnExplosion(x, y, count = 22) {
    for (let index = 0; index < count; index++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * 110;

        spawnSmoke(
            x,
            y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 25,
            true,
            1.1
        );
    }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

function destroyGroundUnit(unit) {
    unit.active = false;
    spawnExplosion(unit.x, unit.y, unit.type === INFANTRY ? 8 : 20);
}

function damageGroundUnit(unit, amount) {
    unit.health -= amount;

    if (unit.health <= 0) {
        destroyGroundUnit(unit);
    }
}

function damageArea(x, radius, damage, team, targetLane) {
    if (targetLane < 0) {
        return;
    }

    for (const unit of groundPool) {
        if (!unit.active || unit.team === team || unit.lane !== targetLane) {
            continue;
        }

        const distance = Math.abs(unit.x - x);

        if (distance < radius) {
            damageGroundUnit(unit, damage * (1 - distance / radius * 0.6));
        }
    }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function impactLevel(targetLane) {
    return targetLane >= 0 ? laneLevel(targetLane) : groundLevel();
}

function spawnProjectile({
    x, y, velocityX, velocityY, team, damage,
    heavy = false, bomb = false, shell = false,
    gravity = 0, explosionRadius = 0, targetLane = -1
}) {
    const projectile = projectilePool[projectileIndex];
    projectileIndex = (projectileIndex + 1) % projectilePool.length;

    projectile.active = true;
    projectile.x = x;
    projectile.y = y;
    projectile.previousX = x;
    projectile.previousY = y;
    projectile.velocityX = velocityX;
    projectile.velocityY = velocityY;
    projectile.angle = Math.atan2(velocityY, velocityX);
    projectile.team = team;
    projectile.damage = damage;
    projectile.heavy = heavy;
    projectile.bomb = bomb;
    projectile.shell = shell;
    projectile.gravity = gravity;
    projectile.explosionRadius = explosionRadius;
    projectile.targetLane = targetLane;
    projectile.impactY = impactLevel(targetLane);
    projectile.life = shell || bomb ? 10 : 3;
}

function detonateProjectile(projectile) {
    projectile.active = false;

    if (projectile.explosionRadius > 0) {
        spawnExplosion(projectile.x, projectile.y, projectile.bomb ? 30 : 24);
        damageArea(
            projectile.x,
            projectile.explosionRadius,
            projectile.damage,
            projectile.team,
            projectile.targetLane
        );
    } else {
        spawnExplosion(projectile.x, projectile.y, projectile.heavy ? 8 : 3);
    }
}

// Перетин відрізка руху снаряда з прямокутником (slab method).
function segmentHitsRectangle(projectile, centerX, centerY, halfWidth, halfHeight) {
    let minimumTime = 0;
    let maximumTime = 1;

    const axes = [
        [projectile.previousX, projectile.x - projectile.previousX, centerX, halfWidth],
        [projectile.previousY, projectile.y - projectile.previousY, centerY, halfHeight]
    ];

    for (const [start, movement, center, halfSize] of axes) {
        if (Math.abs(movement) < 0.00001) {
            if (Math.abs(start - center) > halfSize) {
                return false;
            }
        } else {
            const firstTime = (center - halfSize - start) / movement;
            const secondTime = (center + halfSize - start) / movement;
            minimumTime = Math.max(minimumTime, Math.min(firstTime, secondTime));
            maximumTime = Math.min(maximumTime, Math.max(firstTime, secondTime));
        }
    }

    return minimumTime <= maximumTime;
}

function projectileHitsPlane(projectile) {
    for (const plane of planes) {
        if (plane.team === projectile.team || plane.state !== PLANE_FLYING) {
            continue;
        }

        const stats = planeStats(plane);

        if (!segmentHitsRectangle(projectile, plane.x, plane.y, stats.halfWidth, stats.halfHeight)) {
            continue;
        }

        plane.health -= projectile.damage;
        projectile.active = false;

        spawnSmoke(projectile.x, projectile.y, plane.velocityX * 0.3, plane.velocityY * 0.3, true, 0.6);

        if (plane.health <= 0) {
            plane.state = PLANE_FALLING;
            plane.smokeTimer = 0;
            // Лінія падіння фіксується один раз і більше не змінюється.
            plane.crashLane = plane.flightLane;
            spawnExplosion(plane.x, plane.y, 16);
        }

        return true;
    }

    return false;
}

function projectileHitsGroundUnit(projectile) {
    for (const unit of groundPool) {
        if (!unit.active || unit.team === projectile.team ||
            unit.lane !== projectile.targetLane) {
            continue;
        }

        const unitScale = LANE_SCALES[unit.lane];
        const halfWidth = (unit.type === INFANTRY ? 8 : 23) * unitScale;
        const halfHeight = (unit.type === INFANTRY ? 8 : 10) * unitScale;

        if (!segmentHitsRectangle(projectile, unit.x, unit.y - 6, halfWidth, halfHeight)) {
            continue;
        }

        if (projectile.explosionRadius > 0) {
            projectile.x = unit.x;
            projectile.y = unit.y - 6;
            detonateProjectile(projectile);
        } else {
            projectile.active = false;
            spawnSmoke(projectile.x, projectile.y, 0, -20, true, 0.5);
            damageGroundUnit(unit, projectile.damage);
        }

        return true;
    }

    return false;
}

function updateProjectile(projectile, deltaTime) {
    projectile.life -= deltaTime;

    if (projectile.life <= 0 ||
        projectile.x < -100 || projectile.x > width + 100 ||
        projectile.y > height + 100) {
        projectile.active = false;
        return;
    }

    projectile.previousX = projectile.x;
    projectile.previousY = projectile.y;
    projectile.x += projectile.velocityX * deltaTime;
    projectile.y += projectile.velocityY * deltaTime + projectile.gravity * deltaTime * deltaTime * 0.5;
    projectile.velocityY += projectile.gravity * deltaTime;
    projectile.angle = Math.atan2(projectile.velocityY, projectile.velocityX);

    if (projectileHitsPlane(projectile) || projectileHitsGroundUnit(projectile)) {
        return;
    }

    if (projectile.velocityY >= 0 && projectile.y >= projectile.impactY) {
        projectile.y = projectile.impactY;
        detonateProjectile(projectile);
    }
}

function updateProjectiles(deltaTime) {
    for (const projectile of projectilePool) {
        if (projectile.active) {
            updateProjectile(projectile, deltaTime);
        }
    }
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

function updateSmoke(deltaTime) {
    for (const smoke of smokePool) {
        if (!smoke.active) {
            continue;
        }

        smoke.life -= deltaTime;

        if (smoke.life <= 0) {
            smoke.active = false;
            continue;
        }

        smoke.x += smoke.velocityX * deltaTime;
        smoke.y += smoke.velocityY * deltaTime;
    }
}

// ---------------------------------------------------------------------------
// Ground units
// ---------------------------------------------------------------------------

function spawnGroundUnit(team, type, lane, initialPosition = null) {
    const unit = groundPool.find(candidate => !candidate.active);

    if (!unit) {
        return;
    }

    unit.active = true;
    unit.team = team;
    unit.type = type;
    unit.lane = lane;
    unit.x = initialPosition === null
        ? basePosition(team) + (Math.random() - 0.5) * 18
        : initialPosition;
    unit.y = laneLevel(lane);
    unit.health = UNIT_HEALTH[type];
    unit.reload = 0.3 + Math.random();
    unit.animationPhase = Math.random() * 10;
    unit.aimAngle = team === 0 ? -0.7 : -Math.PI + 0.7;
    unit.moving = false;
}

function randomGroundType() {
    const randomChoice = Math.random();

    if (randomChoice > 0.9) {
        return ARTILLERY;
    }

    if (randomChoice > 0.76) {
        return ANTIAIRCRAFT;
    }

    if (randomChoice > 0.56) {
        return TANK;
    }

    return INFANTRY;
}

function updateGroundSpawners(deltaTime) {
    for (const spawner of groundSpawners) {
        spawner.timer -= deltaTime;

        if (spawner.timer > 0) {
            continue;
        }

        const type = randomGroundType();
        spawnGroundUnit(spawner.team, type, spawner.lane);

        // Різні інтервали та окремий вибір юніта для кожної лінії й команди.
        spawner.timer = type === INFANTRY
            ? 1.4 + Math.random() * 3.2
            : 2.6 + Math.random() * 4.2;
    }
}

function findGroundTarget(unit, range, minimumDistance = 0) {
    let nearestTarget = null;
    let nearestDistance = range;

    for (const enemy of groundPool) {
        if (!enemy.active || enemy.team === unit.team || enemy.lane !== unit.lane) {
            continue;
        }

        const distance = Math.abs(enemy.x - unit.x);

        if (distance >= minimumDistance && distance < nearestDistance) {
            nearestTarget = enemy;
            nearestDistance = distance;
        }
    }

    return nearestTarget;
}

function findAirTarget(unit) {
    let nearestTarget = null;
    let nearestDistance = UNIT_RANGES[ANTIAIRCRAFT];

    for (const plane of planes) {
        if (plane.team === unit.team || plane.state !== PLANE_FLYING) {
            continue;
        }

        const distance = Math.hypot(plane.x - unit.x, plane.y - unit.y);

        if (distance < nearestDistance) {
            nearestTarget = plane;
            nearestDistance = distance;
        }
    }

    return nearestTarget;
}

// Балістична траєкторія артилерії: фіксований час польоту, гравітація діє на снаряд.
function artilleryShot(horizontalDistance, verticalDistance) {
    const flightTime = clamp(Math.abs(horizontalDistance) / 145, 1.25, 3.5);

    return {
        velocityX: horizontalDistance / flightTime,
        velocityY: (verticalDistance - 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
        gravity: GRAVITY,
        explosionRadius: ARTILLERY_EXPLOSION_RADIUS
    };
}

// Пряме влучання зі швидким снарядом; по літаку цілиться з випередженням.
function directShot(unit, target, muzzleY, horizontalDistance, verticalDistance, airborne) {
    const speed = unit.type === ANTIAIRCRAFT ? 430 : 350;
    let aimX = target.x;
    let aimY = target.y - 7;

    if (airborne) {
        const flightTime = Math.hypot(horizontalDistance, verticalDistance) / speed;
        aimX += target.velocityX * flightTime;
        aimY += target.velocityY * flightTime;
    }

    const aimAngle = Math.atan2(aimY - muzzleY, aimX - unit.x);
    const spread = (Math.random() - 0.5) * (unit.type === INFANTRY ? 0.035 : 0.018);

    return {
        velocityX: Math.cos(aimAngle + spread) * speed,
        velocityY: Math.sin(aimAngle + spread) * speed,
        gravity: 0,
        explosionRadius: 0
    };
}

function fireGroundWeapon(unit, target, airborne) {
    const muzzleY = unit.y - (unit.type === INFANTRY ? 7 : 13);
    const horizontalDistance = target.x - unit.x;
    const verticalDistance = target.y - 7 - muzzleY;

    const shot = unit.type === ARTILLERY
        ? artilleryShot(horizontalDistance, verticalDistance)
        : directShot(unit, target, muzzleY, horizontalDistance, verticalDistance, airborne);

    unit.aimAngle = Math.atan2(shot.velocityY, shot.velocityX);
    unit.reload = UNIT_RELOADS[unit.type] + Math.random() * 0.15;

    const muzzleX = unit.x + Math.cos(unit.aimAngle) * 19;
    const heavy = unit.type !== INFANTRY;

    spawnProjectile({
        x: muzzleX,
        y: muzzleY,
        velocityX: shot.velocityX,
        velocityY: shot.velocityY,
        team: unit.team,
        damage: UNIT_DAMAGE[unit.type],
        heavy,
        shell: unit.type === ARTILLERY,
        gravity: shot.gravity,
        explosionRadius: shot.explosionRadius,
        targetLane: airborne ? -1 : target.lane
    });

    spawnSmoke(muzzleX, muzzleY, Math.cos(unit.aimAngle) * 25, -15, heavy, 0.35);
}

function selectGroundTarget(unit) {
    if (unit.type === ANTIAIRCRAFT) {
        const airTarget = findAirTarget(unit);

        if (airTarget) {
            return { target: airTarget, airborne: true };
        }

        return { target: findGroundTarget(unit, ANTIAIRCRAFT_GROUND_RANGE), airborne: false };
    }

    const minimumDistance = unit.type === ARTILLERY ? ARTILLERY_MINIMUM_RANGE : 0;

    return {
        target: findGroundTarget(unit, UNIT_RANGES[unit.type], minimumDistance),
        airborne: false
    };
}

function advanceGroundUnit(unit, deltaTime) {
    const direction = unit.team === 0 ? 1 : -1;
    unit.x += direction * UNIT_SPEEDS[unit.type] * deltaTime;
    unit.moving = true;

    if (unit.x < 25 || unit.x > width - 25) {
        spawnExplosion(unit.x, unit.y, 8);
        unit.active = false;
    }
}

function updateGroundUnits(deltaTime) {
    for (const unit of groundPool) {
        if (!unit.active) {
            continue;
        }

        unit.y = laneLevel(unit.lane);
        unit.reload -= deltaTime;
        unit.moving = false;

        const { target, airborne } = selectGroundTarget(unit);

        if (!target) {
            advanceGroundUnit(unit, deltaTime);
            continue;
        }

        unit.aimAngle = Math.atan2(target.y - unit.y, target.x - unit.x);

        if (unit.reload <= 0) {
            fireGroundWeapon(unit, target, airborne);
        }
    }
}

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

function spawnPlane(plane) {
    const stats = planeStats(plane);

    plane.state = PLANE_FLYING;
    plane.health = stats.health;
    plane.x = basePosition(plane.team);
    plane.y = 55 + Math.random() * Math.max(20, groundLevel() - 180);
    plane.angle = plane.team === 0 ? 0 : Math.PI;
    plane.targetAngle = plane.angle;
    plane.velocityX = Math.cos(plane.angle) * stats.speed;
    plane.velocityY = 0;
    plane.reload = 0.5;
    plane.bombReload = 1.5;
    plane.smokeTimer = 0;
    plane.flightLane = Math.floor(Math.random() * LANE_OFFSETS.length);
    plane.crashLane = -1;
}

function scheduleRespawn(plane) {
    plane.state = PLANE_RESPAWNING;
    plane.respawnTimer = 4 + Math.random() * 2;
}

function updateRespawningPlane(plane, deltaTime) {
    plane.respawnTimer -= deltaTime;

    if (plane.respawnTimer <= 0) {
        spawnPlane(plane);
    }
}

function updateFallingPlane(plane, deltaTime) {
    plane.velocityY += PLANE_FALL_GRAVITY * deltaTime;
    plane.x += plane.velocityX * deltaTime;
    plane.y += plane.velocityY * deltaTime;
    plane.angle = Math.atan2(plane.velocityY, plane.velocityX);
    plane.smokeTimer -= deltaTime;

    if (plane.smokeTimer <= 0) {
        plane.smokeTimer = 0.015;
        spawnSmoke(plane.x, plane.y, -plane.velocityX * 0.2, -plane.velocityY * 0.2, true, 1.2);
    }

    const crashY = laneLevel(plane.crashLane);

    if (plane.y >= crashY - 5) {
        spawnExplosion(plane.x, crashY - 5, 35);
        damageArea(plane.x, 85, 10, -1, plane.crashLane);
        scheduleRespawn(plane);
    } else if (plane.x < -100 || plane.x > width + 100) {
        scheduleRespawn(plane);
    }
}

function steerPlane(plane, deltaTime, time) {
    const floor = groundLevel();
    const horizontalMargin = Math.min(150, width * 0.23);
    const stats = planeStats(plane);

    if (plane.x > width - horizontalMargin) {
        plane.targetAngle = Math.PI;
    } else if (plane.x < horizontalMargin) {
        plane.targetAngle = 0;
    }

    const wave = Math.sin(time * 1.6 + plane.phase) * stats.wobble;
    let desiredAngle = plane.targetAngle + wave;

    if (plane.y > floor - 100) {
        desiredAngle = Math.cos(plane.angle) > 0 ? -0.65 : Math.PI + 0.65;
    } else if (plane.y < 55) {
        desiredAngle = Math.cos(plane.angle) > 0 ? 0.65 : Math.PI - 0.65;
    }

    const angleDifference = Math.atan2(
        Math.sin(desiredAngle - plane.angle),
        Math.cos(desiredAngle - plane.angle)
    );

    plane.angle += angleDifference * deltaTime * stats.turnRate;
}

function movePlane(plane, deltaTime) {
    const stats = planeStats(plane);

    plane.velocityX = Math.cos(plane.angle) * stats.speed;
    plane.velocityY = Math.sin(plane.angle) * stats.speed;
    plane.x += plane.velocityX * deltaTime;
    plane.y += plane.velocityY * deltaTime;
}

function emitPlaneTrail(plane, deltaTime) {
    plane.smokeTimer -= deltaTime;

    if (plane.smokeTimer > 0) {
        return;
    }

    plane.smokeTimer = planeStats(plane).trailInterval;
    spawnSmoke(
        plane.x - Math.cos(plane.angle) * 23,
        plane.y - Math.sin(plane.angle) * 23,
        -plane.velocityX * 0.1,
        -plane.velocityY * 0.1,
        false,
        0.8
    );
}

// Знаходить ціль, на яку впаде бомба з урахуванням руху літака.
function findBombingTarget(plane) {
    let bombingTarget = null;
    let nearestDistance = BOMB_TARGETING_TOLERANCE;

    for (const unit of groundPool) {
        if (!unit.active || unit.team === plane.team || unit.y <= plane.y) {
            continue;
        }

        const fallDistance = Math.max(0, unit.y - plane.y - 10);
        const fallTime = (Math.sqrt(400 + 2 * GRAVITY * fallDistance) - 20) / GRAVITY;
        const landingX = plane.x + plane.velocityX * BOMB_HORIZONTAL_FACTOR * fallTime;
        const distance = Math.abs(unit.x - landingX);

        if (distance < nearestDistance) {
            bombingTarget = unit;
            nearestDistance = distance;
        }
    }

    return bombingTarget;
}

function tryDropBomb(plane) {
    if (!plane.bomber || plane.bombReload > 0) {
        return;
    }

    const bombingTarget = findBombingTarget(plane);

    if (!bombingTarget) {
        return;
    }

    plane.bombReload = BOMB_RELOAD;
    plane.flightLane = bombingTarget.lane;

    spawnProjectile({
        x: plane.x,
        y: plane.y + 10,
        velocityX: plane.velocityX * BOMB_HORIZONTAL_FACTOR,
        velocityY: 20,
        team: plane.team,
        damage: BOMB_DAMAGE,
        heavy: true,
        bomb: true,
        gravity: GRAVITY,
        explosionRadius: BOMB_RADIUS,
        targetLane: bombingTarget.lane
    });
}

function hasEnemyPlaneInSights(plane, forwardX, forwardY) {
    for (const enemy of planes) {
        if (enemy.team === plane.team || enemy.state !== PLANE_FLYING) {
            continue;
        }

        const distanceX = enemy.x - plane.x;
        const distanceY = enemy.y - plane.y;
        const distance = Math.hypot(distanceX, distanceY);

        if (distance > 1 && distance < 350 &&
            (distanceX * forwardX + distanceY * forwardY) / distance > 0.93) {
            return true;
        }
    }

    return false;
}

// Повертає лінію найкраще вирівняної наземної цілі або -1, якщо цілі немає.
function findGroundLaneInSights(plane, forwardX, forwardY) {
    let bestAlignment = 0.94;
    let bestLane = -1;

    for (const unit of groundPool) {
        if (!unit.active || unit.team === plane.team) {
            continue;
        }

        const distanceX = unit.x - plane.x;
        const distanceY = unit.y - 7 - plane.y;
        const distance = Math.hypot(distanceX, distanceY);

        if (distance <= 1 || distance >= 370) {
            continue;
        }

        const alignment = (distanceX * forwardX + distanceY * forwardY) / distance;

        if (alignment > bestAlignment) {
            bestAlignment = alignment;
            bestLane = unit.lane;
        }
    }

    return bestLane;
}

function tryShoot(plane) {
    if (plane.reload > 0) {
        return;
    }

    const forwardX = Math.cos(plane.angle);
    const forwardY = Math.sin(plane.angle);
    let targetLane = -1;

    if (!hasEnemyPlaneInSights(plane, forwardX, forwardY)) {
        targetLane = findGroundLaneInSights(plane, forwardX, forwardY);

        if (targetLane < 0) {
            return;
        }

        plane.flightLane = targetLane;
    }

    plane.reload = planeStats(plane).fireInterval;

    const shotAngle = plane.angle + (Math.random() - 0.5) * 0.045;

    spawnProjectile({
        x: plane.x + forwardX * 25,
        y: plane.y + forwardY * 25,
        velocityX: Math.cos(shotAngle) * PLANE_GUN_SPEED,
        velocityY: Math.sin(shotAngle) * PLANE_GUN_SPEED,
        team: plane.team,
        damage: 1,
        targetLane
    });
}

function updateFlyingPlane(plane, deltaTime, time) {
    steerPlane(plane, deltaTime, time);
    movePlane(plane, deltaTime);
    emitPlaneTrail(plane, deltaTime);

    plane.reload -= deltaTime;
    plane.bombReload -= deltaTime;

    tryDropBomb(plane);
    tryShoot(plane);
}

function updatePlanes(deltaTime, time) {
    for (const plane of planes) {
        if (plane.state === PLANE_RESPAWNING) {
            updateRespawningPlane(plane, deltaTime);
        } else if (plane.state === PLANE_FALLING) {
            updateFallingPlane(plane, deltaTime);
        } else {
            updateFlyingPlane(plane, deltaTime, time);
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawInfantry(unit, direction, time) {
    const step = unit.moving && Math.sin(time * 10 + unit.animationPhase) > 0;
    const head = direction === 1
        ? (step ? 'o/' : 'o-')
        : (step ? '\\o' : '-o');

    context.fillText(head, 0, -5);
    context.fillText(step ? '/\\' : '|\\', 0, 5);
}

function barrelAngleFor(unit, direction) {
    if (!unit.moving) {
        return unit.aimAngle;
    }

    // У русі ствол опущений у похідне положення.
    if (unit.type === ANTIAIRCRAFT) {
        return direction === 1 ? -0.65 : -Math.PI + 0.65;
    }

    if (unit.type === ARTILLERY) {
        return direction === 1 ? -0.45 : -Math.PI + 0.45;
    }

    return direction === 1 ? 0 : Math.PI;
}

function drawVehicle(unit, direction) {
    context.font = 'bold 14px monospace';

    if (unit.type === TANK) {
        context.fillText('[=O=]', 0, -3);
        context.fillText('o===o', 0, 5);
    } else if (unit.type === ANTIAIRCRAFT) {
        context.fillText('[AA]', 0, -4);
        context.fillText('o===o', 0, 5);
    } else {
        context.fillText('[##]', 0, -3);
        context.fillText('O===O', 0, 5);
    }

    const barrelAngle = barrelAngleFor(unit, direction);
    const barrelLength = unit.type === ARTILLERY ? 29 : 22;
    const barrelX = Math.cos(barrelAngle) * barrelLength;
    const barrelY = -12 + Math.sin(barrelAngle) * barrelLength;

    context.lineWidth = unit.type === ARTILLERY ? 3 : 2;
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(barrelX, barrelY);

    if (unit.type === ANTIAIRCRAFT) {
        context.moveTo(5, -12);
        context.lineTo(barrelX + 5, barrelY);
    }

    context.stroke();
}

function drawGroundUnit(unit, time) {
    const direction = unit.team === 0 ? 1 : -1;
    const scale = LANE_SCALES[unit.lane];

    context.save();
    context.translate(unit.x, unit.y);
    context.scale(scale, scale);
    context.globalAlpha = 0.6 + unit.lane * 0.2;
    context.fillStyle = TEAM_COLORS[unit.team];
    context.strokeStyle = TEAM_COLORS[unit.team];
    context.textAlign = 'center';
    context.font = 'bold 13px monospace';

    if (unit.type === INFANTRY) {
        drawInfantry(unit, direction, time);
    } else {
        drawVehicle(unit, direction);
    }

    context.restore();
}

function drawPlane(plane) {
    const stats = planeStats(plane);

    context.save();
    context.translate(plane.x, plane.y);
    context.rotate(plane.angle);

    if (Math.cos(plane.angle) < 0) {
        context.scale(1, -1);
    }

    context.scale(-1, 1);
    context.fillStyle = plane.state === PLANE_FALLING ? '#ff4422' : TEAM_COLORS[plane.team];
    context.textAlign = 'center';
    context.font = 'bold 20px monospace';
    context.fillText(stats.sprite, stats.spriteOffsetX, 6);

    context.restore();
}

function drawBackground() {
    context.fillStyle = '#0c0c10';
    context.fillRect(0, 0, width, height);

    context.strokeStyle = '#3d473d';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, groundLevel() + 9);
    context.lineTo(width, groundLevel() + 9);
    context.stroke();

    context.font = 'bold 14px monospace';
    context.textAlign = 'left';
    context.fillStyle = TEAM_COLORS[0];
    context.fillText('[HQ-ALPHA]', 16, groundLevel() + 33);
    context.textAlign = 'right';
    context.fillStyle = TEAM_COLORS[1];
    context.fillText('[HQ-OMEGA]', width - 16, groundLevel() + 33);
    context.textAlign = 'left';
}

function drawGroundUnits(time) {
    // Далекі лінії малюються першими, щоб ближні перекривали їх.
    for (let lane = 0; lane < LANE_OFFSETS.length; lane++) {
        for (const unit of groundPool) {
            if (unit.active && unit.lane === lane) {
                drawGroundUnit(unit, time);
            }
        }
    }
}

function drawSmoke() {
    context.font = '14px monospace';

    for (const smoke of smokePool) {
        if (!smoke.active) {
            continue;
        }

        const progress = 1 - smoke.life / smoke.maximumLife;
        const characterIndex = Math.min(
            Math.floor(progress * SMOKE_CHARACTERS.length),
            SMOKE_CHARACTERS.length - 1
        );

        context.globalAlpha = smoke.life / smoke.maximumLife * 0.75;

        if (smoke.fire && progress < 0.45) {
            context.fillStyle = progress < 0.2 ? '#ffe65a' : '#ff6e28';
        } else {
            context.fillStyle = '#9ba0aa';
            context.globalAlpha *= 0.7;
        }

        context.fillText(SMOKE_CHARACTERS[characterIndex], smoke.x, smoke.y);
    }

    context.globalAlpha = 1;
}

function projectileSymbol(projectile) {
    if (projectile.bomb) {
        return '<●>';
    }

    if (projectile.shell) {
        return '●';
    }

    return projectile.heavy ? '•' : '-';
}

function projectileColor(projectile) {
    if (projectile.bomb) {
        return '#ff9933';
    }

    return projectile.heavy ? '#ffd966' : '#ffffff';
}

function drawProjectiles() {
    context.font = 'bold 15px monospace';

    for (const projectile of projectilePool) {
        if (!projectile.active) {
            continue;
        }

        context.save();
        context.translate(projectile.x, projectile.y);
        context.rotate(projectile.angle);
        context.fillStyle = projectileColor(projectile);
        context.fillText(projectileSymbol(projectile), -4, 4);
        context.restore();
    }
}

function drawPlanes() {
    for (const plane of planes) {
        if (plane.state !== PLANE_RESPAWNING) {
            drawPlane(plane);
        }
    }
}

function render(time) {
    drawBackground();
    drawGroundUnits(time);
    drawSmoke();
    drawProjectiles();
    drawPlanes();
}

// ---------------------------------------------------------------------------
// Setup and main loop
// ---------------------------------------------------------------------------

// Початкові групи теж відрізняються чисельністю, складом і розташуванням.
function deployInitialGroundForces() {
    for (const spawner of groundSpawners) {
        const direction = spawner.team === 0 ? 1 : -1;
        const advanceSpace = Math.max(0, width * 0.5 - basePosition(0) - 45);
        const infantryCount = 2 + Math.floor(Math.random() * 4);
        let advance = 12 + Math.random() * 25;

        for (let index = 0; index < infantryCount; index++) {
            spawnGroundUnit(
                spawner.team,
                INFANTRY,
                spawner.lane,
                basePosition(spawner.team) + direction * Math.min(advanceSpace, advance)
            );

            advance += 22 + Math.random() * 34;
        }

        if (Math.random() < 0.55) {
            spawnGroundUnit(spawner.team, randomGroundType(), spawner.lane);
        }
    }

    for (let team = 0; team < TEAM_COLORS.length; team++) {
        const antiaircraftLane = Math.floor(Math.random() * LANE_OFFSETS.length);
        const artilleryLane = (antiaircraftLane + 1 + Math.floor(Math.random() * 2)) % LANE_OFFSETS.length;

        spawnGroundUnit(team, ANTIAIRCRAFT, antiaircraftLane);
        spawnGroundUnit(team, ARTILLERY, artilleryLane);
    }
}

function loop(now) {
    const deltaTime = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;
    const time = now / 1000;

    updateGroundSpawners(deltaTime);
    updatePlanes(deltaTime, time);
    updateGroundUnits(deltaTime);
    updateProjectiles(deltaTime);
    updateSmoke(deltaTime);
    render(time);

    requestAnimationFrame(loop);
}

planes.forEach(spawnPlane);
deployInitialGroundForces();
requestAnimationFrame(loop);
