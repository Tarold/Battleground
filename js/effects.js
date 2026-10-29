'use strict';

class Smoke {
    constructor() {
        this.active = false;
        this.x = 0;
        this.y = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.life = 0;
        this.maximumLife = 1;
        this.fire = false;
    }

    launch(x, y, velocityX, velocityY, fire, lifeScale) {
        this.active = true;
        this.x = x + (Math.random() - 0.5) * 4;
        this.y = y + (Math.random() - 0.5) * 4;
        this.velocityX = velocityX + (Math.random() - 0.5) * 20;
        this.velocityY = velocityY - 8 - Math.random() * 18;
        this.maximumLife = (0.7 + Math.random() * 0.6) * lifeScale;
        this.life = this.maximumLife;
        this.fire = fire;
    }

    update(deltaTime) {
        this.life -= deltaTime;

        if (this.life <= 0) {
            this.active = false;
            return;
        }

        Movement.stepSmoke(this, deltaTime);
    }

    draw() {
        Art.drawSmoke(this);
    }
}

let smokeIndex = 0;

function spawnSmoke(x, y, velocityX, velocityY, fire = false, lifeScale = 1) {
    const smoke = battle.smoke[smokeIndex];
    smokeIndex = (smokeIndex + 1) % battle.smoke.length;
    smoke.launch(x, y, velocityX, velocityY, fire, lifeScale);
}

function spawnExplosion(x, y, count = 22) {
    for (let index = 0; index < count; index++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * 110;

        spawnSmoke(
            x,
            y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 25,
            true,
            1.1
        );
    }
}

// Шкода по наземних ворожих юнітах у радіусі вибуху на заданій лінії.
function damageArea(x, radius, damage, team, targetLane) {
    if (targetLane < 0) {
        return;
    }

    for (const unit of battle.groundUnits) {
        if (!unit.active || unit.team === team || unit.lane !== targetLane) {
            continue;
        }

        const distance = Math.abs(unit.x - x);

        if (distance < radius) {
            unit.takeDamage(damage * (1 - distance / radius * 0.6));
        }
    }
}
