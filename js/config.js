'use strict';

// ---------------------------------------------------------------------------
// Canvas and world geometry
// ---------------------------------------------------------------------------

const canvas = document.getElementById('battlefield');
const context = canvas.getContext('2d');

const world = {
    width: window.innerWidth,
    height: window.innerHeight,

    resize() {
        this.width = canvas.width = window.innerWidth;
        this.height = canvas.height = window.innerHeight;
    },

    groundLevel() {
        return this.height - 60;
    },

    laneLevel(lane) {
        return this.groundLevel() - LANE_OFFSETS[lane];
    },

    // Рівень, на якому снаряд вибухає: лінія цілі або загальна земля.
    impactLevel(targetLane) {
        return targetLane >= 0 ? this.laneLevel(targetLane) : this.groundLevel();
    },

    basePosition(team) {
        const margin = Math.min(115, this.width * 0.18);
        return team === 0 ? margin : this.width - margin;
    }
};

canvas.width = world.width;
canvas.height = world.height;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_COLORS = ['#66c2ff', '#ff7766'];
const GRAVITY = 180;

const INFANTRY = 0;
const TANK = 1;
const ANTIAIRCRAFT = 2;
const ARTILLERY = 3;

const PLANE_FLYING = 0;
const PLANE_FALLING = 1;
const PLANE_RESPAWNING = 2;

const LANE_OFFSETS = [38, 21, 4];
const LANE_SCALES = [0.78, 0.9, 1];

// Параметри наземних юнітів, індекс = тип юніта.
// killValue = скільки вбивств зараховується тому, хто знищив цього юніта (legend.killValue — якщо він легенда).
// legend: kills = скільки вбивств до статусу легенди, health = HP легенди,
// решта полів — перки (shots, missiles, grenades, rockets, regen = HP/с, instantLock = без відліку захоплення). Без health легенда не отримує бонусу HP.
const UNIT_STATS = [
    { name: 'INFANTRY', health: 2, speed: 30, range: 145, reload: 0.8,  damage: 1, killValue: 0.5,
        legend: { kills: 2, health: 5, grenades: true, killValue: 0.5 } },
    { name: 'TANK', health: 9, speed: 22, range: 245, reload: 1.65, damage: 3, killValue: 1,
        legend: { kills: 3, health: 16, shots: 2 } },
    { name: 'ANTI-AIR', health: 4, speed: 25, range: 430, reload: 0.5,  damage: 2, killValue: 1,
        legend: { kills: 5, health: 7, missiles: 2, turretFactor: 2 } },
    { name: 'ARTILLERY', health: 5, speed: 17, range: 650, reload: 3.8,  damage: 6, killValue: 1,
        legend: { kills: 3, health: 9, shots: 5 } }
];

// Швидкість повороту башти зенітки (рад/с) і допуск наведення перед пострілом.
const AA_TURRET_SPEED = 1.4;
const AA_TURRET_TOLERANCE = 0.12;

const ANTIAIRCRAFT_GROUND_RANGE = 260;
const ARTILLERY_MINIMUM_RANGE = 110;
const ARTILLERY_EXPLOSION_RADIUS = 72;

const PLANE_STATS = {
    fighter: {
        name: 'FIGHTER',
        legend: { kills: 3, health: 9, rockets: 2, instantLock: true },
        health: 6, speed: 180, turnRate: 3.5, wobble: 0.48,
        trailInterval: 0.04, fireInterval: 0.13, rocketReload: 4.5,
        halfWidth: 20, halfHeight: 10
    },
    bomber: {
        name: 'BOMBER',
        legend: { kills: 6, health: 10, nuke: true, regen: 0.5 },
        health: 8, speed: 125, turnRate: 2.3, wobble: 0.24,
        trailInterval: 0.055, fireInterval: 0.25,
        halfWidth: 28, halfHeight: 13
    }
};

// Килимове бомбардування: серія дрібніших бомб уздовж курсу бомбардувальника.
const CARPET_BOMB_COUNT = 6;
const CARPET_BOMB_INTERVAL = 0.28;
const CARPET_BOMB_DAMAGE = 4;
const CARPET_BOMB_RADIUS = 54;
const CARPET_RELOAD = 4;
const BOMB_HORIZONTAL_FACTOR = 0.65;
const BOMB_TARGETING_TOLERANCE = 95;
const PLANE_GUN_SPEED = 470;

// Захоплення цілі винищувачем: чим довше ціль у прицілі, тим менший розкид куль.
const PLANE_GUN_SPREAD = 0.045;

// Кулемет винищувача б'є чергами: серія пострілів, потім пауза.
const FIGHTER_BURST_SIZE = 4;
const FIGHTER_BURST_PAUSE = 0.6;
const LOCK_FIRE_DELAY = 0.2;   // пауза між повним захопленням і першим пострілом
const LOCK_TIME = 0.6;
const LOCK_PRECISION = 0.97;
const LOCK_WOBBLE_DAMPING = 0.9;
const PURSUIT_WOBBLE = 0.2;
const PLANE_PURSUIT_RANGE = 1000;
const PURSUIT_CONE = 0.35;
const PURSUIT_TURN_FACTOR = 0.4;
const TARGET_SWITCH_DELAY = 1.8;

// Ракети літаків: повітря-повітря (самонавідні) та повітря-земля (прямі).
const ROCKET_LAUNCH_SPEED = 170;
const AIR_ROCKET_DAMAGE = 3;
const AIR_ROCKET_RANGE = 520;
const AIR_ROCKET_TURN_RATE = 2.6;
const AIR_ROCKET_BLAST_RADIUS = 48;
const GROUND_ROCKET_DAMAGE = 4;
const GROUND_ROCKET_RANGE = 480;
const GROUND_ROCKET_RADIUS = 50;

// Велика зенітна ракета наземного ЗРК.
const AA_MISSILE_RANGE = 580;
const AA_MISSILE_RELOAD = 7;
const AA_MISSILE_SPEED = 250;
const AA_MISSILE_TURN_RATE = 2.2;
const AA_MISSILE_INTERVAL = 0.7;
// Одна ракета ППО вбиває звичайний винищувач (HP 6), але не легендарний (HP 9): для нього потрібні дві.
// Радіо-підрив діє на відстані до 0.55 радіуса, тож мінімальна шкода ≈ 0.72 від повної.
const AA_MISSILE_DAMAGE = 8.8;
const AA_MISSILE_BLAST_RADIUS = 75;
const PLANE_FALL_GRAVITY = 240;

// Ракета, що промахнулась (ціль збита або лишилась позаду), шукає нову ціль у конусі попереду.
const ROCKET_MISS_GRACE = 0.8;
const ROCKET_RETARGET_RANGE = 420;
const ROCKET_RETARGET_CONE = 0.78;

// Вбивство бомбардувальника зараховується як кілька вбивств.
const BOMBER_KILL_VALUE = 2;

// Легенди: ефект підвищення та перки.
const LEGEND_COLOR = '#ffd700';
const LEGEND_SLOWMO_TIME = 0.5;
const LEGEND_SLOWMO_SCALE = 0.25;
const LEGEND_BANNER_LIFE = 2.4;

// Протитанкові гранати легендарної піхоти.
const GRENADE_RANGE = 190;
const GRENADE_RELOAD = 3.5;
const GRENADE_DAMAGE = 5;
const GRENADE_RADIUS = 38;

// Багатоствольна стрільба: кутовий розкид стволів і розкид залпу артилерії.
const MULTISHOT_ANGLE = 0.04;
const ARTILLERY_BARRAGE_SPREAD = 38;

// Ядерна бомба легендарного бомбардувальника (б'є по всіх, включно зі своїми).
const NUKE_DAMAGE = 14;
const NUKE_RADIUS = 280;
const NUKE_RELOAD = 12;
const NUKE_SLOWMO_TIME = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
