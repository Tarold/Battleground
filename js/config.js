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
const UNIT_STATS = [
    { health: 2, speed: 30, range: 145, reload: 0.8,  damage: 1 }, // INFANTRY
    { health: 9, speed: 22, range: 245, reload: 1.65, damage: 3 }, // TANK
    { health: 6, speed: 25, range: 430, reload: 0.5,  damage: 2 }, // ANTIAIRCRAFT
    { health: 5, speed: 17, range: 650, reload: 3.8,  damage: 6 }  // ARTILLERY
];

const ANTIAIRCRAFT_GROUND_RANGE = 260;
const ARTILLERY_MINIMUM_RANGE = 110;
const ARTILLERY_EXPLOSION_RADIUS = 72;

const PLANE_STATS = {
    fighter: {
        health: 3, speed: 180, turnRate: 3.5, wobble: 0.48,
        trailInterval: 0.04, fireInterval: 0.13,
        halfWidth: 20, halfHeight: 10
    },
    bomber: {
        health: 7, speed: 125, turnRate: 2.3, wobble: 0.24,
        trailInterval: 0.055, fireInterval: 0.25,
        halfWidth: 28, halfHeight: 13
    }
};

const BOMB_DAMAGE = 7;
const BOMB_RADIUS = 78;
const BOMB_RELOAD = 1.4;
const BOMB_HORIZONTAL_FACTOR = 0.65;
const BOMB_TARGETING_TOLERANCE = 95;
const PLANE_GUN_SPEED = 470;
const PLANE_FALL_GRAVITY = 240;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
