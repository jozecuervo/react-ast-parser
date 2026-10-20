'use strict';

// Tests for the Cypher export (--cypher, generateCypher.js).
//
// To regenerate the golden after an intentional change:
//   UPDATE_GOLDEN=1 npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, runCli } = require('./helpers');
const { generateCypher, escapeCypher } = require('../generateCypher');

const GOLDEN = fixture('tree.expected.cypher');

// Tokenize single-quoted Cypher string literals. Inside a literal a backslash
// escapes the next character; an unescaped quote ends it. Returns the raw
// (still escaped) text of each literal, and throws if one never closes.
function literals(script) {
  const found = [];
  let i = 0;
  while (i < script.length) {
    if (script[i] === '/' && script[i + 1] === '/') {
      while (i < script.length && script[i] !== '\n') i++;
    } else if (script[i] === "'") {
      let j = i + 1;
      while (j < script.length && script[j] !== "'") j += script[j] === '\\' ? 2 : 1;
      if (j >= script.length) throw new Error(`unterminated literal at ${i}`);
      found.push(script.slice(i + 1, j));
      i = j + 1;
    } else {
      i++;
    }
  }
  return found;
}

// Reverse of the escaper, to check the round trip.
function unescape(raw) {
  return raw.replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] || c);
}

function cypherFor(t, fixtureName, extra = []) {
  const result = runCli(t, [fixture(fixtureName, 'App.jsx'), '--cypher', '--quiet', '--json-only', ...extra]);
  assert.equal(result.status, 0);
  return fs.readFileSync(path.join(result.cwd, 'graph.cypher'), 'utf8');
}

test('graph.cypher for the tree fixture matches the golden file', (t) => {
  const actual = cypherFor(t, 'tree');
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, actual);
  assert.equal(actual, fs.readFileSync(GOLDEN, 'utf8'));
});

test('names and props with quotes, backslashes, newlines and tabs are escaped exactly', () => {
  const nasty = ["it's", 'a\\b', "x\\'y", 'line1\nline2', 'tab\there', 'cr\rend'];
  const script = generateCypher({
    components: [
      {
        name: "O'Brien",
        state: ['s\\t'],
        reduxProps: ["k'ey"],
        actions: ['a\nb'],
        children: ['Child\\'],
        props: { 'Child\\': nasty },
        filePath: '/root/App.jsx',
      },
    ],
  });
  assert.ok(script.includes(
    "SET r.props = ['it\\'s', 'a\\\\b', 'x\\\\\\'y', 'line1\\nline2', 'tab\\there', 'cr\\rend']"
  ));
  assert.ok(script.includes("{name: 'O\\'Brien'}"));
  assert.ok(script.includes("{name: 'Child\\\\'}"));
  assert.ok(script.includes("{name: 'a\\nb'}"));
  // No raw newline, CR or tab inside any literal, and every literal closes.
  const raws = literals(script);
  raws.forEach((raw) => assert.doesNotMatch(raw, /[\n\r\t]/));
  // Every nasty value comes back out of the tokenizer unchanged.
  const back = raws.map(unescape);
  nasty.forEach((value) => assert.ok(back.includes(value), JSON.stringify(value)));
  assert.ok(back.includes("O'Brien"));
  // Statement count is unchanged by hostile input: every line still ends in ';'.
  script.trim().split('\n').slice(1).forEach((line) => assert.ok(line.endsWith(';'), line));
});

test('escapeCypher handles each character', () => {
  assert.equal(escapeCypher("'"), "\\'");
  assert.equal(escapeCypher('\\'), '\\\\');
  assert.equal(escapeCypher("\\'"), "\\\\\\'");
  assert.equal(escapeCypher('\n'), '\\n');
  assert.equal(escapeCypher('\t'), '\\t');
});

test('script is idempotent in shape: no CREATE but constraints, every node is a MERGE', (t) => {
  const script = cypherFor(t, 'tree');
  const statements = script.split('\n').filter((l) => l && !l.startsWith('//'));
  const creates = statements.filter((l) => /\bCREATE\b/.test(l));
  assert.equal(creates.length, 3);
  creates.forEach((l) => assert.match(l, /^CREATE CONSTRAINT \w+ IF NOT EXISTS FOR \(n:\w+\) REQUIRE n\.name IS UNIQUE;$/));
  const nodes = statements.filter((l) => /^(MERGE|CREATE) \(n:/.test(l));
  assert.ok(nodes.length > 0);
  nodes.forEach((l) => assert.match(l, /^MERGE \(n:/));
  const rels = statements.filter((l) => l.startsWith('MATCH'));
  assert.ok(rels.length > 0);
  rels.forEach((l) => assert.match(l, / MERGE \(a\)-\[r:\w+\]->\(b\)/));
});

test('a child that fails to parse is a Component with parseError true and the parent RENDERS it', (t) => {
  const script = cypherFor(t, 'broken');
  assert.match(script, /^MERGE \(n:Component \{name: 'Oops'\}\) SET n\.file = 'Oops\.jsx', n\.parseError = true REMOVE n\.state;$/m);
  assert.match(script, /^MERGE \(n:Component \{name: 'App'\}\) SET n\.file = 'App\.jsx', n\.parseError = false REMOVE n\.state;$/m);
  assert.match(
    script,
    /^MATCH \(a:Component \{name: 'App'\}\), \(b:Component \{name: 'Oops'\}\) MERGE \(a\)-\[r:RENDERS\]->\(b\) SET r\.props = \[\];$/m
  );
});

test('an unresolved child is a Component with no file property', (t) => {
  const script = cypherFor(t, 'unresolved');
  assert.match(script, /^MERGE \(n:Component \{name: 'Ghost'\}\) SET n\.parseError = false REMOVE n\.file, n\.state;$/m);
});

test('--cypher --quiet --json-only gives exactly the JSON on stdout, writes graph.cypher and no graph.dot', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--cypher', '--quiet', '--json-only']);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.startsWith('{\n'));
  assert.equal(JSON.parse(result.stdout).components.length, 4);
  assert.equal(fs.existsSync(path.join(result.cwd, 'graph.cypher')), true);
  assert.equal(fs.existsSync(path.join(result.cwd, 'graph.dot')), false);
});

test('--cypher alone also writes graph.dot and says so on stdout', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--cypher']);
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(result.cwd, 'graph.cypher')), true);
  assert.equal(fs.existsSync(path.join(result.cwd, 'graph.dot')), true);
  assert.match(result.stdout, /✓ Generated graph\.cypher\n/);
});

test('without --cypher no graph.cypher is written', (t) => {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--quiet']);
  assert.equal(fs.existsSync(path.join(result.cwd, 'graph.cypher')), false);
});

test('two runs give byte-identical output', (t) => {
  assert.equal(cypherFor(t, 'tree'), cypherFor(t, 'tree'));
  const data = { components: JSON.parse(runCli(t, [fixture('tree', 'App.jsx'), '--json-only', '--quiet']).stdout).components };
  assert.equal(generateCypher(data), generateCypher(JSON.parse(JSON.stringify(data))));
});

test('output order does not depend on input order', () => {
  const a = { name: 'A', state: null, reduxProps: ['z', 'b'], actions: ['y', 'c'], children: ['C', 'B'], props: { C: [], B: [] }, filePath: '/r/A.jsx' };
  const b = { name: 'B', state: null, reduxProps: [], actions: [], children: [], props: {}, filePath: '/r/B.jsx' };
  const c = { name: 'C', state: null, reduxProps: [], actions: [], children: [], props: {}, filePath: '/r/C.jsx' };
  const one = generateCypher({ components: [a, b, c] });
  const two = generateCypher({ components: [a, c, b] });
  assert.equal(one, two);
});

test('a null state emits REMOVE n.state and an absent file emits REMOVE n.file', () => {
  const script = generateCypher({
    components: [
      { name: 'A', state: null, reduxProps: [], actions: [], children: ['Ghost'], props: {}, filePath: '/r/A.jsx' },
      { name: 'B', state: ['x'], reduxProps: [], actions: [], children: [], props: {}, filePath: '/r/B.jsx' },
    ],
  });
  assert.ok(script.includes("MERGE (n:Component {name: 'A'}) SET n.file = 'A.jsx', n.parseError = false REMOVE n.state;"));
  assert.ok(script.includes("MERGE (n:Component {name: 'B'}) SET n.file = 'B.jsx', n.parseError = false, n.state = ['x'];"));
  assert.ok(script.includes("MERGE (n:Component {name: 'Ghost'}) SET n.parseError = false REMOVE n.file, n.state;"));
});

test('other control characters and U+2028/U+2029 are escaped as \\uXXXX, backslash first', () => {
  assert.equal(escapeCypher('\u0000'), '\\u0000');
  assert.equal(escapeCypher('\u0001\u001f'), '\\u0001\\u001f');
  assert.equal(escapeCypher('\u2028'), '\\u2028');
  assert.equal(escapeCypher('\u2029'), '\\u2029');
  assert.equal(escapeCypher('\b\f\v'), '\\u0008\\u000c\\u000b');
  assert.equal(escapeCypher('\\u0000'), '\\\\u0000'); // a literal backslash-u is not turned into an escape
  assert.equal(escapeCypher('\n\r\t'), '\\n\\r\\t');
  const script = generateCypher({
    components: [{ name: 'N\u0000\u2028\u2029', state: null, reduxProps: [], actions: [], children: [], props: {}, filePath: '/r/A.jsx' }],
  });
  assert.ok(script.includes("{name: 'N\\u0000\\u2028\\u2029'}"));
  const raw = [...script].filter((ch) => ch.codePointAt(0) < 0x20 && ch !== '\n').concat(script.includes('\u2028') ? ['\u2028'] : [], script.includes('\u2029') ? ['\u2029'] : []);
  assert.deepEqual(raw, []); // no raw control or separator character survives (newline only ends statements)
});
