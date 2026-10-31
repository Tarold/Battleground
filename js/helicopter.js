'use strict';

// Гелікоптер: малий і слабкий, висить низько над полем біля ворожих наземних цілей
// і б'є з кулеметної турелі, що повертається незалежно від корпусу.
// Легенда додатково пускає залп некерованих ракет по землі.
// Живе в пулі battle.planes, тож зенітки, винищувачі й ракети б'ють по ньому як по літаку.
class Helicopter extends Plane {
    constructor(index) {
        super(index, 'heli');
        this.facing = 1;
        this.tilt = 0;
        this.altitude = HELI_MIN_ALTITUDE;
        this.standoff = HELI_STANDOFF;
        this.turretAngle = 0;
        this.target = null;
        this.salvoLeft = 0;
        this.salvoTimer = 0;
        this.salvoTarget = null;
        this.salvoGeneration = 0;
        this.salvoX = 0;
        this.salvoLane = 0;
    }

    spawn() {
        super.spawn();

        this.facing = this.team === 0 ? 1 : -1;
        this.angle = this.facing === 1 ? 0 : Math.PI;
        this.tilt = 0;
        this.altitude = HELI_MIN_ALTITUDE + Math.random() * (HELI_MAX_ALTITUDE - HELI_MIN_ALTITUDE);
        // Різна дистанція зависання, щоб гелікоптери не злипались в одну точку.
        this.standoff = HELI_STANDOFF * (0.7 + Math.random() * 0.6);
        this.y = world.groundLevel() - this.altitude;
        this.velocityX = 0;
        this.velocityY = 0;
        this.turretAngle = this.facing === 1 ? 0.6 : Math.PI - 0.6;
        this.target = null;
        this.burstLeft = HELI_BURST_SIZE;
        this.salvoLeft = 0;
        this.salvoTarget = null;
    }

    // Точка, з якої вилітають кулі: під носом.
    get muzzle() {
        return { x: this.x + this.facing * 6, y: this.y + 7 };
    }

    updateFlying(deltaTime, time) {
        this.reload -= deltaTime;
        this.rocketReload -= deltaTime;

        this.target = this.findTarget();
        this.hover(deltaTime, time);
        this.aimTurret(deltaTime);
        this.tryShoot();
        this.tryLaunchRocket(deltaTime);
    }

    // --- Movement ----------------------------------------------------------

    // Підлітає до найближчого ворожого наземного юніта і зависає на відстані standoff від нього;
    // якщо нікого не видно — летить до ворожої бази.
    hover(deltaTime, time) {
        const approach = this.findApproachTarget();
        const goalX = approach ? approach.x : world.basePosition(1 - this.team);
        const side = Math.sign(goalX - this.x) || (this.team === 0 ? 1 : -1);
        const desiredX = clamp(goalX - side * this.standoff, 40, world.width - 40);
        const desiredY = world.groundLevel() - this.altitude + Math.sin(time * 1.3 + this.phase) * HELI_HOVER_BOB;

        Movement.steerHeli(this, desiredX, desiredY, deltaTime);

        // Корпус дивиться на ціль, без цілі — по ходу руху.
        if (this.target) {
            this.facing = Math.sign(this.target.x - this.x) || this.facing;
        } else if (Math.abs(this.velocityX) > 10) {
            this.facing = Math.sign(this.velocityX);
        }

        this.angle = this.facing === 1 ? 0 : Math.PI;
    }

    // Найближчий по горизонталі ворожий наземний юніт у межах огляду.
    findApproachTarget() {
        let nearestUnit = null;
        let nearestDistance = HELI_SIGHT_RANGE;

        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team) {
                continue;
            }

            const distance = Math.abs(unit.x - this.x);

            if (distance < nearestDistance) {
                nearestUnit = unit;
                nearestDistance = distance;
            }
        }

        return nearestUnit;
    }

    // --- Machine gun turret ------------------------------------------------

    // Ворожий гелікоптер поруч — головна загроза; далі наземна ціль; далі будь-який літак у радіусі.
    findTarget() {
        let airTarget = null;
        let airDistance = HELI_AIR_RANGE;

        for (const enemy of battle.planes) {
            if (enemy.team === this.team || enemy.state !== PLANE_FLYING) {
                continue;
            }

            const distance = Math.hypot(enemy.x - this.x, enemy.y - this.y);

            if (distance >= HELI_AIR_RANGE) {
                continue;
            }

            const isHeli = enemy.kind === 'heli';
            const better = !airTarget ||
                (isHeli && airTarget.kind !== 'heli') ||
                (isHeli === (airTarget.kind === 'heli') && distance < airDistance);

            if (better) {
                airTarget = enemy;
                airDistance = distance;
            }
        }

        if (airTarget?.kind === 'heli') {
            return airTarget;
        }

        return this.findGroundTarget(HELI_GUN_RANGE) ?? airTarget;
    }

    // Найближчий ворожий наземний юніт на будь-якій лінії в радіусі range.
    findGroundTarget(range) {
        let nearestUnit = null;
        let nearestDistance = range;

        for (const unit of battle.groundUnits) {
            if (!unit.active || unit.team === this.team) {
                continue;
            }

            const distance = Math.hypot(unit.x - this.x, unit.y - 6 - this.y);

            if (distance < nearestDistance) {
                nearestUnit = unit;
                nearestDistance = distance;
            }
        }

        return nearestUnit;
    }

    // Кут на ціль із муфти турелі; літак береться з випередженням.
    aimAngleAt(target) {
        const muzzle = this.muzzle;
        const airborne = target.state !== undefined;
        let aimX = target.x;
        let aimY = airborne ? target.y : target.y - 6;

        if (airborne) {
            const leadTime = Math.hypot(aimX - muzzle.x, aimY - muzzle.y) / HELI_GUN_SPEED;
            aimX += target.velocityX * leadTime;
            aimY += target.velocityY * leadTime;
        }

        return Math.atan2(aimY - muzzle.y, aimX - muzzle.x);
    }

    // Турель доводиться до цілі, без цілі — повертається вниз-вперед.
    aimTurret(deltaTime) {
        const restAngle = this.facing === 1 ? 0.6 : Math.PI - 0.6;
        const desiredAngle = this.target ? this.aimAngleAt(this.target) : restAngle;

        this.turretAngle = Movement.turnToward(this.turretAngle, desiredAngle, HELI_TURRET_SPEED * deltaTime);
    }

    // Черга з турелі, коли ствол наведений на ціль.
    tryShoot() {
        const target = this.target;

        if (this.reload > 0 || !target) {
            return;
        }

        const aimAngle = this.aimAngleAt(target);
        const error = Math.atan2(Math.sin(aimAngle - this.turretAngle), Math.cos(aimAngle - this.turretAngle));

        if (Math.abs(error) > HELI_TURRET_TOLERANCE) {
            return;
        }

        // Літак має state, наземний юніт — лінію.
        const targetLane = target.state === undefined ? target.lane : -1;

        if (targetLane >= 0) {
            this.flightLane = targetLane;
        }

        this.reload = this.stats.fireInterval;

        if (--this.burstLeft === 0) {
            this.burstLeft = HELI_BURST_SIZE;
            this.reload = HELI_BURST_PAUSE;
        }

        const muzzle = this.muzzle;
        const shotAngle = this.turretAngle + (Math.random() - 0.5) * HELI_GUN_SPREAD;

        Projectile.fire({
            x: muzzle.x + Math.cos(this.turretAngle) * 9,
            y: muzzle.y + Math.sin(this.turretAngle) * 9,
            velocityX: Math.cos(shotAngle) * HELI_GUN_SPEED,
            velocityY: Math.sin(shotAngle) * HELI_GUN_SPEED,
            team: this.team,
            owner: this,
            damage: HELI_GUN_DAMAGE,
            targetLane
        });
    }

    // --- Rockets -----------------------------------------------------------

    // Легенда пускає залп ракет по одній у наземну ціль; точка цілі запам'ятовується на випадок її смерті.
    tryLaunchRocket(deltaTime) {
        if (!this.perk?.rockets) {
            return;
        }

        if (this.salvoLeft > 0) {
            this.continueSalvo(deltaTime);
            return;
        }

        const target = this.target;

        if (this.rocketReload > 0 || !target || target.state !== undefined) {
            return;
        }

        if (Math.hypot(target.x - this.x, target.y - this.y) > HELI_ROCKET_RANGE) {
            return;
        }

        this.salvoLeft = this.perk.rockets;
        this.salvoTimer = 0;
        this.salvoTarget = target;
        this.salvoGeneration = target.generation;
        this.salvoX = target.x;
        this.salvoLane = target.lane;
    }

    continueSalvo(deltaTime) {
        this.salvoTimer -= deltaTime;

        if (this.salvoTimer > 0) {
            return;
        }

        this.salvoTimer = HELI_ROCKET_INTERVAL;
        this.salvoLeft--;

        if (this.salvoLeft === 0) {
            this.rocketReload = HELI_ROCKET_RELOAD + Math.random();
        }

        // Слот пулу міг дістатися іншому юніту — тоді б'ємо в запам'ятовану точку.
        if (this.salvoTarget?.active && this.salvoTarget.generation === this.salvoGeneration) {
            this.salvoX = this.salvoTarget.x;
        }

        const aimX = this.salvoX + (Math.random() - 0.5) * HELI_ROCKET_SPREAD;
        const aimY = world.laneLevel(this.salvoLane) - 6;
        const startY = this.y + 10;
        const angle = Math.atan2(aimY - startY, aimX - this.x);

        Projectile.fire({
            x: this.x,
            y: startY,
            velocityX: Math.cos(angle) * HELI_ROCKET_SPEED,
            velocityY: Math.sin(angle) * HELI_ROCKET_SPEED,
            team: this.team,
            owner: this,
            damage: HELI_ROCKET_DAMAGE,
            heavy: true,
            rocket: true,
            explosionRadius: HELI_ROCKET_RADIUS,
            life: 3,
            targetLane: this.salvoLane
        });
    }

    draw(time) {
        Art.drawHelicopter(this, time);
    }
}
