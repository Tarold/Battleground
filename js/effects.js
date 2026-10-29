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
    return smoke;
}

// Висока вертикальна хмара важкої бомби: стовп диму, що росте вгору, з "шапкою".
function spawnBombCloud(x, y, scale = 1) {
    const stemCount = Math.round(28 * scale);
    const capCount = Math.round(22 * scale);

    for (let index = 0; index < stemCount; index++) {
        const height = index / Math.max(1, stemCount - 1);
        const smoke = spawnSmoke(
            x + (Math.random() - 0.5) * 10,
            y,
            (Math.random() - 0.5) * 16,
            0,
            height < 0.35,
            2.2
        );
        smoke.maximumLife *= 1.4;
        smoke.life = smoke.maximumLife;
        smoke.velocityY = -(15 + height * 55) - Math.random() * 8;
    }

    for (let index = 0; index < capCount; index++) {
        const angle = (index / capCount) * Math.PI * 2;
        const smoke = spawnSmoke(x, y, 0, 0, false, 2.2);
        smoke.maximumLife *= 1.4;
        smoke.life = smoke.maximumLife;
        smoke.velocityX = Math.cos(angle) * (15 + Math.random() * 20);
        smoke.velocityY = -70 + Math.sin(angle) * 8 - Math.random() * 6;
    }
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

// Великий напис над юнітом (підвищення до легенди).
class Banner {
    constructor() {
        this.active = false;
        this.x = 0;
        this.y = 0;
        this.text = '';
        this.life = 0;
    }

    launch(x, y, text) {
        this.active = true;
        this.x = x;
        this.y = y;
        this.text = text;
        this.life = LEGEND_BANNER_LIFE;
    }

    update(deltaTime) {
        this.life -= deltaTime;
        this.y -= 18 * deltaTime;

        if (this.life <= 0) {
            this.active = false;
        }
    }

    draw() {
        Art.drawBanner(this);
    }
}

let bannerIndex = 0;

function spawnBanner(x, y, text) {
    const banner = battle.banners[bannerIndex];
    bannerIndex = (bannerIndex + 1) % battle.banners.length;
    banner.launch(x, y, text);
}

// Підвищення до легенди: стовп світла, ударне кільце, напис і уповільнення часу.
function spawnLegendEffect(x, y, name) {
    for (let index = 0; index < 16; index++) {
        spawnSmoke(x, y - index * 14, 0, -150, true, 1.4);
    }

    const ringCount = 28;

    for (let index = 0; index < ringCount; index++) {
        const angle = (index / ringCount) * Math.PI * 2;
        spawnSmoke(x, y, Math.cos(angle) * 150, Math.sin(angle) * 35, true, 1.2);
    }

    spawnBanner(x, y - 45, '★ LEGENDARY ' + name + ' ★');
    battle.slowTimer = LEGEND_SLOWMO_TIME;
}

// Ядерний вибух: гриб, ударна хвиля, білий спалах на весь екран.
function spawnNuclearExplosion(x, y) {
    spawnExplosion(x, y, 120);
    spawnBombCloud(x, y, 2.5);

    const ringCount = 48;

    for (let index = 0; index < ringCount; index++) {
        const angle = (index / ringCount) * Math.PI * 2;
        spawnSmoke(x, y, Math.cos(angle) * 420, Math.sin(angle) * 60, true, 1.5);
    }

    battle.flash = 1;
    battle.slowTimer = NUKE_SLOWMO_TIME;
}

// Шкода по наземних ворожих юнітах у радіусі вибуху на заданій лінії.
function damageArea(x, radius, damage, team, targetLane, owner = null) {
    if (targetLane < 0) {
        return;
    }

    for (const unit of battle.groundUnits) {
        if (!unit.active || unit.team === team || unit.lane !== targetLane) {
            continue;
        }

        const distance = Math.abs(unit.x - x);

        if (distance < radius) {
            unit.takeDamage(damage * (1 - distance / radius * 0.6), owner);
        }
    }
}

// Шкода по літаках у радіусі вибуху ракети (team -1 зачіпає всіх).
function damagePlanesArea(x, y, radius, damage, team, owner = null) {
    for (const plane of battle.planes) {
        if (plane.team === team || plane.state !== PLANE_FLYING) {
            continue;
        }

        const distance = Math.hypot(plane.x - x, plane.y - y);

        if (distance < radius) {
            plane.takeDamage(damage * (1 - distance / radius * 0.5), owner);
        }
    }
}
