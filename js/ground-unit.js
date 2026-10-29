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
        this.missileReload = 0;
        this.animationPhase = 0;
        this.aimAngle = 0;
        this.moving = false;
    }

    get stats() {
        return UNIT_STATS[this.type];
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
        this.missileReload = 2 + Math.random() * 3;
        this.animationPhase = Math.random() * 10;
        this.aimAngle = team === 0 ? -0.7 : -Math.PI + 0.7;
        this.moving = false;
    }

    takeDamage(amount) {
        this.health -= amount;

        if (this.health <= 0) {
            this.destroy();
        }
    }

    destroy() {
        this.active = false;
        spawnExplosion(this.x, this.y, this.type === INFANTRY ? 8 : 20);
    }

    update(deltaTime) {
        this.y = world.laneLevel(this.lane);
        this.reload -= deltaTime;
        this.missileReload -= deltaTime;
        this.moving = false;

        if (this.type === ANTIAIRCRAFT) {
            this.tryLaunchMissile();
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

    findGroundTarget(range, minimumDistance = 0) {
        let nearestTarget = null;
        let nearestDistance = range;

        for (const enemy of battle.groundUnits) {
            if (!enemy.active || enemy.team === this.team || enemy.lane !== this.lane) {
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

    findAirTarget(range = UNIT_STATS[ANTIAIRCRAFT].range) {
        let nearestTarget = null;
        let nearestDistance = range;

        for (const plane of battle.planes) {
            if (plane.team === this.team || plane.state !== PLANE_FLYING) {
                continue;
            }

            const distance = Math.hypot(plane.x - this.x, plane.y - this.y);

            if (distance < nearestDistance) {
                nearestTarget = plane;
                nearestDistance = distance;
            }
        }

        return nearestTarget;
    }

    // --- Shooting ----------------------------------------------------------

    fire(target, airborne) {
        const muzzleY = this.y - (this.type === INFANTRY ? 7 : 13);
        const shot = Movement.groundShot(this, target, muzzleY, airborne);

        this.aimAngle = Math.atan2(shot.velocityY, shot.velocityX);
        this.reload = this.stats.reload + Math.random() * 0.15;

        const muzzleX = this.x + Math.cos(this.aimAngle) * 19;
        const heavy = this.type !== INFANTRY;

        Projectile.fire({
            x: muzzleX,
            y: muzzleY,
            velocityX: shot.velocityX,
            velocityY: shot.velocityY,
            team: this.team,
            damage: this.stats.damage,
            heavy,
            shell: this.type === ARTILLERY,
            gravity: shot.gravity,
            explosionRadius: shot.explosionRadius,
            targetLane: airborne ? -1 : target.lane
        });

        spawnSmoke(muzzleX, muzzleY, Math.cos(this.aimAngle) * 25, -15, heavy, 0.35);
    }

    // Велика самонавідна ракета: стартує майже вертикально, потім наводиться.
    tryLaunchMissile() {
        if (this.missileReload > 0) {
            return;
        }

        const target = this.findAirTarget(AA_MISSILE_RANGE);

        if (!target) {
            return;
        }

        const direction = this.team === 0 ? 1 : -1;
        const launchAngle = -Math.PI / 2 + direction * 0.35;
        const launchY = this.y - 16;

        this.missileReload = AA_MISSILE_RELOAD + Math.random() * 1.5;

        Projectile.fire({
            x: this.x,
            y: launchY,
            velocityX: Math.cos(launchAngle) * AA_MISSILE_SPEED,
            velocityY: Math.sin(launchAngle) * AA_MISSILE_SPEED,
            team: this.team,
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
