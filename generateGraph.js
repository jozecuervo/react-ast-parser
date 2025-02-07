const { exec } = require('child_process');
const fs = require('fs');

function generateGraph(data) {
  let dotContent = 'digraph G {\n';
  dotContent += '  rankdir=TB;\n';
  dotContent += '  nodesep=0.5;\n';
  dotContent += '  ranksep=0.8;\n';
  dotContent += '  node [shape=box, style=rounded, fontname="Helvetica", fontsize=12, fontcolor=black];\n';

  const components = data?.components || [];
  const drawnEdges = new Set(); // Track edges already drawn to avoid duplicates

  // Generate nodes and edges
  components.forEach(component => {
    dotContent += `  "${component.name}" [label=<
      <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" BGCOLOR="#CBE3FA">
        <TR><TD ALIGN="CENTER"><B>${component.name || 'component'}</B></TD></TR>
        <TR><TD ALIGN="CENTER">State: ${component.state || 'None'}</TD></TR>
      </TABLE>
    >];\n`;


    // Draw one arrow per unique child component
    (component.children || []).forEach(child => {
      const props = component.props?.[child] || [];
      const formattedProps = props.length ? `Props:\\n ${props.join('\\n')}` : '';
      const edgeKey = `"${component.name}" -> "${child}"`;

      if (!drawnEdges.has(edgeKey)) {
        dotContent += `  ${edgeKey} [label="${formattedProps}", color="#8C8C8C", fontname="Helvetica", fontsize=10, align=left];\n`;
        drawnEdges.add(edgeKey); // Mark this edge as drawn
      }
    });

    // Draw Redux-related edges
    (component.reduxProps || []).forEach(prop => {
      const reduxEdgeKey = `"Redux Store" -> "${component.name}" [label="${prop}", color="#C57C00", fontname="Helvetica", fontsize=10];`;
      if (!drawnEdges.has(reduxEdgeKey)) {
        dotContent += `  ${reduxEdgeKey}\n`;
        drawnEdges.add(reduxEdgeKey);
      }
    });

    (component.actions || []).forEach(action => {
      const actionEdgeKey = `"${component.name}" -> "Redux Store" [label="${action}", color="#C57C00", fontname="Helvetica", fontsize=10];`;
      if (!drawnEdges.has(actionEdgeKey)) {
        dotContent += `  ${actionEdgeKey}\n`;
        drawnEdges.add(actionEdgeKey);
      }
    });
  });

  dotContent += '}';
  fs.writeFileSync('graph.dot', dotContent);

  exec('dot -Tsvg graph.dot -o graph.svg', (error) => {
    if (error) console.error(`Graphviz Error: ${error}`);
    else console.log('Final graph generated as graph.svg');
  });
}

module.exports = generateGraph;
