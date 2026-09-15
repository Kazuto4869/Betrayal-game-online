const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PUBLIC_ROOT = path.join(__dirname, '../../public');

function readPage(role) {
  return fs.readFileSync(path.join(PUBLIC_ROOT, role, 'index.html'), 'utf8');
}

function readStyles(role) {
  return [
    fs.readFileSync(path.join(PUBLIC_ROOT, 'styles/game-ui.css'), 'utf8'),
    fs.readFileSync(path.join(PUBLIC_ROOT, role, 'styles.css'), 'utf8'),
  ].join('\n');
}

test('Host shell loads the shared tabletop system and exposes accessible public regions', () => {
  const html = readPage('host');
  const css = readStyles('host');

  assert.match(html, /\/styles\/game-ui\.css/);
  assert.match(html, /class="ui-shell"/);
  assert.match(html, /data-current-action/);
  assert.match(html, /data-host-current-action/);
  assert.match(html, /山莊探索地圖/);
  assert.match(html, /data-map-status/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /min-width:\s*44px/);
});

test('Player shell loads the shared tabletop system and exposes a mobile current-action region', () => {
  const html = readPage('player');
  const css = readStyles('player');

  assert.match(html, /\/styles\/game-ui\.css/);
  assert.match(html, /class="ui-shell"/);
  assert.match(html, /data-current-action/);
  assert.match(html, /data-current-action-card/);
  assert.match(html, /山莊探索地圖/);
  assert.match(html, /open>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /min-width:\s*44px/);
});

test('shared tabletop styles define the selected horror palette and reduced-motion behavior', () => {
  const css = fs.readFileSync(path.join(PUBLIC_ROOT, 'styles/game-ui.css'), 'utf8');

  assert.match(css, /--haunted-purple/);
  assert.match(css, /--blood-red/);
  assert.match(css, /--old-paper/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.action-card/);
  assert.match(css, /\.action-detail/);
});
