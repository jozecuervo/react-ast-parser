const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Graph styling constants
const GRAPH_STYLE = {
  COLORS: {
    COMPONENT_BG: '#CBE3FA',
    COMPONENT_EDGE: '#8C8C8C',
    REDUX_EDGE: '#C57C00',
    ERROR_BG: '#FFB3BA',
  },
  FONT: {
    FAMILY: 'Helvetica',
    SIZE: 12,
    EDGE_SIZE: 10,
  },
};

/**
 * Check if graphviz is installed
 */
function isGraphvizAvailable() {
  try {
    execSync('dot -V', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a Graphviz DOT representation of the component tree
 */
function generateDotContent(data) {
  let dotContent = 'digraph G {\n';
  dotContent += '  rankdir=TB;\n';
  dotContent += '  nodesep=0.5;\n';
  dotContent += '  ranksep=0.8;\n';
  dotContent += `  node [shape=box, style=rounded, fontname="${GRAPH_STYLE.FONT.FAMILY}", fontsize=${GRAPH_STYLE.FONT.SIZE}, fontcolor=black];\n`;

  const components = data?.components || [];
  const drawnEdges = new Set();
  let hasParseErrors = false;

  // Generate nodes and edges
  components.forEach(component => {
    const bgColor = component.error ? GRAPH_STYLE.COLORS.ERROR_BG : GRAPH_STYLE.COLORS.COMPONENT_BG;
    const stateText = component.error
      ? `Error: ${component.error.substring(0, 30)}...`
      : component.state
        ? Array.isArray(component.state)
          ? component.state.join(', ')
          : component.state
        : 'None';

    if (component.error) {
      hasParseErrors = true;
    }

    dotContent += `  "${component.name}" [label=<
      <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" BGCOLOR="${bgColor}">
        <TR><TD ALIGN="CENTER"><B>${component.name || 'component'}</B></TD></TR>
        <TR><TD ALIGN="CENTER">State: ${stateText}</TD></TR>
      </TABLE>
    >];\n`;

    // Draw one arrow per unique child component
    if (component.children && Array.isArray(component.children)) {
      component.children.forEach(child => {
        const props = component.props?.[child] || [];
        const formattedProps = props.length ? `Props:\\n ${props.join('\\n')}` : '';
        const edgeKey = `"${component.name}" -> "${child}"`;

        if (!drawnEdges.has(edgeKey)) {
          dotContent += `  ${edgeKey} [label="${formattedProps}", color="${GRAPH_STYLE.COLORS.COMPONENT_EDGE}", fontname="${GRAPH_STYLE.FONT.FAMILY}", fontsize=${GRAPH_STYLE.FONT.EDGE_SIZE}, align=left];\n`;
          drawnEdges.add(edgeKey);
        }
      });
    }

    // Draw Redux-related edges
    if (component.reduxProps && Array.isArray(component.reduxProps)) {
      component.reduxProps.forEach(prop => {
        const reduxEdgeKey = `"Redux Store" -> "${component.name}" [label="${prop}", color="${GRAPH_STYLE.COLORS.REDUX_EDGE}", fontname="${GRAPH_STYLE.FONT.FAMILY}", fontsize=${GRAPH_STYLE.FONT.EDGE_SIZE}];`;
        if (!drawnEdges.has(reduxEdgeKey)) {
          dotContent += `  ${reduxEdgeKey}\n`;
          drawnEdges.add(reduxEdgeKey);
        }
      });
    }

    // Draw Redux action edges
    if (component.actions && Array.isArray(component.actions)) {
      component.actions.forEach(action => {
        const actionEdgeKey = `"${component.name}" -> "Redux Store" [label="${action}", color="${GRAPH_STYLE.COLORS.REDUX_EDGE}", fontname="${GRAPH_STYLE.FONT.FAMILY}", fontsize=${GRAPH_STYLE.FONT.EDGE_SIZE}];`;
        if (!drawnEdges.has(actionEdgeKey)) {
          dotContent += `  ${actionEdgeKey}\n`;
          drawnEdges.add(actionEdgeKey);
        }
      });
    }
  });

  dotContent += '}';

  return { dotContent, hasParseErrors };
}

/**
 * Generate SVG graph from component data
 * Outputs graph.dot and graph.svg files
 */
function generateGraph(data, quiet = false) {
  if (!data || !data.components) {
    if (!quiet) console.error('✗ No component data provided');
    return false;
  }

  const { dotContent, hasParseErrors } = generateDotContent(data);

  // Write DOT file
  const dotFile = 'graph.dot';
  try {
    fs.writeFileSync(dotFile, dotContent);
    if (!quiet) console.log(`✓ Generated ${dotFile}`);
  } catch (error) {
    console.error(`✗ Failed to write ${dotFile}: ${error.message}`);
    return false;
  }

  // Check if graphviz is available
  if (!isGraphvizAvailable()) {
    console.error(
      `✗ Graphviz is not installed. Install it to generate SVG output:\n  macOS: brew install graphviz\n  Linux: sudo apt-get install graphviz\n  Windows: choco install graphviz`
    );
    console.log(`\n✓ DOT file saved to ${dotFile} - you can manually convert it using: dot -Tsvg ${dotFile} -o graph.svg`);
    return false;
  }

  // Generate SVG from DOT
  const svgFile = 'graph.svg';
  exec(`dot -Tsvg ${dotFile} -o ${svgFile}`, (error) => {
    if (error) {
      console.error(`✗ Graphviz error: ${error.message}`);
      return false;
    }
    if (!quiet) {
      console.log(`✓ Generated ${svgFile}`);
      if (hasParseErrors) {
        console.warn(`\n⚠️  Note: Some components had parse errors (shown in red). Check the --debug flag for details.`);
      }
    }
    return true;
  });

  return true;
}

module.exports = generateGraph;
