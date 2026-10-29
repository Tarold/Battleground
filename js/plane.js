'use strict';

class Plane {
    constructor(index) {
        this.team = index % 2;
        this.bomber = index % 6 < 2;
        this.state = PLANE_FLYING;
        this.x = 0;
        this.y = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.angle = 0;
        this.targetAngle = 0;
        this.health = 1;
        this.reload = 0;
        this.bombReload = 0;
        this.smokeTimer = 0;
        this.respawnTimer = 0;
        this.phase = Math.random() * 10;
        this.flightLane = index % LANE_OFFSETS.length;
        this.crashLane = -1;
    }

    get stats() {
        return this.bomber ? PLANE_STATS.bomber : PLANE_STATS.fighter;
    }

    spawn() {
        const stats = this.stats;

        this.state = PLANE_FLYING;
        this.health = stats.health;
        this.x = world.basePosition(this.team);
        this.y = 55 + Math.random() * Math.max(20, world.groundLevel() - 180);
        this.angle = this.team === 0 ? 0 : Math.PI;
        this.targetAngle = this.angle;
        this.velocityX = Math.cos(this.angle) * stats.speed;
        this.velocityY = 0;
        this.reload = 0.5;
        this.bombReload = 1.5;
        this.smokeTimer = 0;
        this.flightLane = Math.floor(Math.random() * LANE_OFFSETS.length);
        this.crashLane = -1;
    }

    takeDamage(amount) {
        this.health -= amount;

        if (this.health <= 0) {
            this.state = PLANE_FALLING;
            this.smokeTimer = 0;
            // Лінія падіння фіксується один раз і більше не змінюється.
            this.crashLane = this.flightLane;
            spawnExplosion(this.x, this.y, 16);
        }
    }

    scheduleRespawn() {
        this.state = PLANE_RESPAWNING;
        this.respawnTimer = 4 + Math.random() * 2;
    }

    update(deltaTime, time) {
        if (this.state === PLANE_RESPAWNING) {
            this.updateRespawning(deltaTime);
        } else if (this.state === PLANE_FALLING) {
            this.updateFalling(deltaTime);
        } else {
            this.updateFlying(deltaTime, time);
        }
    }

    updateRespawning(deltaTime) {
        this.respawnTimer -= deltaTime;

        if (this.respawnTimer <= 0) {
            this.spawn();
        }
    }

    updateFalling(deltaTime) {
        Movement.fallPlane(this, deltaTime);
        this.smokeTimer -= deltaTime;

        if (this.smokeTimer <= 0) {
            this.smokeTimer = 0.015;
            spawnSmoke(this.x, this.y, -this.velocityX * 0.2, -this.velocityY * 0.2, true, 1.2);
        }

        const crashY = world.laneLevel(this.crashLane);

        if (this.y >= crashY - 5) {
            spawnExplosion(this.x, crashY - 5, 35);
            damageArea(this.x, 85, 10, -1, this.crashLane);
            this.scheduleRespawn();
        } else if (Movement.isPlaneOutsideField(this)) {
            this.scheduleRespawn();
        }
    }

    updateFlying(deltaTime, time) {
        Movement.steerPlane(this, deltaTime, time);
        Movement.flyPlane(this, deltaTime);
        this.emitTrail(deltaTime);

        this.reload -= deltaTime;
        this.bombReload -= deltaTime;

        this.tryDropBomb();
        this.tryShoot();
    }

    emitTrail(deltaTime) {
        this.smokeTimer -= deltaTime;

        if (this.smokeTimer > 0) {
            return;
        }

        this.smokeTimer = this.stats.trailInterval;
        spawnSmoke(
            this.x - Math.cos(this.angle) * 23,
            this.y - Math.sin(this.angle) * 23,
            -this.velocityX * 0.1,
            -this.velocityY * 0.1,
            false,
            0.8
        );
    }

    // --- Bombing -----------------------------------------------------------

    // Знаходить ціль, на яку впаде бомба з урахуванням руху літака.
    findBombingTarget() {
        let bombingTarget = null;
        let nearestDistance = BOMB_TARGETING_TOLERANCE;

        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team || unit.y <= this.y) {
                continue;
            }

            const distance = Math.abs(unit.x - Movement.bombLandingX(this, unit.y));

            if (distance < nearestDistance) {
                bombingTarget = unit;
                nearestDistance = distance;
            }
        }

        return bombingTarget;
    }

    tryDropBomb() {
        if (!this.bomber || this.bombReload > 0) {
            return;
        }

        const bombingTarget = this.findBombingTarget();

        if (!bombingTarget) {
            return;
        }

        this.bombReload = BOMB_RELOAD;
        this.flightLane = bombingTarget.lane;

        Projectile.fire({
            x: this.x,
            y: this.y + 10,
            velocityX: this.velocityX * BOMB_HORIZONTAL_FACTOR,
            velocityY: 20,
            team: this.team,
            damage: BOMB_DAMAGE,
            heavy: true,
            bomb: true,
            gravity: GRAVITY,
            explosionRadius: BOMB_RADIUS,
            targetLane: bombingTarget.lane
        });
    }

    // --- Machine gun -------------------------------------------------------

    hasEnemyPlaneInSights() {
        for (const enemy of battle.planes) {
            if (enemy.team === this.team || enemy.state !== PLANE_FLYING) {
                continue;
            }

            const { distance, alignment } = Movement.alignment(this, enemy.x, enemy.y);

            if (distance > 1 && distance < 350 && alignment > 0.93) {
                return true;
            }
        }

        return false;
    }

    // Повертає лінію найкраще вирівняної наземної цілі або -1, якщо цілі немає.
    findGroundLaneInSights() {
        let bestAlignment = 0.94;
        let bestLane = -1;

        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team) {
                continue;
            }

            const { distance, alignment } = Movement.alignment(this, unit.x, unit.y - 7);

            if (distance <= 1 || distance >= 370) {
                continue;
            }

            if (alignment > bestAlignment) {
                bestAlignment = alignment;
                bestLane = unit.lane;
            }
        }

        return bestLane;
    }

    tryShoot() {
        if (this.reload > 0) {
            return;
        }

        let targetLane = -1;

        if (!this.hasEnemyPlaneInSights()) {
            targetLane = this.findGroundLaneInSights();

            if (targetLane < 0) {
                return;
            }

            this.flightLane = targetLane;
        }

        this.reload = this.stats.fireInterval;

        const forwardX = Math.cos(this.angle);
        const forwardY = Math.sin(this.angle);
        const shotAngle = this.angle + (Math.random() - 0.5) * 0.045;

        Projectile.fire({
            x: this.x + forwardX * 25,
            y: this.y + forwardY * 25,
            velocityX: Math.cos(shotAngle) * PLANE_GUN_SPEED,
            velocityY: Math.sin(shotAngle) * PLANE_GUN_SPEED,
            team: this.team,
            damage: 1,
            targetLane
        });
    }

    draw() {
        Art.drawPlane(this);
    }
}
