'use strict';

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

class Projectile {
    constructor() {
        this.active = false;
        this.x = 0;
        this.y = 0;
        this.previousX = 0;
        this.previousY = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.angle = 0;
        this.team = 0;
        this.damage = 1;
        this.heavy = false;
        this.bomb = false;
        this.nuke = false;
        this.owner = null;
        this.ownerGeneration = 0;
        this.shell = false;
        this.rocket = false;
        this.big = false;
        this.homingTarget = null;
        this.turnRate = 0;
        this.age = 0;
        this.speed = 0;
        this.planeBlastRadius = 0;
        this.trailTimer = 0;
        this.gravity = 0;
        this.explosionRadius = 0;
        this.impactY = 0;
        this.life = 0;
        this.targetLane = -1;
        // Скільки ще ворогів прошиє бронебійний снаряд і кого вже прошив (щоб не бити двічі).
        this.pierce = 0;
        this.pierced = [];
    }

    // Бере наступний снаряд із кільцевого пулу та запускає його.
    static fire(options) {
        const projectile = battle.projectiles[Projectile.nextIndex];
        Projectile.nextIndex = (Projectile.nextIndex + 1) % battle.projectiles.length;
        projectile.launch(options);
    }

    launch({
        x, y, velocityX, velocityY, team, damage,
        heavy = false, bomb = false, nuke = false, owner = null, shell = false,
        rocket = false, big = false, homingTarget = null, turnRate = 0,
        planeBlastRadius = 0, life = null,
        gravity = 0, explosionRadius = 0, targetLane = -1, pierce = 0
    }) {
        this.active = true;
        this.x = x;
        this.y = y;
        this.previousX = x;
        this.previousY = y;
        this.velocityX = velocityX;
        this.velocityY = velocityY;
        this.angle = Math.atan2(velocityY, velocityX);
        this.team = team;
        this.damage = damage;
        this.heavy = heavy;
        this.bomb = bomb;
        this.nuke = nuke;
        this.owner = owner;
        this.ownerGeneration = owner?.generation;
        this.shell = shell;
        this.rocket = rocket;
        this.big = big;
        this.homingTarget = homingTarget;
        this.turnRate = turnRate;
        this.age = 0;
        this.speed = Math.hypot(velocityX, velocityY);
        this.planeBlastRadius = planeBlastRadius;
        this.trailTimer = 0;
        this.gravity = gravity;
        this.explosionRadius = explosionRadius;
        this.targetLane = targetLane;
        this.pierce = pierce;
        this.pierced.length = 0;
        this.impactY = world.impactLevel(targetLane);
        this.life = life ?? (shell || bomb ? 10 : 3);
    }

    // Власник пострілу або null, якщо його слот у пулі вже зайняла інша сутність.
    get liveOwner() {
        return this.owner?.generation === this.ownerGeneration ? this.owner : null;
    }

    update(deltaTime) {
        this.life -= deltaTime;

        if (this.life <= 0 && this.rocket) {
            this.detonate();
            return;
        }

        if (this.life <= 0 || Movement.isProjectileOutOfBounds(this)) {
            this.active = false;
            return;
        }

        if (this.rocket) {
            this.age += deltaTime;

            if (this.planeBlastRadius > 0 && this.turnRate > 0) {
                this.retargetRocket();
            }

            Movement.guideRocket(this, deltaTime);
        }

        Movement.stepProjectile(this, deltaTime);

        // Шлейф після кроку, щоб брати вже оновлений кут і позицію (інакше полум'я відстає на повороті).
        if (this.rocket) {
            this.emitRocketTrail(deltaTime);
        }

        if (this.hitPlane() || this.hitGroundUnit()) {
            return;
        }

        if (this.velocityY >= 0 && this.y >= this.impactY) {
            this.y = this.impactY;
            this.detonate();
        }
    }

    // Самонавідна ракета, що промахнулась (ціль збита або лишилась позаду),
    // шукає нову ворожу ціль у конусі перед собою.
    retargetRocket() {
        const target = this.homingTarget;

        if (target && target.state === PLANE_FLYING &&
            (this.age < ROCKET_MISS_GRACE || this.coneAlignment(target) > 0)) {
            return;
        }

        let bestAlignment = ROCKET_RETARGET_CONE;
        let bestPlane = null;

        for (const plane of battle.planes) {
            if (plane.team === this.team || plane.state !== PLANE_FLYING) {
                continue;
            }

            if (Math.hypot(plane.x - this.x, plane.y - this.y) > ROCKET_RETARGET_RANGE) {
                continue;
            }

            const alignment = this.coneAlignment(plane);

            if (alignment > bestAlignment) {
                bestAlignment = alignment;
                bestPlane = plane;
            }
        }

        this.homingTarget = bestPlane;
    }

    // Косинус кута між курсом ракети та напрямком на ціль.
    coneAlignment(target) {
        const distanceX = target.x - this.x;
        const distanceY = target.y - this.y;
        const distance = Math.hypot(distanceX, distanceY);

        if (distance < 1) {
            return 1;
        }

        return (distanceX * this.velocityX + distanceY * this.velocityY) / (distance * this.speed);
    }

    emitRocketTrail(deltaTime) {
        this.trailTimer -= deltaTime;

        if (this.trailTimer > 0) {
            return;
        }

        this.trailTimer = this.big ? 0.02 : 0.035;
        spawnSmoke(
            this.x - Math.cos(this.angle) * 10,
            this.y - Math.sin(this.angle) * 10,
            0, 0, true, this.big ? 0.9 : 0.6
        );
    }

    hitPlane() {
        for (const plane of battle.planes) {
            if (plane.team === this.team || plane.state !== PLANE_FLYING) {
                continue;
            }

            // Ракета з бойовою частиною проти літаків має радіо-підрив поблизу цілі.
            if (this.rocket && this.planeBlastRadius > 0) {
                if (Math.hypot(plane.x - this.x, plane.y - this.y) < this.planeBlastRadius * 0.55) {
                    this.detonate();
                    return true;
                }

                continue;
            }

            const stats = plane.stats;

            if (!segmentHitsRectangle(this, plane.x, plane.y, stats.halfWidth, stats.halfHeight)) {
                continue;
            }

            this.active = false;
            spawnSmoke(this.x, this.y, plane.velocityX * 0.3, plane.velocityY * 0.3, true, 0.6);
            plane.takeDamage(this.damage, this.liveOwner);

            return true;
        }

        return false;
    }

    hitGroundUnit() {
        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team || unit.lane !== this.targetLane ||
                this.pierced.includes(unit)) {
                continue;
            }

            const scale = LANE_SCALES[unit.lane];
            const vehicleHalfWidth = unit.type === TANK && unit.legendary ? HEAVY_TANK_HIT_HALF_WIDTH : 23;
            const halfWidth = (unit.prone ? PRONE_HIT_HALF_WIDTH : unit.type === INFANTRY ? 8 : vehicleHalfWidth) * scale;
            const halfHeight = (unit.prone ? PRONE_HIT_HALF_HEIGHT : unit.type === INFANTRY ? 8 : 10) * scale;
            const centerY = unit.y - (unit.prone ? 3 : 6);

            if (!segmentHitsRectangle(this, unit.x, centerY, halfWidth, halfHeight)) {
                continue;
            }

            if (this.explosionRadius > 0) {
                this.x = unit.x;
                this.y = centerY;
                this.detonate();
            } else if (this.pierce > 0) {
                this.pierceThrough(unit);
            } else {
                this.active = false;
                spawnSmoke(this.x, this.y, 0, -20, true, 0.5);
                unit.takeDamage(this.damage, this.liveOwner);
            }

            return true;
        }

        return false;
    }

    // Бронебійний снаряд проходить крізь ціль і летить далі горизонтально, до наступного ворога на лінії.
    pierceThrough(unit) {
        this.pierce--;
        this.pierced.push(unit);
        this.velocityY = 0;
        this.angle = this.velocityX > 0 ? 0 : Math.PI;
        spawnExplosion(this.x, this.y, 8);
        spawnSmoke(this.x, this.y, this.velocityX * 0.1, -20, true, 0.6);
        unit.takeDamage(this.damage, this.liveOwner);
    }

    detonateRocket() {
        spawnExplosion(this.x, this.y, this.big ? 36 : 16);

        if (this.big) {
            spawnBombCloud(this.x, this.y, 0.4);
        }

        if (this.planeBlastRadius > 0) {
            damagePlanesArea(this.x, this.y, this.planeBlastRadius, this.damage, this.team, this.liveOwner);
        }

        if (this.explosionRadius > 0) {
            damageArea(this.x, this.explosionRadius, this.damage, this.team, this.targetLane, this.liveOwner);
        }
    }

    // Ядерна бомба б'є по всіх лініях і по літаках, без поділу на своїх і чужих.
    detonateNuke() {
        spawnNuclearExplosion(this.x, this.y);

        for (let lane = 0; lane < LANE_OFFSETS.length; lane++) {
            damageArea(this.x, NUKE_RADIUS, NUKE_DAMAGE, -1, lane, this.liveOwner);
        }

        damagePlanesArea(this.x, this.y, NUKE_RADIUS, NUKE_DAMAGE, -1, this.liveOwner);
    }

    detonate() {
        this.active = false;

        if (this.nuke) {
            this.detonateNuke();
            return;
        }

        if (this.rocket) {
            this.detonateRocket();
            return;
        }

        if (this.explosionRadius > 0) {
            spawnExplosion(this.x, this.y, this.bomb ? 30 : 24);

            if (this.bomb) {
                spawnBombCloud(this.x, this.y, 0.45);
            }

            damageArea(this.x, this.explosionRadius, this.damage, this.team, this.targetLane, this.liveOwner);
        } else {
            spawnExplosion(this.x, this.y, this.heavy ? 8 : 3);
        }
    }

    // Після зміни розмірів вікна лінія землі зсувається.
    refreshImpactLevel() {
        this.impactY = world.impactLevel(this.targetLane);
    }

    draw() {
        Art.drawProjectile(this);
    }
}

Projectile.nextIndex = 0;
