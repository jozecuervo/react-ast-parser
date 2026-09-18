# AGENTS.md

This file provides guidance to Claude Code, Codex and other agents when working with code in this repository.

## Project Overview

react-ast-parser is a CLI tool that extracts React component dependencies via
Babel AST parsing and renders them as a Graphviz dependency graph (component
hierarchy, state, and Redux connections).

## Build, Test, Run

```bash
npm install
node main.js ./path/to/component.jsx   # analyze a component, generates graph.svg + JSON
npm test                                # not implemented: exits 1 with "no test specified"
```

Useful flags: `--debug`, `--quiet`, `--graph-only`, `--json-only`. Graphviz
must be installed separately (e.g. `brew install graphviz`) for SVG output.

## Conventions

- Three main files: `main.js` (CLI entry, orchestration), `parseReactComponents.js`
  (Babel AST traversal), `generateGraph.js` (Graphviz DOT/SVG generation).
- Node.js >= 14.0.0 (per `package.json` `engines`).

See README.md for full usage, examples, and known limitations.
