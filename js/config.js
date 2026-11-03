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
// решта полів — перки (shots, artilleryRockets = залп ракет, pierce = скільки ворогів прошиває снаряд, damage = шкода пострілу легенди, missiles, airdrop = виклик десанту, rockets, regen = HP/с, instantLock = без відліку захоплення). Без health легенда не отримує бонусу HP.
const UNIT_STATS = [
    { name: 'INFANTRY', health: 2, speed: 30, range: 290, reload: 0.8,  damage: 1, killValue: 0.5,
        legend: { kills: 2, health: 5, airdrop: true, killValue: 0.5 } },
    { name: 'TANK', health: 14, speed: 22, range: 245, reload: 1.65, damage: 3, killValue: 1,
        legend: { kills: 3, health: 24, pierce: 1, damage: 5 } },
    { name: 'ANTI-AIR', health: 4, speed: 25, range: 430, reload: 0.5,  damage: 2, killValue: 1,
        legend: { kills: 5, health: 7, missiles: 2, turretFactor: 2 } },
    { name: 'ARTILLERY', health: 5, speed: 17, range: 650, reload: 3.8,  damage: 6, killValue: 1,
        legend: { kills: 3, health: 9, artilleryRockets: 6 } }
];

// Налаштування кількості сутностей (меню на клавіші 2).
// Наземні юніти (індекс = тип, див. UNIT_STATS): defaultCount = скільки їх може бути одночасно (обидві команди разом).
// Літаки: defaultCount = скільки їх літає одночасно (обидві команди разом).
// Повзунок: від 0 до defaultCount * ENTITY_COUNT_MAX_FACTOR.
const ENTITY_COUNT_MAX_FACTOR = 2;
const ENTITY_SETTINGS = [
    { id: 'infantry', label: 'INFANTRY', defaultCount: 30 },
    { id: 'tank', label: 'TANK', defaultCount: 10 },
    { id: 'antiaircraft', label: 'ANTI-AIR', defaultCount: 6 },
    { id: 'artillery', label: 'ARTILLERY', defaultCount: 6 },
    { id: 'fighter', label: 'FIGHTER', defaultCount: 8 },
    { id: 'bomber', label: 'BOMBER', defaultCount: 4 },
    { id: 'heli', label: 'HELICOPTER', defaultCount: 4 }
];

// Поточні значення повзунків: id → кількість.
const settings = {
    counts: Object.fromEntries(ENTITY_SETTINGS.map(entry => [entry.id, entry.defaultCount])),

    maxCount(id) {
        return ENTITY_SETTINGS.find(entry => entry.id === id).defaultCount * ENTITY_COUNT_MAX_FACTOR;
    }
};

// Піхота лягає, коли бачить наземного ворога на своїй лінії ближче за PRONE_SIGHT_RANGE (літаки ігноруються).
// Порядок дистанцій: лягає (PRONE_SIGHT_RANGE) → стріляє з гвинтівки (range піхоти) і повзе →
// на INFANTRY_CRAWL_STOP (у межах RPG_RANGE) зупиняється й б'є з РПГ.
// Лежача піхота: менша ціль для куль, менший радіус ураження вибухами, повзе повільніше, стріляє рідше.
const PRONE_SIGHT_RANGE = 320;
const INFANTRY_CRAWL_STOP = 210;
const PRONE_HOLD_TIME = 1.2;
const PRONE_SPEED_FACTOR = 0.6;
const PRONE_RELOAD_FACTOR = 1.3;
const PRONE_BLAST_FACTOR = 0.45;
const PRONE_HIT_HALF_HEIGHT = 3;
const PRONE_HIT_HALF_WIDTH = 10;

// Вигляд піхоти: гвинтівка — лінія від плеча (X — уперед від центру) під кутом прицілу; у лежачого плече нижче й попереду.
const INFANTRY_RIFLE_X = 3;
const INFANTRY_RIFLE_Y = -4;
const PRONE_HEAD_X = 6;
const PRONE_RIFLE_X = 10;
const PRONE_RIFLE_Y = 0;
const INFANTRY_RIFLE_LENGTH = 11;

// Скільки вбивств отримує піхота за знищення ворожої піхоти (замість killValue піхоти).
const INFANTRY_DUEL_KILL_VALUE = 1;

// Швидкість повороту башти зенітки (рад/с) і допуск наведення перед пострілом.
const AA_TURRET_SPEED = 1.4;
const AA_TURRET_TOLERANCE = 0.12;

// Вигляд зенітки-пікапа: центр башти (X — уперед від центру машини), навколо якого обертаються стволи,
// прозорий зазор від центру до початку стволів і довжина стволів.
const AA_GUN_X = -8;
const AA_GUN_Y = -14;
const AA_GUN_GAP = 5;
const AA_GUN_LENGTH = 18;

// Причіп легенди з двома контейнерами ракет: центр причепа позаду машини, зсуви контейнерів, їхній кут і довжина.
const AA_TRAILER_X = -52;
const AA_POD_OFFSETS = [-5, 4];
const AA_POD_Y = -11;
const AA_POD_ELEVATION = 1.2;
const AA_POD_LENGTH = 12;

const ANTIAIRCRAFT_GROUND_RANGE = 260;
const ARTILLERY_MINIMUM_RANGE = 110;
const ARTILLERY_TURRET_SPEED = 0.9;
const ARTILLERY_TURRET_TOLERANCE = 0.06;
const ARTILLERY_EXPLOSION_RADIUS = 72;

// Вигляд танка: вісь ствола (зсув уперед від центру, висота), довжина ствола.
const TANK_BARREL_X = 9;
const TANK_BARREL_Y = -14;
const TANK_BARREL_LENGTH = 22;

// Вигляд легендарного важкого танка: довша й товща гармата з дульним гальмом, ширший корпус (півширина хітбокса).
const HEAVY_TANK_BARREL_X = 15;
const HEAVY_TANK_BARREL_LENGTH = 30;
const HEAVY_TANK_HIT_HALF_WIDTH = 31;

// Вигляд САУ: вісь ствола (зсув уперед від центру, висота), довжина, підйом ствола в русі (рад).
const ARTILLERY_BARREL_X = 8;
const ARTILLERY_BARREL_Y = -14;
const ARTILLERY_BARREL_LENGTH = 26;
const ARTILLERY_STOWED_ANGLE = 0.12;

// Вигляд легендарної РСЗВ: вісь пакета (від'ємний X — позаду центру), розміри, підйом у русі.
const ROCKET_PACK_X = -21;
const ROCKET_PACK_Y = -12;
const ROCKET_PACK_LENGTH = 26;
const ROCKET_PACK_HEIGHT = 9;
const ROCKET_PACK_STOWED_ANGLE = 0.08;
// Допуск наведення пакета перед залпом (ширший за гармату: кут ракет трохи гуляє).
const ROCKET_PACK_TOLERANCE = 0.15;

// Види літальних апаратів у порядку пулу (battle.planes) і таблиці рахунку.
const PLANE_KINDS = ['fighter', 'bomber', 'heli'];

// crashRadius / crashDamage — шкода по землі, коли збитий апарат падає на лінію.
const PLANE_STATS = {
    fighter: {
        name: 'FIGHTER',
        legend: { kills: 3, health: 9, rockets: 2, instantLock: true },
        health: 6, speed: 180, turnRate: 3.5, wobble: 0.48,
        trailInterval: 0.04, fireInterval: 0.13, rocketReload: 4.5,
        halfWidth: 20, halfHeight: 10, crashRadius: 85, crashDamage: 10
    },
    bomber: {
        name: 'BOMBER',
        legend: { kills: 6, health: 10, nuke: true, regen: 0.5 },
        health: 8, speed: 125, turnRate: 2.3, wobble: 0.24,
        trailInterval: 0.055, fireInterval: 0.25,
        halfWidth: 28, halfHeight: 13, crashRadius: 85, crashDamage: 10
    },
    // Гелікоптер: малий, слабкий, висить низько над полем; кулеметна турель, легенда — ракети.
    // acceleration — як швидко швидкість наближається до бажаної (1/с).
    heli: {
        name: 'HELICOPTER',
        legend: { kills: 3, health: 6, rockets: 4 },
        health: 3, speed: 75, acceleration: 1.6,
        fireInterval: 0.11,
        halfWidth: 14, halfHeight: 8, crashRadius: 45, crashDamage: 4
    },
    // Десантний літак легендарної піхоти (js/airdrop.js): корпус бомбардувальника, без зброї й без легенди.
    // Не входить у PLANE_KINDS: його немає в повзунках і таблиці рахунку.
    transport: {
        name: 'TRANSPORT',
        health: 8, speed: 125, turnRate: 2.3, wobble: 0.24,
        trailInterval: 0.055,
        halfWidth: 28, halfHeight: 13, crashRadius: 85, crashDamage: 10
    }
};

// Гелікоптер: висота польоту над землею (пікселі), відстань зависання від цілі, огляд для підльоту.
const HELI_MIN_ALTITUDE = 95;
const HELI_MAX_ALTITUDE = 190;
const HELI_HOVER_BOB = 7;
const HELI_STANDOFF = 210;
const HELI_SIGHT_RANGE = 650;
const HELI_MAX_TILT = 0.22;
const HELI_PLAYER_MIN_ALTITUDE = 50;   // нижче гравець опуститися не може
const HELI_PLAYER_LEASH = 150;         // ближче до курсора гелікоптер гравця не підлітає — висить і цілиться
const HELI_PLAYER_AIM_CONE = 0.97;     // косинус: юніт у цьому секторі турелі задає лінію пострілу
const HELI_PLAYER_CURSOR_PICK = 45;   // ворог ближче до курсора (px) задає лінію вибуху ракет гравця

// Кулеметна турель гелікоптера: черги з дрібних куль, турель повертається окремо від корпусу.
const HELI_GUN_RANGE = 330;
const HELI_AIR_RANGE = 280;
const HELI_GUN_SPEED = 520;
const HELI_GUN_DAMAGE = 0.45;
const HELI_GUN_SPREAD = 0.07;
const HELI_BURST_SIZE = 6;
const HELI_BURST_PAUSE = 1.8;
const HELI_TURRET_SPEED = 2.2;
const HELI_TURRET_TOLERANCE = 0.15;

// Некеровані ракети легендарного гелікоптера: залп по одній у наземну ціль.
const HELI_ROCKET_RANGE = 420;
const HELI_ROCKET_SPEED = 300;
const HELI_ROCKET_DAMAGE = 3;
const HELI_ROCKET_RADIUS = 40;
const HELI_ROCKET_INTERVAL = 0.16;
const HELI_ROCKET_SPREAD = 30;
const HELI_ROCKET_RELOAD = 6;

// Літак гравця: поворот швидший за ШІ, відступ від країв поля.
const PLAYER_MODES = [null, 'fighter', 'bomber', 'heli'];   // порядок перемикання клавішею 3
const PLAYER_TURN_FACTOR = 1.3;
const PLAYER_EDGE_MARGIN = 40;
const PLAYER_MODE_COLOR = '#ffd966';
const PLAYER_MODE_OFF_COLOR = '#ff8866';
const PLAYER_MESSAGE_TIME = 2.5;   // скільки секунд видно напис про режим
const PLAYER_MESSAGE_FADE = 0.8;   // останні секунди напис згасає

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

// Єдиний шрифт для всіх ASCII-спрайтів (юніти, літаки, снаряди, дим), щоб дизайн був однорідним.
const SPRITE_FONT_SIZE = 14;
const SPRITE_FONT = `bold ${SPRITE_FONT_SIZE}px monospace`;

// Малювання літака: багаторядковий ASCII-спрайт, гвинт крутиться з частотою PLANE_PROP_FPS.
const PLANE_LINE_HEIGHT = 6;
const PLANE_PROP_FPS = 24;
const DEBUG_PLANE_PIVOT = false;   // показувати точку нахилу літака (червона крапка)

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

// РПГ є в усієї піхоти: швидка пряма ракета, спершу по техніці. Б'є ближче за гвинтівку (range піхоти),
// тож піхотинець спершу лежачи стріляє з гвинтівки і підповзає, а з РПГ б'є вже зблизька.
const RPG_RANGE = 230;
const RPG_RELOAD = 6;
const RPG_SPEED = 320;
const RPG_DAMAGE = 5;
const RPG_RADIUS = 38;
// Піхотинець встає за RPG_STAND_TIME с до пострілу і стоїть RPG_STAND_HOLD с після нього.
const RPG_STAND_TIME = 0.7;
const RPG_STAND_HOLD = 0.6;

// Десант легендарної піхоти: коли ворог ближче за AIRDROP_CALL_RANGE, легенда викликає десантний літак (PLANE_STATS.transport).
// Він вилітає з-за свого краю карти (AIRDROP_ENTRY_MARGIN), тримає висоту AIRDROP_ALTITUDE над землею, погойдуючись,
// скидає AIRDROP_TROOPERS парашутистів з кроком AIRDROP_SPACING навколо точки AIRDROP_AHEAD попереду легенди
// і розвертається назад. Його можна збити. Парашутисти — звичайна піхота (у межах ліміту з налаштувань).
// AIRDROP_POOL — скільки десантних літаків може бути в повітрі одночасно (на обидві команди).
const AIRDROP_CALL_RANGE = 400;
const AIRDROP_FIRST_DELAY = 1;
const AIRDROP_RELOAD = 14;
const AIRDROP_TROOPERS = 5;
const AIRDROP_SPACING = 48;
const AIRDROP_AHEAD = 30;
const AIRDROP_ALTITUDE = 230;
const AIRDROP_ENTRY_MARGIN = 60;
const AIRDROP_POOL = 6;
const PARACHUTE_SPEED = 55;
// Виклик десанту: від легенди вгору біжать хвилі радіосигналу протягом AIRDROP_SIGNAL_TIME с.
const AIRDROP_SIGNAL_TIME = 1.6;
const AIRDROP_SIGNAL_WAVES = 3;
const AIRDROP_SIGNAL_RISE = 38;
const AIRDROP_SIGNAL_MAX_WIDTH = 3; // скільки рисок '‾' у верхівці найширшої хвилі
// Парашутист погойдується під куполом: амплітуда (рад) і частота (рад/с).
const PARACHUTE_SWAY = 0.28;
const PARACHUTE_TOP = -24;
const PARACHUTE_SWAY_SPEED = 2.4;

// Піхота стріляє з гвинтівки і по ворожих гелікоптерах, ближчих за INFANTRY_HELI_RANGE (якщо вони ближче за наземну ціль).
const INFANTRY_HELI_RANGE = 260;

// Багатоствольна стрільба: кутовий розкид стволів і розкид залпу артилерії.
const MULTISHOT_ANGLE = 0.04;
const ARTILLERY_BARRAGE_SPREAD = 38;

// Залп ракет легендарної артилерії (РСЗВ): ракети йдуть по черзі в смугу навколо зафіксованої цілі.
const ARTILLERY_ROCKET_DAMAGE = 3;
const ARTILLERY_ROCKET_RADIUS = 52;
const ARTILLERY_ROCKET_INTERVAL = 0.22;
const ARTILLERY_ROCKET_SPREAD = 165;
const ARTILLERY_ROCKET_RELOAD = 7;

// Ядерна бомба легендарного бомбардувальника (б'є по всіх, включно зі своїми).
const NUKE_DAMAGE = 14;
const NUKE_RADIUS = 280;
const NUKE_RELOAD = 12;
const NUKE_SLOWMO_TIME = 0.8;

// Гальмування частинок хмари бомби (1/с): вони злітають і сповільнюються, тож не залітають надто високо.
// Макс. підйом ≈ початкова швидкість / BOMB_CLOUD_DRAG; більше значення = нижча хмара.
const BOMB_CLOUD_DRAG = 0.6;

// Хмара ядерного вибуху: кількість частинок і множник розміру відносно хмари звичайної бомби.
const NUKE_CLOUD_SCALE = 3.5;
const NUKE_CLOUD_SIZE = 2.2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
