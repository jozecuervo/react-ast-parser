'use strict';

// Shared helpers for the characterization tests.
// The CLI writes graph.dot into its working directory, so every CLI run gets
// a fresh temp directory as cwd and nothing is ever written into the repo.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MAIN = path.join(ROOT, 'main.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(...parts) {
  return path.join(FIXTURES, ...parts);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'react-ast-parser-test-'));
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Run `node main.js ...args` with a fresh temp directory as cwd.
function runCli(t, args) {
  const cwd = makeTempDir();
  const result = spawnSync(process.execPath, [MAIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
  t.after(() => removeDir(cwd));
  return { ...result, cwd };
}

// The CLI prints the component tree to stdout even with --quiet, so stdout is
// not pure JSON. The JSON document starts at the first line that is exactly "{".
function extractJson(stdout) {
  const start = stdout.startsWith('{\n') ? 0 : stdout.indexOf('\n{\n') + 1;
  if (start === 0 && !stdout.startsWith('{\n')) {
    throw new Error(`no JSON document found in stdout:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start));
}

// Make machine-specific absolute paths relative to the fixtures directory.
function normalizePaths(data) {
  return {
    ...data,
    components: data.components.map((component) => ({
      ...component,
      filePath: path.relative(FIXTURES, component.filePath).split(path.sep).join('/'),
    })),
  };
}

module.exports = { FIXTURES, fixture, runCli, extractJson, normalizePaths };
