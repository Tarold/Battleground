'use strict';

// Десантний літак (виглядає як звичайний бомбардувальник), якого викликає легендарна піхота.
// Живе в пулі battle.planes, тож зенітки, винищувачі й ракети збивають його як будь-який літак.
// Летить від свого краю карти, погойдуючись, скидає парашутистів біля точки виклику, розвертається й летить назад.
// Вільний слот пулу стоїть у стані PLANE_RESPAWNING і сам не з'являється.
class Airdrop extends Plane {
    constructor(index) {
        super(index, 'transport');
        this.state = PLANE_RESPAWNING;
        this.lane = 0;
        // 1 — летить праворуч, -1 — ліворуч; після скидання змінюється на зворотний.
        this.heading = 1;
        this.troopersLeft = 0;
        this.nextDropX = 0;
    }

    // Бере вільний десантний літак з пулу; false, якщо всі в повітрі.
    static call(team, lane, dropX) {
        const airdrop = battle.planes.find(plane => plane instanceof Airdrop && plane.state === PLANE_RESPAWNING);

        if (!airdrop) {
            return false;
        }

        airdrop.launch(team, lane, dropX);
        return true;
    }

    // На старті бою (battle.deployInitialForces) десантний літак не злітає: лише за викликом легенди.
    spawn() {}

    launch(team, lane, dropX) {
        this.team = team;
        this.lane = lane;
        this.flightLane = lane;
        this.crashLane = -1;
        this.state = PLANE_FLYING;
        this.health = this.stats.health;
        this.generation++;
        this.heading = team === 0 ? 1 : -1;
        this.x = team === 0 ? -AIRDROP_ENTRY_MARGIN : world.width + AIRDROP_ENTRY_MARGIN;
        this.y = world.groundLevel() - AIRDROP_ALTITUDE;
        this.angle = team === 0 ? 0 : Math.PI;
        this.velocityX = Math.cos(this.angle) * this.stats.speed;
        this.velocityY = 0;
        this.smokeTimer = 0;
        this.troopersLeft = AIRDROP_TROOPERS;
        // Парашутисти падають рівномірно навколо точки скидання: перший — трохи до неї.
        this.nextDropX = dropX - this.heading * AIRDROP_SPACING * (AIRDROP_TROOPERS - 1) / 2;
    }

    update(deltaTime, time) {
        if (this.state === PLANE_FALLING) {
            this.updateFalling(deltaTime);
        } else if (this.state === PLANE_FLYING) {
            this.updateFlying(deltaTime, time);
        }
    }

    updateFlying(deltaTime, time) {
        Movement.steerAirdrop(this, deltaTime, time);
        Movement.flyPlane(this, deltaTime);
        this.emitTrail(deltaTime);

        if (this.troopersLeft > 0) {
            this.tryDropTrooper();
        } else if (Movement.isPlaneOutsideField(this)) {
            // Повернувся за свій край карти — слот вільний.
            this.state = PLANE_RESPAWNING;
        }
    }

    tryDropTrooper() {
        if ((this.x - this.nextDropX) * this.heading < 0) {
            return;
        }

        GroundUnit.deployParatrooper(this.team, this.lane, this.x, this.y + 6);
        this.troopersLeft--;
        this.nextDropX += this.heading * AIRDROP_SPACING;

        // Останній парашутист вистрибнув — розворот додому.
        if (this.troopersLeft === 0) {
            this.heading = -this.heading;
        }
    }

    draw(time) {
        Art.drawPlane(this, time, 'bomber');
    }
}
