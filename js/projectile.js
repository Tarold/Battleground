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
        this.shell = false;
        this.gravity = 0;
        this.explosionRadius = 0;
        this.impactY = 0;
        this.life = 0;
        this.targetLane = -1;
    }

    // Бере наступний снаряд із кільцевого пулу та запускає його.
    static fire(options) {
        const projectile = battle.projectiles[Projectile.nextIndex];
        Projectile.nextIndex = (Projectile.nextIndex + 1) % battle.projectiles.length;
        projectile.launch(options);
    }

    launch({
        x, y, velocityX, velocityY, team, damage,
        heavy = false, bomb = false, shell = false,
        gravity = 0, explosionRadius = 0, targetLane = -1
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
        this.shell = shell;
        this.gravity = gravity;
        this.explosionRadius = explosionRadius;
        this.targetLane = targetLane;
        this.impactY = world.impactLevel(targetLane);
        this.life = shell || bomb ? 10 : 3;
    }

    update(deltaTime) {
        this.life -= deltaTime;

        if (this.life <= 0 || Movement.isProjectileOutOfBounds(this)) {
            this.active = false;
            return;
        }

        Movement.stepProjectile(this, deltaTime);

        if (this.hitPlane() || this.hitGroundUnit()) {
            return;
        }

        if (this.velocityY >= 0 && this.y >= this.impactY) {
            this.y = this.impactY;
            this.detonate();
        }
    }

    hitPlane() {
        for (const plane of battle.planes) {
            if (plane.team === this.team || plane.state !== PLANE_FLYING) {
                continue;
            }

            const stats = plane.stats;

            if (!segmentHitsRectangle(this, plane.x, plane.y, stats.halfWidth, stats.halfHeight)) {
                continue;
            }

            this.active = false;
            spawnSmoke(this.x, this.y, plane.velocityX * 0.3, plane.velocityY * 0.3, true, 0.6);
            plane.takeDamage(this.damage);

            return true;
        }

        return false;
    }

    hitGroundUnit() {
        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team || unit.lane !== this.targetLane) {
                continue;
            }

            const scale = LANE_SCALES[unit.lane];
            const halfWidth = (unit.type === INFANTRY ? 8 : 23) * scale;
            const halfHeight = (unit.type === INFANTRY ? 8 : 10) * scale;

            if (!segmentHitsRectangle(this, unit.x, unit.y - 6, halfWidth, halfHeight)) {
                continue;
            }

            if (this.explosionRadius > 0) {
                this.x = unit.x;
                this.y = unit.y - 6;
                this.detonate();
            } else {
                this.active = false;
                spawnSmoke(this.x, this.y, 0, -20, true, 0.5);
                unit.takeDamage(this.damage);
            }

            return true;
        }

        return false;
    }

    detonate() {
        this.active = false;

        if (this.explosionRadius > 0) {
            spawnExplosion(this.x, this.y, this.bomb ? 30 : 24);

            if (this.bomb) {
                spawnBombCloud(this.x, this.y);
            }

            damageArea(this.x, this.explosionRadius, this.damage, this.team, this.targetLane);
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
