'use strict';

// Гравець керує першим винищувачем лівої команди: курсор — курс, ЛКМ — кулемет, ПКМ — ракети (лише легенда).
// Режим вмикається клавішею 3; вимкнений — цей винищувач літає як ШІ.
const player = {
    enabled: false,
    mouseX: 0,
    mouseY: 0,
    hasMouse: false,
    firing: false,
    rocketRequest: false,

    get plane() {
        return battle.planes[0];
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
    if (event.key === '3' && !event.repeat) {
        player.enabled = !player.enabled;
        player.firing = false;
        player.rocketRequest = false;
    }
});
