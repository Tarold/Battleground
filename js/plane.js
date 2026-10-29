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
        this.kills = 0;
        this.legendary = false;
        this.lockTarget = null;
        this.lockTime = 0;
        this.pursuitAngle = null;
        this.targetDelay = 0;
        this.burstLeft = FIGHTER_BURST_SIZE;
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

    // Перки легенди або null, якщо літак звичайний.
    get perk() {
        return this.legendary ? this.stats.legend : null;
    }

    spawn() {
        const stats = this.stats;

        this.state = PLANE_FLYING;
        this.health = stats.health;
        this.kills = 0;
        this.legendary = false;
        this.lockTarget = null;
        this.lockTime = 0;
        this.pursuitAngle = null;
        this.targetDelay = 0;
        this.burstLeft = FIGHTER_BURST_SIZE;
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

    // attacker — сутність, якій зараховується збиття (може бути null).
    takeDamage(amount, attacker = null) {
        this.health -= amount;

        if (this.health <= 0) {
            if (attacker && attacker.team !== this.team) {
                attacker.addKill(this.bomber ? BOMBER_KILL_VALUE : 1);
            }

            this.state = PLANE_FALLING;
            this.smokeTimer = 0;
            // Лінія падіння фіксується один раз і більше не змінюється.
            this.crashLane = this.flightLane;
            spawnExplosion(this.x, this.y, 16);
        }
    }

    addKill(value = 1) {
        if (this.state !== PLANE_FLYING) {
            return;
        }

        this.kills += value;

        if (!this.legendary && this.kills >= this.stats.legend.kills) {
            this.becomeLegend();
        }
    }

    becomeLegend() {
        this.legendary = true;
        this.health = this.stats.legend.health ?? this.health;
        spawnLegendEffect(this.x, this.y, this.stats.name);
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
        if (this.perk?.regen) {
            this.health = Math.min(this.stats.health, this.health + this.perk.regen * deltaTime);
        }

        this.updateLock(deltaTime);
        this.updatePursuit();
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

            if (distance >= BOMB_TARGETING_TOLERANCE) {
                continue;
            }

            // Зенітка — головна ціль бомбардувальника, решта — за відстанню.
            const better = !bombingTarget ||
                (unit.type === ANTIAIRCRAFT && bombingTarget.type !== ANTIAIRCRAFT) ||
                ((unit.type === ANTIAIRCRAFT) === (bombingTarget.type === ANTIAIRCRAFT) &&
                    distance < nearestDistance);

            if (better) {
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

        if (this.perk?.nuke) {
            this.dropNuke(bombingTarget);
            return;
        }

        this.carpetBombsLeft = CARPET_BOMB_COUNT;
        this.carpetTimer = 0;
        this.carpetLane = bombingTarget.lane;
        this.flightLane = bombingTarget.lane;
    }

    // Легендарний бомбардувальник замість килима скидає одну ядерну бомбу.
    dropNuke(bombingTarget) {
        this.bombReload = NUKE_RELOAD;
        this.flightLane = bombingTarget.lane;

        Projectile.fire({
            x: this.x,
            y: this.y + 10,
            velocityX: this.velocityX * BOMB_HORIZONTAL_FACTOR,
            velocityY: 20,
            team: this.team,
            owner: this,
            damage: NUKE_DAMAGE,
            heavy: true,
            bomb: true,
            nuke: true,
            big: true,
            gravity: GRAVITY,
            targetLane: bombingTarget.lane,
            explosionRadius: NUKE_RADIUS
        });
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
            owner: this,
            damage: CARPET_BOMB_DAMAGE,
            heavy: true,
            bomb: true,
            gravity: GRAVITY,
            explosionRadius: CARPET_BOMB_RADIUS,
            targetLane: this.carpetLane
        });
    }

    // --- Rockets -----------------------------------------------------------

    // Легендарний винищувач залпом пускає самонавідні ракети по літаку або прямі по землі.
    tryLaunchRocket() {
        if (!this.perk?.rockets || this.rocketReload > 0) {
            return;
        }

        const enemyPlane = this.findPlaneInSights(AIR_ROCKET_RANGE, 0.88);
        let groundTarget = null;
        let targetLane = -1;

        if (!enemyPlane) {
            groundTarget = this.findGroundUnitInSights(GROUND_ROCKET_RANGE, 0.85);

            if (!groundTarget) {
                return;
            }

            targetLane = groundTarget.lane;
            this.flightLane = targetLane;
        }

        this.rocketReload = this.stats.rocketReload + Math.random();

        const rockets = this.perk.rockets;
        const airToAir = enemyPlane !== null;

        for (let index = 0; index < rockets; index++) {
            const offset = index - (rockets - 1) / 2;
            const launchAngle = this.angle + offset * 0.25;
            const forwardX = Math.cos(launchAngle);
            const forwardY = Math.sin(launchAngle);

            Projectile.fire({
                x: this.x + Math.cos(this.angle) * 25,
                y: this.y + Math.sin(this.angle) * 25,
                velocityX: this.velocityX + forwardX * ROCKET_LAUNCH_SPEED,
                velocityY: this.velocityY + forwardY * ROCKET_LAUNCH_SPEED,
                team: this.team,
                owner: this,
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

            if (distance <= 1 || distance >= maximumDistance || alignment <= minimumAlignment) {
                continue;
            }

            // Бомбардувальник у прицілі завжди важливіший за винищувач.
            const better = !bestPlane ||
                (enemy.bomber && !bestPlane.bomber) ||
                (enemy.bomber === bestPlane.bomber && alignment > bestAlignment);

            if (better) {
                bestAlignment = alignment;
                bestPlane = enemy;
            }
        }

        return bestPlane;
    }

    // Повертає лінію найкраще вирівняної наземної цілі або -1, якщо цілі немає.
    findGroundLaneInSights(maximumDistance = 370, minimumAlignment = 0.94) {
        return this.findGroundUnitInSights(maximumDistance, minimumAlignment)?.lane ?? -1;
    }

    // Найкраще вирівняна наземна ціль у секторі прицілу або null.
    findGroundUnitInSights(maximumDistance, minimumAlignment) {
        let bestAlignment = minimumAlignment;
        let bestUnit = null;

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
                bestUnit = unit;
            }
        }

        return bestUnit;
    }

    // Літак живий, поки летить; наземний юніт — поки активний.
    isTargetAlive(target) {
        return target.state === undefined ? target.active : target.state === PLANE_FLYING;
    }

    // Ціль для кулемета: літак у секторі прицілу, інакше наземний юніт; null, якщо немає.
    findGunTarget() {
        return this.findPlaneInSights(350, 0.93) ?? this.findGroundUnitInSights(370, 0.94);
    }

    // Винищувач захоплює ціль: поки вона в прицілі, лічильник росте, зміна цілі скидає його.
    updateLock(deltaTime) {
        if (this.bomber) {
            return;
        }

        const instant = this.perk?.instantLock;

        this.targetDelay = Math.max(0, this.targetDelay - deltaTime);

        // Після збиття цілі винищувач деякий час не захоплює наступну (легенда — без паузи).
        if (this.lockTarget && !this.isTargetAlive(this.lockTarget)) {
            this.targetDelay = instant ? 0 : TARGET_SWITCH_DELAY;
        }

        if (instant) {
            this.targetDelay = 0;
        }

        if (this.targetDelay > 0) {
            this.lockTarget = null;
            this.lockTime = 0;
            return;
        }

        const target = this.findGunTarget();

        if (target === this.lockTarget && target !== null) {
            this.lockTime = Math.min(LOCK_TIME + LOCK_FIRE_DELAY, this.lockTime + deltaTime);
        } else {
            this.lockTarget = target;
            this.lockTime = 0;
        }

        // Легенда захоплює ціль миттєво: повна точність без відліку.
        if (instant && target) {
            this.lockTime = LOCK_TIME + LOCK_FIRE_DELAY;
        }
    }

    // Найближчий ворожий бомбардувальник у радіусі погоні або null.
    findPursuitTarget() {
        let nearestTarget = null;
        let nearestDistance = PLANE_PURSUIT_RANGE;

        for (const enemy of battle.planes) {
            if (enemy.team === this.team || enemy.state !== PLANE_FLYING || !enemy.bomber) {
                continue;
            }

            const { distance, alignment } = Movement.alignment(this, enemy.x, enemy.y);

            // Лише ті, що попереду: розвертатися на ціль позаду не потрібно.
            if (alignment > PURSUIT_CONE && distance < nearestDistance) {
                nearestTarget = enemy;
                nearestDistance = distance;
            }
        }

        return nearestTarget;
    }

    // Винищувач іде на захоплену ціль, інакше переслідує бомбардувальник; ціль береться з випередженням.
    updatePursuit() {
        this.pursuitAngle = null;

        const target = this.bomber || this.targetDelay > 0
            ? null
            : this.lockTarget ?? this.findPursuitTarget();

        if (!target) {
            return;
        }

        const isPlane = target.state !== undefined;
        let aimX = target.x;
        let aimY = isPlane ? target.y : target.y - 7;

        if (isPlane) {
            const leadTime = Math.hypot(aimX - this.x, aimY - this.y) / PLANE_GUN_SPEED;
            aimX += target.velocityX * leadTime;
            aimY += target.velocityY * leadTime;
        }

        this.pursuitAngle = Math.atan2(aimY - this.y, aimX - this.x);
    }

    tryShoot() {
        if (this.reload > 0) {
            return;
        }

        const target = this.bomber ? this.findGunTarget() : this.lockTarget;

        if (!target) {
            return;
        }

        // Після повного захоплення винищувач ще мить цілиться, перш ніж дати чергу.
        if (!this.bomber && this.lockTime < LOCK_TIME + LOCK_FIRE_DELAY) {
            return;
        }

        // Літак має state, наземний юніт — лінію.
        const targetLane = target.state === undefined ? target.lane : -1;

        if (targetLane >= 0) {
            this.flightLane = targetLane;
        }

        this.reload = this.stats.fireInterval;

        // Винищувач стріляє чергою, потім перезаряджається довше.
        if (!this.bomber && --this.burstLeft === 0) {
            this.burstLeft = FIGHTER_BURST_SIZE;
            this.reload = FIGHTER_BURST_PAUSE;
        }

        const forwardX = Math.cos(this.angle);
        const forwardY = Math.sin(this.angle);
        const precision = this.bomber ? 0 : LOCK_PRECISION * Math.min(1, this.lockTime / LOCK_TIME);
        const shotAngle = this.angle + (Math.random() - 0.5) * PLANE_GUN_SPREAD * (1 - precision);

        Projectile.fire({
            x: this.x + forwardX * 25,
            y: this.y + forwardY * 25,
            velocityX: Math.cos(shotAngle) * PLANE_GUN_SPEED,
            velocityY: Math.sin(shotAngle) * PLANE_GUN_SPEED,
            team: this.team,
            owner: this,
            damage: 1,
            targetLane
        });
    }

    draw(time) {
        Art.drawPlane(this, time);
    }
}
