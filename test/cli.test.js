'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, runCli, extractJson } = require('./helpers');

function names(data) {
  return data.components.map((c) => c.name);
}

test('parent -> child -> grandchild tree resolves through relative imports', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--json-only', '--quiet']);
  assert.equal(result.status, 0);
  const data = extractJson(result.stdout);
  // Depth-first, in the order children are first seen in the parent's JSX.
  assert.deepEqual(names(data), ['App', 'TodoList', 'TodoItem', 'Counter']);
  assert.deepEqual(data.components[0].children, ['TodoList', 'Counter']);
  assert.deepEqual(data.components[1].children, ['TodoItem']);
});

test('--json-only writes no graph.dot', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--json-only', '--quiet']);
  assert.equal(require('node:fs').existsSync(path.join(result.cwd, 'graph.dot')), false);
});

test('--quiet still prints the ASCII tree on stdout', (t) => {
  // BUG? --quiet is documented as "Suppress console output during analysis",
  // but logTree() uses console.log unconditionally, so stdout is not pure JSON.
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--json-only', '--quiet']);
  assert.ok(result.stdout.startsWith('- App\n  -> TodoList\n  -> Counter\n'));
});

test('an import cycle terminates and visits each file once', (t) => {
  const result = runCli(t, [fixture('cycle', 'A.jsx'), '--json-only', '--quiet']);
  assert.equal(result.status, 0);
  const data = extractJson(result.stdout);
  assert.deepEqual(names(data), ['A', 'B']);
  // B still lists A as a child; the cycle is cut at traversal time only.
  assert.deepEqual(data.components[1].children, ['A']);
  assert.match(result.stderr, /Circular import detected: A\.jsx/);
});

test('an import that cannot be resolved is warned about and skipped', (t) => {
  const result = runCli(t, [fixture('unresolved', 'App.jsx'), '--json-only', '--quiet']);
  assert.equal(result.status, 0);
  const data = extractJson(result.stdout);
  assert.deepEqual(names(data), ['App', 'Present']);
  assert.deepEqual(data.components[0].children, ['Ghost', 'Present']);
  assert.match(result.stderr, /Could not resolve component 'Ghost' from App\.jsx/);
});

test('a directory import resolves to its index file', (t) => {
  const result = runCli(t, [fixture('index', 'App.jsx'), '--json-only', '--quiet']);
  const data = extractJson(result.stdout);
  assert.deepEqual(names(data), ['App', 'Widget']);
  assert.ok(data.components[1].filePath.endsWith(path.join('Widget', 'index.js')));
});

test('a child that fails to parse becomes a ParseError record and the run succeeds', (t) => {
  const result = runCli(t, [fixture('broken', 'App.jsx'), '--json-only', '--quiet']);
  // BUG? Exit status is 0 even though a file failed to parse, and the record
  // is named 'ParseError' rather than after the file or component.
  assert.equal(result.status, 0);
  const data = extractJson(result.stdout);
  assert.deepEqual(names(data), ['App', 'ParseError']);
  assert.match(data.components[1].error, /Unterminated JSX contents/);
  assert.match(result.stderr, /Parse error in Oops\.jsx/);
});

test('no file argument exits 1 with usage', (t) => {
  const result = runCli(t, ['--json-only']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No component file path provided/);
  assert.match(result.stdout, /Usage: node main\.js/);
});

test('a nonexistent path exits 1', (t) => {
  const result = runCli(t, [fixture('does-not-exist', 'Nope.jsx'), '--json-only']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Component file not found/);
  assert.equal(result.stdout, '');
});
