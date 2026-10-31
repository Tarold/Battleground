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
        this.rpgReload = 0;
        this.rpgStance = 0;
        this.missilesLeft = 0;
        this.missileTimer = 0;
        this.burstLeft = 0;
        this.burstTimer = 0;
        this.salvoLeft = 0;
        this.salvoTimer = 0;
        this.salvoX = 0;
        this.salvoY = 0;
        this.salvoLane = 0;
        this.kills = 0;
        // Лічильник «поколінь» слота пулу: снаряди не зараховують вбивства тому, хто з'явився після їхнього пострілу.
        this.generation = 0;
        this.legendary = false;
        this.animationPhase = 0;
        this.aimAngle = 0;
        this.moving = false;
        this.prone = false;
        this.proneTimer = 0;
    }

    get stats() {
        return UNIT_STATS[this.type];
    }

    // Скільки вбивств отримує той, хто знищив цього юніта.
    get killValue() {
        return this.perk?.killValue ?? this.stats.killValue;
    }

    // Піхота, що вбила піхоту, отримує повне вбивство замість зниженого killValue.
    killValueFor(attacker) {
        const infantryDuel = this.type === INFANTRY && attacker instanceof GroundUnit && attacker.type === INFANTRY;

        return infantryDuel ? INFANTRY_DUEL_KILL_VALUE : this.killValue;
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
        const limit = settings.counts[ENTITY_SETTINGS[type].id];
        const alive = battle.groundUnits.filter(candidate => candidate.active && candidate.type === type).length;

        if (alive >= limit) {
            return;
        }

        const unit = battle.groundUnits.find(candidate => !candidate.active);

        if (unit) {
            unit.spawn(team, type, lane, initialPosition);
        }
    }

    spawn(team, type, lane, initialPosition) {
        this.active = true;
        this.generation++;
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
        this.rpgReload = 1 + Math.random() * 2;
        this.rpgStance = 0;
        this.missilesLeft = 0;
        this.missileTimer = 0;
        this.burstLeft = 0;
        this.burstTimer = 0;
        this.salvoLeft = 0;
        this.kills = 0;
        this.legendary = false;
        this.animationPhase = Math.random() * 10;
        this.aimAngle = team === 0 ? -0.7 : -Math.PI + 0.7;
        this.moving = false;
        this.prone = false;
        this.proneTimer = 0;
    }

    // attacker — сутність, якій зараховується вбивство (може бути null).
    takeDamage(amount, attacker = null) {
        this.health -= amount;

        if (this.health <= 0) {
            this.destroy();

            if (attacker && attacker.team !== this.team) {
                attacker.addKill(this.killValueFor(attacker));
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
        this.rpgReload -= deltaTime;
        this.moving = false;

        if (this.type === INFANTRY) {
            this.updateProne(deltaTime);
        }

        if (this.perk?.missiles) {
            this.tryLaunchMissile(deltaTime);
        }

        if (this.type === INFANTRY) {
            this.tryThrowGrenade();
        }

        if (this.perk?.rpg) {
            this.tryFireRpg();
        }

        if (this.salvoLeft > 0) {
            this.continueRocketSalvo(deltaTime);
            return;
        }

        const { target, airborne } = this.selectTarget();

        if (this.burstLeft > 0) {
            this.continueBurst(deltaTime, target, airborne);
        }

        if (!target) {
            this.advance(deltaTime);
            return;
        }

        if (this.type === ANTIAIRCRAFT) {
            // Башта зенітки повертається з обмеженою швидкістю і стріляє, лише навівшись на ціль.
            const muzzleY = this.y - 13;
            const shot = Movement.groundShot(this, target, muzzleY, airborne);
            const desiredAngle = Math.atan2(shot.velocityY, shot.velocityX);
            const turretSpeed = AA_TURRET_SPEED * (this.perk?.turretFactor ?? 1);

            this.aimAngle = Movement.turnToward(this.aimAngle, desiredAngle, turretSpeed * deltaTime);

            const error = Math.abs(Math.atan2(
                Math.sin(desiredAngle - this.aimAngle),
                Math.cos(desiredAngle - this.aimAngle)
            ));

            if (this.reload <= 0 && error < AA_TURRET_TOLERANCE) {
                this.fire(target, airborne);
            }

            return;
        }

        if (this.type === ARTILLERY && !this.perk?.artilleryRockets) {
            // Гармата теж повертає ствол з обмеженою швидкістю і стріляє лише навівшись.
            const shot = Movement.groundShot(this, target, this.y - 13, false);
            const desiredAngle = Math.atan2(shot.velocityY, shot.velocityX);

            this.aimAngle = Movement.turnToward(this.aimAngle, desiredAngle, ARTILLERY_TURRET_SPEED * deltaTime);

            const error = Math.abs(Math.atan2(
                Math.sin(desiredAngle - this.aimAngle),
                Math.cos(desiredAngle - this.aimAngle)
            ));

            if (this.reload <= 0 && error < ARTILLERY_TURRET_TOLERANCE) {
                this.fire(target, false);
            }

            return;
        }

        this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);

        if (this.reload <= 0) {
            this.fire(target, airborne);
        }
    }

    // Піхота лягає, побачивши ворога, і встає лише через PRONE_HOLD_TIME після того, як той зник.
    updateProne(deltaTime) {
        if (this.seesEnemy()) {
            this.proneTimer = PRONE_HOLD_TIME;
        } else {
            this.proneTimer = Math.max(0, this.proneTimer - deltaTime);
        }

        // Для пострілу з РПГ піхотинець встає в повний зріст.
        this.rpgStance = Math.max(0, this.rpgStance - deltaTime);
        this.prone = this.proneTimer > 0 && this.rpgStance === 0;
    }

    // Літаки ігноруються: лягають лише від наземних ворогів.
    seesEnemy() {
        return this.findGroundTarget(PRONE_SIGHT_RANGE) !== null;
    }

    advance(deltaTime) {
        // Під час прицілювання з РПГ піхотинець стоїть на місці.
        if (this.rpgStance > 0) {
            return;
        }

        const crawl = this.prone ? PRONE_SPEED_FACTOR : 1;

        Movement.advanceGroundUnit(this, deltaTime * crawl);
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

    // Наступні постріли серії легендарного танка: кожен заново наводиться на ціль.
    continueBurst(deltaTime, target, airborne) {
        if (!target) {
            this.burstLeft = 0;
            return;
        }

        this.burstTimer -= deltaTime;

        if (this.burstTimer > 0) {
            return;
        }

        this.burstLeft--;
        this.burstTimer = TANK_BURST_INTERVAL;
        this.fire(target, airborne, true);
    }

    fire(target, airborne, followUp = false) {
        if (this.perk?.artilleryRockets) {
            this.startRocketSalvo(target);
            return;
        }

        const muzzleY = this.y - (this.type === INFANTRY ? (this.prone ? 3 : 7) : 13);
        const aim = Movement.groundShot(this, target, muzzleY, airborne);

        if (this.type === ANTIAIRCRAFT || (this.type === ARTILLERY && !this.perk?.artilleryRockets)) {
            // Зенітка і гармата стріляють туди, куди реально дивиться ствол.
            const speed = Math.hypot(aim.velocityX, aim.velocityY);
            const angle = this.aimAngle + (Math.random() - 0.5) * 0.018;

            aim.velocityX = Math.cos(angle) * speed;
            aim.velocityY = Math.sin(angle) * speed;
        } else {
            this.aimAngle = Math.atan2(aim.velocityY, aim.velocityX);
        }

        if (!followUp) {
            this.reload = (this.stats.reload + Math.random() * 0.15) * (this.prone ? PRONE_RELOAD_FACTOR : 1);

            if (this.perk?.burst) {
                this.burstLeft = this.perk.burst - 1;
                this.burstTimer = TANK_BURST_INTERVAL;
            }
        }

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

    // Легендарна артилерія (РСЗВ) фіксує точку цілі й стоїть на місці, поки не випустить весь залп.
    startRocketSalvo(target) {
        this.salvoLeft = this.perk.artilleryRockets;
        this.salvoTimer = 0;
        this.salvoX = target.x;
        this.salvoY = target.y;
        this.salvoLane = target.lane;
        this.reload = ARTILLERY_ROCKET_RELOAD + Math.random() * 1.5;
    }

    // Ракети залпу вилітають по черзі, кожна з власним розкидом точки прильоту.
    continueRocketSalvo(deltaTime) {
        this.salvoTimer -= deltaTime;

        if (this.salvoTimer > 0) {
            return;
        }

        this.salvoTimer = ARTILLERY_ROCKET_INTERVAL;
        this.salvoLeft--;

        const direction = this.team === 0 ? 1 : -1;
        const muzzleX = this.x + direction * 8;
        const muzzleY = this.y - 16;
        const spread = (Math.random() - 0.5) * ARTILLERY_ROCKET_SPREAD;
        const shot = Movement.rocketSalvoShot(
            this.salvoX + spread - muzzleX,
            this.salvoY - muzzleY
        );

        this.aimAngle = Math.atan2(shot.velocityY, shot.velocityX);

        Projectile.fire({
            x: muzzleX,
            y: muzzleY,
            velocityX: shot.velocityX,
            velocityY: shot.velocityY,
            team: this.team,
            owner: this,
            damage: ARTILLERY_ROCKET_DAMAGE,
            heavy: true,
            rocket: true,
            gravity: shot.gravity,
            explosionRadius: ARTILLERY_ROCKET_RADIUS,
            targetLane: this.salvoLane,
            life: 10
        });

        // Струмінь вогню та диму позаду пускової.
        spawnSmoke(muzzleX - direction * 12, muzzleY + 3, -direction * (45 + Math.random() * 30), -10 - Math.random() * 15, true, 0.75);
    }

    // РПГ легендарної піхоти: пряма ракета по найближчому наземному ворогу.
    tryFireRpg() {
        const target = this.findGroundTarget(RPG_RANGE);

        if (!target) {
            return;
        }

        // Піхотинець встає заздалегідь і лишається стояти ще мить після пострілу.
        if (this.rpgReload <= RPG_STAND_TIME) {
            this.rpgStance = RPG_STAND_HOLD;
        }

        if (this.rpgReload > 0 || this.prone) {
            return;
        }

        const muzzleY = this.y - 10;
        const angle = Math.atan2(target.y - 7 - muzzleY, target.x - this.x);

        this.rpgReload = RPG_RELOAD + Math.random();

        Projectile.fire({
            x: this.x,
            y: muzzleY,
            velocityX: Math.cos(angle) * RPG_SPEED,
            velocityY: Math.sin(angle) * RPG_SPEED,
            team: this.team,
            owner: this,
            damage: RPG_DAMAGE,
            heavy: true,
            rocket: true,
            explosionRadius: RPG_RADIUS,
            targetLane: target.lane,
            life: 2
        });

        spawnSmoke(this.x, muzzleY, -Math.cos(angle) * 30, -10, true, 0.5);
    }

    // Граната піхоти: навісом по найближчому наземному ворогу (техніка чи піхота).
    tryThrowGrenade() {
        if (this.specialReload > 0) {
            return;
        }

        const target = this.findGroundTarget(GRENADE_RANGE);

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
