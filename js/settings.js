'use strict';

// Меню налаштувань (клавіша 2): повзунок кількості для кожного типу сутності, від 0 до defaultCount * 2.
const settingsPanel = {
    element: null,

    build() {
        const panel = document.createElement('div');
        panel.id = 'settings';
        panel.hidden = true;

        const title = document.createElement('div');
        title.className = 'settings-title';
        title.textContent = 'SETTINGS [2]';
        panel.appendChild(title);

        for (const entry of ENTITY_SETTINGS) {
            const row = document.createElement('label');
            row.className = 'settings-row';

            const name = document.createElement('span');
            name.textContent = entry.label;

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = 0;
            slider.max = settings.maxCount(entry.id);
            slider.step = 1;
            slider.value = settings.counts[entry.id];

            const value = document.createElement('span');
            value.className = 'settings-value';
            value.textContent = slider.value;

            slider.addEventListener('input', () => {
                settings.counts[entry.id] = Number(slider.value);
                value.textContent = slider.value;
                battle.applySettings();
            });

            row.append(name, slider, value);
            panel.appendChild(row);
        }

        document.body.appendChild(panel);
        this.element = panel;
    },

    toggle() {
        this.element.hidden = !this.element.hidden;

        // Щоб повзунок не перехоплював клавіші після закриття меню.
        if (this.element.hidden && document.activeElement) {
            document.activeElement.blur();
        }
    }
};

settingsPanel.build();

window.addEventListener('keydown', event => {
    if (event.key === '2' && !event.repeat) {
        settingsPanel.toggle();
    }
});
