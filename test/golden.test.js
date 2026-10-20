'use strict';

// One golden: the full JSON for the richest fixture (class state, connect,
// props, a function component, an arrow component, and a hook).
// Paths are made relative to test/fixtures so the golden holds on any machine.
//
// To regenerate after an intentional behaviour change:
//   UPDATE_GOLDEN=1 npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, runCli, extractJson, normalizePaths } = require('./helpers');

const GOLDEN = fixture('tree.expected.json');

test('full JSON for the tree fixture matches the golden file', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--json-only', '--quiet']);
  assert.equal(result.status, 0);
  const actual = normalizePaths(extractJson(result.stdout));

  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
  }
  const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(actual, expected);
});
