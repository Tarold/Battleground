'use strict';

// Довідка по клавішах (F1).
const HELP_LINES = [
    ['F1', 'this help'],
    ['1', 'top scores to legend'],
    ['2', 'settings'],
    ['3', 'player: fighter > bomber > heli > off'],
    ['Mouse', 'player: fly to cursor'],
    ['', 'heli: follow + aim turret'],
    ['Left click', 'player: machine gun'],
    ['Right click', 'fighter: rockets (legend)'],
    ['', 'bomber: bombs / nuke (legend)'],
    ['', 'heli: rockets at cursor (legend)']
];

const helpPanel = {
    element: null,

    build() {
        const panel = document.createElement('div');
        panel.id = 'help';
        panel.hidden = true;

        const title = document.createElement('div');
        title.className = 'settings-title';
        title.textContent = 'SHORTCUTS [F1]';
        panel.appendChild(title);

        for (const [key, text] of HELP_LINES) {
            const row = document.createElement('div');
            row.className = 'help-row';

            const keyName = document.createElement('span');
            keyName.className = 'help-key';
            keyName.textContent = key;

            const description = document.createElement('span');
            description.textContent = text;

            row.append(keyName, description);
            panel.appendChild(row);
        }

        document.body.appendChild(panel);
        this.element = panel;
    }
};

helpPanel.build();

window.addEventListener('keydown', event => {
    if (event.key === 'F1') {
        // Щоб браузер не відкривав свою довідку.
        event.preventDefault();

        if (!event.repeat) {
            helpPanel.element.hidden = !helpPanel.element.hidden;
        }
    }
});
