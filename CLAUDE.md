# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React component AST parser that analyzes React/Redux components and generates dependency graphs. It parses React component files to extract:
- Component state
- Redux props (from `connect` and `mapStateToProps`)
- Redux actions (from `mapDispatchToProps`)
- Child component relationships
- Props passed to children (categorized as state props, function props, or other props)

The output is a visual graph (SVG) showing the component hierarchy.

## Commands

```bash
# Run the analyzer on a React component
node main.js <path-to-component-file>

# Install dependencies
npm install
```

**Note:** Graphviz must be installed on the system for SVG generation (`dot` command).

## Architecture

Three-module pipeline:

1. **main.js** - CLI entry point and orchestrator
   - Resolves component file paths (handles .js/.jsx extensions)
   - Recursively analyzes child components using import maps
   - Tracks visited components to prevent infinite loops
   - De-duplicates props before passing to graph generator

2. **parseReactComponents.js** - AST parser using Babel
   - Parses JSX with `@babel/parser`
   - Uses `@babel/traverse` to walk the AST
   - Supports both class components and functional components
   - Extracts component names, state (class state and useState hooks), Redux bindings, and JSX children
   - Handles `mapStateToProps` passed as inline functions or variable references
   - Builds import map for resolving child component paths
   - Categorizes props by type (state-derived, function, other) for class components

3. **generateGraph.js** - Graphviz DOT generator
   - Recursively traverses nested component structure
   - Creates HTML-like table labels showing state, Redux props, and child props
   - Handles unresolved children with dashed styling
   - Outputs `graph.dot` and renders to `graph.svg`

## Node Version

Uses Node.js LTS/Jod (specified in `.nvmrc`).

## Known Limitations

- Props categorization (state/function/other) only works for class components using `this.state.x` pattern
- Functional components show all props as "other" (no state prop detection for hooks)
