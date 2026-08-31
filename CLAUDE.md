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
# Run the analyzer on a React component (expanded mode - follows ALL imports)
node main.js <path-to-component-file>

# Run in components-only mode (only follows JSX component children)
node main.js <path-to-component-file> --components-only

# Install dependencies
npm install
```

**Options:**
- `--components-only` - Only follow JSX component imports (original behavior). Without this flag, the parser follows ALL imports including reducers, actions, utils, constants, etc.

**Note:** Graphviz must be installed on the system for SVG generation (`dot` command).

## Architecture

Three-module pipeline:

1. **main.js** - CLI entry point and orchestrator
   - Resolves component file paths (handles .js/.jsx extensions)
   - Recursively analyzes child components using import maps
   - Tracks visited components to prevent infinite loops
   - De-duplicates props before passing to graph generator

2. **parseReactComponents.js** - AST parser using Babel
   - Parses JSX/TypeScript with `@babel/parser`
   - Uses `@babel/traverse` to walk the AST
   - Supports both class components and functional components
   - Extracts component names, state (class state and useState hooks), Redux bindings, and JSX children
   - **Redux detection**:
     - `connect()` with mapStateToProps/mapDispatchToProps
     - `useSelector` and `useDispatch` hooks
     - Reducer slices accessed from state destructuring
     - Dispatched action names (e.g., `Actions.doSomething`)
     - Action module imports (namespace imports like `import * as Actions`)
   - Handles `mapStateToProps` passed as inline functions or variable references
   - Builds import map for resolving child component paths (default, named, namespace imports)
   - Categorizes props by type (state-derived, function, other) for class components

3. **generateGraph.js** - Graphviz DOT generator
   - Recursively traverses nested component structure
   - Creates HTML-like table labels showing state, Redux props, and child props
   - Handles unresolved children with dashed styling
   - Outputs `graph.dot` and renders to `graph.svg`

## Node Version

Uses Node.js LTS/Jod (specified in `.nvmrc`).

## Graph Features

- **Clustering by directory** - Components are grouped into subgraphs based on their file paths
- **Color-coded by file type** - Different colors for components, reducers, actions, constants, utils, hooks, context, services, and external packages
- **Node styling**:
  - Teal border: Redux hooks (useSelector/useDispatch)
  - Green border: Redux connect()
  - Orange border: Dispatches actions only
  - Blue border: Local state only
  - Gray border: Stateless
  - Dashed: Unresolved/external
- **Edge styling** - Solid lines for JSX children, dashed lines for non-JSX imports
- **Prop type annotations** - Props on edges show `●prop` for state props, `ƒprop` for function props

## Redux Visualization

Nodes display enhanced Redux information:
- `⚡` Redux connection type (connect() or useSelector/useDispatch)
- `📦` Store slices accessed (e.g., bootstrap, adsApp)
- `🎬` Dispatched actions (e.g., BootstrapActions.fetchUserData)
- `props:` Mapped Redux props from mapStateToProps
- `state:` Local component state

## Known Limitations

- Props categorization (state/function/other) only works for class components using `this.state.x` pattern
- Functional components show all props as "other" (no state prop detection for hooks)
- JSON files will show parse errors when followed in expanded mode (they're skipped gracefully)
