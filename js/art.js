'use strict';

// Уся ASCII-графіка: спрайти сутностей і функції їх малювання.
const Art = {
    SMOKE_CHARACTERS: ['@', '%', '#', '*', '+', ':', '.'],

    // Спрайти літаків носом праворуч: шари тексту (column — колонка символів, row — рядок 0..2
    // з кроком PLANE_LINE_HEIGHT, можна дробові) накладаються, як у техніки. Гвинти крутяться за кадрами.
    // Для бомбардувальника корпус «сосиска»: _ з надкресленням, гвинт попереду крила.
    PLANE_SPRITES: {
        fighter: {
            columns: 6,
            layers: [
                { text: '(\\_', column: 0, row: 0 },
                { text: ' ===]', column: 0, row: 1 },
                { text: '\\/', column: 2.5, row: 2 }
            ],
            props: [{ column: 5, rows: [1] }]
        },
        bomber: {
            columns: 9,
            layers: [
                { text: '(‾\\', column: 0, row: 0 },
                { text: '-\u0305' + '=\u0305'.repeat(2) + ' \u0305'.repeat(3) + '_)', column: 1, row: 1 },
                { text: '\\_/', column: 4, row: 2 }
            ],
            props: [{ column: 7, rows: [2] }]
        }
    },

    // Кадри гвинта: [верх, центр, низ].
    PROP_FRAMES: [
        ['|', '|', '|'],
        [':', ':', ':']
    ],

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

        if (unit.legendary) {
            context.shadowColor = LEGEND_COLOR;
            context.shadowBlur = 10;
        }

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

        if (unit.legendary) {
            this.drawLegendStar(0, unit.type === INFANTRY ? -20 : -30, time);
        }

        context.restore();
    },

    // Золота зірка над легендою, що пульсує.
    drawLegendStar(x, y, time) {
        context.globalAlpha = 0.7 + Math.sin(time * 6) * 0.3;
        context.fillStyle = LEGEND_COLOR;
        context.font = 'bold 16px monospace';
        context.fillText('★', x, y);
        context.globalAlpha = 1;
    },

    drawInfantry(unit, direction, time) {
        if (unit.prone) {
            // Лежачий піхотинець: тулуб і зброя вздовж землі.
            context.fillText(direction === 1 ? '_o=-' : '-=o_', 0, 5);
            return;
        }

        const step = unit.moving && Math.sin(time * 10 + unit.animationPhase) > 0;
        const head = direction === 1
            ? (step ? 'o/' : 'o-')
            : (step ? '\\o' : '-o');

        context.fillText(head, 0, -5);
        context.fillText(step ? '/\\' : '|\\', 0, 5);

        // Труба видна лише коли піхотинець стоїть і цілиться (за спиною — не малюємо).
        if (unit.legendary && unit.rpgStance > 0) {
            this.drawRpgTube(direction, -6, 0);
        }
    },

    // Труба РПГ у руках: товста лінія з бойовою частиною спереду, tilt — нахил від горизонту вгору (0 = паралельно землі).
    drawRpgTube(direction, y, tilt) {
        const angle = -tilt;
        const length = 20;
        const backX = -direction * 7;
        const frontX = backX + direction * Math.cos(angle) * length;
        const frontY = y + Math.sin(angle) * length;

        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(backX, y);
        context.lineTo(frontX, frontY);
        context.stroke();

        // Бойова частина на передньому кінці.
        context.beginPath();
        context.arc(frontX, frontY, 2.5, 0, Math.PI * 2);
        context.fill();
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

        if (unit.type === TANK && unit.legendary) {
            context.moveTo(0, -7);
            context.lineTo(barrelX, barrelY + 5);
        }

        if (unit.type === ANTIAIRCRAFT) {
            context.moveTo(5, -12);
            context.lineTo(barrelX + 5, barrelY);
        }

        context.stroke();
    },

    // --- Planes ------------------------------------------------------------

    drawPlane(plane, time) {
        const sprite = this.PLANE_SPRITES[plane.bomber ? 'bomber' : 'fighter'];

        context.save();
        context.translate(plane.x, plane.y);
        context.rotate(plane.angle);

        if (plane.legendary) {
            context.shadowColor = LEGEND_COLOR;
            context.shadowBlur = 12;
        }

        if (Math.cos(plane.angle) < 0) {
            context.scale(1, -1);
        }

        context.fillStyle = plane.state === PLANE_FALLING ? '#ff4422' : TEAM_COLORS[plane.team];
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.font = `bold ${PLANE_FONT_SIZE}px monospace`;

        const charWidth = context.measureText('M').width;
        const left = -sprite.columns * charWidth / 2;
        const propFrame = this.PROP_FRAMES[plane.state === PLANE_FALLING ? 0 : Math.floor(time * PLANE_PROP_FPS) % this.PROP_FRAMES.length];

        for (const layer of sprite.layers) {
            context.fillText(layer.text, left + layer.column * charWidth, (layer.row - 1) * PLANE_LINE_HEIGHT);
        }

        for (const prop of sprite.props) {
            for (const row of prop.rows) {
                context.fillText(propFrame[row], left + prop.column * charWidth, (row - 1) * PLANE_LINE_HEIGHT);
            }
        }

        context.restore();

        if (plane.legendary && plane.state === PLANE_FLYING) {
            context.save();
            context.textAlign = 'center';
            this.drawLegendStar(plane.x, plane.y - 24, time);
            context.restore();
        }
    },

    // Гелікоптер: ротор, що блимає (обертається), корпус носом у бік facing, полози; турель малюється окремо.
    drawHelicopter(heli, time) {
        const falling = heli.state === PLANE_FALLING;

        context.save();
        context.translate(heli.x, heli.y);
        // Збитий гелікоптер закручується.
        context.rotate(falling ? time * 7 : heli.tilt);
        context.scale(heli.facing, 1);

        if (heli.legendary) {
            context.shadowColor = LEGEND_COLOR;
            context.shadowBlur = 12;
        }

        const color = falling ? '#ff4422' : TEAM_COLORS[heli.team];

        context.fillStyle = color;
        context.strokeStyle = color;
        context.textAlign = 'center';
        context.font = 'bold 14px monospace';
        context.fillText(Math.sin(time * 40) > 0 ? '‾‾‾‾+‾‾‾‾' : '‾‾ + ‾‾', 3, -6);
        context.fillText('+=-[O>', 0, 5);

        // Полози.
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(-4, 11);
        context.lineTo(14, 11);
        context.stroke();

        // Ракетний блок легенди під корпусом.
        if (heli.legendary) {
            context.fillText('=', 2, 13);
        }

        context.restore();

        if (falling) {
            return;
        }

        // Кулеметна турель під носом, кут у світових координатах.
        const muzzle = heli.muzzle;

        context.save();
        context.strokeStyle = TEAM_COLORS[heli.team];
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(muzzle.x, muzzle.y);
        context.lineTo(muzzle.x + Math.cos(heli.turretAngle) * 9, muzzle.y + Math.sin(heli.turretAngle) * 9);
        context.stroke();

        if (heli.legendary) {
            context.textAlign = 'center';
            this.drawLegendStar(heli.x, heli.y - 20, time);
        }

        context.restore();
    },

    // --- Projectiles -------------------------------------------------------

    projectileSymbol(projectile) {
        if (projectile.rocket) {
            return projectile.big ? '=##>' : '=>';
        }

        if (projectile.nuke) {
            return '<@>';
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
            return projectile.big ? TEAM_COLORS[projectile.team] : '#ffb347';
        }

        if (projectile.nuke) {
            return '#ffffff';
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

    // --- Banners and flash -------------------------------------------------

    drawBanner(banner) {
        const fade = Math.min(1, banner.life / (LEGEND_BANNER_LIFE * 0.4));

        context.save();
        context.textAlign = 'center';
        context.font = 'bold 20px monospace';
        context.globalAlpha = fade;
        context.fillStyle = LEGEND_COLOR;
        context.shadowColor = LEGEND_COLOR;
        context.shadowBlur = 12;
        context.fillText(banner.text, clamp(banner.x, 140, world.width - 140), banner.y);
        context.restore();
    },

    // Таблиця "найкращий рахунок / потрібно до легенди" для обох команд.
    drawScores(teams) {
        const lineHeight = 20;
        const format = value => Number.isInteger(value) ? String(value) : value.toFixed(1);

        context.save();
        context.font = 'bold 14px monospace';
        context.textBaseline = 'top';

        teams.forEach((rows, team) => {
            const x = team === 0 ? 16 : world.width - 16;

            context.textAlign = team === 0 ? 'left' : 'right';
            context.fillStyle = TEAM_COLORS[team];
            context.fillText(team === 0 ? 'ALPHA — TOP SCORE' : 'OMEGA — TOP SCORE', x, 14);

            rows.forEach((row, index) => {
                const score = row.legendary
                    ? '★ LEGEND'
                    : format(Math.min(row.kills, row.needed)) + '/' + format(row.needed);

                context.fillStyle = row.legendary ? LEGEND_COLOR : TEAM_COLORS[team];
                context.fillText(row.name + ' ' + score, x, 38 + index * lineHeight);
            });
        });

        context.restore();
    },

    // Білий спалах на весь екран (ядерний вибух).
    drawFlash(amount) {
        context.save();
        context.globalAlpha = Math.min(1, amount);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, world.width, world.height);
        context.restore();
    },

    // Напис угорі екрана при вмиканні/вимиканні режиму гравця: показується кілька секунд і згасає.
    drawPlayerMode() {
        context.save();
        context.globalAlpha = Math.min(1, player.messageTimer / PLAYER_MESSAGE_FADE);
        context.textAlign = 'center';
        context.font = 'bold 18px monospace';
        context.fillStyle = player.enabled ? PLAYER_MODE_COLOR : PLAYER_MODE_OFF_COLOR;
        context.fillText(player.message, world.width / 2, 28);
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
