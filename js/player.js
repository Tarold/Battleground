'use strict';

// Гравець керує першим літаком лівої команди: курсор — курс, ЛКМ — кулемет.
// ПКМ: винищувач — ракети (лише легенда), бомбардувальник — килим бомб або ядерна бомба (легенда).
// Гелікоптер: тримається на відстані від курсора, турель цілиться на курсор; ЛКМ — мініган, ПКМ — ракети в курсор (легенда).
// Клавіша 3 перемикає по колу: вимкнено → винищувач → бомбардувальник → гелікоптер → вимкнено;
// вимкнений режим — апарат літає як ШІ.
const player = {
    mode: null,
    message: '',
    mouseX: 0,
    mouseY: 0,
    hasMouse: false,
    firing: false,
    rocketRequest: false,
    messageTimer: 0,

    get enabled() {
        return this.mode !== null;
    },

    // Літак під керуванням гравця або undefined, якщо режим вимкнений.
    get plane() {
        if (this.mode === 'fighter') {
            return battle.planes[0];
        }

        if (this.mode === 'heli') {
            return battle.planes.find(plane => plane.kind === 'heli');
        }

        return this.mode === 'bomber' ? battle.planes.find(plane => plane.bomber) : undefined;
    },

    // Наступний режим по колу; попередній літак знову літає сам.
    cycle() {
        this.mode = PLAYER_MODES[(PLAYER_MODES.indexOf(this.mode) + 1) % PLAYER_MODES.length];
        this.firing = false;
        this.rocketRequest = false;
        this.message = this.mode ? `PLAYER MODE ON: ${this.plane.stats.name}` : 'PLAYER MODE OFF';
        this.messageTimer = PLAYER_MESSAGE_TIME;
    },

    update(deltaTime) {
        this.messageTimer = Math.max(0, this.messageTimer - deltaTime);
    }
};

window.addEventListener('mousemove', event => {
    player.mouseX = event.clientX;
    player.mouseY = event.clientY;
    player.hasMouse = true;
});

window.addEventListener('mousedown', event => {
    if (!player.enabled) {
        return;
    }

    if (event.button === 0) {
        player.firing = true;
    } else if (event.button === 2) {
        player.rocketRequest = true;
    }
});

window.addEventListener('mouseup', event => {
    if (event.button === 0) {
        player.firing = false;
    }
});

window.addEventListener('blur', () => {
    player.firing = false;
});

// Праву кнопку віддано ракетам, тож меню браузера не потрібне.
window.addEventListener('contextmenu', event => {
    if (player.enabled) {
        event.preventDefault();
    }
});

window.addEventListener('keydown', event => {
    if (event.repeat) {
        return;
    }

    if (event.key === '3') {
        player.cycle();
    }
});
