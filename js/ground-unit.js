'use strict';

class GroundUnit {
    constructor() {
        this.active = false;
        this.type = INFANTRY;
        this.team = 0;
        this.lane = 0;
        this.x = 0;
        this.y = 0;
        this.health = 1;
        this.reload = 0;
        this.specialReload = 0;
        this.missilesLeft = 0;
        this.missileTimer = 0;
        this.kills = 0;
        this.legendary = false;
        this.animationPhase = 0;
        this.aimAngle = 0;
        this.moving = false;
    }

    get stats() {
        return UNIT_STATS[this.type];
    }

    // Перки легенди або null, якщо юніт звичайний.
    get perk() {
        return this.legendary ? this.stats.legend : null;
    }

    static randomType() {
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

    // Розгортає юніта у першому вільному слоті пулу (якщо такий є).
    static deploy(team, type, lane, initialPosition = null) {
        const unit = battle.groundUnits.find(candidate => !candidate.active);

        if (unit) {
            unit.spawn(team, type, lane, initialPosition);
        }
    }

    spawn(team, type, lane, initialPosition) {
        this.active = true;
        this.team = team;
        this.type = type;
        this.lane = lane;
        this.x = initialPosition === null
            ? world.basePosition(team) + (Math.random() - 0.5) * 18
            : initialPosition;
        this.y = world.laneLevel(lane);
        this.health = this.stats.health;
        this.reload = 0.3 + Math.random();
        this.specialReload = 2 + Math.random() * 3;
        this.missilesLeft = 0;
        this.missileTimer = 0;
        this.kills = 0;
        this.legendary = false;
        this.animationPhase = Math.random() * 10;
        this.aimAngle = team === 0 ? -0.7 : -Math.PI + 0.7;
        this.moving = false;
    }

    // attacker — сутність, якій зараховується вбивство (може бути null).
    takeDamage(amount, attacker = null) {
        this.health -= amount;

        if (this.health <= 0) {
            this.destroy();

            if (attacker && attacker.team !== this.team) {
                attacker.addKill();
            }
        }
    }

    addKill(value = 1) {
        if (!this.active) {
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

    destroy() {
        this.active = false;
        spawnExplosion(this.x, this.y, this.type === INFANTRY ? 8 : 20);
    }

    update(deltaTime) {
        this.y = world.laneLevel(this.lane);
        this.reload -= deltaTime;
        this.specialReload -= deltaTime;
        this.moving = false;

        if (this.perk?.missiles) {
            this.tryLaunchMissile(deltaTime);
        }

        if (this.perk?.grenades) {
            this.tryThrowGrenade();
        }

        const { target, airborne } = this.selectTarget();

        if (!target) {
            this.advance(deltaTime);
            return;
        }

        this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);

        if (this.reload <= 0) {
            this.fire(target, airborne);
        }
    }

    advance(deltaTime) {
        Movement.advanceGroundUnit(this, deltaTime);
        this.moving = true;

        if (Movement.isOutsideField(this)) {
            spawnExplosion(this.x, this.y, 8);
            this.active = false;
        }
    }

    // --- Targeting ---------------------------------------------------------

    selectTarget() {
        if (this.type === ANTIAIRCRAFT) {
            const airTarget = this.findAirTarget();

            if (airTarget) {
                return { target: airTarget, airborne: true };
            }

            return { target: this.findGroundTarget(ANTIAIRCRAFT_GROUND_RANGE), airborne: false };
        }

        const minimumDistance = this.type === ARTILLERY ? ARTILLERY_MINIMUM_RANGE : 0;

        return {
            target: this.findGroundTarget(this.stats.range, minimumDistance),
            airborne: false
        };
    }

    findGroundTarget(range, minimumDistance = 0, vehiclesOnly = false) {
        let nearestTarget = null;
        let nearestDistance = range;

        for (const enemy of battle.groundUnits) {
            if (!enemy.active || enemy.team === this.team || enemy.lane !== this.lane) {
                continue;
            }

            if (vehiclesOnly && enemy.type === INFANTRY) {
                continue;
            }

            const distance = Math.abs(enemy.x - this.x);

            if (distance >= minimumDistance && distance < nearestDistance) {
                nearestTarget = enemy;
                nearestDistance = distance;
            }
        }

        return nearestTarget;
    }

    // Зенітка в першу чергу бере бомбардувальники, інакше — найближчий літак.
    findAirTarget(range = UNIT_STATS[ANTIAIRCRAFT].range) {
        let bestTarget = null;
        let bestDistance = range;

        for (const plane of battle.planes) {
            if (plane.team === this.team || plane.state !== PLANE_FLYING) {
                continue;
            }

            const distance = Math.hypot(plane.x - this.x, plane.y - this.y);

            if (distance >= range) {
                continue;
            }

            const better = !bestTarget ||
                (plane.bomber && !bestTarget.bomber) ||
                (plane.bomber === bestTarget.bomber && distance < bestDistance);

            if (better) {
                bestTarget = plane;
                bestDistance = distance;
            }
        }

        return bestTarget;
    }

    // --- Shooting ----------------------------------------------------------

    fire(target, airborne) {
        const muzzleY = this.y - (this.type === INFANTRY ? 7 : 13);
        const aim = Movement.groundShot(this, target, muzzleY, airborne);

        this.aimAngle = Math.atan2(aim.velocityY, aim.velocityX);
        this.reload = this.stats.reload + Math.random() * 0.15;

        const muzzleX = this.x + Math.cos(this.aimAngle) * 19;
        const heavy = this.type !== INFANTRY;
        const shots = this.perk?.shots ?? 1;

        for (let index = 0; index < shots; index++) {
            const offset = index - (shots - 1) / 2;
            const shot = shots === 1 ? aim : Movement.groundShot(this, target, muzzleY, airborne, offset);

            Projectile.fire({
                x: muzzleX,
                y: muzzleY + (this.type === ARTILLERY ? 0 : offset * 5),
                velocityX: shot.velocityX,
                velocityY: shot.velocityY,
                team: this.team,
                owner: this,
                damage: this.stats.damage,
                heavy,
                shell: this.type === ARTILLERY,
                gravity: shot.gravity,
                explosionRadius: shot.explosionRadius,
                targetLane: airborne ? -1 : target.lane
            });
        }

        spawnSmoke(muzzleX, muzzleY, Math.cos(this.aimAngle) * 25, -15, heavy, 0.35);
    }

    // Протитанкова граната легендарної піхоти: навісом по найближчій техніці.
    tryThrowGrenade() {
        if (this.specialReload > 0) {
            return;
        }

        const target = this.findGroundTarget(GRENADE_RANGE, 0, true);

        if (!target) {
            return;
        }

        const startY = this.y - 10;
        const shot = Movement.grenadeShot(target.x - this.x, target.y - 7 - startY);

        this.specialReload = GRENADE_RELOAD + Math.random();

        Projectile.fire({
            x: this.x,
            y: startY,
            velocityX: shot.velocityX,
            velocityY: shot.velocityY,
            team: this.team,
            owner: this,
            damage: GRENADE_DAMAGE,
            heavy: true,
            shell: true,
            gravity: shot.gravity,
            explosionRadius: shot.explosionRadius,
            targetLane: target.lane
        });
    }

    // Легендарна зенітка запускає серію ракет по одній, з інтервалом.
    tryLaunchMissile(deltaTime) {
        if (this.missilesLeft === 0) {
            if (this.specialReload > 0 || !this.findAirTarget(AA_MISSILE_RANGE)) {
                return;
            }

            this.missilesLeft = this.perk.missiles;
            this.missileTimer = 0;
        }

        this.missileTimer -= deltaTime;

        if (this.missileTimer > 0) {
            return;
        }

        const target = this.findAirTarget(AA_MISSILE_RANGE);

        if (!target) {
            this.missilesLeft = 0;
            this.specialReload = 2;
            return;
        }

        this.missileTimer = AA_MISSILE_INTERVAL;
        this.missilesLeft--;

        if (this.missilesLeft === 0) {
            this.specialReload = AA_MISSILE_RELOAD + Math.random() * 1.5;
        }

        // Ракети стартують майже вертикально, потім наводяться.
        const direction = this.team === 0 ? 1 : -1;
        const side = this.missilesLeft % 2 === 0 ? 0.25 : -0.25;
        const launchAngle = -Math.PI / 2 + direction * 0.35 + side;
        const launchY = this.y - 16;

        Projectile.fire({
            x: this.x,
            y: launchY,
            velocityX: Math.cos(launchAngle) * AA_MISSILE_SPEED,
            velocityY: Math.sin(launchAngle) * AA_MISSILE_SPEED,
            team: this.team,
            owner: this,
            damage: AA_MISSILE_DAMAGE,
            heavy: true,
            rocket: true,
            big: true,
            homingTarget: target,
            turnRate: AA_MISSILE_TURN_RATE,
            planeBlastRadius: AA_MISSILE_BLAST_RADIUS,
            life: 6
        });

        spawnExplosion(this.x, launchY, 8);
    }

    draw(time) {
        Art.drawGroundUnit(this, time);
    }
}
