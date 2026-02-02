const { exec } = require('child_process');
const fs = require('fs');

const MAX_PROPS_DISPLAY = 5; // Max props to show before truncating

function generateGraph(rootComponent, outputName = 'graph') {
  let dotContent = 'digraph G {\n';
  dotContent += '  rankdir=TB;\n';
  dotContent += '  nodesep=0.6;\n';
  dotContent += '  ranksep=1.0;\n';
  dotContent += '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, fillcolor="#E8F4FD", color="#4A90A4"];\n';
  dotContent += '  edge [fontname="Helvetica", fontsize=9, color="#666666"];\n';

  const drawnNodes = new Set();
  const drawnEdges = new Set();

  function formatPropsForEdge(propsFromParent) {
    if (!propsFromParent) return '';

    const allProps = [];

    // Add state props with marker
    (propsFromParent.stateProps || []).forEach(p => allProps.push(`●${p}`));
    // Add function props with marker
    (propsFromParent.functionProps || []).forEach(p => allProps.push(`ƒ${p}`));
    // Add other props
    (propsFromParent.otherProps || []).forEach(p => allProps.push(p));

    if (allProps.length === 0) return '';

    // Truncate if too many
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

    // Add state if present
    if (component.state && component.state.length > 0) {
      const stateStr = component.state.length > 3
        ? component.state.slice(0, 3).join(', ') + ` +${component.state.length - 3}`
        : component.state.join(', ');
      parts.push(`state: ${stateStr}`);
    }

    // Add redux if present
    if (component.reduxProps && component.reduxProps.length > 0) {
      const reduxStr = component.reduxProps.length > 3
        ? component.reduxProps.slice(0, 3).join(', ') + ` +${component.reduxProps.length - 3}`
        : component.reduxProps.join(', ');
      parts.push(`redux: ${reduxStr}`);
    }

    return parts.join('\\n');
  }

  function getNodeStyle(component) {
    // Different colors based on component characteristics
    if (component.error === 'File not found') {
      return 'fillcolor="#F5F5F5", color="#CCCCCC", style="rounded,filled,dashed"';
    }
    if (component.error === 'Already parsed') {
      return 'fillcolor="#FFF3E0", color="#FF9800", style="rounded,filled,dashed"';
    }
    if (component.reduxProps && component.reduxProps.length > 0) {
      return 'fillcolor="#E8F5E9", color="#4CAF50", style="rounded,filled"'; // Green for Redux-connected
    }
    if (component.state && component.state.length > 0) {
      return 'fillcolor="#E3F2FD", color="#2196F3", style="rounded,filled"'; // Blue for stateful
    }
    return 'fillcolor="#FAFAFA", color="#9E9E9E", style="rounded,filled"'; // Gray for stateless
  }

  function processComponent(component, parentName = null) {
    if (!component || !component.name) return;

    const nodeId = component.name;

    // Draw node if not already drawn
    if (!drawnNodes.has(nodeId)) {
      drawnNodes.add(nodeId);

      const label = formatNodeLabel(component);
      const style = getNodeStyle(component);

      dotContent += `  "${nodeId}" [label="${label}", ${style}];\n`;
    }

    // Draw edge from parent with props as label
    if (parentName) {
      const edgeKey = `${parentName}->${nodeId}`;
      if (!drawnEdges.has(edgeKey)) {
        drawnEdges.add(edgeKey);

        const propsLabel = formatPropsForEdge(component.propsFromParent);
        if (propsLabel) {
          dotContent += `  "${parentName}" -> "${nodeId}" [label="${propsLabel}", fontcolor="#555555"];\n`;
        } else {
          dotContent += `  "${parentName}" -> "${nodeId}";\n`;
        }
      }
    }

    // Process children recursively
    if (component.children && Array.isArray(component.children)) {
      component.children.forEach(child => {
        if (typeof child === 'object' && child.name) {
          processComponent(child, nodeId);
        }
      });
    }
  }

  processComponent(rootComponent);

  // Add legend
  dotContent += '\n  // Legend\n';
  dotContent += '  subgraph cluster_legend {\n';
  dotContent += '    label="Legend";\n';
  dotContent += '    fontsize=10;\n';
  dotContent += '    color="#CCCCCC";\n';
  dotContent += '    style="rounded";\n';
  dotContent += '    node [shape=box, fontsize=9, width=1.2, height=0.3];\n';
  dotContent += '    leg1 [label="Redux connected", fillcolor="#E8F5E9", color="#4CAF50", style="rounded,filled"];\n';
  dotContent += '    leg2 [label="Stateful", fillcolor="#E3F2FD", color="#2196F3", style="rounded,filled"];\n';
  dotContent += '    leg3 [label="Stateless", fillcolor="#FAFAFA", color="#9E9E9E", style="rounded,filled"];\n';
  dotContent += '    leg4 [label="External/Unresolved", fillcolor="#F5F5F5", color="#CCCCCC", style="rounded,filled,dashed"];\n';
  dotContent += '    leg1 -> leg2 -> leg3 -> leg4 [style=invis];\n';
  dotContent += '    edge_leg [shape=none, label="Edge labels:\\n●prop = state prop\\nƒprop = function prop", fontsize=8];\n';
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
