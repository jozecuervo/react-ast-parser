'use strict';

// DOT output. Graphviz may or may not be installed where this runs, so these
// tests only read graph.dot and never depend on `dot` or on graph.svg.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, runCli } = require('./helpers');

function dotFor(t, fixtureParts) {
  const result = runCli(t, [fixture(...fixtureParts), '--graph-only', '--quiet']);
  const dotPath = path.join(result.cwd, 'graph.dot');
  assert.equal(result.status, 0);
  assert.ok(fs.existsSync(dotPath), 'graph.dot should be written to the cwd');
  return fs.readFileSync(dotPath, 'utf8');
}

// Edge lines look like: "A" -> "B" [label="...", color=...
function edges(dot) {
  return dot
    .split('\n')
    .map((line) => /^\s*"([^"]+)" -> "([^"]+)" \[label="([^"]*)"/.exec(line))
    .filter(Boolean)
    .map(([, from, to, label]) => ({ from, to, label }));
}

function nodes(dot) {
  return dot
    .split('\n')
    .map((line) => /^\s*"([^"]+)" \[label=</.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

test('graph.dot declares one node per component, in traversal order', (t) => {
  const dot = dotFor(t, ['tree', 'App.jsx']);
  assert.ok(dot.startsWith('digraph G {\n'));
  assert.ok(dot.endsWith('}'));
  assert.deepEqual(nodes(dot), ['App', 'TodoList', 'TodoItem', 'Counter']);
});

test('graph.dot has one edge per parent -> child, with merged props as the label', (t) => {
  const dot = dotFor(t, ['tree', 'App.jsx']);
  const componentEdges = edges(dot).filter((e) => e.from !== 'Redux Store');
  assert.deepEqual(componentEdges, [
    { from: 'App', to: 'TodoList', label: 'Props:\\n filter\\nonSelect' },
    { from: 'App', to: 'Counter', label: 'Props:\\n ...spread' },
    { from: 'TodoList', to: 'TodoItem', label: 'Props:\\n key\\nitem' },
  ]);
});

test('graph.dot draws a Redux Store edge per redux prop', (t) => {
  const dot = dotFor(t, ['tree', 'App.jsx']);
  const reduxEdges = edges(dot).filter((e) => e.from === 'Redux Store');
  assert.deepEqual(reduxEdges, [
    { from: 'Redux Store', to: 'App', label: 'user' },
    { from: 'Redux Store', to: 'App', label: 'theme' },
  ]);
});

test('graph.dot shows state text in the node label', (t) => {
  const dot = dotFor(t, ['tree', 'App.jsx']);
  assert.match(dot, /State: filter, showDone/);
  assert.match(dot, /State: Hook: useState/);
  assert.match(dot, /State: None/);
});

test('graph.dot colours a parse-error node and truncates its message', (t) => {
  const dot = dotFor(t, ['broken', 'App.jsx']);
  assert.deepEqual(nodes(dot), ['App', 'ParseError']);
  assert.match(dot, /BGCOLOR="#FFB3BA"/);
  assert.match(dot, /State: Error: Unterminated JSX contents\. \(4:\.\.\./);
  // BUG? The parent's edge points at "Oops", but the node is declared as
  // "ParseError", so the DOT draws a second, unstyled "Oops" node.
  assert.deepEqual(
    edges(dot).map((e) => `${e.from}->${e.to}`),
    ['App->Oops']
  );
});

test('a cyclic graph still produces both edges', (t) => {
  const dot = dotFor(t, ['cycle', 'A.jsx']);
  assert.deepEqual(
    edges(dot).map((e) => `${e.from}->${e.to}`),
    ['A->B', 'B->A']
  );
});
