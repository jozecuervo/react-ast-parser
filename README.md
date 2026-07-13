# react-ast-parser

A CLI tool that automatically extracts React component dependencies and generates **visual dependency graphs** using Babel AST parsing and Graphviz.

**Quickly understand component hierarchies, state flow, and Redux connections without manual documentation.**

---

## The Problem

As React applications grow, component trees become complex:
- **What components depend on what?** Requires reading imports in 20+ files
- **What state is being shared?** Scattered across useState hooks, Redux slices, and prop drilling
- **Is component A even used?** Hard to tell without grep + code review
- **What's the Redux data flow?** Requires manually tracing connect() calls and selectors

Manual tools like draw.io or Excalidraw require constant updates. Existing solutions either:
- **Don't exist** for React (most AST/dependency tools are for general code graphs)
- **Are language-agnostic** and miss React/Redux patterns
- **Require configuration** or manual annotation
- **Don't update automatically** when code changes

**react-ast-parser solves this by extracting the dependency graph directly from code.**

---

## Why Build Custom Tooling

This tool exists because there isn't a mature off-the-shelf solution for React-specific dependency visualization:

- **ESLint plugins** analyze imports but don't generate graphs
- **Webpack visualizers** show bundle structure, not component hierarchy
- **Generic AST tools** (Madge, Depcheck) don't understand JSX or Redux patterns
- **Existing graphing tools** (Graphviz, D3) are output-only; they require you to extract the data manually

By parsing with Babel (the same tool that compiles React code) and focusing on React-specific patterns, this tool captures what matters: component composition, state management, and prop passing.

---

## Features

✓ **Parses React components** – Extracts class components, functional components, hooks  
✓ **Detects Redux usage** – Tracks Redux `connect()`, `useSelector`, and `useDispatch`  
✓ **Builds dependency graphs** – Shows parent → child component relationships  
✓ **Visualizes state** – Displays component state, props, and Redux connections  
✓ **Handles modern React** – Supports hooks (useState, useReducer) and TypeScript  
✓ **Prevents circular imports** – Detects and warns about cyclic dependencies  
✓ **Generates SVG output** – Graphviz-based visualizations  
✓ **Error resilience** – Continues parsing even if individual files have syntax errors  

---

## Installation

### Prerequisites
- **Node.js** ≥ 14.0.0
- **Graphviz** (for SVG output)

### Install Graphviz

**macOS:**
```bash
brew install graphviz
```

**Ubuntu/Debian:**
```bash
sudo apt-get install graphviz
```

**Windows (Chocolatey):**
```bash
choco install graphviz
```

**Or download from:** https://graphviz.org/download/

### Install react-ast-parser

```bash
npm install -g react-ast-parser
```

Or clone and run locally:
```bash
git clone https://github.com/jozecuervo/react-ast-parser.git
cd react-ast-parser
npm install
node main.js ./path/to/component.jsx
```

---

## Usage

### Basic Usage

```bash
react-ast-parser ./src/components/App.jsx
```

This will:
1. Parse the component and all its children (recursively)
2. Extract state, Redux connections, and props
3. Output a tree view to the console
4. Generate `graph.svg` with the dependency visualization
5. Output component metadata as JSON

### Command-Line Options

```bash
# Show detailed parsing information
react-ast-parser ./src/App.jsx --debug

# Suppress console output during analysis
react-ast-parser ./src/App.jsx --quiet

# Generate only the SVG graph (skip JSON output)
react-ast-parser ./src/App.jsx --graph-only

# Output only JSON data (skip graph generation)
react-ast-parser ./src/App.jsx --json-only
```

### Example Output

Given this component structure:

```
App.jsx (Redux-connected)
  ├── Header.jsx
  ├── Sidebar.jsx
  └── MainContent.jsx (Has state)
       ├── PostList.jsx (Redux-connected)
       └── PostDetail.jsx
```

**Console Output:**
```
Analyzing component structure...

- App
  -> Header
  -> Sidebar
  -> MainContent
- Header
- Sidebar
- MainContent
  -> PostList
  -> PostDetail
- PostList
- PostDetail

==================================================

Component Data (JSON):
[
  {
    "name": "App",
    "state": null,
    "reduxProps": ["user", "appSettings"],
    "children": ["Header", "Sidebar", "MainContent"],
    "props": { ... }
  },
  ...
]

✓ Generated graph.dot
✓ Generated graph.svg
```

**Generated SVG Graph:**
```
[Graphviz visualization showing:]
- Blue boxes for each component
- Arrows showing parent → child relationships
- Orange lines for Redux store connections
- Props labeled on edges
- State listed in each component box
```

---

## How It Works

### 1. **Babel AST Parsing**
The tool uses Babel to parse React components into an Abstract Syntax Tree (AST). This gives us precise information about:
- Component declarations (class, functional, arrow functions)
- JSX elements and their props
- Import statements and module paths
- State declarations (class properties, useState hooks)
- Redux connections (connect() calls, useSelector/useDispatch hooks)

### 2. **Dependency Extraction**
The parser walks the AST and extracts:
- **Children:** All JSX elements that reference other components
- **Imports:** Maps which names refer to which files
- **State:** Class state, useState hooks, Redux selectors
- **Props:** Attributes passed to child components

### 3. **Recursive Analysis**
Starting from the root component:
1. Resolve each child's import path (handles `.jsx`, `.js`, `.tsx`, `.ts`, and `index.js`)
2. Recursively analyze child components
3. Track visited files to prevent infinite loops (circular imports)
4. Continue even if individual files have parse errors

### 4. **Graph Generation**
Using Graphviz DOT format:
- Each component is a node (with state info)
- Each parent → child relationship is an edge
- Redux connections are separate edges (different color)
- The output is rendered to SVG for visualization

---

## Examples

### Example 1: Redux-Connected Dashboard

**Input:** `src/components/Dashboard.jsx`

```jsx
import React from 'react';
import { connect } from 'react-redux';
import { fetchData } from './actions';
import StatsPanel from './panels/StatsPanel';
import ReportsPanel from './panels/ReportsPanel';

class Dashboard extends React.Component {
  state = { activeTab: 'stats' };

  render() {
    return (
      <div>
        <StatsPanel />
        <ReportsPanel />
      </div>
    );
  }
}

const mapStateToProps = state => ({
  user: state.auth.user,
  permissions: state.auth.permissions,
});

export default connect(mapStateToProps)(Dashboard);
```

**Output Graph:**
```
                    Redux Store
                         ↑
                    (user, permissions)
                         ↑
                    Dashboard
                    [State: activeTab]
                      ↙       ↘
          StatsPanel         ReportsPanel
```

### Example 2: Functional Component with Hooks

**Input:** `src/components/PostList.jsx`

```jsx
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import PostCard from './PostCard';

function PostList({ category }) {
  const [sortBy, setSortBy] = useState('date');
  const posts = useSelector(state => state.posts.items);

  return (
    <div>
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

export default PostList;
```

**Output Graph:**
```
Redux Store
    ↓
(posts.items via useSelector)
    ↓
PostList
[State: sortBy]
    ↓
[Props: post]
PostCard
```

---

## Limitations

⚠️ **Supported:**
- React class components and functional components
- JSX with component references
- Import statements (ES6 modules)
- React hooks (useState, useReducer, useSelector, useDispatch)
- Redux connect() and Redux hooks
- Basic TypeScript (.tsx files)

❌ **Not Supported:**
- Dynamic imports (`require()` or `import()` at runtime)
- Components in non-JSX files (e.g., render functions)
- CSS-in-JS or styling dependencies
- External npm package components (only local files)
- Flow type annotations (Babel plugins supported but not auto-enabled)
- Deeply nested path aliases (some alias patterns may not resolve)

### Why These Limitations?

Static analysis can't execute code, so it can't follow:
- Dynamic `require()` calls with variables
- Lazy-loaded components split across routes
- Conditionally imported modules

For dynamic scenarios, consider:
- Using `--debug` to see import resolution attempts
- Ensuring all imports are statically defined
- Checking that relative paths are correct

---

## Troubleshooting

### "Graphviz is not installed"
Install Graphviz for your platform (see Installation section). The tool will still generate `graph.dot` but won't convert it to SVG.

### "Child component file not found: ComponentName"
The component exists in code but the tool couldn't find the imported file. Reasons:
- Import path uses aliases (not yet supported)
- Path uses dynamic resolution
- File extension is missing (.jsx, .js, etc.)

**Solution:** Use `--debug` flag to see which paths were attempted:
```bash
react-ast-parser ./src/App.jsx --debug
```

### "Circular import detected"
Two components import each other (or form a cycle). This is usually a code smell. The tool will warn and skip re-processing to prevent infinite loops.

### Parse errors on .tsx files
If you get "Error parsing file", ensure TypeScript files are syntactically valid JSX. The parser supports TypeScript syntax.

---

## Development

### Running Tests
```bash
npm test
```

### Making Changes
1. Edit the relevant file (main.js, parseReactComponents.js, generateGraph.js)
2. Test with a sample component:
   ```bash
   node main.js ./test-fixtures/Sample.jsx --debug
   ```
3. Verify graph.svg is generated correctly

### Architecture

```
main.js
├─ Parses CLI arguments
├─ Validates input file
├─ Calls analyzeComponent() recursively
│  └─ resolveImportPath() – Maps imports to files
│  └─ parseReactComponents() – Extracts component data
└─ generateGraph() – Creates SVG visualization

parseReactComponents.js
└─ Babel AST traversal
   ├─ ClassDeclaration visitor
   ├─ FunctionDeclaration visitor
   ├─ JSXElement visitor
   ├─ ImportDeclaration visitor
   ├─ CallExpression visitor (Redux, hooks)
   └─ Error handling for parse failures

generateGraph.js
└─ Builds Graphviz DOT file
   ├─ Node styling (component boxes)
   ├─ Edge styling (relationships, Redux)
   └─ SVG generation via `dot` command
```

---

## Contributing

Issues and pull requests are welcome! Areas for improvement:
- Better path alias support
- Flow type detection
- Visual customization options
- Configuration file support (.react-ast-parser.json)
- Test coverage
- Performance optimization for large projects

---

## License

ISC

---

## Acknowledgments

Built with:
- **Babel** (@babel/parser, @babel/traverse) – AST parsing
- **Graphviz** – Graph visualization
- Node.js built-in APIs

---

## FAQ

**Q: Does this require modifying my code?**  
A: No. It analyzes your existing code as-is, without annotations or configuration.

**Q: What if my project uses path aliases (@/components)?**  
A: Currently not supported. Workaround: use absolute imports or standard relative paths, or pass the starting component as relative to avoid alias resolution.

**Q: How fast is it?**  
A: On a typical 100-component project, ~1-2 seconds for parsing + graph generation.

**Q: Can I customize the graph styling?**  
A: Yes – edit the GRAPH_STYLE constants in generateGraph.js, or post-process the generated .dot file.

**Q: Does it work with Next.js / Remix / other frameworks?**  
A: Yes, if they use standard React and JSX. The tool is framework-agnostic—it just analyzes React components.

---

## See Also

- [Babel Documentation](https://babeljs.io/)
- [Graphviz Manual](https://graphviz.org/doc/)
- [React Component Patterns](https://react.dev)
