'use strict';

// Уся логіка руху та балістики. Нічого не малює і не створює сутностей:
// лише змінює координати/кути переданих об'єктів або повертає розрахунки.
const Movement = {
    // --- Ground units ------------------------------------------------------

    advanceGroundUnit(unit, deltaTime) {
        const direction = unit.team === 0 ? 1 : -1;
        unit.x += direction * UNIT_STATS[unit.type].speed * deltaTime;
    },

    isOutsideField(unit) {
        return unit.x < 25 || unit.x > world.width - 25;
    },

    keepGroundUnitOnField(unit) {
        unit.x = clamp(unit.x, 20, world.width - 20);
        unit.y = world.laneLevel(unit.lane);
    },

    // --- Projectiles and smoke ---------------------------------------------

    stepProjectile(projectile, deltaTime) {
        projectile.previousX = projectile.x;
        projectile.previousY = projectile.y;
        projectile.x += projectile.velocityX * deltaTime;
        projectile.y += projectile.velocityY * deltaTime +
            projectile.gravity * deltaTime * deltaTime * 0.5;
        projectile.velocityY += projectile.gravity * deltaTime;
        projectile.angle = Math.atan2(projectile.velocityY, projectile.velocityX);
    },

    // Самонавідна ракета: повертає вектор швидкості до цілі, зберігаючи швидкість.
    guideRocket(rocket, deltaTime) {
        const target = rocket.homingTarget;

        if (!target) {
            return;
        }

        if (target.state !== PLANE_FLYING) {
            rocket.homingTarget = null;
            return;
        }

        const currentAngle = Math.atan2(rocket.velocityY, rocket.velocityX);
        const desiredAngle = Math.atan2(target.y - rocket.y, target.x - rocket.x);
        const angleDifference = Math.atan2(
            Math.sin(desiredAngle - currentAngle),
            Math.cos(desiredAngle - currentAngle)
        );
        const maximumTurn = rocket.turnRate * deltaTime;
        const heading = currentAngle + clamp(angleDifference, -maximumTurn, maximumTurn);

        rocket.velocityX = Math.cos(heading) * rocket.speed;
        rocket.velocityY = Math.sin(heading) * rocket.speed;
    },

    isProjectileOutOfBounds(projectile) {
        return projectile.x < -100 || projectile.x > world.width + 100 ||
            projectile.y > world.height + 100;
    },

    stepSmoke(smoke, deltaTime) {
        smoke.x += smoke.velocityX * deltaTime;
        smoke.y += smoke.velocityY * deltaTime;
    },

    // --- Planes ------------------------------------------------------------

    keepPlaneOnField(plane) {
        plane.x = clamp(plane.x, 30, world.width - 30);
        plane.y = clamp(plane.y, 35, world.groundLevel() - 80);
    },

    // Плавно повертає літак: розвертається біля країв, тримає висоту.
    steerPlane(plane, deltaTime, time) {
        const floor = world.groundLevel();
        const horizontalMargin = Math.min(150, world.width * 0.23);
        const stats = plane.stats;

        if (plane.x > world.width - horizontalMargin) {
            plane.targetAngle = Math.PI;
        } else if (plane.x < horizontalMargin) {
            plane.targetAngle = 0;
        }

        const wave = Math.sin(time * 1.6 + plane.phase) * stats.wobble;
        let desiredAngle = plane.targetAngle + wave;

        if (plane.y > floor - 100) {
            desiredAngle = Math.cos(plane.angle) > 0 ? -0.65 : Math.PI + 0.65;
        } else if (plane.y < 55) {
            desiredAngle = Math.cos(plane.angle) > 0 ? 0.65 : Math.PI - 0.65;
        }

        const angleDifference = Math.atan2(
            Math.sin(desiredAngle - plane.angle),
            Math.cos(desiredAngle - plane.angle)
        );

        plane.angle += angleDifference * deltaTime * stats.turnRate;
    },

    flyPlane(plane, deltaTime) {
        const speed = plane.stats.speed;

        plane.velocityX = Math.cos(plane.angle) * speed;
        plane.velocityY = Math.sin(plane.angle) * speed;
        plane.x += plane.velocityX * deltaTime;
        plane.y += plane.velocityY * deltaTime;
    },

    fallPlane(plane, deltaTime) {
        plane.velocityY += PLANE_FALL_GRAVITY * deltaTime;
        plane.x += plane.velocityX * deltaTime;
        plane.y += plane.velocityY * deltaTime;
        plane.angle = Math.atan2(plane.velocityY, plane.velocityX);
    },

    isPlaneOutsideField(plane) {
        return plane.x < -100 || plane.x > world.width + 100;
    },

    // Де впаде бомба, скинута зараз, якщо ціль на висоті targetY.
    bombLandingX(plane, targetY) {
        const fallDistance = Math.max(0, targetY - plane.y - 10);
        const fallTime = (Math.sqrt(400 + 2 * GRAVITY * fallDistance) - 20) / GRAVITY;

        return plane.x + plane.velocityX * BOMB_HORIZONTAL_FACTOR * fallTime;
    },

    // Косинус кута між курсом літака та напрямком на точку (1 = точно по курсу).
    alignment(plane, targetX, targetY) {
        const distanceX = targetX - plane.x;
        const distanceY = targetY - plane.y;
        const distance = Math.hypot(distanceX, distanceY);

        if (distance <= 1) {
            return { distance, alignment: -1 };
        }

        const forwardX = Math.cos(plane.angle);
        const forwardY = Math.sin(plane.angle);

        return { distance, alignment: (distanceX * forwardX + distanceY * forwardY) / distance };
    },

    // --- Ballistics --------------------------------------------------------

    // Навісна траєкторія: фіксований час польоту, гравітація діє на снаряд.
    lobbedShot(horizontalDistance, verticalDistance, flightTime, explosionRadius) {
        return {
            velocityX: horizontalDistance / flightTime,
            velocityY: (verticalDistance - 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
            gravity: GRAVITY,
            explosionRadius
        };
    },

    artilleryShot(horizontalDistance, verticalDistance) {
        const flightTime = clamp(Math.abs(horizontalDistance) / 145, 1.25, 3.5);

        return this.lobbedShot(horizontalDistance, verticalDistance, flightTime, ARTILLERY_EXPLOSION_RADIUS);
    },

    grenadeShot(horizontalDistance, verticalDistance) {
        const flightTime = clamp(Math.abs(horizontalDistance) / 120, 0.5, 1.3);

        return this.lobbedShot(horizontalDistance, verticalDistance, flightTime, GRENADE_RADIUS);
    },

    // Пряме влучання зі швидким снарядом; по літаку цілиться з випередженням.
    directShot(unit, target, muzzleY, airborne, offset) {
        const horizontalDistance = target.x - unit.x;
        const verticalDistance = target.y - 7 - muzzleY;
        const speed = unit.type === ANTIAIRCRAFT ? 430 : 350;
        let aimX = target.x;
        let aimY = target.y - 7;

        if (airborne) {
            const flightTime = Math.hypot(horizontalDistance, verticalDistance) / speed;
            aimX += target.velocityX * flightTime;
            aimY += target.velocityY * flightTime;
        }

        const aimAngle = Math.atan2(aimY - muzzleY, aimX - unit.x);
        const spread = (Math.random() - 0.5) * (unit.type === INFANTRY ? 0.035 : 0.018) +
            offset * MULTISHOT_ANGLE;

        return {
            velocityX: Math.cos(aimAngle + spread) * speed,
            velocityY: Math.sin(aimAngle + spread) * speed,
            gravity: 0,
            explosionRadius: 0
        };
    },

    // Кут і швидкість пострілу зі стволу наземного юніта по цілі.
    // offset (-2..2) зміщує постріл у багатоствольному залпі; 0 = без зміщення.
    groundShot(unit, target, muzzleY, airborne, offset = 0) {
        if (unit.type === ARTILLERY) {
            const jitter = offset === 0 ? 0 : (Math.random() - 0.5) * 12;

            return this.artilleryShot(
                target.x - unit.x + offset * ARTILLERY_BARRAGE_SPREAD + jitter,
                target.y - 7 - muzzleY
            );
        }

        return this.directShot(unit, target, muzzleY, airborne, offset);
    }
};
