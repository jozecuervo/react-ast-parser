const { exec } = require('child_process');
const fs = require('fs');

function generateGraph(data) {
  let dotContent = 'digraph G {\n';
  dotContent += '  rankdir=TB;\n';
  dotContent += '  nodesep=0.5;\n';
  dotContent += '  ranksep=0.8;\n';
  dotContent += '  node [shape=box, style=rounded, fontname="Helvetica"];\n';

  const components = data?.components || [];

  // Generate nodes and edges
  components.forEach(component => {
    dotContent += `  "${component.name}" [label="${component.name}\\nState: ${component.state || 'None'}"];\n`;

    // Add edges for children
    (component.children || []).forEach(child => {
      const props = component.props?.[child] || [];
      dotContent += `  "${component.name}" -> "${child}" [label="Props: ${props.join(', ')}", color=green];\n`;
    });

    // Add edges for Redux props
    (component.reduxProps || []).forEach(prop => {
      dotContent += `  "Redux Store" -> "${component.name}" [label="${prop}", color=red];\n`;
    });

    // Add edges for actions
    (component.actions || []).forEach(action => {
      dotContent += `  "${component.name}" -> "Redux Store" [label="${action}", color=blue];\n`;
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
