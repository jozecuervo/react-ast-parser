const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_PROPS_DISPLAY = 5; // Max props to show before truncating

// Color palette by file type
const TYPE_COLORS = {
  component: { fill: '#E3F2FD', border: '#1976D2', label: 'Components' },      // Blue
  reducer: { fill: '#F3E5F5', border: '#7B1FA2', label: 'Reducers' },          // Purple
  action: { fill: '#FFF3E0', border: '#F57C00', label: 'Actions' },            // Orange
  constant: { fill: '#E8F5E9', border: '#388E3C', label: 'Constants' },        // Green
  util: { fill: '#FFF8E1', border: '#FBC02D', label: 'Utils' },                // Yellow
  hook: { fill: '#E0F7FA', border: '#0097A7', label: 'Hooks' },                // Cyan
  context: { fill: '#FCE4EC', border: '#C2185B', label: 'Context' },           // Pink
  service: { fill: '#E8EAF6', border: '#303F9F', label: 'Services' },          // Indigo
  external: { fill: '#ECEFF1', border: '#607D8B', label: 'External' },         // Gray
  root: { fill: '#FAFAFA', border: '#9E9E9E', label: 'Root' },                 // Light gray
};

// Fallback colors for unknown directories
const FALLBACK_COLORS = [
  '#FBE9E7', '#F1F8E9', '#E1F5FE', '#FFF9C4', '#D7CCC8'
];

function generateGraph(rootComponent, outputName = 'graph') {
  const components = new Map(); // nodeId -> component data
  const edges = []; // { from, to, propsLabel }
  const directoryClusters = new Map(); // directory -> Set of nodeIds

  function formatPropsForEdge(propsFromParent) {
    if (!propsFromParent) return '';

    const allProps = [];
    (propsFromParent.stateProps || []).forEach(p => allProps.push(`●${p}`));
    (propsFromParent.functionProps || []).forEach(p => allProps.push(`ƒ${p}`));
    (propsFromParent.otherProps || []).forEach(p => allProps.push(p));

    if (allProps.length === 0) return '';

    if (allProps.length > MAX_PROPS_DISPLAY) {
      const shown = allProps.slice(0, MAX_PROPS_DISPLAY);
      const remaining = allProps.length - MAX_PROPS_DISPLAY;
      return shown.join('\\n') + `\\n+${remaining} more`;
    }

    return allProps.join('\\n');
  }

  function formatNodeLabel(component) {
    const name = component.name || 'Unknown';
    const parts = [name];

    // Show Redux connection type indicator
    const redux = component.redux;
    if (redux?.isConnected || redux?.usesHooks) {
      const reduxIndicators = [];
      if (redux.usesHooks) {
        if (redux.usesSelectorHook) reduxIndicators.push('useSelector');
        if (redux.usesDispatchHook) reduxIndicators.push('useDispatch');
      } else if (redux.isConnected) {
        reduxIndicators.push('connect()');
      }
      if (reduxIndicators.length > 0) {
        parts.push(`⚡ ${reduxIndicators.join(', ')}`);
      }
    }

    // Show reducer slices accessed
    if (redux?.slices && redux.slices.length > 0) {
      const slicesStr = redux.slices.length > 3
        ? redux.slices.slice(0, 3).join(', ') + ` +${redux.slices.length - 3}`
        : redux.slices.join(', ');
      parts.push(`📦 ${slicesStr}`);
    }

    // Show dispatched actions
    if (component.actions && component.actions.length > 0) {
      const actionsStr = component.actions.length > 2
        ? component.actions.slice(0, 2).join(', ') + ` +${component.actions.length - 2}`
        : component.actions.join(', ');
      parts.push(`🎬 ${actionsStr}`);
    }

    // Show local state
    if (component.state && component.state.length > 0) {
      const stateStr = component.state.length > 3
        ? component.state.slice(0, 3).join(', ') + ` +${component.state.length - 3}`
        : component.state.join(', ');
      parts.push(`state: ${stateStr}`);
    }

    // Show redux props (mapped from state)
    if (component.reduxProps && component.reduxProps.length > 0) {
      const reduxStr = component.reduxProps.length > 3
        ? component.reduxProps.slice(0, 3).join(', ') + ` +${component.reduxProps.length - 3}`
        : component.reduxProps.join(', ');
      parts.push(`props: ${reduxStr}`);
    }

    return parts.join('\\n');
  }

  function getNodeStyle(component) {
    if (component.error === 'File not found' || component.error === 'External package') {
      return 'fillcolor="#F5F5F5", color="#CCCCCC", style="rounded,filled,dashed"';
    }
    if (component.error === 'Already parsed') {
      return 'fillcolor="#FFF3E0", color="#FF9800", style="rounded,filled,dashed"';
    }
    if (component.error === 'Parse error') {
      return 'fillcolor="#FFEBEE", color="#D32F2F", style="rounded,filled,dashed"';
    }

    const redux = component.redux;

    // Redux with hooks (modern) - teal/cyan
    if (redux?.usesHooks) {
      return 'fillcolor="#E0F2F1", color="#00897B", style="rounded,filled", penwidth=2';
    }
    // Redux with connect() (classic) - green
    if (redux?.isConnected || (component.reduxProps && component.reduxProps.length > 0)) {
      return 'fillcolor="#E8F5E9", color="#4CAF50", style="rounded,filled", penwidth=2';
    }
    // Has dispatched actions but no mapped state
    if (component.actions && component.actions.length > 0) {
      return 'fillcolor="#FFF3E0", color="#FF9800", style="rounded,filled"';
    }
    // Has local state only
    if (component.state && component.state.length > 0) {
      return 'fillcolor="#E3F2FD", color="#2196F3", style="rounded,filled"';
    }
    // Stateless
    return 'fillcolor="#FAFAFA", color="#9E9E9E", style="rounded,filled"';
  }

  function getFileType(sourcePath) {
    if (!sourcePath) return 'external';

    const lowerPath = sourcePath.toLowerCase();
    const dir = path.dirname(lowerPath);
    const filename = path.basename(lowerPath);

    // Check directory patterns
    if (dir.includes('reducer')) return 'reducer';
    if (dir.includes('action')) return 'action';
    if (dir.includes('constant')) return 'constant';
    if (dir.includes('util')) return 'util';
    if (dir.includes('hook')) return 'hook';
    if (dir.includes('context')) return 'context';
    if (dir.includes('service') || dir.includes('api')) return 'service';

    // Check filename patterns
    if (filename.includes('reducer')) return 'reducer';
    if (filename.includes('action')) return 'action';
    if (filename.includes('constant')) return 'constant';
    if (filename.includes('util') || filename.includes('helper')) return 'util';
    if (filename.startsWith('use') || filename.includes('hook')) return 'hook';
    if (filename.includes('context')) return 'context';
    if (filename.includes('service') || filename.includes('api')) return 'service';

    // Check file extension
    if (sourcePath.endsWith('.jsx') || sourcePath.endsWith('.tsx')) return 'component';

    // Check if it's an external package (starts with @)
    if (sourcePath.startsWith('@')) return 'external';

    // Default to component for .js files in component-like directories
    if (dir.includes('component')) return 'component';

    return 'component'; // Default
  }

  function getDirectory(sourcePath) {
    if (!sourcePath) return '_external';
    // Get directory from source path
    const dir = path.dirname(sourcePath);
    // Normalize: '.' becomes 'root', clean up path
    if (dir === '.' || dir === '') return '_root';
    return dir.replace(/^\.\//, '');
  }

  // First pass: collect all components and organize by directory + type
  function collectComponents(component, parentName = null) {
    if (!component || !component.name) return;

    const nodeId = component.name;

    if (!components.has(nodeId)) {
      // Determine file type and directory
      const fileType = getFileType(component.sourcePath);
      const dir = getDirectory(component.sourcePath);

      // Store component with its type
      component._fileType = fileType;
      component._directory = dir;
      components.set(nodeId, component);

      // Create cluster key combining type and directory for better organization
      // e.g., "component:components/abtest" or "reducer:reducers"
      const clusterKey = `${fileType}:${dir}`;

      if (!directoryClusters.has(clusterKey)) {
        directoryClusters.set(clusterKey, {
          nodes: new Set(),
          fileType,
          directory: dir
        });
      }
      directoryClusters.get(clusterKey).nodes.add(nodeId);
    }

    // Record edge
    if (parentName) {
      const propsLabel = formatPropsForEdge(component.propsFromParent);
      const isJsxChild = component.isJsxChild !== false; // default to true for backwards compatibility
      edges.push({ from: parentName, to: nodeId, propsLabel, isJsxChild });
    }

    // Process children
    if (component.children && Array.isArray(component.children)) {
      component.children.forEach(child => {
        if (typeof child === 'object' && child.name) {
          collectComponents(child, nodeId);
        }
      });
    }
  }

  collectComponents(rootComponent);

  // Generate DOT content
  let dotContent = 'digraph G {\n';
  dotContent += '  rankdir=TB;\n';
  dotContent += '  compound=true;\n'; // Allow edges to clusters
  dotContent += '  nodesep=0.5;\n';
  dotContent += '  ranksep=0.8;\n';
  dotContent += '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11];\n';
  dotContent += '  edge [fontname="Helvetica", fontsize=9, color="#666666"];\n';
  dotContent += '\n';

  // Sort clusters: group by file type, then by directory
  const sortedClusters = Array.from(directoryClusters.entries()).sort((a, b) => {
    const [keyA, dataA] = a;
    const [keyB, dataB] = b;

    // Define type priority (components first, external last)
    const typePriority = {
      'component': 0, 'hook': 1, 'context': 2, 'reducer': 3,
      'action': 4, 'constant': 5, 'util': 6, 'service': 7, 'external': 8
    };

    const typeOrderA = typePriority[dataA.fileType] ?? 9;
    const typeOrderB = typePriority[dataB.fileType] ?? 9;

    if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;

    // Within same type, sort by directory (_root first)
    if (dataA.directory === '_root') return -1;
    if (dataB.directory === '_root') return 1;
    return dataA.directory.localeCompare(dataB.directory);
  });

  let fallbackColorIndex = 0;

  // Generate clusters for each directory+type combination
  sortedClusters.forEach(([clusterKey, clusterData]) => {
    const { nodes: nodeIds, fileType, directory } = clusterData;
    if (nodeIds.size === 0) return;

    // Get color based on file type
    const typeConfig = TYPE_COLORS[fileType] || TYPE_COLORS.external;
    let clusterColor = typeConfig.fill;
    let borderColor = typeConfig.border;

    // For unknown types, use fallback colors
    if (!TYPE_COLORS[fileType]) {
      clusterColor = FALLBACK_COLORS[fallbackColorIndex % FALLBACK_COLORS.length];
      fallbackColorIndex++;
    }

    // Create descriptive label
    let clusterName;
    if (directory === '_root') {
      clusterName = `Root ${typeConfig.label}`;
    } else if (directory === '_external' || fileType === 'external') {
      clusterName = 'External';
    } else {
      clusterName = `${directory}`;
    }

    const clusterId = `cluster_${clusterKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

    dotContent += `  subgraph ${clusterId} {\n`;
    dotContent += `    label="${clusterName}";\n`;
    dotContent += `    fontsize=12;\n`;
    dotContent += `    fontname="Helvetica";\n`;
    dotContent += `    style="rounded,filled";\n`;
    dotContent += `    fillcolor="${clusterColor}";\n`;
    dotContent += `    color="${borderColor}";\n`;
    dotContent += '\n';

    // Add nodes for this cluster
    nodeIds.forEach(nodeId => {
      const component = components.get(nodeId);
      const label = formatNodeLabel(component);
      const style = getNodeStyle(component);
      dotContent += `    "${nodeId}" [label="${label}", ${style}];\n`;
    });

    dotContent += '  }\n\n';
  });

  // Add edges (outside clusters so they can cross boundaries)
  const drawnEdges = new Set();
  edges.forEach(({ from, to, propsLabel, isJsxChild }) => {
    const edgeKey = `${from}->${to}`;
    if (drawnEdges.has(edgeKey)) return;
    drawnEdges.add(edgeKey);

    // JSX children get solid lines, imports get dashed lines
    const edgeStyle = isJsxChild ? '' : ', style="dashed", color="#999999"';

    if (propsLabel) {
      dotContent += `  "${from}" -> "${to}" [label="${propsLabel}", fontcolor="#555555"${edgeStyle}];\n`;
    } else {
      dotContent += `  "${from}" -> "${to}" [${edgeStyle.replace(/^, /, '')}];\n`;
    }
  });

  // Add legend
  dotContent += '\n  // Legend\n';
  dotContent += '  subgraph cluster_legend {\n';
  dotContent += '    label="Legend";\n';
  dotContent += '    fontsize=10;\n';
  dotContent += '    color="#CCCCCC";\n';
  dotContent += '    style="rounded";\n';
  dotContent += '    fillcolor="#FFFFFF";\n';
  dotContent += '    node [shape=box, fontsize=9, width=1.4, height=0.3];\n';

  // Node type legend
  dotContent += '    subgraph cluster_node_legend {\n';
  dotContent += '      label="Node Types";\n';
  dotContent += '      fontsize=9;\n';
  dotContent += '      style="rounded";\n';
  dotContent += '      color="#DDDDDD";\n';
  dotContent += '      leg_hooks [label="Redux Hooks", fillcolor="#E0F2F1", color="#00897B", style="rounded,filled", penwidth=2];\n';
  dotContent += '      leg_connect [label="Redux connect()", fillcolor="#E8F5E9", color="#4CAF50", style="rounded,filled", penwidth=2];\n';
  dotContent += '      leg_dispatch [label="Dispatches only", fillcolor="#FFF3E0", color="#FF9800", style="rounded,filled"];\n';
  dotContent += '      leg_state [label="Local state", fillcolor="#E3F2FD", color="#2196F3", style="rounded,filled"];\n';
  dotContent += '      leg_less [label="Stateless", fillcolor="#FAFAFA", color="#9E9E9E", style="rounded,filled"];\n';
  dotContent += '      leg_ext [label="Unresolved", fillcolor="#F5F5F5", color="#CCCCCC", style="rounded,filled,dashed"];\n';
  dotContent += '      leg_hooks -> leg_connect -> leg_dispatch -> leg_state -> leg_less -> leg_ext [style=invis];\n';
  dotContent += '    }\n';

  // File type legend (cluster colors)
  dotContent += '    subgraph cluster_file_legend {\n';
  dotContent += '      label="Cluster Types";\n';
  dotContent += '      fontsize=9;\n';
  dotContent += '      style="rounded";\n';
  dotContent += '      color="#DDDDDD";\n';
  dotContent += `      fleg_comp [label="Components", fillcolor="${TYPE_COLORS.component.fill}", color="${TYPE_COLORS.component.border}", style="rounded,filled"];\n`;
  dotContent += `      fleg_redux [label="Reducers", fillcolor="${TYPE_COLORS.reducer.fill}", color="${TYPE_COLORS.reducer.border}", style="rounded,filled"];\n`;
  dotContent += `      fleg_action [label="Actions", fillcolor="${TYPE_COLORS.action.fill}", color="${TYPE_COLORS.action.border}", style="rounded,filled"];\n`;
  dotContent += `      fleg_const [label="Constants", fillcolor="${TYPE_COLORS.constant.fill}", color="${TYPE_COLORS.constant.border}", style="rounded,filled"];\n`;
  dotContent += `      fleg_util [label="Utils", fillcolor="${TYPE_COLORS.util.fill}", color="${TYPE_COLORS.util.border}", style="rounded,filled"];\n`;
  dotContent += `      fleg_ext [label="External", fillcolor="${TYPE_COLORS.external.fill}", color="${TYPE_COLORS.external.border}", style="rounded,filled"];\n`;
  dotContent += '      fleg_comp -> fleg_redux -> fleg_action -> fleg_const -> fleg_util -> fleg_ext [style=invis];\n';
  dotContent += '    }\n';

  // Symbols legend
  dotContent += '    subgraph cluster_symbols_legend {\n';
  dotContent += '      label="Symbols";\n';
  dotContent += '      fontsize=9;\n';
  dotContent += '      style="rounded";\n';
  dotContent += '      color="#DDDDDD";\n';
  dotContent += '      sym_leg [shape=none, label="⚡ Redux connection\\n📦 Store slices\\n🎬 Dispatched actions\\n\\nEdge styles:\\n━━━ JSX child\\n┄┄┄ Import only\\n\\nProp types:\\n●prop = state prop\\nƒprop = function prop", fontsize=8];\n';
  dotContent += '    }\n';
  dotContent += '  }\n';

  dotContent += '}\n';

  const dotFile = `${outputName}.dot`;
  const svgFile = `${outputName}.svg`;

  fs.writeFileSync(dotFile, dotContent);

  exec(`dot -Tsvg ${dotFile} -o ${svgFile}`, (error) => {
    if (error) console.error(`Graphviz Error: ${error}`);
    else console.log(`Graph generated: ${svgFile}`);
  });
}

module.exports = generateGraph;
