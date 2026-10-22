'use strict';

// Opt-in live check of the Cypher export against a real Neo4j.
//
// Skipped unless NEO4J_URL is set, so CI and other checkouts make no network
// call. Environment:
//   NEO4J_URL       e.g. http://localhost:7474 (a trailing / is tolerated)
//   NEO4J_USER      default "neo4j"
//   NEO4J_PASSWORD  required when NEO4J_URL is set
//   NEO4J_DATABASE  default "neo4j"
//
// The database must be empty. The test removes only what it created.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, runCli } = require('./helpers');

const SKIP = process.env.NEO4J_URL
  ? false
  : 'set NEO4J_URL (and NEO4J_PASSWORD) to run against a local Neo4j';

const CONSTRAINTS = ['component_name', 'storekey_name', 'action_name'];

// POST one statement to the HTTP Query API and return body.data.values.
// Errors never include the password or the auth header.
async function query(statement) {
  if (typeof fetch !== 'function') {
    throw new Error('the live Neo4j test needs Node 18+ (global fetch)');
  }
  const url = process.env.NEO4J_URL.replace(/\/+$/, '');
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || 'neo4j';
  if (!password) {
    throw new Error('NEO4J_PASSWORD is required when NEO4J_URL is set');
  }
  const response = await fetch(`${url}/db/${database}/query/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify({ statement }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch (err) {
    body = {};
  }
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (!response.ok || errors.length > 0) {
    const detail = errors.map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`Neo4j query failed (HTTP ${response.status}) ${detail}`.trim());
  }
  return body.data.values;
}

function generateStatements(t) {
  const result = runCli(t, [fixture('tree', 'App.jsx'), '--cypher', '--quiet', '--json-only']);
  assert.equal(result.status, 0);
  const script = fs.readFileSync(path.join(result.cwd, 'graph.cypher'), 'utf8');
  const lines = script.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('//'));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.endsWith(';'), `statement does not end in ';': ${line}`);
  }
  return lines.map((line) => line.slice(0, -1));
}

async function count(statement) {
  const values = await query(statement);
  return values[0][0];
}

async function assertGraph() {
  assert.equal(await count('MATCH (n:Component) RETURN count(n)'), 4);
  assert.equal(await count('MATCH (n:StoreKey) RETURN count(n)'), 2);
  assert.equal(await count('MATCH (n:Action) RETURN count(n)'), 1);
  assert.equal(await count('MATCH (n) RETURN count(n)'), 7);
  assert.equal(await count('MATCH ()-[r:RENDERS]->() RETURN count(r)'), 3);
  assert.equal(await count('MATCH ()-[r:SELECTS]->() RETURN count(r)'), 2);
  assert.equal(await count('MATCH ()-[r:DISPATCHES]->() RETURN count(r)'), 1);
  assert.equal(await count('MATCH ()-[r]->() RETURN count(r)'), 6);

  assert.deepEqual(
    await query("MATCH (c:Component)-[:SELECTS]->(:StoreKey {name: 'user'}) RETURN c.name, c.file"),
    [['App', 'App.jsx']],
  );
  assert.deepEqual(
    await query("MATCH (c:Component {name: 'Counter'}) RETURN c.state"),
    [[['count']]],
  );
  assert.deepEqual(
    await query(
      "MATCH (:Component {name: 'App'})-[r:RENDERS]->(:Component {name: 'TodoList'}) RETURN r.props",
    ),
    [[['filter', 'onSelect']]],
  );
}

async function snapshot() {
  const nodes = await query(
    'MATCH (n) RETURN labels(n), n.name, properties(n) ORDER BY n.name, labels(n)[0]',
  );
  const relationships = await query(
    'MATCH (a)-[r]->(b) RETURN a.name, type(r), b.name, properties(r) ORDER BY a.name, type(r), b.name',
  );
  return { nodes, relationships };
}

test('loads the tree fixture script twice into an empty Neo4j and stays idempotent', { skip: SKIP }, async (t) => {
  const statements = generateStatements(t);

  assert.equal(
    await count('MATCH (n) RETURN count(n)'),
    0,
    'needs an empty database; refusing to touch existing data',
  );

  // Past the empty-check: from here on, clean up what this test creates.
  const existing = (await query('SHOW CONSTRAINTS YIELD name RETURN name')).map((row) => row[0]);
  const toDrop = CONSTRAINTS.filter((name) => !existing.includes(name));
  t.after(async () => {
    await query('MATCH (n) DETACH DELETE n');
    for (const name of toDrop) {
      await query(`DROP CONSTRAINT ${name} IF EXISTS`);
    }
  });

  for (const statement of statements) {
    await query(statement);
  }
  await assertGraph();
  const before = await snapshot();

  for (const statement of statements) {
    await query(statement);
  }
  await assertGraph();
  const after = await snapshot();

  assert.deepEqual(after, before);
});
