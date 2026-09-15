const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SCRIPT_PATH = path.join(__dirname, '../../scripts/playwright/lan-playthrough.ps1');
const FLOW_PATH = path.join(__dirname, '../../scripts/playwright/lan-playthrough.js');

test('Playwright LAN script preserves the approved smoke-test method', () => {
  assert.equal(fs.existsSync(SCRIPT_PATH), true);
  assert.equal(fs.existsSync(FLOW_PATH), true);
  const script = `${fs.readFileSync(SCRIPT_PATH, 'utf8')}\n${fs.readFileSync(FLOW_PATH, 'utf8')}`;

  for (const marker of [
    'playwright-cli',
    '-s=$Session',
    'snapshot',
    'screenshot',
    'game:command',
    'error:rejected',
    'baseRevision',
    'output/playwright',
    '[data-create-room]',
    '[data-join-room]',
    '[data-reconnect-room]',
    'ui-and-protocol',
  ]) {
    assert.match(script, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
