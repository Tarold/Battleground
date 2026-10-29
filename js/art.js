'use strict';

// Уся ASCII-графіка: спрайти сутностей і функції їх малювання.
const Art = {
    SMOKE_CHARACTERS: ['@', '%', '#', '*', '+', ':', '.'],

    PLANE_SPRITES: {
        fighter: { text: '0̳̅=/̸̚', offsetX: 0 },
        bomber: { text: '0̳̅0̳̅==/̸̚', offsetX: -15 }
    },

    VEHICLE_SPRITES: {
        [TANK]: { top: '[=O=]', topY: -3, bottom: 'o===o' },
        [ANTIAIRCRAFT]: { top: '[AA]', topY: -4, bottom: 'o===o' },
        [ARTILLERY]: { top: '[##]', topY: -3, bottom: 'O===O' }
    },

    // --- Scene -------------------------------------------------------------

    drawBackground() {
        context.fillStyle = '#0c0c10';
        context.fillRect(0, 0, world.width, world.height);

        context.strokeStyle = '#3d473d';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(0, world.groundLevel() + 9);
        context.lineTo(world.width, world.groundLevel() + 9);
        context.stroke();

        context.font = 'bold 14px monospace';
        context.textAlign = 'left';
        context.fillStyle = TEAM_COLORS[0];
        context.fillText('[HQ-ALPHA]', 16, world.groundLevel() + 33);
        context.textAlign = 'right';
        context.fillStyle = TEAM_COLORS[1];
        context.fillText('[HQ-OMEGA]', world.width - 16, world.groundLevel() + 33);
        context.textAlign = 'left';
    },

    // --- Ground units ------------------------------------------------------

    drawGroundUnit(unit, time) {
        const direction = unit.team === 0 ? 1 : -1;
        const scale = LANE_SCALES[unit.lane];

        context.save();
        context.translate(unit.x, unit.y);
        context.scale(scale, scale);
        context.globalAlpha = 0.6 + unit.lane * 0.2;
        context.fillStyle = TEAM_COLORS[unit.team];
        context.strokeStyle = TEAM_COLORS[unit.team];
        context.textAlign = 'center';
        context.font = 'bold 13px monospace';

        if (unit.type === INFANTRY) {
            this.drawInfantry(unit, direction, time);
        } else {
            this.drawVehicle(unit, direction);
        }

        context.restore();
    },

    drawInfantry(unit, direction, time) {
        const step = unit.moving && Math.sin(time * 10 + unit.animationPhase) > 0;
        const head = direction === 1
            ? (step ? 'o/' : 'o-')
            : (step ? '\\o' : '-o');

        context.fillText(head, 0, -5);
        context.fillText(step ? '/\\' : '|\\', 0, 5);
    },

    // У русі ствол опущений у похідне положення.
    barrelAngle(unit, direction) {
        if (!unit.moving) {
            return unit.aimAngle;
        }

        if (unit.type === ANTIAIRCRAFT) {
            return direction === 1 ? -0.65 : -Math.PI + 0.65;
        }

        if (unit.type === ARTILLERY) {
            return direction === 1 ? -0.45 : -Math.PI + 0.45;
        }

        return direction === 1 ? 0 : Math.PI;
    },

    drawVehicle(unit, direction) {
        const sprite = this.VEHICLE_SPRITES[unit.type];

        context.font = 'bold 14px monospace';
        context.fillText(sprite.top, 0, sprite.topY);
        context.fillText(sprite.bottom, 0, 5);

        const barrelAngle = this.barrelAngle(unit, direction);
        const barrelLength = unit.type === ARTILLERY ? 29 : 22;
        const barrelX = Math.cos(barrelAngle) * barrelLength;
        const barrelY = -12 + Math.sin(barrelAngle) * barrelLength;

        context.lineWidth = unit.type === ARTILLERY ? 3 : 2;
        context.beginPath();
        context.moveTo(0, -12);
        context.lineTo(barrelX, barrelY);

        if (unit.type === ANTIAIRCRAFT) {
            context.moveTo(5, -12);
            context.lineTo(barrelX + 5, barrelY);
        }

        context.stroke();
    },

    // --- Planes ------------------------------------------------------------

    drawPlane(plane) {
        const sprite = this.PLANE_SPRITES[plane.bomber ? 'bomber' : 'fighter'];

        context.save();
        context.translate(plane.x, plane.y);
        context.rotate(plane.angle);

        if (Math.cos(plane.angle) < 0) {
            context.scale(1, -1);
        }

        context.scale(-1, 1);
        context.fillStyle = plane.state === PLANE_FALLING ? '#ff4422' : TEAM_COLORS[plane.team];
        context.textAlign = 'center';
        context.font = 'bold 20px monospace';
        context.fillText(sprite.text, sprite.offsetX, 6);

        context.restore();
    },

    // --- Projectiles -------------------------------------------------------

    projectileSymbol(projectile) {
        if (projectile.rocket) {
            return projectile.big ? '=##>' : '=>';
        }

        if (projectile.bomb) {
            return '<●>';
        }

        if (projectile.shell) {
            return '●';
        }

        return projectile.heavy ? '•' : '-';
    },

    projectileColor(projectile) {
        if (projectile.rocket) {
            return projectile.big ? '#ff5533' : '#ffb347';
        }

        if (projectile.bomb) {
            return '#ff9933';
        }

        return projectile.heavy ? '#ffd966' : '#ffffff';
    },

    drawProjectile(projectile) {
        context.save();
        context.translate(projectile.x, projectile.y);
        context.rotate(projectile.angle);
        context.fillStyle = this.projectileColor(projectile);
        context.font = projectile.big ? 'bold 19px monospace' : 'bold 15px monospace';
        context.fillText(this.projectileSymbol(projectile), -4, 4);
        context.restore();
    },

    // --- Smoke -------------------------------------------------------------

    drawSmoke(smoke) {
        const progress = 1 - smoke.life / smoke.maximumLife;
        const characterIndex = Math.min(
            Math.floor(progress * this.SMOKE_CHARACTERS.length),
            this.SMOKE_CHARACTERS.length - 1
        );

        context.font = '14px monospace';
        context.globalAlpha = smoke.life / smoke.maximumLife * 0.75;

        if (smoke.fire && progress < 0.45) {
            context.fillStyle = progress < 0.2 ? '#ffe65a' : '#ff6e28';
        } else {
            context.fillStyle = '#9ba0aa';
            context.globalAlpha *= 0.7;
        }

        context.fillText(this.SMOKE_CHARACTERS[characterIndex], smoke.x, smoke.y);
        context.globalAlpha = 1;
    }
};
