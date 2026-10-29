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
        this.rocketReload = 0;
        this.carpetBombsLeft = 0;
        this.carpetTimer = 0;
        this.carpetLane = 0;
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
        this.rocketReload = 2 + Math.random() * 2;
        this.carpetBombsLeft = 0;
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
        this.rocketReload -= deltaTime;

        this.tryDropBomb(deltaTime);
        this.tryLaunchRocket();
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

    // Бомбардувальник, помітивши ціль, скидає серію бомб уздовж курсу.
    tryDropBomb(deltaTime) {
        if (!this.bomber) {
            return;
        }

        if (this.carpetBombsLeft > 0) {
            this.continueCarpetBombing(deltaTime);
            return;
        }

        if (this.bombReload > 0) {
            return;
        }

        const bombingTarget = this.findBombingTarget();

        if (!bombingTarget) {
            return;
        }

        this.carpetBombsLeft = CARPET_BOMB_COUNT;
        this.carpetTimer = 0;
        this.carpetLane = bombingTarget.lane;
        this.flightLane = bombingTarget.lane;
    }

    continueCarpetBombing(deltaTime) {
        this.carpetTimer -= deltaTime;

        if (this.carpetTimer > 0) {
            return;
        }

        this.carpetTimer = CARPET_BOMB_INTERVAL;
        this.carpetBombsLeft--;

        if (this.carpetBombsLeft === 0) {
            this.bombReload = CARPET_RELOAD;
        }

        Projectile.fire({
            x: this.x,
            y: this.y + 10,
            velocityX: this.velocityX * BOMB_HORIZONTAL_FACTOR,
            velocityY: 20,
            team: this.team,
            damage: CARPET_BOMB_DAMAGE,
            heavy: true,
            bomb: true,
            gravity: GRAVITY,
            explosionRadius: CARPET_BOMB_RADIUS,
            targetLane: this.carpetLane
        });
    }

    // --- Rockets -----------------------------------------------------------

    // Винищувач пускає самонавідну ракету по літаку або пряму по наземній цілі.
    tryLaunchRocket() {
        if (this.bomber || this.rocketReload > 0) {
            return;
        }

        const enemyPlane = this.findPlaneInSights(AIR_ROCKET_RANGE, 0.88);
        let targetLane = -1;

        if (!enemyPlane) {
            targetLane = this.findGroundLaneInSights(GROUND_ROCKET_RANGE, 0.85);

            if (targetLane < 0) {
                return;
            }

            this.flightLane = targetLane;
        }

        this.rocketReload = this.stats.rocketReload + Math.random();

        const forwardX = Math.cos(this.angle);
        const forwardY = Math.sin(this.angle);
        const airToAir = enemyPlane !== null;

        Projectile.fire({
            x: this.x + forwardX * 25,
            y: this.y + forwardY * 25,
            velocityX: this.velocityX + forwardX * ROCKET_LAUNCH_SPEED,
            velocityY: this.velocityY + forwardY * ROCKET_LAUNCH_SPEED,
            team: this.team,
            damage: airToAir ? AIR_ROCKET_DAMAGE : GROUND_ROCKET_DAMAGE,
            heavy: true,
            rocket: true,
            homingTarget: enemyPlane,
            turnRate: airToAir ? AIR_ROCKET_TURN_RATE : 0,
            planeBlastRadius: airToAir ? AIR_ROCKET_BLAST_RADIUS : 0,
            explosionRadius: airToAir ? 0 : GROUND_ROCKET_RADIUS,
            life: 4,
            targetLane
        });
    }

    // --- Machine gun -------------------------------------------------------

    // Найкраще вирівняний ворожий літак у секторі прицілу або null.
    findPlaneInSights(maximumDistance, minimumAlignment) {
        let bestAlignment = minimumAlignment;
        let bestPlane = null;

        for (const enemy of battle.planes) {
            if (enemy.team === this.team || enemy.state !== PLANE_FLYING) {
                continue;
            }

            const { distance, alignment } = Movement.alignment(this, enemy.x, enemy.y);

            if (distance > 1 && distance < maximumDistance && alignment > bestAlignment) {
                bestAlignment = alignment;
                bestPlane = enemy;
            }
        }

        return bestPlane;
    }

    // Повертає лінію найкраще вирівняної наземної цілі або -1, якщо цілі немає.
    findGroundLaneInSights(maximumDistance = 370, minimumAlignment = 0.94) {
        let bestAlignment = minimumAlignment;
        let bestLane = -1;

        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team) {
                continue;
            }

            const { distance, alignment } = Movement.alignment(this, unit.x, unit.y - 7);

            if (distance <= 1 || distance >= maximumDistance) {
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

        if (!this.findPlaneInSights(350, 0.93)) {
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
